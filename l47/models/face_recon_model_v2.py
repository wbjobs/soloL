import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models

from configs import cfg
from models.flame_v2 import FLAMEV2
from models.renderer_v2 import DiffRendererV2
from models.antialiasing import AntiAliasingPipeline


class ResNetEncoderV2(nn.Module):
    def __init__(self, config=None):
        super(ResNetEncoderV2, self).__init__()
        
        if config is None:
            config = cfg.FLAME
        
        self.shape_dim = config.SHAPE_DIM
        self.expr_dim = config.EXPR_DIM
        self.pose_dim = config.POSE_DIM
        self.tex_dim = config.TEX_DIM
        self.cam_dim = 3
        
        self.total_params = self.shape_dim + self.expr_dim + self.pose_dim + self.tex_dim + self.cam_dim
        
        resnet = models.resnet50(pretrained=False)
        self.feature_extractor = nn.Sequential(*list(resnet.children())[:-1])
        
        fc_in_features = 2048
        
        self.fc_layers = nn.Sequential(
            nn.Linear(fc_in_features, 1024),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(1024, 512),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(512, self.total_params)
        )
        
        self._init_weights()
    
    def _init_weights(self):
        for m in self.fc_layers.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                nn.init.constant_(m.bias, 0)
    
    def forward(self, x):
        features = self.feature_extractor(x)
        features = features.view(features.size(0), -1)
        
        params = self.fc_layers(features)
        
        shape_params = params[:, :self.shape_dim]
        expr_params = params[:, self.shape_dim:self.shape_dim+self.expr_dim]
        pose_params = params[:, self.shape_dim+self.expr_dim:self.shape_dim+self.expr_dim+self.pose_dim]
        tex_params = params[:, self.shape_dim+self.expr_dim+self.pose_dim:self.shape_dim+self.expr_dim+self.pose_dim+self.tex_dim]
        cam_params = params[:, -self.cam_dim:]
        
        return {
            'shape': shape_params,
            'expr': expr_params,
            'pose': pose_params,
            'tex': tex_params,
            'cam': cam_params
        }


class SimpleEncoderV2(nn.Module):
    def __init__(self, config=None):
        super(SimpleEncoderV2, self).__init__()
        
        if config is None:
            config = cfg.FLAME
        
        self.shape_dim = config.SHAPE_DIM
        self.expr_dim = config.EXPR_DIM
        self.pose_dim = config.POSE_DIM
        self.tex_dim = config.TEX_DIM
        self.cam_dim = 3
        
        self.total_params = self.shape_dim + self.expr_dim + self.pose_dim + self.tex_dim + self.cam_dim
        
        self.conv_layers = nn.Sequential(
            nn.Conv2d(3, 32, kernel_size=7, stride=2, padding=3),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.MaxPool2d(3, stride=2, padding=1),
            
            nn.Conv2d(32, 64, kernel_size=5, stride=2, padding=2),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            
            nn.Conv2d(64, 128, kernel_size=3, stride=2, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(),
            
            nn.Conv2d(128, 256, kernel_size=3, stride=2, padding=1),
            nn.BatchNorm2d(256),
            nn.ReLU(),
            
            nn.AdaptiveAvgPool2d(1)
        )
        
        self.fc_layers = nn.Sequential(
            nn.Linear(256, 512),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(512, self.total_params)
        )
        
        self._init_weights()
    
    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Conv2d) or isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
    
    def forward(self, x):
        features = self.conv_layers(x)
        features = features.view(features.size(0), -1)
        
        params = self.fc_layers(features)
        
        shape_params = params[:, :self.shape_dim]
        expr_params = params[:, self.shape_dim:self.shape_dim+self.expr_dim]
        pose_params = params[:, self.shape_dim+self.expr_dim:self.shape_dim+self.expr_dim+self.pose_dim]
        tex_params = params[:, self.shape_dim+self.expr_dim+self.pose_dim:self.shape_dim+self.expr_dim+self.pose_dim+self.tex_dim]
        cam_params = params[:, -self.cam_dim:]
        
        return {
            'shape': shape_params,
            'expr': expr_params,
            'pose': pose_params,
            'tex': tex_params,
            'cam': cam_params
        }


class FaceReconstructionModelV2(nn.Module):
    def __init__(self, config=None, use_simple_encoder=False, 
                 device='cuda' if torch.cuda.is_available() else 'cpu',
                 use_antialiasing=True):
        super(FaceReconstructionModelV2, self).__init__()
        
        self.device = device
        self.use_antialiasing = use_antialiasing
        
        if use_simple_encoder:
            self.encoder = SimpleEncoderV2(config)
        else:
            self.encoder = ResNetEncoderV2(config)
        
        self.flame = FLAMEV2(config)
        
        self.renderer = DiffRendererV2(config, device=device)
        
        if use_antialiasing:
            self.antialiasing = AntiAliasingPipeline(
                use_ssaa=True,
                use_anisotropic=True,
                use_fxaa=True
            )
        
        self.to(device)
    
    def forward(self, images, return_all=False):
        batch_size = images.shape[0]
        
        params = self.encoder(images)
        
        flame_output = self.flame(
            params['shape'],
            params['expr'],
            params['pose'],
            params['tex'],
            return_losses=True
        )
        
        render_output = self.renderer(
            flame_output['vertices'],
            flame_output['faces'],
            flame_output.get('texture'),
            params['cam'],
            return_silhouette=True
        )
        
        rendered_image = render_output['image']
        
        if self.use_antialiasing and self.training is False:
            with torch.no_grad():
                rendered_image = self.antialiasing(rendered_image)
        
        proj_landmarks = self.renderer._project_landmarks(
            flame_output['landmarks'],
            params['cam']
        )
        
        result = {
            'image': rendered_image,
            'landmarks': proj_landmarks,
            'silhouette': render_output.get('silhouette'),
            'vertices': flame_output['vertices'],
            'params': params,
            'ortho_loss': flame_output.get('ortho_loss', torch.tensor(0.0, device=self.device))
        }
        
        if return_all:
            result.update({
                'flame_output': flame_output,
                'render_output': render_output
            })
        
        return result
    
    def render_rotated_view(self, params, elev=0, azim=0):
        with torch.no_grad():
            flame_output = self.flame(
                params['shape'],
                params['expr'],
                params['pose'],
                params.get('tex')
            )
            
            rendered = self.renderer.rotate_view(
                flame_output['vertices'],
                flame_output['faces'],
                flame_output.get('texture'),
                elev=elev,
                azim=azim,
                ssaa_factor=2
            )
            
            if self.use_antialiasing:
                rendered = self.antialiasing(rendered)
            
            return rendered
    
    def transfer_expression(self, base_params, new_expr_params):
        with torch.no_grad():
            params = {
                'shape': base_params['shape'].clone(),
                'expr': new_expr_params.to(base_params['shape'].device),
                'pose': base_params['pose'].clone(),
                'tex': base_params.get('tex').clone() if base_params.get('tex') is not None else None,
                'cam': base_params['cam'].clone()
            }
            
            flame_output = self.flame(
                params['shape'],
                params['expr'],
                params['pose'],
                params['tex']
            )
            
            render_output = self.renderer(
                flame_output['vertices'],
                flame_output['faces'],
                flame_output.get('texture'),
                params['cam']
            )
            
            rendered_image = render_output['image']
            if self.use_antialiasing:
                rendered_image = self.antialiasing(rendered_image)
            
            return {
                'image': rendered_image,
                'vertices': flame_output['vertices'],
                'params': params
            }
    
    def compute_identity_preservation_loss(self, params_original, params_modified):
        return self.flame.compute_identity_preservation_loss(
            params_original['shape'],
            params_modified['shape']
        )
    
    def get_rotation_matrices(self, pose_params):
        batch_size = pose_params.shape[0]
        pose_reshaped = pose_params.view(batch_size, -1, 3)
        
        rotation_matrices = []
        for i in range(pose_reshaped.shape[1]):
            R = self.flame._batch_rodrigues(pose_reshaped[:, i, :])
            R = self.flame._orthogonalize_rotation(R)
            rotation_matrices.append(R)
        
        return rotation_matrices
