@echo off
title LLM Maze Prototype
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Please install it from https://nodejs.org then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies for the first time. This can take a minute...
  call npm install
)

if not exist ".env" (
  echo.
  echo WARNING: no .env file found.
  echo The maze will run, but the "Ask AI" hint needs an API key in .env
  echo (for example:  GEMINI_API_KEY=your-key-here  and  LLM_PROVIDER=gemini).
  echo.
)

echo.
echo Starting the maze... your browser will open in a moment.
echo Keep THIS window open while you use the app. Close it to stop.
echo.

set OPEN_BROWSER=1
node server.js

echo.
echo The maze server has stopped.
pause
