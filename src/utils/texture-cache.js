/**
 * 全局纹理缓存
 * 避免每个实体独立创建 Image 对象，减少内存和加载开销
 */

const TEXTURE_CACHE = new Map();

/**
 * 获取或创建纹理
 * @param {string} src - 图片路径
 * @returns {HTMLImageElement}
 */
export function getTexture(src) {
    if (!TEXTURE_CACHE.has(src)) {
        const img = new Image();
        img.src = src;
        TEXTURE_CACHE.set(src, img);
    }
    return TEXTURE_CACHE.get(src);
}

/**
 * 预加载一批纹理
 * @param {string[]} sources - 图片路径数组
 */
export function preloadTextures(sources) {
    sources.forEach(src => getTexture(src));
}

/**
 * 检查纹理是否已加载完成
 * @param {string} src - 图片路径
 * @returns {boolean}
 */
export function isTextureReady(src) {
    const img = TEXTURE_CACHE.get(src);
    return img && img.complete && img.naturalWidth > 0;
}

/**
 * 获取缓存大小（调试用）
 * @returns {number}
 */
export function getCacheSize() {
    return TEXTURE_CACHE.size;
}

/**
 * 清空缓存（场景切换时调用）
 */
export function clearTextureCache() {
    TEXTURE_CACHE.clear();
}
