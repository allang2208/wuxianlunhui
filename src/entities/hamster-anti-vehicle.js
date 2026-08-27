import { HamsterMusketeer } from './hamster-musketeer.js';
import { HamsterAntiVehicleAI } from '../ai/hamster-anti-vehicle-ai.js';
import antiVehicleConfig from '../../data/hamster-anti-vehicle-config.json';

/** 草屋三级长枪兵线：冲锋枪常规射击 + 周期性一次性反坦克火箭。 */
export class HamsterAntiVehicle extends HamsterMusketeer {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...antiVehicleConfig,
            ...overrides,
            ai: { ...(antiVehicleConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(antiVehicleConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(antiVehicleConfig.render || {}), ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterAntiVehicle = true;
        this.animId = 'hamster_anti_vehicle';
        this._attackVariant = 'smg';
        this._ai = new HamsterAntiVehicleAI(this);
    }

    applyBarracksUpgrades(u = {}) {
        super.applyBarracksUpgrades(u);
        if (!u.attackDamage || !this._ai) return;
        const baseBulletDamage = Math.max(1, Number(antiVehicleConfig.ai?.attackDamage) || 18);
        const multiplier = Math.max(0, Number(u.attackDamage) || 0) / baseBulletDamage;
        const rocketDamage = Math.round((Number(antiVehicleConfig.ai?.rocketDamage) || 240) * multiplier);
        this._ai._rocketDamage = rocketDamage;
        if (this.aiConfig) this.aiConfig.rocketDamage = rocketDamage;
    }

    _startDying() {
        super._startDying();
        this._attackVariant = 'smg';
        if (this._discardedLauncher) this._discardedLauncher.active = false;
        if (this._antiVehicleExplosion) this._antiVehicleExplosion.active = false;
    }
}
