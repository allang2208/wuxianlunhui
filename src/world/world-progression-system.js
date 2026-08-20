// 世界位面进度：地牢完成记录、传送门建造资格、传送网络与重建成本的唯一真源。
import worldSystemConfig from '../../data/world-system.json';
import { payBuildingUpgradeCost } from './building-upgrade-payment.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { ensureWorldBaseSnapshot, resetWorldSnapshot } from './world122-snapshot.js';
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
const VERSION = 4;
const clone = (value) => JSON.parse(JSON.stringify(value));

function requirementsMetFor(sceneId, completedDungeons) {
    const cfg = worldSystemConfig.worlds?.[sceneId];
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
    const initial = cfg.initialPortal === true;
    const available = cfg.constructionEnabled !== false
        && requirementsMetFor(sceneId, completedDungeons);
    const portal = setPortalStatus({
        status: initial
            ? WORLD_LIFECYCLE_STATUS.ACTIVE
            : (available ? WORLD_LIFECYCLE_STATUS.AVAILABLE : WORLD_LIFECYCLE_STATUS.LOCKED),
        worldEpoch: initial ? 1 : 0,
        everConstructed: initial,
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
    for (const [sceneId, cfg] of Object.entries(worldSystemConfig.worlds || {})) {
        portals[sceneId] = initialPortalState(sceneId, cfg, completedDungeons);
    }
    return {
        version: VERSION,
        completedDungeons,
        dungeonRuns: {},
        portals,
    };
}

let state = initialState();

function portalState(sceneId) {
    if (!state.portals[sceneId]) {
        state.portals[sceneId] = setPortalStatus({
            status: WORLD_LIFECYCLE_STATUS.LOCKED,
            worldEpoch: 0,
            everConstructed: false,
            constructed: false,
            destroyed: false,
            hp: 0,
            generationVersion: 0,
            generationSeed: 0,
            generationSeedStrategy: null,
            resourceRule: null,
            baseTemplate: null,
            resetPolicyVersion: 0,
            protectedUntilGameTimeMs: 0,
        }, WORLD_LIFECYCLE_STATUS.LOCKED);
    }
    return state.portals[sceneId];
}

function requirementsMet(sceneId) {
    return requirementsMetFor(sceneId, state.completedDungeons);
}

function refreshAvailability(sceneId) {
    const portal = portalState(sceneId);
    if (portal.everConstructed || portal.status === WORLD_LIFECYCLE_STATUS.ACTIVE
        || portal.status === WORLD_LIFECYCLE_STATUS.DESTROYED
        || portal.status === WORLD_LIFECYCLE_STATUS.REBUILDING) return portal;
    const cfg = worldSystemConfig.worlds?.[sceneId];
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
    setPortalStatus(portal, status);
    return portal;
}

export const WorldProgressionSystem = {
    config: worldSystemConfig,

    reset() {
        state = initialState();
        for (const sceneId of Object.keys(state.portals)) resetWorldSnapshot(sceneId);
        this.ensureConstructedWorldSnapshots();
    },

    serialize() {
        for (const portal of Object.values(state.portals)) setPortalStatus(portal, portal.status);
        return clone(state);
    },

    restore(data) {
        const next = initialState();
        if (data && typeof data === 'object') {
            next.completedDungeons = { ...(data.completedDungeons || {}) };
            next.dungeonRuns = clone(data.dungeonRuns || {});
            for (const sceneId of Object.keys(next.portals)) {
                const incoming = data.portals?.[sceneId];
                if (!incoming) continue;
                next.portals[sceneId] = migratePortal(sceneId, incoming, next.portals[sceneId]);
            }
        }
        // 起始世界永远保留主神空间的应急进入链；传送门本体仍可被摧毁并在世界内重建。
        const anchor = next.portals.scene8;
        if (anchor && !anchor.everConstructed) {
            anchor.everConstructed = true;
            anchor.worldEpoch = Math.max(1, anchor.worldEpoch || 0);
            setPortalGeneration(anchor, createWorldGenerationContext('scene8', anchor.worldEpoch));
            setPortalStatus(anchor, WORLD_LIFECYCLE_STATUS.DESTROYED);
        }
        state = next;
        for (const sceneId of Object.keys(state.portals)) refreshAvailability(sceneId);
        this.ensureConstructedWorldSnapshots();
    },

    /** 已建传送门必须始终拥有后台可结算的基础或完整快照。 */
    ensureConstructedWorldSnapshots() {
        for (const [sceneId, portal] of Object.entries(state.portals)) {
            if (portal.constructed && !portal.destroyed) {
                ensureWorldBaseSnapshot(sceneId, {
                    portalHp: portal.hp,
                    worldEpoch: portal.worldEpoch,
                    generation: this.getWorldGenerationContext(sceneId),
                });
            } else if (this.shouldClearWorldScope(sceneId, 'snapshot')) {
                // 旧档若残留“未建门世界”的快照，也必须按当前生命周期契约清除。
                resetWorldSnapshot(sceneId);
            }
        }
    },

    getWorldConfig(sceneId) {
        return worldSystemConfig.worlds?.[sceneId] || null;
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

    recordDungeonRun(dungeonType, outcome) {
        if (!dungeonType) return;
        const entry = state.dungeonRuns[dungeonType] || { total: 0, success: 0, failed: 0, abandoned: 0 };
        entry.total++;
        if (outcome === 'success') {
            entry.success++;
            state.completedDungeons[dungeonType] = (state.completedDungeons[dungeonType] || 0) + 1;
        } else if (outcome === 'abandoned' || outcome === 'safe_evac') {
            entry.abandoned++;
        } else {
            entry.failed++;
        }
        state.dungeonRuns[dungeonType] = entry;
        for (const sceneId of Object.keys(state.portals)) refreshAvailability(sceneId);
    },

    hasCompletedDungeon(dungeonType) {
        return (state.completedDungeons[dungeonType] || 0) > 0;
    },

    isWorldEligible(sceneId) {
        return requirementsMet(sceneId);
    },

    isPortalConstructed(sceneId) {
        const portal = portalState(sceneId);
        return portal.status === WORLD_LIFECYCLE_STATUS.ACTIVE;
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

    getConstructableWorlds() {
        const worlds = worldSystemConfig.worlds || {};
        return Object.entries(worlds)
            .filter(([sceneId, cfg]) => {
                const portal = portalState(sceneId);
                return (cfg.constructionEnabled !== false || portal.everConstructed)
                    && requirementsMet(sceneId)
                    && (portal.status === WORLD_LIFECYCLE_STATUS.AVAILABLE
                        || portal.status === WORLD_LIFECYCLE_STATUS.DESTROYED);
            })
            .map(([sceneId, cfg]) => {
                const portal = portalState(sceneId);
                return {
                    sceneId,
                    ...cfg,
                    firstConstruction: !portal.everConstructed,
                    rebuild: portal.everConstructed,
                    cost: portal.everConstructed
                        ? { ...(worldSystemConfig.portal?.rebuildCost || {}) }
                        : { gold: 0, energy: 0 },
                };
            });
    },

    getTravelWorlds({ includeDestroyed = false } = {}) {
        return Object.entries(worldSystemConfig.worlds || {})
            .filter(([sceneId]) => {
                const portal = portalState(sceneId);
                return portal.status === WORLD_LIFECYCLE_STATUS.ACTIVE
                    || (includeDestroyed && portal.status === WORLD_LIFECYCLE_STATUS.DESTROYED);
            })
            .map(([sceneId, cfg]) => ({ sceneId, ...cfg, portal: this.getPortalState(sceneId) }));
    },

    constructPortal(sceneId) {
        const cfg = worldSystemConfig.worlds?.[sceneId];
        if (!cfg) return { ok: false, reason: '未知世界位面' };
        const portal = portalState(sceneId);
        if (cfg.constructionEnabled === false && !portal.everConstructed) {
            return { ok: false, reason: '该世界位面尚未开放传送门构造' };
        }
        if (!requirementsMet(sceneId)) return { ok: false, reason: '尚未满足该世界的地牢解锁条件' };
        if (portal.status === WORLD_LIFECYCLE_STATUS.ACTIVE) return { ok: false, reason: '该世界传送门已经建成' };
        if (portal.status === WORLD_LIFECYCLE_STATUS.REBUILDING) return { ok: false, reason: '该世界传送门正在重建' };
        const firstConstruction = !portal.everConstructed;
        if (firstConstruction && portal.status !== WORLD_LIFECYCLE_STATUS.AVAILABLE) {
            return { ok: false, reason: '该世界位面尚未进入可构造状态' };
        }
        if (!firstConstruction && portal.status !== WORLD_LIFECYCLE_STATUS.DESTROYED) {
            return { ok: false, reason: '该世界传送门当前不能重建' };
        }
        const cost = firstConstruction ? { gold: 0, energy: 0 } : (worldSystemConfig.portal?.rebuildCost || {});
        if (!firstConstruction) {
            const payment = payBuildingUpgradeCost(cost);
            if (!payment.ok) return payment;
        }
        portal.worldEpoch = Math.max(0, portal.worldEpoch || 0) + 1;
        setPortalGeneration(portal, createWorldGenerationContext(sceneId, portal.worldEpoch));
        setPortalStatus(portal, WORLD_LIFECYCLE_STATUS.REBUILDING);
        portal.everConstructed = true;
        portal.hp = worldSystemConfig.portal?.maxHp ?? 5000;
        setPortalProtection(portal, sceneId);
        // 构造和重建都从新的基础位面开始；不会沿用任何意外残留的旧快照。
        ensureWorldBaseSnapshot(sceneId, {
            portalHp: portal.hp,
            worldEpoch: portal.worldEpoch,
            generation: this.getWorldGenerationContext(sceneId),
            replace: true,
        });
        setPortalStatus(portal, WORLD_LIFECYCLE_STATUS.ACTIVE);
        return {
            ok: true,
            sceneId,
            firstConstruction,
            worldEpoch: portal.worldEpoch,
            generation: this.getWorldGenerationContext(sceneId),
            cost: { ...cost },
        };
    },

    markPortalDestroyed(sceneId, { expectedEpoch } = {}) {
        const portal = portalState(sceneId);
        if (expectedEpoch != null && !this.isWorldEpochCurrent(sceneId, expectedEpoch)) return false;
        if (portal.status !== WORLD_LIFECYCLE_STATUS.ACTIVE
            && portal.status !== WORLD_LIFECYCLE_STATUS.DESTROYED) return false;
        portal.everConstructed = true;
        portal.worldEpoch = Math.max(1, portal.worldEpoch || 0);
        portal.hp = 0;
        portal.protectedUntilGameTimeMs = 0;
        setPortalStatus(portal, WORLD_LIFECYCLE_STATUS.DESTROYED);
        return true;
    },

    syncPortalHp(sceneId, hp, { expectedEpoch } = {}) {
        const portal = portalState(sceneId);
        if (expectedEpoch != null && !this.isWorldEpochCurrent(sceneId, expectedEpoch)) return false;
        if (portal.status !== WORLD_LIFECYCLE_STATUS.ACTIVE
            && portal.status !== WORLD_LIFECYCLE_STATUS.REBUILDING) return false;
        portal.hp = Math.max(0, Number(hp) || 0);
        if (portal.hp <= 0 && portal.everConstructed) {
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
        entity.name = `${worldSystemConfig.worlds?.[sceneId]?.name || sceneId}传送门`;
        return true;
    },
};
