import combatElevationJson from '../../data/combat-elevation.json';

const surfaceEffectConfig = combatElevationJson.surfaceEffects || {};
const finiteOr = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

export const SURFACE_EFFECT_CONFIG = Object.freeze({
    surfaceTolerance: Math.max(0, finiteOr(surfaceEffectConfig.surfaceTolerance, 24)),
    projectileVerticalPadding: Math.max(0, finiteOr(surfaceEffectConfig.projectileVerticalPadding, 4)),
});

/** 返回实体用于碰撞/图层判断的垂直区间。 */
export function entityVerticalRange(entity) {
    const colliderBottom = Number(entity?.collider?.bottomZ);
    const bottom = Number.isFinite(colliderBottom)
        ? colliderBottom
        : (Number(entity?.z) || 0);
    const colliderTop = Number(entity?.collider?.topZ);
    if (Number.isFinite(colliderTop)) return { bottom, top: colliderTop };
    const height = Math.max(
        1,
        Number(entity?.collider?.height)
            || Number(entity?.collisionHeight)
            || Number(entity?.size)
            || (Number(entity?.groundRadius) || 20) * 2
    );
    return { bottom, top: bottom + height };
}

/** 两个实体的垂直体积是否重叠。 */
export function verticalRangesOverlap(left, right, tolerance = 2) {
    const a = entityVerticalRange(left);
    const b = entityVerticalRange(right);
    return a.top > b.bottom + tolerance && b.top > a.bottom + tolerance;
}

const FRIENDLY_ELEVATED_FACTIONS = new Set(['player', 'companion']);

function isFriendlyMobileUnit(entity) {
    const faction = entity?._faction || entity?.faction;
    return !!entity
        && FRIENDLY_ELEVATED_FACTIONS.has(faction)
        && (Number(entity.groundRadius) || Number(entity.collisionRadius) || 0) > 0
        && !entity._isDefenseStructure
        && !entity._isDefenseTower
        && !entity._isDefenseCover
        && !entity._isBuilding;
}

function hasEnteredElevatedTraffic(entity) {
    return entity?._surfaceKind === 'stairs'
        || entity?._surfaceKind === 'wall_walk'
        || !!entity?._elevatedNavigationBridge;
}

export function isFriendlyElevatedTrafficUnit(entity) {
    return isFriendlyMobileUnit(entity) && hasEnteredElevatedTraffic(entity);
}

/**
 * 友方单位取得楼梯/城墙表面身份后，不再以各自 footprint 互相分离。
 * 只豁免 unit-vs-unit：墙体、建筑、防坠线、Portal 入口排队和表面身份提交不受影响。
 * 任一方已进入高架交通即可豁免，避免楼梯单位被入口外或墙顶单位反向推离窄通道。
 */
export function shouldIgnoreFriendlyElevatedSeparation(left, right) {
    return isFriendlyMobileUnit(left)
        && isFriendlyMobileUnit(right)
        && (isFriendlyElevatedTrafficUnit(left) || isFriendlyElevatedTrafficUnit(right));
}

/** lower 是否完整处于 upper 下方。 */
export function isEntityStrictlyBelow(lower, upper, tolerance = 2) {
    return entityVerticalRange(lower).top <= entityVerticalRange(upper).bottom + tolerance;
}

/** 实体当前脚底/承载面高度；只读 Collider 真源。 */
export function entitySurfaceZ(entity) {
    const bottomZ = Number(entity?.collider?.bottomZ);
    return Number.isFinite(bottomZ) ? bottomZ : (Number(entity?.z) || 0);
}

/** 创建跟随某个承载面的范围效果高度快照。 */
export function surfaceEffectContext(z = 0, options = {}) {
    return Object.freeze({
        mode: 'surface',
        z: Number(z) || 0,
        tolerance: Math.max(
            0,
            finiteOr(options.tolerance, SURFACE_EFFECT_CONFIG.surfaceTolerance)
        ),
        surfaceKind: options.surfaceKind || null,
    });
}

/** 以施法者/宿主当前脚底为范围效果承载面；调用时即快照，不随其后续上下墙漂移。 */
export function surfaceEffectFromEntity(entity, options = {}) {
    return surfaceEffectContext(entitySurfaceZ(entity), {
        ...options,
        surfaceKind: options.surfaceKind || entity?._surfaceKind || null,
    });
}

/** 创建有限垂直体积，供真实 z 飞行的技能投射物直接命中使用。 */
export function volumeEffectContext(centerZ = 0, radius = 0, options = {}) {
    const padding = Math.max(
        0,
        finiteOr(options.padding, SURFACE_EFFECT_CONFIG.projectileVerticalPadding)
    );
    const halfHeight = Math.max(0, Number(radius) || 0) + padding;
    const center = Number(centerZ) || 0;
    return Object.freeze({
        mode: 'volume',
        minZ: center - halfHeight,
        maxZ: center + halfHeight,
    });
}

/**
 * 解析指定点的承载面。鼠标/指令投影点命中墙或楼梯时读取 DefenseSystem 的现有真源，
 * 返回的 x/y 是承载面上的真实世界点；带 impactZ 时输入视为已经处于真实世界平面的撞击点，
 * 只选择最接近撞击高度的层，不再改写 x/y。
 */
export function surfaceEffectAtPoint(x, y, options = {}) {
    if (options.entity) return surfaceEffectFromEntity(options.entity, options);
    const pointX = Number(x) || 0;
    const pointY = Number(y) || 0;
    const fallbackZ = Number.isFinite(Number(options.fallbackZ)) ? Number(options.fallbackZ) : 0;
    const impactZ = Number(options.impactZ);
    const isPhysicalImpact = Number.isFinite(impactZ);
    let resolved = null;
    const defenseSystem = typeof window !== 'undefined' ? window.Game?.DefenseSystem : null;
    if (isPhysicalImpact && defenseSystem?.resolvePhysicalSurface) {
        resolved = defenseSystem.resolvePhysicalSurface(pointX, pointY, impactZ);
    } else if (defenseSystem?.resolveSurfaceTarget) {
        resolved = defenseSystem.resolveSurfaceTarget(pointX, pointY);
    }
    const resolvedZ = Number(resolved?.z);
    let z = Number.isFinite(resolvedZ) ? resolvedZ : fallbackZ;
    if (isPhysicalImpact && Number.isFinite(resolvedZ)) {
        z = Math.abs(impactZ - resolvedZ) < Math.abs(impactZ - fallbackZ)
            ? resolvedZ
            : fallbackZ;
    }
    const usesResolvedSurface = Number.isFinite(resolvedZ) && z === resolvedZ;
    const context = surfaceEffectContext(z, {
        ...options,
        surfaceKind: usesResolvedSurface ? resolved?.surfaceKind : (options.surfaceKind || 'ground'),
    });
    return Object.freeze({
        ...context,
        x: !isPhysicalImpact && usesResolvedSurface && Number.isFinite(Number(resolved?.x))
            ? Number(resolved.x)
            : pointX,
        y: !isPhysicalImpact && usesResolvedSurface && Number.isFinite(Number(resolved?.y))
            ? Number(resolved.y)
            : pointY,
    });
}

/** 范围效果的垂直语义是否允许命中目标。缺少上下文时失败关闭，禁止静默退回二维贯层命中。 */
export function effectElevationIntersectsEntity(context, entity) {
    if (!context) return false;
    if (!entity?.collider) return false;
    if (context.mode === 'volume') {
        const range = entityVerticalRange(entity);
        return range.bottom < context.maxZ && range.top > context.minZ;
    }
    const targetZ = entitySurfaceZ(entity);
    return Math.abs(targetZ - (Number(context.z) || 0)) <= Math.max(0, Number(context.tolerance) || 0);
}
