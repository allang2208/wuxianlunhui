@echo off
REM attack_sword one-hand backhand strike: keyframe prep + H3 A->B / B->C generation.
REM Usage: run-player-attack-sword.bat [--dry-run] [--seeds 1,2,3,4] ...
set "PY=%~dp0..\..\..\ComfyUI\.venv\Scripts\python.exe"
set "RUN=%~dp0run-player-attack-sword.py"
"%PY%" "%RUN%" %*
