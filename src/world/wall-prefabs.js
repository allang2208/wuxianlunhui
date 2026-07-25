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

/** 保存预制库到磁盘（Electron IPC 优先 → Vite 开发服务器中间件 → 浏览器下载兜底） */
export async function saveWallPrefabs(lib) {
    _library = lib || {};
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.saveJson) {
        await window.electronAPI.saveJson(PREFAB_REL, _library);
        return true;
    }
    // Vite 开发服务器：POST 直存 public/data + data/（免手动复制，刷新即生效）
    try {
        const r = await fetch('/__save-json', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ rel: PREFAB_REL, data: _library }),
        });
        if (r.ok) return true;
    } catch {
        // 落到下载兜底
    }
    // 浏览器兜底：下载 JSON，用户手动放回 data/ 与 public/data/
    const blob = new Blob([JSON.stringify(_library, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wall-prefabs.json';
    a.click();
    URL.revokeObjectURL(a.href);
    return false;
}
