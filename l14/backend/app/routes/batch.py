from fastapi import APIRouter, HTTPException
from datetime import datetime
import uuid
from ..db.models import (
    BatchSolveRequest, BatchSolveResponse, BatchState,
    BatchSolveResult, TaskStatus, ConditionNumberInfo
)
from ..db.redis import redis_client
from ..services.matrix_parser import matrix_parser
from ..config import settings
from ..tasks.solve_tasks import solve_batch, get_batch_result
from ..utils.matrix_utils import estimate_condition_number_lanczos

router = APIRouter(prefix="/api/v1", tags=["batch"])


@router.post("/batch/solve", response_model=BatchSolveResponse)
async def submit_batch_solve(request: BatchSolveRequest):
    matrix_info = matrix_parser.get_matrix_info(request.matrix_id)
    if not matrix_info:
        raise HTTPException(status_code=404, detail="Matrix not found")

    if matrix_info.shape[0] != matrix_info.shape[1]:
        raise HTTPException(
            status_code=400,
            detail="Only square matrices are supported for solving"
        )

    if matrix_info.num_rhs <= 1 and not request.rhs_indices:
        raise HTTPException(
            status_code=400,
            detail="No multiple RHS vectors found. Upload a package containing multiple b vectors, "
                   "or use the single solve endpoint."
        )

    if request.rhs_indices:
        for idx in request.rhs_indices:
            if idx < 0 or idx >= matrix_info.num_rhs:
                raise HTTPException(
                    status_code=400,
                    detail=f"RHS index {idx} out of range (0 to {matrix_info.num_rhs - 1})"
                )

    batch_id = str(uuid.uuid4())
    now = datetime.now()

    try:
        solve_batch.apply_async(
            args=[
                request.matrix_id,
                request.solver.value,
                request.tol,
                request.max_iter,
                request.rhs_indices,
                batch_id,
            ],
            task_id=batch_id,
            soft_time_limit=settings.task_timeout + 300,
            time_limit=settings.task_timeout + 360,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to submit batch task: {str(e)}"
        )

    return BatchSolveResponse(
        batch_id=batch_id,
        task_ids=[],
        num_tasks=len(request.rhs_indices) if request.rhs_indices else matrix_info.num_rhs,
        status=TaskStatus.PENDING,
        created_at=now,
    )


@router.get("/batch/{batch_id}")
async def get_batch_status(batch_id: str):
    batch = redis_client.get_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    task_details = []
    for task_id in batch.task_ids:
        task = redis_client.get_task(task_id)
        if task:
            task_details.append({
                "task_id": task_id,
                "rhs_index": task.rhs_index,
                "status": task.status,
                "progress": task.progress,
                "current_iter": task.current_iter,
                "max_iter": task.max_iter,
                "elapsed_time": task.elapsed_time,
            })
        else:
            task_details.append({"task_id": task_id, "status": TaskStatus.FAILED})

    return {
        "batch_id": batch.batch_id,
        "matrix_id": batch.matrix_id,
        "solver": batch.solver,
        "status": batch.status,
        "progress": batch.progress,
        "completed_count": batch.completed_count,
        "failed_count": batch.failed_count,
        "total_tasks": len(batch.task_ids),
        "created_at": batch.created_at,
        "started_at": batch.started_at,
        "completed_at": batch.completed_at,
        "tasks": task_details,
    }


@router.get("/batch/{batch_id}/result", response_model=BatchSolveResult)
async def get_batch_solve_result(batch_id: str):
    batch = redis_client.get_batch(batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    if batch.status != TaskStatus.COMPLETED and batch.status != TaskStatus.FAILED:
        raise HTTPException(
            status_code=202,
            detail=f"Batch is still {batch.status}. Check /batch/{batch_id} for progress."
        )

    try:
        result = get_batch_result(batch_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/matrix/{matrix_id}/condition", response_model=ConditionNumberInfo)
async def get_matrix_condition(matrix_id: str):
    matrix_info = matrix_parser.get_matrix_info(matrix_id)
    if not matrix_info:
        raise HTTPException(status_code=404, detail="Matrix not found")

    if matrix_info.shape[0] != matrix_info.shape[1]:
        raise HTTPException(
            status_code=400,
            detail="Condition number only defined for square matrices"
        )

    cached = redis_client.get_condition_info(matrix_id)
    if cached:
        info = cached
    else:
        A = matrix_parser.load_matrix(matrix_id)
        if A is None:
            raise HTTPException(status_code=500, detail="Failed to load matrix")

        info = estimate_condition_number_lanczos(A, k=30, max_iter=100)
        if not info:
            raise HTTPException(
                status_code=500,
                detail="Failed to estimate condition number"
            )
        redis_client.save_condition_info(matrix_id, info)

    warning = None
    if info.get("is_ill_conditioned"):
        warning = (
            f"Matrix is ill-conditioned (κ ≈ {info['condition_number']:.2e}). "
            "Solutions may be highly sensitive to numerical errors. "
            "Consider using double precision or preconditioning."
        )

    return ConditionNumberInfo(
        matrix_id=matrix_id,
        lambda_max=info["lambda_max"],
        lambda_min=info["lambda_min"],
        condition_number=info["condition_number"],
        algorithm=info["algorithm"],
        iterations=info["iterations"],
        is_ill_conditioned=info["is_ill_conditioned"],
        warning=warning,
    )
