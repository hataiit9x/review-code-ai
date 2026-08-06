import { describe, expect, it } from 'vitest';
import { getNextRateLimitRetry, MAX_RATE_LIMIT_RETRIES } from '../src/retry';

describe('orchestration rate-limit retry bound', () => {
    it('allows only the configured finite retry sequence', () => {
        expect(getNextRateLimitRetry(0)).toBe(1);
        expect(getNextRateLimitRetry(MAX_RATE_LIMIT_RETRIES - 1)).toBe(MAX_RATE_LIMIT_RETRIES);
        expect(getNextRateLimitRetry(MAX_RATE_LIMIT_RETRIES)).toBeUndefined();
        expect(getNextRateLimitRetry(-1)).toBeUndefined();
    });
});
