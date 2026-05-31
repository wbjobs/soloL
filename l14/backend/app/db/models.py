from pydantic import BaseModel, Field
from typing import Optional, List, Tuple, Dict
from datetime import datetime
from enum import Enum


class SolverType(str, Enum):
    CG = "cg"
    GMRES = "gmres"
    SUPERLU = "superlu"


class TaskStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class MatrixInfo(BaseModel):
    matrix_id: str
    filename: str
    shape: Tuple[int, int]
    nnz: int
    sparsity: float
    condition_number: Optional[float] = None
    condition_info: Optional[dict] = None
    num_rhs: int = 1
    uploaded_at: datetime
    file_path: str
    file_hash: str


class SolveRequest(BaseModel):
    matrix_id: str
    solver: SolverType
    tol: float = Field(default=1e-6, ge=1e-12, le=1e-1)
    max_iter: int = Field(default=1000, ge=1, le=10000)
    b_vector: Optional[List[float]] = None
    rhs_index: Optional[int] = None


class SolveResponse(BaseModel):
    task_id: str
    status: TaskStatus
    created_at: datetime


class BatchSolveRequest(BaseModel):
    matrix_id: str
    solver: SolverType
    tol: float = Field(default=1e-6, ge=1e-12, le=1e-1)
    max_iter: int = Field(default=1000, ge=1, le=10000)
    rhs_indices: Optional[List[int]] = None


class BatchSolveResponse(BaseModel):
    batch_id: str
    task_ids: List[str]
    num_tasks: int
    status: TaskStatus
    created_at: datetime


class TaskState(BaseModel):
    task_id: str
    matrix_id: str
    solver: SolverType
    status: TaskStatus
    progress: float = 0.0
    current_iter: int = 0
    max_iter: int
    residual_history: List[float] = Field(default_factory=list)
    elapsed_time: float = 0.0
    error_message: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    rhs_index: Optional[int] = None
    batch_id: Optional[str] = None


class BatchState(BaseModel):
    batch_id: str
    matrix_id: str
    solver: SolverType
    task_ids: List[str]
    status: TaskStatus
    progress: float = 0.0
    completed_count: int = 0
    failed_count: int = 0
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class SolveResult(BaseModel):
    task_id: str
    solver: str
    solve_time: float
    iterations: int
    final_residual: float
    solution_first_10: List[float]
    converged: bool
    rhs_index: Optional[int] = None


class BatchSolveResult(BaseModel):
    batch_id: str
    solver: str
    num_tasks: int
    completed_count: int
    failed_count: int
    results: List[SolveResult]
    solve_times: List[float]
    final_residuals: List[float]
    residual_histories: List[List[float]]
    total_time: float


class ConditionNumberInfo(BaseModel):
    matrix_id: str
    lambda_max: float
    lambda_min: float
    condition_number: float
    algorithm: str
    iterations: int
    is_ill_conditioned: bool
    warning: Optional[str] = None


class MatrixStats(BaseModel):
    matrix_id: str
    shape: Tuple[int, int]
    nnz: int
    sparsity: float
    condition_number: Optional[float]
    condition_info: Optional[dict] = None
    row_nonzero_stats: dict
    col_nonzero_stats: dict


class HeatmapBin(BaseModel):
    x: int
    y: int
    count: int


class HeatmapData(BaseModel):
    matrix_id: str
    rows: int
    cols: int
    bins: List[HeatmapBin]
    sample_points: List[dict]
