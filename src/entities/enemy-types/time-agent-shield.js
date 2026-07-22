import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { AgentLinkSystem } from '../../world/agent-link-system.js';
import { setupGun, tryEnemyFireGun } from './_shared/enemy-gun.js';
import { hostilesOf, isTargetMeleeStyle, playSoundFrom } from './_shared/enemy-utils.js';
import { twoStageWalkKey, ratioHitElapsed } from './_shared/monster-anim.js';

/**
 * 用线段近似绘制二次贝塞尔曲线（Phaser Graphics 无内置 quadraticCurveTo）
 * @param {Phaser.GameObjects.Graphics} g
 * @param {number} x0 起点 X
 * @param {number} y0 起点 Y
 * @param {number} x1 控制点 X
 * @param {number} y1 控制点 Y
 * @param {number} x2 终点 X
 * @param {number} y2 终点 Y
 * @param {number} segments 采样段数
 */
function _drawQuadraticBezier(g, x0, y0, x1, y1, x2, y2, segments = 12) {
    g.beginPath();
    g.moveTo(x0, y0);
    const n = Math.max(2, Math.floor(segments));
    for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        const a = u * u;
        const b = 2 * u * t;
        const c = t * t;
        const x = a * x0 + b * x1 + c * x2;
        const y = a * y0 + b * y1 + c * y2;
        g.lineTo(x, y);
    }
    g.strokePath();
}

/**
 * 时空特工(盾位)-F（领主，特工 family）——沙鹰射击 + 盾击 + 防御弹反
 *
 * 状态机（_formState）：
 * - idle：待机（idle.png 单帧）；移动 walking 16 帧首段 → 5~16 帧循环
 * - toRanged / ranged：idle→远程 0.5s 正放 switch 8 帧，第 8 帧（结束）开火；
 *   远程形态可移动射击（沙漠之鹰数据，命中不击退），静止持枪姿态 = switch 第 8 帧；
 *   目标脱离 disengageRange 后 0.5s 倒放 switch 回 idle
 * - push：盾击（仅远程形态，200px 内）——push 17 帧 1.5s，第 7 帧判定物攻×1.5 + 眩晕 2s，不可移动，CD 10s
 * - defendIn / defendHold / defendOut：防御（参考铠甲骑士格挡）——目标攻击临近时触发，
 *   0.75s 正放 defending 10 帧进入 → 第 10 帧持续 4s（弹反状态，可正常开火）→ 0.75s 倒放退出
 *
 * 所有数值均来自 enemy-config.json timeAgentShield.attackSkills，类内不硬编码。
 */
export class TimeAgentShield extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.timeAgentShield,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        // 攻击决策完全自管：关闭 CombatSystem 的通用近战触发（同 mutant-3 模式）
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        // 形态状态机
        this._formState = 'idle';
        this._stateTimer = 0;
        this._walkElapsed = 0;
        // 技能冷却
        this._bashCd = 0;
        this._bashHitDone = false;
        this._defendCd = 0;
        this._walkSoundTimer = 0;

        // 装备沙漠之鹰（共享装配：实例化装备/绑定攻击/伤害与击退覆盖/AI 散布）
        const skills0 = this._getSkillConfigs();
        setupGun(this, {
            equipKey: 'desert_eagle',
            attackKey: 'deagle',
            damage: { min: this.data.atk, max: this.data.atk }, // 伤害取怪物面板物攻
            knockback: skills0.shoot.knockback ?? 0,             // 命中不击退（盾位设定）
            spreadFactor: skills0.shoot.spreadFactor ?? 0.1,
            spreadMaxAngle: skills0.shoot.spreadMaxAngle ?? 8,
            fireSound: this.config?.sounds?.fire || null,
        });
    }

    _getSkillConfigs() {
        const s = this.config?.attackSkills || {};
        return {
            forms: s.forms || {},
            shoot: s.shoot || {},
            bash: s.bash || {},
            defend: s.defend || {},
        };
    }

    // ========== 主循环 ==========

    update(dt, entities) {
        if (!this.active) {
            super.update(dt, entities);
            return;
        }

        super.update(dt, entities);

        // 冷却推进
        if (this._bashCd > 0) this._bashCd -= dt;
        if (this._defendCd > 0) this._defendCd -= dt;

        // 眩晕：暂停一切决策与动作推进（恢复后继续）
        if (this.hasStatusEffect && this.hasStatusEffect('stun')) return;

        const t = this.target && this.target.active ? this.target : null;
        const dist = t ? Math.hypot(t.x - this.x, t.y - this.y) : Infinity;

        // 朝向目标
        if (t) this.rotation = Math.atan2(t.y - this.y, t.x - this.x);

        // 状态机
        const ACTION_STATES = ['toRanged', 'toIdle', 'push', 'defendIn', 'defendHold', 'defendOut'];
        if (ACTION_STATES.includes(this._formState)) {
            this._stateTimer -= dt;
            this._updateActionStates(dt, entities, t, dist);
            this._attackAnimTimer = 100; // MovementSystem 锁定（不可移动）
        } else {
            this._attackAnimTimer = 0;   // MovementSystem 驱动追击
            this._updateForms(dt, entities, t, dist);
        }

        // 连续移动计时（walk 首段→循环段）
        if (this.isMoving) this._walkElapsed += dt;
        else this._walkElapsed = 0;

        // 移动脚步音（walking.mp3，按间隔循环）
        if (this.isMoving) {
            this._walkSoundTimer -= dt;
            if (this._walkSoundTimer <= 0) {
                this._walkSoundTimer = this.config?.sounds?.walkInterval ?? 500;
                playSoundFrom(this, 'walk');
            }
        } else {
            this._walkSoundTimer = 0;
        }

        // attackRange 按形态/联动动态切换（MovementSystem 用它做减速/停步判定）：
        // idle=交战距离；远程=接近到 150px；联动规则2（突击近战）= 贴近到 shieldCloseRange
        const skills = this._getSkillConfigs();
        const linkCfg = AgentLinkSystem.getMeleeSupportConfig();
        if (this._formState === 'idle') {
            this.attackRange = skills.forms.engageRange ?? 800;
        } else if (linkCfg && AgentLinkSystem.isAssaultInMelee(entities)) {
            this.attackRange = linkCfg.shieldCloseRange;
        } else {
            this.attackRange = skills.forms.approachRange ?? 150;
        }
    }

    // ========== 形态决策 ==========

    _updateForms(dt, entities, t, dist) {
        const skills = this._getSkillConfigs();
        const F = skills.forms;

        if (this._formState === 'idle') {
            // 目标进入交战距离 → 切入远程形态
            if (t && dist <= (F.engageRange ?? 800)) {
                this._startTransition('toRanged', F.switchInMs ?? 500);
            }
            return;
        }

        if (this._formState === 'ranged') {
            // 目标脱离 → 倒放回 idle
            if (!t || dist > (F.disengageRange ?? 1000)) {
                this._startTransition('toIdle', F.switchOutMs ?? 500);
                return;
            }
            // 盾击：远程形态专用，CD 就绪且目标在生效距离内；
            // 联动规则1——突击闪光弹眩晕期间暂缓盾击，眩晕结束后立即释放
            if (!AgentLinkSystem.shouldHoldBash() && this._bashCd <= 0 && dist <= (skills.bash.range ?? 200)) {
                this._tryAttackTelegraph(() => this._startBash());
                return;
            }
            // 防御：远程目标在接近过程中满足 CD 即用；近战目标在其攻击时才进入防御
            if (t && this._defendCd <= 0 && dist <= (skills.defend.triggerRange ?? 260)) {
                if (isTargetMeleeStyle(t)) {
                    this._tryStartDefend(t, dist); // 近战：攻击时才防御
                } else {
                    this._startDefend(); // 远程：接近过程中主动防御
                }
            }
            // 开火：目标在射程内
            if (dist <= (skills.shoot.fireRange ?? 750)) {
                this._tryFireGun(t, entities);
            }
        }
    }

    /** 防御触发判定（idle/ranged 均可调用） */
    _tryStartDefend(t, dist) {
        const skills = this._getSkillConfigs();
        const D = skills.defend;
        if (!t || this._defendCd > 0) return;
        const targetAttacking = t.weaponAnim && t.weaponAnim.state && t.weaponAnim.state !== 'idle';
        if (targetAttacking && dist <= (D.triggerRange ?? 260)) {
            this._startDefend();
        }
    }

    // ========== 动作推进 ==========

    _updateActionStates(dt, entities, t, dist) {
        const skills = this._getSkillConfigs();

        // 盾击命中帧
        if (this._formState === 'push') {
            const B = skills.bash;
            const fireT = ratioHitElapsed(B.hitFrame, B.frames, B.duration);
            const elapsed = (B.duration || 0) - this._stateTimer;
            if (!this._bashHitDone && elapsed >= fireT) {
                this._bashHitDone = true;
                this._dealBashHit(entities);
            }
        }

        // 防御持续阶段：弹反生效且可开火
        if (this._formState === 'defendHold') {
            if (t && dist <= (skills.shoot.fireRange ?? 750)) {
                this._tryFireGun(t, entities);
            }
        }

        if (this._stateTimer > 0) return;

        // 动作完成 → 进入对应形态
        const D = skills.defend;
        switch (this._formState) {
            case 'toRanged':  this._enterForm('ranged'); break;
            case 'toIdle':    this._enterForm('idle'); break;
            case 'push':      this._enterForm('ranged'); break;
            case 'defendIn':
                this._formState = 'defendHold';
                this._stateTimer = D.duration ?? 4000;
                break;
            case 'defendHold':
                this._formState = 'defendOut';
                this._stateTimer = D.outroMs ?? 750;
                break;
            case 'defendOut':
                this._clearDefendHitbox();
                this._enterForm(t ? 'ranged' : 'idle');
                break;
        }
    }

    _enterForm(state) {
        this._formState = state;
        this._walkElapsed = 0;
    }

    _startTransition(state, ms) {
        this._formState = state;
        this._stateTimer = ms;
    }

    _startBash() {
        const B = this._getSkillConfigs().bash;
        this._formState = 'push';
        this._stateTimer = B.duration ?? 1500;
        this._bashHitDone = false;
        this._bashCd = B.cooldown ?? 10000;
        // 盾后白色冲击线条（向前冲击观感）
        this._fireBashThrustLines();
    }

    /**
     * 盾击冲击线条：盾前缘沿盾轮廓向后弧线延伸的尾迹。
     * 起点分布在盾正面的一道弧线上，随后以二次贝塞尔曲线向身后弯曲淡出。
     */
    _fireBashThrustLines() {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add || !scene.tweens) return;
        const g = scene.add.graphics();
        g.setDepth(this.y + 50);
        const facing = (typeof this.rotation === 'number') ? this.rotation : 0;
        const wave = { t: 0 };
        const self = this;
        scene.tweens.add({
            targets: wave,
            t: 1,
            duration: 480,
            ease: 'Cubic.easeOut',
            onUpdate() {
                const p = wave.t;
                g.clear();
                const lines = 11;
                const shieldFrontDist = 62;          // 盾前缘中心到脚下的距离
                const shieldHalfArc = Math.PI / 2.8; // 盾轮廓张角的一半
                const baseLen = 35 + p * 55;         // 尾迹长度随时间伸展
                // 双线描边：外圈柔化 + 内核高亮（整体 1.5 / 0.7 细线）
                for (let pass = 0; pass < 2; pass++) {
                    const width = pass === 0 ? 1.5 : 0.7;
                    const alpha = (pass === 0 ? 0.35 : 0.9) * (1 - p);
                    g.lineStyle(width, 0xffffff, alpha);
                    for (let i = 0; i < lines; i++) {
                        const arcT = (i / (lines - 1)) * 2 - 1; // -1 ~ 1，沿盾轮廓分布
                        // 盾前缘起点：以 facing 为法向的弧面
                        const sideAngle = facing + Math.PI / 2 + arcT * shieldHalfArc;
                        const arcRadius = shieldFrontDist * Math.cos(arcT * 0.55);
                        const sx = self.x + Math.cos(sideAngle) * arcRadius;
                        const sy = self.y + Math.sin(sideAngle) * arcRadius * PERSPECTIVE_SCALE_Y;

                        // 向后延伸方向：带弧度，越靠盾轮廓外侧弧线越明显
                        const backAngle = facing + Math.PI + arcT * (shieldHalfArc * 0.55);
                        const len = baseLen * (0.85 + Math.abs(arcT) * 0.3);
                        const cx = sx + Math.cos(backAngle + arcT * 0.25) * len * 0.45;
                        const cy = sy + Math.sin(backAngle + arcT * 0.25) * len * 0.45 * PERSPECTIVE_SCALE_Y;
                        const ex = sx + Math.cos(backAngle + arcT * 0.35) * len;
                        const ey = sy + Math.sin(backAngle + arcT * 0.35) * len * PERSPECTIVE_SCALE_Y;

                        // Phaser Graphics 没有 quadraticCurveTo，改为沿二次贝塞尔采样线段绘制
                        _drawQuadraticBezier(g, sx, sy, cx, cy, ex, ey, 12);
                    }
                }
            },
            onComplete() {
                if (g.active) g.destroy();
            }
        });
    }

    _startDefend() {
        const D = this._getSkillConfigs().defend;
        this._formState = 'defendIn';
        this._stateTimer = D.windupMs ?? 750;
        this._defendCd = D.cooldown ?? 6000;
        // 防御姿态：绿色矩形判定从上向下收 40px（实例级覆盖，退出防御经 _clearDefendHitbox 恢复）
        const hb = this.config?.render?.projectileHitbox || {};
        this._hitboxOverride = {
            width: hb.width,
            height: Math.max(1, (hb.height || 0) - (D.hitboxShrinkY ?? 40)),
            offsetX: hb.offsetX || 0,
            bottom: hb.bottom || 0,
        };
        // 面对目标释放
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
    }

    /** 退出防御：恢复矩形判定 */
    _clearDefendHitbox() {
        this._hitboxOverride = null;
    }

    // ========== 格挡弹反（参考铠甲骑士：防御持续期间全部判定为弹反） ==========

    takeDamage(damage, source, damageType = 'physical', isMelee = true) {
        // 防御持续阶段（defendHold）：玩家来源伤害判定为弹反——免伤，近战攻击者被眩晕击退
        if (this._formState === 'defendHold' && source && source._faction === 'player') {
            if (this.shieldSystem) this.shieldSystem._lastParried = true;
            this._triggerDefendParry(source, isMelee);
            return;
        }
        if (this.shieldSystem) this.shieldSystem._lastParried = false;

        // 盾卫特性：远程伤害减免 50%（包括远程魔法伤害）。
        // 判定口径与 DamagePipeline/Projectile 一致：isMelee === false 即为远程。
        if (!isMelee) {
            damage = Math.max(1, Math.floor(damage * 0.5));
        }

        super.takeDamage(damage, source, damageType, isMelee);
    }

    _triggerDefendParry(attacker, isMelee) {
        // 防御姿态受击音效（hitting.mp3，每次受击播放）
        playSoundFrom(this, 'bash');
        // 与骑士/玩家盾系统同口径：远程/魔法只抵消伤害；近战才眩晕+击退；弹反免疫单位不受影响
        if (!isMelee) return;
        if (!attacker || attacker._parryImmune) return;
        const D = this._getSkillConfigs().defend;
        if (attacker.applyStun) attacker.applyStun(D.parryStunMs ?? 2000);
        const angle = Math.atan2(attacker.y - this.y, attacker.x - this.x);
        if (attacker.applyKnockback) attacker.applyKnockback(angle, D.parryKnockback ?? 100);
    }

    // ========== 盾击 ==========

    _dealBashHit(entities) {
        const B = this._getSkillConfigs().bash;
        const range = B.range ?? 200;
        const atk = this.data?.atk || 0;
        // 盾击判定音效（hitting.mp3，判定时播放）
        playSoundFrom(this, 'bash');
        const shape = new GroundEllipse(this.x, this.y, range, range * PERSPECTIVE_SCALE_Y);
        for (const e of hostilesOf(this, entities)) {
            if (!shape.intersectsEntity(e)) continue;
            e.takeDamage(Math.max(1, Math.round(atk * (B.damageMul ?? 1.5))), this, 'physical', true);
            if (B.stunMs && typeof e.applyStun === 'function') {
                e.applyStun(B.stunMs);
            }
        }
    }

    // ========== 远程射击（沙漠之鹰） ==========

    _tryFireGun(t, entities) {
        const skills = this._getSkillConfigs().shoot;
        // 共享开火一体化：枪口偏移/墙体回退/瞄准上方 25%/临时移位出膛/火焰+火光+弹壳
        // 防御姿态开火枪口下移 defendMuzzleDownY（退出防御自动恢复）
        tryEnemyFireGun(this, t, entities, {
            muzzleUpY: skills.muzzleUpY ?? 75,
            muzzleSideX: skills.muzzleSideX ?? 15,
            muzzleScale: skills.muzzleScale ?? 1.2,
            aimHeightRatio: skills.aimHeightRatio ?? 0.875,
            defendActive: this._formState === 'defendHold',
            defendMuzzleDownY: skills.defendMuzzleDownY ?? 45,
        });
    }

    // ========== 动画 ==========

    /** 当前状态对应的贴图键（必须是已加载的纹理；动画键见 _getAnimKey） */
    _getTextureKey() {
        switch (this._formState) {
            case 'toRanged':
            case 'toIdle':    return 'enemy_timeshield_switch';
            case 'ranged':
                return this.isMoving ? 'enemy_timeshield_walk' : 'enemy_timeshield_switch';
            case 'push':      return 'enemy_timeshield_push';
            case 'defendIn':
            case 'defendHold':
            case 'defendOut': return 'enemy_timeshield_defend';
            default: // idle
                return this.isMoving ? 'enemy_timeshield_walk' : 'enemy_timeshield_idle';
        }
    }

    /** 当前状态对应的动画键 */
    _getAnimKey() {
        const F = this._getSkillConfigs().forms;
        switch (this._formState) {
            case 'toRanged':    return 'enemy_timeshield_ranged_in';
            case 'toIdle':      return 'enemy_timeshield_ranged_out';
            case 'push':        return 'enemy_timeshield_push';
            case 'defendIn':    return 'enemy_timeshield_defend_in';
            case 'defendHold':  return 'enemy_timeshield_defend_hold';
            case 'defendOut':   return 'enemy_timeshield_defend_out';
            case 'ranged':
                // 远程形态：移动播放 5~16 循环段（移动射击），静止持枪姿态
                if (this.isMoving) return 'enemy_timeshield_walk_loop';
                return 'enemy_timeshield_ranged_pose';
            default: // idle
                if (this.isMoving) {
                    return twoStageWalkKey('enemy_timeshield_walk', 'enemy_timeshield_walk_loop',
                        this._walkElapsed, F.walkIntroMs ?? 1067);
                }
                return 'enemy_timeshield_idle';
        }
    }

    _getPhaserOptions() {
        const renderCfg = this.config?.render || {};
        let flipX = false;
        if (this.target && this.target.active) {
            flipX = this.target.x < this.x;
        } else if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }
        return {
            spriteSize: renderCfg.spriteSize || 160,
            collisionWidth: renderCfg.collisionWidth || 60,
            collisionHeight: renderCfg.collisionHeight || 110,
            textOffsetY: -(renderCfg.spriteSize || 160) / 2 - 10,
            flipX,
            animState: this._formState,
            animKey: this._getAnimKey(),
        };
    }
}
