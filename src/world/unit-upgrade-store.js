// ============================================================
// 兵种升级全局登记表（2026-08-17）
// 建筑物升级按「兵种」全局生效（用户口径）：在任一产兵建筑/仓鼠兵营升级模块，
// 等级记在该兵种名下；所有该兵种单位（无论哪个建筑生成）实时同步生效，
// 后续新生成单位也读取全局等级。不同建筑升级同一兵种共享同一份等级（不叠加）。
// 仓鼠小屋（矿工）暂保持建筑级（经济模块为主），如需全局再扩展。
// ============================================================
import militiaCfg from '../../data/hamster-militia-config.json';
import warriorCfg from '../../data/hamster-warrior-config.json';
import championCfg from '../../data/hamster-champion-config.json';
import shooterCfg from '../../data/hamster-shooter-config.json';
import guardCfg from '../../data/hamster-guard-config.json';
import phalanxCfg from '../../data/hamster-phalanx-config.json';
import riotSquadCfg from '../../data/hamster-riot-squad-config.json';
import specialForcesCfg from '../../data/hamster-special-forces-config.json';
import trenchAssaultCfg from '../../data/hamster-trench-assault-config.json';
import halberdierCfg from '../../data/hamster-halberdier-config.json';
import scoutCfg from '../../data/hamster-scout-config.json';
import rangerCfg from '../../data/hamster-ranger-config.json';
import crossbowCfg from '../../data/hamster-crossbow-config.json';
import catapultCrewCfg from '../../data/hamster-catapult-crew-config.json';
import fieldCannonCrewCfg from '../../data/hamster-field-cannon-crew-config.json';
import industrialArtilleryCrewCfg from '../../data/hamster-industrial-artillery-crew-config.json';
import howitzerCrewCfg from '../../data/hamster-howitzer-crew-config.json';
import longbowCfg from '../../data/hamster-longbow-config.json';
import assaultCfg from '../../data/hamster-assault-config.json';
import heavyMachineGunnerCfg from '../../data/hamster-heavy-machine-gunner-config.json';
import serviceRiflemanCfg from '../../data/hamster-service-rifleman-config.json';
import barAutomaticRiflemanCfg from '../../data/hamster-bar-automatic-rifleman-config.json';
import sniperCfg from '../../data/hamster-sniper-config.json';
import musketeerCfg from '../../data/hamster-musketeer-config.json';
import antiVehicleCfg from '../../data/hamster-anti-vehicle-config.json';
import priestCfg from '../../data/hamster-priest-config.json';
import knightCfg from '../../data/hamster-knight-config.json';
import lightCavalryCfg from '../../data/hamster-light-cavalry-config.json';
import cavalryCfg from '../../data/hamster-cavalry-config.json';
import wingedHussarCfg from '../../data/hamster-winged-hussar-config.json';
import scoutRifleSkirmisherCfg from '../../data/hamster-scout-rifle-skirmisher-config.json';
import poweredEodExplosiveLancerCfg from '../../data/hamster-powered-eod-explosive-lancer-config.json';
import industrialCarbineCavalryCfg from '../../data/hamster-industrial-carbine-cavalry-config.json';
import industrialHeavyLancerCfg from '../../data/hamster-industrial-heavy-lancer-config.json';
import antiTankRiflemanCfg from '../../data/hamster-anti-tank-rifleman-config.json';
import industrialReconRiflemanCfg from '../../data/hamster-industrial-recon-rifleman-config.json';
import steelShieldAssaultCfg from '../../data/hamster-steel-shield-assault-config.json';
import ninjaCfg from '../../data/hamster-ninja-config.json';
import samuraiCfg from '../../data/hamster-samurai-config.json';
import camelCavalryCfg from '../../data/hamster-camel-cavalry-config.json';
import explorerCfg from '../../data/hamster-explorer-config.json';
import bountyHunterCfg from '../../data/hamster-bounty-hunter-config.json';
import jaguarWarriorCfg from '../../data/jaguar-warrior-config.json';
import junglePriestCfg from '../../data/jungle-priest-config.json';
import desertPriestCfg from '../../data/desert-priest-config.json';
import { COMBAT_CONFIG } from '../config/combat-config.js';
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

/** 兵种 key → 基准配置（与 ProducerBuilding 通用单位工厂同源） */
export const UNIT_KIND_CFG = {
    militia: militiaCfg,
    warrior: warriorCfg,
    champion: championCfg,
    shooter: shooterCfg,
    guard: guardCfg,
    phalanx: phalanxCfg,
    riot_special: riotSquadCfg,
    special_forces: specialForcesCfg,
    trench_assault: trenchAssaultCfg,
    halberd: halberdierCfg,
    scout: scoutCfg,
    ranger: rangerCfg,
    crossbow: crossbowCfg,
    hamster_catapult_crew: catapultCrewCfg,
    hamster_field_cannon_crew: fieldCannonCrewCfg,
    industrial_artillery_crew: industrialArtilleryCrewCfg,
    hamster_howitzer_crew: howitzerCrewCfg,
    longbow: longbowCfg,
    assault: assaultCfg,
    heavy_machine_gunner: heavyMachineGunnerCfg,
    service_rifleman: serviceRiflemanCfg,
    emplaced_machine_gun_crew: barAutomaticRiflemanCfg,
    sniper: sniperCfg,
    musketeer: musketeerCfg,
    anti_vehicle: antiVehicleCfg,
    priest: priestCfg,
    knight: knightCfg,
    light_cavalry: lightCavalryCfg,
    cavalry: cavalryCfg,
    winged_hussar: wingedHussarCfg,
    scout_rifle_skirmisher: scoutRifleSkirmisherCfg,
    powered_eod_explosive_lancer: poweredEodExplosiveLancerCfg,
    industrial_carbine_cavalry: industrialCarbineCavalryCfg,
    gunpowder_explosive_lancer: industrialHeavyLancerCfg,
    anti_tank_rifleman: antiTankRiflemanCfg,
    industrial_recon_rifleman: industrialReconRiflemanCfg,
    steel_shield_assault: steelShieldAssaultCfg,
    ninja: ninjaCfg,
    samurai: samuraiCfg,
    camel_cavalry: camelCavalryCfg,
    explorer: explorerCfg,
    bounty_hunter: bountyHunterCfg,
    jaguar_warrior: jaguarWarriorCfg,
    jungle_priest: junglePriestCfg,
    desert_priest: desertPriestCfg,
};

/** 全体可生产军事单位的常规移动倍率；冲锋等技能位移不走本链路。 */
function getFriendlyUnitSpeedMultiplier() {
    const value = Number(COMBAT_CONFIG.friendlyUnitDefaults?.globalSpeedMultiplier);
    return Number.isFinite(value) && value >= 0 ? value : 1;
}

/** 实体识别兵种 key（非战斗兵种返回 null） */
export function getUnitKind(unit) {
    if (!unit) return null;
    // 冠军继承民兵近战生命周期，必须先于 _isHamsterMilitia 判断。
    if (unit._isHamsterChampion) return 'champion';
    if (unit._isHamsterMilitia) return 'militia';
    if (unit._isHamsterExplorer) return 'explorer';
    if (unit._isHamsterBountyHunter) return 'bounty_hunter';
    if (unit._isJaguarWarrior) return 'jaguar_warrior';
    if (unit._isJunglePriest) return 'jungle_priest';
    if (unit._isDesertPriest) return 'desert_priest';
    if (unit._isHamsterSamurai) return 'samurai';
    if (unit._isHamsterWarrior) return 'warrior';
    if (unit._isHamsterShooter) return 'shooter';
    // 方阵继承盾卫，必须先于 _isHamsterGuard 判断。
    if (unit._isHamsterPhalanx) return 'phalanx';
    if (unit._isHamsterGuard) return 'guard';
    if (unit._isHamsterHalberdier) return 'halberd';
    if (unit._isHamsterRanger) return 'ranger';
    if (unit._isHamsterCrossbow) return 'crossbow';
    if (unit._isHamsterHowitzerCrew) return 'hamster_howitzer_crew';
    if (unit._isHamsterIndustrialArtilleryCrew) return 'industrial_artillery_crew';
    if (unit._isHamsterFieldCannonCrew) return 'hamster_field_cannon_crew';
    if (unit._isHamsterCatapultCrew) return 'hamster_catapult_crew';
    if (unit._isHamsterLongbow) return 'longbow';
    if (unit._isHamsterIndustrialReconRifleman) return 'industrial_recon_rifleman';
    if (unit._isHamsterAntiVehicle) return 'anti_vehicle';
    if (unit._isHamsterSniper) return 'sniper';
    if (unit._isHamsterScout) return 'scout';
    // 战壕突击、特战、防暴队、突击兵与重机枪手都继承火枪实体，必须先于 _isHamsterMusketeer 判断。
    if (unit._isHamsterTrenchAssault) return 'trench_assault';
    if (unit._isHamsterSpecialForces) return 'special_forces';
    if (unit._isHamsterRiotSquad) return 'riot_special';
    if (unit._isHamsterServiceRifleman) return 'service_rifleman';
    if (unit._isHamsterBarAutomaticRifleman) return 'emplaced_machine_gun_crew';
    if (unit._isHamsterAssault) return 'assault';
    if (unit._isHamsterHeavyMachineGunner) return 'heavy_machine_gunner';
    if (unit._isHamsterAntiTankRifleman) return 'anti_tank_rifleman';
    if (unit._isHamsterSteelShieldAssault) return 'steel_shield_assault';
    if (unit._isHamsterIndustrialCarbineCavalry) return 'industrial_carbine_cavalry';
    if (unit._isHamsterScoutRifleSkirmisher) return 'scout_rifle_skirmisher';
    if (unit._isHamsterMusketeer) return 'musketeer';
    if (unit._isHamsterPriest) return 'priest';
    // 二级骑兵继承一级实体，必须先于基础骑士/轻骑判断。
    if (unit._isHamsterPoweredEodExplosiveLancer) return 'powered_eod_explosive_lancer';
    if (unit._isHamsterIndustrialHeavyLancer) return 'gunpowder_explosive_lancer';
    if (unit._isHamsterWingedHussar) return 'winged_hussar';
    if (unit._isHamsterCavalry) return 'cavalry';
    if (unit._isHamsterKnight) return 'knight';
    if (unit._isHamsterCamelCavalry) return 'camel_cavalry';
    if (unit._isHamsterLightCavalry) return 'light_cavalry';
    if (unit._isHamsterNinja) return 'ninja';
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

/** 共享升级组当前等级：取全部适用兵种的最高已有等级，旧档分叉时不损失已购买等级。 */
export function getSharedUnitUpgradeLevel(kinds, moduleId) {
    return [...new Set((kinds || []).filter(Boolean))].reduce(
        (level, kind) => Math.max(level, getUnitUpgradeLevel(kind, moduleId)), 0
    );
}

export function syncSharedUnitUpgradeLevel(kinds, moduleId, maxLevel = Infinity) {
    const targets = [...new Set((kinds || []).filter((kind) => UNIT_KIND_CFG[kind]))];
    if (!targets.length || !moduleId) return 0;
    const cap = Number.isFinite(maxLevel) ? Math.max(0, Math.floor(maxLevel)) : Infinity;
    const level = Math.min(cap, getSharedUnitUpgradeLevel(targets, moduleId));
    for (const kind of targets) {
        if (!GLOBAL_UNIT_UPGRADES[kind]) GLOBAL_UNIT_UPGRADES[kind] = {};
        if (level > 0) GLOBAL_UNIT_UPGRADES[kind][moduleId] = level;
        else delete GLOBAL_UNIT_UPGRADES[kind][moduleId];
    }
    return level;
}

/**
 * 共享升级组统一提升一级，并把旧档中较低的适用兵种同步到同一等级。
 * maxLevel 由模块配置传入，避免持续升级越过上限。
 */
export function raiseSharedUnitUpgradeLevel(kinds, moduleId, maxLevel = Infinity) {
    const targets = [...new Set((kinds || []).filter((kind) => UNIT_KIND_CFG[kind]))];
    if (!targets.length || !moduleId) return 0;
    const current = syncSharedUnitUpgradeLevel(targets, moduleId, maxLevel);
    const cap = Number.isFinite(maxLevel) ? Math.max(0, Math.floor(maxLevel)) : Infinity;
    const next = Math.min(cap, current + 1);
    for (const kind of targets) {
        if (!GLOBAL_UNIT_UPGRADES[kind]) GLOBAL_UNIT_UPGRADES[kind] = {};
        if (next > 0) GLOBAL_UNIT_UPGRADES[kind][moduleId] = next;
        else delete GLOBAL_UNIT_UPGRADES[kind][moduleId];
    }
    return next;
}

/** 按模块 effect 字段与等级计算通用属性补丁；不依赖特定建筑或模块 ID。 */
export function getUpgradeMultsFromLevels(modulesCfg, levels = {}, kind = null) {
    const out = {
        attackIntervalMult: 1,
        attackDamageMult: 1,
        attackDamageBonus: 0,
        moveSpeedMult: 1,
        count: 1,
        hpMult: 1,
        holyLightCooldownMult: 1,
        holyLightLevel: 1,
        jungleMagicLevel: 1,
        jungleSpellCooldownMult: 1,
        chargeDamageMult: 1,
        miningMult: 1,
        attackRangeBonus: 0,
        defenseMult: 1,
        camelFrightReduction: 0,
        bountyGoldMultiplier: 0,
        fogSightRadiusBonus: 0,
        holyLightRangeBonus: 0,
        titheEnergyPerTick: 0,
        duelistDamageMultiplier: 1.5,
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
        if (module.mode === 'add') {
            const firstLevel = Number(module.firstLevel);
            out[effect] = Number.isFinite(firstLevel)
                ? firstLevel + per * Math.max(0, level - 1)
                : out[effect] + per * level;
        }
        else out[effect] = 1 + per * level;
    }
    out.attackDamageMult *= Math.max(0, 1 + out.attackDamageBonus);
    return out;
}

/** 当前兵种已激活的目标 family 伤害倍率；同 family 多来源取最高值，避免重复叠乘。 */
function getUnitFamilyDamageMultipliers(kind, modulesCfg) {
    const levels = (kind && GLOBAL_UNIT_UPGRADES[kind]) || {};
    const multipliers = {};
    for (const [moduleId, module] of Object.entries(modulesCfg || {})) {
        if (Array.isArray(module?.unitKinds) && !module.unitKinds.includes(kind)) continue;
        const level = Math.max(0, Math.floor(Number(levels[moduleId]) || 0));
        const family = String(module?.targetFamily || '').trim();
        const multiplier = Number(module?.targetFamilyDamageMultiplier);
        if (level <= 0 || !family || !Number.isFinite(multiplier) || multiplier <= 0) continue;
        multipliers[family] = Math.max(Number(multipliers[family]) || 1, multiplier);
    }
    return multipliers;
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
        attackDamageMult: mults.attackDamageMult,
        attackRange: Math.max(0, Math.round((baseAi.attackRange ?? 0) + mults.attackRangeBonus)),
        walkSpeed: Math.max(20, Math.round(
            (baseAi.walkSpeed ?? 120) * getFriendlyUnitSpeedMultiplier() * mults.moveSpeedMult
        )),
        baseMaxHp: Math.max(1, Math.round((base.baseMaxHp ?? 300) * mults.hpMult)),
        holyLightCooldownMult: mults.holyLightCooldownMult,
        holyLightLevel: mults.holyLightLevel,
        jungleMagicLevel: mults.jungleMagicLevel,
        jungleSpellCooldownMult: mults.jungleSpellCooldownMult,
        chargeDamageMult: mults.chargeDamageMult,
        attackRangeBonus: mults.attackRangeBonus,
        defenseMult: mults.defenseMult,
        camelFrightReduction: mults.camelFrightReduction,
        bountyGoldMultiplier: mults.bountyGoldMultiplier,
        fogSightRadiusBonus: mults.fogSightRadiusBonus,
        holyLightRangeBonus: mults.holyLightRangeBonus,
        titheEnergyPerTick: mults.titheEnergyPerTick,
        duelistDamageMultiplier: mults.duelistDamageMultiplier,
        familyDamageMultipliers: getUnitFamilyDamageMultipliers(kind, modulesCfg),
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
