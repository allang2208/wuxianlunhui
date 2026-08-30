import { WallSystem } from '../world/wall-system.js';
import { canMeleeShareSurface } from './melee-surface.js';

/** 普攻停步、起手与命中共用；距离仍由兵种原有范围判断，不用于范围技能选敌。 */
export function canMeleeReachTarget(source, target) {
    if (!canMeleeShareSurface(source, target)) return false;
    const surfaceIgnore = WallSystem.ignoreForEntity(source);
    let ignore = surfaceIgnore;
    // 攻击墙/门本身时仅忽略目标自身，不能把“攻击结构”当作穿过其它墙体的许可。
    if (target._coverSeg || target._gateSeg || target._wallRect) {
        const segs = new Set(surfaceIgnore?.segs || []);
        const rects = new Set(surfaceIgnore?.rects || []);
        if (target._coverSeg) segs.add(target._coverSeg);
        if (target._gateSeg) segs.add(target._gateSeg);
        if (target._wallRect) rects.add(target._wallRect);
        ignore = { ...surfaceIgnore, segs, rects };
    }
    return !WallSystem.blocked(source.x, source.y, target.x, target.y, ignore);
}
