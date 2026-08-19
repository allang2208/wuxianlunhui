// ============================================================
// Building upgrade projects — World-122
// 建筑只引用项目 ID；项目内容与数值统一由 data/building-upgrades.json 提供。
// ============================================================
import projectsData from '../../data/building-upgrades.json';

export const BUILDING_UPGRADE_PROJECTS = projectsData;

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
        upgradeCost: project.moduleUpgrade || buildingCfg.upgradeCost,
        abilityUpgrade: project.abilityUpgrade || buildingCfg.abilityUpgrade,
    };
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
