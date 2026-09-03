// 世界位面重置策略：配置归一化、世代生成描述与确定性随机流。
import worldSystemConfig from '../../data/world-system.json';
import { WorldInstanceSystem } from './world-instance-system.js';

const SAFE_DEFAULTS = Object.freeze({
    policyVersion: 1,
    baseTemplate: 'portal_only_v1',
    generationVersion: 2,
    seedStrategy: 'per_world_epoch',
    baseSeed: 0,
    resourceRule: 'energy_clusters_v2',
    preserveOnDestroy: [
        'dungeonProgress', 'globalClock', 'invasionProgress',
        'playerInventory', 'globalUpgrades',
    ],
    clearOnDestroy: [
        'snapshot', 'playerPosition', 'structures', 'units', 'drops',
        'resourceNodes', 'roads', 'activeInvasion',
    ],
    rebuildProtectionDays: 0,
});

const cloneList = (value, fallback) => Array.isArray(value) ? [...value] : [...fallback];

function hash32(value) {
    let hash = 0x811c9dc5;
    const text = String(value);
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

export function getWorldResetPolicy(worldId) {
    const instance = WorldInstanceSystem.getInstance(worldId);
    const runtimeSceneId = instance?.runtimeSceneId || worldId;
    const template = WorldInstanceSystem.getTemplateForWorld(worldId);
    const defaults = worldSystemConfig.resetPolicyDefaults || {};
    const override = worldSystemConfig.worlds?.[runtimeSceneId]?.resetPolicy || {};
    const templateOverride = template?.resetPolicy || {};
    const merged = { ...SAFE_DEFAULTS, ...defaults, ...override, ...templateOverride };
    return {
        policyVersion: Math.max(1, Math.floor(Number(merged.policyVersion) || 1)),
        baseTemplate: String(merged.baseTemplate || SAFE_DEFAULTS.baseTemplate),
        generationVersion: Math.max(1, Math.floor(Number(merged.generationVersion) || 1)),
        seedStrategy: instance
            ? 'instance_seed'
            : (merged.seedStrategy === 'fixed' ? 'fixed' : 'per_world_epoch'),
        baseSeed: instance
            ? (instance.seed >>> 0)
            : (Number.isFinite(Number(merged.baseSeed)) ? (Number(merged.baseSeed) >>> 0) : 0),
        resourceRule: String(merged.resourceRule || SAFE_DEFAULTS.resourceRule),
        preserveOnDestroy: cloneList(merged.preserveOnDestroy, SAFE_DEFAULTS.preserveOnDestroy),
        clearOnDestroy: cloneList(merged.clearOnDestroy, SAFE_DEFAULTS.clearOnDestroy),
        // 第五阶段：新建/重建保护期按统一游戏时钟写入传送门状态并过滤入侵候选池。
        rebuildProtectionDays: Math.max(0, Number(merged.rebuildProtectionDays) || 0),
    };
}

export function createWorldGenerationContext(worldId, worldEpoch) {
    const policy = getWorldResetPolicy(worldId);
    const epoch = Math.max(0, Math.floor(Number(worldEpoch) || 0));
    const seed = policy.seedStrategy === 'fixed'
        ? policy.baseSeed
        : (policy.seedStrategy === 'instance_seed' && epoch <= 1
            ? policy.baseSeed
            : hash32(`${worldId}|${policy.baseSeed}|${policy.generationVersion}|${epoch}`));
    return {
        generationVersion: policy.generationVersion,
        seedStrategy: policy.seedStrategy,
        seed,
        resourceRule: policy.resourceRule,
        baseTemplate: policy.baseTemplate,
        policyVersion: policy.policyVersion,
    };
}

export function deriveWorldSeed(seed, salt = '') {
    return hash32(`${Number(seed) >>> 0}|${salt}`);
}

export function createSeededRandom(seed, salt = '') {
    let value = deriveWorldSeed(seed, salt) || 0x6d2b79f5;
    return () => {
        value = (value + 0x6d2b79f5) >>> 0;
        let mixed = value;
        mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x100000000;
    };
}

export function shouldClearWorldScope(worldId, scope) {
    return getWorldResetPolicy(worldId).clearOnDestroy.includes(scope);
}

export function shouldPreserveWorldScope(worldId, scope) {
    return getWorldResetPolicy(worldId).preserveOnDestroy.includes(scope);
}
