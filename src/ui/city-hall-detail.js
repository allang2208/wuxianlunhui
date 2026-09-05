import { PopulationEconomySystem as Population } from '../world/population-economy-system.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { GoldManager } from '../systems/gold-manager.js';
import { TechnologySystem } from '../world/technology-system.js';
import { BuildingRoadSystem } from '../world/building-road-system.js';
import { SceneManager } from '../world/scene-manager.js';
import { renderBuildingDetailHeader, refreshBuildingDetailHeader } from './panels/building-detail-header.js';
import { renderPopulationGrowth, refreshPopulationGrowth } from './population-growth-view.js';
import { normalizeCityHallPolicyPlan, POLICY_BY_ID, policyCost } from '../world/city-hall-policy-plan.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const format = (value) => Math.max(0, Number(value) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
const live = (building) => building?.active && !building._sinking && building.hp > 0;

/** A city-hall-only view inside the common building drawer; no production formulas live here. */
export class CityHallDetailView {
    constructor(panel, getBuildings) {
        this.panel = panel;
        this.getBuildings = getBuildings;
        this.rows = new Map();
        this.tab = 'overview';
        this.filter = 'all';
        this.root = document.createElement('section');
        this.root.className = 'city-hall-view';
        this.root.setAttribute('aria-label', '市政厅详情');
        this.root.innerHTML = `
            <header class="ch-header bp-panel-header"><div class="bp-panel-header-copy"><h2>建筑详情</h2><p class="ch-muted" data-world></p></div><button type="button" class="ch-button" data-close aria-label="关闭市政厅详情">关闭</button></header>
            <div class="ch-scroll">
                <div data-building-header></div>
                <section class="ch-card ch-building-copy" aria-label="市政厅介绍与属性">
                    <h3>建筑说明</h3><p class="ch-copy" data-description></p>
                    <div class="ch-metrics ch-building-facts">
                        <div><span>物理防御</span><b data-defense></b></div>
                        <div><span>魔法防御</span><b data-magic-defense></b></div>
                        <div><span>逻辑占地</span><b>4 × 4 格</b></div>
                        <div><span>基地限制</span><b>本位面唯一 · 不可迁移</b></div>
                    </div>
                </section>
                <h3 class="ch-function-title">特殊功能 · 位面治理</h3>
                <nav class="ch-tabs" role="tablist" aria-label="市政厅栏目"><button type="button" role="tab" id="chOverviewTab" aria-controls="chOverview" data-tab="overview">位面总览</button><button type="button" role="tab" id="chJobsTab" aria-controls="chJobs" data-tab="jobs">岗位管理</button></nav>
                <section id="chOverview" role="tabpanel" aria-labelledby="chOverviewTab" tabindex="0" data-page="overview">
                    <section class="ch-card"><div class="ch-section-heading"><h3>资源与人口</h3><span class="ch-muted">当前位面 · 实时更新</span></div>
                        <div class="ch-metrics">
                            <div><span>本位面食物</span><b data-food></b><small>仓库实存</small></div>
                            <div><span>本位面能源</span><b data-energy></b><small>仓库实存</small></div>
                            <div><span>金币账户</span><b data-gold></b><small>玩家全局资源</small></div>
                            <div><span>实际人口</span><b data-population></b><small data-population-free></small></div>
                            <div><span>岗位空缺</span><b data-job-vacancies></b><small data-job-empty></small></div>
                        </div>
                        ${renderPopulationGrowth()}
                    </section>
                    <section class="ch-card"><div class="ch-section-heading"><h3>仓储与建设</h3><span data-warehouse-count></span></div><progress data-storage-bar aria-label="本位面仓储占用"></progress><p data-storage></p><dl class="ch-facts"><dt>经济设施</dt><dd data-economy-count></dd><dt>招募设施</dt><dd data-troop-count></dd><dt>科研产出</dt><dd data-research></dd><dt>劳动力效率</dt><dd data-efficiency></dd></dl><p class="ch-muted">仓储按现有压缩系数计容；资源不含其他位面库存。人口占用含已预留名额，军事人口独立计算。</p></section>
                    <section class="ch-card"><div class="ch-section-heading"><h3>待处理事项</h3><button type="button" class="ch-button" data-show-jobs>前往调岗</button></div><ul class="ch-alerts" data-alerts></ul></section>
                    <section class="ch-card"><h3>时代演进</h3><ol class="ch-eras" data-eras></ol><p class="ch-muted" data-next-era></p></section>
                </section>
                <section id="chJobs" class="ch-card" role="tabpanel" aria-labelledby="chJobsTab" tabindex="0" data-page="jobs" hidden>
                    <div class="ch-section-heading"><h3>经济岗位</h3><strong data-job-summary></strong></div>
                    <p class="ch-muted">调整立即生效，使用现有岗位与人口规则；卸任工人仍按原有运输交接流程退岗。</p>
                    <div class="ch-job-toolbar"><label>查找建筑<input type="search" data-search placeholder="建筑名称或编号" autocomplete="off"></label><label>岗位状态<select data-filter><option value="all">全部建筑</option><option value="vacant">有空缺</option><option value="empty">无人值守</option></select></label></div>
                    <div class="ch-job-list" data-jobs></div><p class="ch-empty" data-empty hidden>没有符合条件的经济建筑。</p>
                </section>
                <section class="ch-card ch-policy-entry"><div><h3>社会政策与发展路线</h3><p class="ch-muted" data-plan-summary></p></div><button id="chOpenPolicies" type="button" class="ch-button ch-primary" data-policies>打开政策面板</button></section>
            </div>
            <footer class="ch-footer"><p class="ch-feedback" role="status" aria-live="polite" data-feedback></p><small class="ch-muted">总览与岗位为实际数据 · 政策规划尚未产生收益</small></footer>`;
        panel.el.append(this.root);
        this.root.querySelector('[data-close]').onclick = () => panel.close();
        this.root.querySelector('[data-show-jobs]').onclick = () => this.switchTab('jobs', true);
        this.root.querySelectorAll('[data-tab]').forEach((button) => {
            button.onclick = () => this.switchTab(button.dataset.tab);
            button.onkeydown = (event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                this.switchTab(event.key === 'Home' ? 'overview' : event.key === 'End' ? 'jobs' : this.tab === 'overview' ? 'jobs' : 'overview', true);
            };
        });
        this.root.querySelector('[data-search]').oninput = () => this.update(true);
        this.root.querySelector('[data-filter]').onchange = (event) => { this.filter = event.target.value; this.update(true); };
        this.root.querySelector('[data-policies]').onclick = async () => {
            if (!this.isValid() || this.loadingPolicies) return;
            const building = this.building;
            const player = panel.player;
            const sceneId = this.sceneId;
            this.loadingPolicies = true;
            try {
                // Match the expedition modal's lazy import boundary; Input must not enter the building bootstrap chain.
                const { CityHallPolicyPanel } = await import('./city-hall-policy-panel.js');
                if (!panel.isOpen || panel.building !== building || !this.isLiveInScene(building, sceneId)) return;
                this.policyPanel = CityHallPolicyPanel;
                CityHallPolicyPanel.open(building, {
                    isValid: () => this.isLiveInScene(building, sceneId),
                    onReturn: () => { panel.openFor(building, player); this.root.querySelector('[data-policies]').focus({ preventScroll: true }); },
                });
            } catch (error) {
                this.text('feedback', `政策面板暂时无法打开：${error.message}`);
            } finally { this.loadingPolicies = false; }
        };
    }

    isLiveInScene(building, sceneId) {
        return SceneManager.currentScene === sceneId && live(building) && this.getBuildings().includes(building);
    }

    isValid() { return this.isLiveInScene(this.building, this.sceneId); }

    resetPolicy() { this.policyPanel?.reset(); }

    open(building) {
        const changed = this.lastBuildingId !== building.id || this.sceneId !== SceneManager.currentScene;
        this.building = building;
        this.sceneId = SceneManager.currentScene;
        this.lastBuildingId = building.id;
        if (changed) {
            this.tab = 'overview'; this.filter = 'all';
            this.root.querySelector('[data-search]').value = '';
            this.root.querySelector('[data-filter]').value = 'all';
            this.root.querySelector('.ch-scroll').scrollTop = 0;
        }
        this.text('feedback', '');
        this.switchTab(this.tab);
        this.update(true);
    }

    close() {
        this.rows.clear();
        this.root.querySelector('[data-jobs]').replaceChildren();
        this.root.querySelector('[data-building-header]').replaceChildren();
        this.headerKey = null;
        this.building = null;
    }

    text(key, value) {
        const element = this.root.querySelector(`[data-${key}]`);
        if (element && element.textContent !== String(value)) element.textContent = String(value);
    }

    switchTab(tab, focus = false) {
        this.tab = tab;
        this.root.querySelectorAll('[data-tab]').forEach((button) => {
            const selected = button.dataset.tab === tab;
            button.setAttribute('aria-selected', String(selected));
            button.tabIndex = selected ? 0 : -1;
            if (selected && focus) button.focus();
        });
        this.root.querySelectorAll('[data-page]').forEach((page) => { page.hidden = page.dataset.page !== tab; });
    }

    update(force = false) {
        if (!this.isValid()) { this.panel.close(); return; }
        const now = Date.now();
        const growthSnapshot = Population.getPopulationGrowthSnapshot();
        refreshPopulationGrowth(this.root, growthSnapshot);
        if (!force && now < this.nextUpdate) return;
        this.nextUpdate = now + 750;
        const building = this.building;
        const buildings = this.getBuildings().filter(live);
        const jobs = buildings.map((entry) => ({ building: entry, job: Population.getWorkerSnapshot(entry) })).filter((entry) => entry.job);
        const population = growthSnapshot;
        const vacancies = jobs.reduce((sum, entry) => sum + entry.job.freeSlots, 0);
        const tiers = building._cfg.buildingTiers || [];
        const tier = tiers.find((entry) => entry.level === building.level);
        this.text('world', `${SceneManager.scenes?.[this.sceneId]?.name || this.sceneId} · 玩家基地`);
        const texture = building.spriteCfg?.panelKey || building.spriteCfg?.idleKey || building._cfg.tex;
        const name = tier?.name || building._cfg.name || '市政大厅';
        const status = `玩家基地 · Lv.${building.level}/${building.maxLevel} · 本位面唯一`;
        const headerKey = `${texture}|${name}|${status}`;
        if (headerKey !== this.headerKey) {
            this.root.querySelector('[data-building-header]').innerHTML = renderBuildingDetailHeader({
                texture, name: escapeHtml(name), hp: building.hp, maxHp: building.maxHp, status,
            });
            this.headerKey = headerKey;
        }
        refreshBuildingDetailHeader(this.root, { hp: building.hp, maxHp: building.maxHp, status });
        this.text('description', building._cfg.panelDescription || '本位面的玩家基地，随住房科技推进时代形态。');
        this.text('defense', format(building.def));
        this.text('magic-defense', format(building.mdef));
        const growth = growthSnapshot.growth || {};
        this.text('food', format(EnergyManager.getFood())); this.text('energy', format(EnergyManager.getEnergy()));
        this.text('gold', format(GoldManager.getGold()));
        this.text('population', `${format(population.total)} / ${format(population.capacity)}`);
        this.text('population-free', `已用 ${format(population.used)} · 空闲 ${format(population.free)}${population.overcrowded ? ` · 超额 ${format(population.overcrowded)}` : ''}`);
        this.text('job-vacancies', `${format(vacancies)}`);
        this.text('job-empty', vacancies > 0 ? '有空位可调岗' : '岗位全部安排');
        const capacity = EnergyManager.getCapacity();
        const free = EnergyManager.getFreeCapacity();
        const used = EnergyManager.getWarehouses().reduce((sum, entry) => sum + EnergyManager.getWarehouseUsedCapacity(entry), 0);
        const storage = this.root.querySelector('[data-storage-bar]');
        storage.max = Math.max(1, capacity); storage.value = used;
        this.text('storage', `${format(used)} / ${format(capacity)} 容量 · 可用 ${format(free)}`);
        this.text('warehouse-count', `${EnergyManager.getWarehouseCount()} 座仓库`);
        this.text('economy-count', `${buildings.filter((entry) => entry._economyType).length} 座`);
        this.text('troop-count', `${buildings.filter((entry) => entry._isTroopProducer).length} 座`);
        const research = Population.getLiveResearchSummary(buildings);
        this.text('research', `${format(research.rate)} 点/秒 · ${research.count} 座设施`);
        this.text('efficiency', `${Math.round(Population.getLaborEfficiency() * 100)}%`);
        const empty = jobs.filter((entry) => entry.job.slots > 0 && entry.job.assigned === 0).length;
        const hasFoodShortage = population.total > 0 && growth.foodModifier < 0;
        const alerts = [
            vacancies ? `经济设施共有 ${vacancies} 个空缺岗位；可分配人口 ${population.free}。` : '现有经济岗位已全部安排。',
            empty ? `${empty} 座设施无人值守，可在岗位管理中逐座安排。` : '没有无人值守的岗位设施。',
            capacity <= 0 ? '本位面尚无可用仓储容量。' : free <= 0 ? '仓库已满，请扩容或使用库存。' : `仓库剩余 ${format(free)} 容量。`,
            hasFoodShortage ? `连续缺粮 ${growth.shortageCycles || 0} 次；${growth.starvation ? '人口正在流失，请恢复供粮。' : '增长减慢，请在下次结算前补足口粮。'}` : '',
            growth.housingModifier < 0
                ? '住房已满或不足提供−80%修正，与食物等修正相加后调整生成周期，不限制总人数；新建或升级房屋可解除住房减速。' : '',
        ].filter(Boolean);
        const alertsKey = alerts.join('|');
        if (this.alertsKey !== alertsKey) {
            this.root.querySelector('[data-alerts]').innerHTML = alerts.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('');
            this.alertsKey = alertsKey;
        }
        if (this.eraLevel !== building.level) {
            this.root.querySelector('[data-eras]').innerHTML = tiers.map((entry) => `<li${entry.level === building.level ? ' aria-current="step"' : ''}><b>LV${entry.level}</b><span>${escapeHtml(entry.name)}</span><small>${entry.level <= building.level ? '已达成' : '待科技解锁'}</small></li>`).join('');
            this.eraLevel = building.level;
        }
        const next = tiers.find((entry) => entry.level > building.level);
        this.text('next-era', next ? `完成「${TechnologySystem.getUnlockRequirementLabel('buildingTier', next.id)}」后自动升级为${next.name}，无需额外付费。` : '已达到现代形态；时代外观由全局科技同步。');
        this.text('job-summary', `空闲人口 ${population.free} · 空缺岗位 ${vacancies}`);
        this.renderJobs(jobs, population);
        const plan = normalizeCityHallPolicyPlan(building._cityHallPolicyPlan, building.level);
        this.text('plan-summary', `已保存模拟 ${plan.allocated.length} 项 / ${policyCost(plan.allocated)} 点 · 路线 ${plan.queue.length} 项${plan.queue[0] ? ` · 下一项：${POLICY_BY_ID.get(plan.queue[0]).name}` : ''}`);
    }

    renderJobs(entries, population) {
        const list = this.root.querySelector('[data-jobs]');
        const active = new Set(entries.map((entry) => entry.building));
        for (const [building, row] of this.rows) {
            if (active.has(building)) continue;
            if (row.contains(document.activeElement)) this.root.querySelector('[data-search]').focus();
            row.remove(); this.rows.delete(building);
        }
        const query = this.root.querySelector('[data-search]').value.trim().toLocaleLowerCase();
        let visible = 0;
        for (const { building, job } of entries) {
            let row = this.rows.get(building);
            if (!row) {
                row = document.createElement('article'); row.className = 'ch-job-row';
                row.innerHTML = '<div class="ch-job-heading"><h4 data-name></h4><span data-count></span></div><p class="ch-muted" data-description></p><div class="ch-job-actions"><button type="button" class="ch-button" data-job="minus">−1</button><button type="button" class="ch-button" data-job="plus">+1</button><button type="button" class="ch-button" data-job="max">补满</button><button type="button" class="ch-button" data-job="clear">全部撤岗</button></div>';
                row.onclick = (event) => {
                    const button = event.target.closest('[data-job]');
                    if (!button || button.disabled || !this.isValid() || !live(building) || !this.getBuildings().includes(building)) return;
                    const action = button.dataset.job;
                    const result = action === 'max' ? Population.assignMaxWorkers(building)
                        : action === 'clear' ? Population.setAssignedWorkers(building, 0)
                            : Population.adjustAssignedWorkers(building, action === 'plus' ? 1 : -1);
                    this.text('feedback', result.ok ? `${building.name || building._cfg.name}：已安排 ${result.assigned} / ${result.slots} 人。` : result.reason);
                    this.update(true);
                };
                this.rows.set(building, row); list.append(row);
            }
            const name = building.name || building._cfg?.name || building.cfgKey;
            const show = (!query || `${name} ${building.id}`.toLocaleLowerCase().includes(query))
                && (this.filter !== 'vacant' || job.freeSlots > 0) && (this.filter !== 'empty' || job.assigned === 0);
            if (!show && row.contains(document.activeElement)) this.root.querySelector('[data-filter]').focus();
            row.hidden = !show;
            if (show) visible++;
            row.querySelector('[data-name]').textContent = name;
            row.querySelector('[data-count]').textContent = `${job.assigned} / ${job.slots} ${job.label}`;
            row.querySelector('[data-description]').textContent = `编号 ${building.id} · ${job.assigned === 0 ? '无人值守' : job.freeSlots ? '有空缺' : '岗位满员'} · ${BuildingRoadSystem.getBuildingRoadInfo(building).connected ? '建筑接入道路' : '建筑未接入道路'}`;
            for (const button of row.querySelectorAll('[data-job]')) {
                const increase = ['plus', 'max'].includes(button.dataset.job);
                button.disabled = increase ? job.freeSlots <= 0 || population.free <= 0 : job.assigned <= 0;
                button.setAttribute('aria-label', `${name} ${building.id}：${button.textContent}`);
                button.title = button.disabled ? (increase ? job.freeSlots <= 0 ? '岗位已满' : '空闲人口不足' : '尚未安排人员') : '';
            }
        }
        this.root.querySelector('[data-empty]').hidden = visible > 0;
    }
}
