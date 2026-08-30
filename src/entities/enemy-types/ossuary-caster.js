import { HorrorNormalEnemy } from './_shared/horror-normal-enemy.js';
import { AimHelper } from '../../utils/aim-helper.js';
import { ProjectileFactory } from '../../utils/projectile-factory.js';
import { hasRangedLineOfSight } from '../../combat/ranged-line-of-sight.js';
import { projectileTargetZ, projectileWallContext } from '../../combat/elevated-ranged.js';

/** 掷骨殓徒：锁起手目标，真实出手帧预判投掷一枚骨镖，不追踪、不穿透。 */
export class OssuaryCaster extends HorrorNormalEnemy {
    constructor(x,y,overrides={}) { super(x,y,'ossuaryCaster','ossuary_caster',overrides); }
    _canStartAction(target) {
        return Math.hypot(target.x-this.x,target.y-this.y)<=this._skill().range
            && hasRangedLineOfSight(this,target,this._skill().projectileRadius);
    }
    _createActionContext() { return {}; }
    _resolveAction(action, entities) {
        const target = action.primaryTarget;
        const skill = this._skill();
        if (!this._validTarget(target) || !this._canStartAction(target)) return;
        // Preserve the authored facing; targets who cross behind during wind-up evade this throw.
        const flip = Math.cos(action.worldAngle)<0 ? -1 : 1;
        if ((target.x-this.x)*flip < -skill.behindTolerance) return;
        const scale = this.config.render.spriteSize/this.config.textures.referenceCell;
        const x = this.x+flip*skill.releaseOffsetPx.x*scale;
        const groundY = this.y;
        const z = (Number(this.z)||0)-skill.releaseOffsetPx.y*scale;
        const targetZ = projectileTargetZ(target);
        const aim = AimHelper.lead(x,groundY,target.x,target.y,target.vx||0,target.vy||0,skill.projectileSpeed);
        const distance = Math.max(1,Math.hypot(aim.x-x,aim.y-groundY));
        const damage = Math.max(1,Math.round(this.data.atk*skill.damageMul));
        ProjectileFactory.create({ x,y:groundY-z,z,groundY,targetZ,aimDistance:distance,
            angle:Math.atan2((aim.y-targetZ)-(groundY-z),aim.x-x),
            groundAngle:Math.atan2(aim.y-groundY,aim.x-x),speed:skill.projectileSpeed,
            maxRange:skill.projectileRange,size:skill.projectileRadius*2,damage:{min:damage,max:damage},
            piercing:0,source:this,entities,textureKey:'enemy_ossuary_caster_projectile',
            rotateWithVelocity:true,displaySize:skill.projectileDisplaySize,
            wallContext:projectileWallContext(this,null,{x,y:groundY,z}),damageType:'physical',knockback:skill.knockback });
    }
}
