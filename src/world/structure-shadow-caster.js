import { getBuildingFootprint } from './building-footprint.js';
import {
    resolveConfiguredVisualFootprint,
    resolveStructureAlphaShadowSlices,
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

/** 把从主体贴图提取的局部轮廓应用到 Sprite 实际采用的锚点与镜像坐标。 */
function transformVisualLocalPolygon(points, mirrorSign, adjustX, adjustY) {
    if (!Array.isArray(points) || points.length < 3) return null;
    const normalized = [];
    for (const point of points) {
        const x = Array.isArray(point) ? point[0] : point?.x;
        const y = Array.isArray(point) ? point[1] : point?.y;
        if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) continue;
        normalized.push({
            x: (Number(x) + adjustX) * mirrorSign,
            y: Number(y) - adjustY,
        });
    }
    return normalized.length >= 3 ? normalized : null;
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
 * 普通建筑未配置 contactPolygon 时，复用主体 Sprite 的视觉拟合：标准格网建筑取现有
 * 碰撞棱柱底面，显式异形建筑取 alpha 接地轮廓，保证阴影根部与实际渲染同源。
 */
export function resolveStructureShadowCaster(scene, entity, sprite, options = {}) {
    if (!entity || !sprite) return null;
    const config = casterConfig(entity);
    if (config.enabled === false) return null;

    const anchorX = Number.isFinite(entity.x) ? entity.x : finite(options.anchorX, sprite.x);
    const anchorY = Number.isFinite(entity.y) ? entity.y : finite(options.anchorY, sprite.y);
    const mirrorSign = entity._facingLeft || sprite.flipX ? -1 : 1;
    const anchorAdjustX = finite(entity.spriteCfg?.anchorAdjustX, 0);
    const anchorAdjustY = finite(entity.spriteCfg?.anchorAdjustY, 0);
    let contactLocal = normalizeLocalPolygon(config.contactPolygon, mirrorSign);
    let sliceBasisLocal = normalizeLocalPolygon(config.contactPolygon, 1);
    let source = contactLocal ? 'config' : null;
    let groundFit = null;

    // 只有普通独立建筑走统一视觉拟合。塔、墙、门、楼梯继续使用各自专用几何。
    if (config.contactSource !== 'placement' && shouldAutoAnchorStructure(entity)) {
        const fallbackFoot = getBuildingFootprint(entity._buildingFootprintCells || 2);
        const constrainToPrism = entity.spriteCfg?.autoFootprint !== true;
        const nominal = {
            w: constrainToPrism
                ? Math.max(8, Number(entity.collisionWidth) || fallbackFoot.w)
                : fallbackFoot.w,
            d: constrainToPrism
                ? Math.max(4, Number(entity.collisionHeight) || fallbackFoot.d)
                : fallbackFoot.d,
        };
        groundFit = entity._structureVisualFit || resolveStructureGroundFit(
            scene,
            sprite.texture?.key,
            sprite.frame?.name,
            sprite.displayWidth,
            sprite.displayHeight,
            {
                nominalWidth: nominal.w,
                nominalHeight: nominal.d,
                constrainToPrism,
                centerAdjustX: constrainToPrism
                    ? (Number(entity.spriteCfg?.anchorAdjustX) || 0) : 0,
                centerAdjustY: constrainToPrism
                    ? (Number(entity.spriteCfg?.anchorAdjustY) || 0) : 0,
                visualFootprint: constrainToPrism
                    ? resolveConfiguredVisualFootprint(entity.spriteCfg, nominal.w, nominal.d)
                    : null,
            }
        );
        const fitAdjustX = groundFit?.prismConstrained ? 0 : anchorAdjustX;
        const fitAdjustY = groundFit?.prismConstrained ? 0 : anchorAdjustY;
        const alphaContact = groundFit?.contactPolygon || groundFit?.localVertices;
        if (!contactLocal && alphaContact?.length >= 3) {
            // alpha 轮廓必须复用 Sprite 的 anchorAdjustX/Y 与镜像，否则贴图已移动、阴影仍留在逻辑格心。
            sliceBasisLocal = normalizeLocalPolygon(alphaContact, 1);
            contactLocal = transformVisualLocalPolygon(
                alphaContact,
                mirrorSign,
                fitAdjustX,
                fitAdjustY
            );
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

    // 分层 alpha 低模改为显式 opt-in。默认自动分层会让左右边分别被不同宽度/高度的
    // 屋檐、塔楼或侧翼接管，虽然每个点都沿同一太阳向量移动，最终包络的两条侧边却
    // 不再平行。普通建筑默认走下方单体棱柱：真实 contact polygon 沿唯一影向平行扫掠。
    if (parts.length === 0 && config.autoParts === true && groundFit) {
        const slices = resolveStructureAlphaShadowSlices(
            scene,
            sprite.texture?.key,
            sprite.frame?.name,
            sprite.displayWidth,
            sprite.displayHeight,
            groundFit,
            sliceBasisLocal || contactLocal,
            configuredHeight
        );
        if (slices.length > 0) {
            parts.push({
                id: 'contact_root',
                vertices: contactVertices,
                baseZ: 0,
                topZ: configuredHeight * 0.24,
            });
            for (const slice of slices) {
                const local = transformVisualLocalPolygon(
                    slice.polygon,
                    mirrorSign,
                    groundFit.prismConstrained ? 0 : anchorAdjustX,
                    groundFit.prismConstrained ? 0 : anchorAdjustY
                );
                if (!local) continue;
                parts.push({
                    id: slice.id,
                    vertices: toWorldPolygon(local, anchorX, anchorY),
                    baseZ: slice.baseZ,
                    topZ: slice.topZ,
                });
            }
            source = source === 'config' ? 'config_alpha_layers' : 'body_alpha_layers';
        }
    }

    // 贴图无法形成稳定分层时，回退为单体低模，确保任何建筑都不会丢失阴影。
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
