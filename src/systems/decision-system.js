import { Game } from '../game.js';
import { WallSystem } from '../world/wall-system.js';
/**
 * DecisionSystem — 敌人 AI 决策系统
 *
 * 职责：负责目标选择、攻击时机决策、移动策略、路径重算与卡住检测决策。
 * 设计原则：
 * - 所有决策结果写入 enemy 实例属性，不直接调用其他系统
 * - 通过 enemy 属性与其他系统共享状态
 * - 不使用 instanceof Player，统一使用 _faction 判断阵营
 * - 对全局对象（WallSystem、pathFinder、Game 等）始终使用 typeof 检查
 */

import { MathUtils } from '../config/math-utils.js';
import aiConfigData from '../../data/ai-config.json';

class DecisionSystemImpl {
    constructor() {
        // 决策优化配置
        this._targetScanInterval = 200;
    }

    /**
     * 主更新入口
     * @param {Enemy} enemy — 敌人实例
     * @param {number} dt — 时间间隔（ms）
     * @param {Map|Array} entities — 实体集合
     */
    update(enemy, dt, entities) {
        if (!enemy || !enemy.active) return;
        if (enemy.hp <= 0) return;

        // 眩晕或冲击状态下暂停决策
        if (enemy._dashStunned) return;
        if (typeof enemy.hasStatusEffect === 'function' && enemy.hasStatusEffect('stun')) return;

        // 1. 目标决策：选择并跟踪目标
        this._updateTargetDecision(enemy, dt, entities);

        // 2. 攻击决策：评估攻击时机与可行性
        this._updateAttackDecision(enemy, dt, entities);

        // 3. 移动策略决策：确定移动意图与战术位置
        this._updateMovementDecision(enemy, dt, entities);

        // 4. 路径与卡住检测决策
        this._updatePathDecision(enemy, dt, entities);

        // 5. 战术行为决策（闪避、侧翼、防御姿态）
        this._updateTacticalDecision(enemy, dt, entities);
    }

    // ==================== 目标决策 ====================

    _updateTargetDecision(enemy, dt, entities) {
        // 如果当前目标丢失，扫描新目标
        if (!enemy.target || !enemy.target.active) {
            enemy.target = this._findBestTarget(enemy, entities);
        }

        // 仍然没有目标，重置视线状态
        if (!enemy.target || !enemy.target.active) {
            enemy._lostSightTimer = 0;
            enemy._decisionHasLOS = false;
            return;
        }

        // 视线检测
        const hasLOS = (typeof WallSystem === 'undefined')
            ? true
            : !WallSystem.blocked(enemy.x, enemy.y, enemy.target.x, enemy.target.y);

        enemy._decisionHasLOS = hasLOS;

        if (hasLOS) {
            enemy._lastKnownTargetPos = { x: enemy.target.x, y: enemy.target.y };
            enemy._lostSightTimer = 0;
        } else {
            enemy._lostSightTimer += dt;
            // 非战术角色失去视线超过 6 秒放弃目标
            if (!enemy._tacticalRole && enemy._lostSightTimer > 6000) {
                enemy.target = null;
                enemy._lastKnownTargetPos = null;
            }
        }
    }

    /**
     * 寻找最佳目标
     * 优先级：1）仇恨表最高威胁  2）最近有视线的玩家  3）最近在警戒范围内的玩家
     */
    _findBestTarget(enemy, entities) {
        // 1. 优先从仇恨表找最高威胁目标
        if (enemy._threatTable && enemy._threatTable.size > 0) {
            let maxThreat = -1;
            let threatId = null;
            for (const [id, entry] of enemy._threatTable) {
                if (entry.threat > maxThreat) {
                    maxThreat = entry.threat;
                    threatId = id;
                }
            }
            if (threatId) {
                for (const e of entities.values()) {
                    if (e.id === threatId && e.active && e._faction === 'player') {
                        return e;
                    }
                }
            }
        }

        // 2. 扫描警戒范围内的玩家
        let bestTarget = null;
        let bestScore = -Infinity;
        const alertRange = enemy._alertRange || 400;
        const alertRangeSq = alertRange * alertRange;

        for (const e of entities.values()) {
            if (!e.active) continue;
            if (e._faction !== 'player') continue;

            const dx = e.x - enemy.x;
            const dy = e.y - enemy.y;
            const distSq = dx * dx + dy * dy;

            if (distSq > alertRangeSq) continue;

            // 检查视线
            const hasLOS = (typeof WallSystem === 'undefined')
                ? true
                : !WallSystem.blocked(enemy.x, enemy.y, e.x, e.y);

            // 有视线的目标大幅加分
            const score = hasLOS ? -distSq : -distSq - 1000000;

            if (score > bestScore) {
                bestScore = score;
                bestTarget = e;
            }
        }

        return bestTarget;
    }

    // ==================== 攻击决策 ====================

    _updateAttackDecision(enemy, dt, entities) {
        // 重置攻击决策标记
        enemy._decisionShouldAttack = false;
        enemy._decisionAttackTargetX = 0;
        enemy._decisionAttackTargetY = 0;
        enemy._decisionAttackType = null;

        if (!enemy.target || !enemy.target.active) return;

        // 累加 AI 计时器
        enemy.aiTimer += dt;
        if (enemy.aiTimer < enemy.aiInterval) return;

        // 选择可用的攻击方式
        const attack = enemy.attacks.ranged || enemy.attacks.melee;
        if (!attack || !attack.canUse()) return;

        const targetX = enemy.target.x;
        const targetY = enemy.target.y;

        // 检查攻击距离
        const dx = targetX - enemy.x;
        const dy = targetY - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const attackRange = enemy.attackRange || 70;
        if (dist > attackRange * 1.2) return;

        // 检查视线阻挡
        const isBlocked = (typeof WallSystem !== 'undefined')
            && WallSystem.blocked(enemy.x, enemy.y, targetX, targetY);
        if (isBlocked) return;

        // 设置攻击决策
        enemy._decisionShouldAttack = true;
        enemy._decisionAttackTargetX = targetX;
        enemy._decisionAttackTargetY = targetY;
        enemy._decisionAttackType = enemy.attacks.ranged ? 'ranged' : 'melee';
    }

    // ==================== 移动策略决策 ====================

    _updateMovementDecision(enemy, dt, entities) {
        enemy._decisionShouldMove = false;

        // 无目标但有最后已知位置：继续追击
        if (!enemy.target || !enemy.target.active) {
            if (enemy._lastKnownTargetPos) {
                enemy._decisionMoveToX = enemy._lastKnownTargetPos.x;
                enemy._decisionMoveToY = enemy._lastKnownTargetPos.y;
                enemy._decisionShouldMove = true;
            } else if (enemy._searchTarget) {
                // 搜索模式目标
                enemy._decisionMoveToX = enemy._searchTarget.x;
                enemy._decisionMoveToY = enemy._searchTarget.y;
                enemy._decisionShouldMove = true;
            }
            return;
        }

        const dx = enemy.target.x - enemy.x;
        const dy = enemy.target.y - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // 更新朝向（即使不移动也要面向目标）
        enemy.rotation = Math.atan2(dy, dx);

        // 战术目标优先级最高（来自 TacticalSquadAI 或 BattleCommander）
        if (enemy._tacticalTarget) {
            enemy._decisionMoveToX = enemy._tacticalTarget.x;
            enemy._decisionMoveToY = enemy._tacticalTarget.y;
            enemy._decisionShouldMove = true;
            return;
        }

        // BattleCommander 全局战术指令
        if (typeof Game !== 'undefined' && Game._battleCommander) {
            const tp = Game._battleCommander.getTarget(enemy.id);
            if (tp) {
                enemy._decisionMoveToX = tp.targetX;
                enemy._decisionMoveToY = tp.targetY;
                enemy._decisionShouldMove = true;
                return;
            }
        }

        // 默认：向目标移动，进入攻击范围后停止
        enemy._decisionMoveToX = enemy.target.x;
        enemy._decisionMoveToY = enemy.target.y;
        enemy._decisionShouldMove = dist > (enemy.attackRange || 70);
    }

    // ==================== 路径与卡住检测决策 ====================

    _updatePathDecision(enemy, dt, entities) {
        // 初始化卡住检测状态
        if (enemy._stuckTimer === undefined) enemy._stuckTimer = 0;
        if (enemy._lastX === undefined) enemy._lastX = enemy.x;
        if (enemy._lastY === undefined) enemy._lastY = enemy.y;

        enemy._stuckTimer += dt;
        const movedDist = Math.sqrt((enemy.x - enemy._lastX) ** 2 + (enemy.y - enemy._lastY) ** 2);

        if (enemy._stuckTimer >= 500) {
            if (movedDist < 3) {
                // 卡住：尝试寻路
                if (enemy.target && typeof pathFinder !== 'undefined') {
                    enemy._path = pathFinder.findPath(
                        enemy.x, enemy.y,
                        enemy.target.x, enemy.target.y,
                        enemy.collisionRadius || 12
                    );
                    enemy._pathIdx = 0;
                }
                // 寻路失败则设置逃逸方向（由移动系统执行）
                if (!enemy._path) {
                    const ra = Math.random() * Math.PI * 2;
                    enemy._decisionStuckEscape = true;
                    enemy._decisionStuckEscapeAngle = ra;
                } else {
                    enemy._decisionStuckEscape = false;
                }
            } else {
                enemy._decisionStuckEscape = false;
            }
            enemy._stuckTimer = 0;
            enemy._lastX = enemy.x;
            enemy._lastY = enemy.y;
        }
    }

    // ==================== 战术行为决策 ====================

    _updateTacticalDecision(enemy, dt, entities) {
        // 更新闪避计时器（用于步枪手等角色的横向机动）
        if (enemy._evadeTimer !== undefined) {
            enemy._evadeTimer -= dt;
            if (enemy._evadeTimer <= 0) {
                enemy._evadeTimer = 1000 + Math.random() * 1000;
                enemy._evadeDirection = Math.random() > 0.5 ? 1 : -1;
                enemy._evadeOffset = 10 + Math.random() * 20;
            }
        }

        // 更新侧翼角度（用于侧翼角色）
        if (enemy._flankAngle !== undefined) {
            enemy._flankAngle += 0.3 * (dt / 1000);
        }

        // 盾卫防御姿态决策
        if (enemy._tacticalRole === 'shieldBearer') {
            const isPlayerRanged = this._isPlayerUsingRanged(enemy.target);
            const distToTarget = enemy.target
                ? Math.sqrt((enemy.target.x - enemy.x) ** 2 + (enemy.target.y - enemy.y) ** 2)
                : Infinity;

            if (isPlayerRanged && distToTarget < 500) {
                if (!enemy._shieldDefenseActive) {
                    enemy._shieldDefenseActive = true;
                    if (!enemy._originalMaxSpeed) enemy._originalMaxSpeed = enemy.maxSpeed;
                    enemy.maxSpeed = enemy._originalMaxSpeed * 0.5;
                }
            } else {
                if (enemy._shieldDefenseActive) {
                    enemy._shieldDefenseActive = false;
                    if (enemy._originalMaxSpeed) enemy.maxSpeed = enemy._originalMaxSpeed;
                }
            }
        }
    }

    /**
     * 检查目标是否正在使用远程武器
     * @param {Combatant} player — 玩家实例
     * @returns {boolean}
     */
    _isPlayerUsingRanged(player) {
        if (!player || !player.equipments) return false;
        for (const slot of ['weapon', 'offhand', 'weapon2', 'ring2']) {
            const equip = player.equipments[slot];
            if (!equip) continue;
            const wt = equip.weaponType;
            const rt = equip.rangedType;
            if (wt === 'pkm' || wt === 'akm' || wt === 'qbz191' || wt === 'qjb201' ||
                wt === 'pistol' || wt === 'bow' || wt === 'energy_lmg' || wt === 'deagle' || wt === 'p4040' ||
                rt === 'pistol' || rt === 'machine_gun' || rt === 'rifle' || rt === 'shotgun') {
                return true;
            }
        }
        return false;
    }
}

export const DecisionSystem = new DecisionSystemImpl();
