import axios, { type AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';
import {
    classifyDiffChange,
    GitLab,
    GitLabIntegrationError,
    GITLAB_PAGE_SIZE,
    MAX_DIFF_CHARS,
} from '../src/gitlab';
import type { IDiffChange } from '../src/types';

type MockResponse = {
    status: number;
    data: unknown;
    headers?: Record<string, string>;
};

type RequestLog = {
    method: 'get' | 'post';
    url: string;
    config?: unknown;
    payload?: unknown;
};

const response = (data: unknown, status = 200, headers: Record<string, string> = {}): MockResponse => ({
    status,
    data,
    headers,
});

const mergeRequestInfo = {
    source_branch: 'feature/security-review',
    diff_refs: {
        base_sha: 'base-sha',
        head_sha: 'head-sha',
        start_sha: 'start-sha',
    },
};

const textChange = (overrides: Partial<IDiffChange> = {}): IDiffChange => ({
    diff: '@@ -1,1 +1,1 @@\n-old\n+new',
    new_path: 'src/example.php',
    old_path: 'src/example.php',
    renamed_file: false,
    deleted_file: false,
    ...overrides,
});

const createGitLabMock = (
    getResponses: MockResponse[],
    postResponses: MockResponse[] = [],
    config: Partial<ConstructorParameters<typeof GitLab>[0]> = {},
) => {
    const requests: RequestLog[] = [];
    let getIndex = 0;
    let postIndex = 0;
    const get = vi.fn().mockImplementation(async (url: string, requestConfig?: unknown) => {
        requests.push({ method: 'get', url, config: requestConfig });
        const next = getResponses[getIndex++];
        if (!next) {
            throw new Error('No mocked GitLab GET response remaining');
        }
        return next;
    });
    const post = vi.fn().mockImplementation(async (url: string, payload?: unknown) => {
        requests.push({ method: 'post', url, payload });
        const next = postResponses[postIndex++];
        if (!next) {
            throw new Error('No mocked GitLab POST response remaining');
        }
        return next;
    });
    const create = vi.spyOn(axios, 'create').mockReturnValue({ get, post } as unknown as AxiosInstance);
    const gitlab = new GitLab({
        gitlabApiUrl: 'https://gitlab.example.test/gitlab/api/v4/',
        gitlabAccessToken: 'synthetic-gitlab-token',
        projectId: '42',
        mergeRequestId: '7',
        timeoutMs: 1_500,
        maxRetries: 1,
        retryBaseDelayMs: 1,
        ...config,
    });

    return { create, gitlab, requests };
};

describe('GitLab merge request integration', () => {
    it('uses self-hosted base URLs and follows paginated diffs', async () => {
        const largeDiff = 'x'.repeat(MAX_DIFF_CHARS + 25);
        const { create, gitlab, requests } = createGitLabMock([
            response(mergeRequestInfo),
            response([]),
            response([
                textChange(),
                textChange({
                    new_path: 'deleted.php',
                    old_path: 'deleted.php',
                    deleted_file: true,
                }),
                textChange({
                    new_path: 'renamed.php',
                    old_path: 'old-name.php',
                    renamed_file: true,
                }),
                textChange({
                    new_path: 'image.png',
                    old_path: 'image.png',
                    diff: 'Binary files a/image.png and b/image.png differ',
                    binaryFile: true,
                }),
            ], 200, { 'x-next-page': '2' }),
            response([textChange({ new_path: 'large.txt', old_path: 'large.txt', diff: largeDiff })]),
        ]);

        try {
            await gitlab.init();
            const changes = await gitlab.getMergeRequestChanges();

            expect(create).toHaveBeenCalledWith(expect.objectContaining({
                baseURL: 'https://gitlab.example.test/gitlab/api/v4',
                timeout: 1_500,
            }));
            expect(changes).toHaveLength(5);
            expect(changes[4]?.diffTruncated).toBe(true);
            expect(changes[4]?.diff.length).toBeLessThanOrEqual(MAX_DIFF_CHARS);
            expect(classifyDiffChange(changes[1]!)).toBe('deleted');
            expect(classifyDiffChange(changes[2]!)).toBe('renamed');
            expect(classifyDiffChange(changes[3]!)).toBe('binary');
            expect(classifyDiffChange(changes[4]!)).toBe('truncated');

            const diffRequests = requests.filter((request) => request.method === 'get' && request.url.endsWith('/diffs'));
            expect(diffRequests).toHaveLength(2);
            expect(diffRequests[0]?.config).toEqual({ params: { page: 1, per_page: GITLAB_PAGE_SIZE } });
            expect(diffRequests[1]?.config).toEqual({ params: { page: 2, per_page: GITLAB_PAGE_SIZE } });
        } finally {
            create.mockRestore();
        }
    });

    it('honors Retry-After metadata for bounded GET retries', async () => {
        vi.useFakeTimers();
        const { create, gitlab, requests } = createGitLabMock([
            response({ error: 'rate limited' }, 429, { 'retry-after-ms': '1' }),
            response(mergeRequestInfo),
        ], [], { maxRetries: 1 });

        try {
            const request = gitlab.getMergeRequestInfo();
            await vi.runAllTimersAsync();
            await expect(request).resolves.toBeUndefined();
            expect(requests.filter((item) => item.method === 'get')).toHaveLength(2);
        } finally {
            create.mockRestore();
            vi.useRealTimers();
        }
    });

    it('posts a correctly positioned inline discussion and prevents duplicates', async () => {
        const { create, gitlab, requests } = createGitLabMock([
            response(mergeRequestInfo),
            response([]),
        ], [response({}, 201)]);

        try {
            await gitlab.init();
            const change = textChange();
            await gitlab.addReviewComment({ new_line: 4 }, change, 'Use a safer implementation.');
            await gitlab.addReviewComment({ new_line: 4 }, change, 'Use a safer implementation.');

            const posts = requests.filter((item) => item.method === 'post');
            expect(posts).toHaveLength(1);
            expect(posts[0]?.payload).toEqual({
                body: 'Use a safer implementation.',
                position: {
                    position_type: 'text',
                    new_path: 'src/example.php',
                    old_path: 'src/example.php',
                    new_line: 4,
                    base_sha: 'base-sha',
                    head_sha: 'head-sha',
                    start_sha: 'start-sha',
                },
            });
        } finally {
            create.mockRestore();
        }
    });

    it('falls back to a summary discussion when inline placement is rejected', async () => {
        const { create, gitlab, requests } = createGitLabMock([
            response(mergeRequestInfo),
            response([]),
        ], [response({ error: 'invalid position' }, 422), response({}, 201)]);

        try {
            await gitlab.init();
            await gitlab.addReviewComment({ new_line: 4 }, textChange(), 'Review summary');

            const posts = requests.filter((item) => item.method === 'post');
            expect(posts).toHaveLength(2);
            expect(posts[0]?.payload).toHaveProperty('position');
            expect(posts[1]?.payload).toEqual({ body: 'Review summary' });
        } finally {
            create.mockRestore();
        }
    });

    it('uses summary comments for changes that cannot support inline placement', async () => {
        const { create, gitlab, requests } = createGitLabMock([
            response(mergeRequestInfo),
            response([]),
        ], [response({}, 201)]);

        try {
            await gitlab.init();
            await gitlab.addReviewComment(
                { new_line: 4 },
                textChange({ deleted_file: true }),
                'Deleted-file summary',
            );

            const posts = requests.filter((item) => item.method === 'post');
            expect(posts).toHaveLength(1);
            expect(posts[0]?.payload).toEqual({ body: 'Deleted-file summary' });
        } finally {
            create.mockRestore();
        }
    });

    it('maps permission failures without leaking response content', async () => {
        const { create, gitlab, requests } = createGitLabMock([
            response(mergeRequestInfo),
            response([]),
        ], [response({ error: 'synthetic-gitlab-token must not escape' }, 403)]);

        try {
            await gitlab.init();
            const error = await gitlab.addReviewComment({ new_line: 4 }, textChange(), 'Review summary')
                .catch((reason: unknown) => reason);

            expect(error).toBeInstanceOf(GitLabIntegrationError);
            if (!(error instanceof GitLabIntegrationError)) {
                throw new Error('Expected a GitLabIntegrationError');
            }

            expect(error.message).toBe(
                'GitLab authentication or permission failure. Check the token scope and project access.',
            );
            expect(error.message).not.toContain('synthetic-gitlab-token');
            expect(requests.filter((item) => item.method === 'post')).toHaveLength(1);
        } finally {
            create.mockRestore();
        }
    });

    it('loads an existing discussion and avoids posting the same comment', async () => {
        const { create, gitlab, requests } = createGitLabMock([
            response(mergeRequestInfo),
            response([], 200, { 'x-next-page': '2' }),
            response([{
                notes: [{
                    body: 'Already reviewed.',
                    system: false,
                    position: {
                        new_path: 'src/example.php',
                        old_path: 'src/example.php',
                        new_line: 4,
                    },
                }],
            }]),
        ]);

        try {
            await gitlab.init();
            await gitlab.addReviewComment({ new_line: 4 }, textChange(), 'Already reviewed.');
            expect(requests.filter((item) => item.method === 'post')).toHaveLength(0);
        } finally {
            create.mockRestore();
        }
    });
});
