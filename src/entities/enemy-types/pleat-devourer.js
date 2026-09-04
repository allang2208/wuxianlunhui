import { HorrorNormalEnemy } from './_shared/horror-normal-enemy.js';
import { hostilesOf } from './_shared/enemy-utils.js';
import { DamagePipeline } from '../../combat/damage-pipeline.js';
import {
    canStartBasicMelee, canImpactBasicMelee, createBasicMeleeSnapshot,
    createBasicMeleeTimeline, rebaseBasicMeleeSnapshot,
} from '../../combat/melee-attack-resolver.js';

/** 百褶噬团：锁向矩形重压。共用恐怖怪动作/尸体时钟，不启用通用普攻或逻辑突进。 */
export class PleatDevourer extends HorrorNormalEnemy {
    constructor(x, y, overrides = {}) {
        super(x, y, 'pleatDevourer', 'pleat_devourer', overrides);
    }

    _canStartAction(target) {
        return canStartBasicMelee(this, target, this.config.attack);
    }

    _createActionContext(target) {
        const snapshot = createBasicMeleeSnapshot(this, target, this.config.attack);
        return {
            basicMeleeSnapshot: snapshot,
            basicMeleeTimeline: createBasicMeleeTimeline(this),
            timelineElapsedMs: 0,
            worldAngle: snapshot.worldAngle,
            hitTargets: new Set(),
        };
    }

    _beginAction(target) {
        // 红色轮廓与已有动画前摇同时开始，不再多等一轮预警。
        this._tryAttackTelegraph(() => {
            super._beginAction(target);
            return !!this._action;
        });
    }

    _resolveAction(action, entities) {
        // AOE沿已提交方向；即使主目标离开，其他进入矩形的敌对目标仍可被压中。
        // 复用现有地面矩形/目标footprint/同层/墙体复查，不放大身体碰撞来代替攻击区。
        const snapshot = rebaseBasicMeleeSnapshot(this, action.basicMeleeSnapshot);
        snapshot.timelineFrame = this._animFrame;
        const skill = this._skill();
        for (const target of hostilesOf(this, entities)) {
            if (this._action !== action || this._cannotAttack()) break;
            if (action.hitTargets.has(target) || !this._validTarget(target)
                || !canImpactBasicMelee(this, target, snapshot)) continue;
            // 弹反/反伤可能同步打断或杀死本体，先消费，再执行正常伤害链。
            action.hitTargets.add(target);
            DamagePipeline.applyHit(this, target, {
                damage: Math.max(1, Math.round(this.data.atk * skill.damageMul)),
                damageType: 'physical',
                knockback: skill.knockback,
                angle: snapshot.worldAngle,
                isMelee: true,
                currentWeapon: null,
            });
        }
    }

    takeDamage(damage, source, damageType = 'physical', isMelee = true, hitContext = null) {
        const armor = this.config.attackSkills.pleatArmor;
        // 只改进入常规防御结算前的攻击量；控制期间不享受褶甲，也不另建Buff计时器。
        if (this.active && !this._isDead && !this._cannotAttack()) {
            const recovering = this._action
                && this._action.elapsedMs >= this._frameStarts.attack[armor.exposedStartFrame];
            damage *= recovering ? armor.exposedDamageTakenMultiplier : armor.closedDamageTakenMultiplier;
        }
        return super.takeDamage(damage, source, damageType, isMelee, hitContext);
    }

    _cancelAction() {
        const keepPose = !this._deathStarted && this.hasStatusEffect('petrified');
        const state = this._animState, elapsed = this._animElapsed, frame = this._animFrame;
        super._cancelAction();
        this._clearAttackTelegraph();
        if (keepPose) {
            this._animState = state;
            this._animElapsed = elapsed;
            this._animFrame = frame;
            this._actionState = 'controlled';
            this._syncFootOffset();
        }
    }

    _syncPetrifiedBodyAnchor(sprite) {
        // 石化保留真实可见纹理/帧；控制取消逻辑不能把冻结的压击姿态改用idle锚点。
        const state = sprite.texture?.key?.replace(`enemy_${this._textureFamily}_`, '');
        const layout = this.config.textures.frameLayouts[state];
        if (!layout) return;
        sprite.x += (layout.frameWidth / 2 - layout.footX)
            * Math.abs(sprite.scaleX) * (sprite.flipX ? -1 : 1);
        sprite.y += this.footOffsetY - (layout.footY - layout.frameHeight / 2)
            * Math.abs(sprite.scaleY) + (this.colliderOffsetY || 0);
    }

    _getPhaserOptions() {
        return { ...super._getPhaserOptions(), flipX: false,
            manualFrame: true, frameAnchorX: this._layout().footX };
    }
}
