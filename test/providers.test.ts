import axios, { type AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { parseReviewProfile } from '../src/cli';
import { Gemini, GeminiProviderError } from '../src/gemini';
import { GEMINI_REQUEST_TIMEOUT_MS } from '../src/gemini-config';
import { OpenAI, OpenAIProviderError } from '../src/openai';
import { createAIProvider } from '../src/provider-factory';

describe('provider selection', () => {
    it('selects Gemini for the gemini mode', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            const provider = createAIProvider(
                'gemini',
                'https://generativelanguage.example',
                'synthetic-gemini-key',
                undefined,
                'configured-gemini-model',
            );

            expect(provider).toBeInstanceOf(Gemini);
            expect(log).toHaveBeenCalledWith('Creating Gemini client...');
        } finally {
            log.mockRestore();
        }
    });

    it('keeps OpenAI as the fallback for other modes', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            const provider = createAIProvider(
                'openai',
                'https://openai.example/v1',
                'synthetic-openai-key',
                'organization-1',
                'configured-openai-model',
            );

            expect(provider).toBeInstanceOf(OpenAI);
            expect(log).toHaveBeenCalledWith('Creating OpenAI client...');
        } finally {
            log.mockRestore();
        }
    });

    it('preserves the OpenAI fallback for unknown modes', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

        try {
            expect(createAIProvider('legacy-mode', 'https://openai.example/v1', 'synthetic-openai-key'))
                .toBeInstanceOf(OpenAI);
        } finally {
            log.mockRestore();
        }
    });
});

describe('review profile parsing', () => {
    it('defaults an omitted profile to standard and accepts security', () => {
        expect(parseReviewProfile(undefined)).toBe('standard');
        expect(parseReviewProfile('security')).toBe('security');
        expect(parseReviewProfile('wordpress-security')).toBe('wordpress-security');
    });

    it('rejects unsupported profiles', () => {
        expect(() => parseReviewProfile('offensive')).toThrow(
            'Review profile must be "standard", "security", or "wordpress-security".',
        );
    });
});

describe('provider configuration validation', () => {
    it('rejects an incomplete OpenAI configuration with a provider error', () => {
        expect(() => new OpenAI('', 'synthetic-openai-key')).toThrow(OpenAIProviderError);
        expect(() => new OpenAI('', 'synthetic-openai-key')).toThrow('OpenAI API URL is required.');
        expect(() => new OpenAI('https://openai.example/v1', '')).toThrow('OpenAI access token is required.');
        expect(() => new OpenAI('http://127.0.0.1:8080/v1', 'synthetic-openai-key'))
            .toThrow('local or private host');
    });

    it('rejects an incomplete Gemini configuration with a provider error', () => {
        expect(() => new Gemini('', 'synthetic-gemini-key')).toThrow(GeminiProviderError);
        expect(() => new Gemini('', 'synthetic-gemini-key')).toThrow('Gemini API URL is required.');
        expect(() => new Gemini('https://generativelanguage.example', '')).toThrow('Gemini access token is required.');
        expect(() => new Gemini('http://127.0.0.1:8080', 'synthetic-gemini-key'))
            .toThrow('local or private host');
    });
});

describe('Gemini provider boundary', () => {
    it('normalizes a valid Gemini response into the common result type', async () => {
        const post = vi.fn().mockResolvedValue({
            status: 200,
            data: {
                candidates: [{
                    content: {
                        parts: [{ text: 'Gemini review' }],
                    },
                }],
            },
        });
        const create = vi.spyOn(axios, 'create').mockReturnValue({ post } as unknown as AxiosInstance);

        try {
        const provider = new Gemini(
                'https://generativelanguage.example',
                'synthetic-gemini-key',
            'configured-gemini-model',
        );

        await expect(provider.review({ diff: 'diff content' })).resolves.toEqual({
                provider: 'gemini',
                model: 'configured-gemini-model',
            text: 'Gemini review',
        });
        expect(create).toHaveBeenCalledWith(expect.objectContaining({
            baseURL: 'https://generativelanguage.example/v1beta/models',
            timeout: GEMINI_REQUEST_TIMEOUT_MS,
            maxRedirects: 0,
            headers: expect.objectContaining({
                'x-goog-api-key': 'synthetic-gemini-key',
            }),
        }));
        expect(post.mock.calls[0]?.[0]).toBe('/configured-gemini-model:generateContent');
        expect(post.mock.calls[0]?.[0]).not.toContain('synthetic-gemini-key');
    } finally {
            create.mockRestore();
        }
    });

    it('maps Gemini HTTP failures without exposing request details', async () => {
        const post = vi.fn().mockRejectedValue({
            message: 'secret diff and synthetic-gemini-key',
            response: { status: 429 },
        });
        const create = vi.spyOn(axios, 'create').mockReturnValue({ post } as unknown as AxiosInstance);

        try {
            const provider = new Gemini(
                'https://generativelanguage.example',
                'synthetic-gemini-key',
                undefined,
                { maxRetries: 0 },
            );
            const caught = await provider.review({ diff: 'secret diff content' }).catch((error: unknown) => error);

            expect(caught).toBeInstanceOf(GeminiProviderError);
            if (!(caught instanceof GeminiProviderError)) {
                throw new Error('Expected a GeminiProviderError');
            }

            expect(caught.message).toBe('Gemini rate limit reached. Try again later.');
            expect(caught.message).not.toContain('synthetic-gemini-key');
            expect(caught.message).not.toContain('secret diff content');
            expect(caught.response).toEqual({ status: 429 });
        } finally {
            create.mockRestore();
        }
    });

    it('honors Retry-After and bounds transient retries', async () => {
        const post = vi.fn()
            .mockResolvedValueOnce({ status: 429, headers: { 'retry-after-ms': '7' } })
            .mockResolvedValueOnce({
                status: 200,
                data: {
                    candidates: [{ content: { parts: [{ text: 'Recovered Gemini review' }] } }],
                },
            });
        const sleep = vi.fn().mockResolvedValue(undefined);
        const create = vi.spyOn(axios, 'create').mockReturnValue({ post } as unknown as AxiosInstance);

        try {
            const provider = new Gemini(
                'https://generativelanguage.example',
                'synthetic-gemini-key',
                undefined,
                { maxRetries: 1, sleep },
            );

            await expect(provider.review({ diff: 'diff content' })).resolves.toMatchObject({
                text: 'Recovered Gemini review',
            });
            expect(sleep).toHaveBeenCalledWith(7);
            expect(post).toHaveBeenCalledTimes(2);
        } finally {
            create.mockRestore();
        }
    });
});
