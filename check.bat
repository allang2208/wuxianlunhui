@echo off
set LOG=check_log.txt

echo ===== 无限轮回检查 ===== > %LOG%
echo 时间: %date% %time% >> %LOG%
echo ========================= >> %LOG%
echo. >> %LOG%

echo [1] 当前目录 >> %LOG%
cd >> %LOG%
echo. >> %LOG%

echo [2] 文件清单 >> %LOG%
dir /b >> %LOG% 2>&1
echo. >> %LOG%

echo [3] 文件大小 >> %LOG%
for %%F in (index.html,legacy.js,game-style.css,vite.config.js) do (
    if exist "%%F" (
        for %%Z in (%%F) do echo OK %%F = %%~zZ bytes >> %LOG%
    ) else (
        echo MISSING %%F >> %LOG%
    )
)
echo. >> %LOG%

echo [4] Node.js >> %LOG%
node -v >> %LOG% 2>&1
echo node err=%errorlevel% >> %LOG%
echo. >> %LOG%

echo [5] npm >> %LOG%
npm -v >> %LOG% 2>&1
echo npm err=%errorlevel% >> %LOG%
echo. >> %LOG%

echo [6] node_modules >> %LOG%
if exist node_modules (echo OK node_modules exists >> %LOG%) else (echo MISSING node_modules >> %LOG%)
echo. >> %LOG%

echo [7] assets >> %LOG%
if exist assets (
    echo OK assets exists >> %LOG%
    dir /b assets >> %LOG%
) else (
    echo MISSING assets >> %LOG%
)
echo. >> %LOG%

echo === DONE === >> %LOG%

:: 显示结果
cls
echo ===== 检查完成 =====
echo.
type %LOG%
echo.
echo 日志已保存到: %cd%\%LOG%
echo.
pause
