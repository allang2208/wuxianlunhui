import populationEconomyConfig from '../../data/population-economy.json';
import {
    applyCivilianAnimSize,
    fadeOutAndDestroyCivilian,
    registerCivilianVisual,
    resolveCivilianVisualPosition,
    sweepCivilianVisualMove,
} from './civilian-visual-utils.js';
import { CivilianVisualSettings } from './civilian-visual-runtime.js';

const INDUSTRIAL_VISUAL_STATES = Object.freeze({
    oil_power_plant: 'maintaining',
    cannery: 'inspecting',
    trading_company: 'negotiating',
});

function isSupportedBuilding(building) {
    return !!INDUSTRIAL_VISUAL_STATES[building?._economyType];
}

function visualConfig(building) {
    return populationEconomyConfig[building?._economyType]?.workerVisual || null;
}

function animationKey(building, state) {
    const id = visualConfig(building)?.id;
    return id ? `worker_${id}_${state}` : '';
}

function randomRange(range, fallbackMin, fallbackMax) {
    const min = Math.max(0, Number(range?.[0]) || fallbackMin);
    const max = Math.max(min, Number(range?.[1]) || fallbackMax);
    return min + Math.random() * (max - min);
}

function visualState(worker) {
    if (worker?.state === 'walking') return 'walking';
    if (worker?.state === 'working') {
        return INDUSTRIAL_VISUAL_STATES[worker.building?._economyType] || 'idle';
    }
    return 'idle';
}

function syncAnimation(worker, force = false) {
    const state = visualState(worker);
    if (!force && worker?.visualState === state) return;
    const key = animationKey(worker?.building, state);
    if (!key || !worker?.sprite?.active || !worker.sprite.scene?.anims?.exists(key)) return;
    worker.visualState = state;
    worker.sprite.play(key, true);
    applyCivilianAnimSize(worker.sprite, visualConfig(worker.building), state);
}

function setState(worker, state) {
    if (!worker || worker.state === state) return;
    worker.state = state;
    syncAnimation(worker);
}

function randomWanderPoint(building) {
    const config = visualConfig(building);
    const radius = Math.max(32, Number(config?.wanderRadius) || 190);
    const minRadius = Math.min(radius, Math.max(24, Number(config?.wanderMinRadius) || 72));
    const distance = Math.sqrt(Math.random()) * (radius - minRadius) + minRadius;
    const angle = Math.random() * Math.PI * 2;
    return resolveCivilianVisualPosition(
        (Number(building?.x) || 0) + Math.cos(angle) * distance,
        (Number(building?.y) || 0) + Math.sin(angle) * distance
    );
}

function moveWorker(worker, target, speed, dt) {
    const dtMs = Math.max(0, Number(dt) || 0);
    const dx = target.x - worker.x;
    const dy = target.y - worker.y;
    const distance = Math.hypot(dx, dy);
    const desired = Math.max(0, speed) * Math.min(1, distance / 60);
    const wantX = distance > 0 ? dx / distance * desired : 0;
    const wantY = distance > 0 ? dy / distance * desired : 0;
    const smoothing = 1 - Math.pow(0.85, dtMs / 16.67);
    worker.vx = (worker.vx || 0) + (wantX - (worker.vx || 0)) * smoothing;
    worker.vy = (worker.vy || 0) + (wantY - (worker.vy || 0)) * smoothing;
    const fromX = worker.x;
    const fromY = worker.y;
    const moved = sweepCivilianVisualMove(
        worker,
        worker.x + worker.vx * dtMs / 1000,
        worker.y + worker.vy * dtMs / 1000
    );
    worker.x = moved.x;
    worker.y = moved.y;
    if (moved.blocked && dtMs > 0) {
        worker.vx = (worker.x - fromX) * 1000 / dtMs;
        worker.vy = (worker.y - fromY) * 1000 / dtMs;
    }
    if (distance <= Math.max(2, speed * dtMs / 1000 * 2)
        && Math.hypot(worker.vx, worker.vy) < 10) {
        worker.x = target.x;
        worker.y = target.y;
        worker.vx = 0;
        worker.vy = 0;
        return true;
    }
    return false;
}

function workingDurationMs(worker) {
    const config = visualConfig(worker?.building);
    const state = INDUSTRIAL_VISUAL_STATES[worker?.building?._economyType];
    const animation = config?.animations?.[state] || {};
    if (Number(animation.repeat) === 0) {
        const frameCount = Math.max(1, Number(animation.frameCount) || 1);
        const frameRate = Math.max(1, Number(animation.frameRate) || 12);
        return frameCount / frameRate * 1000;
    }
    return randomRange(config?.workDurationMs, 1800, 3400);
}

function createWorker(scene, building, index, count) {
    const config = visualConfig(building);
    const idleKey = animationKey(building, 'idle');
    if (!config || !idleKey || !scene?.textures?.exists(idleKey) || !scene?.add?.sprite) return null;
    const centered = index - (count - 1) / 2;
    const spawn = resolveCivilianVisualPosition(
        (Number(building.x) || 0) + centered * 28,
        (Number(building.y) || 0) + 24 + Math.abs(centered) * 5
    );
    const sprite = scene.add.sprite(spawn.x, spawn.y, idleKey, 0);
    sprite.setOrigin(0.5, Number(config.originY) || 0.921875);
    const displaySize = Math.max(1, Number(config.displaySize) || 91.6);
    sprite.setDisplaySize(displaySize, displaySize);
    const worker = registerCivilianVisual({
        scene,
        building,
        index,
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        sprite,
        state: 'idle',
        visualState: '',
        stateRemainMs: randomRange(config.idleDurationMs, 900, 2200),
        destination: null,
    }, `industrial_worker_${building._economyType}`);
    syncAnimation(worker, true);
    return worker;
}

function updateWorker(worker, dt) {
    const config = visualConfig(worker?.building);
    const elapsedMs = Math.max(0, Number(dt) || 0);
    if (worker.state === 'working' && !worker.building?._economyWorking) {
        worker.stateRemainMs = randomRange(config?.idleDurationMs, 900, 2200);
        setState(worker, 'idle');
    }

    if (worker.state === 'walking') {
        if (!worker.destination) worker.destination = randomWanderPoint(worker.building);
        const dx = worker.destination.x - worker.x;
        if (worker.sprite?.active && Math.abs(dx) > 0.01) worker.sprite.setFlipX(dx < 0);
        const speed = Math.max(1, Number(config?.moveSpeed) || 58);
        if (moveWorker(worker, worker.destination, speed, elapsedMs)) {
            worker.destination = null;
            if (worker.building?._economyWorking && Math.random() < 0.65) {
                worker.stateRemainMs = workingDurationMs(worker);
                setState(worker, 'working');
            } else {
                worker.stateRemainMs = randomRange(config?.idleDurationMs, 900, 2200);
                setState(worker, 'idle');
            }
        }
    } else {
        worker.stateRemainMs -= elapsedMs;
        if (worker.stateRemainMs <= 0) {
            if (worker.state === 'working') {
                worker.stateRemainMs = randomRange(config?.idleDurationMs, 900, 2200);
                setState(worker, 'idle');
            } else if (worker.building?._economyWorking && Math.random() < 0.55) {
                worker.stateRemainMs = workingDurationMs(worker);
                setState(worker, 'working');
            } else {
                worker.destination = randomWanderPoint(worker.building);
                setState(worker, 'walking');
            }
        }
    }
    worker.sprite?.setPosition(worker.x, worker.y);
}

/**
 * 三栋近代工业经济建筑的岗位显示层。它只读取岗位数和 `_economyWorking`，
 * 不创建游戏实体、物理体或存档记录，也不反向推进工业结算。
 */
export const IndustrialEconomyWorkerVisualSystem = {
    _records: new Map(),

    updateBuilding(building, dt) {
        if (!isSupportedBuilding(building)) return;
        if (!CivilianVisualSettings.isEnabled()) {
            this.clearBuilding(building);
            return;
        }
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const config = visualConfig(building);
        const assigned = Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0));
        const cap = Math.max(0, Math.floor(Number(
            populationEconomyConfig[building._economyType]?.visualWorkerCap
        ) || 0));
        const targetCount = Math.min(assigned, cap);
        if (!building?.active || !scene || !config || targetCount <= 0) {
            this.clearBuilding(building);
            return;
        }

        let record = this._records.get(building);
        if (record && (record.scene !== scene
            || record.workers.some((worker) => !worker?.sprite?.active))) {
            this.clearBuilding(building);
            record = null;
        }
        if (!record) {
            record = { scene, workers: [] };
            this._records.set(building, record);
        }
        while (record.workers.length > targetCount) {
            fadeOutAndDestroyCivilian(record.workers.pop());
        }
        while (record.workers.length < targetCount) {
            const worker = createWorker(scene, building, record.workers.length, targetCount);
            if (!worker) break;
            record.workers.push(worker);
        }
        for (const worker of record.workers) updateWorker(worker, dt);
    },

    clearBuilding(building) {
        const record = this._records.get(building);
        if (!record) return;
        for (const worker of record.workers) fadeOutAndDestroyCivilian(worker);
        this._records.delete(building);
    },

    reset() {
        for (const building of Array.from(this._records.keys())) this.clearBuilding(building);
    },
};
