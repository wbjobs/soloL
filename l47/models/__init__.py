try:
    from .flame import FLAME, FLAMELandmarkLoss
    from .encoder import ResNetEncoder, SimpleEncoder
    from .renderer import DiffRenderer
    from .face_recon_model import FaceReconstructionModel
    V1_AVAILABLE = True
except ImportError as e:
    print(f"⚠️  V1模块导入失败(需要PyTorch3D): {e}")
    V1_AVAILABLE = False

from .flame_v2 import FLAMEV2
from .renderer_v2 import DiffRendererV2
from .face_recon_model_v2 import FaceReconstructionModelV2, ResNetEncoderV2, SimpleEncoderV2
from .antialiasing import (
    AnisotropicFilter,
    SuperSamplingAA,
    FXAA,
    TemporalAA,
    AntiAliasingPipeline
)
