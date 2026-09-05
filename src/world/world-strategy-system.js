// One live player-led encounter; detached armies and supply convoys remain strategic records.
import config from '../../data/world-strategy.json';
import { WorldProgressionSystem as Progression } from './world-progression-system.js';
import { TroopLineSystem as Troops } from './troop-line-system.js';
import { WORLD_MAP_PLANES, worldMapInfo, worldMapPlaneCells, strategicCell, strategicNeighbors, strategicDistance } from './world-map-cells.js';
import { MinHeap } from '../utils/min-heap.js';
import { StrategicCampaign } from './world-strategy-campaign.js';
import { StrategicJournal } from './world-strategy-journal.js';
import { StrategicInvasionMarch } from './strategic-invasion-march.js';
import { StrategicLogistics } from './strategic-logistics.js';
import { StrategicPlayerArmies } from './strategic-player-armies.js';
import { StrategicSettlers } from './strategic-settlers.js';
import { StrategicMapIntel } from './strategic-map-intel.js';
import { strategicNow, strategicStepMs, strategicRoute, strategicMarchStatus, strategicRouteEstimate, strategicMarchMultiplier } from './strategic-march.js';

export const STRATEGY_MAP_SCENE = 'strategy_map';
export const STRATEGY_BATTLE_SCENE = 'strategy_battle';
const clone = (value) => JSON.parse(JSON.stringify(value));
const game = () => window.Game;
const manager = () => window.SceneManager;
const initial = () => ({ version: 5, initialized: false, campaignInitialized: false, seed: (worldMapInfo().seed ^ 0x9e3779b9) >>> 0 || 12283031,
    nextId: 1, tick: 0, enemies: [], sites: [], sieges: [], pendingLoot: [], pendingLootClaimId: null, army: null, detachments: [], convoys: [], settlers: [],
    mapIntel: null, encounter: null, lastResult: '', events: [], nextEventId: 1 });

export const WorldStrategySystem = {
    ...StrategicCampaign,
    ...StrategicJournal,
    ...StrategicInvasionMarch,
    ...StrategicLogistics,
    ...StrategicPlayerArmies,
    ...StrategicSettlers,
    ...StrategicMapIntel,
    config,
    state: initial(),
    _accumulator: 0,
    _arrivalQueue: new MinHeap((a, b) => a.due - b.due || a.order - b.order),
    _arrivalSequence: 0,
    _idleDecisions: new Map(),
    _busy: false,
    _transitionTarget: null,
    _battle: null,
    _pendingBattleReturn: null,

    reset() { this.state = initial(); this._resetMarchScheduler(); this._invasionReconCache = null; this._observedWars = null;
        this._mapVisibleCells = this._mapExploredCells = null; this._mapVisibleSignature = this._mapExploredSignature = null; this._mapIntelRevision = 0;
        Progression.setStrategicSiteCells([]); this._accumulator = 0; this._busy = false; this._transitionTarget = null; this._pendingBattleReturn = null; this._battle?.hideHud(); this._battle?.clearResult(); this.announceJournalRestore(); },
    get active() { return !!this.state.army; },
    get inBattle() { return this.active && manager()?.currentScene === STRATEGY_BATTLE_SCENE; },
    get inMap() { return this.active && manager()?.currentScene === STRATEGY_MAP_SCENE; },
    notify(text, options = {}) { manager()?.showTopNotification(text, options); },
    snapshot() { return clone(this.state); },
    troopCount() { return Troops.serializeStrategicTroops().reduce((total, record) => total + record.count, 0); },
    troopSummary() {
        return Troops.serializeStrategicTroops().reduce((summary, record) => {
            summary.total += record.count;
            if (record.hpRatio < 1) summary.wounded += record.count;
            return summary;
        }, { total: 0, wounded: 0 });
    },
    serialize() { this._reconcileCampaignWars(); this._settleSupply(); this.refreshMapIntel(); return this.snapshot(); },

    claimLoot() {
        if (this._busy || this.inBattle || manager()?.isLoading) return;
        const delivery = game()?.PlayerRewardDelivery;
        if (!delivery || !this.state.pendingLoot.length) return;
        const items = clone(this.state.pendingLoot);
        const sourceId = this.state.pendingLootClaimId || `strategy-loot:${this.state.nextId++}`;
        this.state.pendingLootClaimId = sourceId;
        try {
            const result = delivery.deliver(items, {
                sourceId,
                title: '军团远征战利品',
                deferDuringRun: false,
            });
            this.state.pendingLoot = [];
            this.state.pendingLootClaimId = null;
            const delivered = result.backpack + result.warehouse;
            this.notify(`军团战利品已结算：${delivered} 项进入背包/仓库${result.mailed ? `，${result.mailed} 项进入奖励信箱` : ''}`);
            return { ok: true, ...result };
        } catch (error) {
            this.notify(`军团战利品领取失败，原清单已保留：${error.message}`, { tone: 'danger' });
            return { ok: false, reason: error.message };
        }
    },

    random() {
        let seed = this.state.seed | 0;
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        this.state.seed = seed >>> 0;
        return (seed >>> 0) / 4294967296;
    },

    departureBlockReason(camp) {
        const m = manager(), g = game();
        if (this.active || this._busy) return '已有亲征军团，请先撤军返回';
        if (m.isLoading || g._observerMode || m.isDungeonRunActive() || m.isQuestInstance()) return '请在本体所在的建设位面出征，先结束地牢、观察或调查';
        if (!g.player || g.player._isDead || g.player.data.hp <= 0) return '角色当前无法出征';
        if (!Progression.getWorldConfig(m.currentScene) || !Progression.isPortalConstructed(m.currentScene)) return '请先进入已接通位面建造指挥所';
        if (!camp || camp.cfgKey !== config.campId || camp.active === false || camp.hp <= 0 || camp._sinking
            || !g.ProducerBuildingSystem?.buildings?.includes(camp)) return '需要当前位面一座建成且存活的指挥建筑（指挥所、司令部或国防部）';
        return '';
    },

    currentCamp() { return game()?.ProducerBuildingSystem?.buildings?.find((b) => b.cfgKey === config.campId && b.active !== false && b.hp > 0 && !b._sinking); },
    candidates() {
        return {
            troops: Troops.getStrategicCandidates(),
            companions: (game()?.PartySystem?.members || []).filter((member) => member.active !== false && member.data?.hp > 0 && !member._strategicArmyId),
        };
    },

    async depart(camp, troopIds, companionIds) {
        const reason = this.departureBlockReason(camp);
        if (reason) return { ok: false, reason };
        const selection = this.candidates();
        troopIds = [...new Set(troopIds)]; companionIds = [...new Set(companionIds)];
        if (troopIds.length > config.maxTroops) return { ok: false, reason: `本军团最多携带 ${config.maxTroops} 名士兵` };
        if (troopIds.some((id) => !selection.troops.some((unit) => unit.id === id))
            || companionIds.some((id) => !selection.companions.some((unit) => unit.id === id))) return { ok: false, reason: '选中的单位已离场或阵亡，请刷新编组' };
        const origin = manager().currentScene;
        const entry = Progression.getWorldMapDiscovery(origin);
        if (!entry?.cell) return { ok: false, reason: '当前位面尚无有效大地图入口' };
        Troops.rememberCompanionResidencies(origin);
        const reservation = this.reserveSupply(origin, this.supplyQuote(1 + troopIds.length + companionIds.length));
        if (!reservation.ok) return reservation;
        // Confirmation is the only boundary that removes soldiers from their producer.
        if (!Troops.packStrategicTroops(troopIds)) { reservation.rollback(); return { ok: false, reason: '编组已变化，未开始出征' }; }
        const army = this.state.army = {
            id: `player_army_${this.state.nextId++}`, name: '亲征军团', cellId: entry.cellId,
            originSceneId: origin, originEpoch: Progression.getWorldEpoch(origin), originCellId: entry.cellId,
            originPoint: { x: game().player.x, y: game().player.y }, companionIds,
            supply: { food: reservation.food, lastAt: strategicNow(), fraction: 0 },
            route: [], waypoints: [], order: 'hold', graceUntil: this.state.tick + config.encounterGraceTicks,
        };
        Troops.setStrategicCompanions(companionIds, STRATEGY_MAP_SCENE, null, army.id);
        this._busy = true;
        try {
            await this._switch(STRATEGY_MAP_SCENE);
            this.ensureCampaign();
            if (!this.state.initialized) {
                Object.keys(config.enemyTypes).forEach((type) => this.spawnEnemy(type));
                this.state.initialized = true;
            }
            this.ensureSignalGuards();
            await this.openMap();
            return { ok: true };
        } catch (error) {
            // SceneManager restores the origin scene before returning a loading failure.
            Troops.releaseStrategicTroops(origin, army.originPoint);
            Troops.setStrategicCompanions(companionIds, origin, army.originPoint);
            game().player.active = true;
            this._returnArmyFood(army, { sceneId: origin, cellId: army.originCellId, worldEpoch: army.originEpoch });
            this.state.army = null;
            await this._refreshReturnedAssets();
            return { ok: false, reason: `出征未完成，部队已退回原位面：${error.message}` };
        } finally { this._busy = false; }
    },

    canSwitchScene(sceneId, opts) {
        if (!this.active) return ![STRATEGY_MAP_SCENE, STRATEGY_BATTLE_SCENE].includes(sceneId);
        return this._transitionTarget === sceneId && opts.strategyTravel === this.state.army.id
            && (!opts.strategyBaseEntry || (opts.strategyBaseEntry.sceneId === sceneId && !this.baseEntryBlockReason(opts.strategyBaseEntry)));
    },
    async _switch(sceneId, forceReload = false, strategyRestore = false, strategyBaseEntry = null) {
        this._transitionTarget = sceneId;
        try {
            const switched = await manager().switchScene(sceneId, game().player, undefined,
                { strategyTravel: this.state.army.id, forceReload, strategyRestore, strategyBaseEntry });
            if (!switched) throw new Error('场景切换未完成');
        } finally { this._transitionTarget = null; }
    },

    async loadScene(sceneId, player) {
        this._battle ||= (await import('./strategic-encounter.js')).StrategicEncounter;
        await this._battle.load(sceneId, player, this.state);
    },
    async openMap() {
        try {
            const { WorldSwitchPanel } = await import('../ui/world-switch-panel.js');
            WorldSwitchPanel.open(strategicCell(this.state.army?.cellId)?.planeSceneId);
        } catch (error) {
            // UI errors after a committed scene transition must never replay the troop transfer.
            this.notify(`军团仍保留在当前格，地图界面未打开，请按 O 重试：${error.message}`);
        }
    },

    async _refreshReturnedAssets() {
        try {
            const { RuntimeAssetManager } = await import('../phaser/assets/runtime-asset-manager.js');
            await RuntimeAssetManager.ensureFriendlyEntities(game().friendlyUnits);
            RuntimeAssetManager.commitFriendlyEntities(game().friendlyUnits, game().ProducerBuildingSystem?.getActiveVisualUnitIds?.() || []);
        } catch (error) {
            this.notify(`部队已归队，但部分贴图未加载：${error.message}`);
        }
    },

    hostileCells() {
        const occupied = new Set(this.getVisibleEnemies().map((enemy) => enemy.cellId));
        for (const site of this.state.sites) {
            if (site.owner === 'enemy' && site.status === 'active') occupied.add(site.cellId);
        }
        for (const war of this.getWars()) occupied.add(war.cellId);
        return occupied;
    },

    mapOrder(cellId, enemyId = null) {
        if (!strategicCell(cellId)) return null;
        const enemy = this.getMapVisibleEnemies().find((item) => enemyId ? item.id === enemyId : item.cellId === cellId);
        if (enemy) return { action: 'pursue', targetId: enemy.id, cellId: enemy.cellId, label: '追击并接战', allowHostileTarget: true };
        const site = this.getMapSettlements().find((item) => item.cellId === cellId);
        if (site?.owner === 'enemy' && site.status === 'active') {
            return { action: 'destroy', targetId: site.id, cellId, label: '行军摧毁', allowHostileTarget: true };
        }
        const war = this.getMapWars().find((item) => item.cellId === cellId);
        if (war) return { action: 'relieve', targetId: war.id, cellId, label: '行军解围', allowHostileTarget: true };
        if (site?.kind === 'world' && site.owner === 'player' && site.status === 'active') {
            return { action: 'enter', targetId: site.sceneId, cellId,
                label: this.state.army?.cellId === cellId && !this.state.army?.march ? '进入基地' : '行军并入营' };
        }
        return { action: 'move', cellId, label: '行军至目标格' };
    },

    issueMapOrder(cellId, enemyId = null, { append = false } = {}) {
        const preview = this.previewMapOrder(cellId, enemyId, { append });
        if (!preview.ok) return { ok: false, reason: preview.reason };
        const { order, waypoints } = preview, options = { waypoints };
        let result;
        if (order.action === 'pursue') result = this.pursueEnemy(order.targetId, options);
        else if (order.action === 'destroy') result = this.attackSettlement(order.targetId, 'destroy', options);
        else if (order.action === 'relieve') result = this.relieveWar(order.targetId, options);
        else if (order.action === 'enter') result = this.orderBaseEntry(order.targetId, options);
        else result = this.moveTo(order.cellId, options);
        if (result.ok && waypoints.length) this.state.army.orderNote = `依次通过${waypoints.length}个途经点，终点${order.label}。接战或受阻时取消后续计划。`;
        return result;
    },

    previewMapOrder(cellId, enemyId = null, { append = false } = {}) {
        // Read-only: hover must never select, move, create an army or reserve a base.
        const order = this.mapOrder(cellId, enemyId);
        let reason = !order ? '请选择有效的六边格目标' : '';
        if (enemyId && !this.getMapVisibleEnemies().some((enemy) => enemy.id === enemyId)) reason = '目标敌军已离开当前视野，请重新侦察。';
        else if (!reason && !this.active) reason = '尚未出征：请先在指挥建筑中编组。';
        else if (!reason && (!this.inMap || this._busy || manager().isLoading)) reason = '正在战斗或切换场景，暂不可下令。';
        else if (!reason && this.state.army.defeated) reason = '亲征已失败，请撤回主神空间。';
        else if (!reason && order.action === 'enter') reason = this.baseEntryBlockReason(this.baseEntry(order.targetId));
        const army = this.state.army, waypoints = append ? this.routeStops() : [];
        if (!reason && append && waypoints.length) {
            if (army.entryTarget || army.pursueId || army.targetId || army.reliefWarId || army.allowHostileTarget) {
                reason = '攻击或入营已经是路线终点，不能在其后追加；请普通右键重新规划，或在途经点列表提前结束。';
            } else if (waypoints[waypoints.length - 1] === order.cellId) reason = '该格已经是路线终点，无需重复追加。';
        }
        if (!reason && waypoints.length >= config.march.maxRouteStops) reason = `最多安排${config.march.maxRouteStops}站（含终点），请先完成或删减现有路线。`;
        const estimate = !reason && this.estimateTravel(order.cellId, { allowHostileTarget: !!order.allowHostileTarget, waypoints });
        if (!reason && !estimate) reason = '没有避开其他敌军、敌城和战事的可达路线。';
        return { ok: !reason, reason, order, append, waypoints, route: estimate?.route || [],
            stops: estimate?.stops || [], durationMs: estimate?.durationMs || 0 };
    },

    routeStops() {
        const army = this.state.army;
        if (!army || !(army.march || army.route.length || army.waypoints?.length || army.entryTarget || army.pursueId || army.reliefWarId)) return [];
        const destination = this.getMapVisibleEnemies().find((enemy) => enemy.id === army.pursueId)?.cellId
            || army.entryTarget?.cellId || army.destination || army.route[army.route.length - 1];
        return destination ? [...(army.waypoints || []), destination] : [];
    },
    routePlanKey() { return `${this.state.army?.id || ''}:${this.routeStops().join(';')}`; },
    estimateCurrentRoute() {
        const stops = this.routeStops();
        if (!stops.length) return null;
        return this.estimateTravel(stops[stops.length - 1], { waypoints: stops.slice(0, -1), allowHostileTarget: !!this.state.army.allowHostileTarget });
    },
    truncateRouteAfter(index, expectedPlan) {
        const stops = this.routeStops();
        if (expectedPlan !== this.routePlanKey()) return { ok: false, reason: '行军队列已经变化，请按当前列表重新选择。' };
        if (!Number.isInteger(index) || index < 0 || index >= stops.length - 1) return { ok: false, reason: '该站之后已无可删除的节点。' };
        const result = this.moveTo(stops[index], { waypoints: stops.slice(0, index) });
        if (result.ok) this.state.army.orderNote = `已删除第${index + 1}站之后的计划；抵达该站后待命，当前路段仍须走完。`;
        return result;
    },

    moveTo(cellId, { allowHostileTarget = false, waypoints = [] } = {}) {
        if (!this.inMap || this._busy || manager().isLoading) return { ok: false, reason: '当前不能下达行军指令' };
        if (this.state.army.defeated) return { ok: false, reason: '亲征已经失败，请点击撤回主神空间' };
        const estimate = this.estimateTravel(cellId, { allowHostileTarget, waypoints });
        if (!estimate) return { ok: false, reason: '没有避开已知敌军、敌城和战事的可达路线；可明确选择敌方目标进攻' };
        const army = this.state.army;
        army.route = estimate.route;
        army.waypoints = [...waypoints];
        army.routeIssuedAt = strategicNow();
        army.destination = cellId;
        army.allowHostileTarget = allowHostileTarget;
        army.order = army.route.length ? 'move' : 'hold';
        army.mapStatus = army.route.length ? 'moving' : 'hold';
        army.targetId = null; army.pursueId = null; army.reliefWarId = null; army.entryTarget = null;
        army.disposition = 'destroy';
        army.orderNote = army.route.length ? '行军指令已下达；沿途绕开已知敌方占格，移动中的敌军仍可能拦截。' : '已在目标格待命。';
        this._startMarch(army, army.route[0], army.routeIssuedAt);
        return { ok: true };
    },
    halt() {
        if (!this.inMap || this._busy || manager().isLoading) return { ok: false, reason: '当前不能停止行军' };
        const army = this.state.army;
        army.destination = army.march?.toCellId || army.cellId;
        army.route = army.march ? [army.march.toCellId] : [];
        army.waypoints = [];
        army.order = army.march ? 'move' : 'hold';
        army.mapStatus = army.march ? 'moving' : 'hold';
        army.targetId = null; army.pursueId = null; army.reliefWarId = null; army.entryTarget = null;
        army.allowHostileTarget = false;
        army.orderNote = army.march ? '已取消后续路线，走完当前路段后停止。' : '军团已停止行军。';
        return { ok: true };
    },
    marchStatus(unit = this.state.army) { return strategicMarchStatus(unit); },
    estimateTravel(cellId, { allowHostileTarget = false, waypoints = [] } = {}) {
        const target = strategicCell(cellId);
        if (!this.state.army || !target) return null;
        if (!Array.isArray(waypoints) || waypoints.length >= config.march.maxRouteStops || waypoints.some((id) => !strategicCell(id))) return null;
        const blocked = this.mapHostileCells();
        const allowed = (cell, final) => (final && allowHostileTarget && cell.id === cellId) || !blocked.has(cell.id);
        const cacheKey = JSON.stringify([allowHostileTarget ? cellId : null, [...blocked].sort()]);
        return strategicRouteEstimate(this.state.army, cellId, allowed, waypoints, cacheKey);
    },

    baseEntry(sceneId) {
        if (!Progression.getWorldConfig(sceneId) || !Progression.isPortalConstructed(sceneId)) return null;
        const entry = Progression.getWorldMapDiscovery(sceneId);
        return entry?.cell ? { sceneId, cellId: entry.cellId, worldEpoch: Progression.getWorldEpoch(sceneId) } : null;
    },
    baseEntryBlockReason(target) {
        const current = target && this.baseEntry(target.sceneId);
        if (!current || current.worldEpoch !== target.worldEpoch || current.cellId !== target.cellId) {
            return '目标基地已失效或重建，入营指令已取消；请重新选择有效基地。';
        }
        if (this.hostileCells().has(target.cellId)) return '目标基地正在交战或有敌军驻留，请先解围再入营。';
        return '';
    },
    orderBaseEntry(sceneId, { waypoints = [] } = {}) {
        const target = this.baseEntry(sceneId);
        const reason = this.baseEntryBlockReason(target);
        if (reason) return { ok: false, reason };
        const result = this.moveTo(target.cellId, { waypoints });
        if (result.ok) {
            this.state.army.entryTarget = target;
            this.state.army.orderNote = `前往${Progression.getWorldConfig(sceneId).name}，抵达信标后自动入营；幸存部队在基地落点附近待命。`;
        }
        return result;
    },
    _contactBaseEntry() {
        const army = this.state.army, target = army?.entryTarget;
        if (!target || army.march || army.route.length || army.waypoints?.length || army.cellId !== target.cellId) return false;
        const reason = this.baseEntryBlockReason(target);
        if (reason) {
            army.entryTarget = null; army.orderNote = reason; army.mapStatus = 'blocked';
            this.recordEvent('blocked', '基地入营已取消', reason, { cellId: army.cellId });
            this.notify(reason); return false;
        }
        this._returnToWorld(target.sceneId, target);
        return true;
    },

    _startMarch(unit, nextCellId, now) {
        if (!nextCellId || !strategicNeighbors(unit.cellId).some((cell) => cell.id === nextCellId)) {
            unit.march = null;
            return;
        }
        // Reissuing the same next edge must not reset progress or grant free travel.
        if (unit.march?.fromCellId === unit.cellId && unit.march.toCellId === nextCellId) return;
        unit.march = { fromCellId: unit.cellId, toCellId: nextCellId, startedAtGameTimeMs: now,
            durationGameMs: strategicStepMs(strategicCell(unit.cellId), strategicCell(nextCellId)) * strategicMarchMultiplier(unit) };
    },

    _preparePlayerMarch(now) {
        const army = this.state.army;
        if (!this.inMap || !army || army.defeated) return;
        if (army.march) return; // Finish the current edge before updating a pursuit route.
        while (army.waypoints?.length && army.waypoints[0] === army.cellId) army.waypoints.shift();
        if (!army.route.length && !army.waypoints?.length && !army.pursueId && !army.entryTarget) return;
        if (army.entryTarget) {
            const reason = this.baseEntryBlockReason(army.entryTarget);
            if (reason) {
                this.halt(); army.orderNote = reason; army.mapStatus = 'blocked';
                this.recordEvent('blocked', '基地入营已取消', reason, { cellId: army.cellId });
                this.notify(reason); return;
            }
        }
        if (army.pursueId) {
            const target = this.getMapVisibleEnemies().find((enemy) => enemy.id === army.pursueId);
            if (target) army.destination = target.cellId;
            else {
                this.halt(); army.orderNote = '追击目标已离开当前视野，军团就地待命。';
                this.recordEvent('target_lost', '追击目标脱离视野', army.orderNote, { cellId: army.cellId }); return;
            }
        }
        if (army.reliefWarId && !this.getWars().some((war) => war.id === army.reliefWarId)) {
            this.halt(); army.orderNote = '目标战事已结束，军团就地待命。';
            this.recordEvent('target_lost', '解围命令已结束', army.orderNote, { cellId: army.cellId }); return;
        }
        const destination = army.destination || army.route[army.route.length - 1];
        if (destination && (destination !== army.cellId || army.waypoints?.length)) {
            const estimate = this.estimateTravel(destination, { allowHostileTarget: army.allowHostileTarget ?? true, waypoints: army.waypoints || [] });
            if (!estimate) {
                this.halt(); army.orderNote = '前路被敌方占格阻断，军团已停止；请选择新路线或明确进攻目标。';
                army.mapStatus = 'blocked';
                this.recordEvent('blocked', '行军路线受阻', army.orderNote, { cellId: army.cellId });
                this.notify(army.orderNote); return;
            }
            army.route = estimate.route;
        } else {
            army.route = [];
            if (!army.entryTarget) army.orderNote = '已抵达目标格，军团待命。';
        }
        army.order = army.route.length ? 'move' : 'hold';
        // A newly edited plan cannot spend elapsed time from before it was issued.
        this._startMarch(army, army.route[0], Math.max(now, army.routeIssuedAt || 0));
        if (army.route.length && !army.march) { army.route = []; army.order = 'hold'; }
    },

    _resetMarchScheduler() {
        this._arrivalQueue.clear(); this._arrivalSequence = 0; this._idleDecisions.clear();
        this._reinforcementInFlight = null;
    },

    _queueMarch(unit) {
        const march = unit?.march;
        if (!march || unit.warId || unit.detachmentBattleId || this.state.encounter?.enemyId === unit.id) return;
        this._arrivalQueue.push({ unit, march, due: march.startedAtGameTimeMs + march.durationGameMs, order: this._arrivalSequence++ });
    },

    _advanceMarches(now) {
        this._preparePlayerMarch(now);
        for (const army of [...this.state.detachments]) this._prepareDetachment(army, now);
        for (const convoy of [...this.state.convoys]) this._prepareConvoy(convoy, now);
        for (const unit of this.state.settlers) this._prepareSettler(unit, now);
        this.state.enemies.forEach((enemy) => this._enemyStep(enemy, now));
        // Reconcile once per strategic tick. Queue entries are derived, never saved.
        this._arrivalQueue.clear(); this._arrivalSequence = 0;
        if (this.inMap) this._queueMarch(this.state.army);
        for (const unit of [...this.state.detachments, ...this.state.convoys, ...this.state.settlers]) this._queueMarch(unit);
        for (const enemy of this.state.enemies) this._queueMarch(enemy);
        const ids = new Set(this.state.enemies.map((enemy) => enemy.id));
        for (const id of this._idleDecisions.keys()) if (!ids.has(id)) this._idleDecisions.delete(id);
        return this._drainMarchArrivals(now);
    },

    _drainMarchArrivals(now) {
        const started = performance.now();
        // Keep chronological intermediate-cell contact. Remaining work continues next frame.
        for (let count = 0; count < config.scheduling.maxArrivalsPerFrame; count++) {
            if (count && performance.now() - started >= config.scheduling.arrivalBudgetMs) break;
            if (!this._arrivalQueue.size || this._arrivalQueue.peek().due > now) break;
            const event = this._arrivalQueue.pop(), { unit, march } = event;
            const playerArmy = unit === this.state.army;
            const support = this.state.detachments.includes(unit) || this.state.convoys.includes(unit) || this.state.settlers.includes(unit);
            if (unit.march !== march || event.due !== march.startedAtGameTimeMs + march.durationGameMs
                || unit.warId || unit.detachmentBattleId || this.state.encounter?.enemyId === unit.id
                || (playerArmy ? !this.inMap : !support && !this.state.enemies.includes(unit))) continue;
            if (!playerArmy && !support && (this.state.enemies.some((other) => other !== unit && other.cellId === march.toCellId)
                || (this.state.encounter && march.toCellId === this.state.army?.cellId))) {
                // A blocked arrival keeps its completed edge, but cannot bank onward travel.
                march.startedAtGameTimeMs = now - march.durationGameMs;
                // Retry on the next strategic tick, not repeatedly within this frame.
                continue;
            }
            const arrivedAt = march.startedAtGameTimeMs + march.durationGameMs;
            unit.previousCellId = unit.cellId;
            unit.cellId = march.toCellId; unit.march = null;
            if (playerArmy) {
                unit.route.shift();
                while (unit.waypoints?.length && unit.waypoints[0] === unit.cellId) unit.waypoints.shift();
                if (!unit.route.length) {
                    unit.order = 'hold';
                    if (!unit.entryTarget && !unit.pursueId) {
                        unit.orderNote = '已抵达目标格，军团待命。'; unit.mapStatus = 'arrived';
                        unit.mapStatusAt = now;
                        this.recordEvent('arrival', '军团抵达目标格', unit.orderNote, { cellId: unit.cellId });
                    }
                }
            } else if (support) { unit.route.shift(); unit.retreating = false; }
            else if (unit.invasion) unit.route.shift();
            else if (unit.order === 'move' && unit.cellId === unit.destination) unit.order = 'hold';
            if (playerArmy || support) this.refreshMapIntel();
            this.refreshInvasionIntel(arrivedAt);
            if (this._contact()) return true;
            for (const army of this.state.detachments) if (army.cellId === unit.cellId) this._contactDetachment(army, arrivedAt);
            this._contactSettlers(unit.cellId, arrivedAt);
            if (playerArmy) this._preparePlayerMarch(arrivedAt);
            else if (unit.kind === 'detachment') this._prepareDetachment(unit, arrivedAt);
            else if (unit.kind === 'convoy') this._prepareConvoy(unit, arrivedAt);
            else if (unit.kind === 'settler') this._prepareSettler(unit, arrivedAt);
            else this._enemyStep(unit, arrivedAt, true);
            this._queueMarch(unit);
        }
        return false;
    },

    spawnEnemy(type, { cellId = null, order = null, destination = null, objective = null } = {}) {
        const template = config.enemyTypes[type];
        if (!template || this.state.enemies.filter((enemy) => !enemy.invasion).length >= config.maxEnemyArmies) return { ok: false, reason: '未知敌军类型或已达军团上限' };
        // Leave a slot for each biome's signal garrison; random patrols cannot block expansion.
        if (!objective && this.state.enemies.filter((enemy) => !enemy.objective && !enemy.invasion).length >= config.maxEnemyArmies - Object.keys(config.enemyTypes).length) return { ok: false, reason: '巡游军团已达上限' };
        const eligible = (cell) => cell.planeSceneId === template.sceneId
            && !this.state.enemies.some((enemy) => enemy.cellId === cell.id)
            && !this.state.settlers.some((unit) => unit.cellId === cell.id || unit.march?.toCellId === cell.id)
            && !this.state.sites.some((site) => site.owner === 'player' && site.status === 'active' && site.cellId === cell.id)
            && (!this.state.army || strategicDistance(cell, strategicCell(this.state.army.cellId)) > 2);
        const pool = worldMapPlaneCells(template.sceneId).filter(eligible);
        const cell = cellId ? strategicCell(cellId) : pool[Math.floor(this.random() * pool.length)];
        if (!cell || cell.planeSceneId !== template.sceneId || this.state.enemies.some((e) => e.cellId === cell.id)
            || (!objective && this.state.army?.cellId === cell.id)) return { ok: false, reason: '敌军生成地块不可用' };
        const roster = this.makeRoster(type);
        const enemy = { id: `enemy_army_${this.state.nextId++}`, type, name: template.name, cellId: cell.id,
            homeCellId: cell.id, order: order || template.order, destination, route: [], roster, objective };
        this.state.enemies.push(enemy);
        return { ok: true, id: enemy.id };
    },

    orderEnemy(id, order, destination = null) {
        if (order === 'siege') return this.commandSiege(id, destination);
        const enemy = this.state.enemies.find((item) => item.id === id);
        if (!enemy || enemy.invasion || enemy.objective || enemy.warId || enemy.detachmentBattleId || this.state.encounter?.enemyId === id
            || !['hold', 'wander', 'patrol', 'hunt', 'move'].includes(order)) return { ok: false, reason: '敌军或指令无效，信标守军不能离开目标格' };
        if (destination && !strategicRoute(enemy.cellId, destination)) return { ok: false, reason: '敌军目标不可达' };
        if (order === 'move' && !destination) return { ok: false, reason: '移动指令需要目标格' };
        Object.assign(enemy, { order, destination, route: [], march: null, manualOrder: true, targetId: null });
        return { ok: true };
    },

    ensureSignalGuards() {
        for (const { sceneId } of WORLD_MAP_PLANES) {
            const entry = Progression.getWorldMapDiscovery(sceneId);
            if (!entry || Progression.isWorldEligible(sceneId) || Progression.getPortalState(sceneId).everConstructed) continue;
            if (this.state.enemies.some((enemy) => enemy.objective?.sceneId === sceneId && enemy.objective.worldEpoch === entry.worldEpoch)) continue;
            const type = Object.keys(config.enemyTypes).find((id) => config.enemyTypes[id].sceneId === sceneId);
            const objective = { sceneId, cellId: entry.cellId, worldEpoch: entry.worldEpoch };
            const occupant = this.state.enemies.find((enemy) => enemy.cellId === entry.cellId);
            if (occupant && !occupant.invasion && this.state.encounter?.enemyId !== occupant.id) Object.assign(occupant, { objective, order: 'hold', route: [], march: null });
            else this.spawnEnemy(type, { cellId: entry.cellId, order: 'hold', objective });
        }
    },

    _enemyStep(enemy, now = strategicNow(), arrived = false) {
        if (enemy.detachmentBattleId) return;
        if (enemy.invasion) { this._stepInvasionMarch(enemy, now); return; }
        if (enemy.order === 'hold' || enemy.warId || this.state.encounter?.enemyId === enemy.id) { enemy.march = null; return; }
        if (enemy.march) return;
        const template = config.enemyTypes[enemy.type], army = this.state.army;
        const near = this.inMap && army && strategicDistance(strategicCell(enemy.cellId), strategicCell(army.cellId)) <= template.vision;
        const decisionKey = `${enemy.order}:${enemy.destination}:${enemy.targetId}`;
        const idle = this._idleDecisions.get(enemy.id);
        if (!near && !arrived && idle?.key === decisionKey && now < idle.nextAt) return;
        this._idleDecisions.set(enemy.id, { key: decisionKey, nextAt: now + config.scheduling.farIdleDecisionMs });
        let target = enemy.destination;
        if (near && !['move', 'siege'].includes(enemy.order)) target = army.cellId;
        else if (enemy.order === 'patrol') {
            if (!target) {
                const pool = worldMapPlaneCells(template.sceneId).filter((cell) => strategicDistance(cell, strategicCell(enemy.homeCellId)) >= 3);
                enemy.destination = pool[Math.floor(this.random() * pool.length)]?.id || enemy.homeCellId;
            }
            if (!enemy.patrolTarget) enemy.patrolTarget = enemy.destination;
            if (enemy.cellId === enemy.patrolTarget) enemy.patrolTarget = enemy.patrolTarget === enemy.destination ? enemy.homeCellId : enemy.destination;
            target = enemy.patrolTarget;
        } else if (!['move', 'siege'].includes(enemy.order)) {
            const adjacent = strategicNeighbors(enemy.cellId).filter((cell) => cell.planeSceneId === template.sceneId);
            target = adjacent[Math.floor(this.random() * adjacent.length)]?.id;
        }
        if (!target) return;
        const occupied = new Set(this.state.enemies.filter((other) => other !== enemy).map((other) => other.cellId));
        const route = strategicRoute(enemy.cellId, target, (cell) => cell.id === target || !occupied.has(cell.id),
            JSON.stringify(['enemy', target, [...occupied].sort()]));
        const next = route?.[0];
        if (!next || this.state.enemies.some((other) => other !== enemy && other.cellId === next)) return;
        if (this.state.encounter && next === this.state.army?.cellId) return;
        this._startMarch(enemy, next, now);
    },

    update(dt) {
        if (this._busy || manager()?.isLoading) return;
        if (this.inBattle) this._battle?.update(dt, this);
        if (this._busy) return;
        this._accumulator += Math.max(0, Math.min(dt, config.tickMs));
        if (this._accumulator < config.tickMs) {
            if (this._arrivalQueue.peek()?.due <= strategicNow()) this._drainMarchArrivals(strategicNow());
            return;
        }
        this._accumulator %= config.tickMs;
        this.ensureCampaign();
        this.observeWarEvents();
        this.refreshMapIntel();
        if (!this.state.initialized && !this.state.enemies.some((enemy) => enemy.invasion)
            && !this.state.detachments.length && !this.state.convoys.length && !this.state.settlers.length) return;
        this.state.tick++;
        this._reconcileCampaignWars();
        if (this.state.initialized) this.ensureSignalGuards();
        this.refreshInvasionIntel();
        this._advanceLogistics(strategicNow());
        this._advanceDetachmentBattles(strategicNow());
        if (this._contact()) return;
        if (this._advanceMarches(strategicNow())) return;
        if (this._contact()) return;
        if (this.state.initialized) this._advanceCampaign();
        this.observeWarEvents();
    },

    _contact() {
        if (!this.inMap || this.state.encounter || this.state.army.defeated) return false;
        if (this.state.tick < this.state.army.graceUntil) return this._contactBaseEntry();
        const enemy = this.state.enemies.find((item) => item.cellId === this.state.army.cellId);
        if (enemy?.invasion) this.refreshInvasionIntel();
        if (enemy) { this.engage(enemy.id); return true; }
        const site = this.state.sites.find((item) => item.cellId === this.state.army.cellId && item.owner === 'enemy' && item.status === 'active');
        if (site) { this.engage(null, site.id); return true; }
        const relief = this.getWars().find((war) => war.id === this.state.army.reliefWarId && war.cellId === this.state.army.cellId);
        if (relief?.source === 'world') { this.engage(null, null, relief.id); return true; }
        return this._contactBaseEntry();
    },

    async engage(enemyId, siteId = null, worldWarId = null) {
        if (this._busy || !this.inMap) return;
        const enemy = this.state.enemies.find((item) => item.id === enemyId && item.cellId === this.state.army.cellId);
        const site = this.state.sites.find((item) => item.id === siteId && item.cellId === this.state.army.cellId && item.owner === 'enemy' && item.status === 'active');
        const worldWar = window.WorldInvasionSystem?.getBattles?.().find((war) => war.id === worldWarId);
        const city = worldWar && this.getSettlements().find((item) => item.id === `world_${worldWar.targetWorld}`);
        if (!enemy && !site && (!city || city.cellId !== this.state.army.cellId)) return;
        for (const army of this.state.detachments) if (army.cellId === this.state.army.cellId) this._releaseDetachmentBattle(army);
        this._busy = true;
        const warId = worldWarId || enemy?.warId;
        const siege = warId && window.WorldInvasionSystem?.suspendBattle?.(warId);
        if (warId && (worldWar || enemy?.targetId?.startsWith('world_')) && !siege) {
            this._reconcileCampaignWars(); this._busy = false; return;
        }
        const records = Troops.serializeStrategicTroops();
        this.state.army.route = []; this.state.army.waypoints = []; this.state.army.march = null; this.state.army.order = 'hold';
        this.state.army.destination = this.state.army.cellId; this.state.army.entryTarget = null;
        this.state.army.orderNote = '军团已接战，战斗结束后可重新下令。';
        this.state.army.mapStatus = 'battle';
        this.recordEvent('battle', '军团遭遇战斗', enemy?.name || site?.name || city?.name || '接触敌方目标', { cellId: this.state.army.cellId });
        if (enemy) enemy.march = null;
        this.state.army.pursueId = null; this.state.army.reliefWarId = null;
        this.state.encounter = { id: `battle_${this.state.nextId++}`, enemyId, siteId, worldWarId: siege ? warId : null, cellId: this.state.army.cellId,
            planeSceneId: strategicCell(this.state.army.cellId).planeSceneId,
            friendlyBefore: this.troopCount(),
            waves: siege?.waves || (enemy?.invasion ? this.invasionEncounterWaves(enemy) : [clone(site?.roster || enemy.roster)]),
            summonLedger: clone(siege?.summonLedger || enemy?.invasion?.summonLedger || null),
            disposition: 'destroy' };
        try {
            const { WorldSwitchPanel } = await import('../ui/world-switch-panel.js');
            WorldSwitchPanel.close();
            await this._switch(STRATEGY_BATTLE_SCENE);
            this._battle.showHud(this);
        } catch (error) {
            if (siege) window.WorldInvasionSystem?.resumeBattle?.(warId);
            Troops.restoreStrategicTroops(records);
            Troops.setStrategicCompanions(this.state.army.companionIds, STRATEGY_MAP_SCENE, null, this.state.army.id);
            game().player.active = false;
            this.state.encounter = null;
            this.state.army.mapStatus = 'blocked';
            this._battle.clearResult();
            this.state.army.graceUntil = this.state.tick + config.encounterGraceTicks;
            const message = `遭遇战加载失败，军团仍在原格：${error.message}`;
            this.recordEvent('blocked', '战场加载失败', message, { cellId: this.state.army.cellId });
            this.notify(message);
            await this.openMap();
        } finally { this._busy = false; }
    },

    retreatCell() {
        const army = this.state.army;
        if (!army) return null;
        const occupied = this.hostileCells();
        return strategicNeighbors(army.cellId).find((cell) => !occupied.has(cell.id)) || null;
    },

    async finishBattle(outcome, disposition = null) {
        if (this._pendingBattleReturn) return this.retryBattleReturn();
        if (!this.inBattle || this._busy) return false;
        if (!['victory', 'retreat', 'defeat'].includes(outcome)) return false;
        if (outcome !== 'defeat' && (game().player._isDead || !(game().player.data.hp > 0))) return false;
        const result = this._battle.result();
        if (outcome === 'victory' && !result.victory) return false;
        if (outcome === 'retreat' && !this._battle.canRetreat(game().player)) return false;
        const retreatCellId = outcome !== 'victory' ? this.retreatCell()?.id : null;
        if (outcome === 'retreat' && !retreatCellId) {
            this.notify('相邻地格均有敌军、敌方城镇或战事，当前无法安全撤退');
            return false;
        }
        this._busy = true;
        const army = this.state.army;
        const encounter = this.state.encounter;
        const spoils = outcome === 'victory' ? this._battle.collectLoot() : [];
        Troops.packStrategicSurvivors();
        const friendlyAfter = this.troopCount();
        Troops.setStrategicCompanions(army.companionIds, STRATEGY_MAP_SCENE, null, army.id);
        // A failed map load can destroy the old siege geometry. Keep the resolved
        // battle frozen and retry travel, never resume that partially torn-down field.
        this._pendingBattleReturn = { army, encounter, outcome, disposition: 'destroy',
            result, spoils, retreatCellId, friendlyAfter, inFlight: false };
        return this.retryBattleReturn();
    },

    async retryBattleReturn() {
        const pending = this._pendingBattleReturn;
        if (!pending || pending.inFlight || manager()?.isLoading) return false;
        pending.inFlight = true;
        this._busy = true;
        try {
            await this._switch(STRATEGY_MAP_SCENE);
        } catch (error) {
            // _busy intentionally remains true: gameplay and save/load stay blocked.
            // Troops remain in their one authoritative ledger, with no second packing.
            pending.inFlight = false;
            game().player.active = false;
            this._battle.showReturnFailure(this, error.message);
            if (!pending.failureEvent) pending.failureEvent = this.recordEvent('blocked', '返回地图失败', '战斗结果已保留，请使用战场上的“重试返回地图”。', { cellId: pending.army.cellId }).id;
            return false;
        }
        const { army, encounter, outcome, disposition, result, spoils, retreatCellId, friendlyAfter } = pending;
        const enemy = this.state.enemies.find((item) => item.id === encounter.enemyId);
        // Only a committed scene transition may publish casualties, ownership or loot.
        this._pendingBattleReturn = null;
        try {
            this._battle.hideHud();
            if (enemy?.invasion) this.applyInvasionInterception(enemy, result, outcome === 'victory', encounter);
            else if (enemy) {
                enemy.roster = result.roster;
                if (outcome === 'victory' || !enemy.roster.length) this.state.enemies = this.state.enemies.filter((item) => item !== enemy);
                if (outcome === 'victory' && enemy.objective) Progression.secureWorldSignal(enemy.objective);
            }
            if (encounter.siteId) this.applySettlementResult(encounter.siteId, result, outcome === 'victory', disposition);
            if (encounter.worldWarId) window.WorldInvasionSystem?.finishRelief?.(encounter.worldWarId, outcome === 'victory', result);
            this.state.pendingLoot.push(...spoils);
            this._reconcileCampaignWars();
            this.state.encounter = null;
            this._battle.clearResult();
            army.graceUntil = this.state.tick + config.encounterGraceTicks;
            if (retreatCellId) army.cellId = retreatCellId;
            army.destination = army.cellId;
            army.defeated = outcome === 'defeat';
            army.mapStatus = army.defeated ? 'defeated' : 'hold';
            army.orderNote = army.defeated ? '亲征已失败，等待撤回主神空间。' : '已返回战略地图，军团待命。';
            const siteResult = encounter.siteId && outcome === 'victory' ? ' · 城镇目标已摧毁' : '';
            const casualties = Math.max(0, Math.floor(Number(encounter.friendlyBefore) || 0) - Math.max(0, Number(friendlyAfter) || 0));
            const pendingLootCount = this.state.pendingLoot.length;
            const battleTitle = outcome === 'victory' ? '战斗胜利' : outcome === 'defeat' ? '亲征失败' : '已撤出战场';
            this.state.lastResult = `${battleTitle}${siteResult}：幸存士兵 ${friendlyAfter || 0} 名，伤亡 ${casualties} 名，待领取战利品 ${pendingLootCount} 项。`;
            if (pending.failureEvent) this.updateEvent(pending.failureEvent, { detail: '已成功返回地图；未重复结算战斗结果。', resolved: true });
            const battleEvent = this.recordEvent('battle_result', battleTitle, this.state.lastResult, {
                cellId: army.cellId,
                sceneId: encounter.planeSceneId,
                outcome,
                casualties,
                survivors: Math.max(0, Number(friendlyAfter) || 0),
                lootCount: pendingLootCount,
            }, { announce: false });
            this.notify(this.state.lastResult, {
                tone: outcome === 'victory' ? 'success' : outcome === 'defeat' ? 'danger' : 'warning',
                onComplete: () => this.announceEvent(battleEvent.id),
            });
            await this.openMap();
        } finally { this._busy = false; }
        if (outcome === 'defeat') return this.returnHome(true);
        return true;
    },

    async returnHome(defeated = false) {
        const army = this.state.army;
        if (!this.inMap || this._busy) return false;
        defeated ||= army.defeated === true;
        const validOrigin = Progression.isPortalConstructed(army.originSceneId)
            && Progression.isWorldEpochCurrent(army.originSceneId, army.originEpoch);
        if (!defeated && validOrigin) {
            const result = this.orderBaseEntry(army.originSceneId);
            this.notify(result.ok ? army.orderNote : result.reason);
            return result.ok;
        }
        return this._returnToWorld('main');
    },

    async _returnToWorld(destination, entry = null) {
        const army = this.state.army;
        if (!this.inMap || this._busy) return false;
        if (entry && (army.cellId !== entry.cellId || army.march || this.baseEntryBlockReason(entry))) return false;
        this._busy = true;
        army.mapStatus = 'entering';
        const destinationName = destination === 'main' ? '主神空间' : Progression.getWorldConfig(destination)?.name || destination;
        const arrival = this.recordEvent('base_entry', `${destination === 'main' ? '撤回' : '抵达'}${destinationName} · 正在加载`, '切场成功后才登记部队接收结果，当前尚未完成入营。',
            { cellId: army.cellId, sceneId: destination, worldEpoch: entry?.worldEpoch || null, phase: 'loading' });
        try {
            if (destination === army.originSceneId && Progression.isWorldEpochCurrent(destination, army.originEpoch)) {
                game()._worldPlayerPos ||= {};
                game()._worldPlayerPos[destination] = { ...army.originPoint };
            }
            try {
                await this._switch(destination, false, false, entry);
            } catch (error) {
                army.entryTarget = null;
                game().player.active = false;
                Troops.setStrategicCompanions(army.companionIds, STRATEGY_MAP_SCENE, null, army.id);
                army.orderNote = `${destination === 'main' ? '撤回主神空间' : '入营'}加载未完成，军团保留在当前格；请重新下令：${error.message}`;
                army.mapStatus = 'blocked';
                this.updateEvent(arrival.id, { title: `${destinationName}接收未完成`, detail: army.orderNote, phase: 'failed' });
                this.notify(army.orderNote);
                await this.openMap();
                return false;
            }
            game().player.active = true;
            this._settleSupply();
            const receipt = Troops.releaseStrategicTroops(destination, game().player);
            this._returnArmyFood(army, entry || { sceneId: army.originSceneId, cellId: army.originCellId, worldEpoch: army.originEpoch });
            Troops.setStrategicCompanions(army.companionIds, destination, game().player);
            receipt.companions = army.companionIds.filter((id) => {
                const member = game()?.PartySystem?.getMember?.(id);
                return member?.active !== false && member?.data?.hp > 0 && !member?._strategicArmyId;
            }).length;
            this.updateEvent(arrival.id, { title: `${destinationName}${receipt.unaccounted ? '接收记录需核对' : '已接收军团'}`, phase: 'complete', receipt,
                detail: '接收时的账本快照。等待落地的士兵继续沿原兵线重试；后续伤亡、调动不会改写此历史清单。' }, { announce: false });
            this.state.army = null; this.state.encounter = null;
            this._battle?.hideHud();
            try {
                const { WorldSwitchPanel } = await import('../ui/world-switch-panel.js');
                WorldSwitchPanel.close();
            } catch (error) { this.notify(`部队已入营，地图界面关闭失败：${error.message}`); }
            await this._refreshReturnedAssets();
            this.notify(`${destinationName}接收：已登记${receipt.accepted}名士兵（伤员${receipt.wounded}），已落地${receipt.deployed}、等待落地${receipt.pending}，队友${receipt.companions}。${receipt.unaccounted ? `有${receipt.unaccounted}名记录待核对。` : ''}按O在“动态”查看清单。`, {
                tone: receipt.unaccounted ? 'warning' : 'success',
                onComplete: () => this.announceEvent(arrival.id),
            });
            return true;
        } finally { this._busy = false; }
    },

    async restore(saved) {
        this._resetMarchScheduler();
        this._invasionReconCache = null;
        this.state = [1, 2, 3, 4, 5].includes(saved?.version) ? { ...initial(), ...clone(saved), version: 5 } : initial();
        this._mapVisibleCells = this._mapExploredCells = null; this._mapVisibleSignature = this._mapExploredSignature = null; this._mapIntelRevision = 0;
        this.restoreJournal();
        const now = strategicNow();
        this.ensureCampaign();
        this.refreshMapIntel();
        this._restoreSupport(now);
        this._restoreSettlers();
        for (const unit of [this.state.army, ...this.state.enemies, ...this.state.detachments, ...this.state.convoys, ...this.state.settlers].filter(Boolean)) {
            const march = unit.march;
            if (![3, 4, 5].includes(saved?.version) || !march || march.fromCellId !== unit.cellId
                || !strategicNeighbors(unit.cellId).some((cell) => cell.id === march.toCellId)
                || !Number.isFinite(march.startedAtGameTimeMs) || march.startedAtGameTimeMs < 0 || march.startedAtGameTimeMs > now
                || !Number.isFinite(march.durationGameMs) || march.durationGameMs <= 0
                || (unit === this.state.army && unit.route?.[0] !== march.toCellId)) unit.march = null;
        }
        this.state.enemies = this.state.enemies.filter((enemy) => !enemy.invasion
            || (Progression.isWorldEpochCurrent(enemy.invasion.targetWorld, enemy.invasion.worldEpoch)
                && Progression.isPortalConstructed(enemy.invasion.targetWorld)
                && strategicCell(enemy.cellId) && strategicCell(enemy.destination)
                && Array.isArray(enemy.route) && enemy.route.every((id) => strategicCell(id))
                && Number.isFinite(enemy.invasion.travelMultiplier) && enemy.invasion.travelMultiplier > 0));
        window.WorldInvasionSystem?.reconcileInvasionMarch?.();
        const army = this.state.army;
        if (army) {
            army.routeIssuedAt = Number.isFinite(army.routeIssuedAt) ? Math.max(0, Math.min(now, army.routeIssuedAt)) : 0;
            // An old save has no intermediate stops. Malformed plans are canceled
            // as a whole, retaining an already validated current edge and all troops.
            if (army.waypoints == null) army.waypoints = [];
            else if (!Array.isArray(army.waypoints) || army.waypoints.length >= config.march.maxRouteStops
                || army.waypoints.some((id) => !strategicCell(id))) {
                army.waypoints = []; army.route = army.march ? [army.march.toCellId] : [];
                army.destination = army.march?.toCellId || army.cellId;
                army.targetId = army.pursueId = army.reliefWarId = army.entryTarget = null;
                army.allowHostileTarget = false; army.order = army.march ? 'move' : 'hold';
                army.orderNote = '存档中的途经点计划无效，已取消后续节点；现有军团及当前路段保留。';
            }
        }
        Progression.setStrategicSiteCells(this.state.sites);
        this.ensureCampaign();
        this._accumulator = 0; this._busy = false; this._pendingBattleReturn = null; this._battle?.hideHud();
        if (!this.active) {
            for (const member of game()?.PartySystem?.members || []) member._strategicArmyId = null;
            // Old saves do not contain a strategic army; never strand a previous session's avatar.
            if ([STRATEGY_MAP_SCENE, STRATEGY_BATTLE_SCENE].includes(manager().currentScene)) {
                game().player.active = true;
                await manager().switchScene('main', game().player);
            }
            this.announceJournalRestore();
            return;
        }
        if (!strategicCell(this.state.army.cellId)) this.state.army.cellId = this.state.army.originCellId;
        this.state.encounter = null; // Saving is disabled during live encounters and scene transitions.
        Troops.setStrategicCompanions(this.state.army.companionIds, STRATEGY_MAP_SCENE, null, this.state.army.id);
        this._busy = true;
        try { await this._switch(STRATEGY_MAP_SCENE, true, true); await this.openMap(); }
        finally { this._busy = false; }
        this.announceJournalRestore();
    },
};
