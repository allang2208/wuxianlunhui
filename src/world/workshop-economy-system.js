import populationEconomyConfig from '../../data/population-economy.json';
import { Game } from '../game.js';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { getBuildingModuleUpgradeCost } from './building-upgrade-projects.js';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import {
    applyCivilianAnimSize,
    fadeOutAndDestroyCivilian,
    registerCivilianVisual,
    resolveCivilianVisualPosition,
    sweepCivilianVisualMove,
} from './civilian-visual-utils.js';
import { CivilianVisualSettings } from './civilian-visual-runtime.js';
import { WORLD_RENDER_LAYERS } from './world-render-layers.js';

const HOSTILE_FACTIONS = new Set(['enemy', 'agent']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function randomRange(range, fallbackMin, fallbackMax) {
    const min = Math.max(0, Number(range?.[0]) || fallbackMin);
    const max = Math.max(min, Number(range?.[1]) || fallbackMax);
    return min + Math.random() * (max - min);
}

function engineerVisualConfig() {
    return populationEconomyConfig.workshop?.engineerVisual || {};
}

function engineerAnimationKey(state) {
    const id = engineerVisualConfig().id;
    return id ? `worker_${id}_${state}` : '';
}

function workerVisualState(state) {
    if (state === 'repairing') return 'fixing';
    if (state === 'moving' || state === 'returning' || state === 'wandering') return 'running';
    return 'idle';
}

function syncWorkerAnimation(worker, force = false) {
    const visualState = workerVisualState(worker?.state);
    if (!force && worker?.visualState === visualState) return;
    worker.visualState = visualState;
    const key = engineerAnimationKey(visualState);
    if (key && worker?.sprite?.active && worker.sprite.scene?.anims?.exists(key)) {
        worker.sprite.play(key, true);
        applyCivilianAnimSize(worker.sprite, engineerVisualConfig(), visualState);
    }
}

function setWorkerState(worker, state) {
    if (!worker || worker.state === state) return;
    worker.state = state;
    syncWorkerAnimation(worker);
}

function moduleValue(building, moduleId) {
    const module = building?._cfg?.modules?.[moduleId];
    if (!module) return 0;
    const level = Math.max(0, Math.floor(Number(building.modules?.[moduleId]) || 0));
    return (Number(module.base) || 0) + (Number(module.per) || 0) * level;
}

function isWithin(source, target, range) {
    const dx = (Number(target?.x) || 0) - (Number(source?.x) || 0);
    const dy = (Number(target?.y) || 0) - (Number(source?.y) || 0);
    return dx * dx + dy * dy <= range * range;
}

function isRepairableBuilding(entity) {
    return !!(entity?.active
        && entity._isDefenseStructure
        && !entity._sinking
        && Number(entity.maxHp) > 0
        && Number(entity.hp) > 0
        && Number(entity.hp) < Number(entity.maxHp));
}

function engineerHome(building, index, count) {
    const centered = index - (count - 1) / 2;
    return { x: building.x + centered * 26, y: building.y + 12 + Math.abs(centered) * 5 };
}

function randomWanderPoint(building) {
    const radius = Math.max(0, Number(engineerVisualConfig().wanderRadius) || 300);
    const distance = Math.sqrt(Math.random()) * radius;
    const angle = Math.random() * Math.PI * 2;
    return resolveCivilianVisualPosition(
        building.x + Math.cos(angle) * distance,
        building.y + Math.sin(angle) * distance
    );
}

function repairPoint(target, index) {
    const radius = Math.max(28, Number(target?.collisionRadius) || 48);
    const angle = (index % 5) * Math.PI * 2 / 5;
    return resolveCivilianVisualPosition(
        target.x + Math.cos(angle) * radius * 0.72,
        target.y + Math.sin(angle) * radius * 0.42
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

function syncWorkerSprite(worker) {
    const sprite = worker?.sprite;
    if (!sprite?.active) return;
    sprite.setPosition(worker.x, worker.y);
}

/**
 * 经济工坊运行时：工程师是纯 Phaser 视觉记录，不进入 Game.entities、物理或寻路系统。
 * 维修采用点到点直线调度；只有抵达目标后才按目标最大生命百分比恢复。
 */
export const WorkshopEconomySystem = {
    _workshops: new Set(),
    _records: new Map(),
    _targetClaims: new Map(),
    _rangeGraphics: null,
    _rangeBuilding: null,

    initializeBuilding(building, saved = {}) {
        if (building?._economyType !== 'workshop') return;
        building.modules = { ...(saved.workshopModules || saved.modules || {}) };
        for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
            building.modules[moduleId] = clamp(
                Math.floor(Number(building.modules[moduleId]) || 0),
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._workshopUpgrade = saved.workshopUpgrade ? {
            moduleId: saved.workshopUpgrade.moduleId,
            totalMs: Math.max(1, Number(saved.workshopUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(saved.workshopUpgrade.remainMs) || 0),
        } : null;
        this._workshops.add(building);
    },

    reset() {
        for (const workshop of Array.from(this._records.keys())) this.clearBuilding(workshop);
        this._workshops.clear();
        this._targetClaims.clear();
        this.hideRange();
    },

    unregisterBuilding(building) {
        this._workshops.delete(building);
        this.clearBuilding(building);
        if (this._rangeBuilding === building) this.hideRange();
    },

    getModuleLevel(building, moduleId) {
        return Math.max(0, Math.floor(Number(building?.modules?.[moduleId]) || 0));
    },

    getUpgradeCost(building, moduleId) {
        return getBuildingModuleUpgradeCost(
            building?._cfg,
            moduleId,
            this.getModuleLevel(building, moduleId)
        );
    },

    startUpgrade(building, moduleId) {
        if (building?._economyType !== 'workshop') return { ok: false, reason: '该建筑不是经济工坊' };
        const module = building._cfg.modules?.[moduleId];
        if (!module) return { ok: false, reason: '未知升级项目' };
        const level = this.getModuleLevel(building, moduleId);
        if (level >= (module.maxLevel || 0)) return { ok: false, reason: '升级项目已满级' };
        if (building._workshopUpgrade) return { ok: false, reason: '已有工坊项目正在升级' };
        const cost = this.getUpgradeCost(building, moduleId);
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        building._workshopUpgrade = {
            moduleId,
            totalMs: Math.max(1, Number(cost.timeMs) || 1),
            remainMs: Math.max(1, Number(cost.timeMs) || 1),
        };
        return { ok: true, cost, moduleId };
    },

    getRange(building) {
        return Math.max(0, moduleValue(building, 'workshop_range'));
    },

    getConfiguredEfficiency(building) {
        return Math.max(0, moduleValue(building, 'workshop_efficiency'));
    },

    getRepairRate(building) {
        return Math.max(0, moduleValue(building, 'workshop_repair'));
    },

    getEngineerCount(building) {
        return Math.max(0, Math.floor(moduleValue(building, 'workshop_engineers')));
    },

    getStaffedEngineerCount(building) {
        return Math.min(
            this.getEngineerCount(building),
            Math.max(0, Math.floor(Number(building?._assignedWorkers) || 0))
        );
    },

    getActualEfficiency(building) {
        const cfg = populationEconomyConfig.workshop || {};
        const engineers = this.getStaffedEngineerCount(building);
        const share = Math.max(0, Number(cfg.engineerEfficiencyShare) || 0.2);
        return this.getConfiguredEfficiency(building) * clamp(engineers * share, 0, 1);
    },

    getEfficiencyMultiplier(target) {
        if (!target?.active || !target._economyType
            || target._economyType === 'housing' || target._economyType === 'workshop') return 1;
        let strongest = 0;
        for (const workshop of this._workshops) {
            if (!workshop?.active || workshop.hp <= 0) continue;
            if (!isWithin(workshop, target, this.getRange(workshop))) continue;
            strongest = Math.max(strongest, this.getActualEfficiency(workshop));
        }
        return 1 + strongest;
    },

    getSnapshot(building) {
        const record = this._records.get(building);
        const engineerCount = this.getEngineerCount(building);
        const staffedEngineerCount = this.getStaffedEngineerCount(building);
        return {
            range: this.getRange(building),
            configuredEfficiency: this.getConfiguredEfficiency(building),
            actualEfficiency: this.getActualEfficiency(building),
            repairRate: this.getRepairRate(building),
            engineerCount,
            staffedEngineerCount,
            repairingCount: record?.engineers?.filter((worker) => worker.state === 'repairing').length || 0,
            assignedCount: record?.engineers?.filter((worker) => !!worker.target).length || 0,
            enemyBlocked: !!record?.enemyBlocked,
        };
    },

    _updateUpgrade(building, dt) {
        const upgrade = building._workshopUpgrade;
        if (!upgrade) return;
        upgrade.remainMs -= Math.max(0, Number(dt) || 0);
        if (upgrade.remainMs > 0) return;
        const module = building._cfg.modules?.[upgrade.moduleId];
        if (module) {
            building.modules[upgrade.moduleId] = clamp(
                this.getModuleLevel(building, upgrade.moduleId) + 1,
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._workshopUpgrade = null;
        if (this._rangeBuilding === building) this._drawRange(building);
    },

    _ensureRecord(building) {
        let record = this._records.get(building);
        if (!record) {
            record = { engineers: [], scanRemainMs: 0, enemyBlocked: false };
            this._records.set(building, record);
        }
        const count = this.getStaffedEngineerCount(building);
        while (record.engineers.length > count) {
            const worker = record.engineers.pop();
            this._releaseWorker(worker);
            fadeOutAndDestroyCivilian(worker);
        }
        while (record.engineers.length < count) {
            const index = record.engineers.length;
            const home = engineerHome(building, index, count);
            record.engineers.push({
                building,
                index,
                x: home.x,
                y: home.y,
                state: 'idle',
                visualState: '',
                stateRemainMs: randomRange(engineerVisualConfig().idleDurationMs, 900, 2200),
                destination: null,
                target: null,
                sprite: null,
            });
        }
        record.engineers.forEach((worker, index) => { worker.index = index; });
        this._ensureSprites(building, record);
        return record;
    },

    _ensureSprites(building, record) {
        if (!CivilianVisualSettings.isEnabled()) return;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const visual = engineerVisualConfig();
        const texture = engineerAnimationKey('idle');
        if (!texture || !scene?.add?.sprite || !scene.textures?.exists(texture)) return;
        for (const worker of record.engineers) {
            if (worker.sprite?.active && worker.sprite.scene === scene) continue;
            if (worker.sprite?.active) fadeOutAndDestroyCivilian(worker);
            const home = resolveCivilianVisualPosition(worker.x, worker.y);
            worker.x = home.x;
            worker.y = home.y;
            worker.sprite = scene.add.sprite(worker.x, worker.y, texture, 0);
            worker.sprite.setOrigin(0.5, Number(visual.originY) || 0.82);
            const displaySize = Math.max(1, Number(visual.displaySize) || 128);
            worker.sprite.setDisplaySize(displaySize, displaySize);
            registerCivilianVisual(worker, 'engineer');
            syncWorkerAnimation(worker, true);
            syncWorkerSprite(worker);
        }
    },

    _releaseWorker(worker) {
        if (worker?.target && this._targetClaims.get(worker.target) === worker) {
            this._targetClaims.delete(worker.target);
        }
        if (worker) {
            worker.target = null;
            worker.destination = null;
            setWorkerState(worker, 'returning');
        }
    },

    _scan(building, record) {
        const entities = Game?.entities;
        if (!entities?.values) return;
        const range = this.getRange(building);
        record.enemyBlocked = false;
        if (populationEconomyConfig.workshop?.repairRequiresNoEnemies !== false) {
            for (const entity of entities.values()) {
                if (!entity?.active || !HOSTILE_FACTIONS.has(entity._faction)) continue;
                if (isWithin(building, entity, range)) {
                    record.enemyBlocked = true;
                    break;
                }
            }
        }
        if (record.enemyBlocked) {
            record.engineers.forEach((worker) => this._releaseWorker(worker));
            return;
        }

        for (const worker of record.engineers) {
            if (!worker.target) continue;
            if (!isRepairableBuilding(worker.target) || !isWithin(building, worker.target, range)) {
                this._releaseWorker(worker);
            }
        }
        const candidates = Array.from(entities.values())
            .filter((entity) => isRepairableBuilding(entity)
                && isWithin(building, entity, range)
                && !this._targetClaims.has(entity))
            .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp)
                || Math.hypot(a.x - building.x, a.y - building.y)
                    - Math.hypot(b.x - building.x, b.y - building.y));
        for (const worker of record.engineers) {
            if (worker.target) continue;
            const target = candidates.shift();
            if (!target) break;
            worker.target = target;
            worker.destination = null;
            setWorkerState(worker, 'moving');
            this._targetClaims.set(target, worker);
        }
    },

    _updateIdleEngineer(building, worker, dt) {
        const visual = engineerVisualConfig();
        const idleRange = visual.idleDurationMs;
        if (worker.state !== 'idle' && worker.state !== 'wandering' && worker.state !== 'returning') {
            worker.destination = null;
            setWorkerState(worker, 'returning');
        }
        if (worker.state === 'idle') {
            worker.stateRemainMs -= Math.max(0, Number(dt) || 0);
            if (worker.stateRemainMs <= 0) {
                worker.destination = randomWanderPoint(building);
                setWorkerState(worker, 'wandering');
            }
            return;
        }
        if (!worker.destination) worker.destination = randomWanderPoint(building);
        const speed = worker.state === 'returning'
            ? Math.max(1, Number(populationEconomyConfig.workshop?.engineerSpeed) || 180)
            : Math.max(1, Number(visual.wanderSpeed) || 70);
        const dx = worker.destination.x - worker.x;
        if (worker.sprite?.active) worker.sprite.setFlipX(dx < 0);
        if (moveWorker(worker, worker.destination, speed, dt)) {
            worker.destination = null;
            worker.stateRemainMs = randomRange(idleRange, 900, 2200);
            setWorkerState(worker, 'idle');
        }
    },

    _updateEngineer(building, record, worker, dt) {
        const speed = Math.max(1, Number(populationEconomyConfig.workshop?.engineerSpeed) || 180);
        if (!worker.target) {
            this._updateIdleEngineer(building, worker, dt);
            syncWorkerSprite(worker);
            return;
        }
        const target = worker.target;
        if (record.enemyBlocked || !isRepairableBuilding(target)
            || !isWithin(building, target, this.getRange(building))) {
            this._releaseWorker(worker);
            syncWorkerSprite(worker);
            return;
        }
        const point = repairPoint(target, worker.index);
        if (worker.state !== 'repairing') {
            const dx = point.x - worker.x;
            if (worker.sprite?.active) worker.sprite.setFlipX(dx < 0);
            const arrived = moveWorker(worker, point, speed, dt);
            setWorkerState(worker, arrived ? 'repairing' : 'moving');
        }
        if (worker.state === 'repairing') {
            const restored = Number(target.maxHp) * this.getRepairRate(building) * Math.max(0, dt) / 1000;
            target.hp = Math.min(Number(target.maxHp), Number(target.hp) + restored);
            if (target.hp >= target.maxHp) this._releaseWorker(worker);
        }
        syncWorkerSprite(worker);
    },

    updateBuilding(building, dt) {
        if (building?._economyType !== 'workshop' || !building.active) return;
        this._updateUpgrade(building, dt);
        const record = this._ensureRecord(building);
        record.scanRemainMs -= Math.max(0, Number(dt) || 0);
        if (record.scanRemainMs <= 0) {
            this._scan(building, record);
            record.scanRemainMs = Math.max(50, Number(populationEconomyConfig.workshop?.scanIntervalMs) || 250);
        }
        for (const worker of record.engineers) this._updateEngineer(building, record, worker, dt);
        if (this._rangeBuilding === building) this._drawRange(building);
    },

    clearBuilding(building) {
        const record = this._records.get(building);
        if (!record) return;
        for (const worker of record.engineers) {
            this._releaseWorker(worker);
            fadeOutAndDestroyCivilian(worker);
        }
        this._records.delete(building);
    },

    showRange(building) {
        if (building?._economyType !== 'workshop') return;
        this._rangeBuilding = building;
        this._drawRange(building);
    },

    hideRange() {
        if (this._rangeGraphics?.active) this._rangeGraphics.destroy();
        this._rangeGraphics = null;
        this._rangeBuilding = null;
    },

    _drawRange(building) {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene?.add?.graphics || !building?.active) return;
        if (!this._rangeGraphics?.active || this._rangeGraphics.scene !== scene) {
            if (this._rangeGraphics?.active) this._rangeGraphics.destroy();
            this._rangeGraphics = scene.add.graphics();
            if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._rangeGraphics);
        }
        const range = this.getRange(building);
        const blocked = this.getSnapshot(building).enemyBlocked;
        const color = blocked ? 0xc85b54 : 0x77c8d9;
        const graphics = this._rangeGraphics;
        graphics.clear();
        graphics.setPosition(building.x, building.y);
        graphics.setDepth(WORLD_RENDER_LAYERS.GROUND_RANGE);
        graphics.fillStyle(color, 0.09);
        graphics.lineStyle(3, color, 0.78);
        graphics.fillEllipse(0, 0, range * 2, range * 2 * PERSPECTIVE_SCALE_Y);
        graphics.strokeEllipse(0, 0, range * 2, range * 2 * PERSPECTIVE_SCALE_Y);
    },
};
