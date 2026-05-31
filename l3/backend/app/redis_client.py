import redis.asyncio as redis_async
import redis as redis_sync
from .config import settings
import json
from typing import Optional, Dict, Any


class RedisManager:
    _async_instance: Optional[redis_async.Redis] = None
    _sync_instance: Optional[redis_sync.Redis] = None

    @classmethod
    def get_async(cls) -> redis_async.Redis:
        if cls._async_instance is None:
            cls._async_instance = redis_async.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True
            )
        return cls._async_instance

    @classmethod
    def get_sync(cls) -> redis_sync.Redis:
        if cls._sync_instance is None:
            cls._sync_instance = redis_sync.Redis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True
            )
        return cls._sync_instance

    @classmethod
    async def close_async(cls):
        if cls._async_instance is not None:
            await cls._async_instance.close()
            cls._async_instance = None

    @classmethod
    def close_sync(cls):
        if cls._sync_instance is not None:
            cls._sync_instance.close()
            cls._sync_instance = None


async def set_progress(task_id: str, progress: float, status: str, stage: str = None, message: str = None):
    redis = RedisManager.get_async()
    data = {
        "task_id": task_id,
        "progress": progress,
        "status": status,
        "stage": stage,
        "message": message
    }
    await redis.setex(
        f"progress:{task_id}",
        3600 * 24,
        json.dumps(data)
    )


async def get_progress(task_id: str) -> Optional[Dict[str, Any]]:
    redis = RedisManager.get_async()
    data = await redis.get(f"progress:{task_id}")
    if data:
        return json.loads(data)
    return None


def set_progress_sync(task_id: str, progress: float, status: str, stage: str = None, message: str = None):
    redis = RedisManager.get_sync()
    data = {
        "task_id": task_id,
        "progress": progress,
        "status": status,
        "stage": stage,
        "message": message
    }
    redis.setex(
        f"progress:{task_id}",
        3600 * 24,
        json.dumps(data)
    )


async def cache_result(task_id: str, result: Dict[str, Any], ttl: int = 3600 * 24 * 7):
    redis = RedisManager.get_async()
    await redis.setex(
        f"result:{task_id}",
        ttl,
        json.dumps(result)
    )


async def get_cached_result(task_id: str) -> Optional[Dict[str, Any]]:
    redis = RedisManager.get_async()
    data = await redis.get(f"result:{task_id}")
    if data:
        return json.loads(data)
    return None
