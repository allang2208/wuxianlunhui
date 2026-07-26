import { CONFIG } from '../config/config.js';
import { getWallPrefabLibrary } from './wall-prefabs.js';

// ===== 等距斜墙贴图几何（贴图像素空间，wall-asset-prep.py 产出 + 拼装模拟器实测校准）=====
// base: 底边线全跨度（含端帽）；face: 正面墙底边跨度（不含端帽，拼接吸附/碰撞用）；
// vertex: 转角接合点；tipX: 臂尖底边点；wallH: 底边→顶沿墙高；slope: 贴图底边固有斜率
const ISO_WALL_GEO = {
    diag:   { tex: 'wall_diag', w: 1600, h: 1315, base: [[0, 625.6], [1600, 1409.2]], face: [[150, 699.1], [1450, 1335.7]], wallH: 824, slope: 0.4897 },
    straight: { tex: 'wall_straight', w: 1600, h: 1383, base: [[5, 617], [1594, 1418]], face: [[16, 622], [1516, 1379]], wallH: 691, slope: 0.5048, editor: '直墙·新' },
    gate: { tex: 'wall_gate', w: 640, h: 641, frames: 16, base: [[4, 294.0], [634, 611.3]], face: [[4, 294.0], [634, 611.3]], gateX: [265, 360], wallH: 290, slope: 0.5037, editor: '门墙' },
    top:    { tex: 'wall_corner_top', w: 1600, h: 843, vertex: [854, 478], tipL: [250, 750], tipR: [1350, 640], wallH: 493, slope: 0.482 },
    bottom: { tex: 'wall_corner_bottom', w: 1600, h: 751, vertex: [850, 705], tipL: [130, 390], tipR: [1450, 380], wallH: 427, slope: 0.492 },
    left:   { tex: 'wall_corner_left', w: 1343, h: 1600, vertex: [50, 1020], tipUpper: [1180, 240], tipLower: [1326, 1500], wallH: 520, slope: 0.42 },
    right:  { tex: 'wall_corner_right', w: 1600, h: 1517, vertex: [1590, 930], tipUpper: [150, 300], tipLower: [310, 1450], wallH: 500, slope: 0.44 },
    // 沼泽地墙（2026-07-25 素材管线：泛洪抠图+水印 inpaint+两端锥形裁切+腐蚀 2px 去颜色污染+白边压暗）
    swamp_straight: { tex: 'swamp_wall_straight', w: 1419, h: 1558, base: [[0, 775.0], [1418, 1583.0]], face: [[28, 791.0], [1389, 1566.5]], wallH: 799.2, slope: 0.5698, editor: '沼泽柴墙' },
    // 沼泽地门闸（gate.mp4 16 帧已反转：首帧=关闭(藤蔓封门)、末帧=打开；tools/swamp-gate-geo.json）
    swamp_gate: { tex: 'swamp_gate', w: 640, h: 612, frames: 16, base: [[5, 275.0], [634, 632.8]], face: [[5, 275.0], [634, 632.8]], gateX: [248, 384], wallH: 301.1, slope: 0.5689, editor: '沼泽藤门' },
};

// 地牢墙样式表（key = dungeonType；新地牢在此登记。值 = ISO_WALL_GEO 键 + 配套资源）
// corners（可选）：四顶点夹角预制名（摆墙编辑器手工拼装）——登记后菱形房间四角用预制构建，缺省回退程序化转角臂
const ISO_WALL_STYLES = {
    default: { straight: 'straight', gate: 'gate', chestPrefab: '宝箱房', gateSound: 'assets/sounds/environment/gate.mp3' },
    swamp: {
        straight: 'swamp_straight', gate: 'swamp_gate', chestPrefab: '沼泽宝箱房', gateSound: 'assets/sounds/environment/swamp_gate.mp3',
        corners: { top: '沼泽墙上夹角', bottom: '沼泽下夹角', left: '沼泽墙左夹角', right: '沼泽墙右夹角' },
    },
};
const ISO_WALL_HEIGHT = 190;    // 目标墙高（世界像素，底边→顶沿）
const ISO_TILE_OVERLAP = 40;    // 瓦片向转角臂内侵入（覆盖式拼接）
// 地板线视觉斜率：实测 blackbrick 29.7° / hub_brick 30.7°，取标准 30°（tan30°=0.5774）
// 注意：引擎碰撞投影 PERSPECTIVE_SCALE_Y=0.5(26.57°) 不可见，不参与视觉对齐
const FLOOR_SLOPE = 0.5774;

/** 角度补偿：贴图固有斜率 → 显示斜率对齐地板线（scaleY 比例系数） */
export function slopeFixOf(geo) {
    return FLOOR_SLOPE / (geo && geo.slope ? geo.slope : 0.49);
}
// 转角图层顺序（由前到后）：下 > 左 > 右 > 上
const ISO_CORNER_DEPTH_BIAS = { top: 0, right: 1, left: 2, bottom: 3 };

const WallSystem = {
    walls: [],
    isoVisuals: [],  // 等距斜墙视觉件（仅渲染，碰撞由 walls 中的阶梯矩形承担）
    mazeEndY: 0,
    _wallHeight: 60,
    _wallStyleKey: 'default', // 当前墙样式（dungeonType；DungeonMapSystem 入场设置、离场复位）
    _phaserVisualsEnabled: false,

    /** 设置当前墙样式（key = dungeonType，无登记回退 default） */
    setWallStyle(key) {
        this._wallStyleKey = ISO_WALL_STYLES[key] ? key : 'default';
    },
    /** 当前样式的几何键 { straight, gate } */
    getWallStyleGeos() {
        return ISO_WALL_STYLES[this._wallStyleKey] || ISO_WALL_STYLES.default;
    },
    /** 当前样式完整条目（straight/gate 几何键 + chestPrefab 宝箱房预制名 + gateSound 门闸音效） */
    getWallStyle() {
        return ISO_WALL_STYLES[this._wallStyleKey] || ISO_WALL_STYLES.default;
    },
    init(ww, wh) {
        this.walls = [];
        this.isoVisuals = [];
        this.isoSegments = []; // 新场景全清（门闸线段由门实体放置后重新注册）
        this.trees = [];
        // 主神空间不再生成迷宫（开阔测试场地；maze-generator.js 保留备用）
        this.mazeEndY = 0;
        // ===== Phaser 墙壁同步 =====
        this._syncWallsToPhaser();
    },
    /**
     * 将墙壁同步到 Phaser 的 staticGroup
     * 在 init() 和 addTree() 时调用
     */
    _syncWallsToPhaser() {
        const phaserScene = window.__phaserScene;
        if (!phaserScene) return;
        // 清除旧墙壁（如果存在）
        if (phaserScene.walls && phaserScene.walls.countActive(true) > 0) {
            phaserScene.walls.clear(true, true);
        }
        // 清除旧视觉墙壁
        if (phaserScene.visualWalls) {
            phaserScene.visualWalls.clear(true, true);
        }
        // 创建矩形墙壁物理体 + 视觉精灵（noVisual 墙只建物理体，如静态 NPC 底座障碍）
        for (const w of this.walls) {
            const wall = phaserScene.add.rectangle(w.x + w.w / 2, w.y + w.h / 2, w.w, w.h, 0x000000, 0);
            phaserScene.physics.add.existing(wall, true); // true = static
            phaserScene.walls.add(wall);

            if (phaserScene.visualWalls && !w.noVisual) {
                this._createWallVisual(phaserScene, w);
            }
        }

        // 重新同步树木（包括视觉精灵）
        this._syncTreesToPhaser();
        // 等距斜墙视觉件（isoVisuals）
        this._renderIsoVisuals(phaserScene);
        // 设置碰撞关系
        phaserScene.setupColliders();
        this._phaserVisualsEnabled = true;
    },

    /**
     * 创建墙壁视觉精灵（水平墙用 wall.png，垂直墙用 wall-2.png）
     * 水平墙：显示完整墙面，Sprite 拉伸覆盖；垂直墙：只看顶部砖块
     * 贴图放大一倍（visualH ×2）；水平/垂直拼接处无缝；尽头半圆角，拼接处不处理
     * 图层：depth = 底部 Y 坐标（与地面相交处遮挡截断）
     */
    _createWallVisual(phaserScene, w) {
        // 根据宽高比判断方向：w > h 为水平墙，否则为垂直墙
        const isHorizontal = w.w >= w.h;
        const textureKey = isHorizontal ? 'wall_horizontal' : 'wall_vertical';
        if (!phaserScene.textures.exists(textureKey)) {
            // 回退到旧的程序化纹理
            const face = phaserScene.add.sprite(w.x + w.w / 2, w.y + w.h, 'wall_face');
            face.setOrigin(0.5, 1);
            face.setDisplaySize(w.w, w.height || 60);
            face.setDepth(w.y + w.h);
            phaserScene.visualWalls.add(face);
            w.visualSprite = face;
            return;
        }

        const t = isHorizontal ? w.h : w.w; // 墙厚
        const halfT = t / 2;

        // 检测两端是否有相邻墙壁（拼接），有则不收圆角并向外延伸半厚消除缝隙
        let leftConnected = false, rightConnected = false, topConnected = false, bottomConnected = false;
        if (isHorizontal) {
            leftConnected = this._hasAdjacentWall(w.x - halfT, w.y + halfT, w.x, w.y + halfT, w);
            rightConnected = this._hasAdjacentWall(w.x + w.w, w.y + halfT, w.x + w.w + halfT, w.y + halfT, w);
        } else {
            topConnected = this._hasAdjacentWall(w.x + halfT, w.y - halfT, w.x + halfT, w.y, w);
            bottomConnected = this._hasAdjacentWall(w.x + halfT, w.y + w.h, w.x + halfT, w.y + w.h + halfT, w);
        }

        if (isHorizontal) {
            // 水平墙：贴图放大 3 倍（visualH ×3），左右拼接处延伸半厚
            // 使用 canvas 裁剪后的贴图（wall_horizontal_cropped），去除透明区域让墙面直接接地
            const visualH = (w.height || 60) * 3;
            const extL = leftConnected ? halfT : 0;
            const extR = rightConnected ? halfT : 0;
            const sx = w.x - extL;
            const sw = w.w + extL + extR;
            const croppedKey = phaserScene.textures.exists('wall_horizontal_cropped') ? 'wall_horizontal_cropped' : textureKey;
            const sprite = phaserScene.add.sprite(
                sx + sw / 2,
                w.y + w.h - visualH / 2,
                croppedKey
            );
            sprite.setDisplaySize(sw, visualH);
            sprite.setDepth(w.y + w.h);
            phaserScene.visualWalls.add(sprite);
            w.visualSprite = sprite;

            // 尽头半圆角（只在未拼接的端点）
            if (!leftConnected) this._drawWallCap(phaserScene, w.x, w.y + w.h, halfT, 'left', w);
            if (!rightConnected) this._drawWallCap(phaserScene, w.x + w.w, w.y + w.h, halfT, 'right', w);
        } else {
            // 垂直墙：贴图放大 3 倍（w.w ×3 显示宽度），上下拼接处延伸半厚
            // 使用 canvas 裁剪后的贴图（wall_vertical_cropped），去除两侧透明区域让砖块列直接占满
            const visualW = w.w * 3;
            const extT = topConnected ? halfT : 0;
            const extB = bottomConnected ? halfT : 0;
            const sy = w.y - extT;
            const sh = w.h + extT + extB;
            const croppedKey = phaserScene.textures.exists('wall_vertical_cropped') ? 'wall_vertical_cropped' : textureKey;
            const sprite = phaserScene.add.sprite(
                w.x + w.w / 2,
                sy + sh / 2,
                croppedKey
            );
            sprite.setDisplaySize(visualW, sh);
            // 透视规则：与水平墙相交时，垂直墙在上方相交点之上（盖住水平墙），在下方相交点之下（被水平墙盖住）
            // 上方相交（topConnected）：depth = 水平墙 depth + 1（垂直在上）
            // 下方相交（bottomConnected）：depth = 水平墙 depth - 1（水平在上）
            let depth = w.y + w.h;
            if (topConnected) {
                const hWall = this._findAdjacentHorizontalWall(w.x + halfT, w.y - halfT, w.x + halfT, w.y, w);
                if (hWall) depth = hWall.y + hWall.h + 1;
            } else if (bottomConnected) {
                const hWall = this._findAdjacentHorizontalWall(w.x + halfT, w.y + w.h, w.x + halfT, w.y + w.h + halfT, w);
                if (hWall) depth = hWall.y + hWall.h - 1;
            }
            sprite.setDepth(depth);
            phaserScene.visualWalls.add(sprite);
            w.visualSprite = sprite;

            // 尽头半圆角（只在未拼接的端点）
            if (!topConnected) this._drawWallCap(phaserScene, w.x + w.w / 2, w.y, halfT, 'top', w);
            if (!bottomConnected) this._drawWallCap(phaserScene, w.x + w.w / 2, w.y + w.h, halfT, 'bottom', w);
        }
    },

    // ===== 等距斜墙：通用件模型 =====
    // 通用件: { tex, x, y, scaleX, scaleY, flipX, flipY, depth }（origin 固定 0.5,0.5）
    // 视觉件存 isoVisuals；碰撞由 rebuildIsoCollision() 按件底边线段自动生成阶梯矩形（_iso 标记）
    // 墙壁编辑器（wall-editor.js）直接编辑通用件，保存为预制组合（data/wall-prefabs.json）

    /**
     * 生成菱形（等距 2:1）房间的默认布局（通用件；无预制时作为兜底）
     * 四角转角贴图 + 四边直墙瓦片（覆盖式拼接）；出入口在右下边
     */
    buildDiamondRoom(cx, cy, rx, ry, opts = {}) {
        const doorEdge = opts.doorEdge || 'RB';
        const doorW = opts.doorWidth ?? 100;
        const height = opts.height ?? ISO_WALL_HEIGHT;
        const T = { x: cx, y: cy - ry }, R = { x: cx + rx, y: cy }, B = { x: cx, y: cy + ry }, L = { x: cx - rx, y: cy };
        // 四角转角（depth 偏置在 _addCornerPiece 按 下>左>右>上 规则）
        this._addCornerPiece('top', T, height);
        this._addCornerPiece('right', R, height);
        this._addCornerPiece('left', L, height);
        this._addCornerPiece('bottom', B, height);
        // 四边：直墙瓦片（臂尖之间 + 向转角臂内侵入 OVERLAP）
        this._buildIsoEdge(T, L, 'top', 'tipL', 'left', 'tipUpper', true, 0, height);
        this._buildIsoEdge(T, R, 'top', 'tipR', 'right', 'tipUpper', false, 0, height);
        this._buildIsoEdge(L, B, 'left', 'tipLower', 'bottom', 'tipL', false, 0, height);
        this._buildIsoEdge(R, B, 'right', 'tipLower', 'bottom', 'tipR', true, doorEdge === 'RB' ? doorW : 0, height);
    },

    /** 单条菱形边：Va->Vb（Va 为上端/右端顶点），cornerA/cornerB 为两端转角，flip 为 "/" 方向边 */
    _buildIsoEdge(Va, Vb, cornerA, tipA, cornerB, tipB, flip, doorW, height) {
        // 瓦片跨度：两端转角臂尖之间，各向转角臂内收回 OVERLAP（覆盖式拼接）
        const pa = this._cornerTipWorld(cornerA, Va, tipA, height);
        const pb = this._cornerTipWorld(cornerB, Vb, tipB, height);
        const P = this._shrinkPoint(pa, Va, ISO_TILE_OVERLAP);
        const Q = this._shrinkPoint(pb, Vb, ISO_TILE_OVERLAP);
        const dx = Q.x - P.x, dy = Q.y - P.y;
        const segLen = Math.hypot(dx, dy);
        if (segLen < 20) return;
        const g = ISO_WALL_GEO.diag;
        const texLen = Math.hypot(g.base[1][0] - g.base[0][0], g.base[1][1] - g.base[0][1]);
        const tileLen = texLen * (height / g.wallH);
        const n = Math.max(1, Math.round(segLen / tileLen));
        const step = segLen / n;
        const ux = dx / segLen, uy = dy / segLen;
        // 门中心换算到瓦片跨度局部坐标：整条边中点弧长 − 跨度起点的弧长位置
        const fullLen = Math.hypot(Vb.x - Va.x, Vb.y - Va.y);
        const dP = Math.hypot(P.x - Va.x, P.y - Va.y);
        const doorAt = fullLen / 2 - dP;
        for (let i = 0; i < n; i++) {
            const a = i * step, b = (i + 1) * step;
            // 与门洞区间求差，保留可见子段（门洞恰好 doorW 宽，不吞整瓦）
            const parts = doorW
                ? [[a, Math.min(b, doorAt - doorW / 2)], [Math.max(a, doorAt + doorW / 2), b]]
                : [[a, b]];
            for (const [sa, sb] of parts) {
                if (sb - sa < 5) continue;
                this._addSegPiece(
                    { x: P.x + ux * sa, y: P.y + uy * sa },
                    { x: P.x + ux * sb, y: P.y + uy * sb },
                    flip
                );
            }
        }
    },

    /** 直墙瓦片通用件：正面墙底边(face)映射到世界线段 A->B（独立 sx/sy 精确贴合），flip 为 "/" 方向 */
    _addSegPiece(A, B, flip, geoKey = 'diag', depthMode = 'max', depthBias = 0) {
        const g = ISO_WALL_GEO[geoKey] || ISO_WALL_GEO.diag;
        const [p0, p1] = g.face || g.base;
        let sx, sy, x0, y0;
        if (!flip) {
            sx = (B.x - A.x) / (p1[0] - p0[0]);
            sy = (B.y - A.y) / (p1[1] - p0[1]);
            x0 = A.x - p0[0] * sx;
            y0 = A.y - p0[1] * sy;
        } else {
            // flip（"/" 方向）：flipX 为 quad 内镜像，贴图点 p 落在 x0 + (w-p.x)*sx
            // 目标：p0(贴图左端) -> A（上端），p1(贴图右端) -> B（下端）
            sx = (A.x - B.x) / (p1[0] - p0[0]);
            sy = (B.y - A.y) / (p1[1] - p0[1]);
            x0 = A.x - (g.w - p0[0]) * sx;
            y0 = A.y - p0[1] * sy;
        }
        // 深度规则：后墙(室内朝镜头)取 min 底边 y 让室内实体永远在前；前墙取 max 正确遮挡
        const depth = (depthMode === 'min' ? Math.min(A.y, B.y) : Math.max(A.y, B.y)) + depthBias;
        this.isoVisuals.push({
            tex: g.tex,
            x: x0 + g.w * Math.abs(sx) / 2,
            y: y0 + g.h * sy / 2,
            scaleX: Math.abs(sx), scaleY: sy,
            flipX: !!flip, flipY: false,
            depth,
        });
    },

    /**
     * 运行时菱形墙构建（僵尸地牢战斗房/Boss 场地）：四顶点转角点对点 + 四边续接
     * 深度规则：上顶点两臂后墙 min、下顶点两臂前墙 max、左/右顶点上臂 min 下臂 max
     * 只写 isoVisuals；调用方随后 rebuildIsoCollision() 生成阶梯碰撞
     */
    buildIsoDiamondWalls(cx, cy, rx, ry, opts = {}) {
        const height = opts.height ?? ISO_WALL_HEIGHT;
        const geoKey = opts.geoKey || this.getWallStyleGeos().straight;
        const g = ISO_WALL_GEO[geoKey] || ISO_WALL_GEO.straight;
        const s = height / g.wallH;
        const sy = s * slopeFixOf(g);
        const faceDx = (g.face[1][0] - g.face[0][0]) * s;
        const faceDy = (g.face[1][1] - g.face[0][1]) * sy;
        const faceLen = Math.hypot(faceDx, faceDy);
        const T = { x: cx, y: cy - ry }, R = { x: cx + rx, y: cy }, B = { x: cx, y: cy + ry }, L = { x: cx - rx, y: cy };

        // 放一件：face 起点(上端)在 S，向下延伸；返回远端点
        const startAt = (S, flip, mode, bias = 0) => {
            const A = { x: S.x, y: S.y };
            const B = flip ? { x: S.x - faceDx, y: S.y + faceDy } : { x: S.x + faceDx, y: S.y + faceDy };
            this._addSegPiece(A, B, flip, geoKey, mode, bias);
            return B;
        };
        // 放一件：face 终点(下端)在 E，向上延伸；返回远端点
        const endAt = (E, flip, mode, bias = 0) => {
            const B = { x: E.x, y: E.y };
            const A = flip ? { x: E.x + faceDx, y: E.y - faceDy } : { x: E.x - faceDx, y: E.y - faceDy };
            this._addSegPiece(A, B, flip, geoKey, mode, bias);
            return A;
        };
        // 臂远端之间续接（定长定高瓦片：scale 固定，8px 叠合，绝不拉伸——
        // 均匀拉伸件与转角件并排会一大一小、中间突出（僵尸砖纹不可感知，沼泽柴墙材质随机格外显眼）；
        // 尾端超出 Q 的部分由下一顶点的转角臂（+5 偏置）盖住，只叠不缺）
        const edgeFill = (P, Q, flip, mode) => {
            const dx = Q.x - P.x, dy = Q.y - P.y;
            const len = Math.hypot(dx, dy);
            if (len < 4) return;
            const ux = dx / len, uy = dy / len;
            const step = faceLen - 8; // 步进 = 瓦长 - 叠合量
            const n = Math.max(1, Math.ceil((len + 8) / step));
            for (let i = 0; i < n; i++) {
                const A = { x: P.x + ux * (step * i - 8), y: P.y + uy * (step * i - 8) };
                const B = { x: A.x + ux * faceLen, y: A.y + uy * faceLen };
                this._addSegPiece(A, B, flip, geoKey, mode);
            }
        };

        // 四角（点对点）：上=后墙 min、下=前墙 max、左/右=上臂 min 下臂 max
        // 转角臂 +5 深度偏置：顶点侧盖住续接件（预制转角文档化同款规则）——
        // 纹理随机的墙（沼泽柴墙）若让续接件盖住转角臂，贴图切边会暴露在接缝上；
        // +5 为文档化安全值（不得加大：更大偏置会误挡顶点下方高个实体，+260 教训）
        const CB = 5;
        // 样式登记了夹角预制则四角用预制构建（手摆件）；缺失/无效逐个回退程序化转角臂。
        // 一间房随机只保留一个带门夹角，其余角的门件改铺直墙
        const styleCorners = (this.getWallStyle ? this.getWallStyle() : {}).corners || null;
        const gateCorner = ['top', 'bottom', 'left', 'right'][Math.floor(Math.random() * 4)];
        const cT = styleCorners && styleCorners.top ? this._placeCornerPrefab(styleCorners.top, T, CB, 'x', 'top', gateCorner === 'top') : null;
        const cB = styleCorners && styleCorners.bottom ? this._placeCornerPrefab(styleCorners.bottom, B, CB, 'x', 'bottom', gateCorner === 'bottom') : null;
        const cL = styleCorners && styleCorners.left ? this._placeCornerPrefab(styleCorners.left, L, CB, 'y', 'left', gateCorner === 'left') : null;
        const cR = styleCorners && styleCorners.right ? this._placeCornerPrefab(styleCorners.right, R, CB, 'y', 'right', gateCorner === 'right') : null;
        const tL = cT ? cT.neg : startAt(T, true, 'min', CB);   // 上顶点左臂（向 down-left）
        const tR = cT ? cT.pos : startAt(T, false, 'min', CB);  // 上顶点右臂（向 down-right）
        const bL = cB ? cB.neg : endAt(B, false, 'max', CB);    // 下顶点左臂（从 up-left 来）
        const bR = cB ? cB.pos : endAt(B, true, 'max', CB);     // 下顶点右臂（从 up-right 来）
        const lU = cL ? cL.neg : endAt(L, true, 'min', CB);     // 左顶点上臂（后墙，从 up-right 来）
        const lD = cL ? cL.pos : startAt(L, false, 'max', CB);  // 左顶点下臂（前墙，向 down-right）
        const rU = cR ? cR.neg : endAt(R, false, 'min', CB);    // 右顶点上臂（后墙，从 up-left 来）
        const rD = cR ? cR.pos : startAt(R, true, 'max', CB);   // 右顶点下臂（前墙，向 down-left）

        // 四边续接
        edgeFill(tL, lU, true, 'min');   // T-L 边（后墙）
        edgeFill(tR, rU, false, 'min');  // T-R 边（后墙）
        edgeFill(lD, bL, false, 'max');  // L-B 边（前墙）
        edgeFill(rD, bR, true, 'max');   // R-B 边（前墙）
    },

    /**
     * 预制夹角放置（样式 corners 登记时由 buildIsoDiamondWalls 调用）：
     * 找跨件共享端点=顶点，整体平移到菱形顶点（深度同步平移+偏置，保留预制内部图层关系）。
     * @param {string} axis 'x'（上/下顶点，臂分左右）| 'y'（左/右顶点，臂分上下）
     * @param {string} cornerKind 'top'|'bottom'|'left'|'right'（门件改铺直墙时的深度规则用）
     * @param {boolean} allowGate 本夹角是否保留门件（一间房只留一个带门夹角，其余门件改铺直墙）
     * @returns {{neg:{x,y}, pos:{x,y}}|null} 两臂最远端（边续接锚点）；预制缺失/顶点找不到/臂不全返回 null（调用方回退程序化转角）
     */
    _placeCornerPrefab(prefabName, V, depthBias, axis, cornerKind, allowGate = true) {
        const lib = getWallPrefabLibrary ? getWallPrefabLibrary() : null;
        const prefab = lib && lib[prefabName];
        if (!prefab || !Array.isArray(prefab.pieces) || prefab.pieces.length < 2) return null;
        const segs = prefab.pieces.map(p => this._pieceBaseSegments(p)[0]);
        if (segs.some(s => !s)) return null;
        // 顶点：跨件共享端点（≤30px 聚类），取离预制组中心最近的
        const pts = [];
        segs.forEach((s, i) => { pts.push({ p: s[0], i }, { p: s[1], i }); });
        let vertex = null, bestD = Infinity;
        for (let a = 0; a < pts.length; a++) {
            for (let b = a + 1; b < pts.length; b++) {
                if (pts[a].i === pts[b].i) continue;
                const d = Math.hypot(pts[a].p.x - pts[b].p.x, pts[a].p.y - pts[b].p.y);
                if (d > 30) continue;
                const mx = (pts[a].p.x + pts[b].p.x) / 2, my = (pts[a].p.y + pts[b].p.y) / 2;
                const dc = Math.hypot(mx - (prefab.cx || mx), my - (prefab.cy || my));
                if (dc < bestD) { bestD = dc; vertex = { x: mx, y: my }; }
            }
        }
        if (!vertex) return null;
        const ox = V.x - vertex.x, oy = V.y - vertex.y;
        // 两臂最远端：按 axis 分 neg/pos 两侧，每侧取离顶点最远的端点
        let neg = null, pos = null;
        segs.forEach((s) => {
            for (const pt of s) {
                // 近顶点端点跳过（是接合点）
                if (Math.hypot(pt.x - vertex.x, pt.y - vertex.y) < 40) continue;
                const t = { x: pt.x + ox, y: pt.y + oy };
                const d = axis === 'x' ? pt.x - vertex.x : pt.y - vertex.y;
                const dist = Math.hypot(pt.x - vertex.x, pt.y - vertex.y);
                if (d < 0) { if (!neg || dist > neg._d) neg = { ...t, _d: dist }; }
                else { if (!pos || dist > pos._d) pos = { ...t, _d: dist }; }
            }
        });
        if (!neg || !pos) return null;
        // 校验通过才放置。深度按房间规则重算（与程序化转角一致的 min/max + 偏置）——
        // 编辑器的绝对深度只用于保留预制内部相对顺序（0.1/级）；
        // 直接平移编辑器深度会导致前墙件深度低于实体（下夹角实体画在墙上的根因）
        const styleGeos = this.getWallStyleGeos ? this.getWallStyleGeos() : { straight: 'straight', gate: 'gate' };
        const styleGateTex = (ISO_WALL_GEO[styleGeos.gate] || ISO_WALL_GEO.gate).tex;
        const ordered = prefab.pieces.map((p, i) => ({ i, d: p.depth ?? p.y })).sort((m, n) => m.d - n.d);
        const orderEps = new Map(ordered.map((m, rank) => [m.i, rank * 0.1]));
        const modeOf = (A, B) => cornerKind === 'top' ? 'min'
            : cornerKind === 'bottom' ? 'max'
            : ((A.y + B.y) / 2 < V.y ? 'min' : 'max');
        prefab.pieces.forEach((p, i) => {
            const seg = segs[i];
            const A = { x: seg[0].x + ox, y: seg[0].y + oy };
            const B = { x: seg[1].x + ox, y: seg[1].y + oy };
            const mode = modeOf(A, B);
            const ruleDepth = (mode === 'min' ? Math.min(A.y, B.y) : Math.max(A.y, B.y)) + depthBias;
            if (!allowGate && p.tex === styleGateTex) {
                // 一间房只保留一个带门夹角：其余角的门件改铺直墙（同线段映射 + 转角深度规则）
                this._addSegPiece(A, B, !!p.flipX, styleGeos.straight, mode, depthBias);
                this.isoVisuals[this.isoVisuals.length - 1]._corner = true;
                return;
            }
            const q = { ...p, x: p.x + ox, y: p.y + oy, depth: ruleDepth + orderEps.get(i), _corner: true };
            delete q._sprite;
            this.isoVisuals.push(q);
        });
        return { neg: { x: neg.x, y: neg.y }, pos: { x: pos.x, y: pos.y } };
    },

    /** 转角通用件：接合点锚定到顶点，等比缩放到目标墙高；depth = 顶点 y + 顺序偏置（下>左>右>上） */
    _addCornerPiece(corner, V, height) {
        const g = ISO_WALL_GEO[corner];
        const s = height / g.wallH;
        this.isoVisuals.push({
            tex: g.tex,
            x: V.x - g.vertex[0] * s + g.w * s / 2,
            y: V.y - g.vertex[1] * s + g.h * s / 2,
            scaleX: s, scaleY: s,
            flipX: false, flipY: false,
            depth: V.y + 5 + (ISO_CORNER_DEPTH_BIAS[corner] || 0),
        });
    },

    /** 转角臂尖的世界坐标（顶点 + 贴图偏移 × 高度缩放） */
    _cornerTipWorld(corner, V, tipKey, height) {
        const g = ISO_WALL_GEO[corner];
        const s = height / g.wallH;
        const t = g[tipKey];
        return { x: V.x + (t[0] - g.vertex[0]) * s, y: V.y + (t[1] - g.vertex[1]) * s };
    },

    /** 把点 P 向顶点 V 方向收回 amt */
    _shrinkPoint(P, V, amt) {
        const dx = P.x - V.x, dy = P.y - V.y;
        const d = Math.hypot(dx, dy);
        if (!d) return { x: P.x, y: P.y };
        return { x: P.x - dx / d * amt, y: P.y - dy / d * amt };
    },

    /** 渲染 isoVisuals 全部通用件到 visualWalls 组（回写 p._sprite 供编辑器引用） */
    _renderIsoVisuals(phaserScene) {
        if (!this.isoVisuals || !phaserScene.visualWalls) return;
        for (const p of this.isoVisuals) this._placeIsoPiece(phaserScene, p);
    },

    /** 通用件渲染：origin 0.5,0.5 + scale/flip/depth 直接应用 */
    _placeIsoPiece(phaserScene, p) {
        if (!phaserScene.textures.exists(p.tex)) return;
        const sp = phaserScene.add.sprite(p.x, p.y, p.tex);
        sp.setOrigin(0.5, 0.5);
        sp.setScale(p.scaleX ?? 1, p.scaleY ?? p.scaleX ?? 1);
        sp.setFlipX(!!p.flipX);
        sp.setFlipY(!!p.flipY);
        sp.setDepth(p.depth ?? p.y);
        phaserScene.visualWalls.add(sp);
        p._sprite = sp;
    },

    /** 贴图键 → 几何配置 */
    _geoForTex(tex) {
        for (const k of Object.keys(ISO_WALL_GEO)) {
            if (ISO_WALL_GEO[k].tex === tex) return ISO_WALL_GEO[k];
        }
        return null;
    },

    /** 贴图内坐标 → 世界坐标（应用通用件的 origin/scale/flip 变换） */
    texPointToWorld(p, tx, ty) {
        const g = this._geoForTex(p.tex);
        if (!g) return { x: p.x, y: p.y };
        let u = tx - g.w / 2, v = ty - g.h / 2;
        if (p.flipX) u = -u;
        if (p.flipY) v = -v;
        return { x: p.x + u * (p.scaleX ?? 1), y: p.y + v * (p.scaleY ?? p.scaleX ?? 1) };
    },

    /** 件底边线段（世界坐标，碰撞用）：直墙=正面墙底边(face，不含端帽)；转角=顶点→两臂尖 */
    _pieceBaseSegments(p) {
        const key = Object.keys(ISO_WALL_GEO).find(k => ISO_WALL_GEO[k].tex === p.tex);
        const g = key ? ISO_WALL_GEO[key] : null;
        if (!g) return [];
        const base = g.face || g.base;
        if (base) return [[this.texPointToWorld(p, base[0][0], base[0][1]), this.texPointToWorld(p, base[1][0], base[1][1])]];
        const tips = [g.tipL, g.tipR, g.tipUpper, g.tipLower].filter(Boolean);
        return tips.map(t => [this.texPointToWorld(p, g.vertex[0], g.vertex[1]), this.texPointToWorld(p, t[0], t[1])]);
    },

    /** 按全部通用件重建阶梯碰撞矩形（编辑器拖动后调用；静态墙不动） */
    rebuildIsoCollision() {
        this.walls = this.walls.filter(w => !w._iso);
        // 门闸线段（_gate 房间门 / _chestGate 宝箱房门）由门实体自管生命周期，
        // 重建必须保留——此前全量清空会把入场门/宝箱房门的碰撞一并抹掉（门洞可穿的根因）
        this.isoSegments = (this.isoSegments || []).filter(s => s._gate || s._chestGate);
        for (const p of this.isoVisuals) this._addPieceCollision(p);
    },

    /** 单件碰撞：底边线段 → 线段模型（精确滑动）+ 每 30px 一块 36×20 阶梯矩形（寻路/小地图） */
    _addPieceCollision(p) {
        for (const [a, b] of this._pieceBaseSegments(p)) {
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            if (len < 10) continue;
            this.isoSegments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, halfThick: 10 });
            const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
            for (let d = 15; d < len; d += 30) {
                const px = a.x + ux * d, py = a.y + uy * d;
                this.walls.push({ x: px - 18, y: py - 10, w: 36, h: 20, height: 60, noVisual: true, _iso: true });
            }
        }
    },

    /** 查找与指定线段相交的水平墙壁（用于透视深度调整） */
    _findAdjacentHorizontalWall(x1, y1, x2, y2, self) {
        const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
        for (const w of this.walls) {
            if (w === self) continue;
            if (w.w < w.h) continue; // 只找水平墙（w >= h）
            if (maxX >= w.x && minX <= w.x + w.w && maxY >= w.y && minY <= w.y + w.h) {
                return w;
            }
        }
        return null;
    },

    /** 检测指定线段范围内是否有其他墙壁（拼接判定） */
    _hasAdjacentWall(x1, y1, x2, y2, self) {
        for (const w of this.walls) {
            if (w === self) continue;
            // 检查线段是否与墙壁矩形相交（简单的 AABB 相交检测）
            const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
            const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
            if (maxX >= w.x && minX <= w.x + w.w && maxY >= w.y && minY <= w.y + w.h) {
                return true;
            }
        }
        return false;
    },

    /** 在墙壁尽头画半圆角（graphics 半圆，与墙体贴图颜色一致） */
    _drawWallCap(phaserScene, cx, cy, r, side, wallRef) {
        const g = phaserScene.add.graphics();
        const color = 0x3a3a3a; // 与 wall.png 深色砖块接近
        g.fillStyle(color, 1);
        // 根据方向画半圆
        g.beginPath();
        if (side === 'left') {
            g.arc(cx, cy, r, Math.PI / 2, Math.PI * 1.5);
        } else if (side === 'right') {
            g.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2);
        } else if (side === 'top') {
            g.arc(cx, cy, r, Math.PI, 0);
        } else { // bottom
            g.arc(cx, cy, r, 0, Math.PI);
        }
        g.closePath();
        g.fillPath();
        g.setDepth(cy);
        phaserScene.visualWalls.add(g);
        if (!wallRef._capSprites) wallRef._capSprites = [];
        wallRef._capSprites.push(g);
    },
    /**
     * 将树木同步到 Phaser 的 staticGroup
     */
    _syncTreesToPhaser() {
        const phaserScene = window.__phaserScene;
        if (!phaserScene) return;
        if (phaserScene.visualTrees) {
            phaserScene.visualTrees.clear(true, true);
        }
        // 创建树木圆形碰撞体（用不可见圆形表示），使用独立的 collisionRadius
        for (const t of this.trees) {
            const tree = phaserScene.add.circle(t.x, t.y, t.collisionRadius || t.radius * 0.6, 0x000000, 0);
            phaserScene.physics.add.existing(tree, true);
            phaserScene.walls.add(tree);
            t.phaserBody = tree;

            if (phaserScene.visualTrees) {
                const isSnow = t.sceneGroup === 'snow';
                const key = isSnow ? 'tree_canopy_snow' : 'tree_canopy';
                const sprite = phaserScene.add.sprite(t.x, t.y, key);
                sprite.setOrigin(0.5, 1);
                const canopyR = t.canopyRadius || t.radius * 1.2;
                const trunkH = t.trunkHeight || t.radius * 2;
                const displayW = canopyR * 2.2;
                const displayH = trunkH + canopyR * 1.8;
                sprite.setDisplaySize(displayW, displayH);
                sprite.setDepth(t.sortY || t.y + t.radius * 2);
                phaserScene.visualTrees.add(sprite);
                t.visualSprite = sprite;
            }
        }

        if (this.trees.length > 0) this._phaserVisualsEnabled = true;
    },
    circleRect(cx, cy, r, rect) {
        const clX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
        const clY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
        return (cx - clX) ** 2 + (cy - clY) ** 2 < r * r;
    },
    canMoveTo(x, y, radius) {
        for (const w of this.walls) if (this.circleRect(x, y, radius, w)) return false;
        // iso 墙线段模型：点到线段距离 < 半径 + 半厚
        if (this.isoSegments) {
            for (const s of this.isoSegments) {
                if (this._pointSegDist(x, y, s.x1, s.y1, s.x2, s.y2) < radius + s.halfThick) return false;
            }
        }
        // 检查树木碰撞：使用独立的 collisionRadius（视觉半径的60%）
        for (const t of this.trees) {
            const dx = x - t.x, dy = y - t.y;
            const treeR = t.collisionRadius || t.radius * 0.6;
            if (Math.sqrt(dx * dx + dy * dy) < treeR + radius) return false;
        }
        return true;
    },
    /** 点 (px,py) 到线段 (x1,y1)-(x2,y2) 的距离 */
    _pointSegDist(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) return Math.hypot(px - x1, py - y1);
        let t = ((px - x1) * dx + (py - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    },
    /** 两线段是否相交 */
    _segSegIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
        const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (d === 0) return false;
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
        const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
        return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    },
    resolve(x, y, nx, ny, r) {
        if (this.canMoveTo(nx, ny, r) && !this.blocked(x, y, nx, ny)) return { x: nx, y: ny };
        // iso 墙切向滑动：找最近阻挡墙段，取移动在墙方向上的分量（速度不超意图，杜绝加速滑行）
        const seg = this._nearestBlockingSeg(nx, ny, r);
        if (seg) {
            const dx = nx - x, dy = ny - y;
            const wx = seg.x2 - seg.x1, wy = seg.y2 - seg.y1;
            const wl2 = wx * wx + wy * wy;
            if (wl2 > 0) {
                const t = (dx * wx + dy * wy) / wl2;
                for (const ratio of [1, 0.5, 0.25]) {
                    const sx = x + wx * t * ratio, sy = y + wy * t * ratio;
                    if (this.canMoveTo(sx, sy, r) && !this.blocked(x, y, sx, sy)) {
                        return { x: sx, y: sy };
                    }
                }
            }
        }
        if (this.canMoveTo(nx, y, r) && !this.blocked(x, y, nx, y)) return { x: nx, y };
        if (this.canMoveTo(x, ny, r) && !this.blocked(x, y, x, ny)) return { x, y: ny };
        // [OPTIMIZE] 标准滑动失败后，尝试沿移动方向逐步缩减步长
        const dx = nx - x, dy = ny - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
            for (let ratio = 0.75; ratio >= 0.25; ratio -= 0.25) {
                const stepX = x + dx * ratio;
                const stepY = y + dy * ratio;
                if (this.canMoveTo(stepX, stepY, r) && !this.blocked(x, y, stepX, stepY)) {
                    return { x: stepX, y: stepY };
                }
            }
        }
        return { x, y };
    },
    /** 找离目标点最近的阻挡 iso 墙段（距离 < r + 半厚 + 容差） */
    _nearestBlockingSeg(nx, ny, r) {
        if (!this.isoSegments) return null;
        let best = null, bestD = Infinity;
        for (const s of this.isoSegments) {
            const d = this._pointSegDist(nx, ny, s.x1, s.y1, s.x2, s.y2);
            if (d < r + s.halfThick + 4 && d < bestD) {
                bestD = d;
                best = s;
            }
        }
        return best;
    },
    lineCircle(x1, y1, x2, y2, cx, cy, r) {
        const dx = x2 - x1, dy = y2 - y1;
        const a = dx * dx + dy * dy;
        const b = 2 * (dx * (x1 - cx) + dy * (y1 - cy));
        const c = (x1 - cx) * (x1 - cx) + (y1 - cy) * (y1 - cy) - r * r;
        if (a === 0) return Math.sqrt((x1 - cx) ** 2 + (y1 - cy) ** 2) < r;
        const det = b * b - 4 * a * c;
        if (det < 0) return false;
        const t1 = (-b - Math.sqrt(det)) / (2 * a), t2 = (-b + Math.sqrt(det)) / (2 * a);
        return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
    },
    lineRect(x1, y1, x2, y2, rect) {
        const dx = x2 - x1, dy = y2 - y1;
        let u1 = 0, u2 = 1;
        const p = [-dx, dx, -dy, dy], q = [x1 - rect.x, rect.x + rect.w - x1, y1 - rect.y, rect.y + rect.h - y1];
        for (let i = 0; i < 4; i++) {
            if (p[i] === 0) { if (q[i] < 0) return false; }
            else { const t = q[i] / p[i]; if (p[i] < 0) { if (t > u1) u1 = t; } else { if (t < u2) u2 = t; } }
        }
        return u1 < u2;
    },
    blocked(x1, y1, x2, y2) {
        for (const w of this.walls) if (this.lineRect(x1, y1, x2, y2, w)) return true;
        // iso 墙线段：移动线与墙段相交
        if (this.isoSegments) {
            for (const s of this.isoSegments) {
                if (this._segSegIntersect(x1, y1, x2, y2, s.x1, s.y1, s.x2, s.y2)) return true;
            }
        }
        // 检查树木：使用独立的 collisionRadius（视觉半径的60%）
        for (const t of this.trees) if (this.lineCircle(x1, y1, x2, y2, t.x, t.y, t.collisionRadius || t.radius * 0.6)) return true;
        return false;
    },
    addTree(x, y, radius, treeType, sceneGroup = 'normal', rotation = 0) {
        // [OPTIMIZE] 碰撞体积较大的怪物卡树优化：
        // 树木视觉半径和碰撞半径分离，碰撞半径为视觉半径的60%，
        // 让大怪物更容易在树木间通过，同时保持视觉效果
        const collisionRadius = radius * 0.6;
        const treeData = {
            x, y, radius, collisionRadius,
            height: radius * 3,
            type: treeType || 0,
            sceneGroup: sceneGroup || 'normal',
            rotation: rotation || 0,
            trunkWidth: radius * 0.6,
            trunkHeight: radius * 2,
            canopyRadius: radius * 1.2,
            sortY: y + radius * 2
        };
        this.trees.push(treeData);
        // ===== Phaser 树木同步（单个添加）=====
        const phaserScene = window.__phaserScene;
        if (phaserScene) {
            const tree = phaserScene.add.circle(x, y, collisionRadius, 0x000000, 0);
            phaserScene.physics.add.existing(tree, true);
            phaserScene.walls.add(tree);
            treeData.phaserBody = tree;

            if (phaserScene.visualTrees) {
                const isSnow = sceneGroup === 'snow';
                const key = isSnow ? 'tree_canopy_snow' : 'tree_canopy';
                const sprite = phaserScene.add.sprite(x, y, key);
                sprite.setOrigin(0.5, 1);
                const displayW = treeData.canopyRadius * 2.2;
                const displayH = treeData.trunkHeight + treeData.canopyRadius * 1.8;
                sprite.setDisplaySize(displayW, displayH);
                sprite.setDepth(treeData.sortY);
                phaserScene.visualTrees.add(sprite);
                treeData.visualSprite = sprite;
            }
            this._phaserVisualsEnabled = true;
        }
    },
    /**
     * 移除指定半径内的树木
     * @param {number} cx - 中心X
     * @param {number} cy - 中心Y
     * @param {number} radius - 半径
     * @returns {number} 移除的树木数量
     */
    removeTreesInRadius(cx, cy, radius) {
        let removed = 0;
        for (let i = this.trees.length - 1; i >= 0; i--) {
            const t = this.trees[i];
            const dx = t.x - cx;
            const dy = t.y - cy;
            if (Math.sqrt(dx * dx + dy * dy) <= radius) {
                if (t.visualSprite) {
                    t.visualSprite.destroy();
                }
                if (t.phaserBody) {
                    t.phaserBody.destroy();
                }
                this.trees.splice(i, 1);
                removed++;
            }
        }
        return removed;
    },
    /**
     * 寻找安全的生成位置：若 (x,y) 被阻挡，则沿螺旋方向外推直到找到合法点
     * @param {number} x - 初始 X
     * @param {number} y - 初始 Y
     * @param {number} radius - 实体碰撞半径
     * @param {number} [maxAttempts=8] - 最大尝试次数
     * @returns {{x:number, y:number}} 安全坐标
     */
    findSafeSpawn(x, y, radius, maxAttempts = 8) {
        if (this.canMoveTo(x, y, radius)) return { x, y };
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const angle = (Math.PI * 2 * attempt) / maxAttempts;
            const dist = radius * attempt * 0.8;
            const tx = x + Math.cos(angle) * dist;
            const ty = y + Math.sin(angle) * dist;
            if (this.canMoveTo(tx, ty, radius)) return { x: tx, y: ty };
        }
        return { x, y };
    },
    getTreesInView(vx, vy, vw, vh) {
        const result = [];
        for (const t of this.trees) {
            if (t.x + t.radius > vx && t.x - t.radius < vx + vw && t.y + t.radius > vy && t.y - t.radius < vy + vh) result.push(t);
        }
        return result;
    },
    renderTrees(ctx, cameraX, cameraY) {
        if (this._phaserVisualsEnabled) return;
        const trees = this.getTreesInView(cameraX, cameraY, CONFIG.VIEW_WIDTH, CONFIG.VIEW_HEIGHT);
        trees.sort((a, b) => (a.sortY || a.y) - (b.sortY || b.y));
        for (const t of trees) {
            const sx = t.x - cameraX;
            const sy = t.y - cameraY;
            const trunkW = t.trunkWidth || t.radius * 0.6;
            const trunkH = t.trunkHeight || t.radius * 2;
            const canopyR = t.canopyRadius || t.radius * 1.2;
            // 绘制树干（棕色矩形）
            ctx.fillStyle = '#5a3a1a';
            ctx.fillRect(sx - trunkW / 2, sy - trunkH, trunkW, trunkH);
            // 树干高光
            ctx.fillStyle = '#4a2a0a';
            ctx.fillRect(sx - trunkW / 2 + 2, sy - trunkH, 2, trunkH);
            // 绘制树冠（绿色圆形）
            ctx.fillStyle = '#2d8a3e';
            ctx.beginPath();
            ctx.arc(sx, sy - trunkH - canopyR * 0.3, canopyR, 0, Math.PI * 2);
            ctx.fill();
            // 树冠高光
            ctx.fillStyle = '#3da84e';
            ctx.beginPath();
            ctx.arc(sx - canopyR * 0.2, sy - trunkH - canopyR * 0.5, canopyR * 0.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
};


export { WallSystem, ISO_WALL_GEO, ISO_WALL_HEIGHT };
