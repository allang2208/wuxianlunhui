// 右侧栏目面板统一挂载层。
// 独立挂在 body，避免 #uiLayer / gameContainer 各自的堆叠上下文让 z-index 失效。
import audioConfig from '../../data/audio-config.json';
import { SoundManager } from './sound-manager.js';

const LAYER_ID = 'rightSidebarPanelLayer';
const PANEL_SOUND_BOUND = new WeakSet();

function isPanelOpen(element) {
    if (element.classList.contains('active')) return true;
    const inlineDisplay = element.style.display;
    return !!inlineDisplay && inlineDisplay !== 'none';
}

function bindPanelSound(element) {
    if (!element || PANEL_SOUND_BOUND.has(element) || typeof MutationObserver === 'undefined') return;
    PANEL_SOUND_BOUND.add(element);
    let wasOpen = isPanelOpen(element);
    const observer = new MutationObserver(() => {
        const open = isPanelOpen(element);
        if (open === wasOpen) return;
        wasOpen = open;
        const path = audioConfig.uiCues?.rightSidebarPanel;
        if (path && typeof SoundManager?.playFile === 'function') {
            SoundManager.playFile(path, 1, 'ui');
        }
    });
    observer.observe(element, { attributes: true, attributeFilter: ['class', 'style'] });
}

export function getRightSidebarPanelLayer() {
    let layer = document.getElementById(LAYER_ID);
    if (layer) return layer;
    layer = document.createElement('div');
    layer.id = LAYER_ID;
    layer.className = 'right-sidebar-panel-layer';
    document.body.appendChild(layer);
    return layer;
}

/**
 * @param {HTMLElement} element
 * @param {'backdrop'|'panel'|'modal'} role
 * @param {{bringToFront?:boolean}} options
 */
export function mountRightSidebarPanel(element, role = 'panel', { bringToFront = false } = {}) {
    if (!element) return null;
    const layer = getRightSidebarPanelLayer();
    element.classList.add('right-sidebar-layer-item', `right-sidebar-layer-item--${role}`);
    if (element.parentElement !== layer || bringToFront) layer.appendChild(element);
    // 普通右栏与从属模态都走同一开关音效；backdrop 不监听，避免面板+遮罩双响。
    if (role === 'panel' || role === 'modal') bindPanelSound(element);
    return element;
}
