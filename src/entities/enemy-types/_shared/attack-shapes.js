import { GroundDirectedRect, GroundEllipse, GroundSector } from '../../../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../../../config/perspective-config.js';
import { surfaceEffectFromEntity } from '../../../physics/elevation.js';
import { canMeleeShareSurface } from '../../../combat/melee-surface.js';
import { hasAttackLineOfSight } from '../../../combat/melee-reach.js';

/** 停步技能按实际地面形状起手，不用屏幕距离代替纵向压缩后的范围。 */
export function canStartGroundSkill(source, target, spec) {
    if (source.isCombatActionBlocked() || !target?.active || target.hittable === false
        || !canMeleeShareSurface(source, target) || !hasAttackLineOfSight(source, target)) return false;
    const x = source.collider?.x ?? source.x, y = source.collider?.y ?? source.y;
    const dx = (target.collider?.x ?? target.x) - x;
    const dy = (target.collider?.y ?? target.y) - y;
    const angle = Math.atan2(dy / PERSPECTIVE_SCALE_Y, dx);
    const context = surfaceEffectFromEntity(source);
    let shape;
    if (spec.kind === 'ellipse') {
        const offset = spec.forwardOffset || 0;
        shape = new GroundEllipse(x + Math.cos(angle) * offset,
            y + Math.sin(angle) * offset * PERSPECTIVE_SCALE_Y, spec.radiusX, spec.radiusY, context);
    } else if (spec.kind === 'sector') {
        shape = new GroundSector(x, y, angle, spec.range, spec.arcDegrees * Math.PI / 180, context);
    } else {
        shape = new GroundDirectedRect(x, y, angle, spec.range, spec.width, 0, context);
    }
    return shape.intersectsEntity(target);
}
