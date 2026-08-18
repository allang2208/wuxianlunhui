/** 世界-122 方块墙/4格门共用的等距格网几何。 */
export const BLOCK_GRID = Object.freeze({
    originX: 4232,
    originY: 4080,
    e1: Object.freeze([64, 32]),
    e2: Object.freeze([-64, 32]),
});

export function blockCellOf(wx, wy) {
    const u = (wx - BLOCK_GRID.originX) / 64; // i - j
    const v = (wy - BLOCK_GRID.originY) / 32; // i + j
    return [Math.round((u + v) / 2), Math.round((v - u) / 2)];
}

export function blockCellCenter(i, j) {
    return [
        BLOCK_GRID.originX + i * 64 - j * 64,
        BLOCK_GRID.originY + i * 32 + j * 32,
    ];
}

export function gate4Step(dir) {
    return dir === 'e1' ? BLOCK_GRID.e1 : BLOCK_GRID.e2;
}

/**
 * 偶数格门的中心必在半格位置。side=+1/-1 分别给出鼠标格两侧的候选，
 * 防止只生成一个半格锚点而让相反来向无法吸附。
 */
export function gate4AnchorForCell(ci, cj, dir, side = 1) {
    const [ccx, ccy] = blockCellCenter(ci, cj);
    const [vx, vy] = gate4Step(dir);
    return {
        x: Math.round(ccx + vx * 0.5 * side),
        y: Math.round(ccy + vy * 0.5 * side),
    };
}

/** 单个既有端柱向指定轴正/负方向延伸时的门中心。 */
export function gate4AnchorFromEndpointCell(ci, cj, dir, side = 1) {
    const [ccx, ccy] = blockCellCenter(ci, cj);
    const [vx, vy] = gate4Step(dir);
    return {
        x: Math.round(ccx + vx * 1.5 * side),
        y: Math.round(ccy + vy * 1.5 * side),
    };
}

export function gate4Cells(x, y, dir) {
    const [vx, vy] = gate4Step(dir);
    return [-1.5, -0.5, 0.5, 1.5].map((t) => [
        Math.round(x + vx * t),
        Math.round(y + vy * t),
    ]);
}

/** 允许：全空新建、四墙替换、或仅一个端点柱复用；中间格单独占用仍拒绝。 */
export function isGate4OccupancyValid(occupiedIndices) {
    const occupied = Array.from(new Set(occupiedIndices || [])).sort((a, b) => a - b);
    return occupied.length === 0
        || occupied.length === 4
        || (occupied.length === 1 && (occupied[0] === 0 || occupied[0] === 3));
}

/** 返回所有包含鼠标格的四连墙窗口；长墙不能固定偏向鼠标负方向。 */
export function findGate4WallRuns(ci, cj, dir, hasBlock) {
    const [di, dj] = dir === 'e1' ? [1, 0] : [0, 1];
    const runs = [];
    for (let s = -3; s <= 0; s++) {
        const cells = [];
        for (let k = 0; k < 4; k++) cells.push([ci + (s + k) * di, cj + (s + k) * dj]);
        if (cells.every(([i, j]) => hasBlock(i, j))) runs.push(cells);
    }
    return runs;
}

function byValidityThenDistance(a, b) {
    if (a.valid !== b.valid) return a.valid ? -1 : 1;
    if (a.d !== b.d) return a.d - b.d;
    return b.side - a.side;
}

/**
 * 选择4格门吸附候选。
 * - 墙替换：收集 e1/e2 全部四连窗口；两轴都合法时由 F/mirror 决定。
 * - 空地新建：在指定轴生成正/负两个半格锚点，优先合法且离鼠标最近者。
 */
export function chooseGate4Snap(x, y, {
    mirror = false,
    hasBlock = () => false,
    canPlace = () => true,
} = {}) {
    const [ci, cj] = blockCellOf(x, y);
    const preferredDir = mirror ? 'e1' : 'e2';
    const replacements = [];

    for (const dir of ['e1', 'e2']) {
        for (const run of findGate4WallRuns(ci, cj, dir, hasBlock)) {
            const anchor = gate4AnchorForCell(run[1][0], run[1][1], dir, 1);
            replacements.push({
                ...anchor,
                dir,
                side: 1,
                d: Math.hypot(anchor.x - x, anchor.y - y),
                replace: true,
                valid: true,
                run,
            });
        }
    }

    if (replacements.length > 0) {
        const preferred = replacements.filter((candidate) => candidate.dir === preferredDir);
        const pool = preferred.length > 0 ? preferred : replacements;
        pool.sort(byValidityThenDistance);
        return pool[0];
    }

    // 鼠标所在格若已有单柱，先生成“该柱作为起点/终点”的两侧延伸候选。
    // 这是左柱→右下、右柱→左上对称吸附的关键；旧半格候选只会把该柱放进中间格。
    const endpointCandidates = hasBlock(ci, cj) ? [1, -1].map((side) => {
        const anchor = gate4AnchorFromEndpointCell(ci, cj, preferredDir, side);
        return {
            ...anchor,
            dir: preferredDir,
            side,
            d: Math.hypot(anchor.x - x, anchor.y - y),
            replace: false,
            endpointReuse: true,
            endpointIndex: side === 1 ? 0 : 3,
            valid: !!canPlace(anchor.x, anchor.y, preferredDir),
        };
    }) : [];
    const validEndpoints = endpointCandidates.filter((candidate) => candidate.valid);
    if (validEndpoints.length > 0) {
        validEndpoints.sort(byValidityThenDistance);
        return validEndpoints[0];
    }

    const candidates = [1, -1].map((side) => {
        const anchor = gate4AnchorForCell(ci, cj, preferredDir, side);
        return {
            ...anchor,
            dir: preferredDir,
            side,
            d: Math.hypot(anchor.x - x, anchor.y - y),
            replace: false,
            valid: !!canPlace(anchor.x, anchor.y, preferredDir),
        };
    });
    candidates.push(...endpointCandidates);
    candidates.sort(byValidityThenDistance);
    return candidates[0] || null;
}
