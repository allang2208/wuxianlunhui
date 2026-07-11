import { WEAPON_ANIM } from '../../config/math-utils.js';
import { Game } from '../../game.js';
import { WallSystem } from '../../world/wall-system.js';
import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { AttackRangeEffect } from '../../effects/attack-range-effect.js';
import { SmokeEffect } from '../../effects/smoke-effect.js';
import { isRifle } from '../../config/gun-ammo.js';
import { DashFireTrailEffect, GoldenConvergeEffect } from '../../effects/dash-effects.js';
import { MathUtils, Easing } from '../../config/math-utils.js';
import { WeaponAnimConfig } from '../../items/weapon-anim-config.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { BloodHitEffect as HitEffect, BloodHitEffect as CritEffect } from '../../effects/blood-hit-effect.js';
class DashSystem {
    constructor(player) {
        this.player = player;
    }

    trigger(entities) {
        if (this.player._specialAttackActive) return; // 夜与火之剑特殊攻击期间禁止冲刺攻击
        // 使用鼠标方向（当前朝向）作为冲刺方向
        let dirX = Math.cos(this.player.rotation), dirY = Math.sin(this.player.rotation);
        this.player._isDashing = true;
        this.player._dashState = 'charge';
        this.player._dashTimer = 0;
        this.player._dashDirection = { x: dirX, y: dirY };
        this.player._dashStartPos = { x: this.player.x, y: this.player.y };
        this.player._dashHitSet = new Set();
        this.player._dashKillCount = 0;
        this.player._dashRangeShown = false;
        this.player._dashSlashShown = false;
        this.player._dashBounceApplied = false;
        this.player._dashSlashPos = null;
        this.player._dashSlashEffect = null; // 重置扇形特效引用
        this.player._goldenConvergeEffect = null; // 重置金色汇聚特效引用
        this.player._sprintDuration = 0;
        // 应用改造效果：技能体力消耗
        const currentWeapon = this.player.equipments[this.player.weaponMode];
        let staminaCost = 20;
        if (currentWeapon && currentWeapon._craftEffects) {
            const ce = currentWeapon._craftEffects;
            if (ce.skillStaminaCostDelta) staminaCost += ce.skillStaminaCostDelta;
            if (ce.staminaCostDelta) staminaCost += ce.staminaCostDelta;
        }
        if (staminaCost < 0) staminaCost = 0;
        this.player.data.stamina -= staminaCost;
        if (this.player.data.stamina < 0) this.player.data.stamina = 0;
        
        this.player._dashConvergeShown = false;
        this.player._dashConvergeAuraActive = false;
        // 初始化矩形突刺持续判定状态
        this.player._dashThrustPhase = null;
        this.player._dashSlashStartTime = null;
        // 冲刺攻击-火：重置火焰轨迹计时器
        this.player._dashFireTrailTimer = 0;
    }

    _getDashWeaponStateAt(timer, skillId) {
        // 未传入 skillId 时，根据当前装备自动判断
        const activeSkillId = skillId || this.player._getActiveDashSkillId();
        const dashProgress = Math.min(1, timer / 800);
        let dashOffset = 0, dashAngle = 0;
        
        
        if (activeSkillId === 'dashAttackThrust') {
            // === 突刺动画（骑士长剑专属） ===
            // 坐标系：rotate(Math.PI/2) 后，Y轴向左（屏幕左），X轴向下
            // dashOffset > 0 = 向左（靠近玩家）= "后"
            // dashOffset < 0 = 向右（远离玩家）= "前"
            const totalMs = this.player._getSkillParam('dashAttackThrust', 'animation.totalMs', 600);
            const t = Math.min(1, timer / totalMs);
            dashOffset = -95 * Easing.easeOutQuad(t);
            dashAngle = 0;
        } else {
            // === 默认 dashAttack：武器在朝向方向以120度扇形划过 ===
            // dashAngle: -60° → +60°（以朝向为中心，总120°扇形）
            dashAngle = -Math.PI / 3 + (2 * Math.PI / 3) * Easing.easeInOutCubic(dashProgress);
            // dashOffset: 武器前后位移动画（蓄力前伸 → 挥砍 → 收回）
            if (dashProgress < 0.25) {
                const t = dashProgress / 0.25;
                dashOffset = 15 * Easing.easeOutQuad(t);
            } else if (dashProgress < 0.75) {
                dashOffset = 15;
            } else {
                const t = (dashProgress - 0.75) / 0.25;
                dashOffset = 15 - 60 * Easing.easeOutQuad(t);
            }
        }
        return { dashOffset, dashAngle };
    }

    update(dt, entities) {
        if (!this.player._isDashing) return;
        const activeSkillId = this.player._getActiveDashSkillId();
        const isThrust = activeSkillId === 'dashAttackThrust';
        const isFire = activeSkillId === 'dashAttackFire';
        const currentWeapon = this.player.equipments[this.player.weaponMode];
        const isMeleeWeapon = currentWeapon && (currentWeapon.category === 'weapon_melee' || currentWeapon.weaponType === 'sword');
        const hasDashSkill = this.player.skills && this.player.skills[activeSkillId];
        if (!isMeleeWeapon || !hasDashSkill) {
            this.player._isDashing = false;
            this.player._dashState = 'idle';
            this.player._dashTimer = 0;
            this.player._dashBounceApplied = false;
            this.player._dashSlashPos = null;
            this.player._dashSlashEffect = null;
            this.player._dashThrustPhase = null;
            this.player._dashSlashStartTime = null;
            if (isThrust) SkillManager.addDashThrustExp(this.player, this.player._dashHitSet.size, 0);
            else SkillManager.addDashExp(this.player, this.player._dashHitSet.size, 0);
            return;
        }
        this.player._dashTimer += dt;
        const skill = this.player.skills[activeSkillId];
        const effect = skill.getEffect(skill.level);
        if (isThrust) {
            // === 冲刺攻击-突刺（骑士长剑专属）===
            const totalMs = this.player._getSkillParam('dashAttackThrust', 'animation.totalMs', 600);
            const progress = this.player._dashTimer / totalMs;
            const chargeMs = this.player._getSkillParam('dashAttackThrust', 'animation.chargeMs', 0);
            const chargeRatio = chargeMs / totalMs;
            if (progress < chargeRatio) {
                this.player._dashState = 'rotate';
            } else if (progress < 1.0) {
                if (this.player._dashState !== 'slash') {
                    this.player._dashSlashPos = { x: this.player.x, y: this.player.y };
                    // 动态计算剑尖位置：基于当前武器状态实时检测武器贴图位置
                    const state = this._getDashWeaponStateAt(this.player._dashTimer, activeSkillId);
                    const s = WEAPON_ANIM.size;
                    const ms = s * 0.75;
                    // 剑尖位置 = 武器基础偏移 + 武器中心偏移 + 剑尖到武器中心距离
                    // 基于 renderWeapon 中的变换逻辑推导
                    const convergeX = (WEAPON_ANIM.holdX + 8) + ms * 0.85 - state.dashOffset + ms / 2;
                    const convergeY = (WEAPON_ANIM.holdY + 6);
                    const effectX = this.player.x;
                    const effectY = this.player.y;
                    const speedDuration = Math.round(1600 / 1.5); // 播放速度提高50%
                    this.player._goldenConvergeEffect = new GoldenConvergeEffect(effectX, effectY, this.player._dashDirection.x, this.player._dashDirection.y, this.player, speedDuration, convergeX, convergeY);
                    EffectManager.add(this.player._goldenConvergeEffect);
                    if (Game.showAttackRange) {
                        const attackAngle = Math.atan2(this.player._dashDirection.y, this.player._dashDirection.x);
                        const rectLength = this.player._getSkillParam('dashAttackThrust', 'hitCheck.length', 500) + this.player._getSkillParam('dashAttackThrust', 'hitCheck.lengthBonus', 0);
                        const hitArc = 2 * Math.PI / 3; // 120度扇形
                        EffectManager.add(new AttackRangeEffect(this.player._dashSlashPos.x, this.player._dashSlashPos.y, attackAngle, rectLength, hitArc, 'sector', 1000, 0.5, true));
                    }
                }
                this.player._dashState = 'slash';
            } else {
                const endState = this._getDashWeaponStateAt(this.player._dashTimer, activeSkillId);
                this.player._isDashing = false;
                this.player._dashState = 'idle';
                this.player._dashTimer = 0;
                this.player._dashBounceApplied = false;
                this.player._dashParticles = [];
                this.player._dashSlashEffect = null;
                this.player._dashThrustPhase = null;
                this.player._goldenConvergeEffect = null;
            this.player._dashSlashStartTime = null;
                this.player._dashResetAnim = {
                    startOffset: endState.dashOffset,
                    startAngle: endState.dashAngle || Math.PI / 1800,
                    startRotation: this.player.rotation,
                    targetRotation: (() => { const sp = Renderer.worldToScreen(this.player.x, this.player.y); return Math.atan2(Input.mouse.y - sp.y, Input.mouse.x - sp.x); })(),
                    startTime: Date.now(),
                    duration: (WeaponAnimConfig.stab && WeaponAnimConfig.stab.recoverMs) || 500
                };
                SkillManager.addDashThrustExp(this.player, this.player._dashHitSet.size, 0);
                // 剑精通经验（突刺攻击命中）
                if (this.player._dashThrustPhase) {
                    SkillManager.addMeleeExp(this.player, this.player._dashThrustPhase.totalHitCount, this.player._dashThrustPhase.totalKillCount);
                }
                return;
            }
            // 移动：前40%时间完成150px位移，速度递减
            const dashDist = this.player._getSkillParam('dashAttackThrust', 'animation.dashDist', 188);
            if (progress < 0.40) {
                const moveProgress = progress / 0.40;
                const easedProgress = Easing.easeOutQuad(moveProgress);
                const speedMul = 0.75;
                const targetX = this.player._dashStartPos.x + this.player._dashDirection.x * dashDist * speedMul * easedProgress;
                const targetY = this.player._dashStartPos.y + this.player._dashDirection.y * dashDist * speedMul * easedProgress;
                const resolved = WallSystem.resolve(this.player._dashStartPos.x, this.player._dashStartPos.y, targetX, targetY, this.player.collisionRadius);
                const hitWall = Math.abs(resolved.x - targetX) > 1 || Math.abs(resolved.y - targetY) > 1;
                if (hitWall && !this.player._dashBounceApplied) {
                    this.player._dashBounceApplied = true;
                    const bounceDist = dashDist * speedMul * easedProgress * 0.3;
                    const bounceX = this.player.x - this.player._dashDirection.x * bounceDist;
                    const bounceY = this.player.y - this.player._dashDirection.y * bounceDist;
                    const br = WallSystem.resolve(this.player.x, this.player.y, bounceX, bounceY, this.player.collisionRadius);
                    this.player.x = br.x; this.player.y = br.y;
                    EffectManager.add(new SmokeEffect(resolved.x, resolved.y));
                } else {
                    this.player.x = resolved.x; this.player.y = resolved.y;
                }
            }
            // 突刺阶段：判定窗口
            if (this.player._dashState === 'slash') {
                const thrustMs = this.player._getSkillParam('dashAttackThrust', 'animation.thrustMs', 600);
                const slashStart = chargeMs;
                const slashEnd = chargeMs + thrustMs;
                if (this.player._dashTimer >= slashStart && this.player._dashTimer <= slashEnd) {
                    this._checkHit(entities, activeSkillId);
                }
            }
        } else {
            // === 原始冲刺攻击（dashAttack）===
            const totalMs = 800;
            const progress = this.player._dashTimer / totalMs;
            const chargeRatio = 350 / 800;
            if (progress < chargeRatio) {
                this.player._dashState = 'charge';
            } else if (progress < 1.0) {
                if (this.player._dashState !== 'slash') {
                    this.player._dashSlashPos = { x: this.player.x, y: this.player.y };
                    if (Game.showAttackRange) {
                        const currentItem = this.player.equipments[this.player.weaponMode];
                        const baseRange = (currentItem && currentItem.attack && currentItem.attack.range)
                            || (this.player.attacks.melee && this.player.attacks.melee.config && this.player.attacks.melee.config.range)
                            || 206;
                        const skillLevel = skill.level;
                        const range = baseRange + 6 + skillLevel * 6 + 30;
                        const attackAngle = Math.atan2(this.player._dashDirection.y, this.player._dashDirection.x);
                        const hitArc = 2 * Math.PI / 3;
                        EffectManager.add(new AttackRangeEffect(this.player._dashSlashPos.x, this.player._dashSlashPos.y, attackAngle, range, hitArc, 'sector', 1000, 0.5, true));
                    }
                }
                this.player._dashState = 'slash';
                if (isFire) {
                    this._spawnFireTrail();
                }
                if (!this.player._dashSlashStartTime) {
                    this.player._dashSlashStartTime = Date.now();
                }
            } else {
                const endState = this._getDashWeaponStateAt(this.player._dashTimer, activeSkillId);
                this.player._isDashing = false;
                this.player._dashState = 'idle';
                this.player._dashTimer = 0;
                this.player._dashBounceApplied = false;
                this.player._dashParticles = [];
                this.player._dashSlashEffect = null;
                this.player._dashThrustPhase = null;
                this.player._goldenConvergeEffect = null;
            this.player._dashSlashStartTime = null;
                this.player._dashResetAnim = {
                    startOffset: endState.dashOffset,
                    startAngle: endState.dashAngle || Math.PI / 1800,
                    startRotation: this.player.rotation,
                    targetRotation: (() => { const sp = Renderer.worldToScreen(this.player.x, this.player.y); return Math.atan2(Input.mouse.y - sp.y, Input.mouse.x - sp.x); })(),
                    startTime: Date.now(),
                    duration: (WeaponAnimConfig.stab && WeaponAnimConfig.stab.recoverMs) || 500
                };
                SkillManager.addDashExp(this.player, this.player._dashHitSet.size, this.player._dashKillCount);
                // 剑精通经验（冲刺攻击命中，只在攻击结束时发放一次）
                SkillManager.addMeleeExp(this.player, this.player._dashHitSet.size, this.player._dashKillCount);
                return;
            }
            // 移动：前40%时间完成位移，速度递减
            const dashDist = 188;
            if (progress < 0.40) {
                const moveProgress = progress / 0.40;
                const easedProgress = Easing.easeOutQuad(moveProgress);
                const speedMul = 0.75;
                const targetX = this.player._dashStartPos.x + this.player._dashDirection.x * dashDist * speedMul * easedProgress;
                const targetY = this.player._dashStartPos.y + this.player._dashDirection.y * dashDist * speedMul * easedProgress;
                const resolved = WallSystem.resolve(this.player._dashStartPos.x, this.player._dashStartPos.y, targetX, targetY, this.player.collisionRadius);
                const hitWall = Math.abs(resolved.x - targetX) > 1 || Math.abs(resolved.y - targetY) > 1;
                if (hitWall && !this.player._dashBounceApplied) {
                    this.player._dashBounceApplied = true;
                    const bounceDist = dashDist * speedMul * easedProgress * 0.3;
                    const bounceX = this.player.x - this.player._dashDirection.x * bounceDist;
                    const bounceY = this.player.y - this.player._dashDirection.y * bounceDist;
                    const br = WallSystem.resolve(this.player.x, this.player.y, bounceX, bounceY, this.player.collisionRadius);
                    this.player.x = br.x; this.player.y = br.y;
                    EffectManager.add(new SmokeEffect(resolved.x, resolved.y));
                } else {
                    this.player.x = resolved.x; this.player.y = resolved.y;
                }
                if (this.player._dashBounceApplied && progress > 0.1) {
                    const moved = Math.abs(resolved.x - this.player._dashStartPos.x) + Math.abs(resolved.y - this.player._dashStartPos.y);
                    if (moved < 2) {
                        const endState = this._getDashWeaponStateAt(this.player._dashTimer, activeSkillId);
                        this.player._isDashing = false;
                        this.player._dashState = 'idle';
                        this.player._dashTimer = 0;
                        this.player._dashBounceApplied = false;
                        this.player._dashSlashPos = null;
                        this.player._dashSlashEffect = null;
                        this.player._dashThrustPhase = null;
                        this.player._dashSlashStartTime = null;
                        this.player._dashResetAnim = {
                            startOffset: endState.dashOffset,
                            startAngle: endState.dashAngle || Math.PI / 1800,
                            startRotation: this.player.rotation,
                            targetRotation: (() => { const sp = Renderer.worldToScreen(this.player.x, this.player.y); return Math.atan2(Input.mouse.y - sp.y, Input.mouse.x - sp.x); })(),
                            startTime: Date.now(),
                            duration: (WeaponAnimConfig.stab && WeaponAnimConfig.stab.recoverMs) || 500
                        };
                        SkillManager.addDashExp(this.player, this.player._dashHitSet.size, 0);
                        return;
                    }
                }
            }
            // 挥砍阶段：扇形判定，判定窗口400ms
            if (this.player._dashState === 'slash') {
                // 动态更新金色汇聚特效的汇聚点位置，实时跟随剑尖
                if (this.player._goldenConvergeEffect && this.player._goldenConvergeEffect.active) {
                    const state = this._getDashWeaponStateAt(this.player._dashTimer, activeSkillId);
                    const s = WEAPON_ANIM.size;
                    const ms = s * 0.75;
                    const convergeX = (WEAPON_ANIM.holdX + 8) + ms * 0.85 - state.dashOffset + ms / 2;
                    const convergeY = (WEAPON_ANIM.holdY + 6);
                    this.player._goldenConvergeEffect.setConverge(convergeX, convergeY);
                }
                const slashElapsed = this.player._dashSlashStartTime ? Date.now() - this.player._dashSlashStartTime : 0;
                if (slashElapsed <= 400) {
                    this._checkHit(entities, activeSkillId);
                }
            }
        }
    }

    _checkHit(entities, skillId) {
        const activeSkillId = skillId || this.player._getActiveDashSkillId();
        const isThrust = activeSkillId === 'dashAttackThrust';
        const attackAngle = Math.atan2(this.player._dashDirection.y, this.player._dashDirection.x);
        const currentItem = this.player.equipments[this.player.weaponMode];
        const baseKnockback = (currentItem && currentItem.attack && currentItem.attack.knockback)
            || (this.player.attacks.melee && this.player.attacks.melee.config && this.player.attacks.melee.config.knockback)
            || 8;
        const skill = this.player.skills[activeSkillId];
        const skillLevel = skill.level;
        const knockback = baseKnockback + 188 + skillLevel * 6;
        const baseRange = (currentItem && currentItem.attack && currentItem.attack.range)
            || (this.player.attacks.melee && this.player.attacks.melee.config && this.player.attacks.melee.config.range)
            || 206;
        const range = baseRange + 6 + skillLevel * 6 + 30;
        if (isThrust) {
            // === 矩形持续判定（冲刺攻击-突刺）===
            const rectWidth = this.player._getSkillParam('dashAttackThrust', 'hitCheck.width', 94);
            let rectLength = this.player._getSkillParam('dashAttackThrust', 'hitCheck.length', 438) + this.player._getSkillParam('dashAttackThrust', 'hitCheck.lengthBonus', 0);
            // 应用改造效果：攻击距离
            if (currentItem && currentItem._craftEffects && currentItem._craftEffects.rangeDelta) {
                rectLength += currentItem._craftEffects.rangeDelta;
            }
            const cos = Math.cos(attackAngle), sin = Math.sin(attackAngle);
            const halfW = rectWidth / 2;
            if (!this.player._dashThrustPhase) {
                this.player._dashThrustPhase = { startTime: Date.now(), lastHitIndex: -1, totalHitCount: 0, totalKillCount: 0, hitTargets: new Set() };
            }
            const phase = this.player._dashThrustPhase;
            const elapsed = Date.now() - phase.startTime;
            const hitIndex = Math.floor(elapsed / 199);
            if (hitIndex >= 3 || hitIndex <= phase.lastHitIndex) return;
            phase.lastHitIndex = hitIndex;
            const baseAtk = this.player.getCurrentWeaponAtk();
            // 从 skills.json 获取 damageMul: 0.80 + level * 0.03
            const damageMul = skill.getEffect(skillLevel).damageMul;
            let levelBonus;
            if (hitIndex === 0 || hitIndex === 1) {
                levelBonus = skillLevel * 0.05;
            } else {
                levelBonus = skillLevel * 0.10;
            }
            const damage = Math.floor(baseAtk * damageMul + levelBonus);
            // 改造效果：大马士革钢 - 冲刺突刺双倍伤害
            const dashDoubleHit = currentItem && currentItem._craftEffects && currentItem._craftEffects.dashDoubleHit;
            let hitCount = 0;
            if (hitIndex === 0) {
                // 第一次判定：矩形范围判定，记录命中目标
                const backOffset = this.player._getSkillParam('dashAttackThrust', 'hitCheck.backOffset', 0);
                entities.forEach(entity => {
                    if (entity === this.player || !entity.active || !entity.hittable) return;
                    const dx = entity.x - this.player._dashSlashPos.x;
                    const dy = entity.y - this.player._dashSlashPos.y;
                    const forward = dx * cos + dy * sin;
                    const lateral = dx * (-sin) + dy * cos;
                    if (forward >= backOffset && forward <= rectLength && lateral >= -halfW && lateral <= halfW) {
                        hitCount++;
                        phase.hitTargets.add(entity);
                        if (!this.player._dashHitSet.has(entity)) this.player._dashHitSet.add(entity);
                        const wasAlive = entity.hp > 0;
                        const targetCritRes = (entity.data && entity.data.critRes) || 0;
                        let playerCrit = this.player.data.crit || 0;
                        if (this.player.skills && this.player.skills.rifleMastery) {
                            const currentWpn = this.player.equipments[this.player.weaponMode];
                            if (currentWpn && isRifle(currentWpn.weaponType)) {
                                playerCrit += this.player.skills.rifleMastery.getEffect(this.player.skills.rifleMastery.level).critRateBonus;
                            }
                        }
                        const finalCritRate = Math.max(0, playerCrit - targetCritRes);
                        const isCrit = Math.random() * 100 < finalCritRate;
                        let critMul = 1.5;
                        if (isCrit && this.player.skills && this.player.skills.criticalStrike) {
                            const csEffect = this.player.skills.criticalStrike.getEffect(this.player.skills.criticalStrike.level);
                            critMul = 1 + csEffect.damageBonus;
                        }
                        const finalDamage = isCrit ? Math.floor(damage * critMul) : damage;
                        entity.takeDamage(finalDamage, this.player);
                    // 大马士革钢：只在第一次判定触发双倍伤害
                    if (dashDoubleHit && hitIndex === 0) {
                        entity.takeDamage(finalDamage, this.player);
                    }
                        if (wasAlive && entity.hp <= 0) phase.totalKillCount++;
                        phase.totalHitCount++;
                        entity._dashStunned = true;
                        entity._dashStunTimer = 500;
                        // 击退距离 = 主角突刺移动距离（173 * 0.75 = 130px）
                        const thrustMoveDist = this.player._getSkillParam('dashAttackThrust', 'animation.dashDist', 173) * 0.75;
                        entity.applyKnockback(attackAngle, thrustMoveDist);
                        EffectManager.add(new HitEffect(entity.x, entity.y));
                        EffectManager.createDamageText(entity.x, entity.y - entity.size, finalDamage, isCrit);
                        this.player._triggerRuneSwordCooldownReduction();
                    }
                });
            } else {
                // 第二、三次判定：不再做范围判定，直接对第一次命中的目标造成伤害
                phase.hitTargets.forEach(entity => {
                    if (entity === this.player || !entity.active || !entity.hittable) return;
                    hitCount++;
                    if (!this.player._dashHitSet.has(entity)) this.player._dashHitSet.add(entity);
                    const wasAlive = entity.hp > 0;
                    const targetCritRes2 = (entity.data && entity.data.critRes) || 0;
                    let playerCrit2 = this.player.data.crit || 0;
                    if (this.player.skills && this.player.skills.rifleMastery) {
                        const currentWpn2 = this.player.equipments[this.player.weaponMode];
                        if (currentWpn2 && isRifle(currentWpn2.weaponType)) {
                            playerCrit2 += this.player.skills.rifleMastery.getEffect(this.player.skills.rifleMastery.level).critRateBonus;
                        }
                    }
                    const finalCritRate2 = Math.max(0, playerCrit2 - targetCritRes2);
                    const isCrit = Math.random() * 100 < finalCritRate2;
                    let critMul = 1.5;
                    if (isCrit && this.player.skills && this.player.skills.criticalStrike) {
                        const csEffect = this.player.skills.criticalStrike.getEffect(this.player.skills.criticalStrike.level);
                        critMul = 1 + csEffect.damageBonus;
                    }
                    const finalDamage = isCrit ? Math.floor(damage * critMul) : damage;
                    entity.takeDamage(finalDamage, this.player);
                    // 大马士革钢：只在第一次判定触发双倍伤害（hitIndex === 0 已处理，这里不触发）
                    if (wasAlive && entity.hp <= 0) phase.totalKillCount++;
                    phase.totalHitCount++;
                    entity._dashStunned = true;
                    entity._dashStunTimer = 500;
                    EffectManager.add(new HitEffect(entity.x, entity.y));
                    EffectManager.createDamageText(entity.x, entity.y - entity.size, finalDamage, isCrit);
                    this.player._triggerRuneSwordCooldownReduction();
                });
            }
        } else {
            // === 扇形单次判定（原始冲刺攻击 / 冲刺攻击-火）===
            const isFire = activeSkillId === 'dashAttackFire';
            const hitArc = 2 * Math.PI / 3;
            entities.forEach(entity => {
                if (entity === this.player || !entity.active || !entity.hittable) return;
                if (this.player._dashHitSet.has(entity)) return;
                if (MathUtils.pointInSector(entity.x, entity.y, this.player._dashSlashPos.x, this.player._dashSlashPos.y, attackAngle, range, hitArc)) {
                    this.player._dashHitSet.add(entity);
                    const effect = skill.getEffect(skillLevel);
                    let damage;
                    if (isFire) {
                        // 冲刺攻击-火：攻击力 = (物理伤害+魔法伤害) * (1.5+技能等级*0.05)
                        const physAtk = this.player.getCurrentWeaponAtk();
                        const magicAtk = this.player.data.matk || 0;
                        const fireMul = 1.5 + skillLevel * 0.05;
                        damage = Math.floor((physAtk + magicAtk) * fireMul);
                    } else {
                        const baseDamage = this.player.getCurrentWeaponAtk();
                        damage = Math.floor(baseDamage * effect.damageMul);
                    }
                    const targetCritRes3 = (entity.data && entity.data.critRes) || 0;
                    let playerCrit3 = this.player.data.crit || 0;
                    if (this.player.skills && this.player.skills.rifleMastery) {
                        const currentWpn3 = this.player.equipments[this.player.weaponMode];
                        if (currentWpn3 && isRifle(currentWpn3.weaponType)) {
                            playerCrit3 += this.player.skills.rifleMastery.getEffect(this.player.skills.rifleMastery.level).critRateBonus;
                        }
                    }
                    const finalCritRate3 = Math.max(0, playerCrit3 - targetCritRes3);
                    const isCrit = Math.random() * 100 < finalCritRate3;
                    let critMul = 2;
                    if (isCrit && this.player.skills && this.player.skills.criticalStrike) {
                        const csEffect = this.player.skills.criticalStrike.getEffect(this.player.skills.criticalStrike.level);
                        critMul = 1 + csEffect.damageBonus;
                    }
                    const finalDamage = isCrit ? Math.floor(damage * critMul) : damage;
                    const wasAlive = entity.hp > 0;
                    entity.takeDamage(finalDamage, this.player);
                    if (wasAlive && entity.hp <= 0) this.player._dashKillCount++;
                    const kbAngle = Math.atan2(entity.y - this.player.y, entity.x - this.player.x);
                    entity.applyKnockback(kbAngle, knockback);
                    EffectManager.add(new HitEffect(entity.x, entity.y));
                    EffectManager.createDamageText(entity.x, entity.y - entity.size, finalDamage, isCrit);
                    if (isCrit) EffectManager.add(new CritEffect(entity.x, entity.y - entity.size * 1.5));
                    if (isFire) {
                        // 火焰特效：命中时额外生成火焰爆炸
                        EffectManager.add(new DashFireTrailEffect(entity.x, entity.y, 0, 0, null));
                    }
                    this.player._triggerRuneSwordCooldownReduction();
                }
            });
        }
    }

    // 冲刺攻击-火：在武器路径上生成火焰粒子
    _spawnFireTrail() {
        if (!this.player._dashFireTrailTimer) this.player._dashFireTrailTimer = 0;
        this.player._dashFireTrailTimer += 16.67; // 约60fps
        if (this.player._dashFireTrailTimer < 50) return; // 每50ms生成一次
        this.player._dashFireTrailTimer = 0;
        // 在武器位置生成火焰粒子
        const state = this._getDashWeaponStateAt(this.player._dashTimer, 'dashAttackFire');
        // 计算武器尖端位置（基于当前玩家位置和朝向）
        const cos = Math.cos(this.player.rotation);
        const sin = Math.sin(this.player.rotation);
        // 武器偏移量（基于dash状态）
        const offsetDist = 60 + state.dashOffset;
        const wx = this.player.x + cos * offsetDist;
        const wy = this.player.y + sin * offsetDist;
        EffectManager.add(new DashFireTrailEffect(wx, wy, this.player._dashDirection.x, this.player._dashDirection.y, null));
    }
}

export { DashSystem };
