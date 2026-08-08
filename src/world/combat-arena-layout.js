/**
 * 三房间串联竞技场布局（纯函数，无 Phaser 依赖，可单测）
 *
 * D 级及以上地牢战斗事件：3 个菱形房间沿左上→右下斜轴（屏幕 30°，方向 (1, 0.5774)）串联，
 * 房间 1/2 为普通战斗房大小，房间 3 为精英战斗房大小（含宝箱房）。
 *
 * 几何事实（与 combat-room-system.js 菱形一致）：
 * - rx = size * 1.2，ry = rx * 0.5774
 * - 菱形"右下边中点" = (cx + rx/2, cy + ry/2)，该偏移恰沿串联轴，
 *   模长 = (rx/2) * hypot(1, 0.5774)（注意：不是 rx*0.5774，0.5774 是 1/√3 的近似）
 * - 因此相邻房间中心距 = (rx_n + rx_{n+1})/2 * hypot(1, 0.5774) + passageLen + gap
 */

// 菱形地板斜率（30° 等距投影，与 combat-room-system.js 保持一致）
export const DIAMOND_SLOPE = 0.5774;
// 房间外边距（与 combat-room-system.js M 保持一致）
export const ARENA_MARGIN = 260;
// 中心 → 边中点的距离系数：(rx/2) * hypot(1, DIAMOND_SLOPE) = rx * EDGE_MID_FACTOR
export const EDGE_MID_FACTOR = Math.hypot(1, DIAMOND_SLOPE) / 2;

/** 串联轴单位向量（左上→右下） */
export const ARENA_AXIS = (() => {
    const len = Math.hypot(1, DIAMOND_SLOPE);
    return { x: 1 / len, y: DIAMOND_SLOPE / len };
})();

export function diamondRadii(size) {
    const rx = size * 1.2;
    return { rx, ry: rx * DIAMOND_SLOPE };
}

/** 房间右下边中点（通往下一房间的连接点） */
export function rightBottomMid(room) {
    return { x: room.cx + room.rx / 2, y: room.cy + room.ry / 2 };
}

/** 房间左上边中点（来自上一房间的连接点） */
export function leftTopMid(room) {
    return { x: room.cx - room.rx / 2, y: room.cy - room.ry / 2 };
}

/**
 * 计算三房间串联布局
 * @param {Object} opts
 * @param {number} opts.normalSize 房间 1/2 尺寸档（combatRoom.normalSize）
 * @param {number} opts.eliteSize  房间 3 尺寸档（combatRoom.eliteSize）
 * @param {number} opts.passageLen 通道长度（两房间墙洞间距，像素；取通道预制两门墙中心距）
 * @param {number} [opts.gap]      额外间距微调（combatArena.passageGap）
 * @returns {{ rooms: Array, passages: Array, worldW: number, worldH: number }}
 *   rooms[i]    = { index, size, cx, cy, rx, ry, bounds }
 *   passages[i] = { index, mid1, mid2, center, axis, length }  连接 rooms[i] → rooms[i+1]
 */
export function computeArenaLayout({ normalSize, eliteSize, passageLen, gap = 0 }) {
    const sizes = [normalSize, normalSize, eliteSize];
    const rooms = [];
    let prev = null;
    for (let i = 0; i < 3; i++) {
        const { rx, ry } = diamondRadii(sizes[i]);
        let cx, cy;
        if (!prev) {
            cx = ARENA_MARGIN + rx;
            cy = ARENA_MARGIN + ry;
        } else {
            // 中心距 = (rx_prev + rx)/2 * hypot(1,0.5774) + 通道长度 + 微调（沿串联轴）
            const step = (prev.rx + rx) * EDGE_MID_FACTOR + passageLen + gap;
            cx = prev.cx + ARENA_AXIS.x * step;
            cy = prev.cy + ARENA_AXIS.y * step;
        }
        const room = {
            index: i + 1,
            size: sizes[i],
            cx, cy, rx, ry,
            // 三房直线串联：入口 LT、出口 RB（与迷宫接口统一）
            inEdge: 'LT',
            outEdge: 'RB',
            bounds: {
                minX: cx - rx, maxX: cx + rx,
                minY: cy - ry, maxY: cy + ry,
                cx, cy, diamond: true, rx, ry,
            },
        };
        rooms.push(room);
        prev = room;
    }

    const passages = [];
    for (let i = 0; i < 2; i++) {
        const mid1 = rightBottomMid(rooms[i]);
        const mid2 = leftTopMid(rooms[i + 1]);
        const length = Math.hypot(mid2.x - mid1.x, mid2.y - mid1.y);
        passages.push({
            index: i + 1,
            mid1, mid2,
            center: { x: (mid1.x + mid2.x) / 2, y: (mid1.y + mid2.y) / 2 },
            axis: { ...ARENA_AXIS },
            length,
        });
    }

    // 世界尺寸：全房间外接矩形 + 四周边距（通道在房间连线内，出口白区在右下外侧余量内）
    let maxX = 0, maxY = 0;
    for (const r of rooms) {
        maxX = Math.max(maxX, r.cx + r.rx);
        maxY = Math.max(maxY, r.cy + r.ry);
    }
    const worldW = Math.ceil(maxX + ARENA_MARGIN);
    const worldH = Math.ceil(maxY + ARENA_MARGIN);
    return { rooms, passages, worldW, worldH };
}

// ============================================================
// 多房网格迷宫布局（2026-08-08：三房串联 → 蛇形网格）
// ============================================================
// 菱形四顶点：T(cx,cy-ry) R(cx+rx,cy) B(cx,cy+ry) L(cx-rx,cy)，四边法线：
//   LT(-v1) TR(+v2) RB(+v1) BL(-v2)，其中 v1=(0.866,0.5)、v2=(0.866,-0.5)
// 通道只走"对边中点连线"（两对平行对边），四方向：
//   +v1: A.RB → B.LT（左右通道）  -v1: A.LT → B.RB（左右通道镜像）
//   +v2: A.TR → B.BL（上下通道）  -v2: A.BL → B.TR（上下通道镜像）
// 几何事实：任一对边连接的中心距公式相同——
//   (rx_A + rx_B) * EDGE_MID_FACTOR + passageLen + gap
// （对边中点沿轴投影 = rx*EDGE_MID_FACTOR，与 v1/v2 无关，纯菱形对称）
// 蛇形拓扑：排内沿 ±v1 交替折返，排末 → 下一排首房沿 +v2。

/** 通道轴 v1（左上→右下，左右通道） */
export const MAZE_AXIS_V1 = { ...ARENA_AXIS };
/** 通道轴 v2（右上→左下，上下通道） */
export const MAZE_AXIS_V2 = { x: ARENA_AXIS.x, y: -ARENA_AXIS.y };

/** 对边映射（出口门 = 入口边的对边，保证走完房间从另一侧离开迷宫） */
const OPPOSITE_EDGE = { LT: 'RB', RB: 'LT', TR: 'BL', BL: 'TR' };

/** 通道方向 → 出口/入口边名 */
export function passageEdges(dir) {
    const { x, y } = dir;
    const key = (x > 0 ? 'P' : 'N') + (y > 0 ? 'P' : 'N');
    switch (key) {
        case 'PP': return { out: 'RB', in: 'LT' };  // +v1
        case 'NN': return { out: 'LT', in: 'RB' };  // -v1
        case 'PN': return { out: 'TR', in: 'BL' };  // +v2
        case 'NP': return { out: 'BL', in: 'TR' };  // -v2
        default: return { out: 'RB', in: 'LT' };
    }
}

/**
 * 计算多房蛇形迷宫布局
 * @param {Object} opts
 * @param {Array<number>} opts.sizes      每房尺寸档数组（长度 = 房间数，≥3）
 * @param {number} opts.passageLen        通道长度（预制两门中心距）
 * @param {number} [opts.gap]             通道间距微调
 * @param {number} [opts.rows]            蛇形排数（0 = 自动 ceil(sqrt(n))）
 * @returns {{ rooms: Array, passages: Array, worldW: number, worldH: number }}
 *   rooms[i]    = { index, size, cx, cy, rx, ry, bounds, inEdge, outEdge }
 *                 inEdge/outEdge = 'LT'|'RB'|'TR'|'BL'（入口门边 / 去路通道边；末房 outEdge 固定 'RB' 出口）
 *   passages[i] = { index, mid1, mid2, center, axis, length, dir, inEdge, outEdge }
 */
export function computeMazeLayout({ sizes, passageLen, gap = 0, rows = 0 }) {
    const n = sizes.length;
    const R = rows > 0 ? Math.max(1, Math.min(rows, n)) : Math.max(1, Math.ceil(Math.sqrt(n)));
    const cols = Math.ceil(n / R);
    const rooms = [];
    const passages = [];
    const stepFor = (a, b) => (a.rx + b.rx) * EDGE_MID_FACTOR + passageLen + gap;
    const midOf = (room, edge) => {
        switch (edge) {
            case 'LT': return { x: room.cx - room.rx / 2, y: room.cy - room.ry / 2 };
            case 'TR': return { x: room.cx + room.rx / 2, y: room.cy - room.ry / 2 };
            case 'RB': return { x: room.cx + room.rx / 2, y: room.cy + room.ry / 2 };
            case 'BL': return { x: room.cx - room.rx / 2, y: room.cy + room.ry / 2 };
            default: return { x: room.cx, y: room.cy };
        }
    };

    let cur = { x: ARENA_MARGIN, y: ARENA_MARGIN };
    let prevRoom = null;
    let placed = 0;
    let lastDir = null; // 上一条通道的方向（决定本房入口边）
    for (let r = 0; r < R && placed < n; r++) {
        const dir = (r % 2 === 0) ? { ...MAZE_AXIS_V1 } : { x: -MAZE_AXIS_V1.x, y: -MAZE_AXIS_V1.y };
        const inThisRow = Math.min(cols, n - placed);
        for (let c = 0; c < inThisRow; c++) {
            const size = sizes[placed];
            const { rx, ry } = diamondRadii(size);
            // 入口边：房 1 固定 LT（入场门）；其余房取上一条通道的入口边
            const inEdge = placed > 0 ? passageEdges(lastDir).in : 'LT';
            // 出口边：末房固定 RB（出口门）；排内取当前行方向；排末房取 +v2（转弯）
            const isLast = placed === n - 1;
            const isRowEnd = c === inThisRow - 1 && !isLast;
            let outEdge;
            if (isLast) {
                // 末房出口 = 入口边的对边（沿排方向走出迷宫；出口门锚定该边中点）
                outEdge = OPPOSITE_EDGE[inEdge] || 'RB';
            } else if (isRowEnd) {
                const e = passageEdges(MAZE_AXIS_V2);
                outEdge = e.out; // TR
            } else {
                outEdge = passageEdges(dir).out;
            }
            const room = {
                index: placed + 1,
                size,
                cx: cur.x, cy: cur.y, rx, ry,
                inEdge, outEdge,
                bounds: {
                    minX: cur.x - rx, maxX: cur.x + rx,
                    minY: cur.y - ry, maxY: cur.y + ry,
                    cx: cur.x, cy: cur.y, diamond: true, rx, ry,
                },
            };
            rooms.push(room);
            prevRoom = room;
            placed++;
            // 记录去路方向：末房无；排末转弯 +v2；否则沿本排方向
            lastDir = isLast ? lastDir
                : isRowEnd ? { ...MAZE_AXIS_V2 }
                : { ...dir };
            // 排内下一步：沿 dir 推进（末房不推进，转弯时再推）
            if (c < inThisRow - 1 && !isLast) {
                const next = sizes[placed];
                const { rx: nrx } = diamondRadii(next);
                const step = (room.rx + nrx) * EDGE_MID_FACTOR + passageLen + gap;
                cur = { x: cur.x + dir.x * step, y: cur.y + dir.y * step };
            }
        }
        // 排末 → 下一排首房：沿 +v2 推进
        if (placed < n) {
            const next = sizes[placed];
            const { rx: nrx } = diamondRadii(next);
            const step = (prevRoom.rx + nrx) * EDGE_MID_FACTOR + passageLen + gap;
            cur = { x: cur.x + MAZE_AXIS_V2.x * step, y: cur.y + MAZE_AXIS_V2.y * step };
        }
    }

    // 通道表：rooms[i].outEdge → rooms[i+1].inEdge（末房无去路）
    for (let i = 0; i < n - 1; i++) {
        const a = rooms[i], b = rooms[i + 1];
        const mid1 = midOf(a, a.outEdge);
        const mid2 = midOf(b, b.inEdge);
        let vx = mid2.x - mid1.x, vy = mid2.y - mid1.y;
        const length = Math.hypot(vx, vy);
        const axis = { x: vx / length, y: vy / length };
        passages.push({
            index: i + 1,
            mid1, mid2,
            center: { x: (mid1.x + mid2.x) / 2, y: (mid1.y + mid2.y) / 2 },
            axis, length,
            dir: { ...axis },
            outEdge: a.outEdge, inEdge: b.inEdge,
        });
    }

    // 世界尺寸：含负方向（蛇形折返会向 -y 走），整组平移使 minX/minY ≥ margin
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rooms) {
        minX = Math.min(minX, r.cx - r.rx);
        minY = Math.min(minY, r.cy - r.ry);
        maxX = Math.max(maxX, r.cx + r.rx);
        maxY = Math.max(maxY, r.cy + r.ry);
    }
    const dx = ARENA_MARGIN - minX;
    const dy = ARENA_MARGIN - minY;
    if (dx > 0 || dy > 0) {
        for (const r of rooms) { r.cx += dx; r.cy += dy; r.bounds.cx += dx; r.bounds.cy += dy; r.bounds.minX += dx; r.bounds.minY += dy; r.bounds.maxX += dx; r.bounds.maxY += dy; }
        for (const p of passages) { p.mid1.x += dx; p.mid1.y += dy; p.mid2.x += dx; p.mid2.y += dy; p.center.x += dx; p.center.y += dy; }
    }
    const worldW = Math.ceil(maxX + dx + ARENA_MARGIN);
    const worldH = Math.ceil(maxY + dy + ARENA_MARGIN);
    return { rooms, passages, worldW, worldH, maze: true };
}

/** 点是否在菱形房间内（|x-cx|/rx + |y-cy|/ry <= 1，含边界） */
export function pointInDiamond(x, y, room) {
    return Math.abs(x - room.cx) / room.rx + Math.abs(y - room.cy) / room.ry <= 1;
}
