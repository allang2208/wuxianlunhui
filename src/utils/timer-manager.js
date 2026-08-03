/**
 * TimerManager — 统一的定时器管理
 * 对原生 setTimeout / setInterval 做薄封装，集中保存句柄，便于场景切换时统一清理。
 * 支持暂停/恢复：游戏菜单/暂停时冻结全部定时器（剩余时长保留，恢复后续跑；
 * 暂停期间新注册的定时器按完整时长排队，恢复后调度——游戏时间冻结语义）。
 */

let _paused = false;
let _nextId = 1;
// 逻辑 id → 定时器条目（运行中，持原生句柄）
const timers = new Map();
// 冻结条目（暂停时从 timers 移入；暂停中新注册的也先入队）
const frozen = [];

/** entry: { id, kind: 'timeout'|'interval', callback, delay, remaining, nextAt, handle } */
function _armTimeout(entry, ms) {
    entry.nextAt = Date.now() + ms;
    entry.handle = setTimeout(() => {
        if (!timers.has(entry.id)) return;
        timers.delete(entry.id);
        try { entry.callback(); } catch (e) { console.error('[TimerManager] timeout callback error:', e); }
    }, Math.max(1, ms));
}

function _armInterval(entry, ms) {
    entry.nextAt = Date.now() + ms;
    entry.handle = setTimeout(() => {
        if (!timers.has(entry.id)) return;
        try { entry.callback(); } catch (e) { console.error('[TimerManager] interval callback error:', e); }
        // 回调内可能已 clear 自己，检查后再续下一轮
        if (!timers.has(entry.id)) return;
        _armInterval(entry, entry.delay);
    }, Math.max(1, ms));
}

function _register(entry, ms) {
    if (_paused) {
        // 暂停期间：按完整时长排队，恢复后调度
        entry.remaining = ms;
        frozen.push(entry);
        return entry.id;
    }
    if (entry.kind === 'interval') _armInterval(entry, ms);
    else _armTimeout(entry, ms);
    timers.set(entry.id, entry);
    return entry.id;
}

function _clear(id) {
    const e = timers.get(id);
    if (e) {
        clearTimeout(e.handle);
        timers.delete(id);
        return;
    }
    const fi = frozen.findIndex(x => x.id === id);
    if (fi >= 0) frozen.splice(fi, 1);
}

export const TimerManager = {
    /**
     * @param {Function} callback
     * @param {number} delayMs
     * @returns {number} 逻辑 id（clearTimeout 用）
     */
    setTimeout(callback, delayMs) {
        const id = _nextId++;
        _register({ id, kind: 'timeout', callback, delay: delayMs, remaining: delayMs }, delayMs);
        return id;
    },

    /**
     * @param {Function} callback
     * @param {number} intervalMs
     * @returns {number} 逻辑 id（clearInterval 用）
     */
    setInterval(callback, intervalMs) {
        const id = _nextId++;
        _register({ id, kind: 'interval', callback, delay: intervalMs, remaining: intervalMs }, intervalMs);
        return id;
    },

    clearTimeout(id) {
        _clear(id);
    },

    clearInterval(id) {
        _clear(id);
    },

    /** 清空所有由本管理器创建的定时器（含冻结队列） */
    clearAll() {
        timers.forEach(e => clearTimeout(e.handle));
        timers.clear();
        frozen.length = 0;
    },

    /** 是否处于暂停态 */
    isPaused() {
        return _paused;
    },

    /** 暂停全部定时器：记录剩余时长并清掉原生句柄 */
    pause() {
        if (_paused) return;
        _paused = true;
        const now = Date.now();
        for (const [, e] of timers) {
            clearTimeout(e.handle);
            e.handle = null;
            e.remaining = Math.max(0, e.nextAt - now);
            frozen.push(e);
        }
        timers.clear();
    },

    /** 恢复：按剩余时长重新调度（interval 保留原相位） */
    resume() {
        if (!_paused) return;
        _paused = false;
        const queue = frozen.splice(0);
        for (const e of queue) {
            if (e.kind === 'interval') _armInterval(e, Math.max(1, e.remaining));
            else _armTimeout(e, Math.max(1, e.remaining));
            timers.set(e.id, e);
        }
    },

    /** 便捷开关（P 键暂停/菜单开合用） */
    setPaused(paused) {
        if (paused) this.pause();
        else this.resume();
    },
};
