
import sys
import os
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models
import numpy as np
from typing import Tuple, Optional, Dict, List

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from configs import cfg


class SphericalHarmonics:
    def __init__(self, order: int = 3, device: str = 'cuda' if torch.cuda.is_available() else 'cpu'):
        self.order = order
        self.device = device
        self.num_coeffs = (order + 1) ** 2
    
    def compute_sh_basis(self, directions: torch.Tensor) -> torch.Tensor:
        batch_size, num_dirs, _ = directions.shape
        
        x = directions[:, :, 0]
        y = directions[:, :, 1]
        z = directions[:, :, 2]
        
        basis = torch.zeros(batch_size, num_dirs, self.num_coeffs, device=self.device)
        
        if self.order >= 0:
            basis[:, :, 0] = 0.28209479177387814
        
        if self.order >= 1:
            basis[:, :, 1] = -0.4886025119029199 * y
            basis[:, :, 2] = 0.4886025119029199 * z
            basis[:, :, 3] = -0.4886025119029199 * x
        
        if self.order >= 2:
            basis[:, :, 4] = 1.0925484305920792 * x * y
            basis[:, :, 5] = -1.0925484305920792 * y * z
            basis[:, :, 6] = 0.9461746957575601 * (3 * z * z - 1)
            basis[:, :, 7] = -1.0925484305920792 * x * z
            basis[:, :, 8] = 0.5462742152960396 * (x * x - y * y)
        
        if self.order >= 3:
            basis[:, :, 9] = -0.5900435899266435 * y * (3 * x * x - y * y)
            basis[:, :, 10] = 2.890611442640554 * x * y * z
            basis[:, :, 11] = -0.4570457994644658 * y * (5 * z * z - 1)
            basis[:, :, 12] = 0.3731763325901154 * z * (5 * z * z - 3)
            basis[:, :, 13] = -0.4570457994644658 * x * (5 * z * z - 1)
            basis[:, :, 14] = 1.445305721320277 * z * (x * x - y * y)
            basis[:, :, 15] = -0.5900435899266435 * x * (x * x - 3 * y * y)
        
        return basis
    
    def sample_directions(self, num_samples: int = 1024) -> torch.Tensor:
        theta = torch.rand(num_samples, device=self.device) * 2 * np.pi
        phi = torch.acos(2 * torch.rand(num_samples, device=self.device) - 1)
        
        x = torch.sin(phi) * torch.cos(theta)
        y = torch.sin(phi) * torch.sin(theta)
        z = torch.cos(phi)
        
        directions = torch.stack([x, y, z], dim=-1).unsqueeze(0)
        return directions
    
    def render_with_sh(self, 
                       vertices: torch.Tensor, 
                       normals: torch.Tensor, 
                       sh_coeffs: torch.Tensor,
                       base_albedo: Optional[torch.Tensor] = None) -> torch.Tensor:
        
        batch_size, num_vertices, _ = vertices.shape
        
        if base_albedo is None:
            base_albedo = torch.ones_like(vertices) * 0.8
        
        normals_normalized = F.normalize(normals, dim=-1)
        
        sh_basis = self.compute_sh_basis(normals_normalized)
        
        if sh_coeffs.shape[0] == 1 and batch_size > 1:
            sh_coeffs = sh_coeffs.expand(batch_size, -1, -1)
        
        sh_coeffs_expanded = sh_coeffs.view(batch_size, 1, 3, self.num_coeffs)
        sh_basis_expanded = sh_basis.unsqueeze(-2)
        
        irradiance = torch.sum(sh_coeffs_expanded * sh_basis_expanded, dim=-1)
        irradiance = torch.clamp(irradiance, 0, None)
        
        colors = base_albedo * irradiance
        colors = torch.clamp(colors, 0, 1)
        
        return colors


class LightingEstimator(nn.Module):
    def __init__(self, 
                 sh_order: int = 3,
                 backbone: str = 'resnet50',
                 pretrained: bool = False,
                 device: str = 'cuda' if torch.cuda.is_available() else 'cpu'):
        super(LightingEstimator, self).__init__()
        
        self.sh_order = sh_order
        self.num_coeffs = (sh_order + 1) ** 2
        self.device = device
        
        self._init_backbone(backbone, pretrained)
        self._init_heads()
        
        self.sh = SphericalHarmonics(order=sh_order, device=device)
        self.to(device)
    
    def _init_backbone(self, backbone: str, pretrained: bool):
        if backbone == 'resnet50':
            resnet = models.resnet50(pretrained=pretrained)
            self.feature_extractor = nn.Sequential(*list(resnet.children())[:-1])
            feature_dim = 2048
        elif backbone == 'resnet18':
            resnet = models.resnet18(pretrained=pretrained)
            self.feature_extractor = nn.Sequential(*list(resnet.children())[:-1])
            feature_dim = 512
        elif backbone == 'efficientnet_b0':
            from torchvision.models import efficientnet_b0
            effnet = efficientnet_b0(pretrained=pretrained)
            self.feature_extractor = nn.Sequential(*list(effnet.children())[:-1])
            feature_dim = 1280
        else:
            raise ValueError(f"不支持的backbone: {backbone}")
        
        self.feature_dim = feature_dim
    
    def _init_heads(self):
        self.sh_head = nn.Sequential(
            nn.Linear(self.feature_dim, 1024),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(1024, 512),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(512, 3 * self.num_coeffs)
        )
        
        self.light_params_head = nn.Sequential(
            nn.Linear(self.feature_dim, 256),
            nn.ReLU(),
            nn.Linear(256, 6)
        )
        
        self._init_weights()
    
    def _init_weights(self):
        for m in self.sh_head.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                nn.init.constant_(m.bias, 0)
        
        for m in self.light_params_head.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                nn.init.constant_(m.bias, 0)
    
    def preprocess_image(self, image: torch.Tensor) -> torch.Tensor:
        if image.shape[1] != 3:
            if len(image.shape) == 4:
                image = image.permute(0, 3, 1, 2)
            else:
                image = image.permute(2, 0, 1).unsqueeze(0)
        
        if image.max() > 1.0:
            image = image / 255.0
        
        if image.shape[-2:] != (224, 224):
            image = F.interpolate(image, size=(224, 224), mode='bilinear', align_corners=False)
        
        return image
    
    def forward(self, images: torch.Tensor) -> Dict[str, torch.Tensor]:
        images = self.preprocess_image(images)
        images = images.to(self.device)
        
        features = self.feature_extractor(images)
        features = features.view(features.size(0), -1)
        
        sh_coeffs = self.sh_head(features)
        sh_coeffs = sh_coeffs.view(-1, 3, self.num_coeffs)
        
        light_params = self.light_params_head(features)
        
        ambient_intensity = torch.sigmoid(light_params[:, 0:1]) * 0.5 + 0.5
        directional_intensity = torch.sigmoid(light_params[:, 1:2]) * 0.5
        light_dir = F.normalize(light_params[:, 3:6], dim=1)
        
        result = {
            'sh_coeffs': sh_coeffs,
            'ambient_intensity': ambient_intensity,
            'directional_intensity': directional_intensity,
            'light_direction': light_dir,
            'features': features
        }
        
        return result
    
    def estimate_from_image(self, image: torch.Tensor) -> Dict[str, torch.Tensor]:
        self.eval()
        with torch.no_grad():
            return self.forward(image)
    
    def visualize_sh(self, sh_coeffs: torch.Tensor, resolution: int = 256) -> torch.Tensor:
        self.eval()
        with torch.no_grad():
            theta, phi = torch.meshgrid(
                torch.linspace(0, 2 * np.pi, resolution),
                torch.linspace(0, np.pi, resolution),
                indexing='ij'
            )
            
            x = torch.sin(phi) * torch.cos(theta)
            y = torch.sin(phi) * torch.sin(theta)
            z = torch.cos(phi)
            
            directions = torch.stack([x, y, z], dim=-1).view(-1, 3).to(self.device)
            directions = directions.unsqueeze(0)
            
            sh_basis = self.sh.compute_sh_basis(directions)
            
            sh_coeffs_expanded = sh_coeffs.view(1, 1, 3, self.num_coeffs)
            sh_basis_expanded = sh_basis.unsqueeze(-2)
            
            colors = torch.sum(sh_coeffs_expanded * sh_basis_expanded, dim=-1)
            colors = colors.view(resolution, resolution, 3)
            colors = torch.clamp(colors, 0, 1)
            
            return colors.permute(2, 0, 1)


class SHLightingRenderer(nn.Module):
    def __init__(self, 
                 sh_order: int = 3,
                 device: str = 'cuda' if torch.cuda.is_available() else 'cpu'):
        super(SHLightingRenderer, self).__init__()
        
        self.device = device
        self.sh = SphericalHarmonics(order=sh_order, device=device)
        self.to(device)
    
    def compute_vertex_normals(self, vertices: torch.Tensor, faces: torch.Tensor) -> torch.Tensor:
        batch_size, num_vertices, _ = vertices.shape
        
        v0 = vertices[:, faces[:, 0]]
        v1 = vertices[:, faces[:, 1]]
        v2 = vertices[:, faces[:, 2]]
        
        face_normals = torch.cross(v1 - v0, v2 - v0, dim=-1)
        face_normals = F.normalize(face_normals, dim=-1)
        
        vertex_normals = torch.zeros_like(vertices)
        
        faces_expanded = faces.unsqueeze(0).expand(batch_size, -1, -1)
        
        for i in range(faces.shape[0]):
            for j in range(3):
                vertex_normals[:, faces_expanded[:, i, j]] += face_normals[:, i:i+1]
        
        vertex_normals = F.normalize(vertex_normals, dim=-1)
        
        return vertex_normals
    
    def render(self, 
               vertices: torch.Tensor, 
               faces: torch.Tensor, 
               sh_coeffs: torch.Tensor,
               albedo: Optional[torch.Tensor] = None,
               normals: Optional[torch.Tensor] = None) -> Dict[str, torch.Tensor]:
        
        batch_size = vertices.shape[0]
        
        if normals is None:
            normals = self.compute_vertex_normals(vertices, faces)
        
        if albedo is None:
            albedo = torch.ones_like(vertices) * 0.8
        
        colors = self.sh.render_with_sh(vertices, normals, sh_coeffs, albedo)
        
        result = {
            'colors': colors,
            'normals': normals,
            'albedo': albedo
        }
        
        return result
    
    def relight(self, 
                vertices: torch.Tensor,
                faces: torch.Tensor,
                original_sh: torch.Tensor,
                target_sh: torch.Tensor,
                albedo: Optional[torch.Tensor] = None) -> Dict[str, torch.Tensor]:
        
        original_render = self.render(vertices, faces, original_sh, albedo)
        target_render = self.render(vertices, faces, target_sh, albedo)
        
        original_colors = original_render['colors']
        target_colors = target_render['colors']
        
        relighted_colors = torch.clamp(target_colors, 0, 1)
        
        result = {
            'original': original_colors,
            'relighted': relighted_colors,
            'target_sh': target_sh
        }
        
        return result


class LightingLoss(nn.Module):
    def __init__(self, device: str = 'cuda' if torch.cuda.is_available() else 'cpu'):
        super(LightingLoss, self).__init__()
        self.device = device
        
        self.sh_reg_weight = 1e-4
        self.consistency_weight = 0.1
        self.photometric_weight = 1.0
    
    def forward(self, 
                pred_sh: torch.Tensor, 
                rendered_images: torch.Tensor,
                target_images: torch.Tensor,
                mask: Optional[torch.Tensor] = None) -> Dict[str, torch.Tensor]:
        
        losses = {}
        
        if mask is not None:
            mask = F.interpolate(mask, size=rendered_images.shape[2:], mode='bilinear', align_corners=False)
            diff = torch.abs(rendered_images - target_images) * mask
            losses['photometric'] = self.photometric_weight * diff.sum() / (mask.sum() + 1e-6)
        else:
            losses['photometric'] = self.photometric_weight * F.l1_loss(rendered_images, target_images)
        
        losses['sh_regularization'] = self.sh_reg_weight * torch.norm(pred_sh, dim=(-2, -1)).mean()
        
        batch_size = pred_sh.shape[0]
        if batch_size > 1:
            sh_diff = torch.abs(pred_sh[:-1] - pred_sh[1:])
            losses['temporal_consistency'] = self.consistency_weight * sh_diff.mean()
        else:
            losses['temporal_consistency'] = torch.tensor(0.0, device=self.device)
        
        losses['total'] = sum(losses.values())
        
        return losses


def create_sample_sh_lighting(lighting_type: str = 'warm_sunset', 
                              device: str = 'cuda' if torch.cuda.is_available() else 'cpu') -> torch.Tensor:
    sh_coeffs = torch.zeros(1, 3, 16, device=device)
    
    lighting_presets = {
        'neutral': {
            'ambient': [0.3, 0.3, 0.3],
            'directional': [0.8, 0.7, 0.6],
            'direction': [0.0, 0.5, 0.866]
        },
        'warm_sunset': {
            'ambient': [0.2, 0.15, 0.1],
            'directional': [1.0, 0.6, 0.3],
            'direction': [0.5, 0.3, 0.81]
        },
        'cool_blue': {
            'ambient': [0.1, 0.15, 0.2],
            'directional': [0.4, 0.6, 0.9],
            'direction': [-0.3, 0.4, 0.866]
        },
        'dramatic': {
            'ambient': [0.05, 0.05, 0.05],
            'directional': [1.2, 1.0, 0.9],
            'direction': [0.7, 0.0, 0.71]
        },
        'studio': {
            'ambient': [0.4, 0.4, 0.4],
            'directional': [0.9, 0.9, 0.9],
            'direction': [0.0, 0.0, 1.0]
        }
    }
    
    preset = lighting_presets.get(lighting_type, lighting_presets['neutral'])
    
    ambient = torch.tensor(preset['ambient'], device=device)
    directional = torch.tensor(preset['directional'], device=device)
    direction = torch.tensor(preset['direction'], device=device)
    
    sh_coeffs[:, :, 0] = ambient * np.pi
    
    l1_coeff = 0.5 * np.sqrt(np.pi / 3.0)
    sh_coeffs[:, :, 1] = l1_coeff * directional * direction[1]
    sh_coeffs[:, :, 2] = l1_coeff * directional * direction[2]
    sh_coeffs[:, :, 3] = l1_coeff * directional * direction[0]
    
    l2_coeff = 0.25 * np.sqrt(np.pi / 5.0)
    sh_coeffs[:, :, 4] = l2_coeff * directional * 2 * direction[0] * direction[1]
    sh_coeffs[:, :, 5] = l2_coeff * directional * 2 * direction[1] * direction[2]
    sh_coeffs[:, :, 6] = l2_coeff * directional * (3 * direction[2]**2 - 1)
    sh_coeffs[:, :, 7] = l2_coeff * directional * 2 * direction[0] * direction[2]
    sh_coeffs[:, :, 8] = l2_coeff * directional * (direction[0]**2 - direction[1]**2)
    
    return sh_coeffs
