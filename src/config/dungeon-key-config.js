/**
 * 地牢等级与商店时空锚点钥匙的唯一映射。
 * 购买后的旧物品实例可能没有 _id/shopOnly，因此兼容按固定名称识别。
 */
export const DUNGEON_KEY_BY_GRADE = Object.freeze({
    F: Object.freeze({ id: 'anchorTokenF', name: 'F 级时空锚点代币' }),
    E: Object.freeze({ id: 'anchorTokenE', name: 'E 级时空锚点代币' }),
    D: Object.freeze({ id: 'anchorTokenD', name: 'D 级时空锚点代币' }),
    C: Object.freeze({ id: 'anchorTokenC', name: 'C 级时空锚点代币' }),
    B: Object.freeze({ id: 'anchorTokenB', name: 'B 级时空锚点代币' }),
    A: Object.freeze({ id: 'anchorTokenA', name: 'A 级时空锚点代币' }),
});

export function getDungeonKeyRequirement(grade) {
    return DUNGEON_KEY_BY_GRADE[grade] || DUNGEON_KEY_BY_GRADE.F;
}

export function isDungeonKeyItem(item, grade = null) {
    if (!item) return false;
    const candidates = grade
        ? [getDungeonKeyRequirement(grade)]
        : Object.values(DUNGEON_KEY_BY_GRADE);
    return candidates.some((key) =>
        item._id === key.id || item.id === key.id || item.name === key.name);
}

export function countDungeonKeys(items, grade) {
    return (Array.isArray(items) ? items : []).reduce((total, item) =>
        total + (isDungeonKeyItem(item, grade) ? Math.max(1, Number(item.stack) || 1) : 0), 0);
}
