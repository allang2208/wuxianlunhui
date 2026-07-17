import { Collider, ELEVATION } from '../src/physics/collider.js';
import {
    distanceSquaredSegmentToSegment,
    segmentIntersectsCapsule,
    segmentIntersectsExpandedRect
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

// --- Projectile torso rect (segmentIntersectsExpandedRect, mirrors projectile._hitTorsoRect) ---
// 僵尸躯干：宽 31 高 103，矩形中心在 (0, -51.5)（脚底原点向上）
const zHalfW = 31 / 2, zHalfH = 103 / 2, zCy = -103 / 2;
assert(segmentIntersectsExpandedRect(-100, -60, 100, -60, 0, zCy, zHalfW, zHalfH, 2),
    'torso shot through chest height hits');
assert(segmentIntersectsExpandedRect(-100, -100, 100, -100, 0, zCy, zHalfW, zHalfH, 2),
    'torso shot near head (still inside 103 tall) hits');
assert(!segmentIntersectsExpandedRect(-100, -110, 100, -110, 0, zCy, zHalfW, zHalfH, 2),
    'shot above torso rect misses');
assert(!segmentIntersectsExpandedRect(-100, -60, -30, -60, 0, zCy, zHalfW, zHalfH, 2),
    'shot stopping before torso misses');
assert(segmentIntersectsExpandedRect(-100, -60, -5, -60, 0, zCy, zHalfW, zHalfH, 2),
    'shot entering torso edge hits');
assert(segmentIntersectsExpandedRect(16.5, -60, 16.5, 60, 0, zCy, zHalfW, zHalfH, 2),
    'shot beside torso within bullet radius hits (expand)');
assert(!segmentIntersectsExpandedRect(20, -60, 20, 60, 0, zCy, zHalfW, zHalfH, 2),
    'shot beyond torso side + bullet radius misses');
assert(segmentIntersectsExpandedRect(0, -200, 0, 200, 0, zCy, zHalfW, zHalfH, 2),
    'vertical falling shot through torso hits');
assert(segmentIntersectsExpandedRect(0, 0, 0, 0, 0, zCy, zHalfW, zHalfH, 2),
    'zero-length segment inside rect hits');
assert(!segmentIntersectsExpandedRect(0, 50, 0, 50, 0, zCy, zHalfW, zHalfH, 2),
    'zero-length segment outside rect misses');

// --- Shared torso-hitbox module (skill projectiles point check) ---
const { getTorsoRect, pointHitsTorso, segmentHitsTorso } = await import('../src/physics/torso-hitbox.js');
const zombieLike = {
    collisionWidth: 30,
    config: { render: { projectileHitbox: { width: 31, height: 103, offsetX: 0, bottom: 0 } } },
    collider: { x: 100, y: 200, radius: 25, height: 120, elevation: ELEVATION.GROUND },
};
const torso = getTorsoRect(zombieLike);
assert(torso && torso.cx === 100 && Math.abs(torso.cy - (200 - 51.5)) < 1e-9 && torso.halfW === 15.5,
    'torso rect derives from projectileHitbox config');
assert(pointHitsTorso(zombieLike, 100, 160, 12), 'skill point at torso height hits');
assert(pointHitsTorso(zombieLike, 100, 105, 12), 'skill point near head within radius hits');
assert(!pointHitsTorso(zombieLike, 100, 60, 12), 'skill point far above torso misses');
assert(!pointHitsTorso(zombieLike, 150, 160, 12), 'skill point beside torso misses');
assert(segmentHitsTorso(zombieLike, 0, 160, 300, 160, 2), 'segment through torso hits');
// 缺省推导：无 projectileHitbox 时取 collisionWidth × 身高
const defaultDerive = {
    collisionWidth: 30,
    config: { render: {} },
    collider: { x: 0, y: 0, radius: 25, height: 120, elevation: ELEVATION.GROUND },
};
const dRect = getTorsoRect(defaultDerive);
assert(dRect && dRect.halfW === 15 && dRect.halfH === 60, 'torso rect falls back to collisionWidth x height');
// 飞行单位免疫点判定（与 GroundCircle 语义一致）
const flyingLike = { ...zombieLike, collider: { ...zombieLike.collider, elevation: ELEVATION.FLYING } };
assert(!pointHitsTorso(flyingLike, 100, 160, 12), 'flying entity immune to torso point check');

// --- GroundSector / GroundDirectedRect (melee ground-flat detection) ---
const { GroundSector, GroundDirectedRect } = await import('../src/physics/skill-shapes.js');
const mkEntity = (x, y, r = 20, ground = true) => ({ collider: { x, y, radius: r, isGroundTarget: ground } });

// 地面扇形：原点 (0,0)，朝右，半径 100，张角 60°
const sector = new GroundSector(0, 0, 0, 100, Math.PI / 3);
assert(sector.intersectsEntity(mkEntity(80, 0)), 'ground sector: target dead ahead hits');
assert(sector.intersectsEntity(mkEntity(115, 0)), 'ground sector: edge within footprint radius hits');
assert(!sector.intersectsEntity(mkEntity(130, 0)), 'ground sector: beyond range misses');
assert(!sector.intersectsEntity(mkEntity(70, 70)), 'ground sector: outside arc misses');
assert(!sector.intersectsEntity(mkEntity(-80, 0)), 'ground sector: behind origin misses');
assert(!sector.intersectsEntity(mkEntity(80, 0, 20, false)), 'ground sector: flying target immune');

// 地面有向矩形：起点 (0,0)，朝右，长 100，宽 40，后摆 20
const gRect = new GroundDirectedRect(0, 0, 0, 100, 40, 20);
assert(gRect.intersectsEntity(mkEntity(60, 0)), 'ground rect: center hits');
assert(gRect.intersectsEntity(mkEntity(60, 30)), 'ground rect: within width + footprint hits');
assert(!gRect.intersectsEntity(mkEntity(60, 50)), 'ground rect: outside width misses');
assert(!gRect.intersectsEntity(mkEntity(140, 0)), 'ground rect: beyond length misses');
assert(gRect.intersectsEntity(mkEntity(-10, 0)), 'ground rect: backExtension hits behind');
assert(!gRect.intersectsEntity(mkEntity(-50, 0)), 'ground rect: beyond backExtension misses');
assert(!gRect.intersectsEntity(mkEntity(60, 0, 20, false)), 'ground rect: flying target immune');

console.log('\nAll Collider / 3D collision tests passed.');
