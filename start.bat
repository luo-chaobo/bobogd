@echo off
setlocal
set "NODE_BIN=node"
where node >nul 2>nul
if errorlevel 1 set "NODE_BIN=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%NODE_BIN%" (
  echo Node.js 24 or newer is required.
  exit /b 1
)
if "%ADMIN_TOKEN%"=="" (
  echo Set ADMIN_TOKEN before starting the website.
  exit /b 1
)
cd /d "%~dp0"
"%NODE_BIN%" src\server.js
