import { describe, expect, it } from 'vitest';
import {
    DEFAULT_GITLAB_API_URL,
    DEFAULT_OPENAI_API_URL,
    redactSensitiveText,
    resolveReviewConfig,
    warnAboutLegacySecretFlags,
} from '../src/config';
import { DEFAULT_OPENAI_MODEL } from '../src/openai-config';

describe('credential configuration', () => {
    it('prefers environment credentials and endpoints over legacy CLI options', () => {
        const config = resolveReviewConfig(
            {
                gitlabApiUrl: 'https://cli.gitlab.example/api/v4',
                gitlabAccessToken: 'cli-gitlab-secret',
                openaiApiUrl: 'https://cli.openai.example/v1',
                openaiAccessToken: 'cli-openai-secret',
                projectId: 'cli-project',
                mergeRequestId: 'cli-mr',
                customModel: 'cli-model',
                organizationId: 'cli-org',
            },
            {
                GITLAB_API_URL: 'https://env.gitlab.example/api/v4',
                GITLAB_ACCESS_TOKEN: 'env-gitlab-secret',
                GITLAB_PROJECT_ID: 'env-project',
                GITLAB_MERGE_REQUEST_ID: 'env-mr',
                OPENAI_API_URL: 'https://env.openai.example/v1',
                OPENAI_API_KEY: 'env-openai-secret',
                OPENAI_MODEL: 'env-model',
                OPENAI_ORGANIZATION_ID: 'env-org',
            },
        );

        expect(config).toMatchObject({
            gitlabApiUrl: 'https://env.gitlab.example/api/v4',
            gitlabAccessToken: 'env-gitlab-secret',
            projectId: 'env-project',
            mergeRequestId: 'env-mr',
            providerApiUrl: 'https://env.openai.example/v1',
            providerAccessToken: 'env-openai-secret',
            customModel: 'env-model',
            organizationId: 'env-org',
        });
    });

    it('uses Gemini-specific environment credentials before shared compatibility aliases', () => {
        const config = resolveReviewConfig(
            {
                mode: 'gemini',
                openaiApiUrl: 'https://cli.example/v1',
                openaiAccessToken: 'cli-secret',
                customModel: 'cli-model',
            },
            {
                GEMINI_API_URL: 'https://gemini.example',
                GEMINI_API_KEY: 'gemini-secret',
                GEMINI_MODEL: 'gemini-model',
                OPENAI_API_URL: 'https://shared.example/v1',
                OPENAI_API_KEY: 'shared-secret',
                OPENAI_MODEL: 'shared-model',
            },
        );

        expect(config.providerApiUrl).toBe('https://gemini.example');
        expect(config.providerAccessToken).toBe('gemini-secret');
        expect(config.customModel).toBe('gemini-model');
    });

    it('retains legacy flags when environment variables are absent', () => {
        const config = resolveReviewConfig(
            {
                gitlabAccessToken: 'legacy-gitlab-secret',
                openaiAccessToken: 'legacy-provider-secret',
                customModel: 'legacy-model',
            },
            {},
        );

        expect(config.gitlabAccessToken).toBe('legacy-gitlab-secret');
        expect(config.providerAccessToken).toBe('legacy-provider-secret');
        expect(config.customModel).toBe('legacy-model');
        expect(config.gitlabApiUrl).toBe(DEFAULT_GITLAB_API_URL);
        expect(config.providerApiUrl).toBe(DEFAULT_OPENAI_API_URL);
        expect(resolveReviewConfig({}, {}).customModel).toBe(DEFAULT_OPENAI_MODEL);
    });

    it('ignores blank environment values and falls back to flags or safe defaults', () => {
        const config = resolveReviewConfig(
            {
                gitlabApiUrl: 'https://cli.gitlab.example/api/v4',
                openaiApiUrl: 'https://cli.openai.example/v1',
                customModel: 'cli-model',
            },
            {
                GITLAB_API_URL: '   ',
                OPENAI_API_URL: '',
                OPENAI_MODEL: '  ',
            },
        );

        expect(config.gitlabApiUrl).toBe('https://cli.gitlab.example/api/v4');
        expect(config.providerApiUrl).toBe('https://cli.openai.example/v1');
        expect(config.customModel).toBe('cli-model');
        expect(config.providerAccessToken).toBe('');
    });

    it('warns when deprecated secret flags are used without echoing their values', () => {
        const messages: string[] = [];
        const gitlabSecret = 'legacy-gitlab-secret';
        const providerSecret = 'legacy-provider-secret';

        warnAboutLegacySecretFlags(
            ['node', 'review-code-ai', '-t', gitlabSecret, '--openai-access-token=' + providerSecret],
            (message) => messages.push(message),
        );

        expect(messages).toHaveLength(2);
        expect(messages.join('\n')).toContain('deprecated');
        expect(messages.join('\n')).not.toContain(gitlabSecret);
        expect(messages.join('\n')).not.toContain(providerSecret);
    });

    it('redacts credentials from unexpected error text', () => {
        const redacted = redactSensitiveText(
            'Authorization: Bearer bearer-secret; key=provider-secret; glpat-gitlab-secret',
        );

        expect(redacted).not.toContain('bearer-secret');
        expect(redacted).not.toContain('provider-secret');
        expect(redacted).not.toContain('glpat-gitlab-secret');
        expect(redacted).toContain('[REDACTED]');

        const customFormat = redactSensitiveText('provider failure: legacy-provider-secret', ['legacy-provider-secret']);
        expect(customFormat).toBe('provider failure: [REDACTED]');
    });
});
