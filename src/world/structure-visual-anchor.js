import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';

const FOOT_ALPHA_THRESHOLD = 96;
const FOOT_SCAN_MIN_U = 0.20;
const FOOT_SCAN_MAX_U = 0.80;
const FOOT_CONTACT_BAND_RATIO = 0.03;
const FOOT_CONTACT_MAX_SPAN_RATIO = 0.12;
const _footRatioCache = new Map();
const _groundFitCache = new Map();

/** 纯数学入口：把纹理内真实接触底边换算为 Sprite 中心到脚点的显示偏移。 */
export function footOffsetFromOpaqueBottom(displayHeight, frameHeight, opaqueBottomY) {
    const dh = Math.max(1, Number(displayHeight) || 1);
    const fh = Math.max(1, Number(frameHeight) || 1);
    const bottom = Math.max(0, Math.min(fh - 1, Number(opaqueBottomY) || 0));
    return ((bottom + 1) / fh - 0.5) * dh;
}

/**
 * 纯数学入口：把纹理内接地前顶点换算为 Sprite 相对逻辑 footprint 锚点的 X 偏移。
 * 正值 contactX 表示接地点位于图片右侧，因此 Sprite 需要向左平移（返回负值）。
 */
export function visualOffsetXFromOpaqueContact(displayWidth, frameWidth, contactX) {
    const dw = Math.max(1, Number(displayWidth) || 1);
    const fw = Math.max(1, Number(frameWidth) || 1);
    const x = Math.max(0, Math.min(fw - 1, Number(contactX) || 0));
    return (0.5 - (x + 0.5) / fw) * dw;
}

/**
 * 从 alpha 轮廓提取建筑与地面衔接的前顶点。
 * - 先在中央 20%~80% 区域找到最低高 Alpha 像素，排除两侧旗帜/阴影碎片；
 * - 再沿底部窄楔向上取最多 3% 高度，按越靠近底部权重越高求中心；
 * - 宽度超过图片 12% 后停止，避免把墙体、屋檐等上层轮廓混入接地点。
 */
export function scanOpaqueGroundContact(width, height, getAlpha, options = {}) {
    const w = Math.max(1, Math.floor(Number(width) || 1));
    const h = Math.max(1, Math.floor(Number(height) || 1));
    if (typeof getAlpha !== 'function') return null;
    const threshold = Number(options.threshold) || FOOT_ALPHA_THRESHOLD;
    const minU = Number.isFinite(options.minU) ? options.minU : FOOT_SCAN_MIN_U;
    const maxU = Number.isFinite(options.maxU) ? options.maxU : FOOT_SCAN_MAX_U;
    const minX = Math.max(0, Math.floor(w * minU));
    const maxX = Math.min(w - 1, Math.ceil(w * maxU));

    let bottomY = null;
    for (let y = h - 1; y >= 0 && bottomY === null; y--) {
        for (let x = minX; x <= maxX; x++) {
            if ((Number(getAlpha(x, y)) || 0) >= threshold) {
                bottomY = y;
                break;
            }
        }
    }
    if (bottomY === null) return null;

    const band = Math.max(4, Math.round(h * FOOT_CONTACT_BAND_RATIO));
    const maxSpan = Math.max(4, w * FOOT_CONTACT_MAX_SPAN_RATIO);
    let weightedX = 0;
    let totalWeight = 0;
    let acceptedRows = 0;
    for (let y = bottomY; y >= Math.max(0, bottomY - band); y--) {
        let rowMin = w;
        let rowMax = -1;
        for (let x = minX; x <= maxX; x++) {
            if ((Number(getAlpha(x, y)) || 0) >= threshold) {
                rowMin = Math.min(rowMin, x);
                rowMax = Math.max(rowMax, x);
            }
        }
        if (rowMax < rowMin) continue;
        const span = rowMax - rowMin + 1;
        if (span > maxSpan && acceptedRows >= 3) break;
        const rowMid = (rowMin + rowMax) * 0.5;
        const weight = 1 / (1 + (bottomY - y) * 0.25);
        weightedX += rowMid * weight;
        totalWeight += weight;
        acceptedRows++;
    }

    return {
        bottomY,
        contactX: totalWeight > 0 ? weightedX / totalWeight : (w - 1) * 0.5,
        width: w,
        height: h,
    };
}

function _opaqueRunsAtRow(width, y, getAlpha, threshold) {
    const runs = [];
    let start = -1;
    for (let x = 0; x < width; x++) {
        const opaque = (Number(getAlpha(x, y)) || 0) >= threshold;
        if (opaque && start < 0) start = x;
        if ((!opaque || x === width - 1) && start >= 0) {
            const end = opaque && x === width - 1 ? x : x - 1;
            runs.push({ minX: start, maxX: end });
            start = -1;
        }
    }
    return runs;
}

function _runNearestContact(runs, contactX) {
    const containing = runs.find((candidate) =>
        contactX >= candidate.minX && contactX <= candidate.maxX);
    if (containing) return containing;
    return runs.reduce((best, candidate) => {
        const dist = contactX < candidate.minX
            ? candidate.minX - contactX
            : (contactX > candidate.maxX ? contactX - candidate.maxX : 0);
        return !best || dist < best.dist ? { ...candidate, dist } : best;
    }, null);
}

/**
 * 用“最低接地点 + 标准地面侧边高度处的 alpha 横截面”拟合建筑地面四边形。
 * 逻辑占格仍由 nominalWidth/nominalHeight 决定；像素只修正可见底座的左右边界和中心。
 */
export function fitOpaqueGroundFootprint(
    width,
    height,
    getAlpha,
    displayWidth,
    displayHeight,
    options = {}
) {
    const measured = scanOpaqueGroundContact(width, height, getAlpha, options);
    if (!measured) return null;
    const dw = Math.max(1, Number(displayWidth) || 1);
    const dh = Math.max(1, Number(displayHeight) || 1);
    const nominalWidth = Math.max(8, Number(options.nominalWidth) || 256);
    const nominalHeight = Math.max(4, Number(options.nominalHeight) || nominalWidth * 0.5);
    const threshold = Number(options.threshold) || FOOT_ALPHA_THRESHOLD;
    const contactX = measured.contactX;
    const scaleX = dw / measured.width;
    const candidates = [];
    const minRise = Math.max(4, nominalHeight * 0.20);
    const maxRise = Math.max(minRise, nominalHeight * 0.75);
    for (let rise = minRise; rise <= maxRise; rise += 1) {
        const sourceRise = rise * measured.height / dh;
        const y = Math.max(0, Math.min(
            measured.height - 1,
            Math.round(measured.bottomY - sourceRise)
        ));
        const run = _runNearestContact(
            _opaqueRunsAtRow(measured.width, y, getAlpha, threshold),
            contactX
        );
        if (!run) continue;
        const left = (run.minX - contactX) * scaleX;
        const right = (run.maxX - contactX) * scaleX;
        const span = right - left;
        if (left >= -nominalWidth * 0.15
            || right <= nominalWidth * 0.15
            || span < nominalWidth * 0.35
            || span > nominalWidth * 1.20) continue;
        candidates.push({ rise, sideY: y, leftX: left, rightX: right, span });
    }

    let sideRise = nominalHeight * 0.5;
    let sideY = Math.max(0, Math.min(
        measured.height - 1,
        Math.round(measured.bottomY - sideRise * measured.height / dh)
    ));
    let leftX = -nominalWidth * 0.5;
    let rightX = nominalWidth * 0.5;
    if (candidates.length) {
        const maxSpan = Math.max(...candidates.map((candidate) => candidate.span));
        // 取底座达到局部最大宽度 94% 的第一行：仓库≈65px、军营≈75px、靶场≈85px。
        // 相比直接取最宽行，可避开更上方屋檐/旗帜造成的横向膨胀。
        const selected = candidates.find((candidate) => candidate.span >= maxSpan * 0.94)
            || candidates[candidates.length - 1];
        sideRise = selected.rise;
        sideY = selected.sideY;
        leftX = selected.leftX;
        rightX = selected.rightX;
    }

    const backX = leftX + rightX;
    const centerX = backX * 0.5;
    const centerY = -sideRise;
    const localVertices = [
        { key: 'back', x: backX, y: -sideRise * 2 },
        { key: 'right', x: rightX, y: -sideRise },
        { key: 'front', x: 0, y: 0 },
        { key: 'left', x: leftX, y: -sideRise },
    ];
    const groundRadius = Math.max(...localVertices.map((point) =>
        Math.hypot(point.x - centerX, (point.y - centerY) / PERSPECTIVE_SCALE_Y)));
    const visualOffsetX = visualOffsetXFromOpaqueContact(dw, measured.width, contactX);
    const footOffsetY = footOffsetFromOpaqueBottom(dh, measured.height, measured.bottomY);
    return {
        visualOffsetX,
        footOffsetY,
        contactX,
        bottomY: measured.bottomY,
        sideY,
        leftX,
        rightX,
        centerX,
        centerY,
        collisionWidth: Math.max(rightX, backX, 0) - Math.min(leftX, backX, 0),
        collisionHeight: sideRise * 2,
        collisionRadius: groundRadius,
        localVertices,
        frameWidth: measured.width,
        frameHeight: measured.height,
    };
}

function _scanBottom(scene, textureKey, frameName) {
    const frame = scene?.textures?.getFrame(textureKey, frameName);
    if (!frame) return null;
    const width = frame.realWidth || frame.cutWidth || frame.width;
    const height = frame.realHeight || frame.cutHeight || frame.height;
    if (!(width > 0) || !(height > 0)) return null;
    const cacheKey = `${textureKey}:${String(frameName ?? frame.name)}:${width}x${height}`;
    if (_footRatioCache.has(cacheKey)) return _footRatioCache.get(cacheKey);

    const alphaAt = (x, y) => scene.textures.getPixelAlpha(x, y, textureKey, frameName);
    const measured = scanOpaqueGroundContact(width, height, alphaAt)
        || scanOpaqueGroundContact(width, height, alphaAt, { minU: 0, maxU: 1 });
    const bottom = measured?.bottomY ?? height - 1;
    const ratio = (bottom + 1) / height;
    const result = {
        ratio,
        bottomY: bottom,
        contactX: measured?.contactX ?? (width - 1) * 0.5,
        width,
        height,
    };
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

export function resolveStructureVisualOffsetX(scene, textureKey, frameName, displayWidth, fallback = 0) {
    const measured = _scanBottom(scene, textureKey, frameName);
    if (!measured) return Number.isFinite(fallback) ? fallback : 0;
    const value = visualOffsetXFromOpaqueContact(displayWidth, measured.width, measured.contactX);
    return Math.round(value * 2) / 2;
}

export function resolveStructureGroundFit(
    scene,
    textureKey,
    frameName,
    displayWidth,
    displayHeight,
    options = {}
) {
    const frame = scene?.textures?.getFrame(textureKey, frameName);
    if (!frame) return null;
    const width = frame.realWidth || frame.cutWidth || frame.width;
    const height = frame.realHeight || frame.cutHeight || frame.height;
    if (!(width > 0) || !(height > 0)) return null;
    const cacheKey = [
        textureKey,
        String(frameName ?? frame.name),
        `${width}x${height}`,
        `${Number(displayWidth) || 0}x${Number(displayHeight) || 0}`,
        `${Number(options.nominalWidth) || 0}x${Number(options.nominalHeight) || 0}`,
    ].join(':');
    if (_groundFitCache.has(cacheKey)) return _groundFitCache.get(cacheKey);
    const fit = fitOpaqueGroundFootprint(
        width,
        height,
        (x, y) => scene.textures.getPixelAlpha(x, y, textureKey, frameName),
        displayWidth,
        displayHeight,
        options
    );
    if (!fit) return null;
    const rounded = {
        ...fit,
        visualOffsetX: Math.round(fit.visualOffsetX * 2) / 2,
        footOffsetY: Math.round(fit.footOffsetY * 2) / 2,
        leftX: Math.round(fit.leftX * 2) / 2,
        rightX: Math.round(fit.rightX * 2) / 2,
        centerX: Math.round(fit.centerX * 2) / 2,
        centerY: Math.round(fit.centerY * 2) / 2,
        collisionWidth: Math.round(fit.collisionWidth * 2) / 2,
        collisionHeight: Math.round(fit.collisionHeight * 2) / 2,
        collisionRadius: Math.round(fit.collisionRadius * 2) / 2,
        localVertices: fit.localVertices.map((point) => ({
            ...point,
            x: Math.round(point.x * 2) / 2,
            y: Math.round(point.y * 2) / 2,
        })),
    };
    _groundFitCache.set(cacheKey, rounded);
    return rounded;
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
    _groundFitCache.clear();
}
