const ShopSystem = {
    _isOpen: false,

    // 测试商品列表
    _items: [
        { id: 'potion_small', name: '小型生命药水', icon: '🧪', type: 'consumable', price: 50, desc: '恢复 50 点生命值' },
        { id: 'potion_large', name: '大型生命药水', icon: '💊', type: 'consumable', price: 120, desc: '恢复 150 点生命值' },
        { id: 'rusty_sword', name: '生锈的长剑', icon: '⚔', type: 'weapon', price: 200, desc: '攻击力 +6~10' },
        { id: 'knight_sword', name: '骑士长剑', icon: '⚔', type: 'weapon', price: 800, desc: '攻击力 +18~23' },
        { id: 'wooden_bow', name: '练习弓', icon: '🏹', type: 'weapon', price: 150, desc: '攻击力 +6~8' },
        { id: 'iron_armor', name: '铁制盔甲', icon: '🛡', type: 'armor', price: 500, desc: '防御力 +15' },
        { id: 'speed_boots', name: '疾风靴', icon: '👢', type: 'boots', price: 300, desc: '移动速度 +10%' },
        { id: 'lucky_ring', name: '幸运戒指', icon: '💍', type: 'accessory', price: 1000, desc: '暴击率 +5%' }
    ],

    open() {
        this._isOpen = true;
        const panel = document.getElementById('shopPanel');
        if (panel) panel.style.display = 'flex';
        this._updateUI();
    },

    close() {
        this._isOpen = false;
        const panel = document.getElementById('shopPanel');
        if (panel) panel.style.display = 'none';
    },

    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    },

    buy(itemId) {
        const player = Game.player;
        if (!player) return;

        const item = this._items.find(i => i.id === itemId);
        if (!item) return;

        if (player.data.money < item.price) {
            // 显示金币不足提示
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, '金币不足！', '#ff4444'));
            return;
        }

        // 扣款
        player.data.money -= item.price;

        // 根据物品类型添加到背包或装备
        if (item.type === 'weapon' || item.type === 'armor' || item.type === 'boots' || item.type === 'accessory') {
            // 查找对应装备数据
            const equipItem = this._getEquipItemData(itemId);
            if (equipItem) {
                EquipManager.addToInventory(equipItem);
            }
        } else {
            // 消耗品直接增加
            // 简化处理：显示购买成功
        }

        // 播放购买音效（可选）
        EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `购买成功：${item.name}`, '#ffd700'));
        this._updateUI();
    },

    _getEquipItemData(itemId) {
        // 映射到 EquipManager 中的物品
        const map = {
            'rusty_sword': EquipManager.ITEMS?.rusty_sword || null,
            'knight_sword': EquipManager.KINGHTS_SWORD_ITEM || null,
            'wooden_bow': EquipManager.ITEMS?.wooden_bow || null,
            'iron_armor': null, // 盔甲暂无，可后续添加
            'speed_boots': null,
            'lucky_ring': null
        };
        return map[itemId];
    },

    _updateUI() {
        const player = Game.player;
        const moneyEl = document.getElementById('shopMoney');
        if (moneyEl && player) moneyEl.textContent = `💰 ${player.data.money || 0}`;

        const grid = document.getElementById('shopGrid');
        if (!grid) return;

        grid.innerHTML = '';
        this._items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'shop-item-card';
            card.innerHTML = `
                <div class="shop-item-icon">${item.icon}</div>
                <div class="shop-item-name">${item.name}</div>
                <div class="shop-item-price">💰 ${item.price}</div>
                <div class="shop-item-desc">${item.desc}</div>
            `;
            card.onclick = () => this.buy(item.id);
            grid.appendChild(card);
        });
    }
};

export { ShopSystem };
