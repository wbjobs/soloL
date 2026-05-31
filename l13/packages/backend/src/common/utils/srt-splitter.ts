import { SrtBlock } from './srt-parser';

export interface SplitBlock {
  index: number;
  startTime: number;
  endTime: number;
  originalText: string;
}

const SENTENCE_TERMINATORS = /([.!?。！？]+)\s*/g;

function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];
  let lastIndex = 0;

  SENTENCE_TERMINATORS.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = SENTENCE_TERMINATORS.exec(text)) !== null) {
    const sentenceEnd = match.index + match[0].length;
    const sentence = text.substring(lastIndex, sentenceEnd).trim();
    if (sentence) {
      sentences.push(sentence);
    }
    lastIndex = sentenceEnd;
  }

  if (lastIndex < text.length) {
    const remaining = text.substring(lastIndex).trim();
    if (remaining) {
      if (sentences.length > 0) {
        sentences[sentences.length - 1] += ' ' + remaining;
      } else {
        sentences.push(remaining);
      }
    }
  }

  return sentences;
}

export function splitSrtIntoProofreadBlocks(srtBlocks: SrtBlock[]): SplitBlock[] {
  const result: SplitBlock[] = [];
  let globalIndex = 0;

  for (const srtBlock of srtBlocks) {
    const sentences = splitIntoSentences(srtBlock.text);

    if (sentences.length <= 1) {
      result.push({
        index: globalIndex++,
        startTime: srtBlock.startTime,
        endTime: srtBlock.endTime,
        originalText: srtBlock.text.trim(),
      });
      continue;
    }

    const totalCharCount = sentences.reduce((sum, s) => sum + s.length, 0);
    const duration = srtBlock.endTime - srtBlock.startTime;
    let currentTime = srtBlock.startTime;

    for (let i = 0; i < sentences.length; i++) {
      const proportionalDuration = Math.round(
        (sentences[i].length / totalCharCount) * duration,
      );
      const startTime = currentTime;
      const endTime =
        i === sentences.length - 1
          ? srtBlock.endTime
          : currentTime + proportionalDuration;

      result.push({
        index: globalIndex++,
        startTime,
        endTime,
        originalText: sentences[i].trim(),
      });

      currentTime = endTime;
    }
  }

  return result;
}
