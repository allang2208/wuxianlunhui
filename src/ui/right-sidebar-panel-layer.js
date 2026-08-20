// 右侧栏目面板统一挂载层。
// 独立挂在 body，避免 #uiLayer / gameContainer 各自的堆叠上下文让 z-index 失效。
const LAYER_ID = 'rightSidebarPanelLayer';

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
 */
export function mountRightSidebarPanel(element, role = 'panel') {
    if (!element) return null;
    const layer = getRightSidebarPanelLayer();
    element.classList.add('right-sidebar-layer-item', `right-sidebar-layer-item--${role}`);
    if (element.parentElement !== layer) layer.appendChild(element);
    return element;
}
