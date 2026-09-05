// 本栋经济升级的持续目标；扣费、科技校验和完成效果仍由原升级系统负责。
// owner.getEconomyUpgradeProject(id) 返回当前档位的 { name, maxed, busy, inProgress, start }。
// 可选 technologyLockReason 同时供按钮与启动门禁使用，不阻止停止已有目标。
import { getBuildingContinuousUpgradeLockReason } from './world122-snapshot.js';

export function getEconomyContinuousUpgradeLockReason(owner, excludeSceneId = null) {
    if (owner._continuous) return '请先停止本建筑的全局持续升级项目';
    return getBuildingContinuousUpgradeLockReason(owner, excludeSceneId);
}

export function restoreEconomyContinuousUpgrade(owner, target, excludeSceneId = null) {
    const project = typeof target === 'string' ? owner.getEconomyUpgradeProject(target) : null;
    owner._economyContinuous = project && !project.maxed
        && !getEconomyContinuousUpgradeLockReason(owner, excludeSceneId) ? target : null;
    owner._economyContinuousRetryMs = 0;
    owner._economyContinuousWaitReason = '';
    owner._economyContinuousRevision = 0;
}

export function clearEconomyContinuousUpgrade(owner) {
    if (owner._economyContinuous) {
        owner._economyContinuousRevision = (owner._economyContinuousRevision || 0) + 1;
    }
    owner._economyContinuous = null;
    owner._economyContinuousRetryMs = 0;
    owner._economyContinuousWaitReason = '';
}

export function updateEconomyContinuousUpgrade(owner, dt) {
    if (!owner._economyContinuous) return;
    if (owner.active === false || owner._sinking || owner.hp <= 0) {
        clearEconomyContinuousUpgrade(owner);
        return;
    }
    owner._economyContinuousRetryMs = Math.max(0,
        (owner._economyContinuousRetryMs || 0) - Math.max(0, Number(dt) || 0));
    if (owner._economyContinuousRetryMs > 0) return;
    const project = owner.getEconomyUpgradeProject(owner._economyContinuous);
    if (!project || project.maxed) {
        clearEconomyContinuousUpgrade(owner);
        return;
    }
    if (project.busy) {
        if (!project.inProgress && owner._economyContinuousWaitReason !== '等待当前升级完成') {
            owner._economyContinuousWaitReason = '等待当前升级完成';
            owner._economyContinuousRevision = (owner._economyContinuousRevision || 0) + 1;
        }
        return;
    }
    if (getEconomyContinuousUpgradeLockReason(owner)) {
        clearEconomyContinuousUpgrade(owner);
        return;
    }
    const result = project.start();
    const reason = result.ok ? '' : (result.reason || '等待条件与资源');
    if (result.ok || reason !== owner._economyContinuousWaitReason) {
        owner._economyContinuousRevision = (owner._economyContinuousRevision || 0) + 1;
    }
    owner._economyContinuousWaitReason = reason;
    owner._economyContinuousRetryMs = result.ok ? 0 : 1000;
}

export function toggleEconomyContinuousUpgrade(owner, projectId) {
    if (!owner || owner.active === false || owner._sinking || owner.hp <= 0) {
        return { ok: false, reason: '建筑已失效' };
    }
    if (owner._economyContinuous === projectId) {
        clearEconomyContinuousUpgrade(owner);
        return { ok: true, stopped: true };
    }
    const project = owner.getEconomyUpgradeProject(projectId);
    if (!project) return { ok: false, reason: '未知经济升级项目' };
    if (project.maxed) return { ok: false, reason: '升级项目已满级' };
    if (project.technologyLockReason) return { ok: false, reason: project.technologyLockReason };
    const lockReason = getEconomyContinuousUpgradeLockReason(owner);
    if (lockReason) return { ok: false, reason: lockReason };
    // 目标所在队列读条时不能改挂，但仍可停止续升；独立队列的手动升级不变。
    if (project.busy) return { ok: false, reason: '当前项目完成后才能开启持续升级' };
    const current = owner._economyContinuous
        ? owner.getEconomyUpgradeProject(owner._economyContinuous) : null;
    if (current?.busy) return { ok: false, reason: '请先停止当前持续升级项目' };
    owner._economyContinuous = projectId;
    owner._economyContinuousRetryMs = 0;
    owner._economyContinuousWaitReason = '';
    owner._economyContinuousRevision = (owner._economyContinuousRevision || 0) + 1;
    updateEconomyContinuousUpgrade(owner, 0);
    return {
        ok: true,
        waiting: !!owner._economyContinuousWaitReason,
        waitReason: owner._economyContinuousWaitReason,
    };
}
