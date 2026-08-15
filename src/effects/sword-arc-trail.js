// ============================================================
// SwordArcTrail — 平滑弧形刀光
// 思路：连续采样剑的视觉中心，用历史采样点构建一条沿运动轨迹的
// 平滑 Ribbon（两侧边缘按运动法线展开，端点渐收为零宽），再叠
// 外层/中层/内层三条不同宽度的多边形，形成中间亮、边缘柔、首尾
// 渐隐的弯月形刀光。
// ============================================================

const DEFAULTS = {
    enabled: true,
    intervalMs: 12,       // 采样间隔：越小弧线越平滑
    lifeMs: 220,          // 轨迹残留时间
    maxCount: 28,         // 最大采样点数
    tailLength: 46,       // 尾端向后延伸渐隐长度（px）
    trailBackOffset: 6,   // 最新采样沿运动反方向后移，避免刀光跑到剑前
    minMoveDistance: 1.5, // 位移小于该值不采样
    color: '0xffffff',    // 刀光颜色（固定白色）
    coreHalfWidth: 0.2,   // 内层半宽 = 剑显示宽 × 该值
    midHalfWidth: 0.4,    // 中层半宽
    outerHalfWidth: 0.62, // 外层半宽
    alphaOuter: 0.22,     // 外层透明度
    alphaMid: 0.4,        // 中层透明度
    alphaCore: 0.8,       // 内层透明度
    outlineEnabled: true, // 黑色轮廓底层：保证亮色场景（世界-122）也清晰可见
    outlineColor: '0x000000',
    outlineAlpha: 0.3,
    outlineHalfWidth: 0.68,
    smoothSteps: 2,       // 每段 Catmull-Rom 细分次数，越大越圆滑
    headWidthMul: 0.25,   // 与剑衔接端宽度系数：小于 1 会收窄，避免菱形/箭头硬边
    fadeInRatio: 0.1,     // 靠近剑的一端透明度渐入区间
    fadeOutRatio: 0.72,   // 尾部开始淡出区间
    particleEnabled: true, // 轨迹边缘粒子：柔化拼接与尾部
    particleCount: 2,     // 每个采样点边缘粒子数
    particleAlpha: 0.18   // 粒子峰值透明度
};

function parseColor(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const text = value.trim().replace(/^#/, '');
        const n = parseInt(text, 16);
        if (Number.isFinite(n)) return n;
    }
    return 0xffffff;
}

export class SwordArcTrail {
    constructor(scene, config = {}) {
        this.scene = scene;
        this.cfg = { ...DEFAULTS, ...(config || {}) };
        this.cfg.color = parseColor(this.cfg.color);
        this.cfg.outlineColor = parseColor(this.cfg.outlineColor !== undefined ? this.cfg.outlineColor : 0x000000);
        this.samples = [];
        this.graphics = null;
        this._lastVx = 0;
        this._lastVy = 0;
        this._lastPush = -Infinity;
        this._ensureGraphics();
    }

    _now() {
        if (this.scene && this.scene.time) return this.scene.time.now;
        return (typeof performance !== 'undefined' ? performance.now() : Date.now());
    }

    _ensureGraphics() {
        if (this.graphics || !this.scene) return;
        this.graphics = this.scene.add.graphics();
        this.graphics.setVisible(false);
        // 不加入 worldEffectsGroup：避免部分场景下组可见性状态异常导致刀光消失。
        // 地图模式通过 update() 中的 _mapModeActive 显式隐藏。
    }

    pushPose(pose) {
        if (!this.cfg.enabled || !pose || !this.scene) return;
        const now = this._now();
        if (now - this._lastPush < this.cfg.intervalMs) return;

        const rawX = pose.x || 0;
        const rawY = pose.y || 0;
        const last = this.samples[this.samples.length - 1];

        if (last) {
            const dx = rawX - last.rawX;
            const dy = rawY - last.rawY;
            if (dx * dx + dy * dy < this.cfg.minMoveDistance * this.cfg.minMoveDistance) return;
        }

        let dirX = 0, dirY = 0;
        if (last) {
            if (last.hold) last.hold = false;
            const dx = rawX - last.rawX;
            const dy = rawY - last.rawY;
            const speed = Math.hypot(dx, dy);
            if (speed >= 0.5) {
                dirX = dx / speed;
                dirY = dy / speed;
                this._lastVx = dirX;
                this._lastVy = dirY;
            } else {
                dirX = this._lastVx;
                dirY = this._lastVy;
            }
        }

        const hasDirection = dirX !== 0 || dirY !== 0;
        const back = this.cfg.trailBackOffset || 0;
        this._lastPush = now;
        this.samples.push({
            rawX,
            rawY,
            x: hasDirection ? rawX - dirX * back : rawX,
            y: hasDirection ? rawY - dirY * back : rawY,
            width: pose.width || 1,
            height: pose.height || 1,
            hold: !hasDirection,
            age: 0
        });

        if (this.samples.length > this.cfg.maxCount) this.samples.shift();
    }

    update(dt = 16.67, weaponDepth = null) {
        if (!this.cfg.enabled || !this.graphics) {
            if (this.graphics) this.graphics.setVisible(false);
            return;
        }

        // 地图选择界面（非场景特定）：隐藏刀光，避免覆盖路线图
        if (this.scene._mapModeActive) {
            this.graphics.clear();
            this.graphics.setVisible(false);
            return;
        }

        const life = Math.max(1, this.cfg.lifeMs || 1);
        for (const sample of this.samples) sample.age += dt;
        this.samples = this.samples.filter(sample => sample.age < life);
        // 释放首帧 hold
        for (let i = 0; i < this.samples.length - 1; i++) {
            if (this.samples[i].hold && !this.samples[i + 1].hold) this.samples[i].hold = false;
        }

        const depth = typeof weaponDepth === 'number'
            ? weaponDepth
            : (this.scene.weaponSprite ? this.scene.weaponSprite.depth - 1 : 0);
        this.graphics.setDepth(depth);

        if (this.samples.filter(s => !s.hold).length < 2) {
            this.graphics.clear();
            this.graphics.setVisible(false);
            return;
        }

        const active = this.samples.filter(s => !s.hold);
        const layers = [
            { half: this.cfg.outerHalfWidth, alpha: this.cfg.alphaOuter },
            { half: this.cfg.midHalfWidth, alpha: this.cfg.alphaMid },
            { half: this.cfg.coreHalfWidth, alpha: this.cfg.alphaCore }
        ];

        this.graphics.clear();

        // 黑色轮廓底层：逐段绘制并随生命淡出，避免硬边拼接
        if (this.cfg.outlineEnabled) {
            this._drawRibbonSegments(active, this.cfg.outlineHalfWidth, this.cfg.outlineAlpha, this.cfg.outlineColor);
        }

        for (const layer of layers) {
            this._drawRibbonSegments(active, layer.half, layer.alpha, this.cfg.color);
        }

        if (this.cfg.particleEnabled) {
            this._drawParticles(active);
        }

        this.graphics.setVisible(true);
    }

    _alphaCurve(p) {
        const fadeIn = this.cfg.fadeInRatio || 0;
        const fadeOut = this.cfg.fadeOutRatio || 1;
        if (p <= fadeIn) return fadeIn > 0 ? p / fadeIn : 1;
        if (p >= fadeOut) return fadeOut < 1 ? (1 - p) / (1 - fadeOut) : 1;
        return 1;
    }

    _widthCurve(p) {
        const fadeOut = this.cfg.fadeOutRatio || 1;
        if (p >= fadeOut) return fadeOut < 1 ? Math.max(0, (1 - p) / (1 - fadeOut)) : 1;
        return 1;
    }

    _drawRibbonSegments(samples, halfWidthMul, baseAlpha, color) {
        const n = samples.length;
        const g = this.graphics;
        const life = Math.max(1, this.cfg.lifeMs || 1);

        for (let i = 0; i < n - 1; i++) {
            const a = samples[i];
            const b = samples[i + 1];
            const pA = Math.max(0, Math.min(1, a.age / life));
            const pB = Math.max(0, Math.min(1, b.age / life));
            let alpha = baseAlpha * this._alphaCurve((pA + pB) / 2);
            if (i === n - 2) alpha = Math.max(alpha, baseAlpha * 0.35); // 与剑衔接处保留软连接
            if (alpha <= 0.004) continue;

            let tx = b.rawX - a.rawX;
            let ty = b.rawY - a.rawY;
            let len = Math.hypot(tx, ty);
            if (len < 0.001) {
                tx = this._lastVx;
                ty = this._lastVy;
                len = Math.hypot(tx, ty) || 1;
            }
            tx /= len;
            ty /= len;
            const nx = -ty;
            const ny = tx;

            let hwA = a.width * halfWidthMul * this._widthCurve(pA);
            let hwB = b.width * halfWidthMul * this._widthCurve(pB);
            let ax = a.x;
            let ay = a.y;
            if (i === 0) {
                hwA = 0; // 尾端完全收尖
                ax -= tx * (this.cfg.tailLength || 0);
                ay -= ty * (this.cfg.tailLength || 0);
            }
            if (i === n - 2) hwB *= this.cfg.headWidthMul; // 衔接剑的一端收窄

            const l0x = ax - nx * hwA;
            const l0y = ay - ny * hwA;
            const r0x = ax + nx * hwA;
            const r0y = ay + ny * hwA;
            const l1x = b.x - nx * hwB;
            const l1y = b.y - ny * hwB;
            const r1x = b.x + nx * hwB;
            const r1y = b.y + ny * hwB;

            g.fillStyle(color, alpha);
            g.beginPath();
            g.moveTo(l0x, l0y);
            g.lineTo(l1x, l1y);
            g.lineTo(r1x, r1y);
            g.lineTo(r0x, r0y);
            g.closePath();
            g.fillPath();

            // 相邻段之间补一个小圆点，消除折线拼接感
            if (hwA + hwB > 1.2) {
                g.fillStyle(color, alpha * 0.35);
                g.fillCircle((a.x + b.x) / 2, (a.y + b.y) / 2, (hwA + hwB) * 0.5);
            }
        }
    }

    _drawParticles(samples) {
        const g = this.graphics;
        const life = Math.max(1, this.cfg.lifeMs || 1);
        const count = Math.max(0, this.cfg.particleCount || 0);
        for (let i = 0; i < samples.length; i++) {
            const s = samples[i];
            const p = Math.max(0, Math.min(1, s.age / life));
            const alpha = this.cfg.particleAlpha * this._alphaCurve(p);
            if (alpha <= 0.004) continue;

            const prev = samples[Math.max(0, i - 1)];
            const next = samples[Math.min(samples.length - 1, i + 1)];
            let tx = next.rawX - prev.rawX;
            let ty = next.rawY - prev.rawY;
            let len = Math.hypot(tx, ty);
            if (len < 0.001) {
                tx = this._lastVx;
                ty = this._lastVy;
                len = Math.hypot(tx, ty) || 1;
            }
            tx /= len;
            ty /= len;
            const nx = -ty;
            const ny = tx;

            const spread = s.width * (0.12 + (i % 3) * 0.05);
            for (let j = 0; j < count; j++) {
                const side = j === 0 ? 1 : -1;
                const along = ((i * 17 + j * 11) % 10) / 10 - 0.5;
                const px = s.x + nx * side * spread + tx * along * 8;
                const py = s.y + ny * side * spread + ty * along * 8;
                const radius = 1.2 + ((i + j) % 3) * 0.7;
                g.fillStyle(this.cfg.color, alpha);
                g.fillCircle(px, py, radius);
            }
        }
    }

    _buildRibbon(samples, halfWidthMul) {
        const left = [];
        const right = [];
        const n = samples.length;

        for (let i = 0; i < n; i++) {
            const s = samples[i];
            const prev = samples[Math.max(0, i - 1)];
            const next = samples[Math.min(n - 1, i + 1)];
            let tx = next.rawX - prev.rawX;
            let ty = next.rawY - prev.rawY;
            let len = Math.hypot(tx, ty);
            if (len < 0.001) {
                tx = this._lastVx;
                ty = this._lastVy;
                len = Math.hypot(tx, ty) || 1;
            }
            tx /= len;
            ty /= len;
            const nx = -ty;
            const ny = tx;

            let hw = s.width * halfWidthMul;
            let px = s.x;
            let py = s.y;

            if (i === 0) {
                // 尾端收成一点，并沿运动反方向再拖出一小段渐隐
                hw = 0;
                px = s.x - tx * (this.cfg.tailLength || 0);
                py = s.y - ty * (this.cfg.tailLength || 0);
            }

            left.push({ x: px - nx * hw, y: py - ny * hw });
            right.push({ x: px + nx * hw, y: py + ny * hw });
        }

        const smoothLeft = this._smooth(left);
        const smoothRight = this._smooth(right);
        return [...smoothLeft, ...smoothRight.reverse()];
    }

    _smooth(points) {
        if (!points || points.length < 3) return points ? [...points] : [];
        const steps = Math.max(1, Math.min(4, this.cfg.smoothSteps || 2));
        const out = [];
        const n = points.length;
        for (let i = 0; i < n - 1; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[Math.min(n - 1, i + 2)];
            for (let j = 0; j < steps; j++) {
                const t = j / steps;
                out.push(this._catmull(p0, p1, p2, p3, t));
            }
        }
        out.push(points[n - 1]);
        return out;
    }

    _catmull(p0, p1, p2, p3, t) {
        const t2 = t * t;
        const t3 = t2 * t;
        return {
            x: 0.5 * (
                2 * p1.x +
                (-p0.x + p2.x) * t +
                (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
            ),
            y: 0.5 * (
                2 * p1.y +
                (-p0.y + p2.y) * t +
                (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
            )
        };
    }

    clear() {
        this.samples = [];
        this._lastVx = 0;
        this._lastVy = 0;
        this._lastPush = -Infinity;
        if (this.graphics) {
            this.graphics.clear();
            this.graphics.setVisible(false);
        }
    }
}

export { DEFAULTS as SWORD_ARC_DEFAULTS };
