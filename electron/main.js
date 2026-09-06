const { app, BrowserWindow, screen, ipcMain, dialog, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { configureFixedTest } = require('./fixed-test');
const fixedTest = configureFixedTest({ app, protocol, net });

// 禁用 Windows 系统 DPI 缩放，确保游戏内坐标一致
app.commandLine.appendSwitch('force-device-scale-factor', '1');

// 全局窗口引用
let mainWindow = null;
let isFullScreen = true;
const VITE_DEV_URL = 'http://localhost:5173';
const DIST_INDEX_PATH = path.join(__dirname, '../dist/index.html');

function isDevelopmentMode() {
    // 打包 EXE 永不因继承 NODE_ENV=development 而连接 Vite。
    if (app.isPackaged) return false;
    if (process.env.NODE_ENV === 'production') return false;
    return process.env.NODE_ENV === 'development' || !app.isPackaged;
}

function loadMainPage(targetWindow, mode = isDevelopmentMode() ? 'vite' : 'dist') {
    if (fixedTest) return targetWindow.loadURL(fixedTest.url);
    return mode === 'vite'
        ? targetWindow.loadURL(VITE_DEV_URL)
        : targetWindow.loadFile(DIST_INDEX_PATH);
}

function sendBackgroundState() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const background = !mainWindow.isFocused() || mainWindow.isMinimized() || !mainWindow.isVisible();
    mainWindow.webContents.send('background-changed', background);
}

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
            // 与前端默认开启一致；页面初始化后应用其已保存的后台运行选项。
            backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.js'),
            zoomFactor: 1.0
        },
        // 标题
        title: fixedTest ? `无限轮回 · 固定测试版 ${fixedTest.release.id}` : '无限轮回',
        // 背景色（加载前显示）
        backgroundColor: '#0a0a0a',
        // 启动时显示（加载完成后显示）
        show: false
    });

    // 未打包版本优先连接 Vite；若 Vite 不存在但已有 dist，只允许单向回退一次。
    let mainPageMode = isDevelopmentMode() ? 'vite' : 'dist';
    let viteDistFallbackAttempted = false;
    let loadRecoveryAttempted = false;
    let loadFailureDialogShown = false;
    loadMainPage(mainWindow, mainPageMode)
        .catch(err => console.error('[main] Initial page load failed:', err));
    // 自动打开 DevTools
    // mainWindow.webContents.openDevTools();

    // 页面加载完成后显示窗口（避免白屏闪烁）
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 窗口关闭时清理引用
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // 关闭节流会改变 Page Visibility API；单独转发真实窗口状态。
    for (const event of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide']) {
        mainWindow.on(event, sendBackgroundState);
    }

    // 只转发本窗口的 ESC，不占用系统全局按键，也不与渲染层 keydown 重复处理。
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key !== 'Escape') return;
        event.preventDefault();
        if (input.type === 'keyDown' && !input.isAutoRepeat) {
            mainWindow.webContents.send('esc-pressed');
        }
    });

    // 渲染进程崩溃/加载失败恢复：崩溃后状态本已丢失，弹窗提示并重载回首页
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error('[main] Renderer process gone:', details.reason);
        if (details.reason === 'clean-exit') return;
        dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: '游戏崩溃',
            message: '游戏运行出现异常，即将重新加载。',
            buttons: ['重新加载'],
        }).then(() => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
        }).catch(err => console.error('[main] crash dialog failed:', err));
    });
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc, _validatedURL, isMainFrame) => {
        console.error('[main] Failed to load page:', errorCode, errorDesc);
        // -3 = ERR_ABORTED（主动导航中断）；子 frame 失败不应重载整页。
        if (!mainWindow || mainWindow.isDestroyed() || errorCode === -3 || isMainFrame === false) return;
        if (mainPageMode === 'vite' && !viteDistFallbackAttempted && fs.existsSync(DIST_INDEX_PATH)) {
            viteDistFallbackAttempted = true;
            mainPageMode = 'dist';
            loadRecoveryAttempted = false;
            setTimeout(() => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    loadMainPage(mainWindow, 'dist')
                        .catch(err => console.error('[main] dist fallback failed:', err));
                }
            }, 150);
            return;
        }
        // 当前入口只重试一次；dist 失败后绝不跳回 Vite，避免双向恢复循环。
        if (loadRecoveryAttempted) return;
        loadRecoveryAttempted = true;
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                loadMainPage(mainWindow, mainPageMode).catch((err) => {
                    console.error('[main] Page recovery failed:', err);
                    if (loadFailureDialogShown || !mainWindow || mainWindow.isDestroyed()) return;
                    loadFailureDialogShown = true;
                    mainWindow.show();
                    dialog.showMessageBox(mainWindow, {
                        type: 'error',
                        title: '页面加载失败',
                        message: mainPageMode === 'vite' && !fs.existsSync(DIST_INDEX_PATH)
                            ? '未检测到 Vite 开发服务器，且 dist/index.html 不存在。请先启动开发服务器或执行构建。'
                            : '游戏页面加载失败，请检查 dist 文件或开发服务器。',
                        buttons: ['确定'],
                    }).catch(dialogError => console.error('[main] load dialog failed:', dialogError));
                });
            }
        }, 500);
    });

    // 记录并转发全屏状态变化（渲染进程设置界面"全屏切换"按钮文案同步）
    mainWindow.on('enter-full-screen', () => {
        isFullScreen = true;
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('fullscreen-changed', true);
    });
    mainWindow.on('leave-full-screen', () => {
        isFullScreen = false;
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('fullscreen-changed', false);
    });
    // 启动就绪后同步一次当前全屏状态（初始 fullscreen:true 不保证触发 enter-full-screen）
    mainWindow.webContents.on('did-finish-load', () => {
        loadRecoveryAttempted = false;
        loadFailureDialogShown = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('fullscreen-changed', mainWindow.isFullScreen());
            sendBackgroundState();
        }
    });

    return mainWindow;
}

// IPC 通信：处理前端发来的全屏切换和退出请求
ipcMain.handle('get-test-release', () => fixedTest ? fixedTest.release : null);

function getWeaponConfigPaths() {
    const isDev = isDevelopmentMode();
    if (isDev) {
        return {
            read: path.join(__dirname, '../public/data/weapon-anim-config.json'),
            write: path.join(__dirname, '../public/data/weapon-anim-config.json'),
            mirror: path.join(__dirname, '../data/weapon-anim-config.json')
        };
    }
    const userDataPath = path.join(app.getPath('userData'), 'weapon-anim-config.json');
    return {
        read: fs.existsSync(userDataPath) ? userDataPath : path.join(__dirname, '../dist/data/weapon-anim-config.json'),
        write: userDataPath
    };
}

ipcMain.handle('load-weapon-config', async () => {
    const paths = getWeaponConfigPaths();
    try {
        const data = await fs.promises.readFile(paths.read, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('[main] Failed to load weapon config:', err);
        throw err;
    }
});

ipcMain.handle('save-weapon-config', async (_event, config) => {
    const paths = getWeaponConfigPaths();
    try {
        const serialized = JSON.stringify(config, null, 2);
        await fs.promises.mkdir(path.dirname(paths.write), { recursive: true });
        await fs.promises.writeFile(paths.write, serialized, 'utf8');
        if (paths.mirror) {
            await fs.promises.mkdir(path.dirname(paths.mirror), { recursive: true });
            await fs.promises.writeFile(paths.mirror, serialized, 'utf8');
        }
        return { success: true, path: paths.write };
    } catch (err) {
        console.error('[main] Failed to save weapon config:', err);
        throw err;
    }
});

// 逐帧武器数据导出：开发面板💾保存时覆盖写固定文件（供助手读取合并进正式配置）
function getWeaponFramesPath() {
    const isDev = isDevelopmentMode();
    return isDev
        ? path.join(__dirname, '../weapon-frames/latest.js')
        : path.join(app.getPath('userData'), 'weapon-frames', 'latest.js');
}

function formatWeaponFramesFile(payload) {
    return '// 逐帧武器数据导出（开发面板💾保存时自动覆盖此文件，仅作记录/回滚参考）\n'
        + '// 保存时已自动合并并同步 data/ 与 public/data/ 的 weapon-anim-config.json\n'
        + 'export default ' + JSON.stringify(payload, null, 2) + '\n';
}

// 保存时直接合并进 weapon-anim-config.json（免助手中转；保留 attack 其他字段，写前滚动备份）
async function mergeWeaponFramesIntoConfig(payload) {
    const wt = payload && payload.weaponType;
    if (typeof wt !== 'string' || !Array.isArray(payload.frames)
        || ['__proto__', 'constructor', 'prototype'].includes(wt)) return false;
    // 与 load/save-weapon-config 统一走 getWeaponConfigPaths：
    // 此前生产环境写到 userData/data/ 子目录，而读路径是 userData/weapon-anim-config.json，合并结果永不读回
    const paths = getWeaponConfigPaths();
    const cfgPath = paths.write;
    const readPath = paths.read;
    const cfg = JSON.parse(await fs.promises.readFile(readPath, 'utf8'));
    if (!cfg[wt]) cfg[wt] = {};
    const blockKey = ['attack', 'attack2', 'dash', 'walkFrames'].includes(payload.anim) ? payload.anim : 'attack';
    cfg[wt][blockKey] = { ...(cfg[wt][blockKey] || {}), type: 'perFrame', frames: payload.frames };
    const backupPath = path.join(path.dirname(getWeaponFramesPath()), 'weapon-anim-config.backup.json');
    await fs.promises.copyFile(readPath, backupPath);
    const serialized = JSON.stringify(cfg, null, 2);
    await fs.promises.mkdir(path.dirname(cfgPath), { recursive: true });
    await fs.promises.writeFile(cfgPath, serialized, 'utf8');
    if (paths.mirror) {
        await fs.promises.mkdir(path.dirname(paths.mirror), { recursive: true });
        await fs.promises.writeFile(paths.mirror, serialized, 'utf8');
    }
    return true;
}

ipcMain.handle('save-weapon-frames', async (_event, payload) => {
    const target = getWeaponFramesPath();
    try {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(target, formatWeaponFramesFile(payload), 'utf8');
        const merged = await mergeWeaponFramesIntoConfig(payload);
        return { success: true, path: target, merged };
    } catch (err) {
        console.error('[main] Failed to save weapon frames:', err);
        throw err;
    }
});

// 通用 JSON 读写（限 data/ 目录，供墙壁预制库等编辑器数据持久化）
function getJsonPaths(rel) {
    const isDev = isDevelopmentMode();
    if (isDev) {
        return { read: path.join(__dirname, '../public', rel), write: path.join(__dirname, '../public', rel) };
    }
    const userDataPath = path.join(app.getPath('userData'), rel);
    return {
        read: fs.existsSync(userDataPath) ? userDataPath : path.join(__dirname, '../dist', rel),
        write: userDataPath
    };
}

function assertJsonRel(rel) {
    if (typeof rel !== 'string' || !rel.startsWith('data/') || rel.includes('..') || !rel.endsWith('.json')) {
        throw new Error('invalid json path: ' + rel);
    }
}

ipcMain.handle('save-json', async (_event, rel, data) => {
    assertJsonRel(rel);
    const paths = getJsonPaths(rel);
    await fs.promises.mkdir(path.dirname(paths.write), { recursive: true });
    await fs.promises.writeFile(paths.write, JSON.stringify(data, null, 2), 'utf8');
    return { success: true, path: paths.write };
});

ipcMain.handle('load-json', async (_event, rel) => {
    assertJsonRel(rel);
    const paths = getJsonPaths(rel);
    return JSON.parse(await fs.promises.readFile(paths.read, 'utf8'));
});

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

ipcMain.handle('get-fullscreen', () => {
    return mainWindow ? mainWindow.isFullScreen() : false;
});

ipcMain.handle('set-background-running', (event, enabled) => {
    if (!mainWindow || mainWindow.isDestroyed()
        || event.sender !== mainWindow.webContents
        || event.senderFrame !== mainWindow.webContents.mainFrame
        || typeof enabled !== 'boolean') {
        throw new Error('Invalid background-running request');
    }
    mainWindow.webContents.setBackgroundThrottling(!enabled);
    sendBackgroundState();
    return enabled;
});

ipcMain.on('exit-app', () => {
    app.quit();
});

// 应用生命周期
app.whenReady().then(() => {
    if (fixedTest) {
        if (!fixedTest.canRun) return;
        fixedTest.registerProtocol();
    }
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// 旧版正在测试时，启动新版只唤回旧窗口；不重载，不切换版本。
app.on('second-instance', () => {
    if (fixedTest && mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 导出供 preload 使用
module.exports = { createWindow, mainWindow };
