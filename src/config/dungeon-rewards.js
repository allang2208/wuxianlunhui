import { COMBAT_FORMULAS } from './combat-formulas.js';
import dungeonConfigData from '../../data/dungeon-config.json';

const FALLBACK_RULE = Object.freeze({
    monsterGoldMultiplier: 1,
    combatClearGold: Object.freeze({ min: 50, max: 149 }),
    bossGold: Object.freeze({ min: 2000, max: 2499 }),
    completionGold: 500,
});

const integer = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
};

const range = (configured, fallback) => {
    const min = Math.max(0, integer(configured?.min, fallback.min));
    const max = Math.max(min, integer(configured?.max, fallback.max));
    return { min, max };
};

/** 地牢主动收益规则唯一读取入口；非地牢场景保留旧规则。 */
export function getDungeonRewardRule(dungeonType) {
    const dungeon = (dungeonConfigData.dungeonList || {})[dungeonType];
    if (!dungeon) return FALLBACK_RULE;
    const configured = (COMBAT_FORMULAS.dungeonRewards || {})[dungeon.grade] || {};
    const multiplier = Number(configured.monsterGoldMultiplier);
    return {
        monsterGoldMultiplier: Number.isFinite(multiplier) && multiplier >= 0 ? multiplier : 1,
        combatClearGold: range(configured.combatClearGold, FALLBACK_RULE.combatClearGold),
        bossGold: range(configured.bossGold, FALLBACK_RULE.bossGold),
        completionGold: Math.max(0, integer(configured.completionGold, FALLBACK_RULE.completionGold)),
    };
}

export function rollGoldRange(configuredRange) {
    const min = Math.max(0, integer(configuredRange?.min, 0));
    const max = Math.max(min, integer(configuredRange?.max, min));
    return min + Math.floor(Math.random() * (max - min + 1));
}

export function rollDungeonCombatGold(dungeonType) {
    return rollGoldRange(getDungeonRewardRule(dungeonType).combatClearGold);
}

export function rollDungeonBossGold(dungeonType) {
    return rollGoldRange(getDungeonRewardRule(dungeonType).bossGold);
}

export function getDungeonCompletionGold(dungeonType) {
    return getDungeonRewardRule(dungeonType).completionGold;
}
