# 基因序列比对可视化系统

基于Vue3 + Three.js + FastAPI + Celery的基因序列比对系统，支持大文件分块上传、Smith-Waterman算法比对、3D Hilbert曲线可视化。

## 技术栈

### 前端
- **Vue 3** - 渐进式JavaScript框架
- **Three.js** - 3D图形渲染库
- **Element Plus** - UI组件库
- **Pinia** - 状态管理
- **Vue Router** - 路由管理
- **Axios** - HTTP客户端
- **SparkMD5** - 文件哈希计算
- **Vite** - 构建工具

### 后端
- **FastAPI** - 高性能Python Web框架
- **Celery** - 分布式任务队列
- **RabbitMQ** - 消息队列
- **Redis** - 缓存和消息中间件
- **PostgreSQL** - 关系型数据库
- **SQLAlchemy** - ORM框架
- **NumPy** - 数值计算
- **BioPython** - 生物信息学工具库
- **AIOFiles** - 异步文件操作

## 功能特性

- ✅ **大文件分块上传** - 支持最大512MB的FASTA文件，断点续传
- ✅ **Smith-Waterman算法** - 局部序列比对，支持自定义计分参数
- ✅ **分布式任务处理** - Celery + RabbitMQ支持多节点并行计算
- ✅ **实时进度推送** - WebSocket实时推送比对进度
- ✅ **中间结果缓存** - Redis缓存进度和结果
- ✅ **3D可视化** - Hilbert空间填充曲线展示相似度热图
- ✅ **差异位点标记** - 红色小球标记错配位点，橙色标记空位
- ✅ **交互式控制** - 可调节显示参数，支持旋转缩放
- ✅ **结果持久化** - PostgreSQL存储比对结果

## 项目结构

```
l3/
├── backend/                    # 后端代码
│   ├── app/
│   │   ├── algorithms/         # 核心算法
│   │   │   ├── smith_waterman.py    # Smith-Waterman比对算法
│   │   │   └── hilbert.py           # 3D Hilbert曲线生成
│   │   ├── routers/            # API路由
│   │   │   ├── upload.py           # 文件上传接口
│   │   │   ├── alignment.py        # 比对任务接口
│   │   │   └── websocket.py        # WebSocket接口
│   │   ├── utils/              # 工具函数
│   │   │   └── fasta_parser.py      # FASTA文件解析
│   │   ├── __init__.py
│   │   ├── config.py           # 配置管理
│   │   ├── database.py         # 数据库连接
│   │   ├── models.py           # 数据模型
│   │   ├── schemas.py          # Pydantic模式
│   │   ├── redis_client.py     # Redis客户端
│   │   ├── celery_app.py       # Celery应用
│   │   ├── tasks.py            # Celery任务
│   │   ├── ws_manager.py       # WebSocket管理器
│   │   └── main.py             # FastAPI主应用
│   ├── uploads/                # 上传文件目录（自动创建）
│   ├── requirements.txt        # Python依赖
│   ├── .env                    # 环境变量
│   ├── run_api.py              # API服务启动脚本
│   ├── run_ws.py               # WebSocket服务启动脚本
│   └── run_worker.py           # Celery Worker启动脚本
│
├── frontend/                   # 前端代码
│   ├── src/
│   │   ├── components/         # 组件
│   │   │   ├── FileUploader.vue     # 文件上传组件
│   │   │   └── HilbertCurve3D.vue   # 3D Hilbert曲线组件
│   │   ├── views/              # 页面视图
│   │   │   ├── UploadView.vue       # 上传页面
│   │   │   ├── TasksView.vue        # 任务列表页面
│   │   │   └── VisualizationView.vue # 可视化页面
│   │   ├── router/             # 路由配置
│   │   ├── stores/             # Pinia状态管理
│   │   ├── utils/              # 工具函数
│   │   │   ├── api.js              # API客户端
│   │   │   ├── websocket.js        # WebSocket客户端
│   │   │   └── chunkUpload.js      # 分块上传工具
│   │   ├── App.vue             # 根组件
│   │   ├── main.js             # 入口文件
│   │   └── style.css           # 全局样式
│   ├── package.json            # Node依赖
│   ├── vite.config.js          # Vite配置
│   └── index.html              # HTML入口
│
└── docker-compose.yml          # Docker服务编排
```

## 快速开始

### 1. 启动基础设施服务

```bash
docker-compose up -d
```

这将启动以下服务：
- PostgreSQL (端口: 5432)
- RabbitMQ (端口: 5672, 管理界面: 15672)
- Redis (端口: 6379)

### 2. 启动后端服务

#### 安装Python依赖
```bash
cd backend
pip install -r requirements.txt
```

#### 启动API服务
```bash
python run_api.py
```
API文档: http://localhost:8000/docs

#### 启动WebSocket服务（新终端）
```bash
cd backend
python run_ws.py
```

#### 启动Celery Worker（新终端）
```bash
cd backend
python run_worker.py
```

或者使用celery命令直接启动多个worker：
```bash
celery -A app.celery_app worker --loglevel=info --concurrency=4 -P threads
```

### 3. 启动前端服务

#### 安装Node依赖
```bash
cd frontend
npm install
```

#### 启动开发服务器
```bash
npm run dev
```
前端地址: http://localhost:3000

## 使用说明

### 1. 上传文件
1. 访问 http://localhost:3000
2. 在"文件上传"页面，选择两个FASTA格式的基因文件
3. 文件会自动分块上传，支持断点续传
4. 上传完成后会显示文件信息（序列名、长度等）

### 2. 开始比对
1. 确认两个文件都已上传完成
2. 设置比对参数（匹配得分、错配罚分、空位罚分）
3. 点击"开始序列比对"按钮
4. 实时查看比对进度

### 3. 查看3D可视化
1. 比对完成后，点击"查看3D可视化结果"按钮
2. 或直接访问"3D可视化"页面选择任务
3. 交互操作：
   - 鼠标左键拖动：旋转视角
   - 鼠标滚轮：缩放
   - 鼠标右键拖动：平移
   - 悬停在点上：查看该区域相似度信息
4. 控制面板：
   - 显示/隐藏曲线、热图点、差异标记
   - 调节曲线粗细、点大小、标记大小
   - 自动旋转、重置视角

### 4. 颜色说明
- **绿色** (90%-100%)：高相似度区域
- **黄绿色** (70%-90%)：较高相似度
- **黄色** (50%-70%)：中等相似度
- **橙色** (30%-50%)：较低相似度
- **红色** (0%-30%)：低相似度区域
- **红色发光小球**：错配位点
- **橙色发光小球**：空位位点

## API接口

### 文件上传
- `POST /api/upload/chunk` - 上传文件块
- `GET /api/upload/check/{file_id}` - 检查上传状态
- `GET /api/upload/{file_id}` - 获取文件信息
- `GET /api/upload/` - 获取文件列表

### 序列比对
- `POST /api/alignment/start` - 启动比对任务
- `GET /api/alignment/progress/{task_id}` - 获取任务进度
- `GET /api/alignment/tasks` - 获取任务列表
- `GET /api/alignment/result/{task_id}` - 获取比对结果

### WebSocket
- `WS /api/ws/{task_id}` - 实时接收进度更新

## 测试数据

可以使用以下命令生成测试FASTA文件：

```bash
# 生成随机DNA序列
python -c "
import random
bases = ['A', 'T', 'G', 'C']
seq1 = ''.join(random.choice(bases) for _ in range(5000))
seq2 = list(seq1)
# 引入一些突变
for i in range(50):
    pos = random.randint(0, len(seq2)-1)
    seq2[pos] = random.choice(bases)
seq2 = ''.join(seq2)

with open('test1.fasta', 'w') as f:
    f.write('>seq1_test\\n' + seq1 + '\\n')
with open('test2.fasta', 'w') as f:
    f.write('>seq2_test\\n' + seq2 + '\\n')
"
```

## 性能优化建议

1. **多Worker部署**：根据CPU核数启动多个Celery Worker
2. **序列分段**：对于超长序列（>10000bp），考虑分段比对
3. **结果压缩**：长序列的比对结果可以压缩存储
4. **索引优化**：为数据库表添加适当的索引
5. **CDN加速**：静态资源使用CDN加速

## 注意事项

1. 大文件比对可能需要较长时间，请耐心等待
2. 建议序列长度控制在10000bp以内以获得较好的交互体验
3. 长时间运行的任务会自动保存进度，刷新页面不会丢失
4. 差异位点较多时，可适当调小标记大小以获得更好的视觉效果

## 许可证

MIT License
