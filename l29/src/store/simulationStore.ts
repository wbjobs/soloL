import { create } from 'zustand';
import { SimulationStore, DEFAULT_PARAMS } from '@/types/sph';

export const useSimulationStore = create<SimulationStore>((set) => ({
  isRunning: true,
  fps: 0,
  frameTime: 0,
  computeTime: 0,
  params: { ...DEFAULT_PARAMS },

  toggleRunning: () => set((state) => ({ isRunning: !state.isRunning })),

  reset: () => set({}),

  setParams: (newParams) =>
    set((state) => ({
      params: { ...state.params, ...newParams },
    })),

  updateFps: (fps, frameTime, computeTime) =>
    set({
      fps: Math.round(fps),
      frameTime: Math.round(frameTime * 1000) / 1000,
      computeTime: Math.round(computeTime * 1000) / 1000,
    }),
}));
