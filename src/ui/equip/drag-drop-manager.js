/**
 * drag-drop-manager.js — 背包/装备栏拖拽管理器（从 equip-manager.js 拆分）
 * 通过工厂参数注入 EquipManager，避免与 equip-manager.js 形成循环依赖。
 */
import { Game } from '../../game.js';
import { CraftSystem } from '../craft-system.js';
import { ShopSystem } from '../shop-system.js';
import { SkillManager } from '../skill-manager.js';
import { QuickBar } from '../quick-bar.js';
import { EventBus } from '../../core/event-bus.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { loadImage } from '../../utils/image-loader.js';
import { isTwoHanded } from '../../config/gun-ammo.js';
import { getElement, queryElement, queryAllElements } from '../../utils/dom-utils.js';

export function createDragDropManager(EquipManager) {
    return {
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
                        const equipGrid = queryElement('.equip-grid');
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
                                queryAllElements('.equip-grid .diablo-slot').forEach(s => s.classList.remove('drag-over'));
                                self._dropHandled = true;
                                if (!slot) return;
                                const src = self._dragSrc;
                                if (!src || src.slot === slot.dataset.slot) return;
                                self.handleDrop(src, 'equip', slot.dataset.slot);
                                self._dragSrc = null;
                            };
                        }
                        queryAllElements('.diablo-slot, .inv-cell').forEach(cell => {
                            this.bindDragToCell(cell);
                        });
                        this.bindCanvasDiscard();
                    },

                    _doDiscard() {
                        const src = this._dragSrc;
                        if (!src || !Game.player) return false;
                        
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
                            
                            EventBus.emit('enchant:returnScrollItem');
                            EventBus.emit('enchant:updateUI');
                            return true;
                        }
                        if (src.type === 'enchantEquip') {
                            
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
                                    if (SkillManager && SkillManager.renderSkillGrid) {
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
                        const panel = getElement('systemPanel');
                        if (!panel || !panel.classList.contains('active')) return true;
                        const panelLeft = window.innerWidth * 0.55;
                        if (clientX >= panelLeft) return false;
                        // 附魔栏打开时，附魔栏区域也不视为丢弃区域
                        const enchantPanel = getElement('enchantPanel');
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
                        const canvas = getElement('gameCanvas');
                        if (canvas) {
                            canvas.ondragover = function(e) { e.preventDefault(); };
                            canvas.ondrop = function(e) {
                                e.preventDefault();
                                self._dropHandled = true;
                                self._doDiscard();
                            };
                        }
                        const overlay = getElement('panelOverlay');
                        if (overlay) {
                            overlay.ondragover = function(e) { e.preventDefault(); };
                            overlay.ondrop = function(e) {
                                e.preventDefault();
                                self._dropHandled = true;
                                self._doDiscard();
                            };
                        }
                        const panel = getElement('systemPanel');
                        if (panel) {
                            panel.ondragover = function(e) { e.preventDefault(); };
                            panel.ondrop = function(e) {
                                e.preventDefault();
                                self._dropHandled = true;
                            };
                        }
                        const uiLayer = getElement('uiLayer');
                        if (uiLayer) {
                            uiLayer.ondragover = function(e) { e.preventDefault(); };
                            uiLayer.ondrop = function(e) {
                                e.preventDefault();
                                self._dropHandled = true;
                            };
                        }
                        queryAllElements('.equip-panel, .inventory-panel, .tabs, .panel-header, .panel-footer, .diablo-paperdoll, .equip-slot-group, .inv-grid, .warehouse-panel').forEach(el => {
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
                                type: cell.classList.contains('wh-cell') ? 'warehouse'
                                    : (cell.classList.contains('inv-cell') ? 'inventory' : 'equip'),
                                slot: cell.dataset.slot
                            };
                            self._dropHandled = false;
                            e.dataTransfer.setData('text/plain', cell.dataset.slot);
                            e.dataTransfer.effectAllowed = 'move';
                            cell.classList.add('dragging');
                            const tooltip = getElement('equipTooltip');
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
                                    const panel = getElement('systemPanel');
                                    const overlay = getElement('panelOverlay');
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
                            queryAllElements('.inv-cell, .diablo-slot').forEach(s => s.classList.remove('drag-over'));
                            if (!self._dropHandled && self._dragSrc && self._isInGameArea(e.clientX)) {
                                self._doDiscard();
                            }
                            self._dropHandled = false;
                            self._dragSrc = null;
                            // 恢复面板和覆盖层
                            const panel = getElement('systemPanel');
                            const overlay = getElement('panelOverlay');
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
                        cell.ondragenter = function(_e) {
                            cell.classList.add('drag-over');
                        };
                        cell.ondragleave = function(_e) {
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

                        // 仓库格 → 背包：取出（EventBus 桥接，避免 drag-drop-manager ↔ warehouse 循环 import）
                        if (src.type === 'warehouse') {
                            if (targetType === 'inventory') {
                                EventBus.emit('warehouse:retrieveToBackpack', parseInt(src.slot, 10));
                            }
                            return;
                        }
                        
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
                            // 弹药状态随装备立即初始化（magazine/attackInterval 改造不再等切枪才生效）
                            if (this.player._initAmmoForSlot) this.player._initAmmoForSlot(eKey);
                            if (eKey === this.player.weaponMode && this.player._applySkillOverrides) {
                                this.player._applySkillOverrides(item);
                                if (SkillManager && SkillManager.renderSkillGrid) {
                                    SkillManager.renderSkillGrid();
                                }
                            }
                            if (eKey === 'weapon' || eKey === 'weapon2') {
                                if (item.bowFrames || (item.weaponAsset && item.weaponAsset.framePrefix)) {
                                    const frames = [];
                                    if (item.bowFrames) {
                                        for (let i = 0; i < item.bowFrames.length; i++) { frames.push(loadImage(item.bowFrames[i])); }
                                    } else if (item.weaponAsset && item.weaponAsset.framePrefix) {
                                        const startFrame = item.weaponAsset.startFrame || 1;
                                        for (let i = 0; i < item.weaponAsset.frameCount; i++) {
                                            const num = String(startFrame + i).padStart(item.weaponAsset.framePad || 2, '0');
                                            frames.push(loadImage(item.weaponAsset.framePrefix + num + '.png'));
                                        }
                                    }
                                    this.player.equippedBowFrames = frames;
                                    this.player.equippedRangedType = 'bow';
                                } else if (item.weaponType === 'pistol' || item.rangedType === 'pistol') {
                                    this.player.equippedRangedType = 'pistol';
                                    if (item.equipImage) {
                                        this.player.pistolImage = loadImage(item.equipImage);
                                    }
                                    if (item.weaponAsset && item.weaponAsset.muzzleImage) {
                                        this.player.muzzleFlashImg = loadImage(item.weaponAsset.muzzleImage);
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
                                if (SkillManager && SkillManager.renderSkillGrid) {
                                    SkillManager.renderSkillGrid();
                                }
                            }
                            if (targetSlot === 'weapon' || targetSlot === 'weapon2') {
                                if (item.bowFrames || (item.weaponAsset && item.weaponAsset.framePrefix)) {
                                    const frames = [];
                                    if (item.bowFrames) {
                                        for (let i = 0; i < item.bowFrames.length; i++) { frames.push(loadImage(item.bowFrames[i])); }
                                    } else if (item.weaponAsset && item.weaponAsset.framePrefix) {
                                        const startFrame = item.weaponAsset.startFrame || 1;
                                        for (let i = 0; i < item.weaponAsset.frameCount; i++) {
                                            const num = String(startFrame + i).padStart(item.weaponAsset.framePad || 2, '0');
                                            frames.push(loadImage(item.weaponAsset.framePrefix + num + '.png'));
                                        }
                                    }
                                    this.player.equippedBowFrames = frames;
                                    this.player.equippedRangedType = 'bow';
                                } else if (item.weaponType === 'pistol' || item.rangedType === 'pistol') {
                                    this.player.equippedRangedType = 'pistol';
                                    if (item.equipImage) {
                                        this.player.pistolImage = loadImage(item.equipImage);
                                    }
                                    if (item.weaponAsset && item.weaponAsset.muzzleImage) {
                                        this.player.muzzleFlashImg = loadImage(item.weaponAsset.muzzleImage);
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
                            // 弹药状态随装备立即初始化（magazine/attackInterval 改造不再等切枪才生效）
                            if (this.player._initAmmoForSlot) this.player._initAmmoForSlot(eKey);
                            if (eKey === this.player.weaponMode && this.player._applySkillOverrides) {
                                this.player._applySkillOverrides(item);
                                if (SkillManager && SkillManager.renderSkillGrid) {
                                    SkillManager.renderSkillGrid();
                                }
                            }
                            if (eKey === 'weapon' || eKey === 'weapon2') {
                                if (item.bowFrames || (item.weaponAsset && item.weaponAsset.framePrefix)) {
                                    const frames = [];
                                    if (item.bowFrames) {
                                        for (let i = 0; i < item.bowFrames.length; i++) { frames.push(loadImage(item.bowFrames[i])); }
                                    } else if (item.weaponAsset && item.weaponAsset.framePrefix) {
                                        const startFrame = item.weaponAsset.startFrame || 1;
                                        for (let i = 0; i < item.weaponAsset.frameCount; i++) {
                                            const num = String(startFrame + i).padStart(item.weaponAsset.framePad || 2, '0');
                                            frames.push(loadImage(item.weaponAsset.framePrefix + num + '.png'));
                                        }
                                    }
                                    this.player.equippedBowFrames = frames;
                                    this.player.equippedRangedType = 'bow';
                                } else if (item.weaponType === 'pistol' || item.rangedType === 'pistol') {
                                    this.player.equippedRangedType = 'pistol';
                                    if (item.equipImage) {
                                        this.player.pistolImage = loadImage(item.equipImage);
                                    }
                                    if (item.weaponAsset && item.weaponAsset.muzzleImage) {
                                        this.player.muzzleFlashImg = loadImage(item.weaponAsset.muzzleImage);
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
}
