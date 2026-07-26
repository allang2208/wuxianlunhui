/**
 * 地牢地板烘焙（战斗房与 Boss 场地共用，唯一实现）
 *
 * 等距俯视角（30°）菱形地板：
 * - 贴图组由地板配置驱动（setDungeonFloorProfile）：每格随机选图 + 随机镜像变换
 * - 菱形几何按贴图 alpha 包围盒运行时实测（换素材无需改代码）
 * - 发光层机制保留（profile.glow !== false 时同位置 'lighter' 平铺 <贴图键>_glow），
 *   僵尸地牢当前全部关闭（glow: false），其他场景可开启
 * - 墙脚接触阴影（统一标准）：沿菱形边缘向内 64px 真渐变黑带（墙根 ≈40% 黑 → 0），
 *   所有墙壁-地板衔接处共用此处理，不因地牢等级分设
 * - 贴图未加载完成时回退到深色网格地板
 */
import { CONFIG } from '../config/config.js';
import { Renderer } from './renderer.js';

// 默认地板配置（非地牢/未设置时）：保持旧的 blackbrick5 + 发光层行为
const DEFAULT_PROFILE = { tiles: ['blackbrick5'], glow: true };

// 场地四周边缘黑→透明渐变宽度
const FLOOR_EDGE_FADE = 64;

// 回退网格地板默认样式（调用方未提供时使用）
const DEFAULT_FALLBACK_TERRAIN = {
    floorColor: '#1a1814',
    gridColor: 'rgba(50, 45, 40, 0.4)',
    gridSize: 80,
    edgeHighlight: 'rgba(120, 80, 60, 0.6)',
};

// 当前地板配置（由地牢初始化时按地牢类型设置）
let _floorProfile = null;

/**
 * 设置当前地板配置
 * @param {{tiles:string[], glow?:boolean}|null} profile null 恢复默认
 */
export function setDungeonFloorProfile(profile) {
    _floorProfile = (profile && Array.isArray(profile.tiles) && profile.tiles.length > 0)
        ? { tiles: [...profile.tiles], glow: profile.glow !== false, overlapX: profile.overlapX ?? 0, overlapY: profile.overlapY ?? 0, deco: profile.deco || null }
        : null;
}

function _getProfile() {
    return _floorProfile || DEFAULT_PROFILE;
}

/** 取 Phaser 已加载贴图的源图（未加载返回 null） */
function _getSourceImage(key) {
    const scene = (typeof window !== 'undefined' && window.__phaserScene) ? window.__phaserScene : null;
    if (!scene || !scene.textures || !scene.textures.exists(key)) return null;
    const tex = scene.textures.get(key);
    const img = tex ? tex.getSourceImage() : null;
    return (img && img.width > 0 && img.height > 0) ? img : null;
}

// 菱形几何缓存（alpha 包围盒实测，换素材无需改代码）
const _tileGeoCache = new Map();

/** 实测贴图 alpha 包围盒 → 菱形宽高与中心点 */
function _getTileGeometry(key, img) {
    if (_tileGeoCache.has(key)) return _tileGeoCache.get(key);
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    const data = cx.getImageData(0, 0, img.width, img.height).data;
    let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            if (data[(y * img.width + x) * 4 + 3] > 8) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    const geo = (maxX >= 0)
        ? { w: maxX - minX + 1, h: maxY - minY + 1, cx: (minX + maxX + 1) / 2, cy: (minY + maxY + 1) / 2 }
        : { w: img.width, h: img.height, cx: img.width / 2, cy: img.height / 2 };
    _tileGeoCache.set(key, geo);
    return geo;
}

/** 等距平铺一层：每格随机选图 + 随机镜像，菱形中心对齐网格点、行交错半宽偏移；
 *  overlapX/overlapY：步进内缩（相邻砖叠合，只叠不缺）——盖自然边缘的锯齿缝与半透明暗边 */
function _drawIsoLayer(ctx, tiles, w, h, overlapX = 0, overlapY = 0) {
    // 网格步进用首张贴图几何（组内各贴图尺寸近似，中心点各自对齐）
    const ref = tiles[0];
    const stepX = ref.geo.w - overlapX;
    const stepY = ref.geo.h / 2 - overlapY;
    const startRow = -2;
    const endRow = Math.ceil(h / stepY) + 2;
    for (let r = startRow; r < endRow; r++) {
        const offsetX = (r % 2 !== 0) ? stepX / 2 : 0;
        const gy = r * stepY;
        for (let gx = -stepX; gx < w + stepX; gx += stepX) {
            const cx = gx + offsetX;
            const tile = tiles[Math.floor(Math.random() * tiles.length)];
            const fx = Math.random() < 0.5 ? -1 : 1;
            const fy = Math.random() < 0.5 ? -1 : 1;
            ctx.save();
            ctx.translate(cx, gy);
            ctx.scale(fx, fy);
            ctx.drawImage(tile.img, -tile.geo.cx, -tile.geo.cy);
            ctx.restore();
        }
    }
}

/** 取当前地板配置（外部只读：门外白区等需要跟随当前地牢地砖的场景用） */
export function getDungeonFloorProfile() {
    return _getProfile();
}

/**
 * 烘焙地牢地板到离屏 canvas
 * @param {number} size 场地边长（正方形）
 * @param {object} [fallbackTerrain] 回退网格地板样式
 * @returns {HTMLCanvasElement}
 */
export function bakeDungeonFloor(size, fallbackTerrain) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 1. 全屏纯黑背景
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    const profile = _getProfile();
    const tiles = [];
    for (const key of profile.tiles) {
        const img = _getSourceImage(key);
        if (img) tiles.push({ key, img, geo: _getTileGeometry(key, img) });
        else console.warn('[DungeonFloor] 地砖纹理缺失（已从池中剔除）:', key);
    }
    if (profile.tiles.length > 0) {
        console.log(`[DungeonFloor] 地砖池 ${tiles.length}/${profile.tiles.length}:`, tiles.map(t => t.key).join(','));
    }

    if (tiles.length > 0) {
        // 2. 基础层：等距菱形平铺（随机选图 + 随机镜像）
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, size, size);
        ctx.clip();
        _drawIsoLayer(ctx, tiles, size, size, profile.overlapX ?? 0, profile.overlapY ?? 0);

        // 3. 发光层（机制保留）：profile.glow 开启且存在 <贴图键>_glow 时同位置 ADD 平铺
        if (profile.glow !== false) {
            const glowTiles = [];
            for (const t of tiles) {
                const img = _getSourceImage(t.key + '_glow');
                if (img) glowTiles.push({ key: t.key, img, geo: _getTileGeometry(t.key + '_glow', img) });
            }
            if (glowTiles.length > 0) {
                ctx.globalCompositeOperation = 'lighter';
                _drawIsoLayer(ctx, glowTiles, size, size, profile.overlapX ?? 0, profile.overlapY ?? 0);
                ctx.globalCompositeOperation = 'source-over';
            }
        }
        ctx.restore();

        // 4. 边缘过渡：在场地四周叠加黑->透明的渐变，与纯黑背景融合
        const fade = FLOOR_EDGE_FADE;
        let grad;

        grad = ctx.createLinearGradient(0, 0, 0, fade);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, fade);

        grad = ctx.createLinearGradient(0, size - fade, 0, size);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, size - fade, size, fade);

        grad = ctx.createLinearGradient(0, 0, fade, 0);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, fade, size);

        grad = ctx.createLinearGradient(size - fade, 0, size, 0);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = grad;
        ctx.fillRect(size - fade, 0, fade, size);
    } else {
        // 贴图未全部加载时回退到旧版网格地板
        console.warn('[DungeonFloor] 地板贴图未加载，使用回退网格地板');
        const tc = fallbackTerrain || DEFAULT_FALLBACK_TERRAIN;
        ctx.fillStyle = tc.floorColor;
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = tc.gridColor;
        ctx.lineWidth = 1;
        for (let bx = 0; bx < size; bx += tc.gridSize) {
            ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, size); ctx.stroke();
        }
        for (let by = 0; by < size; by += tc.gridSize) {
            ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(size, by); ctx.stroke();
        }
        ctx.strokeStyle = tc.edgeHighlight;
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, size, size);
    }
    return canvas;
}

/**
 * 烘焙菱形地板并应用到渲染器（僵尸地牢战斗房/Boss 场地）
 * 菱形可移动区域外保持全黑，边缘黑渐变过渡
 * @param {number} width 世界宽
 * @param {number} height 世界高
 * @param {number} cx 菱形中心 X
 * @param {number} cy 菱形中心 Y
 * @param {number} rx 菱形水平半径
 * @param {number} ry 菱形垂直半径
 * @param {object} [fallbackTerrain] 回退网格地板样式
 */
export function applyDiamondFloor(width, height, cx, cy, rx, ry, fallbackTerrain) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // 1. 全屏纯黑背景（菱形外区域保持全黑）
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const profile = _getProfile();
    const tiles = [];
    for (const key of profile.tiles) {
        const img = _getSourceImage(key);
        if (img) tiles.push({ key, img, geo: _getTileGeometry(key, img) });
        else console.warn('[DungeonFloor] 地砖纹理缺失（已从池中剔除）:', key);
    }
    if (profile.tiles.length > 0) {
        console.log(`[DungeonFloor] 地砖池 ${tiles.length}/${profile.tiles.length}:`, tiles.map(t => t.key).join(','));
    }

    const diamondPath = (inset) => {
        const irx = rx - inset, iry = ry - inset * (ry / rx);
        ctx.beginPath();
        ctx.moveTo(cx, cy - iry);
        ctx.lineTo(cx + irx, cy);
        ctx.lineTo(cx, cy + iry);
        ctx.lineTo(cx - irx, cy);
        ctx.closePath();
    };

    if (tiles.length > 0) {
        // 2. 菱形裁剪内平铺等距地板
        ctx.save();
        diamondPath(0);
        ctx.clip();
        _drawIsoLayer(ctx, tiles, width, height, profile.overlapX ?? 0, profile.overlapY ?? 0);
        if (profile.glow !== false) {
            const glowTiles = [];
            for (const t of tiles) {
                const img = _getSourceImage(t.key + '_glow');
                if (img) glowTiles.push({ key: t.key, img, geo: _getTileGeometry(t.key + '_glow', img) });
            }
            if (glowTiles.length > 0) {
                ctx.globalCompositeOperation = 'lighter';
                _drawIsoLayer(ctx, glowTiles, width, height, profile.overlapX ?? 0, profile.overlapY ?? 0);
                ctx.globalCompositeOperation = 'source-over';
            }
        }
        ctx.restore();

        // 3. 墙脚接触阴影（标准：所有墙壁-地板衔接处统一）：沿菱形边缘向内的真渐变带，
        // 墙根处最暗（约 40% 黑）→ 向内 64px 渐隐到 0。逐笔 alpha 递减叠加自然成梯度；
        // 旧版是 16 笔等 alpha(0.12) 平刷——整带只有约 15% 平黑，亮地砖上几乎不可见
        // （中级/初级"没有阴影"的根因：blackbrick-7/8 亮度 50 是高级砖 25 的两倍）
        const fade = FLOOR_EDGE_FADE;
        for (let i = 0; i < fade; i += 2) {
            diamondPath(i);
            ctx.strokeStyle = `rgba(0,0,0,${(0.40 * (1 - i / fade)).toFixed(3)})`;
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }
    } else {
        console.warn('[DungeonFloor] 地板贴图未加载，菱形房回退为纯黑 + 轮廓线');
        diamondPath(0);
        ctx.strokeStyle = (fallbackTerrain && fallbackTerrain.edgeHighlight) || 'rgba(120, 80, 60, 0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // 4. 同步世界尺寸与渲染器
    if (CONFIG) {
        CONFIG.WORLD_WIDTH = width;
        CONFIG.WORLD_HEIGHT = height;
    }
    if (Renderer) {
        Renderer.terrainTexture = canvas;
    }
    if (typeof window !== 'undefined' && window.__phaserScene && typeof window.__phaserScene.syncTerrain === 'function') {
        window.__phaserScene.syncTerrain();
    }
    return canvas;
}

/**
 * 烘焙地板并应用到渲染器（同步世界尺寸与 Phaser 地形）
 * @param {number} size 场地边长
 * @param {object} [fallbackTerrain] 回退网格地板样式
 */
export function applyDungeonFloor(size, fallbackTerrain) {
    const canvas = bakeDungeonFloor(size, fallbackTerrain);
    // 更新世界尺寸（必须先设置，否则 syncTerrain 会用旧尺寸生成绿色默认地形）
    if (CONFIG) {
        CONFIG.WORLD_WIDTH = size;
        CONFIG.WORLD_HEIGHT = size;
    }
    // 应用到渲染器
    if (Renderer) {
        Renderer.terrainTexture = canvas;
    }
    if (typeof window !== 'undefined' && window.__phaserScene && typeof window.__phaserScene.syncTerrain === 'function') {
        window.__phaserScene.syncTerrain();
    }
    return canvas;
}
