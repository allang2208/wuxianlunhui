import { beginFriendlyAttackClock, advanceFriendlyAttackClock } from '../combat/friendly-attack-timing.js';
import { canStartFriendlyMelee, lockFriendlyMelee, canHitFriendlyMelee } from '../combat/friendly-melee.js';
// ============================================================
// HamsterNinjaAI — 拔刀首击 / 连续斩 / 主动烟遁
// ============================================================
import { MovementSystem } from '../systems/movement-system.js';
import { EffectFactory } from '../utils/effect-factory.js';
import { SoundManager } from '../ui/sound-manager.js';
import {
    clearRtsSurfaceRoute,
    finishRtsCommandAtHold,
    resolveRtsMoveDestination,
    RTS_DEFAULT_ACQUIRE_RANGE,
} from './rts-command-utils.js';
import { canFinishSurfaceFollow } from './elevated-navigation-controller.js';
import { queryNearbyEntities, stableAiPhase } from './friendly-spatial-query.js';

export class HamsterNinjaAI {
    constructor(ninja) {
        this.m = ninja;
        this.cfg = ninja.aiConfig || {};
        this._decisionTimer = stableAiPhase(ninja, this.cfg.decisionMs ?? 120);
        this._attackTimer = 0;
        this._attackInterval = this.cfg.attackInterval ?? 1500;
        this._attackDamage = this.cfg.attackDamage ?? 120;
        this._attackRange = this.cfg.attackRange ?? 58;
        this._engageRange = RTS_DEFAULT_ACQUIRE_RANGE;
        this._followOffset = this.cfg.followOffset ?? 145;
        this._followArriveDist = this.cfg.followArriveDist ?? 40;
        this._openingDamageMul = this.cfg.openingDamageMul ?? 2;
        this._openingRearmMs = this.cfg.openingRearmMs ?? 4000;
        this._sinceLastAttackMs = this._openingRearmMs;

        this._swingActive = false;
        this._swingHitLeft = 0;
        this._swingAnimLeft = 0;
        this._swingVariant = 'opening';
        this._swingTarget = null;

        const stealth = this.cfg.stealth || {};
        const stealthAnim = ninja.animations?.stealth || {};
        this._stealthSpeedMul = stealth.speedMul ?? 1.3;
        this._stealthCooldownMs = stealth.cooldownMs ?? 12000;
        this._stealthCastMs = stealth.castMs
            ?? ((stealthAnim.frameCount ?? 35) / (stealthAnim.frameRate ?? 24) * 1000 + 50);
        this._stealthApplyMs = stealth.applyMs ?? 1125;
        this._stealthCastLeft = 0;
        this._stealthApplyLeft = 0;
        this._stealthAppliedThisCast = false;

        this._stuckTimer = 0;
        this._lastPosX = ninja.x;
        this._lastPosY = ninja.y;
        this._stuckStreak = 0;
    }

    cancelForCommand() {
        this._cancelSwing();
        return true;
    }

    setStealth(enable) {
        const m = this.m;
        if (m._dying || m.data.hp <= 0) return { ok: false, reason: '单位已失去行动能力' };
        if (!enable) {
            if (!m._isStealthed && !m._stealthCastActive) return { ok: false, reason: '当前未隐身' };
            this._cancelStealthCast();
            this._endStealth(true);
            return { ok: true, active: false };
        }
        if (m._isStealthed || m._stealthCastActive) return { ok: true, active: true };
        if (m._stealthCooldownLeft > 0) {
            return { ok: false, reason: `烟遁冷却 ${Math.ceil(m._stealthCooldownLeft / 1000)} 秒` };
        }
        this._cancelSwing();
        m.target = null;
        m._tacticalTarget = null;
        m.vx = 0;
        m.vy = 0;
        m.isMoving = false;
        m.maxSpeed = 0;
        m._stealthCastActive = true;
        m._stealthCastSeq = (Number(m._stealthCastSeq) || 0) + 1;
        m._animState = 'stealth';
        this._stealthCastLeft = this._stealthCastMs;
        this._stealthApplyLeft = this._stealthApplyMs;
        this._stealthAppliedThisCast = false;
        return { ok: true, active: true, casting: true };
    }

    update(dt, entities, player) {
        const m = this.m;
        if (m._dying || m.data.hp <= 0) return;

        this._attackTimer = Math.max(0, this._attackTimer - dt);
        this._sinceLastAttackMs += dt;
        if (!m._openingStrikeArmed && this._sinceLastAttackMs >= this._openingRearmMs) {
            m._openingStrikeArmed = true;
        }

        if (m._stealthCastActive) {
            this._updateStealthCast(dt);
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
        if (this._swingActive || m._stealthCastActive) return;

        MovementSystem.update(m, dt, entities);
        this._checkStuck(dt);
        if (m._animState === 'idle' && Math.hypot(m.vx || 0, m.vy || 0) > 25) {
            m._animState = 'walk';
        }
    }

    _updateStealthCast(dt) {
        const m = this.m;
        m.vx = 0;
        m.vy = 0;
        m.isMoving = false;
        m.maxSpeed = 0;
        m._animState = 'stealth';
        this._stealthCastLeft -= dt;
        this._stealthApplyLeft -= dt;
        if (!this._stealthAppliedThisCast && this._stealthApplyLeft <= 0) {
            this._stealthAppliedThisCast = true;
            m._applyStealthState(true);
            this._playSound('stealth');
            for (let i = 0; i < 4; i++) {
                EffectFactory.createSmokeEffect(
                    m.x + (Math.random() - 0.5) * 18,
                    m.y + (Math.random() - 0.5) * 9
                );
            }
        }
        if (this._stealthCastLeft > 0) return;
        m._stealthCastActive = false;
        m._animState = 'idle';
    }

    _cancelStealthCast() {
        this.m._stealthCastActive = false;
        this._stealthCastLeft = 0;
        this._stealthApplyLeft = 0;
        this._stealthAppliedThisCast = false;
        if (this.m._animState === 'stealth') this.m._animState = 'idle';
    }

    _endStealth(startCooldown) {
        const wasActive = this.m._isStealthed;
        this.m._applyStealthState(false);
        if ((wasActive || startCooldown) && startCooldown) {
            this.m._stealthCooldownLeft = this._stealthCooldownMs;
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
            if (this._canStrike(enemy)) {
                this._faceTarget(enemy);
                if (this._attackTimer <= 0) this._startSwing(enemy);
                else this._stopAtTarget();
            } else {
                this._moveToward({ x: enemy.x, y: enemy.y });
            }
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
            if (!move.arrived) this._moveToward(move.destination);
            else {
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
            if (this._canStrike(target)) {
                this._faceTarget(target);
                if (this._attackTimer <= 0) this._startSwing(target);
                else this._stopAtTarget();
            } else {
                this._moveToward({ x: target.x, y: target.y });
            }
            return;
        }
        m.target = null;
        this._stopAtTarget();
    }

    _startSwing(target) {
        const m = this.m;
        if (m._isStealthed) this._endStealth(true);
        this._cancelStealthCast();
        this._swingVariant = m._openingStrikeArmed ? 'opening' : 'continuous';
        m._openingStrikeArmed = false;
        m._attackVariant = this._swingVariant;
        m._attackSwingSeq = (Number(m._attackSwingSeq) || 0) + 1;
        this._sinceLastAttackMs = 0;
        this._attackTimer = this._attackInterval;
        this._swingTarget = target;

        const animation = this._swingVariant === 'opening'
            ? m.animations?.attack_opening
            : m.animations?.attack_continuous;
        const fps = animation?.frameRate ?? 24;
        const frameCount = animation?.frameCount ?? 35;
        const damageFrame = this._swingVariant === 'opening'
            ? (this.cfg.openingDamageFrame ?? 17)
            : (this.cfg.continuousDamageFrame ?? 25);
        this._swingHitLeft = Math.max(0, (damageFrame - 1) / fps * 1000);
        this._swingAnimLeft = frameCount / fps * 1000 + 60;
        beginFriendlyAttackClock(this, `attack_${this._swingVariant}`, this._swingAnimLeft, { state: 'attack' });
        lockFriendlyMelee(this, target, this._swingVariant === 'continuous'
            ? (this.cfg.continuousImpactRange ?? this.cfg.attackImpactRange ?? this._attackRange)
            : (this.cfg.attackImpactRange ?? this._attackRange));
        this._swingActive = true;
        m._animState = 'attack';
        m._tacticalTarget = null;
        m.vx = 0;
        m.vy = 0;
        m.isMoving = false;
        m.maxSpeed = 0;
    }

    _updateSwing(dt) {
        const m = this.m;
        dt = advanceFriendlyAttackClock(m, dt);
        m.vx = 0;
        m.vy = 0;
        m.isMoving = false;
        m.maxSpeed = 0;
        m._animState = 'attack';
        this._swingHitLeft -= dt;
        if (this._swingHitLeft <= 0) {
            this._applyDamage();
            this._swingHitLeft = Number.POSITIVE_INFINITY;
        }
        this._swingAnimLeft -= dt;
        if (this._swingAnimLeft > 0) return;
        this._swingActive = false;
        this._swingTarget = null;
        m._animState = 'idle';
    }

    _cancelSwing() {
        this._swingActive = false;
        this._swingHitLeft = 0;
        this._swingAnimLeft = 0;
        this._swingTarget = null;
        if (this.m._animState === 'attack') this.m._animState = 'idle';
        this.m.vx = 0;
        this.m.vy = 0;
        this.m.isMoving = false;
        this.m.maxSpeed = 0;
    }

    _applyDamage() {
        const target = this._swingTarget;
        if (!canHitFriendlyMelee(this, target)) return;
        const multiplier = this._swingVariant === 'opening' ? this._openingDamageMul : 1;
        target.takeDamage?.(
            this.m.getPhysicalAttackDamage(this._attackDamage * multiplier, target),
            this.m,
            'physical',
            true
        );
        this._playSound(this._swingVariant === 'continuous' && this.m.sounds?.attackContinuous
            ? 'attackContinuous' : 'attack');
    }

    _moveSpeed() {
        const base = this.cfg.walkSpeed ?? 180;
        return base * (this.m._isStealthed ? this._stealthSpeedMul : 1);
    }

    _moveToward(target) {
        this.m._tacticalTarget = target;
        this.m._animState = 'walk';
        this.m.maxSpeed = this._moveSpeed();
    }

    _followPlayer(player) {
        if (!player) {
            this._stopAtTarget();
            return;
        }
        const target = { x: player.x - this._followOffset, y: player.y, _surfaceTarget: player };
        const distance = Math.hypot(target.x - this.m.x, target.y - this.m.y);
        if (distance <= this._followArriveDist && canFinishSurfaceFollow(this.m, player)) {
            this._stopAtTarget();
            return;
        }
        this.m._tacticalTarget = target;
        this.m._animState = 'walk';
        const slow = Math.min(1, distance / 120);
        this.m.maxSpeed = this._moveSpeed() * Math.max(0.3, slow);
    }

    _stopAtTarget() {
        this.m._tacticalTarget = null;
        this.m._animState = 'idle';
        this.m.maxSpeed = 0;
        this.m._pathManager?._clearPath?.();
    }

    _faceTarget(target) {
        this.m._tacticalTarget = null;
        this.m.rotation = Math.atan2(target.y - this.m.y, target.x - this.m.x);
        this.m._lastFaceRight = target.x >= this.m.x;
    }

    _canStrike(target) {
        const opening = this._swingActive ? this._swingVariant === 'opening' : this.m._openingStrikeArmed;
        const range = opening ? this._attackRange : (this.cfg.continuousAttackRange ?? this._attackRange);
        return canStartFriendlyMelee(this.m, target, range);
    }

    _nearestEnemy(entities) {
        let best = null;
        let bestDistance = Infinity;
        for (const entity of queryNearbyEntities(entities, this.m, this._engageRange)) {
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
        return !!(entity && entity.active && entity.hp > 0
            && entity._faction === 'enemy' && !entity._isEnergyNode);
    }

    _playSound(key) {
        const cue = this.m.sounds?.[key];
        const path = Array.isArray(cue) ? cue[Math.floor(Math.random() * cue.length)] : cue;
        if (!path || !SoundManager) return;
        if (typeof SoundManager.playWorld === 'function') SoundManager.playWorld(path, this.m.x, this.m.y);
        else SoundManager.playFile?.(path);
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
        m._pathManager?._clearPath?.();
    }
}
