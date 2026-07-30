/**
 * 宝箱房系统（精英战斗事件专属）
 *
 * 流程：
 * 1. 精英战斗入场：按墙壁预制「宝箱房」（门墙×1 + 直墙×3，data/wall-prefabs.json）
 *    在场地正中央拼一间小菱形房，门墙常闭；房间区域注册为刷怪排除区
 * 2. 房间中央生成对应地牢等级的宝箱（F/E/D/C/B/A，统一贴图 chest_closed，192px）+ 上方 60s 倒计时
 *    （白字黑描边无底色，最后 10s 同款）
 * 3. 倒计时内完成精英战斗 → 打开宝箱房门墙（播门闸 16 帧开门动画，门洞碰撞启停）；
 *    超时未完成 → 宝箱 1s 淡出消失，房门不再打开
 * 4. 玩家靠近宝箱 → 播放开箱 16 帧动画（1.5s）+ 音效 → 按等级宝箱事件奖励表发放
 *   （combat-formulas.json universalEventRewards.treasureChest[grade]：50% 金币 /
 *    25% 材料组 / 25% 宝箱怪位——宝箱怪位当前按金币兜底发放）
 * 5. 离场守卫：场地内还有未开宝箱时走出大门白区，弹确认框（是/否）
 */
import { WallSystem, ISO_WALL_GEO, isoGateHole, isoHalfThick } from './wall-system.js';
import { getWallPrefabLibrary } from './wall-prefabs.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import { COMBAT_FORMULAS } from '../config/combat-formulas.js';
import { BossRewardSystem } from './boss-reward-system.js';
import { SoundManager } from '../ui/sound-manager.js';

const COUNTDOWN_SEC = 60;
const OPEN_RANGE = 120; // 与放大一倍的宝箱贴图匹配（原 60）
const GATE_ANIM_MS = 900;
const CHEST_SOUND = 'assets/sounds/environment/chest_open.mp3';
const GRADES = ['F', 'E', 'D', 'C', 'B', 'A']; // 由低到高，F 级地牢可被事件强制精英战

export const ChestRoomSystem = {
    active: false,
    _pieces: [],        // 推入 isoVisuals 的直墙件（清理时移除）
    _gate: null,        // { sprite, segs, gateSeg, frame, animCounter }
    _chest: null,       // { sprite, x, y, opened, openAnim }
    _timerText: null,
    _timerFrame: null,
    _timeLeft: 0,
    _combatDone: false,
    _failed: false,     // 超时未打完：宝箱已淡出
    _fadeTween: null,

    /** 地牢类型 → 宝箱等级（地牢 grade 即宝箱等级；奖励表见 combat-formulas.json treasureChest[F..A]） */
    _gradeFor(dungeonType) {
        const list = DungeonConfig.getDungeonList() || {};
        const g = (list[dungeonType] && list[dungeonType].grade) || 'D';
        return GRADES.includes(g) ? g : 'D';
    },

    /**
     * 精英战斗入场后调用：在场地中央摆放宝箱房 + 宝箱 + 倒计时
     * @param {string} dungeonType 地牢类型（决定宝箱等级与奖励表）
     * @param {Object} bounds CombatRoomSystem._roomBounds（场地中心）
     */
    setup(dungeonType, bounds) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        // 宝箱房预制按墙样式选择（样式表 chestPrefab，缺失回退「宝箱房」）
        const wallStyle = WallSystem.getWallStyle ? WallSystem.getWallStyle() : { chestPrefab: '宝箱房', straight: 'straight', gate: 'gate' };
        const prefabName = wallStyle.chestPrefab || '宝箱房';
        const prefabLib = getWallPrefabLibrary();
        const prefab = prefabLib[prefabName] || prefabLib['宝箱房'];
        if (!scene || !prefab || !Array.isArray(prefab.pieces) || !bounds) {
            console.warn('[ChestRoomSystem] setup 失败：预制缺失或场景未就绪', { prefabName, hasPrefab: !!prefab, hasScene: !!scene, hasBounds: !!bounds });
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
            if (p.tex === 'wall_gate' || p.tex === styleGateTex) {
                gateDefs.push({ p, seg: segsByPiece[i][0] });
                return;
            }
            const [a, b] = segsByPiece[i][0];
            const ay = a.y + oy, by = b.y + oy;
            // 线段整体在中心线上方 = 上臂（后墙 min，室内实体永远在前）；否则下臂（前墙 max 正确遮挡）
            const mode = Math.max(ay, by) < bounds.cy ? 'min' : 'max';
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
            // 图层沿用预制保存值（仅平移）——编辑器里摆好的图层关系原样生效；
            // 不再按 min/max 规则重算（重算会破坏预制图层，"导出后一片混乱"的根因）
            q.depth = (p.depth ?? p.y) + oy;
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

        // 4. 宝箱（关闭态贴图 chest_closed；grade 仅用于奖励表）
        const grade = this._gradeFor(dungeonType);
        const chestX = bounds.cx, chestY = bounds.cy;
        const sprite = scene.add.sprite(chestX, chestY, 'chest_closed');
        sprite.setOrigin(0.5, 0.75);
        sprite.setDisplaySize(192, 192 * (sprite.height / sprite.width)); // 宽 192 等比
        sprite.setDepth(chestY);
        this._chest = { sprite, x: chestX, y: chestY, opened: false, grade };

        // 5. 倒计时（白字黑描边，无底色；最后 10s 同款样式）
        this._timeLeft = COUNTDOWN_SEC;
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

    /**
     * 门墙放置：按预制件保存的变换（x/y/scale/flip/depth）原样放置，初始关门。
     * 不再做底边跨度重映射/跨长归一——编辑器里摆好的大小与图层原样生效；
     * 碰撞从件自身变换推导（_pieceBaseSegments + gateX 映射），与 wall-gate 同模型。
     */
    _placeGate(scene, p, ox, oy) {
        const g = WallSystem._geoForTex(p.tex) || ISO_WALL_GEO.gate;
        if (!scene.textures.exists(p.tex)) return;
        this._gateGeoKey = Object.keys(ISO_WALL_GEO).find(k => ISO_WALL_GEO[k].tex === p.tex) || 'gate';
        const piece = { ...p, x: p.x + ox, y: p.y + oy };
        const sprite = scene.add.sprite(piece.x, piece.y, p.tex, 0);
        sprite.setOrigin(0.5, 0.5);
        sprite.setScale(piece.scaleX ?? 1, piece.scaleY ?? piece.scaleX ?? 1);
        sprite.setFlipX(!!piece.flipX);

        // 碰撞：门两侧常开 + 门洞按开关启停（与 wall-gate 同模型）
        const [gA, gB] = WallSystem._pieceBaseSegments(piece)[0];
        const hole = isoGateHole(g);
        if (!hole) return;
        const ht = isoHalfThick(g);
        const baseAt = (tx) => WallSystem.texPointToWorld(piece, tx, g.base[0][1] + (tx - g.base[0][0]) * g.slope);
        const g1 = baseAt(hole[0]), g2 = baseAt(hole[1]);
        // 图层（2026-07-30 修复）：不再沿用预制保存值——宝箱房是低矮装饰围墙，实体应始终画在墙上
        // （右侧直墙件因贴图够不着天然如此；门墙贴图高、门区实体脚线落入其覆盖带会被门框盖住，
        //  "门墙左侧挡住玩家/怪物、右边正常"根因）。深度=底边最低点-显示墙高：凡脚线低于
        //  门墙贴图顶沿的实体深度必然更高（画在墙上），脚线更高的实体贴图本就够不着。
        //  顺带满足"门墙 depth 最低"手调规则（右侧件盖住门墙右端切边）。
        const hWall = (g.wallH || 290) * (piece.scaleY ?? 1);
        let gateDepth = Math.min(gA.y, gB.y) - hWall;
        // 接缝图层（2026-07-30 续）：上端邻墙（房内上侧墙，端点距 gA ≤40px——预制手摆
        // 端点有 ~25px 间隙，取不了 2px 精确共享）必须在门墙之下——"下>左"转角规则在门墙侧
        // 的同款：门墙盖住上方墙面的切边，否则上方墙面的裁切边压在门墙上（"上方墙面阻挡门墙"）。
        // 只拉 gA 上端邻墙，右侧件（gB 端）保持盖住门墙的手调规则不动。
        // 门区实体深度（≈脚线+10）仍高于该值，实体遮挡行为不受影响
        for (const q of WallSystem.isoVisuals) {
            const segs2 = WallSystem._pieceBaseSegments(q);
            const shares = segs2.some(seg => seg.some(pt => Math.hypot(pt.x - gA.x, pt.y - gA.y) < 40));
            if (shares && (q.depth ?? 0) + 0.1 > gateDepth) gateDepth = q.depth + 0.1;
        }
        sprite.setDepth(gateDepth);
        const segs = [
            { x1: gA.x, y1: gA.y, x2: g1.x, y2: g1.y, halfThick: ht, _chestGate: true },
            { x1: g2.x, y1: g2.y, x2: gB.x, y2: gB.y, halfThick: ht, _chestGate: true },
        ];
        const gateSeg = { x1: g1.x, y1: g1.y, x2: g2.x, y2: g2.y, halfThick: ht, _chestGate: true };
        if (WallSystem.isoSegments) {
            for (const s of segs) WallSystem.isoSegments.push(s);
            WallSystem.isoSegments.push(gateSeg); // 初始关门
        }
        this._gate = { sprite, segs, gateSeg, open: false };
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
                    if (gate.sprite && gate.sprite.active) gate.sprite.setFrame(Math.floor(tw.getValue()));
                },
            });
        }
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

        // 倒计时（战斗未完成前）
        if (!this._combatDone && !this._failed) {
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

    /** 开箱：换打开态贴图 + 音效 + 发奖 */
    _openChest(player) {
        const chest = this._chest;
        if (!chest || chest.opened) return;
        chest.opened = true;

        // 音效（视频原声）
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(CHEST_SOUND);
        }

        // 换打开态贴图（静态切换，无精灵图动画）
        if (chest.sprite) {
            chest.sprite.setTexture('chest_opened');
            chest.sprite.setDisplaySize(192, 192 * (chest.sprite.height / chest.sprite.width));
        }

        this._giveRewards(player, chest.grade);
    },

    /** 按等级宝箱事件奖励表发奖（50% 金币 / 25% 材料组 / 25% 宝箱怪位暂按金币兜底） */
    _giveRewards(player, grade) {
        const table = ((COMBAT_FORMULAS.universalEventRewards || {}).treasureChest) || {};
        const g = table[grade] || { gold: 500, materialDust: 200, tributeChance: 0 };
        const roll = Math.random();
        let items;
        if (roll < 0.5) {
            items = [{ type: 'gold', count: g.gold }];
        } else if (roll < 0.75) {
            items = [
                { type: 'stone', count: 1 },
                { type: 'reforge_ticket', count: 1 },
                { type: 'dust', count: g.materialDust },
            ];
        } else {
            items = [{ type: 'gold', count: g.gold }];
        }
        if (BossRewardSystem && BossRewardSystem.rewardNode) {
            BossRewardSystem.rewardNode.giveReward(player, items);
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
            if (this._gate.sprite) this._gate.sprite.destroy();
            this._gate = null;
        }
        if (this._chest) {
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
        this._timeLeft = 0;
    },
};
