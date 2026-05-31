import numpy as np
from scipy import sparse
from typing import Optional, List
from datetime import datetime
import signal
import uuid
from functools import wraps
from ...celery_app import celery
from ..config import settings
from ..db.models import TaskState, TaskStatus, SolverType, SolveResult, BatchState, BatchSolveResult
from ..db.redis import redis_client
from ..services.matrix_parser import matrix_parser
from ..services.solvers.cg import solve_cg
from ..services.solvers.gmres import solve_gmres
from ..services.solvers.superlu import solve_superlu
from ..utils.matrix_utils import is_symmetric
from ..storage.file_manager import file_manager


def with_timeout(timeout_seconds):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            def timeout_handler(signum, frame):
                raise TimeoutError(f"Task exceeded time limit of {timeout_seconds} seconds")

            old_handler = signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(timeout_seconds)

            try:
                result = func(*args, **kwargs)
            finally:
                signal.alarm(0)
                signal.signal(signal.SIGALRM, old_handler)

            return result

        return wrapper

    return decorator


@celery.task(bind=True, name="solve_linear_system", soft_time_limit=300, time_limit=330)
def solve_linear_system(
    self,
    matrix_id: str,
    solver: str,
    tol: float,
    max_iter: int,
    b_vector: Optional[List[float]] = None,
    task_id: Optional[str] = None,
):
    if task_id is None:
        task_id = self.request.id

    task_state = redis_client.get_task(task_id)
    if not task_state:
        raise ValueError(f"Task {task_id} not found")

    try:
        redis_client.update_task(
            task_id,
            {
                "status": TaskStatus.PROCESSING,
                "started_at": datetime.now(),
                "progress": 0.0,
            },
        )

        A = matrix_parser.load_matrix(matrix_id)
        if A is None:
            raise ValueError(f"Matrix {matrix_id} not found")

        n = A.shape[0]
        if b_vector is not None and len(b_vector) > 0:
            b = np.array(b_vector, dtype=np.float64)
        else:
            b = np.random.randn(n).astype(np.float64)

        if b.shape[0] != n:
            raise ValueError(f"b vector size {b.shape[0]} does not match matrix rows {n}")

        def progress_callback(iteration: int, residual: float) -> None:
            progress = min(95.0, (iteration / max_iter) * 100) if max_iter > 0 else 50.0
            elapsed = (datetime.now() - task_state.started_at).total_seconds() if task_state.started_at else 0.0

            redis_client.update_task(
                task_id,
                {
                    "current_iter": iteration,
                    "progress": progress,
                    "elapsed_time": elapsed,
                },
            )
            redis_client.append_residual(task_id, residual)

            self.update_state(
                state="PROGRESS",
                meta={
                    "iteration": iteration,
                    "residual": residual,
                    "progress": progress,
                    "elapsed_time": elapsed,
                },
            )

        solver_enum = SolverType(solver)
        time_limit = settings.task_timeout

        matrix_symmetric = False
        if A.shape[0] == A.shape[1]:
            try:
                matrix_symmetric = is_symmetric(A)
            except Exception:
                matrix_symmetric = False

        if solver_enum == SolverType.CG:
            if not matrix_symmetric and A.shape[0] == A.shape[1]:
                redis_client.update_task(
                    task_id,
                    {"error_message": "Warning: CG requires symmetric positive-definite matrix; "
                     "detected non-symmetric matrix, results may be unreliable"},
                )
            x, result = solve_cg(
                A, b, tol=tol, max_iter=max_iter,
                callback=progress_callback, time_limit=time_limit,
                use_preconditioner=True,
            )
        elif solver_enum == SolverType.GMRES:
            x, result = solve_gmres(
                A, b, tol=tol, max_iter=max_iter,
                callback=progress_callback, time_limit=time_limit,
                use_preconditioner=True,
            )
        elif solver_enum == SolverType.SUPERLU:
            x, result = solve_superlu(
                A, b, tol=tol, max_iter=max_iter,
                callback=progress_callback, time_limit=time_limit,
            )
        else:
            raise ValueError(f"Unknown solver: {solver}")

        residuals = result["residuals"]
        solution_first_10 = x[:10].tolist() if len(x) >= 10 else x.tolist() + [0.0] * (10 - len(x))

        solve_result = SolveResult(
            task_id=task_id,
            solver=solver,
            solve_time=result["solve_time"],
            iterations=result["iterations"],
            final_residual=result["final_residual"],
            solution_first_10=solution_first_10,
            converged=result["converged"],
        )

        result_data = {
            "task_id": task_id,
            "solver": solver,
            "solve_time": result["solve_time"],
            "iterations": result["iterations"],
            "final_residual": result["final_residual"],
            "converged": result["converged"],
            "solution_first_10": solution_first_10,
        }

        try:
            file_manager.save_solution(task_id, x, residuals, result_data)
        except Exception:
            pass

        redis_client.save_result(task_id, solve_result)
        redis_client.update_residuals(task_id, residuals)
        redis_client.update_task(
            task_id,
            {
                "status": TaskStatus.COMPLETED,
                "progress": 100.0,
                "elapsed_time": result["solve_time"],
                "completed_at": datetime.now(),
            },
        )
        redis_client.complete_task(task_id, success=True)

        return {
            "task_id": task_id,
            "status": TaskStatus.COMPLETED,
            "result": result_data,
        }

    except TimeoutError as e:
        error_msg = f"Task timed out after {settings.task_timeout} seconds"
        redis_client.update_task(
            task_id,
            {
                "status": TaskStatus.FAILED,
                "error_message": error_msg,
                "completed_at": datetime.now(),
            },
        )
        redis_client.complete_task(task_id, success=False)
        raise

    except Exception as e:
        error_msg = str(e)
        redis_client.update_task(
            task_id,
            {
                "status": TaskStatus.FAILED,
                "error_message": error_msg,
                "completed_at": datetime.now(),
            },
        )
        redis_client.complete_task(task_id, success=False)
        raise


@celery.task(bind=True, name="solve_batch", soft_time_limit=600, time_limit=660)
def solve_batch(
    self,
    matrix_id: str,
    solver: str,
    tol: float,
    max_iter: int,
    rhs_indices: Optional[List[int]] = None,
    batch_id: Optional[str] = None,
):
    if batch_id is None:
        batch_id = self.request.id

    matrix_info = matrix_parser.get_matrix_info(matrix_id)
    if not matrix_info:
        raise ValueError(f"Matrix {matrix_id} not found")

    num_rhs = matrix_info.num_rhs
    if num_rhs <= 1 and rhs_indices is None:
        raise ValueError("No multiple RHS vectors available. Use regular solve endpoint instead.")

    if rhs_indices is None:
        rhs_indices = list(range(num_rhs))

    valid_rhs = []
    for idx in rhs_indices:
        if 0 <= idx < num_rhs:
            valid_rhs.append(idx)

    if not valid_rhs:
        raise ValueError("No valid RHS indices specified")

    now = datetime.now()
    task_ids = []

    for rhs_idx in valid_rhs:
        task_id = str(uuid.uuid4())
        task_ids.append(task_id)

        b = matrix_parser.load_rhs_vector(matrix_id, rhs_idx)
        if b is None:
            b = np.random.randn(matrix_info.shape[0]).astype(np.float64)

        task_state = TaskState(
            task_id=task_id,
            matrix_id=matrix_id,
            solver=SolverType(solver),
            status=TaskStatus.PENDING,
            max_iter=max_iter,
            created_at=now,
            rhs_index=rhs_idx,
            batch_id=batch_id,
        )
        redis_client.create_task(task_state)

        try:
            solve_linear_system.apply_async(
                args=[
                    matrix_id,
                    solver,
                    tol,
                    max_iter,
                    b.tolist(),
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

    batch_state = BatchState(
        batch_id=batch_id,
        matrix_id=matrix_id,
        solver=SolverType(solver),
        task_ids=task_ids,
        status=TaskStatus.PROCESSING,
        created_at=now,
        started_at=now,
    )
    redis_client.create_batch(batch_state)

    return {
        "batch_id": batch_id,
        "task_ids": task_ids,
        "num_tasks": len(task_ids),
        "status": TaskStatus.PROCESSING,
        "created_at": now.isoformat(),
    }


def get_batch_result(batch_id: str) -> BatchSolveResult:
    batch = redis_client.get_batch(batch_id)
    if not batch:
        raise ValueError(f"Batch {batch_id} not found")

    results = []
    solve_times = []
    final_residuals = []
    residual_histories = []
    total_time = 0.0

    for task_id in batch.task_ids:
        result = redis_client.get_result(task_id)
        if result:
            results.append(result)
            solve_times.append(result.solve_time)
            final_residuals.append(result.final_residual)
            task = redis_client.get_task(task_id)
            if task:
                residual_histories.append(task.residual_history)
            else:
                residual_histories.append([])
            total_time = max(total_time, result.solve_time)

    return BatchSolveResult(
        batch_id=batch_id,
        solver=batch.solver.value,
        num_tasks=len(batch.task_ids),
        completed_count=batch.completed_count,
        failed_count=batch.failed_count,
        results=results,
        solve_times=solve_times,
        final_residuals=final_residuals,
        residual_histories=residual_histories,
        total_time=total_time,
    )
