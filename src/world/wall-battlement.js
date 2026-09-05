import {
    BLOCK_GRID,
    blockCellCenter,
    blockCellOf,
    gate4Cells,
} from './gate4-grid.js';

const EDGE_DEFS = Object.freeze({
    i_pos: Object.freeze({ di: 1, dj: 0, tangent: 'j', patternPhase: 0 }),
    i_neg: Object.freeze({ di: -1, dj: 0, tangent: 'j', patternPhase: 1 }),
    j_pos: Object.freeze({ di: 0, dj: 1, tangent: 'i', patternPhase: 1 }),
    j_neg: Object.freeze({ di: 0, dj: -1, tangent: 'i', patternPhase: 0 }),
});

export const WALL_BATTLEMENT_EDGES = Object.freeze(Object.keys(EDGE_DEFS));
export const WALL_BATTLEMENT_SLOTS = Object.freeze([0, 1]);
export const WALL_BATTLEMENT_RUNE_VARIANT_COUNT = 4;
export const WALL_BATTLEMENT_RUNE_VISUAL = Object.freeze({
    width: 24,
    height: 30,
    alpha: 0.82,
});
// 半槽物理尺寸由方块墙格网派生，禁止由贴图或另一份配置独立改写。
export const WALL_BATTLEMENT_GRID_FOOT = Object.freeze({
    w: Math.abs(BLOCK_GRID.e1[0]),
    d: Math.abs(BLOCK_GRID.e1[1]),
});

/** 四条外缘共享同一圈高低节奏，避免直线续建或转角时重新从高段起拍。 */
export function wallBattlementPatternVariant(edge, slot) {
    const def = EDGE_DEFS[edge];
    if (!def || !WALL_BATTLEMENT_SLOTS.includes(slot)) return 'high';
    return ((slot + def.patternPhase) & 1) === 0 ? 'high' : 'low';
}

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

/** 普通独立方块墙与四格门的真实方块门柱共用女墙承载资格。 */
export function isWallBattlementSupportWall(wall) {
    if (!wall?.active || wall._sinking || !wall._isBlockCover) return false;
    const groupRoot = wall._buildGroupRoot;
    return !groupRoot || (groupRoot._isGate4 === true
        && groupRoot.active !== false && !groupRoot._sinking);
}

/** 四格门中间两格是门洞，不是可供女墙伸入的空白外沿。 */
export function wallBattlementGateInteriorContainsCell(wall, cell) {
    const gate = wall?._buildGroupRoot;
    if (!gate?._isGate4 || !cell) return false;
    const dir = gate._facingLeft ? 'e1' : 'e2';
    return gate4Cells(gate.x, gate.y, dir).slice(1, 3).some(([x, y]) => {
        const [i, j] = blockCellOf(x, y);
        return i === cell.i && j === cell.j;
    });
}

/** 女墙沿支撑墙外沿拖建时的格网切向；几何方向只在本模块定义。 */
export function wallBattlementTangentAxis(edge) {
    return EDGE_DEFS[edge]?.tangent || null;
}

const activeBattlements = new Set();
const activeBattlementsBySlot = new Map();

function battlementSlotKey(wallCell, edge, slot) {
    if (!wallCell || !EDGE_DEFS[edge] || !WALL_BATTLEMENT_SLOTS.includes(slot)) return null;
    return `${wallCell.i}:${wallCell.j}:${edge}:${slot}`;
}

function battlementEntitySlotKey(entity) {
    const attachment = entity?._wallBattlementAttachment;
    return battlementSlotKey(attachment?.wallCell, attachment?.edge, attachment?.slot);
}

function isActiveBattlement(entity) {
    return entity?.active !== false && entity?.hittable !== false && !entity?._sinking;
}

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
        variant: wallBattlementPatternVariant(edge, slot),
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
    if (!entity?._isWallBattlement) return;
    activeBattlements.add(entity);
    const key = battlementEntitySlotKey(entity);
    if (!key) return;
    let slotEntities = activeBattlementsBySlot.get(key);
    if (!slotEntities) {
        slotEntities = new Set();
        activeBattlementsBySlot.set(key, slotEntities);
    }
    slotEntities.add(entity);
}

export function unregisterWallBattlement(entity) {
    activeBattlements.delete(entity);
    const key = battlementEntitySlotKey(entity);
    const slotEntities = key ? activeBattlementsBySlot.get(key) : null;
    if (!slotEntities) return;
    slotEntities.delete(entity);
    if (slotEntities.size <= 0) activeBattlementsBySlot.delete(key);
}

/**
 * 场景级清场不会逐个调用实体的 removeFromCollision()，因此注册表也必须显式换代；
 * 否则旧场景里仍为 active 的对象会在新场景形成“幽灵占槽/幽灵掩护”。
 */
export function clearWallBattlementRegistry() {
    activeBattlements.clear();
    activeBattlementsBySlot.clear();
}

/** 失败回滚会直接恢复旧的 Game.entities Map；同步重建女墙注册表。 */
export function rebuildWallBattlementRegistry(entities) {
    activeBattlements.clear();
    activeBattlementsBySlot.clear();
    for (const entity of entities || []) {
        if (entity?._isWallBattlement && isActiveBattlement(entity)) {
            registerWallBattlement(entity);
        }
    }
}

export function wallBattlements() {
    const result = [];
    for (const entity of activeBattlements) {
        if (isActiveBattlement(entity)) {
            result.push(entity);
        } else {
            unregisterWallBattlement(entity);
        }
    }
    return result;
}

export function wallBattlementsAtSlot(wallCell, edge, slot) {
    const key = battlementSlotKey(wallCell, edge, slot);
    const slotEntities = key ? activeBattlementsBySlot.get(key) : null;
    if (!slotEntities) return [];
    const result = [];
    for (const entity of slotEntities) {
        if (isActiveBattlement(entity)) {
            result.push(entity);
        } else {
            slotEntities.delete(entity);
            activeBattlements.delete(entity);
        }
    }
    if (slotEntities.size <= 0) activeBattlementsBySlot.delete(key);
    return result;
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

/**
 * 快照恢复不经过建造预览的 physics footprint 校验，使用同一半槽格网判断实际交叠。
 * 共享边界允许拼接，只有两个 1/2×1/2 格正方形内部相交才算冲突。
 */
export function wallBattlementAttachmentsOverlap(a, b) {
    if (!a || !b) return false;
    const delta = worldDeltaToBlockAxes(
        (Number(a.x) || 0) - (Number(b.x) || 0),
        (Number(a.y) || 0) - (Number(b.y) || 0)
    );
    const epsilon = 1e-6;
    return Math.abs(delta.i) < 0.5 - epsilon
        && Math.abs(delta.j) < 0.5 - epsilon;
}

export function wallBattlementTextureKey(variant, tierSuffix = 'sand') {
    const safeVariant = variant === 'low' ? 'low' : 'high';
    const safeTier = ['sand', 'brick', 'black_brick', 'concrete', 'rune'].includes(tierSuffix)
        ? tierSuffix
        : 'sand';
    return `wall_battlement_${safeVariant}_${safeTier}`;
}

/**
 * 女墙高度唯一口径：配置中的高/低段高度以标准方块墙模型高度为基准，
 * 运行时换算为“当前支撑墙顶 + 女墙露出高度”。
 */
export function wallBattlementCoverProfile(entity) {
    const support = entity?._wallBattlementAttachment?.wall;
    const supportTopZ = Math.max(0, Number(support?._wallTopZ) || 0);
    const referenceHeight = Math.max(1,
        Number(entity?._battlementReferenceWallHeight) || supportTopZ || 1);
    const configuredHeight = Math.max(referenceHeight,
        Number(entity?._battlementCoverHeight) || referenceHeight);
    const riseAboveWall = Math.max(0, configuredHeight - referenceHeight);
    return {
        support,
        supportTopZ,
        referenceHeight,
        configuredHeight,
        riseAboveWall,
        coverTopZ: supportTopZ + riseAboveWall,
    };
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

/** 只查命中点附近九格的半槽索引，不在每次命中时遍历全场女墙。 */
function* battlementsNearPoint(point) {
    const [centerI, centerJ] = blockCellOf(point.x, point.y);
    for (let i = centerI - 1; i <= centerI + 1; i++) {
        for (let j = centerJ - 1; j <= centerJ + 1; j++) {
            for (const edge of WALL_BATTLEMENT_EDGES) {
                for (const slot of WALL_BATTLEMENT_SLOTS) {
                    const key = battlementSlotKey({ i, j }, edge, slot);
                    const entities = activeBattlementsBySlot.get(key);
                    if (!entities) continue;
                    for (const entity of entities) {
                        if (!isActiveBattlement(entity)) {
                            unregisterWallBattlement(entity);
                        } else {
                            yield entity;
                        }
                    }
                }
            }
        }
    }
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
    let best = null;
    for (const battlement of battlementsNearPoint(targetPoint)) {
        const attachment = battlement._wallBattlementAttachment;
        const wall = attachment?.wall;
        const def = EDGE_DEFS[attachment?.edge];
        if (!wall?.active || wall?._sinking || !def) continue;

        const targetLocal = worldDeltaToBlockAxes(
            targetPoint.x - wall.x,
            targetPoint.y - wall.y
        );
        if (Math.abs(targetLocal.i) > 0.58 || Math.abs(targetLocal.j) > 0.58) continue;
        if (target._surfaceWall !== wall && !target._surfaceWalls?.includes(wall)) continue;
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
            const { supportTopZ, coverTopZ } = wallBattlementCoverProfile(battlement);
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

/** 三类受击入口共用的最终承伤分摊；调用方保留各自反馈与死亡流程。 */
export function applyWallBattlementDamageReduction(target, damage, source, isMelee, hitContext) {
    if (isMelee || !(damage > 0) || !hitContext?.directionalProjectile) return damage;
    const battlement = resolveDirectionalWallBattlementCover(target, hitContext)?.battlement;
    if (typeof battlement?.takeRedirectedBattlementDamage !== 'function') return damage;
    const configured = Number(battlement._battlementDamageReduction ?? 0.5);
    const reduction = Number.isFinite(configured) ? Math.max(0, Math.min(1, configured)) : 0.5;
    const redirected = Math.floor(damage * reduction);
    if (redirected <= 0) return damage;
    const applied = Math.max(0, Math.min(redirected,
        Number(battlement.takeRedirectedBattlementDamage(redirected, source)) || 0));
    return damage - applied;
}
