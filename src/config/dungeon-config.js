import dungeonConfigData from '../../data/dungeon-config.json';
import dungeonTerrainConfig from '../../data/dungeon-terrain.json';
import swampDungeonTerrainConfig from '../../data/swamp-dungeon-terrain.json';
import { getTributeCombatChanceDelta, getTributeEliteChanceDelta } from './tribute-effects.js';

// 难度等级顺序（与 dungeon-event-definitions.js GRADE_ORDER 保持一致）
const GRADE_ORDER_LOCAL = ['F', 'E', 'D', 'C', 'B', 'A'];

const DEFAULTS = {
    zombieDungeon: {
        // 路线选择界面背景图（按地牢类型配置；其他地牢在 dungeon-config.json 各自覆盖）
        mapBackground: 'assets/scenes/dungeon-bg/zombie.png',
        // 达到 Boss 房间的最少房间数（独立约束，与 shortestCombatPath 不冲突：
        // 最短路径房间数 = 中间列 + 2；值更大时扩展中间列，多出的按比例生成战斗/事件）
        minRoomsToBoss: 7,
        nodeCount: { min: 35, max: 40 },
        shortestCombatPath: 9,
        typeRatios: { combat: 0.70, event: 0.30 },
        eliteCombatChance: 0.20,
        // 竞技场（含精英战斗事件）最后一波普通怪数量（精英/领主/强制怪另算不动）
        arenaLastWaveNormals: 10,
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
        grid: { rows: 4, colSpacing: 160, rowSpacing: 140, mainRow: 1 },
        startRows: [0, 1, 2, 3],
        bossReward: { bossBeforeLastCol: true, rewardAfterBoss: true },
        nodeDisplay: { unrevealedIcon: '?', completedCombatType: 'empty' }
    },
    combatRoom: {
        normalSize: 1024,   // 普通战斗房固定尺寸
        eliteSize: 1792,    // 精英战斗房固定尺寸
        bossSize: 2048,     // Boss 房固定尺寸（地牢级 combatRoom.bossSize 可覆盖，如僵尸地牢高级=1024）
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
        if (dungeonType === 'frozenBeginner') return 'frozenDungeonBeginner';
        if (dungeonType === 'frozenMid') return 'frozenDungeonMid';
        if (dungeonType === 'frozen') return 'frozenDungeon';
        if (dungeonType === 'zombieMid') return 'zombieDungeonMid';
        if (dungeonType === 'swampBeginner') return 'swampDungeonBeginner';
        if (dungeonType === 'swampMid') return 'swampDungeonMid';
        if (dungeonType === 'swamp') return 'swampDungeon';
        if (dungeonType === 'demonCavern') return 'demonCavern';
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

    /**
     * 地板贴图配置（data/dungeon-config.json 各地牢 floor 字段：
     * { tiles: [贴图键...], glow: 是否启用发光层 }；未配置返回 null 走模块默认）
     */
    getDungeonFloorProfile(dungeonType) {
        const cfg = dungeonConfigData[this._keyFor(dungeonType)] || {};
        const floor = cfg.floor || null;
        if (floor?.terrainProfile === 'zombieDungeonStone') {
            const base = dungeonTerrainConfig.base || {};
            return {
                tiles: Array.isArray(base.tiles) ? [...base.tiles] : (base.key ? [base.key] : []),
                glow: false,
                continuous: base.continuous === true,
                backgroundColor: base.backgroundColor || '#050505',
                overlapX: base.overlapX ?? 0,
                overlapY: base.overlapY ?? 0,
                textureScaleY: base.textureScaleY ?? 0.5774,
                cellDetails: dungeonTerrainConfig.detailLayer
                    ? { ...dungeonTerrainConfig.detailLayer, grid: { ...dungeonTerrainConfig.detailLayer.grid } }
                    : null,
                deco: dungeonTerrainConfig.deco
                    ? {
                        ...dungeonTerrainConfig.deco,
                        assets: (dungeonTerrainConfig.deco.assets || []).map(asset => ({ ...asset })),
                    }
                    : null,
            };
        }
        if (floor?.terrainProfile === 'swampDungeonWetland') {
            const base = swampDungeonTerrainConfig.base || {};
            return {
                tiles: base.key ? [base.key] : [],
                glow: false,
                continuous: true,
                backgroundColor: base.backgroundColor || '#0d120b',
                textureScaleY: base.textureScaleY ?? 0.5774,
                cellDetails: swampDungeonTerrainConfig.detailLayer
                    ? { ...swampDungeonTerrainConfig.detailLayer, grid: { ...swampDungeonTerrainConfig.detailLayer.grid } }
                    : null,
                deco: swampDungeonTerrainConfig.deco
                    ? {
                        ...swampDungeonTerrainConfig.deco,
                        assets: (swampDungeonTerrainConfig.deco.assets || []).map(asset => ({ ...asset })),
                    }
                    : null,
            };
        }
        if (!floor) return null;
        return {
            ...floor,
            tiles: Array.isArray(floor.tiles) ? [...floor.tiles] : [],
            cellDetails: floor.cellDetails ? { ...floor.cellDetails, grid: { ...floor.cellDetails.grid } } : null,
            deco: floor.deco
                ? { ...floor.deco, assets: (floor.deco.assets || []).map(asset => ({ ...asset })) }
                : null,
        };
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

    /** 出征下拉框分组；父级按系列排序，子项按初级→中级→高级排序。 */
    getDungeonGroups() {
        const groups = new Map();
        for (const [type, info] of Object.entries(this.getDungeonList())) {
            const series = info.series || type;
            if (!groups.has(series)) {
                groups.set(series, {
                    key: series,
                    name: info.seriesName || info.name || type,
                    icon: info.seriesIcon || '',
                    order: Number(info.seriesOrder) || 999,
                    items: [],
                });
            }
            groups.get(series).items.push({ ...info, type });
        }
        return Array.from(groups.values())
            .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'))
            .map((group) => ({
                ...group,
                items: group.items.sort((a, b) =>
                    (Number(a.tierOrder) || 999) - (Number(b.tierOrder) || 999)
                    || a.name.localeCompare(b.name, 'zh-CN')),
            }));
    },

    /** 同系列的前置通关地牢；无前置时返回 null。 */
    getDungeonUnlockRequirement(dungeonType) {
        return this.getDungeonList()[dungeonType]?.unlockAfter || null;
    },

    /**
     * 战斗房尺寸配置（支持地牢级覆盖：dungeonType 对应地牢的 combatRoom 字段，
     * 如 zombieDungeon.combatRoom.bossSize=1024 覆盖全局 Boss 房 2048）
     */
    getCombatRoomConfig(dungeonType) {
        let cfg = deepMerge(DEFAULTS.combatRoom, dungeonConfigData.combatRoom || {});
        if (dungeonType) {
            const per = (dungeonConfigData[this._keyFor(dungeonType)] || {}).combatRoom;
            if (per) cfg = deepMerge(cfg, per);
        }
        return cfg;
    },

    /** 地牢等级（F/E/D/C/B/A，未配置按 D） */
    getDungeonGrade(dungeonType) {
        const list = dungeonConfigData.dungeonList || {};
        return (list[dungeonType] && list[dungeonType].grade) || 'D';
    },

    /** 多房竞技场配置：等级/战斗类型房间数、通道预制与迷宫布局参数。 */
    getCombatArenaConfig(dungeonType = null) {
        const DEFAULT_ARENA = {
            roomCountByGrade: {
                F: { normal: 1, elite: 1 },
                E: { normal: 1, elite: 3 },
                D: { normal: 3, elite: 5 },
                C: { normal: 3, elite: 5 },
                B: { normal: 3, elite: 5 },
                A: { normal: 3, elite: 5 },
            },
            passagePrefabs: {
                default: { v1: '左右通道', v2: '上下通道' },
            },
            passageGap: 0,
            // 多房迷宫（2026-08-08）：roomCount ≥ 4 启用蛇形网格；默认三房直线
            maze: { enabled: false, roomCount: 5, rows: 0 },
        };
        let cfg = deepMerge(DEFAULT_ARENA, dungeonConfigData.combatArena || {});
        if (dungeonType) {
            const perDungeon = (dungeonConfigData[this._keyFor(dungeonType)] || {}).combatArena;
            if (perDungeon) cfg = deepMerge(cfg, perDungeon);
        }
        return cfg;
    },

    /** 普通/精英战的房间数真源；地牢级 normalRoomCount/eliteRoomCount 可个别覆盖。 */
    getCombatArenaRoomCount(dungeonType, isElite = false) {
        const cfg = this.getCombatArenaConfig(dungeonType);
        const dungeonCfg = dungeonConfigData[this._keyFor(dungeonType)] || {};
        const perDungeon = dungeonCfg.combatArena || {};
        const explicit = isElite ? perDungeon.eliteRoomCount : perDungeon.normalRoomCount;
        if (Number.isFinite(Number(explicit))) {
            return Math.max(1, Math.floor(Number(explicit)));
        }
        const grade = this.getDungeonGrade(dungeonType);
        const gradeRule = cfg.roomCountByGrade?.[grade] || {};
        const count = isElite ? gradeRule.elite : gradeRule.normal;
        return Math.max(1, Math.floor(Number(count) || 1));
    },

    /** 一房战斗走普通战斗房；两房及以上才建竞技场。enabled:false 保留为地牢级禁用门。 */
    isCombatArenaEnabled(dungeonType, isElite = false) {
        const dungeonCfg = dungeonConfigData[this._keyFor(dungeonType)] || {};
        if (dungeonCfg.combatArena?.enabled === false) return false;
        return this.getCombatArenaRoomCount(dungeonType, isElite) > 1;
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
