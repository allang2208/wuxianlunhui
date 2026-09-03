import { Enemy } from '../../enemy.js';
import enemyConfigData from '../../../../data/enemy-config.json';
import { canAttackDefenseTarget } from '../../../ai/defense-target-priority.js';
import { stepBasicMeleeTimeline } from '../../../combat/melee-attack-resolver.js';

/** Three ordinary horror enemies share lifecycle/animation, not attack geometry. */
export class HorrorNormalEnemy extends Enemy {
    constructor(x, y, configKey, textureFamily, overrides = {}) {
        const base = enemyConfigData[configKey];
        super(x, y, {
            ...base, ...overrides,
            ai: { ...base.ai, ...overrides.ai },
            render: { ...base.render, ...overrides.render },
            textures: { ...base.textures, ...overrides.textures },
            showWeapon: false,
        });
        this._textureFamily = textureFamily;
        this._useStickFigure = false;
        this._usePacingAI = false;
        this.aiInterval = Number.MAX_SAFE_INTEGER;
        this._baseAiInterval = this.aiInterval;
        this._animState = 'idle';
        this._actionState = 'idle';
        this._animElapsed = 0;
        this._animFrame = 0;
        this._action = null;
        this._actionCooldown = 0;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._preserveCorpse = true;
        this._deathStarted = false;
        this._deathElapsed = 0;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._visualAlpha = 1;
        this._frameStarts = {};
        for (const [state, layout] of Object.entries(this.config.textures.frameLayouts)) {
            let elapsed = 0;
            this._frameStarts[state] = layout.frameDurations.map(duration => {
                const start = elapsed;
                elapsed += duration;
                return start;
            });
        }
        this._syncFootOffset();
    }

    _layout(state = this._animState) { return this.config.textures.frameLayouts[state]; }
    _skill() { return this.config.attackSkills.primary; }
    _frameAt(state, time) {
        return Math.max(0, this._frameStarts[state].findLastIndex(start => time >= start));
    }
    _setAnimation(state) {
        if (this._animState !== state) {
            this._animState = state;
            this._animElapsed = 0;
            this._animFrame = 0;
        }
        // Position sync runs before texture sync; publish the new foot anchor now.
        // Shared control handlers may already have changed _animState to idle.
        this._syncFootOffset();
    }
    _stopMovement() { this.vx = 0; this.vy = 0; this.isMoving = false; }
    _isImmobile() {
        return this._dashStunned || ['stun', 'frozen', 'petrified'].some(s => this.hasStatusEffect(s));
    }
    _cannotAttack() {
        return !this.active || this._isDead || this._isImmobile() || this.hasStatusEffect('fear');
    }
    _validTarget(target) {
        return !!target?.active && target.hittable !== false && target._faction !== this._faction
            && canAttackDefenseTarget(this, target);
    }

    update(dt, entities) {
        if (!this.active) { this._updateDeath(dt); return; }
        // Clear an interrupted action before any shared fallback movement/attack work.
        if (this._cannotAttack() && this._action) this._cancelAction();
        super.update(dt, entities);
        if (!this.active || this._isDead) return;
        this._actionCooldown = Math.max(0, this._actionCooldown - this.getAttackIntervalDelta(dt));
        if (this._isImmobile()) {
            this._cancelAction();
            this._stopMovement();
            return;
        }
        if (this.hasStatusEffect('fear')) {
            if (this._action) this._cancelAction();
            this._updateLocomotion(dt);
            return;
        }
        if (this._action) { this._advanceAction(dt, entities); return; }
        if (this._actionCooldown <= 0 && this._validTarget(this.target) && this._canStartAction(this.target)) {
            this._beginAction(this.target);
            return;
        }
        this._updateLocomotion(dt);
    }

    _updateLocomotion(dt) {
        const speed = Math.hypot(this.vx, this.vy);
        const threshold = Math.max(1, this._baseSpeed * (this._animState === 'walk' ? .025 : .05));
        const walking = speed > threshold;
        this._setAnimation(walking ? 'walk' : 'idle');
        this._actionState = walking ? 'chasing' : 'idle';
        if (walking && Math.abs(this.vx) > .1) this.rotation = Math.atan2(this.vy, this.vx);
        this._animElapsed = (this._animElapsed + Math.max(0, dt)) % this._layout().duration;
        this._animFrame = this._frameAt(this._animState, this._animElapsed);
    }

    _beginAction(target) {
        const context = this._createActionContext(target);
        if (!context) return;
        this._action = { primaryTarget: target, elapsedMs: 0, impactConsumed: false,
            worldAngle: Math.atan2(target.y-this.y, target.x-this.x), ...context };
        this.rotation = this._action.worldAngle;
        this._actionCooldown = this._skill().cooldown;
        this._attackTimer = this._layout('attack').duration;
        this._attackAnimTimer = this._attackTimer;
        this._frozenForCast = true;
        this._actionState = 'windup';
        this._setAnimation('attack');
        this._stopMovement();
        if (this._pendingThrust) this._pendingThrust.active = false;
    }

    _advanceAction(dt, entities) {
        const action = this._action;
        const duration = this._layout('attack').duration;
        let shouldImpact;
        if (action.basicMeleeTimeline) {
            const step = stepBasicMeleeTimeline(action, dt);
            action.elapsedMs = step.elapsedMs;
            this._animFrame = step.frameIndex;
            this._actionState = step.phase;
            shouldImpact = step.shouldCheckImpact;
        } else {
            const previous = action.elapsedMs;
            action.elapsedMs = Math.min(duration, previous + Math.max(0, dt));
            this._animFrame = this._frameAt('attack', action.elapsedMs);
            const eventMs = this._frameStarts.attack[this._skill().eventFrame];
            shouldImpact = previous <= eventMs && action.elapsedMs >= eventMs;
            this._actionState = action.elapsedMs < eventMs ? 'windup' : 'recover';
        }
        this.rotation = action.worldAngle;
        this._stopMovement();
        this._animElapsed = action.elapsedMs;
        this._attackTimer = Math.max(0, duration-action.elapsedMs);
        this._attackAnimTimer = this._attackTimer;
        if (shouldImpact && !action.impactConsumed) {
            // Consume before damage/parry callbacks, which can synchronously kill/interrupt us.
            action.impactConsumed = true;
            this._resolveAction(action, entities);
            if (this._action !== action || this._cannotAttack()) {
                if (!this._deathStarted) this._cancelAction();
                return;
            }
        }
        if (action.elapsedMs >= duration) this._cancelAction();
    }

    _cancelAction() {
        this._action = null;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._frozenForCast = false;
        if (this._pendingThrust) this._pendingThrust.active = false;
        if (this._deathStarted) return;
        this._actionState = 'idle';
        this._setAnimation('idle');
    }
    _enterStunnedIdleAnimation() {
        if (this._deathStarted) return;
        this._cancelAction();
        this._stopMovement();
    }
    updateWhilePetrified(dt) { this._cancelAction(); super.updateWhilePetrified(dt); }
    _updateAttack() {}
    triggerWeaponAnim() { return false; }
    _updateMovement(dx, dy, dist, dt) {
        if (this._action) { this._stopMovement(); return; }
        super._updateMovement(dx, dy, dist, dt);
    }

    onDeath(source) {
        if (this._deathStarted) return;
        this._deathStarted = true;
        this._cancelAction();
        this._stopMovement();
        this.target = null;
        this._tacticalTarget = null;
        this._setAnimation('death');
        this._actionState = 'dying';
        this._deathElapsed = 0;
        this._deathAnimTimer = this._layout('death').duration;
        this._deathRemoveDelay = this._deathAnimTimer + this.config.death.holdMs + this.config.death.fadeMs + 500;
        super.onDeath(source);
    }
    _updateDeath(dt) {
        if (!this._deathStarted) return;
        const duration = this._layout('death').duration;
        const { holdMs, fadeMs } = this.config.death;
        const fadeStart = duration + holdMs;
        const total = fadeStart + fadeMs;
        this._deathElapsed = Math.min(total, this._deathElapsed + Math.max(0, dt));
        const elapsed = this._deathElapsed;
        this._deathAnimTimer = Math.max(0, duration-elapsed);
        this._corpseTimer = elapsed < duration ? 0 : Math.max(0, fadeStart-elapsed);
        this._fadeTimer = elapsed < fadeStart ? 0 : Math.max(0, total-elapsed);
        this._animFrame = this._frameAt('death', elapsed);
        this._visualAlpha = elapsed < fadeStart ? 1 : Math.max(0, (total-elapsed)/Math.max(1,fadeMs));
        this._actionState = elapsed < duration ? 'dying' : elapsed < fadeStart ? 'corpse' : 'fading';
        if (elapsed >= total && this._phaserSprite) {
            this._phaserSprite.destroy();
            this._phaserSprite = null;
        }
    }
    _syncFootOffset() {
        const layout = this._layout();
        const scale = this.config.render.spriteSize / this.config.textures.referenceCell;
        this.footOffsetY = (layout.footY-layout.frameHeight/2)*scale-(this.colliderOffsetY || 0);
    }
    _getTextureKey() { return `enemy_${this._textureFamily}_${this._animState}`; }
    _getPhaserOptions() {
        const layout = this._layout();
        const render = this.config.render;
        const scale = render.spriteSize / this.config.textures.referenceCell;
        this._syncFootOffset();
        return { spriteSize: Math.max(layout.frameWidth,layout.frameHeight)*scale,
            collisionWidth: render.collisionWidth, collisionHeight: render.collisionHeight,
            flipX: Math.cos(this.rotation || 0)<0, frame: this._animFrame, alpha: this._visualAlpha };
    }
}
