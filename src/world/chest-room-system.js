/**
 * 宝箱房系统（精英战斗事件专属）
 *
 * 流程：
 * 1. 精英战斗入场：按墙壁预制「宝箱房」（门墙×1 + 直墙×3，data/wall-prefabs.json）
 *    在场地正中央拼一间小菱形房，门墙常闭；房间区域注册为刷怪排除区
 * 2. 房间中央生成对应地牢等级的宝箱（F/E/D/C/B/A，统一闭合贴图 chest_closed，192px）+ 上方 60s 倒计时
 *    （白字黑描边无底色，最后 10s 同款）
 * 3. 倒计时内完成精英战斗 → 打开宝箱房门墙（播门闸 16 帧开门动画，门洞碰撞启停）；
 *    超时未完成 → 宝箱 1s 淡出消失，房门不再打开
 * 4. 玩家靠近宝箱 → 同一 Sprite 淡出闭合态、切换 chest_opened 后淡入 + 音效 → 按等级宝箱事件奖励表发放
 *   （combat-formulas.json universalEventRewards.treasureChest[grade]：强化石+改造券必得；
 *    50% 金币 / 25% 粉尘 / 25% 宝箱怪位——宝箱怪位当前按金币兜底发放）
 * 5. 离场守卫：场地内还有未开宝箱时走出大门白区，弹确认框（是/否）
 */
import { WallSystem, ISO_WALL_GEO, isoGateHole, isoHalfThick } from './wall-system.js';
import { getWallPrefabLibrary } from './wall-prefabs.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import { COMBAT_FORMULAS } from '../config/combat-formulas.js';
import { EnhancementItems } from '../ui/reward-system.js';
import { MagicDustItem } from '../config/enchant-config.js';
import { ItemDatabase } from '../items/item-database.js';
import { SoundManager } from '../ui/sound-manager.js';

const COUNTDOWN_SEC = 60;
const OPEN_RANGE = 120; // 与放大一倍的宝箱贴图匹配（原 60）
const GATE_ANIM_MS = 900;
// 两态原图的箱体占画布比例不同：开启态底座横向跨度 325px，闭合态 408px。
// 分态显示规格让开箱前后的实体箱体等宽；origin Y 同时锁住 Alpha 底边，避免底座跳动。
const CHEST_CLOSED_DISPLAY_WIDTH = 192;
const CHEST_OPENED_DISPLAY_WIDTH = 241;
const CHEST_CLOSED_ORIGIN_Y = 0.75;
const CHEST_OPENED_ORIGIN_Y = 0.78015;
const CHEST_FADE_OUT_MS = 140;
const CHEST_FADE_IN_MS = 260;
const CHEST_SOUND = 'assets/sounds/environment/chest_open.mp3';
const GRADES = ['F', 'E', 'D', 'C', 'B', 'A']; // 由低到高，F 级地牢可被事件强制精英战
// 地牢等级 → 稀有度档（与出征祭品门槛同序：F=普通、E=优质、D=稀有、C=史诗、B=神话、A=传说）
const RARITY_BY_GRADE = ['common', 'uncommon', 'rare', 'epic', 'mythic', 'legendary'];
// 精英宝箱房额外装备掉落的稀有度下探级数（如 D 级 → 优质，即稀有度低一级）
const EQUIP_RARITY_DROP_STEP = 1;
// 精英宝箱房额外装备掉落概率（50%）
const EQUIP_DROP_CHANCE = 0.5;

/**
 * 非武器装备池（铠甲/饰品；排除武器/盾牌/消耗品/祭品/矿石）。
 * 数据源 ItemDatabase（equipment.json）——新增装备自动进池，无需改代码。
 */
function _equipmentPool() {
    const items = (ItemDatabase && ItemDatabase.items) || {};
    return Object.values(items).filter(it =>
        it && it.name &&
        (it.category === 'armor' || it.category === 'accessory') &&
        !it.weaponType && !it.weaponId
    );
}

function _fitChestSprite(sprite, state = 'closed') {
    const sourceWidth = Math.max(1, Number(sprite.width) || 1);
    const sourceHeight = Math.max(1, Number(sprite.height) || sourceWidth);
    const opened = state === 'opened';
    const displayWidth = opened ? CHEST_OPENED_DISPLAY_WIDTH : CHEST_CLOSED_DISPLAY_WIDTH;
    sprite.setOrigin(0.5, opened ? CHEST_OPENED_ORIGIN_Y : CHEST_CLOSED_ORIGIN_Y);
    sprite.setDisplaySize(displayWidth, displayWidth * (sourceHeight / sourceWidth));
}

function _equipmentRarityForGrade(grade) {
    const gradeIdx = GRADES.indexOf(grade);
    const tierIdx = Math.max(0, (gradeIdx < 0 ? 2 : gradeIdx) - EQUIP_RARITY_DROP_STEP);
    return RARITY_BY_GRADE[tierIdx] || 'common';
}

/**
 * 精英宝箱房额外装备掉落：稀有度 = 地牢等级稀有度 − 1 级（F 钳制到 common）。
 * 优先抽同稀有度条目（池子未来扩充后自然按档出装）；无匹配条目时整池随机，
 * 并把掉落实例的稀有度覆盖为档位（保证 E 级也能掉"普通"、D 级掉"优质"）。
 */
function _rollEquipmentDrop(grade) {
    const pool = _equipmentPool();
    if (!pool.length) return null;
    const tier = _equipmentRarityForGrade(grade);
    const sameTier = pool.filter(it => (it.rarity || 'common') === tier);
    const src = sameTier.length ? sameTier : pool;
    const item = src[Math.floor(Math.random() * src.length)];
    return { ...item, rarity: tier };
}

export const ChestRoomSystem = {
    active: false,
    _pieces: [],        // 推入 isoVisuals 的直墙件（清理时移除）
    _gate: null,        // { sprite, segs, gateSeg, frame, animCounter }
    _chest: null,       // { sprite, x, y, opened, grade, openAnim }
    _timerText: null,
    _timerFrame: null,
    _timeLeft: 0,
    _combatDone: false,
    _failed: false,     // 超时未打完：宝箱已淡出
    _fadeTween: null,
    _isElite: false,    // 精英战斗宝箱房：额外 50% 非武器装备掉落

    /** 地牢类型 → 宝箱等级（地牢 grade 即宝箱等级；奖励表见 combat-formulas.json treasureChest[F..A]） */
    _gradeFor(dungeonType) {
        const list = DungeonConfig.getDungeonList() || {};
        const g = (list[dungeonType] && list[dungeonType].grade) || 'D';
        return GRADES.includes(g) ? g : 'D';
    },

    /** 路线页收益预览与真实开箱逻辑共用的数据源。 */
    getRewardPreview(dungeonType) {
        const grade = this._gradeFor(dungeonType);
        const table = ((COMBAT_FORMULAS.universalEventRewards || {}).treasureChest || {})[grade] || {};
        return {
            grade,
            gold: Math.max(0, Number(table.gold) || 0),
            materialDust: Math.max(0, Number(table.materialDust) || 0),
            enhancementStone: Math.max(0, Number(table.enhancementStone) || 0),
            reforgeTicket: Math.max(0, Number(table.reforgeTicket) || 0),
            goldChance: 0.75,
            guaranteedMaterials: true,
            equipmentRarity: _equipmentRarityForGrade(grade),
            equipmentChance: EQUIP_DROP_CHANCE,
        };
    },

    /**
     * 精英战斗入场后调用：在场地中央摆放宝箱房 + 宝箱 + 倒计时
     * @param {string} dungeonType 地牢类型（决定宝箱等级与奖励表）
     * @param {Object} bounds CombatRoomSystem._roomBounds（场地中心）
     * @param {Object} [opts]
     * @param {boolean} [opts.deferCountdown] 延迟倒计时（多房竞技场入场即 setup，
     *   但 60s 倒计时等玩家进入末房 startCountdown() 后才走字）
     * @param {boolean} [opts.openArena] 开放式竞技场宝箱点：不套旧预制墙，
     *   仅保留刷怪排除区、宝箱、倒计时与奖励生命周期
     * @param {Object} [opts.worldBlockRoom] CombatRoomSystem 预建的单格墙实体宝箱房；
     *   本系统为其安装独立门闸、宝箱、倒计时和刷怪排除区
     */
    setup(dungeonType, bounds, opts = {}) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        this._isElite = !!opts.isElite; // 精英战斗宝箱房：额外 50% 非武器装备掉落
        if (!scene || !bounds) {
            console.warn('[ChestRoomSystem] setup 失败：场景或房间边界未就绪', { hasScene: !!scene, hasBounds: !!bounds });
            return false;
        }
        if (opts.worldBlockRoom) {
            return this._setupWorldBlockChest(scene, dungeonType, bounds, opts);
        }
        // 世界单格冰墙竞技场已经由房间外墙完整围合；若再放历史「宝箱房」预制，
        // 会在末房中央混入 frozen_straight 连续墙。开放式宝箱点保留完整事件逻辑，
        // 但不制造第二套围墙/门/阴影。
        if (opts.openArena) {
            return this._setupOpenArenaChest(scene, dungeonType, bounds, opts);
        }
        // 宝箱房预制按墙样式选择（样式表 chestPrefab，缺失回退「宝箱房」）
        const wallStyle = WallSystem.getWallStyle ? WallSystem.getWallStyle() : { chestPrefab: '宝箱房', straight: 'straight', gate: 'gate' };
        const prefabName = wallStyle.chestPrefab || '宝箱房';
        const prefabLib = getWallPrefabLibrary();
        const prefab = prefabLib[prefabName] || prefabLib['宝箱房'];
        if (!prefab || !Array.isArray(prefab.pieces)) {
            console.warn('[ChestRoomSystem] setup 失败：预制缺失', { prefabName, hasPrefab: !!prefab });
            return false;
        }

        // 预制件几何中心：全部件 face 线段端点的外接框中心（与编辑器 cx/cy 无关）
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const segsByPiece = prefab.pieces.map(p => {
            const segs = WallSystem._pieceBaseSegments(p);
            for (const [a, b] of segs) {
                minX = Math.min(minX, a.x, b.x); maxX = Math.max(maxX, a.x, b.x);
                minY = Math.min(minY, a.y, b.y); maxY = Math.max(maxY, a.y, b.y);
            }
            return segs;
        });
        const pcx = (minX + maxX) / 2, pcy = (minY + maxY) / 2;
        const ox = bounds.cx - pcx, oy = bounds.cy - pcy;

        // 1. 直墙件：平移后推入 isoVisuals（深度按底边重算：上臂后墙 min、下臂前墙 max）
        const gateDefs = [];
        // 墙样式跟随：非 default 样式时，预制直墙件按样式几何重映射（face 线段不变，贴图/缩放重算）
        const styleGeos = WallSystem.getWallStyleGeos ? WallSystem.getWallStyleGeos() : { straight: 'straight', gate: 'gate' };
        const styleStraightKey = styleGeos.straight;
        const styleStraightTex = (ISO_WALL_GEO[styleStraightKey] || ISO_WALL_GEO.straight).tex;
        const styleGateTex = (ISO_WALL_GEO[styleGeos.gate] || ISO_WALL_GEO.gate).tex;
        prefab.pieces.forEach((p, i) => {
            // 门墙件识别：僵尸门墙或当前样式门墙（如沼泽藤门预制件）
            const [a, b] = segsByPiece[i][0];
            const ay = a.y + oy, by = b.y + oy;
            // 全场统一 max 规则（与菱形战斗房墙体同口径，详见 wall-system buildIsoDiamondWalls 注释）
            const mode = 'max';
            if (p.tex === 'wall_gate' || p.tex === styleGateTex) {
                gateDefs.push({ p, seg: segsByPiece[i][0] });
                return;
            }
            if (p.tex === 'wall_straight' && styleStraightTex !== 'wall_straight') {
                // 样式重映射：用样式几何把同一 face 线段重新铺件（_addSegPiece 直推 isoVisuals）
                WallSystem._addSegPiece(
                    { x: a.x + ox, y: ay }, { x: b.x + ox, y: by },
                    !!p.flipX, styleStraightKey, mode
                );
                this._pieces.push(WallSystem.isoVisuals[WallSystem.isoVisuals.length - 1]);
                return;
            }
            const q = { ...p, x: p.x + ox, y: p.y + oy };
            // 整块墙遮挡规则（与菱形战斗房墙体同口径）：后墙 min / 前墙 max——
            // 墙后（脚线 y 更小）的实体被整面墙遮挡，含边角/接缝；
            // 不再沿用预制保存的 hub 手调图层（入口门墙挡不住实体、右上/右下接缝漏遮挡的根因）
            q.depth = mode === 'min' ? Math.min(ay, by) : Math.max(ay, by);
            this._pieces.push(q);
            WallSystem.isoVisuals.push(q);
        });

        // 2. 门墙件：独立控制（常闭 + 开门动画 + 碰撞启停），不进 isoVisuals
        for (const { p } of gateDefs) {
            this._placeGate(scene, p, ox, oy);
        }

        WallSystem.rebuildIsoCollision();
        if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();

        // 2.5 墙脚接触阴影（离屏实色带 → blur 羽化 → 单张贴图统一透明度：
        // 多重墙体阴影逐笔叠加在接缝处突兀，羽化后自然融合；地面特效层 cy-998，cleanup 销毁）
        const shadeSegs = prefab.pieces.map((p, i) => {
            const [a, b] = segsByPiece[i][0];
            return [{ x: a.x + ox, y: a.y + oy }, { x: b.x + ox, y: b.y + oy }];
        });
        let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
        for (const [A, B] of shadeSegs) {
            sx0 = Math.min(sx0, A.x, B.x); sy0 = Math.min(sy0, A.y, B.y);
            sx1 = Math.max(sx1, A.x, B.x); sy1 = Math.max(sy1, A.y, B.y);
        }
        const SM = 90;
        const shadeCanvas = document.createElement('canvas');
        shadeCanvas.width = (sx1 - sx0) + SM * 2;
        shadeCanvas.height = (sy1 - sy0) + SM * 2;
        const sctx = shadeCanvas.getContext('2d');
        sctx.lineCap = 'round';
        sctx.lineJoin = 'round';
        sctx.strokeStyle = '#000000';
        sctx.lineWidth = 100; // 两侧各 50px 阴影带
        for (const [A, B] of shadeSegs) {
            sctx.beginPath();
            sctx.moveTo(A.x - sx0 + SM, A.y - sy0 + SM);
            sctx.lineTo(B.x - sx0 + SM, B.y - sy0 + SM);
            sctx.stroke();
        }
        // 羽化：整图模糊软化全部边缘与接缝
        const soft = document.createElement('canvas');
        soft.width = shadeCanvas.width;
        soft.height = shadeCanvas.height;
        const fctx = soft.getContext('2d');
        fctx.filter = 'blur(14px)';
        fctx.drawImage(shadeCanvas, 0, 0);
        fctx.filter = 'none';
        const shadeKey = 'chest_room_shade';
        if (scene.textures.exists(shadeKey)) scene.textures.remove(shadeKey);
        scene.textures.addCanvas(shadeKey, soft);
        this._shadowGfx = scene.add.image(sx0 - SM, sy0 - SM, shadeKey);
        this._shadowGfx.setOrigin(0, 0);
        this._shadowGfx.setAlpha(0.55);
        this._shadowGfx.setDepth(bounds.cy - 998);

        // 3. 刷怪排除区：宝箱房菱形外接（+ 余量），整片房内不刷怪
        const exRx = (maxX - minX) / 2 + 60, exRy = (maxY - minY) / 2 + 60;
        this._exclusion = { cx: bounds.cx, cy: bounds.cy, rx: exRx, ry: exRy };

        // 4. 宝箱（未打开 = chest_closed；开箱后同一 Sprite 切换 chest_opened；grade 仅用于奖励表）
        const grade = this._gradeFor(dungeonType);
        const chestX = bounds.cx, chestY = bounds.cy;
        const sprite = scene.add.sprite(chestX, chestY, 'chest_closed');
        _fitChestSprite(sprite, 'closed');
        sprite.setDepth(chestY);
        this._chest = { sprite, x: chestX, y: chestY, opened: false, grade, openAnim: null };

        // 5. 倒计时（白字黑描边，无底色；最后 10s 同款样式）
        this._timeLeft = COUNTDOWN_SEC;
        this._countdownArmed = !opts.deferCountdown;
        const ty = chestY - 130;
        this._timerText = scene.add.text(chestX, ty, `${COUNTDOWN_SEC}`, {
            fontFamily: 'SimHei, "Microsoft YaHei", "黑体", sans-serif',
            fontSize: '26px', fontStyle: 'bold', color: '#ffffff',
            stroke: '#000000', strokeThickness: 4,
            padding: { x: 10, y: 4 },
        }).setOrigin(0.5, 0.5).setDepth(chestY + 801);

        this.active = true;
        this._combatDone = false;
        this._failed = false;
        return true;
    },

    /** 把当前样式门贴图的整段底边精确映射到单格墙门洞 A→B。 */
    _gatePieceForSpan(span) {
        if (!span) return null;
        const geoKey = WallSystem.getWallStyleGeos ? WallSystem.getWallStyleGeos().gate : 'gate';
        const g = ISO_WALL_GEO[geoKey] || ISO_WALL_GEO.gate;
        const A = span.a, B = span.b;
        const flip = !!span.flip;
        const p0 = g.base[0];
        const sx = Math.abs(B.x - A.x) / Math.max(1, Math.abs(g.base[1][0] - g.base[0][0]));
        const sy = Math.abs(B.y - A.y) / Math.max(1, Math.abs(g.base[1][1] - g.base[0][1]));
        let x0, y0;
        if (!flip) {
            x0 = A.x - p0[0] * sx;
            y0 = A.y - p0[1] * sy;
        } else {
            x0 = A.x - (g.w - p0[0]) * sx;
            y0 = A.y - p0[1] * sy;
        }
        return {
            tex: g.tex,
            x: x0 + g.w * sx / 2,
            y: y0 + g.h * sy / 2,
            scaleX: sx,
            scaleY: sy,
            flipX: flip,
            flipY: false,
            depth: span.depth,
        };
    },

    /** 僵尸竞技场实体宝箱房：黑砖单格墙环 + 六格独立闸门。 */
    _setupWorldBlockChest(scene, dungeonType, bounds, opts) {
        const room = opts.worldBlockRoom;
        const opening = room && room.opening;
        if (!opening) return false;
        this._pieces = Array.isArray(room.pieces) ? [...room.pieces] : [];
        this._gate = null;
        this._shadowGfx = null;

        const gatePiece = this._gatePieceForSpan(opening);
        if (gatePiece) this._placeGate(scene, gatePiece, 0, 0);
        if (!this._gate) {
            // 门资源异常时回填预留六格，保证宝箱房仍是闭合实体边界。
            const fillPieces = (opening.fillPieces || []).filter(Boolean);
            WallSystem.isoVisuals.push(...fillPieces);
            this._pieces.push(...fillPieces);
        }
        WallSystem.rebuildIsoCollision();
        if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();

        return this._setupArenaChestLifecycle(scene, dungeonType, bounds, opts, {
            cx: room.cx,
            cy: room.cy,
            rx: room.rx + 60,
            ry: room.ry + 60,
        });
    },

    /** 开放式与实体单格墙宝箱房共用的宝箱、倒计时和事件状态机。 */
    _setupArenaChestLifecycle(scene, dungeonType, bounds, opts, exclusion) {
        this._exclusion = exclusion;
        const grade = this._gradeFor(dungeonType);
        const chestX = bounds.cx, chestY = bounds.cy;
        const sprite = scene.add.sprite(chestX, chestY, 'chest_closed');
        _fitChestSprite(sprite, 'closed');
        sprite.setDepth(chestY);
        this._chest = { sprite, x: chestX, y: chestY, opened: false, grade, openAnim: null };

        this._timeLeft = COUNTDOWN_SEC;
        this._countdownArmed = !opts.deferCountdown;
        this._timerText = scene.add.text(chestX, chestY - 130, `${COUNTDOWN_SEC}`, {
            fontFamily: 'SimHei, "Microsoft YaHei", "黑体", sans-serif',
            fontSize: '26px', fontStyle: 'bold', color: '#ffffff',
            stroke: '#000000', strokeThickness: 4,
            padding: { x: 10, y: 4 },
        }).setOrigin(0.5, 0.5).setDepth(chestY + 801);

        this.active = true;
        this._combatDone = false;
        this._failed = false;
        return true;
    },

    /**
     * 世界单格竞技场的开放式宝箱点。末房本身就是封闭战斗空间，因此不重复生成
     * 历史宝箱房墙；战斗完成前仍不能开箱，超时、奖励和离场守卫均复用原状态机。
     */
    _setupOpenArenaChest(scene, dungeonType, bounds, opts) {
        this._pieces = [];
        this._gate = null;
        this._shadowGfx = null;
        return this._setupArenaChestLifecycle(scene, dungeonType, bounds, opts, {
            cx: bounds.cx, cy: bounds.cy, rx: 260, ry: 150,
        });
    },

    /**
     * 门墙放置：按预制件保存的变换（x/y/scale/flip）原样放置，初始关门。
     * 碰撞从件自身变换推导（_pieceBaseSegments + gateX 映射），与 wall-gate 同模型。
     * 图层：门墙 depth = 门洞中心底边 y（"墙看底边 max、门看门洞中心"定案）——
     * 单位过门洞时门后遮挡、过半场显现；直墙件仍为整墙 max 规则，接缝天然衔接。
     */
    _placeGate(scene, p, ox, oy) {
        const g = WallSystem._geoForTex(p.tex) || ISO_WALL_GEO.gate;
        if (!scene.textures.exists(p.tex)) return;
        this._gateGeoKey = Object.keys(ISO_WALL_GEO).find(k => ISO_WALL_GEO[k].tex === p.tex) || 'gate';
        const piece = { ...p, x: p.x + ox, y: p.y + oy };
        // 碰撞：门两侧常开 + 门洞按开关启停（与 wall-gate 同模型）
        const [gA, gB] = WallSystem._pieceBaseSegments(piece)[0];
        const hole = isoGateHole(g);
        if (!hole) return;
        const ht = isoHalfThick(g);
        const baseAt = (tx) => WallSystem.texPointToWorld(piece, tx, g.base[0][1] + (tx - g.base[0][0]) * g.slope);
        const g1 = baseAt(hole[0]), g2 = baseAt(hole[1]);
        const sprites = [];
        const depthSegments = [];
        const makeSprite = (crop, depth) => {
            const gateSprite = scene.add.sprite(piece.x, piece.y, p.tex, 0);
            gateSprite.setOrigin(0.5, 0.5);
            gateSprite.setScale(piece.scaleX ?? 1, piece.scaleY ?? piece.scaleX ?? 1);
            gateSprite.setFlipX(!!piece.flipX);
            gateSprite.setDepth(depth);
            if (crop && typeof gateSprite.setCrop === 'function') {
                const applyCrop = () => gateSprite.setCrop(crop.x, 0, crop.w, g.h);
                const originalSetFrame = gateSprite.setFrame.bind(gateSprite);
                gateSprite.setFrame = (frame, updateSize, updateOrigin) => {
                    const result = originalSetFrame(frame, updateSize, updateOrigin);
                    applyCrop();
                    return result;
                };
                applyCrop();
            }
            sprites.push(gateSprite);
            return gateSprite;
        };
        const depthSliceCount = Math.max(1, Math.round(g.depthSlices || 1));
        if (depthSliceCount > 1) {
            const span = hole[1] - hole[0];
            for (let index = 0; index < depthSliceCount; index++) {
                const tx0 = hole[0] + span * index / depthSliceCount;
                const tx1 = hole[0] + span * (index + 1) / depthSliceCount;
                const sA = baseAt(tx0);
                const sB = baseAt(tx1);
                const depth = Math.max(sA.y, sB.y) + 3.9;
                const crop = { x: Math.floor(tx0), w: Math.ceil(tx1) - Math.floor(tx0) };
                makeSprite(crop, depth);
                depthSegments.push({ A: sA, B: sB, depth, crop });
            }
        } else {
            const depth = (g1.y + g2.y) / 2;
            makeSprite(null, depth);
        }
        const sprite = sprites[0] || null;
        const segs = [
            { x1: gA.x, y1: gA.y, x2: g1.x, y2: g1.y, halfThick: ht, _chestGate: true },
            { x1: g2.x, y1: g2.y, x2: gB.x, y2: gB.y, halfThick: ht, _chestGate: true },
        ];
        const gateSeg = { x1: g1.x, y1: g1.y, x2: g2.x, y2: g2.y, halfThick: ht, _chestGate: true };
        if (WallSystem.isoSegments) {
            for (const s of segs) WallSystem.isoSegments.push(s);
            WallSystem.isoSegments.push(gateSeg); // 初始关门
        }
        this._gate = { sprite, sprites, depthSegments, segs, gateSeg, open: false };
    },

    /** 打开宝箱房门墙：播 16 帧开门动画，门洞碰撞移除 */
    _openRoomGate() {
        const gate = this._gate;
        if (!gate || gate.open) return;
        gate.open = true;
        if (WallSystem.isoSegments) {
            const i = WallSystem.isoSegments.indexOf(gate.gateSeg);
            if (i >= 0) WallSystem.isoSegments.splice(i, 1);
        }
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (scene && gate.sprite) {
            const gateGeo = ISO_WALL_GEO[this._gateGeoKey || 'gate'] || ISO_WALL_GEO.gate;
            gate.animCounter = scene.tweens.addCounter({
                from: 0, to: (gateGeo.frames || 16) - 1,
                duration: GATE_ANIM_MS, ease: 'Linear',
                onUpdate: (tw) => {
                    const frame = Math.floor(tw.getValue());
                    for (const sprite of gate.sprites || [gate.sprite]) {
                        if (sprite && sprite.active) sprite.setFrame(frame);
                    }
                },
            });
        }
    },

    /** 启动倒计时（竞技场末房进入时调用；deferCountdown 未用时本已 armed，幂等） */
    startCountdown() {
        if (!this.active) return;
        this._countdownArmed = true;
    },

    /** 精英战斗完成（dungeon-map-system 调用）：限时内完成才开房门 */
    onCombatComplete() {
        if (!this.active || this._combatDone) return;
        this._combatDone = true;
        if (this._failed) return; // 已超时：宝箱已消失，房门不开
        this._destroyTimer();
        this._openRoomGate();
    },

    /** 是否还有可获取但未开的宝箱（离场守卫判定用） */
    hasUnopenedLoot() {
        return !!(this.active && this._combatDone && !this._failed && this._chest && !this._chest.opened);
    },

    /** 每帧驱动（CombatRoomSystem.update 调用）：倒计时 + 超时淡出 + 靠近开箱 */
    update(dt, player) {
        if (!this.active) return;

        // 倒计时（战斗未完成前；deferCountdown 时等 startCountdown 后才走字）
        if (!this._combatDone && !this._failed && this._countdownArmed !== false) {
            this._timeLeft -= dt / 1000;
            const t = Math.max(0, Math.ceil(this._timeLeft));
            if (this._timerText) {
                this._timerText.setText(`${t}`);
                // 白字黑描边；最后 10s 红字黑描边（setColor 不覆盖字号/描边）
                this._timerText.setColor(this._timeLeft <= 10 ? '#dd2222' : '#ffffff');
            }
            if (this._timeLeft <= 0) this._expireChest();
        }

        // 玩家靠近开箱（房门已开 + 宝箱未开）
        if (this._chest && !this._chest.opened && this._combatDone && !this._failed && player) {
            const d = Math.hypot(player.x - this._chest.x, player.y - this._chest.y);
            if (d <= OPEN_RANGE) this._openChest(player);
        }
    },

    /** 超时未打完：宝箱 1s 淡出消失，房门保持关闭 */
    _expireChest() {
        if (this._failed) return;
        this._failed = true;
        this._destroyTimer();
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (scene && this._chest && this._chest.sprite) {
            const sp = this._chest.sprite;
            this._fadeTween = scene.tweens.add({
                targets: sp, alpha: 0, duration: 1000, ease: 'Linear',
                onComplete: () => { if (sp && sp.active) sp.destroy(); },
            });
        }
    },

    /** 开箱：闭合态淡出、切换开启态后淡入 + 音效 + 发奖。 */
    _openChest(player) {
        const chest = this._chest;
        if (!chest || chest.opened) return;
        chest.opened = true;

        // 音效（视频原声）
        if (SoundManager && typeof SoundManager.playWorld === 'function') {
            // 世界音效（2026-08-11 距离衰减）：开箱声按宝箱位置衰减
            SoundManager.playWorld(CHEST_SOUND, chest.x, chest.y);
        } else if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(CHEST_SOUND);
        }

        // 双贴图过渡：只复用当前 Sprite，避免额外显示对象逃逸清理生命周期。
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (scene && chest.sprite && chest.sprite.active && scene.textures.exists('chest_opened')) {
            const sprite = chest.sprite;
            if (chest.openAnim) chest.openAnim.stop();
            chest.openAnim = scene.tweens.add({
                targets: sprite,
                alpha: 0,
                duration: CHEST_FADE_OUT_MS,
                ease: 'Sine.easeIn',
                onComplete: () => {
                    if (!sprite.active || this._chest !== chest) return;
                    sprite.setTexture('chest_opened');
                    _fitChestSprite(sprite, 'opened');
                    chest.openAnim = scene.tweens.add({
                        targets: sprite,
                        alpha: 1,
                        duration: CHEST_FADE_IN_MS,
                        ease: 'Sine.easeOut',
                        onComplete: () => {
                            if (this._chest === chest) chest.openAnim = null;
                        },
                    });
                },
            });
        }

        this._giveRewards(player, chest.grade);
    },

    /** 按等级宝箱事件奖励表发奖（强化石+改造券必得；50% 金币 / 25% 粉尘 /
     *  25% 宝箱怪位暂按金币兜底）——
     *  奖励直接掉落到宝箱周围地上（DropItem，玩家拾取/金币自动拾取） */
    _giveRewards(player, grade) {
        const table = ((COMBAT_FORMULAS.universalEventRewards || {}).treasureChest) || {};
        const g = table[grade] || { gold: 500, materialDust: 200, enhancementStone: 1, reforgeTicket: 1, tributeChance: 0 };
        const Game = (typeof window !== 'undefined') ? window.Game : null;
        if (!Game || typeof Game.dropItem !== 'function') return;
        const cx = this._chest ? this._chest.x : player.x;
        const cy = this._chest ? this._chest.y : player.y;
        let dropIdx = 0;
        const drop = (template) => {
            // 围绕宝箱散开（避免多件重叠在同一像素）
            const a = (dropIdx * 2.1) + Math.random() * 0.6;
            Game.dropItem(cx + Math.cos(a) * 46, cy + Math.sin(a) * 34, template);
            dropIdx++;
        };
        const goldTemplate = () => ({ name: '金币', category: 'gold', stack: g.gold, rarity: 'mythic' });

        // 宝箱房的成长核心：强化石与改造券不再参与 25% 材料分支，改为每箱必得。
        if (EnhancementItems && EnhancementItems.enhance_stone && (g.enhancementStone ?? 0) > 0) {
            drop({ ...EnhancementItems.enhance_stone, stack: g.enhancementStone });
        }
        if (EnhancementItems && EnhancementItems.modify_ticket && (g.reforgeTicket ?? 0) > 0) {
            drop({ ...EnhancementItems.modify_ticket, stack: g.reforgeTicket });
        }

        const roll = Math.random();
        if (roll < 0.5) {
            drop(goldTemplate());
        } else if (roll < 0.75) {
            // 粉尘分支：石/券已经作为宝箱房保底发放。
            if (MagicDustItem) {
                drop({ ...MagicDustItem, stack: g.materialDust });
            }
        } else {
            drop(goldTemplate());
        }
        // 精英战斗宝箱房额外奖励：50% 概率再掉一件非武器装备
        // （稀有度 = 地牢等级稀有度 − 1 级，如 D 级→优质；池子=铠甲/饰品）
        if (this._isElite && Math.random() < EQUIP_DROP_CHANCE) {
            const equip = _rollEquipmentDrop(grade);
            if (equip) drop(equip);
        }
    },

    _destroyTimer() {
        if (this._timerText) { this._timerText.destroy(); this._timerText = null; }
        if (this._timerFrame) { this._timerFrame.destroy(); this._timerFrame = null; }
    },

    /** 清理（CombatRoomSystem.cleanupGate 调用）：销毁精灵/碰撞/计时，直墙件随场景恢复自动还原 */
    cleanup() {
        this._destroyTimer();
        if (this._gate) {
            if (this._gate.animCounter) this._gate.animCounter.stop();
            if (WallSystem.isoSegments) {
                for (const s of [...this._gate.segs, this._gate.gateSeg]) {
                    const i = WallSystem.isoSegments.indexOf(s);
                    if (i >= 0) WallSystem.isoSegments.splice(i, 1);
                }
            }
            for (const sprite of new Set([...(this._gate.sprites || []), this._gate.sprite].filter(Boolean))) {
                sprite.destroy();
            }
            this._gate = null;
        }
        if (this._chest) {
            if (this._chest.openAnim) {
                this._chest.openAnim.stop();
                this._chest.openAnim = null;
            }
            if (this._chest.sprite && this._chest.sprite.active) this._chest.sprite.destroy();
            this._chest = null;
        }
        if (this._fadeTween) { this._fadeTween.stop(); this._fadeTween = null; }
        if (this._shadowGfx) { this._shadowGfx.destroy(); this._shadowGfx = null; }
        this._pieces = [];
        this._exclusion = null;
        this.active = false;
        this._combatDone = false;
        this._failed = false;
        this._isElite = false;
        this._timeLeft = 0;
    },
};

// 挂载到全局（wall-system 遮挡仲裁缓存引用用，避免模块环依赖）
if (typeof window !== 'undefined' && !window.ChestRoomSystem) {
    window.ChestRoomSystem = ChestRoomSystem;
}
