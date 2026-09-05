import config from '../../data/world-strategy.json';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { strategicCell, strategicPath } from './world-map-cells.js';
import { strategicTerrainCost } from './strategic-terrain.js';

// Read the same clock as every other mode. Never advance or scale world time here.
export const strategicNow = () => Math.max(0, EnvironmentLightingSystem.serializeTime().elapsedMs || 0);
export const strategicDayDurationMs = () => Math.max(1, EnvironmentLightingSystem.getConfig().dayDurationMs);
export const strategicTerrain = (cell) => config.march.terrain[cell?.biome] || { name: '普通地形', multiplier: 1 };
export const strategicStepDays = (from, to) => config.march.baseDaysPerCell * strategicTerrain(to).multiplier * strategicTerrainCost(from, to);
export const strategicStepMs = (from, to) => strategicStepDays(from, to) * strategicDayDurationMs();
export const strategicMarchMultiplier = (unit) => unit?.kind === 'convoy' ? config.supply.convoySpeedMultiplier
    : unit?.kind === 'settler' ? config.settlers.marchMultiplier
    : unit?.supply && unit.supply.food <= 0 ? config.supply.emptyMarchMultiplier : 1;
export const strategicRoute = (from, to, allowed, cacheKey) => {
    const minimumStep = config.march.baseDaysPerCell * Math.min(1, ...Object.values(config.march.terrain).map((terrain) => terrain.multiplier));
    const weights = JSON.stringify([config.march, config.terrainRules]);
    return strategicPath(from, to, allowed, strategicStepDays, { minimumStep,
        cacheKey: cacheKey == null ? undefined : `${weights}:${cacheKey}` });
};

export function strategicMarchStatus(unit, now = strategicNow()) {
    const march = unit?.march;
    if (!march || march.fromCellId !== unit.cellId) return null;
    const elapsed = Math.max(0, now - march.startedAtGameTimeMs);
    return { ...march, progress: Math.min(1, elapsed / march.durationGameMs),
        remainingMs: Math.max(0, march.durationGameMs - elapsed), terrain: strategicTerrain(strategicCell(march.toCellId)) };
}

export function strategicRouteEstimate(unit, targetId, allowed = () => true, waypoints = [], cacheKey) {
    const march = strategicMarchStatus(unit);
    // The current edge is committed. Replanning starts at its destination rather
    // than teleporting the marker back to its last logical cell.
    const startId = march?.toCellId || unit.cellId;
    const destinations = [...waypoints, targetId], stops = [];
    const route = march ? [startId] : [];
    let from = strategicCell(startId), durationMs = march?.remainingMs || 0;
    if (!from) return null;
    for (let index = 0; index < destinations.length; index++) {
        const destination = strategicCell(destinations[index]), final = index === destinations.length - 1;
        const canEnter = (cell) => allowed(cell, final);
        // Even a zero-length leg must pass destination admission. An attack's
        // exception applies to the final leg only, never to earlier waypoints.
        if (!destination || !canEnter(destination)) return null;
        const onward = strategicRoute(from.id, destination.id, canEnter,
            cacheKey == null ? undefined : `${cacheKey}:final=${final}`);
        if (!onward) return null;
        for (const id of onward) {
            const to = strategicCell(id);
            durationMs += strategicStepMs(from, to) * strategicMarchMultiplier(unit);
            from = to;
            route.push(id);
        }
        stops.push({ cellId: destination.id, durationMs, routeIndex: route.length, final });
    }
    return { route, durationMs, stops };
}

export function formatStrategicDuration(ms) {
    const minutes = Math.max(0, Math.ceil(ms / strategicDayDurationMs() * 24 * 60 - 1e-9));
    const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), remainder = minutes % 60;
    return `${days ? `${days}天 ` : ''}${hours}时${String(remainder).padStart(2, '0')}分`;
}

// One millisecond of the shared clock is one millisecond at normal runtime speed.
// This is required running time, not a wall-clock arrival deadline or offline progress.
export function formatStrategicTravelTime(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
    const real = `${hours ? `${hours}小时` : ''}${minutes || hours ? `${minutes}分` : ''}${seconds % 60}秒`;
    return `游戏 ${formatStrategicDuration(ms)} / 现实约 ${real}`;
}

export function strategicClockHint() {
    if (!EnvironmentLightingSystem.getConfig().animateSun) return '世界时钟已冻结，恢复后继续行军。';
    if (!window.Game?.isRunning || window.Game?._paused) return '游戏已暂停，预计耗时从恢复后计算。';
    return '现实耗时按正常运行估算，不含暂停、后台挂起、接战与切场等待。';
}
