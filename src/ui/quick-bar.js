import { EquipManager } from './equip-manager.js';

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
        const skillGroup = document.getElementById('skillGroup');
        const itemGroup = document.getElementById('itemGroup');
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
        this.specialAttack.enabled = true;
        this.specialAttack.item = item;
        const slot = this.slots.find(s => s.config.type === 'special');
        if (!slot) return;
        slot.element.style.display = 'flex';
        slot.element.classList.remove('empty');
        const isRune = item && item.weaponId === 'weapon4';
        const icon = isRune ? '⚔' : '🔥';
        const title = isRune ? '符文长剑：特殊攻击 (右键)' : '夜与火之剑：特殊攻击 (右键)';
        slot.element.innerHTML = `<span style="font-size:20px">${icon}</span><span class="key-hint">右键</span><div class="cooldown-overlay" style="height:0%"></div><span class="cooldown-text"></span>`;
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
            if (typeof EquipManager !== 'undefined' && EquipManager._dragDropManager) {
                EquipManager._dragDropManager._dropHandled = true;
            }
            // Try skill drop first (skill ID string)
            if (player.skills[data]) {
                const skill = player.skills[data];
                if (!skill.tags || !skill.tags.find(t => t.type === 'active')) return;
                this.skillAssignments[config.keyCode] = data;
                this._updateSlot(slot, skill);
                return;
            }
            // Try item drop (inventory slot number)
            const bpSlot = parseInt(data);
            if (!isNaN(bpSlot) && typeof EquipManager !== 'undefined') {
                const item = EquipManager.backpackItems.find(i => i.slot === bpSlot);
                if (item && item.category === 'consumable') {
                    this.itemAssignments[config.keyCode] = { bpSlot, itemName: item.name, icon: item.icon || '❓' };
                    this._updateItemSlot(slot, item);
                }
            }
        };
    },
    _updateSlot(slot, skill) {
        slot.classList.remove('empty');
        slot.innerHTML = `<span class="skill-assigned">${skill.icon}</span><span class="key-hint">${slot.dataset.key}</span><div class="cooldown-overlay" style="height:0%"></div><span class="cooldown-text"></span>`;
    },
    _updateItemSlot(slot, item) {
        slot.classList.remove('empty');
        slot.innerHTML = `<span style="font-size:20px">${item.icon || '❓'}</span><span class="key-hint">${slot.dataset.key}</span><span class="item-stack">${item.stack > 1 ? item.stack : ''}</span><div class="cooldown-overlay" style="height:0%"></div><span class="cooldown-text"></span>`;
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
        // 特殊攻击冷却同步（夜与火之剑）
        if (this.specialAttack.enabled && Game.player) {
            const player = Game.player;
            if (player._specialAttackCooldown > 0) {
                this.specialAttack.cooldown = player._specialAttackCooldown;
            } else if (player._runeSwordSpecialCooldown > 0) {
                this.specialAttack.cooldown = player._runeSwordSpecialCooldown;
            } else {
                this.specialAttack.cooldown = 0;
            }
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
                const totalCooldown = 5000; // 5秒
                const overlay = slot.element.querySelector('.cooldown-overlay');
                const text = slot.element.querySelector('.cooldown-text');
                if (overlay) {
                    const pct = remaining > 0 ? (remaining / totalCooldown) * 100 : 0;
                    overlay.style.height = `${pct}%`;
                }
                if (text) {
                    text.textContent = remaining > 0 ? (remaining / 1000).toFixed(1) : '';
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
            if (overlay) {
                const pct = remaining > 0 ? (remaining / totalCooldown) * 100 : 0;
                overlay.style.height = `${pct}%`;
            }
            if (text) {
                text.textContent = remaining > 0 ? (remaining / 1000).toFixed(1) : '';
            }
        });
    }
};
