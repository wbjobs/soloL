from fastapi import APIRouter, HTTPException
from datetime import datetime
import uuid
from ..db.models import SolveRequest, SolveResponse, TaskState, TaskStatus, SolverType
from ..db.redis import redis_client
from ..services.matrix_parser import matrix_parser
from ..config import settings
from ..tasks.solve_tasks import solve_linear_system

router = APIRouter(prefix="/api/v1", tags=["solve"])


@router.post("/solve", response_model=SolveResponse)
async def submit_solve_task(request: SolveRequest):
    matrix_info = matrix_parser.get_matrix_info(request.matrix_id)
    if not matrix_info:
        raise HTTPException(status_code=404, detail="Matrix not found")

    if matrix_info.shape[0] != matrix_info.shape[1]:
        raise HTTPException(
            status_code=400,
            detail="Only square matrices are supported for solving"
        )

    if request.b_vector and len(request.b_vector) != matrix_info.shape[0]:
        raise HTTPException(
            status_code=400,
            detail=f"b vector size must match matrix size ({matrix_info.shape[0]})"
        )

    if request.solver == SolverType.CG and matrix_info.condition_number:
        if matrix_info.condition_number > 1e10:
            pass

    task_id = str(uuid.uuid4())
    now = datetime.now()

    task_state = TaskState(
        task_id=task_id,
        matrix_id=request.matrix_id,
        solver=request.solver,
        status=TaskStatus.PENDING,
        max_iter=request.max_iter,
        created_at=now,
    )

    redis_client.create_task(task_state)

    try:
        solve_linear_system.apply_async(
            args=[
                request.matrix_id,
                request.solver.value,
                request.tol,
                request.max_iter,
                request.b_vector if request.b_vector else None,
                task_id,
            ],
            task_id=task_id,
            soft_time_limit=settings.task_timeout,
            time_limit=settings.task_timeout + 30,
        )
    except Exception as e:
        redis_client.update_task(
            task_id,
            {"status": TaskStatus.FAILED, "error_message": str(e), "completed_at": datetime.now()},
        )
        redis_client.complete_task(task_id, success=False)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to submit task: {str(e)}"
        )

    return SolveResponse(
        task_id=task_id,
        status=TaskStatus.PENDING,
        created_at=now,
    )
