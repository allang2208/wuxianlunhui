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
import { RARITY_LABELS } from '../config/rarity.js';

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

    /** 放入一件物品（返回是否成功） */
    addItem(item) {
        const slot = this._findFirstEmptySlot();
        if (slot === -1) return false;
        item.slot = slot;
        this.items.push(item);
        return true;
    },

    /** 背包 → 仓库 */
    storeFromBackpack(bpIdx) {
        const bp = EquipManager.backpackItems || [];
        const idx = bp.findIndex(i => i.slot === bpIdx);
        if (idx === -1) return;
        const item = bp[idx];
        if (this._findFirstEmptySlot() === -1) {
            this._showHint('仓库已满！');
            return;
        }
        bp.splice(idx, 1);
        this.addItem(item);
        this._refreshAll();
    },

    /** 仓库 → 背包 */
    retrieveToBackpack(wSlot) {
        const idx = this.items.findIndex(i => i.slot === wSlot);
        if (idx === -1) return;
        const emptySlot = EquipManager._findFirstEmptySlot();
        if (emptySlot === -1) {
            this._showHint('背包已满！');
            return;
        }
        const item = this.items[idx];
        this.items.splice(idx, 1);
        item.slot = emptySlot;
        (EquipManager.backpackItems || []).push(item);
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
};
