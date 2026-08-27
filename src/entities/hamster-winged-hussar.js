import { HamsterKnight } from './hamster-knight.js';
import configData from '../../data/hamster-winged-hussar-config.json';

/** 骑兵学院二级重骑：沿用骑士的普攻与冲锋生命周期。 */
export class HamsterWingedHussar extends HamsterKnight {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
        };
        super(x, y, archive);
        this._isHamsterWingedHussar = true;
        this.animId = configData.id;
        this.name = configData.name;
        this.footOffsetY = Math.max(0, Number(archive.render?.footOffsetY) || 88.367188);
        this.config = {
            render: {
                ...(this.config?.render || {}),
                ...(archive.render || {}),
                footOffsetY: this.footOffsetY,
            },
        };
        this.configureCollisionFromArchive(archive);
    }

    _startDying() {
        super._startDying();
        const dying = this.animations?.dying || {};
        const frames = Math.max(1, Number(dying.frameCount) || 39);
        const fps = Math.max(1, Number(dying.frameRate) || 24);
        this._deathTimer = frames / fps * 1000 + 60;
    }
}
