import type { Point3D, PointCloudChunk } from '../types';
import * as THREE from 'three';

export const isChunkInFrustum = (
  chunk: PointCloudChunk,
  viewProjectionMatrix: THREE.Matrix4
): boolean => {
  const { min, max } = chunk.bounds;
  const corners = [
    { x: min.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: min.z },
    { x: min.x, y: max.y, z: min.z },
    { x: max.x, y: max.y, z: min.z },
    { x: min.x, y: min.y, z: max.z },
    { x: max.x, y: min.y, z: max.z },
    { x: min.x, y: max.y, z: max.z },
    { x: max.x, y: max.y, z: max.z },
  ];

  const matrix = viewProjectionMatrix.elements;

  for (let plane = 0; plane < 6; plane++) {
    const planeOffset = plane * 4;
    const a = matrix[planeOffset + 3] + matrix[planeOffset];
    const b = matrix[planeOffset + 3] + matrix[planeOffset + 1];
    const c = matrix[planeOffset + 3] + matrix[planeOffset + 2];
    const d = matrix[planeOffset + 3] + matrix[planeOffset + 3];

    let inside = false;
    for (const corner of corners) {
      const dist = a * corner.x + b * corner.y + c * corner.z + d;
      if (dist >= 0) {
        inside = true;
        break;
      }
    }
    if (!inside) return false;
  }

  return true;
};

export const distanceToChunk = (
  point: Point3D,
  chunk: PointCloudChunk
): number => {
  const { min, max } = chunk.bounds;
  const cx = Math.max(min.x, Math.min(point.x, max.x));
  const cy = Math.max(min.y, Math.min(point.y, max.y));
  const cz = Math.max(min.z, Math.min(point.z, max.z));

  const dx = point.x - cx;
  const dy = point.y - cy;
  const dz = point.z - cz;

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export const createChunkId = (
  x: number,
  y: number,
  z: number,
  lod: number
): string => {
  return `chunk_${lod}_${x}_${y}_${z}`;
};

export const generateChunkGrid = (
  bounds: { min: Point3D; max: Point3D },
  chunkSize: number,
  lodLevel: number
): string[] => {
  const chunkIds: string[] = [];
  const lodScale = Math.pow(2, lodLevel);
  const scaledSize = chunkSize * lodScale;

  const startX = Math.floor(bounds.min.x / scaledSize);
  const startY = Math.floor(bounds.min.y / scaledSize);
  const startZ = Math.floor(bounds.min.z / scaledSize);
  const endX = Math.ceil(bounds.max.x / scaledSize);
  const endY = Math.ceil(bounds.max.y / scaledSize);
  const endZ = Math.ceil(bounds.max.z / scaledSize);

  for (let x = startX; x <= endX; x++) {
    for (let y = startY; y <= endY; y++) {
      for (let z = startZ; z <= endZ; z++) {
        chunkIds.push(createChunkId(x, y, z, lodLevel));
      }
    }
  }

  return chunkIds;
};

export const getChunkBounds = (
  chunkId: string,
  chunkSize: number
): { min: Point3D; max: Point3D } => {
  const parts = chunkId.split('_');
  const lod = parseInt(parts[1], 10);
  const x = parseInt(parts[2], 10);
  const y = parseInt(parts[3], 10);
  const z = parseInt(parts[4], 10);

  const lodScale = Math.pow(2, lod);
  const scaledSize = chunkSize * lodScale;

  return {
    min: {
      x: x * scaledSize,
      y: y * scaledSize,
      z: z * scaledSize,
    },
    max: {
      x: (x + 1) * scaledSize,
      y: (y + 1) * scaledSize,
      z: (z + 1) * scaledSize,
    },
  };
};

export const getLODLevelForDistance = (
  distance: number,
  lodDistances: number[] = [10, 30, 60, 100]
): number => {
  for (let i = lodDistances.length - 1; i >= 0; i--) {
    if (distance >= lodDistances[i]) {
      return i;
    }
  }
  return 0;
};
