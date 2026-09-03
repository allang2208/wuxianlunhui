/**
 * 冰原竞技场第一阶段程序化地形。
 *
 * 在冰原多房竞技场的房间墙环内部生成不可通行深渊。可同时消费规则菱形和初级
 * 雪原随机正交房型；每个房间独立生成，失败时该房间保持完整地面。
 */

import { pointInRoomShape } from './frozen-random-room-layout.js';

const FROZEN_DUNGEON_TYPES = new Set(['frozenBeginner', 'frozenMid', 'frozen']);
const GRID_CELL_W = 128;
const GRID_CELL_D = 64;
const GRID_STEP_V1 = Object.freeze({ x: GRID_CELL_W / 2, y: GRID_CELL_D / 2 });
const GRID_STEP_V2 = Object.freeze({ x: GRID_CELL_W / 2, y: -GRID_CELL_D / 2 });

const DEFAULTS = Object.freeze({
    minPits: 1,
    maxPits: 2,
    edgeInset: 220,
    safeCorridorHalfWidth: 170,
    centerReserve: 260,
});

function _normalizeSeed(value) {
    const n = Number(value);
    return Number.isFinite(n) ? (Math.floor(n) >>> 0) : 0x51f15e7d;
}

function _mixSeed(seed, value) {
    let h = (seed ^ Math.imul(value + 1, 0x9e3779b1)) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

function _mulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function _edgeMid(room, edge) {
    const opening = room?.shape?.openings?.[edge];
    if (opening?.rawA && opening?.rawB) {
        return {
            x: (opening.rawA.x + opening.rawB.x) / 2,
            y: (opening.rawA.y + opening.rawB.y) / 2,
        };
    }
    const mids = {
        LT: { x: room.cx - room.rx / 2, y: room.cy - room.ry / 2 },
        TR: { x: room.cx + room.rx / 2, y: room.cy - room.ry / 2 },
        RB: { x: room.cx + room.rx / 2, y: room.cy + room.ry / 2 },
        BL: { x: room.cx - room.rx / 2, y: room.cy + room.ry / 2 },
    };
    return mids[edge] || { x: room.cx, y: room.cy };
}

function _pointSegmentDistance(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 <= 0.0001) return Math.hypot(point.x - a.x, point.y - a.y);
    const t = Math.max(0, Math.min(1,
        ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
    return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function _insideInsetDiamond(point, room, inset) {
    return pointInRoomShape(point.x, point.y, room, inset);
}

function _shuffle(items, random) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function _gridKey(u, v) {
    return `${u},${v}`;
}

function _gridCenter(room, cell) {
    return {
        x: room.cx + cell.u * GRID_STEP_V1.x + cell.v * GRID_STEP_V2.x,
        y: room.cy + cell.u * GRID_STEP_V1.y + cell.v * GRID_STEP_V2.y,
    };
}

function _nearestGridCell(room, point) {
    const dx = point.x - room.cx;
    const dy = point.y - room.cy;
    return {
        u: Math.round(dx / GRID_CELL_W + dy / GRID_CELL_D),
        v: Math.round(dx / GRID_CELL_W - dy / GRID_CELL_D),
    };
}

function _cellVertices(room, cell) {
    const center = _gridCenter(room, cell);
    return [
        { x: center.x, y: center.y - GRID_CELL_D / 2 },
        { x: center.x + GRID_CELL_W / 2, y: center.y },
        { x: center.x, y: center.y + GRID_CELL_D / 2 },
        { x: center.x - GRID_CELL_W / 2, y: center.y },
    ];
}

function _pointKey(point) {
    return `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`;
}

function _edgeKey(a, b) {
    const ka = _pointKey(a);
    const kb = _pointKey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** 合并连通菱形格，返回单一外轮廓；出现孔洞/分叉时返回 null 触发本候选回退。 */
function _traceGridContour(room, cells) {
    const exposed = new Map();
    for (const cell of cells) {
        const vertices = _cellVertices(room, cell);
        for (let i = 0; i < vertices.length; i++) {
            const a = vertices[i];
            const b = vertices[(i + 1) % vertices.length];
            const key = _edgeKey(a, b);
            if (exposed.has(key)) exposed.delete(key);
            else exposed.set(key, { a, b });
        }
    }
    const remaining = [...exposed.values()];
    if (remaining.length < 4) return null;
    const first = remaining.shift();
    const points = [first.a, first.b];
    let current = first.b;
    while (remaining.length > 0) {
        const currentKey = _pointKey(current);
        const index = remaining.findIndex((edge) =>
            _pointKey(edge.a) === currentKey || _pointKey(edge.b) === currentKey);
        if (index < 0) return null;
        const edge = remaining.splice(index, 1)[0];
        current = _pointKey(edge.a) === currentKey ? edge.b : edge.a;
        if (_pointKey(current) === _pointKey(points[0])) {
            if (remaining.length > 0) return null;
            break;
        }
        points.push(current);
    }
    return points.length >= 4 ? points : null;
}

/** 射线法点在多边形内判定；边界碰撞另由点到线段距离覆盖。 */
export function pointInTerrainPolygon(x, y, polygon) {
    const points = polygon?.points || polygon;
    if (!Array.isArray(points) || points.length < 3) return false;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i];
        const b = points[j];
        const crosses = ((a.y > y) !== (b.y > y))
            && (x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 0.000001) + a.x);
        if (crosses) inside = !inside;
    }
    return inside;
}

/** 点（含 footprint 半径）是否避开房间内全部程序化深渊。 */
export function isPointClearOfTerrainCutouts(bounds, x, y, radius = 0) {
    const cutouts = bounds?._terrainCutouts;
    if (!Array.isArray(cutouts) || cutouts.length === 0) return true;
    const clearance = Math.max(0, Number(radius) || 0);
    for (const cutout of cutouts) {
        const points = cutout.points || [];
        if (pointInTerrainPolygon(x, y, points)) return false;
        if (clearance <= 0) continue;
        const point = { x, y };
        for (let i = 0; i < points.length; i++) {
            if (_pointSegmentDistance(point, points[i], points[(i + 1) % points.length]) <= clearance) {
                return false;
            }
        }
    }
    return true;
}

/**
 * 从候选点向外做有界环形搜索，同时满足菱形、深渊和调用方墙碰撞约束。
 * 找不到时返回 null，由调用方保留既有安全出生兜底。
 */
export function findFrozenTerrainSafePoint(bounds, x, y, radius = 0, canOccupy = null) {
    const valid = (px, py) => {
        if (!pointInRoomShape(px, py, bounds, Math.max(40, radius * 1.5))) return false;
        if (!isPointClearOfTerrainCutouts(bounds, px, py, radius + 12)) return false;
        return typeof canOccupy !== 'function' || canOccupy(px, py);
    };
    if (valid(x, y)) return { x, y };
    for (const distance of [80, 140, 220, 320, 440]) {
        for (let i = 0; i < 24; i++) {
            const angle = i / 24 * Math.PI * 2;
            const px = x + Math.cos(angle) * distance;
            const py = y + Math.sin(angle) * distance * 0.58;
            if (valid(px, py)) return { x: px, y: py };
        }
    }
    return valid(bounds.cx, bounds.cy) ? { x: bounds.cx, y: bounds.cy } : null;
}

export function isFrozenArenaTerrainEnabled(dungeonType, config) {
    return FROZEN_DUNGEON_TYPES.has(dungeonType)
        && config?.enabled === true
        && config?.kind === 'frozenAbyss';
}

function _makePit(room, center, radiusX, random, index) {
    const start = _nearestGridCell(room, center);
    const targetCells = Math.max(5, Math.min(10,
        Math.round((radiusX / GRID_CELL_W) * 4.2) + (index % 2)));
    const cells = [start];
    const occupied = new Set([_gridKey(start.u, start.v)]);
    const neighborSteps = [
        { u: 1, v: 0 }, { u: 0, v: 1 },
        { u: -1, v: 0 }, { u: 0, v: -1 },
    ];
    while (cells.length < targetCells) {
        const frontier = new Map();
        for (const cell of cells) {
            for (const step of neighborSteps) {
                const candidate = { u: cell.u + step.u, v: cell.v + step.v };
                const key = _gridKey(candidate.u, candidate.v);
                if (!occupied.has(key)) frontier.set(key, candidate);
            }
        }
        if (frontier.size === 0) break;
        const candidates = [...frontier.values()].map((candidate) => ({
            ...candidate,
            neighbors: neighborSteps.filter((step) =>
                occupied.has(_gridKey(candidate.u + step.u, candidate.v + step.v))).length,
            roll: random(),
        })).sort((a, b) => b.neighbors - a.neighbors || a.roll - b.roll);
        // 优先紧凑生长，同时从最优三项中抽取，保留自然的不规则缺口。
        const pick = candidates[Math.floor(random() * Math.min(3, candidates.length))];
        const next = { u: pick.u, v: pick.v };
        cells.push(next);
        occupied.add(_gridKey(next.u, next.v));
    }
    const points = _traceGridContour(room, cells);
    if (!points) return null;
    const centers = cells.map((cell) => _gridCenter(room, cell));
    const cx = centers.reduce((sum, point) => sum + point.x, 0) / centers.length;
    const cy = centers.reduce((sum, point) => sum + point.y, 0) / centers.length;
    const actualRadiusX = Math.max(GRID_CELL_W / 2,
        ...points.map((point) => Math.abs(point.x - cx)));
    const actualRadiusY = Math.max(GRID_CELL_D / 2,
        ...points.map((point) => Math.abs(point.y - cy)));
    return {
        kind: 'frozenAbyss',
        roomIndex: room.index,
        cx,
        cy,
        radiusX: actualRadiusX,
        radiusY: actualRadiusY,
        points,
        grid: {
            cellW: GRID_CELL_W,
            cellD: GRID_CELL_D,
            maskContract: ['+u', '+v', '-u', '-v'],
            cells: cells.map((cell) => ({
                ...cell,
                ..._gridCenter(room, cell),
                neighborMask: neighborSteps.reduce((mask, step, bit) =>
                    mask | (occupied.has(_gridKey(cell.u + step.u, cell.v + step.v)) ? (1 << bit) : 0), 0),
            })),
        },
    };
}

function _pitIsValid(pit, room, existing, config) {
    if (!pit) return false;
    if (!pit.points.every((point) => _insideInsetDiamond(point, room, config.edgeInset))) return false;

    const entry = _edgeMid(room, room.inEdge);
    const exit = _edgeMid(room, room.outEdge);
    const center = { x: room.cx, y: room.cy };
    const pitCenter = { x: pit.cx, y: pit.cy };
    const reserve = pit.radiusX + config.safeCorridorHalfWidth;
    if (_pointSegmentDistance(pitCenter, entry, center) < reserve) return false;
    if (_pointSegmentDistance(pitCenter, center, exit) < reserve) return false;
    if (Math.hypot(pit.cx - room.cx, pit.cy - room.cy) < pit.radiusX + config.centerReserve) return false;

    for (const other of existing) {
        if (Math.hypot(pit.cx - other.cx, pit.cy - other.cy)
            < (pit.radiusX + other.radiusX) * 1.25) return false;
    }
    return true;
}

function _segmentsForCutouts(cutouts) {
    const segments = [];
    for (const cutout of cutouts) {
        const points = cutout.points || [];
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            segments.push({
                x1: a.x,
                y1: a.y,
                x2: b.x,
                y2: b.y,
                halfThick: 10,
                _boundary: true,
                _movementOnly: true,
                _frozenAbyss: true,
                roomIndex: cutout.roomIndex,
            });
        }
    }
    return segments;
}

/**
 * 为已完成的冰原格网竞技场附加房内深渊。结果只包含数据与移动边界，不直接写场景。
 */
export function buildFrozenArenaTerrain(layout, rawConfig = {}, rawSeed = Date.now()) {
    const config = { ...DEFAULTS, ...(rawConfig || {}) };
    const configuredMin = Number(config.minPits);
    const configuredMax = Number(config.maxPits);
    config.minPits = Math.max(0, Math.floor(Number.isFinite(configuredMin) ? configuredMin : DEFAULTS.minPits));
    config.maxPits = Math.max(config.minPits,
        Math.floor(Number.isFinite(configuredMax) ? configuredMax : DEFAULTS.maxPits));
    const seed = _normalizeSeed(rawSeed);
    const allCutouts = [];
    const roomFallbacks = [];
    const anchors = [
        { x: -0.44, y: 0.08 }, { x: 0.44, y: -0.08 },
        { x: -0.34, y: 0.25 }, { x: 0.34, y: -0.25 },
        { x: -0.18, y: 0.42 }, { x: 0.18, y: -0.42 },
        { x: -0.42, y: -0.14 }, { x: 0.42, y: 0.14 },
        { x: 0.08, y: 0.48 }, { x: -0.08, y: -0.48 },
    ];

    for (const room of layout?.rooms || []) {
        const random = _mulberry32(_mixSeed(seed, room.index));
        const desired = config.minPits
            + Math.floor(random() * (config.maxPits - config.minPits + 1));
        const roomCutouts = [];
        const shuffled = _shuffle(anchors, random);
        for (let pass = 0; pass < 2 && roomCutouts.length < desired; pass++) {
            for (const anchor of shuffled) {
                if (roomCutouts.length >= desired) break;
                const radiusX = Math.min(290, room.rx * (0.13 - pass * 0.018)) * (0.90 + random() * 0.18);
                const candidate = {
                    x: room.cx + room.rx * (anchor.x + (random() - 0.5) * 0.05),
                    y: room.cy + room.ry * (anchor.y + (random() - 0.5) * 0.05),
                };
                const pit = _makePit(room, candidate, radiusX, random, roomCutouts.length);
                if (_pitIsValid(pit, room, roomCutouts, config)) roomCutouts.push(pit);
            }
        }
        room.abyssPolygons = roomCutouts;
        room.bounds._terrainCutouts = roomCutouts;
        allCutouts.push(...roomCutouts);
        if (roomCutouts.length < config.minPits) roomFallbacks.push(room.index);
    }

    return {
        seed,
        cutouts: allCutouts,
        segments: _segmentsForCutouts(allCutouts),
        fallbackRoomIndexes: roomFallbacks,
    };
}
