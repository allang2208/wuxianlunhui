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
import knightCfg from '../../data/hamster-knight-config.json';
import lightCavalryCfg from '../../data/hamster-light-cavalry-config.json';
import { getUpgradeModulesForUnitKind } from './building-upgrade-projects.js';

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
        const moduleConfig = getUpgradeModulesForUnitKind(kind);
        for (const [moduleId, rawLevel] of Object.entries(modules)) {
            const maxLevel = moduleConfig?.[moduleId]?.maxLevel;
            if (!Number.isFinite(maxLevel)) continue;
            const level = Math.min(maxLevel, Math.max(0, Math.floor(Number(rawLevel) || 0)));
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
    knight: knightCfg,
    light_cavalry: lightCavalryCfg,
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
    if (unit._isHamsterKnight) return 'knight';
    if (unit._isHamsterLightCavalry) return 'light_cavalry';
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

/** 按模块 effect 字段与等级计算通用属性补丁；不依赖特定建筑或模块 ID。 */
export function getUpgradeMultsFromLevels(modulesCfg, levels = {}, kind = null) {
    const out = {
        attackIntervalMult: 1,
        attackDamageMult: 1,
        moveSpeedMult: 1,
        count: 1,
        hpMult: 1,
        holyLightCooldownMult: 1,
        holyLightLevel: 1,
        chargeDamageMult: 1,
        miningMult: 1,
        attackRangeBonus: 0,
        defenseMult: 1,
        holyLightRangeBonus: 0,
        titheEnergyPerTick: 0,
    };
    for (const [moduleId, module] of Object.entries(modulesCfg || {})) {
        if (kind && Array.isArray(module?.unitKinds) && !module.unitKinds.includes(kind)) continue;
        const rawLevel = Math.max(0, Math.floor(Number(levels[moduleId]) || 0));
        const level = Number.isFinite(module?.maxLevel)
            ? Math.min(rawLevel, Math.max(0, Math.floor(module.maxLevel)))
            : rawLevel;
        const effect = module?.effect;
        const per = Number(module?.per);
        if (!level || !effect || !Number.isFinite(per) || !(effect in out)) continue;
        if (module.mode === 'add') out[effect] += per * level;
        else out[effect] = 1 + per * level;
    }
    return out;
}

/** 按兵种全局等级 + 建筑模块配置计算倍率。 */
export function getUnitUpgradeMults(kind, modulesCfg) {
    return getUpgradeMultsFromLevels(modulesCfg, (kind && GLOBAL_UNIT_UPGRADES[kind]) || {}, kind);
}

/** 该兵种在当前全局等级下的最终属性补丁（新生成单位直接用） */
export function getUnitUpgradePatch(kind, modulesCfg) {
    const base = UNIT_KIND_CFG[kind] || {};
    const baseAi = base.ai || {};
    const mults = getUnitUpgradeMults(kind, modulesCfg);
    const titheModule = Object.values(modulesCfg || {}).find(
        (module) => module?.effect === 'titheEnergyPerTick'
    );
    return {
        attackInterval: Math.max(300, Math.round((baseAi.attackInterval ?? 2000) * mults.attackIntervalMult)),
        attackDamage: Math.max(1, Math.round((baseAi.attackDamage ?? 50) * mults.attackDamageMult)),
        attackRange: Math.max(0, Math.round((baseAi.attackRange ?? 0) + mults.attackRangeBonus)),
        walkSpeed: Math.max(20, Math.round((baseAi.walkSpeed ?? 120) * mults.moveSpeedMult)),
        baseMaxHp: Math.max(1, Math.round((base.baseMaxHp ?? 300) * mults.hpMult)),
        holyLightCooldownMult: mults.holyLightCooldownMult,
        holyLightLevel: mults.holyLightLevel,
        chargeDamageMult: mults.chargeDamageMult,
        attackRangeBonus: mults.attackRangeBonus,
        defenseMult: mults.defenseMult,
        holyLightRangeBonus: mults.holyLightRangeBonus,
        titheEnergyPerTick: mults.titheEnergyPerTick,
        castRange: Math.max(0, Math.round((baseAi.castRange ?? 0) + mults.holyLightRangeBonus)),
        titheIntervalMs: Number(titheModule?.tickMs) || 0,
    };
}

/** 将配置补丁同步到单位通用数据；专属 AI 字段由单位自身的 applyBarracksUpgrades 处理。 */
export function applyUnitUpgradePatch(unit, patch) {
    if (!unit || !patch) return;
    if (typeof unit.applyBarracksUpgrades === 'function') unit.applyBarracksUpgrades(patch);
    if (Number.isFinite(patch.defenseMult) && unit.data) {
        if (!Number.isFinite(unit._upgradeBaseDefense)) unit._upgradeBaseDefense = unit.data.def ?? unit.def ?? 0;
        const nextDefense = Math.max(0, Math.round(unit._upgradeBaseDefense * patch.defenseMult));
        unit.data.def = nextDefense;
        unit.def = nextDefense;
    }
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
        applyUnitUpgradePatch(e, patch);
    }
}
