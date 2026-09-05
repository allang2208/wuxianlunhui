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
        this._prevNoCollision = this.noCollision;

        this._preserveCorpse = true;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._syncApproachProfile();
    }

    _skill(key) {
        return this.config?.attackSkills?.[key] || {};
    }

    _layout(key = this._animState) {
        const layouts = this.config?.textures?.frameLayouts || {};
        return layouts[key] || layouts.idle || {
            frameWidth: 320,
            frameHeight: 512,
            frameCount: 1,
            footY: 490,
            authoredBodyHeight: 460,
        };
    }

    _syncApproachProfile() {
        const smash = this._skill('crystalArmSmash');
        const borequake = this._skill('borequake');
        const rush = this._skill('drillRush');
        let reach = Number(smash.approachReach) || 250;
        if ((this._cooldowns?.borequake || 0) <= 0) {
            reach = Math.max(reach, Number(borequake.triggerRange) || 320);
        }
        if ((this._cooldowns?.drillRush || 0) <= 0) {
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
        attack.maxCooldown = Number(smash.cooldown) || 5200;
        attack.baseMaxCooldown = attack.maxCooldown;
    }

    updateWhilePetrified(dt) {
        if (this._action) this._finishAction();
        if (this._pendingThrust?.active) this._pendingThrust.active = false;
        this._clearAttackTelegraph?.();
        super.updateWhilePetrified(dt);
    }

    _onCombatActionInterruptedByControl() {
        if (this._action) this._finishAction();
        super._onCombatActionInterruptedByControl();
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateDeathSequence(dt);
            return;
        }

        super.update(dt, entities);
        if (!this.active) return;
        this._lastEntities = entities;
        const delta = Math.max(0, Number(dt) || 0);
        const cooldownDt = typeof this.getAttackIntervalDelta === 'function'
            ? this.getAttackIntervalDelta(delta)
            : delta;
        this._cooldowns.borequake = Math.max(0, this._cooldowns.borequake - cooldownDt);
        this._cooldowns.drillRush = Math.max(0, this._cooldowns.drillRush - cooldownDt);

        const controlled = this.hasStatusEffect
            && (this.hasStatusEffect('stun')
                || this.hasStatusEffect('frozen')
                || this.hasStatusEffect('petrified')
                || this.hasStatusEffect('fear'));
        if (this._action) {
            if (controlled) this._finishAction();
            else this._updateAction(delta);
            return;
        }

        this._frozenForCast = false;
        this._attackAnimTimer = 0;
        this._syncApproachProfile();
        const speed = Math.hypot(this.vx, this.vy);
        const next = speed > (this.maxSpeed || this.speed || 145) * 0.05 ? 'walking' : 'idle';
        this._animStateTimer += delta;
        if (next !== this._animState && this._animStateTimer >= 80) {
            this._animState = next;
            this._animStateTimer = 0;
        }
        if (speed > 0.1) this.rotation = Math.atan2(this.vy, this.vx);
    }

    triggerWeaponAnim() {
        if (this._action || !this.active) return false;
        const pending = this._pendingThrust?.active ? this._pendingThrust : null;
        const target = pending?.primaryTarget || this.target;
        if (!this._isValidTarget(target)) return false;
        // 通用 ThrustAttack 仅负责起手与冷却调度；三个专属动作拥有唯一命中源。
        if (pending) pending.active = false;

        const sourceX = this.collider?.x ?? this.x;
        const sourceY = this.collider?.y ?? this.y;
        const distance = distanceToEntityShape(target, sourceX, sourceY);
        const borequake = this._skill('borequake');
        const rush = this._skill('drillRush');
        const smash = this._skill('crystalArmSmash');
        let action = null;
        if (this._cooldowns.borequake <= 0
            && distance <= (Number(borequake.triggerRange) || 320)) {
            action = 'borequake';
        } else if (this._cooldowns.drillRush <= 0
            && !this.hasStatusEffect('bind')
            && distance >= (Number(rush.minTriggerRange) || 260)
            && distance <= (Number(rush.triggerRange) || 760)) {
            action = 'drillRush';
        } else if (distance <= (Number(smash.range) || 275)) {
            action = 'crystalArmSmash';
        }
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
        const duration = Math.max(1, Number(cfg.duration) || 5083);

        this._action = action;
        this._actionCfg = cfg;
        this._actionDuration = duration;
        this._actionTimer = duration;
        this._actionTarget = target;
        this._actionSnapshot = { sourceX, sourceY, worldAngle, groundAngle };
        this._actionHitDone = false;
        this._animState = action;
        this._animStateTimer = 0;
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
            this._prevNoCollision = this.noCollision;
        }
        return true;
    }

    _updateAction(dt) {
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
            const frameCount = Math.max(1, Number(this._actionCfg?.frames) || 61);
            const frameMs = this._actionDuration / frameCount;
            const hitFrame = Number(
                this._actionCfg?.contactFrame
                ?? this._actionCfg?.releaseFrame
                ?? this._actionCfg?.impactFrame
                ?? 0
            );
            const hitMs = Math.max(0, hitFrame) * frameMs;
            if (!this._actionHitDone && elapsedBefore < hitMs && elapsedAfter >= hitMs) {
                this._actionHitDone = true;
                this._resolveActionHit();
            }
        }
        if (this._actionTimer <= 0) this._finishAction();
    }

    _updateDrillRushMotion(elapsedBefore, elapsedAfter) {
        if (this.hasStatusEffect('bind')) {
            this._stopChargeMotion();
            return;
        }
        const cfg = this._actionCfg || {};
        const prepareMs = Math.max(0, Number(cfg.prepareMs) || 1500);
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
        const result = DamagePipeline.applyHit(this, target, {
            damage: this._scaledDamage(cfg),
            damageType: cfg.damageType || 'physical',
            knockback: 0,
            angle: this._actionSnapshot?.worldAngle ?? this.rotation,
            isMelee: true,
            confirmedHitContext: { skillId: 'sealedShaftDrillRush' },
        });
        if (!result.hit) return;
        const parried = !!target.shieldSystem?._lastParried;
        if (parried) return;
        const angle = this._actionSnapshot?.worldAngle ?? this.rotation;
        const knockback = Math.max(0, Number(cfg.knockback) || 240);
        if (knockback > 0) target.applyKnockback?.(angle, knockback);
        const stunMs = Math.max(0, Number(cfg.stunMs) || 1800);
        if (stunMs > 0) target.applyStun?.(stunMs);
    }

    _damageTargetsInShape(shape, cfg, skillId, originX, originY, afterHit, isMelee) {
        for (const target of this._collectTargets()) {
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
            if (!result.hit) continue;
            const parried = !!(isMelee && target.shieldSystem?._lastParried);
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
        const tx = target.collider?.x ?? target.x;
        const ty = target.collider?.y ?? target.y;
        const ignore = target._coverSeg ? { segs: new Set([target._coverSeg]) } : null;
        if (!WallSystem?.blocked?.(originX, originY, tx, ty, ignore)) return false;
        return !(target._isDefenseStructure
            && distanceToEntityShape(target, originX, originY)
                <= Math.max(
                    1,
                    Number(this._actionCfg?.range)
                        || Number(this._actionCfg?.radiusX)
                        || 275
                ));
    }

    _stopChargeMotion() {
        if (this._chargeStopped) return;
        this._chargeStopped = true;
        this._chargePhase = 'recovery';
        this.noCollision = this._prevNoCollision;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
    }

    _finishAction() {
        this._stopChargeMotion();
        this.noCollision = this._prevNoCollision;
        this._chargePhase = 'idle';
        this._chargeTraveled = 0;
        this._chargeStopped = true;
        this._action = null;
        this._actionCfg = null;
        this._actionDuration = 0;
        this._actionTimer = 0;
        this._actionTarget = null;
        this._actionSnapshot = null;
        this._actionHitDone = false;
        this._attackAnimTimer = 0;
        this._frozenForCast = false;
        this._animState = 'idle';
        this._animStateTimer = 0;
        this.aiTimer = 0;
        this._syncApproachProfile();
    }

    onDeath(source) {
        if (!this.active) return;
        this._finishAction();
        this.active = false;
        this._animState = 'dying';
        const death = this.config?.death || {};
        this._deathAnimTimer = Math.max(1, Number(death.animMs) || 3417);
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        if (typeof super.onDeath === 'function') super.onDeath(source);
    }

    _updateDeathSequence(dt) {
        const death = this.config?.death || {};
        if (this._deathAnimTimer > 0) {
            this._deathAnimTimer = Math.max(0, this._deathAnimTimer - dt);
            if (this._deathAnimTimer <= 0) this._corpseTimer = Number(death.holdMs) || 1600;
        } else if (this._corpseTimer > 0) {
            this._corpseTimer = Math.max(0, this._corpseTimer - dt);
            if (this._corpseTimer <= 0) this._fadeTimer = Number(death.fadeMs) || 300;
        } else if (this._fadeTimer > 0) {
            this._fadeTimer = Math.max(0, this._fadeTimer - dt);
            const fadeMs = Number(death.fadeMs) || 300;
            if (this._phaserSprite?.active) {
                this._phaserSprite.setAlpha(Math.max(0, this._fadeTimer / fadeMs));
                if (this._fadeTimer <= 0) {
                    this._phaserSprite.destroy();
                    this._phaserSprite = null;
                }
            }
        }
    }

    _getTextureKey() {
        return `enemy_sealed_shaft_rock_wraith_${this._animState}`;
    }

    _getPhaserOptions() {
        const render = this.config?.render || {};
        const layout = this._layout();
        const targetBodyHeight = Math.max(1, Number(render.bodyDisplayHeight) || 260);
        const authoredBodyHeight = Math.max(1, Number(layout.authoredBodyHeight) || 460);
        const pixelScale = targetBodyHeight / authoredBodyHeight;
        const frameWidth = Math.max(1, Number(layout.frameWidth) || 320);
        const frameHeight = Math.max(1, Number(layout.frameHeight) || 544);
        const spriteSize = Math.max(frameWidth, frameHeight) * pixelScale;
        const footY = Number.isFinite(Number(layout.footY)) ? Number(layout.footY) : frameHeight;
        this.footOffsetY = (footY - frameHeight / 2) * pixelScale;

        let flipX = false;
        if (this._actionSnapshot) flipX = Math.cos(this._actionSnapshot.worldAngle) < 0;
        else if (this.isMoving && Math.abs(this.vx) > 0.1) flipX = this.vx < 0;
        else flipX = Math.cos(this.rotation || 0) < 0;

        const oneShot = this._animState === 'crystalArmSmash'
            || this._animState === 'borequake'
            || this._animState === 'drillRush';
        const animState = this._animState === 'dying'
            ? 'death'
            : (oneShot ? 'attack' : (this._animState === 'walking' ? 'walk' : 'idle'));
        return {
            spriteSize,
            collisionWidth: Number(render.collisionWidth) || 124,
            collisionHeight: Number(render.collisionHeight) || 235,
            textOffsetY: -(Number(render.collisionHeight) || 235) - 18,
            flipX,
            animState,
            animKey: `enemy_sealed_shaft_rock_wraith_${this._animState}`,
            dynamicSpriteSize: true,
        };
    }
}
