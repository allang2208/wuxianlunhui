/**
 * warehouse-system.js — 仓库系统
 * 主神空间小鼠大王旁的仓库 NPC 打开；物品跨页存放（PAGE_SIZE/页，pageCount 页）。
 * - 鼠标规则与背包一致：双击/右键 放入（背包→仓库）、取出（仓库→背包）
 * - 全局材料调用：强化石/改造券/魔法粉尘 可由强化/改造/附魔栏跨背包+仓库消耗
 */

import { Game } from '../game.js';
import { UIState } from './ui-state.js';
import { SystemUI } from './system-ui.js';
import { EquipManager } from './equip-manager.js';
import { EquipTooltipManager } from './equip-tooltip-manager.js';
import { RARITY_LABELS, RARITY_ORDER } from '../config/rarity.js';
import { SceneManager } from '../world/scene-manager.js';

export const WarehouseSystem = {
    items: [],            // 扁平数组，元素 { slot, ...item }（slot 跨页连续编号）
    pageCount: 2,         // 页数
    PAGE_SIZE: 20,        // 每页格子数
    currentPage: 0,
    _isOpen: false,
    _panelBuilt: false,

    // ==================== 基础存取 ====================

    /** 仓库总容量 */
    get capacity() { return this.pageCount * this.PAGE_SIZE; },

    /** 第一个空位（跨页），-1 表示满 */
    _findFirstEmptySlot() {
        const used = new Set(this.items.map(i => i.slot));
        for (let s = 0; s < this.capacity; s++) {
            if (!used.has(s)) return s;
        }
        return -1;
    },

    /** 按槽位取物品（tooltip 等用） */
    getItemAt(slot) {
        return this.items.find(i => i.slot === slot) || null;
    },

    /** 有效最大堆叠数：金币物品本身不带 maxStack 字段（GoldManager 内部常量 99999），此处对齐回退 */
    _maxStackOf(item) {
        if (!item) return 1;
        if (item.maxStack) return item.maxStack;
        if (item.category === 'gold' || item.name === '金币') return 99999;
        return 1;
    },

    /** 是否可堆叠 */
    _isStackable(item) {
        return this._maxStackOf(item) > 1;
    },

    /** 物品在目标数组中还能堆叠多少（同名可堆叠堆的空余 + 空格数×最大堆叠） */
    _stackSpaceIn(targetItems, item, freeSlots) {
        if (!this._isStackable(item)) {
            // 不可堆叠物品整件占 1 格：有空格即可整件放入（与其 stack 数无关）
            return freeSlots > 0 ? (item.stack || 1) : 0;
        }
        const maxStack = this._maxStackOf(item);
        let space = 0;
        for (const t of targetItems) {
            if (t && t.name === item.name) space += Math.max(0, maxStack - (t.stack || 1));
        }
        return space + freeSlots * maxStack;
    },

    /** 把物品堆叠/落格进仓库（先填同名堆，超出最大堆叠再占新格），返回是否全部放入 */
    _applyIntoWarehouse(item) {
        let remaining = item.stack || 1;
        // 先填同名堆
        if (this._isStackable(item)) {
            const maxStack = this._maxStackOf(item);
            for (const t of this.items) {
                if (remaining <= 0) break;
                if (t && t.name === item.name && (t.stack || 1) < maxStack) {
                    const add = Math.min(maxStack - (t.stack || 1), remaining);
                    t.stack = (t.stack || 1) + add;
                    remaining -= add;
                }
            }
        }
        // 剩余部分占用新格
        while (remaining > 0) {
            const slot = this._findFirstEmptySlot();
            if (slot === -1) break;
            const maxStack = this._maxStackOf(item);
            const add = this._isStackable(item) ? Math.min(maxStack, remaining) : remaining;
            const clone = JSON.parse(JSON.stringify(item));
            // weaponAsset 等可能含不可序列化字段（与附魔同口径防御性保留）
            if (item.weaponAsset) clone.weaponAsset = item.weaponAsset;
            clone.stack = add;
            clone.slot = slot;
            this.items.push(clone);
            remaining -= add;
        }
        return remaining <= 0;
    },

    /** 放入一件物品（返回是否成功） */
    addItem(item) {
        return this._applyIntoWarehouse(item);
    },

    /** 背包 → 仓库（同品堆叠；仓库放不下整件则不动并提示） */
    storeFromBackpack(bpIdx) {
        const bp = EquipManager.backpackItems || [];
        const idx = bp.findIndex(i => i.slot === bpIdx);
        if (idx === -1) return;
        const item = bp[idx];
        const freeSlots = this.capacity - this.items.length;
        if (this._stackSpaceIn(this.items, item, freeSlots) < (item.stack || 1)) {
            this._notifyFull('仓库已满');
            return;
        }
        bp.splice(idx, 1);
        this._applyIntoWarehouse(item);
        this._refreshAll();
    },

    /** 一键全部存入：逐个堆叠，遇到仓库满即停并提示 */
    storeAllFromBackpack() {
        const bp = EquipManager.backpackItems || [];
        if (bp.length === 0) return;
        if (this.items.length >= this.capacity) {
            this._notifyFull('仓库已满');
            return;
        }
        for (let i = bp.length - 1; i >= 0; i--) {
            const item = bp[i];
            const freeSlots = this.capacity - this.items.length;
            if (this._stackSpaceIn(this.items, item, freeSlots) < (item.stack || 1)) {
                this._notifyFull('仓库已满');
                break;
            }
            bp.splice(i, 1);
            this._applyIntoWarehouse(item);
        }
        this._refreshAll();
    },

    /** 一键取出同类：仓库中与背包同名的物品取回背包堆叠，背包满即停并提示 */
    retrieveMatching() {
        const bp = EquipManager.backpackItems || [];
        if (bp.length === 0 || this.items.length === 0) return;
        const bpNames = new Set(bp.map(i => i && i.name));
        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i];
            if (!item || !bpNames.has(item.name)) continue;
            const bpFreeSlots = EquipManager.maxBackpackSlots - bp.length;
            if (this._stackSpaceIn(bp, item, bpFreeSlots) < (item.stack || 1)) {
                this._notifyFull('背包已满');
                break;
            }
            this.items.splice(i, 1);
            this._applyIntoBackpack(item);
        }
        this._refreshAll();
    },

    /** 把物品堆叠/落格进背包（先填同名堆，超出占新格） */
    _applyIntoBackpack(item) {
        const bp = EquipManager.backpackItems;
        let remaining = item.stack || 1;
        if (this._isStackable(item)) {
            const maxStack = this._maxStackOf(item);
            for (const t of bp) {
                if (remaining <= 0) break;
                if (t && t.name === item.name && (t.stack || 1) < maxStack) {
                    const add = Math.min(maxStack - (t.stack || 1), remaining);
                    t.stack = (t.stack || 1) + add;
                    remaining -= add;
                }
            }
        }
        while (remaining > 0) {
            const slot = EquipManager._findFirstEmptySlot();
            if (slot === -1) break;
            const maxStack = this._maxStackOf(item);
            const add = this._isStackable(item) ? Math.min(maxStack, remaining) : remaining;
            const clone = JSON.parse(JSON.stringify(item));
            if (item.weaponAsset) clone.weaponAsset = item.weaponAsset;
            clone.stack = add;
            clone.slot = slot;
            bp.push(clone);
            remaining -= add;
        }
        return remaining <= 0;
    },

    /** 仓库 → 背包（同品堆叠；背包放不下整件则不动并提示） */
    retrieveToBackpack(wSlot) {
        const idx = this.items.findIndex(i => i.slot === wSlot);
        if (idx === -1) return;
        const item = this.items[idx];
        const bp = EquipManager.backpackItems || [];
        const bpFreeSlots = EquipManager.maxBackpackSlots - bp.length;
        if (this._stackSpaceIn(bp, item, bpFreeSlots) < (item.stack || 1)) {
            this._notifyFull('背包已满');
            return;
        }
        this.items.splice(idx, 1);
        this._applyIntoBackpack(item);
        this._refreshAll();
    },

    // ==================== 全局材料调用 ====================

    /** 仓库中匹配材料的总堆叠数 */
    countMaterial(pred) {
        let total = 0;
        for (const item of this.items) {
            if (item && pred(item)) total += item.stack || 1;
        }
        return total;
    },

    /** 从仓库扣除匹配材料（先扣后到的堆），返回实际扣除数 */
    consumeMaterial(pred, amount) {
        let remaining = amount;
        for (let i = this.items.length - 1; i >= 0 && remaining > 0; i--) {
            const item = this.items[i];
            if (!item || !pred(item)) continue;
            const stack = item.stack || 1;
            if (stack <= remaining) {
                remaining -= stack;
                this.items.splice(i, 1);
            } else {
                item.stack = stack - remaining;
                remaining = 0;
            }
        }
        const used = amount - remaining;
        if (used > 0) this._refreshAll();
        return used;
    },

    // ==================== 面板 ====================

    open() {
        if (this._isOpen) return;
        UIState.open('warehouse');
        this._isOpen = true;
        this._buildPanel();
        const panel = document.getElementById('warehousePanel');
        if (panel) panel.classList.add('active');
        // 同步打开装备/背包面板，方便双向搬运（与附魔/改造栏同模式）
        SystemUI.open('equip');
        this._refreshAll();
    },

    close() {
        if (!this._isOpen) return;
        this._isOpen = false;
        UIState.close('warehouse');
        const panel = document.getElementById('warehousePanel');
        if (panel) panel.classList.remove('active');
    },

    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    },

    _buildPanel() {
        if (this._panelBuilt) return;
        this._panelBuilt = true;
        const panel = document.createElement('div');
        panel.id = 'warehousePanel';
        panel.className = 'warehouse-panel';
        panel.innerHTML = `
            <div class="warehouse-header">
                <span class="warehouse-title">📦 仓库</span>
                <span class="warehouse-page-info" id="warehousePageInfo"></span>
                <button class="warehouse-close" id="warehouseCloseBtn">✕</button>
            </div>
            <div class="warehouse-grid" id="warehouseGrid"></div>
            <div class="warehouse-actions">
                <button class="warehouse-action-btn" id="warehouseStoreAllBtn">⬇ 全部存入</button>
                <button class="warehouse-action-btn" id="warehouseRetrieveBtn">⬆ 取出同类</button>
                <button class="warehouse-action-btn" id="warehouseSortBtn">📦 整理仓库</button>
            </div>
            <div class="warehouse-sort-menu" id="warehouseSortMenu" style="display:none;"></div>
            <div class="warehouse-footer">
                <button class="warehouse-page-btn" id="warehousePrevPage">◀ 上一页</button>
                <span class="warehouse-page-num" id="warehousePageNum"></span>
                <button class="warehouse-page-btn" id="warehouseNextPage">下一页 ▶</button>
            </div>
            <div class="warehouse-hint" id="warehouseHint"></div>
        `;
        document.body.appendChild(panel);
        document.getElementById('warehouseCloseBtn').onclick = () => this.close();
        document.getElementById('warehousePrevPage').onclick = () => this._switchPage(-1);
        document.getElementById('warehouseNextPage').onclick = () => this._switchPage(1);
        document.getElementById('warehouseStoreAllBtn').onclick = () => this.storeAllFromBackpack();
        document.getElementById('warehouseRetrieveBtn').onclick = () => this.retrieveMatching();
        document.getElementById('warehouseSortBtn').onclick = () => this._toggleSortMenu();
        // 点击面板外关闭排序菜单
        document.addEventListener('mousedown', (e) => {
            const menu = document.getElementById('warehouseSortMenu');
            if (menu && menu.style.display === 'block' && !menu.contains(e.target) && e.target.id !== 'warehouseSortBtn') {
                menu.style.display = 'none';
            }
        });
        // 点击遮罩层（面板外部）时与背包一并关闭仓库。
        // 注：不反向 import SystemUI（避免 system-ui <-> warehouse 循环），直接挂 overlay 监听
        const overlay = document.getElementById('panelOverlay');
        if (overlay) {
            overlay.addEventListener('click', () => { if (this._isOpen) this.close(); });
        }
    },

    _switchPage(delta) {
        const next = this.currentPage + delta;
        if (next < 0 || next >= this.pageCount) return;
        this.currentPage = next;
        this._renderGrid();
    },

    /** 全量刷新：格子 + 背包 + tooltip + 页码 */
    _refreshAll() {
        this._renderGrid();
        if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();
        this._renderPageInfo();
    },

    _renderPageInfo() {
        const info = document.getElementById('warehousePageInfo');
        if (info) info.textContent = `${this.items.length}/${this.capacity}`;
        const num = document.getElementById('warehousePageNum');
        if (num) num.textContent = `第 ${this.currentPage + 1} / ${this.pageCount} 页`;
    },

    _renderGrid() {
        const grid = document.getElementById('warehouseGrid');
        if (!grid) return;
        this._renderPageInfo();
        grid.innerHTML = '';
        const start = this.currentPage * this.PAGE_SIZE;
        for (let i = 0; i < this.PAGE_SIZE; i++) {
            const slot = start + i;
            const item = this.getItemAt(slot);
            const cell = document.createElement('div');
            cell.className = 'inv-cell wh-cell' + (item ? ' occupied' : '');
            cell.dataset.slot = slot;
            cell.dataset.itemName = item ? item.name : '';
            if (item) {
                const imgSrc = item.slotImage || item.iconImage;
                const rarityKey = item.rarity || 'common';
                const rarityLabel = RARITY_LABELS[rarityKey] || rarityKey;
                if (imgSrc) {
                    cell.innerHTML = `<div class="inv-rarity rarity-${rarityKey}">${rarityLabel}</div><img src="${imgSrc}" draggable="false" ondragstart="return false;" style="width:32px;height:32px;object-fit:cover;pointer-events:none;border-radius:4px;user-select:none;-webkit-user-drag:none;"><span class="inv-name" style="pointer-events:none;user-select:none;">${item.name}</span>${item.stack > 1 ? `<span class="inv-stack" style="pointer-events:none;user-select:none;">${item.stack}</span>` : ''}`;
                } else {
                    cell.innerHTML = `<div class="inv-rarity rarity-${rarityKey}">${rarityLabel}</div><span style="pointer-events:none;user-select:none;">${item.icon || '❓'}</span><span class="inv-name" style="pointer-events:none;user-select:none;">${item.name}</span>${item.stack > 1 ? `<span class="inv-stack" style="pointer-events:none;user-select:none;">${item.stack}</span>` : ''}`;
                }
                // 双击/右键取出（与背包鼠标规则一致）
                const takeOut = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.retrieveToBackpack(slot);
                };
                cell.ondblclick = takeOut;
                cell.oncontextmenu = takeOut;
            }
            grid.appendChild(cell);
        }
        // 刷新 tooltip（bindInventoryTooltip 对 wh-cell 走 WarehouseSystem.getItemAt）
        if (EquipTooltipManager && EquipTooltipManager.bindInventoryTooltip) {
            EquipTooltipManager.bindInventoryTooltip();
        }
    },

    _showHint(text) {
        const hint = document.getElementById('warehouseHint');
        if (!hint) return;
        hint.textContent = text;
        setTimeout(() => { hint.textContent = ''; }, 2000);
    },

    /** 满仓提示：与进入场景提示语同格式/样式/颜色 */
    _notifyFull(text) {
        if (SceneManager && SceneManager.showTopNotification) {
            SceneManager.showTopNotification(text);
        }
        this._showHint(text);
    },

    // ==================== 整理排序 ====================

    /** 物品种类排序键（数值越小越靠前） */
    _categoryKey(item) {
        if (!item) return 99;
        if (item.category === 'weapon_melee') return 0;
        if (item.category === 'weapon_ranged') return 1;
        if (item.weaponType === 'shield') return 2;
        if (item.equipSlot && item.equipSlot !== '' && item.equipSlot !== 'weapon') return 3;
        if (item.category === 'consumable') return 4;
        if (item.category === 'enhancement') return 5;
        if (item.category === 'material') return 6;
        if (item.category === 'tribute') return 7;
        if (item.category === 'gold') return 8;
        return 9;
    },

    _rarityRank(item) {
        const idx = RARITY_ORDER.indexOf(item && item.rarity || 'common');
        return idx === -1 ? 0 : idx;
    },

    /** 排序：rarity=稀有度>种类>名称；price=价值>稀有度>名称；category=选中类别优先 */
    _sortWarehouse(mode, category = null) {
        const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'zh');
        const byRarityDesc = (a, b) => this._rarityRank(b) - this._rarityRank(a);
        if (mode === 'rarity') {
            this.items.sort((a, b) => byRarityDesc(a, b) || (this._categoryKey(a) - this._categoryKey(b)) || byName(a, b));
        } else if (mode === 'price') {
            this.items.sort((a, b) => ((b.price || 0) - (a.price || 0)) || byRarityDesc(a, b) || byName(a, b));
        } else if (mode === 'category' && category !== null) {
            this.items.sort((a, b) => {
                const aIn = this._categoryKey(a) === category ? 0 : 1;
                const bIn = this._categoryKey(b) === category ? 0 : 1;
                if (aIn !== bIn) return aIn - bIn;
                if (aIn === 0) return byRarityDesc(a, b) || byName(a, b);
                return (this._categoryKey(a) - this._categoryKey(b)) || byRarityDesc(a, b) || byName(a, b);
            });
        }
        // 重新编号压缩槽位
        this.items.forEach((item, i) => { item.slot = i; });
        this._refreshAll();
    },

    /** 当前仓库中出现的类别（按默认顺序） */
    _presentCategories() {
        const set = new Set(this.items.map(i => this._categoryKey(i)));
        return Array.from(set).sort((a, b) => a - b);
    },

    _toggleSortMenu() {
        const menu = document.getElementById('warehouseSortMenu');
        if (!menu) return;
        if (menu.style.display === 'block') {
            menu.style.display = 'none';
            return;
        }
        // 构建主菜单
        menu.innerHTML = '';
        const opts = [
            { label: '按稀有度排列', action: () => { this._sortWarehouse('rarity'); this._toggleSortMenu(); } },
            { label: '按物品价值排列', action: () => { this._sortWarehouse('price'); this._toggleSortMenu(); } },
            { label: '按物品种类排列 ▸', action: () => this._showCategorySubMenu() },
        ];
        for (const opt of opts) {
            const row = document.createElement('div');
            row.className = 'warehouse-sort-row';
            row.textContent = opt.label;
            row.onclick = opt.action;
            menu.appendChild(row);
        }
        menu.style.display = 'block';
    },

    _showCategorySubMenu() {
        const menu = document.getElementById('warehouseSortMenu');
        if (!menu) return;
        menu.innerHTML = '';
        const back = document.createElement('div');
        back.className = 'warehouse-sort-row back';
        back.textContent = '◂ 返回';
        back.onclick = () => this._toggleSortMenu();
        menu.appendChild(back);
        const NAMES = ['近战武器', '远程武器', '盾', '防具饰品', '消耗品', '强化材料', '材料', '祭品', '货币', '其他'];
        for (const cat of this._presentCategories()) {
            const row = document.createElement('div');
            row.className = 'warehouse-sort-row';
            row.textContent = NAMES[cat] || `类别${cat}`;
            row.onclick = () => { this._sortWarehouse('category', cat); this._toggleSortMenu(); };
            menu.appendChild(row);
        }
    },
};
