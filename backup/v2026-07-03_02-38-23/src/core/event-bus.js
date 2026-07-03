        export const EventBus = {
            _listeners: {},
            on(event, callback) {
                if (!this._listeners[event]) this._listeners[event] = [];
                this._listeners[event].push(callback);
            },
            off(event, callback) {
                if (!this._listeners[event]) return;
                const idx = this._listeners[event].indexOf(callback);
                if (idx !== -1) this._listeners[event].splice(idx, 1);
            },
            emit(event, ...args) {
                if (!this._listeners[event]) return;
                this._listeners[event].forEach(cb => cb(...args));
            },
            emitFirst(event, ...args) {
                if (!this._listeners[event] || this._listeners[event].length === 0) return undefined;
                return this._listeners[event][0](...args);
            }
        };
