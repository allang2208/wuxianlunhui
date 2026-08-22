import { HamsterWarrior } from './hamster-warrior.js';
import configData from '../../data/jaguar-warrior-config.json';

export class JaguarWarrior extends HamsterWarrior {
    constructor(x, y, overrides = {}) {
        super(x, y, { ...configData, ...overrides, ai: { ...configData.ai, ...(overrides.ai || {}) } });
        this._isJaguarWarrior = true;
        this.animId = configData.id;
        this._crippleOnHitMs = Math.max(0, Number(configData.crippleDurationMs) || 3000);
        this.name = configData.name;
        const renderConfig = configData.render || {};
        this.footOffsetY = Math.max(0, Number(renderConfig.footOffsetY) || 98);
        this.config = {
            render: {
                ...(this.config?.render || {}),
                ...renderConfig,
                footOffsetY: this.footOffsetY,
            },
        };
    }

    _startDying() {
        super._startDying();
        const dying = this.animations?.dying || {};
        const frames = Math.max(1, Number(dying.frameCount) || 24);
        const fps = Math.max(1, Number(dying.frameRate) || 12);
        this._deathTimer = frames / fps * 1000 + 60;
    }
}
