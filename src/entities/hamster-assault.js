// ============================================================
// HamsterAssault — 仓鼠突击（2026-08-27）
// 靶场三级机动射手：复用火枪单位成熟的远程、LOS、RTS 与曳光弹链，
// 保持独立身份和配置，不继承火枪/赏金猎人的穿甲弹能力。
// ============================================================
import { HamsterMusketeer } from './hamster-musketeer.js';
import hamsterAssaultConfig from '../../data/hamster-assault-config.json';

const DYING_DURATION_MS = 1550; // dying 31 帧 @20fps

export class HamsterAssault extends HamsterMusketeer {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...hamsterAssaultConfig,
            ...overrides,
            ai: { ...(hamsterAssaultConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterAssaultConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(hamsterAssaultConfig.render || {}), ...(overrides.render || {}) },
        });
        this._isHamsterAssault = true;
        this.animId = 'hamster_assault';
    }

    getCurrentWeapon() {
        return null;
    }

    _startDying() {
        super._startDying();
        this._deathTimer = DYING_DURATION_MS;
    }
}
