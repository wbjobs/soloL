import os
import numpy as np
import torch
import torch.nn as nn
import pickle
from configs import cfg


class FLAME(nn.Module):
    def __init__(self, config=None):
        super(FLAME, self).__init__()
        if config is None:
            config = cfg.FLAME
        
        self.model_path = config.MODEL_PATH
        self.shape_dim = config.SHAPE_DIM
        self.expr_dim = config.EXPR_DIM
        self.pose_dim = config.POSE_DIM
        self.tex_dim = config.TEX_DIM
        self.num_vertices = config.NUM_VERTICES
        self.num_landmarks = config.NUM_LANDMARKS
        
        self._init_model()
        self._init_landmark_layer()
    
    def _init_model(self):
        if os.path.exists(self.model_path):
            self._load_from_file()
        else:
            self._create_synthetic_model()
    
    def _load_from_file(self):
        with open(self.model_path, 'rb') as f:
            model_data = pickle.load(f, encoding='latin1')
        
        self.register_buffer('v_template', torch.tensor(model_data['v_template'], dtype=torch.float32))
        
        shapedirs = model_data['shapedirs'][:, :, :self.shape_dim]
        self.register_buffer('shapedirs', torch.tensor(shapedirs, dtype=torch.float32))
        
        exprdirs = model_data['shapedirs'][:, :, self.shape_dim:self.shape_dim+self.expr_dim]
        self.register_buffer('exprdirs', torch.tensor(exprdirs, dtype=torch.float32))
        
        posedirs = model_data['posedirs']
        self.register_buffer('posedirs', torch.tensor(posedirs, dtype=torch.float32))
        
        J_regressor = model_data['J_regressor'].toarray()
        self.register_buffer('J_regressor', torch.tensor(J_regressor, dtype=torch.float32))
        
        kintree_table = model_data['kintree_table']
        self.register_buffer('kintree_table', torch.tensor(kintree_table, dtype=torch.long))
        
        weights = model_data['weights']
        self.register_buffer('weights', torch.tensor(weights, dtype=torch.float32))
        
        faces = model_data['f']
        self.register_buffer('faces', torch.tensor(faces.astype(np.int64), dtype=torch.long))
        
        if 'tex_dir' in model_data:
            texdirs = model_data['tex_dir'][:, :, :self.tex_dim]
            self.register_buffer('texdirs', torch.tensor(texdirs, dtype=torch.float32))
            self.register_buffer('tex_template', torch.tensor(model_data['tex_template'], dtype=torch.float32))
    
    def _create_synthetic_model(self):
        num_verts = self.num_vertices
        
        v_template = torch.zeros((num_verts, 3), dtype=torch.float32)
        theta = torch.linspace(0, 2 * np.pi, num_verts)
        phi = torch.linspace(0, np.pi, num_verts)
        r = 1.0
        v_template[:, 0] = r * torch.sin(phi) * torch.cos(theta)
        v_template[:, 1] = r * torch.sin(phi) * torch.sin(theta)
        v_template[:, 2] = r * torch.cos(phi)
        self.register_buffer('v_template', v_template)
        
        shapedirs = torch.randn(num_verts, 3, self.shape_dim, dtype=torch.float32) * 0.01
        self.register_buffer('shapedirs', shapedirs)
        
        exprdirs = torch.randn(num_verts, 3, self.expr_dim, dtype=torch.float32) * 0.005
        self.register_buffer('exprdirs', exprdirs)
        
        posedirs = torch.randn(num_verts, 3, 36, dtype=torch.float32) * 0.001
        self.register_buffer('posedirs', posedirs)
        
        num_joints = 5
        J_regressor = torch.zeros((num_joints, num_verts), dtype=torch.float32)
        joint_indices = [0, num_verts // 4, num_verts // 2, 3 * num_verts // 4, num_verts - 1]
        for i, idx in enumerate(joint_indices):
            J_regressor[i, idx] = 1.0
        self.register_buffer('J_regressor', J_regressor)
        
        kintree_table = torch.tensor([[-1, 0, 1, 2, 3], [0, 1, 2, 3, 4]], dtype=torch.long)
        self.register_buffer('kintree_table', kintree_table)
        
        weights = torch.zeros((num_verts, num_joints), dtype=torch.float32)
        for i in range(num_verts):
            dist = torch.abs(torch.tensor(range(num_verts)) - i)
            weights[i] = torch.softmax(-dist.float() / 1000, dim=0)
        self.register_buffer('weights', weights)
        
        faces = []
        for i in range(num_verts - 2):
            faces.append([i, i + 1, i + 2])
        faces = torch.tensor(faces, dtype=torch.long)
        self.register_buffer('faces', faces)
        
        tex_template = torch.ones((num_verts, 3), dtype=torch.float32) * 0.8
        self.register_buffer('tex_template', tex_template)
        
        texdirs = torch.randn(num_verts, 3, self.tex_dim, dtype=torch.float32) * 0.01
        self.register_buffer('texdirs', texdirs)
    
    def _init_landmark_layer(self):
        num_verts = self.num_vertices
        landmark_indices = torch.linspace(0, num_verts - 1, self.num_landmarks).long()
        lmk_embeddings = torch.zeros((self.num_landmarks, num_verts), dtype=torch.float32)
        for i, idx in enumerate(landmark_indices):
            lmk_embeddings[i, idx] = 1.0
        self.register_buffer('lmk_embeddings', lmk_embeddings)
    
    def _compute_vertices(self, shape_params, expr_params, pose_params):
        batch_size = shape_params.shape[0]
        
        v_shaped = self.v_template.unsqueeze(0) + \
                   torch.einsum('bld,vdl->bvl', shape_params.unsqueeze(1), self.shapedirs).squeeze(1) + \
                   torch.einsum('bld,vdl->bvl', expr_params.unsqueeze(1), self.exprdirs).squeeze(1)
        
        pose_feat = self._quat_feat(pose_params)
        v_posed = v_shaped + torch.einsum('bld,vdl->bvl', pose_feat.unsqueeze(1), self.posedirs).squeeze(1)
        
        J = torch.einsum('jv,bvl->bjl', self.J_regressor, v_shaped)
        
        full_pose = torch.zeros((batch_size, self.kintree_table.shape[1], 3), dtype=torch.float32, device=shape_params.device)
        full_pose[:, 0, :3] = pose_params[:, :3]
        if pose_params.shape[1] > 3:
            full_pose[:, 1, :3] = pose_params[:, 3:6]
        
        transform_mats = self._batch_rodrigues(full_pose.view(-1, 3)).view(batch_size, -1, 3, 3)
        
        rel_transforms = self._inverse_kinematics(transform_mats, J)
        
        T = torch.einsum('bvj,bjmn->bvmn', self.weights, rel_transforms)
        
        v_posed_homo = torch.cat([v_posed, torch.ones_like(v_posed[..., :1])], dim=-1)
        v_transformed = torch.einsum('bvkn,bvn->bvkn', T, v_posed_homo)
        
        return v_transformed[..., :3], J
    
    def _quat_feat(self, pose):
        batch_size = pose.shape[0]
        theta = pose.norm(dim=1, keepdim=True)
        with torch.no_grad():
            theta_small = theta < 1e-6
        theta = theta + theta_small.float() * 1.0
        l = pose / theta
        q = torch.cat([theta, l * torch.sin(theta / 2), torch.cos(theta / 2)], dim=1)
        q = q.view(batch_size, 5)
        return q[:, 1:].expand(batch_size, 36)
    
    def _batch_rodrigues(self, rot_vecs):
        batch_size = rot_vecs.shape[0]
        rot_mats = torch.zeros((batch_size, 3, 3), dtype=torch.float32, device=rot_vecs.device)
        
        theta = rot_vecs.norm(dim=1, keepdim=True)
        with torch.no_grad():
            theta_small = theta < 1e-6
        theta = theta + theta_small.float() * 1.0
        
        rot_vecs_normalized = rot_vecs / theta
        
        cos_theta = torch.cos(theta).unsqueeze(-1)
        sin_theta = torch.sin(theta).unsqueeze(-1)
        
        rx, ry, rz = rot_vecs_normalized[:, 0], rot_vecs_normalized[:, 1], rot_vecs_normalized[:, 2]
        
        rot_mats[:, 0, 0] = cos_theta[:, 0] + rx * rx * (1 - cos_theta[:, 0])
        rot_mats[:, 0, 1] = rx * ry * (1 - cos_theta[:, 0]) - rz * sin_theta[:, 0]
        rot_mats[:, 0, 2] = rx * rz * (1 - cos_theta[:, 0]) + ry * sin_theta[:, 0]
        rot_mats[:, 1, 0] = rx * ry * (1 - cos_theta[:, 0]) + rz * sin_theta[:, 0]
        rot_mats[:, 1, 1] = cos_theta[:, 0] + ry * ry * (1 - cos_theta[:, 0])
        rot_mats[:, 1, 2] = ry * rz * (1 - cos_theta[:, 0]) - rx * sin_theta[:, 0]
        rot_mats[:, 2, 0] = rx * rz * (1 - cos_theta[:, 0]) - ry * sin_theta[:, 0]
        rot_mats[:, 2, 1] = ry * rz * (1 - cos_theta[:, 0]) + rx * sin_theta[:, 0]
        rot_mats[:, 2, 2] = cos_theta[:, 0] + rz * rz * (1 - cos_theta[:, 0])
        
        identity = torch.eye(3, dtype=torch.float32, device=rot_vecs.device).unsqueeze(0)
        rot_mats = rot_mats * (1 - theta_small.float()) + identity * theta_small.float()
        
        return rot_mats
    
    def _inverse_kinematics(self, transform_mats, J):
        batch_size = transform_mats.shape[0]
        num_joints = transform_mats.shape[1]
        
        J_homo = torch.cat([J, torch.ones_like(J[..., :1])], dim=-1)
        
        rel_transforms = torch.zeros_like(transform_mats)
        transform_homo = torch.zeros((batch_size, num_joints, 4, 4), dtype=torch.float32, device=transform_mats.device)
        transform_homo[:, :, :3, :3] = transform_mats
        transform_homo[:, :, :3, 3] = J
        transform_homo[:, :, 3, 3] = 1.0
        
        for i in range(num_joints):
            parent = self.kintree_table[0, i].item()
            if parent == -1:
                rel_transforms[:, i] = transform_mats[:, i]
            else:
                parent_inv = torch.inverse(transform_homo[:, parent])
                rel_homo = torch.matmul(parent_inv, transform_homo[:, i])
                rel_transforms[:, i] = rel_homo[:, :3, :3]
        
        return rel_transforms
    
    def _compute_texture(self, tex_params):
        batch_size = tex_params.shape[0]
        texture = self.tex_template.unsqueeze(0) + \
                  torch.einsum('bld,vdl->bvl', tex_params.unsqueeze(1), self.texdirs).squeeze(1)
        return torch.clamp(texture, 0, 1)
    
    def _compute_landmarks(self, vertices):
        batch_size = vertices.shape[0]
        landmarks = torch.einsum('lv,bvh->blh', self.lmk_embeddings, vertices)
        return landmarks
    
    def forward(self, shape_params, expr_params, pose_params, tex_params=None):
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
        
        return result


class FLAMELandmarkLoss(nn.Module):
    def __init__(self):
        super(FLAMELandmarkLoss, self).__init__()
    
    def forward(self, pred_landmarks, target_landmarks):
        return torch.mean(torch.abs(pred_landmarks - target_landmarks))


if __name__ == '__main__':
    model = FLAME()
    batch_size = 2
    
    shape = torch.randn(batch_size, cfg.FLAME.SHAPE_DIM)
    expr = torch.randn(batch_size, cfg.FLAME.EXPR_DIM)
    pose = torch.randn(batch_size, cfg.FLAME.POSE_DIM)
    tex = torch.randn(batch_size, cfg.FLAME.TEX_DIM)
    
    output = model(shape, expr, pose, tex)
    print('Vertices shape:', output['vertices'].shape)
    print('Landmarks shape:', output['landmarks'].shape)
    print('Faces shape:', output['faces'].shape)
    if 'texture' in output:
        print('Texture shape:', output['texture'].shape)
