
/**
 * ZombieDungeon — 僵尸地牢模块
 *
 * 非交叉网格布局：4行 × N列，水平/垂直边 only
 * 左侧1个居中起点，右侧1个BOSS，BOSS之后1个奖励节点
 * 中间节点：第1行为必经主通道（保证最短9场战斗），其余行随机生成作为分支
 * 事件分布：按配置 typeRatios（默认 combat 70% / event 30%）
 */

import { CircleEnemy, ZombieDogEnemy, ZombieWizard, Mutant3, SpitterZombie } from '../entities/enemy-types.js';
import { UIState } from '../ui/ui-state.js';
import { NPCDialogue } from '../ui/npc-dialogue.js';

import { DungeonConfig } from '../config/dungeon-config.js';
import { GAME_CONFIG } from '../config/game-config.js';
import enemyConfigData from '../../data/enemy-config.json';

// ==================== 僵尸工厂（从 enemy-config.json 读取属性） ====================
function createZombieFromConfig(key, x, y, overrides = {}) {
    const cfg = enemyConfigData[key];
    if (!cfg) {
        console.warn(`[ZombieDungeon] Missing enemy config: ${key}`);
        return new CircleEnemy(x, y, { name: key, hp: 50, maxHp: 50, size: 14, showWeapon: false });
    }
    return new CircleEnemy(x, y, {
        ...cfg,
        showWeapon: false,
        ai: {
            ...(cfg.ai || {}),
            aggroRange: 9999,
            loseTimeout: 999999,
            alertRange: 9999
        },
        ...overrides
    });
}

function createArmoredZombie(x, y) {
    const zombie = createZombieFromConfig('armoredZombie', x, y, {
        headColor: '#c0c8d0',
        equipShield: 'small_shield'
    });
    zombie._rangedDamageReduction = 0.5;
    return zombie;
}

export function createBasicZombie(x, y) {
    return createZombieFromConfig('zombie', x, y);
}

function createFastZombie(x, y) {
    return createZombieFromConfig('runnerZombie', x, y);
}

function createZombieDog(x, y) {
    const cfg = enemyConfigData.zombieDog;
    if (!cfg) {
        console.warn('[ZombieDungeon] Missing enemy config: zombieDog');
        return new ZombieDogEnemy(x, y, { name: 'zombieDog', hp: 60, maxHp: 60, size: 12, showWeapon: false });
    }
    return new ZombieDogEnemy(x, y, {
        ...cfg,
        showWeapon: false,
        ai: {
            ...(cfg.ai || {}),
            aggroRange: 9999,
            loseTimeout: 999999,
            alertRange: 9999
        }
    });
}

function createSpitterZombie(x, y) {
    const cfg = enemyConfigData.spitterZombie;
    if (!cfg) {
        console.warn('[ZombieDungeon] Missing enemy config: spitterZombie');
        return new SpitterZombie(x, y, { name: '毒液僵尸', hp: 150, maxHp: 150, size: 13, showWeapon: false });
    }
    return new SpitterZombie(x, y, {
        ...cfg,
        showWeapon: false,
        ai: {
            ...(cfg.ai || {}),
            aggroRange: 9999,
            loseTimeout: 999999,
            alertRange: 9999
        }
    });
}

function createFatZombie(x, y) {
    const zombie = createZombieFromConfig('fatZombie', x, y);
    zombie._rangedDamageReduction = 0.5;
    return zombie;
}

export function createZombieWizard(x, y) {
    const cfg = enemyConfigData.zombieWizard;
    if (!cfg) {
        console.warn('[ZombieDungeon] Missing enemy config: zombieWizard');
        return new ZombieWizard(x, y, { name: 'zombieWizard', hp: 500, maxHp: 500, size: 18 });
    }
    const wizard = new ZombieWizard(x, y, {
        ...cfg,
        ai: {
            ...(cfg.ai || {}),
            aggroRange: 9999,
            loseTimeout: 999999,
            alertRange: 9999
        }
    });
    wizard._createZombieDog = createZombieDog;
    return wizard;
}

export function createMutant3(x, y) {
    const cfg = enemyConfigData.mutant3;
    if (!cfg) {
        console.warn('[ZombieDungeon] Missing enemy config: mutant3');
        return new Mutant3(x, y, { name: 'mutant3', hp: 750, maxHp: 750, size: 22 });
    }
    const mutant = new Mutant3(x, y, {
        ...cfg,
        ai: {
            ...(cfg.ai || {}),
            aggroRange: 9999,
            loseTimeout: 999999,
            alertRange: 9999
        }
    });
    mutant._createZombieDog = createZombieDog;
    return mutant;
}

// 僵尸配置键 -> 工厂函数映射（用于根据 enemy-config.json 的 rank 自动构建怪物池）
const ZOMBIE_FACTORY_MAP = {
    zombie: createBasicZombie,
    runnerZombie: createFastZombie,
    zombieDog: createZombieDog,
    armoredZombie: createArmoredZombie,
    spitterZombie: createSpitterZombie,
    fatZombie: createFatZombie,
    zombieWizard: createZombieWizard,
    mutant3: createMutant3
};

const ZOMBIE_DUNGEON_CONFIG = {
    name: '僵尸地牢',
    description: '被亡灵瘟疫侵蚀的地下墓穴，四条通道通向深处',

    // 战斗波次
    combatWaves: 3,
    monstersPerWave: 5,

    // 怪物 tier 概率
    tierWeights: {
        normal: 0.80,
        elite: 0.20
    },

    // 怪物池（按 tier 分类）—— 根据 enemy-config.json 的 rank 字段动态构建，确保只有一套精英判定
    // normal：普通僵尸、僵尸犬、装甲僵尸、毒液僵尸、肥僵尸
    // elite：僵尸巫师、突变体-3
    monsterPool: {
        get normal() {
            return Object.entries(enemyConfigData)
                .filter(([key, cfg]) => cfg.family === '僵尸' && cfg.rank !== 'elite' && cfg.rank !== 'boss' && ZOMBIE_FACTORY_MAP[key])
                .map(([key]) => ZOMBIE_FACTORY_MAP[key]);
        },
        get elite() {
            return Object.entries(enemyConfigData)
                .filter(([key, cfg]) => cfg.family === '僵尸' && cfg.rank === 'elite' && ZOMBIE_FACTORY_MAP[key])
                .map(([key]) => ZOMBIE_FACTORY_MAP[key]);
        }
    },

    // 地图尺寸（视觉范围，节点坐标由此推算）
    mapWidth: 2000,
    mapHeight: 1600,

    // 视觉配置
    typeColors: {
        start:  '#3a5a3a',
        combat: '#7a3a3a',
        event:  '#6a5a3a',
        shop:   '#3a5a7a',
        boss:   '#7a0000',
        reward: '#5a3a7a',
        converge: '#5a3a5a'
    },
    typeBorderColors: {
        start:  '#6aca6a',
        combat: '#aa5a5a',
        event:  '#9a8a5a',
        shop:   '#5a8aaa',
        boss:   '#aa0000',
        reward: '#8a5aaa',
        converge: '#8a5a8a'
    },
    typeIcons: {
        start:  '▶',
        combat: '⚔',
        event:  '?',
        shop:   '🏪',
        boss:   '☠',
        reward: '🎁',
        converge: '◎'
    },
    typeLabels: {
        start:  '起点',
        combat: '战斗',
        event:  '事件',
        shop:   '商店',
        boss:   'BOSS',
        reward: '奖励',
        converge: '汇合'
    }
};

// ==================== 路线生成器 ====================
export class ZombieDungeonMapGenerator {
    constructor(config = ZOMBIE_DUNGEON_CONFIG) {
        this.config = config;
        this._genCfg = DungeonConfig.getZombieDungeonConfig();
    }

    /**
     * 生成地图节点和边
     * 非交叉网格布局：rows行 × N列，水平/垂直边 only
     * 左侧起点，右侧BOSS，BOSS之后奖励节点
     * 主通道（mainRow）保证最短路径上有 shortestCombatPath 场战斗
     */
    generate() {
        const cfg = this._genCfg;
        const rows = cfg.grid.rows;
        const mainRow = cfg.grid.mainRow ?? 1;
        const shortestCombatPath = cfg.shortestCombatPath;
        const startRow = rows > 1 ? (rows - 1) / 2 : mainRow;

        // 列：起点 + shortestCombatPath 个中间列 + boss + reward
        const combatStartCol = 1;
        const bossCol = combatStartCol + shortestCombatPath;
        const rewardCol = bossCol + 1;
        const totalCols = rewardCol + 1;

        const colSpacing = cfg.grid.colSpacing;
        const rowSpacing = cfg.grid.rowSpacing;

        // 生成节点
        const nodes = [];

        // 起点列：单一居中起点
        nodes.push(this._createNode(0, startRow, colSpacing, rowSpacing, 'start'));

        // 中间列：主通道必有节点，其余行随机出现
        const intermediateRowSets = [];
        for (let col = combatStartCol; col < bossCol; col++) {
            const selectedRows = this._rollIntermediateRows(rows, mainRow);
            intermediateRowSets.push({ col, selectedRows });
        }

        // 调整节点总数到目标区间
        this._adjustNodeCount(intermediateRowSets, rows, mainRow);

        // 强制第 1 列（起点右侧）包含所有行，确保起点始终有 4 条分支
        intermediateRowSets[0].selectedRows = Array.from({ length: rows }, (_, r) => r);

        for (const { col, selectedRows } of intermediateRowSets) {
            for (const row of selectedRows) {
                const isMain = row === mainRow;
                const type = isMain ? 'combat' : this._rollIntermediateType(cfg.typeRatios);
                nodes.push(this._createNode(col, row, colSpacing, rowSpacing, type));
            }
        }

        // Boss 列
        nodes.push(this._createNode(bossCol, mainRow, colSpacing, rowSpacing, 'boss'));

        // 奖励节点列
        nodes.push(this._createNode(rewardCol, mainRow, colSpacing, rowSpacing, 'reward'));

        // 建边
        const edges = this._buildEdges(nodes, totalCols);

        // 随机标记精英战斗节点
        const eliteCombatChance = DungeonConfig.getEliteCombatChance('zombie');
        for (const node of nodes) {
            if (node.type === 'combat') {
                node.eliteChance = eliteCombatChance;
                if (Math.random() < eliteCombatChance) {
                    node.isElite = true;
                }
            }
        }

        return { nodes, edges };
    }

    _createNode(col, row, colSpacing, rowSpacing, type) {
        return {
            id: `node_${col}_${row}`,
            col,
            row,
            x: colSpacing * (col + 1),
            y: rowSpacing * (row + 1),
            type,
            originalType: type,
            route: row,
            stage: col,
            completed: false,
            revealed: false
        };
    }

    /**
     * 随机选择中间列的行集合
     * 必须包含主通道行，再随机包含 1~rows-1 个其他行
     */
    _rollIntermediateRows(rows, mainRow) {
        const otherRows = [];
        for (let r = 0; r < rows; r++) {
            if (r !== mainRow) otherRows.push(r);
        }
        const count = 1 + Math.floor(Math.random() * otherRows.length);
        for (let i = otherRows.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [otherRows[i], otherRows[j]] = [otherRows[j], otherRows[i]];
        }
        const selected = otherRows.slice(0, count);
        selected.push(mainRow);
        return selected.sort((a, b) => a - b);
    }

    /** 按配置比例随机抽取中间节点类型 */
    _rollIntermediateType(ratios) {
        const roll = Math.random();
        const combatWeight = ratios?.combat ?? 0.7;
        return roll < combatWeight ? 'combat' : 'event';
    }

    /**
     * 调整中间列行集合，使总节点数落在配置区间内
     * 主通道行不会被移除
     */
    _adjustNodeCount(intermediateRowSets, rows, mainRow) {
        const cfg = this._genCfg;
        const min = cfg.nodeCount.min;
        const max = cfg.nodeCount.max;
        const fixedCount = 1 + 2; // 起点 + boss + reward

        const countNodes = () => fixedCount + intermediateRowSets.reduce((sum, rs) => sum + rs.selectedRows.length, 0);

        const otherRowsFor = () => {
            const all = [];
            for (let r = 0; r < rows; r++) {
                if (r !== mainRow) all.push(r);
            }
            return all;
        };

        // 先扩容：如果总数不足，向已有集合添加缺失的额外行
        let total = countNodes();
        while (total < min) {
            const candidates = intermediateRowSets.filter(rs => {
                const extras = rs.selectedRows.filter(r => r !== mainRow).length;
                return extras < rows - 1;
            });
            if (candidates.length === 0) break;
            const rs = candidates[Math.floor(Math.random() * candidates.length)];
            const missing = otherRowsFor().filter(r => !rs.selectedRows.includes(r));
            if (missing.length > 0) {
                rs.selectedRows.push(missing[Math.floor(Math.random() * missing.length)]);
                rs.selectedRows.sort((a, b) => a - b);
            }
            total = countNodes();
        }

        // 再缩容：如果总数过多，从有多余额外行的列中移除一个额外行
        while (total > max) {
            const candidates = intermediateRowSets.filter(rs => {
                const extras = rs.selectedRows.filter(r => r !== mainRow).length;
                return extras > 1;
            });
            if (candidates.length === 0) break;
            const rs = candidates[Math.floor(Math.random() * candidates.length)];
            const extras = rs.selectedRows.filter(r => r !== mainRow);
            const remove = extras[Math.floor(Math.random() * extras.length)];
            rs.selectedRows = rs.selectedRows.filter(r => r !== remove);
            total = countNodes();
        }
    }

    /** 构建水平/垂直边，确保无交叉 */
    _buildEdges(nodes, totalCols) {
        const nodeMap = new Map();
        for (const n of nodes) {
            nodeMap.set(n.id, n);
        }

        const edges = [];

        // 垂直边：同一列相邻行之间（双向）
        for (let col = 0; col < totalCols; col++) {
            const colNodes = nodes.filter(n => n.col === col).sort((a, b) => a.row - b.row);
            for (let i = 0; i < colNodes.length - 1; i++) {
                edges.push({ from: colNodes[i].id, to: colNodes[i + 1].id });
                edges.push({ from: colNodes[i + 1].id, to: colNodes[i].id });
            }
        }

        // 水平边：相邻列同一行之间（单向向右）
        for (let col = 0; col < totalCols - 1; col++) {
            const colNodes = nodes.filter(n => n.col === col);
            const nextColNodes = nodes.filter(n => n.col === col + 1);
            for (const node of colNodes) {
                const next = nextColNodes.find(n => n.row === node.row);
                if (next) {
                    edges.push({ from: node.id, to: next.id });
                }
            }
        }

        // 单一起点必须连接到第 1 列所有节点，形成 4 条分支
        const startNode = nodes.find(n => n.col === 0 && n.type === 'start');
        if (startNode) {
            const firstColNodes = nodes.filter(n => n.col === 1);
            for (const next of firstColNodes) {
                edges.push({ from: startNode.id, to: next.id });
            }
        }

        // 保险：确保相邻列之间至少有一条横向连接
        for (let col = 0; col < totalCols - 1; col++) {
            const hasHorizontal = edges.some(e => {
                const from = nodeMap.get(e.from);
                const to = nodeMap.get(e.to);
                return from && to && from.col === col && to.col === col + 1;
            });
            if (!hasHorizontal) {
                const colNodes = nodes.filter(n => n.col === col);
                const nextColNodes = nodes.filter(n => n.col === col + 1);
                if (colNodes.length > 0 && nextColNodes.length > 0) {
                    const c = colNodes[0];
                    const n = nextColNodes.reduce((best, curr) =>
                        Math.abs(curr.row - c.row) < Math.abs(best.row - c.row) ? curr : best
                    );
                    edges.push({ from: c.id, to: n.id });
                }
            }
        }

        return edges;
    }
}

// ==================== 战斗波次生成器 ====================
export class ZombieDungeonCombat {
    constructor(config = ZOMBIE_DUNGEON_CONFIG, isElite = false) {
        this.config = config;
        this._isElite = isElite;
        this._encounter = DungeonConfig.getZombieEncounterConfig(isElite);
        this._currentWave = 0;
        this._totalWaves = this._encounter.combatWaves;
    }

    reset() {
        this._currentWave = 0;
    }

    get isComplete() {
        return this._currentWave >= this._totalWaves;
    }

    get currentWave() {
        return this._currentWave;
    }

    get totalWaves() {
        return this._totalWaves;
    }

    /**
     * 生成下一波怪物配置（返回怪物类数组，尚未实例化）
     */
    nextWaveMonsterClasses() {
        if (this.isComplete) return [];
        this._currentWave++;

        const { monsterPool } = this.config;
        const monstersPerWave = this._encounter.monstersPerWave;
        const composition = this._encounter.monsterComposition;
        const classes = [];

        if (composition && typeof composition === 'object') {
            // 数据驱动固定配比：例如 { elite: 1, normal: 5 }
            for (const [tier, count] of Object.entries(composition)) {
                const pool = monsterPool[tier] || monsterPool.normal;
                for (let i = 0; i < count; i++) {
                    const MonsterClass = pool[Math.floor(Math.random() * pool.length)];
                    classes.push({ MonsterClass, tier });
                }
            }
            // 如果总数不足，用普通怪物补齐
            while (classes.length < monstersPerWave) {
                const pool = monsterPool.normal;
                const MonsterClass = pool[Math.floor(Math.random() * pool.length)];
                classes.push({ MonsterClass, tier: 'normal' });
            }
            // 打乱顺序，避免固定站位
            for (let i = classes.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [classes[i], classes[j]] = [classes[j], classes[i]];
            }
        } else {
            const guaranteeAtLeastOneElite = this._encounter.guaranteeAtLeastOneElite;
            for (let i = 0; i < monstersPerWave; i++) {
                const tier = this._rollTier();
                const pool = monsterPool[tier] || monsterPool.normal;
                const MonsterClass = pool[Math.floor(Math.random() * pool.length)];
                classes.push({ MonsterClass, tier });
            }

            // 确保至少一个精英
            if (guaranteeAtLeastOneElite && !classes.some(c => c.tier === 'elite')) {
                const idx = Math.floor(Math.random() * classes.length);
                const pool = monsterPool.elite || monsterPool.normal;
                classes[idx] = { MonsterClass: pool[Math.floor(Math.random() * pool.length)], tier: 'elite' };
            }
        }

        // 防御性兜底：精英战斗波次必须至少包含一只精英怪物，防止配置/池异常导致无精英
        if (this._isElite && !classes.some(c => c.tier === 'elite')) {
            const pool = monsterPool.elite || monsterPool.normal;
            const eliteClass = pool[Math.floor(Math.random() * pool.length)];
            if (classes.length > 0) {
                const idx = Math.floor(Math.random() * classes.length);
                classes[idx] = { MonsterClass: eliteClass, tier: 'elite' };
            } else {
                classes.push({ MonsterClass: eliteClass, tier: 'elite' });
            }
        }

        return classes;
    }

    /** 按 tier 权重随机抽取 */
    _rollTier() {
        const weights = this._encounter.tierWeights;
        const roll = Math.random();
        let cumulative = 0;
        for (const [tier, weight] of Object.entries(weights)) {
            cumulative += weight;
            if (roll < cumulative) return tier;
        }
        return 'normal';
    }
}

// ==================== NPC 小鼠大王（地牢商店） ====================
export class ZombieDungeonShop {
    /**
     * 打开地牢商店（NPC小鼠大王对话模式）
     */
    static open() {
        const mouseKingCfg = GAME_CONFIG.npcs?.shopMouseKing || {};
        const fakeNPC = {
            id: 'mouse_king_dungeon',
            name: mouseKingCfg.name || '小鼠大王',
            portrait: mouseKingCfg.portrait || 'assets/ui/npc_portrait.png',
            npcType: 'shop',
            getRandomGreeting() {
                const greetings = [
                    '欢迎来到僵尸地牢的分店！虽然环境差了点，但货还是一样的全。',
                    '能在这种地方遇到我，说明你的运气不错。买点什么？',
                    '小鼠大王的生意遍布各个世界，包括这个鬼地方。',
                    '外面的僵尸可不会跟你讨价还价，但我会。'
                ];
                return greetings[Math.floor(Math.random() * greetings.length)];
            }
        };

        if (NPCDialogue) {
            NPCDialogue.open(fakeNPC);
        } else {
            console.warn('[ZombieDungeonShop] NPCDialogue not available');
        }
    }

    /**
     * 检查商店是否关闭（用于地牢地图系统的轮询）
     */
    static isClosed() {
        return !(NPCDialogue._active || UIState.isOpen('shop') || UIState.isOpen('enhance') || UIState.isOpen('craft') || UIState.isOpen('enchant'));
    }
}

// ==================== 导出配置 ====================
export { ZOMBIE_DUNGEON_CONFIG };

// 便捷导出
export default {
    config: ZOMBIE_DUNGEON_CONFIG,
    MapGenerator: ZombieDungeonMapGenerator,
    Combat: ZombieDungeonCombat,
    Shop: ZombieDungeonShop
};
