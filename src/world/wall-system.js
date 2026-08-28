import { CONFIG } from '../config/config.js';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { getWallPrefabLibrary, loadWallGeoOverrides } from './wall-prefabs.js';
import {
    resolveDynamicStructureDepth,
    structureOcclusionBounds,
} from './structure-depth.js';
import lightingAssets from '../../data/environment-lighting-assets.json';

// ===== 等距斜墙贴图几何（贴图像素空间，wall-asset-prep.py 产出 + 拼装模拟器实测校准）=====
// base: 底边线全跨度（含端帽）；face: 正面墙底边跨度（不含端帽，拼接吸附/碰撞用）；
// vertex: 转角接合点；tipX: 臂尖底边点；wallH: 底边→顶沿墙高；slope: 贴图底边固有斜率
const ISO_WALL_GEO = {
    diag:   { tex: 'wall_diag', w: 1600, h: 1315, base: [[0, 625.6], [1600, 1409.2]], face: [[150, 699.1], [1450, 1335.7]], wallH: 824, slope: 0.4897 },
    straight: { tex: 'wall_straight', w: 1600, h: 1383, base: [[5, 617], [1594, 1418]], face: [[16, 622], [1516, 1379]], wallH: 691, slope: 0.5048, editor: '直墙·新' },
    gate: { tex: 'wall_gate', w: 640, h: 641, frames: 16, base: [[4, 294.0], [634, 611.3]], face: [[4, 294.0], [634, 611.3]], gateX: [265, 360], wallH: 290, slope: 0.5037, editor: '门墙', states: { open: { hole: [265, 360] }, closed: { hole: null } } },
    top:    { tex: 'wall_corner_top', w: 1600, h: 843, vertex: [854, 478], tipL: [250, 750], tipR: [1350, 640], wallH: 493, slope: 0.482 },
    bottom: { tex: 'wall_corner_bottom', w: 1600, h: 751, vertex: [850, 705], tipL: [130, 390], tipR: [1450, 380], wallH: 427, slope: 0.492 },
    left:   { tex: 'wall_corner_left', w: 1343, h: 1600, vertex: [50, 1020], tipUpper: [1180, 240], tipLower: [1326, 1500], wallH: 520, slope: 0.42 },
    right:  { tex: 'wall_corner_right', w: 1600, h: 1517, vertex: [1590, 930], tipUpper: [150, 300], tipLower: [310, 1450], wallH: 500, slope: 0.44 },
    // 沼泽地墙（2026-07-25 素材管线：泛洪抠图+水印 inpaint+两端锥形裁切+腐蚀 2px 去颜色污染+白边压暗）
    swamp_straight: { tex: 'swamp_wall_straight', w: 1419, h: 1558, base: [[0, 775.0], [1418, 1583.0]], face: [[28, 791.0], [1389, 1566.5]], wallH: 799.2, slope: 0.5698, editor: '沼泽柴墙' },
    // 恶魔洞窟岩壁（2026-08-11 路线 B：Blender box 几何 + AI 岩质材质 + 程序化裁切；
    // prep-demon-wall-B.py / calib-demon-straight.py 标定：内容 684×659，干净底边 slope=0.64，墙高 326）
    demon_straight: { tex: 'demon_wall_straight', w: 684, h: 659, base: [[0, 273], [683, 710]], face: [[83, 326], [601, 658]], wallH: 326, slope: 0.64, editor: '恶魔岩壁' },
    // 冰封世界初级地牢：复用同一 Blender 城墙段几何，只替换冰块砌体材质。
    // prep-frozen-wall.py 标定：透明内容 684×659，底边拟合残差最大 0.9px。
    frozen_straight: { tex: 'frozen_wall_straight', w: 684, h: 659, base: [[0, 273], [683, 710]], face: [[83, 326], [601, 658]], wallH: 326, slope: 0.64, editor: '冰封砖墙' },
    // 冰封初级竞技场单格墙：严格复用世界 1×1 方块墙的轮廓、砖块比例与显示几何。
    // obstacle_block 显示为 260×259、脚线偏移 61px；换算回 1024 源图得到 groundCenter.y=753.1737。
    frozen_block: { tex: 'frozen_wall_block', w: 1024, h: 1024, groundCenter: [512, 753.1737], displayW: 260, displayH: 259, wallH: 132, halfThick: 13, editor: '冰封单格墙' },
    // 冰封竞技场功能门：整段门洞由13枚冰锥构成，帧0完全升起、帧15沉入地面。
    // base 与 gateX 同跨度，开门后整段6格门洞放行；不附带会被横向拉伸的门框/砖墙。
    frozen_gate: { tex: 'frozen_gate', w: 640, h: 640, frames: 16, base: [[32, 300], [608, 588]], face: [[32, 300], [608, 588]], gateX: [32, 608], wallH: 288, slope: 0.5, halfThick: 13, depthSlices: 3, editor: '冰封冰锥门', states: { open: { hole: [32, 608] }, closed: { hole: null } } },
    // 僵尸地牢战斗房：Blender 黑方砖单格墙 + 仅含移动门叶的锈铁升降栅栏。
    // 门洞两端继续用 zombie_block 作同材质墙柱，不在 gate 内重复门柱/横梁；
    // 与冰封门共享精确六格底线、13px 碰撞半厚和浅/中/深分层合同。
    zombie_block: { tex: 'zombie_wall_block', w: 1024, h: 1024, groundCenter: [512, 761.9959], displayW: 260, displayH: 259, wallH: 132, halfThick: 13, editor: '僵尸黑砖单格墙' },
    zombie_gate: { tex: 'zombie_gate', w: 640, h: 640, frames: 16, base: [[32, 300], [608, 588]], face: [[32, 300], [608, 588]], gateX: [32, 608], wallH: 225.7447, slope: 0.5, halfThick: 13, depthSlices: 3, editor: '僵尸六格锈铁升降栅栏', states: { open: { hole: [32, 608] }, closed: { hole: null } } },
    // 恶魔洞窟铁闸门（路线 B：岩壁单块 + 铁栅独立渲染 → 程序化 16 帧升起；compose-demon-gate-B.py 标定：
    // 门洞平行四边形，底边与墙同斜率 0.6347，wallH 291；gateX = 门洞 [159,481]）
    demon_gate: { tex: 'demon_gate', w: 640, h: 576, frames: 16, base: [[0, 228], [639, 634]], face: [[77, 277], [563, 586]], gateX: [159, 481], wallH: 291, slope: 0.6347, editor: '恶魔铁闸', states: { open: { hole: [159, 481] }, closed: { hole: null } } },
    // 三种墙柱共享同一模型核心、锚点和 128×64 世界占地；差异只存在于崎岖表层、木撑、矿脉与补强件。
    abandoned_mine_block_a: { tex: 'abandoned_mine_wall_block_a', w: 1024, h: 1024, groundCenter: [512, 761.9959], displayW: 260, displayH: 259, wallH: 132, halfThick: 13, footprint: [128, 64], editor: '废弃矿洞单格墙·木撑' },
    abandoned_mine_block_b: { tex: 'abandoned_mine_wall_block_b', w: 1024, h: 1024, groundCenter: [512, 761.9959], displayW: 260, displayH: 259, wallH: 132, halfThick: 13, footprint: [128, 64], editor: '废弃矿洞单格墙·矿脉' },
    abandoned_mine_block_c: { tex: 'abandoned_mine_wall_block_c', w: 1024, h: 1024, groundCenter: [512, 761.9959], displayW: 260, displayH: 259, wallH: 132, halfThick: 13, footprint: [128, 64], editor: '废弃矿洞单格墙·补强' },
    // 六格门只含可升降门叶；叶片完整收在 gateX 内并按每格一片做六段深度排序。
    abandoned_mine_gate: { tex: 'abandoned_mine_gate', w: 640, h: 640, frames: 16, base: [[32.0003, 299.9994], [608.0002, 588.0004]], face: [[32.0003, 299.9994], [608.0002, 588.0004]], gateX: [32, 608], wallH: 225.7447, slope: 0.500002, halfThick: 13, depthSlices: 6, hideWhenOpen: true, editor: '废弃矿洞六格木铁升降门', states: { open: { hole: [32, 608] }, closed: { hole: null } } },
    // 沼泽地门闸（gate.mp4 16 帧已反转：首帧=关闭(藤蔓封门)、末帧=打开；tools/swamp-gate-geo.json）
    swamp_gate: { tex: 'swamp_gate', w: 640, h: 612, frames: 16, base: [[5, 275.0], [634, 632.8]], face: [[5, 275.0], [634, 632.8]], gateX: [248, 384], wallH: 301.1, slope: 0.5689, editor: '沼泽藤门', states: { open: { hole: [248, 384] }, closed: { hole: null } } },
    // 主神空间大理石墙（2026-07-29 v2 透明底素材，tools/prep-hub-wall-gate.py：最大连通域+几何实测）
    hub_straight: { tex: 'hub_wall_straight', w: 1365, h: 1183, base: [[0, 525.5], [1365, 1215.5]], face: [[41, 546.3], [1324, 1194.8]], wallH: 588.6, slope: 0.5055, editor: '主神大理石墙' },
    // 主神空间大理石门（单帧装饰门件：gateX=拱门洞跨度实测；openDoor=门洞碰撞常开可通行；非 16 帧门闸 spritesheet，不能作功能门闸）
    hub_gate: { tex: 'hub_gate', w: 1365, h: 1181, base: [[0, 435.5], [1365, 1150.0]], face: [[0, 435.5], [1365, 1150.0]], gateX: [629, 738], wallH: 617.7, slope: 0.5235, openDoor: true, editor: '主神大理石门', states: { open: { hole: [629, 738] }, closed: { hole: null } } },
    // ===== 障碍物（摆墙编辑器障碍物类；foot=贴图底部 footprint 宽高，碰撞=矩形 footprint 墙；obstacleH=默认显示高度）=====
    barrel: { tex: 'obstacle_barrel', w: 357, h: 512, category: 'obstacle', foot: { w: 277, d: 96 }, obstacleH: 120, editor: '木桶' },
    pillar: { tex: 'obstacle_pillar', w: 236, h: 640, category: 'obstacle', foot: { w: 231, d: 80 }, obstacleH: 180, editor: '石柱' },
    candle: { tex: 'obstacle_candle', w: 317, h: 640, category: 'obstacle', foot: { w: 197, d: 78 }, obstacleH: 180, editor: '烛台' },
    pot: { tex: 'obstacle_pot', w: 414, h: 512, category: 'obstacle', foot: { w: 251, d: 87 }, obstacleH: 120, editor: '陶罐' },
    skull: { tex: 'obstacle_skull', w: 323, h: 384, category: 'obstacle', foot: { w: 179, d: 62 }, obstacleH: 100, editor: '头骨' },
    bones: { tex: 'obstacle_bones', w: 512, h: 419, category: 'obstacle', foot: { w: 300, d: 105 }, obstacleH: 100, editor: '骨头堆' },
    chains: { tex: 'obstacle_chains', w: 512, h: 204, category: 'obstacle', foot: { w: 460, d: 48 }, obstacleH: 72, editor: '锁链' },
    torch: { tex: 'obstacle_torch', w: 144, h: 278, category: 'obstacle', obstacleH: 160, editor: '火把' }, // 无 foot：火把全局无碰撞体积（墙面挂饰，2026-08 规则）
    bottle1: { tex: 'obstacle_bottle1', w: 412, h: 245, category: 'obstacle', foot: { w: 247, d: 61 }, obstacleH: 80, editor: '瓶-1' },
    bottle2: { tex: 'obstacle_bottle2', w: 160, h: 476, category: 'obstacle', foot: { w: 96, d: 119 }, obstacleH: 80, editor: '瓶-2' },
    bottle3: { tex: 'obstacle_bottle3', w: 190, h: 580, category: 'obstacle', foot: { w: 114, d: 145 }, obstacleH: 80, editor: '瓶-3' },
    bottle4: { tex: 'obstacle_bottle4', w: 202, h: 448, category: 'obstacle', foot: { w: 121, d: 112 }, obstacleH: 80, editor: '瓶-4' },
    woodpile: { tex: 'obstacle_woodpile', w: 512, h: 448, category: 'obstacle', foot: { w: 400, d: 140 }, obstacleH: 134, editor: '木材堆' },
    orepile: { tex: 'obstacle_orepile', w: 512, h: 397, category: 'obstacle', foot: { w: 400, d: 120 }, obstacleH: 119, editor: '铁矿堆' },
    sandbag: { tex: 'obstacle_sandbag', w: 1224, h: 974, category: 'obstacle', foot: { w: 1100, d: 250 }, obstacleH: 140, editor: '沙袋' },
    barricade: { tex: 'obstacle_barricade', w: 1086, h: 1099, category: 'obstacle', foot: { w: 980, d: 160 }, obstacleH: 140, editor: '木制拒马' },
    // 世界-122 掩体（F→A 六档 × 水平摆(_h)/垂直摆(_v)，2026-08-04 dev+mesh 生图入库；
    // foot=底部 15% 带实测，obstacleH=默认显示高度（掩体≈260 宽等比、塔=262））
    cover_F_h: { tex: 'obstacle_cover_F_h', w: 1024, h: 1024, category: 'obstacle', foot: { w: 176, d: 58 }, obstacleH: 259, editor: '掩体·F级·水平' },
    cover_F_v: { tex: 'obstacle_cover_F_v', w: 1024, h: 1024, category: 'obstacle', foot: { w: 176, d: 58 }, obstacleH: 259, editor: '掩体·F级·垂直' },
    cover_E_h: { tex: 'obstacle_cover_E_h', w: 1024, h: 1024, category: 'obstacle', foot: { w: 176, d: 58 }, obstacleH: 259, editor: '掩体·E级·水平' },
    cover_E_v: { tex: 'obstacle_cover_E_v', w: 1024, h: 1024, category: 'obstacle', foot: { w: 176, d: 58 }, obstacleH: 259, editor: '掩体·E级·垂直' },
    cover_D_h: { tex: 'obstacle_cover_D_h', w: 1024, h: 1024, category: 'obstacle', foot: { w: 176, d: 58 }, obstacleH: 259, editor: '掩体·D级·水平' },
    cover_D_v: { tex: 'obstacle_cover_D_v', w: 1024, h: 1024, category: 'obstacle', foot: { w: 176, d: 58 }, obstacleH: 259, editor: '掩体·D级·垂直' },
    cover_C_h: { tex: 'obstacle_cover_C_h', w: 1024, h: 1024, category: 'obstacle', foot: { w: 176, d: 58 }, obstacleH: 259, editor: '掩体·C级·水平' },
    cover_C_v: { tex: 'obstacle_cover_C_v', w: 1024, h: 1024, category: 'obstacle', foot: { w: 176, d: 58 }, obstacleH: 259, editor: '掩体·C级·垂直' },
    cover_B_h: { tex: 'obstacle_cover_B_h', w: 1024, h: 1024, category: 'obstacle', foot: { w: 176, d: 58 }, obstacleH: 259, editor: '掩体·B级·水平' },
    cover_B_v: { tex: 'obstacle_cover_B_v', w: 1024, h: 1024, category: 'obstacle', foot: { w: 176, d: 58 }, obstacleH: 259, editor: '掩体·B级·垂直' },
    cover_A_h: { tex: 'obstacle_cover_A_h', w: 1024, h: 1024, category: 'obstacle', foot: { w: 176, d: 58 }, obstacleH: 259, editor: '掩体·A级·水平' },
    cover_A_v: { tex: 'obstacle_cover_A_v', w: 1024, h: 1024, category: 'obstacle', foot: { w: 176, d: 58 }, obstacleH: 259, editor: '掩体·A级·垂直' },
    // 防御塔（基座去臂版；机械臂是独立视觉层 obstacle_defense_tower_arm，无碰撞不注册）
    defense_tower: { tex: 'obstacle_defense_tower', w: 539, h: 832, category: 'obstacle', foot: { w: 468, d: 164 }, obstacleH: 262, editor: '防御塔' },
    // 仙人掌障碍物（2026-08-24 V2：Blender 形态建模→ImageGen 材质精修→BiRefNet 真透明）。
    // w/h 使用紧身裁切后的真实像素；foot 随分辨率等比换算，保持原有世界碰撞占地不变。
    // obstacleH、稳定纹理键与 cactusScatter 随机镜像/散布合同不变，旧存档无需迁移。
    cactus_saguaro2arm: { tex: 'obstacle_cactus_saguaro2arm', w: 568, h: 1147, category: 'obstacle', foot: { w: 139, d: 49 }, obstacleH: 240, shadow: { kind: 'projection', heightMul: 1.0, maxOffset: 72, visualWidthMul: 1.20, visualDepthMul: 1.25 }, editor: '仙人掌·双臂' },
    cactus_saguaro1arm: { tex: 'obstacle_cactus_saguaro1arm', w: 395, h: 1046, category: 'obstacle', foot: { w: 147, d: 53 }, obstacleH: 230, shadow: { kind: 'projection', heightMul: 1.0, maxOffset: 68, visualWidthMul: 1.20, visualDepthMul: 1.25 }, editor: '仙人掌·单臂' },
    cactus_barrel: { tex: 'obstacle_cactus_barrel', w: 872, h: 888, category: 'obstacle', foot: { w: 382, d: 132 }, obstacleH: 105, shadow: { kind: 'projection', heightMul: 0.35, maxOffset: 22, visualWidthMul: 1.60, visualDepthMul: 1.45 }, editor: '仙人掌·桶状' },
    cactus_cholla: { tex: 'obstacle_cactus_cholla', w: 708, h: 1133, category: 'obstacle', foot: { w: 146, d: 53 }, obstacleH: 150, shadow: { kind: 'projection', heightMul: 0.65, maxOffset: 42, visualWidthMul: 1.30, visualDepthMul: 1.35 }, editor: '仙人掌·多节' },
    // 世界-123 雪原松树 V2（2026-08-24：Blender 五形态建模→ImageGen 材质精修→BiRefNet 真透明）。
    // w/h 使用紧身裁切后的真实像素；foot 随分辨率等比换算，保持原有世界碰撞占地不变。
    // obstacleH=390、稳定纹理键、五形态等概率散布及随机镜像合同不变。
    snow_pine_01: { tex: 'obstacle_snow_pine_01', w: 696, h: 1438, category: 'obstacle', foot: { w: 150, d: 79 }, obstacleH: 390, shadow: { kind: 'projection', heightMul: 0.8, maxOffset: 72, visualWidthMul: 1.1, visualDepthMul: 1.1 }, editor: '雪松·直立密冠' },
    snow_pine_02: { tex: 'obstacle_snow_pine_02', w: 707, h: 1525, category: 'obstacle', foot: { w: 182, d: 88 }, obstacleH: 390, shadow: { kind: 'projection', heightMul: 0.8, maxOffset: 72, visualWidthMul: 1.1, visualDepthMul: 1.1 }, editor: '雪松·左倾承雪' },
    snow_pine_03: { tex: 'obstacle_snow_pine_03', w: 707, h: 1479, category: 'obstacle', foot: { w: 220, d: 91 }, obstacleH: 390, shadow: { kind: 'projection', heightMul: 0.8, maxOffset: 72, visualWidthMul: 1.1, visualDepthMul: 1.1 }, editor: '雪松·右倾断层' },
    snow_pine_04: { tex: 'obstacle_snow_pine_04', w: 671, h: 1165, category: 'obstacle', foot: { w: 189, d: 78 }, obstacleH: 390, shadow: { kind: 'projection', heightMul: 0.8, maxOffset: 72, visualWidthMul: 1.1, visualDepthMul: 1.1 }, editor: '雪松·强风偏冠' },
    snow_pine_05: { tex: 'obstacle_snow_pine_05', w: 530, h: 1177, category: 'obstacle', foot: { w: 180, d: 74 }, obstacleH: 390, shadow: { kind: 'projection', heightMul: 0.8, maxOffset: 72, visualWidthMul: 1.1, visualDepthMul: 1.1 }, editor: '雪松·老龄疏枝' },
    // 世界-124 林地针叶树：白模深度锁姿态 → FLUX.2 Dev → BiRefNet 原图抠图。
    forest_pine_01: { tex: 'obstacle_forest_pine_01', w: 330, h: 845, category: 'obstacle', foot: { w: 115, d: 60 }, obstacleH: 400, editor: '林地松·直立' },
    forest_pine_02: { tex: 'obstacle_forest_pine_02', w: 376, h: 974, category: 'obstacle', foot: { w: 130, d: 64 }, obstacleH: 400, editor: '林地松·左倾' },
    forest_pine_03: { tex: 'obstacle_forest_pine_03', w: 452, h: 939, category: 'obstacle', foot: { w: 145, d: 68 }, obstacleH: 400, editor: '林地松·右倾' },
    forest_pine_04: { tex: 'obstacle_forest_pine_04', w: 435, h: 937, category: 'obstacle', foot: { w: 150, d: 68 }, obstacleH: 400, editor: '林地松·偏风' },
    forest_pine_05: { tex: 'obstacle_forest_pine_05', w: 476, h: 915, category: 'obstacle', foot: { w: 160, d: 70 }, obstacleH: 400, editor: '林地松·疏枝' },
};

// 地牢墙样式表（key = dungeonType；新地牢在此登记。值 = ISO_WALL_GEO 键 + 配套资源）
// corners（可选）：四顶点夹角预制名（摆墙编辑器手工拼装）——登记后菱形房间四角用预制构建，缺省回退程序化转角臂
const ISO_WALL_STYLES = {
    default: { straight: 'straight', gate: 'gate', chestPrefab: '宝箱房', gateSound: 'assets/sounds/environment/gate.mp3' },
    zombie: {
        straight: 'straight', block: 'zombie_block', gate: 'zombie_gate', chestPrefab: '宝箱房',
        gateSound: 'assets/sounds/environment/gate.mp3',
    },
    swamp: {
        straight: 'swamp_straight', gate: 'swamp_gate', chestPrefab: '沼泽宝箱房', gateSound: 'assets/sounds/environment/swamp_gate.mp3',
        corners: { top: '沼泽墙上夹角', bottom: '沼泽下夹角', left: '沼泽墙左夹角', right: '沼泽墙右夹角' },
    },
    // 恶魔洞窟（C 级，2026-08-11）：矿洞岩壁 + 铁闸门。corners 待 demon 转角预制就绪后登记
    demonCavern: {
        straight: 'demon_straight', gate: 'demon_gate', chestPrefab: '宝箱房',
        gateSound: 'assets/sounds/environment/gate.mp3',
    },
    abandonedMine: {
        block: 'abandoned_mine_block_a',
        blocks: ['abandoned_mine_block_a', 'abandoned_mine_block_b', 'abandoned_mine_block_c'],
        allowBlockFlipX: false,
        gate: 'abandoned_mine_gate', chestPrefab: '宝箱房',
        gateSound: 'assets/sounds/environment/gate.mp3',
    },
    // 冰封世界初级：单格冰墙环 + 全门洞冰锥升降门。
    frozen: {
        straight: 'frozen_straight', block: 'frozen_block', gate: 'frozen_gate', chestPrefab: '宝箱房',
        gateSound: 'assets/sounds/skills/icewall.mp3',
    },
    // 主神空间：大理石直墙 + 大理石门（不登记 corners → 程序化转角臂）
    mainHub: { straight: 'hub_straight', gate: 'hub_gate', chestPrefab: '宝箱房', gateSound: 'assets/sounds/environment/gate.mp3' },
};
const ISO_WALL_HEIGHT = 190;    // 目标墙高（世界像素，底边→顶沿）
const ISO_TILE_OVERLAP = 40;    // 瓦片向转角臂内侵入（覆盖式拼接）
// 地板线视觉斜率：实测 blackbrick 29.7° / hub_brick 30.7°，取标准 30°（tan30°=0.5774）
// 注意：引擎碰撞投影 PERSPECTIVE_SCALE_Y=0.5(26.57°) 不可见，不参与视觉对齐
const FLOOR_SLOPE = 0.5774;

/** 角度补偿：贴图固有斜率 → 显示斜率对齐地板线（scaleY 比例系数） */
export function slopeFixOf(geo) {
    return FLOOR_SLOPE / (geo && geo.slope ? geo.slope : 0.49);
}

/**
 * 门洞跨度（贴图 x 坐标 [x1, x2]）：门两状态数据模型 states.open.hole 优先，
 * 回退旧 gateX 字段（碰撞编辑器按 states 写覆盖层，gateX 同步保持兼容）
 */
export function isoGateHole(g) {
    return (g && g.states && g.states.open && g.states.open.hole) || (g && g.gateX) || null;
}

/** 墙件碰撞半厚（世界像素）：geo.halfThick 覆盖，缺省 10 */
export function isoHalfThick(g) {
    return (g && typeof g.halfThick === 'number') ? g.halfThick : 10;
}
// 转角图层顺序（由前到后）：下 > 左 > 右 > 上
const ISO_CORNER_DEPTH_BIAS = { top: 0, right: 1, left: 2, bottom: 3 };

const WallSystem = {
    // [PERF-2026-08-03] 碰撞空间加速：walls/isoSegments/trees 以"原始数组 + 访问器"暴露。
    // 读侧返回惰性代理，任何 push/splice/下标赋值自动标记脏；_getCollisionGrid 惰性重建
    // 空间网格，canMoveTo/blocked/_nearestBlockingSeg 改为网格近邻查询（谓词与线性版完全一致，
    // 关掉 _collisionAccel 即回退线性扫描，供差分测试/疑难排查）。语义零变化。
    _wallsRaw: [],
    _isoSegmentsRaw: null,
    _treesRaw: null,
    _wallsProxy: null,
    _isoSegmentsProxy: null,
    _treesProxy: null,
    _collisionGrid: null,
    _collisionGridDirty: true,
    // 墙段/门段/边界增删的轻量拓扑版本。纯视觉平民等非实体对象据此只在变化时
    // 重做静止占用投影，不需要每帧序列化全部墙段坐标。
    _collisionRevision: 0,
    _collisionAccel: true,
    get walls() { return this._trackedArray('walls'); },
    set walls(v) { this._setTrackedArray('walls', v); },
    get isoSegments() { return this._trackedArray('isoSegments'); },
    set isoSegments(v) { this._setTrackedArray('isoSegments', v); },
    get trees() { return this._trackedArray('trees'); },
    set trees(v) { this._setTrackedArray('trees', v); },
    isoVisuals: [],  // 等距斜墙视觉件（仅渲染，碰撞由 walls 中的阶梯矩形承担）
    mazeEndY: 0,
    _wallHeight: 60,
    _wallStyleKey: 'default', // 当前墙样式（dungeonType；DungeonMapSystem 入场设置、离场复位）
    _phaserVisualsEnabled: false,

    /** 设置当前墙样式（key = dungeonType，无登记回退 default） */
    setWallStyle(key) {
        this._wallStyleKey = ISO_WALL_STYLES[key] ? key : 'default';
    },
    /** 当前样式的几何键 { straight, gate } */
    getWallStyleGeos() {
        return ISO_WALL_STYLES[this._wallStyleKey] || ISO_WALL_STYLES.default;
    },
    /** 当前样式完整条目（straight/gate 几何键 + chestPrefab 宝箱房预制名 + gateSound 门闸音效） */
    getWallStyle() {
        return ISO_WALL_STYLES[this._wallStyleKey] || ISO_WALL_STYLES.default;
    },
    init(_ww, _wh) {
        this.walls = [];
        this.isoVisuals = [];
        this.isoSegments = []; // 新场景全清（门闸线段由门实体放置后重新注册）
        this._faceSegCache = null; // 衔接仲裁缓存随场景重建失效
        this._dynamicStructureDepthFrameCache = null;
        this._dynamicStructureDepthSpatialCache = null;
        this.trees = [];
        // 主神空间不再生成迷宫（开阔测试场地；maze-generator.js 保留备用）
        this.mazeEndY = 0;
        // ===== Phaser 墙壁同步 =====
        this._syncWallsToPhaser();
    },

    // ============ [PERF-2026-08-03] 碰撞空间加速 ============

    /** 返回跟踪代理（惰性创建并缓存）；raw 为 null/undefined 时原样返回（保持旧语义） */
    _trackedArray(name) {
        const rawKey = `_${name}Raw`;
        const proxyKey = `_${name}Proxy`;
        const raw = this[rawKey];
        if (raw === null || raw === undefined) return raw;
        if (this[proxyKey]) return this[proxyKey];
        const owner = this;
        this[proxyKey] = new Proxy(raw, {
            set(t, p, v, r) { owner._markCollisionDirty(); return Reflect.set(t, p, v, r); },
            deleteProperty(t, p) { owner._markCollisionDirty(); return Reflect.deleteProperty(t, p); },
        });
        return this[proxyKey];
    },

    _setTrackedArray(name, v) {
        this[`_${name}Raw`] = v;
        this[`_${name}Proxy`] = null;
        this._markCollisionDirty();
    },

    _markCollisionDirty() {
        this._collisionGridDirty = true;
        this._collisionRevision = (Number(this._collisionRevision) || 0) + 1;
    },

    /** 取空间网格（脏/缺失/长度指纹变化时重建）。长度指纹兜底捕获"整体赋值后再直接改原数组"的绕过场景 */
    _getCollisionGrid() {
        if (this._collisionGrid && !this._collisionGridDirty) {
            const g = this._collisionGrid;
            const wLen = this._wallsRaw ? this._wallsRaw.length : 0;
            const sLen = this._isoSegmentsRaw ? this._isoSegmentsRaw.length : 0;
            const tLen = this._treesRaw ? this._treesRaw.length : 0;
            if (g.wallsLen === wLen && g.segsLen === sLen && g.treesLen === tLen) return g;
            this._collisionGridDirty = true;
        }
        if (this._collisionGridDirty || !this._collisionGrid) this._buildCollisionGrid();
        return this._collisionGrid;
    },

    _buildCollisionGrid() {
        const cell = 128;
        const cells = new Map();
        const key = (cx, cy) => `${cx},${cy}`;
        const put = (item, minX, minY, maxX, maxY) => {
            const minCX = Math.floor(minX / cell);
            const maxCX = Math.floor(maxX / cell);
            const minCY = Math.floor(minY / cell);
            const maxCY = Math.floor(maxY / cell);
            for (let cy = minCY; cy <= maxCY; cy++) {
                for (let cx = minCX; cx <= maxCX; cx++) {
                    const k = key(cx, cy);
                    let arr = cells.get(k);
                    if (!arr) { arr = []; cells.set(k, arr); }
                    arr.push(item);
                }
            }
        };
        let maxSegThick = 0;
        let maxTreeR = 0;
        const walls = this._wallsRaw || [];
        const segs = this._isoSegmentsRaw || [];
        const trees = this._treesRaw || [];
        for (const w of walls) put({ type: 'wall', obj: w }, w.x, w.y, w.x + w.w, w.y + w.h);
        for (let si = 0; si < segs.length; si++) {
            const s = segs[si];
            const ht = s.halfThick || 0;
            if (ht > maxSegThick) maxSegThick = ht;
            put({ type: 'seg', obj: s, idx: si },
                Math.min(s.x1, s.x2) - ht, Math.min(s.y1, s.y2) - ht,
                Math.max(s.x1, s.x2) + ht, Math.max(s.y1, s.y2) + ht);
        }
        for (const t of trees) {
            const tr = t.collisionRadius || t.radius * 0.6 || 0;
            if (tr > maxTreeR) maxTreeR = tr;
            put({ type: 'tree', obj: t }, t.x - tr, t.y - tr, t.x + tr, t.y + tr);
        }
        this._collisionGrid = {
            cell, cells, key,
            wallsLen: walls.length, segsLen: segs.length, treesLen: trees.length,
            maxSegThick, maxTreeR,
        };
        this._collisionGridDirty = false;
    },

    /** 线性版 canMoveTo（_collisionAccel=false 时使用，与历史实现逐行一致） */
    _linearCanMoveTo(x, y, radius, ignore = null) {
        for (const w of this.walls) {
            if (ignore && ignore.rects && ignore.rects.has(w)) continue;
            if (this.circleRect(x, y, radius, w)) return false;
        }
        // iso 墙线段模型：点到线段距离 < 半径 + 半厚
        if (this.isoSegments) {
            for (const s of this.isoSegments) {
                if (ignore && ignore.segs && ignore.segs.has(s)) continue;
                if (!this._segmentAppliesToMove(s, ignore)) continue;
                if (this._groundPointSegDist(x, y, s) < radius + s.halfThick) return false;
            }
        }
        // 检查树木碰撞：使用独立的 collisionRadius（视觉半径的60%）
        for (const t of this.trees) {
            const dx = x - t.x, dy = y - t.y;
            const treeR = t.collisionRadius || t.radius * 0.6;
            if (Math.sqrt(dx * dx + dy * dy) < treeR + radius) return false;
        }
        return true;
    },

    /** 线性版 blocked（保留 ignore 语义） */
    _linearBlocked(x1, y1, x2, y2, ignore = null) {
        for (const w of this.walls) {
            if (ignore && ignore.rects && ignore.rects.has(w)) continue;
            if (this.lineRect(x1, y1, x2, y2, w)) return true;
        }
        // iso 墙线段：移动线与墙段相交
        if (this.isoSegments) {
            for (const s of this.isoSegments) {
                if (ignore && ignore.segs && ignore.segs.has(s)) continue;
                if (!this._segmentAppliesToMove(s, ignore)) continue;
                if (this._segSegIntersect(x1, y1, x2, y2, s.x1, s.y1, s.x2, s.y2)) return true;
            }
        }
        // 检查树木：使用独立的 collisionRadius（视觉半径的60%）
        for (const t of this.trees) if (this.lineCircle(x1, y1, x2, y2, t.x, t.y, t.collisionRadius || t.radius * 0.6)) return true;
        return false;
    },

    /** 线性版最近阻挡墙段 */
    _linearNearestBlockingSeg(nx, ny, r, ignore = null) {
        if (!this.isoSegments) return null;
        let best = null, bestD = Infinity;
        for (const s of this.isoSegments) {
            if (ignore && ignore.segs && ignore.segs.has(s)) continue;
            if (!this._segmentAppliesToMove(s, ignore)) continue;
            const d = this._groundPointSegDist(nx, ny, s);
            if (d < r + s.halfThick + 4 && d < bestD) {
                bestD = d;
                best = s;
            }
        }
        return best;
    },

    /**
     * ============================================================
     * 图层遮挡唯一规则（2026-07-31 合并定案）
     * ============================================================
     * 渲染机制：Phaser painter 算法（depth 小先画被盖，大后画遮挡）。
     * 唯一赋值规则：所有世界对象 depth = 地面锚线 y + 层级常量。
     * - 墙/门/填充/转角/预制件：锚线 = 底边线，depth = max(底边两端点 y) ——
     *   墙贴图全部在底边线之上，底边线以下（室内/墙前）的实体与墙无像素重叠，
     *   depth 比较天然不生效；只有墙后实体（脚线 y < 底边 y）才被遮挡。
     *   因此对前墙/后墙/转角全部成立（旧"后墙 min"规则已被废除）。
     * - 实体（玩家/怪物）：锚线 = 脚底 y（实体侧规则，不在本模块）。
     * - 障碍物：锚线 = 贴图底边中心 y（footprint 底边，与墙同尺度）。
     *
     * 本模块提供唯一入口 depthOf(piece, bias)——所有墙件生成路径
     * （编辑器/战斗房/宝箱房/通道预制/填充/封口）必须调用它，禁止各自赋值。
     */

    /** 墙件深度唯一入口：max(底边端点 y) + bias（无障碍线段时回退障碍物锚/中心 y） */
    depthOf(piece, bias = 0) {
        const segs = this._pieceBaseSegments(piece);
        let maxY = -Infinity;
        for (const [a, b] of segs) maxY = Math.max(maxY, a.y, b.y);
        if (maxY === -Infinity) {
            const g = this._geoForTex(piece.tex);
            if (g && g.category === 'obstacle') {
                maxY = this.obstacleDepthOf(piece);
            } else {
                maxY = piece.y;
            }
        }
        return maxY + bias;
    },

    /**
     * 地牢障碍物按建筑占地排序时使用的 footprint 前缘；缺少 footprint 时回退
     * obstacleDepthOf。调用方应把结果写入 depth 并标记 depthManual，避免影响墙编辑器
     * 与既有场景中明确手调的障碍物图层。
     */
    obstacleFootprintDepthOf(piece) {
        const foot = this.getObstacleFootprintRect(piece);
        if (foot) return foot.y + foot.h;
        return this.obstacleDepthOf(piece);
    },

    /**
     * 障碍物地面锚线 y（与实体脚底/墙底边同尺度的遮挡基准）：
     * 未旋转 = 贴图底边（y + 高×scaleY/2）；有旋转 = 旋转后包围盒最低点
     * （y + 半宽×|sin| + 半高×|cos|）——旋转道具的遮挡基准跟随实际占据区域。
     */
    obstacleDepthOf(piece) {
        const g = this._geoForTex(piece.tex);
        const hw = (g ? g.w : 0) * Math.abs(piece.scaleX ?? 1) / 2;
        const hh = (g ? g.h : 0) * Math.abs(piece.scaleY ?? piece.scaleX ?? 1) / 2;
        const rot = piece.rotation || 0;
        if (!rot) return piece.y + hh;
        return piece.y + hw * Math.abs(Math.sin(rot)) + hh * Math.abs(Math.cos(rot));
    },

    /** 运行时审计：扫描 isoVisuals 中 depth 与 depthOf 偏差 >1 的墙件（控制台调用 window.WallSystem.__depthAudit()）；
     *  豁免文档化偏置：转角 +5（_corner）、接缝 +0.1 */
    __depthAudit() {
        const bad = [];
        for (const p of this.isoVisuals) {
            if (p.depth == null) { bad.push({ tex: p.tex, reason: 'depth 缺失', x: Math.round(p.x), y: Math.round(p.y) }); continue; }
            // 障碍物允许手调 depth（图层排序/Q+E/火把贴墙），不参与统一规则审计
            const ga = this._geoForTex(p.tex);
            if (ga && ga.category === 'obstacle') continue;
            const want = this.depthOf(p);
            const delta = p.depth - want;
            const exempt = (p._corner && Math.abs(delta - 5) < 0.5) || Math.abs(delta - 0.1) < 0.05;
            if (!exempt && Math.abs(delta) > 1) {
                bad.push({ tex: p.tex, x: Math.round(p.x), y: Math.round(p.y), depth: Math.round(p.depth), want: Math.round(want) });
            }
        }
        console.log(`[DepthAudit] 共 ${this.isoVisuals.length} 件，违规 ${bad.length} 件（豁免：转角 +5 / 接缝 +0.1）`, bad);
        return bad;
    },
    /**
     * 合并墙体几何覆盖层（data/wall-geo-overrides.json）进 ISO_WALL_GEO。
     * 覆盖字段：face（墙端点）/ halfThick（碰撞半厚）/ foot（障碍物 footprint）/
     * gateX + states（门两状态门洞）。幂等（赋值式合并，重复调用无副作用）；
     * 合并后需调用方 rebuildIsoCollision() 重建碰撞生效。
     */
    applyGeoOverrides(ov) {
        if (!ov || typeof ov !== 'object') return;
        for (const [key, o] of Object.entries(ov)) {
            const g = ISO_WALL_GEO[key];
            if (!g || !o || typeof o !== 'object') continue;
            if (Array.isArray(o.face) && o.face.length === 2) {
                g.face = o.face.map(pt => [pt[0], pt[1]]);
            }
            if (typeof o.halfThick === 'number') g.halfThick = o.halfThick;
            if (o.foot && typeof o.foot === 'object') {
                g.foot = {
                    w: o.foot.w ?? (g.foot && g.foot.w),
                    d: o.foot.d ?? (g.foot && g.foot.d),
                    offsetX: o.foot.offsetX ?? (g.foot && g.foot.offsetX),
                    offsetY: o.foot.offsetY ?? (g.foot && g.foot.offsetY),
                };
            }
            if (Array.isArray(o.gateX) && o.gateX.length === 2) g.gateX = [o.gateX[0], o.gateX[1]];
            if (o.states && typeof o.states === 'object') {
                g.states = g.states || {};
                for (const st of ['open', 'closed']) {
                    const s = o.states[st];
                    if (!s) continue;
                    g.states[st] = { hole: Array.isArray(s.hole) ? [s.hole[0], s.hole[1]] : null };
                }
            }
        }
    },

    /** 加载并合并几何覆盖层（BootScene 预载 / 主神空间首启竞速兜底共用；合并后由调用方重建碰撞） */
    async loadGeoOverrides() {
        const ov = await loadWallGeoOverrides();
        this.applyGeoOverrides(ov);
        return ov;
    },

    /**
     * 将墙壁同步到 Phaser 的 staticGroup
     * 在 init() 和 addTree() 时调用
     */
    _syncWallsToPhaser() {
        const phaserScene = window.__phaserScene;
        if (!phaserScene) return;
        // 清除旧墙壁（如果存在）
        if (phaserScene.walls && phaserScene.walls.countActive(true) > 0) {
            phaserScene.walls.clear(true, true);
        }
        // 清除旧视觉墙壁
        if (phaserScene.visualWalls) {
            // 散布障碍物（世界-122 仙人掌 / 世界-123 雪松）的太阳投影不属于 visualWalls，
            // 视觉层重建前必须先注销，否则旧投影会脱离本体残留。
            for (const oldSprite of phaserScene.visualWalls.getChildren()) {
                const oldShadow = oldSprite.getData && oldSprite.getData('sunShadow');
                if (oldShadow && typeof phaserScene.unregisterStaticSunShadow === 'function') {
                    phaserScene.unregisterStaticSunShadow(oldShadow);
                }
            }
            phaserScene.visualWalls.clear(true, true);
        }
        for (const piece of this.isoVisuals || []) piece._sunShadow = null;
        // 创建矩形墙壁物理体 + 视觉精灵（noVisual 墙只建物理体，如静态 NPC 底座障碍）
        for (const w of this.walls) {
            const wall = phaserScene.add.rectangle(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, 0x000000, 0);
            phaserScene.physics.add.existing(wall, true); // true = static
            phaserScene.walls.add(wall);

            if (phaserScene.visualWalls && !w.noVisual) {
                this._createWallVisual(phaserScene, w);
            }
        }

        // 重新同步树木（包括视觉精灵）
        this._syncTreesToPhaser();
        // 等距斜墙视觉件（isoVisuals）
        this._renderIsoVisuals(phaserScene);
        // 设置碰撞关系
        phaserScene.setupColliders();
        this._phaserVisualsEnabled = true;
    },

    /**
     * 创建墙壁视觉精灵（水平墙用 wall.png，垂直墙用 wall-2.png）
     * 水平墙：显示完整墙面，Sprite 拉伸覆盖；垂直墙：只看顶部砖块
     * 贴图放大一倍（visualH ×2）；水平/垂直拼接处无缝；尽头半圆角，拼接处不处理
     * 图层：depth = 底部 Y 坐标（与地面相交处遮挡截断）
     */
    _createWallVisual(phaserScene, w) {
        // 根据宽高比判断方向：w > h 为水平墙，否则为垂直墙
        const isHorizontal = w.w >= w.h;
        const textureKey = isHorizontal ? 'wall_horizontal' : 'wall_vertical';
        if (!phaserScene.textures.exists(textureKey)) {
            // 回退到旧的程序化纹理
            const face = phaserScene.add.sprite(w.x + w.w / 2, w.y + w.h, 'wall_face');
            face.setOrigin(0.5, 1);
            face.setDisplaySize(w.w, w.height || 60);
            face.setDepth(w.y + w.h);
            phaserScene.visualWalls.add(face);
            w.visualSprite = face;
            return;
        }

        const t = isHorizontal ? w.h : w.w; // 墙厚
        const halfT = t / 2;

        // 检测两端是否有相邻墙壁（拼接），有则不收圆角并向外延伸半厚消除缝隙
        let leftConnected = false, rightConnected = false, topConnected = false, bottomConnected = false;
        if (isHorizontal) {
            leftConnected = this._hasAdjacentWall(w.x - halfT, w.y + halfT, w.x, w.y + halfT, w);
            rightConnected = this._hasAdjacentWall(w.x + w.w, w.y + halfT, w.x + w.w + halfT, w.y + halfT, w);
        } else {
            topConnected = this._hasAdjacentWall(w.x + halfT, w.y - halfT, w.x + halfT, w.y, w);
            bottomConnected = this._hasAdjacentWall(w.x + halfT, w.y + w.h, w.x + halfT, w.y + w.h + halfT, w);
        }

        if (isHorizontal) {
            // 水平墙：贴图放大 3 倍（visualH ×3），左右拼接处延伸半厚
            // 使用 canvas 裁剪后的贴图（wall_horizontal_cropped），去除透明区域让墙面直接接地
            const visualH = (w.height || 60) * 3;
            const extL = leftConnected ? halfT : 0;
            const extR = rightConnected ? halfT : 0;
            const sx = w.x - extL;
            const sw = w.w + extL + extR;
            const croppedKey = phaserScene.textures.exists('wall_horizontal_cropped') ? 'wall_horizontal_cropped' : textureKey;
            const sprite = phaserScene.add.sprite(
                sx + sw / 2,
                w.y + w.h - visualH / 2,
                croppedKey
            );
            sprite.setDisplaySize(sw, visualH);
            sprite.setDepth(w.y + w.h);
            phaserScene.visualWalls.add(sprite);
            w.visualSprite = sprite;

            // 尽头半圆角（只在未拼接的端点）
            if (!leftConnected) this._drawWallCap(phaserScene, w.x, w.y + w.h, halfT, 'left');
            if (!rightConnected) this._drawWallCap(phaserScene, w.x + w.w, w.y + w.h, halfT, 'right');
        } else {
            // 垂直墙：贴图放大 3 倍（w.w ×3 显示宽度），上下拼接处延伸半厚
            // 使用 canvas 裁剪后的贴图（wall_vertical_cropped），去除两侧透明区域让砖块列直接占满
            const visualW = w.w * 3;
            const extT = topConnected ? halfT : 0;
            const extB = bottomConnected ? halfT : 0;
            const sy = w.y - extT;
            const sh = w.h + extT + extB;
            const croppedKey = phaserScene.textures.exists('wall_vertical_cropped') ? 'wall_vertical_cropped' : textureKey;
            const sprite = phaserScene.add.sprite(
                w.x + w.w / 2,
                sy + sh / 2,
                croppedKey
            );
            sprite.setDisplaySize(visualW, sh);
            // 透视规则：与水平墙相交时，垂直墙在上方相交点之上（盖住水平墙），在下方相交点之下（被水平墙盖住）
            // 上方相交（topConnected）：depth = 水平墙 depth + 1（垂直在上）
            // 下方相交（bottomConnected）：depth = 水平墙 depth - 1（水平在上）
            let depth = w.y + w.h;
            if (topConnected) {
                const hWall = this._findAdjacentHorizontalWall(w.x + halfT, w.y - halfT, w.x + halfT, w.y, w);
                if (hWall) depth = hWall.y + hWall.h + 1;
            } else if (bottomConnected) {
                const hWall = this._findAdjacentHorizontalWall(w.x + halfT, w.y + w.h, w.x + halfT, w.y + w.h + halfT, w);
                if (hWall) depth = hWall.y + hWall.h - 1;
            }
            sprite.setDepth(depth);
            phaserScene.visualWalls.add(sprite);
            w.visualSprite = sprite;

            // 尽头半圆角（只在未拼接的端点）
            if (!topConnected) this._drawWallCap(phaserScene, w.x + w.w / 2, w.y, halfT, 'top');
            if (!bottomConnected) this._drawWallCap(phaserScene, w.x + w.w / 2, w.y + w.h, halfT, 'bottom');
        }
    },

    // ===== 等距斜墙：通用件模型 =====
    // 通用件: { tex, x, y, scaleX, scaleY, flipX, flipY, depth }（origin 固定 0.5,0.5）
    // 视觉件存 isoVisuals；碰撞由 rebuildIsoCollision() 按件底边线段自动生成阶梯矩形（_iso 标记）
    // 墙壁编辑器（wall-editor.js）直接编辑通用件，保存为预制组合（data/wall-prefabs.json）

    /**
     * 生成菱形（等距 2:1）房间的默认布局（通用件；无预制时作为兜底）
     * 四角转角贴图 + 四边直墙瓦片（覆盖式拼接）；出入口在右下边
     */
    buildDiamondRoom(cx, cy, rx, ry, opts = {}) {
        const doorEdge = opts.doorEdge || 'RB';
        const doorW = opts.doorWidth ?? 100;
        const height = opts.height ?? ISO_WALL_HEIGHT;
        const T = { x: cx, y: cy - ry }, R = { x: cx + rx, y: cy }, B = { x: cx, y: cy + ry }, L = { x: cx - rx, y: cy };
        // 四角转角（depth 偏置在 _addCornerPiece 按 下>左>右>上 规则）
        this._addCornerPiece('top', T, height);
        this._addCornerPiece('right', R, height);
        this._addCornerPiece('left', L, height);
        this._addCornerPiece('bottom', B, height);
        // 四边：直墙瓦片（臂尖之间 + 向转角臂内侵入 OVERLAP）
        this._buildIsoEdge(T, L, 'top', 'tipL', 'left', 'tipUpper', true, 0, height);
        this._buildIsoEdge(T, R, 'top', 'tipR', 'right', 'tipUpper', false, 0, height);
        this._buildIsoEdge(L, B, 'left', 'tipLower', 'bottom', 'tipL', false, 0, height);
        this._buildIsoEdge(R, B, 'right', 'tipLower', 'bottom', 'tipR', true, doorEdge === 'RB' ? doorW : 0, height);
    },

    /** 单条菱形边：Va->Vb（Va 为上端/右端顶点），cornerA/cornerB 为两端转角，flip 为 "/" 方向边 */
    _buildIsoEdge(Va, Vb, cornerA, tipA, cornerB, tipB, flip, doorW, height) {
        // 瓦片跨度：两端转角臂尖之间，各向转角臂内收回 OVERLAP（覆盖式拼接）
        const pa = this._cornerTipWorld(cornerA, Va, tipA, height);
        const pb = this._cornerTipWorld(cornerB, Vb, tipB, height);
        const P = this._shrinkPoint(pa, Va, ISO_TILE_OVERLAP);
        const Q = this._shrinkPoint(pb, Vb, ISO_TILE_OVERLAP);
        const dx = Q.x - P.x, dy = Q.y - P.y;
        const segLen = Math.hypot(dx, dy);
        if (segLen < 20) return;
        const g = ISO_WALL_GEO.diag;
        const texLen = Math.hypot(g.base[1][0] - g.base[0][0], g.base[1][1] - g.base[0][1]);
        const tileLen = texLen * (height / g.wallH);
        const n = Math.max(1, Math.round(segLen / tileLen));
        const step = segLen / n;
        const ux = dx / segLen, uy = dy / segLen;
        // 门中心换算到瓦片跨度局部坐标：整条边中点弧长 − 跨度起点的弧长位置
        const fullLen = Math.hypot(Vb.x - Va.x, Vb.y - Va.y);
        const dP = Math.hypot(P.x - Va.x, P.y - Va.y);
        const doorAt = fullLen / 2 - dP;
        for (let i = 0; i < n; i++) {
            const a = i * step, b = (i + 1) * step;
            // 与门洞区间求差，保留可见子段（门洞恰好 doorW 宽，不吞整瓦）
            const parts = doorW
                ? [[a, Math.min(b, doorAt - doorW / 2)], [Math.max(a, doorAt + doorW / 2), b]]
                : [[a, b]];
            for (const [sa, sb] of parts) {
                if (sb - sa < 5) continue;
                this._addSegPiece(
                    { x: P.x + ux * sa, y: P.y + uy * sa },
                    { x: P.x + ux * sb, y: P.y + uy * sb },
                    flip
                );
            }
        }
    },

    /** 直墙瓦片通用件：正面墙底边(face)映射到世界线段 A->B（独立 sx/sy 精确贴合），flip 为 "/" 方向 */
    _addSegPiece(A, B, flip, geoKey = 'diag', depthMode = 'max', depthBias = 0) {
        const piece = this._buildSegPiece(A, B, flip, geoKey, depthMode, depthBias);
        this.isoVisuals.push(piece);
        return piece;
    },

    /** 纯构建：由底边线段生成直墙件（不推入 isoVisuals；2026-08-11 供通道镜像重建复用） */
    _buildSegPiece(A, B, flip, geoKey = 'diag', depthMode = 'max', depthBias = 0) {
        const g = ISO_WALL_GEO[geoKey] || ISO_WALL_GEO.diag;
        const [p0, p1] = g.face || g.base;
        let sx, sy, x0, y0;
        if (!flip) {
            sx = (B.x - A.x) / (p1[0] - p0[0]);
            sy = (B.y - A.y) / (p1[1] - p0[1]);
            x0 = A.x - p0[0] * sx;
            y0 = A.y - p0[1] * sy;
        } else {
            // flip（"/" 方向）：flipX 为 quad 内镜像，贴图点 p 落在 x0 + (w-p.x)*sx
            // 目标：p0(贴图左端) -> A（上端），p1(贴图右端) -> B（下端）
            sx = (A.x - B.x) / (p1[0] - p0[0]);
            sy = (B.y - A.y) / (p1[1] - p0[1]);
            x0 = A.x - (g.w - p0[0]) * sx;
            y0 = A.y - p0[1] * sy;
        }
        // 深度规则：后墙(室内朝镜头)取 min 底边 y 让室内实体永远在前；前墙取 max 正确遮挡
        const depth = (depthMode === 'min' ? Math.min(A.y, B.y) : Math.max(A.y, B.y)) + depthBias;
        return {
            tex: g.tex,
            x: x0 + g.w * Math.abs(sx) / 2,
            y: y0 + g.h * sy / 2,
            scaleX: Math.abs(sx), scaleY: sy,
            flipX: !!flip, flipY: false,
            depth,
        };
    },

    /**
     * 运行时菱形墙构建（僵尸地牢战斗房/Boss 场地）：四顶点转角点对点 + 四边续接
     * 深度规则：上顶点两臂后墙 min、下顶点两臂前墙 max、左/右顶点上臂 min 下臂 max
     * 只写 isoVisuals；调用方随后 rebuildIsoCollision() 生成阶梯碰撞
     */
    buildIsoDiamondWalls(cx, cy, rx, ry, opts = {}) {
        const height = opts.height ?? ISO_WALL_HEIGHT;
        const geoKey = opts.geoKey || this.getWallStyleGeos().straight;
        const g = ISO_WALL_GEO[geoKey] || ISO_WALL_GEO.straight;
        const s = height / g.wallH;
        const sy = s * slopeFixOf(g);
        const faceDx = (g.face[1][0] - g.face[0][0]) * s;
        const faceDy = (g.face[1][1] - g.face[0][1]) * sy;
        const faceLen = Math.hypot(faceDx, faceDy);
        const T = { x: cx, y: cy - ry }, R = { x: cx + rx, y: cy }, B = { x: cx, y: cy + ry }, L = { x: cx - rx, y: cy };

        // 放一件：face 起点(上端)在 S，向下延伸；返回远端点
        const startAt = (S, flip, mode, bias = 0) => {
            const A = { x: S.x, y: S.y };
            const B = flip ? { x: S.x - faceDx, y: S.y + faceDy } : { x: S.x + faceDx, y: S.y + faceDy };
            this._addSegPiece(A, B, flip, geoKey, mode, bias);
            return B;
        };
        // 放一件：face 终点(下端)在 E，向上延伸；返回远端点
        const endAt = (E, flip, mode, bias = 0) => {
            const B = { x: E.x, y: E.y };
            const A = flip ? { x: E.x + faceDx, y: E.y - faceDy } : { x: E.x - faceDx, y: E.y - faceDy };
            this._addSegPiece(A, B, flip, geoKey, mode, bias);
            return A;
        };
        // 臂远端之间续接（定长定高瓦片：scale 固定，8px 叠合，绝不拉伸——
        // 均匀拉伸件与转角件并排会一大一小、中间突出（僵尸砖纹不可感知，沼泽柴墙材质随机格外显眼）；
        // 尾端超出 Q 的部分由下一顶点的转角臂（+5 偏置）盖住，只叠不缺）
        const edgeFill = (P, Q, flip, mode) => {
            const dx = Q.x - P.x, dy = Q.y - P.y;
            const len = Math.hypot(dx, dy);
            if (len < 4) return;
            const ux = dx / len, uy = dy / len;
            const step = faceLen - 8; // 步进 = 瓦长 - 叠合量
            const n = Math.max(1, Math.ceil((len + 8) / step));
            for (let i = 0; i < n; i++) {
                const A = { x: P.x + ux * (step * i - 8), y: P.y + uy * (step * i - 8) };
                const B = { x: A.x + ux * faceLen, y: A.y + uy * faceLen };
                this._addSegPiece(A, B, flip, geoKey, mode);
            }
        };

        // 四角（点对点）：全场统一 max（底边最深端）——
        // 墙体贴图全部在底边线之上，底边线以下（室内/墙前）的实体与墙无像素重叠，
        // depth 比较天然不生效；只有墙后实体（脚线 y < 底边 y）才被遮挡。
        // max 规则对前墙/后墙/转角全部成立（旧"后墙 min"规则让后墙永远挡不住人，
        // 通道/宝箱房"门墙遮不住实体"的根因）。
        // 转角臂 +5 深度偏置：顶点侧盖住续接件（预制转角文档化同款规则）——
        // 纹理随机的墙（沼泽柴墙）若让续接件盖住转角臂，贴图切边会暴露在接缝上；
        // +5 为文档化安全值（不得加大：更大偏置会误挡顶点下方高个实体，+260 教训）
        const CB = 5;
        // 样式登记了夹角预制则四角用预制构建（手摆件）；缺失/无效逐个回退程序化转角臂。
        // 一间房随机只保留一个带门夹角，其余角的门件改铺直墙
        const styleCorners = (this.getWallStyle ? this.getWallStyle() : {}).corners || null;
        const gateCorner = ['top', 'bottom', 'left', 'right'][Math.floor(Math.random() * 4)];
        const cT = styleCorners && styleCorners.top ? this._placeCornerPrefab(styleCorners.top, T, CB, 'x', 'top', gateCorner === 'top') : null;
        const cB = styleCorners && styleCorners.bottom ? this._placeCornerPrefab(styleCorners.bottom, B, CB, 'x', 'bottom', gateCorner === 'bottom') : null;
        const cL = styleCorners && styleCorners.left ? this._placeCornerPrefab(styleCorners.left, L, CB, 'y', 'left', gateCorner === 'left') : null;
        const cR = styleCorners && styleCorners.right ? this._placeCornerPrefab(styleCorners.right, R, CB, 'y', 'right', gateCorner === 'right') : null;
        const tL = cT ? cT.neg : startAt(T, true, 'max', CB);   // 上顶点左臂（向 down-left）
        const tR = cT ? cT.pos : startAt(T, false, 'max', CB);  // 上顶点右臂（向 down-right）
        const bL = cB ? cB.neg : endAt(B, false, 'max', CB);    // 下顶点左臂（从 up-left 来）
        const bR = cB ? cB.pos : endAt(B, true, 'max', CB);     // 下顶点右臂（从 up-right 来）
        const lU = cL ? cL.neg : endAt(L, true, 'max', CB);     // 左顶点上臂（从 up-right 来）
        const lD = cL ? cL.pos : startAt(L, false, 'max', CB);  // 左顶点下臂（向 down-right）
        const rU = cR ? cR.neg : endAt(R, false, 'max', CB);    // 右顶点上臂（从 up-left 来）
        const rD = cR ? cR.pos : startAt(R, true, 'max', CB);   // 右顶点下臂（向 down-left）

        // 四边续接（全场统一 max 规则）
        edgeFill(tL, lU, true, 'max');   // T-L 边
        edgeFill(tR, rU, false, 'max');  // T-R 边
        edgeFill(lD, bL, false, 'max');  // L-B 边
        edgeFill(rD, bR, true, 'max');   // R-B 边
    },

    /**
     * 预制夹角放置（样式 corners 登记时由 buildIsoDiamondWalls 调用）：
     * 找跨件共享端点=顶点，整体平移到菱形顶点（深度同步平移+偏置，保留预制内部图层关系）。
     * @param {string} axis 'x'（上/下顶点，臂分左右）| 'y'（左/右顶点，臂分上下）
     * @param {string} cornerKind 'top'|'bottom'|'left'|'right'（门件改铺直墙时的深度规则用）
     * @param {boolean} allowGate 本夹角是否保留门件（一间房只留一个带门夹角，其余门件改铺直墙）
     * @returns {{neg:{x,y}, pos:{x,y}}|null} 两臂最远端（边续接锚点）；预制缺失/顶点找不到/臂不全返回 null（调用方回退程序化转角）
     */
    _placeCornerPrefab(prefabName, V, depthBias, axis, cornerKind, allowGate = true) {
        const lib = getWallPrefabLibrary ? getWallPrefabLibrary() : null;
        const prefab = lib && lib[prefabName];
        if (!prefab || !Array.isArray(prefab.pieces) || prefab.pieces.length < 2) return null;
        const segs = prefab.pieces.map(p => this._pieceBaseSegments(p)[0]);
        if (segs.some(s => !s)) return null;
        // 顶点：跨件共享端点（≤30px 聚类），取离预制组中心最近的
        const pts = [];
        segs.forEach((s, i) => { pts.push({ p: s[0], i }, { p: s[1], i }); });
        let vertex = null, bestD = Infinity;
        for (let a = 0; a < pts.length; a++) {
            for (let b = a + 1; b < pts.length; b++) {
                if (pts[a].i === pts[b].i) continue;
                const d = Math.hypot(pts[a].p.x - pts[b].p.x, pts[a].p.y - pts[b].p.y);
                if (d > 30) continue;
                const mx = (pts[a].p.x + pts[b].p.x) / 2, my = (pts[a].p.y + pts[b].p.y) / 2;
                const dc = Math.hypot(mx - (prefab.cx || mx), my - (prefab.cy || my));
                if (dc < bestD) { bestD = dc; vertex = { x: mx, y: my }; }
            }
        }
        if (!vertex) return null;
        const ox = V.x - vertex.x, oy = V.y - vertex.y;
        // 两臂最远端：按 axis 分 neg/pos 两侧，每侧取离顶点最远的端点
        let neg = null, pos = null;
        segs.forEach((s) => {
            for (const pt of s) {
                // 近顶点端点跳过（是接合点）
                if (Math.hypot(pt.x - vertex.x, pt.y - vertex.y) < 40) continue;
                const t = { x: pt.x + ox, y: pt.y + oy };
                const d = axis === 'x' ? pt.x - vertex.x : pt.y - vertex.y;
                const dist = Math.hypot(pt.x - vertex.x, pt.y - vertex.y);
                if (d < 0) { if (!neg || dist > neg._d) neg = { ...t, _d: dist }; }
                else { if (!pos || dist > pos._d) pos = { ...t, _d: dist }; }
            }
        });
        if (!neg || !pos) return null;
        // 校验通过才放置。深度按房间规则重算（与程序化转角一致的 min/max + 偏置）——
        // 编辑器的绝对深度只用于保留预制内部相对顺序（0.1/级）；
        // 直接平移编辑器深度会导致前墙件深度低于实体（下夹角实体画在墙上的根因）
        const styleGeos = this.getWallStyleGeos ? this.getWallStyleGeos() : { straight: 'straight', gate: 'gate' };
        const styleGateTex = (ISO_WALL_GEO[styleGeos.gate] || ISO_WALL_GEO.gate).tex;
        const ordered = prefab.pieces.map((p, i) => ({ i, d: p.depth ?? p.y })).sort((m, n) => m.d - n.d);
        const orderEps = new Map(ordered.map((m, rank) => [m.i, rank * 0.1]));
        const modeOf = (_A, _B) => 'max'; // 全场统一 max 规则（见 buildIsoDiamondWalls 注释）
        prefab.pieces.forEach((p, i) => {
            const seg = segs[i];
            const A = { x: seg[0].x + ox, y: seg[0].y + oy };
            const B = { x: seg[1].x + ox, y: seg[1].y + oy };
            const mode = modeOf(A, B);
            const ruleDepth = (mode === 'min' ? Math.min(A.y, B.y) : Math.max(A.y, B.y)) + depthBias;
            if (!allowGate && p.tex === styleGateTex) {
                // 一间房只保留一个带门夹角：其余角的门件改铺直墙（同线段映射 + 转角深度规则）
                this._addSegPiece(A, B, !!p.flipX, styleGeos.straight, mode, depthBias);
                this.isoVisuals[this.isoVisuals.length - 1]._corner = true;
                return;
            }
            const q = { ...p, x: p.x + ox, y: p.y + oy, depth: ruleDepth + orderEps.get(i), _corner: true };
            delete q._sprite;
            this.isoVisuals.push(q);
        });
        return { neg: { x: neg.x, y: neg.y }, pos: { x: pos.x, y: pos.y } };
    },

    /** 转角通用件：接合点锚定到顶点，等比缩放到目标墙高；depth = 顶点 y + 顺序偏置（下>左>右>上） */
    _addCornerPiece(corner, V, height) {
        const g = ISO_WALL_GEO[corner];
        const s = height / g.wallH;
        this.isoVisuals.push({
            tex: g.tex,
            x: V.x - g.vertex[0] * s + g.w * s / 2,
            y: V.y - g.vertex[1] * s + g.h * s / 2,
            scaleX: s, scaleY: s,
            flipX: false, flipY: false,
            depth: V.y + 5 + (ISO_CORNER_DEPTH_BIAS[corner] || 0),
        });
    },

    /** 转角臂尖的世界坐标（顶点 + 贴图偏移 × 高度缩放） */
    _cornerTipWorld(corner, V, tipKey, height) {
        const g = ISO_WALL_GEO[corner];
        const s = height / g.wallH;
        const t = g[tipKey];
        return { x: V.x + (t[0] - g.vertex[0]) * s, y: V.y + (t[1] - g.vertex[1]) * s };
    },

    /** 把点 P 向顶点 V 方向收回 amt */
    _shrinkPoint(P, V, amt) {
        const dx = P.x - V.x, dy = P.y - V.y;
        const d = Math.hypot(dx, dy);
        if (!d) return { x: P.x, y: P.y };
        return { x: P.x - dx / d * amt, y: P.y - dy / d * amt };
    },

    /** 渲染 isoVisuals 全部通用件到 visualWalls 组（回写 p._sprite 供编辑器引用） */
    _renderIsoVisuals(phaserScene) {
        if (!this.isoVisuals || !phaserScene.visualWalls) return;
        for (const p of this.isoVisuals) this._placeIsoPiece(phaserScene, p);
    },

    /** 通用件渲染：origin 0.5,0.5 + scale/flip/rotation/depth 直接应用 */
    _placeIsoPiece(phaserScene, p) {
        if (!phaserScene.textures.exists(p.tex)) return;
        const sp = phaserScene.add.sprite(p.x, p.y, p.tex);
        sp.setOrigin(0.5, 0.5);
        sp.setScale(p.scaleX ?? 1, p.scaleY ?? p.scaleX ?? 1);
        sp.setFlipX(!!p.flipX);
        sp.setFlipY(!!p.flipY);
        if (p.rotation) sp.setRotation(p.rotation);
        // 障碍物 depth：优先手调值（图层面板/Q+E/火把贴墙，p.depthManual 标记），
        // 否则锚地面线（未旋转=贴图底边；旋转=包围盒最低点，obstacleDepthOf）
        const g = this._geoForTex(p.tex);
        const obstacleDepth = this.obstacleDepthOf(p);
        const depth = (g && g.category === 'obstacle')
            ? (p.depthManual ? (p.depth ?? obstacleDepth) : obstacleDepth)
            : (p.depth ?? p.y);
        sp.setDepth(depth);
        phaserScene.visualWalls.add(sp);
        p._sprite = sp;
        // 世界散布障碍物（仙人掌/雪松）走真实 obstacle footprint 注册太阳投影。
        // 只处理 _scatter：地牢内的摆放障碍仍保持原有接触阴影，不引入室外日照投影。
        if (p._scatter && g && g.category === 'obstacle' && g.foot
            && typeof phaserScene.registerStaticSunShadow === 'function') {
            const foot = this.getObstacleFootprintRect(p);
            if (foot) {
                const sx = Math.abs(p.scaleX ?? 1);
                const sy = Math.abs(p.scaleY ?? p.scaleX ?? 1);
                const visualHeight = g.h * sy;
                const shadowCfg = g.shadow || {};
                const shadowHeight = visualHeight * (shadowCfg.heightMul ?? 1);
                const shadowWidth = foot.w * (shadowCfg.visualWidthMul ?? 1);
                const shadowDepth = foot.h * (shadowCfg.visualDepthMul ?? 1);
                const maxOffset = shadowCfg.maxOffset
                    ?? Math.min(72, Math.max(28, visualHeight * 0.30));
                // 贴图实测底座质心：轮廓形变横向对齐真源（与建筑同口径）。
                const lightMeta = lightingAssets.assets?.[p.tex] || null;
                const lightBBox = lightMeta?.alphaBBox || null;
                const srcW = Math.max(1, lightMeta?.size?.width || g.w || 1);
                const worldPerPx = (g.w * sx) / srcW;
                const bboxCenterX = lightBBox ? (lightBBox.x0 + lightBBox.x1) * 0.5 : 0;
                const baseCenterX = Number(lightMeta?.base?.centerX) || bboxCenterX;
                const cx = foot.x + foot.w * 0.5;
                const cy = foot.y + foot.h * 0.5;
                // 2026-08-19 唯一性审计：投影贴图运行时已不加载，textures.exists 门永假
                // 导致 projection 型障碍物（仙人掌/雪松）静默退化成胶囊椭圆——
                // 改以 manifest 剪影为唯一真源门（有 shadowSilhouette 列即走 hull+剪影）。
                const useProjection = shadowCfg.kind === 'projection'
                    && !!(lightMeta?.shadowSilhouette?.columns?.length >= 3);
                if (useProjection) {
                    // 障碍物与建筑同一管线：geo foot 手调碰撞四边形作实体凸包接地
                    // （球体/异形不适用平底截断法）+ manifest 剪影片贡献轮廓。
                    // 阴影视觉底座可大于碰撞 footprint；纵深按 2:1（0.5）压扁，才能与实际占地视觉一致。
                    const hw = shadowWidth * 0.5;
                    const hh = (shadowDepth * PERSPECTIVE_SCALE_Y) * 0.5;
                    p._sunShadow = phaserScene.registerStaticSunShadow({
                        hull: true,
                        x: cx,
                        y: cy,
                        footprintVertices: [
                            { x: cx - hw, y: cy - hh },
                            { x: cx + hw, y: cy - hh },
                            { x: cx + hw, y: cy + hh },
                            { x: cx - hw, y: cy + hh },
                        ],
                        height: shadowHeight,
                        maxOffset,
                        opacity: shadowCfg.opacity,
                        depth: depth - 0.1,
                        sourceSprite: sp,
                        flipX: !!p.flipX,
                        projectionCrossOffset: lightBBox
                            ? (baseCenterX - bboxCenterX) * worldPerPx * (p.flipX ? -1 : 1)
                            : 0,
                    });
                } else {
                    // contact 型（桶状仙人掌等）：柔边椭圆接触影。
                    p._sunShadow = phaserScene.registerStaticSunShadow({
                        x: cx,
                        y: cy,
                        footprintWidth: shadowWidth,
                        footprintHeight: shadowDepth * PERSPECTIVE_SCALE_Y,
                        height: shadowHeight,
                        maxOffset,
                        opacity: shadowCfg.opacity,
                        depth: depth - 0.1,
                        flipX: !!p.flipX,
                        flipY: !!p.flipY,
                    });
                }
                sp.setData('sunShadow', p._sunShadow);
            }
        }
    },

    /** 贴图键 → 几何配置 */
    _geoForTex(tex) {
        for (const k of Object.keys(ISO_WALL_GEO)) {
            if (ISO_WALL_GEO[k].tex === tex) return ISO_WALL_GEO[k];
        }
        return null;
    },

    /**
     * 当前渲染帧的动态建筑遮挡候选。玩家、敌人、友军和平民共用同一份结构数组，
     * 避免每个移动对象都重新扫描包含大量非建筑单位的 Game.entities。
     */
    collectDynamicStructureDepthEntities(entities = null) {
        const entityStore = entities?.values
            ? entities
            : ((typeof window !== 'undefined') ? window.Game?.entities : null);
        const frame = (typeof window !== 'undefined')
            ? Number(window.__phaserScene?.game?.loop?.frame)
            : NaN;
        const entityCount = Number(entityStore?.size);
        if (entityStore && Number.isFinite(frame)
            && this._dynamicStructureDepthFrameCache?.entityStore === entityStore
            && this._dynamicStructureDepthFrameCache.frame === frame
            && this._dynamicStructureDepthFrameCache.entityCount === entityCount) {
            return this._dynamicStructureDepthFrameCache.structures;
        }
        const source = entityStore?.values ? entityStore.values() : (entities || []);
        const structures = [];
        for (const entity of source || []) {
            if (!entity?.active || entity._isCoverGate) continue;
            const hasDepthGeometry = entity._structureDepthMode
                || (Array.isArray(entity._faceLines) && entity._faceLines.length)
                || (Array.isArray(entity._faceLine) && entity._faceLine.length === 2);
            if (hasDepthGeometry) structures.push(entity);
        }
        if (entityStore && Number.isFinite(frame)) {
            this._dynamicStructureDepthFrameCache = { entityStore, entityCount, frame, structures };
        }
        return structures;
    },

    /** 普通格网建筑走二维视觉粗筛 + u/v 地面拓扑；墙/门继续走下方线段仲裁。 */
    resolveDynamicEntityDepth(
        x,
        y,
        depth,
        frontRange = 60,
        sideRange = 0,
        visualBounds = null,
        structureCandidates = null
    ) {
        const structures = structureCandidates || this.collectDynamicStructureDepthEntities();
        const fallbackBounds = {
            minX: x - Math.max(0, Number(sideRange) || 0),
            maxX: x + Math.max(0, Number(sideRange) || 0),
            minY: y - Math.max(0, Number(frontRange) || 0),
            maxY: y,
        };
        const entityVisualBounds = visualBounds || fallbackBounds;
        const nearbyStructures = this._structureDepthCandidatesInBounds(
            structures,
            entityVisualBounds
        );
        const structureResolved = resolveDynamicStructureDepth(
            x,
            y,
            depth,
            entityVisualBounds,
            nearbyStructures
        );
        return this.junctionCorrectedDepth(
            x,
            y,
            structureResolved,
            frontRange,
            sideRange,
            structures
        );
    },

    /**
     * 实体级墙/门/掩体线段遮挡仲裁：
     * 对实体脚线 (x, y)，收集墙/门面线分两侧判定：线后窗口 = 60 + 深度亏空；线前窗口 = frontRange（实体贴图脚底→头顶高度，默认 60）——
     * y < yLine（实体在线后）记为遮挡源，y ≥ yLine（在线前）记为前墙。
     * 有遮挡源 → 压到最浅遮挡面线之下（min depth − 0.5，即压到所有遮挡线之下）；
     * 否则有前墙 → 抬到其之上（depth+0.5，修正长瓦浅端过遮挡；旧版窗口固定 60，实体在墙前 60~160px 贴图仍与墙重叠时不抬被盖——通道上墙/墓碑同根因）；
     * 多面线共存的门口/衔接处按"被任一墙遮挡则遮挡"判定——
     * 旧版只取最近一条面线，门洞深端会被错误放行（线上反馈）。
     * sideRange 必须传移动实体当前帧的真实 alpha 可见半宽，并以接地/碰撞半径兜底；
     * 禁止传整张 sprite.displayWidth/2（透明留白会制造假遮挡），也不能只传碰撞半径
     * （人物身体已与墙段相交时会漏掉仲裁）。普通格网建筑不得进入本方法。
     */
    junctionCorrectedDepth(
        x,
        y,
        depth,
        frontRange = 60,
        sideRange = 0,
        structureCandidates = null
    ) {
        this._getFaceSegCache();
        const faceCandidates = this._faceSegCandidatesAtX(x);
        let occluderDepth = Infinity, frontDepth = -Infinity;
        const collectRelation = (segDepth, inFront) => {
            if (inFront) {
                if (segDepth > frontDepth) frontDepth = segDepth;
            } else if (segDepth < occluderDepth) {
                occluderDepth = segDepth;
            }
        };
        const applySeg = (A, B, segDepth) => {
                const minX = Math.min(A.x, B.x) - 8, maxX = Math.max(A.x, B.x) + 8;
                if (x < minX || x > maxX) return;
                // 8px 是接缝横向容差，不代表面线可以无限外推；夹紧 t 后转角/门柱
                // 外侧不会采到虚构的延长线 Y，避免前后关系在端点附近翻转。
                const rawT = (x - A.x) / ((B.x - A.x) || 1e-6);
                const t = Math.max(0, Math.min(1, rawT));
                const yLine = A.y + (B.y - A.y) * t;
                // 门墙面线 depth = 门洞中心底边 y，比深端浅（亏空 = 深端 y − depth，可达 ~119px）：
                // 收集窗按亏空加宽，否则深端墙后 60~119px 的实体收不到任何面线、仲裁完全失效
                // （普通 max 规则瓦片亏空为 0，窗口不变、行为不变）
                const deficit = Math.max(A.y, B.y) - segDepth;
                const win = (y - yLine) < 0 ? (deficit > 0 ? 60 + deficit : 60) : frontRange; // 线后=60+亏空；线前=实体贴图高度
                if (Math.abs(y - yLine) > win) return;
                // 遮挡源取最浅（min）：实体必须压到所有遮挡面线之下才真正被遮挡。
                collectRelation(segDepth, y >= yLine);
        };
        for (const it of faceCandidates) {
            applySeg(it.A, it.B, it.depth);
        }
        // 掩体墙段（DefenseCover）：动态实体（可增删），不进面线缓存，逐帧现取。
        // 与墙件同一套仲裁：实体脚线在掩体底边线（face line）前 → 抬到掩体之上，
        // 在线后 → 压到掩体之下。2026-08-05 实机复现修复（墙前怪被盖）。
        const dynamicStructures = structureCandidates
            || this.collectDynamicStructureDepthEntities();
        const nearbyStructures = this._structureDepthCandidatesAtX(
            dynamicStructures, x, sideRange);
        for (const e of nearbyStructures) {
            if (!e?.active || e._isCoverGate) continue;
            if (e._structureDepthMode === 'iso_footprint') continue;
            const lines = Array.isArray(e._faceLines) && e._faceLines.length
                ? e._faceLines
                : (e._faceLine && e._faceLine.length === 2 ? [e._faceLine] : []);
            for (const line of lines) {
                const [A, B] = line || [];
                if (!A || !B || typeof A.x !== 'number' || typeof B.x !== 'number') continue;
                const renderDepth = Number.isFinite(e._structureRenderDepth)
                    ? e._structureRenderDepth
                    : (typeof e._faceDepth === 'number' ? e._faceDepth : e.y + 12);
                applySeg(A, B, renderDepth);
            }
        }
        // 铁栅栏门三段面线（左柱/栅栏/右柱，各自深度，2026-08-15）：
        // 右柱=浅端单独浅深度 → 其前实体不再被整门深深度误盖；栅栏随开关注册/移除。
        const segs = (typeof window !== 'undefined') ? (window.GateFaceSegs || null) : null;
        if (segs) {
            for (const s of segs) {
                if (!s || !s.A || !s.B) continue;
                applySeg(s.A, s.B, s.depth);
            }
        }
        // 遮挡源只在比所有前墙都深时才压制：浅遮挡源的贴图本身画在深前墙之下，
        // 实体在深前墙之前不可能被它真正遮挡（门口 X 形楔形区误压修复）
        if (occluderDepth !== Infinity && occluderDepth >= frontDepth) return Math.min(depth, occluderDepth - 0.5);
        if (frontDepth !== -Infinity) return Math.max(depth, frontDepth + 0.5);
        if (occluderDepth !== Infinity) return Math.min(depth, occluderDepth - 0.5); // 无前墙时遮挡源兜底
        return depth;
    },

    /** 衔接仲裁用的 face 世界线段缓存（非障碍物件 + 门墙实例；几何变更时由 rebuildIsoCollision 失效） */
    _getFaceSegCache() {
        if (this._faceSegCache) return this._faceSegCache;
        const out = [];
        for (const p of this.isoVisuals || []) {
            const g = this._geoForTex(p.tex);
            if (g && g.category === 'obstacle') continue;
            const segs = this._pieceBaseSegments(p);
            if (!segs.length) continue;
            out.push({ segs, depth: p.depth !== undefined ? p.depth : p.y });
        }
        // 门墙实例：竞技场入场门/通道门（arena）、出口门（WallGate）、宝箱房门
        const CRS = (typeof window !== 'undefined') ? window.CombatRoomSystem : null;
        if (CRS && CRS._arena) {
            const gates = [...CRS._arena.passages.flatMap(r => r.gates)];
            if (CRS._arena.entryGate) gates.push(CRS._arena.entryGate);
            for (const g of gates) {
                if (!g || !g.sprite) continue;
                if (Array.isArray(g.depthSegments) && g.depthSegments.length) {
                    for (const segment of g.depthSegments) {
                        out.push({ segs: [[segment.A, segment.B]], depth: segment.depth });
                    }
                } else {
                    out.push({ segs: [[g.baseA, g.baseB]], depth: g.sprite.depth });
                }
            }
        }
        const WG = (typeof window !== 'undefined') ? window.WallGate : null;
        if (WG && WG._seg && WG.sprite && WG.state !== 'open') {
            if (Array.isArray(WG.depthSegments) && WG.depthSegments.length) {
                for (const segment of WG.depthSegments) {
                    out.push({ segs: [[segment.A, segment.B]], depth: segment.depth });
                }
            } else {
                out.push({ segs: [WG._seg], depth: WG.sprite.depth });
            }
        }
        const CH = (typeof window !== 'undefined') ? window.ChestRoomSystem : null;
        if (CH && CH._gate && CH._gate.sprite && CH._gate.segs && !CH._gate.open) {
            if (Array.isArray(CH._gate.depthSegments) && CH._gate.depthSegments.length) {
                for (const segment of CH._gate.depthSegments) {
                    out.push({ segs: [[segment.A, segment.B]], depth: segment.depth });
                }
            } else {
                out.push({ segs: CH._gate.segs.map(s => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]), depth: CH._gate.sprite.depth });
            }
        }
        this._faceSegCache = out;
        const columns = new Map();
        const cellSize = 256;
        for (const it of out) {
            for (const [A, B] of it.segs) {
                if (!A || !B) continue;
                const entry = { A, B, depth: it.depth };
                const minColumn = Math.floor((Math.min(A.x, B.x) - 8) / cellSize);
                const maxColumn = Math.floor((Math.max(A.x, B.x) + 8) / cellSize);
                for (let column = minColumn; column <= maxColumn; column++) {
                    let list = columns.get(column);
                    if (!list) { list = []; columns.set(column, list); }
                    list.push(entry);
                }
            }
        }
        this._faceSegColumnIndex = { cellSize, columns };
        return out;
    },

    _faceSegCandidatesAtX(x) {
        const index = this._faceSegColumnIndex;
        if (!index) return [];
        return index.columns.get(Math.floor(x / index.cellSize)) || [];
    },

    /** 建筑可见 AABB 的二维可复用索引；同 X 但上下不相交的密集建筑不再参加仲裁。 */
    _ensureStructureDepthSpatialIndex(structures) {
        if (!Array.isArray(structures)) return structures || [];
        const cellSize = 256;
        let cache = this._dynamicStructureDepthSpatialCache;
        if (!cache || cache.source !== structures) {
            const entries = [];
            for (const entity of structures) {
                if (!entity) continue;
                const occlusionBounds = structureOcclusionBounds(entity);
                const lines = Array.isArray(entity._faceLines) && entity._faceLines.length
                    ? entity._faceLines
                    : (Array.isArray(entity._faceLine) ? [entity._faceLine] : []);
                let minX = Number(occlusionBounds?.minX);
                let maxX = Number(occlusionBounds?.maxX);
                let minY = Number(occlusionBounds?.minY);
                let maxY = Number(occlusionBounds?.maxY);
                if (!Number.isFinite(minX)) minX = Infinity;
                if (!Number.isFinite(maxX)) maxX = -Infinity;
                if (!Number.isFinite(minY)) minY = Infinity;
                if (!Number.isFinite(maxY)) maxY = -Infinity;
                for (const line of lines) {
                    for (const point of line || []) {
                        if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
                        minX = Math.min(minX, point.x);
                        maxX = Math.max(maxX, point.x);
                        minY = Math.min(minY, point.y);
                        maxY = Math.max(maxY, point.y);
                    }
                }
                if (!Number.isFinite(minX) || !Number.isFinite(maxX)
                    || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
                    const halfWidth = Math.max(1, Number(entity.collisionWidth) / 2 || 1);
                    minX = (Number(entity.x) || 0) - halfWidth;
                    maxX = (Number(entity.x) || 0) + halfWidth;
                    minY = Number(entity.y) || 0;
                    maxY = minY;
                }
                entries.push({
                    entity,
                    bounds: { minX, maxX, minY, maxY },
                    minColumn: Math.floor(minX / cellSize),
                    maxColumn: Math.floor(maxX / cellSize),
                    minRow: Math.floor(minY / cellSize),
                    maxRow: Math.floor(maxY / cellSize),
                });
            }
            const sameGeometry = !!cache
                && cache.entries?.length === entries.length
                && entries.every((entry, index) => {
                    const previous = cache.entries[index];
                    return previous?.entity === entry.entity
                        && previous.minColumn === entry.minColumn
                        && previous.maxColumn === entry.maxColumn
                        && previous.minRow === entry.minRow
                        && previous.maxRow === entry.maxRow;
                });
            if (sameGeometry) {
                cache.source = structures;
                cache.entries = entries;
            } else {
                const cells = new Map();
                for (const { entity, minColumn, maxColumn, minRow, maxRow } of entries) {
                    for (let column = minColumn; column <= maxColumn; column++) {
                        for (let row = minRow; row <= maxRow; row++) {
                            const key = `${column},${row}`;
                            let list = cells.get(key);
                            if (!list) { list = []; cells.set(key, list); }
                            list.push(entity);
                        }
                    }
                }
                cache = { source: structures, entries, cellSize, cells };
                this._dynamicStructureDepthSpatialCache = cache;
            }
        }
        return cache;
    },

    _structureDepthCandidatesInBounds(structures, bounds) {
        const cache = this._ensureStructureDepthSpatialIndex(structures);
        if (!cache?.cells || !bounds) return structures || [];
        const minColumn = Math.floor(bounds.minX / cache.cellSize);
        const maxColumn = Math.floor(bounds.maxX / cache.cellSize);
        const minRow = Math.floor(bounds.minY / cache.cellSize);
        const maxRow = Math.floor(bounds.maxY / cache.cellSize);
        const candidates = new Set();
        for (let column = minColumn; column <= maxColumn; column++) {
            for (let row = minRow; row <= maxRow; row++) {
                for (const entity of cache.cells.get(`${column},${row}`) || []) {
                    candidates.add(entity);
                }
            }
        }
        return [...candidates];
    },

    /** 墙/门线段兼容查询：只按 X 收集，随后仍由 applySeg 的 Y 窗口精确过滤。 */
    _structureDepthCandidatesAtX(structures, x, sideRange = 0) {
        const cache = this._ensureStructureDepthSpatialIndex(structures);
        if (!cache?.entries) return structures || [];
        const lateralReach = Math.max(0, Number(sideRange) || 0);
        const minX = x - lateralReach;
        const maxX = x + lateralReach;
        return cache.entries
            .filter((entry) => entry.bounds.maxX >= minX && entry.bounds.minX <= maxX)
            .map((entry) => entry.entity);
    },

    /** 贴图内坐标 → 世界坐标（应用通用件的 origin/scale/flip 变换） */
    texPointToWorld(p, tx, ty) {
        const g = this._geoForTex(p.tex);
        if (!g) return { x: p.x, y: p.y };
        let u = tx - g.w / 2, v = ty - g.h / 2;
        if (p.flipX) u = -u;
        if (p.flipY) v = -v;
        return { x: p.x + u * (p.scaleX ?? 1), y: p.y + v * (p.scaleY ?? p.scaleX ?? 1) };
    },

    /** 件底边线段（世界坐标，碰撞用）：直墙=正面墙底边(face，不含端帽)；转角=顶点→两臂尖；障碍物=无线段（碰撞走矩形 footprint） */
    _pieceBaseSegments(p) {
        if (Array.isArray(p?._baseSegments)) return p._baseSegments;
        const key = Object.keys(ISO_WALL_GEO).find(k => ISO_WALL_GEO[k].tex === p.tex);
        const g = key ? ISO_WALL_GEO[key] : null;
        if (!g) return [];
        if (g.category === 'obstacle') return []; // 障碍物无墙段（_addPieceCollision 用矩形 footprint）
        const base = g.face || g.base;
        if (base) {
            // 单帧装饰门（openDoor，如主神大理石门）：拱门永久开放——碰撞=门洞两侧墙身，门洞可通行
            // 门洞读 states.open.hole（两状态模型），兼容旧 gateX 字段
            const hole = g.openDoor && isoGateHole(g);
            if (hole) {
                const at = (tx) => [tx, base[0][1] + (tx - base[0][0]) * g.slope];
                return [
                    [this.texPointToWorld(p, base[0][0], base[0][1]), this.texPointToWorld(p, ...at(hole[0]))],
                    [this.texPointToWorld(p, ...at(hole[1])), this.texPointToWorld(p, base[1][0], base[1][1])],
                ];
            }
            return [[this.texPointToWorld(p, base[0][0], base[0][1]), this.texPointToWorld(p, base[1][0], base[1][1])]];
        }
        const tips = [g.tipL, g.tipR, g.tipUpper, g.tipLower].filter(Boolean);
        return tips.map(t => [this.texPointToWorld(p, g.vertex[0], g.vertex[1]), this.texPointToWorld(p, t[0], t[1])]);
    },

    /** 按全部通用件重建阶梯碰撞矩形（编辑器拖动后调用；静态墙不动） */
    rebuildIsoCollision() {
        this.walls = this.walls.filter(w => !w._iso);
        // 门闸线段（_gate 房间门 / _chestGate 宝箱房门 / _arenaGate 竞技场通道门）由门实体自管生命周期，
        // 重建必须保留——此前全量清空会把入场门/宝箱房门的碰撞一并抹掉（门洞可穿的根因）；
        // 世界-122 菱形地块边界段（_boundary）与技能自管生命周期的临时冰墙（_iceWall）同样保留；
        // 门外入场地块外缘（_gateZoneBoundary）是视觉多边形同源的移动范围，也由地块生命周期自管；
        // 冰墙若被重建过程提前清掉，会出现视觉仍在但玩家/怪物/投射物突然穿墙。
        this.isoSegments = (this.isoSegments || []).filter(
            s => s._gate || s._chestGate || s._arenaGate || s._boundary
                || s._iceWall || s._gateZoneBoundary
        );
        this._faceSegCache = null; // 衔接仲裁缓存随几何变更失效
        for (const p of this.isoVisuals) this._addPieceCollision(p);
    },

    /**
     * 摘除与参考线段共线且重合度 >50% 的墙件（返回摘除数）。
     * 用途：门闸原位替换时一并摘除"续接瓦片尾端近整瓦重复件"——edgeFill 只叠不缺规则下，
     * 尾端瓦片可与转角臂几乎整瓦重复（平时被转角臂 +5 偏置盖住、碰撞冗余无害）；
     * 门闸只摘被替换件时，重复件的碰撞段横穿门洞（"下夹角门又多一堵墙/无法离场"根因）。
     * 门闸世界跨度 == 瓦片定长（僵尸素材自洽），摘除后由门闸自身覆盖全段，不留缺口。
     * 正常接缝叠合仅 8px（≈2%），远低于 50% 阈值，不会误摘邻件。
     * @returns {Array} 被摘除的墙件（调用方失败回滚时用；深度在件上显式携带，尾部重新推回即可）
     */
    removeSpanCoveringPieces(refSeg) {
        const [A, B] = refSeg;
        const lenAB = Math.hypot(B.x - A.x, B.y - A.y);
        if (lenAB < 1) return [];
        const ux = (B.x - A.x) / lenAB, uy = (B.y - A.y) / lenAB;
        const removed = [];
        for (let i = this.isoVisuals.length - 1; i >= 0; i--) {
            const p = this.isoVisuals[i];
            const seg = this._pieceBaseSegments(p)[0];
            if (!seg) continue;
            const [C, D] = seg;
            // 共线判定：两端点到参考直线的距离都 < 15px
            const distPt = (P) => Math.abs((P.x - A.x) * uy - (P.y - A.y) * ux);
            if (distPt(C) > 15 || distPt(D) > 15) continue;
            // 投影重合度 > 50%（取两者较短段为基准）
            const proj = (P) => (P.x - A.x) * ux + (P.y - A.y) * uy;
            const lo = Math.max(0, Math.min(proj(C), proj(D)));
            const hi = Math.min(lenAB, Math.max(proj(C), proj(D)));
            const lenCD = Math.hypot(D.x - C.x, D.y - C.y);
            if (hi - lo > 0.5 * Math.min(lenAB, lenCD)) {
                removed.push(...this.isoVisuals.splice(i, 1));
            }
        }
        return removed;
    },

    /** 障碍物 footprint 矩形（世界坐标）：碰撞注册与场景散布排除带共用同一推导口径，禁止各自实现 */
    getObstacleFootprintRect(p) {
        const geo = this._geoForTex(p.tex);
        if (!geo || geo.tex === ISO_WALL_GEO.torch.tex) return null;
        if (geo.category !== 'obstacle' || !geo.foot) return null;
        const sx = Math.abs(p.scaleX ?? 1), sy = Math.abs(p.scaleY ?? p.scaleX ?? 1);
        const fw = geo.foot.w * sx, fd = geo.foot.d * sy;
        // 数据兜底：负/零缩放或异常 foot 返回 null（0 厚墙/反向墙）
        if (!(fw > 0) || !(fd > 0)) return null;
        const offX = (geo.foot.offsetX || 0) * sx, offY = (geo.foot.offsetY || 0) * sy;
        const bottomY = p.y + (geo.h * sy) / 2 + offY;
        // 旋转：footprint 矩形随 p.rotation 旋转，碰撞盒取旋转后 AABB
        // （半宽/深按 |cos|/|sin| 展开；未旋转退化为原矩形）
        const rot = p.rotation || 0;
        let hw = fw / 2, hd = fd / 2;
        if (rot) {
            const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
            const nw = hw * c + hd * s;
            hd = hw * s + hd * c;
            hw = nw;
        }
        const cx = p.x + offX, cy = bottomY - fd / 2;
        return { x: cx - hw, y: cy - hd, w: hw * 2, h: hd * 2 };
    },

    /** 清除以 (x,y) 为圆心、radius 半径内重叠的散布障碍物（仙人掌/树等 _scatter 件，
     *  2026-08-17 用户口径：建筑建造处有树木/草类障碍物 → 直接删除）。
     *  返回删除数量；删除后重建碰撞并同步 Phaser 视觉/物理。 */
    removeScatterObstaclesAt(x, y, radius) {
        return this.removeScatterObstaclesInZones([{ x, y, radius }]);
    },

    /** 批量清除多个建造区内的散布障碍；只重建一次碰撞/Phaser 视觉。 */
    removeScatterObstaclesInZones(zones) {
        const validZones = (zones || []).filter((z) =>
            z && Number.isFinite(z.x) && Number.isFinite(z.y) && z.radius > 0
        );
        const raw = this.isoVisuals;
        if (!raw || !raw.length || validZones.length === 0) return 0;
        const keep = [];
        let removed = 0;
        for (const p of raw) {
            if (!p._scatter) { keep.push(p); continue; }
            const rect = this.getObstacleFootprintRect(p);
            const hit = validZones.some((z) => {
                if (rect) {
                    // 圆-矩形相交：矩形内最近点到圆心距离 ≤ radius
                    const nx = Math.max(rect.x, Math.min(z.x, rect.x + rect.w));
                    const ny = Math.max(rect.y, Math.min(z.y, rect.y + rect.h));
                    return Math.hypot(z.x - nx, z.y - ny) <= z.radius;
                }
                return Math.hypot(p.x - z.x, p.y - z.y) <= z.radius;
            });
            if (hit) {
                removed++;
                if (p._sunShadow && typeof window !== 'undefined'
                    && window.__phaserScene && typeof window.__phaserScene.unregisterStaticSunShadow === 'function') {
                    window.__phaserScene.unregisterStaticSunShadow(p._sunShadow);
                    p._sunShadow = null;
                }
                if (p._sprite && typeof p._sprite.destroy === 'function') p._sprite.destroy();
            } else {
                keep.push(p);
            }
        }
        if (removed) {
            this.isoVisuals = keep;
            this.rebuildIsoCollision();
            if (this._syncWallsToPhaser) this._syncWallsToPhaser();
            // 墙数变化 → 小地图静态层缓存失效重绘
            if (typeof window !== 'undefined' && window.__phaserScene) window.__phaserScene._minimapStaticKey = null;
        }
        return removed;
    },

    /**
     * 建筑落点可达性：散布障碍（_scatter）视为可清除，普通墙/边界/门/建筑仍阻挡。
     * 建造成功后调用 removeScatterObstaclesAt/InZones 真正删除；失败不会破坏场景。
     */
    canBuildAt(x, y, radius, ignore = null) {
        const rects = new Set(ignore && ignore.rects ? ignore.rects : []);
        for (const w of this.walls || []) {
            if (w && w._scatterSource) rects.add(w);
        }
        const segs = new Set(ignore && ignore.segs ? ignore.segs : []);
        return this.canMoveTo(x, y, radius, { rects, segs });
    },
    /** 单件碰撞：底边线段 → 线段模型（精确滑动）+ 每 30px 一块 36×20 阶梯矩形（寻路/小地图） */
    _addPieceCollision(p) {
        // 障碍物：碰撞 = 贴图底部矩形 footprint 墙（geo.foot 宽高 × 缩放，锚底边中心）
        const geo = this._geoForTex(p.tex);
        // 火把硬性无碰撞（用户规则）：即使摆墙编辑器/碰撞编辑器重新保存了 foot 覆盖也不生成
        if (geo && geo.tex === ISO_WALL_GEO.torch.tex) return;
        if (geo && geo.category === 'obstacle' && geo.foot) {
            const rect = this.getObstacleFootprintRect(p);
            if (!rect) return;
            this.walls.push({
                ...rect,
                height: 60, noVisual: true, _iso: true, _obstacle: true,
                _scatterSource: p._scatter ? p : null,
            });
            return;
        }
        for (const [a, b] of this._pieceBaseSegments(p)) {
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len < 10) continue;
            const sourceSegment = { x1: a.x, y1: a.y, x2: b.x, y2: b.y, halfThick: isoHalfThick(geo) };
            this.isoSegments.push(sourceSegment);
            const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
            for (let d = 15; d < len; d += 30) {
                const px = a.x + ux * d, py = a.y + uy * d;
                this.walls.push({
                    x: px - 18, y: py - 10, w: 36, h: 20,
                    height: 60, noVisual: true, _iso: true,
                    _isoSourceSegment: sourceSegment,
                });
            }
        }
    },

    /** 查找与指定线段相交的水平墙壁（用于透视深度调整） */
    _findAdjacentHorizontalWall(x1, y1, x2, y2, self) {
        const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
        for (const w of this.walls) {
            if (w === self) continue;
            if (w.w < w.h) continue; // 只找水平墙（w >= h）
            if (maxX >= w.x && minX <= w.x + w.w && maxY >= w.y && minY <= w.y + w.h) {
                return w;
            }
        }
        return null;
    },

    /** 检测指定线段范围内是否有其他墙壁（拼接判定） */
    _hasAdjacentWall(x1, y1, x2, y2, self) {
        for (const w of this.walls) {
            if (w === self) continue;
            // 检查线段是否与墙壁矩形相交（简单的 AABB 相交检测）
            const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
            const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
            if (maxX >= w.x && minX <= w.x + w.w && maxY >= w.y && minY <= w.y + w.h) {
                return true;
            }
        }
        return false;
    },

    /** 在墙壁尽头画半圆角（graphics 半圆，与墙体贴图颜色一致） */
    _drawWallCap(phaserScene, cx, cy, r, side) {
        const g = phaserScene.add.graphics();
        const color = 0x3a3a3a; // 与 wall.png 深色砖块接近
        g.fillStyle(color, 1);
        // 根据方向画半圆
        g.beginPath();
        if (side === 'left') {
            g.arc(cx, cy, r, Math.PI / 2, Math.PI * 1.5);
        } else if (side === 'right') {
            g.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2);
        } else if (side === 'top') {
            g.arc(cx, cy, r, Math.PI, 0);
        } else { // bottom
            g.arc(cx, cy, r, 0, Math.PI);
        }
        g.closePath();
        g.fillPath();
        g.setDepth(cy);
        phaserScene.visualWalls.add(g);
    },
    /**
     * 将树木同步到 Phaser 的 staticGroup
     */
    _syncTreesToPhaser() {
        const phaserScene = window.__phaserScene;
        if (!phaserScene) return;
        // 树木视觉层重建前，一并移除对应的太阳投影，防止切场景/重建时遗留。
        if (phaserScene.visualTrees) {
            for (const oldSprite of phaserScene.visualTrees.getChildren()) {
                const oldShadow = oldSprite.getData && oldSprite.getData('sunShadow');
                if (oldShadow && typeof phaserScene.unregisterStaticSunShadow === 'function') {
                    phaserScene.unregisterStaticSunShadow(oldShadow);
                }
            }
            phaserScene.visualTrees.clear(true, true);
        }
        for (const oldTree of this.trees) oldTree._sunShadow = null;
        // 创建树木圆形碰撞体（用不可见圆形表示），使用独立的 collisionRadius
        for (const t of this.trees) {
            const tree = phaserScene.add.circle(t.x, t.y, t.collisionRadius || t.radius * 0.6, 0x000000, 0);
            phaserScene.physics.add.existing(tree, true);
            phaserScene.walls.add(tree);
            t.phaserBody = tree;

            if (phaserScene.visualTrees) {
                const sprite = phaserScene.add.sprite(t.x, t.y, 'tree_canopy');
                sprite.setOrigin(0.5, 1);
                const canopyR = t.canopyRadius || t.radius * 1.2;
                const trunkH = t.trunkHeight || t.radius * 2;
                const displayW = canopyR * 2.2;
                const displayH = trunkH + canopyR * 1.8;
                sprite.setDisplaySize(displayW, displayH);
                sprite.setDepth(t.sortY || t.y + t.radius * 2);
                phaserScene.visualTrees.add(sprite);
                t.visualSprite = sprite;
                if (typeof phaserScene.registerStaticSunShadow === 'function') {
                    t._sunShadow = phaserScene.registerStaticSunShadow({
                        x: t.x,
                        y: t.y,
                        radius: t.collisionRadius || t.radius * 0.6,
                        height: t.height || t.radius * 3,
                        maxOffset: 72,
                        depth: sprite.depth - 0.1,
                    });
                    sprite.setData('sunShadow', t._sunShadow);
                }
            }
        }

        if (this.trees.length > 0) this._phaserVisualsEnabled = true;
    },
    circleRect(cx, cy, r, rect) {
        const clX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
        const clY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
        return (cx - clX) ** 2 + (cy - clY) ** 2 < r * r;
    },
    /** 墙顶外轮廓仅阻挡已经处于高架表面的单位，不参与地面、建造或弹道碰撞。 */
    _segmentAppliesToMove(segment, ignore = null) {
        if (!segment?._elevatedOnly) return true;
        const entity = ignore?.surfaceEntity;
        return !!entity && (Number(entity.z) || 0) > 1
            && (entity._surfaceKind === 'wall_walk'
                || entity._surfaceKind === 'stairs'
                || entity._elevatedNavigationBridge);
    },
    /** 高架表面单位只忽略其当前连接城墙；其它墙、门和楼梯侧边仍正常阻挡。 */
    ignoreForEntity(entity) {
        const onElevatedSurface = entity?._surfaceKind === 'wall_walk'
            || entity?._surfaceKind === 'stairs'
            || (entity?._elevatedNavigationBridge && entity?._elevatedNavigationActive);
        // _surfaceWalls 可能在表面提交前后短暂保留；只有已经取得高架身份的单位才能
        // 忽略承载自己的墙体。地面单位即使残留旧引用，也必须继续执行完整墙体碰撞。
        if (!onElevatedSurface || (Number(entity?.z) || 0) <= 1) return null;
        const walls = Array.isArray(entity?._surfaceWalls) && entity._surfaceWalls.length
            ? entity._surfaceWalls
            : (entity?._surfaceWall ? [entity._surfaceWall] : []);
        if (!walls.length) return null;
        const segs = new Set();
        const rects = new Set();
        for (const wall of walls) {
            if (!wall?.active) continue;
            if (wall._coverSeg) segs.add(wall._coverSeg);
            if (wall._gateSeg) segs.add(wall._gateSeg);
            if (wall._wallRect) rects.add(wall._wallRect);
        }
        if (entity?._surfaceKind === 'wall_walk' || entity?._elevatedNavigationBridge) {
            for (const segment of this.isoSegments || []) {
                if (!segment?._stairEdge) continue;
                // 墙顶外轮廓防坠线是真实边界；墙顶和桥接单位都不能忽略。
                // 墙墙共享边与墙梯入口边根本不生成该线，因此无需靠忽略来放行。
                if (segment._surfaceWallGuard) continue;
                const staircase = segment._owner;
                const staircaseWall = segment._owner?.wall;
                const currentStaircase = entity?._surfaceStaircase;
                const sameBridgeGroup = entity?._elevatedNavigationBridge
                    && currentStaircase
                    && (staircase === currentStaircase
                        || (currentStaircase._wallStairGroupId
                            && currentStaircase._wallStairGroupId
                                === staircase?._wallStairGroupId)
                        || (currentStaircase._sharedStairSurfaces || []).some((seam) =>
                            seam?.stairA === staircase || seam?.stairB === staircase));
                if (sameBridgeGroup || (staircaseWall && walls.includes(staircaseWall))) {
                    segs.add(segment);
                }
            }
        }
        return segs.size || rects.size || entity?._surfaceMoveAxes?.length
            ? { segs, rects, surfaceEntity: entity }
            : null;
    },
    canMoveTo(x, y, radius, ignore = null) {
        if (this._collisionAccel) {
            const g = this._getCollisionGrid();
            if (!g) return this._linearCanMoveTo(x, y, radius, ignore);
            const { cell, cells, key, maxSegThick, maxTreeR } = g;
            const range = Math.ceil((radius + Math.max(maxSegThick, maxTreeR)) / cell) + 1;
            const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
            for (let dy = -range; dy <= range; dy++) {
                for (let dx = -range; dx <= range; dx++) {
                    const arr = cells.get(key(cx + dx, cy + dy));
                    if (!arr) continue;
                    for (const item of arr) {
                        if (item.type === 'wall') {
                            if (ignore && ignore.rects && ignore.rects.has(item.obj)) continue;
                            if (this.circleRect(x, y, radius, item.obj)) return false;
                        } else if (item.type === 'seg') {
                            const s = item.obj;
                            if (ignore && ignore.segs && ignore.segs.has(s)) continue;
                            if (!this._segmentAppliesToMove(s, ignore)) continue;
                            if (this._groundPointSegDist(x, y, s) < radius + s.halfThick) return false;
                        } else {
                            const t = item.obj;
                            const ddx = x - t.x, ddy = y - t.y;
                            const treeR = t.collisionRadius || t.radius * 0.6;
                            if (Math.sqrt(ddx * ddx + ddy * ddy) < treeR + radius) return false;
                        }
                    }
                }
            }
            return true;
        }
        return this._linearCanMoveTo(x, y, radius, ignore);
    },
    /** 点 (px,py) 到线段 (x1,y1)-(x2,y2) 的距离 */
    _pointSegDist(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) return Math.hypot(px - x1, py - y1);
        let t = ((px - x1) * dx + (py - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    },
    /** 楼梯边界位于等距地面：Y先逆压缩，按真实groundRadius判定；普通墙保持屏幕距离。 */
    _groundPointSegDist(px, py, segment) {
        if (!segment?._stairEdge) {
            return this._pointSegDist(
                px,
                py,
                segment.x1,
                segment.y1,
                segment.x2,
                segment.y2
            );
        }
        const invScale = 1 / PERSPECTIVE_SCALE_Y;
        return this._pointSegDist(
            px,
            py * invScale,
            segment.x1,
            segment.y1 * invScale,
            segment.x2,
            segment.y2 * invScale
        );
    },
    /** 两线段是否相交 */
    _segSegIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
        const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (d === 0) return false;
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
        const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    },
    /**
     * 带高度的投射物墙体判定。二维轨迹与墙相交后，再比较交点附近弹道 z 与墙顶高度；
     * 取代“站上高台后忽略全部掩体”的旧特例。
     */
    projectileWallHit(x1, y1, z1, x2, y2, z2, ignore = null) {
        const startZ = Number(z1) || 0;
        const endZ = Number(z2) || 0;
        const dz = endZ - startZ;
        const ignoredWalls = ignore?.ignoredProjectileWalls;
        const isIgnored = (obstacle, owner = null) => !!ignoredWalls?.size
            && (ignoredWalls.has(obstacle)
                || ignoredWalls.has(owner)
                || ignoredWalls.has(obstacle?._owner));
        let best = null;
        const recordHit = (t, obstacle, owner, height) => {
            if (!Number.isFinite(t) || t < 0 || t > 1 || (best && t >= best.t)) return;
            best = {
                blocked: true,
                t,
                obstacle,
                owner: owner || obstacle?._owner || null,
                wall: owner || obstacle?._owner || obstacle || null,
                x: x1 + (x2 - x1) * t,
                y: y1 + (y2 - y1) * t,
                z: startZ + dz * t,
                height,
            };
        };
        for (const wall of this.walls || []) {
            if (ignore?.rects?.has(wall)) continue;
            if (isIgnored(wall, wall._owner)) continue;
            const interval = this._lineRectInterval(x1, y1, x2, y2, wall);
            if (!interval || interval.enter >= interval.exit) continue;
            const height = Number(wall._owner?._wallTopZ)
                || Number(wall._wallTopZ)
                || Number(wall.height)
                || this._wallHeight
                || 60;
            const enterZ = startZ + (endZ - startZ) * interval.enter;
            let hitT = enterZ <= height ? interval.enter : null;
            if (hitT === null && dz < 0) {
                const topT = (height - startZ) / dz;
                if (topT >= interval.enter && topT <= interval.exit) hitT = topT;
            }
            if (hitT !== null) recordHit(hitT, wall, wall._owner, height);
        }
        for (const segment of this.isoSegments || []) {
            if (ignore?.segs?.has(segment) || segment._stairEdge || segment._movementOnly) continue;
            if (isIgnored(segment, segment._owner)) continue;
            const ax = x2 - x1;
            const ay = y2 - y1;
            const bx = segment.x2 - segment.x1;
            const by = segment.y2 - segment.y1;
            const denom = ax * by - ay * bx;
            if (Math.abs(denom) <= 1e-8) continue;
            const cx = segment.x1 - x1;
            const cy = segment.y1 - y1;
            const t = (cx * by - cy * bx) / denom;
            const u = (cx * ay - cy * ax) / denom;
            if (t < 0 || t > 1 || u < 0 || u > 1) continue;
            const ownerHeight = Number(segment._owner?._wallTopZ);
            const height = Number.isFinite(ownerHeight)
                ? ownerHeight
                : (Number(segment.height) || this._wallHeight || 60);
            const crossingZ = startZ + (endZ - startZ) * t;
            if (crossingZ <= height) recordHit(t, segment, segment._owner, height);
        }
        return best;
    },
    projectileBlocked(x1, y1, z1, x2, y2, z2, ignore = null) {
        return !!this.projectileWallHit(x1, y1, z1, x2, y2, z2, ignore);
    },
    resolve(x, y, nx, ny, r, ignore = null) {
        if (ignore) {
            ignore._surfaceProjected = false;
            ignore._surfaceProjectedTarget = null;
        }
        const surfaceEntity = ignore?.surfaceEntity;
        const axes = (surfaceEntity?._surfaceKind === 'wall_walk'
            || surfaceEntity?._surfaceKind === 'stairs')
            && Array.isArray(surfaceEntity._surfaceMoveAxes)
            ? surfaceEntity._surfaceMoveAxes
            : null;
        if (axes?.length) {
            const dx = nx - x;
            const dy = ny - y;
            const magnitude = Math.hypot(dx, dy);
            if (magnitude > 1e-6) surfaceEntity._surfaceMoveChosenAxis = null;
            const inputIntent = surfaceEntity?._surfaceInputIntent;
            const intentX = inputIntent && Math.hypot(inputIntent.x, inputIntent.y) > 1e-6
                ? inputIntent.x
                : dx;
            const intentY = inputIntent && Math.hypot(inputIntent.x, inputIntent.y) > 1e-6
                ? inputIntent.y
                : dy;
            const intentMagnitude = Math.hypot(intentX, intentY);
            let best = null;
            let bestWall = null;
            let bestPortal = null;
            for (const axis of axes) {
                const dot = intentX * axis.x + intentY * axis.y;
                if (dot <= 0.01) continue;
                const candidate = {
                    axis,
                    dot,
                    alignment: intentMagnitude > 1e-6 ? dot / intentMagnitude : 0,
                };
                if (!best || dot > best.dot) best = candidate;
                if (axis.kind === 'stair_portal') {
                    if (!bestPortal || dot > bestPortal.dot) bestPortal = candidate;
                } else if (!bestWall || dot > bestWall.dot) {
                    bestWall = candidate;
                }
            }
            const portalOverrideMargin = Number(surfaceEntity._surfacePortalOverrideMargin) || 0.2;
            if (bestWall && bestPortal && bestPortal.alignment > bestWall.alignment
                && bestPortal.alignment - bestWall.alignment < portalOverrideMargin) {
                best = bestWall;
            }
            const minAlignment = Number(surfaceEntity._surfaceMoveMinAlignment) || 0.2;
            if (best && magnitude > 1e-6 && intentMagnitude > 1e-6
                && best.dot / intentMagnitude >= minAlignment) {
                surfaceEntity._surfaceMoveChosenAxis = {
                    x: best.axis.x,
                    y: best.axis.y,
                    kind: best.axis.kind || 'wall',
                    staircaseId: best.axis.staircaseId || null,
                };
                // 只保留输入在合法轴上的分量。禁止把朝楼梯外侧的横向输入旋转成
                // 完整速度的上/下楼位移，否则会在墙梯接口触发非预期跨层。
                const projectedMagnitude = magnitude * Math.max(0, best.alignment);
                const projectedX = x + best.axis.x * projectedMagnitude;
                const projectedY = y + best.axis.y * projectedMagnitude;
                if (Math.hypot(projectedX - nx, projectedY - ny) > 0.01) {
                    nx = projectedX;
                    ny = projectedY;
                    ignore._surfaceProjected = true;
                    ignore._surfaceProjectedTarget = { x: nx, y: ny };
                }
            }
        }
        if (this.canMoveTo(nx, ny, r, ignore) && !this.blocked(x, y, nx, ny, ignore)) return { x: nx, y: ny };
        // iso 墙切向滑动：找最近阻挡墙段，取移动在墙方向上的分量（速度不超意图，杜绝加速滑行）
        const seg = this._nearestBlockingSeg(nx, ny, r, ignore);
        if (seg) {
            const dx = nx - x, dy = ny - y;
            const wx = seg.x2 - seg.x1, wy = seg.y2 - seg.y1;
            const wl2 = wx * wx + wy * wy;
            if (wl2 > 0) {
                const t = (dx * wx + dy * wy) / wl2;
                for (const ratio of [1, 0.5, 0.25]) {
                    const sx = x + wx * t * ratio, sy = y + wy * t * ratio;
                    if (this.canMoveTo(sx, sy, r, ignore) && !this.blocked(x, y, sx, sy, ignore)) {
                        return { x: sx, y: sy };
                    }
                }
            }
        }
        if (this.canMoveTo(nx, y, r, ignore) && !this.blocked(x, y, nx, y, ignore)) return { x: nx, y };
        if (this.canMoveTo(x, ny, r, ignore) && !this.blocked(x, y, x, ny, ignore)) return { x, y: ny };
        // 矩形障碍（散布树 footprint 等）切向滑动：对最近阻挡矩形取贴面方向投影，
        // 与 iso 段同口径；两轴分解都堵死（L/V 形树兜）时沿矩形边滑出
        const bRect = this._nearestBlockingRect(nx, ny, r);
        if (bRect) {
            const rdx = nx - x, rdy = ny - y;
            // 实体相对矩形最近点的法线方向
            const px = Math.max(bRect.x, Math.min(x, bRect.x + bRect.w));
            const py = Math.max(bRect.y, Math.min(y, bRect.y + bRect.h));
            let fnx = x - px, fny = y - py;
            const fnl = Math.hypot(fnx, fny);
            let tx, ty;
            if (fnl > 1e-6) { tx = -fny / fnl; ty = fnx / fnl; }
            else { tx = -rdy; ty = rdx; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl; }
            // 取与移动方向同向的切向（不反向调头），速度不超意图
            if (rdx * tx + rdy * ty < 0) { tx = -tx; ty = -ty; }
            const tMag = Math.abs(rdx * tx + rdy * ty);
            for (const ratio of [1, 0.5, 0.25]) {
                const sx = x + tx * tMag * ratio, sy = y + ty * tMag * ratio;
                if (this.canMoveTo(sx, sy, r, ignore) && !this.blocked(x, y, sx, sy, ignore)) {
                    return { x: sx, y: sy };
                }
            }
        }
        // [OPTIMIZE] 标准滑动失败后，尝试沿移动方向逐步缩减步长
        const dx = nx - x, dy = ny - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
            for (let ratio = 0.75; ratio >= 0.25; ratio -= 0.25) {
                const stepX = x + dx * ratio;
                const stepY = y + dy * ratio;
                if (this.canMoveTo(stepX, stepY, r, ignore) && !this.blocked(x, y, stepX, stepY, ignore)) {
                    return { x: stepX, y: stepY };
                }
            }
        }
        return { x, y };
    },
    /** 找离目标点最近的阻挡 iso 墙段（距离 < r + 半厚 + 容差） */
    _nearestBlockingSeg(nx, ny, r, ignore = null) {
        if (this._collisionAccel) {
            const g = this._getCollisionGrid();
            if (g) {
                const { cell, cells, key, maxSegThick } = g;
                const range = Math.ceil((r + maxSegThick + 4) / cell) + 1;
                const cx = Math.floor(nx / cell), cy = Math.floor(ny / cell);
                let best = null, bestD = Infinity, bestIdx = Infinity;
                for (let dy = -range; dy <= range; dy++) {
                    for (let dx = -range; dx <= range; dx++) {
                        const arr = cells.get(key(cx + dx, cy + dy));
                        if (!arr) continue;
                        for (const item of arr) {
                            if (item.type !== 'seg') continue;
                            const s = item.obj;
                            if (ignore && ignore.segs && ignore.segs.has(s)) continue;
                            if (!this._segmentAppliesToMove(s, ignore)) continue;
                            const d = this._groundPointSegDist(nx, ny, s);
                            // 平局按数组下标决胜（与线性版"先到先得"严格一致）
                            if (d < r + s.halfThick + 4 && (d < bestD || (d === bestD && item.idx < bestIdx))) {
                                bestD = d;
                                best = s;
                                bestIdx = item.idx;
                            }
                        }
                    }
                }
                return best;
            }
        }
        return this._linearNearestBlockingSeg(nx, ny, r, ignore);
    },
    /** 找离目标点最近的阻挡矩形墙（散布树 footprint 等；圆心到矩形距离 < r + 容差） */
    _nearestBlockingRect(nx, ny, r) {
        let best = null, bestD = Infinity;
        for (const w of this.walls) {
            if (!w) continue;
            const cx = Math.max(w.x, Math.min(nx, w.x + w.w));
            const cy = Math.max(w.y, Math.min(ny, w.y + w.h));
            const d = Math.hypot(nx - cx, ny - cy);
            if (d < r + 4 && d < bestD) { bestD = d; best = w; }
        }
        return best;
    },
    lineCircle(x1, y1, x2, y2, cx, cy, r) {
        const dx = x2 - x1, dy = y2 - y1;
        const a = dx * dx + dy * dy;
        const b = 2 * (dx * (x1 - cx) + dy * (y1 - cy));
        const c = (x1 - cx) * (x1 - cx) + (y1 - cy) * (y1 - cy) - r * r;
        if (a === 0) return Math.sqrt((x1 - cx) ** 2 + (y1 - cy) ** 2) < r;
        const det = b * b - 4 * a * c;
        if (det < 0) return false;
        const t1 = (-b - Math.sqrt(det)) / (2 * a), t2 = (-b + Math.sqrt(det)) / (2 * a);
        return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
    },
    _lineRectInterval(x1, y1, x2, y2, rect) {
        const dx = x2 - x1, dy = y2 - y1;
        let u1 = 0, u2 = 1;
        const p = [-dx, dx, -dy, dy], q = [x1 - rect.x, rect.x + rect.w - x1, y1 - rect.y, rect.y + rect.h - y1];
        for (let i = 0; i < 4; i++) {
            if (p[i] === 0) { if (q[i] < 0) return null; }
            else { const t = q[i] / p[i]; if (p[i] < 0) { if (t > u1) u1 = t; } else { if (t < u2) u2 = t; } }
        }
        return u1 <= u2 ? { enter: u1, exit: u2 } : null;
    },
    lineRect(x1, y1, x2, y2, rect) {
        const interval = this._lineRectInterval(x1, y1, x2, y2, rect);
        return !!interval && interval.enter < interval.exit;
    },
    blocked(x1, y1, x2, y2, ignore = null) {
        if (this._collisionAccel) {
            const g = this._getCollisionGrid();
            if (!g) return this._linearBlocked(x1, y1, x2, y2, ignore);
            const { cell, cells, key, maxSegThick, maxTreeR } = g;
            // 长距离 LOS 禁止遍历整条射线的二维 AABB（对角线会把空格查询放大为面积复杂度）。
            // 使用 Amanatides-Woo DDA 只访问射线真正穿过的格；障碍物已按自身包围盒注册到网格，
            // 再扩一圈厚度格用于边界/粗线容差，保持原相交谓词不变。
            const seen = new Set();
            const checkCell = (cx, cy) => {
                const arr = cells.get(key(cx, cy));
                if (!arr) return false;
                for (const item of arr) {
                    if (seen.has(item)) continue;
                    seen.add(item);
                    if (item.type === 'wall') {
                        const w = item.obj;
                        if (ignore?.rects?.has(w)) continue;
                        if (this.lineRect(x1, y1, x2, y2, w)) return true;
                    } else if (item.type === 'seg') {
                        const s = item.obj;
                        if (ignore?.segs?.has(s)) continue;
                        if (!this._segmentAppliesToMove(s, ignore)) continue;
                        if (this._segSegIntersect(x1, y1, x2, y2, s.x1, s.y1, s.x2, s.y2)) return true;
                    } else {
                        const t = item.obj;
                        if (this.lineCircle(x1, y1, x2, y2, t.x, t.y,
                            t.collisionRadius || t.radius * 0.6)) return true;
                    }
                }
                return false;
            };

            let cx = Math.floor(x1 / cell), cy = Math.floor(y1 / cell);
            const endCX = Math.floor(x2 / cell), endCY = Math.floor(y2 / cell);
            const dx = x2 - x1, dy = y2 - y1;
            const stepX = Math.sign(dx), stepY = Math.sign(dy);
            const tDeltaX = stepX === 0 ? Infinity : cell / Math.abs(dx);
            const tDeltaY = stepY === 0 ? Infinity : cell / Math.abs(dy);
            const boundaryX = stepX > 0 ? (cx + 1) * cell : cx * cell;
            const boundaryY = stepY > 0 ? (cy + 1) * cell : cy * cell;
            let tMaxX = stepX === 0 ? Infinity : (boundaryX - x1) / dx;
            let tMaxY = stepY === 0 ? Infinity : (boundaryY - y1) / dy;
            const neighborRange = Math.ceil(Math.max(maxSegThick, maxTreeR) / cell) + 1;
            const maxSteps = Math.abs(endCX - cx) + Math.abs(endCY - cy) + 2;

            for (let steps = 0; steps < maxSteps; steps++) {
                for (let oy = -neighborRange; oy <= neighborRange; oy++) {
                    for (let ox = -neighborRange; ox <= neighborRange; ox++) {
                        if (checkCell(cx + ox, cy + oy)) return true;
                    }
                }
                if (cx === endCX && cy === endCY) break;
                if (tMaxX < tMaxY) {
                    cx += stepX;
                    tMaxX += tDeltaX;
                } else {
                    cy += stepY;
                    tMaxY += tDeltaY;
                }
            }
            return false;
        }
        return this._linearBlocked(x1, y1, x2, y2, ignore);
    },

    /**
     * 点在线段哪一侧（符号）：cross(seg, point) 的符号，用于"只出不进"方向判定
     * @returns {number} >0 / <0 / 0（在线上）
     */
    segSide(s, x, y) {
        return (s.x2 - s.x1) * (y - s.y1) - (s.y2 - s.y1) * (x - s.x1);
    },

    /** 点是否在矩形内（含 margin 容差） */
    pointInRect(x, y, w, margin = 0) {
        return x >= w.x - margin && x <= w.x + w.w + margin && y >= w.y - margin && y <= w.y + w.h + margin;
    },

    /**
     * 点相对矩形的方位：'left'|'right'|'top'|'bottom'|'inside'
     * 按相对矩形中心的归一化偏移取主轴（薄墙场景主轴即墙面朝向，嵌墙子弹"只出不进"判定用）
     */
    sideOfRect(x, y, w) {
        if (this.pointInRect(x, y, w)) return 'inside';
        const dx = x - (w.x + w.w / 2), dy = y - (w.y + w.h / 2);
        const nx = Math.abs(dx) / Math.max(1, w.w / 2), ny = Math.abs(dy) / Math.max(1, w.h / 2);
        if (nx >= ny) return dx < 0 ? 'left' : 'right';
        return dy < 0 ? 'top' : 'bottom';
    },

    /**
     * 嵌墙检测（投射物"只出不进"方案的出膛判定）：
     * 找出"射手→出膛点"路径被隔断的墙——iso 面线被跨过（出膛点在另一侧）/ 出膛点在矩形墙内。
     * @returns {{segs:Array<{seg:object, shooterSign:number}>, rects:Array<{rect:object, shooterSide:string}>}|null}
     */
    detectEmbeddedWalls(x, y, source) {
        const out = { segs: [], rects: [] };
        if (!source) return null;
        if (this.isoSegments) {
            for (const s of this.isoSegments) {
                if (s?._elevatedOnly) continue;
                if (this._segSegIntersect(source.x, source.y, x, y, s.x1, s.y1, s.x2, s.y2)) {
                    out.segs.push({ seg: s, shooterSign: Math.sign(this.segSide(s, source.x, source.y)) || 1 });
                }
            }
        }
        for (const w of this.walls || []) {
            if (w._iso) continue; // iso 阶梯块由嵌墙面线的 linked 集合统一放行，不进矩形规则
            // 出膛点在矩形内，或射手→出膛点路径穿过矩形（真实矩形墙：hub 边界/障碍物）
            if (this.pointInRect(x, y, w, 1) || this.lineRect(source.x, source.y, x, y, w)) {
                out.rects.push({ rect: w, shooterSide: this.sideOfRect(source.x, source.y, w) });
            }
        }
        // iso 阶梯碰撞块挂到嵌墙面线上：嵌墙面线放行时其阶梯块同效（否则弹道穿过面线时撞阶梯块仍死）
        for (const e of out.segs) {
            e.linked = new Set();
            for (const w of this.walls || []) {
                if (!w._iso) continue;
                const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
                if (this._pointSegDist(cx, cy, e.seg.x1, e.seg.y1, e.seg.x2, e.seg.y2) < 25) e.linked.add(w);
            }
        }
        return (out.segs.length || out.rects.length) ? out : null;
    },
    addTree(x, y, radius, treeType, sceneGroup = 'normal', rotation = 0) {
        // [OPTIMIZE] 碰撞体积较大的怪物卡树优化：
        // 树木视觉半径和碰撞半径分离，碰撞半径为视觉半径的60%，
        // 让大怪物更容易在树木间通过，同时保持视觉效果
        const collisionRadius = radius * 0.6;
        const treeData = {
            x, y, radius, collisionRadius,
            height: radius * 3,
            type: treeType || 0,
            sceneGroup: sceneGroup || 'normal',
            rotation: rotation || 0,
            trunkWidth: radius * 0.6,
            trunkHeight: radius * 2,
            canopyRadius: radius * 1.2,
            sortY: y + radius * 2
        };
        this.trees.push(treeData);
        // ===== Phaser 树木同步（单个添加）=====
        const phaserScene = window.__phaserScene;
        if (phaserScene) {
            const tree = phaserScene.add.circle(x, y, collisionRadius, 0x000000, 0);
            phaserScene.physics.add.existing(tree, true);
            phaserScene.walls.add(tree);
            treeData.phaserBody = tree;

            if (phaserScene.visualTrees) {
                const sprite = phaserScene.add.sprite(x, y, 'tree_canopy');
                sprite.setOrigin(0.5, 1);
                const displayW = treeData.canopyRadius * 2.2;
                const displayH = treeData.trunkHeight + treeData.canopyRadius * 1.8;
                sprite.setDisplaySize(displayW, displayH);
                sprite.setDepth(treeData.sortY);
                phaserScene.visualTrees.add(sprite);
                treeData.visualSprite = sprite;
                if (typeof phaserScene.registerStaticSunShadow === 'function') {
                    treeData._sunShadow = phaserScene.registerStaticSunShadow({
                        x,
                        y,
                        radius: collisionRadius,
                        height: treeData.height,
                        maxOffset: 72,
                        depth: sprite.depth - 0.1,
                    });
                    sprite.setData('sunShadow', treeData._sunShadow);
                }
            }
            this._phaserVisualsEnabled = true;
        }
    },
    /**
     * 移除指定半径内的树木
     * @param {number} cx - 中心X
     * @param {number} cy - 中心Y
     * @param {number} radius - 半径
     * @returns {number} 移除的树木数量
     */
    removeTreesInRadius(cx, cy, radius) {
        let removed = 0;
        for (let i = this.trees.length - 1; i >= 0; i--) {
            const t = this.trees[i];
            const dx = t.x - cx;
            const dy = t.y - cy;
            if (Math.sqrt(dx * dx + dy * dy) <= radius) {
                if (t.visualSprite) {
                    t.visualSprite.destroy();
                }
                if (t.phaserBody) {
                    t.phaserBody.destroy();
                }
                this.trees.splice(i, 1);
                removed++;
            }
        }
        return removed;
    },
    /**
     * 寻找安全的生成位置：若 (x,y) 被阻挡，则沿螺旋方向外推直到找到合法点
     * @param {number} x - 初始 X
     * @param {number} y - 初始 Y
     * @param {number} radius - 实体碰撞半径
     * @param {number} [maxAttempts=8] - 最大尝试次数
     * @returns {{x:number, y:number}} 安全坐标
     */
    findSafeSpawn(x, y, radius, maxAttempts = 8) {
        if (this.canMoveTo(x, y, radius)) return { x, y };
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const angle = (Math.PI * 2 * attempt) / maxAttempts;
            const dist = radius * attempt * 0.8;
            const tx = x + Math.cos(angle) * dist;
            const ty = y + Math.sin(angle) * dist;
            if (this.canMoveTo(tx, ty, radius)) return { x: tx, y: ty };
        }
        return { x, y };
    },
    getTreesInView(vx, vy, vw, vh) {
        const result = [];
        for (const t of this.trees) {
            if (t.x + t.radius > vx && t.x - t.radius < vx + vw && t.y + t.radius > vy && t.y - t.radius < vy + vh) result.push(t);
        }
        return result;
    },
    renderTrees(ctx, cameraX, cameraY) {
        if (this._phaserVisualsEnabled) return;
        const trees = this.getTreesInView(cameraX, cameraY, CONFIG.VIEW_WIDTH, CONFIG.VIEW_HEIGHT);
        trees.sort((a, b) => (a.sortY || a.y) - (b.sortY || b.y));
        for (const t of trees) {
            const sx = t.x - cameraX;
            const sy = t.y - cameraY;
            const trunkW = t.trunkWidth || t.radius * 0.6;
            const trunkH = t.trunkHeight || t.radius * 2;
            const canopyR = t.canopyRadius || t.radius * 1.2;
            // 绘制树干（棕色矩形）
            ctx.fillStyle = '#5a3a1a';
            ctx.fillRect(sx - trunkW / 2, sy - trunkH, trunkW, trunkH);
            // 树干高光
            ctx.fillStyle = '#4a2a0a';
            ctx.fillRect(sx - trunkW / 2 + 2, sy - trunkH, 2, trunkH);
            // 绘制树冠（绿色圆形）
            ctx.fillStyle = '#2d8a3e';
            ctx.beginPath();
            ctx.arc(sx, sy - trunkH - canopyR * 0.3, canopyR, 0, Math.PI * 2);
            ctx.fill();
            // 树冠高光
            ctx.fillStyle = '#3da84e';
            ctx.beginPath();
            ctx.arc(sx - canopyR * 0.2, sy - trunkH - canopyR * 0.5, canopyR * 0.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
};


export { WallSystem, ISO_WALL_GEO, ISO_WALL_HEIGHT };
