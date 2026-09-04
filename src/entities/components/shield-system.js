import { SoundManager } from '../../ui/sound-manager.js';
import { SkillManager } from '../../ui/skill-manager.js';
import { isGunWeapon } from '../../config/gun-ammo.js';
import { getShieldDefenseValues } from '../../config/shield-config.js';
export class ShieldSystem {
    constructor(player) {
        this.player = player;
        this.active = false;        // 是否装备盾
        this.defending = false;     // 是否正在防御
        this.defenseElapsedMs = 0; // 与玩家更新共用游戏dt，暂停不消耗时窗
        this._equippedShield = null;
        this._equippedSlot = null;
        this._lastParried = false; // 本次受击结果，由 Player.takeDamage 入口重置
    }

    // 进入防御状态
    enterDefense() {
        if (!this.checkEquipped() || this.defending || !this.canDefend()) return;
        // 耗空体力后不能反复松按右键，以零体力重开免费弹反窗。
        if (!(this.player.data.stamina > 0)) return;
        this.defending = true;
        this.defenseElapsedMs = 0;
    }

    // 退出防御状态
    exitDefense() {
        this.defending = false;
        this.defenseElapsedMs = 0;
    }

    update(dt) {
        this.checkEquipped();
        if (!this.defending) return;
        if (!this.canDefend()) {
            this.exitDefense();
            return;
        }
        this.defenseElapsedMs += Math.max(0, Number(dt) || 0);
    }

    syncInput(held) {
        if (!held || !this.canDefend()) this.exitDefense();
        else this.enterDefense();
    }

    canDefend() {
        const p = this.player;
        if (!this.getShieldData() || p._isDead || p._frozenAbyssFalling || p.isStunned
            || p.isDodging || p._isDashing || p._dashRecoverAt || p._dashResetAnim
            || p._isWhirlwind || p._whirlwindRecovering || p._isPushStrike
            || p._specialAttackActive || p._runeSwordSpecialActive
            || p._castState === 'casting' || p._castState === 'recover') return false;
        if (['stun', 'frozen', 'petrified', 'fear'].some(type => p.hasStatusEffect?.(type))) return false;
        const main = p.equipments?.[p.weaponMode];
        const pistol = main && (main.weaponType === 'pistol' || main.rangedType === 'pistol');
        if (isGunWeapon(main) && !pistol) return false;
        // 保留手枪+盾开火；近战出手与收势期间不能叠加格挡。
        return pistol || !(p.weaponAnim?.isAttacking
            || (p.weaponAnim?.state && p.weaponAnim.state !== 'idle'));
    }

    getDefenseValues() {
        const skill = this.player.skills?.shieldDefense;
        return getShieldDefenseValues(this.getShieldData(), skill?.getEffect?.(skill.level));
    }

    // 本次举盾起算；配置0表示禁用弹反，不会被默认值覆盖。
    canParry() {
        const windowMs = this.getDefenseValues().parryWindow;
        return this.defending && windowMs > 0 && this.defenseElapsedMs <= windowMs;
    }

    // 处理受伤：返回 { damage, parried }
    // 在 player.takeDamage 中调用
    onDamageTaken(damage, attacker, isMelee) {
        this._lastParried = false; // 兼容直接调用；不是跨帧状态
        this.checkEquipped();
        if (!this.canDefend()) this.exitDefense();
        if (!this.defending || !(damage > 0)) {
            return { damage, parried: false };
        }
        const defense = this.getDefenseValues();

        // 弹反判定：防御后弹反窗口内 + 面朝角度限制（不再限制仅近战可弹反）
        if (this.canParry() && Number.isFinite(attacker?.x) && Number.isFinite(attacker?.y)) {
            // 检查面朝角度：只有面朝攻击者一定角度内才能弹反
            const parryAngle = defense.parryHalfAngle * Math.PI / 180;
            const angleToAttacker = Math.atan2(attacker.y - this.player.y, attacker.x - this.player.x);
            const playerFacing = this._getPlayerFacingAngle();
            let angleDiff = Math.abs(angleToAttacker - playerFacing);
            while (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

            if (angleDiff <= parryAngle) {
                this.triggerParry(attacker, isMelee);
                this._addShieldExp(isMelee, true);
                this._lastParried = true;
                return { damage: 0, parried: true };
            }
            // 面朝角度不足：回退到普通防御
        }

        // 正常防御：减伤 + 扣体力
        const reducedDamage = damage * defense.remainingDamageRatio;
        const staminaCost = defense.staminaCost;

        // 播放防御受击音效（非弹反）
        this._playSound('assets/sounds/shield/wood_hit_crisp_cavity_1s.wav');

        if (this.player.data.stamina < staminaCost) {
            // 体力不足 → 眩晕，取消防御
            this.player.data.stamina = 0;
            this.exitDefense();
            if (defense.stunOnExhaustion > 0) this.player.applyStun(defense.stunOnExhaustion);
            return { damage: reducedDamage, parried: false };
        }

        this.player.data.stamina -= staminaCost;
        // 防御经验读取技能 expRewards（当前配置：近战+2，远程+5）。
        this._addShieldExp(isMelee, false);
        return { damage: reducedDamage, parried: false };
    }

    // 触发弹反效果：近战攻击才会眩晕 + 击退；远程/魔法只抵消伤害、不耗体力
    triggerParry(attacker, isMelee) {
        if (!attacker) return;
        const defense = this.getDefenseValues();

        // 播放弹反音效
        this._playSound('assets/sounds/shield/wood_thud_1s.wav');

        // 只有近战攻击才施加眩晕、击退、打断冲刺
        if (!isMelee) return;

        // 弹反免疫单位（如集合体）：弹反不造成眩晕/打断/击退，动作不被打断；
        // 玩家侧收益（免伤/免体力/弹反音效/防御经验）不受影响，照常生效
        if (attacker._parryImmune) return;

        // 攻击者眩晕（基础时间 + 持盾防御技能加成）
        if (defense.parryStun > 0) attacker.applyStun?.(defense.parryStun);

        // 立即停止冲刺攻击（修复：黑狼冲刺不停止）
        if (attacker._attackTimer > 0) {
            attacker._attackTimer = 0;
            attacker._attackDashOffset = 0;
            attacker._dashBlocked = false;
            attacker._animState = 'idle';
            if (attacker._pendingThrust) attacker._pendingThrust.active = false;
        }

        // 攻击者被击退（使用统一的击退系统）
        const angle = Math.atan2(attacker.y - this.player.y, attacker.x - this.player.x);
        if (defense.parryKnockback > 0) attacker.applyKnockback?.(angle, defense.parryKnockback);
    }

    // 获取玩家当前面朝角度（弧度）
    _getPlayerFacingAngle() {
        // 使用同帧鼠标的世界方向，不把连续瞄准量化为四方向。
        if (Number.isFinite(this.player._shieldFacingAngle)) return this.player._shieldFacingAngle;
        if (Number.isFinite(this.player.rotation)) return this.player.rotation;
        const dir = this.player._facingDir || 'down';
        switch (dir) {
            case 'right': return 0;
            case 'left':  return Math.PI;
            case 'down':  return Math.PI / 2;
            case 'up':    return -Math.PI / 2;
            default:      return 0;
        }
    }

    // 辅助：获取副手槽位
    _getOffhandSlot() {
        const currentMode = this.player.weaponMode;
        return currentMode === 'weapon' ? 'offhand' : 'ring2';
    }

    // 辅助：安全播放音效
    _playSound(path) {
        if (SoundManager && SoundManager.playFile) {
            SoundManager.playFile(path);
        }
    }

    // 辅助：安全添加防御经验
    _addShieldExp(isMelee, isParry) {
        if (SkillManager && SkillManager.addShieldDefenseExp) {
            SkillManager.addShieldDefenseExp(this.player, isMelee, isParry);
        }
    }

    // 检查是否装备盾（只检查当前武器模式对应的副手槽）
    checkEquipped() {
        const offhandSlot = this._getOffhandSlot();
        const item = this.getShieldData();
        const newActive = !!item;
        if (!newActive || item !== this._equippedShield || offhandSlot !== this._equippedSlot) {
            this.exitDefense();
        }
        this._equippedShield = item;
        this._equippedSlot = offhandSlot;
        if (this.active !== newActive) {
            this.active = newActive;
            if (this.player.calculateCombatStats) {
                this.player.calculateCombatStats();
            }
        }
        return this.active;
    }

    // 获取当前装备的盾数据（只取当前武器模式对应的副手槽）
    getShieldData() {
        const offhandSlot = this._getOffhandSlot();
        const item = this.player.equipments?.[offhandSlot];
        return item?.weaponType === 'shield' ? item : null;
    }
}
