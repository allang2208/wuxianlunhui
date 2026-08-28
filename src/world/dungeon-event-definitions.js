/**
 * ============================================================
 * DungeonEventDefinitions — 新增地牢随机事件定义
 * ============================================================
 *
 * 15 个僵尸事件、15 个沼泽事件、15 个雪原事件与 15 个废弃矿洞事件：
 * - 僵尸/沼泽事件统一为 2 个属性检定 + 1 个无检定叙事选项；雪原事件为 3 个属性检定 + 1 个无检定叙事选项，其中每档 80% 会付出代价或进入战斗
 * - 结果类型：金币、药水、材料、特殊道具、揭示节点、战斗、伤害、恢复、临时 Buff/Debuff
 * - 失败战斗区分「普通战斗」与「精英战斗」
 */

import { AttributeCheckSystem } from './attribute-check-system.js';
import { StatusBar } from '../ui/status-bar.js';

// 与 dungeon-event-system.js 保持一致的特殊道具映射
const SPECIAL_ITEM_KEY_MAP = {
    enhancement_stone: 'enhancementStone',
    reforge_ticket: 'reforgeTicket',
    magic_dust: 'magicDust',
};

const SPECIAL_ITEM_CONFIG = {
    enhancement_stone: { name: '强化石', icon: '💎', category: 'enhancement', maxStack: 9999, rarity: 'mythic' },
    reforge_ticket: { name: '改造券', icon: '🎫', category: 'enhancement', maxStack: 9999, rarity: 'mythic' },
    magic_dust: { name: '魔法粉尘', icon: '✨', category: 'material', maxStack: 9999, rarity: 'mythic' },
};

const MATERIAL_TYPES = ['铁矿石', '皮革碎片', '魔法粉尘', '古老木材', '精金碎片'];

// 一瓶标准药水恢复的数值（事件奖励里用 HP/MP 数值代替“瓶数”）
export const POTION_HEAL = 30;
export const POTION_MP = 25;

// ============================================================
// 事件权重
// ============================================================

export const NEW_EVENT_WEIGHTS = {
    collapsedMineShaft: 1,
    abandonedOreCart: 1,
    canaryCage: 1,
    dampFuseBox: 1,
    minersRationCache: 1,
    floodedLowerTunnel: 1,
    exposedCrystalVein: 1,
    brokenMineLift: 1,
    toxicGasPocket: 1,
    lanternCode: 1,
    foremanLedger: 1,
    dynamiteMagazine: 1,
    oreSpiderNest: 1,
    hauntedRockDrill: 1,
    sealedMainShaft: 1,
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
    quarantineBell: 1,
    corpseWaxWorkshop: 1,
    sealedSurvivorCell: 1,
    ossuaryOrgan: 1,
    plagueSpecimenVault: 1,
    frozenWaystone: 1,
    snowboundSupplySled: 1,
    singingIceBridge: 1,
    lostExpeditionCamp: 1,
    frostberryHollow: 1,
    trappedWhiteStag: 1,
    auroraIceLanterns: 1,
    avalancheWatchtower: 1,
    frostboundCaravan: 1,
    whisperingGlacierCrevasse: 1,
    frozenChapel: 1,
    iceFisherHole: 1,
    blizzardSignalBrazier: 1,
    crystalPrison: 1,
    ancientIceObservatory: 1,
    sunkenHerbalistBasket: 1,
    weepingReedBed: 1,
    leechBloomPool: 1,
    willOWispTrail: 1,
    rottenRopeBridge: 1,
    bogHunterRemains: 1,
    sunkenDruidShrine: 1,
    marshGasVents: 1,
    rootPrison: 1,
    blackwaterFerry: 1,
    fireflyGraveIslet: 1,
    frogBoneOracle: 1,
    mudboundCaravan: 1,
    sunkenWitchCauldron: 1,
    ancientCrocodileTotem: 1,
};

// ============================================================
// 限定事件元数据：等级(F~A) + 归属大类（scope）
// 规则：地牢只出现同 scope 且「地牢等级 ±1」范围内的限定事件。
// ============================================================
export const RESTRICTED_EVENT_META = {
    collapsedMineShaft: { grade: 'F', scope: 'abandonedMine' },
    abandonedOreCart: { grade: 'F', scope: 'abandonedMine' },
    canaryCage: { grade: 'F', scope: 'abandonedMine' },
    dampFuseBox: { grade: 'F', scope: 'abandonedMine' },
    minersRationCache: { grade: 'F', scope: 'abandonedMine' },
    floodedLowerTunnel: { grade: 'E', scope: 'abandonedMine' },
    exposedCrystalVein: { grade: 'E', scope: 'abandonedMine' },
    brokenMineLift: { grade: 'E', scope: 'abandonedMine' },
    toxicGasPocket: { grade: 'E', scope: 'abandonedMine' },
    lanternCode: { grade: 'E', scope: 'abandonedMine' },
    foremanLedger: { grade: 'D', scope: 'abandonedMine' },
    dynamiteMagazine: { grade: 'D', scope: 'abandonedMine' },
    oreSpiderNest: { grade: 'D', scope: 'abandonedMine' },
    hauntedRockDrill: { grade: 'D', scope: 'abandonedMine' },
    sealedMainShaft: { grade: 'D', scope: 'abandonedMine' },
    collapsedArchway: { grade: 'F', scope: 'zombie' },
    undeadScholarNotes: { grade: 'E', scope: 'zombie' },
    bloodAltar: { grade: 'D', scope: 'zombie' },
    mistyCrossroad: { grade: 'E', scope: 'zombie' },
    cursedArmor: { grade: 'D', scope: 'zombie' },
    poisonMushroomCircle: { grade: 'F', scope: 'zombie' },
    abyssalGambler: { grade: 'C', scope: 'zombie' },
    blessedFountain: { grade: 'D', scope: 'zombie' },
    lockedArmory: { grade: 'C', scope: 'zombie' },
    phantomMirror: { grade: 'B', scope: 'zombie' },
    quarantineBell: { grade: 'F', scope: 'zombie' },
    corpseWaxWorkshop: { grade: 'E', scope: 'zombie' },
    sealedSurvivorCell: { grade: 'D', scope: 'zombie' },
    ossuaryOrgan: { grade: 'D', scope: 'zombie' },
    plagueSpecimenVault: { grade: 'C', scope: 'zombie' },
    frozenWaystone: { grade: 'C', scope: 'frozen' },
    snowboundSupplySled: { grade: 'C', scope: 'frozen' },
    singingIceBridge: { grade: 'C', scope: 'frozen' },
    lostExpeditionCamp: { grade: 'C', scope: 'frozen' },
    frostberryHollow: { grade: 'C', scope: 'frozen' },
    trappedWhiteStag: { grade: 'B', scope: 'frozen' },
    auroraIceLanterns: { grade: 'B', scope: 'frozen' },
    avalancheWatchtower: { grade: 'B', scope: 'frozen' },
    frostboundCaravan: { grade: 'B', scope: 'frozen' },
    whisperingGlacierCrevasse: { grade: 'B', scope: 'frozen' },
    frozenChapel: { grade: 'A', scope: 'frozen' },
    iceFisherHole: { grade: 'A', scope: 'frozen' },
    blizzardSignalBrazier: { grade: 'A', scope: 'frozen' },
    crystalPrison: { grade: 'A', scope: 'frozen' },
    ancientIceObservatory: { grade: 'A', scope: 'frozen' },
    sunkenHerbalistBasket: { grade: 'E', scope: 'swamp' },
    weepingReedBed: { grade: 'E', scope: 'swamp' },
    leechBloomPool: { grade: 'E', scope: 'swamp' },
    willOWispTrail: { grade: 'D', scope: 'swamp' },
    rottenRopeBridge: { grade: 'D', scope: 'swamp' },
    bogHunterRemains: { grade: 'D', scope: 'swamp' },
    sunkenDruidShrine: { grade: 'D', scope: 'swamp' },
    marshGasVents: { grade: 'C', scope: 'swamp' },
    rootPrison: { grade: 'C', scope: 'swamp' },
    blackwaterFerry: { grade: 'C', scope: 'swamp' },
    fireflyGraveIslet: { grade: 'E', scope: 'swamp' },
    frogBoneOracle: { grade: 'D', scope: 'swamp' },
    mudboundCaravan: { grade: 'D', scope: 'swamp' },
    sunkenWitchCauldron: { grade: 'C', scope: 'swamp' },
    ancientCrocodileTotem: { grade: 'C', scope: 'swamp' },
};

// 难度等级顺序（事件/地牢共用）
export const GRADE_ORDER = ['F', 'E', 'D', 'C', 'B', 'A'];

// 通用事件键（全地牢出现，不受 ±1 规则限制）
export const UNIVERSAL_EVENT_TYPES = ['goddessStatue', 'trap', 'supplyPile', 'treasureChest', 'demonStatue'];

// 通用事件刷新概率（其余为限定事件概率）
export const UNIVERSAL_EVENT_CHANCE = 0.30;

// ============================================================
// 事件背景图（assets/scenes/dungeon-events/，与事件键一一对应）
// 15 个僵尸事件 + 15 个沼泽事件 + 15 个雪原事件 + 15 个废弃矿洞事件 + 5 个通用事件均有背景图映射。
// ============================================================

export const EVENT_BG_IMAGES = {
    collapsedMineShaft: 'assets/scenes/dungeon-events/collapsed-mine-shaft.png',
    abandonedOreCart: 'assets/scenes/dungeon-events/abandoned-ore-cart.png',
    canaryCage: 'assets/scenes/dungeon-events/canary-cage.png',
    dampFuseBox: 'assets/scenes/dungeon-events/damp-fuse-box.png',
    minersRationCache: 'assets/scenes/dungeon-events/miners-ration-cache.png',
    floodedLowerTunnel: 'assets/scenes/dungeon-events/flooded-lower-tunnel.png',
    exposedCrystalVein: 'assets/scenes/dungeon-events/exposed-crystal-vein.png',
    brokenMineLift: 'assets/scenes/dungeon-events/broken-mine-lift.png',
    toxicGasPocket: 'assets/scenes/dungeon-events/toxic-gas-pocket.png',
    lanternCode: 'assets/scenes/dungeon-events/lantern-code.png',
    foremanLedger: 'assets/scenes/dungeon-events/foreman-ledger.png',
    dynamiteMagazine: 'assets/scenes/dungeon-events/dynamite-magazine.png',
    oreSpiderNest: 'assets/scenes/dungeon-events/ore-spider-nest.png',
    hauntedRockDrill: 'assets/scenes/dungeon-events/haunted-rock-drill.png',
    sealedMainShaft: 'assets/scenes/dungeon-events/sealed-main-shaft.png',
    collapsedArchway: 'assets/scenes/dungeon-events/collapsed-archway.png',
    undeadScholarNotes: 'assets/scenes/dungeon-events/undead-scholar-notes.png',
    bloodAltar: 'assets/scenes/dungeon-events/blood-altar.png',
    mistyCrossroad: 'assets/scenes/dungeon-events/misty-crossroad.png',
    cursedArmor: 'assets/scenes/dungeon-events/cursed-armor.png',
    poisonMushroomCircle: 'assets/scenes/dungeon-events/poison-mushroom-circle.png',
    abyssalGambler: 'assets/scenes/dungeon-events/abyssal-gambler.png',
    blessedFountain: 'assets/scenes/dungeon-events/blessed-fountain.png',
    lockedArmory: 'assets/scenes/dungeon-events/locked-armory.png',
    phantomMirror: 'assets/scenes/dungeon-events/phantom-mirror.png',
    quarantineBell: 'assets/scenes/dungeon-events/quarantine-bell.png',
    corpseWaxWorkshop: 'assets/scenes/dungeon-events/corpse-wax-workshop.png',
    sealedSurvivorCell: 'assets/scenes/dungeon-events/sealed-survivor-cell.png',
    ossuaryOrgan: 'assets/scenes/dungeon-events/ossuary-organ.png',
    plagueSpecimenVault: 'assets/scenes/dungeon-events/plague-specimen-vault.png',
    frozenWaystone: 'assets/scenes/dungeon-events/frozen-waystone.png',
    snowboundSupplySled: 'assets/scenes/dungeon-events/snowbound-supply-sled.png',
    singingIceBridge: 'assets/scenes/dungeon-events/singing-ice-bridge.png',
    lostExpeditionCamp: 'assets/scenes/dungeon-events/lost-expedition-camp.png',
    frostberryHollow: 'assets/scenes/dungeon-events/frostberry-hollow.png',
    trappedWhiteStag: 'assets/scenes/dungeon-events/trapped-white-stag.png',
    auroraIceLanterns: 'assets/scenes/dungeon-events/aurora-ice-lanterns.png',
    avalancheWatchtower: 'assets/scenes/dungeon-events/avalanche-watchtower.png',
    frostboundCaravan: 'assets/scenes/dungeon-events/frostbound-caravan.png',
    whisperingGlacierCrevasse: 'assets/scenes/dungeon-events/whispering-glacier-crevasse.png',
    frozenChapel: 'assets/scenes/dungeon-events/frozen-chapel.png',
    iceFisherHole: 'assets/scenes/dungeon-events/ice-fisher-hole.png',
    blizzardSignalBrazier: 'assets/scenes/dungeon-events/blizzard-signal-brazier.png',
    crystalPrison: 'assets/scenes/dungeon-events/crystal-prison.png',
    ancientIceObservatory: 'assets/scenes/dungeon-events/ancient-ice-observatory.png',
    sunkenHerbalistBasket: 'assets/scenes/dungeon-events/sunken-herbalist-basket.png',
    weepingReedBed: 'assets/scenes/dungeon-events/weeping-reed-bed.png',
    leechBloomPool: 'assets/scenes/dungeon-events/leech-bloom-pool.png',
    willOWispTrail: 'assets/scenes/dungeon-events/will-o-wisp-trail.png',
    rottenRopeBridge: 'assets/scenes/dungeon-events/rotten-rope-bridge.png',
    bogHunterRemains: 'assets/scenes/dungeon-events/bog-hunter-remains.png',
    sunkenDruidShrine: 'assets/scenes/dungeon-events/sunken-druid-shrine.png',
    marshGasVents: 'assets/scenes/dungeon-events/marsh-gas-vents.png',
    rootPrison: 'assets/scenes/dungeon-events/root-prison.png',
    blackwaterFerry: 'assets/scenes/dungeon-events/blackwater-ferry.png',
    fireflyGraveIslet: 'assets/scenes/dungeon-events/firefly-grave-islet.png',
    frogBoneOracle: 'assets/scenes/dungeon-events/frog-bone-oracle.png',
    mudboundCaravan: 'assets/scenes/dungeon-events/mudbound-caravan.png',
    sunkenWitchCauldron: 'assets/scenes/dungeon-events/sunken-witch-cauldron.png',
    ancientCrocodileTotem: 'assets/scenes/dungeon-events/ancient-crocodile-totem.png',
    // 旧 5 事件
    goddessStatue: 'assets/scenes/dungeon-events/goddess-statue.png',
    trap: 'assets/scenes/dungeon-events/trap.png',
    supplyPile: 'assets/scenes/dungeon-events/supply-pile.png',
    treasureChest: 'assets/scenes/dungeon-events/treasure-chest.png',
    demonStatue: 'assets/scenes/dungeon-events/demon-statue.png',
};

// ============================================================
// 事件配置
// ============================================================

export const NEW_EVENT_CONFIGS = {
    collapsedMineShaft: {
        title: '坍塌的支护巷道',
        description: '腐朽木梁压在碎石上方，缝隙里吹出带煤尘的冷风。旧矿工留下的白粉箭头仍指向另一侧，说明这条路曾通往主矿脉。',
        choices: [
            { id: 'braceAndLift', label: '力量撑梁', description: '顶住支护梁并推开碎石', attribute: 'str', baseRate: 40, success: { text: '你重新卡紧木梁，推开碎石后找到一只遗落的钱袋。', gold: { min: 25, max: 45 }, material: { type: '铁矿石', count: 2 } }, fail: { text: '松动的石块砸中肩背，你只能狼狈退开。', damagePercent: 10 } },
            { id: 'crawlGap', label: '敏捷钻隙', description: '从支架下的狭缝穿过', attribute: 'dex', baseRate: 45, success: { text: '你贴着地面穿过狭缝，并看清了附近两条支路。', revealNodes: true, revealDepth: 1 }, fail: { text: '碎石割破护具，潜伏的矿工僵尸也被响声惊醒。', combat: 'normal', forceMonsters: ['minerZombie'], encounter: { combatWaves: 1, monstersPerWave: 4, tierWeights: { normal: 1, elite: 0 } } } },
            { id: 'markDetour', label: '标记绕行', description: '留下路标后寻找别的通道', outcome: { text: '你用白粉画下危险标记，沿较稳固的巷道继续前进。' } },
        ],
    },
    abandonedOreCart: {
        title: '脱轨的矿车',
        description: '一辆满载矿石的旧矿车斜卡在轨道岔口，车轮下压着工具箱，车斗深处偶尔传来抓挠声。',
        choices: [
            { id: 'leverCart', label: '力量撬车', description: '用钢钎抬起车轮取出工具箱', attribute: 'str', baseRate: 40, success: { text: '矿车被你撬回轨道，工具箱里仍有可用矿材。', material: { type: '铁矿石', count: 3 }, gold: { min: 20, max: 35 } }, fail: { text: '钢钎突然打滑，矿车撞上了你的腿。', damagePercent: 10 } },
            { id: 'inspectCart', label: '感知查车', description: '先辨认车斗里的动静', attribute: 'wis', baseRate: 45, success: { text: '你发现抓挠声来自松动矿石，安全取出了压在下方的药瓶。', hpPotion: POTION_HEAL }, fail: { text: '一只僵尸从车斗中扑出，附近同伴也循声靠近。', combat: 'normal', forceMonsters: ['zombie'], encounter: { combatWaves: 1, monstersPerWave: 4, tierWeights: { normal: 1, elite: 0 } } } },
            { id: 'leaveCart', label: '绕过矿车', description: '不碰这辆来历不明的矿车', outcome: { text: '你跨过弯曲铁轨，矿车在身后轻轻晃了一下。' } },
        ],
    },
    canaryCage: {
        title: '沉默的金丝雀笼',
        description: '一只黄铜鸟笼挂在通风管下，笼中的干枯金丝雀却仍会随着气流转头。笼底压着一张沾煤灰的通风图。',
        choices: [
            { id: 'readAirflow', label: '智力测风', description: '根据羽毛和烛烟判断安全风向', attribute: 'int', baseRate: 45, success: { text: '你避开了污浊气流，并从通风图上找到了近路。', revealNodes: true, revealDepth: 2 }, fail: { text: '你误入积聚毒气的死角，肺部一阵灼痛。', damagePercent: 10 } },
            { id: 'openCage', label: '幸运开笼', description: '打开鸟笼寻找矿工藏物', attribute: 'luck', baseRate: 35, success: { text: '鸟笼夹层里藏着几枚工资币和一小袋魔尘。', gold: { min: 25, max: 45 }, specialItems: [{ type: 'magic_dust', count: 20 }] }, fail: { text: '铜铃机关突然作响，引来了游荡的毒液僵尸。', combat: 'normal', forceMonsters: ['spitterZombie'], encounter: { combatWaves: 1, monstersPerWave: 4, tierWeights: { normal: 1, elite: 0 } } } },
            { id: 'coverCage', label: '盖布离开', description: '用旧布遮住鸟笼', outcome: { text: '鸟笼停止转动，通风管里只剩低沉风声。' } },
        ],
    },
    dampFuseBox: {
        title: '受潮的爆破箱',
        description: '木箱中盘着几束受潮导火索，旁边的手摇起爆器仍连着通向塌方区的铜线。箱盖写着“二号支洞清障”。',
        choices: [
            { id: 'repairIgniter', label: '智力修线', description: '重接铜线并控制爆破', attribute: 'int', baseRate: 40, success: { text: '定向爆破掀开一处暗格，里面堆着备用矿材。', material: { type: '铁矿石', count: 3 }, revealNodes: true, revealDepth: 1 }, fail: { text: '受潮线路短路，爆震把碎石扫向你。', damagePercent: 15 } },
            { id: 'pullFuse', label: '敏捷拆索', description: '在火花蔓延前拆除危险导火索', attribute: 'dex', baseRate: 45, success: { text: '你拆下了尚能使用的火药包，并在箱底找到工资币。', gold: { min: 30, max: 50 } }, fail: { text: '火花落进煤尘，爆响惊醒了附近僵尸。', combat: 'normal', forceMonsters: ['zombie'], encounter: { combatWaves: 1, monstersPerWave: 5, tierWeights: { normal: 1, elite: 0 } } } },
            { id: 'soakFuses', label: '浇水封箱', description: '彻底浸湿导火索后离开', outcome: { text: '你把爆破箱压在碎石下，避免它继续威胁后来者。' } },
        ],
    },
    minersRationCache: {
        title: '矿工口粮窖',
        description: '墙后的小窖里堆着铁皮饭盒、盐肉罐和几只药瓶。木门上有新鲜抓痕，地面却没有活人的脚印。',
        choices: [
            { id: 'inspectRations', label: '体质试食', description: '辨认可安全食用的口粮', attribute: 'con', baseRate: 45, success: { text: '盐封口粮仍可食用，你恢复了体力并带走一瓶药剂。', healPercent: 15, hpPotion: POTION_HEAL }, fail: { text: '霉菌让你一阵眩晕，胃部也开始抽痛。', damagePercent: 10 } },
            { id: 'searchFalseWall', label: '幸运搜墙', description: '寻找矿工私藏的夹层', attribute: 'luck', baseRate: 35, success: { text: '你在松砖后找到一袋未发完的工钱。', gold: { min: 35, max: 60 } }, fail: { text: '夹层里的铁罐滚落，响声引来了矿工僵尸。', combat: 'normal', forceMonsters: ['minerZombie'], encounter: { combatWaves: 1, monstersPerWave: 4, tierWeights: { normal: 1, elite: 0 } } } },
            { id: 'barDoor', label: '封住窖门', description: '不取食物，防止里面的东西出来', outcome: { text: '你用铁轨顶住窖门，抓挠声渐渐停了。' } },
        ],
    },
    floodedLowerTunnel: {
        title: '被淹的下层巷道',
        description: '黑水淹到腰部，水下轨道通往一扇半开的铁门。断续气泡沿墙脚冒出，远处漂着一盏仍亮着的矿灯。',
        choices: [
            { id: 'crossFlood', label: '体质涉水', description: '顶着冰冷积水穿过巷道', attribute: 'con', baseRate: 35, success: { text: '你稳稳穿过急流，并从漂浮工具袋中取到药剂。', hpPotion: POTION_HEAL, mpPotion: POTION_MP }, fail: { text: '水下有东西缠住脚踝，你挣脱时已受了伤。', damagePercent: 15 } },
            { id: 'traceBubbles', label: '感知寻路', description: '借气泡判断水下坑洞', attribute: 'wis', baseRate: 40, success: { text: '你沿安全轨枕前进，顺便看清了相邻巷道结构。', revealNodes: true, revealDepth: 2 }, fail: { text: '提灯僵尸从水雾中现身，截断了退路。', combat: 'elite', forceMonsters: ['lanternMinerZombie'], encounter: { combatWaves: 1, monstersPerWave: 5, monsterComposition: { elite: 1, normal: 4 } } } },
            { id: 'drainLater', label: '退回高处', description: '放弃下层路线', outcome: { text: '你在墙上刻下水位，转向较高的巷道。' } },
        ],
    },
    exposedCrystalVein: {
        title: '裸露的晶矿脉',
        description: '蓝白晶体从岩壁裂隙中生长出来，细小电弧在晶簇间跳跃。矿脉深处夹着数块未经开采的高纯矿石。',
        choices: [
            { id: 'cutCrystal', label: '力量凿矿', description: '控制力道凿下完整晶体', attribute: 'str', baseRate: 35, success: { text: '晶体沿天然纹理整齐断开，可直接用于强化。', material: { type: '精金碎片', count: 2 }, specialItems: [{ type: 'enhancement_stone', count: 1 }] }, fail: { text: '晶簇炸裂，碎片和电弧同时击中你。', damagePercent: 15 } },
            { id: 'groundArc', label: '智力导流', description: '用废铁轨引走晶体电荷', attribute: 'int', baseRate: 35, success: { text: '电荷被安全导走，凝结的魔力化成一袋魔尘。', specialItems: [{ type: 'magic_dust', count: 40 }], mpRestorePercent: 15 }, fail: { text: '导流惊动了藏在晶簇后的矿石蜘蛛。', combat: 'elite', forceMonsters: ['oreSpider'], encounter: { combatWaves: 1, monstersPerWave: 5, monsterComposition: { elite: 1, normal: 4 } } } },
            { id: 'leaveVein', label: '不扰矿脉', description: '避开不稳定晶簇', outcome: { text: '你熄灭火把，从晶矿脉另一侧安静离开。' } },
        ],
    },
    brokenMineLift: {
        title: '断索升降机',
        description: '木制升降平台悬在深井上方，只剩一根主缆和生锈制动器维持平衡。对岸控制台旁放着一只上锁的领料箱。',
        choices: [
            { id: 'holdBrake', label: '力量稳闸', description: '压住制动器让平台靠岸', attribute: 'str', baseRate: 35, success: { text: '平台平稳滑到对岸，领料箱里装着工资和矿材。', gold: { min: 45, max: 75 }, material: { type: '铁矿石', count: 3 } }, fail: { text: '制动器突然回弹，你被钢柄重重击中。', damagePercent: 15 } },
            { id: 'repairCable', label: '敏捷接索', description: '踩着横梁重新挂接副缆', attribute: 'dex', baseRate: 30, success: { text: '副缆重新受力，升降井旁的支线也显露出来。', revealNodes: true, revealDepth: 2 }, fail: { text: '挂钩坠落的巨响引来了提灯巡工。', combat: 'elite', forceMonsters: ['lanternMinerZombie'], encounter: { combatWaves: 1, monstersPerWave: 5, monsterComposition: { elite: 1, normal: 4 } } } },
            { id: 'avoidLift', label: '沿检修梯走', description: '不冒险使用升降机', outcome: { text: '你沿井壁检修梯缓慢下行，最终抵达另一层。' } },
        ],
    },
    toxicGasPocket: {
        title: '有毒瓦斯囊',
        description: '前方空气像热浪般扭曲，墙上的安全灯焰芯已经变成幽蓝色。地面散落着被仓促丢弃的湿布面罩。',
        choices: [
            { id: 'ventGas', label: '智力通风', description: '重启风门排出瓦斯', attribute: 'int', baseRate: 35, success: { text: '风门轰鸣着开启，安全路线和一处隐藏储藏格同时显露。', revealNodes: true, revealDepth: 2, gold: { min: 35, max: 60 } }, fail: { text: '齿轮卡死，泄出的瓦斯让你头晕目眩。', damagePercent: 15, mpRestorePercent: -10 } },
            { id: 'dashPocket', label: '体质憋气', description: '戴湿布快速冲过毒气区', attribute: 'con', baseRate: 40, success: { text: '你在呼吸耗尽前穿过毒气区，还带出一瓶密封药剂。', hpPotion: POTION_HEAL }, fail: { text: '你在出口处咳出声，毒液僵尸循声包围过来。', combat: 'normal', forceMonsters: ['spitterZombie'], encounter: { combatWaves: 1, monstersPerWave: 5, tierWeights: { normal: 1, elite: 0 } } } },
            { id: 'sealPocket', label: '封闭巷道', description: '放下警示牌并关闭风门', outcome: { text: '你封住这段巷道，沿回风侧的旧路绕行。' } },
        ],
    },
    lanternCode: {
        title: '矿灯暗号',
        description: '对面巷道每隔数秒亮起一盏矿灯，三短一长的闪烁重复不止。岩壁上残留着旧矿队的暗号表。',
        choices: [
            { id: 'decodeSignal', label: '智力译码', description: '按暗号表解读矿灯信息', attribute: 'int', baseRate: 35, success: { text: '暗号标出了塌方、补给点和一条安全近路。', revealNodes: true, revealDepth: 2, mpPotion: POTION_MP }, fail: { text: '你回应了错误暗号，提灯僵尸立刻向这里逼近。', combat: 'elite', forceMonsters: ['lanternMinerZombie'], encounter: { combatWaves: 1, monstersPerWave: 5, monsterComposition: { elite: 1, normal: 4 } } } },
            { id: 'followLight', label: '幸运追灯', description: '不解码，直接追随最后亮起的矿灯', attribute: 'luck', baseRate: 30, success: { text: '矿灯照着一只密封工资箱，锁扣早已锈坏。', gold: { min: 55, max: 90 }, specialItems: [{ type: 'reforge_ticket', count: 1 }] }, fail: { text: '灯光把你带进矿石蜘蛛的巢区。', combat: 'elite', forceMonsters: ['oreSpider'], encounter: { combatWaves: 1, monstersPerWave: 5, monsterComposition: { elite: 1, normal: 4 } } } },
            { id: 'extinguishSignal', label: '熄灯绕行', description: '不回应未知矿队', outcome: { text: '你遮住自己的光源，矿灯暗号在远处自行熄灭。' } },
        ],
    },
    foremanLedger: {
        title: '工头的黑账本',
        description: '皮封账本被钉在值班室桌面，记录着克扣的工资、秘密矿脉和“事故处理费”。最后几页的墨迹仍像刚写下。',
        choices: [
            { id: 'auditLedger', label: '智力查账', description: '从账目中找出秘密仓库', attribute: 'int', baseRate: 30, success: { text: '你还原了仓库编号，取回被私吞的工资和改造物资。', gold: { min: 70, max: 110 }, specialItems: [{ type: 'reforge_ticket', count: 1 }] }, fail: { text: '账本上的诅咒烙进视野，思绪变得迟钝。', buff: { id: 'foremanDebtMark', name: '工头债印', icon: '📒', color: '#7a5a3a', matkPercent: -15, durationBattles: 3 } } },
            { id: 'tearPages', label: '精神毁账', description: '撕毁写有矿工姓名的契约页', attribute: 'wis', baseRate: 30, success: { text: '束缚亡魂的契约被解除，残留意志为你指出深层路线。', revealNodes: true, revealDepth: 3, buff: { id: 'minersGratitude', name: '矿工谢意', icon: '⛏', color: '#c6a56b', defPercent: 10, durationBattles: 3 } }, fail: { text: '工头的吼声从巷道深处传来，沉重脚步迅速逼近。', combat: 'elite', forceMonsters: ['foremanZombie'], encounter: { combatWaves: 1, monstersPerWave: 5, monsterComposition: { lord: 1, normal: 4 } } } },
            { id: 'closeLedger', label: '合上账本', description: '不触碰死者留下的账目', outcome: { text: '你用铁链重新缠住账本，值班室里的低语逐渐消失。' } },
        ],
    },
    dynamiteMagazine: {
        title: '炸药储藏库',
        description: '厚木门后整齐堆着老式炸药箱，部分药卷已渗出油迹。墙上矿脉图标出了尚未打通的富矿区。',
        choices: [
            { id: 'stabilizeDynamite', label: '敏捷排险', description: '逐根分离渗油炸药', attribute: 'dex', baseRate: 30, success: { text: '危险药卷被安全隔离，你在箱底找到强化石和工资币。', gold: { min: 65, max: 100 }, specialItems: [{ type: 'enhancement_stone', count: 1 }] }, fail: { text: '药卷摩擦起火，冲击波将你掀出门外。', damagePercent: 20 } },
            { id: 'blastRichVein', label: '智力定爆', description: '按矿脉图实施一次定向爆破', attribute: 'int', baseRate: 25, success: { text: '爆破准确揭开富矿层，大块精金碎片散落出来。', material: { type: '精金碎片', count: 3 }, specialItems: [{ type: 'magic_dust', count: 50 }] }, fail: { text: '爆破震开了附近封堵的矿洞，里面的怪物涌了出来。', combat: 'normal', forceMonsters: ['mineCave'], encounter: { combatWaves: 1, monstersPerWave: 5, tierWeights: { normal: 1, elite: 0 } } } },
            { id: 'floodMagazine', label: '放水封库', description: '引来积水彻底浸毁炸药', outcome: { text: '炸药失去作用，这间危险仓库再也不会突然爆炸。' } },
        ],
    },
    oreSpiderNest: {
        title: '矿石蜘蛛巢',
        description: '晶亮蛛丝覆盖整面岩壁，矿石碎片像卵一样包在丝囊中。巢心悬着一只装满工资币的皮包。',
        choices: [
            { id: 'burnWebs', label: '智力控火', description: '用小火烧断外层蛛丝', attribute: 'int', baseRate: 30, success: { text: '火势没有触及矿尘，你取下皮包和数块完整矿石。', gold: { min: 70, max: 110 }, material: { type: '精金碎片', count: 2 } }, fail: { text: '热浪让卵囊同时破裂，矿石蜘蛛从巢心跃下。', combat: 'elite', forceMonsters: ['oreSpider'], encounter: { combatWaves: 1, monstersPerWave: 6, monsterComposition: { elite: 1, normal: 5 } } } },
            { id: 'threadNeedle', label: '敏捷穿巢', description: '沿蛛丝空隙取下皮包', attribute: 'dex', baseRate: 25, success: { text: '你没有触动警戒丝，还从巢后发现一条隐蔽矿道。', revealNodes: true, revealDepth: 2, specialItems: [{ type: 'reforge_ticket', count: 1 }] }, fail: { text: '警戒丝剧烈震动，蛛群封住了所有出口。', combat: 'elite', forceMonsters: ['oreSpider'], encounter: { combatWaves: 1, monstersPerWave: 6, monsterComposition: { elite: 1, normal: 5 } } } },
            { id: 'collapseNest', label: '推石封巢', description: '放弃皮包，把巢穴封在岩缝中', outcome: { text: '巨石压住巢口，蛛丝在缝隙里颤动片刻便安静下来。' } },
        ],
    },
    hauntedRockDrill: {
        title: '自鸣的凿岩机',
        description: '一台蒸汽凿岩机在无人操纵下周期性敲击岩壁，每次落锤都伴随矿工号子的回声。压力表已逼近红区。',
        choices: [
            { id: 'tuneDrill', label: '智力调机', description: '释放压力并校正钻头', attribute: 'int', baseRate: 25, success: { text: '凿岩机恢复稳定，钻出的晶矿可直接用于强化。', material: { type: '精金碎片', count: 3 }, specialItems: [{ type: 'enhancement_stone', count: 1 }] }, fail: { text: '蒸汽管爆裂，高温碎屑划伤了你。', damagePercent: 20 } },
            { id: 'matchChant', label: '精神和声', description: '按矿工号子的节拍操作手柄', attribute: 'wis', baseRate: 30, success: { text: '亡魂完成最后一次掘进，留下祝福与通往主脉的路线。', revealNodes: true, revealDepth: 3, buff: { id: 'minersCadence', name: '掘进节拍', icon: '⚙️', color: '#b48a5a', atkPercent: 10, moveSpeedPercent: 10, durationBattles: 3 } }, fail: { text: '错误节拍激怒了亡魂，工头带着巡工从黑暗中出现。', combat: 'elite', forceMonsters: ['foremanZombie', 'lanternMinerZombie'], encounter: { combatWaves: 1, monstersPerWave: 6, monsterComposition: { lord: 1, elite: 1, normal: 4 } } } },
            { id: 'releaseBoiler', label: '泄压停机', description: '关闭燃料阀让机器沉默', outcome: { text: '最后一缕蒸汽散去，矿工号子也随之停止。' } },
        ],
    },
    sealedMainShaft: {
        title: '封死的主矿井',
        description: '刻着事故日期的钢门封住主井，门后不断传来矿镐敲击声。观察窗里只有一排摇曳矿灯和深不见底的下行轨道。',
        choices: [
            { id: 'readSeal', label: '精神辨封印', description: '判断敲击声是否来自受困亡魂', attribute: 'wis', baseRate: 25, success: { text: '你读懂亡魂敲出的警告，避开主井并获知深层安全路线。', revealNodes: true, revealDepth: 3, mpRestorePercent: 20 }, fail: { text: '敲击声侵入意识，你的防备被持续削弱。', buff: { id: 'deepShaftEcho', name: '深井回声', icon: '🕳️', color: '#52515f', defPercent: -15, durationBattles: 3 } } },
            { id: 'openBulkhead', label: '力量开门', description: '转动锈死的主井门轮', attribute: 'str', baseRate: 25, success: { text: '钢门只开启一道安全缝隙，你从值班柜中取到主井奖励。', gold: { min: 90, max: 140 }, specialItems: [{ type: 'enhancement_stone', count: 1 }, { type: 'reforge_ticket', count: 1 }] }, fail: { text: '门轮崩断，工头和巡工从主井黑暗中冲出。', combat: 'elite', forceMonsters: ['foremanZombie', 'lanternMinerZombie'], encounter: { combatWaves: 1, monstersPerWave: 6, monsterComposition: { lord: 1, elite: 1, normal: 4 } } } },
            { id: 'reinforceSeal', label: '加固封门', description: '把备用铁轨焊在钢门外', outcome: { text: '你加固了主井封门，但门后的敲击随即变成急促的追赶声。', combat: 'normal', forceMonsters: ['minerZombie', 'spitterZombie'], encounter: { combatWaves: 1, monstersPerWave: 6, tierWeights: { normal: 1, elite: 0 } } } },
        ],
    },
    sunkenHerbalistBasket: {
        title: '沉没的药师竹篓',
        description: '一只编着青藤纹样的竹篓半沉在黑水里，周围漂着被咬碎的药叶。篓盖下仍透出温暖的琥珀光，说明里面的药剂尚未完全被沼水污染；但水面细小的涟漪也暴露了潜伏在泥下的东西。',
        choices: [
            {
                id: 'identifyMedicine', label: '智力辨药', description: '分辨污染程度并取出可用药剂',
                attribute: 'int', baseRate: 40,
                success: { text: '你用叶脉颜色和瓶塞气味排除了受污染的药剂，剩下两瓶仍能安全使用。', hpPotion: POTION_HEAL, mpPotion: POTION_MP },
                fail: { text: '一只药瓶在你手中炸裂，腐败药液灼伤了皮肤。', damagePercent: 10 },
            },
            {
                id: 'snatchBasket', label: '幸运捞取', description: '趁水下生物尚未靠近，直接捞走竹篓',
                attribute: 'luck', baseRate: 30,
                success: { text: '竹篓被你完整捞起，夹层里还藏着药师收取的诊金和一包草药。', gold: { min: 30, max: 50 }, material: { type: '古老木材', count: 2 } },
                fail: { text: '竹篓下系着一串骨铃，铃声引来了藏在芦苇后的黑狼。', combat: 'normal', forceMonsters: ['blackWolf'], encounter: { combatWaves: 1, monstersPerWave: 4, tierWeights: { normal: 1, elite: 0 } } },
            },
            { id: 'leave', label: '不碰竹篓', description: '绕开这片可疑的积水', outcome: { text: '你记住竹篓的位置，沿较干燥的泥脊继续前进。' } },
        ],
    },
    weepingReedBed: {
        title: '哭泣的芦苇荡',
        description: '一片比人还高的灰白芦苇无风自摆，叶片摩擦出的声音像许多人压低嗓音哭泣。水面上漂着指向不同岔路的草结，偶尔有一束芦花逆着雾流转动，仿佛在试图为你指出方向。',
        choices: [
            {
                id: 'listenReeds', label: '精神聆听', description: '从哭声中辨认真正的指引', attribute: 'wis', baseRate: 40,
                success: { text: '你听出哭声其实是旧日巡林人留下的节拍暗号，安全路线在脑海中逐渐清晰。', revealNodes: true, revealDepth: 2, mpRestorePercent: 10 },
                fail: { text: '重叠的哭声钻进脑海，让你的脚步在泥水里变得迟缓。', buff: { id: 'reedLament', name: '芦苇哀鸣', icon: '🌾', color: '#8b9670', moveSpeedPercent: -15, durationBattles: 3 } },
            },
            {
                id: 'followSeed', label: '敏捷追絮', description: '追上逆风飘动的芦花', attribute: 'dex', baseRate: 35,
                success: { text: '你踩着露出水面的树根追上芦花，在它落下的位置挖出一只密封钱袋。', gold: { min: 25, max: 45 } },
                fail: { text: '一根藏在水下的断木绊住脚踝，锋利芦叶在你身上划出数道伤口。', damagePercent: 15 },
            },
            { id: 'leave', label: '堵耳离开', description: '拒绝理会芦苇的声音', outcome: { text: '你撕下一块布堵住耳朵，贴着芦苇荡边缘离开。' } },
        ],
    },
    leechBloomPool: {
        title: '血蛭花池',
        description: '暗红色水花在一口浅池中缓慢开合，每朵花心都蜷着一条透明水蛭。池底散落着药师用来炼制止血剂的血囊，石墩间则留有一条勉强可以跳过水面的旧路。',
        choices: [
            {
                id: 'harvestSacs', label: '智力采囊', description: '按血蛭收缩节奏采集血囊', attribute: 'int', baseRate: 35,
                success: { text: '你在花瓣闭合前取出完整血囊，炼药成分没有受到污染。', hpPotion: POTION_HEAL, specialItems: [{ type: 'magic_dust', count: 25 }] },
                fail: { text: '血蛭群骤然扑上手臂，直到你冲出水池才一一甩脱。', damagePercent: 15 },
            },
            {
                id: 'crossStones', label: '敏捷踏石', description: '沿残破石墩跳过花池', attribute: 'dex', baseRate: 40,
                success: { text: '你稳稳落在对岸，还从最后一块石墩下摸出一枚旧钱匣。', revealNodes: true, revealDepth: 1, gold: { min: 20, max: 35 } },
                fail: { text: '湿滑的苔藓让你跌入池中，血蛭很快吸附在护甲缝隙里。', damagePercent: 20 },
            },
            { id: 'leave', label: '绕行花池', description: '从更远的浅滩绕路', outcome: { text: '你放弃池底的材料，花了些时间从上游绕了过去。' } },
        ],
    },
    willOWispTrail: {
        title: '鬼火引路',
        description: '数团青绿色鬼火从腐木后依次亮起，在雾中排成一条通往深处的曲线。它们有时照亮刻着路标的老树，有时又故意停在看不见底的黑水上方，像是在试探你是否值得被带往目的地。',
        choices: [
            {
                id: 'readWisps', label: '精神辨火', description: '分辨守路灵与诱魂火', attribute: 'wis', baseRate: 35,
                success: { text: '你认出颜色最稳定的守路灵，跟随它们穿过了一段隐藏捷径。', revealNodes: true, revealDepth: 2, gold: { min: 35, max: 55 } },
                fail: { text: '诱魂火把你带进狼群的伏击圈，随后在树梢上发出尖细笑声。', combat: 'normal', forceMonsters: ['blackWolf'], encounter: { combatWaves: 1, monstersPerWave: 5, tierWeights: { normal: 1, elite: 0 } } },
            },
            {
                id: 'trustBrightest', label: '幸运追光', description: '追随最明亮的那团鬼火', attribute: 'luck', baseRate: 25,
                success: { text: '鬼火停在一具沉箱上方，箱内金币和强化石仍被油布包得严严实实。', gold: { min: 60, max: 90 }, specialItems: [{ type: 'enhancement_stone', count: 1 }] },
                fail: { text: '最亮的鬼火正是诱饵，黑狼从雾中封住了退路。', combat: 'normal', forceMonsters: ['blackWolf'], encounter: { combatWaves: 1, monstersPerWave: 5, tierWeights: { normal: 1, elite: 0 } } },
            },
            { id: 'leave', label: '熄灯绕行', description: '用泥水遮住火光，拒绝跟随', outcome: { text: '鬼火在身后盘旋片刻，最终失去兴趣，逐一熄灭。' } },
        ],
    },
    rottenRopeBridge: {
        title: '腐木索桥',
        description: '一座用腐木板和草绳绑成的索桥横跨深褐色泥潭，桥下不断冒出吞咽般的气泡。对岸的树桩上挂着几只补给袋，而桥侧还堆着修桥人留下的木料和金属扣件。',
        choices: [
            {
                id: 'dashBridge', label: '敏捷疾渡', description: '在木板断裂前冲到对岸', attribute: 'dex', baseRate: 35,
                success: { text: '你借着索桥摆动的节奏快速通过，并取走了对岸遗留的钱袋。', revealNodes: true, revealDepth: 1, gold: { min: 35, max: 55 } },
                fail: { text: '桥板在脚下断裂，你撞上侧绳后才勉强爬回岸边。', damagePercent: 20 },
            },
            {
                id: 'reinforceBridge', label: '力量加固', description: '重新绷紧草绳并更换承重木板', attribute: 'str', baseRate: 35,
                success: { text: '你修好了关键承重点，剩余扣件和硬木也被一并收进背包。', material: { type: '古老木材', count: 3 }, specialItems: [{ type: 'enhancement_stone', count: 1 }] },
                fail: { text: '腐烂桥柱突然倾倒，飞起的绳扣狠狠抽中了你的肩膀。', damagePercent: 15 },
            },
            { id: 'leave', label: '沿岸寻找浅滩', description: '放弃桥上的补给，安全绕行', outcome: { text: '你沿着泥潭边缘走了很久，最终找到一段可以涉水通过的浅滩。' } },
        ],
    },
    bogHunterRemains: {
        title: '沼猎人的遗骸',
        description: '一具披着鳄皮斗篷的猎人遗骸倚在空心树旁，弩箭仍指向雾中的某个方向。腰包被树根缠住，胸前护符却干净得反常；附近泥地上留着成圈的狼爪印。',
        choices: [
            {
                id: 'inspectHunter', label: '智力验尸', description: '先找出猎人的死因和机关', attribute: 'int', baseRate: 35,
                success: { text: '你避开腰包下的骨针机关，从猎具中拆下完好的皮革和改造零件。', material: { type: '皮革碎片', count: 3 }, specialItems: [{ type: 'reforge_ticket', count: 1 }] },
                fail: { text: '骨针机关击响了猎人的警铃，循味而来的黑狼立刻扑出。', combat: 'normal', forceMonsters: ['blackWolf'], encounter: { combatWaves: 1, monstersPerWave: 5, tierWeights: { normal: 1, elite: 0 } } },
            },
            {
                id: 'takeTalisman', label: '幸运取符', description: '直接摘下没有沾泥的护符', attribute: 'luck', baseRate: 30,
                success: { text: '护符中残存的猎手祝福与你产生共鸣，雾中的脚印也变得清晰。', gold: { min: 30, max: 50 }, buff: { id: 'bogHunterInstinct', name: '沼猎直觉', icon: '🏹', color: '#a59a62', atkPercent: 10, moveSpeedPercent: 10, durationBattles: 3 } },
                fail: { text: '护符翻面后露出诅咒刻痕，沉重的猎杀执念压在你的护甲上。', buff: { id: 'hunterBurden', name: '猎手重负', icon: '🦴', color: '#786b55', defPercent: -10, moveSpeedPercent: -10, durationBattles: 3 } },
            },
            { id: 'buryHunter', label: '就地掩埋', description: '不取遗物，让猎人安息', outcome: { text: '你用泥土和苔藓盖住遗骸，远处狼嚎随之渐渐平息。' } },
        ],
    },
    sunkenDruidShrine: {
        title: '沉没的林神祭坛',
        description: '长着鹿角的石像只剩上半身露出水面，藤蔓在它掌心编成一只盛满清水的碗。祭坛周围的树根一半鲜绿、一半腐黑，古老自然力量与沼泽腐化正在这里彼此拉扯。',
        choices: [
            {
                id: 'prayDruid', label: '精神祈祷', description: '回应尚未消散的林神意志', attribute: 'wis', baseRate: 35,
                success: { text: '清水化作温暖绿光流遍全身，藤蔓为你指向没有腐化的道路。', healPercent: 20, mpRestorePercent: 20, buff: { id: 'druidShelter', name: '林神庇护', icon: '🌿', color: '#65a86f', defPercent: 10, durationBattles: 3 } },
                fail: { text: '你触碰到的不是林神，而是盘踞在石像裂缝中的腐化意志。', mpRestorePercent: -15, buff: { id: 'swampWhisper', name: '沼语侵扰', icon: '🌀', color: '#63745b', matkPercent: -10, durationBattles: 3 } },
            },
            {
                id: 'purgeRoots', label: '体质净根', description: '忍受腐液灼烧，拔除黑色根须', attribute: 'con', baseRate: 30,
                success: { text: '黑根在你手中化为灰烬，祭坛回赠一团纯净魔力和短暂的野性力量。', specialItems: [{ type: 'magic_dust', count: 35 }], buff: { id: 'wildSap', name: '野性树液', icon: '🍂', color: '#91a34f', atkPercent: 10, durationBattles: 3 } },
                fail: { text: '腐液穿过手套灼入血肉，你只能在根须缠紧前强行挣脱。', damagePercent: 20 },
            },
            { id: 'leave', label: '不扰祭坛', description: '保持距离，沿水边离开', outcome: { text: '石像无声注视着你离开，掌心的清水重新恢复平静。' } },
        ],
    },
    marshGasVents: {
        title: '沼气喷口',
        description: '一片龟裂泥地正不断吐出黄绿色气泡，锈蚀管道和炼金玻璃埋在泥层下方。每次气泡破裂，地底都会短暂映出金属箱的轮廓；但空气中的火星说明这里随时可能爆燃。',
        choices: [
            {
                id: 'controlledIgnition', label: '智力引燃', description: '计算气流间隙，定向引爆沼气', attribute: 'int', baseRate: 30,
                success: { text: '爆燃沿预定方向掀开泥层，埋藏的炼金箱和附近地形一览无余。', revealNodes: true, revealDepth: 2, gold: { min: 60, max: 80 } },
                fail: { text: '气流回卷，爆焰从脚边喷出，将你重重掀翻。', damagePercent: 25 },
            },
            {
                id: 'collectCondensate', label: '敏捷集露', description: '在喷口之间收集炼金凝露', attribute: 'dex', baseRate: 30,
                success: { text: '你踩着气泡喷发的间隙装满一瓶凝露，其中凝结出高纯魔尘。', specialItems: [{ type: 'magic_dust', count: 50 }, { type: 'enhancement_stone', count: 1 }] },
                fail: { text: '一股浓雾正面喷来，麻痹性气体让双腿像灌了铅。', buff: { id: 'marshGasNumbness', name: '沼气麻痹', icon: '☁️', color: '#9a9b45', moveSpeedPercent: -20, durationBattles: 3 } },
            },
            { id: 'leave', label: '逆风撤离', description: '沿上风口绕开喷气区', outcome: { text: '你用湿布掩住口鼻，沿风向变化谨慎退出这片泥地。' } },
        ],
    },
    rootPrison: {
        title: '活根囚笼',
        description: '数十条粗大树根在沼泽中央拱成牢笼，里面封着一只覆满红毛的狼形怪物和几只探险箱。树根会随着呼吸收紧，符文般的菌斑则在外层明灭，显然既是封印也是警报。',
        choices: [
            {
                id: 'breakRoots', label: '力量破根', description: '砸开外层根须，抢先取走箱子', attribute: 'str', baseRate: 25,
                success: { text: '你在囚笼完全苏醒前撕开一道缺口，带走箱中财物后重新压住根须。', gold: { min: 50, max: 80 }, specialItems: [{ type: 'reforge_ticket', count: 2 }] },
                fail: { text: '断根触发了封印，牢笼骤然张开，被囚禁的红狼王带着怒火冲出。', combat: 'elite', forceMonsters: ['redWolfKing'], encounter: { combatWaves: 1, monstersPerWave: 1, tierWeights: { normal: 0, elite: 1 } } },
            },
            {
                id: 'readRootRunes', label: '精神安抚', description: '顺着菌斑脉动安抚活根', attribute: 'wis', baseRate: 30,
                success: { text: '活根放松下来，在泥地上勾出附近路线，并将封印余力分给了你。', revealNodes: true, revealDepth: 2, buff: { id: 'livingRootWard', name: '活根护符', icon: '🌱', color: '#6f9550', defPercent: 15, matkPercent: 10, durationBattles: 3 } },
                fail: { text: '菌斑把你的意志当成入侵，根须抽打地面，附近黑狼循声围来。', combat: 'normal', forceMonsters: ['blackWolf'], encounter: { combatWaves: 1, monstersPerWave: 6, tierWeights: { normal: 1, elite: 0 } } },
            },
            { id: 'leave', label: '保持封印', description: '不碰囚笼，悄悄退开', outcome: { text: '你没有惊动囚笼，红色身影始终隔着根须盯着你远去。' } },
        ],
    },
    blackwaterFerry: {
        title: '黑水渡船',
        description: '一艘没有船夫的窄木船停在黑水岸边，船头挂着鹿骨灯，船舱里堆着覆满湿苔的旧货箱。每当雾气扫过，水中就浮现一位披斗篷的摆渡人倒影，伸手示意你登船。',
        choices: [
            {
                id: 'appeaseFerryman', label: '精神问渡', description: '按古老礼节向水中倒影询问航路', attribute: 'wis', baseRate: 30,
                success: { text: '摆渡人的倒影点头致意，船自行穿过迷雾，并在安全岸边留下一袋旧币。', revealNodes: true, revealDepth: 2, healPercent: 10, gold: { min: 40, max: 60 } },
                fail: { text: '倒影突然抓住船沿，寒意侵入意识，远岸的路径也在眼前扭曲。', mpRestorePercent: -20, buff: { id: 'blackwaterChill', name: '黑水寒意', icon: '🕯️', color: '#55777c', atkPercent: -10, matkPercent: -10, durationBattles: 3 } },
            },
            {
                id: 'searchCargo', label: '幸运翻舱', description: '在船启动前搜查湿苔货箱', attribute: 'luck', baseRate: 20,
                success: { text: '你挑中了唯一没有被水浸透的箱子，里面装着大笔金币和两块强化石。', gold: { min: 100, max: 140 }, specialItems: [{ type: 'enhancement_stone', count: 2 }] },
                fail: { text: '货箱里涌出冰冷黑水，船身猛然倾斜，你在沉船前狼狈跳回岸上。', damagePercent: 25, buff: { id: 'waterloggedArmor', name: '浸水护甲', icon: '💧', color: '#4c6f78', defPercent: -15, moveSpeedPercent: -10, durationBattles: 3 } },
            },
            { id: 'leave', label: '拒绝登船', description: '沿岸寻找别的通路', outcome: { text: '骨灯在雾中缓缓远去，空船无声滑向黑水深处。' } },
        ],
    },
    fireflyGraveIslet: {
        title: '萤火墓洲',
        description: '一座被浅水包围的小土洲上立着数十块无名木牌，成群的金绿萤火虫在牌间缓慢飞行。每当它们聚成一束光，某块墓牌下便会传来轻微敲击声；水边还散落着探险者留下的密封钱筒。',
        choices: [
            {
                id: 'listenFireflies', label: '精神聆光', description: '跟随萤火的明灭节奏聆听亡者提示', attribute: 'wis', baseRate: 40,
                success: { text: '萤火在你眼前组成一条短暂光路，墓洲周围的安全岔道随之显现。', revealNodes: true, revealDepth: 2, mpRestorePercent: 10 },
                fail: { text: '过多低语同时涌入意识，残留的哀念扰乱了你的魔力流动。', buff: { id: 'graveMurmur', name: '墓洲低语', icon: '🪦', color: '#7d8862', matkPercent: -10, durationBattles: 3 } },
            },
            {
                id: 'catchBrightSwarm', label: '幸运收萤', description: '捕捉聚成光团的稀有萤火', attribute: 'luck', baseRate: 30,
                success: { text: '萤火没有逃散，反而钻入空瓶凝成魔尘；墓牌后还露出一只旧钱筒。', gold: { min: 25, max: 45 }, specialItems: [{ type: 'magic_dust', count: 25 }] },
                fail: { text: '光团突然熄灭，你踩空跌进墓洲边缘的碎石坑。', damagePercent: 10 },
            },
            { id: 'leave', label: '不扰亡者', description: '沿土洲外缘安静离开', outcome: { text: '萤火在身后重新聚拢，墓牌间的敲击声也渐渐停止。' } },
        ],
    },
    frogBoneOracle: {
        title: '蛙骨占卜阵',
        description: '一圈巨蛙骨骼被细藤串成复杂图案，中央石盘上摆着六枚刻痕不同的趾骨。水滴落在骨面时会发出钟磬般的轻响，旁边的破布袋里装着前来求问者留下的报酬。',
        choices: [
            {
                id: 'decodeBones', label: '智力解骨', description: '按骨纹和水滴节奏解读占卜', attribute: 'int', baseRate: 35,
                success: { text: '趾骨最终指向一条安全路线，石盘夹层里还藏着一张可用的改造券。', revealNodes: true, revealDepth: 2, specialItems: [{ type: 'reforge_ticket', count: 1 }] },
                fail: { text: '你颠倒了骨纹顺序，石盘溢出的阴湿诅咒削弱了护甲。', buff: { id: 'frogBoneCurse', name: '蛙骨诅咒', icon: '🦴', color: '#7f8b56', defPercent: -10, durationBattles: 3 } },
            },
            {
                id: 'castToeBone', label: '幸运掷骨', description: '随意掷出一枚趾骨，接受阵眼裁定', attribute: 'luck', baseRate: 25,
                success: { text: '趾骨立在尖端没有倒下，破布袋自行松开，露出积攒多年的金币。', gold: { min: 60, max: 90 } },
                fail: { text: '趾骨碎成尖片四散飞出，你护住要害却仍被割伤。', damagePercent: 15 },
            },
            { id: 'leave', label: '归还趾骨', description: '将骨片放回原位', outcome: { text: '你退出骨阵，水滴敲击声重新恢复原先的节奏。' } },
        ],
    },
    mudboundCaravan: {
        title: '泥封商队',
        description: '三辆破旧货车斜陷在泥潭中，车轮和驮兽骨架早已被树根吞没。几只包铁货箱仍露在泥面上，车厢帆布下却偶尔传出抓挠声，仿佛有什么东西比商队更晚来到这里。',
        choices: [
            {
                id: 'haulCargo', label: '力量拖箱', description: '把最沉的货箱从泥里拽出来', attribute: 'str', baseRate: 35,
                success: { text: '你借货车横梁撬出货箱，里面的金币与硬木构件仍保存完好。', gold: { min: 45, max: 70 }, material: { type: '古老木材', count: 3 } },
                fail: { text: '腐朽横梁突然断裂，货箱倒滑回来将你撞进泥水。', damagePercent: 20 },
            },
            {
                id: 'inspectCanvas', label: '智力查货', description: '先确认帆布下的机关与货物', attribute: 'int', baseRate: 35,
                success: { text: '你发现抓挠声来自自动上弦的防盗装置，解除后取得药剂和强化零件。', hpPotion: POTION_HEAL, mpPotion: POTION_MP, specialItems: [{ type: 'enhancement_stone', count: 1 }] },
                fail: { text: '防盗铃响彻泥潭，附近巡游的黑狼循声包围了货车。', combat: 'normal', forceMonsters: ['blackWolf'], encounter: { combatWaves: 1, monstersPerWave: 5, tierWeights: { normal: 1, elite: 0 } } },
            },
            { id: 'leave', label: '放弃货车', description: '不在松软泥地久留', outcome: { text: '你远离货车后，帆布下的抓挠声也随雾气一同消失。' } },
        ],
    },
    sunkenWitchCauldron: {
        title: '沉沼女巫坩埚',
        description: '一口布满铜绿的巨大坩埚陷在树根之间，锅内紫黑药液仍在无火沸腾。周围吊着干燥药束、兽牙量勺和几只密封瓶，锅沿刻痕显示这剂药尚差最后一道处理。',
        choices: [
            {
                id: 'finishBrew', label: '智力炼成', description: '按刻痕完成最后一道蒸馏', attribute: 'int', baseRate: 30,
                success: { text: '药液由紫黑转为清亮银绿，高纯魔尘凝在瓶底，余香强化了你的法术。', specialItems: [{ type: 'magic_dust', count: 50 }], buff: { id: 'witchDistillate', name: '女巫馏液', icon: '⚗️', color: '#8d75a6', matkPercent: 15, durationBattles: 3 } },
                fail: { text: '错误的搅拌方向让坩埚喷出灼热药雾，魔力也被药性抽走。', damagePercent: 20, mpRestorePercent: -15 },
            },
            {
                id: 'tasteBrew', label: '体质试药', description: '直接品尝一勺尚未完成的药液', attribute: 'con', baseRate: 25,
                success: { text: '刺鼻药液在体内化成暖流，伤势迅速闭合，肌肉也充满短暂力量。', healPercent: 25, buff: { id: 'bogWitchTonic', name: '沼巫强壮剂', icon: '🥄', color: '#778f5a', atkPercent: 10, defPercent: 10, durationBattles: 3 } },
                fail: { text: '药液变得像湿泥一样沉重，四肢和护甲同时失去灵活。', buff: { id: 'failedWitchBrew', name: '失败药剂', icon: '🧪', color: '#66576f', defPercent: -15, moveSpeedPercent: -15, durationBattles: 3 } },
            },
            { id: 'leave', label: '盖回锅盖', description: '不试图完成陌生药剂', outcome: { text: '锅盖落下后，沸腾声立刻停止，仿佛坩埚从未醒来。' } },
        ],
    },
    ancientCrocodileTotem: {
        title: '远古鳄神图腾',
        description: '一尊由黑色沼木和鳄骨拼成的巨大图腾矗立在石台上，张开的长吻中嵌着一枚深绿色宝石。水下成排鳄齿指向图腾，石台后的雾中则不断传来沉重兽息。',
        choices: [
            {
                id: 'pryTotemGem', label: '力量取宝', description: '掰开骨吻，取下图腾宝石', attribute: 'str', baseRate: 25,
                success: { text: '骨吻在你的力量下松开，宝石碎成数块可用于强化装备的结晶。', gold: { min: 60, max: 90 }, specialItems: [{ type: 'enhancement_stone', count: 2 }] },
                fail: { text: '图腾发出低吼，精英猎食者从雾后踏上石台守卫祭物。', combat: 'elite', encounter: { combatWaves: 1, monstersPerWave: 1, tierWeights: { normal: 0, elite: 1 } } },
            },
            {
                id: 'communeTotem', label: '精神通灵', description: '以敬畏姿态读取鳄齿指向', attribute: 'wis', baseRate: 30,
                success: { text: '水下鳄齿逐一亮起，为你标出安全水道，图腾的厚重气息也覆在护甲上。', revealNodes: true, revealDepth: 2, buff: { id: 'crocodileHideWard', name: '鳄神厚皮', icon: '🐊', color: '#536d4f', defPercent: 15, durationBattles: 3 } },
                fail: { text: '你误把警告当成祝福，图腾迸出的震波击中胸口。', damagePercent: 20 },
            },
            { id: 'leave', label: '献上泥土', description: '留下象征性祭物后退开', outcome: { text: '你把一团湿泥放在石台边缘，雾后的兽息逐渐远去。' } },
        ],
    },
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
            {
                id: 'sealScholarNotes',
                label: '封存笔记',
                description: '不阅读符文，用骷髅的长袍把笔记重新包好',
                outcome: {
                    text: '你避开仍在蠕动的文字，把笔记放回亡灵学者怀中。封皮下的低语渐渐安静，没有知识，也没有诅咒跟随你离开。',
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
            {
                id: 'markCrossroad',
                label: '留标退回',
                description: '在入口刻下方向记号，避开四色迷雾寻找旧路',
                outcome: {
                    text: '你在四个入口分别留下清晰刻痕，然后退回尚能辨认的旧通道。迷雾中的声音继续互相引诱，但没有一道追上来。',
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
                    forceMonsters: ['armoredKnight'],
                    encounter: { combatWaves: 1, monstersPerWave: 5, tierWeights: { normal: 1, elite: 0 } },
                },
            },
            {
                id: 'sealArmorStand',
                label: '封锁石台',
                description: '不触碰板甲，用碎石堵住石台周围的落脚处',
                outcome: {
                    text: '你没有给怨灵寻找新宿主的机会，只用碎石和断木封住石台。盔甲缝隙中的叹息逐渐变远，通道重新安静下来。',
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
            {
                id: 'leaveFountain',
                label: '不饮泉水',
                description: '不接触冷热交替的泉水，从池边安静绕过',
                outcome: {
                    text: '你没有把未知魔力喝进身体，只沿着没有结冰的池沿绕行。水柱仍在金光与寒霜之间反复变化。',
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
            {
                id: 'barArmoryDoor',
                label: '加固铁门',
                description: '放弃军械，用断梁卡住门缝和锈死的锁扣',
                outcome: {
                    text: '你把一截断梁斜插进门环，又用碎石压住底部缝隙。门后的脚步声短暂靠近，最终在无法开启的铁门后重新远去。',
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
    quarantineBell: {
        title: '隔离警钟',
        description: '一口布满黑斑的铁钟悬在坍塌岗楼内，钟绳穿过成排腕骨，末端压着巡夜人的密封钱匣。墙上刻着不同节奏的警戒记号：有些指向安全通道，有些则代表尸群已经逼近。',
        choices: [
            {
                id: 'readBellCode', label: '精神辨钟', description: '从残留回声中辨认安全警报码', attribute: 'wis', baseRate: 40,
                success: { text: '你听出短促回声对应旧守卫的撤离暗号，附近安全路线与藏匣位置一并清晰起来。', revealNodes: true, revealDepth: 2, gold: { min: 20, max: 35 } },
                fail: { text: '重叠的钟声在意识里反复震荡，你误读了墙上的一个危险标记。', mpRestorePercent: -10, damagePercent: 10 },
            },
            {
                id: 'climbBellFrame', label: '敏捷登架', description: '沿断梁攀上钟架，取下钱匣和钟舌', attribute: 'dex', baseRate: 35,
                success: { text: '你避开松动横梁攀到钟顶，取下密封钱匣，并把尚可利用的铁制钟舌拆了下来。', gold: { min: 30, max: 45 }, material: { type: '铁矿石', count: 2 } },
                fail: { text: '腐朽踏板突然折断，你被钟绳卷住后重重撞在石墙上。', damagePercent: 15 },
            },
            { id: 'leave', label: '绕开钟楼', description: '不让沉寂的警钟再次发声', outcome: { text: '你贴着岗楼阴影离开，铁钟始终在身后无声摇晃。' } },
        ],
    },
    corpseWaxWorkshop: {
        title: '尸蜡工坊',
        description: '低矮石室里排着一列铜锅，乳白尸蜡在无火的锅中缓慢翻涌。墙边的蜡封药瓶仍散发微光，抽风炉却被凝固脂块堵死，甜腻腐味正一点点挤满房间。',
        choices: [
            {
                id: 'refineCorpseWax', label: '智力精炼', description: '控制铜锅温度，分离药性与腐毒', attribute: 'int', baseRate: 35,
                success: { text: '你按锅壁刻度滤掉腐毒，凝成一瓶可用药剂和一撮高纯魔尘。', hpPotion: POTION_HEAL, specialItems: [{ type: 'magic_dust', count: 25 }] },
                fail: { text: '尸蜡突然沸腾，灼热脂液溅出铜锅，刺鼻烟气同时钻入肺部。', damagePercent: 15, mpRestorePercent: -10 },
            },
            {
                id: 'clearVent', label: '体质清炉', description: '忍住毒烟，徒手清理堵塞的抽风炉', attribute: 'con', baseRate: 35,
                success: { text: '你顶着腐味疏通炉道，冷却后的蜡膜附在护甲表面，形成一层短暂缓冲。', healPercent: 10, buff: { id: 'corpseWaxSeal', name: '尸蜡封层', icon: '🕯️', color: '#c8b997', defPercent: 10, durationBattles: 3 } },
                fail: { text: '炉道里的陈年毒烟正面喷出，尸蜡冷凝在关节上，让动作变得僵硬。', buff: { id: 'waxStiffness', name: '尸蜡僵结', icon: '🕯️', color: '#81745f', moveSpeedPercent: -15, durationBattles: 3 } },
            },
            { id: 'leave', label: '封死工坊', description: '放下石门，隔绝尸蜡气味', outcome: { text: '石门落下后，铜锅的翻涌声逐渐被厚墙吞没。' } },
        ],
    },
    sealedSurvivorCell: {
        title: '封死的幸存者牢房',
        description: '一道被家具和铁链从外侧封死的牢门后传来微弱敲击，有人用旧守卫口令请求救援。门缝里推出半张染血地图和一只空药瓶，但阴影深处还响着不似活人的抓挠声。',
        choices: [
            {
                id: 'verifySurvivor', label: '精神辨伪', description: '用旧守卫问答确认门后是否仍是活人', attribute: 'wis', baseRate: 35,
                success: { text: '门后的幸存者完整答出换岗暗语，从送饭口递出备用药剂和标有安全岔路的地图。', hpPotion: POTION_HEAL, mpPotion: POTION_MP, revealNodes: true, revealDepth: 1 },
                fail: { text: '最后一句回答变成了饥饿嘶吼，门板随即被尸群从里面撞碎。', combat: 'normal', forceMonsters: ['zombie', 'zombieDog'], encounter: { combatWaves: 1, monstersPerWave: 5, tierWeights: { normal: 1, elite: 0 } } },
            },
            {
                id: 'breakCell', label: '力量破封', description: '直接拆掉障碍，抢在门后东西扑出前开路', attribute: 'str', baseRate: 30,
                success: { text: '你掀开柜架并扯断铁链，门后的活人早已离去，只留下藏在床板下的钱袋和修补材料。', gold: { min: 55, max: 80 }, material: { type: '铁矿石', count: 3 } },
                fail: { text: '障碍倒塌的巨响惊醒了牢内尸体，一只臃肿僵尸带着同类堵住出口。', combat: 'normal', forceMonsters: ['fatZombie', 'zombie'], encounter: { combatWaves: 1, monstersPerWave: 4, tierWeights: { normal: 1, elite: 0 } } },
            },
            { id: 'leave', label: '重新加固', description: '把推出的地图塞回门缝并压紧障碍', outcome: { text: '敲击声追着你走了很远，最终被地牢深处的风声盖过。' } },
        ],
    },
    ossuaryOrgan: {
        title: '骸骨管风琴',
        description: '一架以脊骨作键、肋骨作风箱的管风琴嵌在墓室墙中，银制音栓间夹着一张残缺乐谱。无人触碰时，骨管仍会吐出低沉和弦，周围壁龛里的尸骸也随节拍轻轻抬头。',
        choices: [
            {
                id: 'playFuneralMeasure', label: '敏捷奏曲', description: '按残谱迅速完成送葬小节', attribute: 'dex', baseRate: 30,
                success: { text: '最后一个和弦准确落下，壁龛尸骸重新安眠，银音栓中释放的节拍强化了你的攻势。', gold: { min: 45, max: 65 }, buff: { id: 'funeralTempo', name: '送葬节拍', icon: '🎼', color: '#9aa7b5', atkPercent: 10, matkPercent: 10, durationBattles: 3 } },
                fail: { text: '错音像尖叫般穿透墓室，沉睡的僵尸巫师从风琴后方现身，接管了未完的乐章。', combat: 'elite', forceMonsters: ['zombieWizard'], encounter: { combatWaves: 1, monstersPerWave: 1, tierWeights: { normal: 0, elite: 1 } } },
            },
            {
                id: 'retuneBonePipes', label: '智力校音', description: '根据骨管长度还原机关的正确音阶', attribute: 'int', baseRate: 35,
                success: { text: '你校正了错位音管，风琴奏出的回声标出墓室暗门，并弹出一张藏在键盘下的改造券。', revealNodes: true, revealDepth: 2, specialItems: [{ type: 'reforge_ticket', count: 1 }] },
                fail: { text: '一根裂开的骨管吸走魔力，刺耳余音让施法节奏久久无法恢复。', mpRestorePercent: -20, buff: { id: 'discordantEcho', name: '失谐回声', icon: '🎵', color: '#746879', matkPercent: -10, durationBattles: 3 } },
            },
            { id: 'leave', label: '折起残谱', description: '不为沉睡尸骸演奏', outcome: { text: '你压住松动琴键离开墓室，低沉和弦在身后自行续完。' } },
        ],
    },
    plagueSpecimenVault: {
        title: '瘟疫标本库',
        description: '厚重铁门后排列着数座裂纹玻璃罐，浑浊绿液中悬着被缝合的畸变尸体。中央操作台保留着血清离心瓶和封蜡样本箱，压力表指针却正缓慢越过红线。',
        choices: [
            {
                id: 'synthesizeAntiserum', label: '智力配血清', description: '依据实验记录，在压力失控前完成净化血清', attribute: 'int', baseRate: 30,
                success: { text: '你从多份污染样本中分离出稳定血清，剩余沉淀也结成了可用魔尘。', hpPotion: POTION_HEAL, mpPotion: POTION_MP, specialItems: [{ type: 'magic_dust', count: 50 }], buff: { id: 'plagueAntiserum', name: '净化血清', icon: '🧬', color: '#78a995', defPercent: 15, durationBattles: 3 } },
                fail: { text: '离心瓶爆裂，警报震碎一座培养罐，畸变标本在毒雾中苏醒。', damagePercent: 20, combat: 'elite', forceMonsters: ['mutant3'], encounter: { combatWaves: 1, monstersPerWave: 1, tierWeights: { normal: 0, elite: 1 } } },
            },
            {
                id: 'carrySealedCase', label: '体质搬运', description: '忍受泄漏孢雾，把最完整的样本箱拖出库房', attribute: 'con', baseRate: 25,
                success: { text: '你在孢雾侵入肺部前搬出样本箱，箱内保存着强化结晶、改造凭证和一支应急针剂。', healPercent: 20, specialItems: [{ type: 'enhancement_stone', count: 2 }, { type: 'reforge_ticket', count: 1 }] },
                fail: { text: '样本箱的密封圈在途中脱落，孢雾渗入护甲与呼吸道，让全身力量迅速衰退。', buff: { id: 'plagueExposure', name: '瘟疫暴露', icon: '☣️', color: '#76834f', atkPercent: -10, defPercent: -15, moveSpeedPercent: -10, durationBattles: 3 } },
            },
            { id: 'sealVault', label: '紧急封库', description: '拉下隔离闸门，不带走任何样本', outcome: { text: '隔离闸门缓慢落下，玻璃罐后的畸形轮廓被重新锁进绿雾。' } },
        ],
    },
    frozenWaystone: {
        title: '冰封路标石',
        description: '三块覆满霜纹的高大路标石陷在风雪岔口，石面没有文字，只有被冰层扭曲的方向凹槽。中央石柱可以转动，底座缝隙里还卡着旧旅人留下的供物袋；远处雪雾中偶尔闪过狼影。',
        choices: [
            {
                id: 'readFrostEcho', label: '精神听霜', description: '触碰霜纹，从风声回响中辨认安全方向', attribute: 'wis', baseRate: 35,
                success: { text: '风声在三块石柱间形成清晰回音，真正的通路与附近岔道一并显现。', revealNodes: true, revealDepth: 2, mpRestorePercent: 15 },
                fail: { text: '重叠风声让方向感彻底混乱，寒意也沿手掌钻入意识。', mpRestorePercent: -15, buff: { id: 'frostDisorientation', name: '霜途迷向', icon: '🧭', color: '#8aa8ba', moveSpeedPercent: -15, durationBattles: 3 } },
            },
            {
                id: 'turnWaystone', label: '力量转柱', description: '扳动冻死的石柱，让底座机关重新归位', attribute: 'str', baseRate: 30,
                success: { text: '石柱在冰壳碎裂声中转回原位，底座弹出一只装有金币和硬木楔的维修匣。', gold: { min: 60, max: 90 }, material: { type: '古老木材', count: 3 } },
                fail: { text: '石柱突然回弹，崩落的冰块砸中了肩背。', damagePercent: 20 },
            },
            {
                id: 'chooseUntouchedTrail', label: '幸运择路', description: '挑一条没有足迹的雪径，并取走供物袋', attribute: 'luck', baseRate: 25,
                success: { text: '无痕雪径恰好避开狼群，供物袋里还留着旅费和一枚强化结晶。', revealNodes: true, revealDepth: 1, gold: { min: 80, max: 110 }, specialItems: [{ type: 'enhancement_stone', count: 1 }] },
                fail: { text: '雪径只是狼群掩盖足迹的狩猎道，数只黑狼从风雪后方包围过来。', combat: 'normal', forceMonsters: ['blackWolf'], encounter: { combatWaves: 1, monstersPerWave: 5, tierWeights: { normal: 1, elite: 0 } } },
            },
            { id: 'leave', label: '沿原路前行', description: '不触碰来历不明的路标', outcome: { text: '你记住石柱的位置，沿已知路线顶着风雪继续前进。' } },
        ],
    },
    snowboundSupplySled: {
        title: '雪埋补给橇',
        description: '一辆覆着厚雪的木制补给橇斜插在冰坡下，只露出半截铜包边和一根断裂牵引杆。货箱被三层防潮皮裹住，橇底制动销却仍绷得很紧，稍有失误整辆橇就会滑入下方冰沟。',
        choices: [
            {
                id: 'digOutSled', label: '力量掘橇', description: '稳住牵引杆，把沉重货橇从积雪中拖出', attribute: 'str', baseRate: 35,
                success: { text: '你用断杆作杠杆撬出货橇，找到一只钱箱和几块可用铁件。', gold: { min: 70, max: 100 }, material: { type: '铁矿石', count: 3 } },
                fail: { text: '雪层突然塌陷，货橇滑动时把你撞向冰坡。', damagePercent: 20 },
            },
            {
                id: 'inspectFrozenRations', label: '智力验货', description: '判断哪些冻裂补给仍可安全使用', attribute: 'int', baseRate: 30,
                success: { text: '你排除渗漏瓶罐，找出两瓶恢复药剂和一枚被油布包住的强化结晶。', hpPotion: POTION_HEAL, mpPotion: POTION_MP, specialItems: [{ type: 'enhancement_stone', count: 1 }] },
                fail: { text: '一瓶变质药液在解冻后喷出刺激性蒸气，灼伤手臂并扰乱魔力。', damagePercent: 15, mpRestorePercent: -15 },
            },
            {
                id: 'releaseBrakePin', label: '敏捷卸销', description: '卡住橇身，在制动销弹开前拆下货箱', attribute: 'dex', baseRate: 25,
                success: { text: '你顺着滑橇倾斜的瞬间卸下货箱，找到一张改造凭证，橇身滑落时还暴露出近路。', revealNodes: true, revealDepth: 2, gold: { min: 60, max: 90 }, specialItems: [{ type: 'reforge_ticket', count: 1 }] },
                fail: { text: '制动销高速弹出，随后失控货橇擦着你冲入冰沟。', damagePercent: 25 },
            },
            {
                id: 'leave', label: '标记位置', description: '不冒险惊动雪坡',
                outcome: {
                    text: '你刚把断木插进雪层，隐藏在下方的旧缆绳便被一同钩起。补给橇挣脱积雪横扫冰坡，你虽及时侧身，仍被飞散的木片和铁扣擦伤。',
                    damagePercent: 10,
                },
            },
        ],
    },
    singingIceBridge: {
        title: '鸣冰桥',
        description: '一条天然蓝冰桥横跨幽深裂谷，桥体会随着风压发出高低不同的鸣响。冰面下封着旧绳索和金属扣件，桥侧则有一排探路者敲出的测试孔；每一次低沉震音都让新裂纹向前延伸。',
        choices: [
            {
                id: 'crossOnHighNotes', label: '敏捷踏音', description: '只在冰桥发出高音时快速通过', attribute: 'dex', baseRate: 35,
                success: { text: '你踩着冰层最稳定的共振间隙越过裂谷，并在对岸找到遗落的钱袋。', revealNodes: true, revealDepth: 2, gold: { min: 60, max: 90 } },
                fail: { text: '低沉震音提前到来，脚下冰层崩裂，你撞上桥侧才勉强爬回。', damagePercent: 25 },
            },
            {
                id: 'mapIceCracks', label: '智力测冰', description: '根据音高和测试孔推算承重路线', attribute: 'int', baseRate: 30,
                success: { text: '你绘出安全受力线，还从透明冰层中剥出一团凝结魔力。', revealNodes: true, revealDepth: 3, specialItems: [{ type: 'magic_dust', count: 50 }] },
                fail: { text: '冰层回声被峡谷放大，你误判了一道贯穿裂缝，寒震抽走部分魔力。', mpRestorePercent: -20 },
            },
            {
                id: 'crawlWindwardEdge', label: '体质伏渡', description: '贴着迎风侧冰脊缓慢爬过桥面', attribute: 'con', baseRate: 25,
                success: { text: '你忍住刺骨寒风稳稳爬过冰桥，持续低温也让身体对冲击更加警觉。', buff: { id: 'iceBridgePoise', name: '冰桥定势', icon: '🧊', color: '#83b4ca', defPercent: 15, moveSpeedPercent: 15, durationBattles: 3 } },
                fail: { text: '寒风穿透护甲，冻僵的关节在之后很长一段路上都难以活动。', damagePercent: 20, buff: { id: 'iceBridgeNumbness', name: '寒桥麻木', icon: '🥶', color: '#6d91a8', moveSpeedPercent: -15, durationBattles: 3 } },
            },
            {
                id: 'leave', label: '寻找绕路', description: '不把性命交给鸣响的冰层',
                outcome: {
                    text: '你离开桥头寻找绕路，却被迫穿过没有遮蔽的迎风坡。冰粒割伤皮肤，长时间失温也让双腿逐渐僵硬。',
                    damagePercent: 10,
                    buff: { id: 'iceBridgeDetourChill', name: '绕路失温', icon: '🥶', color: '#6d91a8', moveSpeedPercent: -10, durationBattles: 3 },
                },
            },
        ],
    },
    lostExpeditionCamp: {
        title: '失温远征营地',
        description: '几顶被积雪压塌的帐篷围着熄灭石炉，冻结绳索上挂着方向牌和半张巡查图。营地没有尸体，只有向不同方向延伸的凌乱拖痕；一只上锁的队长箱仍埋在主帐篷下。',
        choices: [
            {
                id: 'reconstructTracks', label: '精神寻迹', description: '从拖痕和遗留物判断队伍最后去向', attribute: 'wis', baseRate: 35,
                success: { text: '你排除被风吹出的假痕，找出远征队留下的安全撤离路线。', revealNodes: true, revealDepth: 3, gold: { min: 50, max: 70 } },
                fail: { text: '拖痕在风雪里彼此重叠，长时间追索只让精神被寒意拖垮。', mpRestorePercent: -20 },
            },
            {
                id: 'repairCampStove', label: '智力修炉', description: '清理烟道并按旧燃料配比重燃石炉', attribute: 'int', baseRate: 30,
                success: { text: '石炉重新燃起稳定蓝火，你暖透身体，也从炉膛夹层找到两瓶药剂。', healPercent: 20, hpPotion: POTION_HEAL, mpPotion: POTION_MP },
                fail: { text: '潮湿燃料爆出火星，坍塌烟道把热烟全部压回帐篷。', damagePercent: 20 },
            },
            {
                id: 'searchCaptainChest', label: '幸运搜箱', description: '凭直觉从冰封杂物中挑出队长箱钥匙', attribute: 'luck', baseRate: 25,
                success: { text: '钥匙藏在一只不起眼的手套里，队长箱中保存着金币、改造凭证和强化结晶。', gold: { min: 90, max: 120 }, specialItems: [{ type: 'reforge_ticket', count: 1 }, { type: 'enhancement_stone', count: 1 }] },
                fail: { text: '金属碰撞声传出营地，尾随远征队的狼群很快循声赶来。', combat: 'normal', forceMonsters: ['blackWolf'], encounter: { combatWaves: 1, monstersPerWave: 5, tierWeights: { normal: 1, elite: 0 } } },
            },
            {
                id: 'leave', label: '压紧帐篷', description: '不扰动失踪者的营地',
                outcome: {
                    text: '你用石块压住翻飞帐布，帐绳下却露出一枚仍在工作的警戒铃。短促铃声传入风雪，尾随远征队的猎食者立刻从营地外围逼近。',
                    combat: 'normal',
                },
            },
        ],
    },
    frostberryHollow: {
        title: '霜莓冰窟',
        description: '背风冰窟里生长着一片深蓝霜莓，半透明果实在冰晶间发出微光。洞顶垂着密集冰锥，根系旁散落着药师留下的银匙和空瓶；几簇颜色过亮的果实则覆着细小黑斑。',
        choices: [
            {
                id: 'identifyFrostberries', label: '智力辨莓', description: '根据果霜和根色挑出可入药的浆果', attribute: 'int', baseRate: 35,
                success: { text: '你避开受污染的亮色果实，调出两瓶恢复药剂，并收集到凝结魔尘。', hpPotion: POTION_HEAL, mpPotion: POTION_MP, specialItems: [{ type: 'magic_dust', count: 50 }] },
                fail: { text: '黑斑在解冻后化成腐蚀汁液，灼伤了手指。', damagePercent: 15 },
            },
            {
                id: 'tasteDarkBerry', label: '体质试果', description: '直接吞下一枚颜色最深的霜莓', attribute: 'con', baseRate: 30,
                success: { text: '寒甜果汁在体内化成稳定暖流，伤势与疲劳迅速缓解。', healPercent: 25, buff: { id: 'frostberryVigor', name: '霜莓活力', icon: '🫐', color: '#668bb5', defPercent: 15, durationBattles: 3 } },
                fail: { text: '果实在胃里凝成冰团，寒痛让动作暂时迟缓。', damagePercent: 20, buff: { id: 'frostberryChill', name: '霜莓寒毒', icon: '🫐', color: '#526b92', moveSpeedPercent: -15, durationBattles: 3 } },
            },
            {
                id: 'harvestUnderIcicles', label: '敏捷摘果', description: '避开随震动坠落的冰锥，快速装满药瓶', attribute: 'dex', baseRate: 25,
                success: { text: '你在冰锥落下前装满药瓶，顺手拾起药师遗落的钱袋和改造凭证。', mpPotion: POTION_MP, gold: { min: 60, max: 90 }, specialItems: [{ type: 'reforge_ticket', count: 1 }] },
                fail: { text: '一根冰锥擦过肩侧，破碎冰片划出数道伤口。', damagePercent: 25 },
            },
            {
                id: 'leave', label: '不碰霜莓', description: '避开颜色异常的冰窟植物',
                outcome: {
                    text: '你没有触碰霜莓，却在沿冰窟外缘撤离时踩碎了一层薄霜。潜伏在根系下的雪原猎食者被震动惊醒，抢先堵住了洞口。',
                    combat: 'normal',
                },
            },
        ],
    },
    trappedWhiteStag: {
        title: '冰索白鹿',
        description: '一头通体银白的鹿被冻紧的猎索困在冰杉之间，鹿角挂着细碎极光，蹄边则散落着断裂木桩和被雪掩住的捕猎工具。它没有挣扎，只警惕地盯着你，远处狼嚎正在逐渐靠近。',
        choices: [
            {
                id: 'calmWhiteStag', label: '精神安抚', description: '放低武器，用平稳呼吸让白鹿停止戒备', attribute: 'wis', baseRate: 30,
                success: { text: '白鹿允许你靠近，脱困后用鹿角轻触额头，并领你看见一条避风路线。', revealNodes: true, revealDepth: 2, healPercent: 20 },
                fail: { text: '你的靠近被误解为攻击，白鹿猛然挣扎，猎索抽中了手臂。', damagePercent: 20 },
            },
            {
                id: 'breakFrozenSnare', label: '力量断索', description: '稳住木桩，强行扯断冻硬猎索', attribute: 'str', baseRate: 25,
                success: { text: '猎索应声断开，白鹿留下的一小截脱落鹿角化成魔尘，极光余韵也加快了脚步。', specialItems: [{ type: 'magic_dust', count: 75 }], buff: { id: 'whiteStagStride', name: '白鹿轻步', icon: '🦌', color: '#b7d7e4', moveSpeedPercent: 20, durationBattles: 3 } },
                fail: { text: '木桩从冻土中突然拔出，带着铁扣重重砸向膝侧。', damagePercent: 25 },
            },
            {
                id: 'followStagGaze', label: '幸运寻物', description: '顺着白鹿视线寻找猎人遗落的护符', attribute: 'luck', baseRate: 20,
                success: { text: '你在雪坑里找到猎人的钱袋和两颗冰封强化结晶，随后割开猎索放走白鹿。', gold: { min: 120, max: 160 }, specialItems: [{ type: 'enhancement_stone', count: 2 }] },
                fail: { text: '你翻动积雪的声音引来狼群，只能先迎战才能保护被困白鹿。', combat: 'normal', forceMonsters: ['blackWolf'], encounter: { combatWaves: 1, monstersPerWave: 6, tierWeights: { normal: 1, elite: 0 } } },
            },
            {
                id: 'leave', label: '割绳离开', description: '简单割松猎索，不索取任何回报',
                outcome: {
                    text: '白鹿很快挣脱束缚，离开前用鹿角轻触你的肩甲。极光沿着金属纹路流过，留下能在风雪中稳住脚步的温和祝福。',
                    buff: { id: 'whiteStagMercy', name: '白鹿善意', icon: '🦌', color: '#b7d7e4', defPercent: 10, moveSpeedPercent: 10, durationBattles: 3 },
                },
            },
        ],
    },
    auroraIceLanterns: {
        title: '极光冰灯阵',
        description: '七盏由透明冰块雕成的古灯围在雪地中央，内部没有火焰，却折射着头顶极光。每盏灯的镜片角度不同，光束时而组成道路，时而落向埋在雪下的晶体；阵心铜轴已经被薄冰锁住。',
        choices: [
            {
                id: 'alignAuroraRhythm', label: '精神引光', description: '感受极光变化，让七盏冰灯同步明灭', attribute: 'wis', baseRate: 30,
                success: { text: '灯阵与极光形成稳定呼吸，清冷光芒强化了魔力和步伐。', mpRestorePercent: 25, buff: { id: 'auroraCadence', name: '极光律动', icon: '🌌', color: '#77c6d7', matkPercent: 15, moveSpeedPercent: 15, durationBattles: 3 } },
                fail: { text: '错乱光束不断闪过视野，精神被快速变化的色彩拖得疲惫不堪。', mpRestorePercent: -25 },
            },
            {
                id: 'adjustLanternMirrors', label: '智力调镜', description: '按折射角校正镜片与冻住的铜轴', attribute: 'int', baseRate: 25,
                success: { text: '七束光最终汇成清晰箭头，照出远处道路和阵心凝结的魔尘。', revealNodes: true, revealDepth: 3, specialItems: [{ type: 'magic_dust', count: 75 }] },
                fail: { text: '聚焦光束落在护甲上，瞬间升温又骤然冻结，造成一阵刺痛。', damagePercent: 20 },
            },
            {
                id: 'catchLightCrystal', label: '敏捷接晶', description: '在光点落雪前接住阵中析出的冰晶', attribute: 'dex', baseRate: 20,
                success: { text: '你连续接住几枚短暂成形的光晶，其中两枚稳定成强化结晶，灯座还弹出一张改造凭证。', mpPotion: POTION_MP, specialItems: [{ type: 'enhancement_stone', count: 2 }, { type: 'reforge_ticket', count: 1 }] },
                fail: { text: '光晶在指间炸成寒雾，手臂被薄冰包住，动作变得迟缓。', buff: { id: 'auroraFrostbite', name: '极光冻伤', icon: '💠', color: '#7199b8', moveSpeedPercent: -15, durationBattles: 3 } },
            },
            {
                id: 'leave', label: '遮住灯阵', description: '用雪盖住最亮的镜片后离开',
                outcome: {
                    text: '积雪盖住镜片后，未能释放的极光沿铜轴倒灌进你的影子。骤冷光束灼伤手臂，紊乱寒光也在意识里反复闪烁。',
                    damagePercent: 10,
                    mpRestorePercent: -15,
                    buff: { id: 'shroudedAurora', name: '极光残扰', icon: '🌌', color: '#718da9', matkPercent: -10, durationBattles: 3 },
                },
            },
        ],
    },
    avalancheWatchtower: {
        title: '雪崩瞭望塔',
        description: '一座半埋山壁的木石瞭望塔俯视整片雪谷，塔内绞盘连接着山脊上的防雪崩木栅。墙上钉着积雪深度尺，顶部风向标仍在急转，警铃配重则悬在即将断裂的绳索上。',
        choices: [
            {
                id: 'releaseSnowShelf', label: '智力泄雪', description: '计算坡面受力，分段释放危险雪檐', attribute: 'int', baseRate: 30,
                success: { text: '小规模雪流按顺序滑入空谷，暴露出安全山道和岗哨储藏格。', revealNodes: true, revealDepth: 3, gold: { min: 100, max: 140 } },
                fail: { text: '你误判一层硬雪板，回卷雪浪撞进塔门，将人掀翻在地。', damagePercent: 25 },
            },
            {
                id: 'climbWindVane', label: '敏捷登塔', description: '攀上结冰外墙，修正风向标并取下观察匣', attribute: 'dex', baseRate: 25,
                success: { text: '风向标恢复转动，观察匣中的路线图和两张改造凭证也完好无损。', revealNodes: true, revealDepth: 2, specialItems: [{ type: 'reforge_ticket', count: 2 }] },
                fail: { text: '覆霜横梁在脚下断裂，你沿塔壁滑落并撞上石基。', damagePercent: 25 },
            },
            {
                id: 'resetBellCounterweight', label: '力量复锤', description: '拉回沉重配重，让警铃重新待命', attribute: 'str', baseRate: 20,
                success: { text: '配重重新卡进绞盘，稳定塔架的过程也让你掌握了抵御冲击的节奏。', material: { type: '古老木材', count: 5 }, buff: { id: 'avalancheBrace', name: '抗崩架势', icon: '🏔️', color: '#879ba7', defPercent: 20, durationBattles: 3 } },
                fail: { text: '绳索突然断裂，警铃巨响传遍山谷，附近狼群循声冲向岗塔。', combat: 'normal', forceMonsters: ['blackWolf'], encounter: { combatWaves: 1, monstersPerWave: 6, tierWeights: { normal: 1, elite: 0 } } },
            },
            {
                id: 'leave', label: '封闭塔门', description: '不触碰年久失修的防雪崩机关',
                outcome: {
                    text: '你用断板顶住塔门，门轴却牵动了即将断裂的警铃配重。沉重钟声滚过雪谷，巡游在山脊背面的怪物循声封住了低处道路。',
                    combat: 'normal',
                },
            },
        ],
    },
    frostboundCaravan: {
        title: '冰封商旅',
        description: '三辆带篷货车连同驮兽遗骨被冻成一整块蓝冰，车轮停在急转弯处。外层货箱挂着商会铅封，车底却露出一截暗格拉环；附近雪面布满绕圈狼爪印，却没有任何离开的脚印。',
        choices: [
            {
                id: 'pryFrozenCrates', label: '力量撬箱', description: '用车轴作杠杆，撬开最沉的冰封货箱', attribute: 'str', baseRate: 30,
                success: { text: '冰壳和锁扣一同裂开，箱内金币与金属货件仍被油布保护。', gold: { min: 110, max: 160 }, material: { type: '铁矿石', count: 5 } },
                fail: { text: '冻结车轴突然折断，沉重货箱翻落下来撞伤腿部。', damagePercent: 25 },
            },
            {
                id: 'thawMerchantSeals', label: '智力融封', description: '控制火候，只融化铅封与箱缝薄冰', attribute: 'int', baseRate: 25,
                success: { text: '铅封完整脱落，药品与两枚强化结晶没有受到热胀破坏。', hpPotion: POTION_HEAL, mpPotion: POTION_MP, specialItems: [{ type: 'enhancement_stone', count: 2 }] },
                fail: { text: '货箱内外温差让玻璃瓶接连炸裂，滚烫药液和寒气同时扑来。', damagePercent: 20, mpRestorePercent: -15 },
            },
            {
                id: 'searchFalseBottom', label: '幸运探暗格', description: '从几处拉环中挑出真正的车底暗格', attribute: 'luck', baseRate: 20,
                success: { text: '暗格里藏着商队应急金和两张防水改造凭证。', gold: { min: 140, max: 180 }, specialItems: [{ type: 'reforge_ticket', count: 2 }] },
                fail: { text: '错误拉环牵动了车铃，围着商旅打转的狼群立即扑出雪雾。', combat: 'normal', forceMonsters: ['blackWolf'], encounter: { combatWaves: 1, monstersPerWave: 6, tierWeights: { normal: 1, elite: 0 } } },
            },
            {
                id: 'leave', label: '覆盖车辙', description: '用积雪重新掩住商旅遗迹',
                outcome: {
                    text: '你刚抹平最后一道车辙，围绕商旅打转的足迹便同时转向。它们从来不是旧痕，而是一群精英猎食者耐心布下的包围圈。',
                    combat: 'elite',
                },
            },
        ],
    },
    whisperingGlacierCrevasse: {
        title: '低语冰隙',
        description: '狭长冰隙向下延伸到看不见底的蓝黑深处，层层冰壁会把细小声音重复成近似人语的低语。旧攀索垂在崖边，裂隙深处则闪着一只探险箱的金属反光，周期性寒雾正从下方喷涌。',
        choices: [
            {
                id: 'listenCrevasseEcho', label: '精神辨声', description: '从多重回声中分离真正的风口与通道声', attribute: 'wis', baseRate: 30,
                success: { text: '你识破模仿人声的回音，找出一条连接远处冰洞的隐蔽通道。', revealNodes: true, revealDepth: 3, mpRestorePercent: 20 },
                fail: { text: '低语逐渐变成自己的声音，错误方向感在脑海里挥之不去。', buff: { id: 'crevasseWhispers', name: '冰隙低语', icon: '🗣️', color: '#7796aa', matkPercent: -15, moveSpeedPercent: -15, durationBattles: 3 } },
            },
            {
                id: 'rappelForCache', label: '敏捷垂降', description: '借旧攀索下降到探险箱所在冰台', attribute: 'dex', baseRate: 25,
                success: { text: '你在绳结断开前荡上冰台，取回金币和两枚强化结晶。', gold: { min: 110, max: 150 }, specialItems: [{ type: 'enhancement_stone', count: 2 }] },
                fail: { text: '旧攀索突然滑脱，你撞上冰壁后才抓住下一处结节。', damagePercent: 30 },
            },
            {
                id: 'endureColdVent', label: '体质探雾', description: '顶住喷涌寒雾，沿下层冰脊寻找出口', attribute: 'con', baseRate: 20,
                success: { text: '你适应寒雾节奏穿过冰隙，低温刺激让身体在接下来战斗中更加坚韧。', healPercent: 20, buff: { id: 'glacierLungs', name: '冰川吐息', icon: '🌬️', color: '#6fa0bd', defPercent: 20, durationBattles: 3 } },
                fail: { text: '寒雾灌入护甲和肺部，四肢迅速失去知觉。', damagePercent: 25, buff: { id: 'crevasseNumbness', name: '冰隙失温', icon: '🥶', color: '#63869c', moveSpeedPercent: -20, durationBattles: 3 } },
            },
            {
                id: 'leave', label: '钉下警戒绳', description: '标记裂隙边缘后绕行',
                outcome: {
                    text: '冰钉穿透薄壳后释放出封存多年的寒雾。你及时离开裂隙边缘，却仍吸入刺骨雾气，四肢在接下来的路程中难以回暖。',
                    damagePercent: 15,
                    buff: { id: 'crevasseDetourNumbness', name: '冰隙寒侵', icon: '🌬️', color: '#63869c', moveSpeedPercent: -15, durationBattles: 3 },
                },
            },
        ],
    },
    frozenChapel: {
        title: '冻结祈祷堂',
        description: '一座被整块透明寒冰包裹的石质祈祷堂立在雪谷尽头，冰层下的长椅、银灯和壁画仍保持灾难发生前的模样。祭坛上悬着一枚霜白圣徽，地下圣物匣则被三道冻结锁链牢牢缠住。',
        choices: [
            {
                id: 'prayBeneathIce', label: '精神祷冰', description: '隔着冰层回应祭坛中残留的守护意志', attribute: 'wis', baseRate: 25,
                success: { text: '圣徽在冰中亮起，纯净寒光修复伤势，并化作能抵御冲击与魔法侵蚀的祝福。', healPercent: 30, mpRestorePercent: 30, buff: { id: 'frozenSanctuary', name: '寒堂圣佑', icon: '❄️', color: '#b7dce8', defPercent: 20, matkPercent: 20, durationBattles: 3 } },
                fail: { text: '祷词被冰层折成相反含义，刺骨回声抽走魔力并削弱意志。', mpRestorePercent: -30, buff: { id: 'rejectedPrayer', name: '冰堂拒斥', icon: '🕯️', color: '#778ca0', matkPercent: -20, durationBattles: 3 } },
            },
            {
                id: 'decodeFrozenMosaic', label: '智力解画', description: '从冻结壁画顺序还原祭司的撤离路线', attribute: 'int', baseRate: 20,
                success: { text: '壁画中的星位与门廊一一对应，隐藏路线和祭司留下的魔尘、改造凭证同时显现。', revealNodes: true, revealDepth: 3, specialItems: [{ type: 'magic_dust', count: 100 }, { type: 'reforge_ticket', count: 2 }] },
                fail: { text: '你激活了错误画格，冰面折射出的强光灼伤双眼。', damagePercent: 25 },
            },
            {
                id: 'breakReliquaryChains', label: '力量断链', description: '击碎三道冰锁，打开祭坛下的圣物匣', attribute: 'str', baseRate: 15,
                success: { text: '最后一道锁链断裂，圣物匣中保存着大笔供奉金和三枚强化结晶。', gold: { min: 180, max: 240 }, specialItems: [{ type: 'enhancement_stone', count: 3 }] },
                fail: { text: '锁链将冲击原样反弹，祭坛冰壳同时坍落。', damagePercent: 35, buff: { id: 'reliquaryBurden', name: '圣匣重压', icon: '⛓️', color: '#70889a', moveSpeedPercent: -20, durationBattles: 3 } },
            },
            { id: 'leave', label: '合掌退下', description: '不惊扰冻结在礼拜中的旧日意志', outcome: { text: '你向祭坛短暂致意，沿结霜门廊安静离开。' } },
        ],
    },
    iceFisherHole: {
        title: '无底冰钓孔',
        description: '圆形冰钓孔被刻满同心凿痕，漆黑水面下垂着一条粗重银链。岸边留下骨制鱼竿、绞盘和装有发光诱饵的铜盒；每当极光掠过，深水中便有巨大阴影绕着链端缓慢转圈。',
        choices: [
            {
                id: 'readUndericeCurrent', label: '智力测流', description: '根据气泡和链条摆幅判断安全下钩时机', attribute: 'int', baseRate: 25,
                success: { text: '你避开深水阴影的巡游路线，捞出一只药师沉箱和凝在水线上的魔尘。', revealNodes: true, revealDepth: 3, hpPotion: POTION_HEAL, mpPotion: POTION_MP, specialItems: [{ type: 'magic_dust', count: 75 }] },
                fail: { text: '水下暗流突然倒卷，冰孔边缘崩碎，寒水浸透护甲。', damagePercent: 25, buff: { id: 'drenchedInIcewater', name: '冰水浸身', icon: '💧', color: '#557f9a', moveSpeedPercent: -20, durationBattles: 3 } },
            },
            {
                id: 'haulSilverChain', label: '力量收链', description: '转动冻结绞盘，把链端沉箱拖出深水', attribute: 'str', baseRate: 20,
                success: { text: '银链一寸寸升起，沉箱中装着金币、精铁构件和两枚强化结晶。', gold: { min: 140, max: 190 }, material: { type: '铁矿石', count: 5 }, specialItems: [{ type: 'enhancement_stone', count: 2 }] },
                fail: { text: '链端阴影猛然下潜，绞盘把手高速回转，重击胸腹。', damagePercent: 30 },
            },
            {
                id: 'castLuminousBait', label: '幸运投饵', description: '从铜盒中随意挑一枚发光诱饵投入黑水', attribute: 'luck', baseRate: 15,
                success: { text: '水下阴影没有咬钩，反而推来一只覆满古币和改造凭证的祭祀盘。', gold: { min: 200, max: 260 }, specialItems: [{ type: 'reforge_ticket', count: 3 }] },
                fail: { text: '诱饵引来猛烈撞击，冰孔喷出的碎冰和黑水将你掀翻。', damagePercent: 35, mpRestorePercent: -20 },
            },
            {
                id: 'leave', label: '封住冰孔', description: '把旧木盖重新压回漆黑水面',
                outcome: {
                    text: '旧木盖刚压住水面，银链便从下方猛然绷直。巨大阴影撞碎冰盖跃出黑水，显然它早已把岸边的动静当成了进食信号。',
                    combat: 'elite',
                },
            },
        ],
    },
    blizzardSignalBrazier: {
        title: '暴雪烽火盆',
        description: '巨型青铜火盆立在山口石台上，四周堆着受潮燃料、鲸油罐和结冰风板。火盆下方的引风机关连着数座远方信标，只要在暴雪中心重新点燃，整条古代雪道就会被依次照亮。',
        choices: [
            {
                id: 'mixStormFuel', label: '智力配燃料', description: '按风速混合鲸油、树脂和干燥魔尘', attribute: 'int', baseRate: 25,
                success: { text: '冷焰穿透暴雪点亮远方信标，安全道路与火盆储金格同时显现。', revealNodes: true, revealDepth: 3, gold: { min: 120, max: 170 }, buff: { id: 'signalFlamePace', name: '烽火引路', icon: '🔥', color: '#d7a76b', moveSpeedPercent: 20, durationBattles: 3 } },
                fail: { text: '错误油料在盆底爆燃，灼热蒸气与冰雪同时扑向身体。', damagePercent: 30 },
            },
            {
                id: 'igniteThroughBlizzard', label: '体质守火', description: '用身体挡住狂风，维持火种直到风板升起', attribute: 'con', baseRate: 20,
                success: { text: '你在风雪中守住第一缕火苗，升腾暖流恢复伤势并锻出坚韧防护。', healPercent: 30, buff: { id: 'blizzardFireguard', name: '暴雪火卫', icon: '🔥', color: '#cb8e64', defPercent: 20, durationBattles: 3 } },
                fail: { text: '风向突然反转，火焰贴着护甲卷回，随后又被寒风瞬间冻结。', damagePercent: 35 },
            },
            {
                id: 'repairWindShutters', label: '敏捷修板', description: '在风板高速摆动时重新挂上三枚传动销', attribute: 'dex', baseRate: 15,
                success: { text: '三块风板依次锁定，机关夹层弹出两张改造凭证和两枚强化结晶。', specialItems: [{ type: 'reforge_ticket', count: 2 }, { type: 'enhancement_stone', count: 2 }] },
                fail: { text: '风板夹住护手并将你甩向石台边缘，寒风趁隙侵入关节。', damagePercent: 30, buff: { id: 'shutterBruise', name: '风板挫伤', icon: '🌀', color: '#6e8798', atkPercent: -15, moveSpeedPercent: -15, durationBattles: 3 } },
            },
            {
                id: 'leave', label: '封存火种', description: '收起残余燃料，不在暴雪中冒险点火',
                outcome: {
                    text: '你盖紧鲸油罐准备离开，泄漏的气味却早已沿山口扩散。守候在远方信标之间的怪物循着油味穿过暴雪，截断了下山道路。',
                    combat: 'normal',
                },
            },
        ],
    },
    crystalPrison: {
        title: '寒晶囚笼',
        description: '六根巨型蓝晶柱围成封闭囚笼，中央悬着一团披兽形轮廓的极寒灵光。晶柱之间流动着古老封印，底座凹槽里沉积着大量魔尘与强化结晶；每当灵光撞击晶壁，整片雪地都会震动。',
        choices: [
            {
                id: 'communeWithFrostSpirit', label: '精神通灵', description: '隔着封印了解寒灵被囚禁的原因', attribute: 'wis', baseRate: 25,
                success: { text: '寒灵停止冲撞，以记忆展示雪原隐路，并留下强化魔法的极寒印记。', revealNodes: true, revealDepth: 3, mpRestorePercent: 30, buff: { id: 'frostSpiritMark', name: '寒灵印记', icon: '👻', color: '#75b9d2', matkPercent: 20, durationBattles: 3 } },
                fail: { text: '寒灵的怒意穿过封印灌入意识，魔力运转变得迟缓。', mpRestorePercent: -30, buff: { id: 'frostSpiritRage', name: '寒灵震慑', icon: '👻', color: '#637e9b', matkPercent: -20, durationBattles: 3 } },
            },
            {
                id: 'breakOuterCrystals', label: '力量碎晶', description: '只击碎外层结晶，不破坏核心封印', attribute: 'str', baseRate: 20,
                success: { text: '你准确剥离外层晶壳，取得三枚强化结晶和封印者留下的金币。', gold: { min: 160, max: 210 }, specialItems: [{ type: 'enhancement_stone', count: 3 }] },
                fail: { text: '冲击沿晶柱反射并同时命中身体，破碎冰棱随之坠下。', damagePercent: 35 },
            },
            {
                id: 'drainPrisonCore', label: '智力导能', description: '重排底座回路，抽取不影响封印的溢出能量', attribute: 'int', baseRate: 15,
                success: { text: '溢出寒能被导入容器，凝成大量魔尘和三张完整改造凭证。', mpPotion: POTION_MP, specialItems: [{ type: 'magic_dust', count: 100 }, { type: 'reforge_ticket', count: 3 }] },
                fail: { text: '回路发生逆流，寒能冻结护甲内部并削弱攻防。', damagePercent: 30, buff: { id: 'crystalBackflow', name: '寒晶逆流', icon: '💎', color: '#658da7', atkPercent: -20, defPercent: -20, durationBattles: 3 } },
            },
            {
                id: 'leave', label: '维持封印', description: '不取走晶体，也不回应寒灵',
                outcome: {
                    text: '你没有碰触封印，但转身离开的举动激怒了寒灵。它隔着晶柱发出无声咆哮，寒震穿过封印击伤身体、抽走魔力并扰乱施法节奏。',
                    damagePercent: 15,
                    mpRestorePercent: -20,
                    buff: { id: 'frostSpiritRejection', name: '寒灵拒斥', icon: '👻', color: '#637e9b', matkPercent: -15, durationBattles: 3 },
                },
            },
        ],
    },
    ancientIceObservatory: {
        title: '古冰观星台',
        description: '圆形观星台从冰川顶部伸出，数层青铜星环围着一面朝天冰镜缓慢转动。环上没有文字，只有星形孔洞与极光刻度；平台边缘散落着陨铁碎片，中央锁匣则会在特定星位短暂开启。',
        choices: [
            {
                id: 'alignStarRings', label: '智力校环', description: '根据星孔投影校准多层青铜星环', attribute: 'int', baseRate: 25,
                success: { text: '所有星孔在冰镜上重合，观星台投出完整雪原路线并开启储金格。', revealNodes: true, revealDepth: 3, gold: { min: 140, max: 180 } },
                fail: { text: '错位星环突然加速，青铜边缘撞开护手并划伤身体。', damagePercent: 25 },
            },
            {
                id: 'readAuroraOmen', label: '精神观兆', description: '让意识随极光越过冰镜，读取即将发生的征兆', attribute: 'wis', baseRate: 20,
                success: { text: '极光在意识中化成清晰战兆，魔力与攻击意志同时被星辉强化。', mpRestorePercent: 30, buff: { id: 'auroraOmen', name: '极光战兆', icon: '🌠', color: '#8cc8d8', atkPercent: 20, matkPercent: 20, durationBattles: 3 } },
                fail: { text: '过量星光灌入意识，虚假征兆令攻势变得犹疑。', mpRestorePercent: -30, buff: { id: 'falseOmen', name: '伪星兆', icon: '🌑', color: '#686f91', atkPercent: -20, matkPercent: -20, durationBattles: 3 } },
            },
            {
                id: 'chooseFallingStar', label: '幸运接星', description: '在无数光点中选择一枚即将坠入锁匣的星辉', attribute: 'luck', baseRate: 15,
                success: { text: '选中的星辉正中锁匣，里面保存着陨铁金币、三枚强化结晶和两张改造凭证。', gold: { min: 220, max: 260 }, specialItems: [{ type: 'enhancement_stone', count: 3 }, { type: 'reforge_ticket', count: 2 }] },
                fail: { text: '星辉偏离锁匣击中冰镜，爆开的寒光震伤身体并削弱护甲。', damagePercent: 30, buff: { id: 'starfallFracture', name: '坠星震裂', icon: '☄️', color: '#747fa0', defPercent: -20, durationBattles: 3 } },
            },
            {
                id: 'leave', label: '停住星环', description: '固定机关，避免观星台继续磨损',
                outcome: {
                    text: '你锁住外层星环时，内层机关仍按旧轨道继续转动。错位星辉从冰镜中反射回来，震伤身体并在护甲上留下不断扩大的霜裂。',
                    damagePercent: 20,
                    buff: { id: 'observatoryFrostFracture', name: '星镜霜裂', icon: '☄️', color: '#747fa0', defPercent: -15, durationBattles: 3 },
                },
            },
        ],
    },
};

// ============================================================
// 通用事件处理器
// ============================================================

export function handleNewDungeonEvent(player, choiceId, eventType, dungeonMapSystem = null, goldMultiplier = 1) {
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
        return _applyOutcome(player, outcome, dungeonMapSystem, null, true, choice, config, goldMultiplier);
    }

    const checkResult = AttributeCheckSystem.check(player, choice.attribute, choice.baseRate);
    const success = checkResult.success;
    const outcome = success ? (choice.success || {}) : (choice.fail || {});
    return _applyOutcome(player, outcome, dungeonMapSystem, checkResult, success, choice, config, goldMultiplier);
}

function _applyOutcome(player, outcome, dungeonMapSystem, checkResult, success, choice, config, goldMultiplier) {
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
        const amount = _resolveGoldValue(outcome.gold, goldMultiplier);
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
        forceMonsters: outcome.forceMonsters || null,
        encounter: outcome.encounter || null,
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

function _resolveGoldValue(value, multiplier = 1) {
    const parsedMultiplier = Number(multiplier);
    const safeMultiplier = Number.isFinite(parsedMultiplier) && parsedMultiplier >= 0
        ? parsedMultiplier
        : 1;
    if (typeof value === 'number') return Math.round(value * safeMultiplier);
    if (value && typeof value === 'object' && value.min !== undefined && value.max !== undefined) {
        const scaledMin = Math.round(Number(value.min) * safeMultiplier);
        const scaledMax = Math.round(Number(value.max) * safeMultiplier);
        const min = Math.min(scaledMin, scaledMax);
        const max = Math.max(scaledMin, scaledMax);
        return min + Math.floor(Math.random() * (max - min + 1));
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
        player.addStatusEffect(buffCfg.id, 999999, {
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
