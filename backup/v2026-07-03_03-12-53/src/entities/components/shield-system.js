export class ShieldSystem {
    constructor(player) {
        this.player = player;
        this.active = false;        // 是否装备盾
        this.defending = false;     // 是否正在防御
        this.defenseStartTime = 0;  // 防御开始时间（ms）
        this.parryWindow = 1000;    // 弹反窗口 ms
    }

    // 检查是否装备盾（只检查当前武器模式对应的副手槽）
    checkEquipped() {
        const currentMode = this.player.weaponMode;
        const offhandSlot = currentMode === 'weapon' ? 'offhand' : 'ring2';
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

        const baseReduction = shieldData.defense.damageReduction || 0.5;
        // 应用持盾防御技能减伤加成
        let skillReductionBonus = 0;
        if (this.player.skills && this.player.skills.shieldDefense) {
            const sdEffect = this.player.skills.shieldDefense.getEffect(this.player.skills.shieldDefense.level);
            skillReductionBonus = sdEffect.damageReductionBonus || 0;
        }
        const remainingDamageRatio = Math.max(0.05, baseReduction - skillReductionBonus);

        // 弹反判定：防御后 1 秒内 + 近战攻击
        if (this.canParry() && isMelee) {
            this.triggerParry(attacker);
            // 弹反经验
            if (typeof SkillManager !== 'undefined' && SkillManager.addShieldDefenseExp) {
                SkillManager.addShieldDefenseExp(this.player, isMelee, true);
            }
            return { damage: 0, parried: true };
        }

        // 正常防御：减伤 + 扣体力
        const reducedDamage = damage * remainingDamageRatio;
        const staminaCost = shieldData.defense.staminaCost || 20;

        // 播放防御受击音效（非弹反）
        if (typeof SoundManager !== 'undefined' && SoundManager.playFile) {
            SoundManager.playFile('assets/sounds/wood_hit_crisp_cavity_1s.wav');
        }

        if (this.player.data.stamina < staminaCost) {
            // 体力不足 → 眩晕 1.5 秒，取消防御
            this.player.applyStun(1500);
            this.exitDefense();
            return { damage: reducedDamage, parried: false };
        }

        this.player.data.stamina -= staminaCost;
        // 防御经验：近战+1，远程+3
        if (typeof SkillManager !== 'undefined' && SkillManager.addShieldDefenseExp) {
            SkillManager.addShieldDefenseExp(this.player, isMelee, false);
        }
        return { damage: reducedDamage, parried: false };
    }

    // 触发弹反效果：攻击者眩晕 + 击退
    triggerParry(attacker) {
        if (!attacker) return;
        // 播放弹反音效
        if (typeof SoundManager !== 'undefined' && SoundManager.playFile) {
            SoundManager.playFile('assets/sounds/wood_thud_1s.wav');
        }
        // 攻击者眩晕（基础2秒 + 持盾防御技能加成）
        let stunDuration = 2000;
        if (this.player.skills && this.player.skills.shieldDefense) {
            const sdEffect = this.player.skills.shieldDefense.getEffect(this.player.skills.shieldDefense.level);
            stunDuration += (sdEffect.parryStunBonus || 0) * 1000;
        }
        if (attacker.applyStun) attacker.applyStun(stunDuration);
        // 攻击者被击退 100px（使用统一的击退系统）
        const angle = Math.atan2(attacker.y - this.player.y, attacker.x - this.player.x);
        if (attacker.applyKnockback) attacker.applyKnockback(angle, 100);
    }

    // 获取当前装备的盾数据（只取当前武器模式对应的副手槽）
    getShieldData() {
        const currentMode = this.player.weaponMode;
        const offhandSlot = currentMode === 'weapon' ? 'offhand' : 'ring2';
        return this.player.equipments[offhandSlot] || null;
    }
}
