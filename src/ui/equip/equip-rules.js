// ============================================================

import { isTwoHanded } from '../../config/gun-ammo.js';
import { getShieldDefenseValues } from '../../config/shield-config.js';
// 共享装备规则（2026-08-12）
// 玩家与侍从共用同一套装备判定/加成口径——队员装备不再各写一套。
// canEquipSlot：从 drag-drop-manager 抽出（主手武器/副手支援物/双手互斥/按 equipSlot）。
// getEquipmentBonuses：从 player base._getEquipmentBonuses 抽出（bonusStats/bonusPerEnhance/defense）。
// ============================================================

const OFFHAND_SUPPORT_TYPES = new Set(['shield', 'spellbook', 'magic_book']);

/**
 * 副手支援物唯一口径：当前只实装盾牌，预留 spellbook/magic_book 给后续魔法书。
 * 枪械、法杖、剑等主手武器一律不能进入 offhand/ring2。
 */
export function isOffhandSupportItem(item) {
    if (!item) return false;
    return OFFHAND_SUPPORT_TYPES.has(item.offhandType)
        || OFFHAND_SUPPORT_TYPES.has(item.weaponType)
        || item.category === 'magic_book';
}

/** 装备槽位判定（玩家/侍从通用） */
export function canEquipSlot(item, slot) {
    if (!item || !slot) return true;
    const isWeaponSlot = (slot === 'weapon' || slot === 'weapon2');
    const isOffhandSlot = (slot === 'offhand' || slot === 'ring2');
    const isOffhandSupport = isOffhandSupportItem(item);
    const isWeaponItem = item.weaponType || (item.category && item.category.includes('weapon')) || item.rangedType;
    if (isWeaponItem && !isWeaponSlot && !isOffhandSlot) return false;
    // 主手只接受武器，且盾牌/魔法书等副手支援物不能反装主手。
    if (isWeaponSlot) return !!isWeaponItem && !isOffhandSupport;
    // 副手只接受盾牌或魔法书；法杖、枪械、剑等即使是单手也禁止。
    if (isOffhandSlot) return isOffhandSupport && !item.isTwoHanded;
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
            totals.defense += it.weaponType === 'shield'
                ? getShieldDefenseValues(it).defense
                : Math.floor((it.defense.base || 0) + (it.defense.perEnhance || 0) * el);
        }
    }
    return totals;
}

/** 武器是否单手（只描述持握规格；副手资格由 isOffhandSupportItem 单独决定） */
export function isOneHandedItem(item) {
    if (!item) return false;
    if (typeof item.isTwoHanded === 'boolean') return !item.isTwoHanded;
    return !isTwoHanded(item);
}
