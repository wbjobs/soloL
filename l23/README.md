# P2P Torrent Hub - P2P文件分发平台

基于WebTorrent协议的P2P文件分发系统，使用Vue3 + FastAPI + Redis技术栈。

## 功能特性

- **文件分块上传**：自动分块（256KB/块），SHA-256校验确保数据完整性
- **自动种子生成**：上传完成后自动生成.torrent文件和Magnet链接
- **WebTorrent P2P下载**：浏览器端点对点下载，多节点互传加速
- **Tracker服务**：基于Redis的节点追踪器，维护节点列表
- **实时速度统计**：ECharts实时图表展示下载/上传速度、节点连接趋势
- **分块校验可视化**：网格热力图直观展示各分块下载与校验状态

## 技术架构

### 前端
- Vue 3 + TypeScript + Vite
- Tailwind CSS（深蓝科技风主题）
- ECharts（实时图表）
- WebTorrent（P2P协议，CDN加载）
- Lucide Vue Next（图标）

### 后端
- FastAPI (Python 3.11+)
- Redis（节点列表存储）
- 内置HTTP Tracker服务
- 文件分块存储 + SHA-256校验

## 目录结构

```
l23/
├── api/                          # 后端FastAPI
│   ├── app/
│   │   ├── main.py               # 应用入口
│   │   ├── config.py             # 配置
│   │   ├── models/schemas.py     # Pydantic模型
│   │   ├── routers/              # API路由
│   │   │   ├── upload.py
│   │   │   ├── files.py
│   │   │   ├── tracker.py
│   │   │   └── stats.py
│   │   └── services/
│   │       └── services.py       # 核心服务
│   ├── storage/                  # 文件存储
│   │   ├── chunks/               # 分块文件
│   │   └── torrents/             # torrent文件
│   └── requirements.txt
├── src/                          # 前端Vue3
│   ├── components/               # 组件
│   ├── composables/              # 组合式函数
│   ├── pages/                    # 页面
│   ├── types/                    # 类型定义
│   └── utils/                    # 工具函数
├── start-backend.bat             # Windows启动后端
└── start-backend.sh              # macOS/Linux启动后端
```

## 快速开始

### 前置要求

1. **Redis**：确保Redis服务运行在 `localhost:6379`
2. **Python 3.11+**
3. **Node.js 18+**

### 启动后端

```bash
# Windows
start-backend.bat

# macOS/Linux
bash start-backend.sh
```

后端API文档：http://localhost:8000/docs

### 启动前端

```bash
npm install
npm run dev
```

前端地址：http://localhost:5173

## 使用说明

### 1. 上传文件（文件管理页）
- 拖拽或点击上传文件
- 系统自动分块并计算SHA-256哈希
- 每块上传后后端校验哈希一致性
- 上传完成自动生成.torrent和Magnet链接

### 2. P2P下载（P2P下载页）
- 输入Magnet链接或上传.torrent文件
- WebTorrent自动连接Tracker获取节点
- 多节点并行下载，各节点同时互相上传
- 实时显示进度、速度、连接节点数
- 分块校验网格可视化展示

### 3. 数据统计（数据统计页）
- 下载/上传速度实时折线图
- 节点连接数趋势图
- 总下载/上传量、峰值速度等统计
- 文件传输概览表

## API接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/upload` | 上传分块 |
| POST | `/api/upload/complete` | 完成上传并生成种子 |
| GET | `/api/files` | 获取文件列表 |
| GET | `/api/torrent/{file_id}` | 下载.torrent文件 |
| GET | `/api/chunk/{file_id}/{index}` | 下载分块 |
| GET | `/api/stats/{file_id}` | 获取统计数据 |
| GET | `/tracker/announce` | Tracker节点宣告 |

## 核心数据结构（Redis）

```
peers:{info_hash}  -> Hash  { peer_id: {ip, port, last_seen} }
file:{file_id}     -> Hash  { file_name, total_size, total_chunks, ... }
chunks:{file_id}   -> Hash  { chunk_index: chunk_hash }
```

## 设计特点

- **深蓝科技风UI**：霓虹蓝+紫色高亮，毛玻璃卡片，发光效果
- **分块校验**：每块独立SHA-256校验，确保数据完整性
- **Tracker协议**：兼容标准BitTorrent Tracker HTTP协议
- **实时更新**：ECharts图表每秒刷新，展示真实传输数据
- **P2P做种**：下载完成自动做种，持续为网络贡献带宽
