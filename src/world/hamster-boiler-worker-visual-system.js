import populationEconomyConfig from '../../data/population-economy.json';
import {
    applyCivilianAnimSize,
    fadeOutAndDestroyCivilian,
    registerCivilianVisual,
    resolveCivilianVisualPosition,
} from './civilian-visual-utils.js';
import { CivilianVisualSettings } from './civilian-visual-runtime.js';

function visualConfig() {
    return populationEconomyConfig.steam_power_plant?.workerVisual || null;
}

function animationKey(state) {
    const id = visualConfig()?.id;
    return id ? `worker_${id}_${state}` : '';
}

const MOVEMENT_VISUAL_GRACE_MS = 120;

function phaseVisual(phase, moving) {
    const animations = visualConfig()?.animations || {};
    const hasDedicatedCargoStates = !!(
        animations.empty_running
        && animations.food_loaded_running
        && animations.energy_loaded_running
    );
    if (!hasDedicatedCargoStates) {
        if (phase === 'processing') return { state: 'fixing', paused: false };
        if (phase === 'to_pickup' || phase === 'to_plant' || phase === 'to_deposit') {
            return { state: 'running', paused: false };
        }
        return { state: 'idle', paused: false };
    }
    if (phase === 'to_pickup') {
        return { state: moving ? 'empty_running' : 'idle', paused: false };
    }
    if (phase === 'to_plant') {
        return { state: 'food_loaded_running', paused: !moving };
    }
    if (phase === 'to_deposit') {
        return { state: 'energy_loaded_running', paused: !moving };
    }
    if (phase === 'waiting_deposit') {
        return { state: 'energy_loaded_running', paused: true };
    }
    return { state: 'idle', paused: false };
}

function syncAnimation(worker, visual) {
    const { state, paused } = visual;
    const key = animationKey(state);
    if (!key || !worker.sprite?.scene?.anims?.exists(key)) return;
    const animation = visualConfig()?.animations?.[state] || {};
    if (paused) {
        const holdFrame = Math.max(0, Math.floor(Number(animation.holdFrame) || 0));
        if (worker.sprite.anims?.isPlaying) worker.sprite.anims.stop();
        if (worker.sprite.texture?.key !== key || Number(worker.sprite.frame?.name) !== holdFrame) {
            worker.sprite.setTexture(key, holdFrame);
        }
        worker.visualState = state;
        worker.visualPaused = true;
        worker.visualResumeFrame = holdFrame;
        applyCivilianAnimSize(worker.sprite, visualConfig(), state);
        return;
    }
    if (worker.visualState === state && !worker.visualPaused
        && worker.sprite.anims?.isPlaying && worker.sprite.anims.currentAnim?.key === key) return;
    const resumeFrame = worker.visualState === state && worker.visualPaused
        ? Math.max(0, Math.floor(Number(worker.visualResumeFrame) || 0))
        : 0;
    worker.visualState = state;
    worker.visualPaused = false;
    worker.visualResumeFrame = 0;
    worker.sprite.play({ key, startFrame: resumeFrame }, true);
    applyCivilianAnimSize(worker.sprite, visualConfig(), state);
}

function createWorker(scene, building, job) {
    const config = visualConfig();
    const idleKey = animationKey('idle');
    if (!config || !scene?.textures?.exists(idleKey) || !scene?.add?.sprite) return null;
    const point = resolveCivilianVisualPosition(
        Number.isFinite(Number(job?.x)) ? Number(job.x) : (Number(building?.x) || 0),
        Number.isFinite(Number(job?.y)) ? Number(job.y) : (Number(building?.y) || 0)
    );
    job.x = point.x;
    job.y = point.y;
    const sprite = scene.add.sprite(point.x, point.y, idleKey, 0);
    const displaySize = Math.max(1, Number(config.displaySize) || 128);
    sprite.setOrigin(0.5, Number(config.originY) || 0.82);
    sprite.setDisplaySize(displaySize, displaySize);
    const worker = registerCivilianVisual({
        scene,
        building,
        slot: job.slot,
        sprite,
        x: point.x,
        y: point.y,
        civilianCollisionMode: 'walls_only',
        visualState: '',
        visualPaused: false,
        visualResumeFrame: 0,
        lastMovedAt: Number.NEGATIVE_INFINITY,
    }, 'steam_boiler_worker');
    syncAnimation(worker, phaseVisual(job.phase, false));
    return worker;
}

function destroyWorker(worker) {
    if (worker) fadeOutAndDestroyCivilian(worker);
}

/** 两名锅炉工只是 SteamPowerPlantSystem 任务记录的 Phaser 投影。 */
export const HamsterBoilerWorkerVisualSystem = {
    _records: new Map(),

    updateBuilding(building) {
        if (building?._economyType !== 'steam_power_plant') return;
        if (!CivilianVisualSettings.isEnabled()) {
            this.clearBuilding(building);
            return;
        }
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const assigned = Math.max(0, Math.floor(Number(building._assignedWorkers) || 0));
        const cap = Math.max(0,
            Math.floor(Number(populationEconomyConfig.steam_power_plant?.visualWorkerCap) || 0));
        const jobs = building._steamJobs || [];
        const targetCount = Math.min(assigned, cap, jobs.length);
        if (!building.active || !scene || !visualConfig() || targetCount <= 0) {
            this.clearBuilding(building);
            return;
        }

        let records = this._records.get(building) || [];
        if (records.some((worker) => worker.scene !== scene || !worker.sprite?.active)) {
            this.clearBuilding(building);
            records = [];
        }
        while (records.length > targetCount) destroyWorker(records.pop());
        while (records.length < targetCount) {
            const worker = createWorker(scene, building, jobs[records.length]);
            if (!worker) break;
            records.push(worker);
        }
        if (records.length) this._records.set(building, records);

        records.forEach((worker, index) => {
            const job = jobs[index];
            if (!job) return;
            const nextX = Number(job.x) || 0;
            const nextY = Number(job.y) || 0;
            const moved = Math.hypot(nextX - worker.x, nextY - worker.y) > 0.01;
            if (moved) {
                worker.lastMovedAt = Number(scene.time?.now) || 0;
                if (Math.abs(nextX - worker.x) > 0.01) worker.sprite.setFlipX(nextX < worker.x);
            }
            const now = Number(scene.time?.now) || 0;
            const moving = moved || now - worker.lastMovedAt <= MOVEMENT_VISUAL_GRACE_MS;
            syncAnimation(worker, phaseVisual(job.phase, moving));
            worker.x = nextX;
            worker.y = nextY;
            worker.sprite.setPosition(nextX, nextY);
        });
    },

    clearBuilding(building) {
        const records = this._records.get(building);
        if (!records) return;
        records.forEach(destroyWorker);
        this._records.delete(building);
    },

    reset() {
        for (const building of Array.from(this._records.keys())) this.clearBuilding(building);
    },
};
