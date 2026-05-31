@echo off
echo ========================================
echo 启动 InfluxDB (Docker)
echo ========================================
docker-compose up -d influxdb
echo.
echo InfluxDB 已启动
echo Web UI: http://localhost:8086
echo 用户名: admin
echo 密码: password123
echo 组织: eyetracker
echo 令牌: eyetracker-token
echo.
timeout /t 3
