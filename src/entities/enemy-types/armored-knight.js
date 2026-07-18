import { Enemy } from '../enemy.js';
import { EffectManager } from '../../effects/effect-manager.js';
import { FloatingTextEffect } from '../../effects/floating-text.js';
import { WallSystem } from '../../world/wall-system.js';
import { SoundManager } from '../../ui/sound-manager.js';
import enemyConfigData from '../../../data/enemy-config.json';

/**
 * 铠甲骑士（精英）
 * 技能（数值全部由 enemy-config.json 的 attackSkills 驱动）：
 * - 二连击挥砍（combo）：32 帧动画，hitFrames 帧各判定一次，物理攻击 ×damageMul
 * - 持盾冲锋（charge）：瞬间发动，speed 追踪目标，命中伤害×damageMul + 击退 + 眩晕；
 *   目标弹反成功则不受伤不眩晕只击退；冲锋期间自身弹反免疫（与集合体同机制）
 * - 举盾格挡（block）：玩家攻击动作临近时面对目标举盾，期间所有来袭判定为弹反
 *   （复制玩家盾系统语义：免伤，近战攻击者被眩晕击退）
 */
export class ArmoredKnight extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.armoredKnight,
            ...config
        });
        this._useStickFigure = false;
        this._animState = 'idle'; // idle | walk | combo | charge | defend

        // 自定义技能逻辑，关闭通用 CombatSystem 近战攻击
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        // 二连击状态
        this._comboTimer = 0;
        this._comboCooldown = 0;
        this._comboHitsDone = new Set();
        this._comboTarget = null;

        // 冲锋状态
        this._chargeTarget = null;
        this._chargeTraveled = 0;
        this._chargeDamaged = false;
        this._chargeCooldown = 0;
        // 冲锋期间的弹反免疫需要事后还原（配置本身不带 parryImmune）
        this._baseParryImmune = !!this._parryImmune;

        // 格挡状态
        this._blockTimer = 0;
        this._blockCooldown = 0;

        // 弹反管线代理：格挡期间命中按弹反处理（供 DamagePipeline 抑制击退/craft 命中效果）
        this.shieldSystem = { _lastParried: false };
    }

    _getSkillConfigs() {
        const s = this.config?.attackSkills || {};
        return {
            combo: s.combo || {},
            charge: s.charge || {},
            block: s.block || {},
        };
    }

    update(dt, entities) {
        if (this._comboCooldown > 0) this._comboCooldown -= dt;
        if (this._chargeCooldown > 0) this._chargeCooldown -= dt;
        if (this._blockCooldown > 0) this._blockCooldown -= dt;
        this.updateStatusEffects(dt);

        // 眩晕时强制中断所有动作
        if (this.hasStatusEffect && this.hasStatusEffect('stun')) {
            this._endCombo();
            this._endCharge();
            this._endBlock();
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            this._animState = 'idle';
            return;
        }

        // 动作状态推进（进行中的动作优先）
        if (this._animState === 'combo') { this._updateCombo(dt); return; }
        if (this._animState === 'charge') { this._updateCharge(dt); return; }
        if (this._animState === 'defend') { this._updateBlock(dt); return; }

        // 普通 AI 移动
        super.update(dt, entities);

        // 技能决策：格挡（反应） > 冲锋 > 连击
        if (this.target && this.target.active) {
            this._decideSkills();
        }
        if (this._animState !== 'combo' && this._animState !== 'charge' && this._animState !== 'defend') {
            this._animState = this.isMoving ? 'walk' : 'idle';
        }
    }

    _decideSkills() {
        const t = this.target;
        const cfg = this._getSkillConfigs();

        // 格挡：目标正在攻击动作且临近时，面对目标举盾
        if (this._blockCooldown <= 0 && cfg.block.duration) {
            const targetAttacking = t.weaponAnim && t.weaponAnim.state && t.weaponAnim.state !== 'idle';
            if (targetAttacking && this._isTargetInRange(t, cfg.block.triggerRange ?? 260)) {
                this._startBlock();
                return;
            }
        }

        // 冲锋：CD 就绪且目标在触发范围内，瞬间发动（无蓄力）
        if (this._chargeCooldown <= 0 && cfg.charge.speed) {
            if (this._isTargetInRange(t, cfg.charge.triggerRange ?? 550)) {
                this._startCharge();
                return;
            }
        }

        // 连击：近身发动
        if (this._comboCooldown <= 0 && cfg.combo.duration) {
            if (this._isTargetInRange(t, cfg.combo.range ?? 125)) {
                this._startCombo();
            }
        }
    }

    // ========== 二连击挥砍 ==========

    _startCombo() {
        const cfg = this._getSkillConfigs().combo;
        this._animState = 'combo';
        this._comboTimer = cfg.duration ?? 2000;
        this._comboCooldown = cfg.cooldown ?? 4000;
        this._comboHitsDone = new Set();
        this._comboTarget = this.target;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
    }

    _updateCombo(dt) {
        const cfg = this._getSkillConfigs().combo;
        this._comboTimer -= dt;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        if (this._comboTarget && this._comboTarget.active) {
            this.rotation = Math.atan2(this._comboTarget.y - this.y, this._comboTarget.x - this.x);
        }
        const elapsed = (cfg.duration || 0) - this._comboTimer;
        const frames = cfg.frames || 1;
        const hitFrames = cfg.hitFrames || [];
        for (let i = 0; i < hitFrames.length; i++) {
            if (this._comboHitsDone.has(i)) continue;
            const t = ((hitFrames[i] - 1) / frames) * (cfg.duration || 0);
            if (elapsed >= t) {
                this._comboHitsDone.add(i);
                this._dealComboHit();
            }
        }
        if (this._comboTimer <= 0) this._endCombo();
    }

    _dealComboHit() {
        const cfg = this._getSkillConfigs().combo;
        const t = this._comboTarget;
        if (!t || !t.active || !t.hittable) return;
        if (!this._isTargetInRange(t, cfg.range ?? 125)) return;
        const atk = this.data?.atk || 0;
        t.takeDamage(Math.max(1, Math.round(atk * (cfg.damageMul ?? 1))), this, 'physical', true);
    }

    _endCombo() {
        if (this._animState === 'combo') this._animState = 'idle';
        this._comboTimer = 0;
        this._comboTarget = null;
        this._comboHitsDone = new Set();
    }

    // ========== 持盾冲锋 ==========

    _startCharge() {
        const cfg = this._getSkillConfigs().charge;
        this._animState = 'charge';
        this._chargeTarget = this.target;
        this._chargeTraveled = 0;
        this._chargeDamaged = false;
        this._chargeCooldown = cfg.cooldown ?? 10000;
        // 冲锋期间弹反免疫（与集合体同机制），结束后还原
        this._parryImmune = true;
        this.vx = 0;
        this.vy = 0;
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
        EffectManager.add(new FloatingTextEffect(this.x, this.y - 30, '🛡️ 冲锋！', '#7a8a9a'));
    }

    _updateCharge(dt) {
        const cfg = this._getSkillConfigs().charge;
        const dtSec = dt / 1000;
        const speed = cfg.speed ?? 900;
        const maxDist = cfg.maxDistance ?? 1800;
        const t = this._chargeTarget && this._chargeTarget.active ? this._chargeTarget : this.target;

        // 直接追踪目标单位
        if (t && t.active) {
            const dx = t.x - this.x;
            const dy = t.y - this.y;
            const d = Math.hypot(dx, dy);
            if (d > 0) {
                this.rotation = Math.atan2(dy, dx);
                const step = Math.min(speed * dtSec, d);
                const nx = this.x + (dx / d) * step;
                const ny = this.y + (dy / d) * step;
                const r = WallSystem.resolve(this.x, this.y, nx, ny, this.groundRadius);
                this._chargeTraveled += Math.hypot(r.x - this.x, r.y - this.y);
                this.x = r.x;
                this.y = r.y;
            }
        }

        // 命中判定：撞到目标立即结算并停止
        if (!this._chargeDamaged && t && t.active && t.hittable && this._isTargetInRange(t, cfg.hitRange ?? 60)) {
            this._chargeDamaged = true;
            this._dealChargeHit(t);
        }

        if (this._chargeDamaged || this._chargeTraveled >= maxDist || !t || !t.active) {
            this._endCharge();
        }
    }

    _dealChargeHit(t) {
        const cfg = this._getSkillConfigs().charge;
        const atk = this.data?.atk || 0;
        t.takeDamage(Math.max(1, Math.round(atk * (cfg.damageMul ?? 2))), this, 'physical', true);
        // 目标弹反成功：不受伤（takeDamage 已免伤）不眩晕，只保留击退；
        // 骑士冲锋期间 _parryImmune，不受弹反的眩晕/击退/打断影响
        const parried = t.shieldSystem && t.shieldSystem._lastParried;
        const angle = Math.atan2(t.y - this.y, t.x - this.x);
        if (t.applyKnockback) t.applyKnockback(angle, cfg.knockback ?? 200);
        if (!parried && t.applyStun) t.applyStun(cfg.stunMs ?? 2500);
    }

    _endCharge() {
        if (this._animState === 'charge') this._animState = 'idle';
        this._chargeTarget = null;
        this._chargeTraveled = 0;
        this._chargeDamaged = false;
        this._parryImmune = this._baseParryImmune;
        this.vx = 0;
        this.vy = 0;
    }

    // ========== 举盾格挡 ==========

    _startBlock() {
        const cfg = this._getSkillConfigs().block;
        this._animState = 'defend';
        this._blockTimer = cfg.duration ?? 2000;
        this._blockCooldown = cfg.cooldown ?? 6000;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        // 面对目标释放
        if (this.target && this.target.active) {
            this.rotation = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        }
    }

    _updateBlock(dt) {
        this._blockTimer -= dt;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        if (this._blockTimer <= 0) this._endBlock();
    }

    _endBlock() {
        if (this._animState === 'defend') this._animState = 'idle';
        this._blockTimer = 0;
    }

    // ========== 格挡弹反（复制玩家盾系统语义） ==========

    takeDamage(damage, source, damageType = 'physical', isMelee = true) {
        // 格挡期间：所有玩家来源伤害判定为弹反——免伤，近战攻击者被眩晕击退
        if (this._animState === 'defend' && source && source._faction === 'player') {
            this.shieldSystem._lastParried = true;
            this._triggerBlockParry(source, isMelee);
            return;
        }
        if (this.shieldSystem) this.shieldSystem._lastParried = false;
        super.takeDamage(damage, source, damageType, isMelee);
    }

    _triggerBlockParry(attacker, isMelee) {
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile('assets/sounds/wood_thud_1s.wav');
        }
        // 与玩家盾系统 triggerParry 同口径：远程/魔法只抵消伤害；近战才眩晕+击退；弹反免疫单位不受影响
        if (!isMelee) return;
        if (!attacker || attacker._parryImmune) return;
        const cfg = this._getSkillConfigs().block;
        if (attacker.applyStun) attacker.applyStun(cfg.parryStunMs ?? 2000);
        const angle = Math.atan2(attacker.y - this.y, attacker.x - this.x);
        if (attacker.applyKnockback) attacker.applyKnockback(angle, cfg.parryKnockback ?? 100);
    }

    // ========== 工具 ==========

    /**
     * 判定目标是否在指定范围内（统一使用 Collider 地面 footprint 半径）。
     */
    _isTargetInRange(target, range) {
        if (!target) return false;
        const r = Math.max(0, range);
        const targetR = target.groundRadius || target.collisionRadius || target.size * 0.6 || 0;
        const dist = Math.hypot(target.x - this.x, target.y - this.y);
        return dist <= r + targetR;
    }

    // ========== 渲染 ==========

    _getTextureKey() {
        switch (this._animState) {
            case 'walk': return 'enemy_armored_knight_walk';
            case 'combo': return 'enemy_armored_knight_combo';
            case 'charge': return 'enemy_armored_knight_charge';
            case 'defend': return 'enemy_armored_knight_defend';
            default: return 'enemy_armored_knight_idle';
        }
    }

    _getPhaserOptions() {
        const renderCfg = this.config?.render || {};
        let flipX = false;
        if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else if (this.rotation !== undefined) {
            flipX = Math.cos(this.rotation) < 0;
        }
        return {
            spriteSize: renderCfg.spriteSize || 150,
            flipX,
            animState: this._animState,
            animKey: this._getTextureKey(),
        };
    }
}
