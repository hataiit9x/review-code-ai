import { describe, expect, it, vi } from 'vitest';
import { OpenAI, type OpenAIProviderOptions } from '../src/openai';

type RequestSnapshot = {
    body: Record<string, unknown>;
    headers: Headers;
    url: string;
};

const responseBody = (body: Record<string, unknown>, status = 200, headers?: Record<string, string>): Response => {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json',
            ...headers,
        },
    });
};

const createFetchMock = (
    responses: Response[],
    requests: RequestSnapshot[],
): NonNullable<OpenAIProviderOptions['fetch']> => {
    return async (input, init) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
        const headers = new Headers(init?.headers);
        const url = input instanceof Request ? input.url : String(input);
        requests.push({ body, headers, url });

        const response = responses.shift();
        if (!response) {
            throw new Error('No mocked response remaining');
        }

        return response;
    };
};

describe('OpenAI provider', () => {
    it('uses the SDK Responses API with compatible URL and supported headers', async () => {
        const requests: RequestSnapshot[] = [];
        const fetch = createFetchMock([
            responseBody({
                id: 'response-1',
                status: 'completed',
                output_text: 'Review result',
            }),
        ], requests);
        const provider = new OpenAI(
            'https://compatible.example/v1',
            'synthetic-openai-key',
            'organization-1',
            'configured-model',
            { projectId: 'project-1', fetch },
        );

        await expect(provider.review({ diff: 'diff content' })).resolves.toEqual({
            provider: 'openai',
            model: 'configured-model',
            text: 'Review result',
        });

        expect(requests).toHaveLength(1);
        const request = requests[0]!;
        expect(request.url).toBe('https://compatible.example/v1/responses');
        expect(request.headers.get('authorization')).toBe('Bearer synthetic-openai-key');
        expect(request.headers.get('openai-organization')).toBe('organization-1');
        expect(request.headers.get('openai-project')).toBe('project-1');
        expect(request.body).toMatchObject({
            model: 'configured-model',
            input: 'diff content',
            stream: false,
        });
    });

    it('honors Retry-After and retries transient failures within the bound', async () => {
        const requests: RequestSnapshot[] = [];
        const fetch = createFetchMock([
            responseBody({ error: { message: 'rate-limit details must not escape' } }, 429, { 'retry-after-ms': '1' }),
            responseBody({
                id: 'response-2',
                status: 'completed',
                output_text: 'Recovered review',
            }),
        ], requests);
        const provider = new OpenAI(
            'https://compatible.example/v1',
            'synthetic-openai-key',
            undefined,
            undefined,
            { fetch, maxRetries: 1 },
        );

        vi.useFakeTimers();
        const timerSpy = vi.spyOn(globalThis, 'setTimeout');
        try {
            const review = provider.reviewCodeChange('sensitive diff content');
            await vi.runAllTimersAsync();

            await expect(review).resolves.toBe('Recovered review');
            expect(timerSpy.mock.calls.some((call) => call[1] === 1)).toBe(true);
        } finally {
            timerSpy.mockRestore();
            vi.useRealTimers();
        }

        expect(requests).toHaveLength(2);
    });

    it('returns redacted user-facing errors for exhausted failures', async () => {
        const requests: RequestSnapshot[] = [];
        const fetch = createFetchMock([
            responseBody({ error: { message: 'secret diff and synthetic-openai-key' } }, 500),
            responseBody({ error: { message: 'secret diff and synthetic-openai-key' } }, 500),
        ], requests);
        const provider = new OpenAI(
            'https://compatible.example/v1',
            'synthetic-openai-key',
            undefined,
            undefined,
            { fetch, maxRetries: 1 },
        );

        vi.useFakeTimers();
        try {
            const review = provider.reviewCodeChange('secret diff content').catch((reason: unknown) => reason);
            await vi.runAllTimersAsync();

            const error = await review;
            expect(error).toBeInstanceOf(Error);
            if (!(error instanceof Error)) {
                throw new Error('Expected an Error from the provider');
            }

            expect(error.message).toBe('OpenAI service is temporarily unavailable after bounded retries.');
            expect(error.message).not.toContain('synthetic-openai-key');
            expect(error.message).not.toContain('secret diff content');
        } finally {
            vi.useRealTimers();
        }

        expect(requests).toHaveLength(2);
    });

    it('rejects malformed or empty model responses', async () => {
        const requests: RequestSnapshot[] = [];
        const fetch = createFetchMock([
            responseBody({
                id: 'response-3',
                status: 'completed',
                output_text: '   ',
            }),
        ], requests);
        const provider = new OpenAI('https://compatible.example/v1', 'synthetic-openai-key', undefined, undefined, { fetch });

        await expect(provider.reviewCodeChange('diff content')).rejects.toThrow('OpenAI returned no usable review text.');
    });
});
