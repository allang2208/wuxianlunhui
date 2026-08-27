import { BlendModes } from 'phaser';

// 骑士长剑冲刺突击专属：多层直线剑气从剑后方展开，并在突刺中段依次汇聚到剑尖。
// 只负责视觉，不参与位移、命中或伤害判定。
const DEFAULTS = {
    enabled: true,
    lineCount: 5,
    backLength: 210,
    spread: 52,
    startProgress: 0.04,
    convergeProgress: 0.56,
    fadeOutProgress: 0.76,
    trailSpan: 0.34,
    glowWideWidth: 16,
    glowNarrowWidth: 7,
    glowWideAlpha: 0.035,
    glowNarrowAlpha: 0.08,
    shadowWidth: 5,
    shadowAlpha: 0.14,
    shadowColor: '0x09111d',
    coreOuterWidth: 2.4,
    coreInnerWidth: 0.75,
    coreOuterAlpha: 0.24,
    coreInnerAlpha: 0.72,
    color: '0xffffff',
    mistColor: '0xcfefff',
    segmentSteps: 14,
    tailFadeRatio: 0.3,
    headFadeRatio: 0.18,
    headAlphaScale: 0.58,
    tipWidthScale: 0.16,
    bellyWidthScale: 1,
};

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function easeOutCubic(value) {
    const t = clamp01(value);
    return 1 - (1 - t) ** 3;
}

function smoothStep(value) {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}

function parseColor(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = parseInt(value.trim().replace(/^#/, ''), 16);
        if (Number.isFinite(parsed)) return parsed;
    }
    return 0xffffff;
}

export class DashThrustConvergenceFx {
    constructor(scene, config = {}) {
        this.scene = scene;
        this.cfg = { ...DEFAULTS, ...(config || {}) };
        this.cfg.color = parseColor(this.cfg.color);
        this.cfg.shadowColor = parseColor(this.cfg.shadowColor);
        this.cfg.mistColor = parseColor(this.cfg.mistColor);
        this.glowGraphics = scene.add.graphics();
        this.coreGraphics = scene.add.graphics();
        this.glowGraphics.setBlendMode(BlendModes.ADD);
        this.glowGraphics.setVisible(false);
        this.coreGraphics.setVisible(false);
        this._anchorPose = null;
        this._wasActive = false;
        this._lastProgress = 0;
        this.scene.events?.once('shutdown', this.destroy, this);
    }

    update(_dt, state = {}) {
        const sprite = state.weaponSprite;
        const active = this.cfg.enabled
            && state.active
            && sprite?.active
            && sprite.visible
            && !state.mapMode;
        if (!active) {
            this.clear(true);
            return;
        }

        const progress = clamp01(state.progress);
        const restarted = !this._wasActive || progress + 0.02 < this._lastProgress;
        this._wasActive = true;
        this._lastProgress = progress;
        if (restarted) this._anchorPose = null;
        if (progress < this.cfg.startProgress) {
            this.clear(false);
            return;
        }

        const pose = this._resolveSwordPose(sprite);
        if (!pose) {
            this.clear(true);
            return;
        }
        if (!this._anchorPose) this._anchorPose = { ...pose };

        const effectProgress = clamp01(
            (progress - this.cfg.startProgress) / Math.max(0.001, 1 - this.cfg.startProgress)
        );
        const fade = effectProgress < 0.12
            ? effectProgress / 0.12
            : (effectProgress > this.cfg.fadeOutProgress
                ? (1 - effectProgress) / Math.max(0.001, 1 - this.cfg.fadeOutProgress)
                : 1);
        if (fade <= 0.002) {
            this.clear(false);
            return;
        }

        const depth = Number.isFinite(Number(state.depth))
            ? Number(state.depth)
            : sprite.depth - 0.01;
        this.glowGraphics.setDepth(depth - 0.002);
        this.coreGraphics.setDepth(depth - 0.001);
        this.glowGraphics.clear();
        this.coreGraphics.clear();

        const lines = this._buildLines(pose, effectProgress);
        this._drawLayer(
            this.glowGraphics,
            lines,
            this.cfg.glowWideWidth,
            this.cfg.glowWideAlpha * fade,
            this.cfg.mistColor
        );
        this._drawLayer(
            this.glowGraphics,
            lines,
            this.cfg.glowNarrowWidth,
            this.cfg.glowNarrowAlpha * fade
        );
        // 深色细底线不是第二道剑气，只用于保证白线跨过雪地/亮地砖时仍有轮廓。
        this._drawLayer(
            this.coreGraphics,
            lines,
            this.cfg.shadowWidth,
            this.cfg.shadowAlpha * fade,
            this.cfg.shadowColor
        );
        this._drawLayer(
            this.coreGraphics,
            lines,
            this.cfg.coreOuterWidth,
            this.cfg.coreOuterAlpha * fade
        );
        this._drawLayer(
            this.coreGraphics,
            lines,
            this.cfg.coreInnerWidth,
            this.cfg.coreInnerAlpha * fade
        );

        this.glowGraphics.setVisible(true);
        this.coreGraphics.setVisible(true);
    }

    _resolveSwordPose(sprite) {
        const width = Math.max(1, Number(sprite.displayWidth) || 1);
        const height = Math.max(1, Number(sprite.displayHeight) || 1);
        const originX = Number.isFinite(Number(sprite.originX)) ? Number(sprite.originX) : 0.5;
        const originY = Number.isFinite(Number(sprite.originY)) ? Number(sprite.originY) : 0.5;
        const rotation = Number(sprite.rotation) || 0;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);

        // 剑贴图竖向存放，剑尖位于局部顶部中心；dashThrust 旋转 ±90° 后水平前刺。
        const localTipX = (0.5 - originX) * width * (sprite.flipX ? -1 : 1);
        const localTipY = -originY * height * (sprite.flipY ? -1 : 1);
        const tipX = sprite.x + localTipX * cos - localTipY * sin;
        const tipY = sprite.y + localTipX * sin + localTipY * cos;
        const verticalFlip = sprite.flipY ? -1 : 1;
        const forwardX = sin * verticalFlip;
        const forwardY = -cos * verticalFlip;
        const normalX = -forwardY;
        const normalY = forwardX;
        if (![tipX, tipY, forwardX, forwardY].every(Number.isFinite)) return null;
        return { tipX, tipY, forwardX, forwardY, normalX, normalY };
    }

    _buildLines(pose, progress) {
        const count = Math.max(3, Math.floor(Number(this.cfg.lineCount) || 5));
        const anchor = this._anchorPose || pose;
        const lines = [];
        for (let i = 0; i < count; i++) {
            const lane = count > 1 ? i / (count - 1) * 2 - 1 : 0;
            const variance = Math.sin((i + 1) * 12.9898) * 0.5 + 0.5;
            const delay = Math.abs(lane) * 0.045 + variance * 0.035;
            const lineProgress = clamp01((progress - delay) / Math.max(0.001, 1 - delay));
            if (lineProgress <= 0) continue;

            const length = this.cfg.backLength * (0.84 + variance * 0.25);
            const spread = this.cfg.spread * lane * (0.8 + variance * 0.2);
            // 起点固定在动作刚进入可见阶段时的身后世界位置；剑尖继续逐帧读取真实
            // weaponSprite 变换。冲刺位移时线条因此会自然拉向前方，而不是整把扇面
            // 刚性黏在剑上平移。
            const startX = anchor.tipX - anchor.forwardX * length + anchor.normalX * spread;
            const startY = anchor.tipY - anchor.forwardY * length + anchor.normalY * spread;

            const headProgress = easeOutCubic(
                lineProgress / Math.max(0.001, this.cfg.convergeProgress)
            );
            // 保持一段短尾流追随线头；线头到剑尖后，尾端继续推进并真正收束。
            // 旧实现尾端上限只有0.42，动作结束仍留下整张大扇面，视觉上从未汇聚。
            const collapse = smoothStep(
                (lineProgress - this.cfg.convergeProgress)
                / Math.max(0.001, 1 - this.cfg.convergeProgress)
            );
            const remainingSpan = Math.max(0, Number(this.cfg.trailSpan) || 0.34) * (1 - collapse);
            const tailProgress = Math.max(0, headProgress - remainingSpan);
            // 严格直线：头尾都只在固定线源到实时剑尖之间做一次线性插值。
            // 宽度和透明度变化留给绘制层，几何本身绝不弯曲。
            lines.push({
                tailX: startX + (pose.tipX - startX) * tailProgress,
                tailY: startY + (pose.tipY - startY) * tailProgress,
                headX: startX + (pose.tipX - startX) * headProgress,
                headY: startY + (pose.tipY - startY) * headProgress,
                alpha: 0.62 + variance * 0.28,
                width: 0.84 + variance * 0.28,
            });
        }
        return lines;
    }

    _drawLayer(graphics, lines, width, alpha, color = this.cfg.color) {
        if (alpha <= 0.002 || width <= 0) return;
        const steps = Math.max(6, Math.floor(Number(this.cfg.segmentSteps) || 14));
        const tailFadeRatio = Math.max(0.01, Number(this.cfg.tailFadeRatio) || 0.3);
        const headFadeRatio = Math.max(0.01, Number(this.cfg.headFadeRatio) || 0.18);
        const headAlphaScale = Math.max(0, Math.min(1,
            Number(this.cfg.headAlphaScale) || 0.58));
        const tipWidthScale = Math.max(0.02, Number(this.cfg.tipWidthScale) || 0.16);
        const bellyWidthScale = Math.max(tipWidthScale,
            Number(this.cfg.bellyWidthScale) || 1);
        for (const line of lines) {
            for (let step = 1; step <= steps; step++) {
                const t0 = (step - 1) / steps;
                const t1 = step / steps;
                const middle = (t0 + t1) * 0.5;
                const tailFade = smoothStep(middle / tailFadeRatio);
                const headFade = smoothStep(
                    (middle - (1 - headFadeRatio)) / headFadeRatio
                );
                const segmentAlpha = alpha * line.alpha * tailFade
                    * (1 - headFade * (1 - headAlphaScale));
                if (segmentAlpha <= 0.002) continue;
                const belly = Math.pow(Math.max(0, Math.sin(Math.PI * middle)), 0.58);
                const widthScale = tipWidthScale
                    + (bellyWidthScale - tipWidthScale) * belly;
                const x0 = line.tailX + (line.headX - line.tailX) * t0;
                const y0 = line.tailY + (line.headY - line.tailY) * t0;
                const x1 = line.tailX + (line.headX - line.tailX) * t1;
                const y1 = line.tailY + (line.headY - line.tailY) * t1;
                graphics.lineStyle(width * widthScale * line.width, color, segmentAlpha);
                graphics.beginPath();
                graphics.moveTo(x0, y0);
                graphics.lineTo(x1, y1);
                graphics.strokePath();
            }
        }
    }

    clear(resetBurst = true) {
        this.glowGraphics?.clear();
        this.coreGraphics?.clear();
        this.glowGraphics?.setVisible(false);
        this.coreGraphics?.setVisible(false);
        if (resetBurst) {
            this._anchorPose = null;
            this._wasActive = false;
            this._lastProgress = 0;
        }
    }

    destroy() {
        this.scene?.events?.off('shutdown', this.destroy, this);
        if (this.glowGraphics?.active) this.glowGraphics.destroy();
        if (this.coreGraphics?.active) this.coreGraphics.destroy();
        this.glowGraphics = null;
        this.coreGraphics = null;
        this.scene = null;
    }
}

export { DEFAULTS as DASH_THRUST_CONVERGENCE_DEFAULTS };
