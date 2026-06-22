// 预加载脚本：在渲染进程上下文中安全暴露 Electron API
const { contextBridge, ipcRenderer } = require('electron');

// 暴露给前端的安全 API
contextBridge.exposeInMainWorld('electronAPI', {
    // 全屏控制
    toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
    exitApp: () => ipcRenderer.send('exit-app'),
    
    // 平台信息
    platform: process.platform,
    
    // 版本信息
    versions: {
        node: process.versions.node,
        electron: process.versions.electron,
        chrome: process.versions.chrome
    }
});

// 监听主进程的 ESC 指令
ipcRenderer.on('esc-pressed', () => {
    // 通知前端 ESC 被按下
    window.dispatchEvent(new CustomEvent('electron-esc'));
});

// 监听窗口全屏状态变化
ipcRenderer.on('fullscreen-changed', (event, isFullscreen) => {
    window.dispatchEvent(new CustomEvent('electron-fullscreen-change', { detail: isFullscreen }));
});
