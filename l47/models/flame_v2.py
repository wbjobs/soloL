import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
import os
from configs import cfg


class FLAMELandmarkLoss(nn.Module):
    def __init__(self):
        super(FLAMELandmarkLoss, self).__init__()
        self.loss = nn.L1Loss()
    
    def forward(self, pred, target):
        return self.loss(pred, target)


class FLAMEV2(nn.Module):
    def __init__(self, config=None):
        super(FLAMEV2, self).__init__()
        
        if config is None:
            config = cfg.FLAME
        
        self.shape_dim = config.SHAPE_DIM
        self.expr_dim = config.EXPR_DIM
        self.pose_dim = config.POSE_DIM
        self.tex_dim = config.TEX_DIM
        
        self.model_path = config.MODEL_PATH
        self.landmark_type = config.LANDMARK_TYPE
        
        self.ortho_reg_weight = 1e-3
        self.identity_weight = 1e-2
        
        self._create_synthetic_model()
        
    def _create_synthetic_model(self):
        print("Creating synthetic FLAME model for testing...")
        
        self.v_template = nn.Parameter(torch.zeros(5023, 3), requires_grad=False)
        
        theta = np.arccos(1 - np.random.rand(5023))
        phi = 2 * np.pi * np.random.rand(5023)
        r = 0.1 + 0.02 * np.random.randn(5023)
        
        self.v_template.data[:, 0] = torch.from_numpy(r * np.sin(theta) * np.cos(phi)).float()
        self.v_template.data[:, 1] = torch.from_numpy(r * np.sin(theta) * np.sin(phi)).float()
        self.v_template.data[:, 2] = torch.from_numpy(r * np.cos(theta)).float()
        
        self.shapedirs = nn.Parameter(torch.randn(5023, 3, self.shape_dim) * 0.001, requires_grad=False)
        self.exprdirs = nn.Parameter(torch.randn(5023, 3, self.expr_dim) * 0.001, requires_grad=False)
        self.texdirs = nn.Parameter(torch.randn(5023, 3, self.tex_dim) * 0.01, requires_grad=False)
        
        self.tex_template = nn.Parameter(torch.ones(5023, 3) * 0.8, requires_grad=False)
        
        self.J_regressor = nn.Parameter(torch.zeros(5, 5023), requires_grad=False)
        for i in range(5):
            self.J_regressor.data[i, i*1000:(i+1)*1000] = 1.0 / 1000
        
        self.parents = torch.tensor([-1, 0, 1, 2, 3], dtype=torch.long)
        
        self.lbs_weights = nn.Parameter(torch.zeros(5023, 5), requires_grad=False)
        self.lbs_weights.data[:, 0] = 1.0
        
        num_faces = 9976
        self.faces = nn.Parameter(torch.randint(0, 5023, (num_faces, 3)).long(), requires_grad=False)
        
        num_vertices = 5023
        landmark_indices = torch.randperm(num_vertices)[:68]
        self.lmk_embedding = nn.Parameter(torch.zeros(68, num_vertices), requires_grad=False)
        for i in range(68):
            self.lmk_embedding.data[i, landmark_indices[i]] = 1.0
        
        self.register_buffer('identity_mean', torch.zeros(100))
        self.register_buffer('identity_std', torch.ones(100))
    
    def _batch_rodrigues(self, axisang):
        batch_size = axisang.shape[0]
        
        angle = torch.norm(axisang + 1e-8, p=2, dim=1)
        angle = angle.view(batch_size, 1)
        
        axis = axisang / (angle + 1e-8)
        
        cos_angle = torch.cos(angle)
        sin_angle = torch.sin(angle)
        
        axis_x = axis[:, 0].view(batch_size, 1)
        axis_y = axis[:, 1].view(batch_size, 1)
        axis_z = axis[:, 2].view(batch_size, 1)
        
        R = torch.zeros(batch_size, 3, 3, device=axisang.device)
        
        R[:, 0, 0] = cos_angle.squeeze() + axis_x.squeeze()**2 * (1 - cos_angle.squeeze())
        R[:, 0, 1] = axis_x.squeeze() * axis_y.squeeze() * (1 - cos_angle.squeeze()) - axis_z.squeeze() * sin_angle.squeeze()
        R[:, 0, 2] = axis_x.squeeze() * axis_z.squeeze() * (1 - cos_angle.squeeze()) + axis_y.squeeze() * sin_angle.squeeze()
        
        R[:, 1, 0] = axis_x.squeeze() * axis_y.squeeze() * (1 - cos_angle.squeeze()) + axis_z.squeeze() * sin_angle.squeeze()
        R[:, 1, 1] = cos_angle.squeeze() + axis_y.squeeze()**2 * (1 - cos_angle.squeeze())
        R[:, 1, 2] = axis_y.squeeze() * axis_z.squeeze() * (1 - cos_angle.squeeze()) - axis_x.squeeze() * sin_angle.squeeze()
        
        R[:, 2, 0] = axis_x.squeeze() * axis_z.squeeze() * (1 - cos_angle.squeeze()) - axis_y.squeeze() * sin_angle.squeeze()
        R[:, 2, 1] = axis_y.squeeze() * axis_z.squeeze() * (1 - cos_angle.squeeze()) + axis_x.squeeze() * sin_angle.squeeze()
        R[:, 2, 2] = cos_angle.squeeze() + axis_z.squeeze()**2 * (1 - cos_angle.squeeze())
        
        return R
    
    def _orthogonalize_rotation(self, R):
        U, S, V = torch.svd(R)
        R_ortho = torch.bmm(U, V.transpose(1, 2))
        
        det = torch.det(R_ortho)
        det_mask = (det < 0).float()
        V_adj = V.clone()
        V_adj[:, :, 2] = V_adj[:, :, 2] * (1 - 2 * det_mask.view(-1, 1))
        R_ortho = torch.bmm(U, V_adj.transpose(1, 2))
        
        return R_ortho
    
    def _rotation_matrix_to_euler(self, R):
        batch_size = R.shape[0]
        
        sy = torch.sqrt(R[:, 0, 0]**2 + R[:, 1, 0]**2)
        
        singular = (sy < 1e-6).float()
        
        x = torch.atan2(R[:, 2, 1], R[:, 2, 2])
        y = torch.atan2(-R[:, 2, 0], sy)
        z = torch.atan2(R[:, 1, 0], R[:, 0, 0])
        
        x_sing = torch.atan2(-R[:, 1, 2], R[:, 1, 1])
        y_sing = torch.atan2(-R[:, 2, 0], sy)
        z_sing = torch.zeros_like(x_sing)
        
        x = x * (1 - singular) + x_sing * singular
        y = y * (1 - singular) + y_sing * singular
        z = z * (1 - singular) + z_sing * singular
        
        return torch.stack([x, y, z], dim=1)
    
    def _compute_vertices(self, shape_params, expr_params, pose_params):
        batch_size = shape_params.shape[0]
        
        v_shaped = self.v_template + torch.einsum('ijk,bk->bij', self.shapedirs, shape_params)
        
        v_posed = v_shaped + torch.einsum('ijk,bk->bij', self.exprdirs, expr_params)
        
        J = torch.einsum('ji,bik->bjk', self.J_regressor, v_shaped)
        
        pose_params_reshaped = pose_params.view(batch_size, -1, 3)
        
        R_all = []
        for i in range(pose_params_reshaped.shape[1]):
            R = self._batch_rodrigues(pose_params_reshaped[:, i, :])
            R = self._orthogonalize_rotation(R)
            R_all.append(R)
        
        R_global = R_all[0]
        R_jaw = R_all[1] if len(R_all) > 1 else R_all[0]
        
        v_rotated = torch.bmm(v_posed, R_global.transpose(1, 2))
        v_jaw_offset = torch.bmm(v_posed, R_jaw.transpose(1, 2)) - v_posed
        jaw_mask = torch.sigmoid(-v_posed[:, :, 2] * 10).unsqueeze(-1)
        v_final = v_rotated + jaw_mask * v_jaw_offset * 0.5
        
        J_transformed = torch.bmm(J, R_global.transpose(1, 2))
        v_final = v_final + J_transformed[:, 0:1, :] - J[:, 0:1, :]
        
        return v_final, J_transformed
    
    def _compute_landmarks(self, vertices):
        landmarks = torch.einsum('ji,bik->bjk', self.lmk_embedding, vertices)
        return landmarks
    
    def _compute_texture(self, tex_params):
        texture = self.tex_template + torch.einsum('ijk,bk->bij', self.texdirs, tex_params)
        return texture
    
    def compute_orthogonality_loss(self, pose_params):
        batch_size = pose_params.shape[0]
        pose_params_reshaped = pose_params.view(batch_size, -1, 3)
        
        ortho_loss = 0
        for i in range(pose_params_reshaped.shape[1]):
            R = self._batch_rodrigues(pose_params_reshaped[:, i, :])
            RTR = torch.bmm(R.transpose(1, 2), R)
            I = torch.eye(3, device=R.device).unsqueeze(0).expand(batch_size, 3, 3)
            ortho_loss = ortho_loss + F.mse_loss(RTR, I)
        
        return ortho_loss / pose_params_reshaped.shape[1]
    
    def compute_identity_preservation_loss(self, shape_params_1, shape_params_2):
        identity_loss = F.mse_loss(shape_params_1, shape_params_2)
        return identity_loss
    
    def forward(self, shape_params, expr_params, pose_params, tex_params=None, return_losses=False):
        batch_size = shape_params.shape[0]
        
        vertices, joints = self._compute_vertices(shape_params, expr_params, pose_params)
        landmarks = self._compute_landmarks(vertices)
        
        result = {
            'vertices': vertices,
            'landmarks': landmarks,
            'joints': joints,
            'faces': self.faces
        }
        
        if tex_params is not None:
            texture = self._compute_texture(tex_params)
            result['texture'] = texture
        
        if return_losses:
            ortho_loss = self.compute_orthogonality_loss(pose_params)
            result['ortho_loss'] = ortho_loss
        
        return result
