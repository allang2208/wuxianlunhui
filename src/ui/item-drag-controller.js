// 游戏内物品的鼠标拖动适配层：不进入系统原生 DnD，业务仍消费原 DragEvent/DataTransfer。
// 不接管技能、文本、外部文件或触屏拖动；监听器仅注册一次，空闲时没有帧循环。
const ITEM_SOURCES = [
    '.inv-cell', '.diablo-slot', '.wh-cell', '.companion-cell',
    '.craft-mod-cell', '#craftDropZone.has-item',
    '#enchantScrollSlot.occupied', '#enchantEquipSlot.occupied', '.quick-slot',
].map(selector => `${selector}[draggable="true"]`).join(',');
const ACTIVE_CLASS = 'item-drag-active';
const START_DISTANCE = 6;

export const ItemDragController = {
    _initialized: false,
    _state: null,
    _suppressClick: false,

    init(hooks) {
        this._hooks = hooks;
        if (this._initialized) return;
        this._initialized = true;
        window.addEventListener('pointerdown', e => this._onDown(e), true);
        window.addEventListener('pointermove', e => this._onMove(e), true);
        window.addEventListener('pointerup', e => this._onUp(e), true);
        window.addEventListener('pointercancel', e => {
            if (e.pointerId === this._state?.pointerId) this._finish(true);
        }, true);
        window.addEventListener('lostpointercapture', e => {
            if (e.pointerId === this._state?.pointerId) this._finish(true);
        }, true);
        window.addEventListener('blur', () => this._finish(true));
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this._finish(true);
        });
        window.addEventListener('keydown', e => {
            if (!this._state?.active) {
                if (e.key === 'Escape') this._finish(true);
                return;
            }
            // 与原生拖放一致：拖动期间不触发快捷键/面板切换；Esc 只取消本次拖动。
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.key === 'Escape') this._finish(true);
        }, true);
        window.addEventListener('contextmenu', e => {
            if (!this._state?.active) return;
            e.preventDefault();
            e.stopImmediatePropagation();
        }, true);
        window.addEventListener('click', e => {
            if (!this._suppressClick || e.detail === 0) return;
            e.preventDefault();
            e.stopImmediatePropagation();
        }, true);
        window.addEventListener('dragstart', e => {
            // 只取消原生起拖，不取消最初按下，保留短按、双击和控件焦点行为。
            if (!e.isTrusted || !this._state) return;
            e.preventDefault();
            e.stopImmediatePropagation();
        }, true);
    },

    _onDown(e) {
        if (this._state?.active) {
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }
        this._state = null;
        this._suppressClick = false;
        if (e.button !== 0 || e.pointerType !== 'mouse') return;
        const target = e.target;
        if (target.closest?.('input, textarea, select, button, a, [contenteditable="true"]')) return;
        const source = target.closest?.(ITEM_SOURCES);
        if (!source || !source.ondragstart) return;
        if (source.matches('.quick-slot') && !source.querySelector('.item-assigned')) return;
        this._state = {
            source, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
            activePanel: source.closest('.active'),
            point: e, active: false, target: null, frame: 0, lastOver: 0,
        };
    },

    _onMove(e) {
        const state = this._state;
        if (!state || e.pointerId !== state.pointerId) return;
        state.point = e;
        if (!(e.buttons & 1)) {
            this._finish(true);
            return;
        }
        if (!state.active) {
            if (Math.hypot(e.clientX - state.startX, e.clientY - state.startY) < START_DISTANCE) return;
            this._start(state);
        }
        if (!state.active) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        state.moved = true;
    },

    _onUp(e) {
        const state = this._state;
        if (!state || e.pointerId !== state.pointerId || e.button !== 0) return;
        state.point = e;
        if (state.active) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
        this._finish(false);
    },

    _sourceAlive(state) {
        return state.source.isConnected && state.source.matches(ITEM_SOURCES)
            && (!state.activePanel || state.activePanel.classList.contains('active'))
            && state.source.getClientRects().length > 0;
    },

    _start(state) {
        if (!this._sourceAlive(state)) {
            this._state = null;
            return;
        }
        this._hooks.beforeStart();
        state.transfer = new DataTransfer();
        state.active = true;
        this._suppressClick = true;
        document.documentElement.classList.add(ACTIVE_CLASS);
        try {
            const start = this._emit(state.source, 'dragstart', state);
            if (start.defaultPrevented || !state.transfer.types.length) {
                this._finish(true);
                return;
            }
            state.preview = this._makePreview(state.source);
            state.preview.style.transform = `translate3d(${state.point.clientX + 18}px, ${state.point.clientY + 18}px, 0)`;
            document.body.appendChild(state.preview);
            // 捕获到稳定根节点，目标仍通过真实坐标命中；物品格刷新不会丢失松手事件。
            document.documentElement.setPointerCapture(state.pointerId);
        } catch (error) {
            this._finish(true);
            throw error;
        }
        state.moved = true;
        const tick = time => {
            if (this._state !== state) return;
            if (!this._sourceAlive(state)) {
                this._finish(true);
                return;
            }
            const dt = Math.min(32, time - (state.lastFrame || time));
            state.lastFrame = time;
            if (state.moved || time - state.lastOver >= 80) {
                this._updateTarget(state);
                state.preview.style.transform = `translate3d(${state.point.clientX + 18}px, ${state.point.clientY + 18}px, 0)`;
                state.moved = false;
                state.lastOver = time;
            }
            if (this._scrollAtEdge(state, dt)) state.moved = true;
            state.frame = requestAnimationFrame(tick);
        };
        state.frame = requestAnimationFrame(tick);
    },

    _emit(target, type, state, relatedTarget = null, cancelled = false) {
        const point = state.point;
        const event = new DragEvent(type, {
            bubbles: true, cancelable: true, view: window, dataTransfer: state.transfer,
            clientX: point.clientX, clientY: point.clientY,
            screenX: point.screenX, screenY: point.screenY,
            ctrlKey: point.ctrlKey, altKey: point.altKey,
            shiftKey: point.shiftKey, metaKey: point.metaKey,
            buttons: type === 'dragend' || type === 'drop' ? 0 : 1, relatedTarget,
        });
        event.itemDragManaged = true;
        event.itemDragCancelled = cancelled;
        target.dispatchEvent(event);
        return event;
    },

    _updateTarget(state) {
        const next = document.elementFromPoint(state.point.clientX, state.point.clientY);
        if (next !== state.target) {
            const previous = state.target;
            if (previous) this._emit(previous, 'dragleave', state, next);
            state.target = next;
            if (next) this._emit(next, 'dragenter', state, previous);
            // 只在跨目标时查找滚动容器，避免每帧扫描 DOM/计算样式。
            state.scrollParent = null;
            for (let node = next; node && node !== document.body; node = node.parentElement) {
                if (node.scrollHeight <= node.clientHeight + 1) continue;
                if (!/^(auto|scroll)$/.test(getComputedStyle(node).overflowY)) continue;
                state.scrollParent = node;
                break;
            }
        }
        state.transfer.dropEffect = 'move';
        state.accepted = !!next && this._emit(next, 'dragover', state).defaultPrevented
            && state.transfer.dropEffect !== 'none';
        if (!state.accepted) state.transfer.dropEffect = 'none';
    },

    _scrollAtEdge(state, dt) {
        const node = state.scrollParent;
        if (!node?.isConnected) return false;
        const rect = node.getBoundingClientRect();
        const edge = Math.min(24, rect.height / 4);
        const y = state.point.clientY;
        const direction = y < rect.top + edge ? -1 : y > rect.bottom - edge ? 1 : 0;
        if (!direction) return false;
        const previous = node.scrollTop;
        node.scrollTop += direction * dt * 0.35;
        return previous !== node.scrollTop;
    },

    _makePreview(source) {
        // 配件格拖动的是整把武器；不能把配件图标误当成正在移动的物品。
        const visual = source.matches('.craft-mod-cell')
            ? document.getElementById('craftWeaponDisplay') || source : source;
        const preview = document.createElement('div');
        preview.className = 'item-drag-preview';
        preview.setAttribute('aria-hidden', 'true');
        const original = visual.querySelector('img');
        if (original?.currentSrc || original?.src) {
            const icon = document.createElement('img');
            icon.src = original.currentSrc || original.src;
            icon.alt = '';
            icon.draggable = false;
            preview.appendChild(icon);
        } else {
            const label = visual.querySelector('.item-assigned, .inv-name, .slot-name, .companion-item-name, #enchantScrollDisplay, #enchantEquipDisplay');
            preview.textContent = (label?.textContent || visual.textContent || '').trim().slice(0, 12);
        }
        return preview;
    },

    _finish(cancelled) {
        const state = this._state;
        if (!state) return;
        // 先解除当前状态，避免 releasePointerCapture/源刷新产生的事件重复结束。
        this._state = null;
        if (!state.active) return;
        cancelAnimationFrame(state.frame);
        cancelled ||= !this._sourceAlive(state);
        try {
            if (!cancelled) {
                this._updateTarget(state);
                // dragover 可能刚把快捷栏抬到面板上方；按新层级再命中一次才投放。
                if (document.elementFromPoint(state.point.clientX, state.point.clientY) !== state.target) {
                    this._updateTarget(state);
                }
                // 移出应用窗口松手视为取消，不沿用最后坐标误丢弃物品。
                cancelled = !state.target;
                if (!cancelled && state.accepted) this._emit(state.target, 'drop', state);
            }
        } finally {
            try {
                if (cancelled) state.transfer.dropEffect = 'none';
                this._hooks.beforeEnd(cancelled);
                this._emit(state.source, 'dragend', state, null, cancelled);
            } finally {
                if (state.target) this._emit(state.target, 'dragleave', state);
                state.preview?.remove();
                document.documentElement.classList.remove(ACTIVE_CLASS);
                if (document.documentElement.hasPointerCapture(state.pointerId)) {
                    document.documentElement.releasePointerCapture(state.pointerId);
                }
                this._hooks.afterEnd();
            }
        }
    },
};
