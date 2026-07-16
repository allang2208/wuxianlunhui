import { getElement } from '../utils/dom-utils.js';
// 状态栏管理器 - 管理玩家身上的状态效果（眩晕、中毒等）
export const StatusBar = {
    // 状态效果列表：{ id, icon, name, duration, remaining, color }
    effects: [],
    container: null,
    initialized: false,

    // 状态效果配置
    STATUS_CONFIG: {
        stun: { icon: '💫', name: '眩晕', color: '#9a7a5a' },
        poison: { icon: '☠️', name: '中毒', color: '#7a9a5a' },
        slow: { icon: '🐌', name: '减速', color: '#5a7a9a' },
        buff: { icon: '✨', name: '增益', color: '#9a9a5a' },
        shield: { icon: '🛡️', name: '护盾', color: '#5a8a9a' },
        bleed: { icon: '🩸', name: '流血', color: '#9a3a3a' },
        magicVulnerability: { icon: '🔮', name: '魔力易伤', color: '#8a5a9a' },
        droneVulnerability: { icon: '🛸', name: '无人机易伤', color: '#5a7a9a' },
        marbleHeal: { icon: '🗿', name: '大理石守护', color: '#8a9a8a' },
        goddessBless: { icon: '✨', name: '女神祝福', color: '#e8c878' },
        demonPrayer: { icon: '🔥', name: '恶魔祈祷', color: '#9a3a3a' },
    },

    init() {
        if (this.initialized) return;
        this.container = getElement('statusBarContainer');
        if (!this.container) {
            console.warn('[StatusBar] 状态栏容器未找到，请检查 HTML 中是否有 id="statusBarContainer" 的元素');
        }
        this.initialized = true;
    },

    /**
     * 添加状态效果
     * @param {string} type - 状态类型，如 'stun', 'poison'
     * @param {number} duration - 持续时间（毫秒）
     * @param {Object} options - 可选配置：{ icon, name, color } 覆盖默认配置
     * @returns {string} effectId - 状态效果唯一ID
     */
    addEffect(type, duration, options = {}) {
        this.init();
        const config = this.STATUS_CONFIG[type] || { icon: '❓', name: type, color: '#8a7d6b' };
        const effectId = `${type}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        
        // 检查是否已有同类型的状态效果，如果有则更新剩余时间（取较大值）
        const existing = this.effects.find(e => e.type === type);
        const hasBattleRemaining = options.battleRemaining !== undefined;
        if (existing) {
            if (hasBattleRemaining) {
                existing.battleRemaining = options.battleRemaining;
                existing.remaining = 0;
                existing.duration = 0;
                if (options.name) existing.name = options.name;
            } else {
                existing.remaining = Math.max(existing.remaining, duration);
                existing.duration = Math.max(existing.duration, duration);
            }
            if (options.stacks !== undefined) {
                existing.stacks = options.stacks;
                existing.name = `${config.name} x${options.stacks}`;
            }
            this.render();
            return existing.id;
        }

        let name = options.name || config.name;
        if (options.stacks !== undefined) {
            name = `${name} x${options.stacks}`;
        }

        this.effects.push({
            id: effectId,
            type: type,
            icon: options.icon || config.icon,
            name: name,
            color: options.color || config.color,
            duration: duration,
            remaining: duration,
            stacks: options.stacks,
            battleRemaining: hasBattleRemaining ? options.battleRemaining : undefined,
        });

        this.render();
        return effectId;
    },

    /**
     * 更新状态效果的层数
     * @param {string} type - 状态类型
     * @param {number} stacks - 层数
     */
    updateEffectStacks(type, stacks) {
        const effect = this.effects.find(e => e.type === type);
        if (effect) {
            effect.stacks = stacks;
            const config = this.STATUS_CONFIG[type] || { name: type };
            effect.name = `${config.name} x${stacks}`;
            this.render();
        }
    },

    /**
     * 移除状态效果
     * @param {string} effectId - 状态效果ID
     */
    removeEffect(effectId) {
        const idx = this.effects.findIndex(e => e.id === effectId);
        if (idx >= 0) {
            this.effects.splice(idx, 1);
            this.render();
        }
    },

    /**
     * 按类型移除状态效果
     * @param {string} type - 状态类型
     */
    removeEffectByType(type) {
        const idx = this.effects.findIndex(e => e.type === type);
        if (idx >= 0) {
            this.effects.splice(idx, 1);
            this.render();
        }
    },

    /**
     * 检查是否有某类型的状态效果
     * @param {string} type - 状态类型
     * @returns {boolean}
     */
    hasEffect(type) {
        return this.effects.some(e => e.type === type);
    },

    /**
     * 获取某类型状态效果的剩余时间
     * @param {string} type - 状态类型
     * @returns {number} 剩余时间（毫秒），没有则返回 0
     */
    getRemainingTime(type) {
        const effect = this.effects.find(e => e.type === type);
        return effect ? effect.remaining : 0;
    },

    /**
     * 更新所有状态效果计时器
     * @param {number} dt - 时间增量（毫秒）
     */
    update(dt) {
        if (this.effects.length === 0) return;
        
        let changed = false;
        for (let i = this.effects.length - 1; i >= 0; i--) {
            const effect = this.effects[i];
            // 按战斗场次持续的效果不参与毫秒倒计时
            if (effect.battleRemaining !== undefined) {
                changed = true;
                continue;
            }
            effect.remaining -= dt;
            if (effect.remaining <= 0) {
                this.effects.splice(i, 1);
                changed = true;
            } else {
                changed = true;
            }
        }
        
        if (changed) {
            this.render();
        }
    },

    /**
     * 清除所有状态效果
     */
    clear() {
        this.effects = [];
        this.render();
    },

    /**
     * 渲染状态栏
     */
    render() {
        if (!this.container) {
            this.container = getElement('statusBarContainer');
            if (!this.container) return;
        }

        if (this.effects.length === 0) {
            this.container.innerHTML = '';
            this.container.style.display = 'none';
            return;
        }

        this.container.style.display = 'flex';
        let html = '';
        for (const effect of this.effects) {
            let timeText;
            let progress = 0;
            if (effect.battleRemaining !== undefined) {
                timeText = `${effect.battleRemaining}场`;
            } else {
                const seconds = Math.ceil(effect.remaining / 1000);
                timeText = `${seconds}s`;
                progress = effect.duration > 0 ? (effect.remaining / effect.duration) : 0;
            }
            html += `
                <div class="status-effect-item" style="--effect-color: ${effect.color};">
                    <span class="status-effect-icon">${effect.icon}</span>
                    <span class="status-effect-name">${effect.name}</span>
                    <span class="status-effect-time">${timeText}</span>
                    <div class="status-effect-progress" style="width: ${progress * 100}%;"></div>
                </div>
            `;
        }
        this.container.innerHTML = html;
    },

    /**
     * 获取状态效果数量
     * @returns {number}
     */
    getEffectCount() {
        return this.effects.length;
    },
};
