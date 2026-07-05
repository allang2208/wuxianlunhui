const WallSystem = {
    walls: [],
    mazeEndY: 0,
    _wallHeight: 60,
    init(ww, wh) {
        this.walls = [];
        this.trees = [];
        const wallHeight = this._wallHeight;
        const mazeH = wh * 0.25, mazeW = ww * 0.6, mazeOX = ww * 0.2;
        // 迷宫顶部边距：确保入口在 Camera 可跟随区域（halfH 以上），同时限制不覆盖玩家生成位置
        const mazeOY = Math.max(wh * 0.12, Math.min(CONFIG.VIEW_HEIGHT * 0.55, wh * 0.20));
        this._mazeOX = mazeOX; this._mazeOY = mazeOY; this._mazeH = mazeH; this._mazeW = mazeW;
        const mazeWalls = MazeGenerator.generate(mazeW, mazeH);
        for (const w of mazeWalls) this.walls.push({ x: w.x + mazeOX, y: w.y + mazeOY, w: w.w, h: w.h, height: wallHeight });
        this.walls.push({ x: mazeOX - 16, y: mazeOY, w: 16, h: mazeH, height: wallHeight });
        this.walls.push({ x: mazeOX + mazeW, y: mazeOY, w: 16, h: mazeH, height: wallHeight });
        // 顶部边界分两段，避开入口（第一个格子顶部，宽CELL_SIZE）
        const cs = MazeGenerator.CELL_SIZE;
        this.walls.push({ x: mazeOX - 16, y: mazeOY - 16, w: 16, h: 16, height: wallHeight }); // 左上角封头
        this.walls.push({ x: mazeOX + cs, y: mazeOY - 16, w: mazeW - cs + 16, h: 16, height: wallHeight }); // 入口右侧顶部边界
        this.walls.push({ x: mazeOX - 16, y: mazeOY + mazeH, w: mazeW + 32, h: 16, height: wallHeight }); // 底部边界
        this.mazeEndY = mazeOY + mazeH;
        // ===== Phaser 墙壁同步 =====
        this._syncWallsToPhaser();
    },
    /**
     * 将墙壁同步到 Phaser 的 staticGroup
     * 在 init() 和 addTree() 时调用
     */
    _syncWallsToPhaser() {
        const phaserScene = window.__phaserScene;
        if (!phaserScene) return;
        // 清除旧墙壁（如果存在）
        if (phaserScene.walls && phaserScene.walls.countActive(true) > 0) {
            phaserScene.walls.clear(true, true);
        }
        // 创建矩形墙壁物理体
        for (const w of this.walls) {
            const wall = phaserScene.add.rectangle(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, 0x000000, 0);
            phaserScene.physics.add.existing(wall, true); // true = static
            phaserScene.walls.add(wall);
        }
        console.log('[WallSystem] Synced', this.walls.length, 'walls to Phaser');
        // 重新同步树木碰撞体
        this._syncTreesToPhaser();
        // 设置碰撞关系
        phaserScene.setupColliders();
    },
    /**
     * 将树木同步到 Phaser 的 staticGroup
     */
    _syncTreesToPhaser() {
        const phaserScene = window.__phaserScene;
        if (!phaserScene) return;
        // 创建树木圆形碰撞体（用不可见圆形表示），使用独立的 collisionRadius
        for (const t of this.trees) {
            const tree = phaserScene.add.circle(t.x, t.y, t.collisionRadius || t.radius * 0.6, 0x000000, 0);
            phaserScene.physics.add.existing(tree, true);
            phaserScene.walls.add(tree);
            t.phaserSprite = tree;
        }
        console.log('[WallSystem] Synced', this.trees.length, 'trees to Phaser');
    },
    getWallsInView(vx, vy, vw, vh) {
        const result = [];
        for (const w of this.walls) {
            if (w.x + w.w > vx && w.x < vx + vw && w.y + w.h > vy && w.y < vy + vh) result.push(w);
        }
        return result;
    },
    /**
     * 侧视角墙壁渲染：绘制墙面（立面矩形）+ 墙顶（小矩形）
     * 按 y 深度排序（y 小的先画，即后面的先画）
     */
    renderWalls(ctx, cameraX, cameraY) {
        const vw = CONFIG.VIEW_WIDTH, vh = CONFIG.VIEW_HEIGHT;
        const visible = [];
        for (const w of this.walls) {
            if (w.x + w.w > cameraX && w.x < cameraX + vw && w.y + w.h > cameraY && w.y < cameraY + vh) {
                visible.push(w);
            }
        }
        visible.sort((a, b) => a.y - b.y);
        for (const w of visible) {
            const sx = w.x - cameraX;
            const sy = w.y - cameraY;
            // 墙面（立面）：从 footprint 后沿向上延伸
            ctx.fillStyle = '#5a5a5a';
            ctx.fillRect(sx, sy - w.height, w.w, w.height);
            // 墙顶（小矩形，厚度 4px）
            ctx.fillStyle = '#6e6e6e';
            ctx.fillRect(sx, sy - w.height - 4, w.w, 4);
        }
    },
    circleRect(cx, cy, r, rect) {
        const clX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
        const clY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
        return (cx - clX) ** 2 + (cy - clY) ** 2 < r * r;
    },
    canMoveTo(x, y, radius) {
        for (const w of this.walls) if (this.circleRect(x, y, radius, w)) return false;
        // 检查树木碰撞：使用独立的 collisionRadius（视觉半径的60%）
        for (const t of this.trees) {
            const dx = x - t.x, dy = y - t.y;
            const treeR = t.collisionRadius || t.radius * 0.6;
            if (Math.sqrt(dx * dx + dy * dy) < treeR + radius) return false;
        }
        return true;
    },
    resolve(x, y, nx, ny, r) {
        if (this.canMoveTo(nx, ny, r) && !this.blocked(x, y, nx, ny)) return { x: nx, y: ny };
        if (this.canMoveTo(nx, y, r) && !this.blocked(x, y, nx, y)) return { x: nx, y };
        if (this.canMoveTo(x, ny, r) && !this.blocked(x, y, x, ny)) return { x, y: ny };
        // [OPTIMIZE] 大怪物卡树优化：标准滑动失败后，尝试沿移动方向逐步缩减步长
        // 找到可移动的最远位置，避免完全卡住
        const dx = nx - x, dy = ny - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
            for (let ratio = 0.75; ratio >= 0.25; ratio -= 0.25) {
                const stepX = x + dx * ratio;
                const stepY = y + dy * ratio;
                if (this.canMoveTo(stepX, stepY, r) && !this.blocked(x, y, stepX, stepY)) {
                    return { x: stepX, y: stepY };
                }
            }
        }
        return { x, y };
    },
    lineCircle(x1, y1, x2, y2, cx, cy, r) {
        const dx = x2 - x1, dy = y2 - y1;
        const a = dx * dx + dy * dy;
        const b = 2 * (dx * (x1 - cx) + dy * (y1 - cy));
        const c = (x1 - cx) * (x1 - cx) + (y1 - cy) * (y1 - cy) - r * r;
        if (a === 0) return Math.sqrt((x1 - cx) ** 2 + (y1 - cy) ** 2) < r;
        const det = b * b - 4 * a * c;
        if (det < 0) return false;
        const t1 = (-b - Math.sqrt(det)) / (2 * a), t2 = (-b + Math.sqrt(det)) / (2 * a);
        return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
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
        // 检查树木：使用独立的 collisionRadius（视觉半径的60%）
        for (const t of this.trees) if (this.lineCircle(x1, y1, x2, y2, t.x, t.y, t.collisionRadius || t.radius * 0.6)) return true;
        return false;
    },
    addTree(x, y, radius, treeType, sceneGroup = 'normal', rotation = 0) {
        // [OPTIMIZE] 碰撞体积较大的怪物卡树优化：
        // 树木视觉半径和碰撞半径分离，碰撞半径为视觉半径的60%，
        // 让大怪物更容易在树木间通过，同时保持视觉效果
        const collisionRadius = radius * 0.6;
        const treeData = {
            x, y, radius, collisionRadius,
            type: treeType || 0,
            sceneGroup: sceneGroup || 'normal',
            rotation: rotation || 0,
            trunkWidth: radius * 0.6,
            trunkHeight: radius * 2,
            canopyRadius: radius * 1.2,
            sortY: y + radius * 2
        };
        this.trees.push(treeData);
        // ===== Phaser 树木同步（单个添加）=====
        const phaserScene = window.__phaserScene;
        if (phaserScene) {
            const tree = phaserScene.add.circle(x, y, collisionRadius, 0x000000, 0);
            phaserScene.physics.add.existing(tree, true);
            phaserScene.walls.add(tree);
            treeData.phaserSprite = tree;
        }
    },
    /**
     * 移除指定半径内的树木
     * @param {number} cx - 中心X
     * @param {number} cy - 中心Y
     * @param {number} radius - 半径
     * @returns {number} 移除的树木数量
     */
    removeTreesInRadius(cx, cy, radius) {
        let removed = 0;
        for (let i = this.trees.length - 1; i >= 0; i--) {
            const t = this.trees[i];
            const dx = t.x - cx;
            const dy = t.y - cy;
            if (Math.sqrt(dx * dx + dy * dy) <= radius) {
                if (t.phaserSprite) {
                    t.phaserSprite.destroy();
                }
                this.trees.splice(i, 1);
                removed++;
            }
        }
        return removed;
    },
    getTreesInView(vx, vy, vw, vh) {
        const result = [];
        for (const t of this.trees) {
            if (t.x + t.radius > vx && t.x - t.radius < vx + vw && t.y + t.radius > vy && t.y - t.radius < vy + vh) result.push(t);
        }
        return result;
    },
    renderTrees(ctx, cameraX, cameraY) {
        const trees = this.getTreesInView(cameraX, cameraY, CONFIG.VIEW_WIDTH, CONFIG.VIEW_HEIGHT);
        trees.sort((a, b) => (a.sortY || a.y) - (b.sortY || b.y));
        for (const t of trees) {
            const sx = t.x - cameraX;
            const sy = t.y - cameraY;
            const trunkW = t.trunkWidth || t.radius * 0.6;
            const trunkH = t.trunkHeight || t.radius * 2;
            const canopyR = t.canopyRadius || t.radius * 1.2;
            // 绘制树干（棕色矩形）
            ctx.fillStyle = '#5a3a1a';
            ctx.fillRect(sx - trunkW / 2, sy - trunkH, trunkW, trunkH);
            // 树干高光
            ctx.fillStyle = '#4a2a0a';
            ctx.fillRect(sx - trunkW / 2 + 2, sy - trunkH, 2, trunkH);
            // 绘制树冠（绿色圆形）
            ctx.fillStyle = '#2d8a3e';
            ctx.beginPath();
            ctx.arc(sx, sy - trunkH - canopyR * 0.3, canopyR, 0, Math.PI * 2);
            ctx.fill();
            // 树冠高光
            ctx.fillStyle = '#3da84e';
            ctx.beginPath();
            ctx.arc(sx - canopyR * 0.2, sy - trunkH - canopyR * 0.5, canopyR * 0.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
};


export { WallSystem };
