import { getBuildingFootprint } from './building-footprint.js';
import {
    resolveStructureGroundFit,
    shouldAutoAnchorStructure,
} from './structure-visual-anchor.js';

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

function casterConfig(entity) {
    return entity?.shadowCaster
        || entity?._cfg?.shadowCaster
        || entity?.spriteCfg?.shadowCaster
        || entity?.config?.render?.shadowCaster
        || {};
}

function normalizeLocalPolygon(points, mirrorSign = 1) {
    if (!Array.isArray(points) || points.length < 3) return null;
    const out = [];
    for (const point of points) {
        const x = Array.isArray(point) ? point[0] : point?.x;
        const y = Array.isArray(point) ? point[1] : point?.y;
        if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) continue;
        out.push({ x: Number(x) * mirrorSign, y: Number(y) });
    }
    return out.length >= 3 ? out : null;
}

function toWorldPolygon(points, anchorX, anchorY) {
    return points.map((point) => ({
        x: anchorX + point.x,
        y: anchorY + point.y,
    }));
}

function polygonSignature(points) {
    return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join('|');
}

/**
 * 解析建筑阴影专用低模。
 *
 * 坐标约定：contactPolygon / parts[].polygon 都是相对建筑逻辑前脚点
 * (entity.x, entity.y) 的屏幕地面坐标；X 会随建筑镜像，Y 不镜像。
 * 普通建筑未配置 contactPolygon 时，从主体 Sprite 的 alpha 接地横截面拟合，
 * 因此独立 foundation Sprite、建造占格和碰撞 footprint 都不会污染阴影根部。
 */
export function resolveStructureShadowCaster(scene, entity, sprite, options = {}) {
    if (!entity || !sprite) return null;
    const config = casterConfig(entity);
    if (config.enabled === false) return null;

    const anchorX = Number.isFinite(entity.x) ? entity.x : finite(options.anchorX, sprite.x);
    const anchorY = Number.isFinite(entity.y) ? entity.y : finite(options.anchorY, sprite.y);
    const mirrorSign = entity._facingLeft || sprite.flipX ? -1 : 1;
    let contactLocal = normalizeLocalPolygon(config.contactPolygon, mirrorSign);
    let source = contactLocal ? 'config' : null;

    // 只有普通独立建筑走主体 alpha 接地拟合。塔、墙、门、楼梯继续使用各自专用几何。
    if (!contactLocal && config.contactSource !== 'placement' && shouldAutoAnchorStructure(entity)) {
        const nominal = getBuildingFootprint(entity._buildingFootprintCells || 2);
        const fit = resolveStructureGroundFit(
            scene,
            sprite.texture?.key,
            sprite.frame?.name,
            sprite.displayWidth,
            sprite.displayHeight,
            { nominalWidth: nominal.w, nominalHeight: nominal.d }
        );
        if (fit?.localVertices?.length >= 3) {
            // fit.localVertices 已以逻辑前脚点为原点，且本身左右对称；镜像无需重复处理。
            contactLocal = fit.localVertices.map((point) => ({ x: point.x, y: point.y }));
            source = 'body_alpha';
        }
    }

    if (!contactLocal) return null;
    const contactVertices = toWorldPolygon(contactLocal, anchorX, anchorY);
    const fallbackHeight = Math.max(1, finite(options.fallbackHeight, sprite.displayHeight * 0.3));
    const configuredHeight = Math.max(1, finite(config.height, fallbackHeight));
    const rawParts = Array.isArray(config.parts) ? config.parts : [];
    const parts = [];

    for (const part of rawParts) {
        if (!part || part.enabled === false) continue;
        const local = part.footprint === 'contact' || !part.polygon
            ? contactLocal
            : normalizeLocalPolygon(part.polygon, mirrorSign);
        if (!local) continue;
        const baseZ = Math.max(0, finite(part.baseZ, 0));
        const topZ = Math.max(baseZ, finite(part.topZ ?? part.height, configuredHeight));
        parts.push({
            id: part.id || `part_${parts.length}`,
            vertices: toWorldPolygon(local, anchorX, anchorY),
            baseZ,
            topZ,
        });
    }

    // 无分层配置时，主体接地面自身就是一个从地面延伸到建筑高度的低模投射体。
    if (parts.length === 0) {
        parts.push({
            id: 'body',
            vertices: contactVertices,
            baseZ: 0,
            topZ: configuredHeight,
        });
    }

    const height = Math.max(configuredHeight, ...parts.map((part) => part.topZ));
    const signature = [
        source,
        polygonSignature(contactVertices),
        ...parts.map((part) => `${part.id}:${part.baseZ.toFixed(1)}:${part.topZ.toFixed(1)}:${polygonSignature(part.vertices)}`),
    ].join('||');

    return {
        source,
        contactVertices,
        parts,
        height,
        maxOffset: Number.isFinite(Number(config.maxOffset)) ? Number(config.maxOffset) : undefined,
        signature,
    };
}

