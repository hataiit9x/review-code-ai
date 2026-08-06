/** Maximum time allowed for each Gemini request attempt. */
export const GEMINI_REQUEST_TIMEOUT_MS = 30_000;

/** Maximum number of provider-managed retries for transient failures. */
export const GEMINI_MAX_RETRIES = 3;

/** Initial delay for Gemini transient-failure retries. */
export const GEMINI_RETRY_BASE_DELAY_MS = 250;

/** Upper bound for Gemini retry delays, including Retry-After values. */
export const GEMINI_MAX_RETRY_DELAY_MS = 60_000;
