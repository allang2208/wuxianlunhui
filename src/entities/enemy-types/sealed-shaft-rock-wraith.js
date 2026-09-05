import { attackFrameAt, attackFrameStartMs } from './_shared/attack-timing.js';
import { canMeleeShareSurface } from '../../combat/melee-surface.js';
import { hasAttackLineOfSight } from '../../combat/melee-reach.js';
import { canStartGroundSkill } from './_shared/attack-shapes.js';
import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { DamagePipeline } from '../../combat/damage-pipeline.js';
import {
    straightMotionWasBlocked,
    sweptMotionMeleeHits,
} from '../../combat/motion-melee-sweep.js';
import { isFriendlyFire } from '../damageable-entity.js';
import { PartySystem } from '../../systems/party-system.js';
import { distanceToEntityShape } from '../../utils/collision-helpers.js';
import { GroundDirectedRect, GroundEllipse } from '../../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../../physics/elevation.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { WallSystem } from '../../world/wall-system.js';

/**
 * 封井岩魇（废弃矿洞专属领主）
 *
 * 晶臂砸击负责近距压制，岩脉震荡负责贴身范围控制。钻头旋冲会先在
 * 原地高速旋转蓄势，再沿起手时锁定的方向冲锋；位移只消费墙体解析后的
 * 实际轨迹，命中、撞墙或到达最大距离都会停止移动，但保留完整动作后摇。
 */
export class SealedShaftRockWraith extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.sealedShaftRockWraith,
            showWeapon: false,
            ...config,
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        this._usesDirectedBasicMelee = true;

        this._animState = 'idle';
        this._animStateTimer = 0;
        this._heldVisualFrame = null;
        this._action = null;
        this._actionCfg = null;
        this._actionDuration = 0;
        this._actionTimer = 0;
        this._actionTarget = null;
        this._actionSnapshot = null;
        this._actionHitDone = false;
        this._lastEntities = null;
        this._cooldowns = {
            borequake: Math.max(0, Number(this._skill('borequake').initialCooldownMs) || 0),
            drillRush: Math.max(0, Number(this._skill('drillRush').initialCooldownMs) || 0),
        };

        this._chargePhase = 'idle';
        this._chargeDir = { x: 1, y: 0 };
        this._chargeTraveled = 0;
        this._chargeStopped = true;
        this._chargeRecoveryAt = null;
        this._prevNoCollision = this.noCollision;

        this._preserveCorpse = true;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._syncApproachProfile();
        this._syncVisualMetrics();
    }

    _skill(key) {
        return this.config?.attackSkills?.[key] || {};
    }

    _layout(key = this._animState) {
        const layouts = this.config?.textures?.frameLayouts || {};
        return layouts[key] || layouts.idle || {
            frameWidth: 254,
            frameHeight: 412,
            frameCount: 1,
            footY: 406,
            authoredBodyHeight: 390,
        };
    }

    _syncApproachProfile() {
        const smash = this._skill('crystalArmSmash');
        const borequake = this._skill('borequake');
        const rush = this._skill('drillRush');
        const distance = this.target
            ? distanceToEntityShape(this.target, this.collider?.x ?? this.x, this.collider?.y ?? this.y)
            : Infinity;
        let reach = Number(smash.approachReach) || 250;
        if ((this._cooldowns?.borequake || 0) <= 0) {
            reach = Math.max(reach, Number(borequake.triggerRange) || 320);
        }
        if ((this._cooldowns?.drillRush || 0) <= 0
            && distance >= (Number(rush.minTriggerRange) || 260)) {
            reach = Math.max(reach, Number(rush.triggerRange) || 760);
        }
        this.attackRange = reach;
        this.attackDistance = reach;
        this.config.basicMelee = {
            ...(this.config.basicMelee || {}),
            approachReach: reach,
            impactReach: reach,
            width: Number(smash.width) || 170,
            requiresSameSurface: true,
            requiresLosAtImpact: true,
        };
        const attack = this.attacks?.melee;
        if (!attack) return;
        attack.config.range = reach;
        attack.config.dynamicRange = reach;
        attack.range = reach;
        attack.maxCooldown = Number(smash.cooldown) || 3400;
        attack.baseMaxCooldown = attack.maxCooldown;
    }

    update(dt, entities) {
        const delta = Math.max(0, Number(dt) || 0);
        if (!this.active) {
            this._updateDeathSequence(delta);
            return;
        }

        this._lastEntities = entities;
        // 控制可能在本帧基础更新中到期，先取消旧动作，避免解控后补打。
        if (this._action && this._isActionControlled()) {
            this._finishAction(this._holdsFrozenPose());
        }
        super.update(delta, entities);
        // 基类的持续伤害可能在此帧触发死亡，不能再覆盖 dying 状态。
        if (!this.active) return;
        const cooldownDt = typeof this.getAttackIntervalDelta === 'function'
            ? this.getAttackIntervalDelta(delta)
            : delta;
        this._cooldowns.borequake = Math.max(0, this._cooldowns.borequake - cooldownDt);
        this._cooldowns.drillRush = Math.max(0, this._cooldowns.drillRush - cooldownDt);

        if (this._action) {
            if (this._isActionControlled()) this._finishAction(this._holdsFrozenPose());
            else this._updateAction(delta);
            return;
        }
        if (this._holdsFrozenPose()) return;
        if (this._heldVisualFrame !== null) this._setVisualState('idle');

        this._frozenForCast = false;
        this._attackAnimTimer = 0;
        this._syncApproachProfile();
        const speed = Math.hypot(this.vx, this.vy);
        const next = speed > (this.maxSpeed || this.speed || 145) * 0.05 ? 'walking' : 'idle';
        this._animStateTimer += delta;
        if (next !== this._animState && this._animStateTimer >= 80) {
            this._setVisualState(next);
        }
        if (speed > 0.1) this.rotation = Math.atan2(this.vy, this.vx);
    }

    _selectAttackAction(target) {
        if (this._action || this.isCombatActionBlocked() || !this._isValidTarget(target)
            || !canMeleeShareSurface(this, target)) return null;
        const distance = distanceToEntityShape(target, this.collider?.x ?? this.x, this.collider?.y ?? this.y);
        const quake = this._skill('borequake'), rush = this._skill('drillRush'), smash = this._skill('crystalArmSmash');
        if (this._cooldowns.borequake <= 0
            && canStartGroundSkill(this, target, { kind: 'ellipse', radiusX: quake.radiusX || 340, radiusY: quake.radiusY || 190 })) return 'borequake';
        // 冲刺沿屏幕世界坐标位移，保持原移动射程。
        if (!this.hasStatusEffect('bind') && this._cooldowns.drillRush <= 0 && distance >= (rush.minTriggerRange || 260)
            && distance <= (rush.triggerRange || 760) && hasAttackLineOfSight(this, target)) return 'drillRush';
        if (canStartGroundSkill(this, target, { range: Math.min(smash.approachReach || 250, smash.range || 275), width: smash.width || 170 })) return 'crystalArmSmash';
        return null;
    }

    triggerWeaponAnim() {
        const pending = this._pendingThrust?.active ? this._pendingThrust : null;
        const target = pending?.primaryTarget || this.target;
        const action = this._selectAttackAction(target);
        if (pending) pending.active = false;
        if (!action) return false;
        return this._startAction(action, target);
    }

    _startAction(action, target) {
        if (action === 'drillRush' && this.hasStatusEffect('bind')) return false;
        const cfg = this._skill(action);
        const sourceX = this.collider?.x ?? this.x;
        const sourceY = this.collider?.y ?? this.y;
        const targetX = target.collider?.x ?? target.x;
        const targetY = target.collider?.y ?? target.y;
        const dx = targetX - sourceX;
        const dy = targetY - sourceY;
        const worldAngle = Math.atan2(dy, dx);
        const groundAngle = Math.atan2(dy / PERSPECTIVE_SCALE_Y, dx);
        const duration = Math.max(1, Number(cfg.duration ?? this.config?.textures?.frameLayouts?.[action]?.duration)
            || enemyConfigData.sealedShaftRockWraith.attackSkills[action].duration);

        this._action = action;
        this._actionCfg = cfg;
        this._actionDuration = duration;
        this._actionTimer = duration;
        this._actionTarget = target;
        this._actionSnapshot = { sourceX, sourceY, worldAngle, groundAngle };
        this._actionHitDone = false;
        this._setVisualState(action);
        this._frozenForCast = true;
        this._attackAnimTimer = duration;
        this.rotation = worldAngle;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;

        if (action === 'borequake') {
            this._cooldowns.borequake = Math.max(0, Number(cfg.cooldown) || 12000);
        } else if (action === 'drillRush') {
            this._cooldowns.drillRush = Math.max(0, Number(cfg.cooldown) || 15000);
            this._chargePhase = 'prepare';
            this._chargeDir = { x: Math.cos(worldAngle), y: Math.sin(worldAngle) };
            this._chargeTraveled = 0;
            this._chargeStopped = false;
            this._chargeRecoveryAt = null;
            this._prevNoCollision = this.noCollision;
        }
        return true;
    }

    _updateAction(dt) {
        const snapshot = this._actionSnapshot;
        const previous = this._actionTimer;
        this._actionTimer = Math.max(0, previous - dt);
        this._attackAnimTimer = this._actionTimer;
        this._frozenForCast = true;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        if (this._actionSnapshot) this.rotation = this._actionSnapshot.worldAngle;

        const elapsedBefore = this._actionDuration - previous;
        const elapsedAfter = this._actionDuration - this._actionTimer;
        if (this._action === 'drillRush') {
            this._updateDrillRushMotion(elapsedBefore, elapsedAfter);
        } else {
            const hitFrame = Number(
                this._actionCfg?.contactFrame
                ?? this._actionCfg?.releaseFrame
                ?? this._actionCfg?.impactFrame
                ?? 0
            );
            const hitMs = attackFrameStartMs(this._layout(), hitFrame, this._actionDuration);
            if (!this._actionHitDone && elapsedBefore <= hitMs && elapsedAfter >= hitMs) {
                this._actionHitDone = true;
                this._resolveActionHit();
            }
        }
        // 弹反/反伤可在命中回调中取消动作或杀死施放者。
        if (!this.active || this._actionSnapshot !== snapshot) return;
        if (this._actionTimer <= 0) this._finishAction();
    }

    _updateDrillRushMotion(elapsedBefore, elapsedAfter) {
        if (this.hasStatusEffect('bind')) {
            this._stopChargeMotion();
            return;
        }
        const cfg = this._actionCfg || {};
        const prepareMs = Math.max(0, Number(cfg.prepareMs) || 900);
        const chargeMs = Math.max(1, Number(cfg.chargeMs) || 1100);
        const chargeEndMs = prepareMs + chargeMs;
        if (this._chargeStopped || elapsedAfter <= prepareMs || elapsedBefore >= chargeEndMs) {
            if (!this._chargeStopped && elapsedBefore >= chargeEndMs) this._stopChargeMotion();
            return;
        }

        if (this._chargePhase === 'prepare') {
            this._chargePhase = 'charge';
            this.noCollision = true;
        }

        const activeFrom = Math.max(elapsedBefore, prepareMs);
        const activeTo = Math.min(elapsedAfter, chargeEndMs);
        const activeMs = Math.max(0, activeTo - activeFrom);
        const maxDistance = Math.max(1, Number(cfg.maxDistance) || 760);
        const remaining = Math.max(0, maxDistance - this._chargeTraveled);
        const step = Math.min(remaining, maxDistance * activeMs / chargeMs);
        if (step <= 0) {
            this._stopChargeMotion();
            return;
        }

        const fromX = this.x;
        const fromY = this.y;
        const intendedX = fromX + this._chargeDir.x * step;
        const intendedY = fromY + this._chargeDir.y * step;
        const resolved = WallSystem.resolve(
            fromX, fromY, intendedX, intendedY, this.groundRadius
        );
        this.x = resolved.x;
        this.y = resolved.y;
        this._chargeTraveled += Math.hypot(this.x - fromX, this.y - fromY);
        const blocked = straightMotionWasBlocked(
            fromX, fromY, intendedX, intendedY, this.x, this.y
        );

        const snapshot = this._actionSnapshot;
        const target = this._actionTarget;
        if (!this._actionHitDone && this._isValidTarget(target)
            && sweptMotionMeleeHits(
                this,
                target,
                fromX,
                fromY,
                this.x,
                this.y,
                Math.max(0, Number(cfg.sweepWidth) || 135) * 0.5,
                { blocked, skill: '封井岩魇钻头旋冲' }
            )) {
            this._actionHitDone = true;
            this._resolveDrillRushHit(target);
        }
        if (!this.active || this._actionSnapshot !== snapshot) return;

        if (this._actionHitDone || blocked || this._chargeTraveled >= maxDistance
            || elapsedAfter >= chargeEndMs) {
            this._stopChargeMotion();
        }
    }

    _resolveActionHit() {
        if (this._action === 'crystalArmSmash') this._resolveCrystalArmSmash();
        else if (this._action === 'borequake') this._resolveBorequake();
    }

    _resolveCrystalArmSmash() {
        const cfg = this._actionCfg || {};
        const snap = this._actionSnapshot;
        if (!snap) return;
        const shape = new GroundDirectedRect(
            snap.sourceX,
            snap.sourceY,
            snap.groundAngle,
            Math.max(1, Number(cfg.range) || 275),
            Math.max(1, Number(cfg.width) || 170),
            0,
            surfaceEffectFromEntity(this)
        );
        this._damageTargetsInShape(
            shape,
            cfg,
            'sealedShaftCrystalArmSmash',
            snap.sourceX,
            snap.sourceY,
            (target) => {
                if (Number(cfg.crippleMs) > 0) target.applyCripple?.(Number(cfg.crippleMs));
            },
            true
        );
    }

    _resolveBorequake() {
        const cfg = this._actionCfg || {};
        const snap = this._actionSnapshot;
        if (!snap) return;
        const shape = new GroundEllipse(
            snap.sourceX,
            snap.sourceY,
            Math.max(1, Number(cfg.radiusX) || 340),
            Math.max(1, Number(cfg.radiusY) || 190),
            surfaceEffectFromEntity(this)
        );
        this._damageTargetsInShape(
            shape,
            cfg,
            'sealedShaftBorequake',
            snap.sourceX,
            snap.sourceY,
            (target) => {
                if (Number(cfg.slowMs) > 0) target.applyCripple?.(Number(cfg.slowMs));
            },
            false
        );
    }

    _resolveDrillRushHit(target) {
        const cfg = this._actionCfg || {};
        const snapshot = this._actionSnapshot;
        const result = DamagePipeline.applyHit(this, target, {
            damage: this._scaledDamage(cfg),
            damageType: cfg.damageType || 'physical',
            knockback: 0,
            angle: this._actionSnapshot?.worldAngle ?? this.rotation,
            isMelee: true,
            confirmedHitContext: { skillId: 'sealedShaftDrillRush' },
        });
        if (!result.hit || !this.active || this._actionSnapshot !== snapshot) return;
        const parried = result.parried;
        if (parried) return;
        const angle = this._actionSnapshot?.worldAngle ?? this.rotation;
        const knockback = Math.max(0, Number(cfg.knockback) || 240);
        if (knockback > 0) target.applyKnockback?.(angle, knockback);
        const stunMs = Math.max(0, Number(cfg.stunMs) || 1800);
        if (stunMs > 0) target.applyStun?.(stunMs);
    }

    _damageTargetsInShape(shape, cfg, skillId, originX, originY, afterHit, isMelee) {
        const snapshot = this._actionSnapshot;
        for (const target of this._collectTargets()) {
            if (this.isCombatActionBlocked() || this._actionSnapshot !== snapshot) break;
            if (!this._isValidTarget(target) || !shape.intersectsEntity(target)) continue;
            if (this._isWallBlocked(target, originX, originY)) continue;
            const tx = target.collider?.x ?? target.x;
            const ty = target.collider?.y ?? target.y;
            const angle = Math.atan2(ty - originY, tx - originX);
            const result = DamagePipeline.applyHit(this, target, {
                damage: this._scaledDamage(cfg),
                damageType: cfg.damageType || 'physical',
                knockback: 0,
                angle,
                isMelee,
                confirmedHitContext: { skillId },
            });
            if (this.isCombatActionBlocked() || this._actionSnapshot !== snapshot) break;
            if (!result.hit || !target.active || target._isDead) continue;
            const parried = result.parried;
            if (!parried) {
                const knockback = Math.max(0, Number(cfg.knockback) || 0);
                if (knockback > 0) target.applyKnockback?.(angle, knockback);
                afterHit?.(target);
            }
        }
    }

    _scaledDamage(cfg) {
        const base = cfg.damageType === 'magic'
            ? (Number(this.data?.matk) || Number(this.data?.int) || 1)
            : (Number(this.data?.atk) || 1);
        return Math.max(1, Math.round(base * Math.max(0, Number(cfg.damageMul) || 1)));
    }

    _collectTargets() {
        const supplied = this._lastEntities?.values
            ? this._lastEntities.values()
            : (this._lastEntities || []);
        const targets = new Set(supplied);
        for (const member of PartySystem.members || []) targets.add(member);
        const friendlies = (typeof window !== 'undefined' && window.Game?.friendlyUnits) || [];
        for (const friendly of friendlies) targets.add(friendly);
        return targets;
    }

    _isValidTarget(target) {
        return !!target && target !== this && target.active && !target._isDead
            && target.hittable !== false && target.hp > 0
            && target._faction !== 'enemy' && !isFriendlyFire(this, target);
    }

    _isWallBlocked(target, originX, originY) {
        return !hasAttackLineOfSight(this, target, originX, originY);
    }

    _stopChargeMotion() {
        if (this._chargeStopped) return;
        this._chargeStopped = true;
        this._chargePhase = 'recovery';
        const cfg = this._actionCfg || {};
        const prepareMs = Math.max(0, Number(cfg.prepareMs) || 900);
        const chargeMs = Math.max(1, Number(cfg.chargeMs) || 1100);
        const recoveryMs = Math.max(1, this._actionDuration - prepareMs - chargeMs);
        // 提前命中/撞墙后跳过未用的冲锋时间，完整收势一次，不在末帧补等。
        this._chargeRecoveryAt = this._actionDuration - recoveryMs;
        if (this._action === 'drillRush') {
            this._actionTimer = Math.min(this._actionTimer, recoveryMs);
            this._attackAnimTimer = this._actionTimer;
        }
        this.noCollision = this._prevNoCollision;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
    }

    _finishAction(preservePose = false) {
        const heldFrame = preservePose ? this._getVisualFrame() : null;
        this._stopChargeMotion();
        this._chargePhase = 'idle';
        this._chargeTraveled = 0;
        this._chargeStopped = true;
        this._chargeRecoveryAt = null;
        this._action = null;
        this._actionCfg = null;
        this._actionDuration = 0;
        this._actionTimer = 0;
        this._actionTarget = null;
        this._actionSnapshot = null;
        this._actionHitDone = false;
        this._attackAnimTimer = 0;
        this._frozenForCast = false;
        if (preservePose) this._heldVisualFrame = heldFrame;
        else this._setVisualState('idle');
        this.aiTimer = 0;
        this._syncApproachProfile();
    }

    _holdsFrozenPose() {
        return this.hasStatusEffect?.('petrified') || this.hasStatusEffect?.('frozen');
    }

    _isActionControlled() {
        return this._dashStunned || this._holdsFrozenPose()
            || this.hasStatusEffect?.('stun') || this.hasStatusEffect?.('fear');
    }

    _onCombatActionInterruptedByControl() {
        if (this._action) this._finishAction(this._holdsFrozenPose());
        super._onCombatActionInterruptedByControl();
    }

    _enterStunnedIdleAnimation() {
        if (this.active && !this._holdsFrozenPose()) this._setVisualState('idle');
    }

    updateWhilePetrified(dt) {
        if (this._action) this._finishAction(true);
        super.updateWhilePetrified(dt);
    }

    onDeath(source) {
        if (!this.active) return;
        this._finishAction();
        this.active = false;
        // 死亡后不再推进状态计时；解除渲染冻结，确保死亡帧能继续播放。
        this.removeStatusEffect('petrified');
        this.removeStatusEffect('frozen');
        this._freezeStacks = 0;
        this._freezeTimer = 0;
        const death = this.config?.death || {};
        this._deathAnimTimer = Math.max(1, Number(death.animMs) || 3417);
        this._corpseTimer = Math.max(0, Number(death.holdMs ?? 1600));
        this._fadeTimer = Math.max(0, Number(death.fadeMs ?? 300));
        this._setVisualState('dying');
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        // 通用墙钟3秒会截断3417ms死亡动作；由尸体的游戏时钟完成后释放。
        this._deathRemoveDelay = Infinity;
        if (typeof super.onDeath === 'function') super.onDeath(source);
    }

    _updateDeathSequence(dt) {
        let remaining = dt;
        for (const timer of ['_deathAnimTimer', '_corpseTimer', '_fadeTimer']) {
            const consumed = Math.min(this[timer], remaining);
            this[timer] -= consumed;
            remaining -= consumed;
        }
        if (this._deathAnimTimer + this._corpseTimer + this._fadeTimer <= 0) {
            this._phaserSprite?.destroy();
            this._phaserSprite = null;
            this._deathRemoveDelay = 0;
        }
    }

    _getTextureKey() {
        return `enemy_sealed_shaft_rock_wraith_${this._animState}`;
    }

    _setVisualState(state) {
        this._animState = state;
        this._animStateTimer = 0;
        this._heldVisualFrame = null;
        // 场景先定位再选纹理；换动作时提前更新脚线，不沿用上一张表的偏移。
        this._syncVisualMetrics();
    }

    _getVisualFrame() {
        if (this._heldVisualFrame !== null) return this._heldVisualFrame;
        const layout = this._layout();
        const count = Math.max(1, Number(layout.frameCount) || 1);
        if (this._animState === 'dying') {
            const duration = Math.max(1, Number(this.config?.death?.animMs) || 3417);
            return Math.min(count - 1, Math.floor((duration - this._deathAnimTimer) / duration * count));
        }
        if (this._action) {
            const elapsed = this._actionDuration - this._actionTimer;
            if (this._action === 'drillRush') return this._getDrillRushFrame(elapsed, count);
            return attackFrameAt(layout, elapsed, this._actionDuration);
        }
        const frameRate = Math.max(1, Number(layout.frameRate) || 12);
        return Math.floor(this._animStateTimer * frameRate / 1000) % count;
    }

    _getDrillRushFrame(elapsed, count) {
        const cfg = this._actionCfg || {};
        const start = Math.min(count - 1, Math.max(0, Number(cfg.chargeStartFrame) || 18));
        const end = Math.min(count - 1, Math.max(start, Number(cfg.chargeEndFrame) || 49));
        const prepareMs = Math.max(0, Number(cfg.prepareMs) || 900);
        const chargeMs = Math.max(1, Number(cfg.chargeMs) || 1100);
        const recoveryAt = this._chargeRecoveryAt ?? (prepareMs + chargeMs);
        if (elapsed >= recoveryAt) {
            const first = Math.min(count - 1, end + 1);
            const recoveryMs = Math.max(1, this._actionDuration - prepareMs - chargeMs);
            return Math.min(count - 1,
                first + Math.floor((elapsed - recoveryAt) / recoveryMs * (count - first)));
        }
        if (elapsed < prepareMs) {
            return Math.max(0, Math.min(start - 1, Math.floor(elapsed / prepareMs * start)));
        }
        // 源视频的完整奔跑段压入实际冲锋窗口；撞墙/命中则立即进入收势。
        return Math.min(end, start + Math.floor((elapsed - prepareMs) / chargeMs * (end - start + 1)));
    }

    _syncVisualMetrics() {
        const render = this.config?.render || {};
        const layout = this._layout();
        const targetBodyHeight = Math.max(1, Number(render.bodyDisplayHeight) || 260);
        const authoredBodyHeight = Math.max(1, Number(layout.authoredBodyHeight) || 390);
        const pixelScale = targetBodyHeight / authoredBodyHeight;
        const frameWidth = Math.max(1, Number(layout.frameWidth) || 254);
        const frameHeight = Math.max(1, Number(layout.frameHeight) || 412);
        this._visualSpriteSize = Math.max(frameWidth, frameHeight) * pixelScale;
        const footY = Number.isFinite(Number(layout.footY)) ? Number(layout.footY) : frameHeight;
        this.footOffsetY = (footY - frameHeight / 2) * pixelScale;
    }

    _syncPetrifiedBodyAnchor(sprite) {
        const state = sprite.texture?.key?.replace('enemy_sealed_shaft_rock_wraith_', '');
        const layout = this.config?.textures?.frameLayouts?.[state];
        if (!layout) return;
        sprite.y += this.footOffsetY
            - (layout.footY - layout.frameHeight / 2) * Math.abs(sprite.scaleY);
    }

    _getPhaserOptions() {
        const render = this.config?.render || {};
        this._syncVisualMetrics();

        let flipX = false;
        if (this._actionSnapshot) flipX = Math.cos(this._actionSnapshot.worldAngle) < 0;
        else if (this.isMoving && Math.abs(this.vx) > 0.1) flipX = this.vx < 0;
        else flipX = Math.cos(this.rotation || 0) < 0;

        const fadeMs = Math.max(1, Number(this.config?.death?.fadeMs ?? 300));
        const alpha = this.active || this._deathAnimTimer > 0 || this._corpseTimer > 0
            ? 1 : Math.max(0, this._fadeTimer / fadeMs);
        return {
            spriteSize: this._visualSpriteSize,
            frame: this._getVisualFrame(),
            manualFrame: true,
            alpha,
            collisionWidth: Number(render.collisionWidth) || 124,
            collisionHeight: Number(render.collisionHeight) || 235,
            textOffsetY: -(Number(render.collisionHeight) || 235) - 18,
            flipX,
            // 统一用实体时钟：离屏或晚加载后恢复当前帧，不再从头播放攻击/死亡。
            animState: undefined,
            animKey: `enemy_sealed_shaft_rock_wraith_${this._animState}`,
            dynamicSpriteSize: true,
        };
    }
}
