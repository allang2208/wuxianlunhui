/**
 * fusion-system.js — 祭品合成系统
 * 祭坛对话「祭品合成」打开。两个相同稀有度祭品熔铸为更高一级祭品；
 * 传说对销毁生成随机新传说。奇数个时按添加顺序留最后一个（批量放入按名称字母序）。
 */

import { UIState } from './ui-state.js';
import { SystemUI } from './system-ui.js';
import { EquipManager } from './equip-manager.js';
import { EquipTooltipManager } from './equip-tooltip-manager.js';
import { RARITY_LABELS, RARITY_ORDER } from '../config/rarity.js';
import { pickTributeByRarity } from '../config/tribute-effects.js';
import { SceneManager } from '../world/scene-manager.js';

export const FusionSystem = {
    _isOpen: false,
    _panelBuilt: false,
    _placed: [],          // { slot, item, seq }（slot 为格号）
    _seq: 0,
    CAPACITY: 20,

    open() {
        if (this._isOpen) return;
        UIState.open('fusion');
        this._isOpen = true;
        this._buildPanel();
        const panel = document.getElementById('fusionPanel');
        if (panel) panel.classList.add('active');
        // 同步打开装备背包便于放入（与其他栏位同模式）
        SystemUI.open('equip');
        this._refreshAll();
    },

    close() {
        if (!this._isOpen) return;
        this._returnAllToBackpack();
        this._isOpen = false;
        UIState.close('fusion');
        const panel = document.getElementById('fusionPanel');
        if (panel) panel.classList.remove('active');
    },

    toggle() {
        if (this._isOpen) this.close();
        else this.open();
    },

    /** tooltip 用：按格号取放置的祭品 */
    getItemAt(slot) {
        const entry = this._placed.find(p => p.slot === slot);
        return entry ? entry.item : null;
    },

    _freeSlot() {
        const used = new Set(this._placed.map(p => p.slot));
        for (let s = 0; s < this.CAPACITY; s++) {
            if (!used.has(s)) return s;
        }
        return -1;
    },

    // ==================== 放入/取出 ====================

    /** 背包 → 合成槽（双击/右键/拖放统一入口；堆叠祭品整组放入，直到堆空或格满） */
    placeFromBackpack(bpIdx) {
        const bp = EquipManager.backpackItems || [];
        const item = bp.find(i => i.slot === bpIdx);
        if (!item) return;
        if (item.category !== 'tribute') {
            this._showMessage('只能放入祭品', 'error');
            return;
        }
        // 整组堆叠放入：逐个取 1，直到堆空或合成栏满
        while ((item.stack || 1) > 0) {
            const slot = this._freeSlot();
            if (slot === -1) {
                this._showMessage('合成栏已满', 'error');
                break;
            }
            const clone = JSON.parse(JSON.stringify(item));
            clone.stack = 1;
            if ((item.stack || 1) > 1) {
                item.stack -= 1;
            } else {
                bp.splice(bp.indexOf(item), 1);
                item.stack = 0; // 终止循环，防止拆空后复制品
            }
            this._placed.push({ slot, item: clone, seq: this._seq++ });
        }
        this._refreshAll();
    },

    /** 合成槽 → 背包（双击/右键） */
    retrieveToBackpack(slot) {
        const idx = this._placed.findIndex(p => p.slot === slot);
        if (idx === -1) return;
        const emptySlot = EquipManager._findFirstEmptySlot();
        if (emptySlot === -1) {
            this._notifyFull('背包已满');
            return;
        }
        const entry = this._placed[idx];
        this._placed.splice(idx, 1);
        entry.item.slot = emptySlot;
        (EquipManager.backpackItems || []).push(entry.item);
        this._refreshAll();
    },

    /** 全部退回背包（退出/重置共用） */
    _returnAllToBackpack() {
        while (this._placed.length > 0) {
            const emptySlot = EquipManager._findFirstEmptySlot();
            if (emptySlot === -1) {
                this._notifyFull('背包已满');
                break;
            }
            const entry = this._placed.shift();
            entry.item.slot = emptySlot;
            (EquipManager.backpackItems || []).push(entry.item);
        }
        this._refreshAll();
    },

    /** 一键放入：按稀有度把背包中该稀有度祭品全部放入（按名称排序，决定奇数留存） */
    storeAllByRarity(rarity) {
        const bp = EquipManager.backpackItems || [];
        const matched = bp.filter(i => i && i.category === 'tribute' && (i.rarity || 'common') === rarity);
        if (matched.length === 0) {
            this._showMessage(`背包中没有${RARITY_LABELS[rarity] || rarity}祭品`, 'error');
            return;
        }
        // 按名称排序放入：保证奇数留存为字母序最后一个
        matched.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
        for (const item of matched) {
            if (this._freeSlot() === -1) {
                this._showMessage('合成栏已满', 'error');
                break;
            }
            this.placeFromBackpack(item.slot);
        }
    },

    // ==================== 合成 ====================

    fuse() {
        const placed = [...this._placed];
        if (placed.length < 2) {
            this._showMessage('至少放入 2 个祭品', 'error');
            return;
        }
        const rarities = new Set(placed.map(p => p.item.rarity || 'common'));
        if (rarities.size > 1) {
            this._showMessage('请放入相同稀有度的祭品', 'error');
            return;
        }
        const rarity = placed[0].item.rarity || 'common';
        // 按添加顺序排列（批量放入已按名称序编入 seq）
        placed.sort((a, b) => a.seq - b.seq);
        const results = [];
        for (let i = 0; i + 1 < placed.length; i += 2) {
            const next = this._fusePair(rarity);
            if (next) results.push(next);
        }
        // 奇数：留下最后添加的一个
        const remainder = placed.length % 2 === 1 ? [placed[placed.length - 1].item] : [];
        this._placed = [];
        for (const it of [...results, ...remainder]) {
            const slot = this._freeSlot();
            if (slot === -1) break;
            it.slot = slot;
            this._placed.push({ slot, item: it, seq: this._seq++ });
        }
        this._refreshAll();
        if (results.length > 0) {
            this._showMessage(`合成成功：${results.map(r => r.name).join('、')}`, 'success');
        }
    },

    /** 熔铸一对：同级 → 随机高一级；传说对 → 随机新传说 */
    _fusePair(rarity) {
        const idx = RARITY_ORDER.indexOf(rarity);
        if (idx === -1) return null;
        if (idx === RARITY_ORDER.length - 1) {
            return pickTributeByRarity('legendary');
        }
        return pickTributeByRarity(RARITY_ORDER[idx + 1]);
    },

    // ==================== 面板 ====================

    _buildPanel() {
        if (this._panelBuilt) return;
        this._panelBuilt = true;
        const panel = document.createElement('div');
        panel.id = 'fusionPanel';
        panel.className = 'fusion-panel';
        panel.innerHTML = `
            <div class="fusion-header">
                <span class="fusion-title">🔮 祭品合成</span>
                <button class="fusion-close" id="fusionCloseBtn">✕</button>
            </div>
            <div class="fusion-grid" id="fusionGrid"></div>
            <div class="fusion-actions">
                <button class="fusion-action-btn primary" id="fusionDoBtn">🔮 合成</button>
                <button class="fusion-action-btn" id="fusionResetBtn">🔄 重置</button>
                <button class="fusion-action-btn" id="fusionStoreAllBtn">⬇ 一键放入</button>
                <button class="fusion-action-btn" id="fusionExitBtn">🚪 退出</button>
            </div>
            <div class="fusion-rarity-menu" id="fusionRarityMenu" style="display:none;"></div>
            <div class="fusion-message" id="fusionMessage"></div>
        `;
        document.body.appendChild(panel);
        document.getElementById('fusionCloseBtn').onclick = () => this.close();
        document.getElementById('fusionDoBtn').onclick = () => this.fuse();
        document.getElementById('fusionResetBtn').onclick = () => this._returnAllToBackpack();
        document.getElementById('fusionExitBtn').onclick = () => this.close();
        document.getElementById('fusionStoreAllBtn').onclick = () => this._toggleRarityMenu();
        // 拖放：从背包拖入祭品
        const grid = document.getElementById('fusionGrid');
        grid.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
        grid.ondrop = (e) => {
            e.preventDefault();
            const src = EquipManager._dragDropManager && EquipManager._dragDropManager._dragSrc;
            if (src && src.type === 'inventory') {
                EquipManager._dragDropManager._dropHandled = true;
                this.placeFromBackpack(parseInt(src.slot));
                EquipManager._dragDropManager._dragSrc = null;
            }
        };
        document.addEventListener('mousedown', (e) => {
            const menu = document.getElementById('fusionRarityMenu');
            if (menu && menu.style.display === 'block' && !menu.contains(e.target) && e.target.id !== 'fusionStoreAllBtn') {
                menu.style.display = 'none';
            }
        });
    },

    _toggleRarityMenu() {
        const menu = document.getElementById('fusionRarityMenu');
        if (!menu) return;
        if (menu.style.display === 'block') {
            menu.style.display = 'none';
            return;
        }
        menu.innerHTML = '';
        for (const rarity of RARITY_ORDER) {
            const row = document.createElement('div');
            row.className = 'fusion-rarity-row';
            row.textContent = RARITY_LABELS[rarity] || rarity;
            row.onclick = () => {
                menu.style.display = 'none';
                this.storeAllByRarity(rarity);
            };
            menu.appendChild(row);
        }
        menu.style.display = 'block';
    },

    _refreshAll() {
        this._renderGrid();
        if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();
    },

    _renderGrid() {
        const grid = document.getElementById('fusionGrid');
        if (!grid) return;
        grid.innerHTML = '';
        for (let s = 0; s < this.CAPACITY; s++) {
            const item = this.getItemAt(s);
            const cell = document.createElement('div');
            cell.className = 'inv-cell fs-cell' + (item ? ' occupied' : '');
            cell.dataset.slot = s;
            if (item) {
                const imgSrc = item.slotImage || item.iconImage;
                const rarityKey = item.rarity || 'common';
                const rarityLabel = RARITY_LABELS[rarityKey] || rarityKey;
                if (imgSrc) {
                    cell.innerHTML = `<div class="inv-rarity rarity-${rarityKey}">${rarityLabel}</div><img src="${imgSrc}" draggable="false" ondragstart="return false;" style="width:32px;height:32px;object-fit:cover;pointer-events:none;border-radius:4px;user-select:none;-webkit-user-drag:none;"><span class="inv-name" style="pointer-events:none;user-select:none;">${item.name}</span>`;
                } else {
                    cell.innerHTML = `<div class="inv-rarity rarity-${rarityKey}">${rarityLabel}</div><span style="pointer-events:none;user-select:none;">${item.icon || '❓'}</span><span class="inv-name" style="pointer-events:none;user-select:none;">${item.name}</span>`;
                }
                const takeOut = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.retrieveToBackpack(s);
                };
                cell.ondblclick = takeOut;
                cell.oncontextmenu = takeOut;
            }
            grid.appendChild(cell);
        }
        if (EquipTooltipManager && EquipTooltipManager.bindInventoryTooltip) {
            EquipTooltipManager.bindInventoryTooltip();
        }
    },

    _showMessage(text, type = 'normal') {
        const msg = document.getElementById('fusionMessage');
        if (!msg) return;
        msg.textContent = text;
        msg.className = 'fusion-message ' + (type === 'error' ? 'error' : type === 'success' ? 'success' : '');
        setTimeout(() => { msg.textContent = ''; msg.className = 'fusion-message'; }, 3000);
    },

    /** 满仓提示：与场景提示语同款 */
    _notifyFull(text) {
        if (SceneManager && SceneManager.showTopNotification) {
            SceneManager.showTopNotification(text);
        }
        this._showMessage(text, 'error');
    },
};
