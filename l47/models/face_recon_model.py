import torch
import torch.nn as nn
from models import FLAME, ResNetEncoder, SimpleEncoder, DiffRenderer


class FaceReconstructionModel(nn.Module):
    def __init__(self, config=None, use_simple_encoder=False, device='cuda' if torch.cuda.is_available() else 'cpu'):
        super(FaceReconstructionModel, self).__init__()
        self.device = device
        
        if use_simple_encoder:
            self.encoder = SimpleEncoder(config)
        else:
            self.encoder = ResNetEncoder(config)
        
        self.flame = FLAME(config)
        self.renderer = DiffRenderer(device=device)
        
        self.to(device)
    
    def forward(self, images, return_params=False, return_mesh=False):
        batch_size = images.shape[0]
        
        params = self.encoder(images)
        
        flame_output = self.flame(
            shape_params=params['shape'],
            expr_params=params['expr'],
            pose_params=params['pose'],
            tex_params=params['tex']
        )
        
        vertices = flame_output['vertices']
        faces = flame_output['faces']
        landmarks = flame_output['landmarks']
        texture = flame_output.get('texture')
        
        if return_mesh:
            rendered_images, meshes = self.renderer(
                vertices=vertices,
                faces=faces,
                textures=texture,
                cam_params=params['cam'],
                return_mesh=True
            )
        else:
            rendered_images = self.renderer(
                vertices=vertices,
                faces=faces,
                textures=texture,
                cam_params=params['cam']
            )
        
        proj_landmarks = self.renderer._project_landmarks(landmarks, params['cam'])
        
        result = {
            'rendered_image': rendered_images,
            'landmarks': proj_landmarks,
            'vertices': vertices,
            'faces': faces,
            'texture': texture,
            'landmarks_3d': landmarks
        }
        
        if return_params:
            result['params'] = params
        
        if return_mesh:
            result['meshes'] = meshes
        
        return result
    
    def reconstruct(self, image):
        self.eval()
        with torch.no_grad():
            result = self.forward(image.unsqueeze(0).to(self.device), return_params=True, return_mesh=True)
            for k, v in result.items():
                if isinstance(v, torch.Tensor):
                    result[k] = v.cpu()
        return result
    
    def apply_expression(self, base_params, expr_params):
        self.eval()
        with torch.no_grad():
            shape_params = base_params['shape'].to(self.device)
            pose_params = base_params['pose'].to(self.device)
            tex_params = base_params['tex'].to(self.device)
            cam_params = base_params['cam'].to(self.device)
            new_expr_params = expr_params.to(self.device)
            
            if shape_params.dim() == 1:
                shape_params = shape_params.unsqueeze(0)
                pose_params = pose_params.unsqueeze(0)
                tex_params = tex_params.unsqueeze(0)
                cam_params = cam_params.unsqueeze(0)
                new_expr_params = new_expr_params.unsqueeze(0)
            
            flame_output = self.flame(
                shape_params=shape_params,
                expr_params=new_expr_params,
                pose_params=pose_params,
                tex_params=tex_params
            )
            
            vertices = flame_output['vertices']
            faces = flame_output['faces']
            landmarks = flame_output['landmarks']
            texture = flame_output.get('texture')
            
            rendered_images = self.renderer(
                vertices=vertices,
                faces=faces,
                textures=texture,
                cam_params=cam_params
            )
            
            proj_landmarks = self.renderer._project_landmarks(landmarks, cam_params)
            
            result = {
                'rendered_image': rendered_images.cpu(),
                'landmarks': proj_landmarks.cpu(),
                'vertices': vertices.cpu(),
                'faces': faces,
                'texture': texture.cpu() if texture is not None else None
            }
        
        return result
    
    def render_rotated_view(self, params, elev=0, azim=0):
        self.eval()
        with torch.no_grad():
            shape_params = params['shape'].to(self.device)
            expr_params = params['expr'].to(self.device)
            pose_params = params['pose'].to(self.device)
            tex_params = params['tex'].to(self.device)
            
            if shape_params.dim() == 1:
                shape_params = shape_params.unsqueeze(0)
                expr_params = expr_params.unsqueeze(0)
                pose_params = pose_params.unsqueeze(0)
                tex_params = tex_params.unsqueeze(0)
            
            flame_output = self.flame(
                shape_params=shape_params,
                expr_params=expr_params,
                pose_params=pose_params,
                tex_params=tex_params
            )
            
            vertices = flame_output['vertices']
            faces = flame_output['faces']
            texture = flame_output.get('texture')
            
            rendered_image = self.renderer.rotate_view(
                vertices=vertices,
                faces=faces,
                textures=texture,
                elev=elev,
                azim=azim
            )
            
            return rendered_image.cpu()
