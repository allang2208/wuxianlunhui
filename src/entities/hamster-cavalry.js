import { HamsterLightCavalry } from './hamster-light-cavalry.js';
import configData from '../../data/hamster-cavalry-config.json';

/** 骑兵学院二级轻骑：复用轻骑的配置驱动近战状态机。 */
export class HamsterCavalry extends HamsterLightCavalry {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
        };
        super(x, y, archive);
        this._isHamsterCavalry = true;
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
