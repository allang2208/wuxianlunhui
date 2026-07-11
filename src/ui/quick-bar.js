import { Game } from '../game.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { EquipManager } from './equip-manager.js';
import { ItemDatabase } from '../items/item-database.js';
import { EffectManager } from '../effects/effect-manager.js';
import { queryAllElements, getElement } from '../utils/dom-utils.js';

export const QUICK_BAR_CONFIG = [
    { id: 'slotSkillQ', type: 'skill', key: 'Q', keyCode: 'KeyQ', label: 'Q', icon: '?', placeholder: '技能占位' },
    { id: 'slotSkillE', type: 'skill', key: 'E', keyCode: 'KeyE', label: 'E', icon: '?', placeholder: '技能占位' },
    { id: 'slotSkillX', type: 'skill', key: 'X', keyCode: 'KeyX', label: 'X', icon: '?', placeholder: '技能占位' },
    { id: 'slotSkillC', type: 'skill', key: 'C', keyCode: 'KeyC', label: 'C', icon: '?', placeholder: '技能占位' },
    { id: 'slotSpecial', type: 'special', key: '右键', keyCode: 'RightClick', label: '右键', icon: '🔥', placeholder: '特殊攻击' },
    { id: 'slotItem1', type: 'item', key: '1', keyCode: 'Digit1', label: '1', icon: '?', placeholder: '道具占位' },
    { id: 'slotItem2', type: 'item', key: '2', keyCode: 'Digit2', label: '2', icon: '?', placeholder: '道具占位' },
    { id: 'slotItem3', type: 'item', key: '3', keyCode: 'Digit3', label: '3', icon: '?', placeholder: '道具占位' },
    { id: 'slotItem4', type: 'item', key: '4', keyCode: 'Digit4', label: '4', icon: '?', placeholder: '道具占位' }
];

export const QuickBar = {
    slots: [],
    skillAssignments: {}, // keyCode -> skillId
    itemAssignments: {}, // keyCode -> { bpSlot, itemName, icon }
    cooldowns: {}, // skillId -> remainingMs
    specialAttack: { enabled: false, item: null, cooldown: 0 },
    init() {
        const skillGroup = getElement('skillGroup');
        const itemGroup = getElement('itemGroup');
        if (!skillGroup || !itemGroup) return;
        QUICK_BAR_CONFIG.forEach(config => {
            const slot = document.createElement('div');
            slot.id = config.id;
            slot.className = `quick-slot ${config.type} empty`;
            slot.innerHTML = `<span style="font-size:20px">${config.icon}</span><span class="key-hint">${config.key}</span>`;
            slot.title = `${config.placeholder} (${config.key})`;
            slot.dataset.type = config.type;
            slot.dataset.key = config.key;
            slot.dataset.keyCode = config.keyCode;
            if (config.type === 'skill') {
                skillGroup.appendChild(slot);
                this._setupDrop(slot, config);
            }
            else if (config.type === 'special') {
                // 特殊攻击槽位：在 skillGroup 和 itemGroup 之间
                slot.className = 'quick-slot special empty';
                slot.style.display = 'none'; // 默认隐藏
                itemGroup.parentNode.insertBefore(slot, itemGroup);
            }
            else if (config.type === 'item') {
                itemGroup.appendChild(slot);
                this._setupDrop(slot, config);
            }
            this.slots.push({ config, element: slot });
        });
    },
    enableSpecialAttack(item) {
        // 只支持夜与火之剑和符文长剑的特殊攻击图标
        if (!item || (item.specialAttackType !== 'nightFlame' && item.specialAttackType !== 'runeSword')) {
            this.disableSpecialAttack();
            return;
        }
        this.specialAttack.enabled = true;
        this.specialAttack.item = item;
        const slot = this.slots.find(s => s.config.type === 'special');
        if (!slot) return;
        slot.element.style.display = 'flex';
        slot.element.classList.remove('empty');
        const isRune = item && item.weaponId === 'weapon4';
        const icon = isRune ? '⚔' : '🔥';
        const title = isRune ? '符文长剑：特殊攻击 (右键)' : '夜与火之剑：特殊攻击 (右键)';
        slot.element.innerHTML = `<span style="font-size:20px">${icon}</span><span class="key-hint">右键</span><div class="cooldown-overlay" style="height:0%"></div><span class="cooldown-text"></span><div class="cooldown-flash"></div>`;
        slot.element.title = title;
    },
    disableSpecialAttack() {
        this.specialAttack.enabled = false;
        this.specialAttack.item = null;
        this.specialAttack.cooldown = 0;
        const slot = this.slots.find(s => s.config.type === 'special');
        if (slot) {
            slot.element.style.display = 'none';
            slot.element.classList.add('empty');
        }
    },
    refreshSpecialAttack(player) {
        if (!player) {
            this.disableSpecialAttack();
            return;
        }
        const slots = ['weapon', 'weapon2', 'offhand', 'ring2'];
        let currentItem = null;
        let currentInCooldown = false;
        let otherReady = null;
        let otherCooldown = null;
        for (const slot of slots) {
            const item = player.equipments[slot];
            if (item && item.specialAttackType) {
                const cooldown = (player._specialAttackCooldowns && player._specialAttackCooldowns[item.specialAttackType]) || 0;
                if (slot === player.weaponMode) {
                    currentItem = item;
                    currentInCooldown = cooldown > 0;
                } else {
                    if (!otherReady && cooldown <= 0) {
                        otherReady = item;
                    }
                    if (!otherCooldown) {
                        otherCooldown = item;
                    }
                }
            }
        }
        if (currentItem && !currentInCooldown) {
            this.enableSpecialAttack(currentItem);
        } else if (otherReady) {
            this.enableSpecialAttack(otherReady);
        } else if (currentItem) {
            this.enableSpecialAttack(currentItem);
        } else if (otherCooldown) {
            this.enableSpecialAttack(otherCooldown);
        } else {
            this.disableSpecialAttack();
        }
    },
    _setupDrop(slot, config) {
        slot.ondragover = (e) => {
            e.preventDefault();
            slot.classList.add('drag-over');
        };
        slot.ondragleave = () => {
            slot.classList.remove('drag-over');
        };
        slot.ondrop = (e) => {
            e.preventDefault();
            slot.classList.remove('drag-over');
            const data = e.dataTransfer.getData('text/plain');
            if (!data) return;
            const player = Game.player;
            if (!player) return;
            // Mark drop as handled to prevent equip-manager discard
            if (typeof EquipManager !== 'undefined') {
                EquipManager._dropHandled = true;
            }
            // 快捷栏内部拖动（任意类型交换）
            if (data.startsWith('quickbar:')) {
                const rest = data.replace('quickbar:', '');
                const srcIsSkill = rest.startsWith('skill:');
                const srcKeyCode = srcIsSkill ? rest.replace('skill:', '') : rest.replace('item:', '');
                if (srcKeyCode === config.keyCode) return; // 拖到自己，不处理
                const srcSlot = this.slots.find(s => s.config.keyCode === srcKeyCode);
                const srcSkillId = this.skillAssignments[srcKeyCode];
                const srcItemData = this.itemAssignments[srcKeyCode];
                // 获取源数据
                let srcData = null, srcDataType = null;
                if (srcIsSkill && srcSkillId) {
                    srcData = srcSkillId; srcDataType = 'skill';
                } else if (!srcIsSkill && srcItemData) {
                    srcData = srcItemData; srcDataType = 'item';
                }
                if (!srcData) return; // 源空
                const targetSkillId = this.skillAssignments[config.keyCode];
                const targetItemData = this.itemAssignments[config.keyCode];
                // 获取目标数据
                let targetData = null, targetDataType = null;
                if (targetSkillId) {
                    targetData = targetSkillId; targetDataType = 'skill';
                } else if (targetItemData) {
                    targetData = targetItemData; targetDataType = 'item';
                }
                if (targetData) {
                    // 目标有东西：交换位置
                    if (srcDataType === 'skill') {
                        this.skillAssignments[config.keyCode] = srcData;
                        delete this.itemAssignments[config.keyCode]; // 清理目标可能的旧物品
                        const skill = player.skills[srcData];
                        if (skill) this._updateSlot(slot, skill);
                    } else {
                        this.itemAssignments[config.keyCode] = srcData;
                        delete this.skillAssignments[config.keyCode]; // 清理目标可能的旧技能
                        const item = EquipManager.backpackItems.find(i => i.slot === srcData.bpSlot);
                        if (item) this._updateItemSlot(slot, item);
                    }
                    if (targetDataType === 'skill') {
                        this.skillAssignments[srcKeyCode] = targetData;
                        delete this.itemAssignments[srcKeyCode]; // 清理源可能的旧物品
                        const skill = player.skills[targetData];
                        if (srcSlot && skill) this._updateSlot(srcSlot.element, skill);
                        else if (srcSlot) {
                            srcSlot.element.classList.add('empty');
                            srcSlot.element.innerHTML = `<span style="font-size:20px">${srcSlot.config.icon}</span><span class="key-hint">${srcSlot.config.key}</span>`;
                        }
                    } else {
                        this.itemAssignments[srcKeyCode] = targetData;
                        delete this.skillAssignments[srcKeyCode]; // 清理源可能的旧技能
                        const item = EquipManager.backpackItems.find(i => i.slot === targetData.bpSlot);
                        if (srcSlot && item) this._updateItemSlot(srcSlot.element, item);
                        else if (srcSlot) {
                            srcSlot.element.classList.add('empty');
                            srcSlot.element.innerHTML = `<span style="font-size:20px">${srcSlot.config.icon}</span><span class="key-hint">${srcSlot.config.key}</span>`;
                        }
                    }
                } else {
                    // 目标空：移动
                    if (srcDataType === 'skill') {
                        this.skillAssignments[config.keyCode] = srcData;
                        delete this.itemAssignments[config.keyCode]; // 清理目标可能的旧物品
                        const skill = player.skills[srcData];
                        if (skill) this._updateSlot(slot, skill);
                    } else {
                        this.itemAssignments[config.keyCode] = srcData;
                        delete this.skillAssignments[config.keyCode]; // 清理目标可能的旧技能
                        const item = EquipManager.backpackItems.find(i => i.slot === srcData.bpSlot);
                        if (item) this._updateItemSlot(slot, item);
                    }
                    // 清空源
                    delete this.skillAssignments[srcKeyCode];
                    delete this.itemAssignments[srcKeyCode];
                    if (srcSlot) {
                        srcSlot.element.classList.add('empty');
                        srcSlot.element.innerHTML = `<span style="font-size:20px">${srcSlot.config.icon}</span><span class="key-hint">${srcSlot.config.key}</span>`;
                    }
                }
                return;
            }
            // Try skill drop (skill ID string from backpack or skill tree)
            if (player.skills[data]) {
                const skill = player.skills[data];
                if (!skill.tags || !skill.tags.find(t => t.type === 'active')) return;
                // 技能唯一性：如果已绑定到别的快捷键，处理原位置
                const existingKeyCode = Object.keys(this.skillAssignments).find(kc =>
                    kc !== config.keyCode && this.skillAssignments[kc] === data
                );
                const targetSkillId = this.skillAssignments[config.keyCode];
                const targetItemData = this.itemAssignments[config.keyCode];
                if (targetSkillId || targetItemData) {
                    // 目标有东西：交换位置
                    const existingSlot = existingKeyCode ? this.slots.find(s => s.config.keyCode === existingKeyCode) : null;
                    if (targetSkillId) {
                        // 目标技能→源位置
                        if (existingKeyCode) this.skillAssignments[existingKeyCode] = targetSkillId;
                        else this.skillAssignments[config.keyCode] = targetSkillId; // fallback
                        const targetSkill = player.skills[targetSkillId];
                        if (existingSlot && targetSkill) this._updateSlot(existingSlot.element, targetSkill);
                    } else if (targetItemData) {
                        // 目标物品→源位置
                        if (existingKeyCode) this.itemAssignments[existingKeyCode] = targetItemData;
                        else this.itemAssignments[config.keyCode] = targetItemData; // fallback
                        const targetItem = EquipManager.backpackItems.find(i => i.slot === targetItemData.bpSlot);
                        if (existingSlot && targetItem) this._updateItemSlot(existingSlot.element, targetItem);
                    }
                    if (existingSlot && !existingSlot.element.classList.contains('empty')) {
                        // existingSlot already updated above
                    } else if (existingSlot) {
                        existingSlot.element.classList.add('empty');
                        existingSlot.element.innerHTML = `<span style="font-size:20px">${existingSlot.config.icon}</span><span class="key-hint">${existingSlot.config.key}</span>`;
                    }
                } else if (existingKeyCode) {
                    // 目标空：取消原位置绑定
                    delete this.skillAssignments[existingKeyCode];
                    const existingSlot = this.slots.find(s => s.config.keyCode === existingKeyCode);
                    if (existingSlot) {
                        existingSlot.element.classList.add('empty');
                        existingSlot.element.innerHTML = `<span style="font-size:20px">${existingSlot.config.icon}</span><span class="key-hint">${existingSlot.config.key}</span>`;
                    }
                }
                this.skillAssignments[config.keyCode] = data;
                this._updateSlot(slot, skill);
                return;
            }
            // Try item drop (inventory slot number)
            const bpSlot = parseInt(data);
            if (!isNaN(bpSlot) && typeof EquipManager !== 'undefined') {
                const item = EquipManager.backpackItems.find(i => i.slot === bpSlot);
                if (item && item.category === 'consumable') {
                    // 唯一性：如果该物品已经绑定到别的快捷栏，处理原位置
                    for (const [existingKeyCode, existingData] of Object.entries(this.itemAssignments)) {
                        if (existingData.bpSlot === bpSlot && existingKeyCode !== config.keyCode) {
                            const targetSkillId = this.skillAssignments[config.keyCode];
                            const targetItemData = this.itemAssignments[config.keyCode];
                            if (targetSkillId) {
                                // 目标有技能：交换到原位置
                                this.skillAssignments[existingKeyCode] = targetSkillId;
                                const existingSlot = this.slots.find(s => s.config.keyCode === existingKeyCode);
                                const targetSkill = player.skills[targetSkillId];
                                if (existingSlot && targetSkill) this._updateSlot(existingSlot.element, targetSkill);
                                else if (existingSlot) {
                                    existingSlot.element.classList.add('empty');
                                    existingSlot.element.innerHTML = `<span style="font-size:20px">${existingSlot.config.icon}</span><span class="key-hint">${existingSlot.config.key}</span>`;
                                }
                            } else if (targetItemData) {
                                // 目标有物品：交换到原位置
                                this.itemAssignments[existingKeyCode] = targetItemData;
                                const existingSlot = this.slots.find(s => s.config.keyCode === existingKeyCode);
                                const targetItem = EquipManager.backpackItems.find(i => i.slot === targetItemData.bpSlot);
                                if (existingSlot && targetItem) this._updateItemSlot(existingSlot.element, targetItem);
                                else if (existingSlot) {
                                    existingSlot.element.classList.add('empty');
                                    existingSlot.element.innerHTML = `<span style="font-size:20px">${existingSlot.config.icon}</span><span class="key-hint">${existingSlot.config.key}</span>`;
                                }
                            } else {
                                // 目标空：直接移动，取消原位置
                                delete this.itemAssignments[existingKeyCode];
                                const existingSlot = this.slots.find(s => s.config.keyCode === existingKeyCode);
                                if (existingSlot) {
                                    existingSlot.element.classList.add('empty');
                                    existingSlot.element.innerHTML = `<span style="font-size:20px">${existingSlot.config.icon}</span><span class="key-hint">${existingSlot.config.key}</span>`;
                                }
                            }
                        }
                    }
                    this.itemAssignments[config.keyCode] = { bpSlot, itemName: item.name };
                    this._updateItemSlot(slot, item);
                }
            }
        };
    },
    _updateSlot(slot, skill) {
        slot.classList.remove('empty');
        const iconHtml = skill.iconImage
            ? `<img src="${skill.iconImage}" style="width:48px;height:48px;object-fit:contain;" onerror="this.style.display='none';this.parentElement.textContent='${skill.icon}';this.parentElement.style.fontSize='20px';">`
            : skill.icon;
        slot.innerHTML = `<span class="skill-assigned">${iconHtml}</span><span class="key-hint">${slot.dataset.key}</span><div class="cooldown-overlay" style="height:0%"></div><span class="cooldown-text"></span><div class="cooldown-flash"></div>`;
        // 清理该槽位的物品数据（如果之前有）
        delete this.itemAssignments[slot.dataset.keyCode];
        // 技能槽内部拖动
        slot.draggable = true;
        slot.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', 'quickbar:skill:' + slot.dataset.keyCode);
            e.dataTransfer.effectAllowed = 'move';
            slot.classList.add('dragging');
        };
        slot.ondragend = () => {
            slot.classList.remove('dragging');
            queryAllElements('.quick-slot').forEach(s => s.classList.remove('drag-over'));
        };
    },
    _updateItemSlot(slot, item) {
        slot.classList.remove('empty');
        const imgSrc = ItemDatabase.getIconImage ? ItemDatabase.getIconImage(item) : (item.iconImage || item.icon);
        const iconHtml = imgSrc
            ? `<img src="${imgSrc}" style="width:40px;height:40px;object-fit:contain;" draggable="false" ondragstart="return false;">`
            : (item.icon || '❓');
        slot.innerHTML = `<span class="item-assigned">${iconHtml}</span><span class="key-hint">${slot.dataset.key}</span><span class="item-stack">${item.stack > 1 ? item.stack : ''}</span><div class="cooldown-overlay" style="height:0%"></div><span class="cooldown-text"></span><div class="cooldown-flash"></div>`;
        // 清理该槽位的技能数据（如果之前有）
        delete this.skillAssignments[slot.dataset.keyCode];
        // 快捷栏内部拖动
        slot.draggable = true;
        slot.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', 'quickbar:item:' + slot.dataset.keyCode);
            e.dataTransfer.effectAllowed = 'move';
            slot.classList.add('dragging');
        };
        slot.ondragend = () => {
            slot.classList.remove('dragging');
            queryAllElements('.quick-slot').forEach(s => s.classList.remove('drag-over'));
        };
    },
    useSlot(keyCode) {
        const slot = this.slots.find(s => s.config.keyCode === keyCode);
        if (!slot) return;
        const player = Game.player;
        if (!player) return;
        // 攻击期间禁止使用技能
        if (player.weaponAnim && player.weaponAnim.state !== 'idle') return;
        // 夜与火之剑特殊攻击期间禁止释放技能
        if (player._specialAttackActive) return;
        const skillId = this.skillAssignments[keyCode];
        if (skillId) {
            if (!player.skills[skillId]) return;
            const skill = player.skills[skillId];
            const effect = skill.getEffect(skill.level);
            // Check cooldown
            if (this.cooldowns[skillId] > 0) return;
            // Check stamina for whirlwind
            if (skillId === 'whirlwind') {
                // 应用改造效果：技能体力消耗
                let staminaCost = effect.staminaCost;
                const currentWeapon = player.equipments[player.weaponMode];
                if (currentWeapon && currentWeapon._craftEffects) {
                    const ce = currentWeapon._craftEffects;
                    if (ce.skillStaminaCostDelta) staminaCost += ce.skillStaminaCostDelta;
                }
                if (staminaCost < 0) staminaCost = 0;
                if (player.data.stamina < staminaCost) return;
                // Check melee weapon (including offhand when main is empty)
                const offhandSlot = player.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                const offhandWeapon = player.equipments[offhandSlot];
                const effectiveWeapon = (currentWeapon && currentWeapon.name) ? currentWeapon : offhandWeapon;
                const isMelee = effectiveWeapon && (effectiveWeapon.category === 'weapon_melee' || effectiveWeapon.weaponType === 'sword');
                if (!isMelee) return;
                player.triggerWhirlwind();
                player.data.stamina -= staminaCost;
                if (player.data.stamina < 0) player.data.stamina = 0;
                // Set cooldown in ms
                this.cooldowns[skillId] = effect.cooldown * 1000;
            } else if (skillId === 'pushStrike') {
                if (player.data.stamina < effect.staminaCost) return;
                // Check ranged weapon (including offhand when main is empty)
                const currentWeapon = player.equipments[player.weaponMode];
                const offhandSlot = player.weaponMode === 'weapon' ? 'offhand' : 'ring2';
                const offhandWeapon = player.equipments[offhandSlot];
                const effectiveWeapon = (currentWeapon && currentWeapon.name) ? currentWeapon : offhandWeapon;
                const isRanged = effectiveWeapon && (
                    effectiveWeapon.weaponType === 'pistol' || effectiveWeapon.rangedType === 'pistol' ||
                    effectiveWeapon.weaponType === 'pkm' || effectiveWeapon.weaponType === 'akm' ||
                    effectiveWeapon.weaponType === 'qbz191' || effectiveWeapon.weaponType === 'bow'
                );
                if (!isRanged) {
                    // 显示提示：持有远程武器才可使用
                    const hint = document.createElement('div');
                    hint.style.cssText = 'position:fixed;top:30%;left:50%;transform:translate(-50%,-50%);background:rgba(120,50,50,0.9);color:#d4c5a9;font-size:18px;padding:10px 24px;border-radius:8px;border:2px solid #9a5a5a;z-index:99999;pointer-events:none;font-family:SimHei, "Microsoft YaHei", "黑体", sans-serif;white-space:nowrap;transition:opacity 0.5s;';
                    hint.textContent = '⚠ 持有远程武器才可使用！';
                    document.body.appendChild(hint);
                    requestAnimationFrame(() => { if (hint) hint.style.opacity = '0'; setTimeout(() => { if (hint && hint.parentNode) hint.remove(); }, 800); });
                    return;
                }
                player.triggerPushStrike();
                player.data.stamina -= effect.staminaCost;
                if (player.data.stamina < 0) player.data.stamina = 0;
                // Set cooldown in ms
                this.cooldowns[skillId] = effect.cooldown * 1000;
            } else if (skillId === 'droneSkill') {
                // 无人机技能
                if (player.droneSystem) {
                    player.droneSystem.toggle();
                }
                // 设置冷却时间
                this.cooldowns[skillId] = effect.cooldown * 1000;
            } else if (skillId === 'iceSpike') {
                // 冰锥技能
                if (player.iceSpikeSystem) {
                    player.iceSpikeSystem.trigger();
                }
                // 冷却时间由 IceSpikeSystem 内部管理，通过 updateCooldowns 同步
            } else if (skillId === 'fireball') {
                // 火球技能
                if (player.fireballSystem) {
                    player.fireballSystem.trigger();
                }
                // 冷却时间由 FireballSystem 内部管理，通过 updateCooldowns 同步
            }
            slot.element.style.transform = 'scale(0.95)';
            setTimeout(() => slot.element.style.transform = '', 100);
            return;
        }
        // Item usage
        const itemData = this.itemAssignments[keyCode];
        if (itemData) {
            const item = EquipManager.backpackItems.find(i => i.slot === itemData.bpSlot);
            if (!item || item.category !== 'consumable') {
                delete this.itemAssignments[keyCode];
                slot.element.classList.add('empty');
                slot.element.innerHTML = `<span style="font-size:20px">${slot.config.icon}</span><span class="key-hint">${slot.config.key}</span>`;
                return;
            }
            if (item.name === '治疗药水') {
                player.data.hp = Math.min(player.data.hp + 30, player.data.maxHp);
                EffectManager.add(new FloatingTextEffect(player.x, player.y - 20, '+30 HP', '#7a9a6a'));
            } else if (item.name === '魔力药水') {
                player.data.mp = Math.min(player.data.mp + 25, player.data.maxMp);
                EffectManager.add(new FloatingTextEffect(player.x, player.y - 20, '+25 MP', '#5a8aaa'));
            }
            if (item.stack > 1) {
                item.stack--;
            } else {
                const removeIdx = EquipManager.backpackItems.findIndex(i => i.slot === itemData.bpSlot);
                if (removeIdx !== -1) EquipManager.backpackItems.splice(removeIdx, 1);
                delete this.itemAssignments[keyCode];
                slot.element.classList.add('empty');
                slot.element.innerHTML = `<span style="font-size:20px">${slot.config.icon}</span><span class="key-hint">${slot.config.key}</span>`;
            }
            if (typeof EquipManager !== 'undefined' && EquipManager.updateInventorySlots) {
                EquipManager.updateInventorySlots();
            }
            slot.element.style.transform = 'scale(0.95)';
            setTimeout(() => slot.element.style.transform = '', 100);
            return;
        }
        // No skill or item assigned
        slot.element.style.transform = 'scale(0.95)';
        setTimeout(() => slot.element.style.transform = '', 100);
    },
    updateCooldowns(dt) {
        for (const skillId in this.cooldowns) {
            if (this.cooldowns[skillId] > 0) {
                this.cooldowns[skillId] -= dt;
                if (this.cooldowns[skillId] < 0) this.cooldowns[skillId] = 0;
            }
        }
        // 特殊攻击冷却同步（基于当前显示的特殊攻击武器）
        if (this.specialAttack.enabled && Game.player) {
            const player = Game.player;
            const displayedItem = this.specialAttack.item;
            const specialType = displayedItem && displayedItem.specialAttackType;
            if (specialType && player._specialAttackCooldowns[specialType] > 0) {
                this.specialAttack.cooldown = player._specialAttackCooldowns[specialType];
            } else {
                this.specialAttack.cooldown = 0;
            }
        }
        // 冰锥技能冷却同步
        if (Game.player && Game.player._iceSpikeCooldown > 0) {
            this.cooldowns['iceSpike'] = Game.player._iceSpikeCooldown;
        } else if (Game.player && Game.player._iceSpikeCooldown === 0) {
            this.cooldowns['iceSpike'] = 0;
        }
        // 火球技能冷却同步
        if (Game.player && Game.player._fireballCooldown > 0) {
            this.cooldowns['fireball'] = Game.player._fireballCooldown;
        } else if (Game.player && Game.player._fireballCooldown === 0) {
            this.cooldowns['fireball'] = 0;
        }
        this._renderCooldownOverlays();
    },
    _flashAllCooldownSlots() {
        this.slots.forEach(slot => {
            if (slot.config.type === 'special') return;
            const skillId = this.skillAssignments[slot.config.keyCode];
            if (!skillId) return;
            const remaining = this.cooldowns[skillId] || 0;
            if (remaining > 0) {
                // 创建白色闪烁 overlay
                const overlay = slot.element.querySelector('.cooldown-overlay');
                if (overlay) {
                    overlay.style.backgroundColor = 'rgba(255, 255, 255, 0.6)';
                    setTimeout(() => {
                        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
                    }, 150);
                }
            }
        });
    },
    _renderCooldownOverlays() {
        this.slots.forEach(slot => {
            if (slot.config.type === 'special') {
                // 特殊攻击冷却遮罩
                if (!this.specialAttack.enabled) return;
                const remaining = this.specialAttack.cooldown || 0;
                const totalCooldown = 15000; // 15秒
                const overlay = slot.element.querySelector('.cooldown-overlay');
                const text = slot.element.querySelector('.cooldown-text');
                const flash = slot.element.querySelector('.cooldown-flash');
                if (overlay) {
                    const pct = remaining > 0 ? (remaining / totalCooldown) * 100 : 0;
                    overlay.style.height = `${pct}%`;
                }
                if (text) {
                    text.textContent = remaining > 0 ? (remaining / 1000).toFixed(1) : '';
                    if (remaining <= 0 && text.textContent !== '') {
                        // CD刚结束，触发闪光
                        if (flash) flash.classList.add('active');
                        setTimeout(() => { if (flash) flash.classList.remove('active'); }, 600);
                    }
                }
                return;
            }
            const skillId = this.skillAssignments[slot.config.keyCode];
            if (!skillId) return;
            const skill = Game.player && Game.player.skills[skillId];
            if (!skill) return;
            const effect = skill.getEffect(skill.level);
            const totalCooldown = effect.cooldown * 1000;
            const remaining = this.cooldowns[skillId] || 0;
            const overlay = slot.element.querySelector('.cooldown-overlay');
            const text = slot.element.querySelector('.cooldown-text');
            const flash = slot.element.querySelector('.cooldown-flash');
            if (overlay) {
                const pct = remaining > 0 ? (remaining / totalCooldown) * 100 : 0;
                overlay.style.height = `${pct}%`;
            }
            if (text) {
                const hadText = text.textContent !== '';
                text.textContent = remaining > 0 ? (remaining / 1000).toFixed(1) : '';
                // CD刚结束，触发白色闪光
                if (hadText && text.textContent === '' && flash) {
                    flash.classList.add('active');
                    setTimeout(() => flash.classList.remove('active'), 600);
                }
            }
        });
    }
};
