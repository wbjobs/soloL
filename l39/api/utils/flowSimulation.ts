import { Grid3D, SimulationParams, SimulationCell, SimulationResult, Point3D } from '../../shared/types';

export function initializeSimulationCells(
  grid: Grid3D,
  params: SimulationParams
): SimulationCell[] {
  const { dimensions, origin, spacing } = grid;
  const totalCells = dimensions.nx * dimensions.ny * dimensions.nz;
  const cells: SimulationCell[] = [];

  const RESERVOIR_FORMATION_ID = 2;

  for (let iz = 0; iz < dimensions.nz; iz++) {
    for (let iy = 0; iy < dimensions.ny; iy++) {
      for (let ix = 0; ix < dimensions.nx; ix++) {
        const idx = iz * dimensions.nx * dimensions.ny + iy * dimensions.nx + ix;
        const formationId = grid.formationIds[idx];
        
        const isReservoir = formationId === RESERVOIR_FORMATION_ID;
        
        const permeability = isReservoir 
          ? params.rockProperties.permeability 
          : params.rockProperties.permeability * 0.001;
        const porosity = isReservoir 
          ? params.rockProperties.porosity 
          : params.rockProperties.porosity * 0.1;
        
        const cellVolume = spacing.x * spacing.y * spacing.z;
        const transmissibilityX = permeability * spacing.y * spacing.z / spacing.x;
        const transmissibilityY = permeability * spacing.x * spacing.z / spacing.y;
        const transmissibilityZ = permeability * spacing.x * spacing.y / spacing.z;

        cells.push({
          pressure: isReservoir ? params.reservoirPressure : params.initialPressure,
          oilSaturation: isReservoir ? 0.8 : 0.1,
          waterSaturation: isReservoir ? 0.2 : 0.9,
          permeability,
          porosity,
          transmissibilityX,
          transmissibilityY,
          transmissibilityZ,
          accumulation: porosity * cellVolume / params.rockProperties.compressibility
        });
      }
    }
  }

  return cells;
}

function getCellIndex(ix: number, iy: number, iz: number, nx: number, ny: number): number {
  return iz * nx * ny + iy * nx + ix;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function solvePressureEquation(
  cells: SimulationCell[],
  grid: Grid3D,
  params: SimulationParams,
  wellCells: { ix: number; iy: number; iz: number; wellIndex: number }[],
  dt: number
): boolean {
  const { dimensions } = grid;
  const { nx, ny, nz } = dimensions;
  const totalCells = nx * ny * nz;

  const A: number[][] = [];
  const b: number[] = [];
  
  for (let i = 0; i < totalCells; i++) {
    A.push(new Array(totalCells).fill(0));
    b.push(0);
  }

  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const idx = getCellIndex(ix, iy, iz, nx, ny);
        const cell = cells[idx];
        
        let diag = cell.accumulation / dt;
        let rhs = (cell.accumulation / dt) * cell.pressure;

        if (ix > 0) {
          const neighborIdx = getCellIndex(ix - 1, iy, iz, nx, ny);
          const neighbor = cells[neighborIdx];
          const T = 0.5 * (cell.transmissibilityX + neighbor.transmissibilityX);
          diag += T;
          A[idx][neighborIdx] -= T;
        }

        if (ix < nx - 1) {
          const neighborIdx = getCellIndex(ix + 1, iy, iz, nx, ny);
          const neighbor = cells[neighborIdx];
          const T = 0.5 * (cell.transmissibilityX + neighbor.transmissibilityX);
          diag += T;
          A[idx][neighborIdx] -= T;
        }

        if (iy > 0) {
          const neighborIdx = getCellIndex(ix, iy - 1, iz, nx, ny);
          const neighbor = cells[neighborIdx];
          const T = 0.5 * (cell.transmissibilityY + neighbor.transmissibilityY);
          diag += T;
          A[idx][neighborIdx] -= T;
        }

        if (iy < ny - 1) {
          const neighborIdx = getCellIndex(ix, iy + 1, iz, nx, ny);
          const neighbor = cells[neighborIdx];
          const T = 0.5 * (cell.transmissibilityY + neighbor.transmissibilityY);
          diag += T;
          A[idx][neighborIdx] -= T;
        }

        if (iz > 0) {
          const neighborIdx = getCellIndex(ix, iy, iz - 1, nx, ny);
          const neighbor = cells[neighborIdx];
          const T = 0.5 * (cell.transmissibilityZ + neighbor.transmissibilityZ);
          diag += T;
          A[idx][neighborIdx] -= T;
        }

        if (iz < nz - 1) {
          const neighborIdx = getCellIndex(ix, iy, iz + 1, nx, ny);
          const neighbor = cells[neighborIdx];
          const T = 0.5 * (cell.transmissibilityZ + neighbor.transmissibilityZ);
          diag += T;
          A[idx][neighborIdx] -= T;
        }

        const wellCell = wellCells.find(w => w.ix === ix && w.iy === iy && w.iz === iz);
        if (wellCell) {
          const wellIndex = wellCell.wellIndex;
          const wellPI = 0.001;
          const wellPressure = params.wellPressure;
          diag += wellPI;
          rhs += wellPI * wellPressure;
        }

        A[idx][idx] = diag;
        b[idx] = rhs;
      }
    }
  }

  return gaussSeidel(A, b, cells, 1000, 1e-6);
}

function gaussSeidel(
  A: number[][],
  b: number[],
  cells: SimulationCell[],
  maxIter: number,
  tolerance: number
): boolean {
  const n = b.length;
  const x = cells.map(c => c.pressure);

  for (let iter = 0; iter < maxIter; iter++) {
    let maxError = 0;

    for (let i = 0; i < n; i++) {
      let sum = b[i];
      const diag = A[i][i];

      for (let j = 0; j < n; j++) {
        if (j !== i) {
          sum -= A[i][j] * x[j];
        }
      }

      const newX = sum / diag;
      const error = Math.abs(newX - x[i]);
      if (error > maxError) {
        maxError = error;
      }
      x[i] = newX;
    }

    if (maxError < tolerance) {
      for (let i = 0; i < n; i++) {
        cells[i].pressure = x[i];
      }
      return true;
    }
  }

  for (let i = 0; i < n; i++) {
    cells[i].pressure = x[i];
  }
  return false;
}

export function updateSaturation(
  cells: SimulationCell[],
  grid: Grid3D,
  params: SimulationParams,
  dt: number
): { oilRates: number[]; waterRates: number[] } {
  const { dimensions } = grid;
  const { nx, ny, nz } = dimensions;
  const { fluidProperties } = params;
  
  const oilRates: number[] = [];
  const waterRates: number[] = [];

  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const idx = getCellIndex(ix, iy, iz, nx, ny);
        const cell = cells[idx];

        let totalFluxOil = 0;
        let totalFluxWater = 0;

        const neighbors = [
          { ixn: ix - 1, iyn: iy, izn: iz, T: cell.transmissibilityX },
          { ixn: ix + 1, iyn: iy, izn: iz, T: cell.transmissibilityX },
          { ixn: ix, iyn: iy - 1, izn: iz, T: cell.transmissibilityY },
          { ixn: ix, iyn: iy + 1, izn: iz, T: cell.transmissibilityY },
          { ixn: ix, iyn: iy, izn: iz - 1, T: cell.transmissibilityZ },
          { ixn: ix, iyn: iy, izn: iz + 1, T: cell.transmissibilityZ }
        ];

        for (const neighbor of neighbors) {
          if (neighbor.ixn >= 0 && neighbor.ixn < nx &&
              neighbor.iyn >= 0 && neighbor.iyn < ny &&
              neighbor.izn >= 0 && neighbor.izn < nz) {
            
            const nIdx = getCellIndex(neighbor.ixn, neighbor.iyn, neighbor.izn, nx, ny);
            const neighborCell = cells[nIdx];
            
            const pressureGradient = cell.pressure - neighborCell.pressure;
            
            const kro = cell.oilSaturation > 0.2 ? 
              params.rockProperties.relativePermeabilityOil * Math.pow((cell.oilSaturation - 0.2) / 0.6, 2) : 0;
            const krw = cell.waterSaturation > 0.2 ?
              params.rockProperties.relativePermeabilityWater * Math.pow((cell.waterSaturation - 0.2) / 0.6, 2) : 0;

            const mobilityOil = kro / fluidProperties.oilViscosity;
            const mobilityWater = krw / fluidProperties.waterViscosity;

            const fluxOil = neighbor.T * mobilityOil * pressureGradient;
            const fluxWater = neighbor.T * mobilityWater * pressureGradient;

            totalFluxOil += fluxOil;
            totalFluxWater += fluxWater;
          }
        }

        const cellVolume = grid.spacing.x * grid.spacing.y * grid.spacing.z;
        const poreVolume = cell.porosity * cellVolume;
        
        const dSo = -dt * totalFluxOil / poreVolume;
        const dSw = -dt * totalFluxWater / poreVolume;

        cell.oilSaturation = clamp(cell.oilSaturation + dSo, 0.1, 0.9);
        cell.waterSaturation = clamp(cell.waterSaturation + dSw, 0.1, 0.9);

        oilRates.push(Math.max(0, totalFluxOil));
        waterRates.push(Math.max(0, totalFluxWater));
      }
    }
  }

  return { oilRates, waterRates };
}

export function findWaterOilContact(
  cells: SimulationCell[],
  grid: Grid3D
): Point3D[] {
  const { dimensions, origin, spacing } = grid;
  const { nx, ny } = dimensions;
  const contactPoints: Point3D[] = [];

  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      let contactZ: number | null = null;

      for (let iz = 0; iz < dimensions.nz - 1; iz++) {
        const idxLower = getCellIndex(ix, iy, iz, nx, ny);
        const idxUpper = getCellIndex(ix, iy, iz + 1, nx, ny);

        const lowerSo = cells[idxLower].oilSaturation;
        const upperSo = cells[idxUpper].oilSaturation;

        if (lowerSo > 0.5 && upperSo <= 0.5) {
          const t = (0.5 - lowerSo) / (upperSo - lowerSo);
          contactZ = origin.z + (iz + t) * spacing.z;
          break;
        }
      }

      if (contactZ !== null) {
        contactPoints.push({
          x: origin.x + ix * spacing.x,
          y: origin.y + iy * spacing.y,
          z: contactZ
        });
      }
    }
  }

  return contactPoints;
}

export function runFlowSimulation(
  gridId: string,
  grid: Grid3D,
  params: SimulationParams,
  wellCells: { ix: number; iy: number; iz: number; wellIndex: number }[],
  onProgress?: (progress: number) => void
): SimulationResult {
  const cells = initializeSimulationCells(grid, params);
  const numTimeSteps = Math.floor(params.totalTime / params.timeStep);

  const timeSteps: number[] = [];
  const waterOilContact: Point3D[][] = [];
  const productionData: {
    time: number;
    oilRate: number;
    waterRate: number;
    cumulativeOil: number;
    cumulativeWater: number;
  }[] = [];

  let cumulativeOil = 0;
  let cumulativeWater = 0;

  for (let step = 0; step < numTimeSteps; step++) {
    const time = step * params.timeStep;
    timeSteps.push(time);

    solvePressureEquation(cells, grid, params, wellCells, params.timeStep);
    
    const { oilRates, waterRates } = updateSaturation(cells, grid, params, params.timeStep);
    
    const totalOilRate = oilRates.reduce((sum, r) => sum + r, 0);
    const totalWaterRate = waterRates.reduce((sum, r) => sum + r, 0);
    
    cumulativeOil += totalOilRate * params.timeStep;
    cumulativeWater += totalWaterRate * params.timeStep;

    productionData.push({
      time,
      oilRate: totalOilRate,
      waterRate: totalWaterRate,
      cumulativeOil,
      cumulativeWater
    });

    if (step % 10 === 0 || step === numTimeSteps - 1) {
      waterOilContact.push(findWaterOilContact(cells, grid));
    }

    if (onProgress) {
      onProgress(((step + 1) / numTimeSteps) * 100);
    }
  }

  const finalPressureField = cells.map(c => c.pressure);
  const finalOilSaturation = cells.map(c => c.oilSaturation);

  return {
    gridId,
    params,
    cells,
    timeSteps,
    waterOilContact,
    finalPressureField,
    finalOilSaturation,
    productionData
  };
}

export function calculateRecoverableReserves(
  result: SimulationResult,
  grid: Grid3D
): number {
  const { dimensions, spacing } = grid;
  const cellVolume = spacing.x * spacing.y * spacing.z;
  
  let initialOilVolume = 0;
  let finalOilVolume = 0;
  
  for (let i = 0; i < result.cells.length; i++) {
    const cell = result.cells[i];
    const poreVolume = cell.porosity * cellVolume;
    initialOilVolume += poreVolume * 0.8;
    finalOilVolume += poreVolume * cell.oilSaturation;
  }

  return (initialOilVolume - finalOilVolume) * result.params.fluidProperties.formationVolumeFactorOil;
}
