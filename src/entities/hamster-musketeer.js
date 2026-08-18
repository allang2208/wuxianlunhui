import { Companion } from './companion.js';
import { HamsterMusketeerAI } from '../ai/hamster-musketeer-ai.js';
import { getAbilityLevel } from '../world/ability-store.js';
import configData from '../../data/hamster-musketeer-config.json';

const DYING_DURATION_MS = 1350;

export class HamsterMusketeer extends Companion {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
        };
        super(archive);
        this._isHamsterMusketeer = true;
        this.animId = 'hamster_musketeer';
        this._skipNeutralSprite = true;
        this._enemyTargetable = true;
        this.x = x;
        this.y = y;
        this.groundRadius = 20;
        this.collisionRadius = 20;
        this.bodyHeight = 100;
        this.size = 64;
        this.hittable = true;
        this.hitFlash = 0;
        this.footOffsetY = 17;
        this.config = { render: { hudOffsetY: 145, footOffsetY: 17 } };
        this._dying = false;
        this._deathTimer = 0;
        this._ai = new HamsterMusketeerAI(this);
        this._animState = 'idle';
    }

    /** 复用 DamageableEntity 现有武器穿甲入口，不另建一套伤害公式。 */
    getCurrentWeapon() {
        const level = getAbilityLevel('armor_piercing_round');
        if (level <= 0) return null;
        return {
            _craftEffects: {
                armorPenetrationPercent: 0.25 + 0.025 * (level - 1),
            },
        };
    }

    takeDamage(damage, source, _damageType = 'physical', _isMelee = true) {
        if (this._dying || this.data.hp <= 0) return 0;
        const before = this.data.hp;
        this.data.hp = Math.max(0, this.data.hp - damage);
        this.hitFlash = 120;
        if (this.data.hp <= 0) this._startDying();
        return before - this.data.hp;
    }

    _startDying() {
        this._dying = true;
        this._animState = 'dying';
        this.target = null;
        this._tacticalTarget = null;
        this._basic = null;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.maxSpeed = 0;
        this._deathTimer = DYING_DURATION_MS;
    }

    applyBarracksUpgrades(u = {}) {
        if (this._ai) {
            if (u.attackInterval) this._ai._attackInterval = u.attackInterval;
            if (u.attackDamage) this._ai._attackDamage = u.attackDamage;
            if (u.attackRange) this._ai._attackRange = u.attackRange;
        }
        if (this.aiConfig) {
            if (u.attackInterval) this.aiConfig.attackInterval = u.attackInterval;
            if (u.attackDamage) this.aiConfig.attackDamage = u.attackDamage;
            if (u.attackRange) this.aiConfig.attackRange = u.attackRange;
            if (u.walkSpeed) this.aiConfig.walkSpeed = u.walkSpeed;
        }
        if (u.baseMaxHp && this._maxHpOverride !== u.baseMaxHp) {
            this._maxHpOverride = u.baseMaxHp;
            this.updateMaxStats();
        }
    }

    update(dt, entities) {
        if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
        if (this._dying) {
            this._deathTimer -= dt;
            if (this._deathTimer <= 0) this._removeFromScene();
            return;
        }
        if (this.data.hp <= 0) {
            this._startDying();
            return;
        }
        const game = typeof window !== 'undefined' ? window.Game : null;
        this._ai.update(dt, entities, game && game.player);
    }

    _removeFromScene() {
        this.active = false;
        const game = typeof window !== 'undefined' ? window.Game : null;
        if (!game) return;
        if (game.entities && this.id) game.entities.delete(this.id);
        if (Array.isArray(game.friendlyUnits)) {
            const i = game.friendlyUnits.indexOf(this);
            if (i >= 0) game.friendlyUnits.splice(i, 1);
        }
    }
}
