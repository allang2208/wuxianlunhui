import enemyConfigData from '../../data/enemy-config.json';
import invasionConfig from '../../data/agent-invasion.json';
import { DungeonConfig } from '../config/dungeon-config.js';
import { hasEnemyFamily } from '../config/enemy-family.js';
import {
    GRADE_ORDER,
    NEW_EVENT_CONFIGS,
    RESTRICTED_EVENT_META,
} from './dungeon-event-definitions.js';

const DEFAULT_POOL_FAMILY = '僵尸';
const RANKED_TIERS = new Set(['elite', 'lord', 'boss']);
const INVASION_ROLE_TYPES = {
    assault: 'timeAgentAssault',
    shield: 'timeAgentShield',
};

// 这些是地物本体会在战斗期间生成的伴生/召唤怪。
// 预载解析做闭包，不再要求每个地牢重复抄写这些依赖。
const ENEMY_DEPENDENCIES = {
    amalgamZombie: ['fatZombie', 'zombie'],
    flyHand: ['flySwarm'],
    mineCave: ['minerZombie', 'lanternMinerZombie'],
    tombstone: ['zombie', 'spitterZombie'],
    witch: ['cauldron'],
    zombieWizard: ['zombieDog'],
};

function rankMatchesTier(rank, tier) {
    if (RANKED_TIERS.has(tier)) return rank === tier;
    return !RANKED_TIERS.has(rank);
}

function getFamilyPoolTypes(family, tier) {
    return Object.entries(enemyConfigData)
        .filter(([, cfg]) => cfg && !cfg.noPool
            && hasEnemyFamily(cfg, family)
            && rankMatchesTier(cfg.rank, tier))
        .map(([type]) => type);
}

function getEncounterTiers(encounter) {
    const tiers = new Set();
    const collectComposition = (composition) => {
        if (!composition || typeof composition !== 'object') return;
        for (const [tier, count] of Object.entries(composition)) {
            if (Number(count) > 0) tiers.add(tier);
        }
    };
    for (const composition of encounter?.waveComposition || []) collectComposition(composition);
    collectComposition(encounter?.monsterComposition);
    for (const [tier, weight] of Object.entries(encounter?.tierWeights || {})) {
        if (Number(weight) > 0) tiers.add(tier);
    }
    // 配比未填满 monstersPerWave 时，战斗器会以 normal 池补齐。
    tiers.add('normal');
    return tiers;
}

function collectEncounterFallbackTypes(encounter, out) {
    if (!encounter || typeof encounter !== 'object') return;
    const poolKeys = Array.isArray(encounter.poolKeys)
        ? encounter.poolKeys.filter(Boolean)
        : [];
    const matchPoolRanks = encounter.matchPoolRanks === true;
    const poolFamily = encounter.poolFamily || null;

    for (const tier of getEncounterTiers(encounter)) {
        // 未开启阶级匹配时，任一 poolKeys 都是该槽位的完整白名单。
        if (poolKeys.length && !matchPoolRanks) continue;
        const matchedKeys = poolKeys.filter((type) => rankMatchesTier(enemyConfigData[type]?.rank, tier));
        if (matchedKeys.length) continue;

        // 与 ZombieDungeonCombat.getPool 同口径：poolFamily 无匹配时再回退僵尸默认池。
        const familyTypes = poolFamily ? getFamilyPoolTypes(poolFamily, tier) : [];
        const fallbackTypes = familyTypes.length
            ? familyTypes
            : getFamilyPoolTypes(DEFAULT_POOL_FAMILY, tier);
        for (const type of fallbackTypes) out.add(type);
    }
}

function collectNestedForceMonsters(value, out, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value.forceMonsters)) {
        for (const type of value.forceMonsters) {
            if (type) out.add(type);
        }
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
        collectNestedForceMonsters(child, out, visited);
    }
}

function collectEventTypes(dungeonType, cfg, out) {
    const grade = DungeonConfig.getDungeonGrade(dungeonType);
    const gradeIndex = GRADE_ORDER.indexOf(grade);
    const scope = cfg.eventScope
        || ((dungeonType === 'zombieBeginner' || dungeonType === 'zombieMid') ? 'zombie' : dungeonType);
    for (const [eventType, meta] of Object.entries(RESTRICTED_EVENT_META)) {
        const eventGradeIndex = GRADE_ORDER.indexOf(meta.grade);
        if (meta.scope !== scope || eventGradeIndex < gradeIndex - 1 || eventGradeIndex > gradeIndex + 1) continue;
        collectNestedForceMonsters(NEW_EVENT_CONFIGS[eventType], out);
    }
}

function collectInvasionTypes(dungeonType, out) {
    if (invasionConfig.enabled === false) return;
    const grade = DungeonConfig.getDungeonGrade(dungeonType);
    const minGrade = invasionConfig.minGrade || 'D';
    if (GRADE_ORDER.indexOf(grade) < GRADE_ORDER.indexOf(minGrade)) return;
    const composition = invasionConfig.agentCompositionByGrade?.[grade];
    if (Array.isArray(composition) && composition.length) {
        for (const role of composition) out.add(INVASION_ROLE_TYPES[role] || 'timeAgentAssault');
        return;
    }
    if ((invasionConfig.agentCountByGrade?.[grade] ?? 1) > 0) out.add('timeAgentAssault');
}

function closeEnemyDependencies(out) {
    const pending = [...out];
    for (let i = 0; i < pending.length; i++) {
        for (const dependency of ENEMY_DEPENDENCIES[pending[i]] || []) {
            if (out.has(dependency)) continue;
            out.add(dependency);
            pending.push(dependency);
        }
    }
}

/**
 * 地牢入场的唯一怪物预载集合解析器。
 * 同时覆盖遭遇白名单、家族回退池、限定事件、入侵、通用 Boss 以及伴生/召唤链。
 */
export function resolveDungeonEnemyPreloadTypes(dungeonType) {
    const configKey = DungeonConfig._keyFor(dungeonType);
    const cfg = DungeonConfig.raw[configKey] || {};
    const out = new Set(DungeonConfig.getDungeonEnemyPreloadTypes(dungeonType));

    collectEncounterFallbackTypes(DungeonConfig.getZombieEncounterConfig(false, dungeonType), out);
    collectEncounterFallbackTypes(DungeonConfig.getZombieEncounterConfig(true, dungeonType), out);
    collectEncounterFallbackTypes(DungeonConfig.getBossEncounterConfig(dungeonType), out);

    // 没有独立 bossEncounter 的地牢走 BossRewardSystem 集合体 Boss。
    if (!DungeonConfig.getBossEncounterConfig(dungeonType)) out.add('amalgamZombie');
    // 恐怖地牢普通战斗会由 DungeonMapSystem 额外投放墓碑。
    if (dungeonType === 'zombie' || dungeonType === 'zombieBeginner' || dungeonType === 'zombieMid') {
        out.add('tombstone');
    }

    collectEventTypes(dungeonType, cfg, out);
    collectInvasionTypes(dungeonType, out);
    closeEnemyDependencies(out);
    return [...out].sort();
}
