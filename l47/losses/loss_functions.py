import torch
import torch.nn as nn
import torch.nn.functional as F
from configs import cfg


class LandmarkLoss(nn.Module):
    def __init__(self):
        super(LandmarkLoss, self).__init__()
    
    def forward(self, pred_landmarks, target_landmarks):
        return torch.mean(torch.abs(pred_landmarks - target_landmarks))


class PhotometricLoss(nn.Module):
    def __init__(self, loss_type='l1'):
        super(PhotometricLoss, self).__init__()
        self.loss_type = loss_type
    
    def forward(self, pred_images, target_images, mask=None):
        if mask is not None:
            pred_images = pred_images * mask
            target_images = target_images * mask
        
        if self.loss_type == 'l1':
            return torch.mean(torch.abs(pred_images - target_images))
        elif self.loss_type == 'l2':
            return torch.mean(torch.pow(pred_images - target_images, 2))
        elif self.loss_type == 'perceptual':
            return self._perceptual_loss(pred_images, target_images)
        else:
            raise ValueError(f"Unknown loss type: {self.loss_type}")
    
    def _perceptual_loss(self, pred_images, target_images):
        diff = torch.abs(pred_images - target_images)
        weights = torch.exp(-torch.abs(diff.mean(dim=1, keepdim=True)))
        return torch.mean(diff * weights)


class RegularizationLoss(nn.Module):
    def __init__(self, weight_shape=1e-3, weight_expr=1e-3, weight_tex=1e-3, weight_pose=1e-4):
        super(RegularizationLoss, self).__init__()
        self.weight_shape = weight_shape
        self.weight_expr = weight_expr
        self.weight_tex = weight_tex
        self.weight_pose = weight_pose
    
    def forward(self, shape_params, expr_params, tex_params=None, pose_params=None):
        loss = 0.0
        
        loss += self.weight_shape * torch.mean(shape_params ** 2)
        loss += self.weight_expr * torch.mean(expr_params ** 2)
        
        if tex_params is not None:
            loss += self.weight_tex * torch.mean(tex_params ** 2)
        
        if pose_params is not None:
            loss += self.weight_pose * torch.mean(pose_params ** 2)
        
        return loss


class LaplacianSmoothnessLoss(nn.Module):
    def __init__(self, weight=1e-4):
        super(LaplacianSmoothnessLoss, self).__init__()
        self.weight = weight
    
    def _compute_laplacian(self, vertices, faces):
        batch_size = vertices.shape[0]
        num_verts = vertices.shape[1]
        
        edge_count = torch.zeros((batch_size, num_verts), device=vertices.device)
        laplacian = torch.zeros_like(vertices)
        
        for face in faces:
            for i, j in [(0, 1), (1, 2), (2, 0)]:
                vi, vj = face[i], face[j]
                laplacian[:, vi] += vertices[:, vj]
                laplacian[:, vj] += vertices[:, vi]
                edge_count[:, vi] += 1
                edge_count[:, vj] += 1
        
        edge_count = edge_count.clamp(min=1).unsqueeze(-1)
        laplacian = laplacian / edge_count - vertices
        
        return laplacian
    
    def forward(self, vertices, faces):
        laplacian = self._compute_laplacian(vertices, faces)
        return self.weight * torch.mean(laplacian ** 2)


class TotalLoss(nn.Module):
    def __init__(self, config=None):
        super(TotalLoss, self).__init__()
        if config is None:
            config = cfg.LOSS
        
        self.landmark_weight = config.LANDMARK_WEIGHT
        self.photometric_weight = config.PHOTOMETRIC_WEIGHT
        self.reg_shape_weight = config.REG_SHAPE_WEIGHT
        self.reg_expr_weight = config.REG_EXPR_WEIGHT
        self.reg_tex_weight = config.REG_TEX_WEIGHT
        self.reg_pose_weight = config.REG_POSE_WEIGHT
        
        self.landmark_loss = LandmarkLoss()
        self.photometric_loss = PhotometricLoss()
        self.reg_loss = RegularizationLoss(
            weight_shape=self.reg_shape_weight,
            weight_expr=self.reg_expr_weight,
            weight_tex=self.reg_tex_weight,
            weight_pose=self.reg_pose_weight
        )
    
    def forward(self, pred_dict, target_dict, params_dict):
        losses = {}
        
        if 'landmarks' in pred_dict and 'landmarks' in target_dict:
            losses['landmark'] = self.landmark_weight * self.landmark_loss(
                pred_dict['landmarks'], target_dict['landmarks']
            )
        
        if 'rendered_image' in pred_dict and 'image' in target_dict:
            mask = target_dict.get('mask', None)
            losses['photometric'] = self.photometric_weight * self.photometric_loss(
                pred_dict['rendered_image'], target_dict['image'], mask
            )
        
        losses['regularization'] = self.reg_loss(
            params_dict['shape'],
            params_dict['expr'],
            params_dict.get('tex'),
            params_dict.get('pose')
        )
        
        total_loss = sum(losses.values())
        losses['total'] = total_loss
        
        return total_loss, losses
