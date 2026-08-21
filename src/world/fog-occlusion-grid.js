import { WallSystem } from './wall-system.js';
import { isoFootprintVertices, pointInIsoFootprint } from '../physics/iso-footprint.js';
import { entitySurfaceZ } from '../physics/elevation.js';

function positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pointSegmentDistanceSq(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 1e-6) return (px - x1) ** 2 + (py - y1) ** 2;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
    const sx = x1 + dx * t;
    const sy = y1 + dy * t;
    return (px - sx) ** 2 + (py - sy) ** 2;
}

function orientation(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function pointOnSegment(px, py, ax, ay, bx, by) {
    const epsilon = 1e-6;
    return px >= Math.min(ax, bx) - epsilon && px <= Math.max(ax, bx) + epsilon
        && py >= Math.min(ay, by) - epsilon && py <= Math.max(ay, by) + epsilon;
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const abC = orientation(ax, ay, bx, by, cx, cy);
    const abD = orientation(ax, ay, bx, by, dx, dy);
    const cdA = orientation(cx, cy, dx, dy, ax, ay);
    const cdB = orientation(cx, cy, dx, dy, bx, by);
    if (((abC < 0 && abD > 0) || (abC > 0 && abD < 0))
        && ((cdA < 0 && cdB > 0) || (cdA > 0 && cdB < 0))) return true;
    const epsilon = 1e-6;
    if (Math.abs(abC) <= epsilon && pointOnSegment(cx, cy, ax, ay, bx, by)) return true;
    if (Math.abs(abD) <= epsilon && pointOnSegment(dx, dy, ax, ay, bx, by)) return true;
    if (Math.abs(cdA) <= epsilon && pointOnSegment(ax, ay, cx, cy, dx, dy)) return true;
    return Math.abs(cdB) <= epsilon && pointOnSegment(bx, by, cx, cy, dx, dy);
}

function segmentSegmentDistanceSq(ax, ay, bx, by, cx, cy, dx, dy) {
    if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
    return Math.min(
        pointSegmentDistanceSq(ax, ay, cx, cy, dx, dy),
        pointSegmentDistanceSq(bx, by, cx, cy, dx, dy),
        pointSegmentDistanceSq(cx, cy, ax, ay, bx, by),
        pointSegmentDistanceSq(dx, dy, ax, ay, bx, by)
    );
}

function finitePositive(values, fallback) {
    for (const value of values) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return fallback;
}

function snapshotNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function segmentTopZ(segment, config) {
    const owner = segment?._owner;
    const explicitTop = finitePositive([
        segment?.fogVisionBlockerHeight,
        owner?.fogVisionBlockerHeight,
        owner?._wallTopZ,
        segment?.height,
    ], 0);
    if (explicitTop > 0) return explicitTop;
    const surfaceTop = Math.max(Number(segment?._surfaceZ1) || 0, Number(segment?._surfaceZ2) || 0);
    return surfaceTop + positiveNumber(config.defaultWallHeight, 80);
}

function structureTopZ(entity, config) {
    const explicitTop = Number(entity?.fogVisionBlockerHeight ?? entity?.config?.fogVisionBlockerHeight);
    if (Number.isFinite(explicitTop) && explicitTop > 0) return explicitTop;
    const bodyHeight = finitePositive([
        entity?.collisionBodyHeight,
        entity?.spriteCfg?.sizeH,
        entity?.config?.render?.spriteSize,
        entity?.config?.height,
        entity?.bodyHeight,
        entity?.collider?.height,
    ], positiveNumber(config.defaultStructureHeight, 160));
    return entitySurfaceZ(entity) + bodyHeight;
}

function observerEyeZ(entity, config) {
    const explicit = Number(entity?.fogVisionEyeZ ?? entity?.config?.fogVisionEyeZ);
    if (Number.isFinite(explicit)) return explicit;
    const explicitHeight = Number(entity?.fogVisionEyeHeight ?? entity?.config?.fogVisionEyeHeight);
    const bodyHeight = finitePositive([
        entity?.bodyHeight,
        entity?.collisionBodyHeight,
        entity?.collider?.height,
        entity?.size ? Number(entity.size) * 2 : 0,
    ], positiveNumber(config.observerEyeHeightFallback, 56));
    const eyeHeight = Number.isFinite(explicitHeight) && explicitHeight > 0
        ? explicitHeight
        : Math.max(
            positiveNumber(config.observerEyeHeightFallback, 56),
            bodyHeight * positiveNumber(config.observerEyeHeightRatio, 0.72)
        );
    return entitySurfaceZ(entity) + eyeHeight;
}

function addIgnoredWall(ignored, wall) {
    if (!wall) return;
    ignored.add(wall);
    if (wall._wallRect) ignored.add(wall._wallRect);
    if (wall._coverSeg) ignored.add(wall._coverSeg);
    if (wall._gateSeg) ignored.add(wall._gateSeg);
}

function sourceOcclusionContext(state, entity, config = {}) {
    const x = Number(entity?.x);
    const y = Number(entity?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const ignoredBlockers = new Set([entity]);
    if (entity?._surfaceKind === 'wall_walk') addIgnoredWall(ignoredBlockers, entity?._surfaceWall);
    if (entity?._surfaceKind === 'stairs' && entity?._surfaceStaircase) {
        ignoredBlockers.add(entity._surfaceStaircase);
    }
    return {
        x,
        y,
        originColumn: Math.floor(x / state.cellSize),
        originRow: Math.floor(y / state.cellSize),
        eyeZ: observerEyeZ(entity, config),
        heightClearance: Math.max(0, Number(config.heightClearance) || 0),
        ignoredBlockers,
    };
}

function isOpaqueBlocker(blocker, context) {
    if (!blocker) return false;
    if (context?.ignoredBlockers?.has(blocker.source)
        || context?.ignoredBlockers?.has(blocker.owner)) return false;
    if (!context || !Number.isFinite(context.eyeZ)) return true;
    return context.eyeZ <= blocker.topZ + context.heightClearance;
}

function segmentSnapshotChanged(snapshot, segments) {
    if (!Array.isArray(snapshot) || snapshot.length !== segments.length) return true;
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const previous = snapshot[index];
        const owner = segment?._owner;
        if (!previous || previous.segment !== segment
            || previous.x1 !== snapshotNumber(segment?.x1) || previous.y1 !== snapshotNumber(segment?.y1)
            || previous.x2 !== snapshotNumber(segment?.x2) || previous.y2 !== snapshotNumber(segment?.y2)
            || previous.halfThick !== snapshotNumber(segment?.halfThick)
            || previous.height !== snapshotNumber(segment?.height)
            || previous.blockerHeight !== snapshotNumber(segment?.fogVisionBlockerHeight)
            || previous.surfaceZ1 !== snapshotNumber(segment?._surfaceZ1)
            || previous.surfaceZ2 !== snapshotNumber(segment?._surfaceZ2)
            || previous.owner !== owner || previous.ownerActive !== owner?.active
            || previous.ownerSinking !== owner?._sinking
            || previous.ownerTopZ !== snapshotNumber(owner?._wallTopZ)
            || previous.ownerBlockerHeight !== snapshotNumber(owner?.fogVisionBlockerHeight)) return true;
    }
    return false;
}

function snapshotSegments(segments) {
    return segments.map((segment) => ({
        segment,
        x1: snapshotNumber(segment?.x1),
        y1: snapshotNumber(segment?.y1),
        x2: snapshotNumber(segment?.x2),
        y2: snapshotNumber(segment?.y2),
        halfThick: snapshotNumber(segment?.halfThick),
        height: snapshotNumber(segment?.height),
        blockerHeight: snapshotNumber(segment?.fogVisionBlockerHeight),
        surfaceZ1: snapshotNumber(segment?._surfaceZ1),
        surfaceZ2: snapshotNumber(segment?._surfaceZ2),
        owner: segment?._owner,
        ownerActive: segment?._owner?.active,
        ownerSinking: segment?._owner?._sinking,
        ownerTopZ: snapshotNumber(segment?._owner?._wallTopZ),
        ownerBlockerHeight: snapshotNumber(segment?._owner?.fogVisionBlockerHeight),
    }));
}

function isStructureBlocker(entity) {
    if (!entity || entity.active === false || entity._sinking || entity.fogVisionBlocker === false) return false;
    if (entity.fogVisionBlocker === true) return true;
    if (entity._isDefenseCover || entity._isCoverGate || entity._isWallStaircase) return false;
    return !!(
        entity._isDefenseStructure
        || entity._isDefenseTower
        || entity._isProducerBuilding
        || entity._isHamsterHut
        || entity._isHamsterBarracks
        || entity._isWorldPortalCore
        || entity._isMainHubPortalBuilding
    );
}

function structureSnapshotChanged(snapshot) {
    if (!Array.isArray(snapshot)) return true;
    return snapshot.some((previous) => {
        const entity = previous.entity;
        return !isStructureBlocker(entity)
            || previous.x !== snapshotNumber(entity?.x)
            || previous.y !== snapshotNumber(entity?.y)
            || previous.z !== snapshotNumber(entity?.z)
            || previous.width !== snapshotNumber(entity?.collisionWidth)
            || previous.height !== snapshotNumber(entity?.collisionHeight)
            || previous.radius !== snapshotNumber(entity?.collisionRadius)
            || previous.groundRadius !== snapshotNumber(entity?.groundRadius)
            || previous.bodyHeight !== snapshotNumber(entity?.collisionBodyHeight)
            || previous.blockerHeight !== snapshotNumber(
                entity?.fogVisionBlockerHeight ?? entity?.config?.fogVisionBlockerHeight
            );
    });
}

function snapshotStructures(entities) {
    if (!entities || typeof entities.values !== 'function') return [];
    const result = [];
    for (const entity of entities.values()) {
        if (!isStructureBlocker(entity)) continue;
        result.push({
            entity,
            x: snapshotNumber(entity?.x),
            y: snapshotNumber(entity?.y),
            z: snapshotNumber(entity?.z),
            width: snapshotNumber(entity?.collisionWidth),
            height: snapshotNumber(entity?.collisionHeight),
            radius: snapshotNumber(entity?.collisionRadius),
            groundRadius: snapshotNumber(entity?.groundRadius),
            bodyHeight: snapshotNumber(entity?.collisionBodyHeight),
            blockerHeight: snapshotNumber(
                entity?.fogVisionBlockerHeight ?? entity?.config?.fogVisionBlockerHeight
            ),
        });
    }
    return result;
}

function markCell(record, column, row, blocker) {
    if (column < 0 || row < 0 || column >= record.columns || row >= record.rows) return;
    const index = row * record.columns + column;
    record.nextBlocked[index] = 1;
    record.nextBlockerHeights[index] = Math.max(record.nextBlockerHeights[index], blocker.topZ);
    if (record.nextCellBlockers[index]) record.nextCellBlockers[index].push(blocker);
    else record.nextCellBlockers[index] = [blocker];
}

function markSegment(record, segment, padding, config) {
    if (segment?._gateHole && config.gateDoorsBlockVision !== true) return false;
    const x1 = Number(segment?.x1);
    const y1 = Number(segment?.y1);
    const x2 = Number(segment?.x2);
    const y2 = Number(segment?.y2);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return false;
    const owner = segment?._owner;
    if (owner && (owner.active === false || owner._sinking)) return false;
    const radius = Math.max(1, Number(segment.halfThick) || 0) + padding;
    const blocker = {
        kind: 'segment',
        source: segment,
        owner,
        topZ: segmentTopZ(segment, config),
        x1,
        y1,
        x2,
        y2,
        radius: Math.max(1, Number(segment.halfThick) || 0),
    };
    const minColumn = Math.max(0, Math.floor((Math.min(x1, x2) - radius) / record.cellSize));
    const maxColumn = Math.min(record.columns - 1, Math.floor((Math.max(x1, x2) + radius) / record.cellSize));
    const minRow = Math.max(0, Math.floor((Math.min(y1, y2) - radius) / record.cellSize));
    const maxRow = Math.min(record.rows - 1, Math.floor((Math.max(y1, y2) + radius) / record.cellSize));
    const radiusSq = radius * radius;
    for (let row = minRow; row <= maxRow; row += 1) {
        const cy = (row + 0.5) * record.cellSize;
        for (let column = minColumn; column <= maxColumn; column += 1) {
            const cx = (column + 0.5) * record.cellSize;
            if (pointSegmentDistanceSq(cx, cy, x1, y1, x2, y2) <= radiusSq) {
                markCell(record, column, row, blocker);
            }
        }
    }
    return true;
}

function markStructure(record, entity, padding, config) {
    const x = Number(entity.x) + (Number(entity.colliderOffsetX) || 0);
    const y = Number(entity.y) + (Number(entity.colliderOffsetY) || 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const width = Number(entity.collisionWidth);
    const height = Number(entity.collisionHeight);
    const radius = Math.max(0, Number(entity.groundRadius) || 0, Number(entity.collisionRadius) || 0);
    const halfW = Number.isFinite(width) && width > 0 ? width * 0.5 : radius;
    const halfH = Number.isFinite(height) && height > 0 ? height * 0.5 : radius;
    if (halfW <= 0 && halfH <= 0) return false;
    const vertices = entity.collisionShape === 'iso_rect' ? isoFootprintVertices(entity) : null;
    const xs = vertices?.map((point) => point.x);
    const ys = vertices?.map((point) => point.y);
    const minX = xs?.length ? Math.min(...xs) : x - halfW;
    const maxX = xs?.length ? Math.max(...xs) : x + halfW;
    const minY = ys?.length ? Math.min(...ys) : y - halfH;
    const maxY = ys?.length ? Math.max(...ys) : y + halfH;
    const minColumn = Math.max(0, Math.floor((minX - padding) / record.cellSize));
    const maxColumn = Math.min(record.columns - 1, Math.floor((maxX + padding) / record.cellSize));
    const minRow = Math.max(0, Math.floor((minY - padding) / record.cellSize));
    const maxRow = Math.min(record.rows - 1, Math.floor((maxY + padding) / record.cellSize));
    const blocker = {
        kind: 'structure',
        source: entity,
        owner: entity,
        topZ: structureTopZ(entity, config),
        vertices,
        minX: x - halfW,
        maxX: x + halfW,
        minY: y - halfH,
        maxY: y + halfH,
    };
    for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
            const cx = (column + 0.5) * record.cellSize;
            const cy = (row + 0.5) * record.cellSize;
            if (!vertices || pointInIsoFootprint(cx, cy, entity, padding)) {
                markCell(record, column, row, blocker);
            }
        }
    }
    return true;
}

function pointInPolygon(x, y, vertices) {
    let inside = false;
    for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
        const a = vertices[index];
        const b = vertices[previous];
        if (((a.y > y) !== (b.y > y))
            && x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 1e-9) + a.x) inside = !inside;
    }
    return inside;
}

function rayIntersectsStructure(x1, y1, x2, y2, blocker) {
    const vertices = blocker.vertices || [
        { x: blocker.minX, y: blocker.minY },
        { x: blocker.maxX, y: blocker.minY },
        { x: blocker.maxX, y: blocker.maxY },
        { x: blocker.minX, y: blocker.maxY },
    ];
    if (pointInPolygon(x1, y1, vertices) || pointInPolygon(x2, y2, vertices)) return true;
    for (let index = 0; index < vertices.length; index += 1) {
        const a = vertices[index];
        const b = vertices[(index + 1) % vertices.length];
        if (segmentsIntersect(x1, y1, x2, y2, a.x, a.y, b.x, b.y)) return true;
    }
    return false;
}

function rayIntersectsBlocker(x1, y1, x2, y2, blocker) {
    if (blocker.kind === 'segment') {
        return segmentSegmentDistanceSq(
            x1, y1, x2, y2,
            blocker.x1, blocker.y1, blocker.x2, blocker.y2
        ) <= blocker.radius * blocker.radius;
    }
    return blocker.kind === 'structure' && rayIntersectsStructure(x1, y1, x2, y2, blocker);
}

export const FogOcclusionGrid = {
    _records: new Map(),

    resetScene(sceneId) {
        this._records.delete(sceneId);
    },

    sync(sceneId, state, game, nowMs = Date.now(), options = {}) {
        if (!state) return null;
        const config = options.config || {};
        if (config.enabled === false) {
            this._records.delete(sceneId);
            return null;
        }
        let record = this._records.get(sceneId);
        if (!record || record.columns !== state.columns || record.rows !== state.rows || record.cellSize !== state.cellSize) {
            record = {
                columns: state.columns,
                rows: state.rows,
                cellSize: state.cellSize,
                blocked: new Uint8Array(state.columns * state.rows),
                nextBlocked: new Uint8Array(state.columns * state.rows),
                blockerHeights: new Float32Array(state.columns * state.rows),
                nextBlockerHeights: new Float32Array(state.columns * state.rows),
                cellBlockers: new Array(state.columns * state.rows).fill(null),
                nextCellBlockers: new Array(state.columns * state.rows).fill(null),
                revision: 0,
                nextRebuildAt: 0,
                lastEntityMap: null,
                lastEntityCount: -1,
                segmentSnapshot: null,
                structureSnapshot: null,
                blockerCount: 0,
                blockedCells: 0,
                maxBlockerHeight: 0,
                durationMs: 0,
            };
            this._records.set(sceneId, record);
        }
        const now = Number.isFinite(nowMs) ? nowMs : Date.now();
        const entities = game?.entities || null;
        const segments = Array.isArray(WallSystem?.isoSegments) ? WallSystem.isoSegments : [];
        const needsRebuild = options.force
            || entities !== record.lastEntityMap
            || (entities?.size ?? 0) !== record.lastEntityCount
            || segmentSnapshotChanged(record.segmentSnapshot, segments)
            || structureSnapshotChanged(record.structureSnapshot)
            || now >= record.nextRebuildAt;
        if (!needsRebuild) return record;

        const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        record.nextBlocked.fill(0);
        record.nextBlockerHeights.fill(0);
        record.nextCellBlockers.fill(null);
        const padding = record.cellSize * Math.max(0, Math.min(1, Number(config.cellPaddingRatio) || 0.5));
        let blockerCount = 0;
        for (const segment of segments) {
            if (markSegment(record, segment, padding, config)) blockerCount += 1;
        }
        if (entities && typeof entities.values === 'function') {
            for (const entity of entities.values()) {
                if (isStructureBlocker(entity)
                    && markStructure(record, entity, padding * 0.5, config)) blockerCount += 1;
            }
        }

        let blockedCells = 0;
        let maxBlockerHeight = 0;
        for (let i = 0; i < record.nextBlocked.length; i += 1) {
            if (record.nextBlocked[i]) blockedCells += 1;
            maxBlockerHeight = Math.max(maxBlockerHeight, record.nextBlockerHeights[i]);
        }
        [record.blocked, record.nextBlocked] = [record.nextBlocked, record.blocked];
        [record.blockerHeights, record.nextBlockerHeights] = [record.nextBlockerHeights, record.blockerHeights];
        [record.cellBlockers, record.nextCellBlockers] = [record.nextCellBlockers, record.cellBlockers];
        record.revision += 1;
        record.lastEntityMap = entities;
        record.lastEntityCount = entities?.size ?? 0;
        record.segmentSnapshot = snapshotSegments(segments);
        record.structureSnapshot = snapshotStructures(entities);
        record.nextRebuildAt = now + positiveNumber(config.rebuildIntervalMs, 500);
        record.blockerCount = blockerCount;
        record.blockedCells = blockedCells;
        record.maxBlockerHeight = maxBlockerHeight;
        const endedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        record.durationMs = endedAt - startedAt;
        return record;
    },

    isBlocked(record, column, row, context = null) {
        if (!record || column < 0 || row < 0 || column >= record.columns || row >= record.rows) return true;
        const index = row * record.columns + column;
        if (!record.blocked[index]) return false;
        const blockers = record.cellBlockers[index];
        return !blockers || blockers.some((blocker) => isOpaqueBlocker(blocker, context));
    },

    sourceOcclusionContext,

    rayBlockedFromOrigin(record, context, targetX, targetY) {
        if (!record || !context) return false;
        const { originColumn, originRow } = context;
        if (originColumn < 0 || originRow < 0
            || originColumn >= record.columns || originRow >= record.rows) return false;
        const blockers = record.cellBlockers[originRow * record.columns + originColumn];
        if (!blockers?.length) return false;
        return blockers.some((blocker) => isOpaqueBlocker(blocker, context)
            && rayIntersectsBlocker(context.x, context.y, targetX, targetY, blocker));
    },

    getDebugModel(sceneId) {
        const record = this._records.get(sceneId);
        if (!record) return {
            enabled: false,
            blockerCount: 0,
            blockedCells: 0,
            maxBlockerHeight: 0,
            revision: 0,
            durationMs: 0,
        };
        return {
            enabled: true,
            blockerCount: record.blockerCount,
            blockedCells: record.blockedCells,
            maxBlockerHeight: record.maxBlockerHeight,
            heightAware: true,
            revision: record.revision,
            durationMs: record.durationMs,
            blocked: record.blocked,
            blockerHeights: record.blockerHeights,
        };
    },
};

export default FogOcclusionGrid;
