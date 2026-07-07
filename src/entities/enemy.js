import { Combatant } from './combatant.js';
import { ThrustAttack, RangedAttack } from '../combat/attack.js';
import { Player } from './player.js';
import { PoisonEffect } from '../effects/poison-effect.js';
import { Renderer } from '../world/renderer.js';
import { EnemyFSM, PhaseChangeEffect } from '../ai/enemy-fsm.js';
import aiConfigData from '../../data/ai-config.json';

        class Enemy extends Combatant {
            constructor(x, y, config = {}) {
                super(x, y, { faction: 'enemy', hp: config.hp || 150, maxHp: config.maxHp || 150, size: config.size || 14, collisionRadius: config.collisionRadius, name: config.name || '测试敌人' });
                this.id = config.id || this.name;
                this.speed = (config.speed || 0.3) * 3; this.maxSpeed = this.speed; this.accel = 0.7; this.friction = 0.82;
                // 保存原始属性，供 FSM 阶段切换时计算倍率
                this._baseSpeed = this.maxSpeed;
                this.animTime = 0; this.isMoving = false; this.rotation = 0;
                // 使用 config.attack 中的配置（如果提供），否则使用默认值
                const attackConfig = config.attack || {};
                this.attacks = { melee: new ThrustAttack({ 
                    cooldown: attackConfig.cooldown || 600, 
                    range: attackConfig.range || 80, 
                    width: attackConfig.width || 20, 
                    damage: attackConfig.damage || (attackConfig.damageMin !== undefined && attackConfig.damageMax !== undefined ? { min: attackConfig.damageMin, max: attackConfig.damageMax } : { min: 8, max: 15 }), 
                    knockback: attackConfig.knockback || 15,
                    dynamicRange: attackConfig.dynamicRange !== undefined ? attackConfig.dynamicRange : attackConfig.range
                }) };
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
                this.aiTimer = 0; this.aiInterval = 300; this.target = null; this.attackRange = config.attackRange || config.dashDistance || 70;
                // 保存原始 AI 属性，供 FSM 阶段切换时计算倍率
                this._baseAiInterval = this.aiInterval;
                this._baseAttackRange = this.attackRange;
                this._dashStunned = false; // 冲刺攻击眩晕状态
                this._dashStunTimer = 0; // 眩晕剩余时间
                this._showWeapon = config.showWeapon !== false; // 是否显示武器
                this._color = config.color || '#8a4a4a'; // 怪物颜色
                this._highlightColor = config.highlightColor || 'rgba(180, 100, 100, 0.3)'; // 高光颜色
                this._useStickFigure = true; // 火柴人模式：禁用 Phaser 精灵图，使用 Canvas 绘制
                this._alertRange = config._alertRange || config.alertRange || 0; // 索敌范围：0 表示未设置，使用 PerceptionSystem 默认值
                this._stuckTimer = 0; // 卡住计时器
                this._lastX = x; this._lastY = y; // 上次位置（用于检测卡住）
                // [ENHANCE] 智能路径管理器（参考《环世界》）：预规划 + 定期有效性检查 + 局部修复
                this._pathManager = null; // 由 MovementSystem 懒加载创建
                // ===== 状态效果：中毒粒子效果（Enemy 特有，Combatant 基类未包含）=====
                this._poisonEffect = new PoisonEffect(); // 中毒绿色粒子效果

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
                const pos = this._getRenderPosition();
                const x = pos.x, y = pos.y;
                
                this.renderHealthBar(ctx);
                
                // 阴影在 Phaser 之前画（确保不被跳过）
                this._drawShadow(ctx, x, y, this.size);
                
                const textureKey = this._getTextureKey();
                const phaserOptions = this._getPhaserOptions();
                if (this._renderPhaserSync(ctx, x, y, textureKey, phaserOptions)) {
                    return;
                }
                
                ctx.save(); ctx.translate(x, y);
                this._drawBody(ctx);
                ctx.restore();
                
                this._renderNameTag(ctx, x, y);
                this.renderCollisionRadius(ctx);
                this._renderPoisonEffect(ctx, x, y);
                this._renderHitFlash(ctx, x, y);
            }
            _getRenderPosition() {
                return Renderer.worldToScreen(this.x, this.y);
            }
            _getTextureKey() {
                return 'enemy_' + this.name.toLowerCase().replace(/\s+/g, '_');
            }
            _getPhaserOptions() {
                return { textOffsetY: -32 };
            }
            _renderNameTag(ctx, x, y) {
                ctx.fillStyle = 'rgba(212, 197, 169, 0.8)';
                ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(this.name, x, y - 32);
            }
            _renderPoisonEffect(ctx, x, y) {
                if (this._poisonStacks > 0 && this._poisonEffect) {
                    this._poisonEffect.render(ctx, x, y - this.size);
                }
            }
            _renderHitFlash(ctx, x, y) {
                if (this.hitFlash > 0) {
                    const flashAlpha = this.hitFlash / this.hitFlashDuration;
                    ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha * 0.6})`;
                    ctx.beginPath(); ctx.arc(x, y, this.size + 2, 0, Math.PI * 2); ctx.fill();
                }
            }
            _drawBody(ctx) {
                // 与主角一致：只做左右镜像翻转，不做上下旋转
                // 注意：player.render() 中先 ctx.rotate(this.rotation) 再调用 _drawStickFigure
                // 而 enemy.render() 中直接 ctx.translate(x, y) 调用 _drawBody，没有外层旋转
                // 所以这里不需要 ctx.rotate(-this.rotation) 来抵消，只做水平翻转即可
                ctx.save();

                let facingDir = 'right';
                if (this.isMoving && Math.abs(this.vx) > 0.1) {
                    facingDir = this.vx > 0 ? 'right' : 'left';
                } else {
                    // 静止时根据朝向（对玩家方向）判断
                    facingDir = Math.cos(this.rotation) > 0 ? 'right' : 'left';
                }
                if (facingDir === 'left') ctx.scale(-1, 1);
                
                // 绿色火柴人
                this._drawEnemyStickFigure(ctx);
                
                this.renderWeapon(ctx);
                if (this._showWeapon) {
                    ctx.fillStyle = '#d4c5a9'; ctx.beginPath(); ctx.moveTo(this.size + 5, 0); ctx.lineTo(this.size - 1, -4); ctx.lineTo(this.size - 1, 4); ctx.closePath(); ctx.fill();
                }
                ctx.strokeStyle = this._highlightColor; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, this.size + 5 + Math.sin(Date.now()/300)*1.5, 0, Math.PI*2); ctx.stroke();
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
            }
            // 绘制绿色火柴人（敌人版）
            // 支持双色：_headColor 头部颜色，_color 身体颜色（默认同色）
            _drawEnemyStickFigure(ctx) {
                const hitWhite = this.hitFlash > 0;
                const headColor = hitWhite ? '#ffffff' : (this._headColor || this._color || '#4a9a4a');
                const bodyColor = hitWhite ? '#ffffff' : (this._color || '#4a9a4a');
                const lw = hitWhite ? 4 : 3;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.lineWidth = lw;

                const t = this.animTime;
                const walking = this.isMoving;
                const s = walking ? Math.sin(t * 8) : 0;
                const bob = walking ? Math.sin(t * 16) * 1.5 : Math.sin(t * 2) * 0.3;

                const head   = { x: 0, y: -23 + bob };
                const neck   = { x: 0, y: -17 + bob };
                const shoulder = { x: 0, y: -15 + bob };
                const hip    = { x: 0, y: 2 + bob };

                // 头部（使用 headColor）
                ctx.fillStyle = headColor;
                ctx.beginPath(); ctx.arc(head.x, head.y, 6, 0, Math.PI * 2); ctx.fill();

                // 身体（使用 bodyColor）
                ctx.strokeStyle = bodyColor;
                ctx.beginPath(); ctx.moveTo(neck.x, neck.y); ctx.lineTo(hip.x, hip.y); ctx.stroke();

                const lElbow = { x: -5 + s * 3, y: -8 + bob };
                const lHand  = { x: -7 + s * 4, y: -1 + bob };
                ctx.beginPath(); ctx.moveTo(shoulder.x, shoulder.y); ctx.lineTo(lElbow.x, lElbow.y); ctx.lineTo(lHand.x, lHand.y); ctx.stroke();

                const rElbow = { x: 6 - s * 3, y: -8 + bob };
                const rHand  = { x: 11 - s * 4, y: -2 + bob };
                ctx.beginPath(); ctx.moveTo(shoulder.x, shoulder.y); ctx.lineTo(rElbow.x, rElbow.y); ctx.lineTo(rHand.x, rHand.y); ctx.stroke();

                const lKnee = { x: -3 + s * 5, y: 9 + bob };
                const lFoot = { x: -4 + s * 6, y: 18 + bob };
                ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(lKnee.x, lKnee.y); ctx.lineTo(lFoot.x, lFoot.y); ctx.stroke();

                const rKnee = { x: 3 - s * 5, y: 9 + bob };
                const rFoot = { x: 4 - s * 6, y: 18 + bob };
                ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(rKnee.x, rKnee.y); ctx.lineTo(rFoot.x, rFoot.y); ctx.stroke();

                // 关节点（使用 bodyColor）
                ctx.fillStyle = bodyColor;
                ctx.beginPath(); ctx.arc(lHand.x, lHand.y, 1.5, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(rHand.x, rHand.y, 1.5, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(lFoot.x, lFoot.y, 2, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(rFoot.x, rFoot.y, 2, 0, Math.PI * 2); ctx.fill();
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
            _renderPhaserSync(ctx, x, y, textureKey, options = {}) {
                const phaserScene = window.__phaserScene;
                if (!phaserScene) return false;

                const sprite = phaserScene.getOrCreateEnemySprite(this, textureKey);
                if (!this.active) {
                    sprite.setVisible(false);
                    return true;
                }

                // 火柴人模式：隐藏 Phaser sprite，由 Canvas 绘制火柴人
                if (this._useStickFigure) {
                    sprite.setVisible(false);
                    // 注意：不要 setActive(false)，否则 getOrCreateEnemySprite 会每帧重新创建 sprite
                    return false; // 返回 false 让 Canvas 继续渲染火柴人
                }

                const spriteSize = options.spriteSize !== undefined ? options.spriteSize : this.size * 3.5;
                const rotation = options.rotation !== undefined ? options.rotation : this.rotation + Math.PI / 2;
                const textOffsetY = options.textOffsetY !== undefined ? options.textOffsetY : -32;

                sprite.setPosition(
                    this.x + (options.offsetX || 0),
                    this.y + (options.offsetY || 0)
                );
                
                // 关键：设置 this.rotation 让 GameScene.update 同步正确旋转
                // GameScene.update 中: entity._phaserSprite.setRotation(entity.rotation + Math.PI/2)
                // 所以设置 this.rotation = options.rotation - Math.PI/2 即可让最终旋转 = options.rotation
                if (options.rotation !== undefined) {
                    this.rotation = options.rotation - Math.PI / 2;
                }
                // 不在这里设置 sprite.setRotation，由 GameScene.update 统一处理
                // 这样可以避免两个系统冲突
                
                if (options.frame !== undefined) {
                    // 只对 spritesheet 设置 frame（单张图片如 idle 不设置）
                    const texture = sprite.texture;
                    if (texture && texture.frameTotal > 1) {
                        sprite.setFrame(options.frame);
                    }
                }
                // 注意：flip 通过 setScale 负值实现，不单独调用 setFlipX/setFlipY
                // 避免 setScale 覆盖 flip 的符号导致双重翻转

                const sourceImage = sprite.texture.getSourceImage();
                const originalWidth = sprite.frame ? sprite.frame.width : (sourceImage ? sourceImage.width : 64);
                const baseScale = spriteSize / originalWidth;
                const contentScale = options.scale || 1;
                const scale = baseScale * contentScale;
                
                // 关键：setScale 会覆盖 flipX/flipY 的符号，所以必须在 setScale 后重新应用 flip
                // 或者直接在 scale 中考虑 flip 符号
                const scaleX = options.flipX ? -scale : scale;
                const scaleY = options.flipY ? -scale : scale;
                sprite.setScale(scaleX, scaleY);
                sprite.setVisible(true);
                
                // 同时保存到 _phaserSprite（兼容旧代码）
                this._phaserSprite = sprite;

                // 绘制名字和碰撞半径
                const nameColor = options.nameColor || 'rgba(212, 197, 169, 0.8)';
                ctx.fillStyle = nameColor;
                ctx.font = '12px SimHei, "Microsoft YaHei", "黑体", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(this.name, x, y + textOffsetY);
                this.renderCollisionRadius(ctx);

                return true;
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

            // Phaser 同步渲染方法（提取所有子类重复代码）
export { Enemy };
