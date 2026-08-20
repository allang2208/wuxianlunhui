/** 返回实体用于碰撞/图层判断的垂直区间。 */
export function entityVerticalRange(entity) {
    const colliderBottom = Number(entity?.collider?.bottomZ);
    const bottom = Number.isFinite(colliderBottom)
        ? colliderBottom
        : (Number(entity?.z) || 0);
    const colliderTop = Number(entity?.collider?.topZ);
    if (Number.isFinite(colliderTop)) return { bottom, top: colliderTop };
    const height = Math.max(
        1,
        Number(entity?.collider?.height)
            || Number(entity?.collisionHeight)
            || Number(entity?.size)
            || (Number(entity?.groundRadius) || 20) * 2
    );
    return { bottom, top: bottom + height };
}

/** 两个实体的垂直体积是否重叠。 */
export function verticalRangesOverlap(left, right, tolerance = 2) {
    const a = entityVerticalRange(left);
    const b = entityVerticalRange(right);
    return a.top > b.bottom + tolerance && b.top > a.bottom + tolerance;
}

/** lower 是否完整处于 upper 下方。 */
export function isEntityStrictlyBelow(lower, upper, tolerance = 2) {
    return entityVerticalRange(lower).top <= entityVerticalRange(upper).bottom + tolerance;
}
