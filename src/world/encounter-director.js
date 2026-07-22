import encounterTable from '../../data/encounter-table.json';
import { createTimeAgentAssault, createTimeAgentShield } from './zombie-dungeon.js';

/**
 * 遭遇导演（Encounter Director，配置：data/encounter-table.json）
 *
 * 统一登记/解析所有战斗遭遇，未来伏击/突袭/增援只需在配置表追加条目：
 * - 遭遇条目：{ kind, source }——kind 决定由哪个后端执行（waves 波次 / invasion 特工入侵 / boss / custom）；
 * - 统一构成解析 resolveComposition：支持两种写法——
 *   { tier: 数量 }：按地牢怪物池分层抽取（可走 poolFamily 限定家族）；
 *   [角色键...]：按 ROLE_FACTORIES 固定构成（如 ['assault','shield']）。
 *
 * 现有后端（ZombieDungeonCombat 波次 / AgentInvasionSystem 入侵 / BossRewardSystem）不重写，
 * 由本模块统一入口路由；新遭遇类型用 registerKind 注册处理器即可。
 */

/** 角色 → 工厂（构成写法的角色键在此登记，与 agent-invasion.json 的角色键一致） */
const ROLE_FACTORIES = {
    assault: createTimeAgentAssault,
    shield: createTimeAgentShield,
};

export const EncounterDirector = {
    _kinds: {},

    /** 注册遭遇类型处理器：start(spec, context) */
    registerKind(kind, handler) {
        this._kinds[kind] = handler;
    },

    /** 读取遭遇条目 */
    getEncounter(name) {
        const spec = encounterTable[name];
        if (!spec) console.warn(`[EncounterDirector] 未登记的遭遇：${name}`);
        return spec || null;
    },

    /** 按名称启动遭遇（路由到对应 kind 处理器） */
    start(name, context) {
        const spec = this.getEncounter(name);
        if (!spec) return false;
        const handler = this._kinds[spec.kind];
        if (!handler) {
            console.warn(`[EncounterDirector] 遭遇类型未注册处理器：${spec.kind}`);
            return false;
        }
        handler(spec, context);
        return true;
    },

    /** 角色工厂读取（角色键在此统一解析） */
    getRoleFactory(role) {
        return ROLE_FACTORIES[role] || null;
    },

    /**
     * 统一构成解析：构成 spec → 工厂数组
     * @param {Object|Array} spec {tier:数量} 或 [角色键...]
     * @param {object} [ctx] { tierPool: (tier)=>factory[] 分层池（如 ZombieDungeonCombat getPool） }
     * @returns {Array<Function>} 工厂数组（元素可 new x,y 或工厂调用）
     */
    resolveComposition(spec, ctx = {}) {
        // 数组写法：固定角色构成
        if (Array.isArray(spec)) {
            return spec.map(role => ROLE_FACTORIES[role] || createTimeAgentAssault);
        }
        // 对象写法：分层池按 tier 抽取
        if (spec && typeof spec === 'object') {
            const out = [];
            for (const [tier, count] of Object.entries(spec)) {
                const pool = (typeof ctx.tierPool === 'function') ? ctx.tierPool(tier) : [];
                for (let i = 0; i < count && pool.length > 0; i++) {
                    out.push(pool[Math.floor(Math.random() * pool.length)]);
                }
            }
            return out;
        }
        return [];
    },
};
