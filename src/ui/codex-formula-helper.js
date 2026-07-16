import { COMBAT_FORMULAS } from '../config/combat-formulas.js';

const DEFAULT_ENEMY_STATS = {
    attack: { base: 0, strMultiplier: 0.5, dexMultiplier: 0.5, round: true },
    defense: { conMultiplier: 1.5, strMultiplier: 0.3, round: 'floor' },
    magicAttack: { base: 0, intMultiplier: 0.5, wisMultiplier: 0.5, round: 'floor' },
    magicDefense: { wisMultiplier: 1.2, intMultiplier: 0.3, round: 'floor' },
    crit: { base: 2, luckMultiplier: 1.0, round: 'floor' },
    critResist: { conMultiplier: 1.0, round: 'floor' }
};

function applyRounding(value, method) {
    if (method === 'round') return Math.round(value);
    if (method === 'ceil') return Math.ceil(value);
    return Math.floor(value);
}

export const CodexFormulaHelper = {
    /**
     * 根据敌人六维与公式计算图鉴展示用的战斗属性
     * @param {Object} d - 敌人数据（从 data-loader 转换后的 ENEMY_DATA）
     * @returns {{atk:number, def:number, matk:number, mdef:number, crit:number, critRes:number}}
     */
    calculateCombatStats(d = {}) {
        const eform = COMBAT_FORMULAS.enemy?.calculateCombatStats || DEFAULT_ENEMY_STATS;
        const str = d.str || 0;
        const dex = d.dex || 0;
        const con = d.con || 0;
        const int = d.int || 0;
        const wis = d.wis || 0;
        const luck = d.luck || 0;

        const calcFrom = (formula) => {
            const f = formula || {};
            let v = (f.base || 0)
                + str * (f.strMultiplier || 0)
                + dex * (f.dexMultiplier || 0)
                + con * (f.conMultiplier || 0)
                + int * (f.intMultiplier || 0)
                + wis * (f.wisMultiplier || 0)
                + luck * (f.luckMultiplier || 0);
            return applyRounding(v, f.round);
        };

        return {
            atk: d.atk ?? calcFrom(eform.attack || DEFAULT_ENEMY_STATS.attack),
            def: d.def ?? calcFrom(eform.defense || DEFAULT_ENEMY_STATS.defense),
            matk: d.matk ?? calcFrom(eform.magicAttack || DEFAULT_ENEMY_STATS.magicAttack),
            mdef: d.mdef ?? calcFrom(eform.magicDefense || DEFAULT_ENEMY_STATS.magicDefense),
            crit: d.crit ?? calcFrom(eform.crit || DEFAULT_ENEMY_STATS.crit),
            critRes: d.critRes ?? calcFrom(eform.critResist || DEFAULT_ENEMY_STATS.critResist)
        };
    },

    /**
     * 计算经验值
     * @param {Object} d
     */
    calculateExpValue(d = {}) {
        if (d.expValue != null) return d.expValue;
        const formula = COMBAT_FORMULAS.enemy?.expValue || { base: 10, levelMultiplier: 5 };
        return formula.base + (d.level || 1) * formula.levelMultiplier;
    }
};

export default CodexFormulaHelper;
