# RTS AI - ML Parameter Tuning System

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Unreal Engine Game                           │
│  ┌──────────────────┐    ┌────────────────────┐    ┌───────────┐  │
│  │  Behavior Tree   │◄──►│  AIController      │    │  Lua      │  │
│  └──────────────────┘    │  - Hot Reload      │    │  Scripts  │  │
│                           └────────────────────┘    └───────────┘  │
│                                    │                                │
│                                    ▼                                │
│                           ┌──────────────────┐                      │
│                           │  AIParamConfig   │                      │
│                           │  - JSON Load/Save │                      │
│                           │  - Change Listeners│                     │
│                           └──────────────────┘                      │
│                                    │                                │
│     ┌──────────────────────────────┼──────────────────────────────┐ │
│     ▼                              ▼                              ▼ │
│  ┌───────────┐               ┌───────────┐                  ┌─────────┐ │
│  │Battle Metrics│               │HTTP Server│                  │Behavior │ │
│  │SQLite DB    │               │REST API   │                  │Tree Nodes│ │
│  └─────────────┘               └───────────┘                  └─────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Offline ML Analysis                        │
│                                                                     │
│  ML/param_optimizer.py                                             │
│    - RandomForest Regression                                       │
│    - Feature Importance Analysis                                   │
│    - Parameter Optimization (Random Search + Gradient Ascent)      │
│                                                                     │
│  ML/push_params_to_unreal.py                                       │
│    - HTTP client to push optimized params back                     │
└─────────────────────────────────────────────────────────────────────┘
```

## HTTP API 接口

### 基础 URL
`http://localhost:8080`

---

### GET /api/params
获取当前所有 AI 参数

**响应示例:**
```json
{
  "AttackArmyThreshold": 5.0,
  "DefenseArmyThreshold": 3.0,
  "ResourceReserveRatio": 0.3,
  "WorkerToSoldierRatio": 2.0,
  "AggressionLevel": 0.5,
  "RetreatHealthThreshold": 0.3,
  "GatherInterval": 2.0
}
```

---

### POST /api/params
更新 AI 参数（支持热加载）

**请求体:**
```json
{
  "AttackArmyThreshold": 8.0,
  "AggressionLevel": 0.8,
  "RetreatHealthThreshold": 0.5
}
```

**响应示例:**
```json
{
  "status": "success",
  "applied": 3
}
```

---

### GET /api/metrics
获取对战统计数据

**响应示例:**
```json
{
  "total_battles": 156,
  "victories": 89,
  "defeats": 67,
  "win_rate": 0.5705
}
```

---

### GET /api/optimized
基于历史数据获取最优参数（简单加权平均）

**响应示例:**
```json
{
  "attack_army_threshold": 7.2,
  "defense_army_threshold": 4.1,
  "reserve_ratio": 0.25,
  "aggression": 0.65,
  "retreat_threshold": 0.35
}
```

---

### POST /api/reload
触发参数热加载

**响应示例:**
```json
{
  "status": "reloaded"
}
```

---

### POST /api/battle
记录对战结果

**请求体:**
```json
{
  "victory": true,
  "map_name": "Twisted Meadows",
  "duration": 485
}
```

**响应示例:**
```json
{
  "status": "recorded",
  "id": 157
}
```

---

### GET /health
健康检查

**响应示例:**
```json
{
  "status": "ok",
  "service": "rts-ai-param-server"
}
```

## 可调参数说明

| 参数名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `AttackArmyThreshold` | float | 5.0 | 发起进攻的军队规模阈值 |
| `DefenseArmyThreshold` | float | 3.0 | 防御所需最小军队规模 |
| `ResourceReserveRatio` | float | 0.3 | 资源保留比例（不用于生产） |
| `WorkerToSoldierRatio` | float | 2.0 | 理想的工人/士兵比例 |
| `BuildPriorityWeight` | float | 1.0 | 建造优先级权重 |
| `GatherPriorityWeight` | float | 1.0 | 采集优先级权重 |
| `AggressionLevel` | float | 0.5 | 进攻激进程度 (0-1) |
| `ExpansionRate` | float | 0.5 | 扩张速率偏好 (0-1) |
| `RetreatHealthThreshold` | float | 0.3 | 撤退血量阈值比例 |
| `VisionRadiusMultiplier` | float | 1.0 | 视野半径倍率 |
| `GatherInterval` | float | 2.0 | 资源采集间隔（秒） |
| `ProductionInterval` | float | 3.0 | 生产间隔（秒） |
| `BuildInterval` | float | 5.0 | 建造间隔（秒） |

## 离线 ML 分析使用方法

### 1. 安装 Python 依赖
```bash
cd ML
pip install -r requirements.txt
```

### 2. 运行参数优化
```bash
# 基础用法
python param_optimizer.py --db ../Config/battle_metrics.db

# 更多选项
python param_optimizer.py \
    --db ../Config/battle_metrics.db \
    --output ../Config/optimized_params.json \
    --iters 2000 \
    --apply  # 直接应用到配置文件
```

### 3. 推送优化参数到 Unreal
```bash
# 从优化结果文件推送
python push_params_to_unreal.py --file ../Config/optimized_params.json

# 或直接设置单个参数
python push_params_to_unreal.py --param AggressionLevel 0.9

# 查看当前参数
python push_params_to_unreal.py --get

# 查看对战统计
python push_params_to_unreal.py --metrics
```

## 完整工作流程

```
1. 游戏运行中
   ├── AI 对战自动记录到 SQLite
   └── HTTP 服务器提供实时 API

2. 收集足够数据后（推荐 ≥50 场对战）
   └── 运行 param_optimizer.py
       ├── 读取 SQLite 对战历史
       ├── 训练 RandomForest 模型
       ├── 分析参数重要性
       └── 搜索最优参数组合

3. 应用优化结果
   ├── 方案 A: push_params_to_unreal.py (HTTP 热更新)
   ├── 方案 B: SaveToJSON + 游戏内 LoadParamConfig
   └── 方案 C: 修改 Config/ai_params.json + 重启

4. 循环
   └── 新对战数据继续积累 → 再次优化 → 参数迭代
```

## 机器学习算法说明

### 模型: Random Forest Regressor
- **输入**: 10 维 AI 参数向量
- **输出**: 对战性能评分（胜利=1.0，失败=0.0，带部队比例修正）
- **样本权重**: 近期对战权重更高（指数衰减）
- **训练目标**: 预测参数组合的胜率

### 参数搜索策略
1. **随机搜索** (1000+ iterations): 全局探索
2. **梯度上升**: 基于数值梯度的局部优化
3. **取两者最佳**: 选择预测胜率最高的组合

### 特征重要性分析
自动分析哪些参数对胜率影响最大，帮助游戏设计师理解关键杠杆。

## 文件结构

```
Source/RTSGameAI/
├── Public/
│   ├── Config/AIParamConfig.h       # 参数配置系统
│   ├── ML/BattleMetricsDB.h         # SQLite 对战数据库
│   └── HTTP/AIHTTPServer.h          # HTTP API 服务器
└── Private/
    ├── Config/AIParamConfig.cpp
    ├── ML/BattleMetricsDB.cpp
    └── HTTP/AIHTTPServer.cpp

ML/
├── param_optimizer.py               # ML 参数优化脚本
├── push_params_to_unreal.py         # 参数推送客户端
└── requirements.txt                 # Python 依赖

Config/
├── ai_params.json                   # 当前参数配置
├── optimized_params.json            # ML 优化结果
└── battle_metrics.db                # SQLite 对战数据库

ThirdParty/
├── nlohmann/json.hpp                # JSON 库（单头文件）
└── httplib.h                        # HTTP 库（单头文件）
```

## 热加载实现原理

1. `AIParamConfig::SetParam()` 设置参数时标记脏位
2. 自动触发 Change Listener 回调
3. `AIController::HotReloadParams()` 读取新参数并更新运行时状态
4. 行为树节点下次 Tick 时使用新参数

```cpp
// 示例: 实时调整进攻激进程度
curl -X POST http://localhost:8080/api/params \
     -H "Content-Type: application/json" \
     -d '{"AggressionLevel": 0.9}'
```

无需重启游戏，参数立即生效。
