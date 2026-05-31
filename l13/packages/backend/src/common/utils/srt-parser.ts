export interface SrtBlock {
  index: number;
  startTime: number;
  endTime: number;
  text: string;
}

function parseTimestamp(timestamp: string): number {
  const match = timestamp.trim().match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!match) {
    throw new Error(`Invalid timestamp format: ${timestamp}`);
  }
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const milliseconds = parseInt(match[4], 10);
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds;
}

function formatTimestamp(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  ms %= 3600000;
  const minutes = Math.floor(ms / 60000);
  ms %= 60000;
  const seconds = Math.floor(ms / 1000);
  const milliseconds = ms % 1000;
  return (
    String(hours).padStart(2, '0') +
    ':' +
    String(minutes).padStart(2, '0') +
    ':' +
    String(seconds).padStart(2, '0') +
    ',' +
    String(milliseconds).padStart(3, '0')
  );
}

export function parseSrt(content: string): SrtBlock[] {
  const blocks: SrtBlock[] = [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  if (!normalized) {
    return blocks;
  }

  const rawBlocks = normalized.split(/\n\n+/);

  for (const rawBlock of rawBlocks) {
    const lines = rawBlock.split('\n').filter((line) => line.trim() !== '');
    if (lines.length < 2) continue;

    const indexLine = lines[0].trim();
    const index = parseInt(indexLine, 10);
    if (isNaN(index)) continue;

    const timeLine = lines[1].trim();
    const timeMatch = timeLine.match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/,
    );
    if (!timeMatch) continue;

    const startTime = parseTimestamp(timeMatch[1]);
    const endTime = parseTimestamp(timeMatch[2]);
    const text = lines.slice(2).join('\n');

    blocks.push({ index, startTime, endTime, text });
  }

  return blocks;
}

export function serializeSrt(blocks: SrtBlock[]): string {
  return blocks
    .map((block, i) => {
      const index = i + 1;
      const start = formatTimestamp(block.startTime);
      const end = formatTimestamp(block.endTime);
      return `${index}\n${start} --> ${end}\n${block.text}`;
    })
    .join('\n\n');
}
