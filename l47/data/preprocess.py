import os
import numpy as np
import cv2
import torch
from torchvision import transforms
from configs import cfg


class ImagePreprocessor:
    def __init__(self, img_size=None):
        if img_size is None:
            img_size = cfg.DATA.IMG_SIZE
        self.img_size = img_size
        
        self.transform = transforms.Compose([
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])
        
        self.augment_transform = transforms.Compose([
            transforms.ToPILImage(),
            transforms.RandomHorizontalFlip(p=0.5),
            transforms.ColorJitter(brightness=0.2, contrast=0.2, saturation=0.2, hue=0.1),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
        ])
    
    def load_image(self, image_path):
        img = cv2.imread(image_path)
        if img is None:
            raise ValueError(f"Could not load image: {image_path}")
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        return img
    
    def resize_image(self, img):
        return cv2.resize(img, (self.img_size, self.img_size))
    
    def preprocess(self, img, augment=False):
        img = self.resize_image(img)
        
        if augment:
            img_tensor = self.augment_transform(img)
        else:
            img_tensor = self.transform(img)
        
        return img_tensor
    
    def preprocess_single_image(self, img):
        if isinstance(img, str):
            img = self.load_image(img)
        
        img = self.resize_image(img)
        img_tensor = self.transform(img)
        
        return img_tensor.unsqueeze(0)
    
    def tensor_to_image(self, tensor, denormalize=True):
        img = tensor.clone()
        if denormalize:
            mean = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
            std = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)
            img = img * std + mean
        
        img = torch.clamp(img, 0, 1)
        img = img.permute(1, 2, 0).cpu().numpy()
        img = (img * 255).astype(np.uint8)
        
        return img
    
    def draw_landmarks(self, img, landmarks, color=(0, 255, 0), radius=2):
        if isinstance(img, torch.Tensor):
            img = self.tensor_to_image(img)
        
        img = img.copy()
        for i, (x, y) in enumerate(landmarks):
            cv2.circle(img, (int(x), int(y)), radius, color, -1)
        
        return img


class LandmarkProcessor:
    def __init__(self, num_landmarks=68):
        self.num_landmarks = num_landmarks
    
    def load_landmarks(self, landmark_path):
        if landmark_path.endswith('.mat'):
            return self._load_mat_landmarks(landmark_path)
        elif landmark_path.endswith('.txt') or landmark_path.endswith('.pts'):
            return self._load_txt_landmarks(landmark_path)
        elif landmark_path.endswith('.npy'):
            return np.load(landmark_path)
        else:
            raise ValueError(f"Unsupported landmark file format: {landmark_path}")
    
    def _load_mat_landmarks(self, mat_path):
        try:
            from scipy.io import loadmat
            mat = loadmat(mat_path)
            if 'pt2d' in mat:
                landmarks = mat['pt2d'].T
            elif 'landmarks' in mat:
                landmarks = mat['landmarks']
            else:
                raise ValueError("No landmarks found in .mat file")
            return landmarks
        except ImportError:
            raise ImportError("scipy is required to load .mat files")
    
    def _load_txt_landmarks(self, txt_path):
        landmarks = []
        with open(txt_path, 'r') as f:
            lines = f.readlines()
            for line in lines:
                if line.strip() and not line.startswith('version') and not line.startswith('n_points') and not line.startswith('{') and not line.startswith('}'):
                    coords = line.strip().split()
                    if len(coords) >= 2:
                        landmarks.append([float(coords[0]), float(coords[1])])
        return np.array(landmarks)
    
    def normalize_landmarks(self, landmarks, img_width, img_height):
        landmarks = landmarks.copy()
        landmarks[:, 0] = (landmarks[:, 0] / img_width) * 2 - 1
        landmarks[:, 1] = (landmarks[:, 1] / img_height) * 2 - 1
        return landmarks
    
    def denormalize_landmarks(self, landmarks, img_width, img_height):
        landmarks = landmarks.copy()
        landmarks[:, 0] = (landmarks[:, 0] + 1) / 2 * img_width
        landmarks[:, 1] = (landmarks[:, 1] + 1) / 2 * img_height
        return landmarks
