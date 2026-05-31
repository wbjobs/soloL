# LiDAR 家具摆放系统 - Unity桌面应用

## 项目概述

这是一个基于Unity + C#的桌面应用，用于LiDAR扫描的房屋点云数据处理和虚拟家具摆放。系统支持点云加载、ICP配准、墙面检测、家具自动放置和PDF导出等功能。

## 功能特性

### 1. 点云加载与渲染
- 支持PLY格式点云文件（ASCII和二进制）
- 高效点云渲染，支持百万级点云
- 多种着色模式：原始颜色、高度渐变、法向量、语义分割

### 2. ICP点云配准
- 迭代最近点（ICP）算法实现
- KD树加速最近邻搜索
- 奇异值分解（SVD）求解刚体变换
- 支持自动初始变换估计
- 离群点剔除机制

### 3. 墙面检测
- RANSAC平面检测算法
- 自动识别墙体平面
- 墙面法向量和边界计算
- 墙面碰撞检测

### 4. 家具摆放系统
- 支持OBJ格式家具模型加载
- 射线检测墙面碰撞
- 自动计算家具尺寸比例
- 放置预览（透明显示）
- 碰撞检测（放置有效性验证）
- 家具选择、移动、旋转操作

### 5. 渲染模式切换
- 真实感渲染模式（PBR材质）
- 线框渲染模式
- 点大小动态调整
- 元素可见性控制（点云/墙面/家具）

### 6. PDF导出功能
- 家具布局平面图生成
- 家具清单列表
- 尺寸信息标注
- 支持截图导出
- JSON数据导入导出

## 系统架构

```
Assets/
├── Scripts/
│   ├── Core/                    # 核心数据结构
│   │   ├── DataStructures.cs    # 点云、家具数据定义
│   │   └── MathExtensions.cs    # 数学扩展方法
│   ├── PointCloud/              # 点云处理
│   │   ├── PLYLoader.cs         # PLY文件加载器
│   │   ├── PointCloudRenderer.cs# 点云渲染器
│   │   └── PointCloudManager.cs # 点云管理器
│   ├── ICP/                     # 配准算法
│   │   ├── ICPRegistration.cs   # ICP配准核心算法
│   │   ├── KDTree.cs            # KD树数据结构
│   │   └── RegistrationManager.cs # 配准管理器
│   ├── Furniture/               # 家具系统
│   │   ├── OBJLoader.cs         # OBJ模型加载器
│   │   ├── FurnitureItem.cs     # 家具对象类
│   │   ├── FurnitureManager.cs  # 家具管理器
│   │   ├── WallDetector.cs      # 墙面检测器
│   │   └── PlacementController.cs # 放置控制器
│   ├── Rendering/               # 渲染系统
│   │   └── RenderManager.cs     # 渲染管理器
│   ├── Export/                  # 导出功能
│   │   ├── PDFExporter.cs       # PDF生成器
│   │   └── ExportManager.cs     # 导出管理器
│   ├── UI/                      # 界面系统
│   │   └── UIController.cs      # UI控制器
│   └── ApplicationController.cs # 应用主控制器
├── Shaders/                     # 着色器
│   ├── PointCloudShader.shader  # 点云着色器
│   ├── WireframeShader.shader   # 线框着色器
│   └── FurnitureShader.shader   # 家具着色器
├── Materials/                   # 材质预设
│   └── PointCloudMaterial.mat   # 点云材质
└── Scenes/                      # 场景文件
```

## 核心算法说明

### ICP配准算法流程
1. **数据降采样**：对源点云和目标点云进行均匀降采样
2. **初始变换**：基于点云边界框计算初始缩放和平移
3. **迭代优化**：
   - 查找对应点对（KD树加速）
   - 离群点剔除（中位数绝对偏差）
   - SVD求解最优刚体变换
   - 检查收敛条件
4. **变换应用**：将最终变换矩阵应用到源点云

### RANSAC墙面检测
1. 随机选择3个点确定平面
2. 计算所有点到平面的距离
3. 统计内点数量（距离小于阈值）
4. 重复迭代找到最佳平面
5. 使用最小二乘优化平面参数
6. 合并重叠平面

### 尺寸自动计算
1. 射线检测墙面碰撞点
2. 计算墙面法向量和边界尺寸
3. 根据家具模型原始尺寸计算缩放因子
4. 确保家具适配墙面可用空间
5. 限制缩放范围（0.1x - 5x）

## 操作指南

### 快捷键
- `Ctrl + O` - 加载点云文件
- `Ctrl + I` - 加载CAD模型
- `Ctrl + E` - 导出PDF布局
- `Ctrl + S` - 导出JSON数据
- `F1` - 运行ICP配准
- `F2` - 检测墙面
- `F3` - 切换渲染模式
- `F4` - 切换着色模式
- `F5` - 重置视角
- `F9` - 导出截图PDF
- `ESC` - 取消放置模式

### 视角控制
- `鼠标右键拖动` - 环绕观察
- `鼠标中键拖动` - 平移
- `滚轮` - 缩放

### 家具操作
- `点击家具` - 选中
- `WASD` - 移动选中家具
- `Q/E` - 旋转选中家具
- `Delete` - 删除选中家具
- `R/Q` - 放置时旋转预览
- `+/-` - 放置时调整比例

## 技术栈

- **Unity 2022.3+** - 游戏引擎
- **C# .NET Standard 2.1** - 编程语言
- **URP (Universal Render Pipeline)** - 渲染管线
- **TextMeshPro** - UI文本
- **自定义PDF生成器** - 无第三方依赖

## 项目设置

### 推荐Unity版本
- Unity 2022.3 LTS 或更高版本

### 必需包
- Universal RP (14.0.11+)
- TextMeshPro (3.0.6+)
- uGUI (1.0.0+)

### 图层设置
```
Layer 8: Furniture
Layer 9: Walls
```

### 标签设置
```
Tag: PointCloud
Tag: Furniture
Tag: Wall
```

## 文件格式支持

### 点云格式 (.ply)
- ASCII格式
- 二进制小端/大端格式
- 支持属性：x, y, z, r, g, b, red, green, blue

### 家具模型 (.obj)
- 支持OBJ几何数据
- 支持MTL材质文件
- 支持纹理映射

## 性能说明

### 点云处理
- 单帧支持：500,000 - 2,000,000 点
- ICP配准：每帧约50,000点参与计算
- 内存占用：每百万点约 32MB (顶点+颜色)

### 优化建议
1. 使用降采样减少点云密度
2. 启用视锥体剔除
3. 合理设置点大小避免过度绘制
4. 使用LOD系统管理家具模型

## 已知限制

1. ICP配准需要较好的初始对齐
2. 墙面检测对于非矩形墙体支持有限
3. PDF导出不支持复杂字体
4. 大场景点云建议分块处理

## 故障排除

### 点云加载失败
- 检查PLY文件格式是否正确
- 确认文件路径不包含特殊字符
- 查看控制台错误信息

### ICP配准效果差
- 检查CAD模型和点云的坐标系
- 调整最大对应距离参数
- 手动提供更好的初始变换

### 家具无法放置
- 检查墙面是否已正确检测
- 确认碰撞层设置正确
- 调整最小/最大缩放比例

## 开发者信息

本项目采用模块化设计，各子系统独立封装，便于扩展和维护。

### 主要类职责
- [ApplicationController](file:///e:/soloL/l36/Assets/Scripts/ApplicationController.cs) - 应用主控，协调各模块
- [PointCloudManager](file:///e:/soloL/l36/Assets/Scripts/PointCloud/PointCloudManager.cs) - 点云生命周期管理
- [RegistrationManager](file:///e:/soloL/l36/Assets/Scripts/ICP/RegistrationManager.cs) - ICP配准流程控制
- [FurnitureManager](file:///e:/soloL/l36/Assets/Scripts/Furniture/FurnitureManager.cs) - 家具对象管理
- [WallDetector](file:///e:/soloL/l36/Assets/Scripts/Furniture/WallDetector.cs) - RANSAC墙面检测
- [PlacementController](file:///e:/soloL/l36/Assets/Scripts/Furniture/PlacementController.cs) - 放置交互逻辑
- [RenderManager](file:///e:/soloL/l36/Assets/Scripts/Rendering/RenderManager.cs) - 渲染模式切换
- [ExportManager](file:///e:/soloL/l36/Assets/Scripts/Export/ExportManager.cs) - 多格式导出
- [PDFExporter](file:///e:/soloL/l36/Assets/Scripts/Export/PDFExporter.cs) - 原生PDF生成

## 更新日志

### v1.0.0 (2026-05-30)
- 初始版本发布
- 实现PLY点云加载和渲染
- 实现ICP点云配准
- 实现RANSAC墙面检测
- 实现OBJ家具加载和放置
- 实现真实感/线框渲染切换
- 实现PDF和JSON导出功能
