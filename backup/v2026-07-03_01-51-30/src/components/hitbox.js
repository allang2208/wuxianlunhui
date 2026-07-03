import { Renderer } from '../world/renderer.js';

/**
 * HexHitbox - 六边形包围盒（6点判定点系统）
 * 
 * 顶视角游戏中，角色轮廓以正六边形近似。
 * 6个顶点按顺时针排列，分别对应：
 *   [0] 0°  (正前方，角色朝向)  -> 正面/头部，建议倍率 1.2x
 *   [1] 60° (右前侧)             -> 右肩，建议倍率 1.0x
 *   [2] 120°(右后侧)             -> 右后，建议倍率 0.8x
 *   [3] 180°(正后方)             -> 背部，建议倍率 1.5x（背刺）
 *   [4] 240°(左后侧)             -> 左后，建议倍率 0.8x
 *   [5] 300°(左前侧)             -> 左肩，建议倍率 1.0x
 */
class HexHitbox {
    /**
     * @param {number} radius - 六边形外接圆半径（本地坐标）
     * @param {number[]} damageMultipliers - 6个顶点的伤害倍率，默认 [1.2, 1.0, 0.8, 1.5, 0.8, 1.0]
     * @param {number[]} radii - 6个顶点的独立半径（可选，用于非正六边形）
     */
    constructor(radius, damageMultipliers = null, radii = null) {
        this.baseRadius = radius;
        this.damageMultipliers = damageMultipliers || [1.2, 1.0, 0.8, 1.5, 0.8, 1.0];
        this.radii = radii || null; // 若为null，则6个顶点使用相同半径
        
        // 6个本地坐标顶点（预计算，相对实体中心）
        this.localVertices = new Array(6);
        // 6个世界坐标顶点（每帧更新）
        this.vertices = new Array(6).fill(null).map(() => ({ x: 0, y: 0 }));
        
        this._precomputeLocal();
    }
    
    /** 预计算本地坐标顶点 */
    _precomputeLocal() {
        for (let i = 0; i < 6; i++) {
            const angle = (i * 60) * (Math.PI / 180); // 0°, 60°, 120°...
            const r = this.radii ? this.radii[i] : this.baseRadius;
            this.localVertices[i] = {
                x: Math.cos(angle) * r,
                y: Math.sin(angle) * r
            };
        }
    }
    
    /**
     * 根据实体位置和旋转，更新6个顶点的世界坐标
     * @param {Entity} entity - 具有 x, y, rotation 的实体
     */
    updateWorldPosition(entity) {
        const cos = Math.cos(entity.rotation);
        const sin = Math.sin(entity.rotation);
        const cx = entity.x;
        const cy = entity.y;
        
        for (let i = 0; i < 6; i++) {
            const lv = this.localVertices[i];
            // 旋转 + 平移
            this.vertices[i].x = cx + (lv.x * cos - lv.y * sin);
            this.vertices[i].y = cy + (lv.x * sin + lv.y * cos);
        }
    }
    
    /**
     * 检测点是否在六边形内（射线交叉法）
     * @param {number} px - 世界坐标X
     * @param {number} py - 世界坐标Y
     * @returns {boolean}
     */
    containsPoint(px, py) {
        const v = this.vertices;
        let inside = false;
        for (let i = 0, j = 5; i < 6; j = i++) {
            const xi = v[i].x, yi = v[i].y;
            const xj = v[j].x, yj = v[j].y;
            
            if (((yi > py) !== (yj > py)) &&
                (px < (xj - xi) * (py - yi) / (yj - yi + 1e-10) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }
    
    /**
     * 获取六边形中心（即实体位置）
     * @returns {{x:number, y:number}}
     */
    getCenter() {
        // 六边形中心近似为6顶点平均值
        let sx = 0, sy = 0;
        for (const v of this.vertices) { sx += v.x; sy += v.y; }
        return { x: sx / 6, y: sy / 6 };
    }
    
    /**
     * 计算点(px,py)到六边形中心的距离
     * @param {number} px
     * @param {number} py
     * @returns {number}
     */
    distanceToCenter(px, py) {
        const c = this.getCenter();
        const dx = px - c.x, dy = py - c.y;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    /**
     * 找到六边形上离点(px,py)最近的顶点
     * @param {number} px
     * @param {number} py
     * @returns {{index:number, x:number, y:number, distance:number, multiplier:number}}
     */
    getNearestVertex(px, py) {
        let nearestIndex = 0;
        let nearestDist = Infinity;
        
        for (let i = 0; i < 6; i++) {
            const v = this.vertices[i];
            const dx = px - v.x, dy = py - v.y;
            const dist = dx * dx + dy * dy; // 比较平方距离，避免开方
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestIndex = i;
            }
        }
        
        const v = this.vertices[nearestIndex];
        return {
            index: nearestIndex,
            x: v.x,
            y: v.y,
            distance: Math.sqrt(nearestDist),
            multiplier: this.damageMultipliers[nearestIndex]
        };
    }
    
    /**
     * 获取六边形包围盒（用于空间划分加速查询）
     * @returns {{minX:number, minY:number, maxX:number, maxY:number}}
     */
    getBounds() {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        for (const v of this.vertices) {
            if (v.x < minX) minX = v.x;
            if (v.y < minY) minY = v.y;
            if (v.x > maxX) maxX = v.x;
            if (v.y > maxY) maxY = v.y;
        }
        return { minX, minY, maxX, maxY };
    }
    
    /**
     * 获取六边形近似半径（用于兼容现有圆形碰撞的渐进迁移）
     * 返回外接圆半径与内切圆半径的平均值
     * @returns {number}
     */
    getApproxRadius() {
        // 外接圆半径
        const circumradius = this.baseRadius;
        // 内切圆半径 = circumradius * cos(30°)
        const inradius = circumradius * 0.866025;
        return (circumradius + inradius) / 2;
    }
    
    /**
     * 绘制调试图形（红色半透明六边形+顶点编号）
     * @param {CanvasRenderingContext2D} ctx
     */
    renderDebug(ctx) {
        const v = this.vertices;
        if (!v[0]) return; // 未初始化
        
        // 转换到屏幕坐标
        const sv = v.map(p => Renderer.worldToScreen(p.x, p.y));
        const sc = Renderer.worldToScreen(this.getCenter().x, this.getCenter().y);
        
        ctx.save();
        
        // 填充六边形
        ctx.fillStyle = 'rgba(255, 80, 80, 0.12)';
        ctx.beginPath();
        ctx.moveTo(sv[0].x, sv[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(sv[i].x, sv[i].y);
        ctx.closePath();
        ctx.fill();
        
        // 描边
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        // 绘制顶点（不同颜色区分）
        const colors = [
            '#ff4444', // 0° 前方 - 红色
            '#ffaa44', // 60° - 橙色
            '#44ff44', // 120° - 绿色
            '#4444ff', // 180° 后方 - 蓝色（背刺）
            '#44ff44', // 240° - 绿色
            '#ffaa44'  // 300° - 橙色
        ];
        
        for (let i = 0; i < 6; i++) {
            ctx.fillStyle = colors[i];
            ctx.beginPath();
            ctx.arc(sv[i].x, sv[i].y, 3, 0, Math.PI * 2);
            ctx.fill();
            
            // 顶点编号
            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.font = '9px monospace';
            ctx.fillText(i.toString(), sv[i].x + 5, sv[i].y - 5);
        }
        
        // 中心点
        ctx.fillStyle = 'rgba(255, 255, 0, 0.8)';
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, 2, 0, Math.PI * 2);
        ctx.fill();
        
        // 绘制方向指示线（前方=0°顶点）
        ctx.strokeStyle = 'rgba(255, 255, 0, 0.6)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(sc.x, sc.y);
        ctx.lineTo(sv[0].x, sv[0].y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.restore();
    }
    
    /**
     * 设置动态半径（用于动画帧不同姿态的hitbox缩放）
     * @param {number} radius
     * @param {number[]} radii - 可选的6个独立半径
     */
    setRadius(radius, radii = null) {
        this.baseRadius = radius;
        this.radii = radii;
        this._precomputeLocal();
    }
    
    /**
     * 序列化为JSON（用于存档）
     * @returns {object}
     */
    serialize() {
        return {
            baseRadius: this.baseRadius,
            damageMultipliers: [...this.damageMultipliers],
            radii: this.radii ? [...this.radii] : null
        };
    }
    
    /**
     * 从JSON反序列化
     * @param {object} data
     * @returns {HexHitbox}
     */
    static deserialize(data) {
        return new HexHitbox(data.baseRadius, data.damageMultipliers, data.radii);
    }
}

export { HexHitbox };
