import { WallSystem } from '../world/wall-system.js';
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
    renderWalls(ctx, offsetX, offsetY) {
        if (!ctx) return;
        ctx.save();
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
        ctx.restore();
    },
    render(ctx, offsetX, offsetY) {
        this.renderWalls(ctx, offsetX, offsetY);
    }
};

// ==================== 墙壁管理系统 ====================

export { MazeGenerator };
