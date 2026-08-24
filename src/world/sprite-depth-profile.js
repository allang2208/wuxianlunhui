const ALPHA_THRESHOLD = 8;
const visibleBoundsCache = new Map();

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

/**
 * 当前 Phaser Sprite 帧的真实 alpha 包围盒（0~1 比例）。
 * HUD、脚底和建筑遮挡共用一次扫描，避免同一动画帧被多套图层逻辑重复读像素。
 */
export function getVisibleFrameBounds(sprite) {
    if (!sprite?.active || !sprite.frame) {
        return { left: 0, right: 1, top: 0, bottom: 1 };
    }
    const frame = sprite.frame;
    const textureKey = sprite.texture?.key || 'unknown';
    const cutW = frame.cutWidth || frame.realWidth || frame.width || 1;
    const cutH = frame.cutHeight || frame.realHeight || frame.height || 1;
    const source = frame.source?.image || sprite.texture?.getSourceImage?.();
    const sourceKey = source?.currentSrc || source?.src || `${source?.width || 0}x${source?.height || 0}`;
    const cacheKey = `${textureKey}:${frame.name ?? 'base'}:${frame.cutX || 0},${frame.cutY || 0}:${cutW}x${cutH}:${sourceKey}`;
    const cached = visibleBoundsCache.get(cacheKey);
    if (cached) return cached;

    let bounds = { left: 0, right: 1, top: 0, bottom: 1 };
    if (source?.width && source?.height && typeof document !== 'undefined') {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = cutW;
            canvas.height = cutH;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
                ctx.drawImage(
                    source,
                    frame.cutX || 0,
                    frame.cutY || 0,
                    cutW,
                    cutH,
                    0,
                    0,
                    cutW,
                    cutH
                );
                const pixels = ctx.getImageData(0, 0, cutW, cutH).data;
                let minX = cutW, maxX = -1, minY = cutH, maxY = -1;
                for (let y = 0; y < cutH; y++) {
                    for (let x = 0; x < cutW; x++) {
                        if (pixels[(y * cutW + x) * 4 + 3] <= ALPHA_THRESHOLD) continue;
                        minX = Math.min(minX, x);
                        maxX = Math.max(maxX, x);
                        minY = Math.min(minY, y);
                        maxY = Math.max(maxY, y);
                    }
                }
                if (maxX >= minX && maxY >= minY) {
                    bounds = Object.freeze({
                        left: minX / cutW,
                        right: (maxX + 1) / cutW,
                        top: minY / cutH,
                        bottom: (maxY + 1) / cutH,
                    });
                }
            }
        } catch (_error) {
            // 跨域或 Canvas 读取失败时回退整帧，图层同步不能因此中断。
        }
    }
    visibleBoundsCache.set(cacheKey, bounds);
    return bounds;
}

/** 当前帧真实可见顶部的世界 Y。 */
export function getVisibleSpriteTopY(sprite) {
    if (!sprite) return 0;
    const bounds = getVisibleFrameBounds(sprite);
    const originY = Number.isFinite(sprite.originY) ? sprite.originY : 0.5;
    return sprite.y + (bounds.top - originY) * sprite.displayHeight;
}

/** 当前帧真实 alpha 包围盒应用 flip/rotation 后的世界 AABB。 */
export function getVisibleSpriteWorldBounds(sprite, visibleBounds = null) {
    if (!sprite) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    const bounds = visibleBounds || getVisibleFrameBounds(sprite);
    const originX = Number.isFinite(sprite.originX) ? sprite.originX : 0.5;
    const originY = Number.isFinite(sprite.originY) ? sprite.originY : 0.5;
    let leftRatio = bounds.left;
    let rightRatio = bounds.right;
    let topRatio = bounds.top;
    let bottomRatio = bounds.bottom;
    if (sprite.flipX) {
        leftRatio = 1 - bounds.right;
        rightRatio = 1 - bounds.left;
    }
    if (sprite.flipY) {
        topRatio = 1 - bounds.bottom;
        bottomRatio = 1 - bounds.top;
    }
    const localXs = [
        (leftRatio - originX) * sprite.displayWidth,
        (rightRatio - originX) * sprite.displayWidth,
    ];
    const localYs = [
        (topRatio - originY) * sprite.displayHeight,
        (bottomRatio - originY) * sprite.displayHeight,
    ];
    const rotation = Number(sprite.rotation) || 0;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const localX of localXs) {
        for (const localY of localYs) {
            const worldX = sprite.x + localX * cos - localY * sin;
            const worldY = sprite.y + localX * sin + localY * cos;
            minX = Math.min(minX, worldX);
            maxX = Math.max(maxX, worldX);
            minY = Math.min(minY, worldY);
            maxY = Math.max(maxY, worldY);
        }
    }
    return Number.isFinite(minX) && Number.isFinite(maxX)
        && Number.isFinite(minY) && Number.isFinite(maxY)
        ? { minX, maxX, minY, maxY }
        : {
            minX: Number(sprite.x) || 0,
            maxX: Number(sprite.x) || 0,
            minY: Number(sprite.y) || 0,
            maxY: Number(sprite.y) || 0,
        };
}

/** 兼容只消费横向范围的 HUD/旧诊断入口。 */
export function getVisibleSpriteXBounds(sprite, visibleBounds = null) {
    const bounds = getVisibleSpriteWorldBounds(sprite, visibleBounds);
    return { minX: bounds.minX, maxX: bounds.maxX };
}

/**
 * 动态人物参与墙/建筑遮挡所需的唯一几何档案。
 * sideRange 使用当前帧真实非透明横向范围，并以碰撞半径/配置值兜底；透明画布留白不再
 * 扩大遮挡范围，宽武器、手臂或身体确实与建筑相交时又不会漏判。
 */
export function resolveSpriteDepthProfile(entity, sprite, options = {}) {
    if (!sprite) {
        return { footOffsetY: 0, frontRange: 60, sideRange: 0, naturalDepth: 0 };
    }
    const bounds = getVisibleFrameBounds(sprite);
    const originY = Number.isFinite(sprite.originY) ? sprite.originY : 0.5;
    const logicalX = Number.isFinite(options.logicalX)
        ? options.logicalX
        : (Number.isFinite(entity?.x) ? entity.x : sprite.x);
    const configuredFoot = options.footOffsetY;
    const footOffsetY = Number.isFinite(configuredFoot)
        ? configuredFoot
        : sprite.displayHeight * (bounds.bottom - originY);

    const visibleWorldBounds = getVisibleSpriteWorldBounds(sprite, bounds);
    const visibleXBounds = visibleWorldBounds;
    const visibleLeftX = visibleXBounds.minX;
    const visibleRightX = visibleXBounds.maxX;
    const physicalRange = Math.max(
        0,
        Number(options.minSideRange) || 0,
        Number(entity?.groundRadius) || 0,
        Number(entity?.collisionRadius) || 0
    );
    const sideRange = Math.max(
        physicalRange,
        Math.abs(logicalX - visibleLeftX),
        Math.abs(visibleRightX - logicalX)
    );
    const visibleTopY = sprite.y + (bounds.top - originY) * sprite.displayHeight;
    const visibleFootY = sprite.y + footOffsetY;
    // 移动实体的排序脚线属于逻辑世界坐标，不能被 spriteOffsetY、跨动作 feetCorr、
    // 待机呼吸或贴图脚底标定污染。调用方提供 logicalFootY 时，alpha 扫描只负责
    // 可见宽高，基础 depth 始终锚定逻辑脚底；纯视觉对象仍回退当前精灵脚点。
    const logicalFootY = Number.isFinite(options.logicalFootY)
        ? options.logicalFootY
        : visibleFootY;
    const minFrontRange = Math.max(0, Number(options.minFrontRange) || 60);
    const maxFrontRange = Math.max(minFrontRange, Number(options.maxFrontRange) || 280);
    const frontRange = clamp(logicalFootY - visibleTopY, minFrontRange, maxFrontRange);
    const naturalDepthOffset = Number.isFinite(options.naturalDepthOffset)
        ? options.naturalDepthOffset
        : 10;

    return {
        bounds,
        footOffsetY,
        frontRange,
        sideRange,
        visibleTopY,
        visibleFootY,
        visibleWorldBounds,
        logicalFootY,
        naturalDepth: logicalFootY + naturalDepthOffset,
    };
}
