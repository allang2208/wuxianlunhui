import { HamsterMusketeerAI } from './hamster-musketeer-ai.js';
import { MovementSystem } from '../systems/movement-system.js';
import {
    clearRtsSurfaceRoute,
    finishRtsCommandAtHold,
    resolveRtsMoveDestination,
} from './rts-command-utils.js';

/**
 * 侦察游骑兵把移动目的地与射击目标分开保存：move 只改路径，不清瞄准/开火序列。
 * 站定和移动各使用一张一次性攻击表，并在各自出膛帧创建同一枚单发步枪弹。
 */
export class HamsterScoutRifleSkirmisherAI extends HamsterMusketeerAI {
    constructor(unit) {
        super(unit);
        const attack = unit.animations?.attack || {};
        const movingAttack = unit.animations?.moving_attack || {};
        const standingFps = this.cfg.attackAnimFps ?? attack.frameRate ?? 24;
        const movingFps = this.cfg.movingAttackAnimFps ?? movingAttack.frameRate ?? 24;
        this._standingLaunchDelayMs = ((this.cfg.attackLaunchFrame ?? 8) - 1)
            / standingFps * 1000;
        this._movingLaunchDelayMs = ((this.cfg.movingAttackLaunchFrame ?? 14) - 1)
            / movingFps * 1000;
        this._standingShotAnimMs = (attack.frameCount || 29) / standingFps * 1000 + 60;
        this._movingShotAnimMs = (movingAttack.frameCount || 31) / movingFps * 1000 + 60;
        this._shotMoving = false;
        this._shotTarget = null;
        this._movementDesired = false;
    }

    cancelForCommand(mode) {
        // 帝国时代式骑射：移动指令不能取消已经起手的射击，也不清当前瞄准目标。
        if (mode === 'move') return;
        super.cancelForCommand();
        this._shotTarget = null;
        this._shotMoving = false;
    }

    update(dt, entities, player) {
        const m = this.m;
        if (m.data.hp <= 0 || m._dying) return;
        this._attackTimer = Math.max(0, this._attackTimer - dt);
        this._updateProjectile(dt, entities);
        this._decisionTimer -= dt;
        if (this._decisionTimer <= 0) {
            this._decisionTimer = this.cfg.decisionMs ?? 120;
            this._tickMobileCombat(entities, player);
        }

        MovementSystem.update(m, dt, entities);
        this._checkStuck(dt);

        if (this._shotActive) {
            if (this._validTarget(this._shotTarget)) {
                m.target = this._shotTarget;
                m.rotation = Math.atan2(this._shotTarget.y - m.y, this._shotTarget.x - m.x);
                m._lastFaceRight = this._shotTarget.x >= m.x;
            }
            m._animState = this._shotMoving ? 'moving_attack' : 'attack';
            this._shotTimer -= dt;
            if (this._shotTimer <= 0) {
                this._fireProjectile();
                this._shotTimer = Infinity;
            }
            this._shotAnimLeft -= dt;
            if (this._shotAnimLeft <= 0) {
                this._shotActive = false;
                this._shotTarget = null;
                this._shotMoving = false;
                m._attackSwing = false;
                m._animState = this._movementDesired
                    || Math.hypot(m.vx || 0, m.vy || 0) > 25 ? 'walk' : 'idle';
            }
            return;
        }

        if (m._animState === 'attack' || m._animState === 'moving_attack') {
            m._animState = 'idle';
        }
        if (this._movementDesired || Math.hypot(m.vx || 0, m.vy || 0) > 25) {
            m._animState = 'walk';
        }
    }

    _tickMobileCombat(entities, player) {
        const m = this.m;
        const command = m._command;
        this._movementDesired = false;

        if (command?.mode && command.mode !== 'follow') {
            if (command.mode !== 'move' && !m._surfaceNavCommand) clearRtsSurfaceRoute(m);
            if (command.mode === 'move' && command.point) {
                const move = resolveRtsMoveDestination(m, command);
                if (!move.arrived) {
                    m._tacticalTarget = move.destination;
                    m.maxSpeed = this.cfg.walkSpeed ?? 260;
                    this._movementDesired = true;
                } else {
                    this._finishMovePreservingTarget();
                }
            } else if (command.mode === 'attack') {
                if (!this._validTarget(command.target)) {
                    finishRtsCommandAtHold(m);
                } else {
                    m.target = command.target;
                    this._moveIntoRange(command.target);
                }
            } else {
                this._stopMotion();
            }
        } else {
            const enemy = this._validTarget(m.target) ? m.target : this._nearestEnemy(entities);
            if (enemy) {
                m.target = enemy;
                this._moveIntoRange(enemy);
            } else {
                m.target = null;
                this._followPlayer(player);
            }
        }

        const target = this._validTarget(this._shotTarget)
            ? this._shotTarget
            : (this._validTarget(m.target) ? m.target : this._nearestEnemy(entities));
        if (!target) return;
        m.target = target;
        if (this._canFireAt(target) && this._attackTimer <= 0 && !this._shotActive) {
            this._startShot(target, this._movementDesired);
        }
    }

    _moveIntoRange(target) {
        const m = this.m;
        const distance = Math.hypot(target.x - m.x, target.y - m.y);
        if (distance > this._effectiveAttackRange() || !this._canShootTarget(target)) {
            m._tacticalTarget = { x: target.x, y: target.y };
            m.maxSpeed = this.cfg.walkSpeed ?? 260;
            this._movementDesired = true;
            return;
        }
        this._stopMotion();
    }

    _followPlayer(player) {
        const m = this.m;
        if (!player) {
            this._stopMotion();
            return;
        }
        const destination = { x: player.x - this._followOffset, y: player.y, _surfaceTarget: player };
        const distance = Math.hypot(destination.x - m.x, destination.y - m.y);
        if (distance > (this.cfg.followArriveDist ?? 44)) {
            m._tacticalTarget = destination;
            const slow = Math.min(1, distance / 140);
            m.maxSpeed = (this.cfg.walkSpeed ?? 260) * Math.max(0.3, slow);
            this._movementDesired = true;
            return;
        }
        this._stopMotion();
        m._pathManager?._clearPath?.();
    }

    _stopMotion() {
        this.m._tacticalTarget = null;
        this.m.maxSpeed = 0;
        this._movementDesired = false;
    }

    _finishMovePreservingTarget() {
        const m = this.m;
        const target = this._validTarget(m.target) ? m.target : null;
        m._command = { mode: 'hold', point: null, target: null };
        clearRtsSurfaceRoute(m);
        m._pathManager?._clearPath?.();
        m._tacticalTarget = null;
        m.maxSpeed = 0;
        m.vx = 0;
        m.vy = 0;
        m.isMoving = false;
        this._movementDesired = false;
        m.target = target;
    }

    _startShot(target, moving) {
        const m = this.m;
        this._attackTimer = this._attackInterval;
        this._shotActive = true;
        this._shotMoving = !!moving;
        this._shotTarget = target;
        this._shotTimer = moving ? this._movingLaunchDelayMs : this._standingLaunchDelayMs;
        this._shotAnimLeft = moving ? this._movingShotAnimMs : this._standingShotAnimMs;
        m.target = target;
        m._attackSwing = true;
        m._scoutRifleShotSeq = (Number(m._scoutRifleShotSeq) || 0) + 1;
        m._animState = moving ? 'moving_attack' : 'attack';
        m.rotation = Math.atan2(target.y - m.y, target.x - m.x);
        m._lastFaceRight = target.x >= m.x;
    }

    _canFireAt(target) {
        return this._validTarget(target)
            && Math.hypot(target.x - this.m.x, target.y - this.m.y) <= this._effectiveAttackRange()
            && this._canShootTarget(target);
    }

    _validTarget(target) {
        return !!(target && target.active && target.hp > 0
            && target._faction === 'enemy' && !target._isEnergyNode);
    }
}
