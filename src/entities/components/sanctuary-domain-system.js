import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { SceneManager } from '../../world/scene-manager.js';
import { SanctuaryDomainFx } from '../../effects/sanctuary-domain-fx.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { SkillManager } from '../../ui/skill-manager.js';
import {
    getCurrentWeaponCraftEffects,
    getMagicMpCostMultiplier,
    getMagicCooldownMultiplier,
    getMagicDamageMultiplierWithChain,
    createMagicCastContext,
    getMagicHealMultiplierWithChain,
    consumeChainSpellBonus,
    addChainSpellStack,
    applyCastHaste,
} from '../../utils/magic-craft-helper.js';
import skillsData from '../../../data/skills.json';
import { isSkillCheatEnabled } from '../../config/dev-cheats.js';
import { meetsMagicWeaponReq } from '../../config/magic-categories.js';
import { hasEnemyFamily } from '../../config/enemy-family.js';

/** 圣辉领域数值默认（配置唯一真相：skills.json effectFormula 必有；缺省兜底统一收敛于此） */
const SANCTUARY_DEFAULTS = {
    cooldown: 26,
    mpCost: 60,
    duration: 8,
    radius: 240,
    tickMs: 500,
    healBase: 5,
    healWisMul: 0.4,
    damageBase: 8,
    damageMagicMul: 0.25,
    damageIntMul: 0.25,
    zombieDamageMul: 2.5,
    cleanseIntervalMs: 2000,
};

/** 友方阵营组（与 holy-light-system / damageable-entity.isFriendlyFire 同口径） */
const FRIENDLY_FACTIONS = new Set(['player', 'companion']);

/** 世界-122 的建筑、墙门和塔统一标记为防御结构，不成为领域目标。 */
function isStructure(target) {
    return !!target?._isDefenseStructure;
}

/** 可净化的负面状态清单（每跳最多移除 1 个；数值走配置不改这里） */
const CLEANSE_TYPES = ['poison', 'bleed', 'fear', 'chill', 'frozen', 'slow', 'bind',
    'magicVulnerability', 'droneVulnerability', 'electrified'];

/**
 * 圣辉领域技能系统（2026-08-23，光系中级：跟身治疗/净化/压制不死光环）
 *
 * 释放：以自身为中心展开圣辉领域并跟随移动，持续 effect.duration 秒：
 * - 友军每 tickMs 回复生命（基础 + 精神加成，吃治疗链式强化）；
 * - 友军每 cleanseIntervalMs 净化 1 个负面状态（中毒/流血/恐惧/寒冷/感电等）；
 * - 敌方每 tickMs 受光系魔法伤害（僵尸类 ×zombieDamageMul）。
 * 命中/击杀/治疗按整次施法累计，领域结束统一结算经验（与雷暴领域同口径）。
 */
export class SanctuaryDomainSystem {
    constructor(source) {
        this.source = source;
        this._active = false;
        this._remaining = 0;
        this._tickTimer = 0;
        this._cleanseTimer = 0;
        this._damageMul = 1;
        this._healMul = 1;
        this._acc = { hits: 0, kills: 0, heals: 0, multiHit: false };
        this._fx = null;
        this._effect = null;
    }

    _isPlayer() {
        return this.source && this.source._faction === 'player';
    }

    isActive() {
        return this._active;
    }

    trigger() {
        const src = this.source;
        if (!src || (!isSkillCheatEnabled() && src._sanctuaryDomainCooldown > 0)) return;
        // 中级魔法门槛：需装备法杖才能释放（测试开关可绕过）
        if (this._isPlayer()) {
            const req = meetsMagicWeaponReq(src, 'sanctuaryDomain');
            if (!req.ok) {
                if (SceneManager && typeof SceneManager.showTopNotification === 'function') {
                    SceneManager.showTopNotification(req.reason);
                }
                return;
            }
        }
        const skill = src.skills && src.skills.sanctuaryDomain;
        if (!skill) return;
        const baseEffect = skill.getEffect(skill.level);

        // MP 门禁（含链式减免）
        const ce = getCurrentWeaponCraftEffects(src);
        const chainStacks = (src._chainSpellStacks) || 0;
        const mpMul = getMagicMpCostMultiplier(src, ce, chainStacks);
        const mpCost = baseEffect.mpCost ? Math.max(0, Math.floor(baseEffect.mpCost * mpMul)) : 0;
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0 && src.data.mp < mpCost) {
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 30, '魔法不足', '#ffd27a'));
            return;
        }
        const chain = consumeChainSpellBonus(src);
        this._castContext = createMagicCastContext(src, ce);
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0) src.data.mp -= mpCost;

        const effect = { ...SANCTUARY_DEFAULTS, ...baseEffect, mpCost };
        effect.cooldown = effect.cooldown * getMagicCooldownMultiplier(src, ce);
        this._damageMul = getMagicDamageMultiplierWithChain(src, 'sanctuaryDomain', ce, chain.stacks);
        this._healMul = getMagicHealMultiplierWithChain(src, 'sanctuaryDomain', ce, chain.stacks);
        if (!isSkillCheatEnabled()) src._sanctuaryDomainCooldown = effect.cooldown * 1000;

        const doRelease = () => {
            const castSounds = skillsData.skills?.sanctuaryDomain?.sounds?.cast;
            if (castSounds && SoundManager && typeof SoundManager.playFile === 'function') {
                (Array.isArray(castSounds) ? castSounds : [castSounds]).forEach(p => SoundManager.playFile(p));
            }
            this._activateDomain(effect);
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 40, '🌟 圣辉领域', '#ffd27a'));
            addChainSpellStack(src, this._castContext.craftEffects);
            applyCastHaste(src, this._castContext.craftEffects);
        };
        if (this._isPlayer()) {
            this._startPlayerCast(doRelease);
        } else {
            doRelease();
        }
    }

    _activateDomain(effect) {
        const src = this.source;
        this._active = true;
        src._sanctuaryDomainActive = true;
        this._remaining = effect.duration * 1000;
        this._tickTimer = 0;
        this._cleanseTimer = 0;
        this._acc = { hits: 0, kills: 0, heals: 0, multiHit: false };
        this._effect = effect;
        if (!this._fx) {
            this._fx = new SanctuaryDomainFx(src, { radius: effect.radius });
            EffectManager.add(this._fx);
        }
    }

    _isFriendly(e) {
        const src = this.source;
        return !!(e && e !== src && e.active && e.hittable && !isStructure(e)
            && FRIENDLY_FACTIONS.has(src._faction) && FRIENDLY_FACTIONS.has(e._faction));
    }

    _isHostile(e) {
        const src = this.source;
        return !!(e && e !== src && e.active && e.hittable && !isStructure(e)
            && !FRIENDLY_FACTIONS.has(e._faction));
    }

    /** 每 tick：友军回血 + 敌方光伤（僵尸类翻倍） */
    _tick(entities) {
        const src = this.source;
        const effect = this._effect;
        if (!src || !src.active || !effect) return;
        const radius = effect.radius;
        const d = this._castContext?.stats || src.data;
        const healAmount = Math.floor(
            ((effect.healBase ?? 0) + (d.wis ?? 0) * (effect.healWisMul ?? 0)) * this._healMul
        );
        const damageAmount = Math.floor(
            ((effect.damageBase ?? 0)
            + (d.matk ?? 0) * (effect.damageMagicMul ?? 0)
            + (d.int ?? 0) * (effect.damageIntMul ?? 0)) * this._damageMul
        );
        const entityList = Array.from(entities && entities.values ? entities.values() : (entities || []));
        let tickHits = 0;
        for (const e of entityList) {
            if (Math.hypot(e.x - src.x, e.y - src.y) > radius) continue;
            if (this._isFriendly(e) || e === src) {
                if (!e.data) continue;
                const maxHp = e.data.maxHp || e.maxHp || 0;
                const before = e.data.hp;
                e.data.hp = Math.min(maxHp > 0 ? maxHp : Infinity, e.data.hp + healAmount);
                if (e.data.hp > before) {
                    this._acc.heals++;
                    if (e === src && window.GameUIManager && typeof window.GameUIManager.updateUI === 'function') {
                        window.GameUIManager.updateUI();
                    }
                }
                continue;
            }
            if (!this._isHostile(e)) continue;
            let dmg = damageAmount;
            if (hasEnemyFamily(e, '僵尸')) {
                dmg = Math.floor(dmg * effect.zombieDamageMul);
            }
            const wasAlive = e.hp > 0;
            e.takeDamage(dmg, src, 'magic', false, this._castContext);
            tickHits++;
            this._acc.hits++;
            if (wasAlive && e.hp <= 0 && !e._summoned) this._acc.kills++;
        }
        if (tickHits >= 2) this._acc.multiHit = true;
    }

    /** 每净化间隔：领域内友军（含自己）各移除 1 个负面状态 */
    _cleanse(entities) {
        const src = this.source;
        const effect = this._effect;
        if (!src || !src.active || !effect) return;
        const radius = effect.radius;
        const entityList = Array.from(entities && entities.values ? entities.values() : (entities || []));
        let cleansedAny = false;
        for (const e of entityList) {
            if (e !== src && !this._isFriendly(e)) continue;
            if (Math.hypot(e.x - src.x, e.y - src.y) > radius) continue;
            if (!Array.isArray(e.statusEffects)) continue;
            const entry = e.statusEffects.find((se) => se && se.remaining > 0 && CLEANSE_TYPES.includes(se.type));
            if (!entry) continue;
            if (typeof e.removeStatusEffect === 'function') e.removeStatusEffect(entry.type);
            if (entry.type === 'electrified') e._electrifiedStacks = 0;
            cleansedAny = true;
            EffectManager.add(new FloatingTextEffect(e.x, e.y - 40, '净化', '#fff3c8'));
        }
        if (cleansedAny && this._fx) this._fx.pulse();
    }

    /** 玩家施法动作包装：播施法动画，第 8 帧触发 onRelease */
    _startPlayerCast(onRelease) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (scene && typeof scene.startPlayerCast === 'function') {
            scene.startPlayerCast({ onRelease });
        } else if (onRelease) {
            onRelease();
        }
    }

    update(dt, entities) {
        const src = this.source;
        if (!src) return;
        if (src._sanctuaryDomainCooldown > 0) {
            src._sanctuaryDomainCooldown -= dt;
            if (src._sanctuaryDomainCooldown < 0) src._sanctuaryDomainCooldown = 0;
        }
        if (!this._active) return;
        this._remaining -= dt;
        this._tickTimer -= dt;
        if (this._tickTimer <= 0) {
            this._tickTimer = this._effect.tickMs;
            this._tick(entities);
        }
        this._cleanseTimer -= dt;
        if (this._cleanseTimer <= 0) {
            this._cleanseTimer = this._effect.cleanseIntervalMs;
            this._cleanse(entities);
        }
        if (this._remaining <= 0) {
            this._endDomain();
        }
    }

    /** 领域自然结束：统一结算经验并回收视觉 */
    _endDomain() {
        if (this._isPlayer() && (this._acc.hits > 0 || this._acc.heals > 0)) {
            SkillManager.addSanctuaryDomainExp(
                this.source, this._acc.hits, this._acc.kills, this._acc.heals, this._acc.multiHit);
        }
        if (this._fx) {
            this._fx.destroy();
            this._fx = null;
        }
        this._active = false;
        if (this.source) this.source._sanctuaryDomainActive = false;
        this._remaining = 0;
        this._tickTimer = 0;
        this._cleanseTimer = 0;
        this._effect = null;
        this._castContext = null;
        this._acc = { hits: 0, kills: 0, heals: 0, multiHit: false };
    }

    /** 死亡/场景切换统一清理（不结算经验，与雷暴领域 clearCloud 同口径） */
    clearDomain() {
        if (this._fx) {
            this._fx.destroy();
            this._fx = null;
        }
        this._active = false;
        if (this.source) this.source._sanctuaryDomainActive = false;
        this._remaining = 0;
        this._tickTimer = 0;
        this._cleanseTimer = 0;
        this._effect = null;
        this._castContext = null;
        this._acc = { hits: 0, kills: 0, heals: 0, multiHit: false };
    }
}
