import { Game } from '../game.js';
import { SceneManager } from '../world/scene-manager.js';
/**
 * ExpeditionSystem — 出征准备系统
 * 全黑背景覆盖，背包式物资管理（10格），3个队友槽位，支持任意物品拖入
 * 从背包拖入 = 真正从背包移出；关闭/取消 = 归还到背包
 */

import { UIState } from './ui-state.js';
import { queryAllElements, getElement } from '../utils/dom-utils.js';
import { EquipManager } from './equip-manager.js';
import { BackpackDialogManager } from './backpack-dialog-manager.js';
import { SystemUI } from './system-ui.js';
import { DungeonMapSystem } from '../world/dungeon-map-system.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import { syncTributeBuffs } from '../config/tribute-effects.js';
import { RARITY_ORDER, RARITY_COLORS, RARITY_LABELS } from '../config/rarity.js';
import { GRADE_ORDER, RESTRICTED_EVENT_META } from '../world/dungeon-event-definitions.js';
import { COMBAT_FORMULAS } from '../config/combat-formulas.js';
import { DungeonEmpower } from '../config/dungeon-empower.js';
import { getExpLevelMultiplier, getGradeForDungeon } from '../config/exp-system.js';
import { BOSS_REWARD_CONFIG } from '../world/boss-reward-system.js';
import { EffectManager } from '../effects/effect-manager.js';
import { CONFIG } from '../config/config.js';

export const ExpeditionSystem = {
    _isOpen: false,
    _carriedItems: [], // 长度为 CAPACITY 的数组，每个元素 { item, count } 或 null
    CAPACITY: 10,     // 携带容量（预留接口，后续可扩容）

    // 打开出征准备面板
    open(player) {
        if (UIState.isOpen('expedition')) return;
        UIState.open('expedition');
        this._isOpen = true;
        this._carriedItems = new Array(this.CAPACITY).fill(null);
        // 祭品加持槽（与门槛祭品独立，出征时消耗；3 格，见 dungeon-empower）
        this._empowerItems = [null, null, null];
        this.selectedDungeon = 'zombie'; // 默认选中僵尸地牢（可选列表见 dungeon-config.json dungeonList）

        // 打开面板时刷新玩家属性，确保没有残留祭品加成
        if (player && typeof player.calculateCombatStats === 'function') {
            player.calculateCombatStats();
        }

        // 清空旧的祭品统计 UI（死亡后重新打开时，上次的 DOM 可能还在）
        this._updateTributeStats();
        this._updateCapacityDisplay();

        // 打开出征界面时自动打开背包（方便拖入祭品；system-ui overlay 点击已排除 expedition，不会被误关）
        if (SystemUI) {
            SystemUI.open('equip');
        }

        // 确保系统面板在覆盖层之上，但低于出征面板（DOM 顺序 + z-index）
        const sp = getElement('systemPanel');
        const eo = getElement('expeditionOverlay');
        if (sp && eo) {
            // 将系统面板移到覆盖层之后（DOM 顺序决定层级）
            if (sp.nextElementSibling !== eo && eo.parentElement === document.body) {
                document.body.insertBefore(sp, eo.nextElementSibling);
            }
            // 出征面板 z-index 为 4000，系统面板保持在其下方，确保鼠标层正确
            sp.style.zIndex = '100';
        }

        // 显示全黑背景覆盖层
        const overlay = getElement('expeditionOverlay');
        if (overlay) overlay.classList.add('active');

        // 显示出征准备面板
        const panel = getElement('expeditionPanel');
        if (panel) panel.classList.add('active');

        // 重置地牢选择器
        const select = getElement('expeditionDungeonSelect');
        if (select) select.value = 'zombie';
        this._updateDungeonInfo('zombie');

        // 出征条件说明弹窗（左侧）
        this._showRulePanel();

        // 生成背包格子
        this._renderInventoryGrid();
        // 生成祭品加持槽
        this._renderEmpowerGrid();

        // 更新UI
        this._updatePartyList(player);
        this._setupDragDrop();
        this._setupEmpowerHandlers();
        this._setupClickHandlers();
        this._updateCapacityDisplay();
        this._showMessage('请从背包拖入物品，点击已放入的格子可移除');

        // 出征界面隐藏任务追踪栏
        const questTracker = getElement('questTracker');
        if (questTracker) questTracker.style.display = 'none';
    },

    // 关闭出征准备面板 — 归还所有物品到背包
    close() {
        if (!UIState.isOpen('expedition')) return;
        UIState.close('expedition');
        this._isOpen = false;

        // 移除点击/右键事件监听
        this._removeClickHandlers();

        // 归还所有已放入出征栏的物品到背包
        this._returnAllItemsToBackpack();
        // 归还加持槽物品
        this._returnAllEmpowerItems();

        // 隐藏面板和覆盖层
        const panel = getElement('expeditionPanel');
        if (panel) panel.classList.remove('active');
        const overlay = getElement('expeditionOverlay');
        if (overlay) overlay.classList.remove('active');
        this._hideRulePanel();

        // 恢复任务追踪栏
        const questTracker = getElement('questTracker');
        if (questTracker) questTracker.style.display = 'block';
    },

    // 切换面板
    toggle(player) {
        if (UIState.isOpen('expedition')) this.close();
        else this.open(player);
    },

    // 渲染背包格子（10个空格子）
    _renderInventoryGrid() {
        const grid = getElement('expeditionInventoryGrid');
        if (!grid) return;
        grid.innerHTML = '';
        for (let i = 0; i < this.CAPACITY; i++) {
            const cell = document.createElement('div');
            cell.className = 'expedition-inv-cell';
            cell.dataset.slot = i;
            cell.draggable = false;
            grid.appendChild(cell);
        }
    },

    // ===== 祭品加持槽（与门槛祭品独立，出征时消耗；强度→怪物强化+奖励提升） =====

    // 渲染加持槽（3 格，样式复用 expedition-inv-cell + 独立类路由事件）
    _renderEmpowerGrid() {
        const grid = getElement('expeditionEmpowerGrid');
        if (!grid) return;
        grid.innerHTML = '';
        for (let i = 0; i < 3; i++) {
            const cell = document.createElement('div');
            cell.className = 'expedition-inv-cell expedition-empower-cell';
            cell.dataset.slot = i;
            cell.draggable = false;
            grid.appendChild(cell);
        }
    },

    // 加持槽拖放与点击移除
    _setupEmpowerHandlers() {
        const grid = getElement('expeditionEmpowerGrid');
        if (!grid) return;
        grid.querySelectorAll('.expedition-empower-cell').forEach(cell => {
            cell.ondragover = (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                cell.classList.add('drag-over');
            };
            cell.ondragleave = () => cell.classList.remove('drag-over');
            cell.ondrop = (e) => {
                e.preventDefault();
                e.stopPropagation();
                cell.classList.remove('drag-over');
                this._handleEmpowerDrop(cell);
            };
            cell.onclick = () => {
                if (cell.dataset.occupied) this._removeEmpowerItem(cell);
            };
        });
    },

    // 拖入加持槽：仅祭品（不限同名；堆叠按数量计强度）
    _handleEmpowerDrop(cell) {
        const dragSrc = EquipManager._dragDropManager && EquipManager._dragDropManager._dragSrc;
        if (!dragSrc || dragSrc.type !== 'inventory') return;
        EquipManager._dragDropManager._dropHandled = true;
        const bpSlot = parseInt(dragSrc.slot);
        const bp = EquipManager.backpackItems || [];
        const item = bp.find(i => i.slot === bpSlot);
        EquipManager._dragDropManager._dragSrc = null;
        if (!item) return;
        if (item.category !== 'tribute') {
            this._showMessage('加持槽只能放入祭品！', 'error');
            return;
        }
        const slotIdx = parseInt(cell.dataset.slot);
        // 已占用先归还
        if (this._empowerItems[slotIdx]) this._removeEmpowerItem(cell);
        // 从背包真正移出
        const idx = bp.indexOf(item);
        if (idx >= 0) bp.splice(idx, 1);
        this._empowerItems[slotIdx] = { item: JSON.parse(JSON.stringify(item)), count: item.stack || 1 };
        this._refreshEmpowerCell(cell);
        if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();
        this._showMessage(`${item.name} 已放入加持槽（强度 +${DungeonEmpower.rarityPoints(item.rarity) * (item.stack || 1)}）`);
        this._updateRulePanelEmpower();
    },

    // 点击移除加持槽物品并归还背包
    _removeEmpowerItem(cell) {
        const slotIdx = parseInt(cell.dataset.slot);
        const held = this._empowerItems[slotIdx];
        if (!held) return;
        const bp = EquipManager.backpackItems || [];
        const usedSlots = new Set(bp.map(i => i.slot));
        let bpSlot = 0;
        while (usedSlots.has(bpSlot) && bpSlot < EquipManager.maxBackpackSlots) bpSlot++;
        if (bpSlot >= EquipManager.maxBackpackSlots) {
            if (Game.player && Game.dropItem) Game.dropItem(Game.player.x, Game.player.y, held.item);
        } else {
            const clone = JSON.parse(JSON.stringify(held.item));
            clone.slot = bpSlot;
            bp.push(clone);
        }
        this._empowerItems[slotIdx] = null;
        delete cell.dataset.occupied;
        cell.classList.remove('occupied');
        cell.draggable = false;
        cell.style.borderColor = '';
        cell.innerHTML = '';
        if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();
        this._updateRulePanelEmpower();
    },

    // 加持槽格子视觉（与 _placeItemInCell 同风格）
    _refreshEmpowerCell(cell) {
        const slotIdx = parseInt(cell.dataset.slot);
        const held = this._empowerItems[slotIdx];
        if (!held) return;
        const item = held.item;
        cell.dataset.occupied = 'true';
        cell.classList.add('occupied');
        cell.draggable = false;
        const imgSrc = item.iconImage || item.slotImage;
        const rarityColors = { common: '#6a5a4a', uncommon: '#7a9a6a', rare: '#5a8aaa', epic: '#a05aaa', mythic: '#c07820', legendary: '#c03030' };
        cell.style.borderColor = rarityColors[item.rarity || 'common'] || '#6a5a4a';
        cell.innerHTML = `
            ${imgSrc ? `<img src="${imgSrc}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;">` : `<span style="font-size:20px;">${item.icon || '❓'}</span>`}
            <span class="inv-name" style="pointer-events:none;">${item.name}</span>
            ${held.count > 1 ? `<span class="inv-stack" style="pointer-events:none;">${held.count}</span>` : ''}
        `;
    },

    /** 当前加持强度（含上限钳制，供显示与 depart 注入） */
    _getEmpowerStrength() {
        const raw = DungeonEmpower.strengthFromItems(this._empowerItems);
        return Math.min(raw, COMBAT_FORMULAS.enemy?.empower?.capStrength ?? 12);
    },

    // 归还全部加持物品（close/reset 调用）
    _returnAllEmpowerItems() {
        const grid = getElement('expeditionEmpowerGrid');
        if (grid) {
            grid.querySelectorAll('.expedition-empower-cell').forEach(cell => {
                if (cell.dataset.occupied) this._removeEmpowerItem(cell);
            });
        }
        this._empowerItems = [null, null, null];
    },

    // 设置拖放事件
    _setupDragDrop() {
        const cells = queryAllElements('.expedition-inv-cell');
        cells.forEach(cell => {
            if (cell.classList.contains('expedition-empower-cell')) return; // 加持槽走 _setupEmpowerHandlers
            cell.ondragover = (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                cell.classList.add('drag-over');
            };
            cell.ondragleave = (_e) => {
                cell.classList.remove('drag-over');
            };
            cell.ondrop = (e) => {
                e.preventDefault();
                e.stopPropagation();
                cell.classList.remove('drag-over');
                this._handleDrop(cell);
            };

            // 点击已放入物品的格子：移除并归还到背包
            cell.onclick = () => {
                if (cell.dataset.occupied) {
                    this._removeItemFromCell(cell);
                }
            };
        });
    },

    // 设置双击/右键快捷操作（不破坏拖拽）
    _setupClickHandlers() {
        const backpackGrid = getElement('inventoryGrid');
        const expeditionGrid = getElement('expeditionInventoryGrid');

        this._backpackDblClick = (e) => {
            const cell = e.target.closest('.inv-cell');
            if (!cell) return;
            const slot = parseInt(cell.dataset.slot);
            const item = (EquipManager.backpackItems || []).find(i => i.slot === slot);
            if (!item || item.category !== 'tribute') return;
            e.preventDefault();
            e.stopPropagation();
            this._addTributeFromBackpack(item);
        };
        this._backpackContextMenu = (e) => {
            const cell = e.target.closest('.inv-cell');
            if (!cell) return;
            const slot = parseInt(cell.dataset.slot);
            const item = (EquipManager.backpackItems || []).find(i => i.slot === slot);
            if (!item || item.category !== 'tribute') return;
            e.preventDefault();
            e.stopPropagation();
            this._addTributeFromBackpack(item);
        };
        this._expeditionDblClick = (e) => {
            const cell = e.target.closest('.expedition-inv-cell');
            if (!cell || !cell.dataset.occupied || cell.classList.contains('expedition-empower-cell')) return;
            e.preventDefault();
            e.stopPropagation();
            this._removeItemFromCell(cell);
        };
        this._expeditionContextMenu = (e) => {
            const cell = e.target.closest('.expedition-inv-cell');
            if (!cell || !cell.dataset.occupied || cell.classList.contains('expedition-empower-cell')) return;
            e.preventDefault();
            e.stopPropagation();
            this._removeItemFromCell(cell);
        };

        if (backpackGrid) {
            backpackGrid.addEventListener('dblclick', this._backpackDblClick);
            backpackGrid.addEventListener('contextmenu', this._backpackContextMenu);
        }
        if (expeditionGrid) {
            expeditionGrid.addEventListener('dblclick', this._expeditionDblClick);
            expeditionGrid.addEventListener('contextmenu', this._expeditionContextMenu);
        }
    },

    _removeClickHandlers() {
        const backpackGrid = getElement('inventoryGrid');
        const expeditionGrid = getElement('expeditionInventoryGrid');
        if (backpackGrid) {
            if (this._backpackDblClick) backpackGrid.removeEventListener('dblclick', this._backpackDblClick);
            if (this._backpackContextMenu) backpackGrid.removeEventListener('contextmenu', this._backpackContextMenu);
        }
        if (expeditionGrid) {
            if (this._expeditionDblClick) expeditionGrid.removeEventListener('dblclick', this._expeditionDblClick);
            if (this._expeditionContextMenu) expeditionGrid.removeEventListener('contextmenu', this._expeditionContextMenu);
        }
        this._backpackDblClick = null;
        this._backpackContextMenu = null;
        this._expeditionDblClick = null;
        this._expeditionContextMenu = null;
    },

    // 从背包快捷添加一个祭品到第一个空格
    _addTributeFromBackpack(item) {
        const freeSlot = this._getFreeSlot();
        if (freeSlot === -1) {
            this._showMessage('携带空间已满！', 'error');
            return;
        }
        const expeditionGrid = getElement('expeditionInventoryGrid');
        if (!expeditionGrid) return;
        const cell = expeditionGrid.querySelector(`.expedition-inv-cell[data-slot="${freeSlot}"]`);
        if (!cell) return;
        this._placeItemInCell(cell, item);
    },

    // 是否已有同名祭品（出征栏不允许放入相同祭品）
    _hasDuplicateTribute(item) {
        return this._carriedItems.some(c => c && c.item && item && c.item.name === item.name);
    },

    // 处理拖放 — 从背包真正移出物品放入出征栏
    _handleDrop(cell) {
        const dragSrc = EquipManager._dragDropManager._dragSrc;
        if (!dragSrc) return;
        EquipManager._dragDropManager._dropHandled = true;

        if (dragSrc.type === 'inventory') {
            const bpSlot = parseInt(dragSrc.slot);
            const bp = EquipManager.backpackItems || [];
            const item = bp.find(i => i.slot === bpSlot);
            if (!item) return;

            // 祭品池限制：只能放入祭品（tribute）类别
            if (item.category !== 'tribute') {
                this._showMessage('祭品池只能放入祭品！', 'error');
                return;
            }

            // 同名限制：不可放入相同祭品
            if (this._hasDuplicateTribute(item)) {
                this._showMessage('不可放入相同祭品！', 'error');
                return;
            }

            // 检查是否还有空位
            const freeSlot = this._getFreeSlot();
            if (freeSlot === -1) {
                this._showMessage('携带空间已满！', 'error');
                return;
            }

            this._placeItemInCell(cell, item, bpSlot);
        }
        EquipManager._dragDropManager._dragSrc = null;
    },

    // 获取第一个空格子
    _getFreeSlot() {
        for (let i = 0; i < this.CAPACITY; i++) {
            if (!this._carriedItems[i]) return i;
        }
        return -1;
    },

    // 放置物品到格子 — 从背包中真正移除（类似 EnhanceSystem.equipFromBackpack）
    _placeItemInCell(cell, item, _backpackSlot) {
        const slotIdx = parseInt(cell.dataset.slot);

        // 同名限制：不可放入相同祭品（替换场景先判断，避免误归还）
        if (item && item.category === 'tribute' && this._hasDuplicateTribute(item)) {
            this._showMessage('不可放入相同祭品！', 'error');
            return;
        }

        // 如果格子已有物品，先移除并归还
        if (this._carriedItems[slotIdx]) {
            this._removeItemFromCell(cell);
        }

        // 从背包中移除（真正移出）
        const bp = EquipManager.backpackItems || [];
        const itemIdx = bp.indexOf(item);
        if (itemIdx >= 0) bp.splice(itemIdx, 1);

        // 确定数量：如果是堆叠物品，默认取全部
        const itemCount = item.stack || 1;

        // 记录携带物品（深拷贝，避免引用问题）
        this._carriedItems[slotIdx] = {
            item: JSON.parse(JSON.stringify(item)),
            count: itemCount
        };

        // 更新格子显示
        cell.dataset.occupied = 'true';
        cell.classList.add('occupied');
        cell.draggable = true;

        const imgSrc = item.iconImage || item.slotImage;
        const rarityKey = item.rarity || 'common';
        const rarityColors = { common: '#6a5a4a', uncommon: '#7a9a6a', rare: '#5a8aaa', epic: '#a05aaa' };
        const borderColor = rarityColors[rarityKey] || '#6a5a4a';
        cell.style.borderColor = borderColor;

        cell.innerHTML = `
            ${imgSrc ? `<img src="${imgSrc}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;">` : `<span style="font-size:20px;">${item.icon || '❓'}</span>`}
            <span class="inv-name" style="pointer-events:none;">${item.name}</span>
            ${itemCount > 1 ? `<span class="inv-stack" style="pointer-events:none;">${itemCount}</span>` : ''}
        `;

        // 刷新背包显示（物品已移出，背包要更新）
        if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();

        this._updateCapacityDisplay();
        this._updateTributeStats();
        this._showMessage(`${item.name} x${itemCount} 已放入祭品栏`);
    },

    // 更新祭品效果统计面板
    _updateTributeStats() {
        const statsEl = getElement('expeditionTributeStats');
        const listEl = getElement('expeditionTributeStatsList');
        if (!statsEl || !listEl) return;

        const tributes = this._carriedItems.filter(c => c !== null);
        if (tributes.length === 0) {
            statsEl.style.display = 'none';
            return;
        }

        statsEl.style.display = 'block';

        // 效果名称统一映射（不同名称但同一概念）
        const NAME_NORMALIZE = {
            '防御加成': '防御',
            '防御力': '防御',
        };

        // 收集所有祭品效果
        const effects = [];
        tributes.forEach(c => {
            const item = c.item;
            if (!item) return;
            const stats = item.stats || [];
            stats.forEach(s => {
                const value = String(s.value);
                const _isPositive = value.includes('+');
                const isNegative = value.includes('-');
                const type = isNegative ? 'penalty' : 'benefit';
                // 统一名称
                const normalizedName = NAME_NORMALIZE[s.name] || s.name;
                effects.push({
                    name: normalizedName,
                    rawName: s.name,
                    value: s.value,
                    type,
                    source: item.name
                });
            });
        });

        // 合并同名效果（如多个相同祭品）
        const merged = new Map();
        effects.forEach(e => {
            const key = e.name;
            if (!merged.has(key)) {
                merged.set(key, { ...e });
            } else {
                const existing = merged.get(key);
                // 简单累加数值（如果都是百分比或都是数值）
                const existingVal = parseFloat(existing.value);
                const newVal = parseFloat(e.value);
                if (!isNaN(existingVal) && !isNaN(newVal)) {
                    const sum = existingVal + newVal;
                    const sign = sum >= 0 ? '+' : '-';
                    const suffix = existing.value.includes('%') ? '%' : '';
                    existing.value = `${sign}${Math.abs(sum)}${suffix}`;
                    existing.source += `, ${e.source}`;
                }
                // type: 如果任意一个是减益，合并后仍标记为减益（优先显示负面）
                if (e.type === 'penalty') existing.type = 'penalty';
            }
        });

        // 渲染
        const items = Array.from(merged.values());
        if (items.length === 0) {
            statsEl.style.display = 'none';
            return;
        }

        listEl.innerHTML = items.map(item => `
            <div class="expedition-tribute-stat-item ${item.type}">
                <span class="stat-label">${item.name}</span>
                <span class="stat-value">${item.value}</span>
                <span class="stat-source">${item.source}</span>
            </div>
        `).join('');
    },

    // 从格子移除物品 — 归还到背包（类似 EnhanceSystem._returnEquippedItem）
    _removeItemFromCell(cell) {
        const slotIdx = parseInt(cell.dataset.slot);
        const carried = this._carriedItems[slotIdx];
        if (!carried) return;

        const itemName = carried.item.name;

        // 归还到背包：找第一个空位
        const usedSlots = new Set((EquipManager.backpackItems || []).map(i => i.slot));
        let bpSlot = 0;
        while (usedSlots.has(bpSlot) && bpSlot < EquipManager.maxBackpackSlots) bpSlot++;
        if (bpSlot >= EquipManager.maxBackpackSlots) {
            // 背包满，物品掉落在地上
            if (Game.player && Game.dropItem) {
                Game.dropItem(Game.player.x, Game.player.y, carried.item);
            }
            if (BackpackDialogManager._showBackpackFullNotice) {
                BackpackDialogManager._showBackpackFullNotice();
            }
        } else {
            const clone = JSON.parse(JSON.stringify(carried.item));
            clone.slot = bpSlot;
            if (!EquipManager.backpackItems) EquipManager.backpackItems = [];
            EquipManager.backpackItems.push(clone);
        }

        // 清空出征栏数据
        this._carriedItems[slotIdx] = null;
        delete cell.dataset.occupied;
        cell.classList.remove('occupied');
        cell.draggable = false;
        cell.style.borderColor = '';
        cell.innerHTML = '';

        // 刷新背包显示
        if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();

        this._updateCapacityDisplay();
        this._updateTributeStats();
        this._showMessage(`${itemName} 已归还到背包`);
    },

    // 归还所有物品到背包（关闭/重置时调用）
    _returnAllItemsToBackpack() {
        const bp = EquipManager.backpackItems || [];

        for (let slotIdx = 0; slotIdx < this.CAPACITY; slotIdx++) {
            const carried = this._carriedItems[slotIdx];
            if (!carried) continue;

            // 找背包第一个空位
            const usedSlots = new Set(bp.map(i => i.slot));
            let bpSlot = 0;
            while (usedSlots.has(bpSlot) && bpSlot < EquipManager.maxBackpackSlots) bpSlot++;
            if (bpSlot >= EquipManager.maxBackpackSlots) {
                // 背包满，掉地上
                if (Game.player && Game.dropItem) {
                    Game.dropItem(Game.player.x, Game.player.y, carried.item);
                }
            } else {
                const clone = JSON.parse(JSON.stringify(carried.item));
                clone.slot = bpSlot;
                bp.push(clone);
            }
        }

        // 清空所有出征栏数据
        this._carriedItems = new Array(this.CAPACITY).fill(null);

        // 刷新背包显示
        if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();
    },

    // 更新容量显示
    _updateCapacityDisplay() {
        const used = this._carriedItems.filter(c => c !== null).length;
        const usedEl = getElement('expeditionCapacityUsed');
        const maxEl = getElement('expeditionCapacityMax');
        if (usedEl) usedEl.textContent = used;
        if (maxEl) maxEl.textContent = this.CAPACITY;
    },

    // 更新队伍列表（3个槽位：主角 + 2空位）
    _updatePartyList(player) {
        const leader = getElement('expeditionPartyLeader');
        const _slot1 = getElement('expeditionPartySlot1');
        const _slot2 = getElement('expeditionPartySlot2');

        if (leader && player) {
            const mainItem = player.equipments[player.weaponMode];
            const offhandSlot = player.weaponMode === 'weapon' ? 'offhand' : 'ring2';
            const offhandItem = player.equipments[offhandSlot];
            leader.innerHTML = `
                <div class="expedition-party-avatar">🧙</div>
                <div class="expedition-party-info">
                    <div class="expedition-party-name">${player.data.name}</div>
                    <div class="expedition-party-detail">Lv.${player.data.level} ${player.data.class} · ${mainItem ? mainItem.name : '无'} / ${offhandItem ? offhandItem.name : '无'}</div>
                </div>
            `;
        }
    },

    // 显示消息
    _showMessage(text, type = 'normal') {
        const el = getElement('expeditionMessage');
        if (!el) return;
        el.textContent = text;
        el.className = 'expedition-message' + (type === 'error' ? ' error' : type === 'success' ? ' success' : '');
    },

    // 重置按钮 — 归还所有物品到背包，清空出征栏
    reset() {
        this._returnAllItemsToBackpack();
        this._returnAllEmpowerItems();

        // 清空所有格子视觉
        const cells = queryAllElements('.expedition-inv-cell');
        cells.forEach(cell => {
            delete cell.dataset.occupied;
            cell.classList.remove('occupied');
            cell.draggable = false;
            cell.style.borderColor = '';
            cell.innerHTML = '';
        });

        this._updateCapacityDisplay();
        this._updateTributeStats();
        this._showMessage('已重置祭品栏，所有物品已归还');
    },

    // 地牢选择变更
    onDungeonSelect(value) {
        this.selectedDungeon = value;
        this._updateDungeonInfo(value);
        this._updateRulePanelCurrent();
    },

    /** 当前选择地牢需要的祭品稀有度（F→common E→uncommon D→rare C→epic B→mythic A→legendary） */
    _getRequiredRarity() {
        const list = DungeonConfig.getDungeonList();
        const d = list[this.selectedDungeon] || {};
        const grade = d.grade || 'F';
        const idx = Math.max(0, GRADE_ORDER.indexOf(grade));
        return RARITY_ORDER[idx] || 'common';
    },

    /** 出征条件说明弹窗：创建（一次）并显示 */
    _showRulePanel() {
        this._buildRulePanel();
        const panel = getElement('expeditionRulePanel');
        if (panel) panel.style.display = 'block';
        this._updateRulePanelCurrent();
    },

    _hideRulePanel() {
        const panel = getElement('expeditionRulePanel');
        if (panel) panel.style.display = 'none';
    },

    _buildRulePanel() {
        if (getElement('expeditionRulePanel')) return;
        const panel = document.createElement('div');
        panel.id = 'expeditionRulePanel';
        panel.className = 'expedition-rule-panel';
        // 宽度内联设置（calc(10vw - 4px)，贴出征栏左缘无间隙）——内联样式优先级最高，
        // 跳过外部 game-style.css 可能被浏览器缓存导致的规则不生效
        panel.style.width = 'calc(10vw - 4px)';
        const rows = GRADE_ORDER.map((g, i) => {
            const rarity = RARITY_ORDER[i];
            const color = RARITY_COLORS[rarity] || '#c0c0c0';
            // 推荐等级段（与经验系统 bands 同源：combat-formulas enemy.expValue.bands）
            const expCfg = COMBAT_FORMULAS.enemy?.expValue || {};
            const band = (expCfg.bands || {})[g];
            const bandText = band ? ` · 推荐Lv.${band[0]}~${band[1] - 1}` : '';
            // 衰减预警：玩家等级超该档锚定等级+宽限 → 标红（防误刷低级本）
            const playerLv = (typeof Game !== 'undefined' && Game.player && Game.player.data && Game.player.data.level) || 1;
            const anchor = (expCfg.anchors || {})[g] ?? 3;
            const grace = expCfg.decay?.graceLevels ?? 5;
            const decayText = (playerLv - anchor > grace) ? ' <b style="color:#c0392b">⚠经验衰减</b>' : '';
            return `<div class="rule-item" style="color:${color}">${g} 级地牢 — ${RARITY_LABELS[rarity] || rarity}祭品${bandText}${decayText}</div>`;
        }).join('');
        panel.innerHTML = `
            <div class="rule-title">⚠ 出征条件</div>
            <div class="rule-desc">进入对应等级地牢，至少放入一件对应或更高稀有度祭品：</div>
            ${rows}
            <div class="rule-empower" id="expeditionRuleEmpower"></div>
            <div class="rule-current" id="expeditionRuleCurrent"></div>
            <div class="rule-rewards" id="expeditionRuleRewards"></div>
        `;
        document.body.appendChild(panel);
    },

    /** 更新说明弹窗中的当前需求高亮 */
    _updateRulePanelCurrent() {
        const el = getElement('expeditionRuleCurrent');
        if (!el) return;
        const list = DungeonConfig.getDungeonList();
        const d = list[this.selectedDungeon] || {};
        const grade = d.grade || 'F';
        const rarity = this._getRequiredRarity();
        const color = RARITY_COLORS[rarity] || '#c0c0c0';
        const zh = RARITY_LABELS[rarity] || rarity;
        const band = (COMBAT_FORMULAS.enemy?.expValue?.bands || {})[grade];
        const bandText = band ? ` · 推荐等级 Lv.${band[0]}~${band[1] - 1}` : '';
        el.innerHTML = `当前：<b style="color:#d4c5a9">${d.name || this.selectedDungeon}（${grade} 级）</b> 需要 <b style="color:${color}">${zh}及以上祭品</b>${bandText}`;
        this._updateRulePanelEmpower();
        this._updateRulePanelRewards(grade);
    },

    /** 左栏加持区块（只读实时显示）：投入强度/怪物等级/属性提升/奖励倍率/当前经验效率 */
    _updateRulePanelEmpower() {
        const el = getElement('expeditionRuleEmpower');
        if (!el) return;
        const rawS = DungeonEmpower.strengthFromItems(this._empowerItems);
        const S = this._getEmpowerStrength();
        if (S <= 0) { el.innerHTML = ''; return; }
        const expCfg = COMBAT_FORMULAS.enemy?.expValue || {};
        const growth = COMBAT_FORMULAS.enemy?.monsterGrowth || {};
        const empCfg = COMBAT_FORMULAS.enemy?.empower || {};
        const grade = getGradeForDungeon(this.selectedDungeon);
        const anchor = (expCfg.anchors || {})[grade] ?? 3;
        const lvBonus = S * (empCfg.levelPerStrength ?? 4);
        // 属性倍率（以配置 lv3 普通怪为参照基准）
        const dL = anchor + lvBonus - 3;
        const hpMul = 1 + (growth.hpPerLevel ?? 0.10) * dL;
        const atkMul = 1 + (growth.atkPerLevel ?? 0.08) * dL;
        // 奖励倍率
        const expMul = 1 + S * (empCfg.expPerStrength ?? 0.08);
        const goldPct = Math.round(S * (empCfg.goldPerStrength ?? 0.15) * 100);
        const dropPp = S * (empCfg.dropChancePerStrength ?? 0);
        const capBoost = S >= (empCfg.rarityCapStrength ?? 6);
        // 当前经验效率（玩家等级 vs 强化后锚定级，普通怪口径）
        const playerLv = (Game.player && Game.player.data && Game.player.data.level) || 1;
        const mult = getExpLevelMultiplier(playerLv, anchor + lvBonus, 'normal');
        const multPct = Math.round(mult * 100);
        const multColor = mult > 1 ? '#7ee787' : (mult < 1 ? '#c0392b' : '#d4c5a9');
        const multNote = mult > 1 ? '（越级加成）' : (mult < 1 ? '（压级衰减）' : '');
        // 怪物等级区间（种间偏移：僵尸犬 lv2 → -1，领主 lv12 → +9）
        const lvLow = anchor + lvBonus - 1;
        const lvHigh = anchor + lvBonus + 9;
        el.innerHTML = `
            <div style="color:#c9a0ff;font-weight:700;margin-top:8px;">✦ 祭品加持（强度 ${S}${rawS > S ? `，超出上限按 ${S} 计` : ''}）</div>
            <div class="rule-reward-line">怪物等级：Lv.${lvLow}~${lvHigh}</div>
            <div class="rule-reward-line">属性提升：HP ×${hpMul.toFixed(1)} · 攻击 ×${atkMul.toFixed(1)}</div>
            <div class="rule-reward-line">奖励提升：经验 ×${expMul.toFixed(2)} · 金币 +${goldPct}% · 掉率 +${dropPp}pp${capBoost ? ' · 封顶+1' : ''}</div>
            <div class="rule-reward-line">当前经验效率：<b style="color:${multColor}">${multPct}%${multNote}</b></div>
        `;
    },

    /** 稀有度中文+颜色行内渲染 */
    _rarityText(rarity) {
        const zh = RARITY_LABELS[rarity] || rarity;
        const color = RARITY_COLORS[rarity] || '#c0c0c0';
        return `<b style="color:${color}">${zh}</b>`;
    },

    /** 出征条件下方：当前地牢奖励情况（祭品品质/装备/事件等级，稀有度配色） */
    _updateRulePanelRewards(grade) {
        const el = getElement('expeditionRuleRewards');
        if (!el) return;
        const lines = [];
        // 祭品掉落品质：按难度表的稀有度封顶
        const table = (COMBAT_FORMULAS.tributes && COMBAT_FORMULAS.tributes.dropTables && COMBAT_FORMULAS.tributes.dropTables[grade]) || null;
        if (table) {
            const cap = table.maxRarity || 'legendary';
            lines.push(`祭品掉落：${this._rarityText('common')} ~ ${this._rarityText(cap)}`);
            const normalChance = Math.round(((table.normal && table.normal.chance) || 0) * 1000) / 10;
            lines.push(`<span class="rule-sub">精英/领主/首领必掉 · 普通怪 ${normalChance}%</span>`);
        }
        // 宝箱房奖励（精英战限时宝箱，按地牢等级读 universalEventRewards.treasureChest）
        const chestGrade = ((COMBAT_FORMULAS.universalEventRewards || {}).treasureChest || {})[grade];
        if (chestGrade) {
            lines.push(`宝箱房(${grade}级)：金币 ${chestGrade.gold} / 强化石+改造券+粉尘 ${chestGrade.materialDust}`);
        }
        // Boss 奖励卡中的武器稀有度（boss-reward-system 配置）
        const bonusCards = (BOSS_REWARD_CONFIG.reward && BOSS_REWARD_CONFIG.reward.bonusCards) || [];
        const bossWeapon = bonusCards.flatMap(c => c.rewards || []).find(r => r.type === 'weapon');
        if (bossWeapon) {
            lines.push(`Boss 奖励武器：${this._rarityText(bossWeapon.rarity || 'epic')}`);
        }
        // 事件等级：通用事件（奖励按当前难度档）+ 限定事件 ±1 范围内的等级跨度
        const idx = Math.max(0, GRADE_ORDER.indexOf(grade));
        const inRange = Object.values(RESTRICTED_EVENT_META)
            .map(m => GRADE_ORDER.indexOf(m.grade))
            .filter(i => i >= 0 && Math.abs(i - idx) <= 1);
        if (inRange.length > 0) {
            const minG = GRADE_ORDER[Math.min(...inRange)];
            const maxG = GRADE_ORDER[Math.max(...inRange)];
            lines.push(`事件：通用事件（${grade} 级奖励档）· 限定事件 ${minG}~${maxG} 级`);
        } else {
            lines.push(`事件：通用事件（${grade} 级奖励档）`);
        }
        el.innerHTML = `<div class="rule-rewards-title">✦ 奖励情况</div>` + lines.map(t => `<div class="rule-reward-line">${t}</div>`).join('');
    },

    // 更新地牢信息面板（展示元数据来自 data/dungeon-config.json 的 dungeonList）
    _updateDungeonInfo(_dungeonType) {
        const nameEl = getElement('expeditionDungeonName');
        const nodeCountEl = getElement('expeditionNodeCount');
        const battleRatioEl = getElement('expeditionBattleRatio');
        const levelEl = getElement('expeditionLevel');
        const rewardEl = getElement('expeditionReward');

        const list = DungeonConfig.getDungeonList();
        const d = list[_dungeonType] || list.zombie || {};
        if (nameEl) nameEl.textContent = d.name || '';
        if (nodeCountEl) nodeCountEl.textContent = d.nodeCount || '';
        if (battleRatioEl) battleRatioEl.textContent = d.battleRatio || '';
        if (levelEl) levelEl.textContent = d.level || '';
        if (rewardEl) rewardEl.textContent = d.reward || '';
    },

    // 确认出征 — 物品已从背包真正移出，直接带走
    depart() {
        const carried = this._carriedItems.filter(c => c !== null);
        if (carried.length === 0) {
            this._showMessage('请至少放入一种祭品', 'error');
            return;
        }

        // 等级准入检查：至少放入一件「对应或更高」稀有度祭品（C 级地牢需 ≥C 级/史诗）
        const requiredRarity = this._getRequiredRarity();
        const reqIdx = RARITY_ORDER.indexOf(requiredRarity);
        const hasRequired = carried.some(c => c && c.item && RARITY_ORDER.indexOf(c.item.rarity || 'common') >= reqIdx);
        if (!hasRequired) {
            this._showMessage('请根据提示放入对应等级祭品', 'error');
            return;
        }

        // 保存携带物品到 DungeonMapSystem（物品已从背包移出，直接带走）
        if (DungeonMapSystem) {
            DungeonMapSystem._carriedItems = carried;
        }
        // 祭品加持：注入本次强度（物品已移出背包即视为消耗，shutdown 时 reset）
        DungeonEmpower.setStrength(this._getEmpowerStrength());
        this._empowerItems = [null, null, null];
        // 特效祭品（雪莲/人参/蟠桃）在 buff 栏显示常驻图标
        if (Game.player) syncTributeBuffs(Game.player);

        this._showMessage('准备出征...', 'success');

        // 关闭面板和覆盖层（不归还物品，已确认带走）
        this._isOpen = false;
        // 移除点击/右键事件监听（与 close() 同口径，防止出征后背包监听叠加/物品丢失）
        this._removeClickHandlers();
        const panel = getElement('expeditionPanel');
        if (panel) panel.classList.remove('active');
        const overlay = getElement('expeditionOverlay');
        if (overlay) overlay.classList.remove('active');
        UIState.close('expedition');
        this._hideRulePanel(); // 出征后左侧条件栏一并隐藏（面板清理完整还原）

        // 恢复任务追踪栏（与 close() 同口径）
        const questTracker = getElement('questTracker');
        if (questTracker) questTracker.style.display = 'block';

        // 清空出征数据（物品已确认带走）
        this._carriedItems = new Array(this.CAPACITY).fill(null);

        // 关闭背包
        if (SystemUI) {
            SystemUI.close();
        }

        // 初始化地牢（传入选中的地牢类型）+ 切换场景状态到 scene7
        if (DungeonMapSystem) {
            const player = Game.player;
            const dungeonType = this.selectedDungeon || 'zombie';

            // 清理主神空间实体（传送门/NPC/怪物/掉落物），防止地图模式下小地图泄露残留蓝点
            const phaserScene = typeof window !== 'undefined' ? window.__phaserScene : null;
            if (phaserScene) {
                if (phaserScene.clearCombatView) phaserScene.clearCombatView();
                if (phaserScene.clearAllEntitySprites) phaserScene.clearAllEntitySprites();
            }
            if (EffectManager && EffectManager.clearFloatingTexts) EffectManager.clearFloatingTexts();
            Game.entities.clear();
            Game.entities.set('player', player);
            if (Game._tacticalSquadAI) Game._tacticalSquadAI.clear();
            // 地图模式使用地牢世界尺寸（2048 网格），小地图正确缩放
            CONFIG.WORLD_WIDTH = 2048;
            CONFIG.WORLD_HEIGHT = 2048;
            // 玩家移至地牢世界中央（主神空间坐标在 2048 世界内超界，小地图会画出框外）
            player.x = 1024;
            player.y = 1024;

            DungeonMapSystem.init('scene7', player, dungeonType);
            SceneManager.currentScene = 'scene7';
        }
    },

    // 从出征准备返回主神空间（保留，用于外部调用）
    returnToMain() {
        this.close(); // 关闭时会归还所有物品
        if (SystemUI) SystemUI.close();
        if (SceneManager) {
            SceneManager.switchScene('main', Game.player);
        }
    }
};

// 将 ExpeditionSystem 挂载到全局
if (typeof window !== 'undefined' && !window.ExpeditionSystem) {
    window.ExpeditionSystem = ExpeditionSystem;
}
