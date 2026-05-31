try:
    from .reconstruct import FaceReconstructor
    from .expression_transfer import ExpressionTransfer
    V1_INFERENCE_AVAILABLE = True
except ImportError as e:
    print(f"⚠️  V1推理模块导入失败: {e}")
    V1_INFERENCE_AVAILABLE = False

from .face_tracker import MediaPipeFaceTracker
from .face_swap import FaceSwapper, create_face_swap_collage
