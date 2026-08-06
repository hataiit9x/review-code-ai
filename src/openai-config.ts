/**
 * OpenAI provider defaults. Override the model with --custom-model when needed.
 * GPT-5.6 Terra is the balanced, non-experimental default for code review.
 */
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra';

/** Maximum time allowed for each OpenAI request attempt; retries are bounded separately. */
export const OPENAI_REQUEST_TIMEOUT_MS = 30_000;

/** Maximum number of SDK-managed retries for transient failures. */
export const OPENAI_MAX_RETRIES = 3;
