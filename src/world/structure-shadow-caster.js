import { getBuildingFootprint } from './building-footprint.js';
import {
    resolveConfiguredVisualFootprint,
    resolveStructureAlphaShadowSlices,
    resolveStructureGroundFit,
    shouldAutoAnchorStructure,
} from './structure-visual-anchor.js';

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const _manifestCastersByTexture = new Map();

const stableDimension = (value) => Math.round((Number(value) || 0) * 10) / 10;
const manifestCasterKey = (textureKey, displayWidth, displayHeight) => [
    String(textureKey || ''),
    stableDimension(displayWidth),
    stableDimension(displayHeight),
].join(':');

function clonePolygon(points) {
    if (!Array.isArray(points)) return [];
    return points.map((point) => (
        Array.isArray(point) ? [...point] : { ...point }
    ));
}

function cloneCasterParts(parts) {
    if (!Array.isArray(parts)) return [];
    return parts.map((part) => {
        const cloned = { ...part };
        if (Array.isArray(part?.polygon)) cloned.polygon = clonePolygon(part.polygon);
        return cloned;
    });
}

/**
 * 注册由离线 Body Depth/模型低模生成的主体影根。
 * 清单只补充视觉阴影配置；实体显式 shadowCaster 始终拥有最高优先级。
 */
export function registerStructureShadowCasterManifest(manifest) {
    _manifestCastersByTexture.clear();
    const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
    let registered = 0;
    for (const entry of entries) {
        if (!entry?.textureKey || !Array.isArray(entry.contactPolygon)
            || entry.contactPolygon.length < 3) continue;
        const textureKey = String(entry.textureKey);
        const record = {
            textureKey,
            displayWidth: Number(entry.displayWidth) || 0,
            displayHeight: Number(entry.displayHeight) || 0,
            config: {
                contactPolygon: clonePolygon(entry.contactPolygon),
                parts: cloneCasterParts(entry.parts),
                maxOffset: Number.isFinite(Number(entry.maxOffset))
                    ? Number(entry.maxOffset) : undefined,
                __manifestSource: entry.sourceKind || 'body_depth',
            },
        };
        if (!_manifestCastersByTexture.has(textureKey)) {
            _manifestCastersByTexture.set(textureKey, []);
        }
        _manifestCastersByTexture.get(textureKey).push(record);
        registered++;
    }
    return registered;
}

function manifestCasterConfig(entity, sprite) {
    const textureKey = sprite?.texture?.key;
    const candidates = _manifestCastersByTexture.get(textureKey) || [];
    if (!candidates.length) return null;

    // 语义代理已经在离线阶段映射到逻辑 2x2/4x4 footprint；这里的尺寸只用于
    // 识别“哪一张建筑画布/等级”，不能使用 visualFootprint 拟合后的 Sprite 尺寸，
    // 否则严格棱柱会把 512x397 调成 516.5x390 后误判清单失配。
    const configuredWidth = Number(entity?.spriteCfg?.size);
    const configuredHeight = Number(entity?.spriteCfg?.sizeH);
    const usesConfiguredDimensions = configuredWidth > 0 && configuredHeight > 0;
    const width = usesConfiguredDimensions
        ? configuredWidth : Math.max(1, Number(sprite?.displayWidth) || 1);
    const height = usesConfiguredDimensions
        ? configuredHeight : Math.max(1, Number(sprite?.displayHeight) || 1);
    const exactKey = manifestCasterKey(textureKey, width, height);
    const exact = candidates.find((candidate) => manifestCasterKey(
        textureKey,
        candidate.displayWidth,
        candidate.displayHeight
    ) === exactKey);
    if (exact) return exact.config;

    const ranked = candidates.map((candidate) => ({
        candidate,
        error: Math.abs(candidate.displayWidth - width) / width
            + Math.abs(candidate.displayHeight - height) / height,
    })).sort((left, right) => left.error - right.error);
    return ranked[0]?.error <= 0.02 ? ranked[0].candidate.config : null;
}

function casterConfig(entity, sprite = null) {
    const explicit = entity?.shadowCaster
        || entity?.spriteCfg?.shadowCaster
        // spriteCfg 是当前实际显示等级；基础 _cfg 只能作为未分级建筑的兜底。
        || entity?._cfg?.shadowCaster
        || entity?.config?.render?.shadowCaster;
    const derived = manifestCasterConfig(entity, sprite);
    if (!derived || explicit?.contactSource === 'placement') return explicit || {};
    if (!explicit) return derived;

    const merged = { ...derived, ...explicit };
    if (!Array.isArray(explicit.contactPolygon) || explicit.contactPolygon.length < 3) {
        merged.contactPolygon = derived.contactPolygon;
    }
    // 配置克隆器和旧快照可能把“未配置 parts”物化为空数组；空数组不应吞掉
    // 已验证的模型语义部件。至少一个显式部件才算真正覆盖清单。
    if (!Array.isArray(explicit.parts) || explicit.parts.length === 0) {
        merged.parts = derived.parts;
    }
    merged.__manifestSource = (
        Array.isArray(explicit.contactPolygon) && explicit.contactPolygon.length >= 3
    ) ? undefined : derived.__manifestSource;
    return merged;
}

/** 当前结构是否允许注册太阳阴影；_noShadow 只负责单位接触影，不能在这里复用。 */
export function isStructureShadowEnabled(entity) {
    const config = casterConfig(entity);
    const render = entity?.config?.render || {};
    const styleEnabled = entity?.shadow?.enabled
        ?? render.shadow?.enabled
        ?? entity?._cfg?.shadow?.enabled;
    return config.enabled !== false && styleEnabled !== false;
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
    const config = casterConfig(entity, sprite);
    if (config.enabled === false) return null;

    const anchorX = Number.isFinite(entity.x) ? entity.x : finite(options.anchorX, sprite.x);
    const anchorY = Number.isFinite(entity.y) ? entity.y : finite(options.anchorY, sprite.y);
    const mirrorSign = entity._facingLeft || sprite.flipX ? -1 : 1;
    const anchorAdjustX = finite(entity.spriteCfg?.anchorAdjustX, 0);
    const anchorAdjustY = finite(entity.spriteCfg?.anchorAdjustY, 0);
    let contactLocal = normalizeLocalPolygon(config.contactPolygon, mirrorSign);
    let sliceBasisLocal = normalizeLocalPolygon(config.contactPolygon, 1);
    let source = contactLocal
        ? (config.__manifestSource ? `manifest_${config.__manifestSource}` : 'config')
        : null;
    let groundFit = null;

    // 普通独立建筑与防御塔基座走统一视觉拟合；墙、门、楼梯继续使用各自专用几何。
    // 防御塔的炮臂/武器仍由专属渲染同步，但阴影根部必须与基座 visualFootprint 同源。
    if (config.contactSource !== 'placement'
        && shouldAutoAnchorStructure(entity)
        && (!contactLocal || config.autoParts === true)) {
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
        const fittedContact = groundFit?.contactPolygon || groundFit?.localVertices;
        if (!contactLocal && fittedContact?.length >= 3) {
            // 标准格网建筑直接消费 visualFootprint 映射结果；只有异形/缺配置素材才会落到 alpha 轮廓。
            // 非棱柱兜底仍须复用 Sprite 的旧偏移与镜像，避免贴图和阴影分离。
            sliceBasisLocal = normalizeLocalPolygon(fittedContact, 1);
            contactLocal = transformVisualLocalPolygon(
                fittedContact,
                mirrorSign,
                fitAdjustX,
                fitAdjustY
            );
            source = groundFit.explicitCalibration ? 'visual_footprint' : 'body_alpha';
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
        const hasBaseZ = Number.isFinite(Number(part.baseZ));
        const hasTopZ = Number.isFinite(Number(part.topZ ?? part.height));
        const baseZ = Math.max(0, hasBaseZ
            ? Number(part.baseZ)
            : configuredHeight * finite(part.baseRatio, 0));
        const topZ = Math.max(baseZ, hasTopZ
            ? Number(part.topZ ?? part.height)
            : configuredHeight * finite(part.topRatio, 1));
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
            source = source === 'config'
                ? 'config_alpha_layers'
                : (source === 'visual_footprint'
                    ? 'visual_footprint_alpha_layers'
                    : 'body_alpha_layers');
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
