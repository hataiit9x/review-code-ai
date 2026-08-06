/** Maximum number of orchestration-level retries for a rate-limited diff block. */
export const MAX_RATE_LIMIT_RETRIES = 3;

export const getNextRateLimitRetry = (retryCount: number): number | undefined => {
    if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount >= MAX_RATE_LIMIT_RETRIES) {
        return undefined;
    }

    return retryCount + 1;
};
