import type { Point3D } from '../types';

export const parsePLY = (data: ArrayBuffer): {
  points: Float32Array;
  colors: Float32Array | null;
  labels: Uint32Array | null;
  pointCount: number;
} => {
  const text = new TextDecoder().decode(data);
  const lines = text.split('\n');

  let headerEndIndex = 0;
  let pointCount = 0;
  let hasColor = false;
  let hasLabel = false;
  const properties: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === 'end_header') {
      headerEndIndex = i + 1;
      break;
    }
    if (line.startsWith('element vertex')) {
      pointCount = parseInt(line.split(' ')[2], 10);
    }
    if (line.startsWith('property')) {
      const prop = line.split(' ')[2];
      properties.push(prop);
      if (prop === 'red' || prop === 'r') hasColor = true;
      if (prop === 'label' || prop === 'class') hasLabel = true;
    }
  }

  const points = new Float32Array(pointCount * 3);
  const colors = hasColor ? new Float32Array(pointCount * 3) : null;
  const labels = hasLabel ? new Uint32Array(pointCount) : null;

  const xIdx = properties.indexOf('x');
  const yIdx = properties.indexOf('y');
  const zIdx = properties.indexOf('z');
  const rIdx = properties.indexOf('red') !== -1 ? properties.indexOf('red') : properties.indexOf('r');
  const gIdx = properties.indexOf('green') !== -1 ? properties.indexOf('green') : properties.indexOf('g');
  const bIdx = properties.indexOf('blue') !== -1 ? properties.indexOf('blue') : properties.indexOf('b');
  const labelIdx = properties.indexOf('label') !== -1 ? properties.indexOf('label') : properties.indexOf('class');

  for (let i = 0; i < pointCount; i++) {
    const values = lines[headerEndIndex + i].trim().split(/\s+/);
    points[i * 3] = parseFloat(values[xIdx]);
    points[i * 3 + 1] = parseFloat(values[yIdx]);
    points[i * 3 + 2] = parseFloat(values[zIdx]);

    if (colors && rIdx !== -1 && gIdx !== -1 && bIdx !== -1) {
      colors[i * 3] = parseInt(values[rIdx], 10) / 255;
      colors[i * 3 + 1] = parseInt(values[gIdx], 10) / 255;
      colors[i * 3 + 2] = parseInt(values[bIdx], 10) / 255;
    }

    if (labels && labelIdx !== -1) {
      labels[i] = parseInt(values[labelIdx], 10);
    }
  }

  return { points, colors, labels, pointCount };
};

export const calculateBounds = (points: Float32Array): { min: Point3D; max: Point3D } => {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < points.length; i += 3) {
    minX = Math.min(minX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    minZ = Math.min(minZ, points[i + 2]);
    maxX = Math.max(maxX, points[i]);
    maxY = Math.max(maxY, points[i + 1]);
    maxZ = Math.max(maxZ, points[i + 2]);
  }

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
};

export const pointsInSphere = (
  points: Float32Array,
  center: Point3D,
  radius: number
): number[] => {
  const indices: number[] = [];
  const radiusSq = radius * radius;

  for (let i = 0; i < points.length; i += 3) {
    const dx = points[i] - center.x;
    const dy = points[i + 1] - center.y;
    const dz = points[i + 2] - center.z;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq <= radiusSq) {
      indices.push(i / 3);
    }
  }

  return indices;
};

export const pointsInCube = (
  points: Float32Array,
  center: Point3D,
  size: number
): number[] => {
  const indices: number[] = [];
  const halfSize = size / 2;
  const minX = center.x - halfSize;
  const maxX = center.x + halfSize;
  const minY = center.y - halfSize;
  const maxY = center.y + halfSize;
  const minZ = center.z - halfSize;
  const maxZ = center.z + halfSize;

  for (let i = 0; i < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];

    if (
      x >= minX && x <= maxX &&
      y >= minY && y <= maxY &&
      z >= minZ && z <= maxZ
    ) {
      indices.push(i / 3);
    }
  }

  return indices;
};

export const downsamplePoints = (
  points: Float32Array,
  colors: Float32Array | null,
  labels: Uint32Array | null,
  targetCount: number
): {
  points: Float32Array;
  colors: Float32Array | null;
  labels: Uint32Array | null;
} => {
  const originalCount = points.length / 3;
  if (originalCount <= targetCount) {
    return { points, colors, labels };
  }

  const ratio = originalCount / targetCount;
  const step = Math.floor(ratio);
  const newCount = Math.floor(originalCount / step);

  const newPoints = new Float32Array(newCount * 3);
  const newColors = colors ? new Float32Array(newCount * 3) : null;
  const newLabels = labels ? new Uint32Array(newCount) : null;

  for (let i = 0, j = 0; i < originalCount && j < newCount; i += step, j++) {
    newPoints[j * 3] = points[i * 3];
    newPoints[j * 3 + 1] = points[i * 3 + 1];
    newPoints[j * 3 + 2] = points[i * 3 + 2];

    if (newColors && colors) {
      newColors[j * 3] = colors[i * 3];
      newColors[j * 3 + 1] = colors[i * 3 + 1];
      newColors[j * 3 + 2] = colors[i * 3 + 2];
    }

    if (newLabels && labels) {
      newLabels[j] = labels[i];
    }
  }

  return { points: newPoints, colors: newColors, labels: newLabels };
};

export const computeCentroid = (points: Float32Array): Point3D => {
  let sumX = 0, sumY = 0, sumZ = 0;
  const count = points.length / 3;

  for (let i = 0; i < points.length; i += 3) {
    sumX += points[i];
    sumY += points[i + 1];
    sumZ += points[i + 2];
  }

  return {
    x: sumX / count,
    y: sumY / count,
    z: sumZ / count,
  };
};
