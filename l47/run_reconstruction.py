#!/usr/bin/env python
import os
import sys
import argparse

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from inference.reconstruct import FaceReconstructor, main as recon_main


def main():
    parser = argparse.ArgumentParser(description='3D Face Reconstruction from Single Image')
    parser.add_argument('--image', type=str, required=True,
                       help='Input face image path')
    parser.add_argument('--checkpoint', type=str, default=None,
                       help='Model checkpoint path')
    parser.add_argument('--simple_encoder', action='store_true',
                       help='Use simple CNN encoder instead of ResNet50')
    parser.add_argument('--num_views', type=int, default=8,
                       help='Number of rotated views to generate')
    parser.add_argument('--no_save', action='store_true',
                       help='Do not save results to disk')
    
    args = parser.parse_args()
    
    print("="*60)
    print("单张图片3D人脸重建")
    print("="*60)
    print(f"输入图片: {args.image}")
    print(f"模型检查点: {args.checkpoint or '使用默认路径'}")
    print(f"旋转视图数量: {args.num_views}")
    print("="*60)
    
    reconstructor = FaceReconstructor(
        checkpoint_path=args.checkpoint,
        use_simple_encoder=args.simple_encoder
    )
    
    print("\n开始重建...")
    result = reconstructor.reconstruct_from_image(
        args.image,
        save_results=not args.no_save
    )
    
    if not args.no_save:
        print("\n生成多视角渲染...")
        reconstructor.generate_rotated_views(
            result,
            num_views=args.num_views,
            save_results=True,
            name_prefix=os.path.splitext(os.path.basename(args.image))[0]
        )
    
    mesh_data = reconstructor.get_mesh_data(result)
    params = reconstructor.get_flame_parameters(result)
    
    print("\n" + "="*60)
    print("重建完成！")
    print("="*60)
    print(f"顶点数量: {len(mesh_data['vertices'])}")
    print(f"面片数量: {len(mesh_data['faces'])}")
    print(f"形状参数维度: {len(params['shape'])}")
    print(f"表情参数维度: {len(params['expr'])}")
    print(f"姿态参数维度: {len(params['pose'])}")
    print(f"纹理参数维度: {len(params['tex'])}")
    
    if not args.no_save:
        print(f"\n结果保存在: {reconstructor.result_dir}")


if __name__ == '__main__':
    main()
