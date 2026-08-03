import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { SceneManager } from '../../world/scene-manager.js';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { BlizzardZone } from '../../effects/blizzard-zone.js';
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

/**
 * 暴风雪技能系统（2026-08-03，地面区域形态首航）
 *
 * 释放：在鼠标指向处召唤暴风雪，椭圆形区域持续下雪并对区域内的敌人
 * 造成周期魔法伤害 + 减速（applyChill）。命中/击杀按整次施法累计，
 * 全部区域结束后统一结算经验（与冰锥 _end 同口径）。
 * 冷却/耗蓝/链式强化/施法动画与圣光同套门禁。
 */
export class BlizzardSystem {
    constructor(source) {
        this.source = source;
        this._zones = [];
        this._magicDamageMul = 1;
    }

    _isPlayer() {
        return this.source && this.source._faction === 'player';
    }

    trigger() {
        const src = this.source;
        if (!src || (!isSkillCheatEnabled() && src._blizzardCooldown > 0)) return;
        // 高级魔法门槛：需装备法杖才能释放（测试开关可绕过）
        if (this._isPlayer()) {
            const req = meetsMagicWeaponReq(src, 'blizzard');
            if (!req.ok) {
                if (SceneManager && typeof SceneManager.showTopNotification === 'function') {
                    SceneManager.showTopNotification(req.reason);
                }
                return;
            }
        }
        const skill = src.skills && src.skills.blizzard;
        if (!skill) return;
        const baseEffect = skill.getEffect(skill.level);

        // 瞄准点：玩家=鼠标世界坐标
        let aimX = src.x;
        let aimY = src.y;
        if (this._isPlayer()) {
            const aim = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
            aimX = aim.x;
            aimY = aim.y;
        }

        // 施法距离门禁（失败不耗蓝/冷却/链式层数）
        const ce = getCurrentWeaponCraftEffects(src);
        const rangeMul = getMagicRangeMultiplier(src, ce);
        const maxRange = (baseEffect.maxRange || 600) * rangeMul;
        if (Math.hypot(aimX - src.x, aimY - src.y) > maxRange) {
            if (SceneManager && typeof SceneManager.showTopNotification === 'function') {
                SceneManager.showTopNotification('❄ 超出施法距离！');
            }
            return;
        }

        // MP 门禁（含链式减免）
        const effect = { ...baseEffect };
        const chainStacks = (src._chainSpellStacks) || 0;
        const mpMul = getMagicMpCostMultiplier(src, ce, chainStacks);
        const mpCost = effect.mpCost ? Math.max(0, Math.floor(effect.mpCost * mpMul)) : 0;
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0 && src.data.mp < mpCost) {
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 30, '魔法不足', '#5a8aaa'));
            return;
        }
        const chain = consumeChainSpellBonus(src);
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0) src.data.mp -= mpCost;
        effect.mpCost = mpCost;
        effect.cooldown = (effect.cooldown || 25) * getMagicCooldownMultiplier(src, ce);
        this._magicDamageMul = getMagicDamageMultiplierWithChain(src, 'blizzard', ce, chain.stacks);

        if (!isSkillCheatEnabled()) src._blizzardCooldown = (effect.cooldown || 25) * 1000;

        const doRelease = () => {
            const castSounds = skillsData.skills?.blizzard?.sounds?.cast;
            if (castSounds && SoundManager && typeof SoundManager.playFile === 'function') {
                (Array.isArray(castSounds) ? castSounds : [castSounds]).forEach(p => SoundManager.playFile(p));
            }
            this._spawnZone(aimX, aimY, effect);
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 40, '❄ 暴风雪', '#9fd8ff'));
            addChainSpellStack(src);
            applyCastHaste(src);
        };
        if (this._isPlayer()) {
            this._startPlayerCast(doRelease);
        } else {
            doRelease();
        }
    }

    _spawnZone(x, y, effect) {
        const src = this.source;
        const radiusX = effect.radiusX || 180;
        const radiusY = effect.radiusY || radiusX * 0.6;
        const acc = { hits: 0, kills: 0, multiHit: false };

        const zone = new BlizzardZone({
            x,
            y,
            radiusX,
            radiusY,
            durationMs: (effect.duration || 5) * 1000,
            tickMs: effect.tickMs || 500,
            onTick: (z, entities) => {
                const shape = new GroundEllipse(z.x, z.y, radiusX, radiusY);
                const baseDamage = Math.floor(
                    (effect.damageBase ?? 0)
                    + (src.data.matk ?? 0) * (effect.magicMul ?? 0)
                    + (src.data.int ?? 0) * (effect.intMul ?? 0)
                );
                const damage = Math.floor(baseDamage * (this._magicDamageMul || 1));
                const entityList = Array.from(entities.values ? entities.values() : entities);
                let tickHits = 0;
                for (const e of entityList) {
                    if (!e || e === src || !e.active || !e.hittable) continue;
                    if (e._faction === src._faction) continue;
                    if (!shape.intersectsEntity(e)) continue;
                    const wasAlive = e.hp > 0;
                    e.takeDamage(damage, src, 'magic');
                    if (effect.chillStacks && typeof e.applyChill === 'function') {
                        e.applyChill(effect.chillStacks, effect.chillDurationMs || 2500, effect.chillSlowPercent || 0.35);
                    }
                    tickHits++;
                    acc.hits++;
                    if (wasAlive && e.hp <= 0 && !e._summoned) {
                        acc.kills++;
                    }
                }
                if (tickHits >= 2) acc.multiHit = true;
                const hitSound = skillsData.skills?.blizzard?.sounds?.hit;
                if (tickHits > 0 && hitSound && SoundManager && typeof SoundManager.playFile === 'function') {
                    SoundManager.playFile(hitSound);
                }
            },
        });
        zone.onZoneEnd = () => {
            if (this._isPlayer() && acc.hits > 0) {
                SkillManager.addBlizzardExp(src, acc.hits, acc.kills, acc.multiHit);
            }
        };
        this._zones.push(zone);
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
        if (this.source._blizzardCooldown > 0) {
            this.source._blizzardCooldown -= dt;
            if (this.source._blizzardCooldown < 0) this.source._blizzardCooldown = 0;
        }
        for (let i = this._zones.length - 1; i >= 0; i--) {
            const zone = this._zones[i];
            const alive = zone.update(dt, entities);
            if (!alive) {
                if (typeof zone.onZoneEnd === 'function') zone.onZoneEnd();
                this._zones.splice(i, 1);
            }
        }
    }

    /** 死亡/场景切换统一清理 */
    clearZones() {
        for (const z of this._zones) {
            if (z && typeof z.destroy === 'function') z.destroy();
        }
        this._zones = [];
    }
}
