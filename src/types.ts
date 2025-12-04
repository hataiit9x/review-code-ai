/**
 * Common interface for AI clients (OpenAI, Gemini, etc.)
 */
export interface IAIClient {
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
