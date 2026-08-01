/**
 * 三房间串联竞技场布局纯函数测试（combat-arena-layout.js）
 * 运行：node scripts/test-arena-layout.mjs
 */
import {
    computeArenaLayout, pointInDiamond, diamondRadii,
    rightBottomMid, leftTopMid, ARENA_AXIS, DIAMOND_SLOPE, ARENA_MARGIN,
} from '../src/world/combat-arena-layout.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name} ${detail}`); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

console.log('combat-arena-layout 布局测试');

const NORMAL = 1024, ELITE = 1792, LEN = 500, GAP = 0;
const layout = computeArenaLayout({ normalSize: NORMAL, eliteSize: ELITE, passageLen: LEN, gap: GAP });
const [r1, r2, r3] = layout.rooms;

// 1. 房间尺寸档：1/2 普通、3 精英
check('房间1/2 为普通尺寸、房间3 为精英尺寸',
    r1.size === NORMAL && r2.size === NORMAL && r3.size === ELITE);
check('菱形半径 rx = size*1.2, ry = rx*0.5774',
    near(r3.rx, ELITE * 1.2) && near(r3.ry, ELITE * 1.2 * DIAMOND_SLOPE));

// 2. 三房中心共线于串联轴
for (const [a, b, tag] of [[r1, r2, '1→2'], [r2, r3, '2→3']]) {
    const dx = b.cx - a.cx, dy = b.cy - a.cy;
    const cross = dx * ARENA_AXIS.y - dy * ARENA_AXIS.x; // 叉积≈0 即共线
    check(`房间中心 ${tag} 共线于串联轴`, near(cross, 0, 1e-6), `cross=${cross}`);
    check(`房间中心 ${tag} 沿轴正向（右下）`, dx > 0 && dy > 0);
}

// 3. 相邻房间"右下边中点 → 左上边中点"距离 = passageLen + gap
for (let i = 0; i < 2; i++) {
    const p = layout.passages[i];
    check(`通道${i + 1} 长度 = passageLen + gap`,
        near(p.length, LEN + GAP, 1e-6), `len=${p.length}`);
    const m1 = rightBottomMid(layout.rooms[i]);
    const m2 = leftTopMid(layout.rooms[i + 1]);
    check(`通道${i + 1} mid1/mid2 与房间边中点一致`,
        near(p.mid1.x, m1.x) && near(p.mid1.y, m1.y) && near(p.mid2.x, m2.x) && near(p.mid2.y, m2.y));
    check(`通道${i + 1} center 为两端中点`,
        near(p.center.x, (m1.x + m2.x) / 2) && near(p.center.y, (m1.y + m2.y) / 2));
}

// 4. 中心距公式 = (rx_n + rx_{n+1})/2 * hypot(1, 0.5774) + passageLen
{
    const d12 = Math.hypot(r2.cx - r1.cx, r2.cy - r1.cy);
    const expect = (r1.rx + r2.rx) * Math.hypot(1, DIAMOND_SLOPE) / 2 + LEN + GAP;
    check('房间1→2 中心距公式', near(d12, expect, 1e-6), `${d12} vs ${expect}`);
}

// 5. 世界尺寸包含全部房间外接矩形 + 边距
{
    let maxX = 0, maxY = 0;
    for (const r of layout.rooms) {
        maxX = Math.max(maxX, r.cx + r.rx);
        maxY = Math.max(maxY, r.cy + r.ry);
    }
    check('worldW/worldH = 外接矩形 + 边距',
        layout.worldW === Math.ceil(maxX + ARENA_MARGIN) &&
        layout.worldH === Math.ceil(maxY + ARENA_MARGIN));
    for (const r of layout.rooms) {
        check(`房间${r.index} 完全在世界内`,
            r.cx - r.rx >= 0 && r.cy - r.ry >= 0 &&
            r.cx + r.rx <= layout.worldW && r.cy + r.ry <= layout.worldH);
    }
}

// 6. pointInDiamond 房内/房外/边界
check('房内点（中心）', pointInDiamond(r1.cx, r1.cy, r1));
check('房内点（半轴）', pointInDiamond(r1.cx + r1.rx / 2, r1.cy, r1));
check('边界点（右顶点）', pointInDiamond(r1.cx + r1.rx, r1.cy, r1));
check('房外点（顶点外 1px）', !pointInDiamond(r1.cx + r1.rx + 1, r1.cy, r1));
check('房外点（远点）', !pointInDiamond(r1.cx + r1.rx * 3, r1.cy, r1));
check('房间2 不属于房间1', !pointInDiamond(r2.cx, r2.cy, r1));

// 7. gap 微调生效
{
    const l2 = computeArenaLayout({ normalSize: NORMAL, eliteSize: ELITE, passageLen: LEN, gap: 120 });
    check('gap 增加 → 通道长度同步增加', near(l2.passages[0].length, LEN + 120, 1e-6));
}

// 8. diamondRadii 快照
{
    const { rx, ry } = diamondRadii(1024);
    check('diamondRadii(1024) = 1228.8 / 709.4', near(rx, 1228.8) && near(ry, 1228.8 * DIAMOND_SLOPE));
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
