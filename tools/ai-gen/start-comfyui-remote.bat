@echo off
rem Start ComfyUI listening on all interfaces (0.0.0.0:8188) for LAN access.
rem Place this file next to main.py (inside the ComfyUI folder), then double-click.
if exist "%~dp0ComfyUI\main.py" (
    cd /d "%~dp0ComfyUI"
) else (
    cd /d "%~dp0"
)
echo Starting ComfyUI on 0.0.0.0:8188 ...
echo Keep this window open. Closing it stops ComfyUI.
echo.
".venv\Scripts\python.exe" main.py --listen 0.0.0.0 --port 8188
pause
