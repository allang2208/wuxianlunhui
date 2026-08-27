import { nowMs } from '../player/anim-state.js';
import { getPlayerAnimDurationMs } from '../../config/player-anim.js';
import { WeaponAnimConfig } from '../../items/weapon-anim-config.js';
import { Game } from '../../game.js';
import { WallSystem } from '../../world/wall-system.js';
import { AttackRangeEffect } from '../../effects/attack-range-effect.js';
import { NightFlameBeamEffect } from '../../effects/nightflame-effect.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { VerticalRect } from '../../physics/skill-shapes.js';
import { entitySurfaceZ, surfaceEffectFromEntity } from '../../physics/elevation.js';
class SpecialAttackSystem {
    constructor(player) {
        this.player = player;
    }

    _resolveBeamOrigin() {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const tip = scene?.getPlayerWeaponTipWorld?.();
        if (Number.isFinite(tip?.x) && Number.isFinite(tip?.y)) return tip;
        if (Number.isFinite(this.player._specialAttackOriginX)
            && Number.isFinite(this.player._specialAttackOriginY)) {
            return { x: this.player._specialAttackOriginX, y: this.player._specialAttackOriginY };
        }
        // Phaser 视觉尚未就绪时的安全回退；正常游戏帧始终以上面的真实剑尖为准。
        const angle = Number(this.player._specialAttackLockedAngle) || 0;
        const distance = Math.max(90, (Number(this.player.size) || 30) + 80);
        return {
            x: this.player.x + Math.cos(angle) * distance,
            y: this.player.y + Math.sin(angle) * distance,
        };
    }

    _syncBeamOrigin() {
        const origin = this._resolveBeamOrigin();
        this.player._specialAttackOriginX = origin.x;
        this.player._specialAttackOriginY = origin.y;
        if (this.player._specialAttackBeam?.active) {
            this.player._specialAttackBeam.setOrigin?.(origin.x, origin.y);
        }
        if (this.player._specialAttackRangeEffect?.active) {
            this.player._specialAttackRangeEffect.setOrigin?.(origin.x, origin.y);
        }
        return origin;
    }

    _stopBeamEffects() {
        for (const effect of [
            this.player._specialAttackBeam,
            this.player._specialAttackRangeEffect,
        ]) {
            if (!effect?.active) continue;
            effect.life = 0;
            effect.update?.(0);
        }
        this.player._specialAttackBeam = null;
        this.player._specialAttackRangeEffect = null;
    }

    trigger(targetX, targetY, _entities) {
        const currentItem = this.player.equipments[this.player.weaponMode];
        if (!currentItem || currentItem.specialAttackType !== 'nightFlame') return;
        const skill = this.player.skills.nightFlame;
        if (!skill) return;
        const effect = skill.getEffect(skill.level);
        if (this.player._specialAttackCooldowns['nightFlame'] > 0
            || this.player._specialAttackActive || this.player._specialResetAnim) return;
        this.player._specialAttackActive = true;
        this.player._specialAttackPhase = 'windup';
        this.player._specialAttackTimer = 0;
        this.player._specialAttackBeamTimer = 0;
        this.player._specialAttackHitSet = new Set();
        this.player._specialAttackLastTick = 0;
        this.player._specialAttackAngle = Math.atan2(targetY - this.player.y, targetX - this.player.x);
        this.player._specialAttackLockedAngle = this.player._specialAttackAngle; // 锁定朝向为鼠标方向
        this.player._specialAttackWeaponItem = currentItem;
        this.player._specialAttackAnimKey = 'attack_sword_3';
        this.player._specialAttackAnimDuration = getPlayerAnimDurationMs('attack_sword_3') || 900;
        const attack3 = WeaponAnimConfig.sword?.attack3;
        const attackFrameCount = Math.max(1, attack3?.frames?.length || 16);
        // hitCheck.frame 沿用普通近战的 1 基帧号；第 10 帧就是剑柄前送到最大位移的接触帧。
        const releaseFrameNumber = Math.max(1, Math.min(
            attackFrameCount,
            Math.floor(Number(attack3?.hitCheck?.frame) || attackFrameCount)
        ));
        this.player._specialAttackReleaseFrame = releaseFrameNumber - 1;
        this.player._specialAttackReleaseProgress = (releaseFrameNumber - 1)
            / Math.max(1, attackFrameCount - 1);
        this.player._specialAttackBeam = null;
        this.player._specialAttackRangeEffect = null;
        this.player._specialAttackOriginX = null;
        this.player._specialAttackOriginY = null;
        this.player._specialAttackClampedLength = effect.beamLength;
        this.player._specialAttackCooldowns['nightFlame'] = effect.cooldown * 1000;
        // 这里只启动前刺；光柱由 GameScene 到达 attack3 命中/最大前伸帧后释放。
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        scene?.setPlayerAnimation?.('attack_sword_3', this.player._specialAttackAnimDuration);
    }

    startBeam() {
        if (!this.player._specialAttackActive || this.player._specialAttackPhase !== 'windup') return false;
        const currentItem = this.player._specialAttackWeaponItem;
        const skill = this.player.skills.nightFlame;
        if (!currentItem || currentItem.specialAttackType !== 'nightFlame' || !skill) return false;
        const effect = skill.getEffect(skill.level);
        // 改造效果：鹰眼符文增加攻击距离，符文重构增加持续时间
        const ce = currentItem._craftEffects || {};
        const specialRangeBonus = ce.specialRangeDelta || 0;
        const specialDurationBonus = ce.specialDurationDelta || 0;
        const cos = Math.cos(this.player._specialAttackAngle);
        const sin = Math.sin(this.player._specialAttackAngle);
        const origin = this._syncBeamOrigin();
        const centerX = origin.x;
        const centerY = origin.y;
        // 计算特效终点（配置长度 + 鹰眼符文加成 沿武器方向）
        const maxLength = effect.beamLength + specialRangeBonus;
        const endX = centerX + maxLength * cos;
        const endY = centerY + maxLength * sin;
        // 障碍物判定：起点到终点间如果有障碍物则截断
        let clampedLength = maxLength;
        if (WallSystem && WallSystem.walls) {
            for (const w of WallSystem.walls) {
                const hit = this.player._lineRectIntersection(centerX, centerY, endX, endY, w);
                if (hit !== null && hit > 0 && hit < 1) {
                    const hitLength = hit * maxLength;
                    if (hitLength < clampedLength) clampedLength = hitLength;
                }
            }
        }
        this.player._specialAttackClampedLength = clampedLength;
        // 创建多层填充蓝焰射束（使用截断后的长度，视觉与伤害判定仍共用同一长度）
        const beamDuration = effect.beamDuration + specialDurationBonus;
        const beam = new NightFlameBeamEffect(centerX, centerY, this.player._specialAttackAngle, effect.beamWidth, clampedLength, beamDuration);
        this.player._specialAttackBeam = beam;
        EffectManager.add(beam);
        // 显示范围提示（从真实剑尖开始，使用截断后的长度）
        if (Game.showAttackRange) {
            const rangeEffect = new AttackRangeEffect(centerX, centerY, this.player._specialAttackAngle, clampedLength, effect.beamWidth, effect.rangeEffectShape, beamDuration, effect.rangeEffectAlpha, effect.rangeEffectFilled);
            this.player._specialAttackRangeEffect = rangeEffect;
            EffectManager.add(rangeEffect);
        }
        this.player._specialAttackPhase = 'beam';
        this.player._specialAttackTimer = this.player._specialAttackAnimDuration
            * this.player._specialAttackReleaseProgress;
        this.player._specialAttackBeamTimer = 0;
        this.player._specialAttackLastTick = 0;
        return true;
    }

    update(dt, entities) {
        if (!this.player._specialAttackActive) return;
        const skill = this.player.skills.nightFlame;
        const effect = skill ? skill.getEffect(skill.level) : {};
        // 锁定朝向
        this.player.rotation = this.player._specialAttackLockedAngle;
        if (this.player._specialAttackPhase === 'windup') {
            // 武器轨迹跟随前刺动画推进；真正释放由 GameScene 的配置帧门禁触发。
            this.player._specialAttackTimer = Math.min(
                this.player._specialAttackAnimDuration,
                this.player._specialAttackTimer + dt
            );
            return;
        }
        if (this.player._specialAttackPhase !== 'beam') return;
        this.player._specialAttackBeamTimer += dt;
        // 视觉、调试范围与伤害矩形共用 GameScene 回写的真实剑尖位置。
        this._syncBeamOrigin();
        // 按配置间隔进行一次伤害判定
        if (this.player._specialAttackBeamTimer - this.player._specialAttackLastTick >= effect.tickInterval) {
            this.player._specialAttackLastTick = this.player._specialAttackBeamTimer;
            this._checkHit(entities);
        }
        // 配置持续时间 + 符文重构加成后结束，触发复位动画
        const currentItem = this.player._specialAttackWeaponItem;
        const ce = currentItem && currentItem._craftEffects || {};
        const specialDurationBonus = ce.specialDurationDelta || 0;
        if (this.player._specialAttackBeamTimer >= (effect.beamDuration + specialDurationBonus)) {
            // recover 开始前硬停止光柱与范围层，禁止视觉淡出尾帧跨入收势阶段。
            this._stopBeamEffects();
            this.player._specialResetAnim = {
                angle: this.player._specialAttackLockedAngle,
                // 保留 Canvas 备用渲染路径读取的字段；Phaser 主路径使用上面的锁定方向
                // 与 attack3 专属 recover 曲线。
                startAngle: 0,
                startOffset: 0,
                startTime: nowMs(), // Phase 3：墙钟→单调时钟（读者 subsystems.js/GameScene.js 同链）
                duration: effect.recoverMs
            };
            this.player._specialAttackActive = false;
            this.player._specialAttackPhase = null;
            this.player._specialAttackTimer = 0;
            this.player._specialAttackBeamTimer = 0;
            this.player._specialAttackAnimKey = null;
            this.player._specialAttackLockedAngle = null;
            this.player._specialAttackClampedLength = effect.beamLength; // 重置截断长度
            const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
            scene?.setPlayerAnimation?.('recover', effect.recoverMs);
        }
    }

    _checkHit(entities) {
        const currentItem = this.player._specialAttackWeaponItem
            || this.player.equipments[this.player.weaponMode];
        if (!currentItem || currentItem.specialAttackType !== 'nightFlame') return;
        const skill = this.player.skills.nightFlame;
        const effect = skill ? skill.getEffect(skill.level) : {};
        const ce = currentItem._craftEffects || {};
        // 计算武器基础伤害
        const d = this.player.data;
        const baseDamage = Math.round(effect.damageBase + d.str * effect.strMul + d.int * effect.intMul);
        const damage = Math.round(baseDamage * effect.tickDamageMul);
        const angle = this.player._specialAttackAngle;
        // 使用截断后的长度
        const length = this.player._specialAttackClampedLength || effect.beamLength;
        const origin = this._resolveBeamOrigin();
        const effectX = origin.x;
        const effectY = origin.y;
        const minZ = entitySurfaceZ(this.player);
        const shape = new VerticalRect(
            effectX,
            effectY,
            angle,
            length,
            effect.beamWidth,
            minZ,
            minZ + (this.player.bodyHeight || 150),
            0,
            surfaceEffectFromEntity(this.player)
        );
        // 矩形区域检测：每 tick 对范围内所有目标造成伤害（持续判定，非一次性）
        entities.forEach(entity => {
            if (entity === this.player || !entity.active || !entity.hittable) return;
            if (!shape.intersectsEntity(entity)) return;
            entity.takeDamage(damage, this.player, 'magic', false);
            // 毁灭符文：击中后附加魔力易伤
            if (ce.magicVulnerabilityOnHit && entity.applyMagicVulnerability) {
                const stacks = ce.magicVulnerabilityStacks || effect.magicVulnStacks;
                entity.applyMagicVulnerability(stacks);
            }
        });
    }
}

export { SpecialAttackSystem };
