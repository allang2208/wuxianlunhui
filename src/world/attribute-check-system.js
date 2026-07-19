/**
 * 属性检定系统（独立模块）
 *
 * 历史：原本定义在 dungeon-event-system.js，而 dungeon-event-definitions.js
 * 又反向 import 它，形成 system → definitions → system 循环依赖；
 * 一旦加载顺序让 definitions 先求值，system 顶层 createEventConfig()
 * 访问 NEW_EVENT_CONFIGS 就会 TDZ 报错。抽出本文件后循环断开。
 *
 * 配置来源与 dungeon-event-system.js 的 createEventConfig() 同一数据链路：
 * DungeonConfig.raw.events.attributeCheck（dungeon-config.json）覆盖 defaults。
 */
import { DungeonConfig } from '../config/dungeon-config.js';

const ATTRIBUTE_CHECK_DEFAULTS = {
    baseSuccessRate: 20,
    attrMultiplier: 1,
    maxSuccessRate: 95,
    minSuccessRate: 5,
};

function _getConfig() {
    const fromJson = (DungeonConfig.raw && DungeonConfig.raw.events && DungeonConfig.raw.events.attributeCheck) || {};
    return { ...ATTRIBUTE_CHECK_DEFAULTS, ...fromJson };
}

/**
 * 属性检定工具
 */
export const AttributeCheckSystem = {
    /**
     * 执行属性检定
     * @param {Player} player - 玩家对象
     * @param {string} attribute - 属性名 'str'|'dex'|'con'|'int'|'wis'|'luck'
     * @param {number} baseRate - 基础成功率
     * @returns {Object} { success: boolean, rate: number, roll: number }
     */
    check(player, attribute, baseRate = 20) {
        const config = _getConfig();

        // 获取属性值
        let attrValue = 0;
        if (player && player.data) {
            attrValue = player.data[attribute] || 0;
        }

        // 计算成功率
        let successRate = baseRate + attrValue * config.attrMultiplier;
        successRate = Math.max(config.minSuccessRate, Math.min(config.maxSuccessRate, successRate));

        // 随机判定
        const roll = Math.random() * 100;
        const success = roll < successRate;

        return {
            success,
            rate: successRate,
            roll,
            attribute,
            attrValue,
        };
    },

    /**
     * 获取检定描述文本
     * @param {Object} result - 检定结果
     * @returns {string}
     */
    getResultText(result) {
        const attrNames = {
            str: '力量', dex: '敏捷', con: '体质',
            int: '智力', wis: '精神', luck: '幸运',
        };
        const attrName = attrNames[result.attribute] || result.attribute;

        if (result.success) {
            return `【成功】${attrName}检定：${result.attrValue}点 → ${result.rate.toFixed(1)}% 成功率，掷出 ${result.roll.toFixed(1)}`;
        } else {
            return `【失败】${attrName}检定：${result.attrValue}点 → ${result.rate.toFixed(1)}% 成功率，掷出 ${result.roll.toFixed(1)}`;
        }
    },
};
