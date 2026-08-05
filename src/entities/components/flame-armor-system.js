import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { GroundCircle } from '../../physics/skill-shapes.js';
import { burstParticles } from '../../effects/combat-fx.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { SkillManager } from '../../ui/skill-manager.js';
import { StatusBar } from '../../ui/status-bar.js';
import { FlameArmorFx } from '../../effects/flame-armor-fx.js';
import {
    getCurrentWeaponCraftEffects,
    getMagicMpCostMultiplier,
    getMagicCooldownMultiplier,
    getMagicDamageMultiplier,
} from '../../utils/magic-craft-helper.js';
import skillsData from '../../../data/skills.json';
import { isSkillCheatEnabled } from '../../config/dev-cheats.js';

/** 灼锋焰甲数值默认（配置唯一真相：skills.json effectFormula 必有；缺省兜底统一收敛于此） */
const FLAME_ARMOR_DEFAULTS = {
    cooldown: 24,
    mpCost: 40,
    duration: 12,
    hitDamageBase: 10,
    hitMagicMul: 0.35,
    hitIntMul: 0.35,
    auraRadius: 130,
    auraTickMs: 500,
    auraDamageBase: 5,
    auraMagicMul: 0.12,
    auraIntMul: 0.12,
};

/**
 * 灼锋焰甲技能系统（2026-08-03，火系初级 Buff 型技能首航）
 *
 * 释放：为施法者添加「灼锋焰甲」状态效果（Buff）：
 *  1) 命中附伤：除魔法技能外的任何攻击命中（DamagePipeline.applyHit 挂钩）附带魔法伤害 + 火花粒子；
 *  2) 灼烧光环：每 0.5s 对周围敌方单位造成魔法伤害（同样迸发火花）；
 *  3) 武器火焰 + 脚底火焰环：Buff 期间武器尖端上浮火焰粒子，脚底 footprint 外沿火焰环旋转
 *     （FlameArmorFx）。
 * 命中/击杀按整次 Buff 累计，Buff 结束统一结算经验（与暴风雪/陨星同口径）。
 * 冷却/耗蓝走魔法改造口径（MP 减免/冷却缩减），不消耗链式层数（护体 Buff 无即时伤害结算）。
 */
export class FlameArmorSystem {
    constructor(source) {
        this.source = source;
        this._acc = { hits: 0, kills: 0, multiHit: false };
        this._auraTimer = 0;
        this._weaponFx = null;
        this._statusBarEffectId = null;
    }

    isActive() {
        return !!(this.source && typeof this.source.hasStatusEffect === 'function'
            && this.source.hasStatusEffect('flameArmor'));
    }

    _getEffect() {
        const skill = this.source.skills && this.source.skills.flameArmor;
        return skill ? skill.getEffect(skill.level) : {};
    }

    trigger() {
        const src = this.source;
        if (!src || (!isSkillCheatEnabled() && src._flameArmorCooldown > 0)) return;
        const skill = src.skills && src.skills.flameArmor;
        if (!skill) return;
        const baseEffect = skill.getEffect(skill.level);

        // MP 门禁（含改造减免）
        const ce = getCurrentWeaponCraftEffects(src);
        const mpMul = getMagicMpCostMultiplier(src, ce, (src._chainSpellStacks) || 0);
        const mpCost = baseEffect.mpCost ? Math.max(0, Math.floor(baseEffect.mpCost * mpMul)) : 0;
        if (!isSkillCheatEnabled() && mpCost > 0 && src.data.mp < mpCost) {
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 30, '魔法不足', '#ff6b35'));
            return;
        }
        if (!isSkillCheatEnabled()) src.data.mp -= mpCost;

        const effect = { ...FLAME_ARMOR_DEFAULTS, ...baseEffect, mpCost };
        effect.cooldown = effect.cooldown * getMagicCooldownMultiplier(src, ce);
        if (!isSkillCheatEnabled()) src._flameArmorCooldown = effect.cooldown * 1000;

        // 施加 Buff（同类型只刷新时长；statusImmune 期间 addStatusEffect 会自动拒绝）
        src.addStatusEffect('flameArmor', effect.duration * 1000, { name: '灼锋焰甲', icon: '🔥', color: '#ff7a3a' });
        this._acc = { hits: 0, kills: 0, multiHit: false };
        this._auraTimer = 0;
        this._ensureWeaponFx();
        if (src._faction === 'player' && StatusBar && typeof StatusBar.addEffect === 'function') {
            this._statusBarEffectId = StatusBar.addEffect('flameArmor', effect.duration * 1000,
                { name: '灼锋焰甲', icon: '🔥', color: '#ff7a3a' });
        }
        EffectManager.add(new FloatingTextEffect(src.x, src.y - 40, '🔥 灼锋焰甲', '#ff8f7a'));
        const castSounds = skillsData.skills?.flameArmor?.sounds?.cast;
        if (castSounds && SoundManager && typeof SoundManager.playFile === 'function') {
            (Array.isArray(castSounds) ? castSounds : [castSounds]).forEach(p => SoundManager.playFile(p));
        }
    }

    _ensureWeaponFx() {
        if (this._weaponFx) return;
        this._weaponFx = new FlameArmorFx(this.source);
        EffectManager.add(this._weaponFx);
    }

    /** DamagePipeline 挂钩：非魔法攻击命中附带魔法伤害 + 火花 */
    onPhysicalHit(target) {
        const src = this.source;
        if (!target || !target.active || !target.hittable) return;
        if (target === src || target._faction === src._faction) return;
        const effect = this._getEffect();
        const d = src.data;
        const mul = getMagicDamageMultiplier(src, 'flameArmor', getCurrentWeaponCraftEffects(src));
        const damage = Math.floor(((effect.hitDamageBase ?? 0)
            + (d.matk ?? 0) * (effect.hitMagicMul ?? 0)
            + (d.int ?? 0) * (effect.hitIntMul ?? 0)) * (mul || 1));
        if (damage <= 0) return;
        const wasAlive = target.hp > 0;
        target.takeDamage(damage, src, 'magic');
        this._spawnSparks(target.x, target.y);
        this._acc.hits++;
        if (wasAlive && target.hp <= 0 && !target._summoned) this._acc.kills++;
    }

    /** 灼烧光环每跳 */
    _tickAura(entities, effect) {
        const src = this.source;
        const radius = effect.auraRadius;
        const shape = new GroundCircle(src.x, src.y, radius);
        const d = src.data;
        const mul = getMagicDamageMultiplier(src, 'flameArmor', getCurrentWeaponCraftEffects(src));
        const damage = Math.floor(((effect.auraDamageBase ?? 0)
            + (d.matk ?? 0) * (effect.auraMagicMul ?? 0)
            + (d.int ?? 0) * (effect.auraIntMul ?? 0)) * (mul || 1));
        const entityList = Array.from(entities.values ? entities.values() : entities);
        let tickHits = 0;
        for (const e of entityList) {
            if (!e || e === src || !e.active || !e.hittable) continue;
            if (e._faction === src._faction) continue;
            if (!shape.intersectsEntity(e)) continue;
            const wasAlive = e.hp > 0;
            e.takeDamage(damage, src, 'magic');
            this._spawnSparks(e.x, e.y);
            tickHits++;
            this._acc.hits++;
            if (wasAlive && e.hp <= 0 && !e._summoned) this._acc.kills++;
        }
        if (tickHits >= 2) this._acc.multiHit = true;
    }

    /** 命中/光环共用的四散红色火花粒子（模仿金属火花迸溅） */
    _spawnSparks(x, y) {
        burstParticles({
            texture: 'impact_dot',
            x, y,
            count: 9,
            jitter: 14,
            config: {
                speed: { min: 60, max: 230 },
                angle: { min: 0, max: 360 },
                gravityY: 280,
                scale: { start: 1.4, end: 0.1 },
                alpha: { start: 0.95, end: 0 },
                lifespan: { min: 220, max: 460 },
                tint: [0xff3300, 0xff6600, 0xffcc00, 0xffaa33],
                blendMode: 'ADD',
            },
            destroyAfterMs: 560,
            depth: y + 12,
        });
    }

    update(dt, entities) {
        const src = this.source;
        if (!src) return;
        if (src._flameArmorCooldown > 0) {
            src._flameArmorCooldown -= dt;
            if (src._flameArmorCooldown < 0) src._flameArmorCooldown = 0;
        }
        if (!this.isActive()) return;
        const effect = this._getEffect();
        this._auraTimer += dt;
        if (this._auraTimer >= effect.auraTickMs) {
            this._auraTimer = 0;
            this._tickAura(entities, effect);
        }
    }

    /** Buff 到期（updateStatusEffects 钩子 _onFlameArmorEnd 调用）：结算经验并回收武器火焰 */
    onBuffEnd() {
        if (this._weaponFx) {
            this._weaponFx.destroy();
            this._weaponFx = null;
        }
        if (this._statusBarEffectId && StatusBar && typeof StatusBar.removeEffect === 'function') {
            StatusBar.removeEffect(this._statusBarEffectId);
            this._statusBarEffectId = null;
        }
        if (this.source && this.source._faction === 'player' && this._acc.hits > 0) {
            SkillManager.addFlameArmorExp(this.source, this._acc.hits, this._acc.kills, this._acc.multiHit);
        }
        this._acc = { hits: 0, kills: 0, multiHit: false };
        this._auraTimer = 0;
    }

    /** 死亡/场景切换统一清理（不结算经验，与暴风雪 clearZones 同口径） */
    clearBuff() {
        if (this._weaponFx) {
            this._weaponFx.destroy();
            this._weaponFx = null;
        }
        if (this._statusBarEffectId && StatusBar && typeof StatusBar.removeEffect === 'function') {
            StatusBar.removeEffect(this._statusBarEffectId);
            this._statusBarEffectId = null;
        }
        if (this.source && typeof this.source.removeStatusEffect === 'function') {
            this.source.removeStatusEffect('flameArmor');
        }
        this._acc = { hits: 0, kills: 0, multiHit: false };
        this._auraTimer = 0;
    }
}
