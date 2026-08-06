import { ILinePosition } from './types';

/**
 * Delay execution for specified milliseconds
 */
export const delay = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Split git diff into blocks by @@ markers
 */
export const getDiffBlocks = (diff: string): string[] => {
    const regex = /(?=@@\s-\d+(?:,\d+)?\s\+\d+(?:,\d+)?\s@@)/g;
    return diff.split(regex);
};

/**
 * Extract line position from diff block matches
 */
export const getLinePosition = (matches: RegExpMatchArray, diffBlock: string): ILinePosition => {
    let oldLine = Number(matches[1]);
    let newLine = Number(matches[3]);
    let lastAddedLine: number | undefined;
    let lastDeletedLine: number | undefined;
    let lastContextPosition: ILinePosition | undefined;

    for (const line of diffBlock.split(/\r?\n/).slice(1)) {
        if (line.startsWith('\\')) {
            continue;
        }

        if (line.startsWith('+')) {
            lastAddedLine = newLine;
            newLine += 1;
            continue;
        }

        if (line.startsWith('-')) {
            lastDeletedLine = oldLine;
            oldLine += 1;
            continue;
        }

        if (line.startsWith(' ')) {
            lastContextPosition = {
                old_line: oldLine,
                new_line: newLine,
            };
            oldLine += 1;
            newLine += 1;
        }
    }

    if (lastAddedLine !== undefined) {
        return { new_line: lastAddedLine };
    }

    if (lastDeletedLine !== undefined) {
        return { old_line: lastDeletedLine };
    }

    return lastContextPosition ?? {};
};
