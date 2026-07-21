/**
 * 僵尸地牢地板烘焙（战斗房与 Boss 场地共用，唯一实现）
 *
 * 等距俯视角（30°）菱形地板：
 * - 基础层：blackbrick4（512×512 内含 329×161 菱形）按等距网格交错平铺
 * - 发光层：blackbrick4_glow（菱形上边缘高光带）同位置平铺，
 *   'lighter' 合成（等价 Phaser BlendModes.ADD），让砖缝/上缘真正"发光"
 * - 四周 64px 黑→透明渐变与纯黑背景融合
 * - 贴图未加载完成时回退到深色网格地板
 */
import { CONFIG } from '../config/config.js';
import { Renderer } from './renderer.js';

// 等距贴图键（基础层 + 发光层）
const ISO_BASE_KEY = 'blackbrick4';
const ISO_GLOW_KEY = 'blackbrick4_glow';
// 菱形在 512×512 源图中的几何（实测 alpha bbox 92,179 → 421,340）
const ISO_TILE_W = 329;   // 菱形宽
const ISO_TILE_H = 161;   // 菱形高
const ISO_CENTER_X = 256; // 菱形中心在源图中的 x
const ISO_CENTER_Y = 260; // 菱形中心在源图中的 y
// 场地四周边缘黑→透明渐变宽度
const FLOOR_EDGE_FADE = 64;

// 回退网格地板默认样式（调用方未提供时使用）
const DEFAULT_FALLBACK_TERRAIN = {
    floorColor: '#1a1814',
    gridColor: 'rgba(50, 45, 40, 0.4)',
    gridSize: 80,
    edgeHighlight: 'rgba(120, 80, 60, 0.6)',
};

/** 取 Phaser 已加载贴图的源图（未加载返回 null） */
function _getSourceImage(key) {
    const scene = (typeof window !== 'undefined' && window.__phaserScene) ? window.__phaserScene : null;
    if (!scene || !scene.textures || !scene.textures.exists(key)) return null;
    const tex = scene.textures.get(key);
    const img = tex ? tex.getSourceImage() : null;
    return (img && img.width > 0 && img.height > 0) ? img : null;
}

/** 等距平铺一层：菱形中心对齐网格点，行交错半宽偏移 */
function _drawIsoLayer(ctx, img, size) {
    const stepX = ISO_TILE_W;
    const stepY = ISO_TILE_H / 2;
    const startRow = -2;
    const endRow = Math.ceil(size / stepY) + 2;
    for (let r = startRow; r < endRow; r++) {
        const offsetX = (r % 2 !== 0) ? stepX / 2 : 0;
        const gy = r * stepY;
        for (let gx = -stepX; gx < size + stepX; gx += stepX) {
            const cx = gx + offsetX;
            // 菱形中心 (ISO_CENTER_X, ISO_CENTER_Y) 对齐网格点 (cx, gy)
            ctx.drawImage(img, cx - ISO_CENTER_X, gy - ISO_CENTER_Y);
        }
    }
}

/**
 * 烘焙地牢地板到离屏 canvas
 * @param {number} size 场地边长（正方形）
 * @param {object} [fallbackTerrain] 回退网格地板样式（floorColor/gridColor/gridSize/edgeHighlight）
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

    const baseImg = _getSourceImage(ISO_BASE_KEY);
    const glowImg = _getSourceImage(ISO_GLOW_KEY);

    if (baseImg) {
        // 2. 基础层：等距菱形平铺
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, size, size);
        ctx.clip();
        _drawIsoLayer(ctx, baseImg, size);

        // 3. 发光层：同位置平铺，'lighter' 合成（ADD 混合，让上缘高光真正发光）
        if (glowImg) {
            ctx.globalCompositeOperation = 'lighter';
            _drawIsoLayer(ctx, glowImg, size);
            ctx.globalCompositeOperation = 'source-over';
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
        console.warn('[DungeonFloor] blackbrick4 贴图未加载，使用回退网格地板');
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
