// ============================================================
// 世界-122 场景快照（2026-08-18，多世界并行 M0）
// 目标：离开世界-122 不再归零——离场捕获、入场恢复、主存档持久化。
//
// 口径（M0 冻结语义，M1 将在此基础上加后台时间结算）：
// - 只存"玩家建设 + 世界进度"：基地 HP、波次、玩家建筑（含读条/兵种/单位数）、矿点状态。
//   怪物/投射物/特效等 transient 一律不入快照；波次进行中离开 → 回场在 break 阶段重开本波。
// - 计时器按"剩余毫秒"冻结保存（dt 语义不变，回场原样续跑）。
// - 单位（矿工/兵种）只记兵种与存活数量，回场在建筑旁重新生成（全局升级等级自动生效）；
//   单位位置与战斗状态不保留。
// - 败北（defeated）不持久化：下次进入重新开局（与 roguelike 轮回口径一致）。
// ============================================================
// 不能在这里静态导入 Game / 建筑类：该模块会被 GameUIManager 在游戏启动阶段加载，
// 而建筑类继承 DamageableEntity，后者又依赖 Game，形成 TDZ 循环。
// 由 SceneManager.init() 在 Game 初始化完成后注入运行时依赖。
import { settleWorld122 } from './world122-sim.js'; // 纯数据结算（无 Game 依赖链），可静态导入
import { BuildingRoadSystem } from './building-road-system.js';
import { getUnitKind } from './unit-upgrade-store.js';
import barracksBuildingCfg from '../../data/hamster-barracks-building.json';
import worldSystemConfig from '../../data/world-system.json';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { createWorldGenerationContext, getWorldResetPolicy } from './world-reset-policy.js';

let Game = null;
let DefenseSystem = null;
let DefenseTower = null;
let DefenseCover = null;
let BuildableGate = null;
let WallStaircase = null;
let DEFENSE_CONFIG = null;
let HamsterHutSystem = null;
let HamsterHut = null;
let HamsterBarracksSystem = null;
let HamsterBarracks = null;
let ProducerBuildingSystem = null;
let ProducerBuilding = null;
let getProducerConfig = null;
let EnergyNodeSystem = null;
let EnergyManager = null;
let ResearchSystem = null;
let GoldManager = null;
let getWorldEpoch = null;
let canPersistWorld = null;
let getWorldGenerationContext = null;

export function configureWorld122SnapshotRuntime(deps = {}) {
    ({
        Game,
        DefenseSystem,
        DefenseTower,
        DefenseCover,
        BuildableGate,
        WallStaircase,
        DEFENSE_CONFIG,
        HamsterHutSystem,
        HamsterHut,
        HamsterBarracksSystem,
        HamsterBarracks,
        ProducerBuildingSystem,
        ProducerBuilding,
        getProducerConfig,
        EnergyNodeSystem,
        EnergyManager,
        ResearchSystem,
        GoldManager,
        getWorldEpoch,
        canPersistWorld,
        getWorldGenerationContext,
    } = deps);
}

const SNAPSHOT_VERSION = 1;

// 多世界驻留：scene8~scene11 共用同一套建筑协议，按 sceneId 分槽保存。
const _storedByWorld = {};

const _clone = (o) => JSON.parse(JSON.stringify(o));

function _snapshotConfig() {
    const spawnCfg = DEFENSE_CONFIG?.spawn || {};
    return {
        prepMs: spawnCfg.prepMs ?? 30000,
        waveBreakMs: spawnCfg.waveBreakMs ?? 10000,
        victoryWave: spawnCfg.victoryWave ?? 10,
        victoryReward: spawnCfg.victoryReward || { gold: 500, energy: 500 },
        waveBudgetBase: spawnCfg.waveBudgetBase ?? 26,
        waveBudgetGrowth: spawnCfg.waveBudgetGrowth ?? 1.15,
        hpPerWave: spawnCfg.hpPerWave ?? 0.16,
        atkPerWave: spawnCfg.atkPerWave ?? 0.08,
    };
}

function _snapshotLifecycle(sceneId, worldEpoch, generationOverride = null) {
    const policy = getWorldResetPolicy(sceneId);
    const generation = generationOverride
        || getWorldGenerationContext?.(sceneId)
        || createWorldGenerationContext(sceneId, worldEpoch);
    const templateKey = BASE_SNAPSHOT_TEMPLATES[policy.baseTemplate]
        ? policy.baseTemplate
        : 'portal_only_v1';
    return {
        reset: {
            policyVersion: policy.policyVersion,
            baseTemplate: templateKey,
            resourceRule: generation.resourceRule || policy.resourceRule,
        },
        generation: {
            generationVersion: Math.max(1, Math.floor(Number(generation.generationVersion) || 1)),
            seedStrategy: generation.seedStrategy === 'fixed' ? 'fixed' : 'per_world_epoch',
            seed: Number(generation.seed) >>> 0,
        },
    };
}

function _portalOnlyBaseTemplate({ spawn, hp, maxHp }) {
    return {
        base: { hp },
        wave: { wave: 0, phase: 'prep', phaseTimer: 0, victory: true },
        structures: [{
            kind: 'producer',
            cfgKey: 'portal',
            x: Number(spawn.x) || 0,
            y: Number(spawn.y) || 0,
            hp,
            maxHp,
            buildCost: 0,
            buildCurrency: 'energy',
        }],
        nodes: [],
        roads: [],
    };
}

const BASE_SNAPSHOT_TEMPLATES = Object.freeze({
    portal_only_v1: _portalOnlyBaseTemplate,
});

/**
 * 传送门一旦建成，立即按世界 resetPolicy 建立可存档、可后台承伤的基础位面快照。
 * 地形和资源仍由场景首次物化时按 generation/resourceRule 生成；首次离场后升级为完整快照。
 */
export function ensureWorldBaseSnapshot(sceneId, {
    portalHp, worldEpoch, generation = null, replace = false,
} = {}) {
    const worldCfg = worldSystemConfig.worlds?.[sceneId];
    if (!worldCfg) return null;
    const epoch = Math.max(0, Math.floor(Number(worldEpoch) || 0));
    const lifecycle = _snapshotLifecycle(sceneId, epoch, generation);
    const existing = _storedByWorld[sceneId];
    if (!replace && existing) {
        const storedEpoch = Math.max(0, Math.floor(Number(existing.worldEpoch) || 0));
        // v1 旧档没有世代号：首次恢复时归入当前世代；显式旧世代则不得沿用。
        if (epoch > 0 && storedEpoch <= 0) existing.worldEpoch = epoch;
        else if (epoch > 0 && storedEpoch !== epoch) replace = true;
        if (!replace) {
            // v1 快照迁移：补元数据但不覆盖已有完整建设状态。
            if (!existing.reset) existing.reset = lifecycle.reset;
            if (!existing.generation) existing.generation = lifecycle.generation;
            return existing;
        }
    }
    const maxHp = Math.max(1, Number(worldSystemConfig.portal?.maxHp) || 5000);
    const hp = Math.max(1, Math.min(maxHp, Number(portalHp) || maxHp));
    const spawn = worldCfg.portalSpawn || { x: 0, y: 0 };
    const capturedAt = Date.now();
    const capturedGameTimeMs = EnvironmentLightingSystem.serializeTime().elapsedMs || 0;
    const builder = BASE_SNAPSHOT_TEMPLATES[lifecycle.reset.baseTemplate]
        || BASE_SNAPSHOT_TEMPLATES.portal_only_v1;
    const snapshot = {
        version: SNAPSHOT_VERSION,
        sceneId,
        worldEpoch: epoch,
        initializedByPortal: true,
        ...lifecycle,
        capturedAt,
        capturedGameTimeMs,
        config: _snapshotConfig(),
        ...builder({ sceneId, spawn, hp, maxHp, generation: lifecycle.generation }),
    };
    _storedByWorld[sceneId] = snapshot;
    return snapshot;
}

/** 塔 DPS（实机口径入快照：武器伤害×模块×芯片已由 _recalcDamage 写入 attacks.config.damage） */
function _towerDps(t) {
    const cfg = t._attackKey && t.attacks ? t.attacks[t._attackKey]?.config : null;
    if (!cfg || !cfg.damage) return 0;
    const dmg = ((cfg.damage.min ?? 0) + (cfg.damage.max ?? 0)) / 2;
    const cd = cfg.cooldown > 0 ? cfg.cooldown : 0;
    return dmg > 0 && cd > 0 ? Math.round(dmg * 1000 / cd) : 0;
}

/** 军事单位合计 DPS（读存活单位 AI 实参，含全局升级生效值） */
function _unitsDps(units) {
    let sum = 0;
    for (const u of units || []) {
        if (!u || u.active === false || u._dying) continue;
        const dmg = u._ai?._attackDamage ?? 0;
        const interval = Math.max(300, u._ai?._attackInterval ?? 2000);
        sum += dmg * 1000 / interval;
    }
    return Math.round(sum);
}

function _unitRoster(units) {
    const roster = {};
    for (const unit of units || []) {
        if (!unit || unit.active === false || unit._dying || !(unit.data?.hp > 0)) continue;
        const kind = getUnitKind(unit);
        if (!kind) continue;
        roster[kind] = (roster[kind] || 0) + 1;
    }
    return roster;
}

/** 捕获当前世界-122 实况（要求 DefenseSystem.active，即玩家在 122 内） */
export function captureWorld(sceneId = 'scene8') {
    if (!DefenseSystem || !DefenseSystem.active) return null;
    if (canPersistWorld && !canPersistWorld(sceneId)) return null;
    if (!DefenseSystem._managedExternally && DefenseSystem.defeated) return null;

    // 系统持有的建筑（小屋/兵营/产兵）单独遍历，实体表扫描时跳过防双计
    const systemOwned = new Set();
    for (const h of HamsterHutSystem.huts || []) systemOwned.add(h);
    for (const b of HamsterBarracksSystem.barracks || []) systemOwned.add(b);
    for (const p of ProducerBuildingSystem.buildings || []) systemOwned.add(p);

    const structures = [];
    const alive = (e) => e && e.active !== false && (e.hp === undefined || e.hp > 0);

    // ---- 防御侧：塔/方块墙/4格门/城墙楼梯（扫描实体表，仅玩家建造）----
    for (const e of Game.entities.values()) {
        if (!alive(e) || !e._builtByPlayer || systemOwned.has(e)) continue;
        if (e._isDefenseTower) {
            structures.push({
                kind: 'tower', x: e.x, y: e.y, hp: Math.ceil(e.hp), maxHp: Math.ceil(e.maxHp),
                mirror: !!e._mirrored,
                chip: e.chip ? { ...e.chip } : null,
                modules: e.modules ? { ...e.modules } : {},
                weaponItem: e.weaponItem ? _clone(e.weaponItem) : null,
                dps: _towerDps(e),
                buildCost: e._buildCost ?? null, buildCurrency: e._buildCurrency ?? null,
            });
        } else if (e._isGate4 && e._buildGroupRoot === e) {
            // 4格门整组：门主体 + 石柱（整组回收口径的镜像）
            const pillars = (e._buildGroup || [])
                .filter((p) => p && p._isBlockCover && alive(p))
                .map((p) => ({ x: p.x, y: p.y, hp: Math.ceil(p.hp), maxHp: Math.ceil(p.maxHp) }));
            structures.push({
                kind: 'gate4', x: e.x, y: e.y, hp: Math.ceil(e.hp), maxHp: Math.ceil(e.maxHp),
                mirror: !!e.mirror, dir: e.mirror ? 'e1' : 'e2',
                pillars,
                buildCost: e._buildCost ?? null, buildCurrency: e._buildCurrency ?? null,
            });
        } else if (e._isBlockCover && !e._buildGroupRoot) {
            structures.push({
                kind: 'block', x: e.x, y: e.y, hp: Math.ceil(e.hp), maxHp: Math.ceil(e.maxHp),
                grade: e.grade || 'C',
                buildCost: e._buildCost ?? null, buildCurrency: e._buildCurrency ?? null,
            });
        } else if (e._isWallStaircase) {
            const wallLine = e.wall?._faceLine;
            structures.push({
                kind: 'wall_staircase',
                stairVersion: 2,
                x: e.x, y: e.y, hp: Math.ceil(e.hp),
                mirror: !!e._facingLeft,
                dir: e.dir || null,
                ascendingSign: e.ascendingSign || 1,
                segmentCount: e.segmentCount || 2,
                targetTopZ: e.targetTopZ || 125,
                segments: Array.isArray(e.segments)
                    ? e.segments.map((segment) => ({ x: segment.x, y: segment.y }))
                    : null,
                attachPoint: e.attachPoint ? { x: e.attachPoint.x, y: e.attachPoint.y } : null,
                wallAnchor: wallLine
                    ? {
                        x: (wallLine[0].x + wallLine[1].x) / 2,
                        y: (wallLine[0].y + wallLine[1].y) / 2,
                    }
                    : null,
                wallPosition: e.wall
                    ? { x: e.wall.x, y: e.wall.y }
                    : null,
                buildCost: e._buildCost ?? null, buildCurrency: e._buildCurrency ?? null,
            });
        }
    }

    // ---- 仓鼠矿场 ----
    for (const h of HamsterHutSystem.huts || []) {
        if (!alive(h)) continue;
        structures.push({
            kind: 'hut', x: h.x, y: h.y, hp: Math.ceil(h.hp), mirror: !!h._facingLeft,
            modules: { ...(h.modules || {}) },
            storedEnergy: h._storedEnergy || 0,
            miners: h.aliveMinerCount(),
            respawnTimer: h._respawnTimer || 0,
            rally: h._rallyPoint ? { x: h._rallyPoint.x, y: h._rallyPoint.y } : null,
            buildCost: h._buildCost ?? null, buildCurrency: h._buildCurrency ?? null,
        });
    }

    // ---- 仓鼠军营 ----
    for (const b of HamsterBarracksSystem.barracks || []) {
        if (!alive(b)) continue;
        const unitRoster = _unitRoster(b.units);
        const localUnits = Object.values(unitRoster).reduce((sum, count) => sum + count, 0);
        structures.push({
            kind: 'barracks', id: b.id, x: b.x, y: b.y, hp: Math.ceil(b.hp), mirror: !!b._facingLeft,
            troopProducer: true,
            unitType: b.unitType, spawnTimer: b._spawnTimer,
            units: localUnits, unitRoster, unitDps: _unitsDps(b.units),
            troopLineDeployed: Math.max(0, b.aliveUnitCount() - localUnits),
            rally: b._rallyPoint ? { x: b._rallyPoint.x, y: b._rallyPoint.y } : null,
            buildCost: b._buildCost ?? null, buildCurrency: b._buildCurrency ?? null,
        });
    }

    // ---- 配置产兵/功能建筑（草屋/靶场/铁匠铺/研究院/仓库/教堂/传送门…）----
    for (const p of ProducerBuildingSystem.buildings || []) {
        if (!alive(p)) continue;
        const unitRoster = p.spawnEnabled ? _unitRoster(p.units) : {};
        const localUnits = Object.values(unitRoster).reduce((sum, count) => sum + count, 0);
        structures.push({
            kind: 'producer', id: p.id, cfgKey: p.cfgKey, x: p.x, y: p.y, hp: Math.ceil(p.hp), mirror: !!p._facingLeft,
            troopProducer: !!p._isTroopProducer,
            unitType: p.unitType || '', spawnTimer: p._spawnTimer || 0,
            units: localUnits,
            unitRoster,
            unitDps: p.spawnEnabled ? _unitsDps(p.units) : 0,
            troopLineDeployed: p.spawnEnabled ? Math.max(0, p.aliveUnitCount() - localUnits) : 0,
            upgrade: p._upgrade ? { abilityId: p._upgrade.abilityId, totalMs: p._upgrade.totalMs, remainMs: p._upgrade.remainMs } : null,
            continuous: p._continuous || null,
            titheTimerMs: p.units?.find((unit) => unit?._isHamsterPriest && unit.active !== false)?._ai?._titheTimer || 0,
            storedEnergy: p._isEnergyWarehouse ? (p.storedEnergy || 0) : undefined,
            rally: p._rallyPoint ? { x: p._rallyPoint.x, y: p._rallyPoint.y } : null,
            buildCost: p._buildCost ?? null, buildCurrency: p._buildCurrency ?? null,
        });
    }

    // ---- 波次：进行中离开 → 回场在 break 阶段重开本波（不逐怪存档）----
    const spawnCfg = DEFENSE_CONFIG.spawn || {};
    let wave = {
        wave: DefenseSystem._wave || 0,
        phase: DefenseSystem._phase || 'prep',
        phaseTimer: DefenseSystem._phaseTimer ?? (spawnCfg.prepMs ?? 30000),
        victory: !!DefenseSystem.victory,
    };
    // 新全局入侵由 WorldInvasionSystem 管理；世界快照只负责生产与建筑，不再启动旧十波防守。
    if (DefenseSystem._managedExternally) {
        wave = { wave: 0, phase: 'prep', phaseTimer: 0, victory: true };
    }
    if (wave.phase === 'wave') {
        wave = { wave: wave.wave, phase: 'break', phaseTimer: spawnCfg.waveBreakMs ?? 10000, victory: false };
    }

    // ---- 基地核心 ----
    const base = DefenseSystem.base && DefenseSystem.base.active !== false
        ? { hp: Math.max(1, Math.ceil(DefenseSystem.base.hp)) }
        : null;

    // ---- 能源矿点（位置由位面世代种子生成；余量/枯竭计时必须入快照）----
    const nodes = (EnergyNodeSystem.nodes || []).filter(alive).map((n) => ({
        x: n.x, y: n.y, hp: Math.ceil(n.hp), maxHp: n.maxHp,
        depleted: !!n._depleted, respawnTimer: n._respawnTimer || 0,
        variant: n._variant || 1,
    }));

    const worldEpoch = Math.max(0, Math.floor(Number(getWorldEpoch?.(sceneId)) || 0));
    return {
        version: SNAPSHOT_VERSION,
        sceneId,
        worldEpoch,
        ..._snapshotLifecycle(sceneId, worldEpoch),
        capturedAt: Date.now(),
        capturedGameTimeMs: EnvironmentLightingSystem.serializeTime().elapsedMs || 0,
        // 波次/结算参数随快照封存（后台结算与配置同生命周期，防版本间口径漂移）
        config: _snapshotConfig(),
        base,
        wave,
        structures,
        nodes,
        roads: BuildingRoadSystem.captureManualRoads(),
    };
}

/** 捕获并驻留内存（场景离场钩子调用） */
export function captureAndStoreWorld(sceneId = 'scene8') {
    const snap = captureWorld(sceneId);
    if (snap) _storedByWorld[sceneId] = snap;
    else if (canPersistWorld && !canPersistWorld(sceneId)) delete _storedByWorld[sceneId];
    return snap;
}

export function captureWorld122() { return captureWorld('scene8'); }
export function captureAndStoreWorld122() { return captureAndStoreWorld('scene8'); }

/** 读取驻留快照（不消费） */
export function getWorld122Snapshot() {
    const snapshot = _storedByWorld.scene8;
    return isWorldSnapshotCurrent('scene8', snapshot) ? snapshot : null;
}

export function getWorldSnapshot(sceneId) {
    const snapshot = _storedByWorld[sceneId];
    return isWorldSnapshotCurrent(sceneId, snapshot) ? snapshot : null;
}

export function getWorldSnapshots() {
    return _storedByWorld;
}

/** 只有当前位面世代的快照才允许恢复、保存或参与后台结算。 */
export function isWorldSnapshotCurrent(sceneId, snapshot = _storedByWorld[sceneId]) {
    if (!snapshot) return false;
    const expected = Math.max(0, Math.floor(Number(getWorldEpoch?.(sceneId)) || 0));
    if (expected <= 0) return true;
    return Math.floor(Number(snapshot.worldEpoch) || 0) === expected;
}

/** 彻底作废单个位面的全部驻留记录；下次建门后按场景基础规则重新生成。 */
export function resetWorldSnapshot(sceneId) {
    if (!sceneId || !_storedByWorld[sceneId]) return false;
    delete _storedByWorld[sceneId];
    return true;
}

/** 清空快照（新游戏重置） */
export function resetWorld122Snapshot() {
    for (const key of Object.keys(_storedByWorld)) delete _storedByWorld[key];
}

export const resetWorldSnapshots = resetWorld122Snapshot;

/** 主存档序列化：在 122 内取实况，否则取驻留 */
export function serializeWorld122Scene() {
    if (canPersistWorld && !canPersistWorld('scene8')) {
        delete _storedByWorld.scene8;
        return null;
    }
    if (DefenseSystem && DefenseSystem.active && DefenseSystem._worldId === 'scene8') {
        const live = captureWorld('scene8');
        if (live) { _storedByWorld.scene8 = live; return live; }
    }
    return isWorldSnapshotCurrent('scene8', _storedByWorld.scene8) ? _storedByWorld.scene8 : null;
}

export function serializeWorldScenes() {
    if (DefenseSystem?.active && DefenseSystem._worldId) {
        const liveSceneId = DefenseSystem._worldId;
        const live = captureWorld(liveSceneId);
        if (live) _storedByWorld[liveSceneId] = live;
        else if (canPersistWorld && !canPersistWorld(liveSceneId)) delete _storedByWorld[liveSceneId];
    }
    for (const [sceneId, snapshot] of Object.entries(_storedByWorld)) {
        if ((canPersistWorld && !canPersistWorld(sceneId))
            || !isWorldSnapshotCurrent(sceneId, snapshot)) delete _storedByWorld[sceneId];
    }
    return _clone(_storedByWorld);
}

/** 主存档恢复：写入驻留（进入 122 时才真正物化） */
export function restoreWorld122Scene(data) {
    if (data && data.version === SNAPSHOT_VERSION) _storedByWorld.scene8 = data;
    else delete _storedByWorld.scene8;
}

export function restoreWorldScenes(data) {
    for (const key of Object.keys(_storedByWorld)) delete _storedByWorld[key];
    if (!data || typeof data !== 'object') return;
    // 兼容旧档直接保存单个 scene8 快照。
    if (data.version === SNAPSHOT_VERSION && Array.isArray(data.structures)) {
        _storedByWorld.scene8 = data;
        return;
    }
    for (const [sceneId, snap] of Object.entries(data)) {
        if (snap && snap.version === SNAPSHOT_VERSION) _storedByWorld[sceneId] = snap;
    }
}

/** 玩家是否在世界-122 内（前台全真时后台驱动停 tick） */
export function isWorld122Live() {
    return !!(DefenseSystem && DefenseSystem.active && DefenseSystem._worldId === 'scene8');
}

export function isWorldLive(sceneId) {
    return !!(DefenseSystem && DefenseSystem.active && DefenseSystem._worldId === sceneId);
}

/** 世界切换面板预览：不回写快照、无全局副作用（commit=false）；
 *  玩家在 122 内或无快照时返回 null。 */
export function previewWorld122Report() {
    const stored = _storedByWorld.scene8;
    if (!stored || !isWorldSnapshotCurrent('scene8', stored)) return null;
    if (isWorld122Live()) return null;
    const nowGame = EnvironmentLightingSystem.serializeTime().elapsedMs || 0;
    const elapsed = Math.max(0, nowGame - (stored.capturedGameTimeMs || nowGame));
    if (elapsed < 1000) return null;
    return settleWorld122(stored, elapsed, { commit: false, skipWaves: true });
}

// ==================== 恢复（_loadScene8 尾部调用） ====================

let _seq = 0;

function _markRestored(entity, entry) {
    entity._builtByPlayer = true;
    // 普通建筑统一由 _facingLeft 驱动 Phaser flipX；旧快照没有 mirror 时保持默认朝向。
    if (entry.mirror !== undefined) entity._facingLeft = !!entry.mirror;
    if (entry.buildCost != null) entity._buildCost = entry.buildCost;
    if (entry.buildCurrency) entity._buildCurrency = entry.buildCurrency;
    if (entry.hp != null) {
        if (entry.maxHp > 0 && entity.maxHp > 0) {
            const missingHp = Math.max(0, entry.maxHp - entry.hp);
            entity.hp = Math.max(0, entity.maxHp - missingHp);
        } else {
            entity.hp = Math.min(entry.hp, entity.maxHp ?? entry.hp);
        }
        if (entity.data) entity.data.hp = entity.hp;
    }
}

function _restoreTower(s) {
    const tower = new DefenseTower(s.x, s.y, { id: s.id || `built_tower_r${++_seq}` });
    _markRestored(tower, s);
    tower._mirrored = !!s.mirror;
    if (s.chip) Object.assign(tower.chip, s.chip);
    if (s.modules) tower.modules = { ...s.modules };
    if (s.weaponItem) tower.equipWeapon(_clone(s.weaponItem)); // 内部会按模块重算武器参数
    else if (typeof tower._applyModuleWeaponParams === 'function') tower._applyModuleWeaponParams();
    Game.entities.set(tower.id, tower);
    DefenseSystem.towers.push(tower);
}

function _restoreBlock(s) {
    const cover = new DefenseCover(s.x, s.y, {
        grade: s.grade || 'C', orient: 'v', mirror: false, block: true,
        id: s.id || `built_block_r${++_seq}`,
    });
    _markRestored(cover, s);
    Game.entities.set(cover.id, cover);
    return cover;
}

function _restoreGate4(s) {
    // 先石柱后门（与 _placeGate4 同序），整组回收链路重建
    const group = [];
    for (const p of s.pillars || []) {
        const cover = _restoreBlock({
            kind: 'block', x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, grade: 'C'
        });
        cover._buildCost = 0; // 石柱成本计入门主体
        group.push(cover);
    }
    const gate = new BuildableGate(s.x, s.y, {
        grade: 'D',                       // 视觉沿用已验收 D 级素材
        hp: DEFENSE_CONFIG.covers.hp.C ?? 1600,
        isGate4: true, orient: 'v', mirror: !!s.mirror, barCells: 2, barsOnly: true,
        id: s.id || `built_gate4_r${++_seq}`,
    });
    gate.grade = 'C';                     // 详情/数值显示 C 级
    _markRestored(gate, s);
    Game.entities.set(gate.id, gate);
    if (DefenseSystem.gates) DefenseSystem.gates.push(gate);
    group.push(gate);
    for (const part of group) {
        part._buildGroup = group;
        part._buildGroupRoot = gate;
    }
}

function _nearestWalkableWall(anchor, wallPosition = null) {
    if ((!anchor && !wallPosition) || !Game.entities) return null;
    let best = null;
    for (const wall of Game.entities.values()) {
        if (!wall || !wall.active || !wall._isWalkableWall || !Array.isArray(wall._faceLine)) continue;
        if (wallPosition) {
            const positionDistance = Math.hypot(
                wall.x - wallPosition.x,
                wall.y - wallPosition.y
            );
            if (positionDistance <= 8) return wall;
        }
        if (!anchor) continue;
        const [a, b] = wall._faceLine;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const d = Math.hypot(mx - anchor.x, my - anchor.y);
        if (!best || d < best.d) best = { wall, d };
    }
    return best && best.d <= 96 ? best.wall : null;
}

function _restoreWallStaircase(s) {
    const wall = _nearestWalkableWall(s.wallAnchor, s.wallPosition);
    if (!wall) throw new Error('楼梯恢复失败：找不到原墙体');
    const staircase = new WallStaircase(s.x, s.y, {
        mirror: !!s.mirror,
        dir: s.dir || (s.mirror ? 'e1' : 'e2'),
        ascendingSign: s.ascendingSign || 1,
        segmentCount: s.segmentCount || 2,
        targetTopZ: s.targetTopZ || wall?._wallTopZ || 125,
        segments: s.segments || null,
        attachPoint: s.attachPoint || s.wallAnchor || null,
        wall,
        id: s.id || `built_wall_staircase_r${++_seq}`,
    });
    _markRestored(staircase, s);
    Game.entities.set(staircase.id, staircase);
    if (DefenseSystem.staircases) {
        DefenseSystem.staircases.push(staircase);
        DefenseSystem.rebuildWallStairGroups?.();
        DefenseSystem.invalidateElevatedTopology?.();
    }
}

function _restoreHut(s) {
    const hut = new HamsterHut(s.x, s.y, {
        id: s.id || `built_hut_r${++_seq}`,
        skipInitialSpawn: true,
    });
    _markRestored(hut, s);
    hut.modules = { ...(s.modules || {}) };        // 先挂模块再补员，矿工吃到升级
    hut._storedEnergy = Math.max(0, s.storedEnergy || 0);
    if (s.rally) hut._rallyPoint = { x: s.rally.x, y: s.rally.y };
    Game.entities.set(hut.id, hut);
    HamsterHutSystem.huts.push(hut);
    BuildingRoadSystem.attach(hut, { allowOverlap: true });
    const want = Math.max(0, Math.min(s.miners || 0, hut.minerCount()));
    let spawned = 0;
    for (let i = 0; i < want; i++) if (hut.spawnMiner()) spawned++;
    // 出口槽位预约窗口 750ms，爆发生成会互撞——缺额走 _restoreTopUp 加速补齐（立即启动 800ms 节拍）
    if (spawned < want) { hut._restoreTopUp = want - spawned; hut._respawnTimer = 800; }
    // 仍有缺员时按原剩余时间续跑补员计时
    if (hut.aliveMinerCount() < hut.minerCount()) hut._respawnTimer = Math.max(0, s.respawnTimer || 0);
}

function _restoreBarracks(s, sceneId) {
    const barracks = new HamsterBarracks(s.x, s.y, { id: s.id || `built_barracks_r${++_seq}` });
    _markRestored(barracks, s);
    if (!(barracksBuildingCfg.unitTypes || []).includes(s.unitType)) {
        s.unitType = barracksBuildingCfg.defaultUnitType || 'warrior';
    }
    barracks.unitType = s.unitType;
    barracks._spawnTimer = Math.max(0, s.spawnTimer || 0);
    if (s.rally) barracks._rallyPoint = { x: s.rally.x, y: s.rally.y };
    Game.entities.set(barracks.id, barracks);
    HamsterBarracksSystem.barracks.push(barracks);
    BuildingRoadSystem.attach(barracks, { allowOverlap: true });
    const roster = s.unitRoster && typeof s.unitRoster === 'object'
        ? s.unitRoster
        : { [barracks.unitType]: s.units || 0 };
    const selectedType = barracks.unitType;
    let spawned = 0;
    const restoreQueue = [];
    const cap = barracks.unitCount();
    for (const [kind, rawCount] of Object.entries(roster)) {
        if (!(barracksBuildingCfg.unitTypes || []).includes(kind)) continue;
        barracks.unitType = kind;
        const count = Math.max(0, Math.min(Math.floor(Number(rawCount) || 0), cap - spawned));
        for (let i = 0; i < count; i++) {
            if (barracks.spawnUnit(false, { restoring: true, sourceSceneId: sceneId })) spawned++;
            else restoreQueue.push(kind);
        }
        if (spawned >= cap) break;
    }
    barracks.unitType = selectedType;
    const want = Math.max(0, Math.min(
        Object.values(roster).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0),
        cap
    ));
    // 出口槽位预约窗口 750ms，爆发生成会互撞——缺额走 _restoreTopUp 加速补齐（立即启动 800ms 节拍）
    if (spawned < want) {
        barracks._restoreRosterQueue = restoreQueue;
        barracks._spawnTimer = 800;
    }
}

function _restoreProducer(s, sceneId) {
    const cfg = getProducerConfig(s.cfgKey);
    if (!cfg) return; // 配置已移除的建筑跳过（版本兼容）
    const producer = new ProducerBuilding(s.x, s.y, { id: s.id || `built_${s.cfgKey}_r${++_seq}`, cfgKey: s.cfgKey });
    _markRestored(producer, s);
    if ((cfg.unitTypes || []).some((t) => t.key === s.unitType)) producer.unitType = s.unitType;
    producer._spawnTimer = Math.max(0, s.spawnTimer || 0);
    producer._restoredTitheTimer = Math.max(0, Number(s.titheTimerMs) || 0);
    if (s.rally) producer._rallyPoint = { x: s.rally.x, y: s.rally.y };
    // 能力/研究读条续跑（等级全局共享，读条属建筑实例）
    if (s.upgrade && cfg.abilities && cfg.abilities[s.upgrade.abilityId]) {
        producer._upgrade = {
            abilityId: s.upgrade.abilityId,
            totalMs: Math.max(1, s.upgrade.totalMs || 1),
            remainMs: Math.max(0, s.upgrade.remainMs || 0),
        };
        producer._continuous = s.continuous && cfg.abilities[s.continuous] ? s.continuous : null;
    }
    Game.entities.set(producer.id, producer);
    ProducerBuildingSystem.buildings.push(producer);
    BuildingRoadSystem.attach(producer, { allowOverlap: true });
    // 仓库：构造时已向 EnergyManager 注册（pending 能源会先行灌入），此处按快照覆盖回本仓原量
    if (producer._isEnergyWarehouse && s.storedEnergy != null && EnergyManager) {
        producer.storedEnergy = Math.max(0, Math.min(producer.storageCapacity || 0, Math.floor(s.storedEnergy)));
    }
    if (producer.spawnEnabled) {
        const roster = s.unitRoster && typeof s.unitRoster === 'object'
            ? s.unitRoster
            : { [producer.unitType]: s.units || 0 };
        const selectedType = producer.unitType;
        let spawned = 0;
        const restoreQueue = [];
        const cap = producer.unitCount();
        for (const [kind, rawCount] of Object.entries(roster)) {
            if (!(cfg.unitTypes || []).some((unit) => unit.key === kind)) continue;
            producer.unitType = kind;
            const count = Math.max(0, Math.min(Math.floor(Number(rawCount) || 0), cap - spawned));
            for (let i = 0; i < count; i++) {
                if (producer.spawnUnit(false, { restoring: true, sourceSceneId: sceneId })) spawned++;
                else restoreQueue.push(kind);
            }
            if (spawned >= cap) break;
        }
        producer.unitType = selectedType;
        const want = Math.max(0, Math.min(
            Object.values(roster).reduce((sum, count) => sum + Math.max(0, Number(count) || 0), 0),
            cap
        ));
        // 出口槽位预约窗口 750ms，爆发生成会互撞——缺额走 _restoreTopUp 加速补齐（立即启动 800ms 节拍）
        if (spawned < want) {
            producer._restoreRosterQueue = restoreQueue;
            producer._spawnTimer = 800;
        }
    }
}

/** 入场恢复（各系统 setup 完成后调用；无快照或版本不符则跳过）。
 *  M1：先按离场时长做后台抽象结算（settleWorld122），再物化；
 *  返回 false（未恢复）/ 结算报告对象（含 report；defeated 时快照作废）。 */
export function applyWorldSnapshot(sceneId = 'scene8', snap = _storedByWorld[sceneId]) {
    if (!snap || snap.version !== SNAPSHOT_VERSION) return false;
    if (!DefenseSystem || !DefenseSystem.active) return false;
    if (!isWorldSnapshotCurrent(sceneId, snap)) {
        delete _storedByWorld[sceneId];
        return false;
    }

    // ---- M1 后台结算（离场 >1s 才结算，避免同场秒切空跑）----
    const nowGame = EnvironmentLightingSystem.serializeTime().elapsedMs || 0;
    const elapsed = Math.max(0, nowGame - (snap.capturedGameTimeMs || nowGame));
    let report = null;
    if (elapsed > 1000) {
        report = settleWorld122(snap, elapsed, {
            commit: true,
            skipWaves: DefenseSystem._managedExternally === true,
            gameTimeMs: nowGame,
            grant: (reward) => {
                // 金币入全局金库；能源已由结算直接写入快照仓库（建筑尚未物化，EnergyManager 无法承接）
                if (reward.gold && GoldManager && typeof GoldManager.addGold === 'function') GoldManager.addGold(reward.gold);
            },
        });
        if (report.defeated) {
            delete _storedByWorld[sceneId];
            return { defeated: true, report };
        }
        // 结算后仍进行中的波次重开（实体不留档，M0 口径；后台进度清零）
        if (snap.wave && snap.wave.phase === 'wave') {
            snap.wave.phase = 'break';
            snap.wave.phaseTimer = (DEFENSE_CONFIG?.spawn?.waveBreakMs ?? 10000);
            snap.wave.progressSec = 0;
        }
    }

    // 基地核心血量
    if (snap.base && DefenseSystem.base) {
        DefenseSystem.base.hp = Math.max(1, Math.min(snap.base.hp, DefenseSystem.base.maxHp));
        if (DefenseSystem.base.data) DefenseSystem.base.data.hp = DefenseSystem.base.hp;
    }

    // 波次状态
    if (snap.wave) {
        DefenseSystem._wave = snap.wave.wave || 0;
        DefenseSystem._phase = snap.wave.phase || 'prep';
        DefenseSystem._phaseTimer = Math.max(0, snap.wave.phaseTimer || 0);
        if (snap.wave.victory) {
            DefenseSystem.victory = true;
            DefenseSystem._victoryGranted = true; // 奖励已在结算时发放，回场不重复
        }
    }

    // 玩家建筑（顺序：墙/门/台/塔先行，产兵建筑随后——单位出生校验依赖墙体碰撞已注册）
    let restored = 0;
    for (const s of snap.structures || []) {
        if (!(s.hp > 0)) continue; // 后台战斗被毁建筑不复活
        try {
            if (s.kind === 'tower') _restoreTower(s);
            else if (s.kind === 'block') _restoreBlock(s);
            else if (s.kind === 'gate4') _restoreGate4(s);
            // 旧射击台/旧单块楼梯不再迁移，防止在城墙上自动恢复出孤立贴图。
            else if (s.kind === 'wall_staircase' && (s.stairVersion || 0) >= 2) _restoreWallStaircase(s);
            else if (s.kind === 'hut') _restoreHut(s);
            else if (s.kind === 'barracks') _restoreBarracks(s, sceneId);
            else if (s.kind === 'producer') _restoreProducer(s, sceneId);
            else continue;
            restored++;
        } catch (err) {
            console.error('[WorldSnapshot] 建筑恢复失败:', sceneId, s.kind, err);
        }
    }

    // 手动道路是无碰撞派生地块；建筑先恢复，随后道路与自动道路环共享对应格贴图。
    BuildingRoadSystem.restoreManualRoads(snap.roads);

    // 能源矿点（快照含位置，不走随机重铺）
    if (Array.isArray(snap.nodes) && snap.nodes.length > 0
        && typeof EnergyNodeSystem.restoreNodes === 'function') {
        EnergyNodeSystem.restoreNodes(snap.nodes);
        // 不等待 GameScene 的周期巡检：立即剔除旧存档/HMR 遗留的门口、
        // 建筑重叠及重复矿点，避免它们在门打开的透明帧中短暂露出。
        if (typeof EnergyNodeSystem.sweepStacked === 'function') {
            EnergyNodeSystem.sweepStacked();
        }
    }

    // 研究 HP 对新建结构兜底刷新（构造时已各自 applyResearchHp，这里防漏）
    if (ResearchSystem && typeof ResearchSystem.refreshWorld === 'function') {
        ResearchSystem.refreshWorld();
    }
    return { restored: restored > 0, report };
}

export function applyWorld122Snapshot(snap = _storedByWorld.scene8) {
    return applyWorldSnapshot('scene8', snap);
}
