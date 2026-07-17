/**
 * 投射物躯干矩形（屏幕空间）共享判定模块。
 *
 * 唯一数据来源：entity.config.render.projectileHitbox（width/height/offsetX/bottom，
 * 锚定 collider 脚底中心）；未配置时缺省为 collisionWidth（回退 collider 直径）
 * × collider 身高，新怪物零配置自动获得躯干判定。
 *
 * 消费者：
 * - src/combat/projectile.js（枪械/毒液等投射物，扫掠线段判定）
 * - ice-spike-system / fireball-system / rune-sword-system（技能投射物，逐帧点判定）
 * - GameScene._syncCollisionRadii（绿色调试矩形，同一推导口径）
 *
 * 近战不使用本模块（近战走 skill-shapes.js 的 Z 区间形状判定）。
 */
import { segmentIntersectsExpandedRect } from './collision-3d.js';
import { ELEVATION } from './collider.js';

/**
 * 推导实体的躯干矩形（屏幕空间，轴对齐）。
 * @param {object} entity 带 collider 的实体
 * @returns {{cx:number, cy:number, halfW:number, halfH:number}|null}
 */
export function getTorsoRect(entity) {
    const c = entity?.collider;
    if (!c) return null;
    const hb = entity.config?.render?.projectileHitbox || null;
    const width = (hb && hb.width > 0) ? hb.width
        : (entity.collisionWidth > 0 ? entity.collisionWidth : c.radius * 2);
    const height = (hb && hb.height > 0) ? hb.height : c.height;
    if (width <= 0 || height <= 0) return null;
    const offsetX = (hb && hb.offsetX) || 0;
    const bottom = (hb && hb.bottom) || 0;
    return {
        cx: c.x + offsetX,
        cy: c.y - bottom - height / 2,
        halfW: width / 2,
        halfH: height / 2,
    };
}

/**
 * 扫掠线段与躯干矩形相交（枪械投射物用）。
 * 是否命中飞行单位由调用方分支决定（本函数不做 elevation 过滤）。
 * @param {number} expand 投射物半径（矩形四向外扩）
 */
export function segmentHitsTorso(entity, x1, y1, x2, y2, expand = 0) {
    const r = getTorsoRect(entity);
    if (!r) return false;
    return segmentIntersectsExpandedRect(x1, y1, x2, y2, r.cx, r.cy, r.halfW, r.halfH, expand);
}

/**
 * 点（含半径外扩）与躯干矩形相交（技能投射物逐帧判定用）。
 * 与 GroundCircle 语义对齐：FLYING 单位免疫地面判定。
 * @param {number} expand 投射物半径（矩形四向外扩）
 */
export function pointHitsTorso(entity, px, py, expand = 0) {
    const c = entity?.collider;
    if (!c || c.elevation === ELEVATION.FLYING) return false;
    const r = getTorsoRect(entity);
    if (!r) return false;
    return Math.abs(px - r.cx) <= r.halfW + expand &&
           Math.abs(py - r.cy) <= r.halfH + expand;
}
