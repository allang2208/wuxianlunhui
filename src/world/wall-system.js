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
        // 检查目标位置可用，且从起点到终点的线段不穿墙
        if (this.canMoveTo(nx, ny, r) && !this.blocked(x, y, nx, ny)) return { x: nx, y: ny };
        // 尝试只移动X轴
        if (this.canMoveTo(nx, y, r) && !this.blocked(x, y, nx, y)) return { x: nx, y };
        // 尝试只移动Y轴
        if (this.canMoveTo(x, ny, r) && !this.blocked(x, y, x, ny)) return { x, y: ny };
        // 都不行，返回起点（安全位置）
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


export { WallSystem };
