// ============================================================
// 兵种升级全局登记表（2026-08-17）
// 建筑物升级按「兵种」全局生效（用户口径）：在任一产兵建筑/仓鼠兵营升级模块，
// 等级记在该兵种名下；所有该兵种单位（无论哪个建筑生成）实时同步生效，
// 后续新生成单位也读取全局等级。不同建筑升级同一兵种共享同一份等级（不叠加）。
// 仓鼠小屋（矿工）暂保持建筑级（经济模块为主），如需全局再扩展。
// ============================================================
import militiaCfg from '../../data/hamster-militia-config.json';
import warriorCfg from '../../data/hamster-warrior-config.json';
import shooterCfg from '../../data/hamster-shooter-config.json';
import guardCfg from '../../data/hamster-guard-config.json';
import scoutCfg from '../../data/hamster-scout-config.json';
import musketeerCfg from '../../data/hamster-musketeer-config.json';
import priestCfg from '../../data/hamster-priest-config.json';

/** 全局升级等级：{ [kind]: { [moduleId]: level } }（满级由建筑模块配置 maxLevel 控制） */
export const GLOBAL_UNIT_UPGRADES = {};

/** 新游戏重置：保持导出对象引用不变，避免消费者持有旧对象。 */
export function resetUnitUpgrades() {
    for (const key of Object.keys(GLOBAL_UNIT_UPGRADES)) delete GLOBAL_UNIT_UPGRADES[key];
}

/** 存档用纯数据快照。 */
export function serializeUnitUpgrades() {
    return JSON.parse(JSON.stringify(GLOBAL_UNIT_UPGRADES));
}

/** 读档恢复；只接受非负有限整数等级。 */
export function restoreUnitUpgrades(data) {
    resetUnitUpgrades();
    if (!data || typeof data !== 'object') return;
    for (const [kind, modules] of Object.entries(data)) {
        if (!UNIT_KIND_CFG[kind] || !modules || typeof modules !== 'object') continue;
        for (const [moduleId, rawLevel] of Object.entries(modules)) {
            const level = Math.max(0, Math.floor(Number(rawLevel) || 0));
            if (level > 0) {
                if (!GLOBAL_UNIT_UPGRADES[kind]) GLOBAL_UNIT_UPGRADES[kind] = {};
                GLOBAL_UNIT_UPGRADES[kind][moduleId] = level;
            }
        }
    }
}

/** 兵种 key → 基准配置（与 BARRACKS_CONFIG.unit / PRODUCER_UNIT_CFG 同源） */
export const UNIT_KIND_CFG = {
    militia: militiaCfg,
    warrior: warriorCfg,
    shooter: shooterCfg,
    guard: guardCfg,
    scout: scoutCfg,
    musketeer: musketeerCfg,
    priest: priestCfg,
};

/** 实体识别兵种 key（非战斗兵种返回 null） */
export function getUnitKind(unit) {
    if (!unit) return null;
    if (unit._isHamsterMilitia) return 'militia';
    if (unit._isHamsterWarrior) return 'warrior';
    if (unit._isHamsterShooter) return 'shooter';
    if (unit._isHamsterGuard) return 'guard';
    if (unit._isHamsterScout) return 'scout';
    if (unit._isHamsterMusketeer) return 'musketeer';
    if (unit._isHamsterPriest) return 'priest';
    return null;
}

/** 当前兵种某模块全局等级 */
export function getUnitUpgradeLevel(kind, moduleId) {
    if (!kind || !moduleId) return 0;
    return (GLOBAL_UNIT_UPGRADES[kind] || {})[moduleId] || 0;
}

/** 兵种模块全局等级 +1，返回新等级 */
export function raiseUnitUpgradeLevel(kind, moduleId) {
    if (!kind || !moduleId) return 0;
    if (!GLOBAL_UNIT_UPGRADES[kind]) GLOBAL_UNIT_UPGRADES[kind] = {};
    GLOBAL_UNIT_UPGRADES[kind][moduleId] = (GLOBAL_UNIT_UPGRADES[kind][moduleId] || 0) + 1;
    return GLOBAL_UNIT_UPGRADES[kind][moduleId];
}

/** 按兵种全局等级 + 建筑模块配置计算倍率 */
export function getUnitUpgradeMults(kind, modulesCfg) {
    const m = (kind && GLOBAL_UNIT_UPGRADES[kind]) || {};
    const mods = modulesCfg || {};
    const out = {
        attackIntervalMult: 1,
        attackDamageMult: 1,
        moveSpeedMult: 1,
        count: 1,
        hpMult: 1,
        holyLightCooldownMult: 1,
        holyLightLevel: 1,
    };
    if (mods.attackSpd && m.attackSpd) out.attackIntervalMult = 1 + mods.attackSpd.per * m.attackSpd;
    if (mods.damage && m.damage) out.attackDamageMult = 1 + mods.damage.per * m.damage;
    if (mods.moveSpd && m.moveSpd) out.moveSpeedMult = 1 + mods.moveSpd.per * m.moveSpd;
    if (mods.count && m.count) out.count = 1 + m.count;
    if (mods.hp && m.hp) out.hpMult = 1 + mods.hp.per * m.hp;
    if (mods.castSpd && m.castSpd) out.holyLightCooldownMult = 1 + mods.castSpd.per * m.castSpd;
    if (mods.holyLight && m.holyLight) out.holyLightLevel = 1 + Math.round(mods.holyLight.per * m.holyLight);
    return out;
}

/** 该兵种在当前全局等级下的最终属性补丁（新生成单位直接用） */
export function getUnitUpgradePatch(kind, modulesCfg) {
    const base = UNIT_KIND_CFG[kind] || {};
    const baseAi = base.ai || {};
    const mults = getUnitUpgradeMults(kind, modulesCfg);
    return {
        attackInterval: Math.max(300, Math.round((baseAi.attackInterval ?? 2000) * mults.attackIntervalMult)),
        attackDamage: Math.max(1, Math.round((baseAi.attackDamage ?? 50) * mults.attackDamageMult)),
        walkSpeed: Math.max(20, Math.round((baseAi.walkSpeed ?? 120) * mults.moveSpeedMult)),
        baseMaxHp: Math.max(1, Math.round((base.baseMaxHp ?? 300) * mults.hpMult)),
        holyLightCooldownMult: mults.holyLightCooldownMult,
        holyLightLevel: mults.holyLightLevel,
    };
}

/** 把该兵种全局升级实时同步给场景内所有存活单位（跨建筑） */
export function applyGlobalUpgradesToKind(kind, modulesCfg) {
    if (!kind) return;
    const patch = getUnitUpgradePatch(kind, modulesCfg);
    const game = (typeof window !== 'undefined' && window.Game) || null;
    if (!game || !game.entities) return;
    for (const e of game.entities.values()) {
        if (!e || !e.active || e._dying) continue;
        if (getUnitKind(e) !== kind) continue;
        if (typeof e.applyBarracksUpgrades === 'function') {
            e.applyBarracksUpgrades(patch);
        }
    }
}
