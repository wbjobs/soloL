import torch
import torch.nn as nn
from pytorch3d.structures import Meshes
from pytorch3d.renderer import (
    look_at_view_transform,
    FoVPerspectiveCameras,
    PointLights,
    DirectionalLights,
    Materials,
    RasterizationSettings,
    MeshRenderer,
    MeshRasterizer,
    SoftPhongShader,
    TexturesVertex,
    blending
)
from configs import cfg


class DiffRenderer(nn.Module):
    def __init__(self, config=None, device='cuda' if torch.cuda.is_available() else 'cpu'):
        super(DiffRenderer, self).__init__()
        if config is None:
            config = cfg.RENDER
        
        self.image_size = config.IMAGE_SIZE
        self.focal_length = config.FOCAL_LENGTH
        self.camera_distance = config.CAMERA_DISTANCE
        self.light_intensity = config.LIGHT_INTENSITY
        self.light_direction = config.LIGHT_DIRECTION
        self.device = device
        
        self._init_renderer()
    
    def _init_renderer(self):
        R, T = look_at_view_transform(
            dist=self.camera_distance,
            elev=0,
            azim=0,
            device=self.device
        )
        
        self.cameras = FoVPerspectiveCameras(
            device=self.device,
            R=R,
            T=T,
            fov=2 * torch.atan(torch.tensor(self.image_size / (2 * self.focal_length))) * 180 / torch.pi
        )
        
        self.lights = PointLights(
            device=self.device,
            ambient_color=((0.5, 0.5, 0.5),),
            diffuse_color=((0.5, 0.5, 0.5),),
            specular_color=((0.1, 0.1, 0.1),),
            location=[[0.0, 0.0, -3.0]]
        )
        
        self.materials = Materials(
            device=self.device,
            shininess=64
        )
        
        self.raster_settings = RasterizationSettings(
            image_size=self.image_size,
            blur_radius=0.0,
            faces_per_pixel=1,
            bin_size=None,
            max_faces_per_bin=None
        )
        
        blend_params = blending.BlendParams(background_color=(0, 0, 0))
        
        self.renderer = MeshRenderer(
            rasterizer=MeshRasterizer(
                cameras=self.cameras,
                raster_settings=self.raster_settings
            ),
            shader=SoftPhongShader(
                device=self.device,
                cameras=self.cameras,
                lights=self.lights,
                materials=self.materials,
                blend_params=blend_params
            )
        )
    
    def _build_meshes(self, vertices, faces, textures=None):
        batch_size = vertices.shape[0]
        
        if textures is None:
            verts_rgb = torch.ones_like(vertices) * 0.8
        else:
            verts_rgb = textures
        
        verts_rgb = torch.clamp(verts_rgb, 0, 1)
        textures = TexturesVertex(verts_features=verts_rgb)
        
        faces_expanded = faces.unsqueeze(0).expand(batch_size, -1, -1)
        
        meshes = Meshes(
            verts=vertices,
            faces=faces_expanded,
            textures=textures
        )
        
        return meshes
    
    def _apply_camera_transform(self, vertices, cam_params):
        batch_size = vertices.shape[0]
        
        scale = torch.sigmoid(cam_params[:, 0:1]) * 2 + 0.5
        trans_x = cam_params[:, 1:2] * 0.1
        trans_y = cam_params[:, 2:3] * 0.1
        trans_z = torch.zeros_like(trans_x)
        
        transform = torch.eye(4, device=vertices.device).unsqueeze(0).repeat(batch_size, 1, 1)
        transform[:, 0, 0] = scale[:, 0]
        transform[:, 1, 1] = scale[:, 0]
        transform[:, 2, 2] = scale[:, 0]
        transform[:, 0, 3] = trans_x[:, 0]
        transform[:, 1, 3] = trans_y[:, 0]
        transform[:, 2, 3] = trans_z[:, 0]
        
        vertices_homo = torch.cat([vertices, torch.ones_like(vertices[..., :1])], dim=-1)
        vertices_transformed = torch.bmm(transform, vertices_homo.transpose(1, 2)).transpose(1, 2)
        
        return vertices_transformed[..., :3]
    
    def _project_landmarks(self, landmarks, cam_params, image_size=None):
        if image_size is None:
            image_size = self.image_size
        
        batch_size = landmarks.shape[0]
        
        scale = torch.sigmoid(cam_params[:, 0:1]) * 2 + 0.5
        trans_x = cam_params[:, 1:2] * 0.1
        trans_y = cam_params[:, 2:3] * 0.1
        
        proj_landmarks = torch.zeros_like(landmarks[..., :2])
        proj_landmarks[..., 0] = (landmarks[..., 0] * scale + trans_x + 1) * image_size / 2
        proj_landmarks[..., 1] = (-landmarks[..., 1] * scale - trans_y + 1) * image_size / 2
        
        return proj_landmarks
    
    def forward(self, vertices, faces, textures=None, cam_params=None, return_mesh=False):
        batch_size = vertices.shape[0]
        
        if cam_params is not None:
            vertices = self._apply_camera_transform(vertices, cam_params)
        
        meshes = self._build_meshes(vertices, faces, textures)
        
        images = self.renderer(meshes)
        images = images[..., :3].permute(0, 3, 1, 2)
        
        if return_mesh:
            return images, meshes
        
        return images
    
    def render_with_landmarks(self, vertices, faces, landmarks, textures=None, cam_params=None, image_size=None):
        images = self.forward(vertices, faces, textures, cam_params)
        
        if image_size is None:
            image_size = self.image_size
        
        if cam_params is not None:
            proj_landmarks = self._project_landmarks(landmarks, cam_params, image_size)
        else:
            proj_landmarks = self._project_landmarks(
                landmarks, 
                torch.zeros(vertices.shape[0], 3, device=vertices.device),
                image_size
            )
        
        return images, proj_landmarks
    
    def rotate_view(self, vertices, faces, textures=None, elev=0, azim=0):
        batch_size = vertices.shape[0]
        
        R, T = look_at_view_transform(
            dist=self.camera_distance,
            elev=elev,
            azim=azim,
            device=self.device
        )
        
        cameras = FoVPerspectiveCameras(
            device=self.device,
            R=R,
            T=T,
            fov=2 * torch.atan(torch.tensor(self.image_size / (2 * self.focal_length))) * 180 / torch.pi
        )
        
        if textures is None:
            verts_rgb = torch.ones_like(vertices) * 0.8
        else:
            verts_rgb = torch.clamp(textures, 0, 1)
        
        textures_p3d = TexturesVertex(verts_features=verts_rgb)
        faces_expanded = faces.unsqueeze(0).expand(batch_size, -1, -1)
        
        meshes = Meshes(
            verts=vertices,
            faces=faces_expanded,
            textures=textures_p3d
        )
        
        renderer = MeshRenderer(
            rasterizer=MeshRasterizer(
                cameras=cameras,
                raster_settings=self.raster_settings
            ),
            shader=SoftPhongShader(
                device=self.device,
                cameras=cameras,
                lights=self.lights,
                materials=self.materials
            )
        )
        
        images = renderer(meshes)
        images = images[..., :3].permute(0, 3, 1, 2)
        
        return images
