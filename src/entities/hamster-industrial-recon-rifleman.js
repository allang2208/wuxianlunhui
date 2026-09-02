import { HamsterSniper } from './hamster-sniper.js';
import configData from '../../data/hamster-industrial-recon-rifleman-config.json';


export class HamsterIndustrialReconRifleman extends HamsterSniper {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterIndustrialReconRifleman = true;
        this.animId = configData.id;
        this.name = configData.name;
        this.fogVisionProfile = archive.fogVisionProfile;
        this.fogSightRadius = archive.fogSightRadius;
        this.configureCollisionFromArchive(archive);
    }

    getAnimationFootY(textureKey) {
        const prefix = `companion_${this.animId}_`;
        const action = String(textureKey || '').startsWith(prefix)
            ? String(textureKey).slice(prefix.length) : '';
        const footY = Number(this.animations?.[action]?.footY);
        return Number.isFinite(footY) ? footY : undefined;
    }
}
