import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { DamagePipeline } from '../../combat/damage-pipeline.js';
import { isFriendlyFire } from '../damageable-entity.js';
import { PartySystem } from '../../systems/party-system.js';
import { distanceToEntityShape } from '../../utils/collision-helpers.js';
import { GroundDirectedRect, GroundEllipse, GroundSector } from '../../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../../physics/elevation.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { WallSystem } from '../../world/wall-system.js';

/**
 * 断索狱监（废弃矿洞专属领主）
 *
 * 三个攻击共享一个显式动作时钟：断链横扫负责近中距扇形压制，投钩收绞
 * 锁定单体并在收索帧拉回，囚笼镇压在前方落点结算范围眩晕。所有命中帧
 * 都来自最终 RIFE 表，长帧跨阈值时仍只结算一次。
 */
export class BrokenCableGaoler extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.brokenCableGaoler,
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
        this._actionReturnDone = false;
        this._hookedTarget = null;
        this._lastEntities = null;
        this._cooldowns = {
            hookWinch: Math.max(0, Number(this._skill('hookWinch').initialCooldownMs) || 0),
            cageSlam: Math.max(0, Number(this._skill('cageSlam').initialCooldownMs) || 0),
        };

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
            frameWidth: 640,
            frameHeight: 448,
            frameCount: 1,
            footY: 407,
            authoredBodyHeight: 374,
        };
    }

    _syncApproachProfile() {
        const sweep = this._skill('chainSweep');
        const hook = this._skill('hookWinch');
        const hookReady = (this._cooldowns?.hookWinch || 0) <= 0;
        const reach = hookReady
            ? (Number(hook.triggerRange) || 850)
            : (Number(sweep.approachReach) || 280);
        this.attackRange = reach;
        this.attackDistance = reach;
        this.config.basicMelee = {
            ...(this.config.basicMelee || {}),
            approachReach: reach,
            impactReach: reach,
            width: hookReady ? (Number(hook.width) || 110) : (Number(sweep.width) || 150),
            requiresSameSurface: true,
            requiresLosAtImpact: true,
        };
        const attack = this.attacks?.melee;
        if (!attack) return;
        attack.config.range = reach;
        attack.config.dynamicRange = reach;
        attack.range = reach;
        attack.maxCooldown = Number(sweep.cooldown) || 5200;
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
        this._cooldowns.hookWinch = Math.max(0, this._cooldowns.hookWinch - cooldownDt);
        this._cooldowns.cageSlam = Math.max(0, this._cooldowns.cageSlam - cooldownDt);

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
        const next = speed > (this.maxSpeed || this.speed || 135) * 0.05 ? 'walking' : 'idle';
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
        // ThrustAttack 只借用起手/冷却调度；三种专属动作各自拥有唯一命中源。
        if (pending) pending.active = false;

        const originX = this.collider?.x ?? this.x;
        const originY = this.collider?.y ?? this.y;
        const distance = distanceToEntityShape(target, originX, originY);
        const cage = this._skill('cageSlam');
        const hook = this._skill('hookWinch');
        const sweep = this._skill('chainSweep');
        let action = null;
        if (this._cooldowns.cageSlam <= 0
            && distance <= (Number(cage.triggerRange) || 190)) {
            action = 'cageSlam';
        } else if (this._cooldowns.hookWinch <= 0
            && distance >= (Number(hook.minTriggerRange) || 240)
            && distance <= (Number(hook.triggerRange) || 850)) {
            action = 'hookWinch';
        } else if (distance <= (Number(sweep.approachReach) || 280)) {
            action = 'chainSweep';
        }
        if (!action) return false;
        return this._startAction(action, target);
    }

    _startAction(action, target) {
        const cfg = this._skill(action);
        const sourceX = this.collider?.x ?? this.x;
        const sourceY = this.collider?.y ?? this.y;
        const targetX = target.collider?.x ?? target.x;
        const targetY = target.collider?.y ?? target.y;
        const dx = targetX - sourceX;
        const dy = targetY - sourceY;
        const worldAngle = Math.atan2(dy, dx);
        const groundAngle = Math.atan2(dy / PERSPECTIVE_SCALE_Y, dx);
        const duration = Math.max(1, Number(cfg.duration) || 4583);

        this._action = action;
        this._actionCfg = cfg;
        this._actionDuration = duration;
        this._actionTimer = duration;
        this._actionTarget = target;
        this._actionSnapshot = { sourceX, sourceY, worldAngle, groundAngle };
        this._actionHitDone = false;
        this._actionReturnDone = false;
        this._hookedTarget = null;
        this._animState = action;
        this._animStateTimer = 0;
        this._frozenForCast = true;
        this._attackAnimTimer = duration;
        this.rotation = worldAngle;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;

        if (action === 'hookWinch') {
            this._cooldowns.hookWinch = Math.max(0, Number(cfg.cooldown) || 12000);
        } else if (action === 'cageSlam') {
            this._cooldowns.cageSlam = Math.max(0, Number(cfg.cooldown) || 10000);
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
        const frameCount = Math.max(1, Number(this._actionCfg?.frames) || 55);
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

        if (this._action === 'hookWinch') {
            const returnMs = Math.max(0, Number(this._actionCfg.returnFrame) || 42) * frameMs;
            if (!this._actionReturnDone && elapsedBefore < returnMs && elapsedAfter >= returnMs) {
                this._actionReturnDone = true;
                this._resolveHookReturn();
            }
        }
        if (this._actionTimer <= 0) this._finishAction();
    }

    _resolveActionHit() {
        if (this._action === 'chainSweep') this._resolveChainSweep();
        else if (this._action === 'hookWinch') this._resolveHookRelease();
        else if (this._action === 'cageSlam') this._resolveCageSlam();
    }

    _resolveChainSweep() {
        const cfg = this._actionCfg || {};
        const snap = this._actionSnapshot;
        if (!snap) return;
        const shape = new GroundSector(
            snap.sourceX,
            snap.sourceY,
            snap.groundAngle,
            Math.max(1, Number(cfg.range) || 280),
            Math.max(1, Number(cfg.arcDegrees) || 210) * Math.PI / 180,
            surfaceEffectFromEntity(this)
        );
        this._damageTargetsInShape(shape, cfg, 'brokenCableChainSweep', snap.sourceX, snap.sourceY);
    }

    _resolveHookRelease() {
        const cfg = this._actionCfg || {};
        const snap = this._actionSnapshot;
        const target = this._actionTarget;
        if (!snap || !this._isValidTarget(target)) return;
        const shape = new GroundDirectedRect(
            snap.sourceX,
            snap.sourceY,
            snap.groundAngle,
            Math.max(1, Number(cfg.range) || 850),
            Math.max(1, Number(cfg.width) || 110),
            0,
            surfaceEffectFromEntity(this)
        );
        if (!shape.intersectsEntity(target) || this._isWallBlocked(target, snap.sourceX, snap.sourceY)) return;
        const result = DamagePipeline.applyHit(this, target, {
            damage: this._scaledDamage(cfg),
            damageType: cfg.damageType || 'physical',
            isMelee: true,
            confirmedHitContext: { skillId: 'brokenCableHookWinch' },
        });
        const parried = target.shieldSystem && target.shieldSystem._lastParried;
        if (!result.hit || parried) return;
        this._hookedTarget = target;
        if (Number(cfg.bindMs) > 0 && typeof target.addStatusEffect === 'function') {
            target.addStatusEffect('bind', Number(cfg.bindMs));
        }
    }

    _resolveHookReturn() {
        const target = this._hookedTarget;
        const cfg = this._actionCfg || {};
        if (!this._isValidTarget(target)) return;
        const tx = target.collider?.x ?? target.x;
        const ty = target.collider?.y ?? target.y;
        const sourceX = this.collider?.x ?? this.x;
        const sourceY = this.collider?.y ?? this.y;
        if (distanceToEntityShape(target, sourceX, sourceY) > (Number(cfg.range) || 850) + 32) return;
        if (this._isWallBlocked(target, sourceX, sourceY)) return;
        const pullAngle = Math.atan2(sourceY - ty, sourceX - tx);
        if (typeof target.applyKnockback === 'function') {
            target.applyKnockback(pullAngle, Math.max(0, Number(cfg.pullDistance) || 320));
        }
    }

    _resolveCageSlam() {
        const cfg = this._actionCfg || {};
        const snap = this._actionSnapshot;
        if (!snap) return;
        const forward = Math.max(0, Number(cfg.forwardOffset) || 135);
        const cx = snap.sourceX + Math.cos(snap.groundAngle) * forward;
        const cy = snap.sourceY
            + Math.sin(snap.groundAngle) * forward * PERSPECTIVE_SCALE_Y;
        const shape = new GroundEllipse(
            cx,
            cy,
            Math.max(1, Number(cfg.radiusX) || 190),
            Math.max(1, Number(cfg.radiusY) || 105),
            surfaceEffectFromEntity(this)
        );
        this._damageTargetsInShape(shape, cfg, 'brokenCableCageSlam', cx, cy, (target, parried) => {
            if (!parried && Number(cfg.stunMs) > 0 && typeof target.applyStun === 'function') {
                target.applyStun(Number(cfg.stunMs));
            }
        });
    }

    _damageTargetsInShape(shape, cfg, skillId, originX, originY, afterHit = null) {
        for (const target of this._collectTargets()) {
            if (!this._isValidTarget(target) || !shape.intersectsEntity(target)) continue;
            if (this._isWallBlocked(target, originX, originY)) continue;
            const tx = target.collider?.x ?? target.x;
            const ty = target.collider?.y ?? target.y;
            const angle = Math.atan2(ty - originY, tx - originX);
            const result = DamagePipeline.applyHit(this, target, {
                damage: this._scaledDamage(cfg),
                damageType: cfg.damageType || 'physical',
                knockback: Math.max(0, Number(cfg.knockback) || 0),
                angle,
                isMelee: true,
                confirmedHitContext: { skillId },
            });
            if (!result.hit) continue;
            const parried = target.shieldSystem && target.shieldSystem._lastParried;
            if (afterHit) afterHit(target, parried);
        }
    }

    _scaledDamage(cfg) {
        return Math.max(1, Math.round(
            (Number(this.data?.atk) || 1) * (Math.max(0, Number(cfg.damageMul) || 1))
        ));
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
                <= Math.max(1, Number(this._actionCfg?.range) || 280));
    }

    _finishAction() {
        this._action = null;
        this._actionCfg = null;
        this._actionDuration = 0;
        this._actionTimer = 0;
        this._actionTarget = null;
        this._actionSnapshot = null;
        this._hookedTarget = null;
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
            if (this._deathAnimTimer <= 0) this._corpseTimer = Number(death.holdMs) || 1400;
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
        return `enemy_broken_cable_gaoler_${this._animState}`;
    }

    _getPhaserOptions() {
        const render = this.config?.render || {};
        const layout = this._layout();
        const targetBodyHeight = Math.max(1, Number(render.bodyDisplayHeight) || 260);
        const authoredBodyHeight = Math.max(1, Number(layout.authoredBodyHeight) || 374);
        const pixelScale = targetBodyHeight / authoredBodyHeight;
        const frameWidth = Math.max(1, Number(layout.frameWidth) || 640);
        const frameHeight = Math.max(1, Number(layout.frameHeight) || 448);
        const spriteSize = Math.max(frameWidth, frameHeight) * pixelScale;
        const footY = Number.isFinite(Number(layout.footY)) ? Number(layout.footY) : frameHeight;
        this.footOffsetY = (footY - frameHeight / 2) * pixelScale;

        let flipX = false;
        if (this._actionSnapshot) flipX = Math.cos(this._actionSnapshot.worldAngle) < 0;
        else if (this.isMoving && Math.abs(this.vx) > 0.1) flipX = this.vx < 0;
        else flipX = Math.cos(this.rotation || 0) < 0;

        const oneShot = this._animState === 'chainSweep'
            || this._animState === 'hookWinch'
            || this._animState === 'cageSlam';
        const animState = this._animState === 'dying'
            ? 'death'
            : (oneShot ? 'attack' : (this._animState === 'walking' ? 'walk' : 'idle'));
        return {
            spriteSize,
            collisionWidth: Number(render.collisionWidth) || 118,
            collisionHeight: Number(render.collisionHeight) || 230,
            textOffsetY: -(Number(render.collisionHeight) || 230) - 18,
            flipX,
            animState,
            animKey: `enemy_broken_cable_gaoler_${this._animState}`,
            dynamicSpriteSize: true,
        };
    }
}
