import type { LabelDefinition } from '../types';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const hexToRgb = (hex: string): RGB => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 128, g: 128, b: 128 };
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
};

export const rgbToHex = (r: number, g: number, b: number): string => {
  return (
    '#' +
    [r, g, b]
      .map((x) => {
        const hex = Math.round(Math.max(0, Math.min(255, x))).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      })
      .join('')
  );
};

export const hexToRgbNormalized = (hex: string): [number, number, number] => {
  const rgb = hexToRgb(hex);
  return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
};

export const getColorForLabelId = (
  labelId: number,
  labels: LabelDefinition[]
): string => {
  const label = labels.find((l) => l.id === labelId);
  return label?.color || '#808080';
};

export const getRgbForLabelId = (
  labelId: number,
  labels: LabelDefinition[]
): RGB => {
  const hex = getColorForLabelId(labelId, labels);
  return hexToRgb(hex);
};

export const getNormalizedRgbForLabelId = (
  labelId: number,
  labels: LabelDefinition[]
): [number, number, number] => {
  const hex = getColorForLabelId(labelId, labels);
  return hexToRgbNormalized(hex);
};

export const generateColorMap = (
  labels: LabelDefinition[]
): Map<number, [number, number, number]> => {
  const colorMap = new Map<number, [number, number, number]>();
  labels.forEach((label) => {
    colorMap.set(label.id, hexToRgbNormalized(label.color));
  });
  return colorMap;
};

export const getLabelColorArray = (
  labels: Uint32Array,
  colorMap: Map<number, [number, number, number]>,
  defaultColor: [number, number, number] = [0.5, 0.5, 0.5]
): Float32Array => {
  const colors = new Float32Array(labels.length * 3);
  const defaultRgb = colorMap.get(0) || defaultColor;

  for (let i = 0; i < labels.length; i++) {
    const labelId = labels[i];
    const rgb = colorMap.get(labelId) || defaultRgb;
    colors[i * 3] = rgb[0];
    colors[i * 3 + 1] = rgb[1];
    colors[i * 3 + 2] = rgb[2];
  }

  return colors;
};

export const interpolateColor = (
  color1: string,
  color2: string,
  t: number
): string => {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  const clampedT = Math.max(0, Math.min(1, t));

  return rgbToHex(
    rgb1.r + (rgb2.r - rgb1.r) * clampedT,
    rgb1.g + (rgb2.g - rgb1.g) * clampedT,
    rgb1.b + (rgb2.b - rgb1.b) * clampedT
  );
};

export const generateDistinctColors = (count: number): string[] => {
  const colors: string[] = [];
  const goldenRatio = 0.618033988749895;
  let hue = 0.25;

  for (let i = 0; i < count; i++) {
    hue += goldenRatio;
    hue %= 1;

    const h = hue * 360;
    const s = 0.5 + (i % 2) * 0.3;
    const l = 0.4 + ((i * 7) % 3) * 0.15;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;

    let r: number, g: number, b: number;
    if (h >= 0 && h < 60) { r = c; g = x; b = 0;
    } else if (h >= 60 && h < 120) { r = x; g = c; b = 0;
    } else if (h >= 120 && h < 180) { r = 0; g = c; b = x;
    } else if (h >= 180 && h < 240) { r = 0; g = x; b = c;
    } else if (h >= 240 && h < 300) { r = x; g = 0; b = c;
    } else { r = c; g = 0; b = x;
    }

    colors.push(
      rgbToHex(
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255)
      )
    );
  }

  return colors;
};
