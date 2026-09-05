import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { DamagePipeline } from '../../combat/damage-pipeline.js';
import { isFriendlyFire } from '../damageable-entity.js';
import { PartySystem } from '../../systems/party-system.js';
import { distanceToEntityShape } from '../../utils/collision-helpers.js';
import { GroundDirectedRect, GroundEllipse, GroundSector } from '../../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../../physics/elevation.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { WallSystem } from '../../world/wall-system.js';

/**
 * 黑肺提灯长（废弃矿洞专属领主）
 *
 * 镐击负责近距压制，黑肺咳雾负责中距扇区减益，提灯过载负责贴身环形
 * 爆发。三套动作共用最终 RIFE 表的单一帧时钟；起手后锁定方向、冻结
 * 移动，跨帧阈值仍只结算一次。
 */
export class BlackLungLampKeeper extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.blackLungLampKeeper,
            showWeapon: false,
            ...config,
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        this._usesDirectedBasicMelee = true;

        this._animState = 'idle';
        this._animStateTimer = 0;
        this._action = null;
        this._actionCfg = null;
        this._actionDuration = 0;
        this._actionTimer = 0;
        this._actionTarget = null;
        this._actionSnapshot = null;
        this._actionHitDone = false;
        this._lastEntities = null;
        this._cooldowns = {
            blackLungCough: Math.max(0, Number(this._skill('blackLungCough').initialCooldownMs) || 0),
            lanternOverload: Math.max(0, Number(this._skill('lanternOverload').initialCooldownMs) || 0),
        };

        this._preserveCorpse = true;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._syncApproachProfile();
    }

    _skill(key) {
        return this.config?.attackSkills?.[key] || {};
    }

    _layout(key = this._animState) {
        const layouts = this.config?.textures?.frameLayouts || {};
        return layouts[key] || layouts.idle || {
            frameWidth: 320,
            frameHeight: 544,
            frameCount: 1,
            footY: 503,
            authoredBodyHeight: 460,
        };
    }

    _syncApproachProfile() {
        const slam = this._skill('pickaxeSlam');
        const cough = this._skill('blackLungCough');
        const overload = this._skill('lanternOverload');
        let reach = Number(slam.approachReach) || 230;
        if ((this._cooldowns?.blackLungCough || 0) <= 0) {
            reach = Math.max(reach, Number(cough.triggerRange) || 400);
        }
        if ((this._cooldowns?.lanternOverload || 0) <= 0) {
            reach = Math.max(reach, Number(overload.triggerRange) || 300);
        }
        this.attackRange = reach;
        this.attackDistance = reach;
        this.config.basicMelee = {
            ...(this.config.basicMelee || {}),
            approachReach: reach,
            impactReach: reach,
            width: Number(slam.width) || 150,
            requiresSameSurface: true,
            requiresLosAtImpact: true,
        };
        const attack = this.attacks?.melee;
        if (!attack) return;
        attack.config.range = reach;
        attack.config.dynamicRange = reach;
        attack.range = reach;
        attack.maxCooldown = Number(slam.cooldown) || 5200;
        attack.baseMaxCooldown = attack.maxCooldown;
    }

    updateWhilePetrified(dt) {
        if (this._action) this._finishAction();
        if (this._pendingThrust?.active) this._pendingThrust.active = false;
        this._clearAttackTelegraph?.();
        super.updateWhilePetrified(dt);
    }

    _onCombatActionInterruptedByControl() {
        if (this._action) this._finishAction();
        super._onCombatActionInterruptedByControl();
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateDeathSequence(dt);
            return;
        }

        super.update(dt, entities);
        if (!this.active) return;
        this._lastEntities = entities;
        const delta = Math.max(0, Number(dt) || 0);
        const cooldownDt = typeof this.getAttackIntervalDelta === 'function'
            ? this.getAttackIntervalDelta(delta)
            : delta;
        this._cooldowns.blackLungCough = Math.max(
            0, this._cooldowns.blackLungCough - cooldownDt
        );
        this._cooldowns.lanternOverload = Math.max(
            0, this._cooldowns.lanternOverload - cooldownDt
        );

        const controlled = this.hasStatusEffect
            && (this.hasStatusEffect('stun')
                || this.hasStatusEffect('frozen')
                || this.hasStatusEffect('petrified')
                || this.hasStatusEffect('fear'));
        if (this._action) {
            if (controlled) this._finishAction();
            else this._updateAction(delta);
            return;
        }

        this._frozenForCast = false;
        this._attackAnimTimer = 0;
        this._syncApproachProfile();
        const speed = Math.hypot(this.vx, this.vy);
        const next = speed > (this.maxSpeed || this.speed || 120) * 0.05 ? 'walking' : 'idle';
        this._animStateTimer += delta;
        if (next !== this._animState && this._animStateTimer >= 80) {
            this._animState = next;
            this._animStateTimer = 0;
        }
        if (speed > 0.1) this.rotation = Math.atan2(this.vy, this.vx);
    }

    triggerWeaponAnim() {
        if (this._action || !this.active) return false;
        const pending = this._pendingThrust?.active ? this._pendingThrust : null;
        const target = pending?.primaryTarget || this.target;
        if (!this._isValidTarget(target)) return false;
        // 通用 ThrustAttack 只负责起手与冷却；命中只由专属动作帧结算。
        if (pending) pending.active = false;

        const sourceX = this.collider?.x ?? this.x;
        const sourceY = this.collider?.y ?? this.y;
        const distance = distanceToEntityShape(target, sourceX, sourceY);
        const overload = this._skill('lanternOverload');
        const cough = this._skill('blackLungCough');
        const slam = this._skill('pickaxeSlam');
        let action = null;
        if (this._cooldowns.lanternOverload <= 0
            && distance <= (Number(overload.triggerRange) || 300)) {
            action = 'lanternOverload';
        } else if (this._cooldowns.blackLungCough <= 0
            && distance >= (Number(cough.minTriggerRange) || 140)
            && distance <= (Number(cough.triggerRange) || 400)) {
            action = 'blackLungCough';
        } else if (distance <= (Number(slam.approachReach) || 230)) {
            action = 'pickaxeSlam';
        }
        if (!action) return false;
        return this._startAction(action, target);
    }

    _startAction(action, target) {
        const cfg = this._skill(action);
        const sourceX = this.collider?.x ?? this.x;
        const sourceY = this.collider?.y ?? this.y;
        const targetX = target.collider?.x ?? target.x;
        const targetY = target.collider?.y ?? target.y;
        const dx = targetX - sourceX;
        const dy = targetY - sourceY;
        const worldAngle = Math.atan2(dy, dx);
        const groundAngle = Math.atan2(dy / PERSPECTIVE_SCALE_Y, dx);
        const duration = Math.max(1, Number(cfg.duration) || 5083);

        this._action = action;
        this._actionCfg = cfg;
        this._actionDuration = duration;
        this._actionTimer = duration;
        this._actionTarget = target;
        this._actionSnapshot = { sourceX, sourceY, worldAngle, groundAngle };
        this._actionHitDone = false;
        this._animState = action;
        this._animStateTimer = 0;
        this._frozenForCast = true;
        this._attackAnimTimer = duration;
        this.rotation = worldAngle;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;

        if (action === 'blackLungCough') {
            this._cooldowns.blackLungCough = Math.max(0, Number(cfg.cooldown) || 11000);
        } else if (action === 'lanternOverload') {
            this._cooldowns.lanternOverload = Math.max(0, Number(cfg.cooldown) || 14000);
        }
        return true;
    }

    _updateAction(dt) {
        const previous = this._actionTimer;
        this._actionTimer = Math.max(0, previous - dt);
        this._attackAnimTimer = this._actionTimer;
        this._frozenForCast = true;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        if (this._actionSnapshot) this.rotation = this._actionSnapshot.worldAngle;

        const elapsedBefore = this._actionDuration - previous;
        const elapsedAfter = this._actionDuration - this._actionTimer;
        const frameCount = Math.max(1, Number(this._actionCfg?.frames) || 61);
        const frameMs = this._actionDuration / frameCount;
        const hitFrame = Number(
            this._actionCfg?.contactFrame
            ?? this._actionCfg?.releaseFrame
            ?? this._actionCfg?.impactFrame
            ?? 0
        );
        const hitMs = Math.max(0, hitFrame) * frameMs;
        if (!this._actionHitDone && elapsedBefore < hitMs && elapsedAfter >= hitMs) {
            this._actionHitDone = true;
            this._resolveActionHit();
        }
        if (this._actionTimer <= 0) this._finishAction();
    }

    _resolveActionHit() {
        if (this._action === 'pickaxeSlam') this._resolvePickaxeSlam();
        else if (this._action === 'blackLungCough') this._resolveBlackLungCough();
        else if (this._action === 'lanternOverload') this._resolveLanternOverload();
    }

    _resolvePickaxeSlam() {
        const cfg = this._actionCfg || {};
        const snap = this._actionSnapshot;
        if (!snap) return;
        const shape = new GroundDirectedRect(
            snap.sourceX,
            snap.sourceY,
            snap.groundAngle,
            Math.max(1, Number(cfg.range) || 250),
            Math.max(1, Number(cfg.width) || 150),
            0,
            surfaceEffectFromEntity(this)
        );
        this._damageTargetsInShape(
            shape, cfg, 'blackLungPickaxeSlam', snap.sourceX, snap.sourceY,
            (target, parried) => {
                if (!parried && Number(cfg.crippleMs) > 0) {
                    target.applyCripple?.(Number(cfg.crippleMs));
                }
            },
            true
        );
    }

    _resolveBlackLungCough() {
        const cfg = this._actionCfg || {};
        const snap = this._actionSnapshot;
        if (!snap) return;
        const shape = new GroundSector(
            snap.sourceX,
            snap.sourceY,
            snap.groundAngle,
            Math.max(1, Number(cfg.range) || 400),
            Math.max(1, Number(cfg.arcDegrees) || 100) * Math.PI / 180,
            surfaceEffectFromEntity(this)
        );
        this._damageTargetsInShape(
            shape, cfg, 'blackLungCough', snap.sourceX, snap.sourceY,
            (target) => {
                if (Number(cfg.poisonStacks) > 0) {
                    target.applyPoison?.(Number(cfg.poisonStacks));
                }
                if (Number(cfg.slowMs) > 0) {
                    target.applyCripple?.(Number(cfg.slowMs));
                }
            },
            false
        );
    }

    _resolveLanternOverload() {
        const cfg = this._actionCfg || {};
        const snap = this._actionSnapshot;
        if (!snap) return;
        const shape = new GroundEllipse(
            snap.sourceX,
            snap.sourceY,
            Math.max(1, Number(cfg.radiusX) || 310),
            Math.max(1, Number(cfg.radiusY) || 165),
            surfaceEffectFromEntity(this)
        );
        this._damageTargetsInShape(
            shape, cfg, 'blackLungLanternOverload', snap.sourceX, snap.sourceY,
            (target) => {
                if (Number(cfg.corrosionStacks) > 0) {
                    target.applyCorrosion?.(
                        Number(cfg.corrosionStacks),
                        Number(cfg.corrosionMs) || 6000,
                        Number(cfg.defenseReductionPerStack) || 0.05
                    );
                }
            },
            false
        );
    }

    _damageTargetsInShape(shape, cfg, skillId, originX, originY, afterHit, isMelee) {
        for (const target of this._collectTargets()) {
            if (!this._isValidTarget(target) || !shape.intersectsEntity(target)) continue;
            if (this._isWallBlocked(target, originX, originY)) continue;
            const tx = target.collider?.x ?? target.x;
            const ty = target.collider?.y ?? target.y;
            const result = DamagePipeline.applyHit(this, target, {
                damage: this._scaledDamage(cfg),
                damageType: cfg.damageType || 'physical',
                knockback: Math.max(0, Number(cfg.knockback) || 0),
                angle: Math.atan2(ty - originY, tx - originX),
                isMelee,
                confirmedHitContext: { skillId },
            });
            if (!result.hit) continue;
            const parried = !!(isMelee && target.shieldSystem?._lastParried);
            if (afterHit) afterHit(target, parried);
        }
    }

    _scaledDamage(cfg) {
        const base = cfg.damageType === 'magic'
            ? (Number(this.data?.matk) || Number(this.data?.int) || 1)
            : (Number(this.data?.atk) || 1);
        return Math.max(1, Math.round(base * (Math.max(0, Number(cfg.damageMul) || 1))));
    }

    _collectTargets() {
        const supplied = this._lastEntities?.values
            ? this._lastEntities.values()
            : (this._lastEntities || []);
        const targets = new Set(supplied);
        for (const member of PartySystem.members || []) targets.add(member);
        const friendlies = (typeof window !== 'undefined' && window.Game?.friendlyUnits) || [];
        for (const friendly of friendlies) targets.add(friendly);
        return targets;
    }

    _isValidTarget(target) {
        return !!target && target !== this && target.active && !target._isDead
            && target.hittable !== false && target.hp > 0
            && target._faction !== 'enemy' && !isFriendlyFire(this, target);
    }

    _isWallBlocked(target, originX, originY) {
        const tx = target.collider?.x ?? target.x;
        const ty = target.collider?.y ?? target.y;
        const ignore = target._coverSeg ? { segs: new Set([target._coverSeg]) } : null;
        if (!WallSystem?.blocked?.(originX, originY, tx, ty, ignore)) return false;
        return !(target._isDefenseStructure
            && distanceToEntityShape(target, originX, originY)
                <= Math.max(1, Number(this._actionCfg?.range) || Number(this._actionCfg?.radiusX) || 250));
    }

    _finishAction() {
        this._action = null;
        this._actionCfg = null;
        this._actionDuration = 0;
        this._actionTimer = 0;
        this._actionTarget = null;
        this._actionSnapshot = null;
        this._attackAnimTimer = 0;
        this._frozenForCast = false;
        this._animState = 'idle';
        this._animStateTimer = 0;
        this.aiTimer = 0;
        this._syncApproachProfile();
    }

    onDeath(source) {
        if (!this.active) return;
        this._finishAction();
        this.active = false;
        this._animState = 'dying';
        const death = this.config?.death || {};
        this._deathAnimTimer = Math.max(1, Number(death.animMs) || 3417);
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        if (typeof super.onDeath === 'function') super.onDeath(source);
    }

    _updateDeathSequence(dt) {
        const death = this.config?.death || {};
        if (this._deathAnimTimer > 0) {
            this._deathAnimTimer = Math.max(0, this._deathAnimTimer - dt);
            if (this._deathAnimTimer <= 0) this._corpseTimer = Number(death.holdMs) || 1400;
        } else if (this._corpseTimer > 0) {
            this._corpseTimer = Math.max(0, this._corpseTimer - dt);
            if (this._corpseTimer <= 0) this._fadeTimer = Number(death.fadeMs) || 300;
        } else if (this._fadeTimer > 0) {
            this._fadeTimer = Math.max(0, this._fadeTimer - dt);
            const fadeMs = Number(death.fadeMs) || 300;
            if (this._phaserSprite?.active) {
                this._phaserSprite.setAlpha(Math.max(0, this._fadeTimer / fadeMs));
                if (this._fadeTimer <= 0) {
                    this._phaserSprite.destroy();
                    this._phaserSprite = null;
                }
            }
        }
    }

    _getTextureKey() {
        return `enemy_black_lung_lamp_keeper_${this._animState}`;
    }

    _getPhaserOptions() {
        const render = this.config?.render || {};
        const layout = this._layout();
        const targetBodyHeight = Math.max(1, Number(render.bodyDisplayHeight) || 260);
        const authoredBodyHeight = Math.max(1, Number(layout.authoredBodyHeight) || 460);
        const pixelScale = targetBodyHeight / authoredBodyHeight;
        const frameWidth = Math.max(1, Number(layout.frameWidth) || 320);
        const frameHeight = Math.max(1, Number(layout.frameHeight) || 544);
        const spriteSize = Math.max(frameWidth, frameHeight) * pixelScale;
        const footY = Number.isFinite(Number(layout.footY)) ? Number(layout.footY) : frameHeight;
        this.footOffsetY = (footY - frameHeight / 2) * pixelScale;

        let flipX = false;
        if (this._actionSnapshot) flipX = Math.cos(this._actionSnapshot.worldAngle) < 0;
        else if (this.isMoving && Math.abs(this.vx) > 0.1) flipX = this.vx < 0;
        else flipX = Math.cos(this.rotation || 0) < 0;

        const oneShot = this._animState === 'pickaxeSlam'
            || this._animState === 'blackLungCough'
            || this._animState === 'lanternOverload';
        const animState = this._animState === 'dying'
            ? 'death'
            : (oneShot ? 'attack' : (this._animState === 'walking' ? 'walk' : 'idle'));
        return {
            spriteSize,
            collisionWidth: Number(render.collisionWidth) || 112,
            collisionHeight: Number(render.collisionHeight) || 225,
            textOffsetY: -(Number(render.collisionHeight) || 225) - 18,
            flipX,
            animState,
            animKey: `enemy_black_lung_lamp_keeper_${this._animState}`,
            dynamicSpriteSize: true,
        };
    }
}
