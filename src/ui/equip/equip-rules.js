// ============================================================
// 共享装备规则（2026-08-12）
// 玩家与侍从共用同一套装备判定/加成口径——队员装备不再各写一套。
// canEquipSlot：从 drag-drop-manager 抽出（武器进武器槽/盾限副手/双手互斥/按 equipSlot）。
// getEquipmentBonuses：从 player base._getEquipmentBonuses 抽出（bonusStats/bonusPerEnhance/defense）。
// ============================================================

/** 装备槽位判定（玩家/侍从通用） */
export function canEquipSlot(item, slot) {
    if (!item || !slot) return true;
    const isWeaponSlot = (slot === 'weapon' || slot === 'weapon2');
    const isOffhandSlot = (slot === 'offhand' || slot === 'ring2');
    const isWeaponItem = item.weaponType || (item.category && item.category.includes('weapon')) || item.rangedType;
    if (isWeaponItem && !isWeaponSlot && !isOffhandSlot) return false;
    if (isWeaponSlot && !isWeaponItem) return false;
    // 盾类只能装备到副手栏
    if (item.weaponType === 'shield' && !isOffhandSlot) return false;
    // 所有武器都可以装备到 offhand/ring2（副手武器槽），但双手武器除外
    if (isOffhandSlot && isWeaponItem) {
        if (item.isTwoHanded) return false;
        return true;
    }
    if (!isWeaponSlot && !isOffhandSlot && item.equipSlot !== slot) return false;
    return true;
}

/** 装备加成汇总（六维/攻防/生命魔法等；玩家/侍从通用） */
export function getEquipmentBonuses(equipments) {
    const totals = { str: 0, dex: 0, int: 0, con: 0, wis: 0, luck: 0, atk: 0, matk: 0, crit: 0, maxHp: 0, maxMp: 0, maxStamina: 0, defense: 0 };
    if (!equipments) return totals;
    for (const slotKey of Object.keys(equipments)) {
        const it = equipments[slotKey];
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
}

/** 武器是否单手（供自动槽位选择：单手可进副手、双手只进主手） */
export function isOneHandedItem(item) {
    if (!item) return false;
    if (typeof item.isTwoHanded === 'boolean') return !item.isTwoHanded;
    return !['pkm', 'akm', 'm416', 'qbz191', 'qjb201', 'shotgun', 'energy_lmg'].includes(item.weaponType);
}
