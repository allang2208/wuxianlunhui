/**
 * weapon-image.js — 改造栏武器贴图解析（多级回退链）
 * 从 craft-system.js 抽出，供改造面板显示武器贴图。
 */

import { ItemDatabase } from '../../items/item-database.js';

/**
 * 解析武器贴图路径，依次回退：
 * 1. 实例自身 weaponAsset.image / equipImage / slotImage / iconImage
 * 2. ItemDatabase 按 id 查找
 * 3. ItemDatabase 按 weaponId 反查（getByWeaponId 懒索引，新武器免登记）
 * @param {object} item 装备实例
 * @returns {string|null} 贴图路径，找不到返回 null
 */
export function resolveWeaponImageSrc(item) {
    if (!item) return null;
    let imgSrc = null;

    // 1. 优先使用 weaponAsset.image（hold/top-down 图片，用于改造栏展示）
    if (item.weaponAsset && item.weaponAsset.image && typeof item.weaponAsset.image === 'string') {
        imgSrc = item.weaponAsset.image;
    }
    else if (item.equipImage) imgSrc = item.equipImage;
    else if (item.slotImage) imgSrc = item.slotImage;
    else if (item.iconImage) imgSrc = item.iconImage;

    // 2. 从 ItemDatabase 根据 id 查找
    if (!imgSrc && item.id && ItemDatabase) {
        const dbItem = ItemDatabase.get(item.id);
        if (dbItem) {
            if (dbItem.weaponAsset && typeof dbItem.weaponAsset.image === 'string') {
                imgSrc = dbItem.weaponAsset.image;
            }
            if (!imgSrc) imgSrc = dbItem.equipImage || dbItem.slotImage || dbItem.iconImage;
        }
    }

    // 3. 从 ItemDatabase 根据 weaponId 反查（索引由 ItemDatabase 维护，新武器无需登记）
    if (!imgSrc && item.weaponId && ItemDatabase && ItemDatabase.getByWeaponId) {
        const dbItem = ItemDatabase.getByWeaponId(item.weaponId);
        if (dbItem) {
            if (dbItem.weaponAsset && typeof dbItem.weaponAsset.image === 'string') {
                imgSrc = dbItem.weaponAsset.image;
            }
            if (!imgSrc) imgSrc = dbItem.equipImage || dbItem.slotImage || dbItem.iconImage;
        }
    }

    return imgSrc;
}
