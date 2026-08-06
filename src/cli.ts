import { Command } from 'commander';
import { DEFAULT_GITLAB_API_URL, DEFAULT_OPENAI_API_URL } from './config';
import { DEFAULT_OPENAI_MODEL } from './openai-config';
import { ReviewProfile } from './types';

export const parseReviewProfile = (value: unknown): ReviewProfile => {
    if (value === undefined || value === 'standard') {
        return 'standard';
    }

    if (value === 'security') {
        return 'security';
    }

    if (value === 'wordpress-security') {
        return 'wordpress-security';
    }

    throw new Error('Review profile must be "standard", "security", or "wordpress-security".');
};

/**
 * Create the CLI parser with the existing public options and defaults.
 */
export const createCliProgram = (): Command => {
    return new Command()
        .option('-g, --gitlab-api-url <string>', 'GitLab API URL', DEFAULT_GITLAB_API_URL)
        .option('-t, --gitlab-access-token <string>', 'GitLab Access Token (deprecated; prefer environment variables)')
        .option('-o, --openai-api-url <string>', 'OpenAI API URL', DEFAULT_OPENAI_API_URL)
        .option('-a, --openai-access-token <string>', 'OpenAI Access Token (deprecated; prefer environment variables)')
        .option('-p, --project-id <number>', 'GitLab Project ID')
        .option('-m, --merge-request-id <string>', 'GitLab Merge Request ID')
        .option('-org, --organization-id <number>', 'Organization ID')
        .option('-c, --custom-model <string>', 'Custom Model ID', DEFAULT_OPENAI_MODEL)
        .option('-mode, --mode <string>', 'Mode: openai or gemini', 'openai')
        .option('--review-profile <profile>', 'Review profile: standard, security, or wordpress-security', 'standard');
};
