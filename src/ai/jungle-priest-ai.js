import { beginFriendlyAttackClock, advanceFriendlyAttackClock } from '../combat/friendly-attack-timing.js';
import { MovementSystem } from '../systems/movement-system.js';
import { canFinishSurfaceFollow } from './elevated-navigation-controller.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { LightningBoltEffect } from '../effects/lightning-bolt.js';
import { IceSpikeSystem } from '../entities/components/ice-spike-system.js';
import { FireballSystem } from '../entities/components/fireball-system.js';
import { hasRangedLineOfSight } from '../combat/ranged-line-of-sight.js';
import { getMagicRangeMultiplier } from '../utils/magic-craft-helper.js';
import {
    clearRtsSurfaceRoute,
    finishRtsCommandAtHold,
    resolveRtsMoveDestination,
} from './rts-command-utils.js';
import { queryNearbyEntities, stableAiPhase } from './friendly-spatial-query.js';

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
        this._decisionTimer = stableAiPhase(priest, this.cfg.decisionMs ?? 120);
        this._cachedTarget = null;
    }
    cancelForCommand() {
        // 施法动作保持不可打断；新命令已经写在实体上，当前施法结束后立即接管。
        if (this._castActive) return false;
        const m = this.m;
        m.target = null;
        m._tacticalTarget = null;
        m._prayerCast = false;
        m._animState = 'idle';
        m._castState = 'idle';
        m.vx = 0;
        m.vy = 0;
        m.isMoving = false;
        m._pathManager?._clearPath?.();
        return true;
    }
    cancelForDeath() {
        this._castActive = false;
        this._releaseDone = true;
        this._pendingTarget = null;
        this._pendingSpell = -1;
        this._cachedTarget = null;
        this.cancelForCommand();
    }
    updateProjectilesWhileControlled(dt, entities) {
        this._iceSpike.update(dt, entities);
        this._fireball.update(dt, entities);
    }
    applyUpgrades(patch = {}) {
        if (patch.attackDamage) this.cfg.attackDamage = patch.attackDamage;
        if (Number.isFinite(patch.attackDamageMult)) this.cfg.attackDamageMult = patch.attackDamageMult;
        if (patch.attackInterval) this.cfg.attackInterval = patch.attackInterval;
        if (patch.castRange) this.cfg.castRange = patch.castRange;
        if (patch.walkSpeed) this.cfg.walkSpeed = patch.walkSpeed;
        if (Number.isFinite(patch.jungleSpellCooldownMult)) {
            const previous = Math.max(0.01, Number(this.cfg.jungleSpellCooldownMult) || 1);
            const next = Math.max(0, patch.jungleSpellCooldownMult);
            if (this._cooldown > 0) this._cooldown *= next / previous;
            this.cfg.jungleSpellCooldownMult = next;
        }
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
        if (MovementSystem.continueStairTransit(m, dt, entities)) return;
        const command = m._command;
        if (command?.mode && command.mode !== 'follow') {
            this._applyCommand(command, dt, entities);
            return;
        }
        const engageRange = this.cfg.engageRange || 950;
        this._decisionTimer -= dt;
        if (!this._isValidTarget(this._cachedTarget)
            || Math.hypot(this._cachedTarget.x - m.x, this._cachedTarget.y - m.y) > engageRange) {
            this._cachedTarget = null;
            this._decisionTimer = 0;
        }
        if (this._decisionTimer <= 0) {
            this._decisionTimer = this.cfg.decisionMs ?? 120;
            this._cachedTarget = this._nearestEnemy(entities);
        }
        const target = this._cachedTarget;
        if (target) {
            if (this._cooldown <= 0 && this._canCastAt(target)) {
                this._startCast(target, dt); return;
            }
            m._tacticalTarget = { x: target.x, y: target.y, _surfaceTarget: target };
            m.maxSpeed = this.cfg.walkSpeed || 125;
            m._animState = 'walk';
            MovementSystem.update(m, dt, entities); return;
        }
        if (player) {
            const distance = Math.hypot(player.x - m.x, player.y - m.y);
            if (distance > (this.cfg.followOffset || 155) || !canFinishSurfaceFollow(m, player)) {
                m._tacticalTarget = { x: player.x, y: player.y, _surfaceTarget: player };
                // 接近站位点缓出减速（120px 内速度随距离线性衰减，ease-out 到达）
                const walkSpeed = this.cfg.walkSpeed || 125;
                const slow = Math.min(1, distance / 120);
                m.maxSpeed = walkSpeed * Math.max(0.3, slow);
                m._animState = 'walk'; MovementSystem.update(m, dt, entities); return;
            }
        }
        this._stop(dt);
    }
    /** RTS 指令与仓鼠牧师同口径：移动到点转待命，指定攻击只锁定目标，不回退自动跟随。 */
    _applyCommand(command, dt, entities) {
        const m = this.m;
        if (command.mode !== 'move' && !m._surfaceNavCommand) clearRtsSurfaceRoute(m);
        if (command.mode === 'move') {
            m.target = null;
            const move = resolveRtsMoveDestination(m, command);
            if (move.arrived) {
                finishRtsCommandAtHold(m);
                clearRtsSurfaceRoute(m);
                this._stop(dt);
                return;
            }
            m._tacticalTarget = move.destination;
            m.maxSpeed = this.cfg.walkSpeed || 125;
            m._animState = 'walk';
            MovementSystem.update(m, dt, entities);
            return;
        }
        if (command.mode === 'attack') {
            const target = command.target;
            if (!this._isValidTarget(target)) {
                finishRtsCommandAtHold(m);
                this._stop(dt);
                return;
            }
            if (this._cooldown <= 0 && this._canCastAt(target)) {
                this._startCast(target, dt);
                return;
            }
            if (!this._canCastAt(target)) {
                m.target = target;
                m._tacticalTarget = { x: target.x, y: target.y, _surfaceTarget: target };
                m.maxSpeed = this.cfg.walkSpeed || 125;
                m._animState = 'walk';
                MovementSystem.update(m, dt, entities);
                return;
            }
            m.target = target;
            this._stop(dt);
            return;
        }
        m.target = null;
        this._stop(dt);
    }
    _nearestEnemy(entities) {
        let best = null; let bestDistance = this.cfg.engageRange || 950;
        for (const entity of queryNearbyEntities(entities, this.m, bestDistance)) {
            if (!this._isValidTarget(entity)) continue;
            const distance = Math.hypot(entity.x - this.m.x, entity.y - this.m.y);
            if (distance < bestDistance) { best = entity; bestDistance = distance; }
        }
        return best;
    }
    _isValidTarget(target) {
        const hp = target?.hp ?? target?.data?.hp ?? 0;
        return !!target
            && target.active === true
            && hp > 0
            && target.hittable === true
            && !target._isEnergyNode
            && (target._faction === 'enemy' || target._faction === 'agent');
    }
    _castRange() {
        const configured = Number(this.cfg.castRange);
        const baseRange = Number.isFinite(configured) ? Math.max(0, configured) : 650;
        return baseRange * getMagicRangeMultiplier(this.m);
    }
    _canCastAt(target) {
        return this._isValidTarget(target)
            && Math.hypot(target.x - this.m.x, target.y - this.m.y) <= this._castRange()
            && hasRangedLineOfSight(this.m, target);
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
        beginFriendlyAttackClock(this, 'spell', this._castAnimLeft, { fitInterval: false, fps });
        const cooldownMult = Math.max(0, Number(this.cfg.jungleSpellCooldownMult) || 1);
        this._cooldown = Math.max(500, (Number(this.cfg.attackInterval) || 2800) * cooldownMult);
        m.target = target;
        m._tacticalTarget = null;
        m.maxSpeed = 0;
        m.isMoving = false;
        m._animState = 'spell';
        m._castState = 'casting';
        m._prayerCast = true;
        m._prayerActionSeq = (m._prayerActionSeq || 0) + 1;
        m.rotation = Math.atan2(target.y - m.y, target.x - m.x);
        m._lastFaceRight = target.x >= m.x;
    }
    _updateCast(dt) {
        const m = this.m;
        dt = advanceFriendlyAttackClock(m, dt);
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
        if (!this._canCastAt(target)) return;

        m.target = target;
        const desertDamageMult = m._isDesertPriest
            ? Math.max(0, Number(this.cfg.attackDamageMult) || 1)
            : 1;
        const attackDamageBase = m._isDesertPriest
            ? (Number(this.cfg.baseAttackDamage) || 95)
            : (Number(this.cfg.attackDamage) || 95);
        let damage = Math.max(1, Math.round(
            (attackDamageBase + (m.data?.matk || 0)) * desertDamageMult
        ));
        if (this._pendingSpell === 0) {
            const lightning = m.skills?.lightningStrike;
            if (lightning && typeof lightning.getEffect === 'function') {
                const powerAt = (level) => {
                    const effect = lightning.getEffect(level);
                    return Math.max(1,
                        (Number(effect.damageBase) || 0)
                        + (Number(m.data?.matk) || 0) * (Number(effect.magicMul) || 0)
                        + (Number(m.data?.int) || 0) * (Number(effect.intMul) || 0));
                };
                damage = Math.max(1, Math.round(damage * powerAt(lightning.level) / powerAt(1)));
            }
            EffectManager.add(new LightningBoltEffect(m, target));
            target.applyElectrified?.(1, 4000, m);
            target.takeDamage?.(damage, m, 'electric', false);
            EffectManager.add(new FloatingTextEffect(target.x, target.y - 40, '⚡ 闪电', '#b98cff'));
        } else if (this._pendingSpell === 1) {
            // 组件契约：第一次 trigger 创建冰锥，第二次 trigger 发射。
            this._iceSpike.trigger();
            if (m._isDesertPriest) {
                this._iceSpike._magicDamageMul = Math.max(
                    0,
                    Number(this._iceSpike._magicDamageMul) || 1
                ) * desertDamageMult;
            }
            this._iceSpike.trigger();
        } else {
            // 组件契约：第一次 trigger 创建火球，第二次 trigger 发射。
            this._fireball.trigger();
            if (m._isDesertPriest) {
                this._fireball._magicDamageMul = Math.max(
                    0,
                    Number(this._fireball._magicDamageMul) || 1
                ) * desertDamageMult;
            }
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
        m._tacticalTarget = null;
        m._pathManager?._clearPath?.();
        // 缓停滑行期保持 walk，防 idle 姿势滑冰
        m._animState = Math.hypot(m.vx || 0, m.vy || 0) > 25 ? 'walk' : 'idle';
        m._prayerCast = false;
    }
}
