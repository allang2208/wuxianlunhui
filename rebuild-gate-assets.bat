@echo off
chcp 65001 >nul
cd /d "E:\无尽轮回\长期备份\2026-7-13-1\game-dev"

set PYEXE=C:\Users\allan\AppData\Local\Programs\Python\Python311\python.exe
if not exist "%PYEXE%" set PYEXE=python

echo ==========================================
echo [1/2] 清理当前 bars 石柱内/外残留
echo ==========================================
"%PYEXE%" tools\clean-gate-bars-outside-pillars.py
if errorlevel 1 goto fail

echo.
echo ==========================================
echo [2/2] 重渲六档铁栅栏门并烘焙水平横杆
echo ==========================================
"%PYEXE%" tools\ai-gen\rebuild-cover-gates.py
if errorlevel 1 goto fail

echo.
echo 完成。回到游戏页面按 Ctrl+F5 强制刷新。
pause
exit /b 0

:fail
echo.
echo 执行失败，请把上方报错发回排查。
pause
exit /b 1
