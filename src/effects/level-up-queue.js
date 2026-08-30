import { TimerManager } from '../utils/timer-manager.js';
import { SoundManager } from '../ui/sound-manager.js';
import { TopNotificationQueue } from '../ui/top-notification-queue.js';
import audioConfig from '../../data/audio-config.json';
// 升级入口保留；每条立即进入全局提示FIFO，不再持有独立的升级播放队列。

const LevelUpEffectQueue = {
    _DEFAULT_DURATION: 2800, // 默认特效持续时间(ms)

    /**
     * 添加一个特效到队列
     * @param {Object} effect - 特效对象
     * @param {string} effect.type - 'playerLevelUp' | 'skillLevelUp'
     * @param {number} effect.level - 等级
     * @param {string} effect.title - 标题文字
     * @param {string} effect.effectText - 效果描述
     * @param {string} effect.icon - 图标
     * @param {function} effect.onShow - 旧命名：升级属性提交回调，入队时立即执行一次，不随显示延后
     * @param {number} [effect.duration] - 持续时间，默认2800ms
     */
    add(effect) {
        const { onShow, ...visual } = effect;
        const requestedDuration = Number(visual.duration);
        const duration = Number.isFinite(requestedDuration) && requestedDuration > 0
            ? Math.max(500, requestedDuration) : this._DEFAULT_DURATION;
        // 先登记触发顺序，再执行升级提交。永久属性不能等待排队，也不能被clear取消。
        try {
            TopNotificationQueue.enqueue({
                group: 'level-up', duration,
                render: (host, ms) => this._renderEffect(visual, host, ms),
            });
        } finally {
            if (typeof onShow === 'function') onShow();
        }
    },

    _renderEffect(effect, host, duration) {
        if (effect.type === 'playerLevelUp' || effect.type === 'skillLevelUp') {
            const path = audioConfig.uiCues?.playerUpgrade;
            if (path) SoundManager.playFile(path, 1, 'ui');
        }

        // 屏幕闪光
        const flash = document.createElement('div');
        flash.className = 'screen-flash';
        host.appendChild(flash);

        // 升级文字提示
        const text = document.createElement('div');
        text.className = 'level-up-text';
        text.style.setProperty('--bp-upgrade-duration', `${Math.min(2500, duration)}ms`);
        const iconHtml = effect.iconImage
            ? `<span class="lu-icon"><img src="${effect.iconImage}" onerror="this.style.display='none';this.parentElement.textContent='${effect.icon || '⭐'}';"></span>`
            : `<span class="lu-icon">${effect.icon || '⭐'}</span>`;
        text.innerHTML = `
            ${iconHtml}
            <span class="lu-title">${effect.title}</span>
            <span class="lu-effect">${effect.effectText || ''}</span>
        `;
        host.appendChild(text);
        const flashTimer = TimerManager.setTimeout(() => flash.remove(), 500);
        // 主文字随共享播放槽收尾；提前清理时连同闪光计时器一并撤销。
        return () => TimerManager.clearTimeout(flashTimer);
    },

    // 清空队列（如离开NPC时）
    clear() {
        TopNotificationQueue.clear('level-up');
    },

    // 获取队列长度
    get length() { return TopNotificationQueue.pendingCount('level-up'); }
};

export { LevelUpEffectQueue };
