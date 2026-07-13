import { WeaponAnimConfig } from '../../items/weapon-anim-config.js';
import { WEAPON_ANIM } from '../../config/math-utils.js';
import { Game } from '../../game.js';
import { WallSystem } from '../../world/wall-system.js';
import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { AttackRangeEffect } from '../../effects/attack-range-effect.js';
import { NightFlameBeamEffect } from '../../effects/nightflame-effect.js';
import { EffectManager } from '../../effects/effect-manager.js';
class SpecialAttackSystem {
    constructor(player) {
        this.player = player;
    }

    trigger(targetX, targetY, _entities) {
        const currentItem = this.player.equipments[this.player.weaponMode];
        if (!currentItem || currentItem.specialAttackType !== 'nightFlame') return;
        const skill = this.player.skills.nightFlame;
        if (!skill) return;
        const effect = skill.getEffect(skill.level);
        if (this.player._specialAttackCooldowns['nightFlame'] > 0 || this.player._specialAttackActive) return;
        this.player._specialAttackActive = true;
        this.player._specialAttackTimer = 0;
        this.player._specialAttackHitSet = new Set();
        this.player._specialAttackLastTick = 0;
        this.player._specialAttackAngle = Math.atan2(targetY - this.player.y, targetX - this.player.x);
        this.player._specialAttackLockedAngle = this.player._specialAttackAngle; // 锁定朝向为鼠标方向
        this.player._specialAttackCooldowns['nightFlame'] = effect.cooldown * 1000;
        // 改造效果：鹰眼符文增加攻击距离，符文重构增加持续时间
        const ce = currentItem._craftEffects || {};
        const specialRangeBonus = ce.specialRangeDelta || 0;
        const specialDurationBonus = ce.specialDurationDelta || 0;
        // 计算武器贴图中心世界坐标（标准旋转，与渲染一致）
        const wa = WEAPON_ANIM;
        const s = wa.size;
        const cos = Math.cos(this.player._specialAttackAngle);
        const sin = Math.sin(this.player._specialAttackAngle);
        // 本地偏移：base(-15, 21) + rotate(90°) * (0, -126.75) = (111.75, 21)
        const localCenterX = wa.holdX + 8 + s * 0.85 + 30;
        const localCenterY = wa.holdY + 6;
        const centerX = this.player.x + localCenterX * cos - localCenterY * sin;
        const centerY = this.player.y + localCenterX * sin + localCenterY * cos;
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
        // 创建脉冲式蓝色线条射波特效（使用截断后的长度）
        const beamDuration = effect.beamDuration + specialDurationBonus;
        const beam = new NightFlameBeamEffect(centerX, centerY, this.player._specialAttackAngle, effect.beamWidth, clampedLength, beamDuration);
        this.player._specialAttackBeam = beam;
        EffectManager.add(beam);
        // 显示范围提示（从武器贴图中心开始，使用截断后的长度）
        if (Game.showAttackRange) {
            EffectManager.add(new AttackRangeEffect(centerX, centerY, this.player._specialAttackAngle, clampedLength, effect.beamWidth, effect.rangeEffectShape, beamDuration, effect.rangeEffectAlpha, effect.rangeEffectFilled));
        }
    }

    update(dt, entities) {
        if (!this.player._specialAttackActive) return;
        const skill = this.player.skills.nightFlame;
        const effect = skill ? skill.getEffect(skill.level) : {};
        this.player._specialAttackTimer += dt;
        // 锁定朝向
        this.player.rotation = this.player._specialAttackLockedAngle;
        // 更新特效位置（跟随武器贴图中心，使用锁定角度）
        if (this.player._specialAttackBeam && this.player._specialAttackBeam.active) {
            const wa = WEAPON_ANIM;
            const s = wa.size;
            const cos = Math.cos(this.player._specialAttackLockedAngle);
            const sin = Math.sin(this.player._specialAttackLockedAngle);
            const localCenterX = wa.holdX + 8 + s * 0.85 + 30;
            const localCenterY = wa.holdY + 6;
            this.player._specialAttackBeam.x = this.player.x + localCenterX * cos - localCenterY * sin;
            this.player._specialAttackBeam.y = this.player.y + localCenterX * sin + localCenterY * cos;
        }
        // 范围提示持续显示（从武器贴图中心开始，使用截断后的长度）
        if (Game.showAttackRange) {
            const wa = WEAPON_ANIM;
            const s = wa.size;
            const cos = Math.cos(this.player._specialAttackAngle), sin = Math.sin(this.player._specialAttackAngle);
            const localCenterX = wa.holdX + 8 + s * 0.85 + 30;
            const localCenterY = wa.holdY + 6;
            const effectX = this.player.x + localCenterX * cos - localCenterY * sin;
            const effectY = this.player.y + localCenterX * sin + localCenterY * cos;
            const length = this.player._specialAttackClampedLength || effect.beamLength;
            EffectManager.add(new AttackRangeEffect(effectX, effectY, this.player._specialAttackAngle, length, effect.beamWidth, effect.rangeEffectShape, effect.rangeEffectLife, effect.rangeEffectAlpha, effect.rangeEffectFilled));
        }
        // 按配置间隔进行一次伤害判定
        if (this.player._specialAttackTimer - this.player._specialAttackLastTick >= effect.tickInterval) {
            this.player._specialAttackLastTick = this.player._specialAttackTimer;
            this._checkHit(entities);
        }
        // 配置持续时间 + 符文重构加成后结束，触发复位动画
        const currentItem = this.player.equipments[this.player.weaponMode];
        const ce = currentItem && currentItem._craftEffects || {};
        const specialDurationBonus = ce.specialDurationDelta || 0;
        if (this.player._specialAttackTimer >= (effect.beamDuration + specialDurationBonus)) {
            const _stab = WeaponAnimConfig.stab;
            this.player._specialResetAnim = {
                startOffset: effect.resetOffset, // 前伸（减半）
                startAngle: 0,
                startRotation: this.player.rotation,
                targetRotation: (() => { const sp = Renderer.worldToScreen(this.player.x, this.player.y); return Math.atan2(Input.mouse.y - sp.y, Input.mouse.x - sp.x); })(),
                startTime: Date.now(),
                duration: effect.recoverMs
            };
            this.player._specialAttackActive = false;
            this.player._specialAttackTimer = 0;
            this.player._specialAttackBeam = null;
            this.player._specialAttackLockedAngle = null;
            this.player._specialAttackClampedLength = effect.beamLength; // 重置截断长度
        }
    }

    _checkHit(entities) {
        const currentItem = this.player.equipments[this.player.weaponMode];
        if (!currentItem || currentItem.specialAttackType !== 'nightFlame') return;
        const skill = this.player.skills.nightFlame;
        const effect = skill ? skill.getEffect(skill.level) : {};
        const ce = currentItem._craftEffects || {};
        // 计算武器基础伤害
        const d = this.player.data;
        const baseDamage = Math.round(effect.damageBase + d.str * effect.strMul + d.int * effect.intMul);
        const damage = Math.round(baseDamage * effect.tickDamageMul);
        const angle = this.player._specialAttackAngle;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const halfW = effect.beamWidth / 2;
        // 使用截断后的长度
        const length = this.player._specialAttackClampedLength || effect.beamLength;
        // 计算武器贴图中心世界坐标（与渲染一致）
        const wa = WEAPON_ANIM;
        const s = wa.size;
        const localCenterX = wa.holdX + 8 + s * 0.85 + 30;
        const localCenterY = wa.holdY + 6;
        const effectX = this.player.x + localCenterX * cos - localCenterY * sin;
        const effectY = this.player.y + localCenterX * sin + localCenterY * cos;
        // 矩形区域检测：以特效圆心为中心，沿angle方向延伸length，宽度45px
        // 每200ms对范围内所有目标造成伤害（持续判定，非一次性）
        entities.forEach(entity => {
            if (entity === this.player || !entity.active || !entity.hittable) return;
            // 将实体坐标转换到光柱局部坐标系
            const dx = entity.x - effectX, dy = entity.y - effectY;
            // 投影到光柱方向
            const proj = dx * cos + dy * sin;
            // 投影到垂直方向
            const perp = -dx * sin + dy * cos;
            // 检测是否在矩形内：0 <= proj <= length, -halfW <= perp <= halfW
            if (proj >= 0 && proj <= length && perp >= -halfW && perp <= halfW) {
                entity.takeDamage(damage, this.player, 'magic');
                // 毁灭符文：击中后附加魔力易伤
                if (ce.magicVulnerabilityOnHit && entity.applyMagicVulnerability) {
                    const stacks = ce.magicVulnerabilityStacks || effect.magicVulnStacks;
                    entity.applyMagicVulnerability(stacks);
                }
            }
        });
    }
}

export { SpecialAttackSystem };
