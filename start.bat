@echo off
chcp 65001 >nul
title 无限轮回 - 启动器
echo ============================================
echo   无限轮回 - 一键启动工具
echo ============================================
echo.

:: 检查当前目录下是否有 vite.config.js
echo [1/4] 检查项目目录...
if not exist "vite.config.js" (
    echo.
    echo [错误] 当前目录不是有效的项目目录！
    echo.
    echo 请将本文件放到以下目录后再双击运行：
    echo C:\Users\allan\Desktop\kimi\游戏\测试版本\备份-测试版本\Kimi_Agent_武器动画与尺寸调整\
    echo.
    pause
    exit /b 1
)
echo       项目目录检查通过。

:: 检查是否安装了 Node.js
echo [2/4] 检查 Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [错误] 未检测到 Node.js！
    echo.
    echo 请先安装 Node.js：
    echo 1. 访问 https://nodejs.org
    echo 2. 下载左侧的绿色 "LTS" 版本
    echo 3. 双击安装，一直点 "下一步"
    echo 4. 安装完成后，关闭本窗口，重新双击运行
    echo.
    start https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%a in ('node -v') do echo       Node.js 版本: %%a

:: 检查是否需要安装依赖
echo [3/4] 检查项目依赖...
if not exist "node_modules" (
    echo       正在安装依赖（首次运行，可能需要几分钟）...
    call npm install
    if errorlevel 1 (
        echo.
        echo [错误] 依赖安装失败！
        pause
        exit /b 1
    )
) else (
    echo       依赖已安装。
)

:: 启动 Vite
echo [4/4] 启动开发服务器...
echo.
echo ============================================
echo   服务器启动后，请按提示的地址访问
echo   通常地址是: http://localhost:8765/
echo ============================================
echo.

:: 启动 Vite 并打开浏览器
npx vite --open

:: 如果 Vite 退出，暂停显示信息
echo.
echo 服务器已停止。
pause
