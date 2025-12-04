import { Command } from 'commander';
import { GitLab } from './gitlab';
import { OpenAI } from './openai';
import { Gemini } from './gemini';
import { IAIClient, IDiffChange } from './types';
import { delay, getDiffBlocks, getLinePosition } from './utils';

const program = new Command();

program
    .option('-g, --gitlab-api-url <string>', 'GitLab API URL', 'https://gitlab.com/api/v4')
    .option('-t, --gitlab-access-token <string>', 'GitLab Access Token')
    .option('-o, --openai-api-url <string>', 'OpenAI API URL', 'https://api.openai.com/v1')
    .option('-a, --openai-access-token <string>', 'OpenAI Access Token')
    .option('-p, --project-id <number>', 'GitLab Project ID')
    .option('-m, --merge-request-id <string>', 'GitLab Merge Request ID')
    .option('-org, --organization-id <number>', 'Organization ID')
    .option('-c, --custom-model <string>', 'Custom Model ID', 'gpt-3.5-turbo')
    .option('-mode, --mode <string>', 'Mode: openai or gemini', 'openai')
    .parse(process.argv);

const LINE_REGEX = /@@\s-(\d+)(?:,(\d+))?\s\+(\d+)(?:,(\d+))?\s@@/;
const RATE_LIMIT_DELAY = 60 * 1000;

function createAIClient(mode: string, apiUrl: string, accessToken: string, orgId?: string, model?: string): IAIClient {
    if (mode === 'gemini') {
        console.log('Creating Gemini client...');
        return new Gemini(apiUrl, accessToken, model);
    }
    console.log('Creating OpenAI client...');
    return new OpenAI(apiUrl, accessToken, orgId, model);
}

function shouldSkipChange(change: IDiffChange): boolean {
    return change.renamed_file || change.deleted_file || !change.diff?.startsWith('@@');
}

async function processChange(change: IDiffChange, aiClient: IAIClient, gitlab: GitLab): Promise<void> {
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
            const suggestion = await aiClient.reviewCodeChange(block);
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

    const aiClient = createAIClient(
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
