import { HamsterMilitia } from './hamster-militia.js';
import { HamsterMilitiaAI } from '../ai/hamster-militia-ai.js';
import hamsterHalberdierConfig from '../../data/hamster-halberdier-config.json';

/** 草屋二级长枪兵线单位：复用民兵的近战移动、攻击时序与生命周期契约。 */
export class HamsterHalberdier extends HamsterMilitia {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...hamsterHalberdierConfig,
            ...overrides,
            ai: { ...(hamsterHalberdierConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterHalberdierConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(hamsterHalberdierConfig.render || {}), ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterHalberdier = true;
        this.animId = 'hamster_halberdier';
        this._ai = new HamsterMilitiaAI(this);
    }
}
