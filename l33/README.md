# Blender 分布式渲染系统

基于 gRPC 的分布式 Blender 渲染调度系统，支持多台 Windows 节点并行渲染。

## 功能特性

- 📁 **拖拽上传**: 支持拖拽 .blend 场景文件上传
- 🎬 **自动拆帧**: 自动将动画场景拆分为单帧渲染任务
- ⚡ **优先级队列**: 支持紧急任务插队（优先级 1-10）
- 🖥️ **多节点调度**: 自动分发任务到可用渲染节点
- 📊 **硬件监控**: 节点上报 GPU 型号、显存等硬件信息
- 📈 **实时进度**: Web 界面实时展示渲染进度和预计完成时间
- 🎥 **视频打包**: 结果帧自动打包为 MP4 下载
- 🔄 **失败重试**: 任务失败自动重试（最多 3 次）

## 系统架构

```
┌─────────────┐     gRPC     ┌─────────────┐
│  Web 前端   │─────────────▶│  调度器     │
└─────────────┘              └──────┬──────┘
        ▲                           │
        │                           │
        │                    ┌──────▼──────┐
        │                    │ 优先级队列  │
        │                    └──────┬──────┘
        │                           │
        │              ┌────────────┼────────────┐
        │              │            │            │
   Socket.IO      ┌────▼───┐   ┌────▼───┐   ┌────▼───┐
        │         │ 渲染节点 │   │ 渲染节点 │   │ 渲染节点 │
        │         └────┬────┘   └────┬────┘   └────┬────┘
        │              │            │            │
        └──────────────┴────────────┴────────────┘
                     实时进度上报
```

## 快速开始

### 环境要求

- Node.js 16+
- Python 3.9+
- Blender 3.0+ (需添加到系统 PATH)
- FFmpeg (可选，用于视频编码)

### 安装

```powershell
.\scripts\install.ps1
```

或手动安装：

```powershell
# 安装 Node.js 依赖
npm install

# 安装 Python 依赖
pip install -r requirements.txt

# 生成 gRPC 代码
python -m grpc_tools.protoc --proto_path=proto --python_out=node/proto --grpc_python_out=node/proto proto/render.proto
```

### 启动服务

#### 1. 启动调度器

```powershell
.\scripts\start-scheduler.ps1
```

调度器启动后：
- Web 界面: http://localhost:3000
- gRPC 服务: localhost:50051

#### 2. 启动渲染节点

```powershell
# 本地节点（连接本机调度器）
.\scripts\start-node.ps1

# 远程节点（指定调度器地址）
.\scripts\start-node.ps1 "192.168.1.100:50051" "C:\Program Files\Blender Foundation\Blender 3.6\blender.exe"
```

#### 3. 开始使用

打开浏览器访问 http://localhost:3000

## 使用说明

### 提交渲染任务

1. **上传文件**: 拖拽 .blend 文件到上传区域，或点击选择文件
2. **设置参数**:
   - 任务名称
   - 优先级（1-10，数值越高优先级越高）
   - 起始帧/结束帧
   - 分辨率
   - 渲染引擎（Cycles/EEVEE）
   - 采样数
   - 帧率
3. **提交任务**: 点击"开始渲染"按钮

### 优先级队列

- 优先级范围: 1（最低）- 10（最高）
- 高优先级任务会插队到队列前面
- 相同优先级按提交时间排序

### 查看任务状态

- **任务列表**: 展示所有任务的进度和状态
- **节点状态**: 查看已连接的渲染节点及其硬件信息
- **任务详情**: 点击任务卡片查看每帧的渲染状态

### 下载结果

任务完成后：
1. 点击任务卡片查看详情
2. 点击"下载 MP4"按钮下载渲染结果

## 项目结构

```
blender-distributed-render/
├── proto/                  # gRPC 协议定义
│   └── render.proto
├── scheduler/              # 调度器服务
│   ├── server.js          # 主服务入口
│   ├── job-manager.js     # 任务管理
│   ├── node-manager.js    # 节点管理
│   ├── priority-queue.js  # 优先级队列
│   └── video-encoder.js   # 视频编码
├── node/                   # 渲染节点
│   ├── render_node.py     # 节点主程序
│   ├── render_worker.py   # 渲染执行器
│   ├── hardware_info.py   # 硬件信息收集
│   └── proto/             # gRPC Python 代码
├── web/                    # Web 前端
│   └── public/
│       ├── index.html
│       ├── style.css
│       └── app.js
├── scripts/                # 启动脚本
│   ├── install.ps1
│   ├── start-scheduler.ps1
│   └── start-node.ps1
├── uploads/                # 上传的场景文件
├── renders/                # 渲染中间结果
├── output/                 # 最终输出视频
├── config.js               # 配置文件
├── package.json
└── requirements.txt
```

## API 接口

### REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/jobs | 提交渲染任务 |
| GET | /api/jobs | 获取所有任务 |
| GET | /api/jobs/:jobId | 获取任务详情 |
| POST | /api/jobs/:jobId/encode | 触发视频编码 |
| GET | /api/jobs/:jobId/download | 下载结果视频 |
| GET | /api/nodes | 获取所有节点 |
| GET | /api/queue | 获取任务队列 |

### gRPC 服务

详见 [proto/render.proto](proto/render.proto)

- `RegisterNode`: 节点注册
- `Heartbeat`: 心跳检测
- `GetTask`: 获取任务
- `ReportTaskProgress`: 上报进度
- `ReportTaskComplete`: 任务完成
- `ReportTaskFailed`: 任务失败

## 配置说明

编辑 `config.js` 修改配置：

```javascript
{
  scheduler: {
    host: '0.0.0.0',      // gRPC 监听地址
    port: 50051,           // gRPC 端口
    httpPort: 3000         // HTTP/WebSocket 端口
  },
  blender: {
    path: 'blender',       // Blender 路径
    defaultEngine: 'CYCLES',
    defaultResolution: { x: 1920, y: 1080 }
  },
  task: {
    maxRetries: 3,         // 最大重试次数
    timeoutMs: 300000      // 超时时间（5分钟）
  }
}
```

## 常见问题

### 1. 节点无法连接调度器？

- 检查防火墙设置，确保 50051 端口开放
- 确认调度器地址正确
- 检查网络连通性

### 2. Blender 命令找不到？

- 将 Blender 添加到系统 PATH
- 或启动节点时指定 Blender 完整路径

### 3. 无法生成 MP4？

- 确保已安装 FFmpeg 并添加到 PATH
- 帧图片在 `renders/{jobId}/frames/` 目录下，可手动编码

### 4. 任务一直处于等待状态？

- 检查是否有渲染节点已连接
- 确认节点状态为 "online"

## 许可证

MIT License
