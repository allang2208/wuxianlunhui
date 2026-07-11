import { FloatingTextEffect } from '../effects/floating-text.js';
/**
 * ============================================================
 * DungeonEventSystem — 地牢随机事件系统
 * ============================================================
 *
 * 实现5种随机事件：
 * 1. 女神像：恢复/祝福(+15%攻击,3场)/奖励
 * 2. 陷阱：解除(敏捷)/跨越(体质)，失败扣25%血
 * 3. 补给堆：搜寻(精神)/探查(敏捷)
 * 4. 宝箱：50%金币/25%材料/25%战斗
 * 5. 恶魔雕像：扣50%血魔，+33%攻击或材料
 *
 * 属性检定公式：成功率 = 基础 + 属性×1%，上限95%，下限5%
 * Buff系统：女神祝福(+15%物攻/魔攻,3场) / 恶魔祈祷(+33%物攻/魔攻,永久)
 *
 * 依赖（全局）：
 *   EffectManager, FloatingTextEffect, StatusBar, Game, DungeonMapSystem
 */

// ==================== 配置对象 ====================
export const DUNGEON_EVENT_CONFIG = {
    // 属性检定
    attributeCheck: {
        baseSuccessRate: 20,      // 基础成功率20%
        attrMultiplier: 1,      // 每点属性+1%
        maxSuccessRate: 95,     // 上限95%
        minSuccessRate: 5,      // 下限5%
    },

    // 事件类型权重
    eventWeights: {
        goddessStatue: 1,
        trap: 1,
        supplyPile: 1,
        treasureChest: 1,
        demonStatue: 1,
    },

    // 女神像事件
    goddessStatue: {
        title: '古老女神像',
        description: '一尊散发着柔和光芒的女神像矗立在石台上，她的双手捧着一颗晶莹的水滴。',
        choices: [
            {
                id: 'heal',
                label: '祈求恢复',
                description: '恢复全部生命值和魔法值',
                type: 'heal',
            },
            {
                id: 'bless',
                label: '请求祝福',
                description: '获得女神祝福：+15%物攻/魔攻，持续3场战斗',
                type: 'bless',
            },
            {
                id: 'reward',
                label: '接受馈赠',
                description: '获得随机金币奖励（50-150）',
                type: 'reward',
            },
        ],
        healPercent: 100,       // 恢复百分比
        blessAtkPercent: 15,    // 祝福攻击加成%
        blessDuration: 3,       // 祝福持续战斗场数
        rewardMinGold: 50,      // 最小金币
        rewardMaxGold: 150,     // 最大金币
    },

    // 陷阱事件
    trap: {
        title: '古老陷阱',
        description: '前方的地面看起来不太对劲，隐约能看到细线连接着墙壁上的机关。',
        choices: [
            {
                id: 'disarm',
                label: '尝试解除',
                attribute: 'dex',   // 依赖敏捷
                baseRate: 20,
                successText: '你灵巧地剪断了触发线，陷阱被安全解除。',
                failText: '触发线突然断裂，锋利的刀片从墙壁射出！',
            },
            {
                id: 'cross',
                label: '强行跨越',
                attribute: 'con',   // 依赖体质
                baseRate: 20,
                successText: '你咬牙承受了毒箭的擦伤，成功通过了陷阱区域。',
                failText: '毒箭深深刺入你的肩膀，剧痛让你几乎昏厥！',
            },
        ],
        failDamagePercent: 25,  // 失败扣血%
    },

    // 补给堆事件
    supplyPile: {
        title: '冒险者遗物',
        description: '一堆散落的装备和包裹躺在角落，似乎是一位不幸的冒险者留下的。',
        choices: [
            {
                id: 'search',
                label: '仔细搜寻',
                attribute: 'wis',   // 依赖精神
                baseRate: 25,
                successText: '你在包裹夹层中发现了一瓶高级治疗药水！',
                failText: '你只找到了一些发霉的干粮。',
            },
            {
                id: 'inspect',
                label: '探查四周',
                attribute: 'dex',   // 依赖敏捷
                baseRate: 25,
                successText: '你发现了隐藏的暗格，里面有一些金币和材料！',
                failText: '暗格里的东西已经被搜刮一空了。',
                revealNodes: {
                    enabled: true,
                    description: '你还发现了周围道路的线索：',
                },
            },
        ],
        // 奖励配置
        successRewards: {
            search: [
                { type: 'hpPotion', min: 30, max: 50, chance: 0.6 },
                { type: 'mpPotion', min: 20, max: 40, chance: 0.4 },
            ],
            inspect: [
                { type: 'gold', min: 30, max: 80, chance: 0.7 },
                { type: 'material', min: 1, max: 3, chance: 0.3 },
            ],
        },
        // 探查巡逻成功时揭示相邻节点及其再下一层节点
        inspectRevealDepth: 2,
        failReward: { type: 'gold', min: 5, max: 15 },
    },

    // 宝箱事件
    treasureChest: {
        title: '神秘宝箱',
        description: '一个镶嵌着奇异符文的宝箱静静地放在石台上，散发着诱人的光芒。',
        outcomes: [
            { type: 'gold', chance: 0.50, amount: 500 },
            { type: 'materials', chance: 0.25, rewards: [
                { type: 'enhancement_stone', count: 1 },
                { type: 'reforge_ticket', count: 1 },
                { type: 'magic_dust', count: 200 },
            ]},
            { type: 'combat', chance: 0.25 },
        ],
        combatText: '宝箱突然张开，里面钻出了一只宝箱怪！',
    },

    // 恶魔雕像事件
    demonStatue: {
        title: '恶魔雕像',
        description: '一尊狰狞的恶魔雕像散发着暗红色的光芒，它的眼睛似乎在注视着你。',
        choices: [
            {
                id: 'sacrifice',
                label: '献祭血魔',
                description: '失去50%当前生命值和魔法值',
                type: 'sacrifice',
            },
            {
                id: 'leave',
                label: '离开',
                description: '什么都不发生',
                type: 'leave',
            },
        ],
        sacrificeHpPercent: 50,     // 献祭扣血%
        sacrificeMpPercent: 50,     // 献祭扣魔%
        rewardTypeWeights: {
            attackBuff: 0.5,          // 50%概率获得攻击buff
            materials: 0.5,           // 50%概率获得材料
        },
        demonBuffAtkPercent: 33,    // 恶魔祈祷攻击加成%
    },

    // 材料类型（用于奖励）
    materialTypes: [
        '铁矿石', '皮革碎片', '魔法粉尘', '古老木材', '精金碎片',
    ],

    // 强化石、改造券、魔法粉尘的物品配置（用于宝箱奖励）
    specialItems: {
        enhancement_stone: {
            name: '强化石',
            icon: '💎',
            category: 'enhancement',
        },
        reforge_ticket: {
            name: '改造券',
            icon: '🎫',
            category: 'enhancement',
        },
        magic_dust: {
            name: '魔法粉尘',
            icon: '✨',
            category: 'material',
        },
    },
};

// ==================== Buff系统 ====================

/**
 * 地牢Buff管理器
 * 管理女神祝福和恶魔祈祷等临时/永久buff
 */
export const DungeonBuffSystem = {
    // Buff类型配置
    BUFF_CONFIG: {
        goddessBless: {
            name: '女神祝福',
            icon: '✨',
            color: '#e8c878',
            description: '物攻/魔攻 +15%',
        },
        demonPrayer: {
            name: '恶魔祈祷',
            icon: '🔥',
            color: '#9a3a3a',
            description: '物攻/魔攻 +33%',
        },
    },

    /**
     * 为玩家添加女神祝福
     * @param {Player} player - 玩家对象
     * @param {number} battles - 持续战斗场数
     */
    applyGoddessBless(player, battles = 3) {
        if (!player || !player.data) return false;

        // 初始化buff存储
        if (!player._dungeonBuffs) player._dungeonBuffs = {};

        player._dungeonBuffs.goddessBless = {
            type: 'goddessBless',
            remainingBattles: battles,
            atkPercent: DUNGEON_EVENT_CONFIG.goddessStatue.blessAtkPercent,
        };

        // 添加状态栏效果
        if (typeof StatusBar !== 'undefined') {
            StatusBar.addEffect('goddessBless', 999999, {
                icon: this.BUFF_CONFIG.goddessBless.icon,
                name: `${this.BUFF_CONFIG.goddessBless.name} (${battles}场)`,
                color: this.BUFF_CONFIG.goddessBless.color,
            });
        }

        // 添加实体状态效果
        if (player.addStatusEffect) {
            player.addStatusEffect('buff', 999999, {
                icon: '✨',
                name: `女神祝福 ${battles}场`,
                color: '#e8c878',
            });
        }

        // 重新计算属性
        if (player.calculateCombatStats) {
            player.calculateCombatStats();
        }

        return true;
    },

    /**
     * 为玩家添加恶魔祈祷
     * @param {Player} player - 玩家对象
     */
    applyDemonPrayer(player) {
        if (!player || !player.data) return false;

        if (!player._dungeonBuffs) player._dungeonBuffs = {};

        player._dungeonBuffs.demonPrayer = {
            type: 'demonPrayer',
            permanent: true,
            atkPercent: DUNGEON_EVENT_CONFIG.demonStatue.demonBuffAtkPercent,
        };

        // 添加状态栏效果（永久显示）
        if (typeof StatusBar !== 'undefined') {
            StatusBar.addEffect('demonPrayer', 999999, {
                icon: this.BUFF_CONFIG.demonPrayer.icon,
                name: this.BUFF_CONFIG.demonPrayer.name,
                color: this.BUFF_CONFIG.demonPrayer.color,
            });
        }

        // 添加实体状态效果
        if (player.addStatusEffect) {
            player.addStatusEffect('buff', 999999, {
                icon: '🔥',
                name: '恶魔祈祷',
                color: '#9a3a3a',
            });
        }

        // 重新计算属性
        if (player.calculateCombatStats) {
            player.calculateCombatStats();
        }

        return true;
    },

    /**
     * 消耗一场女神祝福
     * @param {Player} player - 玩家对象
     * @returns {boolean} 是否还有剩余层数
     */
    consumeGoddessBless(player) {
        if (!player || !player._dungeonBuffs || !player._dungeonBuffs.goddessBless) {
            return false;
        }

        const buff = player._dungeonBuffs.goddessBless;
        buff.remainingBattles--;

        if (buff.remainingBattles <= 0) {
            // 移除buff
            delete player._dungeonBuffs.goddessBless;

            // 移除状态栏效果
            if (typeof StatusBar !== 'undefined') {
                StatusBar.removeEffectByType('goddessBless');
            }

            // 移除实体状态效果
            if (player.removeStatusEffect) {
                player.removeStatusEffect('buff');
            }

            // 重新计算属性
            if (player.calculateCombatStats) {
                player.calculateCombatStats();
            }

            return false;
        }

        // 更新状态栏显示
        if (typeof StatusBar !== 'undefined') {
            const effect = StatusBar.effects.find(e => e.type === 'goddessBless');
            if (effect) {
                effect.name = `${this.BUFF_CONFIG.goddessBless.name} (${buff.remainingBattles}场)`;
                StatusBar.render();
            }
        }

        return true;
    },

    /**
     * 获取当前攻击加成百分比
     * @param {Player} player - 玩家对象
     * @returns {number} 总攻击加成百分比
     */
    getAtkBonusPercent(player) {
        if (!player || !player._dungeonBuffs) return 0;

        let total = 0;
        const buffs = player._dungeonBuffs;

        if (buffs.goddessBless) {
            total += buffs.goddessBless.atkPercent || 0;
        }
        if (buffs.demonPrayer) {
            total += buffs.demonPrayer.atkPercent || 0;
        }

        return total;
    },

    /**
     * 清除所有地牢buff
     * @param {Player} player - 玩家对象
     */
    clearAllBuffs(player) {
        if (!player) return;

        delete player._dungeonBuffs;

        // 移除状态栏效果
        if (typeof StatusBar !== 'undefined') {
            StatusBar.removeEffectByType('goddessBless');
            StatusBar.removeEffectByType('demonPrayer');
        }

        // 移除实体状态效果
        if (player.removeStatusEffect) {
            player.removeStatusEffect('buff');
        }

        // 重新计算属性
        if (player.calculateCombatStats) {
            player.calculateCombatStats();
        }
    },

    /**
     * 检查玩家是否有指定buff
     * @param {Player} player - 玩家对象
     * @param {string} buffType - buff类型
     * @returns {boolean}
     */
    hasBuff(player, buffType) {
        return !!(player && player._dungeonBuffs && player._dungeonBuffs[buffType]);
    },
};

// ==================== 属性检定系统 ====================

/**
 * 属性检定工具
 */
export const AttributeCheckSystem = {
    /**
     * 执行属性检定
     * @param {Player} player - 玩家对象
     * @param {string} attribute - 属性名 'str'|'dex'|'con'|'int'|'wis'|'luck'
     * @param {number} baseRate - 基础成功率
     * @returns {Object} { success: boolean, rate: number, roll: number }
     */
    check(player, attribute, baseRate = 20) {
        const config = DUNGEON_EVENT_CONFIG.attributeCheck;

        // 获取属性值
        let attrValue = 0;
        if (player && player.data) {
            attrValue = player.data[attribute] || 0;
        }

        // 计算成功率
        let successRate = baseRate + attrValue * config.attrMultiplier;
        successRate = Math.max(config.minSuccessRate, Math.min(config.maxSuccessRate, successRate));

        // 随机判定
        const roll = Math.random() * 100;
        const success = roll < successRate;

        return {
            success,
            rate: successRate,
            roll,
            attribute,
            attrValue,
        };
    },

    /**
     * 获取检定描述文本
     * @param {Object} result - 检定结果
     * @returns {string}
     */
    getResultText(result) {
        const attrNames = {
            str: '力量', dex: '敏捷', con: '体质',
            int: '智力', wis: '精神', luck: '幸运',
        };
        const attrName = attrNames[result.attribute] || result.attribute;

        if (result.success) {
            return `【成功】${attrName}检定：${result.attrValue}点 → ${result.rate.toFixed(1)}% 成功率，掷出 ${result.roll.toFixed(1)}`;
        } else {
            return `【失败】${attrName}检定：${result.attrValue}点 → ${result.rate.toFixed(1)}% 成功率，掷出 ${result.roll.toFixed(1)}`;
        }
    },
};

// ==================== 事件处理器 ====================

/**
 * 事件结果对象
 * @typedef {Object} EventResult
 * @property {string} type - 结果类型
 * @property {string} text - 结果描述
 * @property {Object} rewards - 获得的奖励
 * @property {boolean} combat - 是否触发战斗
 */

/**
 * 女神像事件处理器
 */
function handleGoddessStatue(player, choiceId) {
    const config = DUNGEON_EVENT_CONFIG.goddessStatue;
    const choice = config.choices.find(c => c.id === choiceId);

    if (!choice) return { type: 'none', text: '无效选择', rewards: {} };

    switch (choice.type) {
        case 'heal': {
            if (player && player.data) {
                const oldHp = player.data.hp;
                const oldMp = player.data.mp;
                player.data.hp = player.data.maxHp;
                player.data.mp = player.data.maxMp;

                return {
                    type: 'heal',
                    text: `女神的光芒笼罩了你，生命值和魔法值完全恢复！（HP: ${oldHp}→${player.data.hp}, MP: ${oldMp}→${player.data.mp}）`,
                    rewards: { hp: player.data.maxHp - oldHp, mp: player.data.maxMp - oldMp },
                };
            }
            return { type: 'heal', text: '生命值和魔法值已恢复', rewards: {} };
        }

        case 'bless': {
            DungeonBuffSystem.applyGoddessBless(player, config.blessDuration);
            return {
                type: 'bless',
                text: `女神赐予你祝福！物攻/魔攻 +${config.blessAtkPercent}%，持续${config.blessDuration}场战斗。`,
                rewards: { buff: 'goddessBless' },
            };
        }

        case 'reward': {
            const gold = config.rewardMinGold + Math.floor(Math.random() * (config.rewardMaxGold - config.rewardMinGold + 1));
            return {
                type: 'gold',
                text: `女神像底座打开，露出了 ${gold} 金币！`,
                rewards: { gold },
            };
        }

        default:
            return { type: 'none', text: '什么都没有发生', rewards: {} };
    }
}

/**
 * 陷阱事件处理器
 */
function handleTrap(player, choiceId) {
    const config = DUNGEON_EVENT_CONFIG.trap;
    const choice = config.choices.find(c => c.id === choiceId);

    if (!choice) return { type: 'none', text: '无效选择', rewards: {} };

    // 执行属性检定
    const checkResult = AttributeCheckSystem.check(player, choice.attribute, choice.baseRate);

    if (checkResult.success) {
        return {
            type: 'success',
            text: `${choice.successText}\n${AttributeCheckSystem.getResultText(checkResult)}`,
            rewards: {},
            checkResult,
        };
    } else {
        // 失败扣血
        let damageText = '';
        if (player && player.data) {
            const damage = Math.floor(player.data.maxHp * (config.failDamagePercent / 100));
            player.data.hp = Math.max(1, player.data.hp - damage);
            damageText = `受到 ${damage} 点伤害！（HP: ${player.data.hp}/${player.data.maxHp}）`;
        }

        return {
            type: 'fail',
            text: `${choice.failText}\n${AttributeCheckSystem.getResultText(checkResult)}\n${damageText}`,
            rewards: {},
            damage: config.failDamagePercent,
            checkResult,
        };
    }
}

/**
 * 补给堆事件处理器
 */
function handleSupplyPile(player, choiceId, dungeonMapSystem) {
    const config = DUNGEON_EVENT_CONFIG.supplyPile;
    const choice = config.choices.find(c => c.id === choiceId);

    if (!choice) return { type: 'none', text: '无效选择', rewards: {} };

    // 执行属性检定
    const checkResult = AttributeCheckSystem.check(player, choice.attribute, choice.baseRate);

    if (checkResult.success) {
        // 成功奖励
        const rewards = {};
        let text = choice.successText;

        const rewardConfig = config.successRewards[choice.id];
        if (rewardConfig) {
            for (const reward of rewardConfig) {
                if (Math.random() < reward.chance) {
                    const amount = reward.min + Math.floor(Math.random() * (reward.max - reward.min + 1));
                    if (reward.type === 'gold') {
                        rewards.gold = amount;
                        text += `\n获得 ${amount} 金币！`;
                    } else if (reward.type === 'hpPotion') {
                        rewards.hpPotion = amount;
                        text += `\n获得治疗药水（恢复${amount}HP）！`;
                    } else if (reward.type === 'mpPotion') {
                        rewards.mpPotion = amount;
                        text += `\n获得魔法药水（恢复${amount}MP）！`;
                    } else if (reward.type === 'material') {
                        const materialType = DUNGEON_EVENT_CONFIG.materialTypes[
                            Math.floor(Math.random() * DUNGEON_EVENT_CONFIG.materialTypes.length)
                        ];
                        rewards.material = { type: materialType, count: amount };
                        text += `\n获得 ${materialType} x${amount}！`;
                    }
                }
            }
        }

        // 探查巡逻：显示相邻节点及其再下一层节点的内容
        if (choice.id === 'inspect' && dungeonMapSystem) {
            const revealedInfo = getRevealedNodeInfo(dungeonMapSystem);
            if (revealedInfo) {
                text += `\n\n${choice.revealNodes?.description || '你还发现了周围道路的线索：'}\n${revealedInfo}`;
            }
        }

        return {
            type: 'success',
            text: `${text}\n${AttributeCheckSystem.getResultText(checkResult)}`,
            rewards,
            checkResult,
        };
    } else {
        // 失败也有少量安慰奖
        const failReward = config.failReward;
        const amount = failReward.min + Math.floor(Math.random() * (failReward.max - failReward.min + 1));

        return {
            type: 'fail',
            text: `${choice.failText}\n${AttributeCheckSystem.getResultText(checkResult)}\n不过你还是找到了 ${amount} 金币。`,
            rewards: { gold: amount },
            checkResult,
        };
    }
}

/**
 * 获取探查巡逻揭示的节点信息
 * 显示相邻前后左右节点及其再之后两个节点的内容
 * @param {Object} dungeonMapSystem - 地牢地图系统实例
 * @returns {string|null} 节点信息文本
 */
function getRevealedNodeInfo(dungeonMapSystem) {
    if (!dungeonMapSystem || !dungeonMapSystem.nodes || !dungeonMapSystem.edges || !dungeonMapSystem.currentNodeId) {
        return null;
    }

    const currentNode = dungeonMapSystem.nodes.find(n => n.id === dungeonMapSystem.currentNodeId);
    if (!currentNode) return null;

    // 获取相邻节点（直接连接的节点）
    const adjacentIds = new Set();
    const adjacentEdges = dungeonMapSystem.edges.filter(e => e.from === currentNode.id || e.to === currentNode.id);
    for (const edge of adjacentEdges) {
        const adjacentId = edge.from === currentNode.id ? edge.to : edge.from;
        adjacentIds.add(adjacentId);
    }

    // 获取再下一层节点（相邻节点的相邻节点，排除当前节点和已访问的）
    const secondLayerIds = new Set();
    for (const adjId of adjacentIds) {
        const adjNode = dungeonMapSystem.nodes.find(n => n.id === adjId);
        if (!adjNode) continue;

        const deeperEdges = dungeonMapSystem.edges.filter(e => e.from === adjId || e.to === adjId);
        for (const edge of deeperEdges) {
            const deeperId = edge.from === adjId ? edge.to : edge.from;
            // 排除当前节点和第一层相邻节点
            if (deeperId !== currentNode.id && !adjacentIds.has(deeperId)) {
                secondLayerIds.add(deeperId);
            }
        }
    }

    // 限制最多显示6个节点（4个相邻 + 2个再下一层）
    const allRevealedIds = [...adjacentIds].slice(0, 4);
    const remainingSlots = 6 - allRevealedIds.length;
    if (remainingSlots > 0) {
        const secondLayerArray = [...secondLayerIds].slice(0, remainingSlots);
        allRevealedIds.push(...secondLayerArray);
    }

    // 生成节点信息文本
    const typeLabels = {
        combat: '⚔ 战斗',
        event: '? 事件',
        boss: '☠ Boss',
        reward: '💎 奖励',
        empty: '· 空',
        start: '▶ 起点',
    };

    const lines = [];
    for (const nodeId of allRevealedIds) {
        const node = dungeonMapSystem.nodes.find(n => n.id === nodeId);
        if (!node) continue;
        const label = typeLabels[node.type] || `? ${node.type}`;
        lines.push(`  • ${label}`);
    }

    if (lines.length === 0) return null;
    return lines.join('\n');
}

/**
 * 宝箱事件处理器
 */
function handleTreasureChest() {
    const config = DUNGEON_EVENT_CONFIG.treasureChest;

    // 随机决定结果
    const roll = Math.random();
    let cumulative = 0;
    let outcome = null;

    for (const o of config.outcomes) {
        cumulative += o.chance;
        if (roll < cumulative) {
            outcome = o;
            break;
        }
    }

    // 默认金币
    if (!outcome) outcome = config.outcomes[0];

    switch (outcome.type) {
        case 'gold': {
            const gold = outcome.amount;
            return {
                type: 'gold',
                text: `宝箱里装满了金币！你获得了 ${gold} 金币。`,
                rewards: { gold },
            };
        }

        case 'materials': {
            const rewards = {};
            let text = '宝箱里放着一些珍贵的材料：';
            const parts = [];
            for (const item of outcome.rewards) {
                if (item.type === 'enhancement_stone') {
                    rewards.enhancementStone = item.count;
                    parts.push(`${item.count} 颗强化石`);
                } else if (item.type === 'reforge_ticket') {
                    rewards.reforgeTicket = item.count;
                    parts.push(`${item.count} 张改造券`);
                } else if (item.type === 'magic_dust') {
                    rewards.magicDust = item.count;
                    parts.push(`${item.count} 魔法粉尘`);
                }
            }
            text += parts.join('、') + '。';
            return {
                type: 'materials',
                text,
                rewards,
            };
        }

        case 'combat': {
            return {
                type: 'combat',
                text: config.combatText,
                rewards: {},
                combat: true,
            };
        }

        default:
            return { type: 'none', text: '宝箱是空的。', rewards: {} };
    }
}

/**
 * 恶魔雕像事件处理器
 */
function handleDemonStatue(player, choiceId) {
    const config = DUNGEON_EVENT_CONFIG.demonStatue;

    if (choiceId === 'leave') {
        return {
            type: 'none',
            text: '你感觉到一股不祥的气息，决定离开这里。',
            rewards: {},
        };
    }

    if (choiceId === 'sacrifice') {
        if (!player || !player.data) {
            return { type: 'none', text: '无法献祭', rewards: {} };
        }

        // 扣血扣魔
        const hpLoss = Math.floor(player.data.hp * (config.sacrificeHpPercent / 100));
        const mpLoss = Math.floor(player.data.mp * (config.sacrificeMpPercent / 100));
        const oldHp = player.data.hp;
        const oldMp = player.data.mp;

        player.data.hp = Math.max(1, player.data.hp - hpLoss);
        player.data.mp = Math.max(0, player.data.mp - mpLoss);

        // 随机奖励
        const rewardRoll = Math.random();
        const weights = config.rewardTypeWeights;
        let rewardText = '';
        const rewards = {};

        if (rewardRoll < weights.attackBuff) {
            // 获得恶魔祈祷buff
            DungeonBuffSystem.applyDemonPrayer(player);
            rewardText = `恶魔接受了你的献祭！\n获得恶魔祈祷：物攻/魔攻 +${config.demonBuffAtkPercent}%（永久）`;
            rewards.buff = 'demonPrayer';
        } else {
            // 获得材料
            const materialType = DUNGEON_EVENT_CONFIG.materialTypes[
                Math.floor(Math.random() * DUNGEON_EVENT_CONFIG.materialTypes.length)
            ];
            const count = 2 + Math.floor(Math.random() * 4);
            rewards.material = { type: materialType, count };
            rewardText = `恶魔接受了你的献祭！\n获得 ${materialType} x${count}`;
        }

        return {
            type: 'sacrifice',
            text: `你割破手掌，鲜血滴落在雕像上……\n失去 ${hpLoss} HP 和 ${mpLoss} MP（HP: ${oldHp}→${player.data.hp}, MP: ${oldMp}→${player.data.mp}）\n${rewardText}`,
            rewards,
        };
    }

    return { type: 'none', text: '无效选择', rewards: {} };
}

// ==================== 主事件系统 ====================

/**
 * 地牢随机事件系统
 */
export const DungeonEventSystem = {
    // 当前事件
    _currentEvent: null,
    _currentEventType: null,
    _eventOverlay: null,
    _onComplete: null,
    _dungeonMapSystem: null, // 地牢地图系统引用（用于探查巡逻）

    /**
     * 随机选择一个事件类型
     * @returns {string} 事件类型
     */
    rollEventType() {
        const weights = DUNGEON_EVENT_CONFIG.eventWeights;
        const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
        const roll = Math.random() * totalWeight;

        let cumulative = 0;
        for (const [type, weight] of Object.entries(weights)) {
            cumulative += weight;
            if (roll < cumulative) return type;
        }

        return 'goddessStatue';
    },

    /**
     * 获取事件配置
     * @param {string} eventType - 事件类型
     * @returns {Object|null}
     */
    getEventConfig(eventType) {
        return DUNGEON_EVENT_CONFIG[eventType] || null;
    },

    /**
     * 触发随机事件
     * @param {Player} player - 玩家对象
     * @param {Function} onComplete - 完成回调
     * @param {string|null} forcedType - 强制指定事件类型（用于测试）
     * @param {Object} dungeonMapSystem - 地牢地图系统实例（用于探查巡逻）
     * @returns {Object} 事件对象
     */
    trigger(player, onComplete, forcedType = null, dungeonMapSystem = null) {
        const eventType = forcedType || this.rollEventType();
        const config = this.getEventConfig(eventType);

        if (!config) {
            console.warn(`[DungeonEventSystem] Unknown event type: ${eventType}`);
            if (onComplete) onComplete({ type: 'none', text: '未知事件', rewards: {} });
            return null;
        }

        this._currentEventType = eventType;
        this._currentEvent = config;
        this._onComplete = onComplete;
        this._dungeonMapSystem = dungeonMapSystem; // 保存地牢地图系统引用

        // 显示事件UI
        this._showEventUI(eventType, config, player);

        return { type: eventType, config };
    },

    /**
     * 处理玩家选择
     * @param {string} choiceId - 选择ID
     * @param {Player} player - 玩家对象
     */
    handleChoice(choiceId, player) {
        if (!this._currentEventType || !this._currentEvent) return;

        let result;

        switch (this._currentEventType) {
            case 'goddessStatue':
                result = handleGoddessStatue(player, choiceId);
                break;
            case 'trap':
                result = handleTrap(player, choiceId);
                break;
            case 'supplyPile':
                result = handleSupplyPile(player, choiceId, this._dungeonMapSystem);
                break;
            case 'treasureChest':
                result = handleTreasureChest();
                break;
            case 'demonStatue':
                result = handleDemonStatue(player, choiceId);
                break;
            default:
                result = { type: 'none', text: '未知事件', rewards: {} };
        }

        // 显示结果
        this._showResultUI(result, player);

        // 应用奖励（金币等）
        this._applyRewards(result, player);
    },

    /**
     * 应用奖励到玩家
     * @param {EventResult} result - 事件结果
     * @param {Player} player - 玩家对象
     */
    _applyRewards(result, player) {
        if (!result.rewards) return;

        // 金币奖励
        if (result.rewards.gold && typeof Game !== 'undefined' && Game.player && Game.player.data) {
            Game.player.data.gold = (Game.player.data.gold || 0) + result.rewards.gold;
        }

        // 治疗药水（直接恢复）
        if (result.rewards.hpPotion && player && player.data) {
            player.data.hp = Math.min(player.data.maxHp, player.data.hp + result.rewards.hpPotion);
        }
        if (result.rewards.mpPotion && player && player.data) {
            player.data.mp = Math.min(player.data.maxMp, player.data.mp + result.rewards.mpPotion);
        }

        // 材料奖励（添加到背包）
        if (result.rewards.material && typeof Game !== 'undefined' && Game.dropItem) {
            const { type, count } = result.rewards.material;
            for (let i = 0; i < count; i++) {
                const item = {
                    name: type,
                    category: 'material',
                    icon: '💎',
                    stack: 1,
                };
                Game.dropItem(player.x, player.y, item);
            }
        }

        // 宝箱特殊材料奖励：强化石、改造券、魔法粉尘
        if (result.rewards.enhancementStone && typeof Game !== 'undefined' && Game.dropItem) {
            const item = { ...DUNGEON_EVENT_CONFIG.specialItems.enhancement_stone, stack: result.rewards.enhancementStone };
            Game.dropItem(player.x, player.y, item);
        }
        if (result.rewards.reforgeTicket && typeof Game !== 'undefined' && Game.dropItem) {
            const item = { ...DUNGEON_EVENT_CONFIG.specialItems.reforge_ticket, stack: result.rewards.reforgeTicket };
            Game.dropItem(player.x, player.y, item);
        }
        if (result.rewards.magicDust && typeof Game !== 'undefined' && Game.dropItem) {
            const item = { ...DUNGEON_EVENT_CONFIG.specialItems.magic_dust, stack: result.rewards.magicDust };
            Game.dropItem(player.x, player.y, item);
        }
    },

    /**
     * 显示事件UI
     */
    _showEventUI(eventType, config, player) {
        this._cleanupUI();

        const overlay = document.createElement('div');
        overlay.id = 'dungeonEventSystemOverlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.85); z-index: 8000;
            display: flex; align-items: center; justify-content: center;
            font-family: SimHei, "Microsoft YaHei", sans-serif; user-select: none;
        `;

        const panel = document.createElement('div');
        panel.style.cssText = `
            background: #2a2520; border: 2px solid #5a4a3a; border-radius: 10px;
            padding: 35px; max-width: 560px; width: 90%; color: #d4c5a9;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        `;

        // 标题
        const title = document.createElement('h3');
        title.textContent = config.title;
        title.style.cssText = 'margin: 0 0 18px 0; color: #e8c878; font-size: 24px; text-align: center;';

        // 描述
        const text = document.createElement('p');
        text.textContent = config.description;
        text.style.cssText = 'margin: 0 0 28px 0; line-height: 1.7; font-size: 16px; text-align: center;';

        // 选择按钮
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;';

        // 根据不同事件类型生成选择
        if (config.choices) {
            for (const choice of config.choices) {
                const btn = this._createChoiceButton(choice, player, overlay);
                btnRow.appendChild(btn);
            }
        }

        // 宝箱特殊处理（直接开启）
        if (eventType === 'treasureChest') {
            const btn = document.createElement('button');
            btn.textContent = '打开宝箱';
            btn.style.cssText = `
                padding: 12px 32px; background: #3a4530; border: 1px solid #5a6a4a;
                color: #d4c5a9; border-radius: 5px; cursor: pointer; font-size: 15px;
                transition: background 0.15s;
            `;
            btn.onmouseenter = () => btn.style.background = '#4a5540';
            btn.onmouseleave = () => btn.style.background = '#3a4530';
            btn.onclick = () => this.handleChoice('open', player);
            btnRow.appendChild(btn);
        }

        panel.appendChild(title);
        panel.appendChild(text);
        panel.appendChild(btnRow);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        this._eventOverlay = overlay;
    },

    /**
     * 创建选择按钮
     */
    _createChoiceButton(choice, player, overlay) {
        const btn = document.createElement('button');

        // 构建按钮文本（包含属性检定提示）
        let btnText = choice.label;
        if (choice.attribute) {
            const attrNames = { str: '力', dex: '敏', con: '体', int: '智', wis: '精', luck: '幸' };
            const attrName = attrNames[choice.attribute] || choice.attribute;

            // 计算实际成功率
            const checkResult = AttributeCheckSystem.check(player, choice.attribute, choice.baseRate || 20);
            btnText += ` (${attrName} ${checkResult.attrValue} | ${checkResult.rate.toFixed(0)}%)`;
        }

        btn.textContent = btnText;
        btn.style.cssText = `
            padding: 12px 24px; background: #3a4530; border: 1px solid #5a6a4a;
            color: #d4c5a9; border-radius: 5px; cursor: pointer; font-size: 14px;
            transition: background 0.15s; min-width: 140px; text-align: center;
        `;
        btn.onmouseenter = () => btn.style.background = '#4a5540';
        btn.onmouseleave = () => btn.style.background = '#3a4530';
        btn.onclick = () => this.handleChoice(choice.id, player);

        return btn;
    },

    /**
     * 显示结果UI
     */
    _showResultUI(result, player) {
        // 清除旧UI
        this._cleanupUI();

        const overlay = document.createElement('div');
        overlay.id = 'dungeonEventResultOverlay';
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.85); z-index: 8000;
            display: flex; align-items: center; justify-content: center;
            font-family: SimHei, "Microsoft YaHei", sans-serif; user-select: none;
        `;

        const panel = document.createElement('div');
        panel.style.cssText = `
            background: #2a2520; border: 2px solid #5a4a3a; border-radius: 10px;
            padding: 35px; max-width: 560px; width: 90%; color: #d4c5a9;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        `;

        // 结果图标
        const iconMap = {
            success: '✅', fail: '❌', heal: '💚', bless: '✨', gold: '💰',
            material: '💎', combat: '⚔️', sacrifice: '🔥', none: '➡️',
        };
        const icon = iconMap[result.type] || '❓';

        // 标题
        const title = document.createElement('h3');
        title.textContent = `${icon} 事件结果`;
        title.style.cssText = 'margin: 0 0 18px 0; color: #e8c878; font-size: 24px; text-align: center;';

        // 结果文本
        const text = document.createElement('p');
        text.innerHTML = result.text.replace(/\n/g, '<br>');
        text.style.cssText = 'margin: 0 0 28px 0; line-height: 1.7; font-size: 16px; text-align: center;';

        // 继续按钮
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;';

        const btn = document.createElement('button');
        btn.textContent = result.combat ? '进入战斗！' : '继续探索';
        btn.style.cssText = `
            padding: 12px 32px; background: ${result.combat ? '#7a3a3a' : '#3a4530'};
            border: 1px solid ${result.combat ? '#9a5a5a' : '#5a6a4a'};
            color: #d4c5a9; border-radius: 5px; cursor: pointer; font-size: 15px;
            transition: background 0.15s;
        `;
        btn.onmouseenter = () => btn.style.background = result.combat ? '#9a5a5a' : '#4a5540';
        btn.onmouseleave = () => btn.style.background = result.combat ? '#7a3a3a' : '#3a4530';
        btn.onclick = () => {
            this._cleanupUI();
            if (this._onComplete) {
                this._onComplete(result);
            }
        };
        btnRow.appendChild(btn);

        panel.appendChild(title);
        panel.appendChild(text);
        panel.appendChild(btnRow);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        this._eventOverlay = overlay;

        // 显示浮动文字效果
        if (typeof EffectManager !== 'undefined') {
            const color = result.type === 'success' || result.type === 'heal' || result.type === 'bless'
                ? '#44ff44' : result.type === 'fail' ? '#ff4444' : '#ffd700';
            EffectManager.add(new FloatingTextEffect(512, 400, result.text.split('\n')[0], color));
        }
    },

    /**
     * 清理UI
     */
    _cleanupUI() {
        if (this._eventOverlay) {
            this._eventOverlay.remove();
            this._eventOverlay = null;
        }
    },

    /**
     * 强制清理所有事件UI
     */
    cleanup() {
        this._cleanupUI();
        this._currentEvent = null;
        this._currentEventType = null;
        this._onComplete = null;
        this._dungeonMapSystem = null;
    },

    /**
     * 获取当前事件类型
     * @returns {string|null}
     */
    getCurrentEventType() {
        return this._currentEventType;
    },

    /**
     * 检查是否有活跃事件
     * @returns {boolean}
     */
    isActive() {
        return this._currentEventType !== null;
    },
};

// ==================== 与现有系统集成 ====================

/**
 *  DungeonMapSystem 集成辅助函数
 *  在 DungeonMapSystem._enterEvent() 中调用
 */
export function enterDungeonEvent(player, onComplete) {
    DungeonEventSystem.trigger(player, onComplete);
}

/**
 * 战斗完成后消耗buff层数
 * 在 DungeonMapSystem._cleanupCombat() 或 _checkCombatComplete() 中调用
 */
export function onCombatComplete(player) {
    if (player) {
        DungeonBuffSystem.consumeGoddessBless(player);
    }
}

/**
 * 地牢结束时清理所有buff
 * 在 DungeonMapSystem.shutdown() 中调用
 */
export function onDungeonEnd(player) {
    if (player) {
        DungeonBuffSystem.clearAllBuffs(player);
    }
}

// ==================== 导出 ====================
export default {
    config: DUNGEON_EVENT_CONFIG,
    EventSystem: DungeonEventSystem,
    BuffSystem: DungeonBuffSystem,
    AttributeCheck: AttributeCheckSystem,
    enterDungeonEvent,
    onCombatComplete,
    onDungeonEnd,
};
