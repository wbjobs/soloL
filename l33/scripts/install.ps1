$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Blender 分布式渲染系统 - 安装" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "1. 安装 Node.js 依赖..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "Node.js 依赖安装失败" -ForegroundColor Red
} else {
    Write-Host "Node.js 依赖安装完成" -ForegroundColor Green
}

Write-Host ""
Write-Host "2. 安装 Python 依赖..." -ForegroundColor Yellow
pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "Python 依赖安装失败" -ForegroundColor Red
} else {
    Write-Host "Python 依赖安装完成" -ForegroundColor Green
}

Write-Host ""
Write-Host "3. 生成 gRPC 代码..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path node/proto | Out-Null
python -m grpc_tools.protoc --proto_path=proto --python_out=node/proto --grpc_python_out=node/proto proto/render.proto
if ($LASTEXITCODE -ne 0) {
    Write-Host "gRPC 代码生成失败" -ForegroundColor Red
} else {
    Write-Host "gRPC 代码生成完成" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  安装完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "使用方法：" -ForegroundColor White
Write-Host "  1. 启动调度器: .\scripts\start-scheduler.ps1" -ForegroundColor Gray
Write-Host "  2. 启动渲染节点: .\scripts\start-node.ps1 [调度器地址] [Blender路径]" -ForegroundColor Gray
Write-Host "  3. 打开浏览器: http://localhost:3000" -ForegroundColor Gray
Write-Host ""
