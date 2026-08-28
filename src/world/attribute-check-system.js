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
    softMaxStart: 80,
    softMinStart: 20,
};

function _getConfig() {
    const fromJson = (DungeonConfig.raw && DungeonConfig.raw.events && DungeonConfig.raw.events.attributeCheck) || {};
    return { ...ATTRIBUTE_CHECK_DEFAULTS, ...fromJson };
}

function _finiteOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

/**
 * 中段保持线性；越过软阈值后以指数曲线逼近最终上下限。
 * 曲线在阈值处连续且一阶斜率为 1，避免跨过阈值时出现数值跳变。
 */
function _applySoftBounds(rawRate, config) {
    const minRate = _finiteOr(config.minSuccessRate, ATTRIBUTE_CHECK_DEFAULTS.minSuccessRate);
    const maxRate = Math.max(minRate, _finiteOr(config.maxSuccessRate, ATTRIBUTE_CHECK_DEFAULTS.maxSuccessRate));
    const softMinStart = Math.max(minRate, Math.min(maxRate, _finiteOr(config.softMinStart, ATTRIBUTE_CHECK_DEFAULTS.softMinStart)));
    const softMaxStart = Math.max(softMinStart, Math.min(maxRate, _finiteOr(config.softMaxStart, ATTRIBUTE_CHECK_DEFAULTS.softMaxStart)));

    let rate = rawRate;
    if (rate < softMinStart) {
        const span = softMinStart - minRate;
        rate = span > 0
            ? minRate + span * Math.exp((rate - softMinStart) / span)
            : minRate;
    } else if (rate > softMaxStart) {
        const span = maxRate - softMaxStart;
        rate = span > 0
            ? maxRate - span * Math.exp(-(rate - softMaxStart) / span)
            : maxRate;
    }

    return Math.max(minRate, Math.min(maxRate, rate));
}

/**
 * 属性检定工具
 */
export const AttributeCheckSystem = {
    /**
     * 只计算成功率，不消耗随机数；事件选项预览与实际检定共用此入口。
     */
    getSuccessRate(player, attribute, baseRate = undefined) {
        const config = _getConfig();
        const attrValue = player && player.data ? _finiteOr(player.data[attribute], 0) : 0;
        const configuredBase = _finiteOr(baseRate, _finiteOr(config.baseSuccessRate, ATTRIBUTE_CHECK_DEFAULTS.baseSuccessRate));
        const multiplier = _finiteOr(config.attrMultiplier, ATTRIBUTE_CHECK_DEFAULTS.attrMultiplier);
        const rawRate = configuredBase + attrValue * multiplier;
        const rate = _applySoftBounds(rawRate, config);

        return { rate, rawRate, attribute, attrValue };
    },

    /**
     * 执行属性检定
     * @param {Player} player - 玩家对象
     * @param {string} attribute - 属性名 'str'|'dex'|'con'|'int'|'wis'|'luck'
     * @param {number} baseRate - 基础成功率；省略时读取全局配置
     * @returns {Object} { success: boolean, rate: number, rawRate: number, roll: number }
     */
    check(player, attribute, baseRate = undefined) {
        const rateInfo = this.getSuccessRate(player, attribute, baseRate);
        // 随机判定
        const roll = Math.random() * 100;
        const success = roll < rateInfo.rate;

        return {
            success,
            roll,
            ...rateInfo,
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
