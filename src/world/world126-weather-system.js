// 矿洞灾变的持久化真源；不导入 Game/实体类，避免启动阶段循环依赖。
import { GAME_CONFIG } from '../config/game-config.js';
import { EventBus } from '../core/event-bus.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { getWeatherEventIconPath } from './weather-event-icons.js';

export const MINE_WEATHER_SCENE = 'scene12';
export const MINE_WEATHER_KINDS = ['earthquake', 'poisonGas', 'resurrection'];
const ICONS = { earthquake: '⛰', poisonGas: '☣', resurrection: '☠' };
const clone = (value) => JSON.parse(JSON.stringify(value));
const fresh = () => ({ version: 1, worldEpoch: 0, sequence: 0, queue: [], event: null, survivors: [] });
let state = fresh();
let runtime = null;

export function mineWeatherConfig() {
    return GAME_CONFIG.scenes?.scene12?.environmentEffects?.mineWeather || {};
}
export function mineWeatherNow() {
    return Math.max(0, Number(EnvironmentLightingSystem.serializeTime()?.elapsedMs) || 0);
}
export function mineWeatherDayMs() {
    return Math.max(1, Number(EnvironmentLightingSystem.getConfig()?.dayDurationMs) || 720000);
}
function range(value, min, max) {
    const lo = Number.isFinite(Number(value?.min)) ? Number(value.min) : min;
    const hi = Number.isFinite(Number(value?.max)) ? Number(value.max) : max;
    return Math.min(lo, hi) + Math.random() * Math.abs(hi - lo);
}
function announce(text, options = {}) {
    if (typeof window === 'undefined') return;
    window.SceneManager?.showTopNotification?.(text, { color: '#cdb995', duration: 4600, ...options });
}

function impactSummary(kind) {
    if (kind === 'earthquake') return '落石将持续袭击单位与建筑';
    if (kind === 'poisonGas') return '毒区持续生成，僵尸单位免疫毒气';
    return '沉眠亡者持续出现，阵亡怪物可能复苏';
}

function specialWeatherId(kind) {
    return `mine_${kind}`;
}

function announceEventStart(event, prefix = '') {
    if (!event) return;
    const name = mineWeatherConfig()[event.kind]?.name || event.kind;
    const durationDays = Math.max(0, (event.end - event.start) / mineWeatherDayMs());
    announce(`${prefix}世界-126·矿洞迎来${name}`, {
        onComplete: () => {
            const now = mineWeatherNow();
            if (state.event?.id !== event.id || now < event.start || now >= event.end) return;
            EventBus.emit('weather:report-ready', {
                id: event.id,
                sceneId: MINE_WEATHER_SCENE,
                iconPath: getWeatherEventIconPath(specialWeatherId(event.kind)),
                title: `世界-126·矿洞 · ${name}`,
                summary: `预计持续 ${durationDays.toFixed(2)} 天 · ${impactSummary(event.kind)}`,
            });
        },
    });
}

function clearWeatherReport(event) {
    if (event?.id) EventBus.emit('weather:report-clear', { id: event.id });
}
function worldAvailable() {
    if (typeof window === 'undefined') return null;
    const portal = window.WorldProgressionSystem?.getPortalState?.(MINE_WEATHER_SCENE);
    return portal?.constructed && !portal.destroyed ? portal : null;
}
function createEvent(start, kind = null) {
    const cfg = mineWeatherConfig();
    if (!kind) {
        const weights = cfg.schedule?.weights || { earthquake: 40, poisonGas: 35, resurrection: 25 };
        let ticket = Math.random() * MINE_WEATHER_KINDS.reduce((sum, key) => sum + Math.max(0, Number(weights[key]) || 0), 0);
        kind = MINE_WEATHER_KINDS.find((key) => (ticket -= Math.max(0, Number(weights[key]) || 0)) < 0) || 'earthquake';
    }
    const duration = range(cfg[kind]?.durationDays, kind === 'earthquake' ? 0.4 : 0.5,
        kind === 'earthquake' ? 0.6 : (kind === 'poisonGas' ? 0.75 : 1));
    return {
        id: `mine:${state.worldEpoch}:${++state.sequence}`, kind, start,
        end: start + duration * mineWeatherDayMs(), warned: false,
        rounds: Math.floor(range({ min: cfg.earthquake?.rounds?.min ?? 4,
            max: (cfg.earthquake?.rounds?.max ?? 6) + 1 }, 4, 7)), nextRound: 0,
        nextBatchAt: start, generated: 0, eliteGenerated: 0, lordGenerated: 0,
        pending: [],
    };
}
function planNext(after) {
    const delay = range(mineWeatherConfig().schedule?.intervalDays, 3, 5) * mineWeatherDayMs();
    state.queue.push(createEvent(after + delay));
}

export const World126WeatherSystem = {
    forecastSceneIds: [MINE_WEATHER_SCENE],
    attachRuntime(value) { runtime = value; },
    getState() { return state; },
    getActiveEvent(now = mineWeatherNow()) {
        return state.event && now >= state.event.start && now < state.event.end ? state.event : null;
    },
    reset() {
        clearWeatherReport(state.event);
        runtime?.reset(false);
        state = fresh();
    },
    update(now = mineWeatherNow(), { notifyPlayer = true } = {}) {
        if (mineWeatherConfig().enabled !== true) return;
        const portal = worldAvailable();
        if (!portal) return;
        const epoch = Number(portal.worldEpoch) || 1;
        if (state.worldEpoch !== epoch) {
            this.reset();
            state.worldEpoch = epoch;
        }
        if (!state.event && !state.queue.length) planNext(now);
        // 绝对游戏时钟。离场/调时间不追补已结束灾变的落石、毒伤或尸潮。
        for (let guard = 0; guard < 64; guard++) {
            if (state.event && now >= state.event.end) {
                const ended = state.event;
                clearWeatherReport(ended);
                ended.pending = [];
                runtime?.endEvent(ended.id);
                state.event = null;
                if (notifyPlayer && window.SceneManager?.currentScene === MINE_WEATHER_SCENE) {
                    announce(`${mineWeatherConfig()[ended.kind]?.name || ended.kind}已结束`);
                }
                if (!state.queue.length) planNext(ended.end);
                continue;
            }
            const next = state.queue[0];
            if (state.event || !next) break;
            if (now >= next.start) {
                state.event = state.queue.shift();
                if (now < state.event.end && notifyPlayer) {
                    announceEventStart(state.event);
                }
                continue;
            }
            const warningAt = next.start - (mineWeatherConfig().schedule?.warningLeadDays ?? 0.25) * mineWeatherDayMs();
            if (!next.warned && now >= warningAt) {
                next.warned = true;
                if (notifyPlayer) announce(`矿洞灾害预警：${mineWeatherConfig()[next.kind]?.name || next.kind}即将到来`);
            }
            break;
        }
    },
    captureRuntime() { runtime?.capture(); },
    onEnemyDeath(entity) { runtime?.onEnemyDeath(entity); },
    admitSummon(spawner, entity) { return runtime?.admitSummon(spawner, entity) ?? !(spawner?._mineWeather); },
    onWorldDestroyed(sceneId) { if (sceneId === MINE_WEATHER_SCENE) this.reset(); },
    serialize() {
        this.captureRuntime();
        return clone(state);
    },
    restore(data) {
        clearWeatherReport(state.event);
        runtime?.reset(false);
        state = fresh();
        if (!data || data.version !== 1) return;
        state.worldEpoch = Math.max(0, Number(data.worldEpoch) || 0);
        state.sequence = Math.max(0, Number(data.sequence) || 0);
        const validEvent = (event) => event && MINE_WEATHER_KINDS.includes(event.kind)
            && Number.isFinite(event.start) && Number.isFinite(event.end) && event.end > event.start;
        state.event = validEvent(data.event) ? clone(data.event) : null;
        state.queue = Array.isArray(data.queue) ? data.queue.filter(validEvent).slice(0, 12).map(clone) : [];
        for (const event of [state.event, ...state.queue].filter(Boolean)) {
            event.pending = Array.isArray(event.pending) ? event.pending.slice(0, 36) : [];
        }
        state.survivors = Array.isArray(data.survivors)
            ? data.survivors.filter((entry) => entry?.uid && entry.hp > 0).slice(0, 18).map(clone) : [];
    },
    debugToggle(kind) {
        if (!MINE_WEATHER_KINDS.includes(kind)) return { ok: false, reason: '未知天气' };
        if (!runtime?.available() || !worldAvailable()) return { ok: false, reason: '请先进入矿洞位面' };
        this.update();
        const now = mineWeatherNow();
        const previous = state.event;
        if (previous) { clearWeatherReport(previous); previous.pending = []; runtime.endEvent(previous.id); }
        state.event = previous?.kind === kind ? null : createEvent(now, kind);
        state.queue = [];
        planNext(state.event?.end ?? now);
        if (state.event) announceEventStart(state.event, '开发触发：');
        else announce('矿洞灾变已结束');
        return { ok: true, model: this.getDebugModel() };
    },
    getDebugModel() {
        const now = mineWeatherNow();
        const event = this.getActiveEvent(now);
        const next = state.queue[0];
        return {
            available: !!runtime?.available(), active: !!event, kind: event?.kind || next?.kind,
            name: mineWeatherConfig()[event?.kind || next?.kind]?.name || '尚未排期',
            remainingDays: Math.max(0, (event?.end ?? next?.start ?? now) - now) / mineWeatherDayMs(),
            alive: state.survivors.length, generated: event?.generated || 0,
            pending: event?.pending?.length || 0, error: runtime?.spawnError || '',
            kinds: MINE_WEATHER_KINDS.map((id) => ({ id, name: mineWeatherConfig()[id]?.name || id })),
        };
    },
    getForecastEvents({ sceneId, nowGameTimeMs = mineWeatherNow(), horizonEndGameTimeMs, showDuration = false } = {}) {
        if (sceneId !== MINE_WEATHER_SCENE || !worldAvailable() || mineWeatherConfig().enabled !== true) return [];
        this.update(nowGameTimeMs, { notifyPlayer: false });
        const horizon = Number.isFinite(horizonEndGameTimeMs) ? horizonEndGameTimeMs : nowGameTimeMs + 5 * mineWeatherDayMs();
        // 预报先排定并保存，后续照表兑现，不在刷新 HUD 时重新抽签。
        while (state.queue.length < 12) {
            const last = state.queue.at(-1) || state.event;
            if (!last || last.end >= horizon) break;
            planNext(last.end);
        }
        return [state.event, ...state.queue].filter((event) => event && event.end > nowGameTimeMs && event.start <= horizon)
            .map((event) => {
                const active = event === state.event;
                const name = mineWeatherConfig()[event.kind]?.name || event.kind;
                return {
                    id: event.id, sceneId, worldName: '世界-126·矿洞', weatherKind: 'special',
                    specialWeatherId: specialWeatherId(event.kind), icon: ICONS[event.kind],
                    iconPath: getWeatherEventIconPath(specialWeatherId(event.kind)),
                    label: `世界-126·矿洞 · ${name}`, intensityId: event.kind, intensityName: name,
                    startsAtGameTimeMs: event.start, atGameTimeMs: active ? nowGameTimeMs : event.start,
                    endsAtGameTimeMs: active || showDuration ? event.end : undefined,
                    durationLabel: showDuration ? `${((event.end - event.start) / mineWeatherDayMs()).toFixed(2)} 天` : null,
                    warningLevel: 'critical', warningLabel: `${name}灾害预警`, status: active ? 'active' : 'upcoming',
                };
            });
    },
};
