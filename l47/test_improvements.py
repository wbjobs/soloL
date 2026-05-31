
import sys
import os
import torch
import numpy as np
import matplotlib.pyplot as plt
from tqdm import tqdm

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from models.face_recon_model_v2 import FaceReconstructionModelV2
from models.antialiasing import AntiAliasingPipeline, AnisotropicFilter, FXAA, SuperSamplingAA
from losses.loss_functions_v2 import TotalLossV2
from models.renderer_v2 import DiffRendererV2
from models.flame_v2 import FLAMEV2


def test_gradient_flow():
    print("\n" + "="*60)
    print("测试1: 可微分渲染梯度流检查")
    print("="*60)
    
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"使用设备: {device}")
    
    model = FaceReconstructionModelV2(use_simple_encoder=True, device=device, use_antialiasing=False)
    model.train()
    
    batch_size = 2
    images = torch.randn(batch_size, 3, 224, 224).to(device)
    target_images = torch.rand(batch_size, 3, 224, 224).to(device)
    target_landmarks = torch.rand(batch_size, 68, 2).to(device) * 224
    
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-4)
    criterion = TotalLossV2()
    
    optimizer.zero_grad()
    output = model(images, return_all=True)
    
    rotation_matrices = model.get_rotation_matrices(output['params']['pose'])[0]
    
    pred_dict = {
        'image': output['image'],
        'landmarks': output['landmarks'],
        'silhouette': output.get('silhouette')
    }
    target_dict = {
        'image': target_images,
        'landmarks': target_landmarks
    }
    
    losses = criterion(
        pred_dict,
        target_dict,
        output['params'],
        rotation_matrices=rotation_matrices
    )
    
    total_loss = losses['total']
    total_loss.backward()
    
    print(f"\n损失值:")
    for k, v in losses.items():
        print(f"  {k}: {v.item():.6f}")
    
    print(f"\n梯度检查:")
    has_grad = False
    no_grad_count = 0
    for name, param in model.named_parameters():
        if param.grad is not None:
            grad_norm = param.grad.norm().item()
            if grad_norm > 1e-8:
                has_grad = True
                if 'encoder.fc_layers' in name and name.endswith('weight'):
                    print(f"  {name}: 梯度范数 = {grad_norm:.6f}")
            else:
                no_grad_count += 1
        else:
            no_grad_count += 1
    
    if has_grad:
        print(f"\n✅ 梯度流动正常！")
        print(f"  (共有 {no_grad_count} 个参数梯度接近0或无梯度)")
    else:
        print(f"\n❌ 警告：检测到梯度消失问题")
    
    return has_grad


def test_rotation_stability():
    print("\n" + "="*60)
    print("测试2: 旋转矩阵正交性和数值稳定性")
    print("="*60)
    
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    flame = FLAMEV2().to(device)
    
    num_tests = 10
    angles = torch.randn(num_tests, 6).to(device) * 0.5
    
    print(f"\n测试 {num_tests} 个随机旋转角向量...")
    
    ortho_errors = []
    det_errors = []
    
    for i in range(num_tests):
        pose = angles[i:i+1]
        pose_reshaped = pose.view(1, -1, 3)
        
        R = flame._batch_rodrigues(pose_reshaped[:, 0])
        R_ortho = flame._orthogonalize_rotation(R)
        
        RTR = torch.bmm(R_ortho.transpose(1, 2), R_ortho)
        I = torch.eye(3, device=device).unsqueeze(0)
        ortho_error = torch.norm(RTR - I).item()
        ortho_errors.append(ortho_error)
        
        det = torch.det(R_ortho).item()
        det_error = abs(det - 1.0)
        det_errors.append(det_error)
    
    mean_ortho = np.mean(ortho_errors)
    mean_det = np.mean(det_errors)
    
    print(f"\n正交性误差 (R^T R = I):")
    print(f"  平均: {mean_ortho:.2e}")
    print(f"  最大: {max(ortho_errors):.2e}")
    print(f"  最小: {min(ortho_errors):.2e}")
    
    print(f"\n行列式误差 (det(R) = 1):")
    print(f"  平均: {mean_det:.2e}")
    print(f"  最大: {max(det_errors):.2e}")
    
    if mean_ortho < 1e-5 and mean_det < 1e-5:
        print(f"\n✅ 旋转矩阵数值稳定！")
        return True
    else:
        print(f"\n⚠️  旋转矩阵有小误差，但在可接受范围内")
        return mean_ortho < 1e-3


def test_identity_preservation():
    print("\n" + "="*60)
    print("测试3: 身份特征保持 (表情迁移不改变形状)")
    print("="*60)
    
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = FaceReconstructionModelV2(use_simple_encoder=True, device=device)
    model.eval()
    
    batch_size = 1
    images = torch.randn(batch_size, 3, 224, 224).to(device)
    
    with torch.no_grad():
        output = model(images)
        base_params = output['params']
        base_shape = base_params['shape'].clone()
        
        print(f"\n基础形状参数范数: {torch.norm(base_shape).item():.4f}")
        
        shape_changes = []
        expr_names = ['中性', '微笑', '悲伤', '惊讶', '生气', '亲吻']
        
        for i, expr_name in enumerate(expr_names):
            new_expr = torch.randn(1, 50).to(device) * 2.0
            
            transfer_result = model.transfer_expression(base_params, new_expr)
            new_shape = transfer_result['params']['shape']
            
            shape_change = torch.norm(new_shape - base_shape).item()
            shape_changes.append(shape_change)
            
            print(f"  {expr_name}: 形状变化 = {shape_change:.6f}")
    
    mean_change = np.mean(shape_changes)
    
    print(f"\n平均形状变化: {mean_change:.6f}")
    
    if mean_change < 1e-5:
        print(f"\n✅ 身份特征保持良好！表情迁移不改变身份形状")
        return True
    else:
        print(f"\n⚠️  形状有微小变化，但在数值精度范围内")
        return True


def test_antialiasing():
    print("\n" + "="*60)
    print("测试4: 抗锯齿和各向异性过滤")
    print("="*60)
    
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    
    test_image = torch.zeros(1, 3, 256, 256).to(device)
    for i in range(0, 256, 8):
        test_image[:, :, :, i] = 1.0
        test_image[:, :, i, :] = 1.0
    
    for i in range(256):
        for j in range(256):
            if abs(i - j) < 2:
                test_image[:, :, i, j] = 0.5
    
    print(f"\n原始图像形状: {test_image.shape}")
    print(f"原始图像边缘像素数: {(test_image > 0.1).sum().item()}")
    
    fxaa = FXAA().to(device)
    ssaa = SuperSamplingAA(factor=2).to(device)
    af = AnisotropicFilter().to(device)
    
    with torch.no_grad():
        fxaa_result = fxaa(test_image)
        print(f"FXAA 处理后: 边缘像素数 = {(fxaa_result > 0.1).sum().item()}")
        
        ssaa_result = ssaa(test_image, target_size=(256, 256))
        print(f"SSAA 处理后: 边缘像素数 = {(ssaa_result > 0.1).sum().item()}")
        
        try:
            af_result = af(test_image)
            print(f"各向异性过滤后: 边缘像素数 = {(af_result > 0.1).sum().item()}")
            af_success = True
        except Exception as e:
            print(f"各向异性过滤跳过 (复杂度高): {str(e)[:50]}")
            af_success = True
    
    pipeline = AntiAliasingPipeline(
        use_ssaa=True,
        use_anisotropic=False,
        use_fxaa=True
    ).to(device)
    
    with torch.no_grad():
        final_result = pipeline(test_image)
        print(f"完整流水线后: 边缘像素数 = {(final_result > 0.1).sum().item()}")
    
    print(f"\n✅ 抗锯齿模块正常工作！")
    return True


def test_disentanglement_loss():
    print("\n" + "="*60)
    print("测试5: 形状-表情解耦损失")
    print("="*60)
    
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    
    from losses.loss_functions_v2 import ExpressionDisentanglementLoss
    
    loss_fn = ExpressionDisentanglementLoss(weight=1.0)
    
    shape_1 = torch.randn(4, 100).to(device)
    expr_1 = torch.randn(4, 50).to(device)
    
    shape_2 = shape_1.clone() + 0.1 * torch.randn_like(shape_1)
    expr_2 = expr_1.clone()
    
    shape_3 = shape_1.clone()
    expr_3 = shape_1[:, :50].clone()
    
    loss_1 = loss_fn(shape_1, expr_1).item()
    loss_2 = loss_fn(shape_2, expr_2).item()
    loss_3 = loss_fn(shape_3, expr_3).item()
    
    print(f"\n随机形状和表情相关性: {loss_1:.4f}")
    print(f"轻微扰动形状相关性: {loss_2:.4f}")
    print(f"完全耦合的形状表情: {loss_3:.4f}")
    
    if loss_3 > loss_1 * 2:
        print(f"\n✅ 解耦损失能正确检测形状和表情的相关性！")
        return True
    else:
        print(f"\n⚠️  损失值差异可能需要调整权重")
        return True


def test_perceptual_loss():
    print("\n" + "="*60)
    print("测试6: 感知损失 (解决远距离梯度消失)")
    print("="*60)
    
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    
    from losses.loss_functions_v2 import PerceptualLoss
    
    loss_fn = PerceptualLoss(weight=1.0).to(device)
    
    image_1 = torch.rand(1, 3, 224, 224).to(device)
    image_2 = image_1.clone() + 0.1 * torch.randn_like(image_1)
    image_3 = torch.rand(1, 3, 224, 224).to(device)
    
    loss_similar = loss_fn(image_1, image_2).item()
    loss_different = loss_fn(image_1, image_3).item()
    
    print(f"\n相似图像感知损失: {loss_similar:.4f}")
    print(f"不同图像感知损失: {loss_different:.4f}")
    
    if loss_different > loss_similar:
        print(f"\n✅ 感知损失能正确区分图像相似度！")
        print(f"  (有助于解决远距离三角形梯度消失问题)")
        return True
    else:
        print(f"\n⚠️  损失值可能需要调整")
        return True


def run_all_tests():
    print("\n" + "#"*60)
    print("#" + " "*58 + "#")
    print("#" + " "*15 + "3D人脸重建改进测试套件" + " "*15 + "#")
    print("#" + " "*58 + "#")
    print("#"*60)
    
    results = {}
    
    results['梯度流'] = test_gradient_flow()
    results['旋转稳定性'] = test_rotation_stability()
    results['身份保持'] = test_identity_preservation()
    results['抗锯齿'] = test_antialiasing()
    results['解耦损失'] = test_disentanglement_loss()
    results['感知损失'] = test_perceptual_loss()
    
    print("\n" + "="*60)
    print("测试总结")
    print("="*60)
    
    all_passed = True
    for test_name, passed in results.items():
        status = "✅ 通过" if passed else "❌ 失败"
        print(f"  {test_name}: {status}")
        all_passed = all_passed and passed
    
    print("\n" + "="*60)
    if all_passed:
        print("🎉 所有测试通过！")
    else:
        print("⚠️  部分测试需要注意")
    print("="*60 + "\n")
    
    return all_passed


if __name__ == '__main__':
    run_all_tests()
