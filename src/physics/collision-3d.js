/**
 * 3D 命中/碰撞辅助函数
 *
 * 用于投射物、近战、技能与统一 Collider（胶囊体）之间的检测。
 */

const EPS = 1e-6;

function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a, b) {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function mul(a, s) {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

/**
 * 计算两条 3D 线段之间的最短距离平方
 * 参考 Real-Time Collision Detection (Christer Ericson)
 * @param {{x,y,z}} p1 线段1起点
 * @param {{x,y,z}} q1 线段1终点
 * @param {{x,y,z}} p2 线段2起点
 * @param {{x,y,z}} q2 线段2终点
 * @returns {number}
 */
export function distanceSquaredSegmentToSegment(p1, q1, p2, q2) {
    const d1 = sub(q1, p1);
    const d2 = sub(q2, p2);
    const r = sub(p1, p2);

    const a = dot(d1, d1);
    const e = dot(d2, d2);
    const f = dot(d2, r);

    let s, t;

    if (a <= EPS && e <= EPS) {
        // 两条线段都退化为点
        return dot(r, r);
    }

    if (a <= EPS) {
        // 线段1退化为点
        s = 0;
        t = clamp(f / e, 0, 1);
    } else {
        const c = dot(d1, r);
        if (e <= EPS) {
            // 线段2退化为点
            t = 0;
            s = clamp(-c / a, 0, 1);
        } else {
            const b = dot(d1, d2);
            const denom = a * e - b * b;

            if (denom !== 0) {
                s = clamp((b * f - c * e) / denom, 0, 1);
            } else {
                s = 0;
            }

            t = (b * s + f) / e;

            if (t < 0) {
                t = 0;
                s = clamp(-c / a, 0, 1);
            } else if (t > 1) {
                t = 1;
                s = clamp((b - c) / a, 0, 1);
            }
        }
    }

    const c1 = add(p1, mul(d1, s));
    const c2 = add(p2, mul(d2, t));
    const diff = sub(c1, c2);
    return dot(diff, diff);
}

/**
 * 计算 3D 线段到胶囊体轴线的最短距离
 * @param {{x,y,z}} segA 投射物线段起点
 * @param {{x,y,z}} segB 投射物线段终点
 * @param {{a:{x,y,z}, b:{x,y,z}, r:number}} capsule 胶囊体描述
 * @returns {number} 距离（已减去胶囊体半径，>=0）
 */
export function distanceSegmentToCapsule(segA, segB, capsule) {
    const d2 = distanceSquaredSegmentToSegment(segA, segB, capsule.a, capsule.b);
    const d = Math.sqrt(d2);
    return Math.max(0, d - capsule.r);
}

/**
 * 3D 线段是否与胶囊体相交（用于投射物命中）
 * @param {{x,y,z}} segA
 * @param {{x,y,z}} segB
 * @param {{a:{x,y,z}, b:{x,y,z}, r:number}} capsule
 * @param {number} projectileRadius 投射物自身半径，默认 0
 * @returns {boolean}
 */
export function segmentIntersectsCapsule(segA, segB, capsule, projectileRadius = 0) {
    return distanceSegmentToCapsule(segA, segB, capsule) <= projectileRadius;
}

/**
 * 3D 点到胶囊体表面的最短距离
 * @param {{x,y,z}} p
 * @param {{a:{x,y,z}, b:{x,y,z}, r:number}} capsule
 * @returns {number}
 */
export function distancePointToCapsule(p, capsule) {
    const d2 = distanceSquaredSegmentToSegment(p, p, capsule.a, capsule.b);
    const d = Math.sqrt(d2);
    return Math.max(0, d - capsule.r);
}

/**
 * 简单 3D 球体相交（用于爆炸中心等）
 * @param {{x,y,z}} c1
 * @param {number} r1
 * @param {{x,y,z}} c2
 * @param {number} r2
 * @returns {boolean}
 */
export function spheresIntersect(c1, r1, c2, r2) {
    const dx = c1.x - c2.x;
    const dy = c1.y - c2.y;
    const dz = c1.z - c2.z;
    const rr = r1 + r2;
    return dx * dx + dy * dy + dz * dz <= rr * rr;
}
