
/**
 * ZombieDungeon — 僵尸地牢模块
 * 
 * 非交叉网格布局：4行 × 12列，水平/垂直边 only
 * 左侧4个起点（每行一个），右侧1个BOSS
 * 事件分布：战斗85% / 随机事件15%（无商店）
 * 战斗：3波，每波5只怪物，按 tier 概率生成（70%普通 / 20%精英 / 10%首领）
 */

import { Enemy } from '../entities/enemy.js';
import { SpitterZombie, FatZombie, FastZombie, ZombieDog } from '../entities/enemy-types.js';
import { UIState } from '../ui/ui-state.js';
import { NPCDialogue } from '../ui/npc-dialogue.js';

// ==================== 装甲僵尸工厂 ====================
function createArmoredZombie(x, y) {
    return new Enemy(x, y, {
        name: '装甲僵尸',
        hp: 200,
        maxHp: 200,
        size: 16,
        collisionRadius: 14,
        speed: 31.25,
        level: 5,
        color: '#7a8a9a',
        headColor: '#c0c8d0',
        highlightColor: 'rgba(122, 138, 154, 0.3)',
        str: 18,
        dex: 6,
        con: 20,
        int: 3,
        wis: 3,
        luck: 5,
        rank: 'normal',
        attackRange: 80,
        aiInterval: 2000,
        ai: { aggroRange: 9999, pacingRange: 120, loseTimeout: 3000 },
        attack: { type: 'thrust', cooldown: 1000, dynamicRange: 80, width: 20, damageMin: 6, damageMax: 12, knockback: 8 },
        showWeapon: false,
        equipShield: 'small_shield'
    });
}

// ==================== 怪物工厂 ====================
function createBasicZombie(x, y) {
    // 基础僵尸：使用 Enemy 类 + zombie 配置
    return new Enemy(x, y, {
        name: '僵尸',
        hp: 80,
        maxHp: 80,
        size: 14,
        collisionRadius: 12,
        speed: 31.25,
        level: 1,
        color: '#4a9a4a',
        highlightColor: 'rgba(74, 154, 74, 0.3)',
        str: 12,
        dex: 8,
        con: 12,
        int: 2,
        wis: 2,
        luck: 3,
        rank: 'normal',
        attackRange: 80,
        aiInterval: 2000,
        ai: { aggroRange: 9999, pacingRange: 100, loseTimeout: 3000 },
        attack: { type: 'thrust', cooldown: 1000, dynamicRange: 80, width: 20, damageMin: 5, damageMax: 10, knockback: 8 },
        showWeapon: false
    });
}


const ZOMBIE_DUNGEON_CONFIG = {
    name: '僵尸地牢',
    description: '被亡灵瘟疫侵蚀的地下墓穴，四条通道通向深处',

    // 路线配置
    routeCount: 4,
    minEventsPerRoute: 5,
    maxEventsPerRoute: 8,

    // 事件概率
    eventWeights: {
        combat: 0.85,
        random: 0.15
    },

    // 战斗波次
    combatWaves: 3,
    monstersPerWave: 5,

    // 怪物 tier 概率
    tierWeights: {
        normal: 0.80,
        elite: 0.20
    },

    // 怪物池（按 tier 分类）—— 使用工厂函数或类引用
    monsterPool: {
        normal: [createBasicZombie, FastZombie, ZombieDog, createArmoredZombie],
        elite: [SpitterZombie, FatZombie]
    },

    // 地图尺寸
    mapWidth: 2000,
    mapHeight: 1600,

    // 视觉配置
    typeColors: {
        start:  '#3a5a3a',
        combat: '#7a3a3a',
        shop:   '#3a5a7a',
        random: '#6a5a3a',
        boss:   '#7a0000',
        converge: '#5a3a5a'
    },
    typeBorderColors: {
        start:  '#6aca6a',
        combat: '#aa5a5a',
        shop:   '#5a8aaa',
        random: '#9a8a5a',
        boss:   '#aa0000',
        converge: '#8a5a8a'
    },
    typeIcons: {
        start:  '▶',
        combat: '⚔',
        shop:   '🏪',
        random: '?',
        boss:   '☠',
        converge: '◎'
    },
    typeLabels: {
        start:  '起点',
        combat: '战斗',
        shop:   '商店',
        random: '事件',
        boss:   'BOSS',
        converge: '汇合'
    }
};

// ==================== 路线生成器 ====================
export class ZombieDungeonMapGenerator {
    constructor(config = ZOMBIE_DUNGEON_CONFIG) {
        this.config = config;
    }

    /**
     * 生成地图节点和边
     * 非交叉网格布局：4行 × N列，水平/垂直边 only
     * 左侧4个起点（每行一个），右侧1个BOSS
     */
    generate() {
        const nodes = [];
        const edges = [];
        const { mapWidth, mapHeight } = this.config;

        const ROWS = 4;
        const COLS = 12;
        const colSpacing = mapWidth / (COLS + 1);
        const rowSpacing = mapHeight / (ROWS + 1);

        // 生成节点
        for (let col = 0; col < COLS; col++) {
            let type;
            if (col === 0) type = 'start';
            else if (col === COLS - 1) type = 'boss';
            else type = this._rollEventType();

            let selectedRows;
            if (col === 0) {
                // 起点：4行各一个
                selectedRows = [0, 1, 2, 3];
            } else if (col === COLS - 1) {
                // BOSS：单列中间
                selectedRows = [1];
            } else {
                // 中间列：确保第1、2行存在（主通道），随机添加第0、3行
                selectedRows = [1, 2];
                if (Math.random() > 0.4) selectedRows.push(0);
                if (Math.random() > 0.4) selectedRows.push(3);
                selectedRows = [...new Set(selectedRows)].sort((a, b) => a - b);
            }

            for (const row of selectedRows) {
                const x = colSpacing * (col + 1);
                const y = rowSpacing * (row + 1);
                nodes.push({
                    id: `node_${col}_${row}`,
                    col, row, x, y, type,
                    route: row,
                    stage: col
                });
            }
        }

        // 垂直边：同一列相邻行之间（双向）
        for (let col = 0; col < COLS; col++) {
            const colNodes = nodes.filter(n => n.col === col).sort((a, b) => a.row - b.row);
            for (let i = 0; i < colNodes.length - 1; i++) {
                edges.push({ from: colNodes[i].id, to: colNodes[i + 1].id });
                edges.push({ from: colNodes[i + 1].id, to: colNodes[i].id });
            }
        }

        // 水平边：相邻列同一行之间（单向，只能向右）
        for (let col = 0; col < COLS - 1; col++) {
            const colNodes = nodes.filter(n => n.col === col);
            const nextColNodes = nodes.filter(n => n.col === col + 1);
            for (const node of colNodes) {
                const nextNode = nextColNodes.find(n => n.row === node.row);
                if (nextNode) {
                    edges.push({ from: node.id, to: nextNode.id });
                }
            }
        }

        // 保险：确保相邻列之间至少有一条横向连接
        for (let col = 0; col < COLS - 1; col++) {
            const hasHorizontal = edges.some(e => {
                const fromNode = nodes.find(n => n.id === e.from);
                const toNode = nodes.find(n => n.id === e.to);
                return fromNode && toNode && fromNode.col === col && toNode.col === col + 1;
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

        return { nodes, edges };
    }

    /** 按权重随机抽取事件类型 */
    _rollEventType() {
        const weights = this.config.eventWeights;
        const roll = Math.random();
        let cumulative = 0;
        for (const [type, weight] of Object.entries(weights)) {
            cumulative += weight;
            if (roll < cumulative) return type;
        }
        return 'combat';
    }
}

// ==================== 战斗波次生成器 ====================
export class ZombieDungeonCombat {
    constructor(config = ZOMBIE_DUNGEON_CONFIG) {
        this.config = config;
        this._currentWave = 0;
        this._totalWaves = config.combatWaves;
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

        const { monstersPerWave, tierWeights, monsterPool } = this.config;
        const classes = [];

        for (let i = 0; i < monstersPerWave; i++) {
            const tier = this._rollTier();
            const pool = monsterPool[tier] || monsterPool.normal;
            const MonsterClass = pool[Math.floor(Math.random() * pool.length)];
            classes.push({ MonsterClass, tier });
        }
        return classes;
    }

    /** 按 tier 权重随机抽取 */
    _rollTier() {
        const weights = this.config.tierWeights;
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
        const fakeNPC = {
            id: 'mouse_king_dungeon',
            name: '小鼠大王',
            portrait: 'assets/portraits/mouse_attendant.png',
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

// ==================== 随机事件占位符 ====================
export class ZombieDungeonEvent {
    /**
     * 显示随机事件占位符UI
     */
    static show(callback) {
        const overlay = document.createElement('div');
        overlay.id = 'zombieDungeonEventOverlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.80); z-index: 8000;
            display: flex; align-items: center; justify-content: center;
            font-family: SimHei, "Microsoft YaHei", sans-serif; user-select: none;
        `;

        const panel = document.createElement('div');
        panel.style.cssText = `
            background: #2a2520; border: 2px solid #5a4a3a; border-radius: 10px;
            padding: 35px; max-width: 520px; width: 90%; color: #d4c5a9;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        `;

        const title = document.createElement('h3');
        title.textContent = '神秘事件';
        title.style.cssText = 'margin: 0 0 18px 0; color: #e8c878; font-size: 24px; text-align: center;';

        const text = document.createElement('p');
        text.textContent = '你在阴暗的走廊中发现了一些奇怪的痕迹，但暂时无法判断发生了什么。这里似乎曾经发生过某些事情……';
        text.style.cssText = 'margin: 0 0 28px 0; line-height: 1.7; font-size: 16px; text-align: center;';

        const placeholder = document.createElement('p');
        placeholder.textContent = '【随机事件系统开发中】';
        placeholder.style.cssText = 'margin: 0 0 20px 0; color: #8a7a6a; font-size: 14px; text-align: center; font-style: italic;';

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;';

        const btn = document.createElement('button');
        btn.textContent = '继续探索';
        btn.style.cssText = `
            padding: 12px 32px; background: #3a4530; border: 1px solid #5a6a4a;
            color: #d4c5a9; border-radius: 5px; cursor: pointer; font-size: 15px;
            transition: background 0.15s;
        `;
        btn.onmouseenter = () => btn.style.background = '#4a5540';
        btn.onmouseleave = () => btn.style.background = '#3a4530';
        btn.onclick = () => {
            overlay.remove();
            if (callback) callback();
        };
        btnRow.appendChild(btn);

        panel.appendChild(title);
        panel.appendChild(text);
        panel.appendChild(placeholder);
        panel.appendChild(btnRow);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
    }

    static cleanup() {
        const overlay = document.getElementById('zombieDungeonEventOverlay');
        if (overlay) overlay.remove();
    }
}

// ==================== 导出配置 ====================
export { ZOMBIE_DUNGEON_CONFIG };

// 便捷导出
export default {
    config: ZOMBIE_DUNGEON_CONFIG,
    MapGenerator: ZombieDungeonMapGenerator,
    Combat: ZombieDungeonCombat,
    Shop: ZombieDungeonShop,
    Event: ZombieDungeonEvent
};
