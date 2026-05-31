import hashlib
import os
import json
import struct
import urllib.parse
import asyncio
import random
import logging
from datetime import datetime, timezone

import redis.asyncio as redis
import aiofiles

from app.config import (
    CHUNKS_PATH, TORRENTS_PATH, CHUNK_SIZE, REDIS_URL,
    TRACKER_ANNOUNCE_URL, HEALTH_CHECK_INTERVAL, HEALTH_CHECK_MAX_FAILURES,
    HEALTH_CHECK_PING_TIMEOUT, PEER_SELECT_TOP_N,
    HOTNESS_THRESHOLD, HOTNESS_WINDOW_SECONDS, HOTNESS_CHECK_INTERVAL,
    DOCKER_API_URL, SEEDER_CONTAINER_IMAGE, SEEDER_CONTAINER_PREFIX,
    MAX_EDGE_NODES, MAX_REPLICAS_PER_FILE, EDGE_NODES,
)

logger = logging.getLogger(__name__)


class ChunkService:
    def __init__(self):
        self.redis: redis.Redis | None = None

    async def init_redis(self):
        self.redis = redis.from_url(REDIS_URL, decode_responses=True)

    async def close_redis(self):
        if self.redis:
            await self.redis.close()

    @staticmethod
    def compute_sha256(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    async def save_chunk(self, file_id: str, chunk_index: int, data: bytes) -> str:
        chunk_hash = self.compute_sha256(data)
        chunk_dir = os.path.join(CHUNKS_PATH, file_id)
        os.makedirs(chunk_dir, exist_ok=True)
        chunk_path = os.path.join(chunk_dir, f"{chunk_index:06d}")
        async with aiofiles.open(chunk_path, "wb") as f:
            await f.write(data)
        if self.redis:
            await self.redis.hset(f"chunks:{file_id}", str(chunk_index), chunk_hash)
        return chunk_hash

    async def verify_chunk(self, file_id: str, chunk_index: int, expected_hash: str) -> bool:
        chunk_dir = os.path.join(CHUNKS_PATH, file_id)
        chunk_path = os.path.join(chunk_dir, f"{chunk_index:06d}")
        if not os.path.exists(chunk_path):
            return False
        async with aiofiles.open(chunk_path, "rb") as f:
            data = await f.read()
        actual_hash = self.compute_sha256(data)
        return actual_hash == expected_hash

    async def get_chunk(self, file_id: str, chunk_index: int) -> bytes | None:
        chunk_path = os.path.join(CHUNKS_PATH, file_id, f"{chunk_index:06d}")
        if not os.path.exists(chunk_path):
            return None
        async with aiofiles.open(chunk_path, "rb") as f:
            return await f.read()

    async def get_chunk_hashes(self, file_id: str) -> dict[str, str]:
        if not self.redis:
            return {}
        return await self.redis.hgetall(f"chunks:{file_id}")


class TorrentService:
    def __init__(self, chunk_service: ChunkService):
        self.chunk_service = chunk_service
        self.redis: redis.Redis | None = None

    async def init_redis(self):
        self.redis = redis.from_url(REDIS_URL, decode_responses=True)

    async def close_redis(self):
        if self.redis:
            await self.redis.close()

    @staticmethod
    def _bencode(value) -> bytes:
        if isinstance(value, int):
            return b"i" + str(value).encode() + b"e"
        elif isinstance(value, bytes):
            return str(len(value)).encode() + b":" + value
        elif isinstance(value, str):
            return str(len(value)).encode() + b":" + value.encode()
        elif isinstance(value, list):
            return b"l" + b"".join(TorrentService._bencode(v) for v in value) + b"e"
        elif isinstance(value, dict):
            result = b"d"
            for k in sorted(value.keys()):
                result += TorrentService._bencode(k) + TorrentService._bencode(value[k])
            result += b"e"
            return result
        raise ValueError(f"Cannot bencode type {type(value)}")

    def _build_torrent_dict(
        self,
        file_name: str,
        total_size: int,
        piece_length: int,
        pieces: bytes,
    ) -> dict:
        return {
            "info": {
                "name": file_name,
                "piece length": piece_length,
                "pieces": pieces,
                "length": total_size,
            },
            "announce": TRACKER_ANNOUNCE_URL,
        }

    async def generate_torrent(
        self,
        file_id: str,
        file_name: str,
        total_size: int,
        total_chunks: int,
        chunk_hashes: list[str],
    ) -> tuple[str, str, str]:
        pieces_parts = []
        for h in chunk_hashes:
            piece_hash = bytes.fromhex(h)[:20] if len(h) == 64 else hashlib.sha1(h.encode()).digest()
            pieces_parts.append(piece_hash)
        pieces = b"".join(pieces_parts)

        torrent_dict = self._build_torrent_dict(file_name, total_size, CHUNK_SIZE, pieces)
        torrent_data = self._bencode(torrent_dict)

        torrent_path = os.path.join(TORRENTS_PATH, f"{file_id}.torrent")
        async with aiofiles.open(torrent_path, "wb") as f:
            await f.write(torrent_data)

        info_bencoded = self._bencode(torrent_dict["info"])
        info_hash = hashlib.sha1(info_bencoded).hexdigest()

        magnet_uri = (
            f"magnet:?xt=urn:btih:{info_hash}"
            f"&dn={urllib.parse.quote(file_name)}"
            f"&tr={urllib.parse.quote(TRACKER_ANNOUNCE_URL)}"
        )

        if self.redis:
            file_key = f"file:{file_id}"
            await self.redis.hset(file_key, mapping={
                "file_name": file_name,
                "total_size": str(total_size),
                "total_chunks": str(total_chunks),
                "chunk_size": str(CHUNK_SIZE),
                "info_hash": info_hash,
                "magnet_uri": magnet_uri,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

        return info_hash, magnet_uri, torrent_path


class TrackerService:
    def __init__(self):
        self.redis: redis.Redis | None = None
        self._health_task: asyncio.Task | None = None

    async def init_redis(self):
        self.redis = redis.from_url(REDIS_URL, decode_responses=True)

    async def close_redis(self):
        if self._health_task:
            self._health_task.cancel()
            try:
                await self._health_task
            except asyncio.CancelledError:
                pass
            self._health_task = None
        if self.redis:
            await self.redis.close()

    def start_health_check(self):
        if self._health_task is None or self._health_task.done():
            self._health_task = asyncio.create_task(self._health_check_loop())

    async def _health_check_loop(self):
        logger.info("Peer health check loop started (interval=%ds, max_failures=%d)",
                     HEALTH_CHECK_INTERVAL, HEALTH_CHECK_MAX_FAILURES)
        while True:
            try:
                await asyncio.sleep(HEALTH_CHECK_INTERVAL)
                await self._run_health_check()
            except asyncio.CancelledError:
                logger.info("Health check loop cancelled")
                break
            except Exception as e:
                logger.error("Health check error: %s", e)

    async def _run_health_check(self):
        if not self.redis:
            return

        peer_keys = []
        async for key in self.redis.scan_iter("peers:*"):
            peer_keys.append(key)

        for peer_key in peer_keys:
            all_peers = await self.redis.hgetall(peer_key)
            dead_peer_ids = []

            for peer_id, pdata_str in all_peers.items():
                try:
                    pdata = json.loads(pdata_str)
                except (json.JSONDecodeError, KeyError):
                    dead_peer_ids.append(peer_id)
                    continue

                alive = await self._ping_peer(pdata["ip"], pdata["port"])

                if alive:
                    pdata["fail_count"] = 0
                    pdata["last_ping"] = datetime.now(timezone.utc).isoformat()
                    await self.redis.hset(peer_key, peer_id, json.dumps(pdata))
                else:
                    pdata["fail_count"] = pdata.get("fail_count", 0) + 1
                    pdata["last_ping"] = datetime.now(timezone.utc).isoformat()

                    if pdata["fail_count"] >= HEALTH_CHECK_MAX_FAILURES:
                        dead_peer_ids.append(peer_id)
                        logger.info(
                            "Removing dead peer %s (ip=%s, port=%d, failures=%d)",
                            peer_id, pdata["ip"], pdata["port"], pdata["fail_count"]
                        )
                    else:
                        await self.redis.hset(peer_key, peer_id, json.dumps(pdata))
                        logger.debug(
                            "Peer %s ping failed (failures=%d/%d)",
                            peer_id, pdata["fail_count"], HEALTH_CHECK_MAX_FAILURES
                        )

            if dead_peer_ids:
                await self.redis.hdel(peer_key, *dead_peer_ids)

    async def _ping_peer(self, ip: str, port: int) -> bool:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(ip, port),
                timeout=HEALTH_CHECK_PING_TIMEOUT,
            )
            writer.close()
            await writer.wait_closed()
            return True
        except (OSError, asyncio.TimeoutError, ConnectionRefusedError):
            return False

    async def announce(
        self,
        info_hash: str,
        peer_id: str,
        ip: str,
        port: int,
        event: str = "",
        upload_speed: float = 0.0,
    ) -> list[dict]:
        if not self.redis:
            return []

        peer_data = json.dumps({
            "peer_id": peer_id,
            "ip": ip,
            "port": port,
            "upload_speed": upload_speed,
            "fail_count": 0,
            "last_seen": datetime.now(timezone.utc).isoformat(),
            "last_ping": datetime.now(timezone.utc).isoformat(),
        })

        existing = await self.redis.hget(f"peers:{info_hash}", peer_id)
        if existing:
            try:
                old = json.loads(existing)
                peer_data_dict = {
                    "peer_id": peer_id,
                    "ip": ip,
                    "port": port,
                    "upload_speed": upload_speed,
                    "fail_count": old.get("fail_count", 0),
                    "last_seen": datetime.now(timezone.utc).isoformat(),
                    "last_ping": old.get("last_ping", ""),
                }
                peer_data = json.dumps(peer_data_dict)
            except (json.JSONDecodeError, KeyError):
                pass

        await self.redis.hset(f"peers:{info_hash}", peer_id, peer_data)

        if event == "stopped":
            await self.redis.hdel(f"peers:{info_hash}", peer_id)
            return []

        all_peers = await self.redis.hgetall(f"peers:{info_hash}")
        peers = []
        for pid, pdata_str in all_peers.items():
            if pid == peer_id:
                continue
            try:
                pdata = json.loads(pdata_str)
                peers.append({
                    "peer_id": pdata["peer_id"],
                    "ip": pdata["ip"],
                    "port": pdata["port"],
                    "upload_speed": pdata.get("upload_speed", 0.0),
                })
            except (json.JSONDecodeError, KeyError):
                continue

        peers.sort(key=lambda p: p.get("upload_speed", 0.0), reverse=True)

        top_peers = peers[:PEER_SELECT_TOP_N]
        remaining = peers[PEER_SELECT_TOP_N:]
        random.shuffle(remaining)

        result = top_peers + remaining
        return result

    async def get_seeders_count(self, info_hash: str) -> int:
        if not self.redis:
            return 0
        return len(await self.redis.hgetall(f"peers:{info_hash}"))

    async def get_all_files(self) -> list[dict]:
        if not self.redis:
            return []
        keys = []
        async for key in self.redis.scan_iter("file:*"):
            keys.append(key)
        files = []
        for key in keys:
            data = await self.redis.hgetall(key)
            if not data:
                continue
            info_hash = data.get("info_hash", "")
            seeders = await self.get_seeders_count(info_hash)
            files.append({
                "file_id": key.replace("file:", ""),
                "file_name": data.get("file_name", ""),
                "total_size": int(data.get("total_size", 0)),
                "total_chunks": int(data.get("total_chunks", 0)),
                "chunk_size": int(data.get("chunk_size", 0)),
                "seeders": seeders,
                "leechers": 0,
                "created_at": data.get("created_at", ""),
                "magnet_uri": data.get("magnet_uri", ""),
                "info_hash": info_hash,
            })
        return files

    async def get_file_info(self, file_id: str) -> dict | None:
        if not self.redis:
            return None
        data = await self.redis.hgetall(f"file:{file_id}")
        if not data:
            return None
        info_hash = data.get("info_hash", "")
        seeders = await self.get_seeders_count(info_hash)
        return {
            "file_id": file_id,
            "file_name": data.get("file_name", ""),
            "total_size": int(data.get("total_size", 0)),
            "total_chunks": int(data.get("total_chunks", 0)),
            "chunk_size": int(data.get("chunk_size", 0)),
            "seeders": seeders,
            "leechers": 0,
            "created_at": data.get("created_at", ""),
            "magnet_uri": data.get("magnet_uri", ""),
            "info_hash": info_hash,
        }

    async def get_peer_health(self, info_hash: str) -> list[dict]:
        if not self.redis:
            return []
        all_peers = await self.redis.hgetall(f"peers:{info_hash}")
        result = []
        for pid, pdata_str in all_peers.items():
            try:
                pdata = json.loads(pdata_str)
                result.append({
                    "peer_id": pid,
                    "ip": pdata["ip"],
                    "port": pdata["port"],
                    "upload_speed": pdata.get("upload_speed", 0.0),
                    "fail_count": pdata.get("fail_count", 0),
                    "last_seen": pdata.get("last_seen", ""),
                    "last_ping": pdata.get("last_ping", ""),
                    "alive": pdata.get("fail_count", 0) < HEALTH_CHECK_MAX_FAILURES,
                })
            except (json.JSONDecodeError, KeyError):
                continue
        result.sort(key=lambda p: p.get("upload_speed", 0.0), reverse=True)
        return result


class HotnessService:
    def __init__(self):
        self.redis: redis.Redis | None = None
        self._hotness_task: asyncio.Task | None = None
        self._download_counts_window: dict[str, list[int]] = {}

    async def init_redis(self):
        self.redis = redis.from_url(REDIS_URL, decode_responses=True)

    async def close_redis(self):
        if self._hotness_task:
            self._hotness_task.cancel()
            try:
                await self._hotness_task
            except asyncio.CancelledError:
                pass
            self._hotness_task = None
        if self.redis:
            await self.redis.close()

    def start_hotness_monitor(self):
        if self._hotness_task is None or self._hotness_task.done():
            self._hotness_task = asyncio.create_task(self._hotness_monitor_loop())

    async def _hotness_monitor_loop(self):
        logger.info("Hotness monitor loop started (threshold=%d/min, check_interval=%ds)",
                     HOTNESS_THRESHOLD, HOTNESS_CHECK_INTERVAL)
        while True:
            try:
                await asyncio.sleep(HOTNESS_CHECK_INTERVAL)
                await self._check_hot_files()
            except asyncio.CancelledError:
                logger.info("Hotness monitor loop cancelled")
                break
            except Exception as e:
                logger.error("Hotness monitor error: %s", e)

    async def record_download(self, info_hash: str):
        if not self.redis:
            return
        timestamp = int(datetime.now(timezone.utc).timestamp())
        await self.redis.zadd(f"downloads:{info_hash}", {str(timestamp): timestamp})
        await self.redis.expire(f"downloads:{info_hash}", HOTNESS_WINDOW_SECONDS * 2)

    async def get_download_count_window(self, info_hash: str) -> tuple[int, int]:
        if not self.redis:
            return (0, 0)

        now = int(datetime.now(timezone.utc).timestamp())
        window_start = now - HOTNESS_WINDOW_SECONDS
        last_minute_start = now - 60

        window_count = await self.redis.zcount(f"downloads:{info_hash}", window_start, now)
        last_minute_count = await self.redis.zcount(f"downloads:{info_hash}", last_minute_start, now)

        return (last_minute_count, window_count)

    async def _check_hot_files(self):
        if not self.redis:
            return

        keys = []
        async for key in self.redis.scan_iter("downloads:*"):
            keys.append(key)

        hot_files = []
        for key in keys:
            info_hash = key.replace("downloads:", "")
            last_minute_count, window_count = await self.get_download_count_window(info_hash)

            if last_minute_count > 0:
                hotness_score = self._calculate_hotness_score(last_minute_count, window_count)
                is_hot = last_minute_count >= HOTNESS_THRESHOLD

                if is_hot:
                    file_info = await self._get_file_by_info_hash(info_hash)
                    if file_info:
                        replicas = await self._get_replica_count(info_hash)
                        trending_up = last_minute_count > (window_count / max(1, HOTNESS_WINDOW_SECONDS // 60))

                        hot_files.append({
                            "file_id": file_info["file_id"],
                            "file_name": file_info["file_name"],
                            "info_hash": info_hash,
                            "download_count_last_minute": last_minute_count,
                            "download_count_window": window_count,
                            "hotness_score": hotness_score,
                            "threshold": HOTNESS_THRESHOLD,
                            "is_hot": is_hot,
                            "replicas": replicas,
                            "max_replicas": MAX_REPLICAS_PER_FILE,
                            "trending_up": trending_up,
                        })

                        if replicas < MAX_REPLICAS_PER_FILE:
                            await self._trigger_auto_replication(
                                file_info["file_id"],
                                info_hash,
                                file_info["file_name"],
                                last_minute_count
                            )

        await self.redis.setex(
            "hotness:latest",
            HOTNESS_CHECK_INTERVAL * 2,
            json.dumps({"hot_files": hot_files, "timestamp": datetime.now(timezone.utc).isoformat()})
        )

    def _calculate_hotness_score(self, last_minute: int, window: int) -> float:
        if window == 0:
            return 0.0
        recency_factor = last_minute / max(1, HOTNESS_THRESHOLD)
        sustained_factor = min(1.0, window / max(1, HOTNESS_THRESHOLD * 5))
        return round(recency_factor * 0.7 + sustained_factor * 0.3, 2)

    async def _get_file_by_info_hash(self, info_hash: str) -> dict | None:
        if not self.redis:
            return None
        async for key in self.redis.scan_iter("file:*"):
            data = await self.redis.hgetall(key)
            if data.get("info_hash") == info_hash:
                return {
                    "file_id": key.replace("file:", ""),
                    "file_name": data.get("file_name", ""),
                    "info_hash": info_hash,
                }
        return None

    async def _get_replica_count(self, info_hash: str) -> int:
        if not self.redis:
            return 0
        return len(await self.redis.hgetall(f"replicas:{info_hash}"))

    async def _trigger_auto_replication(self, file_id: str, info_hash: str, file_name: str, download_count: int):
        if not self.redis:
            return

        existing = await self.redis.get(f"replicate:cooldown:{info_hash}")
        if existing:
            logger.debug("Replication cooldown active for %s", info_hash)
            return

        replicas_needed = min(
            MAX_REPLICAS_PER_FILE - await self._get_replica_count(info_hash),
            max(1, download_count // HOTNESS_THRESHOLD)
        )

        if replicas_needed > 0:
            logger.info(
                "Auto-replicating hot file %s (%s) - %d downloads/min, creating %d replicas",
                file_name, info_hash, download_count, replicas_needed
            )

            try:
                await edge_node_service.create_replicas(file_id, info_hash, file_name, replicas_needed)
                await self.redis.setex(f"replicate:cooldown:{info_hash}", 300, "1")
            except Exception as e:
                logger.error("Auto-replication failed for %s: %s", info_hash, e)

    async def get_hot_files(self) -> dict:
        if not self.redis:
            return {"hot_files": [], "total_active_files": 0, "total_replicas": 0, "threshold": HOTNESS_THRESHOLD, "auto_replication_enabled": True}

        cached = await self.redis.get("hotness:latest")
        if cached:
            try:
                data = json.loads(cached)
                data["threshold"] = HOTNESS_THRESHOLD
                data["auto_replication_enabled"] = True
                return data
            except (json.JSONDecodeError, KeyError):
                pass

        return {"hot_files": [], "total_active_files": 0, "total_replicas": 0, "threshold": HOTNESS_THRESHOLD, "auto_replication_enabled": True}

    async def get_file_hotness(self, file_id: str) -> dict | None:
        if not self.redis:
            return None

        data = await self.redis.hgetall(f"file:{file_id}")
        if not data:
            return None

        info_hash = data.get("info_hash", "")
        last_minute_count, window_count = await self.get_download_count_window(info_hash)
        replicas = await self._get_replica_count(info_hash)

        return {
            "file_id": file_id,
            "file_name": data.get("file_name", ""),
            "info_hash": info_hash,
            "download_count_last_minute": last_minute_count,
            "download_count_window": window_count,
            "hotness_score": self._calculate_hotness_score(last_minute_count, window_count),
            "threshold": HOTNESS_THRESHOLD,
            "is_hot": last_minute_count >= HOTNESS_THRESHOLD,
            "replicas": replicas,
            "max_replicas": MAX_REPLICAS_PER_FILE,
            "trending_up": last_minute_count > (window_count / max(1, HOTNESS_WINDOW_SECONDS // 60)),
        }


class DockerService:
    def __init__(self):
        self._docker = None

    async def init_docker(self):
        try:
            import docker
            self._docker = docker.DockerClient(base_url=DOCKER_API_URL)
            logger.info("Docker client initialized: %s", DOCKER_API_URL)
        except Exception as e:
            logger.warning("Docker client initialization failed: %s", e)
            self._docker = None

    def is_available(self) -> bool:
        return self._docker is not None

    async def create_seeder_container(
        self,
        node_id: str,
        file_id: str,
        info_hash: str,
        file_name: str,
        port: int,
        magnet_uri: str,
    ) -> dict | None:
        if not self.is_available():
            logger.warning("Docker not available, simulating container creation for %s", info_hash)
            return self._simulate_container(node_id, file_id, info_hash, file_name, port)

        try:
            container_name = f"{SEEDER_CONTAINER_PREFIX}{node_id}-{file_id[:8]}"
            environment = {
                "WEBTORRENT_MAGNET": magnet_uri,
                "WEBTORRENT_PORT": str(port),
                "NODE_ID": node_id,
                "FILE_ID": file_id,
            }

            container = self._docker.containers.run(
                SEEDER_CONTAINER_IMAGE,
                name=container_name,
                detach=True,
                environment=environment,
                ports={f"{port}/tcp": port},
                restart_policy={"Name": "on-failure"},
                mem_limit="256m",
            )

            return {
                "container_id": container.id,
                "container_name": container_name,
                "node_id": node_id,
                "file_id": file_id,
                "info_hash": info_hash,
                "file_name": file_name,
                "port": port,
                "status": "starting",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            logger.error("Docker container creation failed: %s", e)
            return self._simulate_container(node_id, file_id, info_hash, file_name, port)

    def _simulate_container(self, node_id: str, file_id: str, info_hash: str, file_name: str, port: int) -> dict:
        return {
            "container_id": f"sim-{node_id}-{file_id[:8]}-{generate_id(12)}",
            "container_name": f"{SEEDER_CONTAINER_PREFIX}{node_id}-{file_id[:8]}",
            "node_id": node_id,
            "file_id": file_id,
            "info_hash": info_hash,
            "file_name": file_name,
            "port": port,
            "status": "running",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "simulated": True,
        }

    async def stop_container(self, container_id: str) -> bool:
        if not self.is_available():
            logger.info("Docker not available, simulated stop for %s", container_id)
            return True
        try:
            container = self._docker.containers.get(container_id)
            container.stop()
            container.remove()
            return True
        except Exception as e:
            logger.error("Docker container stop failed: %s", e)
            return True

    async def list_containers(self) -> list[dict]:
        if not self.is_available():
            return []
        try:
            containers = self._docker.containers.list(all=True)
            result = []
            for c in containers:
                if c.name.startswith(SEEDER_CONTAINER_PREFIX):
                    result.append({
                        "container_id": c.id,
                        "name": c.name,
                        "status": c.status,
                        "ports": c.attrs.get("NetworkSettings", {}).get("Ports", {}),
                    })
            return result
        except Exception as e:
            logger.error("Docker list containers failed: %s", e)
            return []


class EdgeNodeService:
    def __init__(self):
        self.redis: redis.Redis | None = None
        self._next_port = 6881
        self.docker_service = DockerService()

    async def init_redis(self):
        self.redis = redis.from_url(REDIS_URL, decode_responses=True)
        await self.docker_service.init_docker()
        await self._init_node_metadata()

    async def close_redis(self):
        if self.redis:
            await self.redis.close()

    async def _init_node_metadata(self):
        if not self.redis:
            return
        for node in EDGE_NODES:
            node_key = f"node:{node['id']}"
            existing = await self.redis.hgetall(node_key)
            if not existing:
                await self.redis.hset(node_key, mapping={
                    "id": node["id"],
                    "name": node["name"],
                    "region": node["region"],
                    "city": node["city"],
                    "lat": str(node["lat"]),
                    "lng": str(node["lng"]),
                    "capacity": str(node["capacity"]),
                    "used_slots": "0",
                    "status": "online",
                })

    async def list_nodes(self) -> list[dict]:
        if not self.redis:
            return []
        nodes = []
        async for key in self.redis.scan_iter("node:*"):
            data = await self.redis.hgetall(key)
            node_id = key.replace("node:", "")
            containers = await self._get_node_containers(node_id)
            nodes.append({
                "id": node_id,
                "name": data.get("name", ""),
                "region": data.get("region", ""),
                "city": data.get("city", ""),
                "lat": float(data.get("lat", 0)),
                "lng": float(data.get("lng", 0)),
                "capacity": int(data.get("capacity", 0)),
                "used_slots": int(data.get("used_slots", 0)),
                "status": data.get("status", "online"),
                "containers": containers,
            })
        return nodes

    async def _get_node_containers(self, node_id: str) -> list[str]:
        if not self.redis:
            return []
        containers = []
        async for key in self.redis.scan_iter("replicas:*"):
            all_replicas = await self.redis.hgetall(key)
            for _, rdata_str in all_replicas.items():
                try:
                    rdata = json.loads(rdata_str)
                    if rdata.get("node_id") == node_id:
                        containers.append(rdata.get("container_id", ""))
                except (json.JSONDecodeError, KeyError):
                    continue
        return containers

    async def get_available_nodes(self, count: int = 1) -> list[dict]:
        nodes = await self.list_nodes()
        available = [
            n for n in nodes
            if n["status"] == "online" and n["used_slots"] < n["capacity"]
        ]
        available.sort(key=lambda n: (n["used_slots"] / max(1, n["capacity"]), -n["capacity"]))
        return available[:count]

    async def create_replicas(
        self,
        file_id: str,
        info_hash: str,
        file_name: str,
        count: int = 1,
        target_node_ids: list[str] | None = None,
    ) -> list[dict]:
        if not self.redis:
            return []

        existing_count = len(await self.redis.hgetall(f"replicas:{info_hash}"))
        if existing_count >= MAX_REPLICAS_PER_FILE:
            logger.info("Max replicas reached for %s (%d/%d)", info_hash, existing_count, MAX_REPLICAS_PER_FILE)
            return []

        remaining = min(count, MAX_REPLICAS_PER_FILE - existing_count)
        if remaining <= 0:
            return []

        if target_node_ids:
            available = [n for n in await self.list_nodes() if n["id"] in target_node_ids]
        else:
            available = await self.get_available_nodes(remaining)

        created = []
        file_data = await self.redis.hgetall(f"file:{file_id}")
        magnet_uri = file_data.get("magnet_uri", "")

        for node in available[:remaining]:
            try:
                port = self._get_next_port()
                container = await self.docker_service.create_seeder_container(
                    node["id"], file_id, info_hash, file_name, port, magnet_uri
                )

                if container:
                    replica_data = json.dumps({
                        "container_id": container["container_id"],
                        "node_id": node["id"],
                        "file_id": file_id,
                        "info_hash": info_hash,
                        "file_name": file_name,
                        "port": port,
                        "status": container.get("status", "running"),
                        "created_at": container.get("created_at", datetime.now(timezone.utc).isoformat()),
                        "upload_speed": 0.0,
                        "download_count": 0,
                        "simulated": container.get("simulated", False),
                    })

                    await self.redis.hset(f"replicas:{info_hash}", container["container_id"], replica_data)
                    await self.redis.hincrby(f"node:{node['id']}", "used_slots", 1)

                    created.append(json.loads(replica_data))
                    logger.info(
                        "Created replica for %s on node %s (container=%s, port=%d)",
                        file_name, node["name"], container["container_id"][:12], port
                    )

            except Exception as e:
                logger.error("Failed to create replica on node %s: %s", node["id"], e)
                continue

        return created

    async def remove_replica(self, container_id: str) -> bool:
        if not self.redis:
            return False

        info_hash = None
        node_id = None

        async for key in self.redis.scan_iter("replicas:*"):
            replica_data_str = await self.redis.hget(key, container_id)
            if replica_data_str:
                try:
                    replica_data = json.loads(replica_data_str)
                    info_hash = key.replace("replicas:", "")
                    node_id = replica_data.get("node_id")
                    break
                except (json.JSONDecodeError, KeyError):
                    continue

        if not info_hash:
            logger.warning("Replica not found: %s", container_id)
            return False

        await self.docker_service.stop_container(container_id)
        await self.redis.hdel(f"replicas:{info_hash}", container_id)

        if node_id:
            used_slots = await self.redis.hget(f"node:{node_id}", "used_slots")
            if used_slots and int(used_slots) > 0:
                await self.redis.hincrby(f"node:{node_id}", "used_slots", -1)

        logger.info("Removed replica %s", container_id[:12])
        return True

    async def get_replicas(self, info_hash: str | None = None) -> list[dict]:
        if not self.redis:
            return []

        replicas = []
        async for key in self.redis.scan_iter("replicas:*"):
            if info_hash and key != f"replicas:{info_hash}":
                continue
            all_replicas = await self.redis.hgetall(key)
            for _, rdata_str in all_replicas.items():
                try:
                    replicas.append(json.loads(rdata_str))
                except (json.JSONDecodeError, KeyError):
                    continue
        return replicas

    async def get_heatmap_data(self) -> dict:
        nodes = await self.list_nodes()
        replicas = await self.get_replicas()

        node_activity: dict[str, dict] = {}
        for replica in replicas:
            node_id = replica["node_id"]
            if node_id not in node_activity:
                node_activity[node_id] = {
                    "total_upload": 0,
                    "avg_upload_speed": 0,
                    "container_count": 0,
                    "download_count": 0,
                }
            node_activity[node_id]["container_count"] += 1
            node_activity[node_id]["total_upload"] += replica.get("upload_speed", 0) * 3600
            node_activity[node_id]["avg_upload_speed"] += replica.get("upload_speed", 0)
            node_activity[node_id]["download_count"] += replica.get("download_count", 0)

        points = []
        node_activities = []

        for node in nodes:
            activity = node_activity.get(node["id"], {
                "total_upload": 0,
                "avg_upload_speed": 0,
                "container_count": 0,
                "download_count": 0,
            })

            base_score = node["used_slots"] / max(1, node["capacity"])
            container_bonus = activity["container_count"] * 0.1
            activity_score = min(1.0, base_score + container_bonus)

            if activity["container_count"] > 0:
                activity["avg_upload_speed"] /= activity["container_count"]

            point_value = 0.5 + (activity_score * 0.5)
            if node["status"] != "online":
                point_value = 0.1

            points.append({
                "lat": node["lat"],
                "lng": node["lng"],
                "value": point_value,
                "city": node["city"],
                "node_id": node["id"],
                "activity_score": round(activity_score, 2),
                "container_count": activity["container_count"],
            })

            node_activities.append({
                "node_id": node["id"],
                "name": node["name"],
                "city": node["city"],
                "region": node["region"],
                "lat": node["lat"],
                "lng": node["lng"],
                "activity_score": round(activity_score, 2),
                "container_count": activity["container_count"],
                "total_upload": round(activity["total_upload"], 2),
                "avg_upload_speed": round(activity["avg_upload_speed"], 2),
                "status": node["status"],
            })

        node_activities.sort(key=lambda n: n["activity_score"], reverse=True)

        return {
            "points": points,
            "nodes": node_activities,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def _get_next_port(self) -> int:
        port = self._next_port
        self._next_port += 1
        if self._next_port > 6999:
            self._next_port = 6881
        return port


def generate_id(length: int = 8) -> str:
    import string
    chars = string.ascii_lowercase + string.digits
    return ''.join(random.choice(chars) for _ in range(length))


chunk_service = ChunkService()
torrent_service = TorrentService(chunk_service)
tracker_service = TrackerService()
hotness_service = HotnessService()
edge_node_service = EdgeNodeService()
