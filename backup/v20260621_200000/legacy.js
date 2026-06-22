
        const CONFIG = {
            WORLD_WIDTH: 0, WORLD_HEIGHT: 0, VIEW_WIDTH: 0, VIEW_HEIGHT: 0,
            PLAYER_SPEED: 0.875, PLAYER_SPRINT: 2, PLAYER_SIZE: 14, PLAYER_COLOR: '#7a9a6a',
            STAMINA_MAX: 200, STAMINA_REGEN: 120,
            STAMINA_MELEE_COST: 16.67, STAMINA_RANGED_COST: 16.67,
            STAMINA_SPRINT_COST: 8, STAMINA_DODGE_COST: 25,
            DODGE_SPEED: 12, DODGE_DURATION: 200, DODGE_COOLDOWN: 800,
            CRIT_SHAKE_DURATION: 200, CRIT_FLASH_DURATION: 150,
            CAMERA_SMOOTH: 0.12, GRID_SIZE: 60,
            KEYS: { W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD', SHIFT: 'ShiftLeft', SPACE: 'Space', INVENTORY: 'KeyI', EQUIP: 'KeyC', SKILL: 'KeyK', CODEX: 'KeyL', MENU: 'Escape', SKILL_Q: 'KeyQ', SKILL_E: 'KeyE', SKILL_R: 'KeyR', SKILL_F: 'KeyF', ITEM_1: 'Digit1', ITEM_2: 'Digit2', ITEM_3: 'Digit3', ITEM_4: 'Digit4' }
        };

        const MathUtils = {
            distance(x1, y1, x2, y2) { return Math.sqrt((x2-x1)**2 + (y2-y1)**2); },
            angleBetween(x1, y1, x2, y2) { return Math.atan2(y2-y1, x2-x1); },
            pointInSector(px, py, cx, cy, angle, radius, arcAngle) {
                const dist = this.distance(px, py, cx, cy);
                if (dist > radius) return false;
                const pointAngle = this.angleBetween(cx, cy, px, py);
                let diff = Math.abs(pointAngle - angle);
                if (diff > Math.PI) diff = 2 * Math.PI - diff;
                return diff <= arcAngle / 2;
            },
            pointToLineDistance(px, py, x1, y1, x2, y2) {
                const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
                const dot = A * C + B * D, lenSq = C * C + D * D;
                let param = -1;
                if (lenSq !== 0) param = dot / lenSq;
                let xx, yy;
                if (param < 0) { xx = x1; yy = y1; }
                else if (param > 1) { xx = x2; yy = y2; }
                else { xx = x1 + param * C; yy = y1 + param * D; }
                const dx = px - xx, dy = py - yy;
                return Math.sqrt(dx * dx + dy * dy);
            },
            randomRange(min, max) { return min + Math.random() * (max - min); }
        };

        const Renderer = {
            canvas: document.getElementById('gameCanvas'), ctx: null, terrainTexture: null,
            init() { if (!this.canvas) this.canvas = document.getElementById('gameCanvas'); if (!this.canvas) { console.error('gameCanvas not found'); return; } this.ctx = this.canvas.getContext('2d'); this.resize(); window.addEventListener('resize', () => this.resize()); },
            resize() { const w = window.innerWidth || 1920, h = window.innerHeight || 1080; if (w > 0 && h > 0) { this.canvas.width = w; this.canvas.height = h; CONFIG.VIEW_WIDTH = w; CONFIG.VIEW_HEIGHT = h; } },
            generateWorld() { const cw = this.canvas.width || window.innerWidth || 1920, ch = this.canvas.height || window.innerHeight || 1080; this.canvas.width = cw; this.canvas.height = ch; CONFIG.VIEW_WIDTH = cw; CONFIG.VIEW_HEIGHT = ch; CONFIG.WORLD_WIDTH = cw * 4; CONFIG.WORLD_HEIGHT = ch * 4; this.terrainTexture = MapGenerator.generateTerrainTexture(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT); WallSystem.init(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT); },
            worldToScreen(wx, wy) { return { x: wx - Camera.x + CONFIG.VIEW_WIDTH / 2 + Camera.shakeX, y: wy - Camera.y + CONFIG.VIEW_HEIGHT / 2 + Camera.shakeY }; },
            screenToWorld(sx, sy) { return { x: sx + Camera.x - CONFIG.VIEW_WIDTH / 2, y: sy + Camera.y - CONFIG.VIEW_HEIGHT / 2 }; },
            clear() { this.ctx.fillStyle = '#2a3520'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); },
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
            }
        };

        
const Camera = {
            x: 0, y: 0, shakeX: 0, shakeY: 0, shakeIntensity: 0, shakeDecay: 0.85,
            follow(target) { this.x = target.x; this.y = target.y; },
            update(target) {
                // 平滑跟随（使用 CAMERA_SMOOTH 插值）
                this.x += (target.x - this.x) * CONFIG.CAMERA_SMOOTH;
                this.y += (target.y - this.y) * CONFIG.CAMERA_SMOOTH;
                if (this.shakeIntensity > 0.5) { this.shakeX = (Math.random() - 0.5) * this.shakeIntensity; this.shakeY = (Math.random() - 0.5) * this.shakeIntensity; this.shakeIntensity *= this.shakeDecay; }
                else { this.shakeX = 0; this.shakeY = 0; this.shakeIntensity = 0; }
                // 边界限制：只在世界边界处限制，允许 Camera 跟随到任何位置
                const halfW = CONFIG.VIEW_WIDTH / 2, halfH = CONFIG.VIEW_HEIGHT / 2;
                this.x = Math.max(halfW, Math.min(CONFIG.WORLD_WIDTH - halfW, this.x));
                this.y = Math.max(halfH, Math.min(CONFIG.WORLD_HEIGHT - halfH, this.y));
            },
            triggerShake(intensity) { this.shakeIntensity = intensity; }
        };

        
const MapGenerator = {
            generateTerrainTexture(width, height) {
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#3d4a35'; ctx.fillRect(0, 0, width, height);
                for (let i = 0; i < 8000; i++) {
                    const x = Math.random() * width, y = Math.random() * height, size = Math.random() * 3 + 1, alpha = Math.random() * 0.15 + 0.05;
                    ctx.fillStyle = Math.random() > 0.5 ? `rgba(90, 110, 70, ${alpha})` : `rgba(60, 80, 50, ${alpha})`;
                    ctx.fillRect(x, y, size, size);
                }
                this.generatePaths(ctx, width, height);
                this.generateWater(ctx, width, height);
                this.generateTrees(ctx, width, height);
                this.generateRocks(ctx, width, height);
                return canvas;
            },
            generatePaths(ctx, w, h) {
                ctx.strokeStyle = '#6b5d4f'; ctx.lineWidth = 12; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(0, h * 0.5); ctx.lineTo(w, h * 0.5); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(w * 0.5, 0); ctx.lineTo(w * 0.5, h); ctx.stroke();
                ctx.strokeStyle = '#5a4d4f'; ctx.lineWidth = 6;
                for (let i = 0; i < 5; i++) {
                    ctx.beginPath(); const startX = Math.random() * w, startY = Math.random() * h;
                    ctx.moveTo(startX, startY); ctx.lineTo(startX + (Math.random() - 0.5) * 400, startY + (Math.random() - 0.5) * 400); ctx.stroke();
                }
            },
            generateWater(ctx, w, h) {
                for (let i = 0; i < 3; i++) {
                    const cx = Math.random() * w, cy = Math.random() * h, rx = 30 + Math.random() * 50, ry = 20 + Math.random() * 40;
                    ctx.fillStyle = 'rgba(80, 100, 120, 0.6)'; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = 'rgba(100, 120, 140, 0.3)'; ctx.lineWidth = 1;
                    for (let r = 5; r < Math.max(rx, ry); r += 8) { ctx.beginPath(); ctx.ellipse(cx, cy, rx * (r/Math.max(rx,ry)), ry * (r/Math.max(rx,ry)), 0, 0, Math.PI*2); ctx.stroke(); }
                }
            },
            generateTrees(ctx, w, h) {
                for (let i = 0; i < 150; i++) {
                    const x = Math.random() * w, y = Math.random() * h;
                    ctx.fillStyle = '#4a3f35'; ctx.fillRect(x - 2, y, 4, 8);
                    ctx.fillStyle = Math.random() > 0.5 ? '#2d4a25' : '#3d5a35'; ctx.beginPath(); ctx.arc(x, y - 4, 6 + Math.random() * 6, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = 'rgba(90, 120, 70, 0.2)'; ctx.beginPath(); ctx.arc(x - 2, y - 6, 3, 0, Math.PI * 2); ctx.fill();
                }
            },
            generateRocks(ctx, w, h) {
                for (let i = 0; i < 40; i++) {
                    const x = Math.random() * w, y = Math.random() * h, size = 3 + Math.random() * 8;
                    ctx.fillStyle = '#6a6a6a'; ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = '#8a8a8a'; ctx.beginPath(); ctx.arc(x - 1, y - 1, size * 0.6, 0, Math.PI * 2); ctx.fill();
                }
            }
        };

        

// ==================== 迷宫生成器 ====================
const MazeGenerator = {
    CELL_SIZE: 120,
    WALL_THICKNESS: 16,
    generate(w, h) {
        const rows = Math.floor(h / this.CELL_SIZE);
        const cols = Math.floor(w / this.CELL_SIZE);
        const grid = [];
        for (let r = 0; r < rows; r++) {
            grid[r] = [];
            for (let c = 0; c < cols; c++) {
                grid[r][c] = { top: true, right: true, bottom: true, left: true, visited: false };
            }
        }
        this.carve(0, 0, grid, rows, cols);
        grid[0][0].top = false;
        grid[rows-1][cols-1].bottom = false;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (Math.random() < 0.12) grid[r][c].right = false;
                if (Math.random() < 0.12) grid[r][c].bottom = false;
            }
        }
        return this.gridToWalls(grid, rows, cols);
    },
    carve(r, c, grid, rows, cols) {
        grid[r][c].visited = true;
        const dirs = [
            { dr: -1, dc: 0, wall: 'top', opp: 'bottom' },
            { dr: 1, dc: 0, wall: 'bottom', opp: 'top' },
            { dr: 0, dc: -1, wall: 'left', opp: 'right' },
            { dr: 0, dc: 1, wall: 'right', opp: 'left' }
        ];
        for (let i = dirs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
        }
        for (const d of dirs) {
            const nr = r + d.dr, nc = c + d.dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !grid[nr][nc].visited) {
                grid[r][c][d.wall] = false;
                grid[nr][nc][d.opp] = false;
                this.carve(nr, nc, grid, rows, cols);
            }
        }
    },
    gridToWalls(grid, rows, cols) {
        const walls = [];
        const cs = this.CELL_SIZE, wt = this.WALL_THICKNESS;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cx = c * cs, cy = r * cs;
                if (grid[r][c].top)    walls.push({ x: cx - wt/2, y: cy - wt/2, w: cs + wt, h: wt });
                if (grid[r][c].right)  walls.push({ x: cx + cs - wt/2, y: cy - wt/2, w: wt, h: cs + wt });
                if (grid[r][c].bottom) walls.push({ x: cx - wt/2, y: cy + cs - wt/2, w: cs + wt, h: wt });
                if (grid[r][c].left)   walls.push({ x: cx - wt/2, y: cy - wt/2, w: wt, h: cs + wt });
            }
        }
        return this.dedup(walls);
    },
    dedup(walls) {
        const result = [];
        for (const w of walls) {
            let found = false;
            for (const r of result) {
                if (w.h === r.h && Math.abs(w.y - r.y) < 2 && w.x <= r.x + r.w + 2 && r.x <= w.x + w.w + 2) {
                    const minX = Math.min(w.x, r.x), maxX = Math.max(w.x + w.w, r.x + r.w);
                    r.x = minX; r.w = maxX - minX; found = true; break;
                }
                if (w.w === r.w && Math.abs(w.x - r.x) < 2 && w.y <= r.y + r.h + 2 && r.y <= w.y + w.h + 2) {
                    const minY = Math.min(w.y, r.y), maxY = Math.max(w.y + w.h, r.y + r.h);
                    r.y = minY; r.h = maxY - minY; found = true; break;
                }
            }
            if (!found) result.push({ x: w.x, y: w.y, w: w.w, h: w.h });
        }
        return result;
    },
    render(ctx, offsetX, offsetY) {
        const walls = WallSystem.getWallsInView(offsetX, offsetY, CONFIG.VIEW_WIDTH, CONFIG.VIEW_HEIGHT);
        for (const w of walls) {
            const sx = w.x - offsetX, sy = w.y - offsetY;
            // 墙壁主体：深棕色石墙
            ctx.fillStyle = '#6b5a4a';
            ctx.fillRect(sx, sy, w.w, w.h);
            // 墙壁高光边缘
            ctx.strokeStyle = '#8a7a6a'; ctx.lineWidth = 1;
            ctx.strokeRect(sx, sy, w.w, w.h);
            // 砖块纹理效果（每隔一段画一条线）
            ctx.strokeStyle = '#5a4a3a'; ctx.lineWidth = 0.5;
            if (w.w > w.h) { // 水平墙
                for (let bx = sx + 20; bx < sx + w.w; bx += 30) { ctx.beginPath(); ctx.moveTo(bx, sy); ctx.lineTo(bx, sy + w.h); ctx.stroke(); }
            } else { // 垂直墙
                for (let by = sy + 20; by < sy + w.h; by += 20) { ctx.beginPath(); ctx.moveTo(sx, by); ctx.lineTo(sx + w.w, by); ctx.stroke(); }
            }
        }
    }
};

// ==================== 墙壁管理系统 ====================
const WallSystem = {
    walls: [],
    mazeEndY: 0,
    init(ww, wh) {
        this.walls = [];
        const mazeH = wh * 0.25, mazeW = ww * 0.6, mazeOX = ww * 0.2;
        // 迷宫顶部边距：确保入口在 Camera 可跟随区域（halfH 以上）
        const mazeOY = Math.max(wh * 0.12, CONFIG.VIEW_HEIGHT * 0.55);
        this._mazeOX = mazeOX; this._mazeOY = mazeOY; this._mazeH = mazeH; this._mazeW = mazeW;
        const mazeWalls = MazeGenerator.generate(mazeW, mazeH);
        for (const w of mazeWalls) this.walls.push({ x: w.x + mazeOX, y: w.y + mazeOY, w: w.w, h: w.h });
        this.walls.push({ x: mazeOX - 16, y: mazeOY, w: 16, h: mazeH });
        this.walls.push({ x: mazeOX + mazeW, y: mazeOY, w: 16, h: mazeH });
        // 顶部边界分两段，避开入口（第一个格子顶部，宽CELL_SIZE）
        const cs = MazeGenerator.CELL_SIZE;
        this.walls.push({ x: mazeOX - 16, y: mazeOY - 16, w: 16, h: 16 }); // 左上角封头
        this.walls.push({ x: mazeOX + cs, y: mazeOY - 16, w: mazeW - cs + 16, h: 16 }); // 入口右侧顶部边界
        this.walls.push({ x: mazeOX - 16, y: mazeOY + mazeH, w: mazeW + 32, h: 16 }); // 底部边界
        this.mazeEndY = mazeOY + mazeH;
    },
    getWallsInView(vx, vy, vw, vh) {
        const result = [];
        for (const w of this.walls) {
            if (w.x + w.w > vx && w.x < vx + vw && w.y + w.h > vy && w.y < vy + vh) result.push(w);
        }
        return result;
    },
    circleRect(cx, cy, r, rect) {
        const clX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
        const clY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
        return (cx - clX) ** 2 + (cy - clY) ** 2 < r * r;
    },
    canMoveTo(x, y, radius) {
        for (const w of this.walls) if (this.circleRect(x, y, radius, w)) return false;
        return true;
    },
    resolve(x, y, nx, ny, r) {
        if (this.canMoveTo(nx, ny, r)) return { x: nx, y: ny };
        if (this.canMoveTo(nx, y, r)) return { x: nx, y };
        if (this.canMoveTo(x, ny, r)) return { x, y: ny };
        return { x, y };
    },
    lineRect(x1, y1, x2, y2, rect) {
        const dx = x2 - x1, dy = y2 - y1;
        let u1 = 0, u2 = 1;
        const p = [-dx, dx, -dy, dy], q = [x1 - rect.x, rect.x + rect.w - x1, y1 - rect.y, rect.y + rect.h - y1];
        for (let i = 0; i < 4; i++) {
            if (p[i] === 0) { if (q[i] < 0) return false; }
            else { const t = q[i] / p[i]; if (p[i] < 0) { if (t > u1) u1 = t; } else { if (t < u2) u2 = t; } }
        }
        return u1 < u2;
    },
    blocked(x1, y1, x2, y2) {
        for (const w of this.walls) if (this.lineRect(x1, y1, x2, y2, w)) return true;
        return false;
    }
};

const EffectManager = {
    effects: [], critFlash: 0,
    _pools: {},
    _factories: {
        'BloodEffect': () => new BloodEffect(0, 0, 0),
        'Projectile': () => new Projectile(0, 0, 0, 0, 0, 0, {min:0,max:0}, false, null, null, null),
        'DustEffect': () => new DustEffect(0, 0, 1.0),
        'DodgeEffect': () => new DodgeEffect(0, 0, 1, 0),
        'SmokeEffect': () => new SmokeEffect(0, 0),
        'MuzzleFlashEffect': () => new MuzzleFlashEffect(0, 0, 0),
        'ShellCasingEffect': () => new ShellCasingEffect(0, 0, 0),
    },
    _acquire(type) {
        if (!this._pools[type]) this._pools[type] = [];
        let obj = this._pools[type].pop();
        if (!obj) obj = this._factories[type] ? this._factories[type]() : {};
        obj.active = true;
        return obj;
    },
    _release(type, obj) {
        if (!this._pools[type]) this._pools[type] = [];
        this._pools[type].push(obj);
    },
    add(effect) { this.effects.push(effect); },
    update() {
        this.effects = this.effects.filter(e => { e.update(); return e.active; });
        if (this.critFlash > 0) { this.critFlash -= 0.08; if (this.critFlash < 0) this.critFlash = 0; }
    },
    render(ctx) {
        this.effects.forEach(e => e.render(ctx));
        if (this.critFlash > 0) { ctx.fillStyle = `rgba(255, 255, 255, ${this.critFlash * 0.4})`; ctx.fillRect(0, 0, CONFIG.VIEW_WIDTH, CONFIG.VIEW_HEIGHT); }
    },
    createDamageText(x, y, damage, isCrit) {
        const el = document.createElement('div'); el.className = 'combat-text'; el.textContent = isCrit ? `暴击! ${damage}` : `${damage}`;
        el.style.color = isCrit ? '#ffaa44' : '#ff6666'; el.style.fontSize = isCrit ? '22px' : '18px';
        const screenPos = Renderer.worldToScreen(x, y); el.style.left = screenPos.x + 'px'; el.style.top = screenPos.y + 'px';
        const uiLayer = document.getElementById('uiLayer'); if (uiLayer) uiLayer.appendChild(el); setTimeout(() => { if (el) el.remove(); }, 1000);
    },
    triggerCritEffects() { this.critFlash = 1.0; Camera.triggerShake(12); }
};

class SlashEffect {
            constructor(x, y, angle, range, arc) {
                this.x = x; this.y = y; this.angle = angle; this.range = range; this.arc = arc;
                this.life = 350; this.maxLife = 350; this.active = true;
                this.startAngle = angle - arc / 2; this.endAngle = angle + arc / 2;
                this.currentAngle = this.startAngle;
                this.swingSpeed = arc / 6; // 更流畅的展开速度
            }
            update() {
                this.life -= 12;
                if (this.currentAngle < this.endAngle) {
                    this.currentAngle += this.swingSpeed;
                    if (this.currentAngle > this.endAngle) this.currentAngle = this.endAngle;
                }
                if (this.life <= 0) this.active = false;
            }
            render(ctx) {
                const alpha = Math.min(1, this.life / 200);
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save();
                ctx.translate(screenPos.x, screenPos.y);

                // 动态展开扇形
                const currentSweep = this.currentAngle - this.startAngle;
                if (currentSweep > 0) {
                    // 径向渐变：中心不透明 → 边缘淡出
                    const gradient = ctx.createRadialGradient(0, 0, this.range * 0.05, 0, 0, this.range);
                    gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.7})`);
                    gradient.addColorStop(0.2, `rgba(230, 210, 180, ${alpha * 0.5})`);
                    gradient.addColorStop(0.6, `rgba(212, 197, 169, ${alpha * 0.2})`);
                    gradient.addColorStop(1, `rgba(212, 197, 169, 0)`);

                    ctx.fillStyle = gradient;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.arc(0, 0, this.range, this.startAngle, this.currentAngle);
                    ctx.closePath();
                    ctx.fill();

                    // 扇形边缘高光
                    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.5})`;
                    ctx.lineWidth = 2.5;
                    ctx.beginPath();
                    ctx.arc(0, 0, this.range, this.startAngle, this.currentAngle);
                    ctx.stroke();

                    // 两侧边缘线
                    ctx.strokeStyle = `rgba(230, 210, 180, ${alpha * 0.4})`;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.lineTo(Math.cos(this.startAngle) * this.range, Math.sin(this.startAngle) * this.range);
                    ctx.moveTo(0, 0);
                    ctx.lineTo(Math.cos(this.currentAngle) * this.range, Math.sin(this.currentAngle) * this.range);
                    ctx.stroke();
                }

                ctx.restore();
            }
        }

        class ThrustEffect {
            constructor(source, range, width) {
                this.source = source; this.range = range || 100; this.width = width || 20;
                this.life = 350; this.maxLife = 350; this.active = true; this.progress = 0; this.speed = 0.12;
                // 防御性检查：source 必须有效
                if (!source || typeof source.x !== 'number' || typeof source.y !== 'number' || typeof source.rotation !== 'number') {
                    console.warn('ThrustEffect: invalid source', source);
                    this.active = false; this.source = { x: 0, y: 0, rotation: 0 };
                }
                if (!ThrustEffect._img) {
                    ThrustEffect._img = new Image();
                    ThrustEffect._img.src = 'assets/icons/sword_hilt_icon.png';
                }
            }
            update() {
                this.life -= 14;
                this.progress += this.speed;
                if (this.progress > 1) this.progress = 1;
                if (this.life <= 0) this.active = false;
            }
            render(ctx) {
                if (!ThrustEffect._img || !ThrustEffect._img.complete || ThrustEffect._img.naturalWidth === 0) return;
                if (!this.source || typeof this.source.rotation !== 'number') return;
                const alpha = Math.min(1, this.life / 150);
                const src = this.source;
                const startDist = 20;
                const endDist = this.range * 0.8;
                const currentDist = startDist + (endDist - startDist) * this.progress;
                const fx = src.x + Math.cos(src.rotation) * currentDist;
                const fy = src.y + Math.sin(src.rotation) * currentDist;
                // 防御性检查：坐标有效性
                if (!isFinite(fx) || !isFinite(fy)) return;
                const screenPos = Renderer.worldToScreen(fx, fy);
                const s = WEAPON_ANIM.size;
                const size = s * 0.4 * (0.6 + this.progress * 0.4);
                ctx.save();
                ctx.translate(screenPos.x, screenPos.y);
                ctx.rotate(src.rotation + Math.PI / 4);
                ctx.globalAlpha = alpha;
                if (ThrustEffect._img && ThrustEffect._img.complete && ThrustEffect._img.naturalWidth > 0) ctx.drawImage(ThrustEffect._img, -size / 2, -size / 2, size, size);
                for (let i = 1; i <= 3; i++) {
                    const trailDist = currentDist - i * 15;
                    if (trailDist < startDist) break;
                    const tx = src.x + Math.cos(src.rotation) * trailDist;
                    const ty = src.y + Math.sin(src.rotation) * trailDist;
                    const tPos = Renderer.worldToScreen(tx, ty);
                    const tSize = size * (1 - i * 0.2);
                    ctx.globalAlpha = alpha * (0.3 - i * 0.08);
                    ctx.save();
                    ctx.translate(tPos.x, tPos.y);
                    ctx.rotate(src.rotation + Math.PI / 4);
                    if (ThrustEffect._img && ThrustEffect._img.complete && ThrustEffect._img.naturalWidth > 0) ctx.drawImage(ThrustEffect._img, -tSize / 2, -tSize / 2, tSize, tSize);
                    ctx.restore();
                }
                ctx.restore();
            }
        }
        /**
         * 撞墙烟雾效果（兼容 legacy.js 单文件模式）
         */
        const SMOKE_FRAMES_LEGACY = [
            'assets/effects/smoke_01_start.png','assets/effects/smoke_02_expand.png',
            'assets/effects/smoke_03_grow.png','assets/effects/smoke_04_peak.png',
            'assets/effects/smoke_05_fade.png','assets/effects/smoke_06_shrink.png',
            'assets/effects/smoke_07_wisp.png','assets/effects/smoke_08_gone.png',
        ];
        const smokeImagesLegacy = SMOKE_FRAMES_LEGACY.map(src => { const img = new Image(); img.src = src; return img; });
        class SmokeEffect {
            constructor(x, y, size = 60) {
                this.x = x; this.y = y; this.size = size;
                this.life = 3000; this.maxLife = 3000; this.active = true; this.frameCount = 8;
            }
            update() { this.life -= 16; if (this.life <= 0) this.active = false; }
            render(ctx) {
                const progress = 1 - this.life / this.maxLife;
                const frameIndex = Math.min(7, Math.floor(progress * this.frameCount));
                const img = smokeImagesLegacy[frameIndex];
                if (!img || !img.complete) return;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.globalAlpha = 0.5;
                const s = this.size;
                if (img && img.complete && img.naturalWidth > 0) ctx.drawImage(img, screenPos.x - s / 2, screenPos.y - s / 2, s, s);
                ctx.restore();
            }
        }
        /**
         * 白底攻击范围显示效果（兼容 legacy.js 单文件模式）
         */
        class AttackRangeEffect {
            constructor(x, y, angle, range, width, type = 'line') {
                this.x = x; this.y = y; this.angle = angle; this.range = range; this.width = width;
                this.type = type; this.life = 200; this.maxLife = 200; this.active = true;
            }
            update() {
                this.life -= 16;
                if (this.life <= 0) this.active = false;
            }
            render(ctx) {
                const alpha = Math.min(1, this.life / 150) * 0.35;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save();
                ctx.translate(screenPos.x, screenPos.y);
                ctx.globalAlpha = alpha;
                ctx.fillStyle = '#ffffff';
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                if (this.type === 'sector') {
                    const halfArc = this.width / 2;
                    ctx.beginPath();
                    ctx.moveTo(0, 0);
                    ctx.arc(0, 0, this.range, this.angle - halfArc, this.angle + halfArc);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                } else {
                    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
                    const ex = cos * this.range, ey = sin * this.range;
                    const hw = this.width / 2;
                    const perpX = -sin * hw, perpY = cos * hw;
                    ctx.beginPath();
                    ctx.moveTo(perpX, perpY);
                    ctx.lineTo(ex + perpX, ey + perpY);
                    ctx.lineTo(ex - perpX, ey - perpY);
                    ctx.lineTo(-perpX, -perpY);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                }
                ctx.restore();
            }
        }
        /**
         * 撞墙烟雾效果（兼容 legacy.js 单文件模式）
         */
        class Attack {
            constructor(config) { this.config = config; this.cooldown = 0; this.maxCooldown = config.cooldown || 1000; this.active = true; }
            canUse() { return this.cooldown <= 0; }
            use(source, targetX, targetY, entities) { if (!this.canUse()) return false; const success = this.execute(source, targetX, targetY, entities); if (success) this.cooldown = this.maxCooldown; return success; }
            execute(source, targetX, targetY, entities) {}
            update(dt) { if (this.cooldown > 0) this.cooldown -= dt; }
            getCooldownPercent() { return Math.max(0, this.cooldown / this.maxCooldown); }
        }

        class SlashAttack extends Attack {
            constructor(config = {}) {
                super({ cooldown: config.cooldown || 500, range: config.range || 80, arc: config.arc || Math.PI / 2.5, damage: config.damage || { min: 10, max: 18 }, knockback: config.knockback || 25, ...config });
            }
            execute(source, targetX, targetY, entities) {
                if (source.data.stamina < CONFIG.STAMINA_MELEE_COST) return false;
                source.data.stamina -= CONFIG.STAMINA_MELEE_COST;
                // SoundManager.play('melee_swing');
                const range = this.config.range, arc = this.config.arc;
                const attackAngle = Math.atan2(targetY - source.y, targetX - source.x);
                // 防御性检查：攻击角度有效性
                if (!isFinite(attackAngle)) {
                    console.warn('SlashAttack: invalid attack angle', { targetX, targetY, sx: source.x, sy: source.y });
                    return true; // 仍然消耗体力并播放动画，但不产生效果
                }
                // 白底攻击范围显示
                EffectManager.add(new AttackRangeEffect(source.x, source.y, attackAngle, range, arc, 'sector'));
                // 同步攻击判定：确保扇形末端也能命中
                entities.forEach(entity => {
                    if (entity === source || !entity.active || !entity.hittable) return;
                    if (MathUtils.pointInSector(entity.x, entity.y, source.x, source.y, attackAngle, range, arc)) {
                        const damage = Math.floor(MathUtils.randomRange(this.config.damage.min, this.config.damage.max));
                        entity.takeDamage(damage, source);
                        entity.applyKnockback(attackAngle, this.config.knockback);
                    }
                });
                return true;
            }
        }

        class ThrustAttack extends Attack {
            constructor(config = {}) {
                super({ cooldown: config.cooldown || 600, range: config.range || 150, width: config.width || 30, damage: config.damage || { min: 12, max: 20 }, knockback: config.knockback || 15, ...config });
            }
            execute(source, targetX, targetY, entities) {
                if (source.data.stamina < CONFIG.STAMINA_MELEE_COST) return false;
                source.data.stamina -= CONFIG.STAMINA_MELEE_COST;
                // SoundManager.play('melee_swing');
                const range = this.config.range, width = this.config.width;
                const attackAngle = Math.atan2(targetY - source.y, targetX - source.x);
                // 防御性检查：攻击角度有效性
                if (!isFinite(attackAngle)) {
                    console.warn('ThrustAttack: invalid attack angle', { targetX, targetY, sx: source.x, sy: source.y });
                    return true;
                }
                // ThrustEffect 不再在此立即触发，改为在 Player swing 阶段开始时触发
                // 存储攻击数据供 swing 阶段使用（使用对象池避免重复创建）
                source._pendingThrust = { range, width, angle: attackAngle };
                const endX = source.x + Math.cos(attackAngle) * range;
                const endY = source.y + Math.sin(attackAngle) * range;
                // 白底攻击范围显示
                EffectManager.add(new AttackRangeEffect(source.x, source.y, attackAngle, range, width, 'line'));
                // 同步攻击判定：检查视线是否被墙阻挡
                let hitAny = false;
                entities.forEach(entity => {
                    if (entity === source || !entity.active || !entity.hittable) return;
                    const dist = MathUtils.pointToLineDistance(entity.x, entity.y, source.x, source.y, endX, endY);
                    if (dist <= width / 2 + (entity.size || 10)) {
                        // 墙壁视线检测：不能攻击墙后的目标
                        if (WallSystem.blocked(source.x, source.y, entity.x, entity.y)) return;
                        hitAny = true;
                        const damage = Math.floor(MathUtils.randomRange(this.config.damage.min, this.config.damage.max));
                        entity.takeDamage(damage, source);
                        entity.applyKnockback(attackAngle, this.config.knockback);
                        // 攻击特效已关闭（纯动作模式）：不显示 BloodEffect 血溅
                        // { let b = EffectManager._acquire('BloodEffect');
                        // if (b) { b.x = entity.x; b.y = entity.y; b.angle = attackAngle; b.life = 500; b.active = true;
                        //     b.particles.forEach(p => { const sa = attackAngle + (Math.random()-0.5)*Math.PI*0.9; const sp = 1.5+Math.random()*6; p.vx = Math.cos(sa)*sp; p.vy = Math.sin(sa)*sp; p.x = (Math.random()-0.5)*6; p.y = (Math.random()-0.5)*6; }); }
                        // else b = new BloodEffect(entity.x, entity.y, attackAngle);
                        // EffectManager.add(b); }
                    }
                });
                // 即使未命中目标也确保 _pendingThrust 被处理，防止残留
                if (!hitAny) {
                    source._pendingThrust = source._pendingThrust || { range, width, angle: attackAngle };
                }
                return true;
            }
        }

        class RangedAttack extends Attack {
            constructor(config = {}) {
                super({ cooldown: config.cooldown || 800, projectileSpeed: config.projectileSpeed || 10, projectileRange: config.projectileRange || 500, projectileSize: config.projectileSize || 5, damage: config.damage || { min: 6, max: 14 }, piercing: config.piercing || false, ...config });
            }
            execute(source, targetX, targetY, entities) {
                if (source.data.stamina < CONFIG.STAMINA_RANGED_COST) return false;
                source.data.stamina -= CONFIG.STAMINA_RANGED_COST;
                const wType = source.equippedRangedType;
                // SoundManager.play(wType === 'pistol' ? 'gun_fire' : 'bow_fire');
                const angle = Math.atan2(targetY - source.y, targetX - source.x);
                { let p = EffectManager._acquire('Projectile');
                        if (p) { p.x = source.x; p.y = source.y; p.angle = angle; p.speed = this.config.projectileSpeed; p.maxRange = this.config.projectileRange; p.size = this.config.projectileSize; p.damage = this.config.damage; p.piercing = this.config.piercing; p.source = source; p.entities = entities; p.image = source.arrowImage; p.traveled = 0; p.active = true; p.hitTargets = new Set(); }
                        else p = new Projectile(source.x, source.y, angle, this.config.projectileSpeed, this.config.projectileRange, this.config.projectileSize, this.config.damage, this.config.piercing, source, entities, source.arrowImage);
                        EffectManager.add(p); }
                return true;
            }
        }
        class Projectile {
            constructor(x, y, angle, speed, maxRange, size, damage, piercing, source, entities, image, isTracer = false) {
                this.x = x; this.y = y; this.angle = angle; this.speed = speed; this.maxRange = maxRange; this.size = size;
                this.damage = damage; this.piercing = piercing; this.source = source; this.entities = entities;
                this.traveled = 0; this.active = true; this.hitTargets = new Set(); this.image = image;
                this.isTracer = isTracer; // 是否为曳光弹（G18手枪）
            }
            update() {
                const dx = Math.cos(this.angle) * this.speed, dy = Math.sin(this.angle) * this.speed;
                this.x += dx; this.y += dy; this.traveled += this.speed;
                if (this.traveled >= this.maxRange) { this.active = false; return; }
                if (this.x < 0 || this.x > CONFIG.WORLD_WIDTH || this.y < 0 || this.y > CONFIG.WORLD_HEIGHT) { this.active = false; return; }
                // 墙壁碰撞检测：弹道不能穿过墙
                if (WallSystem.blocked(this.x - dx * 2, this.y - dy * 2, this.x, this.y)) { this.active = false; return; }
                this.entities.forEach(entity => {
                    if (entity === this.source || !entity.active || !entity.hittable) return;
                    if (this.hitTargets.has(entity.id)) return;
                    const dist = MathUtils.distance(this.x, this.y, entity.x, entity.y);
                    if (dist < entity.size + this.size) {
                        const damage = Math.floor(MathUtils.randomRange(this.damage.min, this.damage.max));
                        entity.takeDamage(damage, this.source);
                        // 远程武器击退 = 0
                        // 攻击特效已关闭（纯动作模式）：不显示 BloodEffect 血溅
                        // { let b = EffectManager._acquire('BloodEffect');
                        // if (b) { b.x = entity.x; b.y = entity.y; b.angle = this.angle; b.life = 500; b.active = true;
                        //     b.particles.forEach(p => { const sa = this.angle + (Math.random()-0.5)*Math.PI*0.9; const sp = 1.5+Math.random()*6; p.vx = Math.cos(sa)*sp; p.vy = Math.sin(sa)*sp; p.x = (Math.random()-0.5)*6; p.y = (Math.random()-0.5)*6; }); }
                        // else b = new BloodEffect(entity.x, entity.y, this.angle);
                        // EffectManager.add(b); }
                        if (!this.piercing) this.active = false; else this.hitTargets.add(entity.id);
                    }
                });
            }
            render(ctx) {
                if (this.isTracer) {
                    // 黄色曳光弹：绘制发光弹道线
                    const screenPos = Renderer.worldToScreen(this.x, this.y);
                    const tailLen = 40; // 弹道尾迹长度
                    const tx = screenPos.x - Math.cos(this.angle) * tailLen;
                    const ty = screenPos.y - Math.sin(this.angle) * tailLen;
                    ctx.save();
                    // 外层光晕（较宽、较淡）
                    ctx.strokeStyle = 'rgba(255, 220, 50, 0.25)';
                    ctx.lineWidth = 8;
                    ctx.lineCap = 'round';
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    // 中层光晕
                    ctx.strokeStyle = 'rgba(255, 235, 80, 0.5)';
                    ctx.lineWidth = 4;
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    // 核心亮线
                    ctx.strokeStyle = 'rgba(255, 250, 150, 0.9)';
                    ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(screenPos.x, screenPos.y); ctx.stroke();
                    // 头部高亮光点
                    ctx.fillStyle = '#fff8c0';
                    ctx.beginPath(); ctx.arc(screenPos.x, screenPos.y, 2.5, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                    return;
                }
                // 非曳光弹（弓矢）：保持隐藏（纯动作模式）
                // 如需恢复弓矢绘制，取消以下注释：
                // const screenPos = Renderer.worldToScreen(this.x, this.y);
                // ctx.save(); ctx.translate(screenPos.x, screenPos.y); ctx.rotate(this.angle);
                // if (this.image && this.image.complete && this.image.naturalWidth > 0) {
                //     const s = this.size * 10; const w = s * 0.22;
                //     ctx.rotate(-Math.PI / 2); ctx.drawImage(this.image, -w / 2, -s / 2, w, s);
                // }
                // ctx.restore();
            }
        }

        class Entity {
            constructor(x, y) { this.id = Math.random().toString(36).substr(2, 9); this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.rotation = 0; this.active = true; this.hittable = false; this.components = new Map(); }
            addComponent(name, comp) { this.components.set(name, comp); comp.entity = this; }
            update() {} render(ctx) {} takeDamage(damage, source) {} applyKnockback(angle, force) {}
        }

        class DamageableEntity extends Entity {
            constructor(x, y, config = {}) {
                super(x, y); this.hittable = true; this.hp = config.hp || 100; this.maxHp = config.maxHp || 100;
                this.size = config.size || 20; this.name = config.name || '目标'; this.hitFlash = 0; this.hitFlashDuration = 200;
                this.knockbackX = 0; this.knockbackY = 0; this.knockbackFriction = 0.88;
            }
            takeDamage(damage, source) {
                const isCrit = damage >= 15; this.hp -= damage; this.hitFlash = this.hitFlashDuration;
                // SoundManager.play(isCrit ? 'crit' : 'hit');
                EffectManager.createDamageText(this.x, this.y - this.size, damage, isCrit);
                if (isCrit) EffectManager.triggerCritEffects();
                if (this.hp <= 0) { this.hp = 0; this.onDeath(source); }
            }
            onDeath(source) {
                this.active = false;
                // SoundManager.play('enemy_death');
                if (source && source.data) source.data.kills++;
                EffectManager.add(new DeathEffect(this.x, this.y, this.size));
                // 掉落钢弓
                if (this instanceof Enemy) Game.dropItem(this.x, this.y, EquipManager.G18_PISTOL_ITEM);
            }
            applyKnockback(angle, force) {
                this.knockbackX += Math.cos(angle) * force;
                this.knockbackY += Math.sin(angle) * force;
            }
            update() {
                if (Math.abs(this.knockbackX) > 0.1 || Math.abs(this.knockbackY) > 0.1) {
                    const nx = this.x + this.knockbackX;
                    const ny = this.y + this.knockbackY;
                    // 击退时加入墙壁碰撞检测，防止穿墙
                    const radius = this.collisionRadius || this.size * 0.6 || 10;
                    if (typeof WallSystem !== 'undefined' && WallSystem.walls && WallSystem.walls.length > 0) {
                        const resolved = WallSystem.resolve(this.x, this.y, nx, ny, radius);
                        // 撞墙检测：如果resolve限制了移动，往反方向反弹5px
                        const hitWall = Math.abs(resolved.x - nx) > 0.5 || Math.abs(resolved.y - ny) > 0.5;
                        if (hitWall) {
                            const angle = Math.atan2(this.knockbackY, this.knockbackX);
                            this.x = resolved.x - Math.cos(angle) * 5;
                            this.y = resolved.y - Math.sin(angle) * 5;
                            // 撞墙烟雾效果：在墙面位置产生
                            if (typeof EffectManager !== 'undefined') EffectManager.add(new SmokeEffect(resolved.x, resolved.y));
                            this.knockbackX = 0;
                            this.knockbackY = 0;
                        } else {
                            this.x = resolved.x;
                            this.y = resolved.y;
                        }
                    } else {
                        this.x = nx;
                        this.y = ny;
                    }
                    this.knockbackX *= this.knockbackFriction;
                    this.knockbackY *= this.knockbackFriction;
                    if (Math.abs(this.knockbackX) < 0.1) this.knockbackX = 0;
                    if (Math.abs(this.knockbackY) < 0.1) this.knockbackY = 0;
                }
                if (this.hitFlash > 0) this.hitFlash -= 16;
            }
            renderHealthBar(ctx) {
                if (this.hp >= this.maxHp) return;
                const screenPos = Renderer.worldToScreen(this.x, this.y), barWidth = 40, barHeight = 4, hpPercent = this.hp / this.maxHp;
                ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(screenPos.x - barWidth/2, screenPos.y - this.size - 12, barWidth, barHeight);
                ctx.fillStyle = hpPercent > 0.5 ? '#7a9a6a' : hpPercent > 0.25 ? '#a09060' : '#8a4a4a';
                ctx.fillRect(screenPos.x - barWidth/2, screenPos.y - this.size - 12, barWidth * hpPercent, barHeight);
            }
        }

        class TargetDummy extends DamageableEntity {
            constructor(x, y, config = {}) { super(x, y, { hp: config.hp || 200, maxHp: config.maxHp || 200, size: config.size || 24, collisionRadius: 20, name: config.name || '训练靶', ...config }); this.wobble = 0; this.baseY = y; }
            update() {
                if (Math.abs(this.knockbackX) > 0.1 || Math.abs(this.knockbackY) > 0.1) {
                    const nx = this.x + this.knockbackX;
                    const ny = this.y + this.knockbackY;
                    // 击退时加入墙壁碰撞检测，防止穿墙
                    const radius = this.collisionRadius || this.size * 0.6 || 10;
                    if (typeof WallSystem !== 'undefined' && WallSystem.walls && WallSystem.walls.length > 0) {
                        const resolved = WallSystem.resolve(this.x, this.y, nx, ny, radius);
                        // 撞墙检测：如果resolve限制了移动，往反方向反弹5px
                        const hitWall = Math.abs(resolved.x - nx) > 0.5 || Math.abs(resolved.y - ny) > 0.5;
                        if (hitWall) {
                            const angle = Math.atan2(this.knockbackY, this.knockbackX);
                            this.x = resolved.x - Math.cos(angle) * 5;
                            this.baseY += (resolved.y - this.y) - Math.sin(angle) * 5;
                            // 撞墙烟雾效果：在墙面位置产生
                            if (typeof EffectManager !== 'undefined') EffectManager.add(new SmokeEffect(resolved.x, resolved.y));
                            this.knockbackX = 0;
                            this.knockbackY = 0;
                        } else {
                            this.x = resolved.x;
                            this.baseY += (resolved.y - this.y);
                        }
                    } else {
                        this.x = nx;
                        this.baseY += this.knockbackY;
                    }
                    this.knockbackX *= this.knockbackFriction;
                    this.knockbackY *= this.knockbackFriction;
                    if (Math.abs(this.knockbackX) < 0.1) this.knockbackX = 0;
                    if (Math.abs(this.knockbackY) < 0.1) this.knockbackY = 0;
                }
                if (this.hitFlash > 0) this.hitFlash -= 16;
                this.wobble += 0.05;
                this.y = this.baseY + Math.sin(this.wobble) * 3;
            }
            render(ctx) {
                const screenPos = Renderer.worldToScreen(this.x, this.y), x = screenPos.x, y = screenPos.y;
                ctx.save(); ctx.translate(x, y);
                ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(0, this.size + 4, this.size * 0.8, 6, 0, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = this.hitFlash > 0 ? '#ffaaaa' : '#8a7d6b'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = '#5a4d3f'; ctx.beginPath(); ctx.arc(0, 0, this.size * 0.5, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = '#d4c5a9'; ctx.beginPath(); ctx.arc(0, 0, this.size * 0.25, 0, Math.PI*2); ctx.fill();
                ctx.strokeStyle = '#5a4d3f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.stroke();
                ctx.restore();
                this.renderHealthBar(ctx);
                ctx.fillStyle = '#d4c5a9'; ctx.font = '11px "Noto Serif SC"'; ctx.textAlign = 'center'; ctx.fillText(`${this.name} ${this.hp}/${this.maxHp}`, x, y - this.size - 18);
            }
        }

        class DodgeEffect {
            constructor(x, y, dirX, dirY) {
                this.x = x; this.y = y; this.dirX = dirX; this.dirY = dirY; this.life = 300; this.maxLife = 300; this.active = true; this.trails = [];
                for (let i = 0; i < 5; i++) this.trails.push({ x: x - dirX * i * 8, y: y - dirY * i * 8, alpha: 1 - i * 0.15, size: 14 - i * 1.5 });
            }
            update() { this.life -= 16; if (this.life <= 0) this.active = false; this.trails.forEach(t => t.alpha -= 0.03); }
            render(ctx) {
                const alpha = this.life / this.maxLife;
                this.trails.forEach(t => { if (t.alpha <= 0) return; const screenPos = Renderer.worldToScreen(t.x, t.y); ctx.fillStyle = `rgba(160, 200, 160, ${t.alpha * alpha * 0.4})`; ctx.beginPath(); ctx.arc(screenPos.x, screenPos.y, t.size, 0, Math.PI*2); ctx.fill(); });
            }
        }

        class DeathEffect {
            constructor(x, y, size) {
                this.x = x; this.y = y; this.size = size; this.life = 500; this.maxLife = 500; this.active = true; this.particles = [];
                for (let i = 0; i < 8; i++) { const angle = (Math.PI * 2 / 8) * i; this.particles.push({ x: 0, y: 0, vx: Math.cos(angle) * 3, vy: Math.sin(angle) * 3, size: 3 + Math.random() * 4 }); }
            }
            update() {
                this.life -= 16; if (this.life <= 0) this.active = false;
                this.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vx *= 0.95; p.vy *= 0.95; });
            }
            render(ctx) {
                const alpha = this.life / this.maxLife, screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.translate(screenPos.x, screenPos.y);
                this.particles.forEach(p => { ctx.fillStyle = `rgba(138, 125, 107, ${alpha})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI*2); ctx.fill(); });
                ctx.restore();
            }
        }

        class BloodEffect {
            constructor(x, y, angle) {
                this.x = x; this.y = y; this.angle = angle; this.life = 500; this.maxLife = 500; this.active = true;
                this.particles = [];
                for (let i = 0; i < 20; i++) {
                    const spreadAngle = angle + (Math.random() - 0.5) * Math.PI * 0.9;
                    const speed = 1.5 + Math.random() * 6;
                    const r = Math.random();
                    let color;
                    if (r > 0.7) color = `rgba(220, 60, 60,`;
                    else if (r > 0.35) color = `rgba(180, 30, 30,`;
                    else color = `rgba(120, 20, 20,`;
                    this.particles.push({
                        x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6,
                        vx: Math.cos(spreadAngle) * speed,
                        vy: Math.sin(spreadAngle) * speed,
                        size: 2.5 + Math.random() * 4.5,
                        color: color
                    });
                }
            }
            update() {
                this.life -= 12;
                if (this.life <= 0) { this.active = false; return; }
                this.particles.forEach(p => {
                    p.x += p.vx; p.y += p.vy;
                    p.vx *= 0.90; p.vy *= 0.90;
                });
            }
            render(ctx) {
                const alpha = this.life / this.maxLife;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.translate(screenPos.x, screenPos.y);
                this.particles.forEach(p => {
                    const a = alpha * (0.4 + alpha * 0.6);
                    ctx.fillStyle = `${p.color} ${a})`;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size * (0.6 + alpha * 0.4), 0, Math.PI * 2);
                    ctx.fill();
                });
                ctx.restore();
            }
        }

        class DustEffect {
            constructor(x, y, intensity) {
                this.x = x; this.y = y; this.life = 450; this.maxLife = 450; this.active = true;
                this.particles = [];
                const count = Math.floor(5 + intensity * 6);
                for (let i = 0; i < count; i++) {
                    const angle = Math.PI + (Math.random() - 0.5) * Math.PI;
                    const speed = 0.8 + Math.random() * 2 + intensity * 0.8;
                    this.particles.push({
                        x: (Math.random() - 0.5) * 6,
                        y: Math.random() * 3,
                        vx: Math.cos(angle) * speed * 0.6,
                        vy: Math.sin(angle) * speed * 0.4 - 0.3 - Math.random() * 0.6,
                        size: 3 + Math.random() * (3 + intensity * 2.5),
                        alpha: 0.4 + Math.random() * 0.35
                    });
                }
            }
            update() {
                this.life -= 10;
                if (this.life <= 0) { this.active = false; return; }
                this.particles.forEach(p => {
                    p.x += p.vx; p.y += p.vy;
                    p.vy -= 0.015;
                    p.vx *= 0.97; p.vy *= 0.97;
                    p.alpha -= 0.006;
                });
            }
            render(ctx) {
                const globalAlpha = this.life / this.maxLife;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.translate(screenPos.x, screenPos.y);
                this.particles.forEach(p => {
                    if (p.alpha <= 0) return;
                    const a = p.alpha * globalAlpha;
                    ctx.fillStyle = `rgba(160, 150, 135, ${a})`;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size * (0.5 + globalAlpha * 0.5), 0, Math.PI * 2);
                    ctx.fill();
                });
                ctx.restore();
            }
        }

        const WEAPON_ANIM = {
            size: 84, holdX: -20, holdY: 11,
            idleAngle: 0, windupAngle: Math.PI / 6, swingAngle: -Math.PI / 6,
            windupMs: 150, swingMs: 200, recoverMs: 350,
        };
        function easeInQuad(t) { return t * t; }
        function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
        function easeInCubic(t) { return t * t * t; }
        function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

        const Input = {
            keys: new Set(),
            mouse: { x: 0, y: 0, leftDown: false, rightDown: false, leftPressed: false, rightPressed: false },
            init() {
                window.addEventListener('keydown', e => { this.keys.add(e.code); this.handleKey(e.code); });
                window.addEventListener('keyup', e => this.keys.delete(e.code));
                window.addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
                window.addEventListener('mousedown', e => {
                    const isSystemUI = e.target.closest('.system-panel, .panel-overlay, .side-menu, .back-menu-btn, .menu-btn');
                    if (e.button === 0) { this.mouse.leftDown = true; if (!isSystemUI) this.mouse.leftPressed = true; }
                    if (e.button === 2) { this.mouse.rightDown = true; if (!isSystemUI) this.mouse.rightPressed = true; }
                });
                window.addEventListener('mouseup', e => { if (e.button === 0) this.mouse.leftDown = false; if (e.button === 2) this.mouse.rightDown = false; });
                window.addEventListener('contextmenu', e => e.preventDefault());
            },
            handleKey(code) {
                if (code === CONFIG.KEYS.MENU) { if (SystemUI.isOpen) SystemUI.close(); else Game.toMenu(); return; }
                if (SystemUI.isOpen) {
                    // 面板打开时：允许Tab切换快捷键，其他按键拦截
                    if (code === CONFIG.KEYS.INVENTORY || code === CONFIG.KEYS.EQUIP || code === 'KeyB') { SystemUI.toggle('equip'); return; }
                    if (code === CONFIG.KEYS.SKILL) { SystemUI.toggle('skill'); return; }
                    if (code === CONFIG.KEYS.CODEX) { SystemUI.toggle('codex'); return; }
                    return; // 其他按键在面板打开时忽略
                }
                if (code === CONFIG.KEYS.INVENTORY) SystemUI.toggle('equip');
                if (code === CONFIG.KEYS.EQUIP || code === 'KeyB') SystemUI.toggle('equip');
                if (code === CONFIG.KEYS.SKILL) SystemUI.toggle('skill');
                if (code === CONFIG.KEYS.CODEX) SystemUI.toggle('codex');
                if (code === CONFIG.KEYS.SKILL_Q || code === CONFIG.KEYS.SKILL_E || code === CONFIG.KEYS.SKILL_R) QuickBar.useSlot(code);
                if (code === CONFIG.KEYS.ITEM_1 || code === CONFIG.KEYS.ITEM_2 || code === CONFIG.KEYS.ITEM_3 || code === CONFIG.KEYS.ITEM_4) QuickBar.useSlot(code);
                if (code === 'KeyF' && Game.player) {
                    Game.player.switchWeaponMode();
                }
            },
            update() { this.mouse.leftPressed = false; this.mouse.rightPressed = false; },
            isPressed(key) { return this.keys.has(key); },
            getMovement() {
                let dx = 0, dy = 0;
                if (this.isPressed(CONFIG.KEYS.W)) dy -= 1;
                if (this.isPressed(CONFIG.KEYS.S)) dy += 1;
                if (this.isPressed(CONFIG.KEYS.A)) dx -= 1;
                if (this.isPressed(CONFIG.KEYS.D)) dx += 1;
                if (dx !== 0 && dy !== 0) { const len = Math.sqrt(dx*dx + dy*dy); dx /= len; dy /= len; }
                return { x: dx, y: dy };
            },
            isSprint() { return this.isPressed(CONFIG.KEYS.SHIFT); }
        };

        class Player extends Entity {
            constructor(x, y) {
                super(x, y); this.size = CONFIG.PLAYER_SIZE; this.collisionRadius = 12; this.speed = CONFIG.PLAYER_SPEED; this.maxSpeed = CONFIG.PLAYER_SPEED; this.accel = 0.7; this.friction = 0.82; this.animTime = 0; this.isMoving = false; this.hittable = true;
                this.isDodging = false; this.dodgeTimer = 0; this.dodgeCooldown = 0; this.dodgeDirection = { x: 0, y: 0 }; this.dodgeInvincible = false;
                this.weaponSwitchCooldown = 0; // 武器切换冷却：切换 G18 后防止立即开火
                this.attacks = {
                    melee: new ThrustAttack({ cooldown: 1100, range: 130, width: 25, damage: { min: 12, max: 20 }, knockback: 8 }),
                    ranged: new RangedAttack({ cooldown: 600, projectileSpeed: 5, projectileRange: 800, projectileSize: 7, damage: { min: 8, max: 16 }, piercing: false }),
                    pistol: new RangedAttack({ cooldown: 55, projectileSpeed: 22, projectileRange: 600, projectileSize: 3, damage: { min: 4, max: 8 }, piercing: false })
                };
                this.weaponMode = 'weapon'; // 'weapon' or 'weapon2'
                this.data = {
                    name: '轮回者', level: 1, class: '初心者', hp: 100, maxHp: 100, mp: 100, maxMp: 100,
                    stamina: CONFIG.STAMINA_MAX, maxStamina: CONFIG.STAMINA_MAX, exp: 0, maxExp: 100,
                    str: 10, dex: 10, int: 10, con: 10, wis: 10, luck: 10,
                    atk: 0, def: 0, matk: 0, mdef: 0, hit: 0, dodge: 0, crit: 0, aspd: 0, speed: 0,
                    loopCount: 0, surviveDays: 1, kills: 0, quests: 0, geneLock: '未开启', rank: 'F'
                };
                this.equipments = {};
                this.hasMeleeWeapon = true; // 是否有主武器（剑），false = 空手
                this.meleeImage = new Image(); this.meleeImage.src = 'assets/weapons/1-rusty_sword_euip.png';
                this.bowFrames = [];
                for (let i = 1; i <= 8; i++) { const img = new Image(); img.src = `assets/weapons/bow_frame_${String(i).padStart(2, '0')}.png`; this.bowFrames.push(img); }
                this.equippedBowFrames = null; // 装备后的弓贴图，null表示使用默认弓
                this.pistolImage = new Image(); this.pistolImage.src = 'assets/weapons/g18_topdown_v2.png';
                this.equippedRangedType = null; // 'bow' | 'pistol' | null，装备副武器时设置
                this.arrowImage = new Image(); this.arrowImage.src = 'assets/ammo/arrow.png';
                this.weaponAnim = { state: 'idle', timer: 0, angle: WEAPON_ANIM.idleAngle, nextSpin: 0 };
                this.rangedFireData = null; this.rangedFired = false;
                this.staminaRegenDelay = 0;
                this.calculateCombatStats();
            }
            calculateCombatStats() {
                const d = this.data;
                d.atk = Math.floor(d.str * 1.5 + d.dex * 0.5); d.def = Math.floor(d.con * 1.2 + d.str * 0.3);
                d.matk = Math.floor(d.int * 1.5 + d.wis * 0.5); d.mdef = Math.floor(d.wis * 1.2 + d.int * 0.3);
                d.hit = 80 + Math.floor(d.dex * 0.5); d.dodge = 5 + Math.floor(d.dex * 0.3);
                d.crit = 2 + Math.floor(d.luck * 0.2); d.aspd = 1.0 + d.dex * 0.02;
                d.speed = CONFIG.PLAYER_SPEED + d.dex * 0.05;
            }
            update(dt, entities) {
                const move = Input.getMovement();
                if (this.dodgeCooldown > 0) this.dodgeCooldown -= dt;
                if (this.weaponSwitchCooldown > 0) this.weaponSwitchCooldown -= dt;
                if (this.isDodging) {
                    this.dodgeTimer -= dt;
                    if (this.dodgeTimer <= 0) { this.isDodging = false; this.dodgeInvincible = false; }
                    else {
                        const dnx = this.x + this.dodgeDirection.x * CONFIG.DODGE_SPEED, dny = this.y + this.dodgeDirection.y * CONFIG.DODGE_SPEED;
                        const dr = WallSystem.resolve(this.x, this.y, dnx, dny, this.collisionRadius);
                        this.x = dr.x; this.y = dr.y;
                        this.x = Math.max(10, Math.min(CONFIG.WORLD_WIDTH - 10, this.x)); this.y = Math.max(10, Math.min(CONFIG.WORLD_HEIGHT - 10, this.y));
                        this.animTime += 0.4;
                    }
                } else {
                    const sprint = Input.isSprint() && this.data.stamina > 0, targetSpeed = sprint ? CONFIG.PLAYER_SPRINT : this.maxSpeed;
                    this.vx += (move.x * targetSpeed - this.vx) * this.accel; this.vy += (move.y * targetSpeed - this.vy) * this.accel;
                    if (move.x === 0) this.vx *= this.friction; if (move.y === 0) this.vy *= this.friction;
                    const nx = this.x + this.vx, ny = this.y + this.vy;
                    const resolved = WallSystem.resolve(this.x, this.y, nx, ny, this.collisionRadius);
                    // 墙壁碰撞音效：速度较大且位置被阻挡时
                    if ((Math.abs(this.vx) > 1.5 || Math.abs(this.vy) > 1.5) && (Math.abs(resolved.x - nx) > 1 || Math.abs(resolved.y - ny) > 1)) {
                        // SoundManager.play('wall_hit');
                    }
                    this.x = resolved.x; this.y = resolved.y;
                    this.x = Math.max(20, Math.min(CONFIG.WORLD_WIDTH - 20, this.x)); this.y = Math.max(20, Math.min(CONFIG.WORLD_HEIGHT - 20, this.y));
                    if (sprint && this.isMoving) { this.data.stamina -= CONFIG.STAMINA_SPRINT_COST * (dt / 1000); if (this.data.stamina < 0) this.data.stamina = 0; }
                    if (Input.isPressed(CONFIG.KEYS.SPACE) && this.dodgeCooldown <= 0 && this.data.stamina >= CONFIG.STAMINA_DODGE_COST) this.triggerDodge(move);
                }
                const screenPos = Renderer.worldToScreen(this.x, this.y), dx = Input.mouse.x - screenPos.x, dy = Input.mouse.y - screenPos.y;
                this.rotation = Math.atan2(dy, dx);
                this.isMoving = Math.abs(this.vx) > 0.1 || Math.abs(this.vy) > 0.1;
                if (this.isMoving && !this.isDodging) {
                    this.animTime += 0.15;
                    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                    const sprint = Input.isSprint() && this.data.stamina > 0;
                    if (speed > 1.0) {
                        if (!this.dustTimer) this.dustTimer = 0;
                        this.dustTimer += dt;
                        const interval = sprint ? 70 : 140;
                        if (this.dustTimer >= interval) {
                            this.dustTimer -= interval;
                            // SoundManager.play('step');
                            const offsetX = -this.vx * 1.5 + (Math.random() - 0.5) * 8;
                            const offsetY = -this.vy * 1.5 + (Math.random() - 0.5) * 4;
                            { let d = EffectManager._acquire('DustEffect');
                            const dInt = sprint ? 1.5 : 0.8;
                            if (d) { d.x = this.x + offsetX; d.y = this.y + offsetY + 10; d.life = d.maxLife; d.active = true;
                                d.particles.forEach(p => { const pa = Math.PI+(Math.random()-0.5)*Math.PI; const ps = 0.8+Math.random()*2+dInt*0.8; p.vx = Math.cos(pa)*ps*0.6; p.vy = Math.sin(pa)*ps*0.4-0.3-Math.random()*0.6; p.alpha = 0.4+Math.random()*0.35; }); }
                            else d = new DustEffect(this.x + offsetX, this.y + offsetY + 10, dInt);
                            EffectManager.add(d); }
                        }
                    } else {
                        this.dustTimer = 0;
                    }
                }
                const isAttacking = this.weaponAnim.state !== 'idle';
                const isSprinting = Input.isSprint() && this.data.stamina > 0 && this.isMoving;
                if (!this.isDodging && !isAttacking && !isSprinting && this.data.stamina < this.data.maxStamina) {
                    this.staminaRegenDelay -= dt;
                    if (this.staminaRegenDelay <= 0) {
                        this.data.stamina += CONFIG.STAMINA_REGEN * (dt / 1000);
                        if (this.data.stamina > this.data.maxStamina) this.data.stamina = this.data.maxStamina;
                    }
                } else {
                    this.staminaRegenDelay = 500;
                }
                Object.values(this.attacks).forEach(a => a.update(dt));
                this.updateWeaponAnim(dt);
                const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
                // 左键拾取地面物品 — EventBus 解耦，避免 Player→Game 循环依赖
                if (!this.isDodging && Input.mouse.leftPressed) {
                    const pickupResult = EventBus.emitFirst('player:pickup', this.x, this.y, this.pickupRange || 40);
                    if (pickupResult) { Input.mouse.leftPressed = false; }
                }
                if (!this.isDodging) {
                    // === 攻击输入处理 ===
                    // BUG FIX：装备面板打开时，完全禁止攻击输入
                    // 防止用户在面板中装备武器时，因之前按住左键导致自动攻击
                    if (SystemUI.isOpen) {
                        Input.mouse.leftPressed = false;
                        // 注意：不重置 leftDown，避免面板关闭后立即攻击
                        return;
                    }
                    // 新设计：根据当前武器栏的实际装备类型决定攻击方式
                    const currentSlot = this.weaponMode; // 'weapon' or 'weapon2'
                    const currentItem = this.equipments[currentSlot];
                    const isWeaponEquipped = currentItem && currentItem.name;
                    // 判断当前栏位武器的类型
                    const isPistol = isWeaponEquipped && (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol');
                    const isBow = isWeaponEquipped && currentItem.weaponType === 'bow';
                    const isMelee = isWeaponEquipped && currentItem.category === 'weapon_melee';
                    
                    if (isPistol) {
                        // G18 全自动模式：按住 leftDown 持续射击
                        if (this.weaponSwitchCooldown <= 0 && Input.mouse.leftDown && this.attacks.pistol.canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                            this.rangedFireData = { targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities };
                            this.attacks.pistol.cooldown = this.attacks.pistol.maxCooldown;
                            this.triggerWeaponAnim();
                        }
                    } else if (Input.mouse.leftPressed) {
                        if (isMelee) {
                            // 近战攻击：使用 ThrustAttack
                            const atk = this.attacks.melee;
                            if (atk.canUse()) {
                                const success = atk.execute(this, mouseWorld.x, mouseWorld.y, entities);
                                if (success) {
                                    atk.cooldown = atk.maxCooldown;
                                    this.triggerWeaponAnim();
                                }
                            }
                        } else if (isBow) {
                            // 弓矢攻击：使用 RangedAttack
                            const atk = this.attacks.ranged;
                            if (atk.canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                                this.rangedFireData = { targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities };
                                atk.cooldown = atk.maxCooldown;
                                this.triggerWeaponAnim();
                            }
                        }
                        Input.mouse.leftPressed = false;
                    }
                }
            }
            triggerDodge(moveInput) {
                let dirX = moveInput.x, dirY = moveInput.y;
                if (dirX === 0 && dirY === 0) { dirX = Math.cos(this.rotation); dirY = Math.sin(this.rotation); }
                const len = Math.sqrt(dirX*dirX + dirY*dirY); if (len > 0) { dirX /= len; dirY /= len; }
                this.dodgeDirection = { x: dirX, y: dirY }; this.isDodging = true; this.dodgeTimer = CONFIG.DODGE_DURATION;
                this.dodgeCooldown = CONFIG.DODGE_COOLDOWN; this.dodgeInvincible = true; this.data.stamina -= CONFIG.STAMINA_DODGE_COST;
                // SoundManager.play('dodge');
                this.vx = 0; this.vy = 0; { let d = EffectManager._acquire('DodgeEffect');
                if (d) { d.x = this.x; d.y = this.y; d.dirX = dirX; d.dirY = dirY; d.life = 300; d.active = true;
                    d.trails.forEach((t,i) => { t.x = this.x - dirX*i*8; t.y = this.y - dirY*i*8; t.alpha = 1-i*0.15; }); }
                else d = new DodgeEffect(this.x, this.y, dirX, dirY);
                EffectManager.add(d); }
            }
            triggerWeaponAnim() {
                // 动画打断机制：无论当前动画在哪个阶段，立即重置为 windup 从头播放
                // 前提条件：调用方已检查 canUse() 和 stamina，确保满足攻击间隔
                this.weaponAnim.state = 'windup';
                this.weaponAnim.timer = 0;
                this.rangedFired = false;
                // 注意：_pendingThrust 在 execute() 中设置，不在此处清除
                // swing 阶段会消费 _pendingThrust 并触发 ThrustEffect，消费后设为 null
            }
            switchWeaponMode() {
                // === 新设计：weaponMode 只是表示当前使用哪个栏位 ===
                // 'weapon' = 使用武器栏1, 'weapon2' = 使用武器栏2
                const nextMode = this.weaponMode === 'weapon' ? 'weapon2' : 'weapon';
                const nextItem = this.equipments[nextMode];
                // 如果目标栏位为空，显示提示并禁止切换
                if (!nextItem || !nextItem.name) {
                    const hint = document.createElement('div');
                    hint.id = '_weaponSwitchHint';
                    hint.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:rgba(120,50,50,0.9);color:#d4c5a9;font-size:18px;padding:10px 24px;border-radius:8px;border:2px solid #9a5a5a;z-index:99999;pointer-events:none;font-family:"Noto Serif SC",serif;white-space:nowrap;transition:opacity 0.5s;';
                    hint.textContent = '⚠ ' + (nextMode === 'weapon' ? '武器栏1' : '武器栏2') + ' 无装备，无法切换';
                    document.body.appendChild(hint);
                    requestAnimationFrame(() => { if (hint) hint.style.opacity = '0'; setTimeout(() => { if (hint && hint.parentNode) hint.remove(); }, 800); });
                    return;
                }
                this.weaponMode = nextMode;
                // G18 切换保护：切换到 pistol 后 300ms 内不能开火
                if (nextItem.weaponType === 'pistol' || nextItem.rangedType === 'pistol') {
                    this.weaponSwitchCooldown = 300;
                }
                // 视觉反馈：屏幕中央显示切换提示
                const oldHint = document.getElementById('_weaponSwitchHint');
                if (oldHint) oldHint.remove();
                const hint = document.createElement('div');
                hint.id = '_weaponSwitchHint';
                hint.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:rgba(60,50,40,0.9);color:#d4c5a9;font-size:22px;padding:12px 28px;border-radius:8px;border:2px solid #7a6a5a;z-index:99999;pointer-events:none;font-family:"Noto Serif SC",serif;white-space:nowrap;transition:opacity 0.5s;';
                const modeName = this.weaponMode === 'weapon' ? '武器栏1' : '武器栏2';
                // 图标根据当前栏位的实际装备类型决定
                const currentItem = this.equipments[this.weaponMode];
                let modeIcon = '⚔';
                if (currentItem) {
                    if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') modeIcon = '🔫';
                    else if (currentItem.weaponType === 'bow') modeIcon = '🏹';
                }
                hint.textContent = `${modeIcon} ${modeName}`;
                document.body.appendChild(hint);
                requestAnimationFrame(() => { if (hint) hint.style.opacity = '0'; setTimeout(() => { if (hint && hint.parentNode) hint.remove(); }, 600); });
            }
            loadWeaponAssets(item) {
                if (!item) return;
                this.equippedRangedType = null;
                this.equippedBowFrames = null;
                const wt = item.weaponType;
                const wa = item.weaponAsset;
                if (!wt || !wa) return;
                if (wt === 'bow' && wa.framePrefix && wa.frameCount) {
                    const frames = [];
                    for (let i = 1; i <= wa.frameCount; i++) {
                        const num = String(i).padStart(wa.framePad || 2, '0');
                        const img = new Image(); img.src = wa.framePrefix + num + '.png'; frames.push(img);
                    }
                    this.equippedBowFrames = frames;
                    this.equippedRangedType = 'bow';
                } else if (wt === 'pistol' && wa.image) {
                    this.pistolImage = new Image(); this.pistolImage.src = wa.image;
                    this.equippedRangedType = 'pistol';
                    if (wa.muzzleImage) { this.muzzleFlashImg = new Image(); this.muzzleFlashImg.src = wa.muzzleImage; }
                }
            }
            _getAnimMs(baseMs) {
                // 根据当前装备的实际类型选择动画配置
                const currentItem = this.equipments[this.weaponMode];
                let cfgKey = 'sword'; // 默认
                if (currentItem) {
                    if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') cfgKey = 'pistol';
                    else if (currentItem.weaponType === 'bow') cfgKey = 'bow';
                }
                const cfg = WeaponAnimConfig[cfgKey];
                return cfg ? Math.round(baseMs * cfg.timingMul) : baseMs;
            }
            _fireRanged() {
                const d = this.rangedFireData;
                const c = Math.cos(this.rotation), sin = Math.sin(this.rotation);
                const currentItem = this.equipments[this.weaponMode];
                const isPistol = currentItem && (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol');
                const isBow = currentItem && currentItem.weaponType === 'bow';
                const wac = WeaponAnimConfig[isPistol ? 'pistol' : (isBow ? 'bow' : 'sword')];
                const holdX = wac ? wac.holdOffsetX : WEAPON_ANIM.holdX;
                const holdY = wac ? wac.holdOffsetY : WEAPON_ANIM.holdY;
                if (isPistol) {
                    // 枪口在枪身正前方
                    const gunLX = this.size + 20, gunLY = holdY;
                    // 子弹从枪口发射
                    const spawnX = this.x + c * (gunLX + 22) - sin * gunLY;
                    const spawnY = this.y + sin * (gunLX + 22) + c * gunLY;
                    const angle = Math.atan2(d.targetY - this.y, d.targetX - this.x);
                    const pc = this.attacks.pistol.config;
                    // 创建黄色曳光弹（isTracer = true）
                    { let p = EffectManager._acquire('Projectile');
                    if (p) { p.x = spawnX; p.y = spawnY; p.angle = angle; p.speed = pc.projectileSpeed; p.maxRange = pc.projectileRange; p.size = pc.projectileSize; p.damage = pc.damage; p.piercing = pc.piercing; p.source = this; p.entities = d.entities; p.image = null; p.isTracer = true; p.traveled = 0; p.active = true; p.hitTargets = new Set(); }
                    else p = new Projectile(spawnX, spawnY, angle, pc.projectileSpeed, pc.projectileRange, pc.projectileSize, pc.damage, pc.piercing, this, d.entities, null, true);
                    EffectManager.add(p); }
                    // 枪口火焰特效
                    const flashX = this.x + c * (gunLX + 28) - sin * gunLY;
                    const flashY = this.y + sin * (gunLX + 28) + c * gunLY;
                    { let m = EffectManager._acquire('MuzzleFlashEffect');
                    if (m) { m.x = flashX; m.y = flashY; m.angle = angle; m.life = m.maxLife; m.active = true; }
                    else m = new MuzzleFlashEffect(flashX, flashY, angle);
                    EffectManager.add(m); }
                    // 弹壳从抛壳窗弹出（枪身右侧后方）
                    { const cSX = this.x + c * (gunLX - 8) - sin * (gunLY + 6), cSY = this.y + sin * (gunLX - 8) + c * (gunLY + 6);
                    let s = EffectManager._acquire('ShellCasingEffect');
                    if (s) { s.x = cSX; s.y = cSY; s.life = s.maxLife; s.active = true; }
                    else s = new ShellCasingEffect(cSX, cSY, angle);
                    EffectManager.add(s); }
                } else if (isBow) {
                    const cfg = this.attacks.ranged.config;
                    const bowLX = this.size + 15, bowLY = holdY;
                    const spawnX = this.x + c * bowLX - sin * bowLY;
                    const spawnY = this.y + sin * bowLX + c * bowLY;
                    const angle = Math.atan2(d.targetY - spawnY, d.targetX - spawnX);
                    { let p = EffectManager._acquire('Projectile');
                    if (p) { p.x = spawnX; p.y = spawnY; p.angle = angle; p.speed = cfg.projectileSpeed; p.maxRange = cfg.projectileRange; p.size = cfg.projectileSize; p.damage = cfg.damage; p.piercing = cfg.piercing; p.source = this; p.entities = d.entities; p.image = this.arrowImage; p.traveled = 0; p.active = true; p.hitTargets = new Set(); }
                    else p = new Projectile(spawnX, spawnY, angle, cfg.projectileSpeed, cfg.projectileRange, cfg.projectileSize, cfg.damage, cfg.piercing, this, d.entities, this.arrowImage);
                    EffectManager.add(p); }
                }
                this.rangedFired = true; this.rangedFireData = null;
            }
            updateWeaponAnim(dt) {
                const wa = WEAPON_ANIM, anim = this.weaponAnim;
                switch (anim.state) {
                    case 'idle':
                        if (anim.spinEnd && Date.now() < anim.spinEnd) {
                            const t = 1 - (anim.spinEnd - Date.now()) / anim.spinDuration;
                            anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06 + t * Math.PI * 8;
                            break;
                        }
                        anim.spinEnd = 0;
                        anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06;
                        if (!anim.nextSpin) anim.nextSpin = Date.now() + 3000 + Math.random() * 3000;
                        if (Date.now() >= anim.nextSpin) {
                            anim.spinDuration = 600;
                            anim.spinEnd = Date.now() + anim.spinDuration;
                            anim.nextSpin = Date.now() + anim.spinDuration + 3000 + Math.random() * 3000;
                        }
                        break;
                    case 'windup':
                        anim.timer += dt;
                        if (anim.timer >= this._getAnimMs(wa.windupMs)) { anim.state = 'swing'; anim.timer = 0; }
                        else anim.angle = wa.idleAngle + (wa.windupAngle - wa.idleAngle) * easeInQuad(anim.timer / this._getAnimMs(wa.windupMs));
                        break;
                    case 'swing':
                        // 攻击特效已关闭（纯动作模式）：不显示 ThrustEffect 刺击特效
                        // swing 阶段刚开始（timer 从 0 开始）：原触发刺击特效
                        if (anim.timer === 0 && this._pendingThrust) {
                            // const pt = this._pendingThrust;
                            // const tr = (typeof pt.range === 'number' && pt.range > 0) ? pt.range : 100;
                            // const tw = (typeof pt.width === 'number' && pt.width > 0) ? pt.width : 20;
                            // EffectManager.add(new ThrustEffect(this, tr, tw));
                            this._pendingThrust = null; // 清除待处理数据，防止重复触发
                        }
                        anim.timer += dt;
                        if (anim.timer >= this._getAnimMs(wa.swingMs)) { anim.state = 'recover'; anim.timer = 0; }
                        else {
                            anim.angle = wa.windupAngle + (wa.swingAngle - wa.windupAngle) * easeOutQuad(anim.timer / this._getAnimMs(wa.swingMs));
                            // swing 阶段：根据当前装备类型决定发射逻辑
                const currentItem = this.equipments[this.weaponMode];
                const isRangedWeapon = currentItem && (currentItem.weaponType === 'bow' || currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol');
                if (!this.rangedFired && isRangedWeapon && this.rangedFireData) this._fireRanged();
                        }
                        break;
                    case 'recover':
                        anim.timer += dt;
                        if (anim.timer >= this._getAnimMs(wa.recoverMs)) { anim.state = 'idle'; anim.timer = 0; }
                        else anim.angle = wa.swingAngle + (wa.idleAngle - wa.swingAngle) * easeInOutCubic(anim.timer / this._getAnimMs(wa.recoverMs));
                        break;
                }
            }
            renderStaminaBar(ctx, x, y) {
                const barWidth = 36, barHeight = 5, staminaPercent = this.data.stamina / this.data.maxStamina;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(x - barWidth/2, y + this.size + 6, barWidth, barHeight);
                const staminaColor = staminaPercent > 0.5 ? '#a09060' : staminaPercent > 0.25 ? '#a08040' : '#8a4a4a';
                ctx.fillStyle = staminaColor; ctx.fillRect(x - barWidth/2, y + this.size + 6, barWidth * staminaPercent, barHeight);
                ctx.strokeStyle = 'rgba(90, 77, 63, 0.8)'; ctx.lineWidth = 1; ctx.strokeRect(x - barWidth/2, y + this.size + 6, barWidth, barHeight);
            }
            renderWeapon(ctx) {
                const wa = WEAPON_ANIM;
                const s = wa.size;
                // 获取当前武器栏位的装备
                const currentItem = this.equipments[this.weaponMode];
                if (!currentItem || !currentItem.name) return; // 当前栏位无装备，不渲染
                // 判断当前装备类型
                const isPistol = currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol';
                const isBow = currentItem.weaponType === 'bow';
                const isMelee = currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword';
                const anim = this.weaponAnim;
                const isAttacking = anim.state !== 'idle';
                ctx.save();
                // === 手枪渲染 ===
                if (isPistol) {
                    if (isAttacking) {
                        const pCfg = WeaponAnimConfig.pistol;
                        let recoil = 0, shakeY = 0;
                        if (anim.state === 'windup') {
                            recoil = -s * 0.04 * easeOutQuad(anim.timer / this._getAnimMs(wa.windupMs));
                        } else if (anim.state === 'swing') {
                            const st = anim.timer / this._getAnimMs(wa.swingMs);
                            recoil = s * 0.1 * (1 - st);
                            shakeY = (Math.random() - 0.5) * 3 * (1 - st);
                        } else {
                            const rt = anim.timer / this._getAnimMs(wa.recoverMs);
                            recoil = -s * 0.04 * (1 - rt);
                        }
                        const gunX = this.size + 12 + recoil;
                        ctx.translate(gunX, (pCfg.holdOffsetY || 0) + shakeY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.42);
                        // 枪口火焰
                        if (anim.state === 'swing' && anim.timer < this._getAnimMs(wa.swingMs) * 0.5) {
                            const flashAlpha = 1 - anim.timer / (this._getAnimMs(wa.swingMs) * 0.5);
                            ctx.save();
                            ctx.globalAlpha = flashAlpha;
                            const mImg = this.muzzleFlashImg || (this.muzzleFlashImg = Object.assign(new Image(), { src: 'assets/effects/muzzle_flash_01.png' })); if (mImg && mImg.complete && mImg.naturalWidth > 0) ctx.drawImage(mImg, s * 0.92, -s * 0.15, s * 0.35, s * 0.3);
                            ctx.restore();
                        }
                        const w = s * 0.35;
                        if (this.pistolImage && this.pistolImage.complete && this.pistolImage.naturalWidth > 0) ctx.drawImage(this.pistolImage, -w / 2, 0, w, s);
                    } else {
                        // 手枪待机
                        const pCfg = WeaponAnimConfig.pistol;
                        ctx.translate(this.size + 12, (pCfg.holdOffsetY || 0));
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.42);
                        let finalAngle = anim.angle;
                        if (this.isMoving && anim.state === 'idle' && !anim.spinEnd) {
                            const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                            finalAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                        }
                        ctx.rotate(finalAngle);
                        const w = s * 0.35;
                        if (this.pistolImage && this.pistolImage.complete && this.pistolImage.naturalWidth > 0) ctx.drawImage(this.pistolImage, -w / 2, 0, w, s);
                    }
                }
                // === 弓渲染 ===
                else if (isBow) {
                    if (isAttacking) {
                        let t = 0;
                        if (anim.state === 'windup') t = easeOutQuad(anim.timer / wa.windupMs);
                        else if (anim.state === 'swing') t = 1;
                        else if (anim.state === 'recover') t = 1 - easeInQuad(anim.timer / wa.recoverMs);
                        const startX = wa.holdX;
                        const endX = this.size + 15;
                        const curX = startX + (endX - startX) * t;
                        ctx.translate(curX, wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        ctx.rotate(Math.PI / 2 * t);
                        // 8帧弓动画
                        const frames = this.equippedBowFrames || this.bowFrames;
                        let frameIdx = 0;
                        const totalMs = wa.windupMs + wa.swingMs + wa.recoverMs;
                        let attackProgress = 0;
                        if (anim.state === 'windup') attackProgress = anim.timer / totalMs;
                        else if (anim.state === 'swing') attackProgress = (wa.windupMs + anim.timer) / totalMs;
                        else if (anim.state === 'recover') attackProgress = (wa.windupMs + wa.swingMs + anim.timer) / totalMs;
                        frameIdx = Math.min(7, Math.floor(attackProgress * 8));
                        const bowImg = frames[frameIdx] || frames[0];
                        const w = s * 0.38;
                        if (bowImg && bowImg.complete && bowImg.naturalWidth > 0) ctx.drawImage(bowImg, -w / 2, -s / 2, w, s);
                        else { const w2 = s * 0.84; if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) ctx.drawImage(this.meleeImage, -w2 / 2, -s / 2, w2, s); }
                    } else {
                        // 弓待机
                        const bowCfg = WeaponAnimConfig.bow;
                        ctx.translate(bowCfg.holdOffsetX || wa.holdX, bowCfg.holdOffsetY || wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        let finalAngle = anim.angle;
                        if (this.isMoving && anim.state === 'idle' && !anim.spinEnd) {
                            const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                            finalAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                        }
                        ctx.rotate(finalAngle);
                        ctx.translate(0, -s / 2);
                        const frames = this.equippedBowFrames || this.bowFrames;
                        const bowImg = frames[0];
                        const w = s * 0.38;
                        if (bowImg && bowImg.complete && bowImg.naturalWidth > 0) ctx.drawImage(bowImg, -w / 2, -s / 2, w, s);
                        else { const w2 = s * 0.84; if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) ctx.drawImage(this.meleeImage, -w2 / 2, -s / 2, w2, s); }
                    }
                }
                // === 近战（剑等）渲染 ===
                else if (isMelee) {
                    if (isAttacking) {
                        // 使用刺击动画配置（Stab Animation），可被所有剑类武器复用
                        const stab = WeaponAnimConfig.stab;
                        ctx.translate(wa.holdX + 8, wa.holdY + 6);
                        ctx.rotate(Math.PI / 2);
                        // 移动到武器中心（旋转中心在武器中心）
                        ctx.translate(0, -s * 0.85);
                        let thrustOffset = 0;
                        if (anim.state === 'windup') {
                            const t = anim.timer / this._getAnimMs(wa.windupMs);
                            // 蓄力：使用 easeInCubic，前急后缓，强化爆发力感
                            thrustOffset = -s * stab.windupDist * easeInCubic(t);
                        } else if (anim.state === 'swing') {
                            const t = anim.timer / this._getAnimMs(wa.swingMs);
                            // 刺击：前60%快速突刺，后40%保持最远距离
                            if (t < 0.6) {
                                const pt = t / 0.6;
                                // 从蓄力回退位置快速前刺到最大距离
                                thrustOffset = -s * stab.windupDist + s * (stab.stabDist + stab.windupDist) * easeInCubic(pt);
                            } else {
                                thrustOffset = s * stab.stabDist;
                            }
                        } else {
                            const t = anim.timer / this._getAnimMs(wa.recoverMs);
                            // 收回：从最大距离平滑回到0
                            thrustOffset = s * stab.stabDist * (1 - easeOutQuad(t));
                        }
                        ctx.translate(0, thrustOffset);
                        ctx.rotate(anim.angle);
                        const w = s * 0.84;
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) ctx.drawImage(this.meleeImage, -w / 2, -s / 2, w, s);
                    } else {
                        // 近战待机：武器绕自身中心旋转（呼吸效果）
                        const swordCfg = WeaponAnimConfig.sword;
                        ctx.translate(swordCfg.holdOffsetX || wa.holdX, swordCfg.holdOffsetY || wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        // 先移动到武器中心，使旋转中心在武器中心
                        ctx.translate(0, -s * 0.85);
                        // 武器待机呼吸旋转：绕武器中心轻微旋转，速度更快更有力
                        let breatheAngle = Math.sin(Date.now() / 600) * 0.12; // 约 ±7° 旋转
                        if (this.isMoving && anim.state === 'idle' && !anim.spinEnd) {
                            const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                            // 移动时旋转幅度稍大，配合步伐
                            breatheAngle += Math.sin(this.animTime * 0.5) * Math.min(0.2, mSpeed * 0.06);
                        }
                        ctx.rotate(breatheAngle);
                        const w = s * 0.84;
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) ctx.drawImage(this.meleeImage, -w / 2, -s / 2, w, s);
                    }
                }
                ctx.restore();
            }
            render(ctx) {
                const pos = Renderer.worldToScreen(this.x, this.y), x = pos.x, y = pos.y + (this.isDodging ? 0 : Math.sin(this.animTime) * 2);
                this.renderStaminaBar(ctx, x, y); ctx.save(); ctx.translate(x, y);
                if (this.isDodging) { const tilt = Math.atan2(this.dodgeDirection.y, this.dodgeDirection.x); ctx.rotate(tilt + Math.PI/2); }
                else ctx.rotate(this.rotation);
                const currentItem = this.equipments[this.weaponMode];
                let attackType = 'melee';
                if (currentItem) {
                    if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') attackType = 'pistol';
                    else if (currentItem.weaponType === 'bow') attackType = 'ranged';
                }
                const attack = this.attacks[attackType];
                if (this.isDodging) ctx.globalAlpha = 0.7;
                ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 10, 8, 4, 0, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = this.isDodging ? '#a0c0a0' : CONFIG.PLAYER_COLOR; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = 'rgba(154, 186, 138, 0.3)'; ctx.beginPath(); ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI*2); ctx.fill();
                this.renderWeapon(ctx);
                ctx.fillStyle = '#d4c5a9'; ctx.beginPath(); ctx.moveTo(this.size + 5, 0); ctx.lineTo(this.size - 1, -4); ctx.lineTo(this.size - 1, 4); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = 'rgba(122, 154, 106, 0.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, this.size + 5 + Math.sin(Date.now()/300)*1.5, 0, Math.PI*2); ctx.stroke();
                ctx.restore();
                ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px "Noto Serif SC"'; ctx.textAlign = 'center'; ctx.fillText(this.data.name, x, y - 32);
            }
        }


        
        class FloatingTextEffect {
            constructor(x, y, text) {
                this.x = x; this.y = y; this.text = text;
                this.life = 1200; this.maxLife = 1200; this.active = true;
                this.vy = -0.8;
            }
            update() {
                this.life -= 16;
                this.y += this.vy;
                if (this.life <= 0) this.active = false;
            }
            render(ctx) {
                const alpha = this.life / this.maxLife;
                const pos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.globalAlpha = alpha;
                ctx.fillStyle = '#d4c5a9'; ctx.font = '14px "Noto Serif SC"'; ctx.textAlign = 'center';
                ctx.fillText(this.text, pos.x, pos.y);
                ctx.restore();
            }
        }

        class MuzzleFlashEffect {
            constructor(x, y, angle) {
                this.x = x; this.y = y; this.angle = angle;
                this.life = 80; this.maxLife = 80; this.active = true;
                if (!MuzzleFlashEffect._sharedImage) { MuzzleFlashEffect._sharedImage = new Image(); MuzzleFlashEffect._sharedImage.src = 'assets/effects/muzzle_flash_01.png'; }
                this.image = MuzzleFlashEffect._sharedImage;
            }
            update() { this.life -= 16; if (this.life <= 0) this.active = false; }
            render(ctx) {
                const alpha = this.life / this.maxLife;
                const pos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(this.angle);
                if (this.image && this.image.complete) {
                    const s = 28 * (0.6 + alpha * 0.4);
                    ctx.globalAlpha = alpha;
                    if (this.image && this.image.complete && this.image.naturalWidth > 0) ctx.drawImage(this.image, 0, -s * 0.35, s, s * 0.7);
                }
                ctx.restore();
            }
        }

        class ShellCasingEffect {
            constructor(x, y, angle) {
                this.x = x; this.y = y; this.angle = angle;
                this.life = 800; this.maxLife = 800; this.active = true;
                if (!ShellCasingEffect._sharedImage) { ShellCasingEffect._sharedImage = new Image(); ShellCasingEffect._sharedImage.src = 'assets/ammo/shell_ground.png'; }
                this.image = ShellCasingEffect._sharedImage;
                // 弹壳从枪口右侧弹出，做抛物线
                const ejectAngle = angle + Math.PI * 0.7 + (Math.random() - 0.5) * 0.5;
                const speed = 2.5 + Math.random() * 2;
                this.vx = Math.cos(ejectAngle) * speed;
                this.vy = Math.sin(ejectAngle) * speed;
                this.rot = 0; this.rotSpeed = (Math.random() - 0.5) * 0.4;
                this.grounded = false;
                this.groundY = y + (Math.random() * 5);
            }
            update() {
                this.life -= 16;
                if (this.life <= 0) { this.active = false; return; }
                if (!this.grounded) {
                    this.x += this.vx; this.y += this.vy;
                    this.vy += 0.12; // 重力
                    this.rot += this.rotSpeed;
                    this.vx *= 0.98;
                    if (this.y >= this.groundY) {
                        this.grounded = true;
                        this.y = this.groundY;
                        this.vx *= 0.3;
                    }
                }
            }
            render(ctx) {
                const alpha = Math.min(1, this.life / 200);
                const pos = Renderer.worldToScreen(this.x, this.y);
                ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(this.rot);
                ctx.globalAlpha = alpha;
                if (this.grounded && this.image && this.image.complete) {
                    if (this.image && this.image.complete && this.image.naturalWidth > 0) ctx.drawImage(this.image, -6, -4, 12, 8);
                } else {
                    ctx.fillStyle = '#c4a035';
                    ctx.beginPath(); ctx.ellipse(0, 0, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
                }
                ctx.restore();
            }
        }

        class DropItem extends Entity {
            constructor(x, y, itemData) {
                super(x, y);
                this.x = x; this.y = y; this.itemData = itemData || {};
                this.size = 16; this.active = true; this.life = 60000; // 60秒后消失
                this.bobOffset = 0; this.image = new Image(); this.image.src = itemData.dropImage || 'assets/items/steel_bow_dropped.png';
                this.pickupRange = 30;
            }
            update(dt) {
                this.life -= dt;
                this.bobOffset += dt * 0.003;
                if (this.life <= 0) this.active = false;
            }
            render(ctx) {
                const pos = Renderer.worldToScreen(this.x, this.y);
                const bobY = Math.sin(this.bobOffset) * 4;
                ctx.save(); ctx.translate(pos.x, pos.y + bobY);
                // 鼠标悬停检测
                const mx = Input.mouse.x, my = Input.mouse.y;
                const hover = Math.sqrt((mx - pos.x) * (mx - pos.x) + (my - (pos.y + bobY)) * (my - (pos.y + bobY))) < 35;
                // 发光效果
                ctx.shadowColor = hover ? 'rgba(255, 215, 0, 0.8)' : 'rgba(200, 170, 100, 0.5)';
                ctx.shadowBlur = hover ? 20 : 12;
                if (this.image && this.image.complete && this.image.naturalWidth > 0) {
                    const s = hover ? 40 : 32;
                    if (this.image && this.image.complete && this.image.naturalWidth > 0) ctx.drawImage(this.image, -s/2, -s/2, s, s);
                } else {
                    ctx.fillStyle = '#c4a55a'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI*2); ctx.fill();
                }
                ctx.shadowBlur = 0;
                // 金色轮廓高亮
                if (hover) {
                    ctx.strokeStyle = 'rgba(255, 215, 0, 0.9)'; ctx.lineWidth = 2.5;
                    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke();
                }
                // 标签
                ctx.fillStyle = hover ? 'rgba(255, 235, 150, 1)' : 'rgba(212, 197, 169, 0.9)';
                ctx.font = hover ? '13px "Noto Serif SC"' : '11px "Noto Serif SC"'; ctx.textAlign = 'center';
                ctx.fillText(this.itemData.name, 0, 28);
                ctx.fillStyle = 'rgba(138, 125, 107, 0.7)'; ctx.font = '10px "Noto Serif SC"';
                ctx.fillText('[左键拾取]', 0, 42);
                ctx.restore();
            }
        }
        class Enemy extends DamageableEntity {
            constructor(x, y, config = {}) {
                super(x, y, { hp: config.hp || 150, maxHp: config.maxHp || 150, size: config.size || 14, collisionRadius: 12, name: config.name || '测试敌人' });
                this.speed = config.speed || 0.3; this.maxSpeed = this.speed; this.accel = 0.7; this.friction = 0.82;
                this.animTime = 0; this.isMoving = false; this.rotation = 0;
                this.attacks = { melee: new ThrustAttack({ cooldown: 600, range: 80, width: 20, damage: { min: 8, max: 15 }, knockback: 15 }) };
                this.weaponMode = 'melee';
                this.weaponImage = new Image(); this.weaponImage.src = 'assets/weapons/1-rusty_sword_euip.png';
                this.weaponAnim = { state: 'idle', timer: 0, angle: WEAPON_ANIM.idleAngle };
                this.data = { stamina: 9999, maxStamina: 9999, name: this.name, kills: 0 };
                this.aiTimer = 0; this.aiInterval = 300; this.target = null; this.attackRange = 70;
            }
            triggerWeaponAnim() {
                // 动画打断机制：无论当前动画状态，立即重置为 windup
                this.weaponAnim.state = 'windup';
                this.weaponAnim.timer = 0;
            }
            updateWeaponAnim(dt) {
                const wa = WEAPON_ANIM, anim = this.weaponAnim;
                switch (anim.state) {
                    case 'idle': anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06; break;
                    case 'windup':
                        anim.timer += dt;
                        if (anim.timer >= wa.windupMs) { anim.state = 'swing'; anim.timer = 0; }
                        else anim.angle = wa.idleAngle + (wa.windupAngle - wa.idleAngle) * easeInQuad(anim.timer / wa.windupMs);
                        break;
                    case 'swing':
                        anim.timer += dt;
                        if (anim.timer >= wa.swingMs) { anim.state = 'recover'; anim.timer = 0; }
                        else anim.angle = wa.windupAngle + (wa.swingAngle - wa.windupAngle) * easeOutQuad(anim.timer / wa.swingMs);
                        break;
                    case 'recover':
                        anim.timer += dt;
                        if (anim.timer >= wa.recoverMs) { anim.state = 'idle'; anim.timer = 0; }
                        else anim.angle = wa.swingAngle + (wa.idleAngle - wa.swingAngle) * easeInOutCubic(anim.timer / wa.recoverMs);
                        break;
                }
            }
            renderWeapon(ctx) {
                if (!this.weaponImage || !this.weaponImage.complete) return;
                const wa = WEAPON_ANIM, s = wa.size, w = s * 0.84;
                ctx.save();
                ctx.translate(wa.holdX, wa.holdY);
                ctx.rotate(Math.PI / 2);
                let finalAngle = this.weaponAnim.angle;
                if (this.isMoving && this.weaponAnim.state === 'idle') {
                    const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                    finalAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                }
                ctx.rotate(finalAngle);
                if (this.weaponImage && this.weaponImage.complete && this.weaponImage.naturalWidth > 0) ctx.drawImage(this.weaponImage, -w / 2, -s / 2, w, s);
                ctx.restore();
            }
            // === AI 系统：移动寻路 与 攻击指令 完全分离 ===
            update(dt, entities) {
                super.update();
                // 1. 寻找目标
                if (!this.target) {
                    entities.forEach(e => { if (e instanceof Player) this.target = e; });
                }
                if (!this.target || !this.target.active) return;
                const dx = this.target.x - this.x, dy = this.target.y - this.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                this.rotation = Math.atan2(dy, dx);
                // 2. 移动系统（始终独立运行）
                this._updateMovement(dx, dy, dist);
                // 3. 攻击系统（始终独立运行）
                this._updateAttack(dt, entities);
                // 4. 更新攻击冷却和武器动画
                this.attacks.melee.update(dt);
                this.updateWeaponAnim(dt);
            }
            // --- 移动寻路子系统：始终朝玩家移动，带墙壁碰撞和绕路 ---
            _updateMovement(dx, dy, dist) {
                // 归一化方向
                const moveX = dx / Math.max(dist, 1), moveY = dy / Math.max(dist, 1);
                // 加速度
                this.vx += (moveX * this.maxSpeed - this.vx) * this.accel;
                this.vy += (moveY * this.maxSpeed - this.vy) * this.accel;
                // 墙壁碰撞解析
                const enx = this.x + this.vx, eny = this.y + this.vy;
                const er = WallSystem.resolve(this.x, this.y, enx, eny, this.collisionRadius || 12);
                if (er.x === this.x && er.y === this.y) {
                    // 被墙困住：沿切线方向滑动（绕路）
                    this.vx *= 0.5; this.vy *= 0.5;
                    const tangentX = -moveY, tangentY = moveX;
                    const slideDist = this.maxSpeed * 2;
                    // 尝试切线方向 A
                    const saX = this.x + tangentX * slideDist, saY = this.y + tangentY * slideDist;
                    const saR = WallSystem.resolve(this.x, this.y, saX, saY, this.collisionRadius || 12);
                    if (saR.x !== this.x || saR.y !== this.y) {
                        this.x = saR.x; this.y = saR.y;
                        this.vx = tangentX * this.maxSpeed * 0.5;
                        this.vy = tangentY * this.maxSpeed * 0.5;
                    } else {
                        // 尝试切线方向 B（反向）
                        const sbX = this.x - tangentX * slideDist, sbY = this.y - tangentY * slideDist;
                        const sbR = WallSystem.resolve(this.x, this.y, sbX, sbY, this.collisionRadius || 12);
                        if (sbR.x !== this.x || sbR.y !== this.y) {
                            this.x = sbR.x; this.y = sbR.y;
                            this.vx = -tangentX * this.maxSpeed * 0.5;
                            this.vy = -tangentY * this.maxSpeed * 0.5;
                        } else {
                            this.vx = 0; this.vy = 0;
                        }
                    }
                } else {
                    if (er.x === this.x) this.vx = 0;
                    if (er.y === this.y) this.vy = 0;
                    this.x = er.x; this.y = er.y;
                }
                // 距离近时摩擦减速（避免冲过头）
                if (dist <= this.attackRange) {
                    this.vx *= this.friction;
                    this.vy *= this.friction;
                }
                this.isMoving = Math.abs(this.vx) > 0.1 || Math.abs(this.vy) > 0.1;
                if (this.isMoving) this.animTime += 0.15;
            }
            // --- 攻击指令子系统：独立运行，只要视线未被墙完全阻挡就尝试攻击 ---
            _updateAttack(dt, entities) {
                this.aiTimer += dt;
                if (this.aiTimer < this.aiInterval) return;
                if (!this.attacks.melee.canUse()) return;
                // 视线检测：检查攻击是否被墙阻挡
                // 即使不在攻击范围内，只要视线未被完全阻挡就尝试攻击
                const targetX = this.target.x, targetY = this.target.y;
                const isBlocked = typeof WallSystem !== 'undefined' &&
                    WallSystem.blocked(this.x, this.y, targetX, targetY);
                if (isBlocked) return; // 视线被墙完全挡住，无法攻击
                // 执行攻击（无论距离是否精确在 attackRange 内，都会尝试）
                this.aiTimer = 0;
                if (this.attacks.melee.use(this, targetX, targetY, Array.from(entities.values()))) {
                    this.triggerWeaponAnim();
                }
            }
            render(ctx) {
                const pos = Renderer.worldToScreen(this.x, this.y), x = pos.x, y = pos.y + Math.sin(this.animTime) * 2;
                this.renderHealthBar(ctx);
                ctx.save(); ctx.translate(x, y); ctx.rotate(this.rotation);
                ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 10, 8, 4, 0, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = '#8a4a4a'; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = 'rgba(180, 100, 100, 0.3)'; ctx.beginPath(); ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI*2); ctx.fill();
                this.renderWeapon(ctx);
                ctx.fillStyle = '#d4c5a9'; ctx.beginPath(); ctx.moveTo(this.size + 5, 0); ctx.lineTo(this.size - 1, -4); ctx.lineTo(this.size - 1, 4); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = 'rgba(180, 100, 100, 0.3)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, this.size + 5 + Math.sin(Date.now()/300)*1.5, 0, Math.PI*2); ctx.stroke();
                ctx.restore();
                ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px "Noto Serif SC"'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 32);
            }
        }

        const QuickBar = {
            slots: [],
            init() {
                const skillGroup = document.getElementById('skillGroup');
                const itemGroup = document.getElementById('itemGroup');
                if (!skillGroup || !itemGroup) return;
                QUICK_BAR_CONFIG.forEach(config => {
                    const slot = document.createElement('div');
                    slot.id = config.id;
                    slot.className = `quick-slot ${config.type} empty`;
                    slot.innerHTML = `<span style="font-size:20px">${config.icon}</span><span class="key-hint">${config.key}</span>`;
                    slot.title = `${config.placeholder} (${config.key})`;
                    slot.dataset.type = config.type;
                    slot.dataset.key = config.key;
                    if (config.type === 'skill') skillGroup.appendChild(slot);
                    else itemGroup.appendChild(slot);
                    this.slots.push({ config, element: slot });
                });
            },
            useSlot(keyCode) {
                const slot = this.slots.find(s => s.config.keyCode === keyCode);
                if (!slot) return;
                // QuickBar slot triggered (placeholder - no skill assigned)
                slot.element.style.transform = 'scale(0.95)';
                setTimeout(() => slot.element.style.transform = '', 100);
            }
        };

        const WeaponAnimConfig = {
            bow: { holdOffsetX: -20, holdOffsetY: 11, timingMul: 1.0, animType: 'frameSequence' },
            pistol: { holdOffsetX: 0, holdOffsetY: 4, timingMul: 0.06, animType: 'recoil', recoilAmount: 0.15 },
            sword: { holdOffsetX: -20, holdOffsetY: 11, timingMul: 1.0, animType: 'thrust' },
            stab: {
                // 刺击动画通用配置（可被所有剑类武器复用）
                windupMs: 150,      // 蓄力时间（ms）
                stabMs: 200,        // 刺击时间（ms）— 快速有力
                recoverMs: 350,     // 收回时间（ms）
                windupDist: 0.35,   // 蓄力回退距离（倍率）
                stabDist: 1.8,      // 前刺距离（倍率）— 比原版 1.25 更远
                recoverDist: 0.9,   // 收回位置（倍率）
                easeIn: easeInCubic,    // 蓄力缓动：前急后缓
                easeOut: easeOutQuad,   // 刺击缓动：快速爆发
                easeRecover: easeOutQuad, // 收回缓动
                // 角度变化（可选，留空则使用 WEAPON_ANIM 默认值）
                idleAngle: 0, windupAngle: Math.PI / 6, swingAngle: -Math.PI / 6,
            }
        };

        // ItemFactory — 物品工厂，为每个物品创建独立实例
        const ItemFactory = {
            _nextId: 1,
            generateId() { return 'item_' + Date.now() + '_' + (this._nextId++); },
            /** 从模板创建全新的独立物品实例 */
            create(template) {
                const instance = JSON.parse(JSON.stringify(template)); // 深拷贝，完全独立
                instance.itemId = this.generateId();
                instance.createdAt = Date.now();
                delete instance.slot; // 清除模板中的slot占位
                return instance;
            },
            /** 克隆已有实例（卸下装备时），分配新ID */
            clone(itemInstance) {
                const clone = JSON.parse(JSON.stringify(itemInstance));
                clone.itemId = this.generateId();
                clone.createdAt = Date.now();
                delete clone.slot;
                return clone;
            }
        };

        const ItemDatabase = {
            items: {
                rusty_sword: {
                    weaponId: 'weapon1',
                    name: '生锈的长剑', type: '单手剑', icon: '⚔', iconImage: 'assets/icons/1-rusty_sword_macro.png',
                    category: 'weapon_melee', rarity: 'common', level: 1,
                    weaponCategory: 'mainhand', weaponType: 'sword',
                    stats: [{ name: '物理攻击', value: '12-18' }, { name: '攻速', value: '1.2' }],
                    desc: '一把锈迹斑斑的旧剑',
                    equipSlot: 'weapon'
                },
                training_bow: {
                    name: '训练用弓', type: '副武器', icon: '🏹', iconImage: 'assets/icons/bow_icon.png',
                    category: 'weapon_ranged', rarity: 'common', level: 1,
                    weaponCategory: 'mainhand', weaponType: 'bow',
                    weaponAsset: { framePrefix: 'assets/weapons/bow_frame_', frameCount: 8, framePad: 2 },
                    stats: [{ name: '物理攻击', value: '8-14' }, { name: '攻速', value: '1.0' }, { name: '射程', value: '600' }],
                    desc: '一把简陋的弓，勉强能射出箭，适合初学者练习',
                    equipSlot: 'weapon2'
                },
                steel_bow: {
                    name: '精钢长弓', type: '副武器', icon: '🏹', iconImage: 'assets/icons/bow_icon.png',
                    category: 'weapon_ranged', rarity: 'uncommon', level: 5,
                    dropImage: 'assets/items/steel_bow_dropped.png',
                    weaponCategory: 'mainhand', weaponType: 'bow',
                    weaponAsset: { framePrefix: 'assets/weapons/steel_bow_frame_', frameCount: 8, framePad: 2 },
                    stats: [{ name: '物理攻击', value: '15-25' }, { name: '攻速', value: '1.0' }, { name: '射程', value: '800' }],
                    desc: '由精钢打造的长弓，射程远，威力大',
                    equipSlot: 'weapon2'
                },
                g18_pistol: {
                    name: 'G18 手枪', type: '副武器', icon: '🔫', iconImage: 'assets/icons/pistol_icon.png',
                    category: 'weapon_ranged', rarity: 'common', level: 1,
                    weaponCategory: 'mainhand',
                    dropImage: 'assets/weapons/g18_topdown_v2.png',
                    weaponType: 'pistol',
                    weaponAsset: { image: 'assets/weapons/g18_topdown_v2.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
                    stats: [{ name: '物理攻击', value: '6-12' }, { name: '攻速', value: '3.0' }, { name: '射程', value: '500' }],
                    desc: 'G18 全自动手枪，1100发/分钟，黄色曳光弹',
                    equipSlot: 'weapon2'
                },
                // --- 防具 ---
                novice_cap: { name: '新手布帽', type: '头盔', icon: '⛑', category: 'armor', rarity: 'common', level: 1, stats: [{ name: '物理防御', value: '+2', pos: true }], desc: '一件破旧的头巾', equipSlot: 'helmet' },
                rough_necklace: { name: '粗制项链', type: '项链', icon: '📿', category: 'accessory', rarity: 'common', level: 1, stats: [{ name: '最大生命值', value: '+10', pos: true }], desc: '用绳子串起来的小石头', equipSlot: 'necklace' },
                old_leather_armor: { name: '旧皮甲', type: '盔甲', icon: '🛡', category: 'armor', rarity: 'common', level: 1, stats: [{ name: '物理防御', value: '+5', pos: true }], desc: '不知道传了多少手的皮甲', equipSlot: 'armor' },
                old_wooden_shield: { name: '旧木盾', type: '副手', icon: '🛡', category: 'armor', rarity: 'common', level: 1, weaponCategory: 'offhand', stats: [{ name: '物理防御', value: '+3', pos: true }], desc: '用木板拼成的盾牌', equipSlot: 'offhand' },
                copper_ring: { name: '铜戒指', type: '戒指', icon: '💍', category: 'accessory', rarity: 'common', level: 1, stats: [{ name: '幸运', value: '+1', pos: true }], desc: '一枚生锈的铜戒指', equipSlot: 'ring1' },
                leather_gloves: { name: '皮手套', type: '手套', icon: '🧤', category: 'armor', rarity: 'common', level: 1, stats: [{ name: '物理攻击', value: '+2', pos: true }], desc: '保护双手的皮手套', equipSlot: 'gloves' },
                iron_ring: { name: '铁戒指', type: '戒指', icon: '💍', category: 'accessory', rarity: 'common', level: 1, stats: [{ name: '力量', value: '+1', pos: true }], desc: '简单的铁戒指', equipSlot: 'ring2' },
                basic_belt: { name: '腰带', type: '腰带', icon: '⛓', category: 'accessory', rarity: 'common', level: 1, stats: [{ name: '最大体力', value: '+5', pos: true }], desc: '一根普通的腰带', equipSlot: 'belt' },
                old_leather_boots: { name: '旧皮靴', type: '靴子', icon: '👢', category: 'armor', rarity: 'common', level: 1, stats: [{ name: '移动速度', value: '+5%', pos: true }], desc: '磨破了的旧靴子', equipSlot: 'boots' },
                // --- 消耗品 ---
                hp_potion: { name: '治疗药水', type: '消耗品', icon: '🧪', category: 'consumable', rarity: 'common', level: 1, stats: [{ name: '恢复生命', value: '+30' }], desc: '一瓶红色的药水，味道有点甜', stack: 5, equipSlot: '' },
                mp_potion: { name: '魔力药水', type: '消耗品', icon: '💧', category: 'consumable', rarity: 'common', level: 1, stats: [{ name: '恢复魔法', value: '+25' }], desc: '一瓶蓝色的药水，冒着冷气', stack: 3, equipSlot: '' }
            },
            get(id) { return this.items[id] ? { ...this.items[id], _id: id } : null; },
            getDefaultEquip() {
                return {
                    helmet: this.get('novice_cap'),
                    necklace: this.get('rough_necklace'),
                    weapon: this.get('rusty_sword'),
                    armor: this.get('old_leather_armor'),
                    offhand: this.get('old_wooden_shield'),
                    ring1: this.get('copper_ring'),
                    gloves: this.get('leather_gloves'),
                    ring2: this.get('iron_ring'),
                    belt: this.get('basic_belt'),
                    boots: this.get('old_leather_boots')
                };
            },
            getDefaultBackpack() {
                return [
                    { ...this.get('hp_potion'), slot: 0 },
                    { ...this.get('mp_potion'), slot: 1 }
                ];
            }
        };

        const EquipManager = {
            TEST_EQUIPMENTS: {
                helmet: { name: '新手布帽', type: '头盔', icon: '⛑', iconImage: 'assets/icons/helmet_icon.png', equipSlot: 'helmet', stats: [{ name: '物理防御', value: '+2', pos: true }, { name: '最大生命', value: '+15', pos: true }], desc: '一件破旧的头巾', level: 1, rarity: 'common' },
                necklace: { name: '粗制项链', type: '项链', icon: '📿', iconImage: 'assets/icons/necklace_icon.png', equipSlot: 'necklace', stats: [{ name: '最大生命值', value: '+10', pos: true }, { name: '法力回复', value: '+1/秒', pos: true }], desc: '用绳子串起来的小石头', level: 1, rarity: 'common' },
                weapon: { weaponId: 'weapon1', name: '生锈的长剑', type: '单手剑', icon: '⚔', iconImage: 'assets/icons/1-rusty_sword_macro.png', category: 'weapon_melee', equipSlot: 'weapon', stats: [{ name: '物理攻击', value: '12-18' }, { name: '攻速', value: '1.2' }, { name: '暴击率', value: '+3%', pos: true }], desc: '一把锈迹斑斑的旧剑', level: 1, rarity: 'common', weaponType: 'sword' },
                armor: { name: '旧皮甲', type: '盔甲', icon: '🛡', iconImage: 'assets/icons/armor_icon.png', equipSlot: 'armor', stats: [{ name: '物理防御', value: '+5', pos: true }, { name: '最大生命', value: '+25', pos: true }, { name: '韧性', value: '+2', pos: true }], desc: '不知道传了多少手的皮甲', level: 1, rarity: 'common' },
                offhand: { name: '旧木盾', type: '副手', icon: '🛡', iconImage: 'assets/icons/shield_icon.png', category: 'armor', weaponCategory: 'offhand', equipSlot: 'offhand', stats: [{ name: '物理防御', value: '+3', pos: true }, { name: '格挡率', value: '+5%', pos: true }], desc: '用木板拼成的盾牌', level: 1, rarity: 'common' },
                weapon2: { name: '训练用弓', type: '远程武器', icon: '🏹', iconImage: 'assets/icons/bow_icon.png', category: 'weapon_ranged', equipSlot: 'weapon2', stats: [{ name: '物理攻击', value: '8-14' }, { name: '攻速', value: '1.0' }, { name: '射程', value: '600' }], desc: '一把简陋的弓，勉强能射出箭', level: 1, rarity: 'common', weaponType: 'bow', weaponAsset: { framePrefix: 'assets/weapons/bow_frame_', frameCount: 8, framePad: 2 }, bowFrames: ['assets/weapons/bow_frame_01.png','assets/weapons/bow_frame_02.png','assets/weapons/bow_frame_03.png','assets/weapons/bow_frame_04.png','assets/weapons/bow_frame_05.png','assets/weapons/bow_frame_06.png','assets/weapons/bow_frame_07.png','assets/weapons/bow_frame_08.png'] },
                ring1: { name: '铜戒指', type: '戒指', icon: '💍', iconImage: 'assets/icons/ring_icon.png', equipSlot: 'ring1', stats: [{ name: '幸运', value: '+1', pos: true }, { name: '金币获取', value: '+5%', pos: true }], desc: '一枚生锈的铜戒指', level: 1, rarity: 'common' },
                gloves: { name: '皮手套', type: '手套', icon: '🧤', iconImage: 'assets/icons/gloves_icon.png', equipSlot: 'gloves', stats: [{ name: '物理攻击', value: '+2', pos: true }, { name: '攻击速度', value: '+3%', pos: true }], desc: '保护双手的皮手套', level: 1, rarity: 'common' },
                ring2: { name: '铁戒指', type: '戒指', icon: '💍', iconImage: 'assets/icons/ring_icon.png', equipSlot: 'ring2', stats: [{ name: '力量', value: '+1', pos: true }, { name: '物理攻击', value: '+2', pos: true }], desc: '简单的铁戒指', level: 1, rarity: 'common' },
                belt: { name: '腰带', type: '腰带', icon: '⛓', iconImage: 'assets/icons/belt_icon.png', equipSlot: 'belt', stats: [{ name: '最大体力', value: '+5', pos: true }, { name: '负重', value: '+10', pos: true }], desc: '一根普通的腰带', level: 1, rarity: 'common' },
                boots: { name: '旧皮靴', type: '靴子', icon: '👢', iconImage: 'assets/icons/boot_icon.png', equipSlot: 'boots', stats: [{ name: '移动速度', value: '+5%', pos: true }, { name: '闪避', value: '+2%', pos: true }], desc: '磨破了的旧靴子', level: 1, rarity: 'common' }
            },
            TEST_BACKPACK_ITEMS: [
                { slot: 0, name: '治疗药水', type: '消耗品', icon: '🧪', category: 'consumable', stats: [{ name: '恢复生命', value: '+30' }], desc: '一瓶红色的药水，味道有点甜', stack: 5 },
                { slot: 1, name: '魔力药水', type: '消耗品', icon: '💧', category: 'consumable', stats: [{ name: '恢复魔法', value: '+25' }], desc: '一瓶蓝色的药水，冒着冷气', stack: 3 }
            ],
            init(player) {
                this.player = player;
                // 初始化背包数组
                if (!this.backpackItems || this.backpackItems.length === 0) {
                    this.backpackItems = JSON.parse(JSON.stringify(this.TEST_BACKPACK_ITEMS));
                }
                // 深拷贝 TEST_EQUIPMENTS，避免多个玩家共享引用
                if (player.equipments) {
                    const copy = JSON.parse(JSON.stringify(this.TEST_EQUIPMENTS));
                    Object.assign(player.equipments, copy);
                }
                // 加载 weapon2 槽的副武器状态（初始装备弓）
                const w2 = player.equipments && player.equipments.weapon2;
                if (w2 && w2.bowFrames) {
                    const frames = [];
                    for (let i = 0; i < w2.bowFrames.length; i++) {
                        const img = new Image(); img.src = w2.bowFrames[i]; frames.push(img);
                    }
                    player.equippedBowFrames = frames;
                    player.equippedRangedType = 'bow';
                } else if (w2 && (w2.rangedType === 'pistol' || w2.weaponType === 'pistol')) {
                    player.equippedRangedType = 'pistol';
                }
                // ===== FIX 1: 先创建背包格子，再更新显示 =====
                const grid = document.getElementById('inventoryGrid');
                if (grid && grid.children.length === 0) {
                    for (let i = 0; i < 36; i++) {
                        const cell = document.createElement('div');
                        cell.className = 'inv-cell';
                        cell.dataset.slot = i;
                        grid.appendChild(cell);
                    }
                }
                this.updateEquipSlots();
                this.updateInventorySlots();
                this.bindEquipTooltip();
                this.bindInventoryTooltip();
                this.setupDragAndDrop();
            },
            // === 触发装备动画 ===
            triggerEquipFlash(slotKey) {
                if (!slotKey) return;
                const slot = document.querySelector(`.equip-grid .diablo-slot[data-slot="${slotKey}"]`);
                if (!slot) return;
                slot.classList.remove('equip-flash', 'equip-pop');
                void slot.offsetWidth; // 强制重绘，重置动画
                slot.classList.add('equip-flash');
                setTimeout(() => slot.classList.remove('equip-flash'), 650);
            },
            // === 触发背包格子动画 ===
            triggerBackpackFlash(slotIdx) {
                const cell = document.querySelector(`.gear-inventory-col .inv-cell[data-slot="${slotIdx}"]`);
                if (!cell) return;
                cell.classList.remove('equip-pop');
                void cell.offsetWidth;
                cell.classList.add('equip-pop');
                setTimeout(() => cell.classList.remove('equip-pop'), 550);
            },
            /** 设置拖放事件 */
            setupDragAndDrop() {
                this._dragSrc = null;
                // === 装备栏事件委托（所有槽位统一处理，包括空槽位） ===
                const equipGrid = document.querySelector('.equip-grid');
                if (equipGrid) {
                    equipGrid.ondragover = function(e) { e.preventDefault(); };
                    equipGrid.ondragenter = function(e) {
                        const slot = e.target.closest('.diablo-slot');
                        if (slot) slot.classList.add('drag-over');
                    };
                    equipGrid.ondragleave = function(e) {
                        const slot = e.target.closest('.diablo-slot');
                        if (slot && !slot.contains(e.relatedTarget)) slot.classList.remove('drag-over');
                    };
                    const self = this;
                    equipGrid.ondrop = function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        const slot = e.target.closest('.diablo-slot');
                        document.querySelectorAll('.equip-grid .diablo-slot').forEach(s => s.classList.remove('drag-over'));
                        self._dropHandled = true;
                        if (!slot) return;
                        const src = self._dragSrc;
                        if (!src || src.slot === slot.dataset.slot) return;
                        self.handleDrop(src, 'equip', slot.dataset.slot);
                        self._dragSrc = null;
                    };
                }
                // 一次性绑定所有装备栏和背包格子的拖放事件
                document.querySelectorAll('.diablo-slot, .inv-cell').forEach(cell => {
                    this.bindDragToCell(cell);
                });
                // 绑定画布丢弃事件：拖到游戏画面上 = 扔到地上
                this.bindCanvasDiscard();
            },
            /** 清除玩家手上持有的武器状态（与 loadWeaponAssets 逆操作对应）
             *  卸下 weapon（主武器）或 weapon2（副武器）槽后同步清除手上状态
             */
            _clearWeaponState(slotKey) {
                const player = this.player;
                if (!player) return;
                // 新设计：weaponMode 只是当前使用的栏位，不区分近战/远程
                // 卸下装备时，如果当前正在使用这个栏位，尝试切换到另一个栏位
                if (player.weaponMode === slotKey) {
                    const otherSlot = slotKey === 'weapon' ? 'weapon2' : 'weapon';
                    const otherItem = player.equipments[otherSlot];
                    if (otherItem && otherItem.name) {
                        player.weaponMode = otherSlot;
                    }
                    // 如果另一个栏位也没装备，weaponMode 保持原值（空手状态）
                }
                // 清空旧的状态字段（保留向后兼容）
                if (slotKey === 'weapon') {
                    player.hasMeleeWeapon = false;
                } else if (slotKey === 'weapon2') {
                    player.equippedRangedType = null;
                    player.equippedBowFrames = null;
                }
                player.weaponAnim.state = 'idle';
                player.weaponAnim.timer = 0;
            },
            /** 执行丢弃物品到地上的核心逻辑 */
            _doDiscard() {
                const src = this._dragSrc;
                if (!src || !Game.player) return false;
                let item = null;
                if (src.type === 'inventory') {
                    const idx = parseInt(src.slot);
                    item = this.backpackItems.find(i => i.slot === idx);
                    if (item) this.backpackItems = this.backpackItems.filter(i => i.slot !== idx);
                } else if (src.type === 'equip') {
                    item = Game.player.equipments[src.slot];
                    if (item) {
                        Game.player.equipments[src.slot] = null;
                        // 同步清除手上武器状态
                        this._clearWeaponState(src.slot);
                    }
                }
                if (item) {
                    const dropDist = 60 + Math.random() * 40;
                    const dropAngle = Game.player.rotation + (Math.random() - 0.5) * 0.5;
                    const dropX = Game.player.x + Math.cos(dropAngle) * dropDist;
                    const dropY = Game.player.y + Math.sin(dropAngle) * dropDist;
                    Game.dropItem(dropX, dropY, item);
                    EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 30, '已丢弃: ' + item.name));
                    this.updateEquipSlots();
                    this.updateInventorySlots();
                    this._dragSrc = null;
                    return true;
                }
                return false;
            },
            /** 检查鼠标位置是否在红线区域（游戏画面内，不含右侧面板） */
            _isInGameArea(clientX) {
                const panel = document.getElementById('systemPanel');
                // 面板未打开时，整个屏幕都是游戏区域
                if (!panel || !panel.classList.contains('active')) return true;
                // 面板打开时，获取面板左边界（屏幕宽度的 55% 处，因为面板宽 45vw 从右边推出）
                const panelLeft = window.innerWidth * 0.55;
                return clientX < panelLeft;
            },
            /** 绑定画布丢弃：拖放到游戏画面区域 = 扔出物品
             * 采用 drop-标记法：dragstart 时标记 _dropHandled=false
             * 任何成功的 drop（到面板格子）标记 _dropHandled=true
             * dragend 时如果 _dropHandled 仍为 false，说明 drop 到游戏区域，执行丢弃
             */
            bindCanvasDiscard() {
                const self = this;
                // === 丢弃区域：drop 到这些元素上 = 执行丢弃 ===
                const canvas = document.getElementById('gameCanvas');
                if (canvas) {
                    canvas.ondragover = function(e) { e.preventDefault(); };
                    canvas.ondrop = function(e) {
                        e.preventDefault();
                        self._dropHandled = true;
                        self._doDiscard();
                    };
                }
                const overlay = document.getElementById('panelOverlay');
                if (overlay) {
                    overlay.ondragover = function(e) { e.preventDefault(); };
                    overlay.ondrop = function(e) {
                        e.preventDefault();
                        self._dropHandled = true;
                        self._doDiscard();
                    };
                }
                // === 非丢弃区域：drop 到面板和 UI 上 = 标记已处理，不丢弃 ===
                const panel = document.getElementById('systemPanel');
                if (panel) {
                    panel.ondragover = function(e) { e.preventDefault(); };
                    panel.ondrop = function(e) {
                        e.preventDefault();
                        self._dropHandled = true; // 标记已处理，不丢弃
                    };
                }
                const uiLayer = document.getElementById('uiLayer');
                if (uiLayer) {
                    uiLayer.ondragover = function(e) { e.preventDefault(); };
                    uiLayer.ondrop = function(e) {
                        e.preventDefault();
                        self._dropHandled = true; // 标记已处理，不丢弃
                    };
                }
                // === 面板内所有子容器也标记为非丢弃区域 ===
                document.querySelectorAll('.equip-panel, .inventory-panel, .tabs, .panel-header, .panel-footer, .diablo-paperdoll, .equip-slot-group, .inv-grid').forEach(el => {
                    el.ondragover = function(e) { e.preventDefault(); };
                    el.ondrop = function(e) {
                        e.preventDefault();
                        self._dropHandled = true; // 标记已处理，不丢弃
                    };
                });
                // document 级别 dragover（确保 drop 事件能触发）
                document.addEventListener('dragover', function _discardAllowDrop(e) {
                    if (self._dragSrc) e.preventDefault();
                });
            },
            /** 绑定单个格子的拖放事件 */
            bindDragToCell(cell) {
                const self = this;
                cell.ondragstart = function(e) {
                    self._dragSrc = {
                        type: cell.classList.contains('inv-cell') ? 'inventory' : 'equip',
                        slot: cell.dataset.slot
                    };
                    self._dropHandled = false; // drop 标记：false = 尚未处理
                    e.dataTransfer.setData('text/plain', cell.dataset.slot);
                    e.dataTransfer.effectAllowed = 'move';
                    cell.classList.add('dragging');
                };
                cell.ondragend = function(e) {
                    cell.classList.remove('dragging');
                    document.querySelectorAll('.inv-cell, .diablo-slot').forEach(s => s.classList.remove('drag-over'));
                    // 丢弃条件：drop 没被任何已知区域处理（所有面板/UI区域都已绑定ondrop标记_dropHandled）
                    // 如果 _dropHandled 仍为 false，说明拖到了浏览器外部或未知区域，执行丢弃
                    if (!self._dropHandled && self._dragSrc && self._isInGameArea(e.clientX)) {
                        self._doDiscard();
                    }
                    self._dropHandled = false;
                    self._dragSrc = null;
                };
                cell.ondragover = function(e) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                };
                cell.ondragenter = function(e) {
                    cell.classList.add('drag-over');
                };
                cell.ondragleave = function(e) {
                    cell.classList.remove('drag-over');
                };
                cell.ondrop = function(e) {
                    e.preventDefault();
                    // 装备栏槽位的 drop 由 equipGrid 事件委托处理，这里直接返回不阻止冒泡
                    if (!cell.classList.contains('inv-cell')) {
                        cell.classList.remove('drag-over');
                        return;
                    }
                    // 背包格子的 drop 自行处理
                    e.stopPropagation();
                    cell.classList.remove('drag-over');
                    self._dropHandled = true;
                    const src = self._dragSrc;
                    if (!src || src.slot === cell.dataset.slot) return;
                    self.handleDrop(src, 'inventory', cell.dataset.slot);
                    self._dragSrc = null;
                };
            },
/** 处理拖放放下逻辑 */
            handleDrop(src, targetType, targetSlot) {
                if (!src || !targetType) return;
                // 背包 -> 背包：交换位置
                if (src.type === 'inventory' && targetType === 'inventory') {
                    const sIdx = parseInt(src.slot), tIdx = parseInt(targetSlot);
                    if (isNaN(sIdx) || isNaN(tIdx) || sIdx === tIdx) return;
                    const sItem = this.backpackItems.find(i => i.slot === sIdx);
                    const tItem = this.backpackItems.find(i => i.slot === tIdx);
                    if (sItem) sItem.slot = tIdx;
                    if (tItem) tItem.slot = sIdx;
                    // SoundManager.play('equip');
                    this.updateInventorySlots(); return;
                }
                // 背包 -> 装备栏：装备物品（通用武器槽设计）
                if (src.type === 'inventory' && targetType === 'equip') {
                    const sIdx = parseInt(src.slot);
                    const item = this.backpackItems.find(i => i.slot === sIdx);
                    if (!item) return;
                    // 非武器槽位需要 equipSlot 匹配；武器槽位（weapon/weapon2）任何武器可装备
                    const isWeaponSlot = (targetSlot === 'weapon' || targetSlot === 'weapon2');
                    if (!isWeaponSlot && item.equipSlot !== targetSlot) return;
                    const cur = this.player.equipments[targetSlot];
                    // 先移除背包中原物品
                    this.backpackItems = this.backpackItems.filter(i => i.slot !== sIdx);
                    // 如果槽位有旧装备，卸下放到背包
                    if (cur && cur.name) {
                        const oldClone = JSON.parse(JSON.stringify(cur));
                        oldClone.slot = sIdx;
                        this.backpackItems.push(oldClone);
                    }
                    // 装备新物品
                    this.player.equipments[targetSlot] = JSON.parse(JSON.stringify(item));
                    // 更新武器状态
                    if (targetSlot === 'weapon' || targetSlot === 'weapon2') {
                        if (item.bowFrames || (item.weaponAsset && item.weaponAsset.framePrefix)) {
                            const frames = [];
                            const framePaths = item.bowFrames || [];
                            for (let i = 0; i < framePaths.length; i++) { const im = new Image(); im.src = framePaths[i]; frames.push(im); }
                            this.player.equippedBowFrames = frames;
                            this.player.equippedRangedType = 'bow';
                        } else if (item.weaponType === 'pistol' || item.rangedType === 'pistol') {
                            this.player.equippedRangedType = 'pistol';
                        } else if (item.category === 'weapon_melee' || item.weaponType === 'sword') {
                            this.player.hasMeleeWeapon = true;
                        }
                    }
                    this.updateEquipSlots(); this.updateInventorySlots();
                    // 触发装备动画
                    this.triggerEquipFlash(targetSlot);
                    if (cur && cur.name) {
                        this.triggerBackpackFlash(sIdx);
                    }
                    return;
                }
                // 装备栏 -> 背包：卸下装备到指定格子
                if (src.type === 'equip' && targetType === 'inventory') {
                    const eKey = src.slot, tIdx = parseInt(targetSlot);
                    const existing = this.player.equipments[eKey];
                    if (!existing) return;
                    const bpItem = this.backpackItems.find(i => i.slot === tIdx);
                    if (bpItem && bpItem.equipSlot === eKey) {
                        // 交换：背包物品装备到栏位，旧装备放到被交换物品的格子
                        const oldClone = JSON.parse(JSON.stringify(existing));
                        oldClone.slot = tIdx;
                        this.player.equipments[eKey] = bpItem;
                        bpItem.slot = -1; // 临时标记，避免被filter掉
                        this.backpackItems = this.backpackItems.filter(i => i.slot !== tIdx);
                        this.backpackItems.push(oldClone);
                        if (eKey === 'weapon2' && bpItem.weaponAsset) this.player.loadWeaponAssets(bpItem);
                    } else {
                        // 目标格子有物品（类型不匹配）或为空：统一处理
                        this.backpackItems = this.backpackItems.filter(i => i.slot !== tIdx);
                        const clone = JSON.parse(JSON.stringify(existing));
                        clone.slot = tIdx;
                        clone.backpackSlot = tIdx;
                        this.backpackItems.push(clone);
                        this.player.equipments[eKey] = null;
                        this._clearWeaponState(eKey);
                    }
                    this.updateEquipSlots(); this.updateInventorySlots();
                    // 触发动画
                    this.triggerEquipFlash(eKey);
                    this.triggerBackpackFlash(tIdx);
                    return;
                }
                // 装备栏 -> 装备栏：交换
                if (src.type === 'equip' && targetType === 'equip') {
                    const sKey = src.slot, tKey = targetSlot;
                    if (sKey === tKey) return;
                    const sItem = this.player.equipments[sKey];
                    const tItem = this.player.equipments[tKey];
                    if (!sItem && !tItem) return;
                    this.player.equipments[sKey] = tItem || null;
                    this.player.equipments[tKey] = sItem || null;
                    // 从 weapon2（副武器）槽拖出武器时清除手上状态
                    if (sKey === 'weapon2') this._clearWeaponState(sKey);
                    // 拖入 weapon2（副武器）槽时加载新武器
                    if (tKey === 'weapon2' && sItem && sItem.weaponAsset) this.player.loadWeaponAssets(sItem);
                    EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 20, `已交换: ${sItem.name} ↔ ${tItem ? tItem.name : '空'}`, '#d4c5a9'));
                    this.updateEquipSlots();
                    // 触发交换动画
                    this.triggerEquipFlash(sKey);
                    this.triggerEquipFlash(tKey);
                    return;
                }
            },
            updateEquipSlots() {
                const eq = this.player.equipments;
                document.querySelectorAll('.diablo-slot').forEach(slot => {
                    const key = slot.dataset.slot;
                    const item = eq[key];
                    const iconEl = slot.querySelector('.slot-icon');
                    const nameEl = slot.querySelector('.slot-name');
                    slot.draggable = !!item;
                    if (item) {
                        slot.classList.add('equipped');
                        const imgSrc = item.slotImage || item.iconImage;
                        nameEl.textContent = item.name;
                        if (imgSrc) {
                            iconEl.innerHTML = `<img src="${imgSrc}" alt="" onerror="this.style.display='none';this.parentElement.textContent='${item.icon || '❓'}';">`;
                        } else {
                            iconEl.textContent = item.icon || '⚔';
                        }
                    } else {
                        slot.classList.remove('equipped');
                        iconEl.textContent = '⚔';
                        nameEl.textContent = '';
                    }
                    // 为装备栏槽位绑定 dragstart/dragend（drop 由 equipGrid 事件委托处理）
                    const self = this;
                    slot.ondragstart = function(e) {
                        if (!item) return;
                        self._dragSrc = { type: 'equip', slot: key };
                        self._dropHandled = false;
                        e.dataTransfer.setData('text/plain', key);
                        e.dataTransfer.effectAllowed = 'move';
                        slot.classList.add('dragging');
                    };
                    slot.ondragend = function(e) {
                        slot.classList.remove('dragging');
                        document.querySelectorAll('.diablo-slot').forEach(s => s.classList.remove('drag-over'));
                        if (!self._dropHandled && self._dragSrc && self._isInGameArea(e.clientX)) {
                            self._doDiscard();
                        }
                        self._dropHandled = false;
                        self._dragSrc = null;
                    };
                });
            },
            unequip(slotKey) {
                const equipped = this.player.equipments[slotKey];
                if (!equipped || !equipped.name) return false;
                // 如果背包已满，不能卸下
                if (this.backpackItems.length >= 36) {
                    EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 20, '背包已满！'));
                    return false;
                }
                // 使用原装备中的 backpackSlot 记忆字段，若无则分配第一个空位
                let targetSlot = equipped.backpackSlot;
                if (targetSlot === undefined || targetSlot < 0 || this.backpackItems.some(i => i.slot === targetSlot)) {
                    const used = new Set(this.backpackItems.map(i => i.slot));
                    targetSlot = 0;
                    while (used.has(targetSlot) && targetSlot < 36) targetSlot++;
                    if (targetSlot >= 36) return false;
                }
                const clone = JSON.parse(JSON.stringify(equipped));
                clone.slot = targetSlot;
                if (!clone.weaponCategory) {
                    if (slotKey === 'weapon' || slotKey === 'weapon2') clone.weaponCategory = 'mainhand';
                    else if (slotKey === 'offhand' || slotKey === 'ring2') clone.weaponCategory = 'offhand';
                }
                this.backpackItems.push(clone);
                this.player.equipments[slotKey] = null;
                this._clearWeaponState(slotKey);
                this.updateEquipSlots();
                this.updateInventorySlots();
                return true;
            },
            bindEquipTooltip() {
                const tooltip = document.getElementById('equipTooltip');
                const ttName = document.getElementById('ttName');
                const ttType = document.getElementById('ttType');
                const ttStats = document.getElementById('ttStats');
                const ttDesc = document.getElementById('ttDesc');
                const self = this;
                let _ttMoveHandler = null;
                function positionTooltip(e) {
                    const tw = 340;
                    let left = e.clientX - tw - 10;
                    let top = e.clientY + 10;
                    if (left < 10) left = e.clientX + 10;
                    if (top + 200 > window.innerHeight) top = e.clientY - 200;
                    if (top < 10) top = 10;
                    tooltip.style.left = left + 'px';
                    tooltip.style.top = top + 'px';
                }
                document.querySelectorAll('.diablo-slot').forEach(slot => {
                    // 使用直接赋值覆盖旧监听器
                    slot.onmouseenter = function(e) {
                        const key = slot.dataset.slot;
                        const item = self.player.equipments[key];
                        if (!item) return;
                        ttName.textContent = item.name;
                        ttType.textContent = item.type;
                        ttStats.innerHTML = item.stats.map(s => `<div class="tt-stat"><span class="tt-stat-name">${s.name}</span><span class="tt-stat-val ${s.pos ? 'pos' : ''}">${s.value}</span></div>`).join('');
                        ttDesc.textContent = item.desc;
                        tooltip.classList.add('visible');
                        positionTooltip(e);
                        slot._ttMoveHandler = positionTooltip;
                        document.addEventListener('mousemove', slot._ttMoveHandler);
                    };
                    slot.onmouseleave = function() {
                        tooltip.classList.remove('visible');
                        if (slot._ttMoveHandler) {
                            document.removeEventListener('mousemove', slot._ttMoveHandler);
                            slot._ttMoveHandler = null;
                        }
                    };
                    slot.oncontextmenu = function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        const key = slot.dataset.slot;
                        if (self.unequip(key)) {
                            EffectManager.add(new FloatingTextEffect(self.player.x, self.player.y - 20, '已卸下装备'));
                        }
                    };
                });
            },
            bindInventoryTooltip() {
                const tooltip = document.getElementById('equipTooltip');
                const ttName = document.getElementById('ttName');
                const ttType = document.getElementById('ttType');
                const ttStats = document.getElementById('ttStats');
                const ttDesc = document.getElementById('ttDesc');
                const self = this;
                function positionTooltip(e) {
                    const tw = 340;
                    let left = e.clientX - tw - 10;
                    let top = e.clientY + 10;
                    if (left < 10) left = e.clientX + 10;
                    if (top + 200 > window.innerHeight) top = e.clientY - 200;
                    if (top < 10) top = 10;
                    tooltip.style.left = left + 'px';
                    tooltip.style.top = top + 'px';
                }
                document.querySelectorAll('.inv-cell').forEach(cell => {
                    // 使用直接赋值覆盖旧监听器，避免重复绑定导致卡死
                    cell.onmouseenter = function(e) {
                        const idx = parseInt(cell.dataset.slot);
                        const item = self.backpackItems.find(i => i.slot === idx);
                        if (!item) return;
                        ttName.textContent = item.name;
                        ttType.textContent = item.type;
                        ttStats.innerHTML = item.stats.map(s => `<div class="tt-stat"><span class="tt-stat-name">${s.name}</span><span class="tt-stat-val ${s.pos ? 'pos' : ''}">${s.value}</span></div>`).join('');
                        ttDesc.textContent = item.desc + (item.stack > 1 ? ` (数量: ${item.stack})` : '');
                        tooltip.classList.add('visible');
                        positionTooltip(e);
                        cell._ttMoveHandler = positionTooltip;
                        document.addEventListener('mousemove', cell._ttMoveHandler);
                    };
                    cell.onmouseleave = function() {
                        tooltip.classList.remove('visible');
                        if (cell._ttMoveHandler) {
                            document.removeEventListener('mousemove', cell._ttMoveHandler);
                            cell._ttMoveHandler = null;
                        }
                    };
                    // contextmenu 在 updateInventorySlots() 中绑定，这里不处理
                });
            },
            equipFromBackpack(backpackIdx) {
                const item = this.backpackItems.find(i => i.slot === backpackIdx);
                if (!item) return;
                const player = this.player;

                // ===== 消耗品：直接使用 =====
                if (item.category === 'consumable') {
                    if (item.name === '治疗药水') {
                        player.hp = Math.min(player.hp + 30, player.maxHp);
                        EffectManager.add(new FloatingTextEffect(player.x, player.y - 20, '+30 HP', '#7a9a6a'));
                    } else if (item.name === '魔力药水') {
                        player.mp = Math.min(player.mp + 25, player.maxMp);
                        EffectManager.add(new FloatingTextEffect(player.x, player.y - 20, '+25 MP', '#5a8aaa'));
                    }
                    // 减少堆叠数量
                    if (item.stack > 1) { item.stack--; }
                    else { this.backpackItems = this.backpackItems.filter(i => i.slot !== backpackIdx); }
                    this.updateInventorySlots();
                    return;
                }

                // 目标槽位
                let targetSlot = item.equipSlot;
                // 判断是否是武器
                const isWeapon = item.category === 'weapon_melee' || item.category === 'weapon_ranged'
                    || item.weaponType || item.rangedType || item.weaponAsset || item.bowFrames;
                // 武器类：统一按空槽位填充逻辑，忽略 equipSlot
                // 栏1空 → 栏1，栏1有栏2空 → 栏2，两个都满 → 替换当前使用的武器栏
                if (isWeapon) {
                    const w1Empty = !player.equipments.weapon || !player.equipments.weapon.name;
                    const w2Empty = !player.equipments.weapon2 || !player.equipments.weapon2.name;
                    if (w1Empty) {
                        targetSlot = 'weapon';
                    } else if (w2Empty) {
                        targetSlot = 'weapon2';
                    } else {
                        // 两个都满，替换当前正在使用的武器栏
                        targetSlot = player.weaponMode;
                    }
                }
                if (!targetSlot || !player.equipments.hasOwnProperty(targetSlot)) return;

                const replacedItem = player.equipments[targetSlot];
                // 先从背包移除原物品
                this.backpackItems = this.backpackItems.filter(i => i.slot !== backpackIdx);
                // 如果目标槽位有旧装备，卸下并记录其来源格子
                if (replacedItem && replacedItem.name) {
                    const oldClone = JSON.parse(JSON.stringify(replacedItem));
                    oldClone.slot = backpackIdx;
                    oldClone.backpackSlot = backpackIdx; // 记忆，下次卸下时优先回到此格
                    this.backpackItems.push(oldClone);
                }
                // 装备新物品
                const equippedClone = JSON.parse(JSON.stringify(item));
                equippedClone.backpackSlot = backpackIdx; // 记录来源格子
                player.equipments[targetSlot] = equippedClone;

                // 根据槽位处理武器状态（加载武器资源，不修改 weaponMode）
                if (targetSlot === 'weapon' || targetSlot === 'weapon2') {
                    if (item.bowFrames || (item.weaponAsset && item.weaponAsset.framePrefix)) {
                        const frames = [];
                        const framePaths = item.bowFrames || [];
                        for (let i = 0; i < framePaths.length; i++) {
                            const img = new Image(); img.src = framePaths[i]; frames.push(img);
                        }
                        player.equippedBowFrames = frames;
                        player.equippedRangedType = 'bow';
                    } else if (item.weaponType === 'pistol' || item.rangedType === 'pistol') {
                        player.equippedRangedType = 'pistol';
                        if (item.weaponAsset && item.weaponAsset.muzzleImage) {
                            player.muzzleFlashImg = new Image(); player.muzzleFlashImg.src = item.weaponAsset.muzzleImage;
                        }
                    } else if (item.category === 'weapon_melee' || item.weaponType === 'sword') {
                        player.hasMeleeWeapon = true;
                    }
                    // 安全：装备到当前武器栏时，设置切换冷却，防止装备后立即攻击
                    if (targetSlot === player.weaponMode && (item.weaponType === 'pistol' || item.rangedType === 'pistol')) {
                        player.weaponSwitchCooldown = 300;
                    }
                }
                this.updateEquipSlots();
                this.updateInventorySlots();
                // 触发装备成功动画
                this.triggerEquipFlash(targetSlot);
                // 如果原装备回背包，触发背包格子动画
                if (replacedItem && replacedItem.name) {
                    this.triggerBackpackFlash(backpackIdx);
                }
            },
            addToBackpack(item) {
                const existingSlot = this.backpackItems.map(i => i.slot);
                let slot = 0;
                while (existingSlot.includes(slot)) slot++;
                if (slot >= 36) return; // 背包已满
                item.slot = slot;
                this.backpackItems.push(item);
                this.updateInventorySlots();
            },
            STEEL_BOW_ITEM: {
                name: '精钢长弓', type: '远程武器', icon: '🏹', iconImage: 'assets/icons/bow_icon.png',
                dropImage: 'assets/items/steel_bow_dropped.png',
                bowFrames: ['assets/weapons/steel_bow_frame_01.png','assets/weapons/steel_bow_frame_02.png','assets/weapons/steel_bow_frame_03.png','assets/weapons/steel_bow_frame_04.png','assets/weapons/steel_bow_frame_05.png','assets/weapons/steel_bow_frame_06.png','assets/weapons/steel_bow_frame_07.png','assets/weapons/steel_bow_frame_08.png'],
                stats: [{ name: '物理攻击', value: '15-25' }, { name: '攻速', value: '1.0' }, { name: '射程', value: '800' }],
                desc: '由精钢打造的长弓，射程远，威力大',
                equipSlot: 'weapon2'
            },
            G18_PISTOL_ITEM: {
                name: 'G18 手枪', type: '远程武器', icon: '🔫', iconImage: 'assets/icons/pistol_icon.png',
                dropImage: 'assets/weapons/g18_topdown_v2.png',
                category: 'weapon_ranged',
                weaponType: 'pistol',
                weaponAsset: { image: 'assets/weapons/g18_topdown_v2.png', muzzleImage: 'assets/effects/muzzle_flash_01.png' },
                rangedType: 'pistol',
                stats: [{ name: '物理攻击', value: '6-12' }, { name: '攻速', value: '3.0' }, { name: '射程', value: '500' }],
                desc: 'G18 全自动手枪，1100发/分钟，黄色曳光弹',
                equipSlot: 'weapon2'
            },
            backpackItems: [],
            updateInventorySlots() {
                document.querySelectorAll('.inv-cell').forEach((cell, idx) => {
                    cell.classList.remove('occupied');
                    cell.innerHTML = '';
                    cell.dataset.itemName = '';
                    cell.dataset.slot = idx;
                    cell.draggable = false;
                    const item = this.backpackItems.find(i => i.slot === idx);
                    if (item) {
                        cell.classList.add('occupied');
                        cell.draggable = true;
                        cell.dataset.dragType = 'inventory';
                        cell.dataset.dragId = item.itemId || idx;
                        const imgSrc = item.slotImage || item.iconImage;
                        if (imgSrc) {
                            cell.innerHTML = `<img src="${imgSrc}" style="width:32px;height:32px;object-fit:cover;pointer-events:none;border-radius:4px;"><span class="inv-name">${item.name}</span>${item.stack > 1 ? `<span class="inv-stack">${item.stack}</span>` : ''}`;
                        } else {
                            cell.innerHTML = `${item.icon || '❓'}<span class="inv-name">${item.name}</span>${item.stack > 1 ? `<span class="inv-stack">${item.stack}</span>` : ''}`;
                        }
                        cell.dataset.itemName = item.name;
                    }
                    // 绑定拖放事件（所有格子都可作为放置目标）
                    this.bindDragToCell(cell);
                    // 右键事件：使用直接赋值覆盖旧值，避免 addEventListener 重复绑定导致卡死
                    const self = this;
                    cell.oncontextmenu = function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        const idx = parseInt(cell.dataset.slot);
                        const item = self.backpackItems.find(i => i.slot === idx);
                        if (item) {
                            self.equipFromBackpack(idx);
                        }
                    };
                });
                const invCountEl = document.getElementById('invCount'); if (invCountEl) invCountEl.textContent = `${this.backpackItems.length}/36`;
                // 重新绑定tooltip（使用 onmouseenter/onmouseleave 直接赋值覆盖旧值）
                this.bindInventoryTooltip();
            }
        };

        /* ================================================================
         *  CodexManager — 装备图鉴系统（自动从 ItemDatabase 同步）
         *  新增装备只需：
         *    1) ItemDatabase.items[id] = { ...category, rarity, level ... }
         *    2) 武器需在 attackAnimation 中补充攻击/动画参数
         *    3) 调用 CodexManager.refresh() 或刷新页面
         * ================================================================ */
        const CodexManager = {
            categories: [
                { key: 'all', label: '全部' },
                { key: 'weapon_melee', label: '近战武器' },
                { key: 'weapon_ranged', label: '远程武器' },
                { key: 'armor', label: '防具' },
                { key: 'accessory', label: '饰品' },
                { key: 'consumable', label: '消耗品' }
            ],
            currentCategory: 'all',
            detailItem: null,

            /* ---- 武器攻击参数与动画参数（图鉴特有覆盖数据）----
             * 新增武器时，仅需在此对象中添加对应 id 的攻击/动画数据。
             * 基础信息（名称、图标、属性等）自动从 ItemDatabase 读取。
             */
            attackAnimation: {
                rusty_sword: {
                    attack: { range: 130, knockback: 8, attackInterval: 1000, hitType: '突刺（扇形判定）', damageType: '物理' },
                    animation: {
                        type: 'thrust（突刺）', totalMs: '1100ms (200+500+400)',
                        windupMs: 200, swingMs: 500, recoveryMs: 400,
                        idleAngle: '0°', windupAngle: '+30°', swingAngle: '-30°',
                        holdOffset: '(-20, 11)', weaponSize: 84, timingMul: '1.0x (标准)',
                        description: '三段式突刺动画：预备→前刺→回位。 windup 阶段剑身向后上方扬起，swing 阶段快速向前突刺，recover 阶段回到待机姿态。'
                    }
                },
                training_bow: {
                    attack: { range: 600, knockback: 0, attackInterval: 600, hitType: '箭矢（直线弹道）', damageType: '物理' },
                    animation: {
                        type: 'frameSequence（帧序列）', totalMs: '800ms (200+250+350)',
                        windupMs: 200, swingMs: 250, recoveryMs: 350,
                        idleAngle: '0°', windupAngle: '+30°', swingAngle: '-30°',
                        holdOffset: '(-20, 11)', weaponSize: 84, timingMul: '1.0x (标准)',
                        frameCount: 8, framePrefix: 'bow_frame_',
                        description: '8帧序列动画：搭箭→拉弓→满弦→发射。基础训练弓的完整拉弓动作。'
                    }
                },
                steel_bow: {
                    attack: { range: 800, knockback: 0, attackInterval: 600, hitType: '箭矢（直线弹道）', damageType: '物理' },
                    animation: {
                        type: 'frameSequence（帧序列）', totalMs: '800ms (200+250+350)',
                        windupMs: 200, swingMs: 250, recoveryMs: 350,
                        idleAngle: '0°', windupAngle: '+30°', swingAngle: '-30°',
                        holdOffset: '(-20, 11)', weaponSize: 84, timingMul: '1.0x (标准)',
                        frameCount: 8, framePrefix: 'steel_bow_frame_',
                        description: '8帧序列动画：搭箭→拉弓→满弦→发射。精钢长弓的拉弦动作比普通弓更有力。'
                    }
                },
                g18_pistol: {
                    attack: { range: 500, knockback: 8, attackInterval: 55, hitType: '黄色曳光弹（直线弹道）', damageType: '物理' },
                    animation: {
                        type: 'recoil（后坐力抖动）', totalMs: '48ms (约)',
                        windupMs: '\u224812', swingMs: '\u224818', recoveryMs: '\u224818',
                        holdOffset: '(0, 4)', weaponSize: 84, timingMul: '0.06x (极速)', recoilAmount: '0.15rad',
                        description: 'G18 以1100RPM的射速连续射击，单次开火动画仅约48ms。采用后坐力抖动模式：每次开火枪身快速上扬后回位，无明显 windup/swing/recover 阶段。timingMul=0.06 确保动画总时长小于55ms的射击间隔。'
                    }
                }
            },

            /* ---- 运行时数据库（从 ItemDatabase + attackAnimation 合并生成）---- */
            database: {},

            /** 从 ItemDatabase 同步基础数据 + 合并 attackAnimation 覆盖数据 */
            syncFromItemDatabase() {
                const items = ItemDatabase.items;
                for (const [id, item] of Object.entries(items)) {
                    // 只同步有 category 的物品（确保有分类才进图鉴）
                    if (!item.category) continue;
                    const entry = { ...item };
                    // 统一 stats 字段名格式（ItemDatabase 用 name，图鉴用 label）
                    if (entry.stats) {
                        entry.stats = entry.stats.map(s => ({
                            label: s.name || s.label,
                            value: s.value,
                            pos: s.pos
                        }));
                    }
                    // 合并攻击参数 + 动画参数
                    const extra = this.attackAnimation[id];
                    if (extra) {
                        if (extra.attack) entry.attack = extra.attack;
                        if (extra.animation) entry.animation = extra.animation;
                    }
                    this.database[id] = entry;
                }
            },

            /** 新增装备后调用此方法刷新图鉴 */
            refresh() {
                this.syncFromItemDatabase();
                this.currentCategory = 'all';
                this.renderCategoryTabs();
                this.renderGrid();
            },

            init() {
                this.syncFromItemDatabase();
                this.renderCategoryTabs();
                this.renderGrid();
                const backBtn = document.getElementById('codexBackBtn'); if (backBtn) backBtn.addEventListener('click', () => this.closeDetail());
            },

            getItemsByCategory(cat) {
                const items = Object.values(this.database);
                if (cat === 'all') return items;
                return items.filter(i => i.category === cat);
            },

            renderCategoryTabs() {
                const container = document.getElementById('codexCatTabs');
                if (!container) return;
                container.innerHTML = this.categories.map(c =>
                    `<div class="codex-cat-tab ${c.key === this.currentCategory ? 'active' : ''}" data-cat="${c.key}">${c.label}</div>`
                ).join('');
                container.querySelectorAll('.codex-cat-tab').forEach(tab => {
                    tab.addEventListener('click', () => {
                        this.currentCategory = tab.dataset.cat;
                        this.renderCategoryTabs();
                        this.renderGrid();
                    });
                });
            },

            renderGrid() {
                const grid = document.getElementById('codexGrid');
                if (!grid) return;
                const items = this.getItemsByCategory(this.currentCategory);
                grid.innerHTML = items.map(item => {
                    const iconHtml = item.iconImage
                        ? `<img src="${item.iconImage}" alt="${item.icon}" onerror="this.style.display='none';this.parentElement.textContent='${item.icon}';">`
                        : item.icon;
                    return `<div class="codex-card" data-id="${item.name}" onclick="CodexManager.openDetail('${item.name}')">
                        <div class="cc-icon">${iconHtml}</div>
                        <div class="cc-name">${item.name}</div>
                        <div class="cc-type">${item.type}</div>
                    </div>`;
                }).join('');
            },

            openDetail(itemName) {
                const item = Object.values(this.database).find(i => i.name === itemName);
                if (!item) return;
                this.detailItem = item;
                const layout = document.getElementById('codexLayout');
                const detail = document.getElementById('codexDetail');
                const title = document.getElementById('codexDetailTitle');
                if (layout) layout.style.display = 'none';
                if (detail) detail.style.display = 'flex';
                if (title) title.textContent = item.name;
                this.renderDetail(item);
            },

            closeDetail() {
                this.detailItem = null;
                const detail = document.getElementById('codexDetail');
                const layout = document.getElementById('codexLayout');
                if (detail) detail.style.display = 'none';
                if (layout) layout.style.display = 'flex';
            },

            renderDetail(item) {
                const body = document.getElementById('codexDetailBody');
                if (!body) return;
                const rarityClass = item.rarity || 'common';
                const rarityLabel = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic' }[item.rarity] || item.rarity;

                let html = '';

                // Hero 头部
                const iconHtml = item.iconImage
                    ? `<img src="${item.iconImage}" alt="${item.icon}" onerror="this.style.display='none';this.parentElement.textContent='${item.icon}';">`
                    : item.icon;
                html += `<div class="cd-hero">
                    <div class="cd-hero-icon">${iconHtml}</div>
                    <div class="cd-hero-info">
                        <div class="cd-hero-name">${item.name}</div>
                        <div class="cd-hero-type">${item.type}${item.equipSlot ? ' · ' + this.slotLabel(item.equipSlot) : ''} · Lv.${item.level || 1}</div>
                        <span class="cd-hero-rarity ${rarityClass}">${rarityLabel}</span>
                    </div>
                </div>`;

                // 基本信息
                html += `<div class="cd-section"><h4>📋 基本信息</h4>`;
                html += this.detailRow('名称', item.name);
                html += this.detailRow('类型', item.type);
                html += this.detailRow('装备槽', item.equipSlot ? this.slotLabel(item.equipSlot) : '不可装备');
                html += this.detailRow('稀有度', rarityLabel);
                html += this.detailRow('需求等级', 'Lv.' + (item.level || 1));
                html += this.detailRow('堆叠上限', item.stack || '1');
                html += `</div>`;

                // 面板属性
                if (item.stats && item.stats.length) {
                    html += `<div class="cd-section"><h4>⚔ 面板属性</h4>`;
                    item.stats.forEach(s => {
                        html += this.detailRow(s.label, s.value, s.pos ? 'pos' : '');
                    });
                    html += `</div>`;
                }

                // 攻击参数（武器特有）
                if (item.attack) {
                    html += `<div class="cd-section"><h4>🎯 攻击参数</h4>`;
                    html += this.detailRow('攻击距离', item.attack.range + 'px');
                    html += this.detailRow('攻击间隔', item.attack.attackInterval + 'ms');
                    html += this.detailRow('击退距离', item.attack.knockback + 'px');
                    html += this.detailRow('命中类型', item.attack.hitType);
                    html += this.detailRow('伤害类型', item.attack.damageType);
                    const atkStat = item.stats && item.stats.find(s => s.label === '物理攻击');
                    if (atkStat) html += this.detailRow('物理攻击', atkStat.value);
                    html += `</div>`;
                }

                // 动画参数（武器特有）
                if (item.animation) {
                    html += `<div class="cd-section"><h4>🎬 动画参数</h4>`;
                    html += this.detailRow('动画类型', item.animation.type);
                    html += this.detailRow('总时长', item.animation.totalMs);
                    if (item.animation.windupMs) html += this.detailRow('windup（预备）', item.animation.windupMs + 'ms');
                    if (item.animation.swingMs) html += this.detailRow('swing（攻击）', item.animation.swingMs + 'ms');
                    if (item.animation.recoveryMs) html += this.detailRow('recovery（回位）', item.animation.recoveryMs + 'ms');
                    html += this.detailRow('待机角度', item.animation.idleAngle || '-');
                    html += this.detailRow('预备角度', item.animation.windupAngle || '-');
                    html += this.detailRow('挥击角度', item.animation.swingAngle || '-');
                    html += this.detailRow('持握偏移', item.animation.holdOffset || '-');
                    html += this.detailRow('武器尺寸', (item.animation.weaponSize || '-') + 'px');
                    html += this.detailRow('时间倍率', item.animation.timingMul || '-');
                    if (item.animation.recoilAmount) html += this.detailRow('后坐力幅度', item.animation.recoilAmount);
                    html += `</div>`;

                    html += `<div class="cd-section"><h4>💡 动画说明</h4>`;
                    html += `<div style="color:#8a7d6b;font-size:12px;line-height:1.8;">${item.animation.description}</div>`;
                    html += `</div>`;
                }

                // 描述
                html += `<div class="cd-section"><h4>📝 描述</h4>`;
                html += `<div style="color:#a0907a;font-size:13px;line-height:1.8;font-style:italic;">${item.desc}</div>`;
                html += `</div>`;

                body.innerHTML = html;
            },

            detailRow(label, value, cssClass) {
                return `<div class="cd-row"><span class="cd-label">${label}</span><span class="cd-value ${cssClass}">${value}</span></div>`;
            },

            slotLabel(slot) {
                const map = {
                    weapon: '主手', weapon2: '副手', offhand: '副手',
                    helmet: '头盔', armor: '盔甲', gloves: '手套',
                    boots: '靴子', belt: '腰带', necklace: '项链',
                    ring1: '戒指', ring2: '戒指'
                };
                return map[slot] || slot;
            }
        };

        const SystemUI = {
            isOpen: false, currentTab: null,
            init() {
                // 绑定遮罩层点击事件：点击面板外部区域关闭
                const overlay = document.getElementById('panelOverlay');
                if (overlay) overlay.addEventListener('click', () => this.close());
            },
            toggle(tab) { if (tab === 'inventory') tab = 'equip'; if (this.isOpen && this.currentTab === tab) { this.close(); return; } this.open(tab); },
            open(tab) {
                // SoundManager.play('panel_open');
                // 'inventory' 已整合到 'equip' 页面
                if (tab === 'inventory') tab = 'equip';
                this.isOpen = true; this.currentTab = tab;
                const panel = document.getElementById('systemPanel'), overlay = document.getElementById('panelOverlay');
                if (!panel || !overlay) return;
                const pt = document.getElementById('panelTitle');
                const titles = { status: '📊 角色状态', equip: '⚔ 装备与背包', skill: '✦ 技能系统', codex: '📖 武器图鉴' };
                if (pt) pt.textContent = titles[tab] || '角色系统';
                document.querySelectorAll('.panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
                document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
                const tabPage = document.querySelector(`.tab-page[data-page="${tab}"]`);
                if (tabPage) tabPage.classList.add('active');
                panel.classList.add('active'); overlay.classList.add('active'); this.updateQuickSlots();
            },
            close() {
                // SoundManager.play('panel_close');
                this.isOpen = false; this.currentTab = null;
                try {
                    const panel = document.getElementById('systemPanel'), overlay = document.getElementById('panelOverlay');
                    if (panel) panel.classList.remove('active');
                    if (overlay) overlay.classList.remove('active');
                    this.updateQuickSlots();
                } catch (e) { console.error('SystemUI.close error:', e); }
            },
            switchTab(tab) { this.open(tab); },
            updateQuickSlots() {
                const btnStatus = document.getElementById('btnStatus');
                const btnEquip = document.getElementById('btnEquip');
                const btnSkill = document.getElementById('btnSkill');
                const btnCodex = document.getElementById('btnCodex');
                if (btnStatus) btnStatus.classList.toggle('active', this.currentTab === 'status');
                if (btnEquip) btnEquip.classList.toggle('active', this.currentTab === 'equip');
                if (btnSkill) btnSkill.classList.toggle('active', this.currentTab === 'skill');
                if (btnCodex) btnCodex.classList.toggle('active', this.currentTab === 'codex');
            }
        };

        const UI_DATA_CONFIG = {
            topBar: [
                { id: 'uiName', label: '轮回者', getValue: (p) => p.data.name || '未命名' },
                { id: 'uiLevel', label: '等级', getValue: (p) => p.data.level },
                { id: 'uiClass', label: '职业', getValue: (p) => p.data.class },
                { id: 'uiPos', label: '坐标', getValue: (p) => `${Math.round(p.x)}, ${Math.round(p.y)}` },
                { id: 'uiKills', label: '击杀', getValue: (p) => p.data.kills }
            ],
            topStatus: [
                { barId: 'topBarHp', valId: 'topValHp', label: 'HP', getValue: (d) => `${Math.ceil(d.hp)}/${d.maxHp}`, getPercent: (d) => (d.hp / d.maxHp * 100) + '%', color: 'hp' },
                { barId: 'topBarMp', valId: 'topValMp', label: 'MP', getValue: (d) => `${Math.ceil(d.mp)}/${d.maxMp}`, getPercent: (d) => (d.mp / d.maxMp * 100) + '%', color: 'mp' }
            ],
            statusPage: {
                bars: [
                    { barId: 'barHp', valId: 'valHp', label: '生命值', type: 'hp', getValue: (d) => `${Math.ceil(d.hp)}/${d.maxHp}`, getPercent: (d) => (d.hp / d.maxHp * 100) + '%' },
                    { barId: 'barMp', valId: 'valMp', label: '魔法值', type: 'mp', getValue: (d) => `${Math.ceil(d.mp)}/${d.maxMp}`, getPercent: (d) => (d.mp / d.maxMp * 100) + '%' },
                    { barId: 'barStamina', valId: 'valStamina', label: '体力值', type: 'stamina', getValue: (d) => `${Math.ceil(d.stamina)}/${d.maxStamina}`, getPercent: (d) => (d.stamina / d.maxStamina * 100) + '%' },
                    { barId: 'barExp', valId: 'valExp', label: '经验值', type: 'exp', getValue: (d) => Math.floor(d.exp / d.maxExp * 100) + '%', getPercent: (d) => (d.exp / d.maxExp * 100) + '%' }
                ],
                baseAttrs: [
                    { id: 'attrStr', key: 'str', name: '力量' },
                    { id: 'attrDex', key: 'dex', name: '敏捷' },
                    { id: 'attrInt', key: 'int', name: '智力' },
                    { id: 'attrCon', key: 'con', name: '体质' },
                    { id: 'attrWis', key: 'wis', name: '精神' },
                    { id: 'attrLuck', key: 'luck', name: '幸运' }
                ],
                combatAttrs: [
                    { id: 'combatAtk', key: 'atk', name: '物理攻击' },
                    { id: 'combatDef', key: 'def', name: '物理防御' },
                    { id: 'combatMatk', key: 'matk', name: '魔法攻击' },
                    { id: 'combatMdef', key: 'mdef', name: '魔法防御' },
                    { id: 'combatHit', key: 'hit', name: '命中率', suffix: '%' },
                    { id: 'combatDodge', key: 'dodge', name: '闪避率', suffix: '%' },
                    { id: 'combatCrit', key: 'crit', name: '暴击率', suffix: '%' },
                    { id: 'combatAspd', key: 'aspd', name: '攻击间隔', fixed: 1 },
                    { id: 'combatSpd', key: 'speed', name: '移动速度', suffix: '', fixed: 1 }
                ],
                detailAttrs: [
                    { id: 'detailStaminaRegen', name: '体力恢复', unit: '/秒' },
                    { id: 'detailCollisionRadius', name: '碰撞体积', unit: 'px' },
                    { id: 'detailMoveSpeed', name: '移动速度', unit: 'px/帧' },
                    { id: 'detailDodgeCooldown', name: '闪避冷却', unit: 'ms' },
                    { id: 'detailAttackRange', name: '攻击距离', unit: 'px' },
                    { id: 'detailKnockback', name: '击退距离', unit: 'px' },
                    { id: 'detailViewRange', name: '视野宽度', unit: 'px' }
                ],
                loopInfo: [
                    { id: 'infoLoop', key: 'loopCount', name: '轮回次数' },
                    { id: 'infoDays', key: 'surviveDays', name: '存活天数' },
                    { id: 'infoKills', key: 'kills', name: '击杀数' },
                    { id: 'infoQuests', key: 'quests', name: '完成任务' },
                    { id: 'infoGene', key: 'geneLock', name: '基因锁' },
                    { id: 'infoRank', key: 'rank', name: '主神评价' }
                ]
            }
        };

        const QUICK_BAR_CONFIG = [
            { id: 'slotSkillQ', type: 'skill', key: 'Q', keyCode: 'KeyQ', label: 'Q', icon: '?', placeholder: '技能占位' },
            { id: 'slotSkillE', type: 'skill', key: 'E', keyCode: 'KeyE', label: 'E', icon: '?', placeholder: '技能占位' },
            { id: 'slotSkillR', type: 'skill', key: 'R', keyCode: 'KeyR', label: 'R', icon: '?', placeholder: '技能占位' },
            { id: 'slotItem1', type: 'item', key: '1', keyCode: 'Digit1', label: '1', icon: '?', placeholder: '道具占位' },
            { id: 'slotItem2', type: 'item', key: '2', keyCode: 'Digit2', label: '2', icon: '?', placeholder: '道具占位' },
            { id: 'slotItem3', type: 'item', key: '3', keyCode: 'Digit3', label: '3', icon: '?', placeholder: '道具占位' },
            { id: 'slotItem4', type: 'item', key: '4', keyCode: 'Digit4', label: '4', icon: '?', placeholder: '道具占位' }
        ];

        const EventBus = {
            _listeners: {},
            on(event, callback) {
                if (!this._listeners[event]) this._listeners[event] = [];
                this._listeners[event].push(callback);
            },
            off(event, callback) {
                if (!this._listeners[event]) return;
                const idx = this._listeners[event].indexOf(callback);
                if (idx !== -1) this._listeners[event].splice(idx, 1);
            },
            emit(event, ...args) {
                if (!this._listeners[event]) return;
                this._listeners[event].forEach(cb => cb(...args));
            },
            emitFirst(event, ...args) {
                if (!this._listeners[event] || this._listeners[event].length === 0) return undefined;
                return this._listeners[event][0](...args);
            }
        };

        // ==================== 音效管理系统 ====================
        const SoundManager = {
            ctx: null,
            masterVolume: 0.6,
            enabled: true,
            _stepTimer: 0,
            _stepInterval: 280,
            _initialized: false,

            init() {
                if (this._initialized) return;
                try {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    if (AudioContext) {
                        this.ctx = new AudioContext();
                        this._initialized = true;
                    }
                } catch (e) { console.warn('Web Audio API 不可用:', e); }
            },

            _ensureCtx() {
                if (!this.ctx) this.init();
                if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
                return !!this.ctx;
            },

            _now() { return this.ctx ? this.ctx.currentTime : 0; },

            _gain(val, when) {
                const g = this.ctx.createGain();
                g.gain.setValueAtTime(val, when);
                return g;
            },

            play(type) {
                if (!this.enabled || !this._ensureCtx()) return;
                switch (type) {
                    case 'melee_swing': this._playMeleeSwing(); break;
                    case 'bow_fire': this._playBowFire(); break;
                    case 'gun_fire': this._playGunFire(); break;
                    case 'hit': this._playHit(); break;
                    case 'crit': this._playCrit(); break;
                    case 'dodge': this._playDodge(); break;
                    case 'pickup': this._playPickup(); break;
                    case 'drop': this._playDrop(); break;
                    case 'equip': this._playEquip(); break;
                    case 'switch_weapon': this._playSwitchWeapon(); break;
                    case 'panel_open': this._playPanelOpen(); break;
                    case 'panel_close': this._playPanelClose(); break;
                    case 'enemy_death': this._playEnemyDeath(); break;
                    case 'player_hurt': this._playPlayerHurt(); break;
                    case 'wall_hit': this._playWallHit(); break;
                    case 'step': this._playStep(); break;
                }
            },

            _playMeleeSwing() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.15, t);
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(300, t);
                osc.frequency.exponentialRampToValueAtTime(80, t + 0.12);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.12);
            },

            _playBowFire() {
                const t = this._now();
                // 弦振动声
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.12, t);
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(600, t);
                osc.frequency.exponentialRampToValueAtTime(200, t + 0.08);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.1);
                // 箭矢破空声
                const noise = this.ctx.createBufferSource();
                const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
                noise.buffer = buffer;
                const nGain = this._gain(0.06, t + 0.02);
                nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
                noise.connect(nGain).connect(this.ctx.destination);
                noise.start(t + 0.02);
            },

            _playGunFire() {
                const t = this._now();
                // 低频爆音
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.3, t);
                osc.type = 'square';
                osc.frequency.setValueAtTime(200, t);
                osc.frequency.exponentialRampToValueAtTime(30, t + 0.06);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.08);
                // 噪音爆破
                const noise = this.ctx.createBufferSource();
                const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.03, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
                noise.buffer = buffer;
                const nGain = this._gain(0.2, t);
                nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
                noise.connect(nGain).connect(this.ctx.destination);
                noise.start(t);
            },

            _playHit() {
                const t = this._now();
                // 沉闷的打击声
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.2, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(200, t);
                osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.12);
                // 噪音层
                const noise = this.ctx.createBufferSource();
                const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.04, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
                noise.buffer = buffer;
                const nGain = this._gain(0.1, t);
                nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
                noise.connect(nGain).connect(this.ctx.destination);
                noise.start(t);
            },

            _playCrit() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.2, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(500, t);
                osc.frequency.exponentialRampToValueAtTime(1200, t + 0.05);
                osc.frequency.exponentialRampToValueAtTime(300, t + 0.15);
                gain.gain.setValueAtTime(0.2, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.18);
                // 闪烁噪音
                const noise = this.ctx.createBufferSource();
                const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.06, this.ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
                noise.buffer = buffer;
                const nGain = this._gain(0.08, t);
                nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
                noise.connect(nGain).connect(this.ctx.destination);
                noise.start(t);
            },

            _playDodge() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.12, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(300, t);
                osc.frequency.exponentialRampToValueAtTime(800, t + 0.08);
                osc.frequency.exponentialRampToValueAtTime(200, t + 0.2);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.2);
            },

            _playPickup() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.12, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, t);
                osc.frequency.setValueAtTime(660, t + 0.05);
                osc.frequency.setValueAtTime(880, t + 0.1);
                gain.gain.setValueAtTime(0.12, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.15);
            },

            _playDrop() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.1, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(660, t);
                osc.frequency.setValueAtTime(330, t + 0.06);
                gain.gain.setValueAtTime(0.1, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.12);
            },

            _playEquip() {
                const t = this._now();
                // 金属碰撞声
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.15, t);
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(800, t);
                osc.frequency.exponentialRampToValueAtTime(400, t + 0.08);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.1);
            },

            _playSwitchWeapon() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.1, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(300, t);
                osc.frequency.setValueAtTime(500, t + 0.04);
                osc.frequency.setValueAtTime(400, t + 0.08);
                gain.gain.setValueAtTime(0.1, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.1);
            },

            _playPanelOpen() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.06, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(300, t);
                osc.frequency.exponentialRampToValueAtTime(600, t + 0.06);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.08);
            },

            _playPanelClose() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.06, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, t);
                osc.frequency.exponentialRampToValueAtTime(300, t + 0.06);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.08);
            },

            _playEnemyDeath() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.15, t);
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(200, t);
                osc.frequency.exponentialRampToValueAtTime(30, t + 0.3);
                gain.gain.setValueAtTime(0.15, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.3);
            },

            _playPlayerHurt() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.15, t);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(250, t);
                osc.frequency.exponentialRampToValueAtTime(80, t + 0.2);
                gain.gain.setValueAtTime(0.15, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.2);
            },

            _playWallHit() {
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.08, t);
                osc.type = 'square';
                osc.frequency.setValueAtTime(120, t);
                osc.frequency.exponentialRampToValueAtTime(40, t + 0.06);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.08);
            },

            _playStep() {
                const now = Date.now();
                if (now - this._stepTimer < this._stepInterval) return;
                this._stepTimer = now;
                const t = this._now();
                const osc = this.ctx.createOscillator();
                const gain = this._gain(0.04, t);
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(100 + Math.random() * 60, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t); osc.stop(t + 0.04);
            },

            setVolume(v) { this.masterVolume = Math.max(0, Math.min(1, v)); },
            toggle() { this.enabled = !this.enabled; return this.enabled; }
        };

        const Game = {
            isRunning: false, lastTime: 0, fps: 0, frameCount: 0, fpsTimer: 0, player: null, entities: new Map(),
            init() { SoundManager.init(); Input.init(); Renderer.init(); SystemUI.init(); QuickBar.init(); },
            start() {
                try {
                    const menuLayer = document.getElementById('menuLayer'); const uiLayer = document.getElementById('uiLayer'); const gameLayer = document.getElementById('gameLayer'); if (menuLayer) menuLayer.classList.add('hidden'); if (uiLayer) uiLayer.style.display = 'block'; if (gameLayer) gameLayer.style.display = 'block';
                    Renderer.generateWorld();
                    this.spawnPlayer();
                    this.spawnTargets(); this.spawnEnemy();
                    // 在主角右边地上生成手枪
                    this.dropItem(CONFIG.WORLD_WIDTH/2 + 120, CONFIG.WORLD_HEIGHT/2, EquipManager.G18_PISTOL_ITEM);
                    // EventBus 解耦：订阅 Player 的拾取事件（使用具名回调以便 toMenu 中取消订阅）
                    this._onPickup = this._onPickup || ((px, py, range) => this.tryPickupItem(px, py, range));
                    EventBus.off('player:pickup', this._onPickup); EventBus.on('player:pickup', this._onPickup);
                    this.setupWeaponSwitchButtons();
                    this.isRunning = true; this.lastTime = performance.now(); this.loop(this.lastTime);
                } catch(e) {
                    const el = document.createElement('div');
                    el.style.cssText = 'position:fixed;top:10px;left:10px;right:10px;bottom:10px;z-index:99999;background:rgba(0,0,0,0.95);color:#ff4444;font-family:monospace;font-size:14px;padding:20px;overflow:auto;white-space:pre-wrap;';
                    el.textContent = 'ERROR: ' + e.message + '\n\nStack:\n' + e.stack;
                    document.body.appendChild(el);
                }
            },
            spawnPlayer() {
                const startX = 5104;
                const startY = 2520;
                this.player = new Player(startX, startY);
                this.entities.set('player', this.player);
                Camera.follow(this.player);
                EquipManager.init(this.player);
                CodexManager.init();
            },
            spawnTargets() {
                // 靶子放在迷宫下方的开放平原（上方相对出生点）
                const cx = CONFIG.WORLD_WIDTH / 2;
                const mazeEndY = WallSystem.mazeEndY || CONFIG.WORLD_HEIGHT * 0.37;
                const startX = cx - 120, startY = mazeEndY + 200;
                const cols = 3, rows = 3, spacing = 120;
                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const i = r * cols + c;
                        const tx = startX + c * spacing, ty = startY + r * spacing;
                        const target = new TargetDummy(tx, ty, { hp: 150 + i * 30, maxHp: 150 + i * 30, name: `训练靶 ${i + 1}` });
                        this.entities.set(`target_${i}`, target);
                    }
                }
            },
            spawnEnemy() {
                // 敌人放在出生点右侧
                const cx = CONFIG.WORLD_WIDTH / 2, cy = CONFIG.WORLD_HEIGHT / 2;
                const enemy = new Enemy(cx + 500, cy, { hp: 200, maxHp: 200, speed: 0.25, name: '测试敌人' });
                this.entities.set('enemy', enemy);
            },
            dropItem(x, y, itemTemplate) {
                // 通过 ItemFactory 创建独立物品实例
                const itemInstance = ItemFactory.create(itemTemplate);
                const drop = new DropItem(x, y, itemInstance);
                this.entities.set('drop_' + Date.now() + '_' + Math.floor(Math.random() * 1000), drop);
            },
            tryPickupItem(px, py, range) {
                let picked = false;
                this.entities.forEach((entity, key) => {
                    if (picked) return;
                    if (entity instanceof DropItem && entity.active) {
                        const dx = entity.x - px, dy = entity.y - py;
                        if (Math.sqrt(dx * dx + dy * dy) <= range) {
                            // 添加到背包
                            EquipManager.addToBackpack(entity.itemData);
                            entity.active = false;
                            this.entities.delete(key);
                            // SoundManager.play('pickup');
                            // 显示拾取提示
                            EffectManager.add(new FloatingTextEffect(entity.x, entity.y - 20, `拾取: ${entity.itemData.name}`));
                            picked = true;
                        }
                    }
                });
                return picked;
            },
            loop(timestamp) {
                if (!this.isRunning) return;
                try {
                    const dt = Math.max(0, Math.min(timestamp - this.lastTime, 100)); this.lastTime = timestamp;
                    this.frameCount++; this.fpsTimer += dt;
                    if (this.fpsTimer >= 1000) { this.fps = this.frameCount; this.frameCount = 0; this.fpsTimer = 0; }
                    this.update(dt); this.render(); this.updateUI(); Input.update();
                } catch (e) {
                    console.error('Game loop error:', e);
                }
                requestAnimationFrame(t => this.loop(t));
            },
            update(dt) {
                Camera.update(this.player);
                this.entities.forEach(e => { if (e.active) e.update(dt, this.entities); });
                EffectManager.update();
            },
            render() {
                Renderer.clear(); Renderer.renderTerrain(); Renderer.renderGrid();
                MazeGenerator.render(Renderer.ctx, Camera.x - CONFIG.VIEW_WIDTH/2, Camera.y - CONFIG.VIEW_HEIGHT/2);
                const sorted = Array.from(this.entities.values()).filter(e => e.active).sort((a, b) => a.y - b.y);
                sorted.forEach(e => e.render(Renderer.ctx)); EffectManager.render(Renderer.ctx);
            },
            updateUI() {
                if (!this.player) return;
                const d = this.player.data, p = this.player;
                // 数据驱动更新顶部栏
                UI_DATA_CONFIG.topBar.forEach(item => {
                    const el = document.getElementById(item.id);
                    if (el) el.textContent = item.getValue(p);
                });
                // 数据驱动更新顶部状态栏 (HP/MP)
                UI_DATA_CONFIG.topStatus.forEach(item => {
                    const bar = document.getElementById(item.barId);
                    const val = document.getElementById(item.valId);
                    if (bar) bar.style.width = item.getPercent(d);
                    if (val) val.textContent = item.getValue(d);
                });
                // 攻击冷却指示器
                const currentItem = p.equipments[p.weaponMode];
                let attackType = 'melee';
                if (currentItem) {
                    if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') attackType = 'pistol';
                    else if (currentItem.weaponType === 'bow') attackType = 'ranged';
                }
                const currentAttack = p.attacks[attackType];
                const attackCD = currentAttack.getCooldownPercent();
                const cdOverlay = document.getElementById('cdAttackOverlay');
                if (cdOverlay) cdOverlay.style.height = (attackCD * 100) + '%';
                const cdAttack = document.getElementById('cdAttack');
                if (cdAttack) cdAttack.classList.toggle('ready', attackCD <= 0);
                let attackIcon = '⚔';
                if (currentItem) {
                    if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') attackIcon = '🔫';
                    else if (currentItem.weaponType === 'bow') attackIcon = '🏹';
                }
                const attackLabel = p.weaponMode === 'weapon' ? '武器栏1' : '武器栏2';
                if (cdAttack && cdAttack.childNodes[0]) cdAttack.childNodes[0].textContent = attackIcon;
                const attackLabelEl = document.getElementById('attackLabel');
                if (attackLabelEl) attackLabelEl.textContent = attackLabel;
                // 底部状态条更新
                const hpBar = document.getElementById('hpBar'), hpText = document.getElementById('hpText');
                const staminaBar = document.getElementById('staminaBar'), staminaText = document.getElementById('staminaText');
                if (hpBar) hpBar.style.width = (d.maxHp ? (d.hp / d.maxHp * 100) : 0) + '%';
                if (hpText) hpText.textContent = `${Math.ceil(d.hp)}/${d.maxHp}`;
                if (staminaBar) staminaBar.style.width = (d.maxStamina ? (d.stamina / d.maxStamina * 100) : 0) + '%';
                if (staminaText) staminaText.textContent = `${Math.ceil(d.stamina)}/${d.maxStamina}`;
                // 武器信息显示
                const weaponModeEl = document.getElementById('weaponMode'), weaponNameEl = document.getElementById('weaponName');
                if (weaponModeEl) weaponModeEl.textContent = p.weaponMode === 'weapon' ? '武器栏1' : '武器栏2';
                // 武器栏指示器（红色边框表示当前使用的武器栏）
                if (weaponModeEl) {
                    weaponModeEl.style.color = p.weaponMode === 'weapon' ? '#7a9a6a' : '#7a8aaa';
                    weaponModeEl.style.fontWeight = '700';
                }
                if (weaponNameEl) {
                    const weaponItem = p.equipments[p.weaponMode];
                    weaponNameEl.textContent = weaponItem ? weaponItem.name : '空手';
                }
                // 数据驱动更新状态面板
                const sp = UI_DATA_CONFIG.statusPage;
                // 头部信息（面板可能未打开，元素可能为null）
                const charNameEl = document.getElementById('charName');
                const charClassEl = document.getElementById('charClass');
                const charLevelEl = document.getElementById('charLevel');
                if (charNameEl) charNameEl.textContent = d.name;
                if (charClassEl) charClassEl.textContent = d.class;
                if (charLevelEl) charLevelEl.textContent = 'Lv.' + d.level;
                sp.bars.forEach(item => {
                    const bar = document.getElementById(item.barId);
                    const val = document.getElementById(item.valId);
                    if (bar) bar.style.width = item.getPercent(d);
                    if (val) val.textContent = item.getValue(d);
                });
                sp.baseAttrs.forEach(item => {
                    const el = document.getElementById(item.id);
                    if (el) el.textContent = d[item.key];
                });
                sp.combatAttrs.forEach(item => {
                    const el = document.getElementById(item.id);
                    if (!el) return;
                    if (item.id === 'combatAspd') {
                        // 攻击间隔：根据当前武器显示实际毫秒数
                        const currentWpn = p.equipments[p.weaponMode];
                        let cd = 250; // 默认近战
                        if (currentWpn) {
                            if (currentWpn.weaponType === 'pistol' || currentWpn.rangedType === 'pistol') cd = 55;
                            else if (currentWpn.weaponType === 'bow') cd = 600;
                        }
                        el.textContent = cd + 'ms';
                    } else {
                        el.textContent = item.suffix ? d[item.key] + item.suffix : (item.fixed ? d[item.key].toFixed(item.fixed) : d[item.key]);
                    }
                });
                sp.loopInfo.forEach(item => {
                    const el = document.getElementById(item.id);
                    if (el) el.textContent = d[item.key];
                });
                // 详细属性渲染
                sp.detailAttrs.forEach(item => {
                    const el = document.getElementById(item.id);
                    if (!el) return;
                    const currentWpn = p.equipments[p.weaponMode];
                    let paType = 'melee';
                    if (currentWpn) {
                        if (currentWpn.weaponType === 'pistol' || currentWpn.rangedType === 'pistol') paType = 'pistol';
                        else if (currentWpn.weaponType === 'bow') paType = 'ranged';
                    }
                    const pa = p.attacks[paType];
                    switch (item.id) {
                        case 'detailStaminaRegen': el.textContent = CONFIG.STAMINA_REGEN + item.unit; break;
                        case 'detailCollisionRadius': el.textContent = (p.collisionRadius || 10) + item.unit; break;
                        case 'detailMoveSpeed': el.textContent = CONFIG.PLAYER_SPEED + item.unit; break;
                        case 'detailDodgeCooldown': el.textContent = CONFIG.DODGE_COOLDOWN + item.unit; break;
                        case 'detailAttackRange': el.textContent = (pa ? pa.config.range : 100) + item.unit; break;
                        case 'detailKnockback': el.textContent = (pa ? pa.config.knockback : 20) + item.unit; break;
                        case 'detailViewRange': el.textContent = CONFIG.VIEW_WIDTH + item.unit; break;
                    }
                });
            },
            load() {
                const save = localStorage.getItem('infiniteLoop_save');
                if (save) { let data; try { data = JSON.parse(save); } catch (e) { console.error('Load failed:', e); EffectManager.add(new FloatingTextEffect(this.player ? this.player.x : CONFIG.WORLD_WIDTH/2, this.player ? this.player.y - 20 : CONFIG.WORLD_HEIGHT/2, '读档失败: 存档损坏')); return; } alert(`读取存档: ${data.player?.name || '未知'}\n等级: ${data.player?.level || 1}`); }
                else alert('没有找到存档');
            },
            save() {
                if (!this.player) return;
                const saveData = { version: '1.0', timestamp: Date.now(), player: this.player.data, position: { x: this.player.x, y: this.player.y } };
                try { localStorage.setItem('infiniteLoop_save', JSON.stringify(saveData)); alert('已保存至主神空间'); } catch (e) { console.error('Save failed:', e); alert('存档失败: 存储空间不足'); }
            },
            showHelp() { alert('WASD移动 | 鼠标瞄准 | 左键攻击 | F切换武器\nC打开装备栏 | 空格闪避 | Shift冲刺'); },
            toMenu() {
                this.isRunning = false; this.entities.clear(); this.player = null; SystemUI.close();
                // EventBus 解耦：取消拾取事件订阅，避免重复
                if (this._onPickup) EventBus.off('player:pickup', this._onPickup);
                const menuLayer = document.getElementById('menuLayer'); const uiLayer = document.getElementById('uiLayer'); const gameLayer = document.getElementById('gameLayer'); if (menuLayer) menuLayer.classList.remove('hidden'); if (uiLayer) uiLayer.style.display = 'none'; if (gameLayer) gameLayer.style.display = 'none';
            },
            setupWeaponSwitchButtons() {
                // quickMelee/quickRanged buttons are optional; weapon switching via F key always works
            }
        };
        window.onload = () => Game.init();