// 环境光照状态：为接触阴影、静态投影和后续局部光效提供唯一的太阳输入。
// 当前阶段只消费其太阳投影参数；不依赖 WebGL，因此 AUTO 回退到 Canvas 时同样可用。
import { isoLocalToWorldDelta } from '../physics/iso-footprint.js';

const TAU = Math.PI * 2;
const SHADOW_OPACITY_MULTIPLIER = 1.5;

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
        const opacity = clamp(
            (Number(style.opacity ?? (0.42 + (1 - this._sun.elevation) * 0.16)) || 0)
            * SHADOW_OPACITY_MULTIPLIER,
            0,
            1
        );

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
        const opacity = clamp(
            (Number(options.opacity ?? (0.36 + (1 - this._sun.elevation) * 0.20)) || 0)
            * SHADOW_OPACITY_MULTIPLIER,
            0,
            1
        );

        return {
            offsetX: this._sun.shadowX * length * 0.5,
            offsetY: this._sun.shadowY * length * 0.5,
            length,
            opacity,
        };
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
