
import sys
import os
import time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torch.optim as optim
from torch.utils.data import DataLoader
from torch.cuda.amp import GradScaler, autocast
from torch.nn.parallel import DataParallel
try:
    from torch.utils.tensorboard import SummaryWriter
    TENSORBOARD_AVAILABLE = True
except ImportError:
    TENSORBOARD_AVAILABLE = False
    print("⚠️  TensorBoard 未安装，日志将仅输出到控制台")
from tqdm import tqdm
from typing import Dict, Optional, List, Tuple
import argparse

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from configs import cfg
from models.face_recon_model_v2 import FaceReconstructionModelV2
from models.lighting import LightingEstimator, SHLightingRenderer, LightingLoss
from losses.loss_functions_v2 import TotalLossV2
from data.dataset_300wlp import Dataset300WLP
from data.preprocess import ImagePreprocessor as Preprocessor


class TrainerV2:
    def __init__(self, 
                 config=None,
                 use_mixed_precision: bool = True,
                 gradient_accumulation_steps: int = 4,
                 use_gradient_checkpointing: bool = False,
                 use_data_parallel: bool = False,
                 device: str = 'cuda' if torch.cuda.is_available() else 'cpu',
                 resume_from: Optional[str] = None):
        
        if config is None:
            config = cfg
        
        self.config = config
        self.device = device
        self.use_mixed_precision = use_mixed_precision
        self.gradient_accumulation_steps = gradient_accumulation_steps
        self.use_gradient_checkpointing = use_gradient_checkpointing
        self.use_data_parallel = use_data_parallel
        
        self.scaler = GradScaler(enabled=use_mixed_precision)
        
        self._init_models()
        self._init_losses()
        self._init_optimizer()
        self._init_dataloaders()
        self._init_logging()
        
        self.start_epoch = 0
        self.best_val_loss = float('inf')
        
        if resume_from is not None:
            self._load_checkpoint(resume_from)
        
        if use_data_parallel and torch.cuda.device_count() > 1:
            self._setup_data_parallel()
    
    def _init_models(self):
        print("初始化模型...")
        
        self.model = FaceReconstructionModelV2(
            config=self.config,
            use_simple_encoder=self.config.TRAIN.get('USE_SIMPLE_ENCODER', False),
            device=self.device,
            use_antialiasing=False
        )
        self.model.train()
        
        if self.config.TRAIN.get('USE_LIGHTING', False):
            self.lighting_estimator = LightingEstimator(
                sh_order=3,
                backbone='resnet18',
                device=self.device
            )
            self.lighting_estimator.train()
            
            self.sh_renderer = SHLightingRenderer(
                sh_order=3,
                device=self.device
            )
            self.use_lighting = True
        else:
            self.use_lighting = False
        
        print(f"✅ 模型初始化完成，设备: {self.device}")
        if self.use_lighting:
            print("✅ 光照估计模块已启用")
        print(f"   混合精度训练: {'开启' if self.use_mixed_precision else '关闭'}")
        print(f"   梯度累积步数: {self.gradient_accumulation_steps}")
        if self.gradient_accumulation_steps > 1:
            print(f"   有效批次大小: {self.config.TRAIN.BATCH_SIZE * self.gradient_accumulation_steps}")
    
    def _init_losses(self):
        self.criterion = TotalLossV2(self.config.LOSS)
        
        if self.use_lighting:
            self.lighting_criterion = LightingLoss(device=self.device)
    
    def _init_optimizer(self):
        trainable_params = list(self.model.parameters())
        if self.use_lighting:
            trainable_params += list(self.lighting_estimator.parameters())
        
        self.optimizer = optim.AdamW(
            trainable_params,
            lr=self.config.TRAIN.LR,
            betas=(0.9, 0.999),
            weight_decay=self.config.TRAIN.get('WEIGHT_DECAY', 1e-4)
        )
        
        self.scheduler = optim.lr_scheduler.OneCycleLR(
            self.optimizer,
            max_lr=self.config.TRAIN.LR,
            epochs=self.config.TRAIN.EPOCHS,
            steps_per_epoch=len(self.train_loader) // self.gradient_accumulation_steps if hasattr(self, 'train_loader') else 1000,
            pct_start=0.3,
            anneal_strategy='cos',
            div_factor=25.0,
            final_div_factor=1000.0
        )
        
        self.ema = None
        if self.config.TRAIN.get('USE_EMA', False):
            try:
                from torch_ema import ExponentialMovingAverage
                self.ema = ExponentialMovingAverage(
                    trainable_params,
                    decay=0.9999
                )
                print("✅ EMA已启用")
            except ImportError:
                print("⚠️  未安装torch_ema，跳过EMA")
    
    def _init_dataloaders(self):
        print("初始化数据加载器...")
        
        train_dataset = Dataset300WLP(
            dataset_dir=self.config.DATA.TRAIN_DIR,
            split='train',
            image_size=self.config.RENDER.IMAGE_SIZE,
            augment=True,
            use_synthetic=self.config.DATA.get('USE_SYNTHETIC', True)
        )
        
        val_dataset = Dataset300WLP(
            dataset_dir=self.config.DATA.VAL_DIR,
            split='val',
            image_size=self.config.RENDER.IMAGE_SIZE,
            augment=False,
            use_synthetic=self.config.DATA.get('USE_SYNTHETIC', True)
        )
        
        num_workers = min(self.config.TRAIN.get('NUM_WORKERS', 4), os.cpu_count() or 4)
        
        self.train_loader = DataLoader(
            train_dataset,
            batch_size=self.config.TRAIN.BATCH_SIZE,
            shuffle=True,
            num_workers=num_workers,
            pin_memory=True,
            drop_last=True,
            prefetch_factor=2
        )
        
        self.val_loader = DataLoader(
            val_dataset,
            batch_size=self.config.TRAIN.BATCH_SIZE,
            shuffle=False,
            num_workers=num_workers,
            pin_memory=True,
            drop_last=False
        )
        
        self.preprocessor = Preprocessor()
        
        print(f"✅ 训练集大小: {len(train_dataset)}")
        print(f"✅ 验证集大小: {len(val_dataset)}")
        print(f"✅ 批次大小: {self.config.TRAIN.BATCH_SIZE}")
        print(f"✅ 数据加载器线程: {num_workers}")
    
    def _init_logging(self):
        log_dir = os.path.join(self.config.TRAIN.LOG_DIR, time.strftime('%Y%m%d_%H%M%S'))
        os.makedirs(log_dir, exist_ok=True)
        
        if TENSORBOARD_AVAILABLE:
            self.writer = SummaryWriter(log_dir=log_dir)
            print(f"✅ 日志目录: {log_dir}")
        else:
            self.writer = None
            print(f"ℹ️  TensorBoard不可用，日志将仅输出到控制台")
        
        os.makedirs(self.config.TRAIN.CHECKPOINT_DIR, exist_ok=True)
        print(f"✅ 检查点目录: {self.config.TRAIN.CHECKPOINT_DIR}")
    
    def _setup_data_parallel(self):
        print(f"使用 {torch.cuda.device_count()} 个GPU进行数据并行训练...")
        self.model = DataParallel(self.model)
        if self.use_lighting:
            self.lighting_estimator = DataParallel(self.lighting_estimator)
    
    def _compute_losses(self, batch: Dict[str, torch.Tensor], global_step: int) -> Tuple[Dict[str, torch.Tensor], Dict[str, torch.Tensor]]:
        images = batch['image'].to(self.device, non_blocking=True)
        target_landmarks = batch['landmarks'].to(self.device, non_blocking=True)
        
        with autocast(enabled=self.use_mixed_precision):
            output = self.model(images, return_all=True)
            
            pred_dict = {
                'image': output['image'],
                'landmarks': output['landmarks'],
                'silhouette': output.get('silhouette')
            }
            
            target_dict = {
                'image': images,
                'landmarks': target_landmarks
            }
            
            rotation_matrices = None
            if self.use_mixed_precision:
                with torch.cuda.amp.autocast(enabled=False):
                    pose = output['params']['pose'].float()
                    rotation_matrices = self.model.get_rotation_matrices(pose)[0]
            
            losses = self.criterion(
                pred_dict,
                target_dict,
                output['params'],
                original_shape=None,
                rotation_matrices=rotation_matrices
            )
            
            if 'ortho_loss' in output:
                losses['orthogonality'] = output['ortho_loss']
                losses['total'] = losses['total'] + losses['orthogonality']
            
            if self.use_lighting:
                lighting_output = self.lighting_estimator(images)
                sh_coeffs = lighting_output['sh_coeffs']
                
                vertices = output['vertices'].detach()
                faces = output['flame_output']['faces'].detach()
                
                lighting_render = self.sh_renderer.render(
                    vertices,
                    faces,
                    sh_coeffs
                )
                
                rendered_images = lighting_render['colors'].permute(0, 3, 1, 2)
                
                lighting_losses = self.lighting_criterion(
                    sh_coeffs,
                    rendered_images,
                    images,
                    output.get('silhouette')
                )
                
                losses['lighting'] = lighting_losses['total'] * 0.1
                losses['total'] = losses['total'] + losses['lighting']
        
        return losses, output
    
    def train_epoch(self, epoch: int) -> Dict[str, float]:
        self.model.train()
        if self.use_lighting:
            self.lighting_estimator.train()
        
        epoch_losses = {}
        num_batches = len(self.train_loader)
        
        pbar = tqdm(self.train_loader, desc=f'Epoch {epoch+1}/{self.config.TRAIN.EPOCHS}')
        
        for batch_idx, batch in enumerate(pbar):
            global_step = epoch * num_batches + batch_idx
            
            effective_batch_idx = batch_idx % self.gradient_accumulation_steps
            
            if self.gradient_accumulation_steps > 1:
                loss_scale = 1.0 / self.gradient_accumulation_steps
            else:
                loss_scale = 1.0
            
            losses, output = self._compute_losses(batch, global_step)
            
            total_loss = losses['total'] * loss_scale
            
            if self.use_mixed_precision:
                self.scaler.scale(total_loss).backward()
            else:
                total_loss.backward()
            
            if (effective_batch_idx + 1) % self.gradient_accumulation_steps == 0 or (batch_idx + 1) == num_batches:
                if self.use_mixed_precision:
                    self.scaler.unscale_(self.optimizer)
                    torch.nn.utils.clip_grad_norm_(self.model.parameters(), self.config.TRAIN.get('GRAD_CLIP', 1.0))
                    self.scaler.step(self.optimizer)
                    self.scaler.update()
                else:
                    torch.nn.utils.clip_grad_norm_(self.model.parameters(), self.config.TRAIN.get('GRAD_CLIP', 1.0))
                    self.optimizer.step()
                
                self.optimizer.zero_grad(set_to_none=True)
                
                if self.ema is not None:
                    self.ema.update()
                
                if self.scheduler is not None:
                    self.scheduler.step()
            
            for k, v in losses.items():
                if k not in epoch_losses:
                    epoch_losses[k] = []
                epoch_losses[k].append(v.item())
            
            pbar.set_postfix({
                'loss': f'{losses["total"].item():.4f}',
                'lm': f'{losses.get("landmark", torch.tensor(0)).item():.4f}',
                'photo': f'{losses.get("photometric", torch.tensor(0)).item():.4f}',
                'lr': f'{self.optimizer.param_groups[0]["lr"]:.2e}'
            })
            
            if batch_idx % 50 == 0:
                self._log_training(epoch, batch_idx, losses, output, global_step)
        
        avg_losses = {k: np.mean(v) for k, v in epoch_losses.items()}
        
        return avg_losses
    
    def validate(self, epoch: int) -> Dict[str, float]:
        self.model.eval()
        if self.use_lighting:
            self.lighting_estimator.eval()
        
        if self.ema is not None:
            self.ema.store()
            self.ema.copy_to()
        
        val_losses = {}
        
        with torch.no_grad():
            for batch_idx, batch in enumerate(tqdm(self.val_loader, desc='Validation')):
                images = batch['image'].to(self.device, non_blocking=True)
                target_landmarks = batch['landmarks'].to(self.device, non_blocking=True)
                
                with autocast(enabled=self.use_mixed_precision):
                    output = self.model(images, return_all=True)
                    
                    pred_dict = {
                        'image': output['image'],
                        'landmarks': output['landmarks'],
                        'silhouette': output.get('silhouette')
                    }
                    
                    target_dict = {
                        'image': images,
                        'landmarks': target_landmarks
                    }
                    
                    losses = self.criterion(
                        pred_dict,
                        target_dict,
                        output['params']
                    )
                    
                    if 'ortho_loss' in output:
                        losses['orthogonality'] = output['ortho_loss']
                        losses['total'] = losses['total'] + losses['orthogonality']
                
                for k, v in losses.items():
                    if k not in val_losses:
                        val_losses[k] = []
                    val_losses[k].append(v.item())
                
                if batch_idx == 0:
                    self._log_validation(epoch, output, batch)
        
        avg_losses = {k: np.mean(v) for k, v in val_losses.items()}
        
        if self.ema is not None:
            self.ema.restore()
        
        return avg_losses
    
    def _log_training(self, epoch: int, batch_idx: int, losses: Dict[str, torch.Tensor], 
                      output: Dict[str, torch.Tensor], global_step: int):
        
        if self.writer is None:
            return
        
        for k, v in losses.items():
            self.writer.add_scalar(f'Train/{k}', v.item(), global_step)
        
        self.writer.add_scalar('Train/lr', self.optimizer.param_groups[0]['lr'], global_step)
        
        if self.use_mixed_precision:
            self.writer.add_scalar('Train/scale', self.scaler.get_scale(), global_step)
        
        if batch_idx % 200 == 0:
            with torch.no_grad():
                input_image = output['image'][0]
                rendered_image = output['image'][0]
                
                min_val = min(input_image.min(), rendered_image.min())
                max_val = max(input_image.max(), rendered_image.max())
                
                input_norm = (input_image - min_val) / (max_val - min_val + 1e-8)
                rendered_norm = (rendered_image - min_val) / (max_val - min_val + 1e-8)
                
                comparison = torch.cat([input_norm, rendered_norm], dim=2)
                self.writer.add_image('Train/comparison', comparison.clamp(0, 1), global_step)
    
    def _log_validation(self, epoch: int, output: Dict[str, torch.Tensor], batch: Dict[str, torch.Tensor]):
        if self.writer is None:
            return
        
        with torch.no_grad():
            input_image = output['image'][0]
            rendered_image = output['image'][0]
            
            min_val = min(input_image.min(), rendered_image.min())
            max_val = max(input_image.max(), rendered_image.max())
            
            input_norm = (input_image - min_val) / (max_val - min_val + 1e-8)
            rendered_norm = (rendered_image - min_val) / (max_val - min_val + 1e-8)
            
            comparison = torch.cat([input_norm, rendered_norm], dim=2)
            self.writer.add_image(f'Val/comparison_epoch_{epoch}', comparison.clamp(0, 1))
    
    def _save_checkpoint(self, epoch: int, val_loss: float, is_best: bool = False):
        checkpoint = {
            'epoch': epoch,
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'scheduler_state_dict': self.scheduler.state_dict() if self.scheduler else None,
            'val_loss': val_loss,
            'scaler_state_dict': self.scaler.state_dict() if self.use_mixed_precision else None
        }
        
        if self.use_lighting:
            checkpoint['lighting_state_dict'] = self.lighting_estimator.state_dict()
        
        if self.ema is not None:
            checkpoint['ema_state_dict'] = self.ema.state_dict()
        
        checkpoint_path = os.path.join(self.config.TRAIN.CHECKPOINT_DIR, f'checkpoint_epoch_{epoch+1}.pth')
        torch.save(checkpoint, checkpoint_path)
        print(f"✅ 检查点已保存: {checkpoint_path}")
        
        if is_best:
            best_path = os.path.join(self.config.TRAIN.CHECKPOINT_DIR, 'best_model.pth')
            torch.save(checkpoint, best_path)
            print(f"🏆 最佳模型已更新: {best_path}")
    
    def _load_checkpoint(self, checkpoint_path: str):
        if not os.path.exists(checkpoint_path):
            print(f"❌ 检查点不存在: {checkpoint_path}")
            return
        
        print(f"加载检查点: {checkpoint_path}")
        checkpoint = torch.load(checkpoint_path, map_location=self.device)
        
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        
        if self.scheduler and checkpoint.get('scheduler_state_dict'):
            self.scheduler.load_state_dict(checkpoint['scheduler_state_dict'])
        
        if self.use_mixed_precision and checkpoint.get('scaler_state_dict'):
            self.scaler.load_state_dict(checkpoint['scaler_state_dict'])
        
        if self.use_lighting and checkpoint.get('lighting_state_dict'):
            self.lighting_estimator.load_state_dict(checkpoint['lighting_state_dict'])
        
        if self.ema and checkpoint.get('ema_state_dict'):
            self.ema.load_state_dict(checkpoint['ema_state_dict'])
        
        self.start_epoch = checkpoint['epoch'] + 1
        self.best_val_loss = checkpoint['val_loss']
        
        print(f"✅ 已加载第 {self.start_epoch} 轮，验证损失: {self.best_val_loss:.6f}")
    
    def train(self):
        print("\n" + "="*60)
        print("开始训练")
        print(f"总轮数: {self.config.TRAIN.EPOCHS}")
        print(f"起始轮: {self.start_epoch + 1}")
        print("="*60 + "\n")
        
        for epoch in range(self.start_epoch, self.config.TRAIN.EPOCHS):
            epoch_start_time = time.time()
            
            train_losses = self.train_epoch(epoch)
            val_losses = self.validate(epoch)
            
            epoch_time = time.time() - epoch_start_time
            
            print(f"\nEpoch {epoch+1}/{self.config.TRAIN.EPOCHS} 完成，耗时: {epoch_time:.2f}s")
            print(f"  训练总损失: {train_losses.get('total', 0):.6f}")
            print(f"  验证总损失: {val_losses.get('total', 0):.6f}")
            
            if self.writer is not None:
                for k, v in train_losses.items():
                    self.writer.add_scalar(f'Epoch/Train_{k}', v, epoch)
                for k, v in val_losses.items():
                    self.writer.add_scalar(f'Epoch/Val_{k}', v, epoch)
            
            is_best = val_losses.get('total', float('inf')) < self.best_val_loss
            if is_best:
                self.best_val_loss = val_losses.get('total', float('inf'))
            
            if (epoch + 1) % self.config.TRAIN.get('SAVE_INTERVAL', 5) == 0 or epoch == self.config.TRAIN.EPOCHS - 1:
                self._save_checkpoint(epoch, val_losses.get('total', float('inf')), is_best)
            elif is_best:
                self._save_checkpoint(epoch, val_losses.get('total', float('inf')), is_best=True)
            
            print(f"  最佳验证损失: {self.best_val_loss:.6f}")
            print("-" * 60)
        
        print("\n" + "="*60)
        print("🎉 训练完成！")
        print(f"最佳验证损失: {self.best_val_loss:.6f}")
        print("="*60 + "\n")
        
        if self.writer is not None:
            self.writer.close()
        
        return self.best_val_loss


def parse_args():
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
    
    return parser.parse_args()


def main():
    args = parse_args()
    
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
    
    trainer = TrainerV2(
        config=cfg,
        use_mixed_precision=not args.no_mixed_precision,
        gradient_accumulation_steps=args.gradient_accumulation,
        resume_from=args.resume
    )
    
    best_loss = trainer.train()
    
    return best_loss


if __name__ == '__main__':
    main()
