import { HamsterScout } from './hamster-scout.js';
import { HamsterScoutAI } from '../ai/hamster-scout-ai.js';
import hamsterCrossbowConfig from '../../data/hamster-crossbow-config.json';

/** 靶场一级重火力：复用斥候远程状态机，使用独立重弩数值与贯穿弹配置。 */
export class HamsterCrossbow extends HamsterScout {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...hamsterCrossbowConfig,
            ...overrides,
            ai: { ...(hamsterCrossbowConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterCrossbowConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(hamsterCrossbowConfig.render || {}), ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterCrossbow = true;
        this.animId = 'hamster_crossbow';
        // HamsterCrossbow reuses the scout entity/AI implementation only; it is
        // a regular shooting-range unit and must not inherit the scout's 1450
        // fog-of-war vision profile through _isHamsterScout.
        this.fogVisionProfile = 'military';
        this._ai = new HamsterScoutAI(this);
    }

    /** 重弩自带固定穿甲，不依赖火药线的穿甲弹科技。 */
    getCurrentWeapon() {
        const armorPenetrationPercent = Math.max(
            0, Math.min(1, Number(this.aiConfig?.armorPenetrationPercent) || 0)
        );
        return armorPenetrationPercent > 0
            ? { _craftEffects: { armorPenetrationPercent } }
            : null;
    }
}
