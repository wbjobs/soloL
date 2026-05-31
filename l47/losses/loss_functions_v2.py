import torch
import torch.nn as nn
import torch.nn.functional as F


class LandmarkLoss(nn.Module):
    def __init__(self, weight=1.0):
        super(LandmarkLoss, self).__init__()
        self.weight = weight
    
    def forward(self, pred, target):
        if pred is None or target is None:
            return torch.tensor(0.0, device=pred.device if pred is not None else 'cpu')
        
        loss = F.l1_loss(pred, target)
        return self.weight * loss


class PhotometricLoss(nn.Module):
    def __init__(self, weight=1.0, use_perceptual=False):
        super(PhotometricLoss, self).__init__()
        self.weight = weight
        self.use_perceptual = use_perceptual
    
    def forward(self, pred, target, mask=None):
        if pred is None or target is None:
            return torch.tensor(0.0, device=pred.device if pred is not None else 'cpu')
        
        if mask is not None:
            mask = F.interpolate(mask, size=pred.shape[2:], mode='bilinear', align_corners=False)
            diff = torch.abs(pred - target) * mask
            loss = diff.sum() / (mask.sum() + 1e-6)
        else:
            loss = F.l1_loss(pred, target)
        
        return self.weight * loss


class PerceptualLoss(nn.Module):
    def __init__(self, weight=0.1):
        super(PerceptualLoss, self).__init__()
        self.weight = weight
    
    def _build_gaussian_kernel(self, kernel_size=5, sigma=1.0, channels=3):
        x = torch.arange(kernel_size) - kernel_size // 2
        g = torch.exp(-x**2 / (2 * sigma**2))
        g = g / g.sum()
        kernel_2d = g[:, None] * g[None, :]
        kernel = kernel_2d[None, None, :, :].repeat(channels, 1, 1, 1)
        return kernel
    
    def forward(self, pred, target):
        if pred is None or target is None:
            return torch.tensor(0.0, device=pred.device if pred is not None else 'cpu')
        
        if not hasattr(self, 'gaussian_kernel'):
            self.gaussian_kernel = self._build_gaussian_kernel().to(pred.device)
        
        pred_pyr = pred
        target_pyr = target
        loss = 0.0
        
        for i in range(3):
            loss = loss + F.l1_loss(pred_pyr, target_pyr)
            if i < 2:
                pred_pyr = F.conv2d(pred_pyr, self.gaussian_kernel, padding=2, groups=3)[:, :, ::2, ::2]
                target_pyr = F.conv2d(target_pyr, self.gaussian_kernel, padding=2, groups=3)[:, :, ::2, ::2]
        
        return self.weight * loss / 3.0


class RegularizationLoss(nn.Module):
    def __init__(self, shape_weight=1e-3, expr_weight=1e-3, tex_weight=1e-3, pose_weight=1e-4):
        super(RegularizationLoss, self).__init__()
        self.shape_weight = shape_weight
        self.expr_weight = expr_weight
        self.tex_weight = tex_weight
        self.pose_weight = pose_weight
    
    def forward(self, shape, expr, tex=None, pose=None):
        loss = 0.0
        
        if shape is not None:
            loss = loss + self.shape_weight * torch.norm(shape, p=2, dim=1).mean()
        
        if expr is not None:
            loss = loss + self.expr_weight * torch.norm(expr, p=2, dim=1).mean()
        
        if tex is not None:
            loss = loss + self.tex_weight * torch.norm(tex, p=2, dim=1).mean()
        
        if pose is not None:
            loss = loss + self.pose_weight * torch.norm(pose, p=2, dim=1).mean()
        
        return loss


class IdentityPreservationLoss(nn.Module):
    def __init__(self, weight=1.0):
        super(IdentityPreservationLoss, self).__init__()
        self.weight = weight
    
    def forward(self, shape_params_original, shape_params_modified):
        if shape_params_original is None or shape_params_modified is None:
            return torch.tensor(0.0, device=shape_params_original.device if shape_params_original is not None else 'cpu')
        
        loss = F.mse_loss(shape_params_original, shape_params_modified)
        return self.weight * loss


class ExpressionDisentanglementLoss(nn.Module):
    def __init__(self, weight=0.1):
        super(ExpressionDisentanglementLoss, self).__init__()
        self.weight = weight
    
    def forward(self, shape_params, expr_params):
        if shape_params is None or expr_params is None:
            return torch.tensor(0.0, device=shape_params.device if shape_params is not None else 'cpu')
        
        shape_flat = shape_params.view(shape_params.shape[0], -1)
        expr_flat = expr_params.view(expr_params.shape[0], -1)
        
        shape_norm = F.normalize(shape_flat, p=2, dim=1)
        expr_norm = F.normalize(expr_flat, p=2, dim=1)
        
        if shape_norm.shape[1] != expr_norm.shape[1]:
            min_dim = min(shape_norm.shape[1], expr_norm.shape[1])
            shape_norm = shape_norm[:, :min_dim]
            expr_norm = expr_norm[:, :min_dim]
        
        correlation = torch.abs(torch.sum(shape_norm * expr_norm, dim=1)).mean()
        
        return self.weight * correlation


class OrthogonalityLoss(nn.Module):
    def __init__(self, weight=1e-3):
        super(OrthogonalityLoss, self).__init__()
        self.weight = weight
    
    def forward(self, rotation_matrices):
        if rotation_matrices is None:
            return torch.tensor(0.0)
        
        batch_size = rotation_matrices.shape[0]
        I = torch.eye(3, device=rotation_matrices.device).unsqueeze(0).expand(batch_size, 3, 3)
        
        RTR = torch.bmm(rotation_matrices.transpose(1, 2), rotation_matrices)
        loss = F.mse_loss(RTR, I)
        
        return self.weight * loss


class EdgeAwareSmoothingLoss(nn.Module):
    def __init__(self, weight=0.1):
        super(EdgeAwareSmoothingLoss, self).__init__()
        self.weight = weight
    
    def forward(self, image):
        if image is None:
            return torch.tensor(0.0, device=image.device if image is not None else 'cpu')
        
        grad_x = image[:, :, 1:, :] - image[:, :, :-1, :]
        grad_y = image[:, :, :, 1:] - image[:, :, :, :-1]
        
        loss = torch.mean(torch.abs(grad_x)) + torch.mean(torch.abs(grad_y))
        
        return self.weight * loss


class TotalLossV2(nn.Module):
    def __init__(self, config=None):
        super(TotalLossV2, self).__init__()
        
        if config is None:
            self.landmark_weight = 1.0
            self.photometric_weight = 1.0
            self.reg_shape_weight = 1e-3
            self.reg_expr_weight = 1e-3
            self.reg_tex_weight = 1e-3
            self.reg_pose_weight = 1e-4
            self.perceptual_weight = 0.1
            self.identity_weight = 1.0
            self.disentangle_weight = 0.1
            self.ortho_weight = 1e-3
        else:
            self.landmark_weight = config.LANDMARK_WEIGHT
            self.photometric_weight = config.PHOTOMETRIC_WEIGHT
            self.reg_shape_weight = config.REG_SHAPE_WEIGHT
            self.reg_expr_weight = config.REG_EXPR_WEIGHT
            self.reg_tex_weight = config.REG_TEX_WEIGHT
            self.reg_pose_weight = config.REG_POSE_WEIGHT
            self.perceptual_weight = getattr(config, 'PERCEPTUAL_WEIGHT', 0.1)
            self.identity_weight = getattr(config, 'IDENTITY_WEIGHT', 1.0)
            self.disentangle_weight = getattr(config, 'DISENTANGLE_WEIGHT', 0.1)
            self.ortho_weight = getattr(config, 'ORTHO_WEIGHT', 1e-3)
        
        self.landmark_loss = LandmarkLoss(self.landmark_weight)
        self.photometric_loss = PhotometricLoss(self.photometric_weight)
        self.perceptual_loss = PerceptualLoss(self.perceptual_weight)
        self.reg_loss = RegularizationLoss(
            self.reg_shape_weight,
            self.reg_expr_weight,
            self.reg_tex_weight,
            self.reg_pose_weight
        )
        self.identity_loss = IdentityPreservationLoss(self.identity_weight)
        self.disentangle_loss = ExpressionDisentanglementLoss(self.disentangle_weight)
        self.ortho_loss = OrthogonalityLoss(self.ortho_weight)
    
    def forward(self, pred_dict, target_dict, params_dict, original_shape=None, rotation_matrices=None):
        losses = {}
        
        losses['landmark'] = self.landmark_loss(
            pred_dict.get('landmarks'),
            target_dict.get('landmarks')
        )
        
        losses['photometric'] = self.photometric_loss(
            pred_dict.get('image'),
            target_dict.get('image'),
            pred_dict.get('silhouette')
        )
        
        losses['perceptual'] = self.perceptual_loss(
            pred_dict.get('image'),
            target_dict.get('image')
        )
        
        losses['regularization'] = self.reg_loss(
            params_dict.get('shape'),
            params_dict.get('expr'),
            params_dict.get('tex'),
            params_dict.get('pose')
        )
        
        if original_shape is not None and params_dict.get('shape') is not None:
            losses['identity'] = self.identity_loss(original_shape, params_dict['shape'])
        else:
            losses['identity'] = torch.tensor(0.0, device=losses['landmark'].device)
        
        if params_dict.get('shape') is not None and params_dict.get('expr') is not None:
            losses['disentangle'] = self.disentangle_loss(params_dict['shape'], params_dict['expr'])
        else:
            losses['disentangle'] = torch.tensor(0.0, device=losses['landmark'].device)
        
        if rotation_matrices is not None:
            losses['orthogonality'] = self.ortho_loss(rotation_matrices)
        else:
            losses['orthogonality'] = torch.tensor(0.0, device=losses['landmark'].device)
        
        total_loss = sum(losses.values())
        losses['total'] = total_loss
        
        return losses
