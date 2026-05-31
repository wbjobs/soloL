# 时间线战争 (Timeline Wars)

一款局域网多人即时策略游戏，采用创新的"预录制时间线+统一模拟"玩法。

## 🎮 游戏特色

- **创新玩法**：每回合预录制未来5秒操作，所有玩家同时提交，服务器统一模拟
- **策略深度**：预判对手行动，规划时间线，体验独特的策略博弈
- **局域网对战**：支持2-4人在同一局域网对战
- **确定性模拟**：相同输入保证相同输出，无随机因子干扰
- **掉线重连**：30秒内重连可恢复完整游戏状态

## 🏗️ 技术架构

### 后端 (Go)
- **WebSocket服务器**：Gorilla WebSocket，高性能实时通信
- **状态存储**：Redis 7，高速缓存和Pub/Sub
- **序列化**：MessagePack，高效二进制序列化
- **核心模块**：
  - 房间系统：创建/加入/管理
  - 模拟引擎：确定性时间线模拟（20fps）
  - 冲突解决：攻击判定、资源争夺、建造冲突
  - 状态同步：快照+增量同步，每秒20帧
  - 重连机制：30秒掉线保护

### 前端 (Unity WebGL)
- **网络层**：WebSocket + MessagePack
- **时间轴编辑器**：可视化拖拽编辑5秒时间线
- **状态同步**：快照插值平滑渲染
- **UI系统**：赛博朋克科技风格

## 📁 项目结构

```
timeline-wars/
├── server/                     # Go后端服务
│   ├── cmd/
│   │   └── main.go            # 服务入口
│   ├── internal/
│   │   ├── room/               # 房间系统
│   │   ├── game/               # 游戏引擎
│   │   ├── simulation/         # 时间线模拟
│   │   ├── conflict/           # 冲突解决
│   │   ├── sync/               # 状态同步
│   │   ├── reconnect/          # 重连机制
│   │   ├── ws/                 # WebSocket服务
│   │   └── redis/              # Redis封装
│   ├── pkg/
│   │   └── protocol/           # 协议定义
│   ├── Dockerfile
│   ├── .env
│   └── go.mod
├── unity-client/               # Unity客户端
│   ├── Assets/
│   │   ├── Scripts/
│   │   │   ├── Network/        # WebSocket网络层
│   │   │   ├── Protocol/       # 协议定义(C#)
│   │   │   ├── Game/           # 游戏逻辑
│   │   │   ├── Sync/           # 状态同步
│   │   │   ├── Timeline/       # 时间轴编辑器
│   │   │   └── UI/             # 界面系统
│   │   └── Scenes/
│   ├── Packages/
│   └── ProjectSettings/
├── .trae/documents/
│   ├── PRD.md                  # 产品需求文档
│   └── ARCHITECTURE.md         # 技术架构文档
├── docker-compose.yml
└── README.md
```

## 🚀 快速开始

### 方式一：Docker Compose (推荐)

```bash
# 启动Redis和服务器
docker-compose up -d

# 查看日志
docker-compose logs -f server

# 停止服务
docker-compose down
```

### 方式二：本地运行

#### 前置要求
- Go 1.21+
- Redis 7.0+
- Unity 2022.3 LTS

#### 启动后端

```bash
# 1. 启动Redis
redis-server

# 2. 进入服务器目录
cd server

# 3. 复制配置
cp .env.example .env

# 4. 安装依赖
go mod download

# 5. 启动服务器
go run ./cmd/main.go
```

服务器启动后，访问 `http://localhost:8080/health` 检查健康状态。

#### 启动Unity客户端

1. 使用 Unity 2022.3 LTS 打开 `unity-client` 目录
2. 导入 MessagePack-CSharp 库
3. 打开 `Assets/Scenes/Main.unity` 场景
4. 在 Inspector 中配置服务器地址
5. 点击 Play 运行
6. 构建 WebGL 版本：File → Build Settings → WebGL → Build

### 局域网对战

1. 确保所有玩家连接到同一局域网
2. 一台电脑启动服务器（运行 `go run ./cmd/main.go`）
3. 所有玩家在浏览器中打开 WebGL 构建的游戏
4. 输入服务器局域网IP地址（例如 `ws://192.168.1.100:8080/ws`）
5. 一名玩家创建房间，其他玩家输入房间号加入

## 🎯 游戏玩法

### 基本流程

```
创建房间 → 玩家加入 → 准备 → 开始游戏
    ↑                         ↓
返回大厅 ← 结算 ← 模拟战斗 ← 提交时间线
```

### 规划阶段（30秒）
1. 选择操作类型（移动/攻击/建造）
2. 在底部时间轴上点击添加操作点
3. 拖拽操作点调整执行时间
4. 设置操作参数（目标位置、目标单位、建筑类型等）
5. 点击"提交"按钮

### 模拟阶段（5秒）
1. 所有玩家提交后，服务器统一模拟
2. 客户端按20fps播放战斗过程
3. 观察战斗结果，为下一回合做准备

### 胜利条件
- 摧毁敌方基地（1000HP）
- 敌方所有单位被消灭
- 敌方玩家全部掉线超时

## 🔧 核心算法

### 确定性模拟
```go
// 固定步长50ms（20fps）
// 相同输入 + 相同种子 = 相同输出
Simulate(initialState, timelines, 5.0) []GameState
```

### 冲突解决策略
| 冲突类型 | 解决策略 |
|---------|---------|
| 攻击冲突 | 攻击力高优先，相同则提交时间早优先 |
| 资源争夺 | 距离优先，距离相同则单位数量优先 |
| 建造冲突 | 时间线提交时间早优先 |
| 移动碰撞 | 建筑>单位，高级单位>低级单位 |

### 状态同步优化
- 关键帧（每10帧）：完整状态快照
- 中间帧：增量差值，减少带宽70%+

## 📡 协议说明

### 消息类型

| 类型ID | 名称 | 说明 |
|--------|------|------|
| 1001 | CreateRoom | 创建房间 |
| 1002 | JoinRoom | 加入房间 |
| 1003 | LeaveRoom | 离开房间 |
| 1004 | PlayerReady | 玩家准备 |
| 1005 | StartGame | 开始游戏 |
| 2001 | PlanningPhase | 规划阶段开始 |
| 2002 | TimelineSubmit | 提交时间线 |
| 2003 | SimulatePhase | 模拟阶段开始 |
| 2004 | StateSnapshot | 状态快照 |
| 2005 | GameOver | 游戏结束 |
| 3001 | Heartbeat | 心跳 |
| 3002 | Reconnect | 重连请求 |
| 3003 | FullState | 完整状态同步 |

### 消息格式

```go
type Message struct {
    Type int         // 消息类型ID
    Data []byte      // MessagePack序列化数据
}
```

## 🧪 测试

### 后端测试

```bash
cd server
go test ./... -v
```

### 集成测试

1. 启动服务器和Redis
2. 打开多个浏览器标签页
3. 模拟多个玩家连接
4. 测试房间创建、加入、游戏流程

## 🤝 开发规范

### 代码规范
- Go：遵循 `golangci-lint` 规则
- C#：遵循 Unity C# 编码规范
- 所有公共API必须有XML文档注释
- 提交前运行 `go vet` 和 `go test`

### 分支策略
- `main`：生产稳定版本
- `develop`：开发分支
- `feature/*`：功能分支
- `hotfix/*`：紧急修复

## 📄 许可证

MIT License

## 📞 技术支持

如有问题，请查看：
- [PRD文档](.trae/documents/PRD.md)
- [技术架构文档](.trae/documents/ARCHITECTURE.md)
- 或提交 Issue

---

**享受时间线策略的乐趣！** 🎮✨
