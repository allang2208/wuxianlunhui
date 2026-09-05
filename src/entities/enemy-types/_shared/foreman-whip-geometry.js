import { PERSPECTIVE_SCALE_Y } from '../../../config/perspective-config.js';

/**
 * 独立鞭层的投影。pose.hand/curve为固定比例素材坐标，不旋转或拉伸人体。
 * 根点由当前Sprite脚点取得；angle/reach来自同一次近战快照。
 * 接触帧末端严格落在 root + groundDirection * reach - strikeHeight。
 */
export function projectForemanWhip({ pose, contactPose, frame, contactFrame, root,
    pixelScale, angle, flipX, reach, strikeHeight }) {
    const mirror = flipX ? -1 : 1;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const handX = pose.hand[0] * pixelScale * mirror;
    const handY = pose.hand[1] * pixelScale;
    const contactTip = contactPose.curve[contactPose.curve.length - 1];
    const authoredReach = (contactPose.hand[0] + contactTip[0]) * pixelScale;
    const reachScale = reach / Math.max(1, authoredReach);
    const lead = contactPose.hand[0] * pixelScale * reachScale;
    // 甩出阶段渐进补偿侧身手部与地面锁向的差异，握点始终不动。
    const t = Math.max(0, Math.min(1, (frame - (contactFrame - 8)) / 8));
    const steering = t * t * (3 - 2 * t);
    const correctionX = cos * lead - handX;
    const correctionY = sin * lead * PERSPECTIVE_SCALE_Y - strikeHeight - handY;
    return pose.curve.map(([x, y], index) => {
        const u = index / Math.max(1, pose.curve.length - 1);
        const forward = x * pixelScale * reachScale;
        return {
            x: root.x + handX + cos * forward + correctionX * u * steering,
            y: root.y + handY + sin * forward * PERSPECTIVE_SCALE_Y
                + y * pixelScale + correctionY * u * steering,
        };
    });
}
