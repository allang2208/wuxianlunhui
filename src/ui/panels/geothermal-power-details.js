// 地热档案只读生产快照；计时余数不作为效率条数据。
const fmt = (value) => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export function geothermalUpgradeValue(module, level) {
    const value = module.base + module.per * level;
    switch (module.effect) {
        case 'geothermalCycleMs': return `${fmt(value / 1000)} 秒/轮`;
        case 'geothermalEnergyPerCycle': return `${fmt(value)} 原始能源/轮`;
        case 'geothermalConversionRate': return `${fmt(value * 100)}% 转换率`;
        case 'geothermalStaffCapacity': return `${fmt(value)} 个岗位`;
        default: return fmt(value);
    }
}

export function geothermalUpgradeSummary(module, level) {
    const current = geothermalUpgradeValue(module, level);
    return level >= module.maxLevel ? `${current} · 已满级`
        : `${current} → ${geothermalUpgradeValue(module, level + 1)}`;
}

function fields(snapshot, cfg) {
    return {
        cost: `${fmt(cfg.cost)} 能源`, footprint: `${cfg.footprintCells}×${cfg.footprintCells} · 外围道路环`,
        defenses: `${fmt(cfg.def)} / ${fmt(cfg.mdef)}`, limit: `每位面 ${cfg.buildLimit} 座`,
        cycle: `${fmt(snapshot.cycleMs / 1000)} 秒`, raw: `${fmt(snapshot.energyPerCycle)} 能源/轮`,
        conversion: `${fmt(snapshot.conversionRate * 100)}%`,
        staff: `${snapshot.staffedCount}/${snapshot.staffCapacity} · 发挥 ${fmt(snapshot.staffFactor * 100)}%`,
        configured: `${fmt(snapshot.configuredEnergyPerSecond)} 能源/秒`,
        theoretical: `${fmt(snapshot.theoreticalEnergyPerSecond)} 能源/秒`,
        available: `${fmt(snapshot.availableEnergyPerSecond)} 能源/秒`,
        labor: `×${fmt(snapshot.laborEfficiency)}`, workshop: `×${fmt(snapshot.workshopMultiplier)}`,
        tavern: `×${fmt(snapshot.tavernMultiplier)}`, production: `×${fmt(snapshot.productionMultiplier)}`,
        pending: `${fmt(snapshot.pendingEnergy)} 能源`, stored: `${fmt(snapshot.storedEnergy)} 能源`,
        free: `${fmt(snapshot.freeEnergyCapacity)} 能源`,
        formula: `${fmt(snapshot.energyPerCycle)} × ${fmt(snapshot.conversionRate)} ÷ ${fmt(snapshot.cycleMs / 1000)}秒 × 岗位${fmt(snapshot.staffFactor)} × 人口${fmt(snapshot.laborEfficiency)} × 工坊${fmt(snapshot.workshopMultiplier)} × 酒馆${fmt(snapshot.tavernMultiplier)} × 生产${fmt(snapshot.productionMultiplier)} = ${fmt(snapshot.theoreticalEnergyPerSecond)} 能源/秒`,
    };
}

export function renderGeothermalPowerDetails(snapshot, cfg) {
    const values = fields(snapshot, cfg);
    const stat = (label, key) => `<div><span>${label}</span><b data-geothermal-field="${key}">${escape(values[key])}</b></div>`;
    return `<div class="economy-panel-heading"><span>地热电站运行档案</span><span data-geothermal-status class="economy-panel-badge${snapshot.blockedReason ? ' is-blocked' : ''}">${escape(snapshot.blockedReason || '稳定发电')}</span></div>
        <div class="economy-stat-grid">
            ${stat('基础造价', 'cost')}${stat('占地 / 道路', 'footprint')}
            ${stat('物理 / 魔法防御', 'defenses')}${stat('建造上限', 'limit')}
            ${stat('入账周期（不是效率）', 'cycle')}${stat('单轮原始产能', 'raw')}
            ${stat('可用能源转换率', 'conversion')}${stat('上岗 / 岗位 · 人效', 'staff')}
            ${stat('100%人效配置产量', 'configured')}${stat('当前理论发电量', 'theoretical')}
            ${stat('当前可入仓速率', 'available')}${stat('人口效率', 'labor')}
            ${stat('最强工坊增效', 'workshop')}${stat('位面酒馆增效', 'tavern')}
            ${stat('全局生产倍率', 'production')}${stat('本栋暂存（含小数）', 'pending')}
            ${stat('位面仓库现有能源', 'stored')}${stat('可接收能源余量', 'free')}
        </div>
        <p class="economy-panel-note" data-geothermal-field="formula">${escape(values.formula)}</p>
        <p class="economy-panel-note">无需燃料或矿脉；地牢、矿洞等无阳光建设位面可用，不受降雨、沙尘暴和昼夜变化减产。同岗位、同等级、同外部增益下，为晴好光伏产能的85%。</p>
        <p class="economy-panel-note">岗位安排表示已安排人数/当前岗位上限；每名技师固定发挥${fmt(snapshot.workerEfficiencyShare * 100)}%配置产能。第二条显示稳定发电效率，不显示循环入账进度。当前可入仓速率是无阻塞时的理论供给，不是已到账收入；满仓能源暂存本栋，小数保留，入账仅进入本位面仓库。</p>
        <p class="economy-panel-note">完成地热发电研究后开放下方四项独立工程；每栋同时施工一项，付款并读条完成后才生效。离场时当前工程继续按后台结算推进，回场后恢复状态。</p>`;
}

export function updateGeothermalPowerDetails(root, snapshot, cfg) {
    for (const [key, value] of Object.entries(fields(snapshot, cfg))) {
        const node = root.querySelector(`[data-geothermal-field="${key}"]`);
        if (node) node.textContent = value;
    }
    const status = root.querySelector('[data-geothermal-status]');
    if (status) {
        status.textContent = snapshot.blockedReason || '稳定发电';
        status.classList.toggle('is-blocked', !!snapshot.blockedReason);
    }
}
