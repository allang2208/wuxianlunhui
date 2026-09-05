// Authoritative strategic coordinates; no entities, rendering or world ticks.
import layout from '../../data/world-map-layout.json';
import generation from '../../data/world-map-generation.json';
import { EventBus } from '../core/event-bus.js';
import { MinHeap } from '../utils/min-heap.js';
import { generateWorldMap, HEX_DIRECTIONS } from './world-map-generator.js';
import { strategicWalkable, strategicCanTraverse } from './strategic-terrain.js';

const legacyMap = () => ({ kind: 'legacy', seed: layout.seed, layoutVersion: layout.version, cells: layout.cells });
let activeMap = legacyMap(), revision = 0;
export let WORLD_MAP_LAYOUT_VERSION = activeMap.layoutVersion;
export const WORLD_MAP_PLANES = Object.values(layout.biomes);
export let WORLD_MAP_CELLS = activeMap.cells;
let cellById, planeCells, neighborCells;
const pathCache = new Map();
function indexMap() {
    cellById = new Map(WORLD_MAP_CELLS.map((cell) => [cell.id, cell]));
    planeCells = new Map(WORLD_MAP_PLANES.map(({ sceneId }) => [sceneId,
        WORLD_MAP_CELLS.filter((cell) => cell.planeSceneId === sceneId && strategicWalkable(cell)).sort((a, b) => a.r - b.r || a.q - b.q),
    ]));
    neighborCells = new Map(WORLD_MAP_CELLS.map((cell) => [cell.id,
        HEX_DIRECTIONS.map(([q, r]) => cellById.get(`${cell.q + q},${cell.r + r}`)).filter((next) => strategicCanTraverse(cell, next)),
    ]));
    pathCache.clear();
}
indexMap();
export function worldMapInfo() {
    return { kind: activeMap.kind, seed: activeMap.seed, cellCount: WORLD_MAP_CELLS.length,
        key: `${activeMap.kind}:${activeMap.layoutVersion}:${activeMap.seed}`, revision };
}
export function applyWorldMap(prepared) {
    activeMap = prepared;
    WORLD_MAP_LAYOUT_VERSION = prepared.layoutVersion;
    WORLD_MAP_CELLS = prepared.cells;
    revision++; indexMap();
    // Presentation listeners must not make map activation fail halfway through a load.
    try { EventBus.emit('world-map:changed', worldMapInfo()); } catch (error) { console.warn('[WorldMap] presentation refresh', error); }
}
export function newWorldMap() {
    const seedBytes = new Uint32Array(1);
    globalThis.crypto.getRandomValues(seedBytes);
    const seed = seedBytes[0] === activeMap.seed ? (seedBytes[0] + 1) >>> 0 : seedBytes[0];
    applyWorldMap(generateWorldMap(seed));
}
export function serializeWorldMap() {
    const saved = { version: 1, kind: activeMap.kind, seed: activeMap.seed, layoutVersion: activeMap.layoutVersion };
    if (activeMap.kind === 'generated') {
        saved.generatorVersion = activeMap.generatorVersion;
        // Save actual cells as well as the seed: future formulas cannot move an existing base.
        saved.cells = WORLD_MAP_CELLS.map(({ q, r, biome, tile, mountain, pass, rivers, bridges }) =>
            activeMap.layoutVersion < 4 ? [q, r, biome, tile] : [q, r, biome, tile,
                { mountain: !!mountain, pass: !!pass, rivers: rivers || [], bridges: bridges || [] }]);
    }
    return saved;
}
/** Validate before mutating the current game. A missing field is an old 305-cell save. */
export function prepareWorldMap(saved) {
    if (saved == null) return legacyMap();
    if (saved.version !== 1) throw new Error('不支持的大地图存档版本');
    if (saved.kind === 'legacy' && saved.layoutVersion === layout.version) return legacyMap();
    if (saved.kind !== 'generated' || !Number.isInteger(saved.seed) || saved.seed < 0 || saved.seed > 0xffffffff
        || ![3, 4].includes(saved.layoutVersion) || !Number.isInteger(saved.generatorVersion)
        || !Array.isArray(saved.cells) || saved.cells.length < WORLD_MAP_PLANES.length || saved.cells.length > 20000) {
        throw new Error('大地图存档不完整，已取消读档');
    }
    const ids = new Set(), biomes = new Set();
    const cells = saved.cells.map((row) => {
        if (!Array.isArray(row) || row.length !== (saved.layoutVersion === 4 ? 5 : 4)) throw new Error('大地图地块记录无效');
        const [q, r, biome, tile] = row, id = `${q},${r}`;
        if (!Number.isInteger(q) || !Number.isInteger(r) || Math.abs(q) > 256 || Math.abs(r) > 256
            || !Object.hasOwn(layout.biomes, biome) || !Object.hasOwn(layout.tiles, tile)
            || !tile.startsWith(`${biome}_`) || ids.has(id)) throw new Error('大地图坐标或地貌记录无效');
        ids.add(id); biomes.add(biome);
        const terrain = row[4] || {};
        if (saved.layoutVersion === 4 && (typeof terrain.mountain !== 'boolean' || typeof terrain.pass !== 'boolean'
            || !Array.isArray(terrain.rivers) || !Array.isArray(terrain.bridges)
            || terrain.rivers.length > 6 || terrain.bridges.length > 6)) throw new Error('大地图通行记录无效');
        return { id, q, r, biome, tile, planeSceneId: layout.biomes[biome].sceneId,
            mountain: !!terrain.mountain, pass: !!terrain.pass, rivers: [...(terrain.rivers || [])], bridges: [...(terrain.bridges || [])] };
    });
    if (biomes.size !== WORLD_MAP_PLANES.length) throw new Error('大地图缺少位面地貌');
    const byId = new Map(cells.map((cell) => [cell.id, cell]));
    for (const cell of cells) for (const id of [...cell.rivers, ...cell.bridges]) {
        const next = byId.get(id);
        if (!next || strategicDistance(cell, next) !== 1 || !next.rivers.includes(cell.id)
            || (cell.bridges.includes(id) && (!cell.rivers.includes(id) || !next.bridges.includes(cell.id)))) {
            throw new Error('大地图河流或桥梁两侧不一致');
        }
    }
    return { kind: 'generated', seed: saved.seed, generatorVersion: saved.generatorVersion, layoutVersion: saved.layoutVersion, cells };
}

export function strategicCell(id) { return cellById.get(id) || null; }
export function strategicNeighbors(id) { return neighborCells.get(id) || []; }
export function worldMapPlaneCells(sceneId) { return planeCells.get(sceneId) || []; }
export function strategicDistance(a, b) {
    if (!a || !b) return Infinity;
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
}
/** A* with an admissible lower bound; zero retains Dijkstra for arbitrary cost callers. */
export function strategicPath(from, to, allowed = () => true, stepCost = () => 1, { minimumStep = 0, cacheKey } = {}) {
    const origin = strategicCell(from), destination = strategicCell(to);
    if (!strategicWalkable(origin) || !strategicWalkable(destination)) return null;
    const key = cacheKey == null ? null : JSON.stringify([revision, from, to, cacheKey]);
    if (key && pathCache.has(key)) {
        const cached = pathCache.get(key);
        pathCache.delete(key); pathCache.set(key, cached);
        return cached?.slice() ?? null;
    }
    const remember = (route) => {
        if (key) {
            pathCache.set(key, route?.slice() ?? null);
            if (pathCache.size > generation.pathCacheLimit) pathCache.delete(pathCache.keys().next().value);
        }
        return route;
    };
    const heuristic = (cell) => strategicDistance(cell, destination) * Math.max(0, minimumStep);
    const pending = new MinHeap((a, b) => a.rank - b.rank || a.cost - b.cost);
    const previous = new Map([[from, null]]), costs = new Map([[from, 0]]);
    pending.push({ id: from, cost: 0, rank: heuristic(origin) });
    while (pending.size) {
        const { id, cost } = pending.pop();
        if (cost !== costs.get(id)) continue;
        if (id === to) {
            const route = [];
            for (let cursor = to; cursor !== from; cursor = previous.get(cursor)) route.push(cursor);
            return remember(route.reverse());
        }
        for (const cell of strategicNeighbors(id)) {
            if (!allowed(cell)) continue;
            const edgeCost = stepCost(strategicCell(id), cell);
            if (!Number.isFinite(edgeCost) || edgeCost <= 0) continue;
            const nextCost = cost + edgeCost;
            if (nextCost >= (costs.get(cell.id) ?? Infinity)) continue;
            costs.set(cell.id, nextCost); previous.set(cell.id, id);
            pending.push({ id: cell.id, cost: nextCost, rank: nextCost + heuristic(cell) });
        }
    }
    return remember(null);
}

export function getWorldMapCell(sceneId, cellId) {
    const cell = cellById.get(cellId);
    return cell?.planeSceneId === sceneId ? { id: cell.id, q: cell.q, r: cell.r } : null;
}

/** Use a fresh, purpose-seeded RNG, never the battlefield's shared stream. */
export function pickWorldMapEntryCell(sceneId, random, excludedCells = new Set()) {
    const candidates = worldMapPlaneCells(sceneId).filter((cell) => !excludedCells.has(cell.id));
    if (!candidates.length) return null;
    const { id, q, r } = candidates[Math.floor(random() * candidates.length)];
    return { id, q, r };
}
