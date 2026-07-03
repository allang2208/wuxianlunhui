/**
 * PerceptionSystem — 敌人感知子系统
 *
 * 职责：
 * 1. 扫描并选择最佳目标（玩家或敌对实体）
 * 2. 视线检测（LOS）与最后已知位置记忆
 * 3. 威胁表管理与衰减
 * 4. 搜索行为（失去目标后的目标预测）
 *
 * 设计原则：
 * - 不直接调用其他系统，只操作 enemy 实例属性
 * - 统一接口：update(enemy, dt, entities)
 * - 用 entity._faction === 'player' 检测玩家，避免 instanceof 循环导入
 */

import { MathUtils } from '../config/math-utils.js';
import aiConfigData from '../../data/ai-config.json';

/** 感知优先级权重配置 */
const PERCEPTION_WEIGHTS = {
    DISTANCE: 1.0,        // 距离越近优先级越高
    THREAT: 0.5,          // 威胁值越高优先级越高
    IS_PLAYER: 2.0,       // 玩家目标优先
    HP_RATIO: 0.3         // 血量越低优先级越高（收割残血）
};

/** 默认感知参数 */
const DEFAULT_PERCEPTION = {
    alertRange: 400,          // 警戒范围（像素）
    losCheckInterval: 200,    // 视线检测间隔（ms）
    memoryDuration: 6000,     // 记忆持续时间（ms）
    searchDuration: 4000,     // 搜索持续时间（ms）
    scanInterval: 500,        // 全图扫描间隔（ms）
    threatDecayRate: 5        // 威胁衰减速率
};

class PerceptionSystemImpl {
    constructor() {
        // 缓存每帧的扫描结果，避免同一帧内重复扫描
        this._scanCache = new Map();
    }

    /**
     * 主更新入口
     * @param {Enemy} enemy - 敌人实例
     * @param {number} dt - 时间间隔（ms）
     * @param {Map|Array} entities - 实体集合
     */
    update(enemy, dt, entities) {
        if (!enemy || !enemy.active) return;

        // 初始化感知属性（首次运行时）
        this._ensurePerceptionState(enemy);

        // 1. 更新视线检测冷却
        enemy._perception.losTimer -= dt;

        // 2. 更新目标状态
        this._updateTargetState(enemy, dt, entities);

        // 3. 更新威胁衰减
        this._updateThreatDecay(enemy, dt);

        // 4. 更新搜索行为
        this._updateSearchBehavior(enemy, dt);
    }

    // ==================== 目标管理 ====================

    /**
     * 更新目标状态：检测、记忆、切换
     * @private
     */
    _updateTargetState(enemy, dt, entities) {
        const p = enemy._perception;
        const currentTarget = enemy.target;

        // 当前目标是否仍然有效
        const isTargetValid = currentTarget && currentTarget.active;

        if (isTargetValid) {
            // 检测视线
            const hasLOS = this._checkLineOfSight(enemy, currentTarget);

            if (hasLOS) {
                // 有视线：更新记忆位置，重置遗忘计时器
                enemy._lastKnownTargetPos = { x: currentTarget.x, y: currentTarget.y };
                enemy._lostSightTimer = 0;
                p.lastSeenTime = Date.now();
            } else {
                // 失去视线：累加遗忘计时器
                // 战术小队成员在共享视野有效期内不清除目标，也不累加遗忘计时器
                if (enemy._tacticalRole && enemy._sharedTargetTimer > 0) {
                    enemy._lostSightTimer = 0;
                } else {
                    enemy._lostSightTimer += dt;
                }

                // 普通敌人失去视线超过记忆持续时间则放弃目标
                // 战术小队成员由 TacticalSquadAI 接管，不在这里清除
                if (!enemy._tacticalRole && enemy._lostSightTimer > p.memoryDuration) {
                    this._clearTarget(enemy);
                }
            }
        } else {
            // 目标无效，尝试寻找新目标
            this._clearTarget(enemy);
            const newTarget = this._findBestTarget(enemy, entities);
            if (newTarget) {
                enemy.target = newTarget;
                enemy._lastKnownTargetPos = { x: newTarget.x, y: newTarget.y };
                enemy._lostSightTimer = 0;
            }
        }

        // 定期扫描：即使已有目标，也检查是否有更高优先级的目标
        p.scanTimer -= dt;
        if (p.scanTimer <= 0 && enemy.target) {
            p.scanTimer = p.scanInterval;
            const betterTarget = this._findBetterTarget(enemy, entities);
            if (betterTarget && betterTarget !== enemy.target) {
                // 只有当新目标明显更优时才切换（避免目标跳来跳去）
                const currentScore = this._evaluateTarget(enemy, enemy.target);
                const newScore = this._evaluateTarget(enemy, betterTarget);
                if (newScore > currentScore * 1.3) {
                    enemy.target = betterTarget;
                    enemy._lastKnownTargetPos = { x: betterTarget.x, y: betterTarget.y };
                    enemy._lostSightTimer = 0;
                }
            }
        }
    }

    /**
     * 寻找最佳目标
     * @private
     */
    _findBestTarget(enemy, entities) {
        let bestTarget = null;
        let bestScore = -Infinity;
        const alertRange = enemy._alertRange || DEFAULT_PERCEPTION.alertRange;

        for (const entity of entities.values()) {
            if (!this._isValidTarget(enemy, entity)) continue;

            const dist = MathUtils.distance(enemy.x, enemy.y, entity.x, entity.y);
            if (dist > alertRange) continue;

            // 快速过滤：超出警戒范围的目标不考虑
            const score = this._evaluateTarget(enemy, entity, dist);
            if (score > bestScore) {
                bestScore = score;
                bestTarget = entity;
            }
        }

        return bestTarget;
    }

    /**
     * 寻找比当前目标更优的目标
     * @private
     */
    _findBetterTarget(enemy, entities) {
        let bestTarget = null;
        let bestScore = -Infinity;
        const alertRange = enemy._alertRange || DEFAULT_PERCEPTION.alertRange;

        for (const entity of entities.values()) {
            if (!this._isValidTarget(enemy, entity)) continue;
            if (entity === enemy.target) continue;

            const dist = MathUtils.distance(enemy.x, enemy.y, entity.x, entity.y);
            if (dist > alertRange) continue;

            const score = this._evaluateTarget(enemy, entity, dist);
            if (score > bestScore) {
                bestScore = score;
                bestTarget = entity;
            }
        }

        return bestTarget;
    }

    /**
     * 评估目标优先级
     * @private
     */
    _evaluateTarget(enemy, target, precomputedDist) {
        const dist = precomputedDist !== undefined
            ? precomputedDist
            : MathUtils.distance(enemy.x, enemy.y, target.x, target.y);

        const alertRange = enemy._alertRange || DEFAULT_PERCEPTION.alertRange;

        // 基础分数：距离越近越高（归一化到 0~1）
        let score = (1 - Math.min(dist / alertRange, 1)) * PERCEPTION_WEIGHTS.DISTANCE;

        // 玩家目标加成
        if (target._faction === 'player') {
            score += PERCEPTION_WEIGHTS.IS_PLAYER;
        }

        // 威胁值加成
        if (enemy._threatTable && enemy._threatTable.has(target.id)) {
            const threatEntry = enemy._threatTable.get(target.id);
            const threatScore = Math.min(threatEntry.threat / 100, 1) * PERCEPTION_WEIGHTS.THREAT;
            score += threatScore;
        }

        // 残血加成（收割残血目标）
        if (target.hp !== undefined && target.maxHp !== undefined && target.maxHp > 0) {
            const hpRatio = target.hp / target.maxHp;
            score += (1 - hpRatio) * PERCEPTION_WEIGHTS.HP_RATIO;
        }

        // 视线加成：有直接视线的目标优先
        if (this._checkLineOfSight(enemy, target)) {
            score += 0.5;
        }

        return score;
    }

    // ==================== 视线检测 ====================

    /**
     * 检查与目标之间是否有视线
     * 带缓存机制，避免每帧多次检测同一目标
     * @private
     */
    _checkLineOfSight(enemy, target) {
        if (!target) return false;

        const p = enemy._perception;

        // 视线检测有冷却，使用上一次的检测结果
        if (p.losTimer > 0 && p.lastLOSTargetId === target.id) {
            return p.lastLOSResult;
        }

        p.losTimer = p.losCheckInterval;
        p.lastLOSTargetId = target.id;

        // 使用 WallSystem 检测视线阻挡
        if (typeof WallSystem !== 'undefined' && WallSystem.blocked) {
            const blocked = WallSystem.blocked(enemy.x, enemy.y, target.x, target.y);
            p.lastLOSResult = !blocked;
            return !blocked;
        }

        // 无 WallSystem 时默认有视线
        p.lastLOSResult = true;
        return true;
    }

    // ==================== 搜索行为 ====================

    /**
     * 更新搜索行为：失去目标后在最后已知位置附近搜索
     * @private
     */
    _updateSearchBehavior(enemy, dt) {
        if (enemy.target) {
            // 有目标时不搜索
            enemy._searchTarget = null;
            return;
        }

        if (!enemy._lastKnownTargetPos) {
            enemy._searchTarget = null;
            return;
        }

        const p = enemy._perception;

        // 初始化搜索状态
        if (!enemy._searchTarget) {
            enemy._searchTarget = {
                x: enemy._lastKnownTargetPos.x,
                y: enemy._lastKnownTargetPos.y,
                timer: 0,
                phase: 'moveToLastKnown', // moveToLastKnown | searchAround | giveUp
                searchPoints: []
            };
        }

        const search = enemy._searchTarget;
        search.timer += dt;

        switch (search.phase) {
            case 'moveToLastKnown': {
                // 前往最后已知位置
                const dist = MathUtils.distance(enemy.x, enemy.y, search.x, search.y);
                if (dist < 20) {
                    // 到达最后已知位置，开始周围搜索
                    search.phase = 'searchAround';
                    search.timer = 0;
                    // 生成搜索点：围绕最后已知位置的几个点
                    search.searchPoints = this._generateSearchPoints(search.x, search.y, 60);
                }
                break;
            }
            case 'searchAround': {
                // 在周围搜索
                if (search.searchPoints.length > 0) {
                    const nextPoint = search.searchPoints[0];
                    const dist = MathUtils.distance(enemy.x, enemy.y, nextPoint.x, nextPoint.y);
                    if (dist < 15) {
                        // 到达搜索点，移除
                        search.searchPoints.shift();
                    }
                } else if (search.timer > p.searchDuration) {
                    // 搜索时间耗尽，放弃
                    search.phase = 'giveUp';
                }
                break;
            }
            case 'giveUp': {
                // 放弃搜索，清除记忆
                enemy._lastKnownTargetPos = null;
                enemy._searchTarget = null;
                break;
            }
        }
    }

    /**
     * 生成搜索点（围绕中心点的几个随机偏移位置）
     * @private
     */
    _generateSearchPoints(cx, cy, radius) {
        const points = [];
        const count = 4 + Math.floor(Math.random() * 3); // 4~6 个搜索点
        for (let i = 0; i < count; i++) {
            const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
            const r = radius * (0.5 + Math.random() * 0.5);
            points.push({
                x: cx + Math.cos(angle) * r,
                y: cy + Math.sin(angle) * r
            });
        }
        // 随机打乱顺序
        for (let i = points.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [points[i], points[j]] = [points[j], points[i]];
        }
        return points;
    }

    // ==================== 威胁系统 ====================

    /**
     * 添加威胁值（被攻击时调用）
     * @param {Enemy} enemy - 敌人实例
     * @param {Entity} source - 攻击来源
     * @param {number} amount - 威胁值
     */
    addThreat(enemy, source, amount) {
        if (!source || !source.id || amount <= 0) return;

        this._ensureThreatTable(enemy);

        const entry = enemy._threatTable.get(source.id) || { threat: 0, lastAttackTime: 0, entity: source };
        entry.threat += amount;
        entry.lastAttackTime = Date.now();
        entry.entity = source;
        enemy._threatTable.set(source.id, entry);
    }

    /**
     * 获取最高威胁目标
     * @param {Enemy} enemy - 敌人实例
     * @returns {Entity|null}
     */
    getHighestThreatTarget(enemy) {
        if (!enemy._threatTable || enemy._threatTable.size === 0) return null;

        let highestId = null;
        let highestThreat = -Infinity;

        for (const [id, entry] of enemy._threatTable) {
            // 跳过不存在的实体
            if (!entry.entity || !entry.entity.active) continue;
            if (entry.threat > highestThreat) {
                highestThreat = entry.threat;
                highestId = id;
            }
        }

        return highestId ? enemy._threatTable.get(highestId).entity : null;
    }

    /**
     * 更新威胁衰减
     * @private
     */
    _updateThreatDecay(enemy, dt) {
        if (!enemy._threatTable || enemy._threatTable.size === 0) return;

        const decayRate = enemy._threatDecayRate || DEFAULT_PERCEPTION.threatDecayRate || 5;
        const timeScale = dt / 16; // 以 16ms 为基准

        for (const [id, entry] of enemy._threatTable) {
            entry.threat = Math.max(0, entry.threat - decayRate * timeScale);
            if (entry.threat <= 0) {
                enemy._threatTable.delete(id);
            }
        }
    }

    // ==================== 工具方法 ====================

    /**
     * 检查实体是否为有效目标
     * @private
     */
    _isValidTarget(enemy, entity) {
        if (!entity || !entity.active) return false;
        if (entity === enemy) return false;
        // 只针对玩家阵营
        if (entity._faction !== 'player') return false;
        // 需要可受击
        if (entity.hittable === false) return false;
        // 需要位置信息
        if (typeof entity.x !== 'number' || typeof entity.y !== 'number') return false;
        return true;
    }

    /**
     * 清除目标
     * @private
     */
    _clearTarget(enemy) {
        enemy.target = null;
    }

    /**
     * 确保敌人实例有感知状态
     * @private
     */
    _ensurePerceptionState(enemy) {
        if (enemy._perception) return;

        const aiCfg = aiConfigData[enemy.id] || aiConfigData[enemy.name] || {};
        const perceptionCfg = aiCfg.perception || {};

        enemy._perception = {
            alertRange: perceptionCfg.alertRange || enemy._alertRange || DEFAULT_PERCEPTION.alertRange,
            losCheckInterval: perceptionCfg.losCheckInterval || DEFAULT_PERCEPTION.losCheckInterval,
            memoryDuration: perceptionCfg.memoryDuration || DEFAULT_PERCEPTION.memoryDuration,
            searchDuration: perceptionCfg.searchDuration || DEFAULT_PERCEPTION.searchDuration,
            scanInterval: perceptionCfg.scanInterval || DEFAULT_PERCEPTION.scanInterval,
            losTimer: 0,
            scanTimer: 0,
            lastLOSTargetId: null,
            lastLOSResult: true,
            lastSeenTime: 0
        };

        // 如果敌人没有 _alertRange，使用感知配置中的值
        if (!enemy._alertRange) {
            enemy._alertRange = enemy._perception.alertRange;
        }
    }

    /**
     * 确保敌人实例有威胁表
     * @private
     */
    _ensureThreatTable(enemy) {
        if (!enemy._threatTable) {
            enemy._threatTable = new Map();
        }
        if (!enemy._threatDecayRate) {
            enemy._threatDecayRate = 5;
        }
    }

    // ==================== 外部查询接口 ====================

    /**
     * 获取感知状态摘要（调试用）
     * @param {Enemy} enemy - 敌人实例
     * @returns {Object}
     */
    getPerceptionSummary(enemy) {
        this._ensurePerceptionState(enemy);
        this._ensureThreatTable(enemy);

        const topThreat = this.getHighestThreatTarget(enemy);
        return {
            target: enemy.target ? { id: enemy.target.id, name: enemy.target.name } : null,
            hasLOS: enemy.target ? this._checkLineOfSight(enemy, enemy.target) : false,
            lastKnownPos: enemy._lastKnownTargetPos,
            lostSightTimer: enemy._lostSightTimer,
            threatCount: enemy._threatTable.size,
            topThreat: topThreat
                ? { id: topThreat.id, name: topThreat.name }
                : null,
            isSearching: !!enemy._searchTarget,
            searchPhase: enemy._searchTarget ? enemy._searchTarget.phase : null
        };
    }

    /**
     * 强制重置感知状态
     * @param {Enemy} enemy - 敌人实例
     */
    reset(enemy) {
        enemy._perception = null;
        enemy.target = null;
        enemy._lastKnownTargetPos = null;
        enemy._lostSightTimer = 0;
        enemy._searchTarget = null;
        if (enemy._threatTable) enemy._threatTable.clear();
    }
}

/** 导出单例 */
export const PerceptionSystem = new PerceptionSystemImpl();
