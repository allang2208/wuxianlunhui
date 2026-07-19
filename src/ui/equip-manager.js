import { GoldManager } from '../systems/gold-manager.js';
import { SoundManager } from '../ui/sound-manager.js';
import { RARITY_LABELS } from '../config/rarity.js';
import { applyConsumableEffect } from '../config/consumable.js';
import { Game } from '../game.js';
        // Item Tooltip System v2 - Cache Bust
import { EquipDataManager } from './equip-data-manager.js';
import { BackpackDialogManager } from './backpack-dialog-manager.js';
import { EquipTooltipManager } from './equip-tooltip-manager.js';
import { EventBus } from '../core/event-bus.js';
import { isOneHanded, isTwoHanded } from '../config/gun-ammo.js';
import { CraftSystem } from './craft-system.js';
import { UIState } from './ui-state.js';
import { EnhanceSystem } from './enhance-system.js';
import { loadImage } from '../utils/image-loader.js';
import { queryAllElements, queryElement, getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { ShopSystem } from './shop-system.js';
import { SkillManager } from './skill-manager.js';
import { QuickBar } from './quick-bar.js';
import { createDragDropManager } from './equip/drag-drop-manager.js';
import { updateEquipSlots as renderEquipSlots, updateInventorySlots as renderInventorySlots } from './equip/slot-renderer.js';
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
                    // 兼容旧存档：确保第二武器栏存在
                    if (!Object.prototype.hasOwnProperty.call(player.equipments, 'weapon2')) {
                        player.equipments.weapon2 = null;
                    }
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
                        frames.push(loadImage(w2.bowFrames[i]));
                    }
                    player.equippedBowFrames = frames;
                    player.equippedRangedType = 'bow';
                } else if (w2 && w2.weaponAsset && w2.weaponAsset.framePrefix) {
                    // 从 weaponAsset 加载弓帧动画
                    const frames = [];
                    const startFrame = w2.weaponAsset.startFrame || 1;
                    for (let i = 0; i < w2.weaponAsset.frameCount; i++) {
                        const num = String(startFrame + i).padStart(w2.weaponAsset.framePad || 2, '0');
                        frames.push(loadImage(w2.weaponAsset.framePrefix + num + '.png'));
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
                const grid = getElement('inventoryGrid');
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
                // 通过事件委托统一处理背包格子的双击/右键，避免动态重建导致绑定丢失
                if (!this._inventoryInteractionsBound) {
                    document.addEventListener('contextmenu', (e) => this._onInventoryContextMenu(e));
                    document.addEventListener('dblclick', (e) => this._onInventoryDblClick(e));
                    this._inventoryInteractionsBound = true;
                }
                // 拖拽管理器由 equip/drag-drop-manager.js 提供（工厂注入 EquipManager）
                this._dragDropManager = createDragDropManager(this);
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
                if (GoldManager) {
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
                const slot = queryElement(`.equip-grid .diablo-slot[data-slot="${slotKey}"]`);
                if (!slot) return;
                slot.classList.remove('equip-flash', 'equip-pop');
                void slot.offsetWidth; // 强制重绘，重置动画
                slot.classList.add('equip-flash');
                TimerManager.setTimeout(() => slot.classList.remove('equip-flash'), 650);
            },
            // === 触发背包格子动画 ===
            triggerBackpackFlash(slotIdx) {
                const cell = queryElement(`.gear-inventory-col .inv-cell[data-slot="${slotIdx}"]`);
                if (!cell) return;
                cell.classList.remove('equip-pop');
                void cell.offsetWidth;
                cell.classList.add('equip-pop');
                TimerManager.setTimeout(() => cell.classList.remove('equip-pop'), 550);
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
                            for (let i = 0; i < currentItem.bowFrames.length; i++) { frames.push(loadImage(currentItem.bowFrames[i])); }
                        } else if (currentItem.weaponAsset && currentItem.weaponAsset.framePrefix) {
                            const startFrame = currentItem.weaponAsset.startFrame || 1;
                            for (let i = 0; i < currentItem.weaponAsset.frameCount; i++) {
                                const num = String(startFrame + i).padStart(currentItem.weaponAsset.framePad || 2, '0');
                                frames.push(loadImage(currentItem.weaponAsset.framePrefix + num + '.png'));
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
                            for (let i = 0; i < currentItem.bowFrames.length; i++) { frames.push(loadImage(currentItem.bowFrames[i])); }
                        } else if (currentItem.weaponAsset && currentItem.weaponAsset.framePrefix) {
                            const startFrame = currentItem.weaponAsset.startFrame || 1;
                            for (let i = 0; i < currentItem.weaponAsset.frameCount; i++) {
                                const num = String(startFrame + i).padStart(currentItem.weaponAsset.framePad || 2, '0');
                                frames.push(loadImage(currentItem.weaponAsset.framePrefix + num + '.png'));
                            }
                        }
                        player.equippedBowFrames = frames;
                        player.equippedRangedType = 'bow';
                    } else if (currentItem.weaponType === 'pistol' || currentItem.rangedType === 'pistol') {
                        player.equippedRangedType = 'pistol';
                        // 同步手枪贴图（G18/沙漠之鹰等）
                        if (currentItem.equipImage) {
                            if (currentItem.canvasImageProp === 'deagleImage') {
                                player.deagleImage = loadImage(currentItem.equipImage);
                            } else {
                                player.pistolImage = loadImage(currentItem.equipImage);
                            }
                        }
                        if (currentItem.weaponAsset && currentItem.weaponAsset.muzzleImage) {
                            player.muzzleFlashImg = loadImage(currentItem.weaponAsset.muzzleImage);
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
                renderEquipSlots(this);
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
                if (item && item.category === 'gold' && GoldManager) {
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
            _onInventoryContextMenu(e) {
                const cell = e.target.closest('.inv-cell');
                if (!cell || !cell.closest('.inventory-grid')) return;
                const idx = parseInt(cell.dataset.slot, 10);
                if (Number.isNaN(idx)) return;
                const item = this.backpackItems.find(i => i.slot === idx);
                if (!item) return;
                // 附魔卷轴：只在附魔栏打开时放入
                if (item.scrollId) {
                    const enchantPanel = getElement('enchantPanel');
                    if (enchantPanel && enchantPanel.classList.contains('active')) {
                        EventBus.emit('enchant:equipScrollFromBackpack', idx);
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                if (UIState.isOpen('shop') && item.category !== 'gold') {
                    e.preventDefault();
                    e.stopPropagation();
                    EventBus.emit('shop:addToSellGrid', idx);
                } else if (UIState.isOpen('enhance') && item.category !== 'gold') {
                    e.preventDefault();
                    e.stopPropagation();
                    EnhanceSystem.equipFromBackpack(idx);
                } else if (UIState.isOpen('craft')) {
                    e.preventDefault();
                    e.stopPropagation();
                    CraftSystem._equipFromBackpack(idx);
                } else {
                    e.preventDefault();
                    e.stopPropagation();
                    this.equipFromBackpack(idx);
                }
            },
            _onInventoryDblClick(e) {
                const cell = e.target.closest('.inv-cell');
                if (!cell || !cell.closest('.inventory-grid')) return;
                const idx = parseInt(cell.dataset.slot, 10);
                if (Number.isNaN(idx)) return;
                const item = this.backpackItems.find(i => i.slot === idx);
                if (!item) return;
                if (item.scrollId) {
                    const enchantPanel = getElement('enchantPanel');
                    if (enchantPanel && enchantPanel.classList.contains('active')) {
                        EventBus.emit('enchant:equipScrollFromBackpack', idx);
                    }
                    return;
                }
                if (UIState.isOpen('shop') && item.category !== 'gold') {
                    EventBus.emit('shop:addToSellGrid', idx);
                } else if (UIState.isOpen('enhance') && item.category !== 'gold') {
                    EnhanceSystem.equipFromBackpack(idx);
                } else {
                    this.equipFromBackpack(idx);
                }
            },
            equipFromBackpack(backpackIdx) {
                const item = this.backpackItems.find(i => i.slot === backpackIdx);
                if (!item) return;
                const player = this.player;

                // ===== 消耗品：直接使用（效果由物品 useEffect 数据驱动） =====
                if (item.category === 'consumable') {
                    // 附魔卷轴：平常时不消耗，只在附魔栏打开时由附魔系统处理
                    if (item.scrollId) {
                        return; // 不消耗，不响应
                    }
                    if (!applyConsumableEffect(player, item)) {
                        return; // 无效果的消耗品不消耗
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
                        const currentMainSlot = player.weaponMode; // 'weapon' 或 'weapon2'
                        const offhandSlot = currentMainSlot === 'weapon' ? 'offhand' : 'ring2';
                        const currentMainItem = player.equipments[currentMainSlot];
                        const currentMainIsTwoHanded = currentMainItem && currentMainItem.isTwoHanded === true;
                        if (item.weaponType === 'shield') {
                            // 盾类：始终装备到对应副手栏；若主手是双手武器则卸下主手
                            if (currentMainIsTwoHanded) {
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
                            targetSlot = offhandSlot;
                        } else {
                            // 单手武器（手枪等）：优先装当前主手栏；主手空则主手，主手满再看副手
                            if (!currentMainItem || !currentMainItem.name) {
                                targetSlot = currentMainSlot;
                            } else {
                                const offhandItem = player.equipments[offhandSlot];
                                if (!offhandItem || !offhandItem.name) {
                                    targetSlot = offhandSlot;
                                } else if (currentMainIsTwoHanded) {
                                    // 主手是双手武器，替换主手
                                    targetSlot = currentMainSlot;
                                } else {
                                    // 主手单手且副手有装备，替换副手
                                    targetSlot = offhandSlot;
                                }
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
                if (!targetSlot || !Object.prototype.hasOwnProperty.call(player.equipments, targetSlot)) return;

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
                            frames.push(loadImage(framePaths[i]));
                        }
                        player.equippedBowFrames = frames;
                        player.equippedRangedType = 'bow';
                    } else if (item.weaponType === 'pistol' || item.rangedType === 'pistol') {
                        player.equippedRangedType = 'pistol';
                        if (item.equipImage) {
                            if (item.canvasImageProp === 'deagleImage') {
                                player.deagleImage = loadImage(item.equipImage);
                            } else {
                                player.pistolImage = loadImage(item.equipImage);
                            }
                        }
                        if (item.weaponAsset && item.weaponAsset.muzzleImage) {
                            player.muzzleFlashImg = loadImage(item.weaponAsset.muzzleImage);
                        }
                    } else if (item.weaponType === 'shotgun') {
                        player.equippedRangedType = 'shotgun';
                        if (item.equipImage && item.canvasImageProp) {
                            player[item.canvasImageProp] = loadImage(item.equipImage);
                        }
                        if (item.weaponAsset && item.weaponAsset.muzzleImage) {
                            player.muzzleFlashImg = loadImage(item.weaponAsset.muzzleImage);
                        }
                        // 装备Super90时播放枪栓音效
                        if (item.equipSound && SoundManager && SoundManager.playFile) {
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
            _inventoryInteractionsBound: false,
            updateInventorySlots() {
                renderInventorySlots(this);
            }
        };


