import type { LabelDefinition } from '../types';

const SEMANTIC_KITTI_LABELS: Record<number, number> = {
  0: 0, 1: 10, 2: 11, 3: 15, 4: 30, 5: 50,
  6: 40, 7: 31, 8: 32, 9: 80, 10: 70, 11: 99,
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 128, g: 128, b: 128 };
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
};

export const downloadBlob = (
  data: Uint8Array | string,
  filename: string,
  mimeType: string
): void => {
  const blob = typeof data === 'string'
    ? new Blob([data], { type: mimeType })
    : new Blob([data], { type: mimeType });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const DEFAULT_LABEL_MAP = new Map(
  Object.entries(SEMANTIC_KITTI_LABELS).map(([k, v]) => [parseInt(k), v])
);

export const exportToSemanticKITTI = (
  points: Float32Array,
  labels: Uint32Array,
  labelMap: Map<number, number> = DEFAULT_LABEL_MAP
): Uint8Array => {
  const pointCount = points.length / 3;
  const buffer = new ArrayBuffer(pointCount * 16);
  const view = new DataView(buffer);
  const floatView = new Float32Array(buffer);

  for (let i = 0; i < pointCount; i++) {
    const baseFloat = i * 4;
    const baseByte = i * 16;

    floatView[baseFloat] = points[i * 3];
    floatView[baseFloat + 1] = points[i * 3 + 1];
    floatView[baseFloat + 2] = points[i * 3 + 2];
    floatView[baseFloat + 3] = 0;

    const labelId = labels[i];
    const kittiLabel = labelMap.get(labelId) ?? 0;
    view.setUint16(baseByte + 12, kittiLabel, true);
    view.setUint16(baseByte + 14, 0, true);
  }

  return new Uint8Array(buffer);
};

export const exportToPLY = (
  points: Float32Array,
  colors: Float32Array | null,
  labels: Uint32Array | null,
  labelsDefinition: LabelDefinition[]
): string => {
  const pointCount = points.length / 3;
  const hasColor = colors !== null;
  const hasLabel = labels !== null;

  let header = 'ply\nformat ascii 1.0\n';
  header += `element vertex ${pointCount}\n`;
  header += 'property float x\nproperty float y\nproperty float z\n';
  if (hasColor) header += 'property uchar red\nproperty uchar green\nproperty uchar blue\n';
  if (hasLabel) header += 'property uint label\n';
  header += 'end_header\n';

  const colorMap = new Map<number, string>();
  labelsDefinition.forEach((l) => colorMap.set(l.id, l.color));

  const lines: string[] = [header];

  for (let i = 0; i < pointCount; i++) {
    const x = points[i * 3];
    const y = points[i * 3 + 1];
    const z = points[i * 3 + 2];
    let line = `${x} ${y} ${z}`;

    if (hasColor && colors) {
      const r = Math.round(colors[i * 3] * 255);
      const g = Math.round(colors[i * 3 + 1] * 255);
      const b = Math.round(colors[i * 3 + 2] * 255);
      line += ` ${r} ${g} ${b}`;
    } else if (hasLabel && labels) {
      const labelId = labels[i];
      const color = colorMap.get(labelId) || '#808080';
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      line += ` ${r} ${g} ${b}`;
    }

    if (hasLabel && labels) line += ` ${labels[i]}`;
    lines.push(line);
  }

  return lines.join('\n');
};

export const exportLabels = (
  labels: Uint32Array,
  filename: string = 'labels'
): void => {
  const kittiData = exportToSemanticKITTI(
    new Float32Array(labels.length * 3),
    labels
  );
  downloadBlob(kittiData, `${filename}.bin`, 'application/octet-stream');
};

export const generateLabelFile = (
  labels: LabelDefinition[]
): string => {
  return labels
    .map((label) => {
      const rgb = hexToRgb(label.color);
      return `${label.id}:${label.name}:${rgb.r},${rgb.g},${rgb.b}`;
    })
    .join('\n');
};

export const exportLabelFile = (
  labels: LabelDefinition[],
  filename: string = 'labels.txt'
): void => {
  const content = generateLabelFile(labels);
  downloadBlob(content, filename, 'text/plain');
};
