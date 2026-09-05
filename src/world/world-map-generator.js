import layout from '../../data/world-map-layout.json';
import generation from '../../data/world-map-generation.json';
import { MinHeap } from '../utils/min-heap.js';
import { HEX_DIRECTIONS, generateStrategicTerrain } from './strategic-terrain.js';

export { HEX_DIRECTIONS } from './strategic-terrain.js';
const hash = (q, r, seed) => {
    let h = Math.imul(q, 374761393) ^ Math.imul(r, 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t) => t * t * (3 - 2 * t);
function noise(q, r, seed, wavelength) {
    const x = q / wavelength, y = r / wavelength, ix = Math.floor(x), iy = Math.floor(y);
    const u = smooth(x - ix), v = smooth(y - iy);
    const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed);
    const c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
const distance = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));

/** Pure generation: no shared combat RNG, entities, clock or save mutations. */
export function generateWorldMap(seed) {
    seed >>>= 0;
    const random = (() => {
        let state = seed;
        return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    })();
    const angle = random() * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
    const stretch = 0.8 + random() * 0.45, roughness = 8 + random() * 5;
    const score = (q, r) => {
        const x = q + r / 2, y = r * Math.sqrt(3) / 2;
        return Math.hypot((x * c - y * s) / stretch, (x * s + y * c) * stretch)
            + (noise(q, r, seed, 11) - 0.5) * roughness
            + (noise(q, r, seed ^ 0x6a09e667, 4) - 0.5) * 3;
    };
    const frontier = new MinHeap((a, b) => a.score - b.score || a.q - b.q || a.r - b.r);
    const queued = new Set(), land = new Map();
    const offer = (q, r) => {
        const id = `${q},${r}`;
        if (queued.has(id)) return;
        queued.add(id); frontier.push({ id, q, r, score: score(q, r) });
    };
    offer(0, 0);
    // Each accepted cell touches existing land, so every playable cell is reachable.
    while (land.size < generation.cellCount) {
        const { id, q, r } = frontier.pop();
        land.set(id, { id, q, r });
        for (const [dq, dr] of HEX_DIRECTIONS) offer(q + dq, r + dr);
    }
    const cells = [...land.values()], biomes = Object.keys(layout.biomes);
    for (let i = biomes.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [biomes[i], biomes[j]] = [biomes[j], biomes[i]];
    }
    const sources = [cells[Math.floor(random() * cells.length)]];
    while (sources.length < biomes.length) {
        let best = null, bestScore = -1;
        for (const cell of cells) {
            const spacing = Math.min(...sources.map((source) => distance(source, cell)));
            const value = spacing * (0.85 + hash(cell.q, cell.r, seed ^ 0xbb67ae85) * 0.3);
            if (value > bestScore) { best = cell; bestScore = value; }
        }
        sources.push(best);
    }
    // Multi-source flood fill keeps each biome connected to its own seed.
    const regions = new MinHeap((a, b) => a.cost - b.cost || a.region - b.region);
    sources.forEach((cell, region) => regions.push({ id: cell.id, region, cost: 0 }));
    while (regions.size) {
        const current = regions.pop(), cell = land.get(current.id);
        if (cell.biome) continue;
        cell.biome = biomes[current.region];
        cell.planeSceneId = layout.biomes[cell.biome].sceneId;
        const variant = Math.floor(hash(cell.q, cell.r, seed ^ 0x3c6ef372) * 10);
        cell.tile = `${cell.biome}_${String(variant).padStart(2, '0')}`;
        for (const [dq, dr] of HEX_DIRECTIONS) {
            const next = land.get(`${cell.q + dq},${cell.r + dr}`);
            if (!next || next.biome) continue;
            const cost = current.cost + 1 + noise(next.q, next.r, seed ^ 0xa54ff53a, 6) * 1.4;
            regions.push({ id: next.id, region: current.region, cost });
        }
    }
    generateStrategicTerrain(cells, seed);
    return { kind: 'generated', seed, generatorVersion: generation.version, layoutVersion: 4,
        cells: cells.sort((a, b) => a.r - b.r || a.q - b.q) };
}
