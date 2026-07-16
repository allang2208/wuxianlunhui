// Player class - split into modules for maintainability

import { Combatant } from '../combatant.js';
import { WEAPON_ATTACK_CONFIG, createAttackFromConfig } from '../../config/weapon-attack-config.js';
import { PLAYER_DEFAULTS } from '../../config/player-defaults.js';
import { loadImage, loadImageFrames } from '../../utils/image-loader.js';
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
import { subsystemsMixin } from './subsystems.js';
import { CONFIG } from '../../config/config.js';
import { SkillManager } from '../../ui/skill-manager.js';

class Player extends Combatant {
  constructor(x, y) {
    super(x, y);
            const defs = PLAYER_DEFAULTS;
            this.size = CONFIG.PLAYER_SIZE; this.collisionRadius = defs.physics.collisionRadius; this.speed = CONFIG.PLAYER_SPEED; this.maxSpeed = CONFIG.PLAYER_SPEED; this.accel = defs.physics.accel; this.friction = defs.physics.friction; this.animTime = 0; this.isMoving = false; this.hittable = true; this._isDead = false; this._deathTimer = 0; this.hitFlash = 0; this.hitFlashDuration = defs.combat.hitFlashDuration; this._facingDir = 'down';
            // 玩家受击/碰撞体积：由配置驱动的矩形，避免硬编码
            this.collisionShape = 'rect';
            this.collisionWidth = defs.physics.collisionWidth;
            this.collisionHeight = defs.physics.collisionHeight;
            // 让 Collider 高度与贴图 spriteSize 一致（120），否则只取 collisionHeight=60，
            // 导致调试胶囊体和受击判定都只有贴图一半高。
            this.config = {
                ...(this.config || {}),
                height: defs.physics.spriteSize,
                render: { ...(this.config?.render || {}), spriteSize: defs.physics.spriteSize }
            };
            // 根据最终碰撞字段重建统一 3D Collider（地面 footprint 与胶囊体）
            this.rebuildCollider();
            this.isDodging = false; this.dodgeTimer = 0; this.dodgeCooldown = 0; this.dodgeDirection = { x: 0, y: 0 }; this.dodgeInvincible = false;
            this.weaponSwitchCooldown = defs.combat.weaponSwitchCooldown; // 武器切换冷却：切换 G18 后防止立即开火
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
            this._whirlwindDuration = defs.whirlwind.duration; // 风车总时长
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
            this._specialAttackClampedLength = defs.specialAttack.clampedLength; // 特殊攻击被障碍物截断后的长度（已放大25%）
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
            this.attacks = {};
            for (const [key, cfg] of Object.entries(WEAPON_ATTACK_CONFIG)) {
                this.attacks[key] = createAttackFromConfig(cfg);
            }
            // 应用剑精通的冷却缩减
            SkillManager.updateMeleeCooldown(this);
            // 应用弓精通的冷却缩减
            SkillManager.updateBowCooldown(this);
            this.gameStartCooldown = defs.combat.gameStartCooldown; // 游戏开始后禁止攻击，防止点击"开始游戏"的鼠标事件携带到游戏中
            this.data = {
                ...defs.data,
                stamina: CONFIG.STAMINA_MAX,
                maxStamina: CONFIG.STAMINA_MAX
            };
            this._faction = 'player'; // 新增：阵营标识
            this.skills = this._initSkills();
            this.equipments = {};
            this.hasMeleeWeapon = true; // 是否有主武器（剑），false = 空手
            this.meleeImage = loadImage(defs.images.melee);
            this.bowFrames = loadImageFrames(defs.bowFrames.prefix, defs.bowFrames.count);
            this.equippedBowFrames = null; // 装备后的弓贴图，null表示使用默认弓
            this.bowEquipImage = loadImage(defs.images.bowEquip);
            this.pistolImage = loadImage(defs.images.pistol);
            this.deagleImage = loadImage(defs.images.deagle);
            this.p4040Image = loadImage(defs.images.p4040);
            this.pkmImage = loadImage(defs.images.pkm);
            this.akmImage = loadImage(defs.images.akm);
            this.qbz191Image = loadImage(defs.images.qbz191);
            this.qjb201Image = loadImage(defs.images.qjb201);
            this.super90Image = loadImage(defs.images.super90);
            this.saiga12kImage = loadImage(defs.images.saiga12k);
            this.energyLmgImage = loadImage(defs.images.energyLmg);
            this.shieldImage = loadImage(defs.images.shield);
            // 角色动画已由 Phaser 接管，不再加载 Canvas 精灵图
            this._stickFigure = false;
            this.equippedRangedType = null;
            this.arrowImage = loadImage(defs.images.arrow);
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
            this._usePhaserSprite = true;
            this._usePhaserWeapon = true;
            this._droneVulnerabilityStacks = 0;
            this._droneVulnerabilityTimer = 0;
            this.calculateCombatStats();
            this.updateMaxStats();
            this.initWeaponAnim();
  }
}

Object.assign(Player.prototype, baseMixin);
Object.assign(Player.prototype, updateMixin);
Object.assign(Player.prototype, subsystemsMixin);
Object.assign(Player.prototype, weaponAnimMixin);

export { Player };
