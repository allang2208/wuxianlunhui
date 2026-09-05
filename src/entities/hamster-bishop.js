import { HamsterPriest } from './hamster-priest.js';
import configData from '../../data/hamster-bishop-config.json';

/** 教堂二级法术支援：沿用牧师施法、RTS、升级与生命周期。 */
export class HamsterBishop extends HamsterPriest {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
        };
        super(x, y, archive);
        this._isHamsterBishop = true;
        this.animId = configData.id;
        this.name = configData.name;
        this._syncTierHolyLightLevel(this.aiConfig?.holyLightLevel);
        this.configureCollisionFromArchive(archive);
    }

    _syncTierHolyLightLevel(sharedLevel = 1) {
        const baseLevel = Math.max(1, Math.floor(Number(this.aiConfig?.holyLightBaseLevel) || 1));
        const upgradeLevel = Math.max(1, Math.floor(Number(sharedLevel) || 1));
        this._sharedHolyLightLevel = upgradeLevel;
        const level = baseLevel + upgradeLevel - 1;
        if (this.skills?.holyLight) this.skills.holyLight.level = level;
        if (this.aiConfig) this.aiConfig.holyLightLevel = level;
    }

    applyBarracksUpgrades(patch = {}) {
        super.applyBarracksUpgrades(patch);
        this._syncTierHolyLightLevel(patch.holyLightLevel ?? this._sharedHolyLightLevel);
    }

    _startDying() {
        super._startDying();
        const dying = this.animations?.dying || {};
        const frames = Math.max(1, Number(dying.frameCount) || 61);
        const fps = Math.max(1, Number(dying.frameRate) || 12);
        this._deathTimer = frames / fps * 1000 + 60;
    }
}
