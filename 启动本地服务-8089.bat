@echo off
setlocal
title Future Machinery Local Server - 8089

set "HOST=127.0.0.1"
set "PORT=8089"
set "ADMIN_TOKEN=local-test-admin-token-2026-123456"
set "ENABLE_WECHAT_MOCK=1"
set "ENABLE_PHONE_MOCK=1"
set "DATABASE_PATH=%TEMP%\wljixie-local\website.sqlite"
set "UPLOAD_DIR=%TEMP%\wljixie-local\uploads"

echo Starting Future Machinery local website...
echo Website: http://127.0.0.1:8089/
echo Order platform: http://127.0.0.1:8089/platform.html
echo Admin: http://127.0.0.1:8089/admin.html
echo Press Ctrl+C to stop.
echo.

set "NODE_BIN=node"
where node >nul 2>nul
if errorlevel 1 set "NODE_BIN=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not exist "%NODE_BIN%" if "%NODE_BIN%"=="node" goto run_server
if not exist "%NODE_BIN%" (
  echo Node.js 24 or newer is required.
  pause
  exit /b 1
)

:run_server
cd /d "%~dp0"
"%NODE_BIN%" src\server.js

if errorlevel 1 (
  echo.
  echo Failed to start the local server.
  pause
)
