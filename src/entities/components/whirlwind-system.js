import { Game } from '../../game.js';
import { AttackRangeEffect } from '../../effects/attack-range-effect.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { SkillManager } from '../../ui/skill-manager.js';
export class WhirlwindSystem {
    constructor(player) {
        this.player = player;
    }

    trigger() {
        if (this.player._specialAttackActive) return; // 夜与火之剑特殊攻击期间禁止风车
        // 打断冲刺状态（如果正在冲刺）
        if (this.player._isDashing) {
            this.player._isDashing = false;
            this.player._dashState = 'idle';
            this.player._dashTimer = 0;
            this.player._dashBounceApplied = false;
            this.player._dashSlashPos = null;
            this.player._dashSlashEffect = null;
            this.player._sprintDuration = 0;
        }
        this.player._isWhirlwind = true;
        this.player._whirlwindTimer = 0;
        this.player._whirlwindHitSet = new Set();
        this.player._whirlwindHitChecked = false;
        if (this.player.clearAttackTweens) { this.player.clearAttackTweens(); }
        // 从技能数据读取风车参数，避免硬编码
        const skill = this.player.skills.whirlwind;
        if (skill) {
            const effect = skill.getEffect(skill.level);
            this.player._whirlwindDuration = effect.duration || 800;
        }
        // 显示风车范围提示（当范围提示开启时）
        if (Game.showAttackRange) {
            if (skill) {
                const effect = skill.getEffect(skill.level);
                const radius = this._getRadius(effect);
                this.player._whirlwindRangeEffect = new AttackRangeEffect(this.player.x, this.player.y, 0, radius, 0, 'circle', 100, 0.5, true);
                this.player._whirlwindRangeEffect.maxLife = 100;
                this.player._whirlwindRangeEffect.life = 100;
                EffectManager.add(this.player._whirlwindRangeEffect);
            }
        }
    }

    update(dt, entities) {
        if (!this.player._isWhirlwind) return;
        this.player._whirlwindTimer += dt;
        // 更新风车范围提示位置（如果开启了范围提示）
        if (this.player._whirlwindRangeEffect) {
            if (Game.showAttackRange) {
                this.player._whirlwindRangeEffect.x = this.player.x;
                this.player._whirlwindRangeEffect.y = this.player.y;
                this.player._whirlwindRangeEffect.life = 100; // 重置生命周期，防止消失
                this.player._whirlwindRangeEffect.active = true;
            } else {
                // 用户中途关闭了范围提示
                this.player._whirlwindRangeEffect.active = false;
                this.player._whirlwindRangeEffect = null;
            }
        }
        // 攻击判定：从50ms开始，每帧持续检查
        if (this.player._whirlwindTimer >= 50 && this.player._whirlwindTimer <= this.player._whirlwindDuration) {
            this._checkHit(entities);
        }
        // 风车结束
        if (this.player._whirlwindTimer >= this.player._whirlwindDuration) {
            this.player._isWhirlwind = false;
            this.player._whirlwindTimer = 0;
            // 清理范围提示
            if (this.player._whirlwindRangeEffect) {
                this.player._whirlwindRangeEffect.active = false;
                this.player._whirlwindRangeEffect = null;
            }
            SkillManager.addWhirlwindExp(this.player, this.player._whirlwindHitSet.size, 0);
        }
    }

    _getRadius(effect) {
        const currentWeapon = this.player.equipments[this.player.weaponMode];
        const isSword = currentWeapon && (currentWeapon.weaponType === 'sword' || currentWeapon.category === 'weapon_melee');
        let radius = isSword ? effect.radius + (effect.swordRadiusBonus || 80) : effect.radius;
        // 应用改造效果：攻击距离
        if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.rangeDelta) {
            radius += currentWeapon._craftEffects.rangeDelta;
        }
        return radius;
    }

    _checkHit(entities) {
        const skill = this.player.skills.whirlwind;
        if (!skill) return;
        const effect = skill.getEffect(skill.level);
        const radius = this._getRadius(effect);
        const knockback = effect.knockback;
        const stunDuration = effect.stunDuration || 2500;
        const damageMul = effect.damageMul;
        const baseDamage = this.player.getCurrentWeaponAtk();
        const finalDamage = Math.round(baseDamage * damageMul);
        let hitCount = 0, killCount = 0;
        entities.forEach(entity => {
            if (entity === this.player || !entity.active || !entity.hittable) return;
            if (this.player._whirlwindHitSet.has(entity)) return;
            const dx = entity.x - this.player.x, dy = entity.y - this.player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= radius) {
                this.player._whirlwindHitSet.add(entity);
                const wasAlive = entity.hp > 0;
                entity.takeDamage(finalDamage, this.player);
                if (wasAlive && entity.hp <= 0) killCount++;
                hitCount++;
                const kbAngle = Math.atan2(dy, dx);
                entity.applyKnockback(kbAngle, knockback);
                if (entity.applyStun) entity.applyStun(stunDuration);
                this.player._triggerRuneSwordCooldownReduction();
                // 改造效果：流血
                const currentWeapon = this.player.equipments[this.player.weaponMode];
                if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.bleedingOnHit && entity.applyBleeding) {
                    entity.applyBleeding(1);
                }
            }
        });
        // 剑精通经验（风车攻击命中）
        SkillManager.addMeleeExp(this.player, hitCount, killCount);
    }
}
