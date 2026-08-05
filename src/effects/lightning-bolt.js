/**
 * 锁定/传导类连接特效模板（2026-08-02，闪电技能首航；同类型技能直接复用）
 *
 * 连接施法者与目标，**色块/粒子风格避免线条感**（参考火球魔法）：
 * - 中点位移生成锯齿折线 → 细分 + Chaikin 平滑 → 按 ~4px 步长重采样成连续色块链；
 * - 沿链逐点堆叠**圆块**（外层辉光 ADD 混合 + 内芯色块 NORMAL 混合），
 *   每点半径带固定随机变化（创建时烘焙），重叠处自然增亮，观感同火球火焰簇；
 * - 半径施法端粗 → 目标端细（默认辉光 30→5px、内芯 12→2px）；
 * - **释放瞬间定格**：形态只在创建时随机生成一次，持续期不再扭动；
 * - 持续 durationMs 后进入 fadeMs（默认 0.25s）线性淡出；目标死亡后终点冻结残留。
 * 深度 = 两端实体精灵深度较大者 + 1。
 *
 * 可配置（同类型技能换配色/粗细直接套用）：
 * - options.colors：{ glowOuter, glowInner, core, white }（默认蓝紫闪电配色）
 * - options.widthScale：整体粗细倍率（默认 1）
 * - options.uniform：等宽模式（默认 false）——关闭"施法端粗→目标端细"的渐变，
 *   整条闪电半径恒定（过载传导等"细闪电"场景用；true 时忽略每点随机大小抖动）
 * - options.durationMs / options.fadeMs / options.segments / options.jitter
 *
 * 生命周期由 EffectManager.update 驱动，active=false 后自动移除。
 */
class LightningBoltEffect {
    constructor(source, target, options = {}) {
        this.source = source;
        this.target = target;
        this.fadeMs = options.fadeMs || 250;
        this.life = (options.durationMs || 500) + this.fadeMs;
        this.maxLife = this.life;
        this.active = true;
        this.segments = options.segments || 10;
        this.jitter = options.jitter ?? 0.12;
        this.colors = options.colors || {
            glowOuter: 0x6a4bff,
            glowInner: 0xa98fff,
            core: 0xdcd6ff,
            white: 0xffffff,
        };
        this.widthScale = options.widthScale ?? 1;
        this.uniform = !!options.uniform;
        this._points = [];
        this._chain = []; // 重采样后的色块链 [{x, y, s}]（s=大小变化因子，创建时烘焙）
        this._endX = null; // 目标死亡后冻结终点，闪电残留在最后位置
        this._endY = null;
        this._graphics = null;      // 内芯（NORMAL 混合）
        this._glowGraphics = null;  // 外层辉光（ADD 混合）
        this._createPhaserGraphics();
        this._regenerate();
    }

    _createPhaserGraphics() {
        const scene = window.__phaserScene;
        if (!scene) return;
        this._graphics = scene.add.graphics();
        this._glowGraphics = scene.add.graphics();
        this._glowGraphics.setBlendMode('ADD');
        if (scene.worldEffectsGroup) {
            scene.worldEffectsGroup.add(this._graphics);
            scene.worldEffectsGroup.add(this._glowGraphics);
        }
    }

    _startPoint() {
        const s = this.source;
        return { x: s.x, y: s.y - ((s.bodyHeight || 120) * 0.5) };
    }

    _endPoint() {
        const t = this.target;
        if (this._endX == null || (t && t.active)) {
            this._endX = t.x;
            this._endY = t.y - ((t.bodyHeight || 120) * 0.5);
        }
        return { x: this._endX, y: this._endY };
    }

    /** 中点位移 → 细分 → Chaikin 平滑 → 按固定步长重采样成连续色块链 */
    _regenerate() {
        const a = this._startPoint();
        const b = this._endPoint();
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const segs = Math.max(4, this.segments || 10);
        const amp = Math.max(10, dist * (this.jitter || 0.12));
        let px, py;
        if (dist > 1e-4) { px = -dy / dist; py = dx / dist; }
        else { px = 1; py = 0; }
        const pts = [{ x: a.x, y: a.y }];
        for (let i = 1; i < segs; i++) {
            const t = i / segs;
            const off = (Math.random() * 2 - 1) * amp;
            pts.push({ x: a.x + dx * t + px * off, y: a.y + dy * t + py * off });
        }
        pts.push({ x: b.x, y: b.y });
        // 细分（每段中点）→ Chaikin 切角平滑（保留端点）
        const dense = [];
        for (let i = 0; i < pts.length - 1; i++) {
            dense.push(pts[i]);
            dense.push({ x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 });
        }
        dense.push(pts[pts.length - 1]);
        const smooth = [];
        for (let i = 0; i < dense.length - 1; i++) {
            const p1 = dense[i], p2 = dense[i + 1];
            if (i === 0) smooth.push({ x: p1.x, y: p1.y });
            smooth.push({ x: 0.75 * p1.x + 0.25 * p2.x, y: 0.75 * p1.y + 0.25 * p2.y });
            smooth.push({ x: 0.25 * p1.x + 0.75 * p2.x, y: 0.25 * p1.y + 0.75 * p2.y });
            if (i === dense.length - 2) smooth.push({ x: p2.x, y: p2.y });
        }
        this._points = smooth;
        // 固定步长重采样（保证细端圆块仍相连）+ 烘焙每点大小变化因子
        const step = 4;
        const chain = [];
        let acc = 0;
        for (let i = 0; i < smooth.length - 1; i++) {
            const p1 = smooth[i], p2 = smooth[i + 1];
            const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            if (segLen < 1e-6) continue;
            let t = acc / segLen;
            while (t <= 1) {
                chain.push({
                    x: p1.x + (p2.x - p1.x) * t,
                    y: p1.y + (p2.y - p1.y) * t,
                    s: this.uniform ? 1 : (0.75 + Math.random() * 0.5), // 色块大小变化（0.75~1.25）；等宽模式固定 1
                });
                acc += step;
                t = acc / segLen;
            }
            acc -= segLen;
        }
        const last = smooth[smooth.length - 1];
        chain.push({ x: last.x, y: last.y, s: 1 });
        this._chain = chain;
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) {
            this.active = false;
            this._destroyPhaserGraphics();
            return;
        }
        this._redraw();
    }

    _destroyPhaserGraphics() {
        if (this._graphics) {
            this._graphics.destroy();
            this._graphics = null;
        }
        if (this._glowGraphics) {
            this._glowGraphics.destroy();
            this._glowGraphics = null;
        }
    }

    _redraw() {
        if (!this._graphics || !this._graphics.active || this._chain.length < 2) return;
        // 定格显示 → 最后 fadeMs（默认 0.25s）线性淡出
        const alpha = this.life >= this.fadeMs ? 1 : Math.max(0, this.life / this.fadeMs);
        const srcD = this.source && this.source._phaserSprite ? this.source._phaserSprite.depth : (this.source ? this.source.y + 10 : 0);
        const tgtD = this.target && this.target._phaserSprite ? this.target._phaserSprite.depth : (this.target ? this.target.y + 10 : 0);
        const depth = Math.max(srcD, tgtD) + 1;

        const g = this._graphics;
        const glow = this._glowGraphics;
        g.clear();
        g.setPosition(0, 0);
        g.setDepth(depth);
        glow.clear();
        glow.setPosition(0, 0);
        glow.setDepth(depth);

        const n = this._chain.length;
        const ws = this.widthScale;
        for (let i = 0; i < n; i++) {
            const c = this._chain[i];
            const t = i / (n - 1);
            // 等宽模式：整条闪电半径恒定且偏细（过载传导等场景）；默认保留施法端粗→目标端细
            const outerR = this.uniform ? 12 : (30 + (5 - 30) * t);
            const innerR = this.uniform ? 7.5 : (19 + (4 - 19) * t);
            const coreR = this.uniform ? 4.6 : (11 + (2 - 11) * t);
            const whiteR = this.uniform ? 2.2 : (5 + (1 - 5) * t);
            // 外层辉光（ADD）：大圆块，施法端粗 → 目标端细
            glow.fillStyle(this.colors.glowOuter, 0.26 * alpha);
            glow.fillCircle(c.x, c.y, outerR * c.s * ws);
            glow.fillStyle(this.colors.glowInner, 0.18 * alpha);
            glow.fillCircle(c.x, c.y, innerR * c.s * ws);
            // 内芯色块（NORMAL）：白蓝色，重叠自然增亮
            g.fillStyle(this.colors.core, 0.88 * alpha);
            g.fillCircle(c.x, c.y, coreR * c.s * ws);
            g.fillStyle(this.colors.white, 0.92 * alpha);
            g.fillCircle(c.x, c.y, whiteR * c.s * ws);
        }
    }
}

export { LightningBoltEffect };
