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
    const lineObj: ILinePosition = {};
    const lastLine = diffBlock.split(/\r?\n/).reverse()[1]?.trim();
    
    const oldLineStart = +matches[1]!;
    const oldLineEnd = +matches[2]! || 0;
    const newLineStart = +matches[3]!;
    const newLineEnd = +matches[4]! || 0;

    if (lastLine?.[0] === '+') {
        lineObj.new_line = newLineStart + newLineEnd - 1;
    } else if (lastLine?.[0] === '-') {
        lineObj.old_line = oldLineStart + oldLineEnd - 1;
    } else {
        lineObj.new_line = newLineStart + newLineEnd - 1;
        lineObj.old_line = oldLineStart + oldLineEnd - 1;
    }
    
    return lineObj;
};
