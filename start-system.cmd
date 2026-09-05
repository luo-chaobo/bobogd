@echo off
title Work Order System
cd /d "%~dp0"

set "NODE="

if exist "%~dp0node\node.exe" (
  set "NODE=%~dp0node\node.exe"
)

if "%NODE%"=="" (
  if exist "C:\Users\luoch\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "NODE=C:\Users\luoch\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  )
)

if "%NODE%"=="" (
  if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE=C:\Program Files\nodejs\node.exe"
  )
)

if "%NODE%"=="" (
  for /f "delims=" %%i in ('where node 2^>nul') do (
    echo %%i | findstr /i "\\WindowsApps\\" >nul
    if errorlevel 1 (
      if "%NODE%"=="" set "NODE=%%i"
    )
  )
)

echo Starting Work Order System...
echo.

if "%NODE%"=="" (
  echo Node runtime was not found.
  echo.
  echo Please install Node.js LTS from:
  echo https://nodejs.org
  echo.
  echo After installation, double-click this file again.
  echo Please send a screenshot of this window to Codex.
  pause
  exit /b 1
)

if not exist "%~dp0server.js" (
  echo server.js was not found in:
  echo %~dp0
  echo.
  pause
  exit /b 1
)

echo Open this address after startup:
echo http://localhost:3000
echo.
echo Keep this window open. Closing it will stop the system.
echo.
"%NODE%" "%~dp0server.js"

echo.
echo The system process ended.
echo If the message above says the port is already in use, the system is probably already running.
echo Open http://localhost:3000 to check.
echo Please send a screenshot of this window to Codex.
pause
