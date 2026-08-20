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
import { getBuildingUpgradeAbility, getUpgradeModulesForUnitKind } from './building-upgrade-projects.js';
import producerBuildingsJson from '../../data/producer-buildings.json';
import minerCfg from '../../data/hamster-miner-config.json';
import militiaCfg from '../../data/hamster-militia-config.json';
import warriorCfg from '../../data/hamster-warrior-config.json';
import shooterCfg from '../../data/hamster-shooter-config.json';
import guardCfg from '../../data/hamster-guard-config.json';
import scoutCfg from '../../data/hamster-scout-config.json';
import musketeerCfg from '../../data/hamster-musketeer-config.json';
import knightCfg from '../../data/hamster-knight-config.json';

/** 抽象结算估算常量（调整平衡只改这里） */
export const WORLD122_SIM = {
    tpHpAvg: 35,            // 波次 HP 池：每威胁预算 TP ≈ 35 HP
    tpCountAvg: 3.5,        // 每只怪平均 TP（估只数）
    monsterDpsPer: 8,       // 每只怪平均 DPS（随波次 atk 成长另乘）
    contactFraction: 0.5,   // 怪物输出实际落到建筑的比例（其余被拦截/走位消耗）
    waveTimeMin: 20,        // 清波耗时下限（秒）
    waveTimeMax: 180,       // 清波耗时上限（秒）
};

const UNIT_CFGS = {
    militia: militiaCfg, warrior: warriorCfg, shooter: shooterCfg,
    guard: guardCfg, scout: scoutCfg, musketeer: musketeerCfg,
    knight: knightCfg,
};

/** 兵种单兵 DPS（配置 × 全局升级倍率，与实机 spawnUnit 同公式） */
function _unitDps(kind) {
    const cfg = UNIT_CFGS[kind];
    if (!cfg || !cfg.ai) return 0;
    const mults = getUnitUpgradeMults(kind, getUpgradeModulesForUnitKind(kind));
    const dmg = (cfg.ai.attackDamage ?? 20) * mults.attackDamageMult;
    const interval = Math.max(300, (cfg.ai.attackInterval ?? 2000) * mults.attackIntervalMult);
    return dmg * 1000 / interval;
}

/** 快速募兵倍率（与 research-system.getRecruitIntervalMs 同口径，读结算开始时的等级） */
function _recruitMult() {
    const lv = getAbilityLevel('research_recruit_speed');
    const bonus = getAbilityValue(getBuildingUpgradeAbility('research_recruit_speed'), lv);
    return 1 / (1 + bonus);
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
        energyMined: 0, passiveEnergy: 0, unitsProduced: 0,
        abilitiesCompleted: [], structuresLost: 0, baseDamage: 0,
    };
    if (!snap || !snap.wave || !(elapsedMs > 0)) return report;
    const target = commit ? snap : JSON.parse(JSON.stringify(snap));
    let t = elapsedMs / 1000; // 秒
    const cfg = target.config || {};

    // ---- 读条结算（铁匠铺能力/研究院研究；持续升级后台不自动续）----
    for (const s of target.structures || []) {
        if (s.kind !== 'producer' || !s.upgrade) continue;
        const up = s.upgrade;
        const elapsedMsLocal = Math.max(0, elapsedMs);
        if (up.remainMs <= elapsedMsLocal) {
            if (commit) raiseAbilityLevel(up.abilityId);
            report.abilitiesCompleted.push(up.abilityId);
            s.upgrade = null; // _continuous 保留：回场实机循环自动续升
        } else {
            up.remainMs -= elapsedMsLocal;
        }
    }

    // ---- 被动能源（研究等级，结算期常量口径；秒结算与实机一致）----
    // commit 时读条循环已升全局等级；预览（commit=false）未升，按完成项临时+1
    const passiveLv = getAbilityLevel('research_passive_energy')
        + (commit ? 0 : report.abilitiesCompleted.filter((id) => id === 'research_passive_energy').length);
    const passivePerSecond = getAbilityValue(
        getBuildingUpgradeAbility('research_passive_energy'),
        passiveLv
    );
    report.passiveEnergy = opts.includePassiveEnergy === false
        ? 0
        : (passiveLv > 0 ? Math.floor(t) * passivePerSecond : 0);

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
    // 矿工采矿（速率 = 矿工数 × 单矿工伤害/间隔 × 50% 采集比 × 采矿模块）
    const minerAi = minerCfg.ai || {};
    const minerPerSec = ((minerAi.attackDamage ?? 100) / Math.max(300, minerAi.attackInterval ?? 2000)) * 1000 * 0.5;
    const nodes = target.nodes || [];
    for (const s of target.structures || []) {
        if (s.kind !== 'hut') continue;
        if (warehouseFree <= 0) break;
        const miners = s.miners || 0;
        const fullCount = Math.max(miners, 1 + ((s.modules && s.modules.count) || 0));
        const miningMult = 1 + 0.15 * ((s.modules && s.modules.mining) || 0);
        // 两段式：补员计时内按现有矿工，之后按满编（respawnTimer=0 且未满编视为即时补齐）
        const wait = Math.min(Math.max(0, (s.respawnTimer || 0) / 1000), t);
        const segments = [];
        if (wait > 0 && miners < fullCount) segments.push({ count: miners, sec: wait });
        segments.push({ count: (miners < fullCount) ? fullCount : miners, sec: t - wait });
        for (const seg of segments) {
            if (warehouseFree <= 0) break;
            let want = seg.count * minerPerSec * miningMult * seg.sec;
            want = Math.min(want, warehouseFree);
            const mined = Math.min(_mineFromNodes(nodes, want), warehouseFree);
            if (mined > 0) {
                _depositToWarehouses(warehouses, mined);
                warehouseFree -= mined;
                report.energyMined += mined;
            }
        }
        // 矿工补员结算
        if ((s.respawnTimer || 0) <= elapsedMs) {
            s.miners = fullCount;
            s.respawnTimer = 0;
        } else {
            s.respawnTimer -= elapsedMs;
        }
    }

    // ---- 产兵结算（波次前先补员——产出的兵参与后续波次防守）----
    const recruitMult = _recruitMult();
    for (const s of target.structures || []) {
        if (s.kind !== 'barracks' && s.kind !== 'producer') continue;
        if (s.kind === 'producer' && !s.unitType) continue; // 非产兵建筑
        const interval = _spawnIntervalOf(s) * recruitMult;
        if (!(interval > 0)) continue;
        const cap = _unitCapOf(s);
        let timer = Math.max(0, s.spawnTimer || 0);
        let alive = s.units || 0;
        let timeLeft = elapsedMs;
        while (alive < cap) {
            if (timeLeft < timer) { timer -= timeLeft; break; }
            timeLeft -= timer;
            alive++;
            report.unitsProduced++;
            timer = interval;
        }
        s.units = alive;
        s.spawnTimer = alive >= cap ? interval : timer;
        // 新产单位计入防守 DPS（当前兵种口径）
        s.unitDps = alive * _unitDps(s.unitType);
    }

    // ---- 波次结算 ----
    const defenseDps = (target.structures || []).reduce((sum, s) => {
        if (s.kind === 'tower') return sum + (s.dps || 0);
        if (s.kind === 'barracks' || (s.kind === 'producer' && s.unitType)) return sum + (s.unitDps || 0);
        return sum;
    }, 0);
    if (!opts.skipWaves) _settleWaves(target, cfg, defenseDps, t, report);

    if (commit) {
        target.capturedAt = Date.now();
        if (Number.isFinite(opts.gameTimeMs)) target.capturedGameTimeMs = opts.gameTimeMs;
    }
    if (commit && report.victory && !target.wave.victoryGrantedPaid) {
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
    if (s.kind === 'barracks') return 45000;
    const cfg = producerBuildingsJson[s.cfgKey];
    if (!cfg) return 0;
    const u = (cfg.unitTypes || []).find((x) => x.key === s.unitType);
    return (u && u.spawnIntervalMs) || cfg.spawnIntervalMs || 0;
}

function _unitCapOf(s) {
    if (s.kind === 'barracks') return 5;
    const cfg = producerBuildingsJson[s.cfgKey];
    return cfg?.unitCap ?? 5;
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
