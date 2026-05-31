$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Blender 分布式渲染系统 - 渲染节点" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$schedulerAddr = "localhost:50051"
if ($args.Count -gt 0) {
    $schedulerAddr = $args[0]
}

$blenderPath = "blender"
if ($args.Count -gt 1) {
    $blenderPath = $args[1]
}

Write-Host "调度器地址: $schedulerAddr" -ForegroundColor Gray
Write-Host "Blender 路径: $blenderPath" -ForegroundColor Gray
Write-Host ""

if (-not (Test-Path "node\proto\render_pb2.py")) {
    Write-Host "正在生成 gRPC Python 代码..." -ForegroundColor Yellow
    python -m grpc_tools.protoc --proto_path=proto --python_out=node/proto --grpc_python_out=node/proto proto/render.proto
    if ($LASTEXITCODE -ne 0) {
        Write-Host "gRPC 代码生成失败" -ForegroundColor Red
        exit 1
    }
}

$env:SCHEDULER_ADDRESS = $schedulerAddr
$env:BLENDER_PATH = $blenderPath

Write-Host "启动渲染节点..." -ForegroundColor Green
Write-Host "按 Ctrl+C 停止服务" -ForegroundColor Yellow
Write-Host ""

python node/render_node.py
