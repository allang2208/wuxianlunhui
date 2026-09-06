import { advanceFriendlyAttackClock } from '../combat/friendly-attack-timing.js';
import { HamsterScoutAI } from './hamster-scout-ai.js';
import { MovementSystem } from '../systems/movement-system.js';
import { WallSystem } from '../world/wall-system.js';
import { projectileWallContext, applyProjectileWallImpact } from '../combat/elevated-ranged.js';
import { queryNearbyEntities } from './friendly-spatial-query.js';
import { EffectFactory } from '../utils/effect-factory.js';

const validEnemy = (target) => target?.active && target.hp > 0
    && target._faction === 'enemy' && !target._isEnergyNode;

/** 复用斥候的 RTS/索敌/寻路，只替换一次性动作时钟与抛射石弹。 */
export class HamsterCatapultCrewAI extends HamsterScoutAI {
    constructor(unit) {
        super(unit);
        const attack = unit.animations.attack;
        this._shotAnimMs = attack.durationMs;
        this._launchDelayMs = attack.frameDurations.slice(0, this.cfg.attackReleaseFrame)
            .reduce((sum, ms) => sum + ms, 0);
        this._released = false;
        this._shotTarget = null;
        this._attackSoundCursor = 0;
    }

    cancelForCommand() {
        super.cancelForCommand();
        this._attackSoundCursor = 0;
        this._released = true;
        this._shotTarget = null;
        this.m.setAnimationClock('idle', 0);
    }

    update(dt, entities, player) {
        const m = this.m;
        this._attackTimer = Math.max(0, this._attackTimer - dt);
        this._updateProjectile(dt, entities);
        if (m._dying || m.hp <= 0) return;
        if (!this._shotActive && MovementSystem.continueStairTransit?.(m, dt, entities)) {
            m.advanceAnimationClock('walk', dt);
            return;
        }
        const wasShooting = this._shotActive;
        this._decisionTimer -= dt;
        if (this._decisionTimer <= 0) {
            this._decisionTimer = this.cfg.decisionMs ?? 120;
            this._tick(entities, player);
        }
        if (this._shotActive) {
            if (!wasShooting) {
                this._released = false;
                this._attackSoundCursor = 0;
                this._shotTarget = m.target;
                m._catapultFaceRight = m._lastFaceRight !== false;
                m.setAnimationClock('attack', 0);
            } else {
                const actionDt = advanceFriendlyAttackClock(m, dt);
                this._shotAnimLeft = Math.max(0, this._shotAnimLeft - actionDt);
                m.setAnimationClock('attack', this._shotAnimMs - this._shotAnimLeft);
            }
            m.vx = 0; m.vy = 0; m.maxSpeed = 0; m.isMoving = false;
            if (!this._released && m._catapultElapsedMs >= this._launchDelayMs) {
                this._released = true; // 先消费事件，再执行可能触发同步伤害回调的逻辑。
                this._fireProjectile();
            }
            // 退壳/装填是一次性动作事件；中断、死亡后不会继续播放排队声音。
            const soundEvents = this.cfg.attackSoundEvents || [];
            while (this._attackSoundCursor < soundEvents.length
                && m._catapultElapsedMs >= soundEvents[this._attackSoundCursor].atMs) {
                const event = soundEvents[this._attackSoundCursor++];
                this._playSound(event.key);
            }
            if (this._shotAnimLeft <= 0) {
                this._shotActive = false;
                m._attackSwing = false;
                m.setAnimationClock('idle', 0);
            }
            return;
        }
        MovementSystem.update(m, dt, entities);
        this._checkStuck(dt);
        if (m._animState === 'idle' && Math.hypot(m.vx || 0, m.vy || 0) > 25) m._animState = 'walk';
        m.advanceAnimationClock(m._animState === 'walk' ? 'walk' : 'idle', dt);
    }

    _origin(faceRight) {
        const m = this.m;
        const render = m.config.render;
        const scale = m.displaySize / 512;
        return { x: m.x + (faceRight ? 1 : -1) * render.projectileReleaseOffsetX * scale,
            y: m.y, z: (m.z || 0) + render.projectileReleaseHeight * scale };
    }

    _tick(entities, player) {
        super._tick(entities, player);
        const m = this.m;
        if (this._shotActive || !validEnemy(m.target)
            || ['move', 'hold'].includes(m._command?.mode)) return;
        const dx = m.x - m.target.x;
        const dy = m.y - m.target.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= this.cfg.minimumRange) return;
        // 投石机不能向已越过离勺点的近身目标倒抛；走既有寻路后撤展开。
        const retreat = this.cfg.minimumRange - distance + 48;
        const nx = distance > 0.01 ? dx / distance : (m._lastFaceRight === false ? 1 : -1);
        const ny = distance > 0.01 ? dy / distance : 0;
        m._tacticalTarget = { x: m.x + nx * retreat, y: m.y + ny * retreat };
        m._animState = 'walk';
        m.maxSpeed = this.cfg.walkSpeed;
    }

    _planShot(target, faceRight, predict = true) {
        const m = this.m;
        const origin = this._origin(faceRight);
        const range = this._effectiveAttackRange();
        const initialDistance = Math.hypot(target.x - origin.x, target.y - origin.y);
        let durationMs = Math.max(500, Math.min(1600,
            initialDistance / this._projectileSpeed * 1000));
        let tx = target.x + (predict ? (target.vx || 0) * durationMs / 1000 : 0);
        let ty = target.y + (predict ? (target.vy || 0) * durationMs / 1000 : 0);
        const leadDistance = Math.hypot(tx - m.x, ty - m.y);
        if (leadDistance > range) {
            tx = m.x + (tx - m.x) * range / leadDistance;
            ty = m.y + (ty - m.y) * range / leadDistance;
        }
        // 预判和射程夹紧会改变实际落点；飞行时间必须按“离勺点→最终落点”重算，
        // 不能继续使用单位脚点到旧目标的距离，否则同一石弹会出现忽快忽慢的非匀速横移。
        durationMs = Math.max(500, Math.min(1600,
            Math.hypot(tx - origin.x, ty - origin.y) / this._projectileSpeed * 1000));
        return { ...origin, origin, tx, ty, targetZ: Number(target.z) || 0,
            durationMs, elapsedMs: 0, arcHeight: this.cfg.arcHeight,
            wallContext: projectileWallContext(m, null, origin) };
    }

    _point(shot, t) {
        return { x: shot.origin.x + (shot.tx - shot.origin.x) * t,
            y: shot.origin.y + (shot.ty - shot.origin.y) * t,
            z: shot.origin.z + (shot.targetZ - shot.origin.z) * t + shot.arcHeight * 4 * t * (1 - t) };
    }

    _wallHit(from, to, context) {
        return WallSystem.projectileWallHit?.(from.x, from.y, from.z, to.x, to.y, to.z, context);
    }

    _canShootTarget(target) {
        if (!validEnemy(target)) return false;
        if (Math.hypot(target.x - this.m.x, target.y - this.m.y) < this.cfg.minimumRange) return false;
        const shot = this._planShot(target, target.x >= this.m.x, false);
        let previous = shot.origin;
        // 按真实高度检查抛物线，不能用地面直线 LOS 把越墙弧线判为不可射击。
        for (let i = 1; i <= 16; i++) {
            const next = this._point(shot, i / 16);
            if (this._wallHit(previous, next, shot.wallContext)) return false;
            previous = next;
        }
        return true;
    }

    _fireProjectile() {
        const m = this.m;
        const target = this._shotTarget;
        if (!validEnemy(target) || Math.hypot(target.x - m.x, target.y - m.y) > this._effectiveAttackRange()) return;
        if (Math.hypot(target.x - m.x, target.y - m.y) < this.cfg.minimumRange) return;
        // 摆臂过程中不镜像整组；目标绕到另一侧时这次放空，下次重新瞄准。
        if ((target.x >= m.x) !== m._catapultFaceRight) return;
        m._basic = { ...this._planShot(target, m._catapultFaceRight), active: true,
            catapultStone: true, angle: 0, visualAngle: 0, damage: this._attackDamage };
        this._playSound('attack');
    }

    _updateProjectile(dt, entities) {
        const m = this.m;
        const shot = m._basic;
        if (!shot?.active) return;
        const endMs = Math.min(shot.durationMs, shot.elapsedMs + Math.max(0, dt));
        // 低帧率时仍分段扫过弧线，避免一次大步穿过墙顶。
        while (shot.active && shot.elapsedMs < endMs) {
            const previous = { x: shot.x, y: shot.y, z: shot.z };
            shot.elapsedMs = Math.min(endMs, shot.elapsedMs + shot.durationMs / 32);
            const next = this._point(shot, shot.elapsedMs / shot.durationMs);
            Object.assign(shot, next);
            const wallHit = this._wallHit(previous, next, shot.wallContext);
            if (wallHit) {
                shot.active = false;
                m._basic = null;
                applyProjectileWallImpact(m, wallHit, m.getPhysicalAttackDamage(shot.damage), 'physical');
                return;
            }
        }
        shot.visualAngle = shot.elapsedMs / shot.durationMs * Math.PI * 2;
        if (shot.elapsedMs >= shot.durationMs) this._impact(shot, entities);
    }

    _impact(shot, entities) {
        const m = this.m;
        shot.active = false;
        m._basic = null;
        const radius = this.cfg.splashRadius;
        for (const enemy of queryNearbyEntities(entities, shot, radius + 96)) {
            if (!validEnemy(enemy)) continue;
            const distance = Math.hypot(enemy.x - shot.x, enemy.y - shot.y);
            if (distance > radius + (Number(enemy.collisionRadius) || 0)) continue;
            const bottom = enemy.collider?.bottomZ ?? (Number(enemy.z) || 0);
            const top = enemy.collider?.topZ ?? bottom + (enemy.bodyHeight || 80);
            if (shot.z < bottom - 24 || shot.z > top + 24) continue;
            const from = { x: shot.x, y: shot.y, z: shot.z + 12 };
            const to = { x: enemy.x, y: enemy.y, z: bottom + 12 };
            // 落点遮挡独立检查，不继承发射者墙顶的“忽略承托墙”集合。
            if (this._wallHit(from, to, projectileWallContext(null, null, from))) continue;
            const falloff = 1 - Math.min(1, distance / radius) * this.cfg.splashFalloff;
            enemy.takeDamage?.(m.getPhysicalAttackDamage(shot.damage * falloff, enemy), m, 'physical', false);
        }
        EffectFactory.createDustEffect(shot.x, shot.y - shot.z, 1.5);
    }
}
