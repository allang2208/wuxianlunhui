import { HamsterPriest } from './hamster-priest.js';
import { JunglePriestAI } from '../ai/jungle-priest-ai.js';
import configData from '../../data/jungle-priest-config.json';

export class JunglePriest extends HamsterPriest {
    constructor(x, y, overrides = {}) {
        super(x, y, { ...configData, ...overrides, ai: { ...configData.ai, ...(overrides.ai || {}) } });
        this._isJunglePriest = true;
        this.name = configData.name;
        this._ai = new JunglePriestAI(this);
    }

    _startDying() {
        this._ai?._iceSpike?._end?.(true);
        this._ai?._fireball?._end?.(true);
        super._startDying();
    }
}
