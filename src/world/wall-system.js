import { CONFIG } from '../config/config.js';

const WallSystem = {
    walls: [],
    mazeEndY: 0,
    _wallHeight: 60,
    _phaserVisualsEnabled: false,
    init(ww, wh) {
        this.walls = [];
        this.trees = [];
        // 主神空间不再生成迷宫（开阔测试场地；maze-generator.js 保留备用）
        this.mazeEndY = 0;
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
        // 清除旧视觉墙壁
        if (phaserScene.visualWalls) {
            phaserScene.visualWalls.clear(true, true);
        }
        // 创建矩形墙壁物理体 + 视觉精灵（noVisual 墙只建物理体，如静态 NPC 底座障碍）
        for (const w of this.walls) {
            const wall = phaserScene.add.rectangle(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, 0x000000, 0);
            phaserScene.physics.add.existing(wall, true); // true = static
            phaserScene.walls.add(wall);

            if (phaserScene.visualWalls && !w.noVisual) {
                this._createWallVisual(phaserScene, w);
            }
        }

        // 重新同步树木（包括视觉精灵）
        this._syncTreesToPhaser();
        // 设置碰撞关系
        phaserScene.setupColliders();
        this._phaserVisualsEnabled = true;
    },

    /**
     * 创建墙壁视觉精灵（水平墙用 wall.png，垂直墙用 wall-2.png）
     * 水平墙：显示完整墙面，Sprite 拉伸覆盖；垂直墙：只看顶部砖块
     * 贴图放大一倍（visualH ×2）；水平/垂直拼接处无缝；尽头半圆角，拼接处不处理
     * 图层：depth = 底部 Y 坐标（与地面相交处遮挡截断）
     */
    _createWallVisual(phaserScene, w) {
        // 根据宽高比判断方向：w > h 为水平墙，否则为垂直墙
        const isHorizontal = w.w >= w.h;
        const textureKey = isHorizontal ? 'wall_horizontal' : 'wall_vertical';
        if (!phaserScene.textures.exists(textureKey)) {
            // 回退到旧的程序化纹理
            const face = phaserScene.add.sprite(w.x + w.w / 2, w.y + w.h, 'wall_face');
            face.setOrigin(0.5, 1);
            face.setDisplaySize(w.w, w.height || 60);
            face.setDepth(w.y + w.h);
            phaserScene.visualWalls.add(face);
            w.visualSprite = face;
            return;
        }

        const t = isHorizontal ? w.h : w.w; // 墙厚
        const halfT = t / 2;

        // 检测两端是否有相邻墙壁（拼接），有则不收圆角并向外延伸半厚消除缝隙
        let leftConnected = false, rightConnected = false, topConnected = false, bottomConnected = false;
        if (isHorizontal) {
            leftConnected = this._hasAdjacentWall(w.x - halfT, w.y + halfT, w.x, w.y + halfT, w);
            rightConnected = this._hasAdjacentWall(w.x + w.w, w.y + halfT, w.x + w.w + halfT, w.y + halfT, w);
        } else {
            topConnected = this._hasAdjacentWall(w.x + halfT, w.y - halfT, w.x + halfT, w.y, w);
            bottomConnected = this._hasAdjacentWall(w.x + halfT, w.y + w.h, w.x + halfT, w.y + w.h + halfT, w);
        }

        if (isHorizontal) {
            // 水平墙：贴图放大 3 倍（visualH ×3），左右拼接处延伸半厚
            const visualH = (w.height || 60) * 3;
            const extL = leftConnected ? halfT : 0;
            const extR = rightConnected ? halfT : 0;
            const sx = w.x - extL;
            const sw = w.w + extL + extR;
            const sprite = phaserScene.add.sprite(
                sx + sw / 2,
                w.y + w.h - visualH / 2,
                textureKey
            );
            sprite.setDisplaySize(sw, visualH);
            sprite.setDepth(w.y + w.h);
            phaserScene.visualWalls.add(sprite);
            w.visualSprite = sprite;

            // 尽头半圆角（只在未拼接的端点）
            if (!leftConnected) this._drawWallCap(phaserScene, w.x, w.y + w.h, halfT, 'left', w);
            if (!rightConnected) this._drawWallCap(phaserScene, w.x + w.w, w.y + w.h, halfT, 'right', w);
        } else {
            // 垂直墙：贴图放大 3 倍（w.w ×3 显示宽度），上下拼接处延伸半厚
            const visualW = w.w * 3;
            const extT = topConnected ? halfT : 0;
            const extB = bottomConnected ? halfT : 0;
            const sy = w.y - extT;
            const sh = w.h + extT + extB;
            const sprite = phaserScene.add.sprite(
                w.x + w.w / 2,
                sy + sh / 2,
                textureKey
            );
            sprite.setDisplaySize(visualW, sh);
            // 透视规则：与水平墙相交时，垂直墙在上方相交点之上（盖住水平墙），在下方相交点之下（被水平墙盖住）
            // 上方相交（topConnected）：depth = 水平墙 depth + 1（垂直在上）
            // 下方相交（bottomConnected）：depth = 水平墙 depth - 1（水平在上）
            let depth = w.y + w.h;
            if (topConnected) {
                const hWall = this._findAdjacentHorizontalWall(w.x + halfT, w.y - halfT, w.x + halfT, w.y, w);
                if (hWall) depth = hWall.y + hWall.h + 1;
            } else if (bottomConnected) {
                const hWall = this._findAdjacentHorizontalWall(w.x + halfT, w.y + w.h, w.x + halfT, w.y + w.h + halfT, w);
                if (hWall) depth = hWall.y + hWall.h - 1;
            }
            sprite.setDepth(depth);
            phaserScene.visualWalls.add(sprite);
            w.visualSprite = sprite;

            // 尽头半圆角（只在未拼接的端点）
            if (!topConnected) this._drawWallCap(phaserScene, w.x + w.w / 2, w.y, halfT, 'top', w);
            if (!bottomConnected) this._drawWallCap(phaserScene, w.x + w.w / 2, w.y + w.h, halfT, 'bottom', w);
        }
    },

    /** 查找与指定线段相交的水平墙壁（用于透视深度调整） */
    _findAdjacentHorizontalWall(x1, y1, x2, y2, self) {
        const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
        for (const w of this.walls) {
            if (w === self) continue;
            if (w.w < w.h) continue; // 只找水平墙（w >= h）
            if (maxX >= w.x && minX <= w.x + w.w && maxY >= w.y && minY <= w.y + w.h) {
                return w;
            }
        }
        return null;
    },

    /** 检测指定线段范围内是否有其他墙壁（拼接判定） */
    _hasAdjacentWall(x1, y1, x2, y2, self) {
        for (const w of this.walls) {
            if (w === self) continue;
            // 检查线段是否与墙壁矩形相交（简单的 AABB 相交检测）
            const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
            const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
            if (maxX >= w.x && minX <= w.x + w.w && maxY >= w.y && minY <= w.y + w.h) {
                return true;
            }
        }
        return false;
    },

    /** 在墙壁尽头画半圆角（graphics 半圆，与墙体贴图颜色一致） */
    _drawWallCap(phaserScene, cx, cy, r, side, wallRef) {
        const g = phaserScene.add.graphics();
        const color = 0x3a3a3a; // 与 wall.png 深色砖块接近
        g.fillStyle(color, 1);
        // 根据方向画半圆
        g.beginPath();
        if (side === 'left') {
            g.arc(cx, cy, r, Math.PI / 2, Math.PI * 1.5);
        } else if (side === 'right') {
            g.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2);
        } else if (side === 'top') {
            g.arc(cx, cy, r, Math.PI, 0);
        } else { // bottom
            g.arc(cx, cy, r, 0, Math.PI);
        }
        g.closePath();
        g.fillPath();
        g.setDepth(cy);
        phaserScene.visualWalls.add(g);
        if (!wallRef._capSprites) wallRef._capSprites = [];
        wallRef._capSprites.push(g);
    },
    /**
     * 将树木同步到 Phaser 的 staticGroup
     */
    _syncTreesToPhaser() {
        const phaserScene = window.__phaserScene;
        if (!phaserScene) return;
        if (phaserScene.visualTrees) {
            phaserScene.visualTrees.clear(true, true);
        }
        // 创建树木圆形碰撞体（用不可见圆形表示），使用独立的 collisionRadius
        for (const t of this.trees) {
            const tree = phaserScene.add.circle(t.x, t.y, t.collisionRadius || t.radius * 0.6, 0x000000, 0);
            phaserScene.physics.add.existing(tree, true);
            phaserScene.walls.add(tree);
            t.phaserBody = tree;

            if (phaserScene.visualTrees) {
                const isSnow = t.sceneGroup === 'snow';
                const key = isSnow ? 'tree_canopy_snow' : 'tree_canopy';
                const sprite = phaserScene.add.sprite(t.x, t.y, key);
                sprite.setOrigin(0.5, 1);
                const canopyR = t.canopyRadius || t.radius * 1.2;
                const trunkH = t.trunkHeight || t.radius * 2;
                const displayW = canopyR * 2.2;
                const displayH = trunkH + canopyR * 1.8;
                sprite.setDisplaySize(displayW, displayH);
                sprite.setDepth(t.sortY || t.y + t.radius * 2);
                phaserScene.visualTrees.add(sprite);
                t.visualSprite = sprite;
            }
        }

        if (this.trees.length > 0) this._phaserVisualsEnabled = true;
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
            // [UNSTUCK] 尝试沿移动方向切线方向侧向滑动，帮助走出墙角/窄缝
            const nxNorm = dx / dist;
            const nyNorm = dy / dist;
            for (const side of [-1, 1]) {
                const tx = -nyNorm * side;
                const ty = nxNorm * side;
                for (let ratio = 0.75; ratio >= 0.25; ratio -= 0.25) {
                    const sx = x + dx * ratio + tx * r;
                    const sy = y + dy * ratio + ty * r;
                    if (this.canMoveTo(sx, sy, r) && !this.blocked(x, y, sx, sy)) {
                        return { x: sx, y: sy };
                    }
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
            height: radius * 3,
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
            treeData.phaserBody = tree;

            if (phaserScene.visualTrees) {
                const isSnow = sceneGroup === 'snow';
                const key = isSnow ? 'tree_canopy_snow' : 'tree_canopy';
                const sprite = phaserScene.add.sprite(x, y, key);
                sprite.setOrigin(0.5, 1);
                const displayW = treeData.canopyRadius * 2.2;
                const displayH = treeData.trunkHeight + treeData.canopyRadius * 1.8;
                sprite.setDisplaySize(displayW, displayH);
                sprite.setDepth(treeData.sortY);
                phaserScene.visualTrees.add(sprite);
                treeData.visualSprite = sprite;
            }
            this._phaserVisualsEnabled = true;
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
                if (t.visualSprite) {
                    t.visualSprite.destroy();
                }
                if (t.phaserBody) {
                    t.phaserBody.destroy();
                }
                this.trees.splice(i, 1);
                removed++;
            }
        }
        return removed;
    },
    /**
     * 寻找安全的生成位置：若 (x,y) 被阻挡，则沿螺旋方向外推直到找到合法点
     * @param {number} x - 初始 X
     * @param {number} y - 初始 Y
     * @param {number} radius - 实体碰撞半径
     * @param {number} [maxAttempts=8] - 最大尝试次数
     * @returns {{x:number, y:number}} 安全坐标
     */
    findSafeSpawn(x, y, radius, maxAttempts = 8) {
        if (this.canMoveTo(x, y, radius)) return { x, y };
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const angle = (Math.PI * 2 * attempt) / maxAttempts;
            const dist = radius * attempt * 0.8;
            const tx = x + Math.cos(angle) * dist;
            const ty = y + Math.sin(angle) * dist;
            if (this.canMoveTo(tx, ty, radius)) return { x: tx, y: ty };
        }
        return { x, y };
    },
    getTreesInView(vx, vy, vw, vh) {
        const result = [];
        for (const t of this.trees) {
            if (t.x + t.radius > vx && t.x - t.radius < vx + vw && t.y + t.radius > vy && t.y - t.radius < vy + vh) result.push(t);
        }
        return result;
    },
    renderTrees(ctx, cameraX, cameraY) {
        if (this._phaserVisualsEnabled) return;
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
