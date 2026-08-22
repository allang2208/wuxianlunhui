// 研究院、铁匠铺与出兵建筑共用的升级项目卡片。
import { CrossPlaneResourceSystem } from '../../world/cross-plane-resource-system.js';

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
        return `<img class="${className}" src="${imagePath}" alt="" aria-hidden="true" draggable="false">`;
    }
    return `<span class="${className} is-fallback" aria-hidden="true">${icon || ''}</span>`;
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
        barId,
        textId,
        actionsHtml = '',
        accent = '#c9a0ff',
        technologyGateType = null,
        technologyGateId = null,
    } = options;
    const pct = Math.max(0, Math.min(100, Math.round(Number(progressPct) || 0)));
    const progressText = inProgress
        ? `升级中 ${pct}%（剩余 ${Math.max(0, Math.ceil((Number(remainMs) || 0) / 1000))}s）`
        : '';
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
            <div class="building-upgrade-card-actions" style="flex-shrink:0;">${actionsHtml}</div>
        </div>`;
}
