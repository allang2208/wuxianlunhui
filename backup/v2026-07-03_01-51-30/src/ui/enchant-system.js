import { EnchantConfig, EnchantScrollItems, MagicDustItem } from '../config/enchant-config.js';
import { ItemFactory } from '../items/item-factory.js';
import { EquipManager } from './equip-manager.js';
import { SystemUI } from './system-ui.js';
import { Game } from '../game.js';
import { SoundManager } from './sound-manager.js';

const EnchantSystem = {
    _isOpen: false,
    _currentNPC: null,

    // 槽位物品
    _scrollItem: null,      // 附魔卷轴
    _equipItem: null,       // 装备
    _scrollSource: null,    // { type, index/slot }
    _equipSource: null,     // { type, index/slot }

    // 初始化
    init() {
        this._setupDragDrop();
    },

    // 打开附魔界面
    open(npc) {
        try {
            this._isOpen = true;
            this._currentNPC = npc;
            const panel = document.getElementById('enchantPanel');
            if (panel) panel.classList.add('active');
            SystemUI.open('equip');
            this._setupDragDrop();
            this._updateUI();
            this._updateDustDisplay();
            this._showInstruction();
        } catch (e) {
            console.error('[EnchantSystem.open] Error:', e);
        }
    },

    // 显示附魔栏说明文字
    _showInstruction() {
        const enchantBody = document.querySelector('#enchantPanel .enchant-body');
        if (!enchantBody) return;
        let instructionEl = document.getElementById('enchantInstruction');
        if (!instructionEl) {
            instructionEl = document.createElement('div');
            instructionEl.id = 'enchantInstruction';
            instructionEl.style.cssText = 'width:100%;padding:10px 12px;margin-top:8px;background:rgba(0,0,0,0.15);border-radius:8px;color:#8a7d6b;font-size:13px;line-height:1.6;text-align:center;font-family:SimHei,\'Microsoft YaHei\',\'黑体\',sans-serif;';
            enchantBody.appendChild(instructionEl);
        }
        instructionEl.textContent = '拖入卷轴点击转换晶尘可以生成晶尘，拖入装备和附魔卷轴进行附魔。';
        instructionEl.style.display = 'block';
    },

    // 关闭附魔界面
    close() {
        try {
            if (!this._isOpen) return;
            this._returnScrollItem();
            this._returnEquipItem();
            this._isOpen = false;
            // 隐藏说明文字
            const instructionEl = document.getElementById('enchantInstruction');
            if (instructionEl) instructionEl.style.display = 'none';
            // 刷新背包和装备栏显示
            if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();
            if (EquipManager.updateEquipSlots) EquipManager.updateEquipSlots();
            const panel = document.getElementById('enchantPanel');
            if (panel) panel.classList.remove('active');
            setTimeout(() => {
                if (!this._isOpen && !ShopSystem._isOpen && !EnhanceSystem._isOpen && !CraftSystem._isOpen) {
                    SystemUI.close();
                }
            }, 300);
        } catch (e) {
            console.error('[EnchantSystem.close] Error:', e);
        }
    },

    // 设置拖放
    _setupDragDrop() {
        const scrollSlot = document.getElementById('enchantScrollSlot');
        const equipSlot = document.getElementById('enchantEquipSlot');
        if (!scrollSlot || !equipSlot) return;

        // 卷轴槽拖出
        scrollSlot.ondragstart = (e) => {
            if (!this._scrollItem) return false;
            EquipManager._dragDropManager._dragSrc = { type: 'enchantScroll', slot: 'scroll' };
            EquipManager._dragDropManager._dropHandled = false;
            e.dataTransfer.setData('text/plain', 'enchant-scroll');
            // 自定义拖拽图像
            const canvas = document.createElement('canvas');
            canvas.width = 56; canvas.height = 56;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#3d342b'; ctx.fillRect(0, 0, 56, 56);
            ctx.strokeStyle = '#6b5d4f'; ctx.strokeRect(2, 2, 52, 52);
            ctx.font = '28px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#d4c5a9'; ctx.fillText(this._scrollItem.icon || '📜', 28, 28);
            e.dataTransfer.setDragImage(canvas, 28, 28);
            return true;
        };

        // 装备槽拖出
        equipSlot.ondragstart = (e) => {
            if (!this._equipItem) return false;
            EquipManager._dragDropManager._dragSrc = { type: 'enchantEquip', slot: 'equip' };
            EquipManager._dragDropManager._dropHandled = false;
            e.dataTransfer.setData('text/plain', 'enchant-equip');
            const canvas = document.createElement('canvas');
            canvas.width = 56; canvas.height = 56;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#3d342b'; ctx.fillRect(0, 0, 56, 56);
            ctx.strokeStyle = '#6b5d4f'; ctx.strokeRect(2, 2, 52, 52);
            ctx.font = '28px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = '#d4c5a9'; ctx.fillText(this._equipItem.icon || '⚔️', 28, 28);
            e.dataTransfer.setDragImage(canvas, 28, 28);
            return true;
        };

        // 卷轴槽接收
        scrollSlot.ondragover = (e) => { e.preventDefault(); scrollSlot.classList.add('drag-over'); };
        scrollSlot.ondragleave = () => { scrollSlot.classList.remove('drag-over'); };
        scrollSlot.ondrop = (e) => {
            e.preventDefault();
            scrollSlot.classList.remove('drag-over');
            const src = EquipManager._dragDropManager._dragSrc;
            if (!src) return;
            EquipManager._dragDropManager._dropHandled = true;

            if (src.type === 'inventory') {
                this._equipScrollFromBackpack(src.slot);
            } else if (src.type === 'equip') {
                // 不能从装备栏拖入卷轴槽
                this._showMessage('不能从装备栏放入卷轴');
            } else if (src.type === 'enchantScroll') {
                // 已在槽内，不处理
            } else if (src.type === 'enchantEquip') {
                // 不能从装备槽拖入卷轴槽
                this._showMessage('请放入附魔卷轴');
            }
        };

        // 装备槽接收
        equipSlot.ondragover = (e) => { e.preventDefault(); equipSlot.classList.add('drag-over'); };
        equipSlot.ondragleave = () => { equipSlot.classList.remove('drag-over'); };
        equipSlot.ondrop = (e) => {
            e.preventDefault();
            equipSlot.classList.remove('drag-over');
            const src = EquipManager._dragDropManager._dragSrc;
            if (!src) return;
            EquipManager._dragDropManager._dropHandled = true;

            if (src.type === 'inventory') {
                this._equipItemFromBackpack(src.slot);
            } else if (src.type === 'equip') {
                this._equipItemFromSlot(src.slot);
            } else if (src.type === 'enchantScroll') {
                this._showMessage('请放入装备');
            } else if (src.type === 'enchantEquip') {
                // 已在槽内，不处理
            }
        };

        // 右键点击槽位 - 卷轴和装备都可以取出
        scrollSlot.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log(`[EnchantSystem] scrollSlot right-click: _scrollItem=${this._scrollItem ? this._scrollItem.name : 'null'}`);
            if (this._scrollItem) {
                this._returnScrollItem();
                this._updateUI();
            }
        };
        equipSlot.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log(`[EnchantSystem] equipSlot right-click: _equipItem=${this._equipItem ? this._equipItem.name : 'null'}`);
            if (this._equipItem) {
                this._returnEquipItem();
                this._updateUI();
            }
        };
    },

    // 从背包放入卷轴
    _equipScrollFromBackpack(index) {
        console.log(`[EnchantSystem._equipScrollFromBackpack] index=${index}, _scrollItem=${this._scrollItem ? this._scrollItem.name : 'null'}`);
        const bp = EquipManager.backpackItems;
        const item = bp.find(i => i.slot === parseInt(index));
        if (!item) {
            console.log(`[EnchantSystem._equipScrollFromBackpack] item not found at index ${index}`);
            return;
        }
        if (item.category !== 'consumable' || !item.scrollId) {
            this._showMessage('这不是附魔卷轴');
            console.log(`[EnchantSystem._equipScrollFromBackpack] not a scroll: category=${item.category}, scrollId=${item.scrollId}`);
            return;
        }
        // 检查已有装备是否匹配
        if (this._equipItem) {
            if (!EnchantConfig.canEnchant(this._equipItem, item.scrollId)) {
                this._showMessage('不符合附魔条件');
                console.log(`[EnchantSystem._equipScrollFromBackpack] cannot enchant`);
                return;
            }
        }
        // 移除原槽位物品
        this._returnScrollItem();
        // 从背包移除
        bp.splice(bp.indexOf(item), 1);
        this._scrollItem = JSON.parse(JSON.stringify(item));
        this._scrollSource = { type: 'backpack', slot: parseInt(index) };
        console.log(`[EnchantSystem._equipScrollFromBackpack] success: item=${item.name}, bp.length=${bp.length}`);
        this._checkCompatibility();
        this._updateUI();
    },

    // 从背包放入装备
    _equipItemFromBackpack(index) {
        const bp = EquipManager.backpackItems;
        const item = bp.find(i => i.slot === parseInt(index));
        if (!item) return;
        if (item.category !== 'weapon_melee' && item.category !== 'weapon_ranged') {
            this._showMessage('只能附魔武器');
            return;
        }
        // 检查已有卷轴是否匹配
        if (this._scrollItem) {
            if (!EnchantConfig.canEnchant(item, this._scrollItem.scrollId)) {
                this._showMessage('不符合附魔条件');
                // 退回卷轴到背包
                this._returnScrollItem();
                return;
            }
        }
        // 移除原槽位物品
        this._returnEquipItem();
        // 从背包移除
        bp.splice(bp.indexOf(item), 1);
        this._equipItem = JSON.parse(JSON.stringify(item));
        // 恢复 weaponAsset 等非序列化字段
        if (item.weaponAsset) this._equipItem.weaponAsset = item.weaponAsset;
        this._equipSource = { type: 'backpack', slot: parseInt(index) };
        this._checkCompatibility();
        this._updateUI();
    },

    // 从装备栏放入装备
    _equipItemFromSlot(slotKey) {
        const player = Game.player;
        if (!player || !player.equipments[slotKey]) return;
        const item = player.equipments[slotKey];
        if (item.category !== 'weapon_melee' && item.category !== 'weapon_ranged') {
            this._showMessage('只能附魔武器');
            return;
        }
        // 检查已有卷轴是否匹配
        if (this._scrollItem) {
            if (!EnchantConfig.canEnchant(item, this._scrollItem.scrollId)) {
                this._showMessage('不符合附魔条件');
                // 退回卷轴到背包
                this._returnScrollItem();
                return;
            }
        }
        // 移除原槽位物品
        this._returnEquipItem();
        // 从装备栏移除
        player.equipments[slotKey] = null;
        this._equipItem = JSON.parse(JSON.stringify(item));
        if (item.weaponAsset) this._equipItem.weaponAsset = item.weaponAsset;
        this._equipSource = { type: 'equip', slot: slotKey };
        this._checkCompatibility();
        this._updateUI();
    },

    // 检查兼容性 - 如果先放入卷轴再放入装备不匹配，或先放入装备再放入卷轴不匹配
    _checkCompatibility() {
        if (!this._scrollItem || !this._equipItem) return;
        const canEnchant = EnchantConfig.canEnchant(this._equipItem, this._scrollItem.scrollId);
        if (!canEnchant) {
            // 不匹配，根据后放入的退回
            this._showMessage('不符合附魔条件');
        }
    },

    // 退回卷轴
    _returnScrollItem() {
        if (!this._scrollItem) {
            console.log('[EnchantSystem._returnScrollItem] no scroll item to return');
            return;
        }
        const bp = EquipManager.backpackItems;
        let returned = false;
        console.log(`[EnchantSystem._returnScrollItem] scrollSource=${JSON.stringify(this._scrollSource)}, bp.length=${bp.length}`);
        if (this._scrollSource && this._scrollSource.type === 'backpack') {
            const originalSlot = parseInt(this._scrollSource.slot);
            const existing = bp.find(i => i.slot === originalSlot);
            if (!existing) {
                this._scrollItem.slot = originalSlot;
                bp.push(this._scrollItem);
                returned = true;
                console.log(`[EnchantSystem._returnScrollItem] returned to original slot ${originalSlot}`);
            } else {
                // 找第一个空位
                const emptySlot = EquipManager._findFirstEmptySlot();
                if (emptySlot !== -1) {
                    this._scrollItem.slot = emptySlot;
                    bp.push(this._scrollItem);
                    returned = true;
                    console.log(`[EnchantSystem._returnScrollItem] returned to empty slot ${emptySlot}`);
                }
            }
        } else {
            // 找空位
            const emptySlot = EquipManager._findFirstEmptySlot();
            if (emptySlot !== -1) {
                this._scrollItem.slot = emptySlot;
                bp.push(this._scrollItem);
                returned = true;
                console.log(`[EnchantSystem._returnScrollItem] returned to empty slot ${emptySlot} (no source)`);
            }
        }
        if (!returned) {
            // 背包满，掉落到地上
            const player = Game.player;
            if (player) {
                Game.dropItem(player.x, player.y, this._scrollItem);
                // 使用游戏内浮动文字显示消息
                if (typeof EffectManager !== 'undefined' && typeof FloatingTextEffect !== 'undefined') {
                    EffectManager.add(new FloatingTextEffect(player.x, player.y - 30, '背包已满，卷轴掉落在地上'));
                }
                this._showMessage('背包已满，卷轴掉落在地上', 'error');
                console.log(`[EnchantSystem._returnScrollItem] dropped on ground`);
            }
        }
        this._scrollItem = null;
        this._scrollSource = null;
    },

    // 退回装备
    _returnEquipItem() {
        if (!this._equipItem) {
            console.log('[EnchantSystem._returnEquipItem] no equip item to return');
            return;
        }
        const bp = EquipManager.backpackItems;
        let returned = false;
        console.log(`[EnchantSystem._returnEquipItem] equipSource=${JSON.stringify(this._equipSource)}, bp.length=${bp.length}`);
        if (this._equipSource && this._equipSource.type === 'equip') {
            // 放回装备栏
            const player = Game.player;
            if (player && !player.equipments[this._equipSource.slot]) {
                player.equipments[this._equipSource.slot] = this._equipItem;
                returned = true;
                console.log(`[EnchantSystem._returnEquipItem] returned to equip slot ${this._equipSource.slot}`);
            } else {
                // 找空位放背包
                const emptySlot = EquipManager._findFirstEmptySlot();
                if (emptySlot !== -1) {
                    this._equipItem.slot = emptySlot;
                    bp.push(this._equipItem);
                    returned = true;
                    console.log(`[EnchantSystem._returnEquipItem] returned to backpack slot ${emptySlot}`);
                }
            }
        } else if (this._equipSource && this._equipSource.type === 'backpack') {
            const originalSlot = parseInt(this._equipSource.slot);
            const existing = bp.find(i => i.slot === originalSlot);
            if (!existing) {
                this._equipItem.slot = originalSlot;
                bp.push(this._equipItem);
                returned = true;
                console.log(`[EnchantSystem._returnEquipItem] returned to original backpack slot ${originalSlot}`);
            } else {
                const emptySlot = EquipManager._findFirstEmptySlot();
                if (emptySlot !== -1) {
                    this._equipItem.slot = emptySlot;
                    bp.push(this._equipItem);
                    returned = true;
                    console.log(`[EnchantSystem._returnEquipItem] returned to backpack slot ${emptySlot}`);
                }
            }
        } else {
            const emptySlot = EquipManager._findFirstEmptySlot();
            if (emptySlot !== -1) {
                this._equipItem.slot = emptySlot;
                bp.push(this._equipItem);
                returned = true;
                console.log(`[EnchantSystem._returnEquipItem] returned to backpack slot ${emptySlot} (no source)`);
            }
        }
        if (!returned) {
            // 背包满，掉落到地上
            const player = Game.player;
            if (player) {
                Game.dropItem(player.x, player.y, this._equipItem);
                // 使用游戏内浮动文字显示消息
                if (typeof EffectManager !== 'undefined' && typeof FloatingTextEffect !== 'undefined') {
                    EffectManager.add(new FloatingTextEffect(player.x, player.y - 30, '背包已满，装备掉落在地上'));
                }
                this._showMessage('背包已满，装备掉落在地上', 'error');
                console.log(`[EnchantSystem._returnEquipItem] dropped on ground`);
            }
        }
        this._equipItem = null;
        this._equipSource = null;
    },

    // 更新UI
    _updateUI() {
        const scrollSlot = document.getElementById('enchantScrollSlot');
        const equipSlot = document.getElementById('enchantEquipSlot');
        const scrollPlaceholder = document.getElementById('enchantScrollPlaceholder');
        const equipPlaceholder = document.getElementById('enchantEquipPlaceholder');
        const scrollDisplay = document.getElementById('enchantScrollDisplay');
        const equipDisplay = document.getElementById('enchantEquipDisplay');
        const scrollInfo = document.getElementById('enchantScrollInfo');
        const equipInfo = document.getElementById('enchantEquipInfo');
        const preview = document.getElementById('enchantPreview');
        const previewContent = document.getElementById('enchantPreviewContent');
        const doBtn = document.getElementById('enchantDoBtn');

        // 更新卷轴槽
        if (this._scrollItem) {
            scrollSlot.classList.add('occupied');
            scrollPlaceholder.style.display = 'none';
            scrollDisplay.style.display = 'flex';
            const scrollImg = this._scrollItem.iconImage || this._scrollItem.slotImage;
            if (scrollImg) {
                scrollDisplay.innerHTML = `<img src="${scrollImg}" alt="" style="max-width:80%;max-height:80%;" onerror="this.style.display='none';this.parentElement.textContent='${this._scrollItem.icon || '📜'}';">`;
            } else {
                scrollDisplay.textContent = this._scrollItem.icon || '📜';
            }
            const scroll = EnchantConfig.getScroll(this._scrollItem.scrollId);
            scrollInfo.textContent = `${scroll ? scroll.name : ''} [${this._scrollItem.grade || '?'}]`;
        } else {
            scrollSlot.classList.remove('occupied');
            scrollPlaceholder.style.display = 'flex';
            scrollDisplay.style.display = 'none';
            scrollInfo.textContent = '';
        }

        // 更新装备槽
        if (this._equipItem) {
            equipSlot.classList.add('occupied');
            equipPlaceholder.style.display = 'none';
            equipDisplay.style.display = 'flex';
            const equipImg = this._equipItem.iconImage || this._equipItem.slotImage || this._equipItem.equipImage;
            if (equipImg) {
                equipDisplay.innerHTML = `<img src="${equipImg}" alt="" style="max-width:80%;max-height:80%;" onerror="this.style.display='none';this.parentElement.textContent='${this._equipItem.icon || '⚔️'}';">`;
            } else {
                equipDisplay.textContent = this._equipItem.icon || '⚔️';
            }
            equipInfo.textContent = this._equipItem.name || '';
        } else {
            equipSlot.classList.remove('occupied');
            equipPlaceholder.style.display = 'flex';
            equipDisplay.style.display = 'none';
            equipInfo.textContent = '';
        }

        // 更新预览
        if (this._scrollItem && this._equipItem) {
            const scroll = EnchantConfig.getScroll(this._scrollItem.scrollId);
            if (scroll && EnchantConfig.canEnchant(this._equipItem, this._scrollItem.scrollId)) {
                preview.style.display = 'block';
                let html = '';
                if (scroll.type === 'prefix') {
                    html += `<div><span class="enchant-prefix">${scroll.name}</span> ${this._equipItem.name}</div>`;
                } else {
                    html += `<div>${this._equipItem.name} <span class="enchant-suffix">${scroll.name}</span></div>`;
                }
                html += `<div style="margin-top:6px;color:#8a7d6b;">${scroll.desc}</div>`;
                html += `<div style="margin-top:4px;color:#a090c0;">消耗: ${scroll.cost} 魔法晶尘</div>`;
                previewContent.innerHTML = html;
                doBtn.disabled = false;
            } else {
                preview.style.display = 'none';
                doBtn.disabled = true;
            }
        } else {
            preview.style.display = 'none';
            doBtn.disabled = true;
        }

        // 更新背包显示
        if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();
        if (EquipManager.updateEquipSlots) EquipManager.updateEquipSlots();
    },

    // 统计背包中的魔法晶尘数量
    _getDustCount() {
        const bp = EquipManager.backpackItems;
        if (!bp) return 0;
        let total = 0;
        for (const item of bp) {
            if (item && item.name === '魔法晶尘') {
                total += item.stack || 1;
            }
        }
        return total;
    },

    // 从背包中扣除魔法晶尘
    _consumeDust(amount) {
        const bp = EquipManager.backpackItems;
        if (!bp) return false;
        let remaining = amount;
        for (let i = bp.length - 1; i >= 0; i--) {
            const item = bp[i];
            if (item && item.name === '魔法晶尘') {
                const stack = item.stack || 1;
                if (stack <= remaining) {
                    remaining -= stack;
                    bp.splice(i, 1);
                } else {
                    item.stack = stack - remaining;
                    remaining = 0;
                }
                if (remaining <= 0) break;
            }
        }
        return remaining <= 0;
    },

    // 向背包中添加魔法晶尘
    _addDust(amount) {
        const bp = EquipManager.backpackItems;
        if (!bp) return;
        let remaining = amount;
        // 优先填充已有的晶尘堆
        for (const item of bp) {
            if (item && item.name === '魔法晶尘') {
                const maxStack = item.maxStack || 999;
                const space = maxStack - (item.stack || 1);
                if (space > 0) {
                    const add = Math.min(space, remaining);
                    item.stack = (item.stack || 1) + add;
                    remaining -= add;
                    if (remaining <= 0) return;
                }
            }
        }
        // 需要新格子
        while (remaining > 0) {
            const emptySlot = EquipManager._findFirstEmptySlot();
            if (emptySlot === -1) {
                console.error('[EnchantSystem._addDust] backpack full, cannot add dust');
                return;
            }
            const addAmount = Math.min(remaining, 999);
            const dustItem = { ...MagicDustItem, stack: addAmount, slot: emptySlot };
            bp.push(dustItem);
            remaining -= addAmount;
        }
    },

    // 更新魔法晶尘显示
    _updateDustDisplay() {
        const dustEl = document.getElementById('enchantDust');
        if (!dustEl) {
            console.error('[EnchantSystem._updateDustDisplay] enchantDust element not found');
            return;
        }
        const dust = this._getDustCount();
        dustEl.textContent = `✨ 魔法晶尘: ${dust}`;
    },

    // 显示消息
    _showMessage(text, type = 'normal') {
        const msgEl = document.getElementById('enchantMessage');
        if (msgEl) {
            msgEl.textContent = text;
            msgEl.className = 'enchant-message ' + (type === 'error' ? 'error' : type === 'success' ? 'success' : '');
            setTimeout(() => { msgEl.textContent = ''; msgEl.className = 'enchant-message'; }, 3000);
        }
    },

    // 重置 - 退回所有物品
    reset() {
        let returned = false;
        if (this._scrollItem) {
            this._returnScrollItem();
            returned = true;
        }
        if (this._equipItem) {
            this._returnEquipItem();
            returned = true;
        }
        if (returned) {
            this._showMessage('已退回所有物品');
        }
        this._updateUI();
    },

    // 进行附魔
    doEnchant() {
        if (!this._scrollItem || !this._equipItem) {
            this._showMessage('请放入卷轴和装备', 'error');
            return;
        }
        const scroll = EnchantConfig.getScroll(this._scrollItem.scrollId);
        if (!scroll) {
            this._showMessage('无效的附魔卷轴', 'error');
            return;
        }
        if (!EnchantConfig.canEnchant(this._equipItem, this._scrollItem.scrollId)) {
            this._showMessage('不符合附魔条件', 'error');
            return;
        }

        // 检查背包是否有空位（需要返回装备）
        const emptySlot = EquipManager._findFirstEmptySlot();
        if (emptySlot === -1 && !(this._equipSource && this._equipSource.type === 'equip' && Game.player && !Game.player.equipments[this._equipSource.slot])) {
            this._showMessage('背包已满，请先清理背包', 'error');
            return;
        }

        // 检查魔法晶尘
        const dust = this._getDustCount();
        console.log(`[EnchantSystem.doEnchant] dust=${dust}, scroll.cost=${scroll.cost}, scrollId=${this._scrollItem.scrollId}`);
        if (dust < scroll.cost) {
            this._showMessage(`魔法晶尘不足 (需要 ${scroll.cost}, 当前 ${dust})`, 'error');
            return;
        }

        // 记录返回位置（在清空之前）
        const equipSource = this._equipSource;

        // 扣除晶尘
        this._consumeDust(scroll.cost);
        this._updateDustDisplay();

        // 销毁卷轴（不返回）
        this._scrollItem = null;
        this._scrollSource = null;

        // 应用附魔效果到装备
        this._applyEnchant(this._equipItem, scroll);

        // 将装备返回给玩家（保持附魔）
        const enchantedItem = this._equipItem;
        this._equipItem = null;
        this._equipSource = null;

        // 放回装备栏或背包
        if (equipSource && equipSource.type === 'equip') {
            const slot = equipSource.slot;
            const player = Game.player;
            if (player && !player.equipments[slot]) {
                player.equipments[slot] = enchantedItem;
            } else {
                const es = EquipManager._findFirstEmptySlot();
                if (es !== -1) {
                    enchantedItem.slot = es;
                    EquipManager.backpackItems.push(enchantedItem);
                } else {
                    // 背包满，掉落地上
                    if (player) {
                        Game.dropItem(player.x, player.y, enchantedItem);
                    }
                    this._showMessage('装备栏位被占用，附魔装备掉落在地上', 'error');
                }
            }
        } else {
            const es = EquipManager._findFirstEmptySlot();
            if (es !== -1) {
                enchantedItem.slot = es;
                EquipManager.backpackItems.push(enchantedItem);
            } else {
                // 背包满，掉落地上
                const player = Game.player;
                if (player) {
                    Game.dropItem(player.x, player.y, enchantedItem);
                }
                this._showMessage('背包已满，附魔装备掉落在地上', 'error');
            }
        }

        // 播放音效
        if (typeof SoundManager !== 'undefined' && SoundManager.play) {
            SoundManager.play('enchant_success');
        }

        this._showMessage('附魔成功！', 'success');
        this._updateUI();

        // 触发装备更新
        if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();
        if (EquipManager.updateEquipSlots) EquipManager.updateEquipSlots();
    },

    // 应用附魔效果到物品
    _applyEnchant(item, scroll) {
        if (!item._enchantData) item._enchantData = {};
        if (!item._enchantEffects) item._enchantEffects = {};

        // 根据类型设置前缀或后缀
        if (scroll.type === 'prefix') {
            item._enchantData.prefix = { id: scroll.id, name: scroll.name, grade: scroll.grade };
        } else {
            item._enchantData.suffix = { id: scroll.id, name: scroll.name, grade: scroll.grade };
        }

        // 应用效果
        const effects = scroll.effects;
        if (effects.damagePercent) {
            item._enchantEffects.damagePercent = effects.damagePercent;
        }
        if (effects.attackIntervalMul) {
            item._enchantEffects.attackIntervalMul = effects.attackIntervalMul;
        }
        if (effects.critRate) {
            item._enchantEffects.critRate = effects.critRate;
        }
        if (effects.poisonOnHit) {
            item._enchantEffects.poisonOnHit = true;
            item._enchantEffects.poisonStacks = effects.poisonStacks || 1;
        }
        if (effects.piercingBonus) {
            item._enchantEffects.piercingBonus = effects.piercingBonus;
        }

        item._isEnchanted = true;
    },

    // 转换晶尘
    convertDust() {
        if (!this._scrollItem) {
            this._showMessage('请放入附魔卷轴', 'error');
            return;
        }
        const scroll = EnchantConfig.getScroll(this._scrollItem.scrollId);
        if (!scroll) {
            this._showMessage('无效的附魔卷轴', 'error');
            return;
        }

        const reward = EnchantConfig.getConversionReward(this._scrollItem.scrollId);
        if (reward <= 0) {
            this._showMessage('该卷轴无法转换', 'error');
            return;
        }

        // 销毁卷轴
        this._scrollItem = null;
        this._scrollSource = null;

        // 给予晶尘到背包
        this._addDust(reward);

        this._updateDustDisplay();
        this._showMessage(`转换获得 ${reward} 魔法晶尘`, 'success');
        this._updateUI();
    },
};

export { EnchantSystem };
