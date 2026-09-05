// 五日全局入侵：统一游戏时间推进、地牢进度加速、跨世界选点和前后台同构结算。
import worldSystemConfig from '../../data/world-system.json';
import invasionCampaign from '../../data/invasion-campaign.json';
import { buildInvasionFormation, invasionRosterWaves, invasionRandom } from './invasion-formation.js';
import { getEnemyInvasionCatalog } from '../config/enemy-invasion-catalog.js';
import { enemyConstructor } from '../entities/enemy-registry.js';
import { knownInvasionAssetBudget } from './invasion-asset-budget.js';
import { setPopulationSafetyProvider } from './population-happiness.js';
import { Game } from '../game.js';
import { DefenseSystem } from './defense-system.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { WorldProgressionSystem } from './world-progression-system.js';
import { ensureWorldBaseSnapshot, getWorldSnapshot, resetWorldSnapshot } from './world122-snapshot.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { TroopLineSystem } from './troop-line-system.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import { damageStrategicRoster, strategicRosterPower } from './strategic-roster.js';
import {
    buildWorldCombatDigest,
    refreshWorldBackgroundLedger,
} from './world-background-ledger.js';

const VERSION = 6;
const cfg = worldSystemConfig.invasion || {};
const clone = (value) => JSON.parse(JSON.stringify(value));

function initialState() {
    return {
        version: VERSION,
        cycle: 0,
        progressMs: 0,
        pendingMarchId: null,
        musterPlan: null,
        nextSeed: Math.floor(Math.random() * 4294967296) >>> 0,
        lastFamilyId: null,
        lastMusterIssue: '',
        battles: {},
        results: [],
    };
}

let state = initialState();
let liveWorldId = null;
let debugInvasionSequence = 0;
const battles = () => Object.values(state.battles);
const battleFor = (sceneId) => state.battles[sceneId] || null;
const primaryBattle = () => battleFor(liveWorldId)
    || battles().find((battle) => !battle.testOnly) || battles()[0] || null;

function dayDurationMs() {
    return Math.max(1, Number(EnvironmentLightingSystem.getConfig()?.dayDurationMs) || 12 * 60 * 1000);
}

function intervalMs() {
    return dayDurationMs() * Math.max(1, Number(cfg.intervalDays) || 5);
}

function commitInvasionCycle(plan, pendingMarchId = null) {
    state.cycle = plan.cycle;
    state.pendingMarchId = pendingMarchId;
    state.lastFamilyId = plan.formation.familyId;
    state.nextSeed = (Math.imul(plan.seed, 1664525) + 1013904223) >>> 0;
    state.musterPlan = null;
    state.lastMusterIssue = '';
    state.progressMs = Math.max(0, state.progressMs - intervalMs());
}

function worldName(sceneId) {
    return WorldProgressionSystem.getWorldConfig(sceneId)?.name || sceneId;
}

function portalWarningForRatio(ratio) {
    return (cfg.portalWarnings || [])
        .filter((entry) => ratio <= Math.max(0, Number(entry.ratio) || 0))
        .sort((left, right) => (Number(right.stage) || 0) - (Number(left.stage) || 0))[0] || null;
}

function warningColor(severity) {
    if (severity === 'evacuation') return '#ff3d3d';
    if (severity === 'critical') return '#ff765c';
    return '#ffbf69';
}

function notify(text, color = '#ffb86a') {
    const player = Game?.player;
    if (player && EffectManager) {
        EffectManager.add(new FloatingTextEffect(player.x, player.y - 70, text, color));
    }
    if (typeof window !== 'undefined' && window.SceneManager?.showTopNotification) {
        window.SceneManager.showTopNotification(text, { color, fontSize: '30px', duration: 4200 });
    }
}

function spawnPointsFor(diamond) {
    if (!diamond) return [];
    const inset = 180;
    return [
        { x: diamond.cx + diamond.rx - inset, y: diamond.cy },
        { x: diamond.cx + diamond.rx * 0.78, y: diamond.cy - diamond.ry * 0.18 },
        { x: diamond.cx + diamond.rx * 0.78, y: diamond.cy + diamond.ry * 0.18 },
        { x: diamond.cx, y: diamond.cy - diamond.ry + inset },
        { x: diamond.cx, y: diamond.cy + diamond.ry - inset },
    ];
}

function defenseDps(snapshot, sceneId, worldEpoch) {
    let combat = snapshot?.backgroundLedger?.combat;
    if (!combat || snapshot.backgroundLedger?.dirty) {
        combat = buildWorldCombatDigest(snapshot);
        if (snapshot) {
            snapshot.backgroundLedger = snapshot.backgroundLedger || {};
            snapshot.backgroundLedger.combat = combat;
        }
    }
    const structureDps = Math.max(0, Number(combat?.structureDps) || 0);
    return structureDps + TroopLineSystem.getBackgroundDefense(sceneId, worldEpoch).dps;
}

function waveThreat(active) {
    const monsterCfg = new Map((cfg.monsters || []).map((monster) => [monster.type, monster]));
    return (active.waves?.[active.waveIndex - 1] || []).reduce(
        (sum, type) => sum + Math.max(0.5, Number(monsterCfg.get(type)?.threat) || 1),
        0
    );
}

function applyBackgroundDamage(snapshot, sceneId, damage, worldEpoch) {
    let left = Math.max(0, damage);
    const structures = snapshot?.structures || [];
    let combat = snapshot?.backgroundLedger?.combat;
    if (!combat || !Array.isArray(combat.damageOrder)) combat = buildWorldCombatDigest(snapshot);
    const portal = structures[combat.portalIndex]
        || structures.find((structure) => structure.kind === 'producer' && structure.cfgKey === 'portal');
    const damageOrder = Array.isArray(combat.damageOrder)
        ? combat.damageOrder
        : structures.map((_, index) => index);
    for (const index of damageOrder) {
        const structure = structures[index];
        if (!structure || structure === portal) continue;
        if (left <= 0 || !(structure.hp > 0)) continue;
        const dealt = Math.min(structure.hp, left);
        structure.hp -= dealt;
        left -= dealt;
    }
    const portalState = WorldProgressionSystem.getPortalState(sceneId);
    const portalHp = portal?.hp > 0 ? portal.hp : portalState.hp;
    const nextHp = Math.max(0, portalHp - left);
    if (portal) portal.hp = nextHp;
    WorldProgressionSystem.syncPortalHp(sceneId, nextHp, { expectedEpoch: worldEpoch });
    if (snapshot) {
        const nowGame = EnvironmentLightingSystem.serializeTime().elapsedMs || 0;
        refreshWorldBackgroundLedger(
            snapshot,
            nowGame,
            snapshot.backgroundLedger?.research,
            'invasion-damage'
        );
    }
    return nextHp;
}

function destroyWorldRecords(sceneId, worldEpoch) {
    if (typeof window !== 'undefined' && window.SceneManager?.destroyWorld) {
        return window.SceneManager.destroyWorld(sceneId, worldEpoch);
    }
    if (!WorldProgressionSystem.markPortalDestroyed(sceneId, { expectedEpoch: worldEpoch })) return false;
    if (WorldProgressionSystem.shouldClearWorldScope(sceneId, 'snapshot')) {
        resetWorldSnapshot(sceneId);
    }
    if (WorldProgressionSystem.shouldClearWorldScope(sceneId, 'playerPosition')
        && Game?._worldPlayerPos) delete Game._worldPlayerPos[sceneId];
    return true;
}

export const WorldInvasionSystem = {
    reset() {
        this._formationTask = null;
        state = initialState(); liveWorldId = null;
        debugInvasionSequence = 0;
        this._nextMusterAttemptAt = 0;
        this._livePortal = null; this._liveDiamond = null;
        DefenseSystem.stopManagedInvasion?.();
    },
    getBattles() { return clone(battles()); },
    getBattleForWorld(sceneId) { return battleFor(sceneId) ? clone(battleFor(sceneId)) : null; },
    getState() { return { ...clone(state), active: primaryBattle() ? clone(primaryBattle()) : null }; },
    serialize() {
        this.syncLivePortal(true);
        this.settleBackgroundNow(null, { includeTest: false });
        const saved = clone(state);
        saved.battles = Object.fromEntries(Object.entries(saved.battles || {})
            .filter(([, battle]) => battle?.testOnly !== true));
        saved.results = (saved.results || []).filter((result) => result?.testOnly !== true);
        return saved;
    },
    syncLivePortal(includeRoster = false) {
        if (!liveWorldId || !this._livePortal) return;
        WorldProgressionSystem.syncPortalHp(liveWorldId, this._livePortal.hp, { expectedEpoch: this._livePortal._worldEpoch });
        const active = battleFor(liveWorldId);
        if (active) {
            this._checkPortalWarnings(liveWorldId, this._livePortal.hp);
            const live = DefenseSystem.getManagedInvasionState?.({ includeRoster });
            if (live?.summonLedger) active.summonLedger = clone(live.summonLedger);
            if (live?.wave > 0) active.waveIndex = live.wave;
            if (live?.roster) {
                if (active.enemyId) active.roster = clone(live.roster);
                else { active.reliefRoster = clone(live.roster); active.waveElapsedMs = 0; }
            }
        }
    },
    restore(data, { deferLive = false } = {}) {
        this._formationTask = null;
        debugInvasionSequence = 0;
        this._nextMusterAttemptAt = 0;
        DefenseSystem.stopManagedInvasion?.({ clearMonsters: true });
        if (deferLive) { liveWorldId = null; this._livePortal = null; this._liveDiamond = null; }
        state = initialState();
        if (!data || typeof data !== 'object') return;
        state.cycle = Math.max(0, Math.floor(Number(data.cycle) || 0));
        state.progressMs = Math.max(0, Number(data.progressMs) || 0);
        state.pendingMarchId = typeof data.pendingMarchId === 'string' ? data.pendingMarchId : null;
        state.nextSeed = Number.isInteger(data.nextSeed) ? data.nextSeed >>> 0 : state.nextSeed;
        state.lastFamilyId = data.lastFamilyId || null;
        state.musterPlan = data.musterPlan?.cycle === state.cycle + 1 && !state.pendingMarchId ? clone(data.musterPlan) : null;
        state.lastMusterIssue = String(data.lastMusterIssue || '');
        state.results = Array.isArray(data.results) ? clone(data.results).slice(-32) : [];
        for (const raw of data.battles ? Object.values(data.battles) : [data.active]) {
            if (!raw?.targetWorld || raw.testOnly === true) continue;
            const active = clone(raw);
            if (!(active.worldEpoch > 0)) active.worldEpoch = WorldProgressionSystem.getWorldEpoch(active.targetWorld);
            if (!WorldProgressionSystem.isWorldEpochCurrent(active.targetWorld, active.worldEpoch)
                || !WorldProgressionSystem.isPortalConstructed(active.targetWorld)) continue;
            active.portalWarningStage = Math.max(0, Number(active.portalWarningStage) || 0);
            active.backgroundAccumulatorMs = Math.max(0, Number(active.backgroundAccumulatorMs) || 0);
            active.suspended = false;
            state.battles[active.targetWorld] = active;
        }
        if (battleFor(liveWorldId) && this._livePortal && !this._livePortal._portalDestroyed) this._attachLiveBattle();
    },
    recordDungeonRun(dungeonType, grade, outcome) {
        WorldProgressionSystem.recordDungeonRun(dungeonType, outcome);
        const fraction = Math.max(0, Number(cfg.dungeonProgressByGrade?.[grade]) || 0);
        const addedMs = intervalMs() * fraction;
        state.progressMs += addedMs;
        return { fraction, addedMs, progress: Math.min(1, state.progressMs / intervalMs()) };
    },
    update(deltaMs) {
        const dt = Math.max(0, Number(deltaMs) || 0);
        const currentBattles = battles();
        // A committed approach always receives a full game day. Dungeon progress
        // advances the next mustering window, never teleports an existing army.
        if (!battles().some((battle) => !battle.enemyId && !battle.testOnly) && !state.pendingMarchId) {
            state.progressMs += dt;
            const musterAt = Math.max(0, intervalMs() - dayDurationMs() * invasionCampaign.march.leadDays);
            if (state.progressMs >= musterAt) this._startNextInvasion();
        }
        for (const active of currentBattles) {
            if (!WorldProgressionSystem.isWorldEpochCurrent(active.targetWorld, active.worldEpoch)
                || !WorldProgressionSystem.isPortalConstructed(active.targetWorld)) {
                this._resolveActive(false, active); continue;
            }
            if (active.suspended) continue;
            if (active.targetWorld === liveWorldId) this.syncLivePortal();
            else this._updateBackground(dt, active);
        }
    },
    _startNextInvasion() {
        const strategy = typeof window !== 'undefined' ? window.WorldStrategySystem : null;
        if (!strategy?.spawnInvasionMarch || strategy._busy || window.SceneManager?.isLoading) return false;
        if (state.pendingMarchId || this._formationTask) return false;
        const now = EnvironmentLightingSystem.serializeTime().elapsedMs || 0;
        if (now < (this._nextMusterAttemptAt || 0)) return false;
        this._nextMusterAttemptAt = now + 1000;
        const candidates = this._getInvasionCandidates();
        if (!candidates.length) return false;
        if (state.musterPlan && !candidates.some((entry) => entry.sceneId === state.musterPlan.targetWorld
            && entry.portal.worldEpoch === state.musterPlan.worldEpoch)) state.musterPlan = null;
        const random = invasionRandom(state.nextSeed);
        const target = state.musterPlan ? candidates.find((entry) => entry.sceneId === state.musterPlan.targetWorld)
            : [...candidates].sort((a, b) => a.sceneId.localeCompare(b.sceneId))[Math.floor(random() * candidates.length)];
        ensureWorldBaseSnapshot(target.sceneId, { portalHp: target.portal.hp, worldEpoch: target.portal.worldEpoch,
            generation: WorldProgressionSystem.getWorldGenerationContext(target.sceneId) });
        const plan = state.musterPlan ||= { cycle: state.cycle + 1, day: EnvironmentLightingSystem.getGameTime()?.day || 1,
            seed: state.nextSeed, targetWorld: target.sceneId, worldEpoch: target.portal.worldEpoch };
        if (plan.formation) return this._commitMusterPlan(plan);
        plan.day = Math.max(plan.day, EnvironmentLightingSystem.getGameTime()?.day || 1);
        const capturedState = state;
        const cancelled = () => capturedState !== state || state.musterPlan !== plan || !!state.pendingMarchId;
        const task = buildInvasionFormation(plan.cycle, plan.day, plan.targetWorld,
            { seed: plan.seed, lastFamilyId: state.lastFamilyId, isCancelled: cancelled })
            .then((formation) => {
                if (cancelled() || !formation) return;
                plan.formation = formation;
                // The game update, not an asynchronous callback, starts marching.
                state.lastMusterIssue = '';
            }).catch((error) => {
                if (cancelled()) return;
                state.lastMusterIssue = error.message;
                this._nextMusterAttemptAt = (EnvironmentLightingSystem.serializeTime().elapsedMs || 0) + 30000;
            }).finally(() => { if (this._formationTask === task) this._formationTask = null; });
        this._formationTask = task;
        return false;
    },
    _commitMusterPlan(plan) {
        const strategy = window.WorldStrategySystem;
        if (!strategy || state.musterPlan !== plan || !plan.formation) return false;
        const enemyId = strategy.spawnInvasionMarch({ formation: plan.formation, targetWorld: plan.targetWorld,
            worldEpoch: plan.worldEpoch, cycle: plan.cycle, leadMs: dayDurationMs() * invasionCampaign.march.leadDays });
        if (!enemyId) return false;
        commitInvasionCycle(plan, enemyId);
        return true;
    },
    getInvasionCatalog() {
        const catalog = getEnemyInvasionCatalog({ hasFactory: enemyConstructor });
        return { ...catalog, lastMusterIssue: state.lastMusterIssue,
            entries: catalog.entries.map((entry) => {
                const assetBudget = knownInvasionAssetBudget(entry.type);
                const limit = ({ normal: 64, elite: 128, leader: 256 })[entry.role] || 0;
                return { ...entry, assetBudget, formationStatus: assetBudget && limit && assetBudget.bytes > limit * 1048576
                    ? `${entry.formationStatus}；整套纹理超${limit}MiB准入线` : entry.formationStatus };
            }) };
    },
    finishInvasionMarch(enemyId) {
        if (state.pendingMarchId === enemyId) state.pendingMarchId = null;
    },
    reconcileInvasionMarch() {
        const enemies = window.WorldStrategySystem?.state?.enemies;
        if (!enemies) return;
        // Called only after strategic restore; do not drop the ID between the
        // invasion and strategy restore phases of the same save transaction.
        const pending = enemies.find((enemy) => enemy.invasion);
        state.pendingMarchId = pending?.id || null;
    },
    startMarchedInvasion(enemy) {
        if (!enemy?.invasion || state.pendingMarchId !== enemy.id) return false;
        return this._beginInvasionBattle(enemy);
    },
    _beginInvasionBattle(enemy, { testOnly = false } = {}) {
        const intel = enemy?.invasion;
        if (!intel || battleFor(intel.targetWorld)
            || !WorldProgressionSystem.isWorldEpochCurrent(intel.targetWorld, intel.worldEpoch)
            || !WorldProgressionSystem.isPortalConstructed(intel.targetWorld)
            || WorldProgressionSystem.isWorldInvasionProtected(intel.targetWorld)) return false;
        const waveRosters = invasionRosterWaves(enemy.roster);
        if (!waveRosters.length) { this.finishInvasionMarch(enemy.id); return true; }
        const targetWorld = intel.targetWorld;
        const portal = WorldProgressionSystem.getPortalState(targetWorld);
        ensureWorldBaseSnapshot(targetWorld, { portalHp: portal.hp, worldEpoch: intel.worldEpoch,
            generation: WorldProgressionSystem.getWorldGenerationContext(targetWorld) });
        if (!testOnly) window.WorldSimDriver?.flushWorld?.(targetWorld, { reason: 'happiness-siege-start' });
        state.battles[targetWorld] = { id: `invasion_${intel.cycle}_${enemy.id}`, cycle: intel.cycle,
            day: EnvironmentLightingSystem.getGameTime()?.day || 1, targetWorld, worldEpoch: intel.worldEpoch,
            familyId: intel.familyId, familyName: intel.familyName, waveIndex: 1, waveCount: waveRosters.length,
            seed: intel.seed, catalogVersion: intel.catalogVersion, summonLedger: intel.summonLedger ? clone(intel.summonLedger) : null,
            waves: waveRosters.map((wave) => wave.map((record) => record.type)), waveRosters,
            waveElapsedMs: 0, backgroundAccumulatorMs: 0, portalWarningStage: 0,
            testOnly: testOnly || undefined };
        if (!testOnly) this.finishInvasionMarch(enemy.id);
        notify(`⚠ ${intel.familyName}抵达${worldName(targetWorld)}，${testOnly ? '测试入侵' : `第${intel.cycle}次入侵`}开始`, '#ff6655');
        if (liveWorldId === targetWorld) this._attachLiveBattle();
        return true;
    },
    _getInvasionCandidates(nowGameTimeMs = EnvironmentLightingSystem.serializeTime().elapsedMs || 0) {
        return WorldProgressionSystem.getTravelWorlds()
            .filter((world) => world.portal.constructed && !world.portal.destroyed && !battleFor(world.sceneId))
            .filter((world) => !WorldProgressionSystem.isWorldInvasionProtected(world.sceneId, nowGameTimeMs));
    },
    startStrategicSiege({ enemyId, targetWorld, worldEpoch, roster }) {
        const existing = battleFor(targetWorld);
        if (existing) return { ok: existing.enemyId === enemyId, id: existing.id, reason: '该城已有战事，后续军团在城外等待' };
        if (!enemyId || !roster?.length || !WorldProgressionSystem.isPortalConstructed(targetWorld)
            || !WorldProgressionSystem.isWorldEpochCurrent(targetWorld, worldEpoch)
            || WorldProgressionSystem.isWorldInvasionProtected(targetWorld)) return { ok: false, reason: '城市已失效或仍受新生保护' };
        const portal = WorldProgressionSystem.getPortalState(targetWorld);
        ensureWorldBaseSnapshot(targetWorld, { portalHp: portal.hp, worldEpoch,
            generation: WorldProgressionSystem.getWorldGenerationContext(targetWorld) });
        const active = { id: `siege_${enemyId}_${worldEpoch}`, enemyId, targetWorld, worldEpoch,
            cycle: 1, day: EnvironmentLightingSystem.getGameTime()?.day || 1,
            waveIndex: 1, waveCount: 1, waves: [roster.map((unit) => unit.type)], roster: clone(roster),
            waveElapsedMs: 0, backgroundAccumulatorMs: 0, portalWarningStage: 0, suspended: false };
        window.WorldSimDriver?.flushWorld?.(targetWorld, { reason: 'happiness-siege-start' });
        state.battles[targetWorld] = active;
        notify(`⚔ 敌方军团开始围攻 ${worldName(targetWorld)}`, '#ff6655');
        if (liveWorldId === targetWorld) this._attachLiveBattle();
        return { ok: true, id: active.id };
    },
    suspendBattle(id) {
        let active = battles().find((battle) => battle.id === id);
        if (!active) return null;
        this.settleBackgroundNow(active.targetWorld);
        active = battles().find((battle) => battle.id === id);
        if (!active) return null;
        active.suspended = true;
        const waves = active.enemyId ? [clone(active.roster)] : active.waves.slice(active.waveIndex - 1)
            .map((types, index) => this._remainingWaveRoster(active, active.waveIndex + index));
        return { waves, summonLedger: active.summonLedger ? clone(active.summonLedger) : null };
    },
    _remainingWaveRoster(active, wave = active.waveIndex) {
        if (wave === active.waveIndex && active.reliefRoster) return clone(active.reliefRoster);
        if (active.waveRosters) return clone(active.waveRosters[wave - 1] || []);
        const roster = (active.waves[wave - 1] || []).map((type, slot) => ({ type, slot: `wave_${wave}_${slot}`, hpRatio: 1,
            hpMul: (1 + (wave - 1) * (cfg.hpGrowthPerWave || 0.1)) * (1 + Math.max(0, active.cycle - 1) * (cfg.hpGrowthPerCycle || 0.12)),
            atkMul: (1 + (wave - 1) * (cfg.atkGrowthPerWave || 0.06)) * (1 + Math.max(0, active.cycle - 1) * (cfg.atkGrowthPerCycle || 0.08)) }));
        if (wave !== active.waveIndex || !(active.waveElapsedMs > 0)) return roster;
        const defenders = defenseDps(getWorldSnapshot(active.targetWorld), active.targetWorld, active.worldEpoch);
        if (defenders <= 0) return roster;
        const waveMs = Math.min((cfg.backgroundWaveMaxSeconds || 180) * 1000,
            Math.max(cfg.backgroundWaveSeconds || 35, waveThreat(active) * 180 / Math.max(1, defenders)) * 1000);
        return damageStrategicRoster(roster, strategicRosterPower(roster).hp * Math.min(1, active.waveElapsedMs / waveMs));
    },
    resumeBattle(id) {
        const active = battles().find((battle) => battle.id === id);
        if (active) active.suspended = false;
    },
    finishRelief(id, victory, result) {
        const active = battles().find((battle) => battle.id === id);
        if (!active) return;
        if (victory) { this._resolveActive(true, active); return; }
        active.suspended = false;
        if (result.summonLedger) active.summonLedger = clone(result.summonLedger);
        if (active.enemyId) {
            active.roster = clone(result.roster);
            active.waves = [result.roster.map((unit) => unit.type)];
            if (!active.roster.length) this._resolveActive(true, active);
        } else {
            active.waveIndex += result.waveIndex || 0;
            active.reliefRoster = clone(result.roster);
            active.waves[active.waveIndex - 1] = result.roster.map((unit) => unit.type);
            active.waveElapsedMs = 0;
            if (!result.roster.length) {
                active.waveIndex++; active.reliefRoster = null;
                if (active.waveIndex > active.waveCount) this._resolveActive(true, active);
            }
        }
    },
    takeStrategicResults() { const results = state.results; state.results = []; return results; },
    _checkPortalWarnings(sceneId, hp) {
        const active = battleFor(sceneId);
        if (!active) return null;
        const ratio = Math.max(0, Number(hp) || 0) / Math.max(1, worldSystemConfig.portal?.maxHp || 5000);
        const warning = portalWarningForRatio(ratio);
        if (warning && warning.stage > (active.portalWarningStage || 0)) {
            active.portalWarningStage = warning.stage;
            notify(String(warning.text || '{world}防线告急').replaceAll('{world}', worldName(sceneId)), warningColor(warning.severity));
        }
        return warning;
    },
    onWorldLoaded(sceneId, portalEntity, diamond) {
        liveWorldId = sceneId; this._livePortal = portalEntity || null; this._liveDiamond = diamond || null;
        if (battleFor(sceneId) && portalEntity && !portalEntity._portalDestroyed) this._attachLiveBattle();
    },
    onWorldLeaving(sceneId) {
        if (liveWorldId !== sceneId) return;
        this.syncLivePortal(true);
        if (battleFor(sceneId)) DefenseSystem.stopManagedInvasion?.({ clearMonsters: true });
        liveWorldId = null; this._livePortal = null; this._liveDiamond = null;
    },
    _attachLiveBattle() {
        const active = battleFor(liveWorldId);
        if (!active || active.suspended || !this._livePortal
            || !WorldProgressionSystem.isWorldEpochCurrent(liveWorldId, active.worldEpoch)
            || this._livePortal._worldEpoch !== active.worldEpoch) return;
        const cycle = Math.max(1, active.cycle || 1);
        const token = { id: active.id, targetWorld: active.targetWorld, worldEpoch: active.worldEpoch };
        DefenseSystem.beginManagedInvasion({ waveCount: active.waveCount, startWave: active.waveIndex,
            summonLedger: active.summonLedger,
            waveRosters: active.waveRosters ? clone(active.waveRosters) : null,
            waves: active.waves, strategicRoster: active.enemyId ? clone(active.roster) : this._remainingWaveRoster(active), strategicRosterWave: active.waveIndex,
            spawnPoints: spawnPointsFor(this._liveDiamond), maxAlive: cfg.maxAlive || 60,
            waveBreakMs: cfg.waveBreakMs || 10000,
            hpPerWave: active.enemyId ? 0 : cfg.hpGrowthPerWave || 0.1,
            atkPerWave: active.enemyId ? 0 : cfg.atkGrowthPerWave || 0.06,
            cycleHpMul: 1 + (cycle - 1) * (cfg.hpGrowthPerCycle || 0.12),
            cycleAtkMul: 1 + (cycle - 1) * (cfg.atkGrowthPerCycle || 0.08),
        }, this._livePortal, (result) => this._resolveActive(result.victory, token));
    },
    _updateBackground(deltaMs, active) {
        active.backgroundAccumulatorMs = Math.max(0, active.backgroundAccumulatorMs || 0) + deltaMs;
        if (active.backgroundAccumulatorMs < Math.max(1000, cfg.backgroundResolutionStepMs || 10000)) return;
        const elapsed = active.backgroundAccumulatorMs; active.backgroundAccumulatorMs = 0;
        this._settleBackgroundWindow(elapsed, active);
    },
    _settleStrategicSiege(active, elapsedMs) {
        const snapshot = getWorldSnapshot(active.targetWorld);
        const defenders = defenseDps(snapshot, active.targetWorld, active.worldEpoch);
        const attackers = strategicRosterPower(active.roster);
        const seconds = Math.min(elapsedMs / 1000, defenders > 0 ? attackers.hp / defenders : Infinity);
        const damage = attackers.dps * seconds * (cfg.backgroundContactRatio || 0.45);
        const absorbed = TroopLineSystem.applyBackgroundAttrition(active.targetWorld, active.worldEpoch,
            damage * Math.max(0, Math.min(1, cfg.backgroundGarrisonAbsorbRatio || 0)));
        const hp = applyBackgroundDamage(snapshot, active.targetWorld, damage - absorbed, active.worldEpoch);
        active.roster = damageStrategicRoster(active.roster, defenders * seconds);
        active.waveElapsedMs += seconds * 1000;
        this._checkPortalWarnings(active.targetWorld, hp);
        if (hp <= 0) this._resolveActive(false, active);
        else if (!active.roster.length) this._resolveActive(true, active);
    },
    _settleBackgroundWindow(elapsedMs, active) {
        if (!active || active.suspended || battleFor(active.targetWorld) !== active) return;
        const targetWorld = active.targetWorld;
        if (!active.testOnly) {
            window.WorldSimDriver?.flushWorld?.(targetWorld, {
                nowGame: EnvironmentLightingSystem.serializeTime().elapsedMs || 0, notify: false, reason: 'invasion-boundary' });
        }
        if (active.enemyId) { this._settleStrategicSiege(active, elapsedMs); return; }
        let remainingMs = Math.max(0, elapsedMs), safety = Math.max(2, active.waveCount || 10) + 2;
        while (remainingMs > 0 && battleFor(targetWorld) === active && safety-- > 0) {
            if (!WorldProgressionSystem.isWorldEpochCurrent(targetWorld, active.worldEpoch)) { this._resolveActive(false, active); return; }
            if (active.waveRosters && !active.reliefRoster) active.reliefRoster = clone(active.waveRosters[active.waveIndex - 1] || []);
            if (active.reliefRoster) {
                const snapshot = getWorldSnapshot(targetWorld);
                const defenders = defenseDps(snapshot, targetWorld, active.worldEpoch);
                const attackers = strategicRosterPower(active.reliefRoster);
                const seconds = Math.min(remainingMs / 1000, defenders > 0 ? attackers.hp / defenders : Infinity);
                const damage = attackers.dps * seconds * (cfg.backgroundContactRatio || 0.45);
                const absorbed = TroopLineSystem.applyBackgroundAttrition(targetWorld, active.worldEpoch,
                    damage * Math.max(0, Math.min(1, cfg.backgroundGarrisonAbsorbRatio || 0)));
                const hp = applyBackgroundDamage(snapshot, targetWorld, damage - absorbed, active.worldEpoch);
                active.reliefRoster = damageStrategicRoster(active.reliefRoster, defenders * seconds);
                this._checkPortalWarnings(targetWorld, hp);
                if (hp <= 0) { this._resolveActive(false, active); return; }
                remainingMs -= seconds * 1000;
                if (active.reliefRoster.length) return;
                active.reliefRoster = null; active.waveElapsedMs = 0;
                if (active.waveIndex >= active.waveCount) { this._resolveActive(true, active); return; }
                active.waveIndex++;
                continue;
            }
            const snapshot = getWorldSnapshot(targetWorld), threat = waveThreat(active);
            const attackDps = threat * 6 * (1 + Math.max(0, active.cycle - 1) * (cfg.atkGrowthPerCycle || 0.08));
            const defenders = defenseDps(snapshot, targetWorld, active.worldEpoch);
            const mitigation = Math.max(0.18, 1 - defenders / Math.max(1, threat * 28));
            const waveMs = Math.min((cfg.backgroundWaveMaxSeconds || 180) * 1000,
                Math.max(cfg.backgroundWaveSeconds || 35, threat * 180 / Math.max(1, defenders)) * 1000);
            const windowMs = Math.min(remainingMs, defenders > 0 ? Math.max(1, waveMs - (active.waveElapsedMs || 0)) : remainingMs);
            const damage = attackDps * (cfg.backgroundContactRatio || 0.45) * mitigation * windowMs / 1000;
            const absorbed = TroopLineSystem.applyBackgroundAttrition(targetWorld, active.worldEpoch,
                damage * Math.max(0, Math.min(1, cfg.backgroundGarrisonAbsorbRatio || 0)));
            const hp = applyBackgroundDamage(snapshot, targetWorld, damage - absorbed, active.worldEpoch);
            this._checkPortalWarnings(targetWorld, hp);
            if (hp <= 0) { this._resolveActive(false, active); return; }
            active.waveElapsedMs = (active.waveElapsedMs || 0) + windowMs; remainingMs -= windowMs;
            if (defenders <= 0) return;
            if (active.waveElapsedMs + 0.5 < waveMs) continue;
            active.waveElapsedMs = 0;
            if (active.waveIndex >= active.waveCount) { this._resolveActive(true, active); return; }
            active.waveIndex++; active.reliefRoster = null;
        }
    },
    settleBackgroundNow(sceneId = null, { includeTest = true } = {}) {
        let settled = false;
        for (const active of sceneId ? [battleFor(sceneId)] : battles()) {
            if (!active || (!includeTest && active.testOnly)
                || active.suspended || active.targetWorld === liveWorldId) continue;
            const pending = Math.max(0, active.backgroundAccumulatorMs || 0);
            if (!pending) continue;
            active.backgroundAccumulatorMs = 0; this._settleBackgroundWindow(pending, active); settled = true;
        }
        return settled;
    },
    _resolveActive(victory, token) {
        const active = battleFor(token?.targetWorld);
        if (!active || active.id !== token.id || active.worldEpoch !== token.worldEpoch) return;
        if (active.targetWorld === liveWorldId) this.syncLivePortal(true);
        if (!active.testOnly) {
            window.WorldSimDriver?.flushWorld?.(active.targetWorld, { reason: 'happiness-siege-end' });
        }
        delete state.battles[active.targetWorld]; // Destroy callbacks cannot resolve the same war twice.
        if (active.enemyId) {
            state.results.push({ id: active.id, enemyId: active.enemyId, victory, roster: victory ? [] : clone(active.roster || []) });
            state.results = state.results.slice(-32);
        }
        if (active.targetWorld === liveWorldId) DefenseSystem.stopManagedInvasion?.({ clearMonsters: true });
        if (!WorldProgressionSystem.isWorldEpochCurrent(active.targetWorld, active.worldEpoch)) return;
        if (!victory) {
            const reconciled = typeof window !== 'undefined' && window.SceneManager?.handleWorldAnchorDestroyed
                ? window.SceneManager.handleWorldAnchorDestroyed(active.targetWorld, active.worldEpoch, 'portal')
                : destroyWorldRecords(active.targetWorld, active.worldEpoch);
            if (this._livePortal && liveWorldId === active.targetWorld) {
                this._livePortal.hp = 0; this._livePortal.hittable = false; this._livePortal._portalDestroyed = true;
            }
            const hallLives = typeof window !== 'undefined'
                && window.SceneManager?._hasLiveWorldAnchor?.(active.targetWorld, 'city_hall');
            notify(hallLives
                ? `⚠ ${worldName(active.targetWorld)}传送门已毁，市政厅仍在，位面尚未崩塌`
                : `💥 ${worldName(active.targetWorld)}双锚点已毁，位面崩塌`, hallLives ? '#ffb35c' : '#ff4444');
            return reconciled;
        } else notify(`✓ ${worldName(active.targetWorld)}击退了本次${active.testOnly ? '测试' : ''}攻城`, '#7fe0c8');
    },

    /** 丢弃单个测试位面的临时战斗，不触碰正式入侵周期。 */
    resetDebugWorld(sceneId) {
        const active = battleFor(sceneId);
        if (!active?.testOnly) return false;
        if (liveWorldId === sceneId) DefenseSystem.stopManagedInvasion?.({ clearMonsters: true });
        delete state.battles[sceneId];
        state.results = state.results.filter((result) => !(result?.testOnly && result.targetWorld === sceneId));
        return true;
    },
    onPortalDestroyed(sceneId, worldEpoch) {
        if (!WorldProgressionSystem.isWorldEpochCurrent(sceneId, worldEpoch)) return true;
        const active = battleFor(sceneId);
        if (active && active.worldEpoch === worldEpoch) this._resolveActive(false, active);
        else if (typeof window !== 'undefined' && window.SceneManager?.handleWorldAnchorDestroyed) {
            window.SceneManager.handleWorldAnchorDestroyed(sceneId, worldEpoch, 'portal');
        } else destroyWorldRecords(sceneId, worldEpoch);
        return true;
    },
    getHudModel() {
        if (state.active) {
            const maxHp = Math.max(1, Number(worldSystemConfig.portal?.maxHp) || 5000);
            const portalHp = state.active.targetWorld === liveWorldId && this._livePortal
                ? Math.max(0, Number(this._livePortal.hp) || 0)
                : Math.max(0, Number(WorldProgressionSystem.getPortalState(state.active.targetWorld).hp) || 0);
            const portalHpRatio = Math.max(0, Math.min(1, portalHp / maxHp));
            const warning = portalWarningForRatio(portalHpRatio);
            const currentScene = typeof window !== 'undefined'
                ? (window.SceneManager?.getCurrentWorldId?.() || window.SceneManager?.currentScene) : null;
            const dungeonRunActive = typeof window !== 'undefined'
                && !!window.SceneManager?.isDungeonRunActive?.();
            return {
                active: true,
                progress: portalHpRatio,
                text: `入侵中 · ${worldName(state.active.targetWorld)} · 第${state.active.waveIndex}/${state.active.waveCount}波`,
                targetWorld: state.active.targetWorld,
                portalHp,
                portalMaxHp: maxHp,
                portalHpRatio,
                severity: warning?.severity || 'active',
                detail: `传送门 ${Math.ceil(portalHp)}/${maxHp}`,
                // 地牢出征期间可通过世界面板观察并指挥，但玩家本体仍留在地牢，不能转移支援。
                canSupport: !dungeonRunActive && currentScene !== state.active.targetWorld,
            };
        }
        const enemy = window.WorldStrategySystem?.getVisibleEnemies?.().find((entry) => entry.id === state.pendingMarchId);
        if (enemy) {
            const at = window.WorldStrategySystem.invasionArrivalAt(enemy);
            const remainingMs = Math.max(0, at - (EnvironmentLightingSystem.serializeTime().elapsedMs || 0));
            return { active: false, progress: 1 - Math.min(1, remainingMs / dayDurationMs()), remainingMs,
                text: `${worldName(enemy.invasion.targetWorld)} · ${enemy.name}预计${(remainingMs / dayDurationMs()).toFixed(2)}天后抵达`,
                detail: `${enemy.invasion.discoverySource} · ${enemy.invasion.composition}` };
        }
        return { active: false, progress: 0, text: '暂无入侵情报 · 派兵侦察或部署观测设施',
            detail: '未发现不代表安全；侦察到的入侵军团才会进入事件时间栏。' };
    },
    getTimelineFrame() {
        const nowGameTimeMs = Math.max(0, EnvironmentLightingSystem.serializeTime().elapsedMs || 0), total = intervalMs();
        return { nowGameTimeMs, startAtGameTimeMs: nowGameTimeMs, endAtGameTimeMs: nowGameTimeMs + total, durationMs: total, progress: 0 };
    },
    getTimelineEvents() {
        const frame = this.getTimelineFrame();
        const events = battles().filter((active) => !active.testOnly || active.targetWorld === liveWorldId)
            .map((active) => ({ id: active.id, type: 'invasion', typeLabel: '攻城', icon: '⚔',
            iconPath: 'assets/ui/event-icons/invasion.png', label: `${worldName(active.targetWorld)} · ${active.enemyId ? '军团攻城' : '入侵'}`,
            atGameTimeMs: frame.nowGameTimeMs, status: 'active', sceneId: active.targetWorld }));
        const enemy = window.WorldStrategySystem?.getVisibleEnemies?.().find((entry) => entry.id === state.pendingMarchId);
        if (enemy) events.push({ id: `invasion:approach:${enemy.id}`, type: 'invasion', typeLabel: '入侵预警',
            icon: '⚔', iconPath: 'assets/ui/event-icons/invasion.png', label: `${worldName(enemy.invasion.targetWorld)} · ${enemy.name}`,
            atGameTimeMs: window.WorldStrategySystem.invasionArrivalAt(enemy), status: 'upcoming',
            sceneId: enemy.invasion.targetWorld, warningLabel: enemy.invasion.discoverySource,
            detail: `${enemy.invasion.composition}；可派出军团拦截，受阻或交战会推迟抵达。` });
        return events;
    },
    getDebugModel() {
        const nowGameTimeMs = Math.max(0,
            Number(EnvironmentLightingSystem.serializeTime().elapsedMs) || 0);
        const candidates = this._getInvasionCandidates(nowGameTimeMs);
        const candidateIds = new Set(candidates.map((world) => world.sceneId));
        const worlds = [
            ...WorldProgressionSystem.getWorldIds().filter((sceneId) =>
                !WorldProgressionSystem.getWorldConfig(sceneId)?.templatePreviewOnly),
            ...WorldProgressionSystem.getWorldInstanceIds(),
        ].map((sceneId) => {
            const worldCfg = WorldProgressionSystem.getWorldConfig(sceneId) || {};
            const portal = WorldProgressionSystem.getPortalState(sceneId);
            const protection = WorldProgressionSystem.getPortalProtection(sceneId, nowGameTimeMs);
            const generation = WorldProgressionSystem.getWorldGenerationContext(sceneId);
            const snapshot = getWorldSnapshot(sceneId);
            const requiredDungeons = Array.isArray(worldCfg.requirements?.completedDungeons)
                ? worldCfg.requirements.completedDungeons
                : [];
            return {
                sceneId,
                name: worldName(sceneId),
                testOnly: WorldProgressionSystem.isDevWorldUnlocked(sceneId),
                status: portal.status,
                worldEpoch: portal.worldEpoch,
                hp: portal.hp,
                protected: protection.active,
                protectionRemainingMs: protection.remainingMs,
                candidate: candidateIds.has(sceneId),
                constructionEnabled: worldCfg.constructionEnabled !== false,
                requiredDungeons: requiredDungeons.map((dungeonType) => ({
                    dungeonType,
                    completed: WorldProgressionSystem.hasCompletedDungeon(dungeonType),
                })),
                generationVersion: generation.generationVersion,
                generationSeed: generation.seed,
                snapshot: snapshot ? {
                    exists: true,
                    worldEpoch: snapshot.worldEpoch || 0,
                    capturedGameTimeMs: snapshot.capturedGameTimeMs || 0,
                    structures: snapshot.structures?.length || 0,
                    units: (snapshot.structures || []).reduce((sum, structure) =>
                        sum + (Array.isArray(structure.unitRoster)
                            ? structure.unitRoster.length : Math.max(0, Number(structure.units) || 0)), 0),
                    resourceNodes: snapshot.nodes?.length || 0,
                    roads: snapshot.roads?.length || 0,
                } : { exists: false },
            };
        });
        return {
            version: VERSION,
            nowGameTimeMs,
            dayDurationMs: dayDurationMs(),
            cycle: state.cycle,
            progressMs: state.progressMs,
            active: primaryBattle() ? clone(primaryBattle()) : null, battles: clone(battles()),
            candidatePool: candidates.map((world) => world.sceneId),
            worlds,
        };
    },

    debugAdvanceDays(days, currentScene = (typeof window !== 'undefined'
        ? (window.SceneManager?.getCurrentWorldId?.() || window.SceneManager?.currentScene) : null)) {
        const safeDays = Math.max(0, Math.min(30, Number(days) || 0));
        const advancedMs = safeDays * dayDurationMs();
        EnvironmentLightingSystem.advanceTime(advancedMs);
        const testOnly = WorldProgressionSystem.isDevWorldUnlocked(currentScene);
        // 测试位面仍使用统一昼夜时钟，但不会借调试跳时推进正式入侵周期或后台战事。
        if (!testOnly) this.update(advancedMs);
        return { ok: true, advancedMs, testOnly, model: this.getDebugModel() };
    },

    /** 开发工具：当前位面立即开战；只跳过集结/行军，不推进时钟或重新抽取已出发军团。 */
    async debugGenerateInvasionHere() {
        const sceneId = window.SceneManager?.currentScene;
        const strategy = window.WorldStrategySystem;
        const capturedState = state;
        const testOnly = WorldProgressionSystem.isDevWorldUnlocked(sceneId);
        const targetIssue = () => {
            if (state !== capturedState) return '存档已切换，本次生成已取消';
            if (!Game.isRunning || !sceneId || window.SceneManager?.currentScene !== sceneId
                || liveWorldId !== sceneId || !DefenseSystem.active || !DefenseSystem._managedExternally
                || !this._livePortal || this._livePortal._portalDestroyed) return '请先进入已建成传送门的位面基地';
            if (window.SceneManager?.isLoading || strategy?._busy || strategy?.active) return '请先结束场景切换或返回位面基地';
            if (!WorldProgressionSystem.isPortalConstructed(sceneId)) return '当前位面的传送门尚未建成或已被摧毁';
            if (battleFor(sceneId) || (!testOnly && battles().some((battle) => !battle.enemyId && !battle.testOnly))) {
                return '已有入侵或当前位面正在交战，请先结束战斗';
            }
            if (WorldProgressionSystem.isWorldInvasionProtected(sceneId)) return '当前位面仍在新生保护期，暂不能入侵';
            return null;
        };
        const issue = targetIssue();
        if (issue) return { ok: false, reason: issue };
        if (this._formationTask) return { ok: false, reason: '入侵编队正在准备，请等待完成后再操作' };
        if (!testOnly && state.pendingMarchId) {
            const enemy = strategy?.state?.enemies?.find((entry) => entry.id === state.pendingMarchId);
            if (enemy?.invasion?.targetWorld !== sceneId) return { ok: false, reason: '已有军团向其他位面行军，不能重复生成' };
            if (!this.startMarchedInvasion(enemy)) return { ok: false, reason: '现有军团暂时无法进入当前位面' };
            // 与正常抵达一致：移除棋子，战斗继续消费同一份战损和召唤账本。
            strategy.state.enemies = strategy.state.enemies.filter((entry) => entry !== enemy);
            return { ok: true, targetWorld: sceneId, familyName: enemy.invasion.familyName, fromMarch: true };
        }
        const pendingPlan = testOnly ? null : state.musterPlan;
        if (pendingPlan && pendingPlan.targetWorld !== sceneId) return { ok: false, reason: '已有其他位面的集结方案，请先处理该次入侵' };
        const sequence = testOnly ? ++debugInvasionSequence : state.cycle + 1;
        const plan = pendingPlan || { cycle: sequence, day: EnvironmentLightingSystem.getGameTime()?.day || 1,
            seed: testOnly ? (state.nextSeed + Math.imul(sequence, 0x9e3779b9)) >>> 0 : state.nextSeed,
            targetWorld: sceneId, worldEpoch: WorldProgressionSystem.getWorldEpoch(sceneId) };
        const cancelled = () => state !== capturedState || window.SceneManager?.currentScene !== sceneId
            || liveWorldId !== sceneId
            || (!testOnly && (state.musterPlan !== pendingPlan || !!state.pendingMarchId))
            || !WorldProgressionSystem.isWorldEpochCurrent(sceneId, plan.worldEpoch);
        const task = plan.formation ? Promise.resolve(plan.formation)
            : buildInvasionFormation(plan.cycle, Math.max(plan.day, EnvironmentLightingSystem.getGameTime()?.day || 1), sceneId,
                { seed: plan.seed, lastFamilyId: state.lastFamilyId, isCancelled: cancelled });
        this._formationTask = task;
        try {
            const formation = await task;
            if (cancelled() || !formation) return { ok: false, reason: '场景、基地或集结状态已改变，本次生成已取消' };
            const latestIssue = targetIssue();
            if (latestIssue) return { ok: false, reason: latestIssue };
            // 不插入大地图棋子；复用实际抵达后的正式战斗入口和编队周期结算。
            const enemy = { id: `instant_${plan.cycle}_${plan.seed}`, roster: formation.waves.flat(),
                invasion: { cycle: plan.cycle, targetWorld: sceneId, worldEpoch: plan.worldEpoch,
                    familyId: formation.familyId, familyName: formation.familyName, seed: formation.seed,
                    catalogVersion: formation.catalogVersion, summonLedger: clone(formation.summonLedger) } };
            if (!this._beginInvasionBattle(enemy, { testOnly })) {
                return { ok: false, reason: '当前位面已无法启动入侵' };
            }
            if (!testOnly) commitInvasionCycle({ ...plan, formation });
            return { ok: true, targetWorld: sceneId, familyName: formation.familyName,
                fromMarch: false, testOnly };
        } catch (error) {
            const reason = String(error?.message || error || '入侵编队准备失败');
            if (!testOnly && !cancelled()) state.lastMusterIssue = reason;
            return { ok: false, reason };
        } finally {
            if (this._formationTask === task) this._formationTask = null;
        }
    },

    /** 开发工具：按正式地牢成功结算入口补齐目标位面的全部地牢前置。 */
    debugCompleteWorldRequirements(sceneId) {
        const world = WorldProgressionSystem.getWorldConfig(sceneId);
        if (!world) return { ok: false, reason: '未知世界位面' };

        const portalBefore = WorldProgressionSystem.getPortalState(sceneId);
        if (portalBefore.constructed && !portalBefore.destroyed) {
            return { ok: true, changed: false, reason: '该位面已经接入传送网络', model: this.getDebugModel() };
        }
        if (world.constructionEnabled === false && !portalBefore.everConstructed) {
            return { ok: false, reason: '该位面配置尚未开放首次传送门构造' };
        }

        const required = Array.isArray(world.requirements?.completedDungeons)
            ? world.requirements.completedDungeons.filter(Boolean)
            : [];
        const completed = [];
        for (const dungeonType of required) {
            if (WorldProgressionSystem.hasCompletedDungeon(dungeonType)) continue;
            const grade = DungeonConfig.getDungeonGrade(dungeonType) || 'F';
            this.recordDungeonRun(dungeonType, grade, 'success');
            completed.push({ dungeonType, grade });
        }

        const portal = WorldProgressionSystem.getPortalState(sceneId);
        const constructable = WorldProgressionSystem.getConstructableWorlds()
            .some((entry) => entry.sceneId === sceneId);
        if (!constructable && !portal.constructed) {
            return {
                ok: false,
                reason: required.length ? '地牢前置已完成，但该位面当前仍不可构造' : '该位面没有可补齐的地牢前置',
                completed,
                model: this.getDebugModel(),
            };
        }
        return {
            ok: true,
            changed: completed.length > 0,
            completed,
            sceneId,
            portalStatus: portal.status,
            model: this.getDebugModel(),
        };
    },

    debugDestroyPortal(sceneId) {
        const portal = WorldProgressionSystem.getPortalState(sceneId);
        if (!portal.constructed || portal.destroyed) {
            return { ok: false, reason: '该位面当前没有可摧毁的传送门' };
        }
        const worldEpoch = portal.worldEpoch;
        const ok = this.onPortalDestroyed(sceneId, worldEpoch);
        return { ok: !!ok, sceneId, worldEpoch, model: this.getDebugModel() };
    },
};

// 只读本位面的战事与核心，不物化后台实体，也不读取其他位面的战斗状态。
setPopulationSafetyProvider((sceneId, worldEpoch) => {
    const id = sceneId || liveWorldId;
    if (!id) return { known: false };
    const portal = WorldProgressionSystem.getPortalState(id);
    if (!portal.constructed || portal.destroyed
        || (worldEpoch != null && portal.worldEpoch !== worldEpoch)) return { known: false };
    const battle = battleFor(id);
    const hp = id === liveWorldId && WorldInvasionSystem._livePortal
        ? WorldInvasionSystem._livePortal.hp : portal.hp;
    return { known: true, sieged: !!battle && battle.worldEpoch === portal.worldEpoch,
        coreHpRatio: Math.max(0, Number(hp) || 0) / Math.max(1, Number(worldSystemConfig.portal?.maxHp) || 5000) };
});
