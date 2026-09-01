import { HorrorNormalEnemy } from './_shared/horror-normal-enemy.js';
import { hasAttackLineOfSight } from '../../combat/melee-reach.js';
import { canMeleeShareSurface } from '../../combat/melee-surface.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { WaxSealEffect } from '../../effects/wax-seal-effect.js';

/** 蜡面哀祷者：出掌帧释放固定落点蜡印；释放后由效果管理器独立结算。 */
export class WaxfaceMourner extends HorrorNormalEnemy {
    constructor(x, y, overrides = {}) {
        super(x, y, 'waxfaceMourner', 'waxface_mourner', overrides);
        this._actionCooldown = this._skill().initialCooldownMs;
        this._holdingCastPosition = false;
        this._castPositionTarget = null;
    }

    update(dt, entities) {
        const wasActing = !!this._action;
        super.update(dt, entities);
        if (!this.active || this._isDead) return;
        if (this._isImmobile()) {
            this._clearCastPosition();
            this._actionState = 'controlled';
        } else if (wasActing && !this._action) {
            this._updateLocomotion(0);
        }
    }

    updateWhilePetrified(dt) {
        super.updateWhilePetrified(dt);
        if (!this.active || this._isDead) return;
        // 石化暂停动作，冷却仍和其他硬控一样使用攻击间隔时钟。
        this._actionCooldown = Math.max(0, this._actionCooldown - this.getAttackIntervalDelta(dt));
        this._clearCastPosition();
        this._actionState = this._isImmobile() ? 'controlled' : 'idle';
    }

    _cancelAction() {
        const keepPose = !this._deathStarted && this.hasStatusEffect('petrified');
        const state = this._animState, elapsed = this._animElapsed, frame = this._animFrame;
        super._cancelAction();
        if (this._cannotAttack()) this._clearCastPosition();
        // 取消攻击事件不等于重置石化姿势；死亡入口仍正常切换到死亡动画。
        if (keepPose) {
            this._animState = state;
            this._animElapsed = elapsed;
            this._animFrame = frame;
            this._actionState = 'controlled';
            this._syncFootOffset();
        }
    }

    _syncPetrifiedBodyAnchor(sprite) {
        // 石化施加/解除与逻辑换状态可能同帧，锚点始终读取当前冻结的实际纹理。
        const state = sprite.texture?.key?.replace(`enemy_${this._textureFamily}_`, '');
        const layout = this.config.textures.frameLayouts[state];
        if (!layout) return;
        sprite.x += (layout.frameWidth / 2 - layout.footX)
            * Math.abs(sprite.scaleX) * (sprite.flipX ? -1 : 1);
        sprite.y += this.footOffsetY - (layout.footY - layout.frameHeight / 2)
            * Math.abs(sprite.scaleY) + (this.colliderOffsetY || 0);
    }

    _clearCastPosition() {
        this._holdingCastPosition = false;
        this._castPositionTarget = null;
    }

    _hasNavigationPriority() {
        return this._spawnEgress || this._surfaceNavCommand || this._surfaceExitCommand
            || this._surfaceRouteActive || this._garrisonMoveCommand
            || this._command?.mode === 'move' || this._specialTacticalTarget;
    }

    _hasCastSolution(target, range = this._skill().range) {
        if (!this._validTarget(target) || target._isDead || target.hp <= 0) return false;
        const dx = (target.collider?.x ?? target.x) - this.collider.x;
        const dy = (target.collider?.y ?? target.y) - this.collider.y;
        return Math.hypot(dx, dy / PERSPECTIVE_SCALE_Y) <= range
            && canMeleeShareSurface(this, target)
            && hasAttackLineOfSight(this, target);
    }

    _updateCastPosition(target = this.target) {
        if (this._cannotAttack() || this._hasNavigationPriority()) {
            this._clearCastPosition();
            return false;
        }
        if (target !== this._castPositionTarget) {
            this._holdingCastPosition = false;
            this._castPositionTarget = target;
        }
        const range = this._holdingCastPosition
            ? this.ai.resumeChaseRange : this.ai.preferredCastRange;
        // 站定/重新追击使用不同距离，避免目标在边界附近移动时反复切换。
        this._holdingCastPosition = this._hasCastSolution(target, Math.min(range, this._skill().range));
        return this._holdingCastPosition;
    }

    _faceCastTarget() {
        const target = this.target;
        this.rotation = Math.atan2((target.collider?.y ?? target.y) - this.collider.y,
            (target.collider?.x ?? target.x) - this.collider.x);
        this._actionState = this._actionCooldown > 0 ? 'cooldown' : 'ready';
    }

    /** MovementSystem 在感知更新后调用；等冷却只停步，不设置会阻断恐惧逃跑的施法锁。 */
    shouldHoldCombatPosition() {
        if (this._action || !this._updateCastPosition()) return false;
        this._stopMovement();
        this._setAnimation('idle');
        this._faceCastTarget();
        return true;
    }

    _updateLocomotion(dt) {
        const hold = this._updateCastPosition();
        if (hold) this._stopMovement();
        super._updateLocomotion(dt);
        if (this.hasStatusEffect('fear')) this._actionState = 'fleeing';
        else if (hold) this._faceCastTarget();
    }

    _updateMovement(dx, dy, dist, dt) {
        if (!this._action && this.shouldHoldCombatPosition()) return;
        super._updateMovement(dx, dy, dist, dt);
    }

    _canStartAction(target) { return this._updateCastPosition(target); }

    _createActionContext() { return {}; }

    _resolveAction(action, entities) {
        const target = action.primaryTarget;
        const skill = this._skill();
        // 出掌复查完整射程；目标在蓄力期间离开站位内圈，仍可在420范围内释放。
        if (!this._hasCastSolution(target)) return;
        const flip = Math.cos(action.worldAngle) < 0 ? -1 : 1;
        if (((target.collider?.x ?? target.x) - this.collider.x) * flip < -skill.behindTolerance) return;
        EffectManager.add(new WaxSealEffect(this, target, skill, entities,
            Math.max(0, action.elapsedMs - this._frameStarts.attack[skill.eventFrame])));
    }
}
