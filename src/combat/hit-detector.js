import { Renderer } from '../world/renderer.js';

/**
 * HitDetector - 攻击判定系统
 * 
 * 提供以下判定方法：
 * 1. lineToHex     - 线段（近战攻击） vs 六边形
 * 2. circleToHex   - 圆形（爆炸/范围） vs 六边形
 * 3. arcToHex      - 扇形（扫砍/特殊） vs 六边形
 * 4. projectileToHex - 投射物 vs 六边形
 * 
 * 所有检测返回 HitResult 或 null
 */

/**
 * @typedef {Object} HitResult
 * @property {number} vertexIndex - 命中的最近顶点索引(0-5)
 * @property {number} x - 命中点世界坐标X
 * @property {number} y - 命中点世界坐标Y
 * @property {number} distance - 命中点到中心的距离
 * @property {number} multiplier - 该顶点的伤害倍率
 * @property {string} hitRegion - 命中区域名称 ('front'|'back'|'left'|'right'|'leftFront'|'rightFront')
 */

const REGION_NAMES = [
    'front',      // 0° 正前方
    'rightFront', // 60° 右前
    'right',      // 120° 右后
    'back',       // 180° 正后方
    'left',       // 240° 左后
    'leftFront'   // 300° 左前
];

class HitDetector {
    
    // ==================== 工具函数 ====================
    
    /**
     * 线段与线段相交检测
     * @returns {{x:number, y:number}|null} 相交点或null
     */
    static lineLineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
        const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(denom) < 1e-10) return null; // 平行
        
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
        
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
            return {
                x: x1 + t * (x2 - x1),
                y: y1 + t * (y2 - y1)
            };
        }
        return null;
    }
    
    /**
     * 点是否在线段上（带误差容忍）
     */
    static pointOnSegment(px, py, x1, y1, x2, y2, tolerance = 1e-6) {
        const dx = x2 - x1, dy = y2 - y1;
        const d2 = dx * dx + dy * dy;
        if (d2 < tolerance) {
            const dx2 = px - x1, dy2 = py - y1;
            return (dx2 * dx2 + dy2 * dy2) < tolerance * tolerance;
        }
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / d2));
        const cx = x1 + t * dx, cy = y1 + t * dy;
        const dx2 = px - cx, dy2 = py - cy;
        return (dx2 * dx2 + dy2 * dy2) < tolerance * tolerance;
    }
    
    /**
     * 点是否在扇形内（顶视角，以(cx,cy)为圆心，angle为中心方向，halfAngle为半角，maxRadius为半径）
     */
    static pointInArc(px, py, cx, cy, angle, halfAngle, maxRadius) {
        const dx = px - cx, dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxRadius) return false;
        
        const pointAngle = Math.atan2(dy, dx);
        let diff = Math.abs(pointAngle - angle);
        while (diff > Math.PI) diff = Math.abs(2 * Math.PI - diff);
        
        return diff <= halfAngle;
    }
    
    // ==================== 核心判定 ====================
    
    /**
     * 线段 vs 六边形（近战攻击、射线、投射物轨迹）
     * @param {number} x1 - 线段起点X
     * @param {number} y1 - 线段起点Y
     * @param {number} x2 - 线段终点X
     * @param {number} y2 - 线段终点Y
     * @param {HexHitbox} hexHitbox - 目标六边形
     * @returns {HitResult|null}
     */
    static lineToHex(x1, y1, x2, y2, hexHitbox) {
        const v = hexHitbox.vertices;
        if (!v[0]) return null; // 未初始化
        
        // 1. 快速AABB排除：线段包围盒与六边形包围盒是否可能相交
        let lminX = Math.min(x1, x2), lminY = Math.min(y1, y2);
        let lmaxX = Math.max(x1, x2), lmaxY = Math.max(y1, y2);
        const bounds = hexHitbox.getBounds();
        if (lmaxX < bounds.minX || lminX > bounds.maxX || lmaxY < bounds.minY || lminY > bounds.maxY) {
            return null;
        }
        
        // 2. 检测线段是否与六边形任意边相交
        let bestHit = null;
        let bestDist = Infinity;
        
        for (let i = 0; i < 6; i++) {
            const j = (i + 1) % 6;
            const intersect = this.lineLineIntersection(
                x1, y1, x2, y2,
                v[i].x, v[i].y, v[j].x, v[j].y
            );
            
            if (intersect) {
                const d = hexHitbox.distanceToCenter(intersect.x, intersect.y);
                if (d < bestDist) {
                    bestDist = d;
                    bestHit = intersect;
                }
            }
        }
        
        // 3. 线段端点是否在六边形内（如投射物完全穿透）
        if (hexHitbox.containsPoint(x1, y1)) {
            const d = hexHitbox.distanceToCenter(x1, y1);
            if (d < bestDist) {
                bestDist = d;
                bestHit = { x: x1, y: y1 };
            }
        }
        if (hexHitbox.containsPoint(x2, y2)) {
            const d = hexHitbox.distanceToCenter(x2, y2);
            if (d < bestDist) {
                bestDist = d;
                bestHit = { x: x2, y: y2 };
            }
        }
        
        if (!bestHit) return null;
        
        // 4. 找到命中点最近的顶点，计算伤害倍率
        const nearest = hexHitbox.getNearestVertex(bestHit.x, bestHit.y);
        
        return {
            vertexIndex: nearest.index,
            x: bestHit.x,
            y: bestHit.y,
            distance: nearest.distance,
            multiplier: nearest.multiplier,
            hitRegion: REGION_NAMES[nearest.index]
        };
    }
    
    /**
     * 圆形（范围攻击/爆炸） vs 六边形
     * @param {number} cx - 圆心X
     * @param {number} cy - 圆心Y
     * @param {number} radius - 圆半径
     * @param {HexHitbox} hexHitbox - 目标六边形
     * @returns {HitResult|null}
     */
    static circleToHex(cx, cy, radius, hexHitbox) {
        const v = hexHitbox.vertices;
        if (!v[0]) return null;
        
        // 1. 圆心是否在六边形内
        if (hexHitbox.containsPoint(cx, cy)) {
            const nearest = hexHitbox.getNearestVertex(cx, cy);
            return {
                vertexIndex: nearest.index,
                x: cx,
                y: cy,
                distance: nearest.distance,
                multiplier: nearest.multiplier,
                hitRegion: REGION_NAMES[nearest.index]
            };
        }
        
        // 2. 检测六边形各顶点是否在圆内
        let bestHit = null;
        let bestDist = Infinity;
        
        for (let i = 0; i < 6; i++) {
            const dx = v[i].x - cx, dy = v[i].y - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 <= radius * radius) {
                const d = Math.sqrt(d2);
                if (d < bestDist) {
                    bestDist = d;
                    bestHit = { x: v[i].x, y: v[i].y, index: i };
                }
            }
        }
        
        // 3. 检测圆心到六边形各边的最短距离
        for (let i = 0; i < 6; i++) {
            const j = (i + 1) % 6;
            const closest = this._closestPointOnSegment(cx, cy, v[i].x, v[i].y, v[j].x, v[j].y);
            const dx = closest.x - cx, dy = closest.y - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 <= radius * radius) {
                const d = Math.sqrt(d2);
                if (d < bestDist) {
                    bestDist = d;
                    bestHit = { x: closest.x, y: closest.y, index: i };
                }
            }
        }
        
        if (!bestHit) return null;
        
        const nearest = hexHitbox.getNearestVertex(bestHit.x, bestHit.y);
        return {
            vertexIndex: nearest.index,
            x: bestHit.x,
            y: bestHit.y,
            distance: nearest.distance,
            multiplier: nearest.multiplier,
            hitRegion: REGION_NAMES[nearest.index]
        };
    }
    
    /**
     * 扇形（扫砍/特殊攻击） vs 六边形
     * @param {number} cx - 扇形中心X
     * @param {number} cy - 扇形中心Y
     * @param {number} angle - 扇形中心方向（弧度）
     * @param {number} halfAngle - 扇形半角（弧度）
     * @param {number} maxRadius - 扇形半径
     * @param {HexHitbox} hexHitbox - 目标六边形
     * @returns {HitResult|null}
     */
    static arcToHex(cx, cy, angle, halfAngle, maxRadius, hexHitbox) {
        const v = hexHitbox.vertices;
        if (!v[0]) return null;
        
        let bestHit = null;
        let bestScore = Infinity; // 使用距离+角度综合评分
        
        // 检查六边形所有顶点是否在扇形内
        for (let i = 0; i < 6; i++) {
            if (this.pointInArc(v[i].x, v[i].y, cx, cy, angle, halfAngle, maxRadius)) {
                const dx = v[i].x - cx, dy = v[i].y - cy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                // 评分：距离越近越好
                if (dist < bestScore) {
                    bestScore = dist;
                    bestHit = { x: v[i].x, y: v[i].y, index: i };
                }
            }
        }
        
        // 检查六边形中心是否在扇形内
        const center = hexHitbox.getCenter();
        if (this.pointInArc(center.x, center.y, cx, cy, angle, halfAngle, maxRadius)) {
            const dx = center.x - cx, dy = center.y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestScore) {
                bestScore = dist;
                bestHit = { x: center.x, y: center.y, index: -1 };
            }
        }
        
        // 检查扇形边与六边形边的相交（更精确但计算量较大）
        // 简化：将扇形边缘近似为两条线段，检测与六边形相交
        const arcStart = angle - halfAngle;
        const arcEnd = angle + halfAngle;
        const edges = [
            { x1: cx, y1: cy, x2: cx + Math.cos(arcStart) * maxRadius, y2: cy + Math.sin(arcStart) * maxRadius },
            { x1: cx, y1: cy, x2: cx + Math.cos(arcEnd) * maxRadius, y2: cy + Math.sin(arcEnd) * maxRadius }
        ];
        
        for (const edge of edges) {
            const hit = this.lineToHex(edge.x1, edge.y1, edge.x2, edge.y2, hexHitbox);
            if (hit) {
                const dx = hit.x - cx, dy = hit.y - cy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < bestScore) {
                    bestScore = dist;
                    bestHit = { x: hit.x, y: hit.y, index: hit.vertexIndex };
                }
            }
        }
        
        if (!bestHit) return null;
        
        const nearest = hexHitbox.getNearestVertex(bestHit.x, bestHit.y);
        return {
            vertexIndex: nearest.index,
            x: bestHit.x,
            y: bestHit.y,
            distance: nearest.distance,
            multiplier: nearest.multiplier,
            hitRegion: REGION_NAMES[nearest.index]
        };
    }
    
    /**
     * 投射物（圆形+速度向量） vs 六边形
     * 与 lineToHex 类似，但增加投射物半径扩展
     * @param {number} x1 - 当前位置X
     * @param {number} y1 - 当前位置Y
     * @param {number} x2 - 下一帧位置X
     * @param {number} y2 - 下一帧位置Y
     * @param {number} projRadius - 投射物半径
     * @param {HexHitbox} hexHitbox - 目标六边形
     * @returns {HitResult|null}
     */
    static projectileToHex(x1, y1, x2, y2, projRadius, hexHitbox) {
        // 将投射物视为有半径的线段：通过扩展六边形边界来检测
        // 简化方法：检测线段与六边形相交，若命中则返回结果
        // 更精确的方法：检测线段与六边形每条边的偏移线相交
        
        // 使用圆检测作为近似（快速但不够精确）
        const hit = this.lineToHex(x1, y1, x2, y2, hexHitbox);
        if (hit) return hit;
        
        // 投射物中心到六边形各边的最短距离
        const closest = this._closestPointOnSegmentToHex(x1, y1, x2, y2, hexHitbox);
        if (closest && closest.distance <= projRadius) {
            const nearest = hexHitbox.getNearestVertex(closest.x, closest.y);
            return {
                vertexIndex: nearest.index,
                x: closest.x,
                y: closest.y,
                distance: nearest.distance,
                multiplier: nearest.multiplier,
                hitRegion: REGION_NAMES[nearest.index]
            };
        }
        
        return null;
    }
    
    // ==================== 内部工具 ====================
    
    /** 点到线段的最短距离点 */
    static _closestPointOnSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1e-10) return { x: x1, y: y1 };
        
        let t = ((px - x1) * dx + (py - y1) * dy) / d2;
        t = Math.max(0, Math.min(1, t));
        return {
            x: x1 + t * dx,
            y: y1 + t * dy
        };
    }
    
    /** 线段到六边形各边的最短距离 */
    static _closestPointOnSegmentToHex(x1, y1, x2, y2, hexHitbox) {
        const v = hexHitbox.vertices;
        let best = null;
        let bestDist = Infinity;
        
        for (let i = 0; i < 6; i++) {
            const j = (i + 1) % 6;
            // 线段v[i]-v[j]与线段(x1,y1)-(x2,y2)的最近点对
            const p1 = this._closestPointOnSegment(x1, y1, v[i].x, v[i].y, v[j].x, v[j].y);
            const d1 = (p1.x - x1) ** 2 + (p1.y - y1) ** 2;
            if (d1 < bestDist) {
                bestDist = d1;
                best = p1;
            }
            
            const p2 = this._closestPointOnSegment(x2, y2, v[i].x, v[i].y, v[j].x, v[j].y);
            const d2 = (p2.x - x2) ** 2 + (p2.y - y2) ** 2;
            if (d2 < bestDist) {
                bestDist = d2;
                best = p2;
            }
            
            const p3 = this._closestPointOnSegment(v[i].x, v[i].y, x1, y1, x2, y2);
            const d3 = (p3.x - v[i].x) ** 2 + (p3.y - v[i].y) ** 2;
            if (d3 < bestDist) {
                bestDist = d3;
                best = p3;
            }
        }
        
        return best ? { ...best, distance: Math.sqrt(bestDist) } : null;
    }
    
    // ==================== 调试渲染 ====================
    
    /**
     * 绘制攻击线段调试信息
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @param {string} color
     */
    static renderAttackLine(ctx, x1, y1, x2, y2, color = 'rgba(255, 255, 0, 0.6)') {
        const s1 = Renderer.worldToScreen(x1, y1);
        const s2 = Renderer.worldToScreen(x2, y2);
        
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // 起点和终点标记
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(s1.x, s1.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(s2.x, s2.y, 3, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
    }
    
    /**
     * 绘制扇形调试信息
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} cx
     * @param {number} cy
     * @param {number} angle
     * @param {number} halfAngle
     * @param {number} radius
     * @param {string} color
     */
    static renderArc(ctx, cx, cy, angle, halfAngle, radius, color = 'rgba(255, 200, 0, 0.3)') {
        const sc = Renderer.worldToScreen(cx, cy);
        const sr = radius * Renderer.scale; // 假设Renderer有scale属性
        
        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = 'rgba(255, 200, 0, 0.6)';
        ctx.lineWidth = 1.5;
        
        ctx.beginPath();
        ctx.moveTo(sc.x, sc.y);
        ctx.arc(sc.x, sc.y, sr, angle - halfAngle, angle + halfAngle);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        ctx.restore();
    }
    
    /**
     * 绘制命中点特效（调试用）
     * @param {CanvasRenderingContext2D} ctx
     * @param {HitResult} hitResult
     * @param {number} duration - 显示时长(ms)
     */
    static renderHitPoint(ctx, hitResult, duration = 500) {
        const sp = Renderer.worldToScreen(hitResult.x, hitResult.y);
        const colors = {
            front: '#ff4444',
            back: '#4444ff',
            left: '#44ff44',
            right: '#ffaa44',
            leftFront: '#44ffff',
            rightFront: '#ff44ff'
        };
        const color = colors[hitResult.hitRegion] || '#ffffff';
        
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(`${hitResult.hitRegion} x${hitResult.multiplier.toFixed(1)}`, sp.x + 8, sp.y - 8);
        ctx.restore();
    }
}

export { HitDetector };
