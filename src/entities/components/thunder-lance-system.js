import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { Camera } from '../../world/camera.js';
import { WallSystem } from '../../world/wall-system.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { SceneManager } from '../../world/scene-manager.js';
import { burstParticles, fireGroundShockwave, fireRadialBurst, spawnLightningColumn, spawnRailgunBeam } from '../../effects/combat-fx.js';
import { ChargeOrbFx } from '../../effects/charge-orb-fx.js';
import { GroundCircle } from '../../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
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

/** 手层内容质心缓存（纹理键+帧名 → 归一化局部偏移），像素分析一次后复用 */
const HAND_CENTROID_CACHE = new Map();

/**
 * 手层当前帧的内容质心（像素级，SKILL.md 手部分层沉淀：拳头中心=手层内容质心）。
 * 返回 { x, y } = 帧内归一化偏移（相对 sprite 中心，-0.5~0.5）；读取失败回退 (0,0)。
 */
function getHandFrameCentroid(hand, scene) {
    const texKey = hand.texture && hand.texture.key;
    const frameName = hand.frame ? String(hand.frame.name) : '0';
    const cacheKey = `${texKey}:${frameName}`;
    if (HAND_CENTROID_CACHE.has(cacheKey)) return HAND_CENTROID_CACHE.get(cacheKey);
    let centroid = { x: 0, y: 0 };
    try {
        const tex = scene.textures.get(texKey);
        const src = tex && typeof tex.getSourceImage === 'function' ? tex.getSourceImage() : null;
        const frame = tex && tex.get ? tex.get(frameName) : null;
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
        this._grounds = [];    // [{ x, y, radius, remaining, tickTimer, gfx }]
        this._chargeOrb = null; // 蓄力汇聚光球（手部粒子团）
        this._magicDamageMul = 1;
    }

    _isPlayer() {
        return this.source && this.source._faction === 'player';
    }

    trigger() {
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

        // 瞄准方向：玩家=鼠标世界坐标
        let aimX = src.x + 100;
        let aimY = src.y;
        if (this._isPlayer()) {
            const aim = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
            aimX = aim.x;
            aimY = aim.y;
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

        const effect = { ...baseEffect, mpCost };
        effect.cooldown = (effect.cooldown || 34) * getMagicCooldownMultiplier(src, ce);
        this._magicDamageMul = getMagicDamageMultiplierWithChain(src, 'thunderLance', ce, chain.stacks);
        if (!isSkillCheatEnabled()) src._thunderLanceCooldown = (effect.cooldown || 34) * 1000;

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
            remaining: effect.delayMs || 2500,
            aimX,
            aimY,
            effect,
            acc: { hits: 0, kills: 0, multiHit: false },
            chargeParticleTimer: 0,
        };
        // 手部汇聚光球：每帧跟施法手层（手静止后锚点稳定），粒子向手汇聚，半径随蓄力进度放大
        this._chargeOrb = new ChargeOrbFx(src, {
            anchorFn: () => this._handAnchor(),
            durationMs: effect.delayMs || 2500,
            radiusMax: 38,
        });
        EffectManager.add(this._chargeOrb);
    }

    /** 蓄力取消（眩晕/冻结/死亡）：不发射、恢复施法收尾回 idle */
    _cancelCharge() {
        const c = this._charging;
        if (!c) return;
        this._charging = null;
        if (this._chargeOrb) {
            this._chargeOrb.cancel();
            this._chargeOrb = null;
        }
        this._resumeCastHold();
    }

    /** 蓄力完成：射出贯穿雷枪 */
    _fire(entities) {
        const src = this.source;
        const c = this._charging;
        if (!c) return;
        const effect = c.effect;
        this._charging = null;
        // 蓄力成功：手部光球向外爆散消散
        if (this._chargeOrb) {
            this._chargeOrb.finish();
            this._chargeOrb = null;
        }
        // 蓄力完成：恢复施法动画收尾（播完前摇 → 倒放后摇回 idle）
        this._resumeCastHold();

        const entityList = Array.from(entities.values ? entities.values() : entities);
        // 释放瞬间：天雷注入手中雷枪（玩家位置小光柱）
        spawnLightningColumn({ x: src.x, y: src.y, height: 320, topW: 42, bottomW: 26, duration: 240 });
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
            duration: 280,
            widthScale: 2.0,
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
        const perStack = effect.electrifyDamagePerStack ?? 0.1;
        const chargeMul = effect.chargeBonusMul ?? 1;
        for (const { e } of targets) {
            const stacks = e._electrifiedStacks || 0;
            const damage = Math.floor(baseDamage * chargeMul * (1 + stacks * perStack) * this._magicDamageMul);
            const wasAlive = e.hp > 0;
            // 贯穿命中火花（直线光束已画，这里只做命中爆点）
            this._spawnHitFx(e.x, e.y, stacks);
            e.takeDamage(damage, src, 'electric');
            if (typeof e.applyElectrified === 'function') {
                e.applyElectrified(effect.electrifyStacks || 2, effect.electrifyDurationMs || 5000, src);
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
        const maxRange = effect.maxRange || 1000;
        const coneHalf = effect.coneHalfWidth || 40;
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
            if (!this._isLineOfSightClear(src.x, src.y, e.x, e.y)) continue;
            hits.push({ e, proj });
        }
        hits.sort((a, b) => a.proj - b.proj);
        return hits;
    }

    /** 射线末端（撞墙截断到墙前 20px） */
    _rayEnd(aimX, aimY, effect) {
        const src = this.source;
        const maxRange = effect.maxRange || 1000;
        const dx = aimX - src.x;
        const dy = aimY - src.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        const endX = src.x + ux * maxRange;
        const endY = src.y + uy * maxRange;
        let ex = endX;
        let ey = endY;
        if (WallSystem && typeof WallSystem.resolve === 'function') {
            const resolved = WallSystem.resolve(src.x, src.y, endX, endY, 8);
            if (Math.abs(resolved.x - endX) > 1 || Math.abs(resolved.y - endY) > 1) {
                const t = Math.hypot(resolved.x - src.x, resolved.y - src.y);
                const reach = Math.max(50, t - 20);
                ex = src.x + ux * reach;
                ey = src.y + uy * reach;
            }
        }
        return { x: ex, y: ey };
    }

    /** 终点电爆 + 感电地面 */
    _spawnEndBurst(x, y, effect, src) {
        spawnLightningColumn({ x, y, height: 420, topW: 56, bottomW: 32, duration: 320 });
        fireGroundShockwave({
            x,
            y,
            maxRadius: effect.endExplosionRadius || 90,
            strokeColor: 0xa98fff,
            fillColor: 0x6a4bff,
            lineWidth: 8,
            duration: 420,
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
            duration: 360,
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
                lifespan: { min: 350, max: 700 },
                tint: [0xffffff, 0xf0e9ff, 0xddd2ff, 0x8f7bff],
                blendMode: 'ADD',
            },
            destroyAfterMs: 800,
            depth: y + 2,
        });
        this._grounds.push({
            x,
            y,
            radius: effect.groundRadius || 100,
            remaining: effect.groundDurationMs || 2000,
            tickTimer: 0,
            gfx: null,
            src,
        });
    }

    /** 感电地面：蓝紫椭圆呼吸 + 周期叠感电 */
    _tickGrounds(dt, entities) {
        const entityList = Array.from(entities.values ? entities.values() : entities);
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        for (let i = this._grounds.length - 1; i >= 0; i--) {
            const g = this._grounds[i];
            g.remaining -= dt;
            g.tickTimer -= dt;
            if (!g.gfx && scene && scene.add) {
                const gr = scene.add.graphics();
                gr.setBlendMode('ADD');
                gr.setDepth(g.y - 998);
                g.gfx = gr;
            }
            if (g.gfx && g.gfx.active) {
                const breathe = 0.5 + 0.5 * Math.sin(Date.now() * 0.01);
                g.gfx.clear();
                g.gfx.lineStyle(3, 0x7f9cff, 0.30 + 0.25 * breathe);
                g.gfx.strokeEllipse(g.x, g.y, g.radius * 2, g.radius * PERSPECTIVE_SCALE_Y * 2);
            }
            if (g.tickTimer <= 0) {
                g.tickTimer = 500;
                for (const e of entityList) {
                    if (!e || !e.active || !e.hittable) continue;
                    if (e._faction === g.src._faction) continue;
                    const shape = new GroundCircle(g.x, g.y, g.radius);
                    if (!shape.intersectsEntity(e)) continue;
                    if (typeof e.applyElectrified === 'function') {
                        e.applyElectrified(1, 2000, g.src);
                    }
                    burstParticles({
                        texture: 'impact_dot',
                        x: e.x,
                        y: e.y - ((e.bodyHeight || 120) * 0.5),
                        count: 4,
                        jitter: 14,
                        config: {
                            speed: { min: 40, max: 160 },
                            scale: { start: 1.6, end: 0.15 },
                            alpha: { start: 0.9, end: 0 },
                            lifespan: { min: 220, max: 460 },
                            tint: [0xffffff, 0xbcdcff, 0x7fb8ff],
                            blendMode: 'ADD',
                        },
                        destroyAfterMs: 560,
                        depth: e.y + 2,
                    });
                }
            }
            if (g.remaining <= 0) {
                if (g.gfx && g.gfx.active) g.gfx.destroy();
                this._grounds.splice(i, 1);
            }
        }
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
            duration: 380,
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
                lifespan: { min: 320, max: 620 },
                tint: [0xffffff, 0xf0e9ff, 0xddd2ff, 0x8f7bff],
                blendMode: 'ADD',
            },
            destroyAfterMs: 720,
            depth: hitDepth,
        });
    }

    /** 视线检测：玩家→目标 线段是否被墙体阻挡 */
    _isLineOfSightClear(x1, y1, x2, y2, radius = 8) {
        if (!WallSystem || typeof WallSystem.resolve !== 'function') return true;
        const resolved = WallSystem.resolve(x1, y1, x2, y2, radius);
        return Math.abs(resolved.x - x2) <= 1 && Math.abs(resolved.y - y2) <= 1;
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
     * 手部世界坐标锚点（SKILL 手部判定沉淀，直接用）：
     * 拳头中心 = 手层内容质心（像素级可复现；GLM 定位不可靠只配粗验收）。
     * 每帧取 playerHandSprite 当前帧内容质心 → (手像素−贴图中心)×显示缩放 → 世界坐标；
     * 无手层回退玩家身前上方。
     */
    _handAnchor() {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (scene && scene.playerHandSprite && scene.playerHandSprite.active && scene.playerHandSprite.visible) {
            const hand = scene.playerHandSprite;
            const off = getHandFrameCentroid(hand, scene);
            const flip = hand.flipX ? -1 : 1;
            return {
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
                c.remaining -= dt;
                c.chargeParticleTimer -= dt;
                if (c.chargeParticleTimer <= 0) {
                    // 充能越接近完成，粒子越密（2.5s 蓄力的蓄能感）
                    const progress = 1 - Math.max(0, c.remaining) / (c.effect.delayMs || 2500);
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
        this._tickGrounds(dt, entities);
    }

    /** 死亡/场景切换统一清理（不结算经验，与暴风雪 clearZones 同口径） */
    clearLance() {
        this._cancelCharge();
        for (const g of this._grounds) {
            if (g.gfx && g.gfx.active) g.gfx.destroy();
        }
        this._grounds = [];
    }
}
