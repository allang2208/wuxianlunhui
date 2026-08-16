import { Renderer } from '../../world/renderer.js';
import { WallSystem } from '../../world/wall-system.js';
import { Input } from '../../ui/input.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { SceneManager } from '../../world/scene-manager.js';
import { HolyLightEffect } from '../../effects/holy-light.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { SkillManager } from '../../ui/skill-manager.js';
import {
    getCurrentWeaponCraftEffects,
    getMagicRangeMultiplier,
    getMagicMpCostMultiplier,
    getMagicCooldownMultiplier,
    getMagicHealMultiplierWithChain,
    consumeChainSpellBonus,
    addChainSpellStack,
    applyCastHaste,
} from '../../utils/magic-craft-helper.js';
import skillsData from '../../../data/skills.json';
import { isSkillCheatEnabled } from '../../config/dev-cheats.js';

/** 圣光数值默认（配置唯一真相：skills.json effectFormula 必有；缺省兜底统一收敛于此） */
const HOLY_LIGHT_DEFAULTS = {
    cooldown: 10,
    mpCost: 30,
    aimRadius: 200,
    maxRange: 600,
    duration: 2,
    fadeMs: 400,
    beamTopWidth: 60,
    beamBottomWidth: 110,
    beamHeight: 1400,
    dissolveRatio: 0.28,
    zombieDamageMul: 2,
};

/** 友方阵营组（与 damageable-entity.isFriendlyFire 同口径）：同组互疗，组外为伤害。
 *  玩家 faction='player'、队友 faction='companion' 必须互认友军，不能按 `_faction===` 直比
 *  （2026-08-17：伊莉丝 AI 给玩家施法被误判成"打敌人"的根因）。 */
const FRIENDLY_FACTIONS = new Set(['player', 'companion']);

/**
 * 圣光技能系统（2026-08-02 新增，锁定类——释放方式与闪电同口径）
 *
 * 三重判定（同闪电）：① 鼠标位置附近 aimRadius 内有目标（敌方=伤害 / 友方=治疗）；
 * ② 施法距离 ≤ maxRange（最近超距自动改选射程内目标）；
 * ③ 视线（玩家→目标 线段不被墙体阻挡）。
 * 成功则在天上召下一束金色圣光照向目标，持续 effect.duration 秒后淡出；
 * 对敌方造成魔法伤害（僵尸类 ×zombieDamageMul）、对友方回复生命（同公式）。
 *
 * 修炼：命中 +hit / 击杀 +kill。冷却/耗蓝/公式全由 skills.json effectFormula 配置驱动。
 */
export class HolyLightSystem {
    constructor(source) {
        this.source = source;
    }

    _isPlayer() {
        return this.source && this.source._faction === 'player';
    }

    trigger() {
        const src = this.source;
        if (!src || (!isSkillCheatEnabled() && src._holyLightCooldown > 0)) return;
        const skill = src.skills && src.skills.holyLight;
        if (!skill) return;
        const baseEffect = skill.getEffect(skill.level);
        // 配置唯一真相：默认值集中收敛于 HOLY_LIGHT_DEFAULTS，代码不再散落魔法数字
        const effect = { ...HOLY_LIGHT_DEFAULTS, ...baseEffect };

        // 鼠标世界坐标
        let aimX = src.x, aimY = src.y;
        if (this._isPlayer()) {
            const aim = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
            aimX = aim.x;
            aimY = aim.y;
        }

        // ===== 三重判定：失败不消耗冷却/耗蓝/链式强化 =====
        const ce = getCurrentWeaponCraftEffects(src);
        const rangeMul = getMagicRangeMultiplier(src, ce);
        const aimRadius = effect.aimRadius * rangeMul;
        const maxRange = effect.maxRange * rangeMul;
        const entities = (typeof window !== 'undefined' && window.Game && window.Game.entities)
            ? Array.from(window.Game.entities.values()) : [];
        const nearMouse = [];
        for (const e of entities) {
            if (!e || !e.active || !e.hittable) continue;
            const dAim = Math.hypot(e.x - aimX, e.y - aimY);
            if (dAim <= aimRadius) {
                nearMouse.push({ e, dAim, dPlayer: Math.hypot(e.x - src.x, e.y - src.y) });
            }
        }
        if (nearMouse.length === 0) {
            if (SceneManager && typeof SceneManager.showTopNotification === 'function') {
                SceneManager.showTopNotification('✨ 瞄准位置附近无目标！');
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
                ? '✨ 超出施法距离！'
                : (anyBlocked ? '✨ 目标被遮挡！' : '✨ 无法锁定目标！');
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
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 30, '魔法不足！', '#ffd27a'));
            return;
        }
        // 门禁通过：正式消费链式强化并扣蓝（失败路径不再白丢层数）
        const chain = consumeChainSpellBonus(src);
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0) src.data.mp -= mpCost;
        effect.mpCost = mpCost;
        effect.cooldown = effect.cooldown * getMagicCooldownMultiplier(src, ce);
        const healMul = getMagicHealMultiplierWithChain(src, 'holyLight', ce, chain.stacks);

        if (!isSkillCheatEnabled()) src._holyLightCooldown = effect.cooldown * 1000;
        // 播放施法动画，第 8 帧触发释放
        const doRelease = () => {
            const castSounds = skillsData.skills?.holyLight?.sounds?.cast;
            if (Array.isArray(castSounds) && SoundManager && typeof SoundManager.playFile === 'function') {
                for (const p of castSounds) SoundManager.playFile(p);
            }
            // 结算：友方回复生命 / 敌方造成伤害（僵尸类翻倍）
            const amount = Math.floor(
                ((effect.healBase ?? 0)
                + (src.data.matk ?? 0) * (effect.magicMul ?? 0)
                + (src.data.int ?? 0) * (effect.intMul ?? 0)
                + (src.data.wis ?? 0) * (effect.wisMul ?? 0)) * healMul
            );
            const isFriendly = !!best && FRIENDLY_FACTIONS.has(src._faction) && FRIENDLY_FACTIONS.has(best._faction);
            let killCount = 0;
            if (isFriendly) {
                if (best.data) {
                    const maxHp = best.data.maxHp || best.maxHp || 0;
                    best.data.hp = Math.min(maxHp > 0 ? maxHp : Infinity, best.data.hp + amount);
                }
                EffectManager.add(new FloatingTextEffect(best.x, best.y - 30, `+${amount}`, '#7aff9a'));
                // 翠灵水晶：治疗后给目标添加圣光续疗
                if (ce && ce.holyLightHoTStacks && typeof best.applyHolyRenewal === 'function') {
                    best.applyHolyRenewal(ce.holyLightHoTStacks, (ce.holyLightHoTSeconds || 3) * 1000, 0.01);
                }
                // 净厄藤坠：对友方治疗时给目标加速
                if (ce && ce.lightHasteStacks && typeof best.applyHaste === 'function') {
                    for (let i = 0; i < ce.lightHasteStacks; i++) {
                        best.applyHaste(ce.lightHasteDuration || 5000);
                    }
                }
                if (best === src && window.GameUIManager && typeof window.GameUIManager.updateUI === 'function') {
                    window.GameUIManager.updateUI();
                }
            } else {
                let dmg = amount;
                if (best.config && best.config.family === '僵尸') {
                    dmg = Math.floor(dmg * effect.zombieDamageMul);
                }
                const wasAlive = best.hp > 0;
                best.takeDamage(dmg, src, 'magic');
                if (wasAlive && best.hp <= 0 && !best._summoned) killCount++;
            }
            if (this._isPlayer()) {
                SkillManager.addHolyLightExp(src, 1, killCount);
            }
            EffectManager.add(new HolyLightEffect(src, best, {
                durationMs: effect.duration * 1000,
                fadeMs: effect.fadeMs,
                beamTopWidth: effect.beamTopWidth,
                beamBottomWidth: effect.beamBottomWidth,
                beamHeight: effect.beamHeight,
                dissolveRatio: effect.dissolveRatio,
            }));
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 40, '✨ 圣光', '#ffd27a'));
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

    /** Alt+快捷键 直接对自己释放（跳过瞄准/距离/视线三重判定，目标=自身） */
    triggerSelf() {
        const src = this.source;
        if (!src || (!isSkillCheatEnabled() && src._holyLightCooldown > 0)) return;
        const skill = src.skills && src.skills.holyLight;
        if (!skill) return;
        const baseEffect = skill.getEffect(skill.level);
        const effect = { ...HOLY_LIGHT_DEFAULTS, ...baseEffect };

        // 先按"含链式减免的 MP 成本"做门禁（读层数不消费——失败不丢链式层数）
        const ce = getCurrentWeaponCraftEffects(src);
        const chainStacks = src._chainSpellStacks || 0;
        const mpMul = getMagicMpCostMultiplier(src, ce, chainStacks);
        const mpCost = effect.mpCost ? Math.max(0, Math.floor(effect.mpCost * mpMul)) : 0;
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0 && src.data.mp < mpCost) {
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 30, '魔法不足！', '#ffd27a'));
            return;
        }
        // 门禁通过：正式消费链式强化并扣蓝（失败路径不再白丢层数）
        const chain = consumeChainSpellBonus(src);
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0) src.data.mp -= mpCost;
        effect.mpCost = mpCost;
        effect.cooldown = effect.cooldown * getMagicCooldownMultiplier(src, ce);
        const healMul = getMagicHealMultiplierWithChain(src, 'holyLight', ce, chain.stacks);

        if (!isSkillCheatEnabled()) src._holyLightCooldown = effect.cooldown * 1000;
        // 播放施法动画，第 8 帧触发释放
        const doRelease = () => {
            const castSounds = skillsData.skills?.holyLight?.sounds?.cast;
            if (Array.isArray(castSounds) && SoundManager && typeof SoundManager.playFile === 'function') {
                for (const p of castSounds) SoundManager.playFile(p);
            }
            // 自愈
            const amount = Math.floor(
                ((effect.healBase ?? 0)
                + (src.data.matk ?? 0) * (effect.magicMul ?? 0)
                + (src.data.int ?? 0) * (effect.intMul ?? 0)
                + (src.data.wis ?? 0) * (effect.wisMul ?? 0)) * healMul
            );
            const maxHp = src.data.maxHp || 0;
            src.data.hp = Math.min(maxHp > 0 ? maxHp : Infinity, src.data.hp + amount);
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 30, `+${amount}`, '#7aff9a'));
            // 翠灵水晶：自愈也添加续疗
            if (ce && ce.holyLightHoTStacks && typeof src.applyHolyRenewal === 'function') {
                src.applyHolyRenewal(ce.holyLightHoTStacks, (ce.holyLightHoTSeconds || 3) * 1000, 0.01);
            }
            // 净厄藤坠：自愈也添加加速
            if (ce && ce.lightHasteStacks && typeof src.applyHaste === 'function') {
                for (let i = 0; i < ce.lightHasteStacks; i++) {
                    src.applyHaste(ce.lightHasteDuration || 5000);
                }
            }
            if (window.GameUIManager && typeof window.GameUIManager.updateUI === 'function') {
                window.GameUIManager.updateUI();
            }
            if (this._isPlayer()) {
                SkillManager.addHolyLightExp(src, 1, 0);
            }
            EffectManager.add(new HolyLightEffect(src, src, {
                durationMs: effect.duration * 1000,
                fadeMs: effect.fadeMs,
                beamTopWidth: effect.beamTopWidth,
                beamBottomWidth: effect.beamBottomWidth,
                beamHeight: effect.beamHeight,
                dissolveRatio: effect.dissolveRatio,
            }));
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 40, '✨ 圣光', '#ffd27a'));
            // 松木握柄：施法后添加 1 层链式强化；檀木握柄：施法后给自身加速
            addChainSpellStack(src);
            applyCastHaste(src);
        };
        this._startPlayerCast(doRelease);
    }

    /**
     * 对指定目标直接施放圣光（AI/队友入口，2026-08-17）：
     * 跳过鼠标瞄准/距离/视线三重判定（目标由调用方选定），
     * 冷却/技能/链式/耗蓝与结算口径与 trigger 完全一致；
     * 目标为友方=治疗、敌方=伤害（僵尸 ×zombieDamageMul）。
     * @param {object} target 施法目标实体
     * @returns {boolean} 是否成功施放
     */
    triggerOn(target) {
        const src = this.source;
        if (!src || !target || !target.active) return false;
        if (!isSkillCheatEnabled() && src._holyLightCooldown > 0) return false;
        const skill = src.skills && src.skills.holyLight;
        if (!skill) return false;
        const baseEffect = skill.getEffect(skill.level);
        const effect = { ...HOLY_LIGHT_DEFAULTS, ...baseEffect };

        const ce = getCurrentWeaponCraftEffects(src);
        const chainStacks = src._chainSpellStacks || 0;
        const mpMul = getMagicMpCostMultiplier(src, ce, chainStacks);
        const mpCost = effect.mpCost ? Math.max(0, Math.floor(effect.mpCost * mpMul)) : 0;
        // 玩家源扣蓝（与 trigger 同口径）；队友施法由 AI 决策负责，不扣蓝
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0 && src.data.mp < mpCost) return false;
        const chain = consumeChainSpellBonus(src);
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0) src.data.mp -= mpCost;
        effect.mpCost = mpCost;
        effect.cooldown = effect.cooldown * getMagicCooldownMultiplier(src, ce);
        const healMul = getMagicHealMultiplierWithChain(src, 'holyLight', ce, chain.stacks);
        if (!isSkillCheatEnabled()) src._holyLightCooldown = effect.cooldown * 1000;

        const doRelease = () => {
            const castSounds = skillsData.skills?.holyLight?.sounds?.cast;
            if (Array.isArray(castSounds) && SoundManager && typeof SoundManager.playFile === 'function') {
                for (const p of castSounds) SoundManager.playFile(p);
            }
            const amount = Math.floor(
                ((effect.healBase ?? 0)
                + (src.data.matk ?? 0) * (effect.magicMul ?? 0)
                + (src.data.int ?? 0) * (effect.intMul ?? 0)
                + (src.data.wis ?? 0) * (effect.wisMul ?? 0)) * healMul
            );
            const best = target;
            const isFriendly = !!best && FRIENDLY_FACTIONS.has(src._faction) && FRIENDLY_FACTIONS.has(best._faction);
            let killCount = 0;
            if (isFriendly) {
                if (best.data) {
                    const maxHp = best.data.maxHp || best.maxHp || 0;
                    best.data.hp = Math.min(maxHp > 0 ? maxHp : Infinity, best.data.hp + amount);
                }
                EffectManager.add(new FloatingTextEffect(best.x, best.y - 30, `+${amount}`, '#7aff9a'));
                // 翠灵水晶：治疗后给目标添加圣光续疗
                if (ce && ce.holyLightHoTStacks && typeof best.applyHolyRenewal === 'function') {
                    best.applyHolyRenewal(ce.holyLightHoTStacks, (ce.holyLightHoTSeconds || 3) * 1000, 0.01);
                }
                // 净厄藤坠：对友方治疗时给目标加速
                if (ce && ce.lightHasteStacks && typeof best.applyHaste === 'function') {
                    for (let i = 0; i < ce.lightHasteStacks; i++) {
                        best.applyHaste(ce.lightHasteDuration || 5000);
                    }
                }
                if (best === src && window.GameUIManager && typeof window.GameUIManager.updateUI === 'function') {
                    window.GameUIManager.updateUI();
                }
            } else {
                let dmg = amount;
                if (best.config && best.config.family === '僵尸') {
                    dmg = Math.floor(dmg * effect.zombieDamageMul);
                }
                const wasAlive = best.hp > 0;
                best.takeDamage(dmg, src, 'magic');
                if (wasAlive && best.hp <= 0 && !best._summoned) killCount++;
            }
            if (this._isPlayer()) {
                SkillManager.addHolyLightExp(src, 1, killCount);
            }
            EffectManager.add(new HolyLightEffect(src, best, {
                durationMs: effect.duration * 1000,
                fadeMs: effect.fadeMs,
                beamTopWidth: effect.beamTopWidth,
                beamBottomWidth: effect.beamBottomWidth,
                beamHeight: effect.beamHeight,
                dissolveRatio: effect.dissolveRatio,
            }));
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 40, '✨ 圣光', '#ffd27a'));
            // 松木握柄：施法后添加 1 层链式强化；檀木握柄：施法后给自身加速
            addChainSpellStack(src);
            applyCastHaste(src);
        };
        if (this._isPlayer()) {
            this._startPlayerCast(doRelease);
        } else {
            doRelease();
        }
        return true;
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

    /** 视线检测：玩家→目标 线段是否被墙体阻挡（WallSystem.resolve 畅通时原样返回目标点） */
    _isLineOfSightClear(x1, y1, x2, y2, radius = 8) {
        if (!WallSystem || typeof WallSystem.resolve !== 'function') return true;
        const resolved = WallSystem.resolve(x1, y1, x2, y2, radius);
        return Math.abs(resolved.x - x2) <= 1 && Math.abs(resolved.y - y2) <= 1;
    }

    update(dt) {
        if (this.source._holyLightCooldown > 0) {
            this.source._holyLightCooldown -= dt;
            if (this.source._holyLightCooldown < 0) this.source._holyLightCooldown = 0;
        }
    }
}
