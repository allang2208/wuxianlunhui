import { UIState } from '../ui-state.js';

const BASE_PANEL_INSTANCES = new Set();

/** 关闭指定分组内所有已打开的 BasePanel；返回实际关闭数量。 */
export function closeBasePanels(group = null) {
    let closed = 0;
    for (const panel of BASE_PANEL_INSTANCES) {
        if (!panel || !panel.isOpen) continue;
        if (group && panel.panelGroup !== group) continue;
        panel.close();
        closed++;
    }
    return closed;
}

function targetInsideOpenBasePanel(target, group = null) {
    if (!target) return false;
    for (const panel of BASE_PANEL_INSTANCES) {
        if (!panel || !panel.isOpen || !panel.el) continue;
        if (group && panel.panelGroup !== group) continue;
        if (panel.el.contains(target)) return true;
    }
    return false;
}

/**
 * 面板生命周期基类（抽屉式面板统一框架，新面板优先复用）
 *
 * 统一各面板重复的公共模式（仓库/合成/商店/强化/附魔等）：
 * - 懒构建单例 DOM（id + className），首次 open 时创建
 * - open/close/toggle：UIState 状态键 + active 类切换（抽屉动画由 CSS className 自带）
 * - 遮罩层点击关闭（#panelOverlay，多面板共存各自判断 isOpen）
 * - 子类只需实现 buildContent(el)（填充内部 HTML/绑定事件）与可选 onOpen/onClose 钩子
 *
 * 用法（对象字面量系统同样适用）：
 *   this._panel = new BasePanel({ id: 'myPanel', className: 'my-panel', stateKey: 'myPanel' });
 *   this._panel.buildContent = (el) => { el.innerHTML = '...'; 绑定事件; };
 *   this._panel.onOpen = () => { 刷新数据/联动打开其他面板; };
 *   this._panel.open(); this._panel.close(); this._panel.toggle();
 */
export class BasePanel {
    /**
     * @param {{
     *  id:string,
     *  className:string,
     *  stateKey?:string,
     *  panelGroup?:string,
     *  closeOnEscape?:boolean,
     *  closeOnOutsidePointer?:boolean
     * }} opts
     */
    constructor({
        id,
        className,
        stateKey,
        panelGroup = null,
        closeOnEscape = false,
        closeOnOutsidePointer = false,
    }) {
        if (!id || !className) throw new Error('[BasePanel] id 与 className 必填');
        this.id = id;
        this.className = className;
        this.stateKey = stateKey || id;
        this.panelGroup = panelGroup;
        this.closeOnEscape = closeOnEscape;
        this.closeOnOutsidePointer = closeOnOutsidePointer;
        this._built = false;
        /** @type {HTMLDivElement|null} */
        this.el = null;
        BASE_PANEL_INSTANCES.add(this);
    }

    get isOpen() { return UIState.isOpen(this.stateKey); }

    open() {
        if (this.isOpen) return;
        UIState.open(this.stateKey);
        this._ensureBuilt();
        this.el.classList.add('active');
        this._openedAt = Date.now();
        this.onOpen();
    }

    close() {
        if (!this.isOpen) return;
        UIState.close(this.stateKey);
        if (this.el) this.el.classList.remove('active');
        this.onClose();
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    _ensureBuilt() {
        if (this._built) return;
        this._built = true;
        const el = document.createElement('div');
        el.id = this.id;
        el.className = this.className;
        this.el = el;
        this.buildContent(el);
        document.body.appendChild(el);
        // 遮罩层点击关闭（每个实例各自挂监听并判断自身 isOpen，多面板共存）；
        // 忽略打开后 300ms 内的点击——打开动作本身的 click 事件（mousedown→面板开→mouseup→click）
        // 会落在刚激活的遮罩上，不拦截会导致"点开瞬间被关"（仓库点击打不开的根因）
        const overlay = document.getElementById('panelOverlay');
        if (overlay) {
            overlay.addEventListener('click', () => {
                if (!this.isOpen) return;
                if (Date.now() - (this._openedAt || 0) < 300) return;
                this.close();
            });
        }
        if (this.closeOnOutsidePointer) {
            window.addEventListener('mousedown', (event) => {
                if (!this.isOpen || (event.button !== 0 && event.button !== 2)) return;
                if (Date.now() - (this._openedAt || 0) < 300) return;
                if (targetInsideOpenBasePanel(event.target, this.panelGroup)) return;
                const closed = closeBasePanels(this.panelGroup);
                if (closed > 0) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                }
            }, true);
        }
        if (this.closeOnEscape) {
            window.addEventListener('keydown', (event) => {
                if (event.code !== 'Escape' || !this.isOpen) return;
                const closed = closeBasePanels(this.panelGroup);
                if (closed > 0) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                }
            }, true);
        }
    }

    /** 子类实现：填充面板内容与事件绑定（仅在首次 open 时调用一次） */
    buildContent(_el) {}

    /** 打开钩子（刷新数据/联动等） */
    onOpen() {}

    /** 关闭钩子 */
    onClose() {}
}
