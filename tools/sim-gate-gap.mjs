// 诊断：门闸替换后下夹角左侧断口 —— 打印 L-B / R-B 两边沿边覆盖区间
import { WallSystem, ISO_WALL_GEO, ISO_WALL_HEIGHT, slopeFixOf } from '../src/world/wall-system.js';

const S = 1792, rx = 1.2 * S, ry = rx * 0.5774;
const cx = 4000, cy = 4000;
WallSystem.setWallStyle('default');
WallSystem.isoVisuals = [];
WallSystem.isoSegments = [];
WallSystem.buildIsoDiamondWalls(cx, cy, rx, ry);

const B = { x: cx, y: cy + ry }, L = { x: cx - rx, y: cy }, R = { x: cx + rx, y: cy };
const player = { x: cx, y: cy + ry - 80 };

// 与 _setupGate 相同的选择逻辑
const straightTex = ISO_WALL_GEO.straight.tex;
let best = null, bestD = Infinity;
for (const p of WallSystem.isoVisuals) {
    if (p.tex !== straightTex || p._corner) continue;
    const d = Math.hypot(p.x - player.x, p.y - player.y);
    if (d < bestD) { bestD = d; best = p; }
}
const [A, Bb] = WallSystem._pieceBaseSegments(best)[0];
console.log('替换件段:', A.x.toFixed(0), A.y.toFixed(0), '→', Bb.x.toFixed(0), Bb.y.toFixed(0));

// 门闸映射（zombie gate）
const g = ISO_WALL_GEO.gate;
const s = ISO_WALL_HEIGHT / g.wallH, sy = s * slopeFixOf(g);
const flip = !!best.flipX;
let x0, y0;
if (!flip) { x0 = A.x - g.base[0][0] * s; y0 = A.y - g.base[0][1] * sy; }
else { x0 = A.x - (g.w - g.base[0][0]) * s; y0 = A.y - g.base[0][1] * sy; }
const gcx = x0 + g.w * s / 2, gcy = y0 + g.h * sy / 2;
const tex2world = (tx, ty) => {
    let u = tx - g.w / 2; const v = ty - g.h / 2;
    if (flip) u = -u;
    return { x: gcx + u * s, y: gcy + v * sy };
};
const baseAt = (tx) => tex2world(tx, g.base[0][1] + (tx - g.base[0][0]) * g.slope);
const gateA = baseAt(g.base[0][0]), gateB = baseAt(g.base[1][0]);

WallSystem.isoVisuals.splice(WallSystem.isoVisuals.indexOf(best), 1);
const dups = WallSystem.removeSpanCoveringPieces([A, Bb]);
console.log('摘除重复件:', dups.length);

// 沿边覆盖分析：把每条边的件投影到边线上，找 >5px 的断口
function edgeCoverage(P, Q, label, extraSegs = []) {
    const ex = Q.x - P.x, ey = Q.y - P.y;
    const elen = Math.hypot(ex, ey);
    const ux = ex / elen, uy = ey / elen;
    const intervals = [];
    const collect = (a, b, tag) => {
        const pa = (a.x - P.x) * ux + (a.y - P.y) * uy;
        const pb = (b.x - P.x) * ux + (b.y - P.y) * uy;
        // 只收与边线共线的段（距边线 < 30px）
        const distA = Math.abs((a.x - P.x) * uy - (a.y - P.y) * ux);
        const distB = Math.abs((b.x - P.x) * uy - (b.y - P.y) * ux);
        if (distA > 30 || distB > 30) return;
        intervals.push([Math.min(pa, pb), Math.max(pa, pb), tag]);
    };
    for (const p of WallSystem.isoVisuals) {
        const segs = WallSystem._pieceBaseSegments(p);
        for (const [a, b] of segs) collect(a, b, p._corner ? 'corner' : 'tile');
    }
    for (const [a, b, tag] of extraSegs) collect(a, b, tag);
    intervals.sort((m, n) => m[0] - n[0]);
    console.log(`\n${label} (边长 ${elen.toFixed(0)}):`);
    let coverEnd = -Infinity;
    for (const [lo, hi, tag] of intervals) {
        const gap = lo - coverEnd;
        console.log(`  [${lo.toFixed(0)} .. ${hi.toFixed(0)}] ${tag}${gap > 5 ? `  <<< 断口 ${gap.toFixed(0)}px` : ''}`);
        coverEnd = Math.max(coverEnd, hi);
    }
}

edgeCoverage(L, B, 'L-B 边（左侧）', [[gateA, gateB, 'GATE']]);
edgeCoverage(R, B, 'R-B 边（右侧）');
