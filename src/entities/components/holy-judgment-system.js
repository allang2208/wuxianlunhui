import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { Camera } from '../../world/camera.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { SceneManager } from '../../world/scene-manager.js';
import { HolyLightEffect } from '../../effects/holy-light.js';
import { burstParticles, fireGroundShockwave, fireRadialBurst } from '../../effects/combat-fx.js';
import { ChargeOrbFx } from '../../effects/charge-orb-fx.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { SkillManager } from '../../ui/skill-manager.js';
import {
    getCurrentWeaponCraftEffects,
    getMagicMpCostMultiplier,
    getMagicCooldownMultiplier,
    getMagicRangeMultiplier,
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
import { entitySurfaceZ } from '../../physics/elevation.js';

/** 圣光审判数值默认（配置唯一真相：skills.json effectFormula 必有；缺省兜底统一收敛于此） */
const JUDGMENT_DEFAULTS = {
    cooldown: 40,
    mpCost: 130,
    maxRange: 700,
    delayMs: 2500,
    minChargeMs: 500,
    radiusMin: 280,
    radiusMax: 520,
    damageBase: 68,
    damageMagicMul: 1.75,
    damageIntMul: 1.2,
    damageWisMul: 1.2,
    zombieDamageMul: 3,
    purifyThreshold: 0.124,
    healBase: 32,
    healWisMul: 1.5,
    shakeIntensity: 12,
};

/** 友方阵营组（与 holy-light-system 同口径） */
const FRIENDLY_FACTIONS = new Set(['player', 'companion']);

/** 净化斩杀豁免：Boss/领主不可被即死 */
function isPurifyImmune(e) {
    return e && (e.rank === 'boss' || e.rank === 'lord');
}

/** 全量净化清单（审判落下时友方立即清除全部负面状态） */
const CLEANSE_TYPES = ['poison', 'bleed', 'fear', 'chill', 'frozen', 'slow', 'bind',
    'magicVulnerability', 'droneVulnerability', 'electrified'];

/** 圣光审判蓄力光球配色（金色系；ChargeOrbFx 默认蓝色不变） */
const HOLY_PALETTE = {
    tints: [0xffffff, 0xfff3c8, 0xffe08a, 0xffc95a],
    glowOuter: 0xffc95a,
    glowInner: 0xffe9b0,
    core: 0xffe9b0,
};

/**
 * 圣光审判技能系统（2026-08-23，光系高级：蓄力天降巨柱审判）
 *
 * 释放：长按快捷键蓄力 delayMs（2.5s），蓄力期间施法姿势定格且不可移动
 * （startPlayerCast holdAtRelease），目标点随鼠标实时移动（maxRange 钳制）；
 * 松开/满蓄后在目标点降下巨型圣柱：
 * - 敌方：半径 radiusMin→radiusMax（随蓄力比例）内光系魔法伤害
 *   （僵尸类 ×zombieDamageMul）；血量 ≤ purifyThreshold 的非 Boss 不死单位
 *   伤害结算后仍存活则直接净化即死（计击杀经验，白色升化特效）；
 * - 友方：同范围大额回血 + 立即清除全部负面状态。
 * 蓄力 0.5~2.5s 按时间比例 30%~100% 生效；不足 minChargeMs 释放失败：
 * 不进冷却、返还 MP（与贯穿雷枪同口径）。眩晕/冻结/死亡自动取消。
 */
export class HolyJudgmentSystem {
    constructor(source) {
        this.source = source;
        this._charging = null; // { remaining, elapsed, aimX, aimY, effect, acc }
        this._chargeOrb = null;
        this._holdKeyCode = null;
        this._holdKeyPressed = false;
        this._selfAim = false; // Alt 自释放：落点锁定自身脚下
        this._magicDamageMul = 1;
        this._healMul = 1;
    }

    _isPlayer() {
        return this.source && this.source._faction === 'player';
    }

    isCharging() {
        return !!this._charging;
    }

    /** 记录当前蓄力绑定键（keydown 任意路径触发蓄力时由 QuickBar 调用） */
    setHoldKey(keyCode) {
        this._holdKeyCode = keyCode;
        this._holdKeyPressed = !!(Input && Input.keys && Input.keys.has(keyCode));
    }

    /**
     * 开始蓄力（长按蓄力入口）。
     * @param {number} [optAimX] - 非玩家传瞄准点 X（玩家用鼠标）；缺省回退自身前方 100px
     * @param {number} [optAimY]
     */
    trigger(optAimX, optAimY) {
        this._selfAim = false;
        this._triggerInternal(optAimX, optAimY);
    }

    /** Alt+快捷键 自释放：落点锁定自身脚下（蓄力流程相同，选点不随鼠标） */
    triggerSelf() {
        this._selfAim = true;
        this._triggerInternal();
    }

    _triggerInternal(optAimX, optAimY) {
        const src = this.source;
        if (!src || (!isSkillCheatEnabled() && src._holyJudgmentCooldown > 0)) return;
        if (this._charging) return;
        // 高级魔法门槛：需装备法杖才能释放（测试开关可绕过）
        if (this._isPlayer()) {
            const req = meetsMagicWeaponReq(src, 'holyJudgment');
            if (!req.ok) {
                if (SceneManager && typeof SceneManager.showTopNotification === 'function') {
                    SceneManager.showTopNotification(req.reason);
                }
                return;
            }
        }
        const skill = src.skills && src.skills.holyJudgment;
        if (!skill) return;
        const baseEffect = skill.getEffect(skill.level);

        let aimX = src.x + 100;
        let aimY = src.y;
        if (this._selfAim) {
            aimX = src.x;
            aimY = src.y;
        } else if (this._isPlayer()) {
            const aim = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
            aimX = aim.x;
            aimY = aim.y;
        } else if (Number.isFinite(optAimX) && Number.isFinite(optAimY)) {
            aimX = optAimX;
            aimY = optAimY;
        }

        // MP 门禁（含链式减免）
        const ce = getCurrentWeaponCraftEffects(src);
        const chainStacks = (src._chainSpellStacks) || 0;
        const mpMul = getMagicMpCostMultiplier(src, ce, chainStacks);
        const mpCost = baseEffect.mpCost ? Math.max(0, Math.floor(baseEffect.mpCost * mpMul)) : 0;
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0 && src.data.mp < mpCost) {
            EffectManager.add(new FloatingTextEffect(src.x, src.y - entitySurfaceZ(src) - 30, '魔法不足！', '#ffd27a'));
            return;
        }
        const chain = consumeChainSpellBonus(src);
        const castContext = createMagicCastContext(src, ce);
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0) src.data.mp -= mpCost;

        const effect = { ...JUDGMENT_DEFAULTS, ...baseEffect, mpCost };
        effect.cooldown = effect.cooldown * getMagicCooldownMultiplier(src, ce);
        effect.maxRange *= getMagicRangeMultiplier(src, ce);
        this._magicDamageMul = getMagicDamageMultiplierWithChain(src, 'holyJudgment', ce, chain.stacks);
        this._healMul = getMagicHealMultiplierWithChain(src, 'holyJudgment', ce, chain.stacks);
        // 长按蓄力：按下即进入冷却（与贯穿雷枪同定稿：失败/提前释放另行清 CD）
        if (!isSkillCheatEnabled()) src._holyJudgmentCooldown = effect.cooldown * 1000;

        const doRelease = () => {
            const castSounds = skillsData.skills?.holyJudgment?.sounds?.cast;
            if (castSounds && SoundManager && typeof SoundManager.playFile === 'function') {
                (Array.isArray(castSounds) ? castSounds : [castSounds]).forEach(p => SoundManager.playFile(p));
            }
            this._startCharge(aimX, aimY, effect, castContext);
            EffectManager.add(new FloatingTextEffect(src.x, src.y - entitySurfaceZ(src) - 40, '☀️ 圣光审判', '#ffd27a'));
            addChainSpellStack(src, castContext.craftEffects);
            applyCastHaste(src, castContext.craftEffects);
        };
        if (this._isPlayer()) {
            this._startPlayerCast(doRelease, true); // 蓄力定格：保持施法姿势中间帧
        } else {
            doRelease();
        }
    }

    /** 开始蓄力：蓄力计时 + 手部金色汇聚光球 */
    _startCharge(aimX, aimY, effect, castContext = null) {
        const src = this.source;
        this._charging = {
            remaining: effect.delayMs,
            elapsed: 0,
            aimX,
            aimY,
            effect,
            castContext,
            acc: { hits: 0, kills: 0, heals: 0, multiHit: false },
        };
        this._chargeOrb = new ChargeOrbFx(src, {
            anchorFn: () => this._handAnchor(),
            durationMs: effect.delayMs,
            radiusMax: 42,
            palette: HOLY_PALETTE,
        });
        EffectManager.add(this._chargeOrb);
    }

    /** 蓄力取消（眩晕/冻结/死亡/释放失败）：不发射、恢复施法收尾回 idle */
    _cancelCharge() {
        const c = this._charging;
        if (!c) return;
        this._charging = null;
        this._holdKeyCode = null;
        this._holdKeyPressed = false;
        if (this._chargeOrb) {
            this._chargeOrb.cancel();
            this._chargeOrb = null;
        }
        this._resumeCastHold();
    }

    /**
     * 松开快捷键释放（长按蓄力模式）：
     * - 已蓄力 ≥ minChargeMs（0.5s）→ 落柱，效果按蓄力比例；
     * - 不足最短蓄力 → 释放失败：不进冷却、返还 MP（贯穿雷枪同口径）。
     */
    release() {
        const c = this._charging;
        if (!c) return;
        const minMs = (c.effect && c.effect.minChargeMs);
        if (c.elapsed >= minMs) {
            const entities = (typeof window !== 'undefined' && window.Game && window.Game.entities)
                ? window.Game.entities : [];
            this._fire(entities);
        } else {
            this._cancelCharge();
            if (this.source && !isSkillCheatEnabled()) {
                this.source._holyJudgmentCooldown = 0;
            }
            if (!isSkillCheatEnabled() && this._isPlayer() && c.effect && c.effect.mpCost > 0
                && this.source && this.source.data) {
                const maxMp = this.source.data.maxMp ?? Infinity;
                this.source.data.mp = Math.min(maxMp, (this.source.data.mp || 0) + c.effect.mpCost);
            }
            if (SceneManager && typeof SceneManager.showTopNotification === 'function') {
                SceneManager.showTopNotification('☀️ 蓄力不足（需 ≥0.5s），释放失败！');
            }
        }
    }

    /** 目标点钳制到最大射程内 */
    _clampAim(aimX, aimY, effect) {
        const src = this.source;
        const dx = aimX - src.x;
        const dy = aimY - src.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= effect.maxRange) return { x: aimX, y: aimY };
        const k = effect.maxRange / (dist || 1);
        return { x: src.x + dx * k, y: src.y + dy * k };
    }

    /** 蓄力完成：目标点降下巨型圣柱并结算 */
    _fire(entities) {
        const src = this.source;
        const c = this._charging;
        if (!c) return;
        const effect = c.effect;
        this._charging = null;
        this._holdKeyCode = null;
        this._holdKeyPressed = false;
        if (this._chargeOrb) {
            this._chargeOrb.finish();
            this._chargeOrb = null;
        }
        this._resumeCastHold();

        const maxMs = Math.max(1, effect.delayMs);
        const chargeRatio = Math.min(1, Math.max(0.3, (c.elapsed || maxMs) / maxMs));
        const point = this._selfAim ? { x: src.x, y: src.y } : this._clampAim(c.aimX, c.aimY, effect);
        const radius = Math.floor(effect.radiusMin + (effect.radiusMax - effect.radiusMin) * chargeRatio);
        const d = c.castContext?.stats || src.data;
        const baseDamage = Math.floor(
            ((effect.damageBase ?? 0)
            + (d.matk ?? 0) * (effect.damageMagicMul ?? 0)
            + (d.int ?? 0) * (effect.damageIntMul ?? 0)
            + (d.wis ?? 0) * (effect.damageWisMul ?? 0)) * this._magicDamageMul * chargeRatio
        );
        const healAmount = Math.floor(
            ((effect.healBase ?? 0) + (d.wis ?? 0) * (effect.healWisMul ?? 0)) * this._healMul * chargeRatio
        );

        if (effect.shakeIntensity && Camera && typeof Camera.triggerShake === 'function') {
            Camera.triggerShake(effect.shakeIntensity);
        }
        this._spawnJudgmentFx(point, radius);

        const entityList = Array.from(entities && entities.values ? entities.values() : (entities || []));
        for (const e of entityList) {
            if (!e || !e.active || !e.hittable || e._isDefenseStructure) continue;
            if (Math.hypot(e.x - point.x, e.y - point.y) > radius) continue;
            if (FRIENDLY_FACTIONS.has(src._faction) && FRIENDLY_FACTIONS.has(e._faction)) {
                // 友方：大额回血 + 立即清除全部负面状态
                if (e.data) {
                    const maxHp = e.data.maxHp || e.maxHp || 0;
                    const before = e.data.hp;
                    e.data.hp = Math.min(maxHp > 0 ? maxHp : Infinity, e.data.hp + healAmount);
                    if (e.data.hp > before) {
                        c.acc.heals++;
                        EffectManager.add(new FloatingTextEffect(e.x, e.y - entitySurfaceZ(e) - 30, `+${e.data.hp - before}`, '#7aff9a'));
                    }
                    if (Array.isArray(e.statusEffects) && e.statusEffects.length) {
                        let cleansed = false;
                        for (const type of CLEANSE_TYPES) {
                            const entry = e.statusEffects.find((se) => se && se.remaining > 0 && se.type === type);
                            if (entry && typeof e.removeStatusEffect === 'function') {
                                e.removeStatusEffect(type);
                                cleansed = true;
                            }
                        }
                        if (e._electrifiedStacks) e._electrifiedStacks = 0;
                        if (cleansed) {
                            EffectManager.add(new FloatingTextEffect(e.x, e.y - entitySurfaceZ(e) - 52, '净化', '#fff3c8'));
                        }
                    }
                    if (e === src && window.GameUIManager && typeof window.GameUIManager.updateUI === 'function') {
                        window.GameUIManager.updateUI();
                    }
                }
                continue;
            }
            // 敌方：光系伤害（僵尸类 ×zombieDamageMul）
            let dmg = baseDamage;
            const isZombie = hasEnemyFamily(e, '僵尸');
            if (isZombie) dmg = Math.floor(dmg * effect.zombieDamageMul);
            const wasAlive = e.hp > 0;
            e.takeDamage(dmg, src, 'magic', false, c.castContext);
            c.acc.hits++;
            // 净化斩杀：非 Boss/领主不死单位，结算后血量仍 ≤ 阈值 → 直接净化即死
            if (e.hp > 0 && isZombie && !isPurifyImmune(e)) {
                const maxHp = e.data?.maxHp || e.maxHp || 0;
                if (maxHp > 0 && e.hp / maxHp <= effect.purifyThreshold) {
                    e.takeDamage(Math.ceil(e.hp) * 10, src, 'magic', false, c.castContext);
                    this._spawnPurifyFx(e);
                    EffectManager.add(new FloatingTextEffect(e.x, e.y - entitySurfaceZ(e) - 40, '净化', '#ffffff'));
                }
            }
            if (wasAlive && e.hp <= 0 && !e._summoned) c.acc.kills++;
        }
        if (c.acc.hits >= 2) c.acc.multiHit = true;

        if (this._isPlayer() && (c.acc.hits > 0 || c.acc.heals > 0)) {
            SkillManager.addHolyJudgmentExp(src, c.acc.hits, c.acc.kills, c.acc.heals, c.acc.multiHit);
        }
    }

    /** 巨型圣柱 + 地面圣纹冲击 + 光粒暴雨 */
    _spawnJudgmentFx(point, radius) {
        const src = this.source;
        // 主圣柱：圣光特效放大版（伪目标仅承载坐标，特效只读 x/y）
        const pseudoTarget = { x: point.x, y: point.y, active: true };
        EffectManager.add(new HolyLightEffect(src, pseudoTarget, {
            durationMs: 1200,
            fadeMs: 500,
            beamTopWidth: Math.floor(radius * 0.5),
            beamBottomWidth: Math.floor(radius * 0.9),
            beamHeight: 1600,
            dissolveRatio: 0.28,
        }));
        // 地面圣纹冲击波（金色）
        fireGroundShockwave({
            x: point.x,
            y: point.y,
            maxRadius: radius,
            strokeColor: 0xffe08a,
            fillColor: 0xffc95a,
            lineWidth: 8,
            duration: 560,
            flicker: true,
            strokeAlpha: 1.0,
            fillAlpha: 0.16,
        });
        fireRadialBurst({
            x: point.x,
            y: point.y,
            count: 20,
            color: 0xffe08a,
            lenMin: 20,
            lenMax: 72,
            widthMin: 1.5,
            widthMax: 3.5,
            duration: 480,
            perspective: true,
            depth: point.y + 2,
        });
        // 光粒暴雨（金白，向上飘散）
        burstParticles({
            texture: 'impact_dot',
            x: point.x,
            y: point.y,
            count: 30,
            jitter: radius * 0.5,
            config: {
                speed: { min: 60, max: 260 },
                angle: { min: -160, max: -20 },
                gravityY: -80,
                scale: { start: 2.8, end: 0.3 },
                alpha: { start: 1.0, end: 0 },
                lifespan: { min: 480, max: 960 },
                tint: [0xffffff, 0xfff3c8, 0xffe08a, 0xffc95a],
                blendMode: 'ADD',
            },
            destroyAfterMs: 1100,
            depth: point.y + 2,
        });
    }

    /** 净化斩杀：白色升化消散（柔和白柱爆点 + 上升光尘） */
    _spawnPurifyFx(e) {
        const y = e.y - entitySurfaceZ(e);
        burstParticles({
            texture: 'impact_dot',
            x: e.x,
            y,
            count: 22,
            jitter: 18,
            config: {
                speed: { min: 40, max: 180 },
                angle: { min: -140, max: -40 },
                gravityY: -120,
                scale: { start: 2.6, end: 0.2 },
                alpha: { start: 1.0, end: 0 },
                lifespan: { min: 420, max: 820 },
                tint: [0xffffff, 0xfff8e8, 0xffe9b0],
                blendMode: 'ADD',
            },
            destroyAfterMs: 900,
            depth: y + 30,
        });
    }

    /** 玩家施法动作包装：播施法动画，第 8 帧触发 onRelease；holdAtRelease=蓄力定格 */
    _startPlayerCast(onRelease, holdAtRelease = false) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (scene && typeof scene.startPlayerCast === 'function') {
            scene.startPlayerCast({ onRelease, holdAtRelease });
        } else if (onRelease) {
            onRelease();
        }
    }

    /** 恢复蓄力定格（释放/取消后调用，让玩家完成施法收尾回 idle） */
    _resumeCastHold() {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (scene && typeof scene.resumePlayerCastHold === 'function') {
            scene.resumePlayerCastHold();
        }
    }

    /** 手部世界坐标锚点：优先施法武器握把（weaponSprite），回退身体中线上方 */
    _handAnchor() {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (scene && scene.weaponSprite && scene.weaponSprite.active && scene.weaponSprite.visible) {
            return { x: scene.weaponSprite.x, y: scene.weaponSprite.y };
        }
        if (scene && scene.playerHandSprite && scene.playerHandSprite.active && scene.playerHandSprite.visible) {
            return { x: scene.playerHandSprite.x, y: scene.playerHandSprite.y };
        }
        const p = this.source;
        return { x: p.x, y: p.y - ((p.bodyHeight || 120) * 0.5) - 46 };
    }

    update(dt, entities) {
        const src = this.source;
        if (!src) return;
        if (src._holyJudgmentCooldown > 0) {
            src._holyJudgmentCooldown -= dt;
            if (src._holyJudgmentCooldown < 0) src._holyJudgmentCooldown = 0;
        }
        const c = this._charging;
        if (c) {
            const interrupted = src.isStunned || !src.active
                || (typeof src.hasStatusEffect === 'function' && src.hasStatusEffect('frozen'));
            if (interrupted) {
                this._cancelCharge();
                return;
            }
            // 安全网：绑定键已松开但 release 未被调用 → 自动释放（贯穿雷枪同款）
            if (this._isPlayer() && this._holdKeyCode && this._holdKeyPressed && Input && Input.keys
                && !Input.keys.has(this._holdKeyCode)) {
                this.release();
                return;
            }
            c.remaining -= dt;
            c.elapsed += dt;
            // 蓄力期间目标点随鼠标实时移动（Alt 自释放锁定自身脚下）；
            // 鼠标转到背后时翻转玩家贴图朝向（施法定格不覆盖 flipX）
            if (this._isPlayer() && !this._selfAim && Input && Renderer) {
                const aim = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
                c.aimX = aim.x;
                c.aimY = aim.y;
                const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
                if (scene && scene.playerSprite) {
                    const facingLeft = aim.x < src.x;
                    if (scene.playerSprite.flipX !== facingLeft) {
                        scene.playerSprite.setFlipX(facingLeft);
                    }
                }
            }
            if (c.remaining <= 0) {
                this._fire(entities);
            }
        }
    }

    /** 死亡/场景切换统一清理（不结算经验，与贯穿雷枪 clearLance 同口径） */
    clearJudgment() {
        this._cancelCharge();
    }
}
