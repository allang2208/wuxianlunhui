import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { SceneManager } from '../../world/scene-manager.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { WallSystem } from '../../world/wall-system.js';
import { burstParticles, fireGroundShockwave } from '../../effects/combat-fx.js';
import { meetsMagicWeaponReq } from '../../config/magic-categories.js';
import { isSkillCheatEnabled } from '../../config/dev-cheats.js';
import { SkillManager } from '../../ui/skill-manager.js';
import {
    getCurrentWeaponCraftEffects,
    getMagicRangeMultiplier,
    getMagicMpCostMultiplier,
    getMagicCooldownMultiplier,
    consumeChainSpellBonus,
    addChainSpellStack,
    applyCastHaste,
} from '../../utils/magic-craft-helper.js';
import skillsData from '../../../data/skills.json';

/** 冰墙数值默认（配置唯一真相：skills.json effectFormula 必有；缺省兜底统一收敛于此） */
const ICE_WALL_DEFAULTS = {
    cooldown: 12,
    mpCost: 100,
    maxRange: 500,
    segmentCount: 5,
    segmentWidth: 48,
    segmentHeight: 64,
    segmentGap: 8,
    segmentSpacing: 56, // 旧回退口径 = width(48) + gap(8)
    duration: 5,
    spawnDelayMs: 500,
    chillRadius: 0,
    chillStacks: 1,
    chillIntervalMs: 1000,
    chillSlowPercent: 0.05,
    chillDurationMs: 3000,
    hitKnockback: 0,
    pushDistanceMul: 1,
    damageBase: 0,
    damageIntMul: 0,
    damageWisMul: 0,
};

// 碎裂音效节流（同一堵墙各段同帧碎裂只播一次）
let _shatterSoundCd = 0;

/**
 * 冰墙技能系统（2026-08-02 新增；同日加碰撞与碎裂）
 *
 * 在鼠标/目标位置生成一列垂直于施法方向的冰墙障碍物：
 * - 碰撞：每段往 WallSystem.isoSegments 动态注册一条碰撞线段（门闸同款 push/splice），
 *   挡单位移动（MovementSystem/玩家 resolve 通道）+ 挡投射物（Projectile.blocked /
 *   BoltSkillSystem.resolve 通道），到期 splice；
 *   [PERF-2026-08-03] 注意：冰墙只改 isoSegments，不进 A* 网格（网格只建模 walls/trees，
 *   门闸/冰墙有意排除）——**不得**再调 pathFinder.invalidateCache()，那是纯开销零收益；
 * - 生成瞬间沿墙面法向弹开落点上的单位（敌人 knockback 通道，玩家直接位移——
 *   玩家 applyKnockback 无消费方）；
 * - 到期碎裂：冰屑四散 + 冰雾 + 地面冲击环（参考冰锥 onImpact 两层结构）。
 */
export class IceWallSystem {
    constructor(source) {
        this.source = source;
        // 当前存活的冰墙段：{ x, y, angle, width, height, duration, remaining, age, spawnDelay, variant, _colSeg }
        this._walls = [];
        // 待生成队列：施法释放后延迟 spawnDelayMs 毫秒才真正成墙 { src, aimX, aimY, effect, timer }
        this._pendingSpawns = [];
        // 寒冷光环（整组墙共享一个节拍：同一目标每秒只叠一次，防多段重叠叠层爆炸）
        this._chillTimer = 0;
        this._chillRadius = 0;
        this._chillStacks = 1;
        this._chillIntervalMs = 1000;
        this._chillSlowPercent = ICE_WALL_DEFAULTS.chillSlowPercent;
        this._chillDurationMs = ICE_WALL_DEFAULTS.chillDurationMs;
        // 链式强化伤害加成（本次施法消费的层数对应倍率，_spawnWall 落点伤害乘算）
        this._chainDamageMul = 0;
    }

    _isPlayer() {
        return this.source && this.source._faction === 'player';
    }

    /** 外部渲染层读取当前冰墙列表 */
    getWalls() {
        return this._walls;
    }

    trigger() {
        const src = this.source;
        if (!src || (!isSkillCheatEnabled() && src._iceWallCooldown > 0)) return;
        const skill = src.skills && src.skills.iceWall;
        if (!skill) return;
        // 中级魔法门槛：需装备法杖才能释放（快捷栏灰化由 quick-bar 同步显示）
        if (this._isPlayer()) {
            const req = meetsMagicWeaponReq(src, 'iceWall');
            if (!req.ok) {
                if (SceneManager && typeof SceneManager.showTopNotification === 'function') {
                    SceneManager.showTopNotification(req.reason);
                }
                return;
            }
        }
        const baseEffect = skill.getEffect(skill.level);
        // 配置唯一真相：默认值集中收敛于 ICE_WALL_DEFAULTS，代码不再散落魔法数字
        const effect = { ...ICE_WALL_DEFAULTS, ...baseEffect };

        // 瞄准点：玩家用鼠标，非玩家用当前目标
        let aimX = src.x, aimY = src.y;
        if (this._isPlayer()) {
            const aim = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
            aimX = aim.x;
            aimY = aim.y;
        } else if (src.target && src.target.active) {
            aimX = src.target.x;
            aimY = src.target.y;
        }

        // 施法距离判定
        const ce = getCurrentWeaponCraftEffects(src);
        const rangeMul = getMagicRangeMultiplier(src, ce);
        const maxRange = effect.maxRange * rangeMul;
        const dist = Math.hypot(aimX - src.x, aimY - src.y);
        if (dist > maxRange) {
            if (this._isPlayer() && SceneManager && typeof SceneManager.showTopNotification === 'function') {
                SceneManager.showTopNotification('🧱 超出施法距离！');
            }
            return;
        }

        // 先按"含链式减免的 MP 成本"做门禁：读层数但不消费——施法失败不丢链式层数
        const chainStacks = src._chainSpellStacks || 0;
        const mpMul = getMagicMpCostMultiplier(src, ce, chainStacks);
        const mpCost = baseEffect.mpCost ? Math.max(0, Math.floor(baseEffect.mpCost * mpMul)) : 0;
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0 && src.data.mp < mpCost) {
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 30, '魔法不足！', '#ffd27a'));
            return;
        }
        // 门禁通过：正式消费链式强化并扣蓝（与 bolt-skill-system 同口径：施法成功才消耗）
        const chain = consumeChainSpellBonus(src);
        if (!isSkillCheatEnabled() && this._isPlayer() && mpCost > 0) src.data.mp -= mpCost;
        this._chainDamageMul = chain.damageMul || 0;
        effect.mpCost = mpCost;
        effect.cooldown = effect.cooldown * getMagicCooldownMultiplier(src, ce);

        if (!isSkillCheatEnabled()) src._iceWallCooldown = effect.cooldown * 1000;

        // 施法音效：释放技能（按键确认、消耗扣除）瞬间播放，不等施法动画释放帧
        const castSound = skillsData.skills?.iceWall?.sounds?.cast;
        if (castSound && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(castSound);
        }

        const doRelease = () => {
            // 冰墙生成延迟（spawnDelayMs）：破土前有一个凝聚过程
            const delayMs = effect.spawnDelayMs;
            if (delayMs > 0) {
                this._pendingSpawns.push({ src, aimX, aimY, effect, timer: delayMs });
            } else {
                this._spawnWall(src, aimX, aimY, effect);
            }
            EffectManager.add(new FloatingTextEffect(src.x, src.y - 40, '🧱 冰墙', '#a0d8ff'));
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

    /** 生成垂直于施法方向的冰墙段（含碰撞注册 + 落点单位弹开） */
    _spawnWall(src, aimX, aimY, effect) {
        const count = effect.segmentCount;
        const width = effect.segmentWidth;
        const height = effect.segmentHeight;
        // 段心距：segmentSpacing 由配置驱动（段间视觉可重叠）
        const spacing = effect.segmentSpacing;
        const duration = effect.duration * 1000;
        // 寒冷光环配置随本次施法登记（整组墙共享）
        this._chillRadius = effect.chillRadius;
        this._chillStacks = effect.chillStacks;
        this._chillIntervalMs = effect.chillIntervalMs;
        this._chillSlowPercent = effect.chillSlowPercent;
        this._chillDurationMs = effect.chillDurationMs;

        const aimAngle = Math.atan2(aimY - src.y, aimX - src.x);
        const perpAngle = aimAngle + Math.PI / 2;
        const perpX = Math.cos(perpAngle), perpY = Math.sin(perpAngle);
        // 墙面法向（= 施法指向）：弹开单位时沿法向推向两侧
        const normalX = Math.cos(aimAngle), normalY = Math.sin(aimAngle);

        const totalLen = (count - 1) * spacing;
        const startX = aimX - perpX * totalLen / 2;
        const startY = aimY - perpY * totalLen / 2;

        const center = (count - 1) / 2;
        const spawned = [];
        for (let i = 0; i < count; i++) {
            const wx = startX + perpX * spacing * i;
            const wy = startY + perpY * spacing * i;
            // 碰撞线段：沿墙向，两端各多探 2px 消除段间缝隙（门闸同款动态注册，到期 splice）
            const seg = {
                x1: wx - perpX * (spacing / 2 + 2), y1: wy - perpY * (spacing / 2 + 2),
                x2: wx + perpX * (spacing / 2 + 2), y2: wy + perpY * (spacing / 2 + 2),
                halfThick: 14, _iceWall: true, noVisual: true,
            };
            if (WallSystem && WallSystem.isoSegments) WallSystem.isoSegments.push(seg);
            this._walls.push({
                x: wx,
                y: wy,
                angle: aimAngle,
                width,
                height,
                duration,
                remaining: duration,
                // 渲染层专用：生长计时（ms，update 中累加）、中心向两端 stagger 延迟、
                // 贴图变体（0~3 = 渲染池索引；池 = segment_0/1/2/4，segment_3 宽矮四柱已剔除）
                age: 0,
                spawnDelay: Math.round(Math.abs(i - center) * 45),
                variant: Math.floor(Math.random() * 4),
                _colSeg: seg,
            });
            spawned.push({ x: wx, y: wy });
        }
        // 落点命中：物理伤害 + 击退 50px + 弹开（距离翻倍），返回命中/击杀数结算技能经验
        const { hits, kills } = this._applySpawnHit(spawned, perpX, perpY, normalX, normalY, spacing, effect);
        if (this._isPlayer() && (hits > 0 || kills > 0) && SkillManager && typeof SkillManager.addIceWallExp === 'function') {
            SkillManager.addIceWallExp(src, hits, kills);
        }
    }

    /** 目标集合：只影响敌对阵营——玩家施法→enemy/agent；敌方施法→player（NPC/同阵营不受影响） */
    _hostileTargets() {
        const game = (typeof window !== 'undefined') ? window.Game : null;
        if (!game) return [];
        const src = this.source;
        const out = [];
        // 玩家可能同时出现在 game.player 与 game.entities 中，Set 去重防同一目标被结算两次
        const seen = new Set();
        const consider = (e) => {
            if (!e || seen.has(e) || e === src || e.active === false || !e._faction) return;
            seen.add(e);
            if (src._faction === 'player') {
                if (e._faction === 'enemy' || e._faction === 'agent') out.push(e);
            } else if (e._faction === 'player') {
                out.push(e);
            }
        };
        if (game.player) consider(game.player);
        if (game.entities) game.entities.forEach(consider);
        return out;
    }

    /**
     * 生成瞬间落点命中：物理伤害（isMelee=true 走盾牌弹反通道）+ 击退 hitKnockback px
     * + 沿墙面法向弹开（pushDistanceMul 倍）；敌人走 knockback 通道，玩家直接位移
     * （玩家 knockback 无消费方）。返回 { hits, kills } 供技能经验结算。
     */
    _applySpawnHit(segs, perpX, perpY, normalX, normalY, spacing, effect) {
        const targets = this._hostileTargets();
        const d = this.source.data || {};
        // 伤害 = damageBase + 智力×damageIntMul + 精神×damageWisMul（公式见 skills.json，随等级解析）
        const damage = Math.floor(effect.damageBase
            + (d.int || 0) * effect.damageIntMul
            + (d.wis || 0) * effect.damageWisMul);
        // 链式强化伤害加成（消费了层数就必须吃到加成，与 bolt-skill-system 同口径）
        const chainMul = 1 + (this._chainDamageMul || 0);
        const kb = effect.hitKnockback;
        const pushMul = effect.pushDistanceMul;
        let hits = 0, kills = 0;
        for (const t of targets) {
            const r = (t.collisionRadius || t.groundRadius || 16);
            for (const s of segs) {
                const dx = t.x - s.x, dy = t.y - s.y;
                const along = dx * perpX + dy * perpY;    // 沿墙方向距离
                const across = dx * normalX + dy * normalY; // 法向距离
                if (Math.abs(along) < spacing / 2 + r && Math.abs(across) < 14 + r) {
                    const side = across >= 0 ? 1 : -1;
                    // 弹开距离 = (脱嵌余量 × pushDistanceMul) + 击退 50px
                    const pushDist = ((14 + r) - Math.abs(across) + 20) * pushMul + kb;
                    if (pushDist <= 0) break;
                    const wasAlive = t.hp > 0;
                    if (damage > 0 && typeof t.takeDamage === 'function') {
                        t.takeDamage(Math.max(1, Math.floor(damage * chainMul)), this.source, 'physical', true);
                        hits++;
                        if (wasAlive && t.hp <= 0 && !t._summoned) kills++;
                    }
                    if (t._faction === 'player') {
                        const res = WallSystem.resolve(t.x, t.y, t.x + normalX * side * pushDist, t.y + normalY * side * pushDist, r);
                        t.x = res.x; t.y = res.y;
                    } else if (typeof t.applyKnockback === 'function') {
                        t.applyKnockback(Math.atan2(normalY * side, normalX * side), pushDist);
                    }
                    break; // 一个单位只命中一次
                }
            }
        }
        return { hits, kills };
    }

    /**
     * 寒冷光环（整组墙共享节拍）：墙周 chillRadius 内敌方单位每 chillIntervalMs 叠 chillStacks 层。
     * 同一目标每秒只叠一次——多段墙半径重叠不再叠加爆炸（高等级段数膨胀只加覆盖面积，不加叠层速度）。
     */
    _applyChillAuraGroup() {
        if (!this._chillRadius || this._walls.length === 0) return;
        const targets = this._hostileTargets();
        for (const t of targets) {
            if (typeof t.applyChill !== 'function') continue;
            const r = (t.collisionRadius || t.groundRadius || 16);
            let inAura = false;
            for (const w of this._walls) {
                const dx = t.x - w.x, dy = t.y - w.y;
                if (Math.hypot(dx, dy) <= this._chillRadius + r) {
                    inAura = true;
                    break;
                }
            }
            if (inAura) t.applyChill(this._chillStacks, this._chillDurationMs, this._chillSlowPercent);
        }
    }

    /**
     * 房间/场景清理：移除全部碰撞段、清空存活墙与待生成队列（碎裂特效不再触发）。
     * 由战斗房 cleanupRoom 与场景切换调用——地牢 map 模式实体更新冻结，墙与 pending
     * 计时器会冻结在旧房间状态，不清理就会跨房间残留（视觉/寒冷光环/待生成幽灵碰撞）。
     */
    breakdown() {
        if (this._walls.length === 0 && this._pendingSpawns.length === 0) return;
        if (WallSystem && WallSystem.isoSegments) {
            for (const w of this._walls) {
                if (w._colSeg) {
                    const si = WallSystem.isoSegments.indexOf(w._colSeg);
                    if (si >= 0) WallSystem.isoSegments.splice(si, 1);
                }
            }
        }
        this._walls.length = 0;
        this._pendingSpawns.length = 0;
    }

    /** 玩家施法动作包装：播空手施法动画，第 8 帧触发 onRelease */
    _startPlayerCast(onRelease) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (scene && typeof scene.startPlayerCast === 'function') {
            scene.startPlayerCast({ onRelease });
        } else if (onRelease) {
            onRelease();
        }
    }

    update(dt) {
        if (this.source._iceWallCooldown > 0) {
            this.source._iceWallCooldown -= dt;
            if (this.source._iceWallCooldown < 0) this.source._iceWallCooldown = 0;
        }
        // 待生成队列：延迟到点且施法者仍存活才成墙
        for (let i = this._pendingSpawns.length - 1; i >= 0; i--) {
            const p = this._pendingSpawns[i];
            p.timer -= dt;
            if (p.timer <= 0) {
                this._pendingSpawns.splice(i, 1);
                if (p.src && p.src.active !== false) this._spawnWall(p.src, p.aimX, p.aimY, p.effect);
            }
        }
        for (let i = this._walls.length - 1; i >= 0; i--) {
            const w = this._walls[i];
            w.remaining -= dt;
            w.age = (w.age || 0) + dt;
            if (w.remaining <= 0) {
                this._shatter(w);
                if (w._colSeg && WallSystem && WallSystem.isoSegments) {
                    const si = WallSystem.isoSegments.indexOf(w._colSeg);
                    if (si >= 0) WallSystem.isoSegments.splice(si, 1);
                }
                this._walls.splice(i, 1);
                continue;
            }
        }
        // 寒冷光环（整组墙共享一个节拍：每帧只跑一次，防按段数倍速叠层）
        if (this._chillRadius && this._walls.length > 0) {
            this._chillTimer -= dt;
            if (this._chillTimer <= 0) {
                this._chillTimer = this._chillIntervalMs;
                this._applyChillAuraGroup();
            }
        }
    }

    /** 到期碎裂：大冰屑四散（重力下落）+ 冰雾 + 地面冲击环（参考冰锥 onImpact 两层结构） */
    _shatter(w) {
        const cx = w.x, cy = w.y - (w.height || 64) * 0.5;
        // 碎裂音效：skills.json iceWall.sounds.shatter，200ms 节流（同堵墙各段同帧碎裂只播一次）
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const shatterSound = skillsData.skills?.iceWall?.sounds?.shatter;
        if (shatterSound && now >= _shatterSoundCd && SoundManager && typeof SoundManager.playFile === 'function') {
            _shatterSoundCd = now + 200;
            SoundManager.playFile(shatterSound);
        }
        // 大冰屑：ice_shard 贴图（GameScene 已懒生成；burstParticles 对缺失贴图静默跳过兜底）
        burstParticles({
            texture: 'ice_shard', x: cx, y: cy, count: 14, jitter: 20,
            config: {
                speed: { min: 120, max: 340 },
                angle: { min: 0, max: 360 },
                gravityY: 620,
                scale: { min: 0.8, max: 1.6 },
                rotate: { min: -180, max: 180 },
                alpha: { start: 1, end: 0.5 },
                lifespan: { min: 450, max: 900 },
            },
            destroyAfterMs: 1000, depth: w.y + 2,
        });
        // 冰雾：同冰锥命中（impact_dot 白蓝 ADD）
        burstParticles({
            texture: 'impact_dot', x: cx, y: cy, count: 10, jitter: 14,
            config: {
                speed: { min: 60, max: 200 },
                scale: { start: 1.8, end: 0.2 },
                alpha: { start: 0.8, end: 0 },
                lifespan: { min: 350, max: 650 },
                gravityY: 160,
                tint: [0xffffff, 0xaaddff, 0x66aaff],
                blendMode: 'ADD',
            },
            destroyAfterMs: 800, depth: w.y + 62,
        });
        // 地面冲击环：同冰锥地面波
        fireGroundShockwave({
            x: w.x, y: w.y, maxRadius: 60,
            strokeColor: 0x9fd8ff, fillColor: 0xd8f0ff,
            lineWidth: 3, duration: 300, flicker: true,
        });
    }
}
