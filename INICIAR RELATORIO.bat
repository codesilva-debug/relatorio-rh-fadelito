@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 ou superior precisa estar instalado.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:3470"
node server.js
pause
