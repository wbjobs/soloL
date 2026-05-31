import { create } from 'zustand';

export interface SimulationParams {
  emissionRate: number;
  erosionStrength: number;
  transportCoefficient: number;
  depositionThreshold: number;
  viscosity: number;
  smoothingRadius: number;
  restDensity: number;
  gravity: number;
  particleMass: number;
  maxParticles: number;
  isPaused: boolean;
  showTerrainWireframe: boolean;
  showParticles: boolean;
}

export interface SimulationState extends SimulationParams {
  fps: number;
  particleCount: number;
  setParams: (params: Partial<SimulationParams>) => void;
  setFps: (fps: number) => void;
  setParticleCount: (count: number) => void;
  reset: () => void;
}

const defaultParams: SimulationParams = {
  emissionRate: 30,
  erosionStrength: 0.3,
  transportCoefficient: 0.6,
  depositionThreshold: 0.2,
  viscosity: 0.01,
  smoothingRadius: 0.15,
  restDensity: 1000,
  gravity: -9.8,
  particleMass: 1.0,
  maxParticles: 5000,
  isPaused: false,
  showTerrainWireframe: false,
  showParticles: true,
};

export const useSimulationStore = create<SimulationState>((set) => ({
  ...defaultParams,
  fps: 0,
  particleCount: 0,
  setParams: (params) => set((state) => ({ ...state, ...params })),
  setFps: (fps) => set({ fps }),
  setParticleCount: (particleCount) => set({ particleCount }),
  reset: () => set(defaultParams),
}));
