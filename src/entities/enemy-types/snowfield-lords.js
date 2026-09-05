import { attackFrameAt, attackFrameStartMs } from './_shared/attack-timing.js';
import { canMeleeShareSurface } from '../../combat/melee-surface.js';
import { hasAttackLineOfSight } from '../../combat/melee-reach.js';
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
import { GroundDirectedRect, GroundEllipse, GroundSector } from '../../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../../physics/elevation.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { WallSystem } from '../../world/wall-system.js';
import { AttackRangeEffect } from '../../effects/attack-range-effect.js';
import { EffectManager } from '../../effects/effect-manager.js';
import {
    createGroundWarning,
    destroyWarning,
    fireGroundShockwave,
    keepWarningAlive,
    spawnRailgunBeam,
} from '../../effects/combat-fx.js';

const TAU = Math.PI * 2;

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function entityPoint(entity) {
    return {
        x: finite(entity?.collider?.x, finite(entity?.x)),
        y: finite(entity?.collider?.y, finite(entity?.y)),
    };
}

function groundPoint(x, y, angle, distance) {
    return {
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance * PERSPECTIVE_SCALE_Y,
    };
}

class FrostTrailEffect {
    constructor(x, y, radius, duration) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.life = duration;
        this.maxLife = duration;
        this.active = true;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        this._graphics = scene?.add?.graphics?.() || null;
        this._graphics?.setDepth(y - 998);
        if (this._graphics && scene?.worldEffectsGroup) scene.worldEffectsGroup.add(this._graphics);
    }

    getFogVisuals() {
        return this._graphics;
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            this._graphics?.destroy?.();
            this._graphics = null;
            return;
        }
        if (!this._graphics?.active) return;
        const alpha = Math.min(0.34, Math.max(0.06, this.life / this.maxLife * 0.34));
        this._graphics.clear();
        this._graphics.fillStyle(0x74d9ee, alpha);
        this._graphics.lineStyle(2, 0xc8f7ff, Math.min(0.72, alpha * 2));
        this._graphics.fillEllipse(
            this.x, this.y, this.radius * 2, this.radius * 2 * PERSPECTIVE_SCALE_Y
        );
        this._graphics.strokeEllipse(
            this.x, this.y, this.radius * 2, this.radius * 2 * PERSPECTIVE_SCALE_Y
        );
    }
}

/**
 * 三只雪原领主共用的动作时钟、目标锁定、命中和视觉合同。
 * 每个伤害事件只消费正式动作表的 0-based 帧号；动作被控制打断后，警示和延迟命中一并取消。
 */
class SnowfieldLordBase extends Enemy {
    constructor(x, y, config, { texturePrefix, locomotionState }) {
        super(x, y, { ...config, showWeapon: false });
        this._useStickFigure = false;
        this._usePacingAI = false;
        this._usesDirectedBasicMelee = true;

        this._texturePrefix = texturePrefix;
        this._locomotionState = locomotionState;
        this._animState = locomotionState;
        this._animStateTimer = 0;
        this._heldVisualFrame = null;

        this._action = null;
        this._actionCfg = null;
        this._actionDuration = 0;
        this._actionTimer = 0;
        this._actionTarget = null;
        this._actionSnapshot = null;
        this._actionInstance = 0;
        this._firedFrames = new Set();
        this._hitCounts = new Map();
        this._cooldowns = {};
        this._lastEntities = null;
        this._warnings = new Set();
        this._rangeWarnings = new Set();

        this._syncVisualMetrics();
    }

    _skill(key) {
        return this.config?.attackSkills?.[key] || {};
    }

    _visualStateForAction(action) {
        return this._skill(action).animationState || action;
    }

    _layout(key = this._animState) {
        const layouts = this.config?.textures?.frameLayouts || {};
        return layouts[key] || layouts[this._locomotionState] || {
            frameWidth: 256,
            frameHeight: 256,
            frameCount: 1,
            footX: 128,
            footY: 240,
            authoredBodyHeight: 220,
            duration: 1000,
        };
    }

    _initCooldowns(keys) {
        for (const key of keys) {
            this._cooldowns[key] = Math.max(0, finite(this._skill(key).initialCooldownMs));
        }
    }

    _cooldownReady(key) {
        return finite(this._cooldowns[key]) <= 0;
    }

    _setCooldown(key) {
        this._cooldowns[key] = Math.max(0, finite(this._skill(key).cooldown));
    }

    update(dt, entities) {
        const delta = Math.max(0, finite(dt));
        if (!this.active) return;

        this._lastEntities = entities;
        if (this._action && this._isActionControlled()) {
            this._finishAction(this._holdsFrozenPose(), 'controlled');
        }

        super.update(delta, entities);
        if (!this.active) return;

        const cooldownDt = typeof this.getAttackIntervalDelta === 'function'
            ? this.getAttackIntervalDelta(delta)
            : delta;
        for (const key of Object.keys(this._cooldowns)) {
            this._cooldowns[key] = Math.max(0, finite(this._cooldowns[key]) - cooldownDt);
        }
        this._keepWarningsAlive();
        this._updatePersistentState(delta);

        if (this._action) {
            if (this._isActionControlled()) this._finishAction(this._holdsFrozenPose(), 'controlled');
            else this._updateAction(delta);
            return;
        }
        if (this._holdsFrozenPose()) return;
        if (this._tryForcedPhase()) return;

        this._frozenForCast = false;
        this._attackAnimTimer = 0;
        this._syncApproachProfile();
        const speed = Math.hypot(finite(this.vx), finite(this.vy));
        if (speed > Math.max(0.1, finite(this.maxSpeed, finite(this.speed, 140)) * 0.04)) {
            this._animStateTimer += delta;
            this.rotation = Math.atan2(this.vy, this.vx);
        } else {
            this._animStateTimer = 0;
        }
        if (this._animState !== this._locomotionState || this._heldVisualFrame !== null) {
            this._setVisualState(this._locomotionState);
        }
    }

    _updatePersistentState(_dt) {}

    _tryForcedPhase() {
        return false;
    }

    _syncApproachProfile() {}

    /**
     * 这里只同步真正的贴身接敌合同。远程、范围和位移技能各自在
     * _selectAttackAction() 中使用自己的 triggerRange，不能把最大施法距离
     * 写回普通近战 approachReach，否则 MovementSystem 会在技能冷却期间提前停车。
     */
    _setBasicApproachProfile(approachReach, impactReach, width) {
        const approach = Math.max(1, finite(approachReach, 70));
        const impact = Math.max(1, finite(impactReach, approach));
        const resolvedWidth = Math.max(1, finite(width, 20));
        this.attackRange = approach;
        this.attackDistance = approach;
        this.config.basicMelee = {
            ...(this.config.basicMelee || {}),
            approachReach: approach,
            impactReach: impact,
            width: resolvedWidth,
            requiresSameSurface: true,
            requiresLosAtImpact: true,
        };
        const attack = this.attacks?.melee;
        if (attack) {
            attack.config.range = approach;
            attack.config.dynamicRange = approach;
            attack.range = approach;
        }
    }

    triggerWeaponAnim() {
        const pending = this._pendingThrust?.active ? this._pendingThrust : null;
        const target = pending?.primaryTarget || this.target;
        const action = this._selectAttackAction(target);
        if (pending) pending.active = false;
        if (!action) return false;
        return this._startAction(action, target);
    }

    _selectAttackAction(_target) {
        return null;
    }

    _runtimeDurationFor(action, cfg, layout) {
        return Math.max(1, finite(cfg.runtimeDurationMs, finite(cfg.durationMs, finite(layout.duration, 1000))));
    }

    _startAction(action, target = this.target) {
        if (this._action || this.isCombatActionBlocked()) return false;
        const cfg = this._skill(action);
        const visualState = this._visualStateForAction(action);
        const layout = this._layout(visualState);
        const source = entityPoint(this);
        const targetPoint = target ? entityPoint(target) : groundPoint(source.x, source.y, this.rotation, 1);
        const dx = targetPoint.x - source.x;
        const dy = targetPoint.y - source.y;
        const worldAngle = Math.atan2(dy, dx);
        const groundAngle = Math.atan2(dy / PERSPECTIVE_SCALE_Y, dx);
        const duration = this._runtimeDurationFor(action, cfg, layout);

        this._action = action;
        this._actionCfg = cfg;
        this._actionDuration = duration;
        this._actionTimer = duration;
        this._actionTarget = target;
        this._actionInstance += 1;
        this._actionSnapshot = {
            id: this._actionInstance,
            sourceX: source.x,
            sourceY: source.y,
            targetX: targetPoint.x,
            targetY: targetPoint.y,
            worldAngle,
            groundAngle,
        };
        this._firedFrames.clear();
        this._hitCounts.clear();
        this._setVisualState(visualState);
        this._frozenForCast = true;
        this._attackAnimTimer = duration;
        this.rotation = worldAngle;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this._setCooldown(action);
        this._prepareAction(action, target);
        return true;
    }

    _prepareAction(_action, _target) {}

    _eventFramesFor(action, cfg) {
        if (Array.isArray(cfg.eventFrames)) return cfg.eventFrames.map(Number).filter(Number.isFinite);
        for (const key of ['contactFrame', 'releaseFrame', 'impactFrame']) {
            if (Number.isFinite(Number(cfg[key]))) return [Number(cfg[key])];
        }
        return action ? [] : [];
    }

    _updateAction(dt) {
        const actionId = this._actionSnapshot?.id;
        const previous = this._actionTimer;
        this._actionTimer = Math.max(0, previous - dt);
        this._attackAnimTimer = this._actionTimer;
        this._frozenForCast = true;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        if (this._actionSnapshot) this.rotation = this._actionSnapshot.worldAngle;

        if (this._updateSpecialAction(previous, dt)) return;

        const elapsedBefore = this._actionDuration - previous;
        const elapsedAfter = this._actionDuration - this._actionTimer;
        const layout = this._layout(this._visualStateForAction(this._action));
        for (const frame of this._eventFramesFor(this._action, this._actionCfg)) {
            const eventKey = String(frame);
            if (this._firedFrames.has(eventKey)) continue;
            const eventMs = attackFrameStartMs(layout, frame, this._actionDuration);
            if (elapsedBefore <= eventMs && elapsedAfter >= eventMs) {
                this._firedFrames.add(eventKey);
                this._onActionEvent(this._action, frame);
                if (!this.active || this._actionSnapshot?.id !== actionId) return;
            }
        }
        if (this._actionTimer <= 0) this._finishAction(false, 'complete');
    }

    _updateSpecialAction(_previous, _dt) {
        return false;
    }

    _onActionEvent(_action, _frame) {}

    _finishAction(preservePose = false, reason = 'complete') {
        if (!this._action) return;
        const action = this._action;
        this._cancelActionArtifacts(action, reason);
        this._clearWarnings();
        this._action = null;
        this._actionCfg = null;
        this._actionDuration = 0;
        this._actionTimer = 0;
        this._actionTarget = null;
        this._actionSnapshot = null;
        this._firedFrames.clear();
        this._hitCounts.clear();
        this._frozenForCast = false;
        this._attackAnimTimer = 0;
        if (!preservePose) this._setVisualState(this._locomotionState);
        this._afterActionFinished(action, reason);
    }

    _cancelActionArtifacts(_action, _reason) {}

    _afterActionFinished(_action, _reason) {}

    _isValidTarget(target) {
        return !!target && target !== this && target.active && !target._isDead
            && target.hittable !== false && finite(target.hp, 1) > 0
            && target._faction !== 'enemy' && !isFriendlyFire(this, target);
    }

    _collectTargets() {
        const supplied = this._lastEntities?.values
            ? this._lastEntities.values()
            : (this._lastEntities || []);
        const targets = new Set(supplied);
        for (const member of PartySystem.members || []) targets.add(member);
        const friendlies = (typeof window !== 'undefined' && window.Game?.friendlyUnits) || [];
        for (const friendly of friendlies) targets.add(friendly);
        return Array.from(targets).filter((target) => this._isValidTarget(target));
    }

    _scaledDamage(cfg) {
        const base = cfg.damageType === 'magic'
            ? (finite(this.data?.matk) || finite(this.data?.int) || 1)
            : (finite(this.data?.atk) || 1);
        return Math.max(1, Math.round(base * Math.max(0, finite(cfg.damageMul, 1))));
    }

    _damageTargetsInShape(shape, cfg, skillId, {
        originX = this._actionSnapshot?.sourceX ?? this.x,
        originY = this._actionSnapshot?.sourceY ?? this.y,
        maxHits = 1,
        isMelee = cfg.damageType !== 'magic',
        requireLos = true,
        afterHit = null,
    } = {}) {
        const snapshotId = this._actionSnapshot?.id;
        for (const target of this._collectTargets()) {
            if (!this.active || this.isCombatActionBlocked() || this._actionSnapshot?.id !== snapshotId) break;
            if (!shape.intersectsEntity(target)) continue;
            if (isMelee && !canMeleeShareSurface(this, target)) continue;
            if (requireLos && !hasAttackLineOfSight(this, target, originX, originY)) continue;
            const key = target.id || target;
            if (finite(this._hitCounts.get(key)) >= maxHits) continue;
            const point = entityPoint(target);
            const angle = Math.atan2(point.y - originY, point.x - originX);
            const result = DamagePipeline.applyHit(this, target, {
                damage: this._scaledDamage(cfg),
                damageType: cfg.damageType || 'physical',
                knockback: 0,
                angle,
                isMelee,
                confirmedHitContext: { skillId },
            });
            if (!result.hit) continue;
            this._hitCounts.set(key, finite(this._hitCounts.get(key)) + 1);
            if (!result.parried && target.active && !target._isDead) {
                const knockback = Math.max(0, finite(cfg.knockback));
                if (knockback > 0) target.applyKnockback?.(angle, knockback);
                afterHit?.(target, result);
            }
        }
    }

    _damageAnnulus(x, y, inner, outer, cfg, skillId, maxHits = 1) {
        const snapshotId = this._actionSnapshot?.id;
        for (const target of this._collectTargets()) {
            if (!this.active || this.isCombatActionBlocked() || this._actionSnapshot?.id !== snapshotId) break;
            if (!canMeleeShareSurface(this, target) || !hasAttackLineOfSight(this, target, x, y)) continue;
            const point = entityPoint(target);
            const radius = finite(target.collider?.radius);
            const dx = point.x - x;
            const dy = (point.y - y) / PERSPECTIVE_SCALE_Y;
            const distance = Math.hypot(dx, dy);
            if (distance + radius < inner || distance - radius > outer) continue;
            const key = target.id || target;
            if (finite(this._hitCounts.get(key)) >= maxHits) continue;
            const angle = Math.atan2(point.y - y, point.x - x);
            const result = DamagePipeline.applyHit(this, target, {
                damage: this._scaledDamage(cfg),
                damageType: cfg.damageType || 'magic',
                knockback: 0,
                angle,
                isMelee: false,
                confirmedHitContext: { skillId },
            });
            if (!result.hit) continue;
            this._hitCounts.set(key, finite(this._hitCounts.get(key)) + 1);
            if (!result.parried && target.active && !target._isDead) {
                const knockback = Math.max(0, finite(cfg.knockback));
                if (knockback > 0) target.applyKnockback?.(angle, knockback);
            }
        }
    }

    _trackWarning(warning) {
        if (warning) this._warnings.add(warning);
        return warning;
    }

    _releaseWarning(warning) {
        if (!warning) return null;
        this._warnings.delete(warning);
        return destroyWarning(warning);
    }

    _keepWarningsAlive() {
        for (const warning of Array.from(this._warnings)) {
            if (!keepWarningAlive(warning)) this._warnings.delete(warning);
        }
    }

    _clearWarnings() {
        for (const warning of this._warnings) destroyWarning(warning);
        this._warnings.clear();
        for (const warning of this._rangeWarnings) {
            warning.active = false;
            warning._destroyPhaserGraphics?.();
        }
        this._rangeWarnings.clear();
    }

    _rangeWarning(x, y, angle, range, width, type, duration, backExtension = 0) {
        const warning = new AttackRangeEffect(
            x, y, angle, range, width, type, Math.max(1, duration), 0.55, true, backExtension
        );
        EffectManager.add(warning);
        this._rangeWarnings.add(warning);
        return warning;
    }

    _releaseRangeWarning(warning) {
        if (!warning) return null;
        this._rangeWarnings.delete(warning);
        warning.active = false;
        warning._destroyPhaserGraphics?.();
        return null;
    }

    _setVisualState(state) {
        this._animState = state;
        this._animStateTimer = 0;
        this._heldVisualFrame = null;
        this._syncVisualMetrics();
    }

    _getVisualFrame() {
        if (this._heldVisualFrame !== null) return this._heldVisualFrame;
        const layout = this._layout();
        if (this._action) {
            return attackFrameAt(layout, this._actionDuration - this._actionTimer, this._actionDuration);
        }
        const duration = Math.max(1, finite(layout.duration, 1000));
        return attackFrameAt(layout, this._animStateTimer % duration, duration);
    }

    _syncVisualMetrics() {
        const layout = this._layout();
        const authored = Math.max(1, finite(layout.authoredBodyHeight, finite(layout.frameHeight, 256)));
        const displayHeight = Math.max(1, finite(this.config?.render?.displayBodyHeight, finite(this.size, 36) * 5.5));
        const pixelScale = displayHeight / authored;
        const frameWidth = Math.max(1, finite(layout.frameWidth, 256));
        const frameHeight = Math.max(1, finite(layout.frameHeight, 256));
        this._spritePixelScale = pixelScale;
        this._spriteSize = Math.max(frameWidth, frameHeight) * pixelScale;
        this.footOffsetX = (finite(layout.footX, frameWidth / 2) - frameWidth / 2) * pixelScale;
        this.footOffsetY = (finite(layout.footY, frameHeight) - frameHeight / 2) * pixelScale;
    }

    _getTextureKey() {
        return `enemy_${this._texturePrefix}_${this._animState}`;
    }

    _getPhaserOptions() {
        const options = super._getPhaserOptions();
        const layout = this._layout();
        this._syncVisualMetrics();
        options.spriteSize = this._spriteSize;
        options.dynamicSpriteSize = true;
        options.manualFrame = true;
        options.frame = this._getVisualFrame();
        options.animState = this._animState;
        options.animKey = `${this._getTextureKey()}_v1`;
        options.frameAnchorX = finite(layout.footX, finite(layout.frameWidth, 256) * 0.5);
        options.collisionWidth = finite(this.config?.render?.collisionWidth, this.groundRadius * 2);
        options.collisionHeight = finite(this.config?.render?.collisionHeight, this.size * 4.2);
        options.textOffsetY = -Math.max(40, finite(this.config?.render?.displayBodyHeight, this.size * 5.5) * 0.58);
        // 正式母图统一朝屏幕右侧；运行时只做水平镜像，不旋转、不改变脚点。
        options.flipX = Math.cos(finite(this.rotation)) < 0;
        options.frameWidth = layout.frameWidth;
        options.frameHeight = layout.frameHeight;
        return options;
    }

    _enterStunnedIdleAnimation() {
        if (this._isDead || !this.active) return;
        this._setVisualState(this._locomotionState);
    }

    _onCombatActionInterruptedByControl() {
        if (this._action) this._finishAction(this._holdsFrozenPose(), 'controlled');
        super._onCombatActionInterruptedByControl?.();
    }

    updateWhilePetrified(dt) {
        if (this._action) this._finishAction(true, 'controlled');
        super.updateWhilePetrified(dt);
    }

    onDeath(source) {
        if (!this.active) return;
        this._heldVisualFrame = this._getVisualFrame();
        this._clearWarnings();
        this._cancelActionArtifacts(this._action, 'death');
        this._action = null;
        this._actionSnapshot = null;
        this._frozenForCast = true;
        super.onDeath(source);
    }

    _destroyCustomEffects() {
        this._clearWarnings();
        this._cancelActionArtifacts(this._action, 'destroy');
        super._destroyCustomEffects?.();
    }
}

/** 雪冢驮城兽：近身践踏、三点投砸、锁向铲雪冲锋与两次生命阈值筑垒。 */
export class SnowSepulcherCarrier extends SnowfieldLordBase {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.snowSepulcherCarrier,
            ...config,
        }, {
            texturePrefix: 'snow_sepulcher_carrier',
            locomotionState: 'advance',
        });
        this._initCooldowns(['trample_body', 'tower_drop_body', 'plow_prepare', 'fortify']);
        this._fortifyThresholds = [0.65, 0.30];
        this._fortifyIndex = 0;
        this._fortifying = false;
        this._exposedTimer = 0;
        this._plow = null;
        this._frostTrail = [];
        this._syncApproachProfile();
    }

    _runtimeDurationFor(action, cfg, layout) {
        if (action !== 'plow_prepare') return super._runtimeDurationFor(action, cfg, layout);
        const prepareEndFrame = finite(cfg.prepareEndFrame, 67) + 1;
        const formalDuration = finite(layout.duration, 3833);
        const prepareMs = attackFrameStartMs(layout, prepareEndFrame, formalDuration);
        const recoveryMs = Math.max(1, formalDuration - prepareMs);
        return prepareMs + Math.max(1, finite(cfg.chargeMs, 1250)) + recoveryMs;
    }

    _updatePersistentState(dt) {
        if (this._exposedTimer > 0) {
            this._exposedTimer = Math.max(0, this._exposedTimer - dt);
            this._frozenForCast = true;
            this.vx = 0;
            this.vy = 0;
        }
        for (let i = this._frostTrail.length - 1; i >= 0; i--) {
            const trail = this._frostTrail[i];
            trail.timer -= dt;
            if (trail.timer <= 0) {
                this._frostTrail.splice(i, 1);
                continue;
            }
            const shape = new GroundEllipse(
                trail.x, trail.y, trail.radius, trail.radius * PERSPECTIVE_SCALE_Y,
                surfaceEffectFromEntity(this)
            );
            for (const target of this._collectTargets()) {
                if (!shape.intersectsEntity(target) || !canMeleeShareSurface(this, target)) continue;
                target.addStatusEffect?.('slow', Math.min(450, trail.timer), {
                    name: '霜径迟滞', icon: '❄️', color: '#91e9ff', value: 0.35,
                });
            }
        }
    }

    _tryForcedPhase() {
        if (this._exposedTimer > 0) return true;
        const threshold = this._fortifyThresholds[this._fortifyIndex];
        if (!Number.isFinite(threshold) || finite(this.hp) / Math.max(1, finite(this.maxHp, 1)) > threshold) {
            return false;
        }
        const started = this._startAction('fortify', this.target);
        if (started) this._fortifyIndex += 1;
        return started;
    }

    _syncApproachProfile() {
        const trample = this._skill('trample_body');
        this._setBasicApproachProfile(
            finite(trample.approachReach, 210),
            finite(trample.range, 210),
            finite(trample.width, 160)
        );
    }

    _selectAttackAction(target) {
        if (this._action || this._exposedTimer > 0 || this.isCombatActionBlocked()
            || !this._isValidTarget(target) || !canMeleeShareSurface(this, target)) return null;
        const distance = distanceToEntityShape(target, this.collider?.x ?? this.x, this.collider?.y ?? this.y);
        const plow = this._skill('plow_prepare');
        if (this._cooldownReady('plow_prepare') && !this.hasStatusEffect('bind')
            && distance >= finite(plow.minTriggerRange, 320)
            && distance <= finite(plow.triggerRange, 760)
            && hasAttackLineOfSight(this, target)) return 'plow_prepare';
        const tower = this._skill('tower_drop_body');
        if (this._cooldownReady('tower_drop_body')
            && distance <= finite(tower.triggerRange, 650)
            && hasAttackLineOfSight(this, target)) return 'tower_drop_body';
        const trample = this._skill('trample_body');
        if (this._cooldownReady('trample_body')
            && distance <= finite(trample.approachReach, 210)) return 'trample_body';
        return null;
    }

    _prepareAction(action, target) {
        const snap = this._actionSnapshot;
        if (action === 'trample_body') {
            this._trampleWarning = this._rangeWarning(
                snap.sourceX, snap.sourceY, snap.groundAngle,
                finite(this._actionCfg.range, 210), finite(this._actionCfg.width, 160),
                'triangle', this._actionDuration + 100
            );
        } else if (action === 'tower_drop_body') {
            const cfg = this._actionCfg;
            const targetPoint = entityPoint(target);
            const lead = [0, 0.28, 0.56];
            this._towerPoints = lead.map((seconds) => ({
                x: targetPoint.x + finite(target?.vx) * seconds,
                y: targetPoint.y + finite(target?.vy) * seconds,
            }));
            this._towerWarnings = this._towerPoints.map((point) => this._trackWarning(
                createGroundWarning(
                    point.x, point.y, finite(cfg.radius, 120), finite(cfg.radius, 120)
                )
            ));
        } else if (action === 'plow_prepare') {
            const layout = this._layout('plow_prepare');
            const formalDuration = finite(layout.duration, 3833);
            const prepareEndFrame = finite(this._actionCfg.prepareEndFrame, 67) + 1;
            const prepareMs = attackFrameStartMs(layout, prepareEndFrame, formalDuration);
            this._plow = {
                phase: 'prepare',
                dirX: Math.cos(snap.worldAngle),
                dirY: Math.sin(snap.worldAngle),
                prepareMs,
                chargeMs: Math.max(1, finite(this._actionCfg.chargeMs, 1250)),
                recoveryMs: Math.max(1, formalDuration - prepareMs),
                recoveryAt: prepareMs + Math.max(1, finite(this._actionCfg.chargeMs, 1250)),
                traveled: 0,
                trailDistance: 0,
                hitTargets: new Set(),
                previousNoCollision: this.noCollision,
            };
            this._plowWarning = this._rangeWarning(
                snap.sourceX, snap.sourceY, snap.groundAngle,
                finite(this._actionCfg.maxDistance, 760), finite(this._actionCfg.sweepWidth, 210),
                'triangle', prepareMs + 150
            );
        } else if (action === 'fortify') {
            this._fortifying = true;
            const ridge = this._actionCfg;
            this._ridgeWarnings = [0, 1, 2].map((index) => {
                const point = groundPoint(
                    snap.sourceX, snap.sourceY, snap.groundAngle,
                    finite(ridge.firstOffset, 110) + index * finite(ridge.spacing, 190)
                );
                return this._rangeWarning(
                    point.x, point.y, snap.groundAngle,
                    finite(ridge.ridgeLength, 150), finite(ridge.ridgeWidth, 360),
                    'triangle', this._actionDuration + 100
                );
            });
        }
    }

    _eventFramesFor(action, cfg) {
        if (action === 'plow_prepare') return [];
        return super._eventFramesFor(action, cfg);
    }

    _updateSpecialAction(previous, dt) {
        if (this._action !== 'plow_prepare') return false;
        const plow = this._plow;
        if (!plow) {
            this._finishAction(false, 'invalid');
            return true;
        }
        const elapsedBefore = this._actionDuration - previous;
        const elapsedAfter = this._actionDuration - this._actionTimer;
        if (this.hasStatusEffect('bind') && plow.phase === 'charge') this._stopPlow(elapsedAfter);

        if (plow.phase === 'prepare' && elapsedAfter >= plow.prepareMs) {
            plow.phase = 'charge';
            this.noCollision = true;
            this._plowWarning = this._releaseRangeWarning(this._plowWarning);
            if (this.hasStatusEffect('bind')) this._stopPlow(elapsedAfter);
        }
        if (plow.phase === 'charge') {
            const activeFrom = Math.max(elapsedBefore, plow.prepareMs);
            const activeTo = Math.min(elapsedAfter, plow.recoveryAt);
            const activeMs = Math.max(0, activeTo - activeFrom);
            this._advancePlow(activeMs, elapsedAfter);
            if (this._action !== 'plow_prepare' || this._plow !== plow) return true;
            if (elapsedAfter >= plow.recoveryAt) this._stopPlow(elapsedAfter);
        }
        if (this._actionTimer <= 0) this._finishAction(false, 'complete');
        return true;
    }

    _advancePlow(activeMs, elapsedAfter) {
        const plow = this._plow;
        if (!plow || activeMs <= 0 || plow.phase !== 'charge') return;
        const cfg = this._actionCfg;
        const maxDistance = Math.max(1, finite(cfg.maxDistance, 760));
        const remaining = Math.max(0, maxDistance - plow.traveled);
        const step = Math.min(remaining, maxDistance * activeMs / plow.chargeMs);
        if (step <= 0) {
            this._stopPlow(elapsedAfter);
            return;
        }
        const fromX = this.x;
        const fromY = this.y;
        const intendedX = fromX + plow.dirX * step;
        const intendedY = fromY + plow.dirY * step;
        const resolved = WallSystem.resolve(fromX, fromY, intendedX, intendedY, this.groundRadius);
        this.x = resolved.x;
        this.y = resolved.y;
        const actual = Math.hypot(this.x - fromX, this.y - fromY);
        plow.traveled += actual;
        plow.trailDistance += actual;
        const blocked = straightMotionWasBlocked(fromX, fromY, intendedX, intendedY, this.x, this.y);

        if (plow.trailDistance >= finite(cfg.trailSpacing, 85)) {
            plow.trailDistance = 0;
            this._spawnFrostTrail(this.x, this.y);
        }
        for (const target of this._collectTargets()) {
            const key = target.id || target;
            if (plow.hitTargets.has(key)) continue;
            if (!sweptMotionMeleeHits(
                this, target, fromX, fromY, this.x, this.y,
                finite(cfg.sweepWidth, 210) * 0.5,
                { blocked, skill: '雪冢驮城兽·铲雪冲锋' }
            )) continue;
            plow.hitTargets.add(key);
            this._resolvePlowHit(target);
            if (!this.active || this._action !== 'plow_prepare') return;
        }
        if (blocked || plow.traveled >= maxDistance) this._stopPlow(elapsedAfter);
    }

    _stopPlow(elapsed) {
        const plow = this._plow;
        if (!plow || plow.phase !== 'charge') return;
        plow.phase = 'recovery';
        plow.recoveryAt = elapsed;
        this.noCollision = plow.previousNoCollision;
        this._actionDuration = elapsed + plow.recoveryMs;
        this._actionTimer = plow.recoveryMs;
    }

    _resolvePlowHit(target) {
        const cfg = this._actionCfg;
        const point = entityPoint(target);
        const result = DamagePipeline.applyHit(this, target, {
            damage: this._scaledDamage(cfg),
            damageType: cfg.damageType || 'physical',
            knockback: 0,
            angle: this._actionSnapshot.worldAngle,
            isMelee: true,
            confirmedHitContext: { skillId: 'snowSepulcherPlow' },
        });
        if (!result.hit || result.parried || !target.active || target._isDead) return;
        target.applyKnockback?.(Math.atan2(point.y - this.y, point.x - this.x), finite(cfg.knockback, 180));
    }

    _spawnFrostTrail(x, y) {
        const cfg = this._actionCfg;
        const radius = finite(cfg.trailRadius, 70);
        const timer = finite(cfg.trailDurationMs, 4000);
        this._frostTrail.push({ x, y, radius, timer });
        EffectManager.add(new FrostTrailEffect(x, y, radius, timer));
        fireGroundShockwave({
            x, y,
            maxRadius: radius,
            strokeColor: 0x8feaff,
            fillColor: 0x4abbd8,
            duration: Math.min(650, timer),
            lineWidth: 3,
        });
    }

    _onActionEvent(action, frame) {
        const snap = this._actionSnapshot;
        if (!snap) return;
        if (action === 'trample_body') {
            const cfg = this._actionCfg;
            this._trampleWarning = this._releaseRangeWarning(this._trampleWarning);
            const shape = new GroundDirectedRect(
                snap.sourceX, snap.sourceY, snap.groundAngle,
                finite(cfg.range, 210), finite(cfg.width, 160), 0,
                surfaceEffectFromEntity(this)
            );
            this._damageTargetsInShape(shape, cfg, 'snowSepulcherTrample');
            fireGroundShockwave({ x: snap.sourceX, y: snap.sourceY, maxRadius: 220, duration: 520 });
        } else if (action === 'tower_drop_body') {
            const frames = this._eventFramesFor(action, this._actionCfg);
            const index = Math.max(0, frames.indexOf(frame));
            const point = this._towerPoints?.[index];
            if (!point) return;
            this._towerWarnings[index] = this._releaseWarning(this._towerWarnings[index]);
            const cfg = this._actionCfg;
            const shape = new GroundEllipse(
                point.x, point.y, finite(cfg.radius, 120), finite(cfg.radius, 120) * PERSPECTIVE_SCALE_Y,
                surfaceEffectFromEntity(this)
            );
            this._damageTargetsInShape(shape, cfg, `snowSepulcherTowerDrop${index + 1}`, {
                originX: point.x, originY: point.y, maxHits: finite(cfg.maxHitsPerTarget, 2), isMelee: false,
            });
            fireGroundShockwave({ x: point.x, y: point.y, maxRadius: finite(cfg.radius, 120), duration: 430 });
        } else if (action === 'fortify') {
            const frames = this._eventFramesFor(action, this._actionCfg);
            const index = Math.max(0, frames.indexOf(frame));
            const cfg = this._actionCfg;
            const origin = groundPoint(
                snap.sourceX, snap.sourceY, snap.groundAngle,
                finite(cfg.firstOffset, 110) + index * finite(cfg.spacing, 190)
            );
            this._ridgeWarnings[index] = this._releaseRangeWarning(this._ridgeWarnings[index]);
            const shape = new GroundDirectedRect(
                origin.x, origin.y, snap.groundAngle,
                finite(cfg.ridgeLength, 150), finite(cfg.ridgeWidth, 360), 0,
                surfaceEffectFromEntity(this)
            );
            this._damageTargetsInShape(shape, cfg, `snowSepulcherFortify${index + 1}`, {
                originX: origin.x, originY: origin.y, isMelee: false,
            });
            fireGroundShockwave({
                x: origin.x, y: origin.y,
                maxRadius: finite(cfg.warningRadius, 110),
                strokeColor: 0xa6efff, fillColor: 0x77cfe8, duration: 520,
            });
        }
    }

    _cancelActionArtifacts(action) {
        if (action === 'plow_prepare' && this._plow) {
            this.noCollision = this._plow.previousNoCollision;
            this._plow = null;
        }
        this._trampleWarning = null;
        this._plowWarning = null;
        this._towerPoints = null;
        this._towerWarnings = null;
        this._ridgeWarnings = null;
        if (action === 'fortify') this._fortifying = false;
    }

    _afterActionFinished(action, reason) {
        if (action === 'fortify') {
            this._fortifying = false;
            if (reason === 'complete') {
                this._exposedTimer = finite(this._skill('fortify').exposedMs, 1100);
                this._frozenForCast = true;
            }
        }
    }

    _getVisualFrame() {
        if (this._action !== 'plow_prepare' || !this._plow) return super._getVisualFrame();
        const layout = this._layout('plow_prepare');
        const frameCount = Math.max(1, finite(layout.frameCount, 93));
        const prepareLast = Math.min(frameCount - 1, finite(this._actionCfg.prepareEndFrame, 67));
        const elapsed = this._actionDuration - this._actionTimer;
        if (this._plow.phase === 'prepare') {
            return Math.min(prepareLast, Math.floor(elapsed / Math.max(1, this._plow.prepareMs) * (prepareLast + 1)));
        }
        if (this._plow.phase === 'charge') return prepareLast;
        const recoveryStart = Math.min(frameCount - 1, prepareLast + 1);
        const recoveryElapsed = Math.max(0, elapsed - this._plow.recoveryAt);
        return Math.min(frameCount - 1, recoveryStart + Math.floor(
            recoveryElapsed / Math.max(1, this._plow.recoveryMs) * (frameCount - recoveryStart)
        ));
    }

    applyKnockback(angle, totalPx) {
        if (this._fortifying) return false;
        return super.applyKnockback(angle, totalPx);
    }

    takeDamage(damage, source, damageType = 'physical', isMelee = true, hitContext = null) {
        const multiplier = this._exposedTimer > 0 ? finite(this._skill('fortify').exposedDamageMultiplier, 1.25) : 1;
        return super.takeDamage(damage * multiplier, source, damageType, isMelee, hitContext);
    }
}

/** 极光织命母：保持中距离，以三角光带、旧步回放和命运牵线控制战场。 */
export class AuroraFateWeaver extends SnowfieldLordBase {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.auroraFateWeaver,
            ...config,
        }, {
            texturePrefix: 'aurora_fate_weaver',
            locomotionState: 'seek_band',
        });
        this._initCooldowns([
            'cut_body', 'triangle_weave_body', 'oldstep_body', 'tether_body', 'reweave_body',
        ]);
        this._historyClock = 0;
        this._historySampleTimer = 0;
        this._targetHistory = new Map();
        this._reweaveDone = false;
        this._phasePending = true;
        this._triangle = null;
        this._oldstepPoints = null;
        this._tetherTargets = null;
        this._syncApproachProfile();
    }

    _updatePersistentState(dt) {
        this._historyClock += dt;
        this._historySampleTimer -= dt;
        if (this._historySampleTimer > 0) return;
        this._historySampleTimer = 100;
        for (const target of this._collectTargets()) {
            const key = target.id || target;
            const list = this._targetHistory.get(key) || [];
            const point = entityPoint(target);
            list.push({ t: this._historyClock, x: point.x, y: point.y });
            while (list.length && list[0].t < this._historyClock - 3200) list.shift();
            this._targetHistory.set(key, list);
        }
        for (const [key, list] of this._targetHistory) {
            if (!list.length || list[list.length - 1].t < this._historyClock - 3200) this._targetHistory.delete(key);
        }
    }

    _tryForcedPhase() {
        if (!this._phasePending || finite(this.hp) / Math.max(1, finite(this.maxHp, 1)) > 0.5) return false;
        return this._startAction('reweave_body', this.target);
    }

    _syncApproachProfile() {
        const cut = this._skill('cut_body');
        this._setBasicApproachProfile(
            finite(cut.approachReach, 220),
            finite(cut.range, 180),
            finite(cut.arcDegrees, 180)
        );

        this._specialTacticalTarget = null;
        if (!this.target || !this._isValidTarget(this.target)) return;
        const distance = distanceToEntityShape(this.target, this.collider?.x ?? this.x, this.collider?.y ?? this.y);
        if (distance >= finite(cut.retreatBelow, 220) || this._cooldownReady('cut_body')) return;
        const source = entityPoint(this);
        const targetPoint = entityPoint(this.target);
        const angle = Math.atan2(
            (source.y - targetPoint.y) / PERSPECTIVE_SCALE_Y,
            source.x - targetPoint.x
        );
        this._specialTacticalTarget = groundPoint(source.x, source.y, angle, 260);
    }

    _selectAttackAction(target) {
        if (this._action || this.isCombatActionBlocked() || !this._isValidTarget(target)
            || !canMeleeShareSurface(this, target)) return null;
        const distance = distanceToEntityShape(target, this.collider?.x ?? this.x, this.collider?.y ?? this.y);
        const cut = this._skill('cut_body');
        if (this._cooldownReady('cut_body') && distance <= finite(cut.approachReach, 220)) return 'cut_body';
        const triangle = this._skill('triangle_weave_body');
        if (this._cooldownReady('triangle_weave_body')
            && distance <= finite(triangle.triggerRange, 650)
            && hasAttackLineOfSight(this, target)) return 'triangle_weave_body';
        const oldstep = this._skill('oldstep_body');
        if (this._cooldownReady('oldstep_body') && this._targetWasMoving(target)
            && distance <= finite(oldstep.triggerRange, 650)
            && hasAttackLineOfSight(this, target)) return 'oldstep_body';
        const tether = this._skill('tether_body');
        if (this._cooldownReady('tether_body')
            && distance <= finite(tether.triggerRange, 900)
            && hasAttackLineOfSight(this, target)) return 'tether_body';
        return null;
    }

    _targetWasMoving(target) {
        const list = this._targetHistory.get(target?.id || target) || [];
        if (list.length < 2) return false;
        const latest = list[list.length - 1];
        let earlier = list[0];
        for (let index = list.length - 2; index >= 0; index--) {
            earlier = list[index];
            if (latest.t - earlier.t >= 650) break;
        }
        return Math.hypot(latest.x - earlier.x, latest.y - earlier.y) >= 55;
    }

    _prepareAction(action, target) {
        const snap = this._actionSnapshot;
        if (action === 'cut_body') {
            this._cutWarning = this._rangeWarning(
                snap.sourceX, snap.sourceY, snap.groundAngle,
                finite(this._actionCfg.range, 180), finite(this._actionCfg.arcDegrees, 180) * Math.PI / 180,
                'sector', this._actionDuration + 100
            );
        } else if (action === 'triangle_weave_body') {
            const cfg = this._actionCfg;
            const radius = finite(cfg.triangleRadius, 240);
            const baseAngle = snap.groundAngle - Math.PI / 2;
            this._triangle = [0, 1, 2].map((index) => groundPoint(
                snap.targetX, snap.targetY, baseAngle + index * TAU / 3, radius
            ));
            this._triangleWarnings = this._triangle.map((from, index) => {
                const to = this._triangle[(index + 1) % 3];
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                return this._rangeWarning(
                    from.x, from.y, Math.atan2(dy / PERSPECTIVE_SCALE_Y, dx),
                    Math.hypot(dx, dy / PERSPECTIVE_SCALE_Y), finite(cfg.lineWidth, 38),
                    'triangle', this._actionDuration + 100
                );
            });
        } else if (action === 'oldstep_body') {
            const ages = [2100, 1400, 700];
            this._oldstepPoints = ages.map((age) => this._historyPoint(target, age));
            if (this._reweaveDone) this._oldstepPoints.push(entityPoint(target));
            const halfLength = finite(this._actionCfg.strikeLength, 220) * 0.5;
            this._oldstepWarnings = this._oldstepPoints.map((point) => {
                const dx = point.x - snap.sourceX;
                const dy = point.y - snap.sourceY;
                return this._rangeWarning(
                    point.x, point.y, Math.atan2(dy / PERSPECTIVE_SCALE_Y, dx),
                    halfLength, finite(this._actionCfg.strikeWidth, 70),
                    'triangle', this._actionDuration + 100, halfLength
                );
            });
        } else if (action === 'tether_body') {
            const maxTargets = Math.max(1, finite(this._actionCfg.maxTargets, 3));
            const source = entityPoint(this);
            this._tetherTargets = this._collectTargets()
                .filter((candidate) => canMeleeShareSurface(this, candidate)
                    && hasAttackLineOfSight(this, candidate)
                    && distanceToEntityShape(candidate, source.x, source.y) <= finite(this._actionCfg.triggerRange, 900))
                .sort((a, b) => distanceToEntityShape(b, source.x, source.y)
                    - distanceToEntityShape(a, source.x, source.y))
                .slice(0, maxTargets);
        }
    }

    _historyPoint(target, age) {
        const list = this._targetHistory.get(target?.id || target) || [];
        if (!list.length) return entityPoint(target);
        const wanted = this._historyClock - age;
        let best = list[0];
        for (const item of list) {
            if (Math.abs(item.t - wanted) < Math.abs(best.t - wanted)) best = item;
        }
        return { x: best.x, y: best.y };
    }

    _onActionEvent(action, frame) {
        const snap = this._actionSnapshot;
        if (!snap) return;
        if (action === 'cut_body') {
            const cfg = this._actionCfg;
            this._cutWarning = this._releaseRangeWarning(this._cutWarning);
            const shape = new GroundSector(
                snap.sourceX, snap.sourceY, snap.groundAngle,
                finite(cfg.range, 180), finite(cfg.arcDegrees, 180) * Math.PI / 180,
                surfaceEffectFromEntity(this)
            );
            this._damageTargetsInShape(shape, cfg, 'auroraFateCut');
        } else if (action === 'triangle_weave_body') {
            const cfg = this._actionCfg;
            for (let index = 0; index < 3; index++) {
                const from = this._triangle[index];
                const to = this._triangle[(index + 1) % 3];
                const dx = to.x - from.x;
                const dy = to.y - from.y;
                const groundAngle = Math.atan2(dy / PERSPECTIVE_SCALE_Y, dx);
                const length = Math.hypot(dx, dy / PERSPECTIVE_SCALE_Y);
                const shape = new GroundDirectedRect(
                    from.x, from.y, groundAngle, length, finite(cfg.lineWidth, 38), 0,
                    surfaceEffectFromEntity(this)
                );
                this._damageTargetsInShape(shape, cfg, `auroraFateTriangle${index + 1}`, {
                    originX: from.x, originY: from.y,
                    maxHits: finite(cfg.maxHitsPerTarget, 2), isMelee: false,
                });
                spawnRailgunBeam({
                    x: from.x, y: from.y, endX: to.x, endY: to.y,
                    duration: this._reweaveDone ? finite(cfg.phaseLineDurationMs, 1050) : finite(cfg.lineDurationMs, 1400),
                    widthScale: 0.8,
                });
            }
            for (let i = 0; i < this._triangleWarnings.length; i++) {
                this._triangleWarnings[i] = this._releaseRangeWarning(this._triangleWarnings[i]);
            }
        } else if (action === 'oldstep_body') {
            const frames = this._eventFramesFor(action, this._actionCfg);
            const index = Math.max(0, frames.indexOf(frame));
            this._resolveOldstep(index);
            if (this._reweaveDone && index === frames.length - 1) this._resolveOldstep(3);
        } else if (action === 'tether_body') {
            const frames = this._eventFramesFor(action, this._actionCfg);
            if (frame === frames[0]) this._showTethers();
            else this._resolveTethers();
        } else if (action === 'reweave_body') {
            this._phasePending = false;
            this._reweaveDone = true;
            fireGroundShockwave({
                x: snap.sourceX, y: snap.sourceY, maxRadius: 300,
                strokeColor: 0xb9ffff, fillColor: 0x805cff, duration: 720,
            });
        }
    }

    _resolveOldstep(index) {
        const point = this._oldstepPoints?.[index];
        if (!point) return;
        this._oldstepWarnings[index] = this._releaseRangeWarning(this._oldstepWarnings[index]);
        const cfg = this._actionCfg;
        const snap = this._actionSnapshot;
        const dx = point.x - snap.sourceX;
        const dy = point.y - snap.sourceY;
        const angle = Math.atan2(dy / PERSPECTIVE_SCALE_Y, dx);
        const shape = new GroundDirectedRect(
            point.x, point.y, angle,
            finite(cfg.strikeLength, 220) * 0.5, finite(cfg.strikeWidth, 70),
            finite(cfg.strikeBack, finite(cfg.strikeLength, 220) * 0.5),
            surfaceEffectFromEntity(this)
        );
        this._damageTargetsInShape(shape, cfg, `auroraFateOldstep${index + 1}`, {
            originX: point.x, originY: point.y,
            maxHits: finite(cfg.maxHitsPerTarget, 2), isMelee: false,
        });
        fireGroundShockwave({
            x: point.x, y: point.y, maxRadius: finite(cfg.warningRadius, 64),
            strokeColor: 0xc8ffff, fillColor: 0x9d74ff, duration: 360,
        });
    }

    _showTethers() {
        const source = entityPoint(this);
        for (const target of this._tetherTargets || []) {
            if (!this._isValidTarget(target)) continue;
            const point = entityPoint(target);
            spawnRailgunBeam({
                x: source.x, y: source.y, endX: point.x, endY: point.y,
                duration: finite(this._actionCfg.tetherVisualMs, 1100), widthScale: 0.55,
            });
        }
    }

    _resolveTethers() {
        const source = entityPoint(this);
        for (const target of this._tetherTargets || []) {
            if (!this._isValidTarget(target) || !canMeleeShareSurface(this, target)
                || !hasAttackLineOfSight(this, target, source.x, source.y)) continue;
            const point = entityPoint(target);
            const towardBoss = Math.atan2(source.y - point.y, source.x - point.x);
            target.applyKnockback?.(towardBoss, finite(this._actionCfg.pullDistance, 140));
        }
    }

    _cancelActionArtifacts() {
        this._cutWarning = null;
        this._triangle = null;
        this._triangleWarnings = null;
        this._oldstepPoints = null;
        this._oldstepWarnings = null;
        this._tetherTargets = null;
    }
}

/** 白寂鸣钟鹿：扇角、环形钟鸣、四点踏击、长直线与半血节拍切换。 */
export class WhiteSilenceBellHart extends SnowfieldLordBase {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.whiteSilenceBellHart,
            ...config,
        }, {
            texturePrefix: 'white_silence_bell_hart',
            locomotionState: 'stride',
        });
        this._initCooldowns([
            'antler_body', 'double_toll_body', 'hoof_sequence_body', 'long_tone_body', 'rhythm_shift_body',
        ]);
        this._phasePending = true;
        this._rhythmShifted = false;
        this._tollCount = 0;
        this._pendingThirdEcho = null;
        this._hoofPoints = null;
        this._syncApproachProfile();
    }

    _updatePersistentState(dt) {
        if (!this._pendingThirdEcho) return;
        this._pendingThirdEcho.timer -= dt;
        if (this._pendingThirdEcho.timer > 0) return;
        const echo = this._pendingThirdEcho;
        this._pendingThirdEcho = null;
        if (!this._action || this._action !== 'double_toll_body' || this.isCombatActionBlocked()) return;
        const cfg = { ...this._skill('double_toll_body'), damageMul: finite(this._skill('double_toll_body').thirdEchoDamageMul, 0.9) };
        this._damageAnnulus(
            echo.x, echo.y,
            finite(cfg.thirdEchoInnerRadius, 235), finite(cfg.thirdEchoOuterRadius, 330),
            cfg, 'whiteSilenceThirdEcho', finite(cfg.maxHitsPerTarget, 2)
        );
        fireGroundShockwave({
            x: echo.x, y: echo.y, maxRadius: finite(cfg.thirdEchoOuterRadius, 330),
            strokeColor: 0xe8f7ff, fillColor: 0x8dc2dd, duration: 520,
        });
    }

    _tryForcedPhase() {
        if (!this._phasePending || finite(this.hp) / Math.max(1, finite(this.maxHp, 1)) > 0.45) return false;
        return this._startAction('rhythm_shift_body', this.target);
    }

    _syncApproachProfile() {
        const antler = this._skill('antler_body');
        this._setBasicApproachProfile(
            finite(antler.range, 230),
            finite(antler.range, 230),
            finite(this.config?.basicMelee?.width, 120)
        );
    }

    _selectAttackAction(target) {
        if (this._action || this.isCombatActionBlocked() || !this._isValidTarget(target)
            || !canMeleeShareSurface(this, target)) return null;
        const distance = distanceToEntityShape(target, this.collider?.x ?? this.x, this.collider?.y ?? this.y);
        const longTone = this._skill('long_tone_body');
        if (this._cooldownReady('long_tone_body')
            && distance >= finite(longTone.minTriggerRange, 300)
            && distance <= finite(longTone.range, 620)
            && hasAttackLineOfSight(this, target)) return 'long_tone_body';
        const hoof = this._skill('hoof_sequence_body');
        const nearby = this._collectTargets().filter((candidate) => canMeleeShareSurface(this, candidate)
            && distanceToEntityShape(candidate, this.collider?.x ?? this.x, this.collider?.y ?? this.y)
                <= finite(hoof.triggerRange, 420)).length;
        if (this._cooldownReady('hoof_sequence_body') && nearby >= finite(hoof.minTargets, 2)) {
            return 'hoof_sequence_body';
        }
        const toll = this._skill('double_toll_body');
        if (this._cooldownReady('double_toll_body') && distance <= finite(toll.outerRadius, 360)) {
            return 'double_toll_body';
        }
        const antler = this._skill('antler_body');
        if (this._cooldownReady('antler_body') && distance <= finite(antler.range, 230)) return 'antler_body';
        return null;
    }

    _prepareAction(action, target) {
        const snap = this._actionSnapshot;
        if (action === 'antler_body') {
            this._antlerWarning = this._rangeWarning(
                snap.sourceX, snap.sourceY, snap.groundAngle,
                finite(this._actionCfg.range, 230), finite(this._actionCfg.arcDegrees, 70) * Math.PI / 180,
                'sector', this._actionDuration + 100
            );
        } else if (action === 'hoof_sequence_body') {
            const cfg = this._actionCfg;
            const targetPoint = entityPoint(target);
            const radius = finite(cfg.patternRadius, 135);
            const base = Math.atan2(
                (targetPoint.y - snap.sourceY) / PERSPECTIVE_SCALE_Y,
                targetPoint.x - snap.sourceX
            );
            this._hoofPoints = [0, 1, 2, 3].map((index) => groundPoint(
                targetPoint.x, targetPoint.y, base + Math.PI / 4 + index * Math.PI / 2, radius
            ));
            this._hoofWarnings = this._hoofPoints.map((point) => this._trackWarning(
                createGroundWarning(
                    point.x, point.y, finite(cfg.radius, 105), finite(cfg.radius, 105)
                )
            ));
        } else if (action === 'long_tone_body') {
            const cfg = this._actionCfg;
            this._longToneWarning = this._rangeWarning(
                snap.sourceX, snap.sourceY, snap.groundAngle,
                finite(cfg.range, 620), finite(cfg.width, 120), 'triangle',
                this._actionDuration + 100
            );
        }
    }

    _onActionEvent(action, frame) {
        const snap = this._actionSnapshot;
        if (!snap) return;
        if (action === 'antler_body') {
            const cfg = this._actionCfg;
            this._antlerWarning = this._releaseRangeWarning(this._antlerWarning);
            const shape = new GroundSector(
                snap.sourceX, snap.sourceY, snap.groundAngle,
                finite(cfg.range, 230), finite(cfg.arcDegrees, 70) * Math.PI / 180,
                surfaceEffectFromEntity(this)
            );
            this._damageTargetsInShape(shape, cfg, 'whiteSilenceAntler', {
                afterHit: (target) => target.applyCripple?.(finite(cfg.crippleMs, 1000)),
            });
        } else if (action === 'double_toll_body') {
            const frames = this._eventFramesFor(action, this._actionCfg);
            if (frame === frames[0]) {
                this._tollWarning = this._trackWarning(createGroundWarning(
                    snap.sourceX, snap.sourceY,
                    finite(this._actionCfg.outerRadius, 360), finite(this._actionCfg.outerRadius, 360)
                ));
                this._tollSafeWarning = this._rangeWarning(
                    snap.sourceX, snap.sourceY, 0,
                    finite(this._actionCfg.innerRadius, 190), finite(this._actionCfg.innerRadius, 190),
                    'circle', Math.max(100, this._actionTimer + 100)
                );
                return;
            }
            this._tollWarning = this._releaseWarning(this._tollWarning);
            this._tollSafeWarning = this._releaseRangeWarning(this._tollSafeWarning);
            const cfg = this._actionCfg;
            this._damageAnnulus(
                snap.sourceX, snap.sourceY,
                finite(cfg.innerRadius, 190), finite(cfg.outerRadius, 360),
                cfg, 'whiteSilenceDoubleToll', finite(cfg.maxHitsPerTarget, 1)
            );
            this._tollCount += 1;
            if (this._rhythmShifted && this._tollCount % 2 === 0) {
                this._pendingThirdEcho = {
                    x: snap.sourceX, y: snap.sourceY,
                    timer: finite(cfg.thirdEchoDelayMs, 750),
                };
            }
            fireGroundShockwave({ x: snap.sourceX, y: snap.sourceY, maxRadius: finite(cfg.outerRadius, 360), duration: 620 });
        } else if (action === 'hoof_sequence_body') {
            const frames = this._eventFramesFor(action, this._actionCfg);
            const index = Math.max(0, frames.indexOf(frame));
            const point = this._hoofPoints?.[index];
            if (!point) return;
            this._hoofWarnings[index] = this._releaseWarning(this._hoofWarnings[index]);
            const cfg = this._actionCfg;
            const shape = new GroundEllipse(
                point.x, point.y, finite(cfg.radius, 105), finite(cfg.radius, 105) * PERSPECTIVE_SCALE_Y,
                surfaceEffectFromEntity(this)
            );
            this._damageTargetsInShape(shape, cfg, `whiteSilenceHoof${index + 1}`, {
                originX: point.x, originY: point.y,
                maxHits: finite(cfg.maxHitsPerTarget, 2), isMelee: false,
            });
            fireGroundShockwave({ x: point.x, y: point.y, maxRadius: finite(cfg.radius, 105), duration: 360 });
        } else if (action === 'long_tone_body') {
            if (this._longToneWarning) {
                this._longToneWarning = this._releaseRangeWarning(this._longToneWarning);
            }
            const cfg = this._actionCfg;
            const shape = new GroundDirectedRect(
                snap.sourceX, snap.sourceY, snap.groundAngle,
                finite(cfg.range, 620), finite(cfg.width, 120), 0,
                surfaceEffectFromEntity(this)
            );
            this._damageTargetsInShape(shape, cfg, 'whiteSilenceLongTone', {
                isMelee: false,
                afterHit: (target) => target.applyStun?.(finite(cfg.stunMs, 700)),
            });
            const end = groundPoint(snap.sourceX, snap.sourceY, snap.groundAngle, finite(cfg.range, 620));
            spawnRailgunBeam({
                x: snap.sourceX, y: snap.sourceY, endX: end.x, endY: end.y,
                duration: finite(cfg.beamDurationMs, 480), widthScale: 1.4,
            });
        } else if (action === 'rhythm_shift_body') {
            this._phasePending = false;
            this._rhythmShifted = true;
            fireGroundShockwave({
                x: snap.sourceX, y: snap.sourceY, maxRadius: 330,
                strokeColor: 0xf2ffff, fillColor: 0xafd5e5, duration: 760,
            });
        }
    }

    _cancelActionArtifacts() {
        this._antlerWarning = null;
        this._pendingThirdEcho = null;
        this._hoofPoints = null;
        this._hoofWarnings = null;
        this._tollWarning = null;
        this._tollSafeWarning = null;
        if (this._longToneWarning) {
            this._longToneWarning = this._releaseRangeWarning(this._longToneWarning);
        }
    }
}
