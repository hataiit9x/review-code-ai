/**
 * The provider-independent input for a code review.
 */
export interface ReviewRequest {
    diff: string;
    profile?: ReviewProfile;
    filePath?: string;
    line?: number;
}

export type ReviewProfile = 'standard' | 'security' | 'wordpress-security';

export type AIProviderName = 'openai' | 'gemini';

/**
 * The normalized result returned by every AI provider.
 */
export interface ReviewResult {
    provider: AIProviderName;
    model: string;
    text: string;
}

/**
 * Small common provider contract used by the review orchestration code.
 */
export interface IAIProvider {
    review(request: ReviewRequest): Promise<ReviewResult>;
}

/**
 * Backward-compatible client contract for callers that still expect a text
 * response from reviewCodeChange.
 */
export interface IAIClient extends IAIProvider {
    reviewCodeChange(diff: string): Promise<string>;
}

/**
 * GitLab configuration
 */
export interface IGitLabConfig {
    gitlabApiUrl: string;
    gitlabAccessToken: string;
    projectId: string;
    mergeRequestId: string;
}

/**
 * Merge Request information from GitLab API
 */
export interface IMergeRequestInfo {
    source_branch: string;
    diff_refs: {
        base_sha: string;
        head_sha: string;
        start_sha: string;
    };
}

/**
 * Diff change from GitLab API
 */
export interface IDiffChange {
    diff: string;
    new_path: string;
    old_path: string;
    renamed_file: boolean;
    deleted_file: boolean;
    old_line?: number;
    new_line?: number;
}

/**
 * Line position for MR comments
 */
export interface ILinePosition {
    new_line?: number;
    old_line?: number;
}
