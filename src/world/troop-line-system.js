// ============================================================
// Global troop-line control and cross-plane reinforcement.
// Serialized records remain authoritative until a replacement entity is
// created successfully, so scene failures cannot silently delete troops.
// ============================================================
import { WorldProgressionSystem } from './world-progression-system.js';
import { getUnitKind } from './unit-upgrade-store.js';
import { isSpawnPositionFree } from './spawn-placement.js';
import { WallSystem } from './wall-system.js';

const VERSION = 2;
const MODES = new Set(['follow', 'hold', 'rally']);
const MILITARY_KINDS = new Set([
    'militia', 'warrior', 'shooter', 'guard', 'scout', 'musketeer', 'priest', 'knight', 'light_cavalry',
]);
const PERSISTENT_WORLDS = new Set(['scene8', 'scene9', 'scene10', 'scene11']);
const PORTAL_ARRIVE_DISTANCE = 82;
const RALLY_ARRIVE_DISTANCE = 58;
const UNIT_RADIUS = 24;
const MATERIALIZE_RETRY_MS = 750;

const game = () => (typeof window !== 'undefined' ? window.Game : null);
const sceneManager = () => (typeof window !== 'undefined' ? window.SceneManager : null);
const clone = (value) => JSON.parse(JSON.stringify(value));

function aliveMilitaryUnit(unit) {
    return !!(unit && unit.active !== false && !unit._dying && unit.data?.hp > 0 && getUnitKind(unit)
        && (unit._troopProducer || unit._troopLineDetached || unit._barracks?._isTroopProducer));
}

function removeOnce(list, value) {
    if (!Array.isArray(list)) return;
    const index = list.indexOf(value);
    if (index >= 0) list.splice(index, 1);
}

function currentEpoch(sceneId) {
    return PERSISTENT_WORLDS.has(sceneId) ? WorldProgressionSystem.getWorldEpoch(sceneId) : 0;
}

function aliveLocalCount(producer) {
    return (producer?.units || []).filter((unit) => aliveMilitaryUnit(unit)).length;
}

function normalizeTarget(target) {
    if (!target || !target.sceneId || !Number.isFinite(Number(target.x)) || !Number.isFinite(Number(target.y))) {
        return null;
    }
    return {
        sceneId: target.sceneId,
        worldEpoch: Number(target.worldEpoch) || currentEpoch(target.sceneId),
        x: Number(target.x),
        y: Number(target.y),
        z: Math.max(0, Number(target.z) || 0),
        surfaceKind: target.surfaceKind || 'ground',
        wallId: target.wallId || null,
        staircaseId: target.staircaseId || null,
    };
}

export const TroopLineSystem = {
    mode: 'follow',
    rally: null,
    _pendingByWorld: {},
    _liveDetached: new Set(),
    _portalTravelRecords: new Set(),
    _companionResidency: {},
    _createMilitaryUnit: null,
    _getMilitaryUnitProfile: null,
    _isSnapshotTroopProducer: null,
    _nextMaterializeRetryAt: 0,
    _seq: 0,
    _revision: 0,

    configure({ createMilitaryUnit, getMilitaryUnitProfile, isSnapshotTroopProducer } = {}) {
        if (typeof createMilitaryUnit === 'function') this._createMilitaryUnit = createMilitaryUnit;
        if (typeof getMilitaryUnitProfile === 'function') this._getMilitaryUnitProfile = getMilitaryUnitProfile;
        if (typeof isSnapshotTroopProducer === 'function') this._isSnapshotTroopProducer = isSnapshotTroopProducer;
    },

    reset() {
        for (const unit of Array.from(this._liveDetached)) this._detachUnit(unit);
        this.mode = 'follow';
        this.rally = null;
        this._pendingByWorld = {};
        this._liveDetached.clear();
        this._portalTravelRecords.clear();
        this._companionResidency = {};
        this._nextMaterializeRetryAt = 0;
        this._seq = 0;
        this._revision++;
    },

    getState() {
        this.validateRally();
        return {
            mode: this.mode,
            rally: this.rally ? { ...this.rally } : null,
            revision: this._revision,
            ...this.getSummary(),
        };
    },

    getSummary() {
        let transit = 0;
        let garrisoned = 0;
        for (const records of Object.values(this._pendingByWorld)) {
            for (const record of records || []) {
                if (record?.state === 'transit') transit++;
                else garrisoned++;
            }
        }
        const producers = this.getLiveProducers();
        return {
            transit,
            garrisoned: garrisoned + Array.from(this._liveDetached).filter(aliveMilitaryUnit).length,
            assigned: producers.reduce((sum, producer) => sum + this.countAssignedToProducer(producer), 0),
            capacity: producers.reduce((sum, producer) => sum + Math.max(0, producer.unitCount?.() || 0), 0),
        };
    },

    setMode(mode) {
        if (!MODES.has(mode) || mode === 'rally') return false;
        this.mode = mode;
        this.rally = null;
        this._revision++;
        return true;
    },

    setRally(sceneId, point) {
        if (!PERSISTENT_WORLDS.has(sceneId) || !point
            || !Number.isFinite(point.x) || !Number.isFinite(point.y)
            || !WorldProgressionSystem.isPortalConstructed(sceneId)) return false;
        const worldEpoch = currentEpoch(sceneId);
        if (!(worldEpoch > 0)) return false;
        this.mode = 'rally';
        this.rally = normalizeTarget({ sceneId, worldEpoch, ...point });
        this._revision++;
        return !!this.rally;
    },

    validateRally({ notify = false } = {}) {
        if (this.mode !== 'rally' || !this.rally) return this.mode !== 'rally';
        if (this._isTargetCurrent(this.rally)) return true;
        this.mode = 'follow';
        this.rally = null;
        this._revision++;
        if (notify) sceneManager()?.showTopNotification?.('集结位面已失效，兵线恢复为跟随', {
            color: '#ffcc66', fontSize: '24px', duration: 3200,
        });
        return false;
    },

    isTroopProducer(building) {
        return !!(building && building._isTroopProducer && building.spawnEnabled !== false
            && typeof building.spawnUnit === 'function');
    },

    getLiveProducers() {
        const g = game();
        if (!g) return [];
        return [
            ...(g.HamsterBarracksSystem?.barracks || []),
            ...(g.ProducerBuildingSystem?.buildings || []),
        ].filter((building) => this.isTroopProducer(building) && building.active !== false);
    },

    countAssignedToProducer(producer) {
        if (!producer?.id) return aliveLocalCount(producer);
        const originSceneId = sceneManager()?.currentScene || null;
        return aliveLocalCount(producer) + this.countDeployedForProducer(
            producer.id,
            originSceneId,
            currentEpoch(originSceneId)
        );
    },

    countDeployedForProducer(producerId, originSceneId = null, originWorldEpoch = null) {
        if (!producerId) return 0;
        const matchesOrigin = (record) => record?.originProducerId === producerId
            && (!originSceneId || record.originSceneId === originSceneId)
            && (originWorldEpoch === null || originWorldEpoch === undefined
                || Number(record.originWorldEpoch) === Number(originWorldEpoch));
        let count = 0;
        for (const records of Object.values(this._pendingByWorld)) {
            count += (records || []).filter(matchesOrigin).length;
        }
        for (const record of this._portalTravelRecords) {
            if (matchesOrigin(record)) count++;
        }
        for (const unit of this._liveDetached) {
            if (aliveMilitaryUnit(unit) && matchesOrigin({
                originProducerId: unit._troopLineOriginProducerId,
                originSceneId: unit._troopLineOriginSceneId,
                originWorldEpoch: unit._troopLineOriginWorldEpoch,
            })) count++;
        }
        return count;
    },

    getSpawnDirectionTarget(sourceSceneId, building) {
        if (this.mode === 'hold') return { x: building.x, y: building.y };
        if (this.mode === 'rally' && this.validateRally()) {
            if (this.rally.sceneId === sourceSceneId) return this.rally;
            return this._sourcePortalPoint(sourceSceneId) || { x: building.x, y: building.y };
        }
        return game()?._observerMode ? { x: building.x, y: building.y } : game()?.player;
    },

    onUnitProduced(unit, producer, sourceSceneId, { restoring = false } = {}) {
        if (!unit || !this.isTroopProducer(producer)) return;
        const sceneId = sourceSceneId || sceneManager()?.currentScene;
        unit._troopProducer = true;
        unit._troopLineOriginProducerId = producer.id || null;
        unit._troopLineOriginSceneId = sceneId || null;
        unit._troopLineOriginWorldEpoch = currentEpoch(sceneId);
        this._revision++;
        if (!aliveMilitaryUnit(unit) || restoring) return;
        if (this.mode === 'hold') {
            unit._command = { mode: 'hold', point: null, target: null };
            return;
        }
        if (this.mode !== 'rally' || !this.validateRally({ notify: true })) {
            unit._command = { mode: 'follow', point: null, target: null };
            return;
        }
        if (this.rally.sceneId === sceneId) {
            this._issueRallyMove(unit, this.rally);
            return;
        }
        const portal = this._sourcePortalPoint(sceneId);
        if (!portal) {
            unit._command = { mode: 'hold', point: null, target: null };
            return;
        }
        unit._troopLineTransit = { sourceSceneId: sceneId, target: { ...this.rally } };
        unit._command = { mode: 'move', point: { ...portal, route: [] }, target: null };
    },

    update(sceneId) {
        if (!sceneId) return;
        this.validateRally({ notify: true });
        const g = game();
        if (!g?.entities) return;
        if (this._pendingByWorld[sceneId]?.length
            && Date.now() >= this._nextMaterializeRetryAt) {
            this._flushIfLive(sceneId);
        }
        for (const unit of Array.from(g.entities.values())) {
            if (!aliveMilitaryUnit(unit)) continue;
            if (unit._troopLineRally) {
                const target = unit._troopLineRally;
                if (!this._isTargetCurrent(target)) {
                    delete unit._troopLineRally;
                    unit._command = { mode: 'follow', point: null, target: null };
                } else if (Math.hypot(unit.x - target.x, unit.y - target.y) <= RALLY_ARRIVE_DISTANCE) {
                    delete unit._troopLineRally;
                    unit._command = { mode: 'hold', point: null, target: null };
                    unit.vx = 0; unit.vy = 0; unit.isMoving = false;
                }
            }
            const transit = unit._troopLineTransit;
            if (!transit) continue;
            if (!this._isTargetCurrent(transit.target)) {
                delete unit._troopLineTransit;
                unit._command = { mode: 'follow', point: null, target: null };
                continue;
            }
            const portal = this._sourcePortalPoint(sceneId);
            if (!portal) continue;
            if (Math.hypot(unit.x - portal.x, unit.y - portal.y) <= PORTAL_ARRIVE_DISTANCE) {
                const record = this._recordUnit(unit, transit.target, 'transit');
                this._detachUnit(unit);
                this._enqueue(transit.target.sceneId, record);
                this._flushIfLive(transit.target.sceneId);
            }
        }
        this._pruneDeadDetached();
    },

    preparePortalTravel(fromSceneId, toSceneId) {
        const g = game();
        const travel = { fromSceneId, toSceneId, troops: [], companionIds: [] };
        if (!g?.entities) return travel;
        const partyMembers = new Set(g.PartySystem?.members || []);
        for (const unit of Array.from(g.entities.values())) {
            if (!aliveMilitaryUnit(unit) || partyMembers.has(unit)) continue;
            if ((unit._command?.mode || 'follow') !== 'follow') continue;
            const record = this._recordUnit(unit, null, 'travel');
            travel.troops.push(record);
            this._portalTravelRecords.add(record);
            this._detachUnit(unit);
        }
        for (const member of g.PartySystem?.members || []) {
            if (member?.active === false) continue;
            this._storeCompanionResidency(member, fromSceneId);
            if ((member?._command?.mode || 'follow') === 'follow') travel.companionIds.push(member.id);
        }
        this._revision++;
        return travel;
    },

    completePortalTravel(travel, toSceneId, player) {
        if (!travel) return;
        const destination = player ? {
            sceneId: toSceneId,
            worldEpoch: currentEpoch(toSceneId),
            x: player.x,
            y: player.y,
            z: Number(player.z) || 0,
            surfaceKind: player._surfaceKind || 'ground',
        } : this._defaultArrival(toSceneId);
        const result = this._materializeRecords(travel.troops || [], toSceneId, destination, 'follow');
        for (const record of travel.troops || []) this._portalTravelRecords.delete(record);
        for (const record of result.retained) {
            record.target = normalizeTarget(destination);
            record.state = 'garrisoned';
            this._enqueue(toSceneId, record);
        }
        const party = game()?.PartySystem;
        for (let i = 0; i < (travel.companionIds || []).length; i++) {
            const member = party?.getMember?.(travel.companionIds[i]);
            if (!member || !player) continue;
            member.active = true;
            party.setCommand(member.id, 'follow');
            member.x = player.x - 42 - (i % 3) * 34;
            member.y = player.y + (Math.floor(i / 3) - 1) * 34;
            member.z = Number(player.z) || 0;
            member._surfaceKind = player._surfaceKind || 'ground';
            this._clearCompanionMotion(member);
            this._storeCompanionResidency(member, toSceneId);
        }
        this._revision++;
    },

    rollbackPortalTravel(travel) {
        if (!travel) return;
        const result = this._materializeRecords(travel.troops || [], travel.fromSceneId, null, 'follow');
        for (const record of travel.troops || []) this._portalTravelRecords.delete(record);
        for (const record of result.retained) {
            record.target = normalizeTarget(this._defaultArrival(travel.fromSceneId));
            record.state = 'garrisoned';
            this._enqueue(travel.fromSceneId, record);
        }
        const party = game()?.PartySystem;
        for (const companionId of travel.companionIds || []) {
            const member = party?.getMember?.(companionId);
            if (!member) continue;
            const saved = this._companionResidency[companionId];
            member.active = true;
            if (saved) this._restoreCompanionResidency(member, saved);
        }
        this._revision++;
    },

    onSceneLeaving(sceneId) {
        const g = game();
        // 当地生产单位仍在走向传送门/集结点时，普通离场快照只能保存兵种数量，
        // 无法保存逐单位路线。离场前将这些明确在途单位提升为权威兵线记录，
        // 避免回场恢复后悄悄退回默认 AI 并丢失跨位面命令。
        for (const unit of Array.from(g?.entities?.values?.() || [])) {
            if (!aliveMilitaryUnit(unit) || this._liveDetached.has(unit)) continue;
            const target = unit._troopLineTransit?.target || unit._troopLineRally;
            if (!target || !this._isTargetCurrent(target)) continue;
            const record = this._recordUnit(unit, target, 'transit');
            this._detachUnit(unit);
            this._enqueue(target.sceneId, record);
        }
        for (const unit of Array.from(this._liveDetached)) {
            if (unit._troopLineWorldId !== sceneId) continue;
            if (!aliveMilitaryUnit(unit)) {
                this._detachUnit(unit);
                continue;
            }
            this._enqueue(sceneId, this._recordUnit(unit, {
                sceneId,
                worldEpoch: currentEpoch(sceneId),
                x: unit.x,
                y: unit.y,
                z: Number(unit.z) || 0,
                surfaceKind: unit._surfaceKind || 'ground',
                wallId: unit._surfaceWall?.id || null,
                staircaseId: unit._surfaceStaircase?.id || null,
            }, 'garrisoned'));
            this._detachUnit(unit);
        }
    },

    onSceneEntered(sceneId) {
        this.validateRally({ notify: true });
        this._syncCompanionResidencyForScene(sceneId);
        this._flushIfLive(sceneId, true);
    },

    invalidateWorld(sceneId) {
        const manager = sceneManager();
        const g = game();
        const mainAnchor = manager?.currentScene === 'main'
            ? g?.player
            : (manager?._mainPlayerPos || manager?.scenes?.main?.origin || null);
        delete this._pendingByWorld[sceneId];
        for (const unit of Array.from(this._liveDetached)) {
            if (unit._troopLineWorldId === sceneId) this._detachUnit(unit);
        }
        for (const [companionId, residence] of Object.entries(this._companionResidency)) {
            if (residence?.sceneId !== sceneId) continue;
            const member = g?.PartySystem?.getMember?.(companionId);
            const mainResidence = {
                ...residence,
                sceneId: 'main', worldEpoch: 0,
                command: { mode: 'follow', point: null },
                x: Number(mainAnchor?.x) || 0, y: Number(mainAnchor?.y) || 0,
                z: 0, surfaceKind: 'ground',
            };
            this._companionResidency[companionId] = mainResidence;
            if (member) {
                member._command = { mode: 'follow', point: null, target: null };
                member.active = manager?.currentScene === 'main';
                if (member.active) this._restoreCompanionResidency(member, mainResidence);
                else this._clearCompanionMotion(member);
            }
        }
        if (this.rally?.sceneId === sceneId) {
            this.mode = 'follow';
            this.rally = null;
            manager?.showTopNotification?.('集结位面已毁灭，兵线恢复为跟随', {
                color: '#ffcc66', fontSize: '24px', duration: 3600,
            });
        }
        this._revision++;
    },

    captureProductionBaseline(snapshot) {
        const result = [];
        for (let i = 0; i < (snapshot?.structures || []).length; i++) {
            const structure = snapshot.structures[i];
            if (!this._snapshotIsTroopProducer(structure)) continue;
            result.push({
                index: i,
                producerId: structure.id || null,
                roster: { ...(structure.unitRoster || {}) },
            });
        }
        return result;
    },

    syncSnapshotAssignments(sceneId, snapshot) {
        const worldEpoch = Number(snapshot?.worldEpoch) || currentEpoch(sceneId);
        for (const structure of snapshot?.structures || []) {
            if (!this._snapshotIsTroopProducer(structure)) continue;
            structure.troopLineDeployed = structure.id
                ? this.countDeployedForProducer(structure.id, sceneId, worldEpoch)
                : Math.max(0, Number(structure.troopLineDeployed) || 0);
        }
    },

    onBackgroundProduction(sourceSceneId, snapshot, baseline) {
        if (this.mode !== 'rally' || !this.validateRally() || this.rally.sceneId === sourceSceneId) return 0;
        let moved = 0;
        for (const before of baseline || []) {
            const structure = snapshot?.structures?.[before.index];
            if (!structure || !this._snapshotIsTroopProducer(structure)) continue;
            let movedForStructure = 0;
            const roster = { ...(structure.unitRoster || {}) };
            const afterCount = Object.values(roster).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
            for (const [kind, rawAfter] of Object.entries(roster)) {
                const delta = Math.max(0, Math.floor(Number(rawAfter) || 0)
                    - Math.floor(Number(before.roster[kind]) || 0));
                if (!delta) continue;
                roster[kind] -= delta;
                if (roster[kind] <= 0) delete roster[kind];
                for (let i = 0; i < delta; i++) {
                    this._enqueue(this.rally.sceneId, {
                        unitId: this._nextUnitId('troop_line_bg'),
                        kind,
                        hpRatio: 1,
                        state: 'transit',
                        target: { ...this.rally },
                        sourceSceneId,
                        originProducerId: structure.id || before.producerId || null,
                        originSceneId: sourceSceneId,
                        originWorldEpoch: Number(snapshot?.worldEpoch) || currentEpoch(sourceSceneId),
                    });
                }
                moved += delta;
                movedForStructure += delta;
            }
            const remaining = Object.values(roster).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
            structure.unitRoster = roster;
            structure.units = remaining;
            structure.troopLineDeployed = Math.max(0, Number(structure.troopLineDeployed) || 0) + movedForStructure;
            if (afterCount > 0 && Number.isFinite(structure.unitDps)) {
                structure.unitDps = Math.round(structure.unitDps * remaining / afterCount);
            }
        }
        if (moved) {
            this._revision++;
            this._flushIfLive(this.rally.sceneId);
        }
        return moved;
    },

    getBackgroundDefense(sceneId, worldEpoch) {
        let dps = 0;
        let hp = 0;
        let units = 0;
        for (const record of this._pendingByWorld[sceneId] || []) {
            if (!this._recordBelongsToWorld(record, sceneId, worldEpoch)) continue;
            const profile = this._getMilitaryUnitProfile?.(record.kind);
            if (!profile) continue;
            dps += Math.max(0, Number(profile.dps) || 0);
            hp += Math.max(1, Number(profile.maxHp) || 1) * Math.max(0.01, Number(record.hpRatio) || 1);
            units++;
        }
        return { dps, hp, units };
    },

    applyBackgroundAttrition(sceneId, worldEpoch, damage) {
        let left = Math.max(0, Number(damage) || 0);
        if (!(left > 0)) return 0;
        const records = this._pendingByWorld[sceneId] || [];
        const survivors = [];
        const before = left;
        for (const record of records) {
            if (!this._recordBelongsToWorld(record, sceneId, worldEpoch) || left <= 0) {
                survivors.push(record);
                continue;
            }
            const profile = this._getMilitaryUnitProfile?.(record.kind);
            const maxHp = Math.max(1, Number(profile?.maxHp) || 1);
            const unitHp = maxHp * Math.max(0.01, Number(record.hpRatio) || 1);
            const dealt = Math.min(unitHp, left);
            left -= dealt;
            const remainingHp = unitHp - dealt;
            if (remainingHp > 0.5) {
                record.hpRatio = Math.max(0.01, Math.min(1, remainingHp / maxHp));
                survivors.push(record);
            }
        }
        if (survivors.length) this._pendingByWorld[sceneId] = survivors;
        else delete this._pendingByWorld[sceneId];
        if (left !== before) this._revision++;
        return before - left;
    },

    serialize() {
        this.validateRally();
        this._pruneInvalidPending();
        const g = game();
        const residencyScene = g?._observerMode
            ? g._observerHomeScene
            : sceneManager()?.currentScene;
        for (const member of g?.PartySystem?.members || []) {
            if (member?.active !== false) this._storeCompanionResidency(member, residencyScene);
        }
        const pending = clone(this._pendingByWorld);
        for (const unit of this._liveDetached) {
            if (!aliveMilitaryUnit(unit)) continue;
            const sceneId = unit._troopLineWorldId;
            if (!sceneId) continue;
            if (!pending[sceneId]) pending[sceneId] = [];
            pending[sceneId].push(this._recordUnit(unit, {
                sceneId,
                worldEpoch: currentEpoch(sceneId),
                x: unit.x, y: unit.y, z: Number(unit.z) || 0,
                surfaceKind: unit._surfaceKind || 'ground',
                wallId: unit._surfaceWall?.id || null,
                staircaseId: unit._surfaceStaircase?.id || null,
            }, 'garrisoned'));
        }
        return {
            version: VERSION,
            mode: this.mode,
            rally: this.rally ? { ...this.rally } : null,
            pending,
            companionResidency: clone(this._companionResidency),
        };
    },

    restore(data) {
        this.reset();
        if (!data || (data.version !== 1 && data.version !== VERSION)) return;
        this.mode = MODES.has(data.mode) ? data.mode : 'follow';
        this.rally = normalizeTarget(data.rally);
        for (const [sceneId, records] of Object.entries(data.pending || {})) {
            if (!Array.isArray(records)) continue;
            const normalized = records
                .map((record) => this._normalizeRecord(record, sceneId))
                .filter((record) => record && MILITARY_KINDS.has(record.kind)
                    && (!record.target || this._isTargetCurrent(record.target)));
            if (normalized.length) this._pendingByWorld[sceneId] = normalized;
        }
        if (data.companionResidency && typeof data.companionResidency === 'object') {
            this._companionResidency = clone(data.companionResidency);
        }
        this.validateRally();
        this._revision++;
        const currentScene = sceneManager()?.currentScene;
        if (currentScene) this.onSceneEntered(currentScene);
    },

    _snapshotIsTroopProducer(structure) {
        if (!structure || (structure.kind !== 'barracks' && structure.kind !== 'producer')) return false;
        if (structure.kind === 'barracks') return true;
        if (structure.troopProducer === true) return true;
        if (structure.troopProducer === false) return false;
        return !!this._isSnapshotTroopProducer?.(structure.cfgKey);
    },

    _sourcePortalPoint(sceneId) {
        const portal = game()?.ProducerBuildingSystem?.buildings?.find((building) => (
            building?._isWorldPortalCore && building.active !== false && building._worldId === sceneId
                && !building._portalDestroyed && building.hp > 0
        ));
        if (portal) return { x: portal.x, y: portal.y, z: 0, surfaceKind: 'ground' };
        const configured = WorldProgressionSystem.getWorldConfig(sceneId)?.portalSpawn;
        return configured ? { x: configured.x, y: configured.y, z: 0, surfaceKind: 'ground' } : null;
    },

    _isTargetCurrent(target) {
        if (!target?.sceneId) return false;
        if (!PERSISTENT_WORLDS.has(target.sceneId)) return true;
        return WorldProgressionSystem.isPortalConstructed(target.sceneId)
            && WorldProgressionSystem.isWorldEpochCurrent(target.sceneId, target.worldEpoch);
    },

    _recordBelongsToWorld(record, sceneId, worldEpoch) {
        if (record?.target?.sceneId !== sceneId) return false;
        return !PERSISTENT_WORLDS.has(sceneId) || Number(record.target.worldEpoch) === Number(worldEpoch);
    },

    _recordUnit(unit, target, state = 'garrisoned') {
        const maxHp = Math.max(1, Number(unit.data?.maxHp ?? unit.maxHp) || 1);
        return this._normalizeRecord({
            unitId: unit.id || this._nextUnitId('troop_line'),
            kind: getUnitKind(unit),
            hpRatio: Math.max(0.01, Math.min(1, Number(unit.data?.hp ?? unit.hp) / maxHp)),
            statusEffects: (unit.statusEffects || [])
                .filter((effect) => effect && Number(effect.remaining) > 0)
                .map((effect) => ({ ...effect })),
            state,
            command: { mode: unit._command?.mode || 'hold' },
            target: target ? { ...target } : null,
            sourceSceneId: unit._troopLineTransit?.sourceSceneId
                || unit._troopLineWorldId || sceneManager()?.currentScene || null,
            originProducerId: unit._troopLineOriginProducerId || unit._barracks?.id || null,
            originSceneId: unit._troopLineOriginSceneId || unit._troopLineTransit?.sourceSceneId
                || sceneManager()?.currentScene || null,
            originWorldEpoch: unit._troopLineOriginWorldEpoch
                || currentEpoch(unit._troopLineOriginSceneId || sceneManager()?.currentScene),
        }, target?.sceneId || sceneManager()?.currentScene);
    },

    _normalizeRecord(record, sceneId) {
        if (!record || !MILITARY_KINDS.has(record.kind)) return null;
        const fallback = PERSISTENT_WORLDS.has(sceneId) ? this._sourcePortalPoint(sceneId) : null;
        const target = normalizeTarget(record.target) || (record.state !== 'travel' && fallback ? normalizeTarget({
            sceneId, worldEpoch: currentEpoch(sceneId), ...fallback,
        }) : null);
        return {
            unitId: record.unitId || this._nextUnitId('troop_line'),
            kind: record.kind,
            hpRatio: Math.max(0.01, Math.min(1, Number(record.hpRatio) || 1)),
            statusEffects: Array.isArray(record.statusEffects) ? clone(record.statusEffects) : [],
            state: ['travel', 'transit', 'garrisoned'].includes(record.state) ? record.state : 'garrisoned',
            command: record.command && typeof record.command === 'object'
                ? { mode: record.command.mode || 'hold' } : { mode: 'hold' },
            target,
            sourceSceneId: record.sourceSceneId || record.originSceneId || null,
            originProducerId: record.originProducerId || null,
            originSceneId: record.originSceneId || record.sourceSceneId || null,
            originWorldEpoch: Number(record.originWorldEpoch)
                || currentEpoch(record.originSceneId || record.sourceSceneId),
        };
    },

    _detachUnit(unit) {
        const g = game();
        if (!unit) return;
        removeOnce(unit._barracks?.units, unit);
        unit._barracks = null;
        if (g?.entities && unit.id) g.entities.delete(unit.id);
        removeOnce(g?.friendlyUnits, unit);
        this._liveDetached.delete(unit);
        unit.active = false;
        unit._destroyPhaserSprite?.();
    },

    _enqueue(sceneId, record) {
        const normalized = this._normalizeRecord(record, sceneId);
        if (!sceneId || !normalized) return false;
        if (!this._pendingByWorld[sceneId]) this._pendingByWorld[sceneId] = [];
        this._pendingByWorld[sceneId].push(normalized);
        this._revision++;
        return true;
    },

    _defaultArrival(sceneId) {
        const target = this.rally?.sceneId === sceneId ? this.rally : null;
        return target || this._sourcePortalPoint(sceneId) || game()?.player
            || { x: 0, y: 0, z: 0, surfaceKind: 'ground' };
    },

    _flushIfLive(sceneId, force = false) {
        const manager = sceneManager();
        if (!force && manager?.currentScene !== sceneId) return 0;
        const records = this._pendingByWorld[sceneId];
        if (!records?.length) return 0;
        const valid = records.filter((record) => !record.target || this._isTargetCurrent(record.target));
        const result = this._materializeRecords(valid, sceneId, this._defaultArrival(sceneId), 'hold');
        if (result.retained.length) {
            this._pendingByWorld[sceneId] = result.retained;
            this._nextMaterializeRetryAt = Date.now() + MATERIALIZE_RETRY_MS;
        } else {
            delete this._pendingByWorld[sceneId];
            this._nextMaterializeRetryAt = 0;
        }
        if (result.created > 0 || valid.length !== records.length) this._revision++;
        return result.created;
    },

    _materializeRecords(records, sceneId, anchor, commandMode) {
        const g = game();
        const result = { created: 0, retained: [] };
        if (!g?.entities || typeof this._createMilitaryUnit !== 'function') {
            result.retained.push(...(records || []));
            return result;
        }
        for (const record of records || []) {
            if (!record?.kind || (record.target && !this._isTargetCurrent(record.target))) continue;
            const destination = normalizeTarget(record.target);
            const needsRoute = record.state === 'transit'
                || (destination && destination.surfaceKind !== 'ground');
            const center = needsRoute
                ? (this._sourcePortalPoint(sceneId) || anchor || destination)
                : (destination || anchor || this._defaultArrival(sceneId));
            const spot = this._findSafeArrival(center, result.created);
            if (!spot) {
                result.retained.push(record);
                continue;
            }
            const unitId = record.unitId || this._nextUnitId('troop_line');
            const existing = g.entities.get(unitId);
            if (existing) {
                if (existing._troopLineDetached) result.created++;
                else result.retained.push(record);
                continue;
            }
            let unit;
            try {
                unit = this._createMilitaryUnit(record.kind, spot.x, spot.y, {
                    id: unitId,
                    hpRatio: record.hpRatio,
                });
            } catch (error) {
                console.error('[TroopLineSystem] reinforcement materialization failed:', error);
                result.retained.push(record);
                continue;
            }
            if (!unit) {
                result.retained.push(record);
                continue;
            }
            unit._troopProducer = true;
            unit._troopLineDetached = true;
            unit._troopLineWorldId = sceneId;
            unit._troopLineOriginProducerId = record.originProducerId || null;
            unit._troopLineOriginSceneId = record.originSceneId || record.sourceSceneId || null;
            unit._troopLineOriginWorldEpoch = Number(record.originWorldEpoch) || 0;
            unit._barracks = null;
            unit.active = true;
            unit.z = 0;
            unit._surfaceKind = 'ground';
            if (Array.isArray(record.statusEffects)) unit.statusEffects = clone(record.statusEffects);
            if (needsRoute && destination) this._issueRallyMove(unit, destination);
            else unit._command = { mode: commandMode, point: null, target: null };
            g.entities.set(unit.id, unit);
            if (Array.isArray(g.friendlyUnits) && !g.friendlyUnits.includes(unit)) g.friendlyUnits.push(unit);
            this._liveDetached.add(unit);
            result.created++;
        }
        return result;
    },

    _issueRallyMove(unit, target) {
        const commandPoint = game()?.DefenseSystem?.routeSurfaceMoveForUnit
            ? game().DefenseSystem.routeSurfaceMoveForUnit(unit, target)
            : target;
        if (!commandPoint || commandPoint.unreachable) {
            unit._command = { mode: 'hold', point: null, target: null };
            return false;
        }
        unit._troopLineRally = { ...target };
        unit._command = {
            mode: 'move',
            point: {
                ...commandPoint,
                route: Array.isArray(commandPoint.route) ? commandPoint.route.map((step) => ({ ...step })) : [],
            },
            target: null,
        };
        return true;
    },

    _findSafeArrival(center, offset = 0) {
        if (!center || !Number.isFinite(Number(center.x)) || !Number.isFinite(Number(center.y))) return null;
        const g = game();
        const scene = sceneManager()?.scenes?.[sceneManager()?.currentScene];
        const width = Number(scene?.width) || Infinity;
        const height = Number(scene?.height) || Infinity;
        for (let ring = 1; ring <= 8; ring++) {
            for (let slot = 0; slot < 12; slot++) {
                const angle = (slot + offset) * Math.PI / 6;
                const x = Number(center.x) + Math.cos(angle) * ring * 48;
                const y = Number(center.y) + Math.sin(angle) * ring * 34;
                if (x < UNIT_RADIUS || y < UNIT_RADIUS
                    || x > width - UNIT_RADIUS || y > height - UNIT_RADIUS) continue;
                if (isSpawnPositionFree(x, y, UNIT_RADIUS, {
                    entities: g?.entities,
                    wallSystem: WallSystem,
                })) return { x, y };
            }
        }
        return null;
    },

    _pruneDeadDetached() {
        let changed = false;
        for (const unit of Array.from(this._liveDetached)) {
            if (!aliveMilitaryUnit(unit)) {
                this._detachUnit(unit);
                changed = true;
            }
        }
        if (changed) this._revision++;
    },

    _pruneInvalidPending() {
        for (const [sceneId, records] of Object.entries(this._pendingByWorld)) {
            const valid = (records || []).filter((record) => !record.target || this._isTargetCurrent(record.target));
            if (valid.length) this._pendingByWorld[sceneId] = valid;
            else delete this._pendingByWorld[sceneId];
        }
    },

    _nextUnitId(prefix = 'troop_line') {
        return `${prefix}_${Date.now().toString(36)}_${++this._seq}`;
    },

    _storeCompanionResidency(member, sceneId) {
        if (!member?.id || !sceneId) return;
        this._companionResidency[member.id] = {
            sceneId,
            worldEpoch: currentEpoch(sceneId),
            x: Number(member.x) || 0,
            y: Number(member.y) || 0,
            z: Math.max(0, Number(member.z) || 0),
            surfaceKind: member._surfaceKind || 'ground',
            command: { mode: member._command?.mode || 'follow' },
        };
    },

    _restoreCompanionResidency(member, residence) {
        member.x = Number(residence.x) || 0;
        member.y = Number(residence.y) || 0;
        member.z = Math.max(0, Number(residence.z) || 0);
        member._surfaceKind = residence.surfaceKind || 'ground';
        member._command = { mode: residence.command?.mode || 'follow', point: null, target: null };
        this._clearCompanionMotion(member);
    },

    _syncCompanionResidencyForScene(sceneId) {
        if (sceneId !== 'main' && !PERSISTENT_WORLDS.has(sceneId)) return;
        const g = game();
        const party = g?.PartySystem;
        if (!party?.members) return;
        const inferredHome = g._observerMode ? (g._observerHomeScene || 'main') : sceneId;
        for (const member of party.members) {
            if (!member?.id) continue;
            if (!this._companionResidency[member.id]) this._storeCompanionResidency(member, inferredHome);
            const residence = this._companionResidency[member.id];
            const epochValid = !PERSISTENT_WORLDS.has(residence.sceneId)
                || WorldProgressionSystem.isWorldEpochCurrent(residence.sceneId, residence.worldEpoch);
            const present = epochValid && residence.sceneId === sceneId;
            member.active = present;
            if (present) this._restoreCompanionResidency(member, residence);
            else member._destroyPhaserSprite?.();
        }
    },

    _clearCompanionMotion(member) {
        member.target = null;
        member._tacticalTarget = null;
        member.vx = 0;
        member.vy = 0;
        member.isMoving = false;
        member._pathManager?._clearPath?.();
    },
};

export default TroopLineSystem;
