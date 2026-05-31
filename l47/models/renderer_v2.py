import torch
import torch.nn as nn
import torch.nn.functional as F
from configs import cfg

try:
    from pytorch3d.structures import Meshes
    from pytorch3d.renderer import (
        look_at_view_transform,
        FoVPerspectiveCameras,
        PointLights,
        Materials,
        RasterizationSettings,
        MeshRenderer,
        MeshRasterizer,
        SoftPhongShader,
        SoftSilhouetteShader,
        TexturesVertex,
        blending
    )
    from pytorch3d.renderer.blending import BlendParams
    PYTORCH3D_AVAILABLE = True
except ImportError:
    PYTORCH3D_AVAILABLE = False
    print("⚠️  PyTorch3D 未安装，将使用合成渲染器")
    print("   安装命令: pip install pytorch3d (需匹配CUDA版本)")


class DiffRendererV2(nn.Module):
    def __init__(self, config=None, device='cuda' if torch.cuda.is_available() else 'cpu'):
        super(DiffRendererV2, self).__init__()
        if config is None:
            config = cfg.RENDER
        
        self.image_size = config.IMAGE_SIZE
        self.focal_length = config.FOCAL_LENGTH
        self.camera_distance = config.CAMERA_DISTANCE
        self.device = device
        
        self.blur_radius = 0.01
        self.faces_per_pixel = 8
        self.sigma = 1e-4
        
        self.gradient_clip_value = 1.0
        self.gradient_scale = 10.0
        
        self._init_renderer()
        self._init_silhouette_renderer()
    
    def _init_renderer(self):
        if not PYTORCH3D_AVAILABLE:
            self.renderer = None
            return
        
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
            blur_radius=self.blur_radius,
            faces_per_pixel=self.faces_per_pixel,
            bin_size=None,
            max_faces_per_bin=None,
            perspective_correct=True,
            clip_barycentric_coords=True,
            cull_backfaces=False
        )
        
        blend_params = BlendParams(
            sigma=self.sigma,
            gamma=1e-4,
            background_color=(0, 0, 0)
        )
        
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
    
    def _init_silhouette_renderer(self):
        if not PYTORCH3D_AVAILABLE:
            self.silhouette_renderer = None
            return
        
        blend_params_sil = BlendParams(
            sigma=1e-4,
            gamma=1e-4,
            background_color=(0, 0, 0)
        )
        
        self.silhouette_renderer = MeshRenderer(
            rasterizer=MeshRasterizer(
                cameras=self.cameras,
                raster_settings=self.raster_settings
            ),
            shader=SoftSilhouetteShader(blend_params=blend_params_sil)
        )
    
    def _build_meshes(self, vertices, faces, textures=None):
        batch_size = vertices.shape[0]
        
        if textures is None:
            verts_rgb = torch.ones_like(vertices) * 0.8
        else:
            verts_rgb = textures
        
        verts_rgb = torch.clamp(verts_rgb, 0, 1)
        
        if not PYTORCH3D_AVAILABLE:
            return None
        
        textures = TexturesVertex(verts_features=verts_rgb)
        
        faces_expanded = faces.unsqueeze(0).expand(batch_size, -1, -1)
        
        meshes = Meshes(
            verts=vertices,
            faces=faces_expanded,
            textures=textures
        )
        
        return meshes
    
    def _synthetic_render(self, vertices, cam_params):
        batch_size = vertices.shape[0]
        
        yy, xx = torch.meshgrid(
            torch.linspace(-1, 1, self.image_size, device=self.device),
            torch.linspace(-1, 1, self.image_size, device=self.device),
            indexing='ij'
        )
        
        xx = xx.unsqueeze(0).expand(batch_size, -1, -1)
        yy = yy.unsqueeze(0).expand(batch_size, -1, -1)
        
        if cam_params is not None:
            scale = torch.sigmoid(cam_params[:, 0:1]) * 2 + 0.5
            center_x = cam_params[:, 1:2] * 0.1
            center_y = cam_params[:, 2:3] * 0.1
            scale = scale.view(-1, 1, 1)
            center_x = center_x.view(-1, 1, 1)
            center_y = center_y.view(-1, 1, 1)
        else:
            scale = torch.ones(batch_size, 1, 1, device=self.device)
            center_x = torch.zeros(batch_size, 1, 1, device=self.device)
            center_y = torch.zeros(batch_size, 1, 1, device=self.device)
        
        dist_from_center = torch.sqrt((xx - center_x)**2 + (yy - center_y)**2)
        face_radius = 0.4 * scale
        
        face_mask = dist_from_center < face_radius
        face_mask_float = face_mask.float()
        
        gradient = 1.0 - (dist_from_center / face_radius)
        gradient = torch.clamp(gradient, 0, 1)
        
        r = 0.9 + 0.1 * torch.sin(xx * 3) * torch.cos(yy * 3)
        g = 0.8 + 0.1 * torch.sin(yy * 3)
        b_channel = 0.7 + 0.1 * torch.cos(xx * 3)
        
        mask_grad = face_mask_float * gradient
        
        images = torch.zeros(batch_size, 3, self.image_size, self.image_size, device=self.device)
        images[:, 0] = r * mask_grad
        images[:, 1] = g * mask_grad
        images[:, 2] = b_channel * mask_grad
        
        silhouettes = mask_grad.unsqueeze(1)
        
        return images, silhouettes
    
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
    
    def _compute_depth_weights(self, vertices, faces, cam_params):
        batch_size = vertices.shape[0]
        
        vertices_transformed = self._apply_camera_transform(vertices, cam_params)
        
        depth_values = vertices_transformed[..., 2]
        
        face_depths = torch.zeros((batch_size, faces.shape[0]), device=vertices.device)
        for i in range(faces.shape[0]):
            v0, v1, v2 = faces[i]
            face_depths[:, i] = (
                vertices_transformed[:, v0, 2] + 
                vertices_transformed[:, v1, 2] + 
                vertices_transformed[:, v2, 2]
            ) / 3.0
        
        weights = torch.sigmoid(-(face_depths - face_depths.mean()) / face_depths.std().clamp(min=1e-6))
        
        return weights
    
    def _gradient_scaling_hook(self, grad):
        grad_norm = grad.norm()
        if grad_norm < 1e-6:
            scaled_grad = grad * self.gradient_scale
        else:
            scaled_grad = grad
        
        scaled_grad = torch.clamp(scaled_grad, -self.gradient_clip_value, self.gradient_clip_value)
        
        return scaled_grad
    
    def _log_depth_aware_render(self, meshes, return_fragments=False):
        fragments = self.renderer.rasterizer(meshes)
        
        if hasattr(self, '_hook_registered') and not self._hook_registered:
            fragments.pix_to_face.register_hook(self._gradient_scaling_hook)
            self._hook_registered = True
        
        images = self.renderer.shader(fragments, meshes, lights=self.lights, materials=self.materials)
        
        if return_fragments:
            return images, fragments
        
        return images
    
    def forward(self, vertices, faces, textures=None, cam_params=None, return_mesh=False, return_silhouette=False):
        batch_size = vertices.shape[0]
        self._hook_registered = False
        
        if cam_params is not None:
            vertices = self._apply_camera_transform(vertices, cam_params)
        
        if not PYTORCH3D_AVAILABLE:
            images, silhouettes = self._synthetic_render(vertices, cam_params)
            
            result = {'image': images}
            if return_silhouette:
                result['silhouette'] = silhouettes
            if return_mesh:
                result['meshes'] = None
            
            return result
        
        meshes = self._build_meshes(vertices, faces, textures)
        
        images = self._log_depth_aware_render(meshes)
        images = images[..., :3].permute(0, 3, 1, 2)
        
        result = {'image': images}
        
        if return_silhouette:
            sil_fragments = self.silhouette_renderer.rasterizer(meshes)
            silhouettes = self.silhouette_renderer.shader(sil_fragments, meshes)
            silhouettes = silhouettes[..., 3].unsqueeze(1)
            result['silhouette'] = silhouettes
        
        if return_mesh:
            result['mesh'] = meshes
        
        return result
    
    def render_with_landmarks(self, vertices, faces, landmarks, textures=None, cam_params=None, image_size=None):
        outputs = self.forward(vertices, faces, textures, cam_params)
        images = outputs['image']
        
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
    
    def rotate_view(self, vertices, faces, textures=None, elev=0, azim=0, ssaa_factor=2):
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
        
        render_size = self.image_size * ssaa_factor
        
        raster_settings = RasterizationSettings(
            image_size=render_size,
            blur_radius=self.blur_radius,
            faces_per_pixel=self.faces_per_pixel,
            perspective_correct=True
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
        
        blend_params = BlendParams(sigma=self.sigma, gamma=1e-4, background_color=(0, 0, 0))
        
        renderer = MeshRenderer(
            rasterizer=MeshRasterizer(
                cameras=cameras,
                raster_settings=raster_settings
            ),
            shader=SoftPhongShader(
                device=self.device,
                cameras=cameras,
                lights=self.lights,
                materials=self.materials,
                blend_params=blend_params
            )
        )
        
        with torch.no_grad():
            images = renderer(meshes)
        
        images = images.permute(0, 3, 1, 2)
        images = F.interpolate(images, size=(self.image_size, self.image_size), mode='bilinear', align_corners=False)
        images = images[:, :3]
        
        return images
