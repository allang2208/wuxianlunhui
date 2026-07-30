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

// ==================== 墙体几何覆盖层（data/wall-geo-overrides.json，2026-07-30） ====================
// ISO_WALL_GEO 在 src 源码里，JSON 保存管道只能写 data/*.json——碰撞体积编辑器对
// 墙(face/halfThick)/门(states 门洞)/障碍物(foot) 的按类型修改写此文件；
// 启动时 BootScene 预载，WallSystem.applyGeoOverrides 合并进 ISO_WALL_GEO 后重建碰撞生效
const GEO_OVR_URL = '/data/wall-geo-overrides.json';
const GEO_OVR_REL = 'data/wall-geo-overrides.json';

let _geoOverrides = null;

/** 预载几何覆盖层（幂等；失败给空对象） */
export async function loadWallGeoOverrides() {
    if (_geoOverrides) return _geoOverrides;
    try {
        const r = await fetch(`${GEO_OVR_URL}?ts=${Date.now()}`);
        const data = r.ok ? await r.json() : {};
        _geoOverrides = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    } catch {
        _geoOverrides = {};
    }
    return _geoOverrides;
}

/** 取已缓存的几何覆盖层（未预载返回空对象） */
export function getWallGeoOverrides() {
    return _geoOverrides || {};
}

/** 几何覆盖层是否已加载完成 */
export function isWallGeoOverridesLoaded() {
    return _geoOverrides !== null;
}

/** 保存几何覆盖层到磁盘（与 saveWallPrefabs 同管道） */
export async function saveWallGeoOverrides(ov) {
    _geoOverrides = (ov && typeof ov === 'object' && !Array.isArray(ov)) ? ov : {};
    return _persistJson(GEO_OVR_REL, _geoOverrides);
}

// ==================== 障碍物类型默认状态（data/obstacle-defaults.json，2026-07-30） ====================
// 结构：{ "<geoKey>": { scaleX, scaleY, rotation, flipX, flipY } }（geoKey = ISO_WALL_GEO 键，如 barrel/pillar/candle）
// 语义：障碍物编辑器「保存」把选中件的变换记为**该类型的默认状态**——
// 之后摆墙拖新件 / 地牢地板装饰生成同类障碍物时套用；「重置」也回到这里记录的变换
const OBSTACLE_DEF_URL = '/data/obstacle-defaults.json';
const OBSTACLE_DEF_REL = 'data/obstacle-defaults.json';

let _obstacleDefaults = null;

/** 预载障碍物类型默认状态（幂等；失败给空对象） */
export async function loadObstacleDefaults() {
    if (_obstacleDefaults) return _obstacleDefaults;
    try {
        const r = await fetch(`${OBSTACLE_DEF_URL}?ts=${Date.now()}`);
        const data = r.ok ? await r.json() : {};
        _obstacleDefaults = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    } catch {
        _obstacleDefaults = {};
    }
    return _obstacleDefaults;
}

/** 取已缓存的障碍物类型默认状态（未预载返回空对象） */
export function getObstacleDefaults() {
    return _obstacleDefaults || {};
}

/** 保存障碍物类型默认状态到磁盘（与 saveWallPrefabs 同管道） */
export async function saveObstacleDefaults(defs) {
    _obstacleDefaults = (defs && typeof defs === 'object' && !Array.isArray(defs)) ? defs : {};
    return _persistJson(OBSTACLE_DEF_REL, _obstacleDefaults);
}

/** 保存 game-config.json（GAME_CONFIG 运行时对象由调用方先改好，这里只负责落盘） */
export async function saveGameConfig(data) {
    return _persistJson('data/game-config.json', data);
}
