@echo off
setlocal

echo Initializing Ashh...

cd /d "%~dp0"

REM Check if virtual environment exists
if not exist ".venv" (
    echo Creating virtual environment...
    py -m venv .venv 2>nul || python -m venv .venv
)

REM Activate virtual environment
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
)

REM Copy .env.example to .env if not present
if not exist ".env" (
    if exist ".env.example" (
        echo Creating default .env from .env.example...
        copy .env.example .env >nul
    )
)

REM Install dependencies
echo Installing / verifying dependencies...
pip install -r requirements.txt

echo.
echo ==========================================================
echo Ashh is running at http://localhost:8000 - open it in Chrome
echo ==========================================================
echo.

REM Start uvicorn server
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

endlocal
