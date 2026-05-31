import os
import sys
import numpy as np
import torch
import cv2
import argparse
from tqdm import tqdm

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from configs import cfg
from models.face_recon_model import FaceReconstructionModel
from data import ImagePreprocessor


class ExpressionTransfer:
    def __init__(self, checkpoint_path=None, use_simple_encoder=False, device=None):
        if checkpoint_path is None:
            checkpoint_path = cfg.INFER.CHECKPOINT_PATH
        
        if device is None:
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
        
        self.device = torch.device(device)
        
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
    
    def extract_expressions_from_video(self, video_path, target_fps=10):
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video: {video_path}")
        
        video_fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        frame_interval = max(1, int(video_fps / target_fps))
        
        expr_series = []
        shape_params = None
        cam_params = None
        tex_params = None
        first_frame = True
        
        frame_count = 0
        pbar = tqdm(total=total_frames, desc="Extracting expressions")
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            
            if frame_count % frame_interval == 0:
                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                img_tensor = self.image_preprocessor.preprocess_single_image(frame_rgb)
                
                with torch.no_grad():
                    output = self.model.reconstruct(img_tensor[0])
                    params = output['params']
                
                expr_series.append(params['expr'][0].cpu().numpy())
                
                if first_frame:
                    shape_params = params['shape']
                    cam_params = params['cam']
                    tex_params = params['tex']
                    first_frame = False
            
            frame_count += 1
            pbar.update(1)
        
        cap.release()
        pbar.close()
        
        print(f"Extracted {len(expr_series)} expression frames from video")
        
        return {
            'expressions': np.array(expr_series),
            'shape': shape_params,
            'cam': cam_params,
            'tex': tex_params,
            'fps': target_fps
        }
    
    def extract_expression_from_image(self, image_path):
        if isinstance(image_path, str):
            img = self.image_preprocessor.load_image(image_path)
        else:
            img = image_path
        
        img_tensor = self.image_preprocessor.preprocess_single_image(img)
        
        with torch.no_grad():
            output = self.model.reconstruct(img_tensor[0])
            params = output['params']
        
        return params
    
    def transfer_expression(self, base_params, source_expr):
        if isinstance(base_params, str):
            base_params = self._load_params(base_params)
        
        if isinstance(source_expr, str):
            source_params = self._load_params(source_expr)
            source_expr = source_params['expr']
        
        if isinstance(source_expr, np.ndarray):
            source_expr = torch.tensor(source_expr, dtype=torch.float32)
        
        result = self.model.apply_expression(base_params, source_expr)
        
        return result
    
    def transfer_expression_to_video(self, base_params, expression_data, output_path=None, fps=10):
        if output_path is None:
            output_path = os.path.join(self.result_dir, 'expression_transfer.mp4')
        
        if isinstance(base_params, str):
            base_params = self._load_params(base_params)
        
        expressions = expression_data['expressions']
        num_frames = len(expressions)
        
        height, width = 224, 448
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        video_writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
        
        pbar = tqdm(total=num_frames, desc="Generating expression transfer video")
        
        for i in range(num_frames):
            expr = expressions[i]
            
            result = self.transfer_expression(base_params, expr)
            
            rendered_img = self.image_preprocessor.tensor_to_image(
                result['rendered_image'][0], 
                denormalize=False
            )
            rendered_bgr = cv2.cvtColor(rendered_img, cv2.COLOR_RGB2BGR)
            
            if base_params.get('original_image') is not None:
                original_img = base_params['original_image']
                original_img = cv2.resize(original_img, (224, 224))
                original_bgr = cv2.cvtColor(original_img, cv2.COLOR_RGB2BGR)
                combined = np.concatenate([original_bgr, rendered_bgr], axis=1)
            else:
                combined = rendered_bgr
            
            video_writer.write(combined)
            pbar.update(1)
        
        pbar.close()
        video_writer.release()
        
        print(f"Expression transfer video saved: {output_path}")
        return output_path
    
    def _load_params(self, params_path):
        if params_path.endswith('.npz'):
            data = np.load(params_path)
            params = {
                'shape': torch.tensor(data['shape'], dtype=torch.float32).unsqueeze(0),
                'expr': torch.tensor(data['expr'], dtype=torch.float32).unsqueeze(0),
                'pose': torch.tensor(data['pose'], dtype=torch.float32).unsqueeze(0),
                'tex': torch.tensor(data['tex'], dtype=torch.float32).unsqueeze(0),
                'cam': torch.tensor(data['cam'], dtype=torch.float32).unsqueeze(0)
            }
        elif params_path.endswith('.pth'):
            params = torch.load(params_path)
        else:
            raise ValueError(f"Unsupported params file format: {params_path}")
        
        return params
    
    def create_expression_sequence(self, base_params, expr_sequence, output_path=None):
        if output_path is None:
            output_path = os.path.join(self.result_dir, 'expression_sequence.mp4')
        
        if isinstance(base_params, str):
            base_params = self._load_params(base_params)
        
        num_frames = len(expr_sequence)
        height, width = 224, 224
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        video_writer = cv2.VideoWriter(output_path, fourcc, 15, (width, height))
        
        pbar = tqdm(total=num_frames, desc="Generating expression sequence")
        
        for i in range(num_frames):
            expr = expr_sequence[i]
            if isinstance(expr, np.ndarray):
                expr = torch.tensor(expr, dtype=torch.float32)
            
            result = self.transfer_expression(base_params, expr)
            
            rendered_img = self.image_preprocessor.tensor_to_image(
                result['rendered_image'][0], 
                denormalize=False
            )
            rendered_bgr = cv2.cvtColor(rendered_img, cv2.COLOR_RGB2BGR)
            
            video_writer.write(rendered_bgr)
            pbar.update(1)
        
        pbar.close()
        video_writer.release()
        
        print(f"Expression sequence video saved: {output_path}")
        return output_path
    
    def interpolate_expressions(self, expr1, expr2, num_frames=30):
        expr1 = expr1.cpu().numpy() if isinstance(expr1, torch.Tensor) else expr1
        expr2 = expr2.cpu().numpy() if isinstance(expr2, torch.Tensor) else expr2
        
        alphas = np.linspace(0, 1, num_frames)
        interpolated = []
        
        for alpha in alphas:
            expr = (1 - alpha) * expr1 + alpha * expr2
            interpolated.append(expr)
        
        return np.array(interpolated)
    
    def create_expression_morph_video(self, base_params, expr_start, expr_end, 
                                      num_frames=60, output_path=None):
        if output_path is None:
            output_path = os.path.join(self.result_dir, 'expression_morph.mp4')
        
        interpolated = self.interpolate_expressions(expr_start, expr_end, num_frames)
        
        return self.create_expression_sequence(base_params, interpolated, output_path)


def main():
    parser = argparse.ArgumentParser(description='Expression Transfer between Faces')
    parser.add_argument('--base_image', type=str, required=True, help='Base face image')
    parser.add_argument('--source_video', type=str, default=None, help='Source video with expressions')
    parser.add_argument('--source_image', type=str, default=None, help='Source image with expression')
    parser.add_argument('--checkpoint', type=str, default=None, help='Model checkpoint path')
    parser.add_argument('--simple_encoder', action='store_true', help='Use simple encoder')
    parser.add_argument('--mode', type=str, default='single', 
                       choices=['single', 'video', 'morph'],
                       help='Expression transfer mode')
    parser.add_argument('--fps', type=int, default=10, help='Output video FPS')
    
    args = parser.parse_args()
    
    transfer = ExpressionTransfer(
        checkpoint_path=args.checkpoint,
        use_simple_encoder=args.simple_encoder
    )
    
    from reconstruct import FaceReconstructor
    reconstructor = FaceReconstructor(
        checkpoint_path=args.checkpoint,
        use_simple_encoder=args.simple_encoder
    )
    
    print("Reconstructing base face...")
    base_result = reconstructor.reconstruct_from_image(args.base_image, save_results=False)
    base_params = base_result['params']
    base_params['original_image'] = reconstructor.image_preprocessor.load_image(args.base_image)
    
    if args.mode == 'single':
        if args.source_image is None:
            print("Please provide --source_image for single expression transfer")
            return
        
        print("Extracting expression from source image...")
        source_params = transfer.extract_expression_from_image(args.source_image)
        source_expr = source_params['expr']
        
        print("Transferring expression...")
        result = transfer.transfer_expression(base_params, source_expr)
        
        rendered_img = reconstructor.image_preprocessor.tensor_to_image(
            result['rendered_image'][0], 
            denormalize=False
        )
        
        output_path = os.path.join(cfg.INFER.RESULT_DIR, 'expression_transfer.png')
        cv2.imwrite(output_path, cv2.cvtColor(rendered_img, cv2.COLOR_RGB2BGR))
        print(f"Result saved: {output_path}")
    
    elif args.mode == 'video':
        if args.source_video is None:
            print("Please provide --source_video for video expression transfer")
            return
        
        print("Extracting expressions from video...")
        expression_data = transfer.extract_expressions_from_video(
            args.source_video, target_fps=args.fps
        )
        
        print("Transferring expressions to base face...")
        output_path = transfer.transfer_expression_to_video(
            base_params, expression_data, fps=args.fps
        )
        print(f"Expression transfer video saved: {output_path}")
    
    elif args.mode == 'morph':
        print("Creating expression morph sequence...")
        expr_dim = cfg.FLAME.EXPR_DIM
        expr_smile = np.zeros(expr_dim)
        expr_smile[:5] = 2.0
        
        expr_neutral = np.zeros(expr_dim)
        
        output_path = transfer.create_expression_morph_video(
            base_params, expr_neutral, expr_smile, num_frames=60
        )
        print(f"Expression morph video saved: {output_path}")


if __name__ == '__main__':
    main()
