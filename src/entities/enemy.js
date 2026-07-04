import { Combatant } from './combatant.js';
import { ThrustAttack, RangedAttack } from '../combat/attack.js';
import { Player } from './player.js';
import { PoisonEffect } from '../effects/poison-effect.js';
import { Renderer } from '../world/renderer.js';
import { EnemyFSM, PhaseChangeEffect } from '../ai/enemy-fsm.js';
import aiConfigData from '../../data/ai-config.json';

        class Enemy extends Combatant {
            constructor(x, y, config = {}) {
                super(x, y, { faction: 'enemy', hp: config.hp || 150, maxHp: config.maxHp || 150, size: config.size || 14, collisionRadius: 12, name: config.name || '测试敌人' });
                this.id = config.id || this.name;
                this.speed = (config.speed || 0.3) * 2; this.maxSpeed = this.speed; this.accel = 0.7; this.friction = 0.82;
                // 保存原始属性，供 FSM 阶段切换时计算倍率
                this._baseSpeed = this.maxSpeed;
                this.animTime = 0; this.isMoving = false; this.rotation = 0;
                this.attacks = { melee: new ThrustAttack({ cooldown: 600, range: 80, width: 20, damage: { min: 8, max: 15 }, knockback: 15 }) };
                this.weaponMode = 'melee';
                this.level = config.level || 1;
                // 新增：6维基础属性（合并到 Combatant 已创建的 this.data）
                Object.assign(this.data, {
                    str: config.str || 10, dex: config.dex || 10, int: config.int || 10,
                    con: config.con || 10, wis: config.wis || 10, luck: config.luck || 10,
                    stamina: 9999, maxStamina: 9999, kills: 0
                });
                this.calculateCombatStats();
                this.weaponImage = new Image(); this.weaponImage.src = 'assets/weapons/1-rusty_sword_euip.png';
                this.weaponAnim = { state: 'idle', timer: 0, angle: WEAPON_ANIM.idleAngle };
                this.aiTimer = 0; this.aiInterval = 300; this.target = null; this.attackRange = 70;
                // 保存原始 AI 属性，供 FSM 阶段切换时计算倍率
                this._baseAiInterval = this.aiInterval;
                this._baseAttackRange = this.attackRange;
                this._dashStunned = false; // 冲刺攻击眩晕状态
                this._dashStunTimer = 0; // 眩晕剩余时间
                this._showWeapon = config.showWeapon !== false; // 是否显示武器
                this._color = config.color || '#8a4a4a'; // 怪物颜色
                this._highlightColor = config.highlightColor || 'rgba(180, 100, 100, 0.3)'; // 高光颜色
                // A*寻路相关
                this._path = null; // 当前路径
                this._pathIdx = 0; // 路径索引
                this._pathRecalcTimer = 0; // 路径重算计时器
                this._stuckTimer = 0; // 卡住计时器
                this._lastX = x; this._lastY = y; // 上次位置（用于检测卡住）
                // ===== 中毒系统（狼蛛附魔）=====
                this._poisonStacks = 0;      // 中毒层数
                this._poisonTimer = 0;       // 中毒持续时间计时器
                this._poisonTickTimer = 0;   // 中毒伤害计时器
                this._poisonEffectId = null; // 状态栏效果ID
                this._poisonEffect = new PoisonEffect(); // 中毒绿色粒子效果（与玩家一致）
                // ===== 流血系统（骑士长剑改造）=====
                this._bleedStacks = 0;       // 流血层数
                this._bleedTimer = 0;        // 流血持续时间计时器
                this._bleedTickTimer = 0;    // 流血伤害计时器
                this._bleedEffectId = null;  // 状态栏效果ID
                // ===== 魔力易伤系统（符文长剑/夜与火之剑改造）=====
                this._magicVulnerabilityStacks = 0; // 魔力易伤层数
                this._magicVulnerabilityTimer = 0;  // 魔力易伤持续时间计时器
                // ===== 无人机易伤系统（无人机技能）=====
                this._droneVulnerabilityStacks = 0; // 无人机易伤层数
                this._droneVulnerabilityTimer = 0;  // 无人机易伤持续时间计时器

                // ===== FSM 阶段系统 =====
                this._fsm = null;      // FSM 实例
                this._phaseSkills = null; // 阶段技能集合
                // 加载 AI 配置：优先使用子类传入的 config.aiConfig，否则从 JSON 按 id/name 匹配
                const aiConfig = config.aiConfig || aiConfigData[this.id] || aiConfigData[this.name] || null;
                if (aiConfig) {
                    this._fsm = new EnemyFSM(aiConfig);
                }

                // 自动包装子类 render 方法，在渲染后添加中毒粒子效果
                // 所有子类（Zombie, Spider 等）都覆盖了 render 不调用 super.render()
                const proto = Object.getPrototypeOf(this);
                if (proto && proto.render && !proto._poisonRenderWrapped && proto !== Enemy.prototype) {
                    const originalRender = proto.render;
                    proto._poisonRenderWrapped = true;
                    proto.render = function(ctx) {
                        originalRender.call(this, ctx);
                        if (this._poisonStacks > 0 && this._poisonEffect) {
                            const pos = Renderer.worldToScreen(this.x, this.y);
                            this._poisonEffect.render(ctx, pos.x, pos.y - this.size);
                        }
                    };
                }

            }
            triggerWeaponAnim() {
                // 动画打断机制：无论当前动画状态，立即重置为 windup
                this.weaponAnim.state = 'windup';
                this.weaponAnim.timer = 0;
            }
            updateWeaponAnim(dt) {
                const wa = WEAPON_ANIM, anim = this.weaponAnim;
                switch (anim.state) {
                    case 'idle': anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06; break;
                    case 'windup':
                        anim.timer += dt;
                        if (anim.timer >= wa.windupMs) { anim.state = 'swing'; anim.timer = 0; }
                        else anim.angle = wa.idleAngle + (wa.windupAngle - wa.idleAngle) * easeInQuad(anim.timer / wa.windupMs);
                        break;
                    case 'swing':
                        anim.timer += dt;
                        // 新增：敌人swing阶段进行攻击判定（与Player一致）
                        if (anim.timer === 0 && this._pendingThrust) {
                            this._pendingThrust.active = true;
                        }
                        if (this._pendingThrust && this._pendingThrust.active) {
                            if (Date.now() - this._pendingThrust.startTime <= 200) {
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
                        else anim.angle = wa.windupAngle + (wa.swingAngle - wa.windupAngle) * easeOutQuad(anim.timer / wa.swingMs);
                        break;
                    case 'recover':
                        anim.timer += dt;
                        if (anim.timer >= wa.recoverMs) { anim.state = 'idle'; anim.timer = 0; }
                        else anim.angle = wa.swingAngle + (wa.idleAngle - wa.swingAngle) * easeInOutCubic(anim.timer / wa.recoverMs);
                        break;
                }
            }
            renderWeapon(ctx) {
                if (!this._showWeapon || !this.weaponImage || !this.weaponImage.complete) return;
                const wa = WEAPON_ANIM, s = wa.size, w = s * 0.84;
                ctx.save();
                ctx.translate(wa.holdX, wa.holdY);
                ctx.rotate(Math.PI / 2);
                let finalAngle = this.weaponAnim.angle;
                if (this.isMoving && this.weaponAnim.state === 'idle') {
                    const mSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                    finalAngle += Math.sin(this.animTime * 0.3) * Math.min(0.15, mSpeed * 0.04);
                }
                ctx.rotate(finalAngle);
                if (this.weaponImage && this.weaponImage.complete && this.weaponImage.naturalWidth > 0) ctx.drawImage(this.weaponImage, -w / 2, -s / 2, w, s);
                ctx.restore();
            }
            // === AI 系统：移动寻路 与 攻击指令 完全分离 ===
            // 阶段切换回调：子类可覆盖以实现自定义特效
            onPhaseChange(phase) {
                // 默认在控制台输出阶段切换
                console.log(`[${this.name}] 进入阶段: ${phase.name}`);
                // 触发视觉特效（如屏幕震动、粒子效果）
                if (typeof EffectManager !== 'undefined') {
                    EffectManager.add(new PhaseChangeEffect(this.x, this.y, phase.name));
                }
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

                // [REFACTOR] 外部系统驱动：如果 game.js 已调用 MovementSystem/CombatSystem/PerceptionSystem，
                // 则 enemy.js 不再重复处理移动/攻击/目标选择，避免每帧重复调用。
                // 如果没有外部系统（fallback），使用旧逻辑。
                if (typeof window !== 'undefined' && (!window.MovementSystem || !window.CombatSystem)) {
                    // 1. 寻找目标
                    if (!this.target) {
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
                // 状态效果更新（始终执行，无论外部系统是否存在）
                this._updatePoison(dt);
                this._updateBleed(dt);
                this._updateMagicVulnerability(dt);
                this._updateDroneVulnerability(dt);
            }
            // --- 中毒效果更新 ---
            _updatePoison(dt) {
                if (this._poisonStacks > 0) {
                    this._poisonTimer -= dt;
                    this._poisonTickTimer -= dt;
                    // 更新粒子效果
                    if (this._poisonEffect) {
                        this._poisonEffect.update(dt, 0, -this.size);
                    }
                    if (this._poisonTickTimer <= 0) {
                        this.hp -= this._poisonStacks;
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, `-${this._poisonStacks}`, '#39ff14'));
                        this._poisonTickTimer = 1000;
                        // 中毒致死
                        if (this.hp <= 0) {
                            this.hp = 0;
                            this.onDeath();
                        }
                    }
                    if (this._poisonTimer <= 0) {
                        this._poisonStacks = Math.max(0, this._poisonStacks - 1);
                        if (this._poisonStacks > 0) {
                            this._poisonTimer = 5000;
                        } else {
                            if (this._poisonEffectId) {
                                StatusBar.removeEffect(this._poisonEffectId);
                                this._poisonEffectId = null;
                            }
                            if (this._poisonEffect) {
                                this._poisonEffect.reset();
                            }
                        }
                    }
                }
            }
            // 应用中毒（狼蛛附魔）
            applyPoison(stacks) {
                this._poisonStacks += stacks;
                this._poisonTimer = 5000;
                if (this._poisonTickTimer <= 0) this._poisonTickTimer = 1000;
                EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, `☠️ 中毒 +${stacks}层`, '#39ff14'));
                if (this._poisonEffect) {
                    this._poisonEffect.reset();
                }
            }
            // --- 流血效果更新 ---
            _updateBleed(dt) {
                if (this._bleedStacks > 0) {
                    this._bleedTimer -= dt;
                    this._bleedTickTimer -= dt;
                    if (this._bleedTickTimer <= 0) {
                        const bleedDamage = Math.max(1, Math.floor(this.hp * 0.1));
                        this.hp -= bleedDamage;
                        EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size, `-${bleedDamage}`, '#9a3a3a'));
                        this._bleedTickTimer = 1000;
                    }
                    if (this._bleedTimer <= 0) {
                        this._bleedStacks = Math.max(0, this._bleedStacks - 1);
                        if (this._bleedStacks > 0) {
                            this._bleedTimer = 5000;
                            if (this._bleedEffectId) {
                                StatusBar.updateEffectStacks('bleed', this._bleedStacks);
                            }
                        } else {
                            if (this._bleedEffectId) {
                                StatusBar.removeEffect(this._bleedEffectId);
                                this._bleedEffectId = null;
                            }
                        }
                    }
                }
            }
            // 应用流血（骑士长剑改造）
            applyBleeding(stacks) {
                this._bleedStacks += stacks;
                this._bleedTimer = 5000;
                if (this._bleedTickTimer <= 0) this._bleedTickTimer = 1000;
                if (!this._bleedEffectId) {
                    this._bleedEffectId = StatusBar.addEffect('bleed', 5000, { stacks: this._bleedStacks });
                } else {
                    StatusBar.updateEffectStacks('bleed', this._bleedStacks);
                }
                EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, `🩸 流血 +${stacks}层`, '#9a3a3a'));
            }
            // --- 魔力易伤效果更新 ---
            _updateMagicVulnerability(dt) {
                if (this._magicVulnerabilityStacks > 0) {
                    this._magicVulnerabilityTimer -= dt;
                    if (this._magicVulnerabilityTimer <= 0) {
                        this._magicVulnerabilityStacks = Math.max(0, this._magicVulnerabilityStacks - 1);
                        if (this._magicVulnerabilityStacks > 0) {
                            this._magicVulnerabilityTimer = 5000;
                        }
                    }
                }
            }
            // 应用魔力易伤（符文长剑/夜与火之剑改造）
            applyMagicVulnerability(stacks) {
                this._magicVulnerabilityStacks += stacks;
                this._magicVulnerabilityTimer = 5000;
                EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, `🔮 魔力易伤 +${stacks}层`, '#8a5a9a'));
            }
            // --- 无人机易伤效果更新 ---
            _updateDroneVulnerability(dt) {
                if (this._droneVulnerabilityStacks > 0) {
                    this._droneVulnerabilityTimer -= dt;
                    if (this._droneVulnerabilityTimer <= 0) {
                        this._droneVulnerabilityStacks = Math.max(0, this._droneVulnerabilityStacks - 1);
                        if (this._droneVulnerabilityStacks > 0) {
                            this._droneVulnerabilityTimer = 5000;
                        }
                    }
                }
            }
            // 应用无人机易伤（无人机技能）
            applyDroneVulnerability(stacks) {
                this._droneVulnerabilityStacks = 1; // 固定1层，不再叠加
                this._droneVulnerabilityTimer = 999999; // [FIX] 设极大值，永不过期，由外部范围判定控制移除
                if (typeof EffectManager !== 'undefined' && EffectManager.add) {
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
                // A* 路径
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
                const isBlocked = typeof WallSystem !== 'undefined' &&
                    WallSystem.blocked(this.x, this.y, targetX, targetY);
                if (isBlocked) return; // 视线被墙完全挡住，无法攻击
                // 执行攻击
                this.aiTimer = 0;
                if (attack.use(this, targetX, targetY, Array.from(entities.values()))) {
                    this.triggerWeaponAnim();
                }
            }
            render(ctx) {
                const pos = Renderer.worldToScreen(this.x, this.y), x = pos.x, y = pos.y + Math.sin(this.animTime) * 2;
                this.renderHealthBar(ctx);
                // Phaser 同步：如果已有 Phaser Sprite，跳过 Canvas 实体渲染，保留名称和碰撞半径
                if (this._phaserSprite && this._phaserSprite.active) {
                    ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
                    ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(this.name, x, y - 32);
                    this.renderCollisionRadius(ctx);
                    return;
                }
                this._drawShadow(ctx, x, y, this.size);
                // 4方向朝向判断
                let facingAngle = this.rotation;
                if (this.isMoving && (Math.abs(this.vx) > 0.1 || Math.abs(this.vy) > 0.1)) {
                    facingAngle = Math.atan2(this.vy, this.vx);
                }
                const deg = (facingAngle * 180 / Math.PI + 360) % 360;
                let facing = 'right';
                let displayAngle = 0;
                if (deg >= 45 && deg < 135) { facing = 'down'; displayAngle = Math.PI / 2; }
                else if (deg >= 135 && deg < 225) { facing = 'left'; displayAngle = 0; }
                else if (deg >= 225 && deg < 315) { facing = 'up'; displayAngle = -Math.PI / 2; }
                ctx.save(); ctx.translate(x, y);
                ctx.rotate(displayAngle);
                if (facing === 'left') ctx.scale(-1, 1);
                ctx.fillStyle = this._color; ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = this._highlightColor; ctx.beginPath(); ctx.arc(-3, -3, this.size * 0.5, 0, Math.PI*2); ctx.fill();
                this.renderWeapon(ctx);
                // 方向箭头（仅当显示武器时）
                if (this._showWeapon) {
                    ctx.fillStyle = '#d4c5a9'; ctx.beginPath(); ctx.moveTo(this.size + 5, 0); ctx.lineTo(this.size - 1, -4); ctx.lineTo(this.size - 1, 4); ctx.closePath(); ctx.fill();
                }
                ctx.strokeStyle = this._highlightColor; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, this.size + 5 + Math.sin(Date.now()/300)*1.5, 0, Math.PI*2); ctx.stroke();
                // 近战攻击范围黄圈显示（提高对比度，雪地场景可见）
                if (this.attacks && this.attacks.melee && this.attacks.melee.config && this.attacks.melee.config.range) {
                    ctx.strokeStyle = 'rgba(220, 160, 20, 0.75)';
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([5, 5]);
                    ctx.beginPath();
                    ctx.arc(0, 0, this.attacks.melee.config.range, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
                ctx.restore();
                ctx.fillStyle = 'rgba(212, 197, 169, 0.8)'; ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(this.name, x, y - 32);
                this.renderCollisionRadius(ctx);
                // 中毒绿色粒子效果（与玩家一致）
                if (this._poisonStacks > 0 && this._poisonEffect) {
                    this._poisonEffect.render(ctx, x, y - this.size);
                }
                // 受击白光效果
                if (this.hitFlash > 0) {
                    const flashAlpha = this.hitFlash / this.hitFlashDuration;
                    ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha * 0.6})`;
                    ctx.beginPath(); ctx.arc(x, y, this.size + 2, 0, Math.PI * 2); ctx.fill();
                }
            }
            // 新增：计算战斗属性（使用与主角相同的公式）
            calculateCombatStats() {
                const d = this.data;
                d.maxHp = 100 + d.con * 5;
                d.hp = d.maxHp;
                d.atk = Math.round(10 + d.str * 0.05 + d.dex * 0.1);
                d.def = Math.floor(d.con * 1.2 + d.str * 0.3);
                d.matk = Math.floor(d.int * 1.5 + d.wis * 0.5);
                d.mdef = Math.floor(d.wis * 1.2 + d.int * 0.3);
                d.hit = 80 + Math.floor(d.dex * 0.5);
                d.dodge = 5 + Math.floor(d.dex * 0.3);
                d.crit = 2 + Math.floor(d.luck * 1.0);
                d.aspd = 1.0 + d.dex * 0.02;
                d.critRes = Math.floor(d.con * 1.0);
                d.level = Math.floor(1 + d.str * 0.05 + d.con * 0.06 + d.dex * 0.04 + d.int * 0.02 + d.wis * 0.015 + d.luck * 0.015);
                this.maxHp = d.maxHp;
                this.hp = d.hp;
                this.level = d.level;
            }
            // 新增：获取等级
            getLevel() { return this.data ? this.data.level : 1; }
            // 新增：获取经验值（基于 rank 实时计算，不依赖构造函数时序）
            getExpValue() {
                const rank = this._rank || 'normal';
                const expTable = { minor: 1, normal: 2, elite: 6, boss: 20 };
                return expTable[rank] || 2;
            }
            // 新增：获取当前武器攻击力（供攻击系统使用）
            getCurrentWeaponAtk() {
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
            }
            render(ctx) {
                const progress = 1 - this.life / this.maxLife; // 0 → 1
                const currentRadius = this.maxRadius * (1 - progress);
                if (currentRadius <= 0) return;
                const screenPos = Renderer.worldToScreen(this.x, this.y);
                ctx.save();
                ctx.strokeStyle = `rgba(255, 60, 60, ${0.7 * (1 - progress)})`;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(screenPos.x, screenPos.y, currentRadius, 0, Math.PI * 2);
                ctx.stroke();
                // 内圈发光
                ctx.strokeStyle = `rgba(255, 100, 100, ${0.3 * (1 - progress)})`;
                ctx.lineWidth = 6;
                ctx.beginPath();
                ctx.arc(screenPos.x, screenPos.y, currentRadius + 3, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }

export { Enemy };
