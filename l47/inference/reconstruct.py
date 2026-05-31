import os
import sys
import numpy as np
import torch
import cv2
import trimesh
import argparse

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from configs import cfg
from models.face_recon_model import FaceReconstructionModel
from data import ImagePreprocessor


class FaceReconstructor:
    def __init__(self, checkpoint_path=None, use_simple_encoder=False, device=None):
        if checkpoint_path is None:
            checkpoint_path = cfg.INFER.CHECKPOINT_PATH
        
        if device is None:
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
        
        self.device = torch.device(device)
        print(f"Using device: {self.device}")
        
        self.model = FaceReconstructionModel(
            config=cfg.FLAME,
            use_simple_encoder=use_simple_encoder,
            device=self.device
        )
        
        self.image_preprocessor = ImagePreprocessor()
        self.result_dir = cfg.INFER.RESULT_DIR
        os.makedirs(self.result_dir, exist_ok=True)
        
        self._load_checkpoint(checkpoint_path)
        self.model.eval()
    
    def _load_checkpoint(self, checkpoint_path):
        if os.path.exists(checkpoint_path):
            checkpoint = torch.load(checkpoint_path, map_location=self.device)
            self.model.load_state_dict(checkpoint['model_state_dict'])
            print(f"Loaded checkpoint from: {checkpoint_path}")
        else:
            print(f"Checkpoint not found: {checkpoint_path}")
            print("Using untrained model for inference...")
    
    def reconstruct_from_image(self, image_input, save_results=True):
        if isinstance(image_input, str):
            img = self.image_preprocessor.load_image(image_input)
            img_name = os.path.splitext(os.path.basename(image_input))[0]
        elif isinstance(image_input, np.ndarray):
            img = image_input
            img_name = 'reconstruction'
        else:
            raise ValueError("Input must be image path or numpy array")
        
        img_tensor = self.image_preprocessor.preprocess_single_image(img)
        
        with torch.no_grad():
            result = self.model.reconstruct(img_tensor[0])
        
        if save_results:
            self._save_results(result, img, img_name)
        
        return result
    
    def _save_results(self, result, original_img, name_prefix):
        rendered_img = self.image_preprocessor.tensor_to_image(result['rendered_image'][0], denormalize=False)
        
        original_resized = cv2.resize(original_img, (rendered_img.shape[1], rendered_img.shape[0]))
        
        comparison = np.concatenate([original_resized, rendered_img], axis=1)
        comparison_path = os.path.join(self.result_dir, f'{name_prefix}_comparison.png')
        cv2.imwrite(comparison_path, cv2.cvtColor(comparison, cv2.COLOR_RGB2BGR))
        print(f"Saved comparison: {comparison_path}")
        
        vertices = result['vertices'][0].cpu().numpy()
        faces = result['faces'].cpu().numpy()
        
        if result['texture'] is not None:
            texture = result['texture'][0].cpu().numpy()
            texture = np.clip(texture, 0, 1)
            mesh = trimesh.Trimesh(
                vertices=vertices,
                faces=faces,
                vertex_colors=texture
            )
        else:
            mesh = trimesh.Trimesh(
                vertices=vertices,
                faces=faces
            )
        
        mesh_path = os.path.join(self.result_dir, f'{name_prefix}_mesh.obj')
        mesh.export(mesh_path)
        print(f"Saved mesh: {mesh_path}")
        
        params = result['params']
        params_dict = {
            'shape': params['shape'][0].cpu().numpy(),
            'expr': params['expr'][0].cpu().numpy(),
            'pose': params['pose'][0].cpu().numpy(),
            'tex': params['tex'][0].cpu().numpy(),
            'cam': params['cam'][0].cpu().numpy()
        }
        params_path = os.path.join(self.result_dir, f'{name_prefix}_params.npz')
        np.savez(params_path, **params_dict)
        print(f"Saved parameters: {params_path}")
        
        landmarks_img = self.image_preprocessor.draw_landmarks(
            rendered_img, 
            result['landmarks'][0].cpu().numpy(),
            color=(0, 255, 0),
            radius=2
        )
        landmarks_path = os.path.join(self.result_dir, f'{name_prefix}_landmarks.png')
        cv2.imwrite(landmarks_path, cv2.cvtColor(landmarks_img, cv2.COLOR_RGB2BGR))
        print(f"Saved landmarks: {landmarks_path}")
    
    def generate_rotated_views(self, result, num_views=8, save_results=True, name_prefix='rotated'):
        params = result['params']
        rotated_images = []
        
        for i in range(num_views):
            azim = (i / num_views) * 360
            img = self.model.render_rotated_view(
                params, 
                elev=0, 
                azim=azim
            )
            rotated_images.append(img[0])
        
        if save_results:
            import torchvision
            grid = torchvision.utils.make_grid(torch.stack(rotated_images), nrow=4)
            grid_img = self.image_preprocessor.tensor_to_image(grid, denormalize=False)
            grid_path = os.path.join(self.result_dir, f'{name_prefix}_views.png')
            cv2.imwrite(grid_path, cv2.cvtColor(grid_img, cv2.COLOR_RGB2BGR))
            print(f"Saved rotated views: {grid_path}")
        
        return rotated_images
    
    def get_mesh_data(self, result):
        vertices = result['vertices'][0].cpu().numpy().tolist()
        faces = result['faces'].cpu().numpy().tolist()
        
        if result['texture'] is not None:
            colors = result['texture'][0].cpu().numpy()
            colors = np.clip(colors * 255, 0, 255).astype(np.uint8).tolist()
        else:
            colors = [[200, 180, 160] for _ in range(len(vertices))]
        
        landmarks = result['landmarks'][0].cpu().numpy().tolist()
        
        return {
            'vertices': vertices,
            'faces': faces,
            'colors': colors,
            'landmarks': landmarks
        }
    
    def get_flame_parameters(self, result):
        params = result['params']
        return {
            'shape': params['shape'][0].cpu().numpy().tolist(),
            'expr': params['expr'][0].cpu().numpy().tolist(),
            'pose': params['pose'][0].cpu().numpy().tolist(),
            'tex': params['tex'][0].cpu().numpy().tolist(),
            'cam': params['cam'][0].cpu().numpy().tolist()
        }


def main():
    parser = argparse.ArgumentParser(description='3D Face Reconstruction from Single Image')
    parser.add_argument('--image', type=str, required=True, help='Input image path')
    parser.add_argument('--checkpoint', type=str, default=None, help='Model checkpoint path')
    parser.add_argument('--simple_encoder', action='store_true', help='Use simple encoder')
    parser.add_argument('--num_views', type=int, default=8, help='Number of rotated views to generate')
    parser.add_argument('--no_save', action='store_true', help='Do not save results')
    
    args = parser.parse_args()
    
    reconstructor = FaceReconstructor(
        checkpoint_path=args.checkpoint,
        use_simple_encoder=args.simple_encoder
    )
    
    result = reconstructor.reconstruct_from_image(
        args.image,
        save_results=not args.no_save
    )
    
    if not args.no_save:
        reconstructor.generate_rotated_views(
            result,
            num_views=args.num_views,
            save_results=True,
            name_prefix=os.path.splitext(os.path.basename(args.image))[0]
        )
    
    mesh_data = reconstructor.get_mesh_data(result)
    params = reconstructor.get_flame_parameters(result)
    
    print(f"\nReconstruction complete!")
    print(f"Number of vertices: {len(mesh_data['vertices'])}")
    print(f"Number of faces: {len(mesh_data['faces'])}")
    print(f"Shape parameter dimension: {len(params['shape'])}")
    print(f"Expression parameter dimension: {len(params['expr'])}")


if __name__ == '__main__':
    main()
