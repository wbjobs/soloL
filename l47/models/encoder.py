import torch
import torch.nn as nn
import torchvision.models as models
from configs import cfg


class ResNetEncoder(nn.Module):
    def __init__(self, config=None):
        super(ResNetEncoder, self).__init__()
        if config is None:
            config = cfg.FLAME
        
        self.shape_dim = config.SHAPE_DIM
        self.expr_dim = config.EXPR_DIM
        self.pose_dim = config.POSE_DIM
        self.tex_dim = config.TEX_DIM
        self.total_params = self.shape_dim + self.expr_dim + self.pose_dim + self.tex_dim + 3
        
        resnet = models.resnet50(pretrained=True)
        self.feature_extractor = nn.Sequential(*list(resnet.children())[:-1])
        
        fc_in_features = resnet.fc.in_features
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
                nn.init.normal_(m.weight, 0, 0.01)
                nn.init.constant_(m.bias, 0)
    
    def forward(self, x):
        batch_size = x.shape[0]
        
        features = self.feature_extractor(x)
        features = features.view(batch_size, -1)
        
        params = self.fc_layers(features)
        
        start = 0
        shape_params = params[:, start:start + self.shape_dim]
        start += self.shape_dim
        
        expr_params = params[:, start:start + self.expr_dim]
        start += self.expr_dim
        
        pose_params = params[:, start:start + self.pose_dim]
        start += self.pose_dim
        
        tex_params = params[:, start:start + self.tex_dim]
        start += self.tex_dim
        
        cam_params = params[:, start:start + 3]
        
        return {
            'shape': shape_params,
            'expr': expr_params,
            'pose': pose_params,
            'tex': tex_params,
            'cam': cam_params
        }


class SimpleEncoder(nn.Module):
    def __init__(self, config=None):
        super(SimpleEncoder, self).__init__()
        if config is None:
            config = cfg.FLAME
        
        self.shape_dim = config.SHAPE_DIM
        self.expr_dim = config.EXPR_DIM
        self.pose_dim = config.POSE_DIM
        self.tex_dim = config.TEX_DIM
        self.total_params = self.shape_dim + self.expr_dim + self.pose_dim + self.tex_dim + 3
        
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
            
            nn.AdaptiveAvgPool2d((1, 1))
        )
        
        self.fc_layers = nn.Sequential(
            nn.Linear(256, 512),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(256, self.total_params)
        )
        
        self._init_weights()
    
    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Conv2d) or isinstance(m, nn.Linear):
                nn.init.normal_(m.weight, 0, 0.01)
                if m.bias is not None:
                    nn.init.constant_(m.bias, 0)
    
    def forward(self, x):
        batch_size = x.shape[0]
        
        features = self.conv_layers(x)
        features = features.view(batch_size, -1)
        
        params = self.fc_layers(features)
        
        start = 0
        shape_params = params[:, start:start + self.shape_dim]
        start += self.shape_dim
        
        expr_params = params[:, start:start + self.expr_dim]
        start += self.expr_dim
        
        pose_params = params[:, start:start + self.pose_dim]
        start += self.pose_dim
        
        tex_params = params[:, start:start + self.tex_dim]
        start += self.tex_dim
        
        cam_params = params[:, start:start + 3]
        
        return {
            'shape': shape_params,
            'expr': expr_params,
            'pose': pose_params,
            'tex': tex_params,
            'cam': cam_params
        }
