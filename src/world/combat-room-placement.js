import { WallSystem } from './wall-system.js';
import { pointInRoomShape } from './frozen-random-room-layout.js';
import { isPointClearOfTerrainCutouts } from './frozen-arena-terrain.js';

// 只在建房/刷波时采样当前房间；不修改全局寻路、墙几何或实体半径。
const STEP = 32;
const MAX_CELLS = 8192;

export function isCombatRoomPointSafe(bounds, x, y, radius, exclude = null) {
    if (!bounds || ![x, y, radius].every(Number.isFinite) || radius < 0) return false;
    const inRoom = bounds.diamond || bounds.floorPolygon
        ? pointInRoomShape(x, y, bounds, radius + 4)
        : x >= bounds.minX + radius + 4 && x <= bounds.maxX - radius - 4
            && y >= bounds.minY + radius + 4 && y <= bounds.maxY - radius - 4;
    return inRoom && !exclude?.(x, y, radius)
        && isPointClearOfTerrainCutouts(bounds, x, y, radius + 4)
        && WallSystem.canMoveTo(x, y, radius);
}

/** 有界同房连通采样。预算耗尽只保留已证实可达点，不把未检查区域当作可达。 */
export function buildCombatRoomReachability(bounds, anchor, radius, {
    exclude = null, anchorRadius = radius,
} = {}) {
    if (!anchor || ![anchor.x, anchor.y, radius].every(Number.isFinite)) return null;
    const safe = (x, y, r = radius) => isCombatRoomPointSafe(bounds, x, y, r, exclude);
    const crosses = (a, b, r = radius) => {
        if (WallSystem.blocked(a.x, a.y, b.x, b.y)) return false;
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 16));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            if (!safe(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r)) return false;
        }
        return true;
    };
    // 玩家可贴墙，而大怪不能；只允许向与玩家直接连通的近点建立大半径连通区。
    let root = safe(anchor.x, anchor.y) ? { x: anchor.x, y: anchor.y } : null;
    const connectionRadius = Math.min(radius, anchorRadius);
    if (!root && safe(anchor.x, anchor.y, connectionRadius)) {
        for (let distance = STEP; distance <= radius + 128 && !root; distance += STEP) {
            for (let i = 0; i < 16; i++) {
                const angle = i / 16 * Math.PI * 2;
                const point = { x: anchor.x + Math.cos(angle) * distance, y: anchor.y + Math.sin(angle) * distance };
                if (safe(point.x, point.y) && crosses(anchor, point, connectionRadius)) {
                    root = point;
                    break;
                }
            }
        }
    }
    if (!root) return null;

    const points = [{ ...root, u: 0, v: 0 }];
    const reached = new Map([['0,0', points[0]]]);
    const blocked = new Set();
    let expanded = false;
    const expand = () => {
        if (expanded) return;
        expanded = true;
        for (let cursor = 0; cursor < points.length && points.length < MAX_CELLS; cursor++) {
            const from = points[cursor];
            for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const u = from.u + du, v = from.v + dv;
                const key = `${u},${v}`;
                if (reached.has(key) || blocked.has(key)) continue;
                const point = { x: root.x + u * STEP, y: root.y + v * STEP, u, v };
                if (!safe(point.x, point.y)) { blocked.add(key); continue; }
                // 某条边不通不代表该格不可从另一方向抵达。
                if (!crosses(from, point)) continue;
                reached.set(key, point);
                points.push(point);
                if (points.length >= MAX_CELLS) break;
            }
        }
    };
    const contains = (x, y) => {
        if (!safe(x, y)) return false;
        // 开阔房先走真实直连检查；只有绕墙/凹角才展开网格，同半径在本波复用一次。
        if (crosses(root, { x, y })) return true;
        expand();
        const u = Math.round((x - root.x) / STEP), v = Math.round((y - root.y) / STEP);
        for (let dv = -1; dv <= 1; dv++) {
            for (let du = -1; du <= 1; du++) {
                const near = reached.get(`${u + du},${v + dv}`);
                if (near && crosses(near, { x, y })) return true;
            }
        }
        return false;
    };
    return {
        contains,
        nearest(x, y, accept = () => true) {
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            if (contains(x, y) && accept(x, y)) return { x, y };
            expand();
            let best = null, distance = Infinity;
            for (const point of points) {
                const d = (point.x - x) ** 2 + (point.y - y) ** 2;
                if (d < distance && accept(point.x, point.y)) { distance = d; best = point; }
            }
            return best ? { x: best.x, y: best.y } : null;
        },
    };
}
