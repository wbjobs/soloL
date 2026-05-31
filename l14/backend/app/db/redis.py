import redis
import json
from typing import Optional, Any, Dict, List
from datetime import datetime
from ..config import settings
from ..db.models import TaskState, TaskStatus, MatrixInfo, SolveResult, BatchState, BatchSolveResult


class RedisClient:
    def __init__(self):
        self.client = redis.Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
        )

    def _key(self, *parts: str) -> str:
        return ":".join(parts)

    def save_matrix_info(self, matrix_info: MatrixInfo) -> None:
        key = self._key("matrix", matrix_info.matrix_id)
        data = matrix_info.model_dump()
        data["uploaded_at"] = data["uploaded_at"].isoformat()
        data["shape"] = json.dumps(list(data["shape"]))
        if data.get("condition_number") is None:
            data["condition_number"] = ""
        if data.get("condition_info") is not None:
            data["condition_info"] = json.dumps(data["condition_info"])
        self.client.hset(key, mapping=data)

    def get_matrix_info(self, matrix_id: str) -> Optional[MatrixInfo]:
        key = self._key("matrix", matrix_id)
        data = self.client.hgetall(key)
        if not data:
            return None
        data["uploaded_at"] = datetime.fromisoformat(data["uploaded_at"])
        data["shape"] = tuple(json.loads(data["shape"]))
        if data.get("condition_number"):
            data["condition_number"] = float(data["condition_number"])
        if data.get("condition_info"):
            try:
                data["condition_info"] = json.loads(data["condition_info"])
            except (json.JSONDecodeError, TypeError):
                data["condition_info"] = None
        return MatrixInfo(**data)

    def create_task(self, task_state: TaskState) -> None:
        key = self._key("task", task_state.task_id)
        data = task_state.model_dump()
        for dt_field in ["created_at", "started_at", "completed_at"]:
            if data.get(dt_field):
                data[dt_field] = data[dt_field].isoformat()
        self.client.hset(key, mapping=data)
        self.client.sadd(self._key("tasks", "active"), task_state.task_id)
        self.client.lpush(self._key("tasks", "recent"), task_state.task_id)
        self.client.ltrim(self._key("tasks", "recent"), 0, 99)

    def update_task(self, task_id: str, updates: Dict[str, Any]) -> None:
        key = self._key("task", task_id)
        clean_updates = {}
        for k, v in updates.items():
            if isinstance(v, datetime):
                clean_updates[k] = v.isoformat()
            elif isinstance(v, list):
                clean_updates[k] = json.dumps(v)
            else:
                clean_updates[k] = v
        self.client.hset(key, mapping=clean_updates)

    def update_residuals(self, task_id: str, residuals: List[float]) -> None:
        key = self._key("task", task_id, "residuals")
        self.client.delete(key)
        if residuals:
            self.client.rpush(key, *[str(r) for r in residuals])

    def append_residual(self, task_id: str, residual: float) -> None:
        key = self._key("task", task_id, "residuals")
        self.client.rpush(key, str(residual))

    def get_residuals(self, task_id: str) -> List[float]:
        key = self._key("task", task_id, "residuals")
        data = self.client.lrange(key, 0, -1)
        return [float(r) for r in data]

    def get_task(self, task_id: str) -> Optional[TaskState]:
        key = self._key("task", task_id)
        data = self.client.hgetall(key)
        if not data:
            return None

        data["created_at"] = datetime.fromisoformat(data["created_at"])
        if data.get("started_at"):
            data["started_at"] = datetime.fromisoformat(data["started_at"])
        if data.get("completed_at"):
            data["completed_at"] = datetime.fromisoformat(data["completed_at"])

        if data.get("residual_history"):
            try:
                data["residual_history"] = json.loads(data["residual_history"])
            except (json.JSONDecodeError, TypeError):
                data["residual_history"] = []
        else:
            data["residual_history"] = self.get_residuals(task_id)

        for int_field in ["max_iter", "current_iter"]:
            if data.get(int_field):
                data[int_field] = int(data[int_field])

        for float_field in ["progress", "elapsed_time"]:
            if data.get(float_field):
                data[float_field] = float(data[float_field])

        return TaskState(**data)

    def save_result(self, task_id: str, result: SolveResult) -> None:
        key = self._key("task", task_id, "result")
        data = result.model_dump()
        self.client.set(key, json.dumps(data))

    def get_result(self, task_id: str) -> Optional[SolveResult]:
        key = self._key("task", task_id, "result")
        data = self.client.get(key)
        if not data:
            return None
        return SolveResult(**json.loads(data))

    def complete_task(self, task_id: str, success: bool = True) -> None:
        key = self._key("task", task_id)
        self.client.hset(key, "status", TaskStatus.COMPLETED if success else TaskStatus.FAILED)
        self.client.hset(key, "completed_at", datetime.now().isoformat())
        self.client.srem(self._key("tasks", "active"), task_id)

        task = self.get_task(task_id)
        if task and task.batch_id:
            self._update_batch_progress(task.batch_id)

    def _update_batch_progress(self, batch_id: str) -> None:
        batch = self.get_batch(batch_id)
        if not batch:
            return

        completed = 0
        failed = 0
        for task_id in batch.task_ids:
            task = self.get_task(task_id)
            if task:
                if task.status == TaskStatus.COMPLETED:
                    completed += 1
                elif task.status == TaskStatus.FAILED:
                    failed += 1

        total = len(batch.task_ids)
        progress = ((completed + failed) / total) * 100 if total > 0 else 0
        status = TaskStatus.PROCESSING
        if completed + failed == total:
            status = TaskStatus.FAILED if failed > 0 and completed == 0 else TaskStatus.COMPLETED

        updates = {
            "completed_count": completed,
            "failed_count": failed,
            "progress": progress,
            "status": status,
        }
        if status == TaskStatus.COMPLETED or status == TaskStatus.FAILED:
            updates["completed_at"] = datetime.now()

        self.update_batch(batch_id, updates)

    def create_batch(self, batch_state: BatchState) -> None:
        key = self._key("batch", batch_state.batch_id)
        data = batch_state.model_dump()
        for dt_field in ["created_at", "started_at", "completed_at"]:
            if data.get(dt_field):
                data[dt_field] = data[dt_field].isoformat()
        data["task_ids"] = json.dumps(data["task_ids"])
        self.client.hset(key, mapping=data)
        self.client.lpush(self._key("batches", "recent"), batch_state.batch_id)
        self.client.ltrim(self._key("batches", "recent"), 0, 49)

    def update_batch(self, batch_id: str, updates: Dict[str, Any]) -> None:
        key = self._key("batch", batch_id)
        clean_updates = {}
        for k, v in updates.items():
            if isinstance(v, datetime):
                clean_updates[k] = v.isoformat()
            elif isinstance(v, list):
                clean_updates[k] = json.dumps(v)
            else:
                clean_updates[k] = v
        self.client.hset(key, mapping=clean_updates)

    def get_batch(self, batch_id: str) -> Optional[BatchState]:
        key = self._key("batch", batch_id)
        data = self.client.hgetall(key)
        if not data:
            return None

        data["created_at"] = datetime.fromisoformat(data["created_at"])
        if data.get("started_at"):
            data["started_at"] = datetime.fromisoformat(data["started_at"])
        if data.get("completed_at"):
            data["completed_at"] = datetime.fromisoformat(data["completed_at"])

        if data.get("task_ids"):
            try:
                data["task_ids"] = json.loads(data["task_ids"])
            except (json.JSONDecodeError, TypeError):
                data["task_ids"] = []

        for int_field in ["completed_count", "failed_count"]:
            if data.get(int_field):
                data[int_field] = int(data[int_field])

        for float_field in ["progress"]:
            if data.get(float_field):
                data[float_field] = float(data[float_field])

        return BatchState(**data)

    def get_recent_batches(self, limit: int = 20) -> List[str]:
        return self.client.lrange(self._key("batches", "recent"), 0, limit - 1)

    def get_recent_tasks(self, limit: int = 20) -> List[str]:
        return self.client.lrange(self._key("tasks", "recent"), 0, limit - 1)

    def save_condition_info(self, matrix_id: str, info: Dict[str, Any]) -> None:
        key = self._key("matrix", matrix_id, "condition")
        self.client.set(key, json.dumps(info))

    def get_condition_info(self, matrix_id: str) -> Optional[Dict[str, Any]]:
        key = self._key("matrix", matrix_id, "condition")
        data = self.client.get(key)
        if data:
            return json.loads(data)
        return None

    def save_matrix_stats(self, matrix_id: str, stats: Dict[str, Any]) -> None:
        key = self._key("matrix", matrix_id, "stats")
        self.client.set(key, json.dumps(stats))

    def get_matrix_stats(self, matrix_id: str) -> Optional[Dict[str, Any]]:
        key = self._key("matrix", matrix_id, "stats")
        data = self.client.get(key)
        if data:
            return json.loads(data)
        return None

    def save_heatmap_data(self, matrix_id: str, data: Dict[str, Any]) -> None:
        key = self._key("matrix", matrix_id, "heatmap")
        self.client.set(key, json.dumps(data))

    def get_heatmap_data(self, matrix_id: str) -> Optional[Dict[str, Any]]:
        key = self._key("matrix", matrix_id, "heatmap")
        data = self.client.get(key)
        if data:
            return json.loads(data)
        return None


redis_client = RedisClient()
