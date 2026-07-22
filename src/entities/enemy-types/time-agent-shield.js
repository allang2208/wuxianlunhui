import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import equipmentJson from '../../../data/equipment.json';
import { WEAPON_ATTACK_CONFIG, createAttackFromConfig } from '../../config/weapon-attack-config.js';
import { EffectFactory } from '../../utils/effect-factory.js';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { WallSystem } from '../../world/wall-system.js';
import { AgentLinkSystem } from '../../world/agent-link-system.js';

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

        const skills = this._getSkillConfigs();

        // 形态状态机
        this._formState = 'idle';
        this._stateTimer = 0;
        this._walkElapsed = 0;
        // 技能冷却
        this._bashCd = 0;
        this._bashHitDone = false;
        this._defendCd = 0;

        // 装备沙漠之鹰（套用武器数据；命中不击退）
        this._isHumanoid = true;
        const deagle = JSON.parse(JSON.stringify(equipmentJson.equipment.desert_eagle));
        // attackKey 指到 deagle 攻击配置（装备 weaponType 为 pistol，默认会找 attacks.pistol）
        deagle.attackKey = 'deagle';
        this.equipments.weapon = deagle;
        this.attacks.deagle = createAttackFromConfig(WEAPON_ATTACK_CONFIG.deagle);
        // 伤害取怪物面板物攻（fireProjectile 默认读 config.damage 占位值）
        this.attacks.deagle.config.damage = { min: this.data.atk, max: this.data.atk };
        // 命中不击退（盾位设定）
        this.attacks.deagle.config.knockback = skills.shoot.knockback ?? 0;
        // AI 散布（fireProjectile 读取，避免 undefined → NaN 弹道）
        this._currentSpreadFactor = skills.shoot.spreadFactor ?? 0.1;
        this._currentSpreadMaxAngle = skills.shoot.spreadMaxAngle ?? 8;
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
                if (this._isTargetMeleeStyle(t)) {
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

    /** 目标风格判定（近战/远程，与突击同口径） */
    _isTargetMeleeStyle(t) {
        if (!t) return false;
        if (t._faction === 'player') {
            const eq = t.equipments && t.equipments[t.weaponMode];
            if (eq) return eq.category === 'weapon_melee' || eq.weaponType === 'sword';
            return true;
        }
        if (t.weaponMode) return t.weaponMode === 'melee';
        return !!(t.attacks && t.attacks.melee);
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
            const fireT = ((B.hitFrame || 1) - 1) / (B.frames || 1) * (B.duration || 0);
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
    }

    _startDefend() {
        const D = this._getSkillConfigs().defend;
        this._formState = 'defendIn';
        this._stateTimer = D.windupMs ?? 750;
        this._defendCd = D.cooldown ?? 6000;
        // 面对目标释放
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
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
        super.takeDamage(damage, source, damageType, isMelee);
    }

    _triggerDefendParry(attacker, isMelee) {
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
        const shape = new GroundEllipse(this.x, this.y, range, range * PERSPECTIVE_SCALE_Y);
        for (const e of this._hostiles(entities)) {
            if (!shape.intersectsEntity(e)) continue;
            e.takeDamage(Math.max(1, Math.round(atk * (B.damageMul ?? 1.5))), this, 'physical', true);
            if (B.stunMs && typeof e.applyStun === 'function') {
                e.applyStun(B.stunMs);
            }
        }
    }

    _hostiles(entities) {
        const list = Array.isArray(entities)
            ? entities
            : (entities ? Array.from(entities.values()) : []);
        const src = list.length > 0
            ? list
            : (typeof window !== 'undefined' && window.Game && window.Game.entities
                ? Array.from(window.Game.entities.values()) : []);
        const out = [];
        for (const e of src) {
            if (!e || e === this || !e.active || !e.hittable) continue;
            if (e._faction === this._faction) continue;
            out.push(e);
        }
        return out;
    }

    // ========== 远程射击（沙漠之鹰） ==========

    /** 朝向判定（与 _getPhaserOptions 的 flipX 同规则） */
    _isFacingLeft() {
        if (this.target && this.target.active) return this.target.x < this.x;
        if (this.isMoving && Math.abs(this.vx) > 0.1) return this.vx < 0;
        return Math.cos(this.rotation ?? 0) < 0;
    }

    _tryFireGun(t, entities) {
        const skills = this._getSkillConfigs().shoot;
        // 枪口点：上移 muzzleUpY，左右按朝向偏移 muzzleSideX（与突击同款）
        const up = skills.muzzleUpY ?? 75;
        const side = skills.muzzleSideX ?? 15;
        const ox = this.x, oy = this.y;
        let mx = ox + (this._isFacingLeft() ? -side : side);
        let my = oy - up;
        // 枪口点落进墙内时回退到可达点（防止子弹出生即撞墙消失）
        if (WallSystem && typeof WallSystem.resolve === 'function') {
            const resolved = WallSystem.resolve(ox, oy, mx, my, 4);
            mx = resolved.x;
            my = resolved.y;
        }
        // 瞄准点：目标绿色矩形判定上方 25% 区域中心
        const targetH = t.collisionHeight || t.config?.render?.collisionHeight || 60;
        const footY = t.collider ? t.collider.y : t.y;
        const aimX = t.x;
        const aimY = footY - targetH * (skills.aimHeightRatio ?? 0.875);
        // 子弹从枪口射出：fireProjectile 固定从 this.x/y 生成，临时移位后还原
        this.x = mx; this.y = my;
        // fireProjectile 内置：冷却检查、AI 散布、AimHelper 预判、曳光弹、开火音效
        const fired = this.fireProjectile(aimX, aimY, entities, { slot: 'weapon' });
        this.x = ox; this.y = oy;
        if (!fired) return;
        // 枪口火焰 + 开火火光 + 弹壳（与突击同款）
        const angle = Math.atan2(aimY - my, aimX - mx);
        EffectFactory.createMuzzleFlash(mx, my, angle, skills.muzzleScale ?? 1.2);
        const fireScene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (fireScene && typeof fireScene.playMuzzleFire === 'function') {
            fireScene.playMuzzleFire(mx, my);
        }
        EffectFactory.createShellCasing(mx, my, angle, oy);
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
                    return this._walkElapsed >= (F.walkIntroMs ?? 1067)
                        ? 'enemy_timeshield_walk_loop' : 'enemy_timeshield_walk';
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
