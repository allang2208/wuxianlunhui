import { EnergyManager } from '../systems/energy-manager.js';
import { PopulationEconomySystem as Population } from './population-economy-system.js';
import { WorldProgressionSystem as Progression } from './world-progression-system.js';
import { strategicCell, strategicDistance } from './world-map-cells.js';
import { strategicWalkable } from './strategic-terrain.js';
import { strategicNow } from './strategic-march.js';

// Civilian parties are persistent records, never troop copies or extra live scenes.
export const StrategicSettlers = {
    settler(id) { return this.state.settlers.find((unit) => unit.id === id); },
    settlerQuote(camp) {
        const cost = this.config.settlers, population = Population.getPopulationSnapshot();
        let reason = this.departureBlockReason(camp);
        const base = !reason && this.baseEntry(window.SceneManager.currentScene);
        if (!reason) reason = !base ? '当前基地没有有效地图入口。' : this.baseEntryBlockReason(base);
        if (!reason && this.state.settlers.length >= cost.maxTeams) reason = `在途移民队最多 ${cost.maxTeams} 支。`;
        if (!reason && population.free < cost.population) reason = `需要 ${cost.population} 名空闲居民，当前 ${population.free} 名；可先撤回岗位人员。`;
        if (!reason && EnergyManager.getFood() < cost.food) reason = `粮食不足，需要 ${cost.food}。`;
        if (!reason && EnergyManager.getEnergy() < cost.energy) reason = `能量不足，需要 ${cost.energy}。`;
        return { ok: !reason, reason, population: cost.population, food: cost.food, energy: cost.energy,
            free: population.free, total: population.total, base };
    },
    dispatchSettler(camp) {
        const quote = this.settlerQuote(camp);
        if (!quote.ok) return quote;
        // Initialize before payment. No async boundary may split population/resources/party creation.
        this.ensureCampaign();
        const reservation = Population.reserveMigrationResidents(quote.population);
        if (!reservation.ok) return reservation;
        if (!EnergyManager.deductResources(quote, { notify: false })) {
            reservation.rollback();
            return { ok: false, reason: '库存已变化，未组建移民队；人口和资源均未扣除。' };
        }
        const id = `settler_${this.state.nextId++}`;
        const unit = { id, kind: 'settler', name: `移民队 ${id.split('_')[1]}`, population: reservation.population,
            cellId: quote.base.cellId, originSceneId: quote.base.sceneId, originEpoch: quote.base.worldEpoch,
            originCellId: quote.base.cellId, route: [], waypoints: [], order: 'hold',
            provisions: { food: quote.food, energy: quote.energy },
            orderNote: '准备迁居；右键行军，停稳后选择建立城市。' };
        this.state.settlers.push(unit);
        // A HUD failure occurs after the complete transfer, never between payment and party creation.
        try { EnergyManager._notifyUpdate(); } catch (_) { /* HUD will refresh on its next tick. */ }
        this._invasionReconCache = null;
        if (!this.state.initialized) {
            Object.keys(this.config.enemyTypes).forEach((type) => this.spawnEnemy(type)); this.state.initialized = true;
        }
        this.ensureSignalGuards();
        this.recordEvent('arrival', `${unit.name}已组建`, `${unit.population} 名居民迁出；${quote.food} 粮食与 ${quote.energy} 能量用于旅装和建城，不会在建城时再次扣费。`, { armyId: id, cellId: unit.cellId });
        return { ok: true, id };
    },
    previewSettlerOrder(id, cellId, { append = false } = {}) {
        const unit = this.settler(id), cell = strategicCell(cellId);
        const order = { action: 'move', cellId, label: '移民队行军', allowHostileTarget: false };
        let reason = !unit || !cell ? '移民队或目标地格无效。' : '';
        if (!reason && this.supportCommandBlocked()) reason = '切场期间不能下令。';
        if (!reason && !strategicWalkable(cell)) reason = '山脉不可通行，请走山口。';
        const waypoints = append && unit?.destination && unit.order === 'move' ? [...(unit.waypoints || []), unit.destination] : [];
        if (!reason && waypoints.length >= this.config.march.maxRouteStops) reason = '途经点数量已达上限。';
        const estimate = !reason && this._supportRoute(unit, cellId, false, waypoints);
        if (!reason && !estimate) reason = '路线被地形、敌军或战事阻断；移民队不能主动接战。';
        return { ok: !reason, reason, order, waypoints, route: estimate?.route || [], stops: estimate?.stops || [], durationMs: estimate?.durationMs || 0 };
    },
    orderSettler(id, cellId, options = {}) {
        const preview = this.previewSettlerOrder(id, cellId, options);
        if (!preview.ok) return preview;
        const unit = this.settler(id);
        Object.assign(unit, { route: preview.route, waypoints: preview.waypoints, destination: cellId,
            order: 'move', mapStatus: null, routeIssuedAt: strategicNow(), orderNote: '迁居行军中；费用已含旅装与建城物资。' });
        this._prepareSettler(unit, strategicNow());
        return { ok: true };
    },
    haltSettler(id) {
        if (this.supportCommandBlocked()) return { ok: false, reason: '切场期间不能下令。' };
        const unit = this.settler(id);
        if (!unit) return { ok: false, reason: '移民队已离场。' };
        Object.assign(unit, { destination: unit.march?.toCellId || unit.cellId, route: unit.march ? [unit.march.toCellId] : [],
            waypoints: [], order: unit.march ? 'move' : 'hold', orderNote: '当前路段结束后停驻。' });
        return { ok: true };
    },
    _settlerDanger(cellId) {
        return this.state.enemies.some((enemy) => enemy.cellId === cellId)
            || this.state.sites.some((site) => site.cellId === cellId && site.owner === 'enemy' && site.status === 'active')
            || this.getWars().some((war) => war.cellId === cellId) || this.state.encounter?.cellId === cellId;
    },
    _contactSettlers(cellId, now) {
        if (!this._settlerDanger(cellId)) return;
        for (const unit of this.state.settlers) {
            if (unit.cellId !== cellId || unit.march || unit.mapStatus === 'blocked') continue;
            Object.assign(unit, { route: [], waypoints: [], destination: null, order: 'hold', mapStatus: 'blocked', mapStatusAt: now,
                orderNote: '遭遇敌军或战事，迁居暂停；请调兵清除威胁或向安全地格撤离。' });
            this.recordEvent('blocked', `${unit.name}遇敌停驻`, unit.orderNote, { armyId: unit.id, cellId });
        }
    },
    _prepareSettler(unit, now) {
        if (unit.march) return;
        while (unit.waypoints?.length && unit.waypoints[0] === unit.cellId) unit.waypoints.shift();
        if (unit.order !== 'move' || !unit.destination) { this._contactSettlers(unit.cellId, now); return; }
        if (unit.cellId === unit.destination && !unit.waypoints.length) {
            Object.assign(unit, { order: 'hold', route: [], mapStatus: 'arrived', mapStatusAt: now,
                orderNote: '移民队已抵达；符合选址条件即可建立城市。' });
            this._contactSettlers(unit.cellId, now);
            this.recordEvent('arrival', `${unit.name}已抵达`, unit.orderNote, { armyId: unit.id, cellId: unit.cellId });
            return;
        }
        const estimate = this._supportRoute(unit, unit.destination, false, unit.waypoints || []);
        if (!estimate?.route.length) {
            unit.route = []; unit.order = 'hold'; unit.mapStatus = 'blocked'; unit.mapStatusAt = now;
            unit.orderNote = '前路受阻，移民队停驻；请重新选择安全路线。'; return;
        }
        unit.route = estimate.route;
        this._startMarch(unit, unit.route[0], Math.max(now, unit.routeIssuedAt || 0));
    },
    foundingStatus(id, cellId = this.settler(id)?.cellId, { preview = false } = {}) {
        const unit = this.settler(id), cell = strategicCell(cellId), minDistance = this.config.settlers.minCityDistance;
        let reason = !unit || !cell ? '请先选择移民队和有效地格。' : '';
        if (!reason && this.supportCommandBlocked()) reason = '切场期间不能建立城市。';
        if (!reason && !preview && (unit.march || unit.order === 'move' || unit.cellId !== cellId)) reason = '移民队必须抵达并停稳后建城。';
        if (!reason && (!strategicWalkable(cell) || cell.mountain || cell.pass)) reason = '山脉或山口不能建设城市。';
        const sites = this.getSettlements();
        const recoverySite = sites.find((site) => site.cellId === cellId
            && site.kind === 'world' && site.status === 'destroyed');
        if (!reason && sites.some((site) => site.cellId === cellId && site !== recoverySite)) {
            reason = '该格已有城市、营地或废墟，不能重叠建设。';
        }
        if (!reason && this._settlerDanger(cellId)) reason = '该格有敌军或战事，暂不能建城。';
        // Towns on both sides count; an outpost only occupies its own cell. Reserve future plane capitals as well.
        const centers = sites.filter((site) => site.status !== 'destroyed' && ['town', 'world'].includes(site.kind))
            .map((site) => strategicCell(site.cellId));
        for (const sceneId of Progression.getWorldIds()) {
            if (sceneId !== recoverySite?.sceneId) {
                centers.push(strategicCell(Progression.getReservedWorldMapCell(sceneId)?.cellId));
            }
        }
        const nearest = cell ? centers.filter(Boolean).reduce((distance, center) => Math.min(distance, strategicDistance(cell, center)), Infinity) : Infinity;
        if (!reason && !recoverySite && nearest < minDistance) {
            reason = `距城市或预留位面城址仅 ${nearest} 格，至少需要 ${minDistance} 格。`;
        }
        return { ok: !reason, reason, nearest, minDistance, cellId,
            recoverySceneId: recoverySite?.sceneId || null };
    },
    foundCity(id) {
        const status = this.foundingStatus(id);
        if (!status.ok) return status;
        const unit = this.settler(id), cell = strategicCell(unit.cellId), cfg = this.config.settlers;
        if (status.recoverySceneId) {
            const restored = Progression.restoreWorldWithSettler(status.recoverySceneId, {
                cellId: cell.id,
                population: unit.population,
            });
            if (!restored.ok) return restored;
            this.state.settlers = this.state.settlers.filter((item) => item !== unit);
            Progression.setStrategicSiteCells(this.state.sites); this._invasionReconCache = null;
            const name = Progression.getWorldConfig(status.recoverySceneId)?.name || status.recoverySceneId;
            this.recordEvent('arrival', `${name}重新定居`, `${unit.population} 名移民在旧城址重建市政厅；传送门需完成位面门工程后另行建造。`, { cellId: cell.id });
            this.notify(`${name}已由移民恢复 · 市政厅落成`);
            return { ok: true, restoredWorld: true, sceneId: status.recoverySceneId, cellId: cell.id };
        }
        const cityId = `settler_city_${this.state.nextId++}`;
        const site = { id: cityId, kind: 'town', foundedBy: 'settler', name: `新城 ${cityId.split('_').at(-1)}`,
            sceneId: cell.planeSceneId, cellId: cell.id, owner: 'player', status: 'active', generation: 1,
            population: unit.population, originSceneId: unit.originSceneId, foundedAt: strategicNow(),
            structures: cfg.cityStructures.map((structure) => ({ ...structure, maxHp: structure.hp })),
            roster: [], garrisonVersion: this.config.siege.rangedDefenders.version, lastSpawnTick: this.state.tick };
        // One synchronous ownership transfer. A second click cannot find the consumed party.
        this.state.sites.push(site);
        this.state.settlers = this.state.settlers.filter((item) => item !== unit);
        Progression.setStrategicSiteCells(this.state.sites); this._invasionReconCache = null;
        this.recordEvent('arrival', `${site.name}建立`, `${site.population} 名移民定居；旅装与建城物资已使用，未再次扣费。城防加入战略围城结算。`, { cellId: cell.id });
        this.notify(`${site.name}已建立 · ${site.population} 名居民`);
        return { ok: true, id: cityId, cellId: cell.id };
    },
    _restoreSettlers(now = strategicNow()) {
        const ids = new Set();
        this.state.settlers = (Array.isArray(this.state.settlers) ? this.state.settlers : []).filter((unit) => {
            if (!unit?.id || ids.has(unit.id) || !(unit.population > 0)) return false;
            ids.add(unit.id); return true;
        });
        for (const unit of this.state.settlers) {
            unit.kind = 'settler'; unit.population = Math.max(1, Math.floor(unit.population));
            unit.routeIssuedAt = Number.isFinite(unit.routeIssuedAt) ? Math.max(0, Math.min(now, unit.routeIssuedAt)) : 0;
            unit.cellId = strategicCell(unit.cellId)?.id || strategicCell(unit.originCellId)?.id || this.baseEntry(unit.originSceneId)?.cellId;
            const valid = Array.isArray(unit.route) && unit.route.every((id) => strategicCell(id))
                && Array.isArray(unit.waypoints) && unit.waypoints.length < this.config.march.maxRouteStops
                && unit.waypoints.every((id) => strategicCell(id)) && (!unit.destination || strategicCell(unit.destination));
            if (!valid) {
                Object.assign(unit, { route: [], waypoints: [], destination: null, order: 'hold',
                    orderNote: '已取消无效路线；移民人数保留，请重新下令。' });
            }
        }
        const largestId = [...this.state.settlers, ...this.state.sites].reduce((max, unit) => Math.max(max, Number(unit.id?.split('_').at(-1)) || 0), 0);
        this.state.nextId = Math.max(this.state.nextId, largestId + 1);
    },
};
