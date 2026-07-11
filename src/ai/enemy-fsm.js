import { Renderer } from '../world/renderer.js';
/**
 * EnemyFSM - 敌人有限状态机（FSM）框架
 * Phase 1：实现阶段切换系统（Boss血量阶段）
 *
 * 每帧由 enemy.js 的 update() 调用，根据血量百分比切换阶段
 * 阶段效果只应用一次，通过 _phaseEffectsApplied 记录
 */

/**
 * 阶段切换视觉特效：简单的脉冲光圈
 */
class PhaseChangeEffect {
    constructor(x, y, phaseName) {
        this.x = x;
        this.y = y;
        this.phaseName = phaseName;
        this.life = 800;
        this.maxLife = 800;
        this.active = true;
        this.maxRadius = 60;
    }

    update(dt = 16.67) {
        this.life -= dt;
        if (this.life <= 0) this.active = false;
    }

    render(ctx) {
        const progress = 1 - this.life / this.maxLife;
        const currentRadius = this.maxRadius * progress;
        if (currentRadius <= 0) return;

        // 需要 Renderer 将世界坐标转为屏幕坐标
        const screenPos = typeof Renderer !== 'undefined'
            ? Renderer.worldToScreen(this.x, this.y)
            : { x: this.x, y: this.y };

        ctx.save();
        // 阶段颜色：愤怒=橙红，狂暴=深红，普通=白色
        let color = '255, 255, 255';
        if ((this.phaseName || '').includes('愤怒')) color = '255, 120, 60';
        if ((this.phaseName || '').includes('狂暴')) color = '220, 40, 40';

        ctx.strokeStyle = `rgba(${color}, ${0.8 * (1 - progress)})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, currentRadius, 0, Math.PI * 2);
        ctx.stroke();

        // 内圈发光
        ctx.fillStyle = `rgba(${color}, ${0.15 * (1 - progress)})`;
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, currentRadius * 0.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

export class EnemyFSM {
    constructor(config = {}) {
        this.phases = config.phases || [];     // 阶段数组
        // 按血量阈值降序排序，确保阶段触发顺序正确
        this.phases.sort((a, b) => b.hpThreshold - a.hpThreshold);
        this.currentPhase = -1;                  // 当前阶段索引（-1表示未初始化）
        this._phaseEffectsApplied = {};         // 记录已应用的阶段效果（避免重复）
    }

    /**
     * 每帧调用，由 enemy.js 的 update() 调用
     * @param {number} dt - 时间间隔（ms）
     * @param {Enemy} enemy - 敌人实例
     * @param {Map|Array} entities - 实体集合
     */
    update(dt, enemy, entities) {
        this._checkPhaseTransition(enemy);
    }

    /**
     * 检查阶段切换：根据血量百分比，从当前阶段+1开始遍历
     * 一旦满足条件，立即切换并应用新阶段效果
     * @param {Enemy} enemy - 敌人实例
     */
    _checkPhaseTransition(enemy) {
        if (!enemy || enemy.maxHp <= 0) return;
        const hpRatio = enemy.hp / enemy.maxHp;

        // 找到当前血量对应的正确阶段（phases已按hpThreshold降序排列）
        let targetPhase = -1;
        for (let i = 0; i < this.phases.length; i++) {
            if (hpRatio <= this.phases[i].hpThreshold) {
                targetPhase = i;
            } else {
                break;
            }
        }

        if (targetPhase !== this.currentPhase) {
            // 回退旧阶段效果
            if (this.currentPhase >= 0) {
                this._revertPhase(enemy, this.phases[this.currentPhase]);
            }
            this.currentPhase = targetPhase;
            // 应用新阶段效果
            if (this.currentPhase >= 0) {
                this._applyPhase(enemy, this.phases[this.currentPhase]);
            }
        }
    }

    /**
     * 回退阶段效果
     * @param {Enemy} enemy - 敌人实例
     * @param {object} phase - 阶段配置对象
     */
    _revertPhase(enemy, phase) {
        if (!this._phaseEffectsApplied[phase.name]) return;
        delete this._phaseEffectsApplied[phase.name];

        // 恢复基础速度
        if (phase.speedMul && enemy._baseSpeed) {
            enemy.maxSpeed = enemy._baseSpeed;
        }
        // 恢复基础攻击间隔
        if (phase.attackSpeedMul > 0 && enemy._baseAiInterval) {
            enemy.aiInterval = enemy._baseAiInterval;
        }
        // 恢复基础攻击范围
        if (phase.attackRangeMul && enemy._baseAttackRange) {
            enemy.attackRange = enemy._baseAttackRange;
        }
        // 移除阶段技能
        if (phase.newSkill && enemy._phaseSkills) {
            enemy._phaseSkills.delete(phase.newSkill);
        }
    }

    /**
     * 应用阶段效果（只应用一次）
     * 通过 _phaseEffectsApplied 对象记录已应用的阶段
     * @param {Enemy} enemy - 敌人实例
     * @param {object} phase - 阶段配置对象
     */
    _applyPhase(enemy, phase) {
        if (this._phaseEffectsApplied[phase.name]) return;
        this._phaseEffectsApplied[phase.name] = true;

        // 速度倍率
        if (phase.speedMul && enemy._baseSpeed) {
            enemy.maxSpeed = enemy._baseSpeed * phase.speedMul;
        }
        // 攻击间隔倍率（攻击速度越快，间隔越短）
        if (phase.attackSpeedMul > 0 && enemy._baseAiInterval) {
            enemy.aiInterval = enemy._baseAiInterval / phase.attackSpeedMul;
        }
        // 攻击范围倍率
        if (phase.attackRangeMul && enemy._baseAttackRange) {
            enemy.attackRange = enemy._baseAttackRange * phase.attackRangeMul;
        }
        // 新增技能标记
        if (phase.newSkill) {
            enemy._phaseSkills = enemy._phaseSkills || new Set();
            enemy._phaseSkills.add(phase.newSkill);
        }
        // 视觉提示：触发阶段切换特效
        if (typeof enemy.onPhaseChange === 'function') {
            enemy.onPhaseChange(phase);
        }
    }
}

export { PhaseChangeEffect };
