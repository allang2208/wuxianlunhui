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
// SceneManager 导入已于 2026-08-15 移除：E 键修理监听器停用后不再引用
import { loadImage } from '../utils/image-loader.js';
import { BuildingSinkEffect } from '../effects/building-sink.js';
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
    // （2026-08-15 变更：E 键长按修理已停用——与用户快捷键冲突；掩体修理改由建筑面板
    //  详情视图「修理」按钮进行，费率仍取本配置 coverHpPerEnergy）
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
        // A 移动（2026-08-15）：怪物最终目标仍是基地/建筑，但沿途交战半径内的
        // 玩家/侍从也会被锁定攻击（类似 RTS 的 A 键攻击移动）；脱离后自动回归推进
        engageHostileRange: 320,
        // 防守局内金币经济（2026-08-07）：击杀掉落走本倍率（怪物标 _noGoldDrop，
        // 不走地面掉落物，直接进背包），随波次成长；精英 ×2 / 领主 ×3
        goldDropMul: 6,
        goldRandomMin: 1,
        goldRandomMax: 8,
        // 精英/领主定时刷（仅在波次战斗阶段，在普通波次之上额外生成）
        // （2026-08-15 起停用计时器：精英/领主改由 wavePlan 随波次脚本化生成，字段保留兼容）
        eliteEveryMs: 30000,
        lordEveryMs: 90000,
        eliteHpMul: 1.4,
        lordHpMul: 2.8,
        // 胜利结算（2026-08-14）：第 victoryWave 波清空即防守胜利，发放奖励
        victoryWave: 10,
        victoryReward: { gold: 500, energy: 500 },
        // ==================== 波次预算制配波（2026-08-15，用户确认方案）====================
        // 每波按威胁预算（TP）配怪：预算 ÷ 怪物 TP = 只数，角色配比 + 硬约束替代旧"只数公式+单一随机池"。
        // 预算曲线 26 × 1.15^(n-1)：W1≈8只 / W10≈24只，与旧 countCap 曲线对齐；
        // HP/攻击仍走 hpPerWave/atkPerWave 成长（预算只管数量与构成，不重复放大血量）。
        waveBudgetBase: 26,
        waveBudgetGrowth: 1.15,
        // 角色解锁时间表（教学式节奏）；ratios = 占本波预算比例；elites/lords = 脚本化生成数量，
        // eliteMul/lordMul 可覆盖默认血量倍率（如 W5 迷你领主 0.6 × lordHpMul）
        wavePlan: {
            1:  { theme: '尸潮',     ratios: { fodder: 1.0 },                                              elites: 0, lords: 0 },
            2:  { theme: '尸潮+',    ratios: { fodder: 0.8, tank: 0.2 },                                   elites: 0, lords: 0 },
            3:  { theme: '犬袭',     ratios: { fodder: 0.6, fast: 0.4 },                                   elites: 1, lords: 0 },
            4:  { theme: '酸液',     ratios: { fodder: 0.6, ranged: 0.25, tank: 0.15 },                    elites: 0, lords: 0 },
            5:  { theme: '空袭',     ratios: { fast: 0.4, air: 0.3, fodder: 0.3 },                         elites: 0, lords: 1, lordMul: 0.6 },
            6:  { theme: '重压',     ratios: { tank: 0.4, fodder: 0.4, ranged: 0.2 },                      elites: 2, lords: 0 },
            7:  { theme: '混合突击', ratios: { fodder: 0.35, tank: 0.25, fast: 0.2, ranged: 0.1, air: 0.1 }, elites: 0, lords: 0 },
            8:  { theme: '精英卫队', ratios: { fodder: 0.5, tank: 0.3, ranged: 0.2 },                      elites: 2, lords: 1 },
            9:  { theme: '总攻预演', ratios: { fodder: 0.3, tank: 0.3, fast: 0.15, ranged: 0.15, air: 0.1 }, elites: 2, lords: 0 },
            10: { theme: '决战',     ratios: { fodder: 0.4, tank: 0.3, fast: 0.15, ranged: 0.15 },         elites: 2, lords: 2 },
        },
        // 配波硬约束（防脸黑）：单一类型 ≤ 单波只数 40%；远程+空中 ≤ 预算 30%；快速 ≤ 预算 35%
        waveMaxSameTypeRatio: 0.4,
        waveMaxRangedAirBudgetRatio: 0.3,
        waveMaxFastBudgetRatio: 0.35,
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

/**
 * 防御塔命中盒（世界坐标，相对塔脚）：覆盖整塔视觉范围——基座（170×262，脚底下 y-262..y）、
 * 顶部机械臂（枢轴 y-235，臂展 ±112）与挂载武器。2026-08-15：点击塔任意部位开面板 +
 * 悬停金色轮廓共用此矩形（旧版仅塔脚 70px 圆，点塔身/塔顶脱靶）。
 */
const TOWER_HIT = { cx: 0, cy: -135, hw: 115, hh: 175 };

/** 世界点是否命中防御塔（整塔矩形） */
function pointHitsTower(wx, wy, t) {
    return wx >= t.x + TOWER_HIT.cx - TOWER_HIT.hw && wx <= t.x + TOWER_HIT.cx + TOWER_HIT.hw
        && wy >= t.y + TOWER_HIT.cy - TOWER_HIT.hh && wy <= t.y + TOWER_HIT.cy + TOWER_HIT.hh;
}

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
    // 僵尸犬（2026-08-15 恢复）：类构造器已合并 enemyConfigData（08-15 早些时候修复
    // 「测试敌人」兜底根因）+ showWeapon 默认 false，无配置构造即完整可用。
    { type: 'zombieDog', weight: 8 },
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

/**
 * 角色池（2026-08-15 预算制配波）：tp = 威胁值（Threat Point），配波货币；weight = 角色内抽取权重。
 * TP 依据 HP/速度/射程/攻击频率综合评定：炮灰 僵尸3/矿工4；坦克 胖5/矿工4；快速 狗3/狼5；
 * 远程 喷吐6（射程930 > 塔基准800，白嫖风险高 → 高TP）；空中 蝇群2
 */
const ROLE_POOLS = {
    fodder: [ { type: 'zombie', tp: 3, weight: 3 }, { type: 'minerZombie', tp: 4, weight: 2 } ],
    tank:   [ { type: 'fatZombie', tp: 5, weight: 3 }, { type: 'minerZombie', tp: 4, weight: 1 } ],
    fast:   [ { type: 'zombieDog', tp: 3, weight: 3 }, { type: 'blackWolf', tp: 5, weight: 2 } ],
    ranged: [ { type: 'spitterZombie', tp: 6, weight: 1 } ],
    air:    [ { type: 'flySwarm', tp: 2, weight: 1 } ],
};

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

/** 世界-122 铁栅栏滑动门几何（2026-08-15，Blender 建模 + 掩体同款砖墙/铸铁贴图，F→A 六档共用）。
 * 门体：仅左右两根细立柱 + 纤细铁栅栏（无上下横梁），两扇叶整体沿墙轴向滑出/滑入。
 * 几何标定（compose-cover-gate.py 输出，纹理 cell 640×634，y 向下）：
 * - face 线 = 门底边线（与 COVER_FACE v 同斜率 -0.5、同接地偏移），关闭时覆盖门洞；
 * - 16 帧滑动动画：frame 0 = 关闭（两扇叶在中间合拢），frame 15 = 打开（扇叶滑出画面外隐藏）。
 */
const GATE_GRADES = ['F', 'E', 'D', 'C', 'B', 'A'];
const GATE_GEOM = {
    cellW: 640,
    cellH: 634,
    frames: 16,
    animMs: 650,
    halfThick: 26,
    faceA: { x: 90.2, y: 633.4 },
    faceB: { x: 639.6, y: 360.6 },
    faceLen: 613.6,
    worldFaceLen: 270.4,
    // 显示比例：与掩体墙同尺度（掩体 1024tex→260px；门 cell 640→262px）。
    // 碰撞 face 仍按 worldFaceLen=270.4（门洞跨度），视觉上两侧由相邻墙端帽叠盖。
    displayScale: 0.410,
};
const gateConfigFor = (grade) => ({ ...GATE_GEOM, grade, tex: `cover_gate_${grade}` });
const GATE_CONFIG = gateConfigFor('D'); // 基地固定门（D 级）

/** 门的三段深度面线全局注册表（供 WallSystem 遮挡仲裁逐帧并入，2026-08-15）。 */
function gateSegRegistry() {
    if (typeof window === 'undefined') return null;
    if (!window.GateFaceSegs) window.GateFaceSegs = [];
    return window.GateFaceSegs;
}

/**
 * 门的三段遮挡面线（沿 face 线切分）：
 * 左柱段（深端）/ 栅栏段（中点）/ 右柱段（浅端）——各自独立深度，
 * 让右柱（浅端）前实体自然浮到右柱之上、左柱（深端）仍能遮挡其后实体。
 */
function gateDepthSegs(A, B, depthL, depthR, depthBars) {
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const half = 26; // 柱宽在 face 线上的投影（世界 px）
    return [
        { A: { x: A.x, y: A.y }, B: { x: A.x + ux * half, y: A.y + uy * half }, depth: depthL },
        { A: { x: A.x + ux * half, y: A.y + uy * half }, B: { x: B.x - ux * half, y: B.y - uy * half }, depth: depthBars },
        { A: { x: B.x - ux * half, y: B.y - uy * half }, B: { x: B.x, y: B.y }, depth: depthR },
    ];
}

/** 创建门的三段精灵（左柱/右柱静态图 + 栅栏 16 帧），各按自身底边线深度锚定。
 *  flip=镜像（h）：整门翻转换了视觉左右，左右柱深度随之互换（面线端点不变）。 */
function createGateSprites(cfg, cx, cy, k, depthL, depthR, depthBars, flip) {
    const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
    if (!scene) return null;
    const out = { spriteL: null, spriteR: null, bars: null };
    if (scene.textures.exists(`${cfg.tex}_pillarL`)) {
        out.spriteL = scene.add.image(cx, cy, `${cfg.tex}_pillarL`);
        out.spriteL.setOrigin(0.5, 0.5);
        out.spriteL.setScale(k, k);
        out.spriteL.setDepth(flip ? depthR : depthL);
        out.spriteL.setFlipX(flip);
    }
    if (scene.textures.exists(`${cfg.tex}_pillarR`)) {
        out.spriteR = scene.add.image(cx, cy, `${cfg.tex}_pillarR`);
        out.spriteR.setOrigin(0.5, 0.5);
        out.spriteR.setScale(k, k);
        out.spriteR.setDepth(flip ? depthL : depthR);
        out.spriteR.setFlipX(flip);
    }
    if (scene.textures.exists(`${cfg.tex}_bars`)) {
        out.bars = scene.add.sprite(cx, cy, `${cfg.tex}_bars`, 0);
        out.bars.setOrigin(0.5, 0.5);
        out.bars.setScale(k, k);
        out.bars.setDepth(depthBars);
        out.bars.setFlipX(flip);
    }
    return out;
}

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
        this._isDefenseBase = true; // 2026-08-15：过门追击逻辑的最高优先级目标标记
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
        // 贴图：Blender 建模重建（立方体 + 扁平底座 + 大理石贴图，2026-08-16，
        // 规格 _blockout_specs/defense_base.json，渲染 assets/terrain/defense_base.png）
        this.spriteCfg = { idleKey: 'defense_base', size: 220, sizeH: 183, footOffsetY: 92 };
        this.footOffsetY = 92;
        this._onDestroyed = config.onDestroyed || null;
        this.rebuildCollider();
    }

    takeDamage(damage, source, damageType, isMelee) {
        // 沉陷死亡由 onDeath 接管（避免默认 active=false + 血雾，保持精灵下沉）
        return super.takeDamage(damage, source, damageType, isMelee);
    }

    /** 基地核心沉陷死亡（2026-08-16 推广）：触发失败回调 + 沉陷清除 */
    onDeath(_source) {
        this.active = true;
        this.hittable = false;
        this._sinking = true;
        if (typeof this._onDestroyed === 'function') this._onDestroyed(this);
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 70, '基地核心被摧毁！防守失败', '#ff5555'));
            EffectManager.add(new BuildingSinkEffect(this));
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
          this._isDefenseCover = true; // HUD 专用：满血不显示名字/血量文字，残血只显示血条
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
        // 沉陷死亡逻辑在 onDeath 接管（DamageableEntity.onDeath 默认 active=false +
        // 血雾/死亡粒子，掩体需要保持活跃让精灵下沉）
        return super.takeDamage(damage, source, damageType, isMelee);
    }

    /** 掩体沉陷死亡（2026-08-16 试点）：不设 active=false、不播血雾/死亡粒子；
     *  精灵随 BuildingSinkEffect 下沉 + 底部灰烟掩盖，结束后清除实体（无废墟） */
    onDeath(_source) {
        this.active = true; // 保持活跃让中性精灵继续渲染；下沉结束时由特效置 false
        this.hittable = false;
        this._sinking = true;
        this.removeFromCollision();
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '掩体被摧毁', '#ff8855'));
            EffectManager.add(new BuildingSinkEffect(this));
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
        // 沉陷死亡由 onDeath 接管
        return super.takeDamage(damage, source, damageType, isMelee);
    }

    /** 防御塔沉陷死亡（2026-08-16 推广，无废墟）：三层精灵随特效下沉清除 */
    onDeath(_source) {
        this.active = true;
        this.hittable = false;
        this._sinking = true;
        // 从 towers 数组移除（不再登记废墟/重建——用户口径：被摧毁即清除）
        if (DefenseSystem && DefenseSystem.towers) {
            const i = DefenseSystem.towers.indexOf(this);
            if (i >= 0) DefenseSystem.towers.splice(i, 1);
        }
        if (DefenseSystem && DefenseSystem._panel && DefenseSystem._panel.isOpen
            && DefenseSystem._panel.tower === this) {
            DefenseSystem._panel.close();
        }
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, '防御塔被摧毁', '#ff8855'));
            // 塔是专属三层渲染（基座/臂/武器），从 _defenseSprites 接管后整体下沉
            EffectManager.add(new BuildingSinkEffect(this, (t) => {
                const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
                const sp = scene && scene._defenseSprites ? scene._defenseSprites.get(t) : null;
                if (scene && scene._defenseSprites) scene._defenseSprites.delete(t);
                return sp ? [sp.base, sp.arm, sp.weapon] : [];
            }));
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
            'max-height:88vh;overflow-y:auto;',
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
            <div id="dtWeaponList" style="max-height:150px;overflow-y:auto;border:1px solid #3a3528;border-radius:8px;padding:4px 8px;margin-bottom:12px;"></div>
            <div id="dtUpgrade" style="border:1px solid #4a4a2a;border-radius:8px;padding:10px;background:rgba(60,50,20,0.18);"></div>
            <div id="dtModules" style="margin-top:10px;border:1px solid #3a4a5a;border-radius:8px;padding:10px;background:rgba(20,40,60,0.18);"></div>
            <div id="dtChip" style="margin-top:10px;border:1px solid #2a6a5f;border-radius:8px;padding:12px;background:rgba(12,30,28,0.28);"></div>
            <div id="dtRepair" style="margin-top:10px;border:1px solid #4a6a6a;border-radius:8px;padding:10px;background:rgba(20,50,50,0.18);"></div>
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

    /**
     * 按钮维修（2026-08-15 用户要求）：点击一次修满，能源不足修到能负担的上限；
     * 与掩体建筑面板修理同口径，费率 DEFENSE_CONFIG.repair.towerHpPerEnergy。
     */
    _repairTower() {
        const t = this.tower;
        if (!t || !t.active || t.hp >= t.maxHp) return;
        const rate = (DEFENSE_CONFIG.repair && DEFENSE_CONFIG.repair.towerHpPerEnergy) || 3;
        const energy = EnergyManager ? EnergyManager.getEnergy() : 0;
        const want = Math.min(t.maxHp - t.hp, energy * rate);
        if (want <= 0) {
            this._notify('能源不足，无法修理', '#ff5555');
            return;
        }
        const cost = Math.max(1, Math.ceil(want / rate));
        if (!EnergyManager || !EnergyManager.deductEnergy(cost)) {
            this._notify('能源不足，无法修理', '#ff5555');
            return;
        }
        t.hp = Math.min(t.maxHp, t.hp + want);
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(t.x, t.y - 40, `+${Math.round(want)} 修理`, '#7fd4ff'));
        }
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/ui/sell.wav');
        }
        this.refresh();
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
        // 修理区仅塔模式显示（废墟模式隐藏，2026-08-15）
        const rp0 = el.querySelector('#dtRepair');
        if (rp0) rp0.style.display = this.ruin ? 'none' : '';
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

        // 维修区（2026-08-15 用户要求）：与建筑面板掩体详情修理同口径——
        // 底部信息 + 一次修满按钮，费率 towerHpPerEnergy（3 耐久/1 能源）
        const rp = el.querySelector('#dtRepair');
        if (rp) {
            const rate = (DEFENSE_CONFIG.repair && DEFENSE_CONFIG.repair.towerHpPerEnergy) || 3;
            const rhp = Math.max(0, Math.ceil(t.hp));
            const rmax = t.maxHp || 1;
            const rpct = Math.round((rhp / rmax) * 100);
            const rbar = rpct > 60 ? '#7fd47f' : (rpct > 30 ? '#ffd700' : '#ff6666');
            const rneed = Math.ceil((rmax - rhp) / rate);
            rp.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <div style="font-size:13px;color:#a8e0e0;font-weight:700;">🔧 维修</div>
                    <div style="font-size:12px;color:#9a9a9a;">费率 ${rate} 耐久 / 1 能源</div>
                </div>
                <div style="height:8px;background:#26261e;border:1px solid #4a6a6a;border-radius:4px;overflow:hidden;margin-bottom:8px;">
                    <div style="width:${rpct}%;height:100%;background:${rbar};"></div>
                </div>
                <button id="dtRepairBtn" ${rhp >= rmax ? 'disabled' : ''} style="width:100%;background:#263a3a;color:#7fd4ff;border:1px solid #4a6a6a;border-radius:6px;padding:7px 0;${rhp >= rmax ? 'opacity:0.45;cursor:default;' : 'cursor:pointer;'}">${rhp >= rmax ? '耐久已满' : `修 理（-${rneed} 能源）`}</button>`;
            rp.querySelector('#dtRepairBtn').addEventListener('click', () => this._repairTower());
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

        // 神经芯片 · 射手演算（六维面板，2026-08-15）：塔载芯片以计算机演算模拟玩家六维，
        // 火力结算走 _statMul（六维 × 各系数），此处把六维与逐项贡献展示出来
        const chip = el.querySelector('#dtChip');
        const d = player && player.data ? player.data : {};
        const CHIP_STATS = [
            { key: 'str', name: '力量', coef: 0.008 },
            { key: 'dex', name: '敏捷', coef: 0.010 },
            { key: 'con', name: '体质', coef: 0.004 },
            { key: 'int', name: '智力', coef: 0.006 },
            { key: 'wis', name: '精神', coef: 0.006 },
            { key: 'luck', name: '幸运', coef: 0.004 },
        ];
        let chipTotal = 0;
        const chipCells = CHIP_STATS.map((s) => {
            const v = d[s.key] ?? 10;
            const contrib = v * s.coef * 100;
            chipTotal += contrib;
            return `<div style="border:1px solid #234a44;border-radius:6px;background:rgba(0,0,0,0.3);padding:7px 4px;text-align:center;">
                <div style="font-size:12px;color:#7fb8ac;">${s.name}</div>
                <div style="font-size:16px;font-weight:700;color:#e8f4f0;margin:2px 0;">${v}</div>
                <div style="font-size:11px;color:#6a9a92;">+${contrib.toFixed(1)}%</div>
            </div>`;
        }).join('');
        chip.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:13px;font-weight:700;color:#7fe0c8;">🧠 神经芯片 · 射手演算</span>
                <span style="font-size:12px;color:#9adfcf;">火力合计 <b>+${chipTotal.toFixed(1)}%</b></span>
            </div>
            <div style="font-size:11px;color:#6a9a92;margin-bottom:8px;line-height:1.6;">
                塔载神经芯片接入轮回者神经数据流，由计算机演算模拟射手六维，实时驱动火力结算
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">${chipCells}</div>`;
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
        el.querySelector('#dtChip').innerHTML = '';
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
        this.gates = []; // 建筑面板放置的铁栅栏门
        this.platforms = []; // 射击台（预置 + 建筑面板放置）
        this._placeInitialPlatform(); // 基地菱形房右上墙边预置 1 个射击台
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
          // 基地铁栅栏滑动门（D 级，2026-08-15）：状态机默认关闭；
          // 友军（玩家/侍从）靠近自动打开，离开 1.2s 后自动关闭（阻挡门洞）。
          const gs = DEFENSE_CONFIG.covers.gate;
          if (gs) {
              this.gate = { ...CoverGate };
              if (!this.gate.place({ x: gs.x, y: gs.y }, gs.A, gs.B)) this.gate = null;
          }
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
        // 基地门洞（openEdge 边中点）→ 铁栅栏滑动门放置点：
        // face 线 = 该边掩体 face 线（同斜率/同接地偏移）延伸跨过门洞，长度 = worldFaceLen
        const ge = edges.find((e) => e.key === openEdge);
        if (ge) {
            const gdx = ge.to.x - ge.from.x;
            const gdy = ge.to.y - ge.from.y;
            const gx = ge.from.x + gdx * 0.5;
            const gy = ge.from.y + gdy * 0.5;
            const half = GATE_CONFIG.worldFaceLen / 2;
            const midY = gy - 65; // COVER_FACE v 中点偏移（接地线过 (x, y-65)）
            if (ge.orient === 'v') {
                DEFENSE_CONFIG.covers.gate = {
                    x: gx, y: gy,
                    A: { x: Math.round(gx - half), y: Math.round(midY + half * 0.5) },
                    B: { x: Math.round(gx + half), y: Math.round(midY - half * 0.5) },
                };
            } else {
                DEFENSE_CONFIG.covers.gate = {
                    x: gx, y: gy,
                    A: { x: Math.round(gx - half), y: Math.round(midY - half * 0.5) },
                    B: { x: Math.round(gx + half), y: Math.round(midY + half * 0.5) },
                };
            }
        }
        DEFENSE_CONFIG.covers.layout = layout;
    },

    teardown() {
        this.active = false;
        this.defeated = false;
        this.victory = false;
        this._victoryGranted = false;
        if (this.gate) { this.gate.destroy(); this.gate = null; }
        if (this.gates) {
            for (const g of this.gates) { if (g && typeof g.destroy === 'function') g.destroy(); }
            this.gates = [];
        }
        if (this.platforms) {
            for (const p of this.platforms) { if (p && typeof p.destroy === 'function') p.destroy(); }
            this.platforms = [];
        }
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
        syncGateSeamDepths(); // 拼接缝图层偏置（左门右柱盖右门左柱）随放置/拆除每帧同步
        this._elapsed += dt;
        this._repairTick(dt);
        if (this.gate) this.gate.update(dt); // 友军靠近自动开门 / 离开延时关门
        for (const g of this.gates) { if (g && g.active) g.update(dt); } // 已放置的铁栅栏门
        this._updatePlatformStates(); // 射击台登台判定（玩家/友方脚线在站台顶面 → _onPlatform）
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
        // 精英/领主旧计时器已停用（2026-08-15 用户确认方案）：改由 _startWave 按 wavePlan
        // 脚本化生成，与波次节奏挂钩；旧配置字段 eliteEveryMs/lordEveryMs 保留兼容，不再驱动生成
    },

    /**
     * 射击台登台判定（2026-08-16）：玩家 + 玩家友方单位（PartySystem.members /
     * Game.friendlyUnits）脚线落在任一平台站台顶面投影区 → _onPlatform = true +
     * 记录 _platformRef（弹道/魔法据此忽略己方掩体段）；离开平台区域自动清除。
     * 注意：Companion 在 PartySystem._members 不在 Game.entities（门感应同款坑）。
     */
    _updatePlatformStates() {
        const platforms = this.platforms;
        if (!platforms || !platforms.length) return;
        // 收集候选单位：玩家 + 侍从/仓鼠矿工
        const units = [];
        const Game = (typeof window !== 'undefined') ? window.Game : null;
        if (Game && Game.player) units.push(Game.player);
        if (Game && Game.PartySystem && Array.isArray(Game.PartySystem.members)) {
            for (const m of Game.PartySystem.members) if (m && m.active !== false) units.push(m);
        }
        if (Game && Array.isArray(Game.friendlyUnits)) {
            for (const u of Game.friendlyUnits) {
                if (u && u !== Game.player && u.active !== false && !units.includes(u)) units.push(u);
            }
        }
        for (const u of units) {
            let on = null;
            let lift = 0;
            for (const p of platforms) {
                if (!p || !p.active) continue;
                if (typeof p.getLift === 'function') {
                    const l = p.getLift(u.x, u.y);
                    if (l > 0) { on = p; lift = l; break; }
                } else if (typeof p.isOnPlatform === 'function' && p.isOnPlatform(u.x, u.y)) {
                    on = p;
                    lift = p.platformHeight || 0;
                    break;
                }
            }
            // 连续抬升（四版）：_platformLift = 当前位置应抬升的高度（0~platformHeight），
            // 由走廊内位置插值——走上台阶连续升高，不再布尔瞬移
            u._onPlatform = !!on;
            u._platformRef = on;
            u._platformLift = lift;
            // 平台实机调试：状态变化时控制台留痕（低频，dev 模式）
            if (window && window.Game && window.Game._devMode && u._platformLiftPrev !== lift) {
                console.log(`[platform] ${u.name || u.id || 'unit'} lift=${lift}`);
            }
            u._platformLiftPrev = lift;
        }
    },

    /** 预置射击台（scene8 加载时调用）：基地菱形房右上墙边（TR 边内侧，贴墙放置） */
    _placeInitialPlatform() {
        const room = DEFENSE_CONFIG.room;
        if (!room || !room.enabled) return;
        const b = DEFENSE_CONFIG.base;
        // 右上墙边 = TR 边（从顶 T 到右 R）中点内侧：平台沿墙放置（与掩体同向），
        // 台阶向房内延伸（2026-08-16 三版：拓宽掩体立方体 = 平台主体平行墙）
        const T = { x: b.x, y: b.y - room.ry };
        const R = { x: b.x + room.rx, y: b.y };
        const mx = (T.x + R.x) / 2, my = (T.y + R.y) / 2;
        // 墙内侧法线（指向房内 = 指向基地中心）：垂直于墙线
        const inx = b.x - mx, iny = b.y - my;
        const inLen = Math.hypot(inx, iny) || 1;
        const nx = inx / inLen, ny = iny / inLen;
        // 平台中心 = 墙线中点 + 法线 × (墙半厚 + 贴墙余量)：平台主体贴墙（同掩体），
        // 台阶（贴图底部）朝房内 = 法线方向延伸
        const offset = 26 + 30; // 墙半厚(26) + 贴墙余量
        const px = Math.round(mx + nx * offset);
        const py = Math.round(my + ny * offset);
        const platform = new FiringPlatform(px, py, {
            id: 'initial_firing_platform',
            orient: 'h',
            wallNormal: { x: nx, y: ny },
        });
        if (Game && Game.entities) Game.entities.set('firing_platform_initial', platform);
        this.platforms = this.platforms || [];
        this.platforms.push(platform);
    },

    /**
     * 开一波（2026-08-15 预算制重构）：
     * 有 wavePlan 配置 → _composeWave 按威胁预算+角色配比+硬约束配怪，精英/领主脚本化生成；
     * 无配置 → 旧逻辑回退（一次性刷 batch = baseCount + wave×countPerWave，封顶 countCap，受 maxAlive 约束）
     */
    _startWave() {
        this._phase = 'wave';
        this._phaseTimer = 0;
        const cfg = DEFENSE_CONFIG.spawn;
        const plan = cfg.wavePlan ? cfg.wavePlan[this._wave] : null;
        let alive = this._aliveCount();
        const composed = plan ? this._composeWave(this._wave, plan) : null;
        if (composed) {
            for (const type of composed) {
                if (alive >= cfg.maxAlive) break;
                this._spawnMonster(this._wave, null, 1, type);
                alive++;
            }
            // 脚本化精英/领主（eliteMul/lordMul 可覆盖默认血量倍率，如 W5 迷你领主）
            for (let i = 0; i < (plan.elites || 0); i++) {
                if (alive >= cfg.maxAlive) break;
                this._spawnElite(plan.eliteMul);
                alive++;
            }
            for (let i = 0; i < (plan.lords || 0); i++) {
                if (alive >= cfg.maxAlive) break;
                this._spawnLord(plan.lordMul);
                alive++;
            }
            this._announce(`第 ${this._wave} 波 · ${plan.theme || '来袭'}！`, '#ffd700');
            return;
        }
        const count = Math.min(
            cfg.countCap,
            Math.floor(cfg.baseCount + this._wave * cfg.countPerWave)
        );
        for (let i = 0; i < count; i++) {
            if (alive >= cfg.maxAlive) break;
            this._spawnMonster(this._wave, NORMAL_POOL);
            alive++;
        }
        this._announce(`第 ${this._wave} 波来袭！`, '#ffd700');
    },

    /**
     * 预算制配波（2026-08-15）：返回本波怪物类型数组
     * 1) 预算 = waveBudgetBase × waveBudgetGrowth^(wave-1)；各角色目标 = 预算 × 配比
     * 2) 硬约束钳制：远程+空中合计 ≤ 预算 30%；快速 ≤ 预算 35%
     * 3) 角色内按权重随机抽怪填满目标预算；单一类型 ≤ 单波只数 40%
     * 4) 多样性兜底：类型数 ≥ min(3, 本波解锁类型数)
     */
    _composeWave(wave, plan) {
        const cfg = DEFENSE_CONFIG.spawn;
        const budget = Math.max(1, Math.round((cfg.waveBudgetBase || 26) * Math.pow(cfg.waveBudgetGrowth || 1.15, wave - 1)));
        const ratios = plan.ratios || { fodder: 1 };
        const target = {};
        for (const r in ratios) target[r] = budget * ratios[r];
        // 硬约束钳制：远程+空中合计、快速
        const raCap = budget * (cfg.waveMaxRangedAirBudgetRatio ?? 0.3);
        const raSum = (target.ranged || 0) + (target.air || 0);
        if (raSum > raCap && raSum > 0) {
            const k = raCap / raSum;
            if (target.ranged) target.ranged *= k;
            if (target.air) target.air *= k;
        }
        const fastCap = budget * (cfg.waveMaxFastBudgetRatio ?? 0.35);
        if ((target.fast || 0) > fastCap) target.fast = fastCap;
        // 逐角色按预算抽样（角色内权重随机；只选 TP 不超剩余预算且不违反单一类型上限的类型）
        const list = [];
        const typeCount = {};
        // 本波解锁类型表（扁平化，含 TP，供上限计算与兜底填充共用）
        const unlockedTypes = [];
        for (const role in target) {
            for (const m of (ROLE_POOLS[role] || [])) {
                if (!unlockedTypes.some(u => u.type === m.type)) unlockedTypes.push(m);
            }
        }
        // 单一类型上限：解锁类型 ≥3 时按配置 40%；类型不足时放宽到 1/类型数（否则约束数学上不可满足）
        const sameRatio = Math.max(cfg.waveMaxSameTypeRatio ?? 0.4, 1 / Math.max(1, unlockedTypes.length));
        for (const role in target) {
            let remaining = target[role];
            let guard = 200;
            while (guard-- > 0 && remaining > 0) {
                const capNow = Math.max(2, Math.ceil((list.length + 1) * sameRatio));
                const cand = (ROLE_POOLS[role] || []).filter(
                    m => m.tp <= remaining + 0.001 && (typeCount[m.type] || 0) < capNow
                );
                if (!cand.length) break;
                const total = cand.reduce((s, m) => s + (m.weight || 1), 0);
                let roll = Math.random() * total, pick = cand[0];
                for (const m of cand) { roll -= (m.weight || 1); if (roll <= 0) { pick = m; break; } }
                remaining -= pick.tp;
                list.push(pick.type);
                typeCount[pick.type] = (typeCount[pick.type] || 0) + 1;
            }
        }
        // 剩余预算兜底填充：各角色取整浪费的 TP 汇总后按低 TP 优先填缝，保证只数贴齐预算曲线
        {
            let remaining = Math.max(0, budget - list.reduce((s, t) => {
                const m = unlockedTypes.find(u => u.type === t);
                return s + (m ? m.tp : 0);
            }, 0));
            let guard = 200;
            while (guard-- > 0 && remaining > 0) {
                const capNow = Math.max(2, Math.ceil((list.length + 1) * sameRatio));
                // 兜底只从炮灰角色取（避免低TP的空中/快速类型被填充放大、冲垮角色占比）；
                // 本波无炮灰时退化为全解锁类型（不会发生：当前 wavePlan 每波均含 fodder）
                const fillPool = (ROLE_POOLS.fodder && target.fodder) ? ROLE_POOLS.fodder : unlockedTypes;
                const cand = fillPool.filter(m => m.tp <= remaining + 0.001 && (typeCount[m.type] || 0) < capNow);
                if (!cand.length) break;
                cand.sort((a, b) => a.tp - b.tp);
                const pick = cand[Math.floor(Math.random() * Math.min(2, cand.length))];
                remaining -= pick.tp;
                list.push(pick.type);
                typeCount[pick.type] = (typeCount[pick.type] || 0) + 1;
            }
        }
        if (!list.length) return null;
        // 多样性兜底：不足 min(3, 解锁类型数) 时，把数量最多的类型替换一只为未出场类型
        const unlocked = unlockedTypes.map(m => m.type);
        const wantDistinct = Math.min(3, unlocked.length, list.length);
        let guard2 = 50;
        while (new Set(list).size < wantDistinct && guard2-- > 0) {
            const counts = {};
            for (const t of list) counts[t] = (counts[t] || 0) + 1;
            const most = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
            const missing = unlocked.filter(t => !counts[t]);
            if (!missing.length || !most) break;
            list[list.indexOf(most)] = missing[Math.floor(Math.random() * missing.length)];
        }
        return list;
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

    _spawnMonster(wave, pool, hpMulExtra = 1, forceType = null) {
        const type = forceType || this._pickMonsterType(pool);
        const Factory = MONSTER_FACTORY[type];
        if (!Factory) return;
        const pt = DEFENSE_CONFIG.spawnPoints[Math.floor(Math.random() * DEFENSE_CONFIG.spawnPoints.length)];
        const monster = new Factory(pt.x, pt.y);
        // [FIX] 刷怪点可能被散布树 footprint 压住：先校验，必要时沿螺旋外推到合法位置，
        // 避免怪物出生即嵌入障碍（起点在矩形内 resolve/blocked 恒失败 → 永久冻结）
        if (WallSystem && WallSystem.canMoveTo && !WallSystem.canMoveTo(monster.x, monster.y, monster.groundRadius)) {
            const safe = WallSystem.findSafeSpawn(monster.x, monster.y, monster.groundRadius);
            monster.x = safe.x;
            monster.y = safe.y;
        }
        monster._defenseMonster = true;
        // 防守击杀金币：不走地面掉落物，由 DefenseSystem 结算直接进背包
        monster._noGoldDrop = true;
        monster._defenseGoldMul = DEFENSE_CONFIG.spawn.goldDropMul || 1;
        // 防守模式：最终目标基地/建筑（_preferDefenseTargets），沿途交战见 _engageHostileRange
        monster._preferDefenseTargets = true;
        monster._engageHostileRange = DEFENSE_CONFIG.spawn.engageHostileRange;
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

    _spawnElite(hpMul) {
        this._spawnMonster(this._wave || 1, ELITE_POOL, hpMul ?? DEFENSE_CONFIG.spawn.eliteHpMul);
        this._announce('精英来袭！', '#ff8800', 'assets/sounds/enemies/armored_knight/attacking.mp3');
    },

    _spawnLord(hpMul) {
        this._spawnMonster(this._wave || 1, LORD_POOL, hpMul ?? DEFENSE_CONFIG.spawn.lordHpMul);
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
     * 遍历所有存活防御塔（towers 数组 + Game.entities 兜底扫描，按 id 去重）
     * 点击命中与悬停轮廓共用（2026-08-15 抽出）
     */
    _iterActiveTowers() {
        const seen = new Set();
        const out = [];
        if (Game && Game.entities) {
            for (const e of Game.entities.values()) {
                if (e && e._isDefenseTower && e.active && !seen.has(e.id)) {
                    seen.add(e.id);
                    out.push(e);
                }
            }
        }
        for (const t of this.towers) {
            if (t && t.active && !seen.has(t.id)) { seen.add(t.id); out.push(t); }
        }
        return out;
    },

    /**
     * 悬停追踪（2026-08-15）：鼠标悬停防御塔整塔范围 → 记录 _hoverTower，
     * GameScene._syncDefenseTowers 每帧读它给三层贴图加金色轮廓；同时切换手型光标。
     * 建筑/编辑模式或指针在右侧面板上时不悬停。
     */
    _hoverTower: null,
    updateHover(mx, my) {
        if (!this.active) { this._setHoverTower(null); return; }
        if (Game && (Game._wallEditMode || Game._buildMode)) { this._setHoverTower(null); return; }
        // 面板打开时指针悬在右侧面板（DOM）上不穿透到场景
        const panel = this._panel;
        if (panel && panel.isOpen && typeof window !== 'undefined' && mx > window.innerWidth - 460) {
            this._setHoverTower(null);
            return;
        }
        const mw = Renderer.screenToWorld(mx, my);
        let hit = null;
        for (const t of this._iterActiveTowers()) {
            if (pointHitsTower(mw.x, mw.y, t)) { hit = t; break; }
        }
        this._setHoverTower(hit);
    },

    _setHoverTower(t) {
        if (this._hoverTower === t) return;
        this._hoverTower = t;
        if (typeof document === 'undefined') return;
        const cv = document.querySelector('canvas');
        if (cv) cv.style.cursor = t ? 'pointer' : '';
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
        const candidates = this._iterActiveTowers();
        for (const t of candidates) {
            if (!t.active) continue;
            // 玩家交互距离 260px 保留；命中判定 = 整塔矩形（基座/机械臂/挂载武器全视觉范围）
            const pdx = t.x - player.x;
            const pdy = t.y - player.y;
            if (Math.sqrt(pdx * pdx + pdy * pdy) > 260) continue;
            const mw = Renderer.screenToWorld(mx, my);
            if (!pointHitsTower(mw.x, mw.y, t)) continue;
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

// ==================== 基地铁栅栏滑动门（2026-08-15）====================
// Blender 建模 + 掩体同款砖墙/铸铁贴图 + 16 帧横向缩进动画；关闭=阻挡门洞，打开=放行。
/** 最近友军单位（玩家/侍从；排除同为 player 阵营的防御塔/掩体/基地）。
 *  侍从不在 Game.entities 里（存于 PartySystem._members），必须单独扫描，
 *  否则门只对玩家有反应。 */
function nearbyFriendlyUnit(cx, cy) {
    let best = null;
    let bestD = Infinity;
    const scan = (e) => {
        if (!e || !e.active) return;
        if (e._isDefenseStructure || e._isDefenseTower || e._isDefenseCover) return;
        if (e._faction !== 'player' && e._faction !== 'companion') return;
        const d = Math.hypot(e.x - cx, e.y - cy);
        if (d < bestD) { bestD = d; best = e; }
    };
    if (Game && Game.player) scan(Game.player);
    if (Game && Game.entities) {
        for (const e of Game.entities.values()) scan(e);
    }
    // 侍从挂在 Game.PartySystem（party-system.js 单例，game.js 挂载），不在 entities
    const party = (Game && Game.PartySystem) || null;
    if (party && Array.isArray(party.members)) {
        for (const e of party.members) scan(e);
    }
    return best;
}

/** 关门瞬间把"嵌进门段内"的单位沿面线法线推开（2026-08-16 三修）。
 *  - 只在 close() 瞬间调用一次（不每帧推——每帧直接改坐标会与移动系统 resolve 打架：
 *    开门时玩家被弹开/瞬移，双门接缝处卡柱子，实测更严重）；
 *  - 只推真正重叠门段（距离 < halfThick + 单位半径 + 2）的单位，不推只是靠近的；
 *  - 目标位置经 WallSystem.resolve 校验/滑动（不推进别的墙/柱子/接缝）。
 *  @returns {string[]} 被推开单位的 id 列表（调试用） */
function unstickUnitsFromGate(A, B, halfThick) {
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const pushed = [];
    const push = (u) => {
        if (!u || !u.active) return;
        if (u._isDefenseStructure || u._isDefenseTower || u._isDefenseCover) return;
        const r = u.groundRadius || u.collisionRadius || 20;
        const thresh = halfThick + r + 2; // 只推真正嵌进门段的单位
        const t = Math.max(0, Math.min(1, ((u.x - A.x) * ux + (u.y - A.y) * uy) / len));
        const cx = A.x + ux * t * len;
        const cy = A.y + uy * t * len;
        const off = (u.x - cx) * nx + (u.y - cy) * ny; // 有符号法向偏移
        const dist = Math.abs(off);
        if (dist >= thresh) return;
        const side = off >= 0 ? 1 : -1;
        const tx = cx + nx * (thresh + 1) * side;
        const ty = cy + ny * (thresh + 1) * side;
        // 经移动系统同一 resolve 校验/切向滑动，避免推进别的墙/柱子/双门接缝
        let ex = tx;
        let ey = ty;
        if (WallSystem && typeof WallSystem.resolve === 'function') {
            const er = WallSystem.resolve(u.x, u.y, tx, ty, r);
            if (er) { ex = er.x; ey = er.y; }
        }
        u.x = ex;
        u.y = ey;
        pushed.push(u.id || u.name || 'unit');
    };
    if (Game && Game.player) push(Game.player);
    if (Game && Game.entities) {
        for (const e of Game.entities.values()) push(e);
    }
    return pushed;
}

/** 门拼接缝图层规则（2026-08-16，用户指定）：左右两门拼接时，**左门的右柱**盖在
 *  **右门的左柱**之上（对齐墙的 depthBias 转角规则）。自然深度下右门左柱因面线
 *  叠 51px 深 ~22.8px 会盖左门右柱，需按缝成对加偏置：左门右柱 +diff、右门左柱 −diff
 *  （diff = 邻柱自然深度差 + 0.5）。同步精灵深度与遮挡面线段，保证仲裁一致。 */
function syncGateSeamDepths() {
    const D = (typeof DefenseSystem !== 'undefined') ? DefenseSystem : null;
    const list = [];
    if (D) {
        if (D.gate) list.push(D.gate);
        if (Array.isArray(D.gates)) {
            for (const g of D.gates) if (g && g.active) list.push(g);
        }
    }
    if (!list.length) return;
    for (const g of list) { g._seamBiasR = 0; g._seamBiasL = 0; }
    const faceEnd = (g) => {
        if (g._faceLine && g._faceLine.length === 2) return g._faceLine;
        if (g._gateSeg) return [{ x: g._gateSeg.x1, y: g._gateSeg.y1 }, { x: g._gateSeg.x2, y: g._gateSeg.y2 }];
        return null;
    };
    const SEAM_TOUCH = 70; // 51px face 叠合 + 端柱余量
    for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
            const g = list[i];
            const h = list[j];
            const gf = faceEnd(g);
            const hf = faceEnd(h);
            if (!gf || !hf) continue;
            const dAB = Math.hypot(gf[1].x - hf[0].x, gf[1].y - hf[0].y);
            const dBA = Math.hypot(gf[0].x - hf[1].x, gf[0].y - hf[1].y);
            if (dAB <= SEAM_TOUCH) {
                // g 右端 ≈ h 左端 → g 是左门：g 右柱盖 h 左柱
                const diff = (h._depthL - g._depthR) + 0.5;
                if (diff > 0) { g._seamBiasR += diff; h._seamBiasL -= diff; }
            }
            if (dBA <= SEAM_TOUCH) {
                // g 左端 ≈ h 右端 → h 是左门：h 右柱盖 g 左柱
                const diff = (g._depthL - h._depthR) + 0.5;
                if (diff > 0) { h._seamBiasR += diff; g._seamBiasL -= diff; }
            }
        }
    }
    for (const g of list) { if (typeof g._applySeamBias === 'function') g._applySeamBias(); }
}

/** 门放置时裁剪与门共线且伸入门跨度的掩体墙段碰撞线（2026-08-16）：
 *  - 基地菱形房的门洞带（openRadius 90）比门面线窄，门端柱骑在相邻掩体 face 线上，
 *    掩体段端点深入门跨（实测 i=0 深 61px / i=3 深 3px）。开门后栅栏放行，但掩体
 *    段的阻挡带（halfThick + 单位半径 ≈ 48px）仍探入门洞，玩家贴柱走位被截停 =
 *    "卡在柱子上"。
 *  - 正解：把深入掩体段的"内侧端点"沿门向回退 halfThick + 余量（只改 _coverSeg
 *    碰撞线，不动 _faceLine/贴图/深度锚点），让阻挡带恰好止于门 face 端点；
 *    门拆除时还原。 */
function trimCoverSegsForGate(gate, A, B) {
    if (!WallSystem || !WallSystem.isoSegments) return;
    if (!gate._trimmedCovers) gate._trimmedCovers = [];
    const gdx = B.x - A.x;
    const gdy = B.y - A.y;
    const glen = Math.hypot(gdx, gdy) || 1;
    const gux = gdx / glen;
    const guy = gdy / glen;
    const proj = (p) => (p.x - A.x) * gux + (p.y - A.y) * guy; // 沿门方向投影（A=0, B=glen）
    const distToLine = (p) => Math.abs((p.x - A.x) * guy - (p.y - A.y) * gux);
    for (const s of WallSystem.isoSegments) {
        if (!s || !s._cover || !s._owner || gate._trimmedCovers.includes(s)) continue;
        if (distToLine({ x: s.x1, y: s.y1 }) > 6 || distToLine({ x: s.x2, y: s.y2 }) > 6) continue; // 共线
        const a = proj({ x: s.x1, y: s.y1 });
        const b = proj({ x: s.x2, y: s.y2 });
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        if (hi <= 0 || lo >= glen) continue; // 与门跨度无重叠
        const backoff = (s.halfThick ?? 26) + 30; // 阻挡带 halfThick+单位半径，回退到门端点之外
        gate._trimmedCovers.push(s);
        if (!s._orig) s._orig = { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 };
        // 深入门跨（投影 ∈ [0, glen]）的端点 → 沿门向回退到对应门端点之外：
        // 靠 A 端回退到 A−backoff，靠 B 端回退到 B+backoff，使阻挡带止于门 face 端点。
        const moveOut = (e, side) => {
            if (side === 'A') { e.x = A.x - gux * backoff; e.y = A.y - guy * backoff; }
            else { e.x = B.x + gux * backoff; e.y = B.y + guy * backoff; }
        };
        const ends = [
            { x: s.x1, y: s.y1, p: a },
            { x: s.x2, y: s.y2, p: b },
        ];
        for (const e of ends) {
            if (e.p < 0 || e.p > glen) continue;
            moveOut(e, e.p < glen / 2 ? 'A' : 'B');
        }
        // 写回（ends 中的对象是新建的，需回填）
        s.x1 = ends[0].x; s.y1 = ends[0].y; s.x2 = ends[1].x; s.y2 = ends[1].y;
    }
    if (pathFinder && typeof pathFinder.invalidateRegion === 'function') {
        pathFinder.invalidateRegion(
            Math.min(A.x, B.x) - 30, Math.min(A.y, B.y) - 30,
            Math.max(A.x, B.x) + 30, Math.max(A.y, B.y) + 30);
    }
}

/** 还原被门裁剪的掩体段（门销毁时调用）。 */
function restoreTrimmedCovers(gate) {
    if (!gate || !gate._trimmedCovers || !WallSystem || !WallSystem.isoSegments) return;
    for (const s of gate._trimmedCovers) {
        if (!s || !s._orig) continue;
        s.x1 = s._orig.x1; s.y1 = s._orig.y1; s.x2 = s._orig.x2; s.y2 = s._orig.y2;
    }
    gate._trimmedCovers = [];
}

const CoverGate = {
    place(center, A, B, cfg) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        const cfg0 = cfg || GATE_CONFIG;
        this._cfg = cfg0;
        if (!scene || !scene.textures.exists(cfg0.tex)) return false;
        const k = cfg0.displayScale;
        this._scale = k;
        // 面线中点对齐：门的 face 线与掩体墙 face 线共线（同斜率、中点落在线中点）。
        // face 纹理线比世界 face 略短（显示比例一致），端点余量由相邻墙端帽叠盖。
        const midTexX = (cfg0.faceA.x + cfg0.faceB.x) / 2;
        const midTexY = (cfg0.faceA.y + cfg0.faceB.y) / 2;
        this._cx = (A.x + B.x) / 2 - (midTexX - cfg0.cellW / 2) * k;
        this._cy = (A.y + B.y) / 2 - (midTexY - cfg0.cellH / 2) * k;
        // 三段深度精灵（2026-08-15 图层重做）：左柱=深端、右柱=浅端、栅栏=中点，
        // 各自按底边线锚定，前实体不再被右柱整体遮挡
        this._depthL = A.y + 12;
        this._depthR = B.y + 12;
        this._depthBars = (A.y + B.y) / 2 + 12;
        this._faceLine = [A, B];
        this._seamBiasL = 0;
        this._seamBiasR = 0;
        this._destroySprites();
        const sprites = createGateSprites(cfg0, this._cx, this._cy, k, this._depthL, this._depthR, this._depthBars, !!cfg0.flipX);
        this.spriteL = sprites ? sprites.spriteL : null;
        this.spriteR = sprites ? sprites.spriteR : null;
        this.sprite = sprites ? sprites.bars : null; // 栅栏精灵驱动 16 帧动画
        this._gateSeg = {
            x1: A.x, y1: A.y, x2: B.x, y2: B.y,
            halfThick: cfg0.halfThick,
            _gate: true, _gateHole: true,
        };
        // [GATE-DETECT-FIX 2026-08-16] 感应中心 = 门洞物理中心（面线中点），
        // 不能用精灵中心 _cx/_cy——贴图等距偏移让检测球偏入门内 ~74px，
        // 门外单位被关门段挡在 150px 检测半径之外，永远触发不了开门（卡门根因）。
        this._detectX = (A.x + B.x) / 2;
        this._detectY = (A.y + B.y) / 2;
        // 三段面线注册进遮挡仲裁（pillar 恒注册；bars 随开关注册/移除）
        this._unregisterSegs();
        this._depthSegs = gateDepthSegs(A, B, this._depthL, this._depthR, this._depthBars);
        const reg = gateSegRegistry();
        if (reg) {
            for (const s of this._depthSegs) reg.push(s);
        }
        // 状态机默认关闭：门洞碰撞注册（阻挡）；友军靠近时 _update 自动打开
        this.state = 'closed';
        this._frame = 0;
        this._closeTimer = 0;
        this.setPassable(false);
        // 裁剪与门共线/重叠的掩体碰撞段（避免开门后贴柱走位被掩体段截停）
        trimCoverSegsForGate(this, A, B);
        return true;
    },

    _unregisterSegs() {
        const reg = gateSegRegistry();
        if (!reg || !this._depthSegs) return;
        for (const s of this._depthSegs) {
            const i = reg.indexOf(s);
            if (i >= 0) reg.splice(i, 1);
        }
        this._depthSegs = null;
    },

    /** 栅栏段面线随开关切换：开门（放行）时移除，关门时注册（栅栏消失后不再遮挡）。 */
    _setBarsSeg(enabled) {
        const reg = gateSegRegistry();
        if (!reg || !this._depthSegs || !this._depthSegs[1]) return;
        const s = this._depthSegs[1];
        const i = reg.indexOf(s);
        if (enabled && i < 0) reg.push(s);
        else if (!enabled && i >= 0) reg.splice(i, 1);
    },

    _destroySprites() {
        for (const s of [this.spriteL, this.spriteR, this.sprite]) {
            if (s && s.destroy) s.destroy();
        }
        this.spriteL = this.spriteR = this.sprite = null;
    },

    /** 应用拼接缝偏置（左门右柱盖右门左柱，2026-08-16）；同步精灵与遮挡面线段。 */
    _applySeamBias() {
        const bL = this._seamBiasL || 0;
        const bR = this._seamBiasR || 0;
        if (this.spriteL) this.spriteL.setDepth(this._depthL + bL);
        if (this.spriteR) this.spriteR.setDepth(this._depthR + bR);
        if (this._depthSegs) {
            if (this._depthSegs[0]) this._depthSegs[0].depth = this._depthL + bL;
            if (this._depthSegs[2]) this._depthSegs[2].depth = this._depthR + bR;
        }
    },

    /** 状态机默认关闭 → 友军靠近打开 → 友军离开延时关闭（2026-08-15）。 */
    update(dt) {
        if (!this._gateSeg) return;
        const OPEN_RADIUS = 150;
        const CLOSE_LINGER_S = 1.2; // dt 单位为秒
        const dxx = this._detectX ?? this._cx;
        const dyy = this._detectY ?? this._cy;
        const f = nearbyFriendlyUnit(dxx, dyy);
        const near = !!f && Math.hypot(f.x - dxx, f.y - dyy) <= OPEN_RADIUS;
        if (near) {
            this._closeTimer = 0;
            if (this.state === 'closed' || this.state === 'closing') this.open();
        } else {
            this._closeTimer = (this._closeTimer || 0) + dt;
            if ((this.state === 'open' || this.state === 'opening') && this._closeTimer >= CLOSE_LINGER_S) {
                this.close();
            }
        }
    },

    setPassable(passable) {
        this._setBarsSeg(!passable); // 关门=栅栏面线注册；开门=移除
        if (!WallSystem || !WallSystem.isoSegments || !this._gateSeg) return;
        const i = WallSystem.isoSegments.indexOf(this._gateSeg);
        if (!passable && i < 0) {
            WallSystem.isoSegments.push(this._gateSeg);
        } else if (passable && i >= 0) {
            WallSystem.isoSegments.splice(i, 1);
        }
        if (pathFinder && typeof pathFinder.invalidateRegion === 'function') {
            const s = this._gateSeg;
            pathFinder.invalidateRegion(
                Math.min(s.x1, s.x2), Math.min(s.y1, s.y2),
                Math.max(s.x1, s.x2), Math.max(s.y1, s.y2));
        }
    },

    open() {
        if (this.state === 'open' || this.state === 'opening') return;
        this.state = 'opening';
        this.setPassable(true);
        this._playSound('open');
        this._play(0, (this._cfg || GATE_CONFIG).frames - 1);
    },

    close() {
        if (this.state === 'closed' || this.state === 'closing') return;
        unstickUnitsFromGate(
            { x: this._gateSeg.x1, y: this._gateSeg.y1 },
            { x: this._gateSeg.x2, y: this._gateSeg.y2 },
            this._cfg.halfThick
        );
        this.state = 'closing';
        this.setPassable(false);
        this._playSound('close');
        this._play((this._cfg || GATE_CONFIG).frames - 1, 0);
    },

    /** 铁栅栏门开关音效（世界音效距离衰减，2026-08-16；用户素材 1.mp3，开关共用） */
    _playSound(which) {
        if (!SoundManager || typeof SoundManager.playWorld !== 'function') return;
        void which; // 开/关共用同一音效（用户指定）
        const path = 'assets/sounds/environment/gate_iron.mp3';
        const sx = this._detectX ?? this._cx ?? 0;
        const sy = this._detectY ?? this._cy ?? 0;
        SoundManager.playWorld(path, sx, sy);
    },

    toggle() {
        if (this.state === 'open' || this.state === 'opening') this.close();
        else this.open();
    },

    _play(from, to) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (this.sprite) this.sprite.setFrame(from);
        if (!scene) {
            this._frame = to;
            this.state = to === 0 ? 'closed' : 'open';
            return;
        }
        if (this._animCounter) this._animCounter.stop();
        this._animCounter = scene.tweens.addCounter({
            from,
            to,
            duration: (this._cfg || GATE_CONFIG).animMs,
            ease: 'Linear',
            onUpdate: (tw) => {
                const f = Math.round(tw.getValue());
                if (this.sprite) this.sprite.setFrame(f);
            },
            onComplete: () => {
                this._frame = to;
                this.state = to === 0 ? 'closed' : 'open';
            },
        });
    },

    destroy() {
        if (this._animCounter) { this._animCounter.stop(); this._animCounter = null; }
        this.setPassable(true);
        restoreTrimmedCovers(this);
        this._unregisterSegs();
        this._destroySprites();
        this._gateSeg = null;
        this.state = 'open';
    },
};

/**
 * 可建造铁栅栏门（建筑面板 B 放置，2026-08-15）：
 * 与掩体墙同口径（可被攻击/修理、footprint/face 线/深度锚点），
 * 参与建筑吸附（GATE_SNAP），默认关闭，友军靠近自动开门、离开延时关门。
 */
/**
 * 世界-122 射击台（FiringPlatform，2026-08-16 二版重做）：
 * 三级台阶 + 顶部站台的防御建筑。玩家/友方走上站台（顶面区域判定 _onPlatform）后，
 * 远程弹道/魔法忽略己方掩体墙段（_cover），可越过围墙向外攻击（与防御塔同机制）。
 *
 * 贴墙几何（用户口径 2026-08-16 三版起：平台主体沿墙放置 = 拓宽掩体立方体）：
 * - 平台长轴平行墙 face 线（rot.z 44.8 与掩体完全一致），实体 = 墙段中点 + 内侧法线
 *   × (墙半厚 26 + 余量 30)；台阶（贴图底部）从墙边向房内延伸——玩家从房内（近端）
 *   走上台阶到站台（贴墙远端）。
 * - 站台顶面在贴图上部（远端靠墙），台阶在贴图下部（近端房内）——平台顶面 = 玩家站立区。
 * - 朝向：`orient`（'h'/'v'）= 所贴墙段的 face 朝向；`mirror` = flipX 镜像（贴墙
 *   另一侧）。sprite 不旋转（等距贴图旋转破坏视角），朝向仅影响贴图镜像。
 *
 * 显示（四版）：内容 567×677（aspect 0.838）→ 显示 260×310，footOffsetY 155
 * （脚底=接地线）。站台顶面中心标定：贴图 (400, 40)、接地线 y=676 → 显示偏移
 * (+54, -136)；platformHeight≈291（玩家站台上 sprite 上移量 = 顶面到接地线显示距离）。
 *
 * 登台判定（四版）：单位投影到「登台走廊」（顶面中心沿 -wallNormal 向房内延伸
 * corridorLen=300、半宽 100）→ getLift 连续插值 0~platformHeight（走上台阶连续升高，
 * 不再布尔瞬移）；isOnPlatform = lift>0 兼容旧调用。
 * 深度：贴图锚定接地线 _faceDepth = y+12；站台上单位在 GameScene 仅当 _platformLift>0
 * 时显式抬到 _faceDepth+1。
 */
class FiringPlatform extends Combatant {
    constructor(x, y, config = {}) {
        const hp = config.hp ?? 800;
        super(x, y, {
            faction: 'player',
            hp,
            maxHp: hp,
            size: config.size ?? 60,
            collisionRadius: 30,
            name: config.name ?? '射击台',
        });
        this.id = config.id || `firing_platform_${Math.random().toString(36).slice(2, 7)}`;
        this._isFiringPlatform = true;
        this._isDefenseStructure = true; // 怪物可锁定攻击（防御建筑）
        this.noSeparation = true;
        this.noNameLabel = true;
        this._noShadow = true;   // 贴图自带接地底座
        this.immovable = true;   // 不可击退/位移
        // 朝向（2026-08-16 二版）：orient = 所贴墙 face 朝向（h/v），mirror = 贴墙另一侧
        this.orient = config.orient || 'v';
        this._facingLeft = !!config.mirror;
        // 贴墙几何：贴墙法线方向（从墙指向房内）由 _placeInitialPlatform / 吸附代码
        // 计算传入 config.wallNormal（单位向量）；顶面中心 = 实体 + 法线 × platformDepth
        const wn = config.wallNormal || null;
        this._wallNormal = wn;
        // 显示（内容 567×677 → 260×310，脚底=接地线；v 版 + h 镜像 flipX）
        // 2026-08-16 四版：掩体同管线（rot 44.8）拓宽立方体平台 + 5 级亮踏面台阶衔接
        const dispW = 260;
        const dispH = Math.round(dispW * 677 / 567); // ≈310
        this.spriteCfg = {
            idleKey: this._facingLeft ? 'firing_platform_h' : 'firing_platform',
            size: dispW,
            sizeH: dispH,
            footOffsetY: Math.round(dispH / 2),
        };
        this.footOffsetY = this.spriteCfg.footOffsetY;
        // 站台几何（贴图标定，2026-08-16 四版）：
        // 平台顶面（站台）中心 ≈ 内容 (400, 40)，接地线 y=676 → 显示偏移：
        //   dx = (400-283) * 260/567 ≈ +54
        //   dy = (40-338) * 310/677 ≈ -136 → 顶面在实体上方
        // platformHeight = 顶面到接地线显示距离 = (676-40) * 310/677 ≈ 291
        this.platformHeight = Math.round((676 - 40) * dispH / 677); // ≈291
        this._topOffsetX = Math.round((400 - 283) * dispW / 567);   // ≈+54
        this._topOffsetY = Math.round((40 - 338) * dispH / 677);    // ≈-136
        // 顶面中心世界坐标：平台主体沿墙放置（三版），站台顶面在实体上方贴图偏移处；
        // wallNormal 仅用于朝向记录（贴墙侧判定），顶面位置不变（平台就在墙边）
        this._topCx = x + this._topOffsetX;
        this._topCy = y + this._topOffsetY;
        if (wn) {
            // 平台主体贴墙（同掩体沿墙放置）：台阶（贴图底部）朝房内 = 法线方向，
            // 站台顶面在实体上方 + 沿墙方向微偏——顶面中心保持贴图偏移即可
            this._topCx = x + this._topOffsetX;
            this._topCy = y + this._topOffsetY;
        }
        this._zoneHalfW = 90;
        this._zoneHalfH = 70;
        // ⚠ 登台走廊（2026-08-16 四版：平滑衔接替代布尔瞬移）：
        // 台阶从贴图底部（接地线，房内端）延伸到站台顶面（贴墙端）。走廊 =
        // 以顶面中心为近墙端、沿「墙内侧法线反方向（房内）」延伸 corridorLen 的矩形带；
        // 单位在走廊内按「法线方向进度 t」插值抬升高度（0→platformHeight），
        // 走出走廊抬升归 0——走上台阶是连续升高，不再"进区瞬移"。
        // 走廊纵深（世界 px）：5 级台阶 local-y 跨度 ≈232 + 平台纵深 ≈ 对应显示投影，
        // 由 wallNormal 方向从顶面中心向房内延伸。
        this._corridorLen = 300;
        this._corridorHalfW = 100;
        if (wn) {
            // 房内方向 = -wallNormal（顶面贴墙，向房内 = 反法线）
            this._corridorDirX = -wn.x;
            this._corridorDirY = -wn.y;
        } else {
            this._corridorDirX = 0;
            this._corridorDirY = 1; // 无墙信息时默认向屏幕下方（房内）
        }
        // 贴图本体深度锚定 = 接地线（实体 y + 12，与掩体同规则）——平台是竖塔，
        // 站台上的单位（sprite 已上移 platformHeight，自然深度 = 顶面+10）天然比平台浅，
        // 再在 GameScene 显式抬到 _faceDepth+1（顶面线离地面 >60px 仲裁窗口不生效，
        // 不能靠 junctionCorrectedDepth；2026-08-16 设计修正）
        this._faceLine = null; // 不参与 junctionCorrectedDepth（见上注释）
        this._faceDepth = y + 12;
        this.rebuildCollider();
    }

    /**
     * 登台走廊内当前位置的抬升高度（连续插值，0~platformHeight）：
     * 把 (ux,uy) 投影到走廊轴上（顶面中心 → 房内方向 corridorLen），
     * t = 投影进度（0=顶面/最高，1=台阶入口/地面）→ lift = (1-t) × platformHeight。
     * 走廊外（横向超宽或纵深超出）→ 0（在地面）。
     */
    getLift(ux, uy) {
        const dx = ux - this._topCx, dy = uy - this._topCy;
        const ax = this._corridorDirX, ay = this._corridorDirY;
        // 走廊横向（垂直走廊轴）距离
        const perp = dx * (-ay) + dy * ax;
        if (Math.abs(perp) > this._corridorHalfW) return 0;
        // 走廊纵深投影（沿走廊轴，向房内为正）
        const along = dx * ax + dy * ay;
        if (along < -20) return 0; // 在顶面后方（墙内）→ 不算
        const t = Math.min(1, Math.max(0, along / this._corridorLen));
        return Math.round((1 - t) * this.platformHeight);
    }

    /** 登台判定：抬升 > 0 即视为在台上（兼容旧调用） */
    isOnPlatform(ux, uy) {
        return this.getLift(ux, uy) > 0;
    }

    /** 站台顶面世界坐标（供 GameScene 抬高玩家 sprite / 深度） */
    topCenter() {
        return { x: this._topCx, y: this._topCy };
    }

    destroy() {
        this.active = false;
    }
}

class BuildableGate extends Combatant {
    constructor(x, y, config = {}) {
        const grade = config.grade || 'D';
        const orient = config.orient || 'v';
        const mirror = !!config.mirror;
        const eff = mirror ? (orient === 'v' ? 'h' : 'v') : orient;
        const hp = config.hp ?? (DEFENSE_CONFIG.covers.hp[grade] ?? 400);
        super(x, y, {
            faction: 'player',
            hp,
            maxHp: hp,
            size: config.size ?? 60,
            collisionRadius: 26,
            name: config.name || `铁栅栏门·${grade}级`,
        });
        this.id = config.id || `defense_gate_${grade}_${Math.random().toString(36).slice(2, 7)}`;
        this._isDefenseStructure = true;
        this._isCoverGate = true;
        this.noSeparation = true;
        // 门不参与实体分离（resolveCollisions 的 rect 分支）：门的阻挡/放行完全由
        // _gateSeg 面线段承担（关门注册/开门移除）。若保留 198×133 的实体矩形碰撞，
        // 开门时玩家站在门洞内会被该矩形沿长轴持续横向推出（≈21.5px/帧）——被推到
        // 门柱/墙边卡住，门一开又被"释放"穿过门洞 = 用户反馈的"卡柱 + 开门瞬移"。
        // noCollision 只跳过实体间分离，墙段碰撞（WallSystem.isoSegments）不受影响。
        this.noCollision = true;
        this.noNameLabel = true;
        this._noShadow = true;   // 障碍物取消脚底阴影
        this.immovable = true;   // 不可被击退/位移
        this.def = 0;
        this.mdef = 0;
        this.data.def = 0;
        this.data.mdef = 0;
        this.grade = grade;
        this.orient = orient;
        this._facingLeft = mirror;
        const cfg = gateConfigFor(grade);
        this._cfg = cfg;
        // face 线（与掩体墙同斜率/同接地偏移，跨度 = 门洞宽）
        const half = cfg.worldFaceLen / 2;
        const midY = y - 65;
        if (eff === 'v') {
            this._faceLine = [
                { x: x - half, y: midY + half * 0.5 },
                { x: x + half, y: midY - half * 0.5 },
            ];
        } else {
            this._faceLine = [
                { x: x - half, y: midY - half * 0.5 },
                { x: x + half, y: midY + half * 0.5 },
            ];
        }
        this._faceDepth = Math.max(this._faceLine[0].y, this._faceLine[1].y) + 12;
        this._coverHalfThick = cfg.halfThick;
        // footprint（与掩体同口径：198×133、厚 26）
        const foot = (COVER_FOOT[eff] || COVER_FOOT[orient] || COVER_FOOT.v);
        this.collisionShape = 'rect';
        this.collisionWidth = foot.w;
        this.collisionHeight = foot.d;
        this.colliderOffsetY = foot.offY ?? 0;
        // 门洞碰撞段：默认关闭 → 注册阻挡；开门放行
        this._gateSeg = {
            x1: this._faceLine[0].x, y1: this._faceLine[0].y,
            x2: this._faceLine[1].x, y2: this._faceLine[1].y,
            halfThick: cfg.halfThick,
            _gate: true, _gateHole: true,
        };
        // [GATE-DETECT-FIX 2026-08-16] 与基地门同口径：感应中心 = 门洞物理中心，
        // 非精灵中心 _spriteCx/_spriteCy（等距偏移使门外单位够不到检测半径）
        this._detectX = (this._gateSeg.x1 + this._gateSeg.x2) / 2;
        this._detectY = (this._gateSeg.y1 + this._gateSeg.y2) / 2;
        if (WallSystem && WallSystem.isoSegments) WallSystem.isoSegments.push(this._gateSeg);
        // 裁剪与门共线/重叠的掩体碰撞段（贴柱走位不被掩体段截停）
        trimCoverSegsForGate(this, this._faceLine[0], this._faceLine[1]);
        this.state = 'closed';
        this._frame = 0;
        this._closeTimer = 0;
        // 门模式（2026-08-15 建筑面板按钮）：'auto' 友军靠近自动开关（默认）；
        // 'locked' 常锁——任何单位经过都不开；'open' 常开——门口保持敞开
        this.gateMode = 'auto';
        this._initGateSprite(cfg);
        this.rebuildCollider();
    }

    _initGateSprite(cfg) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (!scene || !scene.textures.exists(cfg.tex)) return;
        const k = cfg.displayScale;
        const midTexX = (cfg.faceA.x + cfg.faceB.x) / 2;
        const midTexY = (cfg.faceA.y + cfg.faceB.y) / 2;
        this._spriteCx = (this._faceLine[0].x + this._faceLine[1].x) / 2 - (midTexX - cfg.cellW / 2) * k;
        this._spriteCy = (this._faceLine[0].y + this._faceLine[1].y) / 2 - (midTexY - cfg.cellH / 2) * k;
        // 三段深度精灵（与基地门同图层设计，2026-08-15）：
        // 左柱=深端、右柱=浅端、栅栏=中点，各自按底边线锚定，前实体不再被右柱整体遮挡
        const A = this._faceLine[0];
        const B = this._faceLine[1];
        this._depthL = A.y + 12;
        this._depthR = B.y + 12;
        this._depthBars = (A.y + B.y) / 2 + 12;
        this._faceDepth = Math.max(A.y, B.y) + 12; // 与掩体同口径的通用锚点
        this._seamBiasL = 0;
        this._seamBiasR = 0;
        const sprites = createGateSprites(cfg, this._spriteCx, this._spriteCy, k, this._depthL, this._depthR, this._depthBars, this._facingLeft);
        this.spriteL = sprites ? sprites.spriteL : null;
        this.spriteR = sprites ? sprites.spriteR : null;
        this.sprite = sprites ? sprites.bars : null;
        if (this.sprite) {
            this._phaserSprite = this.sprite; // GameScene 识别为已托管精灵，不再自建
        }
        this._unregisterSegs();
        this._depthSegs = gateDepthSegs(A, B, this._depthL, this._depthR, this._depthBars);
        const reg = gateSegRegistry();
        if (reg) {
            for (const s of this._depthSegs) reg.push(s);
        }
    }

    _unregisterSegs() {
        const reg = gateSegRegistry();
        if (!reg || !this._depthSegs) return;
        for (const s of this._depthSegs) {
            const i = reg.indexOf(s);
            if (i >= 0) reg.splice(i, 1);
        }
        this._depthSegs = null;
    }

    _setBarsSeg(enabled) {
        const reg = gateSegRegistry();
        if (!reg || !this._depthSegs || !this._depthSegs[1]) return;
        const s = this._depthSegs[1];
        const i = reg.indexOf(s);
        if (enabled && i < 0) reg.push(s);
        else if (!enabled && i >= 0) reg.splice(i, 1);
    }

    /** 应用拼接缝偏置（左门右柱盖右门左柱，2026-08-16）；同步精灵与遮挡面线段。 */
    _applySeamBias() {
        const bL = this._seamBiasL || 0;
        const bR = this._seamBiasR || 0;
        if (this.spriteL) this.spriteL.setDepth(this._depthL + bL);
        if (this.spriteR) this.spriteR.setDepth(this._depthR + bR);
        if (this._depthSegs) {
            if (this._depthSegs[0]) this._depthSegs[0].depth = this._depthL + bL;
            if (this._depthSegs[2]) this._depthSegs[2].depth = this._depthR + bR;
        }
    }

    /**
     * 门模式切换（2026-08-15 建筑面板详情按钮）：
     * locked = 常锁（无论谁经过都不打开）；open = 常开（保持门口敞开）；auto = 原自动逻辑
     */
    setMode(mode) {
        this.gateMode = mode;
        if (mode === 'locked') this.close();
        else if (mode === 'open') this.open();
    }

    /** 状态机默认关闭 → 友军靠近打开 → 友军离开延时关闭（与基地门同口径）。 */
    update(dt) {
        if (!this._gateSeg || !this.active) return;
        // 常锁/常开模式闸门（2026-08-15）：锁定态强制关、常开态强制开，均跳过自动感应
        if (this.gateMode === 'locked') {
            if (this.state !== 'closed' && this.state !== 'closing') this.close();
            return;
        }
        if (this.gateMode === 'open') {
            if (this.state !== 'open' && this.state !== 'opening') this.open();
            return;
        }
        const OPEN_RADIUS = 150;
        const CLOSE_LINGER_S = 1.2;
        const dxx = this._detectX ?? this._spriteCx;
        const dyy = this._detectY ?? this._spriteCy;
        const f = nearbyFriendlyUnit(dxx, dyy);
        const near = !!f && Math.hypot(f.x - dxx, f.y - dyy) <= OPEN_RADIUS;
        if (near) {
            this._closeTimer = 0;
            if (this.state === 'closed' || this.state === 'closing') this.open();
        } else {
            this._closeTimer = (this._closeTimer || 0) + dt;
            if ((this.state === 'open' || this.state === 'opening') && this._closeTimer >= CLOSE_LINGER_S) {
                this.close();
            }
        }
    }

    setPassable(passable) {
        this._setBarsSeg(!passable); // 关门=栅栏面线注册；开门=移除（栅栏消失后不再遮挡）
        if (!WallSystem || !WallSystem.isoSegments || !this._gateSeg) return;
        const i = WallSystem.isoSegments.indexOf(this._gateSeg);
        if (!passable && i < 0) {
            WallSystem.isoSegments.push(this._gateSeg);
        } else if (passable && i >= 0) {
            WallSystem.isoSegments.splice(i, 1);
        }
        if (pathFinder && typeof pathFinder.invalidateRegion === 'function') {
            const s = this._gateSeg;
            pathFinder.invalidateRegion(
                Math.min(s.x1, s.x2), Math.min(s.y1, s.y2),
                Math.max(s.x1, s.x2), Math.max(s.y1, s.y2));
        }
    }

    open() {
        if (this.state === 'open' || this.state === 'opening') return;
        this.state = 'opening';
        this.setPassable(true);
        this._playSound('open');
        this._play(0, this._cfg.frames - 1);
    }

    close() {
        if (this.state === 'closed' || this.state === 'closing') return;
        unstickUnitsFromGate(
            { x: this._gateSeg.x1, y: this._gateSeg.y1 },
            { x: this._gateSeg.x2, y: this._gateSeg.y2 },
            this._cfg.halfThick
        );
        this.state = 'closing';
        this.setPassable(false);
        this._playSound('close');
        this._play(this._cfg.frames - 1, 0);
    }

    /** 铁栅栏门开关音效（世界音效距离衰减，2026-08-16；用户素材 1.mp3，开关共用） */
    _playSound(which) {
        if (!SoundManager || typeof SoundManager.playWorld !== 'function') return;
        void which; // 开/关共用同一音效（用户指定）
        const path = 'assets/sounds/environment/gate_iron.mp3';
        const sx = this._detectX ?? this._spriteCx ?? this.x;
        const sy = this._detectY ?? this._spriteCy ?? this.y;
        SoundManager.playWorld(path, sx, sy);
    }

    _play(from, to) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (this.sprite) this.sprite.setFrame(from);
        if (!scene) {
            this._frame = to;
            this.state = to === 0 ? 'closed' : 'open';
            return;
        }
        if (this._animCounter) this._animCounter.stop();
        this._animCounter = scene.tweens.addCounter({
            from,
            to,
            duration: this._cfg.animMs,
            ease: 'Linear',
            onUpdate: (tw) => {
                const f = Math.round(tw.getValue());
                if (this.sprite) this.sprite.setFrame(f);
            },
            onComplete: () => {
                this._frame = to;
                this.state = to === 0 ? 'closed' : 'open';
            },
        });
    }

    takeDamage(damage, source, damageType, isMelee) {
        // 沉陷死亡由 onDeath 接管
        return super.takeDamage(damage, source, damageType, isMelee);
    }

    /** 铁栅栏门沉陷死亡（2026-08-16 推广）：先摘碰撞/门段，精灵随特效下沉清除 */
    onDeath(_source) {
        this.active = true;
        this.hittable = false;
        this._sinking = true;
        this._teardownCollision();
        if (EffectManager) {
            EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, '铁栅栏门被摧毁', '#ff8855'));
            EffectManager.add(new BuildingSinkEffect(this, () => {
                const sp = [this.spriteL, this.spriteR, this.sprite].filter(Boolean);
                this.spriteL = this.spriteR = this.sprite = null;
                return sp;
            }));
        }
    }

    _teardownVisual() {
        this._teardownCollision();
        for (const s of [this.spriteL, this.spriteR, this.sprite]) {
            if (s && s.destroy) s.destroy();
        }
        this.spriteL = this.spriteR = this.sprite = null;
        this._phaserSprite = null;
    }

    /** 碰撞/门段清理（保留精灵，供沉陷特效接管） */
    _teardownCollision() {
        if (this._animCounter) { this._animCounter.stop(); this._animCounter = null; }
        restoreTrimmedCovers(this);
        this._unregisterSegs();
        if (WallSystem && WallSystem.isoSegments && this._gateSeg) {
            const i = WallSystem.isoSegments.indexOf(this._gateSeg);
            if (i >= 0) WallSystem.isoSegments.splice(i, 1);
        }
        this._gateSeg = null;
    }

    destroy() {
        this._teardownVisual();
        this.active = false;
    }
}

// ==================== E 键修理（仅世界-122，2026-08-14）====================
// 按住 E 持续修理附近受伤的掩体/防御塔（消耗背包能源）；松开停止。
// 用捕获监听保证先于 input.js 的 handleKey（其不拦截 KeyE，但避免面板/编辑器状态误触发）。
//
// 2026-08-15 用户要求停用：E 键与游戏快捷键冲突。修理入口改为建筑面板（B）
// 详情视图的「修理」按钮（BuildingSystem._repairCover，仅掩体）。
// _setRepairHeld / _repairTick 方法体保留备用，此处不再注册任何监听器。

export {
    DefenseBase, DefenseCover, DefenseTower, BuildableGate, FiringPlatform,
    GATE_GEOM, GATE_GRADES, gateConfigFor, GATE_CONFIG, syncGateSeamDepths,
};
