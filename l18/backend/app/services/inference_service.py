from typing import Optional, Dict, Any
import numpy as np
from app.ml.inference_engine_simple import SimpleInferenceEngine as InferenceEngine


class InferenceService:
    _engine: Optional[InferenceEngine] = None
    
    @classmethod
    def _get_engine(cls) -> InferenceEngine:
        if cls._engine is None:
            cls._engine = InferenceEngine.get_instance()
        return cls._engine
    
    @classmethod
    def predict(
        cls,
        points: np.ndarray,
        point_indices: Optional[np.ndarray] = None,
        features: Optional[np.ndarray] = None,
        batch_size: int = 1024,
    ) -> Dict[str, Any]:
        engine = cls._get_engine()
        result = engine.predict(
            points=points,
            features=features,
            point_indices=point_indices,
            batch_size=batch_size,
        )
        
        predictions = result['predictions']
        confidences = result['confidences']
        
        return {
            'predictions': predictions,
            'confidences': confidences,
            'processing_time': result['inference_time_ms'],
            'batch_count': result['batch_count'],
            'use_gpu': result['use_gpu'],
        }
    
    @classmethod
    def predict_rect(
        cls,
        points: np.ndarray,
        bounds: np.ndarray,
        features: Optional[np.ndarray] = None,
        batch_size: int = 1024,
    ) -> Dict[str, Any]:
        min_bounds = bounds[0]
        max_bounds = bounds[1]
        
        mask = np.all(points >= min_bounds, axis=1) & np.all(points <= max_bounds, axis=1)
        point_indices = np.where(mask)[0]
        
        if len(point_indices) == 0:
            return {
                'predictions': np.array([]),
                'confidences': np.array([]),
                'processing_time': 0,
                'batch_count': 0,
                'use_gpu': False,
            }
        
        return cls.predict(
            points=points,
            point_indices=point_indices,
            features=features,
            batch_size=batch_size,
        )
    
    @classmethod
    def auto_segment(
        cls,
        points: np.ndarray,
        seed_point_index: int,
        k: int = 100,
        features: Optional[np.ndarray] = None,
        batch_size: int = 1024,
    ) -> Dict[str, Any]:
        seed_point = points[seed_point_index]
        
        distances = np.sqrt(np.sum((points - seed_point) ** 2, axis=1))
        nearest_indices = np.argsort(distances)[:k]
        
        result = cls.predict(
            points=points,
            point_indices=nearest_indices,
            features=features,
            batch_size=batch_size,
        )
        
        if len(result['predictions']) > 0:
            predicted_label = np.bincount(result['predictions']).argmax()
            result['predicted_label'] = predicted_label
        
        return result
    
    @classmethod
    def get_model_info(cls) -> Dict[str, Any]:
        engine = cls._get_engine()
        return engine.get_model_info()
    
    @classmethod
    def warmup(cls) -> Dict[str, Any]:
        engine = cls._get_engine()
        return engine.warmup()
