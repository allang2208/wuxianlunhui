/**
 * warehouse-system.js — 仓库系统
 * 主神空间小鼠大王旁的仓库 NPC 打开；物品跨页存放（PAGE_SIZE/页，pageCount 页）。
 * - 鼠标规则与背包一致：双击/右键 放入（背包→仓库）、取出（仓库→背包）
 * - 全局材料调用：强化石/改造券/魔法粉尘 可由强化/改造/附魔栏跨背包+仓库消耗
 */

import { SystemUI } from './system-ui.js';
import { EquipManager } from './equip-manager.js';
import { EquipTooltipManager } from './equip-tooltip-manager.js';
import { RARITY_LABELS, RARITY_ORDER } from '../config/rarity.js';
import { SceneManager } from '../world/scene-manager.js';
import { ItemDatabase } from '../items/item-database.js';
import { EventBus } from '../core/event-bus.js';
import { BasePanel } from './panels/base-panel.js';

export const WarehouseSystem = {
    items: [],            // 扁平数组，元素 { slot, ...item }（slot 跨页连续编号）
    pageCount: 5,         // 页数
    PAGE_SIZE: 20,        // 每页格子数
    currentPage: 0,
    _panel: null,         // BasePanel 实例（_getPanel 懒创建）

    // ==================== 基础存取 ====================

    /** 仓库总容量 */
    get capacity() { return this.pageCount * this.PAGE_SIZE; },

    /** 测试种子：矿石类+植物类祭品每样一件（开发调试用；数据全部来自 ItemDatabase） */
    seedOreTributes() {
        const ORE_KEYS = [
            'coalOre', 'limestone', 'quartz', 'ironOre', 'copperOre',
            'sulfurOre', 'aluminumOre', 'tinOre', 'leadOre', 'silverOre',
            'goldOre', 'tungstenOre', 'obsidian', 'magnetite', 'titaniumOre',
            'mithrilOre', 'starSapphire', 'diamond', 'moonstone', 'philosopherStone',
            'marble',
        ];
        const PLANT_KEYS = [
            'potato', 'corn', 'carrot', 'cabbage', 'pumpkin',
            'tomato', 'cucumber', 'onion', 'garlic', 'apple',
            'strawberry', 'grape', 'watermelon', 'chili', 'matsutake',
            'blueberry', 'dragonFruit', 'snowLotus', 'ginseng', 'flatPeach',
        ];
        for (const key of [...ORE_KEYS, ...PLANT_KEYS]) {
            const tpl = ItemDatabase.get(key);
            if (tpl) this.addItem({ ...tpl, stack: 1 });
        }
    },

    /** 第一个空位（优先当前页，再全局），-1 表示满 */
    _findFirstEmptySlot(preferPage = null) {
        const used = new Set(this.items.map(i => i.slot));
        // 优先当前页内的空位（存入的物品立即可见，避免"要翻页才找到"）
        if (preferPage !== null) {
            const start = preferPage * this.PAGE_SIZE;
            const end = Math.min(start + this.PAGE_SIZE, this.capacity);
            for (let s = start; s < end; s++) {
                if (!used.has(s)) return s;
            }
        }
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
        // 剩余部分占用新格（优先当前页，保证用户所见即所得）
        while (remaining > 0) {
            const slot = this._findFirstEmptySlot(this.currentPage);
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

    // ==================== 面板（BasePanel 统一生命周期） ====================

    get _isOpen() { return this._getPanel().isOpen; },

    _getPanel() {
        if (!this._panel) {
            this._panel = new BasePanel({ id: 'warehousePanel', className: 'warehouse-panel', stateKey: 'warehouse' });
            this._panel.buildContent = (el) => this._buildPanelContent(el);
            this._panel.onOpen = () => {
                this.currentPage = 0; // 默认打开第一页
                // 同步打开装备/背包面板，方便双向搬运（与附魔/改造栏同模式）
                SystemUI.open('equip');
                this._refreshAll();
            };
        }
        return this._panel;
    },

    open() { this._getPanel().open(); },
    close() { this._getPanel().close(); },
    toggle() { this._getPanel().toggle(); },

    _buildPanelContent(panel) {
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
        // 仓库格子 → 背包 的桥接事件（drag-drop-manager 发出，避免循环 import）
        EventBus.on('warehouse:retrieveToBackpack', ({ wSlot, bpSlot }) => {
            if (!Number.isNaN(wSlot)) this.retrieveToBackpackAt(wSlot, bpSlot);
        });
        // 拖到仓库面板非格子区域：标记已处理（不触发丢弃，物品原位保留）
        panel.ondragover = (e) => { e.preventDefault(); };
        panel.ondrop = (e) => {
            e.preventDefault();
            const mgr = EquipManager._dragDropManager;
            if (mgr) mgr._dropHandled = true;
        };
        // 注意：BasePanel._ensureBuilt 在 appendChild 之前调用 buildContent，
        // 此时元素尚未进入 document，必须用 panel.querySelector 而非 document.getElementById
        panel.querySelector('#warehouseCloseBtn').onclick = () => this.close();
        panel.querySelector('#warehousePrevPage').onclick = () => this._switchPage(-1);
        panel.querySelector('#warehouseNextPage').onclick = () => this._switchPage(1);
        panel.querySelector('#warehouseStoreAllBtn').onclick = () => this.storeAllFromBackpack();
        panel.querySelector('#warehouseRetrieveBtn').onclick = () => this.retrieveMatching();
        panel.querySelector('#warehouseSortBtn').onclick = () => this._toggleSortMenu();
        // 点击面板外关闭排序菜单
        document.addEventListener('mousedown', (e) => {
            const menu = document.getElementById('warehouseSortMenu');
            if (menu && menu.style.display === 'block' && !menu.contains(e.target) && e.target.id !== 'warehouseSortBtn') {
                menu.style.display = 'none';
            }
        });
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
        // 重建格子会丢失滚动位置（innerHTML 重置），保存并恢复——避免"调整物品后页面跳走"的观感
        const keepScroll = grid.scrollTop;
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
                // 拖拽取出：拖到背包格子=取出，拖到非法区域=原位保留（不丢弃）
                cell.draggable = true;
                cell.ondragstart = (e) => {
                    const mgr = EquipManager._dragDropManager;
                    if (mgr) { mgr._dragSrc = { type: 'warehouse', slot: String(slot) }; mgr._dropHandled = false; }
                    e.dataTransfer.setData('text/plain', String(slot));
                    e.dataTransfer.effectAllowed = 'move';
                    cell.classList.add('dragging');
                };
                cell.ondragend = () => {
                    cell.classList.remove('dragging');
                    const mgr = EquipManager._dragDropManager;
                    // 未成功放置：warehouse 源不做丢弃（物品原位保留），仅清理拖拽状态
                    if (mgr && mgr._dragSrc && mgr._dragSrc.type === 'warehouse') {
                        mgr._dragSrc = null;
                        mgr._dropHandled = false;
                    }
                };
            }
            // 格子接收拖放：背包源=存入当前页；仓库源=交换槽位
            cell.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
            cell.ondrop = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const mgr = EquipManager._dragDropManager;
                const src = mgr && mgr._dragSrc;
                if (!src) return;
                if (src.type === 'inventory') {
                    this.storeFromBackpackAt(parseInt(src.slot, 10), slot);
                } else if (src.type === 'warehouse') {
                    const from = parseInt(src.slot, 10);
                    if (!Number.isNaN(from) && from !== slot) this._swapSlots(from, slot);
                }
                mgr._dropHandled = true;
                mgr._dragSrc = null;
            };
            grid.appendChild(cell);
        }
        grid.scrollTop = keepScroll; // 恢复滚动位置
        // 刷新 tooltip（bindInventoryTooltip 对 wh-cell 走 WarehouseSystem.getItemAt）
        if (EquipTooltipManager && EquipTooltipManager.bindInventoryTooltip) {
            EquipTooltipManager.bindInventoryTooltip();
        }
    },

    /** 背包 → 仓库指定槽位（拖放）：
     * 目标格空→放入；同名可堆叠→合并（溢出按原规则落空位）；不同物品→交换（仓库原物回背包） */
    storeFromBackpackAt(bpIdx, wSlot) {
        const bp = EquipManager.backpackItems || [];
        const idx = bp.findIndex(i => i.slot === bpIdx);
        if (idx === -1) return;
        const item = bp[idx];
        const existing = this.getItemAt(wSlot);
        if (!existing) {
            // 目标格为空：直接放入指定槽
            bp.splice(idx, 1);
            const clone = JSON.parse(JSON.stringify(item));
            if (item.weaponAsset) clone.weaponAsset = item.weaponAsset;
            clone.slot = wSlot;
            this.items.push(clone);
            this._refreshAll();
            return;
        }
        if (this._isStackable(item) && existing.name === item.name) {
            // 同名可堆叠：合并进目标格，溢出部分按原规则堆叠/落空位
            const maxStack = this._maxStackOf(item);
            const add = Math.min(maxStack - (existing.stack || 1), item.stack || 1);
            if (add > 0) {
                existing.stack = (existing.stack || 1) + add;
                item.stack = (item.stack || 1) - add;
            }
            if ((item.stack || 0) <= 0) bp.splice(idx, 1);
            else {
                const freeSlots = this.capacity - this.items.length;
                if (this._stackSpaceIn(this.items, item, freeSlots) < item.stack) {
                    this._notifyFull('仓库已满');
                    existing.stack -= add; // 回滚部分合并
                    item.stack += add;
                    return;
                }
                bp.splice(idx, 1);
                this._applyIntoWarehouse(item);
            }
            this._refreshAll();
            return;
        }
        // 不同物品：交换（仓库原物回背包该格，背包物品进目标格）
        const bpFreeSlots = EquipManager.maxBackpackSlots - bp.length;
        if (this._stackSpaceIn(bp, existing, bpFreeSlots) < (existing.stack || 1)) {
            this._notifyFull('背包已满');
            return;
        }
        bp.splice(idx, 1);
        this.items.splice(this.items.indexOf(existing), 1);
        const clone = JSON.parse(JSON.stringify(item));
        if (item.weaponAsset) clone.weaponAsset = item.weaponAsset;
        clone.slot = wSlot;
        this.items.push(clone);
        this._applyIntoBackpack(existing);
        this._refreshAll();
    },

    /** 仓库 → 背包指定槽位（拖放）：目标格空→放入；同名可堆叠→合并；不同物品→交换 */
    retrieveToBackpackAt(wSlot, bpSlot) {
        const idx = this.items.findIndex(i => i.slot === wSlot);
        if (idx === -1) return;
        const item = this.items[idx];
        const bp = EquipManager.backpackItems || [];
        // 未指定目标格（双击/右键/桥接缺省）：走原堆叠/空位逻辑
        if (bpSlot === undefined || Number.isNaN(bpSlot)) {
            this.retrieveToBackpack(wSlot);
            return;
        }
        const existing = bp.find(i => i.slot === bpSlot);
        if (!existing) {
            this.items.splice(idx, 1);
            const clone = JSON.parse(JSON.stringify(item));
            if (item.weaponAsset) clone.weaponAsset = item.weaponAsset;
            clone.slot = bpSlot;
            bp.push(clone);
            this._refreshAll();
            return;
        }
        if (this._isStackable(item) && existing.name === item.name) {
            const maxStack = this._maxStackOf(item);
            const add = Math.min(maxStack - (existing.stack || 1), item.stack || 1);
            if (add > 0) {
                existing.stack = (existing.stack || 1) + add;
                item.stack = (item.stack || 1) - add;
            }
            if ((item.stack || 0) <= 0) this.items.splice(idx, 1);
            else {
                const bpFreeSlots = EquipManager.maxBackpackSlots - bp.length;
                if (this._stackSpaceIn(bp, item, bpFreeSlots) < item.stack) {
                    this._notifyFull('背包已满');
                    existing.stack -= add;
                    item.stack += add;
                    return;
                }
                this.items.splice(idx, 1);
                this._applyIntoBackpack(item);
            }
            this._refreshAll();
            return;
        }
        // 不同物品：交换（背包原物进仓库原格，仓库物品进目标格）
        const freeSlots = this.capacity - this.items.length;
        if (this._stackSpaceIn(this.items, existing, freeSlots) < (existing.stack || 1)) {
            this._notifyFull('仓库已满');
            return;
        }
        this.items.splice(idx, 1);
        bp.splice(bp.indexOf(existing), 1);
        const clone = JSON.parse(JSON.stringify(item));
        if (item.weaponAsset) clone.weaponAsset = item.weaponAsset;
        clone.slot = bpSlot;
        bp.push(clone);
        this._applyIntoWarehouse(existing);
        this._refreshAll();
    },

    /** 仓库内两个槽位交换（拖拽整理） */
    _swapSlots(slotA, slotB) {
        const a = this.items.find(i => i.slot === slotA);
        const b = this.items.find(i => i.slot === slotB);
        if (a) a.slot = slotB;
        if (b) b.slot = slotA;
        this._refreshAll();
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
        // 重新编号压缩槽位，回到第一页展示排序结果
        this.items.forEach((item, i) => { item.slot = i; });
        this.currentPage = 0;
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
