import { HamsterAssault } from './hamster-assault.js';
import configData from '../../data/hamster-service-rifleman-config.json';


/** 近代射击学校三级射手：停步单发制式步枪，不继承毒箭、标记或额外穿甲。 */
export class HamsterServiceRifleman extends HamsterAssault {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterServiceRifleman = true;
        this.animId = configData.id;
        this.name = configData.name;
        this.configureCollisionFromArchive(archive);
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
