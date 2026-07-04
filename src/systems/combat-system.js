/**
 * CombatSystem — 敌人战斗AI子系统（精简版）
 *
 * 职责：只负责战斗执行相关逻辑，不处理感知/移动/决策
 * 1. Dash 眩晕计时
 * 2. 攻击执行（冷却检查、视线检测、攻击触发）
 * 3. 武器动画状态机
 * 4. 攻击冷却更新
 * 5. 换弹更新
 * 6. 状态效果更新（中毒、流血、魔法易伤、无人机易伤）
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
        if (enemy.hasStatusEffect && enemy.hasStatusEffect('stun')) return;

        // 3. 攻击执行（需要目标存在且有视线）
        this._updateAttack(enemy, dt, entities);

        // 4. 更新攻击冷却和武器动画
        this._updateAttacks(enemy, dt);
        this._updateWeaponAnim(enemy, dt);
        this._updateReload(enemy, dt);

        // 5. 状态效果更新
        this._updatePoison(enemy, dt);
        this._updateBleed(enemy, dt);
        this._updateMagicVulnerability(enemy, dt);
        this._updateDroneVulnerability(enemy, dt);
    }

    // --- Dash 眩晕 ---
    _updateDashStun(enemy, dt) {
        if (!enemy._dashStunned) return;
        enemy._dashStunTimer -= dt;
        if (enemy._dashStunTimer <= 0) enemy._dashStunned = false;
    }

    // --- 攻击执行 ---
    _updateAttack(enemy, dt, entities) {
        enemy.aiTimer += dt;
        if (enemy.aiTimer < enemy.aiInterval) return;
        // 需要目标存在
        if (!enemy.target || !enemy.target.active) return;
        const targetX = enemy.target.x;
        const targetY = enemy.target.y;
        // 距离检查：超出攻击范围不攻击
        const dx = targetX - enemy.x, dy = targetY - enemy.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > enemy.attackRange) return;
        // === REFACTOR[combat-system]: 复用 PerceptionSystem LOS 缓存，减少 WallSystem.blocked 调用 ===
        let isBlocked;
        if (enemy._perception && enemy._perception.lastLOSTargetId === enemy.target.id) {
            // 缓存命中：直接复用 PerceptionSystem 的 LOS 结果
            isBlocked = !enemy._perception.lastLOSResult;
        } else {
            // 缓存未命中：fallback 到 WallSystem 直接检测
            isBlocked = typeof WallSystem !== 'undefined' && WallSystem.blocked(enemy.x, enemy.y, targetX, targetY);
        }
        // === END REFACTOR ===
        if (isBlocked) return;

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
        if (!attack || !attack.canUse()) return;
        enemy.aiTimer = 0;
        if (attack.use(enemy, targetX, targetY, Array.from(entities.values()))) {
            if (typeof enemy.triggerWeaponAnim === 'function') enemy.triggerWeaponAnim();
        }
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
        const wa = typeof WEAPON_ANIM !== 'undefined' ? WEAPON_ANIM : null;
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
                } else if (typeof easeInQuad === 'function') {
                    anim.angle = wa.idleAngle + (wa.windupAngle - wa.idleAngle) * easeInQuad(anim.timer / wa.windupMs);
                } else {
                    const t = anim.timer / wa.windupMs;
                    anim.angle = wa.idleAngle + (wa.windupAngle - wa.idleAngle) * (t * t);
                }
                break;
            case 'swing':
                anim.timer += dt;
                if (anim.timer === 0 && enemy._pendingThrust) enemy._pendingThrust.active = true;
                if (enemy._pendingThrust && enemy._pendingThrust.active) {
                    if (Date.now() - enemy._pendingThrust.startTime <= 200) {
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
                } else if (typeof easeOutQuad === 'function') {
                    anim.angle = wa.windupAngle + (wa.swingAngle - wa.windupAngle) * easeOutQuad(anim.timer / wa.swingMs);
                } else {
                    const t = anim.timer / wa.swingMs;
                    anim.angle = wa.windupAngle + (wa.swingAngle - wa.windupAngle) * (1 - (1 - t) * (1 - t));
                }
                break;
            case 'recover':
                anim.timer += dt;
                if (anim.timer >= wa.recoverMs) {
                    anim.state = 'idle';
                    anim.timer = 0;
                } else if (typeof easeInOutCubic === 'function') {
                    anim.angle = wa.swingAngle + (wa.idleAngle - wa.swingAngle) * easeInOutCubic(anim.timer / wa.recoverMs);
                } else {
                    const t = anim.timer / wa.recoverMs;
                    const et = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
                    anim.angle = wa.swingAngle + (wa.idleAngle - wa.swingAngle) * et;
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

    // --- 状态效果：中毒 ---
    _updatePoison(enemy, dt) {
        if (enemy._poisonStacks <= 0) return;
        enemy._poisonTimer -= dt;
        enemy._poisonTickTimer -= dt;
        if (enemy._poisonEffect) enemy._poisonEffect.update(dt, 0, -enemy.size);
        if (enemy._poisonTickTimer <= 0) {
            enemy.hp -= enemy._poisonStacks;
            if (typeof EffectManager !== 'undefined' && EffectManager.add) {
                EffectManager.add(new FloatingTextEffect(enemy.x, enemy.y - enemy.size, `-${enemy._poisonStacks}`, '#39ff14'));
            }
            enemy._poisonTickTimer = 1000;
            if (enemy.hp <= 0) {
                enemy.hp = 0;
                if (typeof enemy.onDeath === 'function') enemy.onDeath();
            }
        }
        if (enemy._poisonTimer <= 0) {
            enemy._poisonStacks = Math.max(0, enemy._poisonStacks - 1);
            if (enemy._poisonStacks > 0) {
                enemy._poisonTimer = 5000;
            } else {
                if (enemy._poisonEffectId) {
                    if (typeof StatusBar !== 'undefined' && StatusBar.removeEffect) StatusBar.removeEffect(enemy._poisonEffectId);
                    enemy._poisonEffectId = null;
                }
                if (enemy._poisonEffect) enemy._poisonEffect.reset();
            }
        }
    }

    // --- 状态效果：流血 ---
    _updateBleed(enemy, dt) {
        if (enemy._bleedStacks <= 0) return;
        enemy._bleedTimer -= dt;
        enemy._bleedTickTimer -= dt;
        if (enemy._bleedTickTimer <= 0) {
            const dmg = Math.max(1, Math.floor(enemy.hp * 0.1));
            enemy.hp -= dmg;
            if (typeof EffectManager !== 'undefined' && EffectManager.add) {
                EffectManager.add(new FloatingTextEffect(enemy.x, enemy.y - enemy.size, `-${dmg}`, '#9a3a3a'));
            }
            enemy._bleedTickTimer = 1000;
        }
        if (enemy._bleedTimer <= 0) {
            enemy._bleedStacks = Math.max(0, enemy._bleedStacks - 1);
            if (enemy._bleedStacks > 0) {
                enemy._bleedTimer = 5000;
                if (enemy._bleedEffectId && typeof StatusBar !== 'undefined' && StatusBar.updateEffectStacks) {
                    StatusBar.updateEffectStacks('bleed', enemy._bleedStacks);
                }
            } else {
                if (enemy._bleedEffectId) {
                    if (typeof StatusBar !== 'undefined' && StatusBar.removeEffect) StatusBar.removeEffect(enemy._bleedEffectId);
                    enemy._bleedEffectId = null;
                }
            }
        }
    }

    // --- 状态效果：魔法易伤 ---
    _updateMagicVulnerability(enemy, dt) {
        if (enemy._magicVulnerabilityStacks <= 0) return;
        enemy._magicVulnerabilityTimer -= dt;
        if (enemy._magicVulnerabilityTimer <= 0) {
            enemy._magicVulnerabilityStacks = Math.max(0, enemy._magicVulnerabilityStacks - 1);
            if (enemy._magicVulnerabilityStacks > 0) enemy._magicVulnerabilityTimer = 5000;
        }
    }

    // --- 状态效果：无人机易伤 ---
    _updateDroneVulnerability(enemy, dt) {
        if (enemy._droneVulnerabilityStacks <= 0) return;
        enemy._droneVulnerabilityTimer -= dt;
        if (enemy._droneVulnerabilityTimer <= 0) {
            enemy._droneVulnerabilityStacks = Math.max(0, enemy._droneVulnerabilityStacks - 1);
            if (enemy._droneVulnerabilityStacks > 0) enemy._droneVulnerabilityTimer = 5000;
        }
    }
}

/** 导出单例 */
export const CombatSystem = new CombatSystemImpl();
