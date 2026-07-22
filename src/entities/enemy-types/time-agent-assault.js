import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { EffectManager } from '../../effects/effect-manager.js';
import { AttackRangeEffect } from '../../effects/attack-range-effect.js';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { AimHelper } from '../../utils/aim-helper.js';
import { WallSystem } from '../../world/wall-system.js';
import { pathFinder } from '../../ai/pathfinder.js';
import { AgentLinkSystem } from '../../world/agent-link-system.js';
import { EffectFactory } from '../../utils/effect-factory.js';
import { setupGun, tryEnemyFireGun } from './_shared/enemy-gun.js';
import { hostilesOf, isTargetMeleeStyle, playSoundFrom } from './_shared/enemy-utils.js';
import { twoStageWalkKey, frameHitElapsed, ratioHitElapsed } from './_shared/monster-anim.js';

/**
 * 时空特工(突击)-F（领主，特工 family）——首个双形态切换怪物
 *
 * 形态状态机（_formState）：
 * - idle：待机（idle.png）；移动 walking 18 帧首段 → 4~18 帧循环
 * - toRanged / ranged：idle→远程 0.5s 正放 attacking 8 帧，第 8 帧（结束）开始开火；
 *   远程形态可移动射击（QBZ-191 数据，弹匣 30 打空自动换弹、弹匣无限），
 *   静止持枪姿态 = attacking 第 8 帧；ranged→idle 0.5s 倒放 attacking
 * - flashThrow：闪光弹（仅远程形态）——flash 32 帧 2s，第 24 帧抛物线投出
 *   （贴图 360° 旋转 + 地面红色椭圆预警），落地椭圆判定魔法伤害×1.5 + 眩晕
 * - axeIntro / melee / axeAttack：近战风格目标贴身 150px 触发（远程形态先倒放回 idle）；
 *   首次 axe 30 帧 2s 劈砍（物攻×2 + 3s 致残）后进入近战形态；
 *   近战移速 260、持斧姿态 = axe 第 30 帧、移动 walking-2 19 帧首段 → 3~18 帧循环；
 *   近战劈砍 axe 12~30 帧（不可移动）
 * - toRangedSwitch：近战→远程 0.75s switch 21 帧（不可移动）；
 *   条件：远程风格目标距离>150px，或任意目标距离>300px 持续 3s
 * - 形态切换冷却 1s（formSwitchCooldown）
 *
 * 所有数值均来自 enemy-config.json timeAgentAssault.attackSkills，类内不硬编码。
 */
export class TimeAgentAssault extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.timeAgentAssault,
            showWeapon: false,
            ...config
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        // 攻击决策完全自管：关闭 CombatSystem 的通用近战触发（同 mutant-3 模式）
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        const skills = this._getSkillConfigs();

        // 形态状态机
        this._formState = 'idle';
        this._stateTimer = 0;        // 当前过渡/攻击动作剩余时间
        this._formSwitchCd = 0;      // 形态切换冷却
        this._farHoldTimer = 0;      // 近战形态下目标拉远持续计时
        this._walkElapsed = 0;       // 连续移动计时（walk 首段→循环段切换）

        // 技能冷却
        this._flashCd = 0;
        this._axeCd = 0;
        // 单次动作判定标记
        this._axeHitDone = false;
        this._flashFired = false;

        // 闪光弹投掷状态
        this._flashTarget = null;
        this._flashWarning = null;
        this._flashSprite = null;

        // 远程攻击 AI 状态
        this._losTimer = 0;          // 视线检测节流
        this._losClear = true;       // 与目标间视线是否通畅（无障碍可命中）
        this._bandEvalTimer = 0;     // 狭小空间评估缓存计时
        this._bandUsable = true;     // 地图空间是否允许保持最小距离（800px 带可用）
        this._bandPhase = 'stop';    // 不规则运动相位：move | stop
        this._bandTimer = 0;
        this._bandDir = 1;           // 环绕方向 ±1
        this._repathTimer = 0;       // 寻路重算节流
        this._path = null;
        this._pathIdx = 0;
        this._selfMoving = false;    // 远程自驱移动标记（MovementSystem 锁定会清零 isMoving，动画以此为准）
        this._meleeStepTimer = 0;    // 近战脚步音计时
        this._rangedMoveMode = null; // 远程当前移动模式（迟滞切换，防边界抖动）
        // 联动规则2（近战回拉）状态
        this._linkRetreatStart = null;
        this._linkRetreatDisabled = false;
        this._linkRetreating = false;

        // 装备 QBZ-191（共享装配：实例化装备/绑定攻击/伤害与击退覆盖/AI 散布/弹匣）
        setupGun(this, {
            equipKey: 'qbz191',
            attackKey: 'qbz191',
            damage: { min: this.data.atk, max: this.data.atk }, // 伤害取怪物面板物攻
            knockback: skills.shoot.knockback ?? 25,             // 命中击退 25px
            spreadFactor: skills.shoot.spreadFactor ?? 0.15,
            spreadMaxAngle: skills.shoot.spreadMaxAngle ?? 10,
            fireSound: this.config?.sounds?.fire || null,
            ammoConfig: skills.shoot.ammo || null,               // 弹匣 30 发 + 3s 换弹（不影响玩家同款武器）
        });
        this._initAmmoForSlot('weapon');
    }

    _getSkillConfigs() {
        const s = this.config?.attackSkills || {};
        return {
            forms: s.forms || {},
            shoot: s.shoot || {},
            flashbang: s.flashbang || {},
            axe: s.axe || {},
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
        if (this._formSwitchCd > 0) this._formSwitchCd -= dt;
        if (this._flashCd > 0) this._flashCd -= dt;
        if (this._axeCd > 0) this._axeCd -= dt;

        // 眩晕：暂停一切决策与动作推进（恢复后继续）
        if (this.hasStatusEffect && this.hasStatusEffect('stun')) return;

        // 入侵特工（时空特工追击机制）：与全场敌对，每帧锁定最近的非 agent 单位为目标
        if (this._invasionAgent) {
            this.target = this._nearestHostile(entities);
        }

        const t = this.target && this.target.active ? this.target : null;
        const dist = t ? Math.hypot(t.x - this.x, t.y - this.y) : Infinity;

        // 朝向目标（ MovementSystem 驱动移动时方向一致；动作期锁定）
        if (t) this.rotation = Math.atan2(t.y - this.y, t.x - this.x);

        // 状态机：动作态（锁移动）与形态态分流
        const ACTION_STATES = ['toRanged', 'toIdle', 'toRangedSwitch', 'axeIntro', 'axeAttack', 'flashThrow'];
        if (ACTION_STATES.includes(this._formState)) {
            this._stateTimer -= dt;
            this._updateActionStates(dt, entities, t, dist);
            this._attackAnimTimer = 100; // MovementSystem 锁定
        } else {
            // 远程形态移动完全自驱（寻位/环绕/寻路），MovementSystem 全程锁定；
            // 近战形态交给 MovementSystem 主动追击
            this._attackAnimTimer = this._formState === 'ranged' ? 100 : 0;
            this._updateForms(dt, entities, t, dist);
            // 联动规则2 自驱回拉期间同样锁定 MovementSystem
            if (this._linkRetreating) this._attackAnimTimer = 100;
        }

        // 连续移动计时（walk/walk2 首段→循环段）：
        // 远程模式 MovementSystem 锁定会清零 isMoving，以自驱标记 _selfMoving 为准
        if (this._effectiveMoving()) this._walkElapsed += dt;
        else this._walkElapsed = 0;

        // 近战形态移动脚步音（铠甲骑士冲锋同款：walking.mp3 按间隔循环）
        if ((this._formState === 'melee' || this._formState === 'axeAttack') && this._effectiveMoving()) {
            this._meleeStepTimer -= dt;
            if (this._meleeStepTimer <= 0) {
                this._meleeStepTimer = this.config?.sounds?.meleeStepInterval ?? 300;
                playSoundFrom(this, 'meleeStep');
            }
        } else {
            this._meleeStepTimer = 0;
        }

        // 远程锁定期间 MovementSystem 不处理击退，自行应用（同口径：衰减+墙壁解析）
        if (this._formState === 'ranged' && (this.knockbackX || this.knockbackY)) {
            const kf = this.knockbackFriction || 0.9;
            const sc = dt / 1000;
            const nx = this.x + (this.knockbackX || 0) * sc;
            const ny = this.y + (this.knockbackY || 0) * sc;
            const r = WallSystem.resolve(this.x, this.y, nx, ny, this.groundRadius);
            this.x = r.x;
            this.y = r.y;
            this.knockbackX *= kf;
            this.knockbackY *= kf;
            if (Math.abs(this.knockbackX) < 1 && Math.abs(this.knockbackY) < 1) {
                this.knockbackX = 0;
                this.knockbackY = 0;
            }
        }

        // 近战形态移速提升（其余形态用配置速度）；
        // attackRange 同步按形态切换——MovementSystem 用它做减速/停步判定，
        // 远程 1600 若带入近战会导致 800px 外就被制动（近战 260 无法体现的根因）
        const skills = this._getSkillConfigs();
        const inMelee = this._formState === 'melee' || this._formState === 'axeAttack';
        this.maxSpeed = inMelee ? (skills.forms.meleeMoveSpeed ?? 260) : (this.config.speed ?? 160);
        this.attackRange = inMelee ? (skills.axe.judgeRange ?? 120) : (skills.forms.engageRange ?? 1600);
    }

    // ========== 形态决策（可移动状态） ==========

    _updateForms(dt, entities, t, dist) {
        const skills = this._getSkillConfigs();
        const F = skills.forms;

        if (this._formState === 'idle') {
            // 斧砍条件优先：近战风格目标贴身 → 直接首次劈砍进入近战形态
            if (t && this._formSwitchCd <= 0 && isTargetMeleeStyle(t) && dist <= (F.meleeCheckRange ?? 150)) {
                this._tryAttackTelegraph(() => this._startAxeIntro());
                return;
            }
            // 远程交战：目标进入交战距离 → 切入远程形态
            if (t && this._formSwitchCd <= 0 && dist <= (F.engageRange ?? 1600)) {
                this._startTransition('toRanged', F.switchInMs ?? 500);
            }
            return;
        }

        if (this._formState === 'ranged') {
            // 近战风格目标贴身 → 倒放切回 idle（随后可接斧砍）
            if (t && this._formSwitchCd <= 0 && isTargetMeleeStyle(t) && dist <= (F.meleeCheckRange ?? 150)) {
                this._startTransition('toIdle', F.switchOutMs ?? 500);
                return;
            }
            // 远程 idle / rangeattack 子状态切换：需要移动或攻击才进入 rangeattack
            const engaged = t && dist <= (F.engageRange ?? 1600);
            if (!engaged) {
                // 远程 idle 姿态：站立不动（持枪警戒）
                this._selfMoving = false;
                this.isMoving = false;
                this.vx = 0;
                this.vy = 0;
                return;
            }
            // ===== rangeattack 状态 =====
            // 闪光弹：仅远程攻击状态且距离 <600px
            if (this._flashCd <= 0 && dist < (skills.flashbang.throwRange ?? 600)) {
                this._tryAttackTelegraph(() => this._startFlashThrow());
                return;
            }
            // 视线检测（节流）：与目标间是否有障碍物导致无法命中
            this._losTimer -= dt;
            if (this._losTimer <= 0) {
                this._losTimer = F.losCheckMs ?? 200;
                this._losClear = !(WallSystem && WallSystem.blocked && WallSystem.blocked(this.x, this.y, t.x, t.y));
            }
            // 狭小空间评估（节流缓存）：是否存在可保持 800px 最小距离且视线通畅的位置
            this._bandEvalTimer -= dt;
            if (this._bandEvalTimer <= 0) {
                this._bandEvalTimer = F.bandEvalMs ?? 2000;
                this._bandUsable = this._evalBandPositions(t);
            }
            // 移动模式选择（带迟滞，防止边界抖动）：
            // 视线受阻 → 寻路找射击角度（不受 800 最小距离限制）；
            // >1600 → 直线推进到 1200；<800 → 后撤回带（狭小空间改寻路）；带内 → 移动-停止不规则运动
            let mode;
            if (!this._losClear) {
                mode = 'reposition';
            } else {
                const bandMax = F.bandMax ?? 1200;
                const bandMin = F.bandMin ?? 800;
                const hyst = 40; // 边界迟滞余量，防止 retreat/band/approach 来回跳变
                const cur = this._rangedMoveMode;
                if (cur === 'retreat') {
                    mode = dist < bandMin + hyst ? 'retreat' : (this._bandUsable ? 'band' : 'reposition');
                } else if (cur === 'approach') {
                    mode = dist > bandMax - hyst ? 'approach' : (this._bandUsable ? 'band' : 'reposition');
                } else {
                    if (dist > (F.approachMaxRange ?? 1600)) mode = 'approach';
                    else if (dist > bandMax + hyst) mode = 'approach';
                    else if (dist < bandMin - hyst) mode = this._bandUsable ? 'retreat' : 'reposition';
                    else mode = this._bandUsable ? 'band' : 'reposition';
                }
            }
            this._rangedMoveMode = mode;
            let moved = false;
            switch (mode) {
                case 'approach':
                    this._moveToward(t.x, t.y, this.maxSpeed, dt);
                    moved = true;
                    break;
                case 'retreat': {
                    const awayA = Math.atan2(this.y - t.y, this.x - t.x);
                    this._moveToward(this.x + Math.cos(awayA) * 200, this.y + Math.sin(awayA) * 200, this.maxSpeed, dt);
                    moved = true;
                    break;
                }
                case 'band':
                    moved = this._updateBandMovement(dt, t, dist);
                    break;
                case 'reposition':
                    moved = this._updateReposition(dt, t);
                    break;
            }
            this._selfMoving = moved;
            this.isMoving = moved; // 会被 MovementSystem 锁定清零，动画以 _selfMoving 为准
            if (!moved) { this.vx = 0; this.vy = 0; }
            // 开火：视线通畅且目标在射程内（弹匣打空自动换弹）
            if (this._losClear && dist <= (skills.shoot.fireRange ?? 1200)) {
                this._tryFireGun(t, entities);
            }
            return;
        }

        if (this._formState === 'melee') {
            // 联动规则2：盾卫在场时优先拉开距离换回远程（4s 未换回恢复默认近战 AI）
            const linkCfg = AgentLinkSystem.getMeleeSupportConfig();
            if (linkCfg && t && !this._linkRetreatDisabled) {
                if (!this._linkRetreatStart) this._linkRetreatStart = Date.now();
                const elapsed = Date.now() - this._linkRetreatStart;
                if (elapsed < linkCfg.assaultFallbackMs) {
                    this._linkRetreating = true;
                    // 自驱远离目标，满足切回远程条件（下方切换判定照常进行）
                    const awayA = Math.atan2(this.y - t.y, this.x - t.x);
                    this._moveToward(this.x + Math.cos(awayA) * 200, this.y + Math.sin(awayA) * 200, this.maxSpeed, dt);
                    this._selfMoving = true;
                } else {
                    // 4s 未换回：本次近战状态内禁用联动，恢复默认近战 AI
                    this._linkRetreatDisabled = true;
                    this._linkRetreating = false;
                }
            } else {
                this._linkRetreating = false;
            }
            // 近战→远程：远程风格目标拉开 150px 以上，或任意目标拉开 300px 持续 3s
            if (this._formSwitchCd <= 0) {
                const rangedOut = t && !isTargetMeleeStyle(t) && dist > (F.meleeCheckRange ?? 150);
                if (t && dist > (F.farSwitchRange ?? 300)) {
                    this._farHoldTimer += dt;
                } else {
                    this._farHoldTimer = 0;
                }
                if (rangedOut || this._farHoldTimer >= (F.farSwitchHoldMs ?? 3000)) {
                    this._farHoldTimer = 0;
                    this._startTransition('toRangedSwitch', F.formSwitchMs ?? 750);
                    return;
                }
            }
            // 近战劈砍：贴身且 CD 就绪
            if (t && this._axeCd <= 0 && dist <= (skills.axe.judgeRange ?? 100)) {
                this._tryAttackTelegraph(() => this._startAxeAttack());
            }
        }
    }

    // ========== 动作推进（锁移动状态） ==========

    _updateActionStates(dt, entities, t, _dist) {
        const skills = this._getSkillConfigs();
        const A = skills.axe;

        // 斧砍命中帧（首次与近战共用判定逻辑，帧位各自配置）
        if (this._formState === 'axeIntro' || this._formState === 'axeAttack') {
            const fps = A.introFps ?? 15;
            const isIntro = this._formState === 'axeIntro';
            const duration = isIntro ? (A.introDuration ?? 2000) : this._axeAttackDuration();
            const startFrame = isIntro ? 0 : 11;
            const hitFrame = isIntro ? (A.introHitFrame ?? 15) : (A.attackHitAbsFrame ?? 20);
            const elapsed = duration - this._stateTimer;
            // 切换近战的斧音在配置帧（axeIntroFrame，默认第 14 帧）播放一次
            if (isIntro && !this._axeIntroSoundDone) {
                const soundFrame = this.config?.sounds?.axeIntroFrame ?? 14;
                if (elapsed >= frameHitElapsed(soundFrame, startFrame, fps)) {
                    this._axeIntroSoundDone = true;
                    playSoundFrom(this, 'axe');
                }
            }
            if (!this._axeHitDone && elapsed >= frameHitElapsed(hitFrame, startFrame, fps)) {
                this._axeHitDone = true;
                this._dealAxeHit(entities);
            }
        }

        // 闪光弹出手帧
        if (this._formState === 'flashThrow') {
            const FB = skills.flashbang;
            const fireT = ratioHitElapsed(FB.fireFrame, FB.frames, FB.duration);
            const elapsed = (FB.duration || 0) - this._stateTimer;
            if (!this._flashFired && elapsed >= fireT) {
                this._flashFired = true;
                this._launchFlashbang(t);
            }
        }

        if (this._stateTimer > 0) return;

        // 动作完成 → 进入对应形态
        switch (this._formState) {
            case 'toRanged':       this._enterForm('ranged'); break;
            case 'toIdle':         this._enterForm('idle'); break;
            case 'toRangedSwitch': this._enterForm('ranged'); break;
            case 'axeIntro':
                this._axeCd = A.cooldown ?? 4000;
                this._enterForm('melee');
                break;
            case 'axeAttack':
                this._axeCd = A.cooldown ?? 4000;
                this._enterForm('melee');
                break;
            case 'flashThrow':     this._enterForm('ranged'); break;
        }
    }

    _axeAttackDuration() {
        const A = this._getSkillConfigs().axe;
        const fps = A.introFps ?? 15;
        return (29 - 11 + 1) / fps * 1000; // axe 12~30 帧（索引 11~29）
    }

    _enterForm(state) {
        const F = this._getSkillConfigs().forms;
        this._formState = state;
        this._formSwitchCd = F.formSwitchCooldown ?? 1000;
        this._walkElapsed = 0;
        this._farHoldTimer = 0;
        // 进入近战：重置联动回拉状态（每次近战独立计 4s 预算）
        if (state === 'melee') {
            this._linkRetreatStart = null;
            this._linkRetreatDisabled = false;
        }
        this._linkRetreating = false;
    }

    _startTransition(state, ms) {
        this._formState = state;
        this._stateTimer = ms;
        // 形态切换音效（switch.mp3，配置驱动）
        playSoundFrom(this, 'switch');
    }

    _startAxeIntro() {
        const A = this._getSkillConfigs().axe;
        this._formState = 'axeIntro';
        this._stateTimer = A.introDuration ?? 2000;
        this._axeHitDone = false;
        this._axeIntroSoundDone = false;
    }

    _startAxeAttack() {
        this._formState = 'axeAttack';
        this._stateTimer = this._axeAttackDuration();
        this._axeHitDone = false;
        // 近战攻击斧音（axe.mp3，立即播放）
        playSoundFrom(this, 'axe');
    }

    _startFlashThrow() {
        const FB = this._getSkillConfigs().flashbang;
        this._formState = 'flashThrow';
        this._stateTimer = FB.duration ?? 2000;
        this._flashFired = false;
        this._flashCd = FB.cooldown ?? 10000;
    }

    // ========== 远程攻击移动 AI（独立寻路/寻位） ==========

    /** 朝目标点移动（WallSystem 解析墙壁），到达（<8px）返回 true；同步 vx/vy 供动画/朝向 */
    _moveToward(tx, ty, speed, dt) {
        const dx = tx - this.x, dy = ty - this.y;
        const d = Math.hypot(dx, dy);
        if (d < 8) { this.vx = 0; this.vy = 0; return true; }
        const step = Math.min(speed * dt / 1000, d);
        const nx = this.x + dx / d * step, ny = this.y + dy / d * step;
        const r = WallSystem.resolve(this.x, this.y, nx, ny, this.groundRadius);
        const dts = Math.max(dt / 1000, 1e-4);
        this.vx = (r.x - this.x) / dts;
        this.vy = (r.y - this.y) / dts;
        this.x = r.x;
        this.y = r.y;
        return false;
    }

    /**
     * 带内不规则运动（800~1200px）：移动（随机时长/环绕方向）→ 停止 2s → 移动，
     * 切向环绕为主 + 径向修正保持在带内，始终面朝目标寻找射击机会
     */
    _updateBandMovement(dt, t, dist) {
        const F = this._getSkillConfigs().forms;
        this._bandTimer -= dt;
        if (this._bandPhase === 'stop') {
            if (this._bandTimer <= 0) {
                this._bandPhase = 'move';
                const minMs = F.bandMoveMinMs ?? 600;
                const maxMs = F.bandMoveMaxMs ?? 1500;
                this._bandTimer = minMs + Math.random() * (maxMs - minMs);
                this._bandDir = Math.random() < 0.5 ? 1 : -1;
            }
            return false; // 停止相位
        }
        if (this._bandTimer <= 0) {
            this._bandPhase = 'stop';
            this._bandTimer = F.bandStopMs ?? 2000;
            return false;
        }
        // 切向环绕 + 径向修正（偏离带中心越远修正越强）
        const toT = Math.atan2(t.y - this.y, t.x - this.x);
        const tangent = toT + (Math.PI / 2) * this._bandDir;
        const bandMid = ((F.bandMin ?? 800) + (F.bandMax ?? 1200)) / 2;
        const radialErr = dist - bandMid;
        const radial = toT + (radialErr > 0 ? 0 : Math.PI);
        const w = Math.min(1, Math.abs(radialErr) / 200);
        let dx = Math.cos(tangent) * (1 - w) + Math.cos(radial) * w;
        let dy = Math.sin(tangent) * (1 - w) + Math.sin(radial) * w;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        const step = this.maxSpeed * dt / 1000;
        const nx = this.x + dx * step, ny = this.y + dy * step;
        const r = WallSystem.resolve(this.x, this.y, nx, ny, this.groundRadius);
        const dts = Math.max(dt / 1000, 1e-4);
        this.vx = (r.x - this.x) / dts;
        this.vy = (r.y - this.y) / dts;
        const moved = Math.hypot(r.x - this.x, r.y - this.y) > 0.01;
        this.x = r.x;
        this.y = r.y;
        return moved;
    }

    /**
     * 寻路找射击角度（视线受阻或狭小空间）：A* 朝目标推进，每 500ms 重算，
     * 视线恢复且进入射程后由模式选择切回带内/推进
     */
    _updateReposition(dt, t) {
        const F = this._getSkillConfigs().forms;
        this._repathTimer -= dt;
        if (this._repathTimer <= 0 || !this._path) {
            this._repathTimer = F.repathMs ?? 500;
            const raw = (pathFinder && typeof pathFinder.findPath === 'function')
                ? pathFinder.findPath(this.x, this.y, t.x, t.y, this.groundRadius)
                : null;
            // 过滤异常路点（防护：非法坐标会导致 NaN 位移卡死）
            this._path = Array.isArray(raw) ? raw.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : null;
            this._pathIdx = 0;
        }
        if (this._path && this._pathIdx < this._path.length) {
            const wp = this._path[this._pathIdx];
            if (this._moveToward(wp.x, wp.y, this.maxSpeed, dt)) this._pathIdx++;
        } else {
            // 无路径：直线推进（WallSystem 沿墙滑动）
            this._moveToward(t.x, t.y, this.maxSpeed, dt);
        }
        return true;
    }

    /** 狭小空间评估：目标周围 800~1200 环带采样，存在可走且视线通畅的位置即可保持最小距离 */
    _evalBandPositions(t) {
        const F = this._getSkillConfigs().forms;
        const minR = F.bandMin ?? 800;
        const maxR = F.bandMax ?? 1200;
        if (!WallSystem || typeof WallSystem.canMoveTo !== 'function') return true;
        for (let r = minR; r <= maxR; r += 200) {
            for (let i = 0; i < 8; i++) {
                const a = (Math.PI * 2 / 8) * i;
                const px = t.x + Math.cos(a) * r, py = t.y + Math.sin(a) * r;
                if (!WallSystem.canMoveTo(px, py, this.groundRadius)) continue;
                if (WallSystem.blocked && WallSystem.blocked(px, py, t.x, t.y)) continue;
                return true;
            }
        }
        return false;
    }

    /** 入侵特工：最近的非 agent 阵营单位（玩家与地牢怪物皆为敌） */
    _nearestHostile(entities) {
        let best = null;
        let bestD = Infinity;
        const list = Array.isArray(entities) ? entities : (entities ? Array.from(entities.values()) : []);
        for (const e of list) {
            if (!e || e === this || !e.active || !e.hittable) continue;
            if (e._faction === 'agent') continue;
            const d = Math.hypot(e.x - this.x, e.y - this.y);
            if (d < bestD) { bestD = d; best = e; }
        }
        return best;
    }

    // ========== 弹药系统（怪物基类默认无限弹药；本怪 30 发打空 2s 换弹） ==========

    _hasAmmo(slot) {
        const state = this._ammoState && this._ammoState[slot];
        return !!state && (state.current || 0) > 0;
    }

    _consumeAmmo(slot) {
        const state = this._ammoState && this._ammoState[slot];
        if (state && state.current > 0) state.current--;
        return true;
    }

    _startReload(slot) {
        const state = this._ammoState && this._ammoState[slot];
        // 换弹中不重复触发：基类会无条件重置换弹计时（且每次调用都会播音），
        // 否则 canFire 每帧调用导致换弹永远不完、音效连播
        if (state && state.reloading) return true;
        const started = super._startReload(slot);
        // 换弹音效（配置 sounds.reload，每次换弹只播一次）
        if (started) playSoundFrom(this, 'reload');
        return started;
    }

    // ========== 远程射击（QBZ-191） ==========

    _tryFireGun(t, entities) {
        const skills = this._getSkillConfigs().shoot;
        // 共享开火一体化：枪口偏移/墙体回退/瞄准上方 25%/临时移位出膛/火焰+火光+弹壳
        tryEnemyFireGun(this, t, entities, {
            muzzleUpY: skills.muzzleUpY ?? 75,
            muzzleSideX: skills.muzzleSideX ?? 15,
            muzzleScale: skills.muzzleScale ?? 1.2,
            aimHeightRatio: skills.aimHeightRatio ?? 0.875,
        });
    }

    // ========== 斧头劈砍 ==========

    _dealAxeHit(entities) {
        const A = this._getSkillConfigs().axe;
        const range = A.judgeRange ?? 100;
        const atk = this.data?.atk || 0;
        const shape = new GroundEllipse(this.x, this.y, range, range * PERSPECTIVE_SCALE_Y);
        for (const e of hostilesOf(this, entities)) {
            if (!shape.intersectsEntity(e)) continue;
            e.takeDamage(Math.max(1, Math.round(atk * (A.damageMul ?? 2))), this, 'physical', true);
            if (A.crippleMs && typeof e.applyCripple === 'function') {
                e.applyCripple(A.crippleMs);
            }
            // 命中红色粒子下浮（从目标绿色矩形上方 15% 区域生成，落到目标 footprint 最下方消失）
            const fxScene = typeof window !== 'undefined' ? window.__phaserScene : null;
            if (fxScene && typeof fxScene.playRedFallParticles === 'function') {
                fxScene.playRedFallParticles(e.x, e.y, e);
            }
        }
    }

    // ========== 闪光弹（参考集合体投掷：抛物线 + 地面预警 + 落地椭圆判定） ==========

    _launchFlashbang(t) {
        const FB = this._getSkillConfigs().flashbang;
        // 预判落点（飞行时间内的目标移动）
        const flyS = (FB.flyDuration ?? 600) / 1000;
        let tx = this.x, ty = this.y;
        if (t) {
            const lead = AimHelper.lead(this.x, this.y, t.x, t.y, t.vx || 0, t.vy || 0,
                flyS > 0 ? Math.hypot(t.x - this.x, t.y - this.y) / flyS : 1000, 0);
            tx = lead.x; ty = lead.y;
        }
        this._flashTarget = { x: tx, y: ty };
        // 地面红色椭圆预警（与落地判定同半径，保活至落地）
        this._destroyFlashWarning();
        const warn = new AttackRangeEffect(tx, ty, 0, FB.impactRadius || 100, (FB.impactRadius || 100) * PERSPECTIVE_SCALE_Y, 'ellipse', 100, 0.5, true);
        warn.maxLife = 100;
        EffectManager.add(warn);
        this._flashWarning = warn;

        // 抛物线投掷（贴图 360° 旋转）
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add) {
            this._impactFlashbang(tx, ty);
            return;
        }
        const size = FB.projectileSize || 40;
        const sx = this.x, sy = this.y - (this.footOffsetY || 0);
        const sprite = scene.add.sprite(sx, sy, 'enemy_timeagent_project');
        sprite.setDisplaySize(size, size);
        sprite.setDepth(this.y + 15);
        this._flashSprite = sprite;
        const arcH = FB.arcHeight ?? 100;
        const self = this;
        scene.tweens.add({
            targets: { t: 0 },
            t: 1,
            duration: FB.flyDuration ?? 600,
            ease: 'Linear',
            onUpdate(tw) {
                const p = tw.getValue();
                sprite.x = sx + (tx - sx) * p;
                sprite.y = sy + (ty - sy) * p - arcH * 4 * p * (1 - p);
                sprite.rotation = Math.PI * 2 * p; // 空中 360° 旋转
            },
            onComplete() {
                if (sprite.active) sprite.destroy();
                if (self._flashSprite === sprite) self._flashSprite = null;
                self._impactFlashbang(tx, ty);
            }
        });
    }

    _impactFlashbang(tx, ty) {
        this._destroyFlashWarning();
        playSoundFrom(this, 'flash'); // 投射物消失（落地）音效
        const FB = this._getSkillConfigs().flashbang;
        const radius = FB.impactRadius || 100;
        const matk = this.data?.matk || 0;
        const shape = new GroundEllipse(tx, ty, radius, radius * PERSPECTIVE_SCALE_Y);
        for (const e of hostilesOf(this)) {
            if (!shape.intersectsEntity(e)) continue;
            e.takeDamage(Math.max(1, Math.round(matk * (FB.damageMul ?? 1.5))), this, 'magic', false);
            if (FB.stunMs && typeof e.applyStun === 'function') {
                e.applyStun(FB.stunMs);
                // 联动规则1：登记闪光眩晕，盾卫在其持续期间暂缓盾击
                AgentLinkSystem.notifyFlashStun(e, FB.stunMs);
            }
        }
        // 爆炸特效：椭圆周长一圈扬尘（向上漂浮淡出）+ 中心白色放射线条（50% 透明度快速延伸消失）
        this._fireFlashbangFx(tx, ty, radius);
    }

    /** 闪光弹爆炸特效：椭圆周长扬尘环 + 白色放射线（参考跑步扬尘与手脑冲击线） */
    _fireFlashbangFx(tx, ty, radius) {
        const FB = this._getSkillConfigs().flashbang;
        // 扬尘环：椭圆判定周长上均匀布点（平面透视 2:1），跑步同款 DustEffect 向上漂浮淡出
        const dustCount = FB.impactDustCount ?? 10;
        for (let i = 0; i < dustCount; i++) {
            const a = (Math.PI * 2 * i) / dustCount;
            const px = tx + Math.cos(a) * radius;
            const py = ty + Math.sin(a) * radius * PERSPECTIVE_SCALE_Y;
            EffectFactory.createDustEffect(px, py, 1.2);
        }
        // 白色放射线条：从爆心向 360° 快速延伸并消失，透明度 50%
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene || !scene.add || !scene.tweens) return;
        const g = scene.add.graphics();
        g.setDepth(ty + 50);
        const lineCount = FB.impactLineCount ?? 12;
        const lineAlpha = FB.impactLineAlpha ?? 0.5;
        const duration = FB.impactLineDuration ?? 250;
        const wave = { t: 0 };
        scene.tweens.add({
            targets: wave,
            t: 1,
            duration,
            ease: 'Cubic.easeOut',
            onUpdate() {
                const p = wave.t;
                g.clear();
                g.lineStyle(3, 0xffffff, (1 - p) * lineAlpha);
                const inner = radius * 0.2 * (1 + p);
                const outer = radius * (0.4 + p * 1.2);
                for (let i = 0; i < lineCount; i++) {
                    const a = (Math.PI * 2 * i) / lineCount + Math.PI / lineCount;
                    const cos = Math.cos(a), sin = Math.sin(a) * PERSPECTIVE_SCALE_Y;
                    g.beginPath();
                    g.moveTo(tx + cos * inner, ty + sin * inner);
                    g.lineTo(tx + cos * outer, ty + sin * outer);
                    g.strokePath();
                }
            },
            onComplete() {
                if (g.active) g.destroy();
            }
        });
    }

    _destroyFlashWarning() {
        if (this._flashWarning) {
            this._flashWarning.active = false;
            this._flashWarning = null;
        }
    }

    // ========== 动画 ==========

    /** 有效移动标记：远程模式 MovementSystem 锁定清零 isMoving，用自驱标记；其余形态用 isMoving */
    _effectiveMoving() {
        return (this._formState === 'ranged' || this._linkRetreating) ? !!this._selfMoving : !!this.isMoving;
    }

    /** 当前状态对应的贴图键（必须是已加载的纹理；动画键见 _getAnimKey） */
    _getTextureKey() {
        switch (this._formState) {
            case 'toRanged':
            case 'toIdle':         return 'enemy_timeagent_gun';
            case 'flashThrow':     return 'enemy_timeagent_flash';
            case 'toRangedSwitch': return 'enemy_timeagent_switch';
            case 'axeIntro':
            case 'axeAttack':      return 'enemy_timeagent_axe';
            case 'ranged':
                return this._effectiveMoving() ? 'enemy_timeagent_walk' : 'enemy_timeagent_gun';
            case 'melee':
                return this._effectiveMoving() ? 'enemy_timeagent_walk2' : 'enemy_timeagent_axe';
            default: // idle
                return this._effectiveMoving() ? 'enemy_timeagent_walk' : 'enemy_timeagent_idle';
        }
    }

    /** 当前状态对应的动画键（GameScene 播放；循环段动画无同名贴图，由动画驱动切纹理） */
    _getAnimKey() {
        const F = this._getSkillConfigs().forms;
        switch (this._formState) {
            case 'toRanged':       return 'enemy_timeagent_ranged_in';
            case 'toIdle':         return 'enemy_timeagent_ranged_out';
            case 'toRangedSwitch': return 'enemy_timeagent_switch';
            case 'axeIntro':       return 'enemy_timeagent_axe';
            case 'axeAttack':      return 'enemy_timeagent_axe_attack';
            case 'flashThrow':     return 'enemy_timeagent_flash';
            case 'ranged':
                // 远程形态：移动即播 7~18 循环段（含静止射击后再移动，不再重播 18 帧首段），静止持枪姿态
                if (this._effectiveMoving()) {
                    return 'enemy_timeagent_walk_loop_ranged';
                }
                return 'enemy_timeagent_ranged_pose';
            case 'melee':
                // 近战形态：移动播放 walking-2 首段/循环段，静止持斧姿态（axe 第 30 帧）
                if (this._effectiveMoving()) {
                    return twoStageWalkKey('enemy_timeagent_walk2', 'enemy_timeagent_walk2_loop',
                        this._walkElapsed, F.walk2IntroMs ?? 1267);
                }
                return 'enemy_timeagent_axe_idle';
            default: // idle
                if (this._effectiveMoving()) {
                    return twoStageWalkKey('enemy_timeagent_walk', 'enemy_timeagent_walk_loop',
                        this._walkElapsed, F.walkIntroMs ?? 1200);
                }
                return 'enemy_timeagent_idle';
        }
    }

    _getPhaserOptions() {
        const renderCfg = this.config?.render || {};
        let flipX = false;
        // 朝向优先（瞄准/劈砍方向），无目标时按移动方向
        if (this.target && this.target.active) {
            flipX = this.target.x < this.x;
        } else if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }
        // animState 用形态名（非 'attack'）：动作动画时长与状态时长一致，
        // 重复进入同一动作时 GameScene 依 isLoopAnim 规则自动重播，与骑士 combo 同机制
        return {
            spriteSize: renderCfg.spriteSize || 220,
            collisionWidth: renderCfg.collisionWidth || 60,
            collisionHeight: renderCfg.collisionHeight || 110,
            textOffsetY: -(renderCfg.spriteSize || 220) / 2 - 10,
            flipX,
            animState: this._formState,
            animKey: this._getAnimKey(),
        };
    }
}
