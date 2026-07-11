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
import { PerfMonitor } from '../utils/perf-monitor.js';

/** 超出此距离不再进行 A* 寻路，直接朝目标移动 */
const MAX_PATHFIND_RANGE = 800;

/**
 * 移动系统核心实现
 */
const MovementSystem = {
    /**
     * 每帧更新敌人移动状态
     * @param {Enemy} enemy - 敌人实例
     * @param {number} dt - 时间间隔（ms）
     * @param {Map|Array} entities - 实体集合
     */
    update(enemy, dt, entities) {
        if (!enemy || !enemy.active) return;

        // 死亡状态不移动
        if (enemy.hp <= 0) {
            enemy.vx = 0;
            enemy.vy = 0;
            enemy.isMoving = false;
            return;
        }

        // 眩晕状态：强制停止
        if (enemy._dashStunned || enemy.hasStatusEffect && enemy.hasStatusEffect('stun')) {
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
        const tDir = performance.now();
        const moveData = this._computeMoveDirection(enemy, entities);
        PerfMonitor.record('movement:computeDir', performance.now() - tDir);
        if (!moveData) {
            enemy.vx *= enemy.friction || 0.82;
            enemy.vy *= enemy.friction || 0.82;
            enemy.isMoving = false;
            return;
        }

        let { dx, dy, dist } = moveData;

        // 更新朝向
        if (dist > 0.1) {
            enemy.rotation = Math.atan2(dy, dx);
        }

        // [ENHANCE] 主动预规划：有目标且路径缺失或路径终点严重偏离目标时，重新计算路径
        if (enemy._pathManager && enemy.target && enemy.target.active) {
            const targetX = enemy.target.x;
            const targetY = enemy.target.y;
            const distToTarget = Math.sqrt((targetX - enemy.x) ** 2 + (targetY - enemy.y) ** 2);

            // 目标太远时直接移动，不做 A*，避免生成巨大网格造成卡顿
            if (distToTarget > MAX_PATHFIND_RANGE) {
                enemy._pathManager._clearPath();
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
                    const tRecalc = performance.now();
                    enemy._pathManager.forceRecalc(pathFinder, targetX, targetY);
                    PerfMonitor.record('movement:recalc', performance.now() - tRecalc);
                }
            }
        }

        // [ENHANCE] 每帧更新 PathManager：检查路径有效性 + 局部修复
        if (enemy._pathManager && pathFinder) {
            const tPathUpdate = performance.now();
            enemy._pathManager.update(dt, pathFinder);
            PerfMonitor.record('movement:pathUpdate', performance.now() - tPathUpdate);
        }

        // 卡住检测与寻路触发（保留原有逻辑，作为 fallback）
        const tStuck = performance.now();
        this._updateStuckDetection(enemy, dt, dx, dy, dist);
        PerfMonitor.record('movement:stuckDetect', performance.now() - tStuck);

        // 路径跟随（使用 PathManager）
        const tMoveApply = performance.now();
        if (enemy._pathManager && enemy._pathManager.hasValidPath()) {
            this._followPath(enemy, dt);
            PerfMonitor.record('movement:moveApply', performance.now() - tMoveApply);
            return;
        }

        // 正常移动
        this._applyNormalMovement(enemy, dt, dx, dy, dist);
        PerfMonitor.record('movement:moveApply', performance.now() - tMoveApply);

        // 攻击范围内减速
        if (dist <= enemy.attackRange && enemy.target && enemy.target.active) {
            enemy.vx *= enemy.friction || 0.82;
            enemy.vy *= enemy.friction || 0.82;
        }

        // 更新移动动画状态
        const tAnim = performance.now();
        this._updateMovementAnim(enemy, dt);
        PerfMonitor.record('movement:anim', performance.now() - tAnim);
    },

    /**
     * 计算移动方向（目标、最后已知位置、战术目标、战斗指挥官目标）
     * @returns {{dx:number, dy:number, dist:number}|null}
     */
    _computeMoveDirection(enemy, _entities) {
        let tx = 0, ty = 0, hasTarget = false;

        // 0. [FIX] 特殊战术目标（TacticalSquadAI 设置）优先级最高
        if (enemy._specialTacticalTarget) {
            tx = enemy._specialTacticalTarget.x;
            ty = enemy._specialTacticalTarget.y;
            hasTarget = true;
        }
        // 1. 战术目标
        else if (enemy._tacticalTarget) {
            tx = enemy._tacticalTarget.x;
            ty = enemy._tacticalTarget.y;
            hasTarget = true;
        }
        // 2. 战斗指挥官目标
        else if (Game && Game._battleCommander) {
            const tp = Game._battleCommander.getTarget(enemy.id);
            if (tp) {
                tx = tp.targetX;
                ty = tp.targetY;
                hasTarget = true;
            }
        }
        // 3. 当前目标
        else if (enemy.target && enemy.target.active) {
            tx = enemy.target.x;
            ty = enemy.target.y;
            hasTarget = true;
        }
        // 4. 最后已知位置（失去目标后搜索）
        else if (enemy._lastKnownTargetPos) {
            tx = enemy._lastKnownTargetPos.x;
            ty = enemy._lastKnownTargetPos.y;
            hasTarget = true;
        }

        if (!hasTarget) return null;

        const dx = tx - enemy.x;
        const dy = ty - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // 到达最后已知位置后清除
        if (!enemy.target && enemy._lastKnownTargetPos && dist < 10) {
            enemy._lastKnownTargetPos = null;
            return null;
        }

        return { dx, dy, dist };
    },

    /**
     * 处理击退位移
     * @returns {boolean} 是否正在击退中
     */
    _applyKnockback(enemy, dt) {
        if (!enemy.knockbackX && !enemy.knockbackY) return false;

        const kf = enemy.knockbackFriction || 0.9;
        const sc = dt / 1000;

        // [ANTI-TELEPORT] 限制击退每帧最大移动距离
        const maxSpd = enemy.maxSpeed || enemy.speed || 100;
        const maxStep = maxSpd * sc;
        const nextX = enemy.x + (enemy.knockbackX || 0) * sc;
        const nextY = enemy.y + (enemy.knockbackY || 0) * sc;
        const clamped = this._clampMoveDistance(enemy.x, enemy.y, nextX, nextY, maxStep);
        enemy.x = clamped.x;
        enemy.y = clamped.y;
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
        enemy._stuckTimer = (enemy._stuckTimer || 0) + dt;

        if (enemy._stuckTimer >= 500) {
            const movedDist = Math.sqrt(
                (enemy.x - (enemy._lastX || enemy.x)) ** 2 +
                (enemy.y - (enemy._lastY || enemy.y)) ** 2
            );

            // [FIX] 移除 dist > enemy.attackRange 限制：任何距离下卡住都触发寻路
            if (movedDist < 3) {
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
                if (enemy._pathManager && pathFinder && stuckDist <= MAX_PATHFIND_RANGE) {
                    enemy._pathManager.forceRecalc(pathFinder, targetX, targetY, true);
                }

                // 寻路失败时随机转向
                if (!enemy._pathManager?.hasValidPath()) {
                    const ra = Math.random() * Math.PI * 2;
                    enemy.vx = Math.cos(ra) * (enemy.maxSpeed || enemy.speed || 100) * 0.5;
                    enemy.vy = Math.sin(ra) * (enemy.maxSpeed || enemy.speed || 100) * 0.5;
                }
            }

            enemy._stuckTimer = 0;
            enemy._lastX = enemy.x;
            enemy._lastY = enemy.y;
        }
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
     * [FIX] 单位间排斥：避免多个敌人堆叠在一起
     * 只检查附近 5 个单位（性能考虑），返回排斥方向
     */
    _computeSeparation(enemy, minDist) {
        let rdx = 0, rdy = 0, count = 0;
        if (!Game || !Game.entities) return { dx: 0, dy: 0 };
        const entities = Game.entities;
        let checked = 0;
        for (const other of entities.values()) {
            if (other === enemy || !other.active || other.hp <= 0) continue;
            if (other._faction !== enemy._faction) continue;
            const dx = enemy.x - other.x;
            const dy = enemy.y - other.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist && dist > 0) {
                rdx += dx / dist;
                rdy += dy / dist;
                count++;
            }
            if (++checked >= 5) break; // 性能：只检查 5 个单位
        }
        if (count === 0) return { dx: 0, dy: 0 };
        const len = Math.sqrt(rdx * rdx + rdy * rdy);
        if (len > 0) { rdx /= len; rdy /= len; }
        return { dx: rdx, dy: rdy };
    },

    /**
     * 沿路径移动（支持 PathManager 和旧路径兼容）
     */
    _followPath(enemy, dt) {
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
                if (tdist > targetDist + 80) {
                    // 太远：正常路径靠近（moveX/moveY 已计算）
                } else if (tdist < targetDist - 80) {
                    // 太近：后退
                    moveX = -Math.cos(angleToTarget);
                    moveY = -Math.sin(angleToTarget);
                } else {
                    // 在绕圈范围内：路径方向与绕圈方向融合
                    const circleDir = enemy._circleDir || (enemy._circleDir = Math.random() > 0.5 ? 1 : -1);
                    const circleAngle = angleToTarget + circleDir * Math.PI / 2;
                    // 微调距离到目标半径
                    const distDiff = tdist - targetDist;
                    const adjustStrength = Math.max(-0.5, Math.min(0.5, distDiff / 100));
                    moveX = Math.cos(circleAngle) * 0.8 + Math.cos(angleToTarget) * adjustStrength * 0.2;
                    moveY = Math.sin(circleAngle) * 0.8 + Math.sin(angleToTarget) * adjustStrength * 0.2;
                    // 归一化
                    const len = Math.sqrt(moveX * moveX + moveY * moveY);
                    if (len > 0) { moveX /= len; moveY /= len; }
                }
            }

            const maxSpd = enemy.maxSpeed || enemy.speed || 100;
            enemy.vx += (moveX * maxSpd - enemy.vx) * (enemy.accel || 0.7);
            enemy.vy += (moveY * maxSpd - enemy.vy) * (enemy.accel || 0.7);
            const sc = dt / 1000;
            let nx = enemy.x + enemy.vx * sc;
            let ny = enemy.y + enemy.vy * sc;
            if (WallSystem && WallSystem.resolve) {
                const er = WallSystem.resolve(enemy.x, enemy.y, nx, ny, enemy.collisionRadius || 12);
                if (er.x !== enemy.x || er.y !== enemy.y) {
                    const maxStep = maxSpd * sc;
                    const clamped = this._clampMoveDistance(enemy.x, enemy.y, er.x, er.y, maxStep);
                    enemy.x = clamped.x;
                    enemy.y = clamped.y;
                } else {
                    // 被墙完全挡住：路径失效，让 PathManager 重新规划
                    if (enemy._pathManager) {
                        enemy._pathManager._clearPath();
                    }
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
            return;
        }

        // 兼容性：旧路径系统（已废弃，PathManager 全面接管）
        // 清理：enemy._path / enemy._pathIdx 不再使用，全部由 enemy._pathManager 接管
        // 如果 PathManager 没有路径，_followPath 会返回并继续执行 _applyNormalMovement
    },

    /**
     * 应用正常移动（加速度 + 摩擦 + 墙壁碰撞）
     */
    _applyNormalMovement(enemy, dt, dx, dy, dist) {
        const maxSpd = enemy.maxSpeed || enemy.speed || 100;
        let moveX = dx / Math.max(dist, 1);
        let moveY = dy / Math.max(dist, 1);

        // [SPITTER] 绕圈逻辑：当敌人有 _circleRadius 时，在目标周围保持一定距离绕圈移动，不贴身
        if (enemy._circleRadius && enemy.target && enemy.target.active && dist > 0) {
            const targetDist = enemy._circleRadius;
            const angleToTarget = Math.atan2(dy, dx);
            if (dist > targetDist + 80) {
                // 距离太远：正常靠近（moveX/moveY 已计算）
            } else if (dist < targetDist - 80) {
                // 距离太近：后退
                moveX = -Math.cos(angleToTarget);
                moveY = -Math.sin(angleToTarget);
            } else {
                // 在目标距离范围内：绕圈移动
                const circleDir = enemy._circleDir || (enemy._circleDir = Math.random() > 0.5 ? 1 : -1);
                const circleAngle = angleToTarget + circleDir * Math.PI / 2;
                // 微调距离到目标半径
                const distDiff = dist - targetDist;
                const adjustStrength = Math.max(-0.5, Math.min(0.5, distDiff / 100));
                moveX = Math.cos(circleAngle) * 0.8 + Math.cos(angleToTarget) * adjustStrength * 0.2;
                moveY = Math.sin(circleAngle) * 0.8 + Math.sin(angleToTarget) * adjustStrength * 0.2;
                // 归一化
                const len = Math.sqrt(moveX * moveX + moveY * moveY);
                if (len > 0) { moveX /= len; moveY /= len; }
            }
        }

        // [FIX] 单位间简单排斥：避免多个敌人堆叠
        const repel = this._computeSeparation(enemy, 30);
        if (repel.dx !== 0 || repel.dy !== 0) {
            moveX += repel.dx * 0.5;
            moveY += repel.dy * 0.5;
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
            const er = WallSystem.resolve(enemy.x, enemy.y, nx, ny, enemy.collisionRadius || 12);

            if (er.x === enemy.x && er.y === enemy.y) {
                // [SLIDE] 沿墙滑动：分解为 x 和 y 方向分别检测
                // 当目标方向被墙完全挡住时，保留可移动方向的分量
                const xSlide = WallSystem.resolve(enemy.x, enemy.y, enemy.x + enemy.vx * sc, enemy.y, enemy.collisionRadius || 12);
                const ySlide = WallSystem.resolve(enemy.x, enemy.y, enemy.x, enemy.y + enemy.vy * sc, enemy.collisionRadius || 12);
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
        return WallSystem.blocked(enemy.x, enemy.y, target.x, target.y);
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
        const r = enemy.collisionRadius || 12;

        // 尝试X方向
        const xRes = WallSystem && WallSystem.resolve
            ? WallSystem.resolve(enemy.x, enemy.y, enemy.x + desiredVx * sc, enemy.y, r)
            : { x: enemy.x + desiredVx * sc, y: enemy.y };

        // 尝试Y方向
        const yRes = WallSystem && WallSystem.resolve
            ? WallSystem.resolve(enemy.x, enemy.y, enemy.x, enemy.y + desiredVy * sc, r)
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

        const maxSpd = enemy.maxSpeed || enemy.speed || 100;
        enemy.vx += (dx / dist * maxSpd - enemy.vx) * (enemy.accel || 0.7);
        enemy.vy += (dy / dist * maxSpd - enemy.vy) * (enemy.accel || 0.7);

        const sc = dt / 1000;
        const nx = enemy.x + enemy.vx * sc;
        const ny = enemy.y + enemy.vy * sc;

        if (WallSystem && WallSystem.resolve) {
            const er = WallSystem.resolve(enemy.x, enemy.y, nx, ny, enemy.collisionRadius || 12);
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

        const maxSpd = (enemy.maxSpeed || enemy.speed || 100) * 0.3;
        enemy.vx += (dx / dist * maxSpd - enemy.vx) * (enemy.accel || 0.7);
        enemy.vy += (dy / dist * maxSpd - enemy.vy) * (enemy.accel || 0.7);

        const sc = dt / 1000;
        const nx = enemy.x + enemy.vx * sc;
        const ny = enemy.y + enemy.vy * sc;

        if (WallSystem && WallSystem.resolve) {
            const er = WallSystem.resolve(enemy.x, enemy.y, nx, ny, enemy.collisionRadius || 12);
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

        const maxSpd = enemy.maxSpeed || enemy.speed || 100;
        enemy.vx += (moveDx / moveDist * maxSpd - enemy.vx) * (enemy.accel || 0.7);
        enemy.vy += (moveDy / moveDist * maxSpd - enemy.vy) * (enemy.accel || 0.7);

        const sc = dt / 1000;
        const nx = enemy.x + enemy.vx * sc;
        const ny = enemy.y + enemy.vy * sc;

        if (WallSystem && WallSystem.resolve) {
            const er = WallSystem.resolve(enemy.x, enemy.y, nx, ny, enemy.collisionRadius || 12);
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

        const maxSpd = enemy.maxSpeed || enemy.speed || 100;
        enemy.vx += (moveDx * maxSpd - enemy.vx) * (enemy.accel || 0.7);
        enemy.vy += (moveDy * maxSpd - enemy.vy) * (enemy.accel || 0.7);

        const sc = dt / 1000;
        const nx = enemy.x + enemy.vx * sc;
        const ny = enemy.y + enemy.vy * sc;

        if (WallSystem && WallSystem.resolve) {
            const er = WallSystem.resolve(enemy.x, enemy.y, nx, ny, enemy.collisionRadius || 12);
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
