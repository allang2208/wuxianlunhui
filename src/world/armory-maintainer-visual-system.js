import populationEconomyConfig from '../../data/population-economy.json';
import { Game } from '../game.js';
import { ArmoryEconomySystem } from './armory-economy-system.js';
import {
    applyCivilianAnimSize,
    fadeOutAndDestroyCivilian,
    registerCivilianVisual,
    resolveCivilianVisualPosition,
    sweepCivilianVisualMove,
} from './civilian-visual-utils.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function visualConfig() {
    return populationEconomyConfig.armory?.workerVisual || {};
}

function randomRange(range, fallbackMin, fallbackMax) {
    const min = Math.max(0, Number(range?.[0]) || fallbackMin);
    const max = Math.max(min, Number(range?.[1]) || fallbackMax);
    return min + Math.random() * (max - min);
}

function animationKey(state) {
    const id = visualConfig().id;
    return id ? `worker_${id}_${state}` : '';
}

function visualState(worker) {
    if (worker?.state === 'maintaining') return 'maintenance';
    if (worker?.state === 'walking' || worker?.state === 'to_target') return 'walking';
    return 'idle';
}

function syncAnimation(worker, force = false) {
    const state = visualState(worker);
    if (!force && worker?.visualState === state) return;
    worker.visualState = state;
    const key = animationKey(state);
    if (key && worker?.sprite?.active && worker.sprite.scene?.anims?.exists(key)) {
        worker.sprite.play(key, true);
        applyCivilianAnimSize(worker.sprite, visualConfig(), state);
    }
}

function setState(worker, state) {
    if (!worker || worker.state === state) return;
    worker.state = state;
    syncAnimation(worker);
}

function isWithin(source, target, range) {
    const dx = (Number(target?.x) || 0) - (Number(source?.x) || 0);
    const dy = (Number(target?.y) || 0) - (Number(source?.y) || 0);
    return dx * dx + dy * dy <= range * range;
}

function isMaintenanceTarget(armory, entity) {
    return !!(entity
        && entity !== armory
        && entity.active
        && entity._isDefenseStructure
        && !entity._sinking
        && Number(entity.hp) > 0
        && isWithin(armory, entity, ArmoryEconomySystem.getRange(armory)));
}

function homePoint(building, index, count) {
    const centered = index - (count - 1) / 2;
    return resolveCivilianVisualPosition(
        building.x + centered * 25,
        building.y + 14 + Math.abs(centered) * 5
    );
}

function randomActivityPoint(building) {
    const range = Math.max(0, ArmoryEconomySystem.getRange(building));
    const inset = clamp(Number(visualConfig().wanderRangeFactor) || 0.82, 0.1, 0.95);
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const distance = Math.sqrt(Math.random()) * range * inset;
        const angle = Math.random() * Math.PI * 2;
        const point = resolveCivilianVisualPosition(
            building.x + Math.cos(angle) * distance,
            building.y + Math.sin(angle) * distance
        );
        if (isWithin(building, point, range)) return point;
    }
    return resolveCivilianVisualPosition(building.x, building.y + 18);
}

function maintenancePoint(building, target, worker) {
    const range = Math.max(0, ArmoryEconomySystem.getRange(building));
    const baseAngle = Math.atan2(building.y - target.y, building.x - target.x);
    const side = ((worker.index % 3) - 1) * 0.34;
    const angle = baseAngle + side;
    const radius = Math.max(
        Number(visualConfig().maintenanceDistance) || 34,
        (Number(target?.collisionRadius) || 32) * 0.72
    );
    const point = resolveCivilianVisualPosition(
        target.x + Math.cos(angle) * radius,
        target.y + Math.sin(angle) * radius
    );
    return isWithin(building, point, range) ? point : null;
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

function beginTimedMove(worker, target, speed) {
    const distance = Math.hypot(target.x - worker.x, target.y - worker.y);
    const duration = distance / Math.max(1, speed) * 1000;
    const grace = Math.max(0, Number(visualConfig().moveGraceMs) || 5000);
    worker.destination = { x: target.x, y: target.y };
    worker.moveRemainMs = duration + grace;
}

function finishMove(worker) {
    worker.destination = null;
    worker.moveRemainMs = 0;
    worker.vx = 0;
    worker.vy = 0;
}

function syncSprite(worker) {
    if (worker?.sprite?.active) worker.sprite.setPosition(worker.x, worker.y);
}

/**
 * 军械库维护师是纯视觉岗位平民：巡检范围内建筑并播放维护动作，不改变建筑生命或业务数值。
 */
export const ArmoryMaintainerVisualSystem = {
    _records: new Map(),
    _targetClaims: new Map(),

    reset() {
        for (const building of Array.from(this._records.keys())) this.clearBuilding(building);
        this._targetClaims.clear();
    },

    clearBuilding(building) {
        const record = this._records.get(building);
        if (!record) return;
        for (const worker of record.workers) {
            this._releaseTarget(worker, false);
            fadeOutAndDestroyCivilian(worker);
        }
        this._records.delete(building);
    },

    _ensureRecord(building) {
        let record = this._records.get(building);
        if (!record) {
            record = { workers: [], scanRemainMs: 0 };
            this._records.set(building, record);
        }
        const cap = Math.max(0, Math.floor(Number(visualConfig().visualWorkerCap) || 5));
        const count = Math.min(cap, ArmoryEconomySystem.getStaffedCount(building));
        while (record.workers.length > count) {
            const worker = record.workers.pop();
            this._releaseTarget(worker, false);
            fadeOutAndDestroyCivilian(worker);
        }
        while (record.workers.length < count) {
            const index = record.workers.length;
            const home = homePoint(building, index, count);
            record.workers.push({
                building,
                index,
                x: home.x,
                y: home.y,
                vx: 0,
                vy: 0,
                state: 'idle',
                visualState: '',
                stateRemainMs: randomRange(visualConfig().idleDurationMs, 900, 2200),
                jobCooldownMs: randomRange(visualConfig().jobCooldownMs, 800, 2200),
                moveRemainMs: 0,
                destination: null,
                target: null,
                lastTarget: null,
                sprite: null,
            });
        }
        record.workers.forEach((worker, index) => { worker.index = index; });
        this._ensureSprites(record);
        return record;
    },

    _ensureSprites(record) {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const visual = visualConfig();
        const texture = animationKey('idle');
        if (!texture || !scene?.add?.sprite || !scene.textures?.exists(texture)) return;
        for (const worker of record.workers) {
            if (worker.sprite?.active && worker.sprite.scene === scene) continue;
            if (worker.sprite?.active) fadeOutAndDestroyCivilian(worker);
            const point = resolveCivilianVisualPosition(worker.x, worker.y);
            worker.x = point.x;
            worker.y = point.y;
            worker.sprite = scene.add.sprite(worker.x, worker.y, texture, 0);
            worker.sprite.setOrigin(0.5, Number(visual.originY) || 0.935547);
            const displaySize = Math.max(1, Number(visual.displaySize) || 128);
            worker.sprite.setDisplaySize(displaySize, displaySize);
            registerCivilianVisual(worker, 'armory_maintainer');
            syncAnimation(worker, true);
            syncSprite(worker);
        }
    },

    _releaseTarget(worker, applyCooldown = true) {
        if (worker?.target && this._targetClaims.get(worker.target) === worker) {
            this._targetClaims.delete(worker.target);
        }
        if (!worker) return;
        worker.lastTarget = worker.target || worker.lastTarget;
        worker.target = null;
        finishMove(worker);
        if (applyCooldown) {
            worker.jobCooldownMs = randomRange(visualConfig().jobCooldownMs, 800, 2200);
            worker.stateRemainMs = randomRange(visualConfig().idleDurationMs, 900, 2200);
        }
        setState(worker, 'idle');
    },

    _scan(building, record) {
        const entities = Game?.entities;
        if (!entities?.values) return;
        const candidates = Array.from(entities.values()).filter((entity) => (
            isMaintenanceTarget(building, entity)
            && !this._targetClaims.has(entity)
            && maintenancePoint(building, entity, { index: 0 })
        ));
        for (const worker of record.workers) {
            if (worker.target || worker.jobCooldownMs > 0 || candidates.length === 0) continue;
            const available = candidates.filter((target) => target !== worker.lastTarget);
            const pool = available.length ? available : candidates;
            pool.sort((a, b) => Math.hypot(a.x - worker.x, a.y - worker.y)
                - Math.hypot(b.x - worker.x, b.y - worker.y));
            const pickIndex = Math.floor(Math.random() * Math.min(4, pool.length));
            const target = pool[pickIndex];
            const candidateIndex = candidates.indexOf(target);
            if (candidateIndex >= 0) candidates.splice(candidateIndex, 1);
            const point = maintenancePoint(building, target, worker);
            if (!point) continue;
            worker.target = target;
            beginTimedMove(
                worker,
                point,
                Math.max(1, Number(visualConfig().moveSpeed) || 90)
            );
            this._targetClaims.set(target, worker);
            setState(worker, 'to_target');
        }
    },

    _updateFreeWorker(building, worker, dt) {
        const elapsed = Math.max(0, Number(dt) || 0);
        worker.jobCooldownMs = Math.max(0, worker.jobCooldownMs - elapsed);
        if (worker.state !== 'idle' && worker.state !== 'walking') {
            finishMove(worker);
            setState(worker, 'idle');
        }
        if (worker.state === 'idle') {
            worker.stateRemainMs -= elapsed;
            if (worker.stateRemainMs <= 0) {
                const destination = randomActivityPoint(building);
                beginTimedMove(
                    worker,
                    destination,
                    Math.max(1, Number(visualConfig().wanderSpeed) || 70)
                );
                setState(worker, 'walking');
            }
            return;
        }
        const speed = Math.max(1, Number(visualConfig().wanderSpeed) || 70);
        if (!worker.destination) beginTimedMove(worker, randomActivityPoint(building), speed);
        const dx = worker.destination.x - worker.x;
        if (worker.sprite?.active) worker.sprite.setFlipX(dx < 0);
        const arrived = moveWorker(worker, worker.destination, speed, elapsed);
        worker.moveRemainMs = Math.max(0, (Number(worker.moveRemainMs) || 0) - elapsed);
        if (arrived || worker.moveRemainMs <= 0) {
            finishMove(worker);
            worker.stateRemainMs = randomRange(visualConfig().idleDurationMs, 900, 2200);
            setState(worker, 'idle');
        }
    },

    _updateWorker(building, worker, dt) {
        const elapsed = Math.max(0, Number(dt) || 0);
        if (!isWithin(building, worker, ArmoryEconomySystem.getRange(building))) {
            this._releaseTarget(worker, false);
            const destination = homePoint(
                building,
                worker.index,
                Math.max(1, ArmoryEconomySystem.getStaffedCount(building))
            );
            beginTimedMove(
                worker,
                destination,
                Math.max(1, Number(visualConfig().wanderSpeed) || 70)
            );
            setState(worker, 'walking');
        }
        if (!worker.target) {
            this._updateFreeWorker(building, worker, elapsed);
            syncSprite(worker);
            return;
        }
        const target = worker.target;
        const point = isMaintenanceTarget(building, target)
            ? maintenancePoint(building, target, worker)
            : null;
        if (!point) {
            this._releaseTarget(worker);
            syncSprite(worker);
            return;
        }
        if (worker.state !== 'maintaining') {
            const speed = Math.max(1, Number(visualConfig().moveSpeed) || 90);
            if (!worker.destination) beginTimedMove(worker, point, speed);
            const dx = worker.destination.x - worker.x;
            if (worker.sprite?.active) worker.sprite.setFlipX(dx < 0);
            const arrived = moveWorker(worker, worker.destination, speed, elapsed);
            worker.moveRemainMs = Math.max(0, (Number(worker.moveRemainMs) || 0) - elapsed);
            // 维护师与面包师一样不具备寻路；超过直线路程与宽限后从当前位置完成本次交互，
            // 避免墙角或密集 footprint 让目标认领永久卡死。
            if (arrived || worker.moveRemainMs <= 0) {
                finishMove(worker);
                worker.stateRemainMs = randomRange(
                    visualConfig().maintenanceDurationMs,
                    1800,
                    3600
                );
                setState(worker, 'maintaining');
            } else {
                setState(worker, 'to_target');
            }
        } else {
            worker.stateRemainMs -= elapsed;
            if (worker.stateRemainMs <= 0) this._releaseTarget(worker);
        }
        syncSprite(worker);
    },

    updateBuilding(building, dt) {
        if (building?._economyType !== 'armory' || !building.active) return;
        const record = this._ensureRecord(building);
        record.scanRemainMs -= Math.max(0, Number(dt) || 0);
        if (record.scanRemainMs <= 0) {
            this._scan(building, record);
            record.scanRemainMs = Math.max(100, Number(visualConfig().scanIntervalMs) || 500);
        }
        for (const worker of record.workers) this._updateWorker(building, worker, dt);
    },
};
