# 可微分渲染器驱动的3D人脸重建与表情驱动系统

基于PyTorch3D和FLAME参数化模型的完整3D人脸重建与表情驱动系统。

## 🌟 系统特性

### 核心功能
- **可微分渲染器**：基于PyTorch3D实现，支持端到端训练的网格渲染
- **单图3D重建**：从单张2D图片重建高精度3D人脸模型（FLAME参数化）
- **表情驱动/迁移**：将源视频的表情迁移到重建的3D人脸上
- **实时预览**：WebGL渲染，支持拖拽旋转、缩放交互
- **模型训练**：完整的训练代码，使用300W-LP数据集，支持50轮训练

### 技术亮点
- **损失函数**：关键点损失 + 渲染损失 + 多维度正则项
- **FLAME模型**：支持100维形状、50维表情、6维姿态、50维纹理参数
- **可微分渲染**：PyTorch3D光栅化器，支持梯度回传
- **WebGL前端**：Three.js实时渲染，流畅的3D交互体验

## 📁 项目结构

```
l47/
├── configs/                    # 配置文件
│   ├── config.py              # 全局配置（训练、模型、渲染参数）
│   └── __init__.py
├── models/                     # 核心模型
│   ├── flame.py               # FLAME参数化人脸模型
│   ├── encoder.py             # 图像编码器（ResNet50/SimpleCNN）
│   ├── renderer.py            # PyTorch3D可微分渲染器
│   ├── face_recon_model.py    # 完整人脸重建模型
│   └── __init__.py
├── losses/                     # 损失函数
│   ├── loss_functions.py      # 关键点、渲染、正则化损失
│   └── __init__.py
├── data/                       # 数据处理
│   ├── dataset_300wlp.py      # 300W-LP数据集加载
│   ├── preprocess.py          # 图像/关键点预处理
│   └── __init__.py
├── training/                   # 训练模块
│   ├── train.py               # 50轮训练主循环
│   └── __init__.py
├── inference/                  # 推理模块
│   ├── reconstruct.py         # 单张图片重建
│   ├── expression_transfer.py # 表情驱动/迁移
│   └── __init__.py
├── backend/                    # 后端服务
│   ├── app.py                 # Flask API服务
│   └── __init__.py
├── frontend/                   # 前端界面
│   ├── index.html             # 主页面
│   ├── css/style.css          # 样式文件
│   └── js/
│       ├── renderer.js        # Three.js WebGL渲染器
│       └── main.js            # 前端交互逻辑
├── train_model.py             # 训练入口脚本
├── run_reconstruction.py      # 重建入口脚本
├── run_expression_transfer.py # 表情迁移入口脚本
├── start_server.py            # 服务启动脚本
├── requirements.txt           # Python依赖
└── README.md                  # 本文件
```

## 🚀 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

**注意**：PyTorch3D需要根据CUDA版本单独安装，请参考[PyTorch3D安装指南](https://github.com/facebookresearch/pytorch3d/blob/main/INSTALL.md)

### 2. 模型训练

```bash
# 基础训练（50轮，默认配置）
python train_model.py

# 使用自定义参数训练
python train_model.py \
    --epochs 50 \
    --batch_size 16 \
    --lr 1e-4 \
    --dataset /path/to/300W_LP

# 使用简单CNN编码器（代替ResNet50）
python train_model.py --simple_encoder

# 从检查点继续训练
python train_model.py --resume checkpoints/epoch_20.pth
```

#### 训练配置
- **数据集**：300W-LP（自动降级为合成数据，便于测试）
- **训练轮数**：默认50轮，可通过`--epochs`调整
- **优化器**：Adam，学习率1e-4，每10轮衰减0.5倍
- **损失权重**：
  - 关键点损失：1.0
  - 渲染损失：1.0
  - 形状正则化：1e-3
  - 表情正则化：1e-3
  - 纹理正则化：1e-3
  - 姿态正则化：1e-4

### 3. 单图3D重建

```bash
# 基本重建
python run_reconstruction.py --image /path/to/face.jpg

# 生成多视角渲染
python run_reconstruction.py --image /path/to/face.jpg --num_views 16

# 使用指定检查点
python run_reconstruction.py --image /path/to/face.jpg --checkpoint checkpoints/best_model.pth
```

**输出文件**（保存在`results/`目录）：
- `{name}_comparison.png` - 原图与渲染结果对比
- `{name}_mesh.obj` - 3D网格文件（可在MeshLab中查看）
- `{name}_params.npz` - FLAME参数文件
- `{name}_landmarks.png` - 关键点可视化
- `{name}_views.png` - 多视角渲染图

### 4. 表情驱动/迁移

```bash
# 单张图片表情迁移
python run_expression_transfer.py \
    --base_image /path/to/target_face.jpg \
    --source_image /path/to/source_expression.jpg \
    --mode single

# 视频表情迁移
python run_expression_transfer.py \
    --base_image /path/to/target_face.jpg \
    --source_video /path/to/source_video.mp4 \
    --mode video \
    --fps 10

# 生成表情插值动画（中性→微笑）
python run_expression_transfer.py \
    --base_image /path/to/target_face.jpg \
    --mode morph \
    --morph_frames 60
```

### 5. 启动Web服务（带前端预览）

```bash
# 启动服务（默认端口5000）
python start_server.py

# 指定端口和检查点
python start_server.py --port 8080 --checkpoint checkpoints/best_model.pth

# 开发模式（自动重载）
python start_server.py --debug
```

启动后访问：`http://localhost:5000`

#### Web功能
- 📷 **图片上传**：拖拽或点击上传人脸图片
- 🔄 **一键重建**：点击按钮自动重建3D人脸
- 🎨 **3D预览**：WebGL实时渲染，拖拽旋转、滚轮缩放
- 😊 **表情预设**：6种预设表情（中性、微笑、悲伤、惊讶、生气、亲吻）
- 🎛️ **手动调节**：20维表情滑块实时控制
- 🎬 **视频迁移**：上传视频提取表情并迁移
- 💾 **导出功能**：导出OBJ网格、FLAME参数、当前视图

#### API接口

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/reconstruct` | 人脸重建 |
| POST | `/api/apply_expression` | 应用表情参数 |
| POST | `/api/transfer_expression_video` | 视频表情迁移 |
| POST | `/api/render_rotated` | 指定视角渲染 |
| GET | `/api/get_presets` | 获取表情预设 |
| GET | `/api/mesh` | 获取网格数据 |
| GET | `/api/params` | 获取FLAME参数 |

## 🧠 核心算法

### FLAME参数化模型
- **形状参数 (shape)**：100维，控制人脸全局形状
- **表情参数 (expr)**：50维，控制面部表情变化
- **姿态参数 (pose)**：6维，头部旋转（全局+下颌）
- **纹理参数 (tex)**：50维，皮肤纹理颜色
- **相机参数 (cam)**：3维，缩放+平移

### 损失函数

```python
总损失 = 关键点损失 + 渲染损失 + 正则化损失

关键点损失: L1距离，监督68个人脸关键点
渲染损失:   L1距离，比较渲染图像与真实图像
正则化损失: L2惩罚，防止参数过拟合
  - 形状正则化: weight = 1e-3
  - 表情正则化: weight = 1e-3
  - 纹理正则化: weight = 1e-3
  - 姿态正则化: weight = 1e-4
```

### 可微分渲染流程
1. 编码器预测FLAME参数 → 2. FLAME生成顶点和纹理 → 3. PyTorch3D构建网格 → 4. 可微分光栅化 → 5. 生成渲染图像 → 6. 计算损失并回传梯度

## 📊 训练监控

训练过程自动记录以下内容（TensorBoard）：
```bash
tensorboard --logdir logs/
```

监控指标：
- `Train/total_loss` - 总损失
- `Train/landmark_loss` - 关键点损失
- `Train/photometric_loss` - 渲染损失
- `Train/regularization_loss` - 正则化损失
- `Val/*` - 验证集对应指标
- `Comparison` - 原图与渲染结果对比图

## 🎛️ 配置说明

主要配置在 [configs/config.py](file:///e:/soloL/l47/configs/config.py) 中：

```python
# 训练参数
cfg.TRAIN.EPOCHS = 50           # 训练轮数
cfg.TRAIN.LR = 1e-4              # 学习率
cfg.TRAIN.BATCH_SIZE = 16        # 批次大小

# 模型参数
cfg.FLAME.SHAPE_DIM = 100       # 形状参数维度
cfg.FLAME.EXPR_DIM = 50         # 表情参数维度
cfg.FLAME.POSE_DIM = 6          # 姿态参数维度
cfg.FLAME.TEX_DIM = 50          # 纹理参数维度

# 损失权重
cfg.LOSS.LANDMARK_WEIGHT = 1.0
cfg.LOSS.PHOTOMETRIC_WEIGHT = 1.0
cfg.LOSS.REG_SHAPE_WEIGHT = 1e-3
cfg.LOSS.REG_EXPR_WEIGHT = 1e-3
cfg.LOSS.REG_TEX_WEIGHT = 1e-3
cfg.LOSS.REG_POSE_WEIGHT = 1e-4
```

## 📝 使用示例

### Python API使用

```python
import sys
sys.path.append('.')

from models.face_recon_model import FaceReconstructionModel
from inference.reconstruct import FaceReconstructor
from inference.expression_transfer import ExpressionTransfer

# 1. 初始化模型
model = FaceReconstructionModel(use_simple_encoder=False)

# 2. 单图重建
reconstructor = FaceReconstructor()
result = reconstructor.reconstruct_from_image('face.jpg')

# 3. 查看结果
print('顶点数:', len(result['vertices'][0]))
print('形状参数:', result['params']['shape'].shape)
print('表情参数:', result['params']['expr'].shape)

# 4. 应用表情
transfer = ExpressionTransfer()
import numpy as np
smile_expr = np.zeros(50)
smile_expr[0] = 2.0  # 微笑表情
result_with_smile = transfer.transfer_expression(result['params'], smile_expr)

# 5. 旋转视角渲染
view_30deg = model.render_rotated_view(result['params'], elev=0, azim=30)
```

## 🔧 系统要求

- **Python**: 3.8+
- **PyTorch**: 1.13+
- **PyTorch3D**: 0.7+
- **CUDA**: 推荐使用GPU加速
- **内存**: 8GB+ RAM
- **显存**: 4GB+ GPU显存（训练时）

## 📚 参考资源

- **FLAME模型**: https://flame.is.tue.mpg.de/
- **PyTorch3D**: https://pytorch3d.org/
- **300W-LP数据集**: http://www.cbsr.ia.ac.cn/users/xiangyuzhu/projects/3DDFA/main.htm
- **Three.js**: https://threejs.org/

## 🤝 常见问题

**Q: 没有FLAME模型文件怎么办？**
A: 代码会自动创建合成模型用于测试，如需真实效果请从FLAME官网下载模型并放置在 `assets/flame2020.pkl`

**Q: 没有300W-LP数据集怎么办？**
A: 数据集加载器会自动生成合成数据，可直接运行训练代码测试流程

**Q: 如何导入真实的FLAME模型？**
A: 从官网下载 `FLAME2020.pkl` 或 `generic_model.pkl`，放置在 `assets/` 目录下，代码会自动加载

**Q: 训练时显存不足怎么办？**
A: 尝试减小批次大小 `--batch_size 8`，或使用简单编码器 `--simple_encoder`

## 📄 许可证

本项目仅用于学术研究。FLAME模型和300W-LP数据集需遵循各自的使用协议。

---

⭐ 如有问题，欢迎提交Issue！
