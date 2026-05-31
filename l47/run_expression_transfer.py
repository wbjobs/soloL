#!/usr/bin/env python
import os
import sys
import argparse

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from inference.expression_transfer import ExpressionTransfer, main as transfer_main
from inference.reconstruct import FaceReconstructor
from configs import cfg


def main():
    parser = argparse.ArgumentParser(description='Expression Transfer to 3D Face')
    parser.add_argument('--base_image', type=str, required=True,
                       help='Base face image to transfer expression to')
    parser.add_argument('--source_video', type=str, default=None,
                       help='Source video with expressions to transfer')
    parser.add_argument('--source_image', type=str, default=None,
                       help='Source image with expression to transfer')
    parser.add_argument('--checkpoint', type=str, default=None,
                       help='Model checkpoint path')
    parser.add_argument('--simple_encoder', action='store_true',
                       help='Use simple CNN encoder instead of ResNet50')
    parser.add_argument('--mode', type=str, default='single',
                       choices=['single', 'video', 'morph'],
                       help='Expression transfer mode')
    parser.add_argument('--fps', type=int, default=10,
                       help='Output video FPS for video mode')
    parser.add_argument('--morph_frames', type=int, default=60,
                       help='Number of frames for morph mode')
    
    args = parser.parse_args()
    
    print("="*60)
    print("3D人脸表情驱动/迁移")
    print("="*60)
    print(f"目标人脸: {args.base_image}")
    print(f"模式: {args.mode}")
    if args.source_video:
        print(f"源视频: {args.source_video}")
    if args.source_image:
        print(f"源图片: {args.source_image}")
    print("="*60)
    
    transfer = ExpressionTransfer(
        checkpoint_path=args.checkpoint,
        use_simple_encoder=args.simple_encoder
    )
    
    reconstructor = FaceReconstructor(
        checkpoint_path=args.checkpoint,
        use_simple_encoder=args.simple_encoder
    )
    
    print("\n重建目标人脸...")
    base_result = reconstructor.reconstruct_from_image(
        args.base_image, 
        save_results=False
    )
    base_params = base_result['params']
    base_params['original_image'] = reconstructor.image_preprocessor.load_image(args.base_image)
    
    if args.mode == 'single':
        if not args.source_image:
            print("错误: single模式需要提供--source_image参数")
            return
        
        print("\n从源图片提取表情...")
        source_params = transfer.extract_expression_from_image(args.source_image)
        source_expr = source_params['expr']
        
        print("\n应用表情到目标人脸...")
        result = transfer.transfer_expression(base_params, source_expr)
        
        rendered_img = reconstructor.image_preprocessor.tensor_to_image(
            result['rendered_image'][0], 
            denormalize=False
        )
        
        output_path = os.path.join(cfg.INFER.RESULT_DIR, 'expression_transfer.png')
        import cv2
        cv2.imwrite(output_path, cv2.cvtColor(rendered_img, cv2.COLOR_RGB2BGR))
        print(f"\n结果已保存: {output_path}")
    
    elif args.mode == 'video':
        if not args.source_video:
            print("错误: video模式需要提供--source_video参数")
            return
        
        print("\n从视频提取表情序列...")
        expression_data = transfer.extract_expressions_from_video(
            args.source_video, 
            target_fps=args.fps
        )
        
        print("\n生成表情迁移视频...")
        output_path = transfer.transfer_expression_to_video(
            base_params, 
            expression_data, 
            fps=args.fps
        )
        print(f"\n视频已保存: {output_path}")
    
    elif args.mode == 'morph':
        import numpy as np
        print("\n生成表情插值动画...")
        expr_dim = cfg.FLAME.EXPR_DIM
        
        expr_smile = np.zeros(expr_dim)
        expr_smile[0:5] = [2.0, 1.5, 1.0, 0.5, 0.3]
        
        expr_neutral = np.zeros(expr_dim)
        
        output_path = transfer.create_expression_morph_video(
            base_params, 
            expr_neutral, 
            expr_smile, 
            num_frames=args.morph_frames
        )
        print(f"\n表情变形动画已保存: {output_path}")
    
    print("\n表情驱动完成！")


if __name__ == '__main__':
    main()
