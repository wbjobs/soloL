try:
    from .train import Trainer
    V1_TRAIN_AVAILABLE = True
except ImportError as e:
    print(f"⚠️  V1训练模块导入失败: {e}")
    V1_TRAIN_AVAILABLE = False

from .train_v2 import TrainerV2, TENSORBOARD_AVAILABLE
