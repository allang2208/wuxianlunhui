/**
 * 初级雪原多房竞技场的受控随机外轮廓。
 *
 * 生成只发生在整数 (u,v) 等距格上：u=(64,32)、v=(64,-32)。房型由模板池
 * 与有界程序切角共同产生；门洞保持六格直线，通道保持整数格长度。任何房型、
 * 门位、拓扑或重叠校验失败都会返回 null；水平门模式另有同轴矩形房保底。
 */

const DEFAULTS = Object.freeze({
    enabled: false,
    mode: 'hybrid',
    maxAttempts: 24,
    sizeJitterCells: 2,
    doorEndClearanceCells: 1,
    templatePool: ['rect', 'notched', 'doubleNotch', 'cross', 'stepped', 'procedural'],
    topologyPool: ['straight', 'elbow', 'zigzag', 'snake', 'staircase'],
    passageGateAxis: null,
});

const EDGE_FOR_DIR = Object.freeze({
    'U+': 'RB', 'U-': 'LT', 'V+': 'TR', 'V-': 'BL',
});
const OPPOSITE_EDGE = Object.freeze({ LT: 'RB', RB: 'LT', TR: 'BL', BL: 'TR' });
const OPPOSITE_DIR = Object.freeze({ 'U+': 'U-', 'U-': 'U+', 'V+': 'V-', 'V-': 'V+' });
const DIR_STEP = Object.freeze({
    'U+': { u: 1, v: 0 }, 'U-': { u: -1, v: 0 },
    'V+': { u: 0, v: 1 }, 'V-': { u: 0, v: -1 },
});

function _seed(value) {
    const n = Number(value);
    return Number.isFinite(n) ? (Math.floor(n) >>> 0) : 0x6b8b4567;
}

function _random(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function _int(random, min, max) {
    return min + Math.floor(random() * (max - min + 1));
}

function _pick(random, values) {
    return values[Math.floor(random() * values.length)];
}

function _key(u, v) {
    return `${u},${v}`;
}

function _pointKey(point) {
    return `${point.u},${point.v}`;
}

function _screen(point, cellW, cellD, offsetX = 0, offsetY = 0) {
    return {
        x: offsetX + (point.u + point.v) * cellW / 2,
        y: offsetY + (point.u - point.v) * cellD / 2,
    };
}

function _fillRect(cells, minU, maxU, minV, maxV, add = true) {
    for (let u = minU; u < maxU; u++) {
        for (let v = minV; v < maxV; v++) {
            const key = _key(u, v);
            if (add) cells.add(key);
            else cells.delete(key);
        }
    }
}

function _cutCorner(cells, corner, halfU, halfV, depthU, depthV) {
    const left = corner === 0 || corner === 3;
    const top = corner === 0 || corner === 1;
    const minU = left ? -halfU : halfU - depthU;
    const maxU = left ? -halfU + depthU : halfU;
    const minV = top ? halfV - depthV : -halfV;
    const maxV = top ? halfV : -halfV + depthV;
    _fillRect(cells, minU, maxU, minV, maxV, false);
}

function _cutSideBite(cells, side, halfU, halfV, width, depth) {
    const halfWidth = Math.floor(width / 2);
    if (side === 0) _fillRect(cells, -halfWidth, halfWidth, halfV - depth, halfV, false);
    if (side === 1) _fillRect(cells, halfU - depth, halfU, -halfWidth, halfWidth, false);
    if (side === 2) _fillRect(cells, -halfWidth, halfWidth, -halfV, -halfV + depth, false);
    if (side === 3) _fillRect(cells, -halfU, -halfU + depth, -halfWidth, halfWidth, false);
}

function _makeTemplateCells(template, halfU, halfV, random) {
    const cells = new Set();
    _fillRect(cells, -halfU, halfU, -halfV, halfV, true);
    const depthU = Math.max(2, Math.min(5, _int(random, 2, Math.max(2, Math.floor(halfU / 3)))));
    const depthV = Math.max(2, Math.min(5, _int(random, 2, Math.max(2, Math.floor(halfV / 3)))));
    const corner = _int(random, 0, 3);

    switch (template) {
        case 'notched':
            _cutCorner(cells, corner, halfU, halfV, depthU, depthV);
            break;
        case 'doubleNotch':
            _cutCorner(cells, corner, halfU, halfV, depthU, depthV);
            _cutCorner(cells, (corner + 2) % 4, halfU, halfV, depthU, depthV);
            break;
        case 'cross': {
            const du = Math.max(2, Math.min(halfU - 4, depthU + 1));
            const dv = Math.max(2, Math.min(halfV - 4, depthV + 1));
            for (let i = 0; i < 4; i++) _cutCorner(cells, i, halfU, halfV, du, dv);
            break;
        }
        case 'stepped': {
            _cutCorner(cells, corner, halfU, halfV, depthU + 1, Math.max(2, depthV - 1));
            const next = (corner + (random() < 0.5 ? 1 : 3)) % 4;
            _cutCorner(cells, next, halfU, halfV, Math.max(2, depthU - 1), depthV + 1);
            break;
        }
        case 'procedural': {
            const cuts = _int(random, 1, 3);
            const used = new Set();
            for (let i = 0; i < cuts; i++) {
                let pick = _int(random, 0, 3);
                while (used.has(pick) && used.size < 4) pick = (pick + 1) % 4;
                used.add(pick);
                _cutCorner(cells, pick, halfU, halfV,
                    _int(random, 2, Math.min(5, halfU - 4)),
                    _int(random, 2, Math.min(5, halfV - 4)));
            }
            if (Math.min(halfU, halfV) >= 11 && random() < 0.7) {
                _cutSideBite(cells, _int(random, 0, 3), halfU, halfV, 4, _int(random, 1, 2));
            }
            break;
        }
        default:
            break;
    }
    return cells;
}

/** 从格单元并集提取唯一外轮廓；存在孔洞或分叉时拒绝该候选。 */
function _traceContour(cells) {
    const edges = [];
    const has = (u, v) => cells.has(_key(u, v));
    for (const key of cells) {
        const [u, v] = key.split(',').map(Number);
        if (!has(u, v - 1)) edges.push([{ u, v }, { u: u + 1, v }]);
        if (!has(u + 1, v)) edges.push([{ u: u + 1, v }, { u: u + 1, v: v + 1 }]);
        if (!has(u, v + 1)) edges.push([{ u: u + 1, v: v + 1 }, { u, v: v + 1 }]);
        if (!has(u - 1, v)) edges.push([{ u, v: v + 1 }, { u, v }]);
    }
    if (edges.length < 8) return null;
    const byStart = new Map();
    for (const edge of edges) {
        const key = _pointKey(edge[0]);
        if (byStart.has(key)) return null;
        byStart.set(key, edge);
    }
    const first = edges[0];
    const contour = [first[0]];
    let current = first[1];
    let guard = 0;
    while (_pointKey(current) !== _pointKey(contour[0]) && guard++ <= edges.length) {
        contour.push(current);
        const next = byStart.get(_pointKey(current));
        if (!next) return null;
        current = next[1];
    }
    if (_pointKey(current) !== _pointKey(contour[0]) || contour.length !== edges.length) return null;
    // 单元边默认逆时针；反转为顺时针，便于按行进方向识别四个外法线。
    return contour.reverse();
}

function _simplifyContour(contour) {
    const result = [];
    for (let i = 0; i < contour.length; i++) {
        const prev = contour[(i + contour.length - 1) % contour.length];
        const cur = contour[i];
        const next = contour[(i + 1) % contour.length];
        const du1 = cur.u - prev.u, dv1 = cur.v - prev.v;
        const du2 = next.u - cur.u, dv2 = next.v - cur.v;
        if (du1 * dv2 === dv1 * du2) continue;
        result.push(cur);
    }
    return result;
}

function _extents(points) {
    return {
        minU: Math.min(...points.map((point) => point.u)),
        maxU: Math.max(...points.map((point) => point.u)),
        minV: Math.min(...points.map((point) => point.v)),
        maxV: Math.max(...points.map((point) => point.v)),
    };
}

function _sideRuns(outline, edge) {
    const ext = _extents(outline);
    const runs = [];
    for (let i = 0; i < outline.length; i++) {
        const a = outline[i];
        const b = outline[(i + 1) % outline.length];
        const length = Math.abs(b.u - a.u) + Math.abs(b.v - a.v);
        const extreme = (edge === 'TR' && a.v === ext.maxV && b.v === ext.maxV)
            || (edge === 'RB' && a.u === ext.maxU && b.u === ext.maxU)
            || (edge === 'BL' && a.v === ext.minV && b.v === ext.minV)
            || (edge === 'LT' && a.u === ext.minU && b.u === ext.minU);
        if (extreme && length > 0) runs.push({ a, b, length });
    }
    return runs;
}

function _makeOpening(outline, edge, gateCells, clearance, random) {
    const candidates = _sideRuns(outline, edge).filter((run) => run.length >= gateCells + clearance * 2);
    if (candidates.length === 0) return null;
    const run = _pick(random, candidates);
    const du = Math.sign(run.b.u - run.a.u);
    const dv = Math.sign(run.b.v - run.a.v);
    const available = run.length - gateCells - clearance * 2;
    const start = clearance + (available > 0 ? _int(random, 0, available) : 0);
    const rawA = { u: run.a.u + du * start, v: run.a.v + dv * start };
    const rawB = { u: rawA.u + du * gateCells, v: rawA.v + dv * gateCells };
    return { edge, gateCells, rawA, rawB, step: { u: du, v: dv } };
}

function _topology(name, count, random) {
    const length = Math.max(0, count - 1);
    const u = random() < 0.5 ? 'U+' : 'U-';
    const uBack = OPPOSITE_DIR[u];
    const dirs = [];
    for (let i = 0; i < length; i++) {
        if (name === 'straight') dirs.push(i === 0 && random() < 0.25 ? 'V+' : u);
        else if (name === 'elbow') dirs.push(i < Math.ceil(length / 2) ? u : 'V+');
        else if (name === 'zigzag') dirs.push(i % 2 === 0 ? u : (i % 4 === 1 ? 'V+' : 'V-'));
        else if (name === 'snake') dirs.push(i < 2 ? u : (i === 2 ? 'V+' : uBack));
        else dirs.push(i % 2 === 0 ? u : 'V+');
    }
    // 禁止相邻方向立即折返；这会让同一扇门同时承担来路和去路。
    for (let i = 1; i < dirs.length; i++) {
        if (dirs[i] === OPPOSITE_DIR[dirs[i - 1]]) dirs[i] = 'V+';
    }
    if (dirs[0] === 'V-') dirs[0] = u;
    return dirs;
}

function _buildRoomShape(size, template, inEdge, outEdge, gateCells, config, random) {
    const radiusCells = Math.max(10, Math.round((size * 1.2) / config.cellW));
    const jitter = Math.max(0, Math.floor(config.sizeJitterCells));
    const halfU = Math.max(10, radiusCells + _int(random, -jitter, jitter));
    const halfV = Math.max(10, radiusCells + _int(random, -jitter, jitter));
    const cells = _makeTemplateCells(template, halfU, halfV, random);
    const contour = _traceContour(cells);
    if (!contour) return null;
    const outline = _simplifyContour(contour);
    if (outline.length < 4 || inEdge === outEdge) return null;
    const openings = {};
    for (const edge of new Set([inEdge, outEdge])) {
        const opening = _makeOpening(outline, edge, gateCells,
            config.doorEndClearanceCells, random);
        if (!opening) return null;
        openings[edge] = opening;
    }
    // 门洞到房心保留至少五格宽的可通行扇带，避免切角把入口和战斗核心隔断。
    for (const opening of Object.values(openings)) {
        const mid = _localMid(opening);
        for (let sample = 1; sample <= 10; sample++) {
            const t = sample / 10;
            for (let offset = -2; offset <= 2; offset++) {
                const point = {
                    u: mid.u * (1 - t) + opening.step.u * offset * (1 - t),
                    v: mid.v * (1 - t) + opening.step.v * offset * (1 - t),
                };
                if (!_pointInUvPolygon(point, outline)) return null;
            }
        }
    }
    return { template, cells, contour, outline, openings };
}

function _translateCells(cells, center) {
    const result = new Set();
    for (const key of cells) {
        const [u, v] = key.split(',').map(Number);
        result.add(_key(u + center.u, v + center.v));
    }
    return result;
}

function _roomsOverlap(cellSets) {
    const occupied = new Set();
    for (const cells of cellSets) {
        for (const key of cells) {
            if (occupied.has(key)) return true;
            occupied.add(key);
        }
    }
    return false;
}

function _pointInUvPolygon(point, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        const crosses = ((a.v > point.v) !== (b.v > point.v))
            && (point.u < (b.u - a.u) * (point.v - a.v) / ((b.v - a.v) || 0.000001) + a.u);
        if (crosses) inside = !inside;
    }
    return inside;
}

/** 通道带不得穿过第三间房或另一条通道；门口所在的相邻两房不参与本段检查。 */
function _corridorsAreClear(rooms, directions, corridorCells, gateCells) {
    const globalOutlines = rooms.map((room) => room.shape.outline.map((point) => ({
        u: point.u + room.centerGrid.u,
        v: point.v + room.centerGrid.v,
    })));
    const occupiedCorridorPoints = new Set();
    const halfGate = Math.ceil(gateCells / 2);
    for (let i = 0; i < directions.length; i++) {
        const room = rooms[i];
        const opening = room.shape.openings[room.outEdge];
        const startLocal = _localMid(opening);
        const start = {
            u: room.centerGrid.u + startLocal.u,
            v: room.centerGrid.v + startLocal.v,
        };
        const dir = DIR_STEP[directions[i]];
        const tangent = opening.step;
        for (let step = 1; step < corridorCells; step++) {
            for (let offset = -halfGate; offset <= halfGate; offset++) {
                const point = {
                    u: start.u + dir.u * step + tangent.u * offset,
                    v: start.v + dir.v * step + tangent.v * offset,
                };
                for (let roomIndex = 0; roomIndex < rooms.length; roomIndex++) {
                    if (roomIndex === i || roomIndex === i + 1) continue;
                    if (_pointInUvPolygon(point, globalOutlines[roomIndex])) return false;
                }
                const key = _key(point.u, point.v);
                if (occupiedCorridorPoints.has(key)) return false;
                occupiedCorridorPoints.add(key);
            }
        }
    }
    return true;
}

function _localMid(opening) {
    return {
        u: (opening.rawA.u + opening.rawB.u) / 2,
        v: (opening.rawA.v + opening.rawB.v) / 2,
    };
}

function _materializeOpening(opening, centerGrid, cellW, cellD, offsetX, offsetY) {
    const absolute = (point) => _screen({
        u: point.u + centerGrid.u,
        v: point.v + centerGrid.v,
    }, cellW, cellD, offsetX, offsetY);
    const rawA = absolute(opening.rawA);
    const rawB = absolute(opening.rawB);
    const step = {
        x: opening.step.u * cellW / 2 + opening.step.v * cellW / 2,
        y: opening.step.u * cellD / 2 - opening.step.v * cellD / 2,
    };
    const outwardGrid = DIR_STEP[({ TR: 'V+', RB: 'U+', BL: 'V-', LT: 'U-' })[opening.edge]];
    const outward = {
        x: outwardGrid.u * cellW / 2 + outwardGrid.v * cellW / 2,
        y: outwardGrid.u * cellD / 2 - outwardGrid.v * cellD / 2,
    };
    let a = { ...rawA }, b = { ...rawB };
    if (a.y > b.y) [a, b] = [b, a];
    return {
        edge: opening.edge,
        gateCells: opening.gateCells,
        step,
        outward,
        rawA,
        rawB,
        a,
        b,
        flip: b.x < a.x,
        depth: Math.max(a.y, b.y) + 4,
    };
}

function _attemptLayout(sizes, rawConfig, seed, cellW, cellD, corridorCells, margin) {
    const config = { ...DEFAULTS, ...(rawConfig || {}), cellW, cellD };
    const random = _random(seed);
    const templates = (Array.isArray(config.templatePool) && config.templatePool.length > 0)
        ? config.templatePool : DEFAULTS.templatePool;
    const topologies = (Array.isArray(config.topologyPool) && config.topologyPool.length > 0)
        ? config.topologyPool : DEFAULTS.topologyPool;
    // 初级雪原的门素材只能沿 BL/TR 水平墙线正确拼接。现有通道构造器只支持
    // 两个门洞间的单段直廊，因此在具备转角通道前，用连续 V+ 房间 + 随机门位
    // 形成横向错位的房间序列，避免 U 方向再次产出 RB/LT 竖直门。
    const horizontalPassageGates = config.passageGateAxis === 'horizontal';
    const topology = horizontalPassageGates ? 'horizontalStagger' : _pick(random, topologies);
    const directions = horizontalPassageGates
        ? Array.from({ length: Math.max(0, sizes.length - 1) }, () => 'V+')
        : _topology(topology, sizes.length, random);
    const entryEdge = ['TR', 'RB', 'BL', 'LT'].includes(config.entryEdge) ? config.entryEdge : 'BL';
    const rooms = [];

    for (let i = 0; i < sizes.length; i++) {
        const inEdge = i === 0 ? entryEdge : OPPOSITE_EDGE[EDGE_FOR_DIR[directions[i - 1]]];
        const outEdge = i === sizes.length - 1
            ? OPPOSITE_EDGE[inEdge]
            : EDGE_FOR_DIR[directions[i]];
        const template = config.mode === 'procedural' ? 'procedural' : _pick(random, templates);
        const shape = _buildRoomShape(sizes[i], template, inEdge, outEdge,
            config.gateCells, config, random);
        if (!shape) return null;
        rooms.push({ index: i + 1, size: sizes[i], inEdge, outEdge, shape });
    }

    rooms[0].centerGrid = { u: 0, v: 0 };
    for (let i = 0; i < directions.length; i++) {
        const a = rooms[i];
        const b = rooms[i + 1];
        const dir = DIR_STEP[directions[i]];
        const exitMid = _localMid(a.shape.openings[a.outEdge]);
        const entryMid = _localMid(b.shape.openings[b.inEdge]);
        b.centerGrid = {
            u: a.centerGrid.u + exitMid.u - entryMid.u + dir.u * corridorCells,
            v: a.centerGrid.v + exitMid.v - entryMid.v + dir.v * corridorCells,
        };
        if (!Number.isInteger(b.centerGrid.u) || !Number.isInteger(b.centerGrid.v)) return null;
    }

    if (_roomsOverlap(rooms.map((room) => _translateCells(room.shape.cells, room.centerGrid)))) return null;
    if (!_corridorsAreClear(rooms, directions, corridorCells, config.gateCells)) return null;

    const allScreenPoints = [];
    for (const room of rooms) {
        for (const point of room.shape.outline) {
            allScreenPoints.push(_screen({
                u: point.u + room.centerGrid.u,
                v: point.v + room.centerGrid.v,
            }, cellW, cellD));
        }
    }
    const minX = Math.min(...allScreenPoints.map((point) => point.x));
    const minY = Math.min(...allScreenPoints.map((point) => point.y));
    const offsetX = margin - minX;
    const offsetY = margin - minY;

    for (const room of rooms) {
        const absolutePoint = (point) => _screen({
            u: point.u + room.centerGrid.u,
            v: point.v + room.centerGrid.v,
        }, cellW, cellD, offsetX, offsetY);
        const center = _screen(room.centerGrid, cellW, cellD, offsetX, offsetY);
        const floorPolygon = room.shape.outline.map(absolutePoint);
        const wallCenters = room.shape.contour.map(absolutePoint);
        const xs = floorPolygon.map((point) => point.x);
        const ys = floorPolygon.map((point) => point.y);
        const rx = Math.max(...floorPolygon.map((point) => Math.abs(point.x - center.x)));
        const ry = Math.max(...floorPolygon.map((point) => Math.abs(point.y - center.y)));
        const openings = {};
        for (const [edge, opening] of Object.entries(room.shape.openings)) {
            openings[edge] = _materializeOpening(
                opening, room.centerGrid, cellW, cellD, offsetX, offsetY);
        }
        room.cx = center.x;
        room.cy = center.y;
        room.rx = rx;
        room.ry = ry;
        room.edgeCells = Math.max(12, wallCenters.length / 4);
        room.floorPolygon = floorPolygon;
        room.bounds = {
            minX: Math.min(...xs), maxX: Math.max(...xs),
            minY: Math.min(...ys), maxY: Math.max(...ys),
            cx: center.x, cy: center.y,
            diamond: true, rx, ry, floorPolygon,
        };
        room.shape = {
            kind: 'frozenRandomGrid',
            template: room.shape.template,
            wallCenters,
            outlinePoints: floorPolygon,
            openings,
        };
    }

    const passages = [];
    for (let i = 0; i < rooms.length - 1; i++) {
        const a = rooms[i], b = rooms[i + 1];
        const openingA = a.shape.openings[a.outEdge];
        const openingB = b.shape.openings[b.inEdge];
        const mid1 = { x: (openingA.rawA.x + openingA.rawB.x) / 2, y: (openingA.rawA.y + openingA.rawB.y) / 2 };
        const mid2 = { x: (openingB.rawA.x + openingB.rawB.x) / 2, y: (openingB.rawA.y + openingB.rawB.y) / 2 };
        const vx = mid2.x - mid1.x, vy = mid2.y - mid1.y;
        const length = Math.hypot(vx, vy);
        if (length < 1) return null;
        passages.push({
            index: i + 1,
            mid1, mid2,
            center: { x: (mid1.x + mid2.x) / 2, y: (mid1.y + mid2.y) / 2 },
            axis: { x: vx / length, y: vy / length },
            gridStep: { x: vx / corridorCells, y: vy / corridorCells },
            corridorCells,
            length,
            outEdge: a.outEdge,
            inEdge: b.inEdge,
        });
    }

    const maxX = Math.max(...rooms.flatMap((room) => room.floorPolygon.map((point) => point.x)));
    const maxY = Math.max(...rooms.flatMap((room) => room.floorPolygon.map((point) => point.y)));
    return {
        rooms,
        passages,
        worldW: Math.ceil(maxX + margin),
        worldH: Math.ceil(maxY + margin),
        maze: true,
        grid: true,
        randomRooms: true,
        seed,
        topology,
        templates: rooms.map((room) => room.shape.template),
    };
}

export function computeFrozenRandomRoomLayout({
    sizes,
    randomRooms,
    seed,
    corridorCells = 12,
    gateCells = 6,
    entryEdge = 'BL',
    cellW = 128,
    cellD = 64,
    margin = 300,
}) {
    if (!Array.isArray(sizes) || sizes.length < 2 || randomRooms?.enabled !== true) return null;
    const config = { ...DEFAULTS, ...(randomRooms || {}), gateCells, entryEdge };
    const attempts = Math.max(1, Math.min(64, Math.floor(config.maxAttempts || DEFAULTS.maxAttempts)));
    const baseSeed = _seed(seed);
    for (let attempt = 0; attempt < attempts; attempt++) {
        const attemptSeed = (baseSeed + Math.imul(attempt + 1, 0x9e3779b1)) >>> 0;
        const layout = _attemptLayout(
            sizes, config, attemptSeed, cellW, cellD,
            Math.max(4, Math.round(corridorCells)), margin);
        if (layout) {
            layout.requestedSeed = baseSeed;
            layout.attempt = attempt + 1;
            return layout;
        }
    }
    // 水平门约束下提供一个同轴矩形保底，避免随机凹凸组合连续失败后回落到
    // 旧网格迷宫（旧迷宫可能重新生成 RB/LT 竖直通道门）。
    if (config.passageGateAxis === 'horizontal') {
        const fallback = _attemptLayout(sizes, {
            ...config,
            mode: 'hybrid',
            templatePool: ['rect'],
            topologyPool: ['horizontalStagger'],
            sizeJitterCells: 0,
        }, (baseSeed ^ 0x51f15e5d) >>> 0, cellW, cellD,
        Math.max(4, Math.round(corridorCells)), margin);
        if (fallback) {
            fallback.requestedSeed = baseSeed;
            fallback.attempt = attempts + 1;
            fallback.fallback = 'horizontalRect';
            return fallback;
        }
    }
    return null;
}

function _pointInPolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i], b = points[j];
        const crosses = ((a.y > y) !== (b.y > y))
            && (x < (b.x - a.x) * (y - a.y) / ((b.y - a.y) || 0.000001) + a.x);
        if (crosses) inside = !inside;
    }
    return inside;
}

export function distanceToRoomBoundary(x, y, room) {
    const points = room?.floorPolygon || room?.bounds?.floorPolygon;
    if (!Array.isArray(points) || points.length < 3) return Infinity;
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1,
            ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
        best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
    }
    return best;
}

/** 兼容规则菱形与随机正交房型的统一空间判定。 */
export function pointInRoomShape(x, y, room, inset = 0) {
    const target = room?.bounds || room;
    const points = target?.floorPolygon || room?.floorPolygon;
    if (Array.isArray(points) && points.length >= 3) {
        return _pointInPolygon(x, y, points)
            && distanceToRoomBoundary(x, y, { floorPolygon: points }) >= Math.max(0, inset);
    }
    if (!target) return false;
    const rx = Math.max(1, target.rx - Math.max(0, inset));
    const ry = Math.max(1, target.ry - Math.max(0, inset) * 0.55);
    return Math.abs(x - target.cx) / rx + Math.abs(y - target.cy) / ry <= 1;
}
