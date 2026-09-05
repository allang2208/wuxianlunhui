// 世界位面进度：地牢完成记录、传送门建造资格、传送网络与重建成本的唯一真源。
import worldSystemConfig from '../../data/world-system.json';
import strategyConfig from '../../data/world-strategy.json';
import dungeonConfigData from '../../data/dungeon-config.json';
import {
    WORLD_MAP_LAYOUT_VERSION, WORLD_MAP_PLANES, getWorldMapCell,
    pickWorldMapEntryCell, worldMapPlaneCells, strategicCell, strategicDistance,
} from './world-map-cells.js';
import { WorldInstanceSystem } from './world-instance-system.js';
import { payBuildingUpgradeCost, refundBuildingUpgradePayment } from './building-upgrade-payment.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import {
    canCreateWorldPlayerBaseSnapshot, ensureSettlerRestoredWorldSnapshot,
    ensureWorldBaseSnapshot, ensureWorldPlayerBaseSnapshot, getWorldSnapshot,
    prepareWorldPlayerBaseRebuild, resetWorldSnapshot,
} from './world122-snapshot.js';
import { EventBus } from '../core/event-bus.js';
import {
    createSeededRandom, createWorldGenerationContext, deriveWorldSeed,
    getWorldResetPolicy, shouldClearWorldScope, shouldPreserveWorldScope,
} from './world-reset-policy.js';

export const WORLD_LIFECYCLE_STATUS = Object.freeze({
    LOCKED: 'LOCKED',
    AVAILABLE: 'AVAILABLE',
    ACTIVE: 'ACTIVE',
    DESTROYED: 'DESTROYED',
    REBUILDING: 'REBUILDING',
});

const VALID_STATUS = new Set(Object.values(WORLD_LIFECYCLE_STATUS));
const VERSION = 10;
const clone = (value) => JSON.parse(JSON.stringify(value));
const RUN_OUTCOMES = new Set(['success', 'failed', 'abandoned', 'safe_evac']);
const FOUNDING_STATUSES = new Set(['locked', 'awaiting_king', 'selecting', 'founded']);
export const DUNGEON_GRADE_ORDER = Object.freeze(['F', 'E', 'D', 'C', 'B', 'A']);
const FIRST_DUNGEON_ID = 'abandonedMineBeginner';
let strategicSiteCells = new Set(); // Restored from strategy sites; never another saved authority.
let strategicSettlerSites = []; // References only; current destruction state stays with strategy sites.

function mapEntryEpoch(portal) {
    return portal.everConstructed ? portal.worldEpoch : Math.max(1, portal.worldEpoch + 1);
}

function createMapDiscovery(sceneId, portal, excludedCells = strategicSiteCells) {
    const worldEpoch = mapEntryEpoch(portal);
    const generation = createWorldGenerationContext(sceneId, worldEpoch);
    // Old live/destroyed entries keep their saved generation seed and exact old draw.
    const seed = portal.everConstructed && portal.generationVersion > 0
        ? portal.generationSeed : generation.seed;
    const cell = pickWorldMapEntryCell(sceneId,
        createSeededRandom(seed, `world-map-entry:v1:${worldEpoch}`), excludedCells);
    return cell ? { cellId: cell.id, worldEpoch, layoutVersion: WORLD_MAP_LAYOUT_VERSION } : null;
}

function createMapReservation(sceneId, portal) {
    const entry = createMapDiscovery(sceneId, portal);
    const centers = strategicSettlerSites.filter((site) => site.status !== 'destroyed')
        .map((site) => strategicCell(site.cellId)).filter(Boolean);
    const fits = (cell) => centers.every((center) =>
        strategicDistance(cell, center) >= strategyConfig.settlers.minCityDistance);
    // Keep the old seed's choice whenever legal. Only missing, undiscovered entries
    // may pick an alternative; never move an existing city to repair an old save.
    if (!entry || fits(strategicCell(entry.cellId))) return entry;
    const excluded = new Set(strategicSiteCells);
    for (const cell of worldMapPlaneCells(sceneId)) if (!fits(cell)) excluded.add(cell.id);
    return createMapDiscovery(sceneId, portal, excluded);
}

function initialWorldMap(portals) {
    const discoveries = {}, reservations = {};
    for (const [sceneId, portal] of Object.entries(portals)) {
        if (portal.everConstructed) discoveries[sceneId] = createMapDiscovery(sceneId, portal);
        else reservations[sceneId] = createMapReservation(sceneId, portal);
    }
    return { discoveries, reservations, securedSignals: {}, trackedWorldId: null, nextRunId: 1, lastExpedition: null };
}

function resolveWorldConfig(worldId) {
    const instance = WorldInstanceSystem.getInstance(worldId);
    const runtimeSceneId = instance?.runtimeSceneId || worldId;
    const base = worldSystemConfig.worlds?.[runtimeSceneId] || null;
    const template = WorldInstanceSystem.getTemplateForWorld(worldId);
    if (!base && !template) return null;
    return {
        ...(template || {}),
        ...(base || {}),
        templateId: instance?.templateId || base?.templateId || template?.id || null,
        runtimeSceneId,
        instanceId: instance?.instanceId || null,
        instanceKind: instance?.kind || null,
        persistentInstance: instance?.persistent === true,
        templatePreviewOnly: instance ? false : base?.templatePreviewOnly === true,
        name: instance ? WorldInstanceSystem.getDisplayName(worldId) : (base?.name || template?.name),
        initialPortal: instance ? true : base?.initialPortal,
        constructionEnabled: instance ? template?.constructionEnabled !== false : base?.constructionEnabled,
        requirements: instance ? (template?.requirements || {}) : base?.requirements,
    };
}

function requirementsMetFor(worldId, completedDungeons) {
    const cfg = resolveWorldConfig(worldId);
    if (!cfg) return false;
    const required = cfg.requirements?.completedDungeons || [];
    return required.every((dungeonType) => (completedDungeons[dungeonType] || 0) > 0);
}

function setPortalStatus(portal, status) {
    portal.status = VALID_STATUS.has(status) ? status : WORLD_LIFECYCLE_STATUS.LOCKED;
    portal.constructed = portal.status === WORLD_LIFECYCLE_STATUS.ACTIVE;
    portal.destroyed = portal.status === WORLD_LIFECYCLE_STATUS.DESTROYED;
    if (portal.status === WORLD_LIFECYCLE_STATUS.ACTIVE
        || portal.status === WORLD_LIFECYCLE_STATUS.DESTROYED
        || portal.status === WORLD_LIFECYCLE_STATUS.REBUILDING) {
        portal.everConstructed = true;
        portal.worldEpoch = Math.max(1, Math.floor(Number(portal.worldEpoch) || 0));
    }
    if (portal.status === WORLD_LIFECYCLE_STATUS.DESTROYED) portal.hp = 0;
    return portal;
}

function setPortalGeneration(portal, generation) {
    portal.generationVersion = generation.generationVersion;
    portal.generationSeed = generation.seed >>> 0;
    portal.generationSeedStrategy = generation.seedStrategy;
    portal.resourceRule = generation.resourceRule;
    portal.baseTemplate = generation.baseTemplate;
    portal.resetPolicyVersion = generation.policyVersion;
    return portal;
}

function currentGameTimeMs() {
    return Math.max(0, Number(EnvironmentLightingSystem.serializeTime()?.elapsedMs) || 0);
}

function protectionDurationMs(sceneId) {
    const days = Math.max(0, Number(getWorldResetPolicy(sceneId).rebuildProtectionDays) || 0);
    const dayMs = Math.max(1, Number(EnvironmentLightingSystem.getConfig()?.dayDurationMs) || 12 * 60 * 1000);
    return days * dayMs;
}

function setPortalProtection(portal, sceneId) {
    const durationMs = protectionDurationMs(sceneId);
    portal.protectedUntilGameTimeMs = durationMs > 0 ? currentGameTimeMs() + durationMs : 0;
    return portal;
}

function initialPortalState(sceneId, cfg, completedDungeons) {
    const previewOnly = cfg.templatePreviewOnly === true;
    const initial = !previewOnly && cfg.initialPortal === true;
    const available = !previewOnly && cfg.constructionEnabled !== false
        && requirementsMetFor(sceneId, completedDungeons);
    const portal = setPortalStatus({
        status: initial
            ? WORLD_LIFECYCLE_STATUS.ACTIVE
            : (available ? WORLD_LIFECYCLE_STATUS.AVAILABLE : WORLD_LIFECYCLE_STATUS.LOCKED),
        worldEpoch: initial ? 1 : 0,
        everConstructed: initial,
        endpointExists: initial,
        constructed: initial,
        destroyed: false,
        hp: initial ? (worldSystemConfig.portal?.maxHp ?? 5000) : 0,
        generationVersion: 0,
        generationSeed: 0,
        generationSeedStrategy: null,
        resourceRule: null,
        baseTemplate: null,
        resetPolicyVersion: 0,
        protectedUntilGameTimeMs: 0,
    }, initial ? WORLD_LIFECYCLE_STATUS.ACTIVE
        : (available ? WORLD_LIFECYCLE_STATUS.AVAILABLE : WORLD_LIFECYCLE_STATUS.LOCKED));
    if (initial) {
        setPortalGeneration(portal, createWorldGenerationContext(sceneId, portal.worldEpoch));
        setPortalProtection(portal, sceneId);
    }
    return portal;
}

function initialState() {
    const completedDungeons = {};
    const portals = {};
    for (const [worldId, cfg] of Object.entries(worldSystemConfig.worlds || {})) {
        portals[worldId] = initialPortalState(worldId, cfg, completedDungeons);
    }
    return {
        version: VERSION,
        completedDungeons,
        dungeonRuns: {},
        highestUnlockedDungeonGrade: 'F',
        founding: {
            status: 'locked',
            sceneId: null,
            cellId: null,
            giftConsumed: false,
            skipAuthorized: false,
        },
        portals,
        worldMap: initialWorldMap(portals),
        worldNames: {},
    };
}

function gradeIndex(grade) {
    const index = DUNGEON_GRADE_ORDER.indexOf(String(grade || '').toUpperCase());
    return index < 0 ? 0 : index;
}

function deriveUnlockedDungeonGrade(completedDungeons = {}) {
    let unlockedIndex = 0;
    for (const [dungeonType, count] of Object.entries(completedDungeons)) {
        if (!(Number(count) > 0)) continue;
        const grade = dungeonConfigData.dungeonList?.[dungeonType]?.grade || 'F';
        unlockedIndex = Math.max(unlockedIndex, Math.min(DUNGEON_GRADE_ORDER.length - 1, gradeIndex(grade) + 1));
    }
    return DUNGEON_GRADE_ORDER[unlockedIndex];
}

let state = initialState();
// 交互开发工具的临时直连覆盖：只在当前会话生效，序列化时恢复正式传送门状态。
const debugPortalOriginals = new Map();

function portalState(worldId) {
    if (!state.portals[worldId]) {
        const instance = WorldInstanceSystem.getInstance(worldId);
        const generation = instance ? createWorldGenerationContext(worldId, 1) : null;
        state.portals[worldId] = setPortalStatus({
            status: instance ? WORLD_LIFECYCLE_STATUS.ACTIVE : WORLD_LIFECYCLE_STATUS.LOCKED,
            worldEpoch: instance ? 1 : 0,
            everConstructed: !!instance,
            constructed: !!instance,
            destroyed: false,
            hp: instance ? (worldSystemConfig.portal?.maxHp ?? 5000) : 0,
            generationVersion: generation?.generationVersion || 0,
            generationSeed: generation?.seed || 0,
            generationSeedStrategy: generation?.seedStrategy || null,
            resourceRule: generation?.resourceRule || null,
            baseTemplate: generation?.baseTemplate || null,
            resetPolicyVersion: generation?.policyVersion || 0,
            protectedUntilGameTimeMs: 0,
        }, instance ? WORLD_LIFECYCLE_STATUS.ACTIVE : WORLD_LIFECYCLE_STATUS.LOCKED);
    }
    return state.portals[worldId];
}

function requirementsMet(sceneId) {
    return !!state.worldMap?.securedSignals?.[sceneId] || requirementsMetFor(sceneId, state.completedDungeons);
}

function requirementsMetForTutorialSkip(sceneId) {
    const required = worldSystemConfig.worlds?.[sceneId]?.requirements?.completedDungeons || [];
    return required.every((dungeonType) => dungeonType === FIRST_DUNGEON_ID
        || (state.completedDungeons[dungeonType] || 0) > 0);
}

function worldHasCityHall(sceneId) {
    const cfgKey = worldSystemConfig.playerBase?.cfgKey || 'city_hall';
    const live = typeof window !== 'undefined'
        && window.SceneManager?._hasLiveWorldAnchor?.(sceneId, 'city_hall');
    const stored = getWorldSnapshot(sceneId)?.structures?.some((structure) =>
        structure?.cfgKey === cfgKey && Number(structure.hp) > 0);
    return !!(live || stored);
}

function reconcileMapDiscovery(sceneId) {
    const portal = portalState(sceneId);
    const entry = state.worldMap.discoveries[sceneId];
    if (!entry && !portal.everConstructed) return;
    const valid = entry && getWorldMapCell(sceneId, entry.cellId);
    const reserved = state.worldMap.reservations[sceneId];
    const location = valid ? entry
        : reserved && getWorldMapCell(sceneId, reserved.cellId) ? reserved : createMapDiscovery(sceneId, portal);
    // Rebuilding changes the plane instance/epoch, not the city's strategic location.
    state.worldMap.discoveries[sceneId] = location && { ...location, worldEpoch: mapEntryEpoch(portal) };
    delete state.worldMap.reservations[sceneId];
}

function refreshAvailability(sceneId) {
    const portal = portalState(sceneId);
    const cfg = resolveWorldConfig(sceneId);
    if (cfg?.templatePreviewOnly) {
        portal.everConstructed = false;
        portal.constructed = false;
        portal.destroyed = false;
        portal.hp = 0;
        setPortalStatus(portal, WORLD_LIFECYCLE_STATUS.LOCKED);
        return portal;
    }
    if (portal.everConstructed || portal.status === WORLD_LIFECYCLE_STATUS.ACTIVE
        || portal.status === WORLD_LIFECYCLE_STATUS.DESTROYED
        || portal.status === WORLD_LIFECYCLE_STATUS.REBUILDING) return portal;
    const next = cfg?.constructionEnabled !== false && requirementsMet(sceneId)
        ? WORLD_LIFECYCLE_STATUS.AVAILABLE
        : WORLD_LIFECYCLE_STATUS.LOCKED;
    return setPortalStatus(portal, next);
}

function migratePortal(sceneId, incoming, fallback) {
    if (!incoming || typeof incoming !== 'object') return fallback;
    const hasGenerationSeed = incoming.generationSeed !== undefined && incoming.generationSeed !== null
        && Number.isFinite(Number(incoming.generationSeed));
    const legacyEverConstructed = !!incoming.everConstructed
        || !!incoming.constructed || !!incoming.destroyed;
    let status = VALID_STATUS.has(incoming.status) ? incoming.status : null;
    if (!status) {
        if (incoming.destroyed) status = WORLD_LIFECYCLE_STATUS.DESTROYED;
        else if (incoming.constructed) status = WORLD_LIFECYCLE_STATUS.ACTIVE;
        else if (legacyEverConstructed) status = WORLD_LIFECYCLE_STATUS.DESTROYED;
        else status = fallback.status;
    }
    // REBUILDING 是瞬时事务状态；若存档恰好截获它，按未完成重建回到 DESTROYED。
    if (status === WORLD_LIFECYCLE_STATUS.REBUILDING) status = WORLD_LIFECYCLE_STATUS.DESTROYED;
    const everConstructed = legacyEverConstructed
        || status === WORLD_LIFECYCLE_STATUS.ACTIVE
        || status === WORLD_LIFECYCLE_STATUS.DESTROYED;
    const derivedGeneration = createWorldGenerationContext(sceneId,
        Math.max(0, Math.floor(Number(incoming.worldEpoch) || (everConstructed ? 1 : 0))));
    const portal = {
        status,
        worldEpoch: Math.max(0, Math.floor(Number(incoming.worldEpoch) || (everConstructed ? 1 : 0))),
        everConstructed,
        endpointExists: typeof incoming.endpointExists === 'boolean'
            ? incoming.endpointExists : legacyEverConstructed,
        constructed: false,
        destroyed: false,
        hp: Math.max(0, Number(incoming.hp) || 0),
        generationVersion: Math.max(1, Math.floor(Number(incoming.generationVersion)
            || derivedGeneration.generationVersion)),
        generationSeed: hasGenerationSeed
            ? (Number(incoming.generationSeed) >>> 0)
            : derivedGeneration.seed,
        generationSeedStrategy: incoming.generationSeedStrategy || derivedGeneration.seedStrategy,
        resourceRule: incoming.resourceRule || derivedGeneration.resourceRule,
        baseTemplate: incoming.baseTemplate || derivedGeneration.baseTemplate,
        resetPolicyVersion: Math.max(1, Math.floor(Number(incoming.resetPolicyVersion)
            || derivedGeneration.policyVersion)),
        protectedUntilGameTimeMs: Math.max(0, Number(incoming.protectedUntilGameTimeMs) || 0),
    };
    if (status === WORLD_LIFECYCLE_STATUS.ACTIVE && portal.hp <= 0) {
        status = WORLD_LIFECYCLE_STATUS.DESTROYED;
    }
    if (status === WORLD_LIFECYCLE_STATUS.ACTIVE) portal.endpointExists = true;
    setPortalStatus(portal, status);
    return portal;
}

export const WorldProgressionSystem = {
    config: worldSystemConfig,

    reset() {
        WorldInstanceSystem.reset();
        state = initialState();
        for (const sceneId of Object.keys(state.portals)) resetWorldSnapshot(sceneId);
        const initialInstance = this.ensureInitialStoryWorldInstance();
        this.ensureConstructedWorldSnapshots();
        return initialInstance;
    },

    serialize() {
        for (const portal of Object.values(state.portals)) setPortalStatus(portal, portal.status);
        const serialized = clone(state);
        for (const worldId of Object.keys(serialized.portals || {})) {
            if (resolveWorldConfig(worldId)?.templatePreviewOnly
                || (WorldInstanceSystem.isInstanceId(worldId)
                    && !WorldInstanceSystem.isPersistentInstance(worldId))) {
                delete serialized.portals[worldId];
            }
        }
        return serialized;
    },

    restore(data) {
        for (const sceneId of debugPortalOriginals.keys()) {
            if (typeof window !== 'undefined' && window.Game?._worldPlayerPos) {
                delete window.Game._worldPlayerPos[sceneId];
            }
        }
        debugPortalOriginals.clear();
        const next = initialState();
        if (data && typeof data === 'object') {
            next.completedDungeons = { ...(data.completedDungeons || {}) };
            next.dungeonRuns = clone(data.dungeonRuns || {});
            for (const instance of WorldInstanceSystem.listInstances({ persistentOnly: true })) {
                const cfg = resolveWorldConfig(instance.instanceId);
                if (cfg) next.portals[instance.instanceId] = initialPortalState(
                    instance.instanceId, cfg, next.completedDungeons
                );
            }
            for (const sceneId of Object.keys(next.portals)) {
                if (resolveWorldConfig(sceneId)?.templatePreviewOnly) continue;
                const incoming = data.portals?.[sceneId];
                if (!incoming) continue;
                next.portals[sceneId] = migratePortal(sceneId, incoming, next.portals[sceneId]);
            }
        }
        // 仅兼容仍把 scene8 配成正式锚点的旧数据；模板预览模式不创建应急固定入口。
        const anchor = next.portals.scene8;
        if (anchor && !resolveWorldConfig('scene8')?.templatePreviewOnly && !anchor.everConstructed) {
            anchor.everConstructed = true;
            anchor.worldEpoch = Math.max(1, anchor.worldEpoch || 0);
            setPortalGeneration(anchor, createWorldGenerationContext('scene8', anchor.worldEpoch));
            setPortalStatus(anchor, WORLD_LIFECYCLE_STATUS.DESTROYED);
        }
        state = next;
        for (const sceneId of Object.keys(state.portals)) refreshAvailability(sceneId);
        const initialInstance = this.ensureInitialStoryWorldInstance();
        this.ensureConstructedWorldSnapshots();
        return initialInstance;
    },

    /** 已建传送门必须始终拥有后台可结算的基础或完整快照。 */
    ensureConstructedWorldSnapshots() {
        for (const [sceneId, portal] of Object.entries(state.portals)) {
            if (portal.constructed && !portal.destroyed && this.canPersistWorld(sceneId)) {
                const worldConfig = this.getWorldConfig(sceneId);
                ensureWorldBaseSnapshot(sceneId, {
                    portalHp: portal.hp,
                    worldEpoch: portal.worldEpoch,
                    generation: this.getWorldGenerationContext(sceneId),
                    includeInitialFeatureBuilding: portal.worldEpoch === 1 && !!worldConfig?.featureBuilding,
                });
            } else if (!this.isWorldAnchored(sceneId) && this.shouldClearWorldScope(sceneId, 'snapshot')) {
                // 旧档若残留“未建门世界”的快照，也必须按当前生命周期契约清除。
                resetWorldSnapshot(sceneId);
            }
        }
        const foundingSceneId = state.founding?.sceneId;
        const foundingSnapshot = foundingSceneId ? getWorldSnapshot(foundingSceneId) : null;
        const cityHallCfgKey = worldSystemConfig.playerBase?.cfgKey || 'city_hall';
        const hasCityHallRecord = foundingSnapshot?.structures?.some((structure) =>
            structure?.cfgKey === cityHallCfgKey);
        // 修复旧版“首城进度已提交、首次切场失败”留下的半完成快照；
        // 已真实建立后被摧毁的市政厅会保留 playerBaseEstablished，不能借迁移免费复活。
        if (state.founding?.status === 'founded' && state.founding.giftConsumed
            && foundingSceneId && foundingSnapshot && this.isPortalConstructed(foundingSceneId)
            && foundingSnapshot.playerBaseEstablished !== true && !hasCityHallRecord) {
            ensureWorldPlayerBaseSnapshot(foundingSceneId);
        }
    },

    getWorldConfig(sceneId) {
        return resolveWorldConfig(sceneId);
    },

    getRuntimeSceneId(worldId) {
        return WorldInstanceSystem.resolveRuntimeSceneId(worldId);
    },

    getWorldTemplate(worldId) {
        return WorldInstanceSystem.getTemplateForWorld(worldId);
    },

    /** 已接通/已建门的位面在未自定义前使用“大地图坐标 + 新位面”命名。 */
    getWorldDisplayName(sceneId) {
        const cfg = this.getWorldConfig(sceneId);
        if (!cfg) return sceneId;
        const custom = state.worldNames?.[sceneId];
        if (custom) return custom;
        const portal = portalState(sceneId);
        const connected = portal.status === WORLD_LIFECYCLE_STATUS.ACTIVE
            || portal.status === WORLD_LIFECYCLE_STATUS.REBUILDING
            || portal.everConstructed;
        if (connected) {
            const discovery = this.getWorldMapDiscovery(sceneId);
            const cell = discovery?.cell;
            if (cell && Number.isFinite(cell.q) && Number.isFinite(cell.r)) {
                return `(${cell.q}, ${cell.r}) 新位面`;
            }
        }
        return cfg.name || sceneId;
    },

    /** 位面地貌小字（沙漠位面/雪原位面等），用于名称下方的说明行。 */
    getWorldTerrainLabel(sceneId) {
        const cfg = this.getWorldConfig(sceneId);
        if (!cfg) return '';
        const plane = WORLD_MAP_PLANES.find((entry) => entry.sceneId === sceneId);
        return plane?.label || cfg.description || '';
    },

    /** 保存玩家自定义位面名（当前存档序列化随整体保存；后续存档系统读取同一 state）。 */
    renameWorld(sceneId, rawName) {
        if (!this.getWorldConfig(sceneId)) return { ok: false, reason: '未知世界位面' };
        const portal = portalState(sceneId);
        if (!portal.everConstructed && portal.status !== WORLD_LIFECYCLE_STATUS.ACTIVE) {
            return { ok: false, reason: '该位面尚未接通，暂不能命名' };
        }
        const name = String(rawName || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
        if (!name) {
            delete state.worldNames?.[sceneId];
            try { EventBus.emit('world:renamed', { sceneId, name: this.getWorldDisplayName(sceneId) }); }
            catch (error) { console.warn('[WorldProgression] 位面名重置事件发送失败:', error); }
            return { ok: true, sceneId, name: this.getWorldDisplayName(sceneId), reset: true };
        }
        if (name.length > 24) return { ok: false, reason: '位面名称不能超过 24 个字符' };
        state.worldNames[sceneId] = name;
        try { EventBus.emit('world:renamed', { sceneId, name }); }
        catch (error) { console.warn('[WorldProgression] 位面改名事件发送失败:', error); }
        return { ok: true, sceneId, name };
    },

    getWorldResetPolicy(sceneId) {
        return getWorldResetPolicy(sceneId);
    },

    getWorldGenerationContext(sceneId) {
        const portal = portalState(sceneId);
        const current = createWorldGenerationContext(sceneId, portal.worldEpoch);
        return {
            ...current,
            generationVersion: portal.generationVersion > 0
                ? portal.generationVersion
                : current.generationVersion,
            seed: portal.worldEpoch > 0 && Number.isFinite(portal.generationSeed)
                ? (portal.generationSeed >>> 0)
                : current.seed,
            seedStrategy: portal.worldEpoch > 0 && portal.generationSeedStrategy
                ? portal.generationSeedStrategy
                : current.seedStrategy,
            resourceRule: portal.worldEpoch > 0 && portal.resourceRule
                ? portal.resourceRule
                : current.resourceRule,
            baseTemplate: portal.worldEpoch > 0 && portal.baseTemplate
                ? portal.baseTemplate
                : current.baseTemplate,
            policyVersion: portal.worldEpoch > 0 && portal.resetPolicyVersion > 0
                ? portal.resetPolicyVersion
                : current.policyVersion,
        };
    },

    getWorldGenerationSeed(sceneId, salt = '') {
        return deriveWorldSeed(this.getWorldGenerationContext(sceneId).seed, salt);
    },

    createWorldRandom(sceneId, salt = '') {
        return createSeededRandom(this.getWorldGenerationContext(sceneId).seed, salt);
    },

    shouldClearWorldScope(sceneId, scope) {
        return shouldClearWorldScope(sceneId, scope);
    },

    shouldPreserveWorldScope(sceneId, scope) {
        return shouldPreserveWorldScope(sceneId, scope);
    },

    getWorldIds() {
        return Object.keys(worldSystemConfig.worlds || {});
    },

    getWorldInstanceIds({ persistentOnly = false } = {}) {
        return WorldInstanceSystem.listInstances({ persistentOnly })
            .map((instance) => instance.instanceId);
    },

    /**
     * 正式世界目录只展示玩家已经发现或真正建立过的位面。
     * 配置模板与交互开发工具直连现场不能凭“存在配置”进入玩家航图。
     */
    isWorldPlayerVisible(worldId) {
        const cfg = this.getWorldConfig(worldId);
        if (!cfg || this.isDevWorldUnlocked(worldId)) return false;
        const portal = portalState(worldId);
        return portal.everConstructed || !!this.getWorldMapDiscovery(worldId);
    },

    /**
     * 当前战略地图模块尚未落地主调用点时，为新局/旧档提供一个可游玩的正式位面。
     * 后续战略格事件创建任意正式实例后，本入口自动停止补位。
     */
    ensureInitialStoryWorldInstance() {
        const bootstrap = worldSystemConfig.storyGeneration?.initialInstance || {};
        if (bootstrap.enabled === false) return { ok: true, skipped: true, reason: '初始剧情位面已禁用' };
        const existing = WorldInstanceSystem.listInstances({ persistentOnly: true });
        if (existing.length) {
            return {
                ok: true,
                skipped: true,
                reused: true,
                worldId: existing[0].instanceId,
                instance: existing[0],
            };
        }
        return this.createRandomStoryWorldInstance({
            templateIds: Array.isArray(bootstrap.templateIds) ? bootstrap.templateIds : null,
            strategicCellId: bootstrap.strategicCellId || 'story:initial-plane',
            source: 'story_bootstrap',
        });
    },

    _finalizeStoryWorldInstance(result) {
        if (!result.ok) return result;
        const worldId = result.instance.instanceId;
        const portal = portalState(worldId);
        if (!result.reused) setPortalProtection(portal, worldId);
        ensureWorldBaseSnapshot(worldId, {
            portalHp: portal.hp,
            worldEpoch: portal.worldEpoch,
            generation: this.getWorldGenerationContext(worldId),
            replace: !result.reused,
            includeInitialFeatureBuilding: !!this.getWorldConfig(worldId)?.featureBuilding,
        });
        return {
            ...result,
            worldId,
            portal: this.getPortalState(worldId),
        };
    },

    createStoryWorldInstance(options = {}) {
        return this._finalizeStoryWorldInstance(
            WorldInstanceSystem.createStoryInstance(options)
        );
    },

    createRandomStoryWorldInstance(options = {}) {
        return this._finalizeStoryWorldInstance(
            WorldInstanceSystem.createRandomStoryInstance(options)
        );
    },

    canPersistWorld(worldId) {
        if (WorldInstanceSystem.isInstanceId(worldId)) {
            return WorldInstanceSystem.isPersistentInstance(worldId)
                && this.isPortalConstructed(worldId);
        }
        return this.isPortalConstructed(worldId);
    },

    disposeWorldInstance(worldId) {
        if (!WorldInstanceSystem.isInstanceId(worldId)) return false;
        resetWorldSnapshot(worldId);
        delete state.portals[worldId];
        return WorldInstanceSystem.removeInstance(worldId);
    },

    recordDungeonRun(dungeonType, outcome) {
        if (!dungeonType) return;
        const entry = state.dungeonRuns[dungeonType] || { total: 0, success: 0, failed: 0, abandoned: 0 };
        entry.total++;
        if (outcome === 'success') {
            entry.success++;
            state.completedDungeons[dungeonType] = (state.completedDungeons[dungeonType] || 0) + 1;
            const completedGrade = dungeonConfigData.dungeonList?.[dungeonType]?.grade || 'F';
            const nextGradeIndex = Math.min(DUNGEON_GRADE_ORDER.length - 1, gradeIndex(completedGrade) + 1);
            if (nextGradeIndex > gradeIndex(state.highestUnlockedDungeonGrade)) {
                state.highestUnlockedDungeonGrade = DUNGEON_GRADE_ORDER[nextGradeIndex];
            }
            if (dungeonType === FIRST_DUNGEON_ID && state.founding.status === 'locked') {
                state.founding.status = 'awaiting_king';
                try { EventBus.emit('world:first-founding-ready', { dungeonType }); }
                catch (error) { console.warn('[WorldProgression] 首城引导事件发送失败:', error); }
            }
        } else if (outcome === 'abandoned' || outcome === 'safe_evac') {
            entry.abandoned++;
        } else {
            entry.failed++;
        }
        state.dungeonRuns[dungeonType] = entry;
        for (const sceneId of Object.keys(state.portals)) refreshAvailability(sceneId);
        try { EventBus.emit('world:dungeon-run-recorded', { dungeonType, outcome, run: clone(entry) }); }
        catch (error) { console.warn('[WorldProgression] 地牢结算事件发送失败:', error); }
    },

    hasCompletedDungeon(dungeonType) {
        return (state.completedDungeons[dungeonType] || 0) > 0;
    },

    /** 首次 F 级探索成功后才开放战略大地图；旧档只要已有位面进度也视为已开放。 */
    isWorldMapUnlocked() {
        return this.hasCompletedDungeon(FIRST_DUNGEON_ID)
            || state.founding.status !== 'locked'
            || Object.entries(state.portals).some(([sceneId, portal]) =>
                !this.isDevWorldUnlocked(sceneId) && portal.everConstructed)
            || Object.keys(state.worldMap?.discoveries || {}).some((sceneId) =>
                !this.isDevWorldUnlocked(sceneId));
    },

    getHighestUnlockedDungeonGrade() {
        return state.highestUnlockedDungeonGrade || 'F';
    },

    isDungeonGradeUnlocked(grade) {
        return gradeIndex(grade) <= gradeIndex(this.getHighestUnlockedDungeonGrade());
    },

    getDungeonUnlockStatus(dungeonType) {
        const dungeon = dungeonConfigData.dungeonList?.[dungeonType];
        if (!dungeon) return { ok: false, reason: '未知地牢', dungeonType };
        const requiredDungeon = dungeon.unlockAfter || null;
        const gradeUnlocked = this.isDungeonGradeUnlocked(dungeon.grade);
        const seriesUnlocked = !requiredDungeon || this.hasCompletedDungeon(requiredDungeon);
        const reasons = [];
        if (!gradeUnlocked) reasons.push(`全局地牢等级尚未解锁 ${dungeon.grade} 级`);
        if (!seriesUnlocked) {
            reasons.push(`需先通关${dungeonConfigData.dungeonList?.[requiredDungeon]?.name || requiredDungeon}`);
        }
        return {
            ok: gradeUnlocked && seriesUnlocked,
            dungeonType,
            grade: dungeon.grade || 'F',
            gradeUnlocked,
            seriesUnlocked,
            requiredDungeon,
            reasons,
            reason: reasons.join('；'),
        };
    },

    getFoundingState() {
        return clone(state.founding);
    },

    getFirstFoundingCandidates() {
        const skipAuthorized = state.founding.skipAuthorized === true;
        return this.getConstructableWorlds({ tutorialSkipQualification: skipAuthorized })
            .filter((entry) => entry.firstConstruction
                && entry.firstFoundingCandidate === true
                && !this.isDevWorldUnlocked(entry.sceneId)
                && (requirementsMet(entry.sceneId)
                    || (skipAuthorized && requirementsMetForTutorialSkip(entry.sceneId))))
            .map((entry) => ({
                ...entry,
                reservation: this.getReservedWorldMapCell(entry.sceneId),
            }))
            .filter((entry) => entry.reservation?.cellId);
    },

    /**
     * 序章“直接建立基地”只把首次教学地牢视作首城资格，不连带放开其他地牢门槛，
     * 也不伪造地牢成功记录、等级、掉落或奖励。后续仍须与小鼠大王交谈并确认正式候选。
     */
    unlockFirstFoundingForTutorialSkip() {
        if (state.founding.status === 'founded') {
            return { ok: false, reason: '首座城市已经建立', founding: this.getFoundingState() };
        }
        state.founding.skipAuthorized = true;
        state.founding.sceneId = null;
        state.founding.cellId = null;
        state.founding.status = 'awaiting_king';
        const founding = this.getFoundingState();
        try { EventBus.emit('world:first-founding-ready', { source: 'tutorial_skip', founding }); }
        catch (error) { console.warn('[WorldProgression] 跳过教学后的首城引导事件发送失败:', error); }
        return { ok: true, founding };
    },

    beginFirstFoundingSelection() {
        if (state.founding.status === 'founded') {
            return { ok: false, reason: '首座城市已经建立', founding: this.getFoundingState() };
        }
        if (!['awaiting_king', 'selecting'].includes(state.founding.status)) {
            return { ok: false, reason: '请先成功通关废弃矿洞初级' };
        }
        const candidates = this.getFirstFoundingCandidates();
        if (!candidates.length) return { ok: false, reason: '当前没有满足条件的首城位面，请稍后重试' };
        state.founding.status = 'selecting';
        try { EventBus.emit('world:first-founding-selection-opened', { candidates, founding: this.getFoundingState() }); }
        catch (error) { console.warn('[WorldProgression] 首城选址事件发送失败:', error); }
        return { ok: true, candidates, founding: this.getFoundingState() };
    },

    claimFirstFounding() {
        if (state.founding.status === 'founded') {
            return { ok: false, reason: '首座城市已经建立', founding: this.getFoundingState() };
        }
        if (state.founding.status !== 'selecting') {
            return { ok: false, reason: state.founding.status === 'awaiting_king'
                ? '请先与小鼠大王交谈并开启首城选址' : '请先成功通关废弃矿洞初级' };
        }
        if (!state.founding.sceneId || !state.founding.cellId) {
            return { ok: false, reason: '请先在位面航图中选择首城位置' };
        }
        const candidate = this.getFirstFoundingCandidates().find((entry) =>
            entry.sceneId === state.founding.sceneId && entry.reservation?.cellId === state.founding.cellId);
        if (!candidate) {
            state.founding.sceneId = null;
            state.founding.cellId = null;
            return { ok: false, reason: '该位面已不满足首城条件，请重新选择' };
        }
        const result = this.constructPortal(state.founding.sceneId, { foundingGift: true });
        if (!result.ok) return result;
        state.founding.status = 'founded';
        state.founding.giftConsumed = true;
        state.founding.cellId = result.discovery?.cellId || state.founding.cellId;
        state.worldMap.trackedWorldId = state.founding.sceneId;
        const completed = { ...result, founding: this.getFoundingState() };
        try { EventBus.emit('world:first-founding-completed', completed); }
        catch (error) { console.warn('[WorldProgression] 首城落成事件发送失败:', error); }
        return completed;
    },

    /** 小鼠大王批准选址后，从位面面板的合法候选中确认首城。 */
    claimFirstFoundingAt(sceneId) {
        if (state.founding.status !== 'selecting') {
            return { ok: false, reason: state.founding.status === 'founded'
                ? '首座城市已经建立' : state.founding.status === 'awaiting_king'
                    ? '请先返回小鼠大王处开启首城选址' : '请先成功通关废弃矿洞初级' };
        }
        const candidate = this.getFirstFoundingCandidates().find((entry) => entry.sceneId === sceneId);
        if (!candidate) return { ok: false, reason: '该位面当前不在合法首城候选中' };
        if (state.founding.sceneId && state.founding.sceneId !== sceneId) {
            return { ok: false, reason: '首城城址已定向到其他位面，请先接受该授予' };
        }
        const reservation = candidate.reservation;
        if (!reservation) return { ok: false, reason: '该位面暂无符合城距要求的首城落点' };
        state.founding.sceneId = sceneId;
        state.founding.cellId = reservation.cellId;
        return this.claimFirstFounding();
    },

    isWorldEligible(sceneId) {
        return requirementsMet(sceneId);
    },

    /** 开发工具专用：跳过地牢、科技、资源和构造，临时把目标加入主神空间传送门。 */
    debugUnlockWorld(sceneId) {
        const cfg = this.getWorldConfig(sceneId);
        if (!cfg) return { ok: false, reason: '未知世界位面' };
        const portal = portalState(sceneId);
        const alreadyDebug = debugPortalOriginals.has(sceneId);
        if (!alreadyDebug && state.worldMap?.discoveries?.[sceneId]) {
            return { ok: false, reason: '该位面已有正式航图发现记录，不能再作为测试场景直连' };
        }
        if (!alreadyDebug && portal.status === WORLD_LIFECYCLE_STATUS.ACTIVE) {
            return { ok: true, changed: false, alreadyConnected: true, sceneId, portal: this.getPortalState(sceneId) };
        }
        // 固定 scene 架构无法把正式旧城与测试地图分成两个状态键；禁止覆盖已有正式位面进度。
        if (!alreadyDebug && (portal.everConstructed || getWorldSnapshot(sceneId))) {
            return { ok: false, reason: '该位面已有正式进度，不能用测试直连覆盖；请直接使用现有传送入口' };
        }
        if (alreadyDebug && portal.status === WORLD_LIFECYCLE_STATUS.ACTIVE) {
            return {
                ok: true,
                changed: false,
                alreadyConnected: true,
                testOnly: true,
                sceneId,
                portal: this.getPortalState(sceneId),
            };
        }
        if (!alreadyDebug) debugPortalOriginals.set(sceneId, clone(portal));
        const firstActivation = !alreadyDebug;
        const reactivating = alreadyDebug;
        portal.worldEpoch = Math.max(1, portal.worldEpoch || 0);
        setPortalGeneration(portal, createWorldGenerationContext(sceneId, portal.worldEpoch));
        portal.everConstructed = true;
        portal.endpointExists = true;
        portal.hp = worldSystemConfig.portal?.maxHp ?? 5000;
        portal.protectedUntilGameTimeMs = 0;
        setPortalStatus(portal, WORLD_LIFECYCLE_STATUS.ACTIVE);
        if (firstActivation) resetWorldSnapshot(sceneId);
        return {
            ok: true,
            changed: firstActivation || reactivating,
            testOnly: true,
            sceneId,
            portal: this.getPortalState(sceneId),
        };
    },

    /** 开发工具专用：显式清空本次运行中的测试现场，并以新世代重新生成。 */
    debugResetWorld(sceneId) {
        if (!debugPortalOriginals.has(sceneId)) {
            return { ok: false, reason: '该位面尚未开启测试直连' };
        }
        const portal = portalState(sceneId);
        portal.worldEpoch = Math.max(1, portal.worldEpoch || 0) + 1;
        setPortalGeneration(portal, createWorldGenerationContext(sceneId, portal.worldEpoch));
        portal.everConstructed = true;
        portal.endpointExists = true;
        portal.hp = worldSystemConfig.portal?.maxHp ?? 5000;
        portal.protectedUntilGameTimeMs = 0;
        setPortalStatus(portal, WORLD_LIFECYCLE_STATUS.ACTIVE);
        resetWorldSnapshot(sceneId);
        return {
            ok: true,
            changed: true,
            reset: true,
            testOnly: true,
            sceneId,
            portal: this.getPortalState(sceneId),
        };
    },

    isDevWorldUnlocked(sceneId) {
        return debugPortalOriginals.has(sceneId);
    },

    secureWorldSignal(target) {
        const entry = this.getWorldMapDiscovery(target?.sceneId);
        if (!entry || entry.cellId !== target.cellId || entry.worldEpoch !== target.worldEpoch) return false;
        state.worldMap.securedSignals[target.sceneId] = { cellId: target.cellId, worldEpoch: target.worldEpoch };
        refreshAvailability(target.sceneId);
        return true;
    },

    isPortalConstructed(sceneId) {
        const portal = portalState(sceneId);
        return portal.status === WORLD_LIFECYCLE_STATUS.ACTIVE;
    },

    isWorldAnchored(sceneId) {
        if (this.isDevWorldUnlocked(sceneId)) return false;
        if (portalState(sceneId).status === WORLD_LIFECYCLE_STATUS.ACTIVE) return true;
        const liveHall = typeof window !== 'undefined'
            && window.SceneManager?._hasLiveWorldAnchor?.(sceneId, 'city_hall');
        if (liveHall) return true;
        const cfgKey = worldSystemConfig.playerBase?.cfgKey || 'city_hall';
        return !!getWorldSnapshot(sceneId)?.structures?.some((structure) =>
            structure?.cfgKey === cfgKey && Number(structure.hp) > 0);
    },

    getWorldEpoch(sceneId) {
        return Math.max(0, Math.floor(Number(portalState(sceneId).worldEpoch) || 0));
    },

    isWorldEpochCurrent(sceneId, worldEpoch) {
        const expected = this.getWorldEpoch(sceneId);
        const received = Math.floor(Number(worldEpoch) || 0);
        return expected > 0 && received === expected;
    },

    getPortalState(sceneId) {
        return { ...portalState(sceneId) };
    },

    getPortalProtection(sceneId, nowGameTimeMs = currentGameTimeMs()) {
        const portal = portalState(sceneId);
        const untilGameTimeMs = Math.max(0, Number(portal.protectedUntilGameTimeMs) || 0);
        const remainingMs = portal.status === WORLD_LIFECYCLE_STATUS.ACTIVE
            ? Math.max(0, untilGameTimeMs - Math.max(0, Number(nowGameTimeMs) || 0))
            : 0;
        return {
            active: remainingMs > 0,
            untilGameTimeMs,
            remainingMs,
            remainingDays: remainingMs / Math.max(1,
                Number(EnvironmentLightingSystem.getConfig()?.dayDurationMs) || 12 * 60 * 1000),
        };
    },

    isWorldInvasionProtected(sceneId, nowGameTimeMs = currentGameTimeMs()) {
        return this.getPortalProtection(sceneId, nowGameTimeMs).active;
    },

    getConstructableWorlds({ tutorialSkipQualification = false } = {}) {
        const worlds = worldSystemConfig.worlds || {};
        return Object.entries(worlds)
            .filter(([sceneId, cfg]) => {
                if (this.isDevWorldUnlocked(sceneId)) return false;
                const portal = portalState(sceneId);
                const eligible = requirementsMet(sceneId)
                    || (tutorialSkipQualification && requirementsMetForTutorialSkip(sceneId));
                return (cfg.constructionEnabled !== false || portal.everConstructed)
                    && eligible
                    && (portal.status === WORLD_LIFECYCLE_STATUS.AVAILABLE
                        || (tutorialSkipQualification && !portal.everConstructed
                            && portal.status === WORLD_LIFECYCLE_STATUS.LOCKED)
                        || (portal.status === WORLD_LIFECYCLE_STATUS.DESTROYED
                            && worldHasCityHall(sceneId)));
            })
            .map(([sceneId, cfg]) => {
                const portal = portalState(sceneId);
                return {
                    sceneId,
                    ...cfg,
                    firstConstruction: !portal.everConstructed,
                    rebuild: portal.everConstructed && portal.endpointExists,
                    recoveredConstruction: portal.everConstructed && !portal.endpointExists,
                    cost: portal.everConstructed && portal.endpointExists
                        ? { ...(worldSystemConfig.portal?.rebuildCost || {}) }
                        : { ...(worldSystemConfig.portal?.constructionCost || {}) },
                    name: this.getWorldDisplayName(sceneId),
                    terrainLabel: this.getWorldTerrainLabel(sceneId),
                };
            });
    },

    getTravelWorlds({ includeDestroyed = false } = {}) {
        const worldIds = [
            ...Object.entries(worldSystemConfig.worlds || {})
                .filter(([, cfg]) => !cfg.templatePreviewOnly)
                .map(([sceneId]) => sceneId),
            ...this.getWorldInstanceIds({ persistentOnly: true }),
        ];
        return worldIds
            .filter((sceneId, index) => worldIds.indexOf(sceneId) === index)
            .filter((sceneId) => {
                const portal = portalState(sceneId);
                return portal.status === WORLD_LIFECYCLE_STATUS.ACTIVE
                    || (includeDestroyed && portal.status === WORLD_LIFECYCLE_STATUS.DESTROYED);
            })
            .map((sceneId) => ({
                sceneId,
                ...this.getWorldConfig(sceneId),
                portal: this.getPortalState(sceneId),
            }));
    },

    constructPortal(sceneId, { foundingGift = false } = {}) {
        const cfg = worldSystemConfig.worlds?.[sceneId];
        if (!cfg) return { ok: false, reason: '未知世界位面' };
        const portal = portalState(sceneId);
        // 首城选址已经由小鼠大王批准时，确认候选按赠送处理：
        // 不要求“位面门工程”，也不扣除建造资源。
        if (state.founding?.status === 'selecting'
            && state.founding.giftConsumed !== true
            && state.founding.sceneId === sceneId) {
            foundingGift = true;
        }
        if (foundingGift && (state.founding.status !== 'selecting'
            || state.founding.giftConsumed || state.founding.sceneId !== sceneId)) {
            return { ok: false, reason: '首城赠送资格无效或已经使用' };
        }
        if (foundingGift && !canCreateWorldPlayerBaseSnapshot(sceneId)) {
            return { ok: false, reason: '首城市政厅配置缺失，暂不能完成授予' };
        }
        if (!foundingGift && !portal.everConstructed && !state.founding.giftConsumed
            && ['awaiting_king', 'selecting'].includes(state.founding.status)) {
            return { ok: false, reason: state.founding.status === 'awaiting_king'
                ? '请先返回小鼠大王处开启首城选址'
                : '请在位面航图的合法候选中确认首城' };
        }
        if (!foundingGift && cfg.constructionEnabled === false && !portal.everConstructed) {
            return { ok: false, reason: '该世界位面尚未开放传送门构造' };
        }
        if (!foundingGift && !requirementsMet(sceneId)) return { ok: false, reason: '请先击败此信标守军，或完成原有地牢解锁条件' };
        if (portal.status === WORLD_LIFECYCLE_STATUS.ACTIVE) return { ok: false, reason: '该世界传送门已经建成' };
        if (portal.status === WORLD_LIFECYCLE_STATUS.REBUILDING) return { ok: false, reason: '该世界传送门正在重建' };
        const firstConstruction = !portal.everConstructed;
        if (firstConstruction && !foundingGift && portal.status !== WORLD_LIFECYCLE_STATUS.AVAILABLE) {
            return { ok: false, reason: '该世界位面尚未进入可构造状态' };
        }
        if (!firstConstruction && portal.status !== WORLD_LIFECYCLE_STATUS.DESTROYED) {
            return { ok: false, reason: '该世界传送门当前不能重建' };
        }
        const cityHallAlive = worldHasCityHall(sceneId);
        if (!firstConstruction && !cityHallAlive) {
            return { ok: false, reason: '该位面已经崩塌，必须让移民队抵达原城址后才能恢复' };
        }
        if (!firstConstruction && portal.endpointExists) return this.repairPortal(sceneId);
        if ((firstConstruction || !portal.endpointExists) && !foundingGift) {
            const technology = typeof window !== 'undefined' ? window.Game?.TechnologySystem : null;
            if (!technology?.isUnlocked?.('building', 'portal')) {
                return { ok: false, reason: '需要先完成科技：位面门工程' };
            }
        }
        const cost = foundingGift ? { gold: 0, energy: 0 }
            : (firstConstruction || !portal.endpointExists)
                ? (worldSystemConfig.portal?.constructionCost || {})
                : (worldSystemConfig.portal?.rebuildCost || {});
        // Legacy building entry points also reserve a cell before first construction.
        if (firstConstruction && !state.worldMap.discoveries[sceneId]) {
            const entry = this.getReservedWorldMapCell(sceneId);
            if (!entry) return { ok: false, reason: '该位面没有符合城距要求的预留城址，暂不能接通' };
            state.worldMap.discoveries[sceneId] = entry;
        }
        if (!foundingGift) {
            const payment = payBuildingUpgradeCost(cost);
            if (!payment.ok) return payment;
        }
        if (firstConstruction) {
            portal.worldEpoch = Math.max(0, portal.worldEpoch || 0) + 1;
            setPortalGeneration(portal, createWorldGenerationContext(sceneId, portal.worldEpoch));
        }
        setPortalStatus(portal, WORLD_LIFECYCLE_STATUS.REBUILDING);
        portal.everConstructed = true;
        portal.endpointExists = true;
        portal.hp = worldSystemConfig.portal?.maxHp ?? 5000;
        setPortalProtection(portal, sceneId);
        // 首次接通建立新位面；移民恢复后的新门保留刚落成的市政厅快照。
        const snapshot = ensureWorldBaseSnapshot(sceneId, {
            portalHp: portal.hp,
            worldEpoch: portal.worldEpoch,
            generation: this.getWorldGenerationContext(sceneId),
            replace: firstConstruction,
            includeInitialFeatureBuilding: firstConstruction && !!cfg.featureBuilding,
        });
        if (foundingGift && !ensureWorldPlayerBaseSnapshot(sceneId)) {
            return { ok: false, reason: '首城市政厅快照登记失败，暂不能完成授予' };
        }
        if (!firstConstruction && snapshot) {
            const spawn = cfg.portalSpawn || { x: 0, y: 0 };
            let record = snapshot.structures?.find((structure) => structure?.cfgKey === 'portal');
            if (!record) {
                record = { kind: 'producer', id: `world_portal_${sceneId}`, cfgKey: 'portal',
                    x: spawn.x, y: spawn.y, buildCost: 0, buildCurrency: 'energy' };
                (snapshot.structures ||= []).push(record);
            }
            record.hp = portal.hp;
            record.maxHp = portal.hp;
        }
        setPortalStatus(portal, WORLD_LIFECYCLE_STATUS.ACTIVE);
        reconcileMapDiscovery(sceneId);
        const result = {
            ok: true,
            sceneId,
            firstConstruction,
            worldEpoch: portal.worldEpoch,
            generation: this.getWorldGenerationContext(sceneId),
            cost: { ...cost },
            foundingGift,
        };
        try { EventBus.emit('world:portal-completed', result); }
        catch (error) { console.warn('[WorldProgression] 传送门完成报告发送失败:', error); }
        return result;
    },

    /** 市政厅仍在时只修复原门址：不换世代、不清快照，也不要求位面门工程。 */
    repairPortal(sceneId) {
        const portal = portalState(sceneId);
        if (portal.status !== WORLD_LIFECYCLE_STATUS.DESTROYED || !portal.everConstructed
            || !portal.endpointExists) {
            return { ok: false, reason: '该位面没有可修复的传送门遗迹' };
        }
        const cityHallCfgKey = worldSystemConfig.playerBase?.cfgKey || 'city_hall';
        const liveCityHall = typeof window !== 'undefined'
            && window.SceneManager?._hasLiveWorldAnchor?.(sceneId, 'city_hall');
        const snapshot = getWorldSnapshot(sceneId);
        const storedCityHall = snapshot?.structures?.some((structure) =>
            structure?.cfgKey === cityHallCfgKey && Number(structure.hp) > 0);
        if (!liveCityHall && !storedCityHall) return { ok: false, reason: '市政厅也已失效，必须通过移民重新恢复该位面' };
        const cost = worldSystemConfig.portal?.rebuildCost || {};
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        const maxHp = worldSystemConfig.portal?.maxHp ?? 5000;
        portal.hp = maxHp;
        setPortalStatus(portal, WORLD_LIFECYCLE_STATUS.ACTIVE);
        if (snapshot) {
            let record = snapshot.structures?.find((structure) => structure?.cfgKey === 'portal');
            if (!record) {
                const spawn = worldSystemConfig.worlds?.[sceneId]?.portalSpawn || { x: 0, y: 0 };
                record = { kind: 'producer', id: `world_portal_${sceneId}`, cfgKey: 'portal',
                    x: spawn.x, y: spawn.y, buildCost: 0, buildCurrency: 'energy' };
                (snapshot.structures ||= []).push(record);
            }
            record.hp = maxHp;
            record.maxHp = maxHp;
        }
        const livePortal = typeof window !== 'undefined'
            ? window.Game?.ProducerBuildingSystem?.buildings?.find((building) =>
                building?._isWorldPortalCore && building._worldId === sceneId) : null;
        if (livePortal) this.revivePortalEntity(sceneId, livePortal);
        const result = { ok: true, repaired: true, sceneId, worldEpoch: portal.worldEpoch, cost: { ...cost } };
        try { EventBus.emit('world:portal-repaired', result); }
        catch (error) { console.warn('[WorldProgression] 传送门修复报告发送失败:', error); }
        return result;
    },

    requestPlayerBaseRebuild(sceneId) {
        if (!this.isPortalConstructed(sceneId)) return { ok: false, reason: '传送门也已失效，不能单独重建市政厅' };
        const cityHallCfgKey = worldSystemConfig.playerBase?.cfgKey || 'city_hall';
        const liveCityHall = typeof window !== 'undefined'
            && window.SceneManager?._hasLiveWorldAnchor?.(sceneId, 'city_hall');
        const snapshot = getWorldSnapshot(sceneId);
        const storedCityHall = snapshot?.structures?.some((structure) =>
            structure?.cfgKey === cityHallCfgKey && Number(structure.hp) > 0);
        if (liveCityHall || storedCityHall) return { ok: false, reason: '该位面的市政厅仍然存在' };
        if (!snapshot) return { ok: false, reason: '位面快照尚未就绪，无法登记重建' };
        if (!canCreateWorldPlayerBaseSnapshot(sceneId)) {
            return { ok: false, reason: '市政厅配置缺失，暂不能登记重建' };
        }
        const cost = worldSystemConfig.playerBase?.rebuildCost || {};
        const payment = payBuildingUpgradeCost(cost);
        if (!payment.ok) return payment;
        const currentScene = typeof window !== 'undefined' && window.SceneManager?.currentScene === sceneId;
        let building = null;
        if (currentScene) {
            const previousStructures = (snapshot.structures || [])
                .filter((structure) => structure?.cfgKey === cityHallCfgKey)
                .map((structure) => clone(structure));
            const previousEstablished = snapshot.playerBaseEstablished;
            prepareWorldPlayerBaseRebuild(sceneId);
            const portalEntity = window.SceneManager?._ensureWorldPortalEntity?.(sceneId, null);
            building = window.SceneManager?._ensureWorldPlayerBase?.(sceneId, portalEntity) || null;
            if (!building) {
                refundBuildingUpgradePayment(payment);
                snapshot.structures = (snapshot.structures || [])
                    .filter((structure) => structure?.cfgKey !== cityHallCfgKey)
                    .concat(previousStructures);
                snapshot.playerBaseEstablished = previousEstablished;
                snapshot.backgroundLedger = null;
                return { ok: false, reason: '传送门附近没有安全的市政厅空地，重建费用已退回' };
            }
            ensureWorldPlayerBaseSnapshot(sceneId, { x: building.x, y: building.y });
        } else {
            if (!ensureWorldPlayerBaseSnapshot(sceneId)) {
                refundBuildingUpgradePayment(payment);
                return { ok: false, reason: '市政厅快照登记失败，重建费用已退回' };
            }
        }
        const result = { ok: true, sceneId, building, cost: { ...cost } };
        try { EventBus.emit('world:player-base-rebuild-requested', result); }
        catch (error) { console.warn('[WorldProgression] 市政厅重建报告发送失败:', error); }
        return result;
    },

    markPortalDestroyed(sceneId, { expectedEpoch } = {}) {
        const portal = portalState(sceneId);
        if (expectedEpoch != null && !this.isWorldEpochCurrent(sceneId, expectedEpoch)) return false;
        if (portal.status !== WORLD_LIFECYCLE_STATUS.ACTIVE
            && portal.status !== WORLD_LIFECYCLE_STATUS.DESTROYED) return false;
        portal.everConstructed = true;
        portal.endpointExists = true;
        portal.worldEpoch = Math.max(1, portal.worldEpoch || 0);
        portal.hp = 0;
        portal.protectedUntilGameTimeMs = 0;
        setPortalStatus(portal, WORLD_LIFECYCLE_STATUS.DESTROYED);
        return true;
    },

    /** 双锚点均毁后，旧门址也随位面记录作废；只能由移民先恢复市政厅。 */
    markWorldCollapsed(sceneId, { expectedEpoch } = {}) {
        const portal = portalState(sceneId);
        if (expectedEpoch != null && !this.isWorldEpochCurrent(sceneId, expectedEpoch)) return false;
        portal.endpointExists = false;
        portal.hp = 0;
        setPortalStatus(portal, WORLD_LIFECYCLE_STATUS.DESTROYED);
        return true;
    },

    restoreWorldWithSettler(sceneId, { cellId, population = 0 } = {}) {
        const portal = portalState(sceneId);
        const entry = this.getWorldMapDiscovery(sceneId);
        if (!entry || entry.cellId !== cellId) return { ok: false, reason: '移民队必须抵达该位面的原城址' };
        if (portal.status !== WORLD_LIFECYCLE_STATUS.DESTROYED || this.isWorldAnchored(sceneId)) {
            return { ok: false, reason: '该位面当前不需要移民恢复' };
        }
        portal.worldEpoch = Math.max(0, portal.worldEpoch || 0) + 1;
        setPortalGeneration(portal, createWorldGenerationContext(sceneId, portal.worldEpoch));
        portal.everConstructed = true;
        portal.endpointExists = false;
        portal.hp = 0;
        portal.protectedUntilGameTimeMs = 0;
        setPortalStatus(portal, WORLD_LIFECYCLE_STATUS.DESTROYED);
        const snapshot = ensureSettlerRestoredWorldSnapshot(sceneId, {
            worldEpoch: portal.worldEpoch,
            generation: this.getWorldGenerationContext(sceneId),
        });
        if (!snapshot) return { ok: false, reason: '无法在原城址建立市政厅' };
        reconcileMapDiscovery(sceneId);
        const result = { ok: true, sceneId, cellId, population: Math.max(0, Math.floor(population)) };
        try { EventBus.emit('world:settler-restored', result); }
        catch (error) { console.warn('[WorldProgression] 移民恢复报告发送失败:', error); }
        return result;
    },

    syncPortalHp(sceneId, hp, { expectedEpoch } = {}) {
        const portal = portalState(sceneId);
        if (expectedEpoch != null && !this.isWorldEpochCurrent(sceneId, expectedEpoch)) return false;
        if (portal.status !== WORLD_LIFECYCLE_STATUS.ACTIVE
            && portal.status !== WORLD_LIFECYCLE_STATUS.REBUILDING) return false;
        portal.hp = Math.max(0, Number(hp) || 0);
        if (portal.hp <= 0 && portal.everConstructed) {
            portal.endpointExists = true;
            setPortalStatus(portal, WORLD_LIFECYCLE_STATUS.DESTROYED);
        }
        return true;
    },

    revivePortalEntity(sceneId, entity) {
        const portal = portalState(sceneId);
        if (!entity || portal.status !== WORLD_LIFECYCLE_STATUS.ACTIVE) return false;
        const maxHp = worldSystemConfig.portal?.maxHp ?? entity.maxHp ?? 5000;
        entity.maxHp = maxHp;
        entity.hp = Math.max(1, Math.min(maxHp, portal.hp || maxHp));
        if (entity.data) {
            entity.data.maxHp = maxHp;
            entity.data.hp = entity.hp;
        }
        entity.active = true;
        entity.hittable = true;
        entity._portalDestroyed = false;
        entity._worldEpoch = portal.worldEpoch;
        entity.name = `${this.getWorldConfig(sceneId)?.name || sceneId}传送门`;
        return true;
    },
};
