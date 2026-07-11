/**
 * TimerManager — 统一的定时器管理
 * 对原生 setTimeout / setInterval 做薄封装，集中保存句柄，便于场景切换时统一清理。
 */

const activeTimeouts = new Set();
const activeIntervals = new Set();

export const TimerManager = {
    /**
     * @param {Function} callback
     * @param {number} delayMs
     * @returns {number}
     */
    setTimeout(callback, delayMs) {
        const id = setTimeout(() => {
            activeTimeouts.delete(id);
            callback();
        }, delayMs);
        activeTimeouts.add(id);
        return id;
    },

    /**
     * @param {Function} callback
     * @param {number} intervalMs
     * @returns {number}
     */
    setInterval(callback, intervalMs) {
        const id = setInterval(callback, intervalMs);
        activeIntervals.add(id);
        return id;
    },

    /**
     * @param {number} id
     */
    clearTimeout(id) {
        clearTimeout(id);
        activeTimeouts.delete(id);
    },

    /**
     * @param {number} id
     */
    clearInterval(id) {
        clearInterval(id);
        activeIntervals.delete(id);
    },

    /**
     * 清空所有由本管理器创建的定时器。
     */
    clearAll() {
        activeTimeouts.forEach(id => clearTimeout(id));
        activeIntervals.forEach(id => clearInterval(id));
        activeTimeouts.clear();
        activeIntervals.clear();
    }
};
