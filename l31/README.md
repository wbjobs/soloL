# MIDI 可视化与协作标注平台

一个全栈Web应用，支持MIDI文件上传、解析、可视化和多人实时协作标注。

## 功能特性

- **MIDI 文件解析**: 自动解析音符、轨道、节拍、速度信息
- **3D 音符可视化**: 使用 Three.js 展示三维音符柱状图时间轴
- **频谱瀑布图**: 生成音频频谱可视化图像
- **实时协作标注**: 通过 WebSocket 实现多人实时标注和弦进行、旋律动机等
- **JSON 导出**: 支持将标注结果导出为 JSON 文件
- **多轨道支持**: 独立控制各轨道的显示/隐藏

## 技术栈

### 后端
- Python 3.9+
- FastAPI - Web 框架
- MongoDB - 数据存储
- mido - MIDI 文件解析
- NumPy/SciPy - 信号处理
- Matplotlib - 频谱图生成

### 前端
- React 18
- Three.js - 3D 渲染
- Zustand - 状态管理
- Axios - HTTP 客户端
- Vite - 构建工具

## 项目结构

```
l31/
├── backend/
│   ├── main.py              # FastAPI 主应用
│   ├── midi_parser.py       # MIDI 解析模块
│   ├── spectrum.py          # 频谱图生成
│   ├── websocket_manager.py # WebSocket 连接管理
│   ├── models.py            # 数据模型
│   ├── requirements.txt     # Python 依赖
│   └── .env                 # 环境变量
└── frontend/
    ├── src/
    │   ├── components/      # React 组件
    │   │   ├── MidiUpload.jsx
    │   │   ├── MidiList.jsx
    │   │   ├── ThreeJSVisualizer.jsx
    │   │   ├── SpectrumView.jsx
    │   │   └── AnnotationPanel.jsx
    │   ├── services/        # API 和 WebSocket 服务
    │   ├── store/           # Zustand 状态管理
    │   ├── styles/          # CSS 样式
    │   ├── App.jsx
    │   └── main.jsx
    ├── index.html
    ├── package.json
    └── vite.config.js
```

## 安装与运行

### 前置要求
- Python 3.9+
- Node.js 18+
- MongoDB 4.4+

### 1. 启动 MongoDB

确保 MongoDB 服务正在运行，或使用 Docker：

```bash
docker run -d -p 27017:27017 --name mongodb mongo:4.4
```

### 2. 安装后端依赖

```bash
cd backend
pip install -r requirements.txt
```

### 3. 启动后端服务

```bash
cd backend
python main.py
```

后端服务将在 `http://localhost:8000` 启动。

API 文档: `http://localhost:8000/docs`

### 4. 安装前端依赖

```bash
cd frontend
npm install
```

### 5. 启动前端开发服务器

```bash
cd frontend
npm run dev
```

前端应用将在 `http://localhost:5173` 启动。

## API 接口

### MIDI 文件管理
- `POST /api/midi/upload` - 上传 MIDI 文件
- `GET /api/midi` - 获取 MIDI 文件列表
- `GET /api/midi/{midi_id}` - 获取 MIDI 详细信息
- `GET /api/midi/{midi_id}/spectrum` - 获取频谱数据
- `DELETE /api/midi/{midi_id}` - 删除 MIDI 文件

### 标注管理
- `POST /api/annotations` - 创建标注
- `GET /api/annotations/{midi_id}` - 获取标注列表
- `PUT /api/annotations/{annotation_id}` - 更新标注
- `DELETE /api/annotations/{annotation_id}` - 删除标注

### 导出
- `GET /api/export/{midi_id}` - 获取导出数据
- `GET /api/export/{midi_id}/download` - 下载 JSON 文件

### WebSocket
- `ws://localhost:8000/ws/{midi_id}?user_id={user_id}&username={username}` - 实时协作连接

## 使用说明

1. **上传 MIDI 文件**: 点击左侧上传区域或拖拽 MIDI 文件
2. **选择文件**: 从文件列表中选择要查看的 MIDI
3. **3D 视图**: 使用鼠标旋转、缩放查看三维音符柱状图
   - 左键拖动: 旋转视角
   - 滚轮: 缩放
   - 右键拖动: 平移
   - 空白处拖动: 控制播放位置
4. **频谱视图**: 切换到频谱瀑布图查看音频频率分布
5. **添加标注**: 在右侧面板填写标注信息，支持多种标注类型
6. **实时协作**: 多人同时打开同一 MIDI 文件时可以看到彼此的光标和标注
7. **导出数据**: 点击"导出标注为 JSON"按钮下载标注结果

## 标注类型

- **和弦进行**: 标记和弦序列（如 C-G-Am-F）
- **旋律动机**: 标记重要的旋律片段
- **节奏型**: 标记特殊的节奏模式
- **其他**: 自定义标注类型

## 多人协作

- 在线用户列表显示当前查看同一文件的所有用户
- 可以看到其他用户的实时光标位置
- 标注的创建、更新、删除会实时同步给所有用户
