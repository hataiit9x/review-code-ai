import { GitLab } from './gitlab';
import { createCliProgram, parseReviewProfile } from './cli';
import { createAIProvider } from './provider-factory';
import { formatSecurityFindings, parseSecurityReview } from './security-review';
import { IAIProvider, IDiffChange, ReviewProfile, ReviewRequest } from './types';
import { delay, getDiffBlocks, getLinePosition } from './utils';

const program = createCliProgram();
program.parse(process.argv);

const LINE_REGEX = /@@\s-(\d+)(?:,(\d+))?\s\+(\d+)(?:,(\d+))?\s@@/;
const RATE_LIMIT_DELAY = 60 * 1000;

function shouldSkipChange(change: IDiffChange): boolean {
    return change.renamed_file || change.deleted_file || !change.diff?.startsWith('@@');
}

async function processChange(
    change: IDiffChange,
    aiClient: IAIProvider,
    gitlab: GitLab,
    reviewProfile: ReviewProfile,
): Promise<void> {
    const diffBlocks = getDiffBlocks(change.diff);
    
    while (diffBlocks.length > 0) {
        const block = diffBlocks.shift()!;
        const matches = LINE_REGEX.exec(block);
        
        if (!matches) continue;
        
        const linePosition = getLinePosition(matches, block);
        
        if (!linePosition.new_line && !linePosition.old_line) continue;
        if (linePosition.new_line && linePosition.new_line <= 0 && 
            linePosition.old_line && linePosition.old_line <= 0) continue;

        try {
            const reviewRequest: ReviewRequest = {
                diff: block,
                profile: reviewProfile,
                filePath: change.new_path,
                line: getReviewLine(linePosition),
            };
            const reviewResult = await aiClient.review(reviewRequest);
            const suggestion = reviewProfile !== 'standard'
                ? formatSecurityFindings(parseSecurityReview(reviewResult.text, reviewRequest), reviewProfile)
                : reviewResult.text;

            if (!suggestion) continue;
            await gitlab.addReviewComment(linePosition, change, suggestion);
        } catch (error: unknown) {
            if (isRateLimitError(error)) {
                console.log('Rate limit exceeded, retrying in 60s...');
                await delay(RATE_LIMIT_DELAY);
                diffBlocks.push(block);
            } else {
                console.error('Error processing diff block:', error instanceof Error ? error.message : error);
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
    const reviewProfile = parseReviewProfile(opts.reviewProfile);
    
    const gitlab = new GitLab({
        gitlabApiUrl: opts.gitlabApiUrl,
        gitlabAccessToken: opts.gitlabAccessToken,
        projectId: opts.projectId,
        mergeRequestId: opts.mergeRequestId,
    });

    const aiClient = createAIProvider(
        opts.mode,
        opts.openaiApiUrl,
        opts.openaiAccessToken,
        opts.organizationId,
        opts.customModel
    );

    try {
        await gitlab.init();
    } catch (error) {
        console.error('Failed to initialize GitLab client:', error instanceof Error ? error.message : error);
        process.exit(1);
    }

    let changes: IDiffChange[] = [];
    try {
        changes = await gitlab.getMergeRequestChanges();
    } catch (error) {
        console.error('Failed to get merge request changes:', error instanceof Error ? error.message : error);
        process.exit(1);
    }

    for (const change of changes) {
        if (shouldSkipChange(change)) continue;
        await processChange(change, aiClient, gitlab, reviewProfile);
    }

    console.log('Done');
}

module.exports = run;
