const FOOT_ALPHA_THRESHOLD = 96;
const FOOT_SCAN_MIN_U = 0.20;
const FOOT_SCAN_MAX_U = 0.80;
const _footRatioCache = new Map();

/** 纯数学入口：把纹理内真实接触底边换算为 Sprite 中心到脚点的显示偏移。 */
export function footOffsetFromOpaqueBottom(displayHeight, frameHeight, opaqueBottomY) {
    const dh = Math.max(1, Number(displayHeight) || 1);
    const fh = Math.max(1, Number(frameHeight) || 1);
    const bottom = Math.max(0, Math.min(fh - 1, Number(opaqueBottomY) || 0));
    return ((bottom + 1) / fh - 0.5) * dh;
}

function _scanBottom(scene, textureKey, frameName) {
    const frame = scene?.textures?.getFrame(textureKey, frameName);
    if (!frame) return null;
    const width = frame.realWidth || frame.cutWidth || frame.width;
    const height = frame.realHeight || frame.cutHeight || frame.height;
    if (!(width > 0) || !(height > 0)) return null;
    const cacheKey = `${textureKey}:${String(frameName ?? frame.name)}:${width}x${height}`;
    if (_footRatioCache.has(cacheKey)) return _footRatioCache.get(cacheKey);

    const scan = (minX, maxX) => {
        for (let y = height - 1; y >= 0; y--) {
            for (let x = minX; x <= maxX; x++) {
                if (scene.textures.getPixelAlpha(x, y, textureKey, frameName) >= FOOT_ALPHA_THRESHOLD) {
                    return y;
                }
            }
        }
        return null;
    };
    // 等距建筑的真实前顶点应落在中央区域；先排除两侧阴影、旗帜和装饰残片。
    const centralMin = Math.floor(width * FOOT_SCAN_MIN_U);
    const centralMax = Math.ceil(width * FOOT_SCAN_MAX_U);
    const bottom = scan(centralMin, centralMax) ?? scan(0, width - 1);
    const ratio = bottom === null ? 1 : (bottom + 1) / height;
    const result = { ratio, bottomY: bottom ?? height - 1, width, height };
    _footRatioCache.set(cacheKey, result);
    return result;
}

export function resolveStructureFootOffset(scene, textureKey, frameName, displayHeight, fallback = null) {
    const measured = _scanBottom(scene, textureKey, frameName);
    if (!measured) {
        return Number.isFinite(fallback) ? fallback : (Number(displayHeight) || 0) * 0.5;
    }
    const value = footOffsetFromOpaqueBottom(displayHeight, measured.height, measured.bottomY);
    // 保留半像素，兼顾像素贴图与非整数缩放。
    return Math.round(value * 2) / 2;
}

export function shouldAutoAnchorStructure(entity) {
    return !!(
        entity
        && entity._isDefenseStructure
        && entity._structureDepthMode === 'iso_footprint'
        && !entity._isDefenseCover
        && !entity._isCoverGate
        && !entity._isDefenseTower
        && !entity._isFiringPlatform
        && !entity._isDefenseTrap
    );
}

export function clearStructureFootOffsetCache() {
    _footRatioCache.clear();
}
