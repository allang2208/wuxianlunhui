import { WEAPON_ANIM } from '../config/math-utils.js';
import { WallSystem } from '../world/wall-system.js';
import { Easing } from '../config/math-utils.js';
import { distanceToEntityShape } from '../utils/collision-helpers.js';
import { nowMs } from '../entities/player/anim-state.js';

/**
 * CombatSystem — 敌人战斗AI子系统（精简版）
 *
 * 职责：只负责战斗执行相关逻辑，不处理感知/移动/决策
 * 1. Dash 眩晕计时
 * 2. 攻击执行（冷却检查、视线检测、攻击触发）
 * 3. 武器动画状态机
 * 4. 攻击冷却更新
 * 5. 换弹更新
 * （状态效果更新已统一移至 DamageableEntity.update() 处理）
 *
 * 设计原则：
 * - 通过操作 enemy 实例的属性来共享状态，不直接互相调用
 * - 统一接口: update(enemy, dt, entities)
 * - 时间单位: 毫秒
 * - 全局变量使用 typeof 检查存在性
 */

class CombatSystemImpl {
    constructor() {}

    /**
     * 主更新入口
     * 注意：在调用 CombatSystem 之前，PerceptionSystem 和 DecisionSystem 应已完成
     * 目标选择和决策，MovementSystem 应已完成移动
     * @param {Enemy} enemy - 敌人实例
     * @param {number} dt - 时间间隔（毫秒）
     * @param {Map} entities - 所有实体
     */
    update(enemy, dt, entities) {
        if (!enemy || !enemy.active) return;
        if (enemy.hp <= 0) return;

        // 1. Dash 眩晕
        this._updateDashStun(enemy, dt);

        // 2. 眩晕状态：不执行战斗行为
        if (enemy.hasStatusEffect && (enemy.hasStatusEffect('stun') || enemy.hasStatusEffect('frozen'))) return;

        // 3. 攻击执行（需要目标存在且有视线）
        this._updateAttack(enemy, dt, entities);

        // 4. 更新攻击冷却和武器动画
        this._updateAttacks(enemy, dt);
        this._updateWeaponAnim(enemy, dt);
        this._updateReload(enemy, dt);

        // [NOTE] 状态效果更新（中毒、流血、易伤）已移至 DamageableEntity.update() 统一处理
    }

    // --- 朝向检查 ---
    _isFacingTarget(enemy, targetX, targetY) {
        if (enemy.rotation === undefined) return true;
        const dx = targetX - enemy.x;
        const dy = targetY - enemy.y;
        if (dx === 0 && dy === 0) return true;
        const targetAngle = Math.atan2(dy, dx);
        let diff = targetAngle - enemy.rotation;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        // 允许 30° 误差，避免轻微抖动导致无法攻击
        return Math.abs(diff) <= Math.PI / 6;
    }

    // --- Dash 眩晕 ---
    _updateDashStun(enemy, dt) {
        if (!enemy._dashStunned) return;
        enemy._dashStunTimer -= dt;
        if (enemy._dashStunTimer <= 0) enemy._dashStunned = false;
    }

    // --- 攻击执行 ---
    _updateAttack(enemy, dt, entities) {
        if (enemy._attackAnimTimer > 0 || enemy._frozenForCast) return;
        enemy.aiTimer += dt;
        if (enemy.aiTimer < enemy.aiInterval) return;
        // 需要目标存在
        if (!enemy.target || !enemy.target.active) {
            return;
        }
        const targetX = enemy.target.x;
        const targetY = enemy.target.y;
        // [ENHANCE] 距离检查：使用目标碰撞形状计算最短距离，增加 15% 攻击缓冲
        // 优先使用新的攻击距离字段；若未配置则回退到 attackRange
        const effectiveRange = enemy.attackDistance !== undefined ? enemy.attackDistance : enemy.attackRange * 1.15;
        if (distanceToEntityShape(enemy.target, enemy.x, enemy.y) > effectiveRange) {
            return;
        }
        // === REFACTOR[combat-system]: 复用 PerceptionSystem LOS 缓存，减少 WallSystem.blocked 调用 ===
        // [FIX-LOS] 防守结构（掩体/基地）贴身免 LOS：footprint 距离在 effectiveRange 内即代表贴身，
        // 墙体静止不会躲；掩体中心位于自身 face 线后方，从墙背面接近时到中心的射线必穿自身/相邻
        // 掩体段，射线判定会永远误挡（2026-08-08 实机复现：僵尸贴背啃不动相邻掩体）
        const _losExempt = !!enemy.target._isDefenseStructure
            && distanceToEntityShape(enemy.target, enemy.x, enemy.y) <= effectiveRange;
        let isBlocked = false;
        if (!_losExempt) {
            const losCache = enemy._perception && enemy._perception.losCache;
            const cachedLos = losCache ? losCache.get(enemy.target.id) : null;
            if (cachedLos) {
                // 缓存命中：直接复用 PerceptionSystem 的 LOS 结果
                isBlocked = !cachedLos.result;
            } else {
                // 缓存未命中：fallback 到 WallSystem 直接检测（掩体目标忽略自身墙段，同上）
                const ignore = enemy.target._coverSeg ? { segs: new Set([enemy.target._coverSeg]) } : null;
                isBlocked = WallSystem && WallSystem.blocked(enemy.x, enemy.y, targetX, targetY, ignore);
            }
        }
        // === END REFACTOR ===
        if (isBlocked) {
            return;
        }

        // [ENHANCE] 攻击前必须面向目标；若朝向偏差过大，先瞬间转向目标再出手
        if (!this._isFacingTarget(enemy, targetX, targetY)) {
            const dx = targetX - enemy.x;
            const dy = targetY - enemy.y;
            enemy.rotation = Math.atan2(dy, dx);
        }

        // === 真实武器系统路径（HumanoidMonster 等使用玩家同款武器）===
        if (enemy._isHumanoid && typeof enemy.fireProjectile === 'function') {
            enemy.aiTimer = 0;
            // AI 射击精度：根据角色和距离设置散布
            const accuracyDist = Math.sqrt((targetX - enemy.x)**2 + (targetY - enemy.y)**2);
            let accuracyFactor = 0;
            if (enemy._tacticalRole === 'shieldBearer') {
                accuracyFactor = 0.05;
            } else if (enemy._tacticalRole === 'rifleman' || enemy._tacticalRole === 'flankRifleman') {
                accuracyFactor = Math.min(1, accuracyDist / 1000) * 0.5;
            } else if (enemy._tacticalRole === 'machineGunner') {
                accuracyFactor = Math.min(1, accuracyDist / 1200) * 0.7;
            } else if (enemy._tacticalRole === 'commander') {
                accuracyFactor = Math.min(1, accuracyDist / 1000) * 0.4;
            }
            enemy._currentSpreadFactor = accuracyFactor;
            enemy._currentSpreadMaxAngle = 3 + accuracyFactor * 22;
            enemy.fireProjectile(targetX, targetY, entities, { slot: 'weapon' });
            return;
        }

        // === 传统敌人路径 ===
        const attack = enemy.attacks.ranged || enemy.attacks.melee;
        if (!attack || !attack.canUse()) {
            return;
        }
        enemy.aiTimer = 0;
        // 精英及以上经攻击预警延迟（Enemy._tryAttackTelegraph；普通怪内部直接执行）
        const fire = () => {
            if (attack.use(enemy, targetX, targetY, Array.from(entities.values()))) {
                if (typeof enemy.triggerWeaponAnim === 'function') enemy.triggerWeaponAnim();
            }
        };
        if (typeof enemy._tryAttackTelegraph === 'function') enemy._tryAttackTelegraph(fire);
        else fire();
    }
    // --- 攻击冷却更新 ---
    _updateAttacks(enemy, dt) {
        // 更新所有攻击类型的冷却（包括 HumanoidMonster 的 weaponType 键）
        for (const key in enemy.attacks) {
            if (enemy.attacks[key]) enemy.attacks[key].update(dt);
        }
    }

    // --- 武器动画 ---
    _updateWeaponAnim(enemy, dt) {
        const wa = WEAPON_ANIM ? WEAPON_ANIM : null;
        if (!wa) return;
        const anim = enemy.weaponAnim;
        if (!anim) return;
        switch (anim.state) {
            case 'idle':
                anim.angle = wa.idleAngle + Math.sin(Date.now() / 400) * 0.06;
                break;
            case 'windup':
                anim.timer += dt;
                if (anim.timer >= wa.windupMs) {
                    anim.state = 'swing';
                    anim.timer = 0;
                } else {
                    anim.angle = wa.idleAngle + (wa.windupAngle - wa.idleAngle) * Easing.easeInQuad(anim.timer / wa.windupMs);
                }
                break;
                    case 'swing':
                        anim.timer += dt;
                        if (enemy._pendingThrust && enemy._pendingThrust.active) {
                            // [FIX] startTime 已统一为单调时钟 nowMs()（2026-08-14 Phase 3），
                            // 这里必须同源——用 Date.now() 减 performance.now() 恒为巨数，
                            // 判定窗口永远过期 → checkTriangleHit 永不执行（动画照播、命中零伤害，
                            // 2026-08-16 世界-122 实机复现：僵尸啃掩体/门不出伤害）
                            if (nowMs() - enemy._pendingThrust.startTime <= 200) {
                                if (enemy.attacks.melee) enemy.attacks.melee.checkTriangleHit(enemy);
                            } else {
                                enemy._pendingThrust.active = false;
                    }
                }
                if (anim.timer >= wa.swingMs) {
                    anim.state = 'recover';
                    anim.timer = 0;
                    if (enemy._pendingThrust) {
                        enemy._pendingThrust.active = false;
                        if (enemy.attacks.melee) enemy.attacks.melee.giveExp(enemy);
                    }
                } else {
                    anim.angle = wa.windupAngle + (wa.swingAngle - wa.windupAngle) * Easing.easeOutQuad(anim.timer / wa.swingMs);
                }
                break;
            case 'recover':
                anim.timer += dt;
                if (anim.timer >= wa.recoverMs) {
                    anim.state = 'idle';
                    anim.timer = 0;
                } else {
                    anim.angle = wa.swingAngle + (wa.idleAngle - wa.swingAngle) * Easing.easeInOutCubic(anim.timer / wa.recoverMs);
                }
                break;
        }
    }

    // --- 换弹 ---
    _updateReload(enemy, dt) {
        if (typeof enemy._updateReload === 'function') {
            enemy._updateReload(dt);
        }
    }
}

/** 导出单例 */
export const CombatSystem = new CombatSystemImpl();
