import { MovementSystem } from '../systems/movement-system.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { LightningBoltEffect } from '../effects/lightning-bolt.js';
import { IceSpikeSystem } from '../entities/components/ice-spike-system.js';
import { FireballSystem } from '../entities/components/fireball-system.js';
import { hasRangedLineOfSight } from '../combat/ranged-line-of-sight.js';

export class JunglePriestAI {
    constructor(priest) {
        this.m = priest;
        this.cfg = priest.aiConfig || {};
        this._cooldown = 0;
        this._spellIndex = 0;
        this._iceSpike = new IceSpikeSystem(priest);
        this._fireball = new FireballSystem(priest);
        this._castActive = false;
        this._releaseDone = false;
        this._pendingTarget = null;
        this._pendingSpell = -1;
        this._releaseLeft = 0;
        this._castAnimLeft = 0;
    }
    cancelForCommand() { return !this._castActive; }
    applyUpgrades(patch = {}) {
        if (patch.attackDamage) this.cfg.attackDamage = patch.attackDamage;
        if (patch.attackInterval) this.cfg.attackInterval = patch.attackInterval;
        if (patch.castRange) this.cfg.castRange = patch.castRange;
        if (patch.walkSpeed) this.cfg.walkSpeed = patch.walkSpeed;
    }
    update(dt, entities, player) {
        const m = this.m;
        this._iceSpike.update(dt, entities);
        this._fireball.update(dt, entities);
        this._cooldown = Math.max(0, this._cooldown - dt);
        if (this._castActive) {
            this._updateCast(dt);
            return;
        }
        const command = m._command;
        if (command?.mode === 'hold') { this._stop(dt); return; }
        const target = command?.mode === 'attack' && command.target?.active
            ? command.target : this._nearestEnemy(entities);
        if (target) {
            const distance = Math.hypot(target.x - m.x, target.y - m.y);
            if (distance <= (this.cfg.castRange || 650) && this._cooldown <= 0) {
                this._startCast(target, dt); return;
            }
            m._tacticalTarget = { x: target.x, y: target.y };
            m.maxSpeed = this.cfg.walkSpeed || 125;
            m._animState = 'walk';
            MovementSystem.update(m, dt, entities); return;
        }
        if (player) {
            const distance = Math.hypot(player.x - m.x, player.y - m.y);
            if (distance > (this.cfg.followOffset || 155)) {
                m._tacticalTarget = { x: player.x, y: player.y };
                // 接近站位点缓出减速（120px 内速度随距离线性衰减，ease-out 到达）
                const walkSpeed = this.cfg.walkSpeed || 125;
                const slow = Math.min(1, distance / 120);
                m.maxSpeed = walkSpeed * Math.max(0.3, slow);
                m._animState = 'walk'; MovementSystem.update(m, dt, entities); return;
            }
        }
        this._stop(dt);
    }
    _nearestEnemy(entities) {
        let best = null; let bestDistance = this.cfg.engageRange || 950;
        for (const entity of (entities?.values?.() || entities || [])) {
            if (!entity?.active || entity.hp <= 0 || entity._isEnergyNode) continue;
            if (entity._faction !== 'enemy' && entity._faction !== 'agent') continue;
            const distance = Math.hypot(entity.x - this.m.x, entity.y - this.m.y);
            if (distance < bestDistance) { best = entity; bestDistance = distance; }
        }
        return best;
    }
    _startCast(target, dt) {
        const m = this.m;
        this._stop(dt);
        const animation = m.animations?.spell || {};
        const fps = Math.max(1, Number(this.cfg.castAnimFps ?? animation.frameRate) || 12);
        const releaseFrame = Math.max(1, Number(this.cfg.castReleaseFrame) || 8);
        const frameCount = Math.max(1, Number(animation.frameCount) || 17);

        this._castActive = true;
        this._releaseDone = false;
        this._pendingTarget = target;
        this._pendingSpell = this._spellIndex++ % 3;
        this._releaseLeft = (releaseFrame - 1) / fps * 1000;
        this._castAnimLeft = frameCount / fps * 1000 + 60;
        this._cooldown = Math.max(500, Number(this.cfg.attackInterval) || 2800);
        m.target = target;
        m._tacticalTarget = null;
        m.maxSpeed = 0;
        m.isMoving = false;
        m._animState = 'spell';
        m._castState = 'casting';
        m._prayerCast = true;
        m.rotation = Math.atan2(target.y - m.y, target.x - m.x);
        m._lastFaceRight = target.x >= m.x;
    }
    _updateCast(dt) {
        const m = this.m;
        const damp = Math.pow(0.85, (Number(dt) || 0) / 16.67);
        m.vx *= damp;
        m.vy *= damp;
        if (Math.hypot(m.vx, m.vy) < 1) { m.vx = 0; m.vy = 0; }
        m.maxSpeed = 0;
        m.isMoving = false;
        m._tacticalTarget = null;
        m._animState = 'spell';
        m._castState = 'casting';

        if (!this._releaseDone) {
            this._releaseLeft -= dt;
            if (this._releaseLeft <= 0) {
                this._releaseDone = true;
                this._releaseSpell();
            }
        }

        this._castAnimLeft -= dt;
        if (this._castAnimLeft > 0) return;
        this._castActive = false;
        this._releaseDone = false;
        this._pendingTarget = null;
        this._pendingSpell = -1;
        m._prayerCast = false;
        m._animState = 'idle';
        m._castState = 'idle';
    }
    _releaseSpell() {
        const m = this.m;
        const target = this._pendingTarget;
        const hp = target?.hp ?? target?.data?.hp ?? 0;
        if (!target?.active || hp <= 0) return;
        const distance = Math.hypot(target.x - m.x, target.y - m.y);
        if (distance > (this.cfg.castRange || 650) || !hasRangedLineOfSight(m, target)) return;

        m.target = target;
        const damage = Math.max(1, Math.round((this.cfg.attackDamage || 95) + (m.data?.matk || 0)));
        if (this._pendingSpell === 0) {
            EffectManager.add(new LightningBoltEffect(m, target));
            target.applyElectrified?.(1, 4000, m);
            target.takeDamage?.(damage, m, 'electric', false);
            EffectManager.add(new FloatingTextEffect(target.x, target.y - 40, '⚡ 闪电', '#b98cff'));
        } else if (this._pendingSpell === 1) {
            // 组件契约：第一次 trigger 创建冰锥，第二次 trigger 发射。
            this._iceSpike.trigger();
            this._iceSpike.trigger();
        } else {
            // 组件契约：第一次 trigger 创建火球，第二次 trigger 发射。
            this._fireball.trigger();
            this._fireball.trigger();
        }
    }
    _stop(dt) {
        const m = this.m;
        // 平滑站定：速度指数衰减（≈0.85/帧），代替瞬时清零的急停
        const damp = Math.pow(0.85, (Number(dt) || 0) / 16.67);
        m.vx *= damp;
        m.vy *= damp;
        if (Math.hypot(m.vx, m.vy) < 1) { m.vx = 0; m.vy = 0; }
        m.maxSpeed = 0;
        m.isMoving = false;
        // 缓停滑行期保持 walk，防 idle 姿势滑冰
        m._animState = Math.hypot(m.vx || 0, m.vy || 0) > 25 ? 'walk' : 'idle';
        m._prayerCast = false;
    }
}
