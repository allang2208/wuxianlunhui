// ============================================================
// HamsterKnight — 仓鼠骑士（世界-122）
// 玩家友方近战单位：普攻第 16 帧结算，并复用铠甲骑士同口径的持盾冲锋。
// ============================================================
import { Companion } from './companion.js';
import { HamsterKnightAI } from '../ai/hamster-knight-ai.js';
import configData from '../../data/hamster-knight-config.json';

const DYING_DURATION_MS = 1167; // dying 14 帧 @12fps

export class HamsterKnight extends Companion {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
        };
        super(archive);
        this._isHamsterKnight = true;
        this.animId = 'hamster_knight';
        this._skipNeutralSprite = true;
        this._enemyTargetable = true;
        this.x = x;
        this.y = y;
        this.groundRadius = 24;
        this.collisionRadius = 24;
        this.bodyHeight = 112;
        this.size = 72;
        this.hittable = true;
        this.hitFlash = 0;
        this.footOffsetY = 74;
        this.config = { render: { hudOffsetY: 180, footOffsetY: 74 } };
        this._dying = false;
        this._deathTimer = 0;
        this._ai = new HamsterKnightAI(this);
        this._animState = 'idle';
    }

    takeDamage(damage, _source, _damageType = 'physical', _isMelee = true) {
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
        this._chargeStart = false;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.maxSpeed = 0;
        this._deathTimer = DYING_DURATION_MS;
    }

    /** 产兵建筑的通用模块升级：普攻与冲锋强化分别由独立属性驱动。 */
    applyBarracksUpgrades(upgrade = {}) {
        if (this._ai) {
            if (upgrade.attackInterval) this._ai._attackInterval = upgrade.attackInterval;
            if (upgrade.attackDamage) this._ai._attackDamage = upgrade.attackDamage;
            if (Number.isFinite(upgrade.chargeDamageMult)) this._ai.cfg.chargeDamageMult = upgrade.chargeDamageMult;
        }
        if (this.aiConfig) {
            if (upgrade.attackInterval) this.aiConfig.attackInterval = upgrade.attackInterval;
            if (upgrade.attackDamage) this.aiConfig.attackDamage = upgrade.attackDamage;
            if (Number.isFinite(upgrade.chargeDamageMult)) this.aiConfig.chargeDamageMult = upgrade.chargeDamageMult;
            if (upgrade.walkSpeed) {
                this.aiConfig.walkSpeed = upgrade.walkSpeed;
                this.aiConfig.runSpeed = upgrade.walkSpeed;
            }
        }
        if (upgrade.baseMaxHp && this._maxHpOverride !== upgrade.baseMaxHp) {
            this._maxHpOverride = upgrade.baseMaxHp;
            this.updateMaxStats();
        }
    }

    update(dt, entities) {
        if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
        this.updateStatusEffects(dt);
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
        this._ai.update(dt, entities, (game && game.player && !game._observerMode) ? game.player : null);
    }

    _removeFromScene() {
        this.active = false;
        const game = typeof window !== 'undefined' ? window.Game : null;
        if (!game) return;
        if (game.entities && this.id) game.entities.delete(this.id);
        if (Array.isArray(game.friendlyUnits)) {
            const index = game.friendlyUnits.indexOf(this);
            if (index >= 0) game.friendlyUnits.splice(index, 1);
        }
    }
}
