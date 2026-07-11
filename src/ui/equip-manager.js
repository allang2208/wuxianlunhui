        // Item Tooltip System v2 - Cache Bust
import { FloatingTextEffect } from '../effects/floating-text.js';
import { EquipDataManager } from './equip-data-manager.js';
import { BackpackDialogManager } from './backpack-dialog-manager.js';
import { EquipTooltipManager } from './equip-tooltip-manager.js';
import { EventBus } from '../core/event-bus.js';
import { isOneHanded, isTwoHanded } from '../config/gun-ammo.js';
import { CraftSystem } from './craft-system.js';
        export const EquipManager = {
            async init(player) {
                this.player = player;
                // 初始化背包数组
                if (!this.backpackItems || this.backpackItems.length === 0) {
                    this.backpackItems = JSON.parse(JSON.stringify(EquipDataManager.TEST_BACKPACK_ITEMS));
                }
                // 深拷贝 TEST_EQUIPMENTS，避免多个玩家共享引用
                if (player.equipments) {
                    const copy = JSON.parse(JSON.stringify(EquipDataManager.TEST_EQUIPMENTS));
                    Object.assign(player.equipments, copy);
                    // 初始化槽位验证：双手武器不能放在副手栏
                    ['offhand', 'ring2'].forEach(slot => {
                        const item = player.equipments[slot];
                        if (item && item.isTwoHanded) {
                            const used = new Set(this.backpackItems.map(i => i.slot));
                            let freeSlot = 0;
                            while (used.has(freeSlot) && freeSlot < this.maxBackpackSlots) freeSlot++;
                            if (freeSlot < this.maxBackpackSlots) {
                                const clone = JSON.parse(JSON.stringify(item));
                                clone.slot = freeSlot;
                                this.backpackItems.push(clone);
                            }
                            player.equipments[slot] = null;
                        }
                    });
                }
                // 加载 weapon2 槽的武器状态
                const w2 = player.equipments && player.equipments.weapon2;
                if (w2 && w2.bowFrames) {
                    const frames = [];
                    for (let i = 0; i < w2.bowFrames.length; i++) {
                        const img = new Image(); img.src = w2.bowFrames[i]; frames.push(img);
                    }
                    player.equippedBowFrames = frames;
                    player.equippedRangedType = 'bow';
                } else if (w2 && w2.weaponAsset && w2.weaponAsset.framePrefix) {
                    // 从 weaponAsset 加载弓帧动画
                    const frames = [];
                    const startFrame = w2.weaponAsset.startFrame || 1;
                    for (let i = 0; i < w2.weaponAsset.frameCount; i++) {
                        const num = String(startFrame + i).padStart(w2.weaponAsset.framePad || 2, '0');
                        const img = new Image(); img.src = w2.weaponAsset.framePrefix + num + '.png'; frames.push(img);
                    }
                    player.equippedBowFrames = frames;
                    player.equippedRangedType = 'bow';
                } else if (w2 && (w2.rangedType === 'pistol' || w2.weaponType === 'pistol')) {
                    player.equippedRangedType = 'pistol';
                } else if (w2 && w2.weaponType === 'pkm') {
                    player.equippedRangedType = 'pkm';
                } else if (w2 && w2.weaponType === 'akm') {
                    player.equippedRangedType = 'akm';
                } else if (w2 && w2.weaponType === 'qbz191') {
                    player.equippedRangedType = 'qbz191';
                }
                // 同步当前武器栏的近战武器贴图
                const currentWeapon = player.equipments[player.weaponMode];
                if (currentWeapon && currentWeapon.equipImage) {
                    player.meleeImage.src = currentWeapon.equipImage;
                }
                // 应用当前装备的技能覆盖
                if (player._applySkillOverrides) {
                    player._applySkillOverrides(currentWeapon);
                }
                // ===== FIX 1: 先创建背包格子，再更新显示 =====
                const grid = document.getElementById('inventoryGrid');
                if (grid && grid.children.length === 0) {
                    for (let i = 0; i < this.maxBackpackSlots; i++) {
                        const cell = document.createElement('div');
                        cell.className = 'inv-cell';
                        cell.dataset.slot = i;
                        grid.appendChild(cell);
                    }
                }
                EquipTooltipManager.init({
                    player: this.player,
                    backpackItems: this.backpackItems,
                    unequip: (key) => this.unequip(key),
                    equipFromBackpack: (idx) => this.equipFromBackpack(idx),
                    showSplitDialog: (item, idx) => BackpackDialogManager._showSplitDialog(item, idx),
                    triggerEquipFlash: (slot) => this.triggerEquipFlash(slot),
                    triggerBackpackFlash: (idx) => this.triggerBackpackFlash(idx)
                });
                EquipTooltipManager.bindEquipTooltip();
                this._syncWeaponVisual();
                EquipTooltipManager.bindInventoryTooltip();
                // 内联 DragDropManager 定义，绕过 Vite 模块缓存问题
                this._dragDropManager = {
                    player: null,
                    backpackItems: null,
                    callbacks: {},
                    _dragSrc: null,
                    _dropHandled: false,

                    init(options) {
                        this.player = options.player || null;
                        // 使用 getter/setter 确保始终访问 EquipManager.backpackItems，避免 filter 重新赋值导致引用断裂
                        Object.defineProperty(this, 'backpackItems', {
                            get() { return EquipManager.backpackItems; },
                            set(v) { EquipManager.backpackItems = v; }
                        });
                        this.callbacks = {
                            updateEquipSlots: options.updateEquipSlots || (() => {}),
                            updateInventorySlots: options.updateInventorySlots || (() => {}),
                            triggerEquipFlash: options.triggerEquipFlash || (() => {}),
                            triggerBackpackFlash: options.triggerBackpackFlash || (() => {}),
                            clearWeaponState: options.clearWeaponState || (() => {}),
                            syncWeaponVisual: options.syncWeaponVisual || (() => {}),
                            showBackpackFullNotice: options.showBackpackFullNotice || (() => {})
                        };
                    },

                    setupDragAndDrop() {
                        this._dragSrc = null;
                        const equipGrid = document.querySelector('.equip-grid');
                        if (equipGrid) {
                            equipGrid.ondragover = function(e) { e.preventDefault(); };
                            equipGrid.ondragenter = function(e) {
                                const slot = e.target.closest('.diablo-slot');
                                if (slot) slot.classList.add('drag-over');
                            };
                            equipGrid.ondragleave = function(e) {
                                const slot = e.target.closest('.diablo-slot');
                                if (slot && !slot.contains(e.relatedTarget)) slot.classList.remove('drag-over');
                            };
                            const self = this;
                            equipGrid.ondrop = function(e) {
                                e.preventDefault();
                                e.stopPropagation();
                                const slot = e.target.closest('.diablo-slot');
                                document.querySelectorAll('.equip-grid .diablo-slot').forEach(s => s.classList.remove('drag-over'));
                                self._dropHandled = true;
                                if (!slot) return;
                                const src = self._dragSrc;
                                if (!src || src.slot === slot.dataset.slot) return;
                                self.handleDrop(src, 'equip', slot.dataset.slot);
                                self._dragSrc = null;
                            };
                        }
                        document.querySelectorAll('.diablo-slot, .inv-cell').forEach(cell => {
                            this.bindDragToCell(cell);
                        });
                        this.bindCanvasDiscard();
                    },

                    _doDiscard() {
                        const src = this._dragSrc;
                        if (!src || !Game.player) return false;
                        console.log(`[EquipManager._doDiscard] src.type=${src.type}, src.slot=${src.slot}`);
                        // 改造槽拖出：归还装备到背包/装备栏，不是丢弃
                        if (src.type === 'craft') {
                            if (CraftSystem._equippedItem) {
                                CraftSystem._returnEquippedItem();
                                CraftSystem._updateUI();
                            }
                            return true;
                        }
                        // 附魔栏拖出：归还物品到背包
                        if (src.type === 'enchantScroll') {
                            console.log(`[EquipManager._doDiscard] returning enchant scroll to backpack`);
                            EventBus.emit('enchant:returnScrollItem');
                            EventBus.emit('enchant:updateUI');
                            return true;
                        }
                        if (src.type === 'enchantEquip') {
                            console.log(`[EquipManager._doDiscard] returning enchant equip to backpack`);
                            EventBus.emit('enchant:returnEquipItem');
                            EventBus.emit('enchant:updateUI');
                            return true;
                        }
                        let item = null;
                        if (src.type === 'inventory') {
                            const idx = parseInt(src.slot);
                            item = EquipManager.backpackItems.find(i => i.slot === idx);
                            if (item) {
                                const removeIdx = EquipManager.backpackItems.findIndex(i => i.slot === idx);
                                if (removeIdx !== -1) EquipManager.backpackItems.splice(removeIdx, 1);
                            }
                        } else if (src.type === 'equip') {
                            item = Game.player.equipments[src.slot];
                            if (item) {
                                Game.player.equipments[src.slot] = null;
                                this.callbacks.clearWeaponState(src.slot);
                                if (src.slot === Game.player.weaponMode && Game.player._clearSkillOverrides) {
                                    Game.player._clearSkillOverrides();
                                    if (typeof SkillManager !== 'undefined' && SkillManager.renderSkillGrid) {
                                        SkillManager.renderSkillGrid();
                                    }
                                }
                            }
                        }
                        if (item) {
                            const dropDist = 60 + Math.random() * 40;
                            const dropAngle = Game.player.rotation + (Math.random() - 0.5) * 0.5;
                            const dropX = Game.player.x + Math.cos(dropAngle) * dropDist;
                            const dropY = Game.player.y + Math.sin(dropAngle) * dropDist;
                            if (item.category === 'gold') {
                                item._droppedByPlayer = true;
                                item._wasOutOfRange = false;
                            }
                            Game.dropItem(dropX, dropY, item);
                            EffectManager.add(new FloatingTextEffect(Game.player.x, Game.player.y - 30, '已丢弃: ' + item.name));
                            this.callbacks.updateEquipSlots();
                            this.callbacks.updateInventorySlots();
                            this._dragSrc = null;
                            return true;
                        }
                        return false;
                    },

                    _isInGameArea(clientX) {
                        const panel = document.getElementById('systemPanel');
                        if (!panel || !panel.classList.contains('active')) return true;
                        const panelLeft = window.innerWidth * 0.55;
                        if (clientX >= panelLeft) return false;
                        // 附魔栏打开时，附魔栏区域也不视为丢弃区域
                        const enchantPanel = document.getElementById('enchantPanel');
                        if (enchantPanel && enchantPanel.classList.contains('active')) {
                            // enchantPanel is at right: 45vw, width: 380px
                            // enchant panel is in the left side from clientX perspective? No, it's on the right
                            // The enchant panel is at right: 45vw, which means it's from (100vw - 45vw - 380px) to (100vw - 45vw)
                            // Actually the enchant panel is: right: 45vw, width: 380px
                            // So it occupies from (window.innerWidth - 45vw - 380px) to (window.innerWidth - 45vw)
                            // Wait, let me check the CSS. The enchant panel is at right: 45vw, width: 380px
                            // In CSS: .enchant-panel { right: 45vw; width: 380px; }
                            // So its left edge is at: window.innerWidth - 0.45*window.innerWidth - 380
                            // = 0.55*window.innerWidth - 380
                            // But since the panel is at right: 45vw (fixed positioning), the left edge is:
                            // window.innerWidth - (0.45 * window.innerWidth) - 380
                            // Hmm, actually CSS right: 45vw means the right edge is 45vw from the right
                            // So the right edge is at: window.innerWidth - 0.45*window.innerWidth = 0.55*window.innerWidth
                            // And the left edge is at: 0.55*window.innerWidth - 380
                            const enchantRight = window.innerWidth * 0.55;
                            const enchantLeft = enchantRight - 380;
                            if (clientX >= enchantLeft && clientX <= enchantRight) return false;
                        }
                        return true;
                    },

                    bindCanvasDiscard() {
                        const self = this;
                        const canvas = document.getElementById('gameCanvas');
                        if (canvas) {
                            canvas.ondragover = function(e) { e.preventDefault(); };
                            canvas.ondrop = function(e) {
                                e.preventDefault();
                                self._dropHandled = true;
                                self._doDiscard();
                            };
                        }
                        const overlay = document.getElementById('panelOverlay');
                        if (overlay) {
                            overlay.ondragover = function(e) { e.preventDefault(); };
                            overlay.ondrop = function(e) {
                                e.preventDefault();
                                self._dropHandled = true;
                                self._doDiscard();
                            };
                        }
                        const panel = document.getElementById('systemPanel');
                        if (panel) {
                            panel.ondragover = function(e) { e.preventDefault(); };
                            panel.ondrop = function(e) {
                                e.preventDefault();
                                self._dropHandled = true;
                            };
                        }
                        const uiLayer = document.getElementById('uiLayer');
                        if (uiLayer) {
                            uiLayer.ondragover = function(e) { e.preventDefault(); };
                            uiLayer.ondrop = function(e) {
                                e.preventDefault();
                                self._dropHandled = true;
                            };
                        }
                        document.querySelectorAll('.equip-panel, .inventory-panel, .tabs, .panel-header, .panel-footer, .diablo-paperdoll, .equip-slot-group, .inv-grid').forEach(el => {
                            el.ondragover = function(e) { e.preventDefault(); };
                            el.ondrop = function(e) {
                                e.preventDefault();
                                self._dropHandled = true;
                            };
                        });
                        document.addEventListener('dragover', function _discardAllowDrop(e) {
                            if (self._dragSrc) e.preventDefault();
                        });
                    },

                    bindDragToCell(cell) {
                        const self = this;
                        cell.ondragstart = function(e) {
                            self._dragSrc = {
                                type: cell.classList.contains('inv-cell') ? 'inventory' : 'equip',
                                slot: cell.dataset.slot
                            };
                            self._dropHandled = false;
                            e.dataTransfer.setData('text/plain', cell.dataset.slot);
                            e.dataTransfer.effectAllowed = 'move';
                            cell.classList.add('dragging');
                            const tooltip = document.getElementById('equipTooltip');
                            if (tooltip) {
                                tooltip.classList.remove('visible', 'pinned');
                                tooltip._pinned = false;
                            }
                            // 消耗品：设置拖拽图像快照后隐藏面板，方便拖到快捷栏
                            const draggedItem = cell.classList.contains('inv-cell')
                                ? self.backpackItems.find(i => i.slot === parseInt(cell.dataset.slot))
                                : self.player.equipments[cell.dataset.slot];
                            if (draggedItem && draggedItem.category === 'consumable') {
                                // 用当前格子作为拖拽图像（快照，不受后续 DOM 变化影响）
                                e.dataTransfer.setDragImage(cell, cell.offsetWidth / 2, cell.offsetHeight / 2);
                                // 延迟隐藏面板，确保快照已捕获
                                requestAnimationFrame(() => {
                                    const panel = document.getElementById('systemPanel');
                                    const overlay = document.getElementById('panelOverlay');
                                    if (panel) {
                                        panel.dataset._wasDisplay = panel.style.display || '';
                                        panel.style.display = 'none';
                                    }
                                    if (overlay) {
                                        overlay.dataset._wasDisplay2 = overlay.style.display || '';
                                        overlay.style.display = 'none';
                                    }
                                });
                            }
                        };
                        cell.ondragend = function(e) {
                            cell.classList.remove('dragging');
                            document.querySelectorAll('.inv-cell, .diablo-slot').forEach(s => s.classList.remove('drag-over'));
                            if (!self._dropHandled && self._dragSrc && self._isInGameArea(e.clientX)) {
                                self._doDiscard();
                            }
                            self._dropHandled = false;
                            self._dragSrc = null;
                            // 恢复面板和覆盖层
                            const panel = document.getElementById('systemPanel');
                            const overlay = document.getElementById('panelOverlay');
                            if (panel) {
                                panel.style.display = panel.dataset._wasDisplay || '';
                                delete panel.dataset._wasDisplay;
                            }
                            if (overlay) {
                                overlay.style.display = overlay.dataset._wasDisplay2 || '';
                                delete overlay.dataset._wasDisplay2;
                            }
                        };
                        cell.ondragover = function(e) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'move';
                        };
                        cell.ondragenter = function(e) {
                            cell.classList.add('drag-over');
                        };
                        cell.ondragleave = function(e) {
                            cell.classList.remove('drag-over');
                        };
                        cell.ondrop = function(e) {
                            e.preventDefault();
                            if (!cell.classList.contains('inv-cell')) {
                                cell.classList.remove('drag-over');
                                return;
                            }
                            e.stopPropagation();
                            cell.classList.remove('drag-over');
                            self._dropHandled = true;
                            const src = self._dragSrc;
                            if (!src || src.slot === cell.dataset.slot) return;
                            self.handleDrop(src, 'inventory', cell.dataset.slot);
                            self._dragSrc = null;
                        };
                    },

                    handleDrop(src, targetType, targetSlot) {
                        if (!src || !targetType) return;
                        
                        // 附魔槽 → 背包/装备栏：退回物品
                        if (src.type === 'enchantScroll' || src.type === 'enchantEquip') {
                            if (src.type === 'enchantScroll') {
                                EventBus.emit('enchant:returnScrollItem');
                            } else {
                                EventBus.emit('enchant:returnEquipItem');
                            }
                            EventBus.emit('enchant:updateUI');
                            return;
                        }
                        if (src.type === 'inventory' && targetType === 'inventory') {
                            const sIdx = parseInt(src.slot), tIdx = parseInt(targetSlot);
                            if (isNaN(sIdx) || isNaN(tIdx) || sIdx === tIdx) return;
                            const sItem = EquipManager.backpackItems.find(i => i.slot === sIdx);
                            const tItem = EquipManager.backpackItems.find(i => i.slot === tIdx);
                            if (sItem) sItem.slot = tIdx;
                            if (tItem) tItem.slot = sIdx;
                            this.callbacks.updateInventorySlots(); return;
                        }
                        // 改造槽 → 背包：卸下到指定背包格子
                        if (src.type === 'craft' && targetType === 'inventory') {
                            const tIdx = parseInt(targetSlot);
                            const item = CraftSystem._equippedItem;
                            if (!item) return;
                            const bpItem = EquipManager.backpackItems.find(i => i.slot === tIdx);
                            if (bpItem) {
                                // 目标格子有物品，尝试放入第一个空位
                                const emptySlot = EquipManager._findFirstEmptySlot ? EquipManager._findFirstEmptySlot() : -1;
                                if (emptySlot === -1) return; // 背包满，无法卸下
                                CraftSystem._equippedItem = null;
                                CraftSystem._equippedSlot = null;
                                const clone = JSON.parse(JSON.stringify(item));
                                clone.slot = emptySlot;
                                EquipManager.backpackItems.push(clone);
                                this.callbacks.updateInventorySlots();
                                CraftSystem._updateUI();
                                return;
                            }
                            CraftSystem._equippedItem = null;
                            CraftSystem._equippedSlot = null;
                            const clone = JSON.parse(JSON.stringify(item));
                            clone.slot = tIdx;
                            EquipManager.backpackItems.push(clone);
                            this.callbacks.updateInventorySlots();
                            CraftSystem._updateUI();
                            return;
                        }
                        // 改造槽 → 装备栏：直接装备到指定栏位
                        if (src.type === 'craft' && targetType === 'equip') {
                            const eKey = targetSlot;
                            const item = CraftSystem._equippedItem;
                            if (!item) return;
                            const isWeaponSlot = (eKey === 'weapon' || eKey === 'weapon2');
                            const isOffhandSlot = (eKey === 'offhand' || eKey === 'ring2');
                            const isWeaponItem = item.weaponType || (item.category && item.category.includes('weapon')) || item.rangedType;
                            if (isWeaponItem && !isWeaponSlot && !isOffhandSlot) return;
                            if (isWeaponSlot && !isWeaponItem) return;
                            if (!isWeaponSlot && !isOffhandSlot && item.equipSlot !== eKey) return;
                            if (item.isTwoHanded && isOffhandSlot) return;
                            CraftSystem._equippedItem = null;
                            CraftSystem._equippedSlot = null;
                            const cur = this.player.equipments[eKey];
                            if (cur && cur.name) {
                                const usedSlots = new Set(EquipManager.backpackItems.map(i => i.slot));
                                let slot = 0; while (usedSlots.has(slot) && slot < this.maxBackpackSlots) slot++;
                                if (slot < this.maxBackpackSlots) {
                                    const oldClone = JSON.parse(JSON.stringify(cur));
                                    oldClone.slot = slot;
                                    EquipManager.backpackItems.push(oldClone);
                                }
                            }
                            this.player.equipments[eKey] = JSON.parse(JSON.stringify(item));
                            if (eKey === this.player.weaponMode && this.player._applySkillOverrides) {
                                this.player._applySkillOverrides(item);
                                if (typeof SkillManager !== 'undefined' && SkillManager.renderSkillGrid) {
                                    SkillManager.renderSkillGrid();
                                }
                            }
                            if (eKey === 'weapon' || eKey === 'weapon2') {
                                if (item.bowFrames || (item.weaponAsset && item.weaponAsset.framePrefix)) {
                                    const frames = [];
                                    if (item.bowFrames) {
                                        for (let i = 0; i < item.bowFrames.length; i++) { const im = new Image(); im.src = item.bowFrames[i]; frames.push(im); }
                                    } else if (item.weaponAsset && item.weaponAsset.framePrefix) {
                                        const startFrame = item.weaponAsset.startFrame || 1;
                                        for (let i = 0; i < item.weaponAsset.frameCount; i++) {
                                            const num = String(startFrame + i).padStart(item.weaponAsset.framePad || 2, '0');
                                            const im = new Image(); im.src = item.weaponAsset.framePrefix + num + '.png'; frames.push(im);
                                        }
                                    }
                                    this.player.equippedBowFrames = frames;
                                    this.player.equippedRangedType = 'bow';
                                } else if (item.weaponType === 'pistol' || item.rangedType === 'pistol') {
                                    this.player.equippedRangedType = 'pistol';
                                    if (item.equipImage) {
                                        this.player.pistolImage = new Image();
                                        this.player.pistolImage.src = item.equipImage;
                                    }
                                    if (item.weaponAsset && item.weaponAsset.muzzleImage) {
                                        this.player.muzzleFlashImg = new Image();
                                        this.player.muzzleFlashImg.src = item.weaponAsset.muzzleImage;
                                    }
                                } else if (item.category === 'weapon_melee' || item.weaponType === 'sword') {
                                    this.player.hasMeleeWeapon = true;
                                }
                                this.player.weaponAnim.nextSpin = Date.now() + 150;
                                this.callbacks.syncWeaponVisual();
                            }
                            this.callbacks.updateEquipSlots(); this.callbacks.updateInventorySlots();
                            CraftSystem._updateUI();
                            return;
                        }
                        if (src.type === 'inventory' && targetType === 'equip') {
                            const sIdx = parseInt(src.slot);
                            const item = this.backpackItems.find(i => i.slot === sIdx);
                            if (!item) return;
                            const isWeaponSlot = (targetSlot === 'weapon' || targetSlot === 'weapon2');
                            const isOffhandSlot = (targetSlot === 'offhand' || targetSlot === 'ring2');
                            const isWeaponItem = item.weaponType || (item.category && item.category.includes('weapon')) || item.rangedType;
                            if (isWeaponItem && !isWeaponSlot && !isOffhandSlot) return;
                            if (isWeaponSlot && !isWeaponItem) return;
                            // 盾类只能装备到副手栏
                            if (item.weaponType === 'shield' && !isOffhandSlot) return;
                            // 双手武器不能装备到副手栏
                            if (item.isTwoHanded && isOffhandSlot) return;
                            if (!isWeaponSlot && !isOffhandSlot && item.equipSlot !== targetSlot) return;
                            if (item.isTwoHanded && isOffhandSlot) return;
                            const cur = this.player.equipments[targetSlot];
                            const removeIdx = this.backpackItems.findIndex(i => i.slot === sIdx);
                            if (removeIdx !== -1) this.backpackItems.splice(removeIdx, 1);
                            if (cur && cur.name) {
                                const oldClone = JSON.parse(JSON.stringify(cur));
                                oldClone.slot = sIdx;
                                this.backpackItems.push(oldClone);
                            }
                            // ===== 双手武器与副手栏互斥逻辑 =====
                            // 1. 如果装备到 weapon 栏且是双手武器 → 卸下 offhand
                            if (item.isTwoHanded && targetSlot === 'weapon') {
                                const offItem = this.player.equipments['offhand'];
                                if (offItem && offItem.name) {
                                    const oldClone = JSON.parse(JSON.stringify(offItem));
                                    const used = new Set(this.backpackItems.map(i => i.slot));
                                    let freeSlot = 0; while (used.has(freeSlot) && freeSlot < this.maxBackpackSlots) freeSlot++;
                                    oldClone.slot = freeSlot;
                                    this.backpackItems.push(oldClone);
                                    this.player.equipments['offhand'] = null;
                                    this.callbacks.clearWeaponState('offhand');
                                    if ('offhand' === this.player.weaponMode && this.player._clearSkillOverrides) {
                                        this.player._clearSkillOverrides();
                                    }
                                }
                            }
                            // 1b. 如果装备到 weapon2 栏且是双手武器 → 卸下 ring2
                            if (item.isTwoHanded && targetSlot === 'weapon2') {
                                const offItem = this.player.equipments['ring2'];
                                if (offItem && offItem.name) {
                                    const oldClone = JSON.parse(JSON.stringify(offItem));
                                    const used = new Set(this.backpackItems.map(i => i.slot));
                                    let freeSlot = 0; while (used.has(freeSlot) && freeSlot < this.maxBackpackSlots) freeSlot++;
                                    oldClone.slot = freeSlot;
                                    this.backpackItems.push(oldClone);
                                    this.player.equipments['ring2'] = null;
                                    this.callbacks.clearWeaponState('ring2');
                                    if ('ring2' === this.player.weaponMode && this.player._clearSkillOverrides) {
                                        this.player._clearSkillOverrides();
                                    }
                                }
                            }
                            // 2. 如果装备到 offhand → 检查 weapon 是否有双手武器
                            if (targetSlot === 'offhand') {
                                const wItem = this.player.equipments['weapon'];
                                if (wItem && wItem.isTwoHanded) {
                                    const oldClone = JSON.parse(JSON.stringify(wItem));
                                    const used = new Set(this.backpackItems.map(i => i.slot));
                                    let freeSlot = 0; while (used.has(freeSlot) && freeSlot < this.maxBackpackSlots) freeSlot++;
                                    oldClone.slot = freeSlot;
                                    this.backpackItems.push(oldClone);
                                    this.player.equipments['weapon'] = null;
                                    this.callbacks.clearWeaponState('weapon');
                                    if ('weapon' === this.player.weaponMode && this.player._clearSkillOverrides) {
                                        this.player._clearSkillOverrides();
                                    }
                                }
                            }
                            // 2b. 如果装备到 ring2 → 检查 weapon2 是否有双手武器
                            if (targetSlot === 'ring2') {
                                const wItem = this.player.equipments['weapon2'];
                                if (wItem && wItem.isTwoHanded) {
                                    const oldClone = JSON.parse(JSON.stringify(wItem));
                                    const used = new Set(this.backpackItems.map(i => i.slot));
                                    let freeSlot = 0; while (used.has(freeSlot) && freeSlot < this.maxBackpackSlots) freeSlot++;
                                    oldClone.slot = freeSlot;
                                    this.backpackItems.push(oldClone);
                                    this.player.equipments['weapon2'] = null;
                                    this.callbacks.clearWeaponState('weapon2');
                                    if ('weapon2' === this.player.weaponMode && this.player._clearSkillOverrides) {
                                        this.player._clearSkillOverrides();
                                    }
                                }
                            }
                            this.player.equipments[targetSlot] = JSON.parse(JSON.stringify(item));
                            if (targetSlot === this.player.weaponMode && this.player._applySkillOverrides) {
                                this.player._applySkillOverrides(item);
                                if (typeof SkillManager !== 'undefined' && SkillManager.renderSkillGrid) {
                                    SkillManager.renderSkillGrid();
                                }
                            }
                            if (targetSlot === 'weapon' || targetSlot === 'weapon2') {
                                if (item.bowFrames || (item.weaponAsset && item.weaponAsset.framePrefix)) {
                                    const frames = [];
                                    if (item.bowFrames) {
                                        for (let i = 0; i < item.bowFrames.length; i++) { const im = new Image(); im.src = item.bowFrames[i]; frames.push(im); }
                                    } else if (item.weaponAsset && item.weaponAsset.framePrefix) {
                                        const startFrame = item.weaponAsset.startFrame || 1;
                                        for (let i = 0; i < item.weaponAsset.frameCount; i++) {
                                            const num = String(startFrame + i).padStart(item.weaponAsset.framePad || 2, '0');
                                            const im = new Image(); im.src = item.weaponAsset.framePrefix + num + '.png'; frames.push(im);
                                        }
                                    }
                                    this.player.equippedBowFrames = frames;
                                    this.player.equippedRangedType = 'bow';
                                } else if (item.weaponType === 'pistol' || item.rangedType === 'pistol') {
                                    this.player.equippedRangedType = 'pistol';
                                    if (item.equipImage) {
                                        this.player.pistolImage = new Image();
                                        this.player.pistolImage.src = item.equipImage;
                                    }
                                    if (item.weaponAsset && item.weaponAsset.muzzleImage) {
                                        this.player.muzzleFlashImg = new Image();
                                        this.player.muzzleFlashImg.src = item.weaponAsset.muzzleImage;
                                    }
                                } else if (item.category === 'weapon_melee' || item.weaponType === 'sword') {
                                    this.player.hasMeleeWeapon = true;
                                }
                                this.player.weaponAnim.nextSpin = Date.now() + 150;
                                this.callbacks.syncWeaponVisual();
                            }
                            this.callbacks.updateEquipSlots(); this.callbacks.updateInventorySlots();
                            this.callbacks.triggerEquipFlash(targetSlot);
                            if (cur && cur.name) {
                                this.callbacks.triggerBackpackFlash(sIdx);
                            }
                            return;
                        }
                        if (src.type === 'equip' && targetType === 'inventory') {
                            const eKey = src.slot, tIdx = parseInt(targetSlot);
                            const existing = this.player.equipments[eKey];
                            if (!existing) return;
                            const bpItem = this.backpackItems.find(i => i.slot === tIdx);
                            if (bpItem && bpItem.equipSlot === eKey) {
                                const oldClone = JSON.parse(JSON.stringify(existing));
                                oldClone.slot = tIdx;
                                this.player.equipments[eKey] = bpItem;
                                bpItem.slot = -1;
                                const removeIdx = this.backpackItems.findIndex(i => i.slot === tIdx);
                                if (removeIdx !== -1) this.backpackItems.splice(removeIdx, 1);
                                this.backpackItems.push(oldClone);
                                if (eKey === 'weapon2' && bpItem.weaponAsset) this.player.loadWeaponAssets(bpItem);
                                if (eKey === 'weapon' || eKey === 'weapon2') this.callbacks.syncWeaponVisual();
                                if (this.player._applySkillOverrides) {
                                    this.player._applySkillOverrides(bpItem);
                                }
                            } else {
                                // 卸下到背包：目标格子必须为空，否则会删除已有物品
                                if (bpItem) return;
                                const removeIdx = this.backpackItems.findIndex(i => i.slot === tIdx);
                                if (removeIdx !== -1) this.backpackItems.splice(removeIdx, 1);
                                const clone = JSON.parse(JSON.stringify(existing));
                                clone.slot = tIdx;
                                clone.backpackSlot = tIdx;
                                this.backpackItems.push(clone);
                                this.player.equipments[eKey] = null;
                                this.callbacks.clearWeaponState(eKey);
                                if (eKey === this.player.weaponMode && this.player._clearSkillOverrides) {
                                    this.player._clearSkillOverrides();
                                }
                                // 同步特殊攻击图标（检查所有武器槽）
                                QuickBar.refreshSpecialAttack(this.player);
                            }
                            this.callbacks.updateEquipSlots(); this.callbacks.updateInventorySlots();
                            this.callbacks.triggerEquipFlash(eKey);
                            this.callbacks.triggerBackpackFlash(tIdx);
                            return;
                        }
                        if (src.type === 'equip' && targetType === 'equip') {
                            const sKey = src.slot, tKey = targetSlot;
                            if (sKey === tKey) return;
                            const sItem = this.player.equipments[sKey];
                            const tItem = this.player.equipments[tKey];
                            if (!sItem && !tItem) return;
                            if (!this._canEquipSlot(sItem, tKey)) return;
                            if (!this._canEquipSlot(tItem, sKey)) return;
                            this.player.equipments[sKey] = tItem || null;
                            this.player.equipments[tKey] = sItem || null;
                            if (this.player._applySkillOverrides) {
                                const activeItem = this.player.equipments[this.player.weaponMode];
                                this.player._applySkillOverrides(activeItem);
                            }
                            if (sKey === 'weapon' || sKey === 'weapon2' || tKey === 'weapon' || tKey === 'weapon2') {
                                this.callbacks.syncWeaponVisual();
                            }
                            if ((tKey === 'weapon' || tKey === 'weapon2') && sItem && sItem.weaponAsset) this.player.loadWeaponAssets(sItem);
                            EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 20, `已交换: ${sItem.name} ↔ ${tItem ? tItem.name : '空'}`, '#d4c5a9'));
                            this.callbacks.updateEquipSlots();
                            this.callbacks.triggerEquipFlash(sKey);
                            this.callbacks.triggerEquipFlash(tKey);
                            return;
                        }
                        if (src.type === 'sell' && targetType === 'inventory') {
                            const sellIndex = parseInt(src.slot);
                            const sellItem = ShopSystem._selectedSellItems[sellIndex];
                            if (!sellItem) return;
                            const tIdx = parseInt(targetSlot);
                            const bpItem = this.backpackItems.find(i => i.slot === tIdx);
                            if (bpItem) {
                                ShopSystem._selectedSellItems[sellIndex] = { item: JSON.parse(JSON.stringify(bpItem)), source: 'backpack', bpIndex: tIdx };
                                const removeIdx = this.backpackItems.findIndex(i => i.slot === tIdx);
                                if (removeIdx !== -1) this.backpackItems.splice(removeIdx, 1);
                            } else {
                                ShopSystem._selectedSellItems.splice(sellIndex, 1);
                            }
                            const clone = JSON.parse(JSON.stringify(sellItem.item));
                            clone.slot = tIdx;
                            this.backpackItems.push(clone);
                            this.callbacks.updateInventorySlots();
                            ShopSystem._updateUI();
                            this.callbacks.triggerBackpackFlash(tIdx);
                            return;
                        }
                        if (src.type === 'sell' && targetType === 'equip') {
                            const sellIndex = parseInt(src.slot);
                            const sellItem = ShopSystem._selectedSellItems[sellIndex];
                            if (!sellItem) return;
                            const item = sellItem.item;
                            const eKey = targetSlot;
                            const isWeaponSlot = (eKey === 'weapon' || eKey === 'weapon2');
                            const isOffhandSlot = (eKey === 'offhand' || eKey === 'ring2');
                            const isWeaponItem = item.weaponType || (item.category && item.category.includes('weapon')) || item.rangedType;
                            if (isWeaponItem && !isWeaponSlot && !isOffhandSlot) return;
                            if (isWeaponSlot && !isWeaponItem) return;
                            // 盾类只能装备到副手栏
                            if (item.weaponType === 'shield' && !isOffhandSlot) return;
                            if (!isWeaponSlot && !isOffhandSlot && item.equipSlot !== eKey) return;
                            if (item.isTwoHanded && isOffhandSlot) return;
                            const cur = this.player.equipments[eKey];
                            if (cur && cur.name) {
                                const usedSlots = new Set(this.backpackItems.map(i => i.slot));
                                let slot = 0;
                                while (usedSlots.has(slot) && slot < 36) slot++;
                                if (slot < 36) {
                                    const oldClone = JSON.parse(JSON.stringify(cur));
                                    oldClone.slot = slot;
                                    this.backpackItems.push(oldClone);
                                }
                            }
                            // ===== 双手武器与副手栏互斥逻辑（卖出栏 → 装备栏）=====
                            // 1. 如果装备到 weapon 栏且是双手武器 → 卸下 offhand
                            if (item.isTwoHanded && eKey === 'weapon') {
                                const offItem = this.player.equipments['offhand'];
                                if (offItem && offItem.name) {
                                    const used = new Set(this.backpackItems.map(i => i.slot));
                                    let freeSlot = 0; while (used.has(freeSlot) && freeSlot < this.maxBackpackSlots) freeSlot++;
                                    if (freeSlot < 36) {
                                        const oldClone = JSON.parse(JSON.stringify(offItem));
                                        oldClone.slot = freeSlot;
                                        this.backpackItems.push(oldClone);
                                    }
                                    this.player.equipments['offhand'] = null;
                                    this.callbacks.clearWeaponState('offhand');
                                    if ('offhand' === this.player.weaponMode && this.player._clearSkillOverrides) {
                                        this.player._clearSkillOverrides();
                                    }
                                }
                            }
                            // 1b. 如果装备到 weapon2 栏且是双手武器 → 卸下 ring2
                            if (item.isTwoHanded && eKey === 'weapon2') {
                                const offItem = this.player.equipments['ring2'];
                                if (offItem && offItem.name) {
                                    const used = new Set(this.backpackItems.map(i => i.slot));
                                    let freeSlot = 0; while (used.has(freeSlot) && freeSlot < this.maxBackpackSlots) freeSlot++;
                                    if (freeSlot < 36) {
                                        const oldClone = JSON.parse(JSON.stringify(offItem));
                                        oldClone.slot = freeSlot;
                                        this.backpackItems.push(oldClone);
                                    }
                                    this.player.equipments['ring2'] = null;
                                    this.callbacks.clearWeaponState('ring2');
                                    if ('ring2' === this.player.weaponMode && this.player._clearSkillOverrides) {
                                        this.player._clearSkillOverrides();
                                    }
                                }
                            }
                            // 2. 如果装备到 offhand → 检查 weapon 是否有双手武器
                            if (eKey === 'offhand') {
                                const wItem = this.player.equipments['weapon'];
                                if (wItem && wItem.isTwoHanded) {
                                    const used = new Set(this.backpackItems.map(i => i.slot));
                                    let freeSlot = 0; while (used.has(freeSlot) && freeSlot < this.maxBackpackSlots) freeSlot++;
                                    if (freeSlot < 36) {
                                        const oldClone = JSON.parse(JSON.stringify(wItem));
                                        oldClone.slot = freeSlot;
                                        this.backpackItems.push(oldClone);
                                    }
                                    this.player.equipments['weapon'] = null;
                                    this.callbacks.clearWeaponState('weapon');
                                    if ('weapon' === this.player.weaponMode && this.player._clearSkillOverrides) {
                                        this.player._clearSkillOverrides();
                                    }
                                }
                            }
                            // 2b. 如果装备到 ring2 → 检查 weapon2 是否有双手武器
                            if (eKey === 'ring2') {
                                const wItem = this.player.equipments['weapon2'];
                                if (wItem && wItem.isTwoHanded) {
                                    const used = new Set(this.backpackItems.map(i => i.slot));
                                    let freeSlot = 0; while (used.has(freeSlot) && freeSlot < this.maxBackpackSlots) freeSlot++;
                                    if (freeSlot < 36) {
                                        const oldClone = JSON.parse(JSON.stringify(wItem));
                                        oldClone.slot = freeSlot;
                                        this.backpackItems.push(oldClone);
                                    }
                                    this.player.equipments['weapon2'] = null;
                                    this.callbacks.clearWeaponState('weapon2');
                                    if ('weapon2' === this.player.weaponMode && this.player._clearSkillOverrides) {
                                        this.player._clearSkillOverrides();
                                    }
                                }
                            }
                            this.player.equipments[eKey] = JSON.parse(JSON.stringify(item));
                            if (eKey === this.player.weaponMode && this.player._applySkillOverrides) {
                                this.player._applySkillOverrides(item);
                                if (typeof SkillManager !== 'undefined' && SkillManager.renderSkillGrid) {
                                    SkillManager.renderSkillGrid();
                                }
                            }
                            if (eKey === 'weapon' || eKey === 'weapon2') {
                                if (item.bowFrames || (item.weaponAsset && item.weaponAsset.framePrefix)) {
                                    const frames = [];
                                    if (item.bowFrames) {
                                        for (let i = 0; i < item.bowFrames.length; i++) { const im = new Image(); im.src = item.bowFrames[i]; frames.push(im); }
                                    } else if (item.weaponAsset && item.weaponAsset.framePrefix) {
                                        const startFrame = item.weaponAsset.startFrame || 1;
                                        for (let i = 0; i < item.weaponAsset.frameCount; i++) {
                                            const num = String(startFrame + i).padStart(item.weaponAsset.framePad || 2, '0');
                                            const im = new Image(); im.src = item.weaponAsset.framePrefix + num + '.png'; frames.push(im);
                                        }
                                    }
                                    this.player.equippedBowFrames = frames;
                                    this.player.equippedRangedType = 'bow';
                                } else if (item.weaponType === 'pistol' || item.rangedType === 'pistol') {
                                    this.player.equippedRangedType = 'pistol';
                                    if (item.equipImage) {
                                        this.player.pistolImage = new Image();
                                        this.player.pistolImage.src = item.equipImage;
                                    }
                                    if (item.weaponAsset && item.weaponAsset.muzzleImage) {
                                        this.player.muzzleFlashImg = new Image();
                                        this.player.muzzleFlashImg.src = item.weaponAsset.muzzleImage;
                                    }
                                } else if (item.category === 'weapon_melee' || item.weaponType === 'sword') {
                                    this.player.hasMeleeWeapon = true;
                                }
                                this.player.weaponAnim.nextSpin = Date.now() + 150;
                                this.callbacks.syncWeaponVisual();
                            }
                            ShopSystem._selectedSellItems.splice(sellIndex, 1);
                            this.callbacks.updateEquipSlots(); this.callbacks.updateInventorySlots();
                            ShopSystem._updateUI();
                            this.callbacks.triggerEquipFlash(eKey);
                            return;
                        }
                    },

                    _canEquipSlot(item, slot) {
                        if (!item || !slot) return true;
                        const isWeaponSlot = (slot === 'weapon' || slot === 'weapon2');
                        const isOffhandSlot = (slot === 'offhand' || slot === 'ring2');
                        const isWeaponItem = item.weaponType || (item.category && item.category.includes('weapon')) || item.rangedType;
                        if (isWeaponItem && !isWeaponSlot && !isOffhandSlot) return false;
                        if (isWeaponSlot && !isWeaponItem) return false;
                        // 盾类只能装备到副手栏
                        if (item.weaponType === 'shield' && !isOffhandSlot) return false;
                        // 所有武器都可以装备到 offhand/ring2（副手武器槽），但双手武器除外
                        if (isOffhandSlot && isWeaponItem) {
                            if (item.isTwoHanded) return false;
                            return true;
                        }
                        if (!isWeaponSlot && !isOffhandSlot && item.equipSlot !== slot) return false;
                        return true;
                    }
                };
                this._dragDropManager.init({
                    player: this.player,
                    backpackItems: this.backpackItems,
                    updateEquipSlots: () => this.updateEquipSlots(),
                    updateInventorySlots: () => this.updateInventorySlots(),
                    triggerEquipFlash: (slot) => this.triggerEquipFlash(slot),
                    triggerBackpackFlash: (idx) => this.triggerBackpackFlash(idx),
                    clearWeaponState: (slot) => this._clearWeaponState(slot),
                    syncWeaponVisual: () => this._syncWeaponVisual(),
                    showBackpackFullNotice: () => BackpackDialogManager._showBackpackFullNotice()
                });
                this._dragDropManager.setupDragAndDrop();
                this.updateEquipSlots();
                this.updateInventorySlots();
                BackpackDialogManager.init({
                    backpackItems: this.backpackItems,
                    maxBackpackSlots: this.maxBackpackSlots,
                    addToBackpack: (item) => this.addToBackpack(item),
                    updateInventorySlots: () => this.updateInventorySlots(),
                    showBackpackFullNotice: () => BackpackDialogManager._showBackpackFullNotice()
                });
                // 初始化 GoldManager 引用和回调
                if (typeof GoldManager !== 'undefined') {
                    GoldManager.setBackpackRef(this.backpackItems);
                    GoldManager.setMaxBackpackSlots(this.maxBackpackSlots);
                    GoldManager.setCallbacks({
                        onUpdate: () => this.updateInventorySlots(),
                        onFull: () => BackpackDialogManager._showBackpackFullNotice()
                    });
                }
            },
            // 背包最大格子数（可通过装备/道具扩容）
            maxBackpackSlots: 10,

            // 查找背包第一个空位，返回 slot 索引，-1 表示满
            _findFirstEmptySlot() {
                const used = new Set(this.backpackItems.map(i => i.slot));
                let slot = 0;
                while (used.has(slot) && slot < this.maxBackpackSlots) slot++;
                return slot < this.maxBackpackSlots ? slot : -1;
            },

            // 触发装备动画
            triggerEquipFlash(slotKey) {
                if (!slotKey) return;
                const slot = document.querySelector(`.equip-grid .diablo-slot[data-slot="${slotKey}"]`);
                if (!slot) return;
                slot.classList.remove('equip-flash', 'equip-pop');
                void slot.offsetWidth; // 强制重绘，重置动画
                slot.classList.add('equip-flash');
                setTimeout(() => slot.classList.remove('equip-flash'), 650);
            },
            // === 触发背包格子动画 ===
            triggerBackpackFlash(slotIdx) {
                const cell = document.querySelector(`.gear-inventory-col .inv-cell[data-slot="${slotIdx}"]`);
                if (!cell) return;
                cell.classList.remove('equip-pop');
                void cell.offsetWidth;
                cell.classList.add('equip-pop');
                setTimeout(() => cell.classList.remove('equip-pop'), 550);
            },
            /** 设置拖放事件 */
            /** 清除玩家手上持有的武器状态（与 loadWeaponAssets 逆操作对应）
             *  卸下 weapon（武器栏1）或 weapon2（武器栏2）槽后同步清除手上状态
             */
            _clearWeaponState(slotKey) {
                const player = this.player;
                if (!player) return;
                // 新设计：weaponMode 只是当前使用的栏位，不区分近战/远程
                // 卸下装备时，如果当前正在使用这个栏位，尝试切换到另一个有装备的栏位
                if (player.weaponMode === slotKey) {
                    const otherSlot = slotKey === 'weapon' ? 'weapon2' : 'weapon';
                    const otherItem = player.equipments[otherSlot];
                    if (otherItem && otherItem.name) {
                        player.weaponMode = otherSlot;
                    }
                    // 如果另一栏位也没装备，保持原值（空手状态）
                }
                // 根据当前 weaponMode 的装备重新同步视觉状态
                const currentItem = player.equipments[player.weaponMode];
                if (currentItem && currentItem.name) {
                    // 有装备，重新设置状态
                    if (currentItem.equipImage) {
                        player.meleeImage.src = currentItem.equipImage;
                    }
                    if (currentItem.bowFrames || (currentItem.weaponAsset && currentItem.weaponAsset.framePrefix)) {
                        const frames = [];
                        if (currentItem.bowFrames) {
                            for (let i = 0; i < currentItem.bowFrames.length; i++) { const im = new Image(); im.src = currentItem.bowFrames[i]; frames.push(im); }
                        } else if (currentItem.weaponAsset && currentItem.weaponAsset.framePrefix) {
                            const startFrame = currentItem.weaponAsset.startFrame || 1;
                            for (let i = 0; i < currentItem.weaponAsset.frameCount; i++) {
                                const num = String(startFrame + i).padStart(currentItem.weaponAsset.framePad || 2, '0');
                                const im = new Image(); im.src = currentItem.weaponAsset.framePrefix + num + '.png'; frames.push(im);
                            }
                        }
                        player.equippedBowFrames = frames;
                        player.equippedRangedType = 'bow';
                    } else if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') {
                        player.equippedRangedType = 'pistol';
                    } else if (currentItem.weaponType === 'pkm') {
                        player.equippedRangedType = 'pkm';
                    } else if (currentItem.weaponType === 'akm') {
                        player.equippedRangedType = 'akm';
                    } else if (currentItem.weaponType === 'qbz191') {
                        player.equippedRangedType = 'qbz191';
                    } else if (currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword') {
                        player.hasMeleeWeapon = true;
                    }
                } else {
                    // 空手状态：清空所有武器视觉状态
                    player.hasMeleeWeapon = false;
                    player.equippedRangedType = null;
                    player.equippedBowFrames = null;
                    player.meleeImage.src = 'assets/weapons/1-rusty_sword_euip.png';
                }
                player.weaponAnim.state = 'idle';
                player.weaponAnim.timer = 0;
                player.weaponAnim.nextSpin = Date.now() + 150; // 触发待机动画2（旋转动画）
                // 同步特殊攻击图标（检查所有武器槽）
                QuickBar.refreshSpecialAttack(player);
            },
            /** 同步当前武器视觉状态：根据 weaponMode 重新设置 meleeImage、弓/手枪状态、特殊攻击图标 */
            _syncWeaponVisual() {
                const player = this.player;
                if (!player) return;
                const currentItem = player.equipments[player.weaponMode];
                if (currentItem && currentItem.name) {
                    // 同步近战武器贴图
                    if (currentItem.equipImage) {
                        player.meleeImage.src = currentItem.equipImage;
                    }
                    // 同步弓/远程武器状态
                    if (currentItem.bowFrames || (currentItem.weaponAsset && currentItem.weaponAsset.framePrefix)) {
                        const frames = [];
                        if (currentItem.bowFrames) {
                            for (let i = 0; i < currentItem.bowFrames.length; i++) { const im = new Image(); im.src = currentItem.bowFrames[i]; frames.push(im); }
                        } else if (currentItem.weaponAsset && currentItem.weaponAsset.framePrefix) {
                            const startFrame = currentItem.weaponAsset.startFrame || 1;
                            for (let i = 0; i < currentItem.weaponAsset.frameCount; i++) {
                                const num = String(startFrame + i).padStart(currentItem.weaponAsset.framePad || 2, '0');
                                const im = new Image(); im.src = currentItem.weaponAsset.framePrefix + num + '.png'; frames.push(im);
                            }
                        }
                        player.equippedBowFrames = frames;
                        player.equippedRangedType = 'bow';
                    } else if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') {
                        player.equippedRangedType = 'pistol';
                        // 同步手枪贴图（G18/沙漠之鹰等）
                        if (currentItem.equipImage) {
                            if (currentItem.canvasImageProp === 'deagleImage') {
                                player.deagleImage = new Image();
                                player.deagleImage.src = currentItem.equipImage;
                            } else {
                                player.pistolImage = new Image();
                                player.pistolImage.src = currentItem.equipImage;
                            }
                        }
                        if (currentItem.weaponAsset && currentItem.weaponAsset.muzzleImage) {
                            player.muzzleFlashImg = new Image();
                            player.muzzleFlashImg.src = currentItem.weaponAsset.muzzleImage;
                        }
                    } else if (currentItem.weaponType === 'pkm') {
                        player.equippedRangedType = 'pkm';
                    } else if (currentItem.weaponType === 'akm') {
                        player.equippedRangedType = 'akm';
                    } else if (currentItem.weaponType === 'qbz191') {
                        player.equippedRangedType = 'qbz191';
                    } else if (currentItem.category === 'weapon_melee' || currentItem.weaponType === 'sword') {
                        player.hasMeleeWeapon = true;
                    }
                    // 同步特殊攻击图标（检查所有武器槽）
                    QuickBar.refreshSpecialAttack(player);
                    // 触发待机动画2（旋转动画）
                    player.weaponAnim.nextSpin = Date.now() + 150;
                } else {
                    // 空手状态：清空所有武器视觉状态
                    player.hasMeleeWeapon = false;
                    player.equippedRangedType = null;
                    player.equippedBowFrames = null;
                    player.meleeImage.src = 'assets/weapons/1-rusty_sword_euip.png';
                    QuickBar.refreshSpecialAttack(player);
                }
                player.weaponAnim.state = 'idle';
                player.weaponAnim.timer = 0;
            },
            updateEquipSlots() {
                const eq = this.player.equipments;
                const rarityLabelMap = { common: '普通', uncommon: '优质', rare: '稀有', epic: '史诗' };
                document.querySelectorAll('.diablo-slot').forEach(slot => {
                    const key = slot.dataset.slot;
                    const item = eq[key];
                    const iconEl = slot.querySelector('.slot-icon');
                    const nameEl = slot.querySelector('.slot-name');
                    const rarityEl = slot.querySelector('.slot-rarity');
                    slot.draggable = !!item;
                    // ===== 双手武器锁定状态：weapon1→offhand, weapon2→ring2 =====
                    const isOffhandLocked = (key === 'offhand') && (eq['weapon'] && eq['weapon'].isTwoHanded);
                    const isRing2Locked = (key === 'ring2') && (eq['weapon2'] && eq['weapon2'].isTwoHanded);
                    const isLocked = isOffhandLocked || isRing2Locked;
                    // 清除旧状态
                    slot.classList.remove('two-handed-locked');
                    const oldX = slot.querySelector('.two-handed-x');
                    if (oldX) oldX.remove();
                    if (isLocked) {
                        slot.classList.add('two-handed-locked');
                        const xEl = document.createElement('div');
                        xEl.className = 'two-handed-x';
                        xEl.textContent = '✕';
                        slot.appendChild(xEl);
                    }
                    if (item) {
                        slot.classList.add('equipped');
                        const imgSrc = item.slotImage || item.iconImage;
                        nameEl.textContent = item.name;
                        // 稀有度显示
                        const rarityKey = item.rarity || 'common';
                        const rarityLabel = rarityLabelMap[rarityKey] || rarityKey;
                        if (rarityEl) {
                            rarityEl.textContent = rarityLabel;
                            rarityEl.className = 'slot-rarity rarity-' + rarityKey;
                        }
                        if (imgSrc) {
                            iconEl.innerHTML = `<img src="${imgSrc}" alt="" onerror="this.style.display='none';this.parentElement.textContent='${item.icon || '❓'}';">`;
                        } else {
                            iconEl.textContent = item.icon || '⚔';
                        }
                        // 已强化标签
                        let enhancedEl = slot.querySelector('.slot-enhanced');
                        if (!enhancedEl) {
                            enhancedEl = document.createElement('div');
                            enhancedEl.className = 'slot-enhanced';
                            slot.appendChild(enhancedEl);
                        }
                        enhancedEl.textContent = (item.enhanceLevel || 0) > 0 ? '已强化' : '';
                        enhancedEl.style.display = (item.enhanceLevel || 0) > 0 ? 'flex' : 'none';
                        // 已改造标签
                        const isCrafted = item._isCrafted || (item._craftData && Object.keys(item._craftData).length > 0);
                        let craftedEl = slot.querySelector('.slot-crafted');
                        if (!craftedEl) {
                            craftedEl = document.createElement('div');
                            craftedEl.className = 'slot-crafted';
                            slot.appendChild(craftedEl);
                        }
                        craftedEl.textContent = isCrafted ? '已改造' : '';
                        craftedEl.style.display = isCrafted ? 'flex' : 'none';
                        // 已附魔标签
                        const isEnchanted = item._isEnchanted || (item._enchantData && (item._enchantData.prefix || item._enchantData.suffix));
                        let enchantedEl = slot.querySelector('.slot-enchanted');
                        if (!enchantedEl) {
                            enchantedEl = document.createElement('div');
                            enchantedEl.className = 'slot-enchanted';
                            slot.appendChild(enchantedEl);
                        }
                        enchantedEl.textContent = isEnchanted ? '已附魔' : '';
                        enchantedEl.style.display = isEnchanted ? 'flex' : 'none';
                    } else {
                        slot.classList.remove('equipped');
                        iconEl.innerHTML = '';
                        nameEl.textContent = nameEl.dataset.default || '';
                        if (rarityEl) {
                            rarityEl.textContent = '';
                            rarityEl.className = 'slot-rarity';
                        }
                        const enhancedEl = slot.querySelector('.slot-enhanced');
                        if (enhancedEl) enhancedEl.style.display = 'none';
                        const craftedEl = slot.querySelector('.slot-crafted');
                        if (craftedEl) craftedEl.style.display = 'none';
                        const enchantedEl = slot.querySelector('.slot-enchanted');
                        if (enchantedEl) enchantedEl.style.display = 'none';
                    }
                });
            },
            unequip(slotKey) {
                const equipped = this.player.equipments[slotKey];
                if (!equipped || !equipped.name) return false;
                // 如果背包已满，不能卸下
                if (this.backpackItems.length >= this.maxBackpackSlots) {
                    BackpackDialogManager._showBackpackFullNotice();
                    return false;
                }
                // 使用原装备中的 backpackSlot 记忆字段，若无则分配第一个空位
                let targetSlot = equipped.backpackSlot;
                if (targetSlot === undefined || targetSlot < 0 || this.backpackItems.some(i => i.slot === targetSlot)) {
                    const used = new Set(this.backpackItems.map(i => i.slot));
                    targetSlot = 0;
                    while (used.has(targetSlot) && targetSlot < this.maxBackpackSlots) targetSlot++;
                    if (targetSlot >= this.maxBackpackSlots) return false;
                }
                const clone = JSON.parse(JSON.stringify(equipped));
                clone.slot = targetSlot;
                if (!clone.weaponCategory) {
                    if (slotKey === 'weapon' || slotKey === 'weapon2') clone.weaponCategory = 'mainhand';
                    else if (slotKey === 'offhand' || slotKey === 'ring2') clone.weaponCategory = 'offhand';
                }
                this.backpackItems.push(clone);
                // 主手1/副手1/主手2/副手2 各自独立卸载，不再联动
                this.player.equipments[slotKey] = null;
                this._clearWeaponState(slotKey);
                // 清除技能覆盖
                if (this.player._clearSkillOverrides) {
                    this.player._clearSkillOverrides();
                }
                this.updateEquipSlots();
                this.updateInventorySlots();
                return true;
            },
            _showBackpackFullNotice() {
                BackpackDialogManager._showBackpackFullNotice();
            },
            _showSplitDialog(item, idx) {
                BackpackDialogManager._showSplitDialog(item, idx);
            },
            addToBackpack(item) {
                return this.addToInventory(item);
            },
            addToInventory(item) {
                if (!this.backpackItems) this.backpackItems = [];
                // 金币特殊处理：使用 GoldManager 合并到已有金币堆叠中
                if (item && item.category === 'gold' && typeof GoldManager !== 'undefined') {
                    return GoldManager.mergeGold(item);
                }
                // 可堆叠物品（强化石、改造券等）：合并到已有堆叠，堆叠未满时不占新格子
                const maxStack = item.maxStack || 1;
                if (maxStack > 1 && item.stack) {
                    let amount = item.stack;
                    for (const existing of this.backpackItems) {
                        if (existing.name === item.name && (existing.stack || 1) < maxStack) {
                            const space = maxStack - (existing.stack || 1);
                            const addAmount = Math.min(amount, space);
                            existing.stack = (existing.stack || 1) + addAmount;
                            amount -= addAmount;
                            if (amount <= 0) {
                                this.updateInventorySlots();
                                this.triggerBackpackFlash(existing.slot);
                                return true;
                            }
                        }
                    }
                    // 还有剩余，需要新格子
                    if (amount > 0) {
                        item.stack = amount;
                    }
                }
                const usedSlots = new Set(this.backpackItems.map(i => i.slot));
                let slot = 0;
                while (usedSlots.has(slot) && slot < this.maxBackpackSlots) slot++;
                if (slot >= this.maxBackpackSlots) {
                    BackpackDialogManager._showBackpackFullNotice();
                    return false;
                }
                const clone = JSON.parse(JSON.stringify(item));
                clone.slot = slot;
                this.backpackItems.push(clone);
                this.updateInventorySlots();
                this.triggerBackpackFlash(slot);
                return true;
            },
            equipFromBackpack(backpackIdx) {
                const item = this.backpackItems.find(i => i.slot === backpackIdx);
                if (!item) return;
                const player = this.player;

                // ===== 消耗品：直接使用 =====
                if (item.category === 'consumable') {
                    // 附魔卷轴：平常时不消耗，只在附魔栏打开时由附魔系统处理
                    if (item.scrollId) {
                        return; // 不消耗，不响应
                    }
                    if (item.name === '治疗药水') {
                        player.data.hp = Math.min(player.data.hp + 30, player.data.maxHp);
                        EffectManager.add(new FloatingTextEffect(player.x, player.y - 20, '+30 HP', '#7a9a6a'));
                    } else if (item.name === '魔力药水') {
                        player.data.mp = Math.min(player.data.mp + 25, player.data.maxMp);
                        EffectManager.add(new FloatingTextEffect(player.x, player.y - 20, '+25 MP', '#5a8aaa'));
                    }
                    // 减少堆叠数量
                    if (item.stack > 1) { item.stack--; }
                    else { const removeIdx = this.backpackItems.findIndex(i => i.slot === backpackIdx); if (removeIdx !== -1) this.backpackItems.splice(removeIdx, 1); }
                    this.updateInventorySlots();
                    return;
                }

                // 目标槽位
                let targetSlot = item.equipSlot;
                // 判断是否是武器
                const isWeapon = item.category === 'weapon_melee' || item.category === 'weapon_ranged'
                    || item.weaponType || item.rangedType || item.weaponAsset || item.bowFrames;
                // 武器类：统一按空槽位填充逻辑，忽略 equipSlot
                // 栏1空 → 栏1，栏1有栏2空 → 栏2，都满 → 替换当前使用的武器栏
                if (isWeapon) {
                    const isOneHandedWeapon = item && isOneHanded(item);
                    if (isOneHandedWeapon) {
                        if (item.weaponType === 'shield') {
                            // 盾类：始终装备到对应副手栏；若主手是双手武器则卸下主手
                            const currentMainSlot = player.weaponMode; // 'weapon' 或 'weapon2'
                            const currentMainItem = player.equipments[currentMainSlot];
                            if (currentMainItem && currentMainItem.isTwoHanded === true) {
                                const oldClone = JSON.parse(JSON.stringify(currentMainItem));
                                const used = new Set(this.backpackItems.map(i => i.slot));
                                let freeSlot = 0; while (used.has(freeSlot) && freeSlot < this.maxBackpackSlots) freeSlot++;
                                oldClone.slot = freeSlot;
                                this.backpackItems.push(oldClone);
                                player.equipments[currentMainSlot] = null;
                                this._clearWeaponState(currentMainSlot);
                                if (currentMainSlot === player.weaponMode && player._clearSkillOverrides) {
                                    player._clearSkillOverrides();
                                }
                            }
                            const offhandSlot = currentMainSlot === 'weapon' ? 'offhand' : 'ring2';
                            targetSlot = offhandSlot;
                        } else {
                            // 单手武器（手枪等）
                            const currentMainSlot = player.weaponMode; // 'weapon' 或 'weapon2'
                            const currentMainItem = player.equipments[currentMainSlot];
                            // 使用 item.isTwoHanded 属性（数据定义中设置）
                            // isOneHanded()/isTwoHanded() 现已支持 item 对象判断
                            const currentMainIsTwoHanded = currentMainItem && currentMainItem.isTwoHanded === true;
                            if (currentMainIsTwoHanded) {
                                // 当前主武器栏是双手武器，单手武器替换当前主武器栏
                                targetSlot = currentMainSlot;
                            } else {
                                // 当前主武器栏是单手武器，单手武器优先装备到对应副武器栏
                                const offhandSlot = currentMainSlot === 'weapon' ? 'offhand' : 'ring2';
                                targetSlot = offhandSlot;
                            }
                        }
                    } else {
                        // 双手武器（机枪/步枪类）：只能装备到主手槽
                        const w1Empty = !player.equipments.weapon || !player.equipments.weapon.name;
                        const w2Empty = !player.equipments.weapon2 || !player.equipments.weapon2.name;
                        if (w1Empty) {
                            targetSlot = 'weapon';
                        } else if (w2Empty) {
                            targetSlot = 'weapon2';
                        } else {
                            targetSlot = player.weaponMode;
                        }
                    }
                }
                if (!targetSlot || !player.equipments.hasOwnProperty(targetSlot)) return;

                const replacedItem = player.equipments[targetSlot];
                // 先从背包移除原物品
                const removeIdx = this.backpackItems.findIndex(i => i.slot === backpackIdx);
                if (removeIdx !== -1) this.backpackItems.splice(removeIdx, 1);
                // 如果目标槽位有旧装备，卸下并记录其来源格子
                if (replacedItem && replacedItem.name) {
                    const oldClone = JSON.parse(JSON.stringify(replacedItem));
                    oldClone.slot = backpackIdx;
                    oldClone.backpackSlot = backpackIdx; // 记忆，下次卸下时优先回到此格
                    this.backpackItems.push(oldClone);
                }
                // 装备新物品
                const equippedClone = JSON.parse(JSON.stringify(item));
                equippedClone.backpackSlot = backpackIdx; // 记录来源格子
                // ===== 双手武器与副手栏互斥逻辑 =====
                // 1. 如果装备到 weapon 栏且是双手武器 → 卸下 offhand
                if (item.isTwoHanded && targetSlot === 'weapon') {
                    const offItem = player.equipments['offhand'];
                    if (offItem && offItem.name) {
                        const oldClone = JSON.parse(JSON.stringify(offItem));
                        const used = new Set(this.backpackItems.map(i => i.slot));
                        let freeSlot = 0; while (used.has(freeSlot) && freeSlot < this.maxBackpackSlots) freeSlot++;
                        oldClone.slot = freeSlot;
                        this.backpackItems.push(oldClone);
                        player.equipments['offhand'] = null;
                        this._clearWeaponState('offhand');
                        if ('offhand' === player.weaponMode && player._clearSkillOverrides) {
                            player._clearSkillOverrides();
                        }
                    }
                }
                // 1b. 如果装备到 weapon2 栏且是双手武器 → 卸下 ring2
                if (item.isTwoHanded && targetSlot === 'weapon2') {
                    const offItem = player.equipments['ring2'];
                    if (offItem && offItem.name) {
                        const oldClone = JSON.parse(JSON.stringify(offItem));
                        const used = new Set(this.backpackItems.map(i => i.slot));
                        let freeSlot = 0; while (used.has(freeSlot) && freeSlot < this.maxBackpackSlots) freeSlot++;
                        oldClone.slot = freeSlot;
                        this.backpackItems.push(oldClone);
                        player.equipments['ring2'] = null;
                        this._clearWeaponState('ring2');
                        if ('ring2' === player.weaponMode && player._clearSkillOverrides) {
                            player._clearSkillOverrides();
                        }
                    }
                }
                // 2. 如果装备到 offhand → 检查 weapon 是否有双手武器
                if (targetSlot === 'offhand') {
                    const wItem = player.equipments['weapon'];
                    if (wItem && wItem.isTwoHanded) {
                        const oldClone = JSON.parse(JSON.stringify(wItem));
                        const used = new Set(this.backpackItems.map(i => i.slot));
                        let freeSlot = 0; while (used.has(freeSlot) && freeSlot < this.maxBackpackSlots) freeSlot++;
                        oldClone.slot = freeSlot;
                        this.backpackItems.push(oldClone);
                        player.equipments['weapon'] = null;
                        this._clearWeaponState('weapon');
                        if ('weapon' === player.weaponMode && player._clearSkillOverrides) {
                            player._clearSkillOverrides();
                        }
                    }
                }
                // 2b. 如果装备到 ring2 → 检查 weapon2 是否有双手武器
                if (targetSlot === 'ring2') {
                    const wItem = player.equipments['weapon2'];
                    if (wItem && wItem.isTwoHanded) {
                        const oldClone = JSON.parse(JSON.stringify(wItem));
                        const used = new Set(this.backpackItems.map(i => i.slot));
                        let freeSlot = 0; while (used.has(freeSlot) && freeSlot < this.maxBackpackSlots) freeSlot++;
                        oldClone.slot = freeSlot;
                        this.backpackItems.push(oldClone);
                        player.equipments['weapon2'] = null;
                        this._clearWeaponState('weapon2');
                        if ('weapon2' === player.weaponMode && player._clearSkillOverrides) {
                            player._clearSkillOverrides();
                        }
                    }
                }
                player.equipments[targetSlot] = equippedClone;

                // 根据槽位处理武器状态（加载武器资源，不修改 weaponMode）
                if (targetSlot === 'weapon' || targetSlot === 'weapon2' || targetSlot === 'offhand' || targetSlot === 'ring2') {
                    if (item.bowFrames || (item.weaponAsset && item.weaponAsset.framePrefix)) {
                        const frames = [];
                        const framePaths = item.bowFrames || [];
                        for (let i = 0; i < framePaths.length; i++) {
                            const img = new Image(); img.src = framePaths[i]; frames.push(img);
                        }
                        player.equippedBowFrames = frames;
                        player.equippedRangedType = 'bow';
                    } else if (item.weaponType === 'pistol' || item.rangedType === 'pistol') {
                        player.equippedRangedType = 'pistol';
                        if (item.equipImage) {
                            if (item.canvasImageProp === 'deagleImage') {
                                player.deagleImage = new Image();
                                player.deagleImage.src = item.equipImage;
                            } else {
                                player.pistolImage = new Image();
                                player.pistolImage.src = item.equipImage;
                            }
                        }
                        if (item.weaponAsset && item.weaponAsset.muzzleImage) {
                            player.muzzleFlashImg = new Image(); player.muzzleFlashImg.src = item.weaponAsset.muzzleImage;
                        }
                    } else if (item.weaponType === 'shotgun') {
                        player.equippedRangedType = 'shotgun';
                        if (item.equipImage && item.canvasImageProp) {
                            player[item.canvasImageProp] = new Image();
                            player[item.canvasImageProp].src = item.equipImage;
                        }
                        if (item.weaponAsset && item.weaponAsset.muzzleImage) {
                            player.muzzleFlashImg = new Image(); player.muzzleFlashImg.src = item.weaponAsset.muzzleImage;
                        }
                        // 装备Super90时播放枪栓音效
                        if (item.equipSound && typeof SoundManager !== 'undefined' && SoundManager.playFile) {
                            SoundManager.playFile(item.equipSound);
                        }
                    } else if (item.category === 'weapon_melee' || item.weaponType === 'sword') {
                        player.hasMeleeWeapon = true;
                    }
                    // 安全：装备到当前武器栏时，设置切换冷却，防止装备后立即攻击
                    if (targetSlot === player.weaponMode && (item.weaponType === 'pistol' || item.rangedType === 'pistol')) {
                        player.weaponSwitchCooldown = 300;
                    }
                    // 触发待机动画2（旋转动画）—— 双手武器不触发
                    if (!isTwoHanded(item)) {
                        player.weaponAnim.nextSpin = Date.now() + 150;
                    } else {
                        player.weaponAnim.nextSpin = 0;
                        player.weaponAnim.spinEnd = 0;
                    }
                    // 同步当前武器视觉状态（贴图、弓/手枪状态、特殊攻击图标、旋转动画）
                    this._syncWeaponVisual();
                }
                // 只在装备到当前武器栏时应用技能覆盖
                if (targetSlot === player.weaponMode && player._applySkillOverrides) {
                    player._applySkillOverrides(equippedClone);
                }
                this.updateEquipSlots();
                this.updateInventorySlots();
                // 触发装备成功动画
                this.triggerEquipFlash(targetSlot);
                // 如果原装备回背包，触发背包格子动画
                if (replacedItem && replacedItem.name) {
                    this.triggerBackpackFlash(backpackIdx);
                }
            },
            backpackItems: [],
            updateInventorySlots() {
                const rarityLabelMap = { common: '普通', uncommon: '优质', rare: '稀有', epic: '史诗' };
                document.querySelectorAll('.inv-cell').forEach((cell, idx) => {
                    cell.classList.remove('occupied');
                    cell.innerHTML = '';
                    cell.dataset.itemName = '';
                    cell.dataset.slot = idx;
                    cell.draggable = false;
                    const item = this.backpackItems.find(i => i.slot === idx);
                    if (item) {
                        cell.classList.add('occupied');
                        cell.draggable = true;
                        cell.dataset.dragType = 'inventory';
                        cell.dataset.dragId = item.itemId || idx;
                        const imgSrc = item.slotImage || item.iconImage;
                        const rarityKey = item.rarity || 'common';
                        const rarityLabel = rarityLabelMap[rarityKey] || rarityKey;
                        const enhancedTag = (item.enhanceLevel || 0) > 0 ? `<div class="inv-enhanced">已强化</div>` : '';
                        const isCrafted = item._isCrafted || (item._craftData && Object.keys(item._craftData).length > 0);
                        const craftedTag = isCrafted ? `<div class="inv-crafted">已改造</div>` : '';
                        const isEnchanted = item._isEnchanted || (item._enchantData && (item._enchantData.prefix || item._enchantData.suffix));
                        const enchantedTag = isEnchanted ? `<div class="inv-enchanted">已附魔</div>` : '';
                        if (imgSrc) {
                            cell.innerHTML = `<div class="inv-rarity rarity-${rarityKey}">${rarityLabel}</div>${enhancedTag}${craftedTag}${enchantedTag}<img src="${imgSrc}" draggable="false" ondragstart="return false;" style="width:32px;height:32px;object-fit:cover;pointer-events:none;border-radius:4px;user-select:none;-webkit-user-drag:none;"><span class="inv-name" style="pointer-events:none;user-select:none;">${item.name}</span>${item.stack > 1 ? `<span class="inv-stack" style="pointer-events:none;user-select:none;">${item.stack}</span>` : ''}`;
                        } else {
                            cell.innerHTML = `<div class="inv-rarity rarity-${rarityKey}">${rarityLabel}</div>${enhancedTag}${craftedTag}${enchantedTag}<span style="pointer-events:none;user-select:none;">${item.icon || '❓'}</span><span class="inv-name" style="pointer-events:none;user-select:none;">${item.name}</span>${item.stack > 1 ? `<span class="inv-stack" style="pointer-events:none;user-select:none;">${item.stack}</span>` : ''}`;
                        }
                        cell.dataset.itemName = item.name;
                        // 右键使用消耗品
                        if (item.category === 'consumable') {
                            cell.oncontextmenu = (e) => {
                                e.preventDefault();
                                const player = this.player;
                                if (!player) return;
                                if (item.name === '治疗药水') {
                                    const d = player.data;
                                    const healAmount = Math.floor(d.maxHp * 0.2 + d.con * 2);
                                    player.data.hp = Math.min(player.data.hp + healAmount, d.maxHp);
                                    EffectManager.add(new FloatingTextEffect(player.x, player.y - 20, `+${healAmount} HP`, '#7a9a6a'));
                                } else if (item.name === '魔力药水') {
                                    const d = player.data;
                                    const manaAmount = Math.floor(d.maxMp * 0.2 + d.int * 0.1 + d.wis * 0.1);
                                    player.data.mp = Math.min(player.data.mp + manaAmount, d.maxMp);
                                    EffectManager.add(new FloatingTextEffect(player.x, player.y - 20, `+${manaAmount} MP`, '#5a8aaa'));
                                }
                                if (item.stack > 1) {
                                    item.stack--;
                                } else {
                                    const removeIdx = this.backpackItems.findIndex(i => i.slot === idx);
                                    if (removeIdx !== -1) this.backpackItems.splice(removeIdx, 1);
                                }
                                this.updateInventorySlots();
                                if (typeof GameUIManager !== 'undefined') GameUIManager.updateUI();
                            };
                        }
                    }
                    // 绑定拖放事件（所有格子都可作为放置目标）
                    if (this._dragDropManager && typeof this._dragDropManager.bindDragToCell === 'function') {
                        this._dragDropManager.bindDragToCell(cell);
                    }
                });
                const invCountEl = document.getElementById('invCount'); if (invCountEl) invCountEl.textContent = `${this.backpackItems.length}/${this.maxBackpackSlots}`;
                // 重新绑定tooltip（使用 onmouseenter/onmouseleave 直接赋值覆盖旧值）
                EquipTooltipManager.bindInventoryTooltip();
            }
        };


