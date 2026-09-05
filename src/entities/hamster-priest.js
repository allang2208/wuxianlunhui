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
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
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
        this.groundRadius = Number(archive.groundRadius) || 20;
        this.collisionRadius = Number(archive.collisionRadius) || this.groundRadius;
        this.bodyHeight = Number(archive.bodyHeight) || 100;
        this.size = Number(archive.size) || 64;
        this.hittable = true;
        this.hitFlash = 0;
        // 仓鼠牧师是步兵/施法单位视觉与碰撞基准；其它同类单位按 alpha 内容高度
        // 换算 displaySize，不能机械照抄 250。
        const renderConfig = archive.render || {};
        this.footOffsetY = Math.max(0, Number(renderConfig.footOffsetY) || 45);
        this.config = {
            render: {
                ...renderConfig,
                hudOffsetY: Math.max(0, Number(renderConfig.hudOffsetY) || 119),
                footOffsetY: this.footOffsetY,
            },
        };
        this._dying = false;
        this._deathTimer = 0;
        this._ai = new HamsterPriestAI(this);
        this._animState = 'idle';
        this.configureCollisionFromArchive(archive);
    }

    takeDamage(damage, _source, _damageType = 'physical', _isMelee = true, hitContext = null) {
        if (this._dying || this.data.hp <= 0) return { damage: 0, parried: false, critical: false };
        const result = super.takeDamage(damage, _source, _damageType, _isMelee, hitContext);
        if (this.data.hp <= 0) this._startDying();
        return result;
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

    /** 教堂升级实时同步：施法冷却、施法距离、圣光等级与什一税均立即更新。 */
    applyBarracksUpgrades(u = {}) {
        if (this._ai && typeof this._ai.applyUpgrades === 'function') this._ai.applyUpgrades(u);
        if (this.aiConfig && Number.isFinite(u.holyLightCooldownMult)) {
            this.aiConfig.holyLightCooldownMult = u.holyLightCooldownMult;
        }
        if (this.aiConfig && Number.isFinite(u.holyLightLevel)) {
            this.aiConfig.holyLightLevel = Math.max(1, Math.floor(u.holyLightLevel));
        }
        if (this.aiConfig && Number.isFinite(u.castRange)) this.aiConfig.castRange = u.castRange;
        if (this.aiConfig && Number.isFinite(u.titheEnergyPerTick)) {
            this.aiConfig.titheEnergyPerTick = u.titheEnergyPerTick;
            this.aiConfig.titheIntervalMs = u.titheIntervalMs;
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
        if (this.hasStatusEffect('petrified')) {
            this.vx = 0; this.vy = 0; this.isMoving = false;
            return;
        }
        const game = typeof window !== 'undefined' ? window.Game : null;
        this._ai.update(dt, entities, (game && game.player && !game._observerMode) ? game.player : null); // 观察模式：仓鼠部队不跟随不在场的玩家
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
