import { HamsterScout } from './hamster-scout.js';
import { HamsterScoutAI } from '../ai/hamster-scout-ai.js';
import hamsterLongbowConfig from '../../data/hamster-longbow-config.json';

/** 靶场二级机动射手：复用斥候远程/弹道状态机，使用独立长弓节奏与素材。 */
export class HamsterLongbow extends HamsterScout {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...hamsterLongbowConfig,
            ...overrides,
            ai: { ...(hamsterLongbowConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterLongbowConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(hamsterLongbowConfig.render || {}), ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterLongbow = true;
        this.animId = 'hamster_longbow';
        this.fogVisionProfile = 'military';
        this._ai = new HamsterScoutAI(this);
    }
}
