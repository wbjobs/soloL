@echo off
echo ========================================
echo 量子态可视化与纠缠检测平台
echo ========================================
echo.

echo [1/3] 检查Python依赖...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo 依赖安装失败，请检查网络连接
    pause
    exit /b 1
)

echo.
echo [2/3] 启动后端服务器...
echo 后端API: http://localhost:8000
echo WebSocket: ws://localhost:8000/ws
echo API文档: http://localhost:8000/docs
echo.

cd backend
start "Quantum Backend" python app.py

echo.
echo [3/3] 启动前端服务器...
echo 前端界面: http://localhost:8080
echo.

cd ..
start "Quantum Frontend" python -m http.server 8080

echo.
echo ========================================
echo 平台已启动!
echo 请在浏览器中打开: http://localhost:8080
echo ========================================
echo.
echo 按任意键退出...
pause >nul
