import { create } from 'zustand';
import type { PointCloud, PointCloudChunk, LODLevel } from '../types';

interface PointCloudState {
  currentPointCloud: PointCloud | null;
  lodLevel: LODLevel;
  isLoading: boolean;
  loadingProgress: number;
  error: string | null;
  visibleChunks: Set<string>;
}

interface PointCloudActions {
  setCurrentPointCloud: (pointCloud: PointCloud | null) => void;
  setLODLevel: (level: LODLevel) => void;
  setLoading: (loading: boolean) => void;
  setLoadingProgress: (progress: number) => void;
  setError: (error: string | null) => void;
  addChunk: (chunk: PointCloudChunk) => void;
  removeChunk: (chunkId: string) => void;
  setVisibleChunks: (chunkIds: Set<string>) => void;
  clearPointCloud: () => void;
}

export const usePointCloudStore = create<PointCloudState & PointCloudActions>((set) => ({
  currentPointCloud: null,
  lodLevel: 1,
  isLoading: false,
  loadingProgress: 0,
  error: null,
  visibleChunks: new Set(),

  setCurrentPointCloud: (pointCloud) => set({ currentPointCloud: pointCloud }),
  setLODLevel: (level) => set({ lodLevel: level }),
  setLoading: (loading) => set({ isLoading: loading }),
  setLoadingProgress: (progress) => set({ loadingProgress: progress }),
  setError: (error) => set({ error }),

  addChunk: (chunk) =>
    set((state) => {
      if (!state.currentPointCloud) return {};
      const newChunks = new Map(state.currentPointCloud.chunks);
      newChunks.set(chunk.id, chunk);
      const newLoadedChunks = new Set(state.currentPointCloud.loadedChunks);
      newLoadedChunks.add(chunk.id);
      return {
        currentPointCloud: {
          ...state.currentPointCloud,
          chunks: newChunks,
          loadedChunks: newLoadedChunks,
        },
      };
    }),

  removeChunk: (chunkId) =>
    set((state) => {
      if (!state.currentPointCloud) return {};
      const newChunks = new Map(state.currentPointCloud.chunks);
      newChunks.delete(chunkId);
      const newLoadedChunks = new Set(state.currentPointCloud.loadedChunks);
      newLoadedChunks.delete(chunkId);
      return {
        currentPointCloud: {
          ...state.currentPointCloud,
          chunks: newChunks,
          loadedChunks: newLoadedChunks,
        },
      };
    }),

  setVisibleChunks: (chunkIds) => set({ visibleChunks: chunkIds }),

  clearPointCloud: () =>
    set({
      currentPointCloud: null,
      visibleChunks: new Set(),
      error: null,
    }),
}));
