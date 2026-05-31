import os
import glob
import numpy as np
import cv2
import torch
from torch.utils.data import Dataset, DataLoader
from configs import cfg
from .preprocess import ImagePreprocessor, LandmarkProcessor


class Dataset300WLP(Dataset):
    def __init__(self, dataset_dir=None, img_size=None, mode='train', augment=False, synthetic=True):
        if dataset_dir is None:
            dataset_dir = cfg.DATA.DATASET_DIR
        if img_size is None:
            img_size = cfg.DATA.IMG_SIZE
        
        self.dataset_dir = dataset_dir
        self.img_size = img_size
        self.mode = mode
        self.augment = augment and mode == 'train'
        self.synthetic = synthetic
        
        self.image_preprocessor = ImagePreprocessor(img_size)
        self.landmark_processor = LandmarkProcessor()
        
        self.data_list = self._load_data_list()
    
    def _load_data_list(self):
        if self.synthetic or not os.path.exists(self.dataset_dir):
            return self._generate_synthetic_data()
        
        data_list = []
        
        subdirs = ['AFW', 'HELEN', 'IBUG', 'LFPW']
        if self.mode == 'train':
            subdirs = ['AFW', 'HELEN', 'LFPW']
        else:
            subdirs = ['IBUG']
        
        for subdir in subdirs:
            subdir_path = os.path.join(self.dataset_dir, subdir)
            if not os.path.exists(subdir_path):
                continue
            
            image_files = glob.glob(os.path.join(subdir_path, '*.jpg'))
            for img_path in image_files:
                base_name = os.path.splitext(os.path.basename(img_path))[0]
                mat_path = os.path.join(subdir_path, base_name + '.mat')
                if os.path.exists(mat_path):
                    data_list.append({
                        'image_path': img_path,
                        'landmark_path': mat_path,
                        'subdir': subdir
                    })
        
        if len(data_list) == 0:
            print(f"Warning: No real data found in {self.dataset_dir}, using synthetic data")
            return self._generate_synthetic_data()
        
        print(f"Loaded {len(data_list)} samples from {self.mode} set")
        return data_list
    
    def _generate_synthetic_data(self, num_samples=1000):
        print(f"Generating {num_samples} synthetic samples for {self.mode} set")
        data_list = []
        
        for i in range(num_samples):
            data_list.append({
                'synthetic': True,
                'index': i,
                'subdir': 'SYNTHETIC'
            })
        
        return data_list
    
    def _generate_synthetic_sample(self, index):
        np.random.seed(index)
        
        img = np.ones((self.img_size, self.img_size, 3), dtype=np.uint8) * 200
        
        center = (self.img_size // 2, self.img_size // 2)
        face_radius = int(self.img_size * 0.35)
        
        mask = np.zeros((self.img_size, self.img_size), dtype=np.uint8)
        cv2.ellipse(mask, center, (face_radius, int(face_radius * 1.2)), 0, 0, 360, 255, -1)
        
        skin_color = (220, 180, 160)
        img[mask > 0] = skin_color
        
        num_landmarks = 68
        landmarks = np.zeros((num_landmarks, 2), dtype=np.float32)
        
        landmarks[0:17, 0] = center[0] + face_radius * np.cos(np.linspace(np.pi, 0, 17))
        landmarks[0:17, 1] = center[1] + face_radius * 1.1 * np.sin(np.linspace(np.pi, 0, 17))
        
        landmarks[17:22, 0] = center[0] + face_radius * 0.6 * np.cos(np.linspace(np.pi * 0.75, np.pi * 0.25, 5))
        landmarks[17:22, 1] = center[1] - face_radius * 0.5 + np.random.randn(5) * 2
        
        landmarks[22:27, 0] = center[0] + face_radius * 0.6 * np.cos(np.linspace(np.pi * 1.75, np.pi * 1.25, 5))
        landmarks[22:27, 1] = center[1] - face_radius * 0.5 + np.random.randn(5) * 2
        
        landmarks[27:36, 0] = center[0] + np.random.randn(9) * 5
        landmarks[27:36, 1] = center[1] + face_radius * 0.3 * np.linspace(-0.5, 0.5, 9)
        
        landmarks[36:42, 0] = center[0] - face_radius * 0.3 + np.random.randn(6) * 3
        landmarks[36:42, 1] = center[1] - face_radius * 0.3 + np.random.randn(6) * 3
        
        landmarks[42:48, 0] = center[0] + face_radius * 0.3 + np.random.randn(6) * 3
        landmarks[42:48, 1] = center[1] - face_radius * 0.3 + np.random.randn(6) * 3
        
        landmarks[48:68, 0] = center[0] + face_radius * 0.4 * np.cos(np.linspace(0, 2 * np.pi, 20))
        landmarks[48:68, 1] = center[1] + face_radius * 0.2 + face_radius * 0.25 * np.sin(np.linspace(0, 2 * np.pi, 20))
        
        noise = np.random.randn(*landmarks.shape) * 3
        landmarks += noise
        
        for i, (x, y) in enumerate(landmarks):
            cv2.circle(img, (int(x), int(y)), 2, (0, 0, 255), -1)
        
        for idx in range(36, 48):
            cv2.circle(img, (int(landmarks[idx, 0]), int(landmarks[idx, 1])), 
                      int(face_radius * 0.08), (50, 50, 100), -1)
        
        mouth_center = (int(center[0]), int(center[1] + face_radius * 0.2))
        cv2.ellipse(img, mouth_center, (int(face_radius * 0.3), int(face_radius * 0.15)), 
                   0, 0, 360, (180, 80, 80), -1)
        
        nose_tip = (int(landmarks[30, 0]), int(landmarks[30, 1]))
        cv2.ellipse(img, nose_tip, (int(face_radius * 0.1), int(face_radius * 0.15)), 
                   0, 0, 360, (200, 150, 130), -1)
        
        if self.augment:
            if np.random.random() > 0.5:
                img = cv2.flip(img, 1)
                landmarks[:, 0] = self.img_size - landmarks[:, 0]
            
            angle = np.random.uniform(-15, 15)
            rotation_matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
            img = cv2.warpAffine(img, rotation_matrix, (self.img_size, self.img_size))
            ones = np.ones(shape=(len(landmarks), 1))
            points_ones = np.hstack([landmarks, ones])
            landmarks = rotation_matrix.dot(points_ones.T).T
        
        img_tensor = self.image_preprocessor.preprocess(img, augment=self.augment)
        
        landmarks_normalized = self.landmark_processor.normalize_landmarks(
            landmarks, self.img_size, self.img_size
        )
        landmarks_tensor = torch.tensor(landmarks_normalized, dtype=torch.float32)
        
        return {
            'image': img_tensor,
            'landmarks': landmarks_tensor,
            'original_image': img,
            'original_landmarks': landmarks
        }
    
    def __len__(self):
        return len(self.data_list)
    
    def __getitem__(self, idx):
        data_info = self.data_list[idx]
        
        if data_info.get('synthetic', False):
            return self._generate_synthetic_sample(data_info['index'])
        
        img_path = data_info['image_path']
        landmark_path = data_info['landmark_path']
        
        img = self.image_preprocessor.load_image(img_path)
        original_size = img.shape[:2]
        img = cv2.resize(img, (self.img_size, self.img_size))
        
        landmarks = self.landmark_processor.load_landmarks(landmark_path)
        
        scale_x = self.img_size / original_size[1]
        scale_y = self.img_size / original_size[0]
        landmarks[:, 0] *= scale_x
        landmarks[:, 1] *= scale_y
        
        if self.augment:
            if np.random.random() > 0.5:
                img = cv2.flip(img, 1)
                landmarks[:, 0] = self.img_size - landmarks[:, 0]
            
            alpha = np.random.uniform(0.8, 1.2)
            beta = np.random.randint(-20, 20)
            img = cv2.convertScaleAbs(img, alpha=alpha, beta=beta)
        
        img_tensor = self.image_preprocessor.preprocess(img, augment=self.augment)
        
        landmarks_normalized = self.landmark_processor.normalize_landmarks(
            landmarks, self.img_size, self.img_size
        )
        landmarks_tensor = torch.tensor(landmarks_normalized, dtype=torch.float32)
        
        return {
            'image': img_tensor,
            'landmarks': landmarks_tensor,
            'original_image': img,
            'original_landmarks': landmarks
        }


def get_dataloaders(dataset_dir=None, batch_size=None, num_workers=None):
    if batch_size is None:
        batch_size = cfg.DATA.BATCH_SIZE
    if num_workers is None:
        num_workers = cfg.DATA.NUM_WORKERS
    
    train_dataset = Dataset300WLP(dataset_dir=dataset_dir, mode='train', augment=True)
    val_dataset = Dataset300WLP(dataset_dir=dataset_dir, mode='val', augment=False)
    
    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=num_workers,
        drop_last=True
    )
    
    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        drop_last=False
    )
    
    return train_loader, val_loader


if __name__ == '__main__':
    dataset = Dataset300WLP(mode='train', synthetic=True)
    print(f"Dataset size: {len(dataset)}")
    
    sample = dataset[0]
    print(f"Image shape: {sample['image'].shape}")
    print(f"Landmarks shape: {sample['landmarks'].shape}")
    
    train_loader, val_loader = get_dataloaders(batch_size=4)
    print(f"Train batches: {len(train_loader)}")
    print(f"Val batches: {len(val_loader)}")
