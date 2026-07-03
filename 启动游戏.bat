@echo off
chcp 65001 >nul
cls
echo.
echo   ============================================
echo    无限轮回 - 启动工具
echo   ============================================
echo.

:: 检查是否安装了 Node.js
where node >nul 2>nul
if errorlevel 1 (
    echo   [错误] 未检测到 Node.js！
    echo.
    echo   请按以下步骤安装：
    echo   1. 打开浏览器访问 https://nodejs.org
    echo   2. 点击左侧绿色的 "LTS" 按钮下载
    echo   3. 双击下载的安装包，一直点"下一步"
    echo   4. 安装完成后关闭此窗口，重新双击本文件
    echo.
    start https://nodejs.org
    pause
    exit /b 1
)

:: 显示 Node.js 版本
for /f "tokens=*" %%a in ('node -v') do echo   Node.js 版本: %%a
for /f "tokens=*" %%a in ('npm -v') do echo   npm 版本: %%a
echo.

:: 检查 node_modules 是否存在
if not exist "node_modules" (
    echo   [首次运行] 正在安装依赖，请等待...
    npm install
    if errorlevel 1 (
        echo   [安装失败] 正在尝试使用国内镜像...
        npm config set registry https://registry.npmmirror.com
        npm install
        if errorlevel 1 (
            echo   [错误] 依赖安装失败，请检查网络连接
            pause
            exit /b 1
        )
    )
    echo   [完成] 依赖安装成功！
    echo.
)

:: 检查 Vite 是否安装
if not exist "node_modules\.bin\vite.cmd" (
    echo   [安装 Vite]...
    npm install vite --save-dev
    echo.
)

:: 启动 Vite 并打开浏览器
echo   [启动游戏服务器]...
echo   如果浏览器没有自动打开，请手动访问 http://localhost:5173/
echo   按 Ctrl+C 可以停止服务器
echo.
echo   ============================================
echo.

npx vite --port 5173 --open

:: Vite 退出后暂停
echo.
echo   服务器已停止。
pause
