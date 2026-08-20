const TOOLTIP_ID = 'pbAbilityTip';

/** 世界-122建筑升级共用白色悬停浮窗。 */
export function ensureBuildingUpgradeTooltip() {
    if (typeof document === 'undefined') return null;
    let tip = document.getElementById(TOOLTIP_ID);
    if (tip) return tip;
    tip = document.createElement('div');
    tip.id = TOOLTIP_ID;
    tip.style.cssText = 'display:none;position:fixed;z-index:10000;background:#fff;color:#222;'
        + 'border:1px solid #d8d2c4;border-radius:6px;padding:8px 10px;font-size:12px;'
        + 'line-height:1.6;box-shadow:0 4px 12px rgba(0,0,0,0.35);pointer-events:none;max-width:320px;';
    document.body.appendChild(tip);
    return tip;
}

export function moveBuildingUpgradeTooltip(ev) {
    const tip = typeof document !== 'undefined' ? document.getElementById(TOOLTIP_ID) : null;
    if (!tip || tip.style.display === 'none' || !ev) return;
    const w = tip.offsetWidth || 300;
    const h = tip.offsetHeight || 100;
    let left = ev.clientX + 14;
    let top = ev.clientY + 14;
    if (left + w > window.innerWidth - 10) left = ev.clientX - w - 14;
    if (top + h > window.innerHeight - 10) top = ev.clientY - h - 14;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

export function showBuildingUpgradeTooltip(html, ev) {
    const tip = ensureBuildingUpgradeTooltip();
    if (!tip) return;
    tip.innerHTML = html;
    tip.style.display = 'block';
    moveBuildingUpgradeTooltip(ev);
}

export function hideBuildingUpgradeTooltip() {
    const tip = typeof document !== 'undefined' ? document.getElementById(TOOLTIP_ID) : null;
    if (tip) tip.style.display = 'none';
}
