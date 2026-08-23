// ============================================================
// Building upgrade projects — World-122
// 建筑只引用项目 ID；项目内容与数值统一由 data/building-upgrades.json 提供。
// ============================================================
import projectsData from '../../data/building-upgrades.json';

export const BUILDING_UPGRADE_PROJECTS = projectsData;
export const DEFAULT_BUILDING_UPGRADE_TIME_MS = 60000;

export function getBuildingUpgradeProject(projectId) {
    if (!projectId) return null;
    const project = BUILDING_UPGRADE_PROJECTS[projectId];
    return project && typeof project === 'object' ? project : null;
}

/** 将建筑自身数据与其升级项目合并为运行时配置，不修改 JSON 原对象。 */
export function resolveBuildingUpgradeProject(buildingCfg) {
    if (!buildingCfg || typeof buildingCfg !== 'object') return buildingCfg;
    const project = getBuildingUpgradeProject(buildingCfg.upgradeProject);
    if (!project) return buildingCfg;
    return {
        ...buildingCfg,
        modules: project.modules || {},
        abilities: project.abilities || {},
        moduleUpgrade: project.moduleUpgrade || buildingCfg.moduleUpgrade,
        upgradeCost: project.moduleUpgrade || buildingCfg.upgradeCost,
        abilityUpgrade: project.abilityUpgrade || buildingCfg.abilityUpgrade,
    };
}

/** 模块升级费用/时间：模块可按等级覆盖，否则回退到项目统一配置。 */
export function getBuildingModuleUpgradeCost(buildingCfg, moduleId, currentLevel = 0) {
    const module = buildingCfg?.modules?.[moduleId];
    if (!module) return null;
    const defaults = buildingCfg.upgradeCost || buildingCfg.moduleUpgrade || {};
    const level = Math.max(0, Math.floor(Number(currentLevel) || 0));
    const byLevel = (value, fallback) => Array.isArray(value)
        ? (value[level] ?? value[value.length - 1] ?? fallback)
        : (value ?? fallback);
    return {
        gold: Math.max(0, Math.floor(Number(byLevel(
            module.goldByLevel ?? defaults.goldByLevel,
            defaults.gold
        )) || 0)),
        energy: Math.max(0, Math.floor(Number(byLevel(
            module.energyByLevel ?? defaults.energyByLevel,
            defaults.energy
        )) || 0)),
        timeMs: Math.max(1, Math.floor(Number(byLevel(
            module.timeByLevel,
            (defaults.timeBaseMs ?? DEFAULT_BUILDING_UPGRADE_TIME_MS)
                + (defaults.timeGrowthMs ?? 0) * level
        )) || DEFAULT_BUILDING_UPGRADE_TIME_MS)),
    };
}

/** 读条占用键：能力按能力 ID，全局兵种模块按兵种 + 模块 ID。 */
export function getBuildingUpgradeProgressKey(upgrade) {
    if (!upgrade) return null;
    if (upgrade.abilityId) return `ability:${upgrade.abilityId}`;
    if (upgrade.moduleId && upgrade.unitType) return `module:${upgrade.unitType}:${upgrade.moduleId}`;
    return null;
}

/**
 * 一个共享模块读条可能同时覆盖多个兵种；占用判断必须覆盖全部目标键，
 * 避免另一栋建筑从共享组中的第二个兵种旁路启动同一项目。
 */
export function getBuildingUpgradeProgressKeys(upgrade) {
    if (!upgrade) return [];
    if (upgrade.abilityId) return [`ability:${upgrade.abilityId}`];
    if (!upgrade.moduleId) return [];
    const kinds = Array.isArray(upgrade.unitTypes) && upgrade.unitTypes.length
        ? upgrade.unitTypes
        : [upgrade.unitType];
    return [...new Set(kinds.filter(Boolean)
        .map((kind) => `module:${kind}:${upgrade.moduleId}`))];
}

/** 当前场景是否已有另一栋建筑在推进同一个全局升级项目。 */
export function isBuildingUpgradeProgressOccupied(owner, upgrade, entities = null) {
    const keys = new Set(getBuildingUpgradeProgressKeys(upgrade));
    if (!keys.size) return false;
    const activeEntities = entities || ((typeof window !== 'undefined' && window.Game?.entities) || null);
    if (!activeEntities || typeof activeEntities.values !== 'function') return false;
    for (const entity of activeEntities.values()) {
        if (!entity || entity === owner || entity.active === false) continue;
        if (getBuildingUpgradeProgressKeys(entity._upgrade).some((key) => keys.has(key))) return true;
    }
    return false;
}

/** 兼容旧档 string 能力目标，并规范化模块/能力持续升级描述。 */
export function normalizeBuildingContinuousTarget(target) {
    if (typeof target === 'string' && target) {
        return { kind: 'ability', abilityId: target };
    }
    if (!target || typeof target !== 'object') return null;
    if (target.kind === 'ability' && target.abilityId) {
        return { kind: 'ability', abilityId: target.abilityId };
    }
    if (target.kind === 'module' && target.moduleId) {
        const unitTypes = Array.isArray(target.unitTypes)
            ? [...new Set(target.unitTypes.filter(Boolean))]
            : [];
        const unitType = target.unitType || unitTypes[0] || null;
        return {
            kind: 'module',
            moduleId: target.moduleId,
            unitType,
            unitTypes: unitTypes.length ? unitTypes : (unitType ? [unitType] : []),
        };
    }
    return null;
}

export function buildingContinuousTargetMatches(target, kind, projectId, unitType = null) {
    const normalized = normalizeBuildingContinuousTarget(target);
    if (!normalized || normalized.kind !== kind) return false;
    if (kind === 'ability') return normalized.abilityId === projectId;
    if (normalized.moduleId !== projectId) return false;
    return !unitType || normalized.unitTypes.includes(unitType) || normalized.unitType === unitType;
}

/** 同类别建筑共享一个持续升级占用槽；普通一次性升级不占这个槽。 */
export function getBuildingContinuousCategory(building) {
    if (!building) return null;
    if (building._continuousUpgradeCategory) return building._continuousUpgradeCategory;
    // 旧存档的 barracks 也归入迁移后的通用出兵建筑升级互斥域。
    if (building._isHamsterBarracks || building.kind === 'barracks') return 'producer:hamster_barracks';
    if (building._isProducerBuilding || building.kind === 'producer') {
        return building.cfgKey ? `producer:${building.cfgKey}` : null;
    }
    return null;
}

export function isBuildingContinuousUpgradeOccupied(owner, entities = null) {
    const category = getBuildingContinuousCategory(owner);
    if (!category) return false;
    const activeEntities = entities || ((typeof window !== 'undefined' && window.Game?.entities) || null);
    if (!activeEntities || typeof activeEntities.values !== 'function') return false;
    for (const entity of activeEntities.values()) {
        if (!entity || entity === owner || entity.active === false || !entity._continuous) continue;
        if (getBuildingContinuousCategory(entity) === category) return true;
    }
    return false;
}

/** 兵种按项目声明取模块，不依赖某个具体建筑名称。 */
export function getUpgradeModulesForUnitKind(kind) {
    for (const project of Object.values(BUILDING_UPGRADE_PROJECTS)) {
        if (!project || !Array.isArray(project.unitKinds) || !project.unitKinds.includes(kind)) continue;
        return project.modules || {};
    }
    return {};
}

/** 全局能力/研究按 ID 查项目定义，供 AI、研究系统和后台结算共用。 */
export function getBuildingUpgradeAbility(abilityId) {
    if (!abilityId) return null;
    for (const project of Object.values(BUILDING_UPGRADE_PROJECTS)) {
        const ability = project?.abilities?.[abilityId];
        if (ability) return ability;
    }
    return null;
}
