// ============================================================
// HamsterLightCavalry — 仓鼠轻骑（世界-122）
// 玩家友方高速近战单位：每 2 秒攻击一次，第 9 帧结算 60 点物理伤害。
// ============================================================
import { Companion } from './companion.js';
import { HamsterLightCavalryAI } from '../ai/hamster-light-cavalry-ai.js';
import configData from '../../data/hamster-light-cavalry-config.json';

export class HamsterLightCavalry extends Companion {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
        };
        super(archive);

        this._isHamsterLightCavalry = true;
        this.animId = 'hamster_light_cavalry';
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
        this.footOffsetY = 91;
        this.config = { render: { hudOffsetY: 190, footOffsetY: 91 } };
        this._dying = false;
        this._deathTimer = 0;
        this._ai = new HamsterLightCavalryAI(this);
        this._animState = 'idle';
        this.configureCollisionFromArchive(archive);
    }

    get hp() { return this.data.hp; }
    get maxHp() { return this.data.maxHp; }

    takeDamage(damage, _source, _damageType = 'physical', _isMelee = true, hitContext = null) {
        if (this._dying || this.data.hp <= 0) return { damage: 0, parried: false, critical: false };
        const result = super.takeDamage(damage, _source, _damageType, _isMelee, hitContext);
        if (this.data.hp <= 0) this._startDying();
        return result;
    }

    _startDying() {
        this._beginDyingAnimation();
    }

    /** 骑兵学校的通用模块升级：攻击间隔、伤害、移速和生命实时同步。 */
    applyBarracksUpgrades(upgrade = {}) {
        if (this._ai) {
            if (upgrade.attackInterval) this._ai._attackInterval = upgrade.attackInterval;
            if (upgrade.attackDamage) this._ai._attackDamage = upgrade.attackDamage;
        }
        if (this.aiConfig) {
            if (upgrade.attackInterval) this.aiConfig.attackInterval = upgrade.attackInterval;
            if (upgrade.attackDamage) this.aiConfig.attackDamage = upgrade.attackDamage;
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
        if (this.isCombatActionBlocked()) {
            this._updateBlockedCombat(dt, entities);
            return;
        }
        const game = typeof window !== 'undefined' ? window.Game : null;
        this._ai.update(dt, entities, (game && game.player && !game._observerMode) ? game.player : null);
    }

    _removeFromScene() {
        this.active = false;
        this.detachFromOwner();
        const game = typeof window !== 'undefined' ? window.Game : null;
        if (!game) return;
        if (game.entities && this.id) game.entities.delete(this.id);
        if (Array.isArray(game.friendlyUnits)) {
            const index = game.friendlyUnits.indexOf(this);
            if (index >= 0) game.friendlyUnits.splice(index, 1);
        }
    }
}
