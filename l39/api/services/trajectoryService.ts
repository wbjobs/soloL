import { 
  WellTrajectory, 
  Grid3D, 
  Point3D, 
  IntersectionResult, 
  AnalysisReport,
  Formation 
} from '../../shared/types';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export function cubicBezier(
  p0: Point3D, 
  p1: Point3D, 
  p2: Point3D, 
  p3: Point3D, 
  t: number
): Point3D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  
  return {
    x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
    y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y,
    z: mt3 * p0.z + 3 * mt2 * t * p1.z + 3 * mt * t2 * p2.z + t3 * p3.z
  };
}

export function cubicBezierDerivative(
  p0: Point3D, 
  p1: Point3D, 
  p2: Point3D, 
  p3: Point3D, 
  t: number
): Point3D {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  
  return {
    x: 3 * mt2 * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t2 * (p3.x - p2.x),
    y: 3 * mt2 * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t2 * (p3.y - p2.y),
    z: 3 * mt2 * (p1.z - p0.z) + 6 * mt * t * (p2.z - p1.z) + 3 * t2 * (p3.z - p2.z)
  };
}

export function sampleTrajectory(trajectory: WellTrajectory, samplesPerSegment: number = 200): Point3D[] {
  const points: Point3D[] = [];
  
  for (const segment of trajectory.segments) {
    for (let i = 0; i <= samplesPerSegment; i++) {
      const t = i / samplesPerSegment;
      points.push(cubicBezier(segment.p0, segment.p1, segment.p2, segment.p3, t));
    }
  }
  
  return points;
}

export function getValueAtPoint(grid: Grid3D, point: Point3D): { value: number; formationId: number } | null {
  const { dimensions, origin, spacing, values, formationIds } = grid;
  const { nx, ny, nz } = dimensions;
  
  const ix = Math.floor((point.x - origin.x) / spacing.x);
  const iy = Math.floor((point.y - origin.y) / spacing.y);
  const iz = Math.floor((point.z - origin.z) / spacing.z);
  
  if (ix < 0 || ix >= nx - 1 || iy < 0 || iy >= ny - 1 || iz < 0 || iz >= nz - 1) {
    return null;
  }
  
  const fx = ((point.x - origin.x) / spacing.x) - ix;
  const fy = ((point.y - origin.y) / spacing.y) - iy;
  const fz = ((point.z - origin.z) / spacing.z) - iz;
  
  const getIndex = (i: number, j: number, k: number) => k * nx * ny + j * nx + i;
  
  const v000 = values[getIndex(ix, iy, iz)];
  const v100 = values[getIndex(ix + 1, iy, iz)];
  const v010 = values[getIndex(ix, iy + 1, iz)];
  const v110 = values[getIndex(ix + 1, iy + 1, iz)];
  const v001 = values[getIndex(ix, iy, iz + 1)];
  const v101 = values[getIndex(ix + 1, iy, iz + 1)];
  const v011 = values[getIndex(ix, iy + 1, iz + 1)];
  const v111 = values[getIndex(ix + 1, iy + 1, iz + 1)];
  
  const v00 = v000 * (1 - fx) + v100 * fx;
  const v10 = v010 * (1 - fx) + v110 * fx;
  const v01 = v001 * (1 - fx) + v101 * fx;
  const v11 = v011 * (1 - fx) + v111 * fx;
  
  const v0 = v00 * (1 - fy) + v10 * fy;
  const v1 = v01 * (1 - fy) + v11 * fy;
  
  const value = v0 * (1 - fz) + v1 * fz;
  
  const formationId = formationIds[getIndex(ix, iy, iz)];
  
  return { value, formationId };
}

export function calculateGradient(grid: Grid3D, point: Point3D): Point3D | null {
  const { dimensions, origin, spacing } = grid;
  const { nx, ny, nz } = dimensions;
  
  const ix = Math.floor((point.x - origin.x) / spacing.x);
  const iy = Math.floor((point.y - origin.y) / spacing.y);
  const iz = Math.floor((point.z - origin.z) / spacing.z);
  
  if (ix < 1 || ix >= nx - 2 || iy < 1 || iy >= ny - 2 || iz < 1 || iz >= nz - 2) {
    return null;
  }
  
  const getIndex = (i: number, j: number, k: number) => k * nx * ny + j * nx + i;
  
  const vx1 = grid.values[getIndex(ix - 1, iy, iz)];
  const vx2 = grid.values[getIndex(ix + 1, iy, iz)];
  const vy1 = grid.values[getIndex(ix, iy - 1, iz)];
  const vy2 = grid.values[getIndex(ix, iy + 1, iz)];
  const vz1 = grid.values[getIndex(ix, iy, iz - 1)];
  const vz2 = grid.values[getIndex(ix, iy, iz + 1)];
  
  return {
    x: (vx2 - vx1) / (2 * spacing.x),
    y: (vy2 - vy1) / (2 * spacing.y),
    z: (vz2 - vz1) / (2 * spacing.z)
  };
}

export function calculateDipAngle(gradient: Point3D): number {
  const horizontalMagnitude = Math.sqrt(gradient.x * gradient.x + gradient.y * gradient.y);
  const verticalMagnitude = Math.abs(gradient.z);
  
  if (horizontalMagnitude === 0) return 0;
  
  return Math.atan(verticalMagnitude / horizontalMagnitude) * (180 / Math.PI);
}

export function calculateStrikeAngle(gradient: Point3D): number {
  if (gradient.x === 0 && gradient.y === 0) return 0;
  
  let strike = Math.atan2(gradient.x, -gradient.y) * (180 / Math.PI);
  if (strike < 0) strike += 360;
  
  return strike;
}

export function distance(a: Point3D, b: Point3D): number {
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) + 
    Math.pow(a.y - b.y, 2) + 
    Math.pow(a.z - b.z, 2)
  );
}

export function analyzeTrajectory(
  grid: Grid3D,
  trajectory: WellTrajectory,
  formations: Formation[]
): AnalysisReport {
  const samplePoints = sampleTrajectory(trajectory, 300);
  const intersections: IntersectionResult[] = [];
  
  let currentFormationId: number | null = null;
  let entryPoint: Point3D | null = null;
  let entryT = 0;
  let totalLength = 0;
  let maxDepth = 0;
  
  const formationData = new Map<number, { entry: Point3D; entryT: number; entryDepth: number }>();
  
  for (let i = 0; i < samplePoints.length - 1; i++) {
    const point = samplePoints[i];
    const pointData = getValueAtPoint(grid, point);
    
    if (!pointData) continue;
    
    if (point.z > maxDepth) {
      maxDepth = point.z;
    }
    
    if (i > 0) {
      totalLength += distance(samplePoints[i - 1], point);
    }
    
    const formationId = pointData.formationId;
    
    if (!formationData.has(formationId)) {
      formationData.set(formationId, {
        entry: point,
        entryT: i / samplePoints.length,
        entryDepth: point.z
      });
      
      if (currentFormationId !== null && formationData.has(currentFormationId)) {
        const prevData = formationData.get(currentFormationId)!;
        const prevFormation = formations.find(f => f.id === currentFormationId);
        
        if (prevFormation) {
          const gradient = calculateGradient(grid, samplePoints[i - 1]) || { x: 0, y: 0, z: 1 };
          
          intersections.push({
            formationId: currentFormationId,
            formationName: prevFormation.name,
            entryPoint: prevData.entry,
            exitPoint: samplePoints[i - 1],
            thickness: distance(prevData.entry, samplePoints[i - 1]),
            dipAngle: calculateDipAngle(gradient),
            strikeAngle: calculateStrikeAngle(gradient),
            entryDepth: prevData.entryDepth,
            exitDepth: samplePoints[i - 1].z
          });
        }
      }
      
      currentFormationId = formationId;
    }
  }
  
  if (currentFormationId !== null && formationData.has(currentFormationId)) {
    const lastPoint = samplePoints[samplePoints.length - 1];
    const currentData = formationData.get(currentFormationId)!;
    const currentFormation = formations.find(f => f.id === currentFormationId);
    
    if (currentFormation) {
      const gradient = calculateGradient(grid, lastPoint) || { x: 0, y: 0, z: 1 };
      
      intersections.push({
        formationId: currentFormationId,
        formationName: currentFormation.name,
        entryPoint: currentData.entry,
        exitPoint: lastPoint,
        thickness: distance(currentData.entry, lastPoint),
        dipAngle: calculateDipAngle(gradient),
        strikeAngle: calculateStrikeAngle(gradient),
        entryDepth: currentData.entryDepth,
        exitDepth: lastPoint.z
      });
    }
  }
  
  const averageDipAngle = intersections.length > 0
    ? intersections.reduce((sum, i) => sum + i.dipAngle, 0) / intersections.length
    : 0;
  
  return {
    trajectoryId: trajectory.id,
    totalLength,
    maxDepth,
    averageDipAngle,
    intersections,
    createdAt: new Date().toISOString()
  };
}

export function saveTrajectory(trajectory: WellTrajectory): string {
  const dataDir = path.join(process.cwd(), 'data', 'trajectory');
  const id = trajectory.id || uuidv4();
  const filePath = path.join(dataDir, `${id}.json`);
  
  const dataToSave = {
    ...trajectory,
    id,
    createdAt: new Date().toISOString()
  };
  
  fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2));
  return id;
}

export function loadTrajectory(id: string): WellTrajectory | null {
  const dataDir = path.join(process.cwd(), 'data', 'trajectory');
  const filePath = path.join(dataDir, `${id}.json`);
  
  if (!fs.existsSync(filePath)) return null;
  
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function saveReport(report: AnalysisReport): string {
  const dataDir = path.join(process.cwd(), 'data', 'report');
  const id = uuidv4();
  const filePath = path.join(dataDir, `${id}.json`);
  
  const dataToSave = {
    ...report,
    id
  };
  
  fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2));
  return id;
}

export function loadReport(id: string): AnalysisReport | null {
  const dataDir = path.join(process.cwd(), 'data', 'report');
  const filePath = path.join(dataDir, `${id}.json`);
  
  if (!fs.existsSync(filePath)) return null;
  
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function deleteTrajectory(id: string): boolean {
  const dataDir = path.join(process.cwd(), 'data', 'trajectory');
  const filePath = path.join(dataDir, `${id}.json`);
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error deleting trajectory:', error);
    return false;
  }
}

export function generateDefaultTrajectory(): WellTrajectory {
  return {
    id: uuidv4(),
    name: '示例钻井轨迹',
    color: '#ff6b35',
    segments: [
      {
        p0: { x: -300, y: -300, z: 0 },
        p1: { x: -200, y: -200, z: 20 },
        p2: { x: -100, y: -100, z: 40 },
        p3: { x: 0, y: 0, z: 50 }
      },
      {
        p0: { x: 0, y: 0, z: 50 },
        p1: { x: 50, y: 50, z: 55 },
        p2: { x: 100, y: 100, z: 60 },
        p3: { x: 150, y: 150, z: 70 }
      },
      {
        p0: { x: 150, y: 150, z: 70 },
        p1: { x: 200, y: 200, z: 75 },
        p2: { x: 250, y: 250, z: 80 },
        p3: { x: 300, y: 300, z: 95 }
      }
    ],
    samplePoints: []
  };
}
