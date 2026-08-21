import populationEconomyConfig from '../../data/population-economy.json';
import { SoundManager } from '../ui/sound-manager.js';

function randomRange(range, fallbackMin, fallbackMax) {
    const min = Math.max(0, Number(range?.[0]) || fallbackMin);
    const max = Math.max(min, Number(range?.[1]) || fallbackMax);
    return min + Math.random() * (max - min);
}

function farmerVisualConfig() {
    return populationEconomyConfig.windmill?.workerVisual || null;
}

function animationKey(state) {
    const config = farmerVisualConfig();
    return config?.id ? `worker_${config.id}_${state}` : '';
}

function fieldCells(building) {
    if (building?._buildingPerimeterKind !== 'field') return [];
    return Array.isArray(building._buildingRoadLayout?.roadCells)
        ? building._buildingRoadLayout.roadCells
        : [];
}

function randomItem(items) {
    return items.length > 0 ? items[Math.floor(Math.random() * items.length)] : null;
}

function randomFieldPoint(cell, config) {
    let u = Math.random() * 2 - 1;
    let v = Math.random() * 2 - 1;
    if (Math.abs(u) + Math.abs(v) > 1) {
        u = Math.sign(u) * (1 - Math.abs(v));
    }
    return {
        x: cell.x + u * Math.max(0, Number(config.fieldJitterX) || 0),
        y: cell.y + v * Math.max(0, Number(config.fieldJitterY) || 0),
    };
}

function nextFieldCell(cells, currentCell) {
    if (!currentCell) return randomItem(cells);
    const adjacent = cells.filter((cell) =>
        cell !== currentCell
        && Math.abs(cell.i - currentCell.i) + Math.abs(cell.j - currentCell.j) === 1
    );
    return randomItem(adjacent.length > 0 ? adjacent : cells) || currentCell;
}

function playStateSound(worker, state) {
    const sound = farmerVisualConfig()?.sounds?.[state];
    const path = typeof sound === 'string' ? sound : sound?.path;
    if (!path || !SoundManager) return;
    const volume = typeof sound === 'object' ? (Number(sound.volume) || 1) : 1;
    if (typeof SoundManager.playWorld === 'function') {
        SoundManager.playWorld(path, worker.sprite.x, worker.sprite.y, volume, 'sfx', {
            maxDist: Math.max(0, Number(sound?.maxDist) || 1400),
        });
    } else if (typeof SoundManager.playFile === 'function') {
        SoundManager.playFile(path, volume, 'sfx');
    }
}

function setState(worker, state) {
    const key = animationKey(state);
    if (key && worker.scene?.anims?.exists(key)) worker.sprite.play(key, true);
    worker.state = state;
    if (state === 'harvesting') playStateSound(worker, state);
    const config = farmerVisualConfig();
    if (state === 'idle') {
        worker.stateRemainMs = randomRange(config?.idleDurationMs, 600, 1600);
    } else if (state === 'harvesting') {
        worker.stateRemainMs = randomRange(config?.harvestDurationMs, 1800, 3800);
    } else {
        worker.stateRemainMs = 0;
    }
}

function updateDepth(worker) {
    worker.sprite.setDepth(worker.sprite.y + 0.25);
}

function createWorker(scene, building, cells) {
    const config = farmerVisualConfig();
    if (!config) return null;
    const idleKey = animationKey('idle');
    if (!idleKey || !scene?.textures?.exists(idleKey) || !scene?.add?.sprite) return null;
    const startCell = randomItem(cells);
    if (!startCell) return null;
    const point = randomFieldPoint(startCell, config);
    const sprite = scene.add.sprite(point.x, point.y, idleKey, 0);
    const displaySize = Math.max(1, Number(config.displaySize) || 128);
    sprite.setOrigin(0.5, Number(config.originY) || 0.8);
    sprite.setDisplaySize(displaySize, displaySize);
    const worker = {
        scene,
        building,
        sprite,
        state: '',
        stateRemainMs: 0,
        currentCell: startCell,
        targetCell: null,
        targetX: point.x,
        targetY: point.y,
    };
    setState(worker, 'idle');
    updateDepth(worker);
    return worker;
}

function destroyWorker(worker) {
    if (worker?.sprite?.active) worker.sprite.destroy();
}

function updateWorker(worker, cells, dt) {
    const config = farmerVisualConfig();
    if (!config || !worker?.sprite?.active) return;
    const elapsedMs = Math.max(0, Number(dt) || 0);
    if (worker.state === 'idle') {
        worker.stateRemainMs -= elapsedMs;
        if (worker.stateRemainMs <= 0) {
            worker.targetCell = nextFieldCell(cells, worker.currentCell);
            const target = randomFieldPoint(worker.targetCell, config);
            worker.targetX = target.x;
            worker.targetY = target.y;
            setState(worker, 'running');
        }
    } else if (worker.state === 'running') {
        const dx = worker.targetX - worker.sprite.x;
        const dy = worker.targetY - worker.sprite.y;
        const distance = Math.hypot(dx, dy);
        const step = Math.max(0, Number(config.moveSpeed) || 0) * elapsedMs / 1000;
        worker.sprite.setFlipX(dx < 0);
        if (distance <= Math.max(2, step)) {
            worker.sprite.setPosition(worker.targetX, worker.targetY);
            worker.currentCell = worker.targetCell;
            worker.targetCell = null;
            setState(worker, 'harvesting');
        } else if (distance > 0 && step > 0) {
            worker.sprite.setPosition(
                worker.sprite.x + dx / distance * step,
                worker.sprite.y + dy / distance * step
            );
        }
    } else {
        worker.stateRemainMs -= elapsedMs;
        if (worker.stateRemainMs <= 0) setState(worker, 'idle');
    }
    updateDepth(worker);
}

/**
 * 风车岗位的纯视觉农民。记录中只保存 Phaser Sprite 与动画状态，不创建游戏实体、
 * 物理体、碰撞体或寻路请求，经济结算仍只读取 ProducerBuilding._assignedWorkers。
 */
export const HamsterFarmerVisualSystem = {
    _records: new Map(),

    updateBuilding(building, dt) {
        if (building?._economyType !== 'windmill') return;
        const config = farmerVisualConfig();
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const cells = fieldCells(building);
        const assigned = Math.max(0, Math.floor(Number(building._assignedWorkers) || 0));
        const cap = Math.max(0, Math.floor(Number(populationEconomyConfig.windmill?.visualWorkerCap) || 0));
        const targetCount = Math.min(assigned, cap);
        if (!building.active || !config || !scene || cells.length === 0 || targetCount <= 0) {
            this.clearBuilding(building);
            return;
        }

        let record = this._records.get(building);
        if (record && record.scene !== scene) {
            this.clearBuilding(building);
            record = null;
        }
        if (!record) {
            record = { scene, workers: [] };
            this._records.set(building, record);
        }

        while (record.workers.length > targetCount) destroyWorker(record.workers.pop());
        while (record.workers.length < targetCount) {
            const worker = createWorker(scene, building, cells);
            if (!worker) break;
            record.workers.push(worker);
        }
        for (const worker of record.workers) updateWorker(worker, cells, dt);
    },

    clearBuilding(building) {
        const record = this._records.get(building);
        if (!record) return;
        for (const worker of record.workers) destroyWorker(worker);
        this._records.delete(building);
    },

    reset() {
        for (const building of Array.from(this._records.keys())) this.clearBuilding(building);
    },
};
