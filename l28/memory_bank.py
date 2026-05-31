import os
import numpy as np
from collections import defaultdict
from config import Config
from utils import save_pickle, load_pickle

class MemoryBank:
    def __init__(self, memory_size=Config.MEMORY_SIZE):
        self.memory_size = memory_size
        self.images = []
        self.labels = []
        self.features = []
        self.class_counts = defaultdict(int)
        
    def add_samples(self, images, labels, features=None):
        n = len(images)
        available_space = self.memory_size - len(self.images)
        if available_space <= 0:
            return False
        
        n_to_add = min(n, available_space)
        self.images.extend(images[:n_to_add])
        self.labels.extend(labels[:n_to_add])
        if features is not None:
            self.features.extend(features[:n_to_add])
        
        for label in labels[:n_to_add]:
            self.class_counts[label] += 1
            
        return True
    
    def get_samples_by_class(self, class_label):
        indices = [i for i, l in enumerate(self.labels) if l == class_label]
        images = [self.images[i] for i in indices]
        features = [self.features[i] for i in indices] if self.features else None
        return images, features
    
    def get_all_samples(self):
        return np.array(self.images), np.array(self.labels)
    
    def remove_samples(self, indices):
        indices = sorted(indices, reverse=True)
        for idx in indices:
            label = self.labels[idx]
            self.class_counts[label] -= 1
            if self.class_counts[label] == 0:
                del self.class_counts[label]
            del self.images[idx]
            del self.labels[idx]
            if self.features:
                del self.features[idx]
    
    def get_size(self):
        return len(self.images)
    
    def get_num_classes(self):
        return len(self.class_counts)
    
    def save(self, path):
        data = {
            'images': self.images,
            'labels': self.labels,
            'features': self.features,
            'class_counts': dict(self.class_counts)
        }
        save_pickle(data, os.path.join(path, 'memory_bank.pkl'))
    
    def load(self, path):
        data = load_pickle(os.path.join(path, 'memory_bank.pkl'))
        if data:
            self.images = data['images']
            self.labels = data['labels']
            self.features = data.get('features', [])
            self.class_counts = defaultdict(int, data.get('class_counts', {}))
    
    def get_class_statistics(self):
        return dict(self.class_counts)
