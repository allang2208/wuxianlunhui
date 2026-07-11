import { Game } from '../game.js';
import { WallSystem } from '../world/wall-system.js';
import { Camera } from '../world/camera.js';
import { SceneManager } from './scene-manager.js';
import { isGunWeapon } from '../config/gun-ammo.js';
import { Input } from '../ui/input.js';
import { GAME_CONFIG } from '../config/game-config.js';

const Renderer = {
    canvas: document.getElementById('gameCanvas'), ctx: null, terrainTexture: null,
    init() { if (!this.canvas) this.canvas = document.getElementById('gameCanvas'); if (!this.canvas) { console.error('gameCanvas not found'); return; } this.ctx = this.canvas.getContext('2d'); this.resize(); window.addEventListener('resize', () => this.resize()); },
    resize() { if (!this.canvas || !this.ctx) return; const defaultRes = GAME_CONFIG.display?.defaultResolution || { width: 1920, height: 1080 }; const w = window.innerWidth || defaultRes.width || 1920, h = window.innerHeight || defaultRes.height || 1080; if (w > 0 && h > 0) { this.canvas.width = w; this.canvas.height = h; } },
    generateWorld() { if (!this.canvas || !this.ctx) return; const displayCfg = GAME_CONFIG.display || {}; const viewW = displayCfg.viewWidth || 1920; const viewH = displayCfg.viewHeight || 1080; const cw = this.canvas.width || window.innerWidth || viewW, ch = this.canvas.height || window.innerHeight || viewH; this.canvas.width = cw; this.canvas.height = ch; CONFIG.VIEW_WIDTH = viewW; CONFIG.VIEW_HEIGHT = viewH; const worldCfg = GAME_CONFIG.world || {}; const sm = (typeof SceneManager !== 'undefined') ? SceneManager : ((typeof window !== 'undefined' && window.SceneManager) ? window.SceneManager : null); if (sm && sm.currentScene === 'main') { CONFIG.WORLD_WIDTH = (worldCfg.main && worldCfg.main.width) || 7650; CONFIG.WORLD_HEIGHT = (worldCfg.main && worldCfg.main.height) || 3800; } else { CONFIG.WORLD_WIDTH = (worldCfg.default && worldCfg.default.width) || (viewW * 4); CONFIG.WORLD_HEIGHT = (worldCfg.default && worldCfg.default.height) || (viewH * 4); } if (typeof console !== 'undefined' && console.log) { console.log('[WorldGen] canvasSize=' + cw + 'x' + ch + ', VIEW=' + CONFIG.VIEW_WIDTH + 'x' + CONFIG.VIEW_HEIGHT + ', WORLD=' + CONFIG.WORLD_WIDTH + 'x' + CONFIG.WORLD_HEIGHT + ', scene=' + (sm ? sm.currentScene : 'none') + ', canvas=' + (this.canvas ? 'OK' : 'NULL')); } this.terrainTexture = MapGenerator.generateTerrainTexture(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT); WallSystem.init(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT); },
    // 渲染坐标转换：保持原始公式不变，所有世界坐标正常渲染
    worldToScreen(wx, wy) {
        const cw = this.canvas ? this.canvas.width : CONFIG.VIEW_WIDTH;
        const ch = this.canvas ? this.canvas.height : CONFIG.VIEW_HEIGHT;
        return { x: wx - Camera.x + cw / 2 + Camera.shakeX, y: wy - Camera.y + ch / 2 + Camera.shakeY };
    },
    screenToWorld(sx, sy) {
        const cw = this.canvas ? this.canvas.width : CONFIG.VIEW_WIDTH;
        const ch = this.canvas ? this.canvas.height : CONFIG.VIEW_HEIGHT;
        return { x: sx + Camera.x - cw / 2, y: sy + Camera.y - ch / 2 };
    },
    // 坐标显示转换：根据当前场景动态获取原点，向右为+X，向上为+Y
    _getSceneOrigin() {
        // 优先使用 window.SceneManager（main.js 已挂载到全局）
        const wsm = (typeof window !== 'undefined' && window.SceneManager) ? window.SceneManager : null;
        if (wsm && wsm.currentScene && wsm.scenes && wsm.scenes[wsm.currentScene] && wsm.scenes[wsm.currentScene].origin) {
            return wsm.scenes[wsm.currentScene].origin;
        }
        // 回退：使用导入的 SceneManager（如果可用）
        const sm = (typeof SceneManager !== 'undefined' && SceneManager) ? SceneManager : null;
        if (sm && sm.currentScene && sm.scenes && sm.scenes[sm.currentScene] && sm.scenes[sm.currentScene].origin) {
            return sm.scenes[sm.currentScene].origin;
        }
        // 最终回退：使用全局配置的主场景原点
        const scenesCfg = GAME_CONFIG.scenes || {};
        const mainHubCfg = scenesCfg.mainHub || {};
        const originCfg = mainHubCfg.origin || { x: 3825, y: 1886 };
        return { x: originCfg.x, y: originCfg.y };
    },
    worldToDisplay(wx, wy) { const o = this._getSceneOrigin(); return { x: wx - o.x, y: wy - o.y }; },
    clear() { if (!this.ctx || !this.canvas) return; const clearColors = GAME_CONFIG.display?.clearColors || {}; const fill = (SceneManager.currentScene === 'scene7') ? (clearColors.scene7 || '#000000') : (clearColors.default || '#2a3520'); this.ctx.fillStyle = fill; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); },
    renderTerrain() {
        if (!this.ctx || !this.canvas) return;
        if (!this.terrainTexture) return;
        const ctx = this.ctx;
        const cw = this.canvas.width || CONFIG.VIEW_WIDTH || 1920;
        const ch = this.canvas.height || CONFIG.VIEW_HEIGHT || 1080;
        const offsetX = -Camera.x + cw / 2 + Camera.shakeX;
        const offsetY = -Camera.y + ch / 2 + Camera.shakeY;
        ctx.drawImage(this.terrainTexture, offsetX, offsetY, CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT);
        // 地牢模式（1024×1024 小地图）不画边界框，避免黄框干扰
        if (SceneManager.currentScene !== 'scene7') {
            const borderCfg = GAME_CONFIG.worldBorder || {};
            ctx.strokeStyle = borderCfg.strokeStyle || '#8a4a4a';
            ctx.lineWidth = borderCfg.lineWidth || 4;
            ctx.strokeRect(offsetX, offsetY, CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT);
        }
    },
    renderGrid() {
        if (!this.ctx || !this.canvas) return;
        const ctx = this.ctx;
        const gridCfg = GAME_CONFIG.grid || {};
        const cw = this.canvas.width || CONFIG.VIEW_WIDTH || 1920;
        const ch = this.canvas.height || CONFIG.VIEW_HEIGHT || 1080;
        const gridSize = gridCfg.size || CONFIG.GRID_SIZE || 64;
        const offsetX = (-Camera.x + cw / 2 + Camera.shakeX) % gridSize;
        const offsetY = (-Camera.y + ch / 2 + Camera.shakeY) % gridSize;
        ctx.strokeStyle = gridCfg.strokeStyle || 'rgba(90, 77, 63, 0.15)';
        ctx.lineWidth = gridCfg.lineWidth || 1;
        ctx.beginPath();
        for (let x = offsetX; x < cw; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, ch); }
        for (let y = offsetY; y < ch; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(cw, y); }
        ctx.stroke();
    },
    drawCrosshair() {
        if (!this.ctx || !this.canvas) {
            document.body.style.cursor = 'default';
            return;
        }
        if (typeof Game === 'undefined' || !Game.player) {
            document.body.style.cursor = 'default';
            return;
        }
        const ctx = this.ctx;
        const player = Game.player;
        const currentWeapon = player.equipments[player.weaponMode];
        const isBowWeapon = currentWeapon && currentWeapon.weaponType === 'bow';
        if (!currentWeapon || (!isGunWeapon(currentWeapon) && !isBowWeapon)) {
            document.body.style.cursor = 'default';
            return;
        }

        // 装备枪械时隐藏鼠标光标
        document.body.style.cursor = 'none';

        const mx = Input.mouse.x, my = Input.mouse.y;
        // 获取散布因子（0~1），直接跟随玩家状态，减少延迟感
        let spreadFactor = player._currentSpreadFactor || 0;
        // 平滑准星：使用更快的插值速度，让准星更跟手
        if (!this._crosshairSpread) this._crosshairSpread = 0;
        const crosshairCfg = GAME_CONFIG.crosshair || {};
        const lerpSpeed = crosshairCfg.lerpSpeed || 0.3;
        this._crosshairSpread += (spreadFactor - this._crosshairSpread) * lerpSpeed;
        const spread = this._crosshairSpread;

        // 基础参数
        const geometry = crosshairCfg.geometry || { baseGap: 4, maxGapExtra: 16, lineLen: 6, lineWidth: 2.5, outlineWidth: 2.5 };
        const baseGap = geometry.baseGap || 4;
        const maxGapExtra = geometry.maxGapExtra || 16;
        const gap = baseGap + spread * maxGapExtra;
        const lineLen = geometry.lineLen || 6;
        const lineWidth = geometry.lineWidth || 2.5;
        const outlineWidth = geometry.outlineWidth || 2.5;
        const colors = crosshairCfg.colors || { outline: '#000', main: '#00ff00' };
        const centerDot = crosshairCfg.centerDot || { outerRadius: 1.5, innerRadius: 0.8 };

        // 绘制十字准星（4条线 + 中心点）
        ctx.save();
        // 黑色描边（加粗，确保覆盖背景）
        ctx.strokeStyle = colors.outline || '#000';
        ctx.lineWidth = lineWidth + outlineWidth;
        ctx.lineCap = 'round';
        // 上
        ctx.beginPath(); ctx.moveTo(mx, my - gap); ctx.lineTo(mx, my - gap - lineLen); ctx.stroke();
        // 下
        ctx.beginPath(); ctx.moveTo(mx, my + gap); ctx.lineTo(mx, my + gap + lineLen); ctx.stroke();
        // 左
        ctx.beginPath(); ctx.moveTo(mx - gap, my); ctx.lineTo(mx - gap - lineLen, my); ctx.stroke();
        // 右
        ctx.beginPath(); ctx.moveTo(mx + gap, my); ctx.lineTo(mx + gap + lineLen, my); ctx.stroke();

        // 绿色主体
        ctx.strokeStyle = colors.main || '#00ff00';
        ctx.lineWidth = lineWidth;
        // 上
        ctx.beginPath(); ctx.moveTo(mx, my - gap); ctx.lineTo(mx, my - gap - lineLen); ctx.stroke();
        // 下
        ctx.beginPath(); ctx.moveTo(mx, my + gap); ctx.lineTo(mx, my + gap + lineLen); ctx.stroke();
        // 左
        ctx.beginPath(); ctx.moveTo(mx - gap, my); ctx.lineTo(mx - gap - lineLen, my); ctx.stroke();
        // 右
        ctx.beginPath(); ctx.moveTo(mx + gap, my); ctx.lineTo(mx + gap + lineLen, my); ctx.stroke();

        // 中心空心点（CS风格）
        ctx.fillStyle = colors.outline || '#000';
        ctx.beginPath(); ctx.arc(mx, my, centerDot.outerRadius || 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = colors.main || '#00ff00';
        ctx.beginPath(); ctx.arc(mx, my, centerDot.innerRadius || 0.8, 0, Math.PI * 2); ctx.fill();

        ctx.restore();
    },
    renderMinimap() {
        if (!this.ctx || !this.canvas) return;
        if (typeof Game === 'undefined' || !Game.player) return;
        if (Game._npcDialoguePaused) return; // 对话时隐藏小地图
        const ctx = this.ctx;
        const minimapCfg = GAME_CONFIG.minimap || {};
        const minimapW = minimapCfg.width || 150;
        const minimapH = minimapCfg.height || 150;
        const pad = minimapCfg.padding || 10;
        const offsetY = minimapCfg.offsetY || 50;
        const mx = pad, my = pad + offsetY;
        const worldW = CONFIG.WORLD_WIDTH;
        const worldH = CONFIG.WORLD_HEIGHT;
        const scaleX = minimapW / worldW;
        const scaleY = minimapH / worldH;
        const scale = Math.min(scaleX, scaleY);
        const styles = minimapCfg.styles || {};
        const sizes = minimapCfg.sizes || {};
        // 背景
        const bg = minimapCfg.background || {};
        ctx.fillStyle = bg.fill || 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(mx, my, minimapW, minimapH);
        ctx.strokeStyle = bg.border || 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = bg.lineWidth || 1;
        ctx.strokeRect(mx, my, minimapW, minimapH);
        // 绘制墙壁
        if (typeof WallSystem !== 'undefined' && WallSystem.walls) {
            ctx.fillStyle = styles.wall || 'rgba(80, 80, 80, 0.5)';
            for (const w of WallSystem.walls) {
                const wx = mx + w.x * scale;
                const wy = my + w.y * scale;
                const ww = Math.max(0.5, w.w * scale);
                const wh = Math.max(0.5, w.h * scale);
                ctx.fillRect(wx, wy, ww, wh);
            }
        }
        // 绘制相机视野框
        const viewX = mx + (Camera.x - CONFIG.VIEW_WIDTH / 2) * scale;
        const viewY = my + (Camera.y - CONFIG.VIEW_HEIGHT / 2) * scale;
        const viewW = Math.max(1, CONFIG.VIEW_WIDTH * scale);
        const viewH = Math.max(1, CONFIG.VIEW_HEIGHT * scale);
        ctx.strokeStyle = styles.viewport || 'rgba(255, 200, 0, 0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(viewX, viewY, viewW, viewH);
        // 绘制裂隙（任务模式雪地场景）
        if (SceneManager.currentScene === 'scene2' && typeof RiftSystem !== 'undefined' && RiftSystem.rifts) {
            for (const rift of RiftSystem.rifts) {
                if (rift.completed) continue;
                const rx = mx + rift.x * scale;
                const ry = my + rift.y * scale;
                ctx.fillStyle = styles.rift || '#00008B';
                ctx.beginPath(); ctx.arc(rx, ry, sizes.rift || 2, 0, Math.PI * 2); ctx.fill();
            }
        }
        // 绘制其他实体（怪物、传送门等）
        if (Game.entities && typeof Game.entities.forEach === 'function') {
            Game.entities.forEach(e => {
                if (!e || e === Game.player || !e.active) return;
                if (typeof e.x !== 'number' || typeof e.y !== 'number' || isNaN(e.x) || isNaN(e.y)) return;
                const ex = mx + e.x * scale;
                const ey = my + e.y * scale;
                if (e.targetScene) { // 传送门
                    ctx.fillStyle = styles.portal || '#00aaff';
                    ctx.beginPath(); ctx.arc(ex, ey, sizes.portal || 2.5, 0, Math.PI * 2); ctx.fill();
                } else if (e.name === '大块头') {
                    ctx.fillStyle = styles.boss || '#ff0000';
                    ctx.font = sizes.bossFont || 'bold 10px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('❌', ex, ey + 3);
                } else if (e._faction === 'enemy') { // 怪物
                    ctx.fillStyle = styles.enemy || '#ff4444';
                    ctx.beginPath(); ctx.arc(ex, ey, sizes.enemy || 1.5, 0, Math.PI * 2); ctx.fill();
                } else if (e.itemData) { // 掉落物
                    ctx.fillStyle = styles.item || '#ffd700';
                    ctx.beginPath(); ctx.arc(ex, ey, sizes.item || 1, 0, Math.PI * 2); ctx.fill();
                }
            });
        }
        // 绘制玩家（最上层，绿色）
        const px = mx + Game.player.x * scale;
        const py = my + Game.player.y * scale;
        ctx.fillStyle = styles.player || '#00ff00';
        ctx.beginPath(); ctx.arc(px, py, sizes.player || 3, 0, Math.PI * 2); ctx.fill();
        // 玩家方向箭头
        const dir = Game.player.rotation || 0;
        ctx.strokeStyle = styles.player || '#00ff00';
        ctx.lineWidth = sizes.arrowLineWidth || 1.5;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(dir) * (sizes.arrowLen || 6), py + Math.sin(dir) * (sizes.arrowLen || 6));
        ctx.stroke();
        // 小地图标题
        const title = minimapCfg.title || {};
        ctx.fillStyle = title.color || 'rgba(212, 197, 169, 0.8)';
        ctx.font = title.font || '10px SimHei, "Microsoft YaHei", sans-serif';
        ctx.textAlign = title.align || 'left';
        ctx.fillText(title.text || '地图', mx + (title.offsetX || 4), my + (title.offsetY || -2));
    },
    renderTrainBackground() {
        if (!this.ctx || !this.canvas) return;
        const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
        const scroll = (Game && Game._trainScrollOffset) ? Game._trainScrollOffset : 0;
        const trainCfg = GAME_CONFIG.scene3?.trainBackground || {};
        const vegCfg = GAME_CONFIG.scene3?.groundVegetation || {};
        const interiorHeight = trainCfg.interiorHeight || 300;
        const interiorTop = (h - interiorHeight) / 2;
        const interiorBottom = interiorTop + interiorHeight;

        // 计算相机偏移（使背景随相机移动，避免错位）
        const displayCfg = GAME_CONFIG.display || {};
        const viewW = displayCfg.viewWidth || CONFIG.VIEW_WIDTH || 1920;
        const camOffsetX = -Camera.x + viewW / 2;

        // 天空/大地底色
        ctx.fillStyle = trainCfg.skyColor || '#1a2518';
        ctx.fillRect(0, 0, w, h);

        // 远处地面
        ctx.fillStyle = trainCfg.groundColor || '#2a3520';
        ctx.fillRect(0, 0, w, interiorTop - (trainCfg.groundMargin || 50));
        ctx.fillRect(0, interiorBottom + (trainCfg.groundMargin || 50), w, h - interiorBottom - (trainCfg.groundMargin || 50));

        // 铁轨（上下各一组）
        const railSpacing = trainCfg.railSpacing || 60;
        const railScroll = -(scroll % railSpacing) + camOffsetX;
        ctx.strokeStyle = trainCfg.railColor || '#5a5a4a';
        ctx.lineWidth = trainCfg.railLineWidth || 2;
        const topRailY = interiorTop - (trainCfg.railOffsetY || 30);
        const bottomRailY = interiorBottom + (trainCfg.railOffsetY || 30);

        // 上铁轨
        ctx.beginPath(); ctx.moveTo(0, topRailY); ctx.lineTo(w, topRailY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, topRailY + (trainCfg.railPairOffset || 6)); ctx.lineTo(w, topRailY + (trainCfg.railPairOffset || 6)); ctx.stroke();
        // 下铁轨
        ctx.beginPath(); ctx.moveTo(0, bottomRailY); ctx.lineTo(w, bottomRailY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, bottomRailY + (trainCfg.railPairOffset || 6)); ctx.lineTo(w, bottomRailY + (trainCfg.railPairOffset || 6)); ctx.stroke();

        // 枕木（滚动）
        ctx.fillStyle = trainCfg.sleeperColor || '#4a4a3a';
        const sleeperW = trainCfg.sleeperWidth || 5;
        const sleeperH = trainCfg.sleeperHeight || 10;
        for (let i = -1; i < w / railSpacing + 1; i++) {
            const x = railScroll + i * railSpacing;
            ctx.fillRect(x, topRailY - 2, sleeperW, sleeperH);
            ctx.fillRect(x, bottomRailY - 2, sleeperW, sleeperH);
        }

        // 地面植被/石块（视差滚动，速度提升一倍）——随机位置、随机大小，但保持一致
        const vegSpacing = vegCfg.spacing || 150;
        const groundScroll = -(scroll * (vegCfg.scrollSpeed || 1.0) % vegSpacing) + camOffsetX;
        ctx.fillStyle = vegCfg.color || '#1a2a0a';
        // 伪随机函数：基于seed的确定性随机
        const seededRandom = (seed) => {
            const x = Math.sin(seed * 9301 + 49297) * 10000;
            return x - Math.floor(x);
        };
        for (let i = -2; i < w / vegSpacing + 8; i++) {
            const baseX = groundScroll + i * vegSpacing;
            // 每棵树的随机偏移和大小（基于i保持一致）
            const treeOffset = seededRandom(i * 100) * vegSpacing;
            const treeSize = (vegCfg.minSize || 8) + seededRandom(i * 200) * ((vegCfg.maxSize || 20) - (vegCfg.minSize || 8));
            const x = baseX + treeOffset;
            // 上方树木
            const gy = interiorTop - (vegCfg.groundOffsetY || 95);
            ctx.beginPath(); ctx.arc(x, gy, treeSize, 0, Math.PI * 2); ctx.fill();
            // 下方树木
            const gy2 = interiorBottom + (vegCfg.groundOffsetY || 95);
            ctx.beginPath(); ctx.arc(x, gy2, treeSize, 0, Math.PI * 2); ctx.fill();
        }
    }
};

export { Renderer };
