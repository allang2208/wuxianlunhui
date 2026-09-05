// 蘑菇农场的只读档案表现；所有业务数值来自 CheeseFarmSystem.getSnapshot。
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const number = (value) => Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const multiplier = (value) => `×${number(value)}`;

export function formatMushroomUpgradeValue(module, value) {
    switch (module.effect) {
        case 'mushroomFoodPerBatch': return `${number(value)} 食物/基础批次`;
        case 'mushroomProcessTimeMs': return `${number(value / 1000)} 秒/标准培养`;
        case 'mushroomBedCount': return `${number(value)} 份菌床产能（${multiplier(value / module.base)}）`;
        case 'mushroomMoveSpeedMultiplier': return `基础运输速度 +${number((value - 1) * 100)}%`;
        default: return number(value);
    }
}

export function mushroomUpgradeSummary(module, level) {
    const value = (atLevel) => Number(module.base) + Number(module.per) * atLevel;
    const current = formatMushroomUpgradeValue(module, value(level));
    return level >= module.maxLevel ? `${current} · 已满级`
        : `${current} → ${formatMushroomUpgradeValue(module, value(level + 1))}`;
}

export function mushroomUpgradeDescription(module, level) {
    const value = Number(module.base) + Number(module.per) * level;
    return escape(String(module.desc || '').replaceAll('{value}', number(value))
        .replaceAll('{seconds}', number(value / 1000))
        .replaceAll('{pct}', number((value - 1) * 100)));
}

function fields(snapshot, storedFood) {
    const detail = snapshot.mushroom;
    const planePct = number(snapshot.planeMultiplier * 100);
    const planePenalty = snapshot.planeSource === 'scene'
        ? `当前处于${snapshot.planeLabel}，初级农业建筑最终产量仅保留${planePct}%；奶酪农场不受此规则影响。`
        : '当前为有阳光位面，最终产量降低50%；普通入夜不会解除。地牢、矿洞等无阳光位面提高50%。';
    return {
        buildCost: `${number(detail.baseBuildCost)} 能源`,
        footprint: `${detail.footprintCells}×${detail.footprintCells}`,
        defense: number(detail.defense),
        magicDefense: number(detail.magicDefense),
        batchLabel: snapshot.phase === 'processing' ? '本批累计预计成品' : '本批待入仓成品',
        batch: `${number(detail.batchFood)} 食物`,
        current: `${number(detail.currentStaffFood)} 食物/批`,
        full: `${number(detail.fullStaffFood)} 食物/批`,
        strain: `${number(snapshot.foodPerBatch)} 食物/批`,
        beds: `${snapshot.fieldCount} / ${detail.baseBedCount} 份 · ${multiplier(detail.capacityMultiplier)}`,
        plane: `${snapshot.planeLabel} ${multiplier(snapshot.planeMultiplier)}`,
        planePenalty,
        comparison: `${number(detail.sunlessFood)} / ${number(detail.sunlitFood)} 食物`,
        workforce: `${detail.assignedWorkers} / ${detail.workerSlots} 人`,
        efficiency: `当前 ${number(snapshot.workerOutputFactor * 100)}% · 本批 ${number(snapshot.batchWorkerOutputFactor * 100)}%`,
        process: `${number(snapshot.processTimeMs / 1000)} 秒`,
        effective: detail.effectiveProcessTimeMs == null ? '暂停'
            : `${number(detail.effectiveProcessTimeMs / 1000)} 秒（不含运输）`,
        progress: snapshot.phase === 'processing' ? `${number(snapshot.progress * 100)}%` : '当前无培养任务',
        remaining: snapshot.phase !== 'processing' ? '—'
            : detail.remainingProcessTimeMs == null ? '已暂停'
                : `${number(detail.remainingProcessTimeMs / 1000)} 秒`,
        labor: `${multiplier(detail.laborMultiplier)} / ${multiplier(detail.workshopMultiplier)}`,
        weather: `${snapshot.weatherLabel} ${multiplier(snapshot.weatherMultiplier)}`,
        bonuses: `${multiplier(detail.tavernMultiplier)} / ${multiplier(detail.productionMultiplier)}`,
        warehouses: `${snapshot.connectedWarehouseCount} 座`,
        capacity: `${number(detail.freeFoodCapacity)} 食物`,
        speed: `${number(snapshot.moveSpeed)} px/s`,
        pending: `${number(snapshot.pendingFood)} 食物`,
        batches: `${snapshot.completedBatches} 批`,
        stored: `${number(Math.floor(storedFood))} 食物`,
        formula: `最终成品 = 品系基础批产 ${number(snapshot.foodPerBatch)} × 菌床 ${number(detail.capacityMultiplier)} × 培养期平均岗位效率 × 位面环境 ${number(snapshot.planeMultiplier)} × 天气 ${number(snapshot.weatherMultiplier)} × 酒馆 ${number(detail.tavernMultiplier)} × 生产加成 ${number(detail.productionMultiplier)}；小数余粮累计到后续批次。`,
    };
}

export function renderMushroomFarmDetails(snapshot, storedFood) {
    const values = fields(snapshot, storedFood);
    const stat = (label, key, food = false) => `<div><span>${label}</span><b data-mushroom-field="${key}"${food ? ' class="economy-unit-food"' : ''}>${escape(values[key])}</b></div>`;
    return `<section class="mushroom-farm-details">
        <div class="economy-panel-heading"><span>同级食物建筑 · 基础属性</span></div>
        <div class="economy-stat-grid">
            ${stat('基础建造费用', 'buildCost')}
            ${stat('建筑主体占地', 'footprint')}
            ${stat('物理防御', 'defense')}
            ${stat('魔法防御', 'magicDefense')}
        </div>
        <div class="economy-panel-heading"><span>蘑菇农场 · 生产档案</span><span class="economy-panel-badge${snapshot.blockReason ? ' is-blocked' : ''}" data-mushroom-status>${escape(snapshot.status)}</span></div>
        <div class="economy-stat-grid">
            ${stat('<span data-mushroom-field="batchLabel">' + values.batchLabel + '</span>', 'batch', true)}
            ${stat('按当前岗位预计批产', 'current', true)}
            ${stat('满岗批产（含当前加成）', 'full', true)}
            ${stat('品系基础批产', 'strain', true)}
            ${stat('有效 / 基础菌床产能', 'beds')}
            ${stat('位面环境', 'plane')}
            ${stat('非雪原：无阳光 / 有阳光批产¹', 'comparison', true)}
            ${stat('菌农岗位', 'workforce')}
        </div>
        <p class="economy-panel-note is-danger" data-mushroom-plane-penalty ${snapshot.planeMultiplier < 1 ? '' : 'hidden'}>${escape(values.planePenalty)}</p>
        <p class="economy-panel-note">¹ 仅计品系、菌床和日照，按满岗比较；雪原会覆盖日照倍率并固定使用20%的位面环境倍率，天气、酒馆及全局生产加成另计。六组实体菌床保持不变，“分层菌床”只提升其有效产能。</p>
        <div class="economy-panel-heading"><span>培养周期与产出加成</span></div>
        <div class="economy-stat-grid">
            ${stat('当前 / 本批岗位效率', 'efficiency')}
            ${stat('标准培养周期', 'process')}
            ${stat('新批次理论培养用时', 'effective')}
            ${stat('劳动 / 工坊培养速度', 'labor')}
            ${stat('本批实际培养进度', 'progress')}
            ${stat('本批预计剩余培养', 'remaining')}
            ${stat('粮食天气', 'weather')}
            ${stat('酒馆 / 全局生产加成', 'bonuses')}
        </div>
        <p class="economy-panel-note" data-mushroom-field="formula">${escape(values.formula)}</p>
        <div class="economy-panel-heading"><span>道路物流与仓储</span></div>
        <div class="economy-stat-grid">
            ${stat('道路可达仓库', 'warehouses')}
            ${stat('可达仓库剩余食物容量', 'capacity', true)}
            ${stat('升级后基础运输速度', 'speed')}
            ${stat('携带 / 待存成品', 'pending', true)}
            ${stat('已完成送仓批次', 'batches')}
            ${stat('位面已存粮食', 'stored', true)}
        </div>
        <p class="economy-panel-note is-danger" data-mushroom-block ${snapshot.blockReason ? '' : 'hidden'}>${escape(snapshot.status)}；已培育成品保留，不会因撤岗、满仓或断路重复发放。</p>
        <p class="economy-panel-note" data-mushroom-capacity-warning ${snapshot.roadConnected && snapshot.mushroom.freeFoodCapacity < 1 ? '' : 'hidden'}>可达仓库目前没有食物空间，成品完成后将等待入仓。</p>
        <p class="economy-panel-note">4×4主体只在门侧铺出4格道路，仍需连接真实仓库。10岗位每人贡献10%最终批产，按培养期加权；劳动与工坊影响培养用时。培养完成→携粮送仓→返回农场，往返时间另计，不把理论批产当作每秒入库收益。</p>
        <p class="economy-panel-note">完成“食用菌栽培”研究后开放下方四项项目；每栋独立扣费、读条完成后生效，最多同时升级一项。物流沿用一名可见菌农；升级不增加占地或角色数量。</p>
    </section>`;
}

export function updateMushroomFarmDetails(root, snapshot, storedFood) {
    const values = fields(snapshot, storedFood);
    for (const [key, value] of Object.entries(values)) {
        const element = root.querySelector(`[data-mushroom-field="${key}"]`);
        if (element && element.textContent !== value) element.textContent = value;
    }
    const badge = root.querySelector('[data-mushroom-status]');
    if (badge) {
        badge.textContent = snapshot.status;
        badge.classList.toggle('is-blocked', !!snapshot.blockReason);
    }
    const warning = root.querySelector('[data-mushroom-block]');
    if (warning) {
        warning.hidden = !snapshot.blockReason;
        warning.textContent = `${snapshot.status}；已培育成品保留，不会因撤岗、满仓或断路重复发放。`;
    }
    const planePenalty = root.querySelector('[data-mushroom-plane-penalty]');
    if (planePenalty) {
        planePenalty.hidden = snapshot.planeMultiplier >= 1;
        planePenalty.textContent = values.planePenalty;
    }
    const capacity = root.querySelector('[data-mushroom-capacity-warning]');
    if (capacity) capacity.hidden = !snapshot.roadConnected || snapshot.mushroom.freeFoodCapacity >= 1;
}
