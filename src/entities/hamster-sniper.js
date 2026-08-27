import { HamsterScout } from './hamster-scout.js';
import hamsterSniperConfig from '../../data/hamster-sniper-config.json';

/** 草屋三级斥候线：复用斥候的预判射击、标记、寻路与远程 LOS 契约。 */
export class HamsterSniper extends HamsterScout {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...hamsterSniperConfig,
            ...overrides,
            ai: { ...(hamsterSniperConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterSniperConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(hamsterSniperConfig.render || {}), ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterSniper = true;
        this.animId = 'hamster_sniper';
        this.fogVisionProfile = archive.fogVisionProfile || 'scout';
        this.fogSightRadius = Math.max(1, Number(archive.fogSightRadius) || 1900);
    }
}
