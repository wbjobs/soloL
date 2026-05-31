# 基因序列比对分布式系统

基于Smith-Waterman算法的基因序列局部比对分布式系统。

## 系统架构

### 三大核心模块

1. **文件分片器** (File Splitter)
   - 接收FASTA格式基因序列文件
   - 按1000碱基为单位切分序列
   - 生成比对任务并发送到消息队列

2. **工作节点池** (Worker Pool)
   - 使用Go语言实现的工作节点
   - RabbitMQ进行任务分发
   - 执行Smith-Waterman局部比对算法

3. **结果聚合器** (Result Aggregator)
   - PostgreSQL存储相似度矩阵
   - 任务状态跟踪
   - 结果聚合与查询

## REST API

### 健康检查
```
GET /api/health
```

### 查询任务状态
```
GET /api/tasks/:id/status
```

响应示例:
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "progress": 65.5,
  "total_chunks": 100,
  "completed_chunks": 66
}
```

### 查询Top-K相似序列
```
GET /api/tasks/:id/top?k=10
```

响应示例:
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "count": 10,
  "results": [
    {
      "id": 1,
      "chunk_a_header": "seq1",
      "chunk_b_header": "seq2",
      "similarity_score": 186.5,
      "alignment_length": 100,
      "identity_percentage": 93.5
    }
  ]
}
```

## 快速开始

### 使用Docker Compose启动

```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps
```

### 本地开发

1. 启动依赖服务:
```bash
docker-compose up -d rabbitmq postgres
```

2. 下载依赖:
```bash
go mod download
```

3. 运行测试:
```bash
go test ./...
```

4. 启动API服务器:
```bash
go run ./cmd/api-server
```

5. 启动工作节点:
```bash
go run ./cmd/worker
```

6. 提交FASTA文件进行比对:
```bash
go run ./cmd/file-splitter -file examples/sample.fasta
```

## 目录结构

```
.
├── cmd/
│   ├── api-server/      # REST API服务
│   ├── worker/          # 工作节点
│   └── file-splitter/   # 文件分片器
├── pkg/
│   ├── config/          # 配置管理
│   ├── models/          # 数据模型
│   ├── fasta/           # FASTA文件解析
│   ├── smithwaterman/   # Smith-Waterman算法
│   ├── rabbitmq/        # RabbitMQ客户端
│   └── database/        # PostgreSQL数据库
├── scripts/             # 数据库初始化脚本
├── examples/            # 示例文件
├── docker-compose.yml
├── Dockerfile
└── go.mod
```

## Smith-Waterman算法参数

- 匹配得分: +2
- 错配罚分: -1
- 空位罚分: -1

## 技术栈

- **语言**: Go 1.21
- **消息队列**: RabbitMQ
- **数据库**: PostgreSQL 15
- **Web框架**: Gin
