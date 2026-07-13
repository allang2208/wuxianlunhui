import { WEAPON_ANIM } from '../config/math-utils.js';

import { WallSystem } from '../world/wall-system.js';
import { Combatant } from './combatant.js';
import { ThrustAttack, RangedAttack } from '../combat/attack.js';
import { Player } from './player.js';
import { PoisonEffect } from '../effects/poison-effect.js';
import { EnemyFSM } from '../ai/enemy-fsm.js';
import aiConfigData from '../../data/ai-config.json';
import { COMBAT_CONFIG } from '../config/combat-config.js';
import { COMBAT_FORMULAS } from '../config/combat-formulas.js';
import { Easing } from '../config/math-utils.js';
import { EffectManager } from '../effects/effect-manager.js';
import { loadImage } from '../utils/image-loader.js';

        class Enemy extends Combatant {
            constructor(x, y, config = {}) {
                const defaults = COMBAT_CONFIG.enemyDefaults || {};
                const hp = config.hp ?? defaults.hp ?? 150;
                const maxHp = config.maxHp ?? defaults.maxHp ?? 150;
                const size = config.size ?? defaults.size ?? 14;
                const name = config.name ?? defaults.name ?? '测试敌人';
                super(x, y, { faction: 'enemy', hp, maxHp, size, collisionRadius: config.collisionRadius, name });
                this.id = config.id || this.name;
                const defaultSpeed = (defaults.speed ?? 45) * (defaults.speedMultiplier ?? 1);
                this.speed = config.speed ?? defaultSpeed;
                // 防止旧配置中 speed 写成 0.2 这类相对值导致完全不动
                if (this.speed < 1) this.speed = 45;
                this.maxSpeed = this.speed;
                this.accel = config.accel ?? defaults.accel ?? 0.7;
                this.friction = config.friction ?? defaults.friction ?? 0.82;
                // 保存原始属性，供 FSM 阶段切换时计算倍率
                this._baseSpeed = this.maxSpeed;
                this.animTime = 0; this.isMoving = false; this.rotation = 0;
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
                this.calculateCombatStats();
                if (explicitHp !== undefined) {
                    this.hp = explicitHp;
                    this.data.hp = explicitHp;
                }
                if (explicitMaxHp !== undefined) {
                    this.maxHp = explicitMaxHp;
                    this.data.maxHp = explicitMaxHp;
                }
                this.weaponImage = loadImage('assets/weapons/1-rusty_sword_euip.png');
                this.weaponAnim = { state: 'idle', timer: 0, angle: WEAPON_ANIM.idleAngle };
                this.aiTimer = 0;
                this.aiInterval = config.aiInterval ?? defaults.aiInterval ?? 300;
                this.target = null;
                this.attackRange = config.attackRange || config.dashDistance || defaults.attackRange || 70;
                // 保存原始 AI 属性，供 FSM 阶段切换时计算倍率
                this._baseAiInterval = this.aiInterval;
                this._baseAttackRange = this.attackRange;
                this._dashStunned = false; // 冲刺攻击眩晕状态
                this._dashStunTimer = 0; // 眩晕剩余时间
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
                // AI 配置读取（子类可通过 config.ai 注入；默认 0 表示不启用 pacing AI）
                const pacingAiConfig = config.ai || {};
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
            }
            updateWeaponAnim(dt) {
                const wa = WEAPON_ANIM, anim = this.weaponAnim;
                const weaponAnimCfg = COMBAT_CONFIG.weaponAnim?.enemy || {};
                const pendingThrustHitWindowMs = weaponAnimCfg.pendingThrustHitWindowMs ?? 200;
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
                            if (Date.now() - this._pendingThrust.startTime <= pendingThrustHitWindowMs) {
                                this.attacks.melee.checkTriangleHit(this);
                            } else {
                                this._pendingThrust.active = false;
                            }
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
            // --- 查找最近玩家 ---
            _findNearestPlayer(entities) {
                let nearestPlayer = null;
                let nearestDist = Infinity;
                const arr = entities && entities.values ? Array.from(entities.values()) : entities;
                if (!arr) return { entity: null, distance: Infinity };
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
            update(dt, entities) {
                super.update(dt);
                // FSM 阶段切换更新（始终执行，不因眩晕或目标丢失而跳过）
                if (this._fsm) {
                    this._fsm.update(dt, this, entities);
                }
                // 冲刺攻击眩晕计时
                if (this._dashStunned) {
                    this._dashStunTimer -= dt;
                    if (this._dashStunTimer <= 0) {
                        this._dashStunned = false;
                    }
                }
                // 眩晕状态（通过状态栏系统检测）：无法移动、无法攻击
                if (this.hasStatusEffect('stun')) {
                    this.vx = 0; this.vy = 0;
                    this.isMoving = false;
                    return;
                }

                // 通用 pacing/chasing AI（狼类等启用 usePacingAI 的子类）
                if (this._usePacingAI) {
                    this._aiScanTimer += dt;
                    if (this._aiScanTimer >= this._aiScanInterval) {
                        this._aiScanTimer = 0;
                        this._updateAIState(dt, entities);
                    }
                    this._executeAI(dt, entities);
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
                    this._updateAttack(dt, entities);
                    // 4. 更新攻击冷却和武器动画
                    if (this.attacks.melee) this.attacks.melee.update(dt);
                    if (this.attacks.ranged) this.attacks.ranged.update(dt);
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
                const maxSpd = this.maxSpeed || this.speed || 100;
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
                            const er = WallSystem.resolve(this.x, this.y, enx, eny, this.collisionRadius || 12);
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
                        const er = WallSystem.resolve(this.x, this.y, enx, eny, this.collisionRadius || 12);
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
                const er = WallSystem.resolve(this.x, this.y, enx, eny, this.collisionRadius || 12);
                if (er.x === this.x && er.y === this.y) {
                    // 被墙困住：切线滑动
                    this.vx *= 0.5; this.vy *= 0.5;
                    const tx = -moveY, ty = moveX;
                    const saX = this.x + tx * maxSpd * 2, saY = this.y + ty * maxSpd * 2;
                    const saR = WallSystem.resolve(this.x, this.y, saX, saY, this.collisionRadius || 12);
                    if (saR.x !== this.x || saR.y !== this.y) {
                        const clamped = this._clampMoveDistance(this.x, this.y, saR.x, saR.y, maxStep);
                        this.x = clamped.x; this.y = clamped.y;
                        this.vx = tx * maxSpd * 0.5; this.vy = ty * maxSpd * 0.5;
                    } else {
                        const sbX = this.x - tx * maxSpd * 2, sbY = this.y - ty * maxSpd * 2;
                        const sbR = WallSystem.resolve(this.x, this.y, sbX, sbY, this.collisionRadius || 12);
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
                const isBlocked = WallSystem &&
                    WallSystem.blocked(this.x, this.y, targetX, targetY);
                if (isBlocked) return; // 视线被墙完全挡住，无法攻击
                // 远程攻击需要目标在射程内
                const dist = Math.hypot(targetX - this.x, targetY - this.y);
                if (this.attacks.ranged && dist > this.attackRange) return;
                // 执行攻击
                this.aiTimer = 0;
                if (attack.use(this, targetX, targetY, Array.from(entities.values()))) {
                    this.triggerWeaponAnim();
                }
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
            // 新增：计算战斗属性（使用与主角相同的公式）
            calculateCombatStats() {
                const d = this.data;
                const formulas = COMBAT_FORMULAS.enemy?.calculateCombatStats || {};

                const hpFormula = formulas.maxHp || { base: 100, conMultiplier: 5 };
                const atkFormula = formulas.attack || { base: 10, strMultiplier: 0.05, dexMultiplier: 0.1, round: true };
                atkFormula.base = atkFormula.base ?? 10;
                const defFormula = formulas.defense || { conMultiplier: 1.2, strMultiplier: 0.3, round: 'floor' };
                const matkFormula = formulas.magicAttack || { intMultiplier: 1.5, wisMultiplier: 0.5, round: 'floor' };
                const mdefFormula = formulas.magicDefense || { wisMultiplier: 1.2, intMultiplier: 0.3, round: 'floor' };
                const hitFormula = formulas.hit || { base: 80, dexMultiplier: 0.5, round: 'floor' };
                const dodgeFormula = formulas.dodge || { base: 5, dexMultiplier: 0.3, round: 'floor' };
                const critFormula = formulas.crit || { base: 2, luckMultiplier: 1.0, round: 'floor' };
                const aspdFormula = formulas.attackSpeed || { base: 1.0, dexMultiplier: 0.02 };
                const critResFormula = formulas.critResist || { conMultiplier: 1.0, round: 'floor' };
                const levelFormula = formulas.level || { base: 1, strMultiplier: 0.05, conMultiplier: 0.06, dexMultiplier: 0.04, intMultiplier: 0.02, wisMultiplier: 0.015, luckMultiplier: 0.015, round: 'floor' };

                d.maxHp = hpFormula.base + d.con * hpFormula.conMultiplier;
                d.hp = d.maxHp;
                d.atk = atkFormula.round
                    ? Math.round(atkFormula.base + d.str * atkFormula.strMultiplier + d.dex * atkFormula.dexMultiplier)
                    : atkFormula.base + d.str * atkFormula.strMultiplier + d.dex * atkFormula.dexMultiplier;
                d.def = this._applyRounding(d.con * defFormula.conMultiplier + d.str * defFormula.strMultiplier, defFormula.round);
                d.matk = this._applyRounding(d.int * matkFormula.intMultiplier + d.wis * matkFormula.wisMultiplier, matkFormula.round);
                d.mdef = this._applyRounding(d.wis * mdefFormula.wisMultiplier + d.int * mdefFormula.intMultiplier, mdefFormula.round);
                d.hit = this._applyRounding(hitFormula.base + d.dex * hitFormula.dexMultiplier, hitFormula.round);
                d.dodge = this._applyRounding(dodgeFormula.base + d.dex * dodgeFormula.dexMultiplier, dodgeFormula.round);
                d.crit = this._applyRounding(critFormula.base + d.luck * critFormula.luckMultiplier, critFormula.round);
                d.aspd = aspdFormula.base + d.dex * aspdFormula.dexMultiplier;
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
            // 新增：获取经验值（基于 rank 实时计算，不依赖构造函数时序）
            getExpValue() {
                const formula = COMBAT_FORMULAS.enemy?.expValue || { base: 10, levelMultiplier: 5 };
                return formula.base + (this.level || 1) * formula.levelMultiplier;
            }
            // 新增：获取当前武器攻击力（供攻击系统使用）
            // [FIX] 优先使用 enemy-config.json 中配置的 damageMin/damageMax，
            // 确保实际伤害与图鉴显示一致，避免被 STR/DEX 公式二次计算。
            getCurrentWeaponAtk() {
                const attack = this.attacks && (this.attacks.melee || this.attacks.ranged);
                if (attack && attack.config && attack.config.damage) {
                    return Math.floor((attack.config.damage.min + attack.config.damage.max) / 2);
                }
                return this.data ? this.data.atk : 0;
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
