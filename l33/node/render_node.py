import os
import sys
import uuid
import time
import threading
import socket
import traceback

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'proto'))

import grpc
import render_pb2
import render_pb2_grpc

from hardware_info import get_hardware_info, get_current_load
from render_worker import RenderWorker
from checkpoint_client import CheckpointClient
from asset_cache import AssetCacheManager


class RenderNode:
    def __init__(self, scheduler_address='localhost:50051', blender_path='blender', cache_dir=None, cache_size_mb=51200):
        self.node_id = str(uuid.uuid4())
        self.scheduler_address = scheduler_address
        self.blender_path = blender_path
        
        self.channel = None
        self.stub = None
        self.worker = RenderWorker(blender_path)
        self.checkpoint_client = None
        self.asset_cache = AssetCacheManager(cache_dir, cache_size_mb)
        self.hardware_info = get_hardware_info()
        
        self.running = False
        self.connected = False
        self.current_tasks = {}
        self.heartbeat_interval = 10000
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 10
        self.reconnect_delay = 5000
        
        print(f"Render Node ID: {self.node_id}")
        print(f"Node Name: {self.hardware_info['node_name']}")
        print(f"GPUs: {len(self.hardware_info['gpus'])}")
        
    def connect(self):
        try:
            if self.channel:
                self.channel.close()
            
            self.channel = grpc.insecure_channel(
                self.scheduler_address,
                options=[
                    ('grpc.keepalive_time_ms', 30000),
                    ('grpc.keepalive_timeout_ms', 10000),
                    ('grpc.max_receive_message_length', 1024 * 1024 * 100)
                ]
            )
            self.stub = render_pb2_grpc.RenderSchedulerStub(self.channel)
            self.checkpoint_client = CheckpointClient(self.stub, self.node_id)
            return True
        except Exception as e:
            print(f"Connection error: {e}")
            return False
            
    def register(self):
        try:
            request = render_pb2.RegisterNodeRequest(
                node_id=self.node_id,
                hardware=self._create_hardware_message(),
                address=self._get_local_address()
            )
            
            response = self.stub.RegisterNode(request)
            
            if response.success:
                self.heartbeat_interval = response.heartbeat_interval_ms
                self.connected = True
                self.reconnect_attempts = 0
                print(f"Registered with scheduler. Heartbeat: {self.heartbeat_interval}ms")
                return True
            else:
                print(f"Registration failed: {response.message}")
                return False
                
        except Exception as e:
            print(f"Registration error: {e}")
            return False

    def reconnect(self):
        print(f"Attempting to reconnect... (attempt {self.reconnect_attempts + 1}/{self.max_reconnect_attempts})")
        
        try:
            if not self.connect():
                return False
            
            incomplete_tasks = []
            for task_key, task_info in self.current_tasks.items():
                task = task_info['task']
                incomplete_tasks.append(render_pb2.TaskProgress(
                    job_id=task.job_id,
                    task_id=task.task_id,
                    frame_number=task.frame_number,
                    progress_percent=task_info.get('progress', 0),
                    elapsed_ms=int(task_info.get('elapsed', 0))
                ))
            
            request = render_pb2.ReconnectNodeRequest(
                node_id=self.node_id,
                hardware=self._create_hardware_message(),
                address=self._get_local_address(),
                incomplete_tasks=incomplete_tasks
            )
            
            response = self.stub.ReconnectNode(request)
            
            if response.success:
                self.heartbeat_interval = response.heartbeat_interval_ms
                self.connected = True
                print(f"Reconnected successfully!")
                
                if response.reassigned_tasks:
                    print(f"Received {len(response.reassigned_tasks)} reassigned tasks")
                    for task in response.reassigned_tasks:
                        threading.Thread(
                            target=self._execute_task,
                            args=(task,),
                            daemon=True
                        ).start()
                
                return True
            else:
                print(f"Reconnection failed: {response.message}")
                return False
                
        except Exception as e:
            print(f"Reconnection error: {e}")
            traceback.print_exc()
            return False
            
    def _create_hardware_message(self):
        gpus = []
        for gpu in self.hardware_info['gpus']:
            gpus.append(render_pb2.GPUInfo(
                name=gpu['name'],
                memory_total=gpu['memory_total'],
                memory_free=gpu['memory_free'],
                compute_capability_major=gpu['compute_capability_major'],
                compute_capability_minor=gpu['compute_capability_minor']
            ))
            
        return render_pb2.HardwareInfo(
            gpus=gpus,
            cpu_cores=self.hardware_info['cpu_cores'],
            ram_total=self.hardware_info['ram_total'],
            os=self.hardware_info['os'],
            node_name=self.hardware_info['node_name']
        )
        
    def _get_local_address(self):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except:
            return socket.gethostbyname(socket.gethostname())
            
    def heartbeat_loop(self):
        while self.running:
            try:
                if not self.connected:
                    time.sleep(self.reconnect_delay / 1000)
                    continue
                
                running_tasks = []
                for task_key, task_info in self.current_tasks.items():
                    task = task_info['task']
                    running_tasks.append(render_pb2.HeartbeatTask(
                        job_id=task.job_id,
                        task_id=task.task_id,
                        frame_number=task.frame_number,
                        progress_percent=task_info.get('progress', 0),
                        elapsed_ms=int(task_info.get('elapsed', 0)),
                        last_checkpoint_frame=task_info.get('last_checkpoint', 0)
                    ))
                
                request = render_pb2.HeartbeatRequest(
                    node_id=self.node_id,
                    current_load=get_current_load(),
                    running_tasks=running_tasks,
                    available_ram=0,
                    available_vram=0
                )
                
                response = self.stub.Heartbeat(request)
                
                if response.alive:
                    if response.should_get_task and len(self.current_tasks) == 0:
                        self.request_task()
                    
                    if response.next_heartbeat_ms:
                        self.heartbeat_interval = response.next_heartbeat_ms
                else:
                    self._handle_disconnect()
                    
            except grpc.RpcError as e:
                print(f"Heartbeat RPC error: {e}")
                self._handle_disconnect()
            except Exception as e:
                print(f"Heartbeat error: {e}")
                self._handle_disconnect()
                
            time.sleep(self.heartbeat_interval / 1000)

    def _handle_disconnect(self):
        if self.connected:
            print("Disconnected from scheduler!")
            self.connected = False
        
        if self.reconnect_attempts < self.max_reconnect_attempts:
            self.reconnect_attempts += 1
            if self.reconnect():
                self.reconnect_attempts = 0
            else:
                time.sleep(self.reconnect_delay / 1000)
        else:
            print(f"Max reconnection attempts ({self.max_reconnect_attempts}) reached")
            print("Will keep trying in background...")
            self.reconnect_attempts = 0
            
    def request_task(self):
        if not self.connected:
            return
            
        try:
            request = render_pb2.GetTaskRequest(
                node_id=self.node_id,
                hardware_capabilities=self._create_hardware_message()
            )
            
            response = self.stub.GetTask(request)
            
            if response.has_task:
                task = response.task
                print(f"Got task: frame {task.frame_number} (job {task.job_id})")
                
                if task.HasField('resume_from') and task.resume_from.job_id:
                    print(f"  Resuming from checkpoint: frame {task.resume_from.checkpoint_frame}")
                
                threading.Thread(
                    target=self._execute_task,
                    args=(task,),
                    daemon=True
                ).start()
            else:
                pass
                
        except grpc.RpcError as e:
            print(f"Get task RPC error: {e}")
            self._handle_disconnect()
        except Exception as e:
            print(f"Get task error: {e}")
            
    def _execute_task(self, task):
        task_key = f"{task.job_id}_{task.task_id}"
        self.current_tasks[task_key] = {
            'task': task,
            'progress': 0,
            'elapsed': 0,
            'last_checkpoint': 0
        }
        
        checkpoint_interval = task.checkpoint_interval or 5
        last_checkpoint_frame = 0
        
        if task.HasField('resume_from') and task.resume_from.job_id:
            last_checkpoint_frame = task.resume_from.checkpoint_frame
            self.current_tasks[task_key]['last_checkpoint'] = last_checkpoint_frame
        
        try:
            self._preload_assets(task)
            
            output_dir = os.path.dirname(task.output_path)
            os.makedirs(output_dir, exist_ok=True)
            
            checkpoint_counter = [0]
            
            def progress_callback(progress, elapsed, message):
                self.current_tasks[task_key]['progress'] = progress
                self.current_tasks[task_key]['elapsed'] = elapsed
                self._report_progress(task, progress, elapsed, message)
                
                if self.checkpoint_client and progress > 0:
                    checkpoint_frame = (progress // checkpoint_interval) * checkpoint_interval
                    if checkpoint_frame > last_checkpoint_frame and checkpoint_frame > checkpoint_counter[0]:
                        checkpoint_counter[0] = checkpoint_frame
                        print(f"  Saving checkpoint at {progress}%...")
                        storage_path = self.checkpoint_client.save_checkpoint(
                            job_id=task.job_id,
                            task_id=task.task_id,
                            frame_number=task.frame_number,
                            checkpoint_frame=progress,
                            samples_rendered=0,
                            local_path=''
                        )
                        if storage_path:
                            self.current_tasks[task_key]['last_checkpoint'] = progress
                            last_checkpoint_frame = progress
            
            result = self.worker.render_frame(
                task.scene_file,
                task.frame_number,
                task.output_path,
                {
                    'engine': task.settings.engine,
                    'resolution_x': task.settings.resolution_x,
                    'resolution_y': task.settings.resolution_y,
                    'samples': task.settings.samples
                },
                progress_callback
            )
            
            if result['success']:
                self._report_complete(task, result)
                if self.checkpoint_client:
                    self.checkpoint_client.cleanup_task_checkpoints(task.job_id, task.task_id)
            else:
                self._report_failed(task, result['error'])
                
        except Exception as e:
            print(f"Task execution error: {e}")
            traceback.print_exc()
            self._report_failed(task, str(e))
        finally:
            if task_key in self.current_tasks:
                del self.current_tasks[task_key]
    
    def _preload_assets(self, task):
        if not self.connected:
            return
            
        asset_ids = list(task.asset_ids) if task.asset_ids else []
        if not asset_ids:
            result = self.asset_cache.preload_blend_assets(task.scene_file)
            if result['loaded'] > 0:
                print(f"  Preloaded {result['loaded']} local assets ({result['skipped']} cached)")
            self._report_cache_status()
            return
            
        try:
            request = render_pb2.AssetRequest(
                node_id=self.node_id,
                job_id=task.job_id,
                requested_asset_ids=asset_ids
            )
            response = self.stub.RequestAssets(request)
            
            if response.success and response.available_assets:
                print(f"  Got {len(response.available_assets)} assets from scheduler")
                
                for asset_info in response.available_assets:
                    if not self.asset_cache.has_asset(asset_info.asset_id):
                        if os.path.exists(asset_info.file_path):
                            self.asset_cache.store_asset(
                                asset_info.file_path,
                                asset_info.asset_id,
                                asset_info.asset_type
                            )
                        elif asset_info.asset_id in response.download_urls:
                            self._download_asset(
                                asset_info.asset_id,
                                response.download_urls[asset_info.asset_id],
                                asset_info.asset_type
                            )
                
                print(f"  Asset cache: {self.asset_cache.get_cache_stats()}")
            else:
                result = self.asset_cache.preload_blend_assets(task.scene_file)
                print(f"  Preloaded {result['loaded']} local assets")
                
        except Exception as e:
            print(f"  Asset preload error: {e}")
            try:
                result = self.asset_cache.preload_blend_assets(task.scene_file)
                if result['loaded'] > 0:
                    print(f"  Fallback: preloaded {result['loaded']} local assets")
            except:
                pass
        
        self._report_cache_status()
    
    def _download_asset(self, asset_id, download_url, asset_type):
        try:
            import urllib.request
            full_url = f"http://{self.scheduler_address.split(':')[0]}:3000{download_url}"
            local_path, _ = urllib.request.urlretrieve(full_url)
            
            with open(local_path, 'rb') as f:
                data = f.read()
            
            self.asset_cache.store_asset_data(asset_id, data, download_url, asset_type)
            os.remove(local_path)
            
        except Exception as e:
            print(f"  Failed to download asset {asset_id}: {e}")
    
    def _report_cache_status(self):
        if not self.connected:
            return
            
        try:
            stats = self.asset_cache.get_cache_stats()
            request = render_pb2.CacheStatusRequest(
                node_id=self.node_id,
                used_bytes=int(stats['used_mb'] * 1024 * 1024),
                total_bytes=int(stats['max_size_mb'] * 1024 * 1024),
                item_count=stats['item_count'],
                texture_count=stats['textures'],
                mesh_count=stats['meshes']
            )
            self.stub.ReportCacheStatus(request)
        except:
            pass
            
    def _report_progress(self, task, progress, elapsed, message):
        if not self.connected:
            return
            
        try:
            request = render_pb2.TaskProgressRequest(
                node_id=self.node_id,
                job_id=task.job_id,
                task_id=task.task_id,
                progress_percent=progress,
                elapsed_ms=elapsed,
                status_message=message
            )
            self.stub.ReportTaskProgress(request)
        except grpc.RpcError:
            pass
        except Exception as e:
            pass
            
    def _report_complete(self, task, result):
        if not self.connected:
            print("Warning: Not connected, cannot report task completion")
            return
            
        try:
            request = render_pb2.TaskCompleteRequest(
                node_id=self.node_id,
                job_id=task.job_id,
                task_id=task.task_id,
                frame_number=task.frame_number,
                output_file=result['output_file'],
                render_time_ms=result['render_time_ms'],
                resolution_x=result['resolution_x'],
                resolution_y=result['resolution_y']
            )
            
            response = self.stub.ReportTaskComplete(request)
            print(f"Task {task.task_id} completed: {response.message}")
            
        except grpc.RpcError as e:
            print(f"Report complete RPC error: {e}")
            self._handle_disconnect()
        except Exception as e:
            print(f"Report complete error: {e}")
            
    def _report_failed(self, task, error_message):
        if not self.connected:
            print("Warning: Not connected, cannot report task failure")
            return
            
        try:
            request = render_pb2.TaskFailedRequest(
                node_id=self.node_id,
                job_id=task.job_id,
                task_id=task.task_id,
                error_message=error_message,
                retry_count=0
            )
            
            response = self.stub.ReportTaskFailed(request)
            print(f"Task {task.task_id} failed: {error_message}. Retry: {response.should_retry}")
            
            if response.HasField('last_checkpoint') and response.last_checkpoint.job_id:
                print(f"  Last checkpoint: frame {response.last_checkpoint.checkpoint_frame}")
            
        except grpc.RpcError as e:
            print(f"Report failed RPC error: {e}")
            self._handle_disconnect()
        except Exception as e:
            print(f"Report failed error: {e}")
            
    def start(self):
        self.connect()
        
        if not self.register():
            print("Failed to register with scheduler, will retry...")
        
        self.running = True
        
        heartbeat_thread = threading.Thread(target=self.heartbeat_loop, daemon=True)
        heartbeat_thread.start()
        
        print("Render node started. Waiting for tasks...")
        print(f"Checkpoint save: every {5} frames")
        print(f"Auto-reconnect: enabled ({self.max_reconnect_attempts} attempts)")
        
        try:
            while self.running:
                if self.connected and len(self.current_tasks) == 0:
                    self.request_task()
                time.sleep(5)
        except KeyboardInterrupt:
            print("Stopping...")
        finally:
            self.stop()
            
    def stop(self):
        self.running = False
        if self.worker:
            self.worker.stop()
        if self.channel:
            self.channel.close()
        print("Render node stopped")


def main():
    scheduler_addr = os.environ.get('SCHEDULER_ADDRESS', 'localhost:50051')
    blender_path = os.environ.get('BLENDER_PATH', 'blender')
    cache_dir = os.environ.get('ASSET_CACHE_DIR', None)
    cache_size = int(os.environ.get('ASSET_CACHE_SIZE_MB', '51200'))
    
    print("=" * 60)
    print("  Blender Distributed Render Node")
    print("  + Checkpoint & Auto-Reconnect & Asset Cache")
    print("=" * 60)
    
    node = RenderNode(scheduler_addr, blender_path, cache_dir, cache_size)
    node.start()


if __name__ == '__main__':
    main()
