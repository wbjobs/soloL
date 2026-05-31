import type {
  MatrixInfo,
  SolveRequest,
  SolveResponse,
  TaskState,
  TaskListItem,
  MatrixStats,
  HeatmapData,
  SolveResult,
  BatchSolveRequest,
  BatchSolveResponse,
  BatchState,
  BatchSolveResult,
  ConditionNumberInfo,
} from '../types';

const API_BASE = 'http://localhost:8000';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
  return response.json();
}

export const api = {
  uploadMatrix: async (file: File, onProgress?: (progress: number) => void): Promise<MatrixInfo> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/api/v1/upload`, {
      method: 'POST',
      body: formData,
    });

    return handleResponse<MatrixInfo>(response);
  },

  getMatrixInfo: async (matrixId: string): Promise<MatrixInfo> => {
    const response = await fetch(`${API_BASE}/api/v1/matrix/${matrixId}`);
    return handleResponse<MatrixInfo>(response);
  },

  submitSolve: async (request: SolveRequest): Promise<SolveResponse> => {
    const response = await fetch(`${API_BASE}/api/v1/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return handleResponse<SolveResponse>(response);
  },

  getTasks: async (limit = 20): Promise<TaskListItem[]> => {
    const response = await fetch(`${API_BASE}/api/v1/tasks?limit=${limit}`);
    const data = await handleResponse<{ tasks: TaskListItem[] }>(response);
    return data.tasks;
  },

  getTask: async (taskId: string): Promise<TaskState> => {
    const response = await fetch(`${API_BASE}/api/v1/tasks/${taskId}`);
    return handleResponse<TaskState>(response);
  },

  getTaskProgress: async (taskId: string): Promise<{
    taskId: string;
    status: string;
    progress: number;
    currentIter: number;
    residualHistory: number[];
    elapsedTime: number;
  }> => {
    const response = await fetch(`${API_BASE}/api/v1/tasks/${taskId}/progress`);
    return handleResponse(response);
  },

  getTaskResult: async (taskId: string): Promise<{
    taskId: string;
    status: string;
    result: SolveResult | null;
  }> => {
    const response = await fetch(`${API_BASE}/api/v1/tasks/${taskId}/result`);
    return handleResponse(response);
  },

  getMatrixStats: async (matrixId: string): Promise<MatrixStats> => {
    const response = await fetch(`${API_BASE}/api/v1/matrix/${matrixId}/stats`);
    return handleResponse<MatrixStats>(response);
  },

  getHeatmapData: async (matrixId: string, bins = 100, maxPoints = 10000): Promise<HeatmapData> => {
    const response = await fetch(
      `${API_BASE}/api/v1/matrix/${matrixId}/heatmap?bins=${bins}&max_points=${maxPoints}`
    );
    return handleResponse<HeatmapData>(response);
  },

  healthCheck: async (): Promise<{ status: string; redis: string }> => {
    const response = await fetch(`${API_BASE}/health`);
    return handleResponse(response);
  },

  submitBatchSolve: async (request: BatchSolveRequest): Promise<BatchSolveResponse> => {
    const response = await fetch(`${API_BASE}/api/v1/batch/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return handleResponse<BatchSolveResponse>(response);
  },

  getBatch: async (batchId: string): Promise<BatchState> => {
    const response = await fetch(`${API_BASE}/api/v1/batch/${batchId}`);
    return handleResponse<BatchState>(response);
  },

  getBatchResult: async (batchId: string): Promise<BatchSolveResult> => {
    const response = await fetch(`${API_BASE}/api/v1/batch/${batchId}/result`);
    return handleResponse<BatchSolveResult>(response);
  },

  getConditionInfo: async (matrixId: string): Promise<ConditionNumberInfo> => {
    const response = await fetch(`${API_BASE}/api/v1/matrix/${matrixId}/condition`);
    return handleResponse<ConditionNumberInfo>(response);
  },

  getRecentBatches: async (limit = 20): Promise<string[]> => {
    const response = await fetch(`${API_BASE}/api/v1/batches?limit=${limit}`);
    const data = await handleResponse<{ batches: string[] }>(response);
    return data.batches;
  },
};
