@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if not errorlevel 1 (
  node serve.js %*
  exit /b %errorlevel%
)

echo.
echo   Node.js was not found. Falling back to Python's web server.
echo   The musicdisk will be at http://localhost:8080/
echo.

where python >nul 2>nul
if not errorlevel 1 (
  set "PYTHON=python"
) else (
  where py >nul 2>nul
  if not errorlevel 1 (
    set "PYTHON=py -3"
  ) else (
    echo   Neither Node.js nor Python is installed.
    echo   Install one of them, or serve this folder with any static web server.
    echo.
    pause
    exit /b 1
  )
)

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://localhost:8080/'"
%PYTHON% -m http.server 8080 --bind 127.0.0.1

if errorlevel 1 (
  echo.
  echo   The Python server stopped with an error.
  echo   If port 8080 is busy, run: python -m http.server 8081 --bind 127.0.0.1
  echo.
  pause
)

endlocal
