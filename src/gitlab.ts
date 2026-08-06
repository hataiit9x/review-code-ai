import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { validateApiBaseUrl } from './api-url';
import { delay } from './utils';
import type { DiffChangeKind, IDiffChange, IGitLabConfig, ILinePosition, IMergeRequestInfo } from './types';

export const GITLAB_PAGE_SIZE = 100;
export const MAX_DIFF_CHARS = 100_000;
export const MAX_GITLAB_RESPONSE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_DIFF_CHARS = 10_000_000;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 60_000;
const MAX_PAGES = 1_000;
const TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

type GitLabHttpMethod = 'get' | 'post';

interface GitLabDiscussionPosition {
    position_type: 'text';
    new_path: string;
    old_path: string;
    new_line?: number;
    old_line?: number;
    base_sha: string;
    start_sha: string;
    head_sha: string;
}

export class GitLabIntegrationError extends Error {
    readonly status: number | undefined;
    readonly response: { status: number } | undefined;
    readonly retryAfterMs: number | undefined;
    readonly retryable: boolean;

    constructor(
        message: string,
        status?: number,
        retryAfterMs?: number,
        retryable = false,
    ) {
        super(message);
        this.name = 'GitLabIntegrationError';
        this.status = status;
        this.response = typeof status === 'number' ? { status } : undefined;
        this.retryAfterMs = retryAfterMs;
        this.retryable = retryable;
    }
}

export class GitLab {
    private readonly apiClient: AxiosInstance;
    private readonly projectId: string;
    private readonly mrId: string;
    private readonly timeoutMs: number;
    private readonly maxRetries: number;
    private readonly retryBaseDelayMs: number;
    private readonly commentKeys = new Set<string>();
    private mergeRequestInfo?: IMergeRequestInfo;
    private discussionsLoaded = false;

    constructor(config: IGitLabConfig) {
        if (!config.gitlabApiUrl?.trim()) {
            throw new GitLabIntegrationError('GitLab API URL must be an HTTP(S) URL.');
        }

        let gitlabApiUrl: string;
        try {
            gitlabApiUrl = validateApiBaseUrl(
                config.gitlabApiUrl,
                'GitLab API',
                { allowPrivateHosts: config.allowPrivateApiUrls === true },
            );
        } catch (error: unknown) {
            throw new GitLabIntegrationError(error instanceof Error ? error.message : 'GitLab API URL is invalid.');
        }

        const accessToken = config.gitlabAccessToken?.trim();
        const projectId = config.projectId?.trim();
        const mergeRequestId = config.mergeRequestId?.trim();

        if (!accessToken) {
            throw new GitLabIntegrationError('GitLab access token is required.');
        }

        if (!projectId) {
            throw new GitLabIntegrationError('GitLab project ID is required.');
        }

        if (!mergeRequestId) {
            throw new GitLabIntegrationError('GitLab merge request ID is required.');
        }

        this.timeoutMs = validatePositiveInteger(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeout');
        this.maxRetries = Math.min(
            validateNonNegativeInteger(config.maxRetries ?? DEFAULT_MAX_RETRIES, 'retry count'),
            DEFAULT_MAX_RETRIES,
        );
        this.retryBaseDelayMs = validateNonNegativeInteger(
            config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
            'retry delay',
        );
        this.projectId = projectId;
        this.mrId = mergeRequestId;
        this.apiClient = axios.create({
            baseURL: gitlabApiUrl,
            timeout: this.timeoutMs,
            maxContentLength: MAX_GITLAB_RESPONSE_BYTES,
            maxBodyLength: MAX_GITLAB_RESPONSE_BYTES,
            maxRedirects: 0,
            headers: {
                Accept: 'application/json',
                'Private-Token': accessToken,
            },
        });
    }

    async init(): Promise<void> {
        await this.getMergeRequestInfo();
        await this.loadExistingDiscussionKeys();
    }

    async getMergeRequestInfo(): Promise<void> {
        const response = await this.request<unknown>(
            () => this.apiClient.get<unknown>(this.getMergeRequestPath()),
            'get',
        );
        const info = parseMergeRequestInfo(response.data);

        if (!info) {
            throw new GitLabIntegrationError('GitLab returned an invalid merge request response.');
        }

        this.mergeRequestInfo = info;
    }

    async getMergeRequestChanges(): Promise<IDiffChange[]> {
        const changes: IDiffChange[] = [];
        let totalDiffChars = 0;
        let page = 1;

        while (true) {
            const response = await this.request<unknown>(
                () => this.apiClient.get<unknown>(this.getDiffsPath(), {
                    params: { page, per_page: GITLAB_PAGE_SIZE },
                }),
                'get',
            );
            const pageItems = getCollectionItems(response.data, 'changes');

            if (!pageItems) {
                throw new GitLabIntegrationError('GitLab returned an invalid merge request changes response.');
            }

            const normalizedItems = pageItems.map(normalizeDiffChange);
            totalDiffChars += normalizedItems.reduce((total, change) => total + change.diff.length, 0);
            if (totalDiffChars > MAX_TOTAL_DIFF_CHARS) {
                throw new GitLabIntegrationError(
                    'GitLab merge request diff content exceeds the safe review size limit.',
                );
            }

            changes.push(...normalizedItems);

            const nextPage = getNextPage(response.headers);
            if (nextPage !== undefined) {
                if (nextPage <= page) {
                    break;
                }
                page = nextPage;
            } else if (pageItems.length < GITLAB_PAGE_SIZE) {
                break;
            } else {
                page += 1;
            }

            if (page > MAX_PAGES) {
                throw new GitLabIntegrationError('GitLab pagination exceeded the safe page limit.');
            }
        }

        return changes;
    }

    async getFileContent(filePath: string): Promise<string> {
        const encodedPath = encodeURIComponent(filePath);
        const response = await this.request<unknown>(
            () => this.apiClient.get<unknown>(
                `${this.getRepositoryFilesPath(encodedPath)}?ref=${encodeURIComponent(this.mergeRequestInfo?.source_branch ?? '')}`,
            ),
            'get',
        );

        return typeof response.data === 'string' ? response.data : '';
    }

    async addReviewComment(lineObj: ILinePosition, change: IDiffChange, suggestion: string): Promise<void> {
        await this.ensureDiscussionKeysLoaded();

        if (!suggestion.trim() || this.hasDuplicateComment(suggestion, change, lineObj)) {
            return;
        }

        if (!this.canPlaceInlineComment(lineObj, change)) {
            await this.postSummaryComment(change, suggestion);
            return;
        }

        try {
            await this.postDiscussion(suggestion, this.createInlinePosition(lineObj, change));
            this.rememberComment(suggestion, change, lineObj);
        } catch (error: unknown) {
            const mappedError = this.toUserFacingError(error);
            if (!isInlinePlacementError(mappedError)) {
                throw mappedError;
            }

            await this.postSummaryComment(change, suggestion);
        }
    }

    async addSummaryComment(change: IDiffChange, suggestion: string): Promise<void> {
        await this.ensureDiscussionKeysLoaded();
        await this.postSummaryComment(change, suggestion);
    }

    private async postSummaryComment(change: IDiffChange, suggestion: string): Promise<void> {
        if (!suggestion.trim() || this.hasDuplicateComment(suggestion, change)) {
            return;
        }

        await this.postDiscussion(suggestion);
        this.rememberComment(suggestion, change);
    }

    private async postDiscussion(body: string, position?: GitLabDiscussionPosition): Promise<void> {
        const payload = position ? { body, position } : { body };
        await this.request<unknown>(
            () => this.apiClient.post<unknown>(this.getDiscussionsPath(), payload),
            'post',
        );
    }

    private canPlaceInlineComment(lineObj: ILinePosition, change: IDiffChange): boolean {
        return canPlaceInlineComment(lineObj, change) && this.mergeRequestInfo !== undefined;
    }

    private createInlinePosition(lineObj: ILinePosition, change: IDiffChange): GitLabDiscussionPosition {
        if (!this.mergeRequestInfo) {
            throw new GitLabIntegrationError('GitLab merge request context is required for inline comments.');
        }

        return {
            position_type: 'text',
            new_path: change.new_path,
            old_path: change.old_path,
            ...(lineObj.new_line !== undefined ? { new_line: lineObj.new_line } : {}),
            ...(lineObj.old_line !== undefined ? { old_line: lineObj.old_line } : {}),
            ...this.mergeRequestInfo.diff_refs,
        };
    }

    private async ensureDiscussionKeysLoaded(): Promise<void> {
        if (!this.discussionsLoaded) {
            await this.loadExistingDiscussionKeys();
        }
    }

    private async loadExistingDiscussionKeys(): Promise<void> {
        let page = 1;

        while (true) {
            const response = await this.request<unknown>(
                () => this.apiClient.get<unknown>(this.getDiscussionsPath(), {
                    params: { page, per_page: GITLAB_PAGE_SIZE },
                }),
                'get',
            );
            const pageItems = getCollectionItems(response.data);

            if (!pageItems) {
                throw new GitLabIntegrationError('GitLab returned an invalid discussions response.');
            }

            pageItems.forEach((discussion) => this.rememberDiscussion(discussion));

            const nextPage = getNextPage(response.headers);
            if (nextPage !== undefined) {
                if (nextPage <= page) {
                    break;
                }
                page = nextPage;
            } else if (pageItems.length < GITLAB_PAGE_SIZE) {
                break;
            } else {
                page += 1;
            }

            if (page > MAX_PAGES) {
                throw new GitLabIntegrationError('GitLab pagination exceeded the safe page limit.');
            }
        }

        this.discussionsLoaded = true;
    }

    private rememberDiscussion(discussion: unknown): void {
        if (!isRecord(discussion)) {
            return;
        }

        const notes = Array.isArray(discussion.notes) ? discussion.notes : [discussion];
        for (const note of notes) {
            if (!isRecord(note) || note.system === true) {
                continue;
            }

            const body = getString(note.body);
            if (!body) {
                continue;
            }

            const position = isRecord(note.position) ? note.position : discussion;
            const change: IDiffChange = {
                diff: '',
                new_path: getString(position.new_path) ?? '',
                old_path: getString(position.old_path) ?? '',
                renamed_file: false,
                deleted_file: false,
            };
            const lineObj: ILinePosition = {
                ...(getPositiveInteger(position.new_line) !== undefined
                    ? { new_line: getPositiveInteger(position.new_line) }
                    : {}),
                ...(getPositiveInteger(position.old_line) !== undefined
                    ? { old_line: getPositiveInteger(position.old_line) }
                    : {}),
            };

            this.rememberComment(body, change, lineObj);
        }
    }

    private rememberComment(body: string, change: IDiffChange, lineObj?: ILinePosition): void {
        const [exactKey, contentKey] = getCommentKeys(body, change, lineObj);
        this.commentKeys.add(exactKey);
        this.commentKeys.add(contentKey);
    }

    private hasDuplicateComment(body: string, change: IDiffChange, lineObj?: ILinePosition): boolean {
        return getCommentKeys(body, change, lineObj).some((key) => this.commentKeys.has(key));
    }

    private async request<T>(
        operation: () => Promise<AxiosResponse<T>>,
        method: GitLabHttpMethod,
    ): Promise<AxiosResponse<T>> {
        for (let attempt = 0; ; attempt += 1) {
            try {
                const response = await operation();
                if (response.status < 200 || response.status >= 300) {
                    throw this.toUserFacingError({
                        response: {
                            status: response.status,
                            headers: response.headers,
                        },
                    });
                }

                return response;
            } catch (error: unknown) {
                const mappedError = this.toUserFacingError(error);
                if (!this.shouldRetry(mappedError, method, attempt)) {
                    throw mappedError;
                }

                await delay(this.getRetryDelay(mappedError, attempt));
            }
        }
    }

    private shouldRetry(error: GitLabIntegrationError, method: GitLabHttpMethod, attempt: number): boolean {
        if (attempt >= this.maxRetries || !error.retryable) {
            return false;
        }

        return method === 'get' || error.status === 429;
    }

    private getRetryDelay(error: GitLabIntegrationError, attempt: number): number {
        if (error.retryAfterMs !== undefined) {
            return error.retryAfterMs;
        }

        return Math.min(MAX_RETRY_DELAY_MS, this.retryBaseDelayMs * (2 ** attempt));
    }

    private toUserFacingError(error: unknown): GitLabIntegrationError {
        if (error instanceof GitLabIntegrationError) {
            return error;
        }

        const status = getResponseStatus(error);
        const retryAfterMs = getRetryAfterMs(getResponseHeaders(error));
        const code = getString(isRecord(error) ? error.code : undefined);
        const isTimeout = code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ERR_CANCELED';
        const isNetworkFailure = code === 'ERR_NETWORK' || code === 'ENOTFOUND' || code === 'ECONNRESET' ||
            code === 'ECONNREFUSED' || code === 'EAI_AGAIN' || code === 'EPIPE';

        if (isTimeout) {
            return new GitLabIntegrationError(
                `GitLab request timed out after ${this.timeoutMs / 1000} seconds.`,
                undefined,
                retryAfterMs,
                true,
            );
        }

        if (typeof status === 'number') {
            switch (status) {
                case 401:
                case 403:
                    return new GitLabIntegrationError(
                        'GitLab authentication or permission failure. Check the token scope and project access.',
                        status,
                        retryAfterMs,
                    );
                case 404:
                    return new GitLabIntegrationError(
                        'GitLab resource was not found. Check the project, merge request, and API URL.',
                        status,
                        retryAfterMs,
                    );
                case 429:
                    return new GitLabIntegrationError(
                        'GitLab rate limit reached. Try again later.',
                        status,
                        retryAfterMs,
                        true,
                    );
                default:
                    if (status >= 500) {
                        return new GitLabIntegrationError(
                            'GitLab service is temporarily unavailable. Try again later.',
                            status,
                            retryAfterMs,
                            true,
                        );
                    }

                    return new GitLabIntegrationError(
                        `GitLab request failed with HTTP ${status}.`,
                        status,
                        retryAfterMs,
                        TRANSIENT_STATUS_CODES.has(status),
                    );
            }
        }

        if (isNetworkFailure) {
            return new GitLabIntegrationError(
                'GitLab could not connect to the configured API endpoint.',
                undefined,
                retryAfterMs,
                true,
            );
        }

        return new GitLabIntegrationError('GitLab request failed unexpectedly.');
    }

    private getMergeRequestPath(): string {
        return `/projects/${encodeURIComponent(this.projectId)}/merge_requests/${encodeURIComponent(this.mrId)}`;
    }

    private getDiffsPath(): string {
        return `${this.getMergeRequestPath()}/diffs`;
    }

    private getDiscussionsPath(): string {
        return `${this.getMergeRequestPath()}/discussions`;
    }

    private getRepositoryFilesPath(encodedPath: string): string {
        return `/projects/${encodeURIComponent(this.projectId)}/repository/files/${encodedPath}/raw`;
    }
}

export const classifyDiffChange = (change: IDiffChange): DiffChangeKind => {
    if (change.deleted_file) {
        return 'deleted';
    }

    if (change.renamed_file) {
        return 'renamed';
    }

    if (change.binaryFile || isBinaryDiff(change.diff)) {
        return 'binary';
    }

    if (change.diffTruncated) {
        return 'truncated';
    }

    if (!/^@@\s-\d+(?:,\d+)?\s\+\d+(?:,\d+)?\s@@/m.test(change.diff)) {
        return 'unavailable';
    }

    return 'text';
};

export const canPlaceInlineComment = (lineObj: ILinePosition, change: IDiffChange): boolean => {
    const hasLine = [lineObj.new_line, lineObj.old_line].some(
        (line) => typeof line === 'number' && Number.isInteger(line) && line > 0,
    );

    return classifyDiffChange(change) === 'text' && hasLine && Boolean(change.new_path || change.old_path);
};

const normalizeDiffChange = (item: Record<string, unknown>): IDiffChange => {
    const originalDiff = getString(item.diff) ?? '';
    const truncated = truncateDiff(originalDiff);
    const binaryFile = getBoolean(item.binary_file) || getBoolean(item.binaryFile) || isBinaryDiff(originalDiff);
    const diffTruncated = truncated.truncated || getBoolean(item.too_large) || getBoolean(item.collapsed) || getBoolean(item.diff_truncated);

    return {
        ...item,
        diff: truncated.diff,
        new_path: getString(item.new_path) ?? getString(item.file_path) ?? '',
        old_path: getString(item.old_path) ?? getString(item.file_path) ?? '',
        renamed_file: getBoolean(item.renamed_file),
        deleted_file: getBoolean(item.deleted_file),
        ...(binaryFile ? { binaryFile } : {}),
        ...(getBoolean(item.generated_file) ? { generatedFile: true } : {}),
        ...(diffTruncated ? { diffTruncated: true } : {}),
    };
};

const truncateDiff = (diff: string): { diff: string; truncated: boolean } => {
    if (diff.length <= MAX_DIFF_CHARS) {
        return { diff, truncated: false };
    }

    const marker = '\n[Diff truncated by review-code-ai]';
    const contentLimit = Math.max(0, MAX_DIFF_CHARS - marker.length);
    const lastLineBreak = diff.lastIndexOf('\n', contentLimit);
    const cutoff = lastLineBreak > 0 ? lastLineBreak : contentLimit;
    return {
        diff: `${diff.slice(0, cutoff)}${marker}`,
        truncated: true,
    };
};

const isBinaryDiff = (diff: string): boolean => {
    return diff.includes('\0') || /^Binary files .* differ$/mi.test(diff);
};

const parseMergeRequestInfo = (value: unknown): IMergeRequestInfo | undefined => {
    if (!isRecord(value) || !getString(value.source_branch) || !isRecord(value.diff_refs)) {
        return undefined;
    }

    const baseSha = getString(value.diff_refs.base_sha);
    const headSha = getString(value.diff_refs.head_sha);
    const startSha = getString(value.diff_refs.start_sha);
    if (!baseSha || !headSha || !startSha) {
        return undefined;
    }

    return {
        source_branch: getString(value.source_branch)!,
        diff_refs: {
            base_sha: baseSha,
            head_sha: headSha,
            start_sha: startSha,
        },
    };
};

const getCollectionItems = (value: unknown, property?: string): Record<string, unknown>[] | undefined => {
    if (Array.isArray(value)) {
        return value.filter(isRecord);
    }

    const propertyValue = property && isRecord(value) ? value[property] : undefined;
    if (Array.isArray(propertyValue)) {
        return propertyValue.filter(isRecord);
    }

    return undefined;
};

const getNextPage = (headers: unknown): number | undefined => {
    const value = getHeader(headers, 'x-next-page');
    if (value === undefined || value.trim() === '') {
        return undefined;
    }

    const page = Number.parseInt(value, 10);
    return Number.isInteger(page) && page > 0 ? page : undefined;
};

const getResponseStatus = (error: unknown): number | undefined => {
    if (!isRecord(error) || !isRecord(error.response)) {
        return undefined;
    }

    return getPositiveInteger(error.response.status);
};

const getResponseHeaders = (error: unknown): unknown => {
    return isRecord(error) && isRecord(error.response) ? error.response.headers : undefined;
};

const getRetryAfterMs = (headers: unknown): number | undefined => {
    const milliseconds = getHeader(headers, 'retry-after-ms');
    if (milliseconds !== undefined && /^\d+(?:\.\d+)?$/.test(milliseconds)) {
        return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, Number(milliseconds)));
    }

    const retryAfter = getHeader(headers, 'retry-after');
    if (retryAfter !== undefined && /^\d+(?:\.\d+)?$/.test(retryAfter)) {
        return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, Number(retryAfter) * 1000));
    }

    if (retryAfter !== undefined) {
        const retryAt = Date.parse(retryAfter);
        if (!Number.isNaN(retryAt)) {
            return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, retryAt - Date.now()));
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

const getCommentKeys = (
    body: string,
    change: IDiffChange,
    lineObj?: ILinePosition,
): [string, string] => {
    const normalizedBody = body.trim();
    const path = change.new_path || change.old_path;
    const line = `${lineObj?.new_line ?? ''}:${lineObj?.old_line ?? ''}`;
    return [
        `exact:${normalizedBody}\u0000${path}\u0000${line}`,
        `content:${normalizedBody}\u0000${path}`,
    ];
};

const isInlinePlacementError = (error: GitLabIntegrationError): boolean => {
    return error.status === 400 || error.status === 422;
};

const getString = (value: unknown): string | undefined => {
    return typeof value === 'string' ? value : undefined;
};

const getBoolean = (value: unknown): boolean => value === true;

const getPositiveInteger = (value: unknown): number | undefined => {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
};

const validatePositiveInteger = (value: number, label: string): number => {
    if (!Number.isInteger(value) || value <= 0) {
        throw new GitLabIntegrationError(`GitLab ${label} must be a positive integer.`);
    }

    return value;
};

const validateNonNegativeInteger = (value: number, label: string): number => {
    if (!Number.isInteger(value) || value < 0) {
        throw new GitLabIntegrationError(`GitLab ${label} must be a non-negative integer.`);
    }

    return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};
