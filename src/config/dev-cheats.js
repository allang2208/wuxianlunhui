/**
 * 开发调试开关（dev-tools 技能页签按钮控制）：
 * `window.Game._devNoSkillCost = true` → 技能无冷却、无任何资源消耗（MP/体力）。
 */
export const isSkillCheatEnabled = () => !!(typeof window !== 'undefined' && window.Game && window.Game._devNoSkillCost);
