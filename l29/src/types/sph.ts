export interface SPHParams {
  particleCount: number;
  particleRadius: number;
  smoothingRadius: number;
  restDensity: number;
  stiffness: number;
  viscosity: number;
  gravity: number;
  timeStep: number;
  damping: number;
  boundarySize: number;
  colorMode: 'velocity' | 'density' | 'pressure';
  bloomEnabled: boolean;
}

export interface SimulationState {
  isRunning: boolean;
  fps: number;
  frameTime: number;
  computeTime: number;
  params: SPHParams;
}

export interface SimulationActions {
  toggleRunning: () => void;
  reset: () => void;
  setParams: (params: Partial<SPHParams>) => void;
  updateFps: (fps: number, frameTime: number, computeTime: number) => void;
}

export type SimulationStore = SimulationState & SimulationActions;

export const DEFAULT_PARAMS: SPHParams = {
  particleCount: 100000,
  particleRadius: 0.015,
  smoothingRadius: 0.15,
  restDensity: 1000,
  stiffness: 1000,
  viscosity: 30,
  gravity: -9.81,
  timeStep: 0.002,
  damping: 0.3,
  boundarySize: 2.5,
  colorMode: 'velocity',
  bloomEnabled: true,
};
