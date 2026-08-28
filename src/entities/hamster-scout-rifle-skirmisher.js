import { HamsterMusketeer } from './hamster-musketeer.js';
import { HamsterScoutRifleSkirmisherAI } from '../ai/hamster-scout-rifle-skirmisher-ai.js';
import scoutRifleSkirmisherConfig from '../../data/hamster-scout-rifle-skirmisher-config.json';

const DYING_DURATION_MS = 49 / 24 * 1000;

/** 骑兵学院三级轻骑：移动路径与单发步枪射击互不打断。 */
export class HamsterScoutRifleSkirmisher extends HamsterMusketeer {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...scoutRifleSkirmisherConfig,
            ...overrides,
            ai: { ...(scoutRifleSkirmisherConfig.ai || {}), ...(overrides.ai || {}) },
            animations: {
                ...(scoutRifleSkirmisherConfig.animations || {}),
                ...(overrides.animations || {}),
            },
            render: {
                ...(scoutRifleSkirmisherConfig.render || {}),
                ...(overrides.render || {}),
            },
        });
        this._isHamsterScoutRifleSkirmisher = true;
        this.animId = 'hamster_scout_rifle_skirmisher';
        this._scoutRifleShotSeq = 0;
        this._ai = new HamsterScoutRifleSkirmisherAI(this);
    }

    /** 侦察步枪保持独立兵种，不继承火枪线的穿甲弹研究。 */
    getCurrentWeapon() {
        return null;
    }

    _startDying() {
        super._startDying();
        this._deathTimer = DYING_DURATION_MS;
    }
}
