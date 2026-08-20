import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { SceneManager } from '../../world/scene-manager.js';
import { GroundCircle, GroundEllipse } from '../../physics/skill-shapes.js';
import { entitySurfaceZ, surfaceEffectAtPoint, surfaceEffectFromEntity } from '../../physics/elevation.js';
import { MeteorStrike } from '../../effects/meteor-strike.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { SkillManager } from '../../ui/skill-manager.js';
import {
    getCurrentWeaponCraftEffects,
    getMagicRangeMultiplier,
    getMagicMpCostMultiplier,
    getMagicCooldownMultiplier,
    getMagicDamageMultiplierWithChain,
    consumeChainSpellBonus,
    addChainSpellStack,
    applyCastHaste,
} from '../../utils/magic-craft-helper.js';
import skillsData from '../../../data/skills.json';
import { isSkillCheatEnabled } from '../../config/dev-cheats.js';
import { meetsMagicWeaponReq } from '../../config/magic-categories.js';

/** 陨星坠落数值默认（配置唯一真相：skills.json effectFormula 必有；缺省兜底统一收敛于此） */
const METEOR_DEFAULTS = {
    cooldown: 32,
    mpCost: 100,
    maxRange: 650,
    explosionRadius: 150,
    lavaRadius: 130,
    lavaDuration: 3,
    lavaTickMs: 500,
    fallMs: 650,
    shakeIntensity: 0,
    burnDurationMs: 3500,
    burnDamageMul: 0.5,
    lavaBurnDurationMs: 2500,
    lavaBurnDamageMul: 0.3,
};

/**
 * 陨星坠落技能系统（2026-08-03，火系高级魔法）
 *
 * 释放：鼠标指向处落点 → 预警 → 陨星砸落（大范围爆炸+击退+叠灼伤）→ 熔岩余火
 * （地面区域周期灼烧+叠灼伤）。伤害按"爆炸命中 + 熔岩每跳"累计，区域结束后统一结算经验
 * （与暴风雪 _end 同口径）。冷却/耗蓝/链式强化/施法动画/法杖门槛与圣光/暴风雪同套门禁。
 */
export class MeteorSystem {
    constructor(source) {
        this.source = source;
        this._strikes = [];
        this._magicDamageMul = 1;
    }

    _isPlayer() {
        return this.source && this.source._faction === 'player';
    }

    trigger() {
        const src = this.source;
        if (!src || (!isSkillCheatEnabled() && src._meteorCooldown > 0)) return;
        // 高级魔法门槛：需装备法杖才能释放（测试开关可绕过）
        if (this._isPlayer()) {
            const req = meetsMagicWeaponReq(src, 'meteor');
            if (!req.ok) {
                if (SceneManager && typeof SceneManager.showTopNotification === 'function') {
                    SceneManager.showTopNotification(req.reason);
                }
                return;
            }
        }
        const skill = src.skills && src.skills.meteor;
        if (!skill) return;
        const baseEffect = skill.getEffect(skill.level);
        // 配置唯一真相：默认值集中收敛于 METEOR_DEFAULTS，代码不再散落魔法数字
        const effect = { ...METEOR_DEFAULTS, ...baseEffect };

        // 瞄准点：玩家=鼠标世界坐标
        let aimX = src.x;
        let aimY = src.y;
        let surfaceContext = surfaceEffectFromEntity(src);
        if (this._isPlayer()) {
            const aim = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
            surfaceContext = surfaceEffectAtPoint(aim.x, aim.y);
            aimX = surfaceContext.x;
            aimY = surfaceContext.y;
        }

        // 施法距离门禁（失败不耗蓝/冷却/链式层数）
        const ce = getCurrentWeaponCraftEffects(src);
        const rangeMul = getMagicRangeMultiplier(src, ce);
        const maxRange = effect.maxRange * rangeMul;
        if (Math.hypot(aimX - src.x, aimY - src.y) > maxRange) {
            if (SceneManager && typeof SceneManager.showTopNotification === 'function') {
                SceneManager.showTopNotification('☄ 超出施法距离！');
            }
            return;
        }

        // MP 门禁（含链式减免）
        const chainStacks = (src._chainSpellStacks) || 0;
        const mpMul = getMagicMpCostMultiplier(src, ce, chainStacks);
        const mpCost = effect.mpCost ? Math.max(0, Math.floor(effect.mpCost * mpMul)) : 0;
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0 && src.data.mp < mpCost) {
            EffectManager.add(new FloatingTextEffect(src.x, src.y - entitySurfaceZ(src) - 30, '魔法不足', '#ff6b35'));
            return;
        }
        const chain = consumeChainSpellBonus(src);
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0) src.data.mp -= mpCost;
        effect.mpCost = mpCost;
        effect.cooldown = effect.cooldown * getMagicCooldownMultiplier(src, ce);
        this._magicDamageMul = getMagicDamageMultiplierWithChain(src, 'meteor', ce, chain.stacks);

        if (!isSkillCheatEnabled()) src._meteorCooldown = effect.cooldown * 1000;

        const doRelease = () => {
            const castSounds = skillsData.skills?.meteor?.sounds?.cast;
            if (castSounds && SoundManager && typeof SoundManager.playFile === 'function') {
                (Array.isArray(castSounds) ? castSounds : [castSounds]).forEach(p => SoundManager.playFile(p));
            }
            this._spawnStrike(aimX, aimY, effect, surfaceContext);
            EffectManager.add(new FloatingTextEffect(src.x, src.y - entitySurfaceZ(src) - 40, '☄ 陨星坠落', '#ff8f7a'));
            addChainSpellStack(src);
            applyCastHaste(src);
        };
        if (this._isPlayer()) {
            this._startPlayerCast(doRelease);
        } else {
            doRelease();
        }
    }

    _spawnStrike(x, y, effect, surfaceContext = null) {
        const src = this.source;
        const acc = { hits: 0, kills: 0, multiHit: false };
        const d = src.data;
        surfaceContext ||= surfaceEffectFromEntity(src);

        // 爆炸命中结算：范围伤害（中心全额→边缘 50% 距离衰减）+ 击退 + 叠灼伤
        const onImpact = (ix, iy, entities) => {
            const shape = new GroundCircle(ix, iy, effect.explosionRadius, surfaceContext);
            const baseDamage = Math.floor(
                (effect.damageBase ?? 0)
                + (d.matk ?? 0) * (effect.magicMul ?? 0)
                + (d.int ?? 0) * (effect.intMul ?? 0)
            );
            const damage = Math.floor(baseDamage * (this._magicDamageMul || 1));
            const entityList = Array.from(entities.values ? entities.values() : entities);
            let hits = 0;
            for (const e of entityList) {
                if (!e || e === src || !e.active || !e.hittable) continue;
                if (e._faction === src._faction) continue;
                if (!shape.intersectsEntity(e)) continue;
                const wasAlive = e.hp > 0;
                const dist = Math.sqrt((e.x - ix) ** 2 + (e.y - iy) ** 2);
                const distRatio = 1 - Math.min(dist / effect.explosionRadius, 1);
                const finalDamage = Math.floor(damage * (0.5 + 0.5 * distRatio));
                e.takeDamage(finalDamage, src, 'magic');
                // 灼伤：爆炸固有 3 层（烈焰吊坠的增伤倍率走 applyBurn damageMul）
                if (effect.burnStacks && typeof e.applyBurn === 'function') {
                    e.applyBurn(src, effect.burnStacks, effect.burnDurationMs, effect.burnDamageMul, 500);
                }
                // 眩晕 2s（替换原击退）
                if (effect.stunMs && typeof e.applyStun === 'function') {
                    e.applyStun(effect.stunMs);
                }
                hits++;
                acc.hits++;
                if (wasAlive && e.hp <= 0 && !e._summoned) acc.kills++;
            }
            if (hits >= 2) acc.multiHit = true;
        };

        // 熔岩区域每跳：灼烧伤害 + 叠灼伤
        const onTick = (zone, entities) => {
            const shape = new GroundEllipse(
                zone.x,
                zone.y,
                effect.lavaRadius,
                effect.lavaRadius * 0.5,
                zone.surfaceContext
            );
            const tickDamage = Math.floor(
                ((effect.lavaDamageBase ?? 0)
                + (d.matk ?? 0) * (effect.lavaMagicMul ?? 0)
                + (d.int ?? 0) * (effect.lavaIntMul ?? 0))
                * (this._magicDamageMul || 1)
            );
            const entityList = Array.from(entities.values ? entities.values() : entities);
            let tickHits = 0;
            for (const e of entityList) {
                if (!e || e === src || !e.active || !e.hittable) continue;
                if (e._faction === src._faction) continue;
                if (!shape.intersectsEntity(e)) continue;
                const wasAlive = e.hp > 0;
                e.takeDamage(tickDamage, src, 'magic');
                if (effect.lavaBurnStacks && typeof e.applyBurn === 'function') {
                    e.applyBurn(src, effect.lavaBurnStacks, effect.lavaBurnDurationMs, effect.lavaBurnDamageMul, 500);
                }
                tickHits++;
                acc.hits++;
                if (wasAlive && e.hp <= 0 && !e._summoned) acc.kills++;
            }
            if (tickHits >= 2) acc.multiHit = true;
        };

        // 全部阶段结束：统一结算经验（与暴风雪同口径）
        const onEnd = () => {
            if (this._isPlayer() && acc.hits > 0) {
                SkillManager.addMeteorExp(src, acc.hits, acc.kills, acc.multiHit);
            }
        };

        const strike = new MeteorStrike({
            x,
            y,
            surfaceContext,
            explosionRadius: effect.explosionRadius,
            lavaRadius: effect.lavaRadius,
            lavaDurationMs: effect.lavaDuration * 1000,
            lavaTickMs: effect.lavaTickMs,
            fallMs: effect.fallMs,
            shakeIntensity: effect.shakeIntensity,
            onImpact,
            onTick,
            onEnd,
        });
        this._strikes.push(strike);
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
        if (this.source._meteorCooldown > 0) {
            this.source._meteorCooldown -= dt;
            if (this.source._meteorCooldown < 0) this.source._meteorCooldown = 0;
        }
        for (let i = this._strikes.length - 1; i >= 0; i--) {
            const strike = this._strikes[i];
            const alive = strike.update(dt, entities);
            if (!alive) {
                this._strikes.splice(i, 1);
            }
        }
    }

    /** 死亡/场景切换统一清理 */
    clearStrikes() {
        for (const s of this._strikes) {
            if (s && typeof s.destroy === 'function') s.destroy();
        }
        this._strikes = [];
    }
}
