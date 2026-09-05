import { TimerManager } from '../utils/timer-manager.js';

// 旧顶部通知的显式颜色归档；新调用使用tone，不从文案推断语义。
const COLOR_TONES = Object.fromEntries([
    ['info', ['#d4c5a9', '#9fdfff']],
    ['success', ['#b9e7b0', '#7fe0c8', '#8ee6ff', '#b8a8ff', '#d7c99b', '#ffd07a']],
    ['warning', ['#d8a26a', '#ffcc66', '#ffb86a', '#ffbf69', '#ffad4d', '#ffd166', '#ff9a3c', '#a9c2b3', '#c8d8cc', '#9fb2a7']],
    ['danger', ['#ff7766', '#ff5555', '#ff765c', '#ff3d3d', '#ff6655', '#ff4444', '#d58cff']],
].flatMap(([tone, colors]) => colors.map(color => [color, tone])));

/** 顶部瞬态提示唯一播放槽。只排视觉，不承载升级/奖励/开门等游戏状态变更。 */
export const TopNotificationQueue = {
    _pending: [],
    _active: null,

    /** render(host, duration)同步挂载本条内容，可返回附属特效的清理函数。 */
    enqueue({ group = 'notice', duration = 3000, render, onComplete = null }) {
        if (typeof document === 'undefined' || !document.body || typeof render !== 'function') return;
        const ms = Number(duration);
        this._pending.push({
            group,
            duration: Number.isFinite(ms) && ms > 0 ? ms : 3000,
            render,
            onComplete: typeof onComplete === 'function' ? onComplete : null,
        });
        this._drain();
    },

    show(text, options = {}) {
        const message = String(text ?? '');
        const legacyColor = typeof options.color === 'string' ? options.color.trim().toLowerCase() : '';
        const explicitTone = ['info', 'success', 'warning', 'danger'].includes(options.tone);
        const tone = explicitTone ? options.tone : (COLOR_TONES[legacyColor] || 'info');
        const customColor = !explicitTone && legacyColor && !COLOR_TONES[legacyColor] ? options.color : null;
        const headline = options.emphasis === 'headline' || Number.parseFloat(options.fontSize) >= 24;
        this.enqueue({
            duration: options.duration || 3000,
            onComplete: options.onComplete,
            render(host, duration) {
                const label = document.createElement('div');
                label.className = `top-notification top-notification--${tone}${headline ? ' top-notification--headline' : ''}`;
                label.style.setProperty('--bp-notice-duration', `${duration}ms`);
                if (customColor) label.style.setProperty('--bp-notice-color', customColor);
                label.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
                label.textContent = message;
                host.appendChild(label);
            },
        });
    },

    _drain() {
        if (this._active || TimerManager.isPaused()) return;
        while (this._pending.length && !this._active && !TimerManager.isPaused()) {
            const entry = this._pending.shift();
            const host = document.createElement('div');
            host.id = 'topNotificationHost';
            host.className = 'top-notification-host';
            const active = { entry, host, timer: null, dispose: null };
            this._active = active; // 先占槽，render间接触发的新提示只能排到队尾。
            try {
                document.body.appendChild(host);
                active.dispose = entry.render(host, entry.duration);
                if (this._active !== active) {
                    active.dispose?.();
                    host.remove();
                    continue;
                }
                active.timer = TimerManager.setTimeout(() => this._finish(active), entry.duration);
            } catch (error) {
                console.error('[TopNotificationQueue] 提示渲染失败:', error);
                this._finish(active, { advance: false, completed: false });
            }
        }
    },

    _finish(active, { advance = true, completed = true } = {}) {
        if (this._active !== active) return;
        if (active.timer !== null) TimerManager.clearTimeout(active.timer);
        try { active.dispose?.(); }
        catch (error) { console.error('[TopNotificationQueue] 提示清理失败:', error); }
        finally {
            active.host.remove();
            this._active = null;
        }
        if (completed && active.entry.onComplete) {
            try { active.entry.onComplete(); }
            catch (error) { console.error('[TopNotificationQueue] 完成回调失败:', error); }
        }
        if (advance) this._drain();
    },

    /** 不传group清空本轮所有提示；按组取消时保留其它来源的先后顺序。 */
    clear(group = null) {
        this._pending = group === null ? [] : this._pending.filter(entry => entry.group !== group);
        if (this._active && (group === null || this._active.entry.group === group)) {
            this._finish(this._active, { advance: group !== null, completed: false });
        }
    },

    pendingCount(group) {
        return this._pending.filter(entry => entry.group === group).length;
    },
};

// TimerManager负责剩余时间；CSS必须同步冻结，否则暂停时文字先淡出，恢复后留下空白等待。
const unsubscribe = TimerManager.subscribeLifecycle(event => {
    if (event === 'clear') { TopNotificationQueue.clear(); return; }
    TopNotificationQueue._active?.host.classList.toggle('is-paused', event === 'pause');
    if (event === 'resume') TopNotificationQueue._drain();
});

if (import.meta.hot) import.meta.hot.dispose(() => {
    unsubscribe();
    TopNotificationQueue.clear();
});
