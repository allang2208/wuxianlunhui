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
import { Combatant } from '../entities/combatant.js';
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
import { BasePanel } from '../ui/panels/base-panel.js';
import { Renderer } from './renderer.js';
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
        cornerExtend: 45,   // 边链 face 向两端顶点各延伸 45px（≥ 端帽 52 的一半，转角叠盖）
        openEdge: 'RB',
        openRadius: 90,     // 开放带半宽：face 命中该带的边链件跳过 → 居中门洞 ≈270（沿边）
        doorAlignY: 0,      // 新拼接规则下门柱底边与墙线天然共线，无需旧版下移精调
    },
    // 无预置防御塔（玩家用 B 建筑面板自行摆放）
    towers: [],
    tower: {
        hp: 1400, radius: 44, def: 70, mdef: 70,
        maxLevel: 10,
        baseCost: 120, costGrowth: 1.55, levelDamageMul: 0.22,
    },
    spawn: {
        firstDelay: 6000,
        interval: 5000,
        maxAlive: 40,
        waveSeconds: 25,
        baseCount: 2,
        countPerWave: 1.2,
        countCap: 12,
        hpPerWave: 0.16,
        atkPerWave: 0.08,
        alertRange: 3800,
        // 精英/领主定时刷（在普通怪流之上额外生成）
        eliteEveryMs: 30000,
        lordEveryMs: 90000,
        eliteHpMul: 1.4,
        lordHpMul: 2.8,
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
const TOWER_WEAPON_TYPES = ['bow', 'pkm', 'akm', 'qbz191', 'qjb201', 'shotgun', 'energy_lmg'];

/** 防御塔每发基准伤害（按武器类型；行业惯例按 DPS 反推的占位数值，后续数值打磨） */
const BASE_WEAPON_DAMAGE = { bow: 42, pkm: 6, akm: 9, qbz191: 10, qjb201: 7, shotgun: 10, energy_lmg: 8 };
const BASE_WEAPON_DAMAGE_BY_ID = { super90: 12, saiga12k: 10 };

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
    { type: 'zombieDog', weight: 10 },
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

/** 掩体贴图内容框宽高比（2026-08-05 自然贴图重做后实测），显示宽度统一 260，高度按比例 */
// 显示宽高比（路线 B：Blender 完整 box 棱柱，sizeH=260 使世界底边斜率 = 0.4976）
const COVER_ASPECT = {
    F: { h: 1.0, v: 1.0 },
    E: { h: 1.0, v: 1.0 },
    D: { h: 1.0, v: 1.0 },
    C: { h: 1.0, v: 1.0 },
    B: { h: 1.0, v: 1.0 },
    A: { h: 1.0, v: 1.0 },
};
const COVER_DISPLAY_W = 260;

/**
 * 掩体墙段底边线（face line）端点偏移（相对掩体脚底 x/y，世界像素），按级别标定。
 * 与 building-system 的吸附端点同源（贴图内容底边 = 墙段接地线）：
 * - v（"/"）：A=低端（近地），B=高端（远地）
 * - h（"\"）：镜像，A=高端，B=低端
 * 数值来源：路线 B（Blender 完整 box 棱柱 + AI 材质纹理）渲染图底边端点标定
 * （prep-cover-render.py，2026-08-05 自然贴图重做后复标：A(-88,-21)/B(88,-109)）。
 * 完整 box 实心端帽使端帽底部与正面底边共线，拼接处脚底线连续无凸起。
 * 几何统一 → 6 级 face 完全一致，
 * 同向/跨级拼接天然共线；h 一律 = v 镜像派生。
 * 供图层排序（深度锚点 = max 底边端点 y + 12）和遮挡仲裁（junctionCorrectedDepth 面线）使用。
 */
export const COVER_FACE = {
    F: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -109 } }, h: { A: { x: -88, y: -109 }, B: { x: 88, y: -21 } } },
    E: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -109 } }, h: { A: { x: -88, y: -109 }, B: { x: 88, y: -21 } } },
    D: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -109 } }, h: { A: { x: -88, y: -109 }, B: { x: 88, y: -21 } } },
    C: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -109 } }, h: { A: { x: -88, y: -109 }, B: { x: 88, y: -21 } } },
    B: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -109 } }, h: { A: { x: -88, y: -109 }, B: { x: 88, y: -21 } } },
    A: { v: { A: { x: -88, y: -21 }, B: { x: 88, y: -109 } }, h: { A: { x: -88, y: -109 }, B: { x: 88, y: -21 } } },
};
/** 兼容旧访问（COVER_FACE.v / COVER_FACE.h）：默认取 D 级 */
COVER_FACE.v = COVER_FACE.D.v;
COVER_FACE.h = COVER_FACE.D.h;

/**
 * 玩家摆放掩体的碰撞 footprint（墙段底部判定面积，参考 WallSystem 障碍物 foot 口径）：
 * 墙段 face 从 (x±88, y-25..y-112) → 沿墙段 ±thick 的轴对齐 AABB 198×133，
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
        w: 170,
        h: 31,
        s: 170 / 347,
        pivot: { x: 173, y: 64 },
        tip: { x: 331, y: 5 },
        naturalAngle: -0.3697,
        pivotWorldY: 242,
    },
    weapon: {
        // 挂载武器显示高度（按高度等比缩放，与玩家枪械 setScale 口径一致；朝左 flipY）
        heights: { bow: 120, pkm: 100, akm: 96, qbz191: 92, qjb201: 100, shotgun: 105, energy_lmg: 100 },
        defaultHeight: 90,
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
            this._faceDepth = Math.max(this._faceLine[0].y, this._faceLine[1].y) + 12;
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
            };
            WallSystem.isoSegments.push(this._coverSeg);
        }
        // 贴图：水平摆(_h)/垂直摆(_v) 两组；显示尺寸按内容框宽高比校准
        const tex = `obstacle_cover_${grade}_${orient}`;
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
            this._coverSeg = null;
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
        const def = config.def ?? DEFENSE_CONFIG.tower.def;
        const mdef = config.mdef ?? DEFENSE_CONFIG.tower.mdef;
        this.def = def;
        this.mdef = mdef;
        this.data.def = def;
        this.data.mdef = mdef;
        // 贴图：世界-122 防御塔（正面平视基座+上方机械臂空挂载点，2026-08-04 二轮重生成入库，
        // 内容框 539×832/宽高比 0.648）
        this.spriteCfg = { idleKey: 'obstacle_defense_tower', size: 170, sizeH: 262, footOffsetY: 131 };
        this.footOffsetY = 131;
        this.level = 1;
        this.maxLevel = DEFENSE_CONFIG.tower.maxLevel;
        this.weaponItem = null;
        this._attackKey = null;
        this.range = 800;
        this._currentSpreadFactor = 0.08;
        this._currentSpreadMaxAngle = 7;
        // 机械臂朝向（世界角，y 向下；自然姿态=臂贴图原始朝向）
        this.aimAngle = DEFENSE_TOWER_VISUAL.arm.naturalAngle;
        this._aimTargetPos = null;
        this.rebuildCollider();
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
        return Math.max(1, Math.round(base * this._statMul(player) * levelMul));
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
            if (WallSystem && typeof WallSystem.blocked === 'function' && WallSystem.blocked(this.x, this.y, e.x, e.y)) continue;
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
            // 散弹：一次击发多发弹丸（直接复用开火特效）
            const pellets = this.weaponItem.pelletCount || (this.weaponItem.weaponId === 'saiga12k' ? 4 : 6);
            for (let i = 0; i < pellets; i++) {
                attack.cooldown = 0;
                const jx = aimX + (Math.random() - 0.5) * 90;
                const jy = aimY + (Math.random() - 0.5) * 90;
                this._fireShot(jx, jy, entities);
            }
        } else {
            this._fireShot(aimX, aimY, entities);
        }
    }

    /** 单发开火：枪口偏移 + 墙体回退 + 弹丸（复用 Combatant.fireProjectile）+ 枪口火焰/开火火光/弹壳 */
    _fireShot(aimX, aimY, entities) {
        if (!this._attackKey || !this.attacks[this._attackKey]) return false;
        // 枪口 = 机械臂尖（枢轴 + 旋转后的臂尖偏移）+ 沿瞄准方向小幅前置
        const V = DEFENSE_TOWER_VISUAL;
        const s = V.arm.s;
        const pivotX = this.x;
        const pivotY = this.y - V.arm.pivotWorldY;
        const rot = this.aimAngle - V.arm.naturalAngle;
        const tdx = (V.arm.tip.x - V.arm.pivot.x) * s;
        const tdy = (V.arm.tip.y - V.arm.pivot.y) * s;
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);
        let mx = pivotX + tdx * cosR - tdy * sinR + Math.cos(this.aimAngle) * 16;
        let my = pivotY + tdx * sinR + tdy * cosR + Math.sin(this.aimAngle) * 16;
        const ox = this.x;
        const oy = this.y;
        // 枪口点落进墙内时回退到可达点，防止子弹出生即撞墙消失
        if (WallSystem && typeof WallSystem.resolve === 'function') {
            const resolved = WallSystem.resolve(ox, oy, mx, my, 4);
            mx = resolved.x;
            my = resolved.y;
        }
        this.x = mx;
        this.y = my;
        const fired = this.fireProjectile(aimX, aimY, entities, { slot: 'weapon' });
        this.x = ox;
        this.y = oy;
        if (!fired) return false;
        const angle = Math.atan2(aimY - my, aimX - mx);
        EffectFactory.createMuzzleFlash(mx, my, angle, 1.4);
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (scene && typeof scene.playMuzzleFire === 'function') {
            scene.playMuzzleFire(mx, my);
        }
        EffectFactory.createShellCasing(mx, my, angle, oy);
        const snd = TOWER_FIRE_SOUNDS[this.weaponItem ? this.weaponItem.weaponId : ''] || TOWER_FIRE_SOUNDS[this.weaponItem ? this.weaponItem.weaponType : ''];
        if (snd && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(snd);
        }
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
        if (target) {
            this._aimTargetPos = {
                x: target.x,
                y: (target.collider ? target.collider.y : target.y) - 40,
            };
            this._fireAtTarget(target, entities);
        }
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
            'position:fixed;right:26px;top:50%;transform:translateY(-50%);width:370px;',
            'background:rgba(16,15,13,0.97);border:2px solid #6a5a3a;border-radius:10px;',
            'padding:16px 18px;color:#d4c5a9;font-family:SimHei,"Microsoft YaHei",sans-serif;',
            'box-shadow:0 8px 30px rgba(0,0,0,0.65);z-index:9000;',
        ].join('');
        el.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div id="dtTitle" style="font-size:18px;font-weight:700;color:#ffd700;"></div>
                <button id="dtClose" style="background:#3a3228;color:#d4c5a9;border:1px solid #6a5a3a;border-radius:6px;padding:4px 12px;cursor:pointer;">关闭</button>
            </div>
            <div id="dtWeaponSlot" style="border:1px dashed #6a5a3a;border-radius:8px;padding:10px;margin-bottom:10px;background:rgba(0,0,0,0.25);"></div>
            <div style="font-size:13px;color:#9a8a6a;margin-bottom:6px;">可装载武器（背包 · 远程 · 手枪除外）</div>
            <div id="dtWeaponList" style="max-height:210px;overflow-y:auto;border:1px solid #3a3528;border-radius:8px;padding:4px 8px;margin-bottom:12px;"></div>
            <div id="dtUpgrade" style="border:1px solid #4a4a2a;border-radius:8px;padding:10px;background:rgba(60,50,20,0.18);"></div>
            <div id="dtStatHint" style="margin-top:8px;font-size:12px;color:#8a8a8a;"></div>
        `;
        el.querySelector('#dtClose').addEventListener('click', () => this.close());
    }

    openFor(tower, player) {
        this.tower = tower;
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

    refresh() {
        const el = this.el;
        if (!el || !this.tower) return;
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

        // 六维参考
        const d = player && player.data ? player.data : {};
        el.querySelector('#dtStatHint').textContent =
            `六维加成参考：力量 ${d.str ?? 10} / 敏捷 ${d.dex ?? 10} / 体质 ${d.con ?? 10} / 智力 ${d.int ?? 10} / 精神 ${d.wis ?? 10} / 幸运 ${d.luck ?? 10}`;
    }
}

// ==================== 防守系统 ====================

export const DefenseSystem = {
    active: false,
    defeated: false,
    base: null,
    towers: [],
    _spawnTimer: 0,
    _eliteTimer: 0,
    _lordTimer: 0,
    _elapsed: 0,
    _seq: 0,
    _panel: null,

    _ensurePanel() {
        if (!this._panel) this._panel = new DefenseTowerPanel();
        return this._panel;
    },

    setup(player) {
        this.teardown();
        this.active = true;
        this.defeated = false;
        this._elapsed = 0;
        this._spawnTimer = DEFENSE_CONFIG.spawn.firstDelay;
        this._eliteTimer = 0;
        this._lordTimer = 0;
        this._seq = 0;
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
                id: `defense_cover_${i}`,
            });
            Game.entities.set(`defense_cover_${i}`, cover);
        });

        if (player) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 60, '世界-122 防守战开始！守住基地核心', '#ffd700'));
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
        const openEdge = room.openEdge;
        const openRadius = room.openRadius ?? 90;
        const layout = [];
        for (const e of edges) {
            const dx = e.to.x - e.from.x, dy = e.to.y - e.from.y;
            const len = Math.hypot(dx, dy);
            const ux = dx / len, uy = dy / len;
            // 边链覆盖 [−cornerExt, len+cornerExt]；n 件均布，相邻 face 重叠 ≥40px
            const span = len + 2 * cornerExt;
            const n = Math.max(2, Math.ceil((span - faceLen) / step) + 1);
            const spacing = n > 1 ? (span - faceLen) / (n - 1) : 0;
            const t0 = -cornerExt + faceLen / 2;
            const openMid = e.key === openEdge ? len / 2 : null;
            const alignY = e.key === openEdge ? (room.doorAlignY || 0) : 0;
            for (let i = 0; i < n; i++) {
                const t = t0 + i * spacing;
                // face 沿边区间 [t−faceLen/2, t+faceLen/2] 命中开放带则跳过（门洞）
                if (openMid !== null) {
                    const f0 = t - faceLen / 2;
                    const f1 = t + faceLen / 2;
                    if (f1 > openMid - openRadius && f0 < openMid + openRadius) continue;
                }
                layout.push({
                    x: Math.round(e.from.x + ux * t),
                    y: Math.round(e.from.y + uy * t) + alignY,
                    grade: room.coverGrade,
                    orient: e.orient,
                });
            }
        }
        DEFENSE_CONFIG.covers.layout = layout;
    },

    teardown() {
        this.active = false;
        this.defeated = false;
        this.base = null;
        this.towers = [];
        this._spawnTimer = 0;
        this._eliteTimer = 0;
        this._lordTimer = 0;
        this._elapsed = 0;
        this._seq = 0;
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
        this._spawnTimer += dt;
        this._eliteTimer += dt;
        this._lordTimer += dt;
        // 随时间推进，刷怪间隔逐渐缩短（有下限）
        const interval = Math.max(1500, DEFENSE_CONFIG.spawn.interval - Math.floor(this._elapsed / 60000) * 300);
        if (this._spawnTimer >= interval) {
            this._spawnTimer = 0;
            this._spawnWave();
        }
        // 精英每 30s 一刷、领主每 90s 一刷（在普通流之上额外生成）
        if (this._eliteTimer >= DEFENSE_CONFIG.spawn.eliteEveryMs) {
            this._eliteTimer = 0;
            this._spawnElite();
        }
        if (this._lordTimer >= DEFENSE_CONFIG.spawn.lordEveryMs) {
            this._lordTimer = 0;
            this._spawnLord();
        }
    },

    _spawnWave() {
        const wave = Math.floor(this._elapsed / (DEFENSE_CONFIG.spawn.waveSeconds * 1000)) + 1;
        const count = Math.min(
            DEFENSE_CONFIG.spawn.countCap,
            Math.floor(DEFENSE_CONFIG.spawn.baseCount + wave * DEFENSE_CONFIG.spawn.countPerWave)
        );
        for (let i = 0; i < count; i++) {
            if (this._aliveCount() >= DEFENSE_CONFIG.spawn.maxAlive) break;
            this._spawnMonster(wave, NORMAL_POOL);
        }
    },

    _aliveCount() {
        let n = 0;
        for (const e of Game.entities.values()) {
            if (e && e._defenseMonster && e.active && e.hp > 0) n++;
        }
        return n;
    },

    _spawnMonster(wave, pool, hpMulExtra = 1) {
        const type = this._pickMonsterType(pool);
        const Factory = MONSTER_FACTORY[type];
        if (!Factory) return;
        const pt = DEFENSE_CONFIG.spawnPoints[Math.floor(Math.random() * DEFENSE_CONFIG.spawnPoints.length)];
        const monster = new Factory(pt.x, pt.y);
        monster._defenseMonster = true;
        // 防守模式：只锁定基地/防御塔（PerceptionSystem/Enemy._findNearestPlayer 已支持）
        monster._preferDefenseTargets = true;
        monster._alertRange = DEFENSE_CONFIG.spawn.alertRange;
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
        const wave = Math.floor(this._elapsed / (DEFENSE_CONFIG.spawn.waveSeconds * 1000)) + 1;
        this._spawnMonster(wave, ELITE_POOL, DEFENSE_CONFIG.spawn.eliteHpMul);
        this._announce('精英来袭！', '#ff8800', 'assets/sounds/enemies/armored_knight/attacking.mp3');
    },

    _spawnLord() {
        const wave = Math.floor(this._elapsed / (DEFENSE_CONFIG.spawn.waveSeconds * 1000)) + 1;
        this._spawnMonster(wave, LORD_POOL, DEFENSE_CONFIG.spawn.lordHpMul);
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
        for (const t of this.towers) {
            if (!t.active) continue;
            if (!inReach(t, 70)) continue;
            if (panel.isOpen && panel.tower === t) {
                panel.close();
            } else {
                panel.openFor(t, player);
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

export { DefenseBase, DefenseCover, DefenseTower };
