import { computeWeaponAttack } from '../../config/attack-formula.js';
import { COMBAT_CONFIG } from '../../config/combat-config.js';
import { COMBAT_FORMULAS } from '../../config/combat-formulas.js';
import { CONFIG } from '../../config/config.js';
import { DungeonMapSystem } from '../../world/dungeon-map-system.js';
import { DungeonBuffSystem } from '../../world/dungeon-event-system.js';
import { applyTributeEffects } from '../../config/tribute-effects.js';

const baseMixin = {
    calculateCombatStats() {
        const d = this.data;

        // 安全读取全局战斗公式配置
        const formulas = COMBAT_FORMULAS.player || {};

        // 应用武器精通的属性加成
        let bonusStr = 0, bonusDex = 0, bonusWis = 0, bonusCon = 0;
        if (this.skills) {
            if (this.skills.machineGunMastery) {
                bonusStr += this.skills.machineGunMastery.getEffect(this.skills.machineGunMastery.level).strBonus;
            }
            if (this.skills.rifleMastery) {
                bonusWis += this.skills.rifleMastery.getEffect(this.skills.rifleMastery.level).wisBonus;
            }
            if (this.skills.pistolMastery) {
                bonusDex += this.skills.pistolMastery.getEffect(this.skills.pistolMastery.level).dexBonus;
            }
            if (this.skills.bowMastery) {
                bonusDex += this.skills.bowMastery.getEffect(this.skills.bowMastery.level).dexBonus;
            }
            if (this.skills.shotgunMastery) {
                bonusCon += this.skills.shotgunMastery.getEffect(this.skills.shotgunMastery.level).conBonus;
            }
        }

        // 攻击
        const atkFormula = formulas.attack || { base: 10, strMultiplier: 0.05, dexMultiplier: 0.1, round: true };
        d.atk = atkFormula.round
            ? Math.round(atkFormula.base + (d.str + bonusStr) * atkFormula.strMultiplier + (d.dex + bonusDex) * atkFormula.dexMultiplier)
            : atkFormula.base + (d.str + bonusStr) * atkFormula.strMultiplier + (d.dex + bonusDex) * atkFormula.dexMultiplier;

        // 防御
        const defFormula = formulas.defense || { conMultiplier: 1.2, strMultiplier: 0.3, round: 'floor' };
        d.def = this._applyRounding((d.con + bonusCon) * defFormula.conMultiplier + (d.str + bonusStr) * defFormula.strMultiplier, defFormula.round);

        // 应用改造效果：防御力变化
        if (this.equipments && this.weaponMode) {
            const currentWpn = this.equipments[this.weaponMode];
            if (currentWpn && currentWpn._craftEffects && currentWpn._craftEffects.defensePercent) {
                d.def = Math.floor(d.def * (1 + currentWpn._craftEffects.defensePercent));
            }
        }

        // 应用持盾防御技能的防御力加成
        if (this.equipments && this.skills && this.skills.shieldDefense) {
            const offhandSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
            const shield = this.equipments[offhandSlot];
            if (shield && shield.weaponType === 'shield') {
                // 盾牌防御力计入玩家防御面板：base + perEnhance × 强化等级
                // （此前 defense.base/perEnhance 只在 tooltip 展示，实战未生效——防具强化无消费端修复）
                const sdef = shield.defense || {};
                d.def += Math.floor((sdef.base || 0) + (sdef.perEnhance || 0) * (shield.enhanceLevel || 0));
                const sdEffect = this.skills.shieldDefense.getEffect(this.skills.shieldDefense.level);
                d.def = Math.floor(d.def * (1 + sdEffect.defBonusPercent));
            }
        }

        // 魔法攻击/防御、命中/闪避、暴击/攻速/速度/暴击抵抗
        const matkFormula = formulas.magicAttack || { intMultiplier: 1.5, wisMultiplier: 0.5, round: 'floor' };
        const mdefFormula = formulas.magicDefense || { wisMultiplier: 1.2, intMultiplier: 0.3, round: 'floor' };
        const hitFormula = formulas.hit || { base: 80, dexMultiplier: 0.5, round: 'floor' };
        const dodgeFormula = formulas.dodge || { base: 5, dexMultiplier: 0.3, round: 'floor' };
        const critFormula = formulas.crit || { base: 2, luckMultiplier: 1.0, round: 'floor' };
        const aspdFormula = formulas.attackSpeed || { base: 1.0, dexMultiplier: 0.02 };
        const speedFormula = formulas.speed || { base: CONFIG.PLAYER_SPEED, dexMultiplier: 0.05 };
        const critResFormula = formulas.critResist || { conMultiplier: 1.0, round: 'floor' };

        d.matk = this._applyRounding(d.int * matkFormula.intMultiplier + (d.wis + bonusWis) * matkFormula.wisMultiplier, matkFormula.round);
        d.mdef = this._applyRounding((d.wis + bonusWis) * mdefFormula.wisMultiplier + d.int * mdefFormula.intMultiplier, mdefFormula.round);
        d.hit = this._applyRounding(hitFormula.base + (d.dex + bonusDex) * hitFormula.dexMultiplier, hitFormula.round);
        d.dodge = this._applyRounding(dodgeFormula.base + (d.dex + bonusDex) * dodgeFormula.dexMultiplier, dodgeFormula.round);
        d.crit = this._applyRounding(critFormula.base + d.luck * critFormula.luckMultiplier, critFormula.round);
        d.aspd = aspdFormula.base + (d.dex + bonusDex) * aspdFormula.dexMultiplier;
        d.speed = speedFormula.base + (d.dex + bonusDex) * speedFormula.dexMultiplier;
        d.critRes = this._applyRounding(d.con * critResFormula.conMultiplier, critResFormula.round);

        // 保存加成供其他系统使用
        this._masteryBonus = { str: bonusStr, dex: bonusDex, wis: bonusWis };

        // 应用地牢事件buff加成（女神祝福/恶魔祈祷）
        this._applyDungeonBuffBonus();

        // 祭品效果（数据驱动）：对最终面板做固定百分比调整
        applyTributeEffects(this);
    },

    _applyRounding(value, method) {
        if (method === 'round') return Math.round(value);
        if (method === 'ceil') return Math.ceil(value);
        return Math.floor(value);
    },

    /**
     * 应用地牢事件buff的攻击/防御/移速加成
     * 在 calculateCombatStats 最后调用
     */
    _applyDungeonBuffBonus() {
        const d = this.data;

        // 先恢复基础移速，再由临时 buff 叠加
        this.maxSpeed = CONFIG.PLAYER_SPEED;

        const atkBonusPercent = DungeonBuffSystem.getAtkBonusPercent(this);
        if (atkBonusPercent !== 0) {
            const multiplier = 1 + atkBonusPercent / 100;
            d.atk = Math.floor(d.atk * multiplier);
        }

        const matkBonusPercent = DungeonBuffSystem.getMatkBonusPercent(this);
        if (matkBonusPercent !== 0) {
            const multiplier = 1 + matkBonusPercent / 100;
            d.matk = Math.floor(d.matk * multiplier);
        }

        const defBonusPercent = DungeonBuffSystem.getDefBonusPercent(this);
        if (defBonusPercent !== 0) {
            d.def = Math.floor(d.def * (1 + defBonusPercent / 100));
        }

        const moveBonusPercent = DungeonBuffSystem.getMoveSpeedBonusPercent(this);
        if (moveBonusPercent !== 0) {
            const multiplier = 1 + moveBonusPercent / 100;
            this.maxSpeed = Math.max(CONFIG.PLAYER_SPEED * 0.5, CONFIG.PLAYER_SPEED * multiplier);
        }
    },

    getCurrentWeaponAtk(itemOverride) {
        const currentWpn = itemOverride || this.equipments[this.weaponMode];
        if (!currentWpn) return 0;
        return computeWeaponAttack(currentWpn, this.data, this.skills);
    },

    _getEnergyLMGParams() {
        const currentWpn = this.equipments[this.weaponMode];
        const params = currentWpn && currentWpn.energyLMGParams;
        const energyCfg = COMBAT_CONFIG.energyLMG || {};
        const hardDefaults = { baseCooldown: 333, maxCooldown: 50, rampUpTime: 2500, overheatTime: 4000, overheatRecoverTime: 2500, overheatCooldownTime: 4000, spreadMaxTime: 2500, maxSpreadAngle: 15 };
        const defaults = this._energyLMGDefaults || {
            baseCooldown: energyCfg.baseCooldown ?? hardDefaults.baseCooldown,
            maxCooldown: energyCfg.maxCooldown ?? hardDefaults.maxCooldown,
            rampUpTime: energyCfg.rampUpTime ?? hardDefaults.rampUpTime,
            overheatTime: energyCfg.overheatTime ?? hardDefaults.overheatTime,
            overheatRecoverTime: energyCfg.overheatRecoverTime ?? hardDefaults.overheatRecoverTime,
            overheatCooldownTime: energyCfg.overheatCooldownTime ?? hardDefaults.overheatCooldownTime,
            spreadMaxTime: energyCfg.spreadMaxTime ?? hardDefaults.spreadMaxTime,
            maxSpreadAngle: energyCfg.maxSpreadAngle ?? hardDefaults.maxSpreadAngle
        };
        if (!params) return defaults;
        return {
            baseCooldown: params.baseCooldown ?? defaults.baseCooldown,
            maxCooldown: params.maxCooldown ?? defaults.maxCooldown,
            rampUpTime: params.rampUpTime ?? defaults.rampUpTime,
            overheatTime: params.overheatTime ?? defaults.overheatTime,
            overheatRecoverTime: params.overheatRecoverTime ?? defaults.overheatRecoverTime,
            overheatCooldownTime: params.overheatCooldownTime ?? defaults.overheatCooldownTime,
            spreadMaxTime: params.spreadMaxTime ?? defaults.spreadMaxTime,
            maxSpreadAngle: params.maxSpreadAngle ?? defaults.maxSpreadAngle
        };
    },

    getExpForLevel(level) {
        const formula = COMBAT_FORMULAS.player?.expPerLevel
            || { base: 20, levelMultiplier: 20, levelSquareMultiplier: 12, finalMultiplier: 2, globalMultiplier: 2 };
        const base = formula.base ?? 20;
        const levelMul = formula.levelMultiplier ?? 20;
        const levelSquareMul = formula.levelSquareMultiplier ?? 12;
        const finalMul = formula.finalMultiplier ?? 2;
        const globalMul = formula.globalMultiplier ?? 1;
        return (base + level * levelMul + level * levelSquareMul) * finalMul * globalMul;
    },

    updateMaxStats() {
        const d = this.data;
        const formulas = COMBAT_FORMULAS.player || {};
        const hpFormula = formulas.maxHp || { base: 100, conMultiplier: 10 };
        const mpFormula = formulas.maxMp || { base: 100, wisMultiplier: 10, intMultiplier: 5 };
        const staminaFormula = formulas.staminaRegen || { base: 1.0, dexMultiplier: 0.01 };

        const oldMaxHp = d.maxHp;
        const oldMaxMp = d.maxMp;
        d.maxHp = hpFormula.base + d.con * hpFormula.conMultiplier;
        d.maxMp = mpFormula.base + d.wis * mpFormula.wisMultiplier + d.int * mpFormula.intMultiplier;

        // HP/MP 按比例缩放，避免满血时增加属性反而掉血
        if (oldMaxHp > 0) d.hp = Math.min(d.maxHp, d.hp + (d.maxHp - oldMaxHp));
        else d.hp = d.maxHp;
        if (oldMaxMp > 0) d.mp = Math.min(d.maxMp, d.mp + (d.maxMp - oldMaxMp));
        else d.mp = d.maxMp;

        // 体力恢复速度：每点敏捷 +1%
        let regenMul = staminaFormula.base + d.dex * staminaFormula.dexMultiplier;
        if (!isFinite(regenMul) || regenMul < 0) regenMul = 1.0;
        this._staminaRegenMul = regenMul;

        // 升级所需经验：按公式动态计算
        d.maxExp = this.getExpForLevel(d.level);
    }
};

export { baseMixin };
