import { 
  Grid3D, 
  MonteCarloParams, 
  MonteCarloResult, 
  KrigingParams,
  SimulationParams,
  SimulationResult
} from '../../shared/types';
import { runFlowSimulation, calculateRecoverableReserves } from './flowSimulation.js';
import { faultConstrainedKriging, detectFaults } from './krigingAdvanced.js';

function boxMullerTransform(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function sampleNormal(mean: number, std: number, min: number, max: number): number {
  const z = boxMullerTransform();
  const value = mean + z * std;
  return Math.max(min, Math.min(max, value));
}

function sampleLogNormal(mean: number, std: number, min: number, max: number): number {
  const lnMean = Math.log(mean * mean / Math.sqrt(std * std + mean * mean));
  const lnStd = Math.sqrt(Math.log(1 + (std * std) / (mean * mean)));
  const z = boxMullerTransform();
  const value = Math.exp(lnMean + z * lnStd);
  return Math.max(min, Math.min(max, value));
}

function calculatePercentiles(values: number[]): { P10: number; P50: number; P90: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  
  const P90 = sorted[Math.floor(n * 0.1)];
  const P50 = sorted[Math.floor(n * 0.5)];
  const P10 = sorted[Math.floor(n * 0.9)];
  
  return { P10, P50, P90 };
}

function calculateStatistics(values: number[]): { 
  P10: number; 
  P50: number; 
  P90: number; 
  mean: number; 
  std: number 
} {
  const percentiles = calculatePercentiles(values);
  
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const std = Math.sqrt(variance);
  
  return { ...percentiles, mean, std };
}

function buildGridFromKriging(
  controlPoints: { x: number; y: number; z: number }[],
  values: number[],
  krigingParams: KrigingParams,
  dimensions: { nx: number; ny: number; nz: number },
  origin: { x: number; y: number; z: number },
  spacing: { x: number; y: number; z: number }
): Grid3D {
  const faults = detectFaults(controlPoints, values, 2.0, 5);
  
  const totalCells = dimensions.nx * dimensions.ny * dimensions.nz;
  const gridValues: number[] = new Array(totalCells);
  const formationIds: number[] = new Array(totalCells);
  
  for (let iz = 0; iz < dimensions.nz; iz++) {
    for (let iy = 0; iy < dimensions.ny; iy++) {
      for (let ix = 0; ix < dimensions.nx; ix++) {
        const idx = iz * dimensions.nx * dimensions.ny + iy * dimensions.nx + ix;
        
        const point = {
          x: origin.x + ix * spacing.x,
          y: origin.y + iy * spacing.y,
          z: origin.z + iz * spacing.z
        };
        
        const result = faultConstrainedKriging(
          point,
          controlPoints,
          values,
          krigingParams,
          faults
        );
        
        gridValues[idx] = result.value;
        
        if (result.value < 1.5) formationIds[idx] = 0;
        else if (result.value < 3.0) formationIds[idx] = 1;
        else if (result.value < 4.5) formationIds[idx] = 2;
        else if (result.value < 6.0) formationIds[idx] = 3;
        else formationIds[idx] = 4;
      }
    }
  }
  
  return {
    dimensions,
    origin,
    spacing,
    values: gridValues,
    formationIds
  };
}

function findWellCells(
  grid: Grid3D,
  wellPoints: { x: number; y: number; z: number }[]
): { ix: number; iy: number; iz: number; wellIndex: number }[] {
  const cells: { ix: number; iy: number; iz: number; wellIndex: number }[] = [];
  
  wellPoints.forEach((point, wellIndex) => {
    const ix = Math.round((point.x - grid.origin.x) / grid.spacing.x);
    const iy = Math.round((point.y - grid.origin.y) / grid.spacing.y);
    const iz = Math.round((point.z - grid.origin.z) / grid.spacing.z);
    
    if (ix >= 0 && ix < grid.dimensions.nx &&
        iy >= 0 && iy < grid.dimensions.ny &&
        iz >= 0 && iz < grid.dimensions.nz) {
      cells.push({ ix, iy, iz, wellIndex });
    }
  });
  
  return cells;
}

export function runMonteCarloSimulation(
  gridId: string,
  baseControlPoints: { x: number; y: number; z: number }[],
  baseValues: number[],
  baseKrigingParams: KrigingParams,
  simulationParams: SimulationParams,
  wellPoints: { x: number; y: number; z: number }[],
  monteCarloParams: MonteCarloParams,
  dimensions: { nx: number; ny: number; nz: number },
  origin: { x: number; y: number; z: number },
  spacing: { x: number; y: number; z: number },
  onProgress?: (progress: number, currentSim: number, totalSims: number) => void
): MonteCarloResult {
  const { numSimulations } = monteCarloParams;
  
  const realizations: {
    range: number;
    sill: number;
    permeability: number;
    porosity: number;
    recoverableReserves: number;
    finalOilSaturation: number;
    waterBreakthroughTime: number;
  }[] = [];
  
  for (let sim = 0; sim < numSimulations; sim++) {
    const sampledRange = sampleNormal(
      monteCarloParams.rangeDistribution.mean,
      monteCarloParams.rangeDistribution.std,
      monteCarloParams.rangeDistribution.min,
      monteCarloParams.rangeDistribution.max
    );
    
    const sampledSill = sampleNormal(
      monteCarloParams.sillDistribution.mean,
      monteCarloParams.sillDistribution.std,
      monteCarloParams.sillDistribution.min,
      monteCarloParams.sillDistribution.max
    );
    
    const sampledPermeability = sampleLogNormal(
      monteCarloParams.permeabilityDistribution.mean,
      monteCarloParams.permeabilityDistribution.std,
      monteCarloParams.permeabilityDistribution.min,
      monteCarloParams.permeabilityDistribution.max
    );
    
    const sampledPorosity = sampleNormal(
      monteCarloParams.porosityDistribution.mean,
      monteCarloParams.porosityDistribution.std,
      monteCarloParams.porosityDistribution.min,
      monteCarloParams.porosityDistribution.max
    );
    
    const krigingParams: KrigingParams = {
      ...baseKrigingParams,
      range: sampledRange,
      sill: sampledSill
    };
    
    const grid = buildGridFromKriging(
      baseControlPoints,
      baseValues,
      krigingParams,
      dimensions,
      origin,
      spacing
    );
    
    const simParams: SimulationParams = {
      ...simulationParams,
      rockProperties: {
        ...simulationParams.rockProperties,
        permeability: sampledPermeability,
        porosity: sampledPorosity
      }
    };
    
    const wellCells = findWellCells(grid, wellPoints);
    
    const result = runFlowSimulation(
      gridId,
      grid,
      simParams,
      wellCells
    );
    
    const recoverableReserves = calculateRecoverableReserves(result, grid);
    
    const avgOilSaturation = result.finalOilSaturation.reduce((sum, s) => sum + s, 0) / result.finalOilSaturation.length;
    
    let waterBreakthroughTime = simulationParams.totalTime;
    for (let i = 0; i < result.productionData.length; i++) {
      if (result.productionData[i].waterRate > result.productionData[i].oilRate) {
        waterBreakthroughTime = result.productionData[i].time;
        break;
      }
    }
    
    realizations.push({
      range: sampledRange,
      sill: sampledSill,
      permeability: sampledPermeability,
      porosity: sampledPorosity,
      recoverableReserves,
      finalOilSaturation: avgOilSaturation,
      waterBreakthroughTime
    });
    
    if (onProgress) {
      onProgress(((sim + 1) / numSimulations) * 100, sim + 1, numSimulations);
    }
  }
  
  const reservesValues = realizations.map(r => r.recoverableReserves);
  const saturationValues = realizations.map(r => r.finalOilSaturation);
  const breakthroughValues = realizations.map(r => r.waterBreakthroughTime);
  
  const reservesStats = calculateStatistics(reservesValues);
  const saturationStats = calculateStatistics(saturationValues);
  const breakthroughStats = calculateStatistics(breakthroughValues);
  
  const sortedReserves = [...reservesValues].sort((a, b) => a - b);
  const sortedSaturation = [...saturationValues].sort((a, b) => a - b);
  const sortedBreakthrough = [...breakthroughValues].sort((a, b) => a - b);
  
  return {
    id: `mc_${Date.now()}`,
    gridId,
    params: monteCarloParams,
    realizations,
    statistics: {
      recoverableReserves: reservesStats,
      finalOilSaturation: saturationStats,
      waterBreakthroughTime: breakthroughStats
    },
    percentiles: {
      reserves: sortedReserves,
      saturation: sortedSaturation,
      breakthrough: sortedBreakthrough
    }
  };
}

export function generateCDFData(values: number[], numBins: number = 50): { x: number; cdf: number }[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  
  const min = sorted[0];
  const max = sorted[n - 1];
  const binWidth = (max - min) / numBins;
  
  const cdfData: { x: number; cdf: number }[] = [];
  
  for (let i = 0; i <= numBins; i++) {
    const x = min + i * binWidth;
    let count = 0;
    for (const v of sorted) {
      if (v <= x) count++;
    }
    cdfData.push({ x, cdf: count / n });
  }
  
  return cdfData;
}

export function generatePDFData(values: number[], numBins: number = 50): { x: number; pdf: number }[] {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  
  const min = sorted[0];
  const max = sorted[n - 1];
  const binWidth = (max - min) / numBins;
  
  const pdfData: { x: number; pdf: number }[] = [];
  const counts = new Array(numBins).fill(0);
  
  for (const v of sorted) {
    const binIdx = Math.min(Math.floor((v - min) / binWidth), numBins - 1);
    counts[binIdx]++;
  }
  
  for (let i = 0; i < numBins; i++) {
    pdfData.push({
      x: min + (i + 0.5) * binWidth,
      pdf: counts[i] / (n * binWidth)
    });
  }
  
  return pdfData;
}
