// One persisted family for the entire invasion, including interception and siege.
import config from '../../data/invasion-campaign.json';
import enemies from '../../data/enemy-config.json';
import worldConfig from '../../data/world-system.json';
import { getEnemyInvasionCatalog, getInvasionDeclaration, invasionDependencyTypes, invasionThreat } from '../config/enemy-invasion-catalog.js';
import { enemyConstructor } from '../entities/enemy-registry.js';
import { invasionAssetBudget } from './invasion-asset-budget.js';

export function invasionRandom(seed) {
    let value = seed >>> 0;
    return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}

function weightedOrder(items, random, weight = (item) => item.weight || 1) {
    const left = [...items], result = [];
    while (left.length) {
        let roll = random() * left.reduce((sum, item) => sum + weight(item), 0);
        let index = left.findIndex((item) => (roll -= weight(item)) < 0);
        if (index < 0) index = left.length - 1;
        result.push(left.splice(index, 1)[0]);
    }
    return result;
}

export async function buildInvasionFormation(cycle, day, targetWorld, {
    seed, lastFamilyId = null, isCancelled = () => false,
} = {}) {
    const random = invasionRandom(seed), catalog = getEnemyInvasionCatalog({ hasFactory: enemyConstructor });
    const pool = catalog.families.filter((family) => family.canForm && family.weight > 0
        && day >= family.unlockDay && family.worlds.includes(targetWorld));
    const cfg = config.formation, growth = worldConfig.invasion;
    const hpMul = Math.min(cfg.maxHpMultiplier, 1 + Math.max(0, cycle - 1) * growth.hpGrowthPerCycle);
    const atkMul = Math.min(cfg.maxAtkMultiplier, 1 + Math.max(0, cycle - 1) * growth.atkGrowthPerCycle);
    const threatLimit = Math.min(cfg.maxThreat, cfg.baseThreat + Math.max(0, cycle - 1) * cfg.threatPerCycle);
    const reports = new Map(), issues = [];
    const getReport = (type) => {
        if (!reports.has(type)) reports.set(type, invasionAssetBudget([type], { isCancelled }));
        return reports.get(type);
    };
    const mebibyte = 1024 * 1024;
    for (const family of weightedOrder(pool, random, (entry) => entry.weight * (entry.id === lastFamilyId ? 0.5 : 1))) {
        const available = (role) => family.roles[role].filter((entry) => day >= entry.minDay);
        const normals = weightedOrder(available('normal'), random), leaders = weightedOrder(available('leader'), random);
        const elites = weightedOrder(available('elite'), random);
        const candidates = [];
        for (const leader of leaders) for (const normal of normals) {
            for (const elite of elites.length ? elites : family.allowPromotedElite ? [normal] : []) candidates.push({ normal, elite, leader });
        }
        for (const selected of candidates) {
            if (isCancelled()) return null;
            const { normal, elite, leader } = selected, promoted = normal.type === elite.type;
            const types = [normal.type, elite.type, leader.type];
            const dependencies = invasionDependencyTypes(types);
            if (dependencies.length > cfg.maxTypesWithSummons) { issues.push(`${family.name}：伴生种类超限`); continue; }
            const eliteHp = hpMul * (promoted ? cfg.promotedEliteHpMultiplier : 1);
            const eliteAtk = atkMul * (promoted ? cfg.promotedEliteAtkMultiplier : 1);
            const costs = { normal: invasionThreat(normal.type, hpMul, atkMul), elite: invasionThreat(elite.type, eliteHp, eliteAtk),
                leader: invasionThreat(leader.type, hpMul, atkMul) };
            const summonTypes = [...new Set(dependencies.flatMap((type) => getInvasionDeclaration(type)?.summons || []))];
            const summonCost = summonTypes.length ? cfg.summonReserve * Math.max(...summonTypes.map((type) => invasionThreat(type))) : 0;
            let eliteCount = Math.min(cfg.maxElites, cfg.baseElites + Math.floor(Math.max(0, cycle - 1) / cfg.extraEliteEveryCycles));
            let countNormals = 0;
            while (eliteCount >= cfg.minElites) {
                countNormals = Math.min(cfg.maxNormals, cfg.baseNormals + Math.max(0, cycle - 1) * cfg.normalsPerCycle,
                    cfg.maxTotal - eliteCount - 1, Math.floor((threatLimit - costs.leader - costs.elite * eliteCount - summonCost) / costs.normal));
                if (countNormals >= cfg.minNormals) break;
                eliteCount--;
            }
            if (countNormals < cfg.minNormals || eliteCount < cfg.minElites) { issues.push(`${family.name}：威胁预算不足`); continue; }
            try {
                const sheets = new Map();
                for (const [entry, cap] of [[normal, 64], [elite, promoted ? 64 : 128], [leader, 256]]) {
                    const report = await getReport(entry.type);
                    if (isCancelled()) return null;
                    if (report.bytes > cap * mebibyte) throw new Error(`${entry.name}超出用途纹理准入线`);
                    report.sheets.forEach((sheet) => sheets.set(sheet.key, sheet));
                }
                const textureBytes = [...sheets.values()].reduce((sum, sheet) => sum + sheet.bytes, 0);
                if (textureBytes > cfg.enemyTextureBudgetMiB * mebibyte) throw new Error('整军纹理依赖超预算');
                return makeFormation({ family, selected, countNormals, eliteCount, cycle, seed, hpMul, atkMul,
                    textureBytes, summonTypes, threat: costs.normal * countNormals + costs.elite * eliteCount + costs.leader + summonCost });
            } catch (error) { issues.push(`${family.name}：${error.message}`); }
        }
    }
    throw new Error([...new Set(issues)].slice(0, 5).join('；') || '当前位面/进度没有角色齐全的入侵系列');
}

function makeFormation({ family, selected, countNormals, eliteCount, cycle, seed, hpMul, atkMul, textureBytes, summonTypes, threat }) {
    const cfg = config.formation, growth = worldConfig.invasion;
    const waveCount = Math.ceil((countNormals + eliteCount + 1) / Math.min(cfg.batchSize, growth.maxAlive));
    const waves = Array.from({ length: waveCount }, () => []);
    let slot = 0;
    const add = (type, role, wave) => {
        const promoted = role === 'elite' && selected.elite.type === selected.normal.type;
        waves[wave].push({ type, role, slot: `invasion_${cycle}_${slot++}`, invasionWave: wave,
            hpRatio: 1, hpMul: hpMul * (promoted ? cfg.promotedEliteHpMultiplier : 1),
            atkMul: atkMul * (promoted ? cfg.promotedEliteAtkMultiplier : 1) });
    };
    // Reserve the final batch for the single leader and its escorts. No new type
    // is rolled between waves, and interception never regenerates spent reserves.
    const normalCapacity = Math.min(cfg.batchSize, growth.maxAlive);
    for (let index = 0; index < countNormals; index++) add(selected.normal.type, 'normal', Math.floor(index / normalCapacity));
    for (let index = 0; index < eliteCount; index++) add(selected.elite.type, 'elite', waveCount - 1);
    add(selected.leader.type, 'leader', waveCount - 1);
    return { familyId: family.id, familyName: family.name, habitat: family.habitat,
        composition: invasionRosterSummary(waves.flat()), seed, catalogVersion: config.version, textureBytes, threat,
        summonLedger: { limit: cfg.summonReserve, spent: 0, allowedTypes: summonTypes, nextSerial: 1 },
        waves };
}

export function invasionRosterSummary(roster) {
    const groups = new Map();
    for (const record of roster || []) {
        if (!(record.hpRatio > 0)) continue;
        const role = record.role === 'leader' ? '首领' : record.role === 'elite' ? '精锐' : '普通';
        const name = `${enemies[record.type]?.name || record.type}（${role}）`;
        groups.set(name, (groups.get(name) || 0) + 1);
    }
    return [...groups].map(([name, count]) => `${name}×${count}`).join(' · ');
}

export function invasionRosterWaves(roster) {
    const waves = new Map();
    for (const record of roster || []) {
        if (!(record.hpRatio > 0)) continue;
        const index = Math.max(0, Number(record.invasionWave) || 0);
        if (!waves.has(index)) waves.set(index, []);
        waves.get(index).push({ ...record });
    }
    return [...waves].sort(([a], [b]) => a - b).map(([, records]) => records);
}
