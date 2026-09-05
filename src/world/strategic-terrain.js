import config from '../../data/world-strategy.json';

export const HEX_DIRECTIONS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const strategicWalkable = (cell) => !!cell && (!cell.mountain || cell.pass);
export function strategicCanTraverse(from, to) {
    return strategicWalkable(from) && strategicWalkable(to);
}
export function strategicTerrainCost(from, to) {
    // Rivers are edge costs: moving along a bank is free of the crossing penalty.
    // Legacy bridge records remain readable, but no longer gate or discount travel.
    return (to?.pass ? config.terrainRules.passMultiplier : 1)
        * (from?.rivers?.includes(to?.id) ? config.terrainRules.riverCrossingMultiplier : 1);
}
export function strategicTerrainLabel(cell) {
    if (cell?.mountain && !cell.pass) return '山脉 · 不可通行';
    const labels = [];
    if (cell?.pass) labels.push('山口 · 可通行，耗时增加');
    if (cell?.rivers?.length) labels.push(`河岸 · 可直接渡河，跨河耗时 ×${config.terrainRules.riverCrossingMultiplier}`);
    return labels.join('；');
}

/** Seeded ridgelines and edge rivers; carve mountain passes to connect the ground graph. */
export function generateStrategicTerrain(cells, seed) {
    const byId = new Map(cells.map((cell) => [cell.id, cell]));
    const neighbors = (cell) => HEX_DIRECTIONS.map(([q, r]) => byId.get(`${cell.q + q},${cell.r + r}`)).filter(Boolean);
    const angle = (seed % 65536) / 65536 * Math.PI * 2;
    const phase = ((seed >>> 16) % 1024) / 1024 * Math.PI * 2;
    const local = (cell) => {
        const x = cell.q + cell.r / 2, y = cell.r * Math.sqrt(3) / 2;
        return { u: x * Math.cos(angle) + y * Math.sin(angle), v: y * Math.cos(angle) - x * Math.sin(angle) };
    };
    for (const cell of cells) {
        const { u, v } = local(cell);
        cell.mountain = Math.abs(u - 7 * Math.sin(v / 12 + phase)) < 0.95
            || (Math.abs(v - 14 - 3 * Math.sin(u / 7 + phase)) < 0.7 && u > -10);
        // Keep the legacy save field empty; rivers no longer need generated bridges.
        cell.pass = false; cell.rivers = []; cell.bridges = [];
    }
    const start = cells.find((cell) => !cell.mountain) || cells[0];
    start.pass = !!start.mountain;
    const connected = new Set();
    const flood = (root) => {
        const queue = [root]; connected.add(root.id);
        for (let i = 0; i < queue.length; i++) for (const next of neighbors(queue[i])) {
            if (strategicWalkable(next) && !connected.has(next.id)) { connected.add(next.id); queue.push(next); }
        }
    };
    flood(start);
    while (cells.some((cell) => strategicWalkable(cell) && !connected.has(cell.id))) {
        const queue = [...connected].map((id) => byId.get(id)), previous = new Map(queue.map((cell) => [cell.id, null]));
        let reached = null;
        for (let i = 0; i < queue.length && !reached; i++) for (const next of neighbors(queue[i])) {
            if (previous.has(next.id)) continue;
            previous.set(next.id, queue[i].id); queue.push(next);
            if (strategicWalkable(next) && !connected.has(next.id)) { reached = next; break; }
        }
        if (!reached) break;
        for (let id = reached.id; id && !connected.has(id); id = previous.get(id)) {
            const cell = byId.get(id);
            if (cell.mountain) cell.pass = true;
        }
        flood(reached);
    }
    const riverSide = (cell) => {
        const { u, v } = local(cell);
        return v + 6 - 4 * Math.sin(u / 9 + phase) > 0;
    };
    for (const cell of cells) for (const next of neighbors(cell)) {
        if (cell.id >= next.id) continue;
        if (riverSide(cell) !== riverSide(next)) {
            cell.rivers.push(next.id); next.rivers.push(cell.id);
        }
    }
}
