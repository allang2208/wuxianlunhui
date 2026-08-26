import { computeWeaponAttack } from '../../config/attack-formula.js';
import { COMBAT_CONFIG } from '../../config/combat-config.js';
import { COMBAT_FORMULAS } from '../../config/combat-formulas.js';
import { computeMaxExp } from '../../config/exp-system.js';
import { CONFIG } from '../../config/config.js';
import { DungeonBuffSystem } from '../../world/dungeon-event-system.js';
import { applyTributeEffects } from '../../config/tribute-effects.js';

const baseMixin = {
    calculateCombatStats() {
        const d = this.data;

        // 安全读取全局战斗公式配置
        const formulas = COMBAT_FORMULAS.player || {};

        // 应用武器精通的属性加成
        let bonusStr = 0, bonusDex = 0, bonusWis = 0, bonusCon = 0, bonusInt = 0, bonusLuck = 0;
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

        // 装备加成（防具防御 + 首饰/防具 bonusStats：六维与面板属性；防御按 base + perEnhance×强化等级）
        const eq = this._getEquipmentBonuses();
        // 六维写入面板（差值法：移除上次装备加成再加本次，避免重复累加；公式侧直接读 d.str 等）
        const prevAttr = this._equipAttrBonus || { str: 0, dex: 0, int: 0, con: 0, wis: 0, luck: 0 };
        d.str += eq.str - prevAttr.str;
        d.dex += eq.dex - prevAttr.dex;
        d.int += eq.int - prevAttr.int;
        d.con += eq.con - prevAttr.con;
        d.wis += eq.wis - prevAttr.wis;
        d.luck += eq.luck - prevAttr.luck;
        this._equipAttrBonus = { str: eq.str, dex: eq.dex, int: eq.int, con: eq.con, wis: eq.wis, luck: eq.luck };

        // 攻击
        const atkFormula = formulas.attack || { base: 10, strMultiplier: 0.05, dexMultiplier: 0.1, round: true };
        d.atk = atkFormula.round
            ? Math.round(atkFormula.base + (d.str + bonusStr) * atkFormula.strMultiplier + (d.dex + bonusDex) * atkFormula.dexMultiplier)
            : atkFormula.base + (d.str + bonusStr) * atkFormula.strMultiplier + (d.dex + bonusDex) * atkFormula.dexMultiplier;
        d.atk += Math.round(eq.atk); // 首饰物理攻击加成（猛攻戒指）

        // 防御
        const defFormula = formulas.defense || { conMultiplier: 1.2, strMultiplier: 0.3, round: 'floor' };
        d.def = this._applyRounding((d.con + bonusCon) * defFormula.conMultiplier + (d.str + bonusStr) * defFormula.strMultiplier, defFormula.round);
        d.def += eq.defense; // 防具/盾牌防御（base + perEnhance×强化等级）

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
                // 盾牌防御力已由 _getEquipmentBonuses 统一计入 d.def；此处仅应用持盾技能百分比加成
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
        const speedBase = speedFormula.usePlayerSpeedConfig ? CONFIG.PLAYER_SPEED : (speedFormula.base || CONFIG.PLAYER_SPEED);
        const critResFormula = formulas.critResist || { conMultiplier: 1.0, round: 'floor' };

        d.matk = this._applyRounding((d.int + bonusInt) * matkFormula.intMultiplier + (d.wis + bonusWis) * matkFormula.wisMultiplier, matkFormula.round);
        d.mdef = this._applyRounding((d.wis + bonusWis) * mdefFormula.wisMultiplier + (d.int + bonusInt) * mdefFormula.intMultiplier, mdefFormula.round);
        d.matk += Math.round(eq.matk); // 首饰魔法攻击加成（秘法戒指）
        d.matk += this._getEquipmentMatkBonus(bonusInt, bonusWis); // 装备 matkFormula 魔法攻击加成
        d.hit = this._applyRounding(hitFormula.base + (d.dex + bonusDex) * hitFormula.dexMultiplier, hitFormula.round);
        d.dodge = this._applyRounding(dodgeFormula.base + (d.dex + bonusDex) * dodgeFormula.dexMultiplier, dodgeFormula.round);
        d.crit = this._applyRounding(critFormula.base + (d.luck + bonusLuck) * critFormula.luckMultiplier, critFormula.round);
        d.crit += Math.round(eq.crit); // 首饰暴击率加成（致命戒指）
        d.aspd = aspdFormula.base + (d.dex + bonusDex) * aspdFormula.dexMultiplier;
        d.speed = speedBase + (d.dex + bonusDex) * speedFormula.dexMultiplier;
        d.critRes = this._applyRounding(d.con * critResFormula.conMultiplier, critResFormula.round);

        // ===== 三件套判定（头盔+护甲+靴子同 armorSet 齐穿激活）=====
        this._armorSetActive = null;
        this._cooldownReduction = 0;
        this._magicDamageBonus = 0;
        this._critSetBonus = 0;
        this._physicalDamageBonus = 0;
        let armorSpeedMul = 1;
        if (this.equipments) {
            const setCount = {};
            for (const slotKey of ['helmet', 'armor', 'boots']) {
                const it = this.equipments[slotKey];
                if (it && it.armorSet) setCount[it.armorSet] = (setCount[it.armorSet] || 0) + 1;
            }
            if (setCount.light === 3) {
                this._armorSetActive = 'light';
                armorSpeedMul = 1.10; // 轻甲：+10% 移速
            } else if (setCount.robe === 3) {
                this._armorSetActive = 'robe';
                this._cooldownReduction = 0.12; // 法袍：技能冷却 -12%
                this._magicDamageBonus = 0.18; // 法袍：魔法伤害 +18%
            } else if (setCount.heavy === 3) {
                this._armorSetActive = 'heavy';
                armorSpeedMul = 0.85; // 重甲：-15% 移速（强化不影响格挡率）
            } else if (setCount.flowing === 3) {
                this._armorSetActive = 'flowing';
                armorSpeedMul = 1.15; // 流云（稀有轻甲）：+15% 移速
            } else if (setCount.eclipse === 3) {
                this._armorSetActive = 'eclipse';
                this._cooldownReduction = 0.18; // 蚀月（稀有法袍）：技能冷却 -18%
                this._magicDamageBonus = 0.25; // 蚀月（稀有法袍）：魔法伤害 +25%
            } else if (setCount.zhenyue === 3) {
                this._armorSetActive = 'zhenyue';
                armorSpeedMul = 0.88; // 镇岳（稀有重甲）：-12% 移速（强化不影响格挡率）
            } else if (setCount.stellar === 3) {
                this._armorSetActive = 'stellar';
                armorSpeedMul = 1.08; // 星穹（史诗输出）：+8% 移速
                this._critSetBonus = 15; // 星穹：暴击率 +15%
                this._physicalDamageBonus = 0.10; // 星穹：物理攻击 +10%
            } else if (setCount.lunar === 3) {
                this._armorSetActive = 'lunar';
                this._cooldownReduction = 0.22; // 苍月（史诗法袍）：技能冷却 -22%
                this._magicDamageBonus = 0.30; // 苍月（史诗法袍）：魔法伤害 +30%
            } else if (setCount.tiangang === 3) {
                this._armorSetActive = 'tiangang';
                armorSpeedMul = 0.90; // 天罡（史诗重甲）：-10% 移速（格挡在 damageable-entity）
            } else if (setCount.oracle === 3) {
                this._armorSetActive = 'oracle';
                armorSpeedMul = 0.88; // 神域（神话重甲）：-12% 移速（格挡在 damageable-entity）
            } else if (setCount.holy === 3) {
                this._armorSetActive = 'holy';
                armorSpeedMul = 1.10; // 圣辉（神话轻甲）：+10% 移速
                this._critSetBonus = 20; // 圣辉：暴击率 +20%
                this._physicalDamageBonus = 0.15; // 圣辉：物理攻击 +15%
            } else if (setCount.oracle_robe === 3) {
                this._armorSetActive = 'oracle_robe';
                this._cooldownReduction = 0.28; // 神谕（神话法袍）：技能冷却 -28%
                this._magicDamageBonus = 0.35; // 神谕（神话法袍）：魔法伤害 +35%
            }
        }
        // 史诗星穹套：暴击率/物理攻击加成（在套装判定后应用）
        if (this._critSetBonus) d.crit += this._critSetBonus;
        if (this._physicalDamageBonus) d.atk = Math.floor(d.atk * (1 + this._physicalDamageBonus));
        // 实际移动读 this.maxSpeed（update.js），套装移速修正写回；面板 d.speed 同步
        this.maxSpeed = Math.floor(CONFIG.PLAYER_SPEED * armorSpeedMul);
        d.speed = Math.floor(d.speed * armorSpeedMul);

        // 闪避面板：配置基准 × 修饰百分比（后续装备/道具写入 _dodgeModifiers 后
        // 调用 calculateCombatStats 即生效；durationPercent 影响无敌时长，distancePercent 影响位移距离）
        const dm = this._dodgeModifiers || {};
        d.dodgeDuration = Math.max(1, Math.round(CONFIG.DODGE_DURATION * (1 + (dm.durationPercent || 0) / 100)));
        d.dodgeSpeed = CONFIG.DODGE_SPEED * (1 + (dm.distancePercent || 0) / 100);

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
     * 汇总所有已装备物品的加成（防具防御 + 首饰/防具 bonusStats），含强化成长：
     * bonusStats[k] + bonusPerEnhance[k] × 强化等级；defense 单独累加 base + perEnhance × 强化等级。
     */
    _getEquipmentBonuses() {
        const totals = { str: 0, dex: 0, int: 0, con: 0, wis: 0, luck: 0, atk: 0, matk: 0, crit: 0, maxHp: 0, maxMp: 0, maxStamina: 0, defense: 0 };
        if (!this.equipments) return totals;
        for (const slotKey of Object.keys(this.equipments)) {
            const it = this.equipments[slotKey];
            if (!it) continue;
            const el = it.enhanceLevel || 0;
            const bs = it.bonusStats || {};
            const pe = it.bonusPerEnhance || {};
            for (const k of Object.keys(totals)) {
                totals[k] += (bs[k] || 0) + (pe[k] || 0) * el;
            }
            if (it.defense) {
                totals.defense += Math.floor((it.defense.base || 0) + (it.defense.perEnhance || 0) * el);
            }
        }
        return totals;
    },

    /**
     * 当前主手法杖 matkFormula 魔法攻击加成（独立公式，含强化成长）。
     * 未启用武器组、副手盾牌/魔法书不叠加法杖公式；魔法书走 bonusStats 等支援属性。
     * 公式：base + 强化等级×enhanceBase + (智力+技能加成)×(intMul + 强化等级×enhanceIntMul)
     *                            + (精神+技能加成)×(wisMul + 强化等级×enhanceWisMul)
     */
    _getEquipmentMatkBonus(bonusInt, bonusWis) {
        if (!this.equipments) return 0;
        const focus = this.equipments[this.weaponMode];
        if (!focus || focus.weaponType !== 'staff' || !focus.matkFormula) return 0;
        const el = focus.enhanceLevel || 0;
        const f = focus.matkFormula;
        const flat = (f.base || 0) + el * (f.enhanceBase || 0);
        const intMul = (f.intMul || 0) + el * (f.enhanceIntMul || 0);
        const wisMul = (f.wisMul || 0) + el * (f.enhanceWisMul || 0);
        const intTotal = (this.data.int || 0) + (bonusInt || 0);
        const wisTotal = (this.data.wis || 0) + (bonusWis || 0);
        return Math.round(flat + intTotal * intMul + wisTotal * wisMul);
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
        const source = params || defaults;
        const ce = currentWpn?._craftEffects || {};
        return {
            baseCooldown: source.baseCooldown ?? defaults.baseCooldown,
            maxCooldown: Math.max(40, (source.maxCooldown ?? defaults.maxCooldown)
                + (Number(ce.energyPeakCooldownDelta) || 0)),
            rampUpTime: Math.max(400, (source.rampUpTime ?? defaults.rampUpTime)
                + (Number(ce.energyRampUpTimeDelta) || 0)),
            overheatTime: source.overheatTime ?? defaults.overheatTime,
            overheatRecoverTime: source.overheatRecoverTime ?? defaults.overheatRecoverTime,
            overheatCooldownTime: source.overheatCooldownTime ?? defaults.overheatCooldownTime,
            spreadMaxTime: source.spreadMaxTime ?? defaults.spreadMaxTime,
            maxSpreadAngle: source.maxSpreadAngle ?? defaults.maxSpreadAngle
        };
    },

    getExpForLevel(level) {
        // 委托 exp-system 唯一口径（升级曲线配置：combat-formulas player.expPerLevel）
        return computeMaxExp(level);
    },

    updateMaxStats() {
        const d = this.data;
        const formulas = COMBAT_FORMULAS.player || {};
        const hpFormula = formulas.maxHp || { base: 100, conMultiplier: 10 };
        const mpFormula = formulas.maxMp || { base: 100, wisMultiplier: 10, intMultiplier: 5 };
        const staminaFormula = formulas.staminaRegen || { base: 1.0, dexMultiplier: 0.01 };
        const mpRegenFormula = formulas.mpRegen || { base: 1.0, wisMultiplier: 0.08, intMultiplier: 0.02 };
        const eq = this._getEquipmentBonuses();

        const oldMaxHp = d.maxHp;
        const oldMaxMp = d.maxMp;
        // 属性加成（装备六维）与装备 maxHp/maxMp/maxStamina 一并计入
        // d.con/wis/int 已含装备六维（calculateCombatStats 差值法写入），装备 maxHp/maxMp/maxStamina 另行累加
        // 每级成长 +10 生命 / +10 魔法（1 级为 0，2 级 +10；与侍从同口径）
        const lvlHp = (d.level - 1) * 10;
        const lvlMp = (d.level - 1) * 10;
        d.maxHp = hpFormula.base + d.con * hpFormula.conMultiplier + eq.maxHp + lvlHp;
        d.maxMp = mpFormula.base + d.wis * mpFormula.wisMultiplier + d.int * mpFormula.intMultiplier + eq.maxMp + lvlMp;
        d.maxStamina = (CONFIG.STAMINA_MAX || 100) + eq.maxStamina;
        // 魔法值始终按秒恢复，不区分战斗/非战斗状态。
        d.mpRegen = Math.max(0, Math.round((mpRegenFormula.base
            + d.wis * mpRegenFormula.wisMultiplier
            + d.int * mpRegenFormula.intMultiplier) * 100) / 100);

        // HP/MP 按比例缩放，避免满血时增加属性反而掉血
        if (oldMaxHp > 0) d.hp = Math.min(d.maxHp, d.hp + (d.maxHp - oldMaxHp));
        else d.hp = d.maxHp;
        if (oldMaxMp > 0) d.mp = Math.min(d.maxMp, d.mp + (d.maxMp - oldMaxMp));
        else d.mp = d.maxMp;

        // 体力恢复速度：每点敏捷 +1%
        let regenMul = staminaFormula.base + d.dex * staminaFormula.dexMultiplier;
        if (!isFinite(regenMul) || regenMul < 0) regenMul = 1.0;
        // 流云套（稀有轻甲）：体力恢复 +12%（三件齐穿，乘算在装备/祭品倍率之后）
        if (this._armorSetActive === 'flowing') regenMul *= 1.12;
        this._staminaRegenMul = regenMul;

        // 升级所需经验：按公式动态计算
        d.maxExp = this.getExpForLevel(d.level);
    }
};

export { baseMixin };
