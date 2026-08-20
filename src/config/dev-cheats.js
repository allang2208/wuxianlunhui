/**
 * 开发调试开关（dev-tools 技能页签按钮控制）：
 * `window.Game._devNoSkillCost = true` → 技能无冷却、无任何资源消耗（MP/体力）。
 */
export const isSkillCheatEnabled = () => !!(typeof window !== 'undefined' && window.Game && window.Game._devNoSkillCost);

/**
 * 统一经济调试开关：建筑放置、单位生产和建筑升级项目均不消耗金币/能源。
 * 人口上限、生产计时、出口碰撞和升级读条仍按正式规则执行。
 */
export const isInfiniteResourcesEnabled = () => !!(
    typeof window !== 'undefined' && window.Game && window.Game._devInfiniteResources
);
