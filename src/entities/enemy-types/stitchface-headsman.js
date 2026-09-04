import { HorrorNormalEnemy } from './_shared/horror-normal-enemy.js';
import { DamagePipeline } from '../../combat/damage-pipeline.js';
import {
    canStartBasicMelee, canImpactBasicMelee, createBasicMeleeSnapshot,
    createBasicMeleeTimeline, rebaseBasicMeleeSnapshot,
} from '../../combat/melee-attack-resolver.js';

/** 缝面刽子手：锁定单体的蓄力下劈。位移来自原画动作，不另加突进。 */
export class StitchfaceHeadsman extends HorrorNormalEnemy {
    constructor(x, y, overrides = {}) {
        super(x, y, 'stitchfaceHeadsman', 'stitchface_headsman', overrides);
    }

    _cancelAction() {
        const keepPose = !this._deathStarted && this.hasStatusEffect('petrified');
        const state = this._animState, elapsed = this._animElapsed, frame = this._animFrame;
        super._cancelAction();
        // 石化只作废未命中事件，不能把冻结的攻击姿势改用待机脚点。
        if (keepPose) {
            this._animState = state;
            this._animElapsed = elapsed;
            this._animFrame = frame;
            this._actionState = 'controlled';
            this._syncFootOffset();
        }
    }

    _syncPetrifiedBodyAnchor(sprite) {
        // 场景石化分支跳过换图；依照真正冻结的纹理，而不是可能已切换的逻辑状态。
        const state = sprite.texture?.key?.replace(`enemy_${this._textureFamily}_`, '');
        const layout = this.config.textures.frameLayouts[state];
        if (!layout) return;
        sprite.x += (layout.frameWidth / 2 - layout.footX)
            * Math.abs(sprite.scaleX) * (sprite.flipX ? -1 : 1);
        sprite.y += this.footOffsetY - (layout.footY - layout.frameHeight / 2)
            * Math.abs(sprite.scaleY) + (this.colliderOffsetY || 0);
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
        };
    }

    _resolveAction(action) {
        if (!this._validTarget(action.primaryTarget)) return;
        // 被推移时判定区跟随当前脚点；目标和起手方向始终不变。
        const snapshot = rebaseBasicMeleeSnapshot(this, action.basicMeleeSnapshot);
        snapshot.timelineFrame = this._animFrame;
        if (!canImpactBasicMelee(this, action.primaryTarget, snapshot)) return;
        const skill = this._skill();
        DamagePipeline.applyHit(this, action.primaryTarget, {
            damage: Math.max(1, Math.round(this.data.atk * skill.damageMul)),
            damageType: 'physical',
            knockback: skill.knockback,
            angle: snapshot.worldAngle,
            isMelee: true,
            currentWeapon: null,
        });
    }
}
