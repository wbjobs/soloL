import numpy as np
import torch
import torch.nn as nn
import time
from typing import Optional, Any, Dict, List, Tuple


class SimplePointNet(nn.Module):
    def __init__(self, num_classes: int = 10, in_channels: int = 3):
        super().__init__()
        self.num_classes = num_classes
        
        self.conv1 = nn.Conv1d(in_channels, 64, 1)
        self.conv2 = nn.Conv1d(64, 128, 1)
        self.conv3 = nn.Conv1d(128, 256, 1)
        self.conv4 = nn.Conv1d(256, 128, 1)
        self.conv5 = nn.Conv1d(128, 64, 1)
        self.conv6 = nn.Conv1d(64, num_classes, 1)
        
        self.bn1 = nn.BatchNorm1d(64)
        self.bn2 = nn.BatchNorm1d(128)
        self.bn3 = nn.BatchNorm1d(256)
        self.bn4 = nn.BatchNorm1d(128)
        self.bn5 = nn.BatchNorm1d(64)
        
        self.relu = nn.ReLU()
        self.dropout = nn.Dropout(0.3)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x.transpose(1, 2)
        
        x = self.relu(self.bn1(self.conv1(x)))
        x = self.relu(self.bn2(self.conv2(x)))
        x = self.relu(self.bn3(self.conv3(x)))
        x = self.dropout(x)
        x = self.relu(self.bn4(self.conv4(x)))
        x = self.relu(self.bn5(self.conv5(x)))
        x = self.conv6(x)
        
        x = x.transpose(1, 2)
        return x


class SimpleInferenceEngine:
    _instance: Optional['SimpleInferenceEngine'] = None
    _model: Optional[nn.Module] = None
    _device: torch.device = torch.device('cpu')
    _is_initialized: bool = False
    
    def __new__(cls) -> 'SimpleInferenceEngine':
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self) -> None:
        if not self._is_initialized:
            self._initialize()
            self._is_initialized = True
    
    def _initialize(self) -> None:
        try:
            if torch.cuda.is_available():
                self._device = torch.device('cuda')
                print(f"Using GPU: {torch.cuda.get_device_name(0)}")
            else:
                self._device = torch.device('cpu')
                print("Using CPU for inference")
        except Exception as e:
            print(f"GPU detection failed, using CPU: {e}")
            self._device = torch.device('cpu')
        
        self._model = SimplePointNet(num_classes=10, in_channels=6)
        self._model = self._model.to(self._device)
        self._model.eval()
        
        print(f"Simple inference engine initialized on {self._device}")
    
    def predict(
        self,
        points: np.ndarray,
        features: Optional[np.ndarray] = None,
        point_indices: Optional[np.ndarray] = None,
        batch_size: int = 1024,
    ) -> Dict[str, Any]:
        if self._model is None:
            raise RuntimeError("Model not initialized")
        
        start_time = time.time()
        
        if point_indices is not None and len(point_indices) > 0:
            points_subset = points[point_indices]
        else:
            points_subset = points
            point_indices = np.arange(len(points))
        
        num_points = len(points_subset)
        
        if features is not None and len(features) == len(points):
            if point_indices is not None and len(point_indices) > 0:
                features_subset = features[point_indices]
            else:
                features_subset = features
        else:
            features_subset = None
        
        all_predictions: List[int] = []
        all_confidences: List[float] = []
        batch_count = 0
        
        with torch.no_grad():
            for i in range(0, num_points, batch_size):
                batch_count += 1
                batch_end = min(i + batch_size, num_points)
                batch_points = points_subset[i:batch_end]
                batch_size_actual = batch_end - i
                
                if features_subset is not None:
                    batch_features = features_subset[i:batch_end]
                    batch_input = np.concatenate([batch_points, batch_features], axis=1)
                    in_channels = 6
                else:
                    batch_input = batch_points
                    in_channels = 3
                
                batch_tensor = torch.FloatTensor(batch_input).unsqueeze(0).to(self._device)
                
                if batch_tensor.shape[2] != in_channels:
                    batch_tensor = batch_tensor[:, :, :in_channels]
                
                outputs = self._model(batch_tensor)
                
                batch_probs = torch.softmax(outputs[0], dim=-1)
                batch_preds = torch.argmax(batch_probs, dim=-1)
                batch_confs = torch.max(batch_probs, dim=-1)[0]
                
                all_predictions.extend(batch_preds.cpu().numpy().tolist())
                all_confidences.extend(batch_confs.cpu().numpy().tolist())
                
                del batch_tensor, outputs, batch_probs, batch_preds, batch_confs
        
        if self._device.type == 'cuda':
            torch.cuda.empty_cache()
        
        inference_time = (time.time() - start_time) * 1000
        
        return {
            'predictions': np.array(all_predictions, dtype=np.int64),
            'confidences': np.array(all_confidences, dtype=np.float32),
            'point_indices': point_indices,
            'inference_time_ms': inference_time,
            'batch_count': batch_count,
            'batch_size': batch_size,
            'use_gpu': self._device.type == 'cuda',
            'device': str(self._device),
            'num_points': num_points,
        }
    
    def get_model_info(self) -> Dict[str, Any]:
        return {
            'name': 'SimplePointNet',
            'version': '1.0.0',
            'description': 'Simplified PointNet for semantic segmentation',
            'num_classes': 10,
            'batch_size': 1024,
            'use_gpu': self._device.type == 'cuda',
            'gpu_device': torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            'inference_time_ms': 0.0,
        }
    
    def warmup(self, num_points: int = 10000) -> Dict[str, Any]:
        warmup_points = np.random.randn(num_points, 3).astype(np.float32)
        
        start_time = time.time()
        result = self.predict(warmup_points, batch_size=1024)
        warmup_time = (time.time() - start_time) * 1000
        
        return {
            'success': True,
            'warmup_time_ms': warmup_time,
            'num_points': num_points,
            'device': str(self._device),
        }
    
    @classmethod
    def get_instance(cls) -> 'SimpleInferenceEngine':
        if cls._instance is None:
            cls._instance = SimpleInferenceEngine()
        return cls._instance


try:
    from app.ml.inference_engine import InferenceEngine as FullInferenceEngine
    InferenceEngine = FullInferenceEngine
except Exception as e:
    print(f"Full PointNet++ not available, using simplified version: {e}")
    InferenceEngine = SimpleInferenceEngine
