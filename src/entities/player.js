import { Combatant } from './combatant.js';
import { ThrustAttack, RangedAttack } from '../combat/attack.js';
import { WeaponAnimConfig, getWeaponStateConfig } from '../items/weapon-anim-config.js';
import { WeaponEffect } from '../effects/weapon-effect.js';
import { PoisonEffect } from '../effects/poison-effect.js';
import { isGunWeapon, isMachineGun, isOneHanded, isTwoHanded } from '../config/gun-ammo.js';
import { computeWeaponAttack } from '../config/attack-formula.js';
import { DashSystem } from './components/dash-system.js';
import { WhirlwindSystem } from './components/whirlwind-system.js';
import { PushStrikeSystem } from './components/push-strike-system.js';
import { SpecialAttackSystem } from './components/special-attack-system.js';
import { RuneSwordSystem } from './components/rune-sword-system.js';
import { IceSpikeSystem } from './components/ice-spike-system.js';
import { FireballSystem } from './components/fireball-system.js';
import { DroneSystem } from './components/drone-system.js';
import { ShieldSystem } from './components/shield-system.js';
import { StatusBar } from '../ui/status-bar.js';


        class Player extends Combatant {
            constructor(x, y) {
                super(x, y); this.size = CONFIG.PLAYER_SIZE; this.collisionRadius = 15; this.initHitbox(15, [1.2, 1.0, 0.8, 1.5, 0.8, 1.0]); this.speed = CONFIG.PLAYER_SPEED; this.maxSpeed = CONFIG.PLAYER_SPEED; this.accel = 0.7; this.friction = 0.82; this.animTime = 0; this.isMoving = false; this.hittable = true; this._isDead = false; this._deathTimer = 0; this.hitFlash = 0; this.hitFlashDuration = 300; this._facingDir = 'down';
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
                // 火柴人模式：不再加载角色精灵图
                this._stickFigure = true;
                // 跑步精灵图（2x8=16帧，每帧512x512）
                this._runningSpriteSheet = new Image();
                this._runningSpriteSheet.src = 'assets/character/running.png';
                this._runningFrame = 0;        // 当前帧索引 0-15
                this._runningAnimTimer = 0;    // 动画计时器(ms)
                this._runningFrameDuration = 45; // 每帧持续时间(ms)，16帧约720ms一个循环
                this._runningSpriteLoaded = false;
                // 待机精灵图（单帧，带轻微抖动动画）
                this._idleSprite = new Image();
                this._idleSprite.src = 'assets/character/idle.png';
                this._idleShakeTimer = 0;
                // 行走精灵图（3x8=24格，实际21帧，每帧512x516）
                this._walkSpriteSheet = new Image();
                this._walkSpriteSheet.src = 'assets/character/walk.png';
                this._walkFrame = 0;        // 当前帧索引 0-20
                this._walkAnimTimer = 0;    // 行走动画计时器
                this._walkFrameDuration = 60; // 每帧60ms，21帧约1260ms一个循环
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
            calculateCombatStats() {
                const d = this.data;
                // 应用武器精通的属性加成
                let bonusStr = 0, bonusDex = 0, bonusWis = 0, bonusCon = 0;
                if (this.skills) {
                    if (this.skills.machineGunMastery) {
                        bonusStr += this.skills.machineGunMastery.getEffect(this.skills.machineGunMastery.level).strBonus;
                    }
                    if (this.skills.rifleMastery) {
                        bonusWis += this.skills.rifleMastery.getEffect(this.skills.rifleMastery.level).wisBonus;
                    }
                    if (this.skills.pistolMastery) {
                        bonusDex += this.skills.pistolMastery.getEffect(this.skills.pistolMastery.level).dexBonus;
                    }
                    if (this.skills.bowMastery) {
                        bonusDex += this.skills.bowMastery.getEffect(this.skills.bowMastery.level).dexBonus;
                    }
                    if (this.skills.shotgunMastery) {
                        bonusCon += this.skills.shotgunMastery.getEffect(this.skills.shotgunMastery.level).conBonus;
                    }
                }
                d.atk = Math.round(10 + (d.str + bonusStr) * 0.05 + (d.dex + bonusDex) * 0.1); d.def = Math.floor((d.con + bonusCon) * 1.2 + (d.str + bonusStr) * 0.3);
                // 应用改造效果：防御力变化
                if (this.equipments && this.weaponMode) {
                    const currentWpn = this.equipments[this.weaponMode];
                    if (currentWpn && currentWpn._craftEffects && currentWpn._craftEffects.defensePercent) {
                        d.def = Math.floor(d.def * (1 + currentWpn._craftEffects.defensePercent));
                    }
                }
                // 应用持盾防御技能的防御力加成
                if (this.equipments && this.skills && this.skills.shieldDefense) {
                    const offhandSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                    const shield = this.equipments[offhandSlot];
                    if (shield && shield.weaponType === 'shield') {
                        const sdEffect = this.skills.shieldDefense.getEffect(this.skills.shieldDefense.level);
                        d.def = Math.floor(d.def * (1 + sdEffect.defBonusPercent));
                    }
                }
                d.matk = Math.floor(d.int * 1.5 + (d.wis + bonusWis) * 0.5); d.mdef = Math.floor((d.wis + bonusWis) * 1.2 + d.int * 0.3);
                d.hit = 80 + Math.floor((d.dex + bonusDex) * 0.5); d.dodge = 5 + Math.floor((d.dex + bonusDex) * 0.3);
                d.crit = 2 + Math.floor(d.luck * 1.0); d.aspd = 1.0 + (d.dex + bonusDex) * 0.02;
                d.speed = CONFIG.PLAYER_SPEED + (d.dex + bonusDex) * 0.05;
                d.critRes = Math.floor(d.con * 1.0); // 暴击抵抗：每1点体质增加1%
                // 保存加成供其他系统使用
                this._masteryBonus = { str: bonusStr, dex: bonusDex, wis: bonusWis };
            }
            // 获取能量轻机枪参数（从当前装备配置读取，支持改造/强化调整）
            _getEnergyLMGParams() {
                const currentWpn = this.equipments[this.weaponMode];
                const params = currentWpn && currentWpn.energyLMGParams;
                const defaults = this._energyLMGDefaults || { baseCooldown: 333, maxCooldown: 50, rampUpTime: 2500, overheatTime: 4000, overheatRecoverTime: 2500, overheatCooldownTime: 4000, spreadMaxTime: 2500, maxSpreadAngle: 15 };
                if (!params) return defaults;
                return {
                    baseCooldown: params.baseCooldown ?? defaults.baseCooldown,
                    maxCooldown: params.maxCooldown ?? defaults.maxCooldown,
                    rampUpTime: params.rampUpTime ?? defaults.rampUpTime,
                    overheatTime: params.overheatTime ?? defaults.overheatTime,
                    overheatRecoverTime: params.overheatRecoverTime ?? defaults.overheatRecoverTime,
                    overheatCooldownTime: params.overheatCooldownTime ?? defaults.overheatCooldownTime,
                    spreadMaxTime: params.spreadMaxTime ?? defaults.spreadMaxTime,
                    maxSpreadAngle: params.maxSpreadAngle ?? defaults.maxSpreadAngle
                };
            }
            // 获取当前武器攻击力（状态栏同步计算，包含强化等级加成和武器精通加成）
            getCurrentWeaponAtk(itemOverride) {
                const currentWpn = itemOverride || this.equipments[this.weaponMode];
                if (!currentWpn) return 0;
                return computeWeaponAttack(currentWpn, this.data, this.skills);
            }
            // ===== 经验值系统 =====
            getExpForLevel(level) { return 20 + level * 20 + level * 12; }
            gainExp(amount) {
                if (amount <= 0) return;
                const d = this.data;
                d.exp += amount;
                // 显示获得经验浮动文字
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, `+${amount} EXP`, '#ffd700'));
                // 检查升级（支持溢出连续升级）
                while (d.exp >= d.maxExp) {
                    d.exp -= d.maxExp;
                    d.level++;
                    d.maxExp = this.getExpForLevel(d.level);
                    d.attrPoints += 2;
                    this.onLevelUp(d.level);
                }
                // 同步更新经验值UI（底部经验条）
                if (typeof GameUIManager !== 'undefined' && GameUIManager.updateUI) {
                    GameUIManager.updateUI();
                }
            }
            onLevelUp(level) {
                // 播放升级音效
                if (typeof SoundManager !== 'undefined' && SoundManager.playFile) {
                    SoundManager.playFile('assets/sounds/levelup_cyber_5s.wav');
                }
                // 使用特效队列顺序播放
                LevelUpEffectQueue.add({
                    type: 'playerLevelUp',
                    level: level,
                    icon: '⭐',
                    title: `等级提升！Lv.${level}`,
                    effectText: '获得2点属性点',
                    onShow: () => {
                        // 更新战斗属性
                        this.calculateCombatStats();
                        // 更新最大生命/魔法值
                        this.updateMaxStats();
                        // 如果面板正在打开，同步刷新UI
                        if (SystemUI.isOpen && SystemUI.currentTab === 'status') {
                            GameUIManager.updateUI();
                        }
                    }
                });
            }
            // ===== 死亡系统 =====
            takeDamage(damage, source, damageType = 'physical', isMelee = false) {
                // 主神空间（场景一）无敌
                if (SceneManager.currentScene === 'main') return;
                // 闪避无敌期间不受伤害
                if (this.dodgeInvincible) return;
                // 已死亡不处理
                if (this._isDead) return;
                const d = this.data;
                const critRate = (source && source.data && source.data.crit) || 0;
                const critRes = (d && d.critRes) || 0;
                // 附魔效果：暴击率加成
                let enchantCritBonus = 0;
                if (source && source.equipments) {
                    const weapon = source.equipments[source.weaponMode];
                    if (weapon && weapon._enchantEffects && weapon._enchantEffects.critRate) {
                        enchantCritBonus = weapon._enchantEffects.critRate * 100; // 转换为百分比
                    }
                }
                const finalCritRate = Math.max(0, critRate + enchantCritBonus - critRes);
                const isCrit = Math.random() * 100 < finalCritRate;
                // 应用暴击伤害加成
                let finalDamage = damage;
                // 次级格挡：装备宽十字护手时，受到攻击有50%概率减少50%伤害
                if (this.equipments && this.weaponMode) {
                    const currentWpn = this.equipments[this.weaponMode];
                    if (currentWpn && currentWpn._craftEffects && currentWpn._craftEffects.secondaryBlock) {
                        if (Math.random() < 0.5) {
                            finalDamage = Math.floor(finalDamage * 0.5);
                        }
                    }
                }
                if (isCrit && source && source.skills && source.skills.criticalStrike) {
                    const csEffect = source.skills.criticalStrike.getEffect(source.skills.criticalStrike.level);
                    finalDamage = Math.floor(damage * (1 + csEffect.damageBonus));
                }
                // 盾防御系统处理
                if (this.shieldSystem && this.shieldSystem.active && this.shieldSystem.defending) {
                    const result = this.shieldSystem.onDamageTaken(finalDamage, source, isMelee);
                    finalDamage = result.damage;
                    if (result.parried) {
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 20, '🛡️ 弹反！', '#c0a060'));
                        return;
                    }
                }
                // 应用无人机易伤：受到的所有伤害增加
                if (this._droneVulnerabilityStacks > 0) {
                    let droneBonus = 0.10 * this._droneVulnerabilityStacks;
                    if (source && source.skills && source.skills.droneSkill) {
                        const effect = source.skills.droneSkill.getEffect(source.skills.droneSkill.level);
                        droneBonus = (effect.damageBonusPercent / 100) * this._droneVulnerabilityStacks;
                    }
                    finalDamage = Math.floor(finalDamage * (1 + droneBonus));
                }
                d.hp -= finalDamage;
                this.hitFlash = this.hitFlashDuration;
                EffectManager.createDamageText(this.x, this.y - this.size, finalDamage, isCrit);
                if (isCrit) EffectManager.triggerCritEffects();
                const isKill = d.hp <= 0;
                if (isKill) { d.hp = 0; this.onDeath(); }
                // 暴击技能经验
                if (isCrit && source && SkillManager) {
                    SkillManager.addCriticalStrikeExp(source, isCrit, isKill);
                }
            }
            // 应用无人机易伤（被敌方无人机技能影响）
            applyDroneVulnerability(stacks) {
                this._droneVulnerabilityStacks = 1; // 固定1层，不再叠加
                this._droneVulnerabilityTimer = 999999; // [FIX] 设极大值，永不过期，由外部范围判定控制移除
                if (StatusBar) {
                    this._droneVulnerabilityEffectId = StatusBar.addEffect('droneVulnerability', 999999);
                }
            }
            // 移除无人机易伤
            removeDroneVulnerability() {
                this._droneVulnerabilityStacks = 0;
                this._droneVulnerabilityTimer = 0;
                if (this._droneVulnerabilityEffectId && StatusBar) {
                    StatusBar.removeEffect(this._droneVulnerabilityEffectId);
                    this._droneVulnerabilityEffectId = null;
                }
            }
            onDeath() {
                this._isDead = true;
                this._deathTimer = 3000; // 3秒后重生
                // 显示死亡提示
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, '你死了！3秒后重生', '#ff4444'));
                // 如果在任务模式中死亡，重置任务状态
                if (typeof QuestState !== 'undefined' && QuestState.isInQuest()) {
                    QuestState.reset();
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - 60, '任务失败，请重新与侍从对话', '#ff4444'));
                }
                // 死亡不掉落经验或装备（预留接口）
                if (typeof this._onDeathDrop === 'function') {
                    this._onDeathDrop();
                }
            }
            respawn() {
                this._isDead = false;
                this._deathTimer = 0;
                const d = this.data;
                d.hp = d.maxHp;
                d.mp = d.maxMp;
                d.stamina = d.maxStamina;
                // 清除所有状态效果
                this._poisonStacks = 0;
                this._poisonTimer = 0;
                this._poisonTickTimer = 0;
                if (this._poisonEffectId && StatusBar) {
                    StatusBar.removeEffect(this._poisonEffectId);
                    this._poisonEffectId = null;
                }
                // 清除眩晕状态
                this._dashStunned = false;
                this._dashStunTimer = 0;
                // 清除过热状态
                this._overheatActive = false;
                this._overheatValue = 0;
                this._overheatOverheated = false;
                this._overheatRecoverTimer = 0;
                this._overheatWeaponType = null;
                // 清除推击状态
                this._isPushStrike = false;
                this._pushStrikeTimer = 0;
                this._pushStrikeHitSet = new Set();
                this._pushStrikeHitChecked = false;
                // 清除符文长剑特殊状态
                this._runeSwordSpecialActive = false;
                this._runeSwordSpecialTimer = 0;
                this._runeSwordSwords = null;
                // 清除夜与火之剑特殊状态
                this._specialAttackActive = false;
                this._specialAttackTimer = 0;
                this._specialAttackEntities = null;
                // 清除所有特殊攻击冷却
                this._specialAttackCooldowns = {};
                // 清除无人机状态
                if (this.droneSystem) {
                    this.droneSystem._deactivate();
                }
                // 清除无人机易伤状态
                this._droneVulnerabilityStacks = 0;
                this._droneVulnerabilityTimer = 0;
                if (this._droneVulnerabilityEffectId && StatusBar) {
                    StatusBar.removeEffect(this._droneVulnerabilityEffectId);
                    this._droneVulnerabilityEffectId = null;
                }
                // 清除冰锥状态
                this._iceSpikeActive = false;
                this._iceSpikeTimer = 0;
                this._iceSpikeCooldown = 0;
                this._iceSpikeSpikes = [];
                // 清除火球状态
                this._fireballActive = false;
                this._fireballTimer = 0;
                this._fireballCooldown = 0;
                this._fireball = null;
                // 清除死亡粒子效果
                if (this._poisonEffect) this._poisonEffect.reset();
                // 重置所有弹药状态
                this._ammoState = { weapon: null, offhand: null, weapon2: null, ring2: null };
                // 重新初始化当前装备的弹药
                ['weapon', 'offhand', 'weapon2', 'ring2'].forEach(slot => this._initAmmoForSlot(slot));
                // 重生位置：主神空间 origin 点（固定坐标）
                const respawnPos = { x: SceneManager.scenes.main.origin.x, y: SceneManager.scenes.main.origin.y };
                if (SceneManager.currentScene !== 'main') {
                    // 从其他场景死亡回主神空间：统一关闭地牢系统（如有），使用 origin 点重生
                    if (typeof DungeonMapSystem !== 'undefined' && DungeonMapSystem.active) {
                        DungeonMapSystem.shutdown();
                    }
                    SceneManager._respawnPos = respawnPos;
                    SceneManager.switchScene('main', this);
                } else {
                    this.x = respawnPos.x;
                    this.y = respawnPos.y;
                    Camera.follow(this);
                    EffectManager.add(new FloatingTextEffect(this.x, this.y - 40, '已重生', '#7a9a6a'));
                }
            }
            // ===== 中毒效果系统 =====
            applyPoison(stacks) {
                const wasPoisoned = this._poisonTimer > 0;
                this._poisonStacks += stacks;
                this._poisonTimer = 5000;
                if (!wasPoisoned) {
                    this._poisonTickTimer = 1000;
                }
                if (StatusBar) {
                    this._poisonEffectId = StatusBar.addEffect('poison', 5000, { stacks: this._poisonStacks });
                }
                EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, `☠️ 中毒 +${stacks}层`, '#7a9a5a'));
            }
            // ===== 属性点系统 =====
            // 体质+10 HP, 精神+10 MP, 智力+5 MP, 敏捷+1% 体力恢复速度
            updateMaxStats() {
                const d = this.data;
                const oldMaxHp = d.maxHp;
                const oldMaxMp = d.maxMp;
                d.maxHp = 100 + d.con * 10;
                d.maxMp = 100 + d.wis * 10 + d.int * 5;
                // HP/MP 按比例缩放，避免满血时增加属性反而掉血
                if (oldMaxHp > 0) d.hp = Math.min(d.maxHp, d.hp + (d.maxHp - oldMaxHp));
                else d.hp = d.maxHp;
                if (oldMaxMp > 0) d.mp = Math.min(d.maxMp, d.mp + (d.maxMp - oldMaxMp));
                else d.mp = d.maxMp;
                // 体力恢复速度：每点敏捷 +1%
                const staminaRegenMul = 1.0 + d.dex * 0.01;
                // 保存倍率供 update 使用
                this._staminaRegenMul = staminaRegenMul;
            }
            // 分配属性点
            _initSkills() {
                // 优先从 JSON 数据加载技能配置
                if (typeof window !== 'undefined' && window.SKILL_DATA) {
                    const skills = {};
                    for (const [id, data] of Object.entries(window.SKILL_DATA)) {
                        if (typeof DataLoader !== 'undefined' && DataLoader.buildSkillFromJSON) {
                            skills[id] = DataLoader.buildSkillFromJSON(id, data);
                        } else {
                            // fallback: 手动构建技能对象
                            skills[id] = {
                                id: id,
                                name: data.name || id,
                                icon: data.icon || '✦',
                                iconImage: data.iconImage || '',
                                description: data.description || '',
                                level: 1,
                                maxLevel: data.maxLevel || 20,
                                exp: 0,
                                maxExp: 100,
                                tags: data.tags || [],
                                getEffect(level) {
                                    const result = {};
                                    if (data.effectFormula) {
                                        for (const [key, formula] of Object.entries(data.effectFormula)) {
                                            try { result[key] = new Function('level', `return ${formula}`)(level); }
                                            catch (e) { result[key] = 0; }
                                        }
                                    }
                                    return result;
                                },
                                getExpForNext(level) {
                                    if (data.expFormula) {
                                        try { return new Function('level', `return ${data.expFormula}`)(level); }
                                        catch (e) { return 100; }
                                    }
                                    return 100 + (level - 1) * 100;
                                }
                            };
                        }
                    }
                    // 兜底：确保暴击技能始终存在（即使JSON中没有定义）
                    if (!skills.criticalStrike) {
                        skills.criticalStrike = {
                            id: 'criticalStrike', name: '暴击', icon: '💥', iconImage: 'assets/skills/暴击.png',
                            description: '精通暴击之道，每次暴击都能造成更致命的打击',
                            level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                            tags: [{ name: '暴击', type: 'passive' }, { name: '被动', type: 'passive' }],
                            getEffect(level) { return { damageBonus: 0.50 + level * 0.05, luckBonus: level }; },
                            getExpForNext(level) { return 100 + (level - 1) * 100; }
                        };
                    }
                    // 兜底：确保冲刺攻击-火始终存在（即使JSON缓存了旧版本）
                    if (!skills.dashAttackFire) {
                        skills.dashAttackFire = {
                            id: 'dashAttackFire', name: '冲刺攻击-火', icon: '🔥', iconImage: 'assets/skills/冲刺攻击-火.png',
                            description: '夜与火之剑专属：冲刺后向前挥砍，武器路径上留下火焰轨迹，对路径上敌人造成毁灭性打击',
                            level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                            tags: [{ name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                            getEffect(level) { return { damageMul: 1.5 + level * 0.05, cooldownReduction: level * 0.02 }; },
                            getExpForNext(level) { return 100 + (level - 1) * 100; }
                        };
                    }
                    if (skills.dashAttackFire) {
                        skills.dashAttackFire.iconImage = 'assets/skills/冲刺攻击-火.png';
                    }
                    // 兜底：确保冲刺攻击-突刺始终存在（即使JSON缓存了旧版本）
                    if (!skills.dashAttackThrust) {
                        skills.dashAttackThrust = {
                            id: 'dashAttackThrust', name: '冲刺攻击-突刺', icon: '⚔', iconImage: 'assets/skills/冲刺突击.png',
                            description: '骑士长剑专属：冲刺后向前突刺，对路径上敌人造成多次伤害',
                            level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                            tags: [{ name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                            getEffect(level) { return { damageMul: 0.80 + level * 0.03, cooldownReduction: level * 0.02 }; },
                            getExpForNext(level) { return 100 + (level - 1) * 100; }
                        };
                    }
                    if (skills.dashAttackThrust) {
                        skills.dashAttackThrust.iconImage = 'assets/skills/冲刺突击.png';
                    }
                    // 兜底：确保冰锥技能始终存在
                    if (!skills.iceSpike) {
                        skills.iceSpike = {
                            id: 'iceSpike', name: '冰锥', icon: '❄', iconImage: 'assets/skills/Icearrow-skill.png',
                            description: '释放后在角色身后生成冰锥，再次释放将所有冰锥瞄准鼠标方向射出',
                            level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                            tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                            getEffect(level) { return { damageBase: 30 + level * 5, magicMul: 1.2 + 0.25 * level, intMul: 1.2 + 0.25 * level, cooldown: 10, mpCost: 30, spikeCount: 2 + Math.floor((level - 1) / 5), duration: 30, flySpeed: 800, maxRange: 800 }; },
                            getExpForNext(level) { return 100 + (level - 1) * 100; }
                        };
                    }
                    // 兜底：确保持盾防御技能始终存在
                    if (!skills.shieldDefense) {
                        skills.shieldDefense = {
                            id: 'shieldDefense', name: '持盾防御', icon: '🛡', iconImage: 'assets/skills/Meshy_AI_Shield Block Sword Warrior.png',
                            description: '精通盾牌防御之术，在持盾状态下获得更强的防御能力和弹反效果',
                            level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                            tags: [{ name: '盾牌', type: 'weapon' }, { name: '被动', type: 'passive' }],
                            getEffect(level) { return { defBonusPercent: level * 0.02, damageReductionBonus: level * 0.02, parryStunBonus: Math.floor(level / 5) * 0.25 }; },
                            getExpForNext(level) { return 100 + (level - 1) * 100; }
                        };
                    }
                    // 兜底：确保火球技能始终存在
                    if (!skills.fireball) {
                        skills.fireball = {
                            id: 'fireball', name: '火球', icon: '🔥', iconImage: 'assets/skills/fireball_icon.png',
                            description: '释放后在角色身前凝聚火球，再次释放将火球瞄准鼠标方向射出，命中后造成范围爆炸伤害',
                            level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                            tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                            getEffect(level) { return { damageBase: 80 + level * 10, magicMul: 2 + 0.5 * level, intMul: 2.5 + 0.75 * level, cooldown: 20, mpCost: 50, explosionRadius: 80 + level * 5, duration: 30, flySpeed: 1600, maxRange: 1200 }; },
                            getExpForNext(level) { return 100 + (level - 1) * 100; }
                        };
                    }
                    // 兜底：确保无人机技能始终存在（即使JSON中没有定义）
                    if (!skills.droneSkill) {
                        skills.droneSkill = {
                            id: 'droneSkill', name: '无人机', icon: '🚁', iconImage: 'assets/skills/drone_skill.png',
                            description: '释放无人机追踪目标，使目标获得易伤标记，受到的所有伤害增加',
                            level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                            tags: [{ name: '主动', type: 'active' }, { name: '魔法', type: 'magic' }],
                            getEffect(level) { return { damageBonus: 0.10 + level * 0.02, cooldown: 20, mpCost: 50, duration: 5 + level * 0.5 }; },
                            getExpForNext(level) { return 100 + (level - 1) * 100; }
                        };
                    }
                    return skills;
                }
                // 兜底：硬编码默认技能（JSON 加载失败时）
                return {
                    swordMastery: {
                        id: 'swordMastery', name: '剑精通', icon: '⚔',
                        description: '精通剑术，每次挥舞都更加致命',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '剑类武器', type: 'weapon' }, { name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { atkBonus: level, cooldownReduction: level * 0.01, dexBonus: level }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    dashAttack: {
                        id: 'dashAttack', name: '冲刺攻击', icon: '💨',
                        description: '在冲刺状态下发动强力突进挥砍，对路径上的敌人造成毁灭性打击',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { damageMul: 1.75 + level * 0.05, cooldownReduction: level * 0.02 }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    dashAttackFire: {
                        id: 'dashAttackFire', name: '冲刺攻击-火', icon: '🔥', iconImage: 'assets/skills/冲刺攻击-火.png',
                        description: '夜与火之剑专属：冲刺后向前挥砍，武器路径上留下火焰轨迹，对路径上敌人造成毁灭性打击',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { damageMul: 1.5 + level * 0.05, cooldownReduction: level * 0.02 }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    dashAttackThrust: {
                        id: 'dashAttackThrust', name: '冲刺攻击-突刺', icon: '⚔', iconImage: 'assets/skills/冲刺突击.png',
                        description: '骑士长剑专属：冲刺后向前突刺，对路径上敌人造成多次伤害',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '近战', type: 'melee' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { damageMul: 0.80 + level * 0.03, cooldownReduction: level * 0.02 }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    whirlwind: {
                        id: 'whirlwind', name: '风车', icon: '🌀',
                        description: '以自身为中心高速旋转武器，对周围敌人造成毁灭性打击',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '近战', type: 'melee' }, { name: '主动', type: 'active' }],
                        getEffect(level) { return { damageMul: 1.5 + level * 0.10, strBonus: level, cooldown: 10 - level * 0.2, staminaCost: 20 + level * 1, radius: 188 + level * 6, knockback: 312 }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    pushStrike: {
                        id: 'pushStrike', name: '推击', icon: '💥',
                        description: '使用远程武器向前方扇形区域释放强力推击，击退并眩晕敌人',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '远程', type: 'ranged' }, { name: '主动', type: 'active' }],
                        getEffect(level) { return { damageMul: 0.5 + level * 0.1, cooldown: 8 - level * 0.1, staminaCost: 15 + level * 0.5, radius: 100 + level * 1, knockback: 70 }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    criticalStrike: {
                        id: 'criticalStrike', name: '暴击', icon: '💥', iconImage: 'assets/skills/暴击.png',
                        description: '精通暴击之道，每次暴击都能造成更致命的打击',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '暴击', type: 'passive' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { damageBonus: 0.50 + level * 0.05, luckBonus: level }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    machineGunMastery: {
                        id: 'machineGunMastery', name: '机枪精通', icon: '🔫', iconImage: 'assets/skills/machine_gun_mastery.png',
                        description: '精通机枪的操控艺术，每次射击都更加致命',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '机枪', type: 'weapon' }, { name: '远程', type: 'ranged' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { strBonus: level, damagePercent: level * 0.01, damageBonus: level, spreadDelayBonus: level * 0.1 }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    rifleMastery: {
                        id: 'rifleMastery', name: '步枪精通', icon: '🎯', iconImage: 'assets/skills/步枪精通.png',
                        description: '精通步枪的精准射击，每颗子弹都命中要害',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '步枪', type: 'weapon' }, { name: '远程', type: 'ranged' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { wisBonus: level, damagePercent: level * 0.01, damageBonus: level, critRateBonus: level }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    pistolMastery: {
                        id: 'pistolMastery', name: '手枪精通', icon: '🔫', iconImage: 'assets/skills/pistol_mastery.png',
                        description: '精通手枪的快速射击，在移动中也能精准命中',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '手枪', type: 'weapon' }, { name: '远程', type: 'ranged' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { dexBonus: level, damagePercent: level * 0.01, damageBonus: level, speedPercent: level * 0.01 }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    shotgunMastery: {
                        id: 'shotgunMastery', name: '散弹枪精通', icon: '🔫',
                        description: '精通散弹枪的毁灭性火力，每一发弹丸都更具威力',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '散弹枪', type: 'weapon' }, { name: '远程', type: 'ranged' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { conBonus: level, damagePercent: level * 0.01, knockbackBonus: level * 0.5 }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    bowMastery: {
                        id: 'bowMastery', name: '弓精通', icon: '🏹', iconImage: 'assets/skills/弓精通.png',
                        description: '精通弓箭射击之道，每次拉弓都更加致命',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '弓类武器', type: 'weapon' }, { name: '远程', type: 'ranged' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { damageBonus: level * 5, damagePercent: level * 0.01, cooldownReduction: level * 0.01, dexBonus: level }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    droneSkill: {
                        id: 'droneSkill', name: '无人机', icon: '🛸', iconImage: 'assets/skills/无人机.png',
                        description: '释放一架无人机，操控时对范围内敌人施加易伤效果',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '主动', type: 'active' }],
                        getEffect(level) { return { duration: 30 + (level - 1) * 2, damageBonusPercent: 10 + (level - 1) * 2, critBonusPercent: 10 + (level - 1) * 2, moveSpeed: 500 + Math.floor((level - 1) / 5) * 50, radius: 300 + Math.floor((level - 1) / 5) * 100, cooldown: 15 - level * 0.2 }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    iceSpike: {
                        id: 'iceSpike', name: '冰锥', icon: '❄', iconImage: 'assets/skills/Icearrow-skill.png',
                        description: '释放后在角色身后生成冰锥，再次释放将所有冰锥瞄准鼠标方向射出',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                        getEffect(level) { return { damageBase: 30 + level * 5, magicMul: 1.2 + 0.25 * level, intMul: 1.2 + 0.25 * level, cooldown: 10, mpCost: 30, spikeCount: 2 + Math.floor((level - 1) / 5), duration: 30, flySpeed: 800, maxRange: 800 }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    shieldDefense: {
                        id: 'shieldDefense', name: '持盾防御', icon: '🛡', iconImage: 'assets/skills/Meshy_AI_Shield Block Sword Warrior.png',
                        description: '精通盾牌防御之术，在持盾状态下获得更强的防御能力和弹反效果',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '盾牌', type: 'weapon' }, { name: '被动', type: 'passive' }],
                        getEffect(level) { return { defBonusPercent: level * 0.02, damageReductionBonus: level * 0.02, parryStunBonus: Math.floor(level / 5) * 0.25 }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    },
                    fireball: {
                        id: 'fireball', name: '火球', icon: '🔥', iconImage: 'assets/skills/fireball_icon.png',
                        description: '释放后在角色身前凝聚火球，再次释放将火球瞄准鼠标方向射出，命中后造成范围爆炸伤害',
                        level: 1, maxLevel: 20, exp: 0, maxExp: 100,
                        tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
                        getEffect(level) { return { damageBase: 80 + level * 10, magicMul: 2 + 0.5 * level, intMul: 2.5 + 0.75 * level, cooldown: 20, mpCost: 50, explosionRadius: 80 + level * 5, duration: 30, flySpeed: 1600, maxRange: 1200 }; },
                        getExpForNext(level) { return 100 + (level - 1) * 100; }
                    }
                };
            }
            // ===== 装备-技能联动系统 =====
            /** 应用装备的技能覆盖 */
            // 附魔效果：应用攻击间隔调整
            _applyEnchantAttackInterval(item) {
                if (!item) return;
                const ee = item._enchantEffects;
                const intervalMul = ee && ee.attackIntervalMul ? ee.attackIntervalMul : 1.0;
                
                // 应用改造效果：攻击间隔变化
                let attackIntervalDelta = 0;
                if (item._craftEffects && item._craftEffects.attackIntervalDelta) {
                    attackIntervalDelta = item._craftEffects.attackIntervalDelta;
                }
                
                // 根据武器类型更新对应的攻击冷却
                const wType = item.weaponType;
                const attackKey = item.attackKey || 'melee';
                if (!this._baseCooldowns) this._baseCooldowns = {};
                if (this.attacks[attackKey]) {
                    if (!this._baseCooldowns[attackKey]) {
                        this._baseCooldowns[attackKey] = this.attacks[attackKey].maxCooldown;
                    }
                    // 弓类：使用武器配置中的 attackInterval 作为基础冷却
                    let baseCooldown = this._baseCooldowns[attackKey];
                    if (wType === 'bow' && item.attack && item.attack.attackInterval) {
                        baseCooldown = item.attack.attackInterval;
                    }
                    // 基础冷却 × 附魔倍率 + 改造间隔变化
                    this.attacks[attackKey].maxCooldown = Math.round(baseCooldown * intervalMul + attackIntervalDelta);
                }
            }

            // 附魔效果：攻击命中时触发（已由 attack.js 的 applyEnchantOnHit 统一处理，此处保留兼容空方法）
            _onHitEntity(entity) {
                // 所有附魔命中效果已迁移至 attack.js 的通用附魔系统，避免硬编码
            }

            _applySkillOverrides(item) {
                console.log('[SkillOverride] _applySkillOverrides called with:', item ? { name: item.name, hasOverrides: !!item.skillOverrides, overrideKeys: item.skillOverrides ? Object.keys(item.skillOverrides) : [] } : 'null item');
                if (!item || !item.skillOverrides) {
                    console.log('[SkillOverride] Clearing overrides (no skillOverrides on item)');
                    this._clearSkillOverrides();
                    return;
                }
                this._skillOverrides = JSON.parse(JSON.stringify(item.skillOverrides));
                console.log(`[SkillOverride] ✅ 应用 ${item.name} 的技能覆盖:`, JSON.parse(JSON.stringify(item.skillOverrides)));
            }
            /** 清除所有技能覆盖 */
            _clearSkillOverrides() {
                if (Object.keys(this._skillOverrides).length > 0) {
                    console.log('[SkillOverride] 恢复默认技能');
                }
                this._skillOverrides = {};
            }
            /** 触发风车技能 */
            triggerWhirlwind() {
                if (this.whirlwindSystem) {
                    this.whirlwindSystem.trigger();
                }
            }
            /** 触发推击技能 */
            triggerPushStrike() {
                if (this.pushStrikeSystem) {
                    this.pushStrikeSystem.trigger();
                }
            }
            /** 触发符文长剑冷却缩减（供攻击系统调用） */
            _triggerRuneSwordCooldownReduction() {
                if (this.runeSwordSystem) {
                    this.runeSwordSystem._triggerCooldownReduction();
                }
            }
            /** 获取技能覆盖参数（优先覆盖值，否则默认值） */
            _getSkillParam(skillId, paramPath, defaultValue) {
                const override = this._skillOverrides[skillId];
                if (!override) return defaultValue;
                const keys = paramPath.split('.');
                let val = override;
                for (const k of keys) {
                    val = val?.[k];
                    if (val === undefined) return defaultValue;
                }
                return val;
            }
            _getActiveDashSkillId() {
                // 优先使用 _skillOverrides（由 _applySkillOverrides 设置）
                if (this._skillOverrides.dashAttackThrust) return 'dashAttackThrust';
                if (this._skillOverrides.dashAttackFire) return 'dashAttackFire';
                // 回退到检查装备物品上的 skillOverrides
                const currentItem = this.equipments[this.weaponMode];
                if (currentItem && currentItem.skillOverrides) {
                    if (currentItem.skillOverrides.dashAttackThrust) return 'dashAttackThrust';
                    if (currentItem.skillOverrides.dashAttackFire) return 'dashAttackFire';
                }
                return 'dashAttack';
            }
            _isFacingMouse() {
                const moveDir = Input.getMovement();  // 修正：使用 getMovement 而非 getMoveDir
                if (moveDir.x === 0 && moveDir.y === 0) return false;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                const mx = Input.mouse.x - screenPos.x;
                const my = Input.mouse.y - screenPos.y;
                const len = Math.sqrt(mx * mx + my * my);
                if (len === 0) return true;
                return (moveDir.x * mx + moveDir.y * my) / len > 0;
            }
            _getFacingDirection() {
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                const mx = Input.mouse.x - screenPos.x;
                const my = Input.mouse.y - screenPos.y;
                const absX = Math.abs(mx);
                const absY = Math.abs(my);
                if (absX === 0 && absY === 0) {
                    const vx = this.vx || 0;
                    const vy = this.vy || 0;
                    const absVX = Math.abs(vx);
                    const absVY = Math.abs(vy);
                    if (absVX > absVY) {
                        return vx > 0 ? 'right' : 'left';
                    } else {
                        return vy > 0 ? 'down' : 'up';
                    }
                }
                if (absX > absY) {
                    return mx > 0 ? 'right' : 'left';
                } else {
                    return my > 0 ? 'down' : 'up';
                }
            }
            addAttribute(attr) {
                if (this.data.attrPoints <= 0) return false;
                const validAttrs = ['str', 'dex', 'int', 'con', 'wis', 'luck'];
                if (!validAttrs.includes(attr)) return false;
                this.data.attrPoints--;
                this.data[attr]++;
                this.calculateCombatStats();
                this.updateMaxStats();
                return true;
            }
            update(dt, entities) {
                // 同步六边形顶点世界坐标（原 super.update(dt) 做的事情）
                if (this.hitbox) {
                    this.hitbox.updateWorldPosition(this);
                }
                if (this.hitFlash > 0) {
                    this.hitFlash = Math.max(0, this.hitFlash - dt);
                }
                this.updateStatusEffects(dt);
                // 死亡状态处理
                if (this._isDead) {
                    this._deathTimer -= dt;
                    if (this._deathTimer <= 0) {
                        this.respawn();
                    }
                    return; // 死亡期间不执行任何其他逻辑
                }
                // ===== 眩晕状态处理 =====
                if (this.isStunned) {
                    this.stunTimer -= dt;
                    if (this.stunTimer <= 0) {
                        this.isStunned = false;
                        this.stunTimer = 0;
                        // 从状态栏移除眩晕效果
                        if (this._stunEffectId && StatusBar) {
                            StatusBar.removeEffect(this._stunEffectId);
                            this._stunEffectId = null;
                        }
                    }
                    // 眩晕期间强制取消防御状态
                    if (this.shieldSystem && this.shieldSystem.defending) {
                        this.shieldSystem.exitDefense();
                    }
                    // 眩晕期间：无法移动、无法攻击、无法调准朝向、无法释放技能
                    // 更新其他子系统（如武器特效、动画复位等）
                    this._updateSubsystems(dt, entities);
                    return;
                }
                // ===== 中毒处理 =====
                if (this._poisonTimer > 0) {
                    this._poisonTimer -= dt;
                    this._poisonTickTimer -= dt;
                    if (this._poisonTickTimer <= 0) {
                        this.data.hp -= this._poisonStacks;
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, `-${this._poisonStacks}`, '#7a9a5a'));
                        if (this.data.hp <= 0) {
                            this.data.hp = 0;
                            this.onDeath();
                        }
                        this._poisonTickTimer = 1000;
                    }
                    if (this._poisonTimer <= 0) {
                        this._poisonStacks = Math.max(0, this._poisonStacks - 1);
                        if (this._poisonStacks > 0) {
                            // 还有剩余层数，重新启动计时器
                            this._poisonTimer = 5000;
                            this._poisonTickTimer = 1000; // 重置 tick 计时器
                            if (StatusBar) {
                                // 重置 StatusBar 的 remaining 时间，保持图标显示同步
                                StatusBar.addEffect('poison', 5000, { stacks: this._poisonStacks });
                            }
                        } else {
                            // 全部层数耗尽，完全清除
                            this._poisonTimer = 0;
                            this._poisonTickTimer = 0;
                            if (this._poisonEffectId && StatusBar) {
                                StatusBar.removeEffect(this._poisonEffectId);
                                this._poisonEffectId = null;
                            }
                            // 清除中毒粒子效果
                            if (this._poisonEffect) this._poisonEffect.reset();
                        }
                    }
                }
                // 更新中毒粒子效果
                if (this._poisonStacks > 0 && this._poisonEffect) {
                    this._poisonEffect.update(dt, 0, 0);
                }
                // ===== 无人机易伤效果更新 =====
                if (this._droneVulnerabilityStacks > 0) {
                    this._droneVulnerabilityTimer -= dt;
                    if (this._droneVulnerabilityTimer <= 0) {
                        this._droneVulnerabilityStacks = Math.max(0, this._droneVulnerabilityStacks - 1);
                        if (this._droneVulnerabilityStacks > 0) {
                            this._droneVulnerabilityTimer = 5000;
                        } else {
                            if (this._droneVulnerabilityEffectId && StatusBar) {
                                StatusBar.removeEffect(this._droneVulnerabilityEffectId);
                                this._droneVulnerabilityEffectId = null;
                            }
                        }
                    }
                }
                // ===== 弹药系统换弹更新 =====
                this._updateReload(dt);
                // 更新弹药显示UI
                this._updateAmmoDisplay();
                
                const move = Input.getMovement();
                // 无人机操控模式下：禁用玩家移动，但继续更新其他逻辑
                const isDroneControlling = this.droneSystem && this.droneSystem.controlling;
                if (this.dodgeCooldown > 0) this.dodgeCooldown -= dt;
                if (this.weaponSwitchCooldown > 0) this.weaponSwitchCooldown -= dt;
                if (this.isDodging) {
                    this.dodgeTimer -= dt;
                    if (this.dodgeTimer <= 0) { this.isDodging = false; this.dodgeInvincible = false; }
                    else {
                        const dScale = dt / 1000;
                        const dnx = this.x + this.dodgeDirection.x * CONFIG.DODGE_SPEED * 0.33 * dScale, dny = this.y + this.dodgeDirection.y * CONFIG.DODGE_SPEED * 0.33 * dScale;
                        const dr = WallSystem.resolve(this.x, this.y, dnx, dny, this.collisionRadius);
                        this.x = dr.x; this.y = dr.y;
                        // 主神空间：限制在场景范围内(0,0)-(WORLD_WIDTH,WORLD_HEIGHT)，其他场景保持大范围
                        if (typeof SceneManager !== 'undefined' && SceneManager.currentScene === 'main') {
                            this.x = Math.max(0, Math.min(CONFIG.WORLD_WIDTH, this.x)); this.y = Math.max(0, Math.min(CONFIG.WORLD_HEIGHT, this.y));
                        } else {
                            this.x = Math.max(-CONFIG.WORLD_WIDTH, Math.min(CONFIG.WORLD_WIDTH * 2, this.x)); this.y = Math.max(-CONFIG.WORLD_HEIGHT, Math.min(CONFIG.WORLD_HEIGHT * 2, this.y));
                        }
                        this.animTime += 0.4;
                    }
                } else if (!isDroneControlling) {
                    let sprint = Input.isSprint() && this.data.stamina > 0 && this._isFacingMouse();
                    // 防御状态：禁止奔跑
                    if (this.shieldSystem && this.shieldSystem.defending) sprint = false;
                    // 攻击期间禁止奔跑
                    const isAttacking = this.weaponAnim && this.weaponAnim.state !== 'idle';
                    if (isAttacking) sprint = false;
                    let targetSpeed = sprint ? CONFIG.PLAYER_SPRINT : this.maxSpeed;
                    // 减速状态（致残）：移动速度减半
                    if (this.hasStatusEffect && this.hasStatusEffect('slow')) targetSpeed *= 0.5;
                    // 防御状态：移动速度减慢 50%
                    if (this.shieldSystem && this.shieldSystem.defending) targetSpeed *= 0.5;
                    const currentEquip = this.equipments[this.weaponMode];
                    const isPkmEquipped = currentEquip && (currentEquip.weaponType === 'pkm' || currentEquip.weaponType === 'qjb201' || currentEquip.weaponType === 'energy_lmg');
                    const isPistolEquipped = currentEquip && (currentEquip.weaponType === 'pistol' || currentEquip.rangedType === 'pistol');
                    const isAkmOrQbz191 = currentEquip && (currentEquip.weaponType === 'akm' || currentEquip.weaponType === 'qjb201');
                    if (isPkmEquipped) {
                        let moveSpeedReduction = 0.50; // Base reduction 50%
                        const craftEffects = currentEquip && currentEquip._craftEffects;
                        if (craftEffects && craftEffects.moveSpeedPercent) {
                            moveSpeedReduction -= craftEffects.moveSpeedPercent;
                        }
                        if (moveSpeedReduction > 0.90) moveSpeedReduction = 0.90;
                        if (moveSpeedReduction < 0) moveSpeedReduction = 0;
                        targetSpeed *= (1 - moveSpeedReduction);
                    }
                    // 手枪精通：持有手枪时增加移动速度
                    if (isPistolEquipped && this.skills && this.skills.pistolMastery) {
                        const pm = this.skills.pistolMastery.getEffect(this.skills.pistolMastery.level);
                        targetSpeed *= (1 + pm.speedPercent);
                    }
                    // 机枪开火时禁止 Shift 奔跑
                    if (sprint && isPkmEquipped && Input.mouse.leftDown && this._gunSpreadWeapon) {
                        sprint = false;
                        let moveSpeedReduction = 0.50;
                        const craftEffects = currentEquip && currentEquip._craftEffects;
                        if (craftEffects && craftEffects.moveSpeedPercent) {
                            moveSpeedReduction -= craftEffects.moveSpeedPercent;
                        }
                        if (moveSpeedReduction > 0.90) moveSpeedReduction = 0.90;
                        if (moveSpeedReduction < 0) moveSpeedReduction = 0;
                        targetSpeed = this.maxSpeed * (1 - moveSpeedReduction);
                    }
                    // 冲刺攻击动画期间：移动速度为0.1px/帧（结束后恢复）
                    if (this._isDashing) targetSpeed = 0.1;
                    // 风车攻击动画期间：移动速度为0.1px/帧（结束后恢复）
                    if (this._isWhirlwind) targetSpeed = 0.1;
                    // 推击攻击动画期间：移动速度为0.1px/帧（结束后恢复）
                    if (this._isPushStrike) targetSpeed = 0.1;
                    // 特殊攻击动画期间：完全不能移动
                    if (this._specialAttackActive) targetSpeed = 0;
                    this.vx += (move.x * targetSpeed - this.vx) * this.accel; this.vy += (move.y * targetSpeed - this.vy) * this.accel;
                    if (move.x === 0) this.vx *= this.friction; if (move.y === 0) this.vy *= this.friction;
                    
                    // ===== Velocity 驱动模式（可选）=====
                    const phaserScene = window.__phaserScene;
                    if (phaserScene && phaserScene._useVelocityDrive && phaserScene.playerSprite && phaserScene.playerSprite.body) {
                        // Velocity 驱动：设置 Phaser 物理体速度，让 Phaser 处理碰撞和位置更新
                        // 注意：闪避时仍使用直接位置设置（见上方闪避逻辑）
                        // 速度系数：100（补偿物理引擎阻力）
                        const speedMultiplier = 100;
                        phaserScene.playerSprite.body.setVelocity(this.vx * speedMultiplier, this.vy * speedMultiplier);
                        // 不再直接设置位置，位置由 Phaser 物理引擎更新
                        // GameScene._syncBodiesToPhysics() 会从 Phaser 同步位置回 Player
                    } else {
                        // 原有模式：直接位置设置 + WallSystem 碰撞解析
                        const mScale = dt / 1000;
                        const nx = this.x + this.vx * mScale, ny = this.y + this.vy * mScale;
                        const resolved = WallSystem.resolve(this.x, this.y, nx, ny, this.collisionRadius);
                        // 墙壁碰撞音效：速度较大且位置被阻挡时
                        if ((Math.abs(this.vx) > 1.5 || Math.abs(this.vy) > 1.5) && (Math.abs(resolved.x - nx) > 1 || Math.abs(resolved.y - ny) > 1)) {
                            // SoundManager.play('wall_hit');
                        }
                        this.x = resolved.x; this.y = resolved.y;
                        // 主神空间：限制在场景范围内(0,0)-(WORLD_WIDTH,WORLD_HEIGHT)，其他场景保持大范围
                        if (typeof SceneManager !== 'undefined' && SceneManager.currentScene === 'main') {
                            this.x = Math.max(0, Math.min(CONFIG.WORLD_WIDTH, this.x)); this.y = Math.max(0, Math.min(CONFIG.WORLD_HEIGHT, this.y));
                        } else {
                            this.x = Math.max(-CONFIG.WORLD_WIDTH, Math.min(CONFIG.WORLD_WIDTH * 2, this.x)); this.y = Math.max(-CONFIG.WORLD_HEIGHT, Math.min(CONFIG.WORLD_HEIGHT * 2, this.y));
                        }
                    }
                    if (sprint && this.isMoving) { this.data.stamina -= CONFIG.STAMINA_SPRINT_COST * (dt / 1000); if (this.data.stamina < 0) this.data.stamina = 0; }
                    if (Input.isPressed(CONFIG.KEYS.SPACE) && this.dodgeCooldown <= 0 && this.data.stamina >= CONFIG.STAMINA_DODGE_COST) this.triggerDodge(move);
                }
                const screenPos = Renderer.worldToScreen(this.x, this.y), dx = Input.mouse.x - screenPos.x, dy = Input.mouse.y - screenPos.y;
                if (this._isDashing) {
                    // 冲刺时不改变武器朝向
                    // this.rotation = Math.atan2(this._dashDirection.y, this._dashDirection.x);
                } else if (this._specialAttackActive) {
                    this.rotation = this._specialAttackLockedAngle;
                } else if (!this._isWhirlwind && !this.isDodging) {
                    this.rotation = Math.atan2(dy, dx);
                    // 根据鼠标方向确定4方向朝向
                    const absDx = Math.abs(dx);
                    const absDy = Math.abs(dy);
                    if (absDx > absDy) {
                        this._facingDir = dx > 0 ? 'right' : 'left';
                    } else {
                        this._facingDir = dy > 0 ? 'down' : 'up';
                    }
                }
                if (isDroneControlling) {
                    this.vx *= this.friction;
                    this.vy *= this.friction;
                }
                this.isMoving = Math.abs(this.vx) > 0.1 || Math.abs(this.vy) > 0.1;
                const _sprintActive = Input.isSprint() && this.data.stamina > 0 && this._isFacingMouse();
                this._isSprinting = _sprintActive; // 保存供render使用
                // ===== 行走/奔跑动画帧更新 =====
                if (this.isMoving && !this.isDodging && !this._isDashing && !this._isWhirlwind && !this._specialAttackActive) {
                    if (_sprintActive) {
                        // 奔跑动画（running.png 16帧）
                        this._runningAnimTimer += dt;
                        if (this._runningAnimTimer >= this._runningFrameDuration) {
                            this._runningAnimTimer = 0;
                            this._runningFrame = (this._runningFrame + 1) % 16;
                        }
                    } else {
                        // 行走动画（walk.png 21帧）
                        this._walkAnimTimer += dt;
                        if (this._walkAnimTimer >= this._walkFrameDuration) {
                            this._walkAnimTimer = 0;
                            this._walkFrame = (this._walkFrame + 1) % 21;
                        }
                    }
                } else {
                    // 静止：重置所有动画帧
                    this._runningFrame = 0;
                    this._runningAnimTimer = 0;
                    this._walkFrame = 0;
                    this._walkAnimTimer = 0;
                }
                if (this.isMoving && !this.isDodging) {
                    this.animTime += 0.15;
                }
                if (this.isMoving && !this.isDodging) {
                    this.animTime += 0.15;
                }
                const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                    const sprint = Input.isSprint() && this.data.stamina > 0 && this._isFacingMouse();
                    if (speed > 1.0) {
                        if (!this.dustTimer) this.dustTimer = 0;
                        this.dustTimer += dt;
                        const interval = sprint ? 70 : 140;
                        if (this.dustTimer >= interval) {
                            this.dustTimer -= interval;
                            // SoundManager.play('step');
                            const offsetX = -this.vx * (dt / 1000) * 1.5 + (Math.random() - 0.5) * 8;
                            const offsetY = -this.vy * (dt / 1000) * 1.5 + (Math.random() - 0.5) * 4;
                            { let d = EffectManager._acquire('DustEffect');
                            const dInt = sprint ? 1.5 : 0.8;
                            if (d) { d.x = this.x + offsetX; d.y = this.y + offsetY + 10; d.life = d.maxLife; d.active = true;
                                d.particles.forEach(p => { const pa = Math.PI+(Math.random()-0.5)*Math.PI; const ps = 49.92+Math.random()*124.8+dInt*49.92; p.vx = Math.cos(pa)*ps*0.6; p.vy = Math.sin(pa)*ps*0.4-0.3-Math.random()*0.6; p.alpha = 0.4+Math.random()*0.35; }); }
                            else d = new DustEffect(this.x + offsetX, this.y + offsetY + 10, dInt);
                            EffectManager.add(d); }
                            // PKM 装备时奔跑额外生成更浓密的烟尘
                            const currentItem = this.equipments[this.weaponMode];
                            if (currentItem && (currentItem.weaponType === 'pkm' || currentItem.weaponType === 'akm' || currentItem.weaponType === 'qbz191' || currentItem.weaponType === 'qjb201' || currentItem.weaponType === 'energy_lmg')) {
                                { let d2 = EffectManager._acquire('DustEffect');
                                const pkmDInt = sprint ? 2.2 : 1.2;
                                if (d2) { d2.x = this.x + offsetX * 0.7; d2.y = this.y + offsetY * 0.7 + 10; d2.life = d2.maxLife; d2.active = true;
                                    d2.particles.forEach(p => { const pa = Math.PI+(Math.random()-0.5)*Math.PI; const ps = 49.92+Math.random()*124.8+pkmDInt*49.92; p.vx = Math.cos(pa)*ps*0.6; p.vy = Math.sin(pa)*ps*0.4-0.3-Math.random()*0.6; p.alpha = 0.4+Math.random()*0.35; }); }
                                else d2 = new DustEffect(this.x + offsetX * 0.7, this.y + offsetY * 0.7 + 10, pkmDInt);
                                EffectManager.add(d2); }
                            }
                        }
                    } else {
                        this.dustTimer = 0;
                    }
                const isAttacking = this.weaponAnim.state !== 'idle';
                const isSprinting = Input.isSprint() && this.data.stamina > 0 && this.isMoving && this._isFacingMouse();
                // 冲刺攻击计时：追踪长按Shift持续时间
                if (isSprinting && !this._isDashing) {
                    this._sprintDuration += dt;
                    // 计算触发时间：基础333ms，每级减少3%
                    const activeDashSkill = this._getActiveDashSkillId();
                    const dashLevel = (this.skills && this.skills[activeDashSkill] && this.skills[activeDashSkill].level) || 1;
                    const triggerTime = 333 * (1 - (dashLevel - 1) * 0.03);
                    // 冲刺攻击可发动条件检查（与下方dash触发保持同步）
                    const currentWeapon = this.equipments[this.weaponMode];
                    const isWeaponEquipped = currentWeapon && currentWeapon.name;
                    const isMelee = isWeaponEquipped && currentWeapon.category === 'weapon_melee';
                    const dashReady = isMelee && this._sprintDuration >= triggerTime && !this._isDashing && this.skills && this.skills[activeDashSkill];
                    // 单次触发金光汇聚特效，触发后激活跟随光环
                    if (dashReady) {
                        if (!this._dashConvergeShown) {
                            // 首次触发：播放汇聚特效一次，并激活跟随光环
                            this._dashConvergeShown = true;
                            EffectManager.add(new DashConvergeEffect(this.x, this.y, this));
                            this._dashConvergeAuraActive = true;
                        }
                    }
                } else if (!Input.isSprint()) {
                    // 仅当Shift松开时重置计数，方向切换不重置
                    this._sprintDuration = 0;
                    this._dashConvergeShown = false;
                    this._dashConvergeAuraActive = false;
                }
                if (!this.isDodging && !isAttacking && !isSprinting && !(this.shieldSystem && this.shieldSystem.defending) && this.data.stamina < this.data.maxStamina) {
                    this.staminaRegenDelay -= dt;
                    if (this.staminaRegenDelay <= 0) {
                        const mul = this._staminaRegenMul || 1.0;
                        this.data.stamina += CONFIG.STAMINA_REGEN * (dt / 1000) * mul;
                        if (this.data.stamina > this.data.maxStamina) this.data.stamina = this.data.maxStamina;
                    }
                } else {
                    this.staminaRegenDelay = 500;
                }
                // ===== 生命回复 =====
                if (this.data.hp < this.data.maxHp) {
                    this.data.hp = Math.min(this.data.maxHp, this.data.hp + this.data.hpRegen * (dt / 1000));
                }
                // ===== 魔法回复 =====
                if (this.data.mp < this.data.maxMp) {
                    this.data.mp = Math.min(this.data.maxMp, this.data.mp + (this.data.mpRegen / 3) * (dt / 1000));
                }
                Object.values(this.attacks).forEach(a => a.update(dt));
                // ===== 枪类武器弹道扩散计时更新（主副手独立） =====
                const _currentWep2 = this.equipments[this.weaponMode];
                const _isGun = _currentWep2 && isGunWeapon(_currentWep2);
                // 双持判断
                const _offSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                const _offItem = this.equipments[_offSlot];
                const _isDual = _offItem && _offItem.name && !_offItem.isTwoHanded;
                // 主手散布计时：左键按下时主手武器累计散布
                if (_isGun && Input.mouse.leftDown) {
                    this._gunSpreadTimer += dt;
                    this._gunSpreadWeapon = _currentWep2.weaponType;
                } else {
                    this._gunSpreadTimer = 0;
                    this._gunSpreadWeapon = null;
                }
                // 副手散布计时：双持时右键按下且副手为枪械时累计散布
                const _offIsGun = _offItem && isGunWeapon(_offItem);
                if (_isDual && _offIsGun && Input.mouse.rightDown) {
                    this._gunSpreadTimerOff += dt;
                    this._gunSpreadWeaponOff = _offItem.weaponType;
                } else {
                    this._gunSpreadTimerOff = 0;
                    this._gunSpreadWeaponOff = null;
                }
                // 预计算主手散布因子（供准星显示与主手开火使用）
                if (_isGun) {
                    const wt = _currentWep2.weaponType;
                    const craftEffects = _currentWep2 && _currentWep2._craftEffects;
                    // 独头弹模式：特殊散布系统（后坐力层数控制）
                    if (wt === 'shotgun' && craftEffects && craftEffects.slugMode) {
                        this._currentSpreadFactor = 1;
                        this._currentSpreadMaxAngle = this._slugRecoilLayers * 5 + (craftEffects.maxSpreadAngleDelta || 0);
                        if (this._currentSpreadMaxAngle < 0) this._currentSpreadMaxAngle = 0;
                    } else {
                        // 普通枪械散布系统
                        let spreadStartDelay = 500; // 默认：0.5秒后开始散布
                        let spreadMaxTime = 4000;
                        let maxSpreadAngle = 25;
                        // 武器特异化散布参数（优先从配置读取）
                        const sp = _currentWep2.spreadParams;
                        if (sp) {
                            if (sp.startDelay !== undefined) spreadStartDelay = sp.startDelay;
                            if (sp.maxTime !== undefined) spreadMaxTime = sp.maxTime;
                            if (sp.maxAngle !== undefined) maxSpreadAngle = sp.maxAngle;
                        }
                        // 能量机枪：动态散布参数覆盖
                        if (wt === 'energy_lmg') {
                            const elp = this._getEnergyLMGParams();
                            spreadMaxTime = elp.spreadMaxTime;
                            maxSpreadAngle = elp.maxSpreadAngle;
                        }
                        // 瞄准模式：散布开始延迟 +1s
                        if (this._aimModeActive) {
                            spreadStartDelay += 1000;
                        }
                        // 应用改造效果
                        if (craftEffects) {
                            spreadStartDelay += craftEffects.spreadStartDelta || 0;
                            if (spreadStartDelay < 0) spreadStartDelay = 0;
                            spreadMaxTime += craftEffects.spreadTimeDelta || 0;
                            if (spreadMaxTime < 500) spreadMaxTime = 500;
                            maxSpreadAngle += craftEffects.maxSpreadAngleDelta || 0;
                        }
                        this._currentSpreadFactor = (spreadMaxTime <= 0)
                            ? (this._gunSpreadTimer > spreadStartDelay ? 1 : 0)
                            : Math.min(1, Math.max(0, this._gunSpreadTimer - spreadStartDelay) / spreadMaxTime);
                        this._currentSpreadMaxAngle = maxSpreadAngle;
                    }
                } else {
                    this._currentSpreadFactor = 0;
                    this._currentSpreadMaxAngle = 0;
                }
                // 预计算副手散布因子（供副手开火使用）
                if (_offIsGun) {
                    const offWt = _offItem.weaponType;
                    const offCraftEffects = _offItem && _offItem._craftEffects;
                    if (offWt === 'shotgun' && offCraftEffects && offCraftEffects.slugMode) {
                        this._currentSpreadFactorOff = 1;
                        this._currentSpreadMaxAngleOff = this._slugRecoilLayers * 5 + (offCraftEffects.maxSpreadAngleDelta || 0);
                        if (this._currentSpreadMaxAngleOff < 0) this._currentSpreadMaxAngleOff = 0;
                    } else {
                        let offSpreadStartDelay = 500;
                        let offSpreadMaxTime = 4000;
                        let offMaxSpreadAngle = 25;
                        const offSp = _offItem.spreadParams;
                        if (offSp) {
                            if (offSp.startDelay !== undefined) offSpreadStartDelay = offSp.startDelay;
                            if (offSp.maxTime !== undefined) offSpreadMaxTime = offSp.maxTime;
                            if (offSp.maxAngle !== undefined) offMaxSpreadAngle = offSp.maxAngle;
                        }
                        if (offWt === 'energy_lmg') {
                            const offElp = this._getEnergyLMGParams(); // 能量轻机枪参数从主手装备读取（Player 只持一把能量轻机枪）
                            offSpreadMaxTime = offElp.spreadMaxTime;
                            offMaxSpreadAngle = offElp.maxSpreadAngle;
                        }
                        if (this._aimModeActive) {
                            offSpreadStartDelay += 1000;
                        }
                        if (offCraftEffects) {
                            offSpreadStartDelay += offCraftEffects.spreadStartDelta || 0;
                            if (offSpreadStartDelay < 0) offSpreadStartDelay = 0;
                            offSpreadMaxTime += offCraftEffects.spreadTimeDelta || 0;
                            if (offSpreadMaxTime < 500) offSpreadMaxTime = 500;
                            offMaxSpreadAngle += offCraftEffects.maxSpreadAngleDelta || 0;
                        }
                        this._currentSpreadFactorOff = (offSpreadMaxTime <= 0)
                            ? (this._gunSpreadTimerOff > offSpreadStartDelay ? 1 : 0)
                            : Math.min(1, Math.max(0, this._gunSpreadTimerOff - offSpreadStartDelay) / offSpreadMaxTime);
                        this._currentSpreadMaxAngleOff = offMaxSpreadAngle;
                    }
                } else {
                    this._currentSpreadFactorOff = 0;
                    this._currentSpreadMaxAngleOff = 0;
                }
                // ===== 独头弹后坐力恢复系统 =====
                if (_currentWep2 && _currentWep2.weaponType === 'shotgun') {
                    const ce = _currentWep2._craftEffects;
                    if (ce && ce.slugMode) {
                        if (Input.mouse.leftDown) {
                            // 射击时：重置恢复计时器
                            this._slugRecoilTimer = 0;
                        } else {
                            // 停止射击：开始恢复
                            this._slugRecoilTimer += dt;
                            const baseRecovery = 500; // 默认后坐力恢复时间 500ms
                            const recovery = Math.max(100, baseRecovery + (ce.slugRecoilRecovery || 0));
                            if (this._slugRecoilTimer >= recovery) {
                                // 达到恢复时间后，所有层数一次性清零
                                this._slugRecoilLayers = 0;
                                this._slugRecoilTimer = 0;
                            }
                        }
                    } else {
                        this._slugRecoilLayers = 0;
                        this._slugRecoilTimer = 0;
                    }
                }
                // ===== 机枪类武器过热系统更新（PKM、QJB-201、能量轻机枪） =====
                if (_currentWep2 && (_currentWep2.weaponType === 'pkm' || _currentWep2.weaponType === 'qjb201' || _currentWep2.weaponType === 'energy_lmg')) {
                    this._overheatWeaponType = _currentWep2.weaponType;
                    const ce = _currentWep2._craftEffects;
                    const ohDelta = (ce && ce.overheatTimeDelta) || 0;
                    const ohRecDelta = (ce && ce.overheatRecoverDelta) || 0;
                    const elp = _currentWep2.weaponType === 'energy_lmg' ? this._getEnergyLMGParams() : null;
                    const hp = _currentWep2.heatParams || {};
                    if (this._overheatOverheated) {
                        // 过热恢复中
                        this._overheatRecoverTimer -= dt;
                        let recoverTime = _currentWep2.weaponType === 'energy_lmg'
                            ? (elp ? elp.overheatRecoverTime : 2500)
                            : (hp.overheatRecoverTime || 1500);
                        if (_currentWep2.weaponType === 'energy_lmg') recoverTime += ohRecDelta;
                        if (recoverTime < 500) recoverTime = 500; // 最小0.5秒
                        this._overheatValue = Math.max(0, this._overheatValue - (dt / recoverTime));
                        if (this._overheatRecoverTimer <= 0 || this._overheatValue <= 0) {
                            this._overheatOverheated = false;
                            this._overheatRecoverTimer = 0;
                            this._overheatValue = 0;
                            this._overheatActive = false;
                        }
                    } else if (Input.mouse.leftDown && !this._isReloading(this.weaponMode)) {
                        // 持续开火
                        this._overheatActive = true;
                        let overheatTime = _currentWep2.weaponType === 'energy_lmg'
                            ? (elp ? elp.overheatTime : 4000)
                            : (hp.overheatTime || 5000);
                        if (_currentWep2.weaponType === 'energy_lmg') overheatTime += ohDelta;
                        if (overheatTime < 1000) overheatTime = 1000; // 最小1秒
                        this._overheatValue = Math.min(1, this._overheatValue + (dt / overheatTime));
                        if (this._overheatValue >= 1) {
                            this._overheatOverheated = true;
                            let recoverTimer = _currentWep2.weaponType === 'energy_lmg'
                                ? (elp ? elp.overheatCooldownTime : 4000)
                                : (hp.overheatCooldownTime || 1500);
                            if (_currentWep2.weaponType === 'energy_lmg') recoverTimer += ohRecDelta;
                            if (recoverTimer < 500) recoverTimer = 500;
                            this._overheatRecoverTimer = recoverTimer;
                            // 过热音效
                            if (typeof SoundManager !== 'undefined') {
                                if (_currentWep2.weaponType === 'energy_lmg') {
                                    SoundManager.playFile('assets/sounds/pkm_ammo_steam_mixed.wav');
                                    SoundManager.playFile('assets/sounds/apex_reload_4s_raw.mp3');
                                } else {
                                    SoundManager.playFile('assets/sounds/pkm_ammo_steam_mixed.wav');
                                }
                            }
                        }
                    } else {
                        // 停止开火
                        let recoverTime = _currentWep2.weaponType === 'energy_lmg'
                            ? (elp ? elp.overheatCooldownTime : 4000)
                            : (hp.overheatCooldownTime || 1500);
                        if (_currentWep2.weaponType === 'energy_lmg') recoverTime += ohRecDelta;
                        if (recoverTime < 500) recoverTime = 500;
                        this._overheatValue = Math.max(0, this._overheatValue - (dt / recoverTime));
                        if (this._overheatValue <= 0) {
                            this._overheatActive = false;
                        }
                    }
                } else {
                    // 非机枪武器：隐藏过热条
                    this._overheatActive = false;
                    this._overheatValue = 0;
                    this._overheatOverheated = false;
                    this._overheatRecoverTimer = 0;
                    this._overheatWeaponType = null;
                }
                this.updateWeaponAnim(dt);
                this._updateSubsystems(dt, entities);
                const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
                // 左键拾取地面物品已取消 — 现在仅在鼠标悬停触发金色特效时自动拾取
                // （逻辑移至 Game.update() 的悬停检测中）
                if (!this.isDodging && !this._isDashing && !this._isWhirlwind && !this._isPushStrike && !this._specialAttackActive && !this._isDead) {
                    // ===== 盾防御状态管理 =====
                    if (this.shieldSystem && this.shieldSystem.checkEquipped()) {
                        if (Input.mouse.rightDown) {
                            if (!this.shieldSystem.defending) {
                                this.shieldSystem.enterDefense();
                            }
                        } else {
                            if (this.shieldSystem.defending) {
                                this.shieldSystem.exitDefense();
                            }
                        }
                    }
                    // 游戏开始冷却：防止点击"开始游戏"按钮的鼠标事件携带到游戏中导致自动攻击
                    if (this.gameStartCooldown > 0) {
                        this.gameStartCooldown -= dt;
                        Input.mouse.leftPressed = false;
                        Input.mouse.leftDown = false;
                    }
                    // 防御状态下：跳过所有攻击输入处理（手枪+盾时允许手枪攻击）
                    const _mainItem = this.equipments[this.weaponMode];
                    const _isMainPistol = _mainItem && (_mainItem.weaponType === 'pistol' || _mainItem.rangedType === 'pistol');
                    if (this.shieldSystem && this.shieldSystem.defending && !_isMainPistol) {
                        return;
                    }
                    // === 攻击输入处理 ===
                    // BUG FIX：装备面板打开时，完全禁止攻击输入
                    // 防止用户在面板中装备武器时，因之前按住左键导致自动攻击
                    if (SystemUI.isOpen) {
                        Input.mouse.leftPressed = false;
                        // 注意：不重置 leftDown，避免面板关闭后立即攻击
                        return;
                    }
                    // 游戏开始冷却期间禁止攻击
                    if (this.gameStartCooldown > 0) {
                        Input.mouse.leftPressed = false;
                        Input.mouse.leftDown = false;
                        return;
                    }
                    // 新设计：根据当前武器栏的实际装备类型决定攻击方式
                    const currentSlot = this.weaponMode; // 'weapon' or 'weapon2'
                    let currentItem = this.equipments[currentSlot];
                    let isWeaponEquipped = currentItem && currentItem.name;
                    const _offhandSlot = currentSlot === 'weapon' ? 'offhand' : 'ring2';
                    const _offhandItem = this.equipments[_offhandSlot];
                    // 自动切换：主武器槽为空时，将副武器切换到主武器槽
                    if (!isWeaponEquipped && _offhandItem && _offhandItem.name) {
                        this.equipments[currentSlot] = _offhandItem;
                        this.equipments[_offhandSlot] = null;
                        this._initAmmoForSlot(currentSlot);
                        this._initAmmoForSlot(_offhandSlot);
                        if (typeof GameUIManager !== 'undefined') {
                            GameUIManager.updateEquipmentUI();
                        }
                        // 重新获取当前武器状态
                        currentItem = this.equipments[currentSlot];
                        isWeaponEquipped = currentItem && currentItem.name;
                    }
                    const useOffhand = !isWeaponEquipped && _offhandItem && _offhandItem.name;
                    const effectiveItem = useOffhand ? _offhandItem : currentItem;
                    const effectiveSlot = useOffhand ? _offhandSlot : currentSlot;
                    // ===== 边境长弓蓄力攻击逻辑 =====
                    const isBorderBow = effectiveItem && effectiveItem.chargeAttack;
                    if (isBorderBow) {
                        if (Input.mouse.leftDown) {
                            if (this._chargeState === 'idle') {
                                this._chargeState = 'charging';
                                this._chargeTimer = 0;
                            } else if (this._chargeState === 'charging') {
                                this._chargeTimer += dt;
                                if (this._chargeTimer >= 1500) {
                                    this._chargeState = 'charged';
                                    this._chargeFlashActive = true;
                                    this._chargeFlashTimer = 500;
                                }
                            }
                        } else {
                            if (this._chargeState === 'charging') {
                                this._chargeState = 'idle';
                                this._chargeTimer = 0;
                            } else if (this._chargeState === 'charged') {
                                this._chargeState = 'idle';
                                this._chargeTimer = 0;
                                const atk = this.attacks.ranged;
                                if (atk.canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                                    if (Input.isSprint() && this.data.stamina > 0) this._sprintDuration = 0;
                                    this.rangedFireData = { targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities };
                                    atk.cooldown = atk.maxCooldown;
                                    this.triggerWeaponAnim();
                                }
                            }
                        }
                        // 更新闪光计时器
                        if (this._chargeFlashActive) {
                            this._chargeFlashTimer -= dt;
                            if (this._chargeFlashTimer <= 0) {
                                this._chargeFlashActive = false;
                                this._chargeFlashTimer = 0;
                            }
                        }
                        // 边境长弓消费掉 leftPressed，防止进入下方的点击攻击逻辑
                        if (Input.mouse.leftPressed) Input.mouse.leftPressed = false;
                    }
                    // 判断当前有效武器的类型
                    const isPistol = effectiveItem && (effectiveItem.weaponType === 'pistol' || effectiveItem.rangedType === 'pistol');
                    const isBow = effectiveItem && effectiveItem.weaponType === 'bow';
                    const isPkm = effectiveItem && (effectiveItem.weaponType === 'pkm' || effectiveItem.weaponType === 'akm' || effectiveItem.weaponType === 'qbz191' || effectiveItem.weaponType === 'qjb201' || effectiveItem.weaponType === 'energy_lmg');
                    const isShotgun = effectiveItem && effectiveItem.weaponType === 'shotgun';
                    const isMelee = effectiveItem && effectiveItem.category === 'weapon_melee';
                    const isGun = effectiveItem && isGunWeapon(effectiveItem);
                    
                    // ===== 计算副手状态（用于双持判断） =====
                    const offhandSlot = currentSlot === 'weapon' ? 'offhand' : 'ring2';
                    const offhandItem = this.equipments[offhandSlot];
                    const isDualWield = offhandItem && offhandItem.name && !offhandItem.isTwoHanded;
                    
                    // ===== 瞄准模式：所有枪械都可以进行瞄准（双持手枪除外） =====
                    if (isGun && Input.mouse.rightDown && !(isPistol && isDualWield)) {
                        this._aimModeActive = true;
                        const craftEffects = effectiveItem && effectiveItem._craftEffects;
                        const scopeType = craftEffects && (craftEffects.highPowerScope ? '3x' : (craftEffects.redDotScope ? '1x' : null));
                        // 镜头向鼠标方向移动：所有枪械都有偏移效果，有瞄具时距离更大
                        const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
                        const dx = mouseWorld.x - this.x;
                        const dy = mouseWorld.y - this.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        const angle = Math.atan2(dy, dx);
                        const BASE_AIM_OFFSET = 100; // 无瞄具基础偏移距离
                        let maxDist;
                        if (scopeType === '3x') {
                            maxDist = 900;
                        } else if (scopeType === '1x') {
                            maxDist = 300;
                        } else {
                            // 无瞄具：基础距离 × 1
                            maxDist = BASE_AIM_OFFSET * 1;
                        }
                        const offsetDist = Math.min(dist, maxDist);
                        Camera.aimOffsetX = Math.cos(angle) * offsetDist;
                        Camera.aimOffsetY = Math.sin(angle) * offsetDist;
                    } else {
                        this._aimModeActive = false;
                        Camera.aimOffsetX = 0;
                        Camera.aimOffsetY = 0;
                    }
                    
                    if (isPistol) {
                        // 手枪射击：根据左右键分别控制主副手
                        const attackKey = effectiveItem.attackKey || 'pistol';
                        const offhandAttackKey = offhandItem && offhandItem.offhandAttackKey || 'pistolOffhand';
                        // 检查弹药和换弹状态
                        const mainHasAmmo = this._hasAmmo(effectiveSlot);
                        const mainReloading = this._isReloading(effectiveSlot);
                        const offhandHasAmmo = isDualWield ? this._hasAmmo(offhandSlot) : false;
                        const offhandReloading = isDualWield ? this._isReloading(offhandSlot) : false;
                        // 根据 fireMode 选择触发器：semiAuto = 单击射击，fullAuto = 按住持续射击
                        const mainFireMode = effectiveItem.fireMode || 'fullAuto';
                        const mainFireTrigger = mainFireMode === 'semiAuto' ? Input.mouse.leftPressed : Input.mouse.leftDown;
                        // 左键：主手射击
                        if (mainHasAmmo && !mainReloading && this.weaponSwitchCooldown <= 0 && mainFireTrigger && this.attacks[attackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                            this.rangedFireData = { ...this.rangedFireData, targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, mainSlot: effectiveSlot, fireMainHand: true };
                            this.attacks[attackKey].cooldown = this.attacks[attackKey].maxCooldown;
                            this.triggerWeaponAnim();
                            // 半自动武器：消费掉点击事件，防止持续射击
                            if (mainFireMode === 'semiAuto') {
                                Input.mouse.leftPressed = false;
                            }
                        }
                        // 右键：副手射击（双持时）
                        const offhandFireMode = offhandItem && offhandItem.fireMode || 'fullAuto';
                        const offhandFireTrigger = offhandFireMode === 'semiAuto' ? Input.mouse.rightPressed : Input.mouse.rightDown;
                        if (isDualWield && offhandHasAmmo && !offhandReloading && this.weaponSwitchCooldown <= 0 && offhandFireTrigger && this.attacks[offhandAttackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                            this.rangedFireData = { ...this.rangedFireData, targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, offhandSlot: offhandSlot, fireOffhand: true };
                            this.attacks[offhandAttackKey].cooldown = this.attacks[offhandAttackKey].maxCooldown;
                            this.triggerOffhandWeaponAnim();
                            // 半自动副手：消费掉点击事件
                            if (offhandFireMode === 'semiAuto') {
                                Input.mouse.rightPressed = false;
                            }
                        }
                    } else if (isPkm) {
                        // PKM / AKM / 191 / 201 / 能量轻机枪 全自动模式：按住 leftDown 持续射击
                        const isEnergyLMG = effectiveItem.weaponType === 'energy_lmg';
                        const attackKey = effectiveItem.weaponType === 'pkm' ? 'pkm' : (effectiveItem.weaponType === 'akm' ? 'akm' : (effectiveItem.weaponType === 'qbz191' ? 'qbz191' : (effectiveItem.weaponType === 'qjb201' ? 'qjb201' : 'energy_lmg')));
                        
                        // 检查弹药和换弹状态（能量轻机枪无限子弹，不检查弹药）
                        const hasAmmo = isEnergyLMG ? true : this._hasAmmo(effectiveSlot);
                        const isReloading = isEnergyLMG ? false : this._isReloading(effectiveSlot);
                        
                        // 过热时禁止射击
                        const isOverheated = this._overheatOverheated;
                        if (isOverheated) {
                            // 过热中，禁止开火
                        } else if (hasAmmo && !isReloading && this.weaponSwitchCooldown <= 0 && Input.mouse.leftDown && this.attacks[attackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                            this.rangedFireData = { targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, mainSlot: effectiveSlot, fireMainHand: true };
                            this.attacks[attackKey].cooldown = this.attacks[attackKey].maxCooldown;
                            this.triggerWeaponAnim();
                        }
                        
                        // 能量轻机枪：更新射速提升状态
                        if (isEnergyLMG) {
                            const elp = this._getEnergyLMGParams();
                            if (Input.mouse.leftDown && !this._overheatOverheated) {
                                // 持续开火：累积开火时间
                                if (!this._energyLMGIsFiring) {
                                    this._energyLMGIsFiring = true;
                                    this._energyLMGFireTime = 0;
                                }
                                this._energyLMGFireTime += dt; // 使用实际dt，确保固定时间
                                // 计算当前冷却时间：从baseCooldown线性降到maxCooldown，rampUpTime内完成
                                const rampProgress = Math.min(1, this._energyLMGFireTime / elp.rampUpTime);
                                const currentCooldown = Math.round(elp.baseCooldown - (elp.baseCooldown - elp.maxCooldown) * rampProgress);
                                this.attacks.energy_lmg.maxCooldown = currentCooldown;
                            } else {
                                // 停止开火：重置射速
                                this._energyLMGIsFiring = false;
                                this._energyLMGFireTime = 0;
                                this.attacks.energy_lmg.maxCooldown = elp.baseCooldown;
                            }
                        }
                        
                        // 右键：副手射击（双持时，且不在瞄准模式下）
                        if (!this._aimModeActive && !useOffhand) {
                            let offhandSlot = null;
                            if (currentSlot === 'weapon') offhandSlot = 'offhand';
                            else if (currentSlot === 'weapon2') offhandSlot = 'ring2';
                            const offhandItem = offhandSlot ? this.equipments[offhandSlot] : null;
                            if (offhandItem && offhandItem.name && isOneHanded(offhandItem)) {
                                const offhandAttackKey = offhandItem && offhandItem.offhandAttackKey || 'pistolOffhand';
                                if (offhandAttackKey && this.attacks[offhandAttackKey]) {
                                    const offhandHasAmmo = this._hasAmmo(offhandSlot);
                                    const offhandReloading = this._isReloading(offhandSlot);
                                    if (offhandHasAmmo && !offhandReloading && this.weaponSwitchCooldown <= 0 && Input.mouse.rightDown && this.attacks[offhandAttackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                                        this.rangedFireData = { ...this.rangedFireData, targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, offhandSlot: offhandSlot, fireOffhand: true };
                                        this.attacks[offhandAttackKey].cooldown = this.attacks[offhandAttackKey].maxCooldown;
                                        this.triggerOffhandWeaponAnim();
                                    }
                                }
                            }
                        }
                    } else if (isShotgun) {
                        const attackKey = effectiveItem.attackKey || 'super90';
                        const isSaiga12k = attackKey === 'saiga12k';
                        const hasAmmo = this._hasAmmo(effectiveSlot);
                        const isReloading = this._isReloading(effectiveSlot);
                        // 打断单发装填：左键按下时打断换弹（仅Super90）
                        if (!isSaiga12k && isReloading && Input.mouse.leftPressed) {
                            this._interruptReload(effectiveSlot);
                        }
                        // 打断换弹：SAIGA-12K按住左键时也打断换弹
                        if (isSaiga12k && isReloading && Input.mouse.leftDown) {
                            this._interruptReload(effectiveSlot);
                        }
                        // Super90: 单次点击开火(leftPressed)；SAIGA-12K: 按住左键持续开火(leftDown)
                        const fireTrigger = isSaiga12k ? Input.mouse.leftDown : Input.mouse.leftPressed;
                        if (hasAmmo && !isReloading && this.weaponSwitchCooldown <= 0 && fireTrigger && this.attacks[attackKey].canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                            this.rangedFireData = { targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities, mainSlot: effectiveSlot, fireMainHand: true };
                            this.attacks[attackKey].cooldown = this.attacks[attackKey].maxCooldown;
                            this.triggerWeaponAnim();
                            if (!isSaiga12k) {
                                Input.mouse.leftPressed = false; // Super90消费掉点击事件
                            }
                        }
                        // 子弹打空时，点击开火键也触发换弹（自动换弹）
                        const ammoState = this._getAmmoState(effectiveSlot);
                        if (!hasAmmo && !isReloading && Input.mouse.leftPressed && ammoState && ammoState.current <= 0) {
                            this._startReload(effectiveSlot);
                            Input.mouse.leftPressed = false;
                        }
                    } else if (Input.mouse.leftPressed) {
                        // 计算冲刺攻击触发时间：基础333ms，每级减少3%
                        const activeDashSkill = this._getActiveDashSkillId();
                        const dashLevel = (this.skills && this.skills[activeDashSkill] && this.skills[activeDashSkill].level) || 1;
                        const triggerTime = 333 * (1 - (dashLevel - 1) * 0.03);
                        if (isMelee && this._sprintDuration >= triggerTime && !this._isDashing) {
                            // 冲刺攻击触发
                            this.dashSystem.trigger(entities);
                        } else if (isMelee) {
                            // 近战攻击：使用 ThrustAttack
                            const atk = this.attacks.melee;
                            if (atk.canUse()) {
                                const success = atk.execute(this, mouseWorld.x, mouseWorld.y, entities);
                                if (success) {
                                    atk.cooldown = atk.maxCooldown;
                                    this.triggerWeaponAnim();
                                    // 符文长剑：攻击命中时减少技能CD
                                    this.runeSwordSystem._triggerCooldownReduction();
                                }
                            }
                        } else if (isBow) {
                            // 弓矢攻击：使用 RangedAttack
                            const atk = this.attacks.ranged;
                            if (atk.canUse() && this.data.stamina >= CONFIG.STAMINA_RANGED_COST) {
                                // 如果正在奔跑，停止奔跑
                                if (Input.isSprint() && this.data.stamina > 0) {
                                    this._sprintDuration = 0;
                                }
                                this.rangedFireData = { targetX: mouseWorld.x, targetY: mouseWorld.y, entities: entities };
                                atk.cooldown = atk.maxCooldown;
                                this.triggerWeaponAnim();
                            }
                        }
                        Input.mouse.leftPressed = false;
                    }
                    // ===== 右键特殊攻击：夜与火之剑 / 符文长剑 =====
                    if (Input.mouse.rightPressed && isMelee) {
                        console.log('[SpecialAttack] Right-click detected, effectiveItem:', effectiveItem ? { name: effectiveItem.name, weaponId: effectiveItem.weaponId, category: effectiveItem.category } : 'null');
                        if (effectiveItem && effectiveItem.specialAttackType === 'nightFlame') {
                            // 夜与火之剑
                            console.log('[SpecialAttack] NightFlame check:', { cooldown: this._specialAttackCooldowns['nightFlame'] || 0, active: this._specialAttackActive, runeActive: this._runeSwordSpecialActive });
                            if ((this._specialAttackCooldowns['nightFlame'] || 0) <= 0 && !this._specialAttackActive && !this._runeSwordSpecialActive) {
                                this.specialAttackSystem.trigger(mouseWorld.x, mouseWorld.y, entities);
                            }
                        } else if (effectiveItem && effectiveItem.specialAttackType === 'runeSword') {
                            // 符文长剑
                            console.log('[SpecialAttack] RuneSword check:', { active: this._runeSwordSpecialActive, cooldown: this._specialAttackCooldowns['runeSword'] || 0, specialActive: this._specialAttackActive });
                            if (this._runeSwordSpecialActive) {
                                // 已激活：发射一把剑
                                this.runeSwordSystem._launchBlade();
                            } else if ((this._specialAttackCooldowns['runeSword'] || 0) <= 0 && !this._specialAttackActive) {
                                // 未激活：启动特殊攻击
                                this.runeSwordSystem.trigger();
                            }
                        }
                        Input.mouse.rightPressed = false;
                    }
                }
            }
            triggerDodge(moveInput) {
                if (this._specialAttackActive) return; // 夜与火之剑特殊攻击期间禁止闪避
                if (this.shieldSystem && this.shieldSystem.defending) return; // 防御状态禁止闪避
                let dirX = moveInput.x, dirY = moveInput.y;
                if (dirX === 0 && dirY === 0) { dirX = Math.cos(this.rotation); dirY = Math.sin(this.rotation); }
                const len = Math.sqrt(dirX*dirX + dirY*dirY); if (len > 0) { dirX /= len; dirY /= len; }
                this.dodgeDirection = { x: dirX, y: dirY }; this.isDodging = true; this.dodgeTimer = CONFIG.DODGE_DURATION;
                this.dodgeCooldown = CONFIG.DODGE_COOLDOWN; this.dodgeInvincible = true; this.data.stamina -= CONFIG.STAMINA_DODGE_COST;
                // SoundManager.play('dodge');
                this.vx = 0; this.vy = 0; { let d = EffectManager._acquire('DodgeEffect');
                if (d) { d.x = this.x; d.y = this.y; d.dirX = dirX; d.dirY = dirY; d.life = 300; d.active = true;
                    d.trails.forEach((t,i) => { t.x = this.x - dirX*i*8; t.y = this.y - dirY*i*8; t.alpha = 1-i*0.15; }); }
                else d = new DodgeEffect(this.x, this.y, dirX, dirY);
                EffectManager.add(d); }
            }
            _lineRectIntersection(x1, y1, x2, y2, rect) {
                // Liang-Barsky 线段裁剪算法，返回线段进入矩形时的参数 t (0~1)，无交点返回 null
                const dx = x2 - x1, dy = y2 - y1;
                let u1 = 0, u2 = 1;
                const p = [-dx, dx, -dy, dy], q = [x1 - rect.x, rect.x + rect.w - x1, y1 - rect.y, rect.y + rect.h - y1];
                for (let i = 0; i < 4; i++) {
                    if (p[i] === 0) { if (q[i] < 0) return null; }
                    else { const t = q[i] / p[i]; if (p[i] < 0) { if (t > u1) u1 = t; } else { if (t < u2) u2 = t; } }
                }
                return u1 < u2 ? u1 : null;
            }
            _shortestAngleDelta(from, to) {
                let delta = to - from;
                while (delta > Math.PI) delta -= Math.PI * 2;
                while (delta < -Math.PI) delta += Math.PI * 2;
                return delta;
            }
            triggerWeaponAnim() {
                // 动画打断机制：直接跳到 swing 阶段，跳过 windup 预备阶段
                // 弓类武器：先进入 rotate 阶段（500ms），然后进入 windup 阶段
                const currentItem = this.equipments[this.weaponMode];
                if (currentItem && currentItem.weaponType === 'bow') {
                    this.weaponAnim.state = 'rotate';
                    this.weaponAnim.timer = 0;
                    this.weaponAnim.rotateAngle = 0; // 旋转角度从0开始
                    this.rangedFired = false;
                } else {
                    this.weaponAnim.state = 'swing';
                    this.weaponAnim.timer = 0;
                    this.rangedFired = false;
                }
                // 注意：不再同步副手动画，主手和副手完全独立
                // 注意：_pendingThrust 在 execute() 中设置，不在此处清除
                // swing 阶段会消费 _pendingThrust 并触发 ThrustEffect，消费后设为 null
            }
            triggerOffhandWeaponAnim() {
                // 仅触发副手动画
                if (this.offhandWeaponAnim) {
                    this.offhandWeaponAnim.state = 'swing';
                    this.offhandWeaponAnim.timer = 0;
                }
            }
            switchWeaponMode() {
                // 攻击期间（rotate/windup/swing/recover/idle_return）不能切换武器
                if (this.weaponAnim && this.weaponAnim.state !== 'idle') {
                    return;
                }
                // 夜与火之剑特殊攻击期间不能切换武器
                if (this._specialAttackActive) {
                    return;
                }
                // === 新设计：weaponMode 只是表示当前使用哪个栏位 ===
                // 'weapon' = 武器栏1, 'weapon2' = 武器栏2
                // 按 F 键切换：weapon <-> weapon2
                const nextMode = this.weaponMode === 'weapon' ? 'weapon2' : 'weapon';
                const nextItem = this.equipments[nextMode];
                // 如果目标栏位为空，且当前栏位有装备，则不允许切换（防止切换到空栏位）
                // 但如果当前栏位为空，且目标栏位有装备，则允许切换
                const currentItem = this.equipments[this.weaponMode];
                // 检查目标栏位及其副手是否有武器
                const nextOffhandSlot = nextMode === 'weapon' ? 'offhand' : 'ring2';
                const nextOffhandItem = this.equipments[nextOffhandSlot];
                const nextHasWeapon = (nextItem && nextItem.name) || (nextOffhandItem && nextOffhandItem.name);
                const currentOffhandSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                const currentOffhandItem = this.equipments[currentOffhandSlot];
                const currentHasWeapon = (currentItem && currentItem.name) || (currentOffhandItem && currentOffhandItem.name);
                if (!nextHasWeapon && !currentHasWeapon) {
                    // 两个栏位都为空，显示提示
                    const hint = document.createElement('div');
                    hint.id = '_weaponSwitchHint';
                    hint.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:rgba(120,50,50,0.9);color:#d4c5a9;font-size:18px;padding:10px 24px;border-radius:8px;border:2px solid #9a5a5a;z-index:99999;pointer-events:none;font-family:SimHei, "Microsoft YaHei", "黑体", sans-serif;white-space:nowrap;transition:opacity 0.5s;';
                    hint.textContent = '⚠ 无可用武器栏';
                    document.body.appendChild(hint);
                    requestAnimationFrame(() => { if (hint) hint.style.opacity = '0'; setTimeout(() => { if (hint && hint.parentNode) hint.remove(); }, 800); });
                    return;
                }
                if (!nextHasWeapon) {
                    // 目标栏位为空但当前栏位有装备，显示提示但不切换
                    const hint = document.createElement('div');
                    hint.id = '_weaponSwitchHint';
                    hint.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:rgba(120,50,50,0.9);color:#d4c5a9;font-size:18px;padding:10px 24px;border-radius:8px;border:2px solid #9a5a5a;z-index:99999;pointer-events:none;font-family:SimHei, "Microsoft YaHei", "黑体", sans-serif;white-space:nowrap;transition:opacity 0.5s;';
                    hint.textContent = '⚠ 目标栏位无装备';
                    document.body.appendChild(hint);
                    requestAnimationFrame(() => { if (hint) hint.style.opacity = '0'; setTimeout(() => { if (hint && hint.parentNode) hint.remove(); }, 800); });
                    return;
                }
                this.weaponMode = nextMode;
                // 切换武器时重置蓄力状态
                if (this._chargeState !== 'idle') {
                    this._chargeState = 'idle';
                    this._chargeTimer = 0;
                    this._chargeFlashActive = false;
                    this._chargeFlashTimer = 0;
                }
                // G18 切换保护：切换到 pistol 后 300ms 内不能开火
                if (nextItem && (nextItem.weaponType === 'pistol' || nextItem.rangedType === 'pistol' || nextItem.weaponType === 'pkm' || nextItem.weaponType === 'akm' || nextItem.weaponType === 'qbz191' || nextItem.weaponType === 'qjb201')) {
                    this.weaponSwitchCooldown = 300;
                }
                // 视觉反馈：屏幕中央显示切换提示
                const oldHint = document.getElementById('_weaponSwitchHint');
                if (oldHint) oldHint.remove();
                const hint = document.createElement('div');
                hint.id = '_weaponSwitchHint';
                hint.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:rgba(60,50,40,0.9);color:#d4c5a9;font-size:22px;padding:12px 28px;border-radius:8px;border:2px solid #7a6a5a;z-index:99999;pointer-events:none;font-family:SimHei, "Microsoft YaHei", "黑体", sans-serif;white-space:nowrap;transition:opacity 0.5s;';
                const modeName = this.weaponMode === 'weapon' ? '武器栏1' : '武器栏2';
                // 图标根据当前栏位的实际装备类型决定
                let modeIcon = '⚔';
                if (nextItem) {
                    if (nextItem.weaponType === 'pistol' || nextItem.rangedType === 'pistol') modeIcon = '🔫';
                    else if (nextItem.weaponType === 'pkm' || nextItem.weaponType === 'akm' || nextItem.weaponType === 'qjb201') modeIcon = '🔥';
                    else if (nextItem.weaponType === 'bow') modeIcon = '🏹';
                }
                hint.textContent = `${modeIcon} ${modeName}`;
                document.body.appendChild(hint);
                requestAnimationFrame(() => { if (hint) hint.style.opacity = '0'; setTimeout(() => { if (hint && hint.parentNode) hint.remove(); }, 600); });
                // 切换武器后150ms触发一次待机动画2（旋转动画）—— 双手武器不触发旋转
                if (nextItem && !isTwoHanded(nextItem)) {
                    this.weaponAnim.nextSpin = Date.now() + 150;
                } else {
                    this.weaponAnim.nextSpin = 0;
                    this.weaponAnim.spinEnd = 0;
                }
                // 更新近战武器贴图：如果当前装备是剑类，切换对应的手持贴图
                if (nextItem && nextItem.equipImage) {
                    this.meleeImage.src = nextItem.equipImage;
                }
                // 更新弓的帧动画
                if (nextItem && nextItem.bowFrames) {
                    const frames = [];
                    for (let i = 0; i < nextItem.bowFrames.length; i++) {
                        const img = new Image(); img.src = nextItem.bowFrames[i]; frames.push(img);
                    }
                    this.equippedBowFrames = frames;
                    this.equippedRangedType = 'bow';
                    // 设置弓类待机贴图
                    if (nextItem.equipImage) {
                        this.bowEquipImage = new Image();
                        this.bowEquipImage.src = nextItem.equipImage;
                    }
                } else if (nextItem && nextItem.weaponAsset && nextItem.weaponAsset.framePrefix) {
                    const frames = [];
                    for (let i = 1; i <= nextItem.weaponAsset.frameCount; i++) {
                        const num = String(i).padStart(nextItem.weaponAsset.framePad || 2, '0');
                        const img = new Image(); img.src = nextItem.weaponAsset.framePrefix + num + '.png'; frames.push(img);
                    }
                    this.equippedBowFrames = frames;
                    this.equippedRangedType = 'bow';
                    // 设置弓类待机贴图
                    if (nextItem.equipImage) {
                        this.bowEquipImage = new Image();
                        this.bowEquipImage.src = nextItem.equipImage;
                    }
                } else if (nextItem && (nextItem.weaponType === 'pistol' || nextItem.rangedType === 'pistol')) {
                    this.equippedRangedType = 'pistol';
                    if (nextItem.equipImage) {
                        if (nextItem.canvasImageProp === 'deagleImage') {
                            this.deagleImage = new Image();
                            this.deagleImage.src = nextItem.equipImage;
                        } else {
                            this.pistolImage = new Image();
                            this.pistolImage.src = nextItem.equipImage;
                        }
                    }
                    if (nextItem.weaponAsset && nextItem.weaponAsset.muzzleImage) {
                        this.muzzleFlashImg = new Image();
                        this.muzzleFlashImg.src = nextItem.weaponAsset.muzzleImage;
                    }
                } else if (nextItem && (nextItem.weaponType === 'pkm' || nextItem.weaponType === 'akm' || nextItem.weaponType === 'qbz191' || nextItem.weaponType === 'qjb201')) {
                    this.equippedRangedType = nextItem.weaponType;
                    if (nextItem.equipImage) {
                        if (nextItem.weaponType === 'pkm') {
                            this.pkmImage = new Image();
                            this.pkmImage.src = nextItem.equipImage;
                        } else if (nextItem.weaponType === 'qbz191') {
                            this.qbz191Image = new Image();
                            this.qbz191Image.src = nextItem.equipImage;
                        } else if (nextItem.weaponType === 'qjb201') {
                            this.qjb201Image = new Image();
                            this.qjb201Image.src = nextItem.equipImage;
                        } else {
                            this.akmImage = new Image();
                            this.akmImage.src = nextItem.weaponAsset?.image || nextItem.equipImage;
                        }
                    }
                } else if (nextItem && nextItem.weaponType === 'shotgun') {
                    this.equippedRangedType = 'shotgun';
                    if (nextItem.equipImage) {
                        if (nextItem.canvasImageProp) {
                            this[nextItem.canvasImageProp] = new Image();
                            this[nextItem.canvasImageProp].src = nextItem.equipImage;
                        }
                    }
                    if (nextItem.weaponAsset && nextItem.weaponAsset.muzzleImage) {
                        this.muzzleFlashImg = new Image();
                        this.muzzleFlashImg.src = nextItem.weaponAsset.muzzleImage;
                    }
                    // 装备Super90时播放枪栓音效（SAIGA-12K不播放）
                    if (nextItem.equipSound && typeof SoundManager !== 'undefined' && SoundManager.playFile) {
                        SoundManager.playFile(nextItem.equipSound);
                    }
                } else {
                    this.equippedRangedType = null;
                    this.equippedBowFrames = null;
                }
                // 切换武器时结束符文长剑特殊攻击（未发射的剑淡出消失，持续300ms）
                if (this._runeSwordSpecialActive) {
                    this.runeSwordSystem._end(true);
                }
                // 切换武器时同步特殊攻击图标
                QuickBar.refreshSpecialAttack(this);
                // 切换武器时重置武器粒子效果
                this.weaponEffect.reset();
                // 切换武器时初始化弹药系统
                this._initAmmoForSlot(nextMode);
                // 应用/恢复装备的技能覆盖
                console.log('[SkillOverride] switchWeaponMode: nextItem =', nextItem ? { name: nextItem.name, slot: nextMode, hasOverrides: !!nextItem.skillOverrides } : 'null');
                this._applySkillOverrides(nextItem);
                // 附魔效果：攻击间隔调整
                this._applyEnchantAttackInterval(nextItem);
                // 刷新技能栏显示（根据当前武器显示对应的冲刺攻击技能）
                if (typeof SkillManager !== 'undefined' && SkillManager.renderSkillGrid) {
                    SkillManager.renderSkillGrid();
                }
            }
            /** 检查双持 G18 卸下 - 现在主手和副手独立，不再联动卸下 */
            checkDualWieldUnequip(slotKey) {
                // 主手1/副手1/主手2/副手2 各自独立，卸载时不影响其他槽位
                // 此函数保留仅用于兼容性，不再执行任何联动操作
                return;
            }
            loadWeaponAssets(item) {
                if (!item) return;
                this.equippedRangedType = null;
                this.equippedBowFrames = null;
                const wt = item.weaponType;
                const wa = item.weaponAsset;
                if (!wt || !wa) return;
                if (wt === 'bow' && wa.framePrefix && wa.frameCount) {
                    const frames = [];
                    for (let i = 1; i <= wa.frameCount; i++) {
                        const num = String(i).padStart(wa.framePad || 2, '0');
                        const img = new Image(); img.src = wa.framePrefix + num + '.png'; frames.push(img);
                    }
                    this.equippedBowFrames = frames;
                    this.equippedRangedType = 'bow';
                    // 设置弓类待机贴图
                    if (item.equipImage) {
                        this.bowEquipImage = new Image();
                        this.bowEquipImage.src = item.equipImage;
                    }
                } else if (wt === 'pistol' && wa.image) {
                    if (item.canvasImageProp === 'deagleImage') {
                        this.deagleImage = new Image(); this.deagleImage.src = wa.image;
                    } else {
                        this.pistolImage = new Image(); this.pistolImage.src = wa.image;
                    }
                    this.equippedRangedType = 'pistol';
                    if (wa.muzzleImage) { this.muzzleFlashImg = new Image(); this.muzzleFlashImg.src = wa.muzzleImage; }
                }
            }
            // ===== 弹药系统 =====
            /** 初始化指定槽位的弹药 */
            _initAmmoForSlot(slot) {
                const item = this.equipments[slot];
                if (!item || !isGunWeapon(item)) {
                    this._ammoState[slot] = null;
                    return;
                }
                const ammoConfig = item.ammoConfig;
                if (!ammoConfig) {
                    this._ammoState[slot] = null;
                    return;
                }
                // 如果已经有弹药状态，保持当前弹药（换武器时不清空），否则初始化满弹
                let maxAmmo = ammoConfig.max;
                let reloadTime = ammoConfig.reloadTime;
                // 应用改造效果（弹夹容量、换弹时间、短枪管覆盖）
                if (item._craftEffects) {
                    const ce = item._craftEffects;
                    if (ce.magazineOverride) {
                        maxAmmo = ce.magazineOverride; // 短枪管覆盖弹夹容量
                    } else if (ce.magazineDelta) {
                        maxAmmo += ce.magazineDelta;
                    }
                    if (ce.reloadTimeDelta) reloadTime += ce.reloadTimeDelta;
                    if (maxAmmo < 1) maxAmmo = 1;
                    if (reloadTime < 100) reloadTime = 100;
                }
                if (!this._ammoState[slot] || this._ammoState[slot].weaponId !== item.weaponId) {
                    this._ammoState[slot] = {
                        weaponId: item.weaponId,
                        current: maxAmmo,
                        max: maxAmmo,
                        reloading: false,
                        reloadTimer: 0,
                        reloadTime: reloadTime
                    };
                } else {
                    // 同一武器，更新最大弹药数（防止配置变更）
                    this._ammoState[slot].max = maxAmmo;
                    this._ammoState[slot].reloadTime = reloadTime;
                    // 改造弹夹后容量减小，同步当前弹药不超过最大值
                    if (this._ammoState[slot].current > maxAmmo) {
                        this._ammoState[slot].current = maxAmmo;
                    }
                }
            }
            /** 获取指定槽位的弹药状态 */
            _getAmmoState(slot) {
                return this._ammoState[slot] || null;
            }
            /** 检查指定槽位是否正在换弹 */
            _isReloading(slot) {
                const state = this._ammoState[slot];
                return state && state.reloading;
            }
            /** 检查指定槽位是否有弹药 */
            _hasAmmo(slot) {
                if (!this._ammoState[slot]) {
                    this._initAmmoForSlot(slot);
                }
                const state = this._ammoState[slot];
                return state && state.current > 0 && !state.reloading;
            }
            /** 消耗指定槽位1发弹药 */
            _consumeAmmo(slot) {
                const state = this._ammoState[slot];
                if (!state || state.current <= 0) return false;
                state.current--;
                // 打空后自动换弹
                if (state.current <= 0) {
                    this._startReload(slot);
                }
                return true;
            }
            /** 开始换弹 */
            _startReload(slot) {
                const state = this._ammoState[slot];
                if (!state || state.reloading || state.current >= state.max) {
                    console.log(`[_startReload] slot=${slot} skipped: state=${!!state}, reloading=${state?.reloading}, current=${state?.current}, max=${state?.max}`);
                    return false;
                }
                const item = this.equipments[slot];
                const ammoConfig = item && item.ammoConfig;
                const singleReloadMode = ammoConfig && ammoConfig.singleReloadMode;
                const reloadSound = ammoConfig && ammoConfig.reloadSound;
                state.reloading = true;
                // 双持模式下换弹时间 +50%（副手为手枪或盾）
                let actualReloadTime = state.reloadTime;
                if (item && (item.weaponType === 'pistol' || item.rangedType === 'pistol')) {
                    const offSlot = slot === 'weapon' ? 'offhand' : (slot === 'weapon2' ? 'ring2' : (slot === 'offhand' ? 'weapon' : (slot === 'ring2' ? 'weapon2' : null)));
                    if (offSlot) {
                        const offItem = this.equipments[offSlot];
                        if (offItem && (offItem.weaponType === 'pistol' || offItem.weaponType === 'shield')) {
                            actualReloadTime = Math.round(actualReloadTime * 1.5);
                        }
                    }
                }
                state.reloadTimer = actualReloadTime;
                console.log(`[_startReload] slot=${slot}, weaponId=${item?.weaponId}, singleReloadMode=${singleReloadMode}, reloadTime=${actualReloadTime}, current=${state.current}, max=${state.max}`);
                if (singleReloadMode) {
                    // 单发装填模式（如Super90）
                    state.singleReloadMode = true;
                    SoundManager.playFile(reloadSound || 'assets/sounds/Super90-reload.mp3');
                } else {
                    // 普通武器：一次性装填
                    state.singleReloadMode = false;
                    if (typeof SoundManager !== 'undefined' && SoundManager.playFile) {
                        SoundManager.playFile('assets/sounds/reload_sharp.mp3', 1.69);
                    }
                }
                return true;
            }
            /** 打断换弹（用于Super90单发装填） */
            _interruptReload(slot) {
                const state = this._ammoState[slot];
                console.log(`[_interruptReload] slot=${slot}, reloading=${state?.reloading}, singleReloadMode=${state?.singleReloadMode}, current=${state?.current}`);
                if (!state || !state.reloading || !state.singleReloadMode) return false;
                state.reloading = false;
                state.reloadTimer = 0;
                return true;
            }
            /** 更新所有槽位的换弹进度 */
            _updateReload(dt) {
                const slots = ['weapon', 'offhand', 'weapon2', 'ring2'];
                for (const slot of slots) {
                    // 如果槽位有枪械但没有弹药状态，自动初始化
                    const item = this.equipments[slot];
                    if (item && isGunWeapon(item) && (!this._ammoState[slot] || this._ammoState[slot].weaponId !== item.weaponId)) {
                        console.log(`[_updateReload] slot=${slot} reinit ammoState: weaponId=${item?.weaponId}, oldWeaponId=${this._ammoState[slot]?.weaponId}`);
                        this._initAmmoForSlot(slot);
                    }
                    const state = this._ammoState[slot];
                    if (!state || !state.reloading) continue;
                    state.reloadTimer -= dt;
                    if (state.reloadTimer <= 0) {
                        state.reloadTimer = 0;
                        if (state.singleReloadMode) {
                            // 单发装填模式：支持快速装填器（每次装2发）
                            const oldCurrent = state.current;
                            const item = this.equipments[slot];
                            const ce = item && item._craftEffects;
                            const reloadCount = (ce && ce.fastReload) ? 2 : 1;
                            state.current = Math.min(state.max, state.current + reloadCount);
                            console.log(`[_updateReload] slot=${slot} singleReload: current ${oldCurrent}→${state.current}, max=${state.max}, reloadCount=${reloadCount}`);
                            if (state.current >= state.max) {
                                state.reloading = false;
                                state.singleReloadMode = false;
                                this._gunSpreadTimer = 0; // 主手换弹后重置主手散布
                                this._gunSpreadTimerOff = 0; // 同时重置副手散布
                                // 单发装填满弹时播放枪栓音效
                                if (typeof SoundManager !== 'undefined' && SoundManager.playFile) {
                                    SoundManager.playFile('assets/sounds/bolt_pull_1s_clean.wav');
                                }
                            } else {
                                // 继续装填下一发
                                state.reloadTimer = state.reloadTime;
                                SoundManager.playFile('assets/sounds/Super90-reload.mp3');
                            }
                        } else {
                            // 普通武器：一次性装满
                            console.log(`[_updateReload] slot=${slot} bulkReload: current ${state.current}→${state.max}`);
                            state.reloading = false;
                            state.current = state.max;
                            this._gunSpreadTimer = 0; // 主手换弹后重置主手散布
                            this._gunSpreadTimerOff = 0; // 同时重置副手散布
                        }
                    }
                }
            }
            /** 触发当前武器的换弹（R键） */
            reloadCurrentWeapon() {
                const currentSlot = this.weaponMode;
                const currentItem = this.equipments[currentSlot];
                if (!currentItem || !isGunWeapon(currentItem)) return;
                // 主手换弹
                this._startReload(currentSlot);
                // 双持时副手也换弹
                let offhandSlot = null;
                if (currentSlot === 'weapon') offhandSlot = 'offhand';
                else if (currentSlot === 'weapon2') offhandSlot = 'ring2';
                if (offhandSlot) {
                    const offhandItem = this.equipments[offhandSlot];
                    if (offhandItem && isGunWeapon(offhandItem)) {
                        this._startReload(offhandSlot);
                    }
                }
            }
            /** 获取弹药显示数据（供UI使用） */
            getAmmoDisplay() {
                const result = [];
                const currentSlot = this.weaponMode;
                const currentItem = this.equipments[currentSlot];
                if (!currentItem || !isGunWeapon(currentItem)) return result;
                // 主手
                const mainState = this._ammoState[currentSlot];
                if (mainState) {
                    result.push({
                        name: currentItem.name,
                        current: mainState.current,
                        max: mainState.max,
                        reloading: mainState.reloading,
                        reloadPercent: mainState.reloading ? 1 - (mainState.reloadTimer / mainState.reloadTime) : 0,
                        isMain: true
                    });
                }
                // 副手（双持时）
                let offhandSlot = null;
                if (currentSlot === 'weapon') offhandSlot = 'offhand';
                else if (currentSlot === 'weapon2') offhandSlot = 'ring2';
                if (offhandSlot) {
                    const offhandItem = this.equipments[offhandSlot];
                    const offState = this._ammoState[offhandSlot];
                    if (offhandItem && isGunWeapon(offhandItem) && offState) {
                        result.push({
                            name: offhandItem.name,
                            current: offState.current,
                            max: offState.max,
                            reloading: offState.reloading,
                            reloadPercent: offState.reloading ? 1 - (offState.reloadTimer / offState.reloadTime) : 0,
                            isMain: false
                        });
                    }
                }
                return result;
            }
            _initAmmoDisplay() {
                if (this._ammoDisplayEl) return;
                const el = document.createElement('div');
                el.id = '_ammoDisplay';
                el.style.cssText = 'position:fixed;bottom:20px;right:20px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;z-index:9999;pointer-events:none;font-family:SimHei,"Microsoft YaHei","黑体",sans-serif;transition:opacity 0.3s;';
                document.body.appendChild(el);
                this._ammoDisplayEl = el;
            }
            _updateAmmoDisplay() {
                if (!this._ammoDisplayEl) return;
                const ammoData = this.getAmmoDisplay();
                if (ammoData.length === 0) {
                    this._ammoDisplayEl.style.opacity = '0';
                    this._ammoDisplayEl.innerHTML = '';
                    return;
                }
                this._ammoDisplayEl.style.opacity = '1';
                let html = '';
                for (const data of ammoData) {
                    const color = data.reloading ? '#888888' : (data.current <= data.max * 0.2 ? '#ff6b6b' : '#d4c5a9');
                    const statusText = data.reloading ? `换弹中 ${Math.ceil(data.reloadPercent * 100)}%` : `${data.current}/${data.max}`;
                    html += `<div style="background:rgba(40,35,30,0.85);color:${color};padding:4px 10px;border-radius:6px;border:1px solid rgba(120,100,80,0.5);font-size:14px;white-space:nowrap;"><span style="font-size:12px;color:#8a7a6a;margin-right:4px;">${data.isMain ? '主' : '副'}</span>${data.name}: ${statusText}</div>`;
                }
                this._ammoDisplayEl.innerHTML = html;
            }
            _getOffhandAnimMs(offhandItem, baseMs) {
                if (!offhandItem) return baseMs;
                let cfgKey = 'sword';
                if (offhandItem.weaponType === 'pistol' || offhandItem.rangedType === 'pistol') cfgKey = offhandItem.animConfigKey || 'pistol';
                else if (offhandItem.weaponType === 'pkm' || offhandItem.weaponType === 'akm' || offhandItem.weaponType === 'qbz191' || offhandItem.weaponType === 'qjb201') cfgKey = offhandItem.weaponType;
                else if (offhandItem.weaponType === 'bow') cfgKey = 'bow';
                const cfg = WeaponAnimConfig[cfgKey];
                const mul = (cfg ? cfg.timingMul : 1) * (this.animTimingMul || 1);
                return Math.round(baseMs * mul);
            }
            _getAnimMs(baseMs) {
                // 根据当前装备的实际类型选择动画配置
                const currentItem = this.equipments[this.weaponMode];
                let cfgKey = 'sword'; // 默认
                if (currentItem) {
                    if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') cfgKey = currentItem.animConfigKey || 'pistol';
                    else if (currentItem.weaponType === 'pkm' || currentItem.weaponType === 'akm' || currentItem.weaponType === 'qbz191' || currentItem.weaponType === 'qjb201' || currentItem.weaponType === 'energy_lmg') cfgKey = currentItem.weaponType;
                    else if (currentItem.weaponType === 'bow') cfgKey = 'bow';
                    else if (currentItem.weaponType === 'shotgun') cfgKey = 'shotgun';
                }
                const cfg = WeaponAnimConfig[cfgKey];
                // 弓：攻击动画时长 = 总攻击间隔 - 前摇 - 后摇，前摇/后摇不受攻击间隔影响
                if (currentItem && currentItem.weaponType === 'bow' && cfg && cfg.attackInterval) {
                    const bowAttackInterval = (currentItem.attack && currentItem.attack.attackInterval) || cfg.attackInterval;
                    const attackAnimMs = bowAttackInterval - (cfg.rotateMs || 500) - (cfg.returnMs || 200);
                    const totalBaseMs = WEAPON_ANIM.windupMs + WEAPON_ANIM.swingMs + WEAPON_ANIM.recoverMs;
                    const mul = (attackAnimMs / totalBaseMs) * (this.animTimingMul || 1);
                    return Math.round(baseMs * mul);
                }
                const mul = (cfg ? cfg.timingMul : 1) * (this.animTimingMul || 1);
                return Math.round(baseMs * mul);
            }
            _fireRanged(hand = 'main') {
                const d = this.rangedFireData;
                if (!d) return;
                const c = Math.cos(this.rotation), sin = Math.sin(this.rotation);

                // 计算有效穿透值（附魔+改造的穿透加成）
                const getEffectivePiercing = (basePiercing, item) => {
                    let result = (typeof basePiercing === 'number') ? basePiercing : 0;
                    if (item) {
                        if (item._enchantEffects && item._enchantEffects.piercingBonus) {
                            result += item._enchantEffects.piercingBonus;
                        }
                        if (item._craftEffects && item._craftEffects.piercingBonus) {
                            result += item._craftEffects.piercingBonus;
                        }
                    }
                    return result;
                };

                // === 副手独立处理 ===
                if (hand === 'offhand') {
                    const offhandSlot = d.offhandSlot || (this.weaponMode === 'weapon' ? 'offhand' : 'ring2');
                    const offhandItem = this.equipments[offhandSlot];
                    if (offhandItem && d.fireOffhand && (offhandItem.weaponType === 'pistol' || offhandItem.rangedType === 'pistol')) {
                        const offhandHasAmmo = this._hasAmmo(offhandSlot);
                        if (offhandHasAmmo) {
                            this._consumeAmmo(offhandSlot);
                            const offhandAttackKey = offhandItem.offhandAttackKey || 'pistolOffhand';
                            const offPC = this.attacks[offhandAttackKey].config;
                            const gunLX = this.size + 20, gunLY = 13;
                            const leftGunLY = -13;
                            const leftMuzzleX = this.x + c * (gunLX + 22) - sin * leftGunLY;
                            const leftMuzzleY = this.y + sin * (gunLX + 22) + c * leftGunLY;
                            const leftAngle = Math.atan2(d.targetY - leftMuzzleY, d.targetX - leftMuzzleX);
                            let offhandSpreadFactor = this._currentSpreadFactorOff;
                            const offhandMaxSpreadAngle = this._currentSpreadMaxAngleOff || 25;
                            const leftSpreadRad = (Math.random() - 0.5) * 2 * (offhandMaxSpreadAngle * Math.PI / 180) * offhandSpreadFactor;
                            const leftFinalAngle = leftAngle + leftSpreadRad;
                            let offhandDamage = offPC.damage.min;
                            if (this.getCurrentWeaponAtk) {
                                offhandDamage = this.getCurrentWeaponAtk(offhandItem);
                            }
                            const offhandDamageObj = { min: offhandDamage, max: offhandDamage };
                            const offIsDarkGold = offhandItem.isDarkGold || false;
                            { let p2 = EffectManager._acquire('Projectile');
                            if (p2) { p2.x = leftMuzzleX; p2.y = leftMuzzleY; p2.angle = leftFinalAngle; p2.speed = offPC.projectileSpeed; p2.maxRange = offPC.projectileRange; p2.size = offPC.projectileSize; p2.damage = offhandDamageObj; p2.piercing = getEffectivePiercing(offPC.piercing, offhandItem); p2.source = this; p2.entities = d.entities; p2.image = null; p2.isTracer = !offIsDarkGold; p2.isDarkGold = offIsDarkGold; p2.traveled = 0; p2.active = true; p2.hitTargets = new Set(); }
                            else p2 = new Projectile(leftMuzzleX, leftMuzzleY, leftFinalAngle, offPC.projectileSpeed, offPC.projectileRange, offPC.projectileSize, offhandDamageObj, getEffectivePiercing(offPC.piercing, offhandItem), this, d.entities, null, !offIsDarkGold, false, offIsDarkGold);
                            EffectManager.add(p2); }
                            if (offhandItem.fireSound) {
                                if (offhandItem.fireSound.startsWith('assets/')) {
                                    SoundManager.playFile(offhandItem.fireSound);
                                } else {
                                    SoundManager.play(offhandItem.fireSound);
                                }
                            } else {
                                SoundManager.play('gun_fire');
                            }
                            const leftFlashX = this.x + c * (gunLX + 28) - sin * leftGunLY;
                            const leftFlashY = this.y + sin * (gunLX + 28) + c * leftGunLY;
                            { let m2 = EffectManager._acquire('MuzzleFlashEffect');
                            if (m2) { m2.x = leftFlashX; m2.y = leftFlashY; m2.angle = leftFinalAngle; m2.life = m2.maxLife; m2.active = true; m2.scale = 0.8; }
                            else m2 = new MuzzleFlashEffect(leftFlashX, leftFlashY, leftFinalAngle, 0.8);
                            EffectManager.add(m2); }
                            { const offCSX = this.x + c * (gunLX - 8) - sin * (leftGunLY + 6), offCSY = this.y + sin * (gunLX - 8) + c * (leftGunLY + 6);
                            let s2 = EffectManager._acquire('ShellCasingEffect');
                            if (s2) { s2.x = offCSX; s2.y = offCSY; s2.life = s2.maxLife; s2.active = true; }
                            else s2 = new ShellCasingEffect(offCSX, offCSY, leftFinalAngle);
                            EffectManager.add(s2); }
                        }
                        delete d.fireOffhand;
                    }
                    if (d && !d.fireMainHand && !d.fireOffhand) {
                        this.rangedFired = true; this.rangedFireData = null;
                    }
                    return;
                }

                // === 主手处理 ===
                const mainSlot = d.mainSlot || this.weaponMode;
                const currentItem = this.equipments[mainSlot];
                const isPistol = currentItem && (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol');
                const isBow = currentItem && currentItem.weaponType === 'bow';
                const isPkmOrAkm = currentItem && (currentItem.weaponType === 'pkm' || currentItem.weaponType === 'akm' || currentItem.weaponType === 'qbz191' || currentItem.weaponType === 'qjb201' || currentItem.weaponType === 'energy_lmg');
                const isShotgun = currentItem && currentItem.weaponType === 'shotgun';
                const wac = WeaponAnimConfig[isPistol ? 'pistol' : (isBow ? 'bow' : (isPkmOrAkm ? currentItem.weaponType : (isShotgun ? 'shotgun' : 'sword')))];
                const holdX = wac ? wac.holdOffsetX : WEAPON_ANIM.holdX;
                const holdY = wac ? wac.holdOffsetY : WEAPON_ANIM.holdY;
                if (isPistol) {
                    // 检测是否双持手枪（任何手枪组合均可）
                    const mainAttackKey = currentItem.attackKey || 'pistol';
                    // 从 rangedFireData 获取槽位信息
                    const mainSlot = d.mainSlot || this.weaponMode;
                    const offhandSlot = d.offhandSlot || (this.weaponMode === 'weapon' ? 'offhand' : 'ring2');
                    const offhandItem = this.equipments[offhandSlot];
                    const offhandAttackKey = offhandItem && offhandItem.offhandAttackKey || 'pistolOffhand';
                    const gunLX = this.size + 20, gunLY = 13;
                    
                    // === 左键：主手开火 ===
                    if (d.fireMainHand) {
                        const mainHasAmmo = this._hasAmmo(mainSlot);
                        if (mainHasAmmo) {
                            this._consumeAmmo(mainSlot);
                            const muzzleX = this.x + c * (gunLX + 22) - sin * gunLY;
                            const muzzleY = this.y + sin * (gunLX + 22) + c * gunLY;
                            const angle = Math.atan2(d.targetY - muzzleY, d.targetX - muzzleX);
                            // 散布：使用统一的散布系统（所有枪械散布计算时间0.5s）
                            const mainSpreadFactor = this._currentSpreadFactor;
                            const maxSpreadAngle = this._currentSpreadMaxAngle || 25;
                            const spreadRad = (Math.random() - 0.5) * 2 * (maxSpreadAngle * Math.PI / 180) * mainSpreadFactor;
                            const finalAngle = angle + spreadRad;
                            const mainPC = this.attacks[mainAttackKey].config;
                            let mainDamage = mainPC.damage.min;
                            if (this.getCurrentWeaponAtk) {
                                mainDamage = this.getCurrentWeaponAtk();
                            }
                            const mainDamageObj = { min: mainDamage, max: mainDamage };
                            // 创建主手弹丸
                            const mainIsDarkGold = currentItem.isDarkGold || false;
                            { let p = EffectManager._acquire('Projectile');
                            if (p) { p.x = muzzleX; p.y = muzzleY; p.angle = finalAngle; p.speed = mainPC.projectileSpeed; p.maxRange = mainPC.projectileRange; p.size = mainPC.projectileSize; p.damage = mainDamageObj; p.piercing = getEffectivePiercing(mainPC.piercing, currentItem); p.source = this; p.entities = d.entities; p.image = null; p.isTracer = !mainIsDarkGold; p.isDarkGold = mainIsDarkGold; p.traveled = 0; p.active = true; p.hitTargets = new Set(); }
                            else p = new Projectile(muzzleX, muzzleY, finalAngle, mainPC.projectileSpeed, mainPC.projectileRange, mainPC.projectileSize, mainDamageObj, getEffectivePiercing(mainPC.piercing, currentItem), this, d.entities, null, !mainIsDarkGold, false, mainIsDarkGold);
                            EffectManager.add(p); }
                            // 主手开火音效
                            if (currentItem.fireSound) {
                                if (currentItem.fireSound.startsWith('assets/')) {
                                    SoundManager.playFile(currentItem.fireSound);
                                } else {
                                    SoundManager.play(currentItem.fireSound);
                                }
                            } else {
                                SoundManager.play('gun_fire');
                            }
                            // 主手枪口火焰特效
                            const flashX = this.x + c * (gunLX + 28) - sin * gunLY;
                            const flashY = this.y + sin * (gunLX + 28) + c * gunLY;
                            const mainFlash = new MuzzleFlashEffect(flashX, flashY, finalAngle, 1.2);
                            mainFlash.life = mainFlash.maxLife;
                            EffectManager.add(mainFlash);
                            // 弹壳从抛壳窗弹出（枪身右侧后方）
                            { const cSX = this.x + c * (gunLX - 8) - sin * (gunLY + 6), cSY = this.y + sin * (gunLX - 8) + c * (gunLY + 6);
                            let s = EffectManager._acquire('ShellCasingEffect');
                            if (s) { s.x = cSX; s.y = cSY; s.life = s.maxLife; s.active = true; }
                            else s = new ShellCasingEffect(cSX, cSY, angle);
                            EffectManager.add(s); }
                        }
                        delete d.fireMainHand;
                    }
                    // 副手开火已移到 hand === 'offhand' 分支独立处理
                } else if (isPkmOrAkm) {
                    // 只处理明确标记为主手开火的情况
                    if (d.fireMainHand) {
                        const craftEffects = currentItem && currentItem._craftEffects;
                        const mainSlot = d.mainSlot || this.weaponMode;
                        const attackKey = currentItem.weaponType; // 'pkm' | 'akm' | 'qbz191' | 'qjb201' | 'energy_lmg'
                        const isEnergyLMG = attackKey === 'energy_lmg';
                        
                        // 能量轻机枪：不消耗弹药，其他机枪消耗弹药
                        if (!isEnergyLMG) {
                            if (this._hasAmmo(mainSlot)) {
                                this._consumeAmmo(mainSlot);
                            }
                        }
                        
                        const gunLX = this.size + 24, gunLY = holdY;
                        const spawnX = this.x + c * (gunLX + 30) - sin * gunLY;
                        const spawnY = this.y + sin * (gunLX + 30) + c * gunLY;
                        const baseAngle = Math.atan2(d.targetY - this.y, d.targetX - this.x);
                        
                        // 散布：能量轻机枪从配置读取，其他使用统一散布系统
                        let spreadFactor, maxSpreadAngle, spreadRad, angle;
                        if (isEnergyLMG) {
                            const elp = this._getEnergyLMGParams();
                            maxSpreadAngle = elp.maxSpreadAngle + (craftEffects?.maxSpreadAngleDelta || 0);
                            if (maxSpreadAngle < 0) maxSpreadAngle = 0;
                            // 能量轻机枪散布即时开始，从配置读取达到最大时间
                            const spreadProgress = Math.min(1, this._gunSpreadTimer / elp.spreadMaxTime);
                            spreadRad = (Math.random() - 0.5) * 2 * (maxSpreadAngle * Math.PI / 180) * spreadProgress;
                            angle = baseAngle + spreadRad;
                        } else {
                            spreadFactor = this._currentSpreadFactor;
                            maxSpreadAngle = this._currentSpreadMaxAngle || 25;
                            spreadRad = (Math.random() - 0.5) * 2 * (maxSpreadAngle * Math.PI / 180) * spreadFactor;
                            angle = baseAngle + spreadRad;
                        }
                        
                        const pc = this.attacks[attackKey].config;
                        // 动态计算伤害（优先使用 getCurrentWeaponAtk，包含强化和改造加成）
                        let weaponDamage;
                        if (this.getCurrentWeaponAtk) {
                            weaponDamage = this.getCurrentWeaponAtk();
                        } else if (attackKey === 'pkm') {
                            weaponDamage = Math.round(5 + this.data.str * 0.1 + this.data.stamina * 0.1);
                        } else if (attackKey === 'qbz191') {
                            weaponDamage = Math.round(3 + this.data.str * 0.04 + this.data.wis * 0.18);
                        } else if (attackKey === 'qjb201') {
                            weaponDamage = Math.round(3 + this.data.str * 0.08 + this.data.wis * 0.15);
                        } else {
                            weaponDamage = Math.round(3 + this.data.str * 0.05 + this.data.wis * 0.15);
                        }
                        const damage = { min: weaponDamage, max: weaponDamage };
                        
                        // 屏幕抖动
                        Camera.triggerShake(isEnergyLMG ? 2 : 4);
                        
                        // 音效播放
                        if (typeof SoundManager !== 'undefined') {
                            if (isEnergyLMG) {
                                SoundManager.playFile('assets/sounds/apex_shot_600ms.wav');
                            } else if (attackKey === 'pkm') {
                                SoundManager.playFile('assets/sounds/pkm_half_sec.wav');
                            } else if (attackKey === 'qbz191') {
                                SoundManager.playFile('assets/sounds/qbz191_shot6_valley.mp3');
                            } else if (attackKey === 'qjb201') {
                                SoundManager.playFile('assets/sounds/qjb201_single_600ms.wav');
                            } else {
                                SoundManager.playFile('assets/sounds/akm_burst.mp3');
                            }
                        }
                        
                        // 应用改造效果
                        let effectiveRange = pc.projectileRange;
                        let effectiveKnockback = pc.knockback || 0;
                        let effectiveProjectileSpeed = pc.projectileSpeed;
                        if (craftEffects) {
                            effectiveRange += craftEffects.rangeDelta || 0;
                            effectiveKnockback += craftEffects.knockbackDelta || 0;
                            if (craftEffects.projectileSpeedPercent) {
                                effectiveProjectileSpeed *= (1 + craftEffects.projectileSpeedPercent);
                            }
                            if (effectiveRange < 100) effectiveRange = 100;
                        }
                        
                        // 创建弹丸
                        { let p = EffectManager._acquire('Projectile');
                        if (p) { p.x = spawnX; p.y = spawnY; p.angle = angle; p.speed = effectiveProjectileSpeed; p.maxRange = effectiveRange; p.size = pc.projectileSize; p.damage = damage; p.piercing = getEffectivePiercing(pc.piercing, currentItem); p.source = this; p.entities = d.entities; p.image = null; p.isTracer = false; p.isGold = !isEnergyLMG; p.isGreen = isEnergyLMG; p.traveled = 0; p.active = true; p.hitTargets = new Set(); p.knockback = effectiveKnockback; p.damageType = isEnergyLMG ? 'magic' : 'physical'; }
                        else p = new Projectile(spawnX, spawnY, angle, effectiveProjectileSpeed, effectiveRange, pc.projectileSize, damage, getEffectivePiercing(pc.piercing, currentItem), this, d.entities, null, false, !isEnergyLMG, false, isEnergyLMG ? 'magic' : 'physical', false, isEnergyLMG);
                        if (effectiveKnockback > 0 && p) p.knockback = effectiveKnockback;
                        EffectManager.add(p); }
                        
                        // 枪口火焰特效
                        const hideMuzzle = !isEnergyLMG && craftEffects && craftEffects.hideMuzzleFlash;
                        if (!hideMuzzle) {
                            const flashX = this.x + c * (gunLX + 38) - sin * gunLY;
                            const flashY = this.y + sin * (gunLX + 38) + c * gunLY;
                            { let m = EffectManager._acquire('MuzzleFlashEffect');
                            if (m) { m.x = flashX; m.y = flashY; m.angle = angle; m.life = m.maxLife; m.active = true; m.scale = isEnergyLMG ? 1.0 : 1.5; m.isGreen = isEnergyLMG; }
                            else m = new MuzzleFlashEffect(flashX, flashY, angle, isEnergyLMG ? 1.0 : 1.5);
                            if (isEnergyLMG) m.isGreen = true;
                            EffectManager.add(m); }
                        }
                        
                        // 弹壳从抛壳窗弹出（能量轻机枪不抛壳）
                        if (!isEnergyLMG) {
                            { const cSX = this.x + c * (gunLX - 10) - sin * (gunLY + 8), cSY = this.y + sin * (gunLX - 10) + c * (gunLY + 8);
                            let s = EffectManager._acquire('ShellCasingEffect');
                            if (s) { s.x = cSX; s.y = cSY; s.life = s.maxLife; s.active = true; }
                            else s = new ShellCasingEffect(cSX, cSY, angle);
                            EffectManager.add(s); }
                        }
                        delete d.fireMainHand;
                    }
                    // 副手开火已移到 hand === 'offhand' 分支独立处理
                } else if (isShotgun) {
                    const currentItem = this.equipments[this.weaponMode];
                    const craftEffects = currentItem && currentItem._craftEffects;
                    const isSlug = craftEffects && craftEffects.slugMode;
                    const isFlechette = craftEffects && craftEffects.flechetteMode;
                    const attackKey = currentItem.attackKey || 'super90';
                    const pelletCount = currentItem.pelletCount || 6;
                    const baseSpreadAngle = 20; // 所有散弹枪统一基础散布±20°
                    const fireSound = currentItem.fireSound || 'assets/sounds/gunshot_600ms_clean.wav';
                    // 散弹枪：一次击发多发弹丸（普通模式）或单发弹丸（独头弹模式）
                    if (d.fireMainHand) {
                        const mainSlot = d.mainSlot || this.weaponMode;
                        if (this._hasAmmo(mainSlot)) {
                            this._consumeAmmo(mainSlot);
                            const pc = this.attacks[attackKey].config;
                            const gunLX = this.size + 24, gunLY = holdY;
                            const spawnX = this.x + c * (gunLX + 30) - sin * gunLY;
                            const spawnY = this.y + sin * (gunLX + 30) + c * gunLY;
                            const baseAngle = Math.atan2(d.targetY - this.y, d.targetX - this.x);
                            // 动态计算伤害（优先使用 getCurrentWeaponAtk 包含强化和改造加成）
                            let weaponDamage;
                            if (this.getCurrentWeaponAtk) {
                                weaponDamage = this.getCurrentWeaponAtk();
                            } else {
                                weaponDamage = Math.round(1 + this.data.con * 0.1 + this.data.wis * 0.2);
                            }
                            const damage = { min: weaponDamage, max: weaponDamage };
                            // 应用改造效果（射程、击退）
                            let effectiveRange = pc.projectileRange;
                            let effectiveKnockback = pc.knockback || 20;
                            let effectiveSpeed = pc.projectileSpeed;
                            if (craftEffects) {
                                effectiveRange += craftEffects.rangeDelta || 0;
                                effectiveKnockback += craftEffects.knockbackDelta || 0;
                                if (effectiveRange < 100) effectiveRange = 100;
                            }
                            // 散弹枪精通击退加成
                            if (this.skills && this.skills.shotgunMastery) {
                                const sm = this.skills.shotgunMastery.getEffect(this.skills.shotgunMastery.level);
                                effectiveKnockback += sm.knockbackBonus || 0;
                            }
                            // 屏幕抖动
                            Camera.triggerShake(6);
                            // 开火音效
                            if (typeof SoundManager !== 'undefined') {
                                SoundManager.playFile(fireSound);
                            }
                            // 确定穿透值（箭型弹模式基础1层 + 附魔/改造加成）
                            let piercing = 0;
                            if (isFlechette) {
                                piercing = 1;
                            }
                            piercing = getEffectivePiercing(piercing, currentItem);
                            if (isSlug) {
                                // 独头弹模式：单发弹丸，后坐力层数控制散布（应用改造效果）
                                this._slugRecoilLayers++;
                                let slugSpreadAngle = 0;
                                if (this._slugRecoilLayers > 1) {
                                    // 第一层（_slugRecoilLayers=1）基础散布为零，之后每层+5°
                                    slugSpreadAngle = (this._slugRecoilLayers - 1) * 5;
                                }
                                // 应用改造散布效果（收束器 -5° 等）
                                if (craftEffects && craftEffects.maxSpreadAngleDelta) {
                                    slugSpreadAngle += craftEffects.maxSpreadAngleDelta;
                                }
                                if (slugSpreadAngle < 0) slugSpreadAngle = 0;
                                const slugSpreadRad = (Math.random() - 0.5) * 2 * (slugSpreadAngle * Math.PI / 180);
                                const angle = baseAngle + slugSpreadRad;
                                { let p = EffectManager._acquire('Projectile');
                                if (p) { p.x = spawnX; p.y = spawnY; p.angle = angle; p.speed = effectiveSpeed; p.maxRange = effectiveRange; p.size = pc.projectileSize; p.damage = damage; p.piercing = piercing; p.source = this; p.entities = d.entities; p.image = null; p.isTracer = false; p.isGold = true; p.traveled = 0; p.active = true; p.hitTargets = new Set(); p.knockback = effectiveKnockback; }
                                else p = new Projectile(spawnX, spawnY, angle, effectiveSpeed, effectiveRange, pc.projectileSize, damage, piercing, this, d.entities, null, false, true);
                                if (p) p.knockback = effectiveKnockback;
                                EffectManager.add(p); }
                            } else {
                                // 普通模式：多发弹丸，每发随机散布（应用改造效果）
                                let spreadAngle = baseSpreadAngle;
                                if (craftEffects && craftEffects.maxSpreadAngleDelta) {
                                    spreadAngle += craftEffects.maxSpreadAngleDelta;
                                }
                                if (spreadAngle < 0) spreadAngle = 0;
                                for (let pellet = 0; pellet < pelletCount; pellet++) {
                                    const spreadRad = (Math.random() - 0.5) * 2 * (spreadAngle * Math.PI / 180);
                                    const angle = baseAngle + spreadRad;
                                    { let p = EffectManager._acquire('Projectile');
                                    if (p) { p.x = spawnX; p.y = spawnY; p.angle = angle; p.speed = effectiveSpeed; p.maxRange = effectiveRange; p.size = pc.projectileSize; p.damage = damage; p.piercing = piercing; p.source = this; p.entities = d.entities; p.image = null; p.isTracer = false; p.isGold = true; p.traveled = 0; p.active = true; p.hitTargets = new Set(); p.knockback = effectiveKnockback; }
                                    else p = new Projectile(spawnX, spawnY, angle, effectiveSpeed, effectiveRange, pc.projectileSize, damage, piercing, this, d.entities, null, false, true);
                                    if (p) p.knockback = effectiveKnockback;
                                    EffectManager.add(p); }
                                }
                            }
                            // 枪口火焰（消音器隐藏）
                            const hideMuzzle = craftEffects && craftEffects.hideMuzzleFlash;
                            if (!hideMuzzle) {
                                const flashX = this.x + c * (gunLX + 38) - sin * gunLY;
                                const flashY = this.y + sin * (gunLX + 38) + c * gunLY;
                                { let m = EffectManager._acquire('MuzzleFlashEffect');
                                if (m) { m.x = flashX; m.y = flashY; m.angle = baseAngle; m.life = m.maxLife; m.active = true; m.scale = 1.8; }
                                else m = new MuzzleFlashEffect(flashX, flashY, baseAngle, 1.8);
                                EffectManager.add(m); }
                            }
                            // 弹壳
                            { const cSX = this.x + c * (gunLX - 10) - sin * (gunLY + 8), cSY = this.y + sin * (gunLX - 10) + c * (gunLY + 8);
                            let s = EffectManager._acquire('ShellCasingEffect');
                            if (s) { s.x = cSX; s.y = cSY; s.life = s.maxLife; s.active = true; }
                            else s = new ShellCasingEffect(cSX, cSY, baseAngle);
                            EffectManager.add(s); }
                        }
                        delete d.fireMainHand;
                    }
                } else if (isBow) {
                    const cfg = this.attacks.ranged.config;
                    const weaponCfg = (currentItem && currentItem.attack) || {};
                    const bowLX = this.size + 15, bowLY = holdY;
                    const spawnX = this.x + c * bowLX - sin * bowLY;
                    const spawnY = this.y + sin * bowLX + c * bowLY;
                    const angle = Math.atan2(d.targetY - spawnY, d.targetX - spawnX);
                    // 动态计算伤害（优先使用 getCurrentWeaponAtk 包含强化加成）
                    let weaponDamage = cfg.damage.min;
                    if (this.getCurrentWeaponAtk) {
                        weaponDamage = this.getCurrentWeaponAtk();
                    }
                    const damage = { min: weaponDamage, max: weaponDamage };
                    const projSpeed = weaponCfg.projectileSpeed || cfg.projectileSpeed;
                    const projRange = weaponCfg.range || cfg.projectileRange;
                    const projSize = weaponCfg.projectileSize || cfg.projectileSize;
                    const projPiercing = getEffectivePiercing(weaponCfg.piercing !== undefined ? weaponCfg.piercing : cfg.piercing, currentItem);
                    { let p = EffectManager._acquire('Projectile');
                    if (p) { p.x = spawnX; p.y = spawnY; p.angle = angle; p.speed = projSpeed; p.maxRange = projRange; p.size = projSize; p.damage = damage; p.piercing = projPiercing; p.source = this; p.entities = d.entities; p.image = this.arrowImage; p.traveled = 0; p.active = true; p.hitTargets = new Set(); }
                    else p = new Projectile(spawnX, spawnY, angle, projSpeed, projRange, projSize, damage, projPiercing, this, d.entities, this.arrowImage);
                    EffectManager.add(p); }
                }
                if (d && !d.fireMainHand && !d.fireOffhand) {
                    this.rangedFired = true; this.rangedFireData = null;
                }
            }
            updateWeaponAnim(dt) {
                const wa = WEAPON_ANIM, anim = this.weaponAnim;
                switch (anim.state) {
                    case 'idle':
                        if (anim.spinEnd && Date.now() < anim.spinEnd) {
                            const t = 1 - (anim.spinEnd - Date.now()) / anim.spinDuration;
                            anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06 + t * Math.PI * 8;
                            break;
                        }
                        anim.spinEnd = 0;
                        anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06;
                        // 装备双手武器时不播放旋转待机动画
                        const _idleItem = this.equipments[this.weaponMode];
                        const _isTwoHandedIdle = _idleItem && isTwoHanded(_idleItem);
                        if (_isTwoHandedIdle) {
                            // 双手武器：清除所有旋转状态
                            anim.nextSpin = 0;
                            anim.spinEnd = 0;
                        } else if (!_isTwoHandedIdle) {
                            if (!anim.nextSpin) anim.nextSpin = Date.now() + 3000 + Math.random() * 3000;
                            if (Date.now() >= anim.nextSpin) {
                                anim.spinDuration = 650; // 650ms内完成4圈旋转
                                anim.spinEnd = Date.now() + anim.spinDuration;
                                anim.nextSpin = Date.now() + anim.spinDuration + 3000 + Math.random() * 3000;
                            }
                        }
                        break;
                    case 'rotate':
                        // 弓类旋转阶段：500ms，逆时针旋转14度，平滑过渡
                        anim.timer += dt;
                        if (anim.timer >= 500) {
                            anim.state = 'windup';
                            anim.timer = 0;
                            anim.rotateAngle = -14 * (Math.PI / 180); // 定格在-14度
                            // 旋转完成，进入攻击动画，播放拉弓音效
                            SoundManager.playFile('assets/sounds/rope_pull_1s.wav');
                        } else {
                            // easeInOutCubic 平滑插值
                            const t = anim.timer / 500;
                            const easeT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
                            anim.rotateAngle = -14 * easeT * (Math.PI / 180);
                        }
                        break;
                    case 'windup':
                        anim.spinEnd = 0; // 攻击打断旋转动画
                        anim.timer += dt;
                        if (anim.timer >= this._getAnimMs(wa.windupMs)) { anim.state = 'swing'; anim.timer = 0; }
                        else anim.angle = wa.idleAngle + (wa.windupAngle - wa.idleAngle) * easeInQuad(anim.timer / this._getAnimMs(wa.windupMs));
                        break;
                    case 'swing':
                        // swing阶段：进行三角形攻击判定
                        if (anim.timer === 0 && this._pendingThrust) {
                            // swing阶段开始：标记攻击为活跃状态
                            this._pendingThrust.active = true;
                        }
                        // 每帧进行三角形命中判定（仅近战武器），判定窗口200ms
                        if (this._pendingThrust && this._pendingThrust.active) {
                            if (Date.now() - this._pendingThrust.startTime <= 200) {
                                this.attacks.melee.checkTriangleHit(this);
                            } else {
                                this._pendingThrust.active = false;
                            }
                        }
                        anim.timer += dt;
                        if (anim.timer >= this._getAnimMs(wa.swingMs)) {
                            anim.state = 'recover';
                            anim.timer = 0;
                            // swing阶段结束：统一发放经验（只计算一次）
                            if (this._pendingThrust) {
                                this._pendingThrust.active = false;
                                this.attacks.melee.giveExp(this);
                            }
                        }
                        else {
                            anim.angle = wa.windupAngle + (wa.swingAngle - wa.windupAngle) * easeOutQuad(anim.timer / this._getAnimMs(wa.swingMs));
                            // swing阶段：根据当前装备类型决定发射逻辑
                            // 弓除外：弓在攻击动画（recover）结束后才射出箭矢
                            const currentItem = this.equipments[this.weaponMode];
                            const isRangedWeapon = currentItem && (currentItem.weaponType === 'pistol' || currentItem.weaponType === 'pkm' || currentItem.weaponType === 'akm' || currentItem.weaponType === 'qbz191' || currentItem.weaponType === 'qjb201' || currentItem.weaponType === 'shotgun' || currentItem.weaponType === 'energy_lmg' || currentItem.rangedType === 'pistol');
                            const hasPendingMainShot = this.rangedFireData && this.rangedFireData.fireMainHand;
                            if ((!this.rangedFired || hasPendingMainShot) && isRangedWeapon && this.rangedFireData) this._fireRanged('main');
                        }
                        break;
                    case 'recover':
                        anim.timer += dt;
                        if (anim.timer >= this._getAnimMs(wa.recoverMs)) {
                            // 攻击动画完毕，弓在攻击动画结束后射出箭矢
                            const currentItem = this.equipments[this.weaponMode];
                            if (currentItem && currentItem.weaponType === 'bow' && !this.rangedFired && this.rangedFireData) {
                                // 更新目标位置为攻击动画结束时的准星位置（当前鼠标世界坐标）
                                const mouseWorldX = Input.mouse.x + Camera.x - CONFIG.VIEW_WIDTH / 2;
                                const mouseWorldY = Input.mouse.y + Camera.y - CONFIG.VIEW_HEIGHT / 2;
                                this.rangedFireData.targetX = mouseWorldX;
                                this.rangedFireData.targetY = mouseWorldY;
                                SoundManager.playFile('assets/sounds/arrow_flyby_1s.mp3');
                                this._fireRanged('main');
                            }
                            // 进入 idle_return 状态，200ms 平滑旋转回待机角度
                            anim.state = 'idle_return';
                            anim.timer = 0;
                            // 恢复阶段结束，完全清除攻击数据
                            this._pendingThrust = null;
                        }
                        else anim.angle = wa.swingAngle + (wa.idleAngle - wa.swingAngle) * easeInOutCubic(anim.timer / this._getAnimMs(wa.recoverMs));
                        break;
                    case 'idle_return':
                        // 攻击动画完毕后，弓从旋转角度回待机角度，200ms 平滑过渡
                        anim.timer += dt;
                        if (anim.timer >= 200) {
                            anim.state = 'idle';
                            anim.timer = 0;
                            anim.rotateAngle = 0; // 清除旋转角度
                        } else {
                            // easeInOutCubic 从 -14 度回 0 度
                            const t = anim.timer / 200;
                            const easeT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
                            anim.rotateAngle = -14 * (1 - easeT) * (Math.PI / 180);
                        }
                        break;
                }
                // 同步副手攻击动画（双持时显示攻击特效）
                // 对于双持手枪，副手使用独立的动画计时
                if (this.offhandWeaponAnim) {
                    const offhandSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                    const offhandItem = this.equipments[offhandSlot];
                    const isDualPistol = offhandItem && (offhandItem.weaponType === 'pistol' || offhandItem.rangedType === 'pistol');
                    if (isDualPistol) {
                        // 副手手枪：独立动画计时
                        const offAnim = this.offhandWeaponAnim;
                        const offWindupMs = this._getOffhandAnimMs(offhandItem, wa.windupMs);
                        const offSwingMs = this._getOffhandAnimMs(offhandItem, wa.swingMs);
                        const offRecoverMs = this._getOffhandAnimMs(offhandItem, wa.recoverMs);
                        switch (offAnim.state) {
                            case 'windup':
                                offAnim.timer += dt;
                                if (offAnim.timer >= offWindupMs) { offAnim.state = 'swing'; offAnim.timer = 0; }
                                break;
                            case 'swing':
                                offAnim.timer += dt;
                                if (offAnim.timer >= offSwingMs) { offAnim.state = 'recover'; offAnim.timer = 0; }
                                else {
                                    const hasPendingOffhand = this.rangedFireData && this.rangedFireData.fireOffhand;
                                    if (hasPendingOffhand) this._fireRanged('offhand');
                                }
                                break;
                            case 'recover':
                                offAnim.timer += dt;
                                if (offAnim.timer >= offRecoverMs) { offAnim.state = 'idle'; offAnim.timer = 0; }
                                break;
                        }
                    } else {
                        // 副手动画保持独立，不再同步主手动画
                        // 非双持状态下副手动画自行管理
                    }
                }
            }
            renderHealthBar(ctx, x, y) {
                const barWidth = 40, barHeight = 6;
                const hpPercent = Math.max(0, this.data.hp / this.data.maxHp);
                const barY = y - this.size - 28;
                // 背景
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.fillRect(x - barWidth/2, barY, barWidth, barHeight);
                // 血量
                let hpColor;
                if (hpPercent > 0.6) hpColor = '#4ade80';
                else if (hpPercent > 0.3) hpColor = '#facc15';
                else hpColor = '#ef4444';
                ctx.fillStyle = hpColor;
                ctx.fillRect(x - barWidth/2, barY, barWidth * hpPercent, barHeight);
                // 边框
                ctx.strokeStyle = 'rgba(60, 50, 40, 0.9)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x - barWidth/2, barY, barWidth, barHeight);
                // 血量文字（低于满血时显示）
                if (hpPercent < 1) {
                    ctx.fillStyle = '#ffffff';
                    ctx.font = 'bold 9px SimHei, "Microsoft YaHei", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(`${Math.ceil(this.data.hp)}`, x, barY + barHeight/2 + 0.5);
                }
            }
            renderStaminaBar(ctx, x, y) {
                const barWidth = 36, barHeight = 5, staminaPercent = this.data.stamina / this.data.maxStamina;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fillRect(x - barWidth/2, y + this.size + 36, barWidth, barHeight);
                const staminaColor = staminaPercent > 0.5 ? '#a09060' : staminaPercent > 0.25 ? '#a08040' : '#8a4a4a';
                ctx.fillStyle = staminaColor; ctx.fillRect(x - barWidth/2, y + this.size + 36, barWidth * staminaPercent, barHeight);
                ctx.strokeStyle = 'rgba(90, 77, 63, 0.8)'; ctx.lineWidth = 1; ctx.strokeRect(x - barWidth/2, y + this.size + 36, barWidth, barHeight);
                // ===== 机枪过热条渲染（体力条下方 3px） =====
                if (this._overheatActive) {
                    const ohY = y + this.size + 36 + barHeight + 3;
                    const ohPercent = this._overheatValue;
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                    ctx.fillRect(x - barWidth/2, ohY, barWidth, barHeight);
                    // 渐变红色：左边浅，右边深
                    const grad = ctx.createLinearGradient(x - barWidth/2, ohY, x + barWidth/2, ohY);
                    grad.addColorStop(0, '#ff6b6b');
                    grad.addColorStop(1, '#8a1a1a');
                    ctx.fillStyle = grad;
                    ctx.fillRect(x - barWidth/2, ohY, barWidth * ohPercent, barHeight);
                    ctx.strokeStyle = 'rgba(90, 77, 63, 0.8)';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x - barWidth/2, ohY, barWidth, barHeight);
                    // 过热时添加闪烁效果
                    if (this._overheatOverheated) {
                        const flicker = 0.5 + Math.sin(Date.now() / 100) * 0.3;
                        ctx.fillStyle = `rgba(255, 100, 100, ${flicker * 0.3})`;
                        ctx.fillRect(x - barWidth/2, ohY, barWidth, barHeight);
                    }
                }
                // ===== 换弹进度条渲染（过热条下方 3px，白色背景） =====
                const currentSlot = this.weaponMode;
                const currentItem = this.equipments[currentSlot];
                if (currentItem && isGunWeapon(currentItem)) {
                    const mainState = this._ammoState[currentSlot];
                    let nextY = y + this.size + 36 + barHeight + 3 + (this._overheatActive ? barHeight + 3 : 0);
                    if (mainState && mainState.reloading) {
                        const reloadPercent = 1 - (mainState.reloadTimer / mainState.reloadTime);
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                        ctx.fillRect(x - barWidth/2, nextY, barWidth, barHeight);
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(x - barWidth/2, nextY, barWidth * reloadPercent, barHeight);
                        ctx.strokeStyle = 'rgba(90, 77, 63, 0.8)';
                        ctx.lineWidth = 1;
                        ctx.strokeRect(x - barWidth/2, nextY, barWidth, barHeight);
                        nextY += barHeight + 3;
                    }
                    // 双持时：副手换弹进度条（主手下方 3px）
                    const offhandSlot = currentSlot === 'weapon' ? 'offhand' : 'ring2';
                    const offhandItem = this.equipments[offhandSlot];
                    const isDualWield = offhandItem && offhandItem.name && !offhandItem.isTwoHanded; // Bug-4 统一双持判断：副手有装备且非双手武器
                    if (isDualWield) {
                        const offState = this._ammoState[offhandSlot];
                        if (offState && offState.reloading) {
                            const offReloadPercent = 1 - (offState.reloadTimer / offState.reloadTime);
                            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                            ctx.fillRect(x - barWidth/2, nextY, barWidth, barHeight);
                            ctx.fillStyle = '#cccccc'; // 副手用浅灰色区分
                            ctx.fillRect(x - barWidth/2, nextY, barWidth * offReloadPercent, barHeight);
                            ctx.strokeStyle = 'rgba(90, 77, 63, 0.8)';
                            ctx.lineWidth = 1;
                            ctx.strokeRect(x - barWidth/2, nextY, barWidth, barHeight);
                        }
                    }
                }
            }
            renderWeapon(ctx) {
                const wa = WEAPON_ANIM;
                const s = wa.size;
                const ms = s * 0.75;
                // 获取当前武器栏位的装备
                let currentItem = this.equipments[this.weaponMode];
                // 如果当前栏位无装备，但另一栏位有装备，显示另一栏位的装备
                if (!currentItem || !currentItem.name) {
                    const otherSlot = this.weaponMode === 'weapon' ? 'weapon2' : 'weapon';
                    const otherItem = this.equipments[otherSlot];
                    if (otherItem && otherItem.name) {
                        currentItem = otherItem;
                    }
                }
                if (!currentItem || !currentItem.name) return; // 两个栏位都为空，不渲染

                // 如果 Phaser 渲染武器，检查是否需要 Canvas 渲染特殊动画
                const anim = this.weaponAnim;
                const isMeleeWeapon = currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword';
                const isBowAttacking = currentItem.weaponType === 'bow' && anim.state !== 'idle';
                const isSpecialAnim = this._isWhirlwind || this._isDashing || this._dashResetAnim || this._specialAttackActive || this._specialResetAnim || this._runeSwordSpecialActive || this._runeSwordResetAnim || isBowAttacking;
                if (this._usePhaserWeapon && !isSpecialAnim) {
                    if (isMeleeWeapon && currentItem.weaponEffect === 'runeSword' && this.weaponAnim.state === 'idle') {
                        let animState = 'idle';
                        if (this._isSprinting) animState = 'running';
                        else if (this.isMoving) animState = 'walk';
                        const swordCfg = getWeaponStateConfig('sword', animState);
                        ctx.save();
                        ctx.translate(-7, 0); // mainBaseX
                        ctx.translate(swordCfg.holdOffsetX || wa.holdX, swordCfg.holdOffsetY || wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -ms * 0.85);
                        this.weaponEffect.render(ctx);
                        ctx.restore();
                    }
                    return; // 跳过 Canvas 武器贴图渲染（特殊动画除外）
                }
                // 预加载另一栏位装备的图片
                const actualItem = this.equipments[this.weaponMode];
                if ((!actualItem || !actualItem.name) && currentItem.equipImage) {
                    if (this._lastFallbackItem !== currentItem.equipImage) {
                        this._lastFallbackItem = currentItem.equipImage;
                        if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') {
                            if (currentItem.canvasImageProp === 'deagleImage') {
                                this.deagleImage = new Image();
                                this.deagleImage.src = currentItem.equipImage;
                            } else {
                                this.pistolImage = new Image();
                                this.pistolImage.src = currentItem.equipImage;
                            }
                        } else if (currentItem.weaponType === 'pkm') {
                            this.pkmImage = new Image();
                            this.pkmImage.src = currentItem.equipImage;
                        } else if (currentItem.weaponType === 'akm') {
                            this.akmImage = new Image();
                            this.akmImage.src = currentItem.weaponAsset?.image || currentItem.equipImage;
                        } else if (currentItem.weaponType === 'qbz191') {
                            this.qbz191Image = new Image();
                            this.qbz191Image.src = currentItem.equipImage;
                        } else if (currentItem.weaponType === 'qjb201') {
                            this.qjb201Image = new Image();
                            this.qjb201Image.src = currentItem.equipImage;
                        } else if (currentItem.weaponType === 'shotgun') {
                            if (currentItem.canvasImageProp) {
                                this[currentItem.canvasImageProp] = new Image();
                                this[currentItem.canvasImageProp].src = currentItem.equipImage;
                            }
                        } else if (currentItem.weaponType === 'bow') {
                            // 弓帧动画在 switchWeaponMode 中处理
                        } else {
                            this.meleeImage = new Image();
                            this.meleeImage.src = currentItem.equipImage;
                        }
                    }
                }
                // 判断当前装备类型
                const isPistol = currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol';
                const isBow = currentItem.weaponType === 'bow';
                const isPkmOrAkm = currentItem.weaponType === 'pkm' || currentItem.weaponType === 'akm' || currentItem.weaponType === 'qbz191' || currentItem.weaponType === 'qjb201' || currentItem.weaponType === 'energy_lmg';
                const isShotgun = currentItem.weaponType === 'shotgun';
                const isMelee = currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword';
                const isAttacking = anim.state !== 'idle';
                const offhandSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                const offhandItem = this.equipments[offhandSlot];
                const isDualWield = offhandItem && offhandItem.name && !offhandItem.isTwoHanded; // Bug-4 统一双持判断：副手有装备且非双手武器
                // 武器位置根据类型调整：手枪/近战/弓后退5px，双手枪械保持原位置
                let mainBaseX, mainBaseY, offBaseX, offBaseY;
                if (isPistol) {
                    // 手枪（单持或双持）统一使用双持主手位置
                    mainBaseX = -15; mainBaseY = 16.5;
                    offBaseX = -5; offBaseY = -16.5;
                } else if (isPkmOrAkm || isShotgun) {
                    // 双手枪械：恢复为之前版本的位置
                    mainBaseX = isDualWield ? 0 : 8;
                    mainBaseY = isDualWield ? 8 : 0;
                    offBaseX = 0; offBaseY = -8;
                } else {
                    // 近战/弓：后退5px，双持时间距增加7px
                    mainBaseX = isDualWield ? -15 : -7;
                    mainBaseY = isDualWield ? 16.5 : 0;
                    offBaseX = -5; offBaseY = -16.5;
                }
                ctx.save();
                ctx.translate(mainBaseX, mainBaseY);
                const wpnDir = this._getFacingDirection();
                // 精灵图右手挂载点
                if (this._runningSpriteSheet && this._runningSpriteSheet.complete && this._runningSpriteSheet.naturalWidth > 0) {
                    const mountX = wpnDir === 'left' ? -15 : 15;
                    const mountY = wpnDir === 'left' ? 10 : -10;
                    ctx.translate(mountX, mountY);
                }
                if (wpnDir === 'left' || wpnDir === 'right') {
                    ctx.scale(-1, 1);
                }
                if (wpnDir === 'up') {
                    ctx.translate(0, -5);
                } else if (wpnDir === 'down') {
                    ctx.translate(0, 5);
                }
                // === 手枪渲染 ===
                if (isPistol) {
                    const pCfg = WeaponAnimConfig[currentItem.animConfigKey || 'pistol'];
                    const rp = pCfg.renderParams || {};
                    const weaponImg = currentItem.canvasImageProp ? this[currentItem.canvasImageProp] : this.pistolImage;
                    if (isAttacking) {
                        let recoil = 0, shakeY = 0;
                        if (anim.state === 'windup') {
                            recoil = -s * (rp.recoilWindup || 0.04) * easeOutQuad(anim.timer / this._getAnimMs(wa.windupMs));
                        } else if (anim.state === 'swing') {
                            const st = anim.timer / this._getAnimMs(wa.swingMs);
                            recoil = s * (rp.recoilSwing || 0.1) * (1 - st);
                            shakeY = (Math.random() - 0.5) * (rp.shakeIntensity || 3) * (1 - st);
                        } else {
                            const rt = anim.timer / this._getAnimMs(wa.recoverMs);
                            recoil = -s * (rp.recoilRecover || 0.04) * (1 - rt);
                        }
                        const ps = pCfg.idleScale || 1;
                        const gunX = (pCfg.holdOffsetX || 0) + recoil;
                        ctx.translate(gunX, (pCfg.holdOffsetY || 0) + shakeY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.42);
                        const pw = s * 0.275 * ps; const ph = s * 0.5 * ps;
                        if (weaponImg && weaponImg.complete && weaponImg.naturalWidth > 0) ctx.drawImage(weaponImg, -pw / 2, 0, pw, ph);
                    } else {
                        // 主手手枪待机：武器中心为旋转轴
                        const pCfg = WeaponAnimConfig[currentItem.animConfigKey || 'pistol'];
                        const ps = pCfg.idleScale || 1;
                        ctx.translate(pCfg.holdOffsetX || 0, pCfg.holdOffsetY || 0);
                        ctx.rotate(Math.PI / 2);
                        let finalAngle = anim.angle;
                        // 待机动画1：轻微摆动（始终生效）
                        if (anim.state === 'idle' && !anim.spinEnd) {
                            finalAngle += (pCfg.idleRotation || 0) * Math.PI / 180;
                            finalAngle += Math.sin(this.animTime * 0.4) * 0.02;
                            if (this.isMoving) {
                                const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                                finalAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                            }
                        }
                        ctx.translate(0, -s * 0.42);
                        ctx.rotate(finalAngle);
                        const pw = s * 0.275 * ps; const ph = s * 0.5 * ps;
                        if (weaponImg && weaponImg.complete && weaponImg.naturalWidth > 0) ctx.drawImage(weaponImg, -pw / 2, -ph / 2, pw, ph);
                    }
                }
                // === PKM / AKM 渲染 ===
                else if (isPkmOrAkm) {
                    const isActuallyPkm = currentItem.weaponType === 'pkm';
                    const pCfg = WeaponAnimConfig[currentItem.weaponType] || WeaponAnimConfig.akm;
                    let weaponImg;
                    if (isActuallyPkm) weaponImg = this.pkmImage;
                    else if (currentItem.weaponType === 'qbz191') weaponImg = this.qbz191Image;
                    else if (currentItem.weaponType === 'qjb201') weaponImg = this.qjb201Image;
                    else if (currentItem.weaponType === 'energy_lmg') weaponImg = this.energyLmgImage;
                    else weaponImg = this.akmImage;
                    if (isAttacking) {
                        let recoil = 0, shakeY = 0;
                        if (anim.state === 'windup') {
                            recoil = -s * 0.03 * easeOutQuad(anim.timer / this._getAnimMs(wa.windupMs));
                        } else if (anim.state === 'swing') {
                            const st = anim.timer / this._getAnimMs(wa.swingMs);
                            recoil = s * 0.08 * (1 - st);
                            shakeY = (Math.random() - 0.5) * 4 * (1 - st);
                        } else {
                            const rt = anim.timer / this._getAnimMs(wa.recoverMs);
                            recoil = -s * 0.03 * (1 - rt);
                        }
                        const gunX = (pCfg.holdOffsetX || 0) + recoil;
                        ctx.translate(gunX, (pCfg.holdOffsetY || 0) + shakeY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.42);
                        const scale = pCfg.idleScale || 1;
                        const w = s * 0.75 * scale;
                        const h = s * scale;
                        if (weaponImg && weaponImg.complete && weaponImg.naturalWidth > 0) ctx.drawImage(weaponImg, -w / 2, 0, w, h);
                    } else {
                        ctx.translate(pCfg.holdOffsetX || 0, pCfg.holdOffsetY || 0);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.42);
                        let finalAngle = anim.angle;
                        // 待机动画1：轻微摆动（始终生效）
                        if (anim.state === 'idle' && !anim.spinEnd) {
                            finalAngle += (pCfg.idleRotation || 0) * Math.PI / 180;
                            finalAngle += Math.sin(this.animTime * 0.4) * 0.02;
                            if (this.isMoving) {
                                const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                                finalAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                            }
                        }
                        ctx.rotate(finalAngle);
                        const scale = pCfg.idleScale || 1;
                        const w = s * 0.75 * scale;
                        const h = s * scale;
                        if (weaponImg && weaponImg.complete && weaponImg.naturalWidth > 0) ctx.drawImage(weaponImg, -w / 2, 0, w, h);
                    }
                }
                // === Super90 散弹枪渲染 ===
                else if (isShotgun) {
                    const pCfg = WeaponAnimConfig.shotgun || WeaponAnimConfig.akm;
                    const currentItem = this.equipments[this.weaponMode];
                    const weaponImg = currentItem && currentItem.canvasImageProp ? this[currentItem.canvasImageProp] : null;
                    if (isAttacking) {
                        let recoil = 0, shakeY = 0;
                        if (anim.state === 'windup') {
                            recoil = -s * 0.04 * easeOutQuad(anim.timer / this._getAnimMs(wa.windupMs));
                        } else if (anim.state === 'swing') {
                            const st = anim.timer / this._getAnimMs(wa.swingMs);
                            recoil = s * 0.12 * (1 - st);
                            shakeY = (Math.random() - 0.5) * 5 * (1 - st);
                        } else {
                            const rt = anim.timer / this._getAnimMs(wa.recoverMs);
                            recoil = -s * 0.04 * (1 - rt);
                        }
                        const gunX = (pCfg.holdOffsetX || 0) + recoil;
                        ctx.translate(gunX, (pCfg.holdOffsetY || 0) + shakeY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.42);
                        const scale = pCfg.idleScale || 1;
                        const w = s * 0.75 * scale;
                        const h = s * scale;
                        if (weaponImg && weaponImg.complete && weaponImg.naturalWidth > 0) ctx.drawImage(weaponImg, -w / 2, 0, w, h);
                    } else {
                        ctx.translate(pCfg.holdOffsetX || 0, pCfg.holdOffsetY || 0);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -s * 0.42);
                        let finalAngle = anim.angle;
                        // 待机动画1：轻微摆动（始终生效）
                        if (anim.state === 'idle' && !anim.spinEnd) {
                            finalAngle += (pCfg.idleRotation || 0) * Math.PI / 180;
                            finalAngle += Math.sin(this.animTime * 0.4) * 0.02;
                            if (this.isMoving) {
                                const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                                finalAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                            }
                        }
                        ctx.rotate(finalAngle);
                        const scale = pCfg.idleScale || 1;
                        const w = s * 0.75 * scale;
                        const h = s * scale;
                        if (weaponImg && weaponImg.complete && weaponImg.naturalWidth > 0) ctx.drawImage(weaponImg, -w / 2, 0, w, h);
                    }
                }
                // === 弓渲染 ===
                else if (isBow) {
                    if (isAttacking && anim.state !== 'rotate' && anim.state !== 'idle_return') {
                        // windup / swing / recover 阶段：帧动画
                        let t = 0;
                        if (anim.state === 'windup') t = easeOutQuad(anim.timer / wa.windupMs);
                        else if (anim.state === 'swing') t = 1;
                        else if (anim.state === 'recover') t = 1 - easeInQuad(anim.timer / wa.recoverMs);
                        
                        // 弓攻击动画：在旋转后的角度播放，固定朝向为 idleRotation + rotateAngle
                        const bowCfg = WeaponAnimConfig.bow;
                        ctx.translate(bowCfg.holdOffsetX || wa.holdX, bowCfg.holdOffsetY || wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        // 固定旋转到 idleRotation 角度 + 旋转阶段的角度（攻击在旋转后角度播放）
                        let finalAngle = 0;
                        if (bowCfg.idleRotation) {
                            finalAngle += bowCfg.idleRotation * Math.PI / 180;
                        }
                        // 加上旋转阶段的角度（攻击动画在旋转后的角度播放）
                        finalAngle += anim.rotateAngle || 0;
                        ctx.rotate(finalAngle);
                        
                        const scale = bowCfg.idleScale || 1;
                        
                        if (anim.state === 'recover') {
                            // recover 阶段：使用待机贴图，避免从帧动画切换到待机贴图的跳变
                            const bowImgIdle = this.bowEquipImage;
                            if (bowImgIdle && bowImgIdle.complete && bowImgIdle.naturalWidth > 0) {
                                const baseH = s * scale;
                                const aspect = bowImgIdle.naturalWidth / bowImgIdle.naturalHeight;
                                const w = baseH * aspect;
                                const h = baseH;
                                ctx.drawImage(bowImgIdle, -w / 2, -h / 2, w, h);
                            }
                        } else {
                            // windup / swing 阶段：显示帧动画
                            // 动态帧数弓动画
                            const frames = this.equippedBowFrames || this.bowFrames;
                            const frameCount = frames.length;
                            let frameIdx = 0;
                            const totalMs = wa.windupMs + wa.swingMs + wa.recoverMs;
                            let attackProgress = 0;
                            if (anim.state === 'windup') attackProgress = anim.timer / totalMs;
                            else if (anim.state === 'swing') attackProgress = (wa.windupMs + anim.timer) / totalMs;
                            else if (anim.state === 'recover') attackProgress = (wa.windupMs + wa.swingMs + anim.timer) / totalMs;
                            if (frameCount > 0) {
                                frameIdx = Math.min(frameCount - 1, Math.floor(attackProgress * frameCount));
                            }
                            const bowImg = frames[frameIdx] || frames[0];
                            if (bowImg && bowImg.complete && bowImg.naturalWidth > 0) {
                                const baseH = s * scale * 0.80; // 攻击帧缩小20%
                                const aspect = bowImg.naturalWidth / bowImg.naturalHeight;
                                const w = baseH * aspect;
                                const h = baseH;
                                ctx.drawImage(bowImg, -w / 2, -h / 2, w, h);
                            } else {
                                // 帧加载失败时，绘制待机贴图作为备用
                                const bowImgIdle = this.bowEquipImage;
                                if (bowImgIdle && bowImgIdle.complete && bowImgIdle.naturalWidth > 0) {
                                    const baseH = s * scale;
                                    const aspect = bowImgIdle.naturalWidth / bowImgIdle.naturalHeight;
                                    const w = baseH * aspect;
                                    const h = baseH;
                                    ctx.drawImage(bowImgIdle, -w / 2, -h / 2, w, h);
                                }
                            }
                        }
                    } else if (anim.state === 'rotate') {
                        // rotate 阶段：显示静态贴图并应用旋转
                        const bowCfg = WeaponAnimConfig.bow;
                        ctx.translate(bowCfg.holdOffsetX || wa.holdX, bowCfg.holdOffsetY || wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        let finalAngle = 0;
                        if (bowCfg.idleRotation) {
                            finalAngle += bowCfg.idleRotation * Math.PI / 180;
                        }
                        // 应用 rotateAngle（逆时针旋转，即负角度）
                        finalAngle += anim.rotateAngle || 0;
                        ctx.rotate(finalAngle);
                        const scale = bowCfg.idleScale || 1;
                        const bowImg = this.bowEquipImage;
                        if (bowImg && bowImg.complete && bowImg.naturalWidth > 0) {
                            const baseH = s * scale * 1.10; // 待机贴图增大10%
                            const aspect = bowImg.naturalWidth / bowImg.naturalHeight;
                            const w = baseH * aspect;
                            const h = baseH;
                            ctx.drawImage(bowImg, -w / 2, -h / 2, w, h);
                        } else {
                            const frames = this.equippedBowFrames || this.bowFrames;
                            const fallbackImg = frames[0];
                            if (fallbackImg && fallbackImg.complete && fallbackImg.naturalWidth > 0) {
                                const w = s * 0.6 * scale * 1.10;
                                const h = s * scale * 1.10;
                                ctx.drawImage(fallbackImg, -w / 2, -h / 2, w, h);
                            }
                        }
                    } else {
                        // 弓待机：使用装备栏贴图（trainingBOW.png），支持 WeaponAnimConfig 配置，带呼吸摆动
                        const bowCfg = WeaponAnimConfig.bow;
                        ctx.translate(bowCfg.holdOffsetX || wa.holdX, bowCfg.holdOffsetY || wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        // 应用 idleRotation + 呼吸摆动
                        let finalAngle = Math.sin(Date.now() / 400) * 0.06;
                        if (bowCfg.idleRotation) {
                            finalAngle += bowCfg.idleRotation * Math.PI / 180;
                        }
                        ctx.rotate(finalAngle);
                        const scale = bowCfg.idleScale || 1;
                        // 使用装备栏贴图 trainingBOW.png，根据原始比例动态缩放
                        const bowImg = this.bowEquipImage;
                        if (bowImg && bowImg.complete && bowImg.naturalWidth > 0) {
                            const baseH = s * scale * 1.10; // 待机贴图增大10%
                            const aspect = bowImg.naturalWidth / bowImg.naturalHeight;
                            const w = baseH * aspect;
                            const h = baseH;
                            ctx.drawImage(bowImg, -w / 2, -h / 2, w, h);
                        } else {
                            // 备用：使用 bowFrames[0]
                            const frames = this.equippedBowFrames || this.bowFrames;
                            const fallbackImg = frames[0];
                            if (fallbackImg && fallbackImg.complete && fallbackImg.naturalWidth > 0) {
                                const w = s * 0.6 * scale * 1.10;
                                const h = s * scale * 1.10;
                                ctx.drawImage(fallbackImg, -w / 2, -h / 2, w, h);
                            }
                        }
                    }
                }
                // === 近战（剑等）渲染 ===
                else if (isMelee) {
                    const ms = s * 0.75;
                    if (this._isWhirlwind) {
                        // 风车技能：武器跟随人物整体旋转（旋转在 render() 中已处理）
                        // 前50ms：武器远离人物平移15px；之后保持15px偏移
                        const w = ms * 0.63;
                        ctx.translate(wa.holdX + 8, wa.holdY + 6);
                        ctx.rotate(Math.PI / 2);
                        let whirlwindOffset = 0;
                        if (this._whirlwindTimer <= 50) {
                            whirlwindOffset = 15 * easeOutQuad(this._whirlwindTimer / 50);
                        } else {
                            whirlwindOffset = 15;
                        }
                        ctx.translate(0, whirlwindOffset);
                        ctx.translate(0, -ms * 0.85);
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -ms / 2, w, ms);
                        }
                        if (currentItem && currentItem.weaponEffect === 'runeSword') {
                            this.weaponEffect.render(ctx);
                        }
                    } else if (this._isDashing) {
                        // ===== 冲刺攻击武器动画 =====
                        const activeSkillId = this._getActiveDashSkillId();
                        const state = this.dashSystem._getDashWeaponStateAt(this._dashTimer, activeSkillId);
                        const w = ms * 0.63;
                        // 旋转中心在剑柄位置（主角处），与待机/攻击动画一致
                        ctx.translate(wa.holdX + 8, wa.holdY + 6);
                        ctx.rotate(Math.PI / 2); // 基础旋转，使待机时武器水平朝右
                        ctx.translate(0, state.dashOffset);
                        ctx.rotate(state.dashAngle);

                        ctx.translate(0, -ms * 0.85); // 移到武器中心，确保位置与待机/攻击一致
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -ms / 2, w, ms);
                        }
                        // weapon4 粒子：在武器变换后绘制，但粒子本身不旋转
                        if (currentItem && currentItem.weaponEffect === 'runeSword') {
                            this.weaponEffect.render(ctx);
                        }
                    } else if (this._dashResetAnim) {
                        // 冲刺攻击后复位动画：旋转与回位同步进行（0-100%）
                        const elapsed = Date.now() - this._dashResetAnim.startTime;
                        const t = Math.min(1, elapsed / this._dashResetAnim.duration);
                        const w = ms * 0.63;
                        const easeT = easeOutQuart(t);
                        // 武器自身角度回位：startAngle -> 0
                        const currentAngle = this._dashResetAnim.startAngle * (1 - easeT);
                        // 武器偏移回位：startOffset -> 0
                        const currentOffset = this._dashResetAnim.startOffset * (1 - easeT);
                        // 武器base位置回位：攻击(-12, 17) -> 待机(-20, 11)
                        const attackBaseX = wa.holdX + 8;
                        const attackBaseY = wa.holdY + 6;
                        const idleBaseX = wa.holdX;
                        const idleBaseY = wa.holdY;
                        const currentBaseX = attackBaseX + (idleBaseX - attackBaseX) * easeT;
                        const currentBaseY = attackBaseY + (idleBaseY - attackBaseY) * easeT;
                        ctx.translate(currentBaseX, currentBaseY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, currentOffset);
                        ctx.rotate(currentAngle);
                        ctx.translate(0, -ms * 0.85);
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -ms / 2, w, ms);
                        }
                        if (currentItem && currentItem.weaponEffect === 'runeSword') {
                            this.weaponEffect.render(ctx);
                        }
                    } else if (this._specialResetAnim) {
                        // 特殊攻击后复位动画：同步旋转+回位
                        const elapsed = Date.now() - this._specialResetAnim.startTime;
                        const t = Math.min(1, elapsed / this._specialResetAnim.duration);
                        const easeT = easeOutQuart(t);
                        const w = ms * 0.63;
                        const currentAngle = this._specialResetAnim.startAngle * (1 - easeT);
                        const currentOffset = this._specialResetAnim.startOffset * (1 - easeT);
                        const attackBaseX = wa.holdX + 8;
                        const attackBaseY = wa.holdY + 6;
                        const idleBaseX = wa.holdX;
                        const idleBaseY = wa.holdY;
                        const currentBaseX = attackBaseX + (idleBaseX - attackBaseX) * easeT;
                        const currentBaseY = attackBaseY + (idleBaseY - attackBaseY) * easeT;
                        ctx.translate(currentBaseX, currentBaseY);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, currentOffset);
                        ctx.rotate(currentAngle);
                        ctx.translate(0, -ms * 0.85);
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -ms / 2, w, ms);
                        }
                        if (currentItem && currentItem.weaponEffect === 'runeSword') {
                            this.weaponEffect.render(ctx);
                        }
                    } else if (this._specialAttackActive) {
                        // 特殊攻击期间：武器前伸15px
                        const w = ms * 0.63;
                        ctx.translate(wa.holdX + 8, wa.holdY + 6);
                        ctx.rotate(Math.PI / 2);
                        ctx.translate(0, -ms * 0.85);
                        ctx.translate(0, -15); // 武器前伸 15px（减半）
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) {
                            ctx.drawImage(this.meleeImage, -w / 2, -ms / 2, w, ms);
                        }
                        if (currentItem && currentItem.weaponEffect === 'runeSword') {
                            this.weaponEffect.render(ctx);
                        }
                    } else if (isAttacking) {
                        // 使用刺击动画配置（Stab Animation），可被所有剑类武器复用
                        const stab = WeaponAnimConfig.stab;
                        ctx.translate(wa.holdX + 8, wa.holdY + 6);
                        ctx.rotate(Math.PI / 2);
                        // 移动到武器中心（旋转中心在武器中心）
                        ctx.translate(0, -ms * 0.85);
                        let thrustOffset = 0;
                        if (anim.state === 'windup') {
                            const t = anim.timer / this._getAnimMs(wa.windupMs);
                            // 蓄力：回退（靠近角色），使用正值
                            thrustOffset = ms * stab.windupDist * easeInCubic(t);
                        } else if (anim.state === 'swing') {
                            const t = anim.timer / this._getAnimMs(wa.swingMs);
                            // 攻击：前刺（远离角色），使用负值
                            if (t < 0.6) {
                                const pt = t / 0.6;
                                // 从回退位置 (+29.4) 快速前刺到 -151.2
                                thrustOffset = ms * stab.windupDist - ms * (stab.stabDist + stab.windupDist) * easeOutQuad(pt);
                            } else {
                                thrustOffset = -ms * stab.stabDist;
                            }
                        } else {
                            const t = anim.timer / this._getAnimMs(wa.recoverMs);
                            // 后摇：先瞬移回待机位置附近，再平滑过渡
                            const snapRatio = 0.15; // 15%时间完成瞬移
                            if (t < snapRatio) {
                                const pt = t / snapRatio;
                                // 线性快速从最远点瞬移到 -8px
                                thrustOffset = -ms * stab.stabDist + (ms * stab.stabDist - stab.recoverSnapDist) * pt;
                            } else {
                                const pt = (t - snapRatio) / (1 - snapRatio);
                                // 平滑 easeOut 从 -8px 到 0
                                thrustOffset = -stab.recoverSnapDist * (1 - easeOutQuad(pt));
                            }
                        }
                        ctx.translate(0, thrustOffset);
                        ctx.rotate(anim.angle);
                        const w = ms * 0.63;
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) ctx.drawImage(this.meleeImage, -w / 2, -ms / 2, w, ms);
                        // weapon4 符文长剑：绘制蓝色发光粒子（紧密贴合剑身，50%透明度）
                        if (currentItem && currentItem.weaponEffect === 'runeSword') {
                            this.weaponEffect.render(ctx);
                        }
                    } else {
                        // 近战待机：武器固定在绑定位置，不随鼠标旋转
                        let animState = 'idle';
                        if (this._isSprinting) animState = 'running';
                        else if (this.isMoving) animState = 'walk';
                        const swordCfg = getWeaponStateConfig('sword', animState);
                        ctx.translate(swordCfg.holdOffsetX || wa.holdX, swordCfg.holdOffsetY || wa.holdY);
                        ctx.rotate(Math.PI / 2);
                        // 先移动到武器中心，使旋转中心在武器中心
                        ctx.translate(0, -ms * 0.85);
                        // weapon4 符文长剑：在呼吸旋转前绘制粒子
                        if (currentItem && currentItem.weaponEffect === 'runeSword') {
                            this.weaponEffect.render(ctx);
                        }
                        // 武器固定角度：只使用 idleRotation，不随鼠标方向旋转
                        let finalAngle = 0;
                        // 可选：保留极微弱的呼吸摆动，不随鼠标
                        // finalAngle += Math.sin(this.animTime * 0.4) * 0.02;
                        // 应用配置的 idleRotation（固定偏移角度）
                        if (swordCfg.idleRotation) {
                            finalAngle += swordCfg.idleRotation * Math.PI / 180;
                        }
                        ctx.rotate(finalAngle);
                        // 应用配置的 idleScale（开发工具调整值）
                        const scale = swordCfg.idleScale || 1;
                        const w = ms * 0.63 * scale;
                        const h = ms * scale;
                        if (this.meleeImage && this.meleeImage.complete && this.meleeImage.naturalWidth > 0) ctx.drawImage(this.meleeImage, -w / 2, -h / 2, w, h);
                    }
                }
                ctx.restore(); // 恢复主手前的坐标系，副手将在角色原始坐标系中绘制
                // === 副手渲染（角色左方，独立动画）===
                if (isDualWield && offhandItem && offhandItem.name) {
                    const offIsPistol = offhandItem.weaponType === 'pistol' || offhandItem.rangedType === 'pistol';
                    const offIsPkmOrAkm = offhandItem.weaponType === 'pkm' || offhandItem.weaponType === 'akm' || offhandItem.weaponType === 'qbz191' || offhandItem.weaponType === 'qjb201';
                    const offIsBow = offhandItem.weaponType === 'bow';
                    const offIsMelee = offhandItem.category === 'weapon_melee' || offhandItem.weaponType === 'sword';
                    
                    // 副手独立动画（跟随主手攻击状态）
                    const offhandAnim = this.offhandWeaponAnim || { state: 'idle', timer: 0, angle: WEAPON_ANIM.idleAngle };
                    // 待机时：呼吸效果
                    if (offhandAnim.state === 'idle') {
                        // 副手待机动画2：360度旋转（与主手独立触发时间）
                        // 装备机枪时不播放旋转待机动画
                        const offhandItemForIdle = this.equipments[offhandSlot];
                        const offhandIsMachineGun = offhandItemForIdle && (offhandItemForIdle.weaponType === 'pkm' || offhandItemForIdle.weaponType === 'akm' || offhandItemForIdle.weaponType === 'qbz191' || offhandItemForIdle.weaponType === 'qjb201');
                        if (offhandAnim.spinEnd && Date.now() < offhandAnim.spinEnd) {
                            const t = 1 - (offhandAnim.spinEnd - Date.now()) / offhandAnim.spinDuration;
                            offhandAnim.angle = WEAPON_ANIM.idleAngle + Math.sin(Date.now() / 400) * 0.06 + t * Math.PI * 8;
                        } else {
                            offhandAnim.spinEnd = 0;
                            offhandAnim.angle = WEAPON_ANIM.idleAngle + Math.sin(Date.now() / 400) * 0.06;
                            if (this.isMoving && !offhandAnim.spinEnd) {
                                const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                                offhandAnim.angle += Math.sin(this.animTime * 0.5) * Math.min(0.15, mSpeed * 0.04);
                            }
                            // 副手独立旋转触发时间（偏移1500ms避免与主手同步）
                            if (!offhandIsMachineGun) {
                                if (!offhandAnim.nextSpin) offhandAnim.nextSpin = Date.now() + 4500 + Math.random() * 3000;
                                if (Date.now() >= offhandAnim.nextSpin) {
                                    offhandAnim.spinDuration = 650;
                                    offhandAnim.spinEnd = Date.now() + offhandAnim.spinDuration;
                                    offhandAnim.nextSpin = Date.now() + offhandAnim.spinDuration + 4500 + Math.random() * 3000;
                                }
                            }
                        }
                    }
                    
                    const offIsAttacking = offhandAnim.state !== 'idle';
                    ctx.save();
                    ctx.translate(offBaseX, offBaseY); // 副手位置
                    // 精灵图左手挂载点
                    if (this._runningSpriteSheet && this._runningSpriteSheet.complete && this._runningSpriteSheet.naturalWidth > 0) {
                        const mountX = wpnDir === 'left' ? 15 : -15;
                        const mountY = wpnDir === 'left' ? 10 : -10;
                        ctx.translate(mountX, mountY);
                    }
                    if (wpnDir === 'left' || wpnDir === 'right') {
                        ctx.scale(-1, 1);
                    }
                    if (wpnDir === 'up') {
                        ctx.translate(0, -5);
                    } else if (wpnDir === 'down') {
                        ctx.translate(0, 5);
                    }
                    ctx.rotate(Math.PI / 2);
                    
                    let offhandImg, w, drawY, drawH = s;
                    if (offIsPistol) {
                        const offPCfg = WeaponAnimConfig[offhandItem.animConfigKey || 'pistol'];
                        const offRp = offPCfg.renderParams || {};
                        const offPs = offPCfg.idleScale || 1;
                        offhandImg = offhandItem.equipImage ? (() => { const img = new Image(); img.src = offhandItem.equipImage; return img; })() : this.pistolImage;
                        const pw = s * 0.275 * offPs; const ph = s * 0.5 * offPs;
                        if (offIsAttacking) {
                            let recoil = 0, shakeY = 0;
                            const offWindupMs = this._getOffhandAnimMs(offhandItem, wa.windupMs);
                            const offSwingMs = this._getOffhandAnimMs(offhandItem, wa.swingMs);
                            const offRecoverMs = this._getOffhandAnimMs(offhandItem, wa.recoverMs);
                            if (offhandAnim.state === 'windup') {
                                recoil = -s * (offRp.recoilWindup || 0.04) * easeOutQuad(offhandAnim.timer / offWindupMs);
                            } else if (offhandAnim.state === 'swing') {
                                const st = offhandAnim.timer / offSwingMs;
                                recoil = s * (offRp.recoilSwing || 0.1) * (1 - st);
                                shakeY = (offRp.shakeIntensity || 3) === 0 ? 0 : (Math.random() - 0.5) * (offRp.shakeIntensity || 3) * (1 - st);
                            } else {
                                const rt = offhandAnim.timer / offRecoverMs;
                                recoil = -s * (offRp.recoilRecover || 0.04) * (1 - rt);
                            }
                            ctx.translate(recoil, shakeY);
                            ctx.translate(0, -s * 0.42);
                            w = pw; drawY = 0; drawH = ph;
                        } else {
                            ctx.translate(0, -s * 0.42);
                            w = pw; drawY = -ph / 2; drawH = ph;
                        }
                    } else if (offIsPkmOrAkm) {
                        if (offhandItem.weaponType === 'pkm') offhandImg = this.pkmImage;
                        else if (offhandItem.weaponType === 'qbz191') offhandImg = this.qbz191Image;
                        else if (offhandItem.weaponType === 'qjb201') offhandImg = this.qjb201Image;
                        else offhandImg = this.akmImage;
                        w = s * 0.75;
                        ctx.translate(0, -s * 0.42);
                        drawY = 0;
                    } else if (offIsBow) {
                        const frames = offhandItem.bowFrames || this.bowFrames;
                        offhandImg = frames[0];
                        w = s * 0.6;
                        ctx.translate(0, -s / 2);
                        drawY = -s / 2;
                    } else if (offIsMelee) {
                        const ms = s * 0.75;
                        offhandImg = offhandItem.equipImage ? (() => { const img = new Image(); img.src = offhandItem.equipImage; return img; })() : this.meleeImage;
                        w = ms * 0.63;
                        ctx.translate(0, -ms * 0.85);
                        drawY = -ms / 2;
                        drawH = ms;
                    }
                    
                    ctx.rotate(offhandAnim.angle);
                    
                    if (offhandImg && offhandImg.complete && offhandImg.naturalWidth > 0) {
                        ctx.drawImage(offhandImg, -w / 2, drawY, w, drawH);
                    } else {
                        ctx.fillStyle = '#4a4a5a'; ctx.fillRect(-w/2, -s/2, w, s);
                    }
                    
                    ctx.restore();
                }
                // ===== 边境长弓蓄力满闪光特效（武器） =====
                if (this._chargeFlashActive && currentItem && currentItem.chargeAttack) {
                    const flashAlpha = Math.min(1, this._chargeFlashTimer / 500);
                    ctx.globalCompositeOperation = 'source-atop';
                    ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha * 0.7})`;
                    ctx.fillRect(-60, -60, 120, 120);
                    ctx.globalCompositeOperation = 'source-over';
                }
                ctx.restore(); // 恢复 renderWeapon 开始的 ctx.save()
            }

            /**
             * 计算主手武器动画参数（用于 Phaser Sprite 同步）
             * @returns {{recoil?: number, recoilAngle?: number, thrust?: number, scale?: number}}
             */
            _getWeaponAnimParams() {
                const wa = WEAPON_ANIM;
                const anim = this.weaponAnim;
                const currentItem = this.equipments[this.weaponMode];
                const params = {};

                if (!currentItem || !currentItem.name) return params;

                const isPistol = currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol';
                const isPkmOrAkm = currentItem.weaponType === 'pkm' || currentItem.weaponType === 'akm' || currentItem.weaponType === 'qbz191' || currentItem.weaponType === 'qjb201' || currentItem.weaponType === 'energy_lmg';
                const isShotgun = currentItem.weaponType === 'shotgun';
                const isMelee = currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword';
                const s = wa.size;

                // 弓类攻击动画（旋转 + 拉弓后移）
                if (currentItem.weaponType === 'bow' && anim.state !== 'idle') {
                    // 所有非待机阶段都隐藏 Phaser，由 Canvas 渲染
                    params.isAttacking = true;
                    
                    // rotate / idle_return 阶段：传递旋转角度
                    if (anim.state === 'rotate' || anim.state === 'idle_return') {
                        params.rotateAngle = anim.rotateAngle || 0;
                    }
                    
                    // windup / swing / recover 阶段：拉弓后移
                    let recoil = 0;
                    if (anim.state === 'windup') {
                        const t = anim.timer / this._getAnimMs(wa.windupMs);
                        recoil = -s * 0.08 * easeOutQuad(t); // 拉弓后移
                    } else if (anim.state === 'swing') {
                        const st = anim.timer / this._getAnimMs(wa.swingMs);
                        recoil = s * 0.05 * (1 - st); // 释放后轻微前移
                    } else if (anim.state === 'recover') {
                        const rt = anim.timer / this._getAnimMs(wa.recoverMs);
                        recoil = -s * 0.03 * (1 - rt); // 缓慢回到待机
                    }
                    params.recoil = recoil;
                }

                // 枪械后坐力
                if ((isPistol || isPkmOrAkm || isShotgun) && anim.state !== 'idle') {
                    let recoil = 0;
                    if (anim.state === 'windup') {
                        recoil = -s * 0.03 * easeOutQuad(anim.timer / this._getAnimMs(wa.windupMs));
                    } else if (anim.state === 'swing') {
                        const st = anim.timer / this._getAnimMs(wa.swingMs);
                        recoil = s * 0.1 * (1 - st);
                    } else if (anim.state === 'recover') {
                        const rt = anim.timer / this._getAnimMs(wa.recoverMs);
                        recoil = -s * 0.03 * (1 - rt);
                    }
                    params.recoil = recoil;
                    params.recoilAngle = -recoil * 0.05; // 轻微旋转角度
                }

                // 枪械待机动画1：轻微摆动（Phaser 同步）
                if ((isPistol || isPkmOrAkm || isShotgun) && anim.state === 'idle' && !anim.spinEnd) {
                    let swayAngle = Math.sin(this.animTime * 0.4) * 0.02;
                    if (this.isMoving) {
                        const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                        swayAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                    }
                    params.animAngle = swayAngle;
                }

                // 剑类刺击动画
                if (isMelee && !this._isWhirlwind && !this._isDashing && !this._specialAttackActive && !this._dashResetAnim && !this._specialResetAnim && !this._runeSwordResetAnim) {
                    if (anim.state === 'idle') {
                        // 待机时：不随鼠标旋转，固定角度（WeaponTransform.getWeaponRotation 中已应用 idleRotation）
                        let animAngle = 0;
                        // 可选：保留极轻微的移动呼吸摆动
                        if (this.isMoving && !anim.spinEnd) {
                            const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                            animAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                        }
                        params.animAngle = animAngle;
                    } else {
                        // 攻击时：正常传递刺击动画角度
                        params.animAngle = anim.angle || 0;
                        const stab = WeaponAnimConfig.stab;
                        const ms = s * 0.75;
                        let thrust = 0;
                        if (anim.state === 'windup') {
                            const t = anim.timer / this._getAnimMs(wa.windupMs);
                            thrust = ms * stab.windupDist * easeInCubic(t);
                        } else if (anim.state === 'swing') {
                            const t = anim.timer / this._getAnimMs(wa.swingMs);
                            if (t < 0.6) {
                                const pt = t / 0.6;
                                thrust = ms * stab.windupDist - ms * (stab.stabDist + stab.windupDist) * easeOutQuad(pt);
                            } else {
                                thrust = -ms * stab.stabDist;
                            }
                        } else if (anim.state === 'recover') {
                            const t = anim.timer / this._getAnimMs(wa.recoverMs);
                            const snapRatio = 0.15;
                            if (t < snapRatio) {
                                const pt = t / snapRatio;
                                thrust = -ms * stab.stabDist + (ms * stab.stabDist - stab.recoverSnapDist) * pt;
                            } else {
                                const pt = (t - snapRatio) / (1 - snapRatio);
                                thrust = -stab.recoverSnapDist * (1 - easeOutQuad(pt));
                            }
                        }
                        params.thrust = thrust;
                    }
                }

                // 武器缩放（如符文长剑的 +50%）
                if (isMelee) {
                    let animState = 'idle';
                    if (this._isSprinting) animState = 'running';
                    else if (this.isMoving) animState = 'walk';
                    const swordCfg = getWeaponStateConfig('sword', animState);
                    if (swordCfg.idleScale && swordCfg.idleScale !== 1) {
                        params.scale = swordCfg.idleScale;
                    }
                }

                return params;
            }

            /**
             * 计算副手武器动画参数（用于 Phaser Sprite 同步）
             * @returns {{recoil?: number, recoilAngle?: number, thrust?: number, scale?: number}}
             */
            _getOffhandWeaponAnimParams() {
                const wa = WEAPON_ANIM;
                const offhandSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                const offhandItem = this.equipments[offhandSlot];
                const params = {};

                if (!offhandItem || !offhandItem.name) return params;

                const offhandAnim = this.offhandWeaponAnim || { state: 'idle', timer: 0, angle: WEAPON_ANIM.idleAngle };
                const isPistol = offhandItem.weaponType === 'pistol' || offhandItem.rangedType === 'pistol';
                const isPkmOrAkm = offhandItem.weaponType === 'pkm' || offhandItem.weaponType === 'akm' || offhandItem.weaponType === 'qbz191' || offhandItem.weaponType === 'qjb201';
                const isShotgun = offhandItem.weaponType === 'shotgun';
                const isMelee = offhandItem.category === 'weapon_melee' || offhandItem.weaponType === 'sword';
                const s = wa.size;

                // 副手后坐力（仅手枪）
                if (isPistol && offhandAnim.state !== 'idle') {
                    let recoil = 0;
                    const offWindupMs = this._getOffhandAnimMs(offhandItem, wa.windupMs);
                    const offSwingMs = this._getOffhandAnimMs(offhandItem, wa.swingMs);
                    const offRecoverMs = this._getOffhandAnimMs(offhandItem, wa.recoverMs);
                    if (offhandAnim.state === 'windup') {
                        recoil = -s * 0.03 * easeOutQuad(offhandAnim.timer / offWindupMs);
                    } else if (offhandAnim.state === 'swing') {
                        const st = offhandAnim.timer / offSwingMs;
                        recoil = s * 0.1 * (1 - st);
                    } else if (offhandAnim.state === 'recover') {
                        const rt = offhandAnim.timer / offRecoverMs;
                        recoil = -s * 0.03 * (1 - rt);
                    }
                    params.recoil = recoil;
                    params.recoilAngle = -recoil * 0.05;
                }

                // 副手刺击动画
                if (isMelee && offhandAnim.state !== 'idle') {
                    const stab = WeaponAnimConfig.stab;
                    const ms = s * 0.75;
                    let thrust = 0;
                    if (offhandAnim.state === 'windup') {
                        const t = offhandAnim.timer / this._getOffhandAnimMs(offhandItem, wa.windupMs);
                        thrust = ms * stab.windupDist * easeInCubic(t);
                    } else if (offhandAnim.state === 'swing') {
                        const t = offhandAnim.timer / this._getOffhandAnimMs(offhandItem, wa.swingMs);
                        if (t < 0.6) {
                            const pt = t / 0.6;
                            thrust = ms * stab.windupDist - ms * (stab.stabDist + stab.windupDist) * easeOutQuad(pt);
                        } else {
                            thrust = -ms * stab.stabDist;
                        }
                    } else if (offhandAnim.state === 'recover') {
                        const t = offhandAnim.timer / this._getOffhandAnimMs(offhandItem, wa.recoverMs);
                        const snapRatio = 0.15;
                        if (t < snapRatio) {
                            const pt = t / snapRatio;
                            thrust = -ms * stab.stabDist + (ms * stab.stabDist - stab.recoverSnapDist) * pt;
                        } else {
                            const pt = (t - snapRatio) / (1 - snapRatio);
                            thrust = -stab.recoverSnapDist * (1 - easeOutQuad(pt));
                        }
                    }
                    params.thrust = thrust;
                }

                // 副手缩放
                if (isMelee) {
                    let animState = 'idle';
                    if (this._isSprinting) animState = 'running';
                    else if (this.isMoving) animState = 'walk';
                    const swordCfg = getWeaponStateConfig('sword', animState);
                    if (swordCfg.idleScale && swordCfg.idleScale !== 1) {
                        params.scale = swordCfg.idleScale;
                    }
                }

                return params;
            }

            // 调试坐标系绘制（与 Canvas 坐标系一致：X+向右，Y+向下）
            _drawDebugCoordinateSystem(ctx) {
                ctx.save();
                ctx.lineWidth = 2;
                // x轴（向右，红色）
                ctx.strokeStyle = '#ff5555';
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(150, 0); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(145, -5); ctx.lineTo(150, 0); ctx.lineTo(145, 5); ctx.stroke();
                // y轴（向下，绿色）——与 Canvas 一致，Y+向下
                ctx.strokeStyle = '#55ff55';
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 150); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(-5, 145); ctx.lineTo(0, 150); ctx.lineTo(5, 145); ctx.stroke();
                // 刻度
                ctx.fillStyle = '#888888';
                ctx.font = '10px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                for (let i = -100; i <= 100; i += 10) {
                    if (i === 0) continue;
                    ctx.strokeStyle = '#ff5555'; ctx.lineWidth = 0.5;
                    ctx.beginPath(); ctx.moveTo(i, -3); ctx.lineTo(i, 3); ctx.stroke();
                    if (i % 20 === 0) ctx.fillText(String(i), i, 12);
                    ctx.strokeStyle = '#55ff55'; ctx.lineWidth = 0.5;
                    ctx.beginPath(); ctx.moveTo(-3, i); ctx.lineTo(3, i); ctx.stroke();
                    if (i % 20 === 0) ctx.fillText(String(i), -12, i);
                }
                // 原点
                ctx.fillStyle = '#ffffff';
                ctx.fillText('0', -10, 10);
                ctx.restore();
            }

            /**
             * 绘制黑色火柴人（伪骨骼）
             * 角色坐标系：面向右侧（0弧度），Y+向下
             */
            _drawStickFigure(ctx, bodyScale = 1, bodyOffsetX = 0, bodyOffsetY = 0) {
                // 与精灵图一致：反旋转回屏幕空间，保持直立；左右用水平翻转
                ctx.save();
                ctx.rotate(-this.rotation);
                ctx.translate(bodyOffsetX, bodyOffsetY);
                ctx.scale(bodyScale, bodyScale);

                if (this._getFacingDirection() === 'left') ctx.scale(-1, 1);

                const color = this.hitFlash > 0 ? '#ffffff' : '#111111';
                const lw = this.hitFlash > 0 ? 4 : 3;
                ctx.strokeStyle = color;
                ctx.fillStyle = color;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.lineWidth = lw;

                // ================================================================
                // 基于用户提供的图像识别的关节坐标（直立姿态，Y+向下）
                // 图像尺寸 199x420，红点标记的关节位置已按玩家比例缩放
                // ================================================================
                let J = {
                    head:   { x: 0,  y: -28 },
                    neck:   { x: 0,  y: -19 },
                    shoulder:{x: 0,  y: -18 },
                    lShldr: { x: -7, y: -18 },
                    rShldr: { x: 7,  y: -18 },
                    lElbow: { x: -12,y: -6  },
                    rElbow: { x: 12, y: -3  },
                    lHand:  { x: -8, y: 7   },
                    rHand:  { x: 14, y: 7   },
                    hip:    { x: 0,  y: 18  },
                    lHip:   { x: -6, y: 18  },
                    rHip:   { x: 6,  y: 18  },
                    lKnee:  { x: -8, y: 35  },
                    rKnee:  { x: 8,  y: 35  },
                    lFoot:  { x: -10,y: 52  },
                    rFoot:  { x: 10, y: 52  }
                };

                // ================================================================
                // Walk 动画：2秒循环，左右脚交替走2步
                // ================================================================
                if (this.isMoving && !this.isDodging && !this._isWhirlwind) {
                    const walkCycle = (Date.now() / 1000) % 2;          // 0 ~ 2 秒
                    const phase = walkCycle * Math.PI;                  // 0 ~ 2π
                    const sinP = Math.sin(phase);                       // 左腿主相位
                    const cosP = Math.cos(phase);                       // 用于抬脚和臀部位移
                    const sin2P = Math.sin(phase * 2);                // 2倍频，用于臀部起伏

                    // ---- 臀部起伏（每步一次）----
                    const hipBob = sin2P * 1.5;
                    J.head.y   += hipBob * 0.3;
                    J.neck.y   += hipBob * 0.4;
                    J.shoulder.y += hipBob * 0.4;
                    J.lShldr.y += hipBob * 0.4;
                    J.rShldr.y += hipBob * 0.4;
                    J.hip.y    += hipBob;
                    J.lHip.y   += hipBob;
                    J.rHip.y   += hipBob;

                    // ---- 左腿（phase 0-π 时向前）----
                    const lForward = Math.max(0, sinP);   // 0~1 向前阶段
                    const lLift = Math.max(0, cosP);      // 抬脚阶段（与sin错开）
                    const lFootX = sinP * 10;             // 前后摆动 10px
                    const lFootY = -lLift * 4 - lForward * 2; // 抬脚+前伸
                    J.lFoot.x  += lFootX;
                    J.lFoot.y  += lFootY;
                    J.lKnee.x  += lFootX * 0.55;          // 膝盖跟随
                    J.lKnee.y  += lFootY * 0.6;

                    // ---- 右腿（与左腿反相）----
                    const rForward = Math.max(0, -sinP);
                    const rLift = Math.max(0, -cosP);
                    const rFootX = -sinP * 10;
                    const rFootY = -rLift * 4 - rForward * 2;
                    J.rFoot.x  += rFootX;
                    J.rFoot.y  += rFootY;
                    J.rKnee.x  += rFootX * 0.55;
                    J.rKnee.y  += rFootY * 0.6;

                    // ---- 手臂摆动（与对侧腿同向，自然摆臂）----
                    const armSwing = 9;
                    J.lHand.x  -= sinP * armSwing;       // 左臂与左腿反相
                    J.lElbow.x -= sinP * armSwing * 0.65;
                    J.rHand.x  += sinP * armSwing;       // 右臂与左腿同相
                    J.rElbow.x += sinP * armSwing * 0.65;
                }

                // ---- 待机动画：呼吸（仅静止时）----
                if (!this.isMoving) {
                    const breath = Math.sin(Date.now() / 400) * 0.5;
                    J.head.y   += breath;
                    J.neck.y   += breath * 0.8;
                    J.shoulder.y += breath * 0.8;
                    J.lShldr.y += breath * 0.8;
                    J.rShldr.y += breath * 0.8;
                    J.hip.y    += breath * 0.3;
                    J.lHip.y   += breath * 0.3;
                    J.rHip.y   += breath * 0.3;
                }

                // ---- 绘制头部 ----
                ctx.beginPath(); ctx.arc(J.head.x, J.head.y, 7, 0, Math.PI * 2); ctx.fill();

                // ---- 绘制脊柱（neck → hip）----
                ctx.beginPath(); ctx.moveTo(J.neck.x, J.neck.y); ctx.lineTo(J.hip.x, J.hip.y); ctx.stroke();

                // ---- 绘制左臂（shoulder → elbow → hand）----
                ctx.beginPath(); ctx.moveTo(J.lShldr.x, J.lShldr.y);
                ctx.lineTo(J.lElbow.x, J.lElbow.y); ctx.lineTo(J.lHand.x, J.lHand.y); ctx.stroke();

                // ---- 绘制右臂 ----
                ctx.beginPath(); ctx.moveTo(J.rShldr.x, J.rShldr.y);
                ctx.lineTo(J.rElbow.x, J.rElbow.y); ctx.lineTo(J.rHand.x, J.rHand.y); ctx.stroke();

                // ---- 绘制左腿（hip → knee → foot）----
                ctx.beginPath(); ctx.moveTo(J.lHip.x, J.lHip.y);
                ctx.lineTo(J.lKnee.x, J.lKnee.y); ctx.lineTo(J.lFoot.x, J.lFoot.y); ctx.stroke();

                // ---- 绘制右腿 ----
                ctx.beginPath(); ctx.moveTo(J.rHip.x, J.rHip.y);
                ctx.lineTo(J.rKnee.x, J.rKnee.y); ctx.lineTo(J.rFoot.x, J.rFoot.y); ctx.stroke();

                // ---- 关节小圆点（手、脚）----
                ctx.fillStyle = color;
                [J.lHand, J.rHand, J.lFoot, J.rFoot].forEach(j => {
                    ctx.beginPath(); ctx.arc(j.x, j.y, 2, 0, Math.PI * 2); ctx.fill();
                });

                ctx.restore();
            }

            render(ctx) {
                const pos = Renderer.worldToScreen(this.x, this.y), x = pos.x, y = pos.y + (this.isDodging ? 0 : Math.sin(this.animTime) * 2);

                // ===== Phaser 渲染同步（在 ctx.save() 之前，避免 Canvas 状态不匹配）=====
                this._usePhaserSprite = false; // 默认 Canvas 渲染
                const phaserScene = window.__phaserScene;
                if (phaserScene && phaserScene.playerSprite) {
                    const sprite = phaserScene.playerSprite;
                    const spriteSize = this.size * 6.25; // 与原有 Canvas 渲染一致：112.5
                    // 只有在非 Velocity 模式下才设置位置
                    // Velocity 模式下位置由 Phaser 物理引擎控制，手动设置会覆盖物理引擎的计算
                    if (!phaserScene._useVelocityDrive) {
                        sprite.setPosition(this.x, this.y);
                    }
                    // 基于纹理原始尺寸计算缩放
                    const sourceImage = sprite.texture.getSourceImage();
                    const originalWidth = sourceImage ? sourceImage.width : 1440;
                    const scale = spriteSize / originalWidth;
                    sprite.setScale(scale);
                    if (this.isMoving) {
                        if (!sprite.anims.isPlaying || sprite.anims.currentAnim.key !== 'player_walk') {
                            sprite.play('player_walk', true);
                        }
                        sprite.setRotation(this.rotation - Math.PI / 2);
                    } else {
                        if (sprite.anims.isPlaying) sprite.anims.stop();
                        sprite.setTexture('walk_001');
                        // walk_001 原始面朝下，需 -Math.PI/2 修正到面朝右后再应用朝向
                        sprite.setRotation(this.rotation - Math.PI / 2);
                    }
                    // ===== 场景六地图模式：隐藏 Phaser 角色贴图 =====
                    const _dms = window.DungeonMapSystem || (typeof DungeonMapSystem !== 'undefined' ? DungeonMapSystem : null);
                    if (SceneManager.currentScene === 'scene6' && _dms && _dms.active && _dms.state === 'map') {
                        sprite.setVisible(false);
                        sprite.setActive(false);
                        if (phaserScene.weaponSprite) { phaserScene.weaponSprite.setVisible(false); phaserScene.weaponSprite.setActive(false); }
                        if (phaserScene.offhandWeaponSprite) { phaserScene.offhandWeaponSprite.setVisible(false); phaserScene.offhandWeaponSprite.setActive(false); }
                        this._usePhaserSprite = false;
                    } else if (this._stickFigure) {
                        // 火柴人模式：强制 Canvas 绘制，隐藏 Phaser 角色贴图
                        sprite.setVisible(false);
                        sprite.setActive(false);
                        this._usePhaserSprite = false;
                    } else {
                        sprite.setVisible(true);
                        this._usePhaserSprite = true; // 标记：Phaser 已渲染角色，Canvas 跳过角色贴图
                    }
                    // 同步武器到 Phaser Sprite
                    const weaponAnim = this._getWeaponAnimParams();
                    const offhandAnim = this._getOffhandWeaponAnimParams();
                    phaserScene.syncWeapon(this, weaponAnim);
                    phaserScene.syncOffhandWeapon(this, offhandAnim);
                    // 根据 Phaser 条件开关决定 Canvas 是否渲染武器
                    // phaserScene._useCanvasWeapon = true  → Canvas 渲染武器（Phaser 隐藏）
                    // phaserScene._useCanvasWeapon = false → Phaser 渲染武器（Canvas 隐藏）
                    const useCanvasWeapon = phaserScene._useCanvasWeapon === true;
                    this._usePhaserWeapon = !useCanvasWeapon;
                    // 不 return，继续让 Canvas 渲染武器、特效、箭头等
                } else {
                    this._usePhaserWeapon = false;
                }

                this.renderHealthBar(ctx, x, y); this.renderStaminaBar(ctx, x, y); ctx.save(); ctx.translate(x, y);
                if (this.isDodging) { const tilt = Math.atan2(this.dodgeDirection.y, this.dodgeDirection.x); ctx.rotate(tilt + Math.PI/2); }
                else if (this._dashResetAnim) {
                    const elapsed = Date.now() - this._dashResetAnim.startTime;
                    const t = Math.min(1, elapsed / this._dashResetAnim.duration);
                    const delta = this._shortestAngleDelta(this._dashResetAnim.startRotation, this._dashResetAnim.targetRotation);
                    ctx.rotate(this._dashResetAnim.startRotation + delta * easeOutQuart(t));
                }
                else if (this._specialResetAnim) {
                    const elapsed = Date.now() - this._specialResetAnim.startTime;
                    const t = Math.min(1, elapsed / this._specialResetAnim.duration);
                    const delta = this._shortestAngleDelta(this._specialResetAnim.startRotation, this._specialResetAnim.targetRotation);
                    ctx.rotate(this._specialResetAnim.startRotation + delta * easeOutQuart(t));
                }
                else if (this._runeSwordResetAnim) {
                    const elapsed = Date.now() - this._runeSwordResetAnim.startTime;
                    const t = Math.min(1, elapsed / this._runeSwordResetAnim.duration);
                    const delta = this._shortestAngleDelta(this._runeSwordResetAnim.startRotation, this._runeSwordResetAnim.targetRotation);
                    ctx.rotate(this._runeSwordResetAnim.startRotation + delta * easeOutQuart(t));
                }
                else ctx.rotate(this.rotation);
                // 调试坐标系（用于对比工具中的坐标系）
                this._drawDebugCoordinateSystem(ctx);
                const currentItem = this.equipments[this.weaponMode];
                let attackType = 'melee';
                if (currentItem) {
                    if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') attackType = 'pistol';
                    else if (currentItem.weaponType === 'pkm') attackType = 'pkm';
                    else if (currentItem.weaponType === 'akm') attackType = 'akm';
                    else if (currentItem.weaponType === 'qbz191') attackType = 'qbz191';
                    else if (currentItem.weaponType === 'bow') attackType = 'ranged';
                }
                const attack = this.attacks[attackType];
                if (this.isDodging) ctx.globalAlpha = 0.7;
                if (this._isDashing) {
                    // 冲刺攻击：角色发光 + 拖尾效果（蓝色圆圈已删除）
                    const dashProgress = this._dashTimer / 800;
                    const glowAlpha = dashProgress < 0.40 ? 0.6 : 0.6 * (1 - (dashProgress - 0.40) / 0.60);
                    // 冲刺方向指示器
                    ctx.save();
                    const dashAngle = Math.atan2(this._dashDirection.y, this._dashDirection.x);
                    ctx.rotate(dashAngle);
                    ctx.fillStyle = `rgba(74, 158, 255, ${glowAlpha * 0.5})`;
                    ctx.beginPath(); ctx.moveTo(this.size + 8, 0); ctx.lineTo(this.size - 4, -5); ctx.lineTo(this.size - 4, 5); ctx.closePath(); ctx.fill();
                    ctx.restore();
                }
                if (this._dashConvergeAuraActive) {
                    // 冲刺就绪金色光点：亮度闪烁
                    const flicker = 0.4 + Math.sin(Date.now() / 120) * 0.25;
                    ctx.fillStyle = `rgba(255, 230, 100, ${flicker * 0.35})`;
                    ctx.beginPath(); ctx.arc(0, 0, this.size + 7, 0, Math.PI * 2); ctx.fill();
                }
                // 中毒绿色粒子效果
                if (this._poisonStacks > 0 && this._poisonEffect) {
                    this._poisonEffect.render(ctx, 0, 0);
                }
                if (this._isWhirlwind) {
                    // 风车技能：人物和武器整体旋转（叠加在基础旋转之上）
                    // 前50ms不旋转（武器平移阶段），后750ms旋转4圈，使用easeOutQuad使速度逐步放慢
                    let spinAngle = 0;
                    if (this._whirlwindTimer > 50) {
                        const t = Math.min(1, (this._whirlwindTimer - 50) / (this._whirlwindDuration - 50));
                        spinAngle = easeOutQuad(t) * 4 * Math.PI * 2;
                    }
                    ctx.rotate(spinAngle);
                }
                // ===== 角色精灵图渲染 + 动画 =====
                let bodyScale = 1;
                let bodyOffsetX = 0;
                let bodyOffsetY = 0;

                // 火柴人绘制参数（新 _drawStickFigure 内部处理呼吸和行走动画）
                bodyScale = 1;
                bodyOffsetX = 0;
                bodyOffsetY = -12; // 上移12px，使火柴人中心与hitbox中心对齐

                // 剑类武器攻击：身体配合刺击动画
                // [STICK FIGURE] 火柴人模式下攻击时身体不动，只动武器
                // 攻击位移设为0，武器动画由 renderWeapon() 处理
                const isMeleeEquipped = currentItem && (currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword');
                const isMeleeAttacking = isMeleeEquipped && this.weaponAnim.state !== 'idle';
                if (isMeleeAttacking && !this._isWhirlwind && !this._isDashing && !this._specialAttackActive) {
                    // body 保持不动
                }

                // 绘制角色精灵图（替代火柴人）
                if (!this._usePhaserSprite) {
                    const isSpriteReady = this._runningSpriteSheet && this._runningSpriteSheet.complete && this._runningSpriteSheet.naturalWidth > 0;
                    const isIdleReady = this._idleSprite && this._idleSprite.complete && this._idleSprite.naturalWidth > 0;
                    if (isSpriteReady && isIdleReady) {
                        const drawSize = this.size * 4.5; // 约 72px
                        ctx.save();
                        // 反旋转回直立
                        ctx.rotate(-this.rotation);
                        // 根据朝向水平翻转
                        if (this._getFacingDirection() === 'left') {
                            ctx.scale(-1, 1);
                        }
                        // 受击闪白
                        if (this.hitFlash > 0) {
                            ctx.globalAlpha = 0.4 + Math.sin((this.hitFlash / this.hitFlashDuration) * Math.PI) * 0.6;
                        }

                        if (this.isMoving && !this.isDodging && !this._isDashing && !this._isWhirlwind && !this._specialAttackActive) {
                            if (this._isSprinting) {
                                // ===== 奔跑动画（running.png 16帧） =====
                                const FRAME_W = 512, FRAME_H = 512;
                                const COLS = 8;
                                const col = this._runningFrame % COLS;
                                const row = Math.floor(this._runningFrame / COLS);
                                const sx = col * FRAME_W;
                                const sy = row * FRAME_H;
                                ctx.drawImage(
                                    this._runningSpriteSheet,
                                    sx, sy, FRAME_W, FRAME_H,
                                    -drawSize / 2, -drawSize / 2,
                                    drawSize, drawSize
                                );
                            } else {
                                // ===== 行走动画（walk.png 21帧，3x8网格） =====
                                const WALK_W = 512, WALK_H = 516;
                                const WALK_COLS = 8;
                                const col = this._walkFrame % WALK_COLS;
                                const row = Math.floor(this._walkFrame / WALK_COLS);
                                const sx = col * WALK_W;
                                const sy = row * WALK_H;
                                ctx.drawImage(
                                    this._walkSpriteSheet,
                                    sx, sy, WALK_W, WALK_H,
                                    -drawSize / 2, -drawSize / 2,
                                    drawSize, drawSize
                                );
                            }
                        } else {
                            // ===== 待机动画：轻微抖动 =====
                            const t = Date.now();
                            // 呼吸感上下浮动 + 极轻微左右晃动
                            const breatheY = Math.sin(t / 400) * 1.2;
                            const swayX = Math.sin(t / 600) * 0.4;
                            const breatheScale = 1.0 + Math.sin(t / 500) * 0.015;
                            ctx.translate(swayX, breatheY);
                            ctx.scale(breatheScale, breatheScale);
                            const IDLE_W = 516, IDLE_H = 516;
                            ctx.drawImage(
                                this._idleSprite,
                                0, 0, IDLE_W, IDLE_H,
                                -drawSize / 2, -drawSize / 2,
                                drawSize, drawSize
                            );
                        }
                        ctx.restore();
                    } else {
                        // 精灵图未加载完成，回退到火柴人
                        this._drawStickFigure(ctx, bodyScale, bodyOffsetX, bodyOffsetY);
                    }
                }
                // ===== 边境长弓蓄力满闪光特效（人物） =====
                if (this._chargeFlashActive) {
                    const flashAlpha = Math.min(1, this._chargeFlashTimer / 500);
                    ctx.globalCompositeOperation = 'source-atop';
                    ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha * 0.7})`;
                    ctx.fillRect(-60, -60, 120, 120);
                    ctx.globalCompositeOperation = 'source-over';
                }
                // ===== 符文长剑特殊攻击：渲染悬浮的剑 =====
                if (this._runeSwordSpecialActive && this._runeSwordSwords.length > 0) {
                    const img = this._runeSwordBladeImg;
                    if (img && img.complete && img.naturalWidth > 0) {
                        const w = 84 * 0.6; // 剑缩小到60%
                        const s = 84 * 0.6;
                        this._runeSwordSwords.forEach(sword => {
                            if (!sword.active || sword.flyActive) return;
                            ctx.save();
                            // 摇摆效果：前后左右小幅摆动
                            const swayX = Math.sin(sword.swayTimer * sword.swayFreqX) * sword.swayAmpX;
                            const swayY = Math.cos(sword.swayTimer * sword.swayFreqY) * sword.swayAmpY;
                            // 后移对齐人物中心：s*0.3 + 额外50px
                            ctx.translate(-s * 0.3 - 50 + swayX, sword.offsetX + swayY);
                            // 每把剑独立朝向：从剑位置到鼠标位置
                            const sp = Renderer.worldToScreen(this.x, this.y);
                            let mouseLocalAngle = 0;
                            if (Input.mouse && typeof Input.mouse.x === 'number' && typeof Input.mouse.y === 'number' && sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
                                // 计算鼠标在局部坐标系中的角度
                                mouseLocalAngle = Math.atan2(Input.mouse.y - sp.y, Input.mouse.x - sp.x) - this.rotation;
                            }
                            // 从剑位置到鼠标位置的角度偏移（考虑剑的左右偏移）
                            const swordWorldX = this.x + sword.offsetX * (-Math.sin(this.rotation));
                            const swordWorldY = this.y + sword.offsetX * Math.cos(this.rotation);
                            const mouseWorld = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
                            const aimAngle = Math.atan2(mouseWorld.y - swordWorldY, mouseWorld.x - swordWorldX) - this.rotation;
                            ctx.rotate(aimAngle + Math.PI / 2);
                            ctx.translate(0, -s * 0.85);
                            ctx.globalAlpha = sword.fading ? Math.max(0, 1 - sword.fadeTimer / 300) : 1;
                            ctx.drawImage(img, -w / 2, -s / 2, w, s);
                            ctx.restore();
                        });
                    }
                }
                // ===== 冰锥技能：渲染悬浮的冰锥 =====
                if (this._iceSpikeActive && this._iceSpikeSpikes && this._iceSpikeSpikes.length > 0) {
                    const img = this._iceSpikeImg;
                    if (img && img.complete && img.naturalWidth > 0) {
                        const w = 40;
                        const h = 60;
                        this._iceSpikeSpikes.forEach(spike => {
                            if (!spike.active || spike.launched || spike.flyActive) return;
                            ctx.save();
                            // 摇摆效果
                            const swayX = Math.sin(spike.swayTimer * spike.swayFreqX) * spike.swayAmpX;
                            const swayY = Math.cos(spike.swayTimer * spike.swayFreqY) * spike.swayAmpY;
                            // 渲染在角色身后左右位置
                            ctx.translate(spike.offsetX + swayX, spike.offsetY + swayY);
                            // 朝向鼠标
                            const sp = Renderer.worldToScreen(this.x, this.y);
                            let mouseLocalAngle = 0;
                            if (Input.mouse && typeof Input.mouse.x === 'number' && typeof Input.mouse.y === 'number' && sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
                                mouseLocalAngle = Math.atan2(Input.mouse.y - sp.y, Input.mouse.x - sp.x) - this.rotation;
                            }
                            ctx.rotate(mouseLocalAngle + Math.PI / 2);
                            ctx.globalAlpha = 0.85;
                            ctx.drawImage(img, -w / 2, -h / 2, w, h);
                            ctx.restore();
                        });
                    }
                }
                // ===== 火球技能：渲染悬浮的火球 =====
                if (this._fireballActive && this._fireball && !this._fireball.launched) {
                    const img = this._fireballImg;
                    if (img && img.complete && img.naturalWidth > 0) {
                        const fb = this._fireball;
                        ctx.save();
                        // 摇摆效果
                        const swayX = Math.sin(fb.swayTimer * fb.swayFreqX) * fb.swayAmpX;
                        const swayY = Math.cos(fb.swayTimer * fb.swayFreqX) * fb.swayAmpX * 0.5;
                        // 渲染在角色身前
                        ctx.translate(fb.offsetX + swayX, fb.offsetY + swayY);
                        // 朝向鼠标
                        const sp = Renderer.worldToScreen(this.x, this.y);
                        let mouseLocalAngle = 0;
                        if (Input.mouse && typeof Input.mouse.x === 'number' && typeof Input.mouse.y === 'number' && sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
                            mouseLocalAngle = Math.atan2(Input.mouse.y - sp.y, Input.mouse.x - sp.x) - this.rotation;
                        }
                        ctx.rotate(mouseLocalAngle + Math.PI / 2);
                        ctx.globalAlpha = 0.9;
                        const size = 50 * fb.scale;
                        // 从 sprite sheet 中截取对应帧
                        const cols = 9, frameW = 480, frameH = 480;
                        const frameIndex = fb.frameIndex || 0;
                        const col = frameIndex % cols;
                        const row = Math.floor(frameIndex / cols);
                        const sx = col * frameW, sy = row * frameH;
                        ctx.drawImage(img, sx, sy, frameW, frameH, -size / 2, -size / 2, size, size);
                        ctx.restore();
                    }
                }
                // 闪避时：恢复旋转为 this.rotation，避免武器随身体倾斜而错位
                if (this.isDodging) {
                    const tilt = Math.atan2(this.dodgeDirection.y, this.dodgeDirection.x);
                    ctx.rotate(-(tilt + Math.PI/2) + this.rotation);
                }
                this.renderWeapon(ctx);
                // === 盾牌渲染（副手栏装备盾牌时）===
                const _offhandSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                const _offhandItem = this.equipments[_offhandSlot];
                if (_offhandItem && _offhandItem.weaponType === 'shield') {
                    ctx.save();
                    ctx.translate(20, -20); // 右上方（20, -20）
                    ctx.rotate(Math.PI / 2); // 顺时针旋转 90 度
                    const shieldImg = this.shieldImage;
                    const sw = this.size * 6.25 * 0.55;
                    const sh = this.size * 6.25 * 0.7;
                    if (this.shieldSystem && this.shieldSystem.defending) {
                        ctx.rotate(-0.3);
                    }
                    if (shieldImg && shieldImg.complete && shieldImg.naturalWidth > 0) {
                        ctx.drawImage(shieldImg, -sw / 2, -sh / 2, sw, sh);
                    } else {
                        ctx.fillStyle = '#8a6a3a';
                        ctx.beginPath();
                        ctx.ellipse(0, 0, sw * 0.4, sh * 0.5, 0, 0, Math.PI * 2);
                        ctx.fill();
                    }
                    ctx.restore();
                }
                // ===== 防御状态红光特效 =====
                if (this.shieldSystem && this.shieldSystem.defending) {
                    const flicker = 0.5 + Math.sin(Date.now() / 200) * 0.25; // 闪烁效果
                    ctx.fillStyle = `rgba(200, 60, 60, ${flicker * 0.35})`;
                    ctx.beginPath();
                    ctx.arc(0, 0, this.size + 8, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = `rgba(255, 80, 80, ${flicker * 0.6})`;
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(0, 0, this.size + 10, 0, Math.PI * 2);
                    ctx.stroke();
                }
                if (!this._usePhaserSprite) {
                    ctx.fillStyle = '#d4c5a9'; ctx.beginPath(); ctx.moveTo(this.size + 5, 0); ctx.lineTo(this.size - 1, -4); ctx.lineTo(this.size - 1, 4); ctx.closePath(); ctx.fill();
                    ctx.strokeStyle = 'rgba(122, 154, 106, 0.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, this.size + 5 + Math.sin(Date.now()/300)*1.5, 0, Math.PI*2); ctx.stroke();
                }
                ctx.restore();
                ctx.globalAlpha = 1;
                // 脚下阴影（紧贴脚底）
                if (!this._usePhaserSprite) {
                    ctx.fillStyle = 'rgba(0,0,0,0.25)';
                    ctx.beginPath();
                    const spriteDrawSize = this.size * 4.5;
                    ctx.ellipse(x, y + spriteDrawSize / 2, spriteDrawSize * 0.25, spriteDrawSize * 0.1, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
                // ===== 符文长剑特殊攻击：渲染飞行中的剑（世界坐标）=====
                if (this._runeSwordSpecialActive && this._runeSwordSwords.length > 0) {
                    const img = this._runeSwordBladeImg;
                    if (img && img.complete && img.naturalWidth > 0) {
                        const w = 84 * 0.6;
                        const s = 84 * 0.6;
                        this._runeSwordSwords.forEach(sword => {
                            if (!sword.flyActive) return;
                            const sp = Renderer.worldToScreen(sword.flyX, sword.flyY);
                            ctx.save();
                            ctx.translate(sp.x, sp.y);
                            ctx.rotate(sword.flyAngle + Math.PI / 2);
                            ctx.translate(0, -s * 0.85);
                            ctx.drawImage(img, -w / 2, -s / 2, w, s);
                            ctx.restore();
                        });
                    }
                }
                // ===== 冰锥技能：渲染飞行中的冰锥（世界坐标）=====
                if (this._iceSpikeSpikes && this._iceSpikeSpikes.some(s => s.flyActive)) {
                    const img = this._iceSpikeImg;
                    if (img && img.complete && img.naturalWidth > 0) {
                        const w = 40;
                        const h = 60;
                        this._iceSpikeSpikes.forEach(spike => {
                            if (!spike.flyActive) return;
                            const sp = Renderer.worldToScreen(spike.flyX, spike.flyY);
                            ctx.save();
                            ctx.translate(sp.x, sp.y);
                            ctx.rotate(spike.flyAngle + Math.PI / 2);
                            ctx.globalAlpha = 0.9;
                            ctx.drawImage(img, -w / 2, -h / 2, w, h);
                            ctx.restore();
                        });
                    }
                }
                // ===== 火球技能：渲染飞行中的火球（世界坐标）=====
                if (this._fireball && this._fireball.flyActive) {
                    const img = this._fireballImg;
                    if (img && img.complete && img.naturalWidth > 0) {
                        const fb = this._fireball;
                        const sp = Renderer.worldToScreen(fb.flyX, fb.flyY);
                        ctx.save();
                        ctx.translate(sp.x, sp.y);
                        ctx.rotate(fb.flyAngle + Math.PI / 2);
                        ctx.globalAlpha = 0.95;
                        const size = 50 * fb.scale;
                        // 从 sprite sheet 中截取对应帧
                        const cols = 9, frameW = 480, frameH = 480;
                        const frameIndex = fb.frameIndex || 0;
                        const col = frameIndex % cols;
                        const row = Math.floor(frameIndex / cols);
                        const sx = col * frameW, sy = row * frameH;
                        ctx.drawImage(img, sx, sy, frameW, frameH, -size / 2, -size / 2, size, size);
                        ctx.restore();
                    }
                }
                // ===== 无人机渲染 =====
                if (this.droneSystem && this.droneSystem.active) {
                    this.droneSystem.render(ctx);
                }
                ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.data.name, x, y - 55);
            }

            // ===== 眩晕效果系统 =====
            /**
             * 对玩家施加眩晕效果
             * @param {number} duration - 眩晕持续时间（毫秒）
             */
            applyStun(duration) {
                if (this._isDead) return; // 死亡状态不眩晕
                this.isStunned = true;
                this.stunTimer = duration;
                // 在状态栏显示眩晕效果
                if (StatusBar) {
                    if (this._stunEffectId) {
                        StatusBar.removeEffect(this._stunEffectId);
                    }
                    this._stunEffectId = StatusBar.addEffect('stun', duration);
                }
                // 显示眩晕浮动文字
                EffectManager.add(new FloatingTextEffect(this.x, this.y - 50, '💫 眩晕！', '#9a7a5a'));
            }

            /**
             * 子系统更新（眩晕期间仍然需要更新）
             * @param {number} dt - 时间增量（毫秒）
             * @param {Map} entities - 实体集合
             */
            _updateSubsystems(dt, entities) {
                // ===== 武器符文发光粒子更新（仅 weapon4） =====
                const _currentWep = this.equipments[this.weaponMode];
                if (_currentWep && _currentWep.weaponEffect === 'runeSword') {
                    const isAttacking = this.weaponAnim.state !== 'idle';
                    const isUsingSkill = this._isWhirlwind || this._isDashing || this._specialAttackActive || this._runeSwordSpecialActive;
                    this.weaponEffect.update({
                        dt,
                        size: WEAPON_ANIM.size,
                        rotation: this.rotation,
                        isMoving: this.isMoving,
                        isInCombat: isAttacking || isUsingSkill,
                        weaponAnimState: this.weaponAnim.state,
                        x: this.x,
                        y: this.y,
                        mouseX: Input.mouse.x,
                        mouseY: Input.mouse.y,
                        screenToWorld: Renderer.screenToWorld.bind(Renderer)
                    });
                } else {
                    this.weaponEffect.reset();
                }
                // ===== 冲刺攻击更新 =====
                if (this._isDashing) {
                    this.dashSystem.update(dt, entities);
                }
                // ===== 风车技能更新 =====
                if (this._isWhirlwind) {
                    this.whirlwindSystem.update(dt, entities);
                }
                // ===== 推击技能更新 =====
                if (this._isPushStrike) {
                    this.pushStrikeSystem.update(dt, entities);
                }
                // ===== 夜与火之剑特殊攻击更新 =====
                if (this._specialAttackActive) {
                    this.specialAttackSystem.update(dt, entities);
                }
                // 特殊攻击冷却（每个类型独立）
                for (const type in this._specialAttackCooldowns) {
                    if (this._specialAttackCooldowns[type] > 0) {
                        this._specialAttackCooldowns[type] -= dt;
                        if (this._specialAttackCooldowns[type] < 0) this._specialAttackCooldowns[type] = 0;
                    }
                }
                // ===== 符文长剑特殊攻击更新 =====
                if (this._runeSwordSpecialActive) {
                    this.runeSwordSystem.update(dt, entities);
                } else if (this._runeSwordSwords && this._runeSwordSwords.some(s => s.flyActive)) {
                    this.runeSwordSystem._updateFlyingBlades(dt, entities);
                }
                // ===== 冰锥技能更新 =====
                if (this._iceSpikeActive || (this._iceSpikeSpikes && this._iceSpikeSpikes.some(s => s.flyActive))) {
                    this.iceSpikeSystem.update(dt, entities);
                }
                // 冰锥技能冷却
                if (this._iceSpikeCooldown > 0) {
                    this._iceSpikeCooldown -= dt;
                    if (this._iceSpikeCooldown < 0) this._iceSpikeCooldown = 0;
                }
                // ===== 火球技能更新 =====
                if (this._fireballActive || (this._fireball && this._fireball.flyActive)) {
                    this.fireballSystem.update(dt, entities);
                }
                // 火球技能冷却
                if (this._fireballCooldown > 0) {
                    this._fireballCooldown -= dt;
                    if (this._fireballCooldown < 0) this._fireballCooldown = 0;
                }
                // ===== 无人机技能更新 =====
                if (this.droneSystem && this.droneSystem.active) {
                    this.droneSystem.update(dt, entities);
                }
                // 冲刺攻击复位动画更新
                if (this._dashResetAnim) {
                    const elapsed = Date.now() - this._dashResetAnim.startTime;
                    if (elapsed >= this._dashResetAnim.duration) {
                        this._dashResetAnim = null;
                    }
                }
                // 特殊攻击复位动画更新
                if (this._specialResetAnim) {
                    const elapsed = Date.now() - this._specialResetAnim.startTime;
                    if (elapsed >= this._specialResetAnim.duration) {
                        this._specialResetAnim = null;
                    }
                }
                // 符文长剑复位动画更新
                if (this._runeSwordResetAnim) {
                    const elapsed = Date.now() - this._runeSwordResetAnim.startTime;
                    if (elapsed >= this._runeSwordResetAnim.duration) {
                        this._runeSwordResetAnim = null;
                    }
                }
            }
        }

export { Player };
