/**
 * 墙壁预制组合库（data/wall-prefabs.json）
 * - 运行时 fetch 读取（Vite 从 public/data 提供），启动时 BootScene 预载
 * - 墙壁编辑器保存：Electron 走 IPC 写 public/data；浏览器环境回退为下载文件（手动放回原位）
 * - 预制结构: { "<key>": { name, pieces: [{tex,x,y,scaleX,scaleY,flipX,flipY,depth}] } }
 */

const PREFAB_URL = '/data/wall-prefabs.json';
const PREFAB_REL = 'data/wall-prefabs.json';

let _library = null;

/** 预载预制库（幂等；失败给空库） */
export async function loadWallPrefabs() {
    if (_library) return _library;
    try {
        const r = await fetch(`${PREFAB_URL}?ts=${Date.now()}`);
        _library = r.ok ? await r.json() : {};
    } catch {
        _library = {};
    }
    return _library;
}

/** 取已缓存的预制库（未预载返回空对象） */
export function getWallPrefabLibrary() {
    return _library || {};
}

/** 预制库是否已加载完成 */
export function isWallPrefabsLoaded() {
    return _library !== null;
}

/** 强制刷新缓存（保存后调用） */
export function setWallPrefabLibrary(lib) {
    _library = lib || {};
}

/** 统一 JSON 持久化（Electron IPC 优先 → Vite 开发服务器中间件 → 浏览器下载兜底） */
async function _persistJson(rel, data) {
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.saveJson) {
        await window.electronAPI.saveJson(rel, data);
        return true;
    }
    // Vite 开发服务器：POST 直存 public/data + data/（免手动复制，刷新即生效）
    try {
        const r = await fetch('/__save-json', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rel, data }),
        });
        if (r.ok) return true;
    } catch {
        // 落到下载兜底
    }
    // 浏览器兜底：下载 JSON，用户手动放回 data/ 与 public/data/
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = rel.split('/').pop();
    a.click();
    URL.revokeObjectURL(a.href);
    return false;
}

/** 保存预制库到磁盘（Electron IPC 优先 → Vite 开发服务器中间件 → 浏览器下载兜底） */
export async function saveWallPrefabs(lib) {
    _library = lib || {};
    return _persistJson(PREFAB_REL, _library);
}

// ==================== 障碍物布局（data/obstacle-layout.json，2026-07-30） ====================
// 主神空间摆放的障碍物清单：[{tex,x,y,scaleX,scaleY,flipX,flipY,rotation,depth}]
// 保存管道与预制库同规格；_setupMainHubTerrain 每次回城按布局重建
const OBSTACLE_URL = '/data/obstacle-layout.json';
const OBSTACLE_REL = 'data/obstacle-layout.json';

let _obstacleLayout = null;

/** 预载障碍物布局（幂等；失败给空表） */
export async function loadObstacleLayout() {
    if (_obstacleLayout) return _obstacleLayout;
    try {
        const r = await fetch(`${OBSTACLE_URL}?ts=${Date.now()}`);
        const data = r.ok ? await r.json() : [];
        _obstacleLayout = Array.isArray(data) ? data : [];
    } catch {
        _obstacleLayout = [];
    }
    return _obstacleLayout;
}

/** 取已缓存的障碍物布局（未预载返回空表） */
export function getObstacleLayout() {
    return _obstacleLayout || [];
}

/** 保存障碍物布局到磁盘（与 saveWallPrefabs 同管道） */
export async function saveObstacleLayout(list) {
    _obstacleLayout = Array.isArray(list) ? list : [];
    return _persistJson(OBSTACLE_REL, _obstacleLayout);
}
