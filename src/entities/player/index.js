// Player class - split into modules for maintainability

import { Combatant } from '../combatant.js';
import { ThrustAttack, RangedAttack } from '../../combat/attack.js';
import { WeaponEffect } from '../../effects/weapon-effect.js';
import { PoisonEffect } from '../../effects/poison-effect.js';
import { DashSystem } from '../components/dash-system.js';
import { WhirlwindSystem } from '../components/whirlwind-system.js';
import { PushStrikeSystem } from '../components/push-strike-system.js';
import { SpecialAttackSystem } from '../components/special-attack-system.js';
import { RuneSwordSystem } from '../components/rune-sword-system.js';
import { IceSpikeSystem } from '../components/ice-spike-system.js';
import { FireballSystem } from '../components/fireball-system.js';
import { DroneSystem } from '../components/drone-system.js';
import { ShieldSystem } from '../components/shield-system.js';

import { baseMixin } from './base.js';
import { updateMixin } from './update.js';
import { weaponAnimMixin } from './weapon-anim.js';
import { renderMixin } from './render.js';
import { subsystemsMixin } from './subsystems.js';

class Player extends Combatant {
  constructor(x, y) {
    super(x, y);
            this.size = CONFIG.PLAYER_SIZE; this.collisionRadius = 15; this.initHitbox(15, [1.2, 1.0, 0.8, 1.5, 0.8, 1.0]); this.speed = CONFIG.PLAYER_SPEED; this.maxSpeed = CONFIG.PLAYER_SPEED; this.accel = 0.7; this.friction = 0.82; this.animTime = 0; this.isMoving = false; this.hittable = true; this._isDead = false; this._deathTimer = 0; this.hitFlash = 0; this.hitFlashDuration = 300; this._facingDir = 'down';
            this.isDodging = false; this.dodgeTimer = 0; this.dodgeCooldown = 0; this.dodgeDirection = { x: 0, y: 0 }; this.dodgeInvincible = false;
            this.weaponSwitchCooldown = 0; // 武器切换冷却：切换 G18 后防止立即开火
            this._sprintDuration = 0; // 冲刺持续时间（长按Shift计时）
            this._isDashing = false; // 是否正在执行冲刺攻击
            this._dashState = 'idle'; // dash状态: idle/charge/slash/recover
            this._dashTimer = 0; // 冲刺攻击计时器
            this._dashDirection = { x: 0, y: 0 }; // 冲刺方向
            this._dashStartPos = { x: 0, y: 0 }; // 冲刺起始位置
            this._dashHitSet = new Set(); // 冲刺攻击已命中目标
        this._dashKillCount = 0; // 冲刺攻击击杀计数
            this._dashConvergeAuraActive = false; // 冲刺就绪金色光环
            this._dashConvergeShown = false; // 冲刺汇聚特效已播放标记
            this._dashBounceApplied = false; // 撞墙弹回是否已应用
            this._dashSlashShown = false; // 白色扇形特效已播放标记
            this._dashSlashEffect = null; // 扇形特效实例引用
            this._dashParticles = []; // 冲刺攻击粒子数组
            this._dashResetAnim = null; // 冲刺攻击后复位动画
            this._isWhirlwind = false; // 是否正在执行风车
            this._whirlwindTimer = 0; // 风车计时器
            this._whirlwindHitSet = new Set(); // 风车已命中目标
            this._whirlwindDuration = 800; // 风车总时长 800ms
            this._whirlwindHitChecked = false; // 风车攻击判定是否已执行
            this._whirlwindRangeEffect = null; // 风车范围提示效果引用
            // ===== 推击技能状态 =====
            this._isPushStrike = false; // 是否正在执行推击
            this._pushStrikeTimer = 0; // 推击计时器
            this._pushStrikeHitSet = new Set(); // 推击已命中目标
            this._pushStrikeHitChecked = false; // 推击攻击判定是否已执行
            this._pushStrikeRangeEffect = null; // 推击范围提示效果引用
            this.pushStrikeSystem = new PushStrikeSystem(this); // 推击技能系统
            // ===== 每个特殊攻击类型的独立冷却 { [specialAttackType]: ms } =====
            this._specialAttackCooldowns = {};
            // ===== 夜与火之剑特殊攻击状态 =====
            this._specialAttackActive = false; // 是否正在释放特殊攻击
            this._specialAttackTimer = 0; // 特殊攻击计时器
            this._specialAttackHitSet = new Set(); // 特殊攻击已命中目标
            this._specialAttackLastTick = 0; // 上次伤害判定时间
            this._specialAttackAngle = 0; // 光柱方向
            this._specialAttackBeam = null; // 光柱特效实例
            this._specialAttackLockedAngle = 0; // 特殊攻击锁定朝向
            this._specialAttackClampedLength = 1500; // 特殊攻击被障碍物截断后的长度（已放大25%）
            this._specialResetAnim = null; // 特殊攻击后复位动画
            // ===== 符文长剑特殊攻击状态 =====
            this._runeSwordSpecialActive = false; // 符文长剑特殊攻击是否激活
            this._runeSwordSpecialTimer = 0; // 累计计时（30秒超时）
            this._runeSwordSwords = []; // 4把剑状态数组
            this._runeSwordBladeImg = null; // 剑贴图
            this._runeSwordResetAnim = null; // 符文长剑复位动画
            // ===== 冰锥技能状态 =====
            this._iceSpikeActive = false; // 冰锥是否已生成
            this._iceSpikeTimer = 0; // 悬浮持续时间计时
            this._iceSpikeCooldown = 0; // 冷却（ms）
            this._iceSpikeSpikes = []; // 冰锥数组
            this._iceSpikeImg = null; // 冰锥贴图
            // ===== 火球技能状态 =====
            this._fireballActive = false; // 火球是否已生成
            this._fireballTimer = 0; // 悬浮持续时间计时
            this._fireballCooldown = 0; // 冷却（ms）
            this._fireball = null; // 火球对象
            this._fireballImg = null; // 火球贴图
            // ===== 蓄力攻击状态（边境长弓） =====
            this._chargeState = 'idle'; // idle/charging/charged/firing
            this._chargeTimer = 0; // 蓄力计时器
            this._chargeFlashTimer = 0; // 闪光计时器
            this._chargeFlashActive = false; // 是否正在闪光
            // ===== 装备-技能联动系统 =====
            this._skillOverrides = {}; // 当前装备的技能覆盖 { skillId: overrideData }
            this.attacks = {
                melee: new ThrustAttack({ cooldown: 500, range: 116, width: 25, damage: { min: 12, max: 20 }, knockback: 8 }),
                ranged: new RangedAttack({ cooldown: 600, projectileSpeed: 1248, projectileRange: 1000, projectileSize: 9, damage: { min: 8, max: 16 }, piercing: false }),
                pistol: new RangedAttack({ cooldown: 55, projectileSpeed: 1248, projectileRange: 650, projectileSize: 4, damage: { min: 4, max: 8 }, piercing: false, knockback: 0 }),
                deagle: new RangedAttack({ cooldown: 800, projectileSpeed: 1248, projectileRange: 750, projectileSize: 5, damage: { min: 4, max: 8 }, piercing: false, knockback: 10 }),
                // 副手独立攻击对象（双持时互不干扰）
                pistolOffhand: new RangedAttack({ cooldown: 55, projectileSpeed: 1248, projectileRange: 650, projectileSize: 4, damage: { min: 4, max: 8 }, piercing: false, knockback: 0 }),
                deagleOffhand: new RangedAttack({ cooldown: 800, projectileSpeed: 1248, projectileRange: 750, projectileSize: 5, damage: { min: 4, max: 8 }, piercing: false, knockback: 10 }),
                p4040: new RangedAttack({ cooldown: 300, projectileSpeed: 1248, projectileRange: 750, projectileSize: 4, damage: { min: 2, max: 4 }, piercing: false, knockback: 2 }),
                p4040Offhand: new RangedAttack({ cooldown: 300, projectileSpeed: 1248, projectileRange: 750, projectileSize: 4, damage: { min: 2, max: 4 }, piercing: false, knockback: 2 }),
                pkm: new RangedAttack({ cooldown: 92, projectileSpeed: 1248, projectileRange: 1200, projectileSize: 5, damage: { min: 1, max: 1 }, piercing: false }),
                akm: new RangedAttack({ cooldown: 100, projectileSpeed: 1248, projectileRange: 1200, projectileSize: 5, damage: { min: 1, max: 1 }, piercing: false }),
                qbz191: new RangedAttack({ cooldown: 70, projectileSpeed: 1248, projectileRange: 1200, projectileSize: 5, damage: { min: 1, max: 1 }, piercing: false }),
                qjb201: new RangedAttack({ cooldown: 60, projectileSpeed: 1248, projectileRange: 1200, projectileSize: 5, damage: { min: 1, max: 1 }, piercing: false }),
                energy_lmg: new RangedAttack({ cooldown: 333, projectileSpeed: 1248, projectileRange: 1200, projectileSize: 5, damage: { min: 1, max: 1 }, piercing: false, knockback: 0 }),
                super90: new RangedAttack({ cooldown: 333, projectileSpeed: 1248, projectileRange: 500, projectileSize: 6, damage: { min: 1, max: 1 }, piercing: false, knockback: 12.5 }),
                saiga12k: new RangedAttack({ cooldown: 150, projectileSpeed: 1248, projectileRange: 400, projectileSize: 6, damage: { min: 1, max: 1 }, piercing: false, knockback: 12.5 })
            };
            // 应用剑精通的冷却缩减
            SkillManager.updateMeleeCooldown(this);
            // 应用弓精通的冷却缩减
            SkillManager.updateBowCooldown(this);
            this.gameStartCooldown = 500; // 游戏开始后500ms内禁止攻击，防止点击"开始游戏"的鼠标事件携带到游戏中
            this.data = {
                name: '轮回者', level: 1, class: '初心者', hp: 100, maxHp: 100, mp: 100, maxMp: 100,
                stamina: CONFIG.STAMINA_MAX, maxStamina: CONFIG.STAMINA_MAX, exp: 0, maxExp: 52,
                str: 10, dex: 10, int: 10, con: 10, wis: 10, luck: 10,
                atk: 0, def: 0, matk: 0, mdef: 0, hit: 0, dodge: 0, crit: 0, critRes: 0, aspd: 0, speed: 0,
                loopCount: 0, surviveDays: 1, kills: 0, quests: 0, geneLock: '未开启', rank: 'F',
                attrPoints: 0,
                hpRegen: 1, // 每秒生命回复
                mpRegen: 1  // 每3秒魔法回复（实际为1/3点/秒）
            };
            this._faction = 'player'; // 新增：阵营标识
            this.skills = this._initSkills();
            this.equipments = {};
            this.hasMeleeWeapon = true; // 是否有主武器（剑），false = 空手
            this.meleeImage = new Image(); this.meleeImage.src = 'assets/weapons/1-rusty_sword_euip.png';
            this.bowFrames = [];
            for (let i = 1; i <= 8; i++) { const img = new Image(); img.src = `assets/weapons/bow_frame_${String(i).padStart(2, '0')}.png`; this.bowFrames.push(img); }
            this.equippedBowFrames = null; // 装备后的弓贴图，null表示使用默认弓
            this.bowEquipImage = new Image(); this.bowEquipImage.src = 'assets/weapons/trainingBOW.png'; // 弓装备栏贴图
            this.pistolImage = new Image(); this.pistolImage.src = 'assets/weapons/G18equip.png';
            this.deagleImage = new Image(); this.deagleImage.src = 'assets/weapons/Desert eagle-eqiup.png';
            this.p4040Image = new Image(); this.p4040Image.src = 'assets/weapons/P4040-equip.png';
            this.pkmImage = new Image(); this.pkmImage.src = 'assets/weapons/pkm_topdown.png';
            this.akmImage = new Image(); this.akmImage.src = 'assets/weapons/akm_topdown_lowpoly_v2长枪管.png';
            this.qbz191Image = new Image(); this.qbz191Image.src = 'assets/weapons/191equip_clean.png';
            this.qjb201Image = new Image(); this.qjb201Image.src = 'assets/weapons/201equip.png';
            this.super90Image = new Image(); this.super90Image.src = 'assets/weapons/M4s90_equip.png';
            this.saiga12kImage = new Image(); this.saiga12kImage.src = 'assets/weapons/S12k-equip.png';
            this.energyLmgImage = new Image(); this.energyLmgImage.src = 'assets/weapons/devotion-equip.png';
            this.shieldImage = new Image(); this.shieldImage.src = 'assets/weapons/woodshied-equip.png';
            // 角色动画已由 Phaser 接管，不再加载 Canvas 精灵图
            this._stickFigure = false;
            this.equippedRangedType = null;
            this.arrowImage = new Image(); this.arrowImage.src = 'assets/ammo/arrow.png';
            this.weaponEffect = new WeaponEffect(); // 武器符文发光粒子效果（已从 Player 中拆出）
            this.dashSystem = new DashSystem(this); // 冲刺攻击系统
            this.whirlwindSystem = new WhirlwindSystem(this); // 风车技能系统
            this.specialAttackSystem = new SpecialAttackSystem(this); // 夜与火之剑特殊攻击系统
            this.runeSwordSystem = new RuneSwordSystem(this); // 符文长剑特殊攻击系统
            this.iceSpikeSystem = new IceSpikeSystem(this); // 冰锥技能系统
            this.fireballSystem = new FireballSystem(this); // 火球技能系统
            this.droneSystem = new DroneSystem(this); // 无人机技能系统
            this.shieldSystem = new ShieldSystem(this); // 盾防御系统
            // ===== 独头弹后坐力系统（Super90）=====
            this._slugRecoilLayers = 0; // 后坐力层数
            this._slugRecoilTimer = 0; // 后坐力恢复计时器
            // ===== 高倍镜瞄准模式 =====
            this._aimModeActive = false; // 是否处于瞄准模式
            // ===== 魔法晶尘（附魔系统）=====
            this.magicDust = 0; // 魔法晶尘数量
            // ===== 弹药显示UI =====
            this._poisonEffect = new PoisonEffect(); // 中毒绿色粒子效果
            this._ammoDisplayEl = null;
            this._initAmmoDisplay();
            this._usePhaserSprite = false;
            this._usePhaserWeapon = false;
            this._droneVulnerabilityStacks = 0;
            this._droneVulnerabilityTimer = 0;
            this.calculateCombatStats();
            this.updateMaxStats();
  }
}

Object.assign(Player.prototype, baseMixin);
Object.assign(Player.prototype, updateMixin);
Object.assign(Player.prototype, weaponAnimMixin);
Object.assign(Player.prototype, renderMixin);
Object.assign(Player.prototype, subsystemsMixin);

export { Player };
