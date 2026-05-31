from .celery_app import celery
from .config import settings
from .database import SessionLocal
from .models import AlignmentTask, AlignmentResult, UploadFile
from .algorithms import HeuristicSmithWaterman, generate_hilbert_3d_data
from .utils.fasta_parser import read_sequence
from .redis_client import set_progress_sync
from datetime import datetime
import asyncio
import websockets
import json
import os


async def send_ws_update(task_id: str, progress: float, status: str, stage: str = None, message: str = None):
    try:
        uri = f"ws://localhost:{settings.WS_MANAGER_PORT}/ws/{task_id}"
        async with websockets.connect(uri) as websocket:
            data = {
                "type": "progress",
                "task_id": task_id,
                "data": {
                    "progress": progress,
                    "status": status,
                    "stage": stage,
                    "message": message
                }
            }
            await websocket.send(json.dumps(data))
    except Exception:
        pass


def progress_callback(task_id: str):
    def callback(progress: float, stage: str):
        set_progress_sync(task_id, progress, "processing", stage=stage)
        try:
            asyncio.run(send_ws_update(task_id, progress, "processing", stage=stage))
        except Exception:
            pass
    return callback


@celery.task(
    bind=True,
    name="align_sequences",
    max_retries=3,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=120,
    retry_jitter=True,
    acks_late=True,
    reject_on_worker_lost=True
)
def align_sequences(
    self,
    task_id: str,
    file1_id: str,
    file2_id: str,
    match_score: int = 2,
    mismatch_penalty: int = -1,
    gap_penalty: int = -2
):
    db = SessionLocal()
    retry_count = self.request.retries if hasattr(self.request, 'retries') else 0

    try:
        task = db.query(AlignmentTask).filter(AlignmentTask.task_id == task_id).first()
        if not task:
            raise ValueError(f"任务 {task_id} 不存在")

        if task.status == "completed":
            return {
                "task_id": task_id,
                "status": "completed",
                "similarity_score": task.similarity_score,
                "identity_percentage": task.identity_percentage,
                "alignment_length": task.alignment_length,
                "match_count": task.match_count,
                "mismatch_count": task.mismatch_count,
                "gap_count": task.gap_count,
                "retry_count": retry_count,
                "message": "任务已完成，跳过重复执行"
            }

        if task.status == "failed" and retry_count >= 3:
            raise Exception("任务重试次数已达上限")

        task.status = "processing"
        task.started_at = datetime.utcnow()
        task.progress = 0.0
        task.error_message = None
        db.commit()

        if retry_count > 0:
            retry_msg = f"第 {retry_count} 次重试执行"
            set_progress_sync(task_id, 0.0, "processing", stage=retry_msg)
            try:
                asyncio.run(send_ws_update(task_id, 0.0, "processing", stage=retry_msg))
            except Exception:
                pass

        set_progress_sync(task_id, 0.0, "processing", stage="读取序列文件")
        asyncio.run(send_ws_update(task_id, 0.0, "processing", stage="读取序列文件"))

        file1 = db.query(UploadFile).filter(UploadFile.file_id == file1_id).first()
        file2 = db.query(UploadFile).filter(UploadFile.file_id == file2_id).first()

        if not file1 or not file2 or not file1.file_path or not file2.file_path:
            raise ValueError("文件不存在或路径无效")

        seq1 = read_sequence(file1.file_path)
        seq2 = read_sequence(file2.file_path)

        if not seq1 or not seq2:
            raise ValueError("无法读取序列文件")

        set_progress_sync(task_id, 0.02, "processing", stage="序列读取完成，开始比对")
        asyncio.run(send_ws_update(task_id, 0.02, "processing", stage="序列读取完成，开始比对"))

        sw = HeuristicSmithWaterman(
            match_score=match_score,
            mismatch_penalty=mismatch_penalty,
            gap_penalty=gap_penalty,
            k=15,
            use_heuristic=True,
            progress_callback=progress_callback(task_id)
        )

        result = sw.align(seq1, seq2)

        set_progress_sync(task_id, 0.98, "processing", stage="生成3D可视化数据")
        asyncio.run(send_ws_update(task_id, 0.98, "processing", stage="生成3D可视化数据"))

        hilbert_data = generate_hilbert_3d_data(
            result.aligned_seq1,
            result.aligned_seq2,
            window_size=50,
            step_size=10
        )

        set_progress_sync(task_id, 0.99, "processing", stage="保存结果到数据库")
        asyncio.run(send_ws_update(task_id, 0.99, "processing", stage="保存结果到数据库"))

        task.status = "completed"
        task.progress = 1.0
        task.similarity_score = result.score
        task.alignment_length = len(result.aligned_seq1)
        task.gap_count = result.gap_count
        task.mismatch_count = result.mismatch_count
        task.match_count = result.match_count
        task.identity_percentage = result.identity_percentage
        task.completed_at = datetime.utcnow()
        db.commit()

        alignment_result = AlignmentResult(
            task_id=task_id,
            aligned_sequence1=result.aligned_seq1,
            aligned_sequence2=result.aligned_seq2,
            start_pos1=result.start_pos1,
            start_pos2=result.start_pos2,
            end_pos1=result.end_pos1,
            end_pos2=result.end_pos2,
            score_matrix=None,
            difference_sites=result.difference_sites,
            hilbert_data=hilbert_data
        )
        db.add(alignment_result)
        db.commit()

        set_progress_sync(task_id, 1.0, "completed", stage="比对完成")
        asyncio.run(send_ws_update(task_id, 1.0, "completed", stage="比对完成"))

        return {
            "task_id": task_id,
            "status": "completed",
            "similarity_score": result.score,
            "identity_percentage": result.identity_percentage,
            "alignment_length": len(result.aligned_seq1),
            "match_count": result.match_count,
            "mismatch_count": result.mismatch_count,
            "gap_count": result.gap_count
        }

    except Exception as e:
        db.rollback()
        task = db.query(AlignmentTask).filter(AlignmentTask.task_id == task_id).first()

        max_retries = 3
        if retry_count < max_retries:
            error_msg = f"{str(e)} (第{retry_count + 1}次失败，{max_retries}秒后自动重试)"
            if task:
                task.status = "retrying"
                task.error_message = error_msg
                db.commit()

            set_progress_sync(
                task_id,
                task.progress if task else 0.0,
                "retrying",
                stage=f"第 {retry_count + 1}/{max_retries} 次重试",
                message=str(e)
            )
            try:
                asyncio.run(send_ws_update(
                    task_id,
                    task.progress if task else 0.0,
                    "retrying",
                    stage=f"第 {retry_count + 1}/{max_retries} 次重试",
                    message=str(e)
                ))
            except Exception:
                pass

            retry_delay = 30 * (retry_count + 1)
            raise self.retry(exc=e, countdown=retry_delay, max_retries=max_retries)
        else:
            error_msg = f"{str(e)} (已达最大重试次数{max_retries}次)"
            if task:
                task.status = "failed"
                task.error_message = error_msg
                task.completed_at = datetime.utcnow()
                db.commit()

            set_progress_sync(task_id, 0.0, "failed", message=error_msg)
            try:
                asyncio.run(send_ws_update(task_id, 0.0, "failed", message=error_msg))
            except Exception:
                pass
            raise

    finally:
        db.close()
