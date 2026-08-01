/**
 * 战斗房障碍物生成系统（2026-07-31 规则重写）
 *
 * 三组规则（data/dungeon-config.json combatRoom.obstacles，支持地牢级覆盖/关闭）：
 * 1. 储物区（storage）：随机一个方向角落，2~3 个中件（木桶/陶罐，foot 碰撞）
 *    + 1~2 个小件（头骨/骨头堆，纯装饰）尽可能贴近堆叠，底边锚图层自然形成前后阻挡；
 * 2. 墙饰（wallDecor）：烛台（foot 碰撞）、锁链（纯装饰）贴近墙壁摆放；
 * 3. 骨堆（boneYard）：骨头堆 + 头骨成对生成（2~3 对），头骨随机旋转角度，纯装饰。
 *
 * 碰撞障碍物直接生成 isoVisuals 件——碰撞由 WallSystem.rebuildIsoCollision 的
 * obstacle footprint 分支自动推导，清理随战斗房恢复/重建自动消失；
 * 纯装饰件登记进 CombatRoomSystem._decoSprites（cleanupGate 现有链统一销毁）。
 *
 * 约束：避开房心（宝箱房）、门/通道门 approach、玩家出生点；
 * 跨组碰撞障碍物之间留出 ≥120px 通行走廊（储物区内部不限制，允许贴近）；
 * 放完后寻路兜底（玩家 → 各开着的门可达，不可达则移除最后放置的碰撞障碍，最多 3 个）。
 */
import { WallSystem, ISO_WALL_GEO } from './wall-system.js';
import { pathFinder } from '../ai/pathfinder.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import { getObstacleDefaults } from './wall-prefabs.js';

// 默认配置（JSON 未配置时兜底；正常走 combatRoom.obstacles）
const DEFAULT_OBSTACLES = {
    pillars: { pairs: [1, 2], rangeX: [0.25, 0.60], rangeY: [0, 0.40] },
    storage: {
        mediumKeys: ['barrel', 'pot'], mediumCount: [2, 3],
        smallKeys: ['skull', 'bones'], smallCount: [1, 2],
        targetHMedium: 140, targetHSmall: 80,
        cornerInset: 100, spread: 110,
    },
    wallDecor: { keys: ['candle', 'chains'], count: [2, 3], ring: [0.80, 0.92], targetH: 150, collisionKeys: ['candle'] },
    boneYard: { count: [2, 3], targetH: 80, pairGap: 70, skullRotation: 0.5, ring: [0.25, 0.85] },
};

const CENTER_EXCLUDE = 250;   // 房心排除（宝箱房/中场干净）
const AVOID_GATE = 220;       // 门/通道门 approach 排除半径（avoidPoints 未带 r 时的默认）
const CORRIDOR = 120;         // 跨组碰撞障碍物最小通行走廊
const MAX_REACHABILITY_ROLLBACK = 3;

export const ObstacleSpawnSystem = {
    /**
     * 在单个战斗房间内生成一套障碍物（储物区 + 墙饰 + 骨堆）
     * @param {Object} bounds 房间 bounds（菱形：{cx, cy, rx, ry, diamond:true}）
     * @param {Object} [opts]
     * @param {string} [opts.dungeonType] 地牢类型（读地牢级 combatRoom.obstacles 覆盖）
     * @param {Array}  [opts.avoidPoints] 排除点 [{x, y, r?, reach?}]（门中心/玩家出生点）
     * @param {Object} [opts.player] 玩家位置（可达性兜底校验）
     * @param {Array}  [opts.decoSprites] 装饰件精灵登记数组（传 CombatRoomSystem._decoSprites）
     * @returns {number} 实际放置总数
     */
    spawnForRoom(bounds, opts = {}) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (!scene || !bounds || !bounds.diamond) return 0;
        const crCfg = DungeonConfig.getCombatRoomConfig(opts.dungeonType);
        const cfg = crCfg.obstacles === false ? null : (crCfg.obstacles || DEFAULT_OBSTACLES);
        if (!cfg) return 0;

        const ctx = {
            scene, bounds,
            avoid: (opts.avoidPoints || []).map(p => ({ x: p.x, y: p.y, r: p.r ?? AVOID_GATE, reach: !!p.reach })),
            placedCollision: [], // { x, y, halfW, piece }（跨组走廊与可达性兜底用）
            deco: opts.decoSprites || null,
            total: 0,
        };

        if (cfg.pillars) this._spawnPillars(cfg.pillars, ctx);
        if (cfg.storage) this._spawnStorage(cfg.storage, ctx);
        if (cfg.wallDecor) this._spawnWallDecor(cfg.wallDecor, ctx);
        if (cfg.boneYard) this._spawnBoneYard(cfg.boneYard, ctx);

        // 可达性兜底：玩家 → 各开着的门（reach:true 标记）寻路全部非空；
        // 被堵则移除最后放置的碰撞障碍物重测（上限 3 个）
        const reachTargets = ctx.avoid.filter(a => a.reach);
        if (opts.player && reachTargets.length && ctx.placedCollision.length) {
            let rollbacks = 0;
            let blocked = _unreachableTargets(opts.player, reachTargets);
            while (blocked.length && rollbacks < MAX_REACHABILITY_ROLLBACK && ctx.placedCollision.length) {
                const last = ctx.placedCollision.pop();
                const i = WallSystem.isoVisuals.indexOf(last.piece);
                if (i >= 0) WallSystem.isoVisuals.splice(i, 1);
                ctx.total--;
                rollbacks++;
                blocked = _unreachableTargets(opts.player, reachTargets);
            }
        }
        return ctx.total;
    },

    /**
     * 石柱（大件）：不贴墙，在场地中关于房心点对称生成——
     * 随机一个偏移 (dx, dy)，放 (cx+dx, cy+dy) 与 (cx-dx, cy-dy) 两根（左一根右一根对应）。
     * 两点都通过排除/走廊/可行走校验才成对放置。
     */
    _spawnPillars(cfg, ctx) {
        const g = ISO_WALL_GEO.pillar;
        if (!g || !ctx.scene.textures.exists(g.tex)) return;
        const { bounds } = ctx;
        const scale = _scaleFor('pillar', g, cfg.targetH);
        const halfW = (g.foot ? g.foot.w : g.w * 0.5) * scale / 2;
        const [xLo, xHi] = cfg.rangeX || [0.25, 0.60];
        const [, yHi] = cfg.rangeY || [0, 0.40];
        const pairs = _rollCount(cfg.pairs);
        const ok = (pt) => {
            if (!_insideDiamond(bounds, pt, halfW + 40)) return false;
            if (Math.hypot(pt.x - bounds.cx, pt.y - bounds.cy) < CENTER_EXCLUDE) return false;
            if (ctx.avoid.some(a => Math.hypot(pt.x - a.x, pt.y - a.y) < a.r)) return false;
            return true;
        };
        for (let i = 0; i < pairs; i++) {
            for (let t = 0; t < 20; t++) {
                const dx = (xLo + Math.random() * (xHi - xLo)) * bounds.rx * (Math.random() < 0.5 ? -1 : 1);
                const dy = (Math.random() * 2 - 1) * yHi * bounds.ry;
                const p1 = { x: bounds.cx + dx, y: bounds.cy + dy };
                const p2 = { x: bounds.cx - dx, y: bounds.cy - dy };
                if (!ok(p1) || !ok(p2)) continue;
                // 对称两点同时可放才成对落位（任一不过则重采）
                if (!_canPlaceCollision(ctx, p1, halfW, 'pillar', false) || !_canPlaceCollision(ctx, p2, halfW, 'pillar', false)) continue;
                _commitCollision(ctx, p1, g, scale, halfW, 'pillar');
                _commitCollision(ctx, p2, g, scale, halfW, 'pillar');
                break;
            }
        }
    },

    /**
     * 储物区：随机一个方向角落，2~3 中件（碰撞）+ 1~2 小件（装饰）贴近堆叠。
     * 堆叠件底边锚定 depth——y 大的件自然盖住 y 小的件，形成前后层次阻挡。
     */
    _spawnStorage(cfg, ctx) {
        const { bounds } = ctx;
        const inset = cfg.cornerInset ?? 220;
        const spread = cfg.spread ?? 110;
        // 菱形四角方向（对角线与边界的交点内收，与墓碑角落同款推导）
        const s = Math.max(0, (bounds.rx * bounds.ry) / (bounds.rx + bounds.ry) - inset);
        const corners = [
            { x: bounds.cx + s, y: bounds.cy + s },
            { x: bounds.cx + s, y: bounds.cy - s },
            { x: bounds.cx - s, y: bounds.cy + s },
            { x: bounds.cx - s, y: bounds.cy - s },
        ].filter(c => !ctx.avoid.some(a => Math.hypot(c.x - a.x, c.y - a.y) < a.r + spread));
        if (!corners.length) return;
        const anchor = corners[Math.floor(Math.random() * corners.length)];

        // 中件（foot 碰撞，贴近堆叠：组内不设走廊，仅防嵌墙与轻微重叠）
        const mediumCount = _rollCount(cfg.mediumCount);
        for (let i = 0; i < mediumCount; i++) {
            const geoKey = _pick(cfg.mediumKeys);
            const g = geoKey && ISO_WALL_GEO[geoKey];
            if (!g || !ctx.scene.textures.exists(g.tex)) continue;
            const scale = _scaleFor(geoKey, g, cfg.targetHMedium);
            const halfW = (g.foot ? g.foot.w : g.w * 0.5) * scale / 2;
            let placed = false;
            for (let t = 0; t < 12 && !placed; t++) {
                const a = Math.random() * Math.PI * 2;
                const r = Math.random() * spread;
                const pt = { x: anchor.x + Math.cos(a) * r, y: anchor.y + Math.sin(a) * r * 0.6 };
                // 组内轻微分离（允许贴近但不完全重叠）
                if (ctx.placedCollision.some(o => o.group === 'storage'
                    && Math.hypot(pt.x - o.x, pt.y - o.y) < (o.halfW + halfW) * 0.4)) continue;
                if (!_insideDiamond(bounds, pt, halfW + 30)) continue;
                if (!_placeCollision(ctx, pt, geoKey, g, scale, halfW, 'storage', true)) continue;
                placed = true;
            }
        }

        // 小件（纯装饰，贴着中件堆外缘；不嵌墙校验——无碰撞不等于可以刷进墙里）
        const smallCount = _rollCount(cfg.smallCount);
        let smallPlaced = 0, smallTries = 0;
        while (smallPlaced < smallCount && smallTries < 12) {
            smallTries++;
            const geoKey = _pick(cfg.smallKeys);
            const g = geoKey && ISO_WALL_GEO[geoKey];
            if (!g || !ctx.scene.textures.exists(g.tex)) { smallPlaced++; continue; }
            const a = Math.random() * Math.PI * 2;
            const r = spread * (0.7 + Math.random() * 0.6);
            const pt = { x: anchor.x + Math.cos(a) * r, y: anchor.y + Math.sin(a) * r * 0.6 };
            if (!_insideDiamond(bounds, pt, 40)) continue;
            if (!_decoSpotOk(pt)) continue;
            _placeDeco(ctx, pt, g, _scaleFor(geoKey, g, cfg.targetHSmall), 0);
            smallPlaced++;
        }
    },

    /** 墙饰：烛台（碰撞）/锁链（装饰）贴墙摆放（ring 默认 0.80~0.92） */
    _spawnWallDecor(cfg, ctx) {
        const count = _rollCount(cfg.count);
        const collisionKeys = cfg.collisionKeys || [];
        let placed = 0, tries = 0;
        while (placed < count && tries < 40) {
            tries++;
            const geoKey = _pick(cfg.keys);
            const g = geoKey && ISO_WALL_GEO[geoKey];
            if (!g || !ctx.scene.textures.exists(g.tex)) continue;
            const pt = _sampleInDiamond(ctx.bounds, cfg.ring);
            if (!_insideDiamond(ctx.bounds, pt, 40)) continue;
            if (ctx.avoid.some(a => Math.hypot(pt.x - a.x, pt.y - a.y) < a.r)) continue;
            const scale = _scaleFor(geoKey, g, cfg.targetH);
            if (collisionKeys.includes(geoKey)) {
                const halfW = (g.foot ? g.foot.w : g.w * 0.5) * scale / 2;
                if (!_placeCollision(ctx, pt, geoKey, g, scale, halfW, 'wallDecor', false)) continue;
            } else {
                if (!_decoSpotOk(pt)) continue;
                _placeDeco(ctx, pt, g, scale, 0);
            }
            placed++;
        }
    },

    /** 骨堆：2~3 对"骨头堆 + 头骨"，头骨随机旋转角度，纯装饰可踩过 */
    _spawnBoneYard(cfg, ctx) {
        const pairs = _rollCount(cfg.count);
        const pairGap = cfg.pairGap ?? 70;
        const maxRot = cfg.skullRotation ?? 0.5;
        const gBones = ISO_WALL_GEO.bones, gSkull = ISO_WALL_GEO.skull;
        if (!gBones || !gSkull) return;
        const { scene } = ctx;
        if (!scene.textures.exists(gBones.tex) || !scene.textures.exists(gSkull.tex)) return;
        let placed = 0, tries = 0;
        while (placed < pairs && tries < 40) {
            tries++;
            const pt = _sampleInDiamond(ctx.bounds, cfg.ring);
            if (!_insideDiamond(ctx.bounds, pt, 40)) continue;
            if (Math.hypot(pt.x - ctx.bounds.cx, pt.y - ctx.bounds.cy) < CENTER_EXCLUDE) continue;
            if (ctx.avoid.some(a => Math.hypot(pt.x - a.x, pt.y - a.y) < a.r)) continue;
            if (!_decoSpotOk(pt)) continue;
            // 骨头堆
            _placeDeco(ctx, pt, gBones, _scaleFor('bones', gBones, cfg.targetH), 0);
            // 头骨：配对在骨头堆旁，随机旋转角度（"散落"感）；落点嵌墙则贴回骨头堆
            const a = Math.random() * Math.PI * 2;
            const d = pairGap * (0.6 + Math.random() * 0.6);
            let skullPt = { x: pt.x + Math.cos(a) * d, y: pt.y + Math.sin(a) * d * 0.6 };
            if (!_decoSpotOk(skullPt)) skullPt = pt;
            _placeDeco(ctx, skullPt, gSkull, _scaleFor('skull', gSkull, cfg.targetH), (Math.random() * 2 - 1) * maxRot);
            placed++;
        }
    },
};

// ==================== 内部辅助 ====================

/** 碰撞障碍件放置校验（跨组走廊 + 嵌墙；skipIntra=true 时跳过同组走廊——储物区组内贴近堆叠） */
function _canPlaceCollision(ctx, pt, halfW, group, skipIntra) {
    if (group !== undefined && ctx.placedCollision.some(o => (o.group !== group || !skipIntra)
        && Math.hypot(pt.x - o.x, pt.y - o.y) < o.halfW + halfW + CORRIDOR)) return false;
    if (WallSystem.canMoveTo && !WallSystem.canMoveTo(pt.x, pt.y, halfW)) return false;
    return true;
}

/** 确认落位：生成 isoVisuals 件（footprint 碰撞随 rebuildIsoCollision 自动推导） */
function _commitCollision(ctx, pt, g, scale, halfW, group) {
    const piece = {
        tex: g.tex,
        x: pt.x, y: pt.y,
        scaleX: scale, scaleY: scale,
        flipX: Math.random() < 0.5, flipY: false,
        // 障碍物锚规则：depth 贴贴图底边（与摆墙编辑器 _applyToSprite 同口径）
        depth: pt.y + (g.h * scale) / 2,
    };
    WallSystem.isoVisuals.push(piece);
    ctx.placedCollision.push({ x: pt.x, y: pt.y, halfW, piece, group });
    ctx.total++;
    return true;
}

/** 校验 + 落位一体（单件放置场景） */
function _placeCollision(ctx, pt, geoKey, g, scale, halfW, group, skipIntra) {
    if (!_canPlaceCollision(ctx, pt, halfW, group, skipIntra)) return false;
    return _commitCollision(ctx, pt, g, scale, halfW, group);
}

/** 装饰件落点校验：不嵌墙（半径 25 探测）——装饰件无碰撞，但刷进墙里就是"不可达地区生成" */
function _decoSpotOk(pt) {
    return !(WallSystem.canMoveTo && !WallSystem.canMoveTo(pt.x, pt.y, 25));
}

/**
 * 菱形房内包含校验（内缩 inset）：canMoveTo 在房间外黑域也返回 true
 * （墙外没有碰撞体），不做包含校验装饰件会刷到房间外（线上教训）
 */
function _insideDiamond(bounds, pt, inset = 30) {
    return Math.abs(pt.x - bounds.cx) / Math.max(1, bounds.rx - inset)
         + Math.abs(pt.y - bounds.cy) / Math.max(1, bounds.ry - inset) <= 1;
}

/** 放纯装饰件（可踩过；origin 底边贴地，depth = y+2，y 大者自然在前形成阻挡层次） */
function _placeDeco(ctx, pt, g, scale, rotation) {
    const img = ctx.scene.add.image(pt.x, pt.y, g.tex);
    img.setOrigin(0.5, 1);
    img.setScale(scale);
    img.setFlipX(Math.random() < 0.5);
    if (rotation) img.setRotation(rotation);
    img.setDepth(pt.y + 2);
    if (ctx.deco) ctx.deco.push(img);
    ctx.total++;
    return img;
}

/** 玩家到任一目标点不可达的目标列表（pathFinder 不可用时放行） */
function _unreachableTargets(player, targets) {
    if (!pathFinder || typeof pathFinder.findPath !== 'function') return [];
    return targets.filter(t => {
        const path = pathFinder.findPath(player.x, player.y, t.x, t.y, 15);
        return !path || path.length === 0;
    });
}

function _pick(keys) {
    if (!Array.isArray(keys) || !keys.length) return null;
    return keys[Math.floor(Math.random() * keys.length)];
}

/** 数量区间 [min, max] 随机（缺省按 1 个） */
function _rollCount(count) {
    if (!Array.isArray(count)) return count || 1;
    const [lo, hi] = count;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/**
 * 缩放：一律使用摆墙编辑器里预设的大小（obstacle-defaults.json，碰撞编辑器手调），
 * 不做任何自动缩放/抖动；仅当该类型没有编辑器预设时按 targetH 兜底推导
 */
function _scaleFor(geoKey, g, targetH) {
    const def = getObstacleDefaults()[geoKey];
    if (def && (def.scaleY ?? def.scaleX) != null) return def.scaleY ?? def.scaleX;
    return (targetH || 120) / g.h;
}

/** 菱形内极坐标采样：角度随机 × 半径 ring 区间（保证在菱形内） */
function _sampleInDiamond(bounds, ring) {
    const [rLo, rHi] = ring || [0.2, 0.9];
    const a = Math.random() * Math.PI * 2;
    const r = rLo + Math.random() * (rHi - rLo);
    return {
        x: bounds.cx + Math.cos(a) * bounds.rx * r,
        y: bounds.cy + Math.sin(a) * bounds.ry * r,
    };
}
