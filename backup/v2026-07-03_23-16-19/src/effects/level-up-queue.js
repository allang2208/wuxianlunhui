// 效果队列系统：用于顺序播放升级/技能提升等特效
// 避免多个特效同时叠加显示

const LevelUpEffectQueue = {
    _queue: [],
    _isPlaying: false,
    _currentTimer: null,
    _DEFAULT_DURATION: 2800, // 默认特效持续时间(ms)

    /**
     * 添加一个特效到队列
     * @param {Object} effect - 特效对象
     * @param {string} effect.type - 'playerLevelUp' | 'skillLevelUp'
     * @param {number} effect.level - 等级
     * @param {string} effect.title - 标题文字
     * @param {string} effect.effectText - 效果描述
     * @param {string} effect.icon - 图标
     * @param {function} effect.onShow - 显示时的回调（如属性更新）
     * @param {number} [effect.duration] - 持续时间，默认2800ms
     */
    add(effect) {
        this._queue.push(effect);
        if (!this._isPlaying) {
            this._playNext();
        }
    },

    _playNext() {
        if (this._queue.length === 0) {
            this._isPlaying = false;
            return;
        }
        this._isPlaying = true;
        const effect = this._queue.shift();
        this._renderEffect(effect);
        const duration = effect.duration || this._DEFAULT_DURATION;
        this._currentTimer = setTimeout(() => {
            this._currentTimer = null;
            this._playNext();
        }, duration);
    },

    _renderEffect(effect) {
        // 屏幕闪光
        const flash = document.createElement('div');
        flash.className = 'screen-flash';
        document.body.appendChild(flash);
        setTimeout(() => { if (flash && flash.parentNode) flash.remove(); }, 500);

        // 升级文字提示
        const text = document.createElement('div');
        text.className = 'level-up-text';
        const iconHtml = effect.iconImage
            ? `<span class="lu-icon"><img src="${effect.iconImage}" onerror="this.style.display='none';this.parentElement.textContent='${effect.icon || '⭐'}';"></span>`
            : `<span class="lu-icon">${effect.icon || '⭐'}</span>`;
        text.innerHTML = `
            ${iconHtml}
            <span class="lu-title">${effect.title}</span>
            <span class="lu-effect">${effect.effectText || ''}</span>
        `;
        document.body.appendChild(text);
        setTimeout(() => { if (text && text.parentNode) text.remove(); }, 2500);

        // 执行回调（如属性更新）
        if (effect.onShow && typeof effect.onShow === 'function') {
            effect.onShow();
        }
    },

    // 清空队列（如离开NPC时）
    clear() {
        this._queue = [];
        if (this._currentTimer) {
            clearTimeout(this._currentTimer);
            this._currentTimer = null;
        }
        this._isPlaying = false;
        // 清除当前正在显示的 level-up-text
        document.querySelectorAll('.level-up-text').forEach(el => el.remove());
    },

    // 获取队列长度
    get length() { return this._queue.length; }
};

export { LevelUpEffectQueue };