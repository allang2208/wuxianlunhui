import { isoLocalToWorldDelta } from '../physics/iso-footprint.js';
import { WORLD_RENDER_LAYERS } from './world-render-layers.js';

const SAND_STREAK_TEXTURE = 'windblown_sand_streak';
const SAND_HAZE_TEXTURE = 'windblown_sand_haze';
const FOREGROUND_WEATHER_DEPTH = 99975;
const MAX_EMISSIONS_PER_FRAME = 4;
const TWO_PI = Math.PI * 2;
const QUALITY_MULTIPLIERS = Object.freeze({
    low: 0.6,
    medium: 1,
    high: 1.4,
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function readRange(value, fallbackMin, fallbackMax) {
    const min = Number.isFinite(Number(value?.min)) ? Number(value.min) : fallbackMin;
    const max = Number.isFinite(Number(value?.max)) ? Number(value.max) : fallbackMax;
    return { min: Math.min(min, max), max: Math.max(min, max) };
}

function parseTints(values, fallback) {
    const source = Array.isArray(values) && values.length > 0 ? values : fallback;
    return source.map((value) => {
        if (Number.isFinite(Number(value))) return Number(value);
        const parsed = Number.parseInt(String(value).replace(/^#|^0x/i, ''), 16);
        return Number.isFinite(parsed) ? parsed : 0xffffff;
    });
}

function resolveModeConfig(config, sandstormActive) {
    const visual = sandstormActive ? config?.sandstorm?.visual : null;
    if (!visual) return config;
    return {
        ...config,
        ...visual,
        ground: { ...(config.ground || {}), ...(visual.ground || {}) },
        foreground: { ...(config.foreground || {}), ...(visual.foreground || {}) },
    };
}

function resolveDiamond(sceneConfig) {
    const width = Math.max(1, Number(sceneConfig?.width) || 1);
    const height = Math.max(1, Number(sceneConfig?.height) || 1);
    const floor = sceneConfig?.diamondFloor || {};
    const rx = Math.max(1, Number(floor.rx) || width / 2);
    return {
        cx: Number.isFinite(Number(floor.cx)) ? Number(floor.cx) : width / 2,
        cy: Number.isFinite(Number(floor.cy)) ? Number(floor.cy) : height / 2,
        rx,
        ry: Math.max(1, Number(floor.ry) || rx * 0.5),
    };
}

function isInsideDiamond(diamond, x, y) {
    return Math.abs(x - diamond.cx) / diamond.rx
        + Math.abs(y - diamond.cy) / diamond.ry <= 1;
}

function ensureSoftEllipseTexture(scene, key, width, height, innerStop = 0.45) {
    if (scene?.textures?.exists(key)) return true;
    if (!scene?.textures?.createCanvas) return false;
    const texture = scene.textures.createCanvas(key, width, height);
    const context = texture.getContext();
    const radius = height / 2;
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(width / 2, height / 2);
    context.scale(width / height, 1);
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(innerStop, 'rgba(255,255,255,0.82)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(-radius, -radius, radius * 2, radius * 2);
    context.restore();
    texture.refresh();
    return true;
}

/**
 * 世界-122 的纯视觉风吹扬沙。
 *
 * 两个常驻 ParticleEmitter 只围绕当前相机发射：贴地风线位于固定地表层，
 * 薄沙雾位于世界对象之上、战争迷雾与昼夜覆盖层之下。系统不创建实体、
 * 不接物理或存档，并且只消费 GameScene 传入的统一世界 delta。
 */
export class WindblownSandSystem {
    constructor(scene) {
        this.scene = scene;
        this._groundEmitter = null;
        this._foregroundEmitter = null;
        this._activeConfig = null;
        this._modeConfig = null;
        this._sandstormActive = false;
        this._sceneConfig = null;
        this._diamond = null;
        this._qualityMultiplier = 1;
        this._wind = { x: 1, y: 0 };
        this._windUvAngle = 0;
        this._directionElapsedMs = 0;
        this._directionHoldMs = 0;
        this._elapsedMs = 0;
        this._groundAccumulatorMs = 0;
        this._foregroundAccumulatorMs = 0;
    }

    update({
        sceneId,
        sceneConfig,
        deltaMs = 0,
        running = true,
        loading = false,
        daylight = 1,
        sandstormActive = false,
    } = {}) {
        const config = sceneConfig?.environmentEffects?.windblownSand;
        if (loading || sceneId !== 'scene8' || !config?.enabled) {
            this.reset();
            return;
        }

        const stormMode = !!sandstormActive && config.sandstorm?.enabled !== false;
        if (this._activeConfig !== config || this._sandstormActive !== stormMode) {
            this._activate(config, sceneConfig, stormMode);
        }
        if (!this._groundEmitter && !this._foregroundEmitter) return;
        const modeConfig = this._modeConfig || config;

        const isRunning = running && deltaMs > 0;
        this._setEmitterTimeScale(isRunning ? 1 : 0);
        if (!isRunning) return;

        const stepMs = Math.max(0, Number(deltaMs) || 0);
        this._elapsedMs += stepMs;
        this._advanceWindDirection(modeConfig, stepMs);

        const periodMs = Math.max(1000, Number(modeConfig.gustPeriodMs) || 10000);
        const amplitude = clamp(Number(modeConfig.gustAmplitude) || 0, 0, 1);
        const wave = (Math.sin((this._elapsedMs / periodMs) * Math.PI * 2) + 1) * 0.5;
        const gustPulse = wave * wave * wave;
        const gustIntensity = 1 + amplitude * gustPulse;
        const lightFactor = 0.7 + clamp(Number(daylight) || 0, 0, 1) * 0.3;
        const gustAlpha = 0.86 + gustPulse * 0.14;

        this._groundEmitter?.setAlpha(lightFactor * gustAlpha);
        this._foregroundEmitter?.setAlpha(lightFactor * gustAlpha);

        this._advanceLayer('ground', this._groundEmitter, modeConfig.ground, stepMs, gustIntensity);
        this._advanceLayer('foreground', this._foregroundEmitter, modeConfig.foreground, stepMs, gustIntensity);
    }

    reset() {
        this._groundEmitter?.destroy();
        this._foregroundEmitter?.destroy();
        this._groundEmitter = null;
        this._foregroundEmitter = null;
        this._activeConfig = null;
        this._modeConfig = null;
        this._sandstormActive = false;
        this._sceneConfig = null;
        this._diamond = null;
        this._windUvAngle = 0;
        this._directionElapsedMs = 0;
        this._directionHoldMs = 0;
        this._elapsedMs = 0;
        this._groundAccumulatorMs = 0;
        this._foregroundAccumulatorMs = 0;
    }

    destroy() {
        this.reset();
        this.scene = null;
    }

    _activate(config, sceneConfig, sandstormActive = false) {
        this.reset();
        this._activeConfig = config;
        this._sandstormActive = sandstormActive;
        this._modeConfig = resolveModeConfig(config, sandstormActive);
        this._sceneConfig = sceneConfig;
        this._diamond = resolveDiamond(sceneConfig);
        const modeConfig = this._modeConfig;
        this._qualityMultiplier = QUALITY_MULTIPLIERS[modeConfig.quality] || QUALITY_MULTIPLIERS.medium;

        this._setWindDirectionUv(modeConfig.windUv?.u, modeConfig.windUv?.v);
        this._directionHoldMs = this._pickDirectionHoldMs(modeConfig);

        const hasStreakTexture = ensureSoftEllipseTexture(this.scene, SAND_STREAK_TEXTURE, 64, 8, 0.35);
        const hasHazeTexture = ensureSoftEllipseTexture(this.scene, SAND_HAZE_TEXTURE, 96, 48, 0.28);
        if (modeConfig.ground?.enabled !== false && hasStreakTexture) {
            this._groundEmitter = this._createEmitter(
                SAND_STREAK_TEXTURE,
                modeConfig.ground || {},
                WORLD_RENDER_LAYERS.GROUND_WEATHER,
                false
            );
        }
        if (modeConfig.foreground?.enabled !== false && hasHazeTexture) {
            this._foregroundEmitter = this._createEmitter(
                SAND_HAZE_TEXTURE,
                modeConfig.foreground || {},
                FOREGROUND_WEATHER_DEPTH,
                true
            );
        }
    }

    _createEmitter(texture, layerConfig, depth, foreground) {
        const fallbackSpeed = foreground ? [70, 120] : [140, 230];
        const fallbackLife = foreground ? [2600, 4000] : [1400, 2400];
        const speed = readRange(layerConfig.speedPxPerSec, ...fallbackSpeed);
        const lifespan = readRange(layerConfig.lifespanMs, ...fallbackLife);
        const alpha = layerConfig.alpha || {};
        const maxAlive = Math.max(1, Math.round(
            (Number(layerConfig.maxAliveParticles) || (foreground ? 40 : 64)) * this._qualityMultiplier
        ));
        const emitterConfig = {
            emitting: false,
            frequency: -1,
            ...this._windMotionConfig(speed),
            lifespan,
            alpha: {
                start: Number.isFinite(Number(alpha.start)) ? Number(alpha.start) : (foreground ? 0.34 : 0.72),
                end: Number.isFinite(Number(alpha.end)) ? Number(alpha.end) : (foreground ? 0.05 : 0.08),
            },
            tint: parseTints(
                layerConfig.tints,
                foreground ? ['#ffd27a', '#e07828', '#7a3c18'] : ['#fff3c4', '#f19a38', '#86431c']
            ),
            blendMode: 'NORMAL',
            maxAliveParticles: maxAlive,
            reserve: maxAlive,
        };

        if (foreground) {
            const scale = layerConfig.scale || {};
            emitterConfig.scale = {
                start: Number(scale.start) || 1.05,
                end: Number(scale.end) || 2.1,
            };
        } else {
            emitterConfig.scaleX = readRange(layerConfig.scaleX, 1.1, 2.1);
            emitterConfig.scaleY = readRange(layerConfig.scaleY, 0.85, 1.4);
        }

        const emitter = this.scene.add.particles(0, 0, texture, emitterConfig);
        emitter.addToUpdateList();
        emitter.setDepth(depth);
        return emitter;
    }

    _setWindDirectionUv(rawU, rawV) {
        let u = Number.isFinite(Number(rawU)) ? Number(rawU) : 1;
        let v = Number.isFinite(Number(rawV)) ? Number(rawV) : 0;
        const uvLength = Math.hypot(u, v);
        if (uvLength <= 0.0001) {
            u = 1;
            v = 0;
        } else {
            u /= uvLength;
            v /= uvLength;
        }

        this._windUvAngle = Math.atan2(v, u);
        const projectedWind = isoLocalToWorldDelta(u, v);
        const windLength = Math.hypot(projectedWind.x, projectedWind.y) || 1;
        this._wind = { x: projectedWind.x / windLength, y: projectedWind.y / windLength };
    }

    _windMotionConfig(speed) {
        const angle = Math.atan2(this._wind.y, this._wind.x) * 180 / Math.PI;
        return {
            radial: true,
            speed,
            angle,
            rotate: angle,
        };
    }

    _pickDirectionHoldMs(config) {
        const hold = readRange(config?.directionHoldMs, 12000, 20000);
        return hold.min + Math.random() * (hold.max - hold.min);
    }

    _pickNextWindUvAngle(minTurnRadians) {
        for (let attempt = 0; attempt < 16; attempt++) {
            const candidateUvAngle = Math.random() * TWO_PI;
            const projected = isoLocalToWorldDelta(
                Math.cos(candidateUvAngle),
                Math.sin(candidateUvAngle)
            );
            const projectedLength = Math.hypot(projected.x, projected.y) || 1;
            const dot = clamp(
                this._wind.x * (projected.x / projectedLength)
                    + this._wind.y * (projected.y / projectedLength),
                -1,
                1
            );
            if (Math.acos(dot) >= minTurnRadians) return candidateUvAngle;
        }
        return this._windUvAngle + Math.PI;
    }

    _advanceWindDirection(config, deltaMs) {
        if (config?.lockDirection === true) return;
        this._directionElapsedMs += deltaMs;
        if (this._directionElapsedMs < this._directionHoldMs) return;

        const rawMinTurn = Number(config?.directionChangeMinDegrees);
        const minTurnDegrees = clamp(Number.isFinite(rawMinTurn) ? rawMinTurn : 60, 1, 180);
        const minTurnRadians = minTurnDegrees * Math.PI / 180;
        const nextUvAngle = this._pickNextWindUvAngle(minTurnRadians);
        this._setWindDirectionUv(Math.cos(nextUvAngle), Math.sin(nextUvAngle));

        this._replaceAliveParticleDirection(this._groundEmitter, config.ground, false);
        this._replaceAliveParticleDirection(this._foregroundEmitter, config.foreground, true);
        this._groundAccumulatorMs = 0;
        this._foregroundAccumulatorMs = 0;
        this._directionElapsedMs = 0;
        this._directionHoldMs = this._pickDirectionHoldMs(config);
    }

    _replaceAliveParticleDirection(emitter, layerConfig, foreground) {
        if (!emitter || layerConfig?.enabled === false) return;
        const fallbackSpeed = foreground ? [70, 120] : [140, 230];
        const speed = readRange(layerConfig?.speedPxPerSec, ...fallbackSpeed);
        const motion = this._windMotionConfig(speed);
        emitter.killAll();
        emitter.setParticleSpeed(speed);
        emitter.setEmitterAngle(motion.angle);
        emitter.particleRotate = motion.rotate;
    }

    _setEmitterTimeScale(value) {
        if (this._groundEmitter) this._groundEmitter.timeScale = value;
        if (this._foregroundEmitter) this._foregroundEmitter.timeScale = value;
    }

    _advanceLayer(name, emitter, layerConfig, deltaMs, gustIntensity) {
        if (!emitter || layerConfig?.enabled === false) return;
        const accumulatorKey = name === 'ground' ? '_groundAccumulatorMs' : '_foregroundAccumulatorMs';
        const baseFrequencyMs = Math.max(16, Number(layerConfig?.frequencyMs) || (name === 'ground' ? 55 : 110));
        const frequencyMs = baseFrequencyMs / (this._qualityMultiplier * gustIntensity);
        this[accumulatorKey] += deltaMs;

        if (emitter.atLimit()) {
            this[accumulatorKey] = Math.min(this[accumulatorKey], frequencyMs);
            return;
        }

        let emissions = 0;
        while (this[accumulatorKey] >= frequencyMs && emissions < MAX_EMISSIONS_PER_FRAME) {
            this[accumulatorKey] -= frequencyMs;
            const point = this._pickSpawnPoint();
            if (point) {
                const quantity = Math.max(1, Math.round(Number(layerConfig?.quantity) || 1));
                emitter.emitParticleAt(point.x, point.y, quantity);
            }
            emissions++;
            if (emitter.atLimit()) break;
        }
        if (emissions >= MAX_EMISSIONS_PER_FRAME) {
            this[accumulatorKey] = Math.min(this[accumulatorKey], frequencyMs);
        }
    }

    _pickSpawnPoint() {
        const view = this.scene?.cameras?.main?.worldView;
        if (!view || !this._diamond) return null;
        const margin = Math.max(0, Number(this._modeConfig?.viewportMarginPx) || 0);
        const x0 = view.x - margin;
        const y0 = view.y - margin;
        const width = view.width + margin * 2;
        const height = view.height + margin * 2;

        for (let attempt = 0; attempt < 12; attempt++) {
            const x = x0 + Math.random() * width;
            const y = y0 + Math.random() * height;
            if (!isInsideDiamond(this._diamond, x, y)) continue;
            return { x, y };
        }
        return null;
    }
}

export default WindblownSandSystem;
