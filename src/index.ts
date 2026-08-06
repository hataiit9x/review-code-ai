import { GitLab } from './gitlab';
import { createCliProgram } from './cli';
import { createAIProvider } from './provider-factory';
import { IAIProvider, IDiffChange } from './types';
import { delay, getDiffBlocks, getLinePosition } from './utils';

const program = createCliProgram();
program.parse(process.argv);

const LINE_REGEX = /@@\s-(\d+)(?:,(\d+))?\s\+(\d+)(?:,(\d+))?\s@@/;
const RATE_LIMIT_DELAY = 60 * 1000;

function shouldSkipChange(change: IDiffChange): boolean {
    return change.renamed_file || change.deleted_file || !change.diff?.startsWith('@@');
}

async function processChange(change: IDiffChange, aiClient: IAIProvider, gitlab: GitLab): Promise<void> {
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
            const reviewResult = await aiClient.review({ diff: block });
            await gitlab.addReviewComment(linePosition, change, reviewResult.text);
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

function isRateLimitError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 
           'response' in error && 
           typeof (error as { response?: { status?: number } }).response?.status === 'number' &&
           (error as { response: { status: number } }).response.status === 429;
}

async function run(): Promise<void> {
    const opts = program.opts();
    
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
        await processChange(change, aiClient, gitlab);
    }

    console.log('Done');
}

module.exports = run;
