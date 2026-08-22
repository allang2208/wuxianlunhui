import { HamsterPriest } from './hamster-priest.js';
import { JunglePriestAI } from '../ai/jungle-priest-ai.js';
import configData from '../../data/jungle-priest-config.json';

export class JunglePriest extends HamsterPriest {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...configData,
            ...overrides,
            ai: { ...configData.ai, ...(overrides.ai || {}) },
            animations: { ...configData.animations, ...(overrides.animations || {}) },
        });
        this._isJunglePriest = true;
        this.animId = configData.id;
        this.name = configData.name;
        const renderConfig = configData.render || {};
        this.footOffsetY = Math.max(0, Number(renderConfig.footOffsetY) || 109);
        this.config = {
            ...(this.config || {}),
            render: {
                ...(this.config?.render || {}),
                ...renderConfig,
                footOffsetY: this.footOffsetY,
            },
        };
        this._ai = new JunglePriestAI(this);
    }

    _startDying() {
        this._ai?._iceSpike?._end?.(true);
        this._ai?._fireball?._end?.(true);
        super._startDying();
        const dying = this.animations?.dying || {};
        const frames = Math.max(1, Number(dying.frameCount) || 16);
        const fps = Math.max(1, Number(dying.frameRate) || 12);
        this._deathTimer = frames / fps * 1000 + 60;
    }
}
