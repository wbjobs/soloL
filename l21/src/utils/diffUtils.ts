import { diff_match_patch, Diff } from 'diff-match-patch';

const dmp = new diff_match_patch();

export interface DiffChange {
  type: 'insert' | 'delete' | 'equal';
  text: string;
  startLine: number;
  endLine: number;
}

export function computeDiff(oldText: string, newText: string): Diff[] {
  return dmp.diff_main(oldText, newText);
}

export function formatDiffForDisplay(diffs: Diff[]): DiffChange[] {
  const changes: DiffChange[] = [];
  let lineCount = 0;

  for (const diff of diffs) {
    const lines = diff[1].split('\n');
    const startLine = lineCount;
    const endLine = lineCount + lines.length - 1;

    let type: 'insert' | 'delete' | 'equal';
    if (diff[0] === 1) type = 'insert';
    else if (diff[0] === -1) type = 'delete';
    else type = 'equal';

    changes.push({
      type,
      text: diff[1],
      startLine,
      endLine,
    });

    lineCount = endLine + (diff[1].endsWith('\n') ? 1 : 0);
  }

  return changes;
}

export function createPatch(oldText: string, newText: string): string {
  const diffs = dmp.diff_main(oldText, newText);
  const patches = dmp.patch_make(oldText, diffs);
  return dmp.patch_toText(patches);
}

export function applyPatch(text: string, patchStr: string): string {
  const patches = dmp.patch_fromText(patchStr);
  const [result] = dmp.patch_apply(patches, text);
  return result as string;
}

export function mergeVersions(base: string, versionA: string, versionB: string): string {
  const diffsA = dmp.diff_main(base, versionA);
  const diffsB = dmp.diff_main(base, versionB);
  const patchA = dmp.patch_make(base, diffsA);
  const patchB = dmp.patch_make(base, diffsB);
  const [merged] = dmp.patch_apply(patchA, base);
  const [final] = dmp.patch_apply(patchB, merged);
  return final as string;
}
