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
        // 重弩仅复用斥候实体/AI；仍按普通靶场军事单位视野处理。
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
