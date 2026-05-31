import time
import json
import psutil
import threading
import requests
from collections import deque
from datetime import datetime
from config import Config

class PerformanceMonitor:
    def __init__(self, cloud_endpoint=Config.CLOUD_ENDPOINT):
        self.cloud_endpoint = cloud_endpoint
        self.fps_history = deque(maxlen=100)
        self.accuracy_history = deque(maxlen=1000)
        self.latency_history = deque(maxlen=100)
        
        self.total_predictions = 0
        self.correct_predictions = 0
        self.start_time = time.time()
        
        self.last_report_time = time.time()
        self.report_interval = Config.REPORT_INTERVAL
        
        self.reporting_thread = None
        self.is_reporting = False
    
    def start_background_reporting(self):
        if self.reporting_thread is not None and self.reporting_thread.is_alive():
            return
        
        self.is_reporting = True
        self.reporting_thread = threading.Thread(target=self._report_loop, daemon=True)
        self.reporting_thread.start()
    
    def stop_background_reporting(self):
        self.is_reporting = False
        if self.reporting_thread:
            self.reporting_thread.join(timeout=5)
    
    def _report_loop(self):
        while self.is_reporting:
            time.sleep(self.report_interval)
            try:
                metrics = self.get_metrics()
                self.report_to_cloud(metrics)
            except Exception as e:
                print(f"Report error: {e}")
    
    def record_inference(self, latency_ms, predicted_class=None, true_class=None):
        self.latency_history.append(latency_ms)
        self.fps_history.append(1000.0 / latency_ms)
        self.total_predictions += 1
        
        if true_class is not None and predicted_class is not None:
            correct = 1 if predicted_class == true_class else 0
            self.accuracy_history.append(correct)
            self.correct_predictions += correct
    
    def get_fps(self):
        if len(self.fps_history) == 0:
            return 0.0
        return sum(self.fps_history) / len(self.fps_history)
    
    def get_accuracy(self):
        if len(self.accuracy_history) == 0:
            return 0.0
        return sum(self.accuracy_history) / len(self.accuracy_history)
    
    def get_avg_latency(self):
        if len(self.latency_history) == 0:
            return 0.0
        return sum(self.latency_history) / len(self.latency_history)
    
    def get_memory_usage(self):
        process = psutil.Process()
        return process.memory_info().rss / (1024 * 1024)
    
    def get_cpu_usage(self):
        return psutil.cpu_percent(interval=0.1)
    
    def get_metrics(self):
        return {
            'timestamp': datetime.now().isoformat(),
            'device': 'raspberry_pi_4b',
            'fps': round(self.get_fps(), 2),
            'accuracy': round(self.get_accuracy(), 4),
            'avg_latency_ms': round(self.get_avg_latency(), 2),
            'memory_mb': round(self.get_memory_usage(), 2),
            'cpu_percent': round(self.get_cpu_usage(), 2),
            'total_predictions': self.total_predictions,
            'uptime_seconds': round(time.time() - self.start_time, 2)
        }
    
    def report_to_cloud(self, metrics):
        try:
            response = requests.post(
                self.cloud_endpoint,
                json=metrics,
                headers={'Content-Type': 'application/json'},
                timeout=10
            )
            return response.status_code == 200
        except requests.RequestException:
            return False
    
    def print_metrics(self):
        metrics = self.get_metrics()
        print("\n=== Performance Metrics ===")
        print(f"FPS: {metrics['fps']}")
        print(f"Accuracy: {metrics['accuracy'] * 100:.2f}%")
        print(f"Avg Latency: {metrics['avg_latency_ms']} ms")
        print(f"Memory: {metrics['memory_mb']} MB")
        print(f"CPU: {metrics['cpu_percent']}%")
        print(f"Total Predictions: {metrics['total_predictions']}")
        print(f"Uptime: {metrics['uptime_seconds']} s")
        print("==========================\n")
