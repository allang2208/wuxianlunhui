import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { DamagePipeline } from '../../combat/damage-pipeline.js';
import {
    canImpactBasicMelee,
    canStartBasicMelee,
    createBasicMeleeSnapshot,
    createBasicMeleeTimeline,
    stepBasicMeleeTimeline,
} from '../../combat/melee-attack-resolver.js';

/** 棺板卫尸：四动作共用逻辑时钟，定向单体拳砸；棺板不另设格挡技能。 */
export class CoffinWard extends Enemy {
    constructor(x, y, overrides = {}) {
        const base = enemyConfigData.coffinWard;
        super(x, y, {
            ...base,
            ...overrides,
            ai: { ...base.ai, ...overrides.ai },
            render: { ...base.render, ...overrides.render },
            textures: { ...base.textures, ...overrides.textures },
            showWeapon: false,
            basicMeleeResolver: true,
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        this.aiInterval = Number.MAX_SAFE_INTEGER;
        this._baseAiInterval = this.aiInterval;
        this._animState = 'idle';
        this._actionState = 'idle';
        this._animElapsed = 0;
        this._animFrame = 0;
        this._strike = null;
        this._strikeCooldown = 0;
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

    _frameAt(state, elapsed) {
        // The death clip's last hold is 1/24s, all earlier death frames are 1/12s.
        const starts = this._frameStarts[state];
        return Math.max(0, starts.findLastIndex(start => elapsed >= start));
    }

    _stopMovement() {
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
    }

    _isImmobile() {
        return this._dashStunned
            || ['stun', 'frozen', 'petrified'].some(status => this.hasStatusEffect(status));
    }

    _cannotAttack() {
        return !this.active || this._isDead || this._isImmobile() || this.hasStatusEffect('fear');
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateDeath(dt);
            return;
        }
        super.update(dt, entities);
        if (!this.active || this._isDead) return;
        this._strikeCooldown = Math.max(0, this._strikeCooldown - this.getAttackIntervalDelta(dt));
        if (this._cannotAttack()) {
            if (this._strike) this._cancelStrike();
            if (this._isImmobile()) {
                this._cancelStrike();
                this._stopMovement();
                return;
            }
            this._updateLocomotion(dt);
            return;
        }
        if (this._strike) {
            this._advanceStrike(dt);
            return;
        }
        if (this._strikeCooldown <= 0 && canStartBasicMelee(this, this.target, this.config.attack)) {
            this._beginStrike();
            return;
        }
        this._updateLocomotion(dt);
    }

    _updateLocomotion(dt) {
        const speed = Math.hypot(this.vx, this.vy);
        const threshold = Math.max(1, this._baseSpeed * (this._animState === 'walk' ? 0.025 : 0.05));
        const walking = speed > threshold;
        this._setAnimation(walking ? 'walk' : 'idle');
        this._actionState = walking ? 'chasing' : 'idle';
        if (walking && Math.abs(this.vx) > 0.1) this.rotation = Math.atan2(this.vy, this.vx);
        this._animElapsed = (this._animElapsed + Math.max(0, dt)) % this._layout().duration;
        this._animFrame = this._frameAt(this._animState, this._animElapsed);
    }

    _beginStrike() {
        const timeline = createBasicMeleeTimeline(this);
        const target = this.target;
        if (!timeline || !canStartBasicMelee(this, target, this.config.attack)) return;
        const snapshot = createBasicMeleeSnapshot(this, target, this.config.attack);
        this._strike = {
            primaryTarget: target,
            basicMeleeSnapshot: snapshot,
            basicMeleeTimeline: timeline,
            timelineElapsedMs: 0,
            impactConsumed: false,
        };
        this._strikeCooldown = this.config.attackSkills.strike.cooldown;
        this._attackTimer = timeline.durationMs;
        this._attackAnimTimer = timeline.durationMs;
        this.rotation = snapshot.worldAngle;
        this._actionState = 'windup';
        this._setAnimation('attack');
        this._stopMovement();
        if (this._pendingThrust) this._pendingThrust.active = false;
    }

    _advanceStrike(dt) {
        const strike = this._strike;
        const step = stepBasicMeleeTimeline(strike, dt);
        this.rotation = strike.basicMeleeSnapshot.worldAngle;
        this._stopMovement();
        this._actionState = step.phase;
        this._animElapsed = step.elapsedMs;
        this._animFrame = step.frameIndex;
        this._attackTimer = Math.max(0, strike.basicMeleeTimeline.durationMs - step.elapsedMs);
        this._attackAnimTimer = this._attackTimer;
        if (step.shouldCheckImpact && !strike.impactConsumed) {
            // Consume first: damage/parry may synchronously cancel the strike or kill us.
            strike.impactConsumed = true;
            const snapshot = strike.basicMeleeSnapshot;
            snapshot.timelineFrame = step.frameIndex;
            if (canImpactBasicMelee(this, strike.primaryTarget, snapshot)) {
                const skill = this.config.attackSkills.strike;
                DamagePipeline.applyHit(this, strike.primaryTarget, {
                    damage: Math.max(1, Math.round(this.data.atk * skill.damageMul)),
                    damageType: 'physical',
                    knockback: skill.knockback,
                    angle: snapshot.worldAngle,
                    isMelee: true,
                    currentWeapon: null,
                });
            }
            if (this._cannotAttack() || this._strike !== strike) {
                if (!this._deathStarted) this._cancelStrike();
                return;
            }
        }
        if (step.completed) {
            this._strike = null;
            this._attackTimer = 0;
            this._attackAnimTimer = 0;
            this._actionState = 'idle';
            this._setAnimation('idle');
        }
    }

    _cancelStrike() {
        this._strike = null;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        if (this._pendingThrust) this._pendingThrust.active = false;
        if (this._deathStarted) return;
        this._actionState = 'idle';
        this._setAnimation('idle');
    }

    _enterStunnedIdleAnimation() {
        if (this._deathStarted) return;
        this._cancelStrike();
        this._stopMovement();
    }

    updateWhilePetrified(dt) {
        this._cancelStrike();
        super.updateWhilePetrified(dt);
    }

    // Pursuit remains shared; only this class can initiate or settle the punch.
    _updateAttack() {}
    triggerWeaponAnim() { return false; }

    _updateMovement(dx, dy, dist, dt) {
        if (this._strike) { this._stopMovement(); return; }
        super._updateMovement(dx, dy, dist, dt);
    }

    onDeath(source) {
        if (this._deathStarted) return;
        this._deathStarted = true;
        this._cancelStrike();
        this._stopMovement();
        this.target = null;
        this._tacticalTarget = null;
        this._setAnimation('death');
        this._actionState = 'dying';
        this._deathElapsed = 0;
        this._deathAnimTimer = this._layout('death').duration;
        const death = this.config.death;
        this._deathRemoveDelay = this._deathAnimTimer + death.holdMs + death.fadeMs + 500;
        super.onDeath(source);
    }

    _updateDeath(dt) {
        if (!this._deathStarted) return;
        const layout = this._layout('death');
        const death = this.config.death;
        const fadeStart = layout.duration + death.holdMs;
        const total = fadeStart + death.fadeMs;
        this._deathElapsed = Math.min(total, this._deathElapsed + Math.max(0, dt));
        const elapsed = this._deathElapsed;
        this._deathAnimTimer = Math.max(0, layout.duration - elapsed);
        this._corpseTimer = elapsed < layout.duration ? 0 : Math.max(0, fadeStart - elapsed);
        this._fadeTimer = elapsed < fadeStart ? 0 : Math.max(0, total - elapsed);
        this._animFrame = this._frameAt('death', elapsed);
        this._visualAlpha = elapsed < fadeStart ? 1 : Math.max(0, (total - elapsed) / death.fadeMs);
        this._actionState = elapsed < layout.duration ? 'dying' : (elapsed < fadeStart ? 'corpse' : 'fading');
        if (elapsed >= total && this._phaserSprite) {
            this._phaserSprite.destroy();
            this._phaserSprite = null;
        }
    }

    _syncFootOffset() {
        const layout = this._layout();
        const scale = this.config.render.spriteSize / this.config.textures.referenceCell;
        this.footOffsetY = (layout.footY - layout.frameHeight / 2) * scale - (this.colliderOffsetY || 0);
    }

    _getTextureKey() { return `enemy_coffin_ward_${this._animState}`; }

    _getPhaserOptions() {
        const layout = this._layout();
        const render = this.config.render;
        const scale = render.spriteSize / this.config.textures.referenceCell;
        this._syncFootOffset();
        return {
            spriteSize: Math.max(layout.frameWidth, layout.frameHeight) * scale,
            collisionWidth: render.collisionWidth,
            collisionHeight: render.collisionHeight,
            flipX: Math.cos(this.rotation || 0) < 0,
            frame: this._animFrame,
            alpha: this._visualAlpha,
            // No animState: don't start a second Phaser clock alongside the contact clock.
        };
    }
}
