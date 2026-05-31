@echo off
echo ========================================
echo P2P File Distribution - Backend Server
echo ========================================
echo.
echo Checking Python dependencies...
echo.

cd /d "%~dp0api"

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed. Please install Python 3.11+.
    pause
    exit /b 1
)

where pip >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] pip is not available.
    pause
    exit /b 1
)

echo Installing Python dependencies...
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

echo.
echo ========================================
echo Starting FastAPI server on port 8000...
echo ========================================
echo.
echo API Base URL: http://localhost:8000
echo API Docs:     http://localhost:8000/docs
echo Tracker URL:  http://localhost:8000/tracker/announce
echo.
echo Make sure Redis is running on localhost:6379
echo.

python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

pause
