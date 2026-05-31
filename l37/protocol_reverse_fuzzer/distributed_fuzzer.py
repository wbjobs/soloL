import json
import time
import uuid
import threading
import hashlib
import base64
from typing import List, Dict, Set, Optional, Callable, Any
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict
import os


class TaskStatus(Enum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CRASHED = "crashed"


class WorkerStatus(Enum):
    IDLE = "idle"
    BUSY = "busy"
    OFFLINE = "offline"
    DEAD = "dead"


@dataclass
class FuzzTask:
    task_id: str
    message_data: bytes
    mutation_strategies: List[str]
    max_attempts: int = 3
    status: TaskStatus = TaskStatus.PENDING
    assigned_worker: Optional[str] = None
    result: Optional[Dict] = None
    created_at: float = 0.0
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    attempts: int = 0

    def to_dict(self) -> Dict:
        return {
            "task_id": self.task_id,
            "message_data": base64.b64encode(self.message_data).decode(),
            "mutation_strategies": self.mutation_strategies,
            "max_attempts": self.max_attempts,
            "status": self.status.value,
            "assigned_worker": self.assigned_worker,
            "result": self.result,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "attempts": self.attempts
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "FuzzTask":
        return cls(
            task_id=data["task_id"],
            message_data=base64.b64decode(data["message_data"]),
            mutation_strategies=data.get("mutation_strategies", []),
            max_attempts=data.get("max_attempts", 3),
            status=TaskStatus(data.get("status", "pending")),
            assigned_worker=data.get("assigned_worker"),
            result=data.get("result"),
            created_at=data.get("created_at", 0.0),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
            attempts=data.get("attempts", 0)
        )


@dataclass
class WorkerInfo:
    worker_id: str
    hostname: str
    status: WorkerStatus = WorkerStatus.IDLE
    current_task: Optional[str] = None
    tasks_completed: int = 0
    tasks_failed: int = 0
    crashes_found: int = 0
    last_heartbeat: float = 0.0
    registered_at: float = 0.0

    def to_dict(self) -> Dict:
        return {
            "worker_id": self.worker_id,
            "worker_hostname": self.hostname,
            "status": self.status.value,
            "current_task": self.current_task,
            "tasks_completed": self.tasks_completed,
            "tasks_failed": self.tasks_failed,
            "crashes_found": self.crashes_found,
            "last_heartbeat": self.last_heartbeat,
            "registered_at": self.registered_at
        }


class RedisQueueInterface:
    def __init__(self, redis_host: str = "localhost",
                 redis_port: int = 6379,
                 redis_db: int = 0,
                 namespace: str = "dist_fuzzer"):
        self.redis_host = redis_host
        self.redis_port = redis_port
        self.redis_db = redis_db
        self.namespace = namespace
        self._redis = None
        self._connected = False

    def _get_redis_client(self):
        if self._redis is None:
            try:
                import redis
                self._redis = redis.Redis(
                    host=self.redis_host,
                    port=self.redis_port,
                    db=self.redis_db,
                    decode_responses=False
                )
                self._connected = True
            except ImportError:
                pass
        return self._redis

    def is_available(self) -> bool:
        try:
            client = self._get_redis_client()
            if client:
                client.ping()
                return True
        except Exception:
            pass
        return False

    def _key(self, name: str) -> str:
        return f"{self.namespace}:{name}"


class DistributedFuzzerMaster(RedisQueueInterface):
    def __init__(self, redis_host: str = "localhost",
                 redis_port: int = 6379,
                 redis_db: int = 0,
                 namespace: str = "dist_fuzzer",
                 target_host: str = "127.0.0.1",
                 target_port: int = 8080,
                 protocol: str = "tcp",
                 heartbeat_timeout: float = 30.0):
        super().__init__(redis_host, redis_port, redis_db, namespace)
        self.target_host = target_host
        self.target_port = target_port
        self.protocol = protocol
        self.heartbeat_timeout = heartbeat_timeout
        self._running = False
        self._lock = threading.Lock()
        self._callbacks: Dict[str, Callable] = defaultdict(list)
        self._seen_crashes: Set[str] = set()
        self._corpus: Set[str] = set()

    def on(self, event: str, callback: Callable):
        self._callbacks[event].append(callback)

    def _emit(self, event: str, *args, **kwargs):
        for callback in self._callbacks.get(event, []):
            try:
                callback(*args, **kwargs)
            except Exception:
                pass

    def submit_task(self, message_data: bytes,
                    mutation_strategies: Optional[List[str]] = None) -> str:
        task_id = str(uuid.uuid4())
        task = FuzzTask(
            task_id=task_id,
            message_data=message_data,
            mutation_strategies=mutation_strategies or ["random"],
            created_at=time.time()
        )

        client = self._get_redis_client()
        if client:
            client.rpush(self._key("tasks:pending"), task_id)
            client.set(self._key(f"task:{task_id}"), json.dumps(task.to_dict()))
            client.sadd(self._key("tasks:all"), task_id)

        return task_id

    def submit_tasks_bulk(self, messages: List[bytes],
                          mutation_strategies: Optional[List[str]] = None
                          ) -> List[str]:
        task_ids = []
        for msg in messages:
            task_ids.append(self.submit_task(msg, mutation_strategies))
        return task_ids

    def get_task(self, task_id: str) -> Optional[FuzzTask]:
        client = self._get_redis_client()
        if client:
            data = client.get(self._key(f"task:{task_id}"))
            if data:
                return FuzzTask.from_dict(json.loads(data))
        return None

    def get_stats(self) -> Dict:
        client = self._get_redis_client()
        stats = {
            "pending": 0,
            "assigned": 0,
            "completed": 0,
            "failed": 0,
            "crashed": 0,
            "workers_online": 0,
            "total_crashes": 0,
            "corpus_size": 0
        }
        if client:
            stats["pending"] = client.llen(self._key("tasks:pending")) or 0
            stats["assigned"] = client.llen(self._key("tasks:assigned")) or 0
            stats["total_crashes"] = client.llen(self._key("crashes:recent")) or 0
            stats["workers_online"] = len(self.get_workers())
            stats["corpus_size"] = client.scard(self._key("corpus:all")) or 0
        return stats

    def get_workers(self) -> List[Dict]:
        client = self._get_redis_client()
        workers = []
        if client:
            for wid in client.smembers(self._key("workers:all")):
                data = client.get(self._key(f"worker:{wid}"))
                if data:
                    workers.append(json.loads(data))
        return workers

    def get_recent_crashes(self, limit: int = 10) -> List[Dict]:
        client = self._get_redis_client()
        crashes = []
        if client:
            crash_ids = client.lrange(self._key("crashes:recent"), 0, limit - 1)
            for cid in crash_ids:
                data = client.get(self._key(f"crash:{cid}"))
                if data:
                    crashes.append(json.loads(data))
        return crashes

    def get_corpus(self) -> List[bytes]:
        client = self._get_redis_client()
        corpus = []
        if client:
            for entry in client.smembers(self._key("corpus:all")):
                try:
                    corpus.append(base64.b64decode(entry))
                except Exception:
                    pass
        return corpus

    def start(self, daemon: bool = True):
        self._running = True

        def monitor_loop():
            while self._running:
                try:
                    pass
                except Exception:
                    pass
                time.sleep(1)

        if daemon:
            t = threading.Thread(target=monitor_loop, daemon=True)
            t.start()
        else:
            monitor_loop()

    def stop(self):
        self._running = False

    def wait_for_completion(self, timeout: Optional[float] = None):
        start = time.time()
        while self._running:
            stats = self.get_stats()
            if stats["pending"] == 0 and stats["assigned"] == 0:
                break
            if timeout and (time.time() - start) > timeout:
                break
            time.sleep(1)


class DistributedFuzzerWorker(RedisQueueInterface):
    def __init__(self, redis_host: str = "localhost",
                 redis_port: int = 6379,
                 redis_db: int = 0,
                 namespace: str = "dist_fuzzer",
                 worker_id: Optional[str] = None,
                 hostname: Optional[str] = None,
                 target_host: str = "127.0.0.1",
                 target_port: int = 8080,
                 protocol: str = "tcp",
                 heartbeat_interval: float = 5.0,
                 coverage_guided: bool = False):
        super().__init__(redis_host, redis_port, redis_db, namespace)
        self.worker_id = worker_id or str(uuid.uuid4())[:8]
        self.hostname = hostname or (os.uname()[1] if hasattr(os, 'uname') else "unknown")
        self.target_host = target_host
        self.target_port = target_port
        self.protocol = protocol
        self.heartbeat_interval = heartbeat_interval
        self.coverage_guided = coverage_guided
        self._running = False
        self._fuzzer = None
        self._local_corpus: Set[bytes] = set()

    def _init_fuzzer(self):
        if self._fuzzer is None:
            from .fuzzer import Fuzzer
            self._fuzzer = Fuzzer(
                target_host=self.target_host,
                target_port=self.target_port,
                protocol=self.protocol,
                timeout=5.0,
                coverage_guided=self.coverage_guided
            )

    def register(self) -> bool:
        client = self._get_redis_client()
        if client:
            info = WorkerInfo(
                worker_id=self.worker_id,
                hostname=self.hostname,
                status=WorkerStatus.IDLE,
                registered_at=time.time(),
                last_heartbeat=time.time()
            )
            client.set(self._key(f"worker:{self.worker_id}"), json.dumps(info.to_dict()))
            client.sadd(self._key("workers:all"), self.worker_id)
            return True
        return False

    def unregister(self):
        client = self._get_redis_client()
        if client:
            client.srem(self._key("workers:all"), self.worker_id)
            client.delete(self._key(f"worker:{self.worker_id}"))

    def send_heartbeat(self, status: WorkerStatus = WorkerStatus.IDLE,
                       current_task: Optional[str] = None,
                       crashes_found: int = 0):
        client = self._get_redis_client()
        if client:
            data = client.get(self._key(f"worker:{self.worker_id}"))
            if data:
                info = json.loads(data)
                info["status"] = status.value
                info["current_task"] = current_task
                info["last_heartbeat"] = time.time()
                info["crashes_found"] = crashes_found
                client.set(self._key(f"worker:{self.worker_id}"), json.dumps(info))

    def fetch_task(self) -> Optional[FuzzTask]:
        client = self._get_redis_client()
        if client:
            task_id = client.lmove(
                self._key("tasks:pending"),
                self._key("tasks:assigned"),
                "LEFT",
                "RIGHT"
            )
            if task_id:
                data = client.get(self._key(f"task:{task_id}"))
                if data:
                    task = FuzzTask.from_dict(json.loads(data))
                    task.status = TaskStatus.ASSIGNED
                    task.assigned_worker = self.worker_id
                    client.set(self._key(f"task:{task_id}"), json.dumps(task.to_dict()))
                    return task
        return None

    def execute_task(self, task: FuzzTask) -> Dict:
        self._init_fuzzer()

        result = {
            "worker_id": self.worker_id,
            "task_id": task.task_id,
            "crashed": False,
            "crash_details": None,
            "new_corpus_entries": []
        }

        try:
            from .fuzzer import MutationStrategy

            strategies = [MutationStrategy(s) for s in task.mutation_strategies
                          if s in MutationStrategy.__members__]

            if not strategies:
                strategies = [MutationStrategy.RANDOM_BYTES]

            mutated_data = task.message_data

            for strategy in strategies[:3]:
                mutated_data, details, strategy_used = self._fuzzer.mutator.mutate_random(
                    task.message_data, strategy)

                response, elapsed, error = self._fuzzer._send_and_receive(mutated_data)
                has_crashed, crash_details = self._fuzzer._check_crash(response, error, elapsed)

                if has_crashed:
                    result["crashed"] = True
                    result["crash_details"] = crash_details
                    result["mutated_data"] = base64.b64encode(mutated_data).decode()
                    break

                if self.coverage_guided and self._fuzzer._coverage_fuzzer:
                    cov_result = self._fuzzer._coverage_fuzzer.update_coverage(
                        input_data=mutated_data,
                        response=response or b"",
                        error=error,
                        execution_time=elapsed
                    )
                    if cov_result["has_new_coverage"]:
                        corpus_entry = base64.b64encode(mutated_data).decode()
                        result["new_corpus_entries"].append(corpus_entry)
                        self._local_corpus.add(mutated_data)

        except Exception as e:
            result["error"] = str(e)

        return result

    def report_result(self, task: FuzzTask, result: Dict):
        client = self._get_redis_client()
        if not client:
            return

        task.status = TaskStatus.COMPLETED if not result.get("crashed") else TaskStatus.CRASHED
        task.result = result
        task.completed_at = time.time()

        client.set(self._key(f"task:{task.task_id}"), json.dumps(task.to_dict()))
        client.lrem(self._key("tasks:assigned"), 1, task.task_id)

        if result.get("crashed"):
            crash_hash = hashlib.sha256(result.get("mutated_data", "").encode()).hexdigest()[:16]

            crash_report = {
                "crash_id": crash_hash,
                "worker_id": self.worker_id,
                "task_id": task.task_id,
                "message_data": base64.b64encode(task.message_data).decode(),
                "mutated_data": result.get("mutated_data"),
                "crash_details": result.get("crash_details"),
                "timestamp": time.time()
            }

            client.set(self._key(f"crash:{crash_hash}"), json.dumps(crash_report))
            client.lpush(self._key("crashes:recent"), crash_hash)
            client.ltrim(self._key("crashes:recent"), 0, 999)

        for corpus_entry in result.get("new_corpus_entries", []):
            client.sadd(self._key("corpus:all"), corpus_entry)

        client.lpush(self._key("tasks:results"), json.dumps({
            "task_id": task.task_id,
            "worker_id": self.worker_id,
            "status": task.status.value,
            "timestamp": time.time()
        }))

    def run_loop(self):
        self._running = True
        self.register()

        try:
            while self._running:
                self.send_heartbeat(WorkerStatus.IDLE)

                task = self.fetch_task()
                if task:
                    self.send_heartbeat(WorkerStatus.BUSY, task.task_id)

                    result = self.execute_task(task)
                    self.report_result(task, result)
                else:
                    time.sleep(0.5)

        finally:
            self.unregister()
            self._running = False

    def run_once(self) -> bool:
        self.register()
        try:
            task = self.fetch_task()
            if task:
                result = self.execute_task(task)
                self.report_result(task, result)
                return True
            return False
        finally:
            self.unregister()


class CorpusSynchronizer:
    def __init__(self, master: DistributedFuzzerMaster,
                 local_dir: str = "./corpus"):
        self.master = master
        self.local_dir = local_dir
        os.makedirs(local_dir, exist_ok=True)

    def sync_from_remote(self):
        corpus = self.master.get_corpus()
        for entry in corpus:
            filename = os.path.join(
                self.local_dir,
                f"corpus_{hashlib.md5(entry).hexdigest()[:16]}.bin"
            )
            if not os.path.exists(filename):
                with open(filename, 'wb') as f:
                    f.write(entry)

    def sync_to_remote(self):
        for filename in os.listdir(self.local_dir):
            if filename.endswith('.bin'):
                filepath = os.path.join(self.local_dir, filename)
                with open(filepath, 'rb') as f:
                    data = f.read()
                self.master.submit_task(data)
