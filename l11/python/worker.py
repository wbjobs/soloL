import os
import sys
import json
import time
import signal
import logging
import gc
import traceback
from pathlib import Path
from typing import Optional, Dict, Any
from dataclasses import dataclass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
import redis

from midi_parser import parse_midi, analysis_to_dict
from music_classifier import classify_music

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger('midi_worker')

REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', '6379'))
REDIS_PASSWORD = os.getenv('REDIS_PASSWORD', None)
REDIS_DB = int(os.getenv('REDIS_DB', '0'))

STREAM_NAME = 'midi:analysis:queue'
GROUP_NAME = 'midi_analysis_workers'
RESULTS_STREAM = 'midi:analysis:results'

MAX_TASK_RETRIES = 3
TASK_TIMEOUT = 300
MEMORY_CLEANUP_INTERVAL = 10


@dataclass
class TaskResult:
    success: bool
    analysis_id: str
    batch_id: Optional[str]
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class MidiWorker:
    def __init__(self, worker_id: str):
        self.worker_id = worker_id
        self.redis_client: Optional[redis.Redis] = None
        self.running = False
        self.task_count = 0
        self._register_signal_handlers()

    def _register_signal_handlers(self):
        signal.signal(signal.SIGINT, self._handle_shutdown)
        signal.signal(signal.SIGTERM, self._handle_shutdown)

    def _handle_shutdown(self, signum, frame):
        logger.info(f"Received signal {signum}, shutting down worker {self.worker_id}")
        self.running = False

    def connect(self) -> bool:
        try:
            self.redis_client = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                password=REDIS_PASSWORD,
                db=REDIS_DB,
                decode_responses=True,
                socket_timeout=30,
                socket_connect_timeout=10,
                retry_on_timeout=True,
                health_check_interval=30,
            )
            self.redis_client.ping()
            logger.info(f"✅ Worker {self.worker_id} connected to Redis at {REDIS_HOST}:{REDIS_PORT}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to connect to Redis: {e}")
            return False

    def ensure_consumer_group(self):
        try:
            self.redis_client.xgroup_create(
                STREAM_NAME,
                GROUP_NAME,
                id='0',
                mkstream=True
            )
            logger.info(f"✅ Consumer group {GROUP_NAME} created")
        except redis.exceptions.ResponseError as e:
            if 'BUSYGROUP' in str(e):
                logger.info(f"ℹ️  Consumer group {GROUP_NAME} already exists")
            else:
                raise

    def claim_pending_tasks(self):
        try:
            pending = self.redis_client.xpending_range(
                STREAM_NAME,
                GROUP_NAME,
                min='-',
                max='+',
                count=100
            )
            
            for pending_info in pending:
                if pending_info['consumer'] != self.worker_id:
                    idle_time = pending_info['time_since_delivered']
                    if idle_time > TASK_TIMEOUT * 1000:
                        logger.info(f"🔄 Claiming abandoned task: {pending_info['message_id']} (idle: {idle_time}ms)")
                        self.redis_client.xclaim(
                            STREAM_NAME,
                            GROUP_NAME,
                            self.worker_id,
                            10000,
                            pending_info['message_id']
                        )
        except Exception as e:
            logger.warning(f"Error claiming pending tasks: {e}")

    def fetch_task(self) -> Optional[Dict[str, Any]]:
        try:
            messages = self.redis_client.xreadgroup(
                GROUP_NAME,
                self.worker_id,
                {STREAM_NAME: '>'},
                count=1,
                block=5000
            )

            if not messages:
                return None

            for stream, entries in messages:
                for msg_id, fields in entries:
                    payload = fields.get('payload')
                    if payload:
                        try:
                            task_data = json.loads(payload)
                            return {
                                'id': msg_id,
                                'data': task_data
                            }
                        except json.JSONDecodeError:
                            logger.error(f"Invalid JSON payload in message {msg_id}")
                            self._ack_message(msg_id)

        except Exception as e:
            logger.error(f"Error fetching task: {e}")
            time.sleep(1)

        return None

    def _ack_message(self, msg_id: str):
        try:
            self.redis_client.xack(STREAM_NAME, GROUP_NAME, msg_id)
        except Exception as e:
            logger.error(f"Error acknowledging message {msg_id}: {e}")

    def _publish_result(self, result: TaskResult):
        try:
            result_payload = json.dumps({
                'success': result.success,
                'analysis_id': result.analysis_id,
                'batch_id': result.batch_id,
                'data': result.data,
                'error': result.error,
                'worker_id': self.worker_id,
                'processed_at': time.time()
            })
            
            self.redis_client.xadd(
                RESULTS_STREAM,
                {'payload': result_payload},
                maxlen=10000,
                approximate=True
            )
            
            status_key = f"analysis:status:{result.analysis_id}"
            self.redis_client.setex(
                status_key,
                3600,
                json.dumps({
                    'status': 'completed' if result.success else 'failed',
                    'error': result.error,
                    'worker_id': self.worker_id
                })
            )
            
        except Exception as e:
            logger.error(f"Error publishing result: {e}")

    def _update_status(self, analysis_id: str, status: str, progress: int = 0):
        try:
            status_key = f"analysis:status:{analysis_id}"
            self.redis_client.setex(
                status_key,
                3600,
                json.dumps({
                    'status': status,
                    'progress': progress,
                    'worker_id': self.worker_id,
                    'updated_at': time.time()
                })
            )
        except Exception as e:
            logger.debug(f"Error updating status: {e}")

    def process_task(self, task: Dict[str, Any]) -> TaskResult:
        task_data = task['data']
        analysis_id = task_data.get('analysis_id')
        file_path = task_data.get('file_path')
        batch_id = task_data.get('batch_id')
        original_name = task_data.get('original_name', 'unknown')

        logger.info(f"⚙️  Processing task: {analysis_id} ({original_name})")
        self._update_status(analysis_id, 'processing', 10)

        try:
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"MIDI file not found: {file_path}")

            file_size = os.path.getsize(file_path)
            logger.info(f"📄 File size: {file_size:,} bytes")
            self._update_status(analysis_id, 'parsing', 25)

            midi_analysis = parse_midi(file_path)
            midi_dict = analysis_to_dict(midi_analysis)
            logger.info(f"🎵 Parsed {midi_analysis.note_count} notes, {len(midi_analysis.instruments)} instruments")
            self._update_status(analysis_id, 'classifying', 60)

            classification = classify_music(midi_dict)
            logger.info(f"🏷️  Classification complete")
            self._update_status(analysis_id, 'saving', 90)

            result_data = {
                'midi_analysis': midi_dict,
                'classification': classification,
                'success': True
            }

            self._cleanup_memory()

            logger.info(f"✅ Task {analysis_id} completed successfully")
            return TaskResult(
                success=True,
                analysis_id=analysis_id,
                batch_id=batch_id,
                data=result_data
            )

        except Exception as e:
            error_msg = f"{type(e).__name__}: {str(e)}"
            logger.error(f"❌ Task {analysis_id} failed: {error_msg}")
            logger.error(traceback.format_exc())
            
            self._cleanup_memory()
            
            return TaskResult(
                success=False,
                analysis_id=analysis_id,
                batch_id=batch_id,
                error=error_msg
            )

    def _cleanup_memory(self):
        gc.collect()
        
        imported_modules = ['midi_parser', 'music_classifier']
        for mod_name in imported_modules:
            if mod_name in sys.modules:
                module = sys.modules[mod_name]
                for attr_name in dir(module):
                    if not attr_name.startswith('_'):
                        attr = getattr(module, attr_name)
                        if isinstance(attr, (list, dict, set)) and len(attr) > 10000:
                            logger.debug(f"Clearing large object: {mod_name}.{attr_name} ({len(attr)} items)")
                            attr.clear()

    def run(self):
        if not self.connect():
            sys.exit(1)

        self.ensure_consumer_group()
        self.claim_pending_tasks()

        self.running = True
        logger.info(f"🚀 Worker {self.worker_id} started, waiting for tasks...")

        while self.running:
            try:
                task = self.fetch_task()
                
                if task:
                    self._update_status(task['data']['analysis_id'], 'processing', 5)
                    result = self.process_task(task)
                    self._ack_message(task['id'])
                    self._publish_result(result)
                    
                    self.task_count += 1
                    
                    if self.task_count % MEMORY_CLEANUP_INTERVAL == 0:
                        logger.info(f"🧹 Memory cleanup after {self.task_count} tasks")
                        self._cleanup_memory()
                    
                else:
                    time.sleep(0.1)

            except KeyboardInterrupt:
                logger.info("Keyboard interrupt received")
                self.running = False
            except Exception as e:
                logger.error(f"Unexpected error in worker loop: {e}")
                logger.error(traceback.format_exc())
                time.sleep(5)

        logger.info(f"👋 Worker {self.worker_id} stopped. Processed {self.task_count} tasks.")
        self.redis_client.close()


def main():
    worker_id = sys.argv[1] if len(sys.argv) > 1 else f"worker-{os.getpid()}"
    worker = MidiWorker(worker_id)
    worker.run()


if __name__ == '__main__':
    main()
