// ============================================================
// 侍从成长规则（2026-08-12 框架）
// 需求：不同队员成长规则不同，**不硬编码**，留接口。
// 规则注册表：GROWTH_RULES[id] = (companion, points) => { str, dex, int, con, wis, luck }
//   - companion：Companion 实例（可读当前 data 做条件分配）
//   - points：本次升级获得的可分配点数（当前与玩家一致 = 2 点/级）
//   - 返回：各属性增量（可部分/全部为 0，总和 <= points）
// 新增队员成长规则 = companion-config.json 的 growthRule 字段 + 本表注册，无需改业务代码。
// 也可运行时 registerGrowthRule(id, fn) 扩展（如事件/装备驱动的成长变异）。
// ============================================================

const GROWTH_RULES = {
    // 剑盾护卫（伊莉丝）：力量/体质为主，每级 2 点按 1:1 投入
    warrior(companion, points) {
        const str = Math.ceil(points / 2);
        const con = Math.floor(points / 2);
        return { str, dex: 0, int: 0, con, wis: 0, luck: 0 };
    },
    // 占星术士（露娜）：每级固定 +1 智力 +1 精神（2 点 1:1）
    mage(companion, points) {
        const int = Math.ceil(points / 2);
        const wis = points - int;
        return { str: 0, dex: 0, int, con: 0, wis, luck: 0 };
    },
    // 巡林猎手：敏捷为主，运气/体质辅
    ranger(companion, points) {
        const dex = Math.ceil(points * 0.5);
        const luck = Math.ceil(points * 0.25);
        const con = points - dex - luck;
        return { str: 0, dex, int: 0, con, wis: 0, luck };
    },
    // 圣光祭司：精神为主，智力/体质辅
    priest(companion, points) {
        const wis = Math.ceil(points * 0.5);
        const int = Math.ceil(points * 0.25);
        const con = points - wis - int;
        return { str: 0, dex: 0, int, con, wis, luck: 0 };
    },
    // 均衡成长（兜底）：各属性轮转
    balanced(companion, points) {
        const attrs = ['str', 'dex', 'int', 'con', 'wis', 'luck'];
        const start = (companion.data.level || 0) % attrs.length;
        const out = { str: 0, dex: 0, int: 0, con: 0, wis: 0, luck: 0 };
        for (let i = 0; i < points; i++) {
            out[attrs[(start + i) % attrs.length]] += 1;
        }
        return out;
    },
};

const ATTR_KEYS = ['str', 'dex', 'int', 'con', 'wis', 'luck'];

/**
 * 按成长规则分配升级属性点。
 * @param {object} companion - Companion 实例
 * @param {string} ruleId - 成长规则 id（companion-config.growthRule）
 * @param {number} points - 可分配点数
 * @returns {{str,dex,int,con,wis,luck}} 各属性增量
 */
export function allocateOnLevelUp(companion, ruleId, points) {
    const rule = GROWTH_RULES[ruleId] || GROWTH_RULES.balanced;
    const deltas = rule(companion, points) || {};
    const out = {};
    let used = 0;
    for (const k of ATTR_KEYS) {
        const v = Math.max(0, Math.floor(deltas[k] || 0));
        out[k] = v;
        used += v;
    }
    // 规则给出的点数不足时补体质（保证属性点不丢失）
    if (used < points) out.con += points - used;
    return out;
}

/** 运行时注册扩展成长规则（接口：不硬编码的扩展点） */
export function registerGrowthRule(id, fn) {
    if (typeof fn === 'function') GROWTH_RULES[id] = fn;
}

/** 取规则 id 列表（招募界面可展示成长倾向） */
export function getGrowthRuleIds() {
    return Object.keys(GROWTH_RULES);
}
