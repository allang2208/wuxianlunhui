/**
 * tribute-math.js — 祭品效果聚合纯计算核（无 Phaser / DOM / Game 依赖）
 *
 * 2026-08-23 从 tribute-effects.js 抽出：Companion（自称"无 Phaser 依赖"的纯数据
 * 模型，供 Node 契约测试直测）需要友军祭品乘率，但 tribute-effects.js 顶层
 * import game.js 会传递拉入 Phaser，导致 Node 下 import companion.js 即
 * "window is not defined"，9 个仓鼠契约测试全挂。
 *
 * 本模块只依赖 world122-tribute-store.js（纯状态仓库），Node 可直测。
 * 面向玩家面板/特效/掉落的其余祭品接口仍留在 tribute-effects.js，
 * 并由其转导出本模块的接口以保持既有消费方不变。
 */
import { getActiveWorld122TributeItems } from '../world/world122-tribute-store.js';

/** 聚合一组祭品物品的效果：每个键为 Π(1 + p/100) 的乘算倍率（无该键效果时为 1）；
 * 以 Flat 结尾的键为固定值（非百分比），按加和聚合（如 hpRegenFlat 每秒+1） */
export function aggregateTributeEffects(items) {
    const total = {};
    for (const item of items) {
        const effects = item && item.effects;
        if (!effects) continue;
        for (const [key, value] of Object.entries(effects)) {
            if (typeof value === 'number' && Number.isFinite(value)) {
                if (key.endsWith('Flat')) {
                    total[key] = (total[key] || 0) + value;
                } else {
                    total[key] = (total[key] ?? 1) * (1 + value / 100);
                }
            }
        }
    }
    return total;
}

/** 聚合当前生效祭品的效果（位面祭坛是唯一效果源：主神空间、世界和地牢共用同一份 30 分钟状态） */
export function getTributeEffects() {
    return aggregateTributeEffects(getActiveWorld122TributeItems());
}

/** 友军攻击倍率（Companion.getPhysicalAttackDamage 消费） */
export function getTributeFriendlyAtkMul() {
    return getTributeEffects().friendlyAtkPercent ?? 1;
}

/** 友军生命倍率（Companion.updateMaxStats 消费） */
export function getTributeFriendlyMaxHpMul() {
    return getTributeEffects().friendlyMaxHpPercent ?? 1;
}

/** 基础视野倍率（VisionSourceRegistry.radiusOf 消费；黄金星象仪 visionRangePercent） */
export function getTributeVisionRangeMul() {
    return getTributeEffects().visionRangePercent ?? 1;
}
