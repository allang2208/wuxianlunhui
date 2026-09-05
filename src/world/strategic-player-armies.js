import { TroopLineSystem as Troops } from './troop-line-system.js';
import { WorldProgressionSystem as Progression } from './world-progression-system.js';
import { strategicCell } from './world-map-cells.js';
import { strategicNow } from './strategic-march.js';
import { strategicRosterPower, damageStrategicRoster } from './strategic-roster.js';

export const StrategicPlayerArmies = {
    dispatchDetachment(camp, ids) {
        const reason = this.departureBlockReason(camp);
        if (reason) return { ok: false, reason };
        ids = [...new Set(ids)];
        if (!ids.length || ids.length > this.config.maxTroops) return { ok: false, reason: `分遣军需要 1–${this.config.maxTroops} 名士兵，不携带玩家或队友。` };
        if (this.state.detachments.length >= this.config.playerArmies.maxDetachments) return { ok: false, reason: '分遣军数量已达上限。' };
        const origin = this.baseEntry(window.SceneManager.currentScene);
        if (!origin) return { ok: false, reason: '当前基地没有有效地图入口。' };
        const reservation = this.reserveSupply(origin.sceneId, this.supplyQuote(ids.length));
        if (!reservation.ok) return reservation;
        const id = `detachment_${this.state.nextId++}`;
        if (!Troops.packStrategicTroops(ids, id)) { reservation.rollback(); return { ok: false, reason: '编组已变化，部队和粮食均未派出。' }; }
        const army = { id, name: `分遣军 ${id.split('_')[1]}`, kind: 'detachment', cellId: origin.cellId,
            originSceneId: origin.sceneId, originEpoch: origin.worldEpoch, originCellId: origin.cellId,
            route: [], waypoints: [], order: 'hold', supply: { food: reservation.food, lastAt: strategicNow(), fraction: 0 } };
        this.state.detachments.push(army);
        this.ensureCampaign();
        if (!this.state.initialized) {
            Object.keys(this.config.enemyTypes).forEach((type) => this.spawnEnemy(type)); this.state.initialized = true;
        }
        this.ensureSignalGuards();
        this.recordEvent('arrival', `${army.name}已出发`, `${ids.length} 名士兵携 ${reservation.food} 粮食独立行军；玩家留在基地。`, { armyId: id, cellId: army.cellId });
        return { ok: true, id };
    },
    previewDetachmentOrder(id, cellId, enemyId = null, { append = false } = {}) {
        const army = this.state.detachments.find((item) => item.id === id), order = this.mapOrder(cellId, enemyId);
        let reason = !army || !order ? '军团或地图目标无效。' : '';
        if (!reason && (this._busy || window.SceneManager?.isLoading)) reason = '正在切换场景，暂不可下令。';
        if (!reason && army.battle) reason = '该分遣军已接战；可撤退后再下达行军命令。';
        const activeBattle = this.inBattle && this.state.encounter?.cellId === cellId;
        if (activeBattle && order) Object.assign(order, { action: 'reinforce', label: '行军增援当前战场', allowHostileTarget: true });
        const enemy = this.state.enemies.find((item) => item.id === order?.targetId);
        if (!reason && !activeBattle && (order.action === 'relieve' || enemy?.warId)) reason = '已展开的基地战场需亲征解围；分遣军可拦截尚在行军的敌军。';
        if (!reason && order.action === 'enter') reason = this.baseEntryBlockReason(this.baseEntry(order.targetId));
        const waypoints = append && army?.destination && army.order === 'move'
            ? [...(army.waypoints || []), army.destination] : [];
        if (!reason && waypoints.length >= this.config.march.maxRouteStops) reason = '途经点数量已达上限。';
        if (!reason && append && ['enter', 'destroy', 'pursue', 'reinforce'].includes(army.intent?.action)) reason = '攻击、增援或归营是路线终点，请普通右键重新下令。';
        const estimate = !reason && this._supportRoute(army, cellId, !!order.allowHostileTarget, waypoints);
        if (!reason && !estimate) reason = '山脉、河流或敌方占格阻断了路线。';
        return { ok: !reason, reason, order, waypoints, route: estimate?.route || [], stops: estimate?.stops || [], durationMs: estimate?.durationMs || 0 };
    },
    orderDetachment(id, cellId, enemyId = null, options = {}) {
        const preview = this.previewDetachmentOrder(id, cellId, enemyId, options);
        if (!preview.ok) return preview;
        const army = this.state.detachments.find((item) => item.id === id);
        Object.assign(army, { intent: preview.order, destination: preview.order.cellId, route: preview.route,
            waypoints: preview.waypoints, routeIssuedAt: strategicNow(), order: 'move', orderNote: preview.order.label,
            entryTarget: preview.order.action === 'enter' ? this.baseEntry(preview.order.targetId) : null });
        this._prepareDetachment(army, strategicNow());
        return { ok: true };
    },
    haltDetachment(id) {
        if (this.supportCommandBlocked()) return { ok: false, reason: '切换场景期间不能修改军团命令。' };
        const army = this.state.detachments.find((item) => item.id === id);
        if (!army || army.battle) return { ok: false, reason: '军团已接战，请使用撤退。' };
        Object.assign(army, { intent: null, entryTarget: null, destination: army.march?.toCellId || army.cellId,
            route: army.march ? [army.march.toCellId] : [], waypoints: [], order: army.march ? 'move' : 'hold', orderNote: '当前路段结束后待命。' });
        return { ok: true };
    },
    _releaseDetachmentBattle(army) {
        const battle = army.battle;
        if (!battle) return;
        const enemy = this.state.enemies.find((item) => item.id === battle.enemyId);
        const site = this.state.sites.find((item) => item.id === battle.siteId);
        if (enemy?.detachmentBattleId === army.id) enemy.detachmentBattleId = null;
        if (site?.detachmentBattleId === army.id) site.detachmentBattleId = null;
        army.battle = null;
    },
    retreatDetachment(id) {
        if (this.supportCommandBlocked()) return { ok: false, reason: '切换场景期间不能修改军团命令。' };
        const army = this.state.detachments.find((item) => item.id === id);
        if (!army?.battle) return { ok: false, reason: '该军团没有正在进行的战斗。' };
        const previous = army.previousCellId;
        if (!previous || this.hostileCells().has(previous) || !this._supportRoute(army, previous)) return { ok: false, reason: '来路已被截断，不能安全撤退。' };
        this._releaseDetachmentBattle(army);
        Object.assign(army, { destination: previous, waypoints: [], intent: { action: 'move', cellId: previous }, order: 'move', retreating: true });
        const route = this._supportRoute(army, previous);
        army.route = route.route; this._startMarch(army, army.route[0], strategicNow());
        return { ok: true };
    },
    _contactDetachment(army, now) {
        if (army.march || army.retreating) return false;
        if (this.state.encounter?.cellId === army.cellId) {
            if (this.inBattle && !this._pendingBattleReturn && !this._battle?.result().victory) this._tryReinforcement(army);
            army.orderNote = '已抵达亲征战场，等待从边缘入场。'; return true;
        }
        const enemy = this.state.enemies.find((item) => item.cellId === army.cellId);
        const site = !enemy && this.state.sites.find((item) => item.cellId === army.cellId && item.owner === 'enemy' && item.status === 'active');
        const target = enemy || site;
        if (!target) return false;
        if (enemy?.warId || (target.detachmentBattleId && target.detachmentBattleId !== army.id)) {
            army.orderNote = '目标已在交战，军团等待；亲征战场允许到场增援。'; return true;
        }
        if (!army.battle) {
            army.battle = { enemyId: enemy?.id, siteId: site?.id, lastAt: now,
                friendlyBefore: Troops.getArmyPower(army.id).units };
            target.detachmentBattleId = army.id;
            if (enemy) enemy.march = null;
            Object.assign(army, { route: [], waypoints: [], order: 'battle', orderNote: '分遣军正在进行后台战斗，战损持续计入兵力账本。' });
            this.recordEvent('battle', `${army.name}接战`, target.name, { armyId: army.id, cellId: army.cellId });
        }
        return true;
    },
    _prepareDetachment(army, now) {
        if (army.march || army.battle) return;
        if (this._contactDetachment(army, now)) return;
        if (army.intent?.action === 'pursue') {
            const enemy = this.getVisibleEnemies().find((item) => item.id === army.intent.targetId);
            if (!enemy) { this.haltDetachment(army.id); army.orderNote = '追击目标失去踪迹，军团待命。'; return; }
            army.destination = enemy.cellId;
        }
        if (army.entryTarget && this.baseEntryBlockReason(army.entryTarget)) {
            this.haltDetachment(army.id); army.orderNote = '接收基地已失效或交战，请重新选择基地。'; return;
        }
        while (army.waypoints?.[0] === army.cellId) army.waypoints.shift();
        if (army.entryTarget && army.cellId === army.entryTarget.cellId && !army.waypoints.length) {
            const base = army.entryTarget;
            this._settleSupply();
            const receipt = Troops.releaseStrategicTroops(base.sceneId, Troops._sourcePortalPoint(base.sceneId), army.id);
            this._returnArmyFood(army, base);
            this.state.detachments = this.state.detachments.filter((item) => item !== army);
            const event = this.recordEvent('base_entry', `${army.name}已归营`, `登记 ${receipt.accepted} 名，落地 ${receipt.deployed} 名，等待落地 ${receipt.pending} 名。`,
                { armyId: army.id, cellId: army.cellId, sceneId: base.sceneId, phase: 'complete', receipt }, { announce: false });
            this.notify(`${army.name}已归营：登记 ${receipt.accepted} 名，伤员 ${receipt.wounded} 名，等待落地 ${receipt.pending} 名。`, {
                tone: receipt.unaccounted ? 'warning' : 'success',
                onComplete: () => this.announceEvent(event.id),
            });
            if (window.SceneManager?.currentScene === base.sceneId) this._refreshReturnedAssets();
            return;
        }
        if (!army.destination || army.order === 'hold') return;
        const estimate = this._supportRoute(army, army.destination, !!army.intent?.allowHostileTarget, army.waypoints || []);
        if (!estimate) { this.haltDetachment(army.id); army.orderNote = '路线受阻，军团待命。'; return; }
        army.route = estimate.route;
        if (!army.route.length) { army.order = 'hold'; army.orderNote = '已抵达目标格。'; return; }
        this._startMarch(army, army.route[0], Math.max(now, army.routeIssuedAt || 0));
    },
    _advanceDetachmentBattles(now) {
        for (const army of [...this.state.detachments]) {
            const battle = army.battle;
            if (!battle) continue;
            if (this.state.encounter?.cellId === army.cellId) { this._releaseDetachmentBattle(army); continue; }
            const enemy = this.state.enemies.find((item) => item.id === battle.enemyId);
            const site = this.state.sites.find((item) => item.id === battle.siteId && item.status === 'active');
            const target = enemy || site;
            if (!target) { this._releaseDetachmentBattle(army); army.order = 'hold'; continue; }
            const step = this.config.playerArmies.combatStepGameMs;
            if (now - battle.lastAt < step) continue;
            // At most one bounded combat slice per army per strategic tick; no physics outside the live field.
            battle.lastAt += step;
            const friendly = Troops.getArmyPower(army.id), hostile = strategicRosterPower(target.roster);
            const structures = site?.structures || [];
            const wallHp = structures.reduce((sum, item) => sum + Math.max(0, item.hp), 0);
            const fullHp = structures.reduce((sum, item) => sum + item.maxHp, 0);
            const defense = hostile.dps + (site ? this.config.sites[site.kind].defenseDps * wallHp / Math.max(1, fullHp) : 0);
            const attack = friendly.dps * (army.supply?.food > 0 ? 1 : this.config.supply.emptyCombatMultiplier);
            const seconds = Math.min(step / 1000, defense > 0 ? friendly.hp / defense : Infinity,
                attack > 0 ? (hostile.hp + wallHp) / attack : Infinity);
            let damage = attack * seconds;
            target.roster = damageStrategicRoster(target.roster, damage);
            damage = Math.max(0, damage - hostile.hp);
            for (const structure of [...structures].reverse()) {
                const dealt = Math.min(Math.max(0, structure.hp), damage); structure.hp -= dealt; damage -= dealt;
            }
            Troops.damageArmy(army.id, defense * seconds);
            const alive = Troops.getArmyPower(army.id).units > 0;
            const victory = !target.roster.length && structures.every((item) => item.hp <= 0);
            if (!alive || victory) {
                this._releaseDetachmentBattle(army); army.order = 'hold'; army.destination = null; army.intent = null;
                if (victory && enemy) {
                    if (enemy.invasion) this.applyInvasionInterception(enemy, { roster: [] }, true, {});
                    else this.state.enemies = this.state.enemies.filter((item) => item !== enemy);
                    if (enemy.objective) Progression.secureWorldSignal(enemy.objective);
                }
                if (victory && site) this.applySettlementResult(site.id, { roster: [], structures }, true, 'destroy');
                if (!alive) {
                    Troops.discardEmptyArmy(army.id);
                    this.state.detachments = this.state.detachments.filter((item) => item !== army);
                }
                army.orderNote = alive ? '战斗胜利，幸存部队待命。' : '分遣军全军覆没，携粮损失。';
                const survivors = Troops.getArmyPower(army.id).units;
                const casualties = Math.max(0, Math.floor(Number(battle.friendlyBefore) || 0) - survivors);
                const event = this.recordEvent('battle_result', `${army.name}${alive ? '战斗胜利' : '全军覆没'}`,
                    `${army.orderNote} 幸存 ${survivors} 名，伤亡 ${casualties} 名。`, {
                        armyId: army.id,
                        cellId: army.cellId,
                        sceneId: strategicCell(army.cellId)?.planeSceneId || null,
                        outcome: alive ? 'victory' : 'defeat',
                        casualties,
                        survivors,
                        lootCount: 0,
                    }, { announce: false });
                this.notify(`${event.title}：幸存 ${survivors} 名，伤亡 ${casualties} 名。`, {
                    tone: alive ? 'success' : 'danger',
                    onComplete: () => this.announceEvent(event.id),
                });
            }
        }
    },
    async _tryReinforcement(army) {
        if (army._reinforcing || this._reinforcementInFlight || !this.inBattle || this._busy) return;
        const encounter = this.state.encounter;
        if (army.reinforcementFor !== encounter.id) {
            army.reinforcementFor = encounter.id; army.reinforcedCount = 0; army.reinforcementEventId = null;
        }
        army._reinforcing = true;
        this._reinforcementInFlight = army;
        try {
            const result = await this._battle.addReinforcements(army, this, encounter);
            if (!result) return;
            encounter.friendlyBefore = Math.max(0, Number(encounter.friendlyBefore) || 0) + result.count;
            const transferredFood = result.remaining ? Math.floor(army.supply.food * result.count / (result.count + result.remaining)) : army.supply.food;
            this.state.army.supply.food += transferredFood; army.supply.food -= transferredFood;
            if (!result.remaining) {
                this.state.detachments = this.state.detachments.filter((item) => item !== army);
                for (const convoy of this.state.convoys) if (convoy.targetArmyId === army.id) convoy.targetArmyId = this.state.army.id;
            }
            army.reinforcedCount = (army.reinforcedCount || 0) + result.count;
            const detail = `${army.reinforcedCount} 名士兵已从战场边缘增援，${result.remaining} 名等待入场；入场部队并入亲征军团，战后统一回归。`;
            if (army.reinforcementEventId) this.updateEvent(army.reinforcementEventId, { detail });
            else army.reinforcementEventId = this.recordEvent('arrival', `${army.name}加入战斗`, detail,
                { armyId: this.state.army.id, cellId: army.cellId }).id;
            if (!result.remaining) this.notify(`${army.name}已到场增援（${army.reinforcedCount} 名），战损归入亲征军团。`);
        } catch (error) { army.orderNote = `增援等待入场：${error.message}`; }
        finally { delete army._reinforcing; if (this._reinforcementInFlight === army) this._reinforcementInFlight = null; }
    },
    _restoreSupport(now) {
        this.state.detachments = Array.isArray(this.state.detachments) ? this.state.detachments : [];
        this.state.convoys = Array.isArray(this.state.convoys) ? this.state.convoys : [];
        const ids = new Set();
        this.state.detachments = this.state.detachments.filter((army) => army?.id?.startsWith('detachment_') && !ids.has(army.id) && (ids.add(army.id), true));
        // Preserve a troop ledger orphan as a controllable army, never silently delete its soldiers.
        for (const id of Troops.strategicArmyIds()) if (!ids.has(id)) {
            const record = Troops.serializeStrategicTroops(id)[0], base = this.baseEntry(record?.originSceneId);
            this.state.detachments.push({ id, kind: 'detachment', name: '待命分遣军', cellId: base?.cellId || this.state.army?.cellId || this.getSettlements()[0]?.cellId,
                originSceneId: base?.sceneId, originEpoch: base?.worldEpoch, originCellId: base?.cellId, order: 'hold' });
        }
        for (const army of this.playerArmies()) {
            const supply = army.supply;
            army.supply = { food: Math.max(0, Math.floor(Number(supply?.food) || 0)),
                lastAt: Number.isFinite(supply?.lastAt) ? Math.max(0, Math.min(now, supply.lastAt)) : now,
                fraction: Number.isFinite(supply?.fraction) ? Math.max(0, Math.min(0.999999, supply.fraction)) : 0 };
            if (army.supplyLine) army.supplyLine.nextAt = now;
            delete army._reinforcing;
        }
        for (const army of this.state.detachments) {
            army.kind = 'detachment'; army.route = Array.isArray(army.route) ? army.route : [];
            army.waypoints = Array.isArray(army.waypoints) && army.waypoints.length < this.config.march.maxRouteStops ? army.waypoints : [];
            if (!strategicCell(army.cellId)) army.cellId = this.baseEntry(army.originSceneId)?.cellId || this.state.army?.cellId || this.getSettlements()[0]?.cellId;
            if (army.battle) army.battle.lastAt = Math.min(now, Number(army.battle.lastAt) || now);
        }
        for (const target of [...this.state.enemies, ...this.state.sites]) target.detachmentBattleId = null;
        for (const army of this.state.detachments) if (army.battle) {
            const target = this.state.enemies.find((enemy) => enemy.id === army.battle.enemyId)
                || this.state.sites.find((site) => site.id === army.battle.siteId && site.owner === 'enemy' && site.status === 'active');
            if (target && target.cellId === army.cellId && !target.warId && !target.detachmentBattleId) {
                target.detachmentBattleId = army.id; target.march = null; army.march = null;
            } else { army.battle = null; army.order = 'hold'; }
        }
        for (const convoy of this.state.convoys) {
            convoy.kind = 'convoy'; convoy.food = Math.max(0, Math.floor(Number(convoy.food) || 0));
            convoy.route = Array.isArray(convoy.route) ? convoy.route : [];
        }
        const largestId = [...this.state.detachments, ...this.state.convoys].reduce((max, unit) => Math.max(max, Number(unit.id?.split('_').at(-1)) || 0), 0);
        this.state.nextId = Math.max(this.state.nextId, largestId + 1);
    },
};
