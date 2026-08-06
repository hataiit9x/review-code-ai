import { describe, expect, it } from 'vitest';
import { MAX_REVIEW_COMMENT_CHARS, normalizeReviewComment } from '../src/review-output';

describe('provider output boundary', () => {
    it('keeps normal text and removes the legacy no-comment sentinel', () => {
        expect(normalizeReviewComment('  Use a safer implementation.  ')).toBe('Use a safer implementation.');
        expect(normalizeReviewComment('666')).toBe('');
        expect(normalizeReviewComment('   ')).toBe('');
        expect(normalizeReviewComment({ text: 'not a string' })).toBe('');
    });

    it('rejects unbounded generated comments before GitLab posting', () => {
        expect(normalizeReviewComment('x'.repeat(MAX_REVIEW_COMMENT_CHARS + 1))).toBe('');
    });
});
