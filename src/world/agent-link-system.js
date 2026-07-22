import synergyConfig from '../../data/agent-synergy.json';

/**
 * 特工联动机制（配置：data/agent-synergy.json，勿硬编码）
 *
 * 生效条件：场景中同时存在配置 roles 中的各类特工单位（默认：突击 + 盾卫）。
 * 其他怪物以后可按同结构在配置中追加角色与规则。
 *
 * 规则：
 * 1. flashBashDelay——突击闪光弹眩晕期间（notifyFlashStun 记录），
 *    盾卫暂缓盾击（shouldHoldBash），眩晕结束后立即释放；
 * 2. meleeSupport——突击处于近战状态（isAssaultInMelee）时：
 *    盾卫贴近到 shieldCloseRange 优先盾击；突击拉开换回远程，
 *    assaultFallbackMs 内未换回则恢复默认近战 AI。
 */

export const AgentLinkSystem = {
    // 突击闪光弹造成的眩晕记录：{ target, endTime }
    _flashStuns: [],

    get config() { return synergyConfig; },

    isEnabled() { return synergyConfig.enabled !== false; },

    /** 按配置角色键收集场景中的特工单位 */
    _collectAgents(entities) {
        const roles = synergyConfig.roles || {};
        const out = { assault: [], shield: [] };
        if (!entities) return out;
        const list = Array.isArray(entities) ? entities : Array.from(entities.values());
        for (const e of list) {
            if (!e || !e.active) continue;
            const id = e.config && e.config.id;
            if (id && id === roles.assault) out.assault.push(e);
            else if (id && id === roles.shield) out.shield.push(e);
        }
        return out;
    },

    /** 联动是否生效：各类角色至少各有一个在场 */
    isLinked(entities) {
        if (!this.isEnabled()) return false;
        const { assault, shield } = this._collectAgents(entities);
        return assault.length > 0 && shield.length > 0;
    },

    /** 突击特工是否有人处于近战状态（melee/axeIntro/axeAttack） */
    isAssaultInMelee(entities) {
        const { assault } = this._collectAgents(entities);
        return assault.some(a => a._formState === 'melee' || a._formState === 'axeIntro' || a._formState === 'axeAttack');
    },

    /** 突击闪光弹命中眩晕时登记（stunMs 后过期） */
    notifyFlashStun(target, stunMs) {
        if (!this.isEnabled()) return;
        this._flashStuns.push({ target, endTime: Date.now() + (stunMs || 0) });
        // 清理过期记录
        const now = Date.now();
        this._flashStuns = this._flashStuns.filter(s => s.endTime > now);
    },

    /** 规则1：闪光弹眩晕进行中——盾卫暂缓盾击 */
    shouldHoldBash() {
        if (!this.isEnabled()) return false;
        const rule = synergyConfig.rules && synergyConfig.rules.flashBashDelay;
        if (!rule || rule.enabled === false) return false;
        const now = Date.now();
        this._flashStuns = this._flashStuns.filter(s => s.endTime > now);
        return this._flashStuns.length > 0;
    },

    /** 规则2 配置读取 */
    getMeleeSupportConfig() {
        const rule = (synergyConfig.rules && synergyConfig.rules.meleeSupport) || {};
        if (!this.isEnabled() || rule.enabled === false) return null;
        return {
            shieldCloseRange: rule.shieldCloseRange ?? 50,
            assaultFallbackMs: rule.assaultFallbackMs ?? 4000,
        };
    },
};
