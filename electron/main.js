const { app, BrowserWindow, screen, ipcMain, globalShortcut } = require('electron');
const path = require('path');

// 全局窗口引用
let mainWindow = null;
let isFullScreen = true;

function createWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        minWidth: 800,
        minHeight: 600,
        // 无边框窗口
        frame: false,
        // 允许调整尺寸
        resizable: true,
        // 初始全屏（无边框模式下全屏=最大化无标题栏）
        fullscreen: true,
        // 全屏模式类型：无边框全屏
        fullscreenable: true,
        // 窗口图标
        icon: path.join(__dirname, '../build/app-icon.ico'),
        // 安全：禁用远程模块，隔离上下文
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        // 标题
        title: '无限轮回',
        // 背景色（加载前显示）
        backgroundColor: '#0a0a0a',
        // 启动时显示（加载完成后显示）
        show: false
    });

    // 加载应用
    const isDev = process.env.NODE_ENV === 'development';
    
    if (isDev) {
        // 开发模式：加载 Vite 开发服务器
        mainWindow.loadURL('http://localhost:5173');
        // 自动打开 DevTools
        // mainWindow.webContents.openDevTools();
    } else {
        // 生产模式：加载构建后的静态文件
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // 页面加载完成后显示窗口（避免白屏闪烁）
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 窗口关闭时清理引用
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // 记录全屏状态变化
    mainWindow.on('enter-full-screen', () => { isFullScreen = true; });
    mainWindow.on('leave-full-screen', () => { isFullScreen = false; });

    return mainWindow;
}

// IPC 通信：处理前端发来的全屏切换和退出请求
ipcMain.on('toggle-fullscreen', () => {
    if (mainWindow) {
        if (mainWindow.isFullScreen()) {
            mainWindow.setFullScreen(false);
            isFullScreen = false;
        } else {
            mainWindow.setFullScreen(true);
            isFullScreen = true;
        }
    }
});

ipcMain.on('exit-app', () => {
    app.quit();
});

// 应用生命周期
app.whenReady().then(() => {
    createWindow();

    // 注册 ESC 全局快捷键：全屏↔窗口 切换
    globalShortcut.register('Escape', () => {
        if (mainWindow) {
            if (mainWindow.isFullScreen()) {
                // 全屏 → 退出全屏（窗口模式）
                mainWindow.setFullScreen(false);
                isFullScreen = false;
            } else if (mainWindow.isMaximized()) {
                // 窗口模式（最大化）→ 退出游戏
                app.quit();
            } else {
                // 普通窗口 → 退出游戏
                app.quit();
            }
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    // 退出前注销全局快捷键
    globalShortcut.unregisterAll();
});

// 导出供 preload 使用
module.exports = { createWindow, mainWindow };
