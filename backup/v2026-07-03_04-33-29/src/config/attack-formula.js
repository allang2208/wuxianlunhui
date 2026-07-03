// 通用武器攻击力计算工具
// 将按 weaponId 硬编码的公式统一为配置驱动的计算方式
// 新增武器只需在 EquipDataManager 中配置 attackFormula，无需修改代码

/**
 * 根据公式配置计算武器攻击力
 * @param {Object} formula - attackFormula 配置
 * @param {Object} playerData - 玩家数据（包含 str, dex, int, con, wis, luck 等）
 * @param {number} enhanceLevel - 强化等级
 * @param {string} variant - 公式变体（如 'slugMode'），可选
 * @returns {number} 攻击力（已 Math.round）
 */
function calculateAttackFormula(formula, playerData, enhanceLevel, variant) {
    if (!formula) return 0;

    // 如果指定了变体，使用变体公式
    let effectiveFormula = formula;
    if (variant && formula.variants && formula.variants[variant]) {
        effectiveFormula = formula.variants[variant];
    }

    const el = enhanceLevel || 0;
    const base = effectiveFormula.base || 0;
    const enhanceFlat = effectiveFormula.enhanceFlat || 0;

    let weaponAtk = base + el * enhanceFlat;

    const attrs = effectiveFormula.attrs || [];
    for (const attr of attrs) {
        const val = playerData[attr.key] || 0;
        const attrBase = attr.base || 0;
        const attrPerEnhance = attr.perEnhance || 0;
        weaponAtk += val * (attrBase + attrPerEnhance * el);
    }

    return Math.round(weaponAtk);
}

/**
 * 从武器配置中解析 attackFormula，支持从 stats 字段自动推断（无配置时）
 * @param {Object} item - 武器装备对象
 * @returns {Object|null} attackFormula 配置
 */
function getAttackFormula(item) {
    if (!item) return null;
    // 优先使用 item 上定义的 attackFormula
    if (item.attackFormula) return item.attackFormula;

    // 从 stats 的 "物理攻击" 字段推断基础值
    const atkStat = item.stats && item.stats.find(s => s.name === '物理攻击');
    if (atkStat && atkStat.value) {
        const match = String(atkStat.value).match(/(\d+)/);
        if (match) {
            const baseMin = parseInt(match[1]);
            return { base: baseMin, enhanceFlat: 0, attrs: [] };
        }
    }
    return null;
}

/**
 * 统一计算武器攻击力（包含精通、附魔、改造等后处理）
 * 在 Player.getCurrentWeaponAtk 中调用此函数
 * @param {Object} item - 当前武器
 * @param {Object} playerData - 玩家数据
 * @param {Object} skills - 玩家技能
 * @returns {number} 最终攻击力
 */
function computeWeaponAttack(item, playerData, skills) {
    if (!item) return 0;

    const formula = getAttackFormula(item);
    if (!formula) return 0;

    const el = item.enhanceLevel || 0;
    const wType = item.weaponType;

    // 检查改造变体（如 slugMode）
    let variant = null;
    const ce = item._craftEffects;
    if (ce && ce.slugMode && formula.variants && formula.variants.slugMode) {
        variant = 'slugMode';
    }

    let weaponAtk = calculateAttackFormula(formula, playerData, el, variant);

    // 改造效果：百分比伤害加成
    if (ce && ce.damagePercent) {
        weaponAtk = Math.round(weaponAtk * (1 + ce.damagePercent));
    }

    // 剑精通加成
    if (skills && skills.swordMastery) {
        weaponAtk += skills.swordMastery.getEffect(skills.swordMastery.level).atkBonus;
    }

    // 机枪精通加成
    if (isMachineGun(wType) && skills && skills.machineGunMastery) {
        const mg = skills.machineGunMastery.getEffect(skills.machineGunMastery.level);
        weaponAtk = Math.round(weaponAtk * (1 + mg.damagePercent) + mg.damageBonus);
    }

    // 步枪精通加成
    if ((wType === 'akm' || wType === 'qbz191') && skills && skills.rifleMastery) {
        const rm = skills.rifleMastery.getEffect(skills.rifleMastery.level);
        weaponAtk = Math.round(weaponAtk * (1 + rm.damagePercent) + rm.damageBonus);
    }

    // 手枪精通加成
    if (wType === 'pistol' && skills && skills.pistolMastery) {
        const pm = skills.pistolMastery.getEffect(skills.pistolMastery.level);
        weaponAtk = Math.round(weaponAtk * (1 + pm.damagePercent) + pm.damageBonus);
    }

    // 散弹枪精通加成
    if (wType === 'shotgun' && skills && skills.shotgunMastery) {
        const sm = skills.shotgunMastery.getEffect(skills.shotgunMastery.level);
        weaponAtk = Math.round(weaponAtk * (1 + sm.damagePercent));
    }

    // 弓精通加成
    if (wType === 'bow' && skills && skills.bowMastery) {
        const bm = skills.bowMastery.getEffect(skills.bowMastery.level);
        weaponAtk = Math.round(weaponAtk * (1 + bm.damagePercent) + bm.damageBonus);
    }

    // 附魔效果：百分比攻击力加成
    const ee = item._enchantEffects;
    if (ee && ee.damagePercent) {
        weaponAtk = Math.round(weaponAtk * (1 + ee.damagePercent));
    }

    return weaponAtk;
}

// 辅助函数：判断是否为机枪
function isMachineGun(weaponType) {
    return weaponType === 'pkm' || weaponType === 'qjb201' || weaponType === 'energy_lmg';
}

export { calculateAttackFormula, getAttackFormula, computeWeaponAttack, isMachineGun };
