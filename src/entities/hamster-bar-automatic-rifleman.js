import { HamsterHeavyMachineGunner } from './hamster-heavy-machine-gunner.js';
import configData from '../../data/hamster-bar-automatic-rifleman-config.json';


/** 近代射击学校三级重火力：单人BAR三发点射、固定穿甲和两目标贯穿。 */
export class HamsterBarAutomaticRifleman extends HamsterHeavyMachineGunner {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterBarAutomaticRifleman = true;
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
