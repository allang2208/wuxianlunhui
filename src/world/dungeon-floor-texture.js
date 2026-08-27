/**
 * 地牢地板烘焙（战斗房与 Boss 场地共用，唯一实现）
 *
 * 等距俯视角（30°）菱形地板：
 * - 贴图组由地板配置驱动（setDungeonFloorProfile）：每格随机选图 + 随机镜像变换
 * - 菱形几何按贴图 alpha 包围盒运行时实测（换素材无需改代码）
 * - 发光层机制保留（profile.glow !== false 时同位置 'lighter' 平铺 <贴图键>_glow），
 *   僵尸地牢当前全部关闭（glow: false），其他场景可开启
 * - 墙脚接触阴影（统一标准）：沿菱形边缘向内 64px 真渐变黑带（墙根 ≈40% 黑 → 0），
 *   所有墙壁-地板衔接处共用此处理，不因地牢等级分设
 * - 贴图未加载完成时回退到深色网格地板
 */
import { CONFIG } from '../config/config.js';
import { Renderer } from './renderer.js';

// 默认地板配置（非地牢/未设置时）：保持旧的 blackbrick5 + 发光层行为
const DEFAULT_PROFILE = { tiles: ['blackbrick5'], glow: true };

// 场地四周边缘黑→透明渐变宽度
const FLOOR_EDGE_FADE = 64;

// 回退网格地板默认样式（调用方未提供时使用）
const DEFAULT_FALLBACK_TERRAIN = {
    floorColor: '#1a1814',
    gridColor: 'rgba(50, 45, 40, 0.4)',
    gridSize: 80,
    edgeHighlight: 'rgba(120, 80, 60, 0.6)',
};

// 当前地板配置（由地牢初始化时按地牢类型设置）
let _floorProfile = null;

// 装饰清除区（2026-08-17）：建筑建造后注册的世界坐标圆，草/装饰绘制时跳过。
// 覆盖块由 GameScene.eraseDecoAt 局部重烘焙（草从烘焙纹理中消失）。
let _decoClearZones = [];
const DECO_CLEAR_CELL = 256;
let _decoClearZoneCells = new Map();

/** 注册一个装饰清除圆（世界坐标）；配合 GameScene.eraseDecoAt 重烘焙生效 */
export function registerDecoClearZone(x, y, radius) {
    if (!(radius > 0)) return;
    const zone = { x, y, radius };
    _decoClearZones.push(zone);
    const x0 = Math.floor((x - radius) / DECO_CLEAR_CELL);
    const x1 = Math.floor((x + radius) / DECO_CLEAR_CELL);
    const y0 = Math.floor((y - radius) / DECO_CLEAR_CELL);
    const y1 = Math.floor((y + radius) / DECO_CLEAR_CELL);
    for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
            const key = `${cx},${cy}`;
            let cell = _decoClearZoneCells.get(key);
            if (!cell) {
                cell = [];
                _decoClearZoneCells.set(key, cell);
            }
            cell.push(zone);
        }
    }
}

/** 批量注册装饰清除区。 */
export function registerDecoClearZones(zones) {
    for (const z of zones || []) {
        if (z) registerDecoClearZone(z.x, z.y, z.radius);
    }
}

/** 场景生命周期结束时清空，禁止世界-122 建造痕迹污染下一次入场/其它地板。 */
export function clearDecoClearZones() {
    _decoClearZones = [];
    _decoClearZoneCells = new Map();
}

/** 世界点是否落在任意装饰清除圆内 */
function _inDecoClearZone(gx, gy) {
    const key = `${Math.floor(gx / DECO_CLEAR_CELL)},${Math.floor(gy / DECO_CLEAR_CELL)}`;
    for (const z of _decoClearZoneCells.get(key) || []) {
        if (Math.hypot(gx - z.x, gy - z.y) <= z.radius) return true;
    }
    return false;
}

/**
 * 设置当前地板配置
 * @param {{tiles:string[], glow?:boolean, overlapX?:number, overlapY?:number, backgroundColor?:string, deco?:object}|null} profile null 恢复默认
 */
export function setDungeonFloorProfile(profile) {
    _floorProfile = (profile && Array.isArray(profile.tiles) && profile.tiles.length > 0)
        ? {
            tiles: [...profile.tiles],
            glow: profile.glow !== false,
            overlapX: profile.overlapX ?? 0,
            overlapY: profile.overlapY ?? 0,
            backgroundColor: profile.backgroundColor || null,
            deco: profile.deco || null,
            continuous: profile.continuous === true,
            textureScaleY: profile.textureScaleY ?? 0.5774,
            sandPatches: profile.sandPatches || null,
            surfacePatches: Array.isArray(profile.surfacePatches) ? profile.surfacePatches : null,
            cellDetails: profile.cellDetails || null,
        }
        : null;
}

function _getProfile() {
    return _floorProfile || DEFAULT_PROFILE;
}

/** 取 Phaser 已加载贴图的源图（未加载返回 null） */
function _getSourceImage(key) {
    const scene = (typeof window !== 'undefined' && window.__phaserScene) ? window.__phaserScene : null;
    if (!scene || !scene.textures || !scene.textures.exists(key)) return null;
    const tex = scene.textures.get(key);
    const img = tex ? tex.getSourceImage() : null;
    return (img && img.width > 0 && img.height > 0) ? img : null;
}

// 菱形几何缓存（alpha 包围盒实测，换素材无需改代码）
const _tileGeoCache = new Map();

/** 实测贴图 alpha 包围盒 → 菱形宽高与中心点 */
function _getTileGeometry(key, img) {
    if (_tileGeoCache.has(key)) return _tileGeoCache.get(key);
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    const data = cx.getImageData(0, 0, img.width, img.height).data;
    let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
    for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
            if (data[(y * img.width + x) * 4 + 3] > 8) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    const geo = (maxX >= 0)
        ? { w: maxX - minX + 1, h: maxY - minY + 1, cx: (minX + maxX + 1) / 2, cy: (minY + maxY + 1) / 2 }
        : { w: img.width, h: img.height, cx: img.width / 2, cy: img.height / 2 };
    _tileGeoCache.set(key, geo);
    return geo;
}

/** 等距平铺一层：每格随机选图 + 随机镜像，菱形中心对齐网格点、行交错半宽偏移；
 *  overlapX/overlapY：步进内缩（相邻砖叠合，只叠不缺）——盖自然边缘的锯齿缝与半透明暗边 */
function _drawIsoLayer(ctx, tiles, w, h, overlapX = 0, overlapY = 0) {
    // 网格步进用首张贴图几何（组内各贴图尺寸近似，中心点各自对齐）
    const ref = tiles[0];
    const stepX = ref.geo.w - overlapX;
    const stepY = ref.geo.h / 2 - overlapY;
    const startRow = -2;
    const endRow = Math.ceil(h / stepY) + 2;
    for (let r = startRow; r < endRow; r++) {
        const offsetX = (r % 2 !== 0) ? stepX / 2 : 0;
        const gy = r * stepY;
        for (let gx = -stepX; gx < w + stepX; gx += stepX) {
            const cx = gx + offsetX;
            const tile = tiles[Math.floor(Math.random() * tiles.length)];
            const fx = Math.random() < 0.5 ? -1 : 1;
            const fy = Math.random() < 0.5 ? -1 : 1;
            ctx.save();
            ctx.translate(cx, gy);
            ctx.scale(fx, fy);
            ctx.drawImage(tile.img, -tile.geo.cx, -tile.geo.cy);
            ctx.restore();
        }
    }
}

/** 确定性伪随机（mulberry32）：同一 (row, col) 永远得到同一块砖选择/镜像，
 *  保证分块烘焙的各块在相同全局网格坐标下图案一致、跨块无缝。 */
function _seededRand(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function _hash32(a, b, salt = 0) {
    let value = Math.imul((Number(a) | 0) ^ 0x45d9f3b, 0x27d4eb2d)
        ^ Math.imul((Number(b) | 0) ^ 0x165667b1, 0x85ebca6b)
        ^ (Number(salt) | 0);
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    return (value ^ (value >>> 16)) >>> 0;
}

function _weightedIndex(weights, hash, count) {
    const values = Array.from({ length: count }, (_, index) =>
        Math.max(0, Number(weights?.[index]) || 0));
    const total = values.reduce((sum, value) => sum + value, 0);
    if (!(total > 0)) return count > 0 ? (hash % count) : -1;
    let target = (hash / 0x100000000) * total;
    let lastEligible = -1;
    for (let index = 0; index < values.length; index++) {
        if (!(values[index] > 0)) continue;
        lastEligible = index;
        target -= values[index];
        if (target <= 0) return index;
    }
    return lastEligible;
}

function _weightedAsset(assets, roll) {
    const total = assets.reduce((sum, asset) => sum + Math.max(0, Number(asset.weight) || 0), 0);
    if (!(total > 0)) return assets[0] || null;
    let target = roll * total;
    let lastEligible = null;
    for (const asset of assets) {
        const weight = Math.max(0, Number(asset.weight) || 0);
        if (!(weight > 0)) continue;
        lastEligible = asset;
        target -= weight;
        if (target <= 0) return asset;
    }
    return lastEligible;
}

function _collectTiles(profile) {
    const tiles = [];
    for (const key of profile.tiles) {
        const img = _getSourceImage(key);
        if (img) tiles.push({ key, img, geo: _getTileGeometry(key, img) });
        else console.warn('[DungeonFloor] 地砖纹理缺失（已从池中剔除）:', key);
    }
    return tiles;
}

/** 连续无缝纹理铺贴：按世界坐标锁定相位，并将纹理纵向压到30°等距观感。 */
function _drawContinuousLayer(ctx, img, ox, oy, width, height, textureScaleY = 0.5774) {
    const tileW = img.width;
    const tileH = Math.max(1, Math.round(img.height * textureScaleY));
    const phaseX = ((ox % tileW) + tileW) % tileW;
    const phaseY = ((oy % tileH) + tileH) % tileH;
    for (let x = -phaseX - tileW; x < width + tileW; x += tileW) {
        for (let y = -phaseY - tileH; y < height + tileH; y += tileH) {
            ctx.drawImage(img, x, y, tileW, tileH);
        }
    }
}

/** 分块等距平铺：按「全局行/列网格」绘制，块偏移 (ox,oy) 只做平移——
 *  相邻块在同一全局网格上取同一种子，砖纹/镜像完全一致，跨块无缝。 */
function _drawIsoLayerChunk(ctx, tiles, ox, oy, w, h, overlapX = 0, overlapY = 0) {
    const ref = tiles[0];
    const stepX = ref.geo.w - overlapX;
    const stepY = ref.geo.h / 2 - overlapY;
    const startRow = Math.floor((oy - stepY) / stepY) - 1;
    const endRow = Math.ceil((oy + h + stepY) / stepY) + 1;
    for (let r = startRow; r < endRow; r++) {
        const offsetX = (r % 2 !== 0) ? stepX / 2 : 0;
        const gy = r * stepY;
        const kStart = Math.floor((ox - offsetX - stepX) / stepX) - 1;
        const kEnd = Math.ceil((ox + w - offsetX + stepX) / stepX) + 1;
        for (let k = kStart; k < kEnd; k++) {
            const rand = _seededRand(((r * 73856093) ^ (k * 19349663) ^ 0x5f356495) >>> 0);
            const tile = tiles[Math.floor(rand() * tiles.length)];
            const fx = rand() < 0.5 ? -1 : 1;
            const fy = rand() < 0.5 ? -1 : 1;
            ctx.save();
            ctx.translate(k * stepX + offsetX - ox, gy - oy);
            ctx.scale(fx, fy);
            ctx.drawImage(tile.img, -tile.geo.cx, -tile.geo.cy);
            ctx.restore();
        }
    }
}

/**
 * 道路同源的地貌细节格：底层仍是世界相位连续材质；World-122当前只启用透明碎石帧，
 * 风纹、裂缝和冲蚀线保持零权重。格网固定为128×64、隔行偏移64px，格坐标与seed唯一决定结果。
 */
function _drawFloorCellDetails(ctx, profile, ox, oy, cw, ch, diamond) {
    const details = profile.cellDetails;
    if (!details || details.enabled === false || !details.key) return;
    const atlas = _getSourceImage(details.key);
    if (!atlas) return;
    const frameWidth = Math.max(1, Number(details.frameWidth) || 128);
    const frameHeight = Math.max(1, Number(details.frameHeight) || 64);
    const frameCount = Math.max(1, Math.min(
        Number(details.frameCount) || Math.floor(atlas.width / frameWidth),
        Math.floor(atlas.width / frameWidth)
    ));
    const displayWidth = Math.max(1, Number(details.displayWidth) || frameWidth);
    const displayHeight = Math.max(1, Number(details.displayHeight) || frameHeight);
    const density = Math.max(0, Math.min(1, Number(details.density) || 0));
    const alpha = Math.max(0, Math.min(1, Number(details.alpha) || 1));
    const seedSalt = Number(details.seedSalt) || 0;
    const grid = details.grid || {};
    const originX = Number(grid.originX) || 0;
    const originY = Number(grid.originY) || 0;
    const stepX = Math.max(1, Number(grid.stepX) || 128);
    const stepY = Math.max(1, Number(grid.stepY) || 32);
    const rowOffsetX = Number(grid.rowOffsetX) || stepX / 2;
    const edgeInset = Math.max(0, Number(details.edgeInset) || 0);
    const rowStart = Math.floor((oy - originY - displayHeight) / stepY) - 1;
    const rowEnd = Math.ceil((oy + ch - originY + displayHeight) / stepY) + 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    for (let row = rowStart; row <= rowEnd; row++) {
        const y = originY + row * stepY;
        const parity = ((row % 2) + 2) % 2;
        const rowOriginX = originX + parity * rowOffsetX;
        const columnStart = Math.floor((ox - rowOriginX - displayWidth) / stepX) - 1;
        const columnEnd = Math.ceil((ox + cw - rowOriginX + displayWidth) / stepX) + 1;
        for (let column = columnStart; column <= columnEnd; column++) {
            const x = rowOriginX + column * stepX;
            const u = Math.round((x - originX) / (stepX / 2));
            const i = Math.round((row + u) / 2);
            const j = row - i;
            const densityHash = _hash32(i, j, seedSalt);
            if (densityHash / 0x100000000 >= density) continue;
            if (diamond && _floorRegionEdgeDistance(x, y, diamond) < edgeInset) continue;
            if (_decoClearZones.length && _inDecoClearZone(x, y)) continue;
            const frame = _weightedIndex(details.frameWeights,
                _hash32(i, j, seedSalt ^ 0x6ac690c5), frameCount);
            if (frame < 0) continue;
            ctx.drawImage(atlas,
                frame * frameWidth, 0, frameWidth, frameHeight,
                x - ox - displayWidth / 2, y - oy - displayHeight / 2,
                displayWidth, displayHeight);
        }
    }
    ctx.restore();
}

/** 地板点缀（草簇等，2026-08-16）：
 * - 独立于地砖层的装饰贴图，固定朝向绘制（仅随机水平镜像，草簇本身径向对称安全），
 *   不做 X/Y 翻转——避免 8 向循环把有方向性的素材翻转；
 * - 位置按块坐标种子确定性随机，块重烘焙时点缀位置不变；
 * - 菱形地块模式下只在菱形内（距边留 margin）点缀，草不压黑边。
 */
function _drawFloorDecoChunk(ctx, profile, ox, oy, cw, ch, diamond) {
    const deco = profile.deco;
    if (!deco) return;
    const configuredAssets = Array.isArray(deco.assets) ? deco.assets : [];
    const legacyAssets = Array.isArray(deco.textures)
        ? deco.textures.map((key) => ({ key, weight: 1, size: deco.size ?? 100, originY: 0.5 }))
        : [];
    const assets = [];
    for (const asset of configuredAssets.length ? configuredAssets : legacyAssets) {
        const key = asset?.key;
        if (!key) continue;
        const img = _getSourceImage(key);
        if (img) assets.push({ ...asset, key, img });
    }
    if (assets.length === 0) return;
    const entrySeed = deco.seed ?? 0x5f356495;

    if (deco.placementMode === 'world-grid') {
        const cellSize = Math.max(96, Number(deco.cellSize) || 248);
        const density = Math.max(0, Math.min(1, Number(deco.density) || 0));
        const jitterMin = Math.max(0, Math.min(1, Number(deco.jitterMin) || 0.18));
        const jitterMax = Math.max(jitterMin, Math.min(1, Number(deco.jitterMax) || 0.82));
        const scaleJitter = Math.max(0, Number(deco.scaleJitter) || 0);
        const edgeInset = Math.max(0, Number(deco.edgeInset) || 0);
        const seedSalt = Number(deco.seedSalt) || 0;
        const maxSize = assets.reduce((best, asset) =>
            Math.max(best, Math.max(1, Number(asset.size) || 100) * (1 + scaleJitter)), 100);
        const columnStart = Math.floor((ox - maxSize) / cellSize);
        const columnEnd = Math.ceil((ox + cw + maxSize) / cellSize);
        const rowStart = Math.floor((oy - maxSize) / cellSize);
        const rowEnd = Math.ceil((oy + ch + maxSize) / cellSize);
        for (let row = rowStart; row <= rowEnd; row++) {
            for (let column = columnStart; column <= columnEnd; column++) {
                const rand = _seededRand(_hash32(column, row, entrySeed ^ seedSalt));
                if (rand() >= density) continue;
                const px = (column + jitterMin + rand() * (jitterMax - jitterMin)) * cellSize;
                const py = (row + jitterMin + rand() * (jitterMax - jitterMin)) * cellSize;
                if (diamond && _floorRegionEdgeDistance(px, py, diamond) < edgeInset) continue;
                if (_decoClearZones.length && _inDecoClearZone(px, py)) continue;
                const asset = _weightedAsset(assets, rand());
                if (!asset) continue;
                const jitter = 1 + (rand() * 2 - 1) * scaleJitter;
                const height = Math.max(1, (Number(asset.size) || 100) * jitter);
                const width = asset.img.width * (height / asset.img.height);
                const originY = Math.max(0, Math.min(1, Number(asset.originY) || 0.5));
                ctx.save();
                ctx.globalAlpha = Math.max(0, Math.min(1, Number(asset.alpha) || 1));
                ctx.translate(px - ox, py - oy);
                if (rand() < 0.5) ctx.scale(-1, 1);
                ctx.drawImage(asset.img, -width / 2, -height * originY, width, height);
                ctx.restore();
            }
        }
        return;
    }

    const perChunk = deco.perChunk ?? 30;
    const size = deco.size ?? 100;
    const minDist = deco.minDist ?? 120;
    // deco.seed 由场景入场时生成：同一次入场的分块重烘焙稳定复现，重新进入场景才换布局。
    const rand = _seededRand(((ox * 73856093) ^ (oy * 19349663) ^ entrySeed) >>> 0);
    const inDiamond = (gx, gy) => {
        if (!diamond) return true;
        return _floorRegionEdgeDistance(gx, gy, diamond) >= 24;
    };
    const placed = [];
    let guard = 0;
    const attempts = perChunk * 40;
    const pad = size; // 中心离块边留半个贴图高，避免跨块接缝裁断草簇
    while (placed.length < perChunk && guard++ < attempts) {
        const px = pad + rand() * (cw - pad * 2);
        const py = pad + rand() * (ch - pad * 2);
        if (px < pad || px > cw - pad || py < pad || py > ch - pad) continue;
        if (!inDiamond(ox + px, oy + py)) continue;
        if (placed.some((q) => Math.hypot(q[0] - px, q[1] - py) < minDist)) continue;
        // 建筑建造清除区：草/装饰不画在已建建筑上（2026-08-17；不消耗 rand，
        // 其余草位置与清除前一致，重烘焙跨块无缝）
        if (_decoClearZones.length && _inDecoClearZone(ox + px, oy + py)) continue;
        placed.push([px, py]);
        const asset = _weightedAsset(assets, rand());
        const img = asset.img;
        const jitter = 0.85 + rand() * 0.3;
        const h = size * jitter;
        const w = img.width * (h / img.height);
        ctx.save();
        ctx.translate(px, py);
        if (rand() < 0.5) ctx.scale(-1, 1);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
    }
}

/** 连续地面的软边补丁（沙地/雪地等）：旧 sandPatches 保持兼容，surfacePatches 支持多层。 */
function _drawSandPatches(ctx, profile, ox, oy, cw, ch, diamond) {
    const patches = [
        ...(profile.sandPatches ? [profile.sandPatches] : []),
        ...(profile.surfacePatches || []),
    ];
    for (let i = 0; i < patches.length; i++) {
        _drawSurfacePatchLayer(ctx, profile, patches[i], ox, oy, cw, ch, diamond, i);
    }
}

function _drawSurfacePatchLayer(ctx, profile, sp, ox, oy, cw, ch, diamond, layerIndex) {
    if (!sp || !sp.texture) return;
    const img = _getSourceImage(sp.texture);
    if (!img) return;
    const perChunk = sp.perChunk ?? 6;
    const size = sp.size ?? 700;
    const minDist = sp.minDist ?? 900;
    const pad = size; // 中心离块边留半径，避免跨块裁断
    const rand = _seededRand(((ox * 2654435761) ^ (oy * 40503) ^ 0x9e3779b9 ^ (layerIndex * 0x45d9f3b)) >>> 0);
    const radius = size / 2;
    const placed = [];
    let guard = 0;
    const attempts = perChunk * 30;
    while (placed.length < perChunk && guard++ < attempts) {
        const px = pad + rand() * (cw - pad * 2);
        const py = pad + rand() * (ch - pad * 2);
        if (px < pad || px > cw - pad || py < pad || py > ch - pad) continue;
        if (diamond && _outsideDiamondMargin(ox + px, oy + py, diamond, radius)) continue;
        if (placed.some((q) => Math.hypot(q[0] - px, q[1] - py) < minDist)) continue;
        placed.push([px, py]);
        _drawSandPatchAt(ctx, profile, img, ox + px, oy + py, size, rand, ox, oy);
    }
    // 固定沙地补丁（2026-08-16）：scene-manager 给基地铺的大沙地。
    // 每个补丁有独立确定性种子（噪声边界跨块一致），只画与本块相交的补丁。
    for (const fp of sp.fixed || []) {
        const fSize = fp.size ?? size;
        const fRadius = fSize / 2;
        // 真实垂距校验：大补丁必须整体落在菱形内（随机小补丁沿用归一化口径即可，
        // 大补丁用归一化会误判——左缘垂距 < 归一化余量）
        if (diamond && _minDistToDiamond(fp.x, fp.y, diamond) < fRadius + 60) continue;
        // 补丁方形范围与本块不相交则跳过（含遮罩外扩余量）
        if (fp.x + fRadius < ox || fp.x - fRadius > ox + cw || fp.y + fRadius < oy || fp.y - fRadius > oy + ch) continue;
        const fRand = _seededRand(((Math.round(fp.x) * 2654435761) ^ (Math.round(fp.y) * 40503) ^ 0xa5a5a5a5 ^ (layerIndex * 0x45d9f3b)) >>> 0);
        _drawSandPatchAt(ctx, profile, img, fp.x, fp.y, fSize, fRand, ox, oy);
    }
}

/** 点到菱形四边的最短距离（点在线段外时取到端点的距离） */
function _minDistToDiamond(gx, gy, diamond) {
    const { cx, cy, rx, ry } = diamond;
    const pts = [
        [cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy],
    ];
    let best = Infinity;
    for (let i = 0; i < 4; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % 4];
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? ((gx - x1) * dx + (gy - y1) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const px = x1 + dx * t, py = y1 + dy * t;
        best = Math.min(best, Math.hypot(gx - px, gy - py));
    }
    return best;
}

/**
 * 点位于一个或多个菱形房间内部时，返回到所属房间边缘的最大安全距离；
 * 位于全部房间外返回 -Infinity。数组口径用于三房竞技场，避免小件落到纯黑区或通道边缘。
 */
function _floorRegionEdgeDistance(gx, gy, region) {
    const diamonds = Array.isArray(region) ? region : [region];
    let best = -Infinity;
    for (const diamond of diamonds) {
        if (!diamond) continue;
        const inside = Math.abs(gx - diamond.cx) / Math.max(1, diamond.rx)
            + Math.abs(gy - diamond.cy) / Math.max(1, diamond.ry) <= 1;
        if (!inside) continue;
        best = Math.max(best, _minDistToDiamond(gx, gy, diamond));
    }
    return best;
}

/** 沙地补丁中心是否太靠近（或超出）菱形边界（余量 = 半径 + 60px） */
function _outsideDiamondMargin(gx, gy, diamond, radius) {
    const margin = (radius + 60) / diamond.ry;
    return Math.abs(gx - diamond.cx) / diamond.rx + Math.abs(gy - diamond.cy) / diamond.ry > 1 - margin;
}

/** 画单个沙地补丁（世界坐标 gx/gy 中心，size 边长；纹理按世界相位铺贴 + 噪声软边遮罩） */
function _drawSandPatchAt(ctx, profile, img, gx, gy, size, rand, ox, oy) {
    const ps = Math.ceil(size);
    const tc = document.createElement('canvas');
    tc.width = ps;
    tc.height = ps;
    const tctx = tc.getContext('2d');
    const tw = img.width;
    // 沙地纹理同样按 30° 等距纵向压缩，与泥地连续铺贴视角一致
    const th = Math.round(img.height * (profile.textureScaleY ?? 0.5774));
    const phaseX = ((gx - ps / 2) % tw + tw) % tw;
    const phaseY = ((gy - ps / 2) % th + th) % th;
    // 循环平铺覆盖整张补丁画布（世界相位一致）——单张纹理画不满会露直切边
    for (let tx = -phaseX - tw; tx < ps + tw; tx += tw) {
        for (let ty = -phaseY - th; ty < ps + th; ty += th) {
            tctx.drawImage(img, tx, ty, tw, th);
        }
    }
    // 噪声扰动的不规则边界 + 宽淡入淡出（替代规整圆形/直边）
    const noise = _makeNoiseMask(ps, rand);
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = ps;
    maskCanvas.height = ps;
    const mctx = maskCanvas.getContext('2d');
    const imgData = mctx.createImageData(ps, ps);
    const md = imgData.data;
    for (let y = 0; y < ps; y++) {
        for (let x = 0; x < ps; x++) {
            const d = Math.hypot(x - ps / 2, y - ps / 2) / (ps / 2);
            const n = noise[y * ps + x];
            const b = 0.52 + 0.22 * n;
            const fw = 0.18;
            let t = (b - d) / fw + 0.5;
            t = Math.max(0, Math.min(1, t));
            const a = t * t * (3 - 2 * t);
            const idx = (y * ps + x) * 4;
            md[idx] = md[idx + 1] = md[idx + 2] = 255;
            md[idx + 3] = Math.round(a * 255);
        }
    }
    mctx.putImageData(imgData, 0, 0);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(maskCanvas, 0, 0);
    ctx.drawImage(tc, gx - ox - ps / 2, gy - oy - ps / 2);
}

/** 双八度值噪声（-1~1），用于沙地补丁不规则边界（种子确定性） */
function _makeNoiseMask(ps, rand) {
    const octaves = [[14, 0.6], [40, 0.4]];
    const mask = new Float32Array(ps * ps);
    let total = 0;
    for (const [cell, amp] of octaves) {
        const cols = Math.ceil(ps / cell) + 2;
        const rows = Math.ceil(ps / cell) + 2;
        const vals = new Float32Array(rows * cols);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) vals[r * cols + c] = rand() * 2 - 1;
        }
        for (let y = 0; y < ps; y++) {
            const fy = y / cell;
            const y0 = Math.floor(fy);
            const ty = fy - y0;
            for (let x = 0; x < ps; x++) {
                const fx = x / cell;
                const x0 = Math.floor(fx);
                const tx = fx - x0;
                const v00 = vals[y0 * cols + x0];
                const v10 = vals[y0 * cols + x0 + 1];
                const v01 = vals[(y0 + 1) * cols + x0];
                const v11 = vals[(y0 + 1) * cols + x0 + 1];
                const v0 = v00 + (v10 - v00) * tx;
                const v1 = v01 + (v11 - v01) * tx;
                mask[y * ps + x] += (v0 + (v1 - v0) * ty) * amp;
            }
        }
        total += amp;
    }
    const inv = total > 0 ? 1 / total : 1;
    for (let i = 0; i < mask.length; i++) mask[i] *= inv;
    return mask;
}

/** 最终地貌合成完成后再画边界淡出，避免细节格或随机小件盖回黑色过渡带。 */
function _drawChunkEdgeFade(ctx, ox, oy, cw, ch, mapW, mapH, diamond) {
    const fade = FLOOR_EDGE_FADE;
    if (diamond) {
        const ddx = diamond.cx - ox;
        const ddy = diamond.cy - oy;
        for (let i = 0; i < fade; i += 2) {
            const irx = diamond.rx - i;
            const iry = diamond.ry - i * (diamond.ry / diamond.rx);
            ctx.beginPath();
            ctx.moveTo(ddx, ddy - iry);
            ctx.lineTo(ddx + irx, ddy);
            ctx.lineTo(ddx, ddy + iry);
            ctx.lineTo(ddx - irx, ddy);
            ctx.closePath();
            ctx.strokeStyle = `rgba(0,0,0,${(0.40 * (1 - i / fade)).toFixed(3)})`;
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }
        return;
    }
    if (oy <= 0) {
        const gradient = ctx.createLinearGradient(0, 0, 0, fade);
        gradient.addColorStop(0, 'rgba(0,0,0,1)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, cw, fade);
    }
    if (oy + ch >= mapH) {
        const gradient = ctx.createLinearGradient(0, ch - fade, 0, ch);
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, ch - fade, cw, fade);
    }
    if (ox <= 0) {
        const gradient = ctx.createLinearGradient(0, 0, fade, 0);
        gradient.addColorStop(0, 'rgba(0,0,0,1)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, fade, ch);
    }
    if (ox + cw >= mapW) {
        const gradient = ctx.createLinearGradient(cw - fade, 0, cw, 0);
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = gradient;
        ctx.fillRect(cw - fade, 0, fade, ch);
    }
}

/**
 * 烘焙单块地板（2048² 分块惰性加载用）。
 * 只在地图边界上的块，其对应外侧边叠加黑色渐隐（FLOOR_EDGE_FADE）。
 * @param {number} ox 块世界坐标 X（左上角）
 * @param {number} oy 块世界坐标 Y（左上角）
 * @param {number} cw 块宽
 * @param {number} ch 块高
 * @param {number} mapW 地图宽
 * @param {number} mapH 地图高
 * @param {object} [fallbackTerrain] 贴图缺失时的网格回退样式
 * @returns {HTMLCanvasElement}
 */
export function bakeDungeonFloorChunk(ox, oy, cw, ch, mapW, mapH, fallbackTerrain, diamond) {
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    const profile = _getProfile();
    ctx.fillStyle = diamond ? '#000000' : (profile.backgroundColor || '#000000');
    ctx.fillRect(0, 0, cw, ch);
    const tiles = _collectTiles(profile);
    if (tiles.length > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, cw, ch);
        ctx.clip();
        if (diamond) {
            // 菱形裁剪（块局部坐标）：与矩形裁剪叠加 = 菱形 ∩ 本块
            const ddx = diamond.cx - ox;
            const ddy = diamond.cy - oy;
            ctx.beginPath();
            ctx.moveTo(ddx, ddy - diamond.ry);
            ctx.lineTo(ddx + diamond.rx, ddy);
            ctx.lineTo(ddx, ddy + diamond.ry);
            ctx.lineTo(ddx - diamond.rx, ddy);
            ctx.closePath();
            ctx.clip();
        }
        if (profile.continuous) {
            // 连续铺贴：世界坐标对齐相位重复整张无缝纹理（跨块/跨方向无接缝）；
            // 纵向按 30° 等距投影压缩（0.5774），避免"垂直俯视"观感
            _drawContinuousLayer(ctx, tiles[0].img, ox, oy, cw, ch, profile.textureScaleY ?? 0.5774);
        } else {
            _drawIsoLayerChunk(ctx, tiles, ox, oy, cw, ch, profile.overlapX ?? 0, profile.overlapY ?? 0);
        }
        if (profile.glow !== false) {
            const glowTiles = [];
            for (const t of tiles) {
                const img = _getSourceImage(t.key + '_glow');
                if (img) glowTiles.push({ key: t.key, img, geo: _getTileGeometry(t.key + '_glow', img) });
            }
            if (glowTiles.length > 0) {
                ctx.globalCompositeOperation = 'lighter';
                if (profile.continuous) {
                    _drawContinuousLayer(ctx, glowTiles[0].img, ox, oy, cw, ch, profile.textureScaleY ?? 0.5774);
                } else {
                    _drawIsoLayerChunk(ctx, glowTiles, ox, oy, cw, ch, profile.overlapX ?? 0, profile.overlapY ?? 0);
                }
                ctx.globalCompositeOperation = 'source-over';
            }
        }
        ctx.restore();
        // 连续底材之上依次叠加格网地貌、软边补丁和世界坐标小件；边界淡出必须最后绘制。
        _drawFloorCellDetails(ctx, profile, ox, oy, cw, ch, diamond);
        _drawSandPatches(ctx, profile, ox, oy, cw, ch, diamond);
        _drawFloorDecoChunk(ctx, profile, ox, oy, cw, ch, diamond);
        _drawChunkEdgeFade(ctx, ox, oy, cw, ch, mapW, mapH, diamond);
    } else {
        const tc = fallbackTerrain || DEFAULT_FALLBACK_TERRAIN;
        ctx.fillStyle = tc.floorColor;
        ctx.fillRect(0, 0, cw, ch);
        ctx.strokeStyle = tc.gridColor;
        ctx.lineWidth = 1;
        for (let bx = ox % tc.gridSize; bx < cw; bx += tc.gridSize) {
            ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, ch); ctx.stroke();
        }
        for (let by = oy % tc.gridSize; by < ch; by += tc.gridSize) {
            ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(cw, by); ctx.stroke();
        }
        ctx.strokeStyle = tc.edgeHighlight;
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, cw, ch);
    }
    return canvas;
}

/**
 * 分块惰性地板：注册地形为「2048² 块集合」，由 GameScene 按相机视口按需烘焙/卸载。
 * 单张全图纹理（terrainTexture）置空，避免大地图一次性 96MB+ 显存。
 * @param {number} width 世界宽
 * @param {number} height 世界高
 * @param {number} [chunkSize=2048] 块边长
 */
export function applyDungeonFloorChunked(width, height, chunkSize = 2048, diamond = null, pad = 3) {
    if (CONFIG) {
        CONFIG.WORLD_WIDTH = width;
        CONFIG.WORLD_HEIGHT = height;
    }
    if (Renderer) {
        Renderer.terrainTexture = null;
        Renderer.terrainChunks = { chunkSize, mapW: width, mapH: height, diamond: diamond || null, pad };
    }
    if (typeof window !== 'undefined' && window.__phaserScene && typeof window.__phaserScene.syncTerrain === 'function') {
        window.__phaserScene.syncTerrain();
    }
}

/** 取当前地板配置（外部只读：门外白区等需要跟随当前地牢地砖的场景用） */
export function getDungeonFloorProfile() {
    return _getProfile();
}

/**
 * 烘焙地牢地板到离屏 canvas
 * @param {number} size 场地边长（正方形）
 * @param {object} [fallbackTerrain] 回退网格地板样式
 * @returns {HTMLCanvasElement}
 */
export function bakeDungeonFloor(size, fallbackTerrain) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 1. 全屏背景色（默认可通过 floor profile 覆盖，用于匹配地砖色调避免缝隙露黑）
    const profile = _getProfile();
    ctx.fillStyle = profile.backgroundColor || '#000000';
    ctx.fillRect(0, 0, size, size);

    const tiles = [];
    for (const key of profile.tiles) {
        const img = _getSourceImage(key);
        if (img) tiles.push({ key, img, geo: _getTileGeometry(key, img) });
        else console.warn('[DungeonFloor] 地砖纹理缺失（已从池中剔除）:', key);
    }
    if (profile.tiles.length > 0) {
        console.log(`[DungeonFloor] 地砖池 ${tiles.length}/${profile.tiles.length}:`, tiles.map(t => t.key).join(','));
    }

    if (tiles.length > 0) {
        // 2. 基础层：等距菱形平铺（随机选图 + 随机镜像）
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, size, size);
        ctx.clip();
        if (profile.continuous) {
            _drawContinuousLayer(ctx, tiles[0].img, 0, 0, size, size, profile.textureScaleY ?? 0.5774);
        } else {
            _drawIsoLayer(ctx, tiles, size, size, profile.overlapX ?? 0, profile.overlapY ?? 0);
        }

        // 3. 发光层（机制保留）：profile.glow 开启且存在 <贴图键>_glow 时同位置 ADD 平铺
        if (profile.glow !== false) {
            const glowTiles = [];
            for (const t of tiles) {
                const img = _getSourceImage(t.key + '_glow');
                if (img) glowTiles.push({ key: t.key, img, geo: _getTileGeometry(t.key + '_glow', img) });
            }
            if (glowTiles.length > 0) {
                ctx.globalCompositeOperation = 'lighter';
                if (profile.continuous) {
                    _drawContinuousLayer(ctx, glowTiles[0].img, 0, 0, size, size, profile.textureScaleY ?? 0.5774);
                } else {
                    _drawIsoLayer(ctx, glowTiles, size, size, profile.overlapX ?? 0, profile.overlapY ?? 0);
                }
                ctx.globalCompositeOperation = 'source-over';
            }
        }
        ctx.restore();

        // 连续底材之上的确定性碎石细节与18种无碰撞小物；矩形地板由四周淡出最后收边。
        _drawFloorCellDetails(ctx, profile, 0, 0, size, size, null);
        _drawFloorDecoChunk(ctx, profile, 0, 0, size, size, null);

        // 4. 边缘过渡：在场地四周叠加黑->透明的渐变，与纯黑背景融合
        const fade = FLOOR_EDGE_FADE;
        let grad;

        grad = ctx.createLinearGradient(0, 0, 0, fade);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, fade);

        grad = ctx.createLinearGradient(0, size - fade, 0, size);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, size - fade, size, fade);

        grad = ctx.createLinearGradient(0, 0, fade, 0);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, fade, size);

        grad = ctx.createLinearGradient(size - fade, 0, size, 0);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = grad;
        ctx.fillRect(size - fade, 0, fade, size);
    } else {
        // 贴图未全部加载时回退到旧版网格地板
        console.warn('[DungeonFloor] 地板贴图未加载，使用回退网格地板');
        const tc = fallbackTerrain || DEFAULT_FALLBACK_TERRAIN;
        ctx.fillStyle = tc.floorColor;
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = tc.gridColor;
        ctx.lineWidth = 1;
        for (let bx = 0; bx < size; bx += tc.gridSize) {
            ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, size); ctx.stroke();
        }
        for (let by = 0; by < size; by += tc.gridSize) {
            ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(size, by); ctx.stroke();
        }
        ctx.strokeStyle = tc.edgeHighlight;
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, size, size);
    }
    return canvas;
}

/**
 * 烘焙菱形地板并应用到渲染器（僵尸地牢战斗房/Boss 场地）
 * 菱形可移动区域外保持全黑，边缘黑渐变过渡
 * @param {number} width 世界宽
 * @param {number} height 世界高
 * @param {number} cx 菱形中心 X
 * @param {number} cy 菱形中心 Y
 * @param {number} rx 菱形水平半径
 * @param {number} ry 菱形垂直半径
 * @param {object} [fallbackTerrain] 回退网格地板样式
 */
export function applyDiamondFloor(width, height, cx, cy, rx, ry, fallbackTerrain) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // 1. 全屏纯黑背景（菱形外区域保持全黑）
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const profile = _getProfile();
    const tiles = [];
    for (const key of profile.tiles) {
        const img = _getSourceImage(key);
        if (img) tiles.push({ key, img, geo: _getTileGeometry(key, img) });
        else console.warn('[DungeonFloor] 地砖纹理缺失（已从池中剔除）:', key);
    }
    if (profile.tiles.length > 0) {
        console.log(`[DungeonFloor] 地砖池 ${tiles.length}/${profile.tiles.length}:`, tiles.map(t => t.key).join(','));
    }

    const diamondPath = (inset) => {
        const irx = rx - inset, iry = ry - inset * (ry / rx);
        ctx.beginPath();
        ctx.moveTo(cx, cy - iry);
        ctx.lineTo(cx + irx, cy);
        ctx.lineTo(cx, cy + iry);
        ctx.lineTo(cx - irx, cy);
        ctx.closePath();
    };

    if (tiles.length > 0) {
        // 2. 菱形裁剪内平铺等距地板
        ctx.save();
        diamondPath(0);
        ctx.clip();
        if (profile.continuous) {
            _drawContinuousLayer(ctx, tiles[0].img, 0, 0, width, height, profile.textureScaleY ?? 0.5774);
        } else {
            _drawIsoLayer(ctx, tiles, width, height, profile.overlapX ?? 0, profile.overlapY ?? 0);
        }
        if (profile.glow !== false) {
            const glowTiles = [];
            for (const t of tiles) {
                const img = _getSourceImage(t.key + '_glow');
                if (img) glowTiles.push({ key: t.key, img, geo: _getTileGeometry(t.key + '_glow', img) });
            }
            if (glowTiles.length > 0) {
                ctx.globalCompositeOperation = 'lighter';
                if (profile.continuous) {
                    _drawContinuousLayer(ctx, glowTiles[0].img, 0, 0, width, height, profile.textureScaleY ?? 0.5774);
                } else {
                    _drawIsoLayer(ctx, glowTiles, width, height, profile.overlapX ?? 0, profile.overlapY ?? 0);
                }
                ctx.globalCompositeOperation = 'source-over';
            }
        }
        ctx.restore();

        // 小件中心按菱形内缩筛选，视觉尺寸也留足边距；墙脚淡出仍最后绘制。
        const floorDiamond = { cx, cy, rx, ry };
        _drawFloorCellDetails(ctx, profile, 0, 0, width, height, floorDiamond);
        _drawFloorDecoChunk(ctx, profile, 0, 0, width, height, floorDiamond);

        // 3. 墙脚接触阴影（标准：所有墙壁-地板衔接处统一）：沿菱形边缘向内的真渐变带，
        // 墙根处最暗（约 40% 黑）→ 向内 64px 渐隐到 0。逐笔 alpha 递减叠加自然成梯度；
        // 旧版是 16 笔等 alpha(0.12) 平刷——整带只有约 15% 平黑，亮地砖上几乎不可见
        // （中级/初级"没有阴影"的根因：blackbrick-7/8 亮度 50 是高级砖 25 的两倍）
        const fade = FLOOR_EDGE_FADE;
        for (let i = 0; i < fade; i += 2) {
            diamondPath(i);
            ctx.strokeStyle = `rgba(0,0,0,${(0.40 * (1 - i / fade)).toFixed(3)})`;
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }
    } else {
        console.warn('[DungeonFloor] 地板贴图未加载，菱形房回退为纯黑 + 轮廓线');
        diamondPath(0);
        ctx.strokeStyle = (fallbackTerrain && fallbackTerrain.edgeHighlight) || 'rgba(120, 80, 60, 0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // 4. 同步世界尺寸与渲染器
    if (CONFIG) {
        CONFIG.WORLD_WIDTH = width;
        CONFIG.WORLD_HEIGHT = height;
    }
    if (Renderer) {
        Renderer.terrainTexture = canvas;
        Renderer.terrainChunks = null; // 离开分块模式
    }
    if (typeof window !== 'undefined' && window.__phaserScene && typeof window.__phaserScene.syncTerrain === 'function') {
        window.__phaserScene.syncTerrain();
    }
    return canvas;
}

/**
 * 烘焙多菱形竞技场地板并应用到渲染器（D 级及以上三房间串联竞技场）
 * - 三房菱形 + 通道平行四边形 + 门口补丁矩形并集裁剪铺砖
 * - 墙脚阴影与 E/F 单房间 applyDiamondFloor 同口径：菱形整圈内缩渐变带（含门口，
 *   门洞处不断头）；走廊只描两条长边（侧墙墙脚），不描补丁轮廓
 * @param {number} width 世界宽
 * @param {number} height 世界高
 * @param {Array} diamonds 菱形房间数组
 * @param {Array} [corridors] 通道地板平行四边形数组（points: [a1+, a2+, a2-, a1-]）
 * @param {Array} [patches] 门口门槛地板矩形数组
 * @param {object} [fallbackTerrain] 回退网格地板样式
 */
export function applyArenaFloor(width, height, diamonds, corridors = [], patches = [], fallbackTerrain) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // 1. 全屏纯黑背景（房间/通道外区域保持全黑）
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    const profile = _getProfile();
    const tiles = [];
    for (const key of profile.tiles) {
        const img = _getSourceImage(key);
        if (img) tiles.push({ key, img, geo: _getTileGeometry(key, img) });
        else console.warn('[DungeonFloor] 地砖纹理缺失（已从池中剔除）:', key);
    }

    const arenaPath = () => {
        ctx.beginPath();
        for (const d of diamonds) {
            ctx.moveTo(d.cx, d.cy - d.ry);
            ctx.lineTo(d.cx + d.rx, d.cy);
            ctx.lineTo(d.cx, d.cy + d.ry);
            ctx.lineTo(d.cx - d.rx, d.cy);
            ctx.closePath();
        }
        // 统一多边形绕向与菱形一致（shoelace 正号）：nonzero 裁剪下绕向相反的子路径
        // 会在与菱形/其他补丁的重叠区抵消成洞（地板纯黑平行四边形缺口的根因）
        for (const q of [...corridors, ...patches]) {
            let pts = q.points;
            let area2 = 0;
            for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
                area2 += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
            }
            if (area2 < 0) pts = [...pts].reverse();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.closePath();
        }
    };

    if (tiles.length > 0) {
        // 2. 房间+通道并集裁剪内平铺等距地板
        ctx.save();
        arenaPath();
        ctx.clip();
        if (profile.continuous) {
            _drawContinuousLayer(ctx, tiles[0].img, 0, 0, width, height, profile.textureScaleY ?? 0.5774);
        } else {
            _drawIsoLayer(ctx, tiles, width, height, profile.overlapX ?? 0, profile.overlapY ?? 0);
        }
        if (profile.glow !== false) {
            const glowTiles = [];
            for (const t of tiles) {
                const img = _getSourceImage(t.key + '_glow');
                if (img) glowTiles.push({ key: t.key, img, geo: _getTileGeometry(t.key + '_glow', img) });
            }
            if (glowTiles.length > 0) {
                ctx.globalCompositeOperation = 'lighter';
                if (profile.continuous) {
                    _drawContinuousLayer(ctx, glowTiles[0].img, 0, 0, width, height, profile.textureScaleY ?? 0.5774);
                } else {
                    _drawIsoLayer(ctx, glowTiles, width, height, profile.overlapX ?? 0, profile.overlapY ?? 0);
                }
                ctx.globalCompositeOperation = 'source-over';
            }
        }
        ctx.restore();

        // 18种无碰撞小物只进入房间菱形，不进入狭窄通道；通道继续保持清晰通行轮廓。
        _drawFloorCellDetails(ctx, profile, 0, 0, width, height, diamonds);
        _drawFloorDecoChunk(ctx, profile, 0, 0, width, height, diamonds);

        // 3. 墙脚接触阴影（与 E/F 单房间 applyDiamondFloor 同口径的连续渐变带）：
        //    - 房间菱形：整圈内缩渐变描边（含门口，老代码原文，门洞处不断头）；
        //    - 走廊：只描两条长边（通道侧墙墙脚），不描端帽/补丁轮廓——
        //      描补丁轮廓会在门口画出尖锐黑三角边框（线上教训）
        const fade = FLOOR_EDGE_FADE;
        for (let i = 0; i < fade; i += 2) {
            ctx.beginPath();
            for (const d of diamonds) {
                const irx = d.rx - i, iry = d.ry - i * (d.ry / d.rx);
                ctx.moveTo(d.cx, d.cy - iry);
                ctx.lineTo(d.cx + irx, d.cy);
                ctx.lineTo(d.cx, d.cy + iry);
                ctx.lineTo(d.cx - irx, d.cy);
                ctx.closePath();
            }
            ctx.strokeStyle = `rgba(0,0,0,${(0.40 * (1 - i / fade)).toFixed(3)})`;
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }
        for (const q of corridors) {
            // 平行四边形 points: [a1+, a2+, a2-, a1-] —— 长边 = 0→1 与 3→2
            for (const [lw, alpha] of [[30, 0.22], [18, 0.14], [9, 0.08]]) {
                for (const [p0, p1] of [[q.points[0], q.points[1]], [q.points[3], q.points[2]]]) {
                    ctx.beginPath();
                    ctx.moveTo(p0.x, p0.y);
                    ctx.lineTo(p1.x, p1.y);
                    ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
                    ctx.lineWidth = lw;
                    ctx.lineCap = 'round';
                    ctx.stroke();
                }
            }
        }
    } else {
        console.warn('[DungeonFloor] 地板贴图未加载，竞技场回退为纯黑 + 轮廓线');
        arenaPath();
        ctx.strokeStyle = (fallbackTerrain && fallbackTerrain.edgeHighlight) || 'rgba(120, 80, 60, 0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // 3. 同步世界尺寸与渲染器
    if (CONFIG) {
        CONFIG.WORLD_WIDTH = width;
        CONFIG.WORLD_HEIGHT = height;
    }
    if (Renderer) {
        Renderer.terrainTexture = canvas;
        Renderer.terrainChunks = null; // 离开分块模式
    }
    if (typeof window !== 'undefined' && window.__phaserScene && typeof window.__phaserScene.syncTerrain === 'function') {
        window.__phaserScene.syncTerrain();
    }
    return canvas;
}

/**
 * 烘焙地板并应用到渲染器（同步世界尺寸与 Phaser 地形）
 * @param {number} size 场地边长
 * @param {object} [fallbackTerrain] 回退网格地板样式
 */
export function applyDungeonFloor(size, fallbackTerrain) {
    const canvas = bakeDungeonFloor(size, fallbackTerrain);
    // 更新世界尺寸（必须先设置，否则 syncTerrain 会用旧尺寸生成绿色默认地形）
    if (CONFIG) {
        CONFIG.WORLD_WIDTH = size;
        CONFIG.WORLD_HEIGHT = size;
    }
    // 应用到渲染器
    if (Renderer) {
        Renderer.terrainTexture = canvas;
        Renderer.terrainChunks = null; // 离开分块模式
    }
    if (typeof window !== 'undefined' && window.__phaserScene && typeof window.__phaserScene.syncTerrain === 'function') {
        window.__phaserScene.syncTerrain();
    }
    return canvas;
}
