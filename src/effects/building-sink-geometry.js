import { isoFootprintVertices } from '../physics/iso-footprint.js';

function buildingSinkGroundLine(entity, sprite = null, content = null) {
    const override = Number(entity?.sinkGroundY);
    if (Number.isFinite(override)) return override;
    const offset = Number(entity?.sinkGroundOffsetY ?? entity?.spriteCfg?.sinkGroundOffsetY) || 0;
    if (sprite && content) {
        const originY = Number.isFinite(sprite.originY) ? sprite.originY : 0.5;
        const frameTopY = sprite._sinkBaseY - content.displayH * originY;
        return frameTopY + content.bottomOffset + offset;
    }
    if (entity?.sinkGroundMode === 'footprint-front') {
        const vertices = isoFootprintVertices(entity).filter((point) => Number.isFinite(point?.y));
        const frontY = vertices.length ? Math.max(...vertices.map((point) => point.y)) : Number(entity?.y);
        return (Number.isFinite(frontY) ? frontY : 0) + offset;
    }
    return (Number(entity?.y) || 0) + offset;
}

function buildingSinkCropHeight({
    groundY,
    spriteBaseY,
    displayH,
    originY = 0.5,
    frameH,
    bottomTexel,
    sinkPx,
}) {
    if (!(displayH > 0) || !(frameH > 0)) return 0;
    const frameTopY = spriteBaseY - displayH * originY + sinkPx;
    const visibleFrameWorldH = Math.max(0, groundY - frameTopY);
    return Math.max(0, Math.min(bottomTexel, visibleFrameWorldH / displayH * frameH));
}

function buildingSinkFootprintProjection(entity) {
    const vertices = isoFootprintVertices(entity)
        .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
        .map((point) => ({ x: point.x, y: point.y, key: point.key }));
    if (vertices.length < 3) return null;
    const center = vertices.reduce((sum, point) => ({
        x: sum.x + point.x / vertices.length,
        y: sum.y + point.y / vertices.length,
    }), { x: 0, y: 0 });
    const xs = vertices.map((point) => point.x);
    const ys = vertices.map((point) => point.y);
    let area2 = 0;
    for (let index = 0; index < vertices.length; index++) {
        const a = vertices[index];
        const b = vertices[(index + 1) % vertices.length];
        area2 += a.x * b.y - b.x * a.y;
    }
    return {
        vertices,
        center,
        bounds: {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys),
        },
        area: Math.abs(area2) * 0.5,
    };
}

function buildingSinkOcclusionPolygon(projection, bottomY, visualBounds = null) {
    if (!projection?.vertices?.length) return [];
    const vertices = projection.vertices;
    let left = vertices.find((point) => point.key === 'left');
    let front = vertices.find((point) => point.key === 'front');
    let right = vertices.find((point) => point.key === 'right');
    if (!left) left = vertices.reduce((best, point) => point.x < best.x ? point : best, vertices[0]);
    if (!right) right = vertices.reduce((best, point) => point.x > best.x ? point : best, vertices[0]);
    if (!front) front = vertices.reduce((best, point) => point.y > best.y ? point : best, vertices[0]);
    const chain = [left, front, right]
        .filter((point, index, list) => list.indexOf(point) === index)
        .sort((a, b) => a.x - b.x)
        .map((point) => ({ x: point.x, y: point.y }));
    if (chain.length < 2) return [];
    const extendToX = (a, b, x) => {
        const dx = b.x - a.x;
        const t = Math.abs(dx) > 1e-6 ? (x - a.x) / dx : 0;
        return { x, y: a.y + (b.y - a.y) * t };
    };
    const extendedChain = chain.slice();
    const first = chain[0];
    const last = chain[chain.length - 1];
    const minVisualX = Number(visualBounds?.minX);
    const maxVisualX = Number(visualBounds?.maxX);
    if (Number.isFinite(minVisualX) && minVisualX < first.x) {
        extendedChain.unshift(extendToX(first, chain[1], minVisualX));
    }
    if (Number.isFinite(maxVisualX) && maxVisualX > last.x) {
        extendedChain.push(extendToX(last, chain[chain.length - 2], maxVisualX));
    }
    const extendedFirst = extendedChain[0];
    const extendedLast = extendedChain[extendedChain.length - 1];
    return [
        ...extendedChain,
        { x: extendedLast.x, y: bottomY },
        { x: extendedFirst.x, y: bottomY },
    ];
}

function scaleSinkPolygon(vertices, center, scale) {
    return vertices.map((point) => ({
        x: center.x + (point.x - center.x) * scale,
        y: center.y + (point.y - center.y) * scale,
    }));
}

function pointInSinkPolygon(x, y, vertices) {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const a = vertices[i];
        const b = vertices[j];
        const crosses = ((a.y > y) !== (b.y > y))
            && x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1e-9) + a.x;
        if (crosses) inside = !inside;
    }
    return inside;
}

export {
    buildingSinkCropHeight,
    buildingSinkFootprintProjection,
    buildingSinkGroundLine,
    buildingSinkOcclusionPolygon,
    pointInSinkPolygon,
    scaleSinkPolygon,
};
