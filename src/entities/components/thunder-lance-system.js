import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { Camera } from '../../world/camera.js';
import { WallSystem } from '../../world/wall-system.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { SceneManager } from '../../world/scene-manager.js';
import { burstParticles, fireGroundShockwave, fireRadialBurst, spawnRailgunBeam } from '../../effects/combat-fx.js';
import { ChargeOrbFx } from '../../effects/charge-orb-fx.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { SkillManager } from '../../ui/skill-manager.js';
import {
    getCurrentWeaponCraftEffects,
    getMagicMpCostMultiplier,
    getMagicCooldownMultiplier,
    getMagicRangeMultiplier,
    getMagicDamageMultiplierWithChain,
    consumeChainSpellBonus,
    addChainSpellStack,
    applyCastHaste,
} from '../../utils/magic-craft-helper.js';
import skillsData from '../../../data/skills.json';
import { isSkillCheatEnabled } from '../../config/dev-cheats.js';
import { meetsMagicWeaponReq } from '../../config/magic-categories.js';
import {
    hasRangedLineOfSight,
    resolveRangedLineEnd,
} from '../../combat/ranged-line-of-sight.js';

/** 手层内容质心缓存（纹理键+帧名 → 归一化局部偏移），像素分析一次后复用 */
const HAND_CENTROID_CACHE = new Map();

/** 雷枪数值默认（配置唯一真相：skills.json effectFormula 必有这些字段；缺省兜底统一收敛于此） */
const LANCE_DEFAULTS = {
    cooldown: 32,
    mpCost: 120,
    maxRange: 1000,
    delayMs: 2500,
    minChargeMs: 500,
    lanceDamageBase: 124,
    lanceMagicMul: 2.06,
    lanceIntMul: 2.3,
    knockback: 50,
    electrifyDamagePerStack: 0.1,
    electrifyStacks: 2,
    electrifyDurationMs: 5000,
    chargeBonusMul: 1.3,
    coneHalfWidth: 40,
    endExplosionRadius: 90,
    shakeIntensity: 10,
};

/**
 * 指定施法帧的手层内容质心（像素级，SKILL.md 手部分层沉淀：拳头中心=手层内容质心）。
 * 不依赖 hand.frame（蓄力冻结后手层帧可能停在 0），直接按 frameIndex 从纹理取帧分析。
 * 返回 { x, y } = 帧内归一化偏移（相对 sprite 中心，-0.5~0.5）；读取失败回退 (0,0)。
 */
function getHandFrameCentroid(hand, scene, frameIndex = 0) {
    const texKey = hand.texture && hand.texture.key;
    const cacheKey = `${texKey}:f${frameIndex}`;
    if (HAND_CENTROID_CACHE.has(cacheKey)) return HAND_CENTROID_CACHE.get(cacheKey);
    let centroid = { x: 0, y: 0 };
    try {
        const tex = scene.textures.get(texKey);
        const src = tex && typeof tex.getSourceImage === 'function' ? tex.getSourceImage() : null;
        const frame = tex && tex.get ? tex.get(String(frameIndex)) : null;
        const cw = src ? src.width : 0;
        const ch = src ? src.height : 0;
        if (src && cw > 0 && ch > 0 && typeof document !== 'undefined') {
            const fw = (frame && frame.cutWidth) || cw;
            const fh = (frame && frame.cutHeight) || ch;
            const fx = (frame && frame.cutX) || 0;
            const fy = (frame && frame.cutY) || 0;
            const canvas = document.createElement('canvas');
            canvas.width = fw;
            canvas.height = fh;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.clearRect(0, 0, fw, fh);
            ctx.drawImage(src, fx, fy, fw, fh, 0, 0, fw, fh);
            const data = ctx.getImageData(0, 0, fw, fh).data;
            let sx = 0;
            let sy = 0;
            let cnt = 0;
            for (let y = 0; y < fh; y++) {
                for (let x = 0; x < fw; x++) {
                    if (data[(y * fw + x) * 4 + 3] > 40) {
                        sx += x;
                        sy += y;
                        cnt++;
                    }
                }
            }
            if (cnt > 0) {
                centroid = { x: (sx / cnt) / fw - 0.5, y: (sy / cnt) / fh - 0.5 };
            }
        }
    } catch (_e) { /* 像素读取失败用 sprite 中心 */ }
    HAND_CENTROID_CACHE.set(cacheKey, centroid);
    return centroid;
}

/**
 * 贯穿雷枪技能系统（2026-08-05，电系高级：蓄力贯穿型）
 *
 * 释放：按 Q 后蓄力 delayMs（2.5s），**蓄力期间保持施法姿势释放帧定格且不可移动**
 * （startPlayerCast holdAtRelease，释放/取消后才恢复收尾回 idle），完成后沿鼠标方向射出
 * **电磁炮直线光束**（railgun，笔直贯穿，非蛇形闪电；目标地点无提示特效）：
 * - 锥形判定贯穿路径上所有敌人（视线可达、按距离排序），蓄力贯穿伤害 ×chargeBonusMul，
 *   **目标感电层数越高伤害越高（每层 +10%，electrifyDamagePerStack）**，命中叠加感电；
 * - 视觉 = 一条直线光束（白蓝辉光 + 加速环从后往前扫）+ 每个被贯穿目标处贯穿火花；
 * - 射程尽头/撞墙处电爆 + 留下感电地面（区域内周期叠感电）。
 * 蓄力期间眩晕/冻结/死亡自动取消（不发射）。
 */
export class ThunderLanceSystem {
    constructor(source) {
        this.source = source;
        this._charging = null; // { remaining, aimX, aimY, effect, eye, acc, chargeParticleTimer }
        this._chargeOrb = null; // 蓄力汇聚光球（手部粒子团）
        this._holdKeyCode = null; // 当前蓄力绑定键（安全网：键已松开且仍蓄力时自动释放）
        this._holdKeyPressed = false; // 该键是否由键盘按下（鼠标点击二段式不启用安全网）
        this._magicDamageMul = 1;
    }

    _isPlayer() {
        return this.source && this.source._faction === 'player';
    }

    /** 是否正在蓄力（点击快捷栏二段式：再点一次释放） */
    isCharging() {
        return !!this._charging;
    }

    /** 记录当前蓄力绑定键（keydown 任意路径触发蓄力时由 QuickBar 调用） */
    setHoldKey(keyCode) {
        this._holdKeyCode = keyCode;
        // 键盘长按：keydown 先 add 再 handleKey，此时 Input.keys 已含该键；
        // 鼠标点击二段式：无键盘事件，keys 不含 → 不启用安全网（避免误判松开立即失败）
        this._holdKeyPressed = !!(Input && Input.keys && Input.keys.has(keyCode));
    }

    /**
     * 开始蓄力（长按蓄力入口）。
     * @param {number} [optAimX] - 怪物/非玩家传瞄准点 X（玩家忽略，用鼠标）；缺省回退自身前方 100px
     * @param {number} [optAimY]
     */
    trigger(optAimX, optAimY) {
        const src = this.source;
        if (!src || (!isSkillCheatEnabled() && src._thunderLanceCooldown > 0)) return;
        if (this._charging) return;
        // 高级魔法门槛：需装备法杖才能释放（测试开关可绕过）
        if (this._isPlayer()) {
            const req = meetsMagicWeaponReq(src, 'thunderLance');
            if (!req.ok) {
                if (SceneManager && typeof SceneManager.showTopNotification === 'function') {
                    SceneManager.showTopNotification(req.reason);
                }
                return;
            }
        }
        const skill = src.skills && src.skills.thunderLance;
        if (!skill) return;
        const baseEffect = skill.getEffect(skill.level);

        // 瞄准方向：玩家=鼠标世界坐标；怪物/其他单位=调用方传入的瞄准点（如面向玩家），缺省回退自身前方
        let aimX = src.x + 100;
        let aimY = src.y;
        if (this._isPlayer()) {
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
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 30, '魔法不足', '#b98cff'));
            return;
        }
        const chain = consumeChainSpellBonus(src);
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0) src.data.mp -= mpCost;

        // 配置唯一真相：默认值集中收敛于 LANCE_DEFAULTS（skills.json 双份必有），代码不再散落魔法数字
        const effect = { ...LANCE_DEFAULTS, ...baseEffect, mpCost };
        effect.cooldown = effect.cooldown * getMagicCooldownMultiplier(src, ce);
        effect.maxRange *= getMagicRangeMultiplier(src, ce);
        this._magicDamageMul = getMagicDamageMultiplierWithChain(src, 'thunderLance', ce, chain.stacks);
        // 长按蓄力：按下即进入冷却（用户定稿：没有蓄力满也要进入 CD，失败/提前释放都计 CD）
        if (!isSkillCheatEnabled()) src._thunderLanceCooldown = effect.cooldown * 1000;

        const doRelease = () => {
            const castSounds = skillsData.skills?.thunderLance?.sounds?.cast;
            if (castSounds && SoundManager && typeof SoundManager.playFile === 'function') {
                (Array.isArray(castSounds) ? castSounds : [castSounds]).forEach(p => SoundManager.playFile(p));
            }
            this._startCharge(aimX, aimY, effect);
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 40, '⚡ 贯穿雷枪', '#b98cff'));
            addChainSpellStack(src);
            applyCastHaste(src);
        };
        if (this._isPlayer()) {
            this._startPlayerCast(doRelease, true); // 蓄力定格：保持施法姿势中间帧
        } else {
            doRelease();
        }
    }

    /** 开始蓄力：蓄力计时（无目标点提示特效；施法姿势已由 holdAtRelease 定格） */
    _startCharge(aimX, aimY, effect) {
        const src = this.source;
        this._charging = {
            remaining: effect.delayMs,
            elapsed: 0,          // 已蓄力时长（ms），用于松开释放判定与伤害比例
            aimX,
            aimY,
            effect,
            acc: { hits: 0, kills: 0, multiHit: false },
            chargeParticleTimer: 0,
        };
        // 手部汇聚光球：玩家锚定施法手（手层内容质心，SKILL 沉淀）；
        // 怪物/其他单位同样生成，暂用默认锚点（身体中线上方），待怪物绑定点做好后再替换
        this._chargeOrb = new ChargeOrbFx(src, {
            anchorFn: this._isPlayer() ? () => this._handAnchor() : () => this._defaultChargeAnchor(),
            durationMs: effect.delayMs,
            radiusMax: 38,
        });
        EffectManager.add(this._chargeOrb);
    }

    /** 蓄力取消（眩晕/冻结/死亡/释放失败）：不发射、不进入冷却、恢复施法收尾回 idle */
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
     * - 已蓄力 ≥ minChargeMs（0.5s）→ 发射，伤害按蓄力比例；
     * - 不足最短蓄力 → 释放失败：不发射、不进入冷却。
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
            // 蓄力不足 0.5s 释放失败：清掉按下时已进入的冷却（用户定稿：不足最短蓄力不进入 CD）
            if (this.source && !isSkillCheatEnabled()) {
                this.source._thunderLanceCooldown = 0;
            }
            // 释放失败不扣魔法值：返还按下蓄力时已扣的 MP（不超上限）
            if (!isSkillCheatEnabled() && this._isPlayer() && c.effect && c.effect.mpCost > 0
                && this.source && this.source.data) {
                const maxMp = this.source.data.maxMp ?? Infinity;
                this.source.data.mp = Math.min(maxMp, (this.source.data.mp || 0) + c.effect.mpCost);
            }
            if (SceneManager && typeof SceneManager.showTopNotification === 'function') {
                SceneManager.showTopNotification('⚡ 蓄力不足（需 ≥0.5s），释放失败！');
            }
        }
    }

    /** 蓄力完成：射出贯穿雷枪 */
    _fire(entities) {
        const src = this.source;
        const c = this._charging;
        if (!c) return;
        const effect = c.effect;
        this._charging = null;
        this._holdKeyCode = null;
        this._holdKeyPressed = false;
        // 蓄力成功：手部光球向外爆散消散
        if (this._chargeOrb) {
            this._chargeOrb.finish();
            this._chargeOrb = null;
        }
        // 蓄力完成：恢复施法动画收尾（播完前摇 → 倒放后摇回 idle）
        this._resumeCastHold();

        const entityList = Array.from(entities && entities.values ? entities.values() : (entities || []));
        if (effect.shakeIntensity && Camera && typeof Camera.triggerShake === 'function') {
            Camera.triggerShake(effect.shakeIntensity);
        }

        // 终点位置（撞墙截断）——电磁炮光束从玩家到终点一条笔直直线
        const end = this._rayEnd(c.aimX, c.aimY, effect);
        spawnRailgunBeam({
            x: src.x,
            y: src.y - ((src.bodyHeight || 120) * 0.5),
            endX: end.x,
            endY: end.y - 8,
            duration: 373, // 2026-08-05 用户反馈：光柱残留时间延长 33%（280→373ms）
            widthScale: 4.0, // 2026-08-05 用户反馈：光柱加粗一倍（等效 80→160px）
            depth: Math.max(src.y, end.y) + 2,
        });

        // 贯穿目标：锥形 + 视线 + 距离排序
        const targets = this._findPierceTargets(c.aimX, c.aimY, effect, entityList);
        const d = src.data;
        const baseDamage = Math.floor(
            (effect.lanceDamageBase ?? 0)
            + (d.matk ?? 0) * (effect.lanceMagicMul ?? 0)
            + (d.int ?? 0) * (effect.lanceIntMul ?? 0)
        );
        const perStack = effect.electrifyDamagePerStack;
        const chargeMul = effect.chargeBonusMul;
        // 伤害随蓄力比例：满蓄力（delayMs）= 100%；最短 0.5s 释放 ≈ 20%
        const maxMs = Math.max(1, effect.delayMs);
        const chargeRatio = Math.min(1, Math.max(0.2, (c.elapsed || maxMs) / maxMs));
        const damageMul = chargeRatio * chargeMul * this._magicDamageMul;
        // 击退方向 = 光束方向（鼠标瞄准方向），击退距离随等级 50→150px
        const kbx = c.aimX - src.x;
        const kby = c.aimY - src.y;
        const kbd = Math.hypot(kbx, kby) || 1;
        const knockAngle = Math.atan2(kby / kbd, kbx / kbd);
        for (const { e } of targets) {
            const stacks = e._electrifiedStacks || 0;
            const damage = Math.floor(baseDamage * damageMul * (1 + stacks * perStack));
            const wasAlive = e.hp > 0;
            // 贯穿命中火花（直线光束已画，这里只做命中爆点）
            this._spawnHitFx(e.x, e.y, stacks);
            e.takeDamage(damage, src, 'electric');
            // 命中击退：沿光束方向，距离随等级（knockback 50→150px）
            if (effect.knockback && typeof e.applyKnockback === 'function') {
                e.applyKnockback(knockAngle, effect.knockback);
            }
            if (typeof e.applyElectrified === 'function') {
                e.applyElectrified(effect.electrifyStacks, effect.electrifyDurationMs, src);
            }
            c.acc.hits++;
            if (wasAlive && e.hp <= 0 && !e._summoned) c.acc.kills++;
        }
        // 多命中：贯穿 ≥2（面板口径一致）
        if (c.acc.hits >= 2) c.acc.multiHit = true;

        // 终点电爆 + 感电地面（撞墙截断位置 = 射线可达末端）
        this._spawnEndBurst(end.x, end.y, effect, src);

        if (this._isPlayer() && c.acc.hits > 0) {
            SkillManager.addThunderLanceExp(src, c.acc.hits, c.acc.kills, c.acc.multiHit);
        }
    }

    /** 锥形贯穿判定：鼠标方向 ±coneHalfWidth 内、视线可达、按距离排序 */
    _findPierceTargets(aimX, aimY, effect, entityList) {
        const src = this.source;
        const dx = aimX - src.x;
        const dy = aimY - src.y;
        const dirDist = Math.hypot(dx, dy) || 1;
        const ux = dx / dirDist;
        const uy = dy / dirDist;
        const maxRange = effect.maxRange;
        const coneHalf = effect.coneHalfWidth;
        const hits = [];
        for (const e of entityList) {
            if (!e || e === src || !e.active || !e.hittable) continue;
            if (e._faction === src._faction) continue;
            const ex = e.x - src.x;
            const ey = e.y - src.y;
            const proj = ex * ux + ey * uy;
            if (proj <= 20 || proj > maxRange) continue;
            const perp = Math.abs(ex * uy - ey * ux);
            const threshold = coneHalf + (e.collisionRadius || e.size || 12) * 0.6;
            if (perp > threshold) continue;
            if (!this._isLineOfSightClear(e)) continue;
            hits.push({ e, proj });
        }
        hits.sort((a, b) => a.proj - b.proj);
        return hits;
    }

    /** 射线末端（撞墙截断到墙前 20px） */
    _rayEnd(aimX, aimY, effect) {
        const src = this.source;
        const maxRange = effect.maxRange;
        const dx = aimX - src.x;
        const dy = aimY - src.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        const endX = src.x + ux * maxRange;
        const endY = src.y + uy * maxRange;
        let ex = endX;
        let ey = endY;
        if (WallSystem) {
            const resolved = resolveRangedLineEnd(src, endX, endY, 8);
            if (Math.abs(resolved.x - endX) > 1 || Math.abs(resolved.y - endY) > 1) {
                const t = Math.hypot(resolved.x - src.x, resolved.y - src.y);
                const reach = Math.max(50, t - 20);
                ex = src.x + ux * reach;
                ey = src.y + uy * reach;
            }
        }
        return { x: ex, y: ey };
    }

    /** 终点电爆（2026-08-05：取消天顶光柱与感电地面蓝圈，保留冲击波/放射线/粒子） */
    _spawnEndBurst(x, y, effect, _src) {
        fireGroundShockwave({
            x,
            y,
            maxRadius: effect.endExplosionRadius,
            strokeColor: 0xa98fff,
            fillColor: 0x6a4bff,
            lineWidth: 8,
            duration: 559, // 特效残留延长 33%（420→559ms）
            flicker: true,
            strokeAlpha: 1.0,
            fillAlpha: 0.16,
        });
        fireRadialBurst({
            x,
            y,
            count: 18,
            color: 0x6a9fff,
            lenMin: 18,
            lenMax: 66,
            widthMin: 1.5,
            widthMax: 3.5,
            duration: 479, // 特效残留延长 33%（360→479ms）
            perspective: true,
            depth: y + 2,
        });
        burstParticles({
            texture: 'impact_dot',
            x,
            y,
            count: 26,
            jitter: 24,
            config: {
                speed: { min: 120, max: 520 },
                scale: { start: 3.2, end: 0.3 },
                alpha: { start: 1.0, end: 0 },
                lifespan: { min: 466, max: 931 },
                tint: [0xffffff, 0xf0e9ff, 0xddd2ff, 0x8f7bff],
                blendMode: 'ADD',
            },
            destroyAfterMs: 1064,
            depth: y + 2,
        });
    }

    _spawnHitFx(x, y, stacks) {
        const hitDepth = y + 2;
        const scale = 1 + Math.min(stacks, 5) * 0.08;
        fireGroundShockwave({
            x,
            y,
            maxRadius: 84 * scale,
            strokeColor: 0xa98fff,
            fillColor: 0x6a4bff,
            lineWidth: 6,
            duration: 505, // 特效残留延长 33%（380→505ms）
            flicker: true,
            strokeAlpha: 1.0,
            fillAlpha: 0.14,
        });
        burstParticles({
            texture: 'impact_dot',
            x,
            y,
            count: Math.round(16 * scale),
            jitter: 38,
            config: {
                speed: { min: 100, max: 480 },
                scale: { start: 3.2, end: 0.4 },
                alpha: { start: 1.0, end: 0 },
                lifespan: { min: 426, max: 825 },
                tint: [0xffffff, 0xf0e9ff, 0xddd2ff, 0x8f7bff],
                blendMode: 'ADD',
            },
            destroyAfterMs: 958,
            depth: hitDepth,
        });
    }

    /** 视线检测：玩家→目标 线段是否被墙体阻挡 */
    _isLineOfSightClear(target, radius = 8) {
        return hasRangedLineOfSight(this.source, target, radius);
    }

    /** 玩家施法动作包装：播施法动画，第 8 帧触发 onRelease；holdAtRelease=蓄力定格（保持释放帧，等 resume 收尾） */
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

    /**
     * 手部世界坐标锚点：
     * 1) 优先施法武器轨迹——**法杖握把=手**（SKILL：法杖握把绑定手部共同运动、握把终点=前伸手；
     *    GameScene 按 staffCastFrames 逐帧把 weaponSprite 定位到握把，蓄力定格时停在暂停帧，
     *    即"暂停帧画面中手部的位置"，与画面完全一致）。跨步已一步站稳 + 80ms 延迟锁定，不漂移。
     * 2) 回退手层内容质心（像素级，SKILL 沉淀）。
     * 3) 最后回退玩家身前上方。
     */
    _handAnchor() {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        // 优先：法杖握把（施法武器）位置 = 暂停帧画面中手部位置
        if (scene && scene.weaponSprite && scene.weaponSprite.active && scene.weaponSprite.visible) {
            return { x: scene.weaponSprite.x, y: scene.weaponSprite.y };
        }
        // 回退：手层内容质心（像素级）
        if (scene && scene.playerHandSprite && scene.playerHandSprite.active && scene.playerHandSprite.visible) {
            const hand = scene.playerHandSprite;
            // 施法当前帧号（蓄力定格 = release 帧 index 6）：冻结后 playerSprite 停在 release 帧
            let castIdx = 0;
            if (scene.playerSprite && scene.playerSprite.anims && scene.playerSprite.anims.currentFrame) {
                const raw = Number(scene.playerSprite.anims.currentFrame.textureFrame);
                if (!Number.isNaN(raw)) castIdx = Math.max(0, Math.floor(raw));
            }
            const off = getHandFrameCentroid(hand, scene, castIdx);
            const flip = hand.flipX ? -1 : 1;
            return {
                // release 帧 = 施法前伸手（质心偏上偏右），直接使用
                x: hand.x + off.x * hand.displayWidth * flip,
                y: hand.y + off.y * hand.displayHeight,
            };
        }
        const p = this.source;
        let facing = 1;
        if (scene && scene.playerSprite) facing = scene.playerSprite.flipX ? -1 : 1;
        return {
            x: p.x + facing * 34,
            y: p.y - ((p.bodyHeight || 120) * 0.5) - 46,
        };
    }

    /** 怪物/其他单位蓄力光球默认锚点（身体中线上方；怪物绑定点确定后替换） */
    _defaultChargeAnchor() {
        const p = this.source;
        return { x: p.x, y: p.y - ((p.bodyHeight || 120) * 0.5) - 30 };
    }

    update(dt, entities) {
        const src = this.source;
        if (!src) return;
        if (src._thunderLanceCooldown > 0) {
            src._thunderLanceCooldown -= dt;
            if (src._thunderLanceCooldown < 0) src._thunderLanceCooldown = 0;
        }
        // 蓄力推进：眩晕/冻结/死亡取消；每 150ms 手前电花
        const c = this._charging;
        if (c) {
            const interrupted = src.isStunned || !src.active || (typeof src.hasStatusEffect === 'function' && src.hasStatusEffect('frozen'));
            if (interrupted) {
                this._cancelCharge();
            } else {
                // 安全网：绑定键已松开（keyup 已删 Input.keys）但 release 未被触发（如首次进入绑定未就绪
                // 走了 useSlot 路径）→ 自动释放，避免蓄力到满
                if (this._isPlayer() && this._holdKeyCode && this._holdKeyPressed && Input && Input.keys
                    && !Input.keys.has(this._holdKeyCode)) {
                    this.release();
                    return;
                }
                c.remaining -= dt;
                c.elapsed += dt;
                // 蓄力期间瞄准跟随鼠标：最终释放方向以松开/满蓄时的鼠标位置为准；
                // 鼠标方向转到背后时翻转释放者贴图朝向（施法定格不覆盖 flipX，安全）
                if (this._isPlayer() && Input && Renderer) {
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
                c.chargeParticleTimer -= dt;
                if (c.chargeParticleTimer <= 0) {
                    // 充能越接近完成，粒子越密（2.5s 蓄力的蓄能感）
                    const progress = 1 - Math.max(0, c.remaining) / c.effect.delayMs;
                    c.chargeParticleTimer = Math.max(60, 140 - progress * 80);
                    burstParticles({
                        texture: 'impact_dot',
                        x: src.x + (Math.random() - 0.5) * 30,
                        y: src.y - ((src.bodyHeight || 120) * 0.5) - 20,
                        count: Math.round(4 + progress * 6),
                        jitter: 12,
                        config: {
                            speed: { min: 60, max: 240 },
                            angle: { min: -160, max: -20 },
                            gravityY: -60,
                            scale: { start: 1.8, end: 0.2 },
                            alpha: { start: 0.95, end: 0 },
                            lifespan: { min: 260, max: 520 },
                            tint: [0xffffff, 0xbcdcff, 0x7fb8ff, 0x4b6fff],
                            blendMode: 'ADD',
                        },
                        destroyAfterMs: 620,
                        depth: src.y + 30,
                    });
                }
                if (c.remaining <= 0) {
                    this._fire(entities);
                }
            }
        }
    }

    /** 死亡/场景切换统一清理（不结算经验，与暴风雪 clearZones 同口径） */
    clearLance() {
        this._cancelCharge();
    }
}
