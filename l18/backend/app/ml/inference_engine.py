from pathlib import Path
from typing import Any
import time

import numpy as np
import torch

from app.ml.pointnet2.model import PointNet2
from app.config import Config


class InferenceEngine:
    _instance: "InferenceEngine | None" = None

    def __new__(cls, *args: Any, **kwargs: Any) -> "InferenceEngine":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(
        self,
        model_name: str = "pointnet2",
        num_classes: int = 10,
        model_path: str | None = None,
        use_gpu: bool = True,
        batch_size: int = 1024,
    ) -> None:
        if self._initialized:
            return

        config = Config()
        self.model_name = model_name
        self.num_classes = num_classes
        self.batch_size = batch_size
        self.use_gpu = use_gpu and config.USE_GPU and torch.cuda.is_available()
        self.device = torch.device("cuda" if self.use_gpu else "cpu")
        self.model = self._load_model(model_name, model_path)
        self._initialized = True

    def _load_model(self, model_name: str, model_path: str | None) -> torch.nn.Module:
        if model_name == "pointnet2":
            model = PointNet2(num_classes=self.num_classes, in_channels=3)
        elif model_name == "pointnet":
            model = PointNet2(num_classes=self.num_classes, in_channels=3, use_pointnet=True)
        else:
            raise ValueError(f"Unsupported model: {model_name}")

        if model_path and Path(model_path).exists():
            checkpoint = torch.load(model_path, map_location=self.device)
            if "model_state_dict" in checkpoint:
                model.load_state_dict(checkpoint["model_state_dict"])
            else:
                model.load_state_dict(checkpoint)

        model.to(self.device)
        model.eval()

        if self.use_gpu and torch.cuda.device_count() > 1:
            model = torch.nn.DataParallel(model)

        return model

    def _preprocess_batch(
        self, points: np.ndarray, features: np.ndarray | None = None
    ) -> tuple[torch.Tensor, torch.Tensor | None]:
        points_tensor = torch.from_numpy(points).float().to(self.device)
        points_tensor = points_tensor.transpose(1, 2).contiguous()

        if features is not None:
            features_tensor = torch.from_numpy(features).float().to(self.device)
            features_tensor = features_tensor.transpose(1, 2).contiguous()
        else:
            features_tensor = None

        return points_tensor, features_tensor

    def predict(
        self,
        points: np.ndarray,
        features: np.ndarray | None = None,
    ) -> dict[str, Any]:
        start_time = time.time()

        if points.ndim == 2:
            points = points[np.newaxis, ...]
        if features is not None and features.ndim == 2:
            features = features[np.newaxis, ...]

        batch_size = self.batch_size
        total_points = points.shape[1]
        all_predictions = np.zeros(total_points, dtype=np.int32)
        all_confidences = np.zeros(total_points, dtype=np.float32)

        for start_idx in range(0, total_points, batch_size):
            end_idx = min(start_idx + batch_size, total_points)
            batch_points = points[:, start_idx:end_idx, :]
            batch_features = features[:, start_idx:end_idx, :] if features is not None else None

            points_tensor, features_tensor = self._preprocess_batch(batch_points, batch_features)

            with torch.no_grad():
                if hasattr(self.model, "module"):
                    outputs = self.model.module(points_tensor, features_tensor)
                else:
                    outputs = self.model(points_tensor, features_tensor)

                probabilities = torch.softmax(outputs, dim=1)
                predictions = torch.argmax(probabilities, dim=1)
                confidences = torch.max(probabilities, dim=1)[0]

            all_predictions[start_idx:end_idx] = predictions.squeeze(0).cpu().numpy()
            all_confidences[start_idx:end_idx] = confidences.squeeze(0).cpu().numpy()
            
            del points_tensor, features_tensor, outputs, probabilities, predictions, confidences

        if self.use_gpu:
            torch.cuda.empty_cache()

        processing_time = time.time() - start_time

        return {
            "predictions": all_predictions,
            "confidences": all_confidences,
            "processing_time": processing_time,
        }

    def predict_with_indices(
        self,
        all_points: np.ndarray,
        point_indices: np.ndarray,
        features: np.ndarray | None = None,
    ) -> dict[str, Any]:
        selected_points = all_points[point_indices]
        selected_features = features[point_indices] if features is not None else None

        result = self.predict(selected_points, selected_features)

        return {
            "predictions": result["predictions"],
            "confidences": result["confidences"],
            "point_indices": point_indices,
            "processing_time": result["processing_time"],
        }

    def get_model_info(self) -> dict[str, Any]:
        return {
            "model_name": self.model_name,
            "num_classes": self.num_classes,
            "device": str(self.device),
            "use_gpu": self.use_gpu,
            "batch_size": self.batch_size,
            "model_type": type(self.model).__name__,
            "cuda_available": torch.cuda.is_available(),
            "cuda_device_count": torch.cuda.device_count() if torch.cuda.is_available() else 0,
        }
