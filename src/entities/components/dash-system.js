import { Game } from '../../game.js';
import { WallSystem } from '../../world/wall-system.js';
import { Renderer } from '../../world/renderer.js';
import { Input } from '../../ui/input.js';
import { AttackRangeEffect } from '../../effects/attack-range-effect.js';
import { isRifle } from '../../config/gun-ammo.js';
import { DashFireTrailEffect } from '../../effects/dash-effects.js';
import { Easing } from '../../config/math-utils.js';
import { WeaponAnimConfig } from '../../items/weapon-anim-config.js';
import { VerticalSector, VerticalRect } from '../../physics/skill-shapes.js';
import { entitySurfaceZ, surfaceEffectFromEntity } from '../../physics/elevation.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { EffectFactory } from '../../utils/effect-factory.js';
import { SkillManager } from '../../ui/skill-manager.js';
import { enterDashFreeze, nowMs } from '../player/anim-state.js';
import { SoundManager } from '../../ui/sound-manager.js';
class DashSystem {
    constructor(player) {
        this.player = player;
        this._meleeHitSoundCd = 0; // 命中音效节流（防多目标/多段刷音）
    }

    _getDashSkillLevel(skillId) {
        return this.player._getDashSkillLevel
            ? this.player._getDashSkillLevel(skillId)
            : (this.player.skills?.[skillId]?.level || 1);
    }

    _clearDashSnapshot() {
        this.player._dashSkillId = null;
        this.player._dashWeaponItem = null;
        this.player._dashSkillOverrides = null;
    }

    /** 玩家冲刺攻击命中音效（与 DamagePipeline 同口径、同节流时长） */
    _playMeleeHitSound() {
        const now = performance.now();
        if (now >= this._meleeHitSoundCd) {
            this._meleeHitSoundCd = now + 90;
            if (SoundManager && typeof SoundManager.playFile === 'function') {
                SoundManager.playFile('assets/sounds/weapons/sword/hitting.mp3');
            }
        }
    }

    trigger(_entities) {
        if (this.player._specialAttackActive || this.player._whirlwindRecovering) return false; // 风车收势/夜与火特殊攻击期间禁止冲刺攻击
        // 攻击动画锁定：任何动画未播完前不触发（近战攻击中/收势中/冲刺恢复定格中/风车/推击均拒绝插队）
        if (this.player.weaponAnim && this.player.weaponAnim.isAttacking) return false;
        if (this.player._attackRecovering || this.player._dashRecoverAt || this.player._isWhirlwind || this.player._isPushStrike) return false;
        // 冲刺方向只读取发动瞬间的移动输入水平分量。斜向吸附为水平；纯纵向/无输入
        // 不发动且必须在任何状态写入、动画切换和体力扣除之前返回。
        const move = Input.getMovement();
        if (!move || Math.abs(Number(move.x) || 0) < 0.001) return false;
        const dirX = move.x > 0 ? 1 : -1;
        const dirY = 0;
        this.player._isDashing = true;
        this.player._dashState = 'charge';
        this.player._dashTimer = 0;
        // [FIX] 冲刺攻击开始时清理正在进行的近战攻击 Tween，避免 weaponAnim.state 卡在 'attacking'
        if (typeof this.player.clearAttackTweens === 'function') {
            this.player.clearAttackTweens();
        }
        this.player._dashDirection = { x: dirX, y: dirY };
        this.player._facingRightVisual = dirX > 0;
        this.player._facingDir = dirX > 0 ? 'right' : 'left';
        this.player._dashStartPos = { x: this.player.x, y: this.player.y };
        this.player._dashHitSet = new Set();
        this.player._dashKillCount = 0;
        this.player._dashRangeShown = false;
        this.player._dashSlashShown = false;
        this.player._dashBounceApplied = false;
        this.player._dashSoundPlayed = false; // 挥砍音效第 9 帧一次性播放标记
        this.player._dashSlashPos = null;
        this.player._dashSlashEffect = null; // 重置扇形特效引用
        this.player._sprintDuration = 0;
        // 应用改造效果：技能体力消耗
        const activeSkillId = this.player._getActiveDashSkillId();
        const currentWeapon = this.player.equipments[this.player.weaponMode];
        this.player._dashSkillId = activeSkillId;
        this.player._dashWeaponItem = currentWeapon || null;
        this.player._dashSkillOverrides = currentWeapon?.skillOverrides
            ? JSON.parse(JSON.stringify(currentWeapon.skillOverrides))
            : {};
        this.player._dashVisualStyle = activeSkillId === 'dashAttackThrust' ? 'thrust' : 'slash';
        const dashSkill = this.player.skills[activeSkillId];
        const dashSkillLevel = this._getDashSkillLevel(activeSkillId);
        // 骑士长剑突刺使用独立人物动画；其余武器保持原 dash_attack 上劈下砍。
        {
            const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
            if (scene && typeof scene.setPlayerAnimation === 'function') {
                const dashEffect = (dashSkill && typeof dashSkill.getEffect === 'function') ? dashSkill.getEffect(dashSkillLevel) : null;
                const dashTotalMs = this.player._getSkillParam(
                    activeSkillId,
                    'animation.totalMs',
                    (dashEffect && dashEffect.totalMs) || 800
                );
                this.player._dashTotalMs = dashTotalMs; // 供 GameScene 冲刺轨迹按帧进度插值
                const dashAnimKey = this.player._dashVisualStyle === 'thrust'
                    ? 'dash_attack_thrust'
                    : 'dash_attack';
                scene.setPlayerAnimation(dashAnimKey, dashTotalMs);
            }
        }
        let staminaCost = 20;
        if (dashSkill && typeof dashSkill.getEffect === 'function') {
            const effect = dashSkill.getEffect(dashSkillLevel);
            if (effect && typeof effect.staminaCost === 'number' && isFinite(effect.staminaCost)) {
                staminaCost = effect.staminaCost;
            }
        }
        if (currentWeapon && currentWeapon._craftEffects) {
            const ce = currentWeapon._craftEffects;
            if (typeof ce.skillStaminaCostDelta === 'number' && isFinite(ce.skillStaminaCostDelta)) staminaCost += ce.skillStaminaCostDelta;
        }
        if (!isFinite(staminaCost) || staminaCost < 0) staminaCost = 0;
        this.player.data.stamina -= staminaCost;
        if (this.player.data.stamina < 0) this.player.data.stamina = 0;
        
        this.player._dashConvergeShown = false;
        this.player._dashConvergeAuraActive = false;
        // 初始化矩形突刺持续判定状态
        this.player._dashThrustPhase = null;
        this.player._dashSlashStartTime = null;
        // 冲刺攻击-火：重置火焰轨迹计时器
        this.player._dashFireTrailTimer = 0;
        return true;
    }

    _getDashWeaponStateAt(timer, skillId) {
        // 未传入 skillId 时优先使用本次动作快照，避免冲刺中换装备造成轨迹分支漂移。
        const activeSkillId = skillId || this.player._dashSkillId || this.player._getActiveDashSkillId();
        const skill = this.player.skills[activeSkillId];
        const effect = skill ? skill.getEffect(this._getDashSkillLevel(activeSkillId)) : {};
        const totalMs = this.player._getSkillParam(activeSkillId, 'animation.totalMs', effect.totalMs || 800);
        const dashProgress = Math.min(1, timer / totalMs);
        const hitArc = effect.hitArc || (2 * Math.PI / 3);
        let dashOffset, dashAngle;


        if (activeSkillId === 'dashAttackThrust') {
            // === 突刺动画（骑士长剑专属） ===
            // 坐标系：rotate(Math.PI/2) 后，Y轴向左（屏幕左），X轴向下
            // dashOffset > 0 = 向左（靠近玩家）= "后"
            // dashOffset < 0 = 向右（远离玩家）= "前"
            const t = Math.min(1, timer / totalMs);
            dashOffset = -95 * Easing.easeOutQuad(t);
            dashAngle = 0;
        } else {
            // === 默认 dashAttack：武器在朝向方向以120度扇形划过 ===
            // dashAngle: -60° → +60°（以朝向为中心，总120°扇形）
            dashAngle = -hitArc / 2 + hitArc * Easing.easeInOutCubic(dashProgress);
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
        const activeSkillId = this.player._dashSkillId || this.player._getActiveDashSkillId();
        const isThrust = activeSkillId === 'dashAttackThrust';
        const isFire = activeSkillId === 'dashAttackFire';
        const currentWeapon = this.player._dashWeaponItem || this.player.equipments[this.player.weaponMode];
        const isMeleeWeapon = currentWeapon && (currentWeapon.category === 'weapon_melee' || currentWeapon.weaponType === 'sword');
        const hasDashSkill = this.player.skills && this.player.skills[activeSkillId];
        if (!isMeleeWeapon || !hasDashSkill) {
            const thrustTraining = this.player._dashThrustPhase;
            this.player._isDashing = false;
            this.player._dashState = 'idle';
            this.player._dashTimer = 0;
            this.player._dashBounceApplied = false;
            this.player._dashSlashPos = null;
            this.player._dashSlashEffect = null;
            this.player._dashSlashStartTime = null;
            this.player._dashVisualStyle = null;
            if (isThrust) {
                const trainingHits = thrustTraining?.totalHitCount || 0;
                const trainingKills = thrustTraining?.totalKillCount || 0;
                SkillManager.addDashThrustExp(this.player, trainingHits, trainingKills);
                SkillManager.addMeleeExp(this.player, trainingHits, trainingKills, currentWeapon);
            }
            else SkillManager.addDashExp(this.player, this.player._dashHitSet.size, 0);
            this.player._dashThrustPhase = null;
            this._clearDashSnapshot();
            return;
        }
        this.player._dashTimer += dt;
        const skill = this.player.skills[activeSkillId];
        const effect = skill.getEffect(this._getDashSkillLevel(activeSkillId));
        if (isThrust) {
            // === 冲刺攻击-突刺（骑士长剑专属）===
            const totalMs = this.player._getSkillParam('dashAttackThrust', 'animation.totalMs', effect.totalMs);
            const progress = this.player._dashTimer / totalMs;
            const chargeMs = this.player._getSkillParam('dashAttackThrust', 'animation.chargeMs', effect.chargeMs);
            const chargeRatio = chargeMs / totalMs;
            if (progress < chargeRatio) {
                this.player._dashState = 'rotate';
            } else if (progress < 1.0) {
                if (this.player._dashState !== 'slash') {
                    this.player._dashSlashPos = { x: this.player.x, y: this.player.y };
                    if (Game.showAttackRange) {
                        const attackAngle = Math.atan2(this.player._dashDirection.y, this.player._dashDirection.x);
                        let rectLength = this.player._getSkillParam('dashAttackThrust', 'hitCheck.length', effect.hitLength) + this.player._getSkillParam('dashAttackThrust', 'hitCheck.lengthBonus', effect.hitLengthBonus);
                        // 与 _checkHit 同口径：改造「攻击距离」加进显示，画多少打多少
                        if (currentWeapon && currentWeapon._craftEffects && currentWeapon._craftEffects.rangeDelta) {
                            rectLength += currentWeapon._craftEffects.rangeDelta;
                        }
                        const rectWidth = this.player._getSkillParam('dashAttackThrust', 'hitCheck.width', effect.hitWidth);
                        const backOffset = this.player._getSkillParam('dashAttackThrust', 'hitCheck.backOffset', effect.hitBackOffset) || 0;
                        EffectManager.add(new AttackRangeEffect(this.player._dashSlashPos.x, this.player._dashSlashPos.y, attackAngle, rectLength, rectWidth, 'triangle', effect.rangeEffectLife, effect.rangeEffectAlpha, true, backOffset));
                    }
                }
                this.player._dashState = 'slash';
            } else {
                const endState = this._getDashWeaponStateAt(this.player._dashTimer, activeSkillId);
                const thrustTraining = this.player._dashThrustPhase;
                this.player._isDashing = false;
                this.player._dashState = 'idle';
                this.player._dashTimer = 0;
                this.player._dashBounceApplied = false;
                this.player._dashParticles = [];
                this.player._dashSlashEffect = null;
                this.player._dashSlashStartTime = null;
                this.player._dashResetAnim = {
                    startOffset: endState.dashOffset,
                    startAngle: endState.dashAngle || Math.PI / 1800,
                    startRotation: this.player.rotation,
                    targetRotation: (() => { const sp = Renderer.worldToScreen(this.player.x, this.player.y); return Math.atan2(Input.mouse.y - sp.y, Input.mouse.x - sp.x); })(),
                    startTime: nowMs(), // Phase 3：墙钟→单调时钟（读者 subsystems.js/GameScene.js 同链）
                    duration: (WeaponAnimConfig.stab && WeaponAnimConfig.stab.recoverMs) || 500,
                    visualStyle: 'thrust'
                };
                const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
                if (scene && typeof scene.setPlayerAnimation === 'function') {
                    scene.setPlayerAnimation('dash_recover_thrust', this.player._dashResetAnim.duration);
                }
                // [FIX] 冲刺攻击结束确保武器动画状态恢复，防止体力回复被卡住
                if (this.player.weaponAnim) {
                    this.player.weaponAnim.state = 'idle';
                    this.player.weaponAnim.isAttacking = false;
                    this.player.weaponAnim.timer = 0;
                }
                // 三段突刺按实际伤害次数/击杀数修炼；同一目标三次命中不能退化为一个唯一目标。
                const trainingHits = thrustTraining?.totalHitCount || 0;
                const trainingKills = thrustTraining?.totalKillCount || 0;
                SkillManager.addDashThrustExp(this.player, trainingHits, trainingKills);
                SkillManager.addMeleeExp(this.player, trainingHits, trainingKills, currentWeapon);
                this.player._dashThrustPhase = null;
                this._clearDashSnapshot();
                return;
            }
            // 位移保持既有 12/17 时间比例，不跟随视觉 sheet 改帧而改变战斗距离/停步时点。
            // 骑士长剑人物动画现为 H3 f66~f80 连续15帧，在600ms内按近原速播放。
            const dashDist = this.player._getSkillParam('dashAttackThrust', 'animation.dashDist', effect.dashDist);
            const speedMul = effect.speedMul;
            const bounceRatio = effect.bounceRatio;
            const gameplayTimelineFrames = 17;
            const moveFrames = (typeof effect.moveFrames === 'number') ? effect.moveFrames : 12;
            const movePhaseRatio = moveFrames / gameplayTimelineFrames;
            if (progress < movePhaseRatio) {
                const moveProgress = progress / movePhaseRatio;
                const easedProgress = Easing.easeOutQuad(moveProgress);
                const targetX = this.player._dashStartPos.x + this.player._dashDirection.x * dashDist * speedMul * easedProgress;
                const targetY = this.player._dashStartPos.y + this.player._dashDirection.y * dashDist * speedMul * easedProgress;
                const wallIgnore = WallSystem.ignoreForEntity?.(this.player) || null;
                this.player._surfaceInputIntent = {
                    x: this.player._dashDirection.x,
                    y: this.player._dashDirection.y,
                };
                const resolved = WallSystem.resolve(
                    this.player._dashStartPos.x,
                    this.player._dashStartPos.y,
                    targetX,
                    targetY,
                    this.player.groundRadius,
                    wallIgnore
                );
                const expectedTarget = wallIgnore?._surfaceProjectedTarget
                    || { x: targetX, y: targetY };
                const hitWall = Math.abs(resolved.x - expectedTarget.x) > 1
                    || Math.abs(resolved.y - expectedTarget.y) > 1;
                if (hitWall && !this.player._dashBounceApplied) {
                    this.player._dashBounceApplied = true;
                    const bounceDist = dashDist * speedMul * easedProgress * bounceRatio;
                    const bounceX = this.player.x - this.player._dashDirection.x * bounceDist;
                    const bounceY = this.player.y - this.player._dashDirection.y * bounceDist;
                    const br = WallSystem.resolve(
                        this.player.x,
                        this.player.y,
                        bounceX,
                        bounceY,
                        this.player.groundRadius,
                        wallIgnore
                    );
                    this.player.x = br.x; this.player.y = br.y;
                    EffectFactory.createSmokeEffect(resolved.x, resolved.y);
                } else {
                    this.player.x = resolved.x; this.player.y = resolved.y;
                }
            }
            // 突刺阶段：判定窗口
            if (this.player._dashState === 'slash') {
                const thrustMs = this.player._getSkillParam('dashAttackThrust', 'animation.thrustMs', effect.thrustMs);
                const slashStart = chargeMs;
                const slashEnd = chargeMs + thrustMs;
                if (this.player._dashTimer >= slashStart && this.player._dashTimer <= slashEnd) {
                    this._checkHit(entities, activeSkillId);
                }
            }
        } else {
            // === 原始冲刺攻击（dashAttack）===
            const totalMs = this.player._getSkillParam(activeSkillId, 'animation.totalMs', effect.totalMs);
            const progress = this.player._dashTimer / totalMs;
            const chargeRatio = effect.chargeMs / totalMs;
            if (progress < chargeRatio) {
                this.player._dashState = 'charge';
            } else if (progress < 1.0) {
                if (this.player._dashState !== 'slash') {
                    this.player._dashSlashPos = { x: this.player.x, y: this.player.y };
                    if (Game.showAttackRange) {
                        const currentItem = currentWeapon;
                        const baseRange = (currentItem && currentItem.attack && currentItem.attack.range)
                            || (this.player.attacks.melee && this.player.attacks.melee.config && this.player.attacks.melee.config.range)
                            || 206;
                        const skillLevel = this._getDashSkillLevel(activeSkillId);
                        const range = baseRange + effect.rangeBonusBase + skillLevel * effect.rangeLevelBonus + effect.rangeBonusFlat;
                        const attackAngle = Math.atan2(this.player._dashDirection.y, this.player._dashDirection.x);
                        const hitArc = effect.hitArc;
                        EffectManager.add(new AttackRangeEffect(this.player._dashSlashPos.x, this.player._dashSlashPos.y, attackAngle, range, hitArc, 'sector', effect.rangeEffectLife, effect.rangeEffectAlpha, true));
                    }
                }
                this.player._dashState = 'slash';
                if (isFire) {
                    this._spawnFireTrail();
                }
                if (!this.player._dashSlashStartTime) {
                    this.player._dashSlashStartTime = nowMs();
                }
            } else {
                this.player._isDashing = false;
                this.player._dashState = 'idle';
                this.player._dashTimer = 0;
                this.player._dashBounceApplied = false;
                this.player._dashParticles = [];
                this.player._dashSlashEffect = null;
                this.player._dashThrustPhase = null;
                this.player._dashSlashStartTime = null;
                // 恢复动画延迟 0.5s 播放（末帧定格），由 GameScene._updatePlayerAnimation 到点触发；
                // 定格期武器停在 dash 轨迹末帧（perFrame progress=1），恢复走近战同款滑回（dash-system 不再建旧公式复位动画）
                enterDashFreeze(this.player, nowMs() + 500);
                // [FIX] 冲刺攻击结束确保武器动画状态恢复，防止体力回复被卡住
                if (this.player.weaponAnim) {
                    this.player.weaponAnim.state = 'idle';
                    this.player.weaponAnim.isAttacking = false;
                    this.player.weaponAnim.timer = 0;
                }
                SkillManager.addDashExp(this.player, this.player._dashHitSet.size, this.player._dashKillCount);
                // 剑精通经验（冲刺攻击命中，只在攻击结束时发放一次）
                SkillManager.addMeleeExp(this.player, this.player._dashHitSet.size, this.player._dashKillCount, currentWeapon);
                this._clearDashSnapshot();
                return;
            }
            // 移动：动画帧驱动——dash_attack 共 17 帧，位移窗口内完成位移，窗口外不位移
            // 位移窗口优先级：effect.moveFrames（帧数，如 11=前 11 帧）> effect.movePhaseRatio（旧比例配置）> 缺省 12 帧
            const dashDist = effect.dashDist;
            const speedMul = effect.speedMul;
            const bounceRatio = effect.bounceRatio;
            const totalFrames = 17;
            const movePhaseRatio = (typeof effect.moveFrames === 'number') ? effect.moveFrames / totalFrames
                : (typeof effect.movePhaseRatio === 'number') ? effect.movePhaseRatio
                : 12 / totalFrames;
            if (progress < movePhaseRatio) {
                const moveProgress = progress / movePhaseRatio;
                const easedProgress = Easing.easeOutQuad(moveProgress);
                const targetX = this.player._dashStartPos.x + this.player._dashDirection.x * dashDist * speedMul * easedProgress;
                const targetY = this.player._dashStartPos.y + this.player._dashDirection.y * dashDist * speedMul * easedProgress;
                const wallIgnore = WallSystem.ignoreForEntity?.(this.player) || null;
                this.player._surfaceInputIntent = {
                    x: this.player._dashDirection.x,
                    y: this.player._dashDirection.y,
                };
                const resolved = WallSystem.resolve(
                    this.player._dashStartPos.x,
                    this.player._dashStartPos.y,
                    targetX,
                    targetY,
                    this.player.groundRadius,
                    wallIgnore
                );
                const expectedTarget = wallIgnore?._surfaceProjectedTarget
                    || { x: targetX, y: targetY };
                const hitWall = Math.abs(resolved.x - expectedTarget.x) > 1
                    || Math.abs(resolved.y - expectedTarget.y) > 1;
                if (hitWall && !this.player._dashBounceApplied) {
                    this.player._dashBounceApplied = true;
                    const bounceDist = dashDist * speedMul * easedProgress * bounceRatio;
                    const bounceX = this.player.x - this.player._dashDirection.x * bounceDist;
                    const bounceY = this.player.y - this.player._dashDirection.y * bounceDist;
                    const br = WallSystem.resolve(
                        this.player.x,
                        this.player.y,
                        bounceX,
                        bounceY,
                        this.player.groundRadius,
                        wallIgnore
                    );
                    this.player.x = br.x; this.player.y = br.y;
                    EffectFactory.createSmokeEffect(resolved.x, resolved.y);
                } else {
                    this.player.x = resolved.x; this.player.y = resolved.y;
                }
                if (this.player._dashBounceApplied && progress > 0.1) {
                    const moved = Math.abs(resolved.x - this.player._dashStartPos.x) + Math.abs(resolved.y - this.player._dashStartPos.y);
                    if (moved < 2) {
                        this.player._isDashing = false;
                        this.player._dashState = 'idle';
                        this.player._dashTimer = 0;
                        this.player._dashBounceApplied = false;
                        this.player._dashSlashPos = null;
                        this.player._dashSlashEffect = null;
                        this.player._dashThrustPhase = null;
                        this.player._dashSlashStartTime = null;
                        enterDashFreeze(this.player, nowMs() + 500);
                        SkillManager.addDashExp(this.player, this.player._dashHitSet.size, 0);
                        this._clearDashSnapshot();
                        return;
                    }
                }
            }
            // 挥砍音效：第 9 帧播放（与近战一段/二段同款 sword.attack.sound；帧号换算同 hitCheck 口径）
            if (!this.player._dashSoundPlayed && progress >= (9 - 1) / (totalFrames - 1)) {
                this.player._dashSoundPlayed = true;
                const swingSound = WeaponAnimConfig.sword && WeaponAnimConfig.sword.attack && WeaponAnimConfig.sword.attack.sound;
                if (swingSound) SoundManager.playFile(swingSound);
            }
            // 挥砍阶段：扇形判定——第 14 帧才开始判定伤害（此前进 slash 即判，挥砍未到位）
            if (this.player._dashState === 'slash' && progress >= (14 - 1) / (totalFrames - 1)) {
                const slashElapsed = this.player._dashSlashStartTime ? nowMs() - this.player._dashSlashStartTime : 0;
                if (slashElapsed <= effect.slashWindowMs) {
                    this._checkHit(entities, activeSkillId);
                }
            }
        }
    }

    _checkHit(entities, skillId) {
        const activeSkillId = skillId || this.player._dashSkillId || this.player._getActiveDashSkillId();
        const isThrust = activeSkillId === 'dashAttackThrust';
        const attackAngle = Math.atan2(this.player._dashDirection.y, this.player._dashDirection.x);
        const currentItem = this.player._dashWeaponItem || this.player.equipments[this.player.weaponMode];
        const baseKnockback = (currentItem && currentItem.attack && currentItem.attack.knockback)
            || (this.player.attacks.melee && this.player.attacks.melee.config && this.player.attacks.melee.config.knockback)
            || 8;
        const skill = this.player.skills[activeSkillId];
        const skillLevel = this._getDashSkillLevel(activeSkillId);
        const effect = skill.getEffect(skillLevel);
        const knockback = baseKnockback + effect.knockbackBonus + skillLevel * effect.knockbackLevelBonus;
        const baseRange = (currentItem && currentItem.attack && currentItem.attack.range)
            || (this.player.attacks.melee && this.player.attacks.melee.config && this.player.attacks.melee.config.range)
            || 206;
        const range = baseRange + effect.rangeBonusBase + skillLevel * effect.rangeLevelBonus + effect.rangeBonusFlat;
        if (isThrust) {
            // === 矩形持续判定（冲刺攻击-突刺）===
            const rectWidth = this.player._getSkillParam('dashAttackThrust', 'hitCheck.width', effect.hitWidth);
            let rectLength = this.player._getSkillParam('dashAttackThrust', 'hitCheck.length', effect.hitLength) + this.player._getSkillParam('dashAttackThrust', 'hitCheck.lengthBonus', effect.hitLengthBonus);
            // 应用改造效果：攻击距离
            if (currentItem && currentItem._craftEffects && currentItem._craftEffects.rangeDelta) {
                rectLength += currentItem._craftEffects.rangeDelta;
            }
            if (!this.player._dashThrustPhase) {
                this.player._dashThrustPhase = { startTime: nowMs(), lastHitIndex: -1, totalHitCount: 0, totalKillCount: 0, hitTargets: new Set() };
            }
            const phase = this.player._dashThrustPhase;
            const elapsed = nowMs() - phase.startTime;
            const hitTickInterval = effect.hitTickInterval;
            const thrustMaxHits = effect.thrustMaxHits;
            const hitIndex = Math.floor(elapsed / hitTickInterval);
            if (hitIndex >= thrustMaxHits || hitIndex <= phase.lastHitIndex) return;
            phase.lastHitIndex = hitIndex;
            const baseAtk = this.player.getCurrentWeaponAtk(currentItem);
            // 从 skills.json 获取 damageMul: 0.80 + level * 0.03
            const damageMul = skill.getEffect(skillLevel).damageMul;
            const levelBonus = (hitIndex === 0 || hitIndex === 1)
                ? effect.thrustLevelBonusEarly
                : effect.thrustLevelBonusLate;
            const damage = Math.floor(baseAtk * damageMul + levelBonus);
            // 改造效果：大马士革钢 - 冲刺突刺双倍伤害
            const dashDoubleHit = currentItem && currentItem._craftEffects && currentItem._craftEffects.dashDoubleHit;
            if (hitIndex === 0) {
                // 第一次判定：矩形范围判定，记录命中目标
                const backOffset = this.player._getSkillParam('dashAttackThrust', 'hitCheck.backOffset', effect.hitBackOffset);
                const minZ = entitySurfaceZ(this.player);
                const shape = new VerticalRect(this.player._dashSlashPos.x, this.player._dashSlashPos.y, attackAngle, rectLength, rectWidth, minZ, minZ + (this.player.bodyHeight || 150), backOffset, surfaceEffectFromEntity(this.player));
                entities.forEach(entity => {
                    if (entity === this.player || !entity.active || !entity.hittable) return;
                    if (!shape.intersectsEntity(entity)) return;
                    phase.hitTargets.add(entity);
                    if (!this.player._dashHitSet.has(entity)) this.player._dashHitSet.add(entity);
                    const wasAlive = entity.hp > 0;
                    const targetCritRes = (entity.data && entity.data.critRes) || 0;
                    let playerCrit = this.player.data.crit || 0;
                    if (this.player.skills && this.player.skills.rifleMastery) {
                        const currentWpn = currentItem;
                        if (currentWpn && isRifle(currentWpn.weaponType)) {
                            playerCrit += this.player.skills.rifleMastery.getEffect(this.player.skills.rifleMastery.level).critRateBonus;
                        }
                    }
                    const finalCritRate = Math.max(0, playerCrit - targetCritRes);
                    const isCrit = Math.random() * 100 < finalCritRate;
                    let critMul = effect.critMul;
                    if (isCrit && this.player.skills && this.player.skills.criticalStrike) {
                        const csEffect = this.player.skills.criticalStrike.getEffect(this.player.skills.criticalStrike.level);
                        critMul = 1 + csEffect.damageBonus;
                    }
                    const finalDamage = isCrit ? Math.floor(damage * critMul) : damage;
                    this._playMeleeHitSound(); // 突刺首段命中
                    entity.takeDamage(finalDamage, this.player, 'physical', true);
                    // 大马士革钢：只在第一次判定触发双倍伤害
                    if (dashDoubleHit) {
                        entity.takeDamage(finalDamage, this.player, 'physical', true);
                    }
                    if (wasAlive && entity.hp <= 0 && !entity._summoned) phase.totalKillCount++;
                    phase.totalHitCount++;
                    entity._dashStunned = true;
                    entity._dashStunTimer = effect.stunDuration;
                    // 击退距离 = 主角突刺移动距离
                    const thrustMoveDist = this.player._getSkillParam('dashAttackThrust', 'animation.dashDist', effect.dashDist) * effect.speedMul;
                    entity.applyKnockback(attackAngle, thrustMoveDist);
                    EffectFactory.createHitEffect(entity.x, entity.y);
                    this.player._triggerRuneSwordCooldownReduction();
                });
            } else {
                // 第二、三次判定：不再做范围判定，直接对第一次命中的目标造成伤害
                phase.hitTargets.forEach(entity => {
                    if (entity === this.player || !entity.active || !entity.hittable) return;
                    if (!this.player._dashHitSet.has(entity)) this.player._dashHitSet.add(entity);
                    const wasAlive = entity.hp > 0;
                    const targetCritRes2 = (entity.data && entity.data.critRes) || 0;
                    let playerCrit2 = this.player.data.crit || 0;
                    if (this.player.skills && this.player.skills.rifleMastery) {
                        const currentWpn2 = currentItem;
                        if (currentWpn2 && isRifle(currentWpn2.weaponType)) {
                            playerCrit2 += this.player.skills.rifleMastery.getEffect(this.player.skills.rifleMastery.level).critRateBonus;
                        }
                    }
                    const finalCritRate2 = Math.max(0, playerCrit2 - targetCritRes2);
                    const isCrit = Math.random() * 100 < finalCritRate2;
                    let critMul = effect.critMul;
                    if (isCrit && this.player.skills && this.player.skills.criticalStrike) {
                        const csEffect = this.player.skills.criticalStrike.getEffect(this.player.skills.criticalStrike.level);
                        critMul = 1 + csEffect.damageBonus;
                    }
                    const finalDamage = isCrit ? Math.floor(damage * critMul) : damage;
                    this._playMeleeHitSound(); // 突刺二/三段命中
                    entity.takeDamage(finalDamage, this.player, 'physical', true);
                    if (window.__phaserScene) window.__phaserScene.triggerZombieHitParticles(entity, this.player);
                    // 大马士革钢：只在第一次判定触发双倍伤害（hitIndex === 0 已处理，这里不触发）
                    if (wasAlive && entity.hp <= 0 && !entity._summoned) phase.totalKillCount++;
                    phase.totalHitCount++;
                    entity._dashStunned = true;
                    entity._dashStunTimer = effect.stunDuration;
                    EffectFactory.createHitEffect(entity.x, entity.y);
                    this.player._triggerRuneSwordCooldownReduction();
                });
            }
        } else {
            // === 扇形单次判定（原始冲刺攻击 / 冲刺攻击-火）===
            const isFire = activeSkillId === 'dashAttackFire';
            const hitArc = effect.hitArc;
            const minZ = entitySurfaceZ(this.player);
            const shape = new VerticalSector(this.player._dashSlashPos.x, this.player._dashSlashPos.y, attackAngle, range, hitArc, minZ, minZ + (this.player.bodyHeight || 150), surfaceEffectFromEntity(this.player));
            entities.forEach(entity => {
                if (entity === this.player || !entity.active || !entity.hittable) return;
                if (this.player._dashHitSet.has(entity)) return;
                if (!shape.intersectsEntity(entity)) return;
                this.player._dashHitSet.add(entity);
                const dashEffect = skill.getEffect(skillLevel);
                let damage;
                if (isFire) {
                    // 冲刺攻击-火：攻击力 = (物理伤害+魔法伤害) * damageMul
                    const physAtk = this.player.getCurrentWeaponAtk(currentItem);
                    const magicAtk = this.player.data.matk || 0;
                    const fireMul = dashEffect.damageMul;
                    damage = Math.floor((physAtk + magicAtk) * fireMul);
                } else {
                    const baseDamage = this.player.getCurrentWeaponAtk(currentItem);
                    damage = Math.floor(baseDamage * dashEffect.damageMul);
                }
                const targetCritRes3 = (entity.data && entity.data.critRes) || 0;
                let playerCrit3 = this.player.data.crit || 0;
                if (this.player.skills && this.player.skills.rifleMastery) {
                    const currentWpn3 = currentItem;
                    if (currentWpn3 && isRifle(currentWpn3.weaponType)) {
                        playerCrit3 += this.player.skills.rifleMastery.getEffect(this.player.skills.rifleMastery.level).critRateBonus;
                    }
                }
                const finalCritRate3 = Math.max(0, playerCrit3 - targetCritRes3);
                const isCrit = Math.random() * 100 < finalCritRate3;
                let critMul = dashEffect.critMul;
                if (isCrit && this.player.skills && this.player.skills.criticalStrike) {
                    const csEffect = this.player.skills.criticalStrike.getEffect(this.player.skills.criticalStrike.level);
                    critMul = 1 + csEffect.damageBonus;
                }
                const finalDamage = isCrit ? Math.floor(damage * critMul) : damage;
                const wasAlive = entity.hp > 0;
                this._playMeleeHitSound(); // 冲刺攻击/冲刺攻击-火命中
                entity.takeDamage(finalDamage, this.player, 'physical', true);
                if (window.__phaserScene) window.__phaserScene.triggerZombieHitParticles(entity, this.player);
                if (wasAlive && entity.hp <= 0) this.player._dashKillCount++;
                const kbAngle = Math.atan2(entity.y - this.player.y, entity.x - this.player.x);
                entity.applyKnockback(kbAngle, knockback);
                EffectFactory.createHitEffect(entity.x, entity.y);
                if (isCrit) EffectFactory.createHitEffect(entity.x, entity.y - entity.size * 1.5);
                if (isFire) {
                    // 火焰特效：命中时额外生成火焰爆炸
                    EffectManager.add(new DashFireTrailEffect(entity.x, entity.y, 0, 0, null));
                }
                this.player._triggerRuneSwordCooldownReduction();
            });
        }
    }

    // 冲刺攻击-火：在武器路径上生成火焰粒子
    _spawnFireTrail() {
        if (!this.player._dashFireTrailTimer) this.player._dashFireTrailTimer = 0;
        const skill = this.player.skills.dashAttackFire;
        const effect = skill ? skill.getEffect(this._getDashSkillLevel('dashAttackFire')) : {};
        this.player._dashFireTrailTimer += 16.67; // 约60fps
        if (this.player._dashFireTrailTimer < (effect.fireTrailSpawnInterval || 50)) return; // 按配置间隔生成
        this.player._dashFireTrailTimer = 0;
        // 在武器位置生成火焰粒子
        const state = this._getDashWeaponStateAt(this.player._dashTimer, 'dashAttackFire');
        // 计算武器尖端位置（基于当前玩家位置和朝向）
        const cos = Math.cos(this.player.rotation);
        const sin = Math.sin(this.player.rotation);
        // 武器偏移量（基于dash状态）
        const offsetDist = (effect.fireTrailWeaponOffset || 60) + state.dashOffset;
        const wx = this.player.x + cos * offsetDist;
        const wy = this.player.y + sin * offsetDist;
        EffectManager.add(new DashFireTrailEffect(wx, wy, this.player._dashDirection.x, this.player._dashDirection.y, null));
    }
}

export { DashSystem };
