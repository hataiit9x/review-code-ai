import axios, { AxiosInstance } from 'axios';
import { IGitLabConfig, IMergeRequestInfo, IDiffChange, ILinePosition } from './types';

const parseLastDiff = (gitDiff: string): ILinePosition => {
    const diffList = gitDiff.split('\n').reverse();
    const lastLineFirstChar = diffList?.[1]?.[0];
    const lastDiff = diffList.find((item) => /^@@ -\d+,\d+ \+\d+,\d+ @@/g.test(item)) || '';

    const [lastOldLineCount = '', lastNewLineCount = ''] = lastDiff
        .replace(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@.*/g, (_$0, $1, $2, $3, $4) => {
            return `${+$1 + +$2},${+$3 + +$4}`;
        })
        .split(',');

    if (!/^\d+$/.test(lastOldLineCount) || !/^\d+$/.test(lastNewLineCount)) {
        return { old_line: -1, new_line: -1 };
    }

    return {
        old_line: lastLineFirstChar === '+' ? -1 : (parseInt(lastOldLineCount) || 0) - 1,
        new_line: lastLineFirstChar === '-' ? -1 : (parseInt(lastNewLineCount) || 0) - 1,
    };
};

export class GitLab {
    private apiClient: AxiosInstance;
    private projectId: string;
    private mrId: string;
    private mergeRequestInfo?: IMergeRequestInfo;

    constructor({ gitlabApiUrl, gitlabAccessToken, projectId, mergeRequestId }: IGitLabConfig) {
        this.projectId = projectId;
        this.mrId = mergeRequestId;
        this.apiClient = axios.create({
            baseURL: gitlabApiUrl,
            headers: {
                'Private-Token': gitlabAccessToken,
            },
        });
    }

    async init(): Promise<void> {
        await this.getMergeRequestInfo();
    }

    async getMergeRequestInfo(): Promise<void> {
        const response = await this.apiClient.get(`/projects/${this.projectId}/merge_requests/${this.mrId}`);
        this.mergeRequestInfo = response.data;
    }

    async getMergeRequestChanges(): Promise<IDiffChange[]> {
        const response = await this.apiClient.get(`/projects/${this.projectId}/merge_requests/${this.mrId}/diffs`);
        return response.data.map((item: Record<string, unknown>) => {
            const { old_line, new_line } = parseLastDiff(item.diff as string);
            return { ...item, old_line, new_line } as IDiffChange;
        });
    }

    async getFileContent(filePath: string): Promise<string> {
        const encodedPath = encodeURIComponent(filePath);
        const response = await this.apiClient.get(
            `/projects/${this.projectId}/repository/files/${encodedPath}/raw?ref=${this.mergeRequestInfo?.source_branch}`
        );
        return response.data || '';
    }

    async addReviewComment(lineObj: ILinePosition, change: IDiffChange, suggestion: string): Promise<void> {
        await this.apiClient.post(`/projects/${this.projectId}/merge_requests/${this.mrId}/discussions`, {
            body: suggestion,
            position: {
                position_type: 'text',
                ...lineObj,
                new_path: change.new_path,
                old_path: change.old_path,
                ...this.mergeRequestInfo?.diff_refs,
            },
        });
    }
}
