# WebRTC + TensorFlow.js AI Avatar Application

一个基于WebRTC和TensorFlow.js的AI应用，支持浏览器端实时人像分割、背景替换和3D虚拟形象驱动。

## 功能特性

### 1. 实时人像分割与背景替换
- 使用MediaPipe Selfie Segmentation进行实时人像分割
- 支持多种背景模式：
  - 原始背景（无处理）
  - 模糊背景（可调节模糊程度）
  - 图片背景（内置3张高质量背景图）
  - 视频背景（可扩展）

### 2. 3D虚拟形象驱动
- 使用MediaPipe Face Mesh捕获53个blendshapes表情参数
- 驱动Three.js加载的GLB 3D模型
- 支持多虚拟形象切换（默认3个内置头像）
- 实时表情同步：眨眼、微笑、皱眉等

### 3. WebSocket信令与房间管理
- Socket.io实时通信
- 房间创建与加入
- 房间用户列表同步
- 背景素材实时同步

### 4. 性能监控
- 实时FPS显示
- 各模块推理耗时统计（分割、面部、渲染）
- 性能指标颜色编码（绿色=优秀，黄色=良好，红色=需优化）

### 5. 用户配置存储
- MongoDB存储用户偏好配置
- 自动保存选择的虚拟形象和背景设置

## 技术栈

### 前端
- **框架**: React 18 + TypeScript
- **构建工具**: Vite
- **AI/ML**: 
  - MediaPipe Selfie Segmentation
  - MediaPipe Face Mesh
- **3D渲染**: Three.js + GLTFLoader
- **实时通信**: Socket.io Client

### 后端
- **服务器**: Express.js
- **数据库**: MongoDB + Mongoose
- **实时通信**: Socket.io
- **跨域**: CORS

## 性能目标

- 分辨率: 1080p (1920x1080)
- 帧率: 30 FPS
- 推理总耗时: < 33ms / 帧

## 项目结构

```
webrtc-ai-avatar/
├── client/                    # 前端应用
│   ├── src/
│   │   ├── components/        # React组件
│   │   │   ├── AvatarViewer.tsx    # 3D虚拟形象渲染器
│   │   │   └── PerformanceMonitor.tsx  # 性能监控面板
│   │   ├── hooks/             # 自定义Hooks
│   │   │   ├── useCamera.ts        # 摄像头捕获
│   │   │   ├── useFaceMesh.ts      # Face Mesh表情捕获
│   │   │   ├── useSelfieSegmentation.ts  # 人像分割
│   │   │   ├── usePerformance.ts   # 性能监控
│   │   │   ├── useSocket.ts        # WebSocket通信
│   │   │   └── useConfig.ts        # 用户配置
│   │   ├── types/             # TypeScript类型定义
│   │   ├── styles/            # 全局样式
│   │   ├── App.tsx            # 主应用组件
│   │   └── main.tsx           # 应用入口
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
├── server/                    # 后端服务
│   ├── src/
│   │   ├── models/            # MongoDB模型
│   │   │   └── UserConfig.js
│   │   ├── socket/            # Socket.io处理器
│   │   │   └── handlers.js
│   │   └── index.js           # 服务器入口
│   ├── package.json
│   └── .env
├── package.json               # 根目录配置
└── README.md
```

## 快速开始

### 前置要求

- Node.js >= 16.0.0
- MongoDB >= 4.4 (本地运行或使用MongoDB Atlas)

### 安装依赖

```bash
# 安装根目录依赖
npm install

# 安装后端依赖
cd server && npm install

# 安装前端依赖
cd ../client && npm install
```

### 配置环境变量

编辑 `server/.env` 文件：

```env
PORT=3001
MONGODB_URI=mongodb://localhost:27017/webrtc-ai-avatar
NODE_ENV=development
```

### 启动MongoDB

确保MongoDB服务正在运行：

```bash
# Windows (如果已安装为服务)
net start MongoDB

# 或使用Docker
docker run -d -p 27017:27017 mongo
```

### 启动应用

```bash
# 方式1：同时启动前后端（根目录）
npm run dev

# 方式2：分别启动
# 终端1 - 启动后端
cd server && npm run dev

# 终端2 - 启动前端
cd client && npm run dev
```

### 访问应用

打开浏览器访问: `http://localhost:5173`

## 使用说明

### 1. 允许摄像头权限
首次访问时，请允许浏览器访问摄像头。

### 2. 背景效果控制
- **原始**: 显示原始摄像头画面
- **模糊**: 背景模糊效果，可通过滑块调节模糊程度
- **图片1/2/3**: 预设的高质量风景背景

### 3. 虚拟形象选择
- 点击右侧面板的头像缩略图切换虚拟形象
- 表情会实时同步到3D模型

### 4. 加入房间
- 在顶部输入框输入房间号
- 按回车或点击"加入房间"按钮
- 房间内用户可看到彼此的背景更新

### 5. 性能监控
- 右上角实时显示FPS和各模块耗时
- 绿色: 优秀 (<16ms), 黄色: 良好 (<33ms), 红色: 需优化 (>33ms)

## BlendShapes 参数说明

支持53个面部表情参数：

| 类别 | 参数 |
|------|------|
| 眼部 | eyeBlinkLeft, eyeBlinkRight, eyeWideLeft, eyeWideRight, eyeSquintLeft/Right |
| 嘴部 | jawOpen, mouthClose, mouthSmileLeft/Right, mouthFrownLeft/Right, mouthPucker |
| 眉毛 | browInnerUp, browOuterUpLeft/Right, browDownLeft/Right |
| 脸颊 | cheekPuff, cheekSquintLeft/Right |
| 鼻子 | noseSneerLeft/Right |
| 头部 | headYaw, headPitch |
| 其他 | 其余混合形状参数 |

## 扩展开发

### 添加新的虚拟形象

1. 将GLB模型文件放到 `client/public/models/` 目录
2. 在 `AvatarViewer.tsx` 的 `AVATAR_MODELS` 数组中添加配置：

```typescript
{
  id: 'custom',
  name: '自定义形象',
  url: '/models/custom-avatar.glb',
  thumbnail: '/thumbnails/custom.jpg'
}
```

### 添加自定义背景

在 `App.tsx` 的 `BACKGROUND_IMAGES` 数组中添加图片URL。

### 性能优化建议

1. **降低分辨率**: 如需更高帧率，可将摄像头分辨率降至720p
2. **关闭不必要的功能**: 如不需要面部追踪，可临时禁用
3. **使用WebGL加速**: 确保浏览器启用了硬件加速
4. **模型优化**: 使用轻量化的GLB模型

## 浏览器兼容性

- Chrome/Edge 90+ (推荐)
- Firefox 88+
- Safari 14+

注意：MediaPipe的性能在Chromium系浏览器中表现最佳。

## 已知问题

1. 部分GLB模型可能不包含morph targets，表情同步可能不生效
2. 首次加载MediaPipe模型可能需要几秒时间
3. 在低配置设备上可能无法达到30fps@1080p

## License

MIT
