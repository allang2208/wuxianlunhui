const EnhanceSystem = {
    _isOpen: false,
    _currentNPC: null,
    _equippedItem: null,
    _maxEnhanceLevel: 15,
    _baseCost: 100,

    open(npc) {
        this._isOpen = true;
        this._currentNPC = npc;
        SystemUI.open('equip');
        const panel = document.getElementById('enhancePanel');
        if (panel) panel.classList.add('active');
        this._setupDragDrop();
        this._updateUI();
    },

    close() {
        this._isOpen = false;
        this._currentNPC = null;
        this._returnEquippedItem();
        const panel = document.getElementById('enhancePanel');
        if (panel) panel.classList.remove('active');
        setTimeout(() => {
            if (!this._isOpen && !ShopSystem._isOpen && !CraftSystem._isOpen && !EnchantSystem._isOpen) {
                SystemUI.close();
            }
        }, 300);
    },

    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    },

    _setupDragDrop() {
        const slot = document.getElementById('enhanceSlot');
        if (!slot) return;
        slot.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            slot.classList.add('drag-over');
        };
        slot.ondragleave = (e) => {
            slot.classList.remove('drag-over');
        };
        slot.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            slot.classList.remove('drag-over');
            const src = EquipManager._dragDropManager._dragSrc;
            if (!src) return;
            EquipManager._dragDropManager._dropHandled = true;
            if (src.type === 'inventory') {
                const idx = parseInt(src.slot);
                const item = EquipManager.backpackItems.find(i => i.slot === idx);
                if (item && item.category !== 'gold') {
                    this.equipFromBackpack(idx);
                }
            } else if (src.type === 'equip') {
                const slotKey = src.slot;
                const item = Game.player.equipments[slotKey];
                if (item) {
                    this.equipFromSlot(slotKey);
                }
            }
            EquipManager._dragDropManager._dragSrc = null;
        };
        // 强化槽中的物品可拖出
        slot.draggable = true;
        slot.ondragstart = (e) => {
            if (!this._equippedItem) return;
            EquipManager._dragDropManager._dragSrc = { type: 'enhance', slot: 'enhance' };
            EquipManager._dragDropManager._dropHandled = false;
            e.dataTransfer.setData('text/plain', 'enhance');
            e.dataTransfer.effectAllowed = 'move';
            slot.classList.add('dragging');
        };
        slot.ondragend = (e) => {
            slot.classList.remove('dragging');
            if (!EquipManager._dragDropManager._dropHandled && EquipManager._dragDropManager._dragSrc) {
                // 拖到空白处：归还到背包
                this._returnEquippedItem();
                this._updateUI();
            }
            EquipManager._dragDropManager._dropHandled = false;
            EquipManager._dragDropManager._dragSrc = null;
        };
    },

    equipFromBackpack(index) {
        if (this._equippedItem) {
            this._returnEquippedItem();
        }
        const bp = EquipManager.backpackItems || [];
        const item = bp.find(i => i.slot === index);
        if (!item) return;
        if (item.category === 'gold' || item.name === '金币') {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 40, '金币不能强化！', '#ff4444'));
            return;
        }
        // 从背包移除（移动容器）
        const itemIdx = bp.indexOf(item);
        if (itemIdx >= 0) bp.splice(itemIdx, 1);
        this._equippedItem = { item: JSON.parse(JSON.stringify(item)), source: 'backpack', index };
        EquipManager.updateInventorySlots();
        this._updateUI();
    },

    equipFromSlot(slotKey) {
        if (this._equippedItem) {
            this._returnEquippedItem();
        }
        const item = Game.player.equipments[slotKey];
        if (!item) return;
        // 从装备栏移除（移动容器）
        Game.player.equipments[slotKey] = null;
        EquipManager._clearWeaponState(slotKey);
        this._equippedItem = { item: JSON.parse(JSON.stringify(item)), source: 'equip', slotKey };
        EquipManager.updateEquipSlots();
        this._updateUI();
    },

    _returnEquippedItem() {
        if (!this._equippedItem) return;
        const { item, source, slotKey } = this._equippedItem;
        // 如果来自装备槽，优先归还到装备槽
        if (source === 'equip' && slotKey && Game.player.equipments.hasOwnProperty(slotKey)) {
            // 检查装备槽是否为空
            if (!Game.player.equipments[slotKey] || !Game.player.equipments[slotKey].name) {
                Game.player.equipments[slotKey] = JSON.parse(JSON.stringify(item));
                this._equippedItem = null;
                EquipManager.updateEquipSlots();
                EquipManager.updateInventorySlots();
                return;
            }
        }
        // 归还到背包
        const usedSlots = new Set((EquipManager.backpackItems || []).map(i => i.slot));
        let slot = 0;
        while (usedSlots.has(slot) && slot < EquipManager.maxBackpackSlots) slot++;
        if (slot >= EquipManager.maxBackpackSlots) {
            // 背包满，装备掉落在地上
            if (Game.player && Game.dropItem) {
                Game.dropItem(Game.player.x, Game.player.y, item);
            }
            EquipManager._showBackpackFullNotice();
            this._equippedItem = null;
            EquipManager.updateEquipSlots();
            EquipManager.updateInventorySlots();
            return;
        }
        const clone = JSON.parse(JSON.stringify(item));
        clone.slot = slot;
        if (!EquipManager.backpackItems) EquipManager.backpackItems = [];
        EquipManager.backpackItems.push(clone);
        this._equippedItem = null;
        EquipManager.updateInventorySlots();
        EquipManager.updateEquipSlots();
    },

    enhance() {
        if (!this._equippedItem) {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 40, '请先放入装备！', '#ff4444'));
            return;
        }
        const { item } = this._equippedItem;
        const player = Game.player;
        if (!player) return;

        const currentLevel = item.enhanceLevel || 0;
        if (currentLevel >= this._maxEnhanceLevel) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, '已达最高强化等级！', '#ff4444'));
            return;
        }

        const cost = Math.floor(this._baseCost * Math.pow(1.5, currentLevel));
        if (ShopSystem._getBackpackGold() < cost) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `金币不足！需要 ${cost} 金币`, '#ff4444'));
            return;
        }
        if (!ShopSystem._deductGold(cost)) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `金币不足！需要 ${cost} 金币`, '#ff4444'));
            return;
        }
        item.enhanceLevel = (item.enhanceLevel || 0) + 1;

        if (item.category === 'weapon_melee' || item.category === 'weapon_ranged' || item.weaponType) {
            const el = item.enhanceLevel || 0;
            const atkStat = item.stats.find(s => s.name === '物理攻击');
            // 强化效果已统一在 getCurrentWeaponAtk() 中计算，这里只更新 stats 的显示值
            // 读取原始基础值（未强化时），然后加上强化等级
            let baseMin = 0, baseMax = 0;
            if (item.weaponId === 'weapon1') { baseMin = 6; baseMax = 6; }
            else if (item.weaponId === 'weapon2') { baseMin = 10; baseMax = 10; }
            else if (item.weaponId === 'weapon3') { baseMin = 6; baseMax = 6; }
            else if (item.weaponId === 'weapon14') { baseMin = 50; baseMax = 50; }
            else if (item.weaponId === 'weapon4') { baseMin = 8; baseMax = 8; }
            else if (item.weaponId === 'weapon5') { baseMin = 12; baseMax = 12; }
            else if (item.weaponId === 'weapon6') { baseMin = 10; baseMax = 10; }
            else if (item.weaponId === 'weapon7') { baseMin = 3; baseMax = 3; }
            else if (item.weaponId === 'weapon8') { baseMin = 7; baseMax = 7; }
            else if (item.weaponId === 'weapon12') { baseMin = 1; baseMax = 3; }
            else if (item.weaponId === 'weapon13') { baseMin = 1; baseMax = 3; }
            else if (atkStat && atkStat.value) {
                const match = String(atkStat.value).match(/(\d+)/);
                if (match) { baseMin = parseInt(match[1]); baseMax = match[2] ? parseInt(match[2]) : baseMin; }
            }
            if (baseMin > 0) {
                const displayMin = baseMin + el;
                const displayMax = baseMax + el;
                if (atkStat) {
                    atkStat.value = displayMin === displayMax ? `${displayMin}` : `${displayMin}-${displayMax}`;
                } else {
                    item.stats.push({ name: '物理攻击', value: `${displayMin}-${displayMax}` });
                }
            }
        }

        this._playEnhanceEffect();

        setTimeout(() => {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `强化成功！+${item.enhanceLevel}`, '#ffd700'));
            this._updateUI();
            EquipManager.updateEquipSlots();
            EquipManager.updateInventorySlots();
        }, 800);
    },

    _playEnhanceEffect() {
        const slot = document.getElementById('enhanceSlot');
        if (!slot) return;
        slot.classList.add('enhancing');
        setTimeout(() => slot.classList.remove('enhancing'), 900);
    },

    removeItem() {
        this._returnEquippedItem();
        this._updateUI();
    },

    _updateUI() {
        const player = Game.player;
        const moneyEl = document.getElementById('enhanceMoney');
        if (moneyEl && player) moneyEl.textContent = `💰 ${ShopSystem._getBackpackGold()}`;

        const slot = document.getElementById('enhanceSlot');
        const slotInfo = document.getElementById('enhanceSlotInfo');
        const enhanceBtn = document.getElementById('enhanceBtn');
        const costEl = document.getElementById('enhanceCost');

        if (!slot || !slotInfo || !enhanceBtn || !costEl) return;

        if (this._equippedItem) {
            const item = this._equippedItem.item;
            const level = item.enhanceLevel || 0;
            const cost = Math.floor(this._baseCost * Math.pow(1.5, level));
            slot.innerHTML = `
                <div class="slot-icon">${item.iconImage ? `<img src="${item.iconImage}" alt="${item.icon || '❓'}" onerror="this.style.display='none';this.parentElement.textContent='${item.icon || '❓'}';">` : (item.icon || '❓')}</div>
                <div class="slot-name">${item.name}</div>
                <div class="slot-level">+${level}</div>
            `;
            slot.classList.add('has-item');
            slotInfo.innerHTML = `
                <div class="enhance-info-name">${item.name}</div>
                <div class="enhance-info-level">当前强化等级: +${level} / ${this._maxEnhanceLevel}</div>
                ${this._buildPredictedStats(item)}
            `;
            costEl.textContent = `💰 ${cost}`;
            enhanceBtn.disabled = false;
            enhanceBtn.onclick = () => this.enhance();
            slot.onclick = () => this.removeItem();
            slot.ondblclick = () => this.removeItem();
            slot.oncontextmenu = (e) => { e.preventDefault(); this.removeItem(); };
        } else {
            slot.innerHTML = '<div class="enhance-slot-placeholder">拖入装备</div>';
            slot.classList.remove('has-item');
            slotInfo.innerHTML = '<div class="enhance-info-placeholder">请将装备拖入上方强化槽</div>';
            costEl.textContent = '💰 0';
            enhanceBtn.disabled = true;
            enhanceBtn.onclick = null;
            slot.onclick = null;
            slot.ondblclick = null;
            slot.oncontextmenu = null;
        }
    },

    _formatStats(item) {
        if (!item.stats || item.stats.length === 0) return '';
        return item.stats.map(s => `${s.name}: ${s.value}`).join(' | ');
    },

    _buildPredictedStats(item) {
        if (!item.weaponId || !Game.player || !Game.player.getCurrentWeaponAtk) return '';
        const currentLevel = item.enhanceLevel || 0;
        if (currentLevel >= this._maxEnhanceLevel) {
            return '<div class="enhance-predicted" style="margin-top:8px;color:#7a9a6a;font-size:12px;">已达到最高强化等级</div>';
        }
        // 计算当前攻击力
        const currentAtk = Game.player.getCurrentWeaponAtk(item);
        // 模拟下一级攻击力
        const nextItem = JSON.parse(JSON.stringify(item));
        nextItem.enhanceLevel = currentLevel + 1;
        const nextAtk = Game.player.getCurrentWeaponAtk(nextItem);
        const diff = nextAtk - currentAtk;
        const diffSign = diff > 0 ? '+' : '';
        // 构建攻击力公式
        const el = currentLevel + 1;
        const d = Game.player.data;
        let formula = '';
        if (item.weaponId === 'weapon1') {
            formula = `${6 + el} + 力量×${(0.5 + 0.02 * el).toFixed(2)} + 敏捷×${(0.5 + 0.02 * el).toFixed(2)}`;
        } else if (item.weaponId === 'weapon2') {
            formula = `${10 + el} + 力量×${(1 + 0.02 * el).toFixed(2)} + 敏捷×${(0.5 + 0.02 * el).toFixed(2)}`;
        } else if (item.weaponId === 'weapon3') {
            formula = `${6 + el} + 敏捷×${(0.35 + 0.02 * el).toFixed(2)}`;
        } else if (item.weaponId === 'weapon14') {
            formula = `${50 + el * 10} + 敏捷×${(2 + 1.5 * el).toFixed(2)} + 力量×${(1.5 + 1.5 * el).toFixed(2)}`;
        } else if (item.weaponId === 'weapon4') {
            formula = `${8 + el} + 力量×${(0.6 + 0.02 * el).toFixed(2)} + 智力×${(1 + 0.02 * el).toFixed(2)}`;
        } else if (item.weaponId === 'weapon5') {
            formula = `${12 + el} + 力量×${(1.2 + 0.02 * el).toFixed(2)} + 智力×${(1 + 0.02 * el).toFixed(2)}`;
        } else if (item.weaponId === 'weapon6') {
            formula = `${10 + el} + 力量×${(0.5 + 0.15 * el).toFixed(2)} + 精神×${(0.35 + 0.1 * el).toFixed(2)}`;
        } else if (item.weaponId === 'weapon7') {
            formula = `${3 + el} + 力量×${(0.05 + 0.01 * el).toFixed(2)} + 精神×${(0.15 + 0.02 * el).toFixed(2)}`;
        } else if (item.weaponId === 'weapon8') {
            formula = `${7 + el} + 力量×${(0.4 + 0.12 * el).toFixed(2)} + 精神×${(0.45 + 0.2 * el).toFixed(2)}`;
        } else if (item.weaponId === 'weapon9') {
            formula = `${1 + el} + 敏捷×${(0.05 + 0.02 * el).toFixed(2)} + 精神×${(0.08 + 0.02 * el).toFixed(2)}`;
        } else if (item.weaponId === 'weapon10') {
            formula = `${30 + el * 5} + 敏捷×${(1 + 1.25 * el).toFixed(2)} + 精神×${(2 + 2 * el).toFixed(2)}`;
        } else if (item.weaponId === 'weapon12') {
            formula = `${10 + el} + 体质×${(0.2 + 0.10 * el).toFixed(2)} + 精神×${(0.5 + 0.15 * el).toFixed(2)}`;
        } else if (item.weaponId === 'weapon13') {
            formula = `${8 + el} + 体质×${(0.5 + 0.15 * el).toFixed(2)} + 精神×${(0.25 + 0.10 * el).toFixed(2)}`;
        } else if (item.weaponType === 'pkm') {
            formula = `${10 + el} + 力量×${(0.5 + 0.15 * el).toFixed(2)} + 精神×${(0.35 + 0.1 * el).toFixed(2)}`;
        } else if (item.weaponType === 'akm') {
            formula = `${3 + el} + 力量×${(0.05 + 0.01 * el).toFixed(2)} + 精神×${(0.15 + 0.02 * el).toFixed(2)}`;
        } else if (item.weaponType === 'qbz191') {
            formula = `${3 + el} + 力量×${(0.04 + 0.01 * el).toFixed(2)} + 精神×${(0.18 + 0.02 * el).toFixed(2)}`;
        } else if (item.weaponType === 'qjb201') {
            formula = `${7 + el} + 力量×${(0.4 + 0.12 * el).toFixed(2)} + 精神×${(0.45 + 0.2 * el).toFixed(2)}`;
        }
        return `<div class="enhance-predicted" style="margin-top:8px;padding:6px 8px;background:rgba(255,215,0,0.08);border-radius:6px;border:1px solid rgba(255,215,0,0.2);">
            <div style="color:#ffd700;font-size:12px;font-weight:600;margin-bottom:2px;">📈 预计强化效果 (+${currentLevel + 1})</div>
            <div style="color:#d4c5a9;font-size:11px;">物理攻击: ${currentAtk} → <span style="color:#ffd700;font-weight:700;">${nextAtk}</span> <span style="color:#7a9a6a;">(${diffSign}${diff})</span></div>
            ${formula ? `<div style="color:#8a9a7a;font-size:10px;margin-top:2px;">公式: ${formula}</div>` : ''}
        </div>`;
    }
};

export { EnhanceSystem };
