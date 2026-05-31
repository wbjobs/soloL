import { Grid3D, KrigingParams, Formation, KrigingProgress } from '../../shared/types';
import { ordinaryKriging, identifyFormation, generateMockControlPoints } from '../utils/kriging';
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

interface KrigingTask {
  gridId: string;
  progress: KrigingProgress;
  controlPoints: { x: number; y: number; z: number }[];
  values: number[];
  params: KrigingParams;
  dimensions: { nx: number; ny: number; nz: number };
}

const krigingTasks = new Map<string, KrigingTask>();

export function getFormations(): Formation[] {
  return FORMATIONS;
}

export function startKrigingInterpolation(
  controlPoints: { x: number; y: number; z: number }[],
  values: number[],
  params: KrigingParams,
  dimensions: { nx: number; ny: number; nz: number } = { nx: 200, ny: 200, nz: 100 }
): { gridId: string; progress: number } {
  const gridId = uuidv4();
  
  const task: KrigingTask = {
    gridId,
    progress: {
      progress: 0,
      status: 'running'
    },
    controlPoints,
    values,
    params,
    dimensions
  };
  
  krigingTasks.set(gridId, task);
  
  setImmediate(() => {
    runKrigingInterpolation(gridId);
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

function runKrigingInterpolation(gridId: string): void {
  const task = krigingTasks.get(gridId);
  if (!task) return;
  
  try {
    const { controlPoints, values, params, dimensions } = task;
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
    
    let processed = 0;
    
    const processSlice = (zStart: number, zEnd: number) => {
      for (let iz = zStart; iz < zEnd; iz++) {
        const z = origin.z + iz * spacing.z;
        
        for (let iy = 0; iy < ny; iy++) {
          const y = origin.y + iy * spacing.y;
          
          for (let ix = 0; ix < nx; ix++) {
            const x = origin.x + ix * spacing.x;
            const idx = iz * nx * ny + iy * nx + ix;
            
            const result = ordinaryKriging({ x, y, z }, controlPoints, values, params);
            
            valuesArray[idx] = result.value;
            formationIds[idx] = identifyFormation(result.value);
            
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
    
    task.progress.progress = 100;
    task.progress.status = 'completed';
    task.progress.gridId = gridId;
    
  } catch (error: any) {
    console.error('Kriging interpolation error:', error);
    task.progress.status = 'error';
    task.progress.error = error.message;
  }
}

export function generateMockGrid(dimensions: { nx: number; ny: number; nz: number } = { nx: 200, ny: 200, nz: 100 }): Grid3D {
  const { nx, ny, nz } = dimensions;
  const totalVoxels = nx * ny * nz;
  
  const origin = { x: -500, y: -500, z: 0 };
  const spacing = { x: 5, y: 5, z: 1 };
  
  const valuesArray = new Float32Array(totalVoxels);
  const formationIds = new Uint8Array(totalVoxels);
  
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
        
        if (distFromCenter < 0.3) {
          layerValue += Math.sin(z * 0.5) * 0.5 * (1 - distFromCenter * 3);
        }
        
        valuesArray[idx] = layerValue;
        formationIds[idx] = identifyFormation(layerValue);
      }
    }
  }
  
  return {
    dimensions,
    origin,
    spacing,
    values: Array.from(valuesArray),
    formationIds: Array.from(formationIds)
  };
}

export function saveGrid(gridId: string, grid: Grid3D): void {
  const dataDir = path.join(process.cwd(), 'data', 'grid');
  
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
  
  const task = krigingTasks.get(gridId);
  if (task) {
    saveControlPoints(gridId, task.controlPoints, task.values);
  }
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

export function saveControlPoints(gridId: string, controlPoints: { x: number; y: number; z: number }[], values: number[]): void {
  const dataDir = path.join(process.cwd(), 'data', 'grid');
  const cpData = { controlPoints, values };
  fs.writeFileSync(path.join(dataDir, `${gridId}_controls.json`), JSON.stringify(cpData, null, 2));
}

export function loadControlPoints(gridId: string): { controlPoints: { x: number; y: number; z: number }[]; values: number[] } | null {
  const dataDir = path.join(process.cwd(), 'data', 'grid');
  const cpPath = path.join(dataDir, `${gridId}_controls.json`);
  
  if (!fs.existsSync(cpPath)) return null;
  
  return JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
}

export function deleteGrid(gridId: string): boolean {
  const dataDir = path.join(process.cwd(), 'data', 'grid');
  
  try {
    const files = ['_values.bin', '_formation.bin', '_meta.json', '_controls.json'];
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
