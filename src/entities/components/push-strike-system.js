import { Game } from '../../game.js';
import { AttackRangeEffect } from '../../effects/attack-range-effect.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { SkillManager } from '../../ui/skill-manager.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { VerticalSector } from '../../physics/skill-shapes.js';
import { entitySurfaceZ, surfaceEffectFromEntity } from '../../physics/elevation.js';
import { TWO_HANDED_WEAPONS } from '../../config/gun-ammo.js';
import { getPushStrikeValues } from '../../config/skill-formulas.js';

const HOSTILE_FACTIONS = new Set(['enemy', 'hostile', 'monster']);

export class PushStrikeSystem {
    constructor(player) {
        this.player = player;
        this._meleeHitSoundCd = 0; // 命中音效节流
    }

    /** 枪托命中使用干脆木/金属闷响，明确避开剑击声。 */
    _playMeleeHitSound() {
        const now = performance.now();
        if (now >= this._meleeHitSoundCd) {
            this._meleeHitSoundCd = now + 90;
            if (SoundManager && typeof SoundManager.playFile === 'function') {
                SoundManager.playFile('assets/sounds/shield/wood_hit_crisp_cavity_1s.wav');
            }
        }
    }

    trigger() {
        const skill = this.player.skills?.pushStrike;
        // TEMP SHELVED (2026-08-25): 动画方案暂停。保留整套实现供后续重做，标记解除前禁止任何入口触发。
        if (!skill || skill.hidden === true || skill.disabled === true) return false;
        const weapon = this.player.equipments?.[this.player.weaponMode];
        if (!TWO_HANDED_WEAPONS.includes(weapon?.weaponType)) return false;
        if (this.player._specialAttackActive || this.player._isPushStrike || this.player._isWhirlwind) return false;
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
        this.player._pushStrikeEffect = getPushStrikeValues(skill.level, this.player.data?.str);
        this.player._pushStrikeWeaponItem = weapon;
        this.player._pushStrikeWeaponType = weapon.weaponType;
        const scene = window.__phaserScene;
        const visualAim = Number.isFinite(scene?._effectiveAim)
            ? scene._effectiveAim
            : this.player.rotation;
        this.player._pushStrikeAngle = visualAim;
        this.player._pushStrikeFacingRight = Math.cos(visualAim) >= 0;
        this.player.vx = 0;
        this.player.vy = 0;
        const reloadState = this.player._ammoState?.[this.player.weaponMode];
        if (reloadState) {
            reloadState.reloading = false;
            reloadState.reloadTimer = 0;
        }
        if (this.player.clearAttackTweens) { this.player.clearAttackTweens(); }
        this.player.weaponAnim?.reset?.();
        // 九帧人物动作只提供身体与双手；真实装备贴图由 GameScene 按当前
        // 离散人物帧换握，并以连续纵深投影调转枪口/枪托。
        scene?.setPlayerAnimation?.('push_strike', this.player._pushStrikeEffect.animationDuration);
        // 显示推击范围提示（当范围提示开启时）
        if (Game.showAttackRange) {
            if (skill) {
                const effect = this.player._pushStrikeEffect;
                const radius = effect.radius;
                const attackAngle = this.player._pushStrikeAngle;
                const hitArc = effect.hitArc;
                const rangeEffectLife = effect.rangeEffectLife;
                const rangeEffectAlpha = effect.rangeEffectAlpha;
                this.player._pushStrikeRangeEffect = new AttackRangeEffect(this.player.x, this.player.y, attackAngle, radius, hitArc, 'sector', rangeEffectLife, rangeEffectAlpha, true);
                this.player._pushStrikeRangeEffect.maxLife = rangeEffectLife;
                this.player._pushStrikeRangeEffect.life = rangeEffectLife;
                EffectManager.add(this.player._pushStrikeRangeEffect);
            }
        }
        return true;
    }

    update(dt, entities) {
        if (!this.player._isPushStrike) return;
        this.player._pushStrikeTimer += dt;
        // 更新推击范围提示位置
        if (this.player._pushStrikeRangeEffect) {
            if (Game.showAttackRange) {
                this.player._pushStrikeRangeEffect.x = this.player.x;
                this.player._pushStrikeRangeEffect.y = this.player.y;
                this.player._pushStrikeRangeEffect.angle = this.player._pushStrikeAngle;
                this.player._pushStrikeRangeEffect.life = this.player._pushStrikeEffect.rangeEffectLife;
                this.player._pushStrikeRangeEffect.active = true;
            } else {
                this.player._pushStrikeRangeEffect.active = false;
                this.player._pushStrikeRangeEffect = null;
            }
        }
        const psEffect = this.player._pushStrikeEffect;
        // 攻击判定：在指定延迟时执行一次扇形判定
        if (!this.player._pushStrikeHitChecked && this.player._pushStrikeTimer >= psEffect.hitCheckDelay) {
            this._checkHit(entities);
            this.player._pushStrikeHitChecked = true;
        }
        // 推击结束：指定动画时间后结束（短暂动画）
        if (this.player._pushStrikeTimer >= psEffect.animationDuration) {
            this.player._isPushStrike = false;
            this.player._pushStrikeTimer = 0;
            this.player._pushStrikeHitChecked = false;
            if (this.player._pushStrikeRangeEffect) {
                this.player._pushStrikeRangeEffect.active = false;
                this.player._pushStrikeRangeEffect = null;
            }
            this.player._pushStrikeEffect = null;
            this.player._pushStrikeWeaponItem = null;
            this.player._pushStrikeWeaponType = null;
        }
    }

    _checkHit(entities) {
        const skill = this.player.skills.pushStrike;
        if (!skill) return;
        const effect = this.player._pushStrikeEffect || getPushStrikeValues(skill.level, this.player.data?.str);
        const radius = effect.radius;
        const knockback = effect.knockback;
        const damage = effect.damage;
        const attackAngle = this.player._pushStrikeAngle;
        const hitArc = effect.hitArc;
        const stunDuration = effect.stunDuration;
        let hitCount = 0, killCount = 0;
        const minZ = entitySurfaceZ(this.player);
        const shape = new VerticalSector(
            this.player.x,
            this.player.y,
            attackAngle,
            radius,
            hitArc,
            minZ,
            minZ + (this.player.bodyHeight || 150),
            surfaceEffectFromEntity(this.player)
        );
        entities.forEach(entity => {
            if (entity === this.player || !entity.active || !entity.hittable) return;
            if (!HOSTILE_FACTIONS.has(entity._faction || entity.faction)) return;
            if (this.player._pushStrikeHitSet.has(entity)) return;
            // 固定 90° 窄扇形，只清理贴身敌人，不位移玩家碰撞体。
            if (!shape.intersectsEntity(entity)) return;
            this.player._pushStrikeHitSet.add(entity);
            const wasAlive = entity.hp > 0;
            this._playMeleeHitSound(); // 推击命中
            entity.takeDamage(damage, this.player, 'physical', true);
            if (wasAlive && entity.hp <= 0 && !entity._summoned) killCount++;
            hitCount++;
            if (entity.hp > 0) {
                const kbAngle = Math.atan2(entity.y - this.player.y, entity.x - this.player.x);
                entity.applyKnockback(kbAngle, knockback);
                entity.applyStun?.(stunDuration);
            }
            window.__phaserScene?.triggerPushStrikeImpact?.(
                this.player.x,
                this.player.y,
                attackAngle,
                radius,
                entity
            );
        });
        // 推击技能经验
        SkillManager.addPushStrikeExp(this.player, hitCount, killCount);
    }
}
