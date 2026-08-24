import { Geom } from 'phaser';

const samePoint = (a, b) => a && b
    && Math.abs(a.x - b.x) <= 1e-6
    && Math.abs(a.y - b.y) <= 1e-6;

function sanitizePolygon(points) {
    const out = [];
    for (const point of points || []) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        if (samePoint(out[out.length - 1], point)) continue;
        out.push({ x: point.x, y: point.y });
    }
    if (out.length > 2 && samePoint(out[0], out[out.length - 1])) out.pop();
    return out;
}

/**
 * 静态阴影只需要一个可注销、可被雾适配器标记的身份句柄。
 * 旧实现为每个 caster 创建空 Graphics，虽无命令仍进入 Phaser display list。
 */
export function createStaticShadowHandle(id, x = 0, y = 0) {
    return {
        id,
        x,
        y,
        rotation: 0,
        active: true,
        visible: true,
        setVisible(value) {
            this.visible = !!value;
            return this;
        },
        destroy() {
            this.active = false;
            this.visible = false;
        },
    };
}

/** bbox 粗裁即可；允许少量假阳性，但不能误裁进入相机的长投影。 */
export function shadowPolygonIntersectsViewport(points, viewport) {
    if (!viewport) return true;
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const point of points || []) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        left = Math.min(left, point.x);
        right = Math.max(right, point.x);
        top = Math.min(top, point.y);
        bottom = Math.max(bottom, point.y);
    }
    if (left === Infinity) return false;
    return right >= viewport.left && left <= viewport.right
        && bottom >= viewport.top && top <= viewport.bottom;
}

/**
 * 在生成当前太阳角的精确轮廓前做保守粗裁：收集 footprint/分层部件/源贴图的最大范围，
 * 再向所有方向扩张最大影长。即使离屏期间太阳绕到另一侧，caster 重新接近相机时也不会漏画。
 */
export function shadowCasterMayReachViewport(data, viewport, currentLength = 0) {
    if (!viewport || !data) return true;
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    const includePoint = (point) => {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
        left = Math.min(left, point.x);
        right = Math.max(right, point.x);
        top = Math.min(top, point.y);
        bottom = Math.max(bottom, point.y);
    };
    for (const point of data.footprintVertices || []) includePoint(point);
    for (const part of data.shadowCasterParts || []) {
        for (const point of part?.vertices || []) includePoint(point);
    }
    const x = Number(data.x);
    const y = Number(data.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
        const halfW = Math.max(1, Number(data.footprintWidth) * 0.5 || Number(data.radius) || 1);
        const halfH = Math.max(1, Number(data.footprintHeight) * 0.5 || Number(data.radius) || 1);
        includePoint({ x: x - halfW, y: y - halfH });
        includePoint({ x: x + halfW, y: y + halfH });
    }
    const sprite = data.sourceSprite;
    if (sprite && Number.isFinite(sprite.x) && Number.isFinite(sprite.y)) {
        // 用包围圆而非 origin/rotation 细算，宁可少裁一点也不能漏掉旋转或脚点偏移素材。
        const width = Math.max(Number(sprite.displayWidth) || 0, Number(sprite.width) || 0);
        const height = Math.max(Number(sprite.displayHeight) || 0, Number(sprite.height) || 0);
        const radius = Math.hypot(width, height) * 0.5;
        includePoint({ x: sprite.x - radius, y: sprite.y - radius });
        includePoint({ x: sprite.x + radius, y: sprite.y + radius });
    }
    if (left === Infinity) return true;
    const reach = Math.max(
        0,
        Number(currentLength) || 0,
        Number(data.maxOffset) || 0
    ) + 8;
    return right + reach >= viewport.left && left - reach <= viewport.right
        && bottom + reach >= viewport.top && top - reach <= viewport.bottom;
}

/**
 * Phaser 4 Graphics.fillPoints 会在每次 render 时重新 Earcut。
 * 这里在阴影层真正变脏时预三角化，并把命令缓冲改写成 fillTriangle；
 * 稳态渲染只提交缓存三角形，不改变轮廓、羽化或太阳连续移动语义。
 */
export function appendTriangulatedShadow(graphics, points, color, alpha) {
    const polygon = sanitizePolygon(points);
    if (!graphics || polygon.length < 3 || !(alpha > 0)) {
        return { paths: 0, triangles: 0, sourceVertices: polygon.length };
    }
    const coordinates = [];
    for (const point of polygon) coordinates.push(point.x, point.y);
    const indices = Geom.Polygon.Earcut(coordinates);
    graphics.fillStyle(color, alpha);
    let triangles = 0;
    for (let index = 0; index + 2 < indices.length; index += 3) {
        const a = polygon[indices[index]];
        const b = polygon[indices[index + 1]];
        const c = polygon[indices[index + 2]];
        if (!a || !b || !c) continue;
        graphics.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
        triangles += 1;
    }
    return { paths: 1, triangles, sourceVertices: polygon.length };
}
