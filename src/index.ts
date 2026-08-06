import { classifyDiffChange, GitLab } from './gitlab';
import { createCliProgram, parseReviewProfile } from './cli';
import { getSafeErrorMessage, resolveReviewConfig, warnAboutLegacySecretFlags } from './config';
import { createAIProvider } from './provider-factory';
import { getNextRateLimitRetry } from './retry';
import { normalizeReviewComment } from './review-output';
import { formatSecurityFindings, parseSecurityReview } from './security-review';
import { IAIProvider, IDiffChange, ReviewProfile, ReviewRequest } from './types';
import { delay, getDiffBlocks, getLinePosition } from './utils';

const program = createCliProgram();
program.parse(process.argv);

const LINE_REGEX = /@@\s-(\d+)(?:,(\d+))?\s\+(\d+)(?:,(\d+))?\s@@/;
const RATE_LIMIT_DELAY = 60 * 1000;

interface ReviewBlock {
    block: string;
    rateLimitRetries: number;
}

function shouldSkipChange(change: IDiffChange): boolean {
    return !change.new_path && !change.old_path;
}

async function processChange(
    change: IDiffChange,
    aiClient: IAIProvider,
    gitlab: GitLab,
    reviewProfile: ReviewProfile,
    secrets: readonly string[],
): Promise<void> {
    const changeKind = classifyDiffChange(change);
    if (changeKind !== 'text') {
        await processSummaryChange(change, aiClient, gitlab, reviewProfile, changeKind, secrets);
        return;
    }

    const diffBlocks: ReviewBlock[] = getDiffBlocks(change.diff).map((block) => ({
        block,
        rateLimitRetries: 0,
    }));
    let reviewAttempted = false;
    
    while (diffBlocks.length > 0) {
        const reviewBlock = diffBlocks.shift()!;
        const block = reviewBlock.block;
        const matches = LINE_REGEX.exec(block);
        
        if (!matches) continue;
        
        const linePosition = getLinePosition(matches, block);
        
        if (!linePosition.new_line && !linePosition.old_line) continue;
        if (linePosition.new_line && linePosition.new_line <= 0 && 
            linePosition.old_line && linePosition.old_line <= 0) continue;

        reviewAttempted = true;
        try {
            const reviewRequest: ReviewRequest = {
                diff: block,
                profile: reviewProfile,
                filePath: change.new_path,
                line: getReviewLine(linePosition),
            };
            const reviewResult = await aiClient.review(reviewRequest);
            const suggestion = normalizeReviewComment(reviewProfile !== 'standard'
                ? formatSecurityFindings(parseSecurityReview(reviewResult.text, reviewRequest), reviewProfile)
                : reviewResult.text);

            if (!suggestion) continue;
            await gitlab.addReviewComment(linePosition, change, suggestion);
        } catch (error: unknown) {
            if (isRateLimitError(error)) {
                const nextRetry = getNextRateLimitRetry(reviewBlock.rateLimitRetries);
                if (nextRetry === undefined) {
                    console.error(
                        'Rate limit retry limit reached for diff block:',
                        getSafeErrorMessage(error, secrets),
                    );
                    continue;
                }

                console.log(`Rate limit exceeded, retrying in 60s (attempt ${nextRetry})...`);
                await delay(RATE_LIMIT_DELAY);
                diffBlocks.push({ block, rateLimitRetries: nextRetry });
            } else {
                console.error('Error processing diff block:', getSafeErrorMessage(error, secrets));
            }
        }
    }

    if (!reviewAttempted) {
        await processSummaryChange(change, aiClient, gitlab, reviewProfile, 'unavailable', secrets);
    }
}

async function processSummaryChange(
    change: IDiffChange,
    aiClient: IAIProvider,
    gitlab: GitLab,
    reviewProfile: ReviewProfile,
    changeKind: ReturnType<typeof classifyDiffChange>,
    secrets: readonly string[],
): Promise<void> {
    const path = (change.new_path || change.old_path || 'this change').replace(/[\r\n]/g, ' ');
    let suggestion: string;

    if (changeKind === 'binary' || changeKind === 'unavailable') {
        suggestion = `Inline review is unavailable for this ${changeKind} file (${path}).`;
    } else {
        try {
            const reviewRequest: ReviewRequest = {
                diff: change.diff,
                profile: reviewProfile,
                filePath: change.new_path || change.old_path,
            };
            const reviewResult = await aiClient.review(reviewRequest);
            suggestion = normalizeReviewComment(reviewProfile !== 'standard'
                ? formatSecurityFindings(parseSecurityReview(reviewResult.text, reviewRequest), reviewProfile)
                : reviewResult.text);

            if (changeKind === 'truncated' && suggestion) {
                suggestion += '\n\nInline placement was skipped because the GitLab diff was truncated; validate the full change before acting.';
            }
        } catch (error: unknown) {
            if (isRateLimitError(error)) {
                console.log('Rate limit exceeded, retrying in 60s...');
                await delay(RATE_LIMIT_DELAY);
            } else {
                console.error('Error processing change summary:', getSafeErrorMessage(error, secrets));
            }
            return;
        }
    }

    suggestion = normalizeReviewComment(suggestion);

    if (suggestion) {
        try {
            await gitlab.addSummaryComment(change, suggestion);
        } catch (error: unknown) {
            if (isRateLimitError(error)) {
                console.log('Rate limit exceeded while posting summary, retrying in 60s...');
                await delay(RATE_LIMIT_DELAY);
            } else {
                console.error('Error posting change summary:', getSafeErrorMessage(error, secrets));
            }
        }
    }
}

function getReviewLine(linePosition: { new_line?: number; old_line?: number }): number | undefined {
    if (typeof linePosition.new_line === 'number' && linePosition.new_line > 0) {
        return linePosition.new_line;
    }

    return typeof linePosition.old_line === 'number' && linePosition.old_line > 0
        ? linePosition.old_line
        : undefined;
}

function isRateLimitError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 
           'response' in error && 
           typeof (error as { response?: { status?: number } }).response?.status === 'number' &&
           (error as { response: { status: number } }).response.status === 429;
}

async function run(): Promise<void> {
    const opts = program.opts();
    warnAboutLegacySecretFlags(process.argv);
    const config = resolveReviewConfig(opts);
    const reviewProfile = parseReviewProfile(config.reviewProfile);
    const secrets = [config.gitlabAccessToken, ...config.providerAccessToken.split(',')];
    
    const gitlab = new GitLab({
        gitlabApiUrl: config.gitlabApiUrl,
        gitlabAccessToken: config.gitlabAccessToken,
        projectId: config.projectId,
        mergeRequestId: config.mergeRequestId,
        allowPrivateApiUrls: config.allowPrivateApiUrls,
    });

    const aiClient = createAIProvider(
        config.mode,
        config.providerApiUrl,
        config.providerAccessToken,
        config.organizationId,
        config.customModel,
        { allowPrivateApiUrls: config.allowPrivateApiUrls },
    );

    try {
        await gitlab.init();
    } catch (error) {
        console.error('Failed to initialize GitLab client:', getSafeErrorMessage(error, secrets));
        process.exit(1);
    }

    let changes: IDiffChange[] = [];
    try {
        changes = await gitlab.getMergeRequestChanges();
    } catch (error) {
        console.error('Failed to get merge request changes:', getSafeErrorMessage(error, secrets));
        process.exit(1);
    }

    for (const change of changes) {
        if (shouldSkipChange(change)) continue;
        await processChange(change, aiClient, gitlab, reviewProfile, secrets);
    }

    console.log('Done');
}

module.exports = run;
