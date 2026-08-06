/** Keep generated GitLab comments within a bounded, reviewable size. */
export const MAX_REVIEW_COMMENT_CHARS = 20_000;

/**
 * Normalize provider output before it can become a GitLab comment. Empty
 * output, the legacy no-comment sentinel, and unbounded output are rejected.
 */
export const normalizeReviewComment = (value: unknown): string => {
    if (typeof value !== 'string') {
        return '';
    }

    const normalized = value.trim();
    if (!normalized || normalized === '666' || normalized.length > MAX_REVIEW_COMMENT_CHARS) {
        return '';
    }

    return normalized;
};
