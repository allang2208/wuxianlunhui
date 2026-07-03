/* ================================================================
 *  PathFinder — 局部A*寻路系统（用于怪物绕过障碍物）
 * ================================================================ */

class PathFinder {
    constructor() {
        this.gridSize = 20; // 每个格子20x20px
        this.searchRange = 200; // 搜索范围200px
    }

    // 检查一个点是否在障碍物内
    _isBlocked(x, y, radius) {
        if (typeof WallSystem === 'undefined') return false;
        // 检查矩形墙壁
        if (WallSystem.walls && WallSystem.walls.length > 0) {
            for (const w of WallSystem.walls) {
                if (x + radius > w.x && x - radius < w.x + w.w &&
                    y + radius > w.y && y - radius < w.y + w.h) {
                    return true;
                }
            }
        }
        // 检查圆形树木
        if (WallSystem.trees && WallSystem.trees.length > 0) {
            for (const t of WallSystem.trees) {
                const dx = x - t.x, dy = y - t.y;
                if (Math.sqrt(dx * dx + dy * dy) < t.radius + radius) {
                    return true;
                }
            }
        }
        return false;
    }

    // 构建局部网格
    _buildGrid(startX, startY, endX, endY, entityRadius) {
        const minX = Math.min(startX, endX) - this.searchRange;
        const maxX = Math.max(startX, endX) + this.searchRange;
        const minY = Math.min(startY, endY) - this.searchRange;
        const maxY = Math.max(startY, endY) + this.searchRange;
        
        const cols = Math.ceil((maxX - minX) / this.gridSize);
        const rows = Math.ceil((maxY - minY) / this.gridSize);
        
        const grid = [];
        for (let r = 0; r < rows; r++) {
            grid[r] = [];
            for (let c = 0; c < cols; c++) {
                const x = minX + c * this.gridSize + this.gridSize / 2;
                const y = minY + r * this.gridSize + this.gridSize / 2;
                grid[r][c] = {
                    x, y, r, c,
                    blocked: this._isBlocked(x, y, entityRadius),
                    g: Infinity, h: 0, f: Infinity,
                    parent: null, visited: false
                };
            }
        }
        return { grid, minX, minY, cols, rows };
    }

    // A*寻路
    findPath(startX, startY, endX, endY, entityRadius) {
        const { grid, minX, minY, cols, rows } = this._buildGrid(startX, startY, endX, endY, entityRadius);
        
        // 找到起点和终点对应的格子
        const startC = Math.floor((startX - minX) / this.gridSize);
        const startR = Math.floor((startY - minY) / this.gridSize);
        const endC = Math.floor((endX - minX) / this.gridSize);
        const endR = Math.floor((endY - minY) / this.gridSize);
        
        if (startR < 0 || startR >= rows || startC < 0 || startC >= cols) return null;
        if (endR < 0 || endR >= rows || endC < 0 || endC >= cols) return null;
        
        const startNode = grid[startR][startC];
        const endNode = grid[endR][endC];
        
        if (!startNode || !endNode || startNode.blocked || endNode.blocked) return null;
        
        startNode.g = 0;
        startNode.h = Math.abs(endX - startX) + Math.abs(endY - startY);
        startNode.f = startNode.h;
        
        const openList = [startNode];
        
        while (openList.length > 0) {
            // 找到f值最小的节点
            let lowestIdx = 0;
            for (let i = 1; i < openList.length; i++) {
                if (openList[i].f < openList[lowestIdx].f) lowestIdx = i;
            }
            
            const current = openList[lowestIdx];
            openList.splice(lowestIdx, 1);
            current.visited = true;
            
            // 到达终点
            if (current.c === endC && current.r === endR) {
                const path = [];
                let node = current;
                while (node) {
                    path.unshift({ x: node.x, y: node.y });
                    node = node.parent;
                }
                return path;
            }
            
            // 检查8个邻居
            const neighbors = [
                [-1, -1], [-1, 0], [-1, 1],
                [0, -1],           [0, 1],
                [1, -1],  [1, 0],  [1, 1]
            ];
            
            for (const [dr, dc] of neighbors) {
                const nr = current.r + dr;
                const nc = current.c + dc;
                if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
                
                const neighbor = grid[nr][nc];
                if (neighbor.blocked || neighbor.visited) continue;
                
                const isDiagonal = dr !== 0 && dc !== 0;
                const moveCost = isDiagonal ? 1.414 : 1;
                const tentativeG = current.g + moveCost * this.gridSize;
                
                if (tentativeG < neighbor.g) {
                    neighbor.g = tentativeG;
                    neighbor.h = Math.abs(endX - neighbor.x) + Math.abs(endY - neighbor.y);
                    neighbor.f = neighbor.g + neighbor.h;
                    neighbor.parent = current;
                    
                    if (!openList.includes(neighbor)) {
                        openList.push(neighbor);
                    }
                }
            }
        }
        
        return null; // 未找到路径
    }
}

// 全局路径查找器实例
const pathFinder = new PathFinder();

export { PathFinder, pathFinder };
