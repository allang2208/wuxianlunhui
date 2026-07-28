/**
 * 祭品加持（Dungeon Empower）——本次出征的强度状态（纯状态 + JSON 配置，config 层可单测）
 *
 * 出征面板投入祭品 → 强度值 S（稀有度点数：普通1/优质2/稀有3/史诗4/神话5/传说6，堆叠按数量计）；
 * depart 时 setStrength 注入，DungeonMapSystem.shutdown 时 reset。
 * 消费方：exp-system（有效等级 +levelBonus、经验 ×expMul）、enemy.js（属性成长 ΔL 加大）、
 * damageable-entity（金币 ×goldMul）、tribute-effects（掉率 +dropChanceBonusPp、稀有度封顶 +rarityCapBoost）。
 */
import combatFormulasData from '../../data/combat-formulas.json';

let _strength = 0;

const _cfg = () => combatFormulasData.enemy?.empower || {};

export const DungeonEmpower = {
    get strength() { return _strength; },

    /** 出征时注入强度（按 capStrength 钳制） */
    setStrength(s) {
        const cap = _cfg().capStrength ?? 12;
        _strength = Math.max(0, Math.min(cap, Math.floor(s || 0)));
    },

    /** 地牢结束/离开清零 */
    reset() { _strength = 0; },

    /** 稀有度 → 强度点数（与 RARITY_ORDER 同序） */
    rarityPoints(rarity) {
        const order = ['common', 'uncommon', 'rare', 'epic', 'mythic', 'legendary'];
        const idx = order.indexOf(rarity || 'common');
        return idx < 0 ? 1 : idx + 1;
    },

    /** 由投入物品列表计算强度（[{rarity, count}]） */
    strengthFromItems(items) {
        return (items || []).reduce((sum, it) => sum + (it ? this.rarityPoints(it.rarity) * (it.count || 1) : 0), 0);
    },

    /** 怪物有效等级加成（+levelPerStrength × S） */
    levelBonus() { return _strength * (_cfg().levelPerStrength ?? 4); },

    /** 经验倍率 ×(1 + expPerStrength × S) */
    expMul() { return 1 + _strength * (_cfg().expPerStrength ?? 0.08); },

    /** 金币倍率 ×(1 + goldPerStrength × S) */
    goldMul() { return 1 + _strength * (_cfg().goldPerStrength ?? 0.15); },

    /** 祭品掉率加成（百分点） */
    dropChanceBonusPp() { return _strength * (_cfg().dropChancePerStrength ?? 0); },

    /** 掉落稀有度封顶提升档数（S ≥ rarityCapStrength 时 +1） */
    rarityCapBoost() { return _strength >= (_cfg().rarityCapStrength ?? 6) ? 1 : 0; },
};
