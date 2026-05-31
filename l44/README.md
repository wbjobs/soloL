# 量子态可视化与实时纠缠检测平台

基于四元数插值的量子态可视化科学计算平台，支持多量子比特纠缠态构建与实时纠缠检测。

## 功能特性

### 量子计算核心
- 量子态矢量的四元数表示与Bloch球面投影
- 支持最多5个量子比特的纠缠态构建
- 内置量子门：Hadamard、CNOT、Pauli-X/Y/Z
- 预设状态：Bell态（Φ⁺、Φ⁻、Ψ⁺、Ψ⁻）、GHZ态（3-5量子比特）

### 纠缠检测
- **PPT准则**（部分转置准则）：检测2-qubit及更高维系统的纠缠
- **Concurrence计算**：量化2-qubit系统的纠缠程度
- **Negativity/Log-Negativity**：多体系统纠缠度量
- **冯诺依曼熵**与**互信息**计算
- 约化密度矩阵分析

### 四元数插值
- 基于四元数球面线性插值（SLERP）
- 可视化量子态在Bloch球面上的平滑演化
- 支持自定义插值步数（10-200步）
- 实时动画展示插值路径

### 前端3D交互
- Three.js实现的高质量Bloch球面渲染
- 鼠标拖拽旋转视角
- 滚轮缩放
- 点击Bloch球面创建量子态
- 显示坐标、四元数、密度矩阵等详细信息

### 后端架构
- **NumPy + SciPy** 科学计算
- **Numba** JIT编译加速核心算法
- **FastAPI** 提供REST API接口
- **WebSocket** 实时数据推送
- **SQLite** 存储计算历史记录

## 项目结构

```
l44/
├── backend/                    # Python后端
│   ├── quantum_core.py        # 量子态与量子门核心
│   ├── entanglement_detection.py  # 纠缠检测模块
│   ├── quantum_optimized.py   # Numba加速优化
│   ├── database.py            # SQLite数据库
│   └── app.py                 # FastAPI + WebSocket服务器
├── frontend/                   # 前端界面
│   ├── index.html             # 主页面
│   ├── css/
│   │   └── style.css          # 样式文件
│   └── js/
│       ├── bloch_sphere.js    # Three.js Bloch球渲染
│       └── app.js             # 主应用逻辑
├── requirements.txt           # Python依赖
├── package.json               # Node.js依赖（可选）
├── run.bat                    # Windows启动脚本
└── start.sh                   # Linux/Mac启动脚本
```

## 快速开始

### 方式一：使用启动脚本（推荐）

**Windows:**
```bash
run.bat
```

**Linux/Mac:**
```bash
chmod +x start.sh
./start.sh
```

### 方式二：手动启动

1. **安装Python依赖**
```bash
pip install -r requirements.txt
```

2. **启动后端服务器**
```bash
cd backend
python app.py
```

3. **启动前端服务器**（新终端）
```bash
python -m http.server 8080
```

4. **访问平台**
打开浏览器访问: http://localhost:8080

## API接口

### REST API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/` | API信息 |
| POST | `/api/state` | 创建/操作用子态 |
| POST | `/api/entanglement` | 检测纠缠 |
| POST | `/api/interpolate` | 四元数插值 |
| POST | `/api/bloch` | 从Bloch坐标创建态 |
| GET | `/api/bell/{type}` | 创建Bell态 |
| GET | `/api/ghz/{n}` | 创建GHZ态 |
| GET | `/api/history` | 获取历史记录 |
| DELETE | `/api/history/{id}` | 删除历史记录 |
| GET | `/api/saved-states` | 获取保存的状态 |
| POST | `/api/saved-states` | 保存状态 |
| GET | `/api/stats` | 获取统计信息 |

### WebSocket

连接地址: `ws://localhost:8000/ws`

支持的消息类型:
- `set_qubits` - 设置量子比特数
- `apply_gate` - 应用量子门
- `detect_entanglement` - 检测纠缠
- `interpolate` - 执行插值
- `get_bell` - 获取Bell态
- `get_ghz` - 获取GHZ态
- `reset` - 重置状态
- `ping` - 心跳检测

## 核心算法说明

### 四元数表示
单量子比特态 |ψ⟩ = α|0⟩ + β|1⟩ 可以映射为Bloch球面上的点：
- θ = 2·arccos(|α|)
- φ = arg(β/α)

对应的四元数为：
- q = [cos(θ/2), sin(θ/2)cos(φ), sin(θ/2)sin(φ), sin(θ/2)sin(θ)]

### 球面线性插值（SLERP）
在两个四元数 q₁ 和 q₂ 之间插值：
- q(t) = [sin((1-t)θ)/sin(θ)]·q₁ + [sin(tθ)/sin(θ)]·q₂
- 其中 θ = arccos(q₁·q₂)

### PPT准则
对于2×2维系统，部分转置后出现负本征值则为纠缠态。
- Negativity = Σ max(-λᵢ, 0)
- Log-Negativity = log₂(2·Negativity + 1)

### Concurrence
对于2-qubit系统，Concurrence C ∈ [0,1]：
- C = max(0, √λ₁ - √λ₂ - √λ₃ - √λ₄)
- 其中λᵢ是R = √(ρ)ρ̃√(ρ)的本征值降序排列
- ρ̃ = (σᵧ⊗σᵧ)ρ*(σᵧ⊗σᵧ)

## 技术栈

### 后端
- Python 3.8+
- NumPy - 数值计算
- SciPy - 线性代数
- Numba - JIT编译加速
- FastAPI - Web框架
- Uvicorn - ASGI服务器
- SQLite - 数据库

### 前端
- Three.js - 3D渲染
- 原生JavaScript ES6+
- WebSocket - 实时通信

## 使用示例

### 1. 创建Bell态并检测纠缠
```python
import requests
import json

# 创建Bell态
response = requests.get('http://localhost:8000/api/bell/phi+')
state = response.json()
print(f"是否纠缠: {state['entanglement']['is_entangled']}")
print(f"Concurrence: {state['entanglement']['concurrence']['concurrence']:.4f}")
```

### 2. 量子态插值
```python
import requests

data = {
    "state1": {"n_qubits": 1, "state_vector": [[1, 0], [0, 0]]},
    "state2": {"n_qubits": 1, "state_vector": [[0, 0], [1, 0]]},
    "steps": 50,
    "qubit_index": 0
}

response = requests.post('http://localhost:8000/api/interpolate', json=data)
interp = response.json()
print(f"插值步数: {len(interp['interpolation'])}")
```

### 3. WebSocket实时交互
```javascript
const ws = new WebSocket('ws://localhost:8000/ws');

ws.onopen = () => {
    // 应用Hadamard门
    ws.send(JSON.stringify({
        action: 'apply_gate',
        data: { gate_type: 'H', target_qubit: 0 }
    }));
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('态更新:', data.bloch_spheres);
};
```

## 性能优化

- **Numba JIT编译**：核心算法加速5-20倍
- **批量矩阵运算**：向量化操作避免Python循环
- **WebSocket推送**：减少HTTP轮询开销
- **SQLite索引**：历史记录查询优化
- **Three.js LOD**：Bloch球渲染性能优化

## 开发说明

### 添加新的量子门
在 `backend/quantum_core.py` 的 `QuantumGate` 类中添加静态方法，并在 `QuantumState` 类中添加对应的 `apply_*` 方法。

### 添加新的纠缠判据
在 `backend/entanglement_detection.py` 中实现检测函数，并在 `detect_entanglement()` 中集成。

### 前端扩展
- `frontend/js/bloch_sphere.js` - Bloch球渲染类
- `frontend/js/app.js` - 应用逻辑与WebSocket交互

## 许可证

MIT License

## 参考文献

1. Peres, A. (1996). Separability criterion for density matrices.
2. Wootters, W. K. (1998). Entanglement of formation of an arbitrary state of two qubits.
3. Vidal, G., & Werner, R. F. (2002). Computable measure of entanglement.
4. Nielsen, M. A., & Chuang, I. L. (2010). Quantum computation and quantum information.
