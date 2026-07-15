/**
 * ============================================================
 * DungeonEventDefinitions — 新增地牢随机事件定义（待审核后接入 DungeonEventSystem）
 * ============================================================
 *
 * 设计原则：
 * - 10 个事件均不与现有 5 个事件重复
 * - 每个事件至少 2 个选择分支，使用不同属性检定
 * - 检定概率以现有事件为基础微调：
 *   困难检定 20~30%，普通检定 30~45%，简单检定 40~50%
 * - 结果类型：金币、药水、材料、特殊道具、揭示节点、战斗、伤害、恢复、临时 Buff
 *
 * 接入方式（后续）：
 *   1. 在 dungeon-event-system.js 的 eventWeights 中注册权重
 *   2. 在 handleChoice 的 switch 中增加 default 分支调用 handleNewDungeonEvent
 *   3. 将本文件配置合并进 DUNGEON_EVENT_CONFIG 或独立使用
 */

import { AttributeCheckSystem } from './dungeon-event-system.js';

// 与 dungeon-event-system.js 保持一致的特殊道具映射
const SPECIAL_ITEM_KEY_MAP = {
    enhancement_stone: 'enhancementStone',
    reforge_ticket: 'reforgeTicket',
    magic_dust: 'magicDust',
};

const SPECIAL_ITEM_CONFIG = {
    enhancement_stone: { name: '强化石', icon: '💎', category: 'enhancement', maxStack: 9999 },
    reforge_ticket: { name: '改造券', icon: '🎫', category: 'enhancement', maxStack: 9999 },
    magic_dust: { name: '魔法粉尘', icon: '✨', category: 'material', maxStack: 9999 },
};

const MATERIAL_TYPES = ['铁矿石', '皮革碎片', '魔法粉尘', '古老木材', '精金碎片'];

// ============================================================
// 事件配置
// ============================================================

export const NEW_EVENT_WEIGHTS = {
    collapsedArchway: 1,
    undeadScholarNotes: 1,
    bloodAltar: 1,
    mistyCrossroad: 1,
    cursedArmor: 1,
    poisonMushroomCircle: 1,
    abyssalGambler: 1,
    frozenFountain: 1,
    lockedArmory: 1,
    phantomMirror: 1,
};

export const NEW_EVENT_CONFIGS = {
    collapsedArchway: {
        title: '坍塌的石拱门',
        description: '前方的通道被一座坍塌的石拱门堵住，巨大的花岗岩碎块堆叠成小山，只有顶部一条狭窄的缝隙透出微弱的光。你可以尝试推开碎石，或者从缝隙中挤过去——但两者都需要付出代价。',
        choices: [
            {
                id: 'forceOpen',
                label: '力量推举',
                description: '用蛮力推开碎石，开辟通路',
                attribute: 'str',
                baseRate: 30,
                success: {
                    text: '你怒吼一声，双臂肌肉绷紧，将一块块巨石推到两侧。碎石后方露出一个被遗忘的壁龛。',
                    gold: { min: 40, max: 90 },
                    specialItems: [{ type: 'enhancement_stone', count: 1 }],
                },
                fail: {
                    text: '巨石纹丝不动，反而因为震动落下更多碎石，砸在你的肩膀和背上。',
                    damagePercent: 20,
                },
            },
            {
                id: 'squeezeThrough',
                label: '敏捷钻缝',
                description: '从顶部狭窄的缝隙中挤过去',
                attribute: 'dex',
                baseRate: 35,
                success: {
                    text: '你像猫一样蜷缩身体，贴着冰冷的石壁滑过缝隙，在另一边发现了几枚散落的金币。',
                    gold: { min: 20, max: 50 },
                },
                fail: {
                    text: '你卡在缝隙中间，进退不得，最后只能强行挣脱，身上布满擦伤。',
                    damagePercent: 15,
                },
            },
            {
                id: 'leave',
                label: '原路返回',
                outcome: { text: '你决定不冒险，绕过这片坍塌区域。' },
            },
        ],
    },

    undeadScholarNotes: {
        title: '亡灵学者的笔记',
        description: '一具穿着破烂长袍的骷髅倚靠在墙边，指骨紧握着一本羊皮笔记。笔记的页面上写满了扭曲的古代符文，有些字符还在微微发光。你感觉到其中蕴含着危险的知识。',
        choices: [
            {
                id: 'decipherSpell',
                label: '智力解读',
                description: '尝试理解并学习笔记中的古代咒语',
                attribute: 'int',
                baseRate: 30,
                success: {
                    text: '你成功念出一段咒文，符文化作流光涌入你的脑海，魔法力量暂时增强。',
                    buff: {
                        id: 'ancientSpell',
                        name: '古代咒语',
                        icon: '🔮',
                        color: '#8a7aff',
                        atkPercent: 20,
                        durationBattles: 2,
                    },
                    mpRestorePercent: 20,
                },
                fail: {
                    text: '你误读了一个关键音节，笔记爆发出一阵阴冷的能量，周围的亡灵被惊动了！',
                    combat: true,
                },
            },
            {
                id: 'senseTrap',
                label: '精神感知',
                description: '用精神力探测笔记是否被诅咒',
                attribute: 'wis',
                baseRate: 40,
                success: {
                    text: '你感知到笔记页边隐藏的魔力陷阱，并成功绕过它。书页中夹着一张简化的地图残片。',
                    revealNodes: true,
                    gold: { min: 15, max: 35 },
                },
                fail: {
                    text: '你的精神触碰到诅咒符文，一阵剧痛让你跪倒在地，魔力被抽走了一部分。',
                    mpRestorePercent: -15,
                },
            },
        ],
    },

    bloodAltar: {
        title: '鲜血祭坛',
        description: '一座由暗红色岩石砌成的祭坛矗立在血泊中央，表面刻满了贪婪的符文。祭坛上方的空气中悬浮着一滴巨大的黑色血珠，它似乎在等待某人的献祭。',
        choices: [
            {
                id: 'endureSacrifice',
                label: '体质承受',
                description: '以鲜血为祭，换取深渊的力量',
                attribute: 'con',
                baseRate: 25,
                success: {
                    text: '你忍住剧痛将手掌按在祭坛上，黑色血珠融入你的血管。你感到力量在血液中燃烧。',
                    buff: {
                        id: 'bloodFury',
                        name: '血怒',
                        icon: '🩸',
                        color: '#aa3333',
                        atkPercent: 15,
                        durationBattles: 3,
                    },
                    healPercent: 10,
                },
                fail: {
                    text: '祭坛贪婪地抽取了你的鲜血，却没有给予任何回报。你虚弱地后退，脸色苍白。',
                    damagePercent: 30,
                },
            },
            {
                id: 'luckyOffering',
                label: '幸运献祭',
                description: '赌一把，用最少的血换取最大的恩赐',
                attribute: 'luck',
                baseRate: 20,
                success: {
                    text: '血珠只轻轻舔舐了你的指尖，祭坛却爆发出一阵狂笑，大量财宝从石缝中涌出。',
                    gold: { min: 80, max: 180 },
                    specialItems: [{ type: 'magic_dust', count: 150 }],
                },
                fail: {
                    text: '祭坛认为你的献祭过于吝啬，一股反冲力将你击飞，撞在身后的墙壁上。',
                    damagePercent: 25,
                },
            },
            {
                id: 'leave',
                label: '拒绝献祭',
                outcome: { text: '你转身离开，黑色血珠在身后发出失望的嗡鸣。' },
            },
        ],
    },

    mistyCrossroad: {
        title: '迷雾十字路口',
        description: '通道在这里分成四条岔路，每条路口都笼罩着不同颜色的迷雾。空气中传来低语、笑声、哭声和金属碰撞声，让人无法判断哪条路才是安全的。',
        choices: [
            {
                id: 'spiritGuidance',
                label: '精神指引',
                description: '集中精神，聆听迷雾中的真实低语',
                attribute: 'wis',
                baseRate: 35,
                success: {
                    text: '你屏蔽了虚假的声音，捕捉到一缕清澈的低语，它为你指出了正确的方向。',
                    revealNodes: true,
                    gold: { min: 20, max: 50 },
                },
                fail: {
                    text: '你被虚假的低语引入歧途，拐角的阴影中钻出几只饥饿的地牢生物。',
                    combat: true,
                },
            },
            {
                id: 'luckyWander',
                label: '幸运乱走',
                description: '闭上眼睛，凭直觉选择一条路',
                attribute: 'luck',
                baseRate: 25,
                success: {
                    text: '你随手一指，竟然走进了一条藏有前人遗物的捷径。',
                    gold: { min: 50, max: 120 },
                    hpPotion: { min: 1, max: 2 },
                },
                fail: {
                    text: '你的直觉背叛了你，脚下的石板突然塌陷，尖刺从下方刺出。',
                    damagePercent: 20,
                },
            },
        ],
    },

    cursedArmor: {
        title: '被诅咒的板甲',
        description: '一具空荡荡的板甲跪坐在石台上，表面布满了黑色的锈迹和抓痕。盔甲的缝隙中传出若有若无的叹息声，仿佛曾经的主人仍在其中挣扎。',
        choices: [
            {
                id: 'wearArmor',
                label: '力量穿戴',
                description: '凭力量压制诅咒，强行穿上盔甲',
                attribute: 'str',
                baseRate: 30,
                success: {
                    text: '你用意志压制了盔甲中的怨灵，黑色的板甲暂时臣服于你，力量大增。',
                    buff: {
                        id: 'cursedMight',
                        name: '诅咒之力',
                        icon: '⚔️',
                        color: '#666666',
                        atkPercent: 18,
                        durationBattles: 2,
                    },
                },
                fail: {
                    text: '怨灵反噬你的意志，盔甲的手臂猛然抬起，给了你沉重一击。',
                    damagePercent: 25,
                },
            },
            {
                id: 'dismantleCursed',
                label: '智力辨识',
                description: '找出诅咒核心并安全拆解有价值的部件',
                attribute: 'int',
                baseRate: 35,
                success: {
                    text: '你精准地拆下了盔甲肩甲上未受诅咒的精金铆钉，并将剩余部分重新封印。',
                    material: { type: '精金碎片', count: { min: 1, max: 3 } },
                    gold: { min: 30, max: 70 },
                },
                fail: {
                    text: '你的拆解触发了诅咒，盔甲站了起来，空洞的头盔中亮起猩红的光芒。',
                    combat: true,
                },
            },
        ],
    },

    poisonMushroomCircle: {
        title: '毒菇环',
        description: '一片散发着幽蓝荧光的蘑菇围成一个完美的圆环，菌盖上不断滴落粘稠的孢子液。老冒险者都知道，环形生长的毒菇往往藏着珍贵的药材，但也意味着致命的孢子云。',
        choices: [
            {
                id: 'carefulHarvest',
                label: '精神采集',
                description: '屏住呼吸，用精神力感知安全采摘的时机',
                attribute: 'wis',
                baseRate: 40,
                success: {
                    text: '你在孢子喷发间隙迅速采下几株菌盖，并用布包好，没有吸入任何毒粉。',
                    hpPotion: { min: 1, max: 2 },
                    mpPotion: { min: 1, max: 1 },
                },
                fail: {
                    text: '你刚刚摘下蘑菇，脚下的菌丝就释放出大量孢子，你剧烈咳嗽起来。',
                    damagePercent: 20,
                },
            },
            {
                id: 'dashThrough',
                label: '敏捷跳跃',
                description: '快速跳过环阵，避免吸入孢子',
                attribute: 'dex',
                baseRate: 30,
                success: {
                    text: '你纵身跃过蘑菇环，脚尖只在菌盖边缘轻轻一点。落地时，你发现了一条被遮蔽的小路。',
                    revealNodes: true,
                },
                fail: {
                    text: '你的落脚点踩到了一簇隐形的菌丝，孢子云瞬间将你吞没。',
                    damagePercent: 15,
                },
            },
        ],
    },

    abyssalGambler: {
        title: '深渊赌徒',
        description: '一个戴着破碎面具的佝偻身影蹲在石墩旁，面前摆着三颗不断变换花纹的骰子。它抬起手指向你，面具下的声音像是从很远的地方传来：「来赌一把吧，活人的运气。」',
        choices: [
            {
                id: 'luckyBet',
                label: '幸运下注',
                description: '把命运交给骰子',
                attribute: 'luck',
                baseRate: 30,
                success: {
                    text: '三颗骰子同时停在相同的深渊之眼上，赌徒发出不甘的低吼，将赌注推向你。',
                    gold: { min: 100, max: 200 },
                    specialItems: [{ type: 'reforge_ticket', count: 1 }],
                },
                fail: {
                    text: '骰子停在了骷髅图案上，赌徒笑着收走了你的部分生命力作为赌资。',
                    damagePercent: 25,
                    mpRestorePercent: -15,
                },
            },
            {
                id: 'countCards',
                label: '智力算牌',
                description: '观察骰子变换规律，找出破绽',
                attribute: 'int',
                baseRate: 25,
                success: {
                    text: '你识破了赌徒用魔力操纵骰子的手法，威胁它交出公平的奖励。',
                    gold: { min: 60, max: 120 },
                },
                fail: {
                    text: '赌徒察觉了你的观察，面具下的笑容变得更加狰狞，周围的阴影凝聚成实体。',
                    combat: true,
                },
            },
            {
                id: 'leave',
                label: '拒绝赌博',
                outcome: { text: '你摇摇头，赌徒发出失望的啧啧声，消失在迷雾中。' },
            },
        ],
    },

    frozenFountain: {
        title: '寒冰喷泉',
        description: '一座半冻结的喷泉立在圆形大厅中央，喷出的水柱在空中凝结成蓝色的冰晶，又落回池中。泉水散发着强烈的魔力波动，似乎既能治愈也能冻伤。',
        choices: [
            {
                id: 'drinkWater',
                label: '体质饮水',
                description: '喝下泉水，用身体承受其中的魔力',
                attribute: 'con',
                baseRate: 35,
                success: {
                    text: '冰冷的泉水入喉，你感到疲惫一扫而空，伤口也在寒气的刺激下迅速愈合。',
                    healPercent: 50,
                    mpRestorePercent: 25,
                },
                fail: {
                    text: '泉水在你的血管中结冰，你痛苦地跪倒在地，皮肤和嘴唇变成青紫色。',
                    damagePercent: 15,
                    mpRestorePercent: -10,
                },
            },
            {
                id: 'purifyFrost',
                label: '精神净化',
                description: '用精神力驱散泉水中的寒气，只吸收纯净的魔力',
                attribute: 'wis',
                baseRate: 30,
                success: {
                    text: '你的精神力像滤网一样分离了寒气，纯净的魔力注入你的体内。',
                    mpRestorePercent: 50,
                    gold: { min: 20, max: 40 },
                },
                fail: {
                    text: '寒气顺着你的精神触须反噬，喷泉中升起一只冰霜怨灵。',
                    combat: true,
                },
            },
        ],
    },

    lockedArmory: {
        title: '被锁住的军械库',
        description: '一扇厚重的铁门挡住了去路，门上的锁已经锈死，但缝隙中仍能闻到油脂和钢铁的气味。门后隐约传来金属碰撞的回响，也许还有未被拿走的装备。',
        choices: [
            {
                id: 'pickLock',
                label: '敏捷撬锁',
                description: '用细工具撬开生锈的锁芯',
                attribute: 'dex',
                baseRate: 25,
                success: {
                    text: '锁芯发出清脆的咔哒声，铁门缓缓打开，露出里面尘封的装备和材料。',
                    specialItems: [
                        { type: 'enhancement_stone', count: 1 },
                        { type: 'magic_dust', count: { min: 80, max: 150 } },
                    ],
                },
                fail: {
                    text: '你的工具断在锁孔里，触发了门后的弩箭机关，几支铁箭擦过你的身体。',
                    damagePercent: 20,
                },
            },
            {
                id: 'breakDoor',
                label: '力量破门',
                description: '用蛮力撞开铁门',
                attribute: 'str',
                baseRate: 30,
                success: {
                    text: '你用肩膀撞开铁门，门后的守卫早已化为白骨，只剩下散落的武器材料。',
                    material: { type: '铁矿石', count: { min: 2, max: 4 } },
                    gold: { min: 30, max: 60 },
                },
                fail: {
                    text: '铁门只裂开一条缝，巨大的声响惊动了军械库深处的守卫幽魂。',
                    combat: true,
                },
            },
        ],
    },

    phantomMirror: {
        title: '幻影镜面',
        description: '一面巨大的椭圆形镜子斜靠在墙上，镜面中映照出的不是你的倒影，而是一个面目模糊的陌生人。它似乎在模仿你的动作，但又慢了半拍，仿佛在等待你做出选择。',
        choices: [
            {
                id: 'gazeIntoMirror',
                label: '精神凝视',
                description: '凝视镜面，尝试看穿幻象的本质',
                attribute: 'wis',
                baseRate: 30,
                success: {
                    text: '你无视镜中身影的干扰，看到了它身后隐藏的幻象宝库。',
                    gold: { min: 40, max: 90 },
                    mpRestorePercent: 20,
                },
                fail: {
                    text: '你的意识被拉入镜中，虽然只是短短一瞬，却消耗了你大量魔力。',
                    mpRestorePercent: -25,
                },
            },
            {
                id: 'readRunes',
                label: '智力破译',
                description: '解读镜框上的古代符文，获取镜中知识',
                attribute: 'int',
                baseRate: 35,
                success: {
                    text: '你破译了符文，镜面变成了一幅实时地图，显示出周围几条通道的尽头。',
                    revealNodes: true,
                    gold: { min: 20, max: 50 },
                },
                fail: {
                    text: '你念错了一个符文，镜中的身影狞笑着走了出来。',
                    combat: true,
                },
            },
            {
                id: 'leave',
                label: '移开目光',
                outcome: { text: '你迅速移开视线，镜中的身影发出一声失望的叹息。' },
            },
        ],
    },
};

// ============================================================
// 通用事件处理器
// ============================================================

export function handleNewDungeonEvent(player, choiceId, eventType, dungeonMapSystem = null) {
    const config = NEW_EVENT_CONFIGS[eventType];
    if (!config) {
        return { type: 'none', text: '未知事件', rewards: {}, eventType, choiceId };
    }
    const choice = config.choices.find(c => c.id === choiceId);
    if (!choice) {
        return { type: 'none', text: '无效选择', rewards: {}, eventType, choiceId };
    }

    // 无属性检定的确定性选择
    if (!choice.attribute) {
        const outcome = choice.outcome || {};
        return _applyOutcome(player, outcome, dungeonMapSystem, null, true, choice, config);
    }

    const checkResult = AttributeCheckSystem.check(player, choice.attribute, choice.baseRate || 20);
    const success = checkResult.success;
    const outcome = success ? (choice.success || {}) : (choice.fail || {});
    return _applyOutcome(player, outcome, dungeonMapSystem, checkResult, success, choice, config);
}

function _applyOutcome(player, outcome, dungeonMapSystem, checkResult, success, choice, config) {
    const rewards = {};
    const textParts = [];
    let resultType = success ? 'success' : 'fail';
    let combat = false;

    // 自定义文本
    if (outcome.text) {
        textParts.push(outcome.text);
    } else if (success && choice.successText) {
        textParts.push(choice.successText);
    } else if (!success && choice.failText) {
        textParts.push(choice.failText);
    }

    // 金币
    if (outcome.gold !== undefined) {
        const amount = _resolveValue(outcome.gold);
        if (amount > 0) {
            rewards.gold = amount;
            textParts.push(`获得 ${amount} 金币。`);
        }
    }

    // 治疗药水 / 魔法药水
    if (outcome.hpPotion !== undefined) {
        const count = _resolveValue(outcome.hpPotion);
        if (count > 0) {
            rewards.hpPotion = count;
            textParts.push(`获得治疗药水 x${count}。`);
        }
    }
    if (outcome.mpPotion !== undefined) {
        const count = _resolveValue(outcome.mpPotion);
        if (count > 0) {
            rewards.mpPotion = count;
            textParts.push(`获得魔法药水 x${count}。`);
        }
    }

    // 普通材料
    if (outcome.material) {
        const materialType = outcome.material.type || MATERIAL_TYPES[Math.floor(Math.random() * MATERIAL_TYPES.length)];
        const count = _resolveValue(outcome.material.count) || 1;
        rewards.material = { type: materialType, count };
        textParts.push(`获得 ${materialType} x${count}。`);
    }

    // 特殊道具
    if (Array.isArray(outcome.specialItems)) {
        for (const item of outcome.specialItems) {
            const count = _resolveValue(item.count) || 1;
            const rewardKey = SPECIAL_ITEM_KEY_MAP[item.type] || item.type;
            rewards[rewardKey] = (rewards[rewardKey] || 0) + count;
            const special = SPECIAL_ITEM_CONFIG[item.type];
            textParts.push(`获得 ${special ? special.name : item.type} x${count}。`);
        }
    }

    // 恢复 / 伤害
    if (outcome.healPercent !== undefined && player && player.data) {
        const amount = Math.floor(player.data.maxHp * Math.abs(outcome.healPercent) / 100);
        if (outcome.healPercent >= 0) {
            player.data.hp = Math.min(player.data.maxHp, player.data.hp + amount);
            textParts.push(`恢复 ${amount} 点生命值。`);
        } else {
            player.data.hp = Math.max(1, player.data.hp - amount);
            textParts.push(`失去 ${amount} 点生命值。`);
        }
    }
    if (outcome.mpRestorePercent !== undefined && player && player.data) {
        const amount = Math.floor(player.data.maxMp * Math.abs(outcome.mpRestorePercent) / 100);
        if (outcome.mpRestorePercent >= 0) {
            player.data.mp = Math.min(player.data.maxMp, player.data.mp + amount);
            textParts.push(`恢复 ${amount} 点魔法值。`);
        } else {
            player.data.mp = Math.max(0, player.data.mp - amount);
            textParts.push(`失去 ${amount} 点魔法值。`);
        }
    }
    if (outcome.damagePercent !== undefined && player && player.data) {
        const amount = Math.floor(player.data.maxHp * outcome.damagePercent / 100);
        player.data.hp = Math.max(1, player.data.hp - amount);
        textParts.push(`受到 ${amount} 点伤害（${outcome.damagePercent}% 最大生命值）。`);
        resultType = 'fail';
    }

    // 战斗
    if (outcome.combat) {
        combat = true;
        textParts.push('你触发了战斗！');
        resultType = 'combat';
    }

    // 揭示节点
    if (outcome.revealNodes && dungeonMapSystem && dungeonMapSystem.fogOfWar) {
        _revealAdjacentNodes(dungeonMapSystem);
        textParts.push('你发现了周围道路的线索。');
    }

    // 临时 Buff
    if (outcome.buff && player) {
        _applyTemporaryBuff(player, outcome.buff);
        textParts.push(`获得【${outcome.buff.name}】：攻击 +${outcome.buff.atkPercent}%，持续 ${outcome.buff.durationBattles} 场战斗。`);
    }

    // 检定结果文本
    if (checkResult) {
        textParts.push(AttributeCheckSystem.getResultText(checkResult));
    }

    return {
        type: resultType,
        text: textParts.join('\n'),
        rewards,
        combat,
        eventType: config.title,
        choiceId: choice.id,
        checkResult,
    };
}

function _resolveValue(value) {
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object' && value.min !== undefined && value.max !== undefined) {
        return value.min + Math.floor(Math.random() * (value.max - value.min + 1));
    }
    return 0;
}

function _revealAdjacentNodes(dungeonMapSystem) {
    const current = dungeonMapSystem.currentNodeId;
    if (!current) return;
    const adjacentIds = new Set();
    for (const edge of dungeonMapSystem.edges) {
        if (edge.from === current) adjacentIds.add(edge.to);
        if (edge.to === current) adjacentIds.add(edge.from);
    }
    for (const nodeId of adjacentIds) {
        dungeonMapSystem.fogOfWar.visit(nodeId, dungeonMapSystem.nodes, dungeonMapSystem.edges);
    }
}

function _applyTemporaryBuff(player, buffCfg) {
    if (!player || !player.data) return;
    if (!player._dungeonBuffs) player._dungeonBuffs = {};
    player._dungeonBuffs[buffCfg.id] = {
        type: buffCfg.id,
        atkPercent: buffCfg.atkPercent || 0,
        remainingBattles: buffCfg.durationBattles || 1,
        name: buffCfg.name,
    };
    if (player.calculateCombatStats) {
        player.calculateCombatStats();
    }
}

// ============================================================
// 便捷合并辅助（后续接入时可用）
// ============================================================

export function mergeNewEventsIntoConfig(baseEventWeights, baseEventConfigs) {
    return {
        eventWeights: { ...baseEventWeights, ...NEW_EVENT_WEIGHTS },
        eventConfigs: { ...baseEventConfigs, ...NEW_EVENT_CONFIGS },
    };
}
