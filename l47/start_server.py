#!/usr/bin/env python
import os
import sys
import argparse

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.app import init_models, app
from configs import cfg


def main():
    parser = argparse.ArgumentParser(description='Start 3D Face Reconstruction Server')
    parser.add_argument('--port', type=int, default=5000,
                       help='Server port (default: 5000)')
    parser.add_argument('--debug', action='store_true',
                       help='Enable debug mode')
    parser.add_argument('--no_init', action='store_true',
                       help='Do not initialize models on startup')
    parser.add_argument('--checkpoint', type=str, default=None,
                       help='Model checkpoint path')
    
    args = parser.parse_args()
    
    print("="*60)
    print("3D人脸重建与表情驱动系统 - 后端服务")
    print("="*60)
    print(f"端口: {args.port}")
    print(f"调试模式: {args.debug}")
    print(f"前端地址: http://localhost:{args.port}")
    print("="*60)
    
    if args.checkpoint:
        cfg.INFER.CHECKPOINT_PATH = args.checkpoint
    
    if not args.no_init:
        print("\n正在加载模型...")
        init_models()
    else:
        print("\n跳过模型初始化，将在首次请求时加载...")
    
    print(f"\n服务已启动，访问 http://localhost:{args.port} 查看前端界面")
    print("API接口:")
    print("  GET  /api/health           - 健康检查")
    print("  POST /api/reconstruct      - 人脸重建")
    print("  POST /api/apply_expression - 应用表情")
    print("  POST /api/transfer_expression_video - 视频表情迁移")
    print("  POST /api/render_rotated   - 旋转视角渲染")
    print("  GET  /api/get_presets      - 获取表情预设")
    print("  GET  /api/mesh             - 获取网格数据")
    print("  GET  /api/params           - 获取FLAME参数")
    print("="*60)
    
    app.run(host='0.0.0.0', port=args.port, debug=args.debug)


if __name__ == '__main__':
    main()
