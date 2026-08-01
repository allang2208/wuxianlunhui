/**
 * 战斗房墙面火把生成系统（2026-08-01 规则重写：预制件锚定贴墙）
 *
 * 旧障碍物规则（石柱/储物区/墙饰/骨堆）已全部删除，重新构思中；
 * 当前只保留墙面火把一组（data/dungeon-config.json combatRoom.obstacles.wallTorches，
 * 支持地牢级覆盖/关闭）：
 * - 贴墙规则：直接套摆墙编辑器预制件「火把墙」（data/wall-prefabs.json）的相对关系——
 *   运行时从预制件提取每个火把相对墙件底边线的锚定数据 (t, d, depthDelta)，
 *   再锚到房间真实墙件的底边线上放置（用户改预制件自动生效；缺失/异常回退硬编码常量）；
 * - scale 走 obstacle-defaults.json 编辑器预设、无 rotation/flip、depthManual 贴墙深度；
 * - 火把全局无碰撞体积（ISO_WALL_GEO.torch 已无 foot，rebuildIsoCollision 不推导碰撞），
 *   这里只放渲染 piece（WallSystem.isoVisuals），清理随战斗房恢复/重建自动消失。
 *
 * 约束：只贴直墙段（转角/门件跳过），放置点避开门/通道门 approach、玩家出生点，
 * 且垂距不得把火把推出房间菱形外。
 */
import { WallSystem, ISO_WALL_GEO } from './wall-system.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import { getObstacleDefaults, getWallPrefabLibrary } from './wall-prefabs.js';

// 默认配置（JSON 未配置时兜底；正常走 combatRoom.obstacles.wallTorches）
const DEFAULT_OBSTACLES = {
    wallTorches: { count: [1, 2], ring: [0.80, 0.92], targetH: 160 },
};

const AVOID_GATE = 220;       // 门/通道门 approach 排除半径（avoidPoints 未带 r 时的默认）
const TORCH_MIN_GAP = 80;     // 同一房间两个火把间的最小间距（防抽中同墙同锚点重叠）

// 预制件「火把墙」锚定数据兜底常量（2026-08-01 从 data/wall-prefabs.json 实测计算：
// 墙件 wall_straight 底边线（face 变换到世界）为基准，t=投影参数、d=垂直距离、
// depthDelta=火把 depth − 墙 depth；运行时优先从预制件实时提取，缺失/结构异常才用这里）
const TORCH_PREFAB_KEY = '火把墙';
const TORCH_ANCHOR_FALLBACK = [
    { t: 0.11478, d: 68.96, depthDelta: 19.82 }, // 火把1：(2420.44, 1095.51) depth 1380.82
    { t: 0.56414, d: 69.80, depthDelta: 28.74 }, // 火把2：(2606.19, 1201.77) depth 1389.73
];
const TORCH_PREFAB_WALL_SCALE_Y = 0.31450893; // 预制件墙件 scaleY（垂距折算基准）

export const ObstacleSpawnSystem = {
    /**
     * 在单个战斗房间内生成墙面火把（贴墙、无碰撞）
     * @param {Object} bounds 房间 bounds（菱形：{cx, cy, rx, ry, diamond:true}）
     * @param {Object} [opts]
     * @param {string} [opts.dungeonType] 地牢类型（读地牢级 combatRoom.obstacles 覆盖）
     * @param {Array}  [opts.avoidPoints] 排除点 [{x, y, r?}]（门中心/玩家出生点）
     * @returns {number} 实际放置总数
     */
    spawnForRoom(bounds, opts = {}) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (!scene || !bounds || !bounds.diamond) return 0;
        const crCfg = DungeonConfig.getCombatRoomConfig(opts.dungeonType);
        const cfg = crCfg.obstacles === false ? null : (crCfg.obstacles || DEFAULT_OBSTACLES);
        if (!cfg || !cfg.wallTorches) return 0;

        const ctx = {
            scene, bounds,
            avoid: (opts.avoidPoints || []).map(p => ({ x: p.x, y: p.y, r: p.r ?? AVOID_GATE })),
            total: 0,
        };

        this._spawnWallTorches(cfg.wallTorches, ctx);
        return ctx.total;
    },

    /**
     * 墙面火把：按预制件「火把墙」的锚定关系贴到房间真实墙件上（带持续火焰粒子，
     * 提灯矿工落地焰同款参数）。每个火把随机抽一个候选直墙 + 随机抽预制件里的一个
     * 锚定条目 (t, d, depthDelta)：位置 = 墙底边线 t 点 + 朝房间中心一侧垂线 × d
     * （垂距按墙件 scaleY 与预制件墙 scaleY 的比值折算），depth = 墙 depth + depthDelta。
     * 无碰撞体积，只放渲染 piece（isoVisuals），depthManual 贴墙深度
     * （直墙 depth=底边 max y，火把底边锚点必低于墙面底边 → 不抬 depth 永远被墙盖住）。
     * 找不到候选墙 = 该房间不放火把（不报错）。
     */
    _spawnWallTorches(cfg, ctx) {
        const g = ISO_WALL_GEO.torch;
        if (!g || !ctx.scene.textures.exists(g.tex)) return;
        // 预制件锚定数据（运行时提取；缺失/异常回退兜底常量）
        const extracted = _extractTorchAnchors();
        const anchors = extracted ? extracted.anchors : TORCH_ANCHOR_FALLBACK;
        const prefabWallScaleY = extracted ? extracted.wallScaleY : TORCH_PREFAB_WALL_SCALE_Y;
        // 候选墙：非 obstacle、非门/gate、单段直墙、锚点在菱形内、不撞排除点
        const candidates = _candidateWalls(ctx);
        if (!candidates.length) return;

        const count = _rollCount(cfg.count);
        const scale = _scaleFor('torch', g, cfg.targetH);
        const placedPts = [];
        let placed = 0, tries = 0;
        while (placed < count && tries < 80) {
            tries++;
            const cand = candidates[Math.floor(Math.random() * candidates.length)];
            const anchor = anchors[Math.floor(Math.random() * anchors.length)];
            const q = cand.piece;
            const [A, B] = cand.seg;
            const dx = B.x - A.x, dy = B.y - A.y;
            const len = Math.hypot(dx, dy) || 1;
            // 墙底边线 t 点 + 朝房间中心一侧的单位垂线 × d（两个法向里取指向房心的那个）
            const mx = A.x + dx * anchor.t, my = A.y + dy * anchor.t;
            let nx = -dy / len, ny = dx / len;
            if ((ctx.bounds.cx - mx) * nx + (ctx.bounds.cy - my) * ny < 0) { nx = -nx; ny = -ny; }
            const d = anchor.d * ((q.scaleY ?? q.scaleX ?? 1) / prefabWallScaleY);
            const pt = { x: mx + nx * d, y: my + ny * d };
            // 校验：垂距不得推出房外/压到门，火把间最小间距（同墙抽中多次允许）
            if (!_insideDiamond(ctx.bounds, pt, 40)) continue;
            if (ctx.avoid.some(a => Math.hypot(pt.x - a.x, pt.y - a.y) < a.r)) continue;
            if (placedPts.some(p => Math.hypot(pt.x - p.x, pt.y - p.y) < TORCH_MIN_GAP)) continue;
            // 渲染 piece（预制件「火把墙」同款参数：无 rotation/flip、depthManual 贴墙深度）
            const torchDepth = (q.depth ?? q.y) + anchor.depthDelta;
            WallSystem.isoVisuals.push({
                tex: g.tex,
                x: pt.x, y: pt.y,
                scaleX: scale, scaleY: scale,
                flipX: false, flipY: false,
                depth: torchDepth,
                depthManual: true, // 手调深度：_placeIsoPiece 渲染尊重 p.depth
            });
            ctx.total++;
            // 持续火焰（提灯矿工落地焰同款：impact_dot + 白/橙/黄三色 ADD 上飘）
            // 不登记进清理列表——按用户要求火焰不随战斗房清理销毁
            const scene = ctx.scene;
            if (!scene.textures.exists('impact_dot') && typeof scene._ensureImpactDotTexture === 'function') {
                scene._ensureImpactDotTexture();
            }
            if (scene.textures.exists('impact_dot')) {
                const em = scene.add.particles(pt.x, pt.y - (g.h * scale) * 0.88, 'impact_dot', {
                    frequency: 60,
                    speedY: { min: -50, max: -110 },
                    speedX: { min: -10, max: 10 },
                    scale: { start: 2.4, end: 0.3 },
                    alpha: { start: 0.9, end: 0 },
                    lifespan: 600,
                    tint: [0xffffff, 0xffcc55, 0xff8833],
                    blendMode: 'ADD',
                });
                em.setDepth(torchDepth + 1);
                em.addToUpdateList();
            }
            placedPts.push(pt);
            placed++;
        }
    },
};

// ==================== 内部辅助 ====================

/**
 * 从预制库提取「火把墙」锚定数据：
 * 墙件（family 非 obstacle 的那件）底边线 A→B（_pieceBaseSegments 世界坐标）为几何基准，
 * 每个火把件记 (t, d, depthDelta)——t=投影到线段的参数（0~1）、d=到线段的垂直距离、
 * depthDelta=火把 depth − 墙 depth。用户改预制件后自动生效。
 * 预制件缺失/结构异常（无墙件、无火把件、墙件非单段直墙）返回 null，调用方回退兜底常量。
 */
function _extractTorchAnchors() {
    const prefab = getWallPrefabLibrary()[TORCH_PREFAB_KEY];
    if (!prefab || !Array.isArray(prefab.pieces)) return null;
    const isObstacle = (p) => {
        const g = WallSystem._geoForTex(p.tex);
        return !g || g.category === 'obstacle';
    };
    const wallPiece = prefab.pieces.find(p => !isObstacle(p));
    const torches = prefab.pieces.filter(p => isObstacle(p));
    if (!wallPiece || !torches.length) return null;
    const segs = WallSystem._pieceBaseSegments(wallPiece);
    if (segs.length !== 1) return null; // 基准墙必须是单段直墙
    const [A, B] = segs[0];
    const dx = B.x - A.x, dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) return null;
    const wallDepth = wallPiece.depth ?? wallPiece.y;
    const anchors = torches.map(tp => ({
        t: ((tp.x - A.x) * dx + (tp.y - A.y) * dy) / len2,
        d: Math.abs((tp.x - A.x) * dy - (tp.y - A.y) * dx) / Math.sqrt(len2),
        depthDelta: (tp.depth ?? tp.y) - wallDepth,
    }));
    return { anchors, wallScaleY: wallPiece.scaleY ?? wallPiece.scaleX ?? 1 };
}

/**
 * 候选墙：isoVisuals 中非 obstacle、非门/gate（states/gateX/openDoor 标记）、
 * 底边为单段直墙（_pieceBaseSegments 对障碍物返回空、对 openDoor 门返回两段墙身、
 * 对转角返回两臂两段——都只贴返回"单段"的直墙件）、锚点在房间菱形内、不撞排除点
 */
function _candidateWalls(ctx) {
    const out = [];
    for (const q of WallSystem.isoVisuals) {
        const gq = WallSystem._geoForTex(q.tex);
        if (!gq || gq.category === 'obstacle') continue;
        if (gq.states || gq.gateX || gq.openDoor) continue; // 门/gate 不贴
        const segs = WallSystem._pieceBaseSegments(q);
        if (segs.length !== 1) continue; // 只贴单段直墙
        if (!_insideDiamond(ctx.bounds, q, 40)) continue;
        if (ctx.avoid.some(a => Math.hypot(q.x - a.x, q.y - a.y) < a.r)) continue;
        out.push({ piece: q, seg: segs[0] });
    }
    return out;
}

/**
 * 菱形房内包含校验（内缩 inset）：canMoveTo 在房间外黑域也返回 true
 * （墙外没有碰撞体），不做包含校验火把会刷到房间外（线上教训）
 */
function _insideDiamond(bounds, pt, inset = 30) {
    return Math.abs(pt.x - bounds.cx) / Math.max(1, bounds.rx - inset)
         + Math.abs(pt.y - bounds.cy) / Math.max(1, bounds.ry - inset) <= 1;
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
