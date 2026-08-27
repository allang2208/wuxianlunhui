import { MovementSystem } from '../systems/movement-system.js';
import { WallSystem } from '../world/wall-system.js';
import { AimHelper } from '../utils/aim-helper.js';
import { SoundManager } from '../ui/sound-manager.js';
import { clearRtsSurfaceRoute, finishRtsCommandAtHold, resolveRtsMoveDestination, RTS_DEFAULT_ACQUIRE_RANGE } from './rts-command-utils.js';
import {
    applyProjectileWallImpact,
    applyElevatedRangedRange,
    canUseWallTopModelException,
    projectileSourceZ,
    projectileTargetZ,
    projectileWallContext,
    wallHitSupportsTarget,
} from '../combat/elevated-ranged.js';
import { hasRangedLineOfSight } from '../combat/ranged-line-of-sight.js';
import { tryApplyMarkArrow } from '../combat/mark-arrow-effect.js';
import { queryNearbyEntities, stableAiPhase } from './friendly-spatial-query.js';

const HIT_RADIUS = 28;

export class HamsterMusketeerAI {
    constructor(unit) {
        this.m = unit;
        this.cfg = unit.aiConfig || {};
        this._decisionTimer = stableAiPhase(unit, this.cfg.decisionMs ?? 120);
        this._attackTimer = 0;
        this._attackInterval = this.cfg.attackInterval ?? 2500;
        this._attackDamage = this.cfg.attackDamage ?? 80;
        this._attackRange = this.cfg.attackRange ?? 650;
        this._engageRange = RTS_DEFAULT_ACQUIRE_RANGE;
        this._projectileSpeed = this.cfg.projectileSpeed ?? 1248;
        this._followOffset = this.cfg.followOffset ?? 160;
        const anim = unit.animations?.attack || {};
        const fps = this.cfg.attackAnimFps ?? anim.frameRate ?? 12;
        const launchFrame = this.cfg.attackLaunchFrame ?? 19;
        this._launchDelayMs = (launchFrame - 1) / fps * 1000;
        this._shotAnimMs = this.cfg.attackAnimDurationMs
            ?? ((anim.frameCount || 21) / fps * 1000 + 60);
        this._shotActive = false;
        this._shotTimer = 0;
        this._shotAnimLeft = 0;
        this._stuckTimer = 0;
        this._lastPosX = unit.x;
        this._lastPosY = unit.y;
        this._stuckStreak = 0;
    }

    cancelForCommand() {
        this._shotActive = false;
        this.m._attackSwing = false;
        this.m._animState = 'idle';
    }

    _effectiveAttackRange() {
        return applyElevatedRangedRange(this.m, this._attackRange);
    }

    _canShootTarget(target) {
        return hasRangedLineOfSight(this.m, target);
    }

    update(dt, entities, player) {
        const m = this.m;
        if (m.data.hp <= 0 || m._dying) return;
        this._attackTimer = Math.max(0, this._attackTimer - dt);
        this._updateProjectile(dt, entities);
        this._decisionTimer -= dt;
        if (this._decisionTimer <= 0) {
            this._decisionTimer = this.cfg.decisionMs ?? 120;
            this._tick(entities, player);
        }
        if (this._shotActive) {
            // 平滑站定：速度指数衰减（≈0.85/帧），代替瞬时清零的急停
            const damp = Math.pow(0.85, dt / 16.67);
            m.vx *= damp;
            m.vy *= damp;
            if (Math.abs(m.vx) < 1 && Math.abs(m.vy) < 1) { m.vx = 0; m.vy = 0; }
            m.isMoving = false; m.maxSpeed = 0;
            m._animState = 'attack';
            this._shotTimer -= dt;
            if (this._shotTimer <= 0) {
                this._fireProjectile();
                this._shotTimer = Infinity;
            }
            this._shotAnimLeft -= dt;
            if (this._shotAnimLeft <= 0) {
                this._shotActive = false;
                m._attackSwing = false;
                m._animState = 'idle';
            }
            return;
        }
        if (m._animState === 'attack') m._animState = 'idle';
        MovementSystem.update(m, dt, entities);
        this._checkStuck(dt);
        // 缓停滑行（maxSpeed=0 后速度沿摩擦/加速度渐近归零）期间保持 walk 动画，
        // 避免站着播 idle 却还在滑行的"滑冰"感
        if (m._animState === 'idle' && Math.hypot(m.vx || 0, m.vy || 0) > 25) {
            m._animState = 'walk';
        }
    }

    _tick(entities, player) {
        const m = this.m;
        if (this._shotActive) return;
        const cmd = m._command;
        if (cmd && cmd.mode && cmd.mode !== 'follow') {
            if (cmd.mode !== 'move' && !m._surfaceNavCommand) clearRtsSurfaceRoute(m);
            if (cmd.mode === 'attack') {
                if (!cmd.target?.active || cmd.target.hp <= 0 || cmd.target._isEnergyNode) {
                    finishRtsCommandAtHold(m);
                    m.target = null;
                    m._tacticalTarget = null;
                    m._animState = 'idle';
                    m.maxSpeed = 0;
                    return;
                }
                this._engage(cmd.target);
                return;
            }
            if (cmd.mode === 'move' && cmd.point) {
                const move = resolveRtsMoveDestination(m, cmd);
                if (!move.arrived) {
                    m.target = null;
                    m._tacticalTarget = move.destination;
                    m._animState = 'walk';
                    m.maxSpeed = this.cfg.walkSpeed ?? 120;
                } else {
                    finishRtsCommandAtHold(m);
                    clearRtsSurfaceRoute(m);
                }
                return;
            }
            m.target = null; m._tacticalTarget = null; m._animState = 'idle'; m.maxSpeed = 0;
            return;
        }
        const enemy = this._nearestEnemy(entities);
        if (enemy) {
            this._engage(enemy);
            return;
        }
        m.target = null;
        if (!player) return;
        const dest = { x: player.x - this._followOffset, y: player.y, _surfaceTarget: player };
        const d = Math.hypot(dest.x - m.x, dest.y - m.y);
        if (d > 40) {
            m._tacticalTarget = dest;
            m._animState = 'walk';
            // 接近站位点缓出减速（120px 内速度随距离线性衰减，ease-out 到达）
            const walkSpeed = this.cfg.walkSpeed ?? 120;
            const slow = Math.min(1, d / 120);
            m.maxSpeed = walkSpeed * Math.max(0.3, slow);
        } else {
            m._tacticalTarget = null;
            m._animState = 'idle';
            // 速度不清零，由 MovementSystem 摩擦衰减缓停
            m.maxSpeed = 0;
            m._pathManager?._clearPath();
        }
    }

    _engage(target) {
        const m = this.m;
        m.target = target;
        const d = Math.hypot(target.x - m.x, target.y - m.y);
        if (d > this._effectiveAttackRange() || !this._canShootTarget(target)) {
            m._tacticalTarget = { x: target.x, y: target.y };
            m._animState = 'walk';
            m.maxSpeed = this.cfg.walkSpeed ?? 120;
            return;
        }
        m._tacticalTarget = null;
        m.maxSpeed = 0;
        m.rotation = Math.atan2(target.y - m.y, target.x - m.x);
        m._lastFaceRight = target.x >= m.x;
        if (this._attackTimer <= 0) {
            this._attackTimer = this._attackInterval;
            this._shotActive = true;
            this._shotTimer = this._launchDelayMs;
            this._shotAnimLeft = this._shotAnimMs;
            m._animState = 'attack';
            m._attackSwing = true;
        }
    }

    _nearestEnemy(entities) {
        const m = this.m;
        let best = null, bestD = Infinity;
        let bestShootable = null, bestShootableD = Infinity;
        const attackRange = this._effectiveAttackRange();
        const iter = queryNearbyEntities(entities, m, this._engageRange);
        for (const e of iter) {
            if (!e || !e.active || e.hp <= 0 || e._faction !== 'enemy' || e._isEnergyNode) continue;
            const d = Math.hypot(e.x - this.m.x, e.y - this.m.y);
            if (d <= this._engageRange && d < bestD) { best = e; bestD = d; }
            if (d <= attackRange && d < bestShootableD && this._canShootTarget(e)) {
                bestShootable = e;
                bestShootableD = d;
            }
        }
        return bestShootable || best;
    }

    _aimY(target) {
        if (target?._phaserSprite?.active) return target._phaserSprite.y;
        return target.y - (target.bodyHeight || 80) * 0.5;
    }

    _fireProjectile() {
        const m = this.m;
        const t = m.target;
        if (!t?.active || t.hp <= 0) return;
        if (!this._canShootTarget(t)) return;
        const faceSign = t.x >= m.x ? 1 : -1;
        const startX = m.x + faceSign * (Number(this.cfg.muzzleOffsetX) || 0);
        const startY = m.y + (Number(this.cfg.muzzleOffsetY) || 0);
        const configuredMuzzleHeight = Number(this.cfg.muzzleHeight);
        const startZ = Number.isFinite(configuredMuzzleHeight)
            ? (Number(m.z) || 0) + configuredMuzzleHeight
            : projectileSourceZ(m);
        const targetZ = projectileTargetZ(t);
        const lead = AimHelper.lead(
            startX,
            startY,
            t.x,
            t.y,
            t.vx || 0,
            t.vy || 0,
            this._projectileSpeed
        );
        const angle = Math.atan2(lead.y - startY, lead.x - startX);
        const targetDist = Math.max(1, Math.hypot(lead.x - startX, lead.y - startY));
        const visualAngle = Math.atan2(
            (lead.y - targetZ) - (startY - startZ),
            lead.x - startX
        );
        m._basic = {
            active: true,
            x: startX,
            y: startY,
            z: startZ,
            vz: (targetZ - startZ)
                / Math.max(0.001, targetDist / this._projectileSpeed),
            angle,
            visualAngle,
            dist: 0,
            maxDist: applyElevatedRangedRange(m, this._attackRange + 180),
            wallContext: projectileWallContext(m, null, { x: startX, y: startY, z: startZ }),
            target: t,
            musketTracer: true,
        };
        const sound = m.sounds?.attack;
        if (sound && SoundManager?.playGunshotAt) SoundManager.playGunshotAt(sound, m.x, m.y);
        else if (sound && SoundManager?.playWorld) SoundManager.playWorld(sound, m.x, m.y);
        else if (sound && SoundManager?.playFile) SoundManager.playFile(sound);
    }

    _updateProjectile(dt, entities) {
        const m = this.m;
        const b = m._basic;
        if (!b?.active) return;
        const step = this._projectileSpeed * dt / 1000;
        const prevX = b.x;
        const prevY = b.y;
        const prevZ = Number(b.z) || 0;
        b.x += Math.cos(b.angle) * step;
        b.y += Math.sin(b.angle) * step;
        b.z = prevZ + (Number(b.vz) || 0) * dt / 1000;
        b.dist += step;
        const wallHit = WallSystem.projectileWallHit?.(
            prevX,
            prevY,
            prevZ,
            b.x,
            b.y,
            b.z,
            b.wallContext || projectileWallContext(m)
        );
        let hit = null;
        for (const e of queryNearbyEntities(entities, b, HIT_RADIUS + 64)) {
            if (!e || !e.active || e.hp <= 0 || e._faction !== 'enemy' || e._isEnergyNode) continue;
            const bottom = e.collider?.bottomZ ?? (Number(e.z) || 0);
            const top = e.collider?.topZ ?? (bottom + (e.bodyHeight || e.size || 80));
            if (Math.hypot(e.x - b.x, e.y - b.y) < HIT_RADIUS
                && b.z >= bottom - HIT_RADIUS
                && b.z <= top + HIT_RADIUS) {
                hit = e;
                break;
            }
        }
        const modelHitThroughSupport = wallHit
            && canUseWallTopModelException(m)
            && hit
            && wallHitSupportsTarget(wallHit, hit);
        if (wallHit && !modelHitThroughSupport) {
            applyProjectileWallImpact(m, wallHit, this._attackDamage, 'physical');
            m._basic = null;
            return;
        }
        if (hit) {
            hit.takeDamage?.(m.getPhysicalAttackDamage(this._attackDamage, hit), m, 'physical', false);
            if (m._isHamsterBountyHunter) tryApplyMarkArrow(hit);
            m._basic = null;
        } else if (b.dist >= b.maxDist) {
            m._basic = null;
        }
    }

    _checkStuck(dt) {
        const m = this.m;
        if (m._surfaceNavWaiting || m._surfaceRouteActive
            || m._surfaceKind === 'stairs' || m._surfaceKind === 'wall_walk') {
            this._stuckTimer = 0;
            this._stuckStreak = 0;
            this._lastPosX = m.x;
            this._lastPosY = m.y;
            return;
        }
        if (m._animState !== 'walk') {
            this._stuckTimer = 0;
            this._lastPosX = m.x;
            this._lastPosY = m.y;
            return;
        }
        this._stuckTimer += dt;
        if (this._stuckTimer < 500) return;
        this._stuckTimer = 0;
        const moved = Math.hypot(m.x - this._lastPosX, m.y - this._lastPosY);
        this._lastPosX = m.x;
        this._lastPosY = m.y;
        if (moved > 3) {
            this._stuckStreak = 0;
            return;
        }
        this._stuckStreak++;
        if (this._stuckStreak < 2) return;
        this._stuckStreak = 0;
        // 不再使用 findSafeSpawn 改写运行中坐标；保留目标，让统一寻路重新规划。
        m._pathManager?._clearPath?.();
    }
}
