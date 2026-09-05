import { GAME_CONFIG } from '../config/game-config.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { WorldWeatherSystem } from './world-weather-system.js';
import { World122DroughtSystem } from './world122-drought-system.js';
import { World122SandstormSystem } from './world122-sandstorm-system.js';
import { resolveFoodProductionWeatherEffect } from './food-production-weather.js';
import { resolveWindPowerWeatherEffect, resolveSolarPowerWeatherEffect } from './power-plant-weather.js';

const currentTime = () => Math.max(0, Number(EnvironmentLightingSystem.serializeTime().elapsedMs) || 0);

/** 三类天气按同一时间轴推进；在旧排期被消费前结算后台，不保存无限历史。 */
export const WorldProductionWeather = {
    _cursor: null,
    _initialized: false,
    _advancing: false,
    _settleBackground: null,

    setSettlementHandler(handler) {
        this._settleBackground = handler;
    },

    reset(gameTimeMs = null) {
        // 新游戏/读档只重置运行期游标；天气排期仍由原有存档各自恢复。
        this._cursor = Number.isFinite(gameTimeMs) ? Math.max(0, gameTimeMs) : null;
        this._initialized = false;
    },

    getMultipliers(sceneId, at = this._cursor ?? currentTime()) {
        const weather = {
            rainState: WorldWeatherSystem._readProductionState(sceneId, at),
            droughtActive: World122DroughtSystem.isActive(sceneId),
            sandstormActive: World122SandstormSystem.isActive(sceneId),
        };
        return {
            food: resolveFoodProductionWeatherEffect(sceneId, weather).multiplier,
            foodDroughtActive: !weather.rainState?.active && weather.droughtActive,
            wind: resolveWindPowerWeatherEffect(weather).multiplier,
            solar: resolveSolarPowerWeatherEffect(weather).multiplier,
        };
    },

    _flushBoundary(at) {
        if (!this._settleBackground) return;
        const multipliers = Object.fromEntries(Object.keys(GAME_CONFIG.scenes || {})
            .map(sceneId => [sceneId, this.getMultipliers(sceneId)]));
        this._settleBackground(at, multipliers);
    },

    _advanceTo(at, options) {
        World122SandstormSystem._advanceProductionWeather(at, options);
        World122DroughtSystem._advanceProductionWeather(at, options);
        WorldWeatherSystem._advanceProductionWeather(at);
    },

    update(gameTimeMs = currentTime(), options = {}) {
        const now = Math.max(0, Number(gameTimeMs) || 0);
        // 结算只消费已冻结倍率；嵌套查询和历史时间查询不能回退或再次推进排期。
        if (this._advancing || (this._cursor !== null && now < this._cursor)) return;
        if (this._initialized && now === this._cursor) return;
        this._advancing = true;
        try {
            if (this._cursor === null) this._cursor = now;
            if (!this._initialized) {
                this._advanceTo(this._cursor, options);
                this._initialized = true;
            }
            while (true) {
                const boundary = Math.min(
                    WorldWeatherSystem._nextProductionBoundary(this._cursor),
                    World122DroughtSystem._nextProductionBoundary(this._cursor),
                    World122SandstormSystem._nextProductionBoundary(this._cursor)
                );
                if (!(boundary <= now)) break;
                this._flushBoundary(boundary);
                this._cursor = boundary;
                this._advanceTo(boundary, options);
            }
            this._cursor = now;
            this._advanceTo(now, options);
        } finally {
            this._advancing = false;
        }
    },

    flushBeforeChange(gameTimeMs = currentTime()) {
        this.update(gameTimeMs, { notifyPlayer: false });
        this._flushBoundary(this._cursor);
    },
};
