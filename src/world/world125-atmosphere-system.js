import { isoLocalToWorldDelta } from '../physics/iso-footprint.js';
import { WallSystem } from './wall-system.js';
import { WORLD_RENDER_LAYERS } from './world-render-layers.js';
import { CandleSanctuarySystem } from './candle-sanctuary-system.js';

const GROUND_FOG_TEXTURE = 'world125_ground_corpse_fog';
const CORRUPTION_DUST_TEXTURE = 'world125_corruption_dust';
const CANDLE_EMBER_TEXTURE = 'world125_candle_ember';
const COLD_OVERLAY_DEPTH = 99970;
const FOREGROUND_ATMOSPHERE_DEPTH = 99974;
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

function parseColor(value, fallback = 0xffffff) {
    if (Number.isFinite(Number(value))) return Number(value);
    const parsed = Number.parseInt(String(value ?? '').replace(/^#|^0x/i, ''), 16);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTints(values, fallback) {
    const source = Array.isArray(values) && values.length > 0 ? values : fallback;
    return source.map((value) => parseColor(value));
}

function resolveModeConfig(config, fogTideActive) {
    const visual = fogTideActive ? config?.fogTide?.visual : null;
    if (!visual) return config;
    return {
        ...config,
        ...visual,
        groundFog: { ...(config.groundFog || {}), ...(visual.groundFog || {}) },
        corruptionDust: { ...(config.corruptionDust || {}), ...(visual.corruptionDust || {}) },
        candles: { ...(config.candles || {}), ...(visual.candles || {}) },
        coldOverlay: { ...(config.coldOverlay || {}), ...(visual.coldOverlay || {}) },
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

function ensureSoftEllipseTexture(scene, key, width, height, innerStop = 0.35) {
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
    gradient.addColorStop(0, 'rgba(255,255,255,0.92)');
    gradient.addColorStop(innerStop, 'rgba(255,255,255,0.68)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(-radius, -radius, radius * 2, radius * 2);
    context.restore();
    texture.refresh();
    return true;
}

function ensureSoftDotTexture(scene, key, size = 16, coreStop = 0.16) {
    if (scene?.textures?.exists(key)) return true;
    if (!scene?.textures?.createCanvas) return false;
    const texture = scene.textures.createCanvas(key, size, size);
    const context = texture.getContext();
    const center = size / 2;
    const gradient = context.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(coreStop, 'rgba(255,255,255,0.92)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.clearRect(0, 0, size, size);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    texture.refresh();
    return true;
}

/**
 * 世界-125 的纯视觉地牢氛围。
 *
 * 尸雾、腐化浮尘与烛火火星只在当前相机附近运行；烛台光源复用 GameScene
 * 的战争迷雾感知环境光。系统不创建实体、物理体或存档状态，只消费统一世界 delta。
 */
export class World125AtmosphereSystem {
    constructor(scene) {
        this.scene = scene;
        this._activeConfig = null;
        this._modeConfig = null;
        this._fogTideMode = false;
        this._sceneConfig = null;
        this._diamond = null;
        this._qualityMultiplier = 1;
        this._groundFogEmitter = null;
        this._dustEmitter = null;
        this._emberEmitter = null;
        this._coldOverlay = null;
        this._airflow = { x: 1, y: 0 };
        this._airflowUvAngle = 0;
        this._directionElapsedMs = 0;
        this._directionHoldMs = 0;
        this._elapsedMs = 0;
        this._groundFogAccumulatorMs = 0;
        this._dustAccumulatorMs = 0;
        this._emberAccumulatorMs = 0;
        this._candleScanElapsedMs = 0;
        this._candleSignature = '';
        this._candles = [];
        this._candleGlowKeys = [];
    }

    update({
        sceneId,
        sceneConfig,
        deltaMs = 0,
        running = true,
        loading = false,
        fogTideActive = false,
    } = {}) {
        const config = sceneConfig?.environmentEffects?.dungeonAtmosphere;
        if (loading || sceneId !== 'scene11' || !config?.enabled) {
            this.reset();
            return;
        }

        const fogTideMode = !!fogTideActive && config.fogTide?.enabled !== false;
        if (this._activeConfig !== config || this._fogTideMode !== fogTideMode) {
            this._activate(config, sceneConfig, fogTideMode);
        }
        if (!this._activeConfig) return;
        const modeConfig = this._modeConfig || config;

        const stepMs = Math.max(0, Number(deltaMs) || 0);
        this._candleScanElapsedMs += stepMs;
        if (!this._candles.length || this._candleScanElapsedMs >= 1000) {
            this._refreshCandles(modeConfig.candles || {});
            this._candleScanElapsedMs = 0;
        }

        const isRunning = running && stepMs > 0;
        this._setEmitterTimeScale(isRunning ? 1 : 0);
        this._syncColdOverlay(modeConfig.coldOverlay || {});
        if (!isRunning) return;

        this._elapsedMs += stepMs;
        this._advanceAirflow(modeConfig, stepMs);

        const pulsePeriodMs = Math.max(1000, Number(modeConfig.pulsePeriodMs) || 9000);
        const pulseWave = (Math.sin((this._elapsedMs / pulsePeriodMs) * TWO_PI) + 1) * 0.5;
        const atmospherePulse = 0.88 + pulseWave * 0.12;
        this._groundFogEmitter?.setAlpha(atmospherePulse);
        this._dustEmitter?.setAlpha(0.82 + pulseWave * 0.18);

        this._advanceLayer('groundFog', this._groundFogEmitter, modeConfig.groundFog || {}, stepMs);
        this._advanceLayer('dust', this._dustEmitter, modeConfig.corruptionDust || {}, stepMs);
        this._advanceCandleEmbers(modeConfig.candles || {}, stepMs);
    }

    getFogTideVisualModel(config = this._activeConfig) {
        return {
            enabled: !!config?.fogTide && config.fogTide.enabled !== false,
            visualModeActive: !!this._fogTideMode,
            targetSceneId: 'scene11',
            visualOnly: true,
        };
    }

    reset() {
        this._removeCandleGlows();
        this._groundFogEmitter?.destroy();
        this._dustEmitter?.destroy();
        this._emberEmitter?.destroy();
        this._coldOverlay?.destroy();
        this._groundFogEmitter = null;
        this._dustEmitter = null;
        this._emberEmitter = null;
        this._coldOverlay = null;
        this._activeConfig = null;
        this._modeConfig = null;
        this._fogTideMode = false;
        this._sceneConfig = null;
        this._diamond = null;
        this._qualityMultiplier = 1;
        this._airflow = { x: 1, y: 0 };
        this._airflowUvAngle = 0;
        this._directionElapsedMs = 0;
        this._directionHoldMs = 0;
        this._elapsedMs = 0;
        this._groundFogAccumulatorMs = 0;
        this._dustAccumulatorMs = 0;
        this._emberAccumulatorMs = 0;
        this._candleScanElapsedMs = 0;
        this._candleSignature = '';
        this._candles = [];
    }

    destroy() {
        this.reset();
        this.scene = null;
    }

    _activate(config, sceneConfig, fogTideMode = false) {
        this.reset();
        this._fogTideMode = fogTideMode;
        this._activeConfig = config;
        this._modeConfig = resolveModeConfig(config, fogTideMode);
        this._sceneConfig = sceneConfig;
        this._diamond = resolveDiamond(sceneConfig);
        const modeConfig = this._modeConfig;
        this._qualityMultiplier = QUALITY_MULTIPLIERS[modeConfig.quality] || QUALITY_MULTIPLIERS.medium;
        this._setAirflowUv(modeConfig.airflowUv?.u, modeConfig.airflowUv?.v);
        this._directionHoldMs = this._pickDirectionHoldMs(modeConfig);

        const fogReady = ensureSoftEllipseTexture(this.scene, GROUND_FOG_TEXTURE, 128, 52, 0.28);
        const dustReady = ensureSoftDotTexture(this.scene, CORRUPTION_DUST_TEXTURE, 18, 0.10);
        const emberReady = ensureSoftDotTexture(this.scene, CANDLE_EMBER_TEXTURE, 14, 0.18);

        if (modeConfig.groundFog?.enabled !== false && fogReady) {
            this._groundFogEmitter = this._createAirflowEmitter(
                GROUND_FOG_TEXTURE,
                modeConfig.groundFog || {},
                WORLD_RENDER_LAYERS.GROUND_WEATHER,
                'groundFog'
            );
        }
        if (modeConfig.corruptionDust?.enabled !== false && dustReady) {
            this._dustEmitter = this._createAirflowEmitter(
                CORRUPTION_DUST_TEXTURE,
                modeConfig.corruptionDust || {},
                FOREGROUND_ATMOSPHERE_DEPTH,
                'dust'
            );
        }
        if (modeConfig.candles?.enabled !== false && emberReady) {
            this._emberEmitter = this._createEmberEmitter(modeConfig.candles || {});
        }
        if (modeConfig.coldOverlay?.enabled !== false) {
            const overlayColor = parseColor(modeConfig.coldOverlay?.color, 0x0c171b);
            this._coldOverlay = this.scene.add.rectangle(0, 0, 1, 1, overlayColor, 0);
            this._coldOverlay.setOrigin(0, 0);
            this._coldOverlay.setScrollFactor(0);
            this._coldOverlay.setDepth(COLD_OVERLAY_DEPTH);
        }
        this._refreshCandles(modeConfig.candles || {});
    }

    _createAirflowEmitter(texture, layerConfig, depth, layer) {
        const isDust = layer === 'dust';
        const speed = readRange(layerConfig.speedPxPerSec, isDust ? 26 : 16, isDust ? 46 : 30);
        const lifespan = readRange(layerConfig.lifespanMs, isDust ? 3200 : 5200, isDust ? 5200 : 8200);
        const alpha = layerConfig.alpha || {};
        const maxAlive = Math.max(1, Math.round(
            (Number(layerConfig.maxAliveParticles) || (isDust ? 36 : 64)) * this._qualityMultiplier
        ));
        const motion = this._airflowMotionConfig(speed);
        const emitterConfig = {
            emitting: false,
            frequency: -1,
            ...motion,
            lifespan,
            alpha: {
                start: Number.isFinite(Number(alpha.start)) ? Number(alpha.start) : (isDust ? 0.52 : 0.24),
                end: Number.isFinite(Number(alpha.end)) ? Number(alpha.end) : 0,
            },
            tint: parseTints(
                layerConfig.tints,
                isDust ? ['#c3d2c4', '#78917d', '#485c52'] : ['#a7b8bf', '#647982', '#344850']
            ),
            blendMode: 'NORMAL',
            maxAliveParticles: maxAlive,
            reserve: maxAlive,
        };

        const scale = layerConfig.scale || {};
        emitterConfig.scale = {
            start: Number.isFinite(Number(scale.start)) ? Number(scale.start) : (isDust ? 0.9 : 0.85),
            end: Number.isFinite(Number(scale.end)) ? Number(scale.end) : (isDust ? 0.18 : 2.1),
        };
        if (isDust) {
            emitterConfig.rotate = { min: 0, max: 360 };
        }

        const emitter = this.scene.add.particles(0, 0, texture, emitterConfig);
        emitter.addToUpdateList();
        emitter.setDepth(depth);
        return emitter;
    }

    _createEmberEmitter(config) {
        const lifespan = readRange(config.emberLifespanMs, 520, 880);
        const speedX = readRange(config.emberSpeedX, -10, 10);
        const speedY = readRange(config.emberSpeedY, -95, -48);
        const maxAlive = Math.max(1, Math.round(
            (Number(config.maxAliveEmbers) || 32) * this._qualityMultiplier
        ));
        const emitter = this.scene.add.particles(0, 0, CANDLE_EMBER_TEXTURE, {
            emitting: false,
            frequency: -1,
            speedX,
            speedY,
            lifespan,
            scale: { start: Number(config.emberScaleStart) || 0.92, end: 0.08 },
            alpha: { start: Number(config.emberAlphaStart) || 0.88, end: 0 },
            tint: parseTints(config.emberTints, ['#fff2b0', '#ffb342', '#e85f22']),
            blendMode: 'ADD',
            maxAliveParticles: maxAlive,
            reserve: maxAlive,
        });
        emitter.addToUpdateList();
        emitter.setDepth(FOREGROUND_ATMOSPHERE_DEPTH + 0.2);
        return emitter;
    }

    _setAirflowUv(rawU, rawV) {
        let u = Number.isFinite(Number(rawU)) ? Number(rawU) : 0.8;
        let v = Number.isFinite(Number(rawV)) ? Number(rawV) : -0.3;
        const uvLength = Math.hypot(u, v);
        if (uvLength <= 0.0001) {
            u = 1;
            v = 0;
        } else {
            u /= uvLength;
            v /= uvLength;
        }
        this._airflowUvAngle = Math.atan2(v, u);
        const projected = isoLocalToWorldDelta(u, v);
        const projectedLength = Math.hypot(projected.x, projected.y) || 1;
        this._airflow = { x: projected.x / projectedLength, y: projected.y / projectedLength };
    }

    _airflowMotionConfig(speed) {
        const angle = Math.atan2(this._airflow.y, this._airflow.x) * 180 / Math.PI;
        return { radial: true, speed, angle, rotate: angle };
    }

    _pickDirectionHoldMs(config) {
        const hold = readRange(config.directionHoldMs, 18000, 32000);
        return hold.min + Math.random() * (hold.max - hold.min);
    }

    _pickNextAirflowUvAngle(minTurnRadians) {
        for (let attempt = 0; attempt < 16; attempt++) {
            const candidateUvAngle = Math.random() * TWO_PI;
            const projected = isoLocalToWorldDelta(Math.cos(candidateUvAngle), Math.sin(candidateUvAngle));
            const projectedLength = Math.hypot(projected.x, projected.y) || 1;
            const dot = clamp(
                this._airflow.x * (projected.x / projectedLength)
                    + this._airflow.y * (projected.y / projectedLength),
                -1,
                1
            );
            if (Math.acos(dot) >= minTurnRadians) return candidateUvAngle;
        }
        return this._airflowUvAngle + Math.PI;
    }

    _advanceAirflow(config, deltaMs) {
        if (config.lockDirection === true) return;
        this._directionElapsedMs += deltaMs;
        if (this._directionElapsedMs < this._directionHoldMs) return;

        const rawMinTurn = Number(config.directionChangeMinDegrees);
        const minTurnDegrees = clamp(Number.isFinite(rawMinTurn) ? rawMinTurn : 55, 1, 180);
        const nextUvAngle = this._pickNextAirflowUvAngle(minTurnDegrees * Math.PI / 180);
        this._setAirflowUv(Math.cos(nextUvAngle), Math.sin(nextUvAngle));

        this._replaceAliveParticleDirection(this._groundFogEmitter, config.groundFog || {}, false);
        this._replaceAliveParticleDirection(this._dustEmitter, config.corruptionDust || {}, true);
        this._groundFogAccumulatorMs = 0;
        this._dustAccumulatorMs = 0;
        this._directionElapsedMs = 0;
        this._directionHoldMs = this._pickDirectionHoldMs(config);
    }

    _replaceAliveParticleDirection(emitter, layerConfig, isDust) {
        if (!emitter || layerConfig?.enabled === false) return;
        const speed = readRange(layerConfig.speedPxPerSec, isDust ? 26 : 16, isDust ? 46 : 30);
        const motion = this._airflowMotionConfig(speed);
        emitter.killAll();
        emitter.setParticleSpeed(speed);
        emitter.setEmitterAngle(motion.angle);
        if (!isDust) emitter.particleRotate = motion.rotate;
    }

    _setEmitterTimeScale(value) {
        if (this._groundFogEmitter) this._groundFogEmitter.timeScale = value;
        if (this._dustEmitter) this._dustEmitter.timeScale = value;
        if (this._emberEmitter) this._emberEmitter.timeScale = value;
    }

    _advanceLayer(name, emitter, layerConfig, deltaMs) {
        if (!emitter || layerConfig?.enabled === false) return;
        const accumulatorKey = name === 'groundFog' ? '_groundFogAccumulatorMs' : '_dustAccumulatorMs';
        const fallbackFrequency = name === 'groundFog' ? 110 : 165;
        const frequencyMs = Math.max(16, Number(layerConfig.frequencyMs) || fallbackFrequency)
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
                const quantity = Math.max(1, Math.round(Number(layerConfig.quantity) || 1));
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
            if (isInsideDiamond(this._diamond, x, y)) return { x, y };
        }
        return null;
    }

    _buildingTexturePoint(building, rawPoint) {
        const sprite = building?._phaserSprite?.active ? building._phaserSprite : null;
        const displayW = Math.max(1, Number(sprite?.displayWidth)
            || Number(building?.spriteCfg?.size) || Number(building?._cfg?.displayW) || 89);
        const displayH = Math.max(1, Number(sprite?.displayHeight)
            || Number(building?.spriteCfg?.sizeH) || Number(building?._cfg?.displayH) || 180);
        const sourceW = Math.max(1, Number(sprite?.frame?.realWidth) || 317);
        const sourceH = Math.max(1, Number(sprite?.frame?.realHeight) || 640);
        const centerX = Number.isFinite(Number(sprite?.x))
            ? Number(sprite.x)
            : (Number(building?.x) || 0) + (Number(building?._visualFootOffsetX) || 0);
        const centerY = Number.isFinite(Number(sprite?.y))
            ? Number(sprite.y)
            : (Number(building?.y) || 0) - (
                Number(building?._visualFootOffsetY)
                || Number(building?.footOffsetY)
                || displayH / 2
            );
        const mirrored = sprite ? !!sprite.flipX : !!(building?._facingLeft);
        const localX = ((Number(rawPoint?.x) || 0) / sourceW - 0.5) * displayW;
        const localY = ((Number(rawPoint?.y) || 0) / sourceH - 0.5) * displayH;
        return { x: centerX + (mirrored ? -localX : localX), y: centerY + localY };
    }

    _refreshCandles(config) {
        if (config.enabled === false) {
            this._removeCandleGlows();
            this._candles = [];
            this._candleSignature = '';
            return;
        }
        const textureKey = String(config.textureKey || 'obstacle_candle');
        const pieces = (WallSystem.isoVisuals || []).filter((piece) =>
            piece?._world125Environment && piece.tex === textureKey
        );
        const buildings = CandleSanctuarySystem.getBuildings().filter((building) =>
            building?._cfg?.tex === textureKey
        );
        const pieceSignature = pieces.map((piece) => [
            'p',
            Math.round(piece.x * 10),
            Math.round(piece.y * 10),
            Number(piece.scaleX ?? 1).toFixed(4),
            Number(piece.scaleY ?? piece.scaleX ?? 1).toFixed(4),
            piece.flipX ? 1 : 0,
            piece.flipY ? 1 : 0,
        ].join(':')).join('|');
        const buildingSignature = buildings.map((building) => [
            'b', building.id, Math.round(building.x * 10), Math.round(building.y * 10),
            Math.ceil(Number(building.hp) || 0), building._phaserSprite?.active ? 1 : 0,
            Number(building._phaserSprite?.displayWidth || building._cfg?.displayW || 0).toFixed(2),
            Number(building._phaserSprite?.displayHeight || building._cfg?.displayH || 0).toFixed(2),
        ].join(':')).join('|');
        const signature = `${pieceSignature}#${buildingSignature}`;
        if (signature === this._candleSignature) return;

        this._removeCandleGlows();
        this._candleSignature = signature;
        const rawFlamePoints = Array.isArray(config.flamePoints) && config.flamePoints.length
            ? config.flamePoints
            : [{ x: 158, y: 18 }, { x: 42, y: 108 }, { x: 278, y: 54 }];
        const rawGlowPoint = config.glowPoint || { x: 158, y: 60 };
        const glowRadius = Math.max(1, Number(config.glowRadius) || 86);
        const glowColor = parseColor(config.glowColor, 0xff9d3d);
        const glowAlpha = clamp(Number(config.glowAlpha) || 0.19, 0, 1);
        const glowFlicker = clamp(Number(config.glowFlicker) || 0.11, 0, 1);
        const glowPulsePeriodMs = Math.max(250, Number(config.glowPulsePeriodMs) || 2400);

        const visualCandles = pieces.map((piece, index) => {
            const flamePoints = rawFlamePoints.map((point) =>
                WallSystem.texPointToWorld(piece, Number(point.x) || 0, Number(point.y) || 0)
            );
            const glowPoint = WallSystem.texPointToWorld(
                piece,
                Number(rawGlowPoint.x) || 0,
                Number(rawGlowPoint.y) || 0
            );
            const spriteDepth = Number(piece._sprite?.depth);
            const baseDepth = Number.isFinite(spriteDepth)
                ? spriteDepth
                : (Number.isFinite(Number(piece.depth)) ? Number(piece.depth) : Number(piece.y) || 0);
            const glowKey = `world125:candle:${index}:${Math.round(piece.x)}:${Math.round(piece.y)}`;
            this.scene.registerEnvironmentGlow?.(glowKey, glowPoint.x, glowPoint.y, {
                radius: glowRadius,
                color: glowColor,
                alpha: glowAlpha,
                depth: baseDepth + 0.25,
                flicker: glowFlicker,
                pulsePeriodMs: glowPulsePeriodMs,
            });
            this._candleGlowKeys.push(glowKey);
            return { piece, flamePoints, glowPoint };
        });
        for (const building of buildings) {
            const flamePoints = rawFlamePoints.map((point) => this._buildingTexturePoint(building, point));
            const glowPoint = this._buildingTexturePoint(building, rawGlowPoint);
            const baseDepth = Number(building._phaserSprite?.depth) || Number(building.y) || 0;
            const glowKey = `world125:candle:building:${building.id}`;
            this.scene.registerEnvironmentGlow?.(glowKey, glowPoint.x, glowPoint.y, {
                radius: glowRadius,
                color: glowColor,
                alpha: glowAlpha,
                depth: baseDepth + 0.25,
                flicker: glowFlicker,
                pulsePeriodMs: glowPulsePeriodMs,
            });
            this._candleGlowKeys.push(glowKey);
            visualCandles.push({ building, flamePoints, glowPoint });
        }
        this._candles = visualCandles;
    }

    _removeCandleGlows() {
        if (this.scene?.unregisterEnvironmentGlow) {
            for (const key of this._candleGlowKeys) this.scene.unregisterEnvironmentGlow(key);
        }
        this._candleGlowKeys = [];
    }

    _advanceCandleEmbers(config, deltaMs) {
        if (!this._emberEmitter || config.enabled === false || !this._candles.length) return;
        const frequencyMs = Math.max(24, Number(config.emberFrequencyMs) || 95)
            / this._qualityMultiplier;
        this._emberAccumulatorMs += deltaMs;
        if (this._emberEmitter.atLimit()) {
            this._emberAccumulatorMs = Math.min(this._emberAccumulatorMs, frequencyMs);
            return;
        }

        let emissions = 0;
        while (this._emberAccumulatorMs >= frequencyMs && emissions < MAX_EMISSIONS_PER_FRAME) {
            this._emberAccumulatorMs -= frequencyMs;
            const flame = this._pickVisibleFlamePoint();
            if (flame) {
                const quantity = Math.max(1, Math.round(Number(config.emberQuantity) || 1));
                this._emberEmitter.emitParticleAt(flame.x, flame.y, quantity);
            }
            emissions++;
            if (this._emberEmitter.atLimit()) break;
        }
        if (emissions >= MAX_EMISSIONS_PER_FRAME) {
            this._emberAccumulatorMs = Math.min(this._emberAccumulatorMs, frequencyMs);
        }
    }

    _pickVisibleFlamePoint() {
        const view = this.scene?.cameras?.main?.worldView;
        if (!view) return null;
        const margin = 96;
        for (let attempt = 0; attempt < Math.min(12, this._candles.length * 2); attempt++) {
            const candle = this._candles[Math.floor(Math.random() * this._candles.length)];
            if (!candle?.flamePoints?.length) continue;
            const point = candle.glowPoint;
            if (point.x < view.x - margin || point.x > view.right + margin
                || point.y < view.y - margin || point.y > view.bottom + margin) continue;
            if (typeof this.scene.isFogPointVisible === 'function'
                && !this.scene.isFogPointVisible(point.x, point.y)) continue;
            return candle.flamePoints[Math.floor(Math.random() * candle.flamePoints.length)];
        }
        return null;
    }

    _syncColdOverlay(config) {
        const overlay = this._coldOverlay;
        if (!overlay?.active) return;
        const zoom = this.scene?.cameras?.main?.zoom || 1;
        const viewW = this.scene?.scale?.width || 1920;
        const viewH = this.scene?.scale?.height || 1080;
        const periodMs = Math.max(1000, Number(config.pulsePeriodMs) || 11000);
        const wave = (Math.sin((this._elapsedMs / periodMs) * TWO_PI) + 1) * 0.5;
        const alphaRange = readRange(config.alpha, 0.035, 0.075);
        overlay.setPosition(0, 0);
        overlay.setSize(viewW / zoom, viewH / zoom);
        overlay.setFillStyle(parseColor(config.color, 0x0c171b), alphaRange.min + (alphaRange.max - alphaRange.min) * wave);
        overlay.setVisible(config.enabled !== false);
    }
}

export default World125AtmosphereSystem;
