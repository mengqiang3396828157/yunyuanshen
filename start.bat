@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   Fingertip Bloom - local server
echo.

python --version >nul 2>nul
if %errorlevel%==0 (
  python server.py --open
) else (
  py -3 server.py --open
)

if errorlevel 1 pause
