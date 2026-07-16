/**
 * ============================================================
 * DungeonEventDefinitions — 新增地牢随机事件定义
 * ============================================================
 *
 * 10 个事件按《随机事件表格.xlsx》最终设定实现：
 * - 每个事件 2~3 个分支，使用不同属性检定
 * - 结果类型：金币、药水、材料、特殊道具、揭示节点、战斗、伤害、恢复、临时 Buff/Debuff
 * - 失败战斗区分「普通战斗」与「精英战斗」
 */

import { AttributeCheckSystem } from './dungeon-event-system.js';
import { StatusBar } from '../ui/status-bar.js';

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

// 一瓶标准药水恢复的数值（事件奖励里用 HP/MP 数值代替“瓶数”）
const POTION_HEAL = 30;
const POTION_MP = 25;

// ============================================================
// 事件权重
// ============================================================

export const NEW_EVENT_WEIGHTS = {
    collapsedArchway: 1,
    undeadScholarNotes: 1,
    bloodAltar: 1,
    mistyCrossroad: 1,
    cursedArmor: 1,
    poisonMushroomCircle: 1,
    abyssalGambler: 1,
    blessedFountain: 1,
    lockedArmory: 1,
    phantomMirror: 1,
};

// ============================================================
// 事件配置
// ============================================================

export const NEW_EVENT_CONFIGS = {
    collapsedArchway: {
        title: '坍塌的石拱门',
        description: '前方的通道被一座坍塌的石拱门堵得严严实实。巨大的花岗岩碎块堆叠成小山，缝隙间渗出潮湿的霉味，只有顶部一条狭窄的裂隙透出微弱的光。你可以尝试像推土机一样推开碎石，或者像猫一样从缝隙中挤过去——但两者都需要付出代价。拱门表面的符文已经风化，却依然残留着某种古老的警告：「唯有强者或灵巧者，方能通过此门。」',
        choices: [
            {
                id: 'forceOpen',
                label: '力量推举',
                description: '用蛮力推开碎石，开辟通路',
                attribute: 'str',
                baseRate: 30,
                success: {
                    text: '你怒吼一声，双臂肌肉绷紧，将一块块巨石推到两侧。碎石滚落的声音在通道中回荡，拱门后方露出一个被遗忘的壁龛，里面散落着前人遗留的财宝。',
                    gold: { min: 40, max: 60 },
                    specialItems: [{ type: 'enhancement_stone', count: 1 }],
                },
                fail: {
                    text: '巨石纹丝不动，反而因为震动落下更多碎石，砸在你的肩膀和背上。你咬紧牙关退开，意识到自己的力量还不足以撼动这座古老的门户。',
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
                    text: '你像猫一样蜷缩身体，贴着冰冷的石壁滑过缝隙。碎石刮破了披风，但你在另一边发现了几枚散落的金币，也许是某个倒霉冒险者掉落的。',
                    gold: { min: 20, max: 50 },
                },
                fail: {
                    text: '你卡在缝隙中间，进退不得，冰冷的石壁压迫着胸口。最后只能强行挣脱，铠甲在岩石上刮出刺耳的声响，身上布满擦伤。',
                    damagePercent: 10,
                },
            },
            {
                id: 'leave',
                label: '原路返回',
                outcome: { text: '你决定不冒险，绕过这片坍塌区域。虽然安全，但你总感觉错过了什么。' },
            },
        ],
    },

    undeadScholarNotes: {
        title: '亡灵学者的笔记',
        description: '一具穿着破烂长袍的骷髅倚靠在墙边，指骨紧握着一本羊皮笔记。笔记的页面上写满了扭曲的古代符文，有些字符还在微微发光，像是有生命一般缓慢蠕动。你感觉到其中蕴含着危险的知识——可能是失传的力量，也可能是致命的诅咒。',
        choices: [
            {
                id: 'decipherSpell',
                label: '智力解读',
                description: '尝试理解并学习笔记中的古代咒语',
                attribute: 'int',
                baseRate: 30,
                success: {
                    text: '你成功念出一段咒文，符文化作流光涌入你的脑海。古老的魔法力量暂时与你共鸣，让你感受到魔力的澎湃。',
                    buff: {
                        id: 'ancientSpell',
                        name: '古代咒语',
                        icon: '🔮',
                        color: '#8a7aff',
                        matkPercent: 20,
                        durationBattles: 3,
                    },
                    mpRestorePercent: 20,
                },
                fail: {
                    text: '你误读了一个关键音节，笔记爆发出一阵阴冷的能量。魔力从你身上被抽走，周围的亡灵也被这股波动惊动，缓缓向你围拢。',
                    mpRestorePercent: -15,
                    combat: 'normal',
                },
            },
            {
                id: 'senseTrap',
                label: '精神感知',
                description: '用精神力探测笔记是否被诅咒',
                attribute: 'wis',
                baseRate: 40,
                success: {
                    text: '你感知到笔记页边隐藏的魔力陷阱，并成功绕过它。书页中夹着一张简化的地图残片，让你对周围的道路有了更多了解。',
                    revealNodes: true,
                    revealDepth: 2,
                    gold: { min: 15, max: 35 },
                },
                fail: {
                    text: '你的精神触碰到诅咒符文，一阵剧痛让你跪倒在地。更糟糕的是，这阵精神波动唤醒了附近的亡灵守卫。',
                    mpRestorePercent: -15,
                    combat: 'normal',
                },
            },
        ],
    },

    bloodAltar: {
        title: '鲜血祭坛',
        description: '一座由暗红色岩石砌成的祭坛矗立在血泊中央，表面刻满了贪婪的符文。祭坛上方的空气中悬浮着一滴巨大的黑色血珠，它不断脉动，像是一颗畸形的心脏，似乎在等待某人的献祭。你感到一种古老而邪恶的力量正在邀请你进行一场危险的交易。',
        choices: [
            {
                id: 'endureSacrifice',
                label: '体质承受',
                description: '以鲜血为祭，换取深渊的力量',
                attribute: 'con',
                baseRate: 25,
                success: {
                    text: '你忍住剧痛将手掌按在祭坛上，黑色血珠融入你的血管。你感到力量在血液中燃烧，伤口也在血能的刺激下快速愈合。',
                    buff: {
                        id: 'bloodFury',
                        name: '血怒',
                        icon: '🩸',
                        color: '#aa3333',
                        atkPercent: 15,
                        durationBattles: 3,
                    },
                    healPercent: 20,
                },
                fail: {
                    text: '祭坛贪婪地抽取了你的鲜血，却没有给予任何回报。你虚弱地后退，脸色苍白，仿佛被抽走了半条命。',
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
                    text: '血珠只轻轻舔舐了你的指尖，祭坛却爆发出一阵狂笑。石缝中涌出大量财宝，深渊似乎格外喜欢你这种胆大的赌徒。',
                    gold: { min: 80, max: 100 },
                    specialItems: [{ type: 'magic_dust', count: 50 }],
                },
                fail: {
                    text: '祭坛认为你的献祭过于吝啬，一股反冲力将你击飞，撞在身后的墙壁上。你咳出一口血，意识到深渊从不宽容小气鬼。',
                    damagePercent: 20,
                },
            },
            {
                id: 'leave',
                label: '拒绝献祭',
                outcome: {
                    text: '你转身离开，黑色血珠在身后发出失望的嗡鸣。然而没走几步，地面下钻出几只被祭坛气息吸引的血兽——它不会轻易放走送上门的祭品。',
                    combat: 'normal',
                },
            },
        ],
    },

    mistyCrossroad: {
        title: '迷雾十字路口',
        description: '通道在这里分成四条岔路，每条路口都笼罩着不同颜色的迷雾。红雾中传来低语，蓝雾里回荡着笑声，绿雾中隐约有人哭泣，而紫雾深处则是金属碰撞的铿锵声。你无法判断哪条路才是安全的，只能依靠精神力或直觉做出选择。',
        choices: [
            {
                id: 'spiritGuidance',
                label: '精神指引',
                description: '集中精神，聆听迷雾中的真实低语',
                attribute: 'wis',
                baseRate: 35,
                success: {
                    text: '你屏蔽了虚假的声音，捕捉到一缕清澈的低语。它不仅为你指出了正确的方向，还让你看到了更远处的道路尽头。',
                    revealNodes: true,
                    revealDepth: 2,
                    gold: { min: 20, max: 30 },
                },
                fail: {
                    text: '你被虚假的低语引入歧途，拐角的阴影中钻出几只饥饿的地牢生物。它们似乎已经等待猎物很久了。',
                    combat: 'normal',
                },
            },
            {
                id: 'luckyWander',
                label: '幸运乱走',
                description: '闭上眼睛，凭直觉选择一条路',
                attribute: 'luck',
                baseRate: 25,
                success: {
                    text: '你随手一指，竟然走进了一条藏有前人遗物的捷径。一只破损的背包里还剩下一些金币和一瓶未开封的治疗药水。',
                    gold: { min: 50, max: 60 },
                    hpPotion: POTION_HEAL,
                },
                fail: {
                    text: '你的直觉背叛了你，脚下的石板突然塌陷，尖刺从下方刺出。你勉强避开要害，但腿部还是被划出一道深深的伤口。',
                    damagePercent: 20,
                },
            },
        ],
    },

    cursedArmor: {
        title: '被诅咒的板甲',
        description: '一具空荡荡的板甲跪坐在石台上，表面布满了黑色的锈迹和抓痕。盔甲的缝隙中传出若有若无的叹息声，仿佛曾经的主人仍在其中挣扎。你能感觉到怨灵在盔甲中游荡，既渴望被穿戴，也渴望将新的宿主拖入诅咒。',
        choices: [
            {
                id: 'dismantleCursed',
                label: '智力辨识',
                description: '找出诅咒核心并安全拆解有价值的部件',
                attribute: 'int',
                baseRate: 35,
                success: {
                    text: '你精准地找到了盔甲中尚未被诅咒侵蚀的核心铆钉，并以安全的方式将其封印在自身护甲上。怨灵暂时无法反噬你，反而为你提供了一层额外的防护。',
                    buff: {
                        id: 'cursedArmorShell',
                        name: '诅咒板甲',
                        icon: '🛡️',
                        color: '#7a7a7a',
                        defPercent: 15,
                        durationBattles: 3,
                    },
                },
                fail: {
                    text: '你的拆解触发了诅咒，盔甲中的怨灵猛地向你扑来。它不仅咬伤了你，还将一部分诅咒附着在你的护甲上，使其变得沉重而脆弱。',
                    damagePercent: 15,
                    buff: {
                        id: 'armorCurse',
                        name: '板甲诅咒',
                        icon: '💀',
                        color: '#5a5a5a',
                        defPercent: -15,
                        durationBattles: 3,
                    },
                },
            },
            {
                id: 'forceDismantle',
                label: '力量拆解',
                description: '用蛮力砸开板甲，搜刮可用的魔法材料',
                attribute: 'str',
                baseRate: 30,
                success: {
                    text: '你用重击砸碎了板甲的胸甲，怨灵发出一声不甘的尖啸后消散。你收集了一些还残留着魔力的金属碎片和铆钉。',
                    specialItems: [
                        { type: 'magic_dust', count: 50 },
                        { type: 'enhancement_stone', count: 1 },
                    ],
                },
                fail: {
                    text: '你的重击没有破坏盔甲，反而让怨灵彻底苏醒。板甲自己站了起来，空洞的头盔中亮起猩红的光芒。',
                    combat: 'normal',
                },
            },
        ],
    },

    poisonMushroomCircle: {
        title: '毒菇环',
        description: '一片散发着幽蓝荧光的蘑菇围成一个完美的圆环，菌盖上不断滴落粘稠的孢子液。老冒险者都知道，环形生长的毒菇往往藏着珍贵的药材，但也意味着致命的孢子云。空气中的甜腻气味提醒你，这里的每一口呼吸都可能致命。',
        choices: [
            {
                id: 'carefulHarvest',
                label: '智力辨识',
                description: '辨认安全采摘的时机，收集药用药菇',
                attribute: 'int',
                baseRate: 40,
                success: {
                    text: '你仔细观察孢子囊的膨胀节奏，在孢子喷发间隙迅速采下几株菌盖。你用布包好它们，没有吸入任何毒粉，这些药菇可以制成一瓶治疗药水和一瓶魔法药水。',
                    hpPotion: POTION_HEAL,
                    mpPotion: POTION_MP,
                },
                fail: {
                    text: '你刚刚摘下蘑菇，脚下的菌丝就释放出大量孢子。你剧烈咳嗽起来，视野开始模糊，毒素在血液中蔓延。',
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
                    text: '你纵身跃过蘑菇环，脚尖只在菌盖边缘轻轻一点。落地时，你的动作比平时更加轻盈，并且发现了一条被遮蔽的小路。',
                    revealNodes: true,
                    revealDepth: 2,
                    buff: {
                        id: 'steadyMind',
                        name: '稳定心神',
                        icon: '🍃',
                        color: '#7abaff',
                        moveSpeedPercent: 20,
                        durationBattles: 3,
                    },
                },
                fail: {
                    text: '你的落脚点踩到了一簇隐形的菌丝，孢子云瞬间将你吞没。你屏住呼吸冲出环阵，但还是吸入了少量毒素。',
                    damagePercent: 20,
                },
            },
            {
                id: 'leave',
                label: '原路返回',
                outcome: { text: '你决定不碰这些危险的蘑菇，从环阵边缘绕行。虽然一无所获，但至少没有中毒。' },
            },
        ],
    },

    abyssalGambler: {
        title: '深渊赌徒',
        description: '一个戴着破碎面具的佝偻身影蹲在石墩旁，面前摆着三颗不断变换花纹的骰子。它抬起手指向你，面具下的声音像是从很远的地方传来：「来赌一把吧，活人的运气。」骰子上的花纹时而变成深渊之眼，时而变成骷髅图案，让人不寒而栗。',
        choices: [
            {
                id: 'luckyBet',
                label: '幸运下注',
                description: '把命运交给骰子',
                attribute: 'luck',
                baseRate: 30,
                success: {
                    text: '三颗骰子同时停在相同的深渊之眼上，赌徒发出不甘的低吼。它被迫将赌注推向你，包括一袋金币和一张改造券。',
                    gold: { min: 100, max: 200 },
                    specialItems: [{ type: 'reforge_ticket', count: 1 }],
                },
                fail: {
                    text: '骰子停在了骷髅图案上，赌徒笑着收走了你的部分生命力作为赌资。你感到口袋一轻，金币消失得无影无踪。',
                    gold: { min: -200, max: -150 },
                },
            },
            {
                id: 'countCards',
                label: '智力算牌',
                description: '观察骰子变换规律，找出破绽',
                attribute: 'int',
                baseRate: 25,
                success: {
                    text: '你识破了赌徒用魔力操纵骰子的手法，并冷冷地指出它的伎俩。赌徒不情愿地交出公平的奖励，希望你不要把这件事说出去。',
                    gold: { min: 100, max: 200 },
                    specialItems: [{ type: 'reforge_ticket', count: 1 }],
                },
                fail: {
                    text: '赌徒察觉了你的观察，面具下的笑容变得更加狰狞。它没有给你思考的时间，周围的阴影直接凝聚成实体扑向你。',
                    gold: { min: -200, max: -150 },
                },
            },
            {
                id: 'leave',
                label: '拒绝赌博',
                outcome: {
                    text: '你摇摇头，转身离开。赌徒发出失望的啧啧声，但你没注意到，它面具下的嘴角却扬了起来——几个更强大的深渊阴影从你背后的迷雾中浮现。',
                    combat: 'elite',
                },
            },
        ],
    },

    blessedFountain: {
        title: '祝福喷泉',
        description: '一座半冻结的喷泉立在圆形大厅中央，喷出的水柱在空中凝结成蓝色的冰晶，又落回池中。泉水散发着强烈的魔力波动，水面时而泛起金色的治愈光芒，时而被寒气覆盖。似乎既能治愈疲惫的旅人，也能冻伤贪婪的闯入者。',
        choices: [
            {
                id: 'drinkWater',
                label: '体质饮水',
                description: '喝下泉水，用身体承受其中的魔力',
                attribute: 'con',
                baseRate: 35,
                success: {
                    text: '冰冷的泉水入喉，你感到疲惫一扫而空，伤口也在寒气的刺激下迅速愈合。你的体质成功驾驭了泉水的力量。',
                    healPercent: 50,
                    mpRestorePercent: 25,
                },
                fail: {
                    text: '泉水的魔力对你的身体来说过于狂暴。你勉强咽下几口，但最终不得不吐出来，只有少量治愈效果残留。',
                    healPercent: 10,
                },
            },
            {
                id: 'purifyFrost',
                label: '精神净化',
                description: '用精神力驱散泉水中的寒气，只吸收纯净的魔力',
                attribute: 'wis',
                baseRate: 30,
                success: {
                    text: '你的精神力像滤网一样分离了寒气，纯净的魔力注入你的体内。魔法池被完全填满，疲惫也得到了缓解。',
                    mpRestorePercent: 50,
                    healPercent: 25,
                },
                fail: {
                    text: '寒气顺着你的精神触须反噬，你感到一阵剧烈的头痛。你急忙切断联系，泉水恢复了平静，仿佛什么都没有发生。',
                    mpRestorePercent: 10,
                },
            },
        ],
    },

    lockedArmory: {
        title: '被锁住的军械库',
        description: '一扇厚重的铁门挡住了去路，门上的锁已经锈死，但缝隙中仍能闻到油脂和钢铁的气味。门后隐约传来金属碰撞的回响，也许还有未被拿走的装备。然而那股回响太过规律，不像风，更像是某种仍在徘徊的守卫。',
        choices: [
            {
                id: 'pickLock',
                label: '敏捷撬锁',
                description: '用细工具撬开生锈的锁芯',
                attribute: 'dex',
                baseRate: 25,
                success: {
                    text: '锁芯发出清脆的咔哒声，铁门缓缓打开。门后的守卫早已化为白骨，只剩下散落的强化石和一袋魔法粉尘。',
                    specialItems: [
                        { type: 'enhancement_stone', count: 1 },
                        { type: 'magic_dust', count: 100 },
                    ],
                },
                fail: {
                    text: '你的工具断在锁孔里，触发了门后的弩箭机关。更糟糕的是，金属碰撞声越来越近——军械库深处的守卫幽魂被惊醒了。',
                    combat: 'elite',
                },
            },
            {
                id: 'breakDoor',
                label: '力量破门',
                description: '用蛮力撞开铁门',
                attribute: 'str',
                baseRate: 30,
                success: {
                    text: '你用肩膀撞开铁门，腐朽的门轴发出刺耳的呻吟。门后的守卫幽魂尚未凝聚成形，你迅速搜刮了强化石和魔法粉尘。',
                    specialItems: [
                        { type: 'enhancement_stone', count: 1 },
                        { type: 'magic_dust', count: 100 },
                    ],
                },
                fail: {
                    text: '铁门只裂开一条缝，巨大的声响在通道中回荡。门后传来整齐的脚步声——军械库的精英守卫正在逼近。',
                    combat: 'elite',
                },
            },
        ],
    },

    phantomMirror: {
        title: '幻影镜面',
        description: '一面巨大的椭圆形镜子斜靠在墙上，镜面中映照出的不是你的倒影，而是一个面目模糊的陌生人。它似乎在模仿你的动作，但又慢了半拍，仿佛在等待你做出选择。镜框上刻满了古老的符文，每一个符号都在低语着不同的真相。',
        choices: [
            {
                id: 'gazeIntoMirror',
                label: '精神凝视',
                description: '凝视镜面，尝试看穿幻象的本质',
                attribute: 'wis',
                baseRate: 30,
                success: {
                    text: '你无视镜中身影的干扰，看穿了幻象的源头。纯净的精神能量回馈到你体内，你的思维变得异常清明，脚步也更加轻盈。',
                    mpRestorePercent: 20,
                    buff: {
                        id: 'steadyMind',
                        name: '稳定心神',
                        icon: '🍃',
                        color: '#7abaff',
                        moveSpeedPercent: 20,
                        durationBattles: 3,
                    },
                },
                fail: {
                    text: '你的意识被拉入镜中，虽然只是短短一瞬，却让你看到了无数扭曲的幻象。你大汗淋漓地退开，脑海中仍回荡着那些画面，脚步变得沉重。',
                    buff: {
                        id: 'madVision',
                        name: '疯狂幻象',
                        icon: '👁️',
                        color: '#8a5a9a',
                        moveSpeedPercent: -20,
                        durationBattles: 3,
                    },
                },
            },
            {
                id: 'readRunes',
                label: '智力破译',
                description: '解读镜框上的古代符文，获取镜中知识',
                attribute: 'int',
                baseRate: 35,
                success: {
                    text: '你破译了符文，镜面变成了一幅实时地图，显示出周围几条通道的尽头。镜中的知识也滋养了你的身心，让你感到精神振奋。',
                    revealNodes: true,
                    revealDepth: 2,
                    healPercent: 10,
                    mpRestorePercent: 10,
                    buff: {
                        id: 'steadyMind',
                        name: '稳定心神',
                        icon: '🍃',
                        color: '#7abaff',
                        moveSpeedPercent: 20,
                        durationBattles: 3,
                    },
                },
                fail: {
                    text: '你念错了一个符文，镜中的身影狞笑着走了出来。它没有实体，却将一股混乱的力量注入你的意识，让你的视野开始旋转。',
                    buff: {
                        id: 'madVision',
                        name: '疯狂幻象',
                        icon: '👁️',
                        color: '#8a5a9a',
                        moveSpeedPercent: -20,
                        durationBattles: 3,
                    },
                },
            },
            {
                id: 'leave',
                label: '移开目光',
                outcome: {
                    text: '你迅速移开视线，镜中的身影发出一声失望的叹息。但当你转身准备离开时，却发现几只地牢生物不知何时已经堵住了退路。',
                    combat: 'normal',
                },
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
    let elite = false;

    // 自定义文本
    if (outcome.text) {
        textParts.push(outcome.text);
    } else if (success && choice.successText) {
        textParts.push(choice.successText);
    } else if (!success && choice.failText) {
        textParts.push(choice.failText);
    }

    // 金币（允许负值）
    if (outcome.gold !== undefined) {
        const amount = _resolveValue(outcome.gold);
        rewards.gold = amount;
        if (amount > 0) {
            textParts.push(`获得 ${amount} 金币。`);
        } else if (amount < 0) {
            textParts.push(`失去 ${-amount} 金币。`);
        }
    }

    // 治疗药水 / 魔法药水（数值代表恢复量）
    if (outcome.hpPotion !== undefined) {
        const amount = _resolveValue(outcome.hpPotion);
        if (amount > 0) {
            rewards.hpPotion = amount;
            textParts.push(`获得治疗药水（恢复 ${amount} 点生命值）。`);
        }
    }
    if (outcome.mpPotion !== undefined) {
        const amount = _resolveValue(outcome.mpPotion);
        if (amount > 0) {
            rewards.mpPotion = amount;
            textParts.push(`获得魔法药水（恢复 ${amount} 点魔法值）。`);
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

    // 战斗（普通 / 精英）
    if (outcome.combat) {
        combat = true;
        elite = outcome.combat === 'elite';
        textParts.push(elite ? '你触发了精英战斗！' : '你触发了战斗！');
        resultType = 'combat';
    }

    // 揭示节点
    if (outcome.revealNodes && dungeonMapSystem && dungeonMapSystem.fogOfWar) {
        const depth = outcome.revealDepth || 1;
        _revealNodesByDepth(dungeonMapSystem, depth);
        textParts.push(depth > 1 ? '你发现了周围更远处的道路线索。' : '你发现了周围道路的线索。');
    }

    // 临时 Buff / Debuff
    if (outcome.buff) {
        _applyTemporaryBuff(player, outcome.buff);
        textParts.push(`获得【${outcome.buff.name}】${_buffDescription(outcome.buff)}`);
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
        elite,
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

function _revealNodesByDepth(dungeonMapSystem, depth) {
    const current = dungeonMapSystem.currentNodeId;
    if (!current || !dungeonMapSystem.nodes || !dungeonMapSystem.edges) return;

    const visited = new Set([current]);
    let frontier = new Set([current]);

    for (let i = 0; i < depth; i++) {
        const nextFrontier = new Set();
        for (const nodeId of frontier) {
            for (const edge of dungeonMapSystem.edges) {
                const neighbor = edge.from === nodeId ? edge.to : (edge.to === nodeId ? edge.from : null);
                if (neighbor && !visited.has(neighbor)) {
                    visited.add(neighbor);
                    nextFrontier.add(neighbor);
                }
            }
        }
        frontier = nextFrontier;
    }

    for (const nodeId of visited) {
        if (nodeId === current) continue;
        dungeonMapSystem.fogOfWar.visit(nodeId, dungeonMapSystem.nodes, dungeonMapSystem.edges);
    }
}

function _applyTemporaryBuff(player, buffCfg) {
    if (!player || !player.data) return;
    if (!player._dungeonBuffs) player._dungeonBuffs = {};
    const entry = {
        type: buffCfg.id,
        name: buffCfg.name,
        icon: buffCfg.icon,
        color: buffCfg.color,
        atkPercent: buffCfg.atkPercent || 0,
        matkPercent: buffCfg.matkPercent || 0,
        defPercent: buffCfg.defPercent || 0,
        moveSpeedPercent: buffCfg.moveSpeedPercent || 0,
        remainingBattles: buffCfg.durationBattles || 1,
    };
    player._dungeonBuffs[buffCfg.id] = entry;

    if (StatusBar) {
        StatusBar.addEffect(buffCfg.id, 0, {
            icon: buffCfg.icon || '✨',
            name: buffCfg.name,
            color: buffCfg.color || '#e8c878',
            battleRemaining: buffCfg.durationBattles || 1,
        });
    }
    if (player.addStatusEffect) {
        player.addStatusEffect('buff', 999999, {
            icon: buffCfg.icon || '✨',
            name: buffCfg.name,
            color: buffCfg.color || '#e8c878',
        });
    }
    if (player.calculateCombatStats) {
        player.calculateCombatStats();
    }
}

function _buffDescription(buffCfg) {
    const parts = [];
    if (buffCfg.atkPercent) parts.push(`攻击 ${buffCfg.atkPercent > 0 ? '+' : ''}${buffCfg.atkPercent}%`);
    if (buffCfg.matkPercent) parts.push(`魔攻 ${buffCfg.matkPercent > 0 ? '+' : ''}${buffCfg.matkPercent}%`);
    if (buffCfg.defPercent) parts.push(`防御 ${buffCfg.defPercent > 0 ? '+' : ''}${buffCfg.defPercent}%`);
    if (buffCfg.moveSpeedPercent) parts.push(`移速 ${buffCfg.moveSpeedPercent > 0 ? '+' : ''}${buffCfg.moveSpeedPercent}%`);
    const attrText = parts.length ? `：${parts.join('，')}` : '';
    return `${attrText}，持续 ${buffCfg.durationBattles || 1} 场战斗。`;
}

// ============================================================
// 便捷合并辅助
// ============================================================

export function mergeNewEventsIntoConfig(baseEventWeights, baseEventConfigs) {
    return {
        eventWeights: { ...baseEventWeights, ...NEW_EVENT_WEIGHTS },
        eventConfigs: { ...baseEventConfigs, ...NEW_EVENT_CONFIGS },
    };
}
