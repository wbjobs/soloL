@echo off
echo ========================================
echo 启动前端服务
echo ========================================
echo.
echo 访问地址: http://localhost:3000
echo.
cd frontend
npx http-server -p 3000 -c-1
