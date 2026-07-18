/**
 * 僵尸地牢地板烘焙（战斗房与 Boss 场地共用，唯一实现）
 *
 * 三张 blackbrick 源图（BootScene 加载键）切割为 32×32 小砖随机拼铺：
 * - 每块随机子块（候选池 = 3 图 × 各图子块）、随机 8 种朝向（4 旋转 × 水平翻转）
 * - 相邻（上/左）不使用同一子块
 * - 小砖圆角矩形裁剪（半径 4px），四边内缩 1px 形成 2px 纯黑缝隙
 * - 灰黑 tint 统一色调；四周 64px 黑→透明渐变与纯黑背景融合
 * - 贴图未加载完成时回退到深色网格地板
 */
import { CONFIG } from '../config/config.js';
import { Renderer } from './renderer.js';

// 地板贴图键（源图切割为 32×32 小砖随机拼铺，相邻小砖不使用同一子块）
export const FLOOR_TEXTURE_KEYS = ['blackbrick', 'blackbrick2', 'blackbrick3'];
export const FLOOR_TILE_SIZE = 32;
// 小砖实际绘制尺寸：四边各内缩 1px，相邻小砖之间形成 2px 纯黑缝隙
const FLOOR_TILE_DRAW_SIZE = FLOOR_TILE_SIZE - 2;
// 小砖圆角半径（边缘圆滑处理）
const FLOOR_TILE_RADIUS = 4;
// 将三张略有偏色的贴图统一为灰黑色（null = 保留原图；填写颜色则统一色调）
const FLOOR_TINT_COLOR = '#333333';
// 场地四周边缘黑→透明渐变宽度
const FLOOR_EDGE_FADE = 64;

// 回退网格地板默认样式（调用方未提供时使用）
const DEFAULT_FALLBACK_TERRAIN = {
    floorColor: '#1a1814',
    gridColor: 'rgba(50, 45, 40, 0.4)',
    gridSize: 80,
    edgeHighlight: 'rgba(120, 80, 60, 0.6)',
};

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

    // 2. 获取三种 blackbrick 贴图
    const scene = (typeof window !== 'undefined' && window.__phaserScene) ? window.__phaserScene : null;
    const sources = FLOOR_TEXTURE_KEYS.map(key => {
        if (!scene || !scene.textures || !scene.textures.exists(key)) return null;
        const tex = scene.textures.get(key);
        const img = tex ? tex.getSourceImage() : null;
        return (img && img.width > 0 && img.height > 0) ? img : null;
    });
    const allLoaded = sources.every(s => s);

    if (allLoaded) {
        const tileSize = FLOOR_TILE_SIZE;
        const cols = Math.ceil(size / tileSize);
        const rows = Math.ceil(size / tileSize);

        // 将三张源图切割为 32×32 子块，组成候选池
        const tilePool = [];
        for (const img of sources) {
            const subCols = Math.max(1, Math.floor(img.width / tileSize));
            const subRows = Math.max(1, Math.floor(img.height / tileSize));
            for (let sr = 0; sr < subRows; sr++) {
                for (let sc = 0; sc < subCols; sc++) {
                    tilePool.push({ img, sx: sc * tileSize, sy: sr * tileSize });
                }
            }
        }

        // 生成子块/朝向网格：相邻（上、左）子块不能相同；朝向 = 4 旋转 × 水平翻转共 8 种
        const pickGrid = Array.from({ length: rows }, () => []);
        const orientGrid = Array.from({ length: rows }, () => []);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const top = r > 0 ? pickGrid[r - 1][c] : null;
                const left = c > 0 ? pickGrid[r][c - 1] : null;
                let pick = tilePool[Math.floor(Math.random() * tilePool.length)];
                // 候选池足够大，重试几次即可避开与上/左相同的子块
                for (let attempt = 0; attempt < 8 && (pick === top || pick === left); attempt++) {
                    pick = tilePool[Math.floor(Math.random() * tilePool.length)];
                }
                pickGrid[r][c] = pick;
                orientGrid[r][c] = Math.floor(Math.random() * 8); // bit0-1: 旋转 0/90/180/270，bit2: 水平翻转
            }
        }

        // 绘制地块
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, size, size);
        ctx.clip();
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const dx = c * tileSize;
                const dy = r * tileSize;
                const cx = dx + tileSize / 2;
                const cy = dy + tileSize / 2;
                const tile = pickGrid[r][c];
                const orient = orientGrid[r][c];
                const rot = orient & 3;
                const flipX = (orient & 4) !== 0;

                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate((rot * Math.PI) / 2);
                if (flipX) ctx.scale(-1, 1);
                // 圆角矩形裁剪：小砖边缘圆滑；四边内缩 1px，相邻小砖留 2px 纯黑缝隙
                const half = FLOOR_TILE_DRAW_SIZE / 2;
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(-half, -half, FLOOR_TILE_DRAW_SIZE, FLOOR_TILE_DRAW_SIZE, FLOOR_TILE_RADIUS);
                } else {
                    ctx.rect(-half, -half, FLOOR_TILE_DRAW_SIZE, FLOOR_TILE_DRAW_SIZE);
                }
                ctx.clip();
                // 从源图切出对应 32×32 子块绘制（源取整 32，目标内缩为 30×30）
                ctx.drawImage(tile.img, tile.sx, tile.sy, tileSize, tileSize, -half, -half, FLOOR_TILE_DRAW_SIZE, FLOOR_TILE_DRAW_SIZE);
                if (FLOOR_TINT_COLOR) {
                    // 使用 'color' 合成：保留原图明暗，只替换色相/饱和度，统一为灰黑色
                    ctx.globalCompositeOperation = 'color';
                    ctx.fillStyle = FLOOR_TINT_COLOR;
                    ctx.fillRect(-half, -half, FLOOR_TILE_DRAW_SIZE, FLOOR_TILE_DRAW_SIZE);
                    ctx.globalCompositeOperation = 'source-over';
                }
                ctx.restore();
            }
        }
        ctx.restore();

        // 3. 边缘过渡：在场地四周叠加黑->透明的渐变，与纯黑背景融合
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
        console.warn('[DungeonFloor] blackbrick 系列贴图未全部加载，使用回退网格地板');
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
