import { Enemy } from '../enemy.js';
import enemyConfigData from '../../../data/enemy-config.json';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { surfaceEffectFromEntity } from '../../physics/elevation.js';
import { WallSystem } from '../../world/wall-system.js';
import { hostilesOf } from './_shared/enemy-utils.js';
import {
    canImpactBasicMelee,
    canStartBasicMelee,
    createBasicMeleeSnapshot,
} from '../../combat/melee-attack-resolver.js';
import {
    burstParticles,
    createGroundWarning,
    destroyWarning,
    fireGroundShockwave,
    fireRadialLines,
    keepWarningAlive,
} from '../../effects/combat-fx.js';

/**
 * 岩芯钻虫（废弃矿洞专属精英）
 *
 * 常态使用方向性研磨近战；目标拉开后可进入“入土 → 地下追踪 → 破土”状态机。
 * 真正进入地下后暂时从受击、HUD、小地图、阴影和实体分离链中移除；破土接触帧
 * 只结算一次椭圆范围伤害，然后恢复所有常规实体合同。
 */
export class CoreDrillWorm extends Enemy {
    constructor(x, y, config = {}) {
        super(x, y, {
            ...enemyConfigData.coreDrillWorm,
            showWeapon: false,
            ...config,
        });
        this._useStickFigure = false;
        this._usePacingAI = false;
        this._usesDirectedBasicMelee = true;
        this.aiInterval = Number.MAX_SAFE_INTEGER;

        this._actionState = 'idle';
        this._actionTimer = 0;
        this._attackAnimTimer = 0;
        this._animState = 'idle';
        this._animStateTimer = 0;

        this._grinderCd = 0;
        this._burrowCd = 0;
        this._grinderTarget = null;
        this._grinderSnapshot = null;
        this._grinderHitDone = false;

        this._burrowDestination = null;
        this._burrowSurfaceContext = null;
        this._burrowWarning = null;
        this._burrowImpactDone = false;
        this._burrowRestoreFlags = null;

        this._preserveCorpse = true;
        this._deathAnimTimer = 0;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._syncFootOffset();
    }

    _getGrinderConfig() {
        return this.config?.attackSkills?.grinderStrike || {};
    }

    _getBurrowConfig() {
        return this.config?.attackSkills?.burrowAmbush || {};
    }

    _getDeathConfig() {
        return this.config?.death || {};
    }

    update(dt, entities) {
        if (!this.active) {
            this._updateDeathSequence(dt);
            return;
        }

        super.update(dt, entities);

        const attackDt = this.getAttackIntervalDelta(dt);
        if (this._grinderCd > 0) this._grinderCd = Math.max(0, this._grinderCd - attackDt);
        if (this._burrowCd > 0) this._burrowCd = Math.max(0, this._burrowCd - attackDt);
        if (!keepWarningAlive(this._burrowWarning)) this._burrowWarning = null;

        const untargetable = this._actionState === 'burrow_hidden'
            || (this._actionState === 'burrow_exit' && !this._burrowImpactDone);
        if (!untargetable && (this.hasStatusEffect?.('stun')
            || this.hasStatusEffect?.('frozen')
            || this.hasStatusEffect?.('petrified'))) {
            this._cancelAction();
            this.vx = 0;
            this.vy = 0;
            this.isMoving = false;
            return;
        }
        if (!untargetable && this.hasStatusEffect?.('fear')) return;

        if (this._actionState !== 'idle') {
            this._updateAction(dt, entities);
        } else {
            this._chooseAttack();
        }

        this._syncAnimationState(dt);
        this._syncFootOffset();
    }

    _chooseAttack() {
        const target = this.target?.active && this.target?.hittable ? this.target : null;
        if (!target || this._attackTelegraphTimer > 0) return;
        const distance = Math.hypot(target.x - this.x, target.y - this.y);
        const burrow = this._getBurrowConfig();
        if (this._burrowCd <= 0
            && distance >= (burrow.minRange ?? 210)
            && distance <= (burrow.maxRange ?? 700)) {
            this._tryAttackTelegraph(() => this._startBurrow());
            return;
        }

        const grinder = this._getGrinderConfig();
        if (this._grinderCd <= 0 && canStartBasicMelee(this, target, grinder)) {
            this._tryAttackTelegraph(() => this._startGrinder());
        }
    }

    _startGrinder() {
        if (this._actionState !== 'idle') return false;
        const target = this.target?.active && this.target?.hittable ? this.target : null;
        const cfg = this._getGrinderConfig();
        if (!target || !canStartBasicMelee(this, target, cfg)) return false;

        const duration = Math.max(1, Number(cfg.duration) || 5083);
        this._actionState = 'grinder_attack';
        this._actionTimer = duration;
        this._attackAnimTimer = duration;
        this._grinderCd = Math.max(0, Number(cfg.cooldown) || 5500);
        this._grinderTarget = target;
        this._grinderSnapshot = createBasicMeleeSnapshot(this, target, cfg);
        this._grinderHitDone = false;
        this._animState = 'grinder_attack';
        this._animStateTimer = 0;
        this.rotation = this._grinderSnapshot.worldAngle;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        return true;
    }

    _startBurrow() {
        if (this._actionState !== 'idle') return false;
        const target = this.target?.active && this.target?.hittable ? this.target : null;
        const cfg = this._getBurrowConfig();
        if (!target) return false;
        const distance = Math.hypot(target.x - this.x, target.y - this.y);
        if (distance < (cfg.minRange ?? 210) || distance > (cfg.maxRange ?? 700)) return false;

        const duration = Math.max(1, Number(cfg.enterDuration) || 2583);
        this._actionState = 'burrow_enter';
        this._actionTimer = duration;
        this._attackAnimTimer = duration;
        this._burrowCd = Math.max(0, Number(cfg.cooldown) || 12000);
        this._burrowImpactDone = false;
        this._animState = 'burrow_enter';
        this._animStateTimer = 0;
        this.rotation = Math.atan2(target.y - this.y, target.x - this.x);
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;
        return true;
    }

    _updateAction(dt, entities) {
        const previous = this._actionTimer;
        this._actionTimer = Math.max(0, this._actionTimer - dt);
        this._attackAnimTimer = this._actionTimer;
        this.vx = 0;
        this.vy = 0;
        this.isMoving = false;

        if (this._actionState === 'grinder_attack') {
            this._updateGrinder(previous);
        } else if (this._actionState === 'burrow_enter') {
            if (this._actionTimer <= 0) this._enterUnderground();
        } else if (this._actionState === 'burrow_hidden') {
            if (this._actionTimer <= 0) this._beginBurrowExit();
        } else if (this._actionState === 'burrow_exit') {
            this._updateBurrowExit(previous, entities);
        }
    }

    _updateGrinder(previous) {
        const cfg = this._getGrinderConfig();
        const duration = Math.max(1, Number(cfg.duration) || 5083);
        const frames = Math.max(1, Number(cfg.frames) || 61);
        const hitMs = Math.max(0, Number(cfg.hitFrame) || 0) / frames * duration;
        const elapsedBefore = duration - previous;
        const elapsedAfter = duration - this._actionTimer;
        if (!this._grinderHitDone && elapsedBefore < hitMs && elapsedAfter >= hitMs) {
            this._grinderHitDone = true;
            this._dealGrinderHit();
        }
        if (this._actionTimer <= 0) this._finishAction();
    }

    _dealGrinderHit() {
        const target = this._grinderTarget;
        const snapshot = this._grinderSnapshot;
        if (!canImpactBasicMelee(this, target, snapshot)) return;
        const cfg = this._getGrinderConfig();
        const damage = Math.max(1, Math.round((this.data?.atk || 0) * (Number(cfg.damageMul) || 1)));
        target.takeDamage(damage, this, 'physical', true);
        const parried = target.shieldSystem?._lastParried;
        const knockback = Math.max(0, Number(cfg.knockback) || 0);
        if (!parried && knockback > 0 && typeof target.applyKnockback === 'function') {
            target.applyKnockback(snapshot.worldAngle, knockback);
        }
    }

    _enterUnderground() {
        const cfg = this._getBurrowConfig();
        const target = this.target?.active ? this.target : null;
        const hiddenMs = Math.max(1, Number(cfg.hiddenDuration) || 900);
        const exitMs = Math.max(1, Number(cfg.exitDuration) || 1583);
        const exitFrames = Math.max(1, Number(cfg.exitFrames) || 19);
        const impactLead = (Math.max(0, Number(cfg.impactFrame ?? 6) || 0) / exitFrames) * exitMs;
        const leadSeconds = (hiddenMs + impactLead) / 1000;

        let destinationX = target?.x ?? this.x;
        let destinationY = target?.y ?? this.y;
        if (target) {
            let leadX = (target.vx || 0) * leadSeconds;
            let leadY = (target.vy || 0) * leadSeconds;
            const leadLength = Math.hypot(leadX, leadY);
            const maxLead = Math.max(0, Number(cfg.predictionClamp) || 180);
            if (leadLength > maxLead && leadLength > 0) {
                const scale = maxLead / leadLength;
                leadX *= scale;
                leadY *= scale;
            }
            destinationX += leadX;
            destinationY += leadY;
        }
        const safe = WallSystem.findSafeSpawn(destinationX, destinationY, this.groundRadius || 48, 16);
        this._burrowDestination = {
            x: Number.isFinite(safe?.x) ? safe.x : destinationX,
            y: Number.isFinite(safe?.y) ? safe.y : destinationY,
        };
        this._burrowSurfaceContext = target
            ? surfaceEffectFromEntity(target)
            : surfaceEffectFromEntity(this);
        this._burrowWarning = destroyWarning(this._burrowWarning);
        this._burrowWarning = createGroundWarning(
            this._burrowDestination.x,
            this._burrowDestination.y,
            Number(cfg.impactRadius) || 170
        );

        this._captureBurrowFlags();
        this.hittable = false;
        this._hideHud = true;
        this._noShadow = true;
        this._skipEntitySeparation = true;
        if (this._phaserSprite?.active) this._phaserSprite.setAlpha(0);
        this._actionState = 'burrow_hidden';
        this._actionTimer = hiddenMs;
        this._attackAnimTimer = hiddenMs;
    }

    _beginBurrowExit() {
        const cfg = this._getBurrowConfig();
        const destination = this._burrowDestination || { x: this.x, y: this.y };
        this.x = destination.x;
        this.y = destination.y;
        this.collider?.syncPosition?.();
        this._restoreVisibleBurrowFlags();
        if (this._phaserSprite?.active) this._phaserSprite.setAlpha(1);

        const duration = Math.max(1, Number(cfg.exitDuration) || 1583);
        this._actionState = 'burrow_exit';
        this._actionTimer = duration;
        this._attackAnimTimer = duration;
        this._animState = 'burrow_exit';
        this._animStateTimer = 0;
        this._burrowImpactDone = false;
    }

    _updateBurrowExit(previous, entities) {
        const cfg = this._getBurrowConfig();
        const duration = Math.max(1, Number(cfg.exitDuration) || 1583);
        const frames = Math.max(1, Number(cfg.exitFrames) || 19);
        const impactMs = Math.max(0, Number(cfg.impactFrame ?? 6) || 0) / frames * duration;
        const elapsedBefore = duration - previous;
        const elapsedAfter = duration - this._actionTimer;
        if (!this._burrowImpactDone && elapsedBefore < impactMs && elapsedAfter >= impactMs) {
            this._burrowImpactDone = true;
            this._dealBurrowImpact(entities);
            this._restoreBurrowFlags();
        }
        if (this._actionTimer <= 0) this._finishAction();
    }

    _dealBurrowImpact(entities) {
        const cfg = this._getBurrowConfig();
        const radius = Math.max(1, Number(cfg.impactRadius) || 170);
        const shape = new GroundEllipse(
            this.x,
            this.y,
            radius,
            radius * PERSPECTIVE_SCALE_Y,
            this._burrowSurfaceContext || surfaceEffectFromEntity(this)
        );
        const damage = Math.max(1, Math.round((this.data?.atk || 0) * (Number(cfg.damageMul) || 1)));
        const knockback = Math.max(0, Number(cfg.knockback) || 0);
        for (const entity of hostilesOf(this, entities)) {
            if (!shape.intersectsEntity(entity)) continue;
            entity.takeDamage(damage, this, 'physical', true);
            const parried = entity.shieldSystem?._lastParried;
            if (!parried && knockback > 0 && typeof entity.applyKnockback === 'function') {
                entity.applyKnockback(Math.atan2(entity.y - this.y, entity.x - this.x), knockback);
            }
        }
        this._burrowWarning = destroyWarning(this._burrowWarning);
        fireGroundShockwave({
            x: this.x,
            y: this.y,
            maxRadius: radius,
            strokeColor: 0xd5b47a,
            fillColor: 0x5a3a22,
            lineWidth: 10,
            duration: 520,
            strokeAlpha: 0.9,
            fillAlpha: 0.18,
        });
        fireRadialLines({
            x: this.x,
            y: this.y,
            count: 14,
            color: 0xc69b61,
            innerFrom: 5,
            innerTo: radius * 0.16,
            outerFrom: radius * 0.28,
            outerTo: radius,
            duration: 420,
            lineWidth: 4,
            alpha: 0.9,
        });
        burstParticles({
            texture: 'smoke_particle',
            x: this.x,
            y: this.y,
            count: 22,
            config: {
                speed: { min: 65, max: 210 },
                angle: { min: 190, max: 350 },
                scale: { start: 0.4, end: 1.55 },
                alpha: { start: 0.75, end: 0 },
                tint: [0x4b3b31, 0x75604a, 0xa48660],
                lifespan: 820,
                blendMode: 'NORMAL',
            },
            destroyAfterMs: 920,
            depth: this.y + 20,
        });
    }

    _captureBurrowFlags() {
        if (this._burrowRestoreFlags) return;
        this._burrowRestoreFlags = {
            hittable: this.hittable,
            hideHud: this._hideHud,
            noShadow: this._noShadow,
            skipEntitySeparation: this._skipEntitySeparation,
        };
    }

    _restoreVisibleBurrowFlags() {
        const flags = this._burrowRestoreFlags || {};
        this._hideHud = flags.hideHud;
        this._noShadow = flags.noShadow;
        // 出土接触帧前仍不可被选取，也不参与实体分离。
        this.hittable = false;
        this._skipEntitySeparation = true;
    }

    _restoreBurrowFlags() {
        const flags = this._burrowRestoreFlags;
        if (!flags) return;
        this.hittable = flags.hittable;
        this._hideHud = flags.hideHud;
        this._noShadow = flags.noShadow;
        this._skipEntitySeparation = flags.skipEntitySeparation;
        this._burrowRestoreFlags = null;
        if (this._phaserSprite?.active) this._phaserSprite.setAlpha(1);
    }

    _finishAction() {
        this._restoreBurrowFlags();
        this._burrowWarning = destroyWarning(this._burrowWarning);
        this._actionState = 'idle';
        this._actionTimer = 0;
        this._attackAnimTimer = 0;
        this._grinderTarget = null;
        this._grinderSnapshot = null;
        this._burrowDestination = null;
        this._burrowSurfaceContext = null;
        this._animState = 'idle';
        this._animStateTimer = 0;
        this.aiTimer = 0;
    }

    _cancelAction() {
        if (this._actionState === 'idle') return;
        this._finishAction();
    }

    _syncAnimationState(dt) {
        let nextState = this._animState;
        if (this._actionState === 'idle') {
            const speed = Math.hypot(this.vx, this.vy);
            nextState = speed > (this.maxSpeed ?? this.speed ?? 145) * 0.05
                ? 'crawling'
                : 'idle';
        } else if (this._actionState !== 'burrow_hidden') {
            nextState = this._actionState;
        }
        this._animStateTimer += dt;
        if (nextState !== this._animState
            && (this._actionState !== 'idle' || this._animStateTimer >= 80)) {
            this._animState = nextState;
            this._animStateTimer = 0;
        }

        if (this._grinderSnapshot && this._actionState === 'grinder_attack') {
            this.rotation = this._grinderSnapshot.worldAngle;
        } else if (this._actionState === 'idle' && Math.hypot(this.vx, this.vy) > 0.1) {
            this.rotation = Math.atan2(this.vy, this.vx);
        }
    }

    takeDamage(damage, source, damageType = 'physical', isMelee = true, hitContext = null) {
        if (this._actionState === 'burrow_hidden'
            || (this._actionState === 'burrow_exit' && !this._burrowImpactDone)) return 0;
        return super.takeDamage(damage, source, damageType, isMelee, hitContext);
    }

    onDeath(source) {
        const death = this._getDeathConfig();
        this._restoreBurrowFlags();
        this._burrowWarning = destroyWarning(this._burrowWarning);
        this._actionState = 'death';
        this._actionTimer = 0;
        this._attackAnimTimer = 0;
        this._animState = 'death';
        this._animStateTimer = 0;
        this._deathAnimTimer = death.animMs ?? 5083;
        this._corpseTimer = 0;
        this._fadeTimer = 0;
        this._deathRemoveDelay = this._deathAnimTimer
            + (death.holdMs ?? 1000)
            + (death.fadeMs ?? 300)
            + 500;
        this.active = false;
        if (typeof super.onDeath === 'function') super.onDeath(source);
    }

    _updateDeathSequence(dt) {
        const death = this._getDeathConfig();
        if (this._deathAnimTimer > 0) {
            this._deathAnimTimer = Math.max(0, this._deathAnimTimer - dt);
            if (this._deathAnimTimer <= 0) this._corpseTimer = death.holdMs ?? 1000;
        } else if (this._corpseTimer > 0) {
            this._corpseTimer = Math.max(0, this._corpseTimer - dt);
            if (this._corpseTimer <= 0) this._fadeTimer = death.fadeMs ?? 300;
        } else if (this._fadeTimer > 0) {
            this._fadeTimer = Math.max(0, this._fadeTimer - dt);
            const fadeMs = death.fadeMs ?? 300;
            if (this._phaserSprite?.active) {
                this._phaserSprite.setAlpha(Math.max(0, this._fadeTimer / fadeMs));
            }
            if (this._fadeTimer <= 0 && this._phaserSprite?.active) {
                this._phaserSprite.destroy();
                this._phaserSprite = null;
            }
        }
    }

    _destroyCustomEffects() {
        this._burrowWarning = destroyWarning(this._burrowWarning);
        this._restoreBurrowFlags();
    }

    _getLayoutKey() {
        switch (this._animState) {
            case 'crawling': return 'crawling';
            case 'grinder_attack': return 'grinderAttack';
            case 'burrow_enter': return 'burrowEnter';
            case 'burrow_exit': return 'burrowExit';
            case 'death': return 'death';
            default: return 'idle';
        }
    }

    _getFrameLayout() {
        const layouts = this.config?.textures?.frameLayouts || {};
        return layouts[this._getLayoutKey()] || layouts.idle || {
            frameWidth: 896,
            frameHeight: 640,
            footY: 550,
        };
    }

    _syncFootOffset() {
        const render = this.config?.render || {};
        const layout = this._getFrameLayout();
        const referenceCell = Math.max(1, Number(render.referenceCell) || 896);
        const pixelScale = (Number(render.spriteSize) || 360) / referenceCell;
        this.footOffsetY = ((Number(layout.footY) || layout.frameHeight)
            - (Number(layout.frameHeight) || 640) / 2) * pixelScale;
    }

    _getTextureKey() {
        return `enemy_core_drill_worm_${this._animState}`;
    }

    _getPhaserOptions() {
        const render = this.config?.render || {};
        const layout = this._getFrameLayout();
        const referenceCell = Math.max(1, Number(render.referenceCell) || 896);
        const pixelScale = (Number(render.spriteSize) || 360) / referenceCell;
        const spriteSize = Math.max(
            Number(layout.frameWidth) || referenceCell,
            Number(layout.frameHeight) || referenceCell
        ) * pixelScale;
        let flipX = false;
        if (this._grinderSnapshot && this._actionState === 'grinder_attack') {
            flipX = Math.cos(this._grinderSnapshot.worldAngle) < 0;
        } else if (this.isMoving && Math.abs(this.vx) > 0.1) {
            flipX = this.vx < 0;
        } else {
            flipX = Math.cos(this.rotation || 0) < 0;
        }
        const oneShot = this._animState === 'grinder_attack'
            || this._animState === 'burrow_enter'
            || this._animState === 'burrow_exit';
        const animState = this._animState === 'death'
            ? 'death'
            : (oneShot ? 'attack' : (this._animState === 'crawling' ? 'walk' : 'idle'));
        return {
            spriteSize,
            collisionWidth: render.collisionWidth || 210,
            collisionHeight: render.collisionHeight || 90,
            textOffsetY: -(render.collisionHeight || 90) - 18,
            flipX,
            animState,
            animKey: `enemy_core_drill_worm_${this._animState}`,
            dynamicSpriteSize: true,
            ...(this._actionState === 'burrow_hidden' ? { alpha: 0 } : {}),
        };
    }
}
