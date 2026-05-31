# Quantum Circuit Simulator Backend

一个基于Rust和Actix-web的量子电路模拟器后端服务。

## 功能特性

- 支持最多30个量子比特的状态向量模拟
- 使用ndarray库存储复数矩阵
- 支持的量子门：Hadamard、Pauli-X/Y/Z、CNOT、Toffoli
- 电路优化：自动合并连续单比特门
- 振幅计算和测量概率分布输出
- 结果缓存到Redis
- RESTful API接口

## 技术栈

- **Rust**: 编程语言
- **Actix-web**: Web框架
- **ndarray**: 多维数组（用于量子状态向量存储）
- **num-complex**: 复数支持
- **Redis**: 结果缓存
- **serde**: 序列化/反序列化

## 项目结构

```
src/
├── main.rs              # 服务入口
├── lib.rs               # 库导出
├── error.rs             # 错误类型定义
├── cache.rs             # Redis缓存模块
├── api.rs               # API端点定义
└── quantum/
    ├── mod.rs           # 量子模块导出
    ├── state.rs         # 量子状态向量
    ├── gates.rs         # 量子门定义和矩阵
    ├── optimizer.rs     # 电路优化器
    ├── circuit.rs       # 量子电路定义和编译
    └── simulator.rs     # 量子模拟器核心
```

## 快速开始

### 环境要求

- Rust 1.70+
- Redis (可选，用于缓存)

### 安装

```bash
# 安装Rust
rustup default stable

# 构建项目
cargo build --release
```

### 配置

复制环境变量示例文件：

```bash
cp .env.example .env
```

配置项：
- `HOST`: 服务监听地址 (默认: 127.0.0.1)
- `PORT`: 服务端口 (默认: 8080)
- `REDIS_URL`: Redis连接URL (可选)
- `RUST_LOG`: 日志级别 (默认: info)

### 运行

```bash
# 开发模式
cargo run

# 生产模式
./target/release/quantum_simulator
```

## API接口

所有接口前缀：`/api/v1`

### 1. 健康检查
```
GET /health
```

### 2. 获取支持的量子门
```
GET /gates
```

### 3. 获取电路信息
```
POST /circuit/info
Content-Type: application/json

{
  "num_qubits": 2,
  "gates": [
    {"gate_type": "H", "qubits": [0]},
    {"gate_type": "CNOT", "qubits": [0, 1]}
  ]
}
```

### 4. 编译电路
```
POST /circuit/compile
Content-Type: application/json

{
  "num_qubits": 2,
  "gates": [...],
  "use_optimization": true
}
```

### 5. 模拟电路
```
POST /circuit/simulate
Content-Type: application/json

{
  "num_qubits": 2,
  "gates": [...],
  "use_optimization": true
}
```

### 6. 测量电路
```
POST /circuit/measure
Content-Type: application/json

{
  "num_qubits": 2,
  "gates": [...],
  "shots": 1024,
  "use_optimization": true
}
```

### 7. 缓存管理
```
GET  /cache/stats    # 获取缓存统计
POST /cache/clear    # 清除缓存
```

## 量子门类型

| 门类型 | 符号 | 量子比特数 | 说明 |
|--------|------|------------|------|
| Hadamard | H | 1 | 创建叠加态 |
| Pauli-X | X | 1 | 量子NOT门 |
| Pauli-Y | Y | 1 | Pauli-Y旋转 |
| Pauli-Z | Z | 1 | 相位翻转门 |
| CNOT | CNOT | 2 | 受控NOT门 |
| Toffoli | Toffoli | 3 | 受控-受控NOT门 |

## 电路优化

优化器会自动执行以下优化：

1. **合并连续单比特门**: 将作用于同一量子比特的连续单比特门合并为一个等效门
2. **消除逆门对**: 如果两个连续门互为逆运算（如H·H = I，X·X = I），则直接消除

## 运行测试

```bash
# 运行单元测试
cargo test

# 运行API测试
./test_api.sh
```

## 性能说明

- 30个量子比特需要约8GB内存（存储2^30个复数）
- 模拟时间随量子比特数指数增长
- 启用Redis缓存可显著加速重复电路的模拟

## License

MIT
