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
import { EquipManager } from './equip-manager.js';
import { GameUIManager } from './game-ui-manager.js';
import { WarehouseSystem } from './warehouse-system.js';
import { getGoldRoutingCapacity, routeProducedGold } from '../world/economy-gold-routing.js';
export const RewardSystem = {
    _isOpen: false,
    _selected: null,
    _isGranting: false,
    _closeTimer: null,
    _baseGoldReward: 500,
    _defaultSubtitle: '从三份结算档案中选择一项额外奖励，确认后立即发放',

    // 卡牌数据
    CARDS: [
        {
            id: 'card1',
            title: '附魔之礼',
            icon: '📜',
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
            rewards: [
                { type: 'ticket', count: 2 },
                { type: 'gold', count: 1000 }
            ],
            desc: '获得改造券两张和 1000 金币'
        }
    ],

    open(options = {}) {
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
        const configuredBase = Number(options.baseGold);
        this._baseGoldReward = Number.isFinite(configuredBase) ? Math.max(0, Math.floor(configuredBase)) : 500;
        panel.style.display = 'flex';
        panel.classList.add('active');
        this._setStatus(this._defaultSubtitle, false);
        this._render();
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                getElement('rewardCardsContainer')?.querySelector('.reward-card:not(:disabled)')?.focus({ preventScroll: true });
            });
        }
        return true;
    },

    close() {
        if (this._closeTimer) {
            TimerManager.clearTimeout(this._closeTimer);
            this._closeTimer = null;
        }
        this._isOpen = false;
        this._isGranting = false;
        const panel = getElement('rewardPanel');
        if (panel) {
            panel.style.display = 'none';
            panel.classList.remove('active');
        }
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
        this._closeTimer = TimerManager.setTimeout(() => {
            this._closeTimer = null;
            this.close();
        }, 2000);
    },

    // 发放奖励
    _giveRewards(card) {
        if (!card || !Array.isArray(card.rewards)) {
            return { ok: false, message: '奖励卡数据无效，请重新选择' };
        }
        const totalGold = this._baseGoldReward + card.rewards.reduce(
            (sum, reward) => sum + (reward.type === 'gold' ? Math.max(0, Math.floor(Number(reward.count) || 0)) : 0),
            0
        );
        const goldCapacity = getGoldRoutingCapacity();
        if (goldCapacity < totalGold) {
            return {
                ok: false,
                message: `背包与仓库金币容量不足：还需 ${totalGold - goldCapacity} 容量。可选择不含额外金币的奖励卡`,
            };
        }

        const snapshot = this._captureGrantState();
        try {
            if (!this._giveGold(this._baseGoldReward)) throw new Error('通关金币未能完整入库');
            if (!this._giveRandomWeapon()) throw new Error('随机优质武器生成失败');
            for (const reward of card.rewards) {
                let ok = false;
                switch (reward.type) {
                    case 'scroll':
                        ok = this._giveScroll(reward.grade);
                        break;
                    case 'dust':
                        ok = this._giveDust(reward.count);
                        break;
                    case 'stone':
                        ok = this._giveStone(reward.count);
                        break;
                    case 'ticket':
                        ok = this._giveTicket(reward.count);
                        break;
                    case 'gold':
                        ok = this._giveGold(reward.count);
                        break;
                }
                if (!ok) throw new Error(`${reward.type || 'unknown'} 奖励未能完整发放`);
            }
            const player = Game.player;
            if (!player?.data) throw new Error('玩家数据不可用');
            const currentLevel = Number(player.data.level);
            if (!Number.isFinite(currentLevel)) throw new Error('玩家等级数据无效');
            player.data.level = Math.floor(currentLevel) + 1;
            if (player.data.attrPoints !== undefined) {
                const currentAttrPoints = Number(player.data.attrPoints);
                if (!Number.isFinite(currentAttrPoints)) throw new Error('玩家属性点数据无效');
                player.data.attrPoints = currentAttrPoints + 3;
            }
            this._safeFloatingText('等级提升！', '#ffd700', -40);
            try { GameUIManager?.updateUI?.(); } catch (err) { console.warn('[Reward] UI 刷新失败:', err); }
            return { ok: true, message: '奖励已完整发放，正在归档结算记录…' };
        } catch (err) {
            this._restoreGrantState(snapshot);
            console.error('[Reward] 发放失败，已回滚:', err);
            return { ok: false, message: `奖励未完整发放，已回滚：${err.message || '未知错误'}` };
        }
    },

    _setStatus(message, isError = false) {
        const subtitle = getElement('rewardPanelSubtitle');
        if (!subtitle) return;
        subtitle.textContent = message || this._defaultSubtitle;
        subtitle.classList.toggle('is-error', !!isError);
    },

    _captureGrantState() {
        const capture = (items) => (items || []).map((item) => ({
            item,
            hasStack: Object.prototype.hasOwnProperty.call(item || {}, 'stack'),
            stack: item?.stack,
            hasStats: Object.prototype.hasOwnProperty.call(item || {}, 'stats'),
            stats: Array.isArray(item?.stats) ? item.stats.map((stat) => ({ ...stat })) : item?.stats,
        }));
        const player = Game.player;
        return {
            backpack: capture(EquipManager.backpackItems),
            warehouse: capture(WarehouseSystem.items),
            entityKeys: new Set(Game.entities ? Game.entities.keys() : []),
            level: player?.data?.level,
            attrPoints: player?.data?.attrPoints,
        };
    },

    _restoreGrantState(snapshot) {
        if (!snapshot) return;
        const restore = (target, entries) => {
            target.splice(0, target.length, ...entries.map((entry) => entry.item));
            for (const entry of entries) {
                if (!entry.item) continue;
                if (entry.hasStack) entry.item.stack = entry.stack;
                else delete entry.item.stack;
                if (entry.hasStats) entry.item.stats = Array.isArray(entry.stats)
                    ? entry.stats.map((stat) => ({ ...stat })) : entry.stats;
                else delete entry.item.stats;
            }
        };
        restore(EquipManager.backpackItems, snapshot.backpack);
        restore(WarehouseSystem.items, snapshot.warehouse);
        if (Game.entities) {
            for (const key of Array.from(Game.entities.keys())) {
                if (!snapshot.entityKeys.has(key)) Game.removeEntity?.(key);
            }
        }
        const player = Game.player;
        if (player?.data) {
            player.data.level = snapshot.level;
            if (snapshot.attrPoints !== undefined) player.data.attrPoints = snapshot.attrPoints;
        }
        try { EquipManager.updateInventorySlots?.(); } catch {}
        try { WarehouseSystem._refreshAll?.(); } catch {}
        try { GameUIManager?.updateUI?.(); } catch {}
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

    // 随机优质武器
    _giveRandomWeapon() {
        // 按“键”抽取（items 是 {id: itemData}，itemData 本身不带 id/_id——
        // 旧实现 Object.values 后读 weapon.id 恒为 undefined，createInstance(undefined)
        // 返回 null，下游 addToInventory 读 maxStack 抛 TypeError，奖励界面卡死）
        const items = ItemDatabase.items || {};
        const keys = Object.keys(items).filter(k => {
            const it = items[k];
            return it && (it.rarity === 'rare' || it.rarity === 'epic') &&
                it.category && String(it.category).startsWith('weapon');
        });
        if (keys.length === 0) return false;
        const instance = ItemDatabase.createInstance(keys[Math.floor(Math.random() * keys.length)]);
        return !!instance && this._addToBackpackOrDrop(instance);
    },

    // 给附魔卷轴
    _giveScroll(grade) {
        // 随机获取一个F级卷轴
        const scrolls = EnchantConfig.getAllScrolls().filter(s => s.grade === grade);
        if (scrolls.length === 0) return false;
        const scroll = scrolls[Math.floor(Math.random() * scrolls.length)];
        const item = Object.values(EnchantScrollItems).find(entry => entry.scrollId === scroll.id);
        return !!item && this._addToBackpackOrDrop({ ...item, stack: 1 });
    },

    // 给魔法晶尘
    _giveDust(count) {
        return this._addToBackpackOrDrop({ ...MagicDustItem, stack: count });
    },

    // 给强化石
    _giveStone(count) {
        const stone = EnhancementItems.enhance_stone;
        return !!stone && this._addToBackpackOrDrop({ ...stone, stack: count });
    },

    // 给改造券
    _giveTicket(count) {
        const ticket = EnhancementItems.modify_ticket;
        return !!ticket && this._addToBackpackOrDrop({ ...ticket, stack: count });
    },

    // 给金币
    _giveGold(count) {
        const routed = routeProducedGold(count);
        const stored = routed.backpack + routed.warehouse;
        if (stored !== routed.requested || routed.remaining > 0) return false;
        const destination = routed.warehouse > 0
            ? `（背包 ${routed.backpack} / 仓库 ${routed.warehouse}）` : '';
        this._safeFloatingText(`+${stored} 金币${destination}`, '#ffd700', -20);
        return true;
    },

    // 添加到背包或扔地上
    _addToBackpackOrDrop(item) {
        if (!item) return false;
        if (EquipManager.addToBackpack(item)) {
            this._safeFloatingText(`获得: ${item.name}`, '#7aba7a', -20);
            return true;
        }
        const player = Game.player;
        if (!player || typeof Game.dropItem !== 'function') return false;
        Game.dropItem(
            player.x + (Math.random() - 0.5) * 50,
            player.y + (Math.random() - 0.5) * 50,
            item
        );
        this._safeFloatingText('背包已满，物品已放置在地上', '#ff4444', -60);
        return true;
    },

    _render() {
        const container = getElement('rewardCardsContainer');
        if (!container) return;
        container.innerHTML = this.CARDS.map((card, idx) => {
            const selected = this._selected === idx;
            const disabled = this._selected !== null && this._selected !== idx;
            return `
                <button type="button"
                        class="reward-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}"
                        aria-label="选择${card.title}：${card.desc}"
                        aria-pressed="${selected}"
                        ${disabled ? 'disabled aria-disabled="true"' : `onclick="RewardSystem.selectCard(${idx})"`}>
                    <span class="reward-card-bg" aria-hidden="true"></span>
                    <span class="reward-card-index">REWARD // 0${idx + 1}</span>
                    <span class="reward-card-content">
                        <span class="reward-card-icon" aria-hidden="true">${card.icon}</span>
                        <span class="reward-card-title">${card.title}</span>
                        <span class="reward-card-divider" aria-hidden="true"></span>
                        <span class="reward-card-desc">${card.desc}</span>
                    </span>
                    ${selected ? '<span class="reward-card-selected">✓ 奖励已确认</span>' : ''}
                </button>
            `;
        }).join('');
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

// 内联 onclick="RewardSystem.selectCard(...)" 依赖全局解析（去全局化重构遗漏），挂载到 window
if (typeof window !== 'undefined' && !window.RewardSystem) {
    window.RewardSystem = RewardSystem;
}
