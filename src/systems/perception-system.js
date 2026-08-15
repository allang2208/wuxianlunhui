import { WallSystem } from '../world/wall-system.js';
import { distanceToEntityShape } from '../utils/collision-helpers.js';
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
import SpatialPartitionSystem from './spatial-partition-system.js';

/** 感知优先级权重配置 */
const PERCEPTION_WEIGHTS = {
    DISTANCE: 1.0,        // 距离越近优先级越高
    THREAT: 0.5,          // 威胁值越高优先级越高
    IS_PLAYER: 2.0,       // 玩家目标优先
    HP_RATIO: 0.3         // 血量越低优先级越高（收割残血）
};

/** [PERF] 第二级 LOS 精评的候选上限：只对基础分 top-K 候选做 WallSystem 射线检测 */
const LOS_TOP_K = 5;

/** [PERF] 降频 tick 间隔（ms）：有有效目标的怪按此节奏跑完整 update 逻辑 */
const PERCEPTION_TICK_INTERVAL = 100;

/** 默认感知参数 */
const DEFAULT_PERCEPTION = {
    alertRange: 1500,         // 警戒范围（像素）
    losCheckInterval: 200,    // 视线检测间隔（ms）
    memoryDuration: 6000,     // 记忆持续时间（ms）
    searchDuration: 4000,     // 搜索持续时间（ms）
    scanInterval: 500,        // 全图扫描间隔（ms）
    threatDecayRate: 5        // 威胁衰减速率
};

class PerceptionSystemImpl {
    constructor() {
    }

    /**
     * 主更新入口
     * @param {Enemy} enemy - 敌人实例
     * @param {number} dt - 时间间隔（ms）
     * @param {Map|Array} entities - 实体集合
     */
    update(enemy, dt, entities) {
        if (!enemy || !enemy.active) return;
        // 入侵特工（时空特工追击机制）：目标由自身类内最近敌对逻辑接管，感知系统不覆写
        if (enemy._invasionAgent) return;

        // 初始化感知属性（首次运行时）
        this._ensurePerceptionState(enemy);

        // [PERF] 降频：有有效目标且非战术小队的怪每 100ms tick 一次，不足直接返回；
        // 计时器类字段（遗忘/重扫/威胁衰减/搜索）统一按累加的 dt 结算，结果与逐帧等价。
        // 无目标的怪保持每帧跑以便尽快重选；战术小队由 TacticalSquadAI 接管目标，保持每帧跑
        if (enemy.target && enemy.target.active && !enemy._tacticalRole) {
            const p = enemy._perception;
            p.tickTimer += dt;
            if (p.tickTimer < PERCEPTION_TICK_INTERVAL) return;
            dt = p.tickTimer;
            p.tickTimer = 0;
        }

        // 1. 更新目标状态
        this._updateTargetState(enemy, dt, entities);

        // 2. 更新威胁衰减
        this._updateThreatDecay(enemy, dt);

        // 3. 更新搜索行为
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
            // A 移动脱离（2026-08-15，世界-122）：防守怪的当前目标是交战单位（非建筑）时，
            // 脱离交战半径 ×1.3 滞回即放弃——下个 tick 重选回落到建筑推进。
            // （原逻辑有视线即永久锁定目标，单位跑出交战圈会被无限追出，违背 A 移动语义）
            if (enemy._preferDefenseTargets && !currentTarget._isDefenseStructure) {
                const leash = (enemy._engageHostileRange ?? 0) * 1.3;
                if (leash && MathUtils.distance(enemy.x, enemy.y, currentTarget.x, currentTarget.y) > leash) {
                    this._clearTarget(enemy);
                    return;
                }
            }
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
                // 防守模式 A 移动（2026-08-15）：当前目标是建筑、新目标是交战单位 →
                // 免滞回直接切换（_findBetterTarget 已被 _isValidTarget 交战半径闸住），
                // 否则怪物拆墙时对贴近的玩家/侍从无动于衷
                const engageSwitch = !!(enemy._preferDefenseTargets
                    && enemy.target._isDefenseStructure && !betterTarget._isDefenseStructure);
                if (engageSwitch || newScore > currentScore * 1.3) {
                    enemy.target = betterTarget;
                    enemy._lastKnownTargetPos = { x: betterTarget.x, y: betterTarget.y };
                    enemy._lostSightTimer = 0;
                }
            }
        }
    }

    /**
     * [PERF] 收集警戒范围内的候选实体：优先走空间分区网格粗筛（queryRadius 按
     * bbox 格迭代，支持防守模式 3800 大半径），网格未重建或来源集合不匹配时
     * 回退原全表扫描
     * @private
     * @returns {Array} 候选实体数组
     */
    _collectCandidates(enemy, entities, alertRange) {
        const sps = SpatialPartitionSystem;
        // 仅当网格存在且就是由本次传入的 entities 重建时才可信，
        // 避免用到其他场景/上一帧的陈旧网格
        if (sps && sps.cells && sps.cells.size > 0 && sps._sourceEntities === entities) {
            return sps.queryRadius(enemy.x, enemy.y, alertRange, enemy);
        }
        // 回退：全表扫描（保持原语义）
        return Array.from(entities.values ? entities.values() : entities);
    }

    /**
     * 寻找最佳目标
     * @private
     */
    _findBestTarget(enemy, entities) {
        const alertRange = enemy._alertRange || DEFAULT_PERCEPTION.alertRange;
        const candidates = this._collectCandidates(enemy, entities, alertRange);

        // [PERF] 第一级粗筛：只算不含 LOS 的基础分（距离/玩家/威胁/残血，权重不变）
        const scored = [];
        for (const entity of candidates) {
            if (!this._isValidTarget(enemy, entity)) continue;

            const dist = MathUtils.distance(enemy.x, enemy.y, entity.x, entity.y);
            // 快速过滤：超出警戒范围的目标不考虑
            if (dist > alertRange) continue;

            scored.push({ entity, score: this._evaluateBaseScore(enemy, entity, dist) });
        }
        if (scored.length === 0) return null;

        // [PERF] 第二级精评：只对基础分 top-K 候选补 LOS 射线检测（+0.5）后定最终选择
        scored.sort((a, b) => b.score - a.score);
        let bestTarget = null;
        let bestScore = -Infinity;
        const k = Math.min(LOS_TOP_K, scored.length);
        for (let i = 0; i < k; i++) {
            let score = scored[i].score;
            if (this._checkLineOfSight(enemy, scored[i].entity)) score += 0.5;
            if (score > bestScore) {
                bestScore = score;
                bestTarget = scored[i].entity;
            }
        }

        return bestTarget;
    }

    /**
     * 寻找比当前目标更优的目标
     * @private
     */
    _findBetterTarget(enemy, entities) {
        const alertRange = enemy._alertRange || DEFAULT_PERCEPTION.alertRange;
        const candidates = this._collectCandidates(enemy, entities, alertRange);

        // [PERF] 第一级粗筛：只算不含 LOS 的基础分
        const scored = [];
        for (const entity of candidates) {
            if (!this._isValidTarget(enemy, entity)) continue;
            if (entity === enemy.target) continue;

            const dist = MathUtils.distance(enemy.x, enemy.y, entity.x, entity.y);
            if (dist > alertRange) continue;

            scored.push({ entity, score: this._evaluateBaseScore(enemy, entity, dist) });
        }
        if (scored.length === 0) return null;

        // [PERF] 第二级精评：只对基础分 top-K 候选补 LOS 射线检测（+0.5）
        scored.sort((a, b) => b.score - a.score);
        let bestTarget = null;
        let bestScore = -Infinity;
        const k = Math.min(LOS_TOP_K, scored.length);
        for (let i = 0; i < k; i++) {
            let score = scored[i].score;
            if (this._checkLineOfSight(enemy, scored[i].entity)) score += 0.5;
            if (score > bestScore) {
                bestScore = score;
                bestTarget = scored[i].entity;
            }
        }

        return bestTarget;
    }

    /**
     * 评估目标优先级（完整分 = 基础分 + 视线加成）
     * 用于滞回比较等需要完整分的场合；批量粗筛请用 _evaluateBaseScore
     * @private
     */
    _evaluateTarget(enemy, target, precomputedDist) {
        let score = this._evaluateBaseScore(enemy, target, precomputedDist);

        // 视线加成：有直接视线的目标优先
        if (this._checkLineOfSight(enemy, target)) {
            score += 0.5;
        }

        return score;
    }

    /**
     * [PERF] 基础评分（不含 LOS）：距离/玩家加成/威胁/残血，权重不变
     * @private
     */
    _evaluateBaseScore(enemy, target, precomputedDist) {
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

        return score;
    }

    // ==================== 视线检测 ====================

    /**
     * 检查与目标之间是否有视线
     * [PERF] per-target 缓存 Map：多候选评估时互不冲刷，TTL（losCheckInterval）内复用结果
     * @private
     */
    _checkLineOfSight(enemy, target) {
        if (!target) return false;

        const p = enemy._perception;
        if (!p.losCache) p.losCache = new Map();

        const now = Date.now();
        const cached = p.losCache.get(target.id);
        if (cached && (now - cached.time) < p.losCheckInterval) {
            return cached.result;
        }

        // [FIX-LOS] 防守结构（掩体/基地）在攻击距离内免 LOS：footprint 贴身即代表可出手，
        // 掩体中心在自身 face 线后方，墙背面射线必被自身/相邻段误挡（与 combat-system 同口径）；
        // 超出射程仍走原射线逻辑
        const _structReach = enemy.attackDistance !== undefined
            ? enemy.attackDistance
            : (enemy.attackRange ? enemy.attackRange * 1.15 : 0);
        if (target._isDefenseStructure && _structReach > 0
            && distanceToEntityShape(target, enemy.x, enemy.y) <= _structReach) {
            p.losCache.set(target.id, { result: true, time: now });
            return true;
        }

        // 无 WallSystem 时默认有视线
        let result = true;
        if (WallSystem && WallSystem.blocked) {
            // 掩体目标忽略自身 face 墙段：从墙背面接近时射线必穿自身线段，
            // 不忽略会永远判"无视线"导致 CombatSystem 拒绝对掩体出手
            const ignore = target._coverSeg ? { segs: new Set([target._coverSeg]) } : null;
            result = !WallSystem.blocked(enemy.x, enemy.y, target.x, target.y, ignore);
        }

        // 缓存兜底：异常膨胀时整体清空重建（玩家阵营目标数量有限，正常不会触发）
        if (p.losCache.size > 64) p.losCache.clear();
        p.losCache.set(target.id, { result, time: now });
        return result;
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
            // [SEARCH] 移动系统到达最后已知位置后会清除记忆，但 searchAround 阶段的
            // 巡逻要继续，由搜索计时耗尽后的 giveUp 分支负责清场；其余阶段照常终止搜索
            if (!enemy._searchTarget || enemy._searchTarget.phase !== 'searchAround') {
                enemy._searchTarget = null;
                return;
            }
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
                }
                // [SEARCH] 搜索计时耗尽即放弃（兜底：个别搜索点落在墙内不可达时
                // 也不会永远卡在巡逻里，giveUp 分支统一清场）
                if (search.timer > p.searchDuration) {
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
        // 防守模式（世界-122 进攻波次）：A 移动——建筑任意距离有效；
        // 玩家/侍从等非结构单位仅在沿途交战半径内有效（2026-08-15）
        if (enemy._preferDefenseTargets && !entity._isDefenseStructure) {
            const engageRange = enemy._engageHostileRange ?? 0;
            if (!engageRange) return false;
            if (MathUtils.distance(enemy.x, enemy.y, entity.x, entity.y) > engageRange) return false;
        }
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

        const alertRange = perceptionCfg.alertRange || enemy._alertRange || enemy._aggroRange || DEFAULT_PERCEPTION.alertRange;
        enemy._perception = {
            alertRange,
            losCheckInterval: perceptionCfg.losCheckInterval || DEFAULT_PERCEPTION.losCheckInterval,
            memoryDuration: perceptionCfg.memoryDuration || DEFAULT_PERCEPTION.memoryDuration,
            searchDuration: perceptionCfg.searchDuration || DEFAULT_PERCEPTION.searchDuration,
            scanInterval: perceptionCfg.scanInterval || DEFAULT_PERCEPTION.scanInterval,
            losCache: new Map(),   // [PERF] per-target LOS 缓存: targetId -> {result, time}
            scanTimer: 0,
            tickTimer: 0,          // [PERF] 降频累加器：有有效目标的怪攒够 100ms 才 tick
            lastSeenTime: 0
        };

        // 如果敌人没有 _alertRange，使用感知配置中的值
        if (!enemy._alertRange) {
            enemy._alertRange = alertRange;
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
