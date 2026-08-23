import performanceConfig from '../../data/performance-config.json';
import { PATH_DEFERRED } from './pathfinder.js';

const queueConfig = performanceConfig.pathQueue || {};
const MAX_RECALCS = Math.max(1, Number(queueConfig.maxRecalculationsPerFrame) || 2);
const MAX_VALIDATIONS = Math.max(1, Number(queueConfig.maxValidationsPerFrame) || 5);
const MAX_QUEUED = Math.max(32, Number(queueConfig.maxQueuedJobs) || 256);
const DRAIN_BUDGET_MS = Math.max(1, Number(queueConfig.drainBudgetMs) || 3);
const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

class PathWorkSchedulerImpl {
    constructor() {
        this._recalculations = new Map();
        this._validations = new Map();
        this._sequence = 0;
        this._frameStats = {};
        this.beginFrame();
    }

    beginFrame() {
        this._frameStats = {
            completedRecalculations: 0,
            completedValidations: 0,
            deferredJobs: 0,
            droppedJobs: 0,
            drainMs: 0,
        };
    }

    enqueueRecalculation(manager, planner, targetX, targetY, bypassLimit = false, priority = 0) {
        if (!manager || !planner) return false;
        this._validations.delete(manager);
        const existing = this._recalculations.get(manager);
        if (existing) {
            existing.targetX = targetX;
            existing.targetY = targetY;
            existing.bypassLimit ||= !!bypassLimit;
            existing.priority = Math.max(existing.priority, Number(priority) || 0);
            return true;
        }
        this._recalculations.set(manager, {
            manager,
            planner,
            targetX,
            targetY,
            bypassLimit: !!bypassLimit,
            priority: Number(priority) || 0,
            sequence: this._sequence++,
            kind: 'recalculation',
        });
        this._trimQueue();
        return true;
    }

    enqueueValidation(manager, planner, priority = 0) {
        if (!manager || !planner) return false;
        if (this._recalculations.has(manager)) return true;
        const existing = this._validations.get(manager);
        if (existing) {
            existing.priority = Math.max(existing.priority, Number(priority) || 0);
            return true;
        }
        this._validations.set(manager, {
            manager,
            planner,
            priority: Number(priority) || 0,
            sequence: this._sequence++,
            kind: 'validation',
        });
        this._trimQueue();
        return true;
    }

    drain() {
        const startedAt = nowMs();
        this._drainMap(this._recalculations, MAX_RECALCS, startedAt, (job) => (
            job.manager.forceRecalc(job.planner, job.targetX, job.targetY, job.bypassLimit)
        ), 'completedRecalculations');
        this._drainMap(this._validations, MAX_VALIDATIONS, startedAt, (job) => (
            job.manager.runScheduledValidation(job.planner)
        ), 'completedValidations');
        this._frameStats.drainMs = Math.max(0, nowMs() - startedAt);
        return this.getDebugModel();
    }

    _drainMap(queue, limit, startedAt, execute, completedKey) {
        const jobs = [...queue.values()].sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
        let processed = 0;
        for (const job of jobs) {
            if (processed >= limit || nowMs() - startedAt >= DRAIN_BUDGET_MS) break;
            queue.delete(job.manager);
            if (job.manager.enemy && !job.manager.enemy.active) {
                this._frameStats.droppedJobs++;
                continue;
            }
            const result = execute(job);
            processed++;
            if (result === PATH_DEFERRED) {
                job.sequence = this._sequence++;
                queue.set(job.manager, job);
                this._frameStats.deferredJobs++;
            } else {
                this._frameStats[completedKey]++;
            }
        }
    }

    _trimQueue() {
        while (this._recalculations.size + this._validations.size > MAX_QUEUED) {
            const jobs = [...this._validations.values(), ...this._recalculations.values()];
            jobs.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
            const dropped = jobs[0];
            if (!dropped) break;
            if (dropped.kind === 'validation') this._validations.delete(dropped.manager);
            else this._recalculations.delete(dropped.manager);
            this._frameStats.droppedJobs++;
        }
    }

    getDebugModel() {
        return {
            ...this._frameStats,
            queuedRecalculations: this._recalculations.size,
            queuedValidations: this._validations.size,
            queuedTotal: this._recalculations.size + this._validations.size,
            maxQueuedJobs: MAX_QUEUED,
        };
    }
}

export const PathWorkScheduler = new PathWorkSchedulerImpl();
