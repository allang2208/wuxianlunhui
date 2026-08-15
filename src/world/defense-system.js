/**
 * 世界-122 防守地图系统（雏形，2026-08-04）
 *
 * 玩法设计（业内防守玩法第一版，后续打磨）：
 * - 地图边界布置刷怪点，按「怪物类型 × 权重」加权随机生成可移动怪物（站桩单位不生成）；
 * - 怪物锁定基地/防御塔（_preferDefenseTargets），持续向基地核心发起进攻；
 * - 防御塔：独立装备栏，可装载「除手枪外的远程武器」；弹道/开火特效直接复用现有
 *   Combatant.fireProjectile + 枪口火焰/弹壳特效；每发伤害参考玩家六维属性；
 * - 升级：玩家支付金币升级（攻击/耐久成长），升级费用指数递增。
 */
import { Game } from '../game.js';
import { WallSystem } from './wall-system.js';
import { pathFinder } from '../ai/pathfinder.js';
import { Combatant } from '../entities/combatant.js';
import { DamageableEntity } from '../entities/damageable-entity.js';
import { getAmmoConfig } from '../config/gun-ammo.js';
import {
    BlackWolf, ZombieDogEnemy, ZombieWizard, Mutant3, SpitterZombie, FatZombie,
    Zombie, ArmoredKnight, Shounao, FlySwarm, FlyHand, PoisonMaggot, MinerZombie,
    LanternMinerZombie, ForemanZombie, OreSpider, Witch,
} from '../entities/enemy-types.js';
import { WEAPON_ATTACK_CONFIG, createAttackFromConfig } from '../config/weapon-attack-config.js';
import { GoldManager } from '../systems/gold-manager.js';
import { EquipManager } from '../ui/equip-manager.js';
import { EffectManager } from '../effects/effect-manager.js';
import { EffectFactory } from '../utils/effect-factory.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { SoundManager } from '../ui/sound-manager.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { BasePanel } from '../ui/panels/base-panel.js';
import { Renderer } from './renderer.js';
import { SceneManager } from './scene-manager.js';
import { loadImage } from '../utils/image-loader.js';
import equipmentJson from '../../data/equipment.json';

// ==================== 配置 ====================

export const DEFENSE_CONFIG = {
    mapName: '世界-122',
    base: {
        x: 900, y: 2048, // 2026-08-05：不再贴左墙，留出空间（周围是 1024 宽菱形房）
        hp: 5000, radius: 72, def: 90, mdef: 90,
    },
    // 掩体（可被攻击的防御墙段，def/mdef 均为 0）：F→A 六档生命值，
    // 每组含水平摆(_h)/垂直摆(_v)两张贴图（30° 底边斜向互为镜像）
    covers: {
        hp: { F: 400, E: 700, D: 1100, C: 1600, B: 2200, A: 3000 },
        // 预置掩体环由 _buildBaseRoom() 生成（基地菱形房，2026-08-05 修正版）
        layout: [],
    },
    // 基地菱形房（2026-08-05 修正版 v2）：四边用新掩体墙（可被攻击，def/mdef=0），
    // 夹角按预制件 26.57° 参考（ry/rx = 0.5，与地板透视一致，见 tools/wall-room-sim.py）；
    // h="\"（TR/LB 边）、v="/"（TL/RB 边）；开口在 RB 边中点，只此一处。
    // 拼接规则（skill 沉淀）：face 线步长 = (176, ±87) − 40px 端帽叠合 ≈ (140, ∓69)，
    // 相邻件 face 重叠 40px（端帽完全叠合互盖，无缝隙）；cornerExtend 让边链端帽越过顶点，
    // 转角由相邻两边端帽互相叠盖，实心无洞。
      room: {
          enabled: true,
          rx: 512,            // 房间宽 = 2*rx = 1024
          ry: 256,            // ry/rx = 0.5（墙底边斜率 0.5）
          coverGrade: 'D',
          // 边链 face 向两端顶点各延伸的量（2026-08-08 修正：按真实投影计算后
          // 该值才是实际越界量；45 过大导致转角侵入式叠合 ~147px）。
          // 29 = 两臂 face 端点正好在角点 face 交线交点相接（干净斜接，不侵入），
          // 墙体本体仍靠 17px 端帽叠盖保证转角实心。按 rx/ry=2 菱形算得，
          // 改房间比例需重算（面线相对边线有垂直偏移）。
          cornerExtend: 29,
          // 转角图层：'rightOnTop' = 右侧臂盖左侧臂（上角 TR 盖 TL、下角 RB 盖 LB；
          // 2026-08-08 上夹角 A/B 实机对比 + GLM：右盖左砖纹连贯、无暗缝）；
          // 'leftOnTop' = 旧行为（上角 TL 盖 TR、下角 LB 盖 RB）
          cornerLayer: 'rightOnTop',
          openEdge: 'RB',
          openRadius: 90,     // 开放带半宽：face 命中该带的边链件跳过 → 居中门洞 ≈270（沿边）
          doorAlignY: 0,      // 新拼接规则下门柱底边与墙线天然共线，无需旧版下移精调
      },
    // 无预置防御塔（玩家用 B 建筑面板自行摆放）
    towers: [],
    tower: {
        hp: 1400, radius: 44, def: 70, mdef: 70,
        maxLevel: 10,
        baseCost: 120, costGrowth: 1.55,
        // 摧毁后重建 / 出售（2026-08-14）：重建 = 原建造能源价；出售返还 50% 建造能源
        rebuildCost: 300,
        sellRefundRatio: 0.5,
        // 塔等级伤害成长：等级仅作为"解锁门槛 + 小幅增益"，主要成长走模块（2026-08-07）
        levelDamageMul: 0.06,
        // 模块位：Lv1 开 3 个，之后每 2 级 +1，Lv9 满 7 个（模块总数 6 + 预留 1）
        moduleSlots: { base: 3, stepEveryLevels: 2, stepIncrease: 1, max: 7 },
        // 升级模块（数据驱动；per = 每级效果量，正数为增益倍率/百分比，负数为减益）
        modules: {
            damage:    { name: '伤害强化', icon: '⚔️', per: 0.10, maxLevel: 5, baseCost: 150, costGrowth: 1.45, desc: '每发伤害 +{pct}%' },
            range:     { name: '射程增强', icon: '🎯', per: 0.12, maxLevel: 4, baseCost: 130, costGrowth: 1.45, desc: '射程 +{pct}%' },
            attackSpd: { name: '速射模块', icon: '⚡', per: -0.08, maxLevel: 5, baseCost: 140, costGrowth: 1.45, desc: '攻击间隔 -{pct}%' },
            reload:    { name: '快速换弹', icon: '🔁', per: -0.10, maxLevel: 4, baseCost: 100, costGrowth: 1.45, desc: '换弹时间 -{pct}%' },
            overheat:  { name: '过热抑制', icon: '🌡️', per: 0.12, maxLevel: 4, baseCost: 120, costGrowth: 1.45, desc: '过热时间 +{pct}%' },
            cooling:   { name: '快速散热', icon: '❄️', per: -0.12, maxLevel: 4, baseCost: 120, costGrowth: 1.45, desc: '过热冷却 -{pct}%' },
        },
    },
    // 修理（2026-08-14）：掩体/防御塔受伤后，靠近按住 E 消耗背包能源持续修理。
    // hpPerEnergy = 每点能源可修复的 HP（掩体 2HP/能、塔 3HP/能）；tickHp = 每 tick 修复量上限。
    repair: {
        range: 150,
        coverHpPerEnergy: 2,
        towerHpPerEnergy: 3,
        tickMs: 100,
        tickHp: 25,
    },
    spawn: {
        // 2026-08-14 离散波次重构（用户要求）：
        // 进入世界-122 后 30s 准备期（怪物不进攻）→ 第 1 波一次性刷 batch → 清空 → 10s 休息 → 下一波…
        prepMs: 30000,          // 准备期：30s 后怪物才开始进攻
        waveBreakMs: 10000,     // 波间休息（修塔/建掩体窗口）
        maxAlive: 40,
        baseCount: 6,           // 离散波批量 = baseCount + wave × countPerWave（第1波 8 只，封顶 24）
        countPerWave: 2,
        countCap: 24,
        hpPerWave: 0.16,
        atkPerWave: 0.08,
        alertRange: 3800,
        // 防守局内金币经济（2026-08-07）：击杀掉落走本倍率（怪物标 _noGoldDrop，
        // 不走地面掉落物，直接进背包），随波次成长；精英 ×2 / 领主 ×3
        goldDropMul: 6,
        goldRandomMin: 1,
        goldRandomMax: 8,
        // 精英/领主定时刷（仅在波次战斗阶段，在普通波次之上额外生成）
        eliteEveryMs: 30000,
        lordEveryMs: 90000,
        eliteHpMul: 1.4,
        lordHpMul: 2.8,
        // 胜利结算（2026-08-14）：第 victoryWave 波清空即防守胜利，发放奖励
        victoryWave: 10,
        victoryReward: { gold: 500, energy: 500 },
    },
    // 刷怪点：右端尽头（基地在左端 x=900 菱形房内，怪物从右往左攻）
    spawnPoints: [
        { x: 3936, y: 600 },
        { x: 3936, y: 1350 },
        { x: 3936, y: 2048 },
        { x: 3936, y: 2746 },
        { x: 3936, y: 3496 },
        { x: 3736, y: 900 },
        { x: 3736, y: 3196 },
    ],
};

/** 防御塔可装载武器（远程武器，手枪除外） */
const TOWER_WEAPON_TYPES = ['bow', 'pkm', 'akm', 'm416', 'qbz191', 'qjb201', 'shotgun', 'energy_lmg'];

/** 防御塔每发基准伤害（按武器类型；行业惯例按 DPS 反推的占位数值，后续数值打磨） */
const BASE_WEAPON_DAMAGE = { bow: 42, pkm: 6, akm: 9, m416: 8, qbz191: 10, qjb201: 7, shotgun: 10, energy_lmg: 8 };
const BASE_WEAPON_DAMAGE_BY_ID = { super90: 12, saiga12k: 10 };

// ==================== 塔升级模块：通用计算（唯一真源 DEFENSE_CONFIG.tower.modules） ====================

/** 当前等级可用的模块位数量 */
export function getTowerModuleSlots(level) {
    const s = DEFENSE_CONFIG.tower.moduleSlots || { base: 3, stepEveryLevels: 2, stepIncrease: 1, max: 7 };
    const steps = level > 1 ? Math.floor((level - 1) / s.stepEveryLevels) : 0;
    return Math.min(s.max ?? 7, (s.base ?? 3) + steps * (s.stepIncrease ?? 1));
}

/** 模块当前等级对应的效果倍率（damage/range 为增倍率，interval/reload/cooling 为减倍率，overheat 为增倍率） */
export function getTowerModuleMults(modules) {
    const m = modules || {};
    const cfg = DEFENSE_CONFIG.tower.modules || {};
    const out = {
        damage: 1, range: 1, attackInterval: 1, reload: 1, overheatTime: 1, overheatCooldown: 1,
    };
    const d = cfg.damage;    if (d && m.damage)    out.damage = 1 + d.per * m.damage;
    const r = cfg.range;     if (r && m.range)     out.range = 1 + r.per * m.range;
    const a = cfg.attackSpd; if (a && m.attackSpd) out.attackInterval = 1 + a.per * m.attackSpd;
    const rel = cfg.reload;  if (rel && m.reload)  out.reload = Math.max(0.2, 1 + rel.per * m.reload);
    const oh = cfg.overheat; if (oh && m.overheat) out.overheatTime = 1 + oh.per * m.overheat;
    const co = cfg.cooling;  if (co && m.cooling)  out.overheatCooldown = Math.max(0.2, 1 + co.per * m.cooling);
    return out;
}

/** 模块升级费用：baseCost × costGrowth^(当前等级-1) */
export function getTowerModuleCost(moduleId, currentLevel) {
    const mod = DEFENSE_CONFIG.tower.modules?.[moduleId];
    if (!mod) return 0;
    return Math.floor(mod.baseCost * Math.pow(mod.costGrowth, Math.max(0, currentLevel - 1)));
}

/** 面板用：模块当前/下一级描述文本 */
export function getTowerModuleDesc(moduleId, level) {
    const mod = DEFENSE_CONFIG.tower.modules?.[moduleId];
    if (!mod) return '';
    const pct = Math.round(Math.abs(mod.per) * 100);
    const txt = mod.desc.replace('{pct}', `${pct * level}`);
    const next = mod.desc.replace('{pct}', `${pct * Math.min(mod.maxLevel, level + 1)}`);
    return { current: txt, next, maxed: level >= mod.maxLevel };
}

/** 弹丸贴图直接复用现有武器贴图（无映射则默认曳光弹） */
const WEAPON_IMAGE_PATHS = {
    pkm: 'assets/icons/pkm_side_clean.png',
    akm: 'assets/weapons/akm-equip.png',
    qbz191: 'assets/icons/191icon.png',
    qjb201: 'assets/icons/201-icon.png',
    energy_lmg: 'assets/icons/devotion-icon.png',
    super90: 'assets/icons/M4s90_icon.png',
    saiga12k: 'assets/icons/S12k-icon.png',
    bow: 'assets/icons/bow_icon.png',
};

/** 防御塔开火音效（按武器类型；无则静音） */
const TOWER_FIRE_SOUNDS = {
    pkm: 'assets/sounds/weapons/pkm_half_sec.wav',
    akm: 'assets/sounds/weapons/akm_burst.mp3',
    qbz191: 'assets/sounds/weapons/qbz191_shot6_valley.mp3',
    qjb201: 'assets/sounds/weapons/qjb201_single_600ms.wav',
    m416: 'assets/sounds/weapons/m416_fire.wav',
    energy_lmg: 'assets/sounds/weapons/apex_shot_600ms.wav',
    super90: 'assets/sounds/weapons/apex2_shot_1s.wav',
    saiga12k: 'assets/sounds/weapons/apex2_shot_1s.wav',
    bow: 'assets/sounds/bow/arrow_whoosh_sharp.wav',
};

/** 刷怪池（只含可移动怪物；站桩单位不生成）。
 * 普通怪 = 常规流；精英 30s 一刷；领主 90s 一刷（在普通流之上额外生成）。 */
const NORMAL_POOL = [
    { type: 'zombie', weight: 16 },
    { type: 'minerZombie', weight: 12 },
    { type: 'fatZombie', weight: 11 },
    // 僵尸犬已移除（2026-08-15）：该类是唯一不合并 enemyConfigData 的怪，
    // 无配置构造时名字兜底成「测试敌人」+ 贴图却是僵尸犬——世界-122 防守刷出的
    // 「测试怪物」残留根因。用户要求删除，不再进防守刷怪池。
    { type: 'blackWolf', weight: 9 },
    { type: 'spitterZombie', weight: 7 },
    { type: 'flySwarm', weight: 7 },
];
const ELITE_POOL = [
    { type: 'lanternMinerZombie', weight: 5 },
    { type: 'oreSpider', weight: 5 },
    { type: 'zombieWizard', weight: 4 },
    { type: 'armoredKnight', weight: 4 },
    { type: 'poisonMaggot', weight: 4 },
    { type: 'mutant3', weight: 3 },
];
const LORD_POOL = [
    { type: 'foremanZombie', weight: 4 },
    { type: 'shounao', weight: 4 },
    { type: 'flyHand', weight: 3 },
    { type: 'witch', weight: 3 },
];

const MONSTER_FACTORY = {
    zombie: Zombie,
    minerZombie: MinerZombie,
    fatZombie: FatZombie,
    zombieDog: ZombieDogEnemy,
    blackWolf: BlackWolf,
    spitterZombie: SpitterZombie,
    flySwarm: FlySwarm,
    lanternMinerZombie: LanternMinerZombie,
    oreSpider: OreSpider,
    zombieWizard: ZombieWizard,
    armoredKnight: ArmoredKnight,
    poisonMaggot: PoisonMaggot,
    mutant3: Mutant3,
    foremanZombie: ForemanZombie,
    shounao: Shounao,
    flyHand: FlyHand,
    witch: Witch,
};

/** 掩体贴图内容框宽高比（2026-08-05 圆角 bevel 后复测），显示宽度统一 260，高度按比例 */
// 显示宽高比（路线 B：Blender 完整 box 棱柱 + 8 角 bevel，sizeH=259 使世界底边斜率 = 0.4976）
const COVER_ASPECT = {
    F: { h: 1.004, v: 1.004 },
    E: { h: 1.004, v: 1.004 },
    D: { h: 1.004, v: 1.004 },
    C: { h: 1.004, v: 1.004 },
    B: { h: 1.004, v: 1.004 },
    A: { h: 1.004, v: 1.004 },
};
const COVER_DISPLAY_W = 260;

/**
 * 掩体墙段底边线（face line）端点偏移（相对掩体脚底 x/y，世界像素），按级别标定。
 * 与 building-system 的吸附端点同源（贴图内容底边 = 墙段接地线）：
 * - v（"/"）：A=低端（近地），B=高端（远地）
 * - h（"\"）：镜像，A=高端，B=低端
 * 数值来源：路线 B（Blender 完整 box 棱柱 + 8 角 bevel + AI 材质纹理）渲染图底边端点标定
 * （prep-cover-render.py，2026-08-05 圆角后复标：A(-88,-21)/B(88,-108)）。
 * 完整 box 实心端帽使端帽底部与正面底边共线，拼接处脚底线连续无凸起。
 * 几何统一 → 6 级 face 完全一致，
 * 同向/跨级拼接天然共线；h 一律 = v 镜像派生。
 * 供图层排序（深度锚点 = max 底边端点 y + 12）和遮挡仲裁（junctionCorrectedDepth 面线）使用。
 */
export const COVER_FACE = {
    F: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -108 } }, h: { A: { x: -88, y: -108 }, B: { x: 88, y: -21 } } },
    E: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -108 } }, h: { A: { x: -88, y: -108 }, B: { x: 88, y: -21 } } },
    D: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -108 } }, h: { A: { x: -88, y: -108 }, B: { x: 88, y: -21 } } },
    C: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -108 } }, h: { A: { x: -88, y: -108 }, B: { x: 88, y: -21 } } },
    B: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -108 } }, h: { A: { x: -88, y: -108 }, B: { x: 88, y: -21 } } },
    A: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -108 } }, h: { A: { x: -88, y: -108 }, B: { x: 88, y: -21 } } },
};
/** 兼容旧访问（COVER_FACE.v / COVER_FACE.h）：默认取 D 级 */
COVER_FACE.v = COVER_FACE.D.v;
COVER_FACE.h = COVER_FACE.D.h;

/**
 * 玩家摆放掩体的碰撞 footprint（墙段底部判定面积，参考 WallSystem 障碍物 foot 口径）：
 * 墙段 face 从 (x±88, y-21..y-108) → 沿墙段 ±thick 的轴对齐 AABB 198×133，
 * 中心上移 offY=-68（对准墙段主体）。thick = 墙厚一半（52 世界 → 26）。
 * v/h 是镜像，AABB 相同。colliderOffsetY 让矩形中心对准墙段（旧 46×300 竖矩形
 * 只有视觉 26% 宽且偏下，怪物可穿墙段大部分——用户反馈"障碍物根本没碰撞体积"根因）。
 * 注意：线段碰撞（_canPlace / isoSegments）必须用 thick（26），不能用
 * min(collisionWidth, collisionHeight)（会把 140 当墙厚 → 140px 空气墙，吸附右侧被拒）。
 */
export const COVER_FOOT = {
    v: { w: 198, d: 133, offY: -68, thick: 26 },
    h: { w: 198, d: 133, offY: -68, thick: 26 },
};

/**
 * 防御塔视觉几何（2026-08-04 从塔图分离标定，arm 贴图本地坐标）：
 * - 塔基座贴图 = 塔图去掉顶部机械臂（正面平视，170×262 显示，footOffsetY 131）；
 * - 机械臂贴图 = 从塔图裁出的顶部臂区（347×64），枢轴=塔顶中心 (173,64)，
 *   臂尖挂载点=(331,5)；臂显示按宽度 170 等比缩放（s≈0.49）；
 * - pivotWorldY：枢轴世界 Y 相对塔脚底的偏移（≈塔可见顶面）。
 */
export const DEFENSE_TOWER_VISUAL = {
    base: { w: 170, h: 262, footOffsetY: 131 },
    arm: {
        // 2026-08-14 预渲染 3D 旋转帧：Blender 绕塔顶轴渲染 48 帧（7.5°×48），
        // 每帧真等距透视（肘关节/前臂随角度真实转动），游戏按 aimAngle 选帧显示，
        // 不再对单帧贴图做 2D 旋转。标定见 tools/prep-defense-tower-frames.py。
        w: 137,
        h: 86,
        s: 137 / 261,
        frames: 48,
        frameW: 261,
        frameH: 164,
        pivot: { x: 131, y: 82 }, // 帧内枢轴像素（竖枢轴柱投影，各帧恒定）
        pivotWorldY: 235,
        // 臂尖椭圆路径（模型单位，等距投影：x 全量、y 按 0.5 缩短）：
        // tipOX = gameScale*k*reach*cosθ；tipOY = gameScale*k*(0.5*reach*sinθ - 0.866*dz)
        // （θ=aimAngle，游戏 y 向下；2026-08-14 修正下半区枪口落到塔顶的符号 bug）
        reach: 50,
        dz: 0,
        k: 2.56,
        gameScale: 0.524691,
        naturalAngle: 0,
    },
    weapon: {
        // 挂载武器显示高度（按高度等比缩放，与玩家枪械 setScale 口径一致；朝左 flipY）
        // 2026-08-14：按新短臂（70px 高）等比缩小约 40%
        heights: { bow: 48, pkm: 40, akm: 38, m416: 38, qbz191: 37, qjb201: 40, shotgun: 42, energy_lmg: 40 },
        defaultHeight: 36,
        // 枪管裁剪（"枪插进机械臂"假象，2026-08-14）：武器贴图只取前 1/3 枪管段，
        // 切口端（origin x=0）对齐臂尖，看起来枪管从机械臂/钩子里伸出。
        // 纹理坐标 = 贴图内枪管段裁剪框；height = 枪管显示厚度（游戏px，对齐臂梁 ~11px）。
        // 按 weaponId 配置（霰弹 super90/saiga12k 同 type 不同贴图必须区分）；
        // 未配置的武器（如弓）退回整枪渲染（heights）。
        barrel: {
            weapon6:  { x: 1326, y: 950,  w: 619, h: 149, height: 11 }, // PKM
            weapon7:  { x: 1337, y: 884,  w: 623, h: 183, height: 11 }, // AKM
            weapon21: { x: 1334, y: 828,  w: 623, h: 193, height: 11 }, // M416
            weapon8:  { x: 1335, y: 586,  w: 625, h: 251, height: 12 }, // QBZ-191
            weapon11: { x: 1325, y: 916,  w: 619, h: 151, height: 11 }, // QJB-201
            weapon12: { x: 1335, y: 1010, w: 625, h: 175, height: 12 }, // Super90
            weapon13: { x: 1335, y: 500,  w: 625, h: 283, height: 14 }, // SAIGA-12K
            weapon15: { x: 1335, y: 886,  w: 625, h: 381, height: 16 }, // 能量轻机枪
        },
    },
};

// ==================== 基地核心 ====================

class DefenseBase extends Combatant {
    constructor(x, y, config = {}) {
        super(x, y, {
            faction: 'player',
            hp: config.hp ?? DEFENSE_CONFIG.base.hp,
            maxHp: config.maxHp ?? DEFENSE_CONFIG.base.hp,
            size: config.size ?? 46,
            collisionRadius: config.radius ?? DEFENSE_CONFIG.base.radius,
            name: config.name ?? '基地核心',
        });
        this.id = config.id || 'defense_base';
        this._isDefenseStructure = true;
        this.noSeparation = true;
        this.immovable = true; // 基地核心同掩体口径：不可被击退/移动（2026-08-14 补齐）
        this.noNameLabel = true; // 名字/HP 走 _syncNeutralEntities 的贴图标签（避免与 HUD 重复）
        this._noShadow = true;   // 障碍物取消脚底阴影（贴图自带接地底座，无投影）
        const def = config.def ?? DEFENSE_CONFIG.base.def;
        const mdef = config.mdef ?? DEFENSE_CONFIG.base.mdef;
        this.def = def;
        this.mdef = mdef;
        this.data.def = def;
        this.data.mdef = mdef;
        // 贴图直接用现有素材（大理石祭坛）
        this.spriteCfg = { idleKey: 'npc_altar', size: 220, sizeH: 214, footOffsetY: 107 };
        this.footOffsetY = 107;
        this._onDestroyed = config.onDestroyed || null;
        this.rebuildCollider();
    }

    takeDamage(damage, source, damageType, isMelee) {
        const wasAlive = this.hp > 0;
        super.takeDamage(damage, source, damageType, isMelee);
        if (wasAlive && this.hp <= 0) {
            this.active = false;
            if (typeof this._onDestroyed === 'function') this._onDestroyed(this);
        }
    }

    update(dt) {
        super.update(dt);
    }
}

// ==================== 防御塔 ====================

// ==================== 掩体（可被攻击的防御墙段）====================

class DefenseCover extends Combatant {
    constructor(x, y, config = {}) {
        const grade = config.grade || 'F';
        const orient = config.orient || 'h';
        // 有效朝向：镜像（F）只翻贴图，视觉方向 = 逻辑方向 h/v 互换。
        // 吸附端点、碰撞 footprint、底边线（face line）一律按有效朝向取，
        // 保证「镜像后拼接吸附 + 碰撞体积跟随视觉」一致（2026-08-05 优化）。
        const mirror = !!config.mirror;
        const eff = mirror ? (orient === 'v' ? 'h' : 'v') : orient;
        const hp = config.hp ?? (DEFENSE_CONFIG.covers.hp[grade] ?? 400);
        super(x, y, {
            faction: 'player',
            hp,
            maxHp: hp,
            size: config.size ?? 60,
            collisionRadius: 26,
            name: config.name ?? `掩体·${grade}级`,
        });
        this.id = config.id || `defense_cover_${grade}_${orient}_${Math.random().toString(36).slice(2, 7)}`;
        this._isDefenseStructure = true;
        this.noSeparation = true;
        this.noNameLabel = true;
        this._noShadow = true;   // 障碍物取消脚底阴影
        this.immovable = true; // 掩体不可被击退/移动（任何位移通道一律无效）
        // 掩体不设置任何防御/魔法防御（怪物可攻击，伤害全额结算）
        this.def = 0;
        this.mdef = 0;
        this.data.def = 0;
        this.data.mdef = 0;
        // 矩形 footprint（长边=有效朝向的水平/垂直摆方向），供怪物碰撞与近战判定；
        // 镜像后 h/v 互换，避免“视觉横墙、碰撞竖矩形”错位
        const foot = (config.w && config.d)
            ? (mirror ? { w: config.d, d: config.w } : { w: config.w, d: config.d })
            : (COVER_FOOT[eff] || COVER_FOOT[orient] || COVER_FOOT.v);
        this.collisionShape = 'rect';
        this.collisionWidth = foot.w;
        this.collisionHeight = foot.d;
        this.colliderOffsetY = foot.offY ?? 0; // 矩形中心对准墙段主体（匹配视觉）
        this._coverHalfThick = foot.thick ?? 26; // 墙厚一半（线段碰撞/阻挡宽度用）
        this.grade = grade;
        this.orient = orient;
        this._facingLeft = mirror; // 镜像：中立精灵渲染 flipX
        // 图层深度锚点：按墙段底边线（贴图接地线）的 max 端点 y + 12。
        // 注意不能用 e.y+12：e.y 是贴图显示框底边，比接地线深 22~137px（贴图内容
        // 在框内偏上），会导致“墙前实体（脚线在接地线之下、但仍在 e.y 之上）被
        // 错误排到墙后被盖”——2026-08-05 实机复现（怪物 depth 2100 < 掩体 2121）。
        const face = (COVER_FACE[grade] && COVER_FACE[grade][eff])
            || COVER_FACE.D[eff] || COVER_FACE.D.v;
        if (face) {
            this._faceLine = [
                { x: x + face.A.x, y: y + face.A.y },
                { x: x + face.B.x, y: y + face.B.y },
            ];
            // depthBias：上夹角左臂（TL 边）加 0.5，让左臂盖住右臂（TR），
            // 否则两臂 faceDepth 相同 + TL 先建 → 右挡左（2026-08-06 用户反馈）
            this._faceDepth = Math.max(this._faceLine[0].y, this._faceLine[1].y) + 12 + (config.depthBias || 0);
        } else {
            this._faceDepth = y + 12;
        }
        // 墙段 face 线段注册进 WallSystem.isoSegments：怪物移动/投射物/寻路自动被
        // 墙段阻挡（与成功案例墙段/门闸同管线，skill #33 冰墙经验）。
        // halfThick = 墙厚一半（52 世界 → 26），阻挡宽度匹配视觉墙厚。
        if (WallSystem && WallSystem.isoSegments && this._faceLine) {
            this._coverSeg = {
                x1: this._faceLine[0].x, y1: this._faceLine[0].y,
                x2: this._faceLine[1].x, y2: this._faceLine[1].y,
                halfThick: this._coverHalfThick,
                _cover: true,
                _owner: this, // 回链：怪物被挡路时转火本掩体（movement-system 卡住检测用）
            };
            WallSystem.isoSegments.push(this._coverSeg);
            // [PERF-2026-08-08] 掩体墙段注册后只局部失效该线段周边（bbox 外扩 800px 由
            // invalidateRegion 内部处理），不再核弹级全清——世界-122 掩体增删频繁，
            // 全清会让全部怪的路径/格子缓存集体冷启动
            if (pathFinder && typeof pathFinder.invalidateRegion === 'function') {
                const s = this._coverSeg;
                pathFinder.invalidateRegion(
                    Math.min(s.x1, s.x2), Math.min(s.y1, s.y2),
                    Math.max(s.x1, s.x2), Math.max(s.y1, s.y2)
                );
            }
          }
          // 贴图：随机变体库（2026-08-05）——同档 5 个高度类似变体随机选，防单调：
        // v1=定稿（无后缀）；v2~v5=细节微调变体（A 级符文形态随机替换）。
        // 变体 2~5 同时入库 _v/_h 两向；镜像仍由 flipX 派生（视觉方向跟随镜像）。
        // 变体 2~5 同时入库 _v/_h 两向；镜像仍由 flipX 派生（视觉方向跟随镜像）
        const variant = 1 + Math.floor(Math.random() * 5);
        const tex = variant === 1
            ? `obstacle_cover_${grade}_${orient}`
            : `obstacle_cover_${grade}_v${variant}_${orient}`;
        const aspect = (COVER_ASPECT[grade] && COVER_ASPECT[grade][orient]) || 1;
        const sizeH = Math.round(COVER_DISPLAY_W / aspect);
        this.spriteCfg = { idleKey: tex, size: COVER_DISPLAY_W, sizeH, footOffsetY: sizeH / 2 };
        this.footOffsetY = sizeH / 2;
        this.rebuildCollider();
    }

    takeDamage(damage, source, damageType, isMelee) {
        const wasAlive = this.hp > 0;
        super.takeDamage(damage, source, damageType, isMelee);
        if (wasAlive && this.hp <= 0) {
            this.active = false;
            this.removeFromCollision();
            if (EffectManager) {
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '掩体被摧毁', '#ff8855'));
            }
        }
    }

    /** 从 WallSystem.isoSegments 移除本墙段（销毁/场景清理时调用） */
    removeFromCollision() {
        if (this._coverSeg && WallSystem && WallSystem.isoSegments) {
            const i = WallSystem.isoSegments.indexOf(this._coverSeg);
            if (i >= 0) WallSystem.isoSegments.splice(i, 1);
              // [PERF-2026-08-08] 局部失效前先取线段 bbox（随后 _coverSeg 置空）；
              // 只清该线段周边缓存，不再全清（掩体被摧毁在世界-122 高频发生）
              const s = this._coverSeg;
              this._coverSeg = null;
            if (pathFinder && typeof pathFinder.invalidateRegion === 'function') {
                pathFinder.invalidateRegion(
                    Math.min(s.x1, s.x2), Math.min(s.y1, s.y2),
                    Math.max(s.x1, s.x2), Math.max(s.y1, s.y2)
                );
            }
          }
      }

    update(dt) {
        super.update(dt);
    }
}

class DefenseTower extends Combatant {
    constructor(x, y, config = {}) {
        super(x, y, {
            faction: 'player',
            hp: config.hp ?? DEFENSE_CONFIG.tower.hp,
            maxHp: config.maxHp ?? DEFENSE_CONFIG.tower.hp,
            size: config.size ?? 30,
            collisionRadius: config.radius ?? DEFENSE_CONFIG.tower.radius,
            name: config.name ?? '防御塔 Lv.1',
        });
        this.id = config.id || `defense_tower_${Math.random().toString(36).slice(2, 8)}`;
        this._isDefenseStructure = true;
        this._noShadow = true;   // 障碍物取消脚底阴影
        this._isDefenseTower = true;
        this._skipNeutralSprite = true; // 塔由 GameScene._syncDefenseTowers 三层渲染（基座/臂/武器）
        this.noSeparation = true;
        this.immovable = true; // 防御塔同掩体口径：不可被击退/移动（2026-08-14 补齐）
        const def = config.def ?? DEFENSE_CONFIG.tower.def;
        const mdef = config.mdef ?? DEFENSE_CONFIG.tower.mdef;
        this.def = def;
        this.mdef = mdef;
        this.data.def = def;
        this.data.mdef = mdef;
        // 贴图：世界-122 防御塔（2026-08-12 Blender 圆柱塔基 + 机械臂，纯色参考版；
        // 内容框 324×498，显示 170×262）
        this.spriteCfg = { idleKey: 'obstacle_defense_tower', size: 170, sizeH: 262, footOffsetY: 131 };
        this.footOffsetY = 131;
        this.level = 1;
        this.maxLevel = DEFENSE_CONFIG.tower.maxLevel;
        this.weaponItem = null;
        this._attackKey = null;
        this.range = 800;
        // 升级模块状态：{ moduleId: level }，等级解锁模块位（2026-08-07）
        this.modules = {};
        this._currentSpreadFactor = 0.08;
        this._currentSpreadMaxAngle = 7;
        // 机械臂朝向（世界角，y 向下；自然姿态=臂贴图原始朝向）
        this.aimAngle = DEFENSE_TOWER_VISUAL.arm.naturalAngle;
        this._aimTargetPos = null;
        this.rebuildCollider();
    }

    /** 当前可用模块位数量（由塔等级决定） */
    getModuleSlots() {
        return getTowerModuleSlots(this.level);
    }

    /** 已解锁（已购买）模块数 */
    getPurchasedModuleCount() {
        return Object.keys(this.modules || {}).length;
    }

    /** 该模块是否可购买：有模块位且未满级 */
    canUpgradeModule(moduleId) {
        const mod = DEFENSE_CONFIG.tower.modules?.[moduleId];
        if (!mod) return false;
        const cur = this.modules[moduleId] || 0;
        if (cur >= mod.maxLevel) return false;
        // 已占用的模块位 = 已有等级≥1 的模块数（未购买模块不占位）
        const occupied = Object.keys(this.modules || {}).length;
        return occupied < this.getModuleSlots();
    }

    getModuleCost(moduleId) {
        return getTowerModuleCost(moduleId, this.modules[moduleId] || 0);
    }

    /** 当前模块倍率表 */
    moduleMults() {
        return getTowerModuleMults(this.modules);
    }

    /** 玩家支付金币升级模块；成功则重算所有武器参数 */
    upgradeModule(moduleId, player) {
        const mod = DEFENSE_CONFIG.tower.modules?.[moduleId];
        if (!mod) return { ok: false, reason: '未知模块' };
        const cur = this.modules[moduleId] || 0;
        if (cur >= mod.maxLevel) return { ok: false, reason: '模块已满级' };
        if (!this.canUpgradeModule(moduleId)) return { ok: false, reason: '模块位不足，请先升级防御塔等级' };
        const cost = this.getModuleCost(moduleId);
        if (!GoldManager || !GoldManager.deductGold(cost)) return { ok: false, reason: '金币不足' };
        this.modules[moduleId] = cur + 1;
        // 重算武器参数（伤害/射速/射程/换弹）
        if (this.weaponItem && this._attackKey) {
            this._applyModuleWeaponParams();
        }
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        return { ok: true, cost, moduleId, level: this.modules[moduleId] };
    }

    /** 将模块倍率应用到武器参数（射程/射速/换弹），在升级模块或装载武器后调用 */
    _applyModuleWeaponParams() {
        if (!this.weaponItem || !this._attackKey) return;
        const mults = this.moduleMults();
        const atk = this.attacks[this._attackKey];
        const atkCfg = this.weaponItem.attack || {};
        // 射程：基础配置 × 模块倍率
        const baseRange = atkCfg.range || atk.config?.projectileRange || 900;
        this.range = Math.round(baseRange * mults.range);
        // 射速：基础间隔 × 模块倍率（保留原冷却语义，baseMaxCooldown 同步）
        if (atkCfg.attackInterval) {
            const interval = Math.max(80, Math.round(atkCfg.attackInterval * mults.attackInterval));
            atk.config.cooldown = interval;
            atk.maxCooldown = interval;
            atk.baseMaxCooldown = interval;
        }
        // 换弹：由 _initAmmoForSlot 覆盖统一处理（读模块倍率）
        if (this._ammoState && this._ammoState.weapon) {
            const st = this._ammoState.weapon;
            st.reloadTime = Math.max(120, Math.round(st.reloadTime * mults.reload));
            if (!st.reloading) st.reloadTimer = 0;
        }
    }

    /** 换弹时间覆盖：基础弹药配置 × 模块倍率（与玩家口径一致：读 _craftEffects 后乘模块） */
    _initAmmoForSlot(slot) {
        super._initAmmoForSlot(slot);
        if (slot !== 'weapon' || !this._ammoState || !this._ammoState.weapon) return;
        const st = this._ammoState.weapon;
        st.reloadTime = Math.max(120, Math.round(st.reloadTime * this.moduleMults().reload));
    }

    /** 弹药存在判定（玩家口径）：弹匣有剩余且非换弹中 */
    _hasAmmo(slot) {
        if (!this._ammoState || !this._ammoState[slot]) {
            this._initAmmoForSlot(slot);
        }
        const state = this._ammoState && this._ammoState[slot];
        return state && state.current > 0 && !state.reloading;
    }

    /** 消耗 1 发弹药；打空自动进入换弹 */
    _consumeAmmo(slot) {
        const state = this._ammoState && this._ammoState[slot];
        if (!state || state.current <= 0) return false;
        state.current--;
        if (state.current <= 0) {
            this._startReload(slot);
        }
        return true;
    }

    /** 换弹守卫：换弹中/满弹不重复触发（基类会无条件重置换弹计时，
     *  否则 canFire 每帧自动换弹导致永远装不完） */
    _startReload(slot) {
        const state = this._ammoState && this._ammoState[slot];
        if (!state || state.reloading || state.current >= state.max) return false;
        const started = super._startReload(slot);
        if (started) {
            // 单发装填标记（Super90 管仓式：一次一发；玩家口径读 getAmmoConfig）
            const item = this.equipments && this.equipments[slot];
            const ammoCfg = getAmmoConfig(item);
            state.singleReloadMode = !!(ammoCfg && ammoCfg.singleReloadMode);
        }
        return started;
    }

    /** 换弹推进（2026-08-15 Super90 重设计）：单发装填一次一发、装满才停；
     *  装填中 canFire 拦截 → "没有装满不开火"。普通武器仍一次装满。 */
    _updateReload(dt) {
        const state = this._ammoState && this._ammoState.weapon;
        if (!state || !state.reloading) return;
        state.reloadTimer -= dt;
        if (state.reloadTimer <= 0) {
            state.reloadTimer = 0;
            if (state.singleReloadMode) {
                state.current = Math.min(state.max, state.current + 1);
                if (state.current >= state.max) {
                    state.reloading = false;
                    state.singleReloadMode = false;
                } else {
                    state.reloadTimer = state.reloadTime; // 继续装下一发
                }
            } else {
                state.reloading = false;
                state.current = state.max;
            }
        }
    }

    /** 过热/散热模块倍率：Combatant._updateOverheat 读 weapon.heatParams，此处按模块倍率改写后委托 */
    _updateOverheat(dt, isFiring) {
        const weapon = this.getCurrentWeapon ? this.getCurrentWeapon() : (this.weaponItem || null);
        if (!weapon) return;
        const mults = this.moduleMults();
        const hp = weapon.heatParams || {};
        const ohTime = Math.max(500, hp.overheatTime || 5000);
        const cooldownTime = Math.max(500, hp.overheatCooldownTime || hp.overheatRecoverTime || 1500);
        const recoverTime = Math.max(500, hp.overheatRecoverTime || hp.overheatCooldownTime || 1500);
        weapon.heatParams = {
            ...hp,
            overheatTime: ohTime * mults.overheatTime,
            overheatCooldownTime: cooldownTime * mults.overheatCooldown,
            overheatRecoverTime: recoverTime * mults.overheatCooldown,
        };
        super._updateOverheat(dt, isFiring);
        // 还原，避免污染武器配置
        weapon.heatParams = hp;
    }

    /** 是否防御塔可装载武器（远程武器，手枪除外） */
    static isTowerWeapon(item) {
        return !!item && item.category === 'weapon_ranged' && TOWER_WEAPON_TYPES.includes(item.weaponType);
    }

    _resolveAttackKey(item) {
        if (item.attackKey) return item.attackKey;
        if (item.weaponType === 'shotgun') return item.weaponId === 'saiga12k' ? 'saiga12k' : 'super90';
        if (item.weaponType === 'bow') return 'ranged';
        return item.weaponType;
    }

    /** 装载武器（从背包取出后调用；返回是否成功） */
    equipWeapon(item) {
        if (!DefenseTower.isTowerWeapon(item)) return false;
        this.weaponItem = item;
        this.equipments.weapon = item;
        this.weaponMode = 'weapon';
        const attackKey = this._resolveAttackKey(item);
        this._attackKey = attackKey;
        // 写回攻击键：Combatant.fireProjectile 内部按 item.attackKey || item.weaponType 查表，
        // 霰弹枪（weaponType=shotgun）/弓（bow）无同名键，必须让物品携带解析后的攻击键
        item.attackKey = attackKey;
        if (!this.attacks[attackKey]) {
            const cfg = WEAPON_ATTACK_CONFIG[attackKey] || WEAPON_ATTACK_CONFIG.ranged;
            this.attacks[attackKey] = createAttackFromConfig(cfg);
        }
        // 攻击间隔/射程：读装备 attack 配置（覆盖攻击配置占位值）
        const atkCfg = item.attack || {};
        if (atkCfg.attackInterval) {
            this.attacks[attackKey].config.cooldown = atkCfg.attackInterval;
            this.attacks[attackKey].maxCooldown = atkCfg.attackInterval;
            this.attacks[attackKey].baseMaxCooldown = atkCfg.attackInterval;
        }
        this.range = atkCfg.range || this.attacks[attackKey].config.projectileRange || 900;
        // 弹药初始化（Combatant 默认无限弹药；枪械弹匣状态仅供换弹动画/节奏使用）
        this._initAmmoForSlot('weapon');
        // 升级模块倍率应用到武器参数（射程/射速/换弹）
        this._applyModuleWeaponParams();
        // 弹丸贴图直接复用现有武器贴图（无则默认曳光弹）
        const path = WEAPON_IMAGE_PATHS[item.weaponId] || WEAPON_IMAGE_PATHS[item.weaponType];
        if (path) this.weaponImages[item.weaponType] = loadImage(path);
        this._recalcDamage(typeof window !== 'undefined' && window.Game ? window.Game.player : null);
        return true;
    }

    /** 卸下武器（返回被卸下的物品） */
    unequipWeapon() {
        if (!this.weaponItem) return null;
        const item = this.weaponItem;
        this.weaponItem = null;
        this.equipments.weapon = null;
        this._attackKey = null;
        this.range = 800;
        return item;
    }

    _baseDamageFor(item) {
        return BASE_WEAPON_DAMAGE_BY_ID[item.weaponId] || BASE_WEAPON_DAMAGE[item.weaponType] || 6;
    }

    /** 玩家六维属性加成（防御塔参考玩家属性，后续数值打磨） */
    _statMul(player) {
        const d = player && player.data ? player.data : {};
        return 1
            + (d.str || 10) * 0.008
            + (d.dex || 10) * 0.010
            + (d.int || 10) * 0.006
            + (d.wis || 10) * 0.006
            + (d.con || 10) * 0.004
            + (d.luck || 10) * 0.004;
    }

    _computeDamage(player, level) {
        if (!this.weaponItem) return 0;
        const base = this._baseDamageFor(this.weaponItem);
        const levelMul = 1 + (level - 1) * DEFENSE_CONFIG.tower.levelDamageMul;
        const moduleMul = this.moduleMults().damage;
        return Math.max(1, Math.round(base * this._statMul(player) * levelMul * moduleMul));
    }

    _recalcDamage(player) {
        if (!this._attackKey || !this.attacks[this._attackKey]) return;
        const dmg = this._computeDamage(player, this.level);
        this.attacks[this._attackKey].config.damage = { min: dmg, max: dmg };
    }

    getUpgradeCost() {
        return Math.floor(DEFENSE_CONFIG.tower.baseCost * Math.pow(DEFENSE_CONFIG.tower.costGrowth, this.level - 1));
    }

    getPreviewDamage(player) {
        return {
            current: this._computeDamage(player, this.level),
            next: this._computeDamage(player, Math.min(this.level + 1, this.maxLevel)),
        };
    }

    /** 玩家支付金币升级 */
    upgrade(player) {
        if (this.level >= this.maxLevel) return { ok: false, reason: '防御塔已满级' };
        const cost = this.getUpgradeCost();
        if (!GoldManager || !GoldManager.deductGold(cost)) return { ok: false, reason: '金币不足' };
        this.level += 1;
        // 升级提升耐久（防御塔自身成长）
        const newMax = Math.round(this.maxHp * 1.12);
        this.maxHp = newMax;
        this.data.maxHp = newMax;
        this.hp = Math.min(newMax, Math.round(this.hp + newMax * 0.3));
        this.data.hp = this.hp;
        this.name = `防御塔 Lv.${this.level}`;
        this._recalcDamage(player);
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        return { ok: true, cost, level: this.level };
    }

    _acquireTarget(entities) {
        let best = null;
        let bestD = Infinity;
        const arr = entities && entities.values ? Array.from(entities.values()) : (Array.isArray(entities) ? entities : []);
        for (const e of arr) {
            if (!e || e === this || !e.active || e.hp <= 0) continue;
            if (e._faction !== 'enemy') continue;
            if (typeof e.x !== 'number' || typeof e.y !== 'number') continue;
            const d = Math.hypot(e.x - this.x, e.y - this.y);
            if (d > this.range) continue;
            // 索敌视线：真实墙壁仍阻挡，但己方掩体墙段不阻挡——防御塔可越过己方掩体射击（2026-08-14）
            if (WallSystem && typeof WallSystem.blocked === 'function') {
                const coverIgnore = WallSystem.isoSegments
                    ? { segs: new Set(WallSystem.isoSegments.filter((s) => s && s._cover)) }
                    : null;
                if (WallSystem.blocked(this.x, this.y, e.x, e.y, coverIgnore)) continue;
            }
            if (d < bestD) {
                bestD = d;
                best = e;
            }
        }
        return best;
    }

    _fireAtTarget(target, entities) {
        if (!this.weaponItem || !this._attackKey) return;
        const attack = this.attacks[this._attackKey];
        if (!attack || !attack.canUse()) return;
        const aimX = target.x;
        const aimY = (target.collider ? target.collider.y : target.y) - 40;
        if (this.weaponItem.weaponType === 'shotgun') {
            // 散弹：一次击发 = 1 发弹壳，多发弹丸共享一个枪口 + 一次特效（2026-08-15 修复）
            const pellets = this.weaponItem.pelletCount || (this.weaponItem.weaponId === 'saiga12k' ? 4 : 6);
            this._fireBlast(aimX, aimY, entities, pellets);
        } else {
            this._fireShot(aimX, aimY, entities);
        }
    }

    /** 枪口点 = 枪管尖端（椭圆臂尖 + 枪管长度，与渲染同口径；墙体回退忽略己方掩体段） */
    _muzzlePoint() {
        const V = DEFENSE_TOWER_VISUAL;
        const pivotX = this.x;
        const pivotY = this.y - V.arm.pivotWorldY;
        const m = this._mirrored ? -1 : 1;
        const tipOX = V.arm.gameScale * V.arm.k * V.arm.reach * Math.cos(this.aimAngle) * m;
        const tipOY = V.arm.gameScale * V.arm.k * (0.5 * V.arm.reach * Math.sin(this.aimAngle) - 0.866 * V.arm.dz);
        const barrelCfg = V.weapon.barrel && this.weaponItem && (V.weapon.barrel[this.weaponItem.weaponId] || V.weapon.barrel[this.weaponItem.weaponType]);
        let wAng = Math.atan2(0.5 * V.arm.reach * Math.sin(this.aimAngle) - 0.866 * V.arm.dz, V.arm.reach * Math.cos(this.aimAngle));
        if (this._mirrored) wAng = Math.PI - wAng;
        const muzzleLen = barrelCfg ? barrelCfg.w * (barrelCfg.height / barrelCfg.h) : 16;
        const rootInset = barrelCfg ? (barrelCfg.inset ?? 7) : 0;
        let mx = pivotX + tipOX + Math.cos(wAng) * (muzzleLen - rootInset);
        let my = pivotY + tipOY + Math.sin(wAng) * (muzzleLen - rootInset);
        const ox = this.x;
        const oy = this.y;
        // 枪口回退只针对真实墙壁：己方掩体段不参与（塔可越掩体射击）——
        // 否则 resolve 会把枪口沿掩体段滑回塔脚（"下沉到底座" bug，2026-08-14 修复）
        if (WallSystem && typeof WallSystem.resolve === 'function') {
            const coverIgnore = WallSystem.isoSegments
                ? { segs: new Set(WallSystem.isoSegments.filter((s) => s && s._cover)) }
                : null;
            const wallBlockedOnly = WallSystem.blocked(ox, oy, mx, my, coverIgnore);
            if (wallBlockedOnly) {
                const resolved = WallSystem.resolve(ox, oy, mx, my, 4);
                mx = resolved.x;
                my = resolved.y;
            }
        }
        return { mx, my };
    }

    /** 枪口特效（火焰/开火火光/弹壳/音效）——散弹一次击发只播一次 */
    _muzzleEffects(mx, my, aimX, aimY) {
        const angle = Math.atan2(aimY - my, aimX - mx);
        EffectFactory.createMuzzleFlash(mx, my, angle, 1.4);
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (scene && typeof scene.playMuzzleFire === 'function') {
            scene.playMuzzleFire(mx, my);
        }
        EffectFactory.createShellCasing(mx, my, angle, this.y);
        const snd = TOWER_FIRE_SOUNDS[this.weaponItem ? this.weaponItem.weaponId : ''] || TOWER_FIRE_SOUNDS[this.weaponItem ? this.weaponItem.weaponType : ''];
        if (snd && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(snd);
        }
    }

    /** 单发开火：枪口偏移 + 墙体回退 + 弹丸（复用 Combatant.fireProjectile）+ 枪口特效 */
    _fireShot(aimX, aimY, entities) {
        if (!this._attackKey || !this.attacks[this._attackKey]) return false;
        const p = this._muzzlePoint();
        const mx = p.mx, my = p.my;
        const ox = this.x;
        const oy = this.y;
        this.x = mx;
        this.y = my;
        const fired = this.fireProjectile(aimX, aimY, entities, { slot: 'weapon' });
        this.x = ox;
        this.y = oy;
        if (!fired) return false;
        this._muzzleEffects(mx, my, aimX, aimY);
        return true;
    }

    /** 散弹一次击发：多发弹丸共享一个枪口、扣 1 发弹壳、播一次特效（2026-08-15 修复） */
    _fireBlast(aimX, aimY, entities, pelletCount) {
        if (!this._attackKey || !this.attacks[this._attackKey]) return false;
        const p = this._muzzlePoint();
        const mx = p.mx, my = p.my;
        const ox = this.x;
        const oy = this.y;
        const attack = this.attacks[this._attackKey];
        this.x = mx;
        this.y = my;
        let fired = false;
        for (let i = 0; i < pelletCount; i++) {
            attack.cooldown = 0; // 弹丸间不互相挡冷却
            const jx = aimX + (Math.random() - 0.5) * 90;
            const jy = aimY + (Math.random() - 0.5) * 90;
            if (this.fireProjectile(jx, jy, entities, { slot: 'weapon', noAmmoConsume: true })) fired = true;
        }
        this.x = ox;
        this.y = oy;
        if (!fired) return false;
        this._consumeAmmo('weapon'); // 一次击发 = 1 发弹壳
        this._muzzleEffects(mx, my, aimX, aimY);
        return true;
    }

    /** 机械臂瞄准：向目标最短弧平滑旋转；无目标回自然姿态 */
    _updateAim(dt, target) {
        const V = DEFENSE_TOWER_VISUAL;
        let desired = V.arm.naturalAngle;
        if (target && target.active) {
            const pivotY = this.y - V.arm.pivotWorldY;
            desired = Math.atan2(target.y - pivotY, target.x - this.x);
        }
        let diff = desired - this.aimAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const speed = target && target.active ? 9 : 4; // rad/s
        const maxStep = speed * (dt / 1000);
        this.aimAngle += Math.max(-maxStep, Math.min(maxStep, diff));
    }

    /** 塔被摧毁：停火、停止渲染、从实体分离中移除（怪物可穿过废墟）；登记废墟供重建 */
    takeDamage(damage, source, damageType, isMelee) {
        const wasAlive = this.hp > 0;
        super.takeDamage(damage, source, damageType, isMelee);
        if (wasAlive && this.hp <= 0) {
            this.active = false;
            this.hittable = false;
            if (DefenseSystem && typeof DefenseSystem._onTowerDestroyed === 'function') {
                DefenseSystem._onTowerDestroyed(this);
            }
        }
    }

    update(dt, entities) {
        super.update(dt);
        if (!this.active || this.hp <= 0) return;
        if (!this.weaponItem || !this._attackKey) return;
        const attack = this.attacks[this._attackKey];
        if (!attack) return;
        attack.update(dt);
        if (typeof this._updateReload === 'function') this._updateReload(dt);
        this._recalcDamage(typeof window !== 'undefined' && window.Game ? window.Game.player : null);
        const target = this._acquireTarget(entities);
        this._updateAim(dt, target);
        // 过热驱动（与玩家"持续开火"口径一致）：有目标 + 有弹 + 非换弹 + 未过热才算开火中；
        // 冷却（attack.canUse）不参与——机枪连续压制时枪管持续升温
        const isFiring = !!(target && target.active
            && this._hasAmmo('weapon')
            && !this._isReloading('weapon')
            && !(this._overheatOverheated && this.weaponItem && this.weaponItem.weaponType === this._overheatWeaponType));
        if (typeof this._updateOverheat === 'function') this._updateOverheat(dt, isFiring);
        if (target) {
            this._aimTargetPos = {
                x: target.x,
                y: (target.collider ? target.collider.y : target.y) - 40,
            };
            this._fireAtTarget(target, entities);
        }
    }
}

// ==================== 防御塔废墟（摧毁后可重建）====================

class DefenseTowerRuin extends DamageableEntity {
    constructor(x, y, tower) {
        super(x, y, {
            faction: 'neutral', // 中立：怪物不锁定（_isValidTarget 只看 player 阵营）
            hp: 1, maxHp: 1,
            size: 44,
            collisionRadius: 30,
            name: '防御塔废墟',
        });
        this._isTowerRuin = true;
        this.ruinFor = tower;
        this.hittable = false;       // 不可被攻击
        this.immovable = true;
        this.noSeparation = true;
        this._noShadow = true;
        this.noNameLabel = true;
        this.spriteCfg = { idleKey: 'tower_ruin', size: 96, sizeH: 60, footOffsetY: 30 };
        this.footOffsetY = 30;
    }
}

// ==================== 防御塔面板 ====================

class DefenseTowerPanel extends BasePanel {
    constructor() {
        super({ id: 'defenseTowerPanel', className: 'defense-tower-panel', stateKey: 'defenseTower' });
        this.tower = null;
        this.player = null;
    }

    buildContent(el) {
        el.style.cssText = [
            'position:fixed;right:26px;top:50%;transform:translateY(-50%);width:410px;',
            'background:rgba(16,15,13,0.97);border:2px solid #6a5a3a;border-radius:10px;',
            'padding:16px 18px;color:#d4c5a9;font-family:SimHei,"Microsoft YaHei",sans-serif;',
            'box-shadow:0 8px 30px rgba(0,0,0,0.65);z-index:9000;',
        ].join('');
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div id="dtTitle" style="font-size:18px;font-weight:700;color:#ffd700;"></div>
                <div style="display:flex;gap:8px;">
                    <button id="dtSell" style="background:#3a2820;color:#ffc9a0;border:1px solid #6a4a2a;border-radius:6px;padding:4px 10px;cursor:pointer;">出售</button>
                    <button id="dtClose" style="background:#3a3228;color:#d4c5a9;border:1px solid #6a5a3a;border-radius:6px;padding:4px 12px;cursor:pointer;">关闭</button>
                </div>
            </div>
            <div id="dtWeaponSlot" style="border:1px dashed #6a5a3a;border-radius:8px;padding:10px;margin-bottom:10px;background:rgba(0,0,0,0.25);"></div>
            <div style="font-size:13px;color:#9a8a6a;margin-bottom:6px;">可装载武器（背包 · 远程 · 手枪除外）</div>
            <div id="dtWeaponList" style="max-height:210px;overflow-y:auto;border:1px solid #3a3528;border-radius:8px;padding:4px 8px;margin-bottom:12px;"></div>
            <div id="dtUpgrade" style="border:1px solid #4a4a2a;border-radius:8px;padding:10px;background:rgba(60,50,20,0.18);"></div>
            <div id="dtModules" style="margin-top:10px;border:1px solid #3a4a5a;border-radius:8px;padding:10px;background:rgba(20,40,60,0.18);"></div>
            <div id="dtStatHint" style="margin-top:8px;font-size:12px;color:#8a8a8a;"></div>
        `;
        el.querySelector('#dtClose').addEventListener('click', () => this.close());
    }

    openFor(tower, player) {
        this.ruin = null;
        this.tower = tower;
        this.player = player;
        this.open();
        this.refresh();
    }

    /** 废墟模式：展示重建入口（2026-08-14） */
    openForRuin(ruin, player) {
        this.tower = null;
        this.ruin = ruin;
        this.player = player;
        this.open();
        this.refresh();
    }

    onOpen() {
        this.refresh();
        if (this.el) this.el.style.display = 'block';
    }

    onClose() {
        if (this.el) this.el.style.display = 'none';
        this.tower = null;
        this.ruin = null;
        this.player = null;
    }

    _notify(text, color) {
        const player = this.player || (typeof window !== 'undefined' && window.Game ? window.Game.player : null);
        if (player) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, text, color || '#d4c5a9'));
        }
    }

    _equip(tower, item, _player) {
        const bp = EquipManager.backpackItems || [];
        const idx = bp.indexOf(item);
        if (idx >= 0) bp.splice(idx, 1);
        if (tower.equipWeapon(item)) {
            this._notify(`${item.name} 已装载到防御塔`, '#ffd700');
        } else {
            bp.push(item);
            this._notify('该武器无法装载（仅限远程武器，手枪除外）', '#ff5555');
        }
        this.refresh();
    }

    _unequip(tower, _player) {
        const item = tower.weaponItem;
        if (!item) return;
        if (EquipManager.addToBackpack(item)) {
            tower.unequipWeapon();
            this._notify(`${item.name} 已卸下`, '#8a9aff');
        } else {
            this._notify('背包已满，无法卸下', '#ff5555');
        }
        this.refresh();
    }

    _upgrade(tower, _player) {
        const player = _player || (typeof window !== 'undefined' && window.Game ? window.Game.player : null);
        const res = tower.upgrade(player);
        if (res.ok) {
            this._notify(`防御塔升级至 Lv.${res.level}`, '#ffd700');
        } else {
            this._notify(res.reason, '#ff5555');
        }
        this.refresh();
    }

    _upgradeModule(tower, moduleId, _player) {
        const player = _player || (typeof window !== 'undefined' && window.Game ? window.Game.player : null);
        const res = tower.upgradeModule(moduleId, player);
        if (res.ok) {
            this._notify(`模块已升级：${DEFENSE_CONFIG.tower.modules[moduleId].name} Lv.${res.level}`, '#8ad0ff');
        } else {
            this._notify(res.reason, '#ff5555');
        }
        this.refresh();
    }

    refresh() {
        const el = this.el;
        if (!el) return;
        if (this.ruin) {
            this._refreshRuin();
            return;
        }
        if (!this.tower) return;
        const t = this.tower;
        const player = this.player || (typeof window !== 'undefined' && window.Game ? window.Game.player : null);
        el.querySelector('#dtTitle').textContent = t.name;

        // 武器槽
        const slot = el.querySelector('#dtWeaponSlot');
        slot.innerHTML = '';
        if (t.weaponItem) {
            const it = t.weaponItem;
            const dmg = t.getPreviewDamage(player).current;
            slot.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <div style="font-weight:700;">${it.icon || '🔫'} ${it.name}</div>
                        <div style="font-size:12px;color:#9a9a9a;">每发伤害 ≈ ${dmg}（已含六维加成）</div>
                    </div>
                    <button id="dtUnequip" style="background:#5a3028;color:#ffd7d0;border:1px solid #8a4a3a;border-radius:6px;padding:4px 10px;cursor:pointer;">卸下</button>
                </div>`;
            slot.querySelector('#dtUnequip').addEventListener('click', () => this._unequip(t, player));
        } else {
            slot.innerHTML = '<div style="color:#8a8a8a;font-size:13px;">未装备武器 —— 从下方列表选择一件远程武器（手枪除外）</div>';
        }

        // 可装载武器列表（背包）
        const list = el.querySelector('#dtWeaponList');
        list.innerHTML = '';
        const weapons = (EquipManager.backpackItems || []).filter(i => DefenseTower.isTowerWeapon(i));
        if (weapons.length === 0) {
            list.innerHTML = '<div style="color:#8a8a8a;padding:8px;">背包中没有可装载的远程武器（手枪除外）</div>';
        }
        weapons.forEach((it) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:6px 2px;border-bottom:1px solid #2e2a22;';
            const dmg = t._computeDamage(player, t.level);
            row.innerHTML = `<span>${it.icon || '🔫'} ${it.name} <span style="color:#8a8a8a;font-size:12px;">(${dmg}/发)</span></span>
                <button style="background:#3a5a3a;color:#d4ffd0;border:1px solid #5a8a5a;border-radius:6px;padding:3px 10px;cursor:pointer;">装载</button>`;
            row.querySelector('button').addEventListener('click', () => this._equip(t, it, player));
            list.appendChild(row);
        });

        // 升级
        const up = el.querySelector('#dtUpgrade');
        const maxed = t.level >= t.maxLevel;
        const cost = t.getUpgradeCost();
        const gold = GoldManager ? GoldManager.getGold() : 0;
        const preview = t.getPreviewDamage(player);
        up.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <div><span style="color:#ffd700;font-weight:700;">等级 ${t.level}</span>${maxed ? '（已满级）' : ` → ${t.level + 1}`}</div>
                <div style="font-size:12px;color:#9a9a9a;">耐久 ${Math.ceil(t.hp)}/${t.maxHp}</div>
            </div>
            ${maxed
                ? '<div style="font-size:13px;color:#c8b98a;">防御塔已满级。</div>'
                : `<div style="font-size:13px;color:#c8b98a;margin-bottom:8px;">
                    每发伤害 ${preview.current} → ${preview.next} · 升级费用 <span style="color:#ffd700;">${cost} 金币</span>（持有 ${gold}）
                  </div>
                  <button id="dtUpgradeBtn" style="width:100%;background:#4a3a1a;color:#ffe9a0;border:1px solid #8a7a3a;border-radius:6px;padding:7px 0;cursor:pointer;">升级防御塔</button>`}`;
        if (!maxed) {
            up.querySelector('#dtUpgradeBtn').addEventListener('click', () => this._upgrade(t, player));
        }

        // 升级模块（等级解锁模块位，模块独立升级）
        const modBox = el.querySelector('#dtModules');
        const slots = t.getModuleSlots();
        const purchased = t.getPurchasedModuleCount();
        const modRows = Object.entries(DEFENSE_CONFIG.tower.modules || {}).map(([mid, mod]) => {
            const lv = t.modules[mid] || 0;
            const desc = getTowerModuleDesc(mid, lv);
            const maxedMod = lv >= mod.maxLevel;
            const canBuy = t.canUpgradeModule(mid);
            const cost = t.getModuleCost(mid);
            const lockReason = !canBuy && !maxedMod ? '需升级防御塔等级解锁模块位' : '';
            const btn = maxedMod
                ? '<span style="color:#8a8a8a;font-size:12px;">已满级</span>'
                : canBuy
                    ? `<button data-mod="${mid}" style="background:#2a4a6a;color:#c8e8ff;border:1px solid #4a7a9a;border-radius:6px;padding:3px 10px;cursor:pointer;">升级 ${cost}金</button>`
                    : `<span style="color:#7a6a5a;font-size:11px;">🔒 ${lockReason}</span>`;
            return `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #22303a;gap:8px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:13px;color:#d4e8ff;">${mod.icon} ${mod.name} <span style="color:#8ad0ff;">Lv.${lv}/${mod.maxLevel}</span></div>
                        <div style="font-size:11px;color:#8a9a9a;">${desc.current}</div>
                    </div>
                    <div style="flex-shrink:0;">${btn}</div>
                </div>`;
        }).join('');
        modBox.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:13px;font-weight:700;color:#8ad0ff;">升级模块</span>
                <span style="font-size:12px;color:#9a9a9a;">模块位 ${purchased}/${slots}（塔 Lv.${t.level}）</span>
            </div>
            ${modRows || '<div style="font-size:12px;color:#8a8a8a;">暂无模块</div>'}`;
        modBox.querySelectorAll('[data-mod]').forEach((btn) => {
            btn.addEventListener('click', () => this._upgradeModule(t, btn.dataset.mod, player));
        });

        // 六维参考
        const d = player && player.data ? player.data : {};
        el.querySelector('#dtStatHint').textContent =
            `六维加成参考：力量 ${d.str ?? 10} / 敏捷 ${d.dex ?? 10} / 体质 ${d.con ?? 10} / 智力 ${d.int ?? 10} / 精神 ${d.wis ?? 10} / 幸运 ${d.luck ?? 10}`;
        // 出售（2026-08-14）：返还 50% 建造能源，武器归还背包
        const sellBtn = el.querySelector('#dtSell');
        if (sellBtn) {
            sellBtn.style.display = '';
            const refund = Math.floor((DEFENSE_CONFIG.tower.rebuildCost ?? 300) * (DEFENSE_CONFIG.tower.sellRefundRatio ?? 0.5));
            sellBtn.title = `出售返还 ${refund} 能源（武器归还背包）`;
            sellBtn.onclick = () => {
                const res = DefenseSystem.sellTower(t, player);
                this._notify(res.ok ? `已出售（+${res.refund} 能源）` : res.reason, res.ok ? '#ffd700' : '#ff5555');
                this.refresh();
            };
        }
    }

    /** 废墟模式面板：展示重建入口（2026-08-14） */
    _refreshRuin() {
        const el = this.el;
        const ruin = this.ruin;
        if (!el || !ruin) return;
        const t = ruin.ruinFor;
        el.querySelector('#dtTitle').textContent = '防御塔废墟';
        el.querySelector('#dtWeaponSlot').innerHTML = `<div style="color:#c8b98a;font-size:13px;">防御塔已被摧毁。</div>`;
        el.querySelector('#dtWeaponList').innerHTML = '';
        const cost = DEFENSE_CONFIG.tower.rebuildCost ?? 300;
        const energy = EnergyManager ? EnergyManager.getEnergy() : 0;
        const up = el.querySelector('#dtUpgrade');
        up.innerHTML = `
            <div style="font-size:13px;color:#c8b98a;margin-bottom:8px;">
                重建后等级/模块/武器（${t && t.weaponItem ? `${t.weaponItem.icon || '🔫'} ${t.weaponItem.name}` : '未装载'}）全部保留<br>
                重建费用 <span style="color:#7fd4ff;">${cost} 能源</span>（持有 ${energy}）
            </div>
            <button id="dtRebuildBtn" style="width:100%;background:#2a4a3a;color:#d0ffd0;border:1px solid #4a8a5a;border-radius:6px;padding:7px 0;cursor:pointer;">重建防御塔</button>`;
        up.querySelector('#dtRebuildBtn').addEventListener('click', () => {
            const res = DefenseSystem.rebuildTower(ruin, this.player);
            this._notify(res.ok ? `重建完成（-${res.cost} 能源）` : res.reason, res.ok ? '#9dff9d' : '#ff5555');
            this.refresh();
        });
        el.querySelector('#dtModules').innerHTML = '';
        el.querySelector('#dtStatHint').textContent = '';
        const sellBtn = el.querySelector('#dtSell');
        if (sellBtn) sellBtn.style.display = 'none';
    }
}

// ==================== 防守系统 ====================

export const DefenseSystem = {
    active: false,
    defeated: false,
    victory: false,     // 防守胜利（清完 victoryWave 波，2026-08-14）
    _victoryGranted: false,
    base: null,
    towers: [],
    ruins: [],          // 被摧毁的防御塔（废墟实体，供重建）
    // 离散波次状态机（2026-08-14）：'prep' 准备期 → 'wave' 战斗中 → 'break' 波间休息
    _phase: 'prep',
    _wave: 0,
    _phaseTimer: 0,
    _hudEl: null,
    _hudTimer: 0,
    _spawnTimer: 0,
    _eliteTimer: 0,
    _lordTimer: 0,
    _elapsed: 0,
    _seq: 0,
    _goldGranted: null,
    _panel: null,
    // 修理状态（E 键长按，2026-08-14）
    _repairHeld: false,
    _repairTimer: 0,
    _repairTarget: null,
    _repairFlash: 0,

    _ensurePanel() {
        if (!this._panel) this._panel = new DefenseTowerPanel();
        return this._panel;
    },

    setup(player) {
        this.teardown();
        this.active = true;
        this.defeated = false;
        this.victory = false;
        this._victoryGranted = false;
        this._ensureTowerRuinTexture();
        this._elapsed = 0;
        // 离散波次：准备期 30s（怪物不进攻），波号从 1 起
        this._phase = 'prep';
        this._wave = 0;
        this._phaseTimer = DEFENSE_CONFIG.spawn.prepMs;
        this._eliteTimer = 0;
        this._lordTimer = 0;
        this._seq = 0;
        this._goldGranted = new Set();
        this._buildBaseRoom();

        const baseCfg = DEFENSE_CONFIG.base;
        const core = new DefenseBase(baseCfg.x, baseCfg.y, { onDestroyed: () => this._onBaseDestroyed() });
        Game.entities.set('defense_base', core);
        this.base = core;

        this.towers = [];
        DEFENSE_CONFIG.towers.forEach((p, i) => {
            const tower = new DefenseTower(p.x, p.y, { id: `defense_tower_${i}` });
            Game.entities.set(`defense_tower_${i}`, tower);
            this.towers.push(tower);
        });

        // 原型演示：1 号塔预装 PKM（其余塔由玩家从背包装载；卸下会归还背包）
        this._presetTowerWeapon(this.towers[0], 'pkm');
        // 掩体防线（可被攻击，def/mdef=0）
          (DEFENSE_CONFIG.covers.layout || []).forEach((c, i) => {
              const cover = new DefenseCover(c.x, c.y, {
                  grade: c.grade,
                  orient: c.orient,
                  w: c.w,
                  d: c.d,
                  depthBias: c.depthBias,
                  id: `defense_cover_${i}`,
              });
              Game.entities.set(`defense_cover_${i}`, cover);
          });
          // 掩体墙段已注册进 WallSystem.isoSegments：让寻路器把静态掩体墙纳入
          // 阻挡网格（怪物绕墙走/从门洞进，不再直线穿墙后在夹角被卡），2026-08-08
          if (pathFinder && typeof pathFinder.invalidateCache === 'function') {
              pathFinder.invalidateCache();
          }

          // 顶部 HUD（波次状态 + 金币/能源实时显示）+ 开战提示（30s 准备期）
          this._createHud();
          if (player) {
              EffectManager.add(new FloatingTextEffect(player.x, player.y - 60, `世界-122 防守战开始！${Math.round(DEFENSE_CONFIG.spawn.prepMs / 1000)} 秒后怪物来袭`, '#ffd700'));
          }
    },

    /**
     * 生成基地菱形掩体环（新掩体墙，2026-08-05 v2）：
     * 四边按 h/v 方向铺放，face 线相邻件重叠 40px（端帽叠合，无缝隙），
     * 边链两端各延伸 cornerExtend，转角由相邻两边端帽互相叠盖。
     * 开口：openEdge 边中点的开放带内的件跳过 → 天然形成居中门洞。
     */
    _buildBaseRoom() {
        const room = DEFENSE_CONFIG.room;
        if (!room || !room.enabled) return;
        const b = DEFENSE_CONFIG.base;
        const T = { x: b.x, y: b.y - room.ry }, R = { x: b.x + room.rx, y: b.y },
              B = { x: b.x, y: b.y + room.ry }, L = { x: b.x - room.rx, y: b.y };
        const edges = [
            { key: 'TL', from: T, to: L, orient: 'v' },
            { key: 'TR', from: T, to: R, orient: 'h' },
            { key: 'LB', from: L, to: B, orient: 'h' },
            { key: 'RB', from: R, to: B, orient: 'v' },
        ];
        // face 线几何（6 级统一，见 COVER_FACE）：|A→B| = 196.33px，端帽叠合 40px
        const face = (COVER_FACE[room.coverGrade] && COVER_FACE[room.coverGrade].v) || COVER_FACE.D.v;
        const faceLen = Math.hypot(face.B.x - face.A.x, face.B.y - face.A.y);
        const joinOverlap = 40; // 与 building-system SNAP_OVERLAP 同源（端帽宽 ≈52 ≥ 40）
        const step = faceLen - joinOverlap; // 相邻件中心沿墙步长 ≈156.33
        const cornerExt = room.cornerExtend ?? 45;
        // 转角图层（2026-08-08）：上角 TR(h) 盖 TL(v)、下角 RB(v) 盖 LB(h) 时
        // 砖纹过渡更连贯（A/B 实机对比 + GLM）；旧行为左臂在上（TL/LB +0.5）
        const rightOnTop = room.cornerLayer !== 'leftOnTop';
        const openEdge = room.openEdge;
        const openRadius = room.openRadius ?? 90;
        const layout = [];
        for (const e of edges) {
            const dx = e.to.x - e.from.x, dy = e.to.y - e.from.y;
            const len = Math.hypot(dx, dy);
            const ux = dx / len, uy = dy / len;
            // ⚠ 2026-08-08 修正：face 端点在边方向上的投影不对称（朝顶点端
            // 127px、朝另一端 69.3px），旧代码用 faceLen/2（98px）当对称半跨，
            // 导致转角件实际越过顶点 73.8px（意图 cornerExtend），两臂在角点
            // 侵入式叠合 ~147px。这里按真实投影定首/末件位置：
            const g = (COVER_FACE[room.coverGrade] && COVER_FACE[room.coverGrade][e.orient])
                || COVER_FACE.D[e.orient] || COVER_FACE.D.v;
            const projA = g.A.x * ux + g.A.y * uy;
            const projB = g.B.x * ux + g.B.y * uy;
            // 朝顶点（t 减小方向）的端点是投影更小的一端
            const towardV = projA < projB ? 'A' : 'B';
            const halfToV = Math.abs(towardV === 'A' ? projA : projB);   // 朝顶点半跨 127
            const halfAway = Math.abs(towardV === 'A' ? projB : projA);  // 另一端半跨 69.3
            // 首件中心：朝顶点端 face 端点落在 t = −cornerExt
            const t0 = -cornerExt + halfToV;
            // 末件中心：另一端 face 端点落在 t = len + cornerExt
            const tLast = len + cornerExt - halfAway;
            // n 件均布：相邻 face 重叠 ≥ joinOverlap（spacing ≤ step）
            const span = tLast - t0;
            const n = Math.max(2, Math.ceil(span / step) + 1);
            const spacing = n > 1 ? span / (n - 1) : 0;
            const openMid = e.key === openEdge ? len / 2 : null;
            const alignY = e.key === openEdge ? (room.doorAlignY || 0) : 0;
            // 上夹角 TL/TR 边：整条边共享同一纹理变体（相邻件端帽互叠，
            // 独立随机会在接缝处出现"两层墙皮"式砖纹错位）；
            for (let i = 0; i < n; i++) {
                const t = t0 + i * spacing;
                // face 沿边区间 [t−halfToV, t+halfAway] 命中开放带则跳过（门洞）
                if (openMid !== null) {
                    const f0 = t - halfToV;
                    const f1 = t + halfAway;
                    if (f1 > openMid - openRadius && f0 < openMid + openRadius) continue;
                }
                layout.push({
                    x: Math.round(e.from.x + ux * t),
                    y: Math.round(e.from.y + uy * t) + alignY,
                    grade: room.coverGrade,
                    orient: e.orient,
                    // 图层覆盖顺序（2026-08-08 A/B 实测定稿）：
                    // - 上角 TR(h) 盖 TL(v)：TR 边 +0.5
                    // - 下角 RB(v) 盖 LB(h)：RB 边 +0.5
                    // 两臂 faceDepth 相同，偏置决定谁在上；右盖左时转角无暗缝
                    depthBias: (rightOnTop ? (e.key === 'TR' || e.key === 'RB') : (e.key === 'TL' || e.key === 'LB')) ? 0.5 : 0,
                });
            }
        }
        DEFENSE_CONFIG.covers.layout = layout;
    },

    teardown() {
        this.active = false;
        this.defeated = false;
        this.victory = false;
        this._victoryGranted = false;
        this.base = null;
        this.towers = [];
        this.ruins = [];
        this._phase = 'prep';
        this._wave = 0;
        this._phaseTimer = 0;
        this._destroyHud();
        this._spawnTimer = 0;
          this._eliteTimer = 0;
          this._lordTimer = 0;
          this._elapsed = 0;
          this._goldScanTimer = 0;
          this._aliveCountCache = undefined;
          this._aliveCountTime = 0;
          this._seq = 0;
          if (this._goldGranted) this._goldGranted.clear();
          this._goldGranted = null;
          // 掩体墙段已移除：寻路网格随之重建（怪物不再绕不存在的墙）
          if (pathFinder && typeof pathFinder.invalidateCache === 'function') {
              pathFinder.invalidateCache();
          }
          if (this._panel) {
            if (this._panel.isOpen) this._panel.close();
            this._panel.tower = null;
            this._panel.player = null;
        }
        // 场景切换时实体由 switchScene 统一清空；场景内手动 teardown 由调用方负责清理实体
    },

    _presetTowerWeapon(tower, weaponId) {
        const item = equipmentJson.equipment && equipmentJson.equipment[weaponId];
        if (!item || !tower) return;
        tower.equipWeapon(JSON.parse(JSON.stringify(item)));
    },

    update(dt) {
        if (!this.active || this.defeated) return;
        this._elapsed += dt;
        this._repairTick(dt);
        this._grantMonsterGold(dt);
        this._updateHud(dt);
        if (this.victory) return;

        // ==================== 离散波次状态机（2026-08-14）====================
        // prep（30s 准备，怪物不进攻）→ wave（一批刷出，清空才结束）→ break（10s 修整）→ 下一波
        this._phaseTimer -= dt;
        switch (this._phase) {
            case 'prep':
                if (this._phaseTimer <= 0) {
                    this._wave = 1;
                    this._startWave();
                }
                break;
            case 'wave':
                // 波内怪物全部死亡 → 波次结束：最后一波胜利，否则进入波间休息
                if (this._aliveCount() === 0) {
                    if (this._wave >= (DEFENSE_CONFIG.spawn.victoryWave || 10)) {
                        this._onVictory();
                    } else {
                        this._phase = 'break';
                        this._phaseTimer = DEFENSE_CONFIG.spawn.waveBreakMs || 10000;
                        this._announce(`第 ${this._wave} 波已清除！${Math.round(this._phaseTimer / 1000)} 秒后下一波`, '#9dff9d');
                    }
                }
                break;
            case 'break':
                if (this._phaseTimer <= 0) {
                    this._wave++;
                    this._startWave();
                }
                break;
        }
        // 精英/领主只在波次战斗阶段定时刷（普通波次之上额外生成）
        if (this._phase === 'wave') {
            this._eliteTimer += dt;
            this._lordTimer += dt;
            if (this._eliteTimer >= DEFENSE_CONFIG.spawn.eliteEveryMs) {
                this._eliteTimer = 0;
                this._spawnElite();
            }
            if (this._lordTimer >= DEFENSE_CONFIG.spawn.lordEveryMs) {
                this._lordTimer = 0;
                this._spawnLord();
            }
        }
    },

    /** 开一波：一次性刷 batch（= baseCount + wave×countPerWave，封顶 countCap，受 maxAlive 约束） */
    _startWave() {
        this._phase = 'wave';
        this._phaseTimer = 0;
        const count = Math.min(
            DEFENSE_CONFIG.spawn.countCap,
            Math.floor(DEFENSE_CONFIG.spawn.baseCount + this._wave * DEFENSE_CONFIG.spawn.countPerWave)
        );
        let alive = this._aliveCount();
        for (let i = 0; i < count; i++) {
            if (alive >= DEFENSE_CONFIG.spawn.maxAlive) break;
            this._spawnMonster(this._wave, NORMAL_POOL);
            alive++;
        }
        this._announce(`第 ${this._wave} 波来袭！`, '#ffd700');
    },

    // ==================== 顶部 HUD（波次 + 货币实时）====================

    _createHud() {
        if (typeof document === 'undefined') return;
        this._destroyHud();
        const el = document.createElement('div');
        el.className = 'defense-hud';
        el.innerHTML = '<span id="dhPhase">准备中…</span><span id="dhMoney">💰 0　⚡ 0</span>';
        document.body.appendChild(el);
        this._hudEl = el;
        this._hudTimer = 0;
    },

    _destroyHud() {
        if (this._hudEl) {
            this._hudEl.remove();
            this._hudEl = null;
        }
    },

    /** 每 250ms 刷新一次 HUD：波次阶段/倒计时/剩余数 + 金币与能源实时值 */
    _updateHud(dt) {
        if (!this._hudEl) return;
        this._hudTimer -= dt;
        if (this._hudTimer > 0) return;
        this._hudTimer = 250;
        const spawn = DEFENSE_CONFIG.spawn;
        let phaseText;
        if (this.victory) {
            phaseText = `防守胜利！撑过 ${spawn.victoryWave || 10} 波`;
        } else if (this._phase === 'prep') {
            phaseText = `准备中 · ${Math.ceil(Math.max(0, this._phaseTimer) / 1000)} 秒后怪物进攻`;
        } else if (this._phase === 'wave') {
            phaseText = `第 ${this._wave}/${spawn.victoryWave || 10} 波 · 剩余 ${this._aliveCount()} 只`;
        } else {
            phaseText = `第 ${this._wave} 波已清除 · ${Math.ceil(Math.max(0, this._phaseTimer) / 1000)} 秒后下一波`;
        }
        const gold = GoldManager ? GoldManager.getGold() : 0;
        const energy = EnergyManager ? EnergyManager.getEnergy() : 0;
        this._hudEl.innerHTML = `<span>${phaseText}</span><span>💰 ${gold}&nbsp;&nbsp;⚡ ${energy}</span>`;
    },

    /** E 键按下/松开（全局监听写入；仅世界-122 且系统激活时生效） */
    _setRepairHeld(held) {
        if (!this.active || !Game || !Game.isRunning) {
            this._repairHeld = false;
            return;
        }
        this._repairHeld = !!held;
        if (!this._repairHeld) {
            this._repairTarget = null;
            this._repairTimer = 0;
        }
    },

    /**
     * 修理 tick：按住 E 时对玩家附近最近的受伤掩体/防御塔持续修理，
     * 消耗背包能源（费率见 DEFENSE_CONFIG.repair），修满自动切目标。
     */
    _repairTick(dt) {
        this._repairFlash = Math.max(0, this._repairFlash - dt);
        if (!this._repairHeld) return;
        const player = Game.player;
        if (!player || Game._buildMode || Game._wallEditMode) return;
        const cfg = DEFENSE_CONFIG.repair;
        // 找目标：优先沿用当前目标（未满血且在范围内），否则扫最近的受伤建筑
        const targetOk = this._repairTarget && this._repairTarget.active
            && this._repairTarget.hp < this._repairTarget.maxHp
            && Math.hypot(this._repairTarget.x - player.x, this._repairTarget.y - player.y) <= cfg.range;
        if (!targetOk) {
            this._repairTarget = null;
            let best = null;
            let bestD = Infinity;
            for (const e of Game.entities.values()) {
                if (!e || !e.active) continue;
                if (e._isDefenseTower) {
                    const d = Math.hypot(e.x - player.x, e.y - player.y);
                    if (d <= cfg.range && e.hp < e.maxHp && d < bestD) { best = e; bestD = d; }
                } else if (e.orient && (e.orient === 'h' || e.orient === 'v')) {
                    // 掩体（DefenseCover：orient h/v 标识）
                    const d = Math.hypot(e.x - player.x, e.y - player.y);
                    if (d <= cfg.range && e.hp < e.maxHp && d < bestD) { best = e; bestD = d; }
                }
            }
            this._repairTarget = best;
        }
        const target = this._repairTarget;
        if (!target) {
            // 范围内没有受伤建筑：不耗能，不提示（避免刷屏）
            return;
        }
        this._repairTimer += dt;
        if (this._repairTimer < cfg.tickMs) return;
        this._repairTimer = 0;
        const hpPerEnergy = target._isDefenseTower ? cfg.towerHpPerEnergy : cfg.coverHpPerEnergy;
        const missing = target.maxHp - target.hp;
        const want = Math.min(missing, cfg.tickHp);
        const cost = Math.max(1, Math.ceil(want / hpPerEnergy));
        if (!EnergyManager || !EnergyManager.deductEnergy(cost)) {
            if (EffectManager && this._repairFlash <= 0) {
                EffectManager.add(new FloatingTextEffect(player.x, player.y - 50, '能源不足，无法修理', '#ff5555'));
                this._repairFlash = 1200;
            }
            return;
        }
        target.hp = Math.min(target.maxHp, target.hp + want);
        if (EffectManager && this._repairFlash <= 0) {
            EffectManager.add(new FloatingTextEffect(target.x, target.y - 40, `+${want} 修理`, '#7fd4ff'));
            this._repairFlash = 600;
        }
        if (target.hp >= target.maxHp) {
            if (EffectManager) {
                EffectManager.add(new FloatingTextEffect(target.x, target.y - 40, '修理完成', '#9dff9d'));
            }
            this._repairTarget = null;
        }
    },

    _aliveCount() {
        // [PERF] 计数节流：250ms 内复用缓存结果，避免每帧全表扫描 Game.entities
        const now = this._elapsed || 0;
        if (this._aliveCountCache !== undefined && now - this._aliveCountTime < 250) {
            return this._aliveCountCache;
        }
        let n = 0;
        for (const e of Game.entities.values()) {
            if (e && e._defenseMonster && e.active && e.hp > 0) n++;
        }
        this._aliveCountCache = n;
        this._aliveCountTime = now;
        return n;
    },

    /** 防守击杀金币结算：怪物死亡标记后由本钩子统一发金币（地面掉落物已按 _noGoldDrop 关闭） */
    _grantMonsterGold(dt) {
        if (!this.active || !Game || !Game.entities) return;
        // [PERF] 结算节流：每 250ms 扫描一次尸体统一发金币（金币延迟 ≤250ms 可接受）
        this._goldScanTimer = (this._goldScanTimer || 0) + (dt || 0);
        if (this._goldScanTimer < 250) return;
        this._goldScanTimer = 0;
        if (!this._goldGranted) this._goldGranted = new Set();
        const wave = this._wave || 1;
        let grantedThisFrame = 0;
        for (const e of Game.entities.values()) {
            if (!e || !e._defenseMonster || !e._noGoldDrop) continue;
            if (e.hp > 0 || e.active) continue;
            if (this._goldGranted.has(e.id)) continue;
            this._goldGranted.add(e.id);
            const cfg = DEFENSE_CONFIG.spawn;
            const base = wave * (cfg.goldDropMul || 1);
            const randMin = cfg.goldRandomMin ?? 1;
            const randMax = cfg.goldRandomMax ?? 8;
            const amount = Math.max(1, Math.round(base + (randMax > randMin ? Math.random() * (randMax - randMin) : 0)));
            if (GoldManager && typeof GoldManager.addGold === 'function') GoldManager.addGold(amount);
            if (Game.player && EffectManager) {
                EffectManager.add(new FloatingTextEffect(e.x, e.y - 30, `+${amount} 金币`, '#ffd700'));
            }
            // 建筑面板开着时同步金币显示（BuildingSystem 从未导入，typeof 恒 false，
            // 收敛为仅 window.__BuildingSystem 引用，消除 no-undef）
            const bs = typeof window !== 'undefined' ? window.__BuildingSystem : null;
            if (bs && bs._panel && typeof bs._refreshGold === 'function') {
                bs._refreshGold();
            }
            grantedThisFrame++;
            if (grantedThisFrame >= 8) break;
        }
    },

    _spawnMonster(wave, pool, hpMulExtra = 1) {
        const type = this._pickMonsterType(pool);
        const Factory = MONSTER_FACTORY[type];
        if (!Factory) return;
        const pt = DEFENSE_CONFIG.spawnPoints[Math.floor(Math.random() * DEFENSE_CONFIG.spawnPoints.length)];
        const monster = new Factory(pt.x, pt.y);
        monster._defenseMonster = true;
        // 防守击杀金币：不走地面掉落物，由 DefenseSystem 结算直接进背包
        monster._noGoldDrop = true;
        monster._defenseGoldMul = DEFENSE_CONFIG.spawn.goldDropMul || 1;
        // 防守模式：只锁定基地/防御塔（PerceptionSystem/Enemy._findNearestPlayer 已支持）
        monster._preferDefenseTargets = true;
        monster._alertRange = DEFENSE_CONFIG.spawn.alertRange;
        // aggro 归一化：pacing AI 怪（黑狼 _aggroRange 2500）出生点距基地 ~3000px，
        // aggro 小于 alertRange 会原地踱步不进场；统一抬到 alertRange（ai.defenseAggroRange 可覆盖）
        const defAggro = (monster.ai && monster.ai.defenseAggroRange) || DEFENSE_CONFIG.spawn.alertRange;
        if (monster._aggroRange && monster._aggroRange < defAggro) {
            monster._aggroRange = defAggro;
        }
        // 波次成长：HP/攻击随波次提升
        const hpMul = (1 + (wave - 1) * DEFENSE_CONFIG.spawn.hpPerWave) * hpMulExtra;
        const atkMul = 1 + (wave - 1) * DEFENSE_CONFIG.spawn.atkPerWave;
        monster.maxHp = Math.max(1, Math.round(monster.maxHp * hpMul));
        monster.hp = monster.maxHp;
        if (monster.data) {
            monster.data.maxHp = monster.maxHp;
            monster.data.hp = monster.maxHp;
            if (monster.data.atk) monster.data.atk = Math.max(1, Math.round(monster.data.atk * atkMul));
            if (monster.data.matk) monster.data.matk = Math.max(1, Math.round(monster.data.matk * atkMul));
        }
        Game.entities.set(`defense_monster_${++this._seq}`, monster);
    },

    _spawnElite() {
        this._spawnMonster(this._wave || 1, ELITE_POOL, DEFENSE_CONFIG.spawn.eliteHpMul);
        this._announce('精英来袭！', '#ff8800', 'assets/sounds/enemies/armored_knight/attacking.mp3');
    },

    _spawnLord() {
        this._spawnMonster(this._wave || 1, LORD_POOL, DEFENSE_CONFIG.spawn.lordHpMul);
        this._announce('领主降临！', '#ff4444', 'assets/sounds/enemies/foreman_zombie/howling.mp3');
    },

    _announce(text, color, soundPath) {
        if (Game.player) {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 60, text, color || '#ffd700'));
        }
        if (soundPath && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(soundPath);
        }
    },

    _pickMonsterType(pool) {
        const list = pool || NORMAL_POOL;
        const total = list.reduce((sum, m) => sum + m.weight, 0);
        let roll = Math.random() * total;
        for (const m of list) {
            roll -= m.weight;
            if (roll <= 0) return m.type;
        }
        return list[0].type;
    },

    _onBaseDestroyed() {
        if (this.defeated) return;
        this.defeated = true;
        if (Game.player) {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 50, '基地核心被摧毁！防守失败', '#ff5555'));
        }
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/enemies/amalgam/dying.mp3');
        }
        if (this._panel && this._panel.isOpen) this._panel.close();
    },

    // ==================== 塔摧毁/重建/出售（2026-08-14）====================

    /** 塔被摧毁：登记废墟实体（可点击重建）；武器保留在塔上（重建后复原） */
    _onTowerDestroyed(tower) {
        const i = this.towers.indexOf(tower);
        if (i >= 0) this.towers.splice(i, 1);
        const ruin = new DefenseTowerRuin(tower.x, tower.y, tower);
        ruin.id = `tower_ruin_${tower.id || Math.random().toString(36).slice(2, 6)}`;
        Game.entities.set(ruin.id, ruin);
        this.ruins.push(ruin);
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(tower.x, tower.y - 40, '防御塔被摧毁（点击废墟重建）', '#ff8855'));
        }
    },

    /** 重建被摧毁的塔：扣能源，塔满血复活并归还废墟处（武器/等级/模块保留） */
    rebuildTower(ruin, player) {
        const tower = ruin.ruinFor;
        if (!tower || tower.active) return { ok: false, reason: '该塔不需要重建' };
        const cost = DEFENSE_CONFIG.tower.rebuildCost ?? 300;
        if (!EnergyManager || !EnergyManager.deductEnergy(cost)) return { ok: false, reason: '能源不足（攻击资源点采集）' };
        tower.active = true;
        tower.hittable = true;
        tower.hp = tower.maxHp;
        tower.x = ruin.x;
        tower.y = ruin.y;
        tower.id = tower.id || `defense_tower_rebuilt_${Math.random().toString(36).slice(2, 6)}`;
        Game.entities.set(tower.id, tower);
        this.towers.push(tower);
        // 移除废墟
        ruin.active = false;
        const ri = this.ruins.indexOf(ruin);
        if (ri >= 0) this.ruins.splice(ri, 1);
        Game.entities.delete(ruin.id);
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(tower.x, tower.y - 40, `防御塔重建完成（-${cost} 能源）`, '#9dff9d'));
        }
        return { ok: true, cost };
    },

    /** 出售塔：返还 50% 建造能源；武器归还背包（满则原地掉落）；移除实体 */
    sellTower(tower, player) {
        if (!tower || tower.active === false) return { ok: false, reason: '已摧毁的塔请直接重建' };
        const refund = Math.floor((DEFENSE_CONFIG.tower.rebuildCost ?? 300) * (DEFENSE_CONFIG.tower.sellRefundRatio ?? 0.5));
        // 武器归还
        const item = tower.weaponItem;
        if (item) {
            tower.unequipWeapon && tower.unequipWeapon();
            if (!EquipManager.addToBackpack(item) && Game && typeof Game.dropItem === 'function') {
                Game.dropItem(tower.x, tower.y, item);
            }
        }
        const i = this.towers.indexOf(tower);
        if (i >= 0) this.towers.splice(i, 1);
        tower.active = false;
        Game.entities.delete(tower.id);
        if (EnergyManager) EnergyManager.addEnergy(refund);
        if (this._panel && this._panel.isOpen && this._panel.tower === tower) this._panel.close();
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(tower.x, tower.y - 40, `已出售（+${refund} 能源）`, '#ffd700'));
        }
        return { ok: true, refund };
    },

    /** 防守胜利：撑过 victoryWave 波 → 停止刷怪 + 一次性奖励 */
    _onVictory() {
        if (this.victory) return;
        this.victory = true;
        const reward = DEFENSE_CONFIG.spawn.victoryReward || { gold: 500, energy: 500 };
        if (!this._victoryGranted) {
            this._victoryGranted = true;
            if (GoldManager) GoldManager.addGold(reward.gold || 0);
            if (EnergyManager) EnergyManager.addEnergy(reward.energy || 0);
        }
        if (Game.player) {
            EffectManager.add(new FloatingTextEffect(
                Game.player.x, Game.player.y - 60,
                `防守胜利！撑过 ${DEFENSE_CONFIG.spawn.victoryWave || 10} 波（+${reward.gold} 金币 +${reward.energy} 能源）`,
                '#ffd700'
            ));
        }
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/levelup.wav');
        }
    },

    /** 废墟贴图（运行时生成：灰色残骸底座 + 冒烟标记） */
    _ensureTowerRuinTexture() {
        const scene = window.__phaserScene;
        if (!scene || scene.textures.exists('tower_ruin')) return;
        const g = scene.add.graphics();
        g.fillStyle(0x2e2a24, 1);
        g.fillEllipse(64, 88, 96, 26);
        g.fillStyle(0x4a443c, 1);
        g.fillTriangle(30, 78, 98, 78, 64, 44);
        g.fillStyle(0x6a6258, 1);
        g.fillTriangle(40, 78, 88, 78, 64, 58);
        g.lineStyle(4, 0x8a8a8a, 0.8);
        g.strokeCircle(64, 44, 10);
        g.generateTexture('tower_ruin', 128, 104);
        g.destroy();
    },

    /**
     * 点击交互：点防御塔打开面板（再次点击关闭）；点基地核心显示剩余耐久
     * @param {number} mx 屏幕 X
     * @param {number} my 屏幕 Y
     * @param {object} player 玩家
     * @returns {boolean} 是否消费本次点击
     */
    tryInteract(mx, my, player) {
        if (!this.active || !player) return false;
        const panel = this._ensurePanel();
        const inReach = (t, r) => {
            const pdx = t.x - player.x;
            const pdy = t.y - player.y;
            if (Math.sqrt(pdx * pdx + pdy * pdy) > 260) return false;
            const pos = Renderer.worldToScreen(t.x, t.y);
            return Math.hypot(mx - pos.x, my - pos.y) < r;
        };
        // 点击目标：优先自身 towers 数组，同时兜底扫描 Game.entities（测试/运行期
        // 直接入实体表的塔也要可点；按实体 id 去重，避免同塔重复命中）
        const seen = new Set();
        const candidates = [];
        if (Game && Game.entities) {
            for (const e of Game.entities.values()) {
                if (e && e._isDefenseTower && e.active) {
                    if (!seen.has(e.id)) { seen.add(e.id); candidates.push(e); }
                }
            }
        }
        for (const t of this.towers) {
            if (t && t.active && !seen.has(t.id)) candidates.push(t);
        }
        for (const t of candidates) {
            if (!t.active) continue;
            if (!inReach(t, 70)) continue;
            if (panel.isOpen && panel.tower === t) {
                panel.close();
            } else {
                panel.openFor(t, player);
            }
            return true;
        }
        // 废墟：点击打开重建面板
        for (const r of this.ruins) {
            if (!r || !r.active) continue;
            if (!inReach(r, 60)) continue;
            if (panel.isOpen && panel.ruin === r) {
                panel.close();
            } else {
                panel.openForRuin(r, player);
            }
            return true;
        }
        if (this.base && this.base.active && inReach(this.base, 90)) {
            EffectManager.add(new FloatingTextEffect(
                this.base.x,
                this.base.y - 70,
                `基地核心 ${Math.ceil(this.base.hp)}/${this.base.maxHp}`,
                '#7a9aff'
            ));
            return true;
        }
        return false;
    },
};

// ==================== E 键修理（仅世界-122，2026-08-14）====================
// 按住 E 持续修理附近受伤的掩体/防御塔（消耗背包能源）；松开停止。
// 用捕获监听保证先于 input.js 的 handleKey（其不拦截 KeyE，但避免面板/编辑器状态误触发）。

if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyE' || e.repeat) return;
        if (Game && (Game._wallEditMode || Game._buildMode)) return; // 编辑/建筑模式不修理
        if (SceneManager && SceneManager.currentScene !== 'scene8') return;
        DefenseSystem._setRepairHeld(true);
    }, true);
    window.addEventListener('keyup', (e) => {
        if (e.code === 'KeyE') DefenseSystem._setRepairHeld(false);
    }, true);
    window.addEventListener('blur', () => {
        if (DefenseSystem._repairHeld) DefenseSystem._setRepairHeld(false);
    });
}

export { DefenseBase, DefenseCover, DefenseTower };
