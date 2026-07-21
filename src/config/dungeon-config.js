import dungeonConfigData from '../../data/dungeon-config.json';
import { getTributeCombatChanceDelta, getTributeEliteChanceDelta } from './tribute-effects.js';

// 难度等级顺序（与 dungeon-event-definitions.js GRADE_ORDER 保持一致）
const GRADE_ORDER_LOCAL = ['F', 'E', 'D', 'C', 'B', 'A'];

const DEFAULTS = {
    zombieDungeon: {
        nodeCount: { min: 35, max: 40 },
        shortestCombatPath: 9,
        typeRatios: { combat: 0.70, event: 0.30 },
        eliteCombatChance: 0.20,
        encounters: {
            normal: {
                combatWaves: 3,
                monstersPerWave: 5,
                tierWeights: { normal: 0.80, elite: 0.20 },
                guaranteeAtLeastOneElite: false
            },
            elite: {
                combatWaves: 1,
                monstersPerWave: 6,
                monsterComposition: { elite: 1, normal: 5 },
                tierWeights: { normal: 0, elite: 1 },
                guaranteeAtLeastOneElite: false
            }
        },
        eliteChestReward: {
            items: [
                { type: 'gold', count: 100 },
                { type: 'reforge_ticket', count: 1 },
                { type: 'weapon', rarity: 'common', count: 1 }
            ]
        },
        grid: { rows: 4, colSpacing: 160, rowSpacing: 140, mainRow: 1 },
        startRows: [0, 1, 2, 3],
        bossReward: { bossBeforeLastCol: true, rewardAfterBoss: true },
        nodeDisplay: { unrevealedIcon: '?', completedCombatType: 'empty' }
    },
    combatRoom: {
        normalSize: { min: 1024, max: 2048, step: 256 },
        bossSize: 1024,
        wallThickness: 20,
        cleanupCountdownMs: 10000,
        spawn: { playerOffsetFromEdge: 60, monsterSpawnDepth: 120, monsterMargin: 40, minWallDistance: 150 }
    }
};

function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

export const DungeonConfig = {
    raw: dungeonConfigData,

    // 地牢类型 → 配置键映射（新增地牢在此登记）
    _keyFor(dungeonType) {
        if (dungeonType === 'zombieBeginner') return 'zombieDungeonBeginner';
        if (dungeonType === 'zombieMid') return 'zombieDungeonMid';
        return 'zombieDungeon';
    },

    getZombieDungeonConfig(dungeonType) {
        const cfg = deepMerge(DEFAULTS.zombieDungeon, dungeonConfigData[this._keyFor(dungeonType)] || {});
        // 祭品效果（数据驱动）：战斗/随机事件比例耦合调整（合计恒为 100%）
        const delta = getTributeCombatChanceDelta() / 100;
        if (delta !== 0 && cfg.typeRatios) {
            cfg.typeRatios = { ...cfg.typeRatios };
            cfg.typeRatios.combat = Math.min(1, Math.max(0, (cfg.typeRatios.combat ?? 0.7) + delta));
            cfg.typeRatios.event = 1 - cfg.typeRatios.combat;
        }
        // 宝箱岔路：条数随地牢等级提升（F=2、每级+2；chestBranches.count 配置可覆盖）
        if (!cfg.chestBranches) cfg.chestBranches = {};
        if (cfg.chestBranches.count === undefined) {
            const list = dungeonConfigData.dungeonList || {};
            const grade = (list[dungeonType] && list[dungeonType].grade) || 'D';
            const gradeIdx = Math.max(0, GRADE_ORDER_LOCAL.indexOf(grade));
            cfg.chestBranches = { ...cfg.chestBranches, count: 2 + gradeIdx * 2 };
        }
        return cfg;
    },

    getZombieEncounterConfig(isElite, dungeonType) {
        const cfg = dungeonConfigData[this._keyFor(dungeonType)] || {};
        const encounters = cfg.encounters || {};
        return encounters[isElite ? 'elite' : 'normal'] || DEFAULTS.zombieDungeon.encounters[isElite ? 'elite' : 'normal'];
    },

    // Boss 战遭遇配置（独立副本，如 zombieDungeonBeginner.bossEncounter）
    getBossEncounterConfig(dungeonType) {
        const cfg = dungeonConfigData[this._keyFor(dungeonType)] || {};
        return cfg.bossEncounter || null;
    },

    getEliteCombatChance(dungeonType) {
        const cfg = dungeonConfigData[this._keyFor(dungeonType)] || {};
        const base = cfg.eliteCombatChance ?? (dungeonType === 'zombie' ? 0.20 : 0);
        // 祭品效果（数据驱动）：精英战斗概率增减（百分点）
        const delta = getTributeEliteChanceDelta() / 100;
        return Math.min(1, Math.max(0, base + delta));
    },

    // 出征界面地牢列表（展示元数据）
    getDungeonList() {
        return dungeonConfigData.dungeonList || {};
    },

    getCombatRoomConfig() {
        return deepMerge(DEFAULTS.combatRoom, dungeonConfigData.combatRoom || {});
    },

    getEventConfig(eventType) {
        const events = dungeonConfigData.events || {};
        if (!eventType) return events;
        return events[eventType];
    },

    getAttributeCheckConfig() {
        return (dungeonConfigData.events && dungeonConfigData.events.attributeCheck) || {
            baseSuccessRate: 20,
            attrMultiplier: 1,
            maxSuccessRate: 95,
            minSuccessRate: 5
        };
    },

    getEventWeights() {
        return (dungeonConfigData.events && dungeonConfigData.events.eventWeights) || {
            goddessStatue: 1, trap: 1, supplyPile: 1, treasureChest: 1, demonStatue: 1
        };
    },

    getSpecialItem(type) {
        const specials = (dungeonConfigData.events && dungeonConfigData.events.specialItems) || {};
        return specials[type];
    }
};

export default DungeonConfig;
