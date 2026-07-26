/**
 * 沼泽地专属随机事件（草稿，未接入——2026-07-25 设计定稿后由用户逐步调整）
 *
 * 结构对齐 dungeon-event-definitions.js 的 NEW_EVENT_CONFIGS / RESTRICTED_EVENT_META。
 * 当前不被任何代码 import，不会生效。
 *
 * 接入步骤（确认后执行）：
 * 1. 把 SWAMP_EVENT_CONFIGS 并入 NEW_EVENT_CONFIGS（或作为独立 map 注册）；
 * 2. 把 SWAMP_RESTRICTED_EVENT_META 并入 RESTRICTED_EVENT_META（scope 用 'swamp'）；
 * 3. dungeon-event-system.js rollEventType 的 family 映射：'swamp' 不再映射 'zombie'；
 * 4. EVENT_BG_IMAGES 补 10 张背景图（assets/scenes/dungeon-events/，可先用占位）；
 * 5. 注意「地牢等级 ±1」规则：沼泽-高级（C）只会抽到 B/C/D 事件。
 *
 * outcome 支持键（handleNewDungeonEvent 已实现）：
 *   text / gold{min,max} / hpPotion / mpPotion / material{type,count} / specialItems[]
 *   healPercent / mpRestorePercent / damagePercent / combat('elite'|true) / forceMonsters
 *   revealNodes(+revealDepth) / buff{name,...}
 */

export const SWAMP_RESTRICTED_EVENT_META = {
    quicksandMire: { grade: 'F', scope: 'swamp' },
    miasmaBubbles: { grade: 'F', scope: 'swamp' },
    willOWisp: { grade: 'E', scope: 'swamp' },
    leechSwarm: { grade: 'E', scope: 'swamp' },
    sunkenCaravan: { grade: 'D', scope: 'swamp' },
    frogIdol: { grade: 'D', scope: 'swamp' },
    miasmaGeyser: { grade: 'D', scope: 'swamp' },
    vineChest: { grade: 'C', scope: 'swamp' },
    mistLanternHermit: { grade: 'C', scope: 'swamp' },
    sleepingBehemoth: { grade: 'B', scope: 'swamp' },
};

export const SWAMP_EVENT_CONFIGS = {
    // ============================================================
    // F 级
    // ============================================================
    quicksandMire: {
        title: '泥潭陷坑',
        description: '前方的地面看似坚实的草皮，踏上去却传来令人心悸的松软感——一大片泥潭隐藏在浮草之下，墨绿色的泥浆正缓慢地冒着气泡。你的一条腿已经陷了进去，冰冷的泥浆正顺着小腿往上爬。泥潭深处隐约有什么东西在闪光，也许是前人留下的遗物，也许只是碎玻璃。',
        choices: [
            {
                id: 'forceOut',
                label: '蛮力挣脱',
                description: '用蛮力把自己从泥潭里拔出来',
                attribute: 'str',
                baseRate: 35,
                success: {
                    text: '你低吼一声，双臂撑住泥面猛一发力，伴随着一声响亮的"啵"，整个人从泥潭里拔了出来。手上还攥着泥底摸到的一件遗物。',
                    gold: { min: 30, max: 50 },
                },
                fail: {
                    text: '你越挣扎陷得越深，泥浆一直没到了腰部。费了九牛二虎之力爬出来时，双腿已经麻木得不听使唤。',
                    damagePercent: 8,
                    buff: { id: 'mudSlow', name: '泥沼缠身', moveSpeedPercent: -15, duration: 'battle' },
                },
            },
            {
                id: 'crawlOut',
                label: '匍匐脱困',
                description: '趴低身体分散重量，慢慢爬出',
                attribute: 'dex',
                baseRate: 40,
                success: {
                    text: '你立刻趴平身体，像蜥蜴一样摊开四肢，一点一点把重量分散到浮草上，缓缓爬回了坚实的地面。临走还顺手捞起了泥里的闪光物。',
                    gold: { min: 30, max: 50 },
                },
                fail: {
                    text: '你刚趴下一半，浮草突然整块塌陷，整个人重重地砸进泥里。爬出来时浑身裹满了腥臭的泥浆。',
                    damagePercent: 8,
                    buff: { id: 'mudSlow', name: '泥沼缠身', moveSpeedPercent: -15, duration: 'battle' },
                },
            },
        ],
    },
    miasmaBubbles: {
        title: '腐臭气泡带',
        description: '前方的水洼上布满了拳头大的气泡，咕嘟咕嘟地此起彼伏。每当一个气泡破裂，就喷出一股黄绿色的臭气，甜腻中带着腐尸般的恶臭。气泡带绵延数十步，绕路要多走很久。你认出这是沼泽瘴气的聚集——吸入过多可不是闹着玩的。',
        choices: [
            {
                id: 'breathHold',
                label: '屏息硬闯',
                description: '深吸一口气，屏住呼吸冲过去',
                attribute: 'con',
                baseRate: 30,
                success: {
                    text: '你深深吸气，把胸腔撑到极限，然后埋头冲进气泡带。气泡在你脚边接连炸开，你硬是憋着气冲到了对岸，肺里没进一丝瘴气。顺手还捞起气泡带中央一小簇凝结的魔法粉尘。',
                    material: { type: 'magic_dust', count: 80 },
                },
                fail: {
                    text: '冲到一半你实在憋不住了，本能地大口喘气——一股甜腻的瘴气直灌肺里，你顿时觉得天旋地转，胃里翻江倒海。',
                    specialItems: [],
                    damagePercent: 5,
                    buff: { id: 'miasmaPoison', name: '瘴气中毒', poisonStacks: 2 },
                },
            },
            {
                id: 'detonate',
                label: '投石引爆',
                description: '远远投石引爆气泡，等瘴气散尽再通过',
                attribute: 'int',
                baseRate: 35,
                success: {
                    text: '你退到上风处，捡起石块一颗颗投进气泡带。气泡接连爆裂，瘴气在水面上翻滚升腾，被风一卷而散。等最后一缕黄烟散去，你大摇大摆地走了过去，还收集到一小簇粉尘。',
                    material: { type: 'magic_dust', count: 80 },
                },
                fail: {
                    text: '你投出的石块引爆了气泡，但风向突然一转，整片瘴气朝你脸上扑来。你咳嗽着逃出气团，喉咙里满是铁锈味。',
                    damagePercent: 5,
                    buff: { id: 'miasmaPoison', name: '瘴气中毒', poisonStacks: 2 },
                },
            },
        ],
    },

    // ============================================================
    // E 级
    // ============================================================
    willOWisp: {
        title: '鬼火引诱',
        description: '浓雾深处亮起一点幽蓝的火焰，忽明忽暗，像在对你眨眼。它缓缓飘动，始终与你保持着不远不近的距离，仿佛在引你跟随。老猎人说过，沼泽的鬼火是溺死者的执念所化——跟着它，要么找到死者生前的宝藏，要么成为下一个鬼火。',
        choices: [
            {
                id: 'resist',
                label: '闭眼直行',
                description: '不为所动，按自己的方向走',
                attribute: 'wis',
                baseRate: 35,
                success: {
                    text: '你闭上眼睛，凭记忆和直觉直行。耳边的低语声渐渐远去，再睁眼时鬼火已消失不见，而你的方向感告诉你，前方的路看得更清楚了。',
                    revealNodes: 2,
                    revealDepth: 2,
                },
                fail: {
                    text: '你试图无视它，可那点蓝光像钉子一样扎在你的余光里。不知不觉间脚步已经偏离了方向，一脚踩进了泥沼。',
                    damagePercent: 10,
                    combat: true,
                },
            },
            {
                id: 'follow',
                label: '跟随鬼火',
                description: '赌一把，看它到底想去哪',
                attribute: 'luck',
                baseRate: 30,
                success: {
                    text: '鬼火带着你在泥沼间穿行，七拐八绕后停在一处微高的草丘上，然后"噗"地散开。草丘下埋着一个腐烂的木箱，里面的钱币竟然完好无损。',
                    gold: { min: 150, max: 220 },
                },
                fail: {
                    text: '鬼火越飘越快，你深一脚浅一脚地追，直到它突然熄灭——四周响起悉悉索索的声音，你被引入了怪物的巢穴。',
                    damagePercent: 10,
                    combat: true,
                },
            },
        ],
    },
    leechSwarm: {
        title: '吸血水蛭群',
        description: '涉过一片浅水时，你感觉小腿上一阵酥麻。低头一看，十几条黑褐色的水蛭已经牢牢吸在了你的腿上，每一条都有手指粗细，身体正随着吸血一鼓一鼓地胀大。硬拽会把吸盘留在肉里，但放任不管，它们能把你吸干。',
        choices: [
            {
                id: 'endure',
                label: '忍痛拔除',
                description: '咬紧牙关一条条揪下来',
                attribute: 'con',
                baseRate: 35,
                success: {
                    text: '你忍着刺痛，用指甲掐住水蛭吸盘的边缘一条条掀开。伤口虽多却都不深。你把几条肥硕的水蛭收进袋子——晒干了是上好的药材。',
                    material: { type: 'magic_dust', count: 60 },
                },
                fail: {
                    text: '你粗暴地拽下水蛭，吸盘撕裂了皮肤，血顺着小腿往下淌，怎么也止不住。',
                    buff: { id: 'leechBleed', name: '水蛭咬伤', bleedStacks: 2 },
                },
            },
            {
                id: 'salt',
                label: '盐袋驱杀',
                description: '用盐刺激水蛭自行脱落',
                attribute: 'int',
                baseRate: 40,
                success: {
                    text: '你想起行囊里的盐袋，抓了一把盐按在水蛭上。水蛭们像被烫到一样蜷缩脱落，连吸盘都干干净净。你顺手把瘫软的水蛭收了起来。',
                    material: { type: 'magic_dust', count: 60 },
                },
                fail: {
                    text: '你摸遍全身才想起盐袋早就用完了。等你手忙脚乱地处理完，几条水蛭已经吸得滚圆，伤口血流不止。',
                    buff: { id: 'leechBleed', name: '水蛭咬伤', bleedStacks: 2 },
                },
            },
        ],
    },

    // ============================================================
    // D 级
    // ============================================================
    sunkenCaravan: {
        title: '沉没的商队',
        description: '一汪深潭中央，斜插着半截商队的旗杆。水面下隐约可见几辆货车的轮廓，铜铃在水流中发出沉闷的声响。这支商队显然没能走出沼泽，但车上的货物也许还封存在油布之下。潭水幽深冰冷，水底光线昏暗，看不清有没有别的什么东西在游动。',
        choices: [
            {
                id: 'dive',
                label: '潜水打捞',
                description: '憋气潜到货车旁摸索货物',
                attribute: 'dex',
                baseRate: 30,
                success: {
                    text: '你深吸一口气潜入潭底，摸到一辆货车的油布暗袋——里面的钱币和一块强化石竟然密封完好。上浮时你总觉得有什么擦着脚踝游过，但你没有回头。',
                    gold: { min: 200, max: 300 },
                    specialItems: [{ type: 'enhancement_stone', count: 1 }],
                },
                fail: {
                    text: '你在昏暗的水底摸了半天，只抓到满手淤泥。氧气耗尽前你狼狈地浮出水面，还呛了几口臭水。',
                    damagePercent: 5,
                },
            },
            {
                id: 'drag',
                label: '绳索拉拽',
                description: '用绳索套住货车，在岸上拉',
                attribute: 'str',
                baseRate: 35,
                success: {
                    text: '你把绳索打了个套索甩进水里，试了几次终于套住货车一角。随着你发力，一辆小货车被缓缓拖到浅滩，油布暗袋里的货物完好无损。',
                    gold: { min: 200, max: 300 },
                    specialItems: [{ type: 'enhancement_stone', count: 1 }],
                },
                fail: {
                    text: '货车拉到一半，绳索"啪"地崩断，反把你带进了冰冷的潭水里。你爬上岸时冻得直打哆嗦，什么都没捞着。',
                    damagePercent: 5,
                },
            },
        ],
    },
    frogIdol: {
        title: '沼泽蛙神像',
        description: '一块隆起的泥台上，蹲坐着一尊半人高的石蛙雕像。石蛙通体布满青苔，鼓鼓的肚皮上刻满了螺旋纹路，张大的嘴里积着雨水，水底沉着一层亮闪闪的钱币。这是沼泽居民供奉的蛙神，传说向它投币的人会得到庇护，而惊扰它的人会被霉运缠身。',
        choices: [
            {
                id: 'offer',
                label: '投币献祭（-100 金币）',
                description: '往蛙神嘴里投一枚钱币',
                goldCost: 100,
                success: {
                    text: '钱币落入蛙口，"咚"的一声脆响。石蛙的螺旋纹路似乎闪过一丝微光，你感到一层温润的气息包裹住了全身。',
                    buff: { id: 'frogBless', name: '蛙神庇护', defPercent: 10, duration: 'battle' },
                },
            },
            {
                id: 'leave',
                label: '绕行离开',
                description: '不打扰它，继续赶路',
                success: {
                    text: '你绕开泥台继续赶路。身后似乎传来一声若有若无的蛙鸣，但你没有回头。',
                },
            },
        ],
    },
    miasmaGeyser: {
        title: '瘴气喷泉',
        description: '前方的地面裂开一道窄缝，黄绿色的瘴气正从缝里间歇性地喷涌而出，每次喷发都伴随着沉闷的嘶鸣，气柱能冲起两人多高。喷发的间隙很短，但确实是唯一的安全窗口。裂缝对面的地面上，散落着几件没能通过者的装备。',
        choices: [
            {
                id: 'dash',
                label: '冲刺穿越',
                description: '抓住喷发间隙一口气冲过去',
                attribute: 'dex',
                baseRate: 35,
                success: {
                    text: '你盯着气柱的节奏默念计时，在喷发停歇的瞬间箭步冲出。瘴气在你身后炸开，而你已稳稳落在对岸。穿越的刺激让你血脉偾张。',
                    buff: { id: 'geyserRush', name: '穿越余韵', atkPercent: 10, duration: 'battle' },
                },
                fail: {
                    text: '你误判了节奏，刚冲到裂缝上方，气柱迎面炸开。你被冲得踉跄后退，头晕目眩地摔在对岸。',
                    damagePercent: 12,
                    buff: { id: 'geyserStun', name: '瘴气眩晕', stunMs: 1500, duration: 'battle' },
                },
            },
            {
                id: 'wait',
                label: '等待间歇',
                description: '耐心观察，算出最长的安全窗口',
                attribute: 'wis',
                baseRate: 30,
                success: {
                    text: '你蹲下身，捡起石子一次次丢向裂缝，慢慢摸清了喷发的规律——每第七次喷发后有一个格外长的间歇。你从容地走了过去，顺手捡走了对岸的一件遗物。',
                    buff: { id: 'geyserRush', name: '穿越余韵', atkPercent: 10, duration: 'battle' },
                    gold: { min: 60, max: 100 },
                },
                fail: {
                    text: '你自以为算准了，脚下却一滑，半条腿悬在裂缝上时气柱正好喷发。你被人形喷泉顶了出去。',
                    damagePercent: 12,
                    buff: { id: 'geyserStun', name: '瘴气眩晕', stunMs: 1500, duration: 'battle' },
                },
            },
        ],
    },

    // ============================================================
    // C 级
    // ============================================================
    vineChest: {
        title: '古藤缠宝箱',
        description: '一株巨树的根须间，缠着一只铜边木箱。手臂粗的藤蔓像活物一样把箱子裹了一层又一层，藤上的尖刺泛着诡异的紫光。箱缝里透出一线金色的光泽——里面的东西价值不菲。藤蔓的主根就在不远处，只要切断它，这些藤条应该就会枯萎。',
        choices: [
            {
                id: 'chop',
                label: '挥刀断藤',
                description: '直接劈开缠住箱子的藤蔓',
                attribute: 'str',
                baseRate: 35,
                success: {
                    text: '你抡圆了劈下去，藤蔓应声而断，断口处渗出紫色的汁液。缠在箱子上的藤条像泄了气一样松脱下来。箱子开了，里面的财宝完好无损。',
                    gold: { min: 200, max: 280 },
                    specialItems: [{ type: 'reforge_ticket', count: 1 }],
                    material: { type: 'magic_dust', count: 100 },
                },
                fail: {
                    text: '藤蔓比你想象的坚韧，刀口刚一落下，周围的藤条突然像鞭子一样抽了过来，尖刺在你身上划开几道口子。你忍痛劈开箱子，里面的东西已经少了一半。',
                    damagePercent: 8,
                    gold: { min: 100, max: 140 },
                },
            },
            {
                id: 'findRoot',
                label: '寻找主根',
                description: '顺藤摸瓜，切断主根让藤蔓枯萎',
                attribute: 'int',
                baseRate: 40,
                success: {
                    text: '你拨开根须仔细观察藤蔓的走向，很快锁定了那根最粗壮的主根。一刀切下去，整片藤蔓以肉眼可见的速度枯萎蜷缩。箱子轻松到手。',
                    gold: { min: 200, max: 280 },
                    specialItems: [{ type: 'reforge_ticket', count: 1 }],
                    material: { type: 'magic_dust', count: 100 },
                },
                fail: {
                    text: '你认错了一根侧根，切断的瞬间整株藤蔓像被激怒了一样疯狂扭动，尖刺雨点般落下。你护着头抢出箱子，里面的东西已经少了一半。',
                    damagePercent: 8,
                    gold: { min: 100, max: 140 },
                },
            },
        ],
    },
    mistLanternHermit: {
        title: '雾中灯语者',
        description: '浓雾深处，一盏昏黄的灯笼悬在半空，忽明忽暗地闪烁——三短，三长，三短。提灯的是个裹在蓑衣里的佝偻身影，看不清面容。他似乎在用这种古老的灯语向你传达前方的路况。答对了，他会为你指路；答错了，这片迷雾可就要自己走了。',
        choices: [
            {
                id: 'decode',
                label: '对答灯语',
                description: '读懂灯语，用同样的节奏回应',
                attribute: 'int',
                baseRate: 30,
                success: {
                    text: '你看出了灯语的节奏，用随身的火把回了同样的信号。蓑衣人发出一声轻笑，灯笼连挥三下，浓雾竟缓缓让开一条通路——前方的路尽收眼底。临走他还送了你一句祝福。',
                    revealNodes: 3,
                    revealDepth: 2,
                    buff: { id: 'hermitBless', name: '灯语祝福', duration: 'battle' },
                },
                fail: {
                    text: '你的回应显然不对，灯笼"唰"地熄灭，蓑衣人消失在雾中。你转了半天才发现，自己竟然绕回了来路。',
                    buff: { id: 'lostInMist', name: '雾中迷失', duration: 'battle' },
                },
            },
            {
                id: 'guess',
                label: '凭感觉走',
                description: '不理会灯语，凭直觉穿雾',
                attribute: 'luck',
                baseRate: 35,
                success: {
                    text: '你懒得理会那些闪烁，凭着直觉一头扎进雾里。不知走了多久，雾忽然散了——你竟直接走到了要去的地方。身后的雾里传来一声似有似无的赞许。',
                    revealNodes: 3,
                    revealDepth: 2,
                    buff: { id: 'hermitBless', name: '灯语祝福', duration: 'battle' },
                },
                fail: {
                    text: '直觉这次不灵了。你在雾里兜了一个大圈子，等雾散开时，发现自己回到了出发的地方。',
                    buff: { id: 'lostInMist', name: '雾中迷失', duration: 'battle' },
                },
            },
        ],
    },

    // ============================================================
    // B 级
    // ============================================================
    sleepingBehemoth: {
        title: '沉眠的沼泽巨兽',
        description: '前方的"小丘"忽然起伏了一下——那不是小丘，是一头伏在泥潭里沉睡的巨兽。它的脊背上长满了水草和青苔，粗重的呼吸掀起一圈圈泥浪，每一次呼吸都让脚下的地面微微震颤。它的身旁散落着啃噬过的装备和钱币，显然不少过路者成了它的点心。绕行还是偷袭，必须现在决定。',
        choices: [
            {
                id: 'sneak',
                label: '悄步绕行',
                description: '屏住呼吸，贴着草丛边缘绕过去',
                attribute: 'dex',
                baseRate: 40,
                success: {
                    text: '你放轻脚步，一寸一寸地挪过巨兽的感知范围。它的呼吸依旧平稳。绕到安全距离后你长出一口气——刚才的屏息让你对下一场战斗的准备格外充分。',
                    buff: { id: 'sneakReady', name: '潜行就绪', atkPercent: 15, duration: 'battle' },
                },
                fail: {
                    text: '一根枯枝在你脚下"咔嚓"断裂。巨兽的呼吸停了。它缓缓抬起头，浑浊的眼睛直直地锁定了你。',
                    combat: 'elite',
                },
            },
            {
                id: 'ambush',
                label: '拔剑偷袭',
                description: '趁它沉睡，先下手为强（精英战，胜利后双倍掉落）',
                success: {
                    text: '富贵险中求。你握紧武器，朝着巨兽柔软的腹部猛冲过去——它惊醒的咆哮震得整片沼泽都在颤抖。',
                    combat: 'elite',
                    forceMonsters: ['oreSpider'],
                    encounter: { doubleLoot: true },
                },
            },
        ],
    },
};
