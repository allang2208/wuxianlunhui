import { canMeleeShareSurface } from '../../combat/melee-surface.js';
import { hasAttackLineOfSight } from '../../combat/melee-reach.js';
import { canStartGroundSkill } from './_shared/attack-shapes.js';
import { startCorpseTimeline, updateCorpseTimeline } from './_shared/corpse-timeline.js';
import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { DamagePipeline } from '../../combat/damage-pipeline.js';
import { isFriendlyFire } from '../damageable-entity.js';
import { PartySystem } from '../../systems/party-system.js';
import { distanceToEntityShape } from '../../utils/collision-helpers.js';
import { GroundDirectedRect, GroundEllipse, GroundSector } from '../../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../../physics/elevation.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';

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
        this._heldActionFrame = null;
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
        this._syncVisualMetrics();
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
        const distance = this.target
            ? distanceToEntityShape(this.target, this.collider?.x ?? this.x, this.collider?.y ?? this.y)
            : Infinity;
        const hookReady = (this._cooldowns?.hookWinch || 0) <= 0
            && distance >= (Number(hook.minTriggerRange) || 240);
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
        attack.maxCooldown = Number(sweep.cooldown) || 3200;
        attack.baseMaxCooldown = attack.maxCooldown;
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateDeathSequence(dt);
            return;
        }

        super.update(dt, entities);
        // 基类状态/DOT可能同步致死，不能再用待机覆盖刚开始的死亡动画。
        if (!this.active || this._isDead) return;
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

        if (this._heldActionFrame !== null) this._setVisualState('idle');

        this._frozenForCast = false;
        this._attackAnimTimer = 0;
        this._syncApproachProfile();
        const speed = Math.hypot(this.vx, this.vy);
        const next = speed > (this.maxSpeed || this.speed || 135) * 0.05 ? 'walking' : 'idle';
        if (!this.hasStatusEffect?.('frozen')) this._animStateTimer += delta;
        if (next !== this._animState && this._animStateTimer >= 80) {
            this._setVisualState(next);
        }
        if (speed > 0.1) this.rotation = Math.atan2(this.vy, this.vx);
        // 行走逐帧腰胯锚点和贴图必须使用同一时钟，且早于场景的位置同步。
        this._syncVisualMetrics();
    }

    _selectAttackAction(target) {
        if (this._action || this.isCombatActionBlocked() || !this._isValidTarget(target)
            || !canMeleeShareSurface(this, target)) return null;
        const distance = distanceToEntityShape(target, this.collider?.x ?? this.x, this.collider?.y ?? this.y);
        const cage = this._skill('cageSlam'), hook = this._skill('hookWinch'), sweep = this._skill('chainSweep');
        if (this._cooldowns.cageSlam <= 0 && distance <= (cage.triggerRange || 190)
            && canStartGroundSkill(this, target, { kind: 'ellipse', radiusX: cage.radiusX || 190, radiusY: cage.radiusY || 105, forwardOffset: cage.forwardOffset || 135 })) return 'cageSlam';
        if (this._cooldowns.hookWinch <= 0 && distance >= (hook.minTriggerRange || 240)
            && canStartGroundSkill(this, target, { range: Math.min(hook.triggerRange || 850, hook.range || 850), width: hook.width || 110 })) return 'hookWinch';
        if (canStartGroundSkill(this, target, { kind: 'sector', range: Math.min(sweep.approachReach || 280, sweep.range || 280), arcDegrees: sweep.arcDegrees || 210 })) return 'chainSweep';
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
            || enemyConfigData.brokenCableGaoler.attackSkills[action].duration);

        this._action = action;
        this._actionCfg = cfg;
        this._actionDuration = duration;
        this._actionTimer = duration;
        this._actionTarget = target;
        this._actionSnapshot = { sourceX, sourceY, worldAngle, groundAngle };
        this._actionHitDone = false;
        this._actionReturnDone = false;
        this._hookedTarget = null;
        this._setVisualState(action);
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
        const action = this._action;
        const previous = this._actionTimer;
        this._actionTimer = Math.max(0, previous - dt);
        this._attackAnimTimer = this._actionTimer;
        this._frozenForCast = true;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        if (this._actionSnapshot) this.rotation = this._actionSnapshot.worldAngle;
        this._syncVisualMetrics();

        const elapsedBefore = this._actionDuration - previous;
        const elapsedAfter = this._actionDuration - this._actionTimer;
        const frameCount = Math.max(1, Number(this._layout(action).frameCount) || Number(this._actionCfg?.frames) || 55);
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
            if (!this.active || this._action !== action) return;
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
        const parried = result.parried;
        if (!result.hit || parried || !this.active || this._action !== 'hookWinch') return;
        this._hookedTarget = target;
        if (Number(cfg.bindMs) > 0 && typeof target.addStatusEffect === 'function') {
            target.addStatusEffect('bind', Number(cfg.bindMs));
        }
    }

    _resolveHookReturn() {
        const target = this._hookedTarget;
        const cfg = this._actionCfg || {};
        if (this.isCombatActionBlocked() || !this._isValidTarget(target) || !canMeleeShareSurface(this, target)) return;
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
        const action = this._action;
        const actionSnapshot = this._actionSnapshot;
        for (const target of this._collectTargets()) {
            if (this.isCombatActionBlocked() || this._actionSnapshot !== actionSnapshot) break;
            if (!this.active || this._action !== action) return;
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
            if (this.isCombatActionBlocked() || this._actionSnapshot !== actionSnapshot) break;
            if (!result.hit || !target.active || target._isDead) continue;
            if (!this.active || this._action !== action) return;
            const parried = result.parried;
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
        const snap = this._actionSnapshot;
        return !hasAttackLineOfSight(this, target, originX, originY)
            || (snap && !hasAttackLineOfSight(this, target, snap.sourceX, snap.sourceY));
    }

    _finishAction(preservePose = false) {
        const heldFrame = preservePose ? this._getActionFrame() : null;
        this._action = null;
        this._actionCfg = null;
        this._actionDuration = 0;
        this._actionTimer = 0;
        this._actionTarget = null;
        this._actionSnapshot = null;
        this._hookedTarget = null;
        this._attackAnimTimer = 0;
        this._frozenForCast = false;
        if (preservePose) {
            this._heldActionFrame = heldFrame;
            this._syncVisualMetrics();
        } else {
            this._setVisualState('idle');
        }
        this.aiTimer = 0;
        this._syncApproachProfile();
    }

    _onCombatActionInterruptedByControl() {
        if (this._action) this._finishAction(!!this.hasStatusEffect?.('petrified'));
        super._onCombatActionInterruptedByControl();
    }

    updateWhilePetrified(dt) {
        // 石化走专用主循环，仍须作废动作；保留当前姿态供黑白定格，解控不补打。
        if (this._action) this._finishAction(true);
        super.updateWhilePetrified(dt);
    }

    onDeath(source) {
        if (!this.active) return;
        this._finishAction();
        this.active = false;
        const death = this.config?.death || {};
        startCorpseTimeline(this, { animMs: 3417, holdMs: 1400, fadeMs: 300, ...death });
        this._setVisualState('dying');
        if (typeof super.onDeath === 'function') super.onDeath(source);
    }

    _updateDeathSequence(dt) {
        updateCorpseTimeline(this, dt);
    }

    _getTextureKey() {
        return `enemy_broken_cable_gaoler_${this._animState}`;
    }

    _setVisualState(state) {
        this._animState = state;
        this._animStateTimer = 0;
        this._heldActionFrame = null;
        // 场景先同步位置再选帧；切动作时立即换脚线，避免读取上一动作的Y偏移。
        this._syncVisualMetrics();
    }

    _getActionFrame() {
        if (!['chainSweep', 'hookWinch', 'cageSlam'].includes(this._animState)) return undefined;
        if (this._heldActionFrame !== null) return this._heldActionFrame;
        const count = Math.max(1, Number(this._layout().frameCount) || 1);
        const duration = Math.max(1, this._actionDuration);
        const elapsed = Math.max(0, duration - this._actionTimer);
        return Math.min(count - 1, Math.floor(elapsed / duration * count));
    }

    _getVisualFrame() {
        const actionFrame = this._getActionFrame();
        if (actionFrame !== undefined) return actionFrame;
        const layout = this._layout();
        const count = Math.max(1, Number(layout.frameCount) || 1);
        if (this._animState === 'dying') {
            const duration = Math.max(1, Number(this.config?.death?.animMs) || 3417);
            const elapsed = Math.max(0, duration - this._deathAnimTimer);
            return Math.min(count - 1, Math.floor(elapsed / duration * count));
        }
        const frameRate = Math.max(1, Number(layout.frameRate) || 24);
        return Math.floor(this._animStateTimer * frameRate / 1000) % count;
    }

    _syncVisualMetrics(frame = this._getVisualFrame()) {
        const render = this.config?.render || {};
        const layout = this._layout();
        const targetBodyHeight = Math.max(1, Number(render.bodyDisplayHeight) || 260);
        const authoredBodyHeight = Math.max(1, Number(layout.authoredBodyHeight) || 374);
        const pixelScale = targetBodyHeight / authoredBodyHeight;
        const frameWidth = Math.max(1, Number(layout.frameWidth) || 640);
        const frameHeight = Math.max(1, Number(layout.frameHeight) || 448);
        this._visualSpriteSize = Math.max(frameWidth, frameHeight) * pixelScale;
        this._visualAnchorX = layout.anchorXByFrame?.[frame] ?? layout.anchorX ?? frameWidth / 2;
        const footY = layout.footYByFrame?.[frame] ?? layout.footY ?? frameHeight;
        this.footOffsetY = (footY - frameHeight / 2) * pixelScale;
    }

    _syncPetrifiedBodyAnchor(sprite) {
        // 石化跳过选帧，但场景仍重置显示位置；按真正冻结的帧保留主体锚点。
        const state = sprite.texture?.key?.replace('enemy_broken_cable_gaoler_', '');
        const layout = this.config?.textures?.frameLayouts?.[state];
        const frame = Number(sprite.frame?.name);
        if (!layout || !Number.isFinite(frame)) return;
        const scale = Math.abs(sprite.scaleX);
        const anchorX = layout.anchorXByFrame?.[frame] ?? layout.frameWidth / 2;
        const footY = layout.footYByFrame?.[frame] ?? layout.footY;
        sprite.x += (layout.frameWidth / 2 - anchorX) * scale * (sprite.flipX ? -1 : 1);
        sprite.y += this.footOffsetY - (footY - layout.frameHeight / 2) * scale;
    }

    _getPhaserOptions() {
        const render = this.config?.render || {};
        const frame = this._getVisualFrame();
        this._syncVisualMetrics(frame);
        let flipX = false;
        if (this._actionSnapshot) flipX = Math.cos(this._actionSnapshot.worldAngle) < 0;
        else if (this.isMoving && Math.abs(this.vx) > 0.1) flipX = this.vx < 0;
        else flipX = Math.cos(this.rotation || 0) < 0;

        return {
            spriteSize: this._visualSpriteSize,
            frameAnchorX: this._visualAnchorX,
            frame,
            manualFrame: true,
            collisionWidth: Number(render.collisionWidth) || 118,
            collisionHeight: Number(render.collisionHeight) || 230,
            textOffsetY: -(Number(render.collisionHeight) || 230) - 18,
            flipX,
            // 六动作共用实体时钟：逐帧主体锚点不会与 Phaser 自动播放错开一帧；
            // 尸体重新入镜时直接恢复死亡末帧，不再重播站立姿态。
            animState: undefined,
            animKey: `enemy_broken_cable_gaoler_${this._animState}`,
            dynamicSpriteSize: true,
        };
    }
}
