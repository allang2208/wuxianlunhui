/**
 * ImageLoader — 统一的图片加载小工具
 * 减少 `new Image(); img.src = ...` 的重复样板代码。
 */

/**
 * 创建并返回一个已设置 src 的 Image 对象。
 * @param {string} src
 * @returns {HTMLImageElement}
 */
export function loadImage(src) {
    const img = new Image();
    img.src = src;
    return img;
}

/**
 * 加载一组序列帧图片。
 * @param {string} prefix 路径前缀，例如 'assets/weapons/bow_frame_'
 * @param {number} count 帧数量
 * @param {number} [pad=2] 序号补零位数
 * @param {string} [extension='.png']
 * @returns {HTMLImageElement[]}
 */
export function loadImageFrames(prefix, count, pad = 2, extension = '.png') {
    const frames = [];
    for (let i = 1; i <= count; i++) {
        frames.push(loadImage(`${prefix}${String(i).padStart(pad, '0')}${extension}`));
    }
    return frames;
}
