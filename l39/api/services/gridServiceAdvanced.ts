import { 
  Grid3D, 
  KrigingParams, 
  Formation, 
  KrigingProgress,
  Fault,
  PotreeMetadata,
  PotreePoint,
  PotreeOctreeNode,
  Point3D
} from '../../shared/types';
import { 
  faultConstrainedKriging, 
  detectFaults, 
  identifyFormation, 
  generateMockControlPoints 
} from '../utils/krigingAdvanced';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

const FORMATIONS: Formation[] = [
  { id: 0, name: '表层沉积物', color: '#f0e68c', minValue: 0, maxValue: 1.5 },
  { id: 1, name: '上覆岩层', color: '#90ee90', minValue: 1.5, maxValue: 3.0 },
  { id: 2, name: '储层段', color: '#87ceeb', minValue: 3.0, maxValue: 4.5 },
  { id: 3, name: '盖层', color: '#dda0dd', minValue: 4.5, maxValue: 6.0 },
  { id: 4, name: '基底', color: '#cd853f', minValue: 6.0, maxValue: 10.0 }
];

interface AdvancedKrigingTask {
  gridId: string;
  progress: KrigingProgress;
  controlPoints: Point3D[];
  values: number[];
  params: KrigingParams;
  dimensions: { nx: number; ny: number; nz: number };
  faults: Fault[];
  confidenceMap: Float32Array | null;
}

const krigingTasks = new Map<string, AdvancedKrigingTask>();

export function getFormations(): Formation[] {
  return FORMATIONS;
}

export function startAdvancedKriging(
  controlPoints: Point3D[],
  values: number[],
  params: KrigingParams,
  dimensions: { nx: number; ny: number; nz: number } = { nx: 200, ny: 200, nz: 100 },
  faults?: Fault[]
): { gridId: string; progress: number } {
  const gridId = uuidv4();
  
  const detectedFaults = faults && faults.length > 0 
    ? faults 
    : params.useIndicatorKriging 
      ? detectFaults(controlPoints, values, 1.5, 3)
      : [];
  
  const task: AdvancedKrigingTask = {
    gridId,
    progress: {
      progress: 0,
      status: 'running'
    },
    controlPoints,
    values,
    params,
    dimensions,
    faults: detectedFaults,
    confidenceMap: null
  };
  
  krigingTasks.set(gridId, task);
  
  setImmediate(() => {
    runAdvancedKriging(gridId);
  });
  
  return { gridId, progress: 0 };
}

export function getKrigingProgress(gridId: string): KrigingProgress {
  const task = krigingTasks.get(gridId);
  if (!task) {
    return { progress: 0, status: 'error', error: 'Task not found' };
  }
  return task.progress;
}

function runAdvancedKriging(gridId: string): void {
  const task = krigingTasks.get(gridId);
  if (!task) return;
  
  try {
    const { controlPoints, values, params, dimensions, faults } = task;
    const { nx, ny, nz } = dimensions;
    const totalVoxels = nx * ny * nz;
    
    const minX = Math.min(...controlPoints.map(p => p.x));
    const maxX = Math.max(...controlPoints.map(p => p.x));
    const minY = Math.min(...controlPoints.map(p => p.y));
    const maxY = Math.max(...controlPoints.map(p => p.y));
    const minZ = Math.min(...controlPoints.map(p => p.z));
    const maxZ = Math.max(...controlPoints.map(p => p.z));
    
    const origin = { x: minX, y: minY, z: minZ };
    const spacing = {
      x: (maxX - minX) / (nx - 1),
      y: (maxY - minY) / (ny - 1),
      z: (maxZ - minZ) / (nz - 1)
    };
    
    const valuesArray = new Float32Array(totalVoxels);
    const formationIds = new Uint8Array(totalVoxels);
    const confidenceMap = new Float32Array(totalVoxels);
    
    let processed = 0;
    
    const processSlice = (zStart: number, zEnd: number) => {
      for (let iz = zStart; iz < zEnd; iz++) {
        const z = origin.z + iz * spacing.z;
        
        for (let iy = 0; iy < ny; iy++) {
          const y = origin.y + iy * spacing.y;
          
          for (let ix = 0; ix < nx; ix++) {
            const x = origin.x + ix * spacing.x;
            const idx = iz * nx * ny + iy * nx + ix;
            
            const result = faultConstrainedKriging(
              { x, y, z }, 
              controlPoints, 
              values, 
              params,
              faults
            );
            
            valuesArray[idx] = result.value;
            formationIds[idx] = identifyFormation(result.value);
            confidenceMap[idx] = result.indicatorProbability;
            
            processed++;
            if (processed % 10000 === 0) {
              task.progress.progress = (processed / totalVoxels) * 100;
            }
          }
        }
      }
    };
    
    const sliceSize = 10;
    for (let zStart = 0; zStart < nz; zStart += sliceSize) {
      const zEnd = Math.min(zStart + sliceSize, nz);
      processSlice(zStart, zEnd);
      
      if (global.gc) {
        global.gc();
      }
    }
    
    const grid: Grid3D = {
      dimensions,
      origin,
      spacing,
      values: Array.from(valuesArray),
      formationIds: Array.from(formationIds)
    };
    
    saveGrid(gridId, grid);
    
    task.confidenceMap = confidenceMap;
    task.progress.progress = 100;
    task.progress.status = 'completed';
    task.progress.gridId = gridId;
    
  } catch (error: any) {
    console.error('Advanced kriging interpolation error:', error);
    task.progress.status = 'error';
    task.progress.error = error.message;
  }
}

export function generatePotreeOctree(gridId: string, grid: Grid3D, formations: Formation[]): string {
  const dataDir = path.join(process.cwd(), 'data', 'potree', gridId);
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  const { dimensions, origin, spacing } = grid;
  const { nx, ny, nz } = dimensions;
  
  const boundingBox = {
    min: { ...origin },
    max: {
      x: origin.x + (nx - 1) * spacing.x,
      y: origin.y + (ny - 1) * spacing.y,
      z: origin.z + (nz - 1) * spacing.z
    },
    center: {
      x: origin.x + (nx - 1) * spacing.x / 2,
      y: origin.y + (ny - 1) * spacing.y / 2,
      z: origin.z + (nz - 1) * spacing.z / 2
    }
  };
  
  const maxDepth = 8;
  const baseSpacing = Math.max(spacing.x, spacing.y, spacing.z);
  
  const rootNode: PotreeOctreeNode = {
    id: 'r',
    level: 0,
    boundingBox: { ...boundingBox },
    pointCount: 0,
    children: [],
    spacing: baseSpacing,
    hasChildren: false,
    hierarchyByteOffset: 0,
    hierarchyByteSize: 0
  };
  
  const allPoints: PotreePoint[] = [];
  
  const step = 8;
  for (let iz = 0; iz < nz; iz += step) {
    for (let iy = 0; iy < ny; iy += step) {
      for (let ix = 0; ix < nx; ix += step) {
        const idx = iz * nx * ny + iy * nx + ix;
        const value = grid.values[idx];
        const formationId = grid.formationIds[idx];
        const formation = formations[formationId];
        
        const x = origin.x + ix * spacing.x;
        const y = origin.y + iy * spacing.y;
        const z = origin.z + iz * spacing.z;
        
        const color = hexToRgb(formation?.color || '#888888');
        
        allPoints.push({
          x, y, z,
          r: color.r,
          g: color.g,
          b: color.b,
          value,
          formationId
        });
      }
    }
  }
  
  rootNode.pointCount = allPoints.length;
  
  buildOctreeHierarchy(rootNode, allPoints, 0, maxDepth, dataDir);
  
  const metadata: PotreeMetadata = {
    name: `grid_${gridId}`,
    version: '1.7',
    octreeType: 'POctree',
    pointAttributes: ['POSITION', 'COLOR_PACKED', 'VALUE', 'FORMATION_ID'],
    projection: '+proj=geocent +datum=WGS84 +units=m +no_defs',
    points: allPoints.length,
    spacing: baseSpacing,
    boundingBox,
    encoding: 'binary',
    hierarchy: {
      firstChunkSize: 1024,
      stepSize: 2,
      depth: maxDepth,
      root: rootNode
    }
  };
  
  fs.writeFileSync(
    path.join(dataDir, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  );
  
  const binaryData = convertPointsToBinary(allPoints);
  fs.writeFileSync(path.join(dataDir, 'r.bin'), binaryData);
  
  return gridId;
}

function buildOctreeHierarchy(
  node: PotreeOctreeNode, 
  points: PotreePoint[], 
  depth: number, 
  maxDepth: number,
  dataDir: string
): void {
  if (depth >= maxDepth || points.length < 100) {
    return;
  }
  
  const center = node.boundingBox.center;
  const childBoxes = splitBoundingBox(node.boundingBox);
  const childPoints: PotreePoint[][] = [[], [], [], [], [], [], [], []];
  
  for (const point of points) {
    const childIndex = getChildIndex(point, center);
    if (childIndex >= 0 && childIndex < 8) {
      childPoints[childIndex].push(point);
    }
  }
  
  const children: string[] = [];
  for (let i = 0; i < 8; i++) {
    if (childPoints[i].length > 50) {
      const childId = node.id + i;
      children.push(childId);
      
      const childNode: PotreeOctreeNode = {
        id: childId,
        level: depth + 1,
        boundingBox: childBoxes[i],
        pointCount: childPoints[i].length,
        children: [],
        spacing: node.spacing / 2,
        hasChildren: false,
        hierarchyByteOffset: 0,
        hierarchyByteSize: 0
      };
      
      if (depth < maxDepth - 1) {
        node.hasChildren = true;
        buildOctreeHierarchy(childNode, childPoints[i], depth + 1, maxDepth, dataDir);
      }
      
      const childData = convertPointsToBinary(childPoints[i]);
      fs.writeFileSync(path.join(dataDir, `${childId}.bin`), childData);
    }
  }
  
  node.children = children;
}

function splitBoundingBox(box: { min: Point3D; max: Point3D; center: Point3D }): { min: Point3D; max: Point3D; center: Point3D }[] {
  const boxes: { min: Point3D; max: Point3D; center: Point3D }[] = [];
  const { min, max, center } = box;
  
  for (let i = 0; i < 8; i++) {
    const childMin = {
      x: (i & 1) ? center.x : min.x,
      y: (i & 2) ? center.y : min.y,
      z: (i & 4) ? center.z : min.z
    };
    const childMax = {
      x: (i & 1) ? max.x : center.x,
      y: (i & 2) ? max.y : center.y,
      z: (i & 4) ? max.z : center.z
    };
    
    boxes.push({
      min: childMin,
      max: childMax,
      center: {
        x: (childMin.x + childMax.x) / 2,
        y: (childMin.y + childMax.y) / 2,
        z: (childMin.z + childMax.z) / 2
      }
    });
  }
  
  return boxes;
}

function getChildIndex(point: PotreePoint, center: Point3D): number {
  let index = 0;
  if (point.x > center.x) index |= 1;
  if (point.y > center.y) index |= 2;
  if (point.z > center.z) index |= 4;
  return index;
}

function convertPointsToBinary(points: PotreePoint[]): Buffer {
  const stride = 20;
  const buffer = Buffer.alloc(points.length * stride);
  
  for (let i = 0; i < points.length; i++) {
    const offset = i * stride;
    const p = points[i];
    
    buffer.writeFloatLE(p.x, offset);
    buffer.writeFloatLE(p.y, offset + 4);
    buffer.writeFloatLE(p.z, offset + 8);
    
    buffer.writeUInt8(Math.round(p.r * 255), offset + 12);
    buffer.writeUInt8(Math.round(p.g * 255), offset + 13);
    buffer.writeUInt8(Math.round(p.b * 255), offset + 14);
    buffer.writeUInt8(255, offset + 15);
    
    buffer.writeFloatLE(p.value, offset + 16);
  }
  
  return buffer;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255
  } : { r: 0.5, g: 0.5, b: 0.5 };
}

export function getPotreeMetadata(gridId: string): PotreeMetadata | null {
  const dataDir = path.join(process.cwd(), 'data', 'potree', gridId);
  const metaPath = path.join(dataDir, 'metadata.json');
  
  if (fs.existsSync(metaPath)) {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }
  return null;
}

export function getPotreeNodeData(gridId: string, nodeId: string): Buffer | null {
  const dataDir = path.join(process.cwd(), 'data', 'potree', gridId);
  const nodePath = path.join(dataDir, `${nodeId}.bin`);
  
  if (fs.existsSync(nodePath)) {
    return fs.readFileSync(nodePath);
  }
  return null;
}

export function generateMockGridAdvanced(
  dimensions: { nx: number; ny: number; nz: number } = { nx: 200, ny: 200, nz: 100 }
): { grid: Grid3D; faults: Fault[] } {
  const { nx, ny, nz } = dimensions;
  const totalVoxels = nx * ny * nz;
  
  const origin = { x: -500, y: -500, z: 0 };
  const spacing = { x: 5, y: 5, z: 1 };
  
  const valuesArray = new Float32Array(totalVoxels);
  const formationIds = new Uint8Array(totalVoxels);
  
  const faults: Fault[] = [
    {
      id: 'fault_1',
      name: '主断层 F1',
      points: [
        { x: 0, y: -500, z: 30, throw: 2.0, confidence: 0.9 },
        { x: 0, y: 0, z: 35, throw: 2.5, confidence: 0.95 },
        { x: 0, y: 500, z: 40, throw: 2.0, confidence: 0.85 }
      ],
      strike: 90,
      dip: 70,
      color: '#ff4757'
    }
  ];
  
  for (let iz = 0; iz < nz; iz++) {
    const z = origin.z + iz * spacing.z;
    const normalizedZ = z / (nz * spacing.z);
    
    for (let iy = 0; iy < ny; iy++) {
      const y = origin.y + iy * spacing.y;
      
      for (let ix = 0; ix < nx; ix++) {
        const x = origin.x + ix * spacing.x;
        const idx = iz * nx * ny + iy * nx + ix;
        
        const distFromCenter = Math.sqrt(x * x + y * y) / 500;
        const noise = Math.sin(x * 0.02) * Math.cos(y * 0.02) * 0.3;
        
        const faultDistance = Math.abs(x);
        const faultZone = faultDistance < 50;
        const faultShift = x > 0 ? 1.5 : -0.5;
        
        let layerValue: number;
        if (normalizedZ < 0.2) {
          layerValue = 1.0 + normalizedZ * 2.5 + noise;
        } else if (normalizedZ < 0.4) {
          layerValue = 1.5 + (normalizedZ - 0.2) * 7.5 + noise;
        } else if (normalizedZ < 0.6) {
          layerValue = 3.0 + (normalizedZ - 0.4) * 7.5 + noise;
        } else if (normalizedZ < 0.8) {
          layerValue = 4.5 + (normalizedZ - 0.6) * 7.5 + noise;
        } else {
          layerValue = 6.0 + (normalizedZ - 0.8) * 10 + noise;
        }
        
        if (faultZone) {
          layerValue += faultShift * (1 - faultDistance / 50);
        }
        
        if (distFromCenter < 0.3) {
          layerValue += Math.sin(z * 0.5) * 0.5 * (1 - distFromCenter * 3);
        }
        
        valuesArray[idx] = layerValue;
        formationIds[idx] = identifyFormation(layerValue);
      }
    }
  }
  
  const grid: Grid3D = {
    dimensions,
    origin,
    spacing,
    values: Array.from(valuesArray),
    formationIds: Array.from(formationIds)
  };
  
  return { grid, faults };
}

export function saveGrid(gridId: string, grid: Grid3D): void {
  const dataDir = path.join(process.cwd(), 'data', 'grid');
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  const valuesBuffer = Buffer.from(new Float32Array(grid.values).buffer);
  const formationBuffer = Buffer.from(new Uint8Array(grid.formationIds).buffer);
  
  fs.writeFileSync(path.join(dataDir, `${gridId}_values.bin`), valuesBuffer);
  fs.writeFileSync(path.join(dataDir, `${gridId}_formation.bin`), formationBuffer);
  
  const meta = {
    id: gridId,
    dimensions: grid.dimensions,
    origin: grid.origin,
    spacing: grid.spacing,
    formations: FORMATIONS,
    createdAt: new Date().toISOString()
  };
  
  fs.writeFileSync(path.join(dataDir, `${gridId}_meta.json`), JSON.stringify(meta, null, 2));
}

export function loadGrid(gridId: string): Grid3D | null {
  const dataDir = path.join(process.cwd(), 'data', 'grid');
  const metaPath = path.join(dataDir, `${gridId}_meta.json`);
  
  if (!fs.existsSync(metaPath)) return null;
  
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  
  const valuesBuffer = fs.readFileSync(path.join(dataDir, `${gridId}_values.bin`));
  const formationBuffer = fs.readFileSync(path.join(dataDir, `${gridId}_formation.bin`));
  
  const values = Array.from(new Float32Array(valuesBuffer.buffer, valuesBuffer.byteOffset, valuesBuffer.length / 4));
  const formationIds = Array.from(new Uint8Array(formationBuffer.buffer, formationBuffer.byteOffset, formationBuffer.length));
  
  return {
    dimensions: meta.dimensions,
    origin: meta.origin,
    spacing: meta.spacing,
    values,
    formationIds
  };
}

export function getGridMeta(gridId: string): any {
  const dataDir = path.join(process.cwd(), 'data', 'grid');
  const metaPath = path.join(dataDir, `${gridId}_meta.json`);
  
  if (fs.existsSync(metaPath)) {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  }
  return null;
}

export function deleteGrid(gridId: string): boolean {
  const dataDir = path.join(process.cwd(), 'data', 'grid');
  
  try {
    const files = ['_values.bin', '_formation.bin', '_meta.json'];
    for (const ext of files) {
      const filePath = path.join(dataDir, `${gridId}${ext}`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    krigingTasks.delete(gridId);
    return true;
  } catch (error) {
    console.error('Error deleting grid:', error);
    return false;
  }
}
