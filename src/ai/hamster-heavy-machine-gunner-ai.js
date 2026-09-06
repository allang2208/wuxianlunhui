import { isFriendlyAttackTarget, sweepFriendlyProjectile } from '../combat/friendly-projectile-sweep.js';
import { HamsterMusketeerAI } from './hamster-musketeer-ai.js';
import { AimHelper } from '../utils/aim-helper.js';
import { SoundManager } from '../ui/sound-manager.js';
import {
    applyProjectileWallImpact,
    applyElevatedRangedRange,
    canUseWallTopModelException,
    projectileMuzzleOrigin,
    projectileTargetZ,
    projectileWallContext,
} from '../combat/elevated-ranged.js';

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
        if (!isFriendlyAttackTarget(target) || !this._canAttackFromHere(target)) return;
        this._burstSchedule = {
            elapsedMs: 0,
            rate: this.m._friendlyAttackClock?.rate || 1,
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
        const bullets = Array.isArray(this.m._machineGunProjectiles)
            ? this.m._machineGunProjectiles
            : (this.m._machineGunProjectiles = []);
        // 已在途弹飞完整帧；本帧内延迟发出的子弹只飞出膛后的剩余时间。
        for (const bullet of bullets) this._advanceBullet(bullet, dt, entities);
        const schedule = this._burstSchedule;
        if (schedule) {
            schedule.elapsedMs += dt * schedule.rate;
            while (schedule.nextIndex < this._burstDelaysMs.length
                && schedule.elapsedMs >= this._burstDelaysMs[schedule.nextIndex]) {
                const bullet = this._spawnBullet(schedule.nextIndex);
                this._advanceBullet(bullet,
                    (schedule.elapsedMs - this._burstDelaysMs[schedule.nextIndex]) / schedule.rate, entities);
                schedule.nextIndex++;
            }
            if (schedule.nextIndex >= this._burstDelaysMs.length) this._burstSchedule = null;
        }

        this.m._machineGunProjectiles = bullets.filter((bullet) => bullet.active);
    }

    _spawnBullet(index) {
        const m = this.m;
        const schedule = this._burstSchedule;
        if (!schedule) return;
        const target = schedule.target;
        // 一轮点射锁定起手方向，避免目标横穿时角色朝向与后续弹道相互翻转。
        const snapshot = schedule.snapshot;
        const origin = projectileMuzzleOrigin(m, snapshot, {
            offsetX: this.cfg.muzzleOffsetX,
            offsetY: this.cfg.muzzleOffsetY,
            height: this.cfg.muzzleHeight,
        });
        const { x: startX, y: startY, z: startZ } = origin;
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
            wallContext: projectileWallContext(m, null, origin),
            allowWallTopModelHit: canUseWallTopModelException(m),
            target,
            remainingHits: Math.max(1, Math.floor(Number(this.cfg.projectileMaxHits) || 1)),
            hitIds: new Set(),
        });

        const sound = m.sounds?.attack;
        if (sound && SoundManager?.playGunshotAt) SoundManager.playGunshotAt(sound, m.x, m.y);
        else if (sound && SoundManager?.playWorld) SoundManager.playWorld(sound, m.x, m.y);
        else if (sound && SoundManager?.playFile) SoundManager.playFile(sound);
        return bullets[bullets.length - 1];
    }

    _advanceBullet(bullet, dt, entities) {
        if (!bullet?.active) return;
        const m = this.m;
        const { events } = sweepFriendlyProjectile(m, bullet, dt, this._projectileSpeed, entities, HIT_RADIUS);
        for (const { entity: hit, wall } of events) {
            if (wall) {
                applyProjectileWallImpact(m, wall, this._attackDamage, 'physical');
                bullet.active = false;
                break;
            }
            const pierceMultiplier = Math.max(0, Math.min(1,
                Number(this.cfg.projectilePierceDamageMultiplier ?? 1)));
            const damage = this._attackDamage * Math.pow(pierceMultiplier, bullet.hitIds.size);
            bullet.hitIds.add(hit.id ?? hit);
            bullet.remainingHits--;
            hit.takeDamage?.(m.getPhysicalAttackDamage(damage, hit), m, 'physical', false);
            if (bullet.remainingHits <= 0) { bullet.active = false; break; }
        }
        if (bullet.dist >= bullet.maxDist) bullet.active = false;
    }
}
