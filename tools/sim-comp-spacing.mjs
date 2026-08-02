// 纯数据模拟（2026-08-01）：验证预制组合两条新规则的可行性
// - 规则 1：同房间不重复预制 key（池 10 组 vs 房间 3 要 8 组）
// - 规则 2：组合间最小间隔 净间隔 = 锚距 − (r新 + r已) > 0.5×max(r新, r已)
// 复刻 obstacle-spawn-system._spawnPrefabCompositions 的几何/校验（同一公式），
// 用真实 data/wall-prefabs.json + wall-system ISO_WALL_GEO 统计三房间实测放下组数。
// 用法: node tools/sim-comp-spacing.mjs [trials]
import fs from 'node:fs';
import { ISO_WALL_GEO } from '../src/world/wall-system.js';

const TRIALS = Number(process.argv[2]) || 300;
const lib = JSON.parse(fs.readFileSync('data/wall-prefabs.json', 'utf8'));

const geoOf = (tex) => Object.values(ISO_WALL_GEO).find(g => g.tex === tex) || null;

// —— 复刻 _prefabCompositionPool：「火把墙」之后、纯障碍物组合 ——
const keys = Object.keys(lib);
const i0 = keys.indexOf('火把墙');
const pool = keys.slice(i0 + 1).filter(k => {
    const pf = lib[k];
    if (!pf || !Array.isArray(pf.pieces) || !pf.pieces.length) return false;
    return pf.pieces.every(q => { const g = geoOf(q.tex); return !g || g.category === 'obstacle'; });
});

// —— 复刻 _pieceHalfDiag / _groundRadius ——
function halfDiag(tex, scaleX, scaleY, rot = 0) {
    const g = geoOf(tex);
    const w = g ? g.w : 60, h = g ? g.h : 60;
    let hw = w * Math.abs(scaleX ?? 1) / 2;
    let hd = h * Math.abs(scaleY ?? scaleX ?? 1) / 2;
    if (rot) {
        const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
        const nw = hw * c + hd * s;
        hd = hw * s + hd * c; hw = nw;
    }
    return Math.hypot(hw, hd);
}
function groundRadius(tex, scaleX, scaleY) {
    const g = geoOf(tex);
    if (!g) return 30;
    const hw = (g.foot ? g.foot.w : g.w) * Math.abs(scaleX ?? 1) / 2;
    const hd = (g.foot ? g.foot.d : g.w) * Math.abs(scaleY ?? scaleX ?? 1) / 2;
    return Math.max(hw, hd);
}

// —— 每组合的整体包围半径（与实现同公式）——
const compInfo = {};
for (const k of pool) {
    const pf = lib[k];
    let bx = pf.cx, by = pf.cy;
    if (bx == null || by == null) {
        bx = pf.pieces.reduce((s, q) => s + q.x, 0) / pf.pieces.length;
        by = pf.pieces.reduce((s, q) => s + q.y, 0) / pf.pieces.length;
    }
    const items = pf.pieces.map(q => ({
        tex: q.tex, dx: q.x - bx, dy: q.y - by,
        scaleX: q.scaleX ?? 1, scaleY: q.scaleY ?? q.scaleX ?? 1, rotation: q.rotation || 0,
    }));
    let r = 0;
    for (const it of items) r = Math.max(r, Math.hypot(it.dx, it.dy) + halfDiag(it.tex, it.scaleX, it.scaleY, it.rotation));
    compInfo[k] = { items, r };
}

// —— 复刻 _rollBackWallAnchor / _insideDiamond ——
function rollAnchor(bounds, dist) {
    const { cx, cy, rx, ry } = bounds;
    const T = { x: cx, y: cy - ry };
    const V = Math.random() < 0.5 ? { x: cx - rx, y: cy } : { x: cx + rx, y: cy };
    const t = 0.15 + Math.random() * 0.7;
    const P = { x: T.x + (V.x - T.x) * t, y: T.y + (V.y - T.y) * t };
    let nx = -(V.y - T.y), ny = V.x - T.x;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    if ((cx - P.x) * nx + (cy - P.y) * ny < 0) { nx = -nx; ny = -ny; }
    const d = dist[0] + Math.random() * Math.max(0, dist[1] - dist[0]);
    return { x: P.x + nx * d, y: P.y + ny * d };
}
const inside = (b, pt, inset) =>
    Math.abs(pt.x - b.cx) / Math.max(1, b.rx - inset) + Math.abs(pt.y - b.cy) / Math.max(1, b.ry - inset) <= 1;

// —— 复刻 _spawnPrefabCompositions 主循环（去重 + 间隔 + 逐件校验）——
function placeRoom(bounds, count, avoid, dist = [50, 130]) {
    const used = new Set(), placedComps = [];
    let placed = 0, tries = 0;
    while (placed < count && tries < 60) {
        tries++;
        const avail = pool.filter(k => !used.has(k));
        if (!avail.length) break;
        const key = avail[Math.floor(Math.random() * avail.length)];
        const { items, r: compR } = compInfo[key];
        const anchor = rollAnchor(bounds, dist);
        if (placedComps.some(pc =>
            Math.hypot(anchor.x - pc.x, anchor.y - pc.y) - (compR + pc.r) <= 0.5 * Math.max(compR, pc.r))) continue;
        let ok = true;
        for (const it of items) {
            const pt = { x: anchor.x + it.dx, y: anchor.y + it.dy };
            const rad = groundRadius(it.tex, it.scaleX, it.scaleY);
            if (!inside(bounds, pt, 40 + rad)) { ok = false; break; }
            if (avoid.some(a => Math.hypot(pt.x - a.x, pt.y - a.y) < a.r + rad)) { ok = false; break; }
        }
        if (!ok) continue;
        used.add(key);
        placedComps.push({ key, x: anchor.x, y: anchor.y, r: compR });
        placed++;
    }
    return placedComps;
}

const DIAMOND_SLOPE = 0.5774;
const radii = (size) => { const rx = size * 1.2; return { rx, ry: rx * DIAMOND_SLOPE }; };

console.log(`池子 ${pool.length} 组（「火把墙」之后）：`);
for (const k of pool) console.log(`  ${k}  件数=${compInfo[k].items.length}  r=${compInfo[k].r.toFixed(0)}`);

// 房间 1/2（normalSize 1024）：去路门在 RB 边中点（r220）；房间 1 另有出生点/入场门（不在后墙区，从简）
const b12 = (() => { const { rx, ry } = radii(1024); return { cx: 0, cy: 0, rx, ry }; })();
const avoid12 = [{ x: b12.rx / 2, y: b12.ry / 2, r: 220 }];
// 房间 3（eliteSize 1792）：来路门 LT 边中点 + 出口门 RB 边中点（均 r220）
const b3 = (() => { const { rx, ry } = radii(1792); return { cx: 0, cy: 0, rx, ry }; })();
const avoid3 = [{ x: -b3.rx / 2, y: -b3.ry / 2, r: 220 }, { x: b3.rx / 2, y: b3.ry / 2, r: 220 }];
console.log(`\n房间1/2 bounds rx=${b12.rx.toFixed(0)} ry=${b12.ry.toFixed(0)}；房间3 bounds rx=${b3.rx.toFixed(0)} ry=${b3.ry.toFixed(0)}`);

function stats(name, bounds, count, avoid) {
    const dist = {};
    let gapViol = 0, dupViol = 0;
    for (let i = 0; i < TRIALS; i++) {
        const comps = placeRoom(bounds, count, avoid);
        dist[comps.length] = (dist[comps.length] || 0) + 1;
        const keys2 = comps.map(c => c.key);
        if (new Set(keys2).size !== keys2.length) dupViol++;
        for (let a = 0; a < comps.length; a++) for (let b = a + 1; b < comps.length; b++) {
            const net = Math.hypot(comps[a].x - comps[b].x, comps[a].y - comps[b].y) - (comps[a].r + comps[b].r);
            if (net <= 0.5 * Math.max(comps[a].r, comps[b].r)) gapViol++;
        }
    }
    console.log(`\n${name}（目标 ${count} 组，${TRIALS} 次模拟）放下组数分布: `,
        Object.keys(dist).sort().map(k => `${k}组:${(dist[k] / TRIALS * 100).toFixed(1)}%`).join('  '));
    console.log(`  规则校验：重复key违规=${dupViol}，间隔违规=${gapViol}`);
}
stats('房间1/2', b12, 3, avoid12);
stats('房间3', b3, 8, avoid3);
