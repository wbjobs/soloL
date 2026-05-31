
#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
V2版本训练入口脚本 - 支持混合精度训练和梯度累积
"""

import sys
import os
import argparse
import torch
import numpy as np

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from training.train_v2 import TrainerV2, main as train_main
from configs import cfg


def print_banner():
    print("\n" + "="*70)
    print("=" + " "*20 + "3D人脸重建训练 V2 - 加速版本" + " "*20 + "=")
    print("="*70)
    print("  支持: 混合精度训练 | 梯度累积 | OneCycleLR | EMA | 多GPU训练")
    print("="*70 + "\n")


if __name__ == '__main__':
    print_banner()
    
    parser = argparse.ArgumentParser(description='3D人脸重建训练V2 - 加速版本')
    
    parser.add_argument('--config', type=str, default=None, help='配置文件路径')
    parser.add_argument('--epochs', type=int, default=50, help='训练轮数')
    parser.add_argument('--batch_size', type=int, default=16, help='批次大小')
    parser.add_argument('--lr', type=float, default=1e-4, help='学习率')
    parser.add_argument('--dataset', type=str, default=None, help='数据集路径')
    parser.add_argument('--gradient_accumulation', type=int, default=4, help='梯度累积步数')
    parser.add_argument('--no_mixed_precision', action='store_true', help='关闭混合精度')
    parser.add_argument('--use_simple_encoder', action='store_true', help='使用简单CNN编码器')
    parser.add_argument('--use_lighting', action='store_true', help='启用光照估计')
    parser.add_argument('--use_ema', action='store_true', help='启用EMA')
    parser.add_argument('--resume', type=str, default=None, help='从检查点继续训练')
    parser.add_argument('--num_workers', type=int, default=4, help='数据加载线程数')
    parser.add_argument('--weight_decay', type=float, default=1e-4, help='权重衰减')
    parser.add_argument('--grad_clip', type=float, default=1.0, help='梯度裁剪范数')
    
    args = parser.parse_args()
    
    if args.epochs:
        cfg.TRAIN.EPOCHS = args.epochs
    if args.batch_size:
        cfg.TRAIN.BATCH_SIZE = args.batch_size
    if args.lr:
        cfg.TRAIN.LR = args.lr
    if args.dataset:
        cfg.DATA.TRAIN_DIR = args.dataset
        cfg.DATA.VAL_DIR = args.dataset
    if args.use_simple_encoder:
        cfg.TRAIN.USE_SIMPLE_ENCODER = True
    if args.use_lighting:
        cfg.TRAIN.USE_LIGHTING = True
    if args.use_ema:
        cfg.TRAIN.USE_EMA = True
    if args.num_workers:
        cfg.TRAIN.NUM_WORKERS = args.num_workers
    if args.weight_decay:
        cfg.TRAIN.WEIGHT_DECAY = args.weight_decay
    if args.grad_clip:
        cfg.TRAIN.GRAD_CLIP = args.grad_clip
    
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    
    print(f"训练配置:")
    print(f"  设备: {device}")
    if torch.cuda.is_available():
        print(f"  GPU: {torch.cuda.get_device_name(0)}")
        print(f"  显存: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
    print(f"  训练轮数: {cfg.TRAIN.EPOCHS}")
    print(f"  批次大小: {cfg.TRAIN.BATCH_SIZE}")
    print(f"  梯度累积: {args.gradient_accumulation} 步")
    print(f"  有效批次: {cfg.TRAIN.BATCH_SIZE * args.gradient_accumulation}")
    print(f"  学习率: {cfg.TRAIN.LR}")
    print(f"  混合精度: {'开启' if not args.no_mixed_precision else '关闭'}")
    print(f"  光照估计: {'开启' if cfg.TRAIN.get('USE_LIGHTING', False) else '关闭'}")
    print(f"  EMA: {'开启' if cfg.TRAIN.get('USE_EMA', False) else '关闭'}")
    print()
    
    try:
        trainer = TrainerV2(
            config=cfg,
            use_mixed_precision=not args.no_mixed_precision,
            gradient_accumulation_steps=args.gradient_accumulation,
            resume_from=args.resume
        )
        
        best_loss = trainer.train()
        
        print("\n" + "="*70)
        print("🎉 训练完成！")
        print(f"  最佳验证损失: {best_loss:.6f}")
        print("="*70 + "\n")
        
    except KeyboardInterrupt:
        print("\n\n⚠️  训练被用户中断")
        print("检查点已保存在:", cfg.TRAIN.CHECKPOINT_DIR)
    except Exception as e:
        print(f"\n❌ 训练出错: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
