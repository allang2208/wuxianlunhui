import { HorrorNormalEnemy } from './_shared/horror-normal-enemy.js';
import { DamagePipeline } from '../../combat/damage-pipeline.js';
import { canStartBasicMelee, canImpactBasicMelee, createBasicMeleeSnapshot, createBasicMeleeTimeline } from '../../combat/melee-attack-resolver.js';

/** 裹尸囚徒：停步拍击，单体、单次，保留可后撤躲避的接触窗。 */
export class ShroudThrall extends HorrorNormalEnemy {
    constructor(x, y, overrides = {}) { super(x,y,'shroudThrall','shroud_thrall',overrides); }
    _canStartAction(target) { return canStartBasicMelee(this,target,this.config.attack); }
    _createActionContext(target) {
        const snapshot = createBasicMeleeSnapshot(this,target,this.config.attack);
        return { basicMeleeSnapshot: snapshot, basicMeleeTimeline: createBasicMeleeTimeline(this),
            timelineElapsedMs: 0, worldAngle: snapshot.worldAngle };
    }
    _resolveAction(action) {
        const snapshot = action.basicMeleeSnapshot;
        snapshot.timelineFrame = this._animFrame;
        if (!canImpactBasicMelee(this,action.primaryTarget,snapshot)) return;
        const skill = this._skill();
        DamagePipeline.applyHit(this,action.primaryTarget,{ damage: Math.max(1,Math.round(this.data.atk*skill.damageMul)),
            damageType:'physical',knockback:skill.knockback,angle:snapshot.worldAngle,isMelee:true,currentWeapon:null });
    }
}
