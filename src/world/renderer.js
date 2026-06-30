        import { SceneManager } from './scene-manager.js';
        import { isGunWeapon, isSemiAuto } from '../config/gun-ammo.js';
        import { Input } from '../ui/input.js';

const Renderer = {
            canvas: document.getElementById('gameCanvas'), ctx: null, terrainTexture: null,
            init() { if (!this.canvas) this.canvas = document.getElementById('gameCanvas'); if (!this.canvas) { console.error('gameCanvas not found'); return; } this.ctx = this.canvas.getContext('2d'); this.resize(); window.addEventListener('resize', () => this.resize()); },
            resize() { const w = window.innerWidth || 1920, h = window.innerHeight || 1080; if (w > 0 && h > 0) { this.canvas.width = w; this.canvas.height = h; CONFIG.VIEW_WIDTH = w; CONFIG.VIEW_HEIGHT = h; } },
            generateWorld() { const cw = this.canvas.width || window.innerWidth || 1920, ch = this.canvas.height || window.innerHeight || 1080; this.canvas.width = cw; this.canvas.height = ch; CONFIG.VIEW_WIDTH = cw; CONFIG.VIEW_HEIGHT = ch; CONFIG.WORLD_WIDTH = cw * 4; CONFIG.WORLD_HEIGHT = ch * 4; console.log('[WorldGen] canvasSize=' + cw + 'x' + ch + ', WORLD=' + CONFIG.WORLD_WIDTH + 'x' + CONFIG.WORLD_HEIGHT + ', canvas=' + (this.canvas ? 'OK' : 'NULL')); this.terrainTexture = MapGenerator.generateTerrainTexture(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT); WallSystem.init(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT); },
            // 渲染坐标转换：保持原始公式不变，所有世界坐标正常渲染
            worldToScreen(wx, wy) { return { x: wx - Camera.x + CONFIG.VIEW_WIDTH / 2 + Camera.shakeX, y: wy - Camera.y + CONFIG.VIEW_HEIGHT / 2 + Camera.shakeY }; },
            screenToWorld(sx, sy) { return { x: sx + Camera.x - CONFIG.VIEW_WIDTH / 2, y: sy + Camera.y - CONFIG.VIEW_HEIGHT / 2 }; },
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
                // 最终回退：硬编码主场景原点（避免显示 0,0）
                return { x: 3825, y: 1886 };
            },
            worldToDisplay(wx, wy) { const o = this._getSceneOrigin(); return { x: wx - o.x, y: -(wy - o.y) }; },
            clear() { if (!this.ctx) { return; } this.ctx.fillStyle = '#2a3520'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); },
            renderTerrain() {
                if (!this.terrainTexture) return;
                const ctx = this.ctx, offsetX = -Camera.x + CONFIG.VIEW_WIDTH / 2 + Camera.shakeX, offsetY = -Camera.y + CONFIG.VIEW_HEIGHT / 2 + Camera.shakeY;
                ctx.drawImage(this.terrainTexture, offsetX, offsetY, CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT);
                ctx.strokeStyle = '#8a4a4a'; ctx.lineWidth = 4; ctx.strokeRect(offsetX, offsetY, CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT);
            },
            renderGrid() {
                const ctx = this.ctx, offsetX = (-Camera.x + CONFIG.VIEW_WIDTH/2 + Camera.shakeX) % CONFIG.GRID_SIZE, offsetY = (-Camera.y + CONFIG.VIEW_HEIGHT/2 + Camera.shakeY) % CONFIG.GRID_SIZE;
                ctx.strokeStyle = 'rgba(90, 77, 63, 0.15)'; ctx.lineWidth = 1; ctx.beginPath();
                for (let x = offsetX; x < CONFIG.VIEW_WIDTH; x += CONFIG.GRID_SIZE) { ctx.moveTo(x, 0); ctx.lineTo(x, CONFIG.VIEW_HEIGHT); }
                for (let y = offsetY; y < CONFIG.VIEW_HEIGHT; y += CONFIG.GRID_SIZE) { ctx.moveTo(0, y); ctx.lineTo(CONFIG.VIEW_WIDTH, y); }
                ctx.stroke();
            },
            drawCrosshair() {
                if (!this.ctx || typeof Game === 'undefined' || !Game.player) {
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
                const lerpSpeed = 0.3; // 加快插值速度，减少延迟感
                this._crosshairSpread += (spreadFactor - this._crosshairSpread) * lerpSpeed;
                const spread = this._crosshairSpread;

                // 基础参数
                const baseGap = 4;      // 基础间隙
                const maxGapExtra = 16; // 最大额外间隙
                const gap = baseGap + spread * maxGapExtra;
                const lineLen = 6;      // 线长度
                const lineWidth = 2.5;  // 线粗细

                // 绘制十字准星（4条线 + 中心点）
                ctx.save();
                // 黑色描边（加粗，确保覆盖背景）
                ctx.strokeStyle = '#000';
                ctx.lineWidth = lineWidth + 2.5;
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
                ctx.strokeStyle = '#00ff00';
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
                ctx.fillStyle = '#000';
                ctx.beginPath(); ctx.arc(mx, my, 1.5, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#00ff00';
                ctx.beginPath(); ctx.arc(mx, my, 0.8, 0, Math.PI * 2); ctx.fill();

                ctx.restore();
            },
            renderMinimap() {
                if (!this.ctx || typeof Game === 'undefined' || !Game.player) return;
                const ctx = this.ctx;
                const minimapW = 150, minimapH = 150;
                const pad = 10;
                const mx = pad, my = pad + 50;
                const worldW = CONFIG.WORLD_WIDTH;
                const worldH = CONFIG.WORLD_HEIGHT;
                const scaleX = minimapW / worldW;
                const scaleY = minimapH / worldH;
                const scale = Math.min(scaleX, scaleY);
                // 背景
                ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                ctx.fillRect(mx, my, minimapW, minimapH);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.lineWidth = 1;
                ctx.strokeRect(mx, my, minimapW, minimapH);
                // 绘制墙壁
                if (typeof WallSystem !== 'undefined' && WallSystem.walls) {
                    ctx.fillStyle = 'rgba(80, 80, 80, 0.5)';
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
                ctx.strokeStyle = 'rgba(255, 200, 0, 0.6)';
                ctx.lineWidth = 1;
                ctx.strokeRect(viewX, viewY, viewW, viewH);
                // 绘制其他实体（怪物、传送门等）
                if (Game.entities) {
                    Game.entities.forEach(e => {
                        if (!e.active || e === Game.player) return;
                        const ex = mx + e.x * scale;
                        const ey = my + e.y * scale;
                        if (e.targetScene) { // 传送门
                            ctx.fillStyle = '#00aaff';
                            ctx.beginPath(); ctx.arc(ex, ey, 2.5, 0, Math.PI * 2); ctx.fill();
                        } else if (e instanceof Enemy) { // 怪物
                            ctx.fillStyle = '#ff4444';
                            ctx.beginPath(); ctx.arc(ex, ey, 1.5, 0, Math.PI * 2); ctx.fill();
                        } else if (e instanceof DropItem) { // 掉落物
                            ctx.fillStyle = '#ffd700';
                            ctx.beginPath(); ctx.arc(ex, ey, 1, 0, Math.PI * 2); ctx.fill();
                        }
                    });
                }
                // 绘制玩家（最上层，绿色）
                const px = mx + Game.player.x * scale;
                const py = my + Game.player.y * scale;
                ctx.fillStyle = '#00ff00';
                ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
                // 玩家方向箭头
                const dir = Game.player.rotation || 0;
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(px + Math.cos(dir) * 6, py + Math.sin(dir) * 6);
                ctx.stroke();
                // 小地图标题
                ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
                ctx.font = '10px SimHei, "Microsoft YaHei", sans-serif';
                ctx.textAlign = 'left';
                ctx.fillText('地图', mx + 4, my - 2);
            },
            renderTrainBackground() {
                const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
                const scroll = (Game && Game._trainScrollOffset) ? Game._trainScrollOffset : 0;
                const interiorHeight = 300;
                const interiorTop = (h - interiorHeight) / 2;
                const interiorBottom = interiorTop + interiorHeight;

                // 计算相机偏移（使背景随相机移动，避免错位）
                const camOffsetX = -Camera.x + CONFIG.VIEW_WIDTH / 2;

                // 天空/大地底色
                ctx.fillStyle = '#1a2518';
                ctx.fillRect(0, 0, w, h);

                // 远处地面
                ctx.fillStyle = '#2a3520';
                ctx.fillRect(0, 0, w, interiorTop - 50);
                ctx.fillRect(0, interiorBottom + 50, w, h - interiorBottom - 50);

                // 铁轨（上下各一组）
                const railScroll = -(scroll % 60) + camOffsetX;
                ctx.strokeStyle = '#5a5a4a';
                ctx.lineWidth = 2;
                const topRailY = interiorTop - 30;
                const bottomRailY = interiorBottom + 30;

                // 上铁轨
                ctx.beginPath(); ctx.moveTo(0, topRailY); ctx.lineTo(w, topRailY); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, topRailY + 6); ctx.lineTo(w, topRailY + 6); ctx.stroke();
                // 下铁轨
                ctx.beginPath(); ctx.moveTo(0, bottomRailY); ctx.lineTo(w, bottomRailY); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, bottomRailY + 6); ctx.lineTo(w, bottomRailY + 6); ctx.stroke();

                // 枕木（滚动）
                ctx.fillStyle = '#4a4a3a';
                for (let i = -1; i < w / 60 + 1; i++) {
                    const x = railScroll + i * 60;
                    ctx.fillRect(x, topRailY - 2, 5, 10);
                    ctx.fillRect(x, bottomRailY - 2, 5, 10);
                }

                // 地面植被/石块（视差滚动，速度提升一倍）——随机位置、随机大小，但保持一致
                const groundScroll = -(scroll * 1.0 % 150) + camOffsetX;
                ctx.fillStyle = '#1a2a0a';
                // 伪随机函数：基于seed的确定性随机
                const seededRandom = (seed) => {
                    const x = Math.sin(seed * 9301 + 49297) * 10000;
                    return x - Math.floor(x);
                };
                for (let i = -2; i < w / 150 + 8; i++) {
                    const baseX = groundScroll + i * 150;
                    // 每棵树的随机偏移和大小（基于i保持一致）
                    const treeOffset = seededRandom(i * 100) * 150; // 0~150px 范围内随机偏移
                    const treeSize = 8 + seededRandom(i * 200) * 12; // 8~20px 随机大小
                    const x = baseX + treeOffset;
                    // 上方树木
                    const gy = interiorTop - 95;
                    ctx.beginPath(); ctx.arc(x, gy, treeSize, 0, Math.PI * 2); ctx.fill();
                    // 下方树木
                    const gy2 = interiorBottom + 95;
                    ctx.beginPath(); ctx.arc(x, gy2, treeSize, 0, Math.PI * 2); ctx.fill();
                }
            }
        };

        

export { Renderer };
