import { Collider, ELEVATION } from '../src/physics/collider.js';
import {
    distanceSquaredSegmentToSegment,
    segmentIntersectsCapsule
} from '../src/physics/collision-3d.js';
import { SpatialGrid } from '../src/physics/spatial-grid.js';
import { PERSPECTIVE_SCALE_Y } from '../src/config/perspective-config.js';

function assert(cond, msg) {
    if (!cond) throw new Error(`FAIL: ${msg}`);
    console.log(`PASS: ${msg}`);
}

// --- Collider derivation ---
const playerLike = {
    x: 100, y: 200,
    collisionShape: 'rect',
    collisionWidth: 30,
    collisionHeight: 60,
    collisionRadius: 30,
    size: 14,
    config: { render: { spriteSize: 120 } }
};
const playerCollider = Collider.fromEntity(playerLike);
assert(playerCollider.radius === 30, 'player ground radius from collisionRadius');
assert(playerCollider.height === 120, 'player height from spriteSize');
assert(playerCollider.elevation === ELEVATION.GROUND, 'default elevation ground');

const fatZombieLike = {
    x: 0, y: 0,
    collisionShape: 'rect',
    collisionWidth: 90,
    collisionHeight: 120,
    size: 60,
    config: { render: { spriteSize: 150 } }
};
const fzCollider = Collider.fromEntity(fatZombieLike);
assert(fzCollider.radius === 60, 'fat zombie radius from max(rect)/2');
assert(fzCollider.height === 150, 'fat zombie height from spriteSize');

// --- Capsule segment ---
const cap = fzCollider.getCapsuleSegment();
assert(Math.abs(cap.a.z - (fzCollider.centerZ - 15)) < 0.001, 'capsule bottom inner endpoint');
assert(Math.abs(cap.b.z - (fzCollider.centerZ + 15)) < 0.001, 'capsule top inner endpoint');
assert(cap.r === 60, 'capsule radius');

// --- Ground circle intersection ---
assert(fzCollider.intersectsGroundCircle(0, 0, 10), 'circle self-intersect');
assert(!fzCollider.intersectsGroundCircle(200, 0, 10), 'circle far away');

// --- 3D segment-to-capsule ---
// Horizontal shot through the center of a standing target at z=75
const target = Collider.fromEntity({ x: 0, y: 0, collisionRadius: 30, config: { height: 120 } });
const capsule = target.getCapsuleSegment();
const hitSeg = { x: -100, y: 0, z: 60 };
const hitSeg2 = { x: 100, y: 0, z: 60 };
assert(segmentIntersectsCapsule(hitSeg, hitSeg2, capsule, 0), 'projectile hits body center');

const missSeg = { x: -100, y: 0, z: 200 };
const missSeg2 = { x: 100, y: 0, z: 200 };
assert(!segmentIntersectsCapsule(missSeg, missSeg2, capsule, 0), 'projectile over head misses');

const missFarSeg = { x: -100, y: 100, z: 60 };
const missFarSeg2 = { x: 100, y: 100, z: 60 };
assert(!segmentIntersectsCapsule(missFarSeg, missFarSeg2, capsule, 0), 'projectile too far sideways misses');

// --- Spatial grid ---
const grid = new SpatialGrid(64);
const a = { name: 'a' };
const b = { name: 'b' };
grid.insert(a, 10, 10, 5);
grid.insert(b, 200, 200, 5);
const near = grid.query(12, 12, 20);
assert(near.includes(a) && !near.includes(b), 'spatial grid returns only nearby item');
grid.remove(a);
assert(grid.query(12, 12, 20).length === 0, 'spatial grid remove works');

// --- Segment-to-segment distance sanity ---
const d2 = distanceSquaredSegmentToSegment(
    { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 },
    { x: 5, y: 3, z: 0 }, { x: 5, y: 3, z: 4 }
);
assert(Math.abs(d2 - 9) < 0.001, 'perpendicular distance 3 -> squared 9');

// --- Projectile footprint ellipse sanity (mirrors projectile._hitFootprintEllipse) ---
function segmentHitsFootprint(prevX, prevY, x, y, cx, cy, radius, projectileRadius) {
    const invScale = 1 / PERSPECTIVE_SCALE_Y;
    const ax = prevX;
    const ay = prevY * invScale;
    const bx = x;
    const by = y * invScale;
    const ex = cx;
    const ey = cy * invScale;
    const sx = bx - ax;
    const sy = by - ay;
    const dx = ex - ax;
    const dy = ey - ay;
    const len2 = sx * sx + sy * sy;
    let t = 0;
    if (len2 > 1e-6) {
        t = Math.max(0, Math.min(1, (dx * sx + dy * sy) / len2));
    }
    const closestX = ax + sx * t;
    const closestY = ay + sy * t;
    const ddx = ex - closestX;
    const ddy = ey - closestY;
    const rr = radius + projectileRadius;
    return ddx * ddx + ddy * ddy <= rr * rr;
}

assert(segmentHitsFootprint(-100, 0, 100, 0, 0, 0, 30, 2), 'shot through footprint center hits');
assert(segmentHitsFootprint(-100, 0, 100, 0, 0, 15, 30, 2), 'shot through footprint Y-edge hits');
assert(!segmentHitsFootprint(-100, 0, 100, 0, 0, 20, 30, 2), 'shot outside footprint Y-edge misses');
assert(!segmentHitsFootprint(-100, 0, 100, 0, 150, 0, 30, 2), 'shot outside footprint X-edge misses');

console.log('\nAll Collider / 3D collision tests passed.');
