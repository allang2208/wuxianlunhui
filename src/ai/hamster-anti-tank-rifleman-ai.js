import { advanceFriendlyAttackClock, beginFriendlyAttackClock } from '../combat/friendly-attack-timing.js';
import {
    isFriendlyAttackTarget,
    launchFriendlyProjectile,
    sweepFriendlyProjectile,
} from '../combat/friendly-projectile-sweep.js';
import { HamsterMusketeerAI } from './hamster-musketeer-ai.js';
import { WallSystem } from '../world/wall-system.js';
import {
    applyProjectileWallImpact,
    projectileMuzzleOrigin,
    projectileTargetZ,
    projectileWallContext,
} from '../combat/elevated-ranged.js';
import { queryNearbyEntities } from './friendly-spatial-query.js';

const GRENADE_HIT_RADIUS = 24;

/** 波波沙常规射击 + 近距周期反坦克手榴弹；两种攻击共用显示/事件时钟。 */
export class HamsterAntiTankRiflemanAI extends HamsterMusketeerAI {
    constructor(unit) {
        super(unit);
        const cfg = this.cfg;
        this._grenadeCooldownMs = cfg.grenadeCooldownMs ?? 12000;
        this._grenadeCooldownTimer = cfg.grenadeInitialDelayMs ?? 4000;
        this._grenadeDamage = cfg.grenadeDamage ?? 150;
        this._grenadeAntiVehicleMultiplier = cfg.grenadeAntiVehicleMultiplier ?? 1.6;
        this._grenadeThrowRange = cfg.grenadeThrowRange ?? 320;
        this._grenadeSplashRadius = cfg.grenadeSplashRadius ?? 80;
        this._grenadeFalloffMaxReduction = Math.max(0, Math.min(1,
            Number(cfg.grenadeFalloffMaxReduction) || 0.5));
        this._grenadeProjectileSpeed = cfg.grenadeProjectileSpeed ?? 420;
        this._grenadeGravity = cfg.grenadeGravity ?? 650;
        this._grenadeActionMs = cfg.grenadeActionDurationMs ?? 1300;

        const animation = unit.animations?.grenade_throw || {};
        const frameCount = Math.max(1, Number(animation.frameCount) || 79);
        this._grenadeClockFps = frameCount / Math.max(0.001, this._grenadeActionMs / 1000);
        const releaseFrame = Math.max(1, Number(cfg.grenadeReleaseFrame) || 45);
        this._grenadeReleaseDelayMs = (releaseFrame - 1) / this._grenadeClockFps * 1000;
        this._grenadeSequenceActive = false;
    }

    cancelForCommand() {
        super.cancelForCommand();
        this._grenadeSequenceActive = false;
        this.m._friendlyAttackClock = null;
    }

    update(dt, entities, player) {
        this._grenadeCooldownTimer = Math.max(0, this._grenadeCooldownTimer - dt);
        const sequenceWasActive = this._grenadeSequenceActive;
        super.update(dt, entities, player);
        if (this.m._friendlyAttackClock) advanceFriendlyAttackClock(this.m, dt);
        this._updateExplosion(dt);
        if (sequenceWasActive && !this._shotActive) {
            this._grenadeSequenceActive = false;
            this.m._friendlyAttackClock = null;
        }
    }

    _engage(target) {
        const distance = target
            ? Math.hypot(target.x - this.m.x, target.y - this.m.y)
            : Number.POSITIVE_INFINITY;
        const canThrow = this._grenadeCooldownTimer <= 0
            && distance <= this._grenadeThrowRange + (target?.groundRadius || 0)
            && this._canAttackFromHere(target);
        const wasShooting = this._shotActive;
        super._engage(target);
        if (!canThrow || wasShooting || !this._shotActive) return;

        this._grenadeSequenceActive = true;
        this._shotTimer = this._grenadeReleaseDelayMs;
        this._shotAnimLeft = this._grenadeActionMs;
        beginFriendlyAttackClock(this, 'grenade_throw', this._grenadeActionMs, {
            state: 'attack',
            fps: this._grenadeClockFps,
            fitInterval: false,
        });
    }

    _fireProjectile() {
        if (!this._grenadeSequenceActive) {
            super._fireProjectile();
            return;
        }
        const m = this.m;
        const target = m.target;
        if (!isFriendlyAttackTarget(target) || !this._canAttackFromHere(target)) return;
        const distance = Math.hypot(target.x - m.x, target.y - m.y);
        if (distance > this._grenadeThrowRange + (target.groundRadius || 0)) return;

        const origin = projectileMuzzleOrigin(m, target, {
            anchor: m.config?.render?.grenadeMuzzle,
        });
        const { x: startX, y: startY, z: startZ } = origin;
        const dx = target.x - startX;
        const dy = target.y - startY;
        const horizontalDistance = Math.max(1, Math.hypot(dx, dy));
        const angle = Math.atan2(dy, dx);
        const flightSeconds = horizontalDistance / Math.max(1, this._grenadeProjectileSpeed);
        const targetZ = projectileTargetZ(target);
        const vz = (targetZ - startZ
            + 0.5 * this._grenadeGravity * flightSeconds * flightSeconds) / flightSeconds;
        launchFriendlyProjectile(m, {
            active: true,
            antiTankGrenade: true,
            x: startX,
            y: startY,
            z: startZ,
            vz,
            gravity: this._grenadeGravity,
            angle,
            visualAngle: angle,
            spin: (m._lastFaceRight === false ? -1 : 1) * 7.5,
            dist: 0,
            maxDist: horizontalDistance,
            wallContext: projectileWallContext(m, null, origin),
            target,
        });
        // 冷却只在第45帧真正脱手后开始；脱手前取消不会吞冷却。
        this._grenadeCooldownTimer = this._grenadeCooldownMs;
    }

    _updateProjectile(dt, entities) {
        const m = this.m;
        const projectile = m._basic;
        if (!projectile?.antiTankGrenade) {
            super._updateProjectile(dt, entities);
            return;
        }

        const previousDist = Number(projectile.dist) || 0;
        const { events, from, to } = sweepFriendlyProjectile(
            m, projectile, dt, this._grenadeProjectileSpeed, entities, GRENADE_HIT_RADIUS);
        const traveled = Math.max(0, (Number(projectile.dist) || 0) - previousDist);
        const seconds = traveled / Math.max(1, this._grenadeProjectileSpeed);
        projectile.vz = (Number(projectile.vz) || 0) - this._grenadeGravity * seconds;
        projectile.visualAngle = (Number(projectile.visualAngle) || projectile.angle)
            + (Number(projectile.spin) || 0) * seconds;

        const contact = events[0];
        if (!contact && projectile.dist < projectile.maxDist) return;
        const t = contact?.t ?? 1;
        const impact = {
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t,
            z: Math.max(0, from.z + (to.z - from.z) * t),
        };
        const wallTarget = contact?.wall?.owner || contact?.wall?.wall;
        if (contact?.wall) {
            applyProjectileWallImpact(m, contact.wall, this._grenadeDamage, 'physical');
        }
        this._explodeGrenade(impact, entities, wallTarget, contact?.entity);
        projectile.active = false;
        m._basic = null;
    }

    _explodeGrenade(impact, entities, wallTarget = null, directTarget = null) {
        const m = this.m;
        for (const entity of queryNearbyEntities(
            entities, impact, this._grenadeSplashRadius + 96)) {
            if (!isFriendlyAttackTarget(entity) || entity === wallTarget) continue;
            const bottom = entity.collider?.bottomZ ?? (Number(entity.z) || 0);
            const top = entity.collider?.topZ
                ?? (bottom + (entity.bodyHeight || entity.size || 80));
            const verticalGap = Math.max(bottom - impact.z, impact.z - top, 0);
            const distance = Math.hypot(entity.x - impact.x, entity.y - impact.y, verticalGap);
            if (distance > this._grenadeSplashRadius + (Number(entity.collisionRadius) || 0)) continue;
            if (entity !== directTarget && WallSystem.projectileWallHit?.(
                impact.x, impact.y, impact.z,
                entity.x, entity.y, projectileTargetZ(entity))) continue;
            const falloff = 1 - Math.min(1, distance / this._grenadeSplashRadius)
                * this._grenadeFalloffMaxReduction;
            const roleMultiplier = this._isVehicleTarget(entity)
                ? this._grenadeAntiVehicleMultiplier : 1;
            const damage = this._grenadeDamage * falloff * roleMultiplier;
            entity.takeDamage?.(
                m.getPhysicalAttackDamage(damage, entity), m, 'physical', false);
        }
        m._antiVehicleExplosion = {
            active: true,
            x: impact.x,
            y: impact.y,
            z: impact.z,
            lifeMs: 260,
            maxLifeMs: 260,
        };
    }

    updateProjectilesWhileControlled(dt, entities) {
        super.updateProjectilesWhileControlled(dt, entities);
        this._updateExplosion(dt);
    }

    _isVehicleTarget(target) {
        const labels = [
            target?._unitKind,
            target?.role,
            target?.category,
            target?.config?.role,
            target?.config?.category,
            target?.config?.type,
            ...(target?.families || []),
            ...(target?.config?.families || []),
        ].filter(Boolean).map((value) => String(value).toLowerCase());
        return !!target?._isVehicle || labels.some((value) => (
            value.includes('vehicle') || value.includes('载具') || value.includes('机械')
        ));
    }

    _updateExplosion(dt) {
        const explosion = this.m._antiVehicleExplosion;
        if (!explosion?.active) return;
        explosion.lifeMs -= dt;
        if (explosion.lifeMs <= 0) explosion.active = false;
    }
}
