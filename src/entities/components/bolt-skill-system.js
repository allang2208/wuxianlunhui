import { WallSystem } from '../../world/wall-system.js';
import { nowMs } from '../player/anim-state.js';
import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { loadImage } from '../../utils/image-loader.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { AimHelper } from '../../utils/aim-helper.js';
import { GroundCircle } from '../../physics/skill-shapes.js';
import {
    entitySurfaceZ,
    effectElevationIntersectsEntity,
    surfaceEffectAtPoint,
    surfaceEffectFromEntity,
    volumeEffectContext,
} from '../../physics/elevation.js';
import { pointHitsTorso } from '../../physics/torso-hitbox.js';
import {
    burstParticles,
    resolveSkillEffectDepth,
    snapshotSkillEffectDepthContext,
} from '../../effects/combat-fx.js';
import {
    getCurrentWeaponCraftEffects,
    getMagicRangeMultiplier,
    getMagicMpCostMultiplier,
    getMagicCooldownMultiplier,
    getMagicDamageMultiplierWithChain,
    createMagicCastContext,
    consumeChainSpellBonus,
    addChainSpellStack,
    applyCastHaste,
} from '../../utils/magic-craft-helper.js';
import { getSkillMagicCategory } from '../../config/magic-categories.js';
import { isSkillCheatEnabled } from '../../config/dev-cheats.js';
import {
    applyProjectileWallImpact,
    canUseWallTopModelException,
    projectileSourceZ,
    projectileTargetZ,
    projectileWallContext,
    wallHitSupportsTarget,
} from '../../combat/elevated-ranged.js';

/**
 * 法系投射物技能系统基类（2026-07-28：FireballSystem/IceSpikeSystem ~90% 雷同合并）
 *
 * 通用流程（两技能一致）：凝聚悬浮（摇摆/帧动画）→ 二次触发或超时 → 发射 → 直线飞行
 * （AimHelper.lead 预判 / WallSystem.resolve 撞墙 / GroundCircle∪躯干矩形命中）→ 命中结算。
 * 差异全部由 kind 配置驱动：
 * - fields：施法者身上的状态字段名（GameScene/快捷栏按现有字段读取，不可改）
 * - makeProjectiles(effect)：投射物状态对象数组（火球 1 颗 / 冰锥 N 颗扇形）
 * - anim：悬浮/飞行帧动画（仅火球 73 帧贴图）；sway 字段在 makeProjectiles 自带
 * - trail：飞行尾迹（burstParticles 参数与间隔）
 * - onImpact(spike, ctx)：命中结算（火球=范围爆炸+距离衰减 / 冰锥=单体碎裂）
 * - onMaxRange(spike, ctx)：到达最大射程（火球=原地爆炸 / 冰锥=静默消失）
 */

/** 通用 kind 工厂（各文件在自己模块里定义字面量传入） */
export class BoltSkillSystem {
    constructor(source, kind, options = {}) {
        this.source = source;
        this.kind = kind;
        this.options = options;
    }

    _isPlayer() {
        return this.source && this.source._faction === 'player';
    }

    _isHostile(entity) {
        if (!entity || entity === this.source) return false;
        // 阵营分组：player/companion 互为友军，共同敌视 enemy/agent；
        // enemy 与 agent 分属敌对阵营，各自不伤同阵营单位。
        const sf = this.source._faction;
        const ef = entity._faction;
        if (sf === 'enemy') return ef !== 'enemy';
        if (sf === 'agent') return ef !== 'agent';
        return ef === 'enemy' || ef === 'agent';
    }

    _isMagic() {
        return !!getSkillMagicCategory(this.kind.skillKey);
    }

    /** 获取经改造效果修正后的 effect（MP/冷却/距离/伤害倍率均按当前武器改造计算） */
    _getEffect() {
        const skill = this.source.skills && this.source.skills[this.kind.skillKey];
        const base = skill ? skill.getEffect(skill.level) : {};
        // 配置唯一真相：kind.defaults 集中收敛缺省兜底（skills.json effectFormula 必有）
        if (!this._isMagic()) return { ...(this.kind.defaults || {}), ...base };

        const ce = getCurrentWeaponCraftEffects(this.source);
        const effect = { ...(this.kind.defaults || {}), ...base };
        // 链式层数读当前真实值（consume 前的 _chainSpellStacks）：MP 折扣与本次实际消费的层数对齐，
        // 不再沿用上一 cast 缓存的消费值（否则折扣滞后一 cast）
        const chainStacks = (this.source && this.source._chainSpellStacks) || 0;

        // MP 消耗
        const mpMul = getMagicMpCostMultiplier(this.source, ce, chainStacks);
        if (effect.mpCost) effect.mpCost = Math.max(0, Math.floor(effect.mpCost * mpMul));

        // 冷却
        const cdMul = getMagicCooldownMultiplier(this.source, ce);
        if (effect.cooldown) effect.cooldown *= cdMul;
        const sourceCdMul = Number(this.source?.getSkillCooldownMultiplier?.(this.kind.skillKey));
        if (effect.cooldown && Number.isFinite(sourceCdMul)) effect.cooldown *= Math.max(0, sourceCdMul);

        // 距离
        const rangeMul = getMagicRangeMultiplier(this.source, ce);
        if (effect.maxRange) effect.maxRange *= rangeMul;

        // 杖头改造：冰锥数量 / 火球爆炸半径
        if (this.kind.skillKey === 'iceSpike' && ce && ce.iceSpikeCountDelta) {
            effect.spikeCount = effect.spikeCount + ce.iceSpikeCountDelta;
        }
        if (this.kind.skillKey === 'fireball' && ce && ce.fireballExplosionRadiusPercent) {
            effect.explosionRadius = effect.explosionRadius * (1 + ce.fireballExplosionRadiusPercent);
        }

        return effect;
    }

    _getAimTarget() {
        if (this._isPlayer()) {
            const aim = Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
            if (!aim) return null;
            const surfaceContext = surfaceEffectAtPoint(aim.x, aim.y);
            return {
                x: surfaceContext.x,
                y: surfaceContext.y,
                targetZ: projectileTargetZ({ z: surfaceContext.z }),
                surfaceContext,
            };
        }
        const target = this.source.target;
        if (!target || !target.active) return null;
        const skill = this.source.skills && this.source.skills[this.kind.skillKey];
        const base = skill ? skill.getEffect(skill.level) : {};
        const effect = { ...(this.kind.defaults || {}), ...base };
        const speed = effect.flySpeed;
        const lead = AimHelper.lead(this.source.x, this.source.y, target.x, target.y, target.vx || 0, target.vy || 0, speed);
        return {
            ...lead,
            targetZ: projectileTargetZ(target),
            surfaceContext: surfaceEffectFromEntity(target),
        };
    }

    _spikes() { return this.source[this.kind.fields.spikes] || []; }

    trigger() {
        // 有飞行中的投射物，禁止再次操作
        if (this._spikes().some(s => s.flyActive)) return;
        // 已有悬浮投射物 → 发射
        if (this.source[this.kind.fields.active] && this._spikes().some(s => s.active && !s.launched)) {
            // 玩家二段发射走施法动画（空手施法第 8 帧真正发射）；敌人直接发射
            if (this._isPlayer()) {
                this._startPlayerCast(() => this._launchAll());
            } else {
                this._launchAll();
            }
            return;
        }

        // 冷却检查（使用改造后冷却）
        if (!isSkillCheatEnabled() && this.source[this.kind.fields.cooldown] > 0) return;

        const effect = this._getEffect();
        this._castCooldownMs = (effect.cooldown || 0) * 1000;

        // 玩家消耗魔法值；敌人不消耗
        if (this._isPlayer()) {
            if (!isSkillCheatEnabled() && this.source.data.mp < effect.mpCost) {
                EffectManager.add(new FloatingTextEffect(
                    this.source.x,
                    this.source.y - entitySurfaceZ(this.source) - 30,
                    '魔法不足！',
                    this.kind.mpShortageColor
                ));
                return;
            }
            if (!isSkillCheatEnabled()) this.source.data.mp -= effect.mpCost;
        }

        // 链式强化：在 MP 扣除成功后消费已有层数（伤害/MP 加成计入本次施法）
        if (this._isMagic()) {
            const chain = consumeChainSpellBonus(this.source);
            // 重新计算并缓存本次施法伤害倍率
            const ce = getCurrentWeaponCraftEffects(this.source);
            this._castContext = createMagicCastContext(this.source, ce);
            this._magicDamageMul = getMagicDamageMultiplierWithChain(this.source, this.kind.skillKey, ce, chain.stacks);
        }

        this._spawn(effect);
    }

    _spawn(effect) {
        const src = this.source;
        src[this.kind.fields.active] = true;
        src[this.kind.fields.timer] = 0;
        const projectiles = this.kind.makeProjectiles(effect, src);
        src[this.kind.fields.spikes] = projectiles;
        // 单投射物别名（GameScene 渲染兼容：如火球 source._fireball 指单颗对象）
        if (this.kind.fields.alias) src[this.kind.fields.alias] = projectiles[0] || null;
        // 贴图加载（GameScene 渲染用）
        if (this.kind.img && (!src[this.kind.img.field] || src[this.kind.img.field].naturalWidth === 0 || src[this.kind.img.field].src !== this.kind.img.src)) {
            src[this.kind.img.field] = loadImage(this.kind.img.src);
        }
        EffectManager.add(new FloatingTextEffect(
            src.x,
            src.y - entitySurfaceZ(src) - 40,
            this.kind.spawnText(effect),
            this.kind.mpShortageColor
        ));
    }

    /** 玩家施法动作包装：播空手施法动画，第 8 帧触发 onRelease（魔法实际结算/发射） */
    _startPlayerCast(onRelease) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (scene && typeof scene.startPlayerCast === 'function') {
            scene.startPlayerCast({ onRelease });
        } else if (onRelease) {
            onRelease();
        }
    }

    _launchAll() {
        const spikes = this._spikes();
        if (spikes.length === 0) return;
        const target = this._getAimTarget();
        if (!target) return;
        const launchEffect = this._getEffect();
        const mx = target.x, my = target.y;
        const cos = Math.cos(this.source.rotation || 0);
        const sin = Math.sin(this.source.rotation || 0);
        spikes.forEach(spike => {
            if (!spike.active || spike.launched) return;
            spike.launched = true;
            spike.flyActive = true;
            // 发射起点 = 当前环绕位置（轨道角 → 椭圆坐标 → 随施法者朝向旋转）
            const oa = spike.orbitAngle || 0;
            const ox = Math.cos(oa) * (spike.orbitRx || 50);
            const oy = Math.sin(oa) * (spike.orbitRy || 30);
            spike.flyX = this.source.x + ox * cos - oy * sin;
            spike.flyY = this.source.y + ox * sin + oy * cos;
            spike.flyAngle = Math.atan2(my - spike.flyY, mx - spike.flyX);
            // 瞄准目标点：所有投射物精确汇聚于此（到达即结算，不再穿过准星继续飞）
            spike.tx = mx;
            spike.ty = my;
            spike.targetDist = Math.hypot(mx - spike.flyX, my - spike.flyY);
            spike.flyZ = projectileSourceZ(this.source);
            spike.targetZ = Number.isFinite(Number(target.targetZ)) ? Number(target.targetZ) : 24;
            spike.targetSurfaceContext = target.surfaceContext || surfaceEffectAtPoint(mx, my);
            spike.flyVz = (spike.targetZ - spike.flyZ)
                / Math.max(0.001, spike.targetDist / Math.max(1, spike.flySpeed));
            spike.maxRange = launchEffect.maxRange;
            spike.wallContext = projectileWallContext(this.source, null, {
                x: spike.flyX,
                y: spike.flyY,
                z: spike.flyZ,
            });
            spike.renderDepthContext = snapshotSkillEffectDepthContext(this.source);
        });
        this.source[this.kind.fields.timer] = 0;
    }

    update(dt, entities) {
        const src = this.source;
        const effect = this._getEffect();
        if (src[this.kind.fields.active]) {
            src[this.kind.fields.timer] += dt;
            const spikes = this._spikes();
            const hasUnlaunched = spikes.some(s => s.active && !s.launched);
            // 悬浮超时强制结束
            if (hasUnlaunched && src[this.kind.fields.timer] >= effect.duration * 1000) {
                this._end(true);
                return;
            }
            // 悬浮动画（摇摆相位 / 帧动画）
            const now = nowMs() / 1000; // Phase 3：单调时钟（仅作摇摆相位）
            spikes.forEach(spike => {
                if (!spike.active || spike.launched) return;
                // 发射前待机：推进椭圆环绕角（绕施法者圆柱体转圈）
                spike.orbitAngle = (spike.orbitAngle || 0) + dt * (spike.orbitSpeed || 0.0015);
                if (this.kind.anim) {
                    spike.animTimer = (spike.animTimer || 0) + dt;
                    spike.frameIndex = Math.floor(spike.animTimer / this.kind.anim.hoverMs) % this.kind.anim.totalFrames;
                } else {
                    spike.swayTimer = now + spike.id * 0.5;
                }
            });
            // 飞行帧动画（仅火球：更快的帧率）
            if (this.kind.anim) {
                spikes.forEach(spike => {
                    if (!spike.flyActive) return;
                    spike.animTimer = (spike.animTimer || 0) + dt;
                    spike.frameIndex = Math.floor(spike.animTimer / this.kind.anim.flyMs) % this.kind.anim.totalFrames;
                });
            }
        }
        // 飞行推进
        this._updateFlying(dt, entities);
        // 全部结束
        const spikes = this._spikes();
        const hasFlying = spikes.some(s => s.flyActive);
        const hasUnlaunched = spikes.some(s => s.active && !s.launched);
        if (!hasUnlaunched && !hasFlying && spikes.length > 0) {
            this._end(false);
        }
    }

    _updateFlying(dt, entities) {
        const dtSec = dt / 1000;
        const src = this.source;
        const skill = src.skills && src.skills[this.kind.skillKey];
        const effect = this._getEffect();
        const d = this._castContext?.stats || src.data;
        const baseDamage = Math.floor((effect.damageBase ?? 0) + (d.matk ?? 0) * (effect.magicMul ?? 0) + (d.int ?? 0) * (effect.intMul ?? 0));
        const damageMul = this._magicDamageMul || 1;
        const damage = Math.floor(baseDamage * damageMul);
        const entityList = Array.from(entities.values ? entities.values() : entities);

        this._spikes().forEach(spike => {
            if (!spike.flyActive) return;
            const cos = Math.cos(spike.flyAngle), sin = Math.sin(spike.flyAngle);
            const moveDist = spike.flySpeed * dtSec;
            const previousDistance = Number(spike.flyDistance) || 0;
            const proposedDistance = previousDistance + moveDist;
            const nextX = spike.flyX + cos * moveDist;
            const nextY = spike.flyY + sin * moveDist;
            const nextZ = (Number(spike.flyZ) || 0) + (Number(spike.flyVz) || 0) * dtSec;
            const maxRange = Number(spike.maxRange) || effect.maxRange;
            const targetDist = Number(spike.targetDist);
            const reachesTargetFirst = spike.targetDist != null
                && Number.isFinite(targetDist)
                && targetDist <= maxRange;
            const terminalDistance = reachesTargetFirst ? targetDist : maxRange;
            const wallContext = spike.wallContext || projectileWallContext(this.source);
            const segmentWallHit = (endX, endY, endZ) => WallSystem.projectileWallHit
                ? WallSystem.projectileWallHit(
                    spike.flyX, spike.flyY, Number(spike.flyZ) || 0,
                    endX, endY, endZ,
                    wallContext
                )
                : (WallSystem.blocked(spike.flyX, spike.flyY, endX, endY)
                    ? { wall: null, owner: null, x: spike.flyX, y: spike.flyY, z: spike.flyZ }
                    : null);

            // 本帧会到达目标或射程终点时，先把线段夹到真实终点并做墙碰撞。
            // 终点结算必须排在墙检测之后，不能让最后一帧跨墙命中。
            if (proposedDistance >= terminalDistance) {
                const travel = Math.max(0, terminalDistance - previousDistance);
                const ratio = moveDist > 0 ? Math.min(1, travel / moveDist) : 0;
                const endX = reachesTargetFirst ? spike.tx : spike.flyX + cos * travel;
                const endY = reachesTargetFirst ? spike.ty : spike.flyY + sin * travel;
                const endZ = reachesTargetFirst
                    ? spike.targetZ
                    : (Number(spike.flyZ) || 0) + (Number(spike.flyVz) || 0) * dtSec * ratio;
                const terminalWallHit = segmentWallHit(endX, endY, endZ);
                const terminalElevation = volumeEffectContext(endZ, this.kind.hitRadius);
                const terminalModelTarget = terminalWallHit && canUseWallTopModelException(this.source)
                    ? entityList.find(entity => this._isHostile(entity)
                        && entity.active
                        && entity.hittable
                        && entity._surfaceKind === 'wall_walk'
                        && wallHitSupportsTarget(terminalWallHit, entity)
                        && effectElevationIntersectsEntity(terminalElevation, entity)
                        && pointHitsTorso(entity, endX, endY, this.kind.hitRadius))
                    : null;
                const targetModelHitThroughSupport = !!terminalModelTarget;
                if (terminalWallHit && !targetModelHitThroughSupport) {
                    applyProjectileWallImpact(this.source, terminalWallHit, damage, 'magic');
                    const surfaceContext = surfaceEffectAtPoint(spike.flyX, spike.flyY, { impactZ: spike.flyZ });
                    this.kind.onImpact(this, spike, { x: spike.flyX, y: spike.flyY, entities: entityList, damage, effect, skill, surfaceContext });
                } else {
                    spike.flyX = endX;
                    spike.flyY = endY;
                    spike.flyZ = endZ;
                    spike.flyDistance = terminalDistance;
                    if (reachesTargetFirst) {
                        const surfaceContext = spike.targetSurfaceContext
                            || surfaceEffectAtPoint(endX, endY, { impactZ: endZ });
                        this.kind.onImpact(this, spike, { x: endX, y: endY, entities: entityList, damage, effect, skill, surfaceContext });
                    } else {
                        const surfaceContext = surfaceEffectAtPoint(endX, endY, { impactZ: endZ });
                        this.kind.onMaxRange(this, spike, { entities: entityList, damage, effect, skill, surfaceContext });
                    }
                }
                spike.flyActive = false;
                spike.active = false;
                return;
            }

            const hitWall = segmentWallHit(nextX, nextY, nextZ);
            if (hitWall) {
                applyProjectileWallImpact(this.source, hitWall, damage, 'magic');
                const surfaceContext = surfaceEffectAtPoint(spike.flyX, spike.flyY, { impactZ: spike.flyZ });
                this.kind.onImpact(this, spike, { x: spike.flyX, y: spike.flyY, entities: entityList, damage, effect, skill, surfaceContext });
                spike.flyActive = false;
                spike.active = false;
                return;
            }
            spike.flyX = nextX;
            spike.flyY = nextY;
            spike.flyZ = nextZ;
            spike.flyDistance = proposedDistance;

            // 飞行尾迹（共享件 burstParticles）
            const trail = this.kind.trail;
            if (trail) {
                spike._trailTimer = (spike._trailTimer || 0) + dt;
                if (spike._trailTimer >= trail.intervalMs) {
                    spike._trailTimer = 0;
                    const trailDepth = resolveSkillEffectDepth({
                        source: src,
                        groundY: spike.flyY,
                        context: spike.renderDepthContext,
                        groundOffset: 14,
                        preferSourceDepth: false,
                    });
                    burstParticles({
                        texture: 'impact_dot',
                        x: spike.flyX - cos * trail.backOffset,
                        y: spike.flyY - (Number(spike.flyZ) || 0) - sin * trail.backOffset,
                        count: 1, config: trail.config,
                        destroyAfterMs: trail.destroyAfterMs,
                        depth: trailDepth,
                    });
                }
            }

            // 目标碰撞（地面 footprint ∪ 躯干矩形）
            // 注意：不在命中后 break——原冰锥在同一帧可对多个重叠目标结算（准穿透），
            // 投射物 active/flyActive 由 kind.onImpact 自行处置（火球=爆炸一次，冰锥=逐目标结算）
            const hitElevation = volumeEffectContext(spike.flyZ, this.kind.hitRadius);
            const hitShape = new GroundCircle(spike.flyX, spike.flyY, this.kind.hitRadius, hitElevation);
            for (const entity of entityList) {
                if (!this._isHostile(entity) || !entity.active || !entity.hittable) continue;
                if (!effectElevationIntersectsEntity(hitElevation, entity)) continue;
                if (!hitShape.intersectsEntity(entity) && !pointHitsTorso(entity, spike.flyX, spike.flyY, this.kind.hitRadius)) continue;
                const surfaceContext = surfaceEffectFromEntity(entity);
                this.kind.onImpact(this, spike, { x: spike.flyX, y: spike.flyY, entities: entityList, damage, effect, skill, hitEntity: entity, surfaceContext });
            }
        });
    }

    /** 范围爆炸结算（火球 kind 用；本类提供，避免各 kind 重写） */
    _explodeAoE(x, y, damage, radius, entityList, skill, surfaceContext = null) {
        let hitCount = 0;
        let killCount = 0;
        const explosionShape = new GroundCircle(
            x,
            y,
            radius,
            surfaceContext || surfaceEffectAtPoint(x, y, { impactZ: 0 })
        );
        const ce = this._castContext?.craftEffects || getCurrentWeaponCraftEffects(this.source);
        const burnMul = ce && ce.fireBurnDamageMul;
        const burnDuration = (ce && ce.fireBurnDuration) || 3000;
        const burnTickMs = (ce && ce.fireBurnTickMs) || 500;
        entityList.forEach(entity => {
            if (!this._isHostile(entity) || !entity.active || !entity.hittable) return;
            if (!explosionShape.intersectsEntity(entity)) return;
            const wasAlive = entity.hp > 0;
            // 距离衰减：距离中心越近伤害越高
            const dist = Math.sqrt((entity.x - x) ** 2 + (entity.y - y) ** 2);
            const distRatio = 1 - Math.min(dist / radius, 1);
            const finalDamage = Math.floor(damage * (0.5 + 0.5 * distRatio));
            entity.takeDamage(finalDamage, this.source, 'magic', false, this._castContext);
            // 烈焰吊坠：火系魔法造成伤害附加灼伤
            if (burnMul && typeof entity.applyBurn === 'function') {
                entity.applyBurn(this.source, 1, burnDuration, burnMul, burnTickMs);
            }
            hitCount++;
            if (wasAlive && entity.hp <= 0 && !entity._summoned) killCount++;
        });
        if (hitCount > 0 && skill && this._isPlayer()) {
            this.kind.addSkillExp(this.source, hitCount, killCount);
        }
    }

    _end(forced) {
        const src = this.source;
        if (forced) {
            this._spikes().forEach(s => {
                if (s.active && !s.launched) s.active = false;
            });
        }
        if (this._spikes().some(s => s.flyActive)) return;
        const effect = this._getEffect();
        src[this.kind.fields.active] = false;
        src[this.kind.fields.timer] = 0;
        src[this.kind.fields.spikes] = this.kind.fields.spikesArrayEmptyIsNull ? null : [];
        if (this.kind.fields.alias) src[this.kind.fields.alias] = null;
        // 冷却在第一次施法时已按当时法杖/法袍快照结算，飞行途中切武器不再二次乘算。
        src[this.kind.fields.cooldown] = Number.isFinite(this._castCooldownMs)
            ? this._castCooldownMs
            : effect.cooldown * 1000;
        // 松木握柄：本次施法结束后添加 1 层链式强化；檀木握柄：施法后给自身加速
        if (this._isMagic()) {
            addChainSpellStack(src, this._castContext?.craftEffects);
            applyCastHaste(src, this._castContext?.craftEffects);
        }
        // 清本次施法缓存
        this._magicDamageMul = 1;
        this._castContext = null;
        this._castCooldownMs = null;
    }
}
