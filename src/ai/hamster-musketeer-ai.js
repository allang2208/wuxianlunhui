import { MovementSystem } from '../systems/movement-system.js';
import { WallSystem } from '../world/wall-system.js';
import { AimHelper } from '../utils/aim-helper.js';
import { SoundManager } from '../ui/sound-manager.js';

const HIT_RADIUS = 28;

export class HamsterMusketeerAI {
    constructor(unit) {
        this.m = unit;
        this.cfg = unit.aiConfig || {};
        this._decisionTimer = 0;
        this._attackTimer = 0;
        this._attackInterval = this.cfg.attackInterval ?? 2500;
        this._attackDamage = this.cfg.attackDamage ?? 80;
        this._attackRange = this.cfg.attackRange ?? 650;
        this._engageRange = this.cfg.engageRange ?? 1000;
        this._projectileSpeed = this.cfg.projectileSpeed ?? 1248;
        this._followOffset = this.cfg.followOffset ?? 160;
        const anim = unit.animations?.attack || {};
        const fps = this.cfg.attackAnimFps ?? anim.frameRate ?? 12;
        const launchFrame = this.cfg.attackLaunchFrame ?? 10;
        this._launchDelayMs = (launchFrame - 1) / fps * 1000;
        this._shotAnimMs = (anim.frameCount || 21) / fps * 1000 + 60;
        this._shotActive = false;
        this._shotTimer = 0;
        this._shotAnimLeft = 0;
    }

    cancelForCommand() {
        this._shotActive = false;
        this.m._attackSwing = false;
        this.m._animState = 'idle';
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
            m.vx = 0; m.vy = 0; m.isMoving = false; m.maxSpeed = 0;
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
    }

    _tick(entities, player) {
        const m = this.m;
        if (this._shotActive) return;
        const cmd = m._command;
        if (cmd && cmd.mode && cmd.mode !== 'follow') {
            if (cmd.mode === 'attack' && cmd.target?.active) {
                this._engage(cmd.target);
                return;
            }
            if (cmd.mode === 'move' && cmd.point) {
                const d = Math.hypot(cmd.point.x - m.x, cmd.point.y - m.y);
                if (d > 40) {
                    m.target = null;
                    m._tacticalTarget = { ...cmd.point };
                    m._animState = 'walk';
                    m.maxSpeed = this.cfg.walkSpeed ?? 120;
                } else {
                    m._command = { mode: 'follow' };
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
        const dest = { x: player.x - this._followOffset, y: player.y };
        const d = Math.hypot(dest.x - m.x, dest.y - m.y);
        if (d > 40) {
            m._tacticalTarget = dest;
            m._animState = 'walk';
            m.maxSpeed = this.cfg.walkSpeed ?? 120;
        } else {
            m._tacticalTarget = null;
            m._animState = 'idle';
            m.vx = 0; m.vy = 0; m.isMoving = false; m.maxSpeed = 0;
            m._pathManager?._clearPath();
        }
    }

    _engage(target) {
        const m = this.m;
        m.target = target;
        const d = Math.hypot(target.x - m.x, target.y - m.y);
        if (d > this._attackRange) {
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
        let best = null, bestD = Infinity;
        const iter = entities?.values ? entities.values() : entities || [];
        for (const e of iter) {
            if (!e || !e.active || e.hp <= 0 || e._faction !== 'enemy' || e._isEnergyNode) continue;
            const d = Math.hypot(e.x - this.m.x, e.y - this.m.y);
            if (d <= this._engageRange && d < bestD) { best = e; bestD = d; }
        }
        return best;
    }

    _aimY(target) {
        if (target?._phaserSprite?.active) return target._phaserSprite.y;
        return target.y - (target.bodyHeight || 80) * 0.5;
    }

    _fireProjectile() {
        const m = this.m;
        const t = m.target;
        if (!t?.active || t.hp <= 0) return;
        const spawnY = m.y - 45;
        const aimY = this._aimY(t);
        const lead = AimHelper.lead(m.x, spawnY, t.x, aimY, t.vx || 0, t.vy || 0, this._projectileSpeed);
        const angle = Math.atan2(lead.y - spawnY, lead.x - m.x);
        m._basic = { active: true, x: m.x, y: spawnY, aimY, angle, dist: 0, maxDist: this._attackRange + 180, target: t, musketTracer: true };
        const sound = m.sounds?.attack;
        if (sound && SoundManager?.playWorld) SoundManager.playWorld(sound, m.x, m.y);
        else if (sound && SoundManager?.playFile) SoundManager.playFile(sound);
    }

    _updateProjectile(dt, entities) {
        const m = this.m;
        const b = m._basic;
        if (!b?.active) return;
        const step = this._projectileSpeed * dt / 1000;
        b.x += Math.cos(b.angle) * step;
        b.y += Math.sin(b.angle) * step;
        b.dist += step;
        let hit = null;
        for (const e of (entities?.values ? entities.values() : entities || [])) {
            if (!e || !e.active || e.hp <= 0 || e._faction !== 'enemy' || e._isEnergyNode) continue;
            if (Math.hypot(e.x - b.x, this._aimY(e) - b.y) < HIT_RADIUS) { hit = e; break; }
        }
        if (hit) {
            hit.takeDamage?.(this._attackDamage, m, 'physical', false);
            m._basic = null;
        } else if (b.dist >= b.maxDist || (WallSystem?.blocked && WallSystem.blocked(m.x, m.y - 45, b.x, b.y))) {
            m._basic = null;
        }
    }
}
