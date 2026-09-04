import { HorrorNormalEnemy } from './_shared/horror-normal-enemy.js';
import { hostilesOf } from './_shared/enemy-utils.js';
import { canStartGroundSkill } from './_shared/attack-shapes.js';
import { DamagePipeline } from '../../combat/damage-pipeline.js';
import { canMeleeShareSurface } from '../../combat/melee-surface.js';
import { hasAttackLineOfSight } from '../../combat/melee-reach.js';
import { fireGroundShockwave } from '../../effects/combat-fx.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../../physics/elevation.js';

/**
 * 空腔之卵：恐怖地牢专属抽象领主。
 * - 真空汲引：长前摇内分段牵引，空腔完全张开时结算一次魔法伤害。
 * - 壳脉冲：近身反压，脉冲峰值结算范围魔法伤害、击退和短眩晕。
 * 两个动作共用透明图集的唯一时钟；控制会取消未发生的事件，不补发命中。
 */
export class HollowOvum extends HorrorNormalEnemy {
    constructor(x, y, overrides = {}) {
        super(x, y, 'hollowOvum', 'hollow_ovum', overrides);
        const skills = this.config.attackSkills || {};
        this._skillCooldowns = {
            vacuum: Math.max(0, Number(skills.vacuum?.initialCooldownMs) || 0),
            pulse: Math.max(0, Number(skills.pulse?.initialCooldownMs) || 0),
        };
        this._shockwaveGraphics = [];
    }

    _skill(kind = this._action?.kind || 'pulse') {
        return this.config.attackSkills[kind];
    }

    // 禁止共享基类启动单一 primary 动作；本类只从双技能决策入口起手。
    _canStartAction() { return false; }
    _createActionContext() { return null; }
    _resolveAction() {}

    update(dt, entities) {
        const attackDt = this.getAttackIntervalDelta(dt);
        for (const kind of Object.keys(this._skillCooldowns)) {
            this._skillCooldowns[kind] = Math.max(0, this._skillCooldowns[kind] - attackDt);
        }

        const hadAction = !!this._action;
        super.update(dt, entities);
        if (hadAction || !this.active || this._isDead || this._action || this._cannotAttack()
            || this._attackTelegraphTimer > 0 || !this._validTarget(this.target)) return;

        const target = this.target;
        if (this._skillCooldowns.pulse <= 0 && this._canStartSkill('pulse', target)) {
            this._tryAttackTelegraph(() => this._startSkill('pulse', target));
            return;
        }
        if (this._skillCooldowns.vacuum <= 0 && this._canStartSkill('vacuum', target)) {
            this._tryAttackTelegraph(() => this._startSkill('vacuum', target));
        }
    }

    _canStartSkill(kind, target) {
        const cfg = this._skill(kind);
        const radius = Math.max(1, Number(cfg?.triggerRange ?? cfg?.radius) || 1);
        return !!cfg && canStartGroundSkill(this, target, {
            kind: 'ellipse',
            radiusX: radius,
            radiusY: radius * PERSPECTIVE_SCALE_Y,
        });
    }

    _startSkill(kind, target) {
        if (this._action || this._cannotAttack() || !this._validTarget(target)
            || !this._canStartSkill(kind, target)) return false;
        const cfg = this._skill(kind);
        const layout = this._layout(kind);
        const sourceX = this.collider?.x ?? this.x;
        const sourceY = this.collider?.y ?? this.y;
        const targetX = target.collider?.x ?? target.x;
        const targetY = target.collider?.y ?? target.y;
        this._action = {
            kind,
            primaryTarget: target,
            elapsedMs: 0,
            consumedEvents: new Set(),
            worldAngle: Math.atan2(targetY - sourceY, targetX - sourceX),
        };
        this.rotation = this._action.worldAngle;
        this._skillCooldowns[kind] = Math.max(0, Number(cfg.cooldown) || 0);
        this._attackTimer = layout.duration;
        this._attackAnimTimer = layout.duration;
        this._frozenForCast = true;
        this._actionState = 'windup';
        this._setAnimation(kind);
        this._stopMovement();
        if (this._pendingThrust) this._pendingThrust.active = false;
        return true;
    }

    _advanceAction(dt, entities) {
        const action = this._action;
        if (!action) return;
        const kind = action.kind;
        const cfg = this._skill(kind);
        const duration = this._layout(kind).duration;
        const previous = action.elapsedMs;
        action.elapsedMs = Math.min(duration, previous + Math.max(0, dt));
        this._animElapsed = action.elapsedMs;
        this._animFrame = this._frameAt(kind, action.elapsedMs);
        this._attackTimer = Math.max(0, duration - action.elapsedMs);
        this._attackAnimTimer = this._attackTimer;
        this._actionState = action.elapsedMs < this._eventMs(kind, cfg.eventFrame)
            ? 'windup' : 'recover';
        this.rotation = action.worldAngle;
        this._stopMovement();

        if (kind === 'vacuum') {
            for (const frame of cfg.pullFrames || []) {
                this._consumeTimedEvent(action, previous, frame, `pull:${frame}`,
                    () => this._resolveVacuumPull(cfg, entities));
            }
        }
        this._consumeTimedEvent(action, previous, cfg.eventFrame, 'impact',
            () => this._resolveSkillImpact(kind, cfg, entities));

        if (this._action !== action || this._cannotAttack()) {
            if (!this._deathStarted) this._cancelAction();
            return;
        }
        if (action.elapsedMs >= duration) this._cancelAction();
    }

    _eventMs(kind, frame) {
        return this._frameStarts[kind]?.[Math.max(0, Number(frame) || 0)] ?? 0;
    }

    _consumeTimedEvent(action, previous, frame, eventKey, callback) {
        if (action.consumedEvents.has(eventKey)) return;
        const eventMs = this._eventMs(action.kind, frame);
        if (previous <= eventMs && action.elapsedMs >= eventMs) {
            // 先消费，避免伤害/弹反回调同步打断后重复触发。
            action.consumedEvents.add(eventKey);
            callback();
        }
    }

    _resolveVacuumPull(cfg, entities) {
        const pullDistance = Math.max(0, Number(cfg.pullDistance) || 0);
        if (pullDistance <= 0) return;
        const sourceX = this.collider?.x ?? this.x;
        const sourceY = this.collider?.y ?? this.y;
        const shape = this._makeSkillShape(cfg);
        for (const target of hostilesOf(this, entities)) {
            if (this._action?.kind !== 'vacuum' || this._cannotAttack()) break;
            if (!this._isSkillTarget(target, shape, sourceX, sourceY)) continue;
            const targetX = target.collider?.x ?? target.x;
            const targetY = target.collider?.y ?? target.y;
            target.applyKnockback?.(Math.atan2(sourceY - targetY, sourceX - targetX), pullDistance);
        }
    }

    _resolveSkillImpact(kind, cfg, entities) {
        const sourceX = this.collider?.x ?? this.x;
        const sourceY = this.collider?.y ?? this.y;
        const shape = this._makeSkillShape(cfg);
        const damage = Math.max(1, Math.round(
            (this.data?.matk || 1) * Math.max(0, Number(cfg.damageMul) || 1)
        ));
        this._fireSkillShockwave(kind, cfg);
        for (const target of hostilesOf(this, entities)) {
            if (this._action?.kind !== kind || this._cannotAttack()) break;
            if (!this._isSkillTarget(target, shape, sourceX, sourceY)) continue;
            const targetX = target.collider?.x ?? target.x;
            const targetY = target.collider?.y ?? target.y;
            const result = DamagePipeline.applyHit(this, target, {
                damage,
                damageType: cfg.damageType || 'magic',
                knockback: Math.max(0, Number(cfg.knockback) || 0),
                angle: Math.atan2(targetY - sourceY, targetX - sourceX),
                isMelee: false,
                currentWeapon: null,
                confirmedHitContext: { skillId: `hollowOvum${kind === 'pulse' ? 'Pulse' : 'Vacuum'}` },
            });
            if (this._action?.kind !== kind || this._cannotAttack()) break;
            if (result.hit && !result.parried && target.active && !target._isDead
                && Number(cfg.stunMs) > 0) target.applyStun?.(Number(cfg.stunMs));
        }
    }

    _makeSkillShape(cfg) {
        const radius = Math.max(1, Number(cfg.radius) || 1);
        return new GroundEllipse(
            this.collider?.x ?? this.x,
            this.collider?.y ?? this.y,
            radius,
            radius * PERSPECTIVE_SCALE_Y,
            surfaceEffectFromEntity(this)
        );
    }

    _isSkillTarget(target, shape, sourceX, sourceY) {
        return this._validTarget(target) && shape.intersectsEntity(target)
            && canMeleeShareSurface(this, target)
            && hasAttackLineOfSight(this, target, sourceX, sourceY);
    }

    _fireSkillShockwave(kind, cfg) {
        const pulse = kind === 'pulse';
        const graphic = fireGroundShockwave({
            x: this.collider?.x ?? this.x,
            y: this.collider?.y ?? this.y,
            maxRadius: Math.max(1, Number(cfg.radius) || 1),
            strokeColor: pulse ? 0xd7b5a5 : 0x9674b6,
            fillColor: pulse ? 0x76505d : 0x49375e,
            lineWidth: pulse ? 8 : 6,
            duration: pulse ? 700 : 900,
            groundLayer: true,
        });
        if (graphic) this._shockwaveGraphics.push(graphic);
    }

    _cancelAction() {
        const keepPose = !this._deathStarted && this.hasStatusEffect('petrified');
        const state = this._animState;
        const elapsed = this._animElapsed;
        const frame = this._animFrame;
        super._cancelAction();
        this._clearAttackTelegraph();
        if (keepPose) {
            this._animState = state;
            this._animElapsed = elapsed;
            this._animFrame = frame;
            this._actionState = 'controlled';
            this._syncFootOffset();
        }
    }

    _syncPetrifiedBodyAnchor(sprite) {
        const state = sprite.texture?.key?.replace(`enemy_${this._textureFamily}_`, '');
        const layout = this.config.textures.frameLayouts[state];
        if (!layout) return;
        sprite.x += (layout.frameWidth / 2 - layout.footX)
            * Math.abs(sprite.scaleX) * (sprite.flipX ? -1 : 1);
        sprite.y += this.footOffsetY - (layout.footY - layout.frameHeight / 2)
            * Math.abs(sprite.scaleY) + (this.colliderOffsetY || 0);
    }

    _getPhaserOptions() {
        return {
            ...super._getPhaserOptions(),
            flipX: false,
            manualFrame: true,
            frameAnchorX: this._layout().footX,
        };
    }

    _destroyCustomEffects() {
        for (const graphic of this._shockwaveGraphics) {
            if (graphic?.active) graphic.destroy();
        }
        this._shockwaveGraphics = [];
    }

    onDeath(source) {
        this._destroyCustomEffects();
        super.onDeath(source);
    }
}
