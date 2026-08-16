/**
 * 防守怪目标分摊性能基准（2026-08-16）
 * 用真实源码模块量化 computeStructureOccupancy / pickStructureTarget 的单次耗时，
 * 并按世界-122 最坏规模（40 怪 × 25 结构）外推每秒总开销。
 * 用法：node tools/perf-defense-targeting.mjs
 */
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import('../scripts/register-json-loader.mjs');
register(pathToFileURL(path.join(ROOT, 'tools/pathfinding-hooks.mjs')).href, pathToFileURL(ROOT + path.sep).href);

const { WallSystem } = await import(pathToFileURL(path.join(ROOT, 'src/world/wall-system.js')).href);
const { pathFinder } = await import(pathToFileURL(path.join(ROOT, 'src/ai/pathfinder.js')).href);
const { regionIndex } = await import(pathToFileURL(path.join(ROOT, 'src/ai/region-index.js')).href);
const { computeStructureOccupancy, pickStructureTarget } = await import(
    pathToFileURL(path.join(ROOT, 'src/ai/defense-targeting.js')).href
);

// 复刻基地菱形房（掩体面线）供 LOS 过滤使用
const BASE = { x: 900, y: 2048 };
const RX = 512, RY = 256;
const FACE_V = { A: { x: -88, y: -21 }, B: { x: 88, y: -108 } };
const FACE_H = { A: { x: -88, y: -108 }, B: { x: 88, y: -21 } };
const STEP = Math.hypot(176, 87) - 40;
const T = { x: BASE.x, y: BASE.y - RY };
const R = { x: BASE.x + RX, y: BASE.y };
const B = { x: BASE.x, y: BASE.y + RY };
const L = { x: BASE.x - RX, y: BASE.y };
const EDGES = [
    { from: T, to: L, orient: 'v' },
    { from: T, to: R, orient: 'h' },
    { from: L, to: B, orient: 'h' },
    { from: R, to: B, orient: 'v' },
];

function setupWorld() {
    WallSystem.walls = [{ x: 0, y: 0, w: 4096, h: 20, noVisual: true }];
    WallSystem.isoSegments = [];
    WallSystem.trees = [];
    const structures = [];
    for (const e of EDGES) {
        const dx = e.to.x - e.from.x, dy = e.to.y - e.from.y;
        const len = Math.hypot(dx, dy);
        const ux = dx / len, uy = dy / len;
        const g = e.orient === 'v' ? FACE_V : FACE_H;
        const n = 5;
        for (let i = 0; i < n; i++) {
            const t = len * (i + 0.5) / n;
            const x = e.from.x + ux * t;
            const y = e.from.y + uy * t;
            const cover = {
                id: `cover_${i}_${e.orient}`, x, y,
                active: true, hp: 1100, _isDefenseStructure: true, _faction: 'player',
                collisionRadius: 26, name: '掩体·D级',
            };
            cover._coverSeg = {
                x1: x + g.A.x, y1: y + g.A.y, x2: x + g.B.x, y2: y + g.B.y,
                halfThick: 26, _cover: true, _owner: cover,
            };
            WallSystem.isoSegments.push(cover._coverSeg);
            structures.push(cover);
        }
    }
    const base = {
        id: 'defense_base', x: BASE.x, y: BASE.y,
        active: true, hp: 5000, _isDefenseStructure: true, _faction: 'player',
        collisionRadius: 72, name: '基地核心',
    };
    const gate = {
        id: 'base_gate', x: 1156, y: 2176,
        active: true, hp: 800, _isDefenseStructure: true, _isCoverGate: true, _faction: 'player',
        collisionRadius: 26, name: '铁栅栏门',
        _gateSeg: { x1: 1021, y1: 2179, x2: 1291, y2: 2043, halfThick: 26, _gate: true, _gateHole: true },
    };
    WallSystem.isoSegments.push(gate._gateSeg);
    structures.push(base, gate);
    pathFinder.invalidateCache();
    regionIndex.markDirty();
    return structures;
}

const structures = setupWorld();
const entities = new Map(structures.map((s) => [s.id, s]));
const monsters = [];
for (let i = 0; i < 40; i++) {
    const x = 3936 - (i % 8) * 30;
    const y = 600 + Math.floor(i / 8) * 400;
    const m = {
        id: `m_${i}`, x, y, active: true, hp: 100,
        _preferDefenseTargets: true, _defenseMonster: true,
        attackRange: 100, attackDistance: 100,
        target: i % 3 === 0 ? base() : (i % 3 === 1 ? gate() : structures[1]),
        collisionRadius: 28,
    };
    entities.set(m.id, m);
    monsters.push(m);
}
function base() { return structures.find((s) => s.id === 'defense_base'); }
function gate() { return structures.find((s) => s.id === 'base_gate'); }

const N = 2000;
// 1) 占用表
let t0 = performance.now();
let occ;
for (let i = 0; i < N; i++) occ = computeStructureOccupancy(entities);
const occMs = (performance.now() - t0) / N;

// 2) 分摊挑选（含 LOS 过滤；模拟怪在墙前/远处混合）
let pickTotal = 0;
const perMonster = [];
for (const m of monsters) {
    t0 = performance.now();
    for (let i = 0; i < 200; i++) pickStructureTarget(m, entities, occ);
    const ms = (performance.now() - t0) / 200;
    perMonster.push(ms);
    pickTotal += ms;
}
const pickAvg = pickTotal / monsters.length;
const pickMax = Math.max(...perMonster);

// 3) 外推：每怪每秒 ≈ 感知 tick 10 次（100ms）+ 扫描 2 次（500ms）+ pacing 5 次（200ms）
//    实际 _updateTargetState 内 100ms tick 时只算占用表，500ms 扫描才调 pick
const callsPerSec = 40 * (10 + 2);
const secMs = callsPerSec * occMs + 40 * 2 * pickAvg;

console.log('=== 防守怪目标分摊性能 ===');
console.log(`结构数=${structures.length} 怪数=${monsters.length}`);
console.log(`computeStructureOccupancy 单次: ${(occMs * 1000).toFixed(2)} µs`);
console.log(`pickStructureTarget 平均:      ${(pickAvg * 1000).toFixed(2)} µs（单怪）`);
console.log(`pickStructureTarget 最慢:      ${(pickMax * 1000).toFixed(2)} µs（单怪）`);
console.log(`外推总开销（40 怪 × 12 次/秒）: ≈ ${secMs.toFixed(2)} ms/s = 每帧 ${(secMs / 60).toFixed(3)} ms`);
console.log(`对比主线程帧预算（16.7ms）占比: ${((secMs / 60 / 16.7) * 100).toFixed(2)}%`);
