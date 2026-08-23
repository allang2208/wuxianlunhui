import { HamsterPriest } from './hamster-priest.js';
import { JunglePriestAI } from '../ai/jungle-priest-ai.js';
import configData from '../../data/jungle-priest-config.json';

export class JunglePriest extends HamsterPriest {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...configData,
            ...overrides,
            ai: { ...configData.ai, ...(overrides.ai || {}) },
            animations: { ...configData.animations, ...(overrides.animations || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
        });
        this._isJunglePriest = true;
        this.animId = configData.id;
        this.name = configData.name;
        const renderConfig = { ...(configData.render || {}), ...(overrides.render || {}) };
        this.footOffsetY = Math.max(0, Number(renderConfig.footOffsetY) || 83.140105);
        this.config = {
            ...(this.config || {}),
            render: {
                ...(this.config?.render || {}),
                ...renderConfig,
                footOffsetY: this.footOffsetY,
            },
        };
        this._jungleMagicLevel = Math.max(1, Math.floor(Number(this.aiConfig?.jungleMagicLevel) || 1));
        this._jungleSpellCooldownMult = Math.max(0, Number(this.aiConfig?.jungleSpellCooldownMult) || 1);
        this._syncJungleMagicLevels();
        this._ai = new JunglePriestAI(this);
        this.configureCollisionFromArchive({
            ...configData,
            ...overrides,
            render: { ...renderConfig, ...(overrides.render || {}) },
        });
    }

    _syncJungleMagicLevels() {
        for (const skillId of configData.skills || []) {
            const skill = this.skills?.[skillId];
            if (!skill) continue;
            skill.level = Math.min(
                Math.max(1, Math.floor(Number(skill.maxLevel) || this._jungleMagicLevel)),
                this._jungleMagicLevel
            );
            skill.exp = 0;
            if (typeof skill.getExpForNext === 'function') skill.maxExp = skill.getExpForNext(skill.level);
        }
    }

    getSkillCooldownMultiplier(skillId) {
        return (configData.skills || []).includes(skillId) ? this._jungleSpellCooldownMult : 1;
    }

    applyBarracksUpgrades(upgrades = {}) {
        super.applyBarracksUpgrades(upgrades);
        if (Number.isFinite(upgrades.jungleMagicLevel)) {
            this._jungleMagicLevel = Math.max(1, Math.floor(upgrades.jungleMagicLevel));
            if (this.aiConfig) this.aiConfig.jungleMagicLevel = this._jungleMagicLevel;
            this._syncJungleMagicLevels();
        }
        if (Number.isFinite(upgrades.jungleSpellCooldownMult)) {
            const previous = Math.max(0.01, Number(this._jungleSpellCooldownMult) || 1);
            const next = Math.max(0, upgrades.jungleSpellCooldownMult);
            const remainingRatio = next / previous;
            if (this._iceSpikeCooldown > 0) this._iceSpikeCooldown *= remainingRatio;
            if (this._fireballCooldown > 0) this._fireballCooldown *= remainingRatio;
            this._jungleSpellCooldownMult = next;
            if (this.aiConfig) this.aiConfig.jungleSpellCooldownMult = this._jungleSpellCooldownMult;
        }
    }

    _startDying() {
        this._ai?._iceSpike?._end?.(true);
        this._ai?._fireball?._end?.(true);
        super._startDying();
        const dying = this.animations?.dying || {};
        const frames = Math.max(1, Number(dying.frameCount) || 16);
        const fps = Math.max(1, Number(dying.frameRate) || 12);
        this._deathTimer = frames / fps * 1000 + 60;
    }
}
