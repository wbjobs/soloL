export type SolverType = 'cg' | 'gmres' | 'superlu';
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface MatrixInfo {
  matrixId: string;
  filename: string;
  shape: [number, number];
  nnz: number;
  sparsity: number;
  conditionNumber: number | null;
  conditionInfo?: ConditionNumberInfo | null;
  numRhs: number;
  uploadedAt: string;
}

export interface SolveRequest {
  matrixId: string;
  solver: SolverType;
  tol: number;
  maxIter: number;
  bVector?: number[];
  rhsIndex?: number;
}

export interface SolveResponse {
  taskId: string;
  status: TaskStatus;
  createdAt: string;
}

export interface BatchSolveRequest {
  matrixId: string;
  solver: SolverType;
  tol: number;
  maxIter: number;
  rhsIndices?: number[];
}

export interface BatchSolveResponse {
  batchId: string;
  taskIds: string[];
  numTasks: number;
  status: TaskStatus;
  createdAt: string;
}

export interface BatchState {
  batchId: string;
  matrixId: string;
  solver: SolverType;
  taskIds: string[];
  status: TaskStatus;
  progress: number;
  completedCount: number;
  failedCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  tasks?: TaskState[];
}

export interface BatchSolveResult {
  batchId: string;
  solver: string;
  numTasks: number;
  completedCount: number;
  failedCount: number;
  results: SolveResult[];
  solveTimes: number[];
  finalResiduals: number[];
  residualHistories: number[][];
  totalTime: number;
}

export interface TaskState {
  taskId: string;
  matrixId: string;
  solver: SolverType;
  status: TaskStatus;
  progress: number;
  currentIter: number;
  maxIter: number;
  residualHistory: number[];
  elapsedTime: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  rhsIndex?: number | null;
  batchId?: string | null;
  result?: SolveResult;
}

export interface SolveResult {
  taskId: string;
  solver: string;
  solveTime: number;
  iterations: number;
  finalResidual: number;
  solutionFirst10: number[];
  converged: boolean;
  rhsIndex?: number | null;
}

export interface ConditionNumberInfo {
  matrixId: string;
  lambdaMax: number;
  lambdaMin: number;
  conditionNumber: number;
  algorithm: string;
  iterations: number;
  isIllConditioned: boolean;
  warning?: string | null;
}

export interface MatrixStats {
  matrixId: string;
  shape: [number, number];
  nnz: number;
  sparsity: number;
  conditionNumber: number | null;
  conditionInfo?: ConditionNumberInfo | null;
  numRhs?: number;
  rowNonzeroStats: {
    mean: number;
    std: number;
    max: number;
    min: number;
  };
  colNonzeroStats: {
    mean: number;
    std: number;
    max: number;
    min: number;
  };
  valueStats?: {
    mean: number;
    std: number;
    max: number;
    min: number;
  };
}

export interface HeatmapBin {
  x: number;
  y: number;
  count: number;
}

export interface HeatmapData {
  matrixId: string;
  rows: number;
  cols: number;
  numBins: number;
  bins: HeatmapBin[];
  samplePoints: { x: number; y: number; value: number }[];
}

export interface TaskListItem {
  taskId: string;
  matrixId: string;
  solver: SolverType;
  status: TaskStatus;
  progress: number;
  currentIter: number;
  maxIter: number;
  elapsedTime: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  rhsIndex?: number | null;
  batchId?: string | null;
}
