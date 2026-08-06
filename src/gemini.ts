import axios, { AxiosInstance } from 'axios';
import { DEFAULT_GEMINI_MODEL, GEMINI_SAFETY_SETTINGS, getReviewPrompts } from './prompts';
import { IAIClient, ReviewRequest, ReviewResult } from './types';

export class GeminiProviderError extends Error {
    readonly response: { status: number } | undefined;

    constructor(message: string, status?: number) {
        super(message);
        this.name = 'GeminiProviderError';
        this.response = typeof status === 'number' ? { status } : undefined;
    }
}

export class Gemini implements IAIClient {
    private readonly apiClient: AxiosInstance;
    private readonly model: string;
    private readonly apiKey: string;

    constructor(apiUrl: string, accessToken: string, customModel?: string) {
        if (!apiUrl?.trim()) {
            throw new GeminiProviderError('Gemini API URL is required.');
        }

        if (!accessToken?.trim()) {
            throw new GeminiProviderError('Gemini access token is required.');
        }

        this.apiKey = accessToken;
        this.model = customModel || DEFAULT_GEMINI_MODEL;

        if (!this.model.trim()) {
            throw new GeminiProviderError('Gemini model is required.');
        }

        this.apiClient = axios.create({
            baseURL: `${apiUrl}/v1beta/models`,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    }

    async review(request: ReviewRequest): Promise<ReviewResult> {
        try {
            const prompts = getReviewPrompts(request);
            const response = await this.apiClient.post(
                `/${this.model}:generateContent?key=${this.apiKey}`,
                {
                    contents: [
                        {
                            role: 'user',
                            parts: [{ text: prompts.input }],
                        },
                    ],
                    systemInstruction: {
                        parts: [
                            { text: prompts.system },
                            { text: prompts.instructions },
                        ],
                    },
                    safetySettings: GEMINI_SAFETY_SETTINGS,
                },
            );

            if (response.status < 200 || response.status >= 300) {
                throw new GeminiProviderError(`Gemini API request failed with status ${response.status}.`, response.status);
            }

            return {
                provider: 'gemini',
                model: this.model,
                text: this.getResponseText(response.data),
            };
        } catch (error: unknown) {
            if (error instanceof GeminiProviderError) {
                throw error;
            }

            throw this.toUserFacingError(error);
        }
    }

    async reviewCodeChange(diff: string): Promise<string> {
        const result = await this.review({ diff });
        return result.text;
    }

    private getResponseText(response: unknown): string {
        if (!isRecord(response) || !Array.isArray(response.candidates)) {
            throw new GeminiProviderError('Gemini returned an invalid response.');
        }

        const firstCandidate = response.candidates[0];
        if (!isRecord(firstCandidate) || !isRecord(firstCandidate.content)) {
            throw new GeminiProviderError('Gemini returned an invalid response.');
        }

        const parts = firstCandidate.content.parts;
        if (!Array.isArray(parts)) {
            throw new GeminiProviderError('Gemini returned an invalid response.');
        }

        const firstPart = parts[0];
        if (!isRecord(firstPart) || typeof firstPart.text !== 'string' || firstPart.text.trim().length === 0) {
            throw new GeminiProviderError('Gemini returned no usable review text.');
        }

        return firstPart.text;
    }

    private toUserFacingError(error: unknown): GeminiProviderError {
        const status = getResponseStatus(error);
        if (typeof status === 'number') {
            return this.toApiError(status);
        }

        return new GeminiProviderError('Gemini request failed unexpectedly.');
    }

    private toApiError(status: number): GeminiProviderError {
        switch (status) {
            case 400:
                return new GeminiProviderError('Gemini rejected the request. Check the model and review input.', status);
            case 401:
            case 403:
                return new GeminiProviderError('Gemini authentication failed. Check the configured access token.', status);
            case 404:
                return new GeminiProviderError('Gemini model or API endpoint was not found. Check the API URL and model.', status);
            case 429:
                return new GeminiProviderError('Gemini rate limit reached. Try again later.', status);
            default:
                if (status >= 500) {
                    return new GeminiProviderError('Gemini service is temporarily unavailable. Try again later.', status);
                }

                return new GeminiProviderError(`Gemini request failed with HTTP ${status}.`, status);
        }
    }
}

const getResponseStatus = (error: unknown): number | undefined => {
    if (!isRecord(error) || !isRecord(error.response)) {
        return undefined;
    }

    return typeof error.response.status === 'number' ? error.response.status : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};
