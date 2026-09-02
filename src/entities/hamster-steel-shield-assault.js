import { HamsterMusketeer } from './hamster-musketeer.js';
import configData from '../../data/hamster-steel-shield-assault-config.json';
import { getAbilityLevel, getAbilityValue } from '../world/ability-store.js';
import { getBuildingUpgradeAbility } from '../world/building-upgrade-projects.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { canMeleeShareSurface } from '../combat/melee-surface.js';


export class HamsterSteelShieldAssault extends HamsterMusketeer {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
        };
        super(x, y, archive);
        this._isHamsterSteelShieldAssault = true;
        this.animId = configData.id;
        this.name = configData.name;
        this.configureCollisionFromArchive(archive);
    }

    getCurrentWeapon() {
        return null;
    }

    takeDamage(damage, source, damageType = 'physical', isMelee = true, hitContext = null) {
        if (this._dying || this.data.hp <= 0) {
            return { damage: 0, parried: false, critical: false };
        }
        if (isMelee && source && !canMeleeShareSurface(source, this)) {
            return { damage: 0, parried: false, critical: false };
        }
        const level = getAbilityLevel('auto_guard');
        const ability = getBuildingUpgradeAbility('auto_guard');
        const configuredChanceMultiplier = Number(this.aiConfig?.autoGuardChanceMultiplier);
        const chanceMultiplier = Number.isFinite(configuredChanceMultiplier)
            ? Math.max(0, configuredChanceMultiplier) : 0.9;
        if (level > 0 && ability
            && Math.random() < getAbilityValue(ability, level) * chanceMultiplier) {
            const configuredReduction = Number(this.aiConfig?.autoGuardDamageReduction);
            const reduction = Math.max(0, Math.min(1,
                Number.isFinite(configuredReduction) ? configuredReduction : 0.45));
            damage = Math.round(damage * (1 - reduction));
            EffectManager?.add(new FloatingTextEffect(
                this.x, this.y - 34, '🛡️ 防御', '#7fd4ff'));
        }
        return super.takeDamage(damage, source, damageType, isMelee, hitContext);
    }

    getAnimationFootY(textureKey) {
        const prefix = `companion_${this.animId}_`;
        const action = String(textureKey || '').startsWith(prefix)
            ? String(textureKey).slice(prefix.length) : '';
        const footY = Number(this.animations?.[action]?.footY);
        return Number.isFinite(footY) ? footY : undefined;
    }

    _startDying() {
        super._startDying();
        const dying = this.animations?.dying || {};
        const frames = Math.max(1, Number(dying.frameCount) || 45);
        const fps = Math.max(1, Number(dying.frameRate) || 12);
        this._deathTimer = frames / fps * 1000 + 60;
    }
}
