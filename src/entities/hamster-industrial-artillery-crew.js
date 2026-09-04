import { HamsterCatapultCrew } from './hamster-catapult-crew.js';
import { HamsterHowitzerCrewAI } from '../ai/hamster-howitzer-crew-ai.js';
import industrialArtilleryConfig from '../../data/hamster-industrial-artillery-crew-config.json';

/** 近代双人反坦克炮；沿用炮兵弹道、墙体碰撞、范围伤害和逐帧动作时钟。 */
export class HamsterIndustrialArtilleryCrew extends HamsterCatapultCrew {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...industrialArtilleryConfig, ...overrides,
            ai: { ...industrialArtilleryConfig.ai, ...overrides.ai },
            animations: { ...industrialArtilleryConfig.animations, ...overrides.animations },
            render: { ...industrialArtilleryConfig.render, ...overrides.render },
        });
        this._isHamsterIndustrialArtilleryCrew = true;
        this.animId = industrialArtilleryConfig.id;
        this._ai = new HamsterHowitzerCrewAI(this);
    }
}
