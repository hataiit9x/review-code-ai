import axios, { type AxiosInstance } from 'axios';
import { validateApiBaseUrl } from './api-url';
import {
    GEMINI_MAX_RETRIES,
    GEMINI_MAX_RETRY_DELAY_MS,
    GEMINI_REQUEST_TIMEOUT_MS,
    GEMINI_RETRY_BASE_DELAY_MS,
} from './gemini-config';
import { DEFAULT_GEMINI_MODEL, GEMINI_SAFETY_SETTINGS, getReviewPrompts } from './prompts';
import { delay } from './utils';
import type { IAIClient, ReviewRequest, ReviewResult } from './types';

export interface GeminiProviderOptions {
    /** Override the request timeout for tests or a deployment with different limits. */
    timeoutMs?: number;
    /** Lower the bounded provider retry count for a specific deployment or test. */
    maxRetries?: number;
    /** Override the initial retry delay for tests or an explicitly different deployment. */
    retryBaseDelayMs?: number;
    /** Inject a sleep implementation for unit tests. */
    sleep?: (milliseconds: number) => Promise<void>;
    /** Permit explicitly trusted private/self-hosted endpoints. */
    allowPrivateApiUrls?: boolean;
}

export class GeminiProviderError extends Error {
    readonly response: { status: number } | undefined;
    readonly retryAfterMs: number | undefined;
    readonly retryable: boolean;

    constructor(message: string, status?: number, retryAfterMs?: number, retryable = false) {
        super(message);
        this.name = 'GeminiProviderError';
        this.response = typeof status === 'number' ? { status } : undefined;
        this.retryAfterMs = retryAfterMs;
        this.retryable = retryable;
    }
}

export class Gemini implements IAIClient {
    private readonly apiClient: AxiosInstance;
    private readonly model: string;
    private readonly timeoutMs: number;
    private readonly maxRetries: number;
    private readonly retryBaseDelayMs: number;
    private readonly sleep: (milliseconds: number) => Promise<void>;

    constructor(
        apiUrl: string,
        accessToken: string,
        customModel?: string,
        options: GeminiProviderOptions = {},
    ) {
        if (!apiUrl?.trim()) {
            throw new GeminiProviderError('Gemini API URL is required.');
        }

        if (!accessToken?.trim()) {
            throw new GeminiProviderError('Gemini access token is required.');
        }

        let baseURL: string;
        try {
            baseURL = validateApiBaseUrl(
                apiUrl,
                'Gemini API',
                { allowPrivateHosts: options.allowPrivateApiUrls === true },
            );
        } catch (error: unknown) {
            throw new GeminiProviderError(error instanceof Error ? error.message : 'Gemini API URL is invalid.');
        }

        this.model = customModel?.trim() || DEFAULT_GEMINI_MODEL;

        if (!this.model.trim()) {
            throw new GeminiProviderError('Gemini model is required.');
        }

        this.timeoutMs = validatePositiveInteger(options.timeoutMs ?? GEMINI_REQUEST_TIMEOUT_MS, 'timeout');
        this.maxRetries = normalizeRetryCount(options.maxRetries);
        this.retryBaseDelayMs = validateNonNegativeInteger(
            options.retryBaseDelayMs ?? GEMINI_RETRY_BASE_DELAY_MS,
            'retry delay',
        );
        this.sleep = options.sleep ?? delay;
        this.apiClient = axios.create({
            baseURL: `${baseURL}/v1beta/models`,
            timeout: this.timeoutMs,
            maxContentLength: 10 * 1024 * 1024,
            maxBodyLength: 10 * 1024 * 1024,
            maxRedirects: 0,
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': accessToken.trim(),
            },
        });
    }

    async review(request: ReviewRequest): Promise<ReviewResult> {
        const prompts = getReviewPrompts(request);
        for (let attempt = 0; ; attempt += 1) {
            try {
                const response = await this.apiClient.post<unknown>(
                    `/${this.model}:generateContent`,
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
                    throw this.toApiError(response.status, getRetryAfterMs(response.headers));
                }

                return {
                    provider: 'gemini',
                    model: this.model,
                    text: this.getResponseText(response.data),
                };
            } catch (error: unknown) {
                const mappedError = error instanceof GeminiProviderError
                    ? error
                    : this.toUserFacingError(error);
                if (!mappedError.retryable || attempt >= this.maxRetries) {
                    throw mappedError;
                }

                await this.sleep(this.getRetryDelay(mappedError, attempt));
            }
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

    private getRetryDelay(error: GeminiProviderError, attempt: number): number {
        if (error.retryAfterMs !== undefined) {
            return error.retryAfterMs;
        }

        return Math.min(GEMINI_MAX_RETRY_DELAY_MS, this.retryBaseDelayMs * (2 ** attempt));
    }

    private toUserFacingError(error: unknown): GeminiProviderError {
        const status = getResponseStatus(error);
        const retryAfterMs = getRetryAfterMs(getResponseHeaders(error));
        const code = getString(isRecord(error) ? error.code : undefined);
        const isTimeout = code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ERR_CANCELED';
        const isNetworkFailure = code === 'ERR_NETWORK' || code === 'ENOTFOUND' || code === 'ECONNRESET' ||
            code === 'ECONNREFUSED' || code === 'EAI_AGAIN' || code === 'EPIPE';

        if (isTimeout) {
            return new GeminiProviderError(
                `Gemini request timed out after ${this.timeoutMs / 1000} seconds.`,
                undefined,
                retryAfterMs,
                true,
            );
        }

        if (typeof status === 'number') {
            return this.toApiError(status, retryAfterMs);
        }

        if (isNetworkFailure) {
            return new GeminiProviderError(
                'Gemini could not connect to the configured API endpoint.',
                undefined,
                retryAfterMs,
                true,
            );
        }

        return new GeminiProviderError('Gemini request failed unexpectedly.');
    }

    private toApiError(status: number, retryAfterMs?: number): GeminiProviderError {
        const retryable = isTransientStatus(status);
        switch (status) {
            case 400:
                return new GeminiProviderError('Gemini rejected the request. Check the model and review input.', status);
            case 401:
            case 403:
                return new GeminiProviderError('Gemini authentication failed. Check the configured access token.', status);
            case 404:
                return new GeminiProviderError('Gemini model or API endpoint was not found. Check the API URL and model.', status);
            case 429:
                return new GeminiProviderError('Gemini rate limit reached. Try again later.', status, retryAfterMs, true);
            default:
                if (status >= 500) {
                    return new GeminiProviderError(
                        'Gemini service is temporarily unavailable. Try again later.',
                        status,
                        retryAfterMs,
                        true,
                    );
                }

                return new GeminiProviderError(
                    `Gemini request failed with HTTP ${status}.`,
                    status,
                    retryAfterMs,
                    retryable,
                );
        }
    }
}

const isTransientStatus = (status: number): boolean => {
    return status === 408 || status === 425 || status === 429 || status >= 500;
};

const getResponseStatus = (error: unknown): number | undefined => {
    if (!isRecord(error) || !isRecord(error.response)) {
        return undefined;
    }

    return typeof error.response.status === 'number' ? error.response.status : undefined;
};

const getResponseHeaders = (error: unknown): unknown => {
    return isRecord(error) && isRecord(error.response) ? error.response.headers : undefined;
};

const getRetryAfterMs = (headers: unknown): number | undefined => {
    const milliseconds = getHeader(headers, 'retry-after-ms');
    if (milliseconds !== undefined && /^\d+(?:\.\d+)?$/.test(milliseconds)) {
        return Math.min(GEMINI_MAX_RETRY_DELAY_MS, Math.max(0, Number(milliseconds)));
    }

    const retryAfter = getHeader(headers, 'retry-after');
    if (retryAfter !== undefined && /^\d+(?:\.\d+)?$/.test(retryAfter)) {
        return Math.min(GEMINI_MAX_RETRY_DELAY_MS, Math.max(0, Number(retryAfter) * 1000));
    }

    if (retryAfter !== undefined) {
        const retryAt = Date.parse(retryAfter);
        if (!Number.isNaN(retryAt)) {
            return Math.min(GEMINI_MAX_RETRY_DELAY_MS, Math.max(0, retryAt - Date.now()));
        }
    }

    return undefined;
};

const getHeader = (headers: unknown, name: string): string | undefined => {
    if (!isRecord(headers)) {
        return undefined;
    }

    const getter = headers.get as ((headerName: string) => unknown) | undefined;
    if (getter) {
        const value = getter.call(headers, name);
        return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
    }

    const value = headers[name] ?? headers[name.toLowerCase()];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
};

const getString = (value: unknown): string | undefined => {
    return typeof value === 'string' ? value : undefined;
};

const normalizeRetryCount = (value: number | undefined): number => {
    const requestedRetries = value ?? GEMINI_MAX_RETRIES;
    if (!Number.isFinite(requestedRetries)) {
        throw new GeminiProviderError('Gemini retry count must be a finite number.');
    }

    return Math.min(Math.max(Math.floor(requestedRetries), 0), GEMINI_MAX_RETRIES);
};

const validatePositiveInteger = (value: number, label: string): number => {
    if (!Number.isInteger(value) || value <= 0) {
        throw new GeminiProviderError(`Gemini ${label} must be a positive integer.`);
    }

    return value;
};

const validateNonNegativeInteger = (value: number, label: string): number => {
    if (!Number.isInteger(value) || value < 0) {
        throw new GeminiProviderError(`Gemini ${label} must be a non-negative integer.`);
    }

    return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};
