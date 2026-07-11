import { Game } from '../../game.js';
import { AttackRangeEffect } from '../../effects/attack-range-effect.js';
import { MathUtils } from '../../config/math-utils.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { BloodHitEffect as HitEffect } from '../../effects/blood-hit-effect.js';
import { SkillManager } from '../../ui/skill-manager.js';
export class PushStrikeSystem {
    constructor(player) {
        this.player = player;
    }

    trigger() {
        if (this.player._specialAttackActive) return; // 夜与火之剑特殊攻击期间禁止推击
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
        this.player._isPushStrike = true;
        this.player._pushStrikeTimer = 0;
        this.player._pushStrikeHitSet = new Set();
        this.player._pushStrikeHitChecked = false;
        if (this.player.clearAttackTweens) { this.player.clearAttackTweens(); }
        // 显示推击范围提示（当范围提示开启时）
        if (Game.showAttackRange) {
            const skill = this.player.skills.pushStrike;
            if (skill) {
                const effect = skill.getEffect(skill.level);
                const radius = effect.radius;
                const attackAngle = this.player.rotation;
                const hitArc = 2 * Math.PI / 3; // 120度
                this.player._pushStrikeRangeEffect = new AttackRangeEffect(this.player.x, this.player.y, attackAngle, radius, hitArc, 'sector', 200, 0.5, true);
                this.player._pushStrikeRangeEffect.maxLife = 200;
                this.player._pushStrikeRangeEffect.life = 200;
                EffectManager.add(this.player._pushStrikeRangeEffect);
            }
        }
    }

    update(dt, entities) {
        if (!this.player._isPushStrike) return;
        this.player._pushStrikeTimer += dt;
        // 更新推击范围提示位置
        if (this.player._pushStrikeRangeEffect) {
            if (Game.showAttackRange) {
                this.player._pushStrikeRangeEffect.x = this.player.x;
                this.player._pushStrikeRangeEffect.y = this.player.y;
                this.player._pushStrikeRangeEffect.angle = this.player.rotation;
                this.player._pushStrikeRangeEffect.life = 200;
                this.player._pushStrikeRangeEffect.active = true;
            } else {
                this.player._pushStrikeRangeEffect.active = false;
                this.player._pushStrikeRangeEffect = null;
            }
        }
        // 攻击判定：在50ms时执行一次扇形判定
        if (!this.player._pushStrikeHitChecked && this.player._pushStrikeTimer >= 50) {
            this._checkHit(entities);
            this.player._pushStrikeHitChecked = true;
        }
        // 推击结束：300ms后结束（短暂动画）
        if (this.player._pushStrikeTimer >= 300) {
            this.player._isPushStrike = false;
            this.player._pushStrikeTimer = 0;
            this.player._pushStrikeHitChecked = false;
            if (this.player._pushStrikeRangeEffect) {
                this.player._pushStrikeRangeEffect.active = false;
                this.player._pushStrikeRangeEffect = null;
            }
        }
    }

    _checkHit(entities) {
        const skill = this.player.skills.pushStrike;
        if (!skill) return;
        const effect = skill.getEffect(skill.level);
        const radius = effect.radius;
        const knockback = effect.knockback;
        const damageMul = effect.damageMul;
        const damage = Math.round(this.player.data.str * damageMul);
        const attackAngle = this.player.rotation;
        const hitArc = 2 * Math.PI / 3; // 120度
        let hitCount = 0, killCount = 0;
        entities.forEach(entity => {
            if (entity === this.player || !entity.active || !entity.hittable) return;
            if (this.player._pushStrikeHitSet.has(entity)) return;
            // 扇形判定：前方120度，半径范围内
            if (MathUtils.pointInSector(entity.x, entity.y, this.player.x, this.player.y, attackAngle, radius, hitArc)) {
                this.player._pushStrikeHitSet.add(entity);
                const wasAlive = entity.hp > 0;
                entity.takeDamage(damage, this.player);
                if (wasAlive && entity.hp <= 0) killCount++;
                hitCount++;
                const kbAngle = Math.atan2(entity.y - this.player.y, entity.x - this.player.x);
                entity.applyKnockback(kbAngle, knockback);
                // 1.5秒眩晕
                if (entity._dashStunned !== undefined) {
                    entity._dashStunned = true;
                    entity._dashStunTimer = 1500;
                }
                EffectManager.add(new HitEffect(entity.x, entity.y));
                EffectManager.createDamageText(entity.x, entity.y - entity.size, damage, false);
                this.player._triggerRuneSwordCooldownReduction();
            }
        });
        // 推击技能经验
        SkillManager.addPushStrikeExp(this.player, hitCount, killCount);
    }
}
