import { EventBus } from '../core/event-bus.js';

/**
 * UIState - 统一管理各 UI 面板的开关状态
 *
 * 用于替代各 UI 系统之间通过 window 直接访问 _isOpen 的耦合方式。
 * 面板打开/关闭时会通过 EventBus 发送 `ui:{panel}:open` / `ui:{panel}:close` 事件。
 */
export const UIState = {
    _state: {},

    isOpen(panel) {
        return !!this._state[panel];
    },

    open(panel) {
        if (this._state[panel]) return;
        this._state[panel] = true;
        EventBus.emit(`ui:${panel}:open`);
    },

    close(panel) {
        if (!this._state[panel]) return;
        this._state[panel] = false;
        EventBus.emit(`ui:${panel}:close`);
    },

    toggle(panel) {
        if (this._state[panel]) {
            this.close(panel);
        } else {
            this.open(panel);
        }
    },

    closeAll() {
        for (const panel in this._state) {
            if (this._state[panel]) this.close(panel);
        }
    }
};
