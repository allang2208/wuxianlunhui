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
        this._optionsVisible = false;

        const dialogueBox = document.getElementById('npcDialogueBox');
        const dialogueText = document.getElementById('npcDialogueText');
        const npcPortrait = document.getElementById('npcPortrait');
        const dialogueOptions = document.getElementById('npcDialogueOptions');

        if (dialogueBox) dialogueBox.style.display = 'flex';
        if (dialogueText) dialogueText.textContent = '';
        if (npcPortrait) { npcPortrait.src = npc.portrait; npcPortrait.style.display = 'block'; }
        if (dialogueOptions) dialogueOptions.style.display = 'none';

        // 暂停游戏（可选）
        if (Game && Game.isRunning) {
            Game._npcDialoguePaused = true;
        }
    },

    // 关闭对话界面
    close() {
        this._active = false;
        this._currentNPC = null;

        const dialogueBox = document.getElementById('npcDialogueBox');
        const npcPortrait = document.getElementById('npcPortrait');
        if (dialogueBox) dialogueBox.style.display = 'none';
        if (npcPortrait) npcPortrait.style.display = 'none';

        // 恢复游戏
        if (Game) Game._npcDialoguePaused = false;
    },

    // 逐字更新
    update() {
        if (!this._active) return;

        const dialogueText = document.getElementById('npcDialogueText');
        if (!dialogueText) return;

        // 如果还有字符未显示
        if (this._charIndex < this._currentText.length) {
            const now = Date.now();
            if (now - this._lastCharTime >= this._typewriterSpeed) {
                this._charIndex++;
                this._displayedText = this._currentText.substring(0, this._charIndex);
                dialogueText.textContent = this._displayedText;
                this._lastCharTime = now;
            }
        } else if (!this._optionsVisible) {
            // 全部显示完成后，显示选项
            this._optionsVisible = true;
            const dialogueOptions = document.getElementById('npcDialogueOptions');
            if (dialogueOptions) dialogueOptions.style.display = 'flex';
        }
    },

    // 跳过逐字动画（点击时）
    skip() {
        if (!this._active) return;
        this._charIndex = this._currentText.length;
        this._displayedText = this._currentText;
        const dialogueText = document.getElementById('npcDialogueText');
        if (dialogueText) dialogueText.textContent = this._displayedText;
        this._optionsVisible = true;
        const dialogueOptions = document.getElementById('npcDialogueOptions');
        if (dialogueOptions) dialogueOptions.style.display = 'flex';
    },

    // 选择商店
    openShop() {
        this.close();
        ShopSystem.open();
    },

    // 选择强化
    openEnhance() {
        this.close();
        EnhanceSystem.open();
    },

    get active() { return this._active; }
};

export { NPCDialogue };
