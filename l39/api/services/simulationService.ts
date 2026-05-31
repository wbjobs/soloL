import { Grid3D, SimulationParams, SimulationResult, MonteCarloParams, MonteCarloResult, KrigingParams } from '../../shared/types';
import { runFlowSimulation, calculateRecoverableReserves } from '../utils/flowSimulation.js';
import { runMonteCarloSimulation } from '../utils/monteCarlo.js';
import { loadGrid, saveGrid } from './gridServiceAdvanced.js';
import { loadControlPoints } from './gridService.js';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SIMULATION_DIR = path.join(process.cwd(), 'data', 'simulations');
const MONTE_CARLO_DIR = path.join(process.cwd(), 'data', 'montecarlo');

if (!fs.existsSync(SIMULATION_DIR)) {
  fs.mkdirSync(SIMULATION_DIR, { recursive: true });
}
if (!fs.existsSync(MONTE_CARLO_DIR)) {
  fs.mkdirSync(MONTE_CARLO_DIR, { recursive: true });
}

interface SimulationTask {
  simulationId: string;
  progress: number;
  status: 'idle' | 'running' | 'completed' | 'error';
  result?: SimulationResult;
  error?: string;
}

interface MonteCarloTask {
  mcId: string;
  progress: number;
  currentSim: number;
  totalSims: number;
  status: 'idle' | 'running' | 'completed' | 'error';
  result?: MonteCarloResult;
  error?: string;
}

const simulationTasks = new Map<string, SimulationTask>();
const monteCarloTasks = new Map<string, MonteCarloTask>();

export function startFlowSimulation(
  gridId: string,
  params: SimulationParams,
  wellPoints: { x: number; y: number; z: number }[]
): { simulationId: string; progress: number } {
  const grid = loadGrid(gridId);
  if (!grid) {
    throw new Error('Grid not found');
  }

  const simulationId = uuidv4();
  
  const wellCells = wellPoints.map((point, wellIndex) => {
    const ix = Math.round((point.x - grid.origin.x) / grid.spacing.x);
    const iy = Math.round((point.y - grid.origin.y) / grid.spacing.y);
    const iz = Math.round((point.z - grid.origin.z) / grid.spacing.z);
    return { ix, iy, iz, wellIndex };
  }).filter(cell => 
    cell.ix >= 0 && cell.ix < grid.dimensions.nx &&
    cell.iy >= 0 && cell.iy < grid.dimensions.ny &&
    cell.iz >= 0 && cell.iz < grid.dimensions.nz
  );

  const task: SimulationTask = {
    simulationId,
    progress: 0,
    status: 'running'
  };
  simulationTasks.set(simulationId, task);

  setTimeout(() => {
    try {
      const result = runFlowSimulation(
        gridId,
        grid,
        params,
        wellCells,
        (progress) => {
          task.progress = progress;
        }
      );
      
      const resultPath = path.join(SIMULATION_DIR, `${simulationId}.json`);
      fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
      
      task.status = 'completed';
      task.result = result;
    } catch (error) {
      task.status = 'error';
      task.error = error instanceof Error ? error.message : 'Unknown error';
    }
  }, 0);

  return { simulationId, progress: 0 };
}

export function getSimulationProgress(simulationId: string): { progress: number; status: string; result?: SimulationResult; error?: string } {
  const task = simulationTasks.get(simulationId);
  if (!task) {
    const resultPath = path.join(SIMULATION_DIR, `${simulationId}.json`);
    if (fs.existsSync(resultPath)) {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8')) as SimulationResult;
      return { progress: 100, status: 'completed', result };
    }
    return { progress: 0, status: 'not_found' };
  }
  return {
    progress: task.progress,
    status: task.status,
    result: task.result,
    error: task.error
  };
}

export function getSimulationResult(simulationId: string): SimulationResult | null {
  const resultPath = path.join(SIMULATION_DIR, `${simulationId}.json`);
  if (!fs.existsSync(resultPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(resultPath, 'utf-8')) as SimulationResult;
}

export function listSimulations(gridId?: string): { simulationId: string; gridId: string; createdAt: string }[] {
  const files = fs.readdirSync(SIMULATION_DIR).filter(f => f.endsWith('.json'));
  const simulations: { simulationId: string; gridId: string; createdAt: string }[] = [];
  
  for (const file of files) {
    const simulationId = path.basename(file, '.json');
    const resultPath = path.join(SIMULATION_DIR, file);
    try {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8')) as SimulationResult;
      if (!gridId || result.gridId === gridId) {
        const stats = fs.statSync(resultPath);
        simulations.push({
          simulationId,
          gridId: result.gridId,
          createdAt: stats.birthtime.toISOString()
        });
      }
    } catch (e) {
      continue;
    }
  }
  
  return simulations;
}

export function startMonteCarloSimulation(
  gridId: string,
  monteCarloParams: MonteCarloParams,
  baseKrigingParams: KrigingParams,
  simulationParams: SimulationParams,
  wellPoints: { x: number; y: number; z: number }[]
): { mcId: string; progress: number } {
  const controlData = loadControlPoints(gridId);
  if (!controlData) {
    throw new Error('Control points not found for grid');
  }

  const grid = loadGrid(gridId);
  if (!grid) {
    throw new Error('Grid not found');
  }

  const mcId = uuidv4();
  
  const task: MonteCarloTask = {
    mcId,
    progress: 0,
    currentSim: 0,
    totalSims: monteCarloParams.numSimulations,
    status: 'running'
  };
  monteCarloTasks.set(mcId, task);

  setTimeout(() => {
    try {
      const result = runMonteCarloSimulation(
        gridId,
        controlData.controlPoints,
        controlData.values,
        baseKrigingParams,
        simulationParams,
        wellPoints,
        monteCarloParams,
        grid.dimensions,
        grid.origin,
        grid.spacing,
        (progress, currentSim, totalSims) => {
          task.progress = progress;
          task.currentSim = currentSim;
          task.totalSims = totalSims;
        }
      );
      
      const resultPath = path.join(MONTE_CARLO_DIR, `${mcId}.json`);
      fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
      
      task.status = 'completed';
      task.result = result;
    } catch (error) {
      task.status = 'error';
      task.error = error instanceof Error ? error.message : 'Unknown error';
    }
  }, 0);

  return { mcId, progress: 0 };
}

export function getMonteCarloProgress(mcId: string): { 
  progress: number; 
  currentSim: number; 
  totalSims: number;
  status: string; 
  result?: MonteCarloResult;
  error?: string;
} {
  const task = monteCarloTasks.get(mcId);
  if (!task) {
    const resultPath = path.join(MONTE_CARLO_DIR, `${mcId}.json`);
    if (fs.existsSync(resultPath)) {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8')) as MonteCarloResult;
      return { progress: 100, currentSim: result.params.numSimulations, totalSims: result.params.numSimulations, status: 'completed', result };
    }
    return { progress: 0, currentSim: 0, totalSims: 0, status: 'not_found' };
  }
  return {
    progress: task.progress,
    currentSim: task.currentSim,
    totalSims: task.totalSims,
    status: task.status,
    result: task.result,
    error: task.error
  };
}

export function getMonteCarloResult(mcId: string): MonteCarloResult | null {
  const resultPath = path.join(MONTE_CARLO_DIR, `${mcId}.json`);
  if (!fs.existsSync(resultPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(resultPath, 'utf-8')) as MonteCarloResult;
}

export function listMonteCarloSimulations(gridId?: string): { mcId: string; gridId: string; createdAt: string; numSims: number }[] {
  const files = fs.readdirSync(MONTE_CARLO_DIR).filter(f => f.endsWith('.json'));
  const simulations: { mcId: string; gridId: string; createdAt: string; numSims: number }[] = [];
  
  for (const file of files) {
    const mcId = path.basename(file, '.json');
    const resultPath = path.join(MONTE_CARLO_DIR, file);
    try {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8')) as MonteCarloResult;
      if (!gridId || result.gridId === gridId) {
        const stats = fs.statSync(resultPath);
        simulations.push({
          mcId,
          gridId: result.gridId,
          createdAt: stats.birthtime.toISOString(),
          numSims: result.params.numSimulations
        });
      }
    } catch (e) {
      continue;
    }
  }
  
  return simulations;
}
