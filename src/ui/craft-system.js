import { ItemDatabase } from '../items/item-database.js';
import { Game } from '../game.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { isCraftableWeapon } from '../config/gun-ammo.js';
import { UIState } from './ui-state.js';
import { EffectManager } from '../effects/effect-manager.js';
import { getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { EquipManager } from './equip-manager.js';
import { SystemUI } from './system-ui.js';
import craftConfigData from '../../data/craft-config.json';

const CraftSystem = {
    _isOpen: false,
    _currentNPC: null,
    _equippedItem: null,
    _equippedSlot: null,

    // 编辑模式状态
    _isEditing: false,
    _editSlotIndex: null,
    _editDragType: null, // 'cell' | 'target' | null
    _editDragOffset: { x: 0, y: 0 },
    _editTempSlots: null, // 编辑时使用的临时副本

    // 枪械改造配置（每种武器独立的slots和options）
    _WEAPON_CRAFT_CONFIGS: craftConfigData,

    open(npc) {
        UIState.open('craft');
        this._isOpen = true;
        this._currentNPC = npc;
        SystemUI.open('equip');
        const panel = getElement('craftPanel');
        if (panel) panel.classList.add('active');
        this._setupDragDrop();
        this._updateUI();
        this._updateEditBar();
    },

    close() {
        try {
            if (this._equippedItem) {
                this._returnEquippedItem();
            }
            UIState.close('craft');
            this._isOpen = false;
            this._currentNPC = null;
            this._closeModPopup();
            this.exitEditMode();
        } catch (e) {
            console.error('[CraftSystem.close] error:', e);
        }
        const panel = getElement('craftPanel');
        if (panel) panel.classList.remove('active');
        TimerManager.setTimeout(() => {
            if (!UIState.isOpen('craft') && !UIState.isOpen('shop') && !UIState.isOpen('enhance') && !UIState.isOpen('enchant')) {
                SystemUI.close();
            }
        }, 300);
    },

    toggle() {
        if (UIState.isOpen('craft')) this.close();
        else this.open();
    },

    // ===== 编辑栏控制 =====
    _updateEditBar() {
        const editBar = getElement('craftEditBar');
        const editBtn = getElement('craftEditBtn');
        const saveBtn = getElement('craftSaveBtn');
        const cancelBtn = getElement('craftCancelBtn');
        const editHint = getElement('craftEditHint');
        if (!editBar) return;

        const hasWeapon = this._equippedItem && isCraftableWeapon(this._equippedItem);
        editBar.style.display = 'flex';

        if (this._isEditing) {
            editBar.classList.add('editing');
            editBtn.style.display = 'none';
            saveBtn.style.display = 'inline-block';
            cancelBtn.style.display = 'inline-block';
            editHint.textContent = '拖动格子调整位置，拖动虚线端点调整指向';
        } else {
            editBar.classList.remove('editing');
            editBtn.style.display = hasWeapon ? 'inline-block' : 'none';
            saveBtn.style.display = 'none';
            cancelBtn.style.display = 'none';
            editHint.textContent = hasWeapon ? '点击"调整布局"开始编辑' : '';
        }
    },

    enterEditMode() {
        if (!this._equippedItem || !isCraftableWeapon(this._equippedItem)) return;
        const cfg = this._getCraftConfig(this._equippedItem.weaponId);
        if (!cfg) return; // 无改造配置的武器不进入编辑模式
        this._isEditing = true;
        // 深拷贝当前武器的slots配置作为临时编辑数据
        this._editTempSlots = JSON.parse(JSON.stringify(cfg.slots));
        this._updateEditBar();
        this._renderMods();
        this._editMoveHandler = (e) => this._onEditMove(e);
        this._editEndHandler = () => this._onEditEnd();
        document.addEventListener('mousemove', this._editMoveHandler);
        document.addEventListener('touchmove', this._editMoveHandler, { passive: false });
        document.addEventListener('mouseup', this._editEndHandler);
        document.addEventListener('touchend', this._editEndHandler);
    },

    exitEditMode() {
        if (this._editMoveHandler) {
            document.removeEventListener('mousemove', this._editMoveHandler);
            document.removeEventListener('touchmove', this._editMoveHandler);
            this._editMoveHandler = null;
        }
        if (this._editEndHandler) {
            document.removeEventListener('mouseup', this._editEndHandler);
            document.removeEventListener('touchend', this._editEndHandler);
            this._editEndHandler = null;
        }
        this._isEditing = false;
        this._editTempSlots = null;
        this._editSlotIndex = null;
        this._editDragType = null;
        this._updateEditBar();
        this._renderMods();
    },

    saveEditMode() {
        if (!this._isEditing || !this._editTempSlots) return;
        const cfg = this._getCraftConfig(this._equippedItem.weaponId);
        if (!cfg) { this.exitEditMode(); return; }
        // 保存临时数据到当前武器的配置
        cfg.slots = JSON.parse(JSON.stringify(this._editTempSlots));
        
        this.exitEditMode();
    },

    _setupDragDrop() {
        const dropZone = getElement('craftDropZone');
        const modContainer = getElement('craftModContainer');
        if (!dropZone) return;

        // 共用：拖入改造栏的处理逻辑
        const handleDropIn = (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
            const src = EquipManager._dragDropManager._dragSrc;
            if (!src) return;
            EquipManager._dragDropManager._dropHandled = true;
            if (src.type === 'inventory') {
                const idx = parseInt(src.slot);
                const item = EquipManager.backpackItems.find(i => i.slot === idx);
                if (item && item.category !== 'gold' && isCraftableWeapon(item)) {
                    this._equipFromBackpack(idx);
                }
            } else if (src.type === 'equip') {
                const slotKey = src.slot;
                const item = Game.player.equipments[slotKey];
                if (item && isCraftableWeapon(item)) {
                    this._equipFromSlot(slotKey);
                }
            }
            EquipManager._dragDropManager._dragSrc = null;
        };

        const handleDragOver = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            dropZone.classList.add('drag-over');
        };

        const handleDragLeave = (_e) => {
            dropZone.classList.remove('drag-over');
        };

        // dropZone 接收拖入
        dropZone.ondragover = handleDragOver;
        dropZone.ondragleave = handleDragLeave;
        dropZone.ondrop = handleDropIn;

        // modContainer 也接收拖入（覆盖在上方，确保拖入任意位置都能触发）
        if (modContainer) {
            modContainer.ondragover = handleDragOver;
            modContainer.ondragleave = handleDragLeave;
            modContainer.ondrop = handleDropIn;
        }

        // 共用：从改造栏拖出的处理逻辑
        const handleDragStart = (e) => {
            if (!this._equippedItem) return;
            EquipManager._dragDropManager._dragSrc = { type: 'craft', slot: 'craft' };
            EquipManager._dragDropManager._dropHandled = false;
            e.dataTransfer.setData('text/plain', 'craft');
            e.dataTransfer.effectAllowed = 'move';
            dropZone.classList.add('dragging');
            // 创建自定义拖动图片：背包格子大小的装备方块
            const canvas = document.createElement('canvas');
            canvas.width = 56; canvas.height = 56;
            const ctx = canvas.getContext('2d');
            // 背景（背包格子样式）
            ctx.fillStyle = '#2a2520';
            ctx.fillRect(0, 0, 56, 56);
            ctx.strokeStyle = '#5a4d3f';
            ctx.lineWidth = 2;
            ctx.strokeRect(0, 0, 56, 56);
            // 绘制装备图标
            const imgSrc = this._equippedItem.equipImage || this._equippedItem.slotImage || this._equippedItem.iconImage;
            if (imgSrc) {
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 4, 4, 48, 48);
                    e.dataTransfer.setDragImage(canvas, 28, 28);
                };
                img.onerror = () => {
                    ctx.fillStyle = '#d4c5a9';
                    ctx.font = '24px serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(this._equippedItem.icon || '❓', 28, 36);
                    e.dataTransfer.setDragImage(canvas, 28, 28);
                };
                img.src = imgSrc;
            } else {
                ctx.fillStyle = '#d4c5a9';
                ctx.font = '24px serif';
                ctx.textAlign = 'center';
                ctx.fillText(this._equippedItem.icon || '❓', 28, 36);
                e.dataTransfer.setDragImage(canvas, 28, 28);
            }
        };

        const handleDragEnd = (_e) => {
            dropZone.classList.remove('dragging');
        };

        dropZone.ondragstart = handleDragStart;
        dropZone.ondragend = handleDragEnd;

        // 右键卸下：绑定到 dropZone 和 modContainer，确保任意位置右键都能卸下
        const handleContextMenu = (e) => {
            e.preventDefault();
            if (this._equippedItem) {
                this._returnEquippedItem();
                this._updateUI();
            }
        };
        dropZone.oncontextmenu = handleContextMenu;
        if (modContainer) {
            modContainer.oncontextmenu = handleContextMenu;
        }
    },

    _equipFromBackpack(idx) {
        const item = EquipManager.backpackItems.find(i => i.slot === idx);
        
        if (!item || !isCraftableWeapon(item)) return;
        // 先归还当前装备
        if (this._equippedItem) this._returnEquippedItem();
        // 从背包移除（原地删除，保持数组引用一致）
        const bpIndex = EquipManager.backpackItems.findIndex(i => i.slot === idx);
        if (bpIndex !== -1) EquipManager.backpackItems.splice(bpIndex, 1);
        // 放入改造槽（深拷贝，避免与背包共享引用）
        this._equippedItem = JSON.parse(JSON.stringify(item));
        // 深拷贝后修复：如果 equipImage 缺失但 weaponAsset.image 存在，自动设置 equipImage
        if (!this._equippedItem.equipImage && item.weaponAsset && item.weaponAsset.image && typeof item.weaponAsset.image === 'string') {
            this._equippedItem.equipImage = item.weaponAsset.image;
        }
        // 深拷贝可能丢失 weaponAsset 中的非字符串属性，强制从原始 item 复制关键字段
        if (item.equipImage) this._equippedItem.equipImage = item.equipImage;
        if (item.slotImage) this._equippedItem.slotImage = item.slotImage;
        if (item.iconImage) this._equippedItem.iconImage = item.iconImage;
        if (item.weaponAsset && typeof item.weaponAsset === 'object') {
            if (!this._equippedItem.weaponAsset) this._equippedItem.weaponAsset = {};
            if (item.weaponAsset.image && typeof item.weaponAsset.image === 'string') {
                this._equippedItem.weaponAsset.image = item.weaponAsset.image;
            }
            if (item.weaponAsset.muzzleImage && typeof item.weaponAsset.muzzleImage === 'string') {
                this._equippedItem.weaponAsset.muzzleImage = item.weaponAsset.muzzleImage;
            }
        }
        // 确保每个装备实例有唯一标识
        if (!this._equippedItem.itemId) {
            this._equippedItem.itemId = Date.now() + '_' + Math.floor(Math.random() * 1000);
        }
        // 恢复该装备的改造数据（如果之前改造过）
        if (this._equippedItem._craftData) {
            this._applyModEffects();
        }
        this._equippedSlot = { type: 'inventory', idx: idx };
        // 刷新背包显示
        if (EquipManager && EquipManager.updateInventorySlots) {
            EquipManager.updateInventorySlots();
        }
        this._updateUI();
    },

    _equipFromSlot(slotKey) {
        const item = Game.player.equipments[slotKey];
        
        if (!item || !isCraftableWeapon(item)) return;
        // 先归还当前装备到背包
        if (this._equippedItem) this._returnEquippedItem();
        // 从装备槽移除
        Game.player.equipments[slotKey] = null;
        if (Game.player.equipCallbacks && Game.player.equipCallbacks[slotKey]) {
            Game.player.equipCallbacks[slotKey](null);
        }
        // 放入改造槽（深拷贝，避免与装备栏共享引用）
        this._equippedItem = JSON.parse(JSON.stringify(item));
        // 深拷贝后修复：如果 equipImage 缺失但 weaponAsset.image 存在，自动设置 equipImage
        if (!this._equippedItem.equipImage && item.weaponAsset && item.weaponAsset.image && typeof item.weaponAsset.image === 'string') {
            this._equippedItem.equipImage = item.weaponAsset.image;
        }
        // 深拷贝可能丢失 weaponAsset 中的非字符串属性，强制从原始 item 复制关键字段
        if (item.equipImage) this._equippedItem.equipImage = item.equipImage;
        if (item.slotImage) this._equippedItem.slotImage = item.slotImage;
        if (item.iconImage) this._equippedItem.iconImage = item.iconImage;
        if (item.weaponAsset && typeof item.weaponAsset === 'object') {
            if (!this._equippedItem.weaponAsset) this._equippedItem.weaponAsset = {};
            if (item.weaponAsset.image && typeof item.weaponAsset.image === 'string') {
                this._equippedItem.weaponAsset.image = item.weaponAsset.image;
            }
            if (item.weaponAsset.muzzleImage && typeof item.weaponAsset.muzzleImage === 'string') {
                this._equippedItem.weaponAsset.muzzleImage = item.weaponAsset.muzzleImage;
            }
        }
        // 确保每个装备实例有唯一标识
        if (!this._equippedItem.itemId) {
            this._equippedItem.itemId = Date.now() + '_' + Math.floor(Math.random() * 1000);
        }
        // 恢复该装备的改造数据（如果之前改造过）
        if (this._equippedItem._craftData) {
            this._applyModEffects();
        }
        this._equippedSlot = { type: 'equip', slot: slotKey };
        
        // 刷新装备栏和背包显示（关键：装备栏必须立即更新）
        if (EquipManager) {
            if (EquipManager.updateEquipSlots) EquipManager.updateEquipSlots();
            if (EquipManager._syncWeaponVisual) EquipManager._syncWeaponVisual();
            if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();
        }
        this._updateUI();
    },

    _returnEquippedItem() {
        if (!this._equippedItem) {
            console.warn('[CraftSystem] _returnEquippedItem: _equippedItem 为 null');
            return;
        }
        
        // 安全获取背包数组
        if (!EquipManager.backpackItems) {
            EquipManager.backpackItems = [];
        }
        // 归还到背包（找第一个空位）
        const emptySlot = EquipManager._findFirstEmptySlot ? EquipManager._findFirstEmptySlot() : -1;
        
        if (emptySlot !== -1) {
            this._equippedItem.slot = emptySlot;
            EquipManager.backpackItems.push(this._equippedItem);
            
        } else {
            // 背包满：装备掉落在地上，并显示与背包已满一致的提示
            Game.dropItem(Game.player.x, Game.player.y, this._equippedItem);
            let el = getElement('backpackFullNotice');
            if (el) el.remove();
            el = document.createElement('div');
            el.id = 'backpackFullNotice';
            el.style.cssText = 'position:fixed;top:210px;left:50%;transform:translateX(-50%);color:#d4c5a9;font-size:48px;font-weight:700;text-shadow:0 2px 8px rgba(0,0,0,0.8);z-index:5000;pointer-events:none;animation:sceneLabelFade 3s ease-out forwards;font-family:SimHei,"Microsoft YaHei","黑体",sans-serif;';
            el.textContent = '当前背包已满，装备自动掉落附近地上';
            document.body.appendChild(el);
            TimerManager.setTimeout(() => { if (el && el.parentNode) el.remove(); }, 3000);
            
        }
        // 如果来自装备槽，清空该装备槽（防止视觉上仍显示）
        if (this._equippedSlot && this._equippedSlot.type === 'equip') {
            Game.player.equipments[this._equippedSlot.slot] = null;
            if (Game.player.equipCallbacks && Game.player.equipCallbacks[this._equippedSlot.slot]) {
                Game.player.equipCallbacks[this._equippedSlot.slot](null);
            }
        }
        this._equippedItem = null;
        this._equippedSlot = null;
        // 刷新所有栏位显示
        if (EquipManager) {
            if (EquipManager.updateInventorySlots) EquipManager.updateInventorySlots();
            if (EquipManager.updateEquipSlots) EquipManager.updateEquipSlots();
            if (EquipManager._syncWeaponVisual) EquipManager._syncWeaponVisual();
        }
    },

    _updateUI() {
        const dropZone = getElement('craftDropZone');
        const placeholder = getElement('craftDropPlaceholder');
        const weaponDisplay = getElement('craftWeaponDisplay');
        const modContainer = getElement('craftModContainer');

        // 清除旧图片
        if (weaponDisplay) weaponDisplay.innerHTML = '';

        if (!this._equippedItem) {
            // 无装备：显示提示，隐藏武器贴图
            if (dropZone) dropZone.classList.remove('has-item');
            if (placeholder) {
                placeholder.style.display = 'flex';
                placeholder.innerHTML = '<span>📥</span><span>拖入或右键装备</span>';
            }
            if (weaponDisplay) weaponDisplay.style.display = 'none';
            if (modContainer) modContainer.style.display = 'none';
            this._updateEditBar();
            return;
        }

        // 有装备：显示武器贴图
        if (dropZone) dropZone.classList.add('has-item');
        if (placeholder) placeholder.style.display = 'none';
        if (weaponDisplay) weaponDisplay.style.display = 'flex'; // ← 关键：显示贴图区域

        // 尝试获取图片路径（多重 fallback）
        let imgSrc = null;
        const item = this._equippedItem;

        // 1. 优先使用 weaponAsset.image（hold/top-down 图片，用于改造栏展示）
        if (item.weaponAsset && item.weaponAsset.image && typeof item.weaponAsset.image === 'string') {
            imgSrc = item.weaponAsset.image;
        }
        else if (item.equipImage) imgSrc = item.equipImage;
        else if (item.slotImage) imgSrc = item.slotImage;
        else if (item.iconImage) imgSrc = item.iconImage;

        // 2. 从 ItemDatabase 根据 id 查找
        if (!imgSrc && item.id && ItemDatabase) {
            const dbItem = ItemDatabase.get(item.id);
            if (dbItem) {
                if (dbItem.weaponAsset && typeof dbItem.weaponAsset.image === 'string') {
                    imgSrc = dbItem.weaponAsset.image;
                }
                if (!imgSrc) imgSrc = dbItem.equipImage || dbItem.slotImage || dbItem.iconImage;
            }
        }

        // 3. 从 ItemDatabase 根据 weaponId 反查（索引由 ItemDatabase 维护，新武器无需登记）
        if (!imgSrc && item.weaponId && ItemDatabase && ItemDatabase.getByWeaponId) {
            const dbItem = ItemDatabase.getByWeaponId(item.weaponId);
            if (dbItem) {
                if (dbItem.weaponAsset && typeof dbItem.weaponAsset.image === 'string') {
                    imgSrc = dbItem.weaponAsset.image;
                }
                if (!imgSrc) imgSrc = dbItem.equipImage || dbItem.slotImage || dbItem.iconImage;
            }
        }

        

        if (imgSrc) {
            const imgEl = document.createElement('img');
            imgEl.src = imgSrc;
            imgEl.style.cssText = 'height:100%;width:auto;max-width:100%;object-fit:contain;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));transform:rotate(0deg);';
            if (weaponDisplay) weaponDisplay.appendChild(imgEl);
        } else {
            console.warn('[CraftSystem] 无可用贴图:', item.name, item);
            // 显示默认图标
            if (weaponDisplay) {
                weaponDisplay.innerHTML = '<div style="font-size:48px;color:#8a7d6b;">🔧</div>';
            }
        }

        // 如果是枪械类武器，显示改造格子
        if (this._equippedItem && isCraftableWeapon(this._equippedItem)) {
            if (modContainer) modContainer.style.display = 'flex';
            // 使用 requestAnimationFrame 确保布局完成后再渲染格子
            requestAnimationFrame(() => this._renderMods());
        } else {
            if (modContainer) modContainer.style.display = 'none';
        }
        this._updateEditBar();
    },

    _renderMods() {
        const modContainer = getElement('craftModContainer');
        const modGrid = getElement('craftModGrid');
        const svg = getElement('craftLinesSvg');
        if (!modContainer || !modGrid || !svg) return;
        if (!this._equippedItem) return; // 无装备时不渲染改造格子

        const config = this._getCraftConfig(this._equippedItem.weaponId);
        if (!config) {
            // 无改造配置的武器（盾/弓/锈剑等）：明确提示，不再回退显示 PKM 配件
            modGrid.innerHTML = '<div style="color:#8a7d6b;padding:20px;text-align:center;">该武器不可改造</div>';
            svg.innerHTML = '';
            return;
        }
        const itemMods = (this._equippedItem && this._equippedItem._craftData) ? this._equippedItem._craftData : {};

        modGrid.innerHTML = '';
        svg.innerHTML = '';

        const containerRect = modContainer.getBoundingClientRect();
        const w = containerRect.width || 340;
        const h = containerRect.height || 400;

        // 编辑模式下使用临时数据，否则使用正式配置
        const slots = this._isEditing && this._editTempSlots ? this._editTempSlots : config.slots;

        // 绘制线条和创建格子
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            const slotX = slot.x * w;
            const slotY = slot.y * h;
            const targetX = slot.lineTarget.x * w;
            const targetY = slot.lineTarget.y * h;

            // 绘制线条（格子端固定，target端可调整）
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', slotX);
            line.setAttribute('y1', slotY);
            line.setAttribute('x2', targetX);
            line.setAttribute('y2', targetY);
            line.setAttribute('stroke', 'rgba(212, 197, 169, 0.6)');
            line.setAttribute('stroke-width', '2');
            line.setAttribute('stroke-dasharray', '4,3');
            svg.appendChild(line);

            // 编辑模式：在target端添加可拖拽的圆点
            if (this._isEditing) {
                const targetDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                targetDot.setAttribute('cx', targetX);
                targetDot.setAttribute('cy', targetY);
                targetDot.setAttribute('r', '6');
                targetDot.setAttribute('fill', '#d4c5a9');
                targetDot.setAttribute('stroke', '#7a6a5a');
                targetDot.setAttribute('stroke-width', '2');
                targetDot.setAttribute('cursor', 'move');
                targetDot.style.pointerEvents = 'auto';
                targetDot.dataset.slotIndex = i;
                targetDot.dataset.dragType = 'target';
                this._bindEditDrag(targetDot, i, 'target');
                svg.appendChild(targetDot);
            }

            // 创建格子
            const cell = document.createElement('div');
            cell.className = 'craft-mod-cell';
            if (this._isEditing) {
                cell.classList.add('editing');
                cell.style.cursor = 'move';
                cell.dataset.slotIndex = i;
                cell.dataset.dragType = 'cell';
                this._bindEditDrag(cell, i, 'cell');
            }
            cell.style.left = `${slotX - 24}px`;
            cell.style.top = `${slotY - 24}px`;

            const equipped = itemMods[slot.id];
            if (equipped) {
                const option = config.options[slot.id]?.find(o => o.id === equipped);
                cell.innerHTML = `<div class="craft-mod-cell-icon">${option?.icon || '🔧'}</div><div class="craft-mod-cell-name">${option?.name || '已装备'}</div>`;
                cell.classList.add('equipped');
            } else {
                cell.innerHTML = `<div class="craft-mod-cell-icon">➕</div><div class="craft-mod-cell-name">${slot.name}</div>`;
            }

            // 编辑模式下禁用点击（防止触发配件选择）
            if (!this._isEditing) {
                cell.onclick = () => this._onModCellClick(slot.id);
            }
            cell.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this._equippedItem) {
                    this._returnEquippedItem();
                    this._updateUI();
                }
            };
            // 让格子也支持拖动（改造槽整体拖出）
            if (!this._isEditing) {
                cell.draggable = true;
                cell.ondragstart = (e) => {
                    if (!this._equippedItem) { e.preventDefault(); return; }
                    EquipManager._dragDropManager._dragSrc = { type: 'craft', slot: 'craft' };
                    EquipManager._dragDropManager._dropHandled = false;
                    e.dataTransfer.setData('text/plain', 'craft');
                    e.dataTransfer.effectAllowed = 'move';
                    const dropZone = getElement('craftDropZone');
                    if (dropZone) dropZone.classList.add('dragging');
                };
                cell.ondragend = (_e) => {
                    const dropZone = getElement('craftDropZone');
                    if (dropZone) dropZone.classList.remove('dragging');
                    if (!EquipManager._dragDropManager._dropHandled && EquipManager._dragDropManager._dragSrc) {
                        this._returnEquippedItem();
                        this._updateUI();
                    }
                    EquipManager._dragDropManager._dropHandled = false;
                    EquipManager._dragDropManager._dragSrc = null;
                };
            }
            modGrid.appendChild(cell);
        }
    },

    // 绑定编辑拖动事件（仅绑定 start 事件）
    _bindEditDrag(element, slotIndex, dragType) {
        const startDrag = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this._isEditing || !this._editTempSlots) return;
            this._editSlotIndex = slotIndex;
            this._editDragType = dragType;
            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);
            this._editDragOffset = { x: clientX, y: clientY };
        };

        element.addEventListener('mousedown', startDrag);
        element.addEventListener('touchstart', startDrag, { passive: false });
    },

    _onEditMove(e) {
        if (this._editSlotIndex === null || !this._editDragType || !this._editTempSlots) return;
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        const dx = clientX - this._editDragOffset.x;
        const dy = clientY - this._editDragOffset.y;

        const modContainer = getElement('craftModContainer');
        const rect = modContainer.getBoundingClientRect();
        const w = rect.width || 340;
        const h = rect.height || 400;

        const slot = this._editTempSlots[this._editSlotIndex];
        if (this._editDragType === 'cell') {
            // 拖动格子：更新格子的 x, y（相对坐标，0-1）
            const newX = Math.max(0, Math.min(1, slot.x + dx / w));
            const newY = Math.max(0, Math.min(1, slot.y + dy / h));
            slot.x = newX;
            slot.y = newY;
        } else if (this._editDragType === 'target') {
            // 拖动虚线target端：更新 lineTarget
            const newX = Math.max(0, Math.min(1, slot.lineTarget.x + dx / w));
            const newY = Math.max(0, Math.min(1, slot.lineTarget.y + dy / h));
            slot.lineTarget.x = newX;
            slot.lineTarget.y = newY;
        }

        this._editDragOffset = { x: clientX, y: clientY };
        this._renderMods();
    },

    _onEditEnd() {
        this._editSlotIndex = null;
        this._editDragType = null;
    },

    _onModCellClick(slotId) {
        const config = this._getCraftConfig(this._equippedItem.weaponId);
        if (!config) return;
        const options = config.options[slotId];
        if (!options || options.length === 0) return;

        const popup = getElement('craftModPopup');
        const body = getElement('craftModPopupBody');
        if (!popup || !body) return;

        body.innerHTML = '';
        const itemMods = (this._equippedItem && this._equippedItem._craftData) ? this._equippedItem._craftData : {};
        const current = itemMods[slotId];

        for (const opt of options) {
            const row = document.createElement('div');
            row.className = 'craft-mod-option' + (current === opt.id ? ' selected' : '');
            const ticketLabel = current ? '🔧 替换需4张改造券' : '🔧 需1张改造券';
            row.innerHTML = `
                <div class="craft-mod-option-icon">${opt.icon}</div>
                <div class="craft-mod-option-info">
                    <div class="craft-mod-option-name">${opt.name}</div>
                    <div class="craft-mod-option-desc">${opt.desc}</div>
                    <div class="craft-mod-option-cost" style="color:#e8a838;font-size:11px;margin-top:2px;">${ticketLabel}</div>
                </div>
                <div class="craft-mod-option-action">${current === opt.id ? '✓ 已装备' : '点击装备'}</div>
            `;
            row.onclick = () => {
                this._equipMod(slotId, opt.id);
                this._closeModPopup();
            };
            body.appendChild(row);
        }

        popup.style.display = 'block';
        // 添加点击外部关闭（下一帧避免立即触发）
        requestAnimationFrame(() => {
            this._popupCloseHandler = (e) => {
                if (!popup.contains(e.target)) {
                    this._closeModPopup();
                }
            };
            document.addEventListener('mousedown', this._popupCloseHandler);
        });
    },

    _closeModPopup() {
        const popup = getElement('craftModPopup');
        if (popup) popup.style.display = 'none';
        if (this._popupCloseHandler) {
            document.removeEventListener('mousedown', this._popupCloseHandler);
            this._popupCloseHandler = null;
        }
    },

    _equipMod(slotId, modId) {
        // 将改造数据绑定到具体装备实例
        if (!this._equippedItem) return;

        // 同槽同配件重复点击：不再扣券重挂（修复"✓已装备"仍白扣 4 张改造券）
        if (this._equippedItem._craftData && this._equippedItem._craftData[slotId] === modId) return;

        const hasExisting = this._equippedItem._craftData && this._equippedItem._craftData[slotId];
        const ticketCost = hasExisting ? 4 : 1;
        const ticketName = hasExisting ? '改造券×4（替换已改造配件）' : '改造券×1';

        // 检查改造券（优先按物品 id，无 id 的旧实例回退按名称）
        const bp = EquipManager.backpackItems || [];
        const ticketIdx = bp.findIndex(i => i.id === 'reforge_ticket' || (!i.id && i.name === '改造券'));
        if (ticketIdx === -1) {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 40, `改造券不足！需要${ticketName}`, '#ff4444'));
            return;
        }
        const ticketItem = bp[ticketIdx];
        if ((ticketItem.stack || 1) < ticketCost) {
            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 40, `改造券不足！需要${ticketName}，当前只有${ticketItem.stack || 1}张`, '#ff4444'));
            return;
        }
        // 消耗改造券
        if (ticketItem.stack > ticketCost) {
            ticketItem.stack -= ticketCost;
        } else {
            bp.splice(ticketIdx, 1);
        }
        EquipManager.updateInventorySlots();

        if (!this._equippedItem._craftData) this._equippedItem._craftData = {};
        this._equippedItem._craftData[slotId] = modId;
        this._equippedItem._isCrafted = true;
        this._applyModEffects();
        this._renderMods();
        EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 40, `改造成功！消耗${ticketName}`, '#ffd700'));
    },

    _applyModEffects() {
        if (!this._equippedItem) return;
        const weaponConfig = this._getCraftConfig(this._equippedItem.weaponId);
        if (!weaponConfig) {
            // 无改造配置的武器：清空效果，不再回退套用 PKM 配件
            this._equippedItem._craftEffects = {};
            return;
        }
        const itemMods = this._equippedItem._craftData || {};

        // 收集所有效果
        let rangeDelta = 0;
        let knockbackDelta = 0;
        let spreadTimeDelta = 0;
        let spreadStartDelta = 0;
        let reloadTimeDelta = 0;
        let magazineDelta = 0;
        let projectileSpeedPercent = 0;
        let moveSpeedPercent = 0;
        let hideMuzzleFlash = false;
        let highPowerScope = false;
        let redDotScope = false;
        let maxSpreadAngleDelta = 0;
        // 新增改造效果（Super90专属）
        let damagePercent = 0;
        let slugMode = false;
        let flechetteMode = false;
        let piercingBonus = 0;
        let magazineOverride = 0;
        let critChancePercent = 0;
        let slugRecoilRecovery = 0;
        let fastReload = false;
        // 半自动武器效果
        let attackIntervalDelta = 0;
        let recoilRecoveryDelta = 0;
        let shotSpreadDelta = 0;
        // 骑士长剑改造效果
        let staminaCostDelta = 0;
        let skillStaminaCostDelta = 0;
        let defensePercent = 0;
        let secondaryBlock = false;
        let dashDoubleHit = false;
        let bleedingOnHit = false;
        // 能量轻机枪改造效果
        let overheatTimeDelta = 0;
        let overheatRecoverDelta = 0;
        // 符文长剑/夜与火之剑改造效果
        let magicVulnerabilityOnHit = false;
        let magicVulnerabilityStacks = 0;
        let magicPenetrationPercent = 0;
        let armorPenetrationPercent = 0;
        let enchantedBlade = false;
        let runeRestructureCount = 0;
        let specialRangeDelta = 0;
        let specialDurationDelta = 0;

        for (const slotId in itemMods) {
            const modId = itemMods[slotId];
            const slotOpts = weaponConfig.options[slotId];
            if (!slotOpts) continue;
            const opt = slotOpts.find(o => o.id === modId);
            if (!opt || !opt.effects) continue;

            if (opt.effects.rangeDelta) rangeDelta += opt.effects.rangeDelta;
            if (opt.effects.knockbackDelta) knockbackDelta += opt.effects.knockbackDelta;
            if (opt.effects.spreadTimeDelta) spreadTimeDelta += opt.effects.spreadTimeDelta;
            if (opt.effects.spreadStartDelta) spreadStartDelta += opt.effects.spreadStartDelta;
            if (opt.effects.reloadTimeDelta) reloadTimeDelta += opt.effects.reloadTimeDelta;
            if (opt.effects.magazineDelta) magazineDelta += opt.effects.magazineDelta;
            if (opt.effects.projectileSpeedPercent) projectileSpeedPercent += opt.effects.projectileSpeedPercent;
            if (opt.effects.moveSpeedPercent) moveSpeedPercent += opt.effects.moveSpeedPercent;
            if (opt.effects.maxSpreadAngleDelta) maxSpreadAngleDelta += opt.effects.maxSpreadAngleDelta;
            if (opt.effects.hideMuzzleFlash) hideMuzzleFlash = true;
            if (opt.effects.highPowerScope) highPowerScope = true;
            if (opt.effects.redDotScope) redDotScope = true;
            // 新增效果处理
            if (opt.effects.damagePercent) damagePercent += opt.effects.damagePercent;
            if (opt.effects.slugMode) slugMode = true;
            if (opt.effects.flechetteMode) flechetteMode = true;
            if (opt.effects.piercingBonus) piercingBonus += opt.effects.piercingBonus;
            if (opt.effects.magazineOverride) magazineOverride = opt.effects.magazineOverride;
            if (opt.effects.critChancePercent) critChancePercent += opt.effects.critChancePercent;
            if (opt.effects.slugRecoilRecovery) slugRecoilRecovery += opt.effects.slugRecoilRecovery;
            if (opt.effects.fastReload) fastReload = true;
            // 半自动武器效果收集
            if (opt.effects.attackIntervalDelta) attackIntervalDelta += opt.effects.attackIntervalDelta;
            if (opt.effects.recoilRecoveryDelta) recoilRecoveryDelta += opt.effects.recoilRecoveryDelta;
            if (opt.effects.shotSpreadDelta) shotSpreadDelta += opt.effects.shotSpreadDelta;
            // 骑士长剑改造效果
            if (opt.effects.staminaCostDelta) staminaCostDelta += opt.effects.staminaCostDelta;
            if (opt.effects.skillStaminaCostDelta) skillStaminaCostDelta += opt.effects.skillStaminaCostDelta;
            if (opt.effects.defensePercent) defensePercent += opt.effects.defensePercent;
            if (opt.effects.secondaryBlock) secondaryBlock = true;
            if (opt.effects.dashDoubleHit) dashDoubleHit = true;
            if (opt.effects.bleedingOnHit) bleedingOnHit = true;
            // 能量轻机枪改造效果
            if (opt.effects.overheatTimeDelta) overheatTimeDelta += opt.effects.overheatTimeDelta;
            if (opt.effects.overheatRecoverDelta) overheatRecoverDelta += opt.effects.overheatRecoverDelta;
            // 符文长剑/夜与火之剑改造效果
            if (opt.effects.magicVulnerabilityOnHit) magicVulnerabilityOnHit = true;
            if (opt.effects.magicVulnerabilityStacks) magicVulnerabilityStacks += opt.effects.magicVulnerabilityStacks;
            if (opt.effects.magicPenetrationPercent) magicPenetrationPercent += opt.effects.magicPenetrationPercent;
            if (opt.effects.armorPenetrationPercent) armorPenetrationPercent += opt.effects.armorPenetrationPercent;
            if (opt.effects.enchantedBlade) enchantedBlade = true;
            if (opt.effects.runeRestructureCount) runeRestructureCount += opt.effects.runeRestructureCount;
            if (opt.effects.specialRangeDelta) specialRangeDelta += opt.effects.specialRangeDelta;
            if (opt.effects.specialDurationDelta) specialDurationDelta += opt.effects.specialDurationDelta;
        }

        // 将改造效果绑定到具体装备实例
        this._equippedItem._craftEffects = {
            rangeDelta, knockbackDelta, spreadTimeDelta, spreadStartDelta,
            reloadTimeDelta, magazineDelta, projectileSpeedPercent, moveSpeedPercent, maxSpreadAngleDelta, hideMuzzleFlash, highPowerScope, redDotScope,
            damagePercent, slugMode, flechetteMode, piercingBonus, magazineOverride, critChancePercent, slugRecoilRecovery, fastReload,
            attackIntervalDelta, recoilRecoveryDelta, shotSpreadDelta,
            staminaCostDelta, skillStaminaCostDelta, defensePercent, secondaryBlock, dashDoubleHit, bleedingOnHit,
            overheatTimeDelta, overheatRecoverDelta,
            magicVulnerabilityOnHit, magicVulnerabilityStacks, magicPenetrationPercent, armorPenetrationPercent, enchantedBlade,
            runeRestructureCount, specialRangeDelta, specialDurationDelta
        };
        // 重新初始化弹药状态（应用弹夹容量和换弹时间改造）
        if (Game.player._initAmmoForSlot) {
            const slots = ['weapon', 'offhand', 'weapon2', 'ring2'];
            for (const slot of slots) {
                const item = Game.player.equipments[slot];
                if (item && item.weaponId === this._equippedItem.weaponId) {
                    Game.player._initAmmoForSlot(slot);
                }
            }
        }
    },

    // 获取某武器的改造配置（无配置时返回 null，不再回退到 PKM 配置）
    _getCraftConfig(weaponId) {
        return this._WEAPON_CRAFT_CONFIGS[weaponId] || null;
    },
}

export { CraftSystem };
