from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List
import uuid
from datetime import datetime
from ..database import get_db
from ..models import AlignmentTask, AlignmentResult, UploadFile
from ..schemas import (
    AlignmentTaskRequest,
    AlignmentTaskResponse,
    TaskProgressResponse,
    AlignmentResultSummary,
    AlignmentResultDetail,
    DifferenceSite
)
from ..tasks import align_sequences
from ..redis_client import get_progress, get_cached_result, cache_result

router = APIRouter()


@router.post("/start", response_model=AlignmentTaskResponse)
async def start_alignment(
    request: AlignmentTaskRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    file1 = db.query(UploadFile).filter(UploadFile.file_id == request.file1_id).first()
    file2 = db.query(UploadFile).filter(UploadFile.file_id == request.file2_id).first()

    if not file1 or not file2:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="一个或多个文件不存在"
        )

    if file1.status != "completed" or file2.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="文件尚未上传完成"
        )

    task_id = str(uuid.uuid4())

    task = AlignmentTask(
        task_id=task_id,
        file1_id=request.file1_id,
        file2_id=request.file2_id,
        status="pending",
        progress=0.0
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    align_sequences.apply_async(
        args=[
            task_id,
            request.file1_id,
            request.file2_id,
            request.match_score,
            request.mismatch_penalty,
            request.gap_penalty
        ],
        task_id=task_id
    )

    return AlignmentTaskResponse(
        task_id=task_id,
        status="pending",
        file1_id=request.file1_id,
        file2_id=request.file2_id,
        created_at=task.created_at
    )


@router.get("/progress/{task_id}", response_model=TaskProgressResponse)
async def get_alignment_progress(task_id: str, db: Session = Depends(get_db)):
    progress_data = await get_progress(task_id)

    if progress_data:
        return TaskProgressResponse(
            task_id=task_id,
            status=progress_data.get("status", "unknown"),
            progress=progress_data.get("progress", 0.0),
            message=progress_data.get("message"),
            current_stage=progress_data.get("stage")
        )

    task = db.query(AlignmentTask).filter(AlignmentTask.task_id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在"
        )

    return TaskProgressResponse(
        task_id=task_id,
        status=task.status,
        progress=task.progress,
        message=task.error_message,
        current_stage=None
    )


@router.get("/tasks", response_model=List[AlignmentResultSummary])
async def list_alignment_tasks(
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db)
):
    tasks = db.query(AlignmentTask).filter(
        AlignmentTask.status == "completed"
    ).order_by(AlignmentTask.completed_at.desc()).offset(skip).limit(limit).all()

    results = []
    for task in tasks:
        if task.completed_at:
            results.append(AlignmentResultSummary(
                task_id=task.task_id,
                similarity_score=task.similarity_score or 0,
                alignment_length=task.alignment_length or 0,
                gap_count=task.gap_count or 0,
                mismatch_count=task.mismatch_count or 0,
                match_count=task.match_count or 0,
                identity_percentage=task.identity_percentage or 0,
                completed_at=task.completed_at
            ))
    return results


@router.get("/result/{task_id}", response_model=AlignmentResultDetail)
async def get_alignment_result(task_id: str, db: Session = Depends(get_db)):
    cached = await get_cached_result(task_id)
    if cached:
        return AlignmentResultDetail(**cached)

    task = db.query(AlignmentTask).filter(AlignmentTask.task_id == task_id).first()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="任务不存在"
        )

    if task.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"任务尚未完成，当前状态: {task.status}"
        )

    result = db.query(AlignmentResult).filter(AlignmentResult.task_id == task_id).first()
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="比对结果不存在"
        )

    difference_sites = [
        DifferenceSite(
            position=site["position"],
            base1=site["base1"],
            base2=site["base2"],
            type=site["type"]
        )
        for site in (result.difference_sites or [])
    ]

    response_data = {
        "task_id": task_id,
        "similarity_score": task.similarity_score or 0,
        "alignment_length": task.alignment_length or 0,
        "gap_count": task.gap_count or 0,
        "mismatch_count": task.mismatch_count or 0,
        "match_count": task.match_count or 0,
        "identity_percentage": task.identity_percentage or 0,
        "completed_at": task.completed_at,
        "aligned_sequence1": result.aligned_sequence1,
        "aligned_sequence2": result.aligned_sequence2,
        "start_pos1": result.start_pos1 or 0,
        "start_pos2": result.start_pos2 or 0,
        "end_pos1": result.end_pos1 or 0,
        "end_pos2": result.end_pos2 or 0,
        "difference_sites": difference_sites,
        "hilbert_data": result.hilbert_data or []
    }

    await cache_result(task_id, response_data)

    return AlignmentResultDetail(**response_data)
