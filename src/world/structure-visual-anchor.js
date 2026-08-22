import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';

const FOOT_ALPHA_THRESHOLD = 96;
const FOOT_SCAN_MIN_U = 0.20;
const FOOT_SCAN_MAX_U = 0.80;
const FOOT_CONTACT_BAND_RATIO = 0.03;
const FOOT_CONTACT_MAX_SPAN_RATIO = 0.12;
const LEGACY_GROUND_SLOPE = PERSPECTIVE_SCALE_Y;
const VISUAL_GROUND_SLOPE_30 = Math.tan(Math.PI / 6);
const _footRatioCache = new Map();
const _groundFitCache = new Map();
const _shadowSliceCache = new Map();
const _frameAlphaSamplerCache = new Map();
const _groundFitManifest = new Map();
const MAX_ALPHA_SAMPLE_DIMENSION = 768;
const AUTO_SHADOW_SLICE_BANDS = Object.freeze([
    Object.freeze({ id: 'lower', min: 0.18, max: 0.52 }),
    Object.freeze({ id: 'middle', min: 0.48, max: 0.78 }),
    Object.freeze({ id: 'upper', min: 0.74, max: 1.00 }),
]);

function _groundFitKey(
    textureKey,
    frameName,
    width,
    height,
    displayWidth,
    displayHeight,
    nominalWidth,
    nominalHeight
) {
    const stableDimension = (value) => Math.round((Number(value) || 0) * 1000) / 1000;
    return [
        textureKey,
        String(frameName ?? '__BASE'),
        `${stableDimension(width)}x${stableDimension(height)}`,
        `${stableDimension(displayWidth)}x${stableDimension(displayHeight)}`,
        `${stableDimension(nominalWidth)}x${stableDimension(nominalHeight)}`,
    ].join(':');
}

/**
 * 注册由离线工具从原图 alpha 轮廓标定出的接地结果。
 * manifest 只保存计算结果，不替代逻辑占格；幽灵、实体和阴影仍统一通过
 * resolveStructureGroundFit() 读取，避免三套锚点口径漂移。
 */
export function registerStructureGroundFitManifest(manifest) {
    const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
    let registered = 0;
    for (const entry of entries) {
        if (!entry?.textureKey || !entry?.fit) continue;
        const key = _groundFitKey(
            entry.textureKey,
            entry.frameName,
            entry.sourceWidth,
            entry.sourceHeight,
            entry.displayWidth,
            entry.displayHeight,
            entry.nominalWidth,
            entry.nominalHeight
        );
        _groundFitManifest.set(key, entry.fit);
        registered++;
    }
    return registered;
}

function _makeCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

/**
 * 一帧只 drawImage/getImageData 一次，再从紧凑 alpha 数组读取。
 * Phaser TextureManager#getPixelAlpha 每个像素都会做一次 1x1 draw/getImageData，
 * 在 3K~4K 建筑图上会同步阻塞主线程；这里最多采样到 768px 长边并按帧缓存。
 */
function _frameAlphaSampler(scene, textureKey, frameName) {
    const frame = scene?.textures?.getFrame(textureKey, frameName);
    if (!frame) return null;
    const sourceWidth = frame.realWidth || frame.cutWidth || frame.width;
    const sourceHeight = frame.realHeight || frame.cutHeight || frame.height;
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) return null;
    const cacheKey = `${textureKey}:${String(frameName ?? frame.name)}:${sourceWidth}x${sourceHeight}`;
    if (_frameAlphaSamplerCache.has(cacheKey)) return _frameAlphaSamplerCache.get(cacheKey);

    const image = frame.source?.image;
    if (!image) return null;
    const scale = Math.min(1, MAX_ALPHA_SAMPLE_DIMENSION / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = _makeCanvas(width, height);
    const context = canvas?.getContext?.('2d', { willReadFrequently: true });
    if (!context) return null;

    try {
        context.clearRect(0, 0, width, height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        const cut = frame.data?.cut || {};
        const sourceX = Number.isFinite(cut.x) ? cut.x : (frame.cutX || 0);
        const sourceY = Number.isFinite(cut.y) ? cut.y : (frame.cutY || 0);
        const cutWidth = Number.isFinite(cut.w) ? cut.w : (frame.cutWidth || sourceWidth);
        const cutHeight = Number.isFinite(cut.h) ? cut.h : (frame.cutHeight || sourceHeight);
        const scaleX = width / sourceWidth;
        const scaleY = height / sourceHeight;
        context.drawImage(
            image,
            sourceX,
            sourceY,
            cutWidth,
            cutHeight,
            (Number(frame.x) || 0) * scaleX,
            (Number(frame.y) || 0) * scaleY,
            cutWidth * scaleX,
            cutHeight * scaleY
        );
        const rgba = context.getImageData(0, 0, width, height).data;
        const alpha = new Uint8ClampedArray(width * height);
        for (let sourceIndex = 3, alphaIndex = 0;
            sourceIndex < rgba.length;
            sourceIndex += 4, alphaIndex++) {
            alpha[alphaIndex] = rgba[sourceIndex];
        }
        const sampler = {
            width,
            height,
            sourceWidth,
            sourceHeight,
            alphaAt(x, y) {
                const px = Math.max(0, Math.min(width - 1, Math.floor(Number(x) || 0)));
                const py = Math.max(0, Math.min(height - 1, Math.floor(Number(y) || 0)));
                return alpha[py * width + px];
            },
        };
        _frameAlphaSamplerCache.set(cacheKey, sampler);
        return sampler;
    } catch (_error) {
        // 极少数跨域/视频纹理可能禁止读回；保留 Phaser 原接口作为兼容兜底。
        return null;
    }
}

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

function _pointLineDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 1e-9) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(1,
        ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
    return Math.hypot(
        point.x - (start.x + dx * t),
        point.y - (start.y + dy * t)
    );
}

/** Douglas-Peucker：压掉像素阶梯噪声，但保留真实台阶/不对称接地转折。 */
function _simplifyOpenPolyline(points, tolerance = 1) {
    if (!Array.isArray(points) || points.length <= 2) return points || [];
    let maxDistance = 0;
    let splitIndex = -1;
    const start = points[0];
    const end = points[points.length - 1];
    for (let index = 1; index < points.length - 1; index++) {
        const distance = _pointLineDistance(points[index], start, end);
        if (distance > maxDistance) {
            maxDistance = distance;
            splitIndex = index;
        }
    }
    if (splitIndex < 0 || maxDistance <= tolerance) return [start, end];
    const left = _simplifyOpenPolyline(points.slice(0, splitIndex + 1), tolerance);
    const right = _simplifyOpenPolyline(points.slice(splitIndex), tolerance);
    return left.slice(0, -1).concat(right);
}

/**
 * 提取稳定底座横截面左右端之间的真实 alpha 下包络。
 * 返回坐标与 Sprite 的自动视觉锚点完全相同：逻辑前脚点为 (0, 0)。
 */
function _extractOpaqueLowerEnvelope(
    measured,
    getAlpha,
    threshold,
    sourceMinX,
    sourceMaxX,
    displayWidth,
    displayHeight,
    visualOffsetX,
    footOffsetY
) {
    const minX = Math.max(0, Math.floor(sourceMinX));
    const maxX = Math.min(measured.width - 1, Math.ceil(sourceMaxX));
    if (maxX <= minX) return [];
    const sourceStep = Math.max(1, Math.floor(2 * measured.width / displayWidth));
    const sampleXs = [];
    for (let x = minX; x <= maxX; x += sourceStep) sampleXs.push(x);
    if (sampleXs[sampleXs.length - 1] !== maxX) sampleXs.push(maxX);
    const bottomRun = _runNearestContact(
        _opaqueRunsAtRow(measured.width, measured.bottomY, getAlpha, threshold),
        measured.contactX
    );
    if (bottomRun) {
        sampleXs.push(
            Math.max(minX, Math.min(maxX, bottomRun.minX)),
            Math.max(minX, Math.min(maxX, bottomRun.maxX)),
            Math.max(minX, Math.min(maxX, Math.round((bottomRun.minX + bottomRun.maxX) * 0.5)))
        );
    }
    sampleXs.sort((a, b) => a - b);
    const uniqueSampleXs = sampleXs.filter((value, index) =>
        index === 0 || value !== sampleXs[index - 1]);

    const points = [];
    for (const x of uniqueSampleXs) {
        let bottomY = -1;
        for (let y = measured.bottomY; y >= 0; y--) {
            if ((Number(getAlpha(x, y)) || 0) >= threshold) {
                bottomY = y;
                break;
            }
        }
        if (bottomY < 0) continue;
        points.push({
            x: visualOffsetX + (((x + 0.5) / measured.width) - 0.5) * displayWidth,
            // 使用像素下边缘，与 footOffsetFromOpaqueBottom 的 bottomY + 1 约定一致。
            y: -footOffsetY + (((bottomY + 1) / measured.height) - 0.5) * displayHeight,
        });
    }
    return _simplifyOpenPolyline(points, 1.25);
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
        candidates.push({
            rise,
            sideY: y,
            leftX: left,
            rightX: right,
            span,
            sourceMinX: run.minX,
            sourceMaxX: run.maxX,
        });
    }

    let sideRise = nominalHeight * 0.5;
    let sideY = Math.max(0, Math.min(
        measured.height - 1,
        Math.round(measured.bottomY - sideRise * measured.height / dh)
    ));
    let leftX = -nominalWidth * 0.5;
    let rightX = nominalWidth * 0.5;
    let selectedCandidate = null;
    if (candidates.length) {
        const maxSpan = Math.max(...candidates.map((candidate) => candidate.span));
        // 取底座达到局部最大宽度 94% 的第一行：仓库≈65px、军营≈75px、靶场≈85px。
        // 相比直接取最宽行，可避开更上方屋檐/旗帜造成的横向膨胀。
        const selected = candidates.find((candidate) => candidate.span >= maxSpan * 0.94)
            || candidates[candidates.length - 1];
        selectedCandidate = selected;
        sideRise = selected.rise;
        sideY = selected.sideY;
        leftX = selected.leftX;
        rightX = selected.rightX;
    }

    // 最低像素可能是台阶、门槛或装饰凸出，不能让它拖着整栋建筑偏离2×2中心。
    // 用稳定底座横截面的中心校准贴图；碰撞四边形自身始终左右对称并锁在格心。
    const measuredSideRise = sideRise;
    const measuredSideCenter = (leftX + rightX) * 0.5;
    const measuredHalfWidth = Math.max(4, (rightX - leftX) * 0.5);
    const measuredSlope = measuredSideRise / measuredHalfWidth;
    const groundSlope = Math.abs(measuredSlope - VISUAL_GROUND_SLOPE_30)
        < Math.abs(measuredSlope - LEGACY_GROUND_SLOPE)
        ? VISUAL_GROUND_SLOPE_30
        : LEGACY_GROUND_SLOPE;
    // 在不突变面积的前提下把角度吸附到 26.565°（旧仓库）或 30°（新建筑）最近档。
    const fittedHalfWidth = Math.sqrt(measuredHalfWidth * measuredSideRise / groundSlope);
    sideRise = fittedHalfWidth * groundSlope;
    leftX = -fittedHalfWidth;
    rightX = fittedHalfWidth;
    const backX = 0;
    const centerX = 0;
    const centerY = -sideRise;
    const localVertices = [
        { key: 'back', x: backX, y: -sideRise * 2 },
        { key: 'right', x: rightX, y: -sideRise },
        { key: 'front', x: 0, y: 0 },
        { key: 'left', x: leftX, y: -sideRise },
    ];
    const groundRadius = Math.max(...localVertices.map((point) =>
        Math.hypot(point.x - centerX, (point.y - centerY) / PERSPECTIVE_SCALE_Y)));
    const contactOffsetX = visualOffsetXFromOpaqueContact(dw, measured.width, contactX);
    const visualOffsetX = contactOffsetX - measuredSideCenter;
    const footOffsetY = footOffsetFromOpaqueBottom(dh, measured.height, measured.bottomY);
    const fallbackSourceHalfWidth = measuredHalfWidth / scaleX;
    const sourceMinX = selectedCandidate?.sourceMinX ?? (contactX - fallbackSourceHalfWidth);
    const sourceMaxX = selectedCandidate?.sourceMaxX ?? (contactX + fallbackSourceHalfWidth);
    const lowerEnvelope = _extractOpaqueLowerEnvelope(
        measured,
        getAlpha,
        threshold,
        sourceMinX,
        sourceMaxX,
        dw,
        dh,
        visualOffsetX,
        footOffsetY
    );
    // 后角仍由稳定地面深度给出；右→左的前半边改用贴图真实 alpha 下包络。
    // 这样保留透视面积，同时不再把台阶、门槛和非对称底座强制重画成标准菱形。
    const contactPolygon = lowerEnvelope.length >= 2
        ? [
            { key: 'back', x: backX, y: -sideRise * 2 },
            ...lowerEnvelope.slice().reverse(),
        ]
        : localVertices;
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
        groundSlope,
        groundAngleDeg: Math.atan(groundSlope) * 180 / Math.PI,
        measuredSideCenter,
        measuredSideRise,
        collisionWidth: Math.max(rightX, backX, 0) - Math.min(leftX, backX, 0),
        collisionHeight: sideRise * 2,
        collisionRadius: groundRadius,
        localVertices,
        contactPolygon,
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

    const sampler = _frameAlphaSampler(scene, textureKey, frameName);
    const scanWidth = sampler?.width || width;
    const scanHeight = sampler?.height || height;
    const alphaAt = sampler?.alphaAt
        || ((x, y) => scene.textures.getPixelAlpha(x, y, textureKey, frameName));
    const measured = scanOpaqueGroundContact(scanWidth, scanHeight, alphaAt)
        || scanOpaqueGroundContact(scanWidth, scanHeight, alphaAt, { minU: 0, maxU: 1 });
    const bottom = measured?.bottomY ?? scanHeight - 1;
    const ratio = (bottom + 1) / scanHeight;
    const result = {
        ratio,
        bottomY: bottom,
        contactX: measured?.contactX ?? (scanWidth - 1) * 0.5,
        width: scanWidth,
        height: scanHeight,
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
    const cacheKey = _groundFitKey(
        textureKey,
        frameName ?? frame.name,
        width,
        height,
        displayWidth,
        displayHeight,
        options.nominalWidth,
        options.nominalHeight
    );
    if (_groundFitCache.has(cacheKey)) return _groundFitCache.get(cacheKey);
    const precomputed = _groundFitManifest.get(cacheKey);
    if (precomputed) {
        _groundFitCache.set(cacheKey, precomputed);
        return precomputed;
    }
    const sampler = _frameAlphaSampler(scene, textureKey, frameName);
    const scanWidth = sampler?.width || width;
    const scanHeight = sampler?.height || height;
    const alphaAt = sampler?.alphaAt
        || ((x, y) => scene.textures.getPixelAlpha(x, y, textureKey, frameName));
    const fit = fitOpaqueGroundFootprint(
        scanWidth,
        scanHeight,
        alphaAt,
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
        contactPolygon: (fit.contactPolygon || fit.localVertices).map((point) => ({
            ...point,
            x: Math.round(point.x * 2) / 2,
            y: Math.round(point.y * 2) / 2,
        })),
    };
    _groundFitCache.set(cacheKey, rounded);
    return rounded;
}

function _roundHalf(value) {
    return Math.round((Number(value) || 0) * 2) / 2;
}

function _polygonBounds(points) {
    const xs = points.map((point) => Number(point?.x)).filter(Number.isFinite);
    const ys = points.map((point) => Number(point?.y)).filter(Number.isFinite);
    if (!xs.length || !ys.length) return null;
    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
    };
}

function _qualifiedColumnRuns(counts, threshold, maxGap) {
    const runs = [];
    let start = -1;
    let last = -1;
    let score = 0;
    const flush = () => {
        if (start >= 0 && last >= start) runs.push({ start, end: last, score });
        start = -1;
        last = -1;
        score = 0;
    };
    for (let index = 0; index < counts.length; index++) {
        const count = counts[index] || 0;
        if (count < threshold) continue;
        if (start < 0) {
            start = index;
        } else if (index - last - 1 > maxGap) {
            flush();
            start = index;
        }
        last = index;
        score += count;
    }
    flush();
    return runs;
}

/**
 * 从当前主体贴图 alpha 自动提取三档高度截面，生成稳定的低模阴影部件。
 *
 * 这里只采样当前 TextureManager 帧并按纹理/显示尺寸缓存，不读 manifest；每个高度带
 * 最多保留两个主要横向实体，窗洞等小缝会合并，旗杆等零碎噪点会被列占用率过滤。
 * 返回的 polygon 仍是相对逻辑脚点的地面坐标，供 shadow caster 按 baseZ/topZ 挤出。
 */
export function resolveStructureAlphaShadowSlices(
    scene,
    textureKey,
    frameName,
    displayWidth,
    displayHeight,
    groundFit,
    contactLocal,
    structureHeight
) {
    const frame = scene?.textures?.getFrame(textureKey, frameName);
    const bounds = _polygonBounds(contactLocal || []);
    if (!frame || !groundFit || !bounds) return [];
    const width = frame.realWidth || frame.cutWidth || frame.width;
    const height = frame.realHeight || frame.cutHeight || frame.height;
    if (!(width > 0) || !(height > 0)) return [];

    const safeDisplayW = Math.max(1, Number(displayWidth) || 1);
    const safeDisplayH = Math.max(1, Number(displayHeight) || 1);
    const safeHeight = Math.max(1, Number(structureHeight) || 1);
    const contactSignature = contactLocal
        .map((point) => `${_roundHalf(point.x)},${_roundHalf(point.y)}`)
        .join('|');
    const cacheKey = [
        textureKey,
        String(frameName ?? frame.name),
        `${width}x${height}`,
        `${safeDisplayW}x${safeDisplayH}`,
        safeHeight,
        _roundHalf(groundFit.visualOffsetX),
        contactSignature,
    ].join(':');
    if (_shadowSliceCache.has(cacheKey)) return _shadowSliceCache.get(cacheKey);

    const sampler = _frameAlphaSampler(scene, textureKey, frameName);
    const scanWidth = sampler?.width || width;
    const scanHeight = sampler?.height || height;
    const alphaAt = sampler?.alphaAt
        || ((x, y) => scene.textures.getPixelAlpha(x, y, textureKey, frameName));
    const threshold = FOOT_ALPHA_THRESHOLD;
    const stepX = Math.max(1, Math.ceil(scanWidth / 384));
    const stepY = Math.max(1, Math.ceil(scanHeight / 384));
    const fitFrameHeight = Math.max(1, Number(groundFit.frameHeight) || height);
    const bottomRatio = (Math.max(0, Number(groundFit.bottomY) || 0) + 1) / fitFrameHeight;
    const bottomY = Math.max(1, Math.min(
        scanHeight - 1,
        Math.round(bottomRatio * scanHeight - 1)
    ));
    const sampledRows = [];
    let topY = bottomY;
    for (let y = 0; y <= bottomY; y += stepY) {
        const xs = [];
        for (let x = 0; x < scanWidth; x += stepX) {
            if ((Number(alphaAt(x, y)) || 0) >= threshold) {
                xs.push(x);
            }
        }
        if (!xs.length) continue;
        topY = Math.min(topY, y);
        sampledRows.push({ y, xs });
    }
    const visibleHeight = bottomY - topY;
    if (!sampledRows.length || visibleHeight < 8) {
        _shadowSliceCache.set(cacheKey, []);
        return [];
    }

    const contactWidth = Math.max(8, bounds.maxX - bounds.minX);
    const contactHalfDepth = Math.max(4, (bounds.maxY - bounds.minY) * 0.5);
    const contactCenterY = (bounds.minY + bounds.maxY) * 0.5;
    const sampleColumns = Math.ceil(scanWidth / stepX);
    const maxGap = Math.max(1, Math.round(scanWidth * 0.018 / stepX));
    const minVisibleSpan = Math.max(7, contactWidth * 0.08);
    const slices = [];

    for (const band of AUTO_SHADOW_SLICE_BANDS) {
        const counts = new Uint16Array(sampleColumns);
        let rowsInBand = 0;
        for (const row of sampledRows) {
            const ratio = (bottomY - row.y) / visibleHeight;
            if (ratio < band.min || ratio > band.max) continue;
            rowsInBand++;
            for (const x of row.xs) counts[Math.floor(x / stepX)]++;
        }
        if (!rowsInBand) continue;
        const columnThreshold = Math.max(1, Math.ceil(rowsInBand * 0.06));
        const runs = _qualifiedColumnRuns(counts, columnThreshold, maxGap)
            .map((run) => {
                const leftPx = run.start * stepX;
                const rightPx = Math.min(scanWidth - 1, (run.end + 1) * stepX - 1);
                // 必须复用 Sprite 真正采用的 visualOffsetX：仅用 (pixelX-contactX)
                // 会漏掉稳定底座横截面的 measuredSideCenter 校正，误差会集中表现为
                // 右侧远端影角斜率错误。这里从 Sprite 中心坐标完整映回逻辑脚点。
                const pixelToLocalX = (pixelX) => Number(groundFit.visualOffsetX || 0)
                    + (((pixelX + 0.5) / scanWidth) - 0.5) * safeDisplayW;
                return {
                    ...run,
                    leftX: pixelToLocalX(leftPx),
                    rightX: pixelToLocalX(rightPx),
                };
            })
            .filter((run) => run.rightX - run.leftX >= minVisibleSpan)
            .sort((a, b) => b.score - a.score)
            .slice(0, 2)
            .sort((a, b) => a.leftX - b.leftX);

        for (let index = 0; index < runs.length; index++) {
            const run = runs[index];
            const halfWidth = Math.max(4, (run.rightX - run.leftX) * 0.5);
            // 高处 alpha 带只提供可靠的左右轮廓，没有可靠的地面纵深。旧版按宽度
            // 猜一个对称菱形，会额外制造两条 iso 斜边并拉歪左/右影角；改成薄横截面，
            // X 两端严格保留贴图实测值，Y 只给凸包运算所需的最小稳定厚度。
            const halfDepth = Math.max(2, Math.min(contactHalfDepth * 0.18, halfWidth * 0.08));
            slices.push({
                id: `auto_${band.id}_${index}`,
                polygon: [
                    { x: _roundHalf(run.leftX), y: _roundHalf(contactCenterY - halfDepth) },
                    { x: _roundHalf(run.rightX), y: _roundHalf(contactCenterY - halfDepth) },
                    { x: _roundHalf(run.rightX), y: _roundHalf(contactCenterY + halfDepth) },
                    { x: _roundHalf(run.leftX), y: _roundHalf(contactCenterY + halfDepth) },
                ],
                baseZ: _roundHalf(safeHeight * band.min),
                topZ: _roundHalf(safeHeight * band.max),
            });
        }
    }

    _shadowSliceCache.set(cacheKey, slices);
    return slices;
}

export function shouldAutoAnchorStructure(entity) {
    return !!(
        entity
        && entity._isDefenseStructure
        && entity._structureDepthMode === 'iso_footprint'
        && !entity._isDefenseCover
        && !entity._isCoverGate
        && !entity._isDefenseTower
        && !entity._isWallStaircase
    );
}

export function clearStructureFootOffsetCache() {
    _footRatioCache.clear();
    _groundFitCache.clear();
    _shadowSliceCache.clear();
    _frameAlphaSamplerCache.clear();
}
