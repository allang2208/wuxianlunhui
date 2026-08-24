import { COMBAT_CONFIG } from '../config/combat-config.js';
import { deriveEnemyBaseStats, deriveEnemyCombatLevel } from '../config/enemy-base-stats.js';

export const CodexFormulaHelper = {
    /**
     * 根据敌人六维与公式计算图鉴展示用的战斗属性
     * @param {Object} d - 敌人数据（从 data-loader 转换后的 ENEMY_DATA）
     * 与 Enemy.calculateCombatStats() 保持同一口径。
     * Enemy 当前只允许 atk/matk/mdef 显式覆盖；def/crit/critRes 均由六维公式计算。
     * @returns {{atk:number, def:number, matk:number, mdef:number, crit:number, critRes:number, level:number, combatLevel:number}}
     */
    calculateCombatStats(d = {}) {
        const stats = deriveEnemyBaseStats(d, d);
        return { ...stats, combatLevel: deriveEnemyCombatLevel(d, d).combatLevel };
    },

    /** 图鉴综合战斗等级分项，和 deriveEnemyBaseStats.combatLevel 使用同一公式。 */
    calculateCombatLevelBreakdown(d = {}) {
        return deriveEnemyCombatLevel(d, d);
    },

    /** 与 Enemy 构造器的常规移动速度初始化保持一致（不含阶段/技能临时倍率）。 */
    calculateEffectiveSpeed(d = {}) {
        const defaults = COMBAT_CONFIG.enemyDefaults || {};
        const defaultSpeed = (defaults.speed ?? 45) * (defaults.speedMultiplier ?? 1);
        let speed = Number.isFinite(Number(d.speed)) ? Number(d.speed) : defaultSpeed;
        if (speed > 0 && speed < 1) speed = 45;
        const globalMultiplier = defaults.globalSpeedMultiplier ?? 1;
        if (speed > 0 && globalMultiplier !== 1) {
            speed = Math.round(speed * globalMultiplier * 100) / 100;
        }
        return { speed, configuredSpeed: Number(d.speed), globalMultiplier };
    }
};

export default CodexFormulaHelper;
