// 经济建筑、研究院、铁匠铺与出兵建筑共用的升级项目卡片。
import { CrossPlaneResourceSystem } from '../../world/cross-plane-resource-system.js';
import { renderLightweightProjectImage } from '../dom-project-image.js';
import { TechnologySystem } from '../../world/technology-system.js';

// 面板打开时每秒检查互斥和科技门禁；只有状态变化才重建按钮，避免锁态停留在旧基线。
export function buildingUpgradeControlsChanged(panel, owner, { force = false } = {}) {
    const now = Date.now();
    if (!force && now < (panel._upgradeControlPollAt || 0)) return false;
    panel._upgradeControlPollAt = now + 1000;
    const gates = Array.from(panel.el?.querySelectorAll('[data-technology-gate-type][data-technology-gate-id]') || [])
        .map((element) => `${element.dataset.technologyGateType}:${element.dataset.technologyGateId}:${
            TechnologySystem.isUnlocked(element.dataset.technologyGateType, element.dataset.technologyGateId)}`);
    const state = JSON.stringify([
        owner?.getContinuousUpgradeLockReason?.('global') || '',
        owner?.getContinuousUpgradeLockReason?.('economy') || '',
        ...new Set(gates),
    ]);
    const changed = panel._upgradeControlState != null && panel._upgradeControlState !== state;
    panel._upgradeControlState = state;
    return changed;
}

export function formatBuildingUpgradeRequirement(cost, maxed = false) {
    if (maxed) return '已达到最高等级';
    if (!cost) return '升级资源配置缺失';
    const quoted = CrossPlaneResourceSystem.quote(cost);
    const suffix = quoted.remote ? `（跨位面 ×${quoted.multiplier.toFixed(2)}）` : '';
    return `升级需要：${quoted.gold} 金币 + ${quoted.energy} 能源${suffix}`;
}

export function renderBuildingUpgradeIcon(icon = '', iconImage = '', className = 'building-upgrade-inline-icon') {
    const imagePath = String(iconImage || '').trim();
    if (imagePath) {
        return renderLightweightProjectImage(imagePath, { className });
    }
    return `<span class="${className} is-fallback" aria-hidden="true">${icon || ''}</span>`;
}

function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (char) => {
        switch (char) {
            case '&':
                return '&amp;';
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            case "'":
                return '&#39;';
            default:
                return char;
        }
    });
}

export function renderBuildingUpgradeCard(options = {}) {
    const {
        rowAttribute,
        projectId,
        icon = '',
        iconImage = '',
        name = projectId || '',
        level = 0,
        maxLevel = 10,
        cost = null,
        maxed = false,
        unlocked = true,
        inProgress = false,
        progressPct = 0,
        remainMs = 0,
        statusText = '',
        barId,
        textId,
        actionsHtml = '',
        accent = '#c9a0ff',
        technologyGateType = null,
        technologyGateId = null,
        economyOwner = null,
    } = options;

    const safeProjectId = String(projectId || '');
    const safeWaitReason = escapeHtml(String(
        economyOwner ? economyOwner._economyContinuousWaitReason || '等待条件与资源' : '等待条件与资源'
    ));

    const economyProject = economyOwner?.getEconomyUpgradeProject?.(projectId);
    const isEconomyProject = !!economyProject;
    const economyMaxed = maxed || !!economyProject?.maxed;
    const isEconomyActive = isEconomyProject
        && String(economyOwner?._economyContinuous || '') === String(projectId || '');
    const currentContinuousProjectId = economyOwner ? String(economyOwner._economyContinuous || '') : '';
    const currentContinuousProject = currentContinuousProjectId
        ? economyOwner?.getEconomyUpgradeProject?.(currentContinuousProjectId)
        : null;
    const isDifferentProjectBusy = currentContinuousProjectId !== String(projectId || '')
        && !!currentContinuousProject?.busy;
    const lockReason = economyOwner?.getContinuousUpgradeLockReason?.('economy') || '';
    const technologyLockReason = economyProject?.technologyLockReason || '';
    const continuousDisabled = isEconomyProject
        && (economyMaxed || economyProject.busy || isDifferentProjectBusy || lockReason || technologyLockReason)
        && !isEconomyActive;
    const economyContinuousButton = isEconomyProject
        ? `<button type="button"
                 class="troop-panel-upgrade-button building-upgrade-continuous-button${isEconomyActive ? ' is-active' : ''}"
                 data-economy-continuous="${escapeHtml(safeProjectId)}"
                 aria-pressed="${isEconomyActive ? 'true' : 'false'}"
                 title="${escapeHtml(isEconomyActive ? '停止后续升级，当前读条保留'
                     : (technologyLockReason || lockReason || (economyMaxed ? '已满级' : '条件满足时自动升级')))}"
                 aria-label="${escapeHtml(String(name || safeProjectId || ''))}持续升级（${isEconomyActive ? '已开启，点击停止' : '未开启，点击开启'}）"
                 ${continuousDisabled ? 'disabled' : ''}>
            ${isEconomyActive ? '持续中' : '持续升级'}
          </button>`
        : '';
    const economyManualAction = economyMaxed
        ? '<button type="button" class="troop-panel-upgrade-button" disabled title="已满级">升级</button>'
        : actionsHtml;
    const renderedActionsHtml = isEconomyProject
        ? `<div class="building-upgrade-action-group building-upgrade-action-group--economy" data-technology-gate-locked-mode="disable">${economyManualAction}${economyContinuousButton}</div>`
        : actionsHtml;

    const pct = Math.max(0, Math.min(100, Math.round(Number(progressPct) || 0)));
    const progressText = inProgress
        ? `升级中 ${pct}%（剩余 ${Math.max(0, Math.ceil((Number(remainMs) || 0) / 1000))}s）`
        : (isEconomyActive ? `持续升级已开启 · ${safeWaitReason}` : statusText);

    const hasTechnologyGate = !!(technologyGateType && technologyGateId);
    const gateAttributes = hasTechnologyGate
        ? `data-technology-gate-type="${technologyGateType}" data-technology-gate-id="${technologyGateId}"`
        : '';
    const iconHtml = renderBuildingUpgradeIcon(icon, iconImage, 'building-upgrade-card-icon');
    return `
        <div class="building-upgrade-card" ${rowAttribute}="${projectId}" ${gateAttributes}
             aria-hidden="${hasTechnologyGate ? 'false' : (unlocked ? 'false' : 'true')}"
             style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #22303a;gap:8px;cursor:help;${hasTechnologyGate || unlocked ? '' : 'visibility:hidden;pointer-events:none;'}">
            <div style="flex:1;min-width:0;">
                <div class="building-upgrade-card-name" style="font-size:13px;color:#d4e8ff;">${iconHtml}<span class="building-upgrade-card-label">${name}</span> <span class="building-upgrade-card-level" style="color:#8ad0ff;">Lv.${level}/${maxLevel}</span></div>
                <div class="building-upgrade-card-requirement" style="font-size:10px;color:#b8aa82;margin-top:2px;">${formatBuildingUpgradeRequirement(cost, maxed)}</div>
                <div style="position:relative;height:8px;background:rgba(255,255,255,0.10);border-radius:4px;overflow:hidden;margin-top:4px;">
                    <div id="${barId}" style="position:absolute;left:0;top:0;bottom:0;width:${pct}%;background:linear-gradient(90deg,#ffd700,${accent});border-radius:4px;transition:width 0.2s linear;"></div>
                </div>
                <div class="building-upgrade-card-progress" id="${textId}" style="font-size:10px;color:${accent};margin-top:2px;min-height:12px;">${progressText}</div>
            </div>
            <div class="building-upgrade-card-actions" style="flex-shrink:0;">${renderedActionsHtml}</div>
        </div>`;
}
