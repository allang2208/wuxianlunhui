import { WallSystem } from '../world/wall-system.js';
import { queryNearbyEntities } from '../ai/friendly-spatial-query.js';
import { canUseWallTopModelException, projectileWallContext, wallHitSupportsTarget } from './elevated-ranged.js';

export function isFriendlyAttackTarget(entity) {
    return !!entity && entity.active !== false && entity.hp > 0
        && entity._faction === 'enemy' && !entity._isEnergyNode
        && entity.hittable !== false && !entity._dying && !entity._isDead;
}

export function launchFriendlyProjectile(unit, projectile) {
    // 该入口目前只用于反坦克手榴弹。其投掷间隔长于制式枪弹的最大飞行时间；
    // 若边界帧仍残留旧弹，明确终止它，避免创建无人更新的投射物队列。
    if (unit._basic?.active) unit._basic.active = false;
    projectile._renderId = unit._friendlyProjectileSerial = (unit._friendlyProjectileSerial || 0) + 1;
    projectile.allowWallTopModelHit = canUseWallTopModelException(unit);
    unit._basic = projectile;
}

/** 保留既有命中容差，但检查整个三维线段，而不是只检查本帧终点。 */
function contactTime(entity, from, to, radius) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const ox = from.x - (entity.collider?.x ?? entity.x);
    const oy = from.y - (entity.collider?.y ?? entity.y);
    const a = dx * dx + dy * dy;
    const c = ox * ox + oy * oy - radius * radius;
    let enter = 0, exit = 1;
    if (a < 1e-10) {
        if (c > 0) return null;
    } else {
        const b = ox * dx + oy * dy;
        const disc = b * b - a * c;
        if (disc < 0) return null;
        const root = Math.sqrt(disc);
        enter = Math.max(0, (-b - root) / a);
        exit = Math.min(1, (-b + root) / a);
    }
    const bottom = (entity.collider?.bottomZ ?? (Number(entity.z) || 0)) - radius;
    const top = (entity.collider?.topZ ?? ((Number(entity.z) || 0)
        + (entity.bodyHeight || entity.size || 80))) + radius;
    const dz = to.z - from.z;
    if (Math.abs(dz) < 1e-10) {
        if (from.z < bottom || from.z > top) return null;
    } else {
        const t1 = (bottom - from.z) / dz, t2 = (top - from.z) / dz;
        enter = Math.max(enter, Math.min(t1, t2));
        exit = Math.min(exit, Math.max(t1, t2));
    }
    return enter <= exit ? enter : null;
}

/** 有序接触事件；穿透弹由调用者逐项扣命中次数，遇第一道有效墙即停止。 */
export function sweepFriendlyProjectile(source, projectile, dt, speed, entities, radius = 28) {
    const from = { x: projectile.x, y: projectile.y, z: Number(projectile.z) || 0 };
    const remaining = Math.max(0, projectile.maxDist - (Number(projectile.dist) || 0));
    const step = Math.min(remaining, Math.max(0, speed * dt / 1000));
    const seconds = speed > 0 ? step / speed : 0;
    projectile.x += Math.cos(projectile.angle) * step;
    projectile.y += Math.sin(projectile.angle) * step;
    projectile.z = from.z + (Number(projectile.vz) || 0) * seconds;
    projectile.dist = (Number(projectile.dist) || 0) + step;
    const to = { x: projectile.x, y: projectile.y, z: projectile.z };
    const wall = WallSystem.projectileWallHit?.(from.x, from.y, from.z,
        to.x, to.y, to.z, projectile.wallContext || projectileWallContext(source));
    const center = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const candidates = new Set(queryNearbyEntities(entities, center, step / 2 + radius + 64));
    if (projectile.target) candidates.add(projectile.target);
    const hits = [];
    for (const entity of candidates) {
        if (!isFriendlyAttackTarget(entity) || projectile.hitIds?.has(entity.id ?? entity)) continue;
        const t = contactTime(entity, from, to, radius);
        if (t !== null) hits.push({ entity, t });
    }
    hits.sort((a, b) => a.t - b.t);
    const allowSupportHit = projectile.allowWallTopModelHit ?? canUseWallTopModelException(source);
    // 延续墙下射击墙顶模型的例外，但仅跳过实际承托命中目标的那道墙。
    const supportHit = wall && allowSupportHit
        ? hits.find((hit) => wallHitSupportsTarget(wall, hit.entity)) : null;
    let blockingWall = wall;
    if (supportHit) {
        // 原查询只返回首墙；仅豁免该承托墙后重查，另一道墙仍会截停弹丸。
        const context = projectile.wallContext || projectileWallContext(source);
        const ignoredProjectileWalls = new Set(context.ignoredProjectileWalls || []);
        ignoredProjectileWalls.add(wall.obstacle);
        if (wall.owner) ignoredProjectileWalls.add(wall.owner);
        blockingWall = WallSystem.projectileWallHit?.(from.x, from.y, from.z,
            to.x, to.y, to.z, { ...context, ignoredProjectileWalls });
    }
    const events = hits.filter((hit) => (!blockingWall || hit.t < blockingWall.t)
        && (!supportHit || hit.t < wall.t || hit.t >= supportHit.t
            || wallHitSupportsTarget(wall, hit.entity)));
    if (blockingWall) events.push({ wall: blockingWall, t: blockingWall.t });
    return { events, from, to };
}
