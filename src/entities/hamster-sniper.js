import { HamsterScout } from './hamster-scout.js';
import hamsterSniperConfig from '../../data/hamster-sniper-config.json';
import { hasEnemyFamily } from '../config/enemy-family.js';

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

    /** 大型与领主目标只承受配置比例的狙击伤害。 */
    getPhysicalAttackDamage(configuredDamage, target = null) {
        const damage = super.getPhysicalAttackDamage(configuredDamage, target);
        const isLargeOrLord = target?.rank === 'lord' || hasEnemyFamily(target, '大型');
        if (!isLargeOrLord) return damage;
        const multiplier = Math.max(0,
            Number(this.aiConfig?.largeOrLordDamageMultiplier) || 0.75);
        return Math.max(1, Math.round(damage * multiplier));
    }
}
