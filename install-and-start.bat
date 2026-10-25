@echo off
title SH Protection Shield V6.3
cd /d "%~dp0"
echo [1/3] Installing/rebuilding dependencies for this Windows PC...
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed.
  pause
  exit /b 1
)
echo [2/3] Checking JavaScript...
call npm run check
if errorlevel 1 (
  echo.
  echo Syntax check failed.
  pause
  exit /b 1
)
if not exist ".env" (
  echo [3/3] .env is missing.
  echo Copy .env.example to .env and add your own credentials, then run npm start.
  pause
  exit /b 0
)
echo [3/3] Starting SH Protection Shield...
call npm start
pause
