import { HamsterScout } from './hamster-scout.js';
import { HamsterScoutAI } from '../ai/hamster-scout-ai.js';
import hamsterRangerConfig from '../../data/hamster-ranger-config.json';

/** 草屋二级斥候线单位：沿用斥候的远程移动/射击契约，使用独立配置和动画。 */
export class HamsterRanger extends HamsterScout {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...hamsterRangerConfig,
            ...overrides,
            ai: { ...(hamsterRangerConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterRangerConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(hamsterRangerConfig.render || {}), ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterRanger = true;
        this.animId = 'hamster_ranger';
        this._ai = new HamsterScoutAI(this);
    }
}
