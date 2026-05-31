#!/bin/bash
echo "========================================"
echo "P2P File Distribution - Backend Server"
echo "========================================"
echo ""

cd "$(dirname "$0")/api"

echo "Installing Python dependencies..."
pip install -r requirements.txt

echo ""
echo "========================================"
echo "Starting FastAPI server on port 8000..."
echo "========================================"
echo ""
echo "API Base URL: http://localhost:8000"
echo "API Docs:     http://localhost:8000/docs"
echo "Tracker URL:  http://localhost:8000/tracker/announce"
echo ""
echo "Make sure Redis is running on localhost:6379"
echo ""

python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
