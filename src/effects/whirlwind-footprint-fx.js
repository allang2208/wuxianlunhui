import { BlendModes } from 'phaser';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';

// 玩家风车释放期脚底视觉：只覆盖 footprint，不参与命中、伤害或移动。
const DEFAULTS = {
    enabled: true,
    radiusPadding: 18,
    minRadius: 34,
    rotationSpeed: 0.013,
    fadeInRatio: 0.08,
    fadeOutRatio: 0.22,
    shadowColor: '0x27465e',
    groundWaveStartProgress: 0.18,
    groundWaveCount: 4,
    groundWaveStagger: 0.1,
    groundWaveLifetime: 0.52,
    groundWaveStartScale: 0.42,
    groundWaveEndScale: 4.05,
    groundWaveExpansionPower: 1.18,
    groundWaveRotationMultiplier: 0.32,
    groundWaveSpinAcceleration: 0.85,
    groundWaveSpiralTailScale: 0.84,
    groundWaveSpiralHeadScale: 1.08,
    groundWaveFadeInRatio: 0.14,
    groundWaveFadeOutRatio: 0.18,
    groundWaveArcCount: 4,
    groundWaveArcCoverage: 0.68,
    groundWaveArcSteps: 12,
    groundWaveArcVariance: 0.14,
    groundWaveArcOffsetVariance: 0.08,
    groundWaveRadiusVariance: 0.05,
    groundWaveTailFadeRatio: 0.28,
    groundWaveHeadFadeRatio: 0.11,
    groundWaveWidthGrowth: 0.28,
    groundWaveWakeOffsetScale: 0.22,
    groundWaveWakeWidth: 3.8,
    groundWaveWakeAlpha: 0.075,
    groundWaveShadowWidth: 18,
    groundWaveShadowAlpha: 0.1,
    groundWaveMistWidth: 18,
    groundWaveMistAlpha: 0.1,
    groundWaveGlowWidth: 7,
    groundWaveGlowAlpha: 0.16,
    groundWaveCoreWidth: 1.6,
    groundWaveCoreAlpha: 0.44,
    bodyRingEnabled: true,
    bodyRingCenterOffsetY: -88,
    bodyRingStartProgress: 0.18,
    bodyRingEndProgress: 0.9,
    bodyRingCount: 2,
    bodyRingStagger: 0.3,
    bodyRingLifetime: 0.68,
    bodyRingStartRadius: 18,
    bodyRingEndRadius: 82,
    bodyRingPerspectiveY: 0.32,
    bodyRingSegments: 52,
    bodyRingMistWidth: 13,
    bodyRingMistAlpha: 0.09,
    bodyRingGlowWidth: 5.5,
    bodyRingGlowAlpha: 0.14,
    bodyRingCoreWidth: 1.15,
    bodyRingCoreAlpha: 0.38,
    color: '0x8edcff',
};

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

function parseColor(value, fallback = 0xffffff) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = parseInt(value.trim().replace(/^#/, ''), 16);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

function smoothStep(value) {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}

function easeOutCubic(value) {
    const t = clamp01(value);
    return 1 - Math.pow(1 - t, 3);
}

function lerp(from, to, progress) {
    return from + (to - from) * clamp01(progress);
}

export class WhirlwindFootprintFx {
    constructor(scene, config = {}) {
        this.scene = scene;
        this.cfg = { ...DEFAULTS, ...(config || {}) };
        this.cfg.color = parseColor(this.cfg.color, 0xffffff);
        this.cfg.shadowColor = parseColor(this.cfg.shadowColor, 0x51606d);
        this.shadowGraphics = scene.add.graphics();
        this.glowGraphics = scene.add.graphics();
        this.glowGraphics.setBlendMode(BlendModes.ADD);
        this.bodyBackGraphics = scene.add.graphics();
        this.bodyFrontGraphics = scene.add.graphics();
        this.bodyBackGraphics.setBlendMode(BlendModes.ADD);
        this.bodyFrontGraphics.setBlendMode(BlendModes.ADD);
        this.shadowGraphics.setVisible(false);
        this.glowGraphics.setVisible(false);
        this.bodyBackGraphics.setVisible(false);
        this.bodyFrontGraphics.setVisible(false);
        this.angle = 0;
        this._wasActive = false;
        this.scene.events?.once('shutdown', this.destroy, this);
    }

    update(dt = 16.67, state = {}) {
        const player = state.player;
        const active = this.cfg.enabled
            && state.active
            && player?.active
            && !state.mapMode
            && state.visible !== false;
        if (!active) {
            this.clear(true);
            return;
        }

        const duration = Math.max(1, Number(state.duration) || 800);
        const progress = clamp01((Number(state.elapsed) || 0) / duration);
        const fadeIn = smoothStep(progress / Math.max(0.001, Number(this.cfg.fadeInRatio) || 0.12));
        const fadeOut = smoothStep(
            (1 - progress) / Math.max(0.001, Number(this.cfg.fadeOutRatio) || 0.16)
        );
        const alpha = Math.min(fadeIn, fadeOut);
        if (alpha <= 0.002) {
            this.clear(false);
            return;
        }

        if (!this._wasActive) this.angle = -Math.PI * 0.18;
        this._wasActive = true;
        this.angle = (this.angle + (Number(this.cfg.rotationSpeed) || 0.0115) * dt) % (Math.PI * 2);

        const baseRadius = Number(player.collider?.radius)
            || Number(player.collisionRadius)
            || 18;
        const radius = Math.max(
            Number(this.cfg.minRadius) || 24,
            baseRadius + (Number(this.cfg.radiusPadding) || 9)
        );
        const radiusY = radius * PERSPECTIVE_SCALE_Y;
        const depth = Number.isFinite(Number(state.depth)) ? Number(state.depth) : player.y - 0.25;
        this.shadowGraphics.setDepth(depth - 0.002);
        this.glowGraphics.setDepth(depth - 0.001);
        this.shadowGraphics.clear();
        this.glowGraphics.clear();

        const centerX = Number(player.collider?.x ?? player.x) || 0;
        const centerY = Number(player.collider?.y ?? player.y) || 0;
        this._drawGroundBladeWaves(
            this.shadowGraphics,
            this.glowGraphics,
            centerX,
            centerY,
            radius,
            radiusY,
            progress,
            alpha
        );
        this._drawBodyRing(centerX, player, progress, alpha, state);

        this.shadowGraphics.setVisible(true);
        this.glowGraphics.setVisible(true);
    }

    _drawGroundBladeWaves(shadowGraphics, glowGraphics, centerX, centerY,
        radius, radiusY, progress, alpha) {
        const startProgress = clamp01(this.cfg.groundWaveStartProgress);
        const count = Math.max(1, Math.floor(Number(this.cfg.groundWaveCount) || 4));
        const stagger = Math.max(0.01, Number(this.cfg.groundWaveStagger) || 0.1);
        const lifetime = Math.max(0.05, Number(this.cfg.groundWaveLifetime) || 0.52);
        const startScale = Math.max(0.05, Number(this.cfg.groundWaveStartScale) || 0.42);
        const endScale = Math.max(startScale, Number(this.cfg.groundWaveEndScale) || 4.05);
        const expansionPower = Math.max(0.2, Number(this.cfg.groundWaveExpansionPower) || 1.18);
        const rotationMultiplier = Number(this.cfg.groundWaveRotationMultiplier) || 0.32;
        const spinAcceleration = Number(this.cfg.groundWaveSpinAcceleration) || 0.85;
        const spiralTailScale = Math.max(0.2,
            Number(this.cfg.groundWaveSpiralTailScale) || 0.84);
        const spiralHeadScale = Math.max(spiralTailScale,
            Number(this.cfg.groundWaveSpiralHeadScale) || 1.08);
        const waveFadeIn = Math.max(0.01, Number(this.cfg.groundWaveFadeInRatio) || 0.14);
        const waveFadeOut = Math.max(0.01, Number(this.cfg.groundWaveFadeOutRatio) || 0.18);
        const arcCount = Math.max(2, Math.floor(Number(this.cfg.groundWaveArcCount) || 4));
        const arcCoverage = Math.max(0.25, Math.min(0.94,
            Number(this.cfg.groundWaveArcCoverage) || 0.68));
        const arcSteps = Math.max(6, Math.floor(Number(this.cfg.groundWaveArcSteps) || 12));
        const arcVariance = Math.max(0, Number(this.cfg.groundWaveArcVariance) || 0.14);
        const arcOffsetVariance = Math.max(0,
            Number(this.cfg.groundWaveArcOffsetVariance) || 0.08);
        const radiusVariance = Math.max(0, Number(this.cfg.groundWaveRadiusVariance) || 0.05);
        const tailFadeRatio = Math.max(0.01, Number(this.cfg.groundWaveTailFadeRatio) || 0.28);
        const headFadeRatio = Math.max(0.01, Number(this.cfg.groundWaveHeadFadeRatio) || 0.11);
        const widthGrowth = Math.max(0, Number(this.cfg.groundWaveWidthGrowth) || 0.28);
        const wakeOffsetScale = Math.max(0, Number(this.cfg.groundWaveWakeOffsetScale) || 0.22);
        const wakeWidth = Math.max(0, Number(this.cfg.groundWaveWakeWidth) || 3.8);
        const wakeAlpha = Math.max(0, Number(this.cfg.groundWaveWakeAlpha) || 0.075);
        const sectorSpan = Math.PI * 2 / arcCount;
        const baseArcSpan = sectorSpan * arcCoverage;

        for (let waveIndex = 0; waveIndex < count; waveIndex++) {
            const waveStart = startProgress + waveIndex * stagger;
            const localProgress = (progress - waveStart) / lifetime;
            if (localProgress <= 0 || localProgress >= 1) continue;

            // 接近线性的持续外推：避免前半段冲到外圈、后半段停住只剩白圈。
            const expansion = Math.pow(localProgress, expansionPower);
            const waveScale = lerp(startScale, endScale, expansion);
            const lifeAlpha = Math.min(
                smoothStep(localProgress / waveFadeIn),
                smoothStep((1 - localProgress) / waveFadeOut)
            ) * alpha;
            const phase = waveIndex * 0.57
                + this.angle * rotationMultiplier
                + Math.pow(localProgress, 1.55) * spinAcceleration;

            for (let arcIndex = 0; arcIndex < arcCount; arcIndex++) {
                const shapeSeed = Math.sin((arcIndex + 1) * 2.17 + waveIndex * 1.31);
                const offsetSeed = Math.sin((arcIndex + 1) * 1.43 + waveIndex * 2.03);
                const radiusSeed = Math.sin((arcIndex + 1) * 2.71 + waveIndex * 0.79);
                const arcSpan = baseArcSpan * (1 + shapeSeed * arcVariance);
                const arcStart = phase
                    + arcIndex * sectorSpan
                    + (sectorSpan - arcSpan) * 0.5
                    + offsetSeed * sectorSpan * arcOffsetVariance;
                const arcRadiusMul = 1 + radiusSeed * radiusVariance;
                for (let step = 1; step <= arcSteps; step++) {
                    const t0 = (step - 1) / arcSteps;
                    const t1 = step / arcSteps;
                    const angle0 = arcStart + arcSpan * t0;
                    const angle1 = arcStart + arcSpan * t1;
                    const taper0 = smoothStep(t0 / tailFadeRatio)
                        * smoothStep((1 - t0) / headFadeRatio);
                    const taper1 = smoothStep(t1 / tailFadeRatio)
                        * smoothStep((1 - t1) / headFadeRatio);
                    const segmentAlpha = lifeAlpha * (taper0 + taper1) * 0.5;
                    if (segmentAlpha <= 0.002) continue;
                    const middle = (t0 + t1) * 0.5;
                    const bladeBelly = Math.pow(Math.max(0,
                        Math.sin(Math.PI * Math.pow(middle, 1.45))), 0.55);
                    const widthScale = Math.max(0.12, bladeBelly)
                        * (1 + localProgress * widthGrowth);

                    // 尾端贴近内圈、头端探向外圈，旋转时形成持续外卷的螺旋剑气。
                    const spiral0 = lerp(spiralTailScale, spiralHeadScale, t0)
                        * (1 + Math.sin(Math.PI * t0) * 0.035) * arcRadiusMul;
                    const spiral1 = lerp(spiralTailScale, spiralHeadScale, t1)
                        * (1 + Math.sin(Math.PI * t1) * 0.035) * arcRadiusMul;
                    const x0 = centerX + Math.cos(angle0) * radius * waveScale * spiral0;
                    const y0 = centerY + Math.sin(angle0) * radiusY * waveScale * spiral0;
                    const x1 = centerX + Math.cos(angle1) * radius * waveScale * spiral1;
                    const y1 = centerY + Math.sin(angle1) * radiusY * waveScale * spiral1;

                    // 主弧内侧保留一条较细的延迟残影，强化高速旋转与向外甩出的重量感。
                    const wakeScale = Math.max(startScale * 0.55, waveScale - wakeOffsetScale);
                    const wakeX0 = centerX + Math.cos(angle0) * radius * wakeScale * spiral0;
                    const wakeY0 = centerY + Math.sin(angle0) * radiusY * wakeScale * spiral0;
                    const wakeX1 = centerX + Math.cos(angle1) * radius * wakeScale * spiral1;
                    const wakeY1 = centerY + Math.sin(angle1) * radiusY * wakeScale * spiral1;
                    this._strokeWaveSegment(
                        glowGraphics,
                        wakeX0, wakeY0, wakeX1, wakeY1,
                        wakeWidth * widthScale,
                        wakeAlpha * segmentAlpha,
                        this.cfg.color
                    );

                    this._strokeWaveSegment(
                        shadowGraphics,
                        x0, y0, x1, y1,
                        (Number(this.cfg.groundWaveShadowWidth) || 18) * widthScale,
                        (Number(this.cfg.groundWaveShadowAlpha) || 0.1) * segmentAlpha,
                        this.cfg.shadowColor
                    );
                    this._strokeWaveSegment(
                        glowGraphics,
                        x0, y0, x1, y1,
                        (Number(this.cfg.groundWaveMistWidth) || 18) * widthScale,
                        (Number(this.cfg.groundWaveMistAlpha) || 0.1) * segmentAlpha,
                        this.cfg.color
                    );
                    this._strokeWaveSegment(
                        glowGraphics,
                        x0, y0, x1, y1,
                        (Number(this.cfg.groundWaveGlowWidth) || 7) * widthScale,
                        (Number(this.cfg.groundWaveGlowAlpha) || 0.16) * segmentAlpha,
                        this.cfg.color
                    );
                    this._strokeWaveSegment(
                        shadowGraphics,
                        x0, y0, x1, y1,
                        (Number(this.cfg.groundWaveCoreWidth) || 1.6) * widthScale,
                        (Number(this.cfg.groundWaveCoreAlpha) || 0.44) * segmentAlpha,
                        this.cfg.color
                    );
                }
            }
        }
    }

    _strokeWaveSegment(graphics, x0, y0, x1, y1, width, alpha, color) {
        if (width <= 0 || alpha <= 0.002) return;
        graphics.lineStyle(width, color, alpha);
        graphics.beginPath();
        graphics.moveTo(x0, y0);
        graphics.lineTo(x1, y1);
        graphics.strokePath();
    }

    _drawBodyRing(centerX, player, progress, alpha, state) {
        this.bodyBackGraphics.clear();
        this.bodyFrontGraphics.clear();
        this.bodyBackGraphics.setVisible(false);
        this.bodyFrontGraphics.setVisible(false);

        if (!this.cfg.bodyRingEnabled || alpha <= 0.002) return;
        const startProgress = clamp01(this.cfg.bodyRingStartProgress);
        const endProgress = Math.max(startProgress + 0.001, clamp01(this.cfg.bodyRingEndProgress));
        if (progress <= startProgress || progress >= endProgress) return;

        const phaseProgress = clamp01((progress - startProgress) / (endProgress - startProgress));
        const playerDepth = Number.isFinite(Number(state.playerDepth))
            ? Number(state.playerDepth)
            : Number(player.y) || 0;
        const weaponBackDepth = Number(state.weaponBackDepth);
        const backCandidates = [playerDepth - 0.21];
        if (Number.isFinite(weaponBackDepth)) backCandidates.push(weaponBackDepth - 0.01);

        // 同一个空间环拆成上下两个半环：上半环在人物/武器后，下半环在它们前。
        // 前半环只越过人物和后侧剑，仍压在前侧剑之下；人物深度已继承墙体遮挡仲裁。
        this.bodyBackGraphics.setDepth(Math.min(...backCandidates));
        this.bodyFrontGraphics.setDepth(playerDepth + 0.06);

        const centerY = (Number(player.y) || 0) + (Number(this.cfg.bodyRingCenterOffsetY) || -88);
        const count = Math.max(1, Math.floor(Number(this.cfg.bodyRingCount) || 1));
        const stagger = Math.max(0, Number(this.cfg.bodyRingStagger) || 0.3);
        const lifetime = Math.max(0.05, Number(this.cfg.bodyRingLifetime) || 0.68);
        const startRadius = Math.max(1, Number(this.cfg.bodyRingStartRadius) || 18);
        const endRadius = Math.max(startRadius, Number(this.cfg.bodyRingEndRadius) || 82);
        const perspectiveY = Math.max(0.08, Number(this.cfg.bodyRingPerspectiveY) || 0.32);
        const segments = Math.max(16, Math.floor(Number(this.cfg.bodyRingSegments) || 52));

        for (let ringIndex = 0; ringIndex < count; ringIndex++) {
            const localProgress = (phaseProgress - ringIndex * stagger) / lifetime;
            if (localProgress <= 0 || localProgress >= 1) continue;
            const radius = lerp(startRadius, endRadius, easeOutCubic(localProgress));
            const radiusY = radius * perspectiveY;
            const lifeAlpha = Math.pow(Math.sin(Math.PI * localProgress), 0.72) * alpha;
            const rotation = this.angle * (0.58 + ringIndex * 0.12) + ringIndex * 0.82;

            for (let segment = 0; segment < segments; segment++) {
                const t0 = segment / segments;
                const t1 = (segment + 1) / segments;
                const angle0 = rotation + t0 * Math.PI * 2;
                const angle1 = rotation + t1 * Math.PI * 2;
                const middleAngle = (angle0 + angle1) * 0.5;
                const texture = 0.28 + 0.72 * smoothStep(
                    (Math.sin(t0 * Math.PI * 8 + ringIndex * 1.9 + this.angle * 1.35) + 1) * 0.5
                );
                const edgeSoftness = 0.72 + 0.28 * Math.sin(Math.PI * localProgress);
                const segmentAlpha = lifeAlpha * texture * edgeSoftness;
                const wobble0 = Math.sin(angle0 * 3 + this.angle * 1.8 + ringIndex) * 1.8;
                const wobble1 = Math.sin(angle1 * 3 + this.angle * 1.8 + ringIndex) * 1.8;
                const x0 = centerX + Math.cos(angle0) * radius;
                const y0 = centerY + Math.sin(angle0) * radiusY + wobble0;
                const x1 = centerX + Math.cos(angle1) * radius;
                const y1 = centerY + Math.sin(angle1) * radiusY + wobble1;
                const graphics = Math.sin(middleAngle) < 0
                    ? this.bodyBackGraphics
                    : this.bodyFrontGraphics;
                this._drawBodyRingSegment(graphics, x0, y0, x1, y1, segmentAlpha);
            }
        }

        this.bodyBackGraphics.setVisible(true);
        this.bodyFrontGraphics.setVisible(true);
    }

    _drawBodyRingSegment(graphics, x0, y0, x1, y1, alpha) {
        if (alpha <= 0.002) return;
        const passes = [
            [Number(this.cfg.bodyRingMistWidth) || 13, Number(this.cfg.bodyRingMistAlpha) || 0.09],
            [Number(this.cfg.bodyRingGlowWidth) || 5.5, Number(this.cfg.bodyRingGlowAlpha) || 0.14],
            [Number(this.cfg.bodyRingCoreWidth) || 1.15, Number(this.cfg.bodyRingCoreAlpha) || 0.38],
        ];
        for (const [width, passAlpha] of passes) {
            if (width <= 0 || passAlpha <= 0) continue;
            graphics.lineStyle(width, this.cfg.color, passAlpha * alpha);
            graphics.beginPath();
            graphics.moveTo(x0, y0);
            graphics.lineTo(x1, y1);
            graphics.strokePath();
        }
    }

    clear(resetAngle = true) {
        this.shadowGraphics?.clear();
        this.glowGraphics?.clear();
        this.bodyBackGraphics?.clear();
        this.bodyFrontGraphics?.clear();
        this.shadowGraphics?.setVisible(false);
        this.glowGraphics?.setVisible(false);
        this.bodyBackGraphics?.setVisible(false);
        this.bodyFrontGraphics?.setVisible(false);
        if (resetAngle) {
            this.angle = 0;
            this._wasActive = false;
        }
    }

    destroy() {
        this.scene?.events?.off('shutdown', this.destroy, this);
        if (this.shadowGraphics?.active) this.shadowGraphics.destroy();
        if (this.glowGraphics?.active) this.glowGraphics.destroy();
        if (this.bodyBackGraphics?.active) this.bodyBackGraphics.destroy();
        if (this.bodyFrontGraphics?.active) this.bodyFrontGraphics.destroy();
        this.shadowGraphics = null;
        this.glowGraphics = null;
        this.bodyBackGraphics = null;
        this.bodyFrontGraphics = null;
        this.scene = null;
    }
}

export { DEFAULTS as WHIRLWIND_FOOTPRINT_DEFAULTS };
