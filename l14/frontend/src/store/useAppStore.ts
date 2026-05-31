import { create } from 'zustand';
import type {
  MatrixInfo,
  TaskState,
  TaskListItem,
  MatrixStats,
  HeatmapData,
  BatchState,
  BatchSolveResult,
  ConditionNumberInfo,
  BatchSolveRequest,
} from '../types';
import { api } from '../services/api';

interface AppState {
  currentMatrix: MatrixInfo | null;
  currentTask: TaskState | null;
  currentBatch: BatchState | null;
  currentBatchResult: BatchSolveResult | null;
  conditionInfo: ConditionNumberInfo | null;
  recentTasks: TaskListItem[];
  matrixStats: MatrixStats | null;
  heatmapData: HeatmapData | null;
  loading: Record<string, boolean>;
  error: string | null;

  setCurrentMatrix: (matrix: MatrixInfo | null) => void;
  setCurrentTask: (task: TaskState | null) => void;
  setError: (error: string | null) => void;

  uploadMatrix: (file: File) => Promise<MatrixInfo>;
  submitSolve: (request: {
    matrixId: string;
    solver: 'cg' | 'gmres' | 'superlu';
    tol: number;
    maxIter: number;
    bVector?: number[];
    rhsIndex?: number;
  }) => Promise<string>;
  submitBatchSolve: (request: BatchSolveRequest) => Promise<string>;
  fetchTasks: (limit?: number) => Promise<void>;
  fetchTask: (taskId: string, poll?: boolean) => Promise<void>;
  fetchBatch: (batchId: string, poll?: boolean) => Promise<void>;
  fetchBatchResult: (batchId: string) => Promise<void>;
  fetchMatrixStats: (matrixId: string) => Promise<void>;
  fetchHeatmapData: (matrixId: string) => Promise<void>;
  fetchConditionInfo: (matrixId: string) => Promise<void>;
  pollTaskProgress: (taskId: string, interval?: number) => () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  currentMatrix: null,
  currentTask: null,
  currentBatch: null,
  currentBatchResult: null,
  conditionInfo: null,
  recentTasks: [],
  matrixStats: null,
  heatmapData: null,
  loading: {},
  error: null,

  setCurrentMatrix: (matrix) => set({ currentMatrix: matrix }),
  setCurrentTask: (task) => set({ currentTask: task }),
  setError: (error) => set({ error }),

  uploadMatrix: async (file) => {
    set((state) => ({
      loading: { ...state.loading, upload: true },
      error: null,
      conditionInfo: null,
    }));
    try {
      const matrix = await api.uploadMatrix(file);
      set({
        currentMatrix: matrix,
        loading: { ...get().loading, upload: false },
      });
      return matrix;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Upload failed',
        loading: { ...get().loading, upload: false },
      });
      throw error;
    }
  },

  submitSolve: async (request) => {
    set((state) => ({ loading: { ...state.loading, submit: true }, error: null }));
    try {
      const response = await api.submitSolve(request);
      set({ loading: { ...get().loading, submit: false } });
      return response.taskId;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Submit failed',
        loading: { ...get().loading, submit: false },
      });
      throw error;
    }
  },

  submitBatchSolve: async (request) => {
    set((state) => ({ loading: { ...state.loading, submitBatch: true }, error: null }));
    try {
      const response = await api.submitBatchSolve(request);
      set({ loading: { ...get().loading, submitBatch: false } });
      return response.batchId;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Batch submit failed',
        loading: { ...get().loading, submitBatch: false },
      });
      throw error;
    }
  },

  fetchTasks: async (limit = 20) => {
    set((state) => ({ loading: { ...state.loading, tasks: true } }));
    try {
      const tasks = await api.getTasks(limit);
      set({
        recentTasks: tasks,
        loading: { ...get().loading, tasks: false },
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Fetch tasks failed',
        loading: { ...get().loading, tasks: false },
      });
    }
  },

  fetchTask: async (taskId, poll = false) => {
    if (!poll) {
      set((state) => ({ loading: { ...state.loading, task: true } }));
    }
    try {
      const task = await api.getTask(taskId);
      const newState: Partial<AppState> = { currentTask: task };
      if (!poll) {
        newState.loading = { ...get().loading, task: false };
      }
      set(newState);
    } catch (error) {
      if (!poll) {
        set({
          error: error instanceof Error ? error.message : 'Fetch task failed',
          loading: { ...get().loading, task: false },
        });
      }
    }
  },

  fetchBatch: async (batchId, poll = false) => {
    if (!poll) {
      set((state) => ({ loading: { ...state.loading, batch: true } }));
    }
    try {
      const batch = await api.getBatch(batchId);
      const newState: Partial<AppState> = { currentBatch: batch };
      if (!poll) {
        newState.loading = { ...get().loading, batch: false };
      }
      set(newState);
    } catch (error) {
      if (!poll) {
        set({
          error: error instanceof Error ? error.message : 'Fetch batch failed',
          loading: { ...get().loading, batch: false },
        });
      }
    }
  },

  fetchBatchResult: async (batchId) => {
    set((state) => ({ loading: { ...state.loading, batchResult: true } }));
    try {
      const result = await api.getBatchResult(batchId);
      set({
        currentBatchResult: result,
        loading: { ...get().loading, batchResult: false },
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Fetch batch result failed',
        loading: { ...get().loading, batchResult: false },
      });
    }
  },

  fetchMatrixStats: async (matrixId) => {
    set((state) => ({ loading: { ...state.loading, stats: true } }));
    try {
      const stats = await api.getMatrixStats(matrixId);
      set({
        matrixStats: stats,
        loading: { ...get().loading, stats: false },
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Fetch stats failed',
        loading: { ...get().loading, stats: false },
      });
    }
  },

  fetchHeatmapData: async (matrixId) => {
    set((state) => ({ loading: { ...state.loading, heatmap: true } }));
    try {
      const data = await api.getHeatmapData(matrixId);
      set({
        heatmapData: data,
        loading: { ...get().loading, heatmap: false },
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Fetch heatmap failed',
        loading: { ...get().loading, heatmap: false },
      });
    }
  },

  fetchConditionInfo: async (matrixId) => {
    set((state) => ({ loading: { ...state.loading, condition: true } }));
    try {
      const info = await api.getConditionInfo(matrixId);
      set({
        conditionInfo: info,
        loading: { ...get().loading, condition: false },
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Fetch condition info failed',
        loading: { ...get().loading, condition: false },
      });
    }
  },

  pollTaskProgress: (taskId, interval = 2000) => {
    const poll = async () => {
      const task = get().currentTask;
      if (task && (task.status === 'completed' || task.status === 'failed')) {
        return;
      }
      await get().fetchTask(taskId, true);
    };

    const timer = setInterval(poll, interval);
    poll();

    return () => clearInterval(timer);
  },
}));
