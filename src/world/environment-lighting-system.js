// 环境光照状态：为接触阴影、静态投影和后续局部光效提供唯一的太阳输入。
// 当前阶段只消费其太阳投影参数；不依赖 WebGL，因此 AUTO 回退到 Canvas 时同样可用。
import { isoLocalToWorldDelta } from '../physics/iso-footprint.js';

const TAU = Math.PI * 2;
// 2026-08-19：阴影深浅全局统一——颜色统一纯黑，透明度 0.1925
//（0.55 → −30% → 再 −50%，用户口径），不随仰角变化、不分层叠加。
// 个体仍可用 shadow.opacity 覆盖。改深浅只调这两个常量。
const STATIC_SHADOW_OPACITY = 0.1925;
const DYNAMIC_SHADOW_OPACITY = 0.1925;

const DEFAULTS = Object.freeze({
    enabled: true,
    animateSun: true,
    staticEnabled: true,
    ambientEnabled: true,
    localGlowEnabled: true,
    quality: 'high',
    dayDurationMs: 12 * 60 * 1000,
    startPhase: 0.25,
    dynamicMaxOffset: 16,
    staticMaxOffset: 72,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const EnvironmentLightingSystem = {
    _config: { ...DEFAULTS },
    _elapsedMs: 0,
    _sun: {
        phase: 0,
        elevation: 0.9,
        directionX: 0,
        directionY: -1,
        shadowX: 0,
        shadowY: 1,
        daylight: 1,
        ambientColor: 0x000000,
        ambientAlpha: 0,
    },

    configure(options = {}) {
        this._config = { ...this._config, ...options };
        if (Number.isFinite(options.startPhase)) {
            this._elapsedMs = 0;
        }
        this._refreshSun();
    },

    update(deltaMs = 0) {
        if (this._config.animateSun) {
            this._elapsedMs += Math.max(0, deltaMs || 0);
        }
        this._refreshSun();
        return this._sun;
    },

    /** 开发工具专用的显式时钟推进；不依赖 animateSun，仍使用统一游戏时钟。 */
    advanceTime(deltaMs = 0) {
        this._elapsedMs += Math.max(0, Number(deltaMs) || 0);
        this._refreshSun();
        return this.serializeTime();
    },

    getSun() {
        return this._sun;
    },

    getConfig() {
        return { ...this._config };
    },

    getShadowQuality() {
        return ['low', 'medium', 'high'].includes(this._config.quality)
            ? this._config.quality
            : 'high';
    },

    getAmbient() {
        return {
            color: this._sun.ambientColor,
            alpha: this._sun.ambientAlpha,
            daylight: this._sun.daylight,
        };
    },

    getGameTime() {
        const duration = Math.max(1, Number(this._config.dayDurationMs) || DEFAULTS.dayDurationMs);
        const cycles = this._elapsedMs / duration + (this._config.startPhase || 0);
        const day = Math.floor(cycles) + 1;
        // phase=0 为日出（06:00），0.25 为正午（12:00）。
        const clockMinutes = Math.floor((((this._sun.phase * 24 + 6) % 24) * 60));
        const hour = Math.floor(clockMinutes / 60);
        const minute = clockMinutes % 60;
        let period = '深夜';
        let icon = '🌙';
        if (hour >= 5 && hour < 8) { period = '晨曦'; icon = '🌅'; }
        else if (hour >= 8 && hour < 17) { period = '白昼'; icon = '☀'; }
        else if (hour >= 17 && hour < 20) { period = '黄昏'; icon = '🌇'; }
        return { day, hour, minute, period, icon };
    },

    serializeTime() {
        return { elapsedMs: this._elapsedMs };
    },

    restoreTime(data) {
        const elapsed = Number(data?.elapsedMs);
        if (Number.isFinite(elapsed) && elapsed >= 0) {
            this._elapsedMs = elapsed;
            this._refreshSun();
        }
    },

    /**
     * 统一推导单位接触阴影。个体可用 entity.shadow 或 render.shadow 覆盖：
     * { enabled, height, maxOffset, opacity, widthMul, depthMul }。
     */
    getDynamicShadow(entity, radius) {
        if (!this._config.enabled) return null;
        const render = entity?.config?.render || {};
        const style = entity?.shadow || render.shadow || {};
        if (style.enabled === false) return null;

        const safeRadius = Math.max(1, radius || 10);
        const height = Math.max(0, Number(
            style.height ?? entity?.shadowHeight ?? render.shadowHeight ?? entity?.bodyHeight ?? safeRadius * 4
        ) || 0);
        const maxOffset = Math.max(0, Number(style.maxOffset ?? this._config.dynamicMaxOffset) || 0);
        // 正午短、早晚长；所有移动单位都钳制为短投影，保持战斗画面清晰。
        const length = clamp(height * 0.12 * (0.28 + (1 - this._sun.elevation) * 1.35), 2, maxOffset);
        const widthMul = Math.max(0.1, Number(style.widthMul ?? (1.05 + length * 0.012)) || 1);
        const depthMul = Math.max(0.1, Number(style.depthMul ?? (0.92 + length * 0.008)) || 1);
        // 深浅统一（2026-08-19）：恒定透明度，不随仰角漂移；
        // 但随 daylight 衰减（夜影修复）——daylight≥0.3 全强度，黄昏快速转淡，
        // ≤0.1（约 18:35 后）归零，夜里没有太阳时不残留任何黑影块。
        const nightFade = clamp((this._sun.daylight - 0.1) / 0.2, 0, 1);
        const opacity = clamp(Number(style.opacity ?? DYNAMIC_SHADOW_OPACITY) || 0, 0, 1) * nightFade;

        return {
            offsetX: this._sun.shadowX * length,
            offsetY: this._sun.shadowY * length,
            widthMul,
            depthMul,
            opacity,
        };
    },

    /**
     * 静态物体（树木、后续建筑/Boss）的方向性软投影。
     * 返回的 length 是投影胶囊应额外拉长的长度，offset 为其中心向投影方向移动的距离。
     */
    getStaticShadow(options = {}) {
        if (!this._config.enabled || !this._config.staticEnabled
            || this.getShadowQuality() === 'low' || options.enabled === false) return null;
        const height = Math.max(0, Number(options.height) || 0);
        const maxOffset = Math.max(0, Number(options.maxOffset ?? this._config.staticMaxOffset) || 0);
        // 静态物体允许比人物更长的影子：正午收短，早晚伸长。
        const length = clamp(height * 0.5 * (0.20 + (1 - this._sun.elevation) * 1.7), 4, maxOffset);
        // 深浅统一（2026-08-19）：恒定透明度，不随仰角漂移；
        // 随 daylight 衰减（夜影修复）——daylight≥0.3 全强度，≤0.1 归零。
        const nightFade = clamp((this._sun.daylight - 0.1) / 0.2, 0, 1);
        const opacity = clamp(Number(options.opacity ?? STATIC_SHADOW_OPACITY) || 0, 0, 1) * nightFade;

        return {
            offsetX: this._sun.shadowX * length * 0.5,
            offsetY: this._sun.shadowY * length * 0.5,
            length,
            opacity,
        };
    },

    /**
     * 建筑太阳投影的 footprint 四边形凸包（2026-08-19 七轮：回到 footprint 思路重建）。
     * 阴影 = 真实 footprint 四边形 ∪ 四边形沿影向平移 length 的凸包。
     * 逐帧纯几何计算——无烘焙、无分桶、无缓存，太阳连续移动时阴影必然连续，
     * 从构造上消灭"跨桶瞬间移动一段"；影根由构造精确贴住地面四边形。
     */
    getStaticShadowHull(vertices, profile) {
        if (!Array.isArray(vertices) || vertices.length < 3) return [];
        const length = Math.max(0, Number(profile?.length) || 0);
        const theta = Math.atan2(profile?.offsetY || 0, profile?.offsetX || 0);
        const ex = Math.cos(theta) * length;
        const ey = Math.sin(theta) * length;
        const pts = [];
        for (const p of vertices) {
            if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
            pts.push({ x: p.x, y: p.y });
            pts.push({ x: p.x + ex, y: p.y + ey });
        }
        if (pts.length < 3) return [];
        return this._convexHull(pts);
    },

    /**
     * 剪影多边形阴影（2026-08-19 八轮：贴合 + 轮廓两全）。
     *
     * 离线逐列剪影（manifest shadowSilhouette：每列 [texX, topY, bottomY]）展开：
     * 接地曲线（各列 bottomY 的 V 形）作近边，顶线按各列高度沿影向位移作远边，
     * 在 (u,v) 帧取包络后映回世界坐标——逐帧纯几何、无烘焙无分桶（连续不跳），
     * 近边=贴图实测接地线、远边=真实屋顶轮廓，影宽=建筑真实全宽（不再被
     * footprint 钳小）。形变烘焙的跳动/错配来自缓存分桶与 x 尺错配，非几何本身。
     */
    getSilhouetteShadowPolygon(columns, options = {}) {
        if (!Array.isArray(columns) || columns.length < 3) return [];
        const dirX = Math.cos(options.theta || 0);
        const dirY = Math.sin(options.theta || 0);
        const perpX = -dirY;
        const perpY = dirX;
        const scaleX = Number(options.scaleX) || 1;
        const scaleY = Number(options.scaleY) || 1;
        const anchorX = Number(options.anchorX) || 0;
        const anchorY = Number(options.anchorY) || 0;
        const frontY = Number(options.frontY) || 0;
        const texCenterX = Number(options.texCenterX) || 0;
        const flipSign = options.flipX ? -1 : 1;
        const length = Math.max(0, Number(options.length) || 0);
        const refHeight = Math.max(1, Number(options.maxHeight) || 1);
        const maxOffset = Math.max(0, Number(options.maxOffset ?? length) || 0);
        // 各列：世界接地点 + 沿 D 的位移量。**位移按顶端离地高度**（frontY−topY）——
        // 悬空部分（仙人掌手臂、旗帜、屋顶挑檐）的影子落在地面远处，
        // 而不是按自身厚度位移（此前手臂影悬空贴身的根因）；
        // 归一参考 75 分位列高，塔尖拉长按 maxOffset 钳制。
        const strips = [];
        const groundInfo = this._contactGroundInfo(columns);
        const frontTX = groundInfo.frontCol[0];
        const ISO_SLOPE = 0.5;
        // 门/斜墙类（2026-08-19）：groundLine = 世界面线（A→B）——列按贴图接触
        // 跨度沿线映射，内容高 = 自身列高（这类件的内容都立在地面上）。
        const groundLine = options.groundLine || null;
        let contactMinX = 0;
        let contactSpanX = 1;
        let faceY0 = 0;
        let faceY1 = 0;
        if (groundLine) {
            const sortedCols = columns.slice().sort((a, b) => a[0] - b[0]);
            contactMinX = sortedCols[0][0];
            contactSpanX = Math.max(1e-6, sortedCols[sortedCols.length - 1][0] - contactMinX);
            faceY0 = sortedCols[0][2];
            faceY1 = sortedCols[sortedCols.length - 1][2];
        }
        for (const col of columns) {
            const texX = col[0];
            const topY = col[1];
            const bottomY = col[2];
            if (!(bottomY >= topY)) continue;
            // 地面线 = max(贴图底缘, 前顶点 iso 0.5 线)：平底建筑即 V 形底座本身；
            // 球体表面/悬空手臂/挑檐高于 iso 线时取 iso 线（影子落回地面）。
            const groundY = Math.max(bottomY, frontY - ISO_SLOPE * Math.abs(texX - frontTX));
            let gx;
            let gy;
            let zBot;
            let zTop;
            if (groundLine) {
                // 世界面线映射：近边即门/墙的面线（而不是 V 形底座），
                // 贴图接触线两端点对齐面线端点，离线偏差沿屏幕 +y 展开。
                const t = Math.min(1, Math.max(0, (texX - contactMinX) / contactSpanX));
                gx = groundLine.ax + (groundLine.bx - groundLine.ax) * t;
                const faceY = faceY0 + (faceY1 - faceY0) * t;
                gy = groundLine.ay + (groundLine.by - groundLine.ay) * t + (bottomY - faceY) * scaleY;
                zBot = 0;
                zTop = Math.max(0, bottomY - topY) * scaleY;
            } else {
                gx = anchorX + flipSign * (texX - texCenterX) * scaleX;
                gy = anchorY + (groundY - frontY) * scaleY;
                // 净空按该列地面线计算：贴地列 zBot=0（V 形底座不误判为悬空），
                // 悬空列（手臂/挑檐）按地面线到自身底缘的净空位移。
                zBot = Math.max(0, groundY - bottomY) * scaleY;
                zTop = Math.max(0, groundY - topY) * scaleY;
            }
            const uGround = gx * dirX + gy * dirY;
            const uNear = uGround + Math.min((zBot / refHeight) * length, maxOffset);
            const uFar = uGround + Math.min((zTop / refHeight) * length, maxOffset);
            strips.push({
                u: uNear,
                v: gx * perpX + gy * perpY,
                du: Math.max(0, uFar - uNear),
            });
        }
        if (strips.length < 3) return [];
        strips.sort((a, b) => a.v - b.v);
        // 近边 = 接地曲线（v 升序）；远边 = 各条带远端（不凹回近边内侧）
        const near = strips.map((s) => ({ u: s.u, v: s.v }));
        const far = strips.map((s) => ({ u: Math.max(s.u + s.du, s.u), v: s.v }));
        const poly = near.concat(far.reverse());
        // (u,v) → 世界（正交基逆变换）
        return poly.map((p) => ({
            x: p.u * dirX + p.v * perpX,
            y: p.u * dirY + p.v * perpY,
        }));
    },

    /**
     * 凸包实体与剪影轮廓的包络合并（2026-08-19 九轮）。
     * 纯剪影剪切在高度方差大的建筑上退化成细带（塔尖/矮墙位移悬殊）；
     * 纯凸包没有轮廓。合并：同一 (u,v) 采样线上取两多边形 u 跨度的并集——
     * 凸包保证实体主体、剪影贡献屋顶轮廓，边界天然单调无自交、单层无双倍加深。
     */
    getUnionShadowPolygon(hullPoints, silhouettePoints, options = {}) {
        const polys = [];
        if (Array.isArray(hullPoints) && hullPoints.length >= 3) polys.push(hullPoints);
        if (Array.isArray(silhouettePoints) && silhouettePoints.length >= 3) polys.push(silhouettePoints);
        return this.getUnionOfPolygons(polys, options);
    },

    /**
     * N 个阴影多边形的包络并集（2026-08-19 用户口径"重叠调成一整个、同一强度"）。
     * 相交/相邻的阴影先在太阳 (u,v) 帧合并成单一边界再一次填充——
     * 不依赖任何混合幂等假设（跨 GPU/管线的 AA/预乘差异），从结构上杜绝重叠加深。
     * 调用方负责只把真正相交的多边形放进一组（远离的建筑各画各的，禁止桥接）。
     */
    getUnionOfPolygons(polygons, options = {}) {
        const dirX = Math.cos(options.theta || 0);
        const dirY = Math.sin(options.theta || 0);
        const perpX = -dirY;
        const perpY = dirX;
        const toUV = (p) => ({ u: p.x * dirX + p.y * dirY, v: p.x * perpX + p.y * perpY });
        const polys = [];
        for (const poly of polygons || []) {
            if (Array.isArray(poly) && poly.length >= 3) polys.push(poly.map(toUV));
        }
        if (polys.length === 0) return [];
        let minV = Infinity;
        let maxV = -Infinity;
        for (const poly of polys) {
            for (const p of poly) {
                if (p.v < minV) minV = p.v;
                if (p.v > maxV) maxV = p.v;
            }
        }
        const step = Math.max(1.5, Number(options.step) || 2);
        const rows = [];
        for (let v = minV; v <= maxV + 1e-6; v += step) {
            let uMin = Infinity;
            let uMax = -Infinity;
            for (const poly of polys) {
                const span = this._polygonSpanAt(poly, v);
                if (!span) continue;
                if (span.uMin < uMin) uMin = span.uMin;
                if (span.uMax > uMax) uMax = span.uMax;
            }
            if (uMin !== Infinity) rows.push({ v, uMin, uMax });
        }
        if (rows.length < 2) return [];
        // 左缘（uMin 随 v）+ 右缘（uMax 随 v 反序）→ 单调闭合边界
        const boundary = rows.map((r) => ({ u: r.uMin, v: r.v }))
            .concat(rows.slice().reverse().map((r) => ({ u: r.uMax, v: r.v })));
        return boundary.map((p) => ({
            x: p.u * dirX + p.v * perpX,
            y: p.u * dirY + p.v * perpY,
        }));
    },

    /** 多边形在 v 行的 u 跨度（扫描线交点；与多边形无交返回 null）。 */
    _polygonSpanAt(polyUV, v) {
        let uMin = Infinity;
        let uMax = -Infinity;
        const n = polyUV.length;
        for (let i = 0; i < n; i++) {
            const a = polyUV[i];
            const b = polyUV[(i + 1) % n];
            if ((a.v - v) * (b.v - v) > 0) continue;
            if (Math.abs(b.v - a.v) < 1e-9) {
                uMin = Math.min(uMin, a.u, b.u);
                uMax = Math.max(uMax, a.u, b.u);
                continue;
            }
            const t = (v - a.v) / (b.v - a.v);
            const u = a.u + (b.u - a.u) * t;
            if (u < uMin) uMin = u;
            if (u > uMax) uMax = u;
        }
        if (uMin === Infinity) return null;
        return { uMin, uMax };
    },

    /**
     * 由剪影接地曲线生成阴影实体四边形（2026-08-19 十轮：实体/轮廓同一锚点真源）。
     * 逻辑/碰撞 footprint 的中心与贴图真实底座中心存在偏移（基地阴影向光照侧偏出、
     * 仙人掌底部对不上的根因）；实体四边形改为：front=最低接地点、left/right=
     * 接地曲线两端点、back=中心按 26.565° 2:1 镜像——与轮廓展开共用同一锚点/比例，
     * 对齐由构造保证，不再依赖任何碰撞/拟合数据。
     */
    getSilhouetteFootprintVertices(columns, options = {}) {
        if (!Array.isArray(columns) || columns.length < 3) return [];
        const scaleX = Number(options.scaleX) || 1;
        const scaleY = Number(options.scaleY) || 1;
        const anchorX = Number(options.anchorX) || 0;
        const anchorY = Number(options.anchorY) || 0;
        const frontX = Number(options.frontX) || 0;
        const frontY = Number(options.frontY) || 0;
        const texCenterX = Number(options.texCenterX) || 0;
        const flipSign = options.flipX ? -1 : 1;
        const toWorld = (tx, ty) => ({
            x: anchorX + flipSign * (tx - texCenterX) * scaleX,
            y: anchorY + (ty - frontY) * scaleY,
        });
        // 接地曲线顶点经共享 _contactGroundInfo 坡度截断——超出的列是悬空臂/装饰
        // （仙人掌手臂、旗帜），不属于地面 footprint（此前直接取最外列，臂展被误当实体宽度）。
        const { leftCol, rightCol } = this._contactGroundInfo(columns);
        const centerTX = (leftCol[0] + rightCol[0]) / 2;
        const depthT = (rightCol[0] - leftCol[0]) / 2; // 26.565° 2:1（贴图空间）
        return [
            toWorld(centerTX, frontY - depthT),      // back
            toWorld(rightCol[0], rightCol[2]),       // right
            toWorld(frontX, frontY),                 // front
            toWorld(leftCol[0], leftCol[2]),         // left
        ];
    },

    /**
     * 接地曲线信息：从最低接地点沿曲线向两侧走，累计坡度超过 iso 地面坡
     * （≈0.5，容差 0.75）处截断——超出的列是悬空臂/装饰（仙人掌手臂、旗帜），
     * 其地面线按端点水平延伸（影子应投在地面，而非悬在空中）。
     * 返回 { frontCol, leftCol, rightCol, groundYAt }。
     */
    _contactGroundInfo(columns) {
        const ISO_SLOPE_MAX = 0.75;
        const sorted = columns.slice().sort((a, b) => a[0] - b[0]);
        let frontCol = sorted[0];
        for (const c of sorted) if (c[2] > frontCol[2]) frontCol = c;
        let leftCol = frontCol;
        for (let i = sorted.indexOf(frontCol) - 1; i >= 0; i--) {
            const c = sorted[i];
            const slope = Math.abs(c[2] - frontCol[2]) / Math.max(1, Math.abs(c[0] - frontCol[0]));
            if (slope > ISO_SLOPE_MAX) break;
            leftCol = c;
        }
        let rightCol = frontCol;
        for (let i = sorted.indexOf(frontCol) + 1; i < sorted.length; i++) {
            const c = sorted[i];
            const slope = Math.abs(c[2] - frontCol[2]) / Math.max(1, Math.abs(c[0] - frontCol[0]));
            if (slope > ISO_SLOPE_MAX) break;
            rightCol = c;
        }
        const groundYAt = (texX) => {
            if (texX <= leftCol[0]) return leftCol[2];
            if (texX >= rightCol[0]) return rightCol[2];
            const c = sorted.find((col) => col[0] === texX);
            return c ? c[2] : frontCol[2];
        };
        return { frontCol, leftCol, rightCol, groundYAt };
    },

    /** Andrew monotone chain；共线点剔除。屏幕 y 向下同样成立。 */
    _convexHull(points) {
        if (points.length <= 3) return points.slice();
        const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
        const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
        const lower = [];
        for (const p of sorted) {
            while (lower.length >= 2
                && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
            lower.push(p);
        }
        const upper = [];
        for (let i = sorted.length - 1; i >= 0; i--) {
            const p = sorted[i];
            while (upper.length >= 2
                && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
            upper.push(p);
        }
        lower.pop();
        upper.pop();
        return lower.concat(upper);
    },





    _refreshSun() {
        const duration = Math.max(1, Number(this._config.dayDurationMs) || DEFAULTS.dayDurationMs);
        const phase = ((this._elapsedMs / duration) + (this._config.startPhase || 0)) % 1;
        // phase=0 日出、0.25 正午、0.5 日落、0.75 午夜。
        const solarHeight = Math.sin(phase * TAU);
        const daylight = clamp((solarHeight + 0.15) / 1.15, 0, 1);
        // 世界-122：太阳方位先在 u/v 地面轴中运动，再投影到屏幕。
        // phase=0 左侧日出、0.25 屏幕上方正午、0.5 右侧日落；
        // 影子方向取反。这里不做屏幕向量归一化，保留 2:1 地面投影固有的视角缩短。
        const groundAngle = phase * TAU + Math.PI * 0.75;
        const sunU = Math.cos(groundAngle);
        const sunV = Math.sin(groundAngle);
        const projectedSun = isoLocalToWorldDelta(sunU, sunV);

        this._sun.phase = phase;
        this._sun.elevation = 0.18 + daylight * 0.72;
        this._sun.directionX = projectedSun.x;
        this._sun.directionY = projectedSun.y;
        this._sun.shadowX = -projectedSun.x;
        this._sun.shadowY = -projectedSun.y;
        this._sun.daylight = daylight;

        // 屏幕覆盖层：正午完全透明；晨昏少量暖色；夜间为低饱和蓝色。
        const dusk = clamp(1 - Math.abs(solarHeight) * 4, 0, 1) * daylight;
        if (daylight <= 0.12) {
            this._sun.ambientColor = 0x10264a;
            this._sun.ambientAlpha = 0.34;
        } else if (dusk > 0.04) {
            this._sun.ambientColor = 0x9a4d2f;
            this._sun.ambientAlpha = 0.10 * dusk;
        } else {
            this._sun.ambientColor = 0x1a263d;
            this._sun.ambientAlpha = (1 - daylight) * 0.18;
        }
    },
};
