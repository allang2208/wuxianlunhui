import { HamsterWarriorAI } from './hamster-warrior-ai.js';
import { canMeleeReachElevation } from './elevated-navigation-controller.js';

/**
 * 仓鼠武士近战：沿用战士的寻敌、追击与 RTS 指令，只替换普攻时序。
 * 伤害绑定正式攻击动画的刀刃接触帧，攻击动画每次挥击只播放一遍。
 */
export class HamsterSamuraiAI extends HamsterWarriorAI {
    constructor(samurai) {
        super(samurai);
        this._attackContactDelayMs = Math.max(0, Number(this.cfg.attackContactDelayMs) || 1167);
        this._attackDurationMs = Math.max(
            this._attackContactDelayMs,
            Number(this.cfg.attackDurationMs) || 1792
        );
        this._swing = null;
    }

    cancelForCommand() {
        this._swing = null;
        this.m._attackSwing = false;
        return super.cancelForCommand();
    }

    update(dt, entities, player) {
        super.update(dt, entities, player);
        this._updateSwing(dt);
    }

    _tryAttack() {
        const m = this.m;
        const target = m.target;
        if (this._swing || this._attackTimer > 0) return;
        if (!this._isReachableTarget(target)) return;

        this._attackTimer = this._attackInterval;
        m._samuraiAttackSeq = (Number(m._samuraiAttackSeq) || 0) + 1;
        m._attackSwing = true;
        this._swing = {
            target,
            elapsedMs: 0,
            hit: false,
        };
    }

    _updateSwing(dt) {
        const swing = this._swing;
        if (!swing) return;
        swing.elapsedMs += Math.max(0, Number(dt) || 0);

        if (!swing.hit && swing.elapsedMs >= this._attackContactDelayMs) {
            swing.hit = true;
            if (this._isReachableTarget(swing.target) && typeof swing.target.takeDamage === 'function') {
                swing.target.takeDamage(
                    this.m.getPhysicalAttackDamage(this._attackDamage, swing.target),
                    this.m,
                    'physical',
                    true
                );
                this._playSound('attack');
            }
        }

        if (swing.elapsedMs >= this._attackDurationMs) {
            this._swing = null;
            this.m._attackSwing = false;
        }
    }

    _isReachableTarget(target) {
        const m = this.m;
        if (!target || !target.active || target.hp <= 0 || target._isEnergyNode) return false;
        const range = this._attackRange + (target.groundRadius || 24);
        return Math.hypot(target.x - m.x, target.y - m.y) <= range
            && canMeleeReachElevation(m, target);
    }
}
