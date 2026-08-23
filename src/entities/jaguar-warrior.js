import { HamsterWarrior } from './hamster-warrior.js';
import configData from '../../data/jaguar-warrior-config.json';
import { getEnemyFamilies } from '../config/enemy-family.js';

export class JaguarWarrior extends HamsterWarrior {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...configData,
            ...overrides,
            ai: { ...configData.ai, ...(overrides.ai || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
        });
        this._isJaguarWarrior = true;
        this._familyDamageMultipliers = {};
        this.animId = configData.id;
        this._crippleOnHitMs = Math.max(0, Number(configData.crippleDurationMs) || 3000);
        this.name = configData.name;
        const renderConfig = { ...(configData.render || {}), ...(overrides.render || {}) };
        this.footOffsetY = Math.max(0, Number(renderConfig.footOffsetY) || 72.280263);
        this.config = {
            render: {
                ...(this.config?.render || {}),
                ...renderConfig,
                footOffsetY: this.footOffsetY,
            },
        };
        this.configureCollisionFromArchive({
            ...configData,
            ...overrides,
            render: { ...renderConfig, ...(overrides.render || {}) },
        });
    }

    applyBarracksUpgrades(upgrades = {}) {
        super.applyBarracksUpgrades(upgrades);
        this._familyDamageMultipliers = { ...(upgrades.familyDamageMultipliers || {}) };
    }

    getPhysicalAttackDamage(configuredDamage, target = null) {
        const damage = super.getPhysicalAttackDamage(configuredDamage, target);
        const multiplier = getEnemyFamilies(target).reduce(
            (best, family) => Math.max(best, Number(this._familyDamageMultipliers[family]) || 1),
            1
        );
        return Math.max(1, Math.round(damage * Math.max(0, multiplier)));
    }

    _startDying() {
        super._startDying();
        const dying = this.animations?.dying || {};
        const frames = Math.max(1, Number(dying.frameCount) || 24);
        const fps = Math.max(1, Number(dying.frameRate) || 12);
        this._deathTimer = frames / fps * 1000 + 60;
    }
}
