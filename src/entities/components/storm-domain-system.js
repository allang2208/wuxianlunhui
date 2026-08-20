import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { SceneManager } from '../../world/scene-manager.js';
import { LightningBoltEffect } from '../../effects/lightning-bolt.js';
import { burstParticles, fireGroundShockwave } from '../../effects/combat-fx.js';
import { StormCloudFx } from '../../effects/storm-cloud-fx.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { SkillManager } from '../../ui/skill-manager.js';
import {
    getCurrentWeaponCraftEffects,
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
import { hasRangedLineOfSight } from '../../combat/ranged-line-of-sight.js';

/** 雷暴领域数值默认（配置唯一真相：skills.json effectFormula 必有；缺省兜底统一收敛于此） */
const STORM_DEFAULTS = {
    cooldown: 30,
    mpCost: 80,
    maxRange: 550,
    duration: 10,
    strikeIntervalMs: 900,
    radius: 220,
    strikeDamageBase: 29,
    strikeMagicMul: 0.5,
    strikeIntMul: 0.5,
    chainExtraTargets: 1,
    chainRange: 160,
    chainDecay: 0.3,
    stunMs: 250,
    electrifyStacks: 1,
    electrifyDurationMs: 4000,
};

/**
 * 雷暴领域技能系统（2026-08-05，电系中级：移动雷云跟身炮台）
 *
 * 释放：在施法者头顶凝聚雷云跟随自己，持续期内每 strikeIntervalMs 对雷云
 * 范围内最近的敌方单位落雷：主目标全额伤害 + 向邻近目标传导（每跳衰减），
 * 命中短眩晕打断并叠加感电。命中/击杀按整次施法累计，雷云结束统一结算经验
 * （与暴风雪/灼锋焰甲同口径）。
 */
export class StormDomainSystem {
    constructor(source) {
        this.source = source;
        this._active = false;
        this._remaining = 0;
        this._strikeTimer = 0;
        this._magicDamageMul = 1;
        this._acc = { hits: 0, kills: 0, multiHit: false };
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
        if (!src || (!isSkillCheatEnabled() && src._stormDomainCooldown > 0)) return;
        // 中级魔法门槛：需装备法杖才能释放（测试开关可绕过）
        if (this._isPlayer()) {
            const req = meetsMagicWeaponReq(src, 'stormDomain');
            if (!req.ok) {
                if (SceneManager && typeof SceneManager.showTopNotification === 'function') {
                    SceneManager.showTopNotification(req.reason);
                }
                return;
            }
        }
        const skill = src.skills && src.skills.stormDomain;
        if (!skill) return;
        const baseEffect = skill.getEffect(skill.level);

        // MP 门禁（含链式减免）
        const ce = getCurrentWeaponCraftEffects(src);
        const chainStacks = (src._chainSpellStacks) || 0;
        const mpMul = getMagicMpCostMultiplier(src, ce, chainStacks);
        const mpCost = baseEffect.mpCost ? Math.max(0, Math.floor(baseEffect.mpCost * mpMul)) : 0;
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0 && src.data.mp < mpCost) {
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 30, '魔法不足', '#b98cff'));
            return;
        }
        const chain = consumeChainSpellBonus(src);
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0) src.data.mp -= mpCost;

        const effect = { ...STORM_DEFAULTS, ...baseEffect, mpCost };
        effect.cooldown = effect.cooldown * getMagicCooldownMultiplier(src, ce);
        this._magicDamageMul = getMagicDamageMultiplierWithChain(src, 'stormDomain', ce, chain.stacks);
        if (!isSkillCheatEnabled()) src._stormDomainCooldown = effect.cooldown * 1000;

        const doRelease = () => {
            const castSounds = skillsData.skills?.stormDomain?.sounds?.cast;
            if (castSounds && SoundManager && typeof SoundManager.playFile === 'function') {
                (Array.isArray(castSounds) ? castSounds : [castSounds]).forEach(p => SoundManager.playFile(p));
            }
            this._activateCloud(effect);
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 40, '🌩️ 雷暴领域', '#b98cff'));
            addChainSpellStack(src);
            applyCastHaste(src);
        };
        if (this._isPlayer()) {
            this._startPlayerCast(doRelease);
        } else {
            doRelease();
        }
    }

    _activateCloud(effect) {
        const src = this.source;
        this._active = true;
        src._stormDomainActive = true;
        this._remaining = effect.duration * 1000;
        this._strikeTimer = 0;
        this._acc = { hits: 0, kills: 0, multiHit: false };
        this._effect = effect;
        if (!this._fx) {
            // 云团随等级半径扩大匹配影响范围（radius = 220 + 8×等级）
            this._fx = new StormCloudFx(src, { radius: effect.radius });
            EffectManager.add(this._fx);
        }
    }

    /** 落雷：雷云范围内最近的敌人 + 邻近传导 */
    _strike(entities) {
        const src = this.source;
        if (!src || !src.active) return;
        const effect = this._effect;
        if (!effect) return;
        const radius = effect.radius;
        const d = src.data;
        const damageMul = this._magicDamageMul || 1;
        const baseDamage = Math.floor(
            effect.strikeDamageBase
            + (d.matk ?? 0) * effect.strikeMagicMul
            + (d.int ?? 0) * effect.strikeIntMul
        );
        const chainExtra = Math.max(0, effect.chainExtraTargets);
        const chainRange = effect.chainRange;
        const chainDecay = effect.chainDecay;
        const stunMs = effect.stunMs;
        const entityList = Array.from(entities.values ? entities.values() : entities);

        // 主目标：雷云（=施法者）范围内最近敌人
        let main = null;
        let mainDist = Infinity;
        for (const e of entityList) {
            if (!e || e === src || !e.active || !e.hittable) continue;
            if (e._faction === src._faction) continue;
            const dist = Math.hypot(e.x - src.x, e.y - src.y);
            if (dist > radius || dist >= mainDist) continue;
            if (!hasRangedLineOfSight(src, e)) continue;
            mainDist = dist;
            main = e;
        }
        if (!main) return;

        // 传导链
        const chain = [main];
        let cursor = main;
        for (let hop = 0; hop < chainExtra; hop++) {
            const next = this._nearestHostileTo(cursor, chainRange, chain, entityList);
            if (!next) break;
            chain.push(next);
            cursor = next;
        }

        const cloudPos = this._cloudPoint();
        const cloudSource = { x: cloudPos.x, y: cloudPos.y + 30, bodyHeight: 60, active: true };
        let strikeHits = 0;
        chain.forEach((target, i) => {
            const decayMul = Math.pow(1 - chainDecay, i);
            const finalDamage = Math.floor(baseDamage * decayMul * damageMul);
            const boltSource = i === 0 ? cloudSource : chain[i - 1];
            const wasAlive = target.hp > 0;
            EffectManager.add(new LightningBoltEffect(boltSource, target, {
                durationMs: 420,
                fadeMs: 220,
                segments: 9,
                jitter: 0.10,
            }));
            this._spawnHitFx(target, decayMul);
            target.takeDamage(finalDamage, src, 'electric');
            if (typeof target.applyElectrified === 'function') {
                target.applyElectrified(effect.electrifyStacks, effect.electrifyDurationMs, src);
            }
            if (stunMs > 0 && typeof target.applyStun === 'function') {
                target.applyStun(stunMs);
            }
            strikeHits++;
            this._acc.hits++;
            if (wasAlive && target.hp <= 0 && !target._summoned) this._acc.kills++;
        });
        if (strikeHits >= 2) this._acc.multiHit = true;
    }

    _nearestHostileTo(origin, range, exclude, entityList) {
        if (!origin?.active) return null;
        let best = null;
        let bestDist = Infinity;
        for (const e of entityList) {
            if (!e || e === this.source || !e.active || !e.hittable) continue;
            if (e._faction === this.source._faction) continue;
            if (exclude && exclude.includes(e)) continue;
            const dist = Math.hypot(e.x - origin.x, e.y - origin.y);
            if (dist > range || dist >= bestDist) continue;
            if (!hasRangedLineOfSight(origin, e)) continue;
            bestDist = dist;
            best = e;
        }
        return best;
    }

    _cloudPoint() {
        const src = this.source;
        return {
            x: src.x,
            y: src.y - ((src.bodyHeight || 120) * 0.5) - 150,
        };
    }

    _spawnHitFx(target, decayMul) {
        const hitX = target.x;
        const hitY = target.y - ((target.bodyHeight || 120) * 0.5);
        const hitDepth = (target._phaserSprite ? target._phaserSprite.depth : target.y + 10) + 2;
        const scale = 0.75 + 0.25 * (decayMul || 1);
        fireGroundShockwave({
            x: hitX,
            y: hitY,
            maxRadius: 76 * scale,
            strokeColor: 0xa98fff,
            fillColor: 0x6a4bff,
            lineWidth: 6,
            duration: 380,
            flicker: true,
            strokeAlpha: 1.0,
            fillAlpha: 0.14,
        });
        burstParticles({
            texture: 'impact_dot',
            x: hitX,
            y: hitY,
            count: Math.round(16 * scale),
            jitter: 40,
            config: {
                speed: { min: 100, max: 480 },
                scale: { start: 3.2, end: 0.4 },
                alpha: { start: 1.0, end: 0 },
                lifespan: { min: 320, max: 600 },
                tint: [0xffffff, 0xf0e9ff, 0xddd2ff, 0x8f7bff],
                blendMode: 'ADD',
            },
            destroyAfterMs: 700,
            depth: hitDepth,
        });
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
        if (src._stormDomainCooldown > 0) {
            src._stormDomainCooldown -= dt;
            if (src._stormDomainCooldown < 0) src._stormDomainCooldown = 0;
        }
        if (!this._active) return;
        this._remaining -= dt;
        this._strikeTimer -= dt;
        if (this._strikeTimer <= 0) {
            this._strikeTimer = this._effect.strikeIntervalMs;
            this._strike(entities);
        }
        if (this._remaining <= 0) {
            this._endCloud();
        }
    }

    /** 雷云自然结束：统一结算经验并回收视觉 */
    _endCloud() {
        if (this._isPlayer() && this._acc.hits > 0) {
            SkillManager.addStormDomainExp(this.source, this._acc.hits, this._acc.kills, this._acc.multiHit);
        }
        if (this._fx) {
            this._fx.destroy();
            this._fx = null;
        }
        this._active = false;
        if (this.source) this.source._stormDomainActive = false;
        this._remaining = 0;
        this._strikeTimer = 0;
        this._effect = null;
        this._acc = { hits: 0, kills: 0, multiHit: false };
    }

    /** 死亡/场景切换统一清理（不结算经验，与暴风雪 clearZones 同口径） */
    clearCloud() {
        if (this._fx) {
            this._fx.destroy();
            this._fx = null;
        }
        this._active = false;
        if (this.source) this.source._stormDomainActive = false;
        this._remaining = 0;
        this._strikeTimer = 0;
        this._effect = null;
        this._acc = { hits: 0, kills: 0, multiHit: false };
    }
}
