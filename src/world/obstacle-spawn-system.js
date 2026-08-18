/**
 * 僵尸地牢障碍物生成系统（2026-08-01 规则 v3：石柱/预制组合/通道火把；房间墙面火把整组删除）
 *
 * 仅僵尸地牢大类（zombie/zombieBeginner/zombieMid）生成障碍物；沼泽等非僵尸门类
 * spawnForRoom/spawnForPassages 直接返回 0。
 * 配置：data/dungeon-config.json combatRoom.obstacles（支持地牢级覆盖/关闭）。
 *
 * 三组规则：
 * 1) 中央石柱（_spawnCenterPillar）：仅竞技场房间 1/2 的可移动菱形地面正中一根
 *    （房间 3 是宝箱房；Boss/入侵情况1/3 单房间不传 roomIndex，不走这条），
 *    scale 走 obstacle-defaults.json 编辑器预设。
 * 2) 后墙预制组合（_spawnPrefabCompositions）：只贴左上（LT）/右上（RT）后墙附近，
 *    左下/右下前墙一侧不放；每次从预制库「火把墙」之后的组合随机抽一组整体平移
 *    （相对布局/scale/rotation/flip 保留）。depth 逐件重算 = max(obstacleDepthOf,
 *    400px 内最近墙件 depth + 0.1) 并打 depthManual——静态件不走实体
 *    junctionCorrectedDepth 仲裁，不抬深度会被 flat depth 更深的后墙后画盖住
 *    （贴后墙的小件本来就该画在墙前/房内一侧，抬到墙上是正确语义）。
 *    数量按房间配置 countByRoom（房间 1/2 各 3 组、房间 3 八组，
 *    无 roomIndex 的单房间路径按房间 1 取值）；烛台不再单独生成
 *    （「烛台+铁链」等含烛台的预制组合仍在池内可抽中）。
 *    同房间不重复抽同一预制 key；组合间有最小间隔（视作整体：净间隔 > 0.5×较大组半径，放不满就放实际数量）。
 * 3) 通道火把（_spawnPassageTorches）：竞技场每条通道右手侧墙按固定间隔均布，
 *    贴墙锚定复用预制件「火把墙」（data/wall-prefabs.json）的 (t, d, depthDelta)
 *    机制——运行时从预制件提取每个火把相对墙件底边线的锚定数据（用户改预制件自动
 *    生效；缺失/异常回退硬编码常量）；无碰撞、持续火焰粒子（提灯矿工落地焰同款）。
 *
 * 障碍物碰撞：piece 进 WallSystem.isoVisuals 后由调用方 rebuildIsoCollision()
 * 按 foot 自动推导；清理随战斗房恢复/重建自动消失。
 * 地面阴影：每个有 foot 碰撞的障碍物件（预制组合各件 + 中央石柱）放椭圆阴影
 * （entity_shadow，footprint 与 _addPieceCollision 同口径，alpha 0.525），
 * 登记进 CombatRoomSystem._decoSprites 随 cleanupRoom → cleanupGate 销毁
 * （通道火把无碰撞不放阴影；火把火焰 emitter 与阴影同口径登记 _decoSprites——
 * 战斗内常驻、战斗结束才销毁，不再"永不销毁"逐场累积泄漏）。
 */
import { WallSystem, ISO_WALL_GEO } from './wall-system.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { getObstacleDefaults, getWallPrefabLibrary } from './wall-prefabs.js';

// 默认配置（JSON 未配置时兜底；正常走 combatRoom.obstacles.*）
const DEFAULT_OBSTACLES = {
    prefabCompositions: { countByRoom: { 1: 3, 2: 3, 3: 8 }, wallDist: [50, 130], targetH: 180 },
    centerPillar: { targetH: 180 },
    passageTorches: { interval: 350 },
};

// 僵尸地牢大类（障碍物生成仅限此类）：dungeon-map-system._isZombieFamily 含 swamp，
// 但障碍物规则明确不含沼泽——非僵尸门类 spawnForRoom/spawnForPassages 直接返回 0
const ZOMBIE_OBSTACLE_FAMILY = ['zombie', 'zombieBeginner', 'zombieMid'];

const AVOID_GATE = 220;       // 门/通道门 approach 排除半径（avoidPoints 未带 r 时的默认）

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
     * 在单个战斗房间内生成障碍物（中央石柱 + 后墙预制组合；墙面火把已整组删除，只保留通道火把）
     * @param {Object} bounds 房间 bounds（菱形：{cx, cy, rx, ry, diamond:true}）
     * @param {Object} [opts]
     * @param {string} [opts.dungeonType] 地牢类型（僵尸门类判定 + 读地牢级 combatRoom.obstacles 覆盖）
     * @param {number} [opts.roomIndex] 竞技场房间号（1/2/3；仅 1/2 生成中央石柱，单房间路径不传）
     * @param {Array}  [opts.avoidPoints] 排除点 [{x, y, r?}]（门中心/玩家出生点）
     * @returns {number} 实际放置总数
     */
    spawnForRoom(bounds, opts = {}) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (!scene || !bounds || !bounds.diamond) return 0;
        // 仅僵尸地牢大类生成障碍物（沼泽等非僵尸门类整组关闭）
        if (!ZOMBIE_OBSTACLE_FAMILY.includes(opts.dungeonType)) return 0;
        const crCfg = DungeonConfig.getCombatRoomConfig(opts.dungeonType);
        const cfg = crCfg.obstacles === false ? null : (crCfg.obstacles || DEFAULT_OBSTACLES);
        if (!cfg) return 0;

        const ctx = {
            scene, bounds,
            roomIndex: opts.roomIndex || 0, // 预制组合数量按房间取 countByRoom（0 = 单房间路径，按房间 1）
            avoid: (opts.avoidPoints || []).map(p => ({ x: p.x, y: p.y, r: p.r ?? AVOID_GATE })),
            usedPrefabs: new Set(), // 本房已抽中的预制组合 key（同房间不重复；ctx 逐房新建 = 逐房重置）
            placedComps: [],        // 本房已放组合 {x, y, r}（组合间最小间隔校验，r = 整体包围半径）
            total: 0,
        };

        // 中央石柱：仅竞技场房间 1/2（房间 3 是宝箱房；Boss/入侵情况1/3 单房间不传 roomIndex）
        if ((opts.roomIndex === 1 || opts.roomIndex === 2) && cfg.centerPillar !== false) {
            this._spawnCenterPillar(cfg.centerPillar || {}, ctx);
        }
        if (cfg.prefabCompositions) this._spawnPrefabCompositions(cfg.prefabCompositions, ctx);
        return ctx.total;
    },

    /**
     * 房间中央石柱：可移动菱形地面正中一根（仅竞技场房间 1/2 调用）。
     * scale 走 obstacle-defaults.json 编辑器预设（与摆墙编辑器拖出的一致，targetH 仅兜底）；
     * depth 锚地面线（obstacleDepthOf，场地中间不存在被墙盖的问题，不做贴墙抬升），
     * foot 碰撞由 rebuildIsoCollision 自动推导；带椭圆地面阴影（_placeObstacle）。
     */
    _spawnCenterPillar(cfg, ctx) {
        const g = ISO_WALL_GEO.pillar;
        if (!g || !ctx.scene.textures.exists(g.tex)) return;
        const scale = _scaleFor('pillar', g, cfg.targetH || 180);
        // 锚点 = 贴图中心（_placeIsoPiece origin 0.5）：y 要向上抬半高，
        // 让石柱**底座**立在菱形中心（贴图中心放中心 = 底座沉到中心下方 ~161px，视觉偏南）
        const piece = {
            tex: g.tex,
            x: ctx.bounds.cx, y: ctx.bounds.cy - (g.h * scale) / 2,
            scaleX: scale, scaleY: scale,
            rotation: 0, flipX: false, flipY: false,
        };
        piece.depth = WallSystem.obstacleDepthOf(piece);
        this._placeObstacle(ctx, piece);
    },

    /**
     * 后墙预制组合障碍物（只贴左上 LT / 右上 RT 后墙附近，左下/右下前墙一侧不放）：
     * 每个槽位从预制库「火把墙」之后的组合里随机抽一组，以预制 cx/cy 为基准整体平移
     * （组合内相对布局、各件 scale/rotation/flip 保留；prefab 里的旧 depth 是主神空间
     * 坐标不可用，逐件重算 = max(obstacleDepthOf, 400px 内最近墙件 depth + 0.1)，
     * depthManual 一律打上——静态件不走实体 junctionCorrectedDepth 仲裁，不抬深度
     * 会被 flat depth 更深的后墙后画盖住）。
     * 同房间不重复：本房已抽过的预制 key 不再抽（ctx.usedPrefabs 逐房重置；
     * 池子剩余不足时放实际数量，不报错）。
     * 组合间最小间隔（组合视作整体）：整体包围半径 r = 各件（锚距 + 旋转 AABB 半对角）
     * 的最大值；新组合与每个已放组合要求 锚距 − (r新 + r已) > 0.5×max(r新, r已)
     * （边缘到边缘的净间隔必须大于较大一组半径的一半——V0.369 用户定案系数 0.5，
     * 兼顾间隔感与房间 3 放满率；尝试用尽放不满就放实际数量，不报错）。
     * 烛台不单独生成（2026-08-01 v3：candleChance 分支已删；「烛台+铁链」等含烛台的
     * 预制组合仍在池内可抽中）。
     * 数量按房间配置 countByRoom（房间 1/2 各 3 组、房间 3 八组——房间 3 中央是宝箱房，
     * 8 组只贴后墙；尝试上限内放不满就放实际数量，不报错）；无 roomIndex 的单房间
     * 路径按房间 1 取值。
     * 选点：随机选一条后墙边 → 沿线随机点（两端各留 15%）→ 朝房心法线方向取
     * wallDist 距离为组合锚点。
     * 整组校验：组合间隔 → 逐件中心在菱形可移动范围内（内缩 40+触地半径——不压墙线/
     * 不出界，wallDist 上限保证不靠场地中间）、不撞 avoidPoints（门/通道口/玩家出生点）；
     * 任一项失败整组重抽。
     */
    _spawnPrefabCompositions(cfg, ctx) {
        const pool = _prefabCompositionPool();
        if (!pool.length) return;
        const lib = getWallPrefabLibrary();
        // 数量按房间：countByRoom["1"/"2"/"3"]；单房间路径（roomIndex 0）按房间 1
        const byRoom = cfg.countByRoom || null;
        const count = byRoom
            ? (byRoom[String(ctx.roomIndex || 1)] ?? byRoom['1'] ?? 3)
            : 3;
        const dist = Array.isArray(cfg.wallDist) ? cfg.wallDist : [50, 130];

        let placed = 0, tries = 0;
        while (placed < count && tries < 60) {
            tries++;
            // 同房间不重复：只从本房没抽过的 key 里抽；池子抽干放实际数量（不报错）
            const avail = pool.filter(k => !ctx.usedPrefabs.has(k));
            if (!avail.length) break;
            const key = avail[Math.floor(Math.random() * avail.length)];
            // 组合件清单：相对锚点的偏移 + 各件变换（预制组合原样保留）
            const pf = lib[key];
            // 基准点 cx/cy（结构约定见 wall-prefabs.js；缺失时回退各件中心，双保险）
            let bx = pf.cx, by = pf.cy;
            if (bx == null || by == null) {
                bx = pf.pieces.reduce((sum, q) => sum + q.x, 0) / pf.pieces.length;
                by = pf.pieces.reduce((sum, q) => sum + q.y, 0) / pf.pieces.length;
            }
            const items = pf.pieces.map(q => ({
                tex: q.tex, dx: q.x - bx, dy: q.y - by,
                scaleX: q.scaleX ?? 1, scaleY: q.scaleY ?? q.scaleX ?? 1,
                rotation: q.rotation || 0, flipX: !!q.flipX, flipY: !!q.flipY,
                // 编辑器保存的组内图层深度（相对顺序以此为准，不再逐件按世界 Y 重算）
                savedDepth: q.depth ?? q.y,
            }));
            // 整体包围半径：以预制 cx/cy 为锚，各件 锚距 + 自身旋转 AABB 半对角 的最大值
            let compR = 0;
            for (const it of items) {
                compR = Math.max(compR, Math.hypot(it.dx, it.dy)
                    + _pieceHalfDiag(it.tex, it.scaleX, it.scaleY, it.rotation));
            }
            const anchor = _rollBackWallAnchor(ctx.bounds, dist);
            // 组合间最小间隔：与每个已放组合 净间隔 = 锚距 − (r新 + r已) 必须 > 0.5×max(r新, r已)
            // （用户定案 V0.369：系数 0.5——保证间隔感同时让房间 3 能稳定放满；放不满就放实际数量）
            if (ctx.placedComps.some(pc =>
                Math.hypot(anchor.x - pc.x, anchor.y - pc.y) - (compR + pc.r) <= 0.5 * Math.max(compR, pc.r))) continue;
            // 整组校验（逐件：菱形可移动范围内 + 不压排除点），失败整组重抽
            const staged = [];
            let ok = true;
            for (const it of items) {
                const pt = { x: anchor.x + it.dx, y: anchor.y + it.dy };
                const rad = _groundRadius(it.tex, it.scaleX, it.scaleY);
                if (!_insideDiamond(ctx.bounds, pt, 40 + rad)) { ok = false; break; }
                if (ctx.avoid.some(a => Math.hypot(pt.x - a.x, pt.y - a.y) < a.r + rad)) { ok = false; break; }
                staged.push({ it, pt });
            }
            if (!ok) continue;
            // 组内图层顺序：以「保存深度最小（最靠后）」的一件为基准，抬到附近墙件之上，
            // 其余各件按保存深度差值递增——完整保留编辑器里手调的遮挡关系
            // （旧实现逐件 _liftDepthAboveWalls(piece, obstacleDepthOf(piece)) 按世界 Y
            // 独立重算，桶*3+瓶等 8/10 组合的保存图层被丢弃/错层）
            const minItem = items.reduce((m, it) => (it.savedDepth < m.savedDepth ? it : m), items[0]);
            const basePiece = {
                tex: minItem.tex, x: anchor.x + minItem.dx, y: anchor.y + minItem.dy,
                scaleX: minItem.scaleX, scaleY: minItem.scaleY,
                rotation: minItem.rotation, flipX: minItem.flipX, flipY: minItem.flipY,
            };
            const baseDepth = _liftDepthAboveWalls(basePiece, WallSystem.obstacleDepthOf(basePiece));
            for (const { it, pt } of staged) {
                const piece = {
                    tex: it.tex, x: pt.x, y: pt.y,
                    scaleX: it.scaleX, scaleY: it.scaleY,
                    rotation: it.rotation, flipX: it.flipX, flipY: it.flipY,
                    // 组合来源标记（CDP/调试 dump 用；渲染/碰撞忽略下划线扩展字段）
                    _prefabKey: key, _compAnchor: { x: anchor.x, y: anchor.y }, _compR: compR,
                };
                // 组内相对深度 = 基准深度 + 保存差值（保存顺序完整保留；整体已抬到墙件之上）
                piece.depth = baseDepth + (it.savedDepth - minItem.savedDepth);
                piece.depthManual = true; // 手调深度：_placeIsoPiece 渲染尊重 p.depth
                this._placeObstacle(ctx, piece);
            }
            ctx.usedPrefabs.add(key);
            ctx.placedComps.push({ x: anchor.x, y: anchor.y, r: compR });
            placed++;
        }
    },

    /**
     * 障碍物件统一放置：推 isoVisuals（碰撞由调用方 rebuildIsoCollision 推导）+ 椭圆地面阴影
     */
    _placeObstacle(ctx, piece) {
        WallSystem.isoVisuals.push(piece);
        ctx.total++;
        this._addObstacleShadow(ctx, piece);
    },

    /**
     * 障碍物椭圆地面阴影（匹配碰撞体积）：
     * - 贴图 entity_shadow（GameScene._syncEntityShadows 同款；缺失时尝试
     *   scene._ensureShadowTexture() 现生成，仍缺则跳过不报错）；
     * - 位置/尺寸与 WallSystem._addPieceCollision 的 footprint 推导同口径：
     *   中心 cx = p.x + foot.offsetX×sx、cy = bottomY − foot.d×sy/2
     *   （bottomY = p.y + geo.h×sy/2 + foot.offsetY×sy）；旋转件按 |cos|/|sin|
     *   展开 AABB 取阴影尺寸，阴影本身不旋转（椭圆近似）；
     * - displaySize(fw, fd × PERSPECTIVE_SCALE_Y)（与 GameScene 实体阴影同口径），
     *   alpha 0.35（与实体阴影一致），depth = 件 depth − 0.05（障碍物之下、地板之上）；
     * - 生命周期：登记进 CombatRoomSystem._decoSprites——cleanupRoom → cleanupGate
     *   统一销毁（window.CombatRoomSystem 晚绑定，避免与 combat-room-system 循环导入；
     *   拿不到 CRS 时阴影会多活一会儿，场景切换仍会随场景销毁，可接受）。
     */
    _addObstacleShadow(ctx, piece) {
        const scene = ctx.scene;
        const g = WallSystem._geoForTex(piece.tex);
        if (!g || g.category !== 'obstacle' || !g.foot) return; // 无碰撞体积（如火把）不放阴影
        if (!scene.textures.exists('entity_shadow') && typeof scene._ensureShadowTexture === 'function') {
            scene._ensureShadowTexture();
        }
        if (!scene.textures.exists('entity_shadow')) return; // 贴图缺失跳过，不报错
        const sx = Math.abs(piece.scaleX ?? 1), sy = Math.abs(piece.scaleY ?? piece.scaleX ?? 1);
        const fw = g.foot.w * sx, fd = g.foot.d * sy;
        if (!(fw > 0) || !(fd > 0)) return;
        const offX = (g.foot.offsetX || 0) * sx, offY = (g.foot.offsetY || 0) * sy;
        const bottomY = piece.y + (g.h * sy) / 2 + offY;
        // 旋转：footprint 随 p.rotation 旋转，阴影尺寸取旋转后 AABB（同 _addPieceCollision）
        const rot = piece.rotation || 0;
        let hw = fw / 2, hd = fd / 2;
        if (rot) {
            const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
            const nw = hw * c + hd * s;
            hd = hw * s + hd * c;
            hw = nw;
        }
        const sp = scene.add.sprite(piece.x + offX, bottomY - fd / 2, 'entity_shadow');
        sp.setOrigin(0.5, 0.5);
        sp.setDisplaySize(hw * 2, hd * 2 * PERSPECTIVE_SCALE_Y);
        sp.setAlpha(0.525); // 全局阴影加深 50%（0.35 × 1.5）
        sp.setDepth((piece.depth ?? WallSystem.obstacleDepthOf(piece)) - 0.05);
        sp.addToUpdateList();
        const CRS = (typeof window !== 'undefined') ? window.CombatRoomSystem : null;
        if (CRS) (CRS._decoSprites = CRS._decoSprites || []).push(sp);
    },

    /**
     * 竞技场通道火把（仅僵尸地牢大类；enterCombatArena 建完通道后调用）：
     * 每条通道的右手侧墙（沿房间 N→N+1 前进方向的右手侧）按固定间隔均布火把，
     * 贴墙锚定复用预制件「火把墙」的 (t, d, depthDelta) 机制（t 按间隔均匀分布），
     * 无碰撞、持续火焰粒子（提灯矿工落地焰同款）。
     * @param {Array} passages 通道记录 [{mid1, mid2, center, gates}]（combat-room-system passageRecs）
     * @param {Object} [opts]
     * @param {string} [opts.dungeonType] 地牢类型（僵尸门类判定 + 读地牢级覆盖）
     * @returns {number} 实际放置总数
     */
    spawnForPassages(passages, opts = {}) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (!scene || !Array.isArray(passages) || !passages.length) return 0;
        if (!ZOMBIE_OBSTACLE_FAMILY.includes(opts.dungeonType)) return 0;
        const crCfg = DungeonConfig.getCombatRoomConfig(opts.dungeonType);
        const cfg = crCfg.obstacles === false ? null : (crCfg.obstacles || DEFAULT_OBSTACLES);
        if (!cfg || !cfg.passageTorches) return 0;
        const ctx = { scene, total: 0 };
        for (const p of passages) this._spawnPassageTorches(p, cfg.passageTorches, ctx);
        return ctx.total;
    },

    /**
     * 单条通道右手侧墙均布火把：
     * 右手侧 = 通道轴（mid1→mid2，房 N→N+1 前进方向）的法线 (axis.y, -axis.x) 一侧。
     * 注意（2026-08-01 用户实测修正）：↘ 前进方向（房 N→N+1）的右手侧 = 东北侧墙——
     * 曾用法线 (-axis.y, axis.x)（数学上面向 ↘ 时的右手侧 = 西南侧），实测火把生成在
     * 玩家体感左边墙上，故翻转为 (axis.y, -axis.x)；墙带判定侧随 right 一起翻转，
     * 火把垂距仍取指向通道中心的法向（贴墙内侧，换侧后自动跟着翻转）。
     * 侧墙件从 isoVisuals 实时收集（预制侧墙 + 封口补瓦同口径：单段直墙、平行通道轴、
     * 在右手侧墙带内、投影落在通道跨度内）；火把锚点沿整墙跨度按 interval 均布
     * （首尾各退半间隔），逐点找覆盖该投影位置的墙件锚定，垂距朝通道中心一侧。
     */
    _spawnPassageTorches(passage, cfg, ctx) {
        const g = ISO_WALL_GEO.torch;
        if (!g || !ctx.scene.textures.exists(g.tex)) return;
        // 预制件锚定数据（运行时提取；缺失/异常回退兜底常量）
        const extracted = _extractTorchAnchors();
        const anchors = extracted ? extracted.anchors : TORCH_ANCHOR_FALLBACK;
        const prefabWallScaleY = extracted ? extracted.wallScaleY : TORCH_PREFAB_WALL_SCALE_Y;
        const interval = cfg.interval || 350;
        // 通道轴（房 N→N+1 前进方向）与右手侧法线（实测：↘ 前进右手侧 = 东北侧墙）
        const ax = passage.mid2.x - passage.mid1.x, ay = passage.mid2.y - passage.mid1.y;
        const alen = Math.hypot(ax, ay) || 1;
        const axis = { x: ax / alen, y: ay / alen };
        const right = { x: axis.y, y: -axis.x };
        // 收集右手侧墙件：单段直墙、平行通道轴、墙带 40~420px（实测约 170~210）、
        // 投影在通道跨度 ±100 内（不过滤跨度会把房间平行墙并入）
        const walls = [];
        for (const q of WallSystem.isoVisuals) {
            const gq = WallSystem._geoForTex(q.tex);
            if (!gq || gq.category === 'obstacle') continue;
            if (gq.states || gq.gateX || gq.openDoor) continue; // 门/gate 不贴
            const segs = WallSystem._pieceBaseSegments(q);
            if (segs.length !== 1) continue; // 只贴单段直墙
            const [A, B] = segs[0];
            const dx = B.x - A.x, dy = B.y - A.y;
            const len = Math.hypot(dx, dy);
            if (len < 10 || Math.abs(dx * axis.x + dy * axis.y) / len < 0.95) continue;
            const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
            const side = (mx - passage.center.x) * right.x + (my - passage.center.y) * right.y;
            if (side < 40 || side > 420) continue;
            const s1 = (A.x - passage.mid1.x) * axis.x + (A.y - passage.mid1.y) * axis.y;
            const s2 = (B.x - passage.mid1.x) * axis.x + (B.y - passage.mid1.y) * axis.y;
            const lo = Math.min(s1, s2), hi = Math.max(s1, s2);
            if (hi < -100 || lo > alen + 100) continue;
            walls.push({ piece: q, A, B, lo, hi });
        }
        if (!walls.length) return;
        const spanLo = Math.min(...walls.map(w => w.lo));
        const spanHi = Math.max(...walls.map(w => w.hi));
        const scale = _scaleFor('torch', g, cfg.targetH);
        // 固定间隔均布：锚点投影 s 沿整墙跨度每 interval 一个（首尾各退半间隔）
        for (let s = spanLo + interval / 2; s <= spanHi - interval / 2 + 1; s += interval) {
            const w = walls.find(v => s >= v.lo - 1 && s <= v.hi + 1);
            if (!w) continue;
            const { A, B, piece: q } = w;
            const dx = B.x - A.x, dy = B.y - A.y;
            const len = Math.hypot(dx, dy) || 1;
            // 投影位置 s → 墙底边线上的锚点（t 按间隔均匀分布）
            const px = passage.mid1.x + axis.x * s, py = passage.mid1.y + axis.y * s;
            let t = ((px - A.x) * dx + (py - A.y) * dy) / (len * len);
            t = Math.max(0, Math.min(1, t));
            const mx = A.x + dx * t, my = A.y + dy * t;
            // 垂距：取背离通道中心一侧（两个法向里选朝墙面上方/外侧的那个）——
            // 与预制件「火把墙」的火把相对墙底边线的方向一致（实测火把在底边线上方 ~60px，
            // 挂在墙面上）；曾取朝通道中心一侧，实测火把落到墙脚/地板（底边线下方 ~60px）。
            // 按墙件 scaleY 折算
            const anchor = anchors[Math.floor(Math.random() * anchors.length)];
            let nx = -dy / len, ny = dx / len;
            if ((passage.center.x - mx) * nx + (passage.center.y - my) * ny > 0) { nx = -nx; ny = -ny; }
            const d = anchor.d * ((q.scaleY ?? q.scaleX ?? 1) / prefabWallScaleY);
            const pt = { x: mx + nx * d, y: my + ny * d };
            const torchDepth = (q.depth ?? q.y) + anchor.depthDelta;
            this._placeTorch(ctx, g, pt, scale, torchDepth);
        }
    },

    /**
     * 放一个火把渲染 piece + 持续火焰粒子（通道火把用）：
     * 无 rotation/flip、depthManual 贴墙深度、提灯矿工落地焰三色 ADD 上飘；
     * 火焰 emitter 登记 CombatRoomSystem._decoSprites（与障碍物阴影同口径）——
     * 战斗内常驻、cleanupRoom 时统一销毁，不再"不登记清理列表"导致每场战斗累积泄漏
     */
    _placeTorch(ctx, g, pt, scale, torchDepth) {
        WallSystem.isoVisuals.push({
            tex: g.tex,
            x: pt.x, y: pt.y,
            scaleX: scale, scaleY: scale,
            flipX: false, flipY: false,
            depth: torchDepth,
            depthManual: true, // 手调深度：_placeIsoPiece 渲染尊重 p.depth
        });
        ctx.total++;
        const scene = ctx.scene;
        const glowKey = `torch:${Math.round(pt.x)}:${Math.round(pt.y)}:${ctx.roomIndex}:${ctx.total}`;
        const glow = typeof scene.registerEnvironmentGlow === 'function'
            ? scene.registerEnvironmentGlow(glowKey, pt.x - 3, pt.y - (g.h * scale) * 0.88 + 2, {
                radius: 78 * scale,
                color: 0xff9d3d,
                alpha: 0.16,
                depth: torchDepth + 0.5,
                flicker: 0.16,
            })
            : null;
        const CRS = (typeof window !== 'undefined') ? window.CombatRoomSystem : null;
        if (glow && CRS) (CRS._decoSprites = CRS._decoSprites || []).push(glow);
        if (!scene.textures.exists('impact_dot') && typeof scene._ensureImpactDotTexture === 'function') {
            scene._ensureImpactDotTexture();
        }
        if (scene.textures.exists('impact_dot')) {
            const em = scene.add.particles(pt.x - 3, pt.y - (g.h * scale) * 0.88 + 2, 'impact_dot', {
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
            // 登记进战斗房清理链（window.CombatRoomSystem 晚绑定，防与 combat-room-system 循环导入；
            // cleanupRoom → cleanupGate 统一销毁。拿不到 CRS 时 emitter 会多活一会儿，
            // 场景切换仍随场景销毁，可接受）
            if (CRS) (CRS._decoSprites = CRS._decoSprites || []).push(em);
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
 * 菱形房内包含校验（内缩 inset）：canMoveTo 在房间外黑域也返回 true
 * （墙外没有碰撞体），不做包含校验障碍物会刷到房间外（线上教训）
 */
function _insideDiamond(bounds, pt, inset = 30) {
    return Math.abs(pt.x - bounds.cx) / Math.max(1, bounds.rx - inset)
         + Math.abs(pt.y - bounds.cy) / Math.max(1, bounds.ry - inset) <= 1;
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

/**
 * 障碍物组合池：预制库键序 = 编辑器显示序，取排在「火把墙」之后的预制件
 * （池子约定 = 纯障碍物组合；兜底剔除缺件/含墙件的预制件，防用户改库后混入墙件）
 */
function _prefabCompositionPool() {
    const lib = getWallPrefabLibrary();
    const keys = Object.keys(lib);
    const i = keys.indexOf(TORCH_PREFAB_KEY);
    if (i < 0) return [];
    return keys.slice(i + 1).filter(k => {
        const pf = lib[k];
        if (!pf || !Array.isArray(pf.pieces) || !pf.pieces.length) return false;
        return pf.pieces.every(q => {
            const g = WallSystem._geoForTex(q.tex);
            return !g || g.category === 'obstacle';
        });
    });
}

/**
 * 后墙锚点：随机选左上（LT：T→L）/ 右上（RT：T→R）边，沿线随机点（两端各留 15%
 * 避开转角/门口），朝房心法线方向取 dist 区间内随机距离。前墙（LB/RB）一侧不放。
 */
function _rollBackWallAnchor(bounds, dist) {
    const { cx, cy, rx, ry } = bounds;
    const T = { x: cx, y: cy - ry };
    const V = Math.random() < 0.5 ? { x: cx - rx, y: cy } : { x: cx + rx, y: cy };
    const t = 0.15 + Math.random() * 0.7;
    const P = { x: T.x + (V.x - T.x) * t, y: T.y + (V.y - T.y) * t };
    let nx = -(V.y - T.y), ny = V.x - T.x;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    if ((cx - P.x) * nx + (cy - P.y) * ny < 0) { nx = -nx; ny = -ny; }
    const [d0, d1] = dist;
    const d = d0 + Math.random() * Math.max(0, d1 - d0);
    return { x: P.x + nx * d, y: P.y + ny * d };
}

/** 触地半径（foot 半宽/半深取大；无 foot 按贴图半宽）：组合整组校验的内缩/排除余量 */
function _groundRadius(tex, scaleX, scaleY) {
    const g = WallSystem._geoForTex(tex);
    if (!g) return 30;
    const hw = (g.foot ? g.foot.w : g.w) * Math.abs(scaleX ?? 1) / 2;
    const hd = (g.foot ? g.foot.d : g.w) * Math.abs(scaleY ?? scaleX ?? 1) / 2;
    return Math.max(hw, hd);
}

/**
 * 件的旋转 AABB 半对角（组合整体包围半径用）：
 * 半宽/半高 × scale，有旋转按 |cos|/|sin| 展开 AABB 后取半对角
 * （数值上旋转不改变半对角，但按规格走 AABB 流程，口径与碰撞展开一致）；
 * 无 geo 的未知贴图按 60×60 兜底
 */
function _pieceHalfDiag(tex, scaleX, scaleY, rot = 0) {
    const g = WallSystem._geoForTex(tex);
    const w = g ? g.w : 60, h = g ? g.h : 60;
    let hw = w * Math.abs(scaleX ?? 1) / 2;
    let hd = h * Math.abs(scaleY ?? scaleX ?? 1) / 2;
    if (rot) {
        const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
        const nw = hw * c + hd * s;
        hd = hw * s + hd * c;
        hw = nw;
    }
    return Math.hypot(hw, hd);
}

/** 点到线段的最短距离 */
function _ptSegDist(P, A, B) {
    const dx = B.x - A.x, dy = B.y - A.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(P.x - (A.x + dx * t), P.y - (A.y + dy * t));
}

/**
 * 障碍物 depth 抬升（预制组合贴后墙件用）：
 * 静态件不走实体 junctionCorrectedDepth 仲裁——墙的 flat depth = 整条瓦最深端 y，
 * 比障碍物底边深时墙会后画盖住障碍物。找 400px 内最近的非 obstacle 墙件
 * （距离按到底边线段的最近距离算，无墙段的门件回退锚点距离），
 * 返回 max(baseDepth, 最近墙 depth + 0.1)；找不到附近墙件返回 baseDepth（不报错）。
 */
function _liftDepthAboveWalls(piece, baseDepth) {
    let best = null, bestDist = 400;
    for (const q of WallSystem.isoVisuals) {
        const gq = WallSystem._geoForTex(q.tex);
        if (!gq || gq.category === 'obstacle') continue;
        const segs = WallSystem._pieceBaseSegments(q);
        let d;
        if (segs.length) {
            d = Infinity;
            for (const [A, B] of segs) d = Math.min(d, _ptSegDist(piece, A, B));
        } else {
            d = Math.hypot(piece.x - q.x, piece.y - q.y);
        }
        if (d < bestDist) { bestDist = d; best = q; }
    }
    if (!best) return baseDepth;
    return Math.max(baseDepth, (best.depth ?? best.y) + 0.1);
}
