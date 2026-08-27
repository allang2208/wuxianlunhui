// ============================================================
// HamsterSpecialForces — 仓鼠特战（2026-08-27）
// 兵营三级输出路线：复用成熟火枪接敌/LOS/RTS 与霰弹扇区结算，
// 不继承盾卫自动防御，也不消费火枪穿甲弹。
// ============================================================
import { HamsterMusketeer } from './hamster-musketeer.js';
import { HamsterRiotSquadAI } from '../ai/hamster-riot-squad-ai.js';
import hamsterSpecialForcesConfig from '../../data/hamster-special-forces-config.json';

const DYING_DURATION_MS = 1550; // dying 31 帧 @20fps

export class HamsterSpecialForces extends HamsterMusketeer {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...hamsterSpecialForcesConfig,
            ...overrides,
            ai: { ...(hamsterSpecialForcesConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterSpecialForcesConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(hamsterSpecialForcesConfig.render || {}), ...(overrides.render || {}) },
        });
        this._isHamsterSpecialForces = true;
        this.animId = 'hamster_special_forces';
        this._ai = new HamsterRiotSquadAI(this);
    }

    getCurrentWeapon() {
        return null;
    }

    _startDying() {
        super._startDying();
        this._deathTimer = DYING_DURATION_MS;
    }
}
