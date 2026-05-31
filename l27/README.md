# 时间序列异常检测系统

基于 Prophet 算法 + 3-Sigma 规则的时间序列异常检测系统，支持异步任务处理和 PDF 报告导出。

## 功能特性

- **数据上传**：支持 CSV 格式的时间序列数据上传
- **数据预处理**：缺失值插值、去趋势处理
- **异常检测**：Prophet 时间序列预测 + 3-Sigma 规则
- **异常分类**：点异常、上下文异常、集体异常
- **PDF 报告**：自动生成包含可视化图表的检测报告
- **异步处理**：基于 Celery 的异步任务执行

## 项目结构

```
l27/
├── app.py                      # Flask Web 应用入口
├── celery_app.py               # Celery 应用配置
├── config.py                   # 系统配置
├── requirements.txt            # Python 依赖
├── generate_test_data.py       # 测试数据生成脚本
├── app/
│   ├── __init__.py
│   ├── preprocessing.py        # 数据预处理模块
│   ├── anomaly_detector.py     # Prophet 异常检测模块
│   ├── anomaly_classifier.py   # 异常模式分类模块
│   ├── report_generator.py     # PDF 报告生成模块
│   └── tasks.py                # Celery 异步任务
├── templates/
│   └── index.html              # 前端页面
├── uploads/                    # 上传文件目录
├── results/                    # 检测结果目录
└── reports/                    # PDF 报告目录
```

## 环境要求

- Python 3.8+
- Redis 6.0+ (用于 Celery 消息队列)

## 安装步骤

1. **安装 Python 依赖**：
```bash
pip install -r requirements.txt
```

2. **启动 Redis 服务**：
```bash
# Windows: 下载并启动 Redis
# Linux/Mac:
redis-server
```

3. **启动 Celery Worker**：
```bash
celery -A celery_app.celery worker --pool=solo --loglevel=info
```

4. **启动 Flask 应用**：
```bash
python app.py
```

5. **访问应用**：
打开浏览器访问 http://localhost:5000

## 使用说明

### 1. 准备数据

CSV 文件格式要求：
- 包含时间列（默认列名 `ds`）和数值列（默认列名 `y`）
- 时间格式支持多种标准格式
- 系统会自动识别日期列和数值列

示例数据格式：
```csv
ds,y
2024-01-01,100
2024-01-02,105
2024-01-03,98
2024-01-04,110
...
```

### 2. 生成测试数据

运行测试数据生成脚本：
```bash
python generate_test_data.py
```

### 3. 上传检测

1. 访问 Web 页面
2. 点击或拖拽 CSV 文件到上传区域
3. 点击"开始检测"按钮
4. 等待检测完成
5. 下载 PDF 报告或检测结果 CSV

## API 接口

### 上传文件
```
POST /api/upload
Content-Type: multipart/form-data
```

响应：
```json
{
  "task_id": "xxx",
  "filename": "data.csv",
  "message": "File uploaded successfully. Detection task started."
}
```

### 查询任务状态
```
GET /api/task/<task_id>
```

响应：
```json
{
  "state": "SUCCESS",
  "result": {
    "anomaly_summary": {...},
    "classification_summary": {...},
    ...
  }
}
```

### 下载报告
```
GET /api/report/<task_id>
```

### 下载结果
```
GET /api/results/<task_id>
```

## 异常类型说明

### 点异常 (Point Anomaly)
- 单个孤立的异常点
- 周围数据点均为正常

### 上下文异常 (Contextual Anomaly)
- 在特定上下文中表现异常
- 考虑时间特征（小时、星期、月份等）

### 集体异常 (Collective Anomaly)
- 连续多个异常点组成的异常区域
- 通常表示系统性问题

## 配置说明

在 `config.py` 中可配置：

- `SIGMA_THRESHOLD`: 3-Sigma 阈值（默认 3）
- `CELERY_BROKER_URL`: Celery Broker 地址
- `MAX_CONTENT_LENGTH`: 最大上传文件大小
- `UPLOAD_FOLDER`: 上传文件目录

## 技术栈

- **Web 框架**: Flask
- **异步任务**: Celery + Redis
- **时间序列预测**: Prophet
- **数据处理**: Pandas, NumPy
- **PDF 生成**: ReportLab
- **可视化**: Matplotlib

## 注意事项

1. 确保 Redis 服务正常运行
2. 首次运行 Prophet 可能需要下载模型数据
3. 大文件处理可能需要较长时间
4. 建议在虚拟环境中运行
