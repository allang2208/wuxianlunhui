import { circleIntersectsIsoFootprint } from '../physics/iso-footprint.js';

/** Closed world-space ground polygon. Radius is the same screen-plane clearance
 * used by ordinary WallSystem boundary segments (not sprite size or roof alpha). */
export function containsWalkableCircle(area, x, y, radius = 0) {
    if (!area) return true;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const points = area.polygon;
    const clearance = Math.max(0, radius) + area.edgeInset;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[j], b = points[i];
        if ((a.y > y) !== (b.y > y)
            && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
        const dx = b.x - a.x, dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq ? Math.max(0, Math.min(1,
            ((x - a.x) * dx + (y - a.y) * dy) / lengthSq)) : 0;
        if (Math.hypot(x - a.x - t * dx, y - a.y - t * dy) < clearance) return false;
    }
    if (!inside) return false;
    // Retaining faces and column feet are solid holes, not just outlines.
    // Cheap bounds rejection keeps distant architecture out of hot point queries.
    for (const obstacle of area.obstacles) {
        if (x + radius < obstacle.minX || x - radius > obstacle.maxX
            || y + radius < obstacle.minY || y - radius > obstacle.maxY) continue;
        if (circleIntersectsIsoFootprint(x, y, Math.max(0.001, radius), obstacle.entity)) return false;
    }
    return true;
}

function clipBelow(points, baseline) {
    const result = [];
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if (a.y >= baseline) result.push(a);
        if ((a.y < baseline) !== (b.y < baseline)) {
            result.push({ x: a.x + (b.x - a.x) * (baseline - a.y) / (b.y - a.y), y: baseline });
        }
    }
    return result;
}

/** Marble plaza = diamond clipped at the backdrop's world baseline.
 * The visible rear terrace extends through that cut; its stone top remains
 * accessible while the mountains on either side are excluded. */
export function createMainHubWalkableArea(diamond, hub, entities = []) {
    if (!diamond || hub.walkableArea?.enabled !== true) return null;
    const { cx, cy, rx, ry } = diamond;
    const original = [{ x: cx, y: cy - ry }, { x: cx + rx, y: cy },
        { x: cx, y: cy + ry }, { x: cx - rx, y: cy }];
    const baseline = hub.backdrop?.enabled === true
        ? Number(hub.backdrop.baselineWorldY) : cy - ry;
    const floorPolygon = clipBelow(original, Number.isFinite(baseline) ? baseline : cy - ry);
    const polygon = [];
    const rear = hub.architecture?.enabled === true ? hub.walkableArea.rearTerrace : null;
    for (let i = 0; i < floorPolygon.length; i++) {
        const a = floorPolygon[i], b = floorPolygon[(i + 1) % floorPolygon.length];
        polygon.push(a);
        // Clockwise diamond's clipping edge travels from left to right.
        if (rear && a.y === baseline && b.y === baseline && a.x < rear.leftX
            && b.x > rear.rightX && rear.backY < baseline) {
            polygon.push({ x: rear.leftX, y: baseline },
                { x: rear.leftX, y: rear.backY },
                { x: rear.rightX, y: rear.backY },
                { x: rear.rightX, y: baseline });
        }
    }
    const obstacles = [];
    for (const entity of entities) {
        if (!entity?.active || !entity._mainHubCollisionProxy) continue;
        const points = entity._pixelFootprintLocal.map(p => ({ x: entity.x + p.x, y: entity.y + p.y }));
        obstacles.push({ entity, points,
            minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
            minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) });
    }
    return { polygon, floorPolygon, obstacles,
        edgeInset: Math.max(0, Number(hub.walkableArea.edgeInset) || 0) };
}

export function walkableBoundarySegments(area) {
    const segments = area.polygon.map((a, i) => {
        const b = area.polygon[(i + 1) % area.polygon.length];
        return { x1: a.x, y1: a.y, x2: b.x, y2: b.y,
            halfThick: area.edgeInset, noVisual: true, _boundary: true, _mainHubBoundary: true };
    });
    // Swept movement/LOS needs edges too: filled point predicates alone cannot
    // stop a dash whose start and destination are on opposite sides of a face.
    for (const obstacle of area.obstacles) {
        obstacle.points.forEach((a, i) => {
            const b = obstacle.points[(i + 1) % obstacle.points.length];
            segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y,
                halfThick: 0, noVisual: true, _boundary: true,
                _mainHubStructureEdge: true });
        });
    }
    return segments;
}
