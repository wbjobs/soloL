import os
from easydict import EasyDict as edict

__C = edict()
cfg = __C

__C.BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

__C.DATA = edict()
__C.DATA.DATASET_DIR = os.path.join(__C.BASE_DIR, 'datasets', '300W_LP')
__C.DATA.IMG_SIZE = 224
__C.DATA.BATCH_SIZE = 16
__C.DATA.NUM_WORKERS = 4

__C.FLAME = edict()
__C.FLAME.MODEL_PATH = os.path.join(__C.BASE_DIR, 'assets', 'flame2020.pkl')
__C.FLAME.SHAPE_DIM = 100
__C.FLAME.EXPR_DIM = 50
__C.FLAME.POSE_DIM = 6
__C.FLAME.TEX_DIM = 50
__C.FLAME.NUM_VERTICES = 5023
__C.FLAME.NUM_LANDMARKS = 68
__C.FLAME.LANDMARK_TYPE = '68'

__C.TRAIN = edict()
__C.TRAIN.EPOCHS = 50
__C.TRAIN.LR = 1e-4
__C.TRAIN.LR_DECAY_STEP = 10
__C.TRAIN.LR_DECAY_GAMMA = 0.5
__C.TRAIN.WEIGHT_DECAY = 1e-5
__C.TRAIN.CHECKPOINT_DIR = os.path.join(__C.BASE_DIR, 'checkpoints')
__C.TRAIN.LOG_DIR = os.path.join(__C.BASE_DIR, 'logs')
__C.TRAIN.SAVE_INTERVAL = 5
__C.TRAIN.VAL_INTERVAL = 1

__C.LOSS = edict()
__C.LOSS.LANDMARK_WEIGHT = 1.0
__C.LOSS.PHOTOMETRIC_WEIGHT = 1.0
__C.LOSS.REG_SHAPE_WEIGHT = 1e-3
__C.LOSS.REG_EXPR_WEIGHT = 1e-3
__C.LOSS.REG_TEX_WEIGHT = 1e-3
__C.LOSS.REG_POSE_WEIGHT = 1e-4

__C.RENDER = edict()
__C.RENDER.IMAGE_SIZE = 224
__C.RENDER.FOCAL_LENGTH = 5000.0
__C.RENDER.CAMERA_DISTANCE = 2.732
__C.RENDER.LIGHT_INTENSITY = 1.5
__C.RENDER.LIGHT_DIRECTION = [[0.0, 0.0, -1.0]]

__C.INFER = edict()
__C.INFER.CHECKPOINT_PATH = os.path.join(__C.TRAIN.CHECKPOINT_DIR, 'epoch_50.pth')
__C.INFER.RESULT_DIR = os.path.join(__C.BASE_DIR, 'results')
