## 1. 架构设计

```mermaid
graph TD
    subgraph "前端层"
        F1["React + TypeScript"]
        F2["Tailwind CSS"]
        F3["Chart.js 可视化"]
        F4["Zustand 状态管理"]
    end

    subgraph "API网关层"
        A1["FastAPI"]
        A2["Uvicorn ASGI"]
        A3["Pydantic 验证"]
    end

    subgraph "任务队列层"
        C1["Celery"]
        C2["Redis Broker"]
        C3["结果后端"]
    end

    subgraph "计算层"
        W1["Celery Worker"]
        W2["SciPy 稀疏矩阵"]
        W3["PETSc 并行求解"]
        W4["NumPy 数值计算"]
    end

    subgraph "存储层"
        S1["Redis 缓存"]
        S2["本地文件系统"]
    end

    F1 --> A1
    A1 --> C1
    C1 --> C2
    C1 --> W1
    W1 --> W2
    W1 --> W3
    W1 --> W4
    W1 --> S2
    C1 --> S1
    A1 --> S1
```

## 2. 技术描述

- **前端**：React@18 + TypeScript + Vite + TailwindCSS@3 + Chart.js + Zustand + lucide-react
- **后端**：Python 3.11 + FastAPI@0.109 + Uvicorn
- **任务队列**：Celery@5.3 + Redis@7.2
- **数值计算**：SciPy@1.11 + NumPy@1.26 + PETSc（可选编译）
- **文件格式支持**：scipy.io.mmread 解析 Matrix Market 格式

## 3. 路由定义

| 路由 | 方法 | 用途 |
|-------|------|-------|
| / | GET | 主页 - 文件上传和求解配置 |
| /tasks | GET | 任务列表页 |
| /tasks/:id | GET | 任务详情和结果页 |
| /api/v1/upload | POST | 上传矩阵文件 |
| /api/v1/solve | POST | 提交求解任务 |
| /api/v1/tasks/:id | GET | 查询任务状态和结果 |
| /api/v1/tasks/:id/progress | GET | 获取任务实时进度 |
| /api/v1/tasks | GET | 获取所有任务列表 |
| /api/v1/matrix/:id/heatmap | GET | 获取矩阵热力图数据 |
| /api/v1/matrix/:id/stats | GET | 获取矩阵统计信息 |

## 4. API 定义

```typescript
// 矩阵文件上传
interface UploadResponse {
  matrixId: string;
  filename: string;
  shape: [number, number];
  nnz: number;
  sparsity: number;
  conditionNumber: number | null;
}

// 求解任务提交
interface SolveRequest {
  matrixId: string;
  solver: 'cg' | 'gmres' | 'superlu';
  tol: number;
  maxIter: number;
  bVector?: number[];
}

interface SolveResponse {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
}

// 任务状态
interface TaskStatus {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  currentIter: number;
  residualHistory: number[];
  elapsedTime: number;
  error?: string;
}

// 求解结果
interface SolveResult {
  taskId: string;
  solver: string;
  solveTime: number;
  iterations: number;
  finalResidual: number;
  solutionFirst10: number[];
  converged: boolean;
}

// 矩阵统计
interface MatrixStats {
  matrixId: string;
  shape: [number, number];
  nnz: number;
  sparsity: number;
  conditionNumber: number;
  rowNonzeroStats: { mean: number; std: number; max: number };
  colNonzeroStats: { mean: number; std: number; max: number };
}

// 热力图数据
interface HeatmapData {
  matrixId: string;
  rows: number;
  cols: number;
  downsampledData: { x: number; y: number; value: number }[];
  bins: { x: number; y: number; count: number }[];
}
```

## 5. 服务器架构图

```mermaid
graph TD
    subgraph "API Layer"
        R1["routes/upload.py - 文件上传"]
        R2["routes/solve.py - 求解接口"]
        R3["routes/tasks.py - 任务查询"]
        R4["routes/matrix.py - 矩阵数据"]
    end

    subgraph "Service Layer"
        S1["services/matrix_parser.py - 矩阵解析"]
        S2["services/solvers/cg.py - CG求解器"]
        S3["services/solvers/gmres.py - GMRES求解器"]
        S4["services/solvers/superlu.py - SuperLU求解器"]
        S5["services/visualization.py - 可视化生成"]
        S6["services/stats.py - 矩阵统计"]
    end

    subgraph "Task Layer"
        T1["tasks/solve_tasks.py - Celery任务"]
        T2["tasks/monitor.py - 任务监控"]
    end

    subgraph "Data Layer"
        D1["db/redis.py - Redis连接"]
        D2["storage/file_manager.py - 文件管理"]
        D3["db/models.py - 数据模型"]
    end

    R1 --> S1
    R2 --> T1
    R3 --> T2
    R4 --> S6
    S1 --> D2
    S2 --> D1
    S3 --> D1
    S4 --> D1
    T1 --> S2
    T1 --> S3
    T1 --> S4
    T1 --> D1
    T2 --> D1
    S5 --> S6
    S6 --> D2
```

## 6. 数据模型

### 6.1 数据模型定义

```mermaid
erDiagram
    MATRIX_FILE ||--o{ SOLVE_TASK : "has"
    MATRIX_FILE {
        string matrix_id PK
        string filename
        int rows
        int cols
        int nnz
        float sparsity
        float condition_number
        string file_path
        datetime uploaded_at
        string hash
    }

    SOLVE_TASK {
        string task_id PK
        string matrix_id FK
        string solver_type
        float tolerance
        int max_iterations
        string status
        int current_iteration
        float[] residual_history
        float solve_time
        int iterations
        float final_residual
        float[] solution_first_10
        boolean converged
        string error_message
        datetime created_at
        datetime started_at
        datetime completed_at
    }
```

### 6.2 数据存储结构

Redis键设计：

```
matrix:{matrix_id}           - 矩阵元数据哈希
matrix:{matrix_id}:stats     - 矩阵统计信息哈希
task:{task_id}               - 任务状态哈希
task:{task_id}:residuals     - 残差历史列表
tasks:active                 - 活跃任务集合
tasks:recent                 - 最近任务列表
```

文件系统结构：
```
uploads/
  {matrix_id}/
    matrix.mtx              - 原始矩阵文件
    matrix.npz              - 序列化稀疏矩阵
    stats.json              - 预处理统计信息
results/
  {task_id}/
    solution.npy            - 完整解向量
    residuals.json          - 残差历史
    result.json             - 求解结果摘要
```
