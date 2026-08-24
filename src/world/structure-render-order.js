import {
    isoFootprintCenter,
    isoFootprintHalfExtents,
    worldDeltaToIsoLocal,
} from '../physics/iso-footprint.js';

// 动态单位在结构前后各预留 0.5 depth；结构节点之间至少保留完整插入槽。
export const STRUCTURE_ORDER_GAP = 1.25;

/** 一个结构节点内部的稳定深度通道；相邻结构至少间隔 STRUCTURE_ORDER_GAP。 */
export function structureDepthChannels(baseDepth) {
    return Object.freeze({
        shadow: baseDepth - 0.08,
        rearFx: baseDepth - 0.04,
        sprite: baseDepth,
        frontFx: baseDepth + 0.04,
        smoke: baseDepth + 0.08,
        label: baseDepth + 0.12,
    });
}

/** 实体 footprint 转为全局等距 u/v 包围盒。 */
export function structureIsoBounds(entity) {
    if (!entity || entity.collisionShape !== 'iso_rect') return null;
    const center = isoFootprintCenter(entity);
    const local = worldDeltaToIsoLocal(center.x, center.y);
    const half = isoFootprintHalfExtents(entity);
    return {
        minU: local.u - half.halfU,
        maxU: local.u + half.halfU,
        minV: local.v - half.halfV,
        maxV: local.v + half.halfV,
    };
}

/** 墙段/门段等线结构转为带厚度的 u/v 包围盒。 */
export function segmentIsoBounds(a, b, halfThickness = 8) {
    if (!a || !b) return null;
    const pa = worldDeltaToIsoLocal(a.x, a.y);
    const pb = worldDeltaToIsoLocal(b.x, b.y);
    const t = Math.max(1, Number(halfThickness) || 1);
    return {
        minU: Math.min(pa.u, pb.u) - t,
        maxU: Math.max(pa.u, pb.u) + t,
        minV: Math.min(pa.v, pb.v) - t,
        maxV: Math.max(pa.v, pb.v) + t,
    };
}

/** 世界脚点转为可参与结构排序的零面积 u/v 节点。 */
export function pointIsoBounds(x, y) {
    const point = worldDeltaToIsoLocal(Number(x) || 0, Number(y) || 0);
    return {
        minU: point.u,
        maxU: point.u,
        minV: point.v,
        maxV: point.v,
    };
}

export function definitelyBehind(a, b, epsilon = 0.001) {
    return a.maxU <= b.minU + epsilon || a.maxV <= b.minV + epsilon;
}

/**
 * 共用的等距地面前后关系。-1 表示 a 在 b 后，1 表示 b 在 a 后，0 表示地面几何不唯一。
 * 静态结构与动态单位必须消费同一判断，禁止再按屏幕 X 另建一套建筑前缘规则。
 */
export function compareIsoBoundsOrder(a, b) {
    if (!a || !b) return 0;
    const aBehindB = definitelyBehind(a, b);
    const bBehindA = definitelyBehind(b, a);
    if (aBehindB && !bBehindA) return -1;
    if (bBehindA && !aBehindB) return 1;
    return 0;
}

export function visualBoundsOverlap(a, b, padding = 0) {
    if (!a || !b) return false;
    const pad = Math.max(0, Number(padding) || 0);
    return a.maxX + pad >= b.minX
        && b.maxX + pad >= a.minX
        && a.maxY + pad >= b.minY
        && b.maxY + pad >= a.minY;
}

function stableNodeCompare(a, b) {
    if (a.baseDepth !== b.baseDepth) return a.baseDepth - b.baseDepth;
    return String(a.stableKey).localeCompare(String(b.stableKey));
}

/**
 * 对静态建筑/墙/门做 footprint 拓扑排序。
 * node: { stableKey, bounds, baseDepth }
 * 返回 Map(stableKey -> finalDepth)。
 */
export function resolveStructureRenderOrder(nodes, depthGap = STRUCTURE_ORDER_GAP) {
    const valid = (nodes || []).filter((n) =>
        n && n.bounds && Number.isFinite(n.baseDepth) && n.stableKey !== undefined);
    const count = valid.length;
    const edges = Array.from({ length: count }, () => new Set());
    const incoming = Array.from({ length: count }, () => new Set());
    const indegree = new Array(count).fill(0);

    const addEdge = (from, to) => {
        if (from === to || edges[from].has(to)) return;
        edges[from].add(to);
        incoming[to].add(from);
        indegree[to]++;
    };

    for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
            const relation = compareIsoBoundsOrder(valid[i].bounds, valid[j].bounds);
            // 只有单向关系明确时才建边；斜向交叉/重叠交给稳定基础深度兜底，避免环。
            if (relation < 0) addEdge(i, j);
            else if (relation > 0) addEdge(j, i);
            else if (visualBoundsOverlap(valid[i].visualBounds, valid[j].visualBounds)) {
                // 只有画面确实相交的歧义节点才固定基础顺序；不把远处无关建筑串成全局链。
                if (stableNodeCompare(valid[i], valid[j]) <= 0) addEdge(i, j);
                else addEdge(j, i);
            }
        }
    }

    const ready = [];
    for (let i = 0; i < count; i++) if (indegree[i] === 0) ready.push(i);
    ready.sort((ia, ib) => stableNodeCompare(valid[ia], valid[ib]));
    const ordered = [];
    while (ready.length) {
        const index = ready.shift();
        ordered.push(index);
        for (const next of edges[index]) {
            indegree[next]--;
            if (indegree[next] === 0) {
                ready.push(next);
                ready.sort((ia, ib) => stableNodeCompare(valid[ia], valid[ib]));
            }
        }
    }

    // 极端几何环：不丢节点，剩余项按基础深度和稳定 key 收尾，保证不闪烁。
    if (ordered.length < count) {
        const seen = new Set(ordered);
        const remaining = [];
        for (let i = 0; i < count; i++) if (!seen.has(i)) remaining.push(i);
        remaining.sort((ia, ib) => stableNodeCompare(valid[ia], valid[ib]));
        ordered.push(...remaining);
    }

    // 只沿真实拓扑依赖抬高后继。旧实现用一个全局 cursor 把所有节点串成总序，
    // 结果是某个前景墙/建筑会把与它完全无关、甚至相隔很远的建筑整体抬到异常深度；
    // 动态单位若没有横向命中那栋建筑的 footprint，便会被这个虚高 depth 错误遮挡。
    // 无依赖节点保持自己的地面基准，Phaser 的稳定显示列表负责同 depth 的固定次序。
    const resolvedDepths = new Array(count).fill(NaN);
    for (const index of ordered) {
        const node = valid[index];
        let depth = node.baseDepth;
        for (const predecessor of incoming[index]) {
            const predecessorDepth = resolvedDepths[predecessor];
            if (Number.isFinite(predecessorDepth)) {
                depth = Math.max(depth, predecessorDepth + depthGap);
            }
        }
        resolvedDepths[index] = depth;
    }
    const result = new Map();
    for (let index = 0; index < count; index++) {
        result.set(valid[index].stableKey, resolvedDepths[index]);
    }
    return result;
}
