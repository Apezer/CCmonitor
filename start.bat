@echo off
echo ========================================
echo   CCmonitor - Claude Code Monitor
echo ========================================
echo.

cd /d "D:\AI_Project\Claude_Project\CCmonitor"

if not exist "node_modules" (
    echo [1/3] Installing dependencies...
    call npm install
    echo.
)

echo [2/3] Starting server...
start "CCmonitor" cmd /k "node server.js"

timeout /t 2 /nobreak >nul

echo [3/3] Opening browser...
start http://localhost:9090

echo.
echo Server started!
echo Browser: http://localhost:9090
echo.
echo Press any key to close this window (server keeps running)
pause >nul
