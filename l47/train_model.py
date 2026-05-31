#!/usr/bin/env python
import os
import sys
import argparse

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from training.train import Trainer, main as train_main
from configs import cfg


def main():
    parser = argparse.ArgumentParser(description='Train 3D Face Reconstruction Model')
    parser.add_argument('--resume', type=str, default=None, 
                       help='Checkpoint path to resume from')
    parser.add_argument('--simple_encoder', action='store_true',
                       help='Use simple CNN encoder instead of ResNet50')
    parser.add_argument('--epochs', type=int, default=cfg.TRAIN.EPOCHS,
                       help='Number of training epochs (default: 50)')
    parser.add_argument('--batch_size', type=int, default=cfg.DATA.BATCH_SIZE,
                       help='Batch size')
    parser.add_argument('--lr', type=float, default=cfg.TRAIN.LR,
                       help='Learning rate')
    parser.add_argument('--dataset', type=str, default=None,
                       help='Path to 300W-LP dataset')
    
    args = parser.parse_args()
    
    cfg.TRAIN.EPOCHS = args.epochs
    cfg.DATA.BATCH_SIZE = args.batch_size
    cfg.TRAIN.LR = args.lr
    if args.dataset:
        cfg.DATA.DATASET_DIR = args.dataset
    
    print("="*60)
    print("3D人脸重建模型训练 - 基于可微分渲染器")
    print("="*60)
    print(f"训练轮数: {cfg.TRAIN.EPOCHS}")
    print(f"批次大小: {cfg.DATA.BATCH_SIZE}")
    print(f"学习率: {cfg.TRAIN.LR}")
    print(f"编码器: {'Simple CNN' if args.simple_encoder else 'ResNet50'}")
    print(f"数据集: {cfg.DATA.DATASET_DIR}")
    print(f"设备: {'CUDA' if torch.cuda.is_available() else 'CPU'}")
    print("="*60)
    
    print("\n损失函数配置:")
    print(f"  关键点损失权重: {cfg.LOSS.LANDMARK_WEIGHT}")
    print(f"  渲染损失权重: {cfg.LOSS.PHOTOMETRIC_WEIGHT}")
    print(f"  形状正则化权重: {cfg.LOSS.REG_SHAPE_WEIGHT}")
    print(f"  表情正则化权重: {cfg.LOSS.REG_EXPR_WEIGHT}")
    print(f"  纹理正则化权重: {cfg.LOSS.REG_TEX_WEIGHT}")
    print(f"  姿态正则化权重: {cfg.LOSS.REG_POSE_WEIGHT}")
    print("="*60)
    
    trainer = Trainer(use_simple_encoder=args.simple_encoder)
    trainer.train(resume_from=args.resume)
    
    print("\n训练完成！")
    print(f"模型保存在: {cfg.TRAIN.CHECKPOINT_DIR}")
    print(f"训练日志保存在: {cfg.TRAIN.LOG_DIR}")


if __name__ == '__main__':
    import torch
    main()
