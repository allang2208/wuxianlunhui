/**
 * craft-effects.js — 改造效果聚合与应用（registry 驱动）
 *
 * 三角机制：craft-config.json 定义选项效果 → craft-effect-registry.js 注册
 * applyMode/display → 本模块按 applyMode 聚合 → 战斗代码消费 _craftEffects。
 * 新增改造效果只需：① craft-config.json 加 effects ② registry 注册条目，
 * 聚合自动生效，无需再改收集代码。
 */

import { CRAFT_EFFECT_REGISTRY } from '../../config/craft-effect-registry.js';

/**
 * 按 registry 的 applyMode 聚合一组已装备配件的效果。
 * - flag：布尔 OR（任一配件提供即为 true）
 * - override：后选覆盖先选（仅真值覆盖，与历史行为一致）
 * - add / multiply：数值求和（multiply 描述消费端的乘算方式，聚合仍为加和）
 * 返回稀疏对象：只包含实际存在的效果键（消费端均以 falsy 判缺省，与旧的全量零值对象等价）。
 * @param {Object<string,string>} itemMods item._craftData（slotId -> modId）
 * @param {object} weaponConfig 该武器的改造配置（含 options）
 * @returns {object} 聚合后的 _craftEffects
 */
export function aggregateCraftEffects(itemMods, weaponConfig) {
    const result = {};
    if (!itemMods || !weaponConfig || !weaponConfig.options) return result;
    for (const slotId in itemMods) {
        const modId = itemMods[slotId];
        const slotOpts = weaponConfig.options[slotId];
        if (!slotOpts) continue;
        const opt = slotOpts.find(o => o.id === modId);
        if (!opt || !opt.effects) continue;
        for (const [key, value] of Object.entries(opt.effects)) {
            const reg = CRAFT_EFFECT_REGISTRY[key];
            const mode = reg ? reg.applyMode : 'add';
            if (mode === 'flag') {
                result[key] = result[key] || !!value;
            } else if (mode === 'override') {
                if (value) result[key] = value;
            } else {
                result[key] = (result[key] || 0) + value;
            }
        }
    }
    return result;
}

/**
 * 改造效果应用后的玩家侧联动：按装备所在槽位重新初始化弹药状态
 * （弹夹容量/换弹时间改造立即生效）。
 * @param {object} player
 * @param {object} equippedItem 刚写入 _craftEffects 的物品
 */
export function applyModEffectsToPlayer(player, equippedItem) {
    if (!player || !equippedItem || !player._initAmmoForSlot) return;
    const slots = ['weapon', 'offhand', 'weapon2', 'ring2'];
    for (const slot of slots) {
        const item = player.equipments[slot];
        if (item && item.weaponId === equippedItem.weaponId) {
            player._initAmmoForSlot(slot);
        }
    }
}
