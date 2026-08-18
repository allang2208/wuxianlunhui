/**
 * 世界-122 4格门吸附几何回归：
 * - e1/e2 正负半格候选完整；
 * - F 切换不漂移；
 * - 交叉墙按 F 方向解歧；
 * - 单轴墙自动识别；
 * - 长墙选择离鼠标最近的四格窗口；
 * - 最近候选冲突时尝试另一侧半格。
 */
import {
    blockCellCenter,
    blockCellOf,
    gate4AnchorForCell,
    gate4AnchorFromEndpointCell,
    gate4Cells,
    chooseGate4Snap,
    isGate4OccupancyValid,
} from '../src/world/gate4-grid.js';
import { WallSystem } from '../src/world/wall-system.js';
import { applyIsoFootprintFromSegment, isoFootprintsOverlap } from '../src/physics/iso-footprint.js';
import fs from 'node:fs';

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
    if (cond) {
        pass++;
        console.log(`  ✓ ${name}${detail ? `：${detail}` : ''}`);
    } else {
        fail++;
        console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`);
    }
}

const toCells = (anchor, dir) => gate4Cells(anchor.x, anchor.y, dir)
    .map(([x, y]) => blockCellOf(x, y));

for (const [i, j] of [[0, 0], [3, -2], [-4, 5]]) {
    check(`格心往返 (${i},${j})`, JSON.stringify(blockCellOf(...blockCellCenter(i, j))) === JSON.stringify([i, j]));
}

const expected = {
    'e1:1': [[-1, 0], [0, 0], [1, 0], [2, 0]],
    'e1:-1': [[-2, 0], [-1, 0], [0, 0], [1, 0]],
    'e2:1': [[0, -1], [0, 0], [0, 1], [0, 2]],
    'e2:-1': [[0, -2], [0, -1], [0, 0], [0, 1]],
};
for (const dir of ['e1', 'e2']) {
    for (const side of [1, -1]) {
        const actual = toCells(gate4AnchorForCell(0, 0, dir, side), dir);
        check(`${dir} side=${side} 半格候选完整`,
            JSON.stringify(actual) === JSON.stringify(expected[`${dir}:${side}`]),
            JSON.stringify(actual));
    }
}

const [mx, my] = blockCellCenter(0, 0);
const e2 = chooseGate4Snap(mx, my, { mirror: false });
const e1 = chooseGate4Snap(mx, my, { mirror: true });
check('空地默认 e2，F 切 e1', e2.dir === 'e2' && e1.dir === 'e1');

let stable = true;
for (let n = 0; n < 20; n++) {
    const snap = chooseGate4Snap(mx, my, { mirror: n % 2 === 1 });
    const expectedSnap = n % 2 === 1 ? e1 : e2;
    if (snap.x !== expectedSnap.x || snap.y !== expectedSnap.y) stable = false;
}
check('连续切换20次始终围绕同一鼠标格，不发生32px漂移', stable);

const e1Minus = gate4AnchorForCell(0, 0, 'e1', -1);
const alternate = chooseGate4Snap(mx - 20, my - 10, {
    mirror: true,
    canPlace: (x, y) => x === e1Minus.x && y === e1Minus.y,
});
check('最近半格冲突时自动采用另一侧合法候选',
    alternate.valid && alternate.side === -1
    && alternate.x === e1Minus.x && alternate.y === e1Minus.y);

const crossBlocks = new Set();
for (let k = -1; k <= 2; k++) {
    crossBlocks.add(`${k},0`);
    crossBlocks.add(`0,${k}`);
}
const hasCross = (i, j) => crossBlocks.has(`${i},${j}`);
const crossE2 = chooseGate4Snap(mx, my, { mirror: false, hasBlock: hasCross });
const crossE1 = chooseGate4Snap(mx, my, { mirror: true, hasBlock: hasCross });
check('交叉墙默认选择 e2', crossE2.replace && crossE2.dir === 'e2');
check('交叉墙按 F 可选择 e1，不再固定 e2 优先', crossE1.replace && crossE1.dir === 'e1');

const e1Blocks = new Set(['0,0', '1,0', '2,0', '3,0']);
const onlyE1 = chooseGate4Snap(mx, my, {
    mirror: false,
    hasBlock: (i, j) => e1Blocks.has(`${i},${j}`),
});
check('只有 e1 四连墙时自动识别 e1，不受默认方向限制', onlyE1.replace && onlyE1.dir === 'e1');

const longBlocks = new Set();
for (let i = 0; i <= 6; i++) longBlocks.add(`${i},0`);
const [longX, longY] = blockCellCenter(5, 0);
const long = chooseGate4Snap(longX, longY, {
    mirror: true,
    hasBlock: (i, j) => longBlocks.has(`${i},${j}`),
});
check('长墙选择离鼠标最近的四格窗口，不固定偏向负方向',
    long.replace && JSON.stringify(long.run) === JSON.stringify([[3, 0], [4, 0], [5, 0], [6, 0]]),
    JSON.stringify(long.run));

const singlePillar = new Set(['0,0']);
const canPlaceWithSinglePillar = (ax, ay, dir) => {
    const occupied = gate4Cells(ax, ay, dir)
        .map(([x, y]) => blockCellOf(x, y))
        .map(([i, j], index) => singlePillar.has(`${i},${j}`) ? index : -1)
        .filter((index) => index >= 0);
    return isGate4OccupancyValid(occupied);
};
const [e1dx, e1dy] = [64, 32];
const towardRightDown = chooseGate4Snap(mx + e1dx * 0.35, my + e1dy * 0.35, {
    mirror: true,
    hasBlock: (i, j) => singlePillar.has(`${i},${j}`),
    canPlace: canPlaceWithSinglePillar,
});
check('左端柱向右下延伸：复用柱子且四格窗口从该柱开始',
    towardRightDown.endpointReuse
    && towardRightDown.endpointIndex === 0
    && JSON.stringify(toCells(towardRightDown, 'e1')) === JSON.stringify([[0, 0], [1, 0], [2, 0], [3, 0]]),
    JSON.stringify(toCells(towardRightDown, 'e1')));

const towardLeftUp = chooseGate4Snap(mx - e1dx * 0.35, my - e1dy * 0.35, {
    mirror: true,
    hasBlock: (i, j) => singlePillar.has(`${i},${j}`),
    canPlace: canPlaceWithSinglePillar,
});
check('右端柱向左上延伸：复用柱子且四格窗口以该柱结束',
    towardLeftUp.endpointReuse
    && towardLeftUp.endpointIndex === 3
    && JSON.stringify(toCells(towardLeftUp, 'e1')) === JSON.stringify([[-3, 0], [-2, 0], [-1, 0], [0, 0]]),
    JSON.stringify(toCells(towardLeftUp, 'e1')));

check('单端柱允许复用，中间格单独占用仍拒绝',
    isGate4OccupancyValid([0])
    && isGate4OccupancyValid([3])
    && !isGate4OccupancyValid([1])
    && !isGate4OccupancyValid([2]));
const endpointAnchor = gate4AnchorFromEndpointCell(0, 0, 'e1', 1);
check('端柱延伸锚点位于柱子外1.5格',
    endpointAnchor.x === mx + 96 && endpointAnchor.y === my + 48);

globalThis.window = globalThis.window || { __phaserScene: null };
WallSystem.init(4096, 4096);
const connectedGateSeg = { x1: -64, y1: -32, x2: 64, y2: 32, halfThick: 26, _gate: true };
WallSystem.isoSegments.push(connectedGateSeg);
check('旧门栅栏段会阻挡近邻格，但作为连接门段显式忽略后可通过',
    !WallSystem.canBuildAt(64, 32, 28)
    && WallSystem.canBuildAt(64, 32, 28, { segs: new Set([connectedGateSeg]) }));
const buildingSrc = fs.readFileSync(new URL('../src/world/building-system.js', import.meta.url), 'utf8');
check('门端柱复用把所属旧门段加入放置忽略集',
    /connectedGateSegs/.test(buildingSrc)
    && /ignoreSegs: connectedGateSegs/.test(buildingSrc));

// 用户实机唯一失败方向：默认 e2 门的屏幕左柱，向右下 e1 放镜像门。
const defaultAnchor = gate4AnchorForCell(0, 0, 'e2', 1);
const defaultCells = gate4Cells(defaultAnchor.x, defaultAnchor.y, 'e2');
const defaultLeftPillar = defaultCells.reduce((best, cell) => cell[0] < best[0] ? cell : best);
const mirroredCornerAnchor = {
    x: defaultLeftPillar[0] + 96,
    y: defaultLeftPillar[1] + 48,
};
const mirroredCornerCells = gate4Cells(mirroredCornerAnchor.x, mirroredCornerAnchor.y, 'e1');
const defaultGateFoot = { x: defaultAnchor.x, y: defaultAnchor.y };
const defaultMidY = defaultAnchor.y;
applyIsoFootprintFromSegment(defaultGateFoot,
    { x: defaultAnchor.x - 64, y: defaultMidY + 32 },
    { x: defaultAnchor.x + 64, y: defaultMidY - 32 },
    128 / (2 * Math.SQRT2));
const firstEmptyBlock = {
    x: mirroredCornerCells[1][0],
    y: mirroredCornerCells[1][1],
    collisionWidth: 128,
    collisionIsoHalfU: 128 / (2 * Math.SQRT2),
    collisionIsoHalfV: 128 / (2 * Math.SQRT2),
};
check('默认门中段中心回归锚点，左柱→右下镜像门首个空格不再冲突',
    defaultGateFoot.colliderOffsetY === 0
    && !isoFootprintsOverlap(firstEmptyBlock, defaultGateFoot, -0.5));
const middleBarBlock = {
    x: defaultCells[1][0],
    y: defaultCells[1][1],
    collisionWidth: 128,
    collisionIsoHalfU: 128 / (2 * Math.SQRT2),
    collisionIsoHalfV: 128 / (2 * Math.SQRT2),
};
const adjacentWallBlock = {
    x: defaultCells[1][0] + 64,
    y: defaultCells[1][1] + 32,
    collisionWidth: 128,
    collisionIsoHalfU: 128 / (2 * Math.SQRT2),
    collisionIsoHalfV: 128 / (2 * Math.SQRT2),
};
check('中间栅栏精确占2×1格：门内格冲突、相邻地面格可贴边',
    isoFootprintsOverlap(middleBarBlock, defaultGateFoot, -0.5)
    && !isoFootprintsOverlap(adjacentWallBlock, defaultGateFoot, -0.5));
check('修复不再依赖忽略旧门实体footprint',
    !/connectedGateEntities/.test(buildingSrc)
    && !/ignoreEntities: connectedGateEntities/.test(buildingSrc));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
