import { HamsterWarrior } from './hamster-warrior.js';
import configData from '../../data/jaguar-warrior-config.json';

export class JaguarWarrior extends HamsterWarrior {
    constructor(x, y, overrides = {}) {
        super(x, y, { ...configData, ...overrides, ai: { ...configData.ai, ...(overrides.ai || {}) } });
        this._isJaguarWarrior = true;
        this._crippleOnHitMs = Math.max(0, Number(configData.crippleDurationMs) || 3000);
        this.name = configData.name;
    }
}
