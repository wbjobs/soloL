import os
import json
import time
import shutil
from pathlib import Path


class CheckpointClient:
    def __init__(self, stub, node_id, local_checkpoint_dir=None):
        self.stub = stub
        self.node_id = node_id
        self.local_checkpoint_dir = local_checkpoint_dir or './checkpoints'
        os.makedirs(self.local_checkpoint_dir, exist_ok=True)
        
    def save_checkpoint(self, job_id, task_id, frame_number, checkpoint_frame, 
                       samples_rendered=0, local_path=''):
        try:
            checkpoint = {
                'job_id': job_id,
                'task_id': task_id,
                'frame_number': frame_number,
                'checkpoint_frame': checkpoint_frame,
                'checkpoint_path': local_path,
                'timestamp': int(time.time() * 1000),
                'node_id': self.node_id,
                'samples_rendered': samples_rendered
            }
            
            self._save_local_checkpoint(checkpoint)
            
            try:
                import render_pb2
                request = render_pb2.CheckpointRequest(
                    node_id=self.node_id,
                    checkpoint=render_pb2.CheckpointInfo(**checkpoint)
                )
                response = self.stub.ReportCheckpoint(request)
                return response.storage_path
            except Exception as e:
                print(f"  Warning: Failed to report checkpoint to scheduler: {e}")
                return local_path
                
        except Exception as e:
            print(f"Checkpoint save error: {e}")
            return None
    
    def _save_local_checkpoint(self, checkpoint):
        job_dir = os.path.join(self.local_checkpoint_dir, checkpoint['job_id'])
        os.makedirs(job_dir, exist_ok=True)
        
        checkpoint_file = os.path.join(
            job_dir, 
            f"task_{checkpoint['task_id']}_ckpt_{checkpoint['checkpoint_frame']}.json"
        )
        
        with open(checkpoint_file, 'w') as f:
            json.dump(checkpoint, f, indent=2)
    
    def get_latest_checkpoint(self, job_id, task_id):
        job_dir = os.path.join(self.local_checkpoint_dir, job_id)
        if not os.path.exists(job_dir):
            return None
            
        checkpoints = []
        for f in os.listdir(job_dir):
            if f.startswith(f'task_{task_id}_ckpt_') and f.endswith('.json'):
                try:
                    with open(os.path.join(job_dir, f), 'r') as fp:
                        checkpoints.append(json.load(fp))
                except:
                    pass
        
        if not checkpoints:
            return None
            
        checkpoints.sort(key=lambda x: x['timestamp'], reverse=True)
        return checkpoints[0]
    
    def cleanup_task_checkpoints(self, job_id, task_id):
        job_dir = os.path.join(self.local_checkpoint_dir, job_id)
        if not os.path.exists(job_dir):
            return
            
        for f in os.listdir(job_dir):
            if f.startswith(f'task_{task_id}_'):
                try:
                    os.remove(os.path.join(job_dir, f))
                except:
                    pass
    
    def save_blender_checkpoint(self, job_id, task_id, frame_number, blend_file_path, samples_rendered=0):
        job_dir = os.path.join(self.local_checkpoint_dir, job_id)
        os.makedirs(job_dir, exist_ok=True)
        
        checkpoint_blend = os.path.join(
            job_dir,
            f"task_{task_id}_ckpt_{frame_number}.blend"
        )
        
        try:
            import bpy
            bpy.ops.wm.save_as_mainfile(filepath=checkpoint_blend, copy=True)
            
            return self.save_checkpoint(
                job_id=job_id,
                task_id=task_id,
                frame_number=frame_number,
                checkpoint_frame=frame_number,
                samples_rendered=samples_rendered,
                local_path=checkpoint_blend
            )
        except Exception as e:
            print(f"Failed to save Blender checkpoint: {e}")
            return None
