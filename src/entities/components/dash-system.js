import { isRifle } from '../../config/gun-ammo.js';
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
        this.player.weaponAnim.state = 'idle';
        this.player._dashConvergeShown = false;
        this.player._dashConvergeAuraActive = false;
        // 初始化矩形突刺持续判定状态
        this.player._dashThrustPhase = null;
        this.player._dashSlashStartTime = null;
    }

    _getDashWeaponStateAt(timer, skillId) {
        // 未传入 skillId 时，根据当前装备自动判断
        const activeSkillId = skillId || this.player._getActiveDashSkillId();
        const dashProgress = timer / 800;
        let dashOffset = 0, dashAngle = 0;
        if (activeSkillId === 'dashAttackThrust') {
            // === 突刺动画（骑士长剑专属） ===
            // 坐标系：rotate(Math.PI/2) 后，Y轴向左（屏幕左），X轴向下
            // dashOffset > 0 = 向左（靠近玩家）= "后"
            // dashOffset < 0 = 向右（远离玩家）= "前"
            const totalMs = this.player._getSkillParam('dashAttackThrust', 'animation.totalMs', 600);
            const t = Math.min(1, timer / totalMs * 2); // 速度翻倍
            dashOffset = -95 * easeOutQuad(t);
            dashAngle = 0;
        } else {
            // === 默认 dashAttack：武器挥砍（原始 slash 动画） ===
            if (dashProgress < 0.4375) {
                const t = dashProgress / 0.4375;
                if (t < 0.142857) {
                    const pt = t / 0.142857;
                    dashOffset = 15 * easeOutQuad(pt);
                    dashAngle = 0;
                } else {
                    const pt = (t - 0.142857) / 0.857143;
                    dashOffset = 15;
                    dashAngle = Math.PI / 2 * easeInOutCubic(pt);
                }
            } else {
                const t = (dashProgress - 0.4375) / 0.5625;
                if (t < 0.111111) {
                    const pt = t / 0.111111;
                    dashOffset = 15 - 60 * easeOutQuad(pt);
                    dashAngle = Math.PI / 2;
                } else {
                    const pt = (t - 0.111111) / 0.888889;
                    dashAngle = Math.PI / 2 - Math.PI * 4/3 * easeOutQuad(pt);
                    dashOffset = -45 - 30 * (1 - easeInOutCubic(pt));
                }
            }
        }
        return { dashOffset, dashAngle };
    }

    update(dt, entities) {
        if (!this.player._isDashing) return;
        const activeSkillId = this.player._getActiveDashSkillId();
        const isThrust = activeSkillId === 'dashAttackThrust';
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
                    // 生成金色汇聚特效（在剑尖位置，使用 _dashSlashPos 作为基准）
                    const leftDirX = -this.player._dashDirection.y;
                    const leftDirY = this.player._dashDirection.x;
                    const tipX = this.player._dashSlashPos.x + this.player._dashDirection.x * 400 + leftDirX * 22;
                    const tipY = this.player._dashSlashPos.y + this.player._dashDirection.y * 400 + leftDirY * 22;
                    EffectManager.add(new GoldenConvergeEffect(tipX, tipY, this.player._dashDirection.x, this.player._dashDirection.y, this.player));
                    if (Game.showAttackRange) {
                        const isWeapon4 = this.player.equipments[this.player.weaponMode] && this.player.equipments[this.player.weaponMode].weaponId === 'weapon4';
                        const attackAngle = Math.atan2(this.player._dashDirection.y, this.player._dashDirection.x);
                        const rectWidth = this.player._getSkillParam('dashAttackThrust', 'hitCheck.width', 75);
                        const rectLength = this.player._getSkillParam('dashAttackThrust', 'hitCheck.length', 500) + (isWeapon4 ? 50 : 0);
                        EffectManager.add(new AttackRangeEffect(this.player._dashSlashPos.x, this.player._dashSlashPos.y, attackAngle, rectLength, rectWidth, 'triangle', 1000, 0.5, true));
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
                const easedProgress = easeOutQuad(moveProgress);
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
                const easedProgress = easeOutQuad(moveProgress);
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
            const isWeapon4 = currentItem && currentItem.weaponId === 'weapon4';
            const rectWidth = this.player._getSkillParam('dashAttackThrust', 'hitCheck.width', 94);
            let rectLength = this.player._getSkillParam('dashAttackThrust', 'hitCheck.length', 438) + (isWeapon4 ? 50 : 0);
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
            let damageMul, levelBonus;
            if (hitIndex === 0 || hitIndex === 1) {
                damageMul = 0.80; levelBonus = skillLevel * 0.05;
            } else {
                damageMul = 0.90; levelBonus = skillLevel * 0.10;
            }
            const damage = Math.floor(baseAtk * damageMul + levelBonus);
            // 改造效果：大马士革钢 - 冲刺突刺双倍伤害
            const dashDoubleHit = currentItem && currentItem._craftEffects && currentItem._craftEffects.dashDoubleHit;
            let hitCount = 0;
            if (hitIndex === 0) {
                // 第一次判定：矩形范围判定，记录命中目标
                entities.forEach(entity => {
                    if (entity === this.player || !entity.active || !entity.hittable) return;
                    const dx = entity.x - this.player._dashSlashPos.x;
                    const dy = entity.y - this.player._dashSlashPos.y;
                    const forward = dx * cos + dy * sin;
                    const lateral = dx * (-sin) + dy * cos;
                    if (forward >= (isWeapon4 ? -30 : 0) && forward <= rectLength && lateral >= -halfW && lateral <= halfW) {
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
                        // 大马士革钢：额外造成一次伤害
                        if (dashDoubleHit) {
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
                    // 大马士革钢：额外造成一次伤害
                    if (dashDoubleHit) {
                        entity.takeDamage(finalDamage, this.player);
                    }
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
            // === 扇形单次判定（原始冲刺攻击）===
            const hitArc = 2 * Math.PI / 3;
            entities.forEach(entity => {
                if (entity === this.player || !entity.active || !entity.hittable) return;
                if (this.player._dashHitSet.has(entity)) return;
                if (MathUtils.pointInSector(entity.x, entity.y, this.player._dashSlashPos.x, this.player._dashSlashPos.y, attackAngle, range, hitArc)) {
                    this.player._dashHitSet.add(entity);
                    const effect = skill.getEffect(skillLevel);
                    const baseDamage = this.player.getCurrentWeaponAtk();
                    const damage = Math.floor(baseDamage * effect.damageMul);
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
                    // DashParticle 类未定义，暂时注释掉
                    // this.player._dashParticles.push(new DashParticle(entity.x, entity.y, attackAngle, 0.5, 100, 0.8));
                    this.player._triggerRuneSwordCooldownReduction();
                }
            });
        }
    }
}

export { DashSystem };
