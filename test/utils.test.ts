import { describe, expect, it, vi } from 'vitest';
import { delay, getDiffBlocks, getLinePosition } from '../src/utils';

const getHunkMatch = (diffBlock: string): RegExpMatchArray => {
    const matches = /@@\s-(\d+)(?:,(\d+))?\s\+(\d+)(?:,(\d+))?\s@@/.exec(diffBlock);

    if (!matches) {
        throw new Error('Expected a valid diff hunk header');
    }

    return matches;
};

describe('diff utilities', () => {
    it('resolves after the requested delay', async () => {
        vi.useFakeTimers();

        try {
            const delayed = delay(100);
            await vi.advanceTimersByTimeAsync(100);
            await expect(delayed).resolves.toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });

    it('splits a unified diff into hunk blocks', () => {
        const diff = [
            'diff --git a/file.ts b/file.ts',
            '@@ -1,2 +1,2 @@',
            '-const oldValue = 1;',
            '+const newValue = 2;',
            '@@ -10,1 +10,1 @@',
            ' return newValue;',
        ].join('\n');

        expect(getDiffBlocks(diff)).toEqual([
            'diff --git a/file.ts b/file.ts\n',
            '@@ -1,2 +1,2 @@\n-const oldValue = 1;\n+const newValue = 2;\n',
            '@@ -10,1 +10,1 @@\n return newValue;',
        ]);
    });

    it('maps an added line to the new file position', () => {
        const diffBlock = '@@ -2,3 +4,4 @@\n context\n+added\n';

        expect(getLinePosition(getHunkMatch(diffBlock), diffBlock)).toEqual({
            new_line: 7,
        });
    });

    it('maps a deleted line to the old file position', () => {
        const diffBlock = '@@ -2,3 +4,2 @@\n context\n-deleted\n';

        expect(getLinePosition(getHunkMatch(diffBlock), diffBlock)).toEqual({
            old_line: 4,
        });
    });

    it('maps a context line to both file positions', () => {
        const diffBlock = '@@ -2,3 +4,3 @@\n context\n';

        expect(getLinePosition(getHunkMatch(diffBlock), diffBlock)).toEqual({
            old_line: 4,
            new_line: 6,
        });
    });
});
