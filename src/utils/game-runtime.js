import { TimerManager } from './timer-manager.js';

const STORAGE_KEY = 'wuxian_run_in_background';
const FRAME_DELAY_MS = 1000 / 60;

function readPreference() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (typeof saved === 'boolean') return saved;
    } catch (error) { console.warn('[GameRuntime] 后台运行设置读取失败:', error); }
    return true;
}

/** 窗口运行策略：只调度原有循环，不补算离线收益，不接管战斗或世界时钟。 */
export const GameRuntime = {
    _runInBackground: readPreference(),
    _game: null,
    _phaser: null,
    _initialized: false,
    _background: false,
    _nativeBackground: null,
    _pauseReasons: new Set(),
    _pauseListeners: new Set(),
    _lastPauseState: '',
    _frameHandle: null,
    _frameUsesTimeout: false,
    _settingsListeners: new Set(),
    _nativeRequest: 0,
    desktopStatus: 'pending',

    init(game) {
        this._game = game;
        if (this._initialized) return;
        this._initialized = true;
        const refresh = () => this._refreshBackground();
        window.addEventListener('blur', refresh);
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('electron-background-change', (event) => {
            if (typeof event.detail !== 'boolean') return;
            this._nativeBackground = event.detail;
            refresh();
        });
        refresh();
        this._applyDesktopPreference();
    },

    isBackgroundRunningEnabled() { return this._runInBackground; },

    setBackgroundRunning(enabled) {
        this._runInBackground = !!enabled;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._runInBackground)); }
        catch (error) { console.warn('[GameRuntime] 后台运行设置保存失败:', error); }
        this._sync();
        this._applyDesktopPreference();
    },

    subscribeSettings(listener) {
        this._settingsListeners.add(listener);
        return () => this._settingsListeners.delete(listener);
    },

    _notifySettings() {
        for (const listener of this._settingsListeners) listener();
    },

    async _applyDesktopPreference() {
        const request = ++this._nativeRequest;
        const apply = window.electronAPI?.setBackgroundRunning;
        if (typeof apply !== 'function') {
            this.desktopStatus = window.electronAPI ? 'unavailable' : 'browser';
            this._notifySettings();
            return;
        }
        this.desktopStatus = 'pending';
        this._notifySettings();
        try {
            await apply(this._runInBackground);
            if (request !== this._nativeRequest) return;
            this.desktopStatus = 'ready';
        } catch (error) {
            if (request !== this._nativeRequest) return;
            this.desktopStatus = 'failed';
            console.error('[GameRuntime] 桌面后台运行设置失败:', error);
        }
        this._notifySettings();
    },

    _refreshBackground() {
        // Electron 关闭节流后 document.hidden 可能一直为 false，以原生窗口状态为准。
        this._background = this._nativeBackground ?? (document.hidden || !document.hasFocus());
        this._sync();
    },

    setPaused(reason, paused) {
        if (paused) this._pauseReasons.add(reason);
        else this._pauseReasons.delete(reason);
        this._sync();
    },

    hasPauseOtherThan(reason) {
        return [...this._pauseReasons].some(value => value !== reason);
    },

    subscribePauseChanges(listener) {
        this._pauseListeners.add(listener);
        return () => this._pauseListeners.delete(listener);
    },

    attachPhaser(game) {
        this._phaser = game;
        game.events.once('destroy', () => {
            if (this._phaser === game) this._phaser = null;
        });
        this._sync();
    },

    startLoop() {
        this._game.lastTime = performance.now();
        this._sync();
    },

    _sync() {
        const game = this._game;
        if (!game) return;
        // 开始界面/首次加载不冻结 TimerManager，避免贴图准备尚未完成就被挂起。
        if (game.isRunning && this._background && !this._runInBackground) this._pauseReasons.add('background');
        else this._pauseReasons.delete('background');
        const paused = this._pauseReasons.size > 0;
        const pauseState = [...this._pauseReasons].sort().join(',');
        if (pauseState !== this._lastPauseState) {
            this._lastPauseState = pauseState;
            for (const listener of this._pauseListeners) listener();
        }
        if (game._paused !== paused) {
            game._paused = paused;
            game.lastTime = performance.now();
            TimerManager.setPaused(paused);
        }
        const useTimeout = this._runInBackground && this._background && !paused;
        if (paused || useTimeout !== this._frameUsesTimeout) this._cancelFrame();
        this._frameUsesTimeout = useTimeout;
        this._syncPhaser(paused, useTimeout);
        this.requestFrame();
    },

    _syncPhaser(paused, useTimeout) {
        const game = this._phaser;
        if (!game) return;
        const loop = game.loop;
        if (paused) game.pause();
        else if (game.isPaused) {
            // 主动暂停恢复不把暂停期间的时间作为一帧交给世界时钟。
            loop.resetDelta();
            game.resume();
        }
        if (loop.forceSetTimeOut === useTimeout) return;
        const wasRunning = loop.running;
        if (wasRunning) loop.sleep();
        loop.forceSetTimeOut = useTimeout;
        if (wasRunning) {
            loop.resetDelta();
            loop.wake();
        }
    },

    requestFrame() {
        if (!this._game?.isRunning || this._game._paused || this._frameHandle !== null) return;
        const step = (timestamp) => {
            this._frameHandle = null;
            this._game.loop(timestamp);
        };
        // 必须使用原生计时器；不能把恢复调度本身放入可暂停的 TimerManager。
        this._frameHandle = this._frameUsesTimeout
            ? window.setTimeout(() => step(performance.now()), FRAME_DELAY_MS)
            : window.requestAnimationFrame(step);
    },

    _cancelFrame() {
        if (this._frameHandle === null) return;
        if (this._frameUsesTimeout) window.clearTimeout(this._frameHandle);
        else window.cancelAnimationFrame(this._frameHandle);
        this._frameHandle = null;
    },
};
