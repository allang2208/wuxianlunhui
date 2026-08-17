/**
 * 世界-122 怪物群 Node 仿真（2026-08-16）
 *
 * 用真实源码模块（WallSystem/PathFinder/MovementSystem/PerceptionSystem）
 * 复现两个问题：
 *   A. 大量怪推进后「卡在墙边无法攻击」——含基地门（BuildableGate 可攻击
 *      但 _findBlockingGateHole 让怪在门前等待不转火）场景；
 *   B. 「怪物刷在基地旁」——逐帧采样位置，检测 >400px 跳变（瞬移）。
 *
 * 用法：node tools/sim-defense-crowd.mjs
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
const { MovementSystem } = await import(pathToFileURL(path.join(ROOT, 'src/systems/movement-system.js')).href);
const { PerceptionSystem } = await import(pathToFileURL(path.join(ROOT, 'src/systems/perception-system.js')).href);
const { Game } = await import(pathToFileURL(path.join(ROOT, 'src/game.js')).href);
const { distanceToEntityShape } = await import(pathToFileURL(path.join(ROOT, 'src/utils/collision-helpers.js')).href);

// ==================== 世界-122 场景搭建（复刻 _buildBaseRoom） ====================
const BASE = { x: 900, y: 2048, hp: 5000, radius: 72 };
const RX = 512, RY = 256;
const CORNER_EXT = 29, OPEN_EDGE = 'RB';
const FACE_V = { A: { x: -88, y: -21 }, B: { x: 88, y: -108 } };
const FACE_H = { A: { x: -88, y: -108 }, B: { x: 88, y: -21 } };
const FACE_LEN = Math.hypot(FACE_V.B.x - FACE_V.A.x, FACE_V.B.y - FACE_V.A.y); // 196.33
const STEP = FACE_LEN - 40; // 端帽叠合 40px
const SIZE = 4096;
const GATE_HALF = 88;    // worldFaceLen 176 / 2（一格 = 一堵墙，2026-08-16）

const T = { x: BASE.x, y: BASE.y - RY };
const R = { x: BASE.x + RX, y: BASE.y };
const B = { x: BASE.x, y: BASE.y + RY };
const L = { x: BASE.x - RX, y: BASE.y };
const EDGES = [
    { key: 'TL', from: T, to: L, orient: 'v' },
    { key: 'TR', from: T, to: R, orient: 'h' },
    { key: 'LB', from: L, to: B, orient: 'h' },
    { key: 'RB', from: R, to: B, orient: 'v' },
];

/** 复刻 _buildBaseRoom 的掩体 face 线段 + 实体（跳过门洞） */
function buildBaseRoom() {
    const covers = [];
    const segs = [];
    let gatePos = null; // 2026-08-17：门占一个完整墙位（大小=墙，face 196.77）
    for (const e of EDGES) {
        const dx = e.to.x - e.from.x, dy = e.to.y - e.from.y;
        const len = Math.hypot(dx, dy);
        const ux = dx / len, uy = dy / len;
        const g = e.orient === 'v' ? FACE_V : FACE_H;
        const projA = g.A.x * ux + g.A.y * uy;
        const projB = g.B.x * ux + g.B.y * uy;
        const towardV = projA < projB ? 'A' : 'B';
        const halfToV = Math.abs(towardV === 'A' ? projA : projB);
        const halfAway = Math.abs(towardV === 'A' ? projB : projA);
        const t0 = -CORNER_EXT + halfToV;
        const tLast = len + CORNER_EXT - halfAway;
        const span = tLast - t0;
        const n = Math.max(2, Math.ceil(span / STEP) + 1);
        const spacing = n > 1 ? span / (n - 1) : 0;
        // 单边 4 段（用户口径）：openEdge 第 2 段（i=2）替换为门，其余为墙
        const gateSlot = e.key === OPEN_EDGE ? Math.min(n - 1, Math.max(1, Math.floor(n / 2))) : null;
        for (let i = 0; i < n; i++) {
            const t = t0 + i * spacing;
            if (i === gateSlot) {
                gatePos = {
                    x: Math.round(e.from.x + ux * t),
                    y: Math.round(e.from.y + uy * t),
                };
                continue; // 该墙位由门占据
            }
            const x = Math.round(e.from.x + ux * t);
            const y = Math.round(e.from.y + uy * t);
            const tVal = t;
            const edgeKey = e.key;
            const oUx = ux, oUy = uy, oLen = len;
            const cover = {
                id: `cover_${e.key}_${i}`, x, y, _t: tVal, _edge: edgeKey,
                _ux: oUx, _uy: oUy, _len: oLen, _halfToV: halfToV, _halfAway: halfAway,
                active: true, hp: 1100, maxHp: 1100,
                _isDefenseStructure: true, _faction: 'player',
                name: '掩体·D级',
                collisionRadius: 26,
            };
            covers.push(cover);
            const a = { x: x + g.A.x, y: y + g.A.y };
            const bb = { x: x + g.B.x, y: y + g.B.y };
            segs.push({ x1: a.x, y1: a.y, x2: bb.x, y2: bb.y, halfThick: 26, _cover: true, _owner: cover });
            cover._coverSeg = segs[segs.length - 1];
        }
    }
    return { covers, segs, gatePos };
}

/** 基地门（占 RB 边一个墙位，默认关闭）：可攻击实体 + 门洞段 */
function buildGate(gatePos) {
    const gx = gatePos.x;
    const gy = gatePos.y;
    const midY = gy - 65;
    const A = { x: Math.round(gx - GATE_HALF), y: Math.round(midY + GATE_HALF * 0.5) };
    const BB = { x: Math.round(gx + GATE_HALF), y: Math.round(midY - GATE_HALF * 0.5) };
    const gate = {
        id: 'base_gate', x: gx, y: gy,
        active: true, hp: 800, maxHp: 800,
        _isDefenseStructure: true, _isCoverGate: true, _faction: 'player',
        name: '铁栅栏门',
        collisionRadius: 26,
    };
    const seg = { x1: A.x, y1: A.y, x2: BB.x, y2: BB.y, halfThick: 26, _gate: true, _gateHole: true };
    gate._gateSeg = seg; // 与游戏 BuildableGate 一致：_retargetBlockingGate 靠它回链门实体
    // 与游戏 BuildableGate 的 footprint 一致（COVER_FOOT.v: 198×133, offY -68）：
    // distanceToEntityShape 走矩形分支，贴墙怪对门的真实距离才能算对
    gate.collisionShape = 'rect';
    gate.collisionWidth = 198;
    gate.collisionHeight = 133;
    gate.collider = { x: gx, y: gy - 68, radius: 0 };
    return { gate, seg, A, B: BB };
}

/** 复刻游戏 trimCoverSegsForGate：裁掉与门 face 重叠的共线墙碰撞段（2026-08-17 同步） */
function trimCoversAtGate(segs, gateSeg) {
    const A = { x: gateSeg.x1, y: gateSeg.y1 };
    const B = { x: gateSeg.x2, y: gateSeg.y2 };
    const gdx = B.x - A.x, gdy = B.y - A.y;
    const glen = Math.hypot(gdx, gdy) || 1;
    const gux = gdx / glen, guy = gdy / glen;
    const proj = (p) => (p.x - A.x) * gux + (p.y - A.y) * guy;
    const distToLine = (p) => Math.abs((p.x - A.x) * guy - (p.y - A.y) * gux);
    const backoff = 26 + 30; // halfThick + 单位半径
    for (const s of segs) {
        if (!s || !s._cover) continue;
        if (distToLine({ x: s.x1, y: s.y1 }) > 6 || distToLine({ x: s.x2, y: s.y2 }) > 6) continue;
        const a = proj({ x: s.x1, y: s.y1 });
        const b = proj({ x: s.x2, y: s.y2 });
        const lo = Math.min(a, b), hi = Math.max(a, b);
        if (hi <= 0 || lo >= glen) continue;
        const ends = [
            { x: s.x1, y: s.y1, p: a },
            { x: s.x2, y: s.y2, p: b },
        ];
        for (const e of ends) {
            if (e.p < 0 || e.p > glen) continue;
            if (e.p < glen / 2) { e.x = A.x - gux * backoff; e.y = A.y - guy * backoff; }
            else { e.x = B.x + gux * backoff; e.y = B.y + guy * backoff; }
        }
        s.x1 = ends[0].x; s.y1 = ends[0].y; s.x2 = ends[1].x; s.y2 = ends[1].y;
    }
}

function setupWorld({ withTrees = false } = {}) {
    WallSystem.walls = [
        { x: 0, y: 0, w: SIZE, h: 20, noVisual: true },
        { x: 0, y: SIZE - 20, w: SIZE, h: 20, noVisual: true },
        { x: 0, y: 0, w: 20, h: SIZE, noVisual: true },
        { x: SIZE - 20, y: 0, w: 20, h: SIZE, noVisual: true },
    ];
    WallSystem.isoSegments = [];
    WallSystem.trees = [];
    const { covers, segs, gatePos } = buildBaseRoom();
    const { gate, seg: gateSeg } = buildGate(gatePos);
    trimCoversAtGate(segs, gateSeg); // 与 BuildableGate 构造时的 trimCoverSegsForGate 同口径
    WallSystem.isoSegments.push(...segs, gateSeg);
    const base = {
        id: 'defense_base', x: BASE.x, y: BASE.y,
        active: true, hp: BASE.hp, maxHp: BASE.hp,
        _isDefenseStructure: true, _isDefenseBase: true, _faction: 'player',
        name: '基地核心',
        collisionRadius: 72,
    };
    if (withTrees) {
        // 复刻散布树可能压到刷怪点的情形（footprint 矩形墙）
        for (const [tx, ty] of [[3900, 640], [3950, 1340], [3700, 3210]]) {
            WallSystem.walls.push({ x: tx - 60, y: ty - 60, w: 120, h: 120, height: 60, noVisual: true, _iso: true });
            WallSystem.trees.push({ x: tx, y: ty, radius: 60, collisionRadius: 60 });
        }
    }
    pathFinder.invalidateCache();
    regionIndex.markDirty();
    return { covers, gate, base };
}

function mkMonster(x, y, overrides = {}) {
    return {
        id: `m_${Math.random().toString(36).slice(2, 8)}`,
        x, y, vx: 0, vy: 0,
        active: true, hp: 100, maxHp: 100,
        groundRadius: 28, collisionRadius: 28, friction: 0.82, accel: 0.7,
        speed: 187.5, maxSpeed: 187.5, rotation: 0, isMoving: false,
        attackRange: 100, attackDistance: 100,
        _faction: 'enemy', ai: {},
        hasStatusEffect: () => false,
        _preferDefenseTargets: true, _defenseMonster: true,
        _alertRange: 3800, _aggroRange: 3800, _engageHostileRange: 320,
        target: null, _tacticalTarget: null, _specialTacticalTarget: null,
        _lastKnownTargetPos: null, _searchTarget: null, _lostSightTimer: 0,
        ...overrides,
    };
}

const SPAWN_POINTS = [
    [3936, 600], [3936, 1350], [3936, 2048], [3936, 2746], [3936, 3496],
    [3736, 900], [3736, 3196],
];

function spawnMonster(type, entities, withTrees) {
    const pt = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    const m = mkMonster(pt[0], pt[1]);
    if (WallSystem.canMoveTo && !WallSystem.canMoveTo(m.x, m.y, m.groundRadius)) {
        const safe = WallSystem.findSafeSpawn(m.x, m.y, m.groundRadius);
        m.x = safe.x; m.y = safe.y;
    }
    entities.set(m.id, m);
    return m;
}

const entities = new Map();
Game.entities = entities; // movement-system 的 _retargetBlockingGate 扫 Game.entities
const world = setupWorld({ withTrees: true });
for (const c of world.covers) entities.set(c.id, c);
entities.set(world.gate.id, world.gate);
entities.set(world.base.id, world.base);

const monsters = [];
for (let i = 0; i < 12; i++) monsters.push(spawnMonster('zombie', entities, true));

console.log('=== 刷怪落点（含树阻挡场景） ===');
const nearBase = [];
for (const m of monsters) {
    const d = Math.hypot(m.x - BASE.x, m.y - BASE.y);
    if (d < 1000) nearBase.push({ id: m.id, x: m.x, y: m.y, d: Math.round(d) });
}
monsters.forEach((m) => console.log(`  ${m.id} (${m.x},${m.y}) dBase=${Math.round(Math.hypot(m.x - BASE.x, m.y - BASE.y))}`));
console.log(nearBase.length ? `  ⚠ 有怪落点距基地 <1000px: ${JSON.stringify(nearBase)}` : '  ✓ 全部落点距基地 ≥1000px');

// ==================== 模拟推进 ====================
const realNow = Date.now;
let vNow = realNow();
Date.now = () => vNow;

const dt = 16.67;
const TOTAL_FRAMES = 1800; // 30s 游戏时间
const positions = [];
const jumps = [];
const targetSwitches = new Map(monsters.map((m) => [m.id, 0]));

for (let f = 0; f < TOTAL_FRAMES; f++) {
    MovementSystem.beginFrame();
    for (const m of monsters) {
        if (!m.active) continue;
        const before = m.target;
        PerceptionSystem.update(m, dt, entities);
        MovementSystem.update(m, dt, entities);
        if (m.target !== before) targetSwitches.set(m.id, (targetSwitches.get(m.id) || 0) + 1);
    }
    vNow += dt;
    if (f % 100 === 0) {
        const snap = {};
        for (const m of monsters) if (m.active) snap[m.id] = { x: m.x, y: m.y };
        positions.push(snap);
    }
}

// 跳变检测
for (let i = 1; i < positions.length; i++) {
    for (const m of monsters) {
        const a = positions[i - 1][m.id], b = positions[i][m.id];
        if (a && b) {
            const d = Math.hypot(b.x - a.x, b.y - a.y);
            if (d > 400) jumps.push({ id: m.id, t: i * (100 * dt / 1000).toFixed(0) + 's', from: [a.x, a.y], to: [b.x, b.y], d: Math.round(d) });
        }
    }
}
Date.now = realNow;

console.log('\n=== 30s 后状态 ===');
const reachOf = (m) => (m.attackDistance !== undefined ? m.attackDistance : (m.attackRange || 70) * 1.15);
const segDist = (px, py) => {
    let best = Infinity;
    for (const s of WallSystem.isoSegments) {
        if (!s || s.x1 === undefined) continue;
        const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
        const len = Math.hypot(dx, dy) || 1;
        let t = ((px - s.x1) * dx + (py - s.y1) * dy) / (len * len);
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
        if (d < best) best = d;
    }
    return best;
};
const stats = [];
for (const m of monsters) {
    if (!m.active) continue;
    const t = m.target;
    const dist = t ? Math.hypot(m.x - t.x, m.y - t.y) : Infinity;
    stats.push({
        id: m.id,
        pos: [Math.round(m.x), Math.round(m.y)],
        target: t ? (t.name || t.id) : null,
        tIsStruct: !!(t && t._isDefenseStructure),
        distToTarget: Math.round(dist),
        inReach: t ? distanceToEntityShape(t, m.x, m.y) <= reachOf(m) : false,
        wallDist: Math.round(segDist(m.x, m.y)),
        moving: m.isMoving === true,
    });
}
for (const s of stats) console.log(`  ${JSON.stringify(s)}`);

const tgtCount = {};
for (const m of monsters) {
    if (m.target) tgtCount[m.target.name || m.target.id] = (tgtCount[m.target.name || m.target.id] || 0) + 1;
}
console.log('目标分布:', JSON.stringify(tgtCount));
console.log('目标切换次数(30s):', JSON.stringify(Object.fromEntries(targetSwitches)));
const pingpong = [...targetSwitches.values()].filter((n) => n >= 10).length;
console.log(pingpong ? `  ⚠ ${pingpong} 只怪频繁换目标（≥10 次）` : '  ✓ 无目标 ping-pong（每只 <10 次）');

const stuck = stats.filter((s) => !s.inReach && s.wallDist < 40);
console.log(`\n卡墙且够不着目标: ${stuck.length} 只`, stuck.length ? JSON.stringify(stuck) : '');
console.log(`跳变(>400px/1.67s): ${jumps.length} 次`, jumps.length ? JSON.stringify(jumps) : '');

// ==================== 专项：12 只僵尸堵在基地外墙前（目标=基地） ====================
console.log('\n=== 专项：墙前拥挤（12 只僵尸贴墙，目标=基地，10s） ===');
{
    const crowd = [];
    // 沿 RB 墙外排成密集队形（从右往左，覆盖墙段）
    for (let i = 0; i < 12; i++) {
        const m = mkMonster(1500 - i * 35, 2140 + i * 8, { id: `wall_crowd_${i}` });
        m.target = entities.get(world.base.id); // 强制目标=基地（墙后）
        entities.set(m.id, m);
        crowd.push(m);
    }
    for (let f = 0; f < 600; f++) {
        MovementSystem.beginFrame();
        for (const m of crowd) {
            if (!m.active) continue;
            PerceptionSystem.update(m, dt, entities);
            MovementSystem.update(m, dt, entities);
        }
        vNow += dt;
    }
    const eff = (m) => (m.attackDistance !== undefined ? m.attackDistance : (m.attackRange || 70) * 1.15);
    const rows = [];
    for (const m of crowd) {
        const t = m.target;
        const canHit = t ? distanceToEntityShape(t, m.x, m.y) <= eff(m) : false;
        rows.push({
            id: m.id,
            pos: [Math.round(m.x), Math.round(m.y)],
            target: t ? (t.name || t.id) : 'null',
            canHit,
        });
    }
    for (const r of rows) console.log(`  ${JSON.stringify(r)}`);
    const attacking = rows.filter((r) => r.canHit).length;
    const onBase = rows.filter((r) => r.target === '基地核心').length;
    console.log(`  能攻击 ${attacking}/12 · 仍锁基地 ${onBase}/12`);
    console.log(attacking >= 8 ? '  ✓ 修复生效：拥挤墙前的怪已分散攻击' : '  ✗ 仍大量堵墙发呆');
    for (const m of crowd) entities.delete(m.id);

    // 低占用变体：仅 3 只贴墙锁基地（基地未超容量）——够不着也应换可达掩体
    const few = [];
    for (let i = 0; i < 3; i++) {
        const m = mkMonster(1300 - i * 30, 2110 + i * 10, { id: `wall_few_${i}` });
        m.target = entities.get(world.base.id);
        entities.set(m.id, m);
        few.push(m);
    }
    for (let f = 0; f < 600; f++) {
        MovementSystem.beginFrame();
        for (const m of few) {
            if (!m.active) continue;
            PerceptionSystem.update(m, dt, entities);
            MovementSystem.update(m, dt, entities);
        }
        vNow += dt;
    }
    const fewRows = few.map((m) => {
        const t = m.target;
        return {
            id: m.id,
            target: t ? (t.name || t.id) : 'null',
            canHit: t ? distanceToEntityShape(t, m.x, m.y) <= eff(m) : false,
        };
    });
    const fewHit = fewRows.filter((r) => r.canHit).length;
    const fewOnBase = fewRows.filter((r) => r.target === '基地核心').length;
    for (const r of fewRows) console.log(`  ${JSON.stringify(r)}`);
    console.log(`  [低占用] 能攻击 ${fewHit}/3 · 仍锁基地 ${fewOnBase}/3`);
    console.log(fewHit === 3 && fewOnBase === 0 ? '  ✓ 低占用也换目标（够不着必换）' : '  ✗ 低占用仍发呆');
    for (const m of few) entities.delete(m.id);
}

// ==================== 专项：怪锁定基地但被关着的门挡住 → 应转火门 ====================
console.log('\n=== 专项：关着的基地门前（目标=基地）是否转火门 ===');
{
    const gate = entities.get(world.gate.id);
    // 2026-08-17：门已从 RB 边中点移到第 3 个墙位（i=2，中心 ~(1066,2221)），
    // 探针沿 基地→门 连线向外 380px 出生，直线逼近时恰好切入门的纯洞区（t∈[312,405]）
    const gm = mkMonster(1330, 2496, { id: 'gate_probe', attackRange: 70, attackDistance: 70 });
    gm.target = entities.get(world.base.id); // 强制目标=基地（路径必经关着的门洞）
    entities.set(gm.id, gm);
    for (let f = 0; f < 600; f++) {
        MovementSystem.beginFrame();
        // 跳过感知：强制目标=基地，验证「路径被关着的门挡 → 卡住 → 转火门」
        // （真实游戏中感知会先把怪分摊到附近掩体，本专项只测门转火链路）
        MovementSystem.update(gm, dt, entities);
        vNow += dt;
        if (f % 100 === 0) {
            console.log(`  [t=${Math.round(f * dt / 1000)}s] pos=(${Math.round(gm.x)},${Math.round(gm.y)}) target=${gm.target ? (gm.target.name || gm.target.id) : 'null'} targetIsGate=${!!(gm.target && gm.target._isCoverGate)}`);
        }
    }
    const d = Math.hypot(gm.x - gate.x, gm.y - gate.y);
    const gateTargeted = gm.target && gm.target._isCoverGate;
    console.log(`  门前怪位置 (${Math.round(gm.x)},${Math.round(gm.y)}) 距门 ${Math.round(d)}px`);
    console.log(`  目标=${gm.target ? (gm.target.name || gm.target.id) : 'null'} 转火门=${gateTargeted}`);
    console.log(gateTargeted ? '  ✓ 修复生效：门口等待的怪已转火攻击门' : '  ✗ 仍未转火（门口站桩）');
}
Date.now = realNow;
console.log('\ndone');
