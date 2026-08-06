import { Command } from 'commander';
import { DEFAULT_OPENAI_MODEL } from './openai-config';
import { ReviewProfile } from './types';

export const parseReviewProfile = (value: unknown): ReviewProfile => {
    if (value === undefined || value === 'standard') {
        return 'standard';
    }

    if (value === 'security') {
        return 'security';
    }

    throw new Error('Review profile must be either "standard" or "security".');
};

/**
 * Create the CLI parser with the existing public options and defaults.
 */
export const createCliProgram = (): Command => {
    return new Command()
        .option('-g, --gitlab-api-url <string>', 'GitLab API URL', 'https://gitlab.com/api/v4')
        .option('-t, --gitlab-access-token <string>', 'GitLab Access Token')
        .option('-o, --openai-api-url <string>', 'OpenAI API URL', 'https://api.openai.com/v1')
        .option('-a, --openai-access-token <string>', 'OpenAI Access Token')
        .option('-p, --project-id <number>', 'GitLab Project ID')
        .option('-m, --merge-request-id <string>', 'GitLab Merge Request ID')
        .option('-org, --organization-id <number>', 'Organization ID')
        .option('-c, --custom-model <string>', 'Custom Model ID', DEFAULT_OPENAI_MODEL)
        .option('-mode, --mode <string>', 'Mode: openai or gemini', 'openai')
        .option('--review-profile <profile>', 'Review profile: standard or security', 'standard');
};
