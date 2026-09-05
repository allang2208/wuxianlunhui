import { EnergyManager } from '../systems/energy-manager.js';
import { EconomyFlowSystem } from './economy-flow-system.js';
import { WorldSimDriver } from './world-sim-driver.js';
import { getWorldSnapshot } from './world122-snapshot.js';
import { invalidateWorldBackgroundLedger } from './world-background-ledger.js';
import { TroopLineSystem as Troops } from './troop-line-system.js';
import { strategicNow, strategicDayDurationMs, strategicRouteEstimate } from './strategic-march.js';
import producerBuildings from '../../data/producer-buildings.json';
import upgrades from '../../data/building-upgrades.json';
import economy from '../../data/population-economy.json';

const integer = (value) => Math.max(0, Math.floor(Number(value) || 0));
function warehouses(sceneId) {
    if (window.SceneManager?.currentScene === sceneId) return EnergyManager.getWarehouses();
    WorldSimDriver.flushWorld(sceneId, { reason: 'strategic-supply' });
    return (getWorldSnapshot(sceneId)?.structures || []).filter((s) => s.kind === 'producer'
        && s.hp > 0 && producerBuildings[s.cfgKey]?.workshopType === 'warehouse');
}
function moduleValue(warehouse, id) {
    const module = upgrades.warehouse_logistics?.modules?.[id];
    if (!module) return 0;
    const level = Math.min(integer(module.maxLevel || 10), integer(warehouse.warehouseModules?.[id]));
    return (Number(module.base) || 0) + (Number(module.per) || 0) * level;
}
function freeFood(warehouse) {
    const levels = economy.warehouse?.levels || [];
    const level = levels.find((item) => item.level === (warehouse.economyLevel || 1)) || levels[levels.length - 1];
    const configuredCapacity = (level?.storageCapacity || producerBuildings[warehouse.cfgKey]?.storageCapacity || 0)
        + moduleValue(warehouse, 'warehouse_capacity');
    const capacity = Number.isFinite(warehouse.storageCapacity) ? integer(warehouse.storageCapacity) : configuredCapacity;
    const foodFactor = Math.max(0.1, Math.min(1, 1 + moduleValue(warehouse, 'warehouse_food_density')));
    const energyFactor = Math.max(0.1, Math.min(1, 1 + moduleValue(warehouse, 'warehouse_energy_density')));
    return integer((capacity - integer(warehouse.storedFood) * foodFactor - integer(warehouse.storedEnergy) * energyFactor) / foodFactor);
}

export const StrategicLogistics = {
    supportCommandBlocked() { return this._busy || window.SceneManager?.isLoading; },
    playerArmies() { return [this.state.army, ...this.state.detachments].filter(Boolean); },
    playerArmy(id) { return this.playerArmies().find((army) => army.id === id); },
    supplyUnits(army) {
        return army === this.state.army ? 1 + (army.companionIds?.length || 0) + this.troopCount() : Troops.getArmyPower(army.id).units;
    },
    supplyQuote(units, days = this.config.supply.initialDays) {
        return Math.ceil(units * days * this.config.supply.foodPerUnitPerDay);
    },
    supplyStatus(army) {
        const daily = this.supplyUnits(army) * this.config.supply.foodPerUnitPerDay;
        const food = integer(army.supply?.food);
        return { food, daily, days: daily ? food / daily : 0,
            capacity: this.supplyQuote(this.supplyUnits(army), this.config.supply.capacityDays) };
    },
    reserveSupply(sceneId, amount) {
        amount = integer(amount);
        const stocks = warehouses(sceneId);
        if (stocks.reduce((sum, stock) => sum + integer(stock.storedFood), 0) < amount)
            return { ok: false, reason: `出发基地粮食不足，需要 ${amount} 粮食。` };
        const changes = [];
        let left = amount;
        for (const stock of stocks) {
            const take = Math.min(left, integer(stock.storedFood));
            if (take) { stock.storedFood -= take; changes.push([stock, take]); left -= take; }
        }
        EconomyFlowSystem.record('food', -amount);
        const snapshot = window.SceneManager?.currentScene !== sceneId && getWorldSnapshot(sceneId);
        if (snapshot && amount) invalidateWorldBackgroundLedger(snapshot, 'strategic-supply-withdrawal');
        EnergyManager._notifyUpdate();
        return { ok: true, food: amount, rollback() {
            for (const [stock, take] of changes) stock.storedFood += take;
            EconomyFlowSystem.record('food', amount); EnergyManager._notifyUpdate();
        } };
    },
    _depositSupply(sceneId, amount) {
        amount = integer(amount);
        if (window.SceneManager?.currentScene === sceneId) return EnergyManager.depositFood(amount);
        let left = amount;
        for (const stock of warehouses(sceneId)) {
            const put = Math.min(left, freeFood(stock));
            stock.storedFood = integer(stock.storedFood) + put; left -= put;
        }
        EconomyFlowSystem.record('food', amount - left);
        if (amount !== left) invalidateWorldBackgroundLedger(getWorldSnapshot(sceneId), 'strategic-supply-return');
        return amount - left;
    },
    _settleSupply(now = strategicNow()) {
        for (const army of this.playerArmies()) {
            const supply = army.supply ||= { food: 0, lastAt: now, fraction: 0 };
            const elapsed = Math.max(0, now - supply.lastAt);
            const spent = elapsed / strategicDayDurationMs() * this.supplyStatus(army).daily + (supply.fraction || 0);
            const previous = supply.food;
            supply.food = Math.max(0, integer(supply.food) - Math.floor(spent));
            supply.fraction = supply.food ? spent % 1 : 0; supply.lastAt = Math.max(supply.lastAt, now);
            if (previous > 0 && !supply.food) this.recordEvent('blocked', `${army.name}补给耗尽`,
                '后续路段耗时增加，分遣军战力降低；已走出的路段不倒退。请派运输队或返回基地。', { armyId: army.id, cellId: army.cellId });
        }
    },
    dispatchSupply(armyId, sceneId) {
        if (this._busy || window.SceneManager?.isLoading) return { ok: false, reason: '切场期间不能派遣运输队。' };
        this._settleSupply();
        const army = this.playerArmy(armyId), base = this.baseEntry(sceneId);
        if (!army || !base || this.baseEntryBlockReason(base)) return { ok: false, reason: '军团或出发基地不可用。' };
        if (this.state.convoys.length >= this.config.supply.maxConvoys) return { ok: false, reason: '运输队已达上限，请先处理在途或待卸货运输队。' };
        const status = this.supplyStatus(army);
        if (status.capacity <= status.food) return { ok: false, reason: '军团携粮已满。' };
        const stock = warehouses(sceneId).reduce((sum, warehouse) => sum + integer(warehouse.storedFood), 0);
        const amount = Math.min(this.config.supply.convoyCapacity, status.capacity - status.food, stock);
        if (amount <= 0) return { ok: false, reason: '出发基地没有可运输粮食。' };
        const convoy = { id: `convoy_${this.state.nextId++}`, name: '粮食运输队', kind: 'convoy',
            cellId: base.cellId, origin: base, targetArmyId: armyId, food: amount, route: [], order: 'move', returning: false };
        const route = this._supportRoute(convoy, army.cellId, false);
        if (!route) return { ok: false, reason: '运输路线受阻，无法避开已知敌军或战事。' };
        const reservation = this.reserveSupply(sceneId, amount);
        if (!reservation.ok) return reservation;
        this.state.convoys.push(convoy);
        this._prepareConvoy(convoy, strategicNow());
        return { ok: true };
    },
    setSupplyLine(armyId, sceneId) {
        if (this.supportCommandBlocked()) return { ok: false, reason: '切换场景期间不能修改补给线。' };
        const army = this.playerArmy(armyId);
        if (!army) return { ok: false, reason: '军团已离场。' };
        if (!sceneId) { army.supplyLine = null; return { ok: true }; }
        const base = this.baseEntry(sceneId);
        if (!base) return { ok: false, reason: '补给基地不可用。' };
        army.supplyLine = { ...base, nextAt: strategicNow(), note: '低于四天口粮时自动派车，按实际库存扣粮。' };
        return { ok: true };
    },
    returnConvoy(id) {
        if (this.supportCommandBlocked()) return { ok: false, reason: '切换场景期间不能修改运输命令。' };
        const convoy = this.state.convoys.find((item) => item.id === id);
        if (!convoy) return { ok: false, reason: '运输队已离场。' };
        convoy.returning = true; convoy.orderNote = '走完当前路段后返航。';
        return { ok: true };
    },
    _supportRoute(unit, destination, attack = false, waypoints = []) {
        const blocked = this.mapHostileCells();
        return strategicRouteEstimate(unit, destination, (cell, final) => !blocked.has(cell.id)
            || (attack && final && cell.id === destination), waypoints, JSON.stringify(['support', attack && destination, [...blocked].sort()]));
    },
    _prepareConvoy(convoy, now) {
        if (convoy.march) return;
        const enemy = this.state.enemies.find((item) => item.cellId === convoy.cellId);
        const enemySite = this.state.sites.find((site) => site.cellId === convoy.cellId && site.owner === 'enemy' && site.status === 'active');
        if (enemy || enemySite) {
            if (enemy?.detachmentBattleId || enemySite?.detachmentBattleId || (enemy && this.state.encounter?.enemyId === enemy.id)
                || this.state.encounter?.cellId === convoy.cellId) { convoy.orderNote = '交战中，运输队等待通行。'; return; }
            this.recordEvent('battle_result', '运输队遭截击', `${convoy.food} 粮食损失。`, { cellId: convoy.cellId });
            this.state.convoys = this.state.convoys.filter((item) => item !== convoy); return;
        }
        const target = this.playerArmy(convoy.targetArmyId);
        if (!target) convoy.returning = true;
        if (!convoy.returning && !target.march && target.cellId === convoy.cellId) {
            this._settleSupply(now);
            const status = this.supplyStatus(target), accepted = Math.min(convoy.food, Math.max(0, status.capacity - status.food));
            target.supply.food += accepted; convoy.food -= accepted; convoy.returning = true;
            this.recordEvent('arrival', `${target.name}收到补给`, `已接收 ${accepted} 粮食。`, { armyId: target.id, cellId: convoy.cellId });
        }
        if (!convoy.food) { this.state.convoys = this.state.convoys.filter((item) => item !== convoy); return; }
        if (convoy.returning && this.baseEntryBlockReason(convoy.origin)) {
            convoy.orderNote = '原基地失效或交战，粮食保留；可选择其他己方基地卸货。'; convoy.order = 'hold'; return;
        }
        const destination = convoy.returning ? convoy.origin.cellId : target.cellId;
        if (convoy.returning && convoy.cellId === destination) {
            if (now < (convoy.nextUnloadAt || 0)) return;
            convoy.nextUnloadAt = now + this.config.playerArmies.combatStepGameMs;
            convoy.food -= this._depositSupply(convoy.origin.sceneId, convoy.food);
            if (!convoy.food) this.state.convoys = this.state.convoys.filter((item) => item !== convoy);
            else { convoy.orderNote = `仓库容量不足，保留 ${convoy.food} 粮食等待卸货。`; convoy.order = 'hold'; }
            return;
        }
        const estimate = this._supportRoute(convoy, destination);
        convoy.route = estimate?.route || []; convoy.order = convoy.route.length ? 'move' : 'hold';
        convoy.orderNote = estimate ? (convoy.returning ? '返回基地卸下剩余粮食。' : '沿补给线追随目标，停驻同格后交付。') : '补给线受阻，粮食保留，等待道路恢复。';
        this._startMarch(convoy, convoy.route[0], now);
    },
    redirectConvoy(id, sceneId) {
        if (this.supportCommandBlocked()) return { ok: false, reason: '切换场景期间不能修改运输命令。' };
        const convoy = this.state.convoys.find((item) => item.id === id), base = this.baseEntry(sceneId);
        if (!convoy || !base || this.baseEntryBlockReason(base)) return { ok: false, reason: '运输队或接收基地不可用。' };
        convoy.origin = base; convoy.returning = true; convoy.nextUnloadAt = 0; return { ok: true };
    },
    _returnArmyFood(army, base) {
        if (!army.supply?.food) return;
        // This escrow is retained even when a warehouse fills or a world is rebuilt.
        this.state.convoys.push({ id: `convoy_${this.state.nextId++}`, name: '归营余粮', kind: 'convoy', cellId: army.cellId,
            origin: base, targetArmyId: null, food: army.supply.food, returning: true, route: [], order: 'hold' });
        army.supply.food = 0;
    },
    _advanceLogistics(now) {
        this._settleSupply(now);
        for (const army of this.playerArmies()) {
            const line = army.supplyLine;
            if (!line || now < line.nextAt) continue;
            line.nextAt = now + this.config.playerArmies.combatStepGameMs;
            if (this.supplyStatus(army).days >= 4 || this.state.convoys.some((c) => c.targetArmyId === army.id && !c.returning)) continue;
            if (this.baseEntryBlockReason(line)) { line.note = '源基地已失效或交战，请重新指定补给线。'; continue; }
            const result = this.dispatchSupply(army.id, line.sceneId);
            line.note = result.ok ? '运输队已发出。' : result.reason;
        }
    },
};
