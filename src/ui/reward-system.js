import { GoldManager } from '../systems/gold-manager.js';
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
export const RewardSystem = {
    _isOpen: false,
    _selected: null,

    // 卡牌数据
    CARDS: [
        {
            id: 'card1',
            title: '附魔之礼',
            icon: '📜',
            rewards: [
                { type: 'scroll', grade: 'F', count: 1 },
                { type: 'dust', count: 200 }
            ],
            desc: '获得随机 F 级附魔卷轴和 200 魔法晶尘'
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

    open() {
        this._isOpen = true;
        this._selected = null;
        const panel = getElement('rewardPanel');
        if (panel) {
            panel.style.display = 'flex';
            panel.classList.add('active');
        }
        this._render();
    },

    close() {
        this._isOpen = false;
        const panel = getElement('rewardPanel');
        if (panel) {
            panel.style.display = 'none';
            panel.classList.remove('active');
        }
    },

    // 选择卡牌
    selectCard(cardIndex) {
        if (this._selected !== null) return; // 已选择，不能更改
        this._selected = cardIndex;
        const card = this.CARDS[cardIndex];
        // 发放奖励
        this._giveRewards(card);
        // 渲染选中状态
        this._render();
        // 2秒后关闭
        TimerManager.setTimeout(() => {
            this.close();
        }, 2000);
    },

    // 发放奖励
    _giveRewards(card) {
        if (!card || !card.rewards) return;
        // 基础奖励：500金币 + 随机优质武器
        this._giveGold(500);
        this._giveRandomWeapon();
        for (const reward of card.rewards) {
            switch (reward.type) {
                case 'scroll':
                    this._giveScroll(reward.grade);
                    break;
                case 'dust':
                    this._giveDust(reward.count);
                    break;
                case 'stone':
                    this._giveStone(reward.count);
                    break;
                case 'ticket':
                    this._giveTicket(reward.count);
                    break;
                case 'gold':
                    this._giveGold(reward.count);
                    break;
            }
        }
        // 提升一级
        if (Game.player && Game.player.data) {
            const player = Game.player;
            player.data.level++;
            if (player.data.attrPoints !== undefined) {
                player.data.attrPoints += 3;
            }
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, '等级提升！', '#ffd700'));
            if (GameUIManager && GameUIManager.updateUI) {
                GameUIManager.updateUI();
            }
        }
    },

    // 随机优质武器
    _giveRandomWeapon() {
        const items = ItemDatabase.items || {};
        const rareWeapons = Object.values(items).filter(item =>
            item.rarity === 'rare' || item.rarity === 'epic'
        );
        if (rareWeapons.length === 0) return;
        const weapon = rareWeapons[Math.floor(Math.random() * rareWeapons.length)];
        const instance = ItemDatabase.createInstance ? ItemDatabase.createInstance(weapon.id || weapon._id) : { ...weapon };
        this._addToBackpackOrDrop(instance);
    },

    // 给附魔卷轴
    _giveScroll(grade) {
        // 随机获取一个F级卷轴
        const scrolls = EnchantConfig.getAllScrolls().filter(s => s.grade === grade);
        if (scrolls.length === 0) return;
        const scroll = scrolls[Math.floor(Math.random() * scrolls.length)];
        const item = EnchantScrollItems[`enchant_scroll_${scroll.id}`];
        if (item) {
            this._addToBackpackOrDrop({ ...item, stack: 1 });
        }
    },

    // 给魔法晶尘
    _giveDust(count) {
        this._addToBackpackOrDrop({ ...MagicDustItem, stack: count });
    },

    // 给强化石
    _giveStone(count) {
        const stone = EnhancementItems.enhance_stone;
        this._addToBackpackOrDrop({ ...stone, stack: count });
    },

    // 给改造券
    _giveTicket(count) {
        const ticket = EnhancementItems.modify_ticket;
        this._addToBackpackOrDrop({ ...ticket, stack: count });
    },

    // 给金币
    _giveGold(count) {
        GoldManager.addGold(count);
        EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 20, `+${count} 金币`, '#ffd700'));
    },

    // 添加到背包或扔地上
    _addToBackpackOrDrop(item) {
        if (EquipManager.backpackItems.length >= EquipManager.maxBackpackSlots) {
            // 背包满，扔地上
            Game.dropItem(Game.player.x + (Math.random() - 0.5) * 50, Game.player.y + (Math.random() - 0.5) * 50, item);
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 60, '背包已满，物品已放置在地上', '#ff4444'));
        } else {
            EquipManager.addToBackpack(item);
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 20, `获得: ${item.name}`, '#7aba7a'));
        }
    },

    _render() {
        const container = getElement('rewardCardsContainer');
        if (!container) return;
        container.innerHTML = this.CARDS.map((card, idx) => {
            const selected = this._selected === idx;
            const disabled = this._selected !== null && this._selected !== idx;
            return `
                <div class="reward-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}" 
                     onclick="${disabled ? '' : `RewardSystem.selectCard(${idx})`}">
                    <div class="reward-card-bg"></div>
                    <div class="reward-card-icon">${card.icon}</div>
                    <div class="reward-card-title">${card.title}</div>
                    <div class="reward-card-desc">${card.desc}</div>
                    ${selected ? '<div class="reward-card-selected">✓ 已选择</div>' : ''}
                </div>
            `;
        }).join('');
    }
};

// 强化大类物品定义
export const EnhancementItems = {
    enhance_stone: {
        name: '强化石',
        type: '强化材料',
        icon: '💎',
        iconImage: 'assets/items/enhance_stone.png',
        category: 'enhancement',
        subCategory: 'stone',
        desc: '用于强化装备的特殊材料，蕴含神秘力量',
        stack: 1,
        maxStack: 9999,
        price: 100
    },
    modify_ticket: {
        name: '改造券',
        type: '强化材料',
        icon: '🔧',
        iconImage: 'assets/items/modify_ticket.png',
        category: 'enhancement',
        subCategory: 'ticket',
        desc: '用于改造装备的凭证，可使装备获得特殊能力',
        stack: 1,
        maxStack: 9999,
        price: 200
    }
};
