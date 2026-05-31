import { SrtBlock } from './srt-parser';

export interface AISuggestionData {
  blockIndex: number;
  originalText: string;
  suggestedText: string;
  startTimeOffset: number;
  endTimeOffset: number;
  textDiffRate: number;
  diffType: 'timeline-offset' | 'text-diff' | 'both';
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 0; i <= m; i++) {
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

export function computeTextDiffRate(original: string, suggested: string): number {
  if (original.length === 0 && suggested.length === 0) return 0;
  const distance = levenshteinDistance(original, suggested);
  const maxLen = Math.max(original.length, suggested.length);
  return distance / maxLen;
}

export function computeTimelineOffset(
  originalStart: number,
  originalEnd: number,
  suggestedStart: number,
  suggestedEnd: number,
): { startOffset: number; endOffset: number } {
  return {
    startOffset: suggestedStart - originalStart,
    endOffset: suggestedEnd - originalEnd,
  };
}

export function compareSubtitles(
  originalBlocks: SrtBlock[],
  aiBlocks: SrtBlock[],
): AISuggestionData[] {
  const suggestions: AISuggestionData[] = [];

  for (let i = 0; i < originalBlocks.length; i++) {
    const original = originalBlocks[i];
    const bestMatch = findClosestBlock(original, aiBlocks);
    if (!bestMatch) continue;

    const textDiffRate = computeTextDiffRate(original.text, bestMatch.text);
    const { startOffset, endOffset } = computeTimelineOffset(
      original.startTime,
      original.endTime,
      bestMatch.startTime,
      bestMatch.endTime,
    );

    const hasTimelineOffset = Math.abs(startOffset) > 200 || Math.abs(endOffset) > 200;
    const hasTextDiff = textDiffRate > 0.1;

    if (!hasTimelineOffset && !hasTextDiff) continue;

    let diffType: AISuggestionData['diffType'] = 'both';
    if (hasTimelineOffset && !hasTextDiff) {
      diffType = 'timeline-offset';
    } else if (!hasTimelineOffset && hasTextDiff) {
      diffType = 'text-diff';
    }

    suggestions.push({
      blockIndex: i,
      originalText: original.text,
      suggestedText: bestMatch.text,
      startTimeOffset: startOffset,
      endTimeOffset: endOffset,
      textDiffRate,
      diffType,
    });
  }

  return suggestions;
}

function findClosestBlock(target: SrtBlock, candidates: SrtBlock[]): SrtBlock | null {
  if (candidates.length === 0) return null;

  let bestBlock: SrtBlock | null = null;
  let bestOverlap = -1;

  for (const candidate of candidates) {
    const overlapStart = Math.max(target.startTime, candidate.startTime);
    const overlapEnd = Math.min(target.endTime, candidate.endTime);
    const overlap = Math.max(0, overlapEnd - overlapStart);

    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestBlock = candidate;
    }
  }

  return bestBlock;
}
