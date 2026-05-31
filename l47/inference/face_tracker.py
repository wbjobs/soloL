
import sys
import os
import numpy as np
import cv2
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Tuple, List, Optional, Dict

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class MediaPipeFaceTracker:
    def __init__(self, 
                 static_image_mode: bool = False,
                 max_num_faces: int = 1,
                 refine_landmarks: bool = True,
                 min_detection_confidence: float = 0.5,
                 min_tracking_confidence: float = 0.5,
                 device: str = 'cuda' if torch.cuda.is_available() else 'cpu'):
        
        self.device = device
        self.static_image_mode = static_image_mode
        self.max_num_faces = max_num_faces
        self.refine_landmarks = refine_landmarks
        self.min_detection_confidence = min_detection_confidence
        self.min_tracking_confidence = min_tracking_confidence
        
        self.mp_face_mesh = None
        self.mp_drawing = None
        self.mp_drawing_styles = None
        self.face_mesh = None
        
        self._init_mediapipe()
        
        self.landmark_indices_68 = self._get_68_landmark_indices()
        self._init_keypoint_regressor()
        
        self.smoothing_window = 5
        self.expression_history = []
        
    def _init_mediapipe(self):
        try:
            import mediapipe as mp
            self.mp_face_mesh = mp.solutions.face_mesh
            self.mp_drawing = mp.solutions.drawing_utils
            self.mp_drawing_styles = mp.solutions.drawing_styles
            
            self.face_mesh = self.mp_face_mesh.FaceMesh(
                static_image_mode=self.static_image_mode,
                max_num_faces=self.max_num_faces,
                refine_landmarks=self.refine_landmarks,
                min_detection_confidence=self.min_detection_confidence,
                min_tracking_confidence=self.min_tracking_confidence
            )
            print("✅ MediaPipe FaceMesh 初始化成功")
        except ImportError:
            print("⚠️  MediaPipe 未安装，将使用合成关键点")
            print("   安装命令: pip install mediapipe")
            self.face_mesh = None
            
    def _get_68_landmark_indices(self) -> List[int]:
        return [
            127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379,
            365, 397, 288, 361, 323, 454, 356, 70, 63, 105, 66, 107, 336, 296, 334, 293,
            300, 168, 197, 5, 4, 75, 97, 2, 326, 305, 33, 160, 158, 133, 153, 144, 362,
            385, 387, 263, 373, 380, 61, 39, 0, 269, 291, 405, 314, 17, 84, 181, 409
        ]
    
    def _init_keypoint_regressor(self):
        self.kp_to_expr = nn.Sequential(
            nn.Linear(68 * 2, 256),
            nn.BatchNorm1d(256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(256, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(128, 50)
        ).to(self.device)
        self.kp_to_expr.eval()
    
    def _mediapipe_to_68_landmarks(self, face_landmarks, image_shape: Tuple[int, int]) -> np.ndarray:
        h, w = image_shape[:2]
        landmarks_68 = np.zeros((68, 2), dtype=np.float32)
        
        for i, idx in enumerate(self.landmark_indices_68):
            if idx < len(face_landmarks.landmark):
                lm = face_landmarks.landmark[idx]
                landmarks_68[i, 0] = lm.x * w
                landmarks_68[i, 1] = lm.y * h
        
        return landmarks_68
    
    def _normalize_landmarks(self, landmarks: np.ndarray) -> np.ndarray:
        center = np.mean(landmarks, axis=0)
        landmarks_centered = landmarks - center
        
        scale = np.max(np.abs(landmarks_centered))
        if scale > 0:
            landmarks_normalized = landmarks_centered / scale
        else:
            landmarks_normalized = landmarks_centered
        
        return landmarks_normalized.flatten()
    
    def _smooth_expression(self, expr_params: np.ndarray) -> np.ndarray:
        self.expression_history.append(expr_params)
        
        if len(self.expression_history) > self.smoothing_window:
            self.expression_history.pop(0)
        
        if len(self.expression_history) > 0:
            smoothed = np.mean(self.expression_history, axis=0)
        else:
            smoothed = expr_params
        
        return smoothed
    
    def detect_landmarks(self, image: np.ndarray) -> Optional[np.ndarray]:
        if image is None:
            return None
        
        h, w = image.shape[:2]
        
        if self.face_mesh is not None:
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            image_rgb.flags.writeable = False
            results = self.face_mesh.process(image_rgb)
            
            if results.multi_face_landmarks:
                face_landmarks = results.multi_face_landmarks[0]
                landmarks_68 = self._mediapipe_to_68_landmarks(face_landmarks, (h, w))
                return landmarks_68
            else:
                return self._generate_synthetic_landmarks((h, w))
        else:
            return self._generate_synthetic_landmarks((h, w))
    
    def _generate_synthetic_landmarks(self, image_shape: Tuple[int, int]) -> np.ndarray:
        h, w = image_shape[:2]
        landmarks_68 = np.zeros((68, 2), dtype=np.float32)
        
        center_x, center_y = w // 2, h // 2
        face_radius = min(w, h) * 0.35
        
        for i in range(17):
            angle = np.pi * (i / 16 + 0.5)
            landmarks_68[i, 0] = center_x - face_radius * np.cos(angle)
            landmarks_68[i, 1] = center_y - face_radius * np.sin(angle) * 0.8
        
        for i in range(17, 27):
            t = (i - 17) / 10
            landmarks_68[i, 0] = center_x + (t - 0.5) * face_radius * 0.4
            landmarks_68[i, 1] = center_y - face_radius * 0.5 + t * face_radius * 0.3
        
        for i in range(27, 36):
            t = (i - 27) / 9
            landmarks_68[i, 0] = center_x
            landmarks_68[i, 1] = center_y - face_radius * 0.3 + t * face_radius * 0.4
        
        for i in range(36, 42):
            angle = np.pi * (i - 36) / 6
            landmarks_68[i, 0] = center_x - face_radius * 0.25 + face_radius * 0.12 * np.cos(angle)
            landmarks_68[i, 1] = center_y - face_radius * 0.2 + face_radius * 0.08 * np.sin(angle)
        
        for i in range(42, 48):
            angle = np.pi * (i - 42) / 6
            landmarks_68[i, 0] = center_x + face_radius * 0.25 + face_radius * 0.12 * np.cos(angle)
            landmarks_68[i, 1] = center_y - face_radius * 0.2 + face_radius * 0.08 * np.sin(angle)
        
        for i in range(48, 60):
            t = (i - 48) / 12
            angle = 2 * np.pi * t
            landmarks_68[i, 0] = center_x + face_radius * 0.2 * np.cos(angle)
            landmarks_68[i, 1] = center_y + face_radius * 0.1 * np.sin(angle)
        
        for i in range(60, 68):
            t = (i - 60) / 8
            angle = 2 * np.pi * t
            landmarks_68[i, 0] = center_x + face_radius * 0.1 * np.cos(angle)
            landmarks_68[i, 1] = center_y + face_radius * 0.05 * np.sin(angle)
        
        return landmarks_68
    
    def landmarks_to_expression(self, landmarks: np.ndarray) -> np.ndarray:
        if landmarks is None:
            return np.zeros(50, dtype=np.float32)
        
        normalized = self._normalize_landmarks(landmarks)
        
        with torch.no_grad():
            kp_tensor = torch.tensor(normalized, dtype=torch.float32, device=self.device).unsqueeze(0)
            expr_tensor = self.kp_to_expr(kp_tensor)
            expr_params = expr_tensor.cpu().numpy()[0]
        
        expr_params = self._smooth_expression(expr_params)
        
        return expr_params
    
    def draw_landmarks(self, image: np.ndarray, landmarks: np.ndarray, color: Tuple[int, int, int] = (0, 255, 0)) -> np.ndarray:
        if landmarks is None:
            return image
        
        try:
            import cv2
        except ImportError:
            return image
        
        img_copy = np.ascontiguousarray(image.copy(), dtype=np.uint8)
        
        for i, (x, y) in enumerate(landmarks):
            x_int, y_int = int(x), int(y)
            if 0 <= x_int < img_copy.shape[1] and 0 <= y_int < img_copy.shape[0]:
                cv2.circle(img_copy, (x_int, y_int), 2, color, -1)
                if i % 10 == 0:
                    cv2.putText(img_copy, str(i), (x_int + 5, y_int), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.3, (255, 255, 255), 1)
        
        connections = [
            (0, 16), (16, 26), (26, 17), (17, 0),
            (36, 37), (37, 38), (38, 39), (39, 40), (40, 41), (41, 36),
            (42, 43), (43, 44), (44, 45), (45, 46), (46, 47), (47, 42),
            (48, 49), (49, 50), (50, 51), (51, 52), (52, 53), (53, 54),
            (54, 55), (55, 56), (56, 57), (57, 58), (58, 59), (59, 48),
            (60, 61), (61, 62), (62, 63), (63, 64), (64, 65), (65, 66),
            (66, 67), (67, 60),
            (27, 28), (28, 29), (29, 30), (30, 31), (31, 32), (32, 33),
            (33, 34), (34, 35),
        ]
        
        for start, end in connections:
            if start < len(landmarks) and end < len(landmarks):
                pt1 = (int(landmarks[start, 0]), int(landmarks[start, 1]))
                pt2 = (int(landmarks[end, 0]), int(landmarks[end, 1]))
                if (0 <= pt1[0] < img_copy.shape[1] and 0 <= pt1[1] < img_copy.shape[0] and
                    0 <= pt2[0] < img_copy.shape[1] and 0 <= pt2[1] < img_copy.shape[0]):
                    cv2.line(img_copy, pt1, pt2, (0, 200, 0), 1)
        
        return img_copy
    
    def capture_realtime(self, 
                        camera_index: int = 0,
                        show_preview: bool = True,
                        target_fps: int = 30,
                        callback=None) -> None:
        
        cap = cv2.VideoCapture(camera_index)
        if not cap.isOpened():
            print(f"❌ 无法打开摄像头 {camera_index}")
            return
        
        print(f"✅ 摄像头 {camera_index} 已打开")
        print("   按 'q' 退出, 按 's' 保存当前帧")
        
        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    print("❌ 无法读取帧")
                    break
                
                landmarks = self.detect_landmarks(frame)
                expr_params = self.landmarks_to_expression(landmarks)
                
                if show_preview:
                    display_frame = self.draw_landmarks(frame, landmarks)
                    
                    expr_text = f"Expr norms: {np.linalg.norm(expr_params):.3f}"
                    cv2.putText(display_frame, expr_text, (10, 30),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                    
                    fps_text = f"Press 'q' to quit"
                    cv2.putText(display_frame, fps_text, (10, 60),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
                    
                    cv2.imshow('Face Tracking - Press q to quit', display_frame)
                
                if callback is not None:
                    callback(frame, landmarks, expr_params)
                
                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    break
                elif key == ord('s'):
                    self._save_current_frame(frame, landmarks, expr_params)
                    
        finally:
            cap.release()
            cv2.destroyAllWindows()
            print("✅ 摄像头已释放")
    
    def _save_current_frame(self, frame, landmarks, expr_params):
        import time
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        filename = f"capture_{timestamp}.jpg"
        
        if landmarks is not None:
            frame = self.draw_landmarks(frame, landmarks)
        
        cv2.imwrite(filename, frame)
        
        np.savez(f"expr_{timestamp}.npz", landmarks=landmarks, expression=expr_params)
        
        print(f"✅ 已保存: {filename}, expr_{timestamp}.npz")
    
    def get_expression_presets(self) -> Dict[str, np.ndarray]:
        presets = {
            'neutral': np.zeros(50, dtype=np.float32),
            'smile': np.array([2.0, 1.5, 0.0, 0.0, -1.0] + [0.0] * 45, dtype=np.float32),
            'sad': np.array([-1.0, -0.5, 0.0, 0.0, 2.0] + [0.0] * 45, dtype=np.float32),
            'surprise': np.array([0.0, 0.0, 3.0, 1.0, 0.0] + [0.0] * 45, dtype=np.float32),
            'angry': np.array([0.0, 0.0, 0.0, -2.0, 2.0] + [0.0] * 45, dtype=np.float32),
            'kiss': np.array([0.0, 2.0, 0.0, 0.0, 0.0] + [0.0] * 45, dtype=np.float32),
        }
        return presets
    
    def close(self):
        if self.face_mesh is not None:
            self.face_mesh.close()
        try:
            import cv2
            cv2.destroyAllWindows()
        except Exception:
            pass
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
