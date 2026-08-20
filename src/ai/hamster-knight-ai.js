// ============================================================
// HamsterKnightAI — 仓鼠骑士（世界-122）
// - 最近敌人近战；不攻击能源矿点。
// - 普攻 31 帧 / 1.5 秒，第 16 帧结算 100 物理伤害，间隔 2 秒。
// - 持盾冲锋复用铠甲骑士：线性加速、追踪、不可穿墙、击退/眩晕/弹反语义；
//   仅第 15~22 帧是一次性伤害窗口，冷却 15 秒。
// ============================================================
import { MovementSystem } from '../systems/movement-system.js';
import { WallSystem } from '../world/wall-system.js';
import { SoundManager } from '../ui/sound-manager.js';
import { EffectFactory } from '../utils/effect-factory.js';
import { clearRtsSurfaceRoute, resolveRtsMoveDestination } from './rts-command-utils.js';

export class HamsterKnightAI {
    constructor(knight) {
        this.m = knight;
        this.cfg = knight.aiConfig || {};
        this._decisionTimer = 0;
        this._attackTimer = 0;
        this._attackInterval = this.cfg.attackInterval ?? 2000;
        this._attackDamage = this.cfg.attackDamage ?? 100;
        this._attackRange = this.cfg.attackRange ?? 55;
        this._engageRange = this.cfg.engageRange ?? 900;
        this._followOffset = this.cfg.followOffset ?? 155;
        this._followArriveDist = this.cfg.followArriveDist ?? 40;

        const attack = knight.animations?.attack || {};
        const attackFps = this.cfg.attackAnimFps ?? attack.frameRate ?? 12;
        const attackFrame = this.cfg.attackDamageFrame ?? 16;
        this._attackHitDelay = Math.max(0, (attackFrame - 1) / attackFps * 1000);
        this._attackAnimMs = (attack.frameCount ?? 31) / attackFps * 1000 + 60;
        this._swingActive = false;
        this._swingHitLeft = 0;
        this._swingAnimLeft = 0;

        this._chargeCooldown = 0;
        this._chargeActive = false;
        this._chargeTarget = null;
        this._chargeElapsed = 0;
        this._chargeTraveled = 0;
        this._chargeDamaged = false;
        this._chargeDustTimer = 0;
        this._prevNoCollision = false;
        this._baseParryImmune = !!knight._parryImmune;

        this._stuckTimer = 0;
        this._lastPosX = knight.x;
        this._lastPosY = knight.y;
        this._stuckStreak = 0;
    }

    cancelForCommand() {
        if (this._chargeActive) this._endCharge();
        this._swingActive = false;
        this._swingHitLeft = 0;
        this._swingAnimLeft = 0;
        this.m._attackSwing = false;
        this.m._chargeStart = false;
        this.m._animState = 'idle';
        this.m.vx = 0;
        this.m.vy = 0;
        this.m.isMoving = false;
        return true;
    }

    update(dt, entities, player) {
        const m = this.m;
        if (m._dying || m.data.hp <= 0) return;

        this._attackTimer = Math.max(0, this._attackTimer - dt);
        this._chargeCooldown = Math.max(0, this._chargeCooldown - dt);

        if (this._chargeActive) {
            this._updateCharge(dt);
            return;
        }
        if (this._swingActive) {
            this._updateSwing(dt);
            return;
        }

        this._decisionTimer -= dt;
        if (this._decisionTimer <= 0) {
            this._decisionTimer = this.cfg.decisionMs ?? 120;
            this._tick(entities, player);
        }
        if (this._chargeActive || this._swingActive) return;

        MovementSystem.update(m, dt, entities);
        this._checkStuck(dt);
    }

    _tick(entities, player) {
        const m = this.m;
        const command = m._command;
        if (command?.mode && command.mode !== 'follow') {
            this._applyCommand(command);
            return;
        }

        const enemy = this._nearestEnemy(entities);
        if (enemy) {
            m.target = enemy;
            const distance = Math.hypot(enemy.x - m.x, enemy.y - m.y);
            const range = this._attackRange + (enemy.groundRadius || 24);
            const charge = this._chargeConfig();
            if (this._chargeCooldown <= 0
                && distance > (charge.minTriggerRange ?? 0)
                && distance <= (charge.triggerRange ?? 550) + (enemy.groundRadius || 24)) {
                this._startCharge(enemy);
                return;
            }
            if (distance <= range) {
                m._tacticalTarget = null;
                m.rotation = Math.atan2(enemy.y - m.y, enemy.x - m.x);
                m._lastFaceRight = enemy.x >= m.x;
                if (this._attackTimer <= 0) this._startSwing(enemy);
                else this._stopAtTarget();
                return;
            }
            m._tacticalTarget = { x: enemy.x, y: enemy.y };
            m._animState = 'walk';
            m.maxSpeed = this.cfg.walkSpeed ?? 210;
            return;
        }

        m.target = null;
        this._followPlayer(player);
    }

    _applyCommand(command) {
        const m = this.m;
        if (command.mode !== 'move') clearRtsSurfaceRoute(m);
        if (command.mode === 'move') {
            m.target = null;
            const move = resolveRtsMoveDestination(m, command);
            if (!move.arrived) {
                m._tacticalTarget = move.destination;
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 210;
            } else {
                m._command = { mode: 'follow' };
                clearRtsSurfaceRoute(m);
                this._stopAtTarget();
            }
            return;
        }
        if (command.mode === 'attack') {
            const target = command.target;
            if (!target || !target.active || target.hp <= 0 || target._isEnergyNode) {
                m._command = { mode: 'follow' };
                m.target = null;
                this._stopAtTarget();
                return;
            }
            m.target = target;
            const distance = Math.hypot(target.x - m.x, target.y - m.y);
            const range = this._attackRange + (target.groundRadius || 24);
            const charge = this._chargeConfig();
            if (this._chargeCooldown <= 0
                && distance > (charge.minTriggerRange ?? 0)
                && distance <= (charge.triggerRange ?? 550) + (target.groundRadius || 24)) {
                this._startCharge(target);
            } else if (distance <= range) {
                m.rotation = Math.atan2(target.y - m.y, target.x - m.x);
                m._lastFaceRight = target.x >= m.x;
                if (this._attackTimer <= 0) this._startSwing(target);
                else this._stopAtTarget();
            } else {
                m._tacticalTarget = { x: target.x, y: target.y };
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 210;
            }
            return;
        }
        m.target = null;
        this._stopAtTarget();
    }

    _followPlayer(player) {
        const m = this.m;
        if (!player) {
            this._stopAtTarget();
            return;
        }
        const target = { x: player.x - this._followOffset, y: player.y };
        if (Math.hypot(target.x - m.x, target.y - m.y) <= this._followArriveDist) {
            this._stopAtTarget();
            return;
        }
        m._tacticalTarget = target;
        m._animState = 'walk';
        m.maxSpeed = this.cfg.walkSpeed ?? 210;
    }

    _stopAtTarget() {
        const m = this.m;
        m._tacticalTarget = null;
        m._animState = 'idle';
        m.maxSpeed = 0;
        m.vx = 0;
        m.vy = 0;
        m.isMoving = false;
        if (m._pathManager && typeof m._pathManager._clearPath === 'function') {
            m._pathManager._clearPath();
        }
    }

    _startSwing(target) {
        const m = this.m;
        this._attackTimer = this._attackInterval;
        this._swingActive = true;
        this._swingHitLeft = this._attackHitDelay;
        this._swingAnimLeft = this._attackAnimMs;
        m.target = target;
        m._attackSwing = true;
        m._animState = 'attack';
        m.rotation = Math.atan2(target.y - m.y, target.x - m.x);
        m._lastFaceRight = target.x >= m.x;
        this._stopMotionOnly();
    }

    _updateSwing(dt) {
        const m = this.m;
        this._stopMotionOnly();
        m._animState = 'attack';
        this._swingHitLeft -= dt;
        if (this._swingHitLeft <= 0) {
            this._swingHitLeft = Number.POSITIVE_INFINITY;
            this._dealNormalHit();
        }
        this._swingAnimLeft -= dt;
        if (this._swingAnimLeft <= 0) {
            this._swingActive = false;
            m._attackSwing = false;
            m._animState = 'idle';
        }
    }

    _dealNormalHit() {
        const m = this.m;
        const target = m.target;
        if (!this._validEnemy(target) || !this._inRange(target, this._attackRange)) return;
        target.takeDamage(this._attackDamage, m, 'physical', true);
        this._playSound('attack');
    }

    _startCharge(target) {
        const m = this.m;
        const cfg = this._chargeConfig();
        this._chargeCooldown = cfg.cooldown ?? 15000;
        this._chargeActive = true;
        this._chargeTarget = target;
        this._chargeElapsed = 0;
        this._chargeTraveled = 0;
        this._chargeDamaged = false;
        this._chargeDustTimer = 0;
        this._prevNoCollision = !!m.noCollision;
        m.noCollision = true;
        m._parryImmune = true;
        m._chargeStart = true;
        m._animState = 'charge';
        m._attackAnimTimer = cfg.maxDuration ?? 4500;
        if (target?.active) {
            m.rotation = Math.atan2(target.y - m.y, target.x - m.x);
            if (Math.abs(target.x - m.x) > 20) m._lastFaceRight = target.x >= m.x;
        }
        this._stopMotionOnly();
    }

    _updateCharge(dt) {
        const m = this.m;
        const cfg = this._chargeConfig();
        const target = this._chargeTarget && this._chargeTarget.active
            ? this._chargeTarget
            : null;
        this._chargeElapsed += dt;
        const speed = (cfg.maxSpeed ?? 700) * Math.min(1, this._chargeElapsed / (cfg.accelDuration ?? 1500));
        this._chargeDustTimer -= dt;
        if (this._chargeDustTimer <= 0 && speed > 0) {
            this._chargeDustTimer = 70;
            const backX = -Math.cos(m.rotation) * 12 + (Math.random() - 0.5) * 10;
            const backY = -Math.sin(m.rotation) * 12 + (Math.random() - 0.5) * 6;
            EffectFactory.createDustEffect(m.x + backX, m.y + backY + 10, 1.2);
        }

        if (target) {
            const dx = target.x - m.x;
            const dy = target.y - m.y;
            const distance = Math.hypot(dx, dy);
            if (distance > 0) {
                m.rotation = Math.atan2(dy, dx);
                if (Math.abs(dx) > 20) m._lastFaceRight = dx > 0;
                const contact = (m.groundRadius || 0) + (target.groundRadius || target.collisionRadius || 0);
                const step = Math.min(speed * dt / 1000, Math.max(0, distance - contact));
                const resolved = WallSystem.resolve(
                    m.x,
                    m.y,
                    m.x + dx / distance * step,
                    m.y + dy / distance * step,
                    m.groundRadius,
                    WallSystem.ignoreForEntity?.(m) || null
                );
                this._chargeTraveled += Math.hypot(resolved.x - m.x, resolved.y - m.y);
                m.x = resolved.x;
                m.y = resolved.y;
            }
        }

        const fps = cfg.frameRate ?? 12;
        const hitStart = ((cfg.hitStartFrame ?? 15) - 1) / fps * 1000;
        const hitEnd = (cfg.hitEndFrame ?? 22) / fps * 1000;
        const inHitWindow = this._chargeElapsed >= hitStart && this._chargeElapsed <= hitEnd;
        if (!this._chargeDamaged && inHitWindow && this._validEnemy(target) && this._inRange(target, cfg.hitRange ?? 60)) {
            this._chargeDamaged = true;
            this._dealChargeHit(target);
        }

        if (this._chargeDamaged
            || this._chargeTraveled >= (cfg.maxDistance ?? 1800)
            || this._chargeElapsed >= (cfg.maxDuration ?? 4500)
            || !target
            || (this._chargeElapsed > hitEnd && this._inRange(target, cfg.hitRange ?? 60))) {
            this._endCharge();
        }
    }

    _dealChargeHit(target) {
        const cfg = this._chargeConfig();
        const upgradeMult = Math.max(0, Number(this.cfg.chargeDamageMult) || 1);
        target.takeDamage(
            Math.max(1, Math.round(this._attackDamage * (cfg.damageMul ?? 2) * upgradeMult)),
            this.m,
            'physical',
            true,
        );
        const parried = !!target.shieldSystem?._lastParried;
        const angle = Math.atan2(target.y - this.m.y, target.x - this.m.x);
        if (typeof target.applyKnockback === 'function') target.applyKnockback(angle, cfg.knockback ?? 200);
        if (!parried && typeof target.applyStun === 'function') target.applyStun(cfg.stunMs ?? 2500);
    }

    _endCharge() {
        const m = this.m;
        this._chargeActive = false;
        this._chargeTarget = null;
        this._chargeTraveled = 0;
        this._chargeDamaged = false;
        m._parryImmune = this._baseParryImmune;
        m.noCollision = this._prevNoCollision;
        m._chargeStart = false;
        m._attackAnimTimer = 0;
        m._animState = 'idle';
        this._stopMotionOnly();
    }

    _chargeConfig() {
        return this.cfg.charge || {};
    }

    _nearestEnemy(entities) {
        let best = null;
        let bestDistance = Infinity;
        const iterable = entities?.values ? entities.values() : entities || [];
        for (const entity of iterable) {
            if (!this._validEnemy(entity)) continue;
            const distance = Math.hypot(entity.x - this.m.x, entity.y - this.m.y);
            if (distance < bestDistance && distance <= this._engageRange) {
                best = entity;
                bestDistance = distance;
            }
        }
        return best;
    }

    _validEnemy(entity) {
        return !!(entity && entity.active && entity.hp > 0
            && entity._faction === 'enemy' && !entity._isEnergyNode);
    }

    _inRange(target, range) {
        if (!target) return false;
        const targetRadius = target.groundRadius || target.collisionRadius || target.size * 0.6 || 0;
        return Math.hypot(target.x - this.m.x, target.y - this.m.y) <= range + targetRadius;
    }

    _playSound(key) {
        const path = this.m.sounds?.[key];
        if (!path || !SoundManager) return;
        if (typeof SoundManager.playWorld === 'function') SoundManager.playWorld(path, this.m.x, this.m.y);
        else if (typeof SoundManager.playFile === 'function') SoundManager.playFile(path);
    }

    _stopMotionOnly() {
        this.m.vx = 0;
        this.m.vy = 0;
        this.m.isMoving = false;
        this.m.maxSpeed = 0;
    }

    _checkStuck(dt) {
        const m = this.m;
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
        const safe = WallSystem.findSafeSpawn?.(m.x, m.y, m.groundRadius || 24);
        if (safe && Math.hypot(safe.x - m.x, safe.y - m.y) > 5) {
            m.x = safe.x;
            m.y = safe.y;
        }
        m.target = null;
        m._tacticalTarget = null;
        m._pathManager?._clearPath?.();
    }
}
