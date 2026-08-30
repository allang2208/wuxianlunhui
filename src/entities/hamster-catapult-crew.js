import { HamsterScout } from './hamster-scout.js';
import { updateFriendlyMovementSound } from '../utils/friendly-movement-sound.js';
import { HamsterCatapultCrewAI } from '../ai/hamster-catapult-crew-ai.js';
import catapultConfig from '../../data/hamster-catapult-crew-config.json';

/** 双人器械作为一个军事单位，共享生命、命令、人口与所属建筑。 */
export class HamsterCatapultCrew extends HamsterScout {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...catapultConfig, ...overrides,
            ai: { ...catapultConfig.ai, ...overrides.ai },
            animations: { ...catapultConfig.animations, ...overrides.animations },
            render: { ...catapultConfig.render, ...overrides.render },
        };
        super(x, y, archive);
        this._isHamsterCatapultCrew = true;
        this.animId = catapultConfig.id;
        this.fogVisionProfile = 'military';
        this._catapultVisualState = 'idle';
        this._catapultElapsedMs = 0;
        this._catapultFaceRight = true;
        this._dyingDurationMs = archive.animations.dying.durationMs;
        this._corpseHoldMs = archive.render.corpseHoldMs;
        this._ai = new HamsterCatapultCrewAI(this);
    }

    setAnimationClock(state, elapsedMs) {
        this._animState = state;
        this._catapultVisualState = state;
        this._catapultElapsedMs = Math.max(0, elapsedMs);
    }

    advanceAnimationClock(state, dt) {
        const elapsed = this._catapultVisualState === state ? this._catapultElapsedMs + dt : 0;
        this.setAnimationClock(state, elapsed);
    }

    _startDying() {
        if (this._dying) return;
        this._catapultFaceRight = this._lastFaceRight !== false;
        this._ai?.cancelForCommand();
        super._startDying();
        this._attackSwing = false;
        this.setAnimationClock('dying', 0);
        this._deathTimer = this._dyingDurationMs + this._corpseHoldMs;
    }

    update(dt, entities) {
        this.hitFlash = Math.max(0, this.hitFlash - dt);
        this.updateStatusEffects(dt);
        if (this.data.hp <= 0 && !this._dying) this._startDying();
        if (this._dying) {
            this.advanceAnimationClock('dying', dt);
            this._deathTimer -= dt;
            if (this._deathTimer <= 0) this._removeFromScene();
            return;
        }
        if (['stun', 'frozen', 'petrified'].some((type) => this.hasStatusEffect(type))) {
            if (this._ai._shotActive) this._ai.cancelForCommand();
            // 已离勺的石弹独立飞行；控制打断尚未发射的动作。
            this._ai._updateProjectile(dt, entities);
            this.vx = 0; this.vy = 0; this.isMoving = false; this.maxSpeed = 0;
            return;
        }
        const game = typeof window !== 'undefined' ? window.Game : null;
        this._ai.update(dt, entities, game?.player && !game._observerMode ? game.player : null);
        updateFriendlyMovementSound(this, dt);
    }
}
