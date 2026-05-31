#!/bin/bash
echo "========================================"
echo "量子态可视化与纠缠检测平台"
echo "========================================"
echo ""

echo "[1/3] 检查Python依赖..."
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "依赖安装失败，请检查网络连接"
    exit 1
fi

echo ""
echo "[2/3] 启动后端服务器..."
echo "后端API: http://localhost:8000"
echo "WebSocket: ws://localhost:8000/ws"
echo "API文档: http://localhost:8000/docs"
echo ""

cd backend
python app.py &
BACKEND_PID=$!

echo ""
echo "[3/3] 启动前端服务器..."
echo "前端界面: http://localhost:8080"
echo ""

cd ..
python -m http.server 8080 &
FRONTEND_PID=$!

echo ""
echo "========================================"
echo "平台已启动!"
echo "请在浏览器中打开: http://localhost:8080"
echo "========================================"
echo ""
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo ""
echo "按 Ctrl+C 停止服务"

cleanup() {
    echo ""
    echo "正在停止服务..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    echo "服务已停止"
    exit 0
}

trap cleanup SIGINT
wait
