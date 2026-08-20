/**
 * 世界-122建筑详情统一头部：
 * 1. 缩略图与名称
 * 2. 生命条、当前/最大耐久、百分比
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
    const max = Math.max(1, Number(maxHp) || 1);
    const current = Math.max(0, Math.ceil(Number(hp) || 0));
    const pct = Math.max(0, Math.min(100, Math.round(current / max * 100)));
    const hpColor = pct > 60 ? '#7fd47f' : (pct > 30 ? '#ffd700' : '#ff6666');
    const thumbnail = texture
        ? `<img src="assets/terrain/${texture}.png" draggable="false" alt="${name}" style="width:82px;height:76px;object-fit:contain;flex-shrink:0;">`
        : `<span style="font-size:42px;line-height:1;flex-shrink:0;">${icon}</span>`;
    return `
        <section class="world122-building-detail-header" style="border:1px solid #4a5a6a;border-radius:8px;padding:10px;margin-bottom:10px;background:rgba(20,40,55,0.26);">
            <div style="display:flex;align-items:center;gap:10px;">
                ${thumbnail}
                <div style="flex:1;min-width:0;">
                    <div class="world122-building-detail-name" style="font-size:16px;font-weight:700;color:${accent};">${name}</div>
                    ${status ? `<div class="world122-building-detail-status" style="font-size:11px;color:${statusColor};margin-top:2px;">${status}</div>` : ''}
                    <div style="height:8px;background:#242424;border-radius:4px;overflow:hidden;margin:7px 0 5px;">
                        <div style="height:100%;width:${pct}%;background:${hpColor};"></div>
                    </div>
                    <div class="world122-building-detail-durability" style="font-size:12px;color:#c8c0b0;">耐久 ${current} / ${max}（${pct}%）</div>
                </div>
            </div>
        </section>`;
}
