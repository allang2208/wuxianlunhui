import { getElement } from '../utils/dom-utils.js';
// 状态栏管理器 - 管理玩家身上的状态效果（眩晕、中毒等）
export const StatusBar = {
    // 状态效果列表：{ id, icon, name, duration, remaining, color }
    effects: [],
    container: null,
    initialized: false,

    // 状态效果配置（desc 用于悬停浮窗的具体效果说明）
    STATUS_CONFIG: {
        stun: { icon: '💫', name: '眩晕', color: '#9a7a5a', desc: '无法移动、攻击、使用技能与物品。' },
        poison: { icon: '☠️', name: '中毒', color: '#7a9a5a', desc: '每秒受到层数点毒素伤害。' },
        slow: { icon: '🐌', name: '减速', color: '#5a7a9a', desc: '移动速度降低 50%。' },
        buff: { icon: '✨', name: '增益', color: '#9a9a5a', desc: '获得临时增益效果。' },
        shield: { icon: '🛡️', name: '护盾', color: '#5a8a9a', desc: '获得护盾，减免受到的伤害。' },
        bleed: { icon: '🩸', name: '流血', color: '#9a3a3a', desc: '持续流失生命值。' },
        magicVulnerability: { icon: '🔮', name: '魔力易伤', color: '#8a5a9a', desc: '每层使受到的魔法伤害提高 5%。' },
        droneVulnerability: { icon: '🛸', name: '无人机易伤', color: '#5a7a9a', desc: '每层使受到的所有伤害提高 10%。' },
        marbleHeal: { icon: '🗿', name: '大理石守护', color: '#8a9a8a', desc: '击杀目标后 1 秒内回复生命值。' },
        goddessBless: { icon: '✨', name: '女神祝福', color: '#e8c878', desc: '本场战斗攻击/防御/移速提升，按场消耗。' },
        demonPrayer: { icon: '🔥', name: '恶魔祈祷', color: '#9a3a3a', desc: '攻击力大幅提升的恶魔交易，伴随代价。' },
        fear: { icon: '😨', name: '恐惧', color: '#6a5a8a', desc: '失控地远离恐惧源，每层移速再降 33%（上限 99%）。' },
        tributeSnowLotus: { icon: '🪷', name: '雪莲祝福', color: '#9ad0ff', desc: '本次地牢获得经验 +25%。' },
        tributeGinseng: { icon: '🌿', name: '人参回气', color: '#6a9a5a', desc: '本次地牢击杀目标后 1 秒内回复最大魔法值 5%。' },
        tributePeach: { icon: '🍑', name: '蟠桃续命', color: '#e8a06a', desc: '本次地牢死亡后 3 秒以 30% 最大生命原地复活一次。' },
        tributeDiamond: { icon: '💎', name: '金刚不坏', color: '#7ab0e0', desc: '单次受到的伤害不超过最大生命值的 15%。' },
        tributeMoonstone: { icon: '🌙', name: '月影庇护', color: '#b0a0e0', desc: '进入战斗获得无敌；Boss/精英战斗中物理魔法伤害 +5%。' },
        tributePhilosopher: { icon: '🪨', name: '点石成金', color: '#e0c060', desc: '获得随机传说祭品（若为传说祭品则额外再得一份）。' },
    },

    init() {
        if (this.initialized) return;
        this.container = getElement('statusBarContainer');
        if (!this.container) {
            console.warn('[StatusBar] 状态栏容器未找到，请检查 HTML 中是否有 id="statusBarContainer" 的元素');
        }
        this._initTooltip();
        this.initialized = true;
    },

    /** 悬停浮窗：白色装备浮窗同款样式，图层在状态栏之上 */
    _initTooltip() {
        const container = this.container || getElement('statusBarContainer');
        if (!this._tooltip) {
            const tip = document.createElement('div');
            tip.id = 'statusEffectTooltip';
            tip.style.cssText = `
                position: fixed; z-index: 99999; pointer-events: none; display: none;
                min-width: 200px; max-width: 300px;
                background: linear-gradient(135deg, rgba(255,255,255,0.95), rgba(240,240,240,0.9));
                border: 2px solid rgba(0,0,0,0.2); border-radius: 8px;
                padding: 12px 16px; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
                color: #2a2520; font-size: 13px; line-height: 1.6;
                font-family: SimHei, "Microsoft YaHei", "黑体", sans-serif;
            `;
            document.body.appendChild(tip);
            this._tooltip = tip;
        }
        // 容器后于首次 init 就绪时允许重试绑定
        if (this._tooltipBound || !container) return;
        this._tooltipBound = true;
        // 事件委托（render 重建 DOM 不受影响）
        container.addEventListener('mouseover', (e) => {
            const item = e.target.closest('.status-effect-item');
            if (item) this._showTooltip(item);
        });
        container.addEventListener('mouseout', (e) => {
            const item = e.target.closest('.status-effect-item');
            if (item && !item.contains(e.relatedTarget)) this._hideTooltip();
        });
        container.addEventListener('mouseleave', () => this._hideTooltip());
    },

    _showTooltip(item) {
        const effect = this.effects.find(ef => ef.type === item.dataset.effectType);
        if (!effect || !this._tooltip) return;
        const cfg = this.STATUS_CONFIG[effect.type] || {};
        const desc = cfg.desc || '持续生效的状态效果。';
        let timeText;
        if (effect.battleRemaining !== undefined) {
            timeText = `剩余 ${effect.battleRemaining} 场`;
        } else {
            timeText = `剩余 ${Math.ceil(effect.remaining / 1000)} 秒`;
        }
        const stacks = effect.stacks !== undefined ? `<div style="color:#8a6a3a;">层数：x${effect.stacks}</div>` : '';
        this._tooltip.innerHTML = `
            <div style="font-weight:700;font-size:15px;margin-bottom:6px;">${effect.icon} ${effect.name}</div>
            <div style="margin-bottom:6px;">${desc}</div>
            ${stacks}
            <div style="color:#6a5a4a;font-size:12px;">${timeText}</div>
        `;
        // 显示在条目右侧（状态栏在左上角，向右展开不遮挡状态栏）
        const rect = item.getBoundingClientRect();
        this._tooltip.style.display = 'block';
        const tipW = this._tooltip.offsetWidth;
        const tipH = this._tooltip.offsetHeight;
        let left = rect.right + 10;
        if (left + tipW > window.innerWidth - 8) left = rect.left - tipW - 10;
        let top = rect.top;
        if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
        this._tooltip.style.left = Math.max(8, left) + 'px';
        this._tooltip.style.top = Math.max(8, top) + 'px';
    },

    _hideTooltip() {
        if (this._tooltip) this._tooltip.style.display = 'none';
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
        // 容器后于 init 就绪时补绑定悬停浮窗（内部有 _tooltipBound 守卫）
        this._initTooltip();

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
                <div class="status-effect-item" data-effect-type="${effect.type}" style="--effect-color: ${effect.color};">
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
