/**
 * test-gate-corner.mjs — 战斗房门闸"下夹角多一堵墙"回归（2026-07-29）
 * 场景：玩家从四顶点入场，_setupGate 替换最近直墙件（下夹角必中转角臂），
 * 验证 removeSpanCoveringPieces 摘除近整瓦重复件后门洞无残留碰撞段。
 * 运行：node scripts/test-gate-corner.mjs（挂入 npm test）
 */
import { WallSystem, ISO_WALL_GEO, ISO_WALL_HEIGHT, slopeFixOf } from '../src/world/wall-system.js';

// 线段-线段最小距离
function segSegDist(a1, a2, b1, b2) {
    const d = (p, q1, q2) => {
        const dx = q2.x - q1.x, dy = q2.y - q1.y;
        const len2 = dx * dx + dy * dy;
        let t = len2 ? ((p.x - q1.x) * dx + (p.y - q1.y) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (q1.x + t * dx), p.y - (q1.y + t * dy));
    };
    const inter = (o1, o2, p1, p2) => {
        const d1 = (p1.x - o1.x) * (o2.y - o1.y) - (p1.y - o1.y) * (o2.x - o1.x);
        const d2 = (p2.x - o1.x) * (o2.y - o1.y) - (p2.y - o1.y) * (o2.x - o1.x);
        const d3 = (o1.x - p1.x) * (p2.y - p1.y) - (o1.y - p1.y) * (p2.x - p1.x);
        const d4 = (o2.x - p1.x) * (p2.y - p1.y) - (o2.y - p1.y) * (p2.x - p1.x);
        return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
    };
    if (inter(a1, a2, b1, b2)) return 0;
    return Math.min(d(a1, b1, b2), d(a2, b1, b2), d(b1, a1, a2), d(b2, a1, a2));
}

function runCase(S, vertexName) {
    const rx = 1.2 * S, ry = rx * 0.5774;
    const cx = 4000, cy = 4000;
    WallSystem.setWallStyle('default');
    WallSystem.isoVisuals = [];
    WallSystem.isoSegments = [];
    WallSystem.buildIsoDiamondWalls(cx, cy, rx, ry);
    WallSystem.rebuildIsoCollision();
    const V = {
        top: { x: cx, y: cy - ry + 80 }, bottom: { x: cx, y: cy + ry - 80 },
        left: { x: cx - rx + 80, y: cy }, right: { x: cx + rx - 80, y: cy },
    };
    const player = V[vertexName];

    const straightTex = ISO_WALL_GEO.straight.tex;
    let best = null, bestD = Infinity;
    for (const p of WallSystem.isoVisuals) {
        if (p.tex !== straightTex || p._corner) continue;
        const d = Math.hypot(p.x - player.x, p.y - player.y);
        if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) { console.log(`S=${S} ${vertexName}: 无候选件！`); return false; }
    const [A, Bb] = WallSystem._pieceBaseSegments(best)[0];

    const g = ISO_WALL_GEO.gate;
    const s = ISO_WALL_HEIGHT / g.wallH, sx = s, sy = s * slopeFixOf(g);
    const flip = !!best.flipX;
    const p0 = g.base[0];
    let x0, y0;
    if (!flip) { x0 = A.x - p0[0] * sx; y0 = A.y - p0[1] * sy; }
    else { x0 = A.x - (g.w - p0[0]) * sx; y0 = A.y - p0[1] * sy; }
    const gcx = x0 + g.w * Math.abs(sx) / 2, gcy = y0 + g.h * sy / 2;
    const tex2world = (tx, ty) => {
        let u = tx - g.w / 2; const v = ty - g.h / 2;
        if (flip) u = -u;
        return { x: gcx + u * sx, y: gcy + v * sy };
    };
    const baseAt = (tx) => tex2world(tx, g.base[0][1] + (tx - g.base[0][0]) * g.slope);
    const g1 = baseAt(g.gateX[0]), g2 = baseAt(g.gateX[1]);

    WallSystem.isoVisuals.splice(WallSystem.isoVisuals.indexOf(best), 1);
    const dups = WallSystem.removeSpanCoveringPieces([A, Bb]);
    WallSystem.rebuildIsoCollision();

    let blocked = 0;
    for (const seg of WallSystem.isoSegments) {
        const dist = segSegDist({ x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 }, g1, g2);
        if (dist < 20) blocked++;
    }
    const ok = blocked === 0;
    console.log(`  ${ok ? '✓' : '✗'} S=${S} ${vertexName}: 摘重复件 ${dups.length}，门洞${ok ? '畅通' : `被 ${blocked} 段堵死`}`);
    return ok;
}

let pass = 0, fail = 0;
for (const S of [1024, 1792, 2048]) {
    for (const v of ['top', 'bottom', 'left', 'right']) {
        if (runCase(S, v)) pass++; else fail++;
    }
}
console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
