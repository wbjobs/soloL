import type { Vec3, VoxelData, VoxelGridData, SceneObject } from '@/types';
import { vec3 } from './math';

export const voxelUtils = {
  worldToVoxel: (
    worldPos: Vec3,
    gridCenter: Vec3,
    gridSize: Vec3,
    resolution: number
  ): Vec3 => {
    const halfSize = vec3.mul(gridSize, 0.5);
    const localPos = vec3.add(vec3.sub(worldPos, gridCenter), halfSize);
    const voxelSize = vec3.div(gridSize, resolution);
    return vec3.div(localPos, voxelSize);
  },

  voxelToWorld: (
    voxelPos: Vec3,
    gridCenter: Vec3,
    gridSize: Vec3,
    resolution: number
  ): Vec3 => {
    const voxelSize = vec3.div(gridSize, resolution);
    const localPos = vec3.mul(vec3.add(voxelPos, [0.5, 0.5, 0.5]), voxelSize);
    const halfSize = vec3.mul(gridSize, 0.5);
    return vec3.add(vec3.sub(localPos, halfSize), gridCenter);
  },

  getVoxelIndex: (
    voxelPos: Vec3,
    resolution: number
  ): number => {
    const x = Math.floor(voxelPos[0]);
    const y = Math.floor(voxelPos[1]);
    const z = Math.floor(voxelPos[2]);

    if (x < 0 || x >= resolution || y < 0 || y >= resolution || z < 0 || z >= resolution) {
      return -1;
    }

    return x + y * resolution + z * resolution * resolution;
  },

  getVoxelPosFromIndex: (
    index: number,
    resolution: number
  ): Vec3 => {
    const x = index % resolution;
    const y = Math.floor((index / resolution) % resolution);
    const z = Math.floor(index / (resolution * resolution));
    return [x, y, z];
  },

  isInsideVoxelGrid: (
    worldPos: Vec3,
    gridCenter: Vec3,
    gridSize: Vec3
  ): boolean => {
    const halfSize = vec3.mul(gridSize, 0.5);
    const min = vec3.sub(gridCenter, halfSize);
    const max = vec3.add(gridCenter, halfSize);

    return (
      worldPos[0] >= min[0] && worldPos[0] <= max[0] &&
      worldPos[1] >= min[1] && worldPos[1] <= max[1] &&
      worldPos[2] >= min[2] && worldPos[2] <= max[2]
    );
  },

  createEmptyVoxelGrid: (
    resolution: number,
    channels: number = 4
  ): Uint8Array => {
    return new Uint8Array(resolution * resolution * resolution * channels);
  },

  createEmptyVoxelGridFloat: (
    resolution: number,
    channels: number = 4
  ): Float32Array => {
    return new Float32Array(resolution * resolution * resolution * channels);
  },

  setVoxel: (
    data: Uint8Array | Float32Array,
    resolution: number,
    voxelPos: Vec3,
    color: Vec3 | [number, number, number, number],
    emissive: Vec3 = [0, 0, 0]
  ): void => {
    const index = voxelUtils.getVoxelIndex(voxelPos, resolution);
    if (index < 0) return;

    const channels = data.length / (resolution * resolution * resolution);
    const base = index * channels;

    if (channels >= 4) {
      const rgba = color.length === 4 ? color : [...color, 255];
      if (data instanceof Uint8Array) {
        data[base] = rgba[0];
        data[base + 1] = rgba[1];
        data[base + 2] = rgba[2];
        data[base + 3] = rgba[3];
      } else {
        data[base] = rgba[0] / 255;
        data[base + 1] = rgba[1] / 255;
        data[base + 2] = rgba[2] / 255;
        data[base + 3] = rgba[3] / 255;
      }
    }

    if (channels >= 7 && data instanceof Float32Array) {
      data[base + 4] = emissive[0];
      data[base + 5] = emissive[1];
      data[base + 6] = emissive[2];
    }
  },

  getVoxel: (
    data: Uint8Array | Float32Array,
    resolution: number,
    voxelPos: Vec3
  ): [number, number, number, number] | null => {
    const index = voxelUtils.getVoxelIndex(voxelPos, resolution);
    if (index < 0) return null;

    const channels = data.length / (resolution * resolution * resolution);
    const base = index * channels;

    if (data instanceof Uint8Array) {
      return [
        data[base],
        data[base + 1],
        data[base + 2],
        data[base + 3]
      ];
    } else {
      return [
        data[base] * 255,
        data[base + 1] * 255,
        data[base + 2] * 255,
        data[base + 3] * 255
      ];
    }
  },

  voxelizeBox: (
    data: Uint8Array | Float32Array,
    resolution: number,
    gridCenter: Vec3,
    gridSize: Vec3,
    boxMin: Vec3,
    boxMax: Vec3,
    color: [number, number, number, number],
    emissive: Vec3 = [0, 0, 0]
  ): void => {
    const voxelMin = voxelUtils.worldToVoxel(boxMin, gridCenter, gridSize, resolution);
    const voxelMax = voxelUtils.worldToVoxel(boxMax, gridCenter, gridSize, resolution);

    const minX = Math.max(0, Math.floor(voxelMin[0]));
    const minY = Math.max(0, Math.floor(voxelMin[1]));
    const minZ = Math.max(0, Math.floor(voxelMin[2]));
    const maxX = Math.min(resolution - 1, Math.ceil(voxelMax[0]));
    const maxY = Math.min(resolution - 1, Math.ceil(voxelMax[1]));
    const maxZ = Math.min(resolution - 1, Math.ceil(voxelMax[2]));

    for (let z = minZ; z <= maxZ; z++) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          voxelUtils.setVoxel(data, resolution, [x, y, z], color, emissive);
        }
      }
    }
  },

  voxelizeSphere: (
    data: Uint8Array | Float32Array,
    resolution: number,
    gridCenter: Vec3,
    gridSize: Vec3,
    center: Vec3,
    radius: number,
    color: [number, number, number, number],
    emissive: Vec3 = [0, 0, 0]
  ): void => {
    const voxelCenter = voxelUtils.worldToVoxel(center, gridCenter, gridSize, resolution);
    const voxelSize = vec3.div(gridSize, resolution);
    const voxelRadius = radius / Math.min(voxelSize[0], voxelSize[1], voxelSize[2]);

    const minX = Math.max(0, Math.floor(voxelCenter[0] - voxelRadius));
    const minY = Math.max(0, Math.floor(voxelCenter[1] - voxelRadius));
    const minZ = Math.max(0, Math.floor(voxelCenter[2] - voxelRadius));
    const maxX = Math.min(resolution - 1, Math.ceil(voxelCenter[0] + voxelRadius));
    const maxY = Math.min(resolution - 1, Math.ceil(voxelCenter[1] + voxelRadius));
    const maxZ = Math.min(resolution - 1, Math.ceil(voxelCenter[2] + voxelRadius));

    const radiusSq = voxelRadius * voxelRadius;

    for (let z = minZ; z <= maxZ; z++) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x - voxelCenter[0];
          const dy = y - voxelCenter[1];
          const dz = z - voxelCenter[2];
          const distSq = dx * dx + dy * dy + dz * dz;

          if (distSq <= radiusSq) {
            voxelUtils.setVoxel(data, resolution, [x, y, z], color, emissive);
          }
        }
      }
    }
  },

  voxelizeSceneObject: (
    data: Uint8Array | Float32Array,
    resolution: number,
    gridCenter: Vec3,
    gridSize: Vec3,
    obj: SceneObject
  ): void => {
    const baseColor = obj.material.baseColor;
    const emissive = obj.material.emissive;
    const color: [number, number, number, number] = [
      baseColor[0] * 255,
      baseColor[1] * 255,
      baseColor[2] * 255,
      baseColor[3] * 255
    ];

    const halfScale = vec3.mul(obj.scale, 0.5);
    const min = vec3.sub(obj.position, halfScale);
    const max = vec3.add(obj.position, halfScale);

    switch (obj.geometryType) {
      case 'box':
        voxelUtils.voxelizeBox(data, resolution, gridCenter, gridSize, min, max, color, emissive);
        break;
      case 'sphere':
        const radius = Math.min(obj.scale[0], obj.scale[1], obj.scale[2]) / 2;
        voxelUtils.voxelizeSphere(data, resolution, gridCenter, gridSize, obj.position, radius, color, emissive);
        break;
      case 'plane':
        const planeMin: Vec3 = [min[0], obj.position[1] - 0.05, min[2]];
        const planeMax: Vec3 = [max[0], obj.position[1] + 0.05, max[2]];
        voxelUtils.voxelizeBox(data, resolution, gridCenter, gridSize, planeMin, planeMax, color, emissive);
        break;
      default:
        voxelUtils.voxelizeBox(data, resolution, gridCenter, gridSize, min, max, color, emissive);
    }
  },

  clearVoxelGrid: (
    data: Uint8Array | Float32Array
  ): void => {
    if (data instanceof Uint8Array) {
      data.fill(0);
    } else {
      data.fill(0);
    }
  },

  calculateVoxelMemory: (
    resolution: number,
    channels: number,
    bytesPerChannel: number
  ): number => {
    return resolution * resolution * resolution * channels * bytesPerChannel;
  },

  getGridBounds: (
    center: Vec3,
    size: Vec3
  ): { min: Vec3; max: Vec3 } => {
    const halfSize = vec3.mul(size, 0.5);
    return {
      min: vec3.sub(center, halfSize),
      max: vec3.add(center, halfSize),
    };
  },

  computeMipmapLevelCount: (
    resolution: number
  ): number => {
    return Math.floor(Math.log2(resolution)) + 1;
  },

  sampleVoxelTrilinear: (
    data: Uint8Array | Float32Array,
    resolution: number,
    voxelPos: Vec3
  ): [number, number, number, number] | null => {
    const x = voxelPos[0] - 0.5;
    const y = voxelPos[1] - 0.5;
    const z = voxelPos[2] - 0.5;

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const z1 = z0 + 1;

    const fx = x - x0;
    const fy = y - y0;
    const fz = z - z0;

    if (x0 < 0 || x1 >= resolution || y0 < 0 || y1 >= resolution || z0 < 0 || z1 >= resolution) {
      return null;
    }

    const c000 = voxelUtils.getVoxel(data, resolution, [x0, y0, z0]);
    const c100 = voxelUtils.getVoxel(data, resolution, [x1, y0, z0]);
    const c010 = voxelUtils.getVoxel(data, resolution, [x0, y1, z0]);
    const c110 = voxelUtils.getVoxel(data, resolution, [x1, y1, z0]);
    const c001 = voxelUtils.getVoxel(data, resolution, [x0, y0, z1]);
    const c101 = voxelUtils.getVoxel(data, resolution, [x1, y0, z1]);
    const c011 = voxelUtils.getVoxel(data, resolution, [x0, y1, z1]);
    const c111 = voxelUtils.getVoxel(data, resolution, [x1, y1, z1]);

    if (!c000 || !c100 || !c010 || !c110 || !c001 || !c101 || !c011 || !c111) {
      return null;
    }

    const result: [number, number, number, number] = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const c00 = c000[i] * (1 - fx) + c100[i] * fx;
      const c10 = c010[i] * (1 - fx) + c110[i] * fx;
      const c01 = c001[i] * (1 - fx) + c101[i] * fx;
      const c11 = c011[i] * (1 - fx) + c111[i] * fx;

      const c0 = c00 * (1 - fy) + c10 * fy;
      const c1 = c01 * (1 - fy) + c11 * fy;

      result[i] = c0 * (1 - fz) + c1 * fz;
    }

    return result;
  },

  createVoxelGridData: (
    resolution: number,
    size: Vec3,
    center: Vec3,
    useFloat: boolean = false
  ): VoxelGridData => {
    const data = useFloat
      ? voxelUtils.createEmptyVoxelGridFloat(resolution)
      : voxelUtils.createEmptyVoxelGrid(resolution);

    return {
      resolution,
      size,
      center,
      data,
    };
  },
};

export default voxelUtils;
