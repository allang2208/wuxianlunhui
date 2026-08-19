// ============================================================
// HamsterPriest — 仓鼠牧师（世界-122）
// 无普通攻击；由 HamsterPriestAI 跟随玩家，并以圣光优先治疗受伤友军。
// ============================================================
import { Companion } from './companion.js';
import { HamsterPriestAI } from '../ai/hamster-priest-ai.js';
import configData from '../../data/hamster-priest-config.json';

const DYING_DURATION_MS = 1334; // dying 16 帧 @12fps

export class HamsterPriest extends Companion {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
        };
        super(archive);
        // 新生成单位也要继承教堂已经完成的全局圣光强化等级。
        if (Number.isFinite(this.aiConfig?.holyLightLevel) && this.skills?.holyLight) {
            this.skills.holyLight.level = Math.max(1, Math.floor(this.aiConfig.holyLightLevel));
        }
        this._isHamsterPriest = true;
        this.animId = 'hamster_priest';
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
        // 素材脚底约在 y=350/512；displaySize=250 后与其他仓鼠的有效角色高度对齐，
        // 相对逻辑脚底约 45px。
        this.footOffsetY = 45;
        this.config = { render: { hudOffsetY: 119, footOffsetY: 45 } };
        this._dying = false;
        this._deathTimer = 0;
        this._ai = new HamsterPriestAI(this);
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
        this._prayerCast = false;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        this.maxSpeed = 0;
        this._deathTimer = DYING_DURATION_MS;
    }

    /** 教堂升级实时同步：施法冷却与圣光等级均立即更新。 */
    applyBarracksUpgrades(u = {}) {
        if (this._ai && typeof this._ai.applyUpgrades === 'function') this._ai.applyUpgrades(u);
        if (this.aiConfig && Number.isFinite(u.holyLightCooldownMult)) {
            this.aiConfig.holyLightCooldownMult = u.holyLightCooldownMult;
        }
        if (this.aiConfig && Number.isFinite(u.holyLightLevel)) {
            this.aiConfig.holyLightLevel = Math.max(1, Math.floor(u.holyLightLevel));
        }
        if (Number.isFinite(u.holyLightLevel) && this.skills?.holyLight) {
            this.skills.holyLight.level = Math.max(1, Math.floor(u.holyLightLevel));
        }
        if (u.baseMaxHp && this._maxHpOverride !== u.baseMaxHp) {
            this._maxHpOverride = u.baseMaxHp;
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
        this._ai.update(dt, entities, (game && game.player && !game._observerMode) ? game.player : null); // 观察模式：仓鼠部队不跟随不在场的玩家
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
