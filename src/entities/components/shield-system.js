import { SoundManager } from '../../ui/sound-manager.js';
import { SkillManager } from '../../ui/skill-manager.js';
export class ShieldSystem {
    constructor(player) {
        this.player = player;
        this.active = false;        // 是否装备盾
        this.defending = false;     // 是否正在防御
        this.defenseStartTime = 0;  // 防御开始时间（ms）
        this.parryWindow = 1000;    // 弹反窗口 ms
    }

    // 进入防御状态
    enterDefense() {
        if (!this.active || this.defending) return;
        this.defending = true;
        this.defenseStartTime = Date.now();
    }

    // 退出防御状态
    exitDefense() {
        this.defending = false;
        this.defenseStartTime = 0;
    }

    // 检查是否可弹反（防御开始 1 秒内）
    canParry() {
        return this.defending && (Date.now() - this.defenseStartTime) <= this.parryWindow;
    }

    // 处理受伤：返回 { damage, parried }
    // 在 player.takeDamage 中调用
    onDamageTaken(damage, attacker, isMelee) {
        if (!this.defending) return { damage, parried: false };

        const shieldData = this.getShieldData();
        if (!shieldData || !shieldData.defense) {
            return { damage: damage * 0.5, parried: false };
        }

        const defense = shieldData.defense;
        const baseReduction = defense.damageReduction || 0.5;
        // 应用持盾防御技能减伤加成
        let skillReductionBonus = 0;
        if (this.player.skills && this.player.skills.shieldDefense) {
            const sdEffect = this.player.skills.shieldDefense.getEffect(this.player.skills.shieldDefense.level);
            skillReductionBonus = sdEffect.damageReductionBonus || 0;
        }
        const remainingDamageRatio = Math.max(0.05, baseReduction - skillReductionBonus);

        // 弹反判定：防御后弹反窗口内 + 近战攻击 + 面朝角度限制
        if (this.canParry() && isMelee) {
            // 检查面朝角度：只有面朝攻击者一定角度内才能弹反
            const parryAngle = (defense.parryAngle || 120) * Math.PI / 180;
            const angleToAttacker = Math.atan2(attacker.y - this.player.y, attacker.x - this.player.x);
            const playerFacing = this._getPlayerFacingAngle();
            let angleDiff = Math.abs(angleToAttacker - playerFacing);
            while (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
            
            if (angleDiff <= parryAngle) {
                this.triggerParry(attacker);
                this._addShieldExp(isMelee, true);
                return { damage: 0, parried: true };
            }
            // 面朝角度不足：回退到普通防御
        }

        // 正常防御：减伤 + 扣体力
        const reducedDamage = damage * remainingDamageRatio;
        const staminaCost = defense.staminaCost || 20;

        // 播放防御受击音效（非弹反）
        this._playSound('assets/sounds/wood_hit_crisp_cavity_1s.wav');

        if (this.player.data.stamina < staminaCost) {
            // 体力不足 → 眩晕，取消防御
            this.player.applyStun(defense.stunOnExhaustion || 1500);
            this.exitDefense();
            return { damage: reducedDamage, parried: false };
        }

        this.player.data.stamina -= staminaCost;
        // 防御经验：近战+1，远程+3
        this._addShieldExp(isMelee, false);
        return { damage: reducedDamage, parried: false };
    }

    // 触发弹反效果：攻击者眩晕 + 击退
    triggerParry(attacker) {
        if (!attacker) return;
        const shieldData = this.getShieldData();
        const defense = shieldData?.defense || {};

        // 播放弹反音效
        this._playSound('assets/sounds/wood_thud_1s.wav');

        // 攻击者眩晕（基础时间 + 持盾防御技能加成）
        let stunDuration = defense.parryStun || 2000;
        if (this.player.skills && this.player.skills.shieldDefense) {
            const sdEffect = this.player.skills.shieldDefense.getEffect(this.player.skills.shieldDefense.level);
            stunDuration += (sdEffect.parryStunBonus || 0) * 1000;
        }
        attacker.applyStun(stunDuration);

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
        const knockback = defense.parryKnockback || 100;
        if (attacker.applyKnockback) attacker.applyKnockback(angle, knockback);
    }

    // 获取玩家当前面朝角度（弧度）
    _getPlayerFacingAngle() {
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
        const item = this.player.equipments[offhandSlot];
        const newActive = !!(item && item.weaponType === 'shield');
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
        return this.player.equipments[offhandSlot] || null;
    }
}
