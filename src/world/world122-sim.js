// ============================================================
// 世界-122 后台抽象结算（2026-08-18，多世界并行 M1）
//
// 玩家不在世界-122 时，世界不逐实体模拟；离场期间按本模块做「回场结算」：
// 以快照 + 离场时长推演世界状态（产兵/采矿/读条/波次战报），回场一次性物化。
//
// 口径（全部为可调整的估算常量，集中在 WORLD122_SIM）：
// - 波次：预算 TP × SIM.tpHpAvg 估 HP 池；防守方 DPS = 塔（捕获时实机口径入快照）
//   + 军事单位（配置×全局升级倍率）；清波耗时 = 池/DPS。怪物输出按接触系数
//   落到「墙/门 → 建筑 → 基地」顺序承伤。回场时仍在进行中的波次重开（break 阶段）。
// - 采矿：矿工产出 = 数量 × 单矿工速率（miner 配置真源）× 采矿效率模块；受仓库
//   剩余容量与矿点余量双重封顶；无仓库不采（与实机满仓口径一致）。
// - 读条：铁匠铺能力/研究院研究及出兵建筑模块按剩余时间完成并升全局等级；持续升级在后台只完成
//   当前读条（不自动续升，回场由实机循环续）。
// - commit=false 时为预览（世界切换面板用）：不改快照、不触发全局副作用。
// ============================================================
import { getAbilityLevel, getAbilityValue, raiseAbilityLevel } from './ability-store.js';
import { getUnitUpgradeMults, raiseUnitUpgradeLevel } from './unit-upgrade-store.js';
import { RECRUIT_MODE, normalizeRecruitMode } from './recruit-mode.js';
import { getProductionResourceMul } from '../config/tribute-effects.js';
import {
    getBuildingUpgradeAbility,
    getUpgradeModulesForUnitKind,
} from './building-upgrade-projects.js';
import producerBuildingsJson from '../../data/producer-buildings.json';
import militiaCfg from '../../data/hamster-militia-config.json';
import warriorCfg from '../../data/hamster-warrior-config.json';
import shooterCfg from '../../data/hamster-shooter-config.json';
import guardCfg from '../../data/hamster-guard-config.json';
import scoutCfg from '../../data/hamster-scout-config.json';
import musketeerCfg from '../../data/hamster-musketeer-config.json';
import priestCfg from '../../data/hamster-priest-config.json';
import knightCfg from '../../data/hamster-knight-config.json';
import lightCavalryCfg from '../../data/hamster-light-cavalry-config.json';
import explorerCfg from '../../data/hamster-explorer-config.json';
import bountyHunterCfg from '../../data/hamster-bounty-hunter-config.json';
import jaguarWarriorCfg from '../../data/jaguar-warrior-config.json';
import junglePriestCfg from '../../data/jungle-priest-config.json';
import barracksBuildingCfg from '../../data/hamster-barracks-building.json';
import { MINER_CAMP_CONFIG, getMinerEnergyPerSecond, getMinerEconomyStats } from './miner-economy.js';
import populationEconomyConfig from '../../data/population-economy.json';
import buildingUpgradesJson from '../../data/building-upgrades.json';
import { createExplorerReward } from '../config/explorer-rewards.js';

/** 抽象结算估算常量（调整平衡只改这里） */
export const WORLD122_SIM = {
    tpHpAvg: 35,            // 波次 HP 池：每威胁预算 TP ≈ 35 HP
    tpCountAvg: 3.5,        // 每只怪平均 TP（估只数）
    monsterDpsPer: 8,       // 每只怪平均 DPS（随波次 atk 成长另乘）
    contactFraction: 0.5,   // 怪物输出实际落到建筑的比例（其余被拦截/走位消耗）
    sweepExpectedExtraTargets: 1, // 横扫在波次抱团中按平均额外命中1个目标估算
    waveTimeMin: 20,        // 清波耗时下限（秒）
    waveTimeMax: 180,       // 清波耗时上限（秒）
};

const UNIT_CFGS = {
    militia: militiaCfg, warrior: warriorCfg, shooter: shooterCfg,
    guard: guardCfg, scout: scoutCfg, musketeer: musketeerCfg, priest: priestCfg,
    knight: knightCfg, light_cavalry: lightCavalryCfg,
    explorer: explorerCfg, bounty_hunter: bountyHunterCfg,
    jaguar_warrior: jaguarWarriorCfg, jungle_priest: junglePriestCfg,
};

function _economyModuleValue(structure, economyType, moduleId) {
    const buildingCfg = producerBuildingsJson[structure?.cfgKey] || {};
    const project = buildingUpgradesJson[buildingCfg.upgradeProject];
    const module = project?.modules?.[moduleId];
    if (!module) return 0;
    const savedModules = economyType === 'bank'
        ? structure?.bankModules
        : structure?.workshopModules;
    const level = Math.max(0, Math.min(
        Number(module.maxLevel) || 0,
        Math.floor(Number(savedModules?.[moduleId]) || 0)
    ));
    return (Number(module.base) || 0) + (Number(module.per) || 0) * level;
}

function _workshopModuleValue(structure, moduleId) {
    return _economyModuleValue(structure, 'workshop', moduleId);
}

function _bankModuleValue(structure, moduleId) {
    return _economyModuleValue(structure, 'bank', moduleId);
}

function _bankServiceRange(structure) {
    return Math.max(0, _bankModuleValue(structure, 'bank_service_range'));
}

function _bankCoverageCountAt(target, economyStructures) {
    return (economyStructures || []).reduce((count, structure) => {
        if (producerBuildingsJson[structure?.cfgKey]?.economyType !== 'bank') return count;
        const range = _bankServiceRange(structure);
        const distance = Math.hypot(
            (Number(target?.x) || 0) - (Number(structure?.x) || 0),
            (Number(target?.y) || 0) - (Number(structure?.y) || 0)
        );
        return count + (distance <= range ? 1 : 0);
    }, 0);
}

function _bankOverlapMultiplier(bankCount) {
    const count = Math.max(0, Math.floor(Number(bankCount) || 0));
    const zeroAt = Math.max(1,
        Math.floor(Number(populationEconomyConfig.bank?.overlapZeroAtBankCount) || 3));
    if (count >= zeroAt) return 0;
    const penalty = Math.max(0, Math.min(1,
        Number(populationEconomyConfig.bank?.overlapPenaltyPerAdditionalBank) || 0));
    return Math.max(0, Math.min(1, 1 - Math.max(0, count - 1) * penalty));
}

function _economyWorkerSlots(structure, economyType) {
    const cfg = populationEconomyConfig[economyType] || {};
    if (cfg.workerSlotsModule) {
        const value = economyType === 'bank'
            ? _bankModuleValue(structure, cfg.workerSlotsModule)
            : _workshopModuleValue(structure, cfg.workerSlotsModule);
        return Math.max(0, Math.floor(value));
    }
    return Math.max(0, Math.floor(Number(cfg.workerSlots) || 0));
}

function _workshopEfficiencyMultiplier(target, economyStructures) {
    const targetType = producerBuildingsJson[target?.cfgKey]?.economyType;
    if (!targetType || targetType === 'housing' || targetType === 'workshop') return 1;
    let strongest = 0;
    const share = Math.max(0, Number(populationEconomyConfig.workshop?.engineerEfficiencyShare) || 0.2);
    for (const workshop of economyStructures || []) {
        if (producerBuildingsJson[workshop.cfgKey]?.economyType !== 'workshop' || !(workshop.hp > 0)) continue;
        const range = Math.max(0, _workshopModuleValue(workshop, 'workshop_range'));
        if (Math.hypot((target.x || 0) - (workshop.x || 0), (target.y || 0) - (workshop.y || 0)) > range) continue;
        const configured = Math.max(0, _workshopModuleValue(workshop, 'workshop_efficiency'));
        const engineers = Math.min(
            Math.max(0, Math.floor(_workshopModuleValue(workshop, 'workshop_engineers'))),
            Math.max(0, Math.floor(Number(workshop.assignedWorkers) || 0))
        );
        strongest = Math.max(strongest, configured * Math.min(1, engineers * share));
    }
    return 1 + strongest;
}

function _structureMaxHp(structure) {
    const saved = Math.max(0, Number(structure?.maxHp) || 0);
    if (saved > 0) return saved;
    if (structure?.kind === 'producer') {
        return Math.max(0, Number(producerBuildingsJson[structure.cfgKey]?.hp) || 0);
    }
    return 0;
}

/** 后台仅在已知无敌的 prep/break 时间窗维修；逐工坊保存抽象行程，抵达后才结算恢复。 */
function _settleWorkshopRepairs(target, economyStructures, safeSeconds) {
    const workshops = (economyStructures || []).filter((structure) =>
        producerBuildingsJson[structure.cfgKey]?.economyType === 'workshop' && structure.hp > 0
    );
    if (safeSeconds <= 0) {
        for (const workshop of workshops) workshop.workshopRepairAssignments = {};
        return;
    }
    const structures = (target.structures || []).filter((structure) => {
        const maxHp = _structureMaxHp(structure);
        return structure.hp > 0 && maxHp > 0 && structure.hp < maxHp;
    });
    const globallyClaimed = new Set();
    const speed = Math.max(1, Number(populationEconomyConfig.workshop?.engineerSpeed) || 180);
    for (const workshop of workshops) {
        const range = Math.max(0, _workshopModuleValue(workshop, 'workshop_range'));
        const engineerCount = Math.min(
            Math.max(0, Math.floor(_workshopModuleValue(workshop, 'workshop_engineers'))),
            Math.max(0, Math.floor(Number(workshop.assignedWorkers) || 0))
        );
        const rate = Math.max(0, _workshopModuleValue(workshop, 'workshop_repair'));
        const existing = workshop.workshopRepairAssignments || {};
        const assignments = {};
        const candidates = structures
            .filter((structure) => !globallyClaimed.has(structure.id)
                && Math.hypot((structure.x || 0) - (workshop.x || 0), (structure.y || 0) - (workshop.y || 0)) <= range)
            .sort((a, b) => a.hp / _structureMaxHp(a) - b.hp / _structureMaxHp(b));
        for (let index = 0; index < engineerCount; index++) {
            const savedTargetId = existing[index]?.targetId;
            let repairTarget = candidates.find((structure) =>
                structure.id === savedTargetId && !globallyClaimed.has(structure.id));
            if (!repairTarget) repairTarget = candidates.find((structure) => !globallyClaimed.has(structure.id));
            if (!repairTarget) continue;
            globallyClaimed.add(repairTarget.id);
            const distance = Math.hypot(
                (repairTarget.x || 0) - (workshop.x || 0),
                (repairTarget.y || 0) - (workshop.y || 0)
            );
            const travelMs = savedTargetId === repairTarget.id
                ? Math.max(0, Number(existing[index]?.travelRemainMs) || 0)
                : distance / speed * 1000;
            const elapsedMs = safeSeconds * 1000;
            const workingMs = Math.max(0, elapsedMs - travelMs);
            const remainingTravelMs = Math.max(0, travelMs - elapsedMs);
            if (workingMs > 0) {
                const maxHp = _structureMaxHp(repairTarget);
                repairTarget.hp = Math.min(maxHp, repairTarget.hp + maxHp * rate * workingMs / 1000);
            }
            if (repairTarget.hp < _structureMaxHp(repairTarget)) {
                assignments[index] = { targetId: repairTarget.id, travelRemainMs: remainingTravelMs };
            }
        }
        workshop.workshopRepairAssignments = assignments;
    }
}

/** 兵种单兵 DPS（配置 × 全局升级倍率，与实机 spawnUnit 同公式） */
function _levelOf(abilityId, levelOverrides = null) {
    return levelOverrides && Object.prototype.hasOwnProperty.call(levelOverrides, abilityId)
        ? levelOverrides[abilityId]
        : getAbilityLevel(abilityId);
}

function _unitDps(kind, levelOverrides = null) {
    const cfg = UNIT_CFGS[kind];
    if (!cfg || !cfg.ai) return 0;
    if (kind === 'explorer') return 0;
    const mults = getUnitUpgradeMults(kind, getUpgradeModulesForUnitKind(kind));
    const dmg = (cfg.ai.attackDamage ?? 20) * mults.attackDamageMult;
    const interval = Math.max(300, (cfg.ai.attackInterval ?? 2000) * mults.attackIntervalMult);
    let dps = dmg * 1000 / interval;
    if (kind === 'knight' && cfg.ai.charge) {
        const charge = cfg.ai.charge;
        const chargeMult = mults.chargeDamageMult || 1;
        dps += dmg * (charge.damageMul ?? 2) * chargeMult
            * 1000 / Math.max(1000, charge.cooldown ?? 15000);
    }
    if (kind === 'warrior' || kind === 'jaguar_warrior') {
        const ability = getBuildingUpgradeAbility('sweep_aoe');
        const level = _levelOf('sweep_aoe', levelOverrides);
        if (ability && level > 0) {
            dps += dps * getAbilityValue(ability, level) * WORLD122_SIM.sweepExpectedExtraTargets;
        }
    }
    return dps;
}

function _normalizedRoster(structure) {
    const roster = {};
    if (structure?.unitRoster && typeof structure.unitRoster === 'object') {
        for (const [kind, rawCount] of Object.entries(structure.unitRoster)) {
            if (!UNIT_CFGS[kind]) continue;
            const count = Math.max(0, Math.floor(Number(rawCount) || 0));
            if (count > 0) roster[kind] = count;
        }
    }
    if (Object.keys(roster).length === 0 && structure?.unitType && structure.units > 0) {
        roster[structure.unitType] = Math.max(0, Math.floor(Number(structure.units) || 0));
    }
    return roster;
}

function _rosterCount(roster) {
    return Object.values(roster || {}).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0);
}

function _rosterDps(roster, levelOverrides = null) {
    return Object.entries(roster || {}).reduce(
        (sum, [kind, count]) => sum
            + Math.max(0, Number(count) || 0) * _unitDps(kind, levelOverrides),
        0
    );
}

/** 快速募兵倍率（与 research-system.getRecruitIntervalMs 同口径，读结算开始时的等级） */
function _recruitMult(level = getAbilityLevel('research_recruit_speed')) {
    const bonus = getAbilityValue(getBuildingUpgradeAbility('research_recruit_speed'), level);
    return 1 / (1 + bonus);
}

function _abilityTimeline(initialLevel, completionTimes, totalMs, abilityId) {
    const ability = getBuildingUpgradeAbility(abilityId);
    const maxLevel = ability?.maxLevel ?? 10;
    const events = (completionTimes[abilityId] || [])
        .map((time) => Math.max(0, Math.min(totalMs, Number(time) || 0)))
        .sort((a, b) => a - b);
    const segments = [];
    let cursor = 0;
    let level = Math.max(0, initialLevel || 0);
    for (const at of events) {
        if (at > cursor) segments.push({ durationMs: at - cursor, level });
        level = Math.min(maxLevel, level + 1);
        cursor = at;
    }
    if (cursor < totalMs) segments.push({ durationMs: totalMs - cursor, level });
    return segments;
}

function _multiAbilityTimeline(initialLevels, completionTimes, totalMs, abilityIds) {
    const levels = { ...initialLevels };
    const events = [];
    for (const abilityId of abilityIds) {
        for (const rawTime of completionTimes[abilityId] || []) {
            events.push({
                abilityId,
                at: Math.max(0, Math.min(totalMs, Number(rawTime) || 0)),
            });
        }
    }
    events.sort((a, b) => a.at - b.at);
    const segments = [];
    let cursor = 0;
    let index = 0;
    while (index < events.length) {
        const at = events[index].at;
        if (at > cursor) segments.push({ durationMs: at - cursor, levels: { ...levels } });
        while (index < events.length && events[index].at === at) {
            const { abilityId } = events[index++];
            const ability = getBuildingUpgradeAbility(abilityId);
            levels[abilityId] = Math.min(
                ability?.maxLevel ?? 10,
                (levels[abilityId] || 0) + 1
            );
        }
        cursor = at;
    }
    if (cursor < totalMs) segments.push({ durationMs: totalMs - cursor, levels: { ...levels } });
    return segments;
}

function _applyStructureHpLevel(target, fromLevel, toLevel) {
    if (!(toLevel > fromLevel)) return;
    const ability = getBuildingUpgradeAbility('research_structure_hp');
    const oldBonus = getAbilityValue(ability, fromLevel);
    const newBonus = getAbilityValue(ability, toLevel);
    const oldMul = Math.max(0.01, 1 + oldBonus);
    const newMul = Math.max(0.01, 1 + newBonus);
    const applyEntry = (entry) => {
        if (!entry || !(entry.hp > 0) || !(entry.maxHp > 0)) return;
        const baseMax = entry.maxHp / oldMul;
        const nextMax = Math.max(1, Math.round(baseMax * newMul));
        const delta = nextMax - entry.maxHp;
        entry.maxHp = nextMax;
        entry.hp = Math.max(0, Math.min(nextMax, entry.hp + delta));
    };
    for (const structure of target.structures || []) {
        if (structure.kind === 'block' || structure.kind === 'gate4') {
            applyEntry(structure);
            for (const pillar of structure.pillars || []) applyEntry(pillar);
        }
    }
}

/** 波次 N 的 HP 池与怪物 DPS（快照 config 口径） */
function _wavePool(wave, cfg) {
    const budget = (cfg.waveBudgetBase ?? 26) * Math.pow(cfg.waveBudgetGrowth ?? 1.15, wave - 1);
    const hp = budget * WORLD122_SIM.tpHpAvg * (1 + (cfg.hpPerWave ?? 0.16) * (wave - 1));
    const count = budget / WORLD122_SIM.tpCountAvg;
    const dps = count * WORLD122_SIM.monsterDpsPer * (1 + (cfg.atkPerWave ?? 0.08) * (wave - 1));
    return { hp, dps };
}

/**
 * 后台结算主入口。
 * @param {object} snap 快照（commit 时原地修改）
 * @param {number} elapsedMs 离场时长
 * @param {{commit?:boolean, grant?:(reward:{gold?:number,energy?:number})=>void}} [opts]
 * @returns 结算报告（世界切换面板预览/回场播报共用）
 */
export function settleWorld122(snap, elapsedMs, opts = {}) {
    const commit = opts.commit !== false;
    const report = {
        elapsedMs, wavesCleared: [], victory: false, defeated: false,
        energyMined: 0, passiveEnergy: 0, titheEnergy: 0, goldProduced: 0, foodProduced: 0, unitsProduced: 0,
        energySpentOnMiners: 0, foodSpentOnUnits: 0,
        abilitiesCompleted: [], modulesCompleted: [], structuresLost: 0, baseDamage: 0,
        explorerRewards: [],
    };
    if (!snap || !snap.wave || !(elapsedMs > 0)) return report;
    const target = commit ? snap : JSON.parse(JSON.stringify(snap));
    let t = elapsedMs / 1000; // 秒
    const cfg = target.config || {};
    const initialPassiveLevel = getAbilityLevel('research_passive_energy');
    const initialRecruitLevel = getAbilityLevel('research_recruit_speed');
    const initialStructureHpLevel = getAbilityLevel('research_structure_hp');
    const initialCombatLevels = {
        sweep_aoe: getAbilityLevel('sweep_aoe'),
        mark_arrow: getAbilityLevel('mark_arrow'),
        inspire_magic: getAbilityLevel('inspire_magic'),
        research_structure_hp: initialStructureHpLevel,
    };
    const completionTimes = {};
    const warehouses = (target.structures || []).filter((s) => s.kind === 'producer'
        && getProducerStorageCap(s) > 0);
    for (const warehouse of warehouses) {
        if (!warehouse.warehouseUpgrade) continue;
        warehouse.warehouseUpgrade.remainMs = Math.max(
            0,
            (Number(warehouse.warehouseUpgrade.remainMs) || 0) - elapsedMs
        );
        if (warehouse.warehouseUpgrade.remainMs > 0) continue;
        const moduleId = warehouse.warehouseUpgrade.moduleId;
        const module = buildingUpgradesJson.warehouse_logistics?.modules?.[moduleId];
        if (module) {
            warehouse.warehouseModules = warehouse.warehouseModules || {};
            warehouse.warehouseModules[moduleId] = Math.min(
                Number(module.maxLevel) || 0,
                Math.max(0, Math.floor(Number(warehouse.warehouseModules[moduleId]) || 0)) + 1
            );
        }
        warehouse.warehouseUpgrade = null;
        warehouse.storageCapacity = getProducerStorageCap(warehouse);
    }
    for (const structure of target.structures || []) {
        if (structure.kind !== 'producer'
            || producerBuildingsJson[structure.cfgKey]?.panelMode !== 'candle'
            || !structure.candleUpgrade) continue;
        structure.candleUpgrade.remainMs = Math.max(
            0,
            (Number(structure.candleUpgrade.remainMs) || 0) - elapsedMs
        );
        if (structure.candleUpgrade.remainMs > 0) continue;
        const moduleId = structure.candleUpgrade.moduleId;
        const module = buildingUpgradesJson.candle_sanctuary?.modules?.[moduleId];
        if (module) {
            structure.candleModules = structure.candleModules || {};
            structure.candleModules[moduleId] = Math.min(
                Number(module.maxLevel) || 0,
                Math.max(0, Math.floor(Number(structure.candleModules[moduleId]) || 0)) + 1
            );
        }
        structure.candleUpgrade = null;
    }

    // v1 快照把粮食挂在位面全局；后台结算开始时先迁入真实仓库，放不下的留作回场迁移。
    const savedEconomy = target.populationEconomy && typeof target.populationEconomy === 'object'
        ? target.populationEconomy
        : {};
    let legacyFoodPending = Math.max(0, Number(savedEconomy.legacyFoodPending) || 0);
    if ((Number(savedEconomy.storageVersion) || 1) < 2) {
        legacyFoodPending += Math.max(0, Number(savedEconomy.foodStored) || 0);
    }
    if (legacyFoodPending > 0) {
        legacyFoodPending -= _depositFoodToWarehouses(warehouses, legacyFoodPending);
    }
    target.populationEconomy = {
        storageVersion: 2,
        foodStored: _foodInWarehouses(warehouses),
        legacyFoodPending,
    };

    // ---- 人口经济：房屋容量、数值岗位、风车粮食、银行金币、市场压力回归。
    // 玩家不在该位面时不物化平民，也不会产生逐单位寻路/动画开销。 ----
    const economyStructures = (target.structures || []).filter((structure) =>
        structure.kind === 'producer'
        && Number(structure.hp ?? 1) > 0
        && producerBuildingsJson[structure.cfgKey]?.economyType
    );
    for (const structure of economyStructures) {
        if (structure.economyUpgrade) {
            structure.economyUpgrade.remainMs = Math.max(
                0,
                (Number(structure.economyUpgrade.remainMs) || 0) - elapsedMs
            );
            if (structure.economyUpgrade.remainMs <= 0) {
                structure.economyLevel = Math.max(
                    1,
                    Math.floor(Number(structure.economyUpgrade.targetLevel) || 1)
                );
                structure.economyUpgrade = null;
            }
        }
        if (structure.workshopUpgrade) {
            structure.workshopUpgrade.remainMs = Math.max(
                0,
                (Number(structure.workshopUpgrade.remainMs) || 0) - elapsedMs
            );
            if (structure.workshopUpgrade.remainMs <= 0) {
                const moduleId = structure.workshopUpgrade.moduleId;
                const module = buildingUpgradesJson.economic_workshop?.modules?.[moduleId];
                if (module) {
                    structure.workshopModules = structure.workshopModules || {};
                    structure.workshopModules[moduleId] = Math.min(
                        Number(module.maxLevel) || 0,
                        Math.max(0, Math.floor(Number(structure.workshopModules[moduleId]) || 0)) + 1
                    );
                }
                structure.workshopUpgrade = null;
            }
        }
        if (structure.bankUpgrade) {
            structure.bankUpgrade.remainMs = Math.max(
                0,
                (Number(structure.bankUpgrade.remainMs) || 0) - elapsedMs
            );
            if (structure.bankUpgrade.remainMs <= 0) {
                const moduleId = structure.bankUpgrade.moduleId;
                const module = buildingUpgradesJson.bank_economy?.modules?.[moduleId];
                if (module) {
                    structure.bankModules = structure.bankModules || {};
                    structure.bankModules[moduleId] = Math.min(
                        Number(module.maxLevel) || 0,
                        Math.max(0, Math.floor(Number(structure.bankModules[moduleId]) || 0)) + 1
                    );
                }
                structure.bankUpgrade = null;
            }
        }
    }
    const houseLevels = populationEconomyConfig.house?.levels || [];
    const populationCapacity = economyStructures.reduce((sum, structure) => {
        if (producerBuildingsJson[structure.cfgKey]?.economyType !== 'housing') return sum;
        const level = Math.max(1, Math.floor(Number(structure.economyLevel) || 1));
        const levelCfg = houseLevels.find((entry) => entry.level === level) || houseLevels[0];
        return sum + (Number(levelCfg?.populationCapacity) || 0);
    }, 0);
    const assignedPopulation = economyStructures.reduce((sum, structure) => {
        const economyType = producerBuildingsJson[structure.cfgKey]?.economyType;
        const workerSlots = _economyWorkerSlots(structure, economyType);
        const assigned = Math.max(
            0,
            Math.min(workerSlots, Math.floor(Number(structure.assignedWorkers) || 0))
        );
        structure.assignedWorkers = assigned;
        return sum + assigned;
    }, 0);
    const laborEfficiency = assignedPopulation > 0
        ? Math.max(0, Math.min(1, populationCapacity / assignedPopulation))
        : 1;
    for (const structure of economyStructures) {
        const economyType = producerBuildingsJson[structure.cfgKey]?.economyType;
        const assigned = Math.max(0, Number(structure.assignedWorkers) || 0);
        if (economyType === 'bank') {
            const serviceRange = _bankServiceRange(structure);
            const effectiveServicePopulation = economyStructures.reduce((sum, house) => {
                if (producerBuildingsJson[house.cfgKey]?.economyType !== 'housing') return sum;
                if (Math.hypot((house.x || 0) - (structure.x || 0), (house.y || 0) - (structure.y || 0)) > serviceRange) return sum;
                const level = Math.max(1, Math.floor(Number(house.economyLevel) || 1));
                const levelCfg = houseLevels.find((entry) => entry.level === level) || houseLevels[0];
                const population = Math.max(0, Number(levelCfg?.populationCapacity) || 0);
                const bankCount = _bankCoverageCountAt(house, economyStructures);
                return sum + population * _bankOverlapMultiplier(bankCount);
            }, 0);
            const settlementSpeed = Math.max(0.01, 1 + _bankModuleValue(structure, 'bank_finance'));
            const baseIntervalMs = Math.max(100, Number(populationEconomyConfig.bank?.settlementIntervalMs) || 10000);
            const settlementIntervalMs = Math.max(100, Math.round(baseIntervalMs / settlementSpeed));
            const goldPerPopulation = Math.max(0, _bankModuleValue(structure, 'bank_mint'));
            const goldPerSettlement = effectiveServicePopulation * goldPerPopulation * assigned * laborEfficiency
                * _workshopEfficiencyMultiplier(structure, economyStructures);
            const tickTotal = goldPerSettlement > 0
                ? Math.max(0, Number(structure.economyTickMs) || 0) + elapsedMs
                : 0;
            const settlements = Math.floor(tickTotal / settlementIntervalMs);
            structure.economyTickMs = tickTotal - settlements * settlementIntervalMs;
            const total = Math.max(0, Number(structure.bankGoldRemainder) || 0)
                + goldPerSettlement * settlements * getProductionResourceMul();
            const produced = Math.floor(total);
            structure.bankGoldRemainder = total - produced;
            report.goldProduced += produced;
            if (commit && produced > 0 && typeof opts.grant === 'function') {
                const routed = opts.grant({ gold: produced, x: structure.x, y: structure.y }) || {};
                const overflow = Math.max(0, Math.floor(Number(routed.remaining) || 0));
                if (overflow > 0) {
                    structure.pendingGoldDrop = Math.max(0, Number(structure.pendingGoldDrop) || 0) + overflow;
                }
            }
        } else if (economyType === 'windmill') {
            const foodRate = Math.max(0, Number(populationEconomyConfig.windmill?.foodPerWorkerPerSecond) || 0);
            const total = Math.max(0, Number(structure.workProductionRemainder) || 0)
                + assigned * foodRate * laborEfficiency
                    * _workshopEfficiencyMultiplier(structure, economyStructures) * t
                    * getProductionResourceMul();
            const produced = Math.floor(total);
            structure.workProductionRemainder = total - produced;
            const stored = _depositFoodToWarehouses(warehouses, produced);
            structure.workProductionRemainder += Math.max(0, produced - stored);
            report.foodProduced += stored;
        } else if (economyType === 'market') {
            const marketCfg = populationEconomyConfig.market || {};
            const effectiveWorkers = assigned * laborEfficiency
                * _workshopEfficiencyMultiplier(structure, economyStructures);
            const decayMultiplier = 1
                + effectiveWorkers * Math.max(0, Number(marketCfg.pressureDecayMultiplierPerWorker) || 0);
            const decay = Math.max(0, Number(marketCfg.pressureDecayPerSecond) || 0)
                * decayMultiplier * t;
            const pressure = Number(structure.marketPressure) || 0;
            structure.marketPressure = pressure > 0
                ? Math.max(0, pressure - decay)
                : Math.min(0, pressure + decay);
        }
    }
    const safeRepairSeconds = target.wave.phase === 'wave'
        ? 0
        : Math.min(t, Math.max(0, Number(target.wave.phaseTimer) || 0) / 1000);
    _settleWorkshopRepairs(target, economyStructures, safeRepairSeconds);
    target.populationEconomy.foodStored = _foodInWarehouses(warehouses);

    // ---- 读条结算（能力/研究 + 出兵模块；持续升级后台不自动续）----
    for (const s of target.structures || []) {
        if ((s.kind !== 'producer' && s.kind !== 'barracks') || !s.upgrade) continue;
        const up = s.upgrade;
        const elapsedMsLocal = Math.max(0, elapsedMs);
        if (up.remainMs <= elapsedMsLocal) {
            if (up.abilityId) {
                if (!completionTimes[up.abilityId]) completionTimes[up.abilityId] = [];
                completionTimes[up.abilityId].push(Math.max(0, Number(up.remainMs) || 0));
                if (commit) {
                    const ability = getBuildingUpgradeAbility(up.abilityId);
                    raiseAbilityLevel(up.abilityId, ability?.maxLevel ?? 10);
                }
                report.abilitiesCompleted.push(up.abilityId);
            } else if (up.moduleId && up.unitType) {
                const module = getUpgradeModulesForUnitKind(up.unitType)?.[up.moduleId];
                if (module) {
                    if (commit) raiseUnitUpgradeLevel(up.unitType, up.moduleId);
                    report.modulesCompleted.push(`${up.unitType}:${up.moduleId}`);
                }
            }
            s.upgrade = null; // _continuous 保留：回场实机循环自动续升
        } else {
            up.remainMs -= elapsedMsLocal;
        }
    }

    // ---- 被动能源：按研究真正完成的时点分段，不把新等级错误回溯到整段离线时间。----
    report.passiveEnergy = opts.includePassiveEnergy === false ? 0 : Math.floor(_abilityTimeline(
        initialPassiveLevel,
        completionTimes,
        elapsedMs,
        'research_passive_energy'
    ).reduce((sum, segment) => {
        const perSecond = getAbilityValue(
            getBuildingUpgradeAbility('research_passive_energy'),
            segment.level
        );
        return sum + segment.durationMs / 1000 * perSecond;
    }, 0));

    // ---- 采矿与仓储 ----
    let warehouseFree = _energyStorableInWarehouses(warehouses);
    // 被动能源先入仓
    if (report.passiveEnergy > 0 && warehouseFree > 0) {
        const add = Math.min(report.passiveEnergy, warehouseFree);
        _depositToWarehouses(warehouses, add);
        warehouseFree = _energyStorableInWarehouses(warehouses);
        report.passiveEnergy = add; // 满仓截断（与实机满仓口径一致）
    }
    // 教堂什一税：保存每座教堂的周期余数，后台1Hz增量结算也能累计到完整10秒。
    const priestModules = getUpgradeModulesForUnitKind('priest');
    const priestMults = getUnitUpgradeMults('priest', priestModules);
    const tithePerTick = Math.max(0, Number(priestMults.titheEnergyPerTick) || 0);
    const titheModule = Object.values(priestModules || {})
        .find((module) => module?.effect === 'titheEnergyPerTick');
    const titheIntervalMs = Math.max(0, Number(titheModule?.tickMs) || 0);
    if (tithePerTick > 0 && titheIntervalMs > 0) {
        for (const s of target.structures || []) {
            if (s.kind !== 'producer') continue;
            const priests = _normalizedRoster(s).priest || 0;
            if (priests <= 0) continue;
            const accumulated = Math.max(0, Number(s.titheTimerMs) || 0) + elapsedMs;
            const ticks = Math.floor(accumulated / titheIntervalMs);
            s.titheTimerMs = accumulated - ticks * titheIntervalMs;
            if (ticks <= 0 || warehouseFree <= 0) continue;
            const add = Math.min(warehouseFree, priests * tithePerTick * ticks);
            _depositToWarehouses(warehouses, add);
            warehouseFree = _energyStorableInWarehouses(warehouses);
            report.titheEnergy += add;
        }
    }
    // 小屋暂存先入仓
    for (const s of target.structures || []) {
        if (s.kind !== 'hut' || !(s.storedEnergy > 0) || warehouseFree <= 0) continue;
        const moved = Math.min(s.storedEnergy, warehouseFree);
        s.storedEnergy -= moved;
        _depositToWarehouses(warehouses, moved);
        warehouseFree = _energyStorableInWarehouses(warehouses);
    }
    // 矿点枯竭重生先结算
    for (const n of target.nodes || []) {
        if (n.depleted && n.respawnTimer > 0) {
            n.respawnTimer -= elapsedMs;
            if (n.respawnTimer <= 0) { n.depleted = false; n.hp = n.maxHp; n.respawnTimer = 0; }
        }
    }
    // 矿工采矿：伤害/间隔/采集比与升级倍率均读取当前配置真源。
    const nodes = target.nodes || [];
    for (const s of target.structures || []) {
        if (s.kind !== 'hut') continue;
        let miners = Math.max(0, Math.floor(Number(s.miners) || 0));
        const desiredCount = Math.max(miners, getMinerEconomyStats(s.modules || {}).count);
        const wait = Math.min(Math.max(0, (s.respawnTimer || 0) / 1000), t);
        const mineSegment = (count, seconds) => {
            if (warehouseFree <= 0 || count <= 0 || seconds <= 0) return;
            let want = getMinerEnergyPerSecond(s.modules || {}, count) * Math.max(0, seconds);
            want = Math.min(want, warehouseFree);
            const mined = Math.min(_mineFromNodes(nodes, want), warehouseFree);
            if (mined > 0) {
                _depositToWarehouses(warehouses, mined);
                warehouseFree = _energyStorableInWarehouses(warehouses);
                report.energyMined += mined;
            }
        };
        mineSegment(miners, wait);
        if ((s.respawnTimer || 0) <= elapsedMs) {
            const freeMinimum = Math.max(0, Number(MINER_CAMP_CONFIG.freeMinimumCount) || 0);
            const spawnCost = Math.max(0, Number(MINER_CAMP_CONFIG.respawnEnergyCost) || 0);
            while (miners < desiredCount) {
                const cost = miners < freeMinimum ? 0 : spawnCost;
                if (cost > 0 && !_deductFromWarehouses(warehouses, cost)) break;
                miners++;
                warehouseFree = _energyStorableInWarehouses(warehouses);
                report.energySpentOnMiners += cost;
            }
            s.miners = miners;
            s.respawnTimer = 0;
            mineSegment(miners, t - wait);
        } else {
            s.respawnTimer -= elapsedMs;
        }
    }

    // ---- 产兵结算（波次前先补员——产出的兵参与后续波次防守）----
    for (const s of target.structures || []) {
        if (s.kind !== 'barracks' && s.kind !== 'producer') continue;
        const producerCfg = s.kind === 'producer' ? producerBuildingsJson[s.cfgKey] : null;
        if (producerCfg?.parallelProduction) {
            const roster = _normalizedRoster(s);
            s.parallelQueues = s.parallelQueues || {};
            const segments = _abilityTimeline(
                initialRecruitLevel, completionTimes, elapsedMs, 'research_recruit_speed'
            );
            for (const unitCfg of producerCfg.unitTypes || []) {
                const kind = unitCfg.key;
                if (!kind) continue;
                const queue = s.parallelQueues[kind] || {
                    recruitMode: RECRUIT_MODE.PAUSED,
                    timer: Number(unitCfg.spawnIntervalMs) || Number(producerCfg.spawnIntervalMs) || 0,
                };
                s.parallelQueues[kind] = queue;
                const recruitMode = normalizeRecruitMode(queue.recruitMode);
                if (recruitMode === RECRUIT_MODE.PAUSED) continue;
                const baseInterval = Math.max(0,
                    Number(unitCfg.spawnIntervalMs) || Number(producerCfg.spawnIntervalMs) || 0);
                const cap = Math.max(0, Math.floor(Number(unitCfg.unitCap) || 0));
                if (!(baseInterval > 0) || cap <= 0) continue;
                let timer = Math.max(0, Number(queue.timer) || 0);
                let alive = Math.max(0, Math.floor(Number(roster[kind]) || 0));
                let previousInterval = baseInterval * _recruitMult(initialRecruitLevel);
                let stop = false;
                for (const segment of segments) {
                    const interval = baseInterval * _recruitMult(segment.level);
                    if (previousInterval > 0 && interval !== previousInterval) {
                        timer = Math.max(0, timer * interval / previousInterval);
                    }
                    let timeLeft = segment.durationMs;
                    while (alive < cap) {
                        if (timeLeft < timer) { timer -= timeLeft; timeLeft = 0; break; }
                        timeLeft -= timer;
                        const spawnCost = Math.max(0, Number(unitCfg.spawnFoodCost) || 0);
                        if (spawnCost > 0 && !_deductFoodFromWarehouses(warehouses, spawnCost)) {
                            timer = 0; stop = true; queue.foodBlocked = true; break;
                        }
                        warehouseFree = _energyStorableInWarehouses(warehouses);
                        report.foodSpentOnUnits += spawnCost;
                        alive++; roster[kind] = alive; report.unitsProduced++;
                        timer = interval;
                        if (recruitMode === RECRUIT_MODE.SINGLE) {
                            queue.recruitMode = RECRUIT_MODE.PAUSED; stop = true; break;
                        }
                    }
                    previousInterval = interval;
                    if (stop || alive >= cap) break;
                }
                queue.timer = timer;
            }
            s.units = _rosterCount(roster);
            s.unitRoster = roster;
            s.unitDps = _rosterDps(roster);
            continue;
        }
        if (s.kind === 'producer' && !s.unitType) continue; // 非产兵建筑
        const recruitMode = normalizeRecruitMode(s.recruitMode);
        const roster = _normalizedRoster(s);
        if (recruitMode === RECRUIT_MODE.PAUSED) {
            s.units = _rosterCount(roster);
            s.unitRoster = roster;
            s.unitDps = _rosterDps(roster);
            continue;
        }
        const baseInterval = _spawnIntervalOf(s);
        if (!(baseInterval > 0)) continue;
        const cap = _unitCapOf(s);
        let timer = Math.max(0, s.spawnTimer || 0);
        const deployed = Math.max(0, Math.floor(Number(s.troopLineDeployed) || 0));
        let alive = _rosterCount(roster) + deployed;
        const segments = _abilityTimeline(
            initialRecruitLevel,
            completionTimes,
            elapsedMs,
            'research_recruit_speed'
        );
        let previousInterval = baseInterval * _recruitMult(initialRecruitLevel);
        let foodBlocked = false;
        let singleCompleted = false;
        for (const segment of segments) {
            const interval = baseInterval * _recruitMult(segment.level);
            if (previousInterval > 0 && interval !== previousInterval) {
                timer = Math.max(0, timer * interval / previousInterval);
            }
            let timeLeft = segment.durationMs;
            while (alive < cap) {
                if (timeLeft < timer) {
                    timer -= timeLeft;
                    timeLeft = 0;
                    break;
                }
                timeLeft -= timer;
                const spawnCost = _unitSpawnFoodCost(s);
                if (spawnCost > 0 && !_deductFoodFromWarehouses(warehouses, spawnCost)) {
                    timer = 0;
                    foodBlocked = true;
                    break;
                }
                warehouseFree = _energyStorableInWarehouses(warehouses);
                report.foodSpentOnUnits += spawnCost;
                alive++;
                roster[s.unitType] = (roster[s.unitType] || 0) + 1;
                report.unitsProduced++;
                timer = interval;
                if (recruitMode === RECRUIT_MODE.SINGLE) {
                    s.recruitMode = RECRUIT_MODE.PAUSED;
                    singleCompleted = true;
                    break;
                }
            }
            previousInterval = interval;
            if (foodBlocked || singleCompleted) break;
            if (alive >= cap) {
                timer = interval;
                break;
            }
        }
        s.units = _rosterCount(roster);
        s.unitRoster = roster;
        s.spawnTimer = timer;
        // 混编部队逐兵种结算，切换生产类型不会把旧兵种整体转换。
        s.unitDps = _rosterDps(roster);
    }

    // ---- 探险结算：12 分钟一次性任务；离场后只推进剩余时间，完成后不再循环产出。----
    for (const s of target.structures || []) {
        const state = s.explorerState;
        if (!state || !(s.hp > 0)) continue;
        const rosterCount = Math.max(0, Math.floor(Number(s.unitRoster?.explorer) || 0));
        const legacyCount = Math.min(
            Math.max(0, Math.floor(Number(state.activeCount) || 0)), rosterCount);
        const runs = (Array.isArray(state.runs) ? state.runs : Array.from({ length: legacyCount }, () => ({
            remainingMs: 720000, durationMs: 720000, playerLevel: 1,
        }))).slice(0, rosterCount);
        if (!runs.length) continue;

        const pendingRuns = [];
        let sequence = Math.max(0, Math.floor(Number(state.rewardSequence) || 0));
        for (const run of runs) {
            const remainingMs = Math.max(0, Number(run?.remainingMs) || 0) - elapsedMs;
            if (remainingMs > 0) {
                pendingRuns.push({
                    remainingMs,
                    durationMs: Math.max(1000, Number(run?.durationMs) || 720000),
                    playerLevel: Math.max(1, Math.floor(Number(run?.playerLevel) || 1)),
                });
                continue;
            }
            // 四步序列严格形成 50/25/25；祭品池索引用黄金分割小数错开，避免总取同一件。
            const rewardRoll = ((sequence % 4) + 0.5) / 4;
            const poolRoll = (sequence * 0.61803398875) % 1;
            const reward = createExplorerReward(target.sceneId,
                Math.max(1, Math.floor(Number(run?.playerLevel) || 1)), rewardRoll, poolRoll);
            sequence++;
            report.explorerRewards.push({
                structureId: s.id, x: s.x, y: s.y,
                kind: reward.kind, label: reward.label,
                items: reward.items || [], gold: reward.gold || 0,
            });
        }
        state.runs = pendingRuns;
        state.activeCount = pendingRuns.length;
        state.rewardSequence = sequence;
    }

    // ---- 波次结算 ----
    let towerDps = 0;
    for (const s of target.structures || []) {
        if (s.kind === 'tower') towerDps += s.dps || 0;
    }
    let appliedStructureLevel = initialStructureHpLevel;
    for (const segment of _multiAbilityTimeline(
        initialCombatLevels,
        completionTimes,
        elapsedMs,
        ['sweep_aoe', 'mark_arrow', 'inspire_magic', 'research_structure_hp']
    )) {
        const structureLevel = segment.levels.research_structure_hp || 0;
        if (structureLevel > appliedStructureLevel) {
            _applyStructureHpLevel(target, appliedStructureLevel, structureLevel);
            appliedStructureLevel = structureLevel;
        }
        let unitDps = 0;
        let priestCount = 0;
        let scoutCount = 0;
        for (const structure of target.structures || []) {
            if (structure.kind !== 'barracks'
                && !(structure.kind === 'producer' && structure.unitType)) continue;
            const roster = _normalizedRoster(structure);
            unitDps += _rosterDps(roster, segment.levels);
            priestCount += roster.priest || 0;
            scoutCount += roster.scout || 0;
        }
        const inspire = getBuildingUpgradeAbility('inspire_magic');
        const inspireLevel = segment.levels.inspire_magic || 0;
        if (priestCount > 0 && inspire && inspireLevel > 0) {
            const duration = getAbilityValue(inspire, inspireLevel);
            const uptime = Math.min(
                1,
                priestCount * duration / Math.max(1, inspire.cooldownMs || 30000)
            );
            unitDps *= 1 + ((inspire.atkMul ?? 1.5) - 1) * uptime;
        }
        const mark = getBuildingUpgradeAbility('mark_arrow');
        const markLevel = segment.levels.mark_arrow || 0;
        let markedMul = 1;
        if (scoutCount > 0 && mark && markLevel > 0) {
            const scoutCfg = UNIT_CFGS.scout?.ai || {};
            const shotInterval = Math.max(300, scoutCfg.attackInterval || 2500);
            const chance = Math.max(0, Math.min(1, getAbilityValue(mark, markLevel)));
            const attempts = scoutCount * (mark.durationMs || 3000) / shotInterval;
            const uptime = 1 - Math.pow(1 - chance, attempts);
            markedMul += (mark.damageAmplify || 0.15) * uptime;
        }
        const defenseDps = (towerDps + unitDps) * markedMul;
        if (!opts.skipWaves) {
            _settleWaves(target, cfg, defenseDps, segment.durationMs / 1000, report);
        }
    }

    if (commit) {
        target.capturedAt = Date.now();
        if (Number.isFinite(opts.gameTimeMs)) target.capturedGameTimeMs = opts.gameTimeMs;
    }
    if (!opts.skipWaves && commit && report.victory && !target.wave.victoryGrantedPaid) {
        const reward = cfg.victoryReward || { gold: 500, energy: 500 };
        // 能源入快照仓库（恢复时物化）；金币走全局（grant 回调由调用方注入）
        if (reward.energy) _depositToWarehouses(warehouses, reward.energy);
        if (reward.gold && typeof opts.grant === 'function') opts.grant({ gold: reward.gold });
        target.wave.victoryGrantedPaid = true;
    }
    target.populationEconomy.foodStored = _foodInWarehouses(warehouses);
    return report;
}

// ==================== 内部 ====================

function getProducerStorageCap(s) {
    const cfg = producerBuildingsJson[s.cfgKey];
    if (!cfg || cfg.workshopType !== 'warehouse') return 0;
    const module = buildingUpgradesJson.warehouse_logistics?.modules?.warehouse_capacity;
    const level = Math.max(0, Math.min(
        Number(module?.maxLevel) || 10,
        Math.floor(Number(s.warehouseModules?.warehouse_capacity) || 0)
    ));
    return Math.max(0, Math.floor(
        (Number(module?.base) || Number(cfg.storageCapacity) || 5000)
            + (Number(module?.per) || 0) * level
    ));
}

function _warehouseFactor(warehouse, moduleId) {
    const module = buildingUpgradesJson.warehouse_logistics?.modules?.[moduleId];
    const level = Math.max(0, Math.min(
        Number(module?.maxLevel) || 10,
        Math.floor(Number(warehouse?.warehouseModules?.[moduleId]) || 0)
    ));
    return Math.max(0.1, Math.min(1,
        1 + (Number(module?.base) || 0) + (Number(module?.per) || 0) * level));
}

function _depositToWarehouses(warehouses, amount) {
    let left = amount;
    for (const w of warehouses) {
        const free = _warehouseFree(w);
        const add = Math.min(Math.floor(free / _warehouseFactor(w, 'warehouse_energy_density')), left);
        w.storedEnergy = (w.storedEnergy || 0) + add;
        left -= add;
        if (left <= 0) break;
    }
    return amount - left;
}

function _depositFoodToWarehouses(warehouses, amount) {
    let left = Math.max(0, Math.floor(Number(amount) || 0));
    const requested = left;
    for (const w of warehouses) {
        const free = _warehouseFree(w);
        const add = Math.min(Math.floor(free / _warehouseFactor(w, 'warehouse_food_density')), left);
        w.storedFood = Math.max(0, Number(w.storedFood) || 0) + add;
        left -= add;
        if (left <= 0) break;
    }
    return requested - left;
}

function _foodInWarehouses(warehouses) {
    return warehouses.reduce((sum, w) => sum + Math.max(0, Number(w.storedFood) || 0), 0);
}

function _warehouseFree(warehouse) {
    return Math.max(
        0,
        getProducerStorageCap(warehouse)
            - Math.max(0, Number(warehouse.storedEnergy) || 0)
                * _warehouseFactor(warehouse, 'warehouse_energy_density')
            - Math.max(0, Number(warehouse.storedFood) || 0)
                * _warehouseFactor(warehouse, 'warehouse_food_density')
    );
}

function _energyStorableInWarehouses(warehouses) {
    return warehouses.reduce((sum, warehouse) => sum + Math.floor(
        _warehouseFree(warehouse) / _warehouseFactor(warehouse, 'warehouse_energy_density')
    ), 0);
}

function _deductFromWarehouses(warehouses, amount) {
    let left = Math.max(0, Number(amount) || 0);
    const total = warehouses.reduce((sum, w) => sum + Math.max(0, Number(w.storedEnergy) || 0), 0);
    if (total < left) return false;
    for (let i = warehouses.length - 1; i >= 0 && left > 0; i--) {
        const stored = Math.max(0, Number(warehouses[i].storedEnergy) || 0);
        const take = Math.min(stored, left);
        warehouses[i].storedEnergy = stored - take;
        left -= take;
    }
    return left <= 0;
}

/** 从矿点按序采掘 amount（hp 即储量；枯竭置位并开始重生计时 90s） */
function _mineFromNodes(nodes, amount) {
    let left = amount;
    for (const n of nodes) {
        if (n.depleted || !(n.hp > 0)) continue;
        const take = Math.min(n.hp, left);
        n.hp -= take;
        left -= take;
        if (n.hp <= 0) { n.depleted = true; n.hp = 0; n.respawnTimer = 90000; }
        if (left <= 0) break;
    }
    return amount - Math.max(0, left);
}

function _spawnIntervalOf(s) {
    if (s.kind === 'barracks') return barracksBuildingCfg.spawnIntervalMs || 0;
    const cfg = producerBuildingsJson[s.cfgKey];
    if (!cfg) return 0;
    const u = (cfg.unitTypes || []).find((x) => x.key === s.unitType);
    return (u && u.spawnIntervalMs) || cfg.spawnIntervalMs || 0;
}

function _unitCapOf(s) {
    if (s.kind === 'barracks') return barracksBuildingCfg.unitCap ?? 0;
    const cfg = producerBuildingsJson[s.cfgKey];
    return cfg?.unitCap ?? 5;
}

function _unitSpawnFoodCost(s) {
    if (s.kind === 'barracks') {
        return Math.max(0, Number(barracksBuildingCfg.unitSpawnFoodCost?.[s.unitType]) || 0);
    }
    const cfg = producerBuildingsJson[s.cfgKey];
    const unit = (cfg?.unitTypes || []).find((entry) => entry.key === s.unitType);
    return Math.max(0, Number(unit?.spawnFoodCost) || 0);
}

function _deductFoodFromWarehouses(warehouses, amount) {
    let left = Math.max(0, Number(amount) || 0);
    if (_foodInWarehouses(warehouses) < left) return false;
    for (let i = warehouses.length - 1; i >= 0 && left > 0; i--) {
        const stored = Math.max(0, Number(warehouses[i].storedFood) || 0);
        const take = Math.min(stored, left);
        warehouses[i].storedFood = stored - take;
        left -= take;
    }
    return left <= 0;
}

/** 波次时间轴推进 + 抽象战斗结算（支持 1Hz 增量 tick 与回场一次性结算两种口径：
 *  波次进度 wave.progressSec 跨 tick 累计，怪物输出按实际交战时长逐段结算） */
function _settleWaves(target, cfg, defenseDps, timeSec, report) {
    const wave = target.wave;
    if (wave.victory) return;
    let t = timeSec;
    let guard = 200;
    while (t > 0 && guard-- > 0) {
        if (wave.phase === 'prep' || wave.phase === 'break') {
            const remain = Math.max(0, (wave.phaseTimer || 0) / 1000);
            if (t < remain) { wave.phaseTimer = (remain - t) * 1000; return; }
            t -= remain;
            wave.wave = (wave.wave || 0) + 1;
            wave.phase = 'wave';
            wave.phaseTimer = 0;
            wave.progressSec = 0;
            continue;
        }
        if (wave.phase === 'wave') {
            const pool = _wavePool(wave.wave, cfg);
            // 防守 DPS 每波重算（结算过程中建筑可能被摧毁）
            const dps = (target.structures || []).reduce((sum, s) => {
                if (!(s.hp > 0)) return sum;
                if (s.kind === 'tower') return sum + (s.dps || 0);
                if (s.kind === 'barracks' || (s.kind === 'producer' && s.unitType)) return sum + (s.unitDps || 0);
                return sum;
            }, 0);
            if (dps <= 0) {
                // 无防守输出：怪群按实际时长推平防线与基地
                _applyStructureDamage(target, pool.dps * WORLD122_SIM.contactFraction * t, report);
                if ((target.base?.hp ?? 0) <= 0) { report.defeated = true; return; }
                return; // 波次卡住（回场重打）
            }
            const clearTime = Math.min(WORLD122_SIM.waveTimeMax,
                Math.max(WORLD122_SIM.waveTimeMin, pool.hp / dps));
            const need = clearTime - (wave.progressSec || 0);
            const step = Math.min(t, need);
            wave.progressSec = (wave.progressSec || 0) + step;
            t -= step;
            // 怪物输出按本段交战时长结算（墙/门 → 建筑 → 基地）
            _applyStructureDamage(target, pool.dps * WORLD122_SIM.contactFraction * step, report);
            if ((target.base?.hp ?? 0) <= 0) { report.defeated = true; return; }
            if (wave.progressSec < clearTime) return; // 波次仍在进行（时间用尽）
            // 清波
            report.wavesCleared.push(wave.wave);
            wave.progressSec = 0;
            if (wave.wave >= (cfg.victoryWave ?? 10)) {
                wave.victory = true;
                report.victory = true;
                return;
            }
            wave.phase = 'break';
            wave.phaseTimer = (cfg.waveBreakMs ?? 10000);
        }
    }
}

/** 伤害分配：先墙/门（含门柱），再建筑/塔，最后基地；原地修改快照并统计 */
function _applyStructureDamage(target, amount, report) {
    let left = amount;
    const structures = target.structures || [];
    const walls = structures.filter((s) => s.kind === 'block' || s.kind === 'gate4');
    const buildings = structures.filter((s) => s.kind !== 'block' && s.kind !== 'gate4');
    for (const group of [walls, buildings]) {
        if (left <= 0) break;
        for (const s of group) {
            if (left <= 0) break;
            if (!(s.hp > 0)) continue;
            const take = Math.min(s.hp, left);
            s.hp -= take;
            left -= take;
            if (s.hp <= 0) {
                s.hp = 0;
                report.structuresLost++;
            }
        }
    }
    if (left > 0 && target.base) {
        const take = Math.min(target.base.hp, left);
        target.base.hp -= take;
        report.baseDamage += take;
    }
}
