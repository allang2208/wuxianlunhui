import { COMBAT_FORMULAS } from './combat-formulas.js';
import dungeonConfigData from '../../data/dungeon-config.json';

export const ENEMY_DIRECT_STAT_OVERRIDE_KEYS = Object.freeze(['atk', 'matk', 'mdef']);

const DEFAULT_FORMULAS = Object.freeze({
    maxHp: { base: 100, conMultiplier: 5 },
    attack: { base: 0, strMultiplier: 0.5, dexMultiplier: 0.5, round: true },
    defense: { conMultiplier: 1.5, strMultiplier: 0.3, round: 'floor' },
    magicAttack: { base: 0, intMultiplier: 0.5, wisMultiplier: 0.5, round: 'floor' },
    magicDefense: { wisMultiplier: 1.2, intMultiplier: 0.3, round: 'floor' },
    crit: { base: 2, luckMultiplier: 1, round: 'floor' },
    critResist: { conMultiplier: 1, round: 'floor' },
    combatLevel: {
        base: 1,
        strMultiplier: 0.08,
        dexMultiplier: 0.08,
        conMultiplier: 0.10,
        intMultiplier: 0.08,
        wisMultiplier: 0.08,
        luckMultiplier: 0.04,
        maxHpContribution: { divisor: 100, exponent: 0.5, multiplier: 1.5, cap: 8 },
        speedContribution: { baseline: 80, divisor: 40, multiplier: 1, min: 0, cap: 4 },
        rankBonus: { normal: 0, minor: 1, elite: 3, lord: 5, boss: 7 },
        round: 'round'
    }
});

const ATTRIBUTE_KEYS = Object.freeze(['str', 'dex', 'con', 'int', 'wis', 'luck']);

/** 地牢专属出生倍率；显式白名单避免共享怪物在其它地牢或位面被放大。 */
export function getDungeonEnemyStatMultipliers(dungeonType, enemyKey) {
    const dungeon = dungeonConfigData.dungeonList?.[dungeonType];
    const profile = dungeonConfigData.monsterStatProfiles?.[dungeon?.monsterStatProfile];
    if (!profile?.enemyKeys?.includes(enemyKey)) return null;
    return profile.byGrade?.[dungeon.grade] || null;
}

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function applyFormulaRounding(value, formula) {
    if (formula?.round === true || formula?.round === 'round') return Math.round(value);
    if (formula?.round === 'ceil' || formula?.ceil === true) return Math.ceil(value);
    if (formula?.round === false && formula?.floor !== true) return value;
    return Math.floor(value);
}

function evaluateFormula(formula, attributes) {
    const source = formula || {};
    let value = finiteNumber(source.base);
    for (const key of ATTRIBUTE_KEYS) {
        value += attributes[key] * finiteNumber(source[`${key}Multiplier`]);
    }
    return applyFormulaRounding(value, source);
}

function clamp(value, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
    return Math.min(max, Math.max(min, value));
}

/**
 * 图鉴综合战斗等级：六维是主体；生命、移速只提供封顶的非线性补充，避免高血量或高速单项垄断等级。
 * 配置等级继续用于地牢成长和经验语义，本指标不参与运行时成长结算。
 */
export function deriveEnemyCombatLevel(attributes = {}, configSource = attributes) {
    const formula = COMBAT_FORMULAS.enemy?.calculateCombatStats?.combatLevel || DEFAULT_FORMULAS.combatLevel;
    const normalized = Object.fromEntries(
        ATTRIBUTE_KEYS.map((key) => [key, finiteNumber(attributes[key])])
    );

    const baseScore = finiteNumber(formula.base, 1);
    let attributeScore = 0;
    for (const key of ATTRIBUTE_KEYS) {
        attributeScore += normalized[key] * finiteNumber(formula[`${key}Multiplier`]);
    }

    const hpCfg = formula.maxHpContribution || {};
    const hpDivisor = Math.max(1, finiteNumber(hpCfg.divisor, 100));
    const hpExponent = Math.max(0, finiteNumber(hpCfg.exponent, 0.5));
    const hpInput = Math.max(0, finiteNumber(configSource?.maxHp ?? attributes?.maxHp));
    const hpScore = clamp(
        Math.pow(hpInput / hpDivisor, hpExponent) * finiteNumber(hpCfg.multiplier, 1.5),
        finiteNumber(hpCfg.min, 0),
        finiteNumber(hpCfg.cap, 8)
    );

    const speedCfg = formula.speedContribution || {};
    const speedDivisor = Math.max(1, finiteNumber(speedCfg.divisor, 40));
    const speedInput = Math.max(0, finiteNumber(configSource?.speed ?? attributes?.speed));
    const speedScore = clamp(
        ((speedInput - finiteNumber(speedCfg.baseline, 80)) / speedDivisor)
            * finiteNumber(speedCfg.multiplier, 1),
        finiteNumber(speedCfg.min, 0),
        finiteNumber(speedCfg.cap, 4)
    );

    const rankBonus = finiteNumber(formula.rankBonus?.[configSource?.rank], 0);
    const raw = baseScore + attributeScore + hpScore + speedScore + rankBonus;
    return {
        combatLevel: Math.max(1, applyFormulaRounding(raw, formula)),
        baseScore,
        attributeScore,
        hpScore,
        speedScore,
        rankBonus,
        raw
    };
}

/**
 * 怪物出生时基础数值的唯一纯函数口径。
 * attributes 提供已经补齐默认值的六维；configSource 只读取真正允许直配的字段。
 * 地牢成长、阶段变身和临时 Buff 属于出生后的运行时层，不在这里计算。
 */
export function deriveEnemyBaseStats(attributes = {}, configSource = attributes) {
    const formulas = COMBAT_FORMULAS.enemy?.calculateCombatStats || {};
    const normalized = Object.fromEntries(
        ATTRIBUTE_KEYS.map((key) => [key, finiteNumber(attributes[key])])
    );
    const hpFormula = formulas.maxHp || DEFAULT_FORMULAS.maxHp;
    const formulaMaxHp = finiteNumber(hpFormula.base, 100)
        + normalized.con * finiteNumber(hpFormula.conMultiplier, 5);

    const result = {
        maxHp: configSource?.maxHp != null ? finiteNumber(configSource.maxHp, formulaMaxHp) : formulaMaxHp,
        hp: 0,
        atk: evaluateFormula(formulas.attack || DEFAULT_FORMULAS.attack, normalized),
        def: evaluateFormula(formulas.defense || DEFAULT_FORMULAS.defense, normalized),
        matk: evaluateFormula(formulas.magicAttack || DEFAULT_FORMULAS.magicAttack, normalized),
        mdef: evaluateFormula(formulas.magicDefense || DEFAULT_FORMULAS.magicDefense, normalized),
        crit: evaluateFormula(formulas.crit || DEFAULT_FORMULAS.crit, normalized),
        critRes: evaluateFormula(formulas.critResist || DEFAULT_FORMULAS.critResist, normalized),
        level: finiteNumber(configSource?.level, 1)
    };
    result.hp = configSource?.hp != null ? finiteNumber(configSource.hp, result.maxHp) : result.maxHp;

    for (const key of ENEMY_DIRECT_STAT_OVERRIDE_KEYS) {
        if (configSource?.[key] != null) result[key] = finiteNumber(configSource[key], result[key]);
    }
    return result;
}

export default deriveEnemyBaseStats;
