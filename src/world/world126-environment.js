/**
 * 世界-126 矿洞位面环境散布。
 *
 * 地板与 18 件低矮小物由 abandoned-mine-terrain.json 的 floor profile 烘焙；本模块
 * 只负责五类具备真实 footprint 的路径障碍。障碍保持获批视角/底边，不随机翻转或旋转，
 * 并复用世界散布障碍的碰撞、建造清除和 footprint 前缘深度合同。
 */
import abandonedMineTerrainConfig from '../../data/abandoned-mine-terrain.json';
import { WallSystem } from './wall-system.js';

function insideDiamond(diamond, x, y, inset = 0) {
    const rx = Math.max(1, diamond.rx - inset);
    const ry = Math.max(1, diamond.ry - inset * (diamond.ry / diamond.rx));
    return Math.abs(x - diamond.cx) / rx + Math.abs(y - diamond.cy) / ry <= 1;
}

function rectInsideDiamond(rect, diamond, inset) {
    return [
        [rect.x, rect.y],
        [rect.x + rect.w, rect.y],
        [rect.x + rect.w, rect.y + rect.h],
        [rect.x, rect.y + rect.h],
    ].every(([x, y]) => insideDiamond(diamond, x, y, inset));
}

function rectsOverlap(a, b, gap = 0) {
    return a.x - gap < b.x + b.w
        && a.x + a.w + gap > b.x
        && a.y - gap < b.y + b.h
        && a.y + a.h + gap > b.y;
}

function footCenter(rect) {
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function clearOfWallCollision(rect) {
    if (!WallSystem.canMoveTo) return true;
    const pad = 4;
    const probes = [
        [rect.x + rect.w / 2, rect.y + rect.h / 2],
        [rect.x + pad, rect.y + pad],
        [rect.x + rect.w - pad, rect.y + pad],
        [rect.x + rect.w - pad, rect.y + rect.h - pad],
        [rect.x + pad, rect.y + rect.h - pad],
    ];
    return probes.every(([x, y]) => WallSystem.canMoveTo(x, y, 8));
}

function weightedOrder(assets, random) {
    const pool = [...assets];
    const ordered = [];
    while (pool.length) {
        const total = pool.reduce((sum, asset) => sum + Math.max(0.001, Number(asset.weight) || 1), 0);
        let roll = random() * total;
        let pick = pool.length - 1;
        for (let i = 0; i < pool.length; i++) {
            roll -= Math.max(0.001, Number(pool[i].weight) || 1);
            if (roll <= 0) { pick = i; break; }
        }
        ordered.push(pool.splice(pick, 1)[0]);
    }
    return ordered;
}

function createPiece(asset, centerX, centerY) {
    const geo = WallSystem._geoForTex?.(asset.key);
    if (!geo?.foot || !(geo.h > 0)) return null;
    const displayH = Number(asset.displayH) || geo.obstacleH || geo.h;
    const scale = displayH / geo.h;
    const footDepth = geo.foot.d * scale;
    const groundY = centerY + footDepth / 2;
    const piece = {
        tex: asset.key,
        x: centerX,
        y: groundY - displayH / 2,
        scaleX: scale,
        scaleY: scale,
        rotation: 0,
        flipX: false,
        flipY: false,
        _scatter: true,
        _world126Environment: true,
    };
    piece.depth = WallSystem.obstacleFootprintDepthOf(piece);
    piece.depthManual = true;
    return piece;
}

/** @returns {{requested:number,placed:number,byType:Record<string,number>}} */
export function scatterWorld126MineEnvironment(
    scene,
    diamond,
    player = null,
    portal = null,
    { random = Math.random } = {}
) {
    const baseCfg = abandonedMineTerrainConfig.obstacles || {};
    const cfg = { ...baseCfg, ...(scene?.mineObstacleScatter || {}) };
    const assets = (cfg.assets || []).filter(asset =>
        asset?.key && WallSystem._geoForTex?.(asset.key)?.foot
    );
    const requested = Math.max(0, Number(cfg.count) || 0);
    if (!scene || !diamond || !assets.length || !requested || cfg.enabled === false) {
        return { requested, placed: 0, byType: {} };
    }

    const placedRects = [];
    const anchors = [];
    const pieces = [];
    const byType = {};
    let available = [];
    let attempts = 0;
    const maxAttempts = requested * Math.max(1, Number(cfg.maxAttemptsPerObstacle) || 80);
    const edgeInset = Math.max(0, Number(cfg.edgeInset) || 0);
    const footprintGap = Math.max(0, Number(cfg.footprintGap) || 0);
    const minDist = Math.max(0, Number(cfg.minDist) || 0);

    while (pieces.length < requested && attempts++ < maxAttempts) {
        if (!available.length) available = weightedOrder(assets, random);
        const asset = available.pop();
        const x = edgeInset + random() * Math.max(1, scene.width - edgeInset * 2);
        const y = edgeInset + random() * Math.max(1, scene.height - edgeInset * 2);
        const piece = createPiece(asset, x, y);
        if (!piece) continue;
        const rect = WallSystem.getObstacleFootprintRect?.(piece);
        if (!rect || !rectInsideDiamond(rect, diamond, edgeInset)) continue;
        const center = footCenter(rect);
        const radius = Math.max(rect.w, rect.h) / 2;
        if (player && Math.hypot(center.x - player.x, center.y - player.y)
            < (Number(cfg.playerExclusion) || 0) + radius) continue;
        if (portal && Math.hypot(center.x - portal.x, center.y - portal.y)
            < (Number(cfg.portalExclusion) || 0) + radius) continue;
        if (anchors.some(other => Math.hypot(center.x - other.x, center.y - other.y) < minDist)) continue;
        if (placedRects.some(other => rectsOverlap(rect, other, footprintGap))) continue;
        if (!clearOfWallCollision(rect)) continue;
        pieces.push(piece);
        placedRects.push(rect);
        anchors.push(center);
        byType[asset.key] = (byType[asset.key] || 0) + 1;
    }

    WallSystem.isoVisuals.push(...pieces);
    if (pieces.length) WallSystem.rebuildIsoCollision?.();
    WallSystem._syncWallsToPhaser?.();
    console.log(`[scene12] 矿洞位面障碍散布 ${pieces.length}/${requested} 件`);
    return { requested, placed: pieces.length, byType };
}
