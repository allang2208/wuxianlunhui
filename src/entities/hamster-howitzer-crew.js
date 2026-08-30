import { HamsterCatapultCrew } from './hamster-catapult-crew.js';
import { HamsterHowitzerCrewAI } from '../ai/hamster-howitzer-crew-ai.js';
import howitzerConfig from '../../data/hamster-howitzer-crew-config.json';

/** 三级双人工程器械；继承器械的逐帧时钟、RTS、承伤和尸体生命周期。 */
export class HamsterHowitzerCrew extends HamsterCatapultCrew {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...howitzerConfig, ...overrides,
            ai: { ...howitzerConfig.ai, ...overrides.ai },
            animations: { ...howitzerConfig.animations, ...overrides.animations },
            render: { ...howitzerConfig.render, ...overrides.render },
        });
        this._isHamsterHowitzerCrew = true;
        this.animId = howitzerConfig.id;
        this._ai = new HamsterHowitzerCrewAI(this);
    }
}
