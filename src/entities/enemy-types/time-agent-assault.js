import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import equipmentJson from '../../../data/equipment.json';
import { WEAPON_ATTACK_CONFIG, createAttackFromConfig } from '../../config/weapon-attack-config.js';
import { EffectFactory } from '../../utils/effect-factory.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { AttackRangeEffect } from '../../effects/attack-range-effect.js';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { AimHelper } from '../../utils/aim-helper.js';

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

        // 装备 QBZ-191（套用武器数据：射速/射程/弹速/弹匣30+1s换弹，弹匣无限）
        this._isHumanoid = true;
        const qbz = JSON.parse(JSON.stringify(equipmentJson.equipment.qbz191));
        this.equipments.weapon = qbz;
        this.attacks.qbz191 = createAttackFromConfig(WEAPON_ATTACK_CONFIG.qbz191);
        // 伤害取怪物面板物攻（fireProjectile 默认读 config.damage 占位值 1-1）
        this.attacks.qbz191.config.damage = { min: this.data.atk, max: this.data.atk };
        // 命中击退 25px（damage-pipeline 统一应用）
        this.attacks.qbz191.config.knockback = skills.shoot.knockback ?? 25;
        // AI 散布（fireProjectile 读取，避免 undefined → NaN 弹道）
        this._currentSpreadFactor = skills.shoot.spreadFactor ?? 0.15;
        this._currentSpreadMaxAngle = skills.shoot.spreadMaxAngle ?? 10;
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

        const t = this.target && this.target.active ? this.target : null;
        const dist = t ? Math.hypot(t.x - this.x, t.y - this.y) : Infinity;

        // 朝向目标（ MovementSystem 驱动移动时方向一致；动作期锁定）
        if (t) this.rotation = Math.atan2(t.y - this.y, t.x - this.x);

        // 连续移动计时（walk/walk2 首段→循环段）
        if (this.isMoving) this._walkElapsed += dt;
        else this._walkElapsed = 0;

        // 状态机：动作态（锁移动）与形态态（可移动）分流
        const ACTION_STATES = ['toRanged', 'toIdle', 'toRangedSwitch', 'axeIntro', 'axeAttack', 'flashThrow'];
        if (ACTION_STATES.includes(this._formState)) {
            this._stateTimer -= dt;
            this._updateActionStates(dt, entities, t, dist);
            this._attackAnimTimer = 100; // MovementSystem 锁定
        } else {
            this._attackAnimTimer = 0;
            this._updateForms(dt, entities, t, dist);
        }

        // 近战形态移速提升（其余形态用配置速度）
        const skills = this._getSkillConfigs();
        const inMelee = this._formState === 'melee' || this._formState === 'axeAttack';
        this.maxSpeed = inMelee ? (skills.forms.meleeMoveSpeed ?? 260) : (this.config.speed ?? 160);
    }

    // ========== 形态决策（可移动状态） ==========

    _updateForms(dt, entities, t, dist) {
        const skills = this._getSkillConfigs();
        const F = skills.forms;

        if (this._formState === 'idle') {
            // 斧砍条件优先：近战风格目标贴身 → 直接首次劈砍进入近战形态
            if (t && this._formSwitchCd <= 0 && this._isTargetMeleeStyle(t) && dist <= (F.meleeCheckRange ?? 150)) {
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
            if (t && this._formSwitchCd <= 0 && this._isTargetMeleeStyle(t) && dist <= (F.meleeCheckRange ?? 150)) {
                this._startTransition('toIdle', F.switchOutMs ?? 500);
                return;
            }
            // 闪光弹：远程形态专用，CD 就绪且目标在投掷距离内
            if (t && this._flashCd <= 0 && dist <= (skills.flashbang.throwRange ?? 500)) {
                this._tryAttackTelegraph(() => this._startFlashThrow());
                return;
            }
            // 开火：目标在射程内（弹匣打空自动换弹，换弹期间 fireProjectile 自动拒射）
            if (t && dist <= (skills.shoot.fireRange ?? 1200)) {
                this._tryFireGun(t, entities);
            }
            return;
        }

        if (this._formState === 'melee') {
            // 近战→远程：远程风格目标拉开 150px 以上，或任意目标拉开 300px 持续 3s
            if (this._formSwitchCd <= 0) {
                const rangedOut = t && !this._isTargetMeleeStyle(t) && dist > (F.meleeCheckRange ?? 150);
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
            if (!this._axeHitDone && elapsed >= (hitFrame - startFrame) / fps * 1000) {
                this._axeHitDone = true;
                this._dealAxeHit(entities);
            }
        }

        // 闪光弹出手帧
        if (this._formState === 'flashThrow') {
            const FB = skills.flashbang;
            const fireT = ((FB.fireFrame || 1) - 1) / (FB.frames || 1) * (FB.duration || 0);
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
    }

    _startTransition(state, ms) {
        this._formState = state;
        this._stateTimer = ms;
    }

    _startAxeIntro() {
        const A = this._getSkillConfigs().axe;
        this._formState = 'axeIntro';
        this._stateTimer = A.introDuration ?? 2000;
        this._axeHitDone = false;
    }

    _startAxeAttack() {
        this._formState = 'axeAttack';
        this._stateTimer = this._axeAttackDuration();
        this._axeHitDone = false;
    }

    _startFlashThrow() {
        const FB = this._getSkillConfigs().flashbang;
        this._formState = 'flashThrow';
        this._stateTimer = FB.duration ?? 2000;
        this._flashFired = false;
        this._flashCd = FB.cooldown ?? 10000;
    }

    // ========== 目标风格判定（近战/远程） ==========

    _isTargetMeleeStyle(t) {
        if (!t) return false;
        // 玩家：按当前装备判定
        if (t._faction === 'player') {
            const eq = t.equipments && t.equipments[t.weaponMode];
            if (eq) return eq.category === 'weapon_melee' || eq.weaponType === 'sword';
            return true; // 徒手按近战计
        }
        // 怪物：按武器模式/攻击配置判定
        if (t.weaponMode) return t.weaponMode === 'melee';
        return !!(t.attacks && t.attacks.melee);
    }

    // ========== 远程射击（QBZ-191） ==========

    _tryFireGun(t, entities) {
        // fireProjectile 内置：冷却/弹药/换弹检查、AI 散布、AimHelper 预判、曳光弹、开火音效
        const fired = this.fireProjectile(t.x, t.y, entities, { slot: 'weapon' });
        if (!fired) return;
        // 枪口火焰 + 弹壳（玩家同款工厂；敌人无 weaponSprite，按朝向偏移取枪口点，取胸口高度）
        const skills = this._getSkillConfigs().shoot;
        const angle = this.rotation;
        const off = skills.muzzleOffset ?? 30;
        const baseY = this.y - (this.footOffsetY || 0);
        const mx = this.x + Math.cos(angle) * off;
        const my = baseY + Math.sin(angle) * off;
        EffectFactory.createMuzzleFlash(mx, my, angle, skills.muzzleScale ?? 1.2);
        EffectFactory.createShellCasing(this.x, this.y, angle, this.y);
    }

    // ========== 斧头劈砍 ==========

    _dealAxeHit(entities) {
        const A = this._getSkillConfigs().axe;
        const range = A.judgeRange ?? 100;
        const atk = this.data?.atk || 0;
        const shape = new GroundEllipse(this.x, this.y, range, range * PERSPECTIVE_SCALE_Y);
        for (const e of this._hostiles(entities)) {
            if (!shape.intersectsEntity(e)) continue;
            e.takeDamage(Math.max(1, Math.round(atk * (A.damageMul ?? 2))), this, 'physical', true);
            if (A.crippleMs && typeof e.applyCripple === 'function') {
                e.applyCripple(A.crippleMs);
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
        const FB = this._getSkillConfigs().flashbang;
        const radius = FB.impactRadius || 100;
        const matk = this.data?.matk || 0;
        const shape = new GroundEllipse(tx, ty, radius, radius * PERSPECTIVE_SCALE_Y);
        for (const e of this._hostiles()) {
            if (!shape.intersectsEntity(e)) continue;
            e.takeDamage(Math.max(1, Math.round(matk * (FB.damageMul ?? 1.5))), this, 'magic', false);
            if (FB.stunMs && typeof e.applyStun === 'function') {
                e.applyStun(FB.stunMs);
            }
        }
    }

    _destroyFlashWarning() {
        if (this._flashWarning) {
            this._flashWarning.active = false;
            this._flashWarning = null;
        }
    }

    // ========== 动画 ==========

    _getTextureKey() {
        const F = this._getSkillConfigs().forms;
        switch (this._formState) {
            case 'toRanged':       return 'enemy_timeagent_ranged_in';
            case 'toIdle':         return 'enemy_timeagent_ranged_out';
            case 'toRangedSwitch': return 'enemy_timeagent_switch';
            case 'axeIntro':       return 'enemy_timeagent_axe';
            case 'axeAttack':      return 'enemy_timeagent_axe_attack';
            case 'flashThrow':     return 'enemy_timeagent_flash';
            case 'ranged':
                // 远程形态：移动播放 walking 首段/循环段（移动射击），静止持枪姿态
                if (this.isMoving) {
                    return this._walkElapsed >= (F.walkIntroMs ?? 1200)
                        ? 'enemy_timeagent_walk_loop' : 'enemy_timeagent_walk';
                }
                return 'enemy_timeagent_ranged_pose';
            case 'melee':
                // 近战形态：移动播放 walking-2 首段/循环段，静止持斧姿态（axe 第 30 帧）
                if (this.isMoving) {
                    return this._walkElapsed >= (F.walk2IntroMs ?? 1267)
                        ? 'enemy_timeagent_walk2_loop' : 'enemy_timeagent_walk2';
                }
                return 'enemy_timeagent_axe_idle';
            default: // idle
                if (this.isMoving) {
                    return this._walkElapsed >= (F.walkIntroMs ?? 1200)
                        ? 'enemy_timeagent_walk_loop' : 'enemy_timeagent_walk';
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
        return {
            spriteSize: renderCfg.spriteSize || 220,
            collisionWidth: renderCfg.collisionWidth || 60,
            collisionHeight: renderCfg.collisionHeight || 110,
            textOffsetY: -(renderCfg.spriteSize || 220) / 2 - 10,
            flipX,
            animState: this._formState,
            animKey: this._getTextureKey(),
        };
    }
}
