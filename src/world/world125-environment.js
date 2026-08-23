/**
 * 世界-125 地牢遗迹环境散布。
 *
 * 复用僵尸地牢/摆墙系统的障碍物几何与预制组合：
 * - 石柱按 obstacle-defaults 的编辑器尺寸生成；
 * - 预制组合取 wall-prefabs 中「火把墙」之后、不含烛台的纯障碍物组合；
 * - 烛台只允许通过 dungeon_candle 建筑生成，保证每一座都可摧毁且受科技/费用约束；
 * - 所有落点走菱形边界、出生点/返回门排除、footprint 碰撞与组合间距校验。
 */
import { WallSystem } from './wall-system.js';
import { getObstacleDefaults, getWallPrefabLibrary } from './wall-prefabs.js';

const PREFAB_POOL_START = '火把墙';
const DEFAULT_CONFIG = {
    pillarCount: 28,
    candleCount: 0,
    prefabCount: 22,
    minDist: 220,
    edgeInset: 180,
    playerExclusion: 520,
    portalExclusion: 420,
    scaleJitter: 0.08,
};

function _insideDiamond(diamond, x, y, inset = 0) {
    const rx = Math.max(1, diamond.rx - inset);
    const ry = Math.max(1, diamond.ry - inset * (diamond.ry / diamond.rx));
    return Math.abs(x - diamond.cx) / rx + Math.abs(y - diamond.cy) / ry <= 1;
}

function _rectsOverlap(a, b, gap = 0) {
    return a.x - gap < b.x + b.w
        && a.x + a.w + gap > b.x
        && a.y - gap < b.y + b.h
        && a.y + a.h + gap > b.y;
}

function _fallbackRect(piece) {
    return { x: piece.x - 20, y: piece.y - 20, w: 40, h: 40 };
}

function _pieceRect(piece) {
    return WallSystem.getObstacleFootprintRect?.(piece) || _fallbackRect(piece);
}

function _footCenter(rect) {
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function _randomPoint(scene, diamond, inset, random) {
    for (let i = 0; i < 80; i++) {
        const x = inset + random() * Math.max(1, scene.width - inset * 2);
        const y = inset + random() * Math.max(1, scene.height - inset * 2);
        if (_insideDiamond(diamond, x, y, inset)) return { x, y };
    }
    return null;
}

function _scaleFor(geoKey, geo, jitter, random) {
    const defaults = getObstacleDefaults();
    const saved = defaults && defaults[geoKey];
    const baseX = saved?.scaleX ?? saved?.scaleY ?? ((geo.obstacleH || 180) / geo.h);
    const baseY = saved?.scaleY ?? saved?.scaleX ?? ((geo.obstacleH || 180) / geo.h);
    const mul = 1 - jitter + random() * jitter * 2;
    return {
        scaleX: baseX * mul,
        scaleY: baseY * mul,
        rotation: saved?.rotation || 0,
        flipX: saved?.flipX ?? (random() < 0.5),
        flipY: !!saved?.flipY,
    };
}

function _prefabPool() {
    const library = getWallPrefabLibrary();
    const keys = Object.keys(library);
    const start = keys.indexOf(PREFAB_POOL_START);
    if (start < 0) return [];
    return keys.slice(start + 1).filter((key) => {
        const prefab = library[key];
        return prefab && Array.isArray(prefab.pieces) && prefab.pieces.length > 0
            && prefab.pieces.every((piece) => {
                const geo = WallSystem._geoForTex?.(piece.tex);
                return piece.tex !== 'obstacle_candle'
                    && geo && geo.category === 'obstacle';
            });
    });
}

function _candidateAllowed(rects, placedRects, anchors, cfg, diamond, player, portalY) {
    for (const rect of rects) {
        const center = _footCenter(rect);
        const radius = Math.max(rect.w, rect.h) / 2;
        if (!_insideDiamond(diamond, center.x, center.y, cfg.edgeInset + radius)) return false;
        if (player && Math.hypot(center.x - player.x, center.y - player.y) < cfg.playerExclusion + radius) return false;
        if (Math.hypot(center.x - diamond.cx, center.y - portalY) < cfg.portalExclusion + radius) return false;
        if (!WallSystem.canMoveTo?.(center.x, center.y, radius)) return false;
        if (placedRects.some((other) => _rectsOverlap(rect, other, 36))) return false;
    }
    const anchor = rects.reduce((acc, rect) => {
        const center = _footCenter(rect);
        acc.x += center.x;
        acc.y += center.y;
        return acc;
    }, { x: 0, y: 0 });
    anchor.x /= rects.length;
    anchor.y /= rects.length;
    if (anchors.some((other) => Math.hypot(anchor.x - other.x, anchor.y - other.y) < cfg.minDist)) return false;
    return true;
}

function _commitPieces(pieces, placedRects, anchors) {
    const rects = pieces.map(_pieceRect);
    for (const piece of pieces) WallSystem.isoVisuals.push(piece);
    placedRects.push(...rects);
    const anchor = rects.reduce((acc, rect) => {
        const center = _footCenter(rect);
        acc.x += center.x;
        acc.y += center.y;
        return acc;
    }, { x: 0, y: 0 });
    anchors.push({ x: anchor.x / rects.length, y: anchor.y / rects.length });
}

function _placeSingles(scene, diamond, player, portalY, cfg, geoKey, wanted, placedRects, anchors, random) {
    const geo = WallSystem._geoForTex?.(`obstacle_${geoKey}`);
    if (!geo) return 0;
    let placed = 0;
    let tries = 0;
    while (placed < wanted && tries++ < wanted * 60) {
        const point = _randomPoint(scene, diamond, cfg.edgeInset, random);
        if (!point) break;
        const transform = _scaleFor(geoKey, geo, cfg.scaleJitter, random);
        const piece = {
            tex: geo.tex,
            x: point.x,
            y: point.y,
            ...transform,
            _scatter: true,
            _world125Environment: true,
        };
        const rects = [_pieceRect(piece)];
        if (!_candidateAllowed(rects, placedRects, anchors, cfg, diamond, player, portalY)) continue;
        _commitPieces([piece], placedRects, anchors);
        placed++;
    }
    return placed;
}

function _stagePrefab(prefab, key, anchor) {
    let bx = prefab.cx;
    let by = prefab.cy;
    if (!Number.isFinite(bx) || !Number.isFinite(by)) {
        bx = prefab.pieces.reduce((sum, piece) => sum + piece.x, 0) / prefab.pieces.length;
        by = prefab.pieces.reduce((sum, piece) => sum + piece.y, 0) / prefab.pieces.length;
    }
    const minDepth = Math.min(...prefab.pieces.map((piece) => piece.depth ?? piece.y));
    const first = prefab.pieces.reduce((best, piece) =>
        ((piece.depth ?? piece.y) < (best.depth ?? best.y) ? piece : best), prefab.pieces[0]);
    const basePiece = {
        tex: first.tex,
        x: anchor.x + first.x - bx,
        y: anchor.y + first.y - by,
        scaleX: first.scaleX ?? 1,
        scaleY: first.scaleY ?? first.scaleX ?? 1,
        rotation: first.rotation || 0,
        flipX: !!first.flipX,
        flipY: !!first.flipY,
    };
    const baseDepth = WallSystem.obstacleDepthOf(basePiece);
    return prefab.pieces.map((source) => ({
        tex: source.tex,
        x: anchor.x + source.x - bx,
        y: anchor.y + source.y - by,
        scaleX: source.scaleX ?? 1,
        scaleY: source.scaleY ?? source.scaleX ?? 1,
        rotation: source.rotation || 0,
        flipX: !!source.flipX,
        flipY: !!source.flipY,
        depth: baseDepth + ((source.depth ?? source.y) - minDepth),
        depthManual: true,
        _scatter: true,
        _world125Environment: true,
        _prefabKey: key,
        _compAnchor: { x: anchor.x, y: anchor.y },
    }));
}

function _placePrefabs(scene, diamond, player, portalY, cfg, placedRects, anchors, random) {
    const library = getWallPrefabLibrary();
    const pool = _prefabPool();
    if (!pool.length) return 0;
    let placed = 0;
    let tries = 0;
    let available = [];
    while (placed < cfg.prefabCount && tries++ < cfg.prefabCount * 80) {
        if (!available.length) {
            available = [...pool];
            for (let i = available.length - 1; i > 0; i--) {
                const j = Math.floor(random() * (i + 1));
                [available[i], available[j]] = [available[j], available[i]];
            }
        }
        const key = available.pop();
        const prefab = library[key];
        const point = _randomPoint(scene, diamond, cfg.edgeInset, random);
        if (!prefab || !point) continue;
        const staged = _stagePrefab(prefab, key, point);
        const rects = staged.map(_pieceRect);
        if (!_candidateAllowed(rects, placedRects, anchors, cfg, diamond, player, portalY)) continue;
        _commitPieces(staged, placedRects, anchors);
        placed++;
    }
    return placed;
}

/**
 * @returns {{pillars:number,candles:number,prefabs:number,pieces:number}}
 */
export function scatterWorld125Environment(scene, diamond, player = null, { random = Math.random } = {}) {
    if (!scene || !diamond || scene.dungeonObstacleScatter?.enabled === false) {
        return { pillars: 0, candles: 0, prefabs: 0, pieces: 0 };
    }
    const cfg = { ...DEFAULT_CONFIG, ...(scene.dungeonObstacleScatter || {}) };
    const portalY = diamond.cy + diamond.ry - 160;
    const placedRects = [];
    const anchors = [];
    const before = WallSystem.isoVisuals.length;

    const pillars = _placeSingles(
        scene, diamond, player, portalY, cfg, 'pillar', cfg.pillarCount, placedRects, anchors, random
    );
    // 世界-125 不再散布不可摧毁的装饰烛台；所有可见烛台均来自可建造实体。
    const candles = 0;
    const prefabs = _placePrefabs(scene, diamond, player, portalY, cfg, placedRects, anchors, random);

    if (WallSystem.isoVisuals.length > before) WallSystem.rebuildIsoCollision?.();
    WallSystem._syncWallsToPhaser?.();
    const pieces = WallSystem.isoVisuals.length - before;
    console.log(`[scene11] 地牢遗迹环境：石柱 ${pillars}、无烛台组合 ${prefabs}（共 ${pieces} 件）`);
    return { pillars, candles, prefabs, pieces };
}
