@echo off
echo ========================================
echo 眼动仪数据平台 - 一键启动
echo ========================================
echo.

echo [1/4] 启动 InfluxDB...
docker-compose up -d influxdb
timeout /t 5 /nobreak >nul

echo.
echo [2/4] 启动后端服务 (新窗口)...
start "Eye Tracker Backend" cmd /k "cd backend && node src/server.js"
timeout /t 3 /nobreak >nul

echo.
echo [3/4] 启动前端服务 (新窗口)...
start "Eye Tracker Frontend" cmd /k "cd frontend && npx http-server -p 3000 -c-1"
timeout /t 3 /nobreak >nul

echo.
echo [4/4] 启动数据模拟器 (新窗口)...
start "Eye Tracker Simulator" cmd /k "cd backend && node src/simulator.js --pattern reading"

echo.
echo ========================================
echo 所有服务已启动!
echo ========================================
echo.
echo 前端: http://localhost:3000
echo 后端API: http://localhost:3001
echo InfluxDB: http://localhost:8086 (admin/password123)
echo.
echo 按任意键停止所有服务...
pause >nul

echo.
echo 正在停止服务...
docker-compose down
taskkill /FI "WINDOWTITLE eq Eye Tracker*" /F >nul 2>&1
echo 服务已停止
