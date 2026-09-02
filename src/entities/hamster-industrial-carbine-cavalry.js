import { HamsterMusketeer } from './hamster-musketeer.js';
import configData from '../../data/hamster-industrial-carbine-cavalry-config.json';


/** 近代骑兵学院三级轻骑：高速骑枪单位，但必须停稳后才进入单发射击。 */
export class HamsterIndustrialCarbineCavalry extends HamsterMusketeer {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterIndustrialCarbineCavalry = true;
        this.animId = configData.id;
        this.name = configData.name;
        this.configureCollisionFromArchive(archive);
    }

    getCurrentWeapon() {
        return null;
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
        const dying = this.animations?.dying || {};
        const frames = Math.max(1, Number(dying.frameCount) || 31);
        const fps = Math.max(1, Number(dying.frameRate) || 16);
        this._deathTimer = frames / fps * 1000 + 60;
    }
}
