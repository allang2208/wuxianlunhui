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
        this.selectedDungeon = 'zombie'; // 默认选中僵尸地牢（可选列表见 dungeon-config.json dungeonList）

        // 打开面板时刷新玩家属性，确保没有残留祭品加成
        if (player && typeof player.calculateCombatStats === 'function') {
            player.calculateCombatStats();
        }

        // 清空旧的祭品统计 UI（死亡后重新打开时，上次的 DOM 可能还在）
        this._updateTributeStats();
        this._updateCapacityDisplay();

        // 先打开背包（如果还没打开）
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

        // 生成背包格子
        this._renderInventoryGrid();

        // 更新UI
        this._updatePartyList(player);
        this._setupDragDrop();
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

        // 隐藏面板和覆盖层
        const panel = getElement('expeditionPanel');
        if (panel) panel.classList.remove('active');
        const overlay = getElement('expeditionOverlay');
        if (overlay) overlay.classList.remove('active');

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

    // 设置拖放事件
    _setupDragDrop() {
        const cells = queryAllElements('.expedition-inv-cell');
        cells.forEach(cell => {
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
            if (!cell || !cell.dataset.occupied) return;
            e.preventDefault();
            e.stopPropagation();
            this._removeItemFromCell(cell);
        };
        this._expeditionContextMenu = (e) => {
            const cell = e.target.closest('.expedition-inv-cell');
            if (!cell || !cell.dataset.occupied) return;
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

        // 保存携带物品到 DungeonMapSystem（物品已从背包移出，直接带走）
        if (DungeonMapSystem) {
            DungeonMapSystem._carriedItems = carried;
        }

        this._showMessage('准备出征...', 'success');

        // 关闭面板和覆盖层（不归还物品，已确认带走）
        this._isOpen = false;
        const panel = getElement('expeditionPanel');
        if (panel) panel.classList.remove('active');
        const overlay = getElement('expeditionOverlay');
        if (overlay) overlay.classList.remove('active');
        UIState.close('expedition');

        // 清空出征数据（物品已确认带走）
        this._carriedItems = new Array(this.CAPACITY).fill(null);

        // 关闭背包
        if (SystemUI) {
            SystemUI.close();
        }

        // 初始化地牢（传入选中的地牢类型）
        if (DungeonMapSystem) {
            const player = Game.player;
            const dungeonType = this.selectedDungeon || 'zombie';
            DungeonMapSystem.init('scene7', player, dungeonType);
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
