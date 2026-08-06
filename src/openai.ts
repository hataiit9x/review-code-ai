import OpenAISdk, {
    APIConnectionError,
    APIConnectionTimeoutError,
    APIError,
    type ClientOptions,
} from 'openai';
import { validateApiBaseUrl } from './api-url';
import { IAIClient, ReviewRequest, ReviewResult } from './types';
import { DEFAULT_OPENAI_MODEL, OPENAI_MAX_RETRIES, OPENAI_REQUEST_TIMEOUT_MS } from './openai-config';
import { getReviewPrompts } from './prompts';

export interface OpenAIProviderOptions {
    /** Optional project header supported by the OpenAI SDK. */
    projectId?: string;
    /** Override the request timeout for tests or an explicitly different deployment. */
    timeoutMs?: number;
    /** Lower the bounded SDK retry count for a specific deployment or test. */
    maxRetries?: number;
    /** Inject a mocked HTTP implementation for unit tests. */
    fetch?: ClientOptions['fetch'];
    /** Permit explicitly trusted private/self-hosted endpoints. */
    allowPrivateApiUrls?: boolean;
}

export class OpenAIProviderError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'OpenAIProviderError';
    }
}

export class OpenAI implements IAIClient {
    private readonly apiClient: OpenAISdk;
    private readonly accessTokens: string[];
    private accessTokenIndex = 0;
    private readonly model: string;
    private readonly timeoutMs: number;

    constructor(
        apiUrl: string,
        accessToken: string,
        orgId?: string,
        customModel?: string,
        options: OpenAIProviderOptions = {},
    ) {
        if (!apiUrl?.trim()) {
            throw new OpenAIProviderError('OpenAI API URL is required.');
        }

        let baseURL: string;
        try {
            baseURL = validateApiBaseUrl(
                apiUrl,
                'OpenAI API',
                { allowPrivateHosts: options.allowPrivateApiUrls === true },
            );
        } catch (error: unknown) {
            throw new OpenAIProviderError(error instanceof Error ? error.message : 'OpenAI API URL is invalid.');
        }

        const accessTokens = accessToken
            ?.split(',')
            .map((token) => token.trim())
            .filter((token) => token.length > 0) ?? [];

        if (accessTokens.length === 0) {
            throw new OpenAIProviderError('OpenAI access token is required.');
        }

        const timeoutMs = options.timeoutMs ?? OPENAI_REQUEST_TIMEOUT_MS;
        if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
            throw new OpenAIProviderError('OpenAI request timeout must be a positive integer.');
        }

        const maxRetries = this.normalizeRetryCount(options.maxRetries);
        const fetchImplementation = options.fetch ?? globalThis.fetch;
        this.accessTokens = accessTokens;
        this.model = customModel?.trim() || DEFAULT_OPENAI_MODEL;
        this.timeoutMs = timeoutMs;

        const clientOptions: ClientOptions = {
            apiKey: async () => this.getNextAccessToken(),
            baseURL,
            timeout: timeoutMs,
            // The SDK applies bounded exponential backoff and honors Retry-After headers.
            maxRetries,
            ...(orgId?.trim() ? { organization: orgId.trim() } : {}),
            ...(options.projectId?.trim() ? { project: options.projectId.trim() } : {}),
            fetch: async (input, init) => {
                if (!fetchImplementation) {
                    throw new OpenAIProviderError('OpenAI HTTP fetch is unavailable in this runtime.');
                }

                return fetchImplementation(input, {
                    ...(init ?? {}),
                    redirect: 'error',
                });
            },
        };

        this.apiClient = new OpenAISdk(clientOptions);
    }

    async review(request: ReviewRequest): Promise<ReviewResult> {
        try {
            const prompts = getReviewPrompts(request);
            const response = await this.apiClient.responses.create({
                model: this.model,
                instructions: `${prompts.system}\n\n${prompts.instructions}`,
                input: prompts.input,
                stream: false,
            });

            return {
                provider: 'openai',
                model: this.model,
                text: this.getResponseText(response),
            };
        } catch (error: unknown) {
            if (error instanceof OpenAIProviderError) {
                throw error;
            }

            throw this.toUserFacingError(error);
        }
    }

    async reviewCodeChange(diff: string): Promise<string> {
        const result = await this.review({ diff });
        return result.text;
    }

    private getNextAccessToken(): string {
        const token = this.accessTokens[this.accessTokenIndex]!;
        this.accessTokenIndex = (this.accessTokenIndex + 1) % this.accessTokens.length;
        return token;
    }

    private normalizeRetryCount(maxRetries: number | undefined): number {
        const requestedRetries = maxRetries ?? OPENAI_MAX_RETRIES;

        if (!Number.isFinite(requestedRetries)) {
            throw new OpenAIProviderError('OpenAI retry count must be a finite number.');
        }

        return Math.min(Math.max(Math.floor(requestedRetries), 0), OPENAI_MAX_RETRIES);
    }

    private getResponseText(response: unknown): string {
        if (!isRecord(response)) {
            throw new OpenAIProviderError('OpenAI returned an invalid response.');
        }

        const status = response.status;
        const outputText = response.output_text;

        if (status !== 'completed') {
            const responseStatus = typeof status === 'string' ? status : 'unknown';
            throw new OpenAIProviderError(`OpenAI returned a non-completed response (${responseStatus}).`);
        }

        if (typeof outputText !== 'string' || outputText.trim().length === 0) {
            throw new OpenAIProviderError('OpenAI returned no usable review text.');
        }

        return outputText;
    }

    private toUserFacingError(error: unknown): OpenAIProviderError {
        if (error instanceof APIConnectionTimeoutError) {
            return new OpenAIProviderError(
                `OpenAI request timed out after ${this.timeoutMs / 1000} seconds.`,
            );
        }

        if (error instanceof APIConnectionError) {
            return new OpenAIProviderError('OpenAI could not connect to the configured API endpoint.');
        }

        if (error instanceof APIError) {
            return this.toApiError(error.status);
        }

        return new OpenAIProviderError('OpenAI request failed unexpectedly.');
    }

    private toApiError(status: number | undefined): OpenAIProviderError {
        switch (status) {
            case 401:
                return new OpenAIProviderError('OpenAI authentication failed. Check the configured access token.');
            case 403:
                return new OpenAIProviderError(
                    'OpenAI access was denied. Check organization, project, and model permissions.',
                );
            case 404:
                return new OpenAIProviderError('OpenAI endpoint or model was not found. Check the API URL and model.');
            case 408:
            case 409:
                return new OpenAIProviderError('OpenAI request did not complete after bounded retries.');
            case 429:
                return new OpenAIProviderError('OpenAI rate limit reached after bounded retries. Try again later.');
            default:
                if (typeof status === 'number' && status >= 500) {
                    return new OpenAIProviderError('OpenAI service is temporarily unavailable after bounded retries.');
                }

                return new OpenAIProviderError(
                    typeof status === 'number' ? `OpenAI request failed with HTTP ${status}.` : 'OpenAI request failed.',
                );
        }
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};
