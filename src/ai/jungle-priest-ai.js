import { MovementSystem } from '../systems/movement-system.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { LightningBoltEffect } from '../effects/lightning-bolt.js';
import { IceSpikeSystem } from '../entities/components/ice-spike-system.js';
import { FireballSystem } from '../entities/components/fireball-system.js';

export class JunglePriestAI {
    constructor(priest) {
        this.m = priest;
        this.cfg = priest.aiConfig || {};
        this._cooldown = 0;
        this._spellIndex = 0;
        this._iceSpike = new IceSpikeSystem(priest);
        this._fireball = new FireballSystem(priest);
    }
    cancelForCommand() { return true; }
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
        const command = m._command;
        if (command?.mode === 'hold') { this._stop(); return; }
        const target = command?.mode === 'attack' && command.target?.active
            ? command.target : this._nearestEnemy(entities);
        if (target) {
            const distance = Math.hypot(target.x - m.x, target.y - m.y);
            if (distance <= (this.cfg.castRange || 650) && this._cooldown <= 0) {
                this._cast(target, entities); return;
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
                m.maxSpeed = this.cfg.walkSpeed || 125;
                m._animState = 'walk'; MovementSystem.update(m, dt, entities); return;
            }
        }
        this._stop();
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
    _cast(target, entities) {
        const m = this.m;
        this._stop(); m._animState = 'spell'; m._prayerCast = true;
        const damage = Math.max(1, Math.round((this.cfg.attackDamage || 95) + (m.data?.matk || 0)));
        const spell = this._spellIndex++ % 3;
        if (spell === 0) {
            EffectManager.add(new LightningBoltEffect(m, target));
            target.applyElectrified?.(1, 4000, m);
            target.takeDamage?.(damage, m, 'electric', false);
            EffectManager.add(new FloatingTextEffect(target.x, target.y - 40, '⚡ 闪电', '#b98cff'));
        } else if (spell === 1) {
            m.target = target;
            this._iceSpike.trigger();
            this._iceSpike.trigger();
        } else {
            m.target = target;
            this._fireball.trigger();
            this._fireball.trigger();
        }
        this._cooldown = Math.max(500, Number(this.cfg.attackInterval) || 2800);
    }
    _stop() { const m = this.m; m.vx = 0; m.vy = 0; m.maxSpeed = 0; m.isMoving = false; m._animState = 'idle'; m._prayerCast = false; }
}
