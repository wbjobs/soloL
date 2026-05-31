@echo off
echo ========================================
echo 启动眼动仪后端服务
echo ========================================
echo.
echo HTTP API: http://localhost:3001
echo UDP 端口: 8000
echo WebSocket: ws://localhost:8080
echo.
cd backend
node src/server.js
