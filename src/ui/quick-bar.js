export const QUICK_BAR_CONFIG = [
    { id: 'slotSkillQ', type: 'skill', key: 'Q', keyCode: 'KeyQ', label: 'Q', icon: '?', placeholder: '技能占位' },
    { id: 'slotSkillE', type: 'skill', key: 'E', keyCode: 'KeyE', label: 'E', icon: '?', placeholder: '技能占位' },
    { id: 'slotSkillR', type: 'skill', key: 'R', keyCode: 'KeyR', label: 'R', icon: '?', placeholder: '技能占位' },
    { id: 'slotSpecial', type: 'special', key: '右键', keyCode: 'RightClick', label: '右键', icon: '🔥', placeholder: '特殊攻击' },
    { id: 'slotItem1', type: 'item', key: '1', keyCode: 'Digit1', label: '1', icon: '?', placeholder: '道具占位' },
    { id: 'slotItem2', type: 'item', key: '2', keyCode: 'Digit2', label: '2', icon: '?', placeholder: '道具占位' },
    { id: 'slotItem3', type: 'item', key: '3', keyCode: 'Digit3', label: '3', icon: '?', placeholder: '道具占位' },
    { id: 'slotItem4', type: 'item', key: '4', keyCode: 'Digit4', label: '4', icon: '?', placeholder: '道具占位' }
];

export const QuickBar = {
    slots: [],
    skillAssignments: {}, // keyCode -> skillId
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
            else itemGroup.appendChild(slot);
            this.slots.push({ config, element: slot });
        });
    },
    enableSpecialAttack(item) {
        this.specialAttack.enabled = true;
        this.specialAttack.item = item;
        const slot = this.slots.find(s => s.config.type === 'special');
        if (slot) {
            slot.element.style.display = 'flex';
            slot.element.classList.remove('empty');
            slot.element.innerHTML = `<span style="font-size:20px">🔥</span><span class="key-hint">右键</span><div class="cooldown-overlay" style="height:0%"></div><span class="cooldown-text"></span>`;
            slot.element.title = '夜与火之剑：特殊攻击 (右键)';
        }
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
            const skillId = e.dataTransfer.getData('text/plain');
            if (!skillId) return;
            const player = Game.player;
            if (!player || !player.skills[skillId]) return;
            const skill = player.skills[skillId];
            // Only active skills can be assigned to quick slots
            if (!skill.tags || !skill.tags.find(t => t.type === 'active')) return;
            this.skillAssignments[config.keyCode] = skillId;
            this._updateSlot(slot, skill);
        };
    },
    _updateSlot(slot, skill) {
        slot.classList.remove('empty');
        slot.innerHTML = `<span class="skill-assigned">${skill.icon}</span><span class="key-hint">${slot.dataset.key}</span><div class="cooldown-overlay" style="height:0%"></div><span class="cooldown-text"></span>`;
    },
    useSlot(keyCode) {
        const slot = this.slots.find(s => s.config.keyCode === keyCode);
        if (!slot) return;
        const skillId = this.skillAssignments[keyCode];
        if (!skillId) {
            slot.element.style.transform = 'scale(0.95)';
            setTimeout(() => slot.element.style.transform = '', 100);
            return;
        }
        const player = Game.player;
        if (!player || !player.skills[skillId]) return;
        const skill = player.skills[skillId];
        const effect = skill.getEffect(skill.level);
        // Check cooldown
        if (this.cooldowns[skillId] > 0) return;
        // Check stamina for whirlwind
        if (skillId === 'whirlwind') {
            if (player.data.stamina < effect.staminaCost) return;
            // Check melee weapon
            const currentWeapon = player.equipments[player.weaponMode];
            const isMelee = currentWeapon && (currentWeapon.category === 'weapon_melee' || currentWeapon.weaponType === 'sword');
            if (!isMelee) return;
            player.triggerWhirlwind();
            player.data.stamina -= effect.staminaCost;
            if (player.data.stamina < 0) player.data.stamina = 0;
            // Set cooldown in ms
            this.cooldowns[skillId] = effect.cooldown * 1000;
        }
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
        // 特殊攻击冷却同步
        if (this.specialAttack.enabled && Game.player) {
            this.specialAttack.cooldown = Game.player._specialAttackCooldown;
        }
        this._renderCooldownOverlays();
    },
    _renderCooldownOverlays() {
        this.slots.forEach(slot => {
            if (slot.config.type === 'special') {
                // 特殊攻击冷却遮罩
                if (!this.specialAttack.enabled) return;
                const remaining = this.specialAttack.cooldown || 0;
                const totalCooldown = 10000; // 10秒
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
