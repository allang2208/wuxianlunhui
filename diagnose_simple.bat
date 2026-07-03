@echo off
chcp 65001 >nul
set LOG=%~dp0diagnose_log.txt

echo ===== 无限轮回诊断日志 ===== > "%LOG%"
echo 时间: %date% %time% >> "%LOG%"
echo ============================ >> "%LOG%"
echo. >> "%LOG%"

echo [1/8] 检查目录... >> "%LOG%"
echo 当前目录: >> "%LOG%"
cd >> "%LOG%"
echo. >> "%LOG%"

echo 目录内容: >> "%LOG%"
dir /b >> "%LOG%" 2>&1
echo. >> "%LOG%"

echo [2/8] 检查关键文件... >> "%LOG%"
for %%F in (vite.config.js,index.html,legacy.js,game-style.css) do (
    if exist "%%F" (
        for %%Z in (%%F) do echo [OK] %%F - %%~zZ bytes >> "%LOG%"
    ) else (
        echo [MISSING] %%F >> "%LOG%"
    )
)
echo. >> "%LOG%"

echo [3/8] 检查Node.js... >> "%LOG%"
node -v >> "%LOG%" 2>&1
echo node exit: %errorlevel% >> "%LOG%"
npm -v >> "%LOG%" 2>&1
echo npm exit: %errorlevel% >> "%LOG%"
echo. >> "%LOG%"

echo [4/8] 检查node_modules... >> "%LOG%"
if exist "node_modules" (
    echo [OK] node_modules exists >> "%LOG%"
) else (
    echo [MISSING] node_modules - need npm install >> "%LOG%"
)
echo. >> "%LOG%"

echo [5/8] 检查assets... >> "%LOG%"
if exist "assets" (
    echo [OK] assets exists >> "%LOG%"
    dir assets /b /s >> "%LOG%" 2>&1
) else (
    echo [MISSING] assets folder >> "%LOG%"
)
echo. >> "%LOG%"

echo [6/8] JS语法检查... >> "%LOG%"
node --check legacy.js >> "%LOG%" 2>&1
echo JS check exit: %errorlevel% >> "%LOG%"
echo. >> "%LOG%"

echo [7/8] 测试Vite... >> "%LOG%"
npx vite --version >> "%LOG%" 2>&1
echo Vite version exit: %errorlevel% >> "%LOG%"
echo. >> "%LOG%"

echo [8/8] 尝试启动Vite(10秒)... >> "%LOG%"
echo 启动命令: npx vite --port 8765 >> "%LOG%"
start /b cmd /c "npx vite --port 8765 --host 2>&1" > vite_tmp.log
timeout /t 8 /nobreak >nul
if exist "vite_tmp.log" (
    echo --- Vite output --- >> "%LOG%"
    type vite_tmp.log >> "%LOG%"
)
taskkill /f /im node.exe >nul 2>&1
del vite_tmp.log 2>nul
echo. >> "%LOG%"

echo === 诊断完成 === >> "%LOG%"
echo.
echo 诊断完成！
echo 请打开文件: %LOG%
echo 复制全部内容发给我。
pause
