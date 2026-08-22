import { Game } from '../game.js';
import { WallSystem } from '../world/wall-system.js';
/**
 * MovementSystem — 敌人移动AI子系统
 * 处理所有敌人的移动逻辑：寻路、路径跟随、墙壁碰撞、击退、闪避、战术移动
 *
 * 设计原则：
 * 1. 不直接调用其他系统，只操作 enemy 实例属性
 * 2. 统一接口 update(enemy, dt, entities)
 * 3. 时间单位：毫秒
 * 4. 状态通过 enemy 属性共享
 */


import { PathManager } from '../ai/path-manager.js';
import { pathFinder } from '../ai/pathfinder.js';
import { dynamicObstacleMap } from '../ai/dynamic-obstacle-map.js';
import SpatialPartitionSystem from './spatial-partition-system.js';
import { distanceToEntityShape } from '../utils/collision-helpers.js';
import { compareDefenseTargets, isDefenseTargetEligible } from '../ai/defense-target-priority.js';
import { BuildingRoadSystem } from '../world/building-road-system.js';
import { verticalRangesOverlap } from '../physics/elevation.js';
import { ElevatedNavigationController } from '../ai/elevated-navigation-controller.js';
import { resolveRtsMoveDestination } from '../ai/rts-command-utils.js';
import { getTributeFriendlyMoveSpeedMul, getFriendlyMoveSpeedAura } from '../config/tribute-effects.js';
import { World125FogTideSystem } from '../world/world125-fog-tide-system.js';

/** 超出此距离不再进行 A* 寻路，直接朝目标移动 */
const MAX_PATHFIND_RANGE = 800;
const resolveWallFor = (entity, x, y, nx, ny, radius) => WallSystem.resolve(
    x, y, nx, ny, radius,
    WallSystem.ignoreForEntity ? WallSystem.ignoreForEntity(entity) : null
);

/**
 * 移动系统核心实现
 */
const MovementSystem = {
    _lastObstacleUpdate: 0,

    /**
     * [PERF-2026-08-03] 每帧寻路预算重置：由 game.js 主循环每帧调用一次。
     * PathFinder 帧预算耗尽后返回 PATH_DEFERRED，怪物保留旧路径下帧重试，
     * 避免刷怪瞬间多只怪同帧冷寻路造成主线程长卡顿。
     */
    beginFrame() {
        if (pathFinder && typeof pathFinder.beginFrame === 'function') {
            pathFinder.beginFrame();
        }
    },

    /**
     * 每帧更新敌人移动状态
     * @param {Enemy} enemy - 敌人实例
     * @param {number} dt - 时间间隔（ms）
     * @param {Map|Array} entities - 实体集合
     */
    update(enemy, dt, entities) {
        if (!enemy || !enemy.active) return;

        // 统一刷新动态障碍图（每帧仅一次，内部有 250ms 节流）
        if (dynamicObstacleMap) {
            const now = Date.now();
            if (now - this._lastObstacleUpdate >= 250) {
                dynamicObstacleMap.update(now);
                this._lastObstacleUpdate = now;
            }
        }

        // 死亡状态不移动
        if (enemy.hp <= 0) {
            enemy.vx = 0;
            enemy.vy = 0;
            enemy.isMoving = false;
            return;
        }

        // 眩晕/冻结状态：强制停止（冻结效果等同于眩晕）
        if (enemy._dashStunned || (enemy.hasStatusEffect && (enemy.hasStatusEffect('stun') || enemy.hasStatusEffect('frozen')))) {
            enemy.vx = 0;
            enemy.vy = 0;
            enemy.isMoving = false;
            return;
        }

        // 束缚状态：无法移动
        if (enemy.hasStatusEffect && enemy.hasStatusEffect('bind')) {
            enemy.vx = 0;
            enemy.vy = 0;
            enemy.isMoving = false;
            return;
        }

        // 施法/召唤动画锁定：禁止移动，避免滑步
        if (enemy._frozenForCast) {
            enemy.vx = 0;
            enemy.vy = 0;
            enemy.isMoving = false;
            return;
        }

        // [GATE-PURSUIT] 防守怪过门追击检查（内部 500ms 节流，2026-08-15 用户要求）
        if (enemy._defenseMonster) this._checkGatePursuit(enemy, dt);

        // 恐惧状态：失控逃跑——强制朝恐惧源相反方向移动（移速按层数削减），不做其他移动决策
        if (enemy.hasStatusEffect && enemy.hasStatusEffect('fear')) {
            const src = enemy._fearSource;
            if (src && src.active) {
                const dx = enemy.x - src.x, dy = enemy.y - src.y;
                const d = Math.hypot(dx, dy) || 1;
                const mul = typeof enemy.getFearSpeedMul === 'function' ? enemy.getFearSpeedMul() : 1;
                const spd = this._getEnemyMoveSpeed(enemy) * mul;
                let fx = dx / d, fy = dy / d;
                const fearAvoid = this._avoidEnergyNodes(enemy, fx, fy, entities);
                fx = fearAvoid.moveX;
                fy = fearAvoid.moveY;
                enemy.vx = fx * spd;
                enemy.vy = fy * spd;
                enemy.isMoving = true;
                // 墙壁解析与正常移动同口径（逃跑不可穿墙）
                const sc = dt / 1000;
                const nx = enemy.x + enemy.vx * sc;
                const ny = enemy.y + enemy.vy * sc;
                if (WallSystem && WallSystem.resolve) {
                    const er = resolveWallFor(enemy, enemy.x, enemy.y, nx, ny, enemy.groundRadius);
                    enemy.x = er.x;
                    enemy.y = er.y;
                } else {
                    enemy.x = nx;
                    enemy.y = ny;
                }
            } else {
                enemy.vx = 0;
                enemy.vy = 0;
                enemy.isMoving = false;
            }
            return;
        }

        // [FIX] 攻击动画锁定：僵尸巫师等攻击动画期间禁止移动
        if (enemy._attackAnimTimer > 0) {
            enemy.vx = 0;
            enemy.vy = 0;
            enemy.isMoving = false;
            return;
        }

        // 处理击退（优先于正常移动）
        if (this._applyKnockback(enemy, dt)) {
            return;
        }

        // [ENHANCE] 初始化 PathManager（懒加载）
        if (!enemy._pathManager) {
            // 动态导入，避免循环依赖
            if (PathManager) {
                enemy._pathManager = new PathManager(enemy);
            }
        }

        // 计算目标方向和距离
        // [ENHANCE] 临时 reposition 目标倒计时
        if (enemy._repositionTimer !== undefined && enemy._repositionTimer > 0) {
            enemy._repositionTimer -= dt;
            if (enemy._repositionTimer <= 0) {
                enemy._repositionTimer = 0;
                if (enemy._tacticalTarget && enemy._tacticalTarget._isReposition) {
                    enemy._tacticalTarget = null;
                }
            }
        }

        const semanticMoveGoal = this._resolveSemanticMoveGoal(enemy);
        const surfaceCommand = enemy._spawnEgress
            ? null
            : ElevatedNavigationController.prepareAutonomousCommand(
                enemy,
                semanticMoveGoal,
                dt
            );
        if (surfaceCommand) {
            const surfaceMove = resolveRtsMoveDestination(enemy, surfaceCommand);
            if (surfaceMove.arrived) {
                ElevatedNavigationController.complete(enemy);
            } else {
                enemy._surfaceNavDestination = surfaceMove.destination;
            }
        }

const moveData = this._computeMoveDirection(enemy, entities);
        if (!moveData) {
            enemy.vx *= enemy.friction || 0.82;
            enemy.vy *= enemy.friction || 0.82;
            enemy.isMoving = false;
            return;
        }

        let { dx, dy, dist } = moveData;

        // [CHARGE-STRAIGHT] 有清晰视线时直接走直线，不依赖路径点（避免被寻路拐角拉偏）
        if (enemy.ai && enemy.ai.chargeStraight && enemy._perception && enemy._perception.hasLOS && enemy._pathManager) {
            enemy._pathManager._clearPath();
        }

        // 更新朝向
        if (dist > 0.1) {
            enemy.rotation = Math.atan2(dy, dx);
        }

        // [ENHANCE] 主动预规划：有目标且路径缺失或路径终点严重偏离目标时，重新计算路径
        // [2026-08-14] 移动目标统一为"战术目标优先，其次攻击目标"——侍从（露娜）用
        // _tacticalTarget 驱动跟随点/施法站位/撤退点，路径必须朝战术点生成而不是敌人。
        const moveGoal = enemy._surfaceNavDestination
            || ((enemy._tacticalTarget && !(enemy.ai && enemy.ai.chargeStraight))
                ? enemy._tacticalTarget
                : (enemy.target && enemy.target.active ? enemy.target : null));
        const groundPathAllowed = !enemy._surfaceRouteActive
            && !enemy._surfaceNavWaiting
            && enemy._surfaceKind !== 'stairs'
            && enemy._surfaceKind !== 'wall_walk';
        if (groundPathAllowed && enemy._pathManager && moveGoal) {
            const targetX = moveGoal.x;
            const targetY = moveGoal.y;
            const distToTarget = Math.sqrt((targetX - enemy.x) ** 2 + (targetY - enemy.y) ** 2);

            // 目标太远时不做全程 A*，避免生成巨大网格造成卡顿
            if (distToTarget > MAX_PATHFIND_RANGE) {
                if (enemy.ai && enemy.ai.chargeStraight) {
                    // [RELAY] 直冲型（胖子僵尸/突变体-3）保持原直线行为，不参与接力
                    enemy._pathManager._clearPath();
                    enemy._relayTarget = null;
                } else if (enemy._circleRadius || enemy._specialTacticalTarget) {
                    // [RELAY] 绕圈/特殊战术单位保持原直线行为（不参与接力）
                    enemy._pathManager._clearPath();
                } else {
                    // [RELAY] 大场景分段接力寻路：超距不再纯直线，逐段 A* 到中继点推进
                    this._updateRelayPath(enemy, targetX, targetY);
                }
            } else {
                let shouldRecalc = !enemy._pathManager.hasValidPath();

                // 路径终点检查：如果路径终点与目标偏差 > 100px，路径已过时，需要重新计算
                if (!shouldRecalc && enemy._pathManager.path) {
                    const pathEnd = enemy._pathManager.path[enemy._pathManager.path.length - 1];
                    const endDx = pathEnd.x - targetX;
                    const endDy = pathEnd.y - targetY;
                    const endDist = Math.sqrt(endDx * endDx + endDy * endDy);
                    if (endDist > 100) {
                        shouldRecalc = true;
                    }
                }

                if (shouldRecalc && (targetX !== enemy.x || targetY !== enemy.y)) {
enemy._pathManager.forceRecalc(pathFinder, targetX, targetY);
                }
            }
        }

        // [ENHANCE] 每帧更新 PathManager：检查路径有效性 + 局部修复
        if (groundPathAllowed && enemy._pathManager && pathFinder) {
enemy._pathManager.update(dt, pathFinder);
        }

        // 卡住检测与寻路触发（保留原有逻辑，作为 fallback）
this._updateStuckDetection(enemy, dt, dx, dy, dist);

        // 路径跟随（使用 PathManager）
        if (groundPathAllowed && enemy._pathManager && enemy._pathManager.hasValidPath()) {
            this._followPath(enemy, dt, entities);
        } else {
            // 正常移动
            this._applyNormalMovement(enemy, dt, dx, dy, dist, entities);
        }

        // [ENHANCE] 攻击范围内渐进减速：冲到更近位置再停车，避免前排一进入范围就堵死
        if (enemy.target && enemy.target.active
            && !enemy._surfaceNavCommand
            && !enemy._surfaceRouteActive) {
            this._applyAttackRangeFriction(enemy, dist);
        }

        // [UNSTUCK] 卡死恢复：长时间未移动时尝试小幅瞬移到合法方向
        this._tryUnstuck(enemy);

        // 更新移动动画状态
        this._updateMovementAnim(enemy, dt);
    },

    /**
     * 返回现有 AI 优先级选出的语义目标。高架规划只读取，不改写这些所有者的目标槽。
     */
    _resolveSemanticMoveGoal(enemy) {
        const chargeStraight = enemy.ai && enemy.ai.chargeStraight;
        if (enemy._spawnEgress && !chargeStraight) return enemy._spawnEgress;
        if (enemy._specialTacticalTarget && !chargeStraight) return enemy._specialTacticalTarget;
        if (enemy._tacticalTarget && !chargeStraight) return enemy._tacticalTarget;
        if (Game && Game._battleCommander && !chargeStraight && !enemy._defenseMonster) {
            const point = Game._battleCommander.getTarget(enemy.id);
            if (point) return { x: point.targetX, y: point.targetY };
        }
        if (enemy.target && enemy.target.active) return enemy.target;
        if (enemy._lastKnownTargetPos) return enemy._lastKnownTargetPos;
        if (enemy._searchTarget?.phase === 'searchAround'
            && enemy._searchTarget.searchPoints?.length) {
            return enemy._searchTarget.searchPoints[0];
        }
        return null;
    },

    /**
     * 计算移动方向（战术目标、战斗指挥官目标、当前目标、最后已知位置、搜索巡逻点）
     * @returns {{dx:number, dy:number, dist:number}|null}
     */
    _computeMoveDirection(enemy, _entities) {
        let tx = 0, ty = 0, hasTarget = false;
        const chargeStraight = enemy.ai && enemy.ai.chargeStraight;

        // 0. 生产建筑离场点：先离开 footprint/出口拥堵区，再接管正常 AI。
        if (enemy._spawnEgress && !chargeStraight) {
            const ex = enemy._spawnEgress.x - enemy.x;
            const ey = enemy._spawnEgress.y - enemy.y;
            if (Math.hypot(ex, ey) <= Math.max(10, enemy.groundRadius * 0.6)) {
                enemy._spawnEgress = null;
            } else {
                tx = enemy._spawnEgress.x;
                ty = enemy._spawnEgress.y;
                hasTarget = true;
            }
        }
        // 0.5 高架路线航点：只覆盖本帧位移目的地，不改写语义目标。
        if (!hasTarget && enemy._surfaceNavDestination && !chargeStraight) {
            tx = enemy._surfaceNavDestination.x;
            ty = enemy._surfaceNavDestination.y;
            hasTarget = true;
        }
        // 1. [FIX] 特殊战术目标（TacticalSquadAI 设置）
        if (!hasTarget && enemy._specialTacticalTarget && !chargeStraight) {
            tx = enemy._specialTacticalTarget.x;
            ty = enemy._specialTacticalTarget.y;
            hasTarget = true;
        }
        // 2. 战术目标
        else if (!hasTarget && enemy._tacticalTarget && !chargeStraight) {
            tx = enemy._tacticalTarget.x;
            ty = enemy._tacticalTarget.y;
            hasTarget = true;
        }
        // 3. 战斗指挥官目标（防守怪不走指挥官——战术点围绕玩家，与防守目标冲突）
        else if (!hasTarget && Game && Game._battleCommander && !chargeStraight && !enemy._defenseMonster) {
            const tp = Game._battleCommander.getTarget(enemy.id);
            if (tp) {
                tx = tp.targetX;
                ty = tp.targetY;
                hasTarget = true;
            }
        }
        // 4. 当前目标
        else if (!hasTarget && enemy.target && enemy.target.active) {
            tx = enemy.target.x;
            ty = enemy.target.y;
            hasTarget = true;
        }
        // 5. 最后已知位置（失去目标后搜索）
        else if (!hasTarget && enemy._lastKnownTargetPos) {
            tx = enemy._lastKnownTargetPos.x;
            ty = enemy._lastKnownTargetPos.y;
            hasTarget = true;
        }
        // 6. [SEARCH] 搜索巡逻：到达最后已知位置后，在周边搜索点间移动一段时间再放弃
        // （战术小队的 _searchTarget 无 phase 字段，不会命中此分支；重新锁定目标后
        // 优先级 3 的目标分支会立即接管，防守怪不会被巡逻拖住）
        else if (!hasTarget && enemy._searchTarget && enemy._searchTarget.phase === 'searchAround'
            && enemy._searchTarget.searchPoints && enemy._searchTarget.searchPoints.length > 0) {
            tx = enemy._searchTarget.searchPoints[0].x;
            ty = enemy._searchTarget.searchPoints[0].y;
            hasTarget = true;
        }

        if (!hasTarget) return null;

        let dx = tx - enemy.x;
        let dy = ty - enemy.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        // [ENHANCE] 近战包抄：当目标正面已被同伴占据时，向侧面偏移寻找攻击位
        // 仅对非远程/非绕圈敌人、且距离尚远时生效，避免攻击时抖动
        if (!enemy._surfaceNavDestination && enemy.target && enemy.target.active
            && dist > (enemy.attackRange || 70) * 0.6 && !enemy._circleRadius
            && !(enemy.ai && enemy.ai.chargeStraight)) {
            const flank = this._computeFlankOffset(enemy, enemy.target, _entities);
            if (flank) {
                tx += flank.dx;
                ty += flank.dy;
                dx = tx - enemy.x;
                dy = ty - enemy.y;
                dist = Math.sqrt(dx * dx + dy * dy);
            }
        }

        // 到达最后已知位置后清除
        if (!enemy.target && enemy._lastKnownTargetPos && dist < 10) {
            enemy._lastKnownTargetPos = null;
            return null;
        }

        return { dx, dy, dist };
    },

    /**
     * [ENHANCE] 计算侧翼偏移：当目标周围已有 ≥2 个同伴时，向人数更少的一侧偏移
     * - 使用平方距离避免每帧开方
     * - 每 200ms 才重新统计一次，中间复用上一次结果
     * - 返回 {dx, dy} 偏移量，若无偏移需要返回 null
     */
    _computeFlankOffset(enemy, target, _entities) {
        const now = Date.now();
        const cooldown = 200;
        // 复用缓存结果，避免每帧遍历全部实体
        if (enemy._flankCache && now - enemy._flankCache.time < cooldown) {
            return enemy._flankCache.value;
        }

        const attackRange = enemy.attackRange || 70;
        const nearbyThresholdSq = (attackRange * 1.3) ** 2;
        let nearbyCount = 0;
        let leftCount = 0, rightCount = 0;
        const cosA = (target.x - enemy.x) / Math.max(1, Math.sqrt((target.x - enemy.x) ** 2 + (target.y - enemy.y) ** 2));
        const sinA = (target.y - enemy.y) / Math.max(1, Math.sqrt((target.x - enemy.x) ** 2 + (target.y - enemy.y) ** 2));

        // [PERF-2026-08-03] 候选优先走空间分区（game.js 每帧重建，取目标周围近邻），
        // 替代每 200ms 遍历全部实体；无分区/未构建时回退全量遍历
        let candidates = null;
        if (SpatialPartitionSystem && typeof SpatialPartitionSystem.queryRadius === 'function') {
            const grid = SpatialPartitionSystem;
            if (!grid.allEntities || grid.allEntities.length > 0) {
                candidates = grid.queryRadius(target.x, target.y, attackRange * 1.3);
            }
        }
        if (!candidates && Game && Game.entities) {
            candidates = Game.entities;
        }
        if (!candidates) {
            enemy._flankCache = { time: now, value: null };
            return null;
        }

        // 性能保护：最多遍历 80 个实体，防止极端场景
        let iterated = 0;
        const maxIterate = 80;
        const iter = candidates.values ? candidates.values() : candidates;
        for (const other of iter) {
            if (++iterated > maxIterate) break;
            if (other === enemy || !other.active || other.hp <= 0) continue;
            if (other._faction !== enemy._faction) continue;
            const odx = other.x - target.x;
            const ody = other.y - target.y;
            const odistSq = odx * odx + ody * ody;
            if (odistSq < nearbyThresholdSq) {
                nearbyCount++;
                // 以目标→敌人为基准，判断同伴在左侧还是右侧
                const cross = cosA * ody - sinA * odx;
                if (cross > 0) leftCount++; else rightCount++;
            }
        }

        let result = null;
        // 同伴不足或开阔房间有清晰视线时不偏移，避免单对单/无障碍时也绕侧
        const hasLOS = enemy._perception && enemy._perception.hasLOS;
        const minFlankCount = hasLOS ? 4 : 2;
        if (nearbyCount >= minFlankCount) {
            // 选择人数更少的一侧；若已有记忆侧翼且人数差不悬殊，保持稳定
            let side;
            if (enemy._flankSide !== undefined) {
                side = enemy._flankSide;
                // 只有当另一侧明显空旷（差 ≥2）时才切换
                if ((side > 0 && leftCount < rightCount - 1) || (side < 0 && rightCount < leftCount - 1)) {
                    side = leftCount < rightCount ? 1 : -1;
                    enemy._flankSide = side;
                }
            } else {
                side = leftCount < rightCount ? 1 : -1;
                enemy._flankSide = side;
            }

            // 偏移角度：45°~75° 之间，根据拥挤程度调整
            const baseAngle = Math.PI / 3; // 60°
            const congestion = Math.min(1, (nearbyCount - 2) / 4); // 2→0, 6→1
            const flankAngle = Math.atan2(sinA, cosA) + side * (baseAngle + congestion * Math.PI / 12);
            const offsetDist = attackRange * (0.65 + congestion * 0.25);
            result = {
                dx: Math.cos(flankAngle) * offsetDist,
                dy: Math.sin(flankAngle) * offsetDist
            };
        }

        enemy._flankCache = { time: now, value: result };
        return result;
    },

    /**
     * [RELAY] 大场景分段接力寻路：目标超出 MAX_PATHFIND_RANGE 时，不直接寻路全程，
     * 而是选一个 600~700px 外的中继点做局部 A*，到达后再接力下一段。
     * 中继点非永久状态：接近/路径失效/终点偏离即重选，目标移动后下一段自然校正。
     * 重算节流沿用 PathManager 500ms 最小间隔 + pathFinder 帧预算（PATH_DEFERRED 下帧重试）。
     * @param {Enemy} enemy
     * @param {number} tx - 最终目标 X
     * @param {number} ty - 最终目标 Y
     */
    _updateRelayPath(enemy, tx, ty) {
        const pm = enemy._pathManager;
        if (!pm) return;

        let needRecalc = false;
        const relay = enemy._relayTarget;
        if (!relay) {
            needRecalc = true; // 首次进入接力
        } else if (Math.hypot(relay.x - enemy.x, relay.y - enemy.y) < 120) {
            needRecalc = true; // 已接近中继点：推进下一段
        } else if (!pm.hasValidPath()) {
            needRecalc = true; // 路径失效（含 PATH_DEFERRED 后下帧重试）
        } else {
            // 路径终点偏离中继点 >100px：路径已过时
            const end = pm.path[pm.path.length - 1];
            if (Math.hypot(end.x - relay.x, end.y - relay.y) > 100) needRecalc = true;
        }
        if (!needRecalc) return;

        const next = this._pickRelayPoint(enemy, tx, ty);
        enemy._relayTarget = next;
        pm.forceRecalc(pathFinder, next.x, next.y);
    },

    /**
     * [RELAY] 选择中继点：从怪指向目标方向取 600~700px 处，
     * 候选方向为主方向 + ±30°/±60° 共 5 条射线，用 WallSystem.blocked 选第一条不被挡的；
     * 都不通时回退主方向（撞墙滑动 + 卡住检测兜底）。
     * 抽成纯函数便于 tools/pathfinding-bench.mjs 直接单测。
     * @param {Enemy} enemy
     * @param {number} tx - 最终目标 X
     * @param {number} ty - 最终目标 Y
     * @returns {{x:number, y:number}}
     */
    _pickRelayPoint(enemy, tx, ty) {
        const dx = tx - enemy.x;
        const dy = ty - enemy.y;
        const dist = Math.hypot(dx, dy) || 1;
        const baseAngle = Math.atan2(dy, dx);
        // 中继距离 600~700px，且不超过剩余路程的 80%（靠近 800px 边界时避免 overshoot）
        const relayDist = Math.min(650, dist * 0.8);
        const offsets = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3];
        let mainPoint = null;
        for (const off of offsets) {
            const a = baseAngle + off;
            const px = enemy.x + Math.cos(a) * relayDist;
            const py = enemy.y + Math.sin(a) * relayDist;
            if (off === 0) {
                mainPoint = { x: px, y: py };
                // 无墙系统时直接用主方向
                if (!WallSystem || !WallSystem.blocked) return mainPoint;
            }
              const wallBlocked = WallSystem.blocked(enemy.x, enemy.y, px, py);
              const entityBlocked = !!(pathFinder && pathFinder._isBlocked
                  && pathFinder._isBlocked(px, py, enemy.groundRadius));
            if (!wallBlocked && !entityBlocked) {
                return { x: px, y: py };
            }
        }
        return mainPoint;
    },

    /**
     * 处理击退位移
     * @returns {boolean} 是否正在击退中
     */
    /**
     * 获取敌人基础移速（含寒冷 debuff 乘算）。
     * 寒冷为乘法减速，与恐惧/直行加速等独立叠加。
     */
    _getEnemyBaseSpeed(enemy) {
        const base = enemy.maxSpeed ?? enemy.speed ?? 100;
        const chillMul = (typeof enemy.getChillSpeedMul === 'function') ? enemy.getChillSpeedMul() : 1;
        const inspireMul = enemy._usesModifierInspire
            && typeof enemy.getMoveSpeedMultiplier === 'function'
            ? enemy.getMoveSpeedMultiplier()
            : 1;
        // 工艺品祭品：友方单位（player/companion 阵营）移速乘区 + 狼烟图腾旗结界光环
        let friendlyMul = 1;
        if (enemy && (enemy._faction === 'companion' || enemy._faction === 'player')) {
            friendlyMul = getTributeFriendlyMoveSpeedMul();
            const aura = getFriendlyMoveSpeedAura();
            const player = Game && Game.player;
            if (aura && player && player.active !== false
                && Math.hypot(enemy.x - player.x, enemy.y - player.y) <= aura.radius) {
                friendlyMul *= 1 + aura.moveSpeedPercent / 100;
            }
        }
        return base * chillMul * inspireMul * friendlyMul;
    },

    /** 道路加速只在最终移动计算链动态乘算，不修改 maxSpeed，离开道路立即恢复。 */
    _getEnemyMoveSpeed(enemy) {
        return this._getEnemyBaseSpeed(enemy)
            * BuildingRoadSystem.movementMultiplierAt(enemy.x, enemy.y)
            * World125FogTideSystem.getZombieMoveSpeedMultiplier(enemy);
    },

    _applyKnockback(enemy, dt) {
        if (!enemy.knockbackX && !enemy.knockbackY) return false;

        const kf = enemy.knockbackFriction || 0.9;
        const sc = dt / 1000;

        // [ANTI-TELEPORT] 限制击退每帧最大移动距离
        const maxSpd = this._getEnemyBaseSpeed(enemy);
        const maxStep = maxSpd * sc;
        const nextX = enemy.x + (enemy.knockbackX || 0) * sc;
        const nextY = enemy.y + (enemy.knockbackY || 0) * sc;
        const clamped = this._clampMoveDistance(enemy.x, enemy.y, nextX, nextY, maxStep);
        // [WALL-RESOLVE] 击退/冲刺位移与玩家 dash 同口径过墙体解析——此前本通道不过墙，
        // 怪物突进/被击退会直接穿进墙体，下一帧正常移动的 resolve 又把它沿墙切向弹出，
        // 表现为"靠墙瞬移/加速"（所有怪物的位移统一走 knockback 通道，影响面=全部突进类怪物）
        if (WallSystem && WallSystem.resolve) {
            const er = resolveWallFor(enemy, enemy.x, enemy.y, clamped.x, clamped.y, enemy.groundRadius);
            // 被墙完全挡住时清掉击退分量，防止下一帧继续往墙里推
            if (er.x === enemy.x && er.y === enemy.y) {
                enemy.knockbackX = 0;
                enemy.knockbackY = 0;
            }
            enemy.x = er.x;
            enemy.y = er.y;
        } else {
            enemy.x = clamped.x;
            enemy.y = clamped.y;
        }
        enemy.knockbackX *= kf;
        enemy.knockbackY *= kf;

        // 击退值极小时清除
        if (Math.abs(enemy.knockbackX) < 1 && Math.abs(enemy.knockbackY) < 1) {
            enemy.knockbackX = 0;
            enemy.knockbackY = 0;
        }

        enemy.isMoving = true;
        return true;
    },

    /**
     * 卡住检测：定期记录位置，若长时间未移动则触发寻路或随机转向
     */
    _updateStuckDetection(enemy, dt, _dx, _dy, _dist) {
        if (enemy._surfaceRouteActive
            || enemy._surfaceNavWaiting
            || enemy._surfaceKind === 'stairs'
            || enemy._surfaceKind === 'wall_walk') {
            enemy._stuckTimer = 0;
            enemy._lastX = enemy.x;
            enemy._lastY = enemy.y;
            return;
        }
        enemy._stuckTimer = (enemy._stuckTimer || 0) + dt;

        if (enemy._stuckTimer >= 500) {
            const movedDist = Math.sqrt(
                (enemy.x - (enemy._lastX || enemy.x)) ** 2 +
                (enemy.y - (enemy._lastY || enemy.y)) ** 2
            );

            // [FIX] 移除 dist > enemy.attackRange 限制：任何距离下卡住都触发寻路
            if (movedDist < 3) {
                // [GATE-WAIT] 贴身阻挡段若是关着的门闸洞段：跳过 forceRecalc 与侧向
                // reposition，让怪在门前等待——重算也只会得到同样的穿门软成本路径
                // （[GATE-SOFT-COST] 保证可通行），空转循环无意义；门开后门洞段被
                // WallGate.setPassable splice 掉，下一次卡住检测自然恢复重算（无需事件）。
                // 门闸不可攻击（WallGate 无 hp/伤害接口），故只做等待、不发明转火机制。
                const waitAtGate = this._findBlockingGateHole(enemy);
                // [FIX] 寻路目标与实际移动目标一致（优先级同 _computeMoveDirection）
                let targetX = enemy.x, targetY = enemy.y;
                if (enemy._specialTacticalTarget) {
                    targetX = enemy._specialTacticalTarget.x;
                    targetY = enemy._specialTacticalTarget.y;
                } else if (enemy._tacticalTarget) {
                    targetX = enemy._tacticalTarget.x;
                    targetY = enemy._tacticalTarget.y;
                } else if (enemy.target && enemy.target.active) {
                    targetX = enemy.target.x;
                    targetY = enemy.target.y;
                }

                // [ENHANCE] 卡住时强制触发 PathManager 重算（绕过频率限制）
                const stuckDist = Math.sqrt((targetX - enemy.x) ** 2 + (targetY - enemy.y) ** 2);
                if (!waitAtGate && enemy._pathManager && pathFinder && stuckDist <= MAX_PATHFIND_RANGE) {
                    enemy._pathManager.forceRecalc(pathFinder, targetX, targetY, true);
                } else if (!waitAtGate && enemy._pathManager && pathFinder) {
                    // [RELAY] 超距卡住：对中继点重算而非放弃（沿用同一中继目标，避免抖动）
                    // 直冲型怪物卡死（500ms 无位移）时同样允许接力重算——正常冲锋不受影响
                    if (!enemy._relayTarget) {
                        enemy._relayTarget = this._pickRelayPoint(enemy, targetX, targetY);
                    }
                    enemy._pathManager.forceRecalc(pathFinder, enemy._relayTarget.x, enemy._relayTarget.y, true);
                }

                // [ENHANCE] 寻路失败时向目标切线方向设置临时战术目标，尝试绕过障碍/同伴
                // 直冲型怪物仅在卡死（500ms 无位移）时才侧向 reposition——正常冲锋不受影响
                if (!waitAtGate && !enemy._pathManager?.hasValidPath()) {
                    this._setStuckRepositionTarget(enemy, targetX, targetY);
                } else {
                    // 寻路成功时清除旧的临时 reposition 目标
                    if (enemy._repositionTimer !== undefined) {
                        enemy._repositionTimer = 0;
                    }
                }

                // [DEFENSE] 被掩体墙挡住且当前目标够不着时，主动转火挡路的掩体
                // （不等感知 500ms 重扫 + 1.3× 滞回；掩体摧毁后走正常重选）
                // [GATE-PURSUIT] 过门追击中（_gatePursuit）不转火——被关在门内也要
                // 保持原追击目标，只有目标丢失/失效才由感知层正常重选（2026-08-16）
                if (enemy._defenseMonster && !enemy._gatePursuit) {
                    this._retargetBlockingCover(enemy);
                    // [DEFENSE-GATE] 关着的铁栅栏门前等待（waitAtGate）且门可攻击 →
                    // 直接转火门实体（BuildableGate 有 hp；普通门闸 WallGate 无 hp 不受影响）
                    if (waitAtGate) this._retargetBlockingGate(enemy);
                }
            }

            enemy._stuckTimer = 0;
            enemy._lastX = enemy.x;
            enemy._lastY = enemy.y;
        }
    },

    /**
     * [GATE-PURSUIT] 开门追击（2026-08-15 用户要求，世界-122 防守怪）：
     * 建造门（BuildableGate）敞开时，若高价值目标（基地 > 玩家 > 玩家单位）在门内侧
     * 且路径畅通（怪物→门口、门口→目标均无墙体遮挡），放弃啃墙、优先穿门追击。
     * 追击期间置 _gatePursuit 标记（感知系统豁免交战半径脱离与换目标滞回），
     * 进入交战圈/目标失效/追击目标变更后清除标记，回落正常规则。
     */
    _checkGatePursuit(enemy, dt) {
        enemy._gatePursuitTimer = (enemy._gatePursuitTimer || 0) + dt;
        if (enemy._gatePursuitTimer < 500) return;
        enemy._gatePursuitTimer = 0;
        // 追击进行中：目标失效/追击目标被换/已进入交战圈 → 退出追击态（回落正常规则）
        if (enemy._gatePursuit) {
            const t = enemy.target;
            if (!t || !t.active || t !== enemy._gatePursuitTarget) {
                enemy._gatePursuit = false;
                enemy._gatePursuitTarget = null;
                return;
            }
            const engage = enemy._engageHostileRange ?? 320;
            if (Math.hypot(t.x - enemy.x, t.y - enemy.y) <= engage) {
                enemy._gatePursuit = false;
                enemy._gatePursuitTarget = null;
            }
            return;
        }
        // 已与玩家/单位交战中不打扰
        if (enemy.target && enemy.target.active && !enemy.target._isDefenseStructure) return;
        if (!Game || !Game.entities) return;
        // 最近的敞开建造门（900px 内；门洞段开门时已从 isoSegments 移除，寻路自然穿门）
        let gate = null, gd = Infinity;
        for (const e of Game.entities.values()) {
            if (!e || !e._isCoverGate || !e.active || e.hp <= 0 || e.state !== 'open') continue;
            const d = Math.hypot(e.x - enemy.x, e.y - enemy.y);
            if (d <= 900 && d < gd) { gate = e; gd = d; }
        }
        if (!gate || !gate._faceLine) return;
        const A = gate._faceLine[0], B = gate._faceLine[1];
        const gx = (A.x + B.x) / 2, gy = (A.y + B.y) / 2;
        const sideOf = (px, py) => Math.sign((B.x - A.x) * (py - A.y) - (B.y - A.y) * (px - A.x));
        const eSide = sideOf(enemy.x, enemy.y);
        if (eSide === 0) return;
        // 探测点沿法向两侧各让 40px，避免射线端点恰好压在墙线上误判遮挡
        const nx = -(B.y - A.y), ny = (B.x - A.x);
        const nl = Math.hypot(nx, ny) || 1;
        const probe = (side) => ({ x: gx + (nx / nl) * 40 * side, y: gy + (ny / nl) * 40 * side });
        const sideOfProbe = probe(eSide);   // 怪物侧
        const inProbe = probe(-eSide);      // 门内侧
        if (WallSystem && WallSystem.blocked
            && WallSystem.blocked(enemy.x, enemy.y, sideOfProbe.x, sideOfProbe.y)) return; // 怪物→门口畅通
        // 门内候选复用统一优先级：距离档位 → 仓鼠 → 玩家队友 → 玩家 → 建筑 → 基地。
        const cands = [];
        for (const e of Game.entities.values()) {
            if (!isDefenseTargetEligible(e)) continue;
            if (e.hp !== undefined && e.hp <= 0) continue;
            if (sideOf(e.x, e.y) !== -eSide) continue;
            if (Math.hypot(e.x - gx, e.y - gy) > 1500) continue;
            if (WallSystem && WallSystem.blocked
                && WallSystem.blocked(inProbe.x, inProbe.y, e.x, e.y)) continue;
            cands.push(e);
        }
        cands.sort((a, b) => compareDefenseTargets(enemy, a, b));
        for (const t of cands) {
            if (enemy.target !== t) {
                enemy.target = t;
                enemy._lastKnownTargetPos = { x: t.x, y: t.y };
                enemy._lostSightTimer = 0;
                if (enemy._pathManager && pathFinder) {
                    enemy._pathManager.forceRecalc(pathFinder, t.x, t.y, true);
                }
            }
            enemy._gatePursuit = true;
            enemy._gatePursuitTarget = t;
            return;
        }
    },

    /**
     * [GATE-WAIT] 贴身检测：怪物是否正被关着的门闸洞段（_gateHole）挡住。
     * 门洞段只在关门时挂在 isoSegments（WallGate.setPassable push/splice），
     * 开门即移除——检测结果随门开关自然翻转，无需事件订阅。
     * 写法与 _retargetBlockingCover 的贴身段扫描同口径（半径 + 墙半厚 + 余量）。
     * @param {Enemy} enemy
     * @returns {Object|null} 贴身阻挡的门洞段，无则 null
     */
    _findBlockingGateHole(enemy) {
        if (!WallSystem || !WallSystem.isoSegments) return null;
        const touch = (enemy.groundRadius || 20) + 26 + 12; // 半径 + 墙半厚 + 余量
        let best = null, bestD = Infinity;
        for (const s of WallSystem.isoSegments) {
            if (!s._gateHole) continue;
            const d = this._pointSegDistance(enemy.x, enemy.y, s.x1, s.y1, s.x2, s.y2);
            if (d <= touch && d < bestD) {
                bestD = d;
                best = s;
            }
        }
        return best;
    },

    /**
     * [DEFENSE] 卡住时若身旁有挡路的掩体墙段，且当前目标在攻击距离外，
     * 主动把目标切换为该掩体（啃墙开路）。仅世界-122 防守怪调用。
     * @param {Enemy} enemy
     */
    _retargetBlockingCover(enemy) {
        if (!WallSystem || !WallSystem.isoSegments) return;
        // 当前目标已在攻击距离内（正在打/马上能打）时不抢目标
        if (enemy.target && enemy.target.active) {
            const reach = enemy.attackDistance !== undefined ? enemy.attackDistance : (enemy.attackRange || 70) * 1.15;
            const td = Math.sqrt((enemy.target.x - enemy.x) ** 2 + (enemy.target.y - enemy.y) ** 2);
            // 结构目标 footprint 较大，中心距离放宽一个墙厚量级
            const slack = enemy.target._isDefenseStructure ? 120 : 0;
            if (td <= reach + slack) return;
        }
        const touch = (enemy.groundRadius || 20) + 26 + 12; // 半径 + 墙半厚 + 余量
        let best = null, bestD = Infinity;
        for (const s of WallSystem.isoSegments) {
            if (!s._cover) continue;
            const owner = s._owner;
            if (!owner || !owner.active || owner.hp <= 0) continue;
            if (enemy.target === owner) return; // 已经在打这堵墙
            const d = this._pointSegDistance(enemy.x, enemy.y, s.x1, s.y1, s.x2, s.y2);
            if (d <= touch && d < bestD) {
                bestD = d;
                best = owner;
            }
        }
        if (best) {
            enemy.target = best;
            enemy._lastKnownTargetPos = { x: best.x, y: best.y };
            enemy._lostSightTimer = 0;
        }
    },

    /**
     * [DEFENSE-GATE] 门口等待时若挡路的是可攻击铁栅栏门（_isCoverGate），
     * 主动转火门实体——BuildableGate 继承 Combatant（有 hp/伤害接口，可被怪物
     * 攻击、玩家修理），否则怪会在关着的门口无限站桩不打（2026-08-16）。
     * 与 _retargetBlockingCover 同口径：扫贴身门洞段 → 回链门实体。
     * @param {Enemy} enemy
     */
    _retargetBlockingGate(enemy) {
        if (!Game || !Game.entities) return;
        // 当前目标已在攻击距离内（正在打/马上能打）时不抢目标
        if (enemy.target && enemy.target.active && enemy.target._isCoverGate) return;
        const touch = (enemy.groundRadius || 20) + 26 + 12; // 半径 + 墙半厚 + 余量
        let best = null, bestD = Infinity;
        for (const e of Game.entities.values()) {
            if (!e || !e._isCoverGate || !e.active || e.hp <= 0 || !e._gateSeg) continue;
            const s = e._gateSeg;
            const d = this._pointSegDistance(enemy.x, enemy.y, s.x1, s.y1, s.x2, s.y2);
            if (d <= touch && d < bestD) {
                bestD = d;
                best = e;
            }
        }
        if (best) {
            enemy.target = best;
            enemy._lastKnownTargetPos = { x: best.x, y: best.y };
            enemy._lostSightTimer = 0;
        }
    },

    /** 点到线段最短距离 */
    _pointSegDistance(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const cx = x1 + t * dx, cy = y1 + t * dy;
        return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
    },

    /**
     * [ENHANCE] 卡住时设置临时侧向 reposition 目标，让怪物绕开障碍/同伴
     * @param {number} targetX - 原始目标 X
     * @param {number} targetY - 原始目标 Y
     */
    _setStuckRepositionTarget(enemy, targetX, targetY) {
        const dx = targetX - enemy.x;
        const dy = targetY - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return;

        // 选择左右一侧：优先选 _flankSide，否则随机
        let side = enemy._flankSide || (Math.random() > 0.5 ? 1 : -1);
        // 偶尔切换，避免一直卡在同一侧
        if (enemy._repositionSideSwitches !== undefined && enemy._repositionSideSwitches > 2) {
            side = -side;
            enemy._repositionSideSwitches = 0;
        }

        const angleToTarget = Math.atan2(dy, dx);
        const repositionAngle = angleToTarget + side * Math.PI / 2;
        const distance = Math.min(150, Math.max(60, enemy.attackRange || 70));
        enemy._tacticalTarget = {
            x: enemy.x + Math.cos(repositionAngle) * distance,
            y: enemy.y + Math.sin(repositionAngle) * distance,
            _isReposition: true
        };
          // 若侧向点落在能源矿寻路障碍上，换角度重试；路径/逃逸目标不能继续指向矿心
          if (pathFinder && pathFinder._isBlocked
              && enemy._tacticalTarget
              && pathFinder._isBlocked(enemy._tacticalTarget.x, enemy._tacticalTarget.y, enemy.groundRadius)) {
              for (let attempt = 1; attempt <= 6; attempt++) {
                  const altAngle = angleToTarget + side * (Math.PI / 2 - attempt * Math.PI / 7);
                  const altX = enemy.x + Math.cos(altAngle) * distance;
                  const altY = enemy.y + Math.sin(altAngle) * distance;
                  if (!pathFinder._isBlocked(altX, altY, enemy.groundRadius)) {
                      enemy._tacticalTarget = { x: altX, y: altY, _isReposition: true };
                      break;
                  }
              }
          }
        enemy._repositionTimer = 600; // ms
        enemy._repositionSide = side;
        enemy._repositionSideSwitches = (enemy._repositionSideSwitches || 0) + 1;
    },

    /**
     * 限制每帧移动距离，防止瞬移（方案 A + B）
     * @param {number} fromX - 起始X
     * @param {number} fromY - 起始Y
     * @param {number} toX - 目标X
     * @param {number} toY - 目标Y
     * @param {number} maxDist - 最大允许移动距离
     * @returns {{x:number, y:number}} - 限制后的位置
     */
    _clampMoveDistance(fromX, fromY, toX, toY, maxDist) {
        const dx = toX - fromX;
        const dy = toY - fromY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDist && maxDist > 0) {
            const ratio = maxDist / dist;
            return { x: fromX + dx * ratio, y: fromY + dy * ratio };
        }
        return { x: toX, y: toY };
    },

    /**
     * [ENHANCE] 单位间排斥：避免多个敌人堆叠在一起
     * - 使用传入的 entities（修复原先忽略参数的 bug），失败时回退到 Game.entities
     * - 动态半径：默认 collisionRadius * 1.8，最低 24，最高 80
     * - 距离衰减：越近排斥越强（反平方），远处柔和
     * - 贴身战斗时自动降低分离权重，避免近战抖动
     * - 加入微小随机抖动，打破对称拥堵
     */
    _computeSeparation(enemy, minDist, entities) {
        const separationRadius = minDist > 0
            ? minDist
            : Math.max(24, Math.min(80, (enemy.groundRadius) * 1.8));
        const maxCount = 12;
        const epsilon = 0.0001;

        // 贴身战斗时降低分离比重，避免围绕玩家抖动
        const target = enemy.target;
        let inCombatRange = false;
        if (target && target.active) {
            const tdx = target.x - enemy.x;
            const tdy = target.y - enemy.y;
            const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
            inCombatRange = tdist <= (enemy.attackRange || 70);
        }
        // 直冲型怪物在攻击范围内完全关闭分离，避免被其他单位推开导致无法攻击
        if ((enemy.ai && enemy.ai.chargeStraight) && inCombatRange) {
            return { dx: 0, dy: 0 };
        }
        const strength = inCombatRange ? 0.6 : 1.4;

        // [PERF-2026-08-03] 候选优先走空间分区（game.js 每帧重建），替代每怪每帧遍历全部实体；
        // 无分区/未构建时回退原全量遍历
        let list = null;
        if (SpatialPartitionSystem && typeof SpatialPartitionSystem.queryRadius === 'function') {
            const grid = SpatialPartitionSystem;
            if (!grid.allEntities || grid.allEntities.length > 0) {
                list = grid.queryRadius(enemy.x, enemy.y, separationRadius, enemy);
            }
        }
        if (!list) list = entities || (Game && Game.entities);
        if (!list) return { dx: 0, dy: 0 };

        let sumX = 0, sumY = 0, count = 0;
        const iter = list.values ? list.values() : list;
        for (const other of iter) {
            if (other === enemy || !other.active || other.hp <= 0) continue;
            if (other._faction !== enemy._faction) continue;
            if (enemy._elevatedNavigationBridge || other._elevatedNavigationBridge) continue;
            if (!verticalRangesOverlap(enemy, other)) continue;
            const dx = enemy.x - other.x;
            const dy = enemy.y - other.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < separationRadius * separationRadius && distSq > epsilon) {
                const dist = Math.sqrt(distSq);
                // 反平方加权：越近越强
                const inv = 1 / dist - 1 / separationRadius;
                sumX += (dx / dist) * inv;
                sumY += (dy / dist) * inv;
                count++;
            }
            if (count >= maxCount) break;
        }
        if (count === 0) return { dx: 0, dy: 0 };

        let rdx = sumX * strength;
        let rdy = sumY * strength;
        // 限制最大分离力，避免过度漂移
        const maxSep = inCombatRange ? 1.0 : 1.8;
        const len = Math.sqrt(rdx * rdx + rdy * rdy);
        if (len > maxSep) {
            rdx = (rdx / len) * maxSep;
            rdy = (rdy / len) * maxSep;
        }

        // 微小随机抖动，打破完全对称的堆叠
        const jitterAngle = (Math.random() - 0.5) * 0.3; // ±~8.6°
        const cosJ = Math.cos(jitterAngle);
        const sinJ = Math.sin(jitterAngle);
        return {
            dx: rdx * cosJ - rdy * sinJ,
            dy: rdx * sinJ + rdy * cosJ
        };
    },

      /**
       * 能源矿局部避让：寻路已经绕开矿点，但已重叠/被实体分离推进矿体时，
       * 仍可能短距离朝矿心走。这里对最近能源矿做切线绕行 + 脱离推力，
       * 保证怪物不会持续顶在矿上无法摆脱。
       */
      _avoidEnergyNodes(enemy, moveX, moveY, entities) {
          if (!entities) return { moveX, moveY };
          const enemyR = enemy.groundRadius || 20;
          let best = null, bestScore = Infinity;
          const iter = entities.values ? entities.values() : entities;
          for (const e of iter) {
              if (!e || !e._isEnergyNode || !e.active || e.noCollision) continue;
              const nodeR = e.groundRadius || 30;
              const dx = enemy.x - e.x, dy = enemy.y - e.y;
              const d = Math.sqrt(dx * dx + dy * dy);
              const minD = nodeR + enemyR;
              // 只处理重叠 + 外圈 30px 内的矿
              if (d >= minD + 30) continue;
              const score = Math.max(0, d - minD);
              if (score < bestScore) { bestScore = score; best = { dx, dy, d, minD, nodeR }; }
          }
          if (!best) return { moveX, moveY };

          const { dx, dy, d, minD } = best;
          const overlap = Math.max(0, minD - d);
          // 从矿心指向怪物的方向；重叠/同点时用怪物 id 做确定性散开
          let awayX, awayY;
          if (d > 0.01) {
              awayX = dx / d; awayY = dy / d;
          } else {
              const seed = (enemy.id || enemy.name || 'e').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
              const a = seed * 0.618;
              awayX = Math.cos(a); awayY = Math.sin(a);
          }
          // 切线方向：优先选与当前移动方向夹角更小的一侧
          let tanX = -awayY, tanY = awayX;
          if (tanX * moveX + tanY * moveY < 0) { tanX = -tanX; tanY = -tanY; }

          const push = Math.min(2.4, 0.7 + overlap * 0.06);
          const turn = Math.min(1.5, 0.55 + overlap * 0.10);
          let mx = moveX + tanX * turn + awayX * push;
          let my = moveY + tanY * turn + awayY * push;
          const len = Math.sqrt(mx * mx + my * my);
          if (len > 0.001) { mx /= len; my /= len; }
          return { moveX: mx, moveY: my };
      },


    /**
     * 沿路径移动（支持 PathManager 和旧路径兼容）
     */
    _followPath(enemy, dt, entities) {
        // [ENHANCE] 优先使用 PathManager
        if (enemy._pathManager && enemy._pathManager.hasValidPath()) {
            const wp = enemy._pathManager.getCurrentWaypoint();
            if (!wp) {
                enemy._pathManager._clearPath();
                return;
            }
            const wdx = wp.x - enemy.x;
            const wdy = wp.y - enemy.y;
            const wdist = Math.sqrt(wdx * wdx + wdy * wdy);
            if (wdist < 5) {
                enemy._pathManager.advanceWaypoint();
                if (enemy._pathManager.isPathComplete()) {
                    // [NEW] 如果是出口路径，走到出口后清除并重新寻路到真正目标
                    if (enemy._pathManager._isExitPath) {
                        enemy._pathManager._isExitPath = false;
                        enemy._pathManager._clearPath();
                        // 触发重新寻路到真正目标
                        if (enemy.target && enemy.target.active) {
                            enemy._pathManager.forceRecalc(pathFinder, enemy.target.x, enemy.target.y);
                        }
                    } else {
                        enemy._pathManager._clearPath();
                    }
                }
                return;
            }

            // [SPITTER] 绕圈融合：如果 enemy 有 _circleRadius 且目标在视距内，应用绕圈逻辑
            let moveX = wdx / wdist;
            let moveY = wdy / wdist;
            if (enemy._circleRadius && enemy.target && enemy.target.active) {
                const tdx = enemy.target.x - enemy.x;
                const tdy = enemy.target.y - enemy.y;
                const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
                const angleToTarget = Math.atan2(tdy, tdx);
                const targetDist = enemy._circleRadius;
                const pathNoApproach = !!enemy._circleNoApproach;
                if (tdist > targetDist + 80 && !pathNoApproach) {
                    // 太远：正常路径靠近（moveX/moveY 已计算）
                } else if (tdist < targetDist - 80) {
                    // 太近：后退
                    moveX = -Math.cos(angleToTarget);
                    moveY = -Math.sin(angleToTarget);
                } else {
                    // 在绕圈范围内：路径方向与绕圈方向融合（带墙壁规避）
                    const circleMove = this._computeCircleMove(enemy, angleToTarget, targetDist, tdist, pathNoApproach);
                    moveX = circleMove.moveX;
                    moveY = circleMove.moveY;
                }
            }
              // 能源矿局部避让：已重叠/贴边时切线绕行，不再持续顶矿
              const oreAvoid = this._avoidEnergyNodes(enemy, moveX, moveY, entities);
              moveX = oreAvoid.moveX;
              moveY = oreAvoid.moveY;

            // [ENHANCE] 路径跟随期间也应用单位分离，避免多只怪物沿同一路径堆叠
            const chargeStraight = enemy.ai && enemy.ai.chargeStraight;
            let repel = this._computeSeparation(enemy, 0, entities);
            if (repel.dx !== 0 || repel.dy !== 0) {
                // 近战怪物接近目标时，若分离方向会把它们推离目标（反向跑），则极大削弱该力
                if (enemy.target && enemy.target.active && !enemy._circleRadius) {
                    const tdx = enemy.target.x - enemy.x;
                    const tdy = enemy.target.y - enemy.y;
                    const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
                    if (tdist <= (enemy.attackRange || 70) * 1.2) {
                        const tdot = moveX * repel.dx + moveY * repel.dy;
                        if (tdot < 0) {
                            repel = { dx: repel.dx * 0.1, dy: repel.dy * 0.1 };
                        }
                    }
                }
                // 若分离方向与路径方向反向（>90°），说明前方被同伴堵住，允许更大幅度偏离路径
                const dot = moveX * repel.dx + moveY * repel.dy;
                const hasLOS = enemy._perception && enemy._perception.hasLOS;
                const separationWeight = chargeStraight
                    ? 0.05
                    : (hasLOS ? 0.2 : (dot < 0 ? 0.9 : 0.45));
                // 仅当周围确实拥挤时才显著偏离路径
                moveX += repel.dx * separationWeight;
                moveY += repel.dy * separationWeight;
                const len = Math.sqrt(moveX * moveX + moveY * moveY);
                if (len > 0) { moveX /= len; moveY /= len; }
            }

            let maxSpd = this._getEnemyMoveSpeed(enemy);
            if (chargeStraight) {
                maxSpd *= 1.3;
            }
            enemy.vx += (moveX * maxSpd - enemy.vx) * (enemy.accel || 0.7);
            enemy.vy += (moveY * maxSpd - enemy.vy) * (enemy.accel || 0.7);
            const sc = dt / 1000;
            let nx = enemy.x + enemy.vx * sc;
            let ny = enemy.y + enemy.vy * sc;
            if (WallSystem && WallSystem.resolve) {
                const er = resolveWallFor(enemy, enemy.x, enemy.y, nx, ny, enemy.groundRadius);
                if (er.x !== enemy.x || er.y !== enemy.y) {
                    const maxStep = maxSpd * sc;
                    const clamped = this._clampMoveDistance(enemy.x, enemy.y, er.x, er.y, maxStep);
                    enemy.x = clamped.x;
                    enemy.y = clamped.y;
                } else {
                    // [ROOT-FIX 2026-08-15 v2] 完全阻挡时沿墙滑动，不再每帧清路径：
                    // 清路径会让怪物退回直线移动顶墙（_applyNormalMovement 直线朝目标），
                    // 触发卡死看门狗/升级传送兜底（仓鼠矿工回屋偶发 300px 瞬移根因）。
                    // 起步/转向瞬间亚像素步长（vx≈0）仍直接跳过、保留路径，速度沿航点
                    // 方向累积走通（继承 v1 对「原地打转」的修复）；≥1px 真阻挡才做
                    // x/y 轴向滑动（与 _applyNormalMovement [SLIDE] 同口径），墙角完全
                    // 卡住时减速保留路径，交 PathManager._checkValidity 定期修复/重算。
                    const stepLen = Math.hypot(nx - enemy.x, ny - enemy.y);
                    if (stepLen < 1) return; // 亚像素抖动：跳过，速度沿航点累积
                    const xSlide = resolveWallFor(enemy, enemy.x, enemy.y, enemy.x + enemy.vx * sc, enemy.y, enemy.groundRadius);
                    const ySlide = resolveWallFor(enemy, enemy.x, enemy.y, enemy.x, enemy.y + enemy.vy * sc, enemy.groundRadius);
                    const xCanMove = xSlide.x !== enemy.x;
                    const yCanMove = ySlide.y !== enemy.y;
                    const maxStep = maxSpd * sc;
                    if (xCanMove && yCanMove) {
                        if (Math.abs(enemy.vx) >= Math.abs(enemy.vy)) {
                            enemy.x = this._clampMoveDistance(enemy.x, enemy.y, xSlide.x, enemy.y, maxStep).x;
                        } else {
                            enemy.y = this._clampMoveDistance(enemy.x, enemy.y, enemy.x, ySlide.y, maxStep).y;
                        }
                    } else if (xCanMove) {
                        enemy.x = this._clampMoveDistance(enemy.x, enemy.y, xSlide.x, enemy.y, maxStep).x;
                        enemy.vy *= 0.5; // 消除垂直于墙的分量
                    } else if (yCanMove) {
                        enemy.y = this._clampMoveDistance(enemy.x, enemy.y, enemy.x, ySlide.y, maxStep).y;
                        enemy.vx *= 0.5; // 消除垂直于墙的分量
                    } else {
                        // 墙角完全卡住：减速但保留路径，给 PathManager 定期修复时间
                        enemy.vx *= 0.5;
                        enemy.vy *= 0.5;
                        if (Math.abs(enemy.vx) < 1 && Math.abs(enemy.vy) < 1) {
                            enemy.vx = 0;
                            enemy.vy = 0;
                        }
                    }
                    enemy.isMoving = Math.abs(enemy.vx) > 0.1 || Math.abs(enemy.vy) > 0.1;
                    return;
                }
            } else {
                const maxStep = maxSpd * sc;
                const clamped = this._clampMoveDistance(enemy.x, enemy.y, nx, ny, maxStep);
                enemy.x = clamped.x;
                enemy.y = clamped.y;
            }
            enemy.isMoving = Math.abs(enemy.vx) > 0.1 || Math.abs(enemy.vy) > 0.1;
            if (enemy.isMoving) enemy.animTime += 0.15;

            // [ENHANCE] 路径跟随期间也做渐进减速
            if (enemy.target && enemy.target.active) {
                const tdx = enemy.target.x - enemy.x;
                const tdy = enemy.target.y - enemy.y;
                const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
                this._applyAttackRangeFriction(enemy, tdist);
            }
            return;
        }

        // 兼容性：旧路径系统（已废弃，PathManager 全面接管）
        // 清理：enemy._path / enemy._pathIdx 不再使用，全部由 enemy._pathManager 接管
        // 如果 PathManager 没有路径，_followPath 会返回并继续执行 _applyNormalMovement
    },

    /**
     * [ENHANCE] 攻击范围渐进摩擦
     * - dist <= attackRange * 0.5：完全摩擦（停车攻击）
     * - dist <= attackRange * 0.9：线性递增摩擦
     * - dist > attackRange * 0.9：不额外摩擦，继续冲锋到更近位置
     */
    _applyAttackRangeFriction(enemy, dist) {
        const range = enemy.attackRange || 70;
        // 结构目标（掩体/门/基地/塔）：刹车距离改用真实 footprint 形状距离（AABB/圆边距），
        // 中心距离落在墙体后方永远到不了 → 怪沿墙滑行不停车，攻击判定窗口滑过即挥空
        // （2026-08-16 世界-122 实机复现：僵尸啃掩体动画照播但零伤害）
        if (enemy.target && enemy.target.active && enemy.target._isDefenseStructure) {
            dist = distanceToEntityShape(enemy.target, enemy.x, enemy.y);
        }
        // 直冲型怪物：只在极近距离（10px）减速，避免提前刹车导致无法贴近攻击
        if (enemy.ai && enemy.ai.chargeStraight) {
            if (dist <= 10) {
                enemy.vx *= enemy.friction || 0.82;
                enemy.vy *= enemy.friction || 0.82;
            }
            return;
        }
        const halfRange = range * 0.35;
        const brakeStart = range * 0.95;
        if (dist <= halfRange) {
            enemy.vx *= enemy.friction || 0.82;
            enemy.vy *= enemy.friction || 0.82;
        } else if (dist <= brakeStart) {
            const t = (brakeStart - dist) / (brakeStart - halfRange); // 0~1
            const f = 1 - (1 - (enemy.friction || 0.82)) * t;
            enemy.vx *= f;
            enemy.vy *= f;
        }
    },

    /**
     * 计算带墙壁规避的绕圈移动方向
     * @returns {{moveX: number, moveY: number}}
     */
    _computeCircleMove(enemy, angleToTarget, targetDist, tdist, noApproach = false) {
        let circleDir = enemy._circleDir || (enemy._circleDir = Math.random() > 0.5 ? 1 : -1);
        const distDiff = tdist - targetDist;
        // noApproach：只后退不主动靠近，用于僵尸巫师等“纯环绕”单位
        let adjustStrength = Math.max(-0.5, Math.min(0.5, distDiff / 100));
        if (noApproach) {
            adjustStrength = Math.min(0, adjustStrength);
        }

        const build = (dir) => {
            const circleAngle = angleToTarget + dir * Math.PI / 2;
            let mx = Math.cos(circleAngle) * 0.8 + Math.cos(angleToTarget) * adjustStrength * 0.2;
            let my = Math.sin(circleAngle) * 0.8 + Math.sin(angleToTarget) * adjustStrength * 0.2;
            const len = Math.sqrt(mx * mx + my * my);
            if (len > 0) { mx /= len; my /= len; }
            return { mx, my };
        };

        let { mx, my } = build(circleDir);
        if (WallSystem && WallSystem.resolve) {
            const r = enemy.groundRadius;
            const probeDist = r + 4;
            const probe = resolveWallFor(enemy, enemy.x, enemy.y, enemy.x + mx * probeDist, enemy.y + my * probeDist, r);
            const blocked = probe.x === enemy.x && probe.y === enemy.y;
            if (blocked) {
                const opp = build(-circleDir);
                const probeOpp = resolveWallFor(enemy, enemy.x, enemy.y, enemy.x + opp.mx * probeDist, enemy.y + opp.my * probeDist, r);
                const oppBlocked = probeOpp.x === enemy.x && probeOpp.y === enemy.y;
                if (!oppBlocked) {
                    enemy._circleDir = -circleDir;
                    mx = opp.mx;
                    my = opp.my;
                } else {
                    // 墙角：临时外推，远离目标以脱离边缘
                    mx = mx * 0.3 - Math.cos(angleToTarget) * 0.7;
                    my = my * 0.3 - Math.sin(angleToTarget) * 0.7;
                    const len2 = Math.sqrt(mx * mx + my * my);
                    if (len2 > 0) { mx /= len2; my /= len2; }
                }
            }
        }
        return { moveX: mx, moveY: my };
    },

    /**
     * 应用正常移动（加速度 + 摩擦 + 墙壁碰撞）
     */
    _applyNormalMovement(enemy, dt, dx, dy, dist, entities) {
        const chargeStraight = enemy.ai && enemy.ai.chargeStraight;
        let maxSpd = this._getEnemyMoveSpeed(enemy);
        // 直冲型怪物在攻击范围外小幅加速，确保能追上高速目标
        if (chargeStraight && dist > (enemy.attackRange || 70)) {
            maxSpd *= 1.3;
        }
        let moveX = dx / Math.max(dist, 1);
        let moveY = dy / Math.max(dist, 1);

        // [SPITTER] 绕圈逻辑：当敌人有 _circleRadius 时，在目标周围保持一定距离绕圈移动，不贴身
        if (enemy._circleRadius && enemy.target && enemy.target.active && dist > 0) {
            const targetDist = enemy._circleRadius;
            const angleToTarget = Math.atan2(dy, dx);
            const noApproach = !!enemy._circleNoApproach;
            if (dist > targetDist + 80 && !noApproach) {
                // 距离太远：正常靠近（moveX/moveY 已计算）
            } else if (dist < targetDist - 80) {
                // 距离太近：后退
                moveX = -Math.cos(angleToTarget);
                moveY = -Math.sin(angleToTarget);
            } else {
                // 在目标距离范围内：绕圈移动（带墙壁规避）
                const circleMove = this._computeCircleMove(enemy, angleToTarget, targetDist, dist, noApproach);
                moveX = circleMove.moveX;
                moveY = circleMove.moveY;
            }
        }
          // 能源矿局部避让：与路径跟随同口径，避免无路径/直冲怪持续顶矿
          const oreAvoid = this._avoidEnergyNodes(enemy, moveX, moveY, entities);
          moveX = oreAvoid.moveX;
          moveY = oreAvoid.moveY;

        // [ENHANCE] 单位间排斥：使用动态半径与衰减权重
        let repel = this._computeSeparation(enemy, 0, entities);
        if (repel.dx !== 0 || repel.dy !== 0) {
            // 近战怪物接近目标时，若分离方向会把它们推离目标（反向跑），则极大削弱该力
            if (enemy.target && enemy.target.active && !enemy._circleRadius) {
                const tdx = enemy.target.x - enemy.x;
                const tdy = enemy.target.y - enemy.y;
                const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
                if (tdist <= (enemy.attackRange || 70) * 1.2) {
                    const dot = moveX * repel.dx + moveY * repel.dy;
                    if (dot < 0) {
                        repel = { dx: repel.dx * 0.1, dy: repel.dy * 0.1 };
                    }
                }
            }
            // 有清晰视线时降低分离权重，让怪物直线冲锋；否则保持较高权重避免堆叠
            const hasLOS = enemy._perception && enemy._perception.hasLOS;
            const inCombatRange = dist <= (enemy.attackRange || 70);
            const separationWeight = chargeStraight
                ? (inCombatRange ? 0 : 0.1)
                : (hasLOS ? 0.25 : 0.7);
            moveX += repel.dx * separationWeight;
            moveY += repel.dy * separationWeight;
            const len = Math.sqrt(moveX * moveX + moveY * moveY);
            if (len > 0) { moveX /= len; moveY /= len; }
        }

        enemy.vx += (moveX * maxSpd - enemy.vx) * (enemy.accel || 0.7);
        enemy.vy += (moveY * maxSpd - enemy.vy) * (enemy.accel || 0.7);

        const sc = dt / 1000;
        let nx = enemy.x + enemy.vx * sc;
        let ny = enemy.y + enemy.vy * sc;
        const maxStep = maxSpd * sc;

        // 墙壁碰撞解析
        if (WallSystem && WallSystem.resolve) {
            const er = resolveWallFor(enemy, enemy.x, enemy.y, nx, ny, enemy.groundRadius);

            if (er.x === enemy.x && er.y === enemy.y) {
                // [SLIDE] 沿墙滑动：分解为 x 和 y 方向分别检测
                // 当目标方向被墙完全挡住时，保留可移动方向的分量
                const xSlide = resolveWallFor(enemy, enemy.x, enemy.y, enemy.x + enemy.vx * sc, enemy.y, enemy.groundRadius);
                const ySlide = resolveWallFor(enemy, enemy.x, enemy.y, enemy.x, enemy.y + enemy.vy * sc, enemy.groundRadius);
                const xCanMove = xSlide.x !== enemy.x;
                const yCanMove = ySlide.y !== enemy.y;

                if (xCanMove && yCanMove) {
                    // 两个方向都可移动，选择速度更大的方向（避免同时移动导致新问题）
                    if (Math.abs(enemy.vx) >= Math.abs(enemy.vy)) {
                        enemy.x = this._clampMoveDistance(enemy.x, enemy.y, xSlide.x, enemy.y, maxStep).x;
                    } else {
                        enemy.y = this._clampMoveDistance(enemy.x, enemy.y, enemy.x, ySlide.y, maxStep).y;
                    }
                } else if (xCanMove) {
                    // 只有 x 方向可移动：沿墙水平滑动
                    enemy.x = this._clampMoveDistance(enemy.x, enemy.y, xSlide.x, enemy.y, maxStep).x;
                    enemy.vy *= 0.5; // 消除垂直于墙的分量
                } else if (yCanMove) {
                    // 只有 y 方向可移动：沿墙垂直滑动
                    enemy.y = this._clampMoveDistance(enemy.x, enemy.y, enemy.x, ySlide.y, maxStep).y;
                    enemy.vx *= 0.5; // 消除垂直于墙的分量
                } else {
                    // 完全卡住（墙角）：减速但不立即停止，给寻路触发时间
                    enemy.vx *= 0.5;
                    enemy.vy *= 0.5;
                    if (Math.abs(enemy.vx) < 1 && Math.abs(enemy.vy) < 1) {
                        enemy.vx = 0;
                        enemy.vy = 0;
                    }
                }
            } else {
                if (er.x === enemy.x) enemy.vx = 0;
                if (er.y === enemy.y) enemy.vy = 0;
                // [ANTI-TELEPORT] 限制移动距离
                const clamped = this._clampMoveDistance(enemy.x, enemy.y, er.x, er.y, maxStep);
                enemy.x = clamped.x;
                enemy.y = clamped.y;
            }
        } else {
            // 无 WallSystem 时，直接限制移动距离
            const clamped = this._clampMoveDistance(enemy.x, enemy.y, nx, ny, maxStep);
            enemy.x = clamped.x;
            enemy.y = clamped.y;
        }

        enemy.isMoving = Math.abs(enemy.vx) > 0.1 || Math.abs(enemy.vy) > 0.1;
    },

    /**
     * [UNSTUCK] 卡死恢复：敌人长时间未移动时，尝试沿 8 个方向小幅瞬移
     */
    _tryUnstuck(enemy) {
        if (!WallSystem || !WallSystem.canMoveTo) return;
        if (enemy._surfaceRouteActive
            || enemy._surfaceNavWaiting
            || enemy._surfaceKind === 'stairs'
            || enemy._surfaceKind === 'wall_walk') {
            enemy._stuckFrames = 0;
            enemy._lastUnstuckX = enemy.x;
            enemy._lastUnstuckY = enemy.y;
            return;
        }

        // 站桩单位（speed/maxSpeed 均为 0，如首领"集合体"）不是"卡死"：跳过瞬移恢复
        if (!(enemy.maxSpeed > 0) && !(enemy.speed > 0)) {
            enemy._stuckFrames = 0;
            return;
        }

        // 只有真正在尝试移动时才计数：有速度 或 有目标且距离大于攻击范围
        const hasTarget = enemy.target && enemy.target.active;
        const distToTarget = hasTarget
            ? Math.sqrt((enemy.target.x - enemy.x) ** 2 + (enemy.target.y - enemy.y) ** 2)
            : Infinity;
        const isTryingToMove = enemy.isMoving || (hasTarget && distToTarget > (enemy.attackRange || 70));
        if (!isTryingToMove) {
            enemy._stuckFrames = 0;
            enemy._lastUnstuckX = enemy.x;
            enemy._lastUnstuckY = enemy.y;
            return;
        }

        enemy._stuckFrames = (enemy._stuckFrames || 0) + 1;
        const lastX = enemy._lastUnstuckX !== undefined ? enemy._lastUnstuckX : enemy.x;
        const lastY = enemy._lastUnstuckY !== undefined ? enemy._lastUnstuckY : enemy.y;
        const moved = Math.sqrt((enemy.x - lastX) ** 2 + (enemy.y - lastY) ** 2);

        if (moved >= 0.5) {
            enemy._stuckFrames = 0;
            enemy._lastUnstuckX = enemy.x;
            enemy._lastUnstuckY = enemy.y;
            return;
        }

        if (enemy._stuckFrames <= 30) return;

        const r = enemy.groundRadius;
        // 卡死恢复改 resolve 小步滑移（玩家贴墙同口径），不再 45px 盲跳——
        // 旧版 8 方向 canMoveTo 瞬移是"贴墙周期性瞬移"的根因：跳完仍卡，500ms 后再跳。
        // 只在能缩短与目标距离时移动；移动量 ≤ 3 倍单帧步长，视觉上仍是连续移动
        const maxSpd = this._getEnemyBaseSpeed(enemy);
        const step = Math.max(Math.min(maxSpd * 0.05, r * 0.8), 8);
        let best = null, bestDist = Infinity;
        // 步长递增（1×/2×/3×）：正常贴墙小步滑出；深嵌（击退撞进墙厚区）也能合法脱出，不再依赖盲跳
        for (let mul = 1; mul <= 3 && !best; mul++) {
            for (let i = 0; i < 8; i++) {
                const angle = (Math.PI * 2 * i) / 8;
                const tx = enemy.x + Math.cos(angle) * step * mul;
                const ty = enemy.y + Math.sin(angle) * step * mul;
                const er = resolveWallFor(enemy, enemy.x, enemy.y, tx, ty, r);
                const moved = Math.hypot(er.x - enemy.x, er.y - enemy.y);
                if (moved < 1 || !WallSystem.canMoveTo(er.x, er.y, r)) continue;
                const dd = hasTarget ? Math.hypot(enemy.target.x - er.x, enemy.target.y - er.y) : 0;
                if (dd < bestDist) { bestDist = dd; best = er; }
            }
        }
        if (best && bestDist < distToTarget) {
            enemy.x = best.x;
            enemy.y = best.y;
            enemy.vx = 0;
            enemy.vy = 0;
            enemy._stuckFrames = 0;
            enemy._lastUnstuckX = enemy.x;
            enemy._lastUnstuckY = enemy.y;
        } else {
            // 滑不出（真·死角）：重置计数交给寻路重算（_updateStuckDetection），不做任何瞬移
            enemy._stuckFrames = 0;
        }
    },

    /**
     * 更新移动动画状态
     */
    _updateMovementAnim(enemy, _dt) {
        if (enemy.isMoving) {
            enemy.animTime += 0.15;
        }
    },

    /**
     * 工具：向指定方向应用瞬时位移（用于闪避、冲刺等）
     * @param {Enemy} enemy
     * @param {number} angle - 方向（弧度）
     * @param {number} distance - 位移距离（像素）
     * @param {number} duration - 持续时间（ms），0表示瞬时
     */
    dashTo(enemy, angle, distance, duration = 0) {
        // [ANTI-TELEPORT] 所有位移统一走 knockback 通道，由 _applyKnockback 逐帧处理
        const actualDuration = duration <= 0 ? 16.67 : duration; // 瞬时位移改为1帧
        const speed = distance / (actualDuration / 1000);
        enemy.knockbackX = Math.cos(angle) * speed;
        enemy.knockbackY = Math.sin(angle) * speed;
    },

    /**
     * 工具：设置敌人的战术目标位置
     * @param {Enemy} enemy
     * @param {number} tx - 目标X
     * @param {number} ty - 目标Y
     */
    setTacticalTarget(enemy, tx, ty) {
        enemy._tacticalTarget = { x: tx, y: ty };
    },

    /**
     * 工具：清除战术目标
     * @param {Enemy} enemy
     */
    clearTacticalTarget(enemy) {
        enemy._tacticalTarget = null;
    },

    /**
     * 工具：计算到目标的距离（支持 _faction 检测）
     * @param {Enemy} enemy
     * @param {Map|Array} entities
     * @returns {number} 到最近玩家的距离，Infinity 若无玩家
     */
    distanceToNearestPlayer(enemy, entities) {
        let minDist = Infinity;
        const arr = entities.values ? Array.from(entities.values()) : entities;
        for (const e of arr) {
            if (e && e._faction === 'player' && e.active) {
                const dx = e.x - enemy.x;
                const dy = e.y - enemy.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < minDist) minDist = d;
            }
        }
        return minDist;
    },

    /**
     * 工具：寻找最近的玩家实体
     * @param {Enemy} enemy
     * @param {Map|Array} entities
     * @returns {Entity|null}
     */
    findNearestPlayer(enemy, entities) {
        let nearest = null;
        let minDist = Infinity;
        const arr = entities.values ? Array.from(entities.values()) : entities;
        for (const e of arr) {
            if (e && e._faction === 'player' && e.active) {
                const dx = e.x - enemy.x;
                const dy = e.y - enemy.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < minDist) {
                    minDist = d;
                    nearest = e;
                }
            }
        }
        return nearest;
    },

    /**
     * 工具：检查是否被墙壁阻挡到目标
     * @param {Enemy} enemy
     * @param {Entity} target
     * @returns {boolean}
     */
    isBlockedToTarget(enemy, target) {
        if (!target) return true;
        if (!WallSystem || !WallSystem.blocked) return false;
        return WallSystem.blocked(
            enemy.x,
            enemy.y,
            target.x,
            target.y,
            WallSystem.ignoreForEntity?.(enemy) || null
        );
    },

    /**
     * 工具：沿墙壁滑动移动（用于精确避障）
     * @param {Enemy} enemy
     * @param {number} dt
     * @param {number} desiredVx - 期望的X速度
     * @param {number} desiredVy - 期望的Y速度
     */
    slideAlongWall(enemy, dt, desiredVx, desiredVy) {
        const sc = dt / 1000;
        const r = enemy.groundRadius;

        // 尝试X方向
        const xRes = WallSystem && WallSystem.resolve
            ? resolveWallFor(enemy, enemy.x, enemy.y, enemy.x + desiredVx * sc, enemy.y, r)
            : { x: enemy.x + desiredVx * sc, y: enemy.y };

        // 尝试Y方向
        const yRes = WallSystem && WallSystem.resolve
            ? resolveWallFor(enemy, enemy.x, enemy.y, enemy.x, enemy.y + desiredVy * sc, r)
            : { x: enemy.x, y: enemy.y + desiredVy * sc };

        // 如果X方向可以移动但Y不行，只移动X
        if (xRes.x !== enemy.x && yRes.y === enemy.y) {
            enemy.x = xRes.x;
            enemy.vx = desiredVx;
            enemy.vy = 0;
        }
        // 如果Y方向可以移动但X不行，只移动Y
        else if (xRes.x === enemy.x && yRes.y !== enemy.y) {
            enemy.y = yRes.y;
            enemy.vx = 0;
            enemy.vy = desiredVy;
        }
        // 都可行，正常移动
        else if (xRes.x !== enemy.x || yRes.y !== enemy.y) {
            enemy.x = xRes.x !== enemy.x ? xRes.x : enemy.x;
            enemy.y = yRes.y !== enemy.y ? yRes.y : enemy.y;
            enemy.vx = desiredVx;
            enemy.vy = desiredVy;
        }
        // 都不可行，停止
        else {
            enemy.vx = 0;
            enemy.vy = 0;
        }
    },

    /**
     * 工具： flee 行为 — 远离指定位置
     * @param {Enemy} enemy
     * @param {number} fromX
     * @param {number} fromY
     * @param {number} dt
     */
    fleeFrom(enemy, fromX, fromY, dt) {
        const dx = enemy.x - fromX;
        const dy = enemy.y - fromY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.1) return;

        const maxSpd = this._getEnemyMoveSpeed(enemy);
        enemy.vx += (dx / dist * maxSpd - enemy.vx) * (enemy.accel || 0.7);
        enemy.vy += (dy / dist * maxSpd - enemy.vy) * (enemy.accel || 0.7);

        const sc = dt / 1000;
        const nx = enemy.x + enemy.vx * sc;
        const ny = enemy.y + enemy.vy * sc;

        if (WallSystem && WallSystem.resolve) {
            const er = resolveWallFor(enemy, enemy.x, enemy.y, nx, ny, enemy.groundRadius);
            const maxStep = maxSpd * sc;
            const clamped = this._clampMoveDistance(enemy.x, enemy.y, er.x, er.y, maxStep);
            enemy.x = clamped.x;
            enemy.y = clamped.y;
        } else {
            const maxStep = maxSpd * sc;
            const clamped = this._clampMoveDistance(enemy.x, enemy.y, nx, ny, maxStep);
            enemy.x = clamped.x;
            enemy.y = clamped.y;
        }

        enemy.isMoving = true;
        enemy.animTime += 0.15;
    },

    /**
     * 工具： wander 行为 — 随机漫游
     * @param {Enemy} enemy
     * @param {number} dt
     * @param {number} [radius=200] - 漫游半径
     */
    wander(enemy, dt, radius = 200) {
        if (!enemy._wanderTarget || Math.random() < 0.01) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * radius;
            enemy._wanderTarget = {
                x: enemy.x + Math.cos(angle) * dist,
                y: enemy.y + Math.sin(angle) * dist
            };
        }

        const dx = enemy._wanderTarget.x - enemy.x;
        const dy = enemy._wanderTarget.y - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 5) {
            enemy._wanderTarget = null;
            enemy.isMoving = false;
            return;
        }

        const maxSpd = this._getEnemyMoveSpeed(enemy) * 0.3;
        enemy.vx += (dx / dist * maxSpd - enemy.vx) * (enemy.accel || 0.7);
        enemy.vy += (dy / dist * maxSpd - enemy.vy) * (enemy.accel || 0.7);

        const sc = dt / 1000;
        const nx = enemy.x + enemy.vx * sc;
        const ny = enemy.y + enemy.vy * sc;

        if (WallSystem && WallSystem.resolve) {
            const er = resolveWallFor(enemy, enemy.x, enemy.y, nx, ny, enemy.groundRadius);
            const maxStep = maxSpd * sc;
            const clamped = this._clampMoveDistance(enemy.x, enemy.y, er.x, er.y, maxStep);
            enemy.x = clamped.x;
            enemy.y = clamped.y;
        } else {
            const maxStep = maxSpd * sc;
            const clamped = this._clampMoveDistance(enemy.x, enemy.y, nx, ny, maxStep);
            enemy.x = clamped.x;
            enemy.y = clamped.y;
        }

        enemy.isMoving = Math.abs(enemy.vx) > 0.1 || Math.abs(enemy.vy) > 0.1;
        if (enemy.isMoving) enemy.animTime += 0.15;
    },

    /**
     * 工具： orbit 行为 — 围绕目标做圆周运动
     * @param {Enemy} enemy
     * @param {number} targetX
     * @param {number} targetY
     * @param {number} orbitRadius
     * @param {number} dt
     * @param {boolean} [clockwise=true]
     */
    orbit(enemy, targetX, targetY, orbitRadius, dt, clockwise = true) {
        const dx = enemy.x - targetX;
        const dy = enemy.y - targetY;
        const _dist = Math.sqrt(dx * dx + dy * dy);

        // 计算当前角度
        let angle = Math.atan2(dy, dx);

        // 角速度（弧度/ms）
        const angularSpeed = 0.001 * (clockwise ? 1 : -1);
        angle += angularSpeed * dt;

        // 目标位置
        const desiredX = targetX + Math.cos(angle) * orbitRadius;
        const desiredY = targetY + Math.sin(angle) * orbitRadius;

        const moveDx = desiredX - enemy.x;
        const moveDy = desiredY - enemy.y;
        const moveDist = Math.sqrt(moveDx * moveDx + moveDy * moveDy);

        if (moveDist < 0.1) return;

        const maxSpd = this._getEnemyMoveSpeed(enemy);
        enemy.vx += (moveDx / moveDist * maxSpd - enemy.vx) * (enemy.accel || 0.7);
        enemy.vy += (moveDy / moveDist * maxSpd - enemy.vy) * (enemy.accel || 0.7);

        const sc = dt / 1000;
        const nx = enemy.x + enemy.vx * sc;
        const ny = enemy.y + enemy.vy * sc;

        if (WallSystem && WallSystem.resolve) {
            const er = resolveWallFor(enemy, enemy.x, enemy.y, nx, ny, enemy.groundRadius);
            const maxStep = maxSpd * sc;
            const clamped = this._clampMoveDistance(enemy.x, enemy.y, er.x, er.y, maxStep);
            enemy.x = clamped.x;
            enemy.y = clamped.y;
        } else {
            const maxStep = maxSpd * sc;
            const clamped = this._clampMoveDistance(enemy.x, enemy.y, nx, ny, maxStep);
            enemy.x = clamped.x;
            enemy.y = clamped.y;
        }

        enemy.isMoving = true;
        enemy.animTime += 0.15;
    },

    /**
     * 工具：保持与目标的最小/最大距离
     * @param {Enemy} enemy
     * @param {number} targetX
     * @param {number} targetY
     * @param {number} minDist - 最小保持距离
     * @param {number} maxDist - 最大保持距离
     * @param {number} dt
     */
    maintainDistance(enemy, targetX, targetY, minDist, maxDist, dt) {
        const dx = enemy.x - targetX;
        const dy = enemy.y - targetY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        let moveDx, moveDy;

        if (dist < minDist) {
            // 太远，需要远离
            moveDx = dx / dist;
            moveDy = dy / dist;
        } else if (dist > maxDist) {
            // 太近，需要靠近
            moveDx = -dx / dist;
            moveDy = -dy / dist;
        } else {
            // 在理想范围内，微调位置
            enemy.vx *= enemy.friction || 0.82;
            enemy.vy *= enemy.friction || 0.82;
            enemy.isMoving = Math.abs(enemy.vx) > 0.1 || Math.abs(enemy.vy) > 0.1;
            return;
        }

        const maxSpd = this._getEnemyMoveSpeed(enemy);
        enemy.vx += (moveDx * maxSpd - enemy.vx) * (enemy.accel || 0.7);
        enemy.vy += (moveDy * maxSpd - enemy.vy) * (enemy.accel || 0.7);

        const sc = dt / 1000;
        const nx = enemy.x + enemy.vx * sc;
        const ny = enemy.y + enemy.vy * sc;

        if (WallSystem && WallSystem.resolve) {
            const er = resolveWallFor(enemy, enemy.x, enemy.y, nx, ny, enemy.groundRadius);
            const maxStep = maxSpd * sc;
            const clamped = this._clampMoveDistance(enemy.x, enemy.y, er.x, er.y, maxStep);
            enemy.x = clamped.x;
            enemy.y = clamped.y;
        } else {
            const maxStep = maxSpd * sc;
            const clamped = this._clampMoveDistance(enemy.x, enemy.y, nx, ny, maxStep);
            enemy.x = clamped.x;
            enemy.y = clamped.y;
        }

        enemy.isMoving = true;
        enemy.animTime += 0.15;
    }
};

export { MovementSystem };
