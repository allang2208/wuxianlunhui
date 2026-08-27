import { HamsterMusketeerAI } from './hamster-musketeer-ai.js';
import { WallSystem } from '../world/wall-system.js';
import { AimHelper } from '../utils/aim-helper.js';
import { SoundManager } from '../ui/sound-manager.js';
import {
    applyProjectileWallImpact,
    applyElevatedRangedRange,
    canUseWallTopModelException,
    projectileSourceZ,
    projectileTargetZ,
    projectileWallContext,
    wallHitSupportsTarget,
} from '../combat/elevated-ranged.js';
import { queryNearbyEntities } from './friendly-spatial-query.js';

const HIT_RADIUS = 28;

/**
 * 重机枪专属弹链：复用火枪 AI 的寻敌、LOS、RTS 与攻击状态机，
 * 在一段攻击动画内按配置帧发射三枚独立曳光弹。每枚弹丸可贯穿两个目标。
 */
export class HamsterHeavyMachineGunnerAI extends HamsterMusketeerAI {
    constructor(unit) {
        super(unit);
        const fps = this.cfg.attackAnimFps ?? unit.animations?.attack?.frameRate ?? 24;
        const launchFrames = Array.isArray(this.cfg.attackLaunchFrames)
            ? this.cfg.attackLaunchFrames.map(Number).filter(Number.isFinite)
            : [this.cfg.attackLaunchFrame ?? 23];
        const firstFrame = launchFrames[0] || 1;
        this._burstDelaysMs = launchFrames.map((frame) => Math.max(0, (frame - firstFrame) / fps * 1000));
        this._burstSchedule = null;
        this._bulletSerial = 0;
    }

    cancelForCommand() {
        super.cancelForCommand();
        this._burstSchedule = null;
    }

    _fireProjectile() {
        const target = this.m.target;
        if (!target?.active || target.hp <= 0 || !this._canShootTarget(target)) return;
        this._burstSchedule = {
            elapsedMs: 0,
            nextIndex: 1,
            target,
            snapshot: {
                x: target.x,
                y: target.y,
                vx: target.vx || 0,
                vy: target.vy || 0,
                z: projectileTargetZ(target),
            },
        };
        this._spawnBullet(0);
    }

    _updateProjectile(dt, entities) {
        const schedule = this._burstSchedule;
        if (schedule) {
            schedule.elapsedMs += dt;
            while (schedule.nextIndex < this._burstDelaysMs.length
                && schedule.elapsedMs >= this._burstDelaysMs[schedule.nextIndex]) {
                this._spawnBullet(schedule.nextIndex);
                schedule.nextIndex++;
            }
            if (schedule.nextIndex >= this._burstDelaysMs.length) this._burstSchedule = null;
        }

        const bullets = Array.isArray(this.m._machineGunProjectiles)
            ? this.m._machineGunProjectiles
            : (this.m._machineGunProjectiles = []);
        for (const bullet of bullets) this._advanceBullet(bullet, dt, entities);
        this.m._machineGunProjectiles = bullets.filter((bullet) => bullet.active);
    }

    _spawnBullet(index) {
        const m = this.m;
        const schedule = this._burstSchedule;
        if (!schedule) return;
        const target = schedule.target;
        // 一轮点射锁定起手方向，避免目标横穿时角色朝向与后续弹道相互翻转。
        const snapshot = schedule.snapshot;
        const faceSign = snapshot.x >= m.x ? 1 : -1;
        const startX = m.x + faceSign * (Number(this.cfg.muzzleOffsetX) || 0);
        const startY = m.y + (Number(this.cfg.muzzleOffsetY) || 0);
        const configuredMuzzleHeight = Number(this.cfg.muzzleHeight);
        const startZ = Number.isFinite(configuredMuzzleHeight)
            ? (Number(m.z) || 0) + configuredMuzzleHeight
            : projectileSourceZ(m);
        const lead = AimHelper.lead(
            startX, startY, snapshot.x, snapshot.y,
            snapshot.vx, snapshot.vy, this._projectileSpeed
        );
        const spread = Math.max(0, Number(this.cfg.burstSpreadDegrees) || 0) * Math.PI / 180;
        const spreadPattern = [0, -0.5, 0.5, -1, 1];
        const spreadOffset = (spreadPattern[index % spreadPattern.length] || 0) * spread;
        const angle = Math.atan2(lead.y - startY, lead.x - startX) + spreadOffset;
        const targetDist = Math.max(1, Math.hypot(lead.x - startX, lead.y - startY));
        const targetZ = Number(snapshot.z) || 0;
        const bullets = Array.isArray(m._machineGunProjectiles)
            ? m._machineGunProjectiles
            : (m._machineGunProjectiles = []);
        bullets.push({
            id: ++this._bulletSerial,
            active: true,
            x: startX,
            y: startY,
            z: startZ,
            vz: (targetZ - startZ) / Math.max(0.001, targetDist / this._projectileSpeed),
            angle,
            visualAngle: Math.atan2((lead.y - targetZ) - (startY - startZ), lead.x - startX)
                + spreadOffset,
            dist: 0,
            maxDist: applyElevatedRangedRange(m, this._attackRange + 180),
            wallContext: projectileWallContext(m, null, { x: startX, y: startY, z: startZ }),
            target,
            remainingHits: Math.max(1, Math.floor(Number(this.cfg.projectileMaxHits) || 1)),
            hitIds: new Set(),
        });

        const sound = m.sounds?.attack;
        if (sound && SoundManager?.playGunshotAt) SoundManager.playGunshotAt(sound, m.x, m.y);
        else if (sound && SoundManager?.playWorld) SoundManager.playWorld(sound, m.x, m.y);
        else if (sound && SoundManager?.playFile) SoundManager.playFile(sound);
    }

    _advanceBullet(bullet, dt, entities) {
        if (!bullet?.active) return;
        const m = this.m;
        const step = this._projectileSpeed * dt / 1000;
        const prevX = bullet.x;
        const prevY = bullet.y;
        const prevZ = Number(bullet.z) || 0;
        bullet.x += Math.cos(bullet.angle) * step;
        bullet.y += Math.sin(bullet.angle) * step;
        bullet.z = prevZ + (Number(bullet.vz) || 0) * dt / 1000;
        bullet.dist += step;

        const wallHit = WallSystem.projectileWallHit?.(
            prevX, prevY, prevZ, bullet.x, bullet.y, bullet.z,
            bullet.wallContext || projectileWallContext(m)
        );
        let hit = null;
        const hitKey = (entity) => entity?.id ?? entity;
        for (const entity of queryNearbyEntities(entities, bullet, HIT_RADIUS + 64)) {
            if (!entity || !entity.active || entity.hp <= 0 || entity._faction !== 'enemy'
                || entity._isEnergyNode || bullet.hitIds.has(hitKey(entity))) continue;
            const bottom = entity.collider?.bottomZ ?? (Number(entity.z) || 0);
            const top = entity.collider?.topZ ?? (bottom + (entity.bodyHeight || entity.size || 80));
            if (Math.hypot(entity.x - bullet.x, entity.y - bullet.y) < HIT_RADIUS
                && bullet.z >= bottom - HIT_RADIUS && bullet.z <= top + HIT_RADIUS) {
                hit = entity;
                break;
            }
        }

        const modelHitThroughSupport = wallHit
            && canUseWallTopModelException(m)
            && hit
            && wallHitSupportsTarget(wallHit, hit);
        if (wallHit && !modelHitThroughSupport) {
            applyProjectileWallImpact(m, wallHit, this._attackDamage, 'physical');
            bullet.active = false;
            return;
        }
        if (hit) {
            const maxHits = Math.max(1, Math.floor(Number(this.cfg.projectileMaxHits) || 1));
            const completedHits = Math.max(0, maxHits - Math.max(1, Number(bullet.remainingHits) || 1));
            const pierceMultiplier = Math.max(0, Math.min(1,
                Number(this.cfg.projectilePierceDamageMultiplier) || 1));
            const damage = this._attackDamage * Math.pow(pierceMultiplier, completedHits);
            hit.takeDamage?.(m.getPhysicalAttackDamage(damage, hit), m, 'physical', false);
            bullet.hitIds.add(hitKey(hit));
            bullet.remainingHits = Math.max(0, (Number(bullet.remainingHits) || 1) - 1);
            if (bullet.remainingHits <= 0) bullet.active = false;
        } else if (bullet.dist >= bullet.maxDist) {
            bullet.active = false;
        }
    }
}
