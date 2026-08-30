import { HorrorNormalEnemy } from './_shared/horror-normal-enemy.js';
import { hostilesOf } from './_shared/enemy-utils.js';
import { GroundEllipse } from '../../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../../physics/elevation.js';
import { PERSPECTIVE_SCALE_Y } from '../../config/perspective-config.js';
import { WallSystem } from '../../world/wall-system.js';
import { DamagePipeline } from '../../combat/damage-pipeline.js';
import { fireGroundShockwave } from '../../effects/combat-fx.js';

/** 缚钟侍者：一次敲击只产生一次近距离声震，不叠持续伤害或硬控。 */
export class KnellAttendant extends HorrorNormalEnemy {
    constructor(x,y,overrides={}) { super(x,y,'knellAttendant','knell_attendant',overrides); }
    _pulseShape() {
        const radius=this._skill().radius;
        return new GroundEllipse(this.collider?.x??this.x,this.collider?.y??this.y,
            radius,radius*PERSPECTIVE_SCALE_Y,surfaceEffectFromEntity(this));
    }
    _hasPulseLos(target) {
        const ignore=target?._coverSeg?{segs:new Set([target._coverSeg])}:null;
        return !WallSystem.blocked(this.x,this.y,target.x,target.y,ignore);
    }
    _canStartAction(target) { return this._pulseShape().intersectsEntity(target) && this._hasPulseLos(target); }
    _createActionContext() { return {}; }
    _resolveAction(action,entities) {
        const skill=this._skill();
        const shape=this._pulseShape();
        fireGroundShockwave({x:shape.x,y:shape.y,maxRadius:skill.radius,strokeColor:0xa6b4ad,
            duration:skill.pulseVisualMs,lineWidth:2,strokeAlpha:.55,fillAlpha:0,flicker:false,groundLayer:true});
        for (const target of hostilesOf(this,entities)) {
            if (this._cannotAttack() || this._action!==action) break;
            if (!this._validTarget(target) || !shape.intersectsEntity(target) || !this._hasPulseLos(target)) continue;
            DamagePipeline.applyHit(this,target,{damage:Math.max(1,Math.round(this.data.matk*skill.damageMul)),
                damageType:'magic',knockback:skill.knockback,angle:Math.atan2(target.y-this.y,target.x-this.x),
                isMelee:false,currentWeapon:null});
        }
    }
}
