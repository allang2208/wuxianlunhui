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
import { normalizeRecruitMode } from './recruit-mode.js';
import worldSystemConfig from '../../data/world-system.json';
import { WorldInstanceSystem } from './world-instance-system.js';
import producerBuildingsConfig from '../../data/producer-buildings.json';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { createWorldGenerationContext, getWorldResetPolicy } from './world-reset-policy.js';
import {
    getBuildingContinuousCategory,
    getBuildingUpgradeProgressKeys,
    normalizeBuildingContinuousTarget,
} from './building-upgrade-projects.js';
import { FogOfWarSystem } from './fog-of-war-system.js';
import { setCrossPlaneSnapshotProvider } from './cross-plane-resource-system.js';
import { takeLegacyLocalResearchLevels } from './ability-store.js';
import { blockCellOf } from './gate4-grid.js';
import { createWallBattlementAttachment } from './wall-battlement.js';

let Game = null;
let DefenseSystem = null;
let DefenseTower = null;
let DefenseCover = null;
let BuildableGate = null;
let WallStaircase = null;
let DEFENSE_CONFIG = null;
let HamsterHutSystem = null;
let HamsterHut = null;
let ProducerBuildingSystem = null;
let ProducerBuilding = null;
let getProducerConfig = null;
let EnergyNodeSystem = null;
let EnergyManager = null;
let ResearchSystem = null;
let TechnologySystem = null;
let GoldManager = null;
let PopulationEconomySystem = null;
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
        ProducerBuildingSystem,
        ProducerBuilding,
        getProducerConfig,
        EnergyNodeSystem,
        EnergyManager,
        ResearchSystem,
        TechnologySystem,
        GoldManager,
        PopulationEconomySystem,
        getWorldEpoch,
        canPersistWorld,
        getWorldGenerationContext,
    } = deps);
}

const SNAPSHOT_VERSION = 1;

// 多世界驻留：scene8~scene12 共用同一套建筑协议，按逻辑 worldId 分槽保存。
const _storedByWorld = {};
setCrossPlaneSnapshotProvider(() => _storedByWorld);

const _clone = (o) => JSON.parse(JSON.stringify(o));
const LOCAL_RESEARCH_MODULE_IDS = new Set(['research_staff', 'research_base_points']);

function _resolveSnapshotWorldConfig(worldId) {
    const runtimeSceneId = WorldInstanceSystem.resolveRuntimeSceneId(worldId);
    const base = worldSystemConfig.worlds?.[runtimeSceneId] || null;
    const template = WorldInstanceSystem.getTemplateForWorld(worldId);
    if (!base && !template) return null;
    return { ...(template || {}), ...(base || {}), runtimeSceneId };
}

function _migrateResearchBuildingUpgrades(snapshot, legacyLevels = {}) {
    if (!snapshot || !Array.isArray(snapshot.structures)) return snapshot;
    // 账本派生缓存不跨读档复用；按当前配置、科技等级与快照内容在首个后台 tick 重建。
    snapshot.backgroundLedger = null;
    for (const structure of snapshot.structures) {
        if (structure?.kind !== 'producer' || structure.cfgKey !== 'research_institute') continue;
        structure.researchModules = { ...(structure.researchModules || {}) };
        for (const moduleId of LOCAL_RESEARCH_MODULE_IDS) {
            if (Object.prototype.hasOwnProperty.call(structure.researchModules, moduleId)) continue;
            const legacyLevel = Math.max(0, Math.floor(Number(legacyLevels[moduleId]) || 0));
            if (legacyLevel > 0) structure.researchModules[moduleId] = legacyLevel;
        }
        if (LOCAL_RESEARCH_MODULE_IDS.has(structure.upgrade?.abilityId)) {
            structure.researchUpgrade = {
                moduleId: structure.upgrade.abilityId,
                totalMs: structure.upgrade.totalMs,
                remainMs: structure.upgrade.remainMs,
            };
            structure.upgrade = null;
        }
        if (LOCAL_RESEARCH_MODULE_IDS.has(structure.continuous?.abilityId)) {
            structure.continuous = null;
        }
    }
    return snapshot;
}

function _snapshotUpgrade(upgrade) {
    if (!upgrade) return null;
    const out = {
        kind: upgrade.kind || (upgrade.abilityId ? 'ability' : 'module'),
        totalMs: Math.max(1, Number(upgrade.totalMs) || 1),
        remainMs: Math.max(0, Number(upgrade.remainMs) || 0),
    };
    if (upgrade.abilityId) out.abilityId = upgrade.abilityId;
    if (upgrade.moduleId) out.moduleId = upgrade.moduleId;
    if (upgrade.unitType) out.unitType = upgrade.unitType;
    if (Array.isArray(upgrade.unitTypes) && upgrade.unitTypes.length) {
        out.unitTypes = [...new Set(upgrade.unitTypes.filter(Boolean))];
    }
    return out;
}

function _snapshotContinuous(target) {
    const normalized = normalizeBuildingContinuousTarget(target);
    return normalized ? _clone(normalized) : null;
}

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

function _initialFeatureStructure(spawn, feature) {
    if (!feature?.cfgKey) return null;
    const featureCfg = producerBuildingsConfig[feature.cfgKey] || {};
    return {
        kind: 'producer',
        cfgKey: feature.cfgKey,
        x: (Number(spawn.x) || 0) + (Number(feature.offsetX) || 0),
        y: (Number(spawn.y) || 0) + (Number(feature.offsetY) || 0),
        hp: Math.max(1, Number(featureCfg.hp) || 1),
        maxHp: Math.max(1, Number(featureCfg.hp) || 1),
        troopProducer: featureCfg.spawnEnabled !== false,
        unitType: featureCfg.defaultUnitType || featureCfg.unitTypes?.[0]?.key || '',
        buildCost: 0,
        buildCurrency: 'gold',
        recruitMode: 'paused',
        parallelQueues: {},
        unitRoster: {},
    };
}

function _ensureInitialFeatureBuilding(snapshot, sceneId, includeInitialFeatureBuilding) {
    const worldCfg = _resolveSnapshotWorldConfig(sceneId);
    const feature = worldCfg?.featureBuilding;
    const migrationId = feature?.migrationId;
    if (!includeInitialFeatureBuilding || !feature?.cfgKey || !migrationId || !snapshot) return snapshot;
    if (!snapshot.featureBuildingMigrations || typeof snapshot.featureBuildingMigrations !== 'object') {
        snapshot.featureBuildingMigrations = {};
    }
    if (snapshot.featureBuildingMigrations[migrationId]) return snapshot;
    if (!Array.isArray(snapshot.structures)) snapshot.structures = [];
    if (!snapshot.structures.some((structure) => structure?.cfgKey === feature.cfgKey)) {
        const spawn = worldCfg?.portalSpawn || { x: 0, y: 0 };
        const structure = _initialFeatureStructure(spawn, feature);
        if (structure) {
            snapshot.structures.push(structure);
            snapshot.backgroundLedger = null;
        }
    }
    snapshot.featureBuildingMigrations[migrationId] = true;
    return snapshot;
}

function _portalOnlyBaseTemplate({ sceneId, spawn, hp, maxHp, includeInitialFeatureBuilding = false }) {
    const structures = [{
        kind: 'producer',
        id: `world_portal_${sceneId}`,
        cfgKey: 'portal',
        x: Number(spawn.x) || 0,
        y: Number(spawn.y) || 0,
        hp,
        maxHp,
        buildCost: 0,
        buildCurrency: 'energy',
    }];
    const feature = _resolveSnapshotWorldConfig(sceneId)?.featureBuilding;
    if (includeInitialFeatureBuilding && feature?.cfgKey) {
        const structure = _initialFeatureStructure(spawn, feature);
        if (structure) structures.push(structure);
    }
    const migrationId = includeInitialFeatureBuilding ? feature?.migrationId : null;
    return {
        base: { hp },
        wave: { wave: 0, phase: 'prep', phaseTimer: 0, victory: true },
        structures,
        featureBuildingMigrations: migrationId ? { [migrationId]: true } : {},
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
    includeInitialFeatureBuilding = false,
} = {}) {
    const worldCfg = _resolveSnapshotWorldConfig(sceneId);
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
            if (!existing.populationEconomy) existing.populationEconomy = { storageVersion: 2, foodStored: 0 };
            _ensureInitialFeatureBuilding(existing, sceneId, includeInitialFeatureBuilding);
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
        fogOfWar: null,
        ...lifecycle,
        capturedAt,
        capturedGameTimeMs,
        populationEconomy: { storageVersion: 2, foodStored: 0 },
        config: _snapshotConfig(),
        ...builder({
            sceneId, spawn, hp, maxHp, generation: lifecycle.generation,
            includeInitialFeatureBuilding,
        }),
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

    // 系统持有的建筑（矿工营地/通用出兵建筑）单独遍历，实体表扫描时跳过防双计
    const systemOwned = new Set();
    for (const h of HamsterHutSystem.huts || []) systemOwned.add(h);
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
        } else if (e._isWallBattlement) {
            const attachment = e._wallBattlementAttachment;
            if (!attachment?.wallCell || !attachment.edge) continue;
            structures.push({
                kind: 'wall_battlement',
                x: e.x, y: e.y, hp: Math.ceil(e.hp), maxHp: Math.ceil(e.maxHp),
                variant: e.battlementVariant || attachment.variant || 'high',
                wallCell: { ...attachment.wallCell },
                edge: attachment.edge,
                slot: attachment.slot,
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
                gateMode: ['auto', 'locked', 'open'].includes(e.gateMode) ? e.gateMode : 'auto',
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
            upgrade: h._upgrade ? {
                moduleId: h._upgrade.moduleId,
                totalMs: h._upgrade.totalMs,
                remainMs: h._upgrade.remainMs,
            } : null,
            storedEnergy: h._storedEnergy || 0,
            carriedEnergy: (h.miners || []).reduce((sum, miner) =>
                sum + Math.max(0, Number(miner?._energyCarried) || 0), 0)
                + Math.max(0, Number(h._pendingMinerEnergy) || 0),
            minerTavernRemainder: Math.max(0, Number(h._minerTavernRemainder) || 0),
            assignedWorkers: Math.max(0, Math.floor(Number(h._assignedWorkers) || 0)),
            miners: h.aliveMinerCount(),
            respawnTimer: h._respawnTimer || 0,
            rally: h._rallyPoint ? { x: h._rallyPoint.x, y: h._rallyPoint.y } : null,
            buildCost: h._buildCost ?? null, buildCurrency: h._buildCurrency ?? null,
        });
    }

    // ---- 配置产兵/功能建筑（军营/草屋/靶场/铁匠铺/研究院/仓库/教堂/传送门…）----
    for (const p of ProducerBuildingSystem.buildings || []) {
        if (!alive(p)) continue;
        const unitRoster = p.spawnEnabled ? _unitRoster(p.units) : {};
        const activeExplorers = (p.units || []).filter((unit) => alive(unit)
            && getUnitKind(unit) === 'explorer'
            && (unit._exploreActive || unit._command?.mode === 'explore'));
        const localUnits = Object.values(unitRoster).reduce((sum, count) => sum + count, 0);
        const troopLineDeployedRoster = p.spawnEnabled ? Object.fromEntries(
            (p._cfg.unitTypes || []).map((unit) => {
                const kind = unit?.key;
                const local = Math.max(0, Math.floor(Number(unitRoster[kind]) || 0));
                return [kind, Math.max(0, p.aliveUnitCount(kind) - local)];
            }).filter(([kind, count]) => kind && count > 0)
        ) : {};
        structures.push({
            kind: 'producer', id: p.id, cfgKey: p.cfgKey, x: p.x, y: p.y,
            hp: Math.ceil(p.hp), maxHp: Math.ceil(p.maxHp), mirror: !!p._facingLeft,
            troopProducer: !!p._isTroopProducer,
            unitType: p.unitType || '', spawnTimer: p._spawnTimer || 0, recruitMode: normalizeRecruitMode(p._recruitMode),
            populationBlocked: !!p._spawnPopulationBlocked,
            foodBlocked: !!p._spawnFoodBlocked,
            parallelQueues: p._parallelProduction ? Object.fromEntries(
                Object.entries(p._parallelQueues || {}).map(([kind, queue]) => [kind, {
                    recruitMode: normalizeRecruitMode(queue.recruitMode),
                    timer: Math.max(0, Number(queue.timer) || 0),
                    blocked: !!queue.blocked,
                    foodBlocked: !!queue.foodBlocked,
                    populationBlocked: !!queue.populationBlocked,
                }])
            ) : undefined,
            units: localUnits,
            unitRoster,
            explorerState: activeExplorers.length ? {
                activeCount: activeExplorers.length,
                runs: activeExplorers.map((unit) => ({
                    remainingMs: Math.max(0, Number(unit._ai?._remainingMs)
                        || Number(unit._exploreRemainingMs) || 0),
                    durationMs: Math.max(1000, Number(unit._ai?._durationMs)
                        || Number(unit._exploreDurationMs) || 720000),
                    playerLevel: Math.max(1, Math.floor(Number(unit._explorePlayerLevel) || 1)),
                })),
            } : null,
            unitDps: p.spawnEnabled ? _unitsDps(p.units) : 0,
            troopLineDeployed: p.spawnEnabled ? Math.max(0, p.aliveUnitCount() - localUnits) : 0,
            troopLineDeployedRoster,
            upgrade: _snapshotUpgrade(p._upgrade),
            continuous: _snapshotContinuous(p._continuous),
            titheTimerMs: p.units?.find((unit) => unit?._isHamsterPriest && unit.active !== false)?._ai?._titheTimer || 0,
            storedEnergy: p._isEnergyWarehouse ? (p.storedEnergy || 0) : undefined,
            storedFood: p._isEnergyWarehouse ? (p.storedFood || 0) : undefined,
            storageCapacity: p._isEnergyWarehouse ? (p.storageCapacity || 0) : undefined,
            warehouseModules: p._isEnergyWarehouse ? { ...(p.warehouseModules || {}) } : undefined,
            warehouseUpgrade: p._warehouseUpgrade ? {
                moduleId: p._warehouseUpgrade.moduleId,
                totalMs: p._warehouseUpgrade.totalMs,
                remainMs: p._warehouseUpgrade.remainMs,
            } : null,
            economyLevel: p._economyLevel || undefined,
            economyTickMs: p._economyTickMs || 0,
            economyUpgrade: p._economyUpgrade ? {
                targetLevel: p._economyUpgrade.targetLevel,
                totalMs: p._economyUpgrade.totalMs,
                remainMs: p._economyUpgrade.remainMs,
            } : null,
            researchModules: p._economyType === 'research'
                ? { ...(p.modules || {}) } : undefined,
            researchUpgrade: p._researchUpgrade ? {
                moduleId: p._researchUpgrade.moduleId,
                totalMs: p._researchUpgrade.totalMs,
                remainMs: p._researchUpgrade.remainMs,
            } : null,
            advancedResearchModules: p._economyType === 'advanced_research'
                ? { ...(p.modules || {}) } : undefined,
            advancedResearchUpgrade: p._advancedResearchUpgrade ? {
                moduleId: p._advancedResearchUpgrade.moduleId,
                totalMs: p._advancedResearchUpgrade.totalMs,
                remainMs: p._advancedResearchUpgrade.remainMs,
            } : null,
            bankGoldRemainder: p._bankGoldRemainder || 0,
            pendingGoldDrop: p._pendingGoldDrop || 0,
            workProductionRemainder: p._workProductionRemainder || 0,
            assignedWorkers: p._assignedWorkers || 0,
            marketPressure: p._marketPressure || 0,
            windmillModules: p._economyType === 'windmill'
                ? { ...(p.modules || {}) } : undefined,
            windmillUpgrade: p._windmillUpgrade ? {
                moduleId: p._windmillUpgrade.moduleId,
                totalMs: p._windmillUpgrade.totalMs,
                remainMs: p._windmillUpgrade.remainMs,
            } : null,
            mintModules: p._economyType === 'royal_mint'
                ? { ...(p.modules || {}) } : undefined,
            mintUpgrade: p._mintUpgrade ? {
                moduleId: p._mintUpgrade.moduleId,
                totalMs: p._mintUpgrade.totalMs,
                remainMs: p._mintUpgrade.remainMs,
            } : null,
            mintGoldRemainder: p._economyType === 'royal_mint'
                ? Math.max(0, Number(p._mintGoldRemainder) || 0) : undefined,
            bankModules: p._economyType === 'bank' ? { ...(p.modules || {}) } : undefined,
            bankUpgrade: p._bankUpgrade ? {
                moduleId: p._bankUpgrade.moduleId,
                totalMs: p._bankUpgrade.totalMs,
                remainMs: p._bankUpgrade.remainMs,
            } : null,
            grandMallModules: p._economyType === 'grand_mall'
                ? { ...(p.modules || {}) } : undefined,
            grandMallUpgrade: p._grandMallUpgrade ? {
                moduleId: p._grandMallUpgrade.moduleId,
                totalMs: p._grandMallUpgrade.totalMs,
                remainMs: p._grandMallUpgrade.remainMs,
            } : null,
            grandMallGoldRemainder: p._economyType === 'grand_mall'
                ? Math.max(0, Number(p._grandMallGoldRemainder) || 0) : undefined,
            grandMallEnergyRemainder: p._economyType === 'grand_mall'
                ? Math.max(0, Number(p._grandMallEnergyRemainder) || 0) : undefined,
            stockExchangeGoldRemainder: p._economyType === 'stock_exchange'
                ? Math.max(0, Number(p._stockExchangeGoldRemainder) || 0) : undefined,
            stockExchangeEnergyRemainder: p._economyType === 'stock_exchange'
                ? Math.max(0, Number(p._stockExchangeEnergyRemainder) || 0) : undefined,
            computingCenterGoldRemainder: p._economyType === 'computing_center'
                ? Math.max(0, Number(p._computingCenterGoldRemainder) || 0) : undefined,
            computingCenterEnergyRemainder: p._economyType === 'computing_center'
                ? Math.max(0, Number(p._computingCenterEnergyRemainder) || 0) : undefined,
            computingCenterModules: p._economyType === 'computing_center'
                ? { ...(p.modules || {}) } : undefined,
            computingCenterUpgrade: p._economyType === 'computing_center'
                && p._computingCenterUpgrade ? {
                    moduleId: p._computingCenterUpgrade.moduleId,
                    totalMs: p._computingCenterUpgrade.totalMs,
                    remainMs: p._computingCenterUpgrade.remainMs,
                } : null,
            workshopModules: p._economyType === 'workshop' ? { ...(p.modules || {}) } : undefined,
            workshopUpgrade: p._workshopUpgrade ? {
                moduleId: p._workshopUpgrade.moduleId,
                totalMs: p._workshopUpgrade.totalMs,
                remainMs: p._workshopUpgrade.remainMs,
            } : null,
            armoryModules: p._economyType === 'armory' ? { ...(p.modules || {}) } : undefined,
            armoryUpgrade: p._armoryUpgrade ? {
                moduleId: p._armoryUpgrade.moduleId,
                totalMs: p._armoryUpgrade.totalMs,
                remainMs: p._armoryUpgrade.remainMs,
            } : null,
            armorySortElapsedMs: p._economyType === 'armory'
                ? Math.max(0, Number(p._armorySortElapsedMs) || 0) : undefined,
            armoryPendingStones: p._economyType === 'armory'
                ? Math.max(0, Math.floor(Number(p._armoryPendingStones) || 0)) : undefined,
            hospitalModules: p._economyType === 'field_hospital'
                ? { ...(p.modules || {}) } : undefined,
            hospitalUpgrade: p._hospitalUpgrade ? {
                moduleId: p._hospitalUpgrade.moduleId,
                totalMs: p._hospitalUpgrade.totalMs,
                remainMs: p._hospitalUpgrade.remainMs,
            } : null,
            hospitalTreatmentElapsedMs: p._economyType === 'field_hospital'
                ? Math.max(0, Number(p._hospitalTreatmentElapsedMs) || 0) : undefined,
            bakeryModules: p._economyType === 'bakery' ? { ...(p.modules || {}) } : undefined,
            bakeryUpgrade: p._economyType === 'bakery' && p._bakeryUpgrade ? {
                moduleId: p._bakeryUpgrade.moduleId,
                totalMs: p._bakeryUpgrade.totalMs,
                remainMs: p._bakeryUpgrade.remainMs,
            } : null,
            bakeryJob: p._economyType === 'bakery' ? {
                phase: p._bakeryJob?.phase,
                x: p._bakeryJob?.x,
                y: p._bakeryJob?.y,
                targetWarehouseId: p._bakeryJob?.targetWarehouseId ?? null,
                cargoFood: p._bakeryJob?.cargoFood || 0,
                pendingFood: p._bakeryJob?.pendingFood || 0,
                processRemainMs: p._bakeryJob?.processRemainMs || 0,
                processTotalMs: p._bakeryJob?.processTotalMs || 0,
                phaseRemainMs: p._bakeryJob?.phaseRemainMs || 0,
                phaseTotalMs: p._bakeryJob?.phaseTotalMs || 0,
                completedBatches: p._bakeryJob?.completedBatches || 0,
                offlineProgressMs: p._bakeryJob?.offlineProgressMs || 0,
            } : undefined,
            bakeryPendingTributeIds: p._economyType === 'bakery'
                ? [...(p._bakeryPendingTributeIds || [])] : undefined,
            bakeryOutputRemainder: p._economyType === 'bakery'
                ? Math.max(0, Number(p._bakeryOutputRemainder) || 0) : undefined,
            desertCookhouseModules: p._economyType === 'desert_cookhouse'
                ? { ...(p.modules || {}) } : undefined,
            desertCookhouseUpgrade: p._economyType === 'desert_cookhouse' && p._bakeryUpgrade ? {
                moduleId: p._bakeryUpgrade.moduleId,
                totalMs: p._bakeryUpgrade.totalMs,
                remainMs: p._bakeryUpgrade.remainMs,
            } : null,
            desertCookhouseJob: p._economyType === 'desert_cookhouse' ? {
                phase: p._bakeryJob?.phase,
                x: p._bakeryJob?.x,
                y: p._bakeryJob?.y,
                targetWarehouseId: p._bakeryJob?.targetWarehouseId ?? null,
                cargoFood: p._bakeryJob?.cargoFood || 0,
                pendingFood: p._bakeryJob?.pendingFood || 0,
                processRemainMs: p._bakeryJob?.processRemainMs || 0,
                processTotalMs: p._bakeryJob?.processTotalMs || 0,
                phaseRemainMs: p._bakeryJob?.phaseRemainMs || 0,
                phaseTotalMs: p._bakeryJob?.phaseTotalMs || 0,
                completedBatches: p._bakeryJob?.completedBatches || 0,
                offlineProgressMs: p._bakeryJob?.offlineProgressMs || 0,
            } : undefined,
            desertCookhouseOutputRemainder: p._economyType === 'desert_cookhouse'
                ? Math.max(0, Number(p._bakeryOutputRemainder) || 0) : undefined,
            frostSmokehouseModules: p._economyType === 'frost_smokehouse'
                ? { ...(p.modules || {}) } : undefined,
            frostSmokehouseUpgrade: p._economyType === 'frost_smokehouse' && p._bakeryUpgrade ? {
                moduleId: p._bakeryUpgrade.moduleId,
                totalMs: p._bakeryUpgrade.totalMs,
                remainMs: p._bakeryUpgrade.remainMs,
            } : null,
            frostSmokehouseJob: p._economyType === 'frost_smokehouse' ? {
                phase: p._bakeryJob?.phase,
                x: p._bakeryJob?.x,
                y: p._bakeryJob?.y,
                targetWarehouseId: p._bakeryJob?.targetWarehouseId ?? null,
                cargoFood: p._bakeryJob?.cargoFood || 0,
                pendingFood: p._bakeryJob?.pendingFood || 0,
                processRemainMs: p._bakeryJob?.processRemainMs || 0,
                processTotalMs: p._bakeryJob?.processTotalMs || 0,
                phaseRemainMs: p._bakeryJob?.phaseRemainMs || 0,
                phaseTotalMs: p._bakeryJob?.phaseTotalMs || 0,
                completedBatches: p._bakeryJob?.completedBatches || 0,
                offlineProgressMs: p._bakeryJob?.offlineProgressMs || 0,
            } : undefined,
            frostSmokehouseOutputRemainder: p._economyType === 'frost_smokehouse'
                ? Math.max(0, Number(p._bakeryOutputRemainder) || 0) : undefined,
            chainRestaurantModules: p._economyType === 'chain_restaurant'
                ? { ...(p.modules || {}) } : undefined,
            chainRestaurantUpgrade: p._economyType === 'chain_restaurant' && p._bakeryUpgrade ? {
                moduleId: p._bakeryUpgrade.moduleId,
                totalMs: p._bakeryUpgrade.totalMs,
                remainMs: p._bakeryUpgrade.remainMs,
            } : null,
            chainRestaurantJob: p._economyType === 'chain_restaurant' ? {
                phase: p._bakeryJob?.phase,
                x: p._bakeryJob?.x,
                y: p._bakeryJob?.y,
                targetWarehouseId: p._bakeryJob?.targetWarehouseId ?? null,
                cargoFood: p._bakeryJob?.cargoFood || 0,
                pendingFood: p._bakeryJob?.pendingFood || 0,
                processRemainMs: p._bakeryJob?.processRemainMs || 0,
                processTotalMs: p._bakeryJob?.processTotalMs || 0,
                phaseRemainMs: p._bakeryJob?.phaseRemainMs || 0,
                phaseTotalMs: p._bakeryJob?.phaseTotalMs || 0,
                completedBatches: p._bakeryJob?.completedBatches || 0,
                offlineProgressMs: p._bakeryJob?.offlineProgressMs || 0,
            } : undefined,
            chainRestaurantOutputRemainder: p._economyType === 'chain_restaurant'
                ? Math.max(0, Number(p._bakeryOutputRemainder) || 0) : undefined,
            cheeseFarmModules: p._economyType === 'cheese_farm'
                ? { ...(p.modules || {}) } : undefined,
            cheeseFarmUpgrade: p._cheeseFarmUpgrade ? {
                moduleId: p._cheeseFarmUpgrade.moduleId,
                totalMs: p._cheeseFarmUpgrade.totalMs,
                remainMs: p._cheeseFarmUpgrade.remainMs,
            } : null,
            cheeseFarmJob: p._economyType === 'cheese_farm' ? {
                phase: p._cheeseFarmJob?.phase,
                x: p._cheeseFarmJob?.x,
                y: p._cheeseFarmJob?.y,
                targetWarehouseId: p._cheeseFarmJob?.targetWarehouseId ?? null,
                pendingFood: p._cheeseFarmJob?.pendingFood || 0,
                processRemainMs: p._cheeseFarmJob?.processRemainMs || 0,
                processTotalMs: p._cheeseFarmJob?.processTotalMs || 0,
                phaseRemainMs: p._cheeseFarmJob?.phaseRemainMs || 0,
                phaseTotalMs: p._cheeseFarmJob?.phaseTotalMs || 0,
                completedBatches: p._cheeseFarmJob?.completedBatches || 0,
                offlineProgressMs: p._cheeseFarmJob?.offlineProgressMs || 0,
            } : undefined,
            cheeseFarmOutputRemainder: p._economyType === 'cheese_farm'
                ? Math.max(0, Number(p._cheeseFarmOutputRemainder) || 0) : undefined,
            steamModules: p._economyType === 'steam_power_plant'
                ? { ...(p.modules || {}) } : undefined,
            steamUpgrade: p._steamUpgrade ? {
                moduleId: p._steamUpgrade.moduleId,
                totalMs: p._steamUpgrade.totalMs,
                remainMs: p._steamUpgrade.remainMs,
            } : null,
            steamJobs: p._economyType === 'steam_power_plant'
                ? (p._steamJobs || []).map((job) => ({
                    slot: job.slot,
                    phase: job.phase,
                    x: job.x,
                    y: job.y,
                    targetWarehouseId: job.targetWarehouseId ?? null,
                    cargoFood: job.cargoFood || 0,
                    pendingEnergy: job.pendingEnergy || 0,
                    processRemainMs: job.processRemainMs || 0,
                    processTotalMs: job.processTotalMs || 0,
                    phaseRemainMs: job.phaseRemainMs || 0,
                    phaseTotalMs: job.phaseTotalMs || 0,
                    completedBatches: job.completedBatches || 0,
                    offlineProgressMs: job.offlineProgressMs || 0,
                })) : undefined,
            steamOutputRemainder: p._economyType === 'steam_power_plant'
                ? Math.max(0, Number(p._steamOutputRemainder) || 0) : undefined,
            oilPowerModules: p._economyType === 'oil_power_plant'
                ? { ...(p.modules || {}) } : undefined,
            oilPowerUpgrade: p._oilPowerUpgrade ? {
                moduleId: p._oilPowerUpgrade.moduleId,
                totalMs: p._oilPowerUpgrade.totalMs,
                remainMs: p._oilPowerUpgrade.remainMs,
            } : null,
            canneryModules: p._economyType === 'cannery'
                ? { ...(p.modules || {}) } : undefined,
            canneryUpgrade: p._canneryUpgrade ? {
                moduleId: p._canneryUpgrade.moduleId,
                totalMs: p._canneryUpgrade.totalMs,
                remainMs: p._canneryUpgrade.remainMs,
            } : null,
            tradingModules: p._economyType === 'trading_company'
                ? { ...(p.modules || {}) } : undefined,
            tradingUpgrade: p._tradingUpgrade ? {
                moduleId: p._tradingUpgrade.moduleId,
                totalMs: p._tradingUpgrade.totalMs,
                remainMs: p._tradingUpgrade.remainMs,
            } : null,
            windPowerModules: p._economyType === 'wind_power_plant'
                ? { ...(p.modules || {}) } : undefined,
            windPowerUpgrade: p._windPowerUpgrade ? {
                moduleId: p._windPowerUpgrade.moduleId,
                totalMs: p._windPowerUpgrade.totalMs,
                remainMs: p._windPowerUpgrade.remainMs,
            } : null,
            solarPowerModules: p._economyType === 'solar_power_plant'
                ? { ...(p.modules || {}) } : undefined,
            solarPowerUpgrade: p._solarPowerUpgrade ? {
                moduleId: p._solarPowerUpgrade.moduleId,
                totalMs: p._solarPowerUpgrade.totalMs,
                remainMs: p._solarPowerUpgrade.remainMs,
            } : null,
            tavernModules: p._economyType === 'tavern'
                ? { ...(p.modules || {}) } : undefined,
            tavernUpgrade: p._tavernUpgrade ? {
                moduleId: p._tavernUpgrade.moduleId,
                totalMs: p._tavernUpgrade.totalMs,
                remainMs: p._tavernUpgrade.remainMs,
            } : null,
            tavernJob: p._economyType === 'tavern' ? {
                phase: p._tavernJob?.phase,
                x: p._tavernJob?.x,
                y: p._tavernJob?.y,
                targetWarehouseId: p._tavernJob?.targetWarehouseId ?? null,
                cargoFood: p._tavernJob?.cargoFood || 0,
                serviceRemainMs: p._tavernJob?.serviceRemainMs || 0,
                serviceTotalMs: p._tavernJob?.serviceTotalMs || 0,
                phaseRemainMs: p._tavernJob?.phaseRemainMs || 0,
                phaseTotalMs: p._tavernJob?.phaseTotalMs || 0,
                completedBatches: p._tavernJob?.completedBatches || 0,
            } : undefined,
            resonatorModules: p._economyType === 'planar_resonator'
                ? { ...(p.modules || {}) } : undefined,
            resonatorUpgrade: p._resonatorUpgrade ? {
                moduleId: p._resonatorUpgrade.moduleId,
                totalMs: p._resonatorUpgrade.totalMs,
                remainMs: p._resonatorUpgrade.remainMs,
            } : null,
            deepDrillTickMs: p._economyType === 'deep_drill'
                ? Math.max(0, Number(p._deepDrillTickMs) || 0) : undefined,
            deepDrillRemainder: p._economyType === 'deep_drill'
                ? Math.max(0, Number(p._deepDrillRemainder) || 0) : undefined,
            deepDrillMinedTotal: p._economyType === 'deep_drill'
                ? Math.max(0, Number(p._deepDrillMinedTotal) || 0) : undefined,
            weatherModules: p.cfgKey === 'weather_forecast_tower'
                ? { ...(p.modules || {}) } : undefined,
            weatherUpgrade: p._weatherUpgrade ? {
                moduleId: p._weatherUpgrade.moduleId,
                totalMs: p._weatherUpgrade.totalMs,
                remainMs: p._weatherUpgrade.remainMs,
            } : null,
            candleModules: p._isWorld125Candle ? { ...(p.candleModules || {}) } : undefined,
            candleUpgrade: p._candleUpgrade ? {
                moduleId: p._candleUpgrade.moduleId,
                totalMs: p._candleUpgrade.totalMs,
                remainMs: p._candleUpgrade.remainMs,
            } : null,
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

    // ---- 能源矿点（位置由位面世代种子生成；余量/枯竭转场计时必须入快照）----
    const nodes = (EnergyNodeSystem.nodes || []).filter(alive).map((n) => ({
        x: n.x, y: n.y, hp: Math.ceil(n.hp), maxHp: n.maxHp,
        depleted: !!n._depleted, collapseTimer: n._collapseTimer || 0,
        variant: n._variant || 1,
        cellI: Number.isInteger(n._gridCellI) ? n._gridCellI : undefined,
        cellJ: Number.isInteger(n._gridCellJ) ? n._gridCellJ : undefined,
    }));

    const worldEpoch = Math.max(0, Math.floor(Number(getWorldEpoch?.(sceneId)) || 0));
    return {
        version: SNAPSHOT_VERSION,
        sceneId,
        worldEpoch,
        initializedByPortal: false,
        resourceLayoutVersion: EnergyNodeSystem.layoutVersion || 1,
        fogOfWar: FogOfWarSystem.serializeScene(sceneId),
        ..._snapshotLifecycle(sceneId, worldEpoch),
        capturedAt: Date.now(),
        capturedGameTimeMs: EnvironmentLightingSystem.serializeTime().elapsedMs || 0,
        starterWarehouseGrantClaimed: !!Game?._starterWarehouseGrantClaimedByScene?.[sceneId],
        featureBuildingMigrations: _clone(_storedByWorld[sceneId]?.featureBuildingMigrations || {}),
        populationEconomy: PopulationEconomySystem?.serializeState?.() || { storageVersion: 2, foodStored: 0 },
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
    if (!sceneId) return false;
    const hadSnapshot = !!_storedByWorld[sceneId];
    delete _storedByWorld[sceneId];
    if (Game?._starterWarehouseGrantClaimedByScene) {
        delete Game._starterWarehouseGrantClaimedByScene[sceneId];
    }
    FogOfWarSystem.resetScene(sceneId);
    return hadSnapshot;
}

/** 清空快照（新游戏重置） */
export function resetWorld122Snapshot() {
    for (const key of Object.keys(_storedByWorld)) delete _storedByWorld[key];
    if (Game) Game._starterWarehouseGrantClaimedByScene = {};
    FogOfWarSystem.resetAll();
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
    FogOfWarSystem.resetScene('scene8');
    if (Game?._starterWarehouseGrantClaimedByScene) {
        delete Game._starterWarehouseGrantClaimedByScene.scene8;
    }
    if (canPersistWorld && !canPersistWorld('scene8')) {
        delete _storedByWorld.scene8;
        return;
    }
    const legacyLevels = takeLegacyLocalResearchLevels();
    if (data && data.version === SNAPSHOT_VERSION) {
        _storedByWorld.scene8 = _migrateResearchBuildingUpgrades(_clone(data), legacyLevels);
    }
    else delete _storedByWorld.scene8;
}

export function restoreWorldScenes(data) {
    const legacyLevels = takeLegacyLocalResearchLevels();
    for (const key of Object.keys(_storedByWorld)) delete _storedByWorld[key];
    if (Game) Game._starterWarehouseGrantClaimedByScene = {};
    FogOfWarSystem.resetAll();
    if (!data || typeof data !== 'object') return;
    // 兼容旧档直接保存单个 scene8 快照。
    if (data.version === SNAPSHOT_VERSION && Array.isArray(data.structures)) {
        _storedByWorld.scene8 = _migrateResearchBuildingUpgrades(_clone(data), legacyLevels);
        return;
    }
    for (const [sceneId, snap] of Object.entries(data)) {
        if (snap && snap.version === SNAPSHOT_VERSION
            && (!canPersistWorld || canPersistWorld(sceneId))) {
            _storedByWorld[sceneId] = _migrateResearchBuildingUpgrades(_clone(snap), legacyLevels);
        }
    }
}

/** 玩家是否在世界-122 内（前台全真时后台驱动停 tick） */
export function isWorld122Live() {
    return !!(DefenseSystem && DefenseSystem.active && DefenseSystem._worldId === 'scene8');
}

export function isWorldLive(sceneId) {
    return !!(DefenseSystem && DefenseSystem.active && DefenseSystem._worldId === sceneId);
}

/** 其他后台位面是否正在推进同一个全局能力/兵种模块项目。 */
export function hasBackgroundBuildingUpgrade(upgrade) {
    const keys = new Set(getBuildingUpgradeProgressKeys(upgrade));
    if (!keys.size) return false;
    for (const [sceneId, snapshot] of Object.entries(_storedByWorld)) {
        if (isWorldLive(sceneId) || !isWorldSnapshotCurrent(sceneId, snapshot)) continue;
        if ((snapshot.structures || []).some((structure) => Number(structure?.hp ?? 1) > 0
            && getBuildingUpgradeProgressKeys(structure?.upgrade).some((key) => keys.has(key)))) return true;
    }
    return false;
}


/** 其他后台位面是否已有同类别建筑持有持续升级目标。 */
export function hasBackgroundContinuousUpgrade(category, excludeSceneId = null) {
    if (!category) return false;
    for (const [sceneId, snapshot] of Object.entries(_storedByWorld)) {
        if (sceneId === excludeSceneId || isWorldLive(sceneId) || !isWorldSnapshotCurrent(sceneId, snapshot)) continue;
        if ((snapshot.structures || []).some((structure) => Number(structure?.hp ?? 1) > 0
            && structure?.continuous && getBuildingContinuousCategory(structure) === category)) return true;
    }
    return false;
}

/** 世界切换面板预览：不回写快照、无全局副作用（commit=false）；
 *  玩家在 122 内或无快照时返回 null。 */
export function previewWorld122Report(worldId = 'scene8') {
    const stored = _storedByWorld[worldId];
    if (!stored || !isWorldSnapshotCurrent(worldId, stored)) return null;
    if (isWorldLive(worldId)) return null;
    const nowGame = EnvironmentLightingSystem.serializeTime().elapsedMs || 0;
    const capturedGameTimeMs = Number(stored.capturedGameTimeMs);
    const elapsed = Math.max(0, nowGame - (
        Number.isFinite(capturedGameTimeMs) ? capturedGameTimeMs : nowGame
    ));
    if (elapsed < 1000) return null;
    return settleWorld122(stored, elapsed, {
        commit: false,
        skipWaves: true,
        sceneId: worldId,
        runtimeSceneId: WorldInstanceSystem.resolveRuntimeSceneId(worldId),
        isRecruitmentTierUnlocked: (id) =>
            TechnologySystem?.isUnlocked?.('recruitmentTier', id) === true,
        isUnitUnlocked: (id) => TechnologySystem?.isUnlocked?.('unit', id) === true,
        getPlayerTotalGold: () => PopulationEconomySystem?.getPlayerTotalGold?.() || 0,
    });
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

function _restoreWallBattlement(s) {
    const wallCell = s.wallCell;
    if (!wallCell || !s.edge || !Number.isInteger(s.slot)) return false;
    let wall = null;
    for (const entity of Game.entities.values()) {
        if (!entity?.active || !entity._isBlockCover || entity._buildGroupRoot) continue;
        const [i, j] = blockCellOf(entity.x, entity.y);
        if (i === wallCell.i && j === wallCell.j) {
            wall = entity;
            break;
        }
    }
    if (!wall) return false;
    const attachment = createWallBattlementAttachment(wall, wallCell, s.edge, s.slot);
    if (!attachment) return false;
    const cover = new DefenseCover(attachment.x, attachment.y, {
        grade: 'C', orient: 'v', mirror: false,
        battlement: true,
        battlementVariant: s.variant || attachment.variant,
        attachment,
        walkable: false,
        id: s.id || `built_wall_battlement_r${++_seq}`,
    });
    _markRestored(cover, s);
    Game.entities.set(cover.id, cover);
    return true;
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
    gate.setMode?.(['auto', 'locked', 'open'].includes(s.gateMode) ? s.gateMode : 'auto');
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
    const assignedWorkers = s.assignedWorkers == null
        ? Math.max(0, Math.floor(Number(s.miners) || 0))
        : Math.max(0, Math.floor(Number(s.assignedWorkers) || 0));
    const hut = new HamsterHut(s.x, s.y, {
        id: s.id || `built_hut_r${++_seq}`,
        skipInitialSpawn: true,
        modules: s.modules,
        upgrade: s.upgrade,
        storedEnergy: s.storedEnergy,
        pendingMinerEnergy: s.carriedEnergy,
        minerTavernRemainder: s.minerTavernRemainder,
        assignedWorkers,
    });
    _markRestored(hut, s);
    if (s.rally) hut._rallyPoint = { x: s.rally.x, y: s.rally.y };
    Game.entities.set(hut.id, hut);
    HamsterHutSystem.huts.push(hut);
    BuildingRoadSystem.attach(hut, { allowOverlap: true });
    const savedMinerCount = s.miners == null
        ? assignedWorkers
        : Math.max(0, Math.floor(Number(s.miners) || 0));
    const want = Math.max(0, Math.min(savedMinerCount, hut.minerCount()));
    let spawned = 0;
    for (let i = 0; i < want; i++) if (hut.spawnMiner()) spawned++;
    // 出口槽位预约窗口 750ms，爆发生成会互撞——缺额走 _restoreTopUp 加速补齐（立即启动 800ms 节拍）
    if (spawned < want) { hut._restoreTopUp = want - spawned; hut._respawnTimer = 800; }
    // 仍有缺员时按原剩余时间续跑补员计时
    if (hut.aliveMinerCount() < hut.minerCount()) hut._respawnTimer = Math.max(0, s.respawnTimer || 0);
}

function _restoreLegacyBarracks(s, sceneId) {
    // v1 旧档兼容：不再创建 HamsterBarracks，直接迁入通用 ProducerBuilding。
    _restoreProducer({
        ...s,
        kind: 'producer',
        cfgKey: 'hamster_barracks',
        troopProducer: true,
    }, sceneId);
}

function _restoreProducer(s, sceneId) {
    const cfg = getProducerConfig(s.cfgKey);
    if (!cfg) return; // 配置已移除的建筑跳过（版本兼容）
    const producer = new ProducerBuilding(s.x, s.y, {
        id: s.id || `built_${s.cfgKey}_r${++_seq}`,
        cfgKey: s.cfgKey,
        mirror: s.mirror,
        economyLevel: s.economyLevel,
        economyTickMs: s.economyTickMs,
        economyUpgrade: s.economyUpgrade,
        researchModules: s.researchModules,
        researchUpgrade: s.researchUpgrade,
        advancedResearchModules: s.advancedResearchModules,
        advancedResearchUpgrade: s.advancedResearchUpgrade,
        bankGoldRemainder: s.bankGoldRemainder,
        workProductionRemainder: s.workProductionRemainder,
        assignedWorkers: s.assignedWorkers,
        marketPressure: s.marketPressure,
        pendingGoldDrop: s.pendingGoldDrop,
        windmillModules: s.windmillModules,
        windmillUpgrade: s.windmillUpgrade,
        mintModules: s.mintModules,
        mintUpgrade: s.mintUpgrade,
        mintGoldRemainder: s.mintGoldRemainder,
        bankModules: s.bankModules,
        bankUpgrade: s.bankUpgrade,
        grandMallModules: s.grandMallModules,
        grandMallUpgrade: s.grandMallUpgrade,
        grandMallGoldRemainder: s.grandMallGoldRemainder,
        grandMallEnergyRemainder: s.grandMallEnergyRemainder,
        stockExchangeGoldRemainder: s.stockExchangeGoldRemainder,
        stockExchangeEnergyRemainder: s.stockExchangeEnergyRemainder,
        computingCenterGoldRemainder: s.computingCenterGoldRemainder,
        computingCenterEnergyRemainder: s.computingCenterEnergyRemainder,
        computingCenterModules: s.computingCenterModules,
        computingCenterUpgrade: s.computingCenterUpgrade,
        workshopModules: s.workshopModules,
        workshopUpgrade: s.workshopUpgrade,
        armoryModules: s.armoryModules,
        armoryUpgrade: s.armoryUpgrade,
        armorySortElapsedMs: s.armorySortElapsedMs,
        armoryPendingStones: s.armoryPendingStones,
        hospitalModules: s.hospitalModules,
        hospitalUpgrade: s.hospitalUpgrade,
        hospitalTreatmentElapsedMs: s.hospitalTreatmentElapsedMs,
        bakeryModules: s.bakeryModules,
        bakeryUpgrade: s.bakeryUpgrade,
        bakeryJob: s.bakeryJob,
        bakeryPendingTributeIds: s.bakeryPendingTributeIds,
        bakeryOutputRemainder: s.bakeryOutputRemainder,
        desertCookhouseModules: s.desertCookhouseModules,
        desertCookhouseUpgrade: s.desertCookhouseUpgrade,
        desertCookhouseJob: s.desertCookhouseJob,
        desertCookhouseOutputRemainder: s.desertCookhouseOutputRemainder,
        frostSmokehouseModules: s.frostSmokehouseModules,
        frostSmokehouseUpgrade: s.frostSmokehouseUpgrade,
        frostSmokehouseJob: s.frostSmokehouseJob,
        frostSmokehouseOutputRemainder: s.frostSmokehouseOutputRemainder,
        chainRestaurantModules: s.chainRestaurantModules,
        chainRestaurantUpgrade: s.chainRestaurantUpgrade,
        chainRestaurantJob: s.chainRestaurantJob,
        chainRestaurantOutputRemainder: s.chainRestaurantOutputRemainder,
        cheeseFarmModules: s.cheeseFarmModules,
        cheeseFarmUpgrade: s.cheeseFarmUpgrade,
        cheeseFarmJob: s.cheeseFarmJob,
        cheeseFarmOutputRemainder: s.cheeseFarmOutputRemainder,
        steamModules: s.steamModules,
        steamUpgrade: s.steamUpgrade,
        steamJobs: s.steamJobs,
        steamOutputRemainder: s.steamOutputRemainder,
        oilPowerModules: s.oilPowerModules,
        oilPowerUpgrade: s.oilPowerUpgrade,
        canneryModules: s.canneryModules,
        canneryUpgrade: s.canneryUpgrade,
        tradingModules: s.tradingModules,
        tradingUpgrade: s.tradingUpgrade,
        windPowerModules: s.windPowerModules,
        windPowerUpgrade: s.windPowerUpgrade,
        tavernModules: s.tavernModules,
        tavernUpgrade: s.tavernUpgrade,
        tavernJob: s.tavernJob,
        resonatorModules: s.resonatorModules,
        resonatorUpgrade: s.resonatorUpgrade,
        deepDrillTickMs: s.deepDrillTickMs,
        deepDrillRemainder: s.deepDrillRemainder,
        deepDrillMinedTotal: s.deepDrillMinedTotal,
        weatherModules: s.weatherModules,
        weatherUpgrade: s.weatherUpgrade,
        warehouseModules: s.warehouseModules,
        warehouseUpgrade: s.warehouseUpgrade,
        candleModules: s.candleModules,
        candleUpgrade: s.candleUpgrade,
    });
    _markRestored(producer, s);
    if ((cfg.unitTypes || []).some((t) => t.key === s.unitType)) producer.unitType = s.unitType;
    producer._spawnTimer = Math.max(0, s.spawnTimer || 0);
    producer._recruitMode = normalizeRecruitMode(s.recruitMode);
    producer._spawnPopulationBlocked = !!s.populationBlocked;
    producer._spawnFoodBlocked = !!s.foodBlocked;
    // 科技在离场期间完成时，按当前槽位换代，并以新兵种完整周期重新计时。
    producer.refreshRecruitmentTier?.();
    if (producer._parallelProduction) {
        for (const [kind, queue] of Object.entries(producer._parallelQueues || {})) {
            const savedQueue = s.parallelQueues?.[kind];
            if (!savedQueue) continue;
            queue.recruitMode = normalizeRecruitMode(savedQueue.recruitMode);
            queue.timer = Math.max(0, Number(savedQueue.timer) || 0);
            queue.blocked = !!savedQueue.blocked;
            queue.foodBlocked = !!savedQueue.foodBlocked;
            queue.populationBlocked = !!savedQueue.populationBlocked;
        }
    }
    producer._restoredTitheTimer = Math.max(0, Number(s.titheTimerMs) || 0);
    if (s.rally) producer._rallyPoint = { x: s.rally.x, y: s.rally.y };
    // 能力/研究与兵种模块读条续跑（等级全局共享，读条属建筑实例）
    if (s.upgrade && cfg.abilities && cfg.abilities[s.upgrade.abilityId]) {
        producer._upgrade = {
            kind: 'ability',
            abilityId: s.upgrade.abilityId,
            totalMs: Math.max(1, s.upgrade.totalMs || 1),
            remainMs: Math.max(0, s.upgrade.remainMs || 0),
        };
    } else if (s.upgrade?.moduleId && cfg.modules?.[s.upgrade.moduleId]) {
        const currentKinds = producer.moduleUnitTypes(s.upgrade.moduleId, s.upgrade.unitType);
        const savedKinds = Array.isArray(s.upgrade.unitTypes)
            ? s.upgrade.unitTypes.filter((kind) => currentKinds.includes(kind))
            : [];
        const targetKinds = producer._sharedUnitUpgrades ? currentKinds : savedKinds;
        producer._upgrade = {
            kind: 'module',
            moduleId: s.upgrade.moduleId,
            unitType: targetKinds[0] || currentKinds[0] || producer.unitType,
            unitTypes: targetKinds.length ? targetKinds : undefined,
            totalMs: Math.max(1, Number(s.upgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(s.upgrade.remainMs) || 0),
        };
    }
    // 持续目标独立于当前读条恢复：后台完成一档后读条为空，回场仍需继续轮询资源。
    const continuous = normalizeBuildingContinuousTarget(s.continuous);
    const categoryBusy = (ProducerBuildingSystem.buildings || []).some((other) =>
        other?.cfgKey === producer.cfgKey && !!other._continuous)
        || hasBackgroundContinuousUpgrade(getBuildingContinuousCategory(producer), sceneId);
    if (!categoryBusy && continuous?.kind === 'ability' && cfg.abilities?.[continuous.abilityId]) {
        producer._continuous = continuous;
    } else if (!categoryBusy && continuous?.kind === 'module' && cfg.modules?.[continuous.moduleId]) {
        const kinds = producer.moduleUnitTypes(continuous.moduleId, continuous.unitType);
        if (kinds.length) {
            producer._continuous = {
                kind: 'module', moduleId: continuous.moduleId,
                unitType: kinds[0], unitTypes: kinds,
            };
        }
    }
    Game.entities.set(producer.id, producer);
    ProducerBuildingSystem.buildings.push(producer);
    if (producer._isWallTower) DefenseSystem?.invalidateElevatedTopology?.();
    BuildingRoadSystem.attach(producer, { allowOverlap: true });
    // 构造注册会先消费主存档 pending 能源；随后按快照覆盖本仓精确分量，避免同一库存重复恢复。
    if (producer._isEnergyWarehouse && EnergyManager) {
        const capacity = Math.max(0, Number(producer.storageCapacity) || 0);
        const energyFactor = EnergyManager.getWarehouseEnergyFactor(producer);
        const foodFactor = EnergyManager.getWarehouseFoodFactor(producer);
        producer.storedEnergy = Math.max(0, Math.min(
            Math.floor(capacity / energyFactor),
            Math.floor(Number(s.storedEnergy) || 0)
        ));
        producer.storedFood = Math.max(0, Math.min(
            Math.floor(Math.max(0, capacity - producer.storedEnergy * energyFactor) / foodFactor),
            Math.floor(Number(s.storedFood) || 0)
        ));
    }
    if (producer._pendingGoldDrop > 0 && Game?.dropItem) {
        const amount = producer._pendingGoldDrop;
        producer._pendingGoldDrop = 0;
        Game.dropItem(producer.x, producer.y, {
            name: '金币', type: '货币', icon: '💰', category: 'gold', rarity: 'mythic',
            stats: [{ name: '数量', value: String(amount) }],
            desc: '金光闪闪的硬币', stack: amount, price: 1,
        });
    }
    if (Array.isArray(s.pendingExplorerDrops) && Game?.dropItem) {
        for (const item of s.pendingExplorerDrops) {
            if (item?.stack > 0) Game.dropItem(producer.x, producer.y, _clone(item));
        }
        s.pendingExplorerDrops = [];
    }
    if (producer.spawnEnabled) {
        producer._restoreExplorerRuns = Array.isArray(s.explorerState?.runs)
            ? s.explorerState.runs.map((run) => ({
                remainingMs: Math.max(0, Number(run?.remainingMs) || 0),
                durationMs: Math.max(1000, Number(run?.durationMs) || 720000),
                playerLevel: Math.max(1, Math.floor(Number(run?.playerLevel) || 1)),
            })).filter((run) => run.remainingMs > 0)
            : Array.from({ length: Math.max(0, Math.floor(Number(s.explorerState?.activeCount) || 0)) }, () => ({
                remainingMs: 720000,
                durationMs: 720000,
                playerLevel: 1,
            }));
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
            const kindCap = producer._parallelProduction ? producer.parallelUnitCap(kind) : cap - spawned;
            const count = Math.max(0, Math.min(Math.floor(Number(rawCount) || 0), kindCap));
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
            if (producer._parallelProduction) {
                for (const kind of restoreQueue) {
                    if (producer._parallelQueues[kind]) producer._parallelQueues[kind].timer = 800;
                }
            }
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
    if (Game) {
        if (!Game._starterWarehouseGrantClaimedByScene) {
            Game._starterWarehouseGrantClaimedByScene = {};
        }
        const legacyWarehouseExists = (snap.structures || []).some((structure) => (
            structure?.kind === 'producer'
            && producerBuildingsConfig[structure.cfgKey]?.workshopType === 'warehouse'
        ));
        Game._starterWarehouseGrantClaimedByScene[sceneId] =
            typeof snap.starterWarehouseGrantClaimed === 'boolean'
                ? snap.starterWarehouseGrantClaimed
                : legacyWarehouseExists;
    }

    // ---- M1 后台结算（离场 >1s 才结算，避免同场秒切空跑）----
    const nowGame = EnvironmentLightingSystem.serializeTime().elapsedMs || 0;
    const capturedGameTimeMs = Number(snap.capturedGameTimeMs);
    const elapsed = Math.max(0, nowGame - (
        Number.isFinite(capturedGameTimeMs) ? capturedGameTimeMs : nowGame
    ));
    let report = null;
    if (elapsed > 1000) {
        report = settleWorld122(snap, elapsed, {
            commit: true,
            skipWaves: DefenseSystem._managedExternally === true,
            sceneId,
            runtimeSceneId: WorldInstanceSystem.resolveRuntimeSceneId(sceneId),
            gameTimeMs: nowGame,
            isRecruitmentTierUnlocked: (id) =>
                TechnologySystem?.isUnlocked?.('recruitmentTier', id) === true,
            isUnitUnlocked: (id) => TechnologySystem?.isUnlocked?.('unit', id) === true,
            getPlayerTotalGold: () => PopulationEconomySystem?.getPlayerTotalGold?.() || 0,
            spendPlayerGold: (amount) =>
                PopulationEconomySystem?.deductPlayerGold?.(amount) === true,
            grant: (reward) => {
                // 银行金币依次进入背包、主人空间仓库；溢出量由结算记在对应银行，回场后落地。
                if (reward.gold && PopulationEconomySystem?.routeProducedGold) {
                    return PopulationEconomySystem.routeProducedGold(reward.gold);
                }
                return { remaining: Math.max(0, Number(reward.gold) || 0) };
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
        if (s.kind === 'wall_battlement') continue; // 依赖支撑墙，统一在首轮结构恢复后处理。
        try {
            if (s.kind === 'tower') _restoreTower(s);
            else if (s.kind === 'block') _restoreBlock(s);
            else if (s.kind === 'gate4') _restoreGate4(s);
            // 旧射击台/旧单块楼梯不再迁移，防止在城墙上自动恢复出孤立贴图。
            else if (s.kind === 'wall_staircase' && (s.stairVersion || 0) >= 2) _restoreWallStaircase(s);
            else if (s.kind === 'hut') _restoreHut(s);
            else if (s.kind === 'barracks') _restoreLegacyBarracks(s, sceneId);
            else if (s.kind === 'producer') _restoreProducer(s, sceneId);
            else continue;
            restored++;
        } catch (err) {
            console.error('[WorldSnapshot] 建筑恢复失败:', sceneId, s.kind, err);
        }
    }
    for (const s of snap.structures || []) {
        if (s.kind !== 'wall_battlement' || !(s.hp > 0)) continue;
        try {
            if (_restoreWallBattlement(s)) restored++;
        } catch (err) {
            console.error('[WorldSnapshot] 女墙恢复失败:', sceneId, err);
        }
    }
    // v1 全局粮食必须等仓库实体恢复并注册后再迁移；v2 粮食已逐仓库存档。
    PopulationEconomySystem?.restoreState?.(snap.populationEconomy || {});

    // 手动道路是无碰撞派生地块；建筑先恢复，随后道路与自动道路环共享对应格贴图。
    BuildingRoadSystem.restoreManualRoads(snap.roads);

    // 仅传送门基础快照的 nodes:[] 表示“资源尚未首次物化”，不能误判为“已经采空”。
    // 完整快照的空数组才会覆盖 setup 结果，保证全矿采完后重新进图不刷新。
    if (!snap.initializedByPortal
        && Array.isArray(snap.nodes)
        && typeof EnergyNodeSystem.restoreNodes === 'function') {
        EnergyNodeSystem.restoreNodes(snap.nodes, {
            migrateLayout: Math.max(1, Number(snap.resourceLayoutVersion) || 1)
                < (EnergyNodeSystem.layoutVersion || 1),
        });
        // 不等待 GameScene 的周期巡检：立即剔除旧存档/HMR 遗留的门口、
        // 建筑重叠及重复矿点，避免它们在门打开的透明帧中短暂露出。
        if (typeof EnergyNodeSystem.sweepStacked === 'function') {
            EnergyNodeSystem.sweepStacked();
        }
    }
    // 兼容旧档：历史版本允许手铺/建筑外围道路与零碰撞矿脉同格。
    // 必须等存档矿点覆盖初始布局并完成合法性清理后，才按最终存活矿脉删除冲突道路。
    BuildingRoadSystem.removeRoadCells?.((EnergyNodeSystem?.nodes || [])
        .filter((node) => node?.active !== false && !node._depleted && Number(node.hp) > 0)
        .map((node) => {
            const [i, j] = blockCellOf(node.x, node.y);
            return { i, j };
        }));

    // 研究 HP 对新建结构兜底刷新（构造时已各自 applyResearchHp，这里防漏）
    if (ResearchSystem && typeof ResearchSystem.refreshWorld === 'function') {
        ResearchSystem.refreshWorld();
    }
    return { restored: restored > 0, report };
}

export function applyWorld122Snapshot(snap = _storedByWorld.scene8) {
    return applyWorldSnapshot('scene8', snap);
}
