import os
import sys
import numpy as np
import torch
import torch.optim as optim
from torch.optim.lr_scheduler import StepLR
from torch.utils.tensorboard import SummaryWriter
from tqdm import tqdm
import argparse

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from configs import cfg
from models.face_recon_model import FaceReconstructionModel
from losses import TotalLoss
from data import get_dataloaders


class Trainer:
    def __init__(self, config=None, use_simple_encoder=False):
        if config is None:
            config = cfg
        
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"Using device: {self.device}")
        
        self.model = FaceReconstructionModel(
            config=cfg.FLAME,
            use_simple_encoder=use_simple_encoder,
            device=self.device
        )
        
        self.criterion = TotalLoss(config=cfg.LOSS)
        
        self.optimizer = optim.Adam(
            self.model.parameters(),
            lr=cfg.TRAIN.LR,
            weight_decay=cfg.TRAIN.WEIGHT_DECAY
        )
        
        self.scheduler = StepLR(
            self.optimizer,
            step_size=cfg.TRAIN.LR_DECAY_STEP,
            gamma=cfg.TRAIN.LR_DECAY_GAMMA
        )
        
        self.checkpoint_dir = cfg.TRAIN.CHECKPOINT_DIR
        self.log_dir = cfg.TRAIN.LOG_DIR
        
        os.makedirs(self.checkpoint_dir, exist_ok=True)
        os.makedirs(self.log_dir, exist_ok=True)
        
        self.writer = SummaryWriter(log_dir=self.log_dir)
        
        self.epochs = cfg.TRAIN.EPOCHS
        self.save_interval = cfg.TRAIN.SAVE_INTERVAL
        self.val_interval = cfg.TRAIN.VAL_INTERVAL
        
        self.train_loader, self.val_loader = get_dataloaders()
        
        self.global_step = 0
    
    def train_epoch(self, epoch):
        self.model.train()
        
        total_loss = 0.0
        losses_dict = {
            'landmark': 0.0,
            'photometric': 0.0,
            'regularization': 0.0
        }
        
        pbar = tqdm(self.train_loader, desc=f'Epoch {epoch}/{self.epochs}', leave=False)
        
        for batch_idx, batch in enumerate(pbar):
            images = batch['image'].to(self.device)
            landmarks = batch['landmarks'].to(self.device)
            
            self.optimizer.zero_grad()
            
            outputs = self.model(images, return_params=True)
            
            target_dict = {
                'image': images,
                'landmarks': landmarks
            }
            
            loss, batch_losses = self.criterion(outputs, target_dict, outputs['params'])
            
            loss.backward()
            torch.nn.utils.clip_grad_norm_(self.model.parameters(), max_norm=1.0)
            self.optimizer.step()
            
            total_loss += loss.item()
            for k in losses_dict.keys():
                if k in batch_losses:
                    losses_dict[k] += batch_losses[k].item()
            
            self.global_step += 1
            
            self.writer.add_scalar('Train/total_loss', loss.item(), self.global_step)
            for k, v in batch_losses.items():
                self.writer.add_scalar(f'Train/{k}_loss', v.item(), self.global_step)
            
            pbar.set_postfix({'loss': f'{loss.item():.4f}'})
        
        avg_loss = total_loss / len(self.train_loader)
        for k in losses_dict.keys():
            losses_dict[k] /= len(self.train_loader)
        
        return avg_loss, losses_dict
    
    def validate(self, epoch):
        self.model.eval()
        
        total_loss = 0.0
        losses_dict = {
            'landmark': 0.0,
            'photometric': 0.0,
            'regularization': 0.0
        }
        
        with torch.no_grad():
            pbar = tqdm(self.val_loader, desc=f'Validation Epoch {epoch}', leave=False)
            
            for batch_idx, batch in enumerate(pbar):
                images = batch['image'].to(self.device)
                landmarks = batch['landmarks'].to(self.device)
                
                outputs = self.model(images, return_params=True)
                
                target_dict = {
                    'image': images,
                    'landmarks': landmarks
                }
                
                loss, batch_losses = self.criterion(outputs, target_dict, outputs['params'])
                
                total_loss += loss.item()
                for k in losses_dict.keys():
                    if k in batch_losses:
                        losses_dict[k] += batch_losses[k].item()
                
                pbar.set_postfix({'loss': f'{loss.item():.4f}'})
        
        avg_loss = total_loss / len(self.val_loader)
        for k in losses_dict.keys():
            losses_dict[k] /= len(self.val_loader)
        
        self.writer.add_scalar('Val/total_loss', avg_loss, epoch)
        for k, v in losses_dict.items():
            self.writer.add_scalar(f'Val/{k}_loss', v, epoch)
        
        if epoch % 2 == 0:
            self._log_visualizations(images, outputs, landmarks, epoch)
        
        return avg_loss, losses_dict
    
    def _log_visualizations(self, images, outputs, landmarks, epoch):
        import torchvision
        
        rendered = outputs['rendered_image']
        
        mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1).to(self.device)
        std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1).to(self.device)
        
        original_denorm = torch.clamp(images * std + mean, 0, 1)
        rendered_denorm = torch.clamp(rendered, 0, 1)
        
        comparison = torch.cat([original_denorm[:4], rendered_denorm[:4]], dim=0)
        grid = torchvision.utils.make_grid(comparison, nrow=4, normalize=False, scale_each=False)
        self.writer.add_image('Comparison', grid, epoch)
    
    def save_checkpoint(self, epoch, is_best=False):
        checkpoint = {
            'epoch': epoch,
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'scheduler_state_dict': self.scheduler.state_dict(),
            'global_step': self.global_step
        }
        
        if is_best:
            path = os.path.join(self.checkpoint_dir, 'best_model.pth')
        else:
            path = os.path.join(self.checkpoint_dir, f'epoch_{epoch}.pth')
        
        torch.save(checkpoint, path)
        print(f"Checkpoint saved: {path}")
    
    def load_checkpoint(self, checkpoint_path):
        if os.path.exists(checkpoint_path):
            checkpoint = torch.load(checkpoint_path, map_location=self.device)
            self.model.load_state_dict(checkpoint['model_state_dict'])
            self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
            self.scheduler.load_state_dict(checkpoint['scheduler_state_dict'])
            self.global_step = checkpoint.get('global_step', 0)
            start_epoch = checkpoint['epoch'] + 1
            print(f"Loaded checkpoint from epoch {checkpoint['epoch']}")
            return start_epoch
        else:
            print(f"Checkpoint not found: {checkpoint_path}")
            return 1
    
    def train(self, resume_from=None):
        start_epoch = 1
        best_val_loss = float('inf')
        
        if resume_from:
            start_epoch = self.load_checkpoint(resume_from)
        
        print(f"Starting training from epoch {start_epoch} to {self.epochs}")
        
        for epoch in range(start_epoch, self.epochs + 1):
            print(f"\n{'='*50}")
            print(f"Epoch {epoch}/{self.epochs}")
            print(f"Learning rate: {self.optimizer.param_groups[0]['lr']:.6f}")
            print(f"{'='*50}")
            
            train_loss, train_losses = self.train_epoch(epoch)
            
            print(f"Train Loss: {train_loss:.4f}")
            print(f"  Landmark: {train_losses.get('landmark', 0):.4f}")
            print(f"  Photometric: {train_losses.get('photometric', 0):.4f}")
            print(f"  Regularization: {train_losses.get('regularization', 0):.4f}")
            
            if epoch % self.val_interval == 0:
                val_loss, val_losses = self.validate(epoch)
                
                print(f"Val Loss: {val_loss:.4f}")
                print(f"  Landmark: {val_losses.get('landmark', 0):.4f}")
                print(f"  Photometric: {val_losses.get('photometric', 0):.4f}")
                print(f"  Regularization: {val_losses.get('regularization', 0):.4f}")
                
                if val_loss < best_val_loss:
                    best_val_loss = val_loss
                    self.save_checkpoint(epoch, is_best=True)
                    print(f"New best model with val loss: {best_val_loss:.4f}")
            
            if epoch % self.save_interval == 0:
                self.save_checkpoint(epoch)
            
            self.scheduler.step()
        
        print("\nTraining completed!")
        print(f"Best validation loss: {best_val_loss:.4f}")
        
        self.writer.close()


def main():
    parser = argparse.ArgumentParser(description='Train Face Reconstruction Model')
    parser.add_argument('--resume', type=str, default=None, help='Checkpoint path to resume from')
    parser.add_argument('--simple_encoder', action='store_true', help='Use simple encoder instead of ResNet')
    parser.add_argument('--epochs', type=int, default=None, help='Number of epochs')
    
    args = parser.parse_args()
    
    if args.epochs:
        cfg.TRAIN.EPOCHS = args.epochs
    
    trainer = Trainer(use_simple_encoder=args.simple_encoder)
    trainer.train(resume_from=args.resume)


if __name__ == '__main__':
    main()
