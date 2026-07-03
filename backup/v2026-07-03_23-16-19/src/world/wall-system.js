const WallSystem = {
    walls: [],
    mazeEndY: 0,
    init(ww, wh) {
        this.walls = [];
        this.trees = [];
        const mazeH = wh * 0.25, mazeW = ww * 0.6, mazeOX = ww * 0.2;
        // 迷宫顶部边距：确保入口在 Camera 可跟随区域（halfH 以上），同时限制不覆盖玩家生成位置
        const mazeOY = Math.max(wh * 0.12, Math.min(CONFIG.VIEW_HEIGHT * 0.55, wh * 0.20));
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
        // 创建树木圆形碰撞体（用不可见圆形表示）
        for (const t of this.trees) {
            const tree = phaserScene.add.circle(t.x, t.y, t.radius, 0x000000, 0);
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
    circleRect(cx, cy, r, rect) {
        const clX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
        const clY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
        return (cx - clX) ** 2 + (cy - clY) ** 2 < r * r;
    },
    canMoveTo(x, y, radius) {
        for (const w of this.walls) if (this.circleRect(x, y, radius, w)) return false;
        // 检查树木碰撞
        for (const t of this.trees) {
            const dx = x - t.x, dy = y - t.y;
            if (Math.sqrt(dx * dx + dy * dy) < t.radius + radius) return false;
        }
        return true;
    },
    resolve(x, y, nx, ny, r) {
        if (this.canMoveTo(nx, ny, r) && !this.blocked(x, y, nx, ny)) return { x: nx, y: ny };
        if (this.canMoveTo(nx, y, r) && !this.blocked(x, y, nx, y)) return { x: nx, y };
        if (this.canMoveTo(x, ny, r) && !this.blocked(x, y, x, ny)) return { x, y: ny };
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
        for (const t of this.trees) if (this.lineCircle(x1, y1, x2, y2, t.x, t.y, t.radius)) return true;
        return false;
    },
    addTree(x, y, radius, treeType, imagePath, sceneGroup = 'normal', rotation = 0) {
        const treeData = { x, y, radius, type: treeType || 0, image: imagePath || null, sceneGroup: sceneGroup || 'normal', rotation: rotation || 0 };
        this.trees.push(treeData);
        // ===== Phaser 树木同步（单个添加）=====
        const phaserScene = window.__phaserScene;
        if (phaserScene) {
            const tree = phaserScene.add.circle(x, y, radius, 0x000000, 0);
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
    }
};


export { WallSystem };
