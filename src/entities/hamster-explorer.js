import { HamsterScout } from './hamster-scout.js';
import { HamsterExplorerAI } from '../ai/hamster-explorer-ai.js';
import configData from '../../data/hamster-explorer-config.json';

export class HamsterExplorer extends HamsterScout {
    constructor(x, y, overrides = {}) {
        super(x, y, { ...configData, ...overrides, ai: { ...configData.ai, ...(overrides.ai || {}) } });
        this._isHamsterExplorer = true;
        this.name = configData.name;
        this._ai = new HamsterExplorerAI(this);
    }
}
