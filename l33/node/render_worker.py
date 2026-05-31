import os
import subprocess
import threading
import time
import re


class RenderWorker:
    def __init__(self, blender_path='blender'):
        self.blender_path = blender_path
        self.current_process = None
        self.is_rendering = False
        
    def render_frame(self, scene_file, frame_number, output_path, settings, progress_callback=None):
        self.is_rendering = True
        start_time = time.time()
        
        try:
            cmd = [
                self.blender_path,
                '-b', scene_file,
                '-o', output_path.replace('.png', ''),
                '-f', str(frame_number),
                '-F', 'PNG',
                '-E', settings.get('engine', 'CYCLES'),
                '-x', '1',
                '--',
                '--cycles-device', 'CUDA'
            ]
            
            res_x = settings.get('resolution_x', 1920)
            res_y = settings.get('resolution_y', 1080)
            samples = settings.get('samples', 128)
            
            self.current_process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
            
            for line in self.current_process.stdout:
                if progress_callback:
                    progress = self._parse_progress(line)
                    if progress is not None:
                        elapsed = int((time.time() - start_time) * 1000)
                        progress_callback(progress, elapsed, line.strip())
            
            self.current_process.wait()
            render_time = int((time.time() - start_time) * 1000)
            
            actual_output = self._find_output_file(output_path)
            
            self.is_rendering = False
            
            if self.current_process.returncode == 0:
                return {
                    'success': True,
                    'output_file': actual_output or output_path,
                    'render_time_ms': render_time,
                    'resolution_x': res_x,
                    'resolution_y': res_y
                }
            else:
                return {
                    'success': False,
                    'error': f'Blender exited with code {self.current_process.returncode}',
                    'render_time_ms': render_time
                }
                
        except Exception as e:
            self.is_rendering = False
            return {
                'success': False,
                'error': str(e),
                'render_time_ms': int((time.time() - start_time) * 1000)
            }
    
    def _parse_progress(self, line):
        match = re.search(r'Fra:\s*\d+\s*\|\s*Mem:.*?\|\s*(\d+)%', line)
        if match:
            return int(match.group(1))
        
        match = re.search(r'Rendering tile \d+/(\d+)', line)
        if match:
            pass
        
        match = re.search(r'(\d+)%', line)
        if match and 'Saved' not in line:
            return int(match.group(1))
            
        return None
    
    def _find_output_file(self, expected_path):
        expected_dir = os.path.dirname(expected_path)
        expected_name = os.path.basename(expected_path)
        
        if os.path.exists(expected_path):
            return expected_path
        
        if os.path.exists(expected_dir):
            for f in os.listdir(expected_dir):
                if f.endswith('.png'):
                    return os.path.join(expected_dir, f)
        
        return None
    
    def stop(self):
        if self.current_process:
            self.current_process.terminate()
            try:
                self.current_process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.current_process.kill()
        self.is_rendering = False
