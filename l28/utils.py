import os
import numpy as np
import pickle
import logging
from datetime import datetime
from config import Config

def setup_logging():
    Config.ensure_dirs()
    log_file = os.path.join(Config.LOG_PATH, f"incremental_learning_{datetime.now().strftime('%Y%m%d')}.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler()
        ]
    )
    return logging.getLogger(__name__)

def save_pickle(data, filepath):
    with open(filepath, 'wb') as f:
        pickle.dump(data, f)

def load_pickle(filepath):
    if not os.path.exists(filepath):
        return None
    with open(filepath, 'rb') as f:
        return pickle.load(f)

def softmax(x, temperature=1.0):
    x = x / temperature
    exp_x = np.exp(x - np.max(x, axis=-1, keepdims=True))
    return exp_x / np.sum(exp_x, axis=-1, keepdims=True)

def compute_features(model, images, layer_name=None):
    if hasattr(model, 'feature_extractor'):
        return model.feature_extractor.predict(images, verbose=0)
    return model.predict(images, verbose=0)

def create_one_hot(labels, num_classes):
    one_hot = np.zeros((len(labels), num_classes), dtype=np.float32)
    for i, label in enumerate(labels):
        one_hot[i, label] = 1.0
    return one_hot

def augment_image(image):
    if np.random.random() > 0.5:
        image = np.fliplr(image)
    angle = np.random.uniform(-10, 10)
    from scipy.ndimage import rotate
    image = rotate(image, angle, reshape=False)
    return np.clip(image, 0, 1)
