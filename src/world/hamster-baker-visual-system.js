import populationEconomyConfig from '../../data/population-economy.json';
import {
    applyCivilianAnimSize,
    fadeOutAndDestroyCivilian,
    registerCivilianVisual,
    resolveCivilianVisualPosition,
} from './civilian-visual-utils.js';
import { CivilianVisualSettings } from './civilian-visual-runtime.js';

function isFoodProcessor(building) {
    return building?._economyType === 'bakery'
        || building?._economyType === 'desert_cookhouse'
        || building?._economyType === 'frost_smokehouse'
        || building?._economyType === 'chain_restaurant';
}

function bakerVisualConfig(building) {
    return populationEconomyConfig[building?._economyType]?.workerVisual
        || (isFoodProcessor(building) ? populationEconomyConfig.bakery?.workerVisual : null);
}

function animationKey(building, state) {
    const id = bakerVisualConfig(building)?.id;
    return id ? `worker_${id}_${state}` : '';
}

function phaseVisualState(phase) {
    if (phase === 'processing') return 'hidden';
    if (phase === 'to_deposit' || phase === 'waiting_deposit') return 'loaded_running';
    if (phase === 'to_pickup' || phase === 'to_bakery') return 'empty_running';
    return 'idle';
}

function showWorker(worker) {
    if (!worker?.sprite || !worker.hidden) return;
    worker.hidden = false;
    worker.sprite.setActive(true);
    worker.sprite.setVisible(true);
    worker.sprite.setAlpha(1);
    registerCivilianVisual(worker, 'baker');
}

function hideWorker(worker) {
    if (!worker?.sprite || worker.hidden) return;
    worker.hidden = true;
    worker.visualState = '';
    worker.sprite.stop();
    worker.sprite.setVisible(false);
    // 隐藏加工阶段也退出平民目标/深度集合；恢复显示时重新走统一注册入口。
    worker.sprite.setActive(false);
}

function syncAnimation(worker, state) {
    if (state === 'hidden') {
        hideWorker(worker);
        return;
    }
    showWorker(worker);
    if (worker.visualState === state) return;
    const key = animationKey(worker?.building, state);
    if (!key || !worker.sprite?.scene?.anims?.exists(key)) return;
    worker.visualState = state;
    worker.sprite.play(key, true);
    applyCivilianAnimSize(worker.sprite, bakerVisualConfig(worker?.building), state);
}

function createWorker(scene, building) {
    const config = bakerVisualConfig(building);
    const idleKey = animationKey(building, 'idle');
    if (!config || !idleKey || !scene?.textures?.exists(idleKey) || !scene?.add?.sprite) return null;
    const job = building?._bakeryJob;
    const point = resolveCivilianVisualPosition(
        Number.isFinite(Number(job?.x)) ? Number(job.x) : (Number(building?.x) || 0),
        Number.isFinite(Number(job?.y)) ? Number(job.y) : (Number(building?.y) || 0),
        { structures: [] }
    );
    if (job) {
        job.x = point.x;
        job.y = point.y;
    }
    const sprite = scene.add.sprite(point.x, point.y, idleKey, 0);
    const displaySize = Math.max(1, Number(config.displaySize) || 128);
    sprite.setOrigin(0.5, Number(config.originY) || 0.8);
    sprite.setDisplaySize(displaySize, displaySize);
    const worker = registerCivilianVisual({
        scene,
        building,
        sprite,
        x: point.x,
        y: point.y,
        civilianCollisionMode: 'walls_only',
        hidden: false,
        visualState: '',
    }, 'baker');
    syncAnimation(worker, phaseVisualState(job?.phase));
    return worker;
}

function destroyWorker(worker) {
    if (!worker) return;
    const sprite = worker.sprite;
    const wasActive = !!sprite?.active;
    fadeOutAndDestroyCivilian(worker);
    if (!wasActive && sprite) sprite.destroy();
}

/**
 * 面包师/外卖员只把粮食加工岗位记录投影成 Phaser Sprite；经济阶段、坐标、仓库
 * 扣取与存入仍由建筑经济系统单独持有，视觉对象不进入实体、物理或存档链。
 */
export const HamsterBakerVisualSystem = {
    _records: new Map(),

    updateBuilding(building) {
        if (!isFoodProcessor(building)) return;
        if (!CivilianVisualSettings.isEnabled()) {
            this.clearBuilding(building);
            return;
        }
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const config = bakerVisualConfig(building);
        const assigned = Math.max(0, Math.floor(Number(building._assignedWorkers) || 0));
        const cap = Math.max(0, Math.floor(Number(
            populationEconomyConfig[building._economyType]?.visualWorkerCap
        ) || 0));
        if (!building.active || !scene || !config || assigned <= 0 || cap <= 0) {
            this.clearBuilding(building);
            return;
        }

        let worker = this._records.get(building);
        if (worker && worker.scene !== scene) {
            this.clearBuilding(building);
            worker = null;
        }
        if (worker && !worker.sprite?.active) {
            this.clearBuilding(building);
            worker = null;
        }
        if (!worker) {
            worker = createWorker(scene, building);
            if (!worker) return;
            this._records.set(building, worker);
        }

        const job = building._bakeryJob;
        if (!job) return;
        syncAnimation(worker, phaseVisualState(job.phase));
        if (worker.hidden) return;
        const nextX = Number(job.x) || 0;
        const nextY = Number(job.y) || 0;
        if (Math.abs(nextX - worker.x) > 0.01) worker.sprite.setFlipX(nextX < worker.x);
        worker.x = nextX;
        worker.y = nextY;
        worker.sprite.setPosition(nextX, nextY);
    },

    clearBuilding(building) {
        const worker = this._records.get(building);
        if (!worker) return;
        destroyWorker(worker);
        this._records.delete(building);
    },

    reset() {
        for (const building of Array.from(this._records.keys())) this.clearBuilding(building);
    },
};
