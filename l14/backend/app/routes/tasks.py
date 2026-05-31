from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from datetime import datetime
from ..db.models import TaskStatus
from ..db.redis import redis_client

router = APIRouter(prefix="/api/v1", tags=["tasks"])


@router.get("/tasks")
async def get_tasks(limit: int = 20):
    task_ids = redis_client.get_recent_tasks(limit=limit)

    tasks = []
    for task_id in task_ids:
        task = redis_client.get_task(task_id)
        if task:
            tasks.append({
                "taskId": task.task_id,
                "matrixId": task.matrix_id,
                "solver": task.solver,
                "status": task.status,
                "progress": task.progress,
                "currentIter": task.current_iter,
                "maxIter": task.max_iter,
                "elapsedTime": task.elapsed_time,
                "createdAt": task.created_at.isoformat(),
                "startedAt": task.started_at.isoformat() if task.started_at else None,
                "completedAt": task.completed_at.isoformat() if task.completed_at else None,
                "error": task.error_message,
            })

    return {"tasks": tasks}


@router.get("/tasks/{task_id}")
async def get_task_status(task_id: str):
    task = redis_client.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    response = {
        "taskId": task.task_id,
        "matrixId": task.matrix_id,
        "solver": task.solver,
        "status": task.status,
        "progress": task.progress,
        "currentIter": task.current_iter,
        "maxIter": task.max_iter,
        "residualHistory": task.residual_history,
        "elapsedTime": task.elapsed_time,
        "createdAt": task.created_at.isoformat(),
        "startedAt": task.started_at.isoformat() if task.started_at else None,
        "completedAt": task.completed_at.isoformat() if task.completed_at else None,
        "error": task.error_message,
    }

    if task.status == TaskStatus.COMPLETED:
        result = redis_client.get_result(task_id)
        if result:
            response["result"] = {
                "taskId": result.task_id,
                "solver": result.solver,
                "solveTime": result.solve_time,
                "iterations": result.iterations,
                "finalResidual": result.final_residual,
                "solutionFirst10": result.solution_first_10,
                "converged": result.converged,
            }

    return response


@router.get("/tasks/{task_id}/progress")
async def get_task_progress(task_id: str):
    task = redis_client.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    residuals = redis_client.get_residuals(task_id)

    return {
        "taskId": task_id,
        "status": task.status,
        "progress": task.progress,
        "currentIter": task.current_iter,
        "residualHistory": residuals,
        "elapsedTime": task.elapsed_time,
    }


@router.get("/tasks/{task_id}/result")
async def get_task_result(task_id: str):
    task = redis_client.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status != TaskStatus.COMPLETED:
        return {
            "taskId": task_id,
            "status": task.status,
            "result": None,
        }

    result = redis_client.get_result(task_id)
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")

    return {
        "taskId": task_id,
        "status": task.status,
        "result": {
            "taskId": result.task_id,
            "solver": result.solver,
            "solveTime": result.solve_time,
            "iterations": result.iterations,
            "finalResidual": result.final_residual,
            "solutionFirst10": result.solution_first_10,
            "converged": result.converged,
        },
    }
