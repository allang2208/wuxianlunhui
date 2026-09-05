// Authored strategic relief only; terrain rules remain authoritative in strategic-terrain.js.
import relief from '../../data/world-map-relief.json';

export const MOUNTAIN_RELIEF_URL = new URL('../../assets/ui/world-map/mountain-relief.png', import.meta.url).href;
export const MOUNTAIN_RELIEF = relief;

export function mountainReliefFrame(cell) {
    if (!cell?.mountain) return null;
    const kind = cell.pass ? 'pass'
        : ((Math.imul(cell.q, 73856093) ^ Math.imul(cell.r, 19349663)) >>> 0) % 2 ? 'massif' : 'ridge';
    return relief.frames[`${cell.biome}_${kind}`] || null;
}

export function drawMountainRelief(ctx, image, cell, x, y, scale) {
    const frame = image && mountainReliefFrame(cell);
    if (!frame) return false;
    const factor = scale / relief.pixelsPerWorldUnit;
    const rect = frame.rect;
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height,
        x - frame.anchorPx[0] * factor, y - frame.anchorPx[1] * factor,
        rect.width * factor, rect.height * factor);
    return true;
}
