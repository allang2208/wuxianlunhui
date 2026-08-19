// ============================================================
// 等距地面旋转矩形（屏幕投影为菱形）
//
// 地面正交坐标 u/v 分别沿屏幕右下、左下两条 30° 地板轴。
// 先把屏幕 Y 按透视比例还原，再旋转 45°，即可在 u/v 空间使用普通 AABB 运算。
// ============================================================
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';

const INV_SQRT2 = Math.SQRT1_2;

function _hasPixelFootprint(entity) {
    return Array.isArray(entity?._pixelFootprintLocal) && entity._pixelFootprintLocal.length >= 3;
}

function _flatPoint(point) {
    return { x: point.x, y: point.y / PERSPECTIVE_SCALE_Y };
}

function _flatVertices(entity) {
    return isoFootprintVertices(entity).map(_flatPoint);
}

function _pointInPolygon(point, vertices) {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const a = vertices[i], b = vertices[j];
        const crosses = ((a.y > point.y) !== (b.y > point.y))
            && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-9) + a.x;
        if (crosses) inside = !inside;
    }
    return inside;
}

function _closestPointOnSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 1e-9
        ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq))
        : 0;
    return { x: a.x + dx * t, y: a.y + dy * t };
}

function _closestPolygonBoundary(point, vertices) {
    let best = null;
    for (let i = 0; i < vertices.length; i++) {
        const q = _closestPointOnSegment(point, vertices[i], vertices[(i + 1) % vertices.length]);
        const dx = point.x - q.x;
        const dy = point.y - q.y;
        const distSq = dx * dx + dy * dy;
        if (!best || distSq < best.distSq) best = { point: q, distSq, edge: i };
    }
    return best;
}

function _polygonDistance(point, vertices) {
    if (_pointInPolygon(point, vertices)) return 0;
    return Math.sqrt(_closestPolygonBoundary(point, vertices)?.distSq ?? Infinity);
}

function _polygonAxes(vertices) {
    const axes = [];
    for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i], b = vertices[(i + 1) % vertices.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-6) axes.push({ x: -dy / len, y: dx / len });
    }
    return axes;
}

function _projectPolygon(vertices, axis) {
    let min = Infinity;
    let max = -Infinity;
    for (const p of vertices) {
        const value = p.x * axis.x + p.y * axis.y;
        min = Math.min(min, value);
        max = Math.max(max, value);
    }
    return { min, max };
}

export function worldDeltaToIsoLocal(dx, dy) {
    const flatY = dy / PERSPECTIVE_SCALE_Y;
    return {
        u: (dx + flatY) * INV_SQRT2,
        v: (-dx + flatY) * INV_SQRT2,
    };
}

export function isoLocalToWorldDelta(u, v) {
    return {
        x: (u - v) * INV_SQRT2,
        y: (u + v) * INV_SQRT2 * PERSPECTIVE_SCALE_Y,
    };
}

export function isoFootprintHalfExtents(entity) {
    if (_hasPixelFootprint(entity)) {
        const c = isoFootprintCenter(entity);
        let halfU = 1;
        let halfV = 1;
        for (const point of isoFootprintVertices(entity)) {
            const local = worldDeltaToIsoLocal(point.x - c.x, point.y - c.y);
            halfU = Math.max(halfU, Math.abs(local.u));
            halfV = Math.max(halfV, Math.abs(local.v));
        }
        return { halfU, halfV };
    }
    const fallback = Math.max(1, Number(entity?.collisionWidth) || 1) * 0.5 * INV_SQRT2;
    return {
        halfU: Math.max(1, Number(entity?.collisionIsoHalfU) || fallback),
        halfV: Math.max(1, Number(entity?.collisionIsoHalfV) || fallback),
    };
}

export function isoFootprintCenter(entity) {
    // 逻辑坐标 + colliderOffset 才是 footprint 真源。建筑构造时通常先由 super()
    // 建出旧圆形 Collider，再切换为 iso_rect，最后才 rebuildCollider；若优先读旧
    // collider，构造期间的 footprint/深度会按过期中心计算（2×2 错 64px、4×4 错 128px）。
    const hasLogicalPosition = Number.isFinite(entity?.x) && Number.isFinite(entity?.y);
    if (hasLogicalPosition) {
        return {
            x: entity.x + (Number(entity.colliderOffsetX) || 0),
            y: entity.y + (Number(entity.colliderOffsetY) || 0),
        };
    }
    return {
        x: entity?.collider?.x || 0,
        y: entity?.collider?.y || 0,
    };
}

export function isoFootprintVertices(entity) {
    if (_hasPixelFootprint(entity)) {
        const ex = Number(entity?.x) || 0;
        const ey = Number(entity?.y) || 0;
        return entity._pixelFootprintLocal.map((point, index) => ({
            x: ex + (Number(point.x) || 0),
            y: ey + (Number(point.y) || 0),
            key: point.key || ['back', 'right', 'front', 'left'][index] || String(index),
        }));
    }
    const c = isoFootprintCenter(entity);
    const { halfU, halfV } = isoFootprintHalfExtents(entity);
    return [
        { ...isoLocalToWorldDelta(-halfU, -halfV), key: 'back' },
        { ...isoLocalToWorldDelta(halfU, -halfV), key: 'right' },
        { ...isoLocalToWorldDelta(halfU, halfV), key: 'front' },
        { ...isoLocalToWorldDelta(-halfU, halfV), key: 'left' },
    ].map((p) => ({ x: c.x + p.x, y: c.y + p.y, key: p.key }));
}

/** 用一条地面中心线 + 半厚配置沿 u/v 轴的旋转矩形。 */
export function applyIsoFootprintFromSegment(entity, a, b, halfThickness) {
    if (!entity || !a || !b) return entity;
    const centerX = (a.x + b.x) / 2;
    const centerY = (a.y + b.y) / 2;
    const axis = worldDeltaToIsoLocal(b.x - a.x, b.y - a.y);
    const halfLength = Math.hypot(axis.u, axis.v) / 2;
    const thick = Math.max(1, Number(halfThickness) || 1);
    const alongU = Math.abs(axis.u) >= Math.abs(axis.v);
    entity.collisionShape = 'iso_rect';
    entity.collisionIsoHalfU = alongU ? halfLength : thick;
    entity.collisionIsoHalfV = alongU ? thick : halfLength;
    const screenHalfW = (entity.collisionIsoHalfU + entity.collisionIsoHalfV) * INV_SQRT2;
    entity.collisionWidth = screenHalfW * 2;
    entity.collisionHeight = screenHalfW * 2 * PERSPECTIVE_SCALE_Y;
    entity.collisionRadius = Math.hypot(entity.collisionIsoHalfU, entity.collisionIsoHalfV);
    entity.colliderOffsetX = centerX - (entity.x || 0);
    entity.colliderOffsetY = centerY - (entity.y || 0);
    return entity;
}

export function pointInIsoFootprint(x, y, entity, margin = 0) {
    if (_hasPixelFootprint(entity)) {
        const point = _flatPoint({ x, y });
        const vertices = _flatVertices(entity);
        return _pointInPolygon(point, vertices)
            || (margin > 0 && _polygonDistance(point, vertices) <= margin);
    }
    const c = isoFootprintCenter(entity);
    const p = worldDeltaToIsoLocal(x - c.x, y - c.y);
    const { halfU, halfV } = isoFootprintHalfExtents(entity);
    return Math.abs(p.u) <= halfU + margin && Math.abs(p.v) <= halfV + margin;
}

export function distanceToIsoFootprint(x, y, entity) {
    if (_hasPixelFootprint(entity)) {
        return _polygonDistance(_flatPoint({ x, y }), _flatVertices(entity));
    }
    const c = isoFootprintCenter(entity);
    const p = worldDeltaToIsoLocal(x - c.x, y - c.y);
    const { halfU, halfV } = isoFootprintHalfExtents(entity);
    const qU = Math.max(-halfU, Math.min(halfU, p.u));
    const qV = Math.max(-halfV, Math.min(halfV, p.v));
    return Math.hypot(p.u - qU, p.v - qV);
}

export function circleIntersectsIsoFootprint(x, y, radius, entity) {
    if (_hasPixelFootprint(entity)) {
        return _polygonDistance(_flatPoint({ x, y }), _flatVertices(entity)) < radius;
    }
    const c = isoFootprintCenter(entity);
    const p = worldDeltaToIsoLocal(x - c.x, y - c.y);
    const { halfU, halfV } = isoFootprintHalfExtents(entity);
    const qU = Math.max(-halfU, Math.min(halfU, p.u));
    const qV = Math.max(-halfV, Math.min(halfV, p.v));
    return Math.hypot(p.u - qU, p.v - qV) < radius;
}

/** 两个同地面轴旋转矩形是否重叠。 */
export function isoFootprintsOverlap(a, b, gap = 0) {
    if (_hasPixelFootprint(a) || _hasPixelFootprint(b)) {
        const av = _flatVertices(a);
        const bv = _flatVertices(b);
        for (const axis of [..._polygonAxes(av), ..._polygonAxes(bv)]) {
            const pa = _projectPolygon(av, axis);
            const pb = _projectPolygon(bv, axis);
            const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
            if (overlap <= -gap) return false;
        }
        return true;
    }
    const ca = isoFootprintCenter(a);
    const cb = isoFootprintCenter(b);
    const delta = worldDeltaToIsoLocal(cb.x - ca.x, cb.y - ca.y);
    const ea = isoFootprintHalfExtents(a);
    const eb = isoFootprintHalfExtents(b);
    return Math.abs(delta.u) < ea.halfU + eb.halfU + gap
        && Math.abs(delta.v) < ea.halfV + eb.halfV + gap;
}

/**
 * 计算把圆推出等距地面矩形所需的最短世界位移。
 * @returns {{x:number,y:number}|null}
 */
export function resolveCircleFromIsoFootprint(x, y, radius, entity) {
    if (_hasPixelFootprint(entity)) {
        const point = _flatPoint({ x, y });
        const vertices = _flatVertices(entity);
        const inside = _pointInPolygon(point, vertices);
        const closest = _closestPolygonBoundary(point, vertices);
        if (!closest) return null;
        const dist = Math.sqrt(closest.distSq);
        if (!inside && dist >= radius) return null;
        let dx;
        let dy;
        if (dist > 1e-6) {
            if (inside) {
                const amount = dist + radius;
                dx = (closest.point.x - point.x) / dist * amount;
                dy = (closest.point.y - point.y) / dist * amount;
            } else {
                const amount = radius - dist;
                dx = (point.x - closest.point.x) / dist * amount;
                dy = (point.y - closest.point.y) / dist * amount;
            }
        } else {
            const a = vertices[closest.edge];
            const b = vertices[(closest.edge + 1) % vertices.length];
            const ex = b.x - a.x;
            const ey = b.y - a.y;
            const len = Math.hypot(ex, ey) || 1;
            dx = -ey / len * radius;
            dy = ex / len * radius;
        }
        return { x: dx, y: dy * PERSPECTIVE_SCALE_Y };
    }
    const c = isoFootprintCenter(entity);
    const p = worldDeltaToIsoLocal(x - c.x, y - c.y);
    const { halfU, halfV } = isoFootprintHalfExtents(entity);
    const qU = Math.max(-halfU, Math.min(halfU, p.u));
    const qV = Math.max(-halfV, Math.min(halfV, p.v));
    let du = p.u - qU;
    let dv = p.v - qV;
    const dist = Math.hypot(du, dv);
    if (dist >= radius) return null;

    if (dist > 1e-6) {
        const push = radius - dist;
        du = du / dist * push;
        dv = dv / dist * push;
    } else {
        // 圆心在矩形内部：选择到最近边的最短推出方向。
        const toU = halfU - Math.abs(p.u);
        const toV = halfV - Math.abs(p.v);
        if (toU <= toV) {
            du = (p.u >= 0 ? 1 : -1) * (toU + radius);
            dv = 0;
        } else {
            du = 0;
            dv = (p.v >= 0 ? 1 : -1) * (toV + radius);
        }
    }
    return isoLocalToWorldDelta(du, dv);
}
