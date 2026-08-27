// ============================================================
// HamsterRiotSquad — 仓鼠防暴队（2026-08-27）
// 三级盾卫路线：复用火枪单位成熟的接敌/视线/RTS 链，
// 释放帧改走无弹道扇区，同时保留盾系自动防御且不继承穿甲弹能力。
// ============================================================
import { HamsterMusketeer } from './hamster-musketeer.js';
import { HamsterRiotSquadAI } from '../ai/hamster-riot-squad-ai.js';
import hamsterRiotSquadConfig from '../../data/hamster-riot-squad-config.json';
import { getAbilityLevel, getAbilityValue } from '../world/ability-store.js';
import { getBuildingUpgradeAbility } from '../world/building-upgrade-projects.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';

const DYING_DURATION_MS = 1550; // dying 31 帧 @20fps

export class HamsterRiotSquad extends HamsterMusketeer {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...hamsterRiotSquadConfig,
            ...overrides,
            ai: { ...(hamsterRiotSquadConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterRiotSquadConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(hamsterRiotSquadConfig.render || {}), ...(overrides.render || {}) },
        });
        this._isHamsterRiotSquad = true;
        this.animId = 'hamster_riot_squad';
        this._ai = new HamsterRiotSquadAI(this);
    }

    /** 防暴队属于盾卫路线，不吃火枪路线的穿甲弹。 */
    getCurrentWeapon() {
        return null;
    }

    takeDamage(damage, source, damageType = 'physical', isMelee = true) {
        if (this._dying || this.data.hp <= 0) {
            return { damage: 0, parried: false, critical: false };
        }
        const guardLevel = getAbilityLevel('auto_guard');
        const guardAbility = getBuildingUpgradeAbility('auto_guard');
        if (guardLevel > 0 && guardAbility
            && Math.random() < getAbilityValue(guardAbility, guardLevel)) {
            damage = Math.round(damage * (1 - guardAbility.damageReduction));
            EffectManager?.add(new FloatingTextEffect(this.x, this.y - 34, '🛡️ 防御', '#7fd4ff'));
        }
        return super.takeDamage(damage, source, damageType, isMelee);
    }

    _startDying() {
        super._startDying();
        this._deathTimer = DYING_DURATION_MS;
    }
}
