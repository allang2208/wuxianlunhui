const NPCDialogue = {
    _active: false,
    _currentNPC: null,
    _currentText: '',
    _displayedText: '',
    _charIndex: 0,
    _typewriterSpeed: 40, // 每字符间隔 ms
    _lastCharTime: 0,
    _optionsVisible: false,
    _onComplete: null,

    // 打开对话界面
    open(npc) {
        this._active = true;
        this._currentNPC = npc;
        this._currentText = npc.getRandomGreeting();
        this._displayedText = '';
        this._charIndex = 0;
        this._lastCharTime = Date.now();
        this._optionsVisible = true;

        const dialogueBox = document.getElementById('npcDialogueBox');
        const dialogueText = document.getElementById('npcDialogueText');
        const npcPortrait = document.getElementById('npcPortrait');
        const dialogueOptions = document.getElementById('npcDialogueOptions');

        if (dialogueBox) {
            dialogueBox.style.display = 'flex';
            dialogueBox.classList.add('active');
        }
        if (dialogueText) dialogueText.textContent = '';
        if (npcPortrait) { npcPortrait.src = npc.portrait; npcPortrait.style.display = 'block'; }
        if (dialogueOptions) dialogueOptions.style.display = 'flex';

        // 暂停游戏（可选）
        if (Game && Game.isRunning) {
            Game._npcDialoguePaused = true;
        }

        // 绑定点击外部退出事件
        this._bindClickOutsideHandler();
    },

    // 绑定点击外部退出
    _bindClickOutsideHandler() {
        const self = this;
        // 先移除旧的
        if (this._clickOutsideHandler) {
            document.removeEventListener('mousedown', this._clickOutsideHandler);
        }
        this._clickOutsideHandler = function(e) {
            // 子页面打开时不退出
            if (ShopSystem._isOpen || EnhanceSystem._isOpen || CraftSystem._isOpen || EnchantSystem._isOpen) return;
            // 背包打开时不退出
            if (SystemUI.isOpen) return;
            const dialogueBox = document.getElementById('npcDialogueBox');
            if (!dialogueBox) return;
            // 点击对话框外部时退出
            if (!dialogueBox.contains(e.target)) {
                self.close();
            }
        };
        document.addEventListener('mousedown', this._clickOutsideHandler);
    },

    // 关闭对话界面
    close() {
        this._active = false;
        this._currentNPC = null;
        // 关闭所有子页面
        if (ShopSystem._isOpen) ShopSystem.close();
        if (EnhanceSystem._isOpen) EnhanceSystem.close();
        if (CraftSystem._isOpen) CraftSystem.close();
        if (EnchantSystem._isOpen) EnchantSystem.close();
        // 强制关闭背包
        SystemUI.close();

        // 移除点击外部退出事件
        if (this._clickOutsideHandler) {
            document.removeEventListener('mousedown', this._clickOutsideHandler);
            this._clickOutsideHandler = null;
        }

        const dialogueBox = document.getElementById('npcDialogueBox');
        const npcPortrait = document.getElementById('npcPortrait');
        if (dialogueBox) {
            dialogueBox.style.display = 'none';
            dialogueBox.classList.remove('active');
        }
        if (npcPortrait) npcPortrait.style.display = 'none';

        // 恢复游戏
        if (Game) Game._npcDialoguePaused = false;
    },

    exitCompactMode() {
        // 从子页面回到对话主界面
        const dialogueOptions = document.getElementById('npcDialogueOptions');
        if (dialogueOptions) dialogueOptions.style.display = 'flex';
    },

    goodbye() {
        // 先关闭所有子页面和背包
        if (ShopSystem._isOpen) ShopSystem.close();
        if (EnhanceSystem._isOpen) EnhanceSystem.close();
        if (CraftSystem._isOpen) CraftSystem.close();
        if (EnchantSystem._isOpen) EnchantSystem.close();
        if (SystemUI.isOpen) SystemUI.close();
        // 如果之前打开了子页面，回到对话主界面
        if (this._active) this.exitCompactMode();
        // 触发向左滑出动画，动画结束后真正关闭
        const dialogueBox = document.getElementById('npcDialogueBox');
        if (dialogueBox) {
            dialogueBox.classList.remove('active');
            // 等待 CSS 过渡动画完成（300ms）后彻底关闭
            setTimeout(() => {
                if (!this._active) return;
                this.close();
            }, 300);
        } else {
            this.close();
        }
    },

    // 逐字更新
    update() {
        if (!this._active) return;

        const dialogueText = document.getElementById('npcDialogueText');
        if (!dialogueText) return;

        // 如果还有字符未显示
        let hasNewChar = false;
        if (this._charIndex < this._currentText.length) {
            const now = Date.now();
            if (now - this._lastCharTime >= this._typewriterSpeed) {
                this._charIndex++;
                this._lastCharTime = now;
                hasNewChar = true;
            }
        }
        // 构建带HTML的显示文本
        const raw = this._currentText.substring(0, this._charIndex);
        const highlight = '不能再进行更改';
        const idx = raw.indexOf(highlight);
        if (idx !== -1) {
            const before = raw.substring(0, idx);
            const after = raw.substring(idx + highlight.length);
            const newHTML = before + '<span class="red-bold-shake">' + highlight + '</span>' + after;
            // 只在内容变化时更新，避免重新创建DOM导致动画重启
            if (dialogueText.innerHTML !== newHTML) {
                dialogueText.innerHTML = newHTML;
            }
        } else {
            const newText = raw;
            if (dialogueText.textContent !== newText) {
                dialogueText.textContent = newText;
            }
        }
    },

    // 跳过逐字动画（点击时）
    skip() {
        if (!this._active) return;
        this._charIndex = this._currentText.length;
        this._displayedText = this._currentText;
        const dialogueText = document.getElementById('npcDialogueText');
        if (dialogueText) {
            const highlight = '不能再进行更改';
            const idx = this._currentText.indexOf(highlight);
            if (idx !== -1) {
                const before = this._currentText.substring(0, idx);
                const after = this._currentText.substring(idx + highlight.length);
                dialogueText.innerHTML = before + '<span class="red-bold-shake">' + highlight + '</span>' + after;
            } else {
                dialogueText.textContent = this._currentText;
            }
        }
    },

    // 选择商店
    openShop() {
        const npc = this._currentNPC;
        if (ShopSystem._isOpen) { ShopSystem.close(); return; }
        if (EnhanceSystem._isOpen) EnhanceSystem.close();
        if (CraftSystem._isOpen) CraftSystem.close();
        if (EnchantSystem._isOpen) EnchantSystem.close();
        
        // 恢复随机问候语
        this._currentText = npc.getRandomGreeting();
        this._displayedText = '';
        this._charIndex = 0;
        this._lastCharTime = Date.now();
        const dialogueText = document.getElementById('npcDialogueText');
        if (dialogueText) dialogueText.textContent = '';
        
        ShopSystem.open(npc);
    },

    // 选择强化
    openEnhance() {
        const npc = this._currentNPC;
        if (EnhanceSystem._isOpen) { EnhanceSystem.close(); return; }
        if (ShopSystem._isOpen) ShopSystem.close();
        if (CraftSystem._isOpen) CraftSystem.close();
        if (EnchantSystem._isOpen) EnchantSystem.close();
        
        // 显示强化提示
        this._currentText = '改造可以强化武器基础伤害，同时也会强化人物属性的影响数值，改造完后不可退回。';
        this._displayedText = '';
        this._charIndex = 0;
        this._lastCharTime = Date.now();
        const dialogueText = document.getElementById('npcDialogueText');
        if (dialogueText) dialogueText.textContent = '';
        // 保留对话选项按钮可见，支持页面跳转
        const dialogueOptions = document.getElementById('npcDialogueOptions');
        if (dialogueOptions) dialogueOptions.style.display = 'flex';
        
        EnhanceSystem.open(npc);
    },

    // 选择改造
    openCraft() {
        const npc = this._currentNPC;
        if (CraftSystem._isOpen) { CraftSystem.close(); return; }
        if (ShopSystem._isOpen) ShopSystem.close();
        if (EnhanceSystem._isOpen) EnhanceSystem.close();
        if (EnchantSystem._isOpen) EnchantSystem.close();
        
        // 清除当前对话并显示改造提示
        this._currentText = '因为神秘力量，改造完装备之后，可以使装备获得一些特殊的能力，就不能再进行更改，请慎重选择。';
        this._displayedText = '';
        this._charIndex = 0;
        this._lastCharTime = Date.now();
        const dialogueText = document.getElementById('npcDialogueText');
        if (dialogueText) dialogueText.textContent = '';
        // 保留对话选项按钮可见，支持页面跳转
        const dialogueOptions = document.getElementById('npcDialogueOptions');
        if (dialogueOptions) dialogueOptions.style.display = 'flex';
        
        CraftSystem.open(npc);
    },

    // 选择附魔
    openEnchant() {
        const npc = this._currentNPC;
        if (EnchantSystem._isOpen) { EnchantSystem.close(); return; }
        if (ShopSystem._isOpen) ShopSystem.close();
        if (EnhanceSystem._isOpen) EnhanceSystem.close();
        if (CraftSystem._isOpen) CraftSystem.close();
        
        // 显示附魔提示
        this._currentText = '附魔可以为你的装备注入神秘力量，但需要消耗魔法晶尘。请放入装备和附魔卷轴，我会为你进行附魔。';
        this._displayedText = '';
        this._charIndex = 0;
        this._lastCharTime = Date.now();
        const dialogueText = document.getElementById('npcDialogueText');
        if (dialogueText) dialogueText.textContent = '';
        // 保留对话选项按钮可见，支持页面跳转
        const dialogueOptions = document.getElementById('npcDialogueOptions');
        if (dialogueOptions) dialogueOptions.style.display = 'flex';
        
        EnchantSystem.open(npc);
    },

    get active() { return this._active; }
};

export { NPCDialogue };
