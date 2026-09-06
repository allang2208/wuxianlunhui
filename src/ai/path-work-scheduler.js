import performanceConfig from '../../data/performance-config.json';
import { PATH_DEFERRED } from './pathfinder.js';

const queueConfig = performanceConfig.pathQueue || {};
const MAX_RECALCS = Math.max(1, Number(queueConfig.maxRecalculationsPerFrame) || 2);
const MAX_VALIDATIONS = Math.max(1, Number(queueConfig.maxValidationsPerFrame) || 5);
const MAX_QUEUED = Math.max(32, Number(queueConfig.maxQueuedJobs) || 256);
const DRAIN_BUDGET_MS = Math.max(1, Number(queueConfig.drainBudgetMs) || 3);
const RESUME_DEFERRED_FIRST = queueConfig.resumeDeferredFirst !== false;
const MAX_DEFERRED_STREAK = Math.max(1,
    Number(queueConfig.maxDeferredSlicesBeforeYield) || 8);
const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

class PathWorkSchedulerImpl {
    constructor() {
        this._recalculations = new Map();
        this._validations = new Map();
        this._sequence = 0;
        this._frameStats = {};
        this._lastValidationMs = 0;
        this._peakValidationMs = 0;
        this._lastRecalculationMs = 0;
        this._peakRecalculationMs = 0;
        this.beginFrame();
    }

    beginFrame() {
        this._frameStats = {
            completedRecalculations: 0,
            completedValidations: 0,
            deferredJobs: 0,
            droppedJobs: 0,
            drainMs: 0,
            validationMs: 0,
            recalculationMs: 0,
            validationAttempts: 0,
            recalculationAttempts: 0,
        };
    }

    enqueueRecalculation(manager, planner, targetX, targetY, bypassLimit = false, priority = 0) {
        if (!manager || !planner) return false;
        this._validations.delete(manager);
        const existing = this._recalculations.get(manager);
        if (existing && existing.commandRoute === manager._commandRoute) {
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
            deferredStreak: 0,
            commandRoute: manager._commandRoute,
            enqueuedAt: nowMs(),
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
            enqueuedAt: nowMs(),
        });
        this._trimQueue();
        return true;
    }

    hasPendingRecalculation(manager) {
        return !!manager && this._recalculations.has(manager);
    }

    cancel(manager) {
        if (!manager) return;
        const job = this._recalculations.get(manager);
        job?.planner?.cancelIncrementalRequest?.(manager.getPathRequestId?.());
        this._recalculations.delete(manager);
        this._validations.delete(manager);
    }

    drain() {
        const startedAt = nowMs();
        // 预留一次低成本有效性检查，避免持续重算把 validation 永久挤出共享 3ms 预算。
        const validationAttempts = this._validations.size > 0
            ? this._drainMap(this._validations, 1, startedAt, (job) => (
                job.manager.runScheduledValidation(job.planner)
            ), 'completedValidations', 'validationMs', 'validationAttempts')
            : 0;
        this._drainMap(this._recalculations, MAX_RECALCS, startedAt, (job) => (
            job.manager.forceRecalc(job.planner, job.targetX, job.targetY, job.bypassLimit)
        ), 'completedRecalculations', 'recalculationMs', 'recalculationAttempts');
        const remainingValidations = Math.max(0, MAX_VALIDATIONS - validationAttempts);
        if (remainingValidations > 0) {
            this._drainMap(this._validations, remainingValidations, startedAt, (job) => (
                job.manager.runScheduledValidation(job.planner)
            ), 'completedValidations', 'validationMs', 'validationAttempts');
        }
        this._frameStats.drainMs = Math.max(0, nowMs() - startedAt);
        return this.getDebugModel();
    }

    _drainMap(queue, limit, startedAt, execute, completedKey, elapsedKey, attemptsKey) {
        const now = nowMs();
        const score = job => job.priority + Math.floor((now - job.enqueuedAt) / 100);
        const jobs = [...queue.values()].sort((a, b) => score(b) - score(a) || a.sequence - b.sequence);
        let processed = 0;
        for (const job of jobs) {
            if (processed >= limit || nowMs() - startedAt >= DRAIN_BUDGET_MS) break;
            queue.delete(job.manager);
            if (job.kind === 'recalculation' && (job.commandRoute !== job.manager._commandRoute
                || (job.commandRoute && !job.manager.commandOwnerMatches(job.commandRoute)))) {
                this._frameStats.droppedJobs++;
                continue;
            }
            if (job.manager.enemy && !job.manager.enemy.active) {
                job.planner?.cancelIncrementalRequest?.(job.manager.getPathRequestId?.());
                this._frameStats.droppedJobs++;
                continue;
            }
            const jobStartedAt = nowMs();
            const result = execute(job);
            const elapsed = Math.max(0, nowMs() - jobStartedAt);
            this._frameStats[elapsedKey] += elapsed;
            this._frameStats[attemptsKey]++;
            if (job.kind === 'validation') {
                this._lastValidationMs = elapsed;
                this._peakValidationMs = Math.max(this._peakValidationMs, elapsed);
            } else {
                this._lastRecalculationMs = elapsed;
                this._peakRecalculationMs = Math.max(this._peakRecalculationMs, elapsed);
            }
            processed++;
            if (result === PATH_DEFERRED) {
                // 续算任务优先完成，尽快产出可供整批单位复用的路径/流场；验证仍由 drain 首槽保障。
                job.deferredStreak = (job.deferredStreak || 0) + 1;
                if (!RESUME_DEFERRED_FIRST || job.deferredStreak >= MAX_DEFERRED_STREAK) {
                    job.sequence = this._sequence++;
                    job.enqueuedAt = nowMs();
                    job.deferredStreak = 0;
                }
                queue.set(job.manager, job);
                this._frameStats.deferredJobs++;
            } else {
                this._frameStats[completedKey]++;
            }
        }
        return processed;
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
            validationLastMs: this._lastValidationMs,
            validationPeakMs: this._peakValidationMs,
            recalculationLastMs: this._lastRecalculationMs,
            recalculationPeakMs: this._peakRecalculationMs,
        };
    }
}

export const PathWorkScheduler = new PathWorkSchedulerImpl();
