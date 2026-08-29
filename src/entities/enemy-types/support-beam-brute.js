import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import {
    canImpactBasicMelee,
    canStartBasicMelee,
    createBasicMeleeSnapshot,
} from '../../combat/melee-attack-resolver.js';

/**
 * 支护梁巨尸（废弃矿洞专属精英）
 *
 * 完整横梁阶段：移动缓慢，来自正面扇区的物理伤害由横梁吸收一部分；
 * 横梁耐久耗尽后播放一次断裂/丢弃动作，随后永久切换为空手快步与双拳砸击。
 * 两种攻击都使用起手锁定方向、命中帧复查的方向性近战合同。
 */
export class SupportBeamBrute extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.supportBeamBrute,
            showWeapon: false,
            ...config,
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        this._usesDirectedBasicMelee = true;

        this._beamBroken = false;
        this._beamDurability = Math.max(0, Number(this._getGuardConfig().durability) || 0);
        this._breakTimer = 0;

        this._animState = 'armed_idle';
        this._animStateTimer = 0;
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        this._attackHitDone = false;
        this._attackTarget = null;
        this._attackSnapshot = null;
        this._attackPhaseConfig = null;

        this._preserveCorpse = true;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._applyPhaseCombatConfig();
    }

    _getGuardConfig() {
        return this.config?.attackSkills?.beamGuard || {};
    }

    _getBreakConfig() {
        return this.config?.attackSkills?.beamBreak || {};
    }

    _getCurrentAttackConfig() {
        return this._beamBroken
            ? (this.config?.attackSkills?.unarmedSmash || {})
            : (this.config?.attackSkills?.beamThrust || {});
    }

    _getDeathConfig() {
        return this.config?.death || {};
    }

    _applyPhaseCombatConfig() {
        const cfg = this._getCurrentAttackConfig();
        const reach = Number(cfg.approachReach ?? cfg.range) || 120;
        this.attackRange = reach;
        this.attackDistance = reach;
        this.config.basicMelee = {
            ...(this.config.basicMelee || {}),
            approachReach: reach,
            impactReach: Number(cfg.impactReach ?? cfg.range) || reach,
            width: Number(cfg.width) || 30,
            forwardOffset: Number(cfg.forwardOffset) || 0,
            backExtension: Number(cfg.backExtension) || 0,
            requiresSameSurface: true,
            requiresLosAtImpact: true,
        };
        const attack = this.attacks?.melee;
        if (!attack) return;
        attack.config.range = reach;
        attack.config.width = Number(cfg.width) || attack.config.width;
        attack.config.dynamicRange = reach;
        attack.range = reach;
        attack.width = attack.config.width;
        attack.maxCooldown = Number(cfg.cooldown) || attack.maxCooldown;
        attack.baseMaxCooldown = attack.maxCooldown;
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateDeathSequence(dt);
            return;
        }

        super.update(dt, entities);

        if (this._breakTimer > 0) {
            this._breakTimer = Math.max(0, this._breakTimer - dt);
            this._attackAnimTimer = this._breakTimer;
            this._animState = 'beam_break';
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            if (this._breakTimer <= 0) {
                this._attackAnimTimer = 0;
                this._animState = 'unarmed_idle';
                this._animStateTimer = 0;
                this.aiTimer = 0;
            }
            return;
        }

        if (this.hasStatusEffect
            && (this.hasStatusEffect('stun') || this.hasStatusEffect('frozen'))) {
            this._cancelAttack();
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            return;
        }

        if (this._attackTimer > 0) {
            const previous = this._attackTimer;
            this._attackTimer = Math.max(0, this._attackTimer - dt);
            this._attackAnimTimer = this._attackTimer;
            const cfg = this._attackPhaseConfig || this._getCurrentAttackConfig();
            const duration = Math.max(1, Number(cfg.duration) || 5083);
            const frames = Math.max(1, Number(cfg.frames) || 61);
            const hitMs = Math.max(0, Number(cfg.hitFrame) || 0) / frames * duration;
            const elapsedBefore = duration - previous;
            const elapsedAfter = duration - this._attackTimer;
            if (!this._attackHitDone && elapsedBefore < hitMs && elapsedAfter >= hitMs) {
                this._attackHitDone = true;
                this._dealAttackHit();
            }
            if (this._attackTimer <= 0) this._clearAttackLock();
        } else {
            this._attackAnimTimer = 0;
        }

        const speed = Math.hypot(this.vx, this.vy);
        let nextState;
        if (this._attackTimer > 0) {
            nextState = this._beamBroken ? 'unarmed_attack' : 'armed_attack';
        } else if (speed > (this.maxSpeed || this.speed || 110) * 0.05) {
            nextState = this._beamBroken ? 'unarmed_walk' : 'armed_walk';
        } else {
            nextState = this._beamBroken ? 'unarmed_idle' : 'armed_idle';
        }
        this._animStateTimer += dt;
        if (nextState !== this._animState && this._animStateTimer >= 80) {
            this._animState = nextState;
            this._animStateTimer = 0;
        }

        if (this._attackTimer > 0 && this._attackSnapshot) {
            this.rotation = this._attackSnapshot.worldAngle;
        } else if (speed > 0.1) {
            this.rotation = Math.atan2(this.vy, this.vx);
        }
    }

    triggerWeaponAnim() {
        if (this._attackTimer > 0 || this._breakTimer > 0) return false;
        const cfg = this._getCurrentAttackConfig();
        const pending = this._pendingThrust?.active ? this._pendingThrust : null;
        let target = pending?.primaryTarget;
        let snapshot = pending?.basicMeleeSnapshot;
        if (!target || !snapshot) {
            target = this.target;
            if (!canStartBasicMelee(this, target, cfg)) return false;
            snapshot = createBasicMeleeSnapshot(this, target, cfg);
        }
        if (pending) pending.active = false;

        const duration = Math.max(1, Number(cfg.duration) || 5083);
        this._attackTimer = duration;
        this._attackAnimTimer = duration;
        this._attackHitDone = false;
        this._attackTarget = target;
        this._attackSnapshot = snapshot;
        this._attackPhaseConfig = cfg;
        this._animState = this._beamBroken ? 'unarmed_attack' : 'armed_attack';
        this._animStateTimer = 0;
        this.rotation = snapshot.worldAngle;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        return true;
    }

    _dealAttackHit() {
        const target = this._attackTarget;
        const snapshot = this._attackSnapshot;
        const cfg = this._attackPhaseConfig || this._getCurrentAttackConfig();
        if (!canImpactBasicMelee(this, target, snapshot)) return;
        const damage = Math.max(1, Math.round((this.data?.atk || 0) * (Number(cfg.damageMul) || 1)));
        target.takeDamage(damage, this, 'physical', true);
        const parried = target.shieldSystem && target.shieldSystem._lastParried;
        const knockback = Math.max(0, Number(cfg.knockback) || 0);
        if (!parried && knockback > 0 && typeof target.applyKnockback === 'function') {
            target.applyKnockback(snapshot.worldAngle, knockback);
        }
    }

    _cancelAttack() {
        this._attackTimer = 0;
        this._attackAnimTimer = 0;
        if (this._pendingThrust) this._pendingThrust.active = false;
        this._clearAttackLock();
    }

    _clearAttackLock() {
        this._attackTarget = null;
        this._attackSnapshot = null;
        this._attackPhaseConfig = null;
    }

    _isSourceInBeamFront(source) {
        if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.y)) return false;
        const sx = source.collider?.x ?? source.x;
        const sy = source.collider?.y ?? source.y;
        const dx = sx - this.x;
        const dy = sy - this.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 0.001) return true;
        const facingX = Math.cos(this.rotation || 0);
        const facingY = Math.sin(this.rotation || 0);
        const dot = (dx * facingX + dy * facingY) / distance;
        const halfAngle = Math.max(0, Math.min(89, Number(this._getGuardConfig().frontHalfAngleDeg) || 75));
        return dot >= Math.cos(halfAngle * Math.PI / 180);
    }

    takeDamage(damage, source, damageType = 'physical', isMelee = true, hitContext = null) {
        let incoming = Math.max(0, Number(damage) || 0);
        const canGuard = this.active
            && !this._beamBroken
            && this._breakTimer <= 0
            && (damageType === 'physical' || damageType === 'ranged')
            && this._isSourceInBeamFront(source);
        if (canGuard && incoming > 0) {
            const absorbRatio = Math.max(0, Math.min(0.9, Number(this._getGuardConfig().absorbRatio) || 0));
            const absorbed = incoming * absorbRatio;
            incoming -= absorbed;
            this._beamDurability = Math.max(0, this._beamDurability - absorbed);
        }
        const result = super.takeDamage(incoming, source, damageType, isMelee, hitContext);
        if (canGuard && this.active && this._beamDurability <= 0) this._startBeamBreak();
        return result;
    }

    _startBeamBreak() {
        if (this._beamBroken || !this.active) return;
        this._beamBroken = true;
        this._cancelAttack();
        if (this._attackTelegraphTimer > 0) this._attackTelegraphTimer = 0;
        const breakCfg = this._getBreakConfig();
        this._breakTimer = Math.max(1, Number(breakCfg.duration) || 4417);
        this._attackAnimTimer = this._breakTimer;
        this._animState = 'beam_break';
        this._animStateTimer = 0;
        const brokenSpeed = Math.max(1, Number(breakCfg.brokenSpeed) || this.speed || 145);
        this.speed = brokenSpeed;
        this.maxSpeed = brokenSpeed;
        this._baseSpeed = brokenSpeed;
        this._applyPhaseCombatConfig();
        const attack = this.attacks?.melee;
        if (attack) attack.cooldown = Math.max(attack.cooldown, this._breakTimer + 400);
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
    }

    onDeath(source) {
        this.active = false;
        this._beamBroken = true;
        this._breakTimer = 0;
        this._cancelAttack();
        this._animState = 'death';
        const death = this._getDeathConfig();
        this._deathAnimTimer = death.animMs ?? 5083;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._deathRemoveDelay = this._deathAnimTimer
            + (death.holdMs ?? 1000)
            + (death.fadeMs ?? 300)
            + 500;
        if (typeof super.onDeath === 'function') super.onDeath(source);
    }

    _updateDeathSequence(dt) {
        if (this._deathAnimTimer > 0) {
            this._deathAnimTimer = Math.max(0, this._deathAnimTimer - dt);
            if (this._deathAnimTimer <= 0) this._corpseTimer = this._getDeathConfig().holdMs ?? 1000;
        } else if (this._corpseTimer > 0) {
            this._corpseTimer = Math.max(0, this._corpseTimer - dt);
            if (this._corpseTimer <= 0) this._fadeTimer = this._getDeathConfig().fadeMs ?? 300;
        } else if (this._fadeTimer > 0) {
            this._fadeTimer = Math.max(0, this._fadeTimer - dt);
            const fadeMs = this._getDeathConfig().fadeMs ?? 300;
            if (this._phaserSprite?.active) this._phaserSprite.setAlpha(Math.max(0, this._fadeTimer / fadeMs));
            if (this._fadeTimer <= 0 && this._phaserSprite?.active) {
                this._phaserSprite.destroy();
                this._phaserSprite = null;
            }
        }
    }

    _getTextureKey() {
        return `enemy_support_beam_brute_${this._animState}`;
    }

    _getPhaserOptions() {
        const attacking = this._animState === 'armed_attack' || this._animState === 'unarmed_attack';
        let flipX = false;
        if (attacking && this._attackSnapshot) {
            flipX = Math.cos(this._attackSnapshot.worldAngle) < 0;
        } else if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else {
            flipX = Math.cos(this.rotation || 0) < 0;
        }
        const renderCfg = this.config?.render || {};
        const oneShot = attacking || this._animState === 'beam_break';
        const phaserState = this._animState === 'death'
            ? 'death'
            : (oneShot ? 'attack' : (this._animState.includes('walk') ? 'walk' : 'idle'));
        return {
            spriteSize: renderCfg.spriteSize || 326,
            collisionWidth: renderCfg.collisionWidth || 88,
            collisionHeight: renderCfg.collisionHeight || 198,
            textOffsetY: -(renderCfg.spriteSize || 326) / 2 - 10,
            flipX,
            animState: phaserState,
            animKey: `enemy_support_beam_brute_${this._animState}`,
        };
    }
}
