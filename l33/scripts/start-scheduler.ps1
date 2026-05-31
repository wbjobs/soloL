$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Blender 分布式渲染系统 - 调度器" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (-not (Test-Path "node_modules")) {
    Write-Host "正在安装 Node.js 依赖..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "依赖安装失败，请检查网络连接" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "启动调度器服务器..." -ForegroundColor Green
Write-Host "HTTP/WebSocket: http://localhost:3000" -ForegroundColor Gray
Write-Host "gRPC: localhost:50051" -ForegroundColor Gray
Write-Host ""
Write-Host "按 Ctrl+C 停止服务" -ForegroundColor Yellow
Write-Host ""

node scheduler/server.js
