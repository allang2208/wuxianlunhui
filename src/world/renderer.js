import { WallSystem } from '../world/wall-system.js';
import { Camera } from '../world/camera.js';
import { SceneManager } from './scene-manager.js';
import { GAME_CONFIG } from '../config/game-config.js';
import { getElement } from '../utils/dom-utils.js';
import { CONFIG } from '../config/config.js';

const Renderer = {
    canvas: null, ctx: null,
    // 场景特定的地形 Canvas 覆盖；若为空，由 GameScene 使用 Phaser Graphics 直接生成
    terrainTexture: null,
    init() { if (!this.canvas) this.canvas = getElement('gameCanvas'); if (!this.canvas) { console.error('gameCanvas not found'); return; } this.ctx = this.canvas.getContext('2d'); this.resize(); window.addEventListener('resize', () => this.resize()); },
    resize() { if (!this.canvas || !this.ctx) return; const defaultRes = GAME_CONFIG.display?.defaultResolution || { width: 1920, height: 1080 }; const w = window.innerWidth || defaultRes.width || 1920, h = window.innerHeight || defaultRes.height || 1080; if (w > 0 && h > 0) { this.canvas.width = w; this.canvas.height = h; } },
    generateWorld() {
        if (!this.canvas || !this.ctx) return;
        const displayCfg = GAME_CONFIG.display || {};
        const viewW = displayCfg.viewWidth || 1920;
        const viewH = displayCfg.viewHeight || 1080;
        const cw = this.canvas.width || window.innerWidth || viewW;
        const ch = this.canvas.height || window.innerHeight || viewH;
        this.canvas.width = cw;
        this.canvas.height = ch;
        CONFIG.VIEW_WIDTH = viewW;
        CONFIG.VIEW_HEIGHT = viewH;
        const worldCfg = GAME_CONFIG.world || {};
        const sm = (SceneManager) ? SceneManager : ((typeof window !== 'undefined' && window.SceneManager) ? window.SceneManager : null);
        if (sm && sm.currentScene === 'main') {
            CONFIG.WORLD_WIDTH = (worldCfg.main && worldCfg.main.width) || 7650;
            CONFIG.WORLD_HEIGHT = (worldCfg.main && worldCfg.main.height) || 3800;
        } else {
            CONFIG.WORLD_WIDTH = (worldCfg.default && worldCfg.default.width) || (viewW * 4);
            CONFIG.WORLD_HEIGHT = (worldCfg.default && worldCfg.default.height) || (viewH * 4);
        }
        WallSystem.init(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT);
        this.terrainTexture = null;
    },

    // ==================== 屏幕⇄世界坐标换算（2026-08-14 重写）====================
    // 唯一真源 = Phaser 主相机自身的变换矩阵（matrixCombined / getWorldPoint）：
    // 相机 zoom / scroll / origin 任意（0.3、0.7、1…任何地图缩放）都自动正确，不写死任何数值。
    // 入参/出参均为 CSS 客户区坐标（clientX/Y，含 canvas 在窗口中的拉伸缩放补偿）。
    /** 取主相机 + canvas 客户区映射；无 Phaser 返回 null */
    _camInfo() {
        const phaserScene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        const cam = phaserScene && phaserScene.cameras ? phaserScene.cameras.main : null;
        if (!cam || !phaserScene.game || !phaserScene.game.canvas) return null;
        const canvas = phaserScene.game.canvas;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return {
            cam,
            rect,
            scaleX: canvas.width / rect.width,   // 相机空间 → 客户区坐标换算
            scaleY: canvas.height / rect.height,
        };
    },
    worldToScreen(wx, wy) {
        const info = this._camInfo();
        if (info) {
            // 世界 → 相机空间（矩阵已含 zoom/scroll/origin）
            const out = { x: 0, y: 0 };
            if (info.cam.matrixCombined && typeof info.cam.matrixCombined.transformPoint === 'function') {
                info.cam.matrixCombined.transformPoint(wx, wy, out);
            } else {
                out.x = (wx - info.cam.scrollX) * (info.cam.zoom || 1);
                out.y = (wy - info.cam.scrollY) * (info.cam.zoom || 1);
            }
            return {
                x: info.rect.left + out.x / info.scaleX,
                y: info.rect.top + out.y / info.scaleY,
            };
        }
        // 回退（无 Phaser 场景）：旧恒等换算
        const cw = this.canvas ? this.canvas.width : CONFIG.VIEW_WIDTH;
        const ch = this.canvas ? this.canvas.height : CONFIG.VIEW_HEIGHT;
        return { x: wx - Camera.x + cw / 2, y: wy - Camera.y + ch / 2 };
    },
    screenToWorld(sx, sy) {
        const info = this._camInfo();
        if (info) {
            // 客户区 → 相机空间 → 世界（getWorldPoint 内部按矩阵求逆，任何 zoom 均正确）
            const cxp = (sx - info.rect.left) * info.scaleX;
            const cyp = (sy - info.rect.top) * info.scaleY;
            const out = info.cam.getWorldPoint(cxp, cyp, { x: 0, y: 0 });
            return { x: out.x, y: out.y };
        }
        // 回退（无 Phaser 场景）：旧恒等换算
        const cw = this.canvas ? this.canvas.width : CONFIG.VIEW_WIDTH;
        const ch = this.canvas ? this.canvas.height : CONFIG.VIEW_HEIGHT;
        return { x: sx + Camera.x - cw / 2, y: sy + Camera.y - ch / 2 };
    },
    // 坐标显示转换：根据当前场景动态获取原点，向右为+X，向上为+Y
    _getSceneOrigin() {
        const sm = (SceneManager && SceneManager) ? SceneManager : null;
        if (sm && sm.currentScene && sm.scenes && sm.scenes[sm.currentScene] && sm.scenes[sm.currentScene].origin) {
            return sm.scenes[sm.currentScene].origin;
        }
        // 回退：使用全局配置的主场景原点
        const scenesCfg = GAME_CONFIG.scenes || {};
        const mainHubCfg = scenesCfg.mainHub || {};
        const originCfg = mainHubCfg.origin || { x: 3825, y: 1886 };
        return { x: originCfg.x, y: originCfg.y };
    },
    worldToDisplay(wx, wy) { const o = this._getSceneOrigin(); return { x: wx - o.x, y: wy - o.y }; },
    clear() { if (!this.ctx || !this.canvas) return; const clearColors = GAME_CONFIG.display?.clearColors || {}; const fill = (SceneManager.currentScene === 'scene7') ? (clearColors.scene7 || '#000000') : (clearColors.default || '#2a3520'); this.ctx.fillStyle = fill; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); },
    // 地形/网格/边界已迁移到 Phaser GameScene 的 _terrainSprite
};

export { Renderer };
