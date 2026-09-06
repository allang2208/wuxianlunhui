import { beginFriendlyAttackClock, advanceFriendlyAttackClock } from '../combat/friendly-attack-timing.js';
import { canStartFriendlyMelee, lockFriendlyMelee, canHitFriendlyMelee } from '../combat/friendly-melee.js';
import { canMeleeReachTarget } from '../combat/melee-reach.js';
import { isFriendlyAttackTarget } from '../combat/friendly-projectile-sweep.js';
// ============================================================
// HamsterKnightAI — 仓鼠骑士（世界-122）
// - 最近敌人近战；不攻击能源矿点。
// - 普攻 31 帧 / 1.5 秒，第 16 帧结算 100 物理伤害，间隔 2 秒。
// - 持盾冲锋复用铠甲骑士：线性加速、追踪、不可穿墙、击退/眩晕/弹反语义；
//   伤害窗口、动画总时长与冷却均由具体兵种配置。
// ============================================================
import { MovementSystem } from '../systems/movement-system.js';
import { WallSystem } from '../world/wall-system.js';
import { SoundManager } from '../ui/sound-manager.js';
import { EffectFactory } from '../utils/effect-factory.js';
import { clearRtsSurfaceRoute, finishRtsCommandAtHold, getRtsAcquireRange, resolveRtsMoveDestination } from './rts-command-utils.js';
import { canFinishSurfaceFollow, canMeleeReachElevation } from './elevated-navigation-controller.js';
import { queryNearbyEntities, stableAiPhase } from './friendly-spatial-query.js';

export class HamsterKnightAI {
    constructor(knight) {
        this.m = knight;
        this.cfg = knight.aiConfig || {};
        this._decisionTimer = stableAiPhase(knight, this.cfg.decisionMs ?? 120);
        this._attackTimer = 0;
        this._attackInterval = this.cfg.attackInterval ?? 2000;
        this._attackDamage = this.cfg.attackDamage ?? 100;
        this._attackRange = this.cfg.attackRange ?? 55;
        this._engageRange = getRtsAcquireRange(knight);
        this._followOffset = this.cfg.followOffset ?? 155;
        this._followArriveDist = this.cfg.followArriveDist ?? 40;

        const attack = knight.animations?.attack || {};
        const attackFps = this.cfg.attackAnimFps ?? attack.frameRate ?? 12;
        const attackFrame = this.cfg.attackDamageFrame ?? 31;
        this._attackHitDelay = Math.max(0, (attackFrame - 1) / attackFps * 1000);
        this._attackAnimMs = (attack.frameCount ?? 61) / attackFps * 1000 + 60;
        this._swingActive = false;
        this._swingHitLeft = 0;
        this._swingAnimLeft = 0;

        this._chargeCooldown = 0;
        this._chargeActive = false;
        this._chargeTarget = null;
        this._chargeElapsed = 0;
        this._chargeTraveled = 0;
        this._chargeDamaged = false;
        this._chargeRecovering = false;
        this._chargeRecoverLeft = 0;
        this._chargeDustTimer = 0;
        this._prevNoCollision = false;
        this._baseParryImmune = !!knight._parryImmune;

        this._stuckTimer = 0;
        this._lastPosX = knight.x;
        this._lastPosY = knight.y;
        this._stuckStreak = 0;
    }

    cancelForCommand() {
        if (this._chargeActive) this._endCharge();
        this._swingActive = false;
        this._swingHitLeft = 0;
        this._swingAnimLeft = 0;
        this.m._attackSwing = false;
        this.m._chargeStart = false;
        this.m._animState = 'idle';
        this.m.vx = 0;
        this.m.vy = 0;
        this.m.isMoving = false;
        return true;
    }

    /** 眩晕、冻结或死亡中断：复用命令取消的完整临时态回收。 */
    cancelForCrowdControl() {
        return this.cancelForCommand();
    }

    onSurfaceSupportLost() {
        // 仅中止位移动作并恢复碰撞/弹反属性；已起手挥击仍由原流程收尾。
        if (this._chargeActive) this._endCharge();
    }

    update(dt, entities, player) {
        const m = this.m;
        if (m._dying || m.data.hp <= 0) return;

        this._attackTimer = Math.max(0, this._attackTimer - dt);
        this._chargeCooldown = Math.max(0, this._chargeCooldown - dt);

        if (this._chargeActive) {
            this._updateCharge(dt, entities);
            return;
        }
        if (this._swingActive) {
            this._updateSwing(dt);
            return;
        }

        if (MovementSystem.continueStairTransit(m, dt, entities)) return;
        this._decisionTimer -= dt;
        if (this._decisionTimer <= 0) {
            this._decisionTimer = this.cfg.decisionMs ?? 120;
            this._tick(entities, player);
        }
        if (this._chargeActive || this._swingActive) return;

        MovementSystem.update(m, dt, entities);
        this._checkStuck(dt);
        // 缓停滑行（maxSpeed=0 后速度沿摩擦/加速度渐近归零）期间保持 walk 动画，
        // 避免站着播 idle 却还在滑行的"滑冰"感
        if (m._animState === 'idle' && Math.hypot(m.vx || 0, m.vy || 0) > 25) {
            m._animState = 'walk';
        }
    }

    _tick(entities, player) {
        const m = this.m;
        const command = m._command;
        if (command?.mode && command.mode !== 'follow') {
            this._applyCommand(command);
            return;
        }

        const enemy = this._nearestEnemy(entities);
        if (enemy) {
            m.target = enemy;
            const distance = Math.hypot(enemy.x - m.x, enemy.y - m.y);
            const charge = this._chargeConfig();
            if (this._chargeCooldown <= 0 && !m.hasStatusEffect('bind')
                && canMeleeReachElevation(m, enemy)
                && distance > (charge.minTriggerRange ?? 0)
                && distance <= (charge.triggerRange ?? 550) + (enemy.groundRadius || 24)) {
                this._startCharge(enemy);
                return;
            }
            if (canStartFriendlyMelee(m, enemy, this._attackRange)) {
                m._tacticalTarget = null;
                m.rotation = Math.atan2(enemy.y - m.y, enemy.x - m.x);
                m._lastFaceRight = enemy.x >= m.x;
                if (this._attackTimer <= 0) this._startSwing(enemy);
                else this._stopAtTarget();
                return;
            }
            m._tacticalTarget = { x: enemy.x, y: enemy.y };
            m._animState = 'walk';
            m.maxSpeed = this.cfg.walkSpeed ?? 210;
            return;
        }

        m.target = null;
        this._followPlayer(player);
    }

    _applyCommand(command) {
        const m = this.m;
        if (command.mode !== 'move' && !m._surfaceNavCommand) clearRtsSurfaceRoute(m);
        if (command.mode === 'move') {
            m.target = null;
            const move = resolveRtsMoveDestination(m, command);
            if (!move.arrived) {
                m._tacticalTarget = move.destination;
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 210;
            } else {
                finishRtsCommandAtHold(m);
                clearRtsSurfaceRoute(m);
                this._stopAtTarget();
            }
            return;
        }
        if (command.mode === 'attack') {
            const target = command.target;
            if (!this._validEnemy(target)) {
                finishRtsCommandAtHold(m);
                m.target = null;
                this._stopAtTarget();
                return;
            }
            m.target = target;
            const distance = Math.hypot(target.x - m.x, target.y - m.y);
            const charge = this._chargeConfig();
            if (!command._guardFromHold && this._chargeCooldown <= 0 && !m.hasStatusEffect('bind')
                && canMeleeReachElevation(m, target)
                && distance > (charge.minTriggerRange ?? 0)
                && distance <= (charge.triggerRange ?? 550) + (target.groundRadius || 24)) {
                this._startCharge(target);
            } else if (canStartFriendlyMelee(m, target, this._attackRange)) {
                m.rotation = Math.atan2(target.y - m.y, target.x - m.x);
                m._lastFaceRight = target.x >= m.x;
                if (this._attackTimer <= 0) this._startSwing(target);
                else this._stopAtTarget();
            } else {
                m._tacticalTarget = { x: target.x, y: target.y };
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 210;
            }
            return;
        }
        m.target = null;
        this._stopAtTarget();
    }

    _followPlayer(player) {
        const m = this.m;
        if (!player) {
            this._stopAtTarget();
            return;
        }
        const target = { x: player.x - this._followOffset, y: player.y, _surfaceTarget: player };
        const dist = Math.hypot(target.x - m.x, target.y - m.y);
        if (dist <= this._followArriveDist && canFinishSurfaceFollow(m, player)) {
            this._stopAtTarget();
            return;
        }
        m._tacticalTarget = target;
        m._animState = 'walk';
        // 接近站位点缓出减速（120px 内速度随距离线性衰减，ease-out 到达）
        const walkSpeed = this.cfg.walkSpeed ?? 210;
        const slow = Math.min(1, dist / 120);
        m.maxSpeed = walkSpeed * Math.max(0.3, slow);
    }

    _stopAtTarget() {
        const m = this.m;
        m._tacticalTarget = null;
        m._animState = 'idle';
        m.maxSpeed = 0;
        // 速度不清零，由 MovementSystem 摩擦衰减缓停
        if (m._pathManager && typeof m._pathManager._clearPath === 'function') {
            m._pathManager._clearPath();
        }
    }

    _startSwing(target) {
        const m = this.m;
        this._attackTimer = this._attackInterval;
        this._swingActive = true;
        this._swingHitLeft = this._attackHitDelay;
        this._swingAnimLeft = this._attackAnimMs;
        beginFriendlyAttackClock(this, 'attack', this._attackAnimMs);
        lockFriendlyMelee(this, target);
        m.target = target;
        m._attackSwing = true;
        m._attackActionSeq = (m._attackActionSeq || 0) + 1;
        m._animState = 'attack';
        m.rotation = Math.atan2(target.y - m.y, target.x - m.x);
        m._lastFaceRight = target.x >= m.x;
        // 起挥不清零速度：交给 _updateSwing 的指数衰减平滑站定
        m.isMoving = false;
        m.maxSpeed = 0;
    }

    _updateSwing(dt) {
        const m = this.m;
        dt = advanceFriendlyAttackClock(m, dt);
        // 平滑站定：速度指数衰减（≈0.85/帧），代替瞬时清零的急停
        const damp = Math.pow(0.85, dt / 16.67);
        m.vx *= damp;
        m.vy *= damp;
        if (Math.abs(m.vx) < 1 && Math.abs(m.vy) < 1) { m.vx = 0; m.vy = 0; }
        m.isMoving = false;
        m.maxSpeed = 0;
        m._animState = 'attack';
        this._swingHitLeft -= dt;
        if (this._swingHitLeft <= 0) {
            this._swingHitLeft = Number.POSITIVE_INFINITY;
            this._dealNormalHit();
        }
        this._swingAnimLeft -= dt;
        if (this._swingAnimLeft <= 0) {
            this._swingActive = false;
            m._attackSwing = false;
            m._animState = 'idle';
        }
    }

    _dealNormalHit() {
        const m = this.m;
        const target = this._meleeTarget;
        if (!canHitFriendlyMelee(this, target)) return;
        target.takeDamage(m.getPhysicalAttackDamage(this._attackDamage, target), m, 'physical', true);
        this._playSound('attack');
    }

    _startCharge(target) {
        const m = this.m;
        if (m.isCombatActionBlocked() || m.hasStatusEffect('bind')) return;
        const cfg = this._chargeConfig();
        this._chargeCooldown = cfg.cooldown ?? 15000;
        this._chargeActive = true;
        this._chargeTarget = target;
        this._chargeElapsed = 0;
        this._chargeTraveled = 0;
        this._chargeDamaged = false;
        this._chargeRecovering = false;
        this._chargeRecoverLeft = 0;
        this._chargeDustTimer = 0;
        this._prevNoCollision = !!m.noCollision;
        m.noCollision = true;
        m._parryImmune = true;
        m._chargeStart = true;
        m._chargeActionSeq = (m._chargeActionSeq || 0) + 1;
        m._animState = 'charge';
        this._playSound('chargeStart');
        m._attackAnimTimer = cfg.maxDuration ?? 4500;
        if (target?.active) {
            m.rotation = Math.atan2(target.y - m.y, target.x - m.x);
            if (Math.abs(target.x - m.x) > 20) m._lastFaceRight = target.x >= m.x;
        }
        this._stopMotionOnly();
    }

    _updateCharge(dt, entities) {
        const m = this.m;
        const cfg = this._chargeConfig();
        m._surfaceInputIntent = null;
        if (m.hasStatusEffect('bind')) {
            this._endCharge();
            return;
        }
        if (this._chargeRecovering) {
            this._stopMotionOnly();
            this._chargeRecoverLeft -= dt;
            if (this._chargeRecoverLeft <= 0) this._endCharge();
            return;
        }
        const target = this._validEnemy(this._chargeTarget)
            ? this._chargeTarget
            : null;
        if (!target || !canMeleeReachElevation(m, target)) {
            // 目标下楼/坍塌后已换层：交还正常导航，不直冲旧平面的投影位置。
            this._endCharge();
            return;
        }
        const previousElapsed = this._chargeElapsed;
        this._chargeElapsed += dt;
        const accelProgress = Math.min(1, this._chargeElapsed / Math.max(1, cfg.accelDuration ?? 1500));
        const accelExponent = Math.max(0.1, Number(cfg.accelExponent) || 1);
        const easedProgress = Math.pow(accelProgress, accelExponent);
        const startSpeed = Math.max(0, Number(cfg.startSpeed) || 0);
        const maxSpeed = Math.max(startSpeed, Number(cfg.maxSpeed) || 700);
        const speed = startSpeed + (maxSpeed - startSpeed) * easedProgress;
        this._chargeDustTimer -= dt;
        if (this._chargeDustTimer <= 0 && speed > 0) {
            this._chargeDustTimer = 70;
            const backX = -Math.cos(m.rotation) * 12 + (Math.random() - 0.5) * 10;
            const backY = -Math.sin(m.rotation) * 12 + (Math.random() - 0.5) * 6;
            EffectFactory.createDustEffect(m.x + backX, m.y + backY + 10, 1.2);
        }

        if (target) {
            const dx = target.x - m.x;
            const dy = target.y - m.y;
            const distance = Math.hypot(dx, dy);
            if (distance > 0) {
                m.rotation = Math.atan2(dy, dx);
                if (Math.abs(dx) > 20) m._lastFaceRight = dx > 0;
                const contact = (m.groundRadius || 0) + (target.groundRadius || target.collisionRadius || 0);
                const elevated = WallSystem.usesElevatedMovement(m);
                const moveDt = elevated ? Math.min(dt, 34) : dt;
                if (elevated) m._surfaceInputIntent = { x: dx / distance, y: dy / distance };
                // 只限制位置积分；加速、命中窗口、冷却和动画仍使用真实dt。
                const step = Math.min(speed * moveDt / 1000, Math.max(0, distance - contact));
                const resolved = WallSystem.resolveEntityMove(
                    m,
                    m.x,
                    m.y,
                    m.x + dx / distance * step,
                    m.y + dy / distance * step,
                    m.groundRadius,
                    WallSystem.ignoreForEntity?.(m) || null
                );
                this._chargeTraveled += Math.hypot(resolved.x - m.x, resolved.y - m.y);
                m.x = resolved.x;
                m.y = resolved.y;
                m.collider?.syncPosition?.();
            }
        }

        const fps = cfg.frameRate ?? 24;
        const hitStart = ((cfg.hitStartFrame ?? 29) - 1) / fps * 1000;
        const hitEnd = (cfg.hitEndFrame ?? 44) / fps * 1000;
        const inHitWindow = this._chargeElapsed >= hitStart && previousElapsed <= hitEnd;
        if (!this._chargeDamaged && inHitWindow && this._validEnemy(target) && this._inRange(target, cfg.hitRange ?? 60)) {
            this._chargeDamaged = true;
            this._dealChargeHit(target, entities);
            if (cfg.completeAnimationAfterHit) {
                this._beginChargeRecovery(cfg);
                return;
            }
        }

        // 未命中也播完收势，保证待机→冲刺→攻击窗口→recover是完整单次动作。
        if (!this._chargeDamaged && cfg.completeAnimationAfterHit && this._chargeElapsed > hitEnd) {
            this._beginChargeRecovery(cfg);
            return;
        }

        if (this._chargeDamaged
            || this._chargeTraveled >= (cfg.maxDistance ?? 1800)
            || this._chargeElapsed >= (cfg.maxDuration ?? 4500)
            || !target
            || (this._chargeElapsed > hitEnd && this._inRange(target, cfg.hitRange ?? 60))) {
            this._endCharge();
        }
    }

    _beginChargeRecovery(cfg) {
        const animationMs = Math.max(0,
            (Number(cfg.frames) || 0) / Math.max(1, Number(cfg.frameRate) || 24) * 1000);
        this._chargeRecovering = true;
        this._chargeRecoverLeft = Math.max(0, animationMs - this._chargeElapsed);
        this._stopMotionOnly();
        if (this._chargeRecoverLeft <= 0) this._endCharge();
    }

    _dealChargeHit(target, entities) {
        const cfg = this._chargeConfig();
        const upgradeMult = Math.max(0, Number(this.cfg.chargeDamageMult) || 1);
        const result = target.takeDamage(
            this.m.getPhysicalAttackDamage(
                this._attackDamage * (cfg.damageMul ?? 2) * upgradeMult,
                target
            ),
            this.m,
            'physical',
            true,
        );
        const parried = result?.parried === true;
        const angle = Math.atan2(target.y - this.m.y, target.x - this.m.x);
        if (!parried && typeof target.applyKnockback === 'function') target.applyKnockback(angle, cfg.knockback ?? 200);
        if (!parried && typeof target.applyStun === 'function') {
            const lordMultiplier = target.rank === 'lord'
                ? Math.max(0, Number(cfg.lordStunDurationMultiplier) || 0.25)
                : 1;
            // 共享状态表会刷新既有眩晕而不叠加连续冲锋的时长。
            target.applyStun((cfg.stunMs ?? 2500) * lordMultiplier);
        }
        if (typeof this.m.onChargeImpact === 'function') {
            this.m.onChargeImpact({
                target,
                entities,
                chargeConfig: cfg,
                attackDamage: this._attackDamage,
                upgradeMult,
                parried,
            });
        }
    }

    _endCharge() {
        const m = this.m;
        this._chargeActive = false;
        this._chargeTarget = null;
        this._chargeTraveled = 0;
        this._chargeDamaged = false;
        this._chargeRecovering = false;
        this._chargeRecoverLeft = 0;
        m._parryImmune = this._baseParryImmune;
        m.noCollision = this._prevNoCollision;
        m._chargeStart = false;
        m._attackAnimTimer = 0;
        m._surfaceInputIntent = null;
        m._animState = 'idle';
        this._stopMotionOnly();
    }

    _chargeConfig() {
        return this.cfg.charge || {};
    }

    _nearestEnemy(entities) {
        let best = null;
        let bestDistance = Infinity;
        const iterable = queryNearbyEntities(entities, this.m, this._engageRange);
        for (const entity of iterable) {
            if (!this._validEnemy(entity)) continue;
            const distance = Math.hypot(entity.x - this.m.x, entity.y - this.m.y);
            if (distance < bestDistance && distance <= this._engageRange) {
                best = entity;
                bestDistance = distance;
            }
        }
        return best;
    }

    _validEnemy(entity) {
        return isFriendlyAttackTarget(entity);
    }

    _inRange(target, range) {
        if (!target) return false;
        const targetRadius = target.groundRadius || target.collisionRadius || target.size * 0.6 || 0;
        return canMeleeReachTarget(this.m, target)
            && Math.hypot(target.x - this.m.x, target.y - this.m.y) <= range + targetRadius;
    }

    _playSound(key) {
        const path = this.m.sounds?.[key];
        if (!path || !SoundManager) return;
        if (typeof SoundManager.playWorld === 'function') SoundManager.playWorld(path, this.m.x, this.m.y);
        else if (typeof SoundManager.playFile === 'function') SoundManager.playFile(path);
    }

    _stopMotionOnly() {
        this.m.vx = 0;
        this.m.vy = 0;
        this.m.isMoving = false;
        this.m.maxSpeed = 0;
    }

    _checkStuck(dt) {
        const m = this.m;
        if (m._surfaceNavWaiting || m._surfaceRouteActive
            || m._surfaceKind === 'stairs' || m._surfaceKind === 'wall_walk') {
            this._stuckTimer = 0;
            this._stuckStreak = 0;
            this._lastPosX = m.x;
            this._lastPosY = m.y;
            return;
        }
        if (m._animState !== 'walk') {
            this._stuckTimer = 0;
            this._lastPosX = m.x;
            this._lastPosY = m.y;
            return;
        }
        this._stuckTimer += dt;
        if (this._stuckTimer < 500) return;
        this._stuckTimer = 0;
        const moved = Math.hypot(m.x - this._lastPosX, m.y - this._lastPosY);
        this._lastPosX = m.x;
        this._lastPosY = m.y;
        if (moved > 3) {
            this._stuckStreak = 0;
            return;
        }
        this._stuckStreak++;
        if (this._stuckStreak < 2) return;
        this._stuckStreak = 0;
        // 不再使用 findSafeSpawn 改写运行中坐标；保留目标，让统一寻路重新规划。
        m._pathManager?._clearPath?.();
    }
}
