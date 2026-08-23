/**
 * 世界-122 防守怪统一目标优先级。
 *
 * 顺序：距离档位优先；同档位内 仓鼠 > 玩家队友 > 玩家 > 普通建筑 > 基地。
 * 本地没有目标时回退远处建筑/基地；全部结构消失后才搜索远处单位。
 */
import { distanceToEntityShape } from '../utils/collision-helpers.js';
import { attackSlotsOf } from './defense-targeting.js';

export const DEFENSE_LOCAL_RANGE = 320;
export const DEFENSE_DISTANCE_BAND = 128;
export const DEFENSE_SWITCH_DISTANCE_MARGIN = 24;

export const DEFENSE_TARGET_TYPE = Object.freeze({
    HAMSTER: 0,
    PARTY: 1,
    PLAYER: 2,
    BUILDING: 3,
    BASE: 4,
    INVALID: 99,
});

export function isHamsterTarget(entity) {
    return !!(entity && (
        entity._isHamsterMiner
        || entity._isHamsterWarrior
        || entity._isHamsterShooter
        || entity._isHamsterGuard
        || entity._isHamsterMilitia
        || entity._isHamsterScout
        || entity._isHamsterMusketeer
        || entity._isHamsterPriest
        || entity._isHamsterKnight
        || entity._isHamsterLightCavalry
        // 赏金猎人/探险家当前靠父类 flag（musketeer/scout）继承覆盖；
        // 显式列出防止未来断开继承时静默失效（skill/09 手动名单铁律）
        || entity._isHamsterBountyHunter
        || entity._isHamsterExplorer
    ));
}

export function classifyDefenseTarget(entity) {
    if (!entity) return DEFENSE_TARGET_TYPE.INVALID;
    if (isHamsterTarget(entity) && entity._enemyTargetable) return DEFENSE_TARGET_TYPE.HAMSTER;
    if (entity._isPartyCompanion && entity._enemyTargetable) return DEFENSE_TARGET_TYPE.PARTY;
    if (entity._isDefenseBase || entity._isWorldPortalCore) return DEFENSE_TARGET_TYPE.BASE;
    if (entity._isDefenseStructure) return DEFENSE_TARGET_TYPE.BUILDING;
    if (entity._faction === 'player') return DEFENSE_TARGET_TYPE.PLAYER;
    return DEFENSE_TARGET_TYPE.INVALID;
}

export function isDefenseTargetEligible(entity) {
    if (!entity || !entity.active || entity.hittable === false) return false;
    if (entity.hp !== undefined && entity.hp <= 0) return false;
    if (typeof entity.x !== 'number' || typeof entity.y !== 'number') return false;
    return classifyDefenseTarget(entity) !== DEFENSE_TARGET_TYPE.INVALID;
}

export function defenseTargetMeta(enemy, target) {
    const distance = Math.max(0, distanceToEntityShape(target, enemy.x, enemy.y));
    const threatEntry = enemy._threatTable && enemy._threatTable.get(target.id);
    const threat = threatEntry ? threatEntry.threat || 0 : 0;
    const hpRatio = target.maxHp > 0 ? Math.max(0, target.hp / target.maxHp) : 1;
    return {
        target,
        distance,
        band: Math.floor(distance / DEFENSE_DISTANCE_BAND),
        type: classifyDefenseTarget(target),
        threat,
        hpRatio,
    };
}

export function compareDefenseTargetMeta(a, b) {
    if (a.band !== b.band) return a.band - b.band;
    if (a.type !== b.type) return a.type - b.type;
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.threat !== b.threat) return b.threat - a.threat;
    return a.hpRatio - b.hpRatio;
}

export function compareDefenseTargets(enemy, a, b) {
    return compareDefenseTargetMeta(defenseTargetMeta(enemy, a), defenseTargetMeta(enemy, b));
}

/**
 * 两阶段目标选择：
 * 1. 320px 本地池（全部类型）；
 * 2. 本地无目标 → 远处结构；结构全灭 → 远处单位。
 */
export function pickDefensePriorityTarget(enemy, entities, {
    exclude = null,
    occupancy = null,
    localRange = enemy?._engageHostileRange ?? DEFENSE_LOCAL_RANGE,
    alertRange = enemy?._alertRange || 9000,
    allowFarUnitFallback = true,
    isReachable = () => true,
} = {}) {
    if (!enemy || !entities) return null;
    const iter = entities.values ? entities.values() : entities;
    const local = [];
    const strategic = [];
    const farUnits = [];

    for (const entity of iter) {
        if (entity === enemy || entity === exclude || !isDefenseTargetEligible(entity)) continue;
        const meta = defenseTargetMeta(enemy, entity);
        if (meta.distance > alertRange) continue;
        if (meta.distance <= localRange) local.push(meta);
        else if (entity._isDefenseStructure) strategic.push(meta);
        else farUnits.push(meta);
    }

    let scope = 'local';
    let pool = local;
    if (pool.length === 0) {
        scope = 'strategic';
        pool = strategic;
    }
    if (pool.length === 0) {
        scope = 'far-unit';
        pool = allowFarUnitFallback ? farUnits : [];
    }
    if (pool.length === 0) return null;

    pool.sort(compareDefenseTargetMeta);
    const occ = occupancy || new Map();
    // 结构候选优先选择未超容量者；若全部超容量，仍回退排序第一项，保证永远有目标。
    const hasCapacity = (meta) => !meta.target._isDefenseStructure
        || (occ.get(meta.target) || 0) < attackSlotsOf(meta.target);
    const chosen = pool.find((meta) => hasCapacity(meta)
        && (!meta.target._isDefenseStructure || isReachable(meta.target)))
        || pool.find(hasCapacity)
        || pool[0];
    return { ...chosen, scope };
}

export function isDefenseAttackInProgress(enemy) {
    if (!enemy) return false;
    if (enemy._attackAnimTimer > 0 || enemy._frozenForCast) return true;
    const state = enemy.weaponAnim && enemy.weaponAnim.state;
    return state === 'windup' || state === 'swing';
}

/** 距离档位稳定切换；同档才比较类型，避免每次扫描因几像素变化来回跳目标。 */
export function shouldSwitchDefenseTarget(enemy, current, candidate) {
    if (!candidate || !candidate.target || candidate.target === current) return false;
    if (!current || !isDefenseTargetEligible(current)) return true;
    if (isDefenseAttackInProgress(enemy)) return false;

    const cur = defenseTargetMeta(enemy, current);
    if (candidate.band !== cur.band) return candidate.band < cur.band;
    if (candidate.type !== cur.type) return candidate.type < cur.type;
    if (candidate.distance + DEFENSE_SWITCH_DISTANCE_MARGIN < cur.distance) return true;
    if (Math.abs(candidate.distance - cur.distance) <= 8) {
        if (candidate.threat > cur.threat + 10) return true;
        if (candidate.threat === cur.threat && candidate.hpRatio + 0.1 < cur.hpRatio) return true;
    }
    return false;
}
