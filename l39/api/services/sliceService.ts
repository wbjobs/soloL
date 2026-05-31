import { Grid3D, SliceParams, SliceResponse, Formation } from '../../shared/types';

function normalize(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len === 0) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function dot(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function subtract(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): { x: number; y: number; z: number } {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function multiplyScalar(
  v: { x: number; y: number; z: number },
  s: number
): { x: number; y: number; z: number } {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function trilinearInterpolate(
  grid: Grid3D,
  point: { x: number; y: number; z: number }
): { value: number; formationId: number } | null {
  const { dimensions, origin, spacing, values, formationIds } = grid;
  const { nx, ny, nz } = dimensions;

  const fx = (point.x - origin.x) / spacing.x;
  const fy = (point.y - origin.y) / spacing.y;
  const fz = (point.z - origin.z) / spacing.z;

  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const iz = Math.floor(fz);

  if (ix < 0 || ix >= nx - 1 || iy < 0 || iy >= ny - 1 || iz < 0 || iz >= nz - 1) {
    return null;
  }

  const dx = fx - ix;
  const dy = fy - iy;
  const dz = fz - iz;

  const getIndex = (i: number, j: number, k: number) => k * nx * ny + j * nx + i;

  const v000 = values[getIndex(ix, iy, iz)];
  const v100 = values[getIndex(ix + 1, iy, iz)];
  const v010 = values[getIndex(ix, iy + 1, iz)];
  const v110 = values[getIndex(ix + 1, iy + 1, iz)];
  const v001 = values[getIndex(ix, iy, iz + 1)];
  const v101 = values[getIndex(ix + 1, iy, iz + 1)];
  const v011 = values[getIndex(ix, iy + 1, iz + 1)];
  const v111 = values[getIndex(ix + 1, iy + 1, iz + 1)];

  const v00 = v000 * (1 - dx) + v100 * dx;
  const v10 = v010 * (1 - dx) + v110 * dx;
  const v01 = v001 * (1 - dx) + v101 * dx;
  const v11 = v011 * (1 - dx) + v111 * dx;

  const v0 = v00 * (1 - dy) + v10 * dy;
  const v1 = v01 * (1 - dy) + v11 * dy;

  const value = v0 * (1 - dz) + v1 * dz;
  const formationId = formationIds[getIndex(ix, iy, iz)];

  return { value, formationId };
}

export function generateSlice(
  grid: Grid3D,
  params: SliceParams,
  formations: Formation[],
  resolution: number = 300
): SliceResponse {
  const { normal, origin } = params;
  const n = normalize(normal);

  const up = { x: 0, y: 0, z: 1 };
  let right = cross(n, up);
  if (Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z) < 0.01) {
    right = cross(n, { x: 1, y: 0, z: 0 });
  }
  right = normalize(right);
  const trueUp = normalize(cross(right, n));

  const { dimensions, origin: gridOrigin, spacing } = grid;
  const center = {
    x: gridOrigin.x + (dimensions.nx - 1) * spacing.x / 2,
    y: gridOrigin.y + (dimensions.ny - 1) * spacing.y / 2,
    z: gridOrigin.z + (dimensions.nz - 1) * spacing.z / 2
  };

  const halfSize = Math.max(
    (dimensions.nx - 1) * spacing.x,
    (dimensions.ny - 1) * spacing.y,
    (dimensions.nz - 1) * spacing.z
  ) * 0.6;

  const sliceOrigin = origin || center;

  const width = resolution;
  const height = resolution;
  const pixelSize = (halfSize * 2) / width;

  const imageData: number[] = [];

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const u = (i - width / 2) * pixelSize;
      const v = (j - height / 2) * pixelSize;

      const worldPoint = add(
        sliceOrigin,
        add(
          multiplyScalar(right, u),
          multiplyScalar(trueUp, v)
        )
      );

      const data = trilinearInterpolate(grid, worldPoint);

      if (data) {
        const formation = formations.find(f => f.id === data.formationId);
        if (formation) {
          const color = hexToRgb(formation.color);
          imageData.push(color.r, color.g, color.b, 255);
        } else {
          imageData.push(128, 128, 128, 255);
        }
      } else {
        imageData.push(30, 30, 40, 255);
      }
    }
  }

  return {
    imageData,
    width,
    height
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      }
    : { r: 128, g: 128, b: 128 };
}

export function generateGridSliceVertices(
  grid: Grid3D,
  params: SliceParams
): { vertices: number[]; colors: number[]; indices: number[] } | null {
  const { normal, origin } = params;
  const n = normalize(normal);

  const { dimensions, origin: gridOrigin, spacing, values, formationIds } = grid;
  const { nx, ny, nz } = dimensions;

  const vertices: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const formations = [
    { id: 0, color: '#f0e68c' },
    { id: 1, color: '#90ee90' },
    { id: 2, color: '#87ceeb' },
    { id: 3, color: '#dda0dd' },
    { id: 4, color: '#cd853f' }
  ];

  const center = {
    x: gridOrigin.x + (nx - 1) * spacing.x / 2,
    y: gridOrigin.y + (ny - 1) * spacing.y / 2,
    z: gridOrigin.z + (nz - 1) * spacing.z / 2
  };

  const sliceOrigin = origin || center;
  const d = -dot(n, sliceOrigin);

  const step = Math.max(1, Math.floor(Math.min(nx, ny, nz) / 100));
  const epsilon = Math.min(spacing.x, spacing.y, spacing.z) * 0.5;

  for (let iz = 0; iz < nz - 1; iz += step) {
    for (let iy = 0; iy < ny - 1; iy += step) {
      for (let ix = 0; ix < nx - 1; ix += step) {
        const corners = [
          { x: gridOrigin.x + ix * spacing.x, y: gridOrigin.y + iy * spacing.y, z: gridOrigin.z + iz * spacing.z },
          { x: gridOrigin.x + (ix + 1) * spacing.x, y: gridOrigin.y + iy * spacing.y, z: gridOrigin.z + iz * spacing.z },
          { x: gridOrigin.x + (ix + 1) * spacing.x, y: gridOrigin.y + (iy + 1) * spacing.y, z: gridOrigin.z + iz * spacing.z },
          { x: gridOrigin.x + ix * spacing.x, y: gridOrigin.y + (iy + 1) * spacing.y, z: gridOrigin.z + iz * spacing.z },
          { x: gridOrigin.x + ix * spacing.x, y: gridOrigin.y + iy * spacing.y, z: gridOrigin.z + (iz + 1) * spacing.z },
          { x: gridOrigin.x + (ix + 1) * spacing.x, y: gridOrigin.y + iy * spacing.y, z: gridOrigin.z + (iz + 1) * spacing.z },
          { x: gridOrigin.x + (ix + 1) * spacing.x, y: gridOrigin.y + (iy + 1) * spacing.y, z: gridOrigin.z + (iz + 1) * spacing.z },
          { x: gridOrigin.x + ix * spacing.x, y: gridOrigin.y + (iy + 1) * spacing.y, z: gridOrigin.z + (iz + 1) * spacing.z }
        ];

        const distances = corners.map(c => dot(n, c) + d);

        let hasPositive = false;
        let hasNegative = false;
        for (const dist of distances) {
          if (dist > 0) hasPositive = true;
          if (dist < 0) hasNegative = true;
        }

        if (hasPositive && hasNegative) {
          const intersectionPoints: { point: { x: number; y: number; z: number }; value: number; formationId: number }[] = [];

          const edges = [
            [0, 1], [1, 2], [2, 3], [3, 0],
            [4, 5], [5, 6], [6, 7], [7, 4],
            [0, 4], [1, 5], [2, 6], [3, 7]
          ];

          for (const [i1, i2] of edges) {
            const d1 = distances[i1];
            const d2 = distances[i2];

            if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) {
              const t = Math.abs(d1) / (Math.abs(d1) + Math.abs(d2));
              const point = add(
                corners[i1],
                multiplyScalar(subtract(corners[i2], corners[i1]), t)
              );

              const data = trilinearInterpolate(grid, point);
              if (data) {
                intersectionPoints.push({ point, ...data });
              }
            }
          }

          if (intersectionPoints.length >= 3) {
            for (let i = 0; i < intersectionPoints.length; i++) {
              const p = intersectionPoints[i].point;
              vertices.push(p.x, p.y, p.z);

              const formationId = intersectionPoints[i].formationId;
              const formation = formations.find(f => f.id === formationId);
              const color = formation ? hexToRgb(formation.color) : { r: 128, g: 128, b: 128 };
              colors.push(color.r / 255, color.g / 255, color.b / 255);
            }

            for (let i = 1; i < intersectionPoints.length - 1; i++) {
              const baseIdx = vertices.length / 3 - intersectionPoints.length;
              indices.push(baseIdx, baseIdx + i, baseIdx + i + 1);
            }
          }
        }
      }
    }
  }

  if (vertices.length === 0) return null;

  return { vertices, colors, indices };
}
