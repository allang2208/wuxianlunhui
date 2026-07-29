import { WallSystem } from '../../world/wall-system.js';
import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { loadImage } from '../../utils/image-loader.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { AimHelper } from '../../utils/aim-helper.js';
import { GroundCircle } from '../../physics/skill-shapes.js';
import { pointHitsTorso } from '../../physics/torso-hitbox.js';
import { burstParticles } from '../../effects/combat-fx.js';

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
        return entity._faction !== this.source._faction;
    }

    _getAimTarget() {
        if (this._isPlayer()) {
            return Renderer.screenToWorld(Input.mouse.x, Input.mouse.y);
        }
        const target = this.source.target;
        if (!target || !target.active) return null;
        const skill = this.source.skills && this.source.skills[this.kind.skillKey];
        const effect = skill ? skill.getEffect(skill.level) : {};
        const speed = effect.flySpeed || 1600;
        return AimHelper.lead(this.source.x, this.source.y, target.x, target.y, target.vx || 0, target.vy || 0, speed);
    }

    _spikes() { return this.source[this.kind.fields.spikes] || []; }

    trigger() {
        // 有飞行中的投射物，禁止再次操作
        if (this._spikes().some(s => s.flyActive)) return;
        // 已有悬浮投射物 → 发射
        if (this.source[this.kind.fields.active] && this._spikes().some(s => s.active && !s.launched)) {
            this._launchAll();
            return;
        }
        // 冷却检查
        if (this.source[this.kind.fields.cooldown] > 0) return;

        const skill = this.source.skills && this.source.skills[this.kind.skillKey];
        if (!skill) return;
        const effect = skill.getEffect(skill.level);

        // 玩家消耗魔法值；敌人不消耗
        if (this._isPlayer()) {
            if (this.source.data.mp < effect.mpCost) {
                EffectManager.add(new FloatingTextEffect(this.source.x, this.source.y - 30, '魔法不足！', this.kind.mpShortageColor));
                return;
            }
            this.source.data.mp -= effect.mpCost;
        }
        this._spawn(effect);
    }

    _spawn(effect) {
        const src = this.source;
        src[this.kind.fields.active] = true;
        src[this.kind.fields.timer] = 0;
        const projectiles = this.kind.makeProjectiles(effect);
        src[this.kind.fields.spikes] = projectiles;
        // 单投射物别名（GameScene 渲染兼容：如火球 source._fireball 指单颗对象）
        if (this.kind.fields.alias) src[this.kind.fields.alias] = projectiles[0] || null;
        // 贴图加载（GameScene 渲染用）
        if (this.kind.img && (!src[this.kind.img.field] || src[this.kind.img.field].naturalWidth === 0 || src[this.kind.img.field].src !== this.kind.img.src)) {
            src[this.kind.img.field] = loadImage(this.kind.img.src);
        }
        EffectManager.add(new FloatingTextEffect(src.x, src.y - 40, this.kind.spawnText(effect), this.kind.mpShortageColor));
    }

    _launchAll() {
        const spikes = this._spikes();
        if (spikes.length === 0) return;
        const target = this._getAimTarget();
        if (!target) return;
        const mx = target.x, my = target.y;
        const cos = Math.cos(this.source.rotation || 0);
        const sin = Math.sin(this.source.rotation || 0);
        spikes.forEach(spike => {
            if (!spike.active || spike.launched) return;
            spike.launched = true;
            spike.flyActive = true;
            spike.flyX = this.source.x + spike.offsetX * cos - spike.offsetY * sin;
            spike.flyY = this.source.y + spike.offsetX * sin + spike.offsetY * cos;
            spike.flyAngle = Math.atan2(my - spike.flyY, mx - spike.flyX);
        });
        this.source[this.kind.fields.timer] = 0;
    }

    update(dt, entities) {
        const src = this.source;
        const skill = src.skills && src.skills[this.kind.skillKey];
        const effect = skill ? skill.getEffect(skill.level) : {};
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
            const now = Date.now() / 1000;
            spikes.forEach(spike => {
                if (!spike.active || spike.launched) return;
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
        const effect = skill ? skill.getEffect(skill.level) : {};
        const d = src.data;
        const damage = Math.floor((effect.damageBase ?? 0) + (d.matk ?? 0) * (effect.magicMul ?? 0) + (d.int ?? 0) * (effect.intMul ?? 0));
        const entityList = Array.from(entities.values ? entities.values() : entities);

        this._spikes().forEach(spike => {
            if (!spike.flyActive) return;
            const cos = Math.cos(spike.flyAngle), sin = Math.sin(spike.flyAngle);
            const moveDist = spike.flySpeed * dtSec;
            const nextX = spike.flyX + cos * moveDist;
            const nextY = spike.flyY + sin * moveDist;
            spike.flyDistance += moveDist;

            // 最大飞行距离
            if (spike.flyDistance >= effect.maxRange) {
                this.kind.onMaxRange(this, spike, { entities: entityList, damage, effect, skill });
                spike.flyActive = false;
                spike.active = false;
                return;
            }
            // 墙壁碰撞
            const resolved = WallSystem.resolve(spike.flyX, spike.flyY, nextX, nextY, this.kind.wallRadius);
            const hitWall = Math.abs(resolved.x - nextX) > 1 || Math.abs(resolved.y - nextY) > 1;
            if (hitWall) {
                this.kind.onImpact(this, spike, { x: resolved.x, y: resolved.y, entities: entityList, damage, effect, skill });
                spike.flyActive = false;
                spike.active = false;
                return;
            }
            spike.flyX = resolved.x;
            spike.flyY = resolved.y;

            // 飞行尾迹（共享件 burstParticles）
            const trail = this.kind.trail;
            if (trail) {
                spike._trailTimer = (spike._trailTimer || 0) + dt;
                if (spike._trailTimer >= trail.intervalMs) {
                    spike._trailTimer = 0;
                    burstParticles({
                        texture: 'impact_dot',
                        x: spike.flyX - cos * trail.backOffset, y: spike.flyY - sin * trail.backOffset,
                        count: 1, config: trail.config,
                        destroyAfterMs: trail.destroyAfterMs, depth: spike.flyY + 14,
                    });
                }
            }

            // 目标碰撞（地面 footprint ∪ 躯干矩形）
            // 注意：不在命中后 break——原冰锥在同一帧可对多个重叠目标结算（准穿透），
            // 投射物 active/flyActive 由 kind.onImpact 自行处置（火球=爆炸一次，冰锥=逐目标结算）
            const hitShape = new GroundCircle(spike.flyX, spike.flyY, this.kind.hitRadius);
            for (const entity of entityList) {
                if (!this._isHostile(entity) || !entity.active || !entity.hittable) continue;
                if (!hitShape.intersectsEntity(entity) && !pointHitsTorso(entity, spike.flyX, spike.flyY, this.kind.hitRadius)) continue;
                this.kind.onImpact(this, spike, { x: spike.flyX, y: spike.flyY, entities: entityList, damage, effect, skill, hitEntity: entity });
            }
        });
    }

    /** 范围爆炸结算（火球 kind 用；本类提供，避免各 kind 重写） */
    _explodeAoE(x, y, damage, radius, entityList, skill) {
        let hitCount = 0;
        let killCount = 0;
        const explosionShape = new GroundCircle(x, y, radius);
        entityList.forEach(entity => {
            if (!this._isHostile(entity) || !entity.active || !entity.hittable) return;
            if (!explosionShape.intersectsEntity(entity)) return;
            const wasAlive = entity.hp > 0;
            // 距离衰减：距离中心越近伤害越高
            const dist = Math.sqrt((entity.x - x) ** 2 + (entity.y - y) ** 2);
            const distRatio = 1 - Math.min(dist / radius, 1);
            const finalDamage = Math.floor(damage * (0.5 + 0.5 * distRatio));
            entity.takeDamage(finalDamage, this.source, 'magic');
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
        const skill = src.skills && src.skills[this.kind.skillKey];
        const effect = skill ? skill.getEffect(skill.level) : {};
        src[this.kind.fields.active] = false;
        src[this.kind.fields.timer] = 0;
        src[this.kind.fields.spikes] = this.kind.fields.spikesArrayEmptyIsNull ? null : [];
        if (this.kind.fields.alias) src[this.kind.fields.alias] = null;
        src[this.kind.fields.cooldown] = effect.cooldown * 1000;
    }
}
