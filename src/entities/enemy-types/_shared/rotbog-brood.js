import enemyConfigData from '../../../../data/enemy-config.json';
import { RuntimeAssetManager } from '../../../phaser/assets/runtime-asset-manager.js';
import { WallSystem } from '../../../world/wall-system.js';
import { PartySystem } from '../../../systems/party-system.js';
import { PERSPECTIVE_SCALE_Y } from '../../../config/perspective-config.js';

/** 只预热资源，绝不在异步完成回调里补发召唤。 */
export function ensureRotbogBroodVisuals(owner, type = 'smallRotbogRhinocerosBeetle') {
    const config = enemyConfigData[type];
    if (!config) return false;
    if (!owner._broodVisualKeys?.length) {
        owner._broodVisualKeys = RuntimeAssetManager.getEnemyVisualKeysForContent(type, config);
    }
    const keys = owner._broodVisualKeys;
    const ready = keys.length > 0 && keys.every(key => RuntimeAssetManager.isTextureReady(key))
        && Object.keys(config.textures.frameLayouts).every(state => RuntimeAssetManager.isAnimationReady(
            `enemy_small_rotbog_rhinoceros_beetle_${state}_v1`));
    if (ready) return true;
    if (!owner.active || owner._deathStarted || owner._broodLoadPending
        || Date.now() < owner._broodLoadRetryAt || !keys.length) return false;
    owner._broodLoadPending = RuntimeAssetManager.ensureEnemyVisualKeys(keys, {
        required: false,
        shouldLoad: () => owner.active && !owner._deathStarted,
    }).catch(() => {}).finally(() => {
        owner._broodLoadPending = null;
        owner._broodLoadRetryAt = Date.now() + 2000;
    });
    return false;
}

/** 每只生成前重读占据者；已插入 registry 的同批幼虫立即参与避让。 */
export function findRotbogBroodPoint(owner, registry, radius, baseAngle, baseDistance) {
    const originX = owner.collider?.x ?? owner.x;
    const originY = owner.collider?.y ?? owner.y;
    const game = typeof window !== 'undefined' ? window.Game : null;
    const candidates = new Set(registry?.values ? registry.values() : []);
    candidates.add(owner);
    candidates.add(owner.target);
    candidates.add(game?.player);
    for (const member of PartySystem.members || []) candidates.add(member);
    for (const friendly of game?.friendlyUnits || []) candidates.add(friendly);
    const occupants = [...candidates];
    const isOccupied = (x, y) => occupants.some(entity => {
        if (!entity?.active || entity._isDead) return false;
        const ex = entity.collider?.x ?? entity.x;
        const ey = entity.collider?.y ?? entity.y;
        if (!Number.isFinite(ex) || !Number.isFinite(ey)) return false;
        const er = Math.max(
            0,
            Number(entity.collider?.radius ?? entity.groundRadius ?? entity.collisionRadius) || 0
        );
        return Math.hypot(x - ex, (y - ey) / PERSPECTIVE_SCALE_Y) < radius + er + 8;
    });
    for (let attempt = 0; attempt < 16; attempt++) {
        const angle = baseAngle + (attempt % 8) * Math.PI / 4;
        const distance = baseDistance + Math.floor(attempt / 8) * 56;
        const safe = WallSystem.findSafeSpawn(
            originX + Math.cos(angle) * distance,
            originY + Math.sin(angle) * distance * PERSPECTIVE_SCALE_Y,
            radius,
            16
        );
        if (!Number.isFinite(safe?.x) || !Number.isFinite(safe?.y)
            || !WallSystem.canMoveTo(safe.x, safe.y, radius)
            || isOccupied(safe.x, safe.y)) continue;
        return safe;
    }
    return null;
}
