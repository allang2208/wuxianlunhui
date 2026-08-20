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
// - 读条：铁匠铺能力/研究院研究按剩余时间完成并升全局等级；持续升级在后台只完成
//   当前读条（不自动续升，回场由实机循环续）。
// - commit=false 时为预览（世界切换面板用）：不改快照、不触发全局副作用。
// ============================================================
import { getAbilityLevel, getAbilityValue, raiseAbilityLevel } from './ability-store.js';
import { getUnitUpgradeMults } from './unit-upgrade-store.js';
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
import barracksBuildingCfg from '../../data/hamster-barracks-building.json';
import { MINER_CAMP_CONFIG, getMinerEnergyPerSecond, getMinerEconomyStats } from './miner-economy.js';

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
};

/** 兵种单兵 DPS（配置 × 全局升级倍率，与实机 spawnUnit 同公式） */
function _levelOf(abilityId, levelOverrides = null) {
    return levelOverrides && Object.prototype.hasOwnProperty.call(levelOverrides, abilityId)
        ? levelOverrides[abilityId]
        : getAbilityLevel(abilityId);
}

function _unitDps(kind, levelOverrides = null) {
    const cfg = UNIT_CFGS[kind];
    if (!cfg || !cfg.ai) return 0;
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
    if (kind === 'warrior') {
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
        energyMined: 0, passiveEnergy: 0, titheEnergy: 0, unitsProduced: 0,
        energySpentOnUnits: 0,
        abilitiesCompleted: [], structuresLost: 0, baseDamage: 0,
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

    // ---- 读条结算（铁匠铺能力/研究院研究；持续升级后台不自动续）----
    for (const s of target.structures || []) {
        if (s.kind !== 'producer' || !s.upgrade) continue;
        const up = s.upgrade;
        const elapsedMsLocal = Math.max(0, elapsedMs);
        if (up.remainMs <= elapsedMsLocal) {
            if (!completionTimes[up.abilityId]) completionTimes[up.abilityId] = [];
            completionTimes[up.abilityId].push(Math.max(0, Number(up.remainMs) || 0));
            if (commit) {
                const ability = getBuildingUpgradeAbility(up.abilityId);
                raiseAbilityLevel(up.abilityId, ability?.maxLevel ?? 10);
            }
            report.abilitiesCompleted.push(up.abilityId);
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
    const warehouses = (target.structures || []).filter((s) => s.kind === 'producer'
        && getProducerStorageCap(s) > 0);
    let warehouseFree = warehouses.reduce((sum, w) => sum + Math.max(0, getProducerStorageCap(w) - (w.storedEnergy || 0)), 0);
    // 被动能源先入仓
    if (report.passiveEnergy > 0 && warehouseFree > 0) {
        const add = Math.min(report.passiveEnergy, warehouseFree);
        _depositToWarehouses(warehouses, add);
        warehouseFree -= add;
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
            warehouseFree -= add;
            report.titheEnergy += add;
        }
    }
    // 小屋暂存先入仓
    for (const s of target.structures || []) {
        if (s.kind !== 'hut' || !(s.storedEnergy > 0) || warehouseFree <= 0) continue;
        const moved = Math.min(s.storedEnergy, warehouseFree);
        s.storedEnergy -= moved;
        warehouseFree -= moved;
        _depositToWarehouses(warehouses, moved);
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
                warehouseFree -= mined;
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
                warehouseFree += cost;
                report.energySpentOnUnits += cost;
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
        if (s.kind === 'producer' && !s.unitType) continue; // 非产兵建筑
        const baseInterval = _spawnIntervalOf(s);
        if (!(baseInterval > 0)) continue;
        const cap = _unitCapOf(s);
        let timer = Math.max(0, s.spawnTimer || 0);
        const roster = _normalizedRoster(s);
        const deployed = Math.max(0, Math.floor(Number(s.troopLineDeployed) || 0));
        let alive = _rosterCount(roster) + deployed;
        const segments = _abilityTimeline(
            initialRecruitLevel,
            completionTimes,
            elapsedMs,
            'research_recruit_speed'
        );
        let previousInterval = baseInterval * _recruitMult(initialRecruitLevel);
        let energyBlocked = false;
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
                const spawnCost = _unitSpawnEnergyCost(s);
                if (spawnCost > 0 && !_deductFromWarehouses(warehouses, spawnCost)) {
                    timer = 0;
                    energyBlocked = true;
                    break;
                }
                warehouseFree += spawnCost;
                report.energySpentOnUnits += spawnCost;
                alive++;
                roster[s.unitType] = (roster[s.unitType] || 0) + 1;
                report.unitsProduced++;
                timer = interval;
            }
            previousInterval = interval;
            if (energyBlocked) break;
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
    return report;
}

// ==================== 内部 ====================

function getProducerStorageCap(s) {
    const cfg = producerBuildingsJson[s.cfgKey];
    return cfg && cfg.workshopType === 'warehouse' ? (cfg.storageCapacity ?? 5000) : 0;
}

function _depositToWarehouses(warehouses, amount) {
    let left = amount;
    for (const w of warehouses) {
        const free = Math.max(0, getProducerStorageCap(w) - (w.storedEnergy || 0));
        const add = Math.min(free, left);
        w.storedEnergy = (w.storedEnergy || 0) + add;
        left -= add;
        if (left <= 0) break;
    }
    return amount - left;
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

function _unitSpawnEnergyCost(s) {
    if (s.kind === 'barracks') {
        return Math.max(0, Number(barracksBuildingCfg.unitSpawnEnergyCost?.[s.unitType]) || 0);
    }
    const cfg = producerBuildingsJson[s.cfgKey];
    const unit = (cfg?.unitTypes || []).find((entry) => entry.key === s.unitType);
    return Math.max(0, Number(unit?.spawnEnergyCost) || 0);
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
