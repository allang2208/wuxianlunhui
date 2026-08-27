import { HamsterMusketeer } from './hamster-musketeer.js';
import { HamsterHeavyMachineGunnerAI } from '../ai/hamster-heavy-machine-gunner-ai.js';
import heavyMachineGunnerConfig from '../../data/hamster-heavy-machine-gunner-config.json';

const DYING_DURATION_MS = 1750; // dying 35 帧 @20fps

/** 靶场三级重火力：三发连击、目标贯穿与固定物理穿甲。 */
export class HamsterHeavyMachineGunner extends HamsterMusketeer {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...heavyMachineGunnerConfig,
            ...overrides,
            ai: { ...(heavyMachineGunnerConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(heavyMachineGunnerConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(heavyMachineGunnerConfig.render || {}), ...(overrides.render || {}) },
        });
        this._isHamsterHeavyMachineGunner = true;
        this.animId = 'hamster_heavy_machine_gunner';
        this._machineGunProjectiles = [];
        this._ai = new HamsterHeavyMachineGunnerAI(this);
    }

    /** 重机枪自带固定穿甲，不继承火枪线的可变穿甲弹能力。 */
    getCurrentWeapon() {
        const armorPenetrationPercent = Math.max(
            0, Math.min(1, Number(this.aiConfig?.armorPenetrationPercent) || 0)
        );
        return armorPenetrationPercent > 0
            ? { _craftEffects: { armorPenetrationPercent } }
            : null;
    }

    _startDying() {
        super._startDying();
        this._deathTimer = DYING_DURATION_MS;
        this._machineGunProjectiles = [];
    }
}
