import { describe, expect, it } from 'vitest';
import { createCliProgram } from '../src/cli';
import { DEFAULT_OPENAI_MODEL } from '../src/openai-config';

describe('CLI argument parsing', () => {
    it('keeps the existing defaults', () => {
        const options = createCliProgram()
            .parse(['node', 'review-code-ai'], { from: 'node' })
            .opts();

        expect(options).toMatchObject({
            gitlabApiUrl: 'https://gitlab.com/api/v4',
            openaiApiUrl: 'https://api.openai.com/v1',
            customModel: DEFAULT_OPENAI_MODEL,
            mode: 'openai',
        });
    });

    it('parses the existing long and short options', () => {
        const options = createCliProgram()
            .parse([
                'node',
                'review-code-ai',
                '--gitlab-api-url',
                'https://gitlab.example/api/v4',
                '-t',
                'gitlab-access-value',
                '--openai-api-url',
                'https://openai.example/v1',
                '-a',
                'openai-access-value',
                '--project-id',
                '42',
                '-m',
                '7',
                '--organization-id',
                '99',
                '-c',
                'test-model',
                '-mode',
                'gemini',
            ], { from: 'node' })
            .opts();

        expect(options).toMatchObject({
            gitlabApiUrl: 'https://gitlab.example/api/v4',
            gitlabAccessToken: 'gitlab-access-value',
            openaiApiUrl: 'https://openai.example/v1',
            openaiAccessToken: 'openai-access-value',
            projectId: '42',
            mergeRequestId: '7',
            organizationId: '99',
            customModel: 'test-model',
            mode: 'gemini',
        });
    });

    it('keeps the existing public option definitions', () => {
        expect(createCliProgram().options.map((option) => option.flags)).toEqual([
            '-g, --gitlab-api-url <string>',
            '-t, --gitlab-access-token <string>',
            '-o, --openai-api-url <string>',
            '-a, --openai-access-token <string>',
            '-p, --project-id <number>',
            '-m, --merge-request-id <string>',
            '-org, --organization-id <number>',
            '-c, --custom-model <string>',
            '-mode, --mode <string>',
        ]);
    });
});
