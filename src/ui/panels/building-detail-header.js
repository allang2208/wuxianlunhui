function buildingDurabilityDisplay(hp, maxHp) {
    const max = Math.max(1, Number(maxHp) || 1);
    const current = Math.max(0, Math.ceil(Number(hp) || 0));
    const pct = Math.max(0, Math.min(100, Math.round(current / max * 100)));
    const hpColor = pct > 60 ? '#7fd47f' : (pct > 30 ? '#ffd700' : '#ff6666');
    return { max, current, pct, hpColor };
}

/** 原位刷新耐久和状态，不替换缩略图、控件或当前焦点。 */
export function refreshBuildingDetailHeader(root, { hp, maxHp, status } = {}) {
    const header = root?.querySelector('.world122-building-detail-header');
    if (!header) return;
    const { max, current, pct, hpColor } = buildingDurabilityDisplay(hp, maxHp);
    const bar = header.querySelector('[data-building-durability-bar]');
    if (bar) {
        bar.style.width = `${pct}%`;
        bar.style.background = hpColor;
    }
    const durability = header.querySelector('.world122-building-detail-durability');
    const text = `耐久 ${current} / ${max}（${pct}%）`;
    if (durability && durability.textContent !== text) durability.textContent = text;
    const statusEl = header.querySelector('.world122-building-detail-status');
    if (statusEl && status !== undefined && statusEl.textContent !== status) {
        statusEl.textContent = status;
    }
}

/**
 * 世界-122建筑详情统一头部：
 * 1. 缩略图与名称
 * 2. 独占整行的生命条、当前/最大耐久、百分比
 * 3. 调用方在其后继续渲染建筑特殊功能
 */
export function renderBuildingDetailHeader({
    texture,
    name,
    hp,
    maxHp,
    accent = '#ffd700',
    icon = '🏗️',
    status = '',
    statusColor = '#7fd47f',
}) {
    const { max, current, pct, hpColor } = buildingDurabilityDisplay(hp, maxHp);
    const thumbnail = texture
        ? `<img src="assets/terrain/${texture}.png" draggable="false" alt="${name}" style="width:82px;height:76px;object-fit:contain;flex-shrink:0;">`
        : `<span style="font-size:42px;line-height:1;flex-shrink:0;">${icon}</span>`;
    return `
        <section class="world122-building-detail-header" style="border:1px solid #4a5a6a;border-radius:8px;padding:10px;margin-bottom:10px;background:rgba(20,40,55,0.26);">
            <div class="world122-building-detail-identity">
                ${thumbnail}
                <div class="world122-building-detail-summary">
                    <div class="world122-building-detail-name" style="font-size:16px;font-weight:700;color:${accent};">${name}</div>
                    ${status ? `<div class="world122-building-detail-status" style="font-size:11px;color:${statusColor};margin-top:2px;">${status}</div>` : ''}
                </div>
            </div>
            <div class="world122-building-detail-health">
                <div class="world122-building-detail-health-track">
                    <div data-building-durability-bar style="height:100%;width:${pct}%;background:${hpColor};"></div>
                </div>
                <div class="world122-building-detail-durability" style="font-size:12px;color:#c8c0b0;">耐久 ${current} / ${max}（${pct}%）</div>
            </div>
        </section>`;
}
