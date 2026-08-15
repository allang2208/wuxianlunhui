@echo off
REM Analyze generated keyframes and AB/BC H3 videos.
set "PY=%~dp0..\..\..\ComfyUI\.venv\Scripts\python.exe"
set "RUN=%~dp0analyze-player-attack-sword.py"
"%PY%" "%RUN%" %*
