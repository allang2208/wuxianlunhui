/**
 * 把岗位人口换算为单业务角色建筑的最终产出发挥率。
 * 该函数不读取场景、状态机或 Sprite，可由前台与离场模拟安全复用。
 */
export function getConfiguredWorkerOutputFactor(assignedWorkers, config) {
    const assigned = Math.max(0, Math.floor(Number(assignedWorkers) || 0));
    if (assigned <= 0) return 0;
    const share = Number(config?.workerOutputEfficiencyShare);
    return Number.isFinite(share) && share > 0
        ? Math.max(0, Math.min(1, assigned * share))
        : 1;
}

const clampFactor = (value) => Math.max(0, Math.min(1, Number(value) || 0));

/**
 * 只累计真正发生在加工阶段的工作量。移动、等仓与取货均不参与岗位效率平均，
 * 因而不会改变任何物流状态机或精灵动画节奏。
 */
export function resetWorkerOutputProgress(job) {
    if (!job) return;
    job.workerOutputWeightedWorkMs = 0;
    job.workerOutputWorkMs = 0;
}

export function accumulateWorkerOutputProgress(job, factor, workMs) {
    const work = Math.max(0, Number(workMs) || 0);
    if (!job || work <= 0) return;
    job.workerOutputWeightedWorkMs = Math.max(0,
        Number(job.workerOutputWeightedWorkMs) || 0) + clampFactor(factor) * work;
    job.workerOutputWorkMs = Math.max(0, Number(job.workerOutputWorkMs) || 0) + work;
}

export function resolveWorkerOutputProgress(job, fallbackFactor = 0) {
    const work = Math.max(0, Number(job?.workerOutputWorkMs) || 0);
    if (work <= 0) return clampFactor(fallbackFactor);
    return clampFactor(Math.max(0, Number(job?.workerOutputWeightedWorkMs) || 0) / work);
}
