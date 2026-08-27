import { WORLD_RENDER_LAYERS } from './world-render-layers.js';
import { SoundManager } from '../ui/sound-manager.js';

const RAIN_STREAK_TEXTURE = 'weather_rain_streak';
const RAIN_SPLASH_TEXTURE = 'weather_rain_splash';
const RAIN_OVERLAY_DEPTH = 99968;
const RAIN_FOREGROUND_DEPTH = 99976;
// 覆盖 GameScene 整个摄像机输出（含其内部 HUD/调试层）；独立 HudScene 与 DOM UI 不受影响。
const LIGHTNING_FLASH_DEPTH = 2000000;
const MAX_EMISSIONS_PER_FRAME = 8;
const QUALITY_MULTIPLIERS = Object.freeze({
    low: 0.65,
    medium: 1,
    high: 1.35,
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function readRange(value, fallbackMin, fallbackMax) {
    const min = Number.isFinite(Number(value?.min)) ? Number(value.min) : fallbackMin;
    const max = Number.isFinite(Number(value?.max)) ? Number(value.max) : fallbackMax;
    return { min: Math.min(min, max), max: Math.max(min, max) };
}

function parseColor(value, fallback) {
    if (Number.isFinite(Number(value))) return Number(value);
    const parsed = Number.parseInt(String(value || '').replace(/^#|^0x/i, ''), 16);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTints(values, fallback) {
    const source = Array.isArray(values) && values.length ? values : fallback;
    return source.map((value) => parseColor(value, 0xffffff));
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

function isExcludedSceneType(config, sceneConfig) {
    const excludedTypes = Array.isArray(config?.excludedSceneTypes)
        ? config.excludedSceneTypes
        : ['dungeon'];
    return excludedTypes.includes(sceneConfig?.type);
}

function supportsScene(config, sceneId, sceneConfig) {
    const targets = Array.isArray(config?.targetSceneIds) ? config.targetSceneIds : [];
    const targetTypes = Array.isArray(config?.targetSceneTypes) ? config.targetSceneTypes : [];
    const sceneRainSetting = sceneConfig?.environmentEffects?.rain?.enabled;
    return config?.enabled !== false
        && !isExcludedSceneType(config, sceneConfig)
        && sceneRainSetting !== false
        && (targets.includes(sceneId)
            || targetTypes.includes(sceneConfig?.type)
            || sceneRainSetting === true);
}

function resolveIntensityId(config, intensityId) {
    const intensities = config?.intensities || {};
    if (intensityId && intensities[intensityId]) return intensityId;
    const fallback = config?.defaultIntensity;
    if (fallback && intensities[fallback]) return fallback;
    return Object.keys(intensities)[0] || 'light';
}

function resolveIntensityConfig(config, intensityId) {
    const id = resolveIntensityId(config, intensityId);
    const intensity = config?.intensities?.[id] || {};
    return {
        ...config,
        ...intensity,
        intensityId: id,
        intensityName: intensity.name || id,
        overlay: { ...(config?.overlay || {}), ...(intensity.overlay || {}) },
        streaks: { ...(config?.streaks || {}), ...(intensity.streaks || {}) },
        splashes: { ...(config?.splashes || {}), ...(intensity.splashes || {}) },
        thunder: { ...(config?.thunder || {}), ...(intensity.thunder || {}) },
    };
}

function ensureRainStreakTexture(scene) {
    if (scene?.textures?.exists(RAIN_STREAK_TEXTURE)) return true;
    if (!scene?.textures?.createCanvas) return false;
    const texture = scene.textures.createCanvas(RAIN_STREAK_TEXTURE, 8, 72);
    const context = texture.getContext();
    const gradient = context.createLinearGradient(4, 0, 4, 72);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.28, 'rgba(255,255,255,0.32)');
    gradient.addColorStop(0.72, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.clearRect(0, 0, 8, 72);
    context.fillStyle = gradient;
    context.fillRect(3, 0, 2, 72);
    texture.refresh();
    return true;
}

function ensureRainSplashTexture(scene) {
    if (scene?.textures?.exists(RAIN_SPLASH_TEXTURE)) return true;
    if (!scene?.textures?.createCanvas) return false;
    const texture = scene.textures.createCanvas(RAIN_SPLASH_TEXTURE, 48, 20);
    const context = texture.getContext();
    context.clearRect(0, 0, 48, 20);
    context.strokeStyle = 'rgba(255,255,255,0.9)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.ellipse(24, 14, 17, 4.5, 0, Math.PI * 0.08, Math.PI * 0.92);
    context.stroke();
    context.beginPath();
    context.moveTo(18, 12);
    context.quadraticCurveTo(20, 5, 22, 11);
    context.moveTo(26, 11);
    context.quadraticCurveTo(29, 3, 31, 12);
    context.stroke();
    texture.refresh();
    return true;
}

/**
 * 全位面通用的 Phaser 无玩法降雨视听特效。
 *
 * 雨丝在前景层覆盖世界对象，水花贴在地表层，冷色遮罩位于战争迷雾和昼夜覆盖层之下。
 * 系统只围绕当前相机生成粒子，不创建实体、物理体、计时器或存档状态。
 */
export class RainWeatherSystem {
    constructor(scene) {
        this.scene = scene;
        this._activeSceneId = null;
        this._intensityId = null;
        this._activeConfig = null;
        this._modeConfig = null;
        this._sceneConfig = null;
        this._diamond = null;
        this._streakEmitter = null;
        this._splashEmitter = null;
        this._overlay = null;
        this._lightningFlash = null;
        this._qualityMultiplier = 1;
        this._elapsedMs = 0;
        this._streakAccumulatorMs = 0;
        this._splashAccumulatorMs = 0;
        this._nextThunderMs = 0;
        this._lightningRemainingMs = 0;
        this._lightningHoldMs = 0;
        this._lightningRecoveryMs = 0;
    }

    update({
        sceneId, sceneConfig, config, requestedIntensityId = undefined,
        deltaMs = 0, running = true, loading = false,
    } = {}) {
        if (requestedIntensityId !== undefined) {
            const desiredIntensityId = requestedIntensityId
                ? resolveIntensityId(config, requestedIntensityId) : null;
            if (!desiredIntensityId) {
                if (this._activeSceneId || this._activeConfig) this.reset();
            } else if (this._activeSceneId !== sceneId || this._intensityId !== desiredIntensityId) {
                this._destroyVisuals();
                this._activeSceneId = sceneId;
                this._intensityId = desiredIntensityId;
            }
        }
        if (loading || sceneId !== this._activeSceneId || !supportsScene(config, sceneId, sceneConfig)) {
            if (this._activeSceneId || this._activeConfig) this.reset();
            return;
        }

        if (this._activeConfig !== config || this._sceneConfig !== sceneConfig) {
            this._activate(config, sceneConfig);
        }
        const modeConfig = this._modeConfig || resolveIntensityConfig(config, this._intensityId);
        this._syncScreenLayersToCamera(modeConfig);

        const isRunning = running && deltaMs > 0;
        this._setEmitterTimeScale(isRunning ? 1 : 0);
        if (!isRunning) return;

        const stepMs = Math.max(0, Number(deltaMs) || 0);
        this._elapsedMs += stepMs;
        this._syncOverlayAlpha(modeConfig);
        this._advanceLayer('streak', this._streakEmitter, modeConfig.streaks, stepMs);
        this._advanceLayer('splash', this._splashEmitter, modeConfig.splashes, stepMs);
        this._updateThunder(modeConfig, stepMs);
    }

    toggle(sceneId, intensityId = null, {
        currentSceneId = sceneId,
        loading = false,
        config = null,
        sceneConfig = null,
    } = {}) {
        if (!supportsScene(config, sceneId, sceneConfig)) {
            const reason = isExcludedSceneType(config, sceneConfig)
                ? '地牢场景不会产生降雨天气'
                : '该位面未启用降雨特效';
            return {
                ok: false,
                reason,
                model: this.getDebugModel(sceneId, currentSceneId, loading, config, sceneConfig),
            };
        }
        if (loading || sceneId !== currentSceneId) {
            return {
                ok: false,
                reason: '请先进入目标位面',
                model: this.getDebugModel(sceneId, currentSceneId, loading, config, sceneConfig),
            };
        }
        const nextIntensityId = resolveIntensityId(config, intensityId);
        if (this._activeSceneId === sceneId && this._intensityId === nextIntensityId) {
            this.reset();
        } else {
            this._destroyVisuals();
            this._activeSceneId = sceneId;
            this._intensityId = nextIntensityId;
        }
        return {
            ok: true,
            model: this.getDebugModel(sceneId, currentSceneId, loading, config, sceneConfig),
        };
    }

    isActive(sceneId) {
        return this._activeSceneId === sceneId;
    }

    getDebugModel(sceneId, currentSceneId, loading, config, sceneConfig = null) {
        const blockedBySceneType = isExcludedSceneType(config, sceneConfig);
        const enabled = supportsScene(config, sceneId, sceneConfig);
        const intensityId = resolveIntensityId(config, this._intensityId);
        const intensityConfig = config?.intensities?.[intensityId] || {};
        return {
            sceneId,
            sceneType: sceneConfig?.type || null,
            blockedBySceneType,
            enabled,
            active: enabled && this.isActive(sceneId),
            available: enabled && !loading && sceneId === currentSceneId,
            quality: config?.quality || 'medium',
            intensityId,
            intensityName: intensityConfig.name || intensityId,
            intensities: Object.entries(config?.intensities || {}).map(([id, entry]) => ({
                id,
                name: entry?.name || id,
                thunder: entry?.thunder?.enabled === true,
            })),
            gameplayAffects: false,
        };
    }

    reset() {
        this._destroyVisuals();
        this._activeSceneId = null;
        this._intensityId = null;
    }

    destroy() {
        this.reset();
        this.scene = null;
    }

    _destroyVisuals() {
        this._streakEmitter?.destroy();
        this._splashEmitter?.destroy();
        this._overlay?.destroy();
        this._lightningFlash?.destroy();
        this._streakEmitter = null;
        this._splashEmitter = null;
        this._overlay = null;
        this._lightningFlash = null;
        this._activeConfig = null;
        this._modeConfig = null;
        this._sceneConfig = null;
        this._diamond = null;
        this._elapsedMs = 0;
        this._streakAccumulatorMs = 0;
        this._splashAccumulatorMs = 0;
        this._nextThunderMs = 0;
        this._lightningRemainingMs = 0;
        this._lightningHoldMs = 0;
        this._lightningRecoveryMs = 0;
    }

    _activate(config, sceneConfig) {
        const activeSceneId = this._activeSceneId;
        this._destroyVisuals();
        this._activeSceneId = activeSceneId;
        this._activeConfig = config;
        this._modeConfig = resolveIntensityConfig(config, this._intensityId);
        this._sceneConfig = sceneConfig;
        this._diamond = resolveDiamond(sceneConfig);
        this._qualityMultiplier = QUALITY_MULTIPLIERS[config?.quality] || QUALITY_MULTIPLIERS.medium;
        const modeConfig = this._modeConfig;

        const overlayConfig = modeConfig.overlay || {};
        if (overlayConfig.enabled !== false) {
            this._overlay = this.scene.add.rectangle(
                0,
                0,
                1,
                1,
                parseColor(overlayConfig.color, 0x173044),
                clamp(Number(overlayConfig.alpha) || 0.14, 0, 1)
            );
            this._overlay.setOrigin(0.5, 0.5).setDepth(RAIN_OVERLAY_DEPTH);
        }

        if (modeConfig.streaks?.enabled !== false && ensureRainStreakTexture(this.scene)) {
            this._streakEmitter = this._createStreakEmitter(modeConfig.streaks || {});
        }
        if (modeConfig.splashes?.enabled !== false && ensureRainSplashTexture(this.scene)) {
            this._splashEmitter = this._createSplashEmitter(modeConfig.splashes || {});
        }
        if (modeConfig.thunder?.enabled === true) {
            this._lightningFlash = this.scene.add.rectangle(0, 0, 1, 1, 0xffffff, 1);
            this._lightningFlash
                .setOrigin(0, 0)
                .setScrollFactor(0)
                .setDepth(LIGHTNING_FLASH_DEPTH)
                .setAlpha(0);
            this._nextThunderMs = this._pickThunderDelay(modeConfig.thunder, true);
        }

        // 首帧立即补一小批雨丝，避免手动开启后等满一个发射周期才看见效果。
        this._streakAccumulatorMs = Math.max(4, Number(modeConfig.streaks?.frequencyMs) || 18)
            * MAX_EMISSIONS_PER_FRAME;
    }

    _createStreakEmitter(layerConfig) {
        const speedX = readRange(layerConfig.speedX, -125, -70);
        const speedY = readRange(layerConfig.speedY, 980, 1380);
        const lifespan = readRange(layerConfig.lifespanMs, 700, 1100);
        const scaleX = readRange(layerConfig.scaleX, 0.6, 1);
        const scaleY = readRange(layerConfig.scaleY, 0.75, 1.2);
        const alpha = layerConfig.alpha || {};
        const maxAlive = Math.max(1, Math.round(
            (Number(layerConfig.maxAliveParticles) || 220) * this._qualityMultiplier
        ));
        const averageX = (speedX.min + speedX.max) * 0.5;
        const averageY = (speedY.min + speedY.max) * 0.5;
        const rotate = Math.atan2(averageY, averageX) * 180 / Math.PI - 90;
        const emitter = this.scene.add.particles(0, 0, RAIN_STREAK_TEXTURE, {
            emitting: false,
            frequency: -1,
            speedX,
            speedY,
            rotate,
            lifespan,
            scaleX,
            scaleY,
            alpha: {
                start: Number.isFinite(Number(alpha.start)) ? Number(alpha.start) : 0.78,
                end: Number.isFinite(Number(alpha.end)) ? Number(alpha.end) : 0.08,
            },
            tint: parseTints(layerConfig.tints, ['#d9f1ff', '#9dc6df', '#6f9fbe']),
            blendMode: 'NORMAL',
            maxAliveParticles: maxAlive,
            reserve: maxAlive,
        });
        emitter.addToUpdateList();
        emitter.setDepth(RAIN_FOREGROUND_DEPTH);
        return emitter;
    }

    _createSplashEmitter(layerConfig) {
        const lifespan = readRange(layerConfig.lifespanMs, 320, 520);
        const alpha = layerConfig.alpha || {};
        const maxAlive = Math.max(1, Math.round(
            (Number(layerConfig.maxAliveParticles) || 90) * this._qualityMultiplier
        ));
        const emitter = this.scene.add.particles(0, 0, RAIN_SPLASH_TEXTURE, {
            emitting: false,
            frequency: -1,
            speed: 0,
            lifespan,
            scaleX: { start: Number(layerConfig.scaleStart) || 0.35, end: Number(layerConfig.scaleEnd) || 1.15 },
            scaleY: { start: Number(layerConfig.scaleStart) || 0.35, end: Number(layerConfig.scaleEnd) || 1.15 },
            alpha: {
                start: Number.isFinite(Number(alpha.start)) ? Number(alpha.start) : 0.7,
                end: Number.isFinite(Number(alpha.end)) ? Number(alpha.end) : 0,
            },
            tint: parseTints(layerConfig.tints, ['#d9f1ff', '#9dc6df']),
            blendMode: 'NORMAL',
            maxAliveParticles: maxAlive,
            reserve: maxAlive,
        });
        emitter.addToUpdateList();
        emitter.setDepth(WORLD_RENDER_LAYERS.GROUND_WEATHER + 0.01);
        return emitter;
    }

    _setEmitterTimeScale(value) {
        if (this._streakEmitter) this._streakEmitter.timeScale = value;
        if (this._splashEmitter) this._splashEmitter.timeScale = value;
    }

    _syncScreenLayersToCamera(config) {
        const camera = this.scene?.cameras?.main;
        const view = camera?.worldView;
        if (!camera || !view) return;
        const margin = Math.max(4, Number(config?.viewportMarginPx) || 120);
        if (this._overlay?.active) {
            this._overlay
                .setPosition(view.centerX, view.centerY)
                .setDisplaySize(view.width + margin * 2, view.height + margin * 2);
        }
        if (this._lightningFlash?.active) {
            const zoom = camera.zoom || 1;
            const viewW = this.scene?.scale?.width || camera.width || 1920;
            const viewH = this.scene?.scale?.height || camera.height || 1080;
            this._lightningFlash
                .setPosition(0, 0)
                .setDisplaySize(viewW / zoom, viewH / zoom);
        }
    }

    _syncOverlayAlpha(config) {
        if (!this._overlay?.active) return;
        const overlayConfig = config?.overlay || {};
        const baseAlpha = clamp(Number(overlayConfig.alpha) || 0.14, 0, 1);
        const pulseAmount = clamp(Number(overlayConfig.pulseAmount) || 0.018, 0, 0.2);
        const periodMs = Math.max(1000, Number(overlayConfig.pulsePeriodMs) || 5200);
        const pulse = Math.sin((this._elapsedMs / periodMs) * Math.PI * 2);
        this._overlay.setAlpha(clamp(baseAlpha + pulse * pulseAmount, 0, 1));
    }

    _pickThunderDelay(thunderConfig, initial = false) {
        const interval = readRange(thunderConfig?.intervalMs, 8400, 17000);
        const min = initial ? Math.min(interval.min, 3600) : interval.min;
        const max = initial ? Math.min(interval.max, 7200) : interval.max;
        return min + Math.random() * Math.max(0, max - min);
    }

    _updateThunder(config, deltaMs) {
        const thunderConfig = config?.thunder || {};
        if (thunderConfig.enabled !== true || !this._lightningFlash) return;

        if (this._lightningRemainingMs > 0) {
            this._lightningRemainingMs = Math.max(0, this._lightningRemainingMs - deltaMs);
            const totalMs = this._lightningHoldMs + this._lightningRecoveryMs;
            const elapsedMs = Math.max(0, totalMs - this._lightningRemainingMs);
            const flashAlpha = elapsedMs <= this._lightningHoldMs
                ? 1
                : clamp(1 - (elapsedMs - this._lightningHoldMs) / this._lightningRecoveryMs, 0, 1);
            this._lightningFlash.setAlpha(flashAlpha);
            if (this._lightningRemainingMs <= 0) {
                this._lightningFlash.setAlpha(0);
            }
        }

        this._nextThunderMs -= deltaMs;
        if (this._nextThunderMs > 0) return;
        this._triggerLightning(thunderConfig);
        this._nextThunderMs = this._pickThunderDelay(thunderConfig);
    }

    _triggerLightning(thunderConfig) {
        if (!this._lightningFlash) return;
        this._lightningHoldMs = Math.max(1, Number(thunderConfig.whiteHoldMs) || 200);
        this._lightningRecoveryMs = Math.max(1, Number(thunderConfig.recoveryMs) || 650);
        this._lightningRemainingMs = this._lightningHoldMs + this._lightningRecoveryMs;
        this._lightningFlash.setAlpha(1);

        SoundManager.playThunder?.(clamp(Number(thunderConfig.volume) || 0.7, 0, 1));
    }

    _advanceLayer(name, emitter, layerConfig, deltaMs) {
        if (!emitter || layerConfig?.enabled === false) return;
        const accumulatorKey = name === 'streak' ? '_streakAccumulatorMs' : '_splashAccumulatorMs';
        const fallbackFrequency = name === 'streak' ? 18 : 46;
        const frequencyMs = Math.max(4, Number(layerConfig?.frequencyMs) || fallbackFrequency)
            / this._qualityMultiplier;
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
        const margin = Math.max(0, Number(this._modeConfig?.viewportMarginPx) || 120);
        for (let attempt = 0; attempt < 14; attempt++) {
            const x = view.x - margin + Math.random() * (view.width + margin * 2);
            const y = view.y - margin + Math.random() * (view.height + margin * 2);
            if (isInsideDiamond(this._diamond, x, y)) return { x, y };
        }
        return null;
    }
}

export default RainWeatherSystem;
