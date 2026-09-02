import { HamsterMusketeer } from './hamster-musketeer.js';
import { HamsterAntiTankRiflemanAI } from '../ai/hamster-anti-tank-rifleman-ai.js';
import configData from '../../data/hamster-anti-tank-rifleman-config.json';


export class HamsterAntiTankRifleman extends HamsterMusketeer {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterAntiTankRifleman = true;
        this.animId = configData.id;
        this.name = configData.name;
        this._ai = new HamsterAntiTankRiflemanAI(this);
        this.configureCollisionFromArchive(archive);
    }

    getCurrentWeapon() {
        return null;
    }

    applyBarracksUpgrades(upgrades = {}) {
        super.applyBarracksUpgrades(upgrades);
        if (!upgrades.attackDamage || !this._ai) return;
        const baseDamage = Math.max(1, Number(configData.ai?.attackDamage) || 15);
        const multiplier = Math.max(0, Number(upgrades.attackDamage) || 0) / baseDamage;
        const grenadeDamage = (Number(configData.ai?.grenadeDamage) || 150) * multiplier;
        this._ai._grenadeDamage = grenadeDamage;
        if (this.aiConfig) this.aiConfig.grenadeDamage = grenadeDamage;
    }

    getAnimationFootY(textureKey) {
        const prefix = `companion_${this.animId}_`;
        const action = String(textureKey || '').startsWith(prefix)
            ? String(textureKey).slice(prefix.length) : '';
        const footY = Number(this.animations?.[action]?.footY);
        return Number.isFinite(footY) ? footY : undefined;
    }

    _startDying() {
        super._startDying();
        this._friendlyAttackClock = null;
        const dying = this.animations?.dying || {};
        const frames = Math.max(1, Number(dying.frameCount) || 47);
        const fps = Math.max(1, Number(dying.frameRate) || 24);
        this._deathTimer = frames / fps * 1000 + 60;
        if (this._antiVehicleExplosion) this._antiVehicleExplosion.active = false;
    }
}
