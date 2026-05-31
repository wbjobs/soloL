import redis.asyncio as redis
import json
import os
from typing import Any, Optional, Dict, List
from dotenv import load_dotenv

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
REDIS_CACHE_TTL = int(os.getenv("REDIS_CACHE_TTL", "3600"))


class RedisManager:
    def __init__(self):
        self.redis = None
        self._is_connected = False

    async def connect(self):
        try:
            self.redis = redis.from_url(
                REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2
            )
            await self.redis.ping()
            self._is_connected = True
            print("Redis connected successfully")
        except Exception as e:
            print(f"Warning: Redis connection failed: {e}")
            print("Caching will be disabled")
            self._is_connected = False

    async def disconnect(self):
        if self.redis:
            await self.redis.close()
            self._is_connected = False

    @property
    def is_connected(self) -> bool:
        return self._is_connected

    def _serialize(self, data: Any) -> str:
        return json.dumps(data, ensure_ascii=False)

    def _deserialize(self, data: Optional[str]) -> Any:
        if data is None:
            return None
        try:
            return json.loads(data)
        except json.JSONDecodeError:
            return data

    async def get(self, key: str) -> Any:
        if not self._is_connected:
            return None
        try:
            data = await self.redis.get(key)
            return self._deserialize(data)
        except Exception as e:
            print(f"Redis get error: {e}")
            return None

    async def set(self, key: str, value: Any, ttl: int = None) -> bool:
        if not self._is_connected:
            return False
        try:
            serialized = self._serialize(value)
            if ttl is None:
                ttl = REDIS_CACHE_TTL
            await self.redis.setex(key, ttl, serialized)
            return True
        except Exception as e:
            print(f"Redis set error: {e}")
            return False

    async def delete(self, key: str) -> bool:
        if not self._is_connected:
            return False
        try:
            await self.redis.delete(key)
            return True
        except Exception as e:
            print(f"Redis delete error: {e}")
            return False

    async def get_midi_notes_slice(self, midi_id: str, slice_index: int) -> Optional[List[Dict]]:
        key = f"midi:{midi_id}:notes:slice:{slice_index}"
        return await self.get(key)

    async def set_midi_notes_slice(
        self,
        midi_id: str,
        slice_index: int,
        notes: List[Dict],
        ttl: int = None
    ) -> bool:
        key = f"midi:{midi_id}:notes:slice:{slice_index}"
        return await self.set(key, notes, ttl)

    async def get_midi_slices_meta(self, midi_id: str) -> Optional[Dict]:
        key = f"midi:{midi_id}:notes:slices_meta"
        return await self.get(key)

    async def set_midi_slices_meta(self, midi_id: str, meta: Dict, ttl: int = None) -> bool:
        key = f"midi:{midi_id}:notes:slices_meta"
        return await self.set(key, meta, ttl)

    async def get_annotation_version(self, midi_id: str) -> int:
        key = f"midi:{midi_id}:annotations:version"
        version = await self.get(key)
        return int(version) if version is not None else 0

    async def increment_annotation_version(self, midi_id: str) -> int:
        if not self._is_connected:
            return 0
        try:
            key = f"midi:{midi_id}:annotations:version"
            new_version = await self.redis.incr(key)
            await self.redis.expire(key, REDIS_CACHE_TTL * 24)
            return new_version
        except Exception as e:
            print(f"Redis increment version error: {e}")
            return 0

    async def get_annotation_since(self, midi_id: str, since_version: int) -> Optional[Dict]:
        key = f"midi:{midi_id}:annotations:updates"
        all_updates = await self.get(key) or {}
        
        if since_version <= 0:
            return all_updates
        
        filtered = {
            k: v for k, v in all_updates.items()
            if v.get('version', 0) > since_version
        }
        return filtered

    async def add_annotation_update(self, midi_id: str, annotation_id: str, update: Dict) -> bool:
        if not self._is_connected:
            return False
        try:
            key = f"midi:{midi_id}:annotations:updates"
            all_updates = await self.get(key) or {}
            all_updates[annotation_id] = update
            return await self.set(key, all_updates, REDIS_CACHE_TTL * 24)
        except Exception as e:
            print(f"Redis add annotation update error: {e}")
            return False

    async def get_online_users(self, midi_id: str) -> Optional[List[Dict]]:
        key = f"midi:{midi_id}:users:online"
        return await self.get(key)

    async def set_online_users(self, midi_id: str, users: List[Dict]) -> bool:
        key = f"midi:{midi_id}:users:online"
        return await self.set(key, users, 300)

    async def clear_midi_cache(self, midi_id: str) -> bool:
        if not self._is_connected:
            return False
        try:
            pattern = f"midi:{midi_id}:*"
            keys = await self.redis.keys(pattern)
            if keys:
                await self.redis.delete(*keys)
            return True
        except Exception as e:
            print(f"Redis clear midi cache error: {e}")
            return False


redis_manager = RedisManager()
