import populationEconomyConfig from '../../data/population-economy.json';
import {
    applyCivilianAnimSize,
    fadeOutAndDestroyCivilian,
    getActiveCivilianVisuals,
    registerCivilianVisual,
    resolveCivilianVisualPosition,
    sweepCivilianVisualMove,
} from './civilian-visual-utils.js';
import { CivilianVisualSettings } from './civilian-visual-runtime.js';

function randomRange(range, fallbackMin, fallbackMax) {
    const min = Math.max(0, Number(range?.[0]) || fallbackMin);
    const max = Math.max(min, Number(range?.[1]) || fallbackMax);
    return min + Math.random() * (max - min);
}

function bankerVisualConfig() {
    return populationEconomyConfig.bank?.workerVisual || null;
}

function animationKey(state) {
    const id = bankerVisualConfig()?.id;
    return id ? `worker_${id}_${state}` : '';
}

function visualState(state) {
    if (state === 'speaking') return 'speeching';
    if (state === 'seeking' || state === 'wandering' || state === 'returning') return 'running';
    return 'idle';
}

function syncAnimation(worker, force = false) {
    const state = visualState(worker?.state);
    if (!force && worker?.visualState === state) return;
    worker.visualState = state;
    const key = animationKey(state);
    if (key && worker?.sprite?.active && worker.sprite.scene?.anims?.exists(key)) {
        worker.sprite.play(key, true);
        applyCivilianAnimSize(worker.sprite, bankerVisualConfig(), state);
    }
}

function setState(worker, state) {
    if (!worker || worker.state === state) return;
    worker.state = state;
    syncAnimation(worker);
}

function randomWanderPoint(building) {
    const radius = Math.max(0, Number(bankerVisualConfig()?.wanderRadius) || 260);
    const distance = Math.sqrt(Math.random()) * radius;
    const angle = Math.random() * Math.PI * 2;
    return resolveCivilianVisualPosition(
        building.x + Math.cos(angle) * distance,
        building.y + Math.sin(angle) * distance
    );
}

// 平滑移动：期望速度按帧率指数渐近（≈0.85/帧），起步/转向/停步不再瞬时；
// 60px 内期望速度随距离线性衰减（ease-out 到达）
function moveWorker(worker, target, speed, dt) {
    const dtMs = Math.max(0, Number(dt) || 0);
    const dx = target.x - worker.x;
    const dy = target.y - worker.y;
    const distance = Math.hypot(dx, dy);
    const desired = Math.max(0, speed) * Math.min(1, distance / 60);
    const wantX = distance > 0 ? dx / distance * desired : 0;
    const wantY = distance > 0 ? dy / distance * desired : 0;
    const k = 1 - Math.pow(0.85, dtMs / 16.67);
    worker.vx = (worker.vx || 0) + (wantX - (worker.vx || 0)) * k;
    worker.vy = (worker.vy || 0) + (wantY - (worker.vy || 0)) * k;
    const fromX = worker.x;
    const fromY = worker.y;
    const move = sweepCivilianVisualMove(
        worker,
        worker.x + worker.vx * dtMs / 1000,
        worker.y + worker.vy * dtMs / 1000
    );
    worker.x = move.x;
    worker.y = move.y;
    if (move.blocked && dtMs > 0) {
        worker.vx = (worker.x - fromX) * 1000 / dtMs;
        worker.vy = (worker.y - fromY) * 1000 / dtMs;
    }
    // 到位判定：距离足够近且速度已衰减，避免高速冲过判定点
    if (distance <= Math.max(2, speed * dtMs / 1000 * 2) && Math.hypot(worker.vx, worker.vy) < 10) {
        worker.x = target.x;
        worker.y = target.y;
        worker.vx = 0;
        worker.vy = 0;
        return true;
    }
    return false;
}

function syncSprite(worker) {
    if (!worker?.sprite?.active) return;
    worker.sprite.setPosition(worker.x, worker.y);
}

function speechDurationMs() {
    const def = bankerVisualConfig()?.animations?.speeching;
    const frameCount = Math.max(1, Number(def?.frameCount) || 1);
    const frameRate = Math.max(1, Number(def?.frameRate) || 12);
    return frameCount / frameRate * 1000;
}

function isValidTarget(worker) {
    return !!(worker?.sprite?.active && !worker._civilianFadeStarted && worker.civilianKind !== 'banker');
}

function targetPoint(worker, target) {
    const distanceRange = bankerVisualConfig()?.speechDistance || [50, 80];
    let dx = worker.x - target.sprite.x;
    let dy = worker.y - target.sprite.y;
    let length = Math.hypot(dx, dy);
    if (length <= 0.001) {
        const angle = Math.random() * Math.PI * 2;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        length = 1;
    }
    const point = resolveCivilianVisualPosition(
        target.sprite.x + dx / length * worker.speechDistance,
        target.sprite.y + dy / length * worker.speechDistance
    );
    return {
        x: point.x,
        y: point.y,
        min: Math.max(0, Number(distanceRange[0]) || 50),
        max: Math.max(0, Number(distanceRange[1]) || 80),
    };
}

/**
 * 银行岗位的纯视觉银行家：全图直线寻找非银行家平民交谈；无目标或冷却时在银行附近游荡。
 */
export const HamsterBankerVisualSystem = {
    _records: new Map(),
    _targetClaims: new Map(),

    _releaseTarget(worker) {
        if (worker?.target && this._targetClaims.get(worker.target) === worker) {
            this._targetClaims.delete(worker.target);
        }
        if (worker) worker.target = null;
    },

    _destroyWorker(worker) {
        this._releaseTarget(worker);
        fadeOutAndDestroyCivilian(worker);
    },

    _createWorker(scene, building, index, count) {
        const config = bankerVisualConfig();
        const idleKey = animationKey('idle');
        if (!config || !idleKey || !scene?.textures?.exists(idleKey) || !scene?.add?.sprite) return null;
        const centered = index - (count - 1) / 2;
        const home = resolveCivilianVisualPosition(
            building.x + centered * 28,
            building.y + 16 + Math.abs(centered) * 5
        );
        const x = home.x;
        const y = home.y;
        const sprite = scene.add.sprite(x, y, idleKey, 0);
        sprite.setOrigin(0.5, Number(config.originY) || 0.82);
        const displaySize = Math.max(1, Number(config.displaySize) || 128);
        sprite.setDisplaySize(displaySize, displaySize);
        const worker = registerCivilianVisual({
            building,
            index,
            x,
            y,
            sprite,
            state: 'idle',
            visualState: '',
            stateRemainMs: randomRange(config.idleDurationMs, 900, 2200),
            speechCooldownRemainMs: randomRange(config.speechCooldownMs, 8000, 14000),
            speechDistance: randomRange(config.speechDistance, 50, 80),
            destination: null,
            target: null,
        }, 'banker');
        syncAnimation(worker, true);
        syncSprite(worker);
        return worker;
    },

    _acquireTarget(worker) {
        const candidates = getActiveCivilianVisuals({ excludeKinds: ['banker'] })
            .filter((candidate) => candidate !== worker
                && isValidTarget(candidate)
                && candidate.sprite.scene === worker.sprite?.scene
                && !this._targetClaims.has(candidate));
        if (candidates.length <= 0) return false;
        const target = candidates[Math.floor(Math.random() * candidates.length)];
        worker.target = target;
        worker.speechDistance = randomRange(bankerVisualConfig()?.speechDistance, 50, 80);
        worker.destination = null;
        this._targetClaims.set(target, worker);
        setState(worker, 'seeking');
        return true;
    },

    _updateHomeBehavior(worker, dt) {
        const config = bankerVisualConfig();
        if (worker.state !== 'idle' && worker.state !== 'wandering' && worker.state !== 'returning') {
            worker.destination = null;
            setState(worker, 'returning');
        }
        if (worker.state === 'idle') {
            worker.stateRemainMs -= Math.max(0, Number(dt) || 0);
            if (worker.stateRemainMs <= 0) {
                worker.destination = randomWanderPoint(worker.building);
                setState(worker, 'wandering');
            }
            return;
        }
        if (!worker.destination) worker.destination = randomWanderPoint(worker.building);
        const dx = worker.destination.x - worker.x;
        if (worker.sprite?.active) worker.sprite.setFlipX(dx < 0);
        const speed = Math.max(1, Number(config?.moveSpeed) || 90);
        if (moveWorker(worker, worker.destination, speed, dt)) {
            worker.destination = null;
            worker.stateRemainMs = randomRange(config?.idleDurationMs, 900, 2200);
            setState(worker, 'idle');
        }
    },

    _updateWorker(worker, dt) {
        const elapsedMs = Math.max(0, Number(dt) || 0);
        worker.speechCooldownRemainMs = Math.max(0, worker.speechCooldownRemainMs - elapsedMs);

        if (worker.state === 'speaking') {
            if (!isValidTarget(worker.target)) {
                this._releaseTarget(worker);
                setState(worker, 'returning');
            } else {
                worker.sprite.setFlipX(worker.target.sprite.x < worker.x);
                worker.stateRemainMs -= elapsedMs;
                if (worker.stateRemainMs <= 0) {
                    this._releaseTarget(worker);
                    worker.speechCooldownRemainMs = randomRange(
                        bankerVisualConfig()?.speechCooldownMs, 8000, 14000
                    );
                    setState(worker, 'returning');
                }
            }
            syncSprite(worker);
            return;
        }

        if (worker.target && !isValidTarget(worker.target)) {
            this._releaseTarget(worker);
            setState(worker, 'returning');
        }
        if (!worker.target && worker.speechCooldownRemainMs <= 0) this._acquireTarget(worker);

        if (worker.target) {
            const point = targetPoint(worker, worker.target);
            const distance = Math.hypot(worker.target.sprite.x - worker.x, worker.target.sprite.y - worker.y);
            if (distance >= point.min && distance <= point.max) {
                worker.sprite.setFlipX(worker.target.sprite.x < worker.x);
                worker.stateRemainMs = speechDurationMs();
                setState(worker, 'speaking');
            } else {
                const dx = point.x - worker.x;
                worker.sprite.setFlipX(dx < 0);
                moveWorker(worker, point, Math.max(1, Number(bankerVisualConfig()?.moveSpeed) || 90), dt);
                setState(worker, 'seeking');
            }
        } else {
            this._updateHomeBehavior(worker, dt);
        }
        syncSprite(worker);
    },

    updateBuilding(building, dt) {
        if (building?._economyType !== 'bank') return;
        if (!CivilianVisualSettings.isEnabled()) {
            this.clearBuilding(building);
            return;
        }
        const config = bankerVisualConfig();
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const assigned = Math.max(0, Math.floor(Number(building._assignedWorkers) || 0));
        const cap = Math.max(0, Math.floor(Number(populationEconomyConfig.bank?.visualWorkerCap) || 0));
        const targetCount = Math.min(assigned, cap);
        if (!building.active || !config || !scene || targetCount <= 0) {
            this.clearBuilding(building);
            return;
        }

        let record = this._records.get(building);
        if (record && record.scene !== scene) {
            this.clearBuilding(building);
            record = null;
        }
        if (record?.workers?.some((worker) => !worker?.sprite?.active)) {
            this.clearBuilding(building);
            record = null;
        }
        if (!record) {
            record = { scene, workers: [] };
            this._records.set(building, record);
        }

        while (record.workers.length > targetCount) this._destroyWorker(record.workers.pop());
        while (record.workers.length < targetCount) {
            const worker = this._createWorker(scene, building, record.workers.length, targetCount);
            if (!worker) break;
            record.workers.push(worker);
        }
        record.workers.forEach((worker, index) => { worker.index = index; });
        for (const worker of record.workers) this._updateWorker(worker, dt);
    },

    clearBuilding(building) {
        const record = this._records.get(building);
        if (!record) return;
        for (const worker of record.workers) this._destroyWorker(worker);
        this._records.delete(building);
    },

    reset() {
        for (const building of Array.from(this._records.keys())) this.clearBuilding(building);
        this._targetClaims.clear();
    },
};
