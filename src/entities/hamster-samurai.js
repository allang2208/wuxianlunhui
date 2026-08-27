import { HamsterWarrior } from './hamster-warrior.js';
import { HamsterSamuraiAI } from '../ai/hamster-samurai-ai.js';
import configData from '../../data/hamster-samurai-config.json';

const DUELIST_RANKS = new Set(['elite', 'lord', 'boss']);

export class HamsterSamurai extends HamsterWarrior {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...configData.ai, ...(overrides.ai || {}) },
            passives: { ...configData.passives, ...(overrides.passives || {}) },
            animations: { ...configData.animations, ...(overrides.animations || {}) },
            render: { ...configData.render, ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterSamurai = true;
        this.animId = configData.id;
        this.name = configData.name;
        this._samuraiAttackSeq = 0;
        this._attackSwing = false;
        this._doubleStrikeChance = Math.max(0, Math.min(1,
            Number(archive.passives?.doubleStrikeChance) || 0));
        this._doubleStrikeMultiplier = Math.max(1,
            Number(archive.passives?.doubleStrikeMultiplier) || 2);
        this._duelistDamageMultiplier = Math.max(1,
            Number(archive.duelistBaseDamageMultiplier) || 1.5);
        this._ai = new HamsterSamuraiAI(this);
    }

    applyBarracksUpgrades(upgrades = {}) {
        super.applyBarracksUpgrades(upgrades);
        const value = Number(upgrades.duelistDamageMultiplier);
        if (Number.isFinite(value)) this._duelistDamageMultiplier = Math.max(1, value);
    }

    getPhysicalAttackDamage(configuredDamage, target = null) {
        let damage = super.getPhysicalAttackDamage(configuredDamage, target);
        this._lastSamuraiDoubleStrike = Math.random() < this._doubleStrikeChance;
        if (this._lastSamuraiDoubleStrike) damage *= this._doubleStrikeMultiplier;
        if (DUELIST_RANKS.has(String(target?.rank || '').toLowerCase())) {
            damage *= this._duelistDamageMultiplier;
        }
        return Math.max(1, Math.round(damage));
    }

    _startDying() {
        super._startDying();
        this._attackSwing = false;
        const dying = this.animations?.dying || {};
        const frames = Math.max(1, Number(dying.frameCount) || 25);
        const fps = Math.max(1, Number(dying.frameRate) || 24);
        this._deathTimer = frames / fps * 1000 + 60;
    }
}
