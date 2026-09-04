import { HamsterCatapultCrew } from './hamster-catapult-crew.js';
import fieldCannonConfig from '../../data/hamster-field-cannon-crew-config.json';

/** 二级双人野战炮：复用器械抛射、RTS、逐帧时钟和完整倒地生命周期。 */
export class HamsterFieldCannonCrew extends HamsterCatapultCrew {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...fieldCannonConfig, ...overrides,
            ai: { ...fieldCannonConfig.ai, ...overrides.ai },
            animations: { ...fieldCannonConfig.animations, ...overrides.animations },
            render: { ...fieldCannonConfig.render, ...overrides.render },
        });
        this._isHamsterFieldCannonCrew = true;
        this.animId = fieldCannonConfig.id;
    }
}
