import torch
import torch.nn as nn
import torch.nn.functional as F
import math


class AnisotropicFilter(nn.Module):
    def __init__(self, num_scales=3, max_degree=4):
        super(AnisotropicFilter, self).__init__()
        self.num_scales = num_scales
        self.max_degree = max_degree
    
    def _gaussian_kernel(self, kernel_size=3, sigma=1.0, channels=3):
        x = torch.arange(kernel_size, dtype=torch.float32) - kernel_size // 2
        g = torch.exp(-x**2 / (2 * sigma**2))
        g = g / g.sum()
        kernel_2d = g[:, None] * g[None, :]
        kernel = kernel_2d[None, None, :, :].repeat(channels, 1, 1, 1)
        return kernel
    
    def _build_anisotropic_kernel(self, sigma_x, sigma_y, theta, kernel_size=5):
        y, x = torch.meshgrid(
            torch.arange(kernel_size) - kernel_size // 2,
            torch.arange(kernel_size) - kernel_size // 2,
            indexing='ij'
        )
        
        x_rot = x * torch.cos(theta) - y * torch.sin(theta)
        y_rot = x * torch.sin(theta) + y * torch.cos(theta)
        
        kernel = torch.exp(-(x_rot**2 / (2 * sigma_x**2) + y_rot**2 / (2 * sigma_y**2)))
        kernel = kernel / kernel.sum()
        
        return kernel
    
    def _compute_structure_tensor(self, image):
        gray = image.mean(dim=1, keepdim=True)
        
        sobel_x = torch.tensor([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=torch.float32, device=image.device)
        sobel_x = sobel_x.view(1, 1, 3, 3)
        sobel_y = sobel_x.transpose(2, 3)
        
        Ix = F.conv2d(gray, sobel_x, padding=1)
        Iy = F.conv2d(gray, sobel_y, padding=1)
        
        Ixx = Ix ** 2
        Iyy = Iy ** 2
        Ixy = Ix * Iy
        
        gaussian = self._gaussian_kernel(kernel_size=5, sigma=2.0, channels=1).to(image.device)
        Ixx = F.conv2d(Ixx, gaussian, padding=2, groups=1)
        Iyy = F.conv2d(Iyy, gaussian, padding=2, groups=1)
        Ixy = F.conv2d(Ixy, gaussian, padding=2, groups=1)
        
        return Ixx, Iyy, Ixy
    
    def _compute_anisotropy_params(self, Ixx, Iyy, Ixy):
        trace = Ixx + Iyy
        det = Ixx * Iyy - Ixy ** 2
        
        sqrt_term = torch.sqrt((Ixx - Iyy)**2 + 4 * Ixy**2 + 1e-8)
        lambda1 = (trace + sqrt_term) / 2 + 1e-8
        lambda2 = (trace - sqrt_term) / 2 + 1e-8
        
        anisotropy = (lambda1 - lambda2) / (lambda1 + lambda2 + 1e-8)
        
        theta = 0.5 * torch.atan2(2 * Ixy, Ixx - Iyy + 1e-8)
        
        return anisotropy, theta, lambda1, lambda2
    
    def forward(self, image):
        batch_size, channels, height, width = image.shape
        
        Ixx, Iyy, Ixy = self._compute_structure_tensor(image)
        anisotropy, theta, lambda1, lambda2 = self._compute_anisotropy_params(Ixx, Iyy, Ixy)
        
        filtered = torch.zeros_like(image)
        
        for c in range(channels):
            channel_img = image[:, c:c+1, :, :]
            
            sigma_min = 0.5
            sigma_max = 3.0
            sigma_x = sigma_min + (sigma_max - sigma_min) * (1 - anisotropy)
            sigma_y = sigma_min
            
            for b in range(batch_size):
                for h in range(0, height, 3):
                    for w in range(0, width, 3):
                        local_theta = theta[b, 0, h, w]
                        local_sx = sigma_x[b, 0, h, w].clamp(sigma_min, sigma_max)
                        local_sy = sigma_y
                        
                        kernel = self._build_anisotropic_kernel(local_sx, local_sy, local_theta)
                        kernel = kernel.view(1, 1, 5, 5).to(image.device)
                        
                        h_start = max(0, h-2)
                        h_end = min(height, h+3)
                        w_start = max(0, w-2)
                        w_end = min(width, w+3)
                        
                        patch = channel_img[b:b+1, :, h_start:h_end, w_start:w_end]
                        if patch.shape[2] >= 5 and patch.shape[3] >= 5:
                            filtered_patch = F.conv2d(patch, kernel, padding=2)
                            filtered[b:b+1, c:c+1, h, w] = filtered_patch[0, 0, 2, 2]
        
        anisotropy_expanded = anisotropy.expand_as(filtered)
        result = torch.where(anisotropy_expanded > 0.3, filtered, image)
        
        return result


class SuperSamplingAA(nn.Module):
    def __init__(self, factor=2):
        super(SuperSamplingAA, self).__init__()
        self.factor = factor
        self._init_kernels()
    
    def _init_kernels(self):
        self.register_buffer('gaussian_kernel', self._gaussian_kernel_2d(kernel_size=5, sigma=1.0))
    
    def _gaussian_kernel_2d(self, kernel_size=5, sigma=1.0):
        x = torch.arange(kernel_size, dtype=torch.float32) - kernel_size // 2
        g = torch.exp(-x**2 / (2 * sigma**2))
        g = g / g.sum()
        kernel = g[:, None] * g[None, :]
        return kernel[None, None, :, :]
    
    def _mitchell_netravali_kernel(self, kernel_size=4, B=1/3, C=1/3):
        x = torch.arange(kernel_size, dtype=torch.float32) - kernel_size // 2 + 0.5
        
        abs_x = torch.abs(x)
        x2 = abs_x ** 2
        x3 = abs_x ** 3
        
        kernel = torch.where(
            abs_x < 1,
            (12 - 9*B - 6*C) * x3 + (-18 + 12*B + 6*C) * x2 + (6 - 2*B),
            torch.where(
                abs_x < 2,
                (-B - 6*C) * x3 + (6*B + 30*C) * x2 + (-12*B - 48*C) * abs_x + (8*B + 24*C),
                torch.zeros_like(x)
            )
        )
        
        kernel = kernel / kernel.sum()
        kernel_2d = kernel[:, None] * kernel[None, :]
        return kernel_2d[None, None, :, :]
    
    def forward(self, image, target_size=None):
        batch_size, channels, height, width = image.shape
        
        if target_size is None:
            target_height = height // self.factor
            target_width = width // self.factor
        else:
            target_height, target_width = target_size
        
        upsampled = F.interpolate(
            image,
            size=(height * self.factor, width * self.factor),
            mode='bilinear',
            align_corners=False
        )
        
        kernel = self._mitchell_netravali_kernel(kernel_size=4).to(image.device)
        kernel = kernel.repeat(channels, 1, 1, 1)
        
        upsampled_pad = F.pad(upsampled, (2, 2, 2, 2), mode='reflect')
        filtered = F.conv2d(upsampled_pad, kernel, padding=0, groups=channels)
        
        output = F.interpolate(
            filtered,
            size=(target_height, target_width),
            mode='area'
        )
        
        return output


class FXAA(nn.Module):
    def __init__(self, threshold=0.125, max_threshold=0.25):
        super(FXAA, self).__init__()
        self.threshold = threshold
        self.max_threshold = max_threshold
        self._init_offsets()
    
    def _init_offsets(self):
        self.register_buffer('offsets', torch.tensor([
            [-1, -1], [0, -1], [1, -1],
            [-1, 0], [0, 0], [1, 0],
            [-1, 1], [0, 1], [1, 1]
        ], dtype=torch.float32))
    
    def _rgb_to_luma(self, image):
        luma = 0.299 * image[:, 0:1] + 0.587 * image[:, 1:2] + 0.114 * image[:, 2:3]
        return luma
    
    def forward(self, image):
        batch_size, channels, height, width = image.shape
        
        luma = self._rgb_to_luma(image)
        
        luma_pad = F.pad(luma, (1, 1, 1, 1), mode='replicate')
        
        M = luma
        N = luma_pad[:, :, 0:-2, 1:-1]
        S = luma_pad[:, :, 2:, 1:-1]
        W = luma_pad[:, :, 1:-1, 0:-2]
        E = luma_pad[:, :, 1:-1, 2:]
        NW = luma_pad[:, :, 0:-2, 0:-2]
        NE = luma_pad[:, :, 0:-2, 2:]
        SW = luma_pad[:, :, 2:, 0:-2]
        SE = luma_pad[:, :, 2:, 2:]
        
        luma_max = torch.max(torch.stack([M, N, S, W, E, NW, NE, SW, SE]), dim=0)[0]
        luma_min = torch.min(torch.stack([M, N, S, W, E, NW, NE, SW, SE]), dim=0)[0]
        luma_range = luma_max - luma_min
        
        contrast_threshold = torch.max(
            torch.full_like(luma_range, self.threshold),
            luma_max * self.max_threshold
        )
        
        edge_mask = luma_range > contrast_threshold
        
        horizontal_contrast = torch.abs(N + S - 2 * M)
        vertical_contrast = torch.abs(W + E - 2 * M)
        is_horizontal = horizontal_contrast > vertical_contrast
        
        luma_horizontal = torch.where(is_horizontal, (N + S) / 2, (W + E) / 2)
        gradient_horizontal = torch.where(is_horizontal, horizontal_contrast, vertical_contrast)
        
        pixel_step = torch.where(is_horizontal, 1.0 / height, 1.0 / width)
        
        blend_factor = torch.clamp(torch.abs(luma - luma_horizontal) / gradient_horizontal.clamp(min=1e-6), 0, 1)
        blend_factor = 0.5 * blend_factor - 0.25
        
        result = image.clone()
        
        edge_mask_expanded = edge_mask.expand(-1, channels, -1, -1)
        is_horizontal_expanded = is_horizontal.expand(-1, channels, -1, -1)
        
        if torch.any(edge_mask):
            N_img = F.pad(image, (0, 0, 1, 0))[:, :, :-1, :]
            S_img = F.pad(image, (0, 0, 0, 1))[:, :, 1:, :]
            W_img = F.pad(image, (1, 0, 0, 0))[:, :, :, :-1]
            E_img = F.pad(image, (0, 1, 0, 0))[:, :, :, 1:]
            
            horizontal_blend = (N_img + S_img) / 2
            vertical_blend = (W_img + E_img) / 2
            
            edge_blend = torch.where(is_horizontal_expanded, horizontal_blend, vertical_blend)
            blend_factor_expanded = blend_factor.expand(-1, channels, -1, -1)
            result = torch.where(
                edge_mask_expanded,
                (1 - blend_factor_expanded) * image + blend_factor_expanded * edge_blend,
                image
            )
        
        return result


class TemporalAA(nn.Module):
    def __init__(self, feedback=0.9):
        super(TemporalAA, self).__init__()
        self.feedback = feedback
        self.history = None
    
    def reset(self):
        self.history = None
    
    def forward(self, image):
        if self.history is None:
            self.history = image.clone()
            return image
        
        history_warped = self.history
        
        luma_current = image.mean(dim=1, keepdim=True)
        luma_history = history_warped.mean(dim=1, keepdim=True)
        
        variance = torch.var(luma_current, dim=(2, 3), keepdim=True)
        clamping_amount = torch.sqrt(variance.clamp(min=1e-6)) * 0.5
        
        clamped_history = torch.clamp(
            history_warped,
            image - clamping_amount,
            image + clamping_amount
        )
        
        blended = self.feedback * clamped_history + (1 - self.feedback) * image
        self.history = blended.clone()
        
        return blended


class AntiAliasingPipeline(nn.Module):
    def __init__(self, use_ssaa=True, use_anisotropic=True, use_fxaa=True):
        super(AntiAliasingPipeline, self).__init__()
        self.use_ssaa = use_ssaa
        self.use_anisotropic = use_anisotropic
        self.use_fxaa = use_fxaa
        
        if use_ssaa:
            self.ssaa = SuperSamplingAA(factor=2)
        
        if use_anisotropic:
            self.anisotropic = AnisotropicFilter(num_scales=3)
        
        if use_fxaa:
            self.fxaa = FXAA(threshold=0.1)
    
    def forward(self, image):
        result = image
        
        if self.use_anisotropic:
            result = self.anisotropic(result)
        
        if self.use_ssaa:
            result = self.ssaa(result, target_size=image.shape[2:])
        
        if self.use_fxaa:
            result = self.fxaa(result)
        
        return result
