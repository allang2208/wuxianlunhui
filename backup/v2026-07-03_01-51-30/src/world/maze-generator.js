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
    renderTrees(ctx, offsetX, offsetY) {
        ctx.save();
        const trees = WallSystem.getTreesInView(offsetX, offsetY, CONFIG.VIEW_WIDTH, CONFIG.VIEW_HEIGHT);
        if (!MazeGenerator._treeImageCache) MazeGenerator._treeImageCache = {};
        const cache = MazeGenerator._treeImageCache;
        // 预加载 wood.png 用于碰撞体积标记
        if (!cache['assets/scenes/wood.png']) {
            const woodImg = new Image();
            woodImg.src = 'assets/scenes/wood.png';
            cache['assets/scenes/wood.png'] = woodImg;
        }
        const woodImg = cache['assets/scenes/wood.png'];
        for (const t of trees) {
            const sx = t.x - offsetX, sy = t.y - offsetY;
            // 查找覆盖此树的实体（排除死亡的）
            let entitiesInTree = [];
            if (typeof Game !== 'undefined' && Game.entities) {
                for (const e of Game.entities.values()) {
                    if (!e.active || e._isDead) continue;
                    const dx = e.x - t.x, dy = e.y - t.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < t.radius + 120) entitiesInTree.push(e);
                }
            }
            // 计算统一的透视区域（所有实体位置的并集包围圆）
            let unifiedClipRadius = 0, unifiedCx = sx, unifiedCy = sy;
            if (entitiesInTree.length > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const e of entitiesInTree) {
                    const ex = e.x - offsetX, ey = e.y - offsetY;
                    minX = Math.min(minX, ex - 60);
                    minY = Math.min(minY, ey - 60);
                    maxX = Math.max(maxX, ex + 60);
                    maxY = Math.max(maxY, ey + 60);
                }
                unifiedCx = (minX + maxX) / 2;
                unifiedCy = (minY + maxY) / 2;
                unifiedClipRadius = Math.max(60, Math.sqrt((maxX - minX) ** 2 + (maxY - minY) ** 2) / 2 + 20);
            }
            if (t.image) {
                let img = cache[t.image];
                if (!img) {
                    img = new Image();
                    img.src = t.image;
                    cache[t.image] = img;
                }
                if (img.complete && img.naturalWidth > 0) {
                    const s = t.radius * 13.2;
                    if (entitiesInTree.length > 0) {
                        // 统一透视效果：使用一个大的包围圆排除所有实体区域
                        ctx.save();
                        ctx.beginPath();
                        ctx.arc(sx, sy, s / 2, 0, Math.PI * 2);
                        ctx.moveTo(unifiedCx + unifiedClipRadius, unifiedCy);
                        ctx.arc(unifiedCx, unifiedCy, unifiedClipRadius, 0, Math.PI * 2);
                        ctx.clip('evenodd');
                        // 支持树木旋转
                        if (t.rotation) {
                            ctx.translate(sx, sy);
                            ctx.rotate(t.rotation);
                            ctx.drawImage(img, -s / 2, -s / 2, s, s);
                            ctx.translate(-sx, -sy); // 恢复
                        } else {
                            ctx.drawImage(img, sx - s / 2, sy - s / 2, s, s);
                        }
                        ctx.restore();
                    } else {
                        if (t.rotation) {
                            ctx.save();
                            ctx.translate(sx, sy);
                            ctx.rotate(t.rotation);
                            ctx.drawImage(img, -s / 2, -s / 2, s, s);
                            ctx.restore();
                        } else {
                            ctx.drawImage(img, sx - s / 2, sy - s / 2, s, s);
                        }
                    }
                } else {
                    ctx.fillStyle = '#2d8a3e';
                    ctx.beginPath();
                    ctx.arc(sx, sy, t.radius * 4, 0, Math.PI * 2);
                    ctx.fill();
                }
            } else {
                ctx.fillStyle = '#2d8a3e';
                ctx.beginPath();
                ctx.arc(sx, sy, t.radius * 4, 0, Math.PI * 2);
                ctx.fill();
            }
            // 碰撞体积标记：使用 wood.png 替换棕色实心圆（仅在透视状态下显示）
            if (entitiesInTree.length > 0) {
                if (woodImg && woodImg.complete && woodImg.naturalWidth > 0) {
                    const ws = t.radius * 2;
                    ctx.drawImage(woodImg, sx - ws / 2, sy - ws / 2, ws, ws);
                } else {
                    ctx.fillStyle = '#8B5A2B';
                    ctx.beginPath();
                    ctx.arc(sx, sy, t.radius, 0, Math.PI * 2);
                    ctx.fill();
                }
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
