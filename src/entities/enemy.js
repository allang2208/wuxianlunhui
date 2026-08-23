import { WEAPON_ANIM } from '../config/math-utils.js';

import { WallSystem } from '../world/wall-system.js';
import { Combatant } from './combatant.js';
import { ThrustAttack, RangedAttack } from '../combat/attack.js';
import { Player } from './player.js';
import { PoisonEffect } from '../effects/poison-effect.js';
import { EnemyFSM } from '../ai/enemy-fsm.js';
import { pickDefensePriorityTarget } from '../ai/defense-target-priority.js';
import aiConfigData from '../../data/ai-config.json';
import { getTributeMonsterMoveSlowMul } from '../config/tribute-effects.js';
import { COMBAT_CONFIG } from '../config/combat-config.js';
import { COMBAT_FORMULAS } from '../config/combat-formulas.js';
import { getMonsterExp, getMonsterExpDetail, getMonsterEffectiveLevel, getCurrentDungeonType } from '../config/exp-system.js';
import { Easing } from '../config/math-utils.js';
import { EffectManager } from '../effects/effect-manager.js';
import { loadImage } from '../utils/image-loader.js';
import { canMeleeShareSurface } from '../combat/melee-surface.js';
import { hasRangedLineOfSight } from '../combat/ranged-line-of-sight.js';
import { World125FogTideSystem } from '../world/world125-fog-tide-system.js';

        class Enemy extends Combatant {
            constructor(x, y, config = {}) {
                const defaults = COMBAT_CONFIG.enemyDefaults || {};
                const hp = config.hp ?? defaults.hp ?? 150;
                const maxHp = config.maxHp ?? defaults.maxHp ?? 150;
                const size = config.size ?? defaults.size ?? 14;
                const name = config.name ?? defaults.name ?? '测试敌人';
                super(x, y, { faction: 'enemy', hp, maxHp, size, collisionRadius: config.collisionRadius, name });
                // 基类击杀结算不能反向 import Enemy，否则会形成
                // DamageableEntity → Enemy → Combatant → DamageableEntity 的 TDZ 循环。
                this._isEnemyEntity = true;
                // 保存原始配置，供渲染/碰撞体系统读取
                this.config = config;
                // DamageableEntity 在 config 赋值前已重建 Collider，这里用完整配置再重建一次，
                // 使 radius/height 能取到 config.render.spriteSize / collisionRadius 等字段。
                this.rebuildCollider();
                this.id = config.id || this.name;
                // 统一使用配置中的 rank 作为唯一精英/普通判定来源
                this.rank = config.rank || 'normal';
                this.type = config.type || '普通';
                this.category = config.category || 'monster';
                const defaultSpeed = (defaults.speed ?? 45) * (defaults.speedMultiplier ?? 1);
                this.speed = config.speed ?? defaultSpeed;
                // 防止旧配置中 speed 写成 0.2 这类相对值导致完全不动；
                // 显式配置 0 表示站桩单位（如首领"集合体"），不再强制改 45
                if (this.speed > 0 && this.speed < 1) this.speed = 45;
                // 全局怪物移速倍率（2026-08-15：全部模式怪物普通移动 -25%）：
                // 只缩放 speed/maxSpeed/_baseSpeed 常规移动链路；冲锋/扑击等攻击位移
                // （_updateLunge 等）与击退不受影响；站桩单位（speed=0）天然排除。
                const globalSpeedMul = defaults.globalSpeedMultiplier ?? 1;
                if (globalSpeedMul !== 1 && this.speed > 0) {
                    this.speed = Math.round(this.speed * globalSpeedMul * 100) / 100;
                    // time-agent 等在运行时回读 this.config.speed 的怪类也要拿到缩放值；
                    // 浅拷贝避免污染共享 enemyConfigData 单例
                    if (typeof config.speed === 'number' && config.speed > 0) {
                        config = { ...config, speed: this.speed };
                        this.config = config;
                    }
                }
                this.maxSpeed = this.speed;
                this._rangedDamageReduction = config.rangedDamageReduction ?? 0;
                this.accel = config.accel ?? defaults.accel ?? 0.7;
                this.friction = config.friction ?? defaults.friction ?? 0.82;
                // 保存原始属性，供 FSM 阶段切换时计算倍率
                this._baseSpeed = this.maxSpeed;
                this.animTime = 0; this.isMoving = false; this.rotation = 0;
                // 第一阶段只让直接使用 Enemy 的基础测试怪与显式 opt-in 的子类接入。
                // 历史 Boss/自定义状态机必须逐类审阅后再开启，避免把技能型范围伤害
                // 悄然迁移成基础普攻。
                this._usesDirectedBasicMelee = new.target === Enemy
                    || config.basicMeleeResolver === true;
                // 使用 COMBAT_CONFIG.thrustAttack.enemy 默认配置，config.attack 可覆盖
                const thrustCfg = COMBAT_CONFIG.thrustAttack?.enemy || {};
                const attackConfig = config.attack || {};
                if (attackConfig.type === 'ranged') {
                    // 远程/毒液僵尸：创建 RangedAttack
                    this.attacks = { ranged: new RangedAttack({
                        cooldown: attackConfig.cooldown ?? 1500,
                        projectileSpeed: attackConfig.projectileSpeed ?? 8,
                        projectileRange: attackConfig.range ?? attackConfig.projectileRange ?? 350,
                        projectileSize: attackConfig.width ?? 18,
                        damage: attackConfig.damage || (attackConfig.damageMin !== undefined && attackConfig.damageMax !== undefined ? { min: attackConfig.damageMin, max: attackConfig.damageMax } : { min: 15, max: 15 }),
                        knockback: attackConfig.knockback ?? 0,
                        damageType: attackConfig.damageType || 'physical',
                        isSpit: attackConfig.isSpit ?? (this.name === '毒液僵尸'),
                        ...attackConfig
                    }) };
                    this.weaponMode = 'ranged';
                    this.equippedRangedType = attackConfig.rangedType || 'spit';
                } else {
                    this.attacks = { melee: new ThrustAttack({
                        cooldown: attackConfig.cooldown ?? thrustCfg.cooldown ?? 600,
                        range: attackConfig.range ?? thrustCfg.range ?? 80,
                        width: attackConfig.width ?? thrustCfg.width ?? 20,
                        damage: attackConfig.damage || (attackConfig.damageMin !== undefined && attackConfig.damageMax !== undefined ? { min: attackConfig.damageMin, max: attackConfig.damageMax } : (thrustCfg.damage || { min: 8, max: 15 })),
                        knockback: attackConfig.knockback ?? thrustCfg.knockback ?? 15,
                        dynamicRange: attackConfig.dynamicRange !== undefined ? attackConfig.dynamicRange : (attackConfig.range ?? thrustCfg.range ?? 80),
                        ...attackConfig
                    }) };
                    this.weaponMode = 'melee';
                }
                this.level = config.level ?? defaults.level ?? 1;
                // 新增：6维基础属性（合并到 Combatant 已创建的 this.data）
                const statDefaults = defaults.stats || {};
                Object.assign(this.data, {
                    str: config.str ?? statDefaults.str ?? 10,
                    dex: config.dex ?? statDefaults.dex ?? 10,
                    int: config.int ?? statDefaults.int ?? 10,
                    con: config.con ?? statDefaults.con ?? 10,
                    wis: config.wis ?? statDefaults.wis ?? 10,
                    luck: config.luck ?? statDefaults.luck ?? 10,
                    stamina: config.stamina ?? defaults.stamina ?? 9999,
                    maxStamina: config.maxStamina ?? defaults.maxStamina ?? 9999,
                    kills: 0
                });
                // 记录配置中的显式 HP，避免被六维公式覆盖
                const explicitHp = config.hp;
                const explicitMaxHp = config.maxHp;
                // 记录配置中的显式战斗属性（atk/matk/mdef），避免被六维公式覆盖。
                // 注：不含 def——现有 3 条配置的 def 字段一直未生效（公式驱动），
                // 激活会改变现有怪物平衡，如需显式 def 请先评估旧值。
                const explicitStats = {};
                for (const k of ['atk', 'matk', 'mdef']) {
                    if (config[k] !== undefined) explicitStats[k] = config[k];
                }
                this.calculateCombatStats();
                if (explicitHp !== undefined) {
                    this.hp = explicitHp;
                    this.data.hp = explicitHp;
                }
                if (explicitMaxHp !== undefined) {
                    this.maxHp = explicitMaxHp;
                    this.data.maxHp = explicitMaxHp;
                }
                // 显式战斗属性覆盖六维公式结果（如首领 matk:0、mdef 与巫师对齐）
                for (const [k, v] of Object.entries(explicitStats)) {
                    this.data[k] = v;
                }
                // ===== 地牢锚定属性成长（2026-07-28 二期：成长直改派生属性，六维原值保留）=====
                // ΔL = 有效等级（锚定+祭品加持）− 配置等级；系数读 combat-formulas monsterGrowth
                const _growth = COMBAT_FORMULAS.enemy?.monsterGrowth || {};
                const _deltaL = getMonsterEffectiveLevel(this, getCurrentDungeonType()) - (this.data.level ?? 3);
                if (_deltaL > 0) {
                    const _hpCoef = this.rank === 'boss' ? (_growth.hpPerLevelBoss ?? 0.05) : (_growth.hpPerLevel ?? 0.10);
                    const _atkCoef = _growth.atkPerLevel ?? 0.08;
                    const _defCoef = _growth.defPerLevel ?? 0.04;
                    const _hpMul = 1 + _hpCoef * _deltaL;
                    this.hp = Math.round(this.hp * _hpMul);
                    this.maxHp = Math.round(this.maxHp * _hpMul);
                    this.data.hp = this.hp;
                    this.data.maxHp = this.maxHp;
                    if (this.data.atk) this.data.atk = Math.round(this.data.atk * (1 + _atkCoef * _deltaL));
                    if (this.data.matk) this.data.matk = Math.round(this.data.matk * (1 + _atkCoef * _deltaL));
                    if (this.data.def) this.data.def = Math.round(this.data.def * (1 + _defCoef * _deltaL));
                    if (this.data.mdef) this.data.mdef = Math.round(this.data.mdef * (1 + _defCoef * _deltaL));
                }
                this.weaponImage = loadImage('assets/weapons/1-rusty_sword_euip.png');
                this.weaponAnim = { state: 'idle', timer: 0, angle: WEAPON_ANIM.idleAngle };
                this.aiTimer = 0;
                this.aiInterval = config.aiInterval ?? defaults.aiInterval ?? 300;
                this.target = null;
                this.attackRange = config.attackRange || config.dashDistance || defaults.attackRange || 70;
                // 纯距离攻击判定（CombatSystem 优先读取；undefined 时回退 attackRange * 1.15）
                this.attackDistance = config.attackDistance;
                // 保存原始 AI 属性，供 FSM 阶段切换时计算倍率
                this._baseAiInterval = this.aiInterval;
                this._baseAttackRange = this.attackRange;
                this._dashStunned = false; // 冲刺攻击眩晕状态
                this._dashStunTimer = 0; // 眩晕剩余时间
                // ===== 攻击预警（精英及以上：攻击前红色轮廓，配置 data/combat-config.json attackTelegraph）=====
                this._attackTelegraphTimer = 0;   // >0 表示预警进行中
                this._attackTelegraphFire = null; // 预警结束后真正执行的攻击函数
                this._telegraphGlow = null;       // 无滤镜红色轮廓替身（避免每怪独立 filter camera）
                this._telegraphGlowSprite = null; // 替身对应的本体精灵
                this._showWeapon = config.showWeapon !== false; // 是否显示武器
                this._color = config.color || '#8a4a4a'; // 怪物颜色
                this._headColor = config.headColor || config.color || '#8a4a4a'; // 头部颜色（默认与身体同色）
                this._highlightColor = config.highlightColor || 'rgba(180, 100, 100, 0.3)'; // 高光颜色
                this._useStickFigure = true; // 火柴人模式：禁用 Phaser 精灵图，使用 Canvas 绘制
                this._alertRange = config._alertRange || config.alertRange || 0; // 索敌范围：0 表示未设置，使用 PerceptionSystem 默认值
                this._stuckTimer = 0; // 卡住计时器
                this._lastX = x; this._lastY = y; // 上次位置（用于检测卡住）
                // [ENHANCE] 智能路径管理器（参考《环世界》）：预规划 + 定期有效性检查 + 局部修复
                this._pathManager = null; // 由 MovementSystem 懒加载创建
                // ===== 状态效果：中毒粒子效果（Enemy 特有，Combatant 基类未包含）=====
                this._poisonEffect = new PoisonEffect(); // 中毒绿色粒子效果

                // ===== 通用 AI 状态机（pacing/chasing）默认值 =====
                this._aiState = 'pacing';
                this._pacingTimer = 0;
                this._pacingInterval = 1000 + Math.random() * 1000;
                this._lostTimer = 0;
                this._pacingTarget = { x: x, y: y };
                this._pacingOrigin = { x: x, y: y };
                this._dashAngle = 0;
                this._dashDistance = 0;
                this._dashStartFacing = null;
                this._attackTimer = 0;
                this._animFrame = 0;
                this._animTimer = 0;
                this._attackDashOffset = 0;
                this._dashBlocked = false;
                // ===== 配置驱动的线性突进（attack.lungeDistance > 0 时启用）=====
                this._lungeActive = false;
                this._lungeDistance = 0;
                this._lungeApplied = 0;
                this._lungeAngle = 0;
                // AI 配置读取（子类可通过 config.ai 注入；默认 0 表示不启用 pacing AI）
                const pacingAiConfig = config.ai || {};
                this.ai = config.ai || {}; // 供 MovementSystem 等外部系统读取 ai 标志（如 chargeStraight）
                // footprint 判定圆心偏移（配置 render.colliderOffsetY/X，配合贴图身体上移；
                // 统一在基类读取——此前仅集合体自己读取，手脑/骑士配置后未生效）
                this.colliderOffsetY = (this.config?.render?.colliderOffsetY) ?? 0;
                this.colliderOffsetX = (this.config?.render?.colliderOffsetX) ?? 0;
                this._aggroRange = pacingAiConfig.aggroRange || 0;
                this._pacingRange = pacingAiConfig.pacingRange || 0;
                this._loseTimeout = pacingAiConfig.loseTimeout || 2000;
                this._pacingIntervalMin = pacingAiConfig.pacingIntervalMin || 1000;
                this._pacingIntervalMax = pacingAiConfig.pacingIntervalMax || 2000;
                // 未显式设置警戒范围时，使用 AI 仇恨范围，避免 PerceptionSystem 用默认 400 覆盖 aggroRange
                if (!this._alertRange && this._aggroRange) {
                    this._alertRange = this._aggroRange;
                }
                // 绕圈/风筝 AI：配置 circleRadius 后在目标周围保持距离移动
                if (pacingAiConfig.circleRadius) {
                    this._circleRadius = pacingAiConfig.circleRadius;
                    this._circleDir = Math.random() > 0.5 ? 1 : -1;
                }
                this._aiScanTimer = 0;
                this._aiScanInterval = 200;
                this._lastKnownTargetPos = null;
                this._usePacingAI = config.usePacingAI === true;

                // ===== FSM 阶段系统 =====
                this._fsm = null;      // FSM 实例
                this._phaseSkills = null; // 阶段技能集合
                // 加载 AI 配置：优先使用子类传入的 config.aiConfig，否则从 JSON 按 id/name 匹配
                const aiConfig = config.aiConfig || aiConfigData[this.id] || aiConfigData[this.name] || null;
                if (aiConfig) {
                    this._fsm = new EnemyFSM(aiConfig);
                }

                // 自动包装子类 render 方法，在渲染后添加中毒粒子效果
            }
            triggerWeaponAnim() {
                // 动画打断机制：无论当前动画状态，立即重置为 windup
                this.weaponAnim.state = 'windup';
                this.weaponAnim.timer = 0;
                if (this._usePacingAI) {
                    this._prepareDashAttack(this.target);
                }
                // 配置驱动的线性突进：attack.lungeDistance > 0 时，
                // 在攻击动画持续期间向锁定方向匀速位移（见 _updateLunge）
                const lungeDistance = this.config?.attack?.lungeDistance ?? 0;
                if (lungeDistance > 0) {
                    this._lungeActive = true;
                    this._lungeDistance = lungeDistance;
                    this._lungeApplied = 0;
                    if (this.target && this.target.active) {
                        this._lungeAngle = Math.atan2(this.target.y - this.y, this.target.x - this.x);
                    } else {
                        this._lungeAngle = this.rotation ?? 0;
                    }
                }
            }
            updateWeaponAnim(dt) {
                const wa = WEAPON_ANIM, anim = this.weaponAnim;
                switch (anim.state) {
                    case 'idle': anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06; break;
                    case 'windup':
                        anim.timer += dt;
                        if (anim.timer >= wa.windupMs) { anim.state = 'swing'; anim.timer = 0; }
                        else anim.angle = wa.idleAngle + (wa.windupAngle - wa.idleAngle) * Easing.easeInQuad(anim.timer / wa.windupMs);
                        break;
                    case 'swing':
                        anim.timer += dt;
                        if (this._pendingThrust && this._pendingThrust.active) {
                            // 与主 CombatSystem 同口径：有效期由 ThrustAttack.hitDurationMs
                            // 单点管理，避免前摇后只剩十余毫秒的帧率敏感命中窗口。
                            this.attacks.melee.checkTriangleHit(this);
                        }
                        if (anim.timer >= wa.swingMs) {
                            anim.state = 'recover';
                            anim.timer = 0;
                            if (this._pendingThrust) {
                                this._pendingThrust.active = false;
                                this.attacks.melee.giveExp(this);
                            }
                        }
                        else anim.angle = wa.windupAngle + (wa.swingAngle - wa.windupAngle) * Easing.easeOutQuad(anim.timer / wa.swingMs);
                        break;
                    case 'recover':
                        anim.timer += dt;
                        if (anim.timer >= wa.recoverMs) { anim.state = 'idle'; anim.timer = 0; }
                        else anim.angle = wa.swingAngle + (wa.idleAngle - wa.swingAngle) * Easing.easeInOutCubic(anim.timer / wa.recoverMs);
                        break;
                }
            }
            // --- 冲刺偏移计算（默认实现，子类可覆盖） ---
            _getDashOffset() {
                if (this._attackDashOffset <= 0) return { x: 0, y: 0 };
                if (this._dashAngle !== undefined) {
                    return {
                        x: Math.cos(this._dashAngle) * this._attackDashOffset,
                        y: Math.sin(this._dashAngle) * this._attackDashOffset
                    };
                }
                switch (this._dashStartFacing || this._facing) {
                    case 'right': return { x: this._attackDashOffset, y: 0 };
                    case 'left':  return { x: -this._attackDashOffset, y: 0 };
                    case 'down':  return { x: 0, y: this._attackDashOffset };
                    case 'up':    return { x: 0, y: -this._attackDashOffset };
                    default:      return { x: 0, y: 0 };
                }
            }
            // --- 配置驱动的线性突进（attack.lungeDistance > 0 时启用） ---
            // 攻击动画持续期间（_attackTimer）按线性进度匀速位移；
            // 增量式应用，不覆盖击退/分离等外部位移；每帧 WallSystem.resolve 撞墙校验。
            _updateLunge() {
                if (!this._lungeActive) return;
                if (this._attackTimer <= 0 || this._attackDuration <= 0) {
                    this._lungeActive = false;
                    return;
                }
                const progress = Math.min(1, Math.max(0, 1 - (this._attackTimer / this._attackDuration)));
                const targetOffset = this._lungeDistance * progress;
                const delta = targetOffset - this._lungeApplied;
                if (delta <= 0) return;
                const nx = this.x + Math.cos(this._lungeAngle) * delta;
                const ny = this.y + Math.sin(this._lungeAngle) * delta;
                if (WallSystem && WallSystem.resolve) {
                    const resolved = WallSystem.resolve(this.x, this.y, nx, ny, this.groundRadius);
                    this._lungeApplied += Math.hypot(resolved.x - this.x, resolved.y - this.y);
                    this.x = resolved.x;
                    this.y = resolved.y;
                } else {
                    this.x = nx;
                    this.y = ny;
                    this._lungeApplied = targetOffset;
                }
            }
            // --- 查找最近玩家 ---
            _findNearestPlayer(entities) {
                let nearestPlayer = null;
                let nearestDist = Infinity;
                // A 移动（2026-08-15）：防守怪最终目标仍是建筑；沿途交战半径内的
                // 玩家/侍从优先锁定，建筑作任意距离兜底（无交战目标时继续推进基地）。
                // 注意模式闸门是 _preferDefenseTargets 而非交战半径——半径未配置时
                // 保持旧行为（只锁建筑），避免防守怪转追玩家。
                const defenseMode = !!this._preferDefenseTargets;
                const arr = entities && entities.values ? Array.from(entities.values()) : entities;
                if (!arr) return { entity: null, distance: Infinity };
                if (defenseMode) {
                    const pick = pickDefensePriorityTarget(this, arr);
                    return pick
                        ? { entity: pick.target, distance: pick.distance }
                        : { entity: null, distance: Infinity };
                }
                for (const e of arr) {
                    if (e && e._faction === 'player' && e.active) {
                        const dx = e.x - this.x;
                        const dy = e.y - this.y;
                        const d = Math.sqrt(dx * dx + dy * dy);
                        if (d < nearestDist) {
                            nearestDist = d;
                            nearestPlayer = e;
                        }
                    }
                }
                return { entity: nearestPlayer, distance: nearestDist };
            }
            // ===== AI 状态机：扫描与状态切换 =====
            _updateAIState(dt, entities) {
                const { entity: nearestPlayer, distance: nearestDist } = this._findNearestPlayer(entities);
                switch (this._aiState) {
                    case 'pacing':
                        if (nearestPlayer && nearestDist <= this._aggroRange) {
                            this._aiState = 'chasing';
                            this.target = nearestPlayer;
                            this._lostTimer = 0;
                            this._lastKnownTargetPos = { x: nearestPlayer.x, y: nearestPlayer.y };
                            // 清除踱步战术目标，让 MovementSystem 跟随 target
                            this._tacticalTarget = null;
                        }
                        break;
                    case 'chasing':
                        if (nearestPlayer && nearestDist <= this._aggroRange) {
                            // 目标仍在范围内，更新目标
                            this.target = nearestPlayer;
                            this._lastKnownTargetPos = { x: nearestPlayer.x, y: nearestPlayer.y };
                            this._lostTimer = 0;
                        } else {
                            // 目标跑出范围，开始丢失计时
                            this._lostTimer += this._aiScanInterval;
                            if (this._lostTimer >= this._loseTimeout) {
                                // 持续 loseTimeout 超出范围，放弃追击，回踱步
                                this._aiState = 'pacing';
                                this.target = null;
                                this._lastKnownTargetPos = null;
                                this._pacingOrigin = { x: this.x, y: this.y };
                                this._lostTimer = 0;
                                this._pacingTimer = 0;
                                if (typeof this._resetPacingInterval === 'function') {
                                    this._resetPacingInterval();
                                } else {
                                    this._pacingInterval = this._pacingIntervalMin + Math.random() * (this._pacingIntervalMax - this._pacingIntervalMin);
                                }
                            }
                        }
                        break;
                }
            }
            // ===== AI 执行：设置目标与速度 =====
            _executeAI(dt, _entities) {
                switch (this._aiState) {
                    case 'pacing': {
                        // 踱步速度 = 正常 1/2
                        this.maxSpeed = this._baseSpeed * 0.5;
                        // 更新踱步目标
                        this._pacingTimer += dt;
                        if (this._pacingTimer >= this._pacingInterval) {
                            this._pacingTimer = 0;
                            if (typeof this._resetPacingInterval === 'function') {
                                this._resetPacingInterval();
                            } else {
                                this._pacingInterval = this._pacingIntervalMin + Math.random() * (this._pacingIntervalMax - this._pacingIntervalMin);
                            }
                            const angle = Math.random() * Math.PI * 2;
                            const dist = Math.random() * this._pacingRange;
                            this._pacingTarget = {
                                x: this._pacingOrigin.x + Math.cos(angle) * dist,
                                y: this._pacingOrigin.y + Math.sin(angle) * dist
                            };
                        }
                        // 设置战术目标，让 MovementSystem 读取
                        this._tacticalTarget = this._pacingTarget;
                        // 清除追击相关状态
                        this.target = null;
                        this._lastKnownTargetPos = null;
                        break;
                    }
                    case 'chasing': {
                        // 正常奔跑速度
                        this.maxSpeed = this._baseSpeed;
                        // 清除战术目标，让 MovementSystem 读取 this.target
                        this._tacticalTarget = null;
                        break;
                    }
                }
            }
            _facingToAngle(facing) {
                switch (facing) {
                    case 'right': return 0;
                    case 'left':  return Math.PI;
                    case 'down':  return Math.PI / 2;
                    case 'up':    return -Math.PI / 2;
                    default:      return 0;
                }
            }
            _getDashWorldPos() {
                const offset = this._getDashOffset();
                return { x: this.x + offset.x, y: this.y + offset.y };
            }            // --- 碰撞半径渲染（含冲刺偏移） ---
            _prepareDashAttack(target) {
                if (this._attackTimer > 0) return;
                this._attackTimer = this._attackDuration;
                this._animFrame = 0;
                this._animTimer = 0;
                this._attackDashOffset = 0;
                // 精确朝向目标冲刺
                if (target && target.active) {
                    const targetX = target.x;
                    const targetY = target.y;
                    this._dashAngle = Math.atan2(targetY - this.y, targetX - this.x);
                    // 冲刺距离 = 到目标距离（精确到目标位置）
                    this._dashDistance = Math.sqrt((targetX - this.x)**2 + (targetY - this.y)**2);
                    // 更新面向以匹配冲刺角度
                    const absCos = Math.abs(Math.cos(this._dashAngle));
                    const absSin = Math.abs(Math.sin(this._dashAngle));
                    if (absSin > absCos) {
                        this._dashStartFacing = Math.sin(this._dashAngle) > 0 ? 'down' : 'up';
                    } else {
                        this._dashStartFacing = Math.cos(this._dashAngle) > 0 ? 'right' : 'left';
                    }
                    this._facing = this._dashStartFacing;
                    this._facingDir = this._dashStartFacing;
                } else {
                    // 无目标：fallback 到当前面向
                    this._dashAngle = this._facingToAngle(this._facing);
                }
                // 预判：检查冲刺路线是否通畅，如果被墙阻挡则原地攻击
                const dx = Math.cos(this._dashAngle) * this._dashDistance;
                const dy = Math.sin(this._dashAngle) * this._dashDistance;
                if (WallSystem && WallSystem.blocked) {
                    this._dashBlocked = WallSystem.blocked(this.x, this.y, this.x + dx, this.y + dy);
                } else {
                    this._dashBlocked = false;
                }
            }
            // === AI 系统：移动寻路 与 攻击指令 完全分离 ===
            // 阶段切换回调：子类可覆盖以实现自定义特效
            onPhaseChange(_phase) {
                // 默认空实现，子类可覆盖以实现自定义阶段特效
            }

            // ===== 攻击预警系统（精英及以上：攻击前显示红色轮廓，跟随怪物移动）=====
            // 配置：data/combat-config.json → attackTelegraph（enabled/durationMs/ranks/color 等）
            _getAttackTelegraphConfig() {
                const cfg = (COMBAT_CONFIG && COMBAT_CONFIG.attackTelegraph) || {};
                return {
                    enabled: cfg.enabled !== false,
                    durationMs: cfg.durationMs ?? 500,
                    ranks: cfg.ranks || ['elite', 'lord', 'boss'],
                    color: cfg.color ?? 0xff2222,
                    outerStrength: cfg.outerStrength ?? 6,
                    innerStrength: cfg.innerStrength ?? 0,
                    quality: cfg.quality ?? 8,
                    distance: cfg.distance ?? 12,
                };
            }

            _isAttackTelegraphEligible() {
                const cfg = this._getAttackTelegraphConfig();
                return cfg.enabled && cfg.ranks.includes(this.rank);
            }

            /**
             * 攻击决策统一入口：精英及以上先进入预警（红色轮廓 durationMs），
             * 计时结束后才真正执行 fireFn；普通/次级立即执行。
             * 预警进行中重复调用直接忽略（怪物已锁定本次出手）。
             */
            _tryAttackTelegraph(fireFn) {
                if (!this._isAttackTelegraphEligible()) { fireFn(); return; }
                if (this._attackTelegraphTimer > 0) return;
                this._attackTelegraphTimer = this._getAttackTelegraphConfig().durationMs;
                this._attackTelegraphFire = fireFn;
                this._setAttackTelegraphFx(true);
            }

            /** 预警计时推进（基类 update 每帧调用）：死亡/眩晕立即取消，计时归零后执行攻击 */
            _updateAttackTelegraph(dt) {
                if (!(this._attackTelegraphTimer > 0)) return;
                if (this._isDead || !this.active || (this.hasStatusEffect && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen')))) {
                    this._clearAttackTelegraph();
                    return;
                }
                // 精灵被重建时重挂预警替身（动画贴图切换不重建精灵，但生成/场景切换会）
                this._setAttackTelegraphFx(true);
                this._attackTelegraphTimer -= dt;
                if (this._attackTelegraphTimer > 0) return;
                const fire = this._attackTelegraphFire;
                this._clearAttackTelegraph();
                if (fire) fire();
            }

            _clearAttackTelegraph() {
                this._attackTelegraphTimer = 0;
                this._attackTelegraphFire = null;
                this._setAttackTelegraphFx(false);
            }

            /** 红色预警替身：普通贴图绘制，不为每只精英创建独立滤镜相机/离屏缓冲。 */
            _setAttackTelegraphFx(on) {
                const sprite = this._phaserSprite;
                if (on) {
                    if (!sprite || !sprite.active) return;
                    const cfg = this._getAttackTelegraphConfig();
                    if (!this._telegraphGlow || this._telegraphGlowSprite !== sprite) {
                        this._removeTelegraphGlow();
                        const scene = sprite.scene;
                        if (!scene?.add?.image || !sprite.texture?.key) return;
                        const frame = sprite.frame?.name ?? sprite.frame?.index;
                        this._telegraphGlow = scene.add.image(sprite.x, sprite.y, sprite.texture.key, frame);
                        this._telegraphGlow.setOrigin(sprite.originX, sprite.originY);
                        this._telegraphGlow.setTint(cfg.color);
                        this._telegraphGlow.setBlendMode?.('ADD');
                        this._telegraphGlowSprite = sprite;
                        sprite.once?.('destroy', () => {
                            if (this._telegraphGlowSprite === sprite) this._removeTelegraphGlow();
                        });
                    }
                    const overlay = this._telegraphGlow;
                    const frame = sprite.frame?.name ?? sprite.frame?.index;
                    if (overlay.texture?.key !== sprite.texture?.key) overlay.setTexture(sprite.texture.key, frame);
                    else if (frame != null && overlay.frame?.name !== frame) overlay.setFrame(frame);
                    const pulse = 1.04 + Math.sin(this._attackTelegraphTimer * 0.025) * 0.02;
                    overlay.setPosition(sprite.x, sprite.y);
                    overlay.setScale(sprite.scaleX * pulse, sprite.scaleY * pulse);
                    overlay.setRotation(sprite.rotation);
                    overlay.setFlip(sprite.flipX, sprite.flipY);
                    overlay.setAlpha(0.2 + Math.sin(this._attackTelegraphTimer * 0.018) * 0.08);
                    overlay.setDepth(sprite.depth - 0.01);
                    overlay.setVisible(sprite.visible);
                } else {
                    this._removeTelegraphGlow();
                }
            }

            _removeTelegraphGlow() {
                this._telegraphGlow?.destroy?.();
                this._telegraphGlow = null;
                this._telegraphGlowSprite = null;
            }

            /**
             * 攻击频率专用时钟：只缩短攻击/技能冷却，不改动作动画、前摇、投射物或死亡计时。
             * 自管攻击的僵尸子类统一通过此入口推进冷却，避免只覆盖 CombatSystem 普攻。
             */
            getAttackIntervalDelta(dt) {
                const delta = Math.max(0, Number(dt) || 0);
                return delta * World125FogTideSystem.getZombieAttackTimeScale(this);
            }

            update(dt, entities) {
                super.update(dt);
                // FSM 阶段切换更新（始终执行，不因眩晕或目标丢失而跳过）
                if (this._fsm) {
                    this._fsm.update(dt, this, entities);
                }
                // 攻击预警计时（眩晕/死亡时内部自行取消，必须每帧执行）
                this._updateAttackTelegraph(dt);
                // 冲刺攻击眩晕计时
                if (this._dashStunned) {
                    this._dashStunTimer -= dt;
                    if (this._dashStunTimer <= 0) {
                        this._dashStunned = false;
                    }
                }
                // 眩晕/冻结状态（通过状态栏系统检测）：无法移动、无法攻击（冻结效果等同于眩晕）
                if (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen')) {
                    this.vx = 0; this.vy = 0;
                    this.isMoving = false;
                    return;
                }

                // 恐惧状态：技能/攻击决策中断（移动由 MovementSystem 恐惧分支接管，朝反方向逃跑）
                if (this.hasStatusEffect('fear')) {
                    return;
                }

                // 配置驱动的线性突进（attack.lungeDistance > 0，攻击动画期间匀速位移）
                this._updateLunge();

                // 通用 pacing/chasing AI（狼类等启用 usePacingAI 的子类）
                if (this._usePacingAI) {
                    if (this._defenseMonster) {
                        // 防守怪目标唯一由 PerceptionSystem 管理；禁止狼类 pacing AI 每200ms
                        // 再把实体表转数组并执行第二套全量选目标。这里只保留追击运动姿态。
                        this._aiState = 'chasing';
                        this.maxSpeed = this._baseSpeed;
                        this._tacticalTarget = null;
                    } else {
                        this._aiScanTimer += dt;
                        if (this._aiScanTimer >= this._aiScanInterval) {
                            this._aiScanTimer = 0;
                            this._updateAIState(dt, entities);
                        }
                        this._executeAI(dt, entities);
                    }
                }

                // [REFACTOR] 外部系统驱动：如果 game.js 已调用 MovementSystem/CombatSystem/PerceptionSystem，
                // 则 enemy.js 不再重复处理移动/攻击/目标选择，避免每帧重复调用。
                // 如果没有外部系统（fallback），使用旧逻辑。
                if (typeof window !== 'undefined' && (!window.MovementSystem || !window.CombatSystem)) {
                    // 1. 寻找目标（pacing AI 子类已自行管理 target）
                    if (!this.target && !this._usePacingAI) {
                        entities.forEach(e => { if (e instanceof Player) this.target = e; });
                    }
                    if (!this.target || !this.target.active) return;
                    const dx = this.target.x - this.x, dy = this.target.y - this.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    this.rotation = Math.atan2(dy, dx);
                    // 2. 移动系统（始终独立运行）
                    this._updateMovement(dx, dy, dist, dt);
                    // 3. 攻击系统（始终独立运行）
                    const attackDt = this.getAttackIntervalDelta(dt);
                    this._updateAttack(attackDt, entities);
                    // 4. 更新攻击冷却和武器动画
                    if (this.attacks.melee) this.attacks.melee.update(attackDt);
                    if (this.attacks.ranged) this.attacks.ranged.update(attackDt);
                    this.updateWeaponAnim(dt);
                }
            }
            // 应用无人机易伤（无人机技能）
            applyDroneVulnerability(_stacks) {
                this._droneVulnerabilityStacks = 1; // 固定1层，不再叠加
                this._droneVulnerabilityTimer = 999999; // [FIX] 设极大值，永不过期，由外部范围判定控制移除
                if (EffectManager && EffectManager.add) {
                    EffectManager.add(new DroneVulnerabilityEffect(this.x, this.y));
                }
            }
            // 移除无人机易伤
            removeDroneVulnerability() {
                this._droneVulnerabilityStacks = 0;
                this._droneVulnerabilityTimer = 0;
                this.removeStatusEffect('droneVulnerability');
            }
            // [ANTI-TELEPORT] 限制每帧最大移动距离
            _clampMoveDistance(fromX, fromY, toX, toY, maxDist) {
                const dx = toX - fromX, dy = toY - fromY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > maxDist && maxDist > 0) {
                    const ratio = maxDist / dist;
                    return { x: fromX + dx * ratio, y: fromY + dy * ratio };
                }
                return { x: toX, y: toY };
            }
            // --- 移动寻路子系统（fallback）---
            _updateMovement(dx, dy, dist, dt) {
                if (this._dashStunned) { this.vx = 0; this.vy = 0; this.isMoving = false; return; }
                // 祭品效果（数据驱动）：怪物移速削减
                const maxSpd = (this.maxSpeed ?? this.speed ?? 100) * getTributeMonsterMoveSlowMul();
                const sc = dt / 1000;
                const maxStep = maxSpd * sc;

                if (this._specialTacticalTarget) {
                    dx = this._specialTacticalTarget.x - this.x;
                    dy = this._specialTacticalTarget.y - this.y;
                    dist = Math.sqrt(dx * dx + dy * dy);
                } else if (this._tacticalTarget) {
                    dx = this._tacticalTarget.x - this.x;
                    dy = this._tacticalTarget.y - this.y;
                    dist = Math.sqrt(dx * dx + dy * dy);
                }
                // [ENHANCE] 优先使用 PathManager 的路径
                if (this._pathManager && this._pathManager.hasValidPath()) {
                    const wp = this._pathManager.getCurrentWaypoint();
                    if (wp) {
                        const wdx = wp.x - this.x, wdy = wp.y - this.y, wdist = Math.sqrt(wdx*wdx + wdy*wdy);
                        if (wdist < 10) { this._pathManager.advanceWaypoint(); }
                        else {
                            this.vx += (wdx/wdist * maxSpd - this.vx) * this.accel;
                            this.vy += (wdy/wdist * maxSpd - this.vy) * this.accel;
                            const enx = this.x + this.vx * sc, eny = this.y + this.vy * sc;
                            const er = WallSystem.resolve(this.x, this.y, enx, eny, this.groundRadius);
                            const clamped = this._clampMoveDistance(this.x, this.y, er.x, er.y, maxStep);
                            this.x = clamped.x; this.y = clamped.y;
                            this.isMoving = true; this.animTime += 0.15; return;
                        }
                    }
                }
                // 兼容性：旧路径系统
                if (this._path && this._pathIdx < this._path.length) {
                    const wp = this._path[this._pathIdx];
                    const wdx = wp.x - this.x, wdy = wp.y - this.y, wdist = Math.sqrt(wdx*wdx + wdy*wdy);
                    if (wdist < 10) { this._pathIdx++; if (this._pathIdx >= this._path.length) this._path = null; }
                    else {
                        this.vx += (wdx/wdist * maxSpd - this.vx) * this.accel;
                        this.vy += (wdy/wdist * maxSpd - this.vy) * this.accel;
                        const enx = this.x + this.vx * sc, eny = this.y + this.vy * sc;
                        const er = WallSystem.resolve(this.x, this.y, enx, eny, this.groundRadius);
                        const clamped = this._clampMoveDistance(this.x, this.y, er.x, er.y, maxStep);
                        this.x = clamped.x; this.y = clamped.y;
                        this.isMoving = true; this.animTime += 0.15; return;
                    }
                }
                // 正常移动
                const moveX = dx / Math.max(dist, 1), moveY = dy / Math.max(dist, 1);
                this.vx += (moveX * maxSpd - this.vx) * this.accel;
                this.vy += (moveY * maxSpd - this.vy) * this.accel;
                const enx = this.x + this.vx * sc, eny = this.y + this.vy * sc;
                const er = WallSystem.resolve(this.x, this.y, enx, eny, this.groundRadius);
                if (er.x === this.x && er.y === this.y) {
                    // 被墙困住：切线滑动
                    this.vx *= 0.5; this.vy *= 0.5;
                    const tx = -moveY, ty = moveX;
                    const saX = this.x + tx * maxSpd * 2, saY = this.y + ty * maxSpd * 2;
                    const saR = WallSystem.resolve(this.x, this.y, saX, saY, this.groundRadius);
                    if (saR.x !== this.x || saR.y !== this.y) {
                        const clamped = this._clampMoveDistance(this.x, this.y, saR.x, saR.y, maxStep);
                        this.x = clamped.x; this.y = clamped.y;
                        this.vx = tx * maxSpd * 0.5; this.vy = ty * maxSpd * 0.5;
                    } else {
                        const sbX = this.x - tx * maxSpd * 2, sbY = this.y - ty * maxSpd * 2;
                        const sbR = WallSystem.resolve(this.x, this.y, sbX, sbY, this.groundRadius);
                        if (sbR.x !== this.x || sbR.y !== this.y) {
                            const clamped = this._clampMoveDistance(this.x, this.y, sbR.x, sbR.y, maxStep);
                            this.x = clamped.x; this.y = clamped.y;
                            this.vx = -tx * maxSpd * 0.5; this.vy = -ty * maxSpd * 0.5;
                        } else { this.vx = 0; this.vy = 0; }
                    }
                } else {
                    if (er.x === this.x) this.vx = 0;
                    if (er.y === this.y) this.vy = 0;
                    const clamped = this._clampMoveDistance(this.x, this.y, er.x, er.y, maxStep);
                    this.x = clamped.x; this.y = clamped.y;
                }
                if (dist <= this.attackRange) { this.vx *= this.friction; this.vy *= this.friction; }
                this.isMoving = Math.abs(this.vx) > 0.1 || Math.abs(this.vy) > 0.1;
                if (this.isMoving) this.animTime += 0.15;
            }
            // --- 魔力易伤效果更新 ---
            // --- 攻击指令子系统：独立运行，只要视线未被墙完全阻挡就尝试攻击 ---
            _updateAttack(dt, entities) {
                this.aiTimer += dt;
                if (this.aiTimer < this.aiInterval) return;
                const attack = this.attacks.ranged || this.attacks.melee;
                if (!attack || !attack.canUse()) return;
                // 视线检测：检查攻击是否被墙阻挡
                const targetX = this.target.x, targetY = this.target.y;
                const ranged = !!this.attacks.ranged;
                const isBlocked = WallSystem && (ranged
                    ? !hasRangedLineOfSight(this, this.target)
                    : WallSystem.blocked(this.x, this.y, targetX, targetY));
                if (isBlocked) return; // 视线被墙完全挡住，无法攻击
                if (!ranged && !canMeleeShareSurface(this, this.target)) return;
                // 远程攻击需要目标在射程内
                const dist = Math.hypot(targetX - this.x, targetY - this.y);
                if (this.attacks.ranged && dist > this.attackRange) return;
                // 执行攻击（精英及以上经攻击预警延迟 0.5s，预警结束才真正出手）
                this.aiTimer = 0;
                this._tryAttackTelegraph(() => {
                    if (attack.use(this, targetX, targetY, Array.from(entities.values()))) {
                        this.triggerWeaponAnim();
                    }
                });
            }            _getTextureKey() {
                return 'enemy_' + this.name.toLowerCase().replace(/\s+/g, '_');
            }
            _getPhaserOptions() {
                // 根据移动方向或朝向决定水平翻转
                let flipX = false;
                if (this.isMoving && Math.abs(this.vx) > 0.1) {
                    flipX = this.vx < 0; // 向左移动时翻转
                } else if (this.rotation !== undefined) {
                    // 静止时根据朝向判断
                    flipX = Math.cos(this.rotation) < 0;
                }
                return { textOffsetY: -32, flipX: flipX };
            }
            // 计算怪物战斗属性（唯一入口）
            calculateCombatStats() {
                const d = this.data;
                const formulas = COMBAT_FORMULAS.enemy?.calculateCombatStats || {};

                const hpFormula = formulas.maxHp || { base: 100, conMultiplier: 5 };
                const atkFormula = formulas.attack || { base: 0, strMultiplier: 0.5, dexMultiplier: 0.5, round: true };
                atkFormula.base = atkFormula.base ?? 0;
                const defFormula = formulas.defense || { conMultiplier: 1.5, strMultiplier: 0.3, round: 'floor' };
                const matkFormula = formulas.magicAttack || { base: 0, intMultiplier: 0.5, wisMultiplier: 0.5, round: 'floor' };
                matkFormula.base = matkFormula.base ?? 0;
                const mdefFormula = formulas.magicDefense || { wisMultiplier: 1.2, intMultiplier: 0.3, round: 'floor' };
                const critFormula = formulas.crit || { base: 2, luckMultiplier: 1.0, round: 'floor' };
                const critResFormula = formulas.critResist || { conMultiplier: 1.0, round: 'floor' };
                const levelFormula = formulas.level || { base: 1, strMultiplier: 0.05, conMultiplier: 0.06, dexMultiplier: 0.04, intMultiplier: 0.02, wisMultiplier: 0.015, luckMultiplier: 0.015, round: 'floor' };

                d.maxHp = hpFormula.base + d.con * hpFormula.conMultiplier;
                d.hp = d.maxHp;
                d.atk = atkFormula.round
                    ? Math.round(atkFormula.base + d.str * atkFormula.strMultiplier + d.dex * atkFormula.dexMultiplier)
                    : atkFormula.base + d.str * atkFormula.strMultiplier + d.dex * atkFormula.dexMultiplier;
                d.def = this._applyRounding(d.con * defFormula.conMultiplier + d.str * defFormula.strMultiplier, defFormula.round);
                d.matk = this._applyRounding(matkFormula.base + d.int * matkFormula.intMultiplier + d.wis * matkFormula.wisMultiplier, matkFormula.round);
                d.mdef = this._applyRounding(d.wis * mdefFormula.wisMultiplier + d.int * mdefFormula.intMultiplier, mdefFormula.round);
                d.crit = this._applyRounding(critFormula.base + d.luck * critFormula.luckMultiplier, critFormula.round);
                d.critRes = this._applyRounding(d.con * critResFormula.conMultiplier, critResFormula.round);
                d.level = this._applyRounding(
                    levelFormula.base
                    + d.str * levelFormula.strMultiplier
                    + d.con * levelFormula.conMultiplier
                    + d.dex * levelFormula.dexMultiplier
                    + d.int * levelFormula.intMultiplier
                    + d.wis * levelFormula.wisMultiplier
                    + d.luck * levelFormula.luckMultiplier,
                    levelFormula.round
                );
                this.maxHp = d.maxHp;
                this.hp = d.hp;
                this.level = d.level;
            }
            _applyRounding(value, method) {
                if (method === 'round') return Math.round(value);
                if (method === 'ceil') return Math.ceil(value);
                return Math.floor(value);
            }
            // 新增：获取等级
            getLevel() { return this.data ? this.data.level : 1; }
            // 新增：获取经验值（委托 exp-system 唯一口径：地牢 base × rankMul × 等级差倍率）
            getExpValue(playerLevel) {
                return getMonsterExp(this, playerLevel ?? 1, getCurrentDungeonType());
            }
            // 经验明细（含倍率与衰减/越级标记，供飘字标注与单局统计）
            getExpDetail(playerLevel) {
                return getMonsterExpDetail(this, playerLevel ?? 1, getCurrentDungeonType());
            }
            // 获取当前武器/普攻攻击力：
            // - 普通怪物（近战/远程物理）= 面板物理攻击 data.atk
            // - 特殊魔法普攻（毒液僵尸、僵尸巫师等 damageType 为 magic）= 面板魔法攻击 data.matk
            getCurrentWeaponAtk() {
                const d = this.data;
                if (!d) return 0;
                const attack = this.attacks && (this.attacks.melee || this.attacks.ranged);
                if (attack && attack.config && attack.config.damageType === 'magic') {
                    return d.matk;
                }
                return d.atk;
            }
            // 攻击命中回调：供毒伤等效果使用
            _onHitEntity(target) {
                if (this.poisonStacks && this.poisonStacks > 0 && target instanceof Player) {
                    target.applyPoison(this.poisonStacks);
                }
                // 协同流血效果
                if (this._synergyBleedChance && Math.random() < this._synergyBleedChance && target.applyBleeding) {
                    target.applyBleeding(1);
                }
            }

            // Phaser 同步渲染方法（提取所有子类重复代码）
            /**
             * Phaser 同步渲染：创建/更新 Phaser Sprite，如果成功则跳过 Canvas 渲染
             * @param {CanvasRenderingContext2D} ctx - Canvas 上下文
             * @param {number} x - 屏幕 X
             * @param {number} y - 屏幕 Y
             * @param {string} textureKey - Phaser 纹理键名（如 'enemy_zombie'）
             * @param {Object} options - 可选参数
             * @param {number} [options.spriteSize] - 渲染尺寸（默认 this.size * 3.5）
             * @param {number} [options.rotation] - 旋转角度（默认 this.rotation + Math.PI/2）
             * @param {number} [options.frame] - 帧索引（默认 0）
             * @param {boolean} [options.flipX] - 水平翻转
             * @param {boolean} [options.flipY] - 垂直翻转
             * @param {number} [options.textOffsetY] - 名字标签偏移（默认 -32）
             * @returns {boolean} true = Phaser 已处理，false = 需要 Canvas 渲染
             */

        }

        // 无人机易伤红色圆圈收缩特效：从半径200px收缩至圆心，持续1.5s
        class DroneVulnerabilityEffect {
            constructor(x, y) {
                this.x = x; this.y = y;
                this.life = 1500; this.maxLife = 1500; this.active = true;
                this.maxRadius = 200;
            }
            update(dt = 16.67) {
                this.life -= dt;
                if (this.life <= 0) this.active = false;
            }        }

            // Phaser 同步渲染方法（提取所有子类重复代码）
export { Enemy };
