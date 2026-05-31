import { Point3D, Grid3D, Formation, GeosteeringInfo } from '../../shared/types';
import { loadGrid } from './gridServiceAdvanced.js';

const RESERVOIR_FORMATION_ID = 2;

export function trilinearInterpolate(
  grid: Grid3D,
  x: number,
  y: number,
  z: number
): { value: number; formationId: number } | null {
  const { dimensions, origin, spacing } = grid;
  
  const ix = (x - origin.x) / spacing.x;
  const iy = (y - origin.y) / spacing.y;
  const iz = (z - origin.z) / spacing.z;
  
  if (ix < 0 || ix >= dimensions.nx - 1 ||
      iy < 0 || iy >= dimensions.ny - 1 ||
      iz < 0 || iz >= dimensions.nz - 1) {
    return null;
  }
  
  const ix0 = Math.floor(ix);
  const iy0 = Math.floor(iy);
  const iz0 = Math.floor(iz);
  const ix1 = ix0 + 1;
  const iy1 = iy0 + 1;
  const iz1 = iz0 + 1;
  
  const fx = ix - ix0;
  const fy = iy - iy0;
  const fz = iz - iz0;
  
  const idx000 = iz0 * dimensions.nx * dimensions.ny + iy0 * dimensions.nx + ix0;
  const idx100 = iz0 * dimensions.nx * dimensions.ny + iy0 * dimensions.nx + ix1;
  const idx010 = iz0 * dimensions.nx * dimensions.ny + iy1 * dimensions.nx + ix0;
  const idx110 = iz0 * dimensions.nx * dimensions.ny + iy1 * dimensions.nx + ix1;
  const idx001 = iz1 * dimensions.nx * dimensions.ny + iy0 * dimensions.nx + ix0;
  const idx101 = iz1 * dimensions.nx * dimensions.ny + iy0 * dimensions.nx + ix1;
  const idx011 = iz1 * dimensions.nx * dimensions.ny + iy1 * dimensions.nx + ix0;
  const idx111 = iz1 * dimensions.nx * dimensions.ny + iy1 * dimensions.nx + ix1;
  
  const v000 = grid.values[idx000];
  const v100 = grid.values[idx100];
  const v010 = grid.values[idx010];
  const v110 = grid.values[idx110];
  const v001 = grid.values[idx001];
  const v101 = grid.values[idx101];
  const v011 = grid.values[idx011];
  const v111 = grid.values[idx111];
  
  const value = 
    v000 * (1 - fx) * (1 - fy) * (1 - fz) +
    v100 * fx * (1 - fy) * (1 - fz) +
    v010 * (1 - fx) * fy * (1 - fz) +
    v110 * fx * fy * (1 - fz) +
    v001 * (1 - fx) * (1 - fy) * fz +
    v101 * fx * (1 - fy) * fz +
    v011 * (1 - fx) * fy * fz +
    v111 * fx * fy * fz;
  
  const formationId = grid.formationIds[Math.round(iz) * dimensions.nx * dimensions.ny + Math.round(iy) * dimensions.nx + Math.round(ix)];
  
  return { value, formationId };
}

export function findFormationTop(
  grid: Grid3D,
  x: number,
  y: number,
  targetFormationId: number
): { depth: number; value: number; formationId: number } | null {
  const { dimensions, origin, spacing } = grid;
  
  const ix = Math.round((x - origin.x) / spacing.x);
  const iy = Math.round((y - origin.y) / spacing.y);
  
  if (ix < 0 || ix >= dimensions.nx || iy < 0 || iy >= dimensions.ny) {
    return null;
  }
  
  let topDepth = -1;
  let topValue = 0;
  
  for (let iz = 0; iz < dimensions.nz; iz++) {
    const idx = iz * dimensions.nx * dimensions.ny + iy * dimensions.nx + ix;
    const formationId = grid.formationIds[idx];
    
    if (formationId === targetFormationId) {
      topDepth = origin.z + iz * spacing.z;
      topValue = grid.values[idx];
      break;
    }
  }
  
  if (topDepth < 0) {
    return null;
  }
  
  return {
    depth: topDepth,
    value: topValue,
    formationId: targetFormationId
  };
}

export function findFormationBottom(
  grid: Grid3D,
  x: number,
  y: number,
  targetFormationId: number
): { depth: number; value: number; formationId: number } | null {
  const { dimensions, origin, spacing } = grid;
  
  const ix = Math.round((x - origin.x) / spacing.x);
  const iy = Math.round((y - origin.y) / spacing.y);
  
  if (ix < 0 || ix >= dimensions.nx || iy < 0 || iy >= dimensions.ny) {
    return null;
  }
  
  let bottomDepth = -1;
  let bottomValue = 0;
  
  for (let iz = dimensions.nz - 1; iz >= 0; iz--) {
    const idx = iz * dimensions.nx * dimensions.ny + iy * dimensions.nx + ix;
    const formationId = grid.formationIds[idx];
    
    if (formationId === targetFormationId) {
      bottomDepth = origin.z + iz * spacing.z;
      bottomValue = grid.values[idx];
      break;
    }
  }
  
  if (bottomDepth < 0) {
    return null;
  }
  
  return {
    depth: bottomDepth,
    value: bottomValue,
    formationId: targetFormationId
  };
}

export function calculateGradient(
  grid: Grid3D,
  point: Point3D
): { x: number; y: number; z: number } | null {
  const result = trilinearInterpolate(grid, point.x, point.y, point.z);
  if (!result) return null;
  
  const eps = 5;
  
  const resultXp = trilinearInterpolate(grid, point.x + eps, point.y, point.z);
  const resultXn = trilinearInterpolate(grid, point.x - eps, point.y, point.z);
  const resultYp = trilinearInterpolate(grid, point.x, point.y + eps, point.z);
  const resultYn = trilinearInterpolate(grid, point.x, point.y - eps, point.z);
  const resultZp = trilinearInterpolate(grid, point.x, point.y, point.z + eps);
  const resultZn = trilinearInterpolate(grid, point.x, point.y, point.z - eps);
  
  if (!resultXp || !resultXn || !resultYp || !resultYn || !resultZp || !resultZn) {
    return null;
  }
  
  return {
    x: (resultXp.value - resultXn.value) / (2 * eps),
    y: (resultYp.value - resultYn.value) / (2 * eps),
    z: (resultZp.value - resultZn.value) / (2 * eps)
  };
}

export function calculateDipAngle(gradient: { x: number; y: number; z: number }): number {
  const gradientMag = Math.sqrt(gradient.x ** 2 + gradient.y ** 2 + gradient.z ** 2);
  if (gradientMag === 0) return 0;
  
  const cosAngle = gradient.z / gradientMag;
  return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180 / Math.PI;
}

export function getGeosteeringInfo(
  gridId: string,
  point: Point3D,
  formations: Formation[]
): GeosteeringInfo | null {
  const grid = loadGrid(gridId);
  if (!grid) return null;
  
  const pointData = trilinearInterpolate(grid, point.x, point.y, point.z);
  if (!pointData) return null;
  
  const reservoirTop = findFormationTop(grid, point.x, point.y, RESERVOIR_FORMATION_ID);
  const reservoirBottom = findFormationBottom(grid, point.x, point.y, RESERVOIR_FORMATION_ID);
  
  if (!reservoirTop || !reservoirBottom) {
    return null;
  }
  
  const gradient = calculateGradient(grid, point);
  const dipAngle = gradient ? calculateDipAngle(gradient) : 0;
  
  const currentFormation = formations.find(f => f.id === pointData.formationId);
  
  const distanceToTop = point.z - reservoirTop.depth;
  const distanceToBottom = reservoirBottom.depth - point.z;
  
  const formationThickness = reservoirBottom.depth - reservoirTop.depth;
  
  const targetZone = pointData.formationId === RESERVOIR_FORMATION_ID;
  
  let recommendation = '';
  if (distanceToTop < 5 && distanceToTop > 0) {
    recommendation = '接近储层顶界，注意控制钻速';
  } else if (distanceToTop < 0 && Math.abs(distanceToTop) < 10) {
    recommendation = '已进入储层上方盖层，准备调整方向';
  } else if (targetZone) {
    if (distanceToTop < 5) {
      recommendation = '在储层顶部区域，保持稳定';
    } else if (distanceToBottom < 5) {
      recommendation = '接近储层底界，考虑上提';
    } else {
      recommendation = '在储层目标区内，继续钻进';
    }
  } else if (distanceToBottom < 0) {
    recommendation = '已穿透储层底界，建议上提';
  } else {
    recommendation = '远离目标储层，调整轨迹方向';
  }
  
  return {
    reservoirTop: reservoirTop.depth,
    reservoirBottom: reservoirBottom.depth,
    distanceToTop,
    distanceToBottom,
    currentFormation: currentFormation?.name || '未知',
    formationThickness,
    dipAngle,
    recommendation,
    targetZone
  };
}

export function getReservoirTopSurface(
  gridId: string
): { x: number; y: number; depth: number; value: number }[] | null {
  const grid = loadGrid(gridId);
  if (!grid) return null;
  
  const { dimensions, origin, spacing } = grid;
  const surfacePoints: { x: number; y: number; depth: number; value: number }[] = [];
  
  const step = 4;
  
  for (let ix = 0; ix < dimensions.nx; ix += step) {
    for (let iy = 0; iy < dimensions.ny; iy += step) {
      const result = findFormationTop(
        grid,
        origin.x + ix * spacing.x,
        origin.y + iy * spacing.y,
        RESERVOIR_FORMATION_ID
      );
      
      if (result) {
        surfacePoints.push({
          x: origin.x + ix * spacing.x,
          y: origin.y + iy * spacing.y,
          depth: result.depth,
          value: result.value
        });
      }
    }
  }
  
  return surfacePoints;
}
