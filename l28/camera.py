import cv2
import time
import numpy as np
from config import Config

class CameraCapture:
    def __init__(self, camera_id=Config.CAMERA_ID):
        self.camera_id = camera_id
        self.cap = None
        self.is_running = False
        
    def start(self):
        self.cap = cv2.VideoCapture(self.camera_id)
        if not self.cap.isOpened():
            raise RuntimeError(f"Failed to open camera {self.camera_id}")
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        self.is_running = True
        
    def stop(self):
        if self.cap:
            self.cap.release()
            self.cap = None
        self.is_running = False
        
    def get_frame(self):
        if not self.is_running or not self.cap:
            return None
        ret, frame = self.cap.read()
        if not ret:
            return None
        return frame
    
    def preprocess_frame(self, frame):
        if frame is None:
            return None
        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frame_resized = cv2.resize(frame_rgb, Config.IMAGE_SIZE)
        frame_normalized = frame_resized.astype(np.float32) / 255.0
        return frame_normalized
    
    def capture_and_preprocess(self):
        frame = self.get_frame()
        if frame is None:
            return None, None
        preprocessed = self.preprocess_frame(frame)
        return frame, preprocessed
    
    def __enter__(self):
        self.start()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stop()
