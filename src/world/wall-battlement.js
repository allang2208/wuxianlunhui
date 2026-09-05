import { BLOCK_GRID, blockCellCenter } from './gate4-grid.js';

const EDGE_DEFS = Object.freeze({
    i_pos: Object.freeze({ di: 1, dj: 0, tangent: 'j' }),
    i_neg: Object.freeze({ di: -1, dj: 0, tangent: 'j' }),
    j_pos: Object.freeze({ di: 0, dj: 1, tangent: 'i' }),
    j_neg: Object.freeze({ di: 0, dj: -1, tangent: 'i' }),
});

export const WALL_BATTLEMENT_EDGES = Object.freeze(Object.keys(EDGE_DEFS));
export const WALL_BATTLEMENT_SLOTS = Object.freeze([0, 1]);
export const WALL_BATTLEMENT_RUNE_VARIANT_COUNT = 4;
export const WALL_BATTLEMENT_RUNE_VISUAL = Object.freeze({
    width: 24,
    height: 30,
    alpha: 0.82,
});

/**
 * 符文只随机选型，不进入生命周期或存档：墙格与外沿共同生成稳定编号，
 * 保证刷新、读档和科技换肤前后不会跳图。
 */
export function wallBattlementRuneVariant(wallCell, edge) {
    const key = `${Number(wallCell?.i) || 0}:${Number(wallCell?.j) || 0}:${edge || ''}`;
    let hash = 2166136261;
    for (let index = 0; index < key.length; index++) {
        hash ^= key.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return (hash % WALL_BATTLEMENT_RUNE_VARIANT_COUNT) + 1;
}

/** 女墙沿支撑墙外沿拖建时的格网切向；几何方向只在本模块定义。 */
export function wallBattlementTangentAxis(edge) {
    return EDGE_DEFS[edge]?.tangent || null;
}

const activeBattlements = new Set();

function edgeStep(edge) {
    const def = EDGE_DEFS[edge];
    if (!def) return null;
    return {
        x: BLOCK_GRID.e1[0] * def.di + BLOCK_GRID.e2[0] * def.dj,
        y: BLOCK_GRID.e1[1] * def.di + BLOCK_GRID.e2[1] * def.dj,
    };
}

function tangentStep(edge) {
    const def = EDGE_DEFS[edge];
    if (!def) return null;
    return def.tangent === 'j'
        ? { x: BLOCK_GRID.e2[0], y: BLOCK_GRID.e2[1] }
        : { x: BLOCK_GRID.e1[0], y: BLOCK_GRID.e1[1] };
}

/**
 * 标准墙格边上的一个女墙槽位。
 * 标准墙在格坐标中覆盖 [-0.5, 0.5]^2；女墙沿外法向覆盖 0.5..1.0，
 * 沿切向覆盖半条边，因此中心位于外法向 0.75、切向 ±0.25。
 */
export function createWallBattlementAttachment(wall, wallCell, edge, slot) {
    const def = EDGE_DEFS[edge];
    const out = edgeStep(edge);
    const tangent = tangentStep(edge);
    if (!wall || !def || !out || !tangent || !WALL_BATTLEMENT_SLOTS.includes(slot)) return null;
    const [wallX, wallY] = blockCellCenter(wallCell.i, wallCell.j);
    const tangentOffset = slot === 0 ? -0.25 : 0.25;
    const x = wallX + out.x * 0.75 + tangent.x * tangentOffset;
    const y = wallY + out.y * 0.75 + tangent.y * tangentOffset;
    const faceCenterX = wallX + out.x * 0.75 + tangent.x * tangentOffset;
    const faceCenterY = wallY + out.y * 0.75 + tangent.y * tangentOffset;
    return {
        wall,
        wallCell: { i: wallCell.i, j: wallCell.j },
        edge,
        slot,
        variant: slot === 0 ? 'high' : 'low',
        occupiedCell: { i: wallCell.i + def.di, j: wallCell.j + def.dj },
        x: Math.round(x),
        y: Math.round(y),
        faceLine: [
            { x: faceCenterX - tangent.x * 0.25, y: faceCenterY - tangent.y * 0.25 },
            { x: faceCenterX + tangent.x * 0.25, y: faceCenterY + tangent.y * 0.25 },
        ],
    };
}

export function registerWallBattlement(entity) {
    if (entity?._isWallBattlement) activeBattlements.add(entity);
}

export function unregisterWallBattlement(entity) {
    activeBattlements.delete(entity);
}

export function wallBattlements() {
    return Array.from(activeBattlements).filter((entity) =>
        entity?.active !== false && entity?.hittable !== false && !entity?._sinking
    );
}

export function wallBattlementsAtSlot(wallCell, edge, slot) {
    return wallBattlements().filter((entity) => {
        const attachment = entity._wallBattlementAttachment;
        return attachment?.wallCell?.i === wallCell.i
            && attachment?.wallCell?.j === wallCell.j
            && attachment.edge === edge
            && attachment.slot === slot;
    });
}

export function wallBattlementsInOccupiedCell(i, j) {
    return wallBattlements().filter((entity) => {
        const cell = entity._wallBattlementAttachment?.occupiedCell;
        return cell?.i === i && cell?.j === j;
    });
}

export function wallBattlementsSupportedBy(walls) {
    const support = new Set(walls || []);
    return wallBattlements().filter((entity) =>
        support.has(entity._wallBattlementAttachment?.wall)
    );
}

export function wallBattlementTextureKey(variant, tierSuffix = 'sand') {
    const safeVariant = variant === 'low' ? 'low' : 'high';
    const safeTier = ['sand', 'brick', 'black_brick', 'concrete', 'rune'].includes(tierSuffix)
        ? tierSuffix
        : 'sand';
    return `wall_battlement_${safeVariant}_${safeTier}`;
}

function worldDeltaToBlockAxes(dx, dy) {
    const u = dx / BLOCK_GRID.e1[0];
    const v = dy / BLOCK_GRID.e1[1];
    return {
        i: (u + v) * 0.5,
        j: (v - u) * 0.5,
    };
}

function pointOf(entity) {
    const colliderX = Number(entity?.collider?.x);
    const colliderY = Number(entity?.collider?.y);
    return {
        x: Number.isFinite(colliderX) ? colliderX : Number(entity?.x) || 0,
        y: Number.isFinite(colliderY) ? colliderY : Number(entity?.y) || 0,
    };
}

/**
 * 精确方向掩护：目标必须站在支撑墙顶；投射物从墙外侧射入，且射线在墙外边界
 * 的交点落入本槽位对应的半条边。返回离目标最近的一段有效女墙，且绝不叠加减伤。
 */
export function resolveDirectionalWallBattlementCover(target, hitContext) {
    const ray = hitContext?.directionalProjectile;
    if (!ray || hitContext?.ignoreWallBattlementCover) return null;
    if (target?._surfaceKind !== 'wall_walk') return null;
    const originX = Number(ray.originX);
    const originY = Number(ray.originY);
    if (!Number.isFinite(originX) || !Number.isFinite(originY)) return null;

    const fallbackTargetPoint = pointOf(target);
    const impactX = Number(ray.impactX);
    const impactY = Number(ray.impactY);
    const targetPoint = {
        x: Number.isFinite(impactX) ? impactX : fallbackTargetPoint.x,
        y: Number.isFinite(impactY) ? impactY : fallbackTargetPoint.y,
    };
    const targetWalls = new Set([
        ...(Array.isArray(target._surfaceWalls) ? target._surfaceWalls : []),
        target._surfaceWall,
    ].filter(Boolean));
    let best = null;
    for (const battlement of wallBattlements()) {
        const attachment = battlement._wallBattlementAttachment;
        const wall = attachment?.wall;
        const def = EDGE_DEFS[attachment?.edge];
        if (!wall?.active || wall?._sinking || !def || !targetWalls.has(wall)) continue;

        const targetLocal = worldDeltaToBlockAxes(
            targetPoint.x - wall.x,
            targetPoint.y - wall.y
        );
        if (Math.abs(targetLocal.i) > 0.58 || Math.abs(targetLocal.j) > 0.58) continue;
        const originLocal = worldDeltaToBlockAxes(originX - wall.x, originY - wall.y);
        const targetOut = targetLocal.i * def.di + targetLocal.j * def.dj;
        const originOut = originLocal.i * def.di + originLocal.j * def.dj;
        if (originOut <= 0.51 || targetOut >= 0.49) continue;
        const denominator = targetOut - originOut;
        if (Math.abs(denominator) <= 1e-8) continue;
        const t = (0.5 - originOut) / denominator;
        if (t <= 0 || t >= 1) continue;

        // 标准投射物提供弹道中心的起点/命中点高度。女墙只分摊真正穿过墙顶以上、
        // 女墙顶以下实体高度带的来弹；飞过矮段射孔上方的直线弹不应被二维投影误挡。
        const originZ = Number(ray.originZ);
        const impactZ = Number(ray.impactZ);
        if (Number.isFinite(originZ) && Number.isFinite(impactZ)) {
            const projectileRadius = Math.max(0, Number(ray.projectileRadius) || 0);
            const supportTopZ = Math.max(0, Number(wall._wallTopZ) || 0);
            const referenceHeight = Math.max(1,
                Number(battlement._battlementReferenceWallHeight) || supportTopZ || 1);
            const configuredHeight = Math.max(referenceHeight,
                Number(battlement._battlementCoverHeight) || referenceHeight);
            const coverTopZ = supportTopZ + Math.max(0, configuredHeight - referenceHeight);
            const crossingZ = originZ + (impactZ - originZ) * t;
            const crossesCoverHeight = crossingZ + projectileRadius > supportTopZ
                && crossingZ - projectileRadius < coverTopZ;
            if (!crossesCoverHeight) continue;
        }

        const originTangent = def.tangent === 'j' ? originLocal.j : originLocal.i;
        const targetTangent = def.tangent === 'j' ? targetLocal.j : targetLocal.i;
        const crossingTangent = originTangent + (targetTangent - originTangent) * t;
        const slotMin = attachment.slot === 0 ? -0.5 : 0;
        const slotMax = attachment.slot === 0 ? 0 : 0.5;
        if (crossingTangent < slotMin - 0.02 || crossingTangent > slotMax + 0.02) continue;
        if (!best || t > best.t) best = { battlement, t, crossingTangent };
    }
    return best;
}
