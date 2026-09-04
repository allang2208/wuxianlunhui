import { EnchantConfig } from '../config/enchant-config.js';
import { EnchantScrollItems } from '../config/enchant-config.js';
import { MagicDustItem } from '../config/enchant-config.js';
import { ItemDatabase } from '../items/item-database.js';
import { Game } from '../game.js';
// Reward System - 奖励结算界面
import { FloatingTextEffect } from '../effects/floating-text.js';
import { EffectManager } from '../effects/effect-manager.js';
import { getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { GameUIManager } from './game-ui-manager.js';
import { createGoldItem } from '../world/economy-gold-routing.js';
import { MailStore, mailId } from '../systems/mail-store.js';
import { PlayerRewardDelivery } from '../systems/player-reward-delivery.js';
import { getRarityLabel } from '../config/rarity.js';
export const RewardSystem = {
    _isOpen: false,
    _selected: null,
    _isGranting: false,
    _closeTimer: null,
    _onComplete: null,
    _focusBeforeOpen: null,
    _storeOverflow: false,
    _baseGoldReward: 500,
    _weaponRarities: ['rare', 'epic'],
    _defaultSubtitle: '从三份结算档案中选择一项额外奖励，确认后立即发放',

    // 卡牌数据
    CARDS: [
        {
            id: 'card1',
            title: '附魔之礼',
            icon: '📜',
            iconImage: 'assets/items/scroll.png',
            rewards: [
                { type: 'scroll', grade: 'common', count: 1 },
                { type: 'dust', count: 200 }
            ],
            desc: '获得随机普通品质附魔卷轴和 200 魔法粉尘'
        },
        {
            id: 'card2',
            title: '强化之礼',
            icon: '💎',
            iconImage: 'assets/items/enhance_stone.png',
            rewards: [
                { type: 'stone', count: 2 },
                { type: 'gold', count: 1000 }
            ],
            desc: '获得强化石两颗和 1000 金币'
        },
        {
            id: 'card3',
            title: '改造之礼',
            icon: '🔧',
            iconImage: 'assets/items/modify_ticket.png',
            rewards: [
                { type: 'ticket', count: 2 },
                { type: 'gold', count: 1000 }
            ],
            desc: '获得改造券两张和 1000 金币'
        }
    ],

    open(options = {}) {
        if (this._isOpen) return false;
        const panel = getElement('rewardPanel');
        const container = getElement('rewardCardsContainer');
        if (!panel || !container) {
            console.error('[Reward] 奖励面板 DOM 未就绪，取消打开');
            this._isOpen = false;
            return false;
        }
        if (this._closeTimer) {
            TimerManager.clearTimeout(this._closeTimer);
            this._closeTimer = null;
        }
        this._isOpen = true;
        this._selected = null;
        this._isGranting = false;
        this._onComplete = typeof options.onComplete === 'function' ? options.onComplete : null;
        this._storeOverflow = options.storeOverflow === true;
        this._awardPlan = null;
        this._sourceId = options.sourceId || (this._storeOverflow && MailStore.run ? `${MailStore.run.id}:final-reward` : mailId('settlement'));
        this._focusBeforeOpen = document.activeElement;
        const configuredBase = Number(options.baseGold);
        this._baseGoldReward = Number.isFinite(configuredBase) ? Math.max(0, Math.floor(configuredBase)) : 500;
        this._weaponRarities = Array.isArray(options.weaponRarities) && options.weaponRarities.length
            ? [...options.weaponRarities] : ['rare', 'epic'];
        panel.style.display = 'flex';
        panel.classList.add('active');
        panel.tabIndex = -1;
        panel.onkeydown = event => {
            event.stopPropagation();
            if (event.key === 'Escape') event.preventDefault();
            if (event.key !== 'Tab') return;
            event.preventDefault();
            const buttons = Array.from(panel.querySelectorAll('button:not(:disabled):not([hidden])'));
            const index = buttons.indexOf(document.activeElement);
            const next = index < 0 ? (event.shiftKey ? buttons.length - 1 : 0)
                : (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
            (buttons[next] || panel).focus({ preventScroll: true });
        };
        panel.onpointerdown = panel.onmousedown = panel.onclick = event => event.stopPropagation();
        const continueButton = getElement('rewardContinueBtn');
        if (continueButton) continueButton.onclick = () => this._finishSelection();
        this._setStatus(this._defaultSubtitle, false);
        this._render();
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                if (!this._isOpen) return;
                getElement('rewardCardsContainer')?.querySelector('.reward-card:not(:disabled)')?.focus({ preventScroll: true });
            });
        }
        return true;
    },

    close({ restoreFocus = true } = {}) {
        if (this._closeTimer) {
            TimerManager.clearTimeout(this._closeTimer);
            this._closeTimer = null;
        }
        this._isOpen = false;
        this._isGranting = false;
        this._onComplete = null;
        const panel = getElement('rewardPanel');
        if (panel) {
            panel.style.display = 'none';
            panel.classList.remove('active');
            panel.onkeydown = panel.onpointerdown = panel.onmousedown = panel.onclick = null;
        }
        if (restoreFocus && this._focusBeforeOpen?.isConnected) this._focusBeforeOpen.focus?.({ preventScroll: true });
        this._focusBeforeOpen = null;
    },

    _finishSelection() {
        if (!this._isOpen || this._selected === null || this._isGranting) return;
        const onComplete = this._onComplete;
        this.close({ restoreFocus: !onComplete });
        // 只有完整发奖后的明确完成动作才推进；强制关闭、死亡或清理不会误判通关。
        onComplete?.();
    },

    // 选择卡牌
    selectCard(cardIndex) {
        if (!this._isOpen || this._selected !== null || this._isGranting) return;
        const index = Math.floor(Number(cardIndex));
        const card = this.CARDS[index];
        if (!card) return;
        this._isGranting = true;
        this._setStatus('正在核验结算清单并发放奖励…', false);
        let result = null;
        try {
            result = this._giveRewards(card);
        } catch (err) {
            console.error('[Reward] _giveRewards 异常:', err);
            result = { ok: false, message: '奖励结算发生异常，已回滚本次发放，请重新选择' };
        }
        this._isGranting = false;
        if (!result?.ok) {
            this._selected = null;
            this._setStatus(result?.message || '奖励未能完整发放，请重新选择', true);
            this._render();
            getElement('rewardCardsContainer')?.querySelectorAll('.reward-card')?.[index]?.focus?.({ preventScroll: true });
            return;
        }
        this._selected = index;
        this._setStatus(result.message || '奖励已完整发放，正在归档结算记录…', false);
        this._render();
        getElement('rewardContinueBtn')?.focus({ preventScroll: true });
        this._closeTimer = TimerManager.setTimeout(() => {
            this._closeTimer = null;
            this._finishSelection();
        }, 2000);
    },

    // Random results are retained for retries; capacity never causes a reroll.
    _giveRewards(card) {
        if (!card || !Array.isArray(card.rewards)) return { ok: false, message: '奖励卡数据无效' };
        const player = Game.player;
        if (!player?.data || !Number.isFinite(Number(player.data.level))) return { ok: false, message: '玩家数据不可用，请重试' };
        if (player.data.attrPoints !== undefined && !Number.isFinite(Number(player.data.attrPoints))) {
            return { ok: false, message: '属性点数据无效，请重试' };
        }
        if (this._awardPlan && this._awardPlan.card !== card) return { ok: false, message: '本次奖励已锁定，请重试刚才选择的卡牌' };
        try {
            if (!this._awardPlan) {
                const items = [];
                if (this._baseGoldReward > 0) items.push(createGoldItem(this._baseGoldReward));
                const keys = Object.keys(ItemDatabase.items || {}).filter(key => {
                    const item = ItemDatabase.items[key];
                    return this._weaponRarities.includes(item?.rarity) && String(item.category).startsWith('weapon');
                });
                if (!keys.length) throw new Error('没有可用的随机武器');
                const weapon = ItemDatabase.createInstance(keys[Math.floor(Math.random() * keys.length)]);
                if (!weapon) throw new Error('随机武器创建失败');
                items.push(weapon);
                // 配置完整解析后才锁定选择；配置错误允许改选，投递重试仍沿用原抽奖结果。
                for (const reward of card.rewards) {
                    let item;
                    if (reward.type === 'gold') item = createGoldItem(reward.count);
                    else if (reward.type === 'dust') item = { ...MagicDustItem, stack: reward.count };
                    else if (reward.type === 'stone') item = { ...EnhancementItems.enhance_stone, stack: reward.count };
                    else if (reward.type === 'ticket') item = { ...EnhancementItems.modify_ticket, stack: reward.count };
                    else if (reward.type === 'scroll') {
                        const scrolls = EnchantConfig.getAllScrolls().filter(scroll => scroll.grade === reward.grade);
                        const scroll = scrolls[Math.floor(Math.random() * scrolls.length)];
                        const template = scroll && Object.values(EnchantScrollItems).find(entry => entry.scrollId === scroll.id);
                        if (template) item = { ...template, stack: reward.count || 1 };
                    }
                    if (!item?.name) throw new Error('奖励物品配置缺失');
                    items.push(item);
                }
                this._awardPlan = { card, items };
            }
            const result = PlayerRewardDelivery.deliver(this._awardPlan.items, {
                sourceId: this._sourceId, title: this._storeOverflow ? '地牢通关战利品' : '任务结算奖励',
                finishRun: this._storeOverflow,
            });
            if (!result.duplicate) {
                player.data.level = Math.floor(Number(player.data.level)) + 1;
                if (player.data.attrPoints !== undefined) player.data.attrPoints = Number(player.data.attrPoints) + 3;
                this._safeFloatingText('等级提升！', '#ffd700', -40);
            }
            try { GameUIManager?.updateUI?.(); } catch (error) { console.warn('[Reward] UI刷新失败', error); }
            return { ok: true, message: result.duplicate ? '此奖励已经领取，可以继续返回' :
                `奖励已领取：背包 ${result.backpack} 项 · 仓库 ${result.warehouse} 项 · 信箱 ${result.mailed} 项${result.pending ? ` · 探险暂存 ${result.pending} 项` : ''}` };
        } catch (error) {
            console.error('[Reward] 发奖失败', error);
            const retry = this._awardPlan ? '请重试原卡牌' : '请重新选择奖励';
            return { ok: false, message: `奖励尚未发放：${error.message}。${retry}` };
        }
    },

    _setStatus(message, isError = false) {
        const subtitle = getElement('rewardPanelSubtitle');
        if (!subtitle) return;
        subtitle.textContent = message || this._defaultSubtitle;
        subtitle.classList.toggle('is-error', !!isError);
    },

    _safeFloatingText(text, color, yOffset = -20) {
        const player = Game.player;
        if (!player) return;
        try {
            EffectManager?.add?.(new FloatingTextEffect(player.x, player.y + yOffset, text, color));
        } catch (err) {
            console.warn('[Reward] 浮动文字显示失败:', err);
        }
    },

    _render() {
        const container = getElement('rewardCardsContainer');
        if (!container) return;
        container.innerHTML = this.CARDS.map((card, idx) => {
            const selected = this._selected === idx;
            const disabled = this._selected !== null || (!!this._awardPlan && this._awardPlan.card !== card);
            return `
                <button type="button"
                        class="reward-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}"
                        aria-label="选择${card.title}：${card.desc}"
                        aria-pressed="${selected}"
                        data-reward-index="${idx}"
                        ${disabled ? 'disabled aria-disabled="true"' : ''}>
                    <span class="reward-card-bg" aria-hidden="true"></span>
                    <span class="reward-card-index">REWARD // 0${idx + 1}</span>
                    <span class="reward-card-content">
                        <span class="reward-card-icon" aria-hidden="true">${card.iconImage
                            ? `<img src="${card.iconImage}" alt="">` : card.icon}</span>
                        <span class="reward-card-title">${card.title}</span>
                        <span class="reward-card-divider" aria-hidden="true"></span>
                        <span class="reward-card-desc">${card.desc}</span>
                    </span>
                    <span class="reward-card-selected">${selected ? '✓ 奖励已确认' : disabled ? '本次未选择' : '选择此项奖励'}</span>
                </button>
            `;
        }).join('');
        container.querySelectorAll('.reward-card:not(:disabled)').forEach(button => {
            button.onclick = () => this.selectCard(Number(button.dataset.rewardIndex));
        });
        const summary = getElement('rewardGuaranteedSummary');
        if (summary) summary.textContent = `固定奖励：${this._baseGoldReward.toLocaleString('zh-CN')} 金币 · 随机${this._weaponRarities.map(getRarityLabel).join('/')}武器 ×1 · 等级 +1${Game.player?.data?.attrPoints !== undefined ? ' · 属性点 +3' : ''}`;
        const continueButton = getElement('rewardContinueBtn');
        if (continueButton) continueButton.hidden = this._selected === null;
        const hint = getElement('rewardPanelHint');
        if (hint) hint.textContent = this._selected === null
            ? '额外奖励三选一 · 固定奖励随所选卡牌一起发放'
            : '奖励已发放 · 2 秒后自动继续，也可点击继续结算';
    }
};

// 强化大类物品定义
export const EnhancementItems = {
    enhance_stone: {
        id: 'enhancement_stone',
        name: '强化石',
        type: '强化材料',
        icon: '💎',
        iconImage: 'assets/items/enhance_stone.png',
        category: 'enhancement',
        subCategory: 'stone',
        rarity: 'mythic',
        desc: '用于强化装备的特殊材料，蕴含神秘力量',
        stack: 1,
        maxStack: 9999,
        price: 100
    },
    modify_ticket: {
        id: 'reforge_ticket',
        name: '改造券',
        type: '强化材料',
        icon: '🔧',
        iconImage: 'assets/items/modify_ticket.png',
        category: 'enhancement',
        subCategory: 'ticket',
        rarity: 'mythic',
        desc: '用于改造装备的凭证，可使装备获得特殊能力',
        stack: 1,
        maxStack: 9999,
        price: 200
    }
};

// 全局输入门禁与开发工具沿用此引用；卡牌点击直接绑定当前模块。
if (typeof window !== 'undefined' && !window.RewardSystem) {
    window.RewardSystem = RewardSystem;
}
