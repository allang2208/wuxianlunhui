import defenseStructuresJson from '../../data/defense-structures.json';

const rangedCfg = defenseStructuresJson.wallWalk?.rangedCombat || {};
const finiteOr = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

export const ELEVATED_RANGED_CONFIG = Object.freeze({
    rangeMultiplier: Math.max(1, finiteOr(rangedCfg.rangeMultiplier, 1.2)),
});

/** 仅玩家与友军站在正式墙顶面时享受高架远程加成；楼梯途中与敌人不加成。 */
export function isFriendlyWallTopRangedSource(source) {
    if (!source || source._surfaceKind !== 'wall_walk') return false;
    return source._faction === 'player' || source._faction === 'companion';
}

export function getElevatedRangedRangeMultiplier(source) {
    return isFriendlyWallTopRangedSource(source)
        ? ELEVATED_RANGED_CONFIG.rangeMultiplier
        : 1;
}

export function applyElevatedRangedRange(source, baseRange) {
    const range = Math.max(0, Number(baseRange) || 0);
    return range * getElevatedRangedRangeMultiplier(source);
}

export function projectileSourceZ(source, heightFactor = 0.58) {
    const height = Number(source?.collider?.height)
        || Number(source?.collisionHeight)
        || Number(source?.bodyHeight)
        || Number(source?.size)
        || 40;
    return (Number(source?.z) || 0) + height * heightFactor;
}

/**
 * 将攻击帧里的武器口归一化坐标换算为世界弹道起点。
 * X 会随目标方向镜像；Y 同时考虑角色显示尺寸与脚线偏移。
 */
export function projectileMuzzleOrigin(source, target, options = {}) {
    const render = source?.config?.render || {};
    const anchor = options.anchor || render.projectileMuzzle;
    const baseX = Number(source?.x) || 0;
    const baseY = Number(source?.y) || 0;
    const baseZ = Number(source?.z) || 0;
    const faceSign = Number(target?.x) >= baseX ? 1 : -1;
    const anchorX = Number(anchor?.x);
    const anchorY = Number(anchor?.y);

    if (Number.isFinite(anchorX) && Number.isFinite(anchorY)) {
        const displaySize = Math.max(1,
            Number(source?.displaySize) || Number(source?.size) || 64);
        const muzzleOffsetX = Math.abs(anchorX - 0.5) * displaySize;
        const screenOffsetY = (Number(source?.spriteOffsetY) || 0)
            + (anchorY - 0.5) * displaySize;
        return {
            x: baseX + faceSign * muzzleOffsetX,
            y: baseY + Math.max(0, screenOffsetY),
            z: baseZ + Math.max(0, -screenOffsetY),
        };
    }

    const legacyOffsetX = Number(options.offsetX);
    const legacyOffsetY = Number(options.offsetY);
    const legacyHeight = Number(options.height);
    return {
        x: baseX + faceSign * (Number.isFinite(legacyOffsetX) ? legacyOffsetX : 0),
        y: baseY + (Number.isFinite(legacyOffsetY) ? legacyOffsetY : 0),
        z: Number.isFinite(legacyHeight)
            ? baseZ + legacyHeight
            : projectileSourceZ(source, options.heightFactor),
    };
}

export function projectileTargetZ(target, fallback = 24) {
    if (!target) return fallback;
    const centerZ = Number(target.collider?.centerZ);
    if (Number.isFinite(centerZ)) return centerZ;
    const height = Number(target.collider?.height)
        || Number(target.collisionHeight)
        || Number(target.bodyHeight)
        || Number(target.size)
        || fallback * 2;
    return (Number(target.z) || 0) + height * 0.5;
}

export function projectileWallContext(source, ignore = null, origin = null) {
    const context = ignore ? { ...ignore } : {};
    context.projectileSource = source || null;
    const originZ = Number(origin?.z);
    context.projectileOrigin = (origin || source)
        ? {
            x: Number(origin?.x ?? source?.x) || 0,
            y: Number(origin?.y ?? source?.y) || 0,
            z: Number.isFinite(originZ) ? originZ : projectileSourceZ(source),
        }
        : null;
    context.ignoredProjectileWalls = new Set(ignore?.ignoredProjectileWalls || []);
    const sourceWalls = Array.isArray(source?._surfaceWalls)
        ? source._surfaceWalls
        : [];
    if (source?._surfaceKind === 'wall_walk') {
        for (const wall of [
            ...sourceWalls,
            source?._surfaceWall,
        ]) {
            if (!wall) continue;
            context.ignoredProjectileWalls.add(wall);
            if (wall._wallRect) context.ignoredProjectileWalls.add(wall._wallRect);
            if (wall._coverSeg) context.ignoredProjectileWalls.add(wall._coverSeg);
            if (wall._gateSeg) context.ignoredProjectileWalls.add(wall._gateSeg);
        }
    }
    return context;
}

export function wallHitSupportsTarget(wallHit, target) {
    if (!wallHit || target?._surfaceKind !== 'wall_walk') return false;
    const wall = wallHit.owner || wallHit.wall || wallHit.obstacle?._owner || null;
    if (!wall) return false;
    if (wall === target._surfaceWall) return true;
    return Array.isArray(target._surfaceWalls) && target._surfaceWalls.includes(wall);
}

/** 墙顶模型优先只属于“墙下向墙上”射击；楼梯与墙顶来源都不能借此越墙。 */
export function canUseWallTopModelException(source) {
    return source?._surfaceKind !== 'stairs' && source?._surfaceKind !== 'wall_walk';
}

const FRIENDLY_WALL_FACTIONS = new Set(['player', 'companion']);
const HOSTILE_WALL_FACTIONS = new Set(['enemy', 'agent']);

export function projectileDamageValue(damage) {
    if (typeof damage !== 'object' || !damage) return Math.max(0, Number(damage) || 0);
    const min = Number(damage.min) || 0;
    const max = Math.max(min, Number(damage.max) || min);
    return Math.floor(min + Math.random() * (max - min + 1));
}

/** 友军弹体只被己方墙截停；敌对弹体命中墙后扣除墙体耐久。 */
export function applyProjectileWallImpact(source, wallHit, damage, damageType = 'physical') {
    const wall = wallHit?.owner || wallHit?.wall || wallHit?.obstacle?._owner || null;
    if (!wall?.active || !wall.hittable || typeof wall.takeDamage !== 'function') return false;
    const sourceFaction = source?._faction;
    const wallFaction = wall._faction;
    if (!sourceFaction || !wallFaction || sourceFaction === wallFaction) return false;
    if (FRIENDLY_WALL_FACTIONS.has(sourceFaction) && FRIENDLY_WALL_FACTIONS.has(wallFaction)) {
        return false;
    }
    const hostilePair = HOSTILE_WALL_FACTIONS.has(sourceFaction)
        || HOSTILE_WALL_FACTIONS.has(wallFaction);
    if (!hostilePair) return false;
    const amount = projectileDamageValue(damage);
    if (!(amount > 0)) return false;
    wall.takeDamage(amount, source, damageType || 'ranged', false);
    return true;
}
