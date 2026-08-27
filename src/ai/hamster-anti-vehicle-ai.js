import { HamsterMusketeerAI } from './hamster-musketeer-ai.js';
import { WallSystem } from '../world/wall-system.js';
import { AimHelper } from '../utils/aim-helper.js';
import {
    applyProjectileWallImpact,
    applyElevatedRangedRange,
    projectileSourceZ,
    projectileTargetZ,
    projectileWallContext,
} from '../combat/elevated-ranged.js';
import { hasRangedLineOfSight } from '../combat/ranged-line-of-sight.js';
import { queryNearbyEntities } from './friendly-spatial-query.js';

const ROCKET_HIT_RADIUS = 34;

/**
 * 反载突击队员：父类维持冲锋枪循环，本类只在冷却就绪的一次攻击中切入火箭序列。
 * 动画契约：背后取筒 → 发射 → 抛弃空筒 → 背后刷新新筒并恢复冲锋枪。
 */
export class HamsterAntiVehicleAI extends HamsterMusketeerAI {
    constructor(unit) {
        super(unit);
        const cfg = this.cfg;
        this._rocketCooldownMs = cfg.rocketCooldownMs ?? 8000;
        this._rocketCooldownTimer = cfg.rocketInitialDelayMs ?? 3000;
        this._rocketDamage = cfg.rocketDamage ?? 240;
        this._rocketSplashRadius = cfg.rocketSplashRadius ?? 110;
        this._rocketProjectileSpeed = cfg.rocketProjectileSpeed ?? 780;
        this._rocketAntiVehicleMultiplier = cfg.rocketAntiVehicleMultiplier ?? 1.5;
        this._rocketRecoveryMs = cfg.rocketRecoveryMs ?? 1100;
        this._rocketAnimationIncludesDiscardedLauncher = !!cfg.rocketAnimationIncludesDiscardedLauncher;

        const anim = unit.animations?.rocket_attack || {};
        const fps = cfg.rocketAttackAnimFps ?? anim.frameRate ?? 12;
        const launchFrame = cfg.rocketLaunchFrame ?? 5;
        const discardFrame = cfg.rocketDiscardFrame ?? 7;
        this._rocketLaunchDelayMs = (launchFrame - 1) / fps * 1000;
        this._rocketDiscardDelayMs = (discardFrame - 1) / fps * 1000;
        this._rocketAnimMs = (anim.frameCount || 9) / fps * 1000 + 60;
        this._rocketSequenceActive = false;
        this._rocketDiscarded = false;
        this._rocketDiscardTimer = 0;
    }

    cancelForCommand() {
        super.cancelForCommand();
        this._resetRocketPose();
    }

    update(dt, entities, player) {
        this._rocketCooldownTimer = Math.max(0, this._rocketCooldownTimer - dt);
        const sequenceWasActive = this._rocketSequenceActive;
        super.update(dt, entities, player);
        this._updateDiscardedLauncher(dt);
        this._updateExplosion(dt);

        if (sequenceWasActive && this._rocketSequenceActive && !this._rocketDiscarded) {
            this._rocketDiscardTimer -= dt;
            if (this._rocketDiscardTimer <= 0) this._discardLauncher();
        }
        if (sequenceWasActive && !this._shotActive) this._resetRocketPose();
    }

    _engage(target) {
        const wasShooting = this._shotActive;
        super._engage(target);
        if (wasShooting || !this._shotActive) return;

        if (this._rocketCooldownTimer <= 0) {
            this._rocketSequenceActive = true;
            this._rocketDiscarded = false;
            this._rocketDiscardTimer = this._rocketDiscardDelayMs;
            this._shotTimer = this._rocketLaunchDelayMs;
            this._shotAnimLeft = this._rocketAnimMs;
            this.m._attackVariant = 'rocket';
        } else {
            this.m._attackVariant = 'smg';
        }
    }

    _fireProjectile() {
        if (!this._rocketSequenceActive) {
            super._fireProjectile();
            return;
        }
        const m = this.m;
        const t = m.target;
        if (!t?.active || t.hp <= 0 || !hasRangedLineOfSight(m, t)) return;

        const faceSign = t.x >= m.x ? 1 : -1;
        const startX = m.x + faceSign * (Number(this.cfg.rocketMuzzleOffsetX) || 12);
        const startY = m.y + (Number(this.cfg.rocketMuzzleOffsetY) || 0);
        const configuredMuzzleHeight = Number(this.cfg.rocketMuzzleHeight);
        const startZ = Number.isFinite(configuredMuzzleHeight)
            ? (Number(m.z) || 0) + configuredMuzzleHeight
            : projectileSourceZ(m);
        const targetZ = projectileTargetZ(t);
        const lead = AimHelper.lead(startX, startY, t.x, t.y, t.vx || 0, t.vy || 0, this._rocketProjectileSpeed);
        const angle = Math.atan2(lead.y - startY, lead.x - startX);
        const targetDist = Math.max(1, Math.hypot(lead.x - startX, lead.y - startY));
        m._basic = {
            active: true,
            antiVehicleRocket: true,
            x: startX,
            y: startY,
            z: startZ,
            vz: (targetZ - startZ) / Math.max(0.001, targetDist / this._rocketProjectileSpeed),
            angle,
            visualAngle: Math.atan2((lead.y - targetZ) - (startY - startZ), lead.x - startX),
            dist: 0,
            maxDist: applyElevatedRangedRange(m, this._attackRange + 240),
            wallContext: projectileWallContext(m, null, { x: startX, y: startY, z: startZ }),
            target: t,
        };
        this._rocketCooldownTimer = this._rocketCooldownMs;
        this._attackTimer = Math.max(this._attackTimer, this._rocketRecoveryMs);
    }

    _updateProjectile(dt, entities) {
        const m = this.m;
        const b = m._basic;
        if (!b?.antiVehicleRocket) {
            super._updateProjectile(dt, entities);
            return;
        }

        const step = this._rocketProjectileSpeed * dt / 1000;
        const prevX = b.x;
        const prevY = b.y;
        const prevZ = Number(b.z) || 0;
        b.x += Math.cos(b.angle) * step;
        b.y += Math.sin(b.angle) * step;
        b.z = prevZ + (Number(b.vz) || 0) * dt / 1000;
        b.dist += step;

        const wallHit = WallSystem.projectileWallHit?.(
            prevX, prevY, prevZ, b.x, b.y, b.z,
            b.wallContext || projectileWallContext(m)
        );
        let hit = null;
        for (const e of queryNearbyEntities(entities, b, ROCKET_HIT_RADIUS + 64)) {
            if (!e || !e.active || e.hp <= 0 || e._faction !== 'enemy' || e._isEnergyNode) continue;
            const bottom = e.collider?.bottomZ ?? (Number(e.z) || 0);
            const top = e.collider?.topZ ?? (bottom + (e.bodyHeight || e.size || 80));
            if (Math.hypot(e.x - b.x, e.y - b.y) < ROCKET_HIT_RADIUS
                && b.z >= bottom - ROCKET_HIT_RADIUS && b.z <= top + ROCKET_HIT_RADIUS) {
                hit = e;
                break;
            }
        }

        if (wallHit) {
            applyProjectileWallImpact(m, wallHit, this._rocketDamage, 'physical');
            this._explodeRocket(b.x, b.y, entities);
        } else if (hit || b.dist >= b.maxDist) {
            this._explodeRocket(b.x, b.y, entities);
        }
    }

    _explodeRocket(x, y, entities) {
        const m = this.m;
        for (const e of queryNearbyEntities(entities, { x, y }, this._rocketSplashRadius + 96)) {
            if (!e || !e.active || e.hp <= 0 || e._faction !== 'enemy' || e._isEnergyNode) continue;
            const distance = Math.hypot(e.x - x, e.y - y);
            if (distance > this._rocketSplashRadius + (Number(e.collisionRadius) || 0)) continue;
            const falloff = 1 - Math.min(1, distance / this._rocketSplashRadius) * 0.45;
            const roleMultiplier = this._isVehicleTarget(e) ? this._rocketAntiVehicleMultiplier : 1;
            const damage = this._rocketDamage * falloff * roleMultiplier;
            e.takeDamage?.(m.getPhysicalAttackDamage(damage, e), m, 'physical', false);
        }
        m._antiVehicleExplosion = {
            active: true,
            x,
            y,
            lifeMs: 260,
            maxLifeMs: 260,
        };
        m._basic = null;
    }

    _isVehicleTarget(target) {
        const labels = [
            target?._unitKind,
            target?.role,
            target?.category,
            target?.config?.role,
            target?.config?.category,
            target?.config?.type,
        ].filter(Boolean).map((value) => String(value).toLowerCase());
        const families = [...(target?.families || []), ...(target?.config?.families || [])]
            .filter(Boolean).map((value) => String(value).toLowerCase());
        return !!target?._isVehicle || [...labels, ...families].some((value) => (
            value.includes('vehicle') || value.includes('载具') || value.includes('机械')
        ));
    }

    _discardLauncher() {
        const m = this.m;
        this._rocketDiscarded = true;
        if (this._rocketAnimationIncludesDiscardedLauncher) {
            m._discardedLauncher = null;
            return;
        }
        const face = m._lastFaceRight === false ? -1 : 1;
        m._discardedLauncher = {
            active: true,
            x: m.x + face * 6,
            y: m.y - 4,
            z: 54,
            vx: -face * 105,
            vy: 34,
            vz: 95,
            angle: m.rotation || 0,
            spin: face * 6,
            lifeMs: 850,
            maxLifeMs: 850,
        };
    }

    _updateDiscardedLauncher(dt) {
        const launcher = this.m._discardedLauncher;
        if (!launcher?.active) return;
        const seconds = dt / 1000;
        launcher.x += launcher.vx * seconds;
        launcher.y += launcher.vy * seconds;
        launcher.z += launcher.vz * seconds;
        launcher.vz -= 260 * seconds;
        launcher.angle += launcher.spin * seconds;
        launcher.lifeMs -= dt;
        if (launcher.z < 0) {
            launcher.z = 0;
            launcher.vz = Math.abs(launcher.vz) * 0.22;
            launcher.vx *= 0.72;
            launcher.vy *= 0.72;
        }
        if (launcher.lifeMs <= 0) launcher.active = false;
    }

    _updateExplosion(dt) {
        const explosion = this.m._antiVehicleExplosion;
        if (!explosion?.active) return;
        explosion.lifeMs -= dt;
        if (explosion.lifeMs <= 0) explosion.active = false;
    }

    _resetRocketPose() {
        this._rocketSequenceActive = false;
        this._rocketDiscarded = false;
        this._rocketDiscardTimer = 0;
        this.m._attackVariant = 'smg';
    }
}
