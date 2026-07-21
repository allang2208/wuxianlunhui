/**
 * layout.js — 全局统一的分辨率适配/图层定位系统
 *
 * 默认约定（全项目统一，新图层/栏目直接用，不要再各自实现）：
 * - 基准分辨率 1920×1080（坐标均以此记录）
 * - bottom 锚定优先（图片底部贴视口底部，位置不随分辨率漂移）
 * - cover 铺满（无黑边）
 * - 坐标用游戏内开发工具的坐标工具实测后换算到基准分辨率填入 spec
 *
 * 提供四个函数：
 * - coverRect：图片 cover 铺满 + 锚点（背景图/立绘）
 * - anchorRect：实测坐标等比适配（面板/地图区域）
 * - clampToArea：拖动/缩放钳制（与 anchorRect 同源，禁止两套区域）
 * - applyPanelPos：给 DOM 面板一次性应用 anchorRect 定位
 */

/** 全项目统一的适配基准分辨率 */
export const BASE_RESOLUTION = { width: 1920, height: 1080 };

/**
 * cover 铺满 + 锚点定位（背景图/立绘）。
 * @param {number} imgW 图片原始宽
 * @param {number} imgH 图片原始高
 * @param {number} viewW 视口宽
 * @param {number} viewH 视口高
 * @param {'bottom'|'top'|'center'} [anchor='bottom'] 垂直锚点
 * @returns {{scale:number, w:number, h:number, x:number, y:number}}
 */
export function coverRect(imgW, imgH, viewW, viewH, anchor = 'bottom') {
    const scale = Math.max(viewW / imgW, viewH / imgH);
    const w = imgW * scale;
    const h = imgH * scale;
    let x = (viewW - w) / 2;
    let y;
    if (anchor === 'bottom') y = viewH - h;
    else if (anchor === 'top') y = 0;
    else y = (viewH - h) / 2;
    return { scale, w, h, x, y };
}

/**
 * 实测坐标等比适配（1920×1080 基准）。
 * spec 为基准分辨率下的像素值：{ left, bottom, width, height }。
 * left/bottom 固定像素；width/height 按视口比例等比缩放；top 由 bottom 锚定推出。
 * @param {{left:number, bottom:number, width:number, height:number}} spec
 * @param {number} viewW 视口宽
 * @param {number} viewH 视口高
 * @returns {{left:number, top:number, width:number, height:number}}
 */
export function anchorRect(spec, viewW, viewH) {
    const scaleX = viewW / BASE_RESOLUTION.width;
    const scaleY = viewH / BASE_RESOLUTION.height;
    const width = Math.round(spec.width * scaleX);
    const height = Math.round(spec.height * scaleY);
    return {
        left: spec.left,
        top: viewH - spec.bottom - height,
        width,
        height
    };
}

/**
 * 拖动/缩放钳制到指定区域（必须与 anchorRect 同源，禁止两套区域计算）。
 * @param {{x:number, y:number}} offset 当前偏移
 * @param {{left:number, top:number, width:number, height:number}} area 区域（anchorRect 结果）
 * @param {number} contentW 内容宽
 * @param {number} contentH 内容高
 * @returns {{x:number, y:number}} 钳制后的偏移
 */
export function clampToArea(offset, area, contentW, contentH) {
    let minX = area.left + area.width - contentW;
    let maxX = area.left;
    if (minX > maxX) { const t = minX; minX = maxX; maxX = t; }
    let minY = area.top + area.height - contentH;
    let maxY = area.top;
    if (minY > maxY) { const t = minY; minY = maxY; maxY = t; }
    return {
        x: Math.min(maxX, Math.max(minX, offset.x)),
        y: Math.min(maxY, Math.max(minY, offset.y))
    };
}

/**
 * 给 DOM 面板应用 anchorRect 定位（position:fixed + left/top/width/height）。
 * @param {HTMLElement} el
 * @param {{left:number, bottom:number, width:number, height:number}} spec 1920×1080 基准坐标
 * @param {number} viewW 视口宽
 * @param {number} viewH 视口高
 * @returns {{left:number, top:number, width:number, height:number}}
 */
export function applyPanelPos(el, spec, viewW, viewH) {
    const r = anchorRect(spec, viewW, viewH);
    el.style.position = 'fixed';
    el.style.left = r.left + 'px';
    el.style.top = r.top + 'px';
    el.style.width = r.width + 'px';
    el.style.height = r.height + 'px';
    return r;
}
