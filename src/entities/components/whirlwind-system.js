import { Game } from '../../game.js';
import { AttackRangeEffect } from '../../effects/attack-range-effect.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { SkillManager } from '../../ui/skill-manager.js';
import { SoundManager } from '../../ui/sound-manager.js';
import { GroundCircle } from '../../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../../physics/elevation.js';
import { getPlayerAnimDef } from '../../config/player-anim.js';
import { getWhirlwindRadius } from '../../config/skill-formulas.js';
import skillsData from '../../../data/skills.json';
export class WhirlwindSystem {
    constructor(player) {
        this.player = player;
        this._meleeHitSoundCd = 0; // 命中音效节流
    }

    /** 玩家近战命中音效（与 DamagePipeline 同口径） */
    _playMeleeHitSound() {
        const now = performance.now();
        if (now >= this._meleeHitSoundCd) {
            this._meleeHitSoundCd = now + 90;
            if (SoundManager && typeof SoundManager.playFile === 'function') {
                SoundManager.playFile('assets/sounds/weapons/sword/hitting.mp3');
            }
        }
    }

    /** 鞋底贴地高速旋转摩擦声；音轨自身包含 recover 阶段的减速淡出。 */
    _playFootFrictionSound() {
        const sounds = skillsData.skills?.whirlwind?.sounds;
        const path = sounds?.footFriction;
        if (!path || !SoundManager || typeof SoundManager.playFile !== 'function') return;
        const configuredVolume = Number(sounds.footFrictionVolume);
        const volume = Number.isFinite(configuredVolume) ? configuredVolume : 0.72;
        SoundManager.playFile(path, volume);
    }

    trigger() {
        if (this.player._specialAttackActive || this.player._whirlwindRecovering) return; // 收势/特殊攻击期间禁止风车
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
        this.player._whirlwindKillCount = 0;
        this.player._whirlwindHitChecked = false;
        if (this.player.clearAttackTweens) { this.player.clearAttackTweens(); }
        // 从技能数据读取风车参数，避免硬编码
        const skill = this.player.skills.whirlwind;
        if (skill) {
            const effect = skill.getEffect(skill.level);
            this.player._whirlwindDuration = effect.duration || 800;
        }
        this.player._whirlwindDuration = this.player._whirlwindDuration || 800;
        this._playFootFrictionSound();
        // 身体层只负责原地旋转动作；武器仍由 GameScene 按当前装备贴图逐帧跟手。
        // 视觉动作可以早于技能判定结束：最后一帧会在剩余技能时间内自然定格，
        // 不改变伤害窗口、硬直或技能升级数据。
        const visualDurationMul = Math.max(
            0.5,
            Math.min(1, Number(getPlayerAnimDef('whirlwind')?.durationMul) || 1)
        );
        this.player._whirlwindVisualDuration = this.player._whirlwindDuration * visualDurationMul;
        window.__phaserScene?.setPlayerAnimation?.('whirlwind', this.player._whirlwindVisualDuration);
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
        if (this.player._whirlwindRecovering) {
            this.player._whirlwindRecoverTimer += dt;
            if (this.player._whirlwindRecoverTimer >= this.player._whirlwindRecoverDuration) {
                this.finishRecover();
            }
            return;
        }
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
            this.player._whirlwindVisualDuration = 0;
            // 清理范围提示
            if (this.player._whirlwindRangeEffect) {
                this.player._whirlwindRangeEffect.active = false;
                this.player._whirlwindRangeEffect = null;
            }
            SkillManager.addWhirlwindExp(
                this.player,
                this.player._whirlwindHitSet.size,
                this.player._whirlwindKillCount || 0
            );
            this.beginRecover();
        }
    }

    beginRecover() {
        this.player._whirlwindRecovering = true;
        this.player._whirlwindRecoverTimer = 0;
        this.player._whirlwindRecoverDuration = 520;
        this.player.vx = 0;
        this.player.vy = 0;
        window.__phaserScene?.setPlayerAnimation?.('whirlwind_recover', this.player._whirlwindRecoverDuration);
    }

    finishRecover() {
        if (!this.player._whirlwindRecovering) return;
        this.player._whirlwindRecovering = false;
        this.player._whirlwindRecoverTimer = 0;
        this.player._whirlwindRecoverDuration = 0;
        window.__phaserScene?._whirlwindWeaponDepth?.clear?.(window.__phaserScene?.weaponSprite);
        window.__phaserScene?.setPlayerAnimation?.('idle');
    }

    cancelRecover() {
        this.finishRecover();
    }

    _getRadius(effect) {
        const currentWeapon = this.player.equipments[this.player.weaponMode];
        const isSword = currentWeapon && (currentWeapon.weaponType === 'sword' || currentWeapon.category === 'weapon_melee');
        return isSword ? getWhirlwindRadius(effect, currentWeapon) : Number(effect.radius) || 0;
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
        const shape = new GroundCircle(
            this.player.x,
            this.player.y,
            radius,
            surfaceEffectFromEntity(this.player)
        );
        entities.forEach(entity => {
            if (entity === this.player || !entity.active || !entity.hittable) return;
            if (this.player._whirlwindHitSet.has(entity)) return;
            if (!shape.intersectsEntity(entity)) return;
            this.player._whirlwindHitSet.add(entity);
            const wasAlive = entity.hp > 0;
            this._playMeleeHitSound(); // 风车命中
            entity.takeDamage(finalDamage, this.player, 'physical', true);
            if (wasAlive && entity.hp <= 0 && !entity._summoned) {
                killCount++;
                this.player._whirlwindKillCount = (this.player._whirlwindKillCount || 0) + 1;
            }
            hitCount++;
            const dx = entity.x - this.player.x, dy = entity.y - this.player.y;
            const kbAngle = Math.atan2(dy, dx);
            entity.applyKnockback(kbAngle, knockback);
            if (entity.applyStun) entity.applyStun(stunDuration);
            this.player._triggerRuneSwordCooldownReduction();
            // 改造效果：流血
            const currentWeapon = this.player.equipments[this.player.weaponMode];
            if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.bleedingOnHit && entity.applyBleeding) {
                entity.applyBleeding(1);
            }
        });
        // 剑精通经验（风车攻击命中）
        SkillManager.addMeleeExp(this.player, hitCount, killCount);
    }
}
