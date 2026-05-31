export { DEFAULT_ABC_SCORE } from '@shared/constants.js';

export function parseMeasureBoundaries(content: string): Array<{ startLine: number; endLine: number; sectionId: string }> {
  const lines = content.split('\n');
  const boundaries: Array<{ startLine: number; endLine: number; sectionId: string }> = [];
  let currentMeasureStart = 0;
  let measureCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('%') || line.trim() === '') {
      continue;
    }
    if (line.match(/^[A-Z]:/)) {
      continue;
    }
    if (line.includes('|')) {
      if (i > currentMeasureStart || boundaries.length === 0) {
        boundaries.push({
          startLine: currentMeasureStart,
          endLine: i,
          sectionId: `section-${measureCount}`,
        });
        measureCount++;
        currentMeasureStart = i + 1;
      }
    }
  }

  if (currentMeasureStart < lines.length) {
    boundaries.push({
      startLine: currentMeasureStart,
      endLine: lines.length - 1,
      sectionId: `section-${measureCount}`,
    });
  }

  return boundaries;
}

export function findSectionForLine(
  line: number,
  boundaries: Array<{ startLine: number; endLine: number; sectionId: string }>
): string | null {
  for (const boundary of boundaries) {
    if (line >= boundary.startLine && line <= boundary.endLine) {
      return boundary.sectionId;
    }
  }
  return null;
}

export function getLineRangeForSection(
  sectionId: string,
  boundaries: Array<{ startLine: number; endLine: number; sectionId: string }>
): { start: number; end: number } | null {
  const boundary = boundaries.find((b) => b.sectionId === sectionId);
  return boundary ? { start: boundary.startLine, end: boundary.endLine } : null;
}

export function validateABC(content: string): { valid: boolean; errors: Array<{ line: number; message: string }> } {
  const errors: Array<{ line: number; message: string }> = [];
  const lines = content.split('\n');

  let hasTitle = false;
  let hasKey = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('T:')) hasTitle = true;
    if (line.startsWith('K:')) hasKey = true;

    if (line.match(/^[A-Z]:.*/) && !line.match(/^[TKMQLRCSPNO]:.*/)) {
      errors.push({ line: i + 1, message: 'Unknown header field' });
    }
  }

  if (!hasTitle) {
    errors.push({ line: 1, message: 'Missing title (T:)' });
  }
  if (!hasKey) {
    errors.push({ line: lines.length, message: 'Missing key signature (K:)' });
  }

  return { valid: errors.length === 0, errors };
}

export function generateRandomColor(): string {
  const colors = [
    '#ef4444',
    '#f59e0b',
    '#10b981',
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
    '#06b6d4',
    '#84cc16',
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

export function generateUserId(): string {
  return 'user-' + Math.random().toString(36).substring(2, 15);
}
