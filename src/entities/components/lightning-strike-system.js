import { Renderer } from '../../world/renderer.js';
import { WallSystem } from '../../world/wall-system.js';
import { Input } from '../../ui/input.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { SceneManager } from '../../world/scene-manager.js';
import { LightningBoltEffect } from '../../effects/lightning-bolt.js';
import { burstParticles, fireGroundShockwave } from '../../effects/combat-fx.js';
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

/** 闪电锁定数值默认（配置唯一真相：skills.json effectFormula 必有；缺省兜底统一收敛于此） */
const LIGHTNING_STRIKE_DEFAULTS = {
    cooldown: 3,
    mpCost: 30,
    aimRadius: 200,
    maxRange: 600,
    chainRange: 200,
    chainTargets: 1,
    chainDecay: 0.1,
    stunMs: 750,
    duration: 0.5,
    fadeMs: 250,
    segments: 10,
    jitter: 0.09,
    electrifyStacks: 1,
    electrifyDurationMs: 4000,
};

/**
 * 闪电锁定技能系统（2026-08-02，区别于投射物/区域类技能的新形态：锁定+传导）
 *
 * 释放 = 立即锁定"鼠标指向处最近 + 玩家 maxRange 内"的敌方单位：
 * - 主目标全额伤害；随后在目标 chainRange(200px) 内找最近的敌方单位传导，
 *   每 5 级多传导一个目标，每传导一跳伤害 ×(1−chainDecay)；
 * - 每个命中目标被眩晕 stunMs 并叠加感电（applyElectrified，叠满 5 层触发过载）；
 * - 伤害公式：floor( damageBase + matk×magicMul + int×intMul )；
 * - 释放时播放 skills.json sounds.cast 全部音效（1.mp3 + 2.mp3 同时）；
 * - 修炼经验：击中 +hit、击杀 +kill、单次命中 ≥2 目标额外 +multiHit。
 * 范围内无目标 → 释放失败，提示栏提示"范围内无目标"（不消耗冷却）。
 *
 * 冷却/眩晕/击退/传导/伤害全由 skills.json effectFormula 配置驱动。
 */
export class LightningStrikeSystem {
    constructor(source) {
        this.source = source;
    }

    _isPlayer() {
        return this.source && this.source._faction === 'player';
    }

    trigger() {
        const src = this.source;
        if (!src || (!isSkillCheatEnabled() && src._lightningStrikeCooldown > 0)) return;
        const skill = src.skills && src.skills.lightningStrike;
        if (!skill) return;
        const baseEffect = skill.getEffect(skill.level);
        // 配置唯一真相：默认值集中收敛于 LIGHTNING_STRIKE_DEFAULTS，代码不再散落魔法数字
        const effect = { ...LIGHTNING_STRIKE_DEFAULTS, ...baseEffect };

        // 鼠标世界坐标（非玩家施法者回退自身前方）
        let aimX = src.x, aimY = src.y;
        if (this._isPlayer()) {
            const aim = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
            aimX = aim.x;
            aimY = aim.y;
        }

        // ===== 三重判定（2026-08-02 定稿）：失败不消耗冷却/耗蓝/链式强化 =====
        const ce = getCurrentWeaponCraftEffects(src);
        const rangeMul = getMagicRangeMultiplier(src, ce);
        const aimRadius = effect.aimRadius * rangeMul;
        const maxRange = effect.maxRange * rangeMul;
        const entities = (typeof window !== 'undefined' && window.Game && window.Game.entities)
            ? Array.from(window.Game.entities.values()) : [];
        const nearMouse = [];
        for (const e of entities) {
            if (!e || e === src || !e.active || !e.hittable) continue;
            if (e._faction === src._faction) continue;
            const dAim = Math.hypot(e.x - aimX, e.y - aimY);
            if (dAim <= aimRadius) {
                nearMouse.push({ e, dAim, dPlayer: Math.hypot(e.x - src.x, e.y - src.y) });
            }
        }
        if (nearMouse.length === 0) {
            if (SceneManager && typeof SceneManager.showTopNotification === 'function') {
                SceneManager.showTopNotification('⚡ 瞄准位置附近无目标！');
            }
            return;
        }
        nearMouse.sort((a, b) => a.dAim - b.dAim);
        let best = null;
        let anyInRange = false;
        let anyBlocked = false;
        for (const c of nearMouse) {
            if (c.dPlayer > maxRange) continue;
            anyInRange = true;
            if (!this._isLineOfSightClear(src.x, src.y, c.e.x, c.e.y)) {
                anyBlocked = true;
                continue;
            }
            best = c.e;
            break;
        }
        if (!best) {
            const msg = !anyInRange
                ? '⚡ 超出施法距离！'
                : (anyBlocked ? '⚡ 目标被遮挡！' : '⚡ 无法锁定目标！');
            if (SceneManager && typeof SceneManager.showTopNotification === 'function') {
                SceneManager.showTopNotification(msg);
            }
            return;
        }

        // 目标合法后：先按"含链式减免的 MP 成本"做门禁（读层数不消费——失败不丢链式层数）
        const chainStacks = src._chainSpellStacks || 0;
        const mpMul = getMagicMpCostMultiplier(src, ce, chainStacks);
        const mpCost = effect.mpCost ? Math.max(0, Math.floor(effect.mpCost * mpMul)) : 0;
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0 && src.data.mp < mpCost) {
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 30, '魔法不足！', '#b48bff'));
            return;
        }
        // 门禁通过：正式消费链式强化并扣蓝（失败路径不再白丢层数）
        const chain = consumeChainSpellBonus(src);
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0) src.data.mp -= mpCost;
        effect.mpCost = mpCost;
        effect.cooldown = effect.cooldown * getMagicCooldownMultiplier(src, ce);
        effect.chainRange = effect.chainRange * rangeMul;
        if (ce && ce.lightningChainTargetsDelta) {
            effect.chainTargets = effect.chainTargets + ce.lightningChainTargetsDelta;
        }
        effect.chainTargets = Math.max(1, effect.chainTargets);
        const damageMul = getMagicDamageMultiplierWithChain(src, 'lightningStrike', ce, chain.stacks);

        if (!isSkillCheatEnabled()) src._lightningStrikeCooldown = effect.cooldown * 1000;
        // 播放施法动画，第 8 帧触发释放
        const doRelease = () => {
            const castSounds = skillsData.skills?.lightningStrike?.sounds?.cast;
            if (Array.isArray(castSounds) && SoundManager && typeof SoundManager.playFile === 'function') {
                for (const p of castSounds) SoundManager.playFile(p);
            }
            // 传导链
            const chainTargets = Math.max(1, effect.chainTargets);
            const chainRange = effect.chainRange;
            const chainDecay = effect.chainDecay;
            const chain = [best];
            let cursor = best;
            for (let hop = 1; hop < chainTargets; hop++) {
                const next = this._nearestHostileTo(cursor.x, cursor.y, chainRange, chain);
                if (!next) break;
                chain.push(next);
                cursor = next;
            }
            // 逐目标结算
            const stunMs = effect.stunMs;
            const baseDamage = Math.floor(
                (effect.damageBase ?? 0) + (src.data.matk ?? 0) * (effect.magicMul ?? 0) + (src.data.int ?? 0) * (effect.intMul ?? 0)
            );
            const stunExtend = (ce && ce.electricStunExtendMs) || 0;
            let hitCount = 0, killCount = 0;
            chain.forEach((target, i) => {
                const decayMul = Math.pow(1 - chainDecay, i);
                const finalDamage = Math.floor(baseDamage * decayMul * damageMul);
                const wasAlive = target.hp > 0;
                const boltSource = i === 0 ? src : chain[i - 1];
                EffectManager.add(new LightningBoltEffect(boltSource, target, {
                    durationMs: effect.duration * 1000,
                    fadeMs: effect.fadeMs,
                    segments: effect.segments,
                    jitter: effect.jitter,
                }));
                this._spawnImpact(target, decayMul);
                target.takeDamage(finalDamage, src, 'electric');
                // 电系专属：命中叠加感电（叠满 5 层触发过载）
                if (typeof target.applyElectrified === 'function') {
                    target.applyElectrified(effect.electrifyStacks, effect.electrifyDurationMs, src);
                }
                if (wasAlive && target.hp <= 0 && !target._summoned) killCount++;
                hitCount++;
                if (stunExtend > 0 && target.applyStunExtend) {
                    target.applyStunExtend(stunMs, stunExtend);
                } else if (target.applyStun) {
                    target.applyStun(stunMs);
                }
            });
            if (this._isPlayer()) {
                SkillManager.addLightningStrikeExp(src, hitCount, killCount, hitCount >= 2);
            }
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 40, `⚡ 闪电 ×${hitCount}`, '#b48bff'));
            // 松木握柄：施法后添加 1 层链式强化；檀木握柄：施法后给自身加速
            addChainSpellStack(src);
            applyCastHaste(src);
        };
        if (this._isPlayer()) {
            this._startPlayerCast(doRelease);
        } else {
            doRelease();
        }
    }

    /** 玩家施法动作包装：播空手施法动画，第 8 帧触发 onRelease（魔法实际结算） */
    _startPlayerCast(onRelease) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (scene && typeof scene.startPlayerCast === 'function') {
            scene.startPlayerCast({ onRelease });
        } else if (onRelease) {
            onRelease();
        }
    }

    /** 以指定点为中心、range 内最近的敌对单位（排除已命中集合） */
    _nearestHostileTo(x, y, range, exclude) {
        const entities = (typeof window !== 'undefined' && window.Game && window.Game.entities)
            ? Array.from(window.Game.entities.values()) : [];
        let best = null, bestDist = Infinity;
        for (const e of entities) {
            if (!e || e === this.source || !e.active || !e.hittable) continue;
            if (e._faction === this.source._faction) continue;
            if (exclude && exclude.includes(e)) continue;
            const d = Math.hypot(e.x - x, e.y - y);
            if (d > range || d >= bestDist) continue;
            bestDist = d;
            best = e;
        }
        return best;
    }

    /** 视线检测：玩家→目标 线段是否被墙体阻挡（WallSystem.resolve 畅通时原样返回目标点） */
    _isLineOfSightClear(x1, y1, x2, y2, radius = 8) {
        if (!WallSystem || typeof WallSystem.resolve !== 'function') return true; // 无墙系统兜底放行
        const resolved = WallSystem.resolve(x1, y1, x2, y2, radius);
        return Math.abs(resolved.x - x2) <= 1 && Math.abs(resolved.y - y2) <= 1;
    }

    /** 命中点蓝紫爆炸（火球爆炸同款三层：冲击波 + 白热内芯 + 蓝紫外圈） */
    _spawnImpact(target, decayMul) {
        const hitX = target.x;
        const hitY = target.y - ((target.bodyHeight || 120) * 0.5);
        const hitDepth = (target._phaserSprite ? target._phaserSprite.depth : target.y + 10) + 2;
        const scale = 0.75 + 0.25 * (decayMul || 1); // 传导后爆炸略收敛，主目标最炸
        fireGroundShockwave({
            x: hitX, y: hitY, maxRadius: 82 * scale,
            strokeColor: 0xa98fff, fillColor: 0x6a4bff,
            lineWidth: 7, duration: 420, flicker: true,
            strokeAlpha: 1.0, fillAlpha: 0.16,
        });
        burstParticles({
            texture: 'impact_dot',
            x: hitX, y: hitY,
            count: Math.round(18 * scale),
            jitter: 42,
            config: {
                speed: { min: 120, max: 520 },
                scale: { start: 3.6, end: 0.4 },
                alpha: { start: 1.0, end: 0 },
                lifespan: { min: 380, max: 650 },
                tint: [0xffffff, 0xf0e9ff, 0xddd2ff],
                blendMode: 'ADD',
            },
            destroyAfterMs: 700,
            depth: hitDepth,
        });
        burstParticles({
            texture: 'impact_dot',
            x: hitX, y: hitY,
            count: Math.round(26 * scale),
            jitter: 56,
            config: {
                speed: { min: 90, max: 420 },
                scale: { start: 4.4, end: 0.5 },
                alpha: { start: 0.95, end: 0 },
                lifespan: { min: 450, max: 750 },
                tint: [0xcbb4ff, 0x8f7bff, 0x6a4bff, 0x4b2bff],
                blendMode: 'ADD',
            },
            destroyAfterMs: 850,
            depth: hitDepth,
        });
    }

    update(dt) {
        if (this.source._lightningStrikeCooldown > 0) {
            this.source._lightningStrikeCooldown -= dt;
            if (this.source._lightningStrikeCooldown < 0) this.source._lightningStrikeCooldown = 0;
        }
    }
}
