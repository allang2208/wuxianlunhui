import { HamsterMilitia } from './hamster-militia.js';
import { HamsterMilitiaAI } from '../ai/hamster-militia-ai.js';
import hamsterChampionConfig from '../../data/hamster-champion-config.json';

/** 军营二级双手剑士线：复用成熟近战挥击时序、RTS 与死亡生命周期契约。 */
export class HamsterChampion extends HamsterMilitia {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...hamsterChampionConfig,
            ...overrides,
            ai: { ...(hamsterChampionConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterChampionConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(hamsterChampionConfig.render || {}), ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterChampion = true;
        this.animId = 'hamster_champion';
        this._ai = new HamsterMilitiaAI(this);
    }
}
