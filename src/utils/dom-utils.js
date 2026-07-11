/**
 * DOM 安全工具
 * 提供带 null 检查的 getElementById / querySelector 封装，
 * 减少硬编码 DOM 操作和未处理缺失元素导致的运行时错误。
 */

/**
 * 安全获取元素。若元素不存在则返回 null，并在开发环境输出警告。
 * @param {string} id
 * @returns {HTMLElement | null}
 */
export function getElement(id) {
    const el = document.getElementById(id);
    if (!el) {
        console.warn(`[DOMUtils] Element with id "${id}" not found`);
    }
    return el;
}

/**
 * 安全查询单个元素。
 * @param {string} selector
 * @param {ParentNode} [parent=document]
 * @returns {HTMLElement | null}
 */
export function queryElement(selector, parent = document) {
    const el = parent.querySelector(selector);
    if (!el) {
        console.warn(`[DOMUtils] Element matching "${selector}" not found`);
    }
    return el;
}

/**
 * 安全查询所有匹配元素。
 * @param {string} selector
 * @param {ParentNode} [parent=document]
 * @returns {NodeListOf<HTMLElement>}
 */
export function queryAllElements(selector, parent = document) {
    return parent.querySelectorAll(selector);
}

/**
 * 安全设置 innerHTML。若元素不存在则静默忽略。
 * @param {HTMLElement | null} el
 * @param {string} html
 */
export function setHTML(el, html) {
    if (!el) return;
    el.innerHTML = html;
}

/**
 * 安全清空元素内容。
 * @param {HTMLElement | null} el
 */
export function clearElement(el) {
    if (!el) return;
    el.innerHTML = '';
}

/**
 * 安全设置文本内容。
 * @param {HTMLElement | null} el
 * @param {string} text
 */
export function setText(el, text) {
    if (!el) return;
    el.textContent = text;
}

/**
 * 安全切换 class。
 * @param {HTMLElement | null} el
 * @param {string} className
 * @param {boolean} force
 */
export function toggleClass(el, className, force) {
    if (!el) return;
    el.classList.toggle(className, force);
}
