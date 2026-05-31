@echo off
echo ========================================
echo 启动眼动数据模拟器
echo ========================================
echo.
set /p pattern="选择模式 (reading/random/horizontal/circular) [reading]: "
if "%pattern%"=="" set pattern=reading

set /p duration="持续时间(秒), 0为无限 [0]: "
if "%duration%"=="" set duration=0

set /p rate="采样率(Hz) [250]: "
if "%rate%"=="" set rate=250

echo.
echo 模式: %pattern%, 时长: %duration%s, 采样率: %rate%Hz
echo.
cd backend
if "%duration%"=="0" (
    node src/simulator.js --pattern %pattern% --rate %rate%
) else (
    node src/simulator.js --pattern %pattern% --duration %duration% --rate %rate%
)
