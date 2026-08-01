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

/** 点是否在菱形房间内（|x-cx|/rx + |y-cy|/ry <= 1，含边界） */
export function pointInDiamond(x, y, room) {
    return Math.abs(x - room.cx) / room.rx + Math.abs(y - room.cy) / room.ry <= 1;
}
