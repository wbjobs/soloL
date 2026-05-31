
import sys
import os
import numpy as np
import cv2
import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Tuple, Optional, Dict, List

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.face_recon_model_v2 import FaceReconstructionModelV2


class FaceSwapper:
    def __init__(self, 
                 model: Optional[FaceReconstructionModelV2] = None,
                 device: str = 'cuda' if torch.cuda.is_available() else 'cpu',
                 use_simple_encoder: bool = False):
        
        self.device = device
        
        if model is None:
            self.model = FaceReconstructionModelV2(
                use_simple_encoder=use_simple_encoder,
                device=device,
                use_antialiasing=True
            )
        else:
            self.model = model
        
        self.model.eval()
        self._init_alignment_module()
        self._init_texture_fusion()
        
        self.identity_bank: Dict[str, Dict[str, torch.Tensor]] = {}
        
    def _init_alignment_module(self):
        self.similarity_transform = nn.Sequential(
            nn.Linear(68 * 2, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, 6)
        ).to(self.device)
        self.similarity_transform.eval()
    
    def _init_texture_fusion(self):
        self.fusion_network = nn.Sequential(
            nn.Conv2d(6, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            nn.Conv2d(64, 32, kernel_size=3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.Conv2d(32, 3, kernel_size=3, padding=1),
            nn.Sigmoid()
        ).to(self.device)
        self.fusion_network.eval()
    
    def _safe_cvtColor(self, image, code):
        try:
            return cv2.cvtColor(image, code)
        except Exception:
            if code == cv2.COLOR_BGR2RGB or code == cv2.COLOR_RGB2BGR:
                return image[..., ::-1].copy()
            elif code == cv2.COLOR_GRAY2BGR:
                return np.stack([image, image, image], axis=-1)
            return image
    
    def _safe_resize(self, image, size):
        try:
            return cv2.resize(image, size)
        except Exception:
            if len(image.shape) == 3:
                tensor = torch.from_numpy(image).float().permute(2, 0, 1).unsqueeze(0)
                resized = F.interpolate(tensor, size=size, mode='bilinear', align_corners=False)
                return resized.squeeze(0).permute(1, 2, 0).numpy().astype(np.uint8)
            else:
                tensor = torch.from_numpy(image).float().unsqueeze(0).unsqueeze(0)
                resized = F.interpolate(tensor, size=size, mode='bilinear', align_corners=False)
                return resized.squeeze().numpy().astype(np.uint8)
    
    def preprocess_image(self, image: np.ndarray) -> torch.Tensor:
        if image is None:
            raise ValueError("输入图像为空")
        
        image = np.ascontiguousarray(image, dtype=np.uint8)
        
        if len(image.shape) == 2:
            image = self._safe_cvtColor(image, cv2.COLOR_GRAY2BGR)
        
        image_rgb = self._safe_cvtColor(image, cv2.COLOR_BGR2RGB)
        image_resized = self._safe_resize(image_rgb, (224, 224))
        
        image_tensor = torch.from_numpy(image_resized).float().permute(2, 0, 1) / 255.0
        image_tensor = image_tensor.unsqueeze(0).to(self.device)
        
        return image_tensor
    
    def extract_identity(self, image: np.ndarray, name: Optional[str] = None) -> Dict[str, torch.Tensor]:
        image_tensor = self.preprocess_image(image)
        
        with torch.no_grad():
            output = self.model(image_tensor, return_all=True)
            params = output['params']
        
        identity_params = {
            'shape': params['shape'].clone(),
            'tex': params['tex'].clone() if params.get('tex') is not None else None,
            'pose': params['pose'].clone(),
            'cam': params['cam'].clone(),
            'vertices': output['vertices'].clone()
        }
        
        if name is not None:
            self.identity_bank[name] = identity_params
            print(f"✅ 身份 '{name}' 已保存到身份库")
        
        return identity_params
    
    def extract_expression(self, image: np.ndarray) -> Dict[str, torch.Tensor]:
        image_tensor = self.preprocess_image(image)
        
        with torch.no_grad():
            output = self.model(image_tensor, return_all=True)
            params = output['params']
        
        expression_params = {
            'expr': params['expr'].clone(),
            'pose': params['pose'].clone()
        }
        
        return expression_params
    
    def align_faces(self, 
                    source_landmarks: np.ndarray, 
                    target_landmarks: np.ndarray) -> np.ndarray:
        src_mean = np.mean(source_landmarks, axis=0)
        tgt_mean = np.mean(target_landmarks, axis=0)
        
        src_centered = source_landmarks - src_mean
        tgt_centered = target_landmarks - tgt_mean
        
        src_std = np.std(src_centered)
        tgt_std = np.std(tgt_centered)
        scale = tgt_std / src_std if src_std > 0 else 1.0
        
        H = src_centered.T @ tgt_centered
        U, S, Vt = np.linalg.svd(H)
        R = Vt.T @ U.T
        
        if np.linalg.det(R) < 0:
            Vt[-1, :] *= -1
            R = Vt.T @ U.T
        
        t = tgt_mean - scale * R @ src_mean
        
        M = np.eye(3)
        M[:2, :2] = scale * R
        M[:2, 2] = t
        
        return M
    
    def swap_faces(self, 
                   target_image: np.ndarray,
                   source_image: Optional[np.ndarray] = None,
                   target_identity: Optional[str] = None,
                   source_expression: Optional[Dict[str, torch.Tensor]] = None,
                   blend_weights: Optional[Dict[str, float]] = None) -> Dict[str, np.ndarray]:
        
        if blend_weights is None:
            blend_weights = {
                'shape': 1.0,
                'expr': 1.0,
                'tex': 0.8,
                'pose': 0.3
            }
        
        if target_identity is not None and target_identity in self.identity_bank:
            target_params = self.identity_bank[target_identity]
            print(f"✅ 使用身份库中的 '{target_identity}'")
        else:
            target_params = self.extract_identity(target_image)
        
        if source_expression is not None:
            expr_params = source_expression
            print("✅ 使用提供的表情参数")
        elif source_image is not None:
            expr_params = self.extract_expression(source_image)
            print("✅ 从源图像提取表情")
        else:
            raise ValueError("必须提供源图像或表情参数")
        
        with torch.no_grad():
            target_shape = target_params['shape'] * blend_weights['shape']
            source_expr = expr_params['expr'] * blend_weights['expr']
            
            target_pose = target_params['pose']
            source_pose = expr_params['pose']
            blended_pose = target_pose * (1 - blend_weights['pose']) + source_pose * blend_weights['pose']
            
            if target_params.get('tex') is not None:
                tex_params = target_params['tex']
            else:
                tex_params = None
            
            cam_params = target_params['cam']
            
            swap_output = self.model.transfer_expression(
                base_params={
                    'shape': target_shape,
                    'expr': source_expr,
                    'pose': blended_pose,
                    'tex': tex_params,
                    'cam': cam_params
                },
                new_expr_params=source_expr
            )
            
            rendered_image = swap_output['image']
            vertices = swap_output['vertices']
            
            rendered_np = rendered_image.squeeze(0).permute(1, 2, 0).cpu().numpy()
            rendered_np = (rendered_np * 255).astype(np.uint8)
            rendered_bgr = self._safe_cvtColor(rendered_np, cv2.COLOR_RGB2BGR)
            
            target_resized = self._safe_resize(target_image, (224, 224))
            fused_image = self._fuse_textures(target_resized, rendered_bgr)
            
            vertices_np = vertices.squeeze(0).cpu().numpy()
            
            result = {
                'target_image': target_resized,
                'source_image': self._safe_resize(source_image, (224, 224)) if source_image is not None else None,
                'rendered_image': rendered_bgr,
                'fused_image': fused_image,
                'vertices': vertices_np,
                'params': {
                    'shape': target_shape.cpu().numpy(),
                    'expr': source_expr.cpu().numpy(),
                    'pose': blended_pose.cpu().numpy(),
                    'tex': tex_params.cpu().numpy() if tex_params is not None else None
                }
            }
            
            return result
    
    def _fuse_textures(self, target_image: np.ndarray, rendered_image: np.ndarray) -> np.ndarray:
        target_tensor = torch.from_numpy(target_image).float().permute(2, 0, 1) / 255.0
        rendered_tensor = torch.from_numpy(rendered_image).float().permute(2, 0, 1) / 255.0
        
        fused_tensor = 0.7 * rendered_tensor + 0.3 * target_tensor
        
        fused_np = fused_tensor.permute(1, 2, 0).cpu().numpy()
        fused_np = (fused_np * 255).astype(np.uint8)
        
        return fused_np
    
    def _create_face_mask(self, image_shape: Tuple[int, int], landmarks: np.ndarray) -> np.ndarray:
        mask = np.zeros(image_shape[:2], dtype=np.float32)
        
        try:
            hull = cv2.convexHull(landmarks.astype(np.int32))
            cv2.fillConvexPoly(mask, hull, 1.0)
            
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
            mask = cv2.dilate(mask, kernel)
            
            mask = cv2.GaussianBlur(mask, (31, 31), 0)
        except Exception:
            center = np.mean(landmarks, axis=0)
            y, x = np.ogrid[:image_shape[0], :image_shape[1]]
            dist = np.sqrt((x - center[0])**2 + (y - center[1])**2)
            face_radius = np.max(np.std(landmarks, axis=0)) * 2.5
            mask = np.exp(-dist**2 / (2 * face_radius**2))
            mask = (mask > 0.1).astype(np.float32)
        
        return mask
    
    def seamless_clone(self, 
                      source: np.ndarray, 
                      target: np.ndarray, 
                      landmarks: np.ndarray) -> np.ndarray:
        if source.shape[:2] != target.shape[:2]:
            source = self._safe_resize(source, (target.shape[1], target.shape[0]))
        
        mask = self._create_face_mask(target.shape[:2], landmarks)
        mask_3c = np.stack([mask, mask, mask], axis=2)
        
        center = np.mean(landmarks, axis=0).astype(np.int32)
        
        source_8u = (source * 255).astype(np.uint8) if source.max() <= 1.0 else source.astype(np.uint8)
        target_8u = (target * 255).astype(np.uint8) if target.max() <= 1.0 else target.astype(np.uint8)
        mask_8u = (mask * 255).astype(np.uint8)
        
        try:
            result = cv2.seamlessClone(source_8u, target_8u, mask_8u, tuple(center), cv2.NORMAL_CLONE)
            return result
        except:
            blended = (mask_3c * source_8u + (1 - mask_3c) * target_8u).astype(np.uint8)
            return blended
    
    def multi_identity_swap(self, 
                           target_image: np.ndarray,
                           identity_mix: Dict[str, float],
                           source_expression: Optional[Dict[str, torch.Tensor]] = None,
                           source_image: Optional[np.ndarray] = None) -> Dict[str, np.ndarray]:
        
        total_weight = sum(identity_mix.values())
        if total_weight <= 0:
            raise ValueError("身份权重之和必须大于0")
        
        mixed_shape = None
        mixed_tex = None
        
        for identity_name, weight in identity_mix.items():
            if identity_name not in self.identity_bank:
                print(f"⚠️  身份 '{identity_name}' 不在身份库中，跳过")
                continue
            
            norm_weight = weight / total_weight
            params = self.identity_bank[identity_name]
            
            if mixed_shape is None:
                mixed_shape = params['shape'] * norm_weight
                if params.get('tex') is not None:
                    mixed_tex = params['tex'] * norm_weight
            else:
                mixed_shape += params['shape'] * norm_weight
                if params.get('tex') is not None and mixed_tex is not None:
                    mixed_tex += params['tex'] * norm_weight
        
        if mixed_shape is None:
            raise ValueError("没有有效的身份可以混合")
        
        if source_expression is None and source_image is None:
            source_expression = self.extract_expression(target_image)
        elif source_image is not None:
            source_expression = self.extract_expression(source_image)
        
        with torch.no_grad():
            base_params = {
                'shape': mixed_shape,
                'expr': source_expression['expr'],
                'pose': source_expression['pose'],
                'tex': mixed_tex,
                'cam': torch.zeros(1, 3, device=self.device)
            }
            
            swap_output = self.model.transfer_expression(
                base_params=base_params,
                new_expr_params=source_expression['expr']
            )
            
            rendered_image = swap_output['image']
            rendered_np = rendered_image.squeeze(0).permute(1, 2, 0).cpu().numpy()
            rendered_np = (rendered_np * 255).astype(np.uint8)
            rendered_bgr = self._safe_cvtColor(rendered_np, cv2.COLOR_RGB2BGR)
            
            result = {
                'rendered_image': rendered_bgr,
                'vertices': swap_output['vertices'].squeeze(0).cpu().numpy(),
                'mixed_params': {
                    'shape': mixed_shape.cpu().numpy(),
                    'expr': source_expression['expr'].cpu().numpy(),
                    'tex': mixed_tex.cpu().numpy() if mixed_tex is not None else None
                },
                'identity_weights': identity_mix
            }
            
            return result
    
    def save_identity_bank(self, filepath: str):
        cpu_bank = {}
        for name, params in self.identity_bank.items():
            cpu_bank[name] = {
                'shape': params['shape'].cpu().numpy(),
                'tex': params['tex'].cpu().numpy() if params.get('tex') is not None else None,
                'pose': params['pose'].cpu().numpy(),
                'cam': params['cam'].cpu().numpy()
            }
        
        np.savez(filepath, **cpu_bank)
        print(f"✅ 身份库已保存到 {filepath}")
    
    def load_identity_bank(self, filepath: str):
        if not os.path.exists(filepath):
            print(f"❌ 身份库文件不存在: {filepath}")
            return
        
        data = np.load(filepath, allow_pickle=True)
        
        for name in data.files:
            params = data[name].item()
            self.identity_bank[name] = {
                'shape': torch.tensor(params['shape'], device=self.device),
                'tex': torch.tensor(params['tex'], device=self.device) if params.get('tex') is not None else None,
                'pose': torch.tensor(params['pose'], device=self.device),
                'cam': torch.tensor(params['cam'], device=self.device)
            }
        
        print(f"✅ 已加载 {len(data.files)} 个身份: {list(data.files)}")
    
    def list_identities(self) -> List[str]:
        return list(self.identity_bank.keys())
    
    def clear_identity_bank(self):
        self.identity_bank.clear()
        print("✅ 身份库已清空")


def _safe_resize_collage(image, size):
    try:
        return cv2.resize(image, size)
    except Exception:
        tensor = torch.from_numpy(image).float().permute(2, 0, 1).unsqueeze(0)
        resized = F.interpolate(tensor, size=size, mode='bilinear', align_corners=False)
        return resized.squeeze(0).permute(1, 2, 0).numpy().astype(np.uint8)


def _safe_putText(img, text, org, fontFace, fontScale, color, thickness=1):
    try:
        return cv2.putText(img, text, org, fontFace, fontScale, color, thickness)
    except Exception:
        x, y = org
        img[y-2:y+2, x:x+len(text)*10] = color[0]
        return img


def create_face_swap_collage(results: Dict[str, np.ndarray], 
                           source_image: Optional[np.ndarray] = None,
                           target_image: Optional[np.ndarray] = None) -> np.ndarray:
    
    h, w = 224, 224
    
    images = []
    titles = []
    
    if target_image is not None:
        target_resized = _safe_resize_collage(target_image, (w, h))
        images.append(target_resized)
        titles.append('Target')
    
    if source_image is not None:
        source_resized = _safe_resize_collage(source_image, (w, h))
        images.append(source_resized)
        titles.append('Source')
    
    if 'rendered_image' in results:
        images.append(results['rendered_image'])
        titles.append('Rendered')
    
    if 'fused_image' in results:
        images.append(results['fused_image'])
        titles.append('Fused')
    
    n_cols = min(len(images), 4)
    n_rows = (len(images) + n_cols - 1) // n_cols
    
    collage = np.zeros((n_rows * h, n_cols * w, 3), dtype=np.uint8)
    
    for i, img in enumerate(images):
        r, c = i // n_cols, i % n_cols
        collage[r*h:(r+1)*h, c*w:(c+1)*w] = img
        
        if i < len(titles):
            collage = _safe_putText(
                collage, titles[i], (c*w + 10, r*h + 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2
            )
    
    return collage
