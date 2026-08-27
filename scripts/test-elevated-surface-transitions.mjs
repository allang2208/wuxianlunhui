await import('./register-json-loader.mjs');

import {
    clampStairGroupPortalLane,
    createUnifiedElevatedNavigation,
    resolveStairGroundPortalTransition,
    stairGroundPortal,
    stairGroupGroundPoint,
    stairGroupGroundPortal,
} from '../src/world/unified-elevated-navigation.js';
import { commitElevatedSurfaceIdentity } from '../src/world/elevated-surface-state.js';
import { ElevatedRouteTraffic } from '../src/ai/elevated-route-traffic.js';
import { ElevatedNavigationController } from '../src/ai/elevated-navigation-controller.js';
import { canMeleeShareSurface } from '../src/combat/melee-surface.js';

let passed = 0;
let failed = 0;
const check = (name, condition, detail = '') => {
    if (condition) {
        passed++;
        console.log(`  ✓ ${name}${detail ? `：${detail}` : ''}`);
    } else {
        failed++;
        console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`);
    }
};

const firstSegment = { baseZ: 0, topZ: 62.5 };
const staircase = {
    id: 'stair_a',
    active: true,
    _isWallStaircase: true,
    walkWidth: 20,
    segments: [firstSegment],
    visualSegments: [{
        walkSurface: {
            entryA: { x: -10, y: 0 },
            entryB: { x: 10, y: 0 },
            entry: { x: 0, y: 0 },
            exitA: { x: -10, y: 100 },
            exitB: { x: 10, y: 100 },
            exit: { x: 0, y: 100 },
        },
    }],
};

const portal = stairGroundPortal(staircase, 14);
check('底部门户的地面路线点位于楼梯外侧',
    portal?.groundPoint.x === 0 && portal?.groundPoint.y === -14);
check('ground只能从底部门户向内进入stairs',
    resolveStairGroundPortalTransition(
        staircase,
        { x: 0, y: -14 },
        { x: 0, y: 4 },
        'enter'
    )?.kind === 'ground_to_stairs');
check('楼梯侧面不能吸附ground单位',
    !resolveStairGroundPortalTransition(
        staircase,
        { x: 40, y: -8 },
        { x: 40, y: 5 },
        'enter'
    ));
check('stairs可从底部门户向外切回ground',
    resolveStairGroundPortalTransition(
        staircase,
        { x: 0, y: 2 },
        { x: 0, y: -4 },
        'exit'
    )?.kind === 'stairs_to_ground');

// Isometric stair mouths are generally not perpendicular to their run axis in
// screen/world XY. The portal must use the exported mouth edge as its second
// affine basis axis, otherwise side-by-side stairs get progressively skewed.
const obliqueStair = {
    ...staircase,
    id: 'stair_oblique',
    visualSegments: [{
        walkSurface: {
            entryA: { x: 0, y: 0 },
            entryB: { x: 40, y: 20 },
            exitA: { x: -20, y: 20 },
            exitB: { x: 20, y: 40 },
        },
    }],
};
const obliquePortal = stairGroundPortal(obliqueStair, 14);
const obliqueMouthX = 40;
const obliqueMouthY = 20;
check('斜向楼梯入口矩形与真实楼梯口保持平行',
    Math.abs(
        obliquePortal.acrossAxisX * obliqueMouthY
        - obliquePortal.acrossAxisY * obliqueMouthX
    ) <= 1e-8);
check('斜向楼梯入口两侧都能穿过同一入口平面',
    resolveStairGroundPortalTransition(
        obliqueStair,
        {
            x: obliquePortal.groundPoint.x + obliquePortal.acrossAxisX * 15,
            y: obliquePortal.groundPoint.y + obliquePortal.acrossAxisY * 15,
        },
        {
            x: obliquePortal.entry.x + obliquePortal.axisX * 4
                + obliquePortal.acrossAxisX * 15,
            y: obliquePortal.entry.y + obliquePortal.axisY * 4
                + obliquePortal.acrossAxisY * 15,
        },
        'enter'
    )?.kind === 'ground_to_stairs');

const adjacentStair = {
    ...staircase,
    id: 'stair_b',
    visualSegments: [{
        walkSurface: {
            entryA: { x: 30, y: 0 },
            entryB: { x: 50, y: 0 },
            entry: { x: 40, y: 0 },
            exitA: { x: 30, y: 100 },
            exitB: { x: 50, y: 100 },
            exit: { x: 40, y: 100 },
        },
    }],
};
const stairGroupId = 'wall-stair-group:stair_a|stair_b';
staircase._wallStairGroupId = stairGroupId;
adjacentStair._wallStairGroupId = stairGroupId;
staircase._wallStairGroupMembers = [staircase, adjacentStair];
adjacentStair._wallStairGroupMembers = staircase._wallStairGroupMembers;
const groupPortal = stairGroupGroundPortal(staircase, 14);
check('相邻楼梯底部入口合并为覆盖中间接缝的连续入口带',
    groupPortal?.members.length === 2
    && groupPortal.halfWidth === 30
    && resolveStairGroundPortalTransition(
        staircase,
        { x: 20, y: -14 },
        { x: 20, y: 4 },
        'enter'
    )?.kind === 'ground_to_stairs');
const groupLaneGroundPoint = stairGroupGroundPoint(
    staircase,
    { x: 40, y: 4 },
    14
);
check('宽楼梯组的路线入口保留所选横向通道而不收束到组中心',
    groupLaneGroundPoint?.x === 40 && groupLaneGroundPoint?.y === -14);
const clampedGroupLane = clampStairGroupPortalLane(
    groupPortal,
    { x: 50, y: 4 },
    12
);
check('整组入口只把贴近最外侧护栏的单位夹回安全通道',
    clampedGroupLane?.x === 38 && clampedGroupLane?.y === 4);

const nav = createUnifiedElevatedNavigation({
    chooseCandidate: (_unit, candidates) => candidates[0] || null,
});
const queryAt = (x, y) => y >= 0
    ? {
        surface: {
            kind: 'stairs',
            z: 7,
            segment: firstSegment,
            progress: Math.max(0, y / 100),
        },
        staircase,
    }
    : { surface: null, staircase: null };
const exited = nav.sweep(
    { x: 0, y: 2 },
    { x: 0, y: -12 },
    queryAt,
    3,
    (sample) => {
        const transition = resolveStairGroundPortalTransition(
            staircase,
            sample.from,
            sample.to,
            'exit'
        );
        return transition ? { ...transition, staircase } : null;
    }
);
check('连续扫掠把合法下地报告为转换而非坠落回夹',
    exited.outcome === 'stairs_to_ground'
    && exited.surface === null
    && exited.completed
    && exited.y === -12);
const clamped = nav.sweep(
    { x: 0, y: 2 },
    { x: 150, y: -12 },
    queryAt,
    3,
    (sample) => resolveStairGroundPortalTransition(
        staircase,
        sample.from,
        sample.to,
        'exit'
    )
);
check('非法侧向离面仍由防坠落扫掠回夹',
    clamped.outcome === 'invalid_gap' && !clamped.completed && !!clamped.surface);

const unit = {
    x: 5,
    y: -8,
    z: 7,
    _elevatedState: {
        lastValidated: { x: 0, y: 1, z: 7, kind: 'stairs', staircase },
    },
};
commitElevatedSurfaceIdentity(unit, null, null, 0, {
    kind: 'stairs_to_ground',
    toKind: 'ground',
});
check('ground原子提交清除陈旧高架安全点与承托引用',
    unit._surfaceKind === 'ground'
    && unit._surfaceStaircase === null
    && unit._surfaceWall === null
    && unit._elevatedState.lastValidated === null
    && unit._elevatedState.lastGround.x === 5);

const traffic = new ElevatedRouteTraffic({
    reservationTtlMs: 1000,
    queueWaitTimeoutMs: 100,
    pruneIntervalMs: 1,
});
const holder = { active: true };
const queued = { active: true };
check('楼梯持有者获得方向许可',
    traffic.request(holder, 'stair_a', 'down', 1000).granted
    && traffic.permission(holder, 'stair_a', 'down'));
check('反向单位进入FIFO等待且没有物理许可',
    !traffic.request(queued, 'stair_a', 'up', 1000).granted
    && !traffic.permission(queued, 'stair_a', 'up'));
check('等待截止时间不会被重复request续期',
    !traffic.request(queued, 'stair_a', 'up', 1050).timedOut
    && traffic.request(queued, 'stair_a', 'up', 1101).timedOut);

const progressingTraffic = new ElevatedRouteTraffic({
    reservationTtlMs: 40,
    queueWaitTimeoutMs: 100,
    pruneIntervalMs: 1,
});
const progressingHolder = { active: true };
const progressingQueuedA = { active: true };
const progressingQueuedB = { active: true };
progressingTraffic.request(progressingHolder, 'stair_progress', 'down', 1000);
progressingTraffic.request(progressingQueuedA, 'stair_progress', 'up', 1000);
progressingTraffic.request(progressingQueuedB, 'stair_progress', 'up', 1000);
progressingTraffic.prune(1050);
check('队首上墙会续期尾部单位，但完全停滞仍会超时',
    progressingTraffic.permission(progressingQueuedA, 'stair_progress', 'up')
    && !progressingTraffic.request(progressingQueuedB, 'stair_progress', 'up', 1101).timedOut);

const narrowTraffic = new ElevatedRouteTraffic({ pruneIntervalMs: 1 });
const narrowUpA = { active: true };
const narrowUpB = { active: true };
const narrowDown = { active: true };
check('单座窄梯保持单单位占用，避免同向单位在踏步中互相挤死',
    narrowTraffic.request(narrowUpA, 'stair_narrow', 'up', 1000).granted
    && !narrowTraffic.request(narrowUpB, 'stair_narrow', 'up', 1000).granted
    && !narrowTraffic.request(narrowDown, 'stair_narrow', 'down', 1000).granted);

const occupiedTraffic = new ElevatedRouteTraffic({
    reservationTtlMs: 100,
    queueWaitTimeoutMs: 1000,
    pruneIntervalMs: 1,
});
const occupiedHolder = {
    active: true,
    _surfaceKind: 'stairs',
    _surfaceStaircase: { id: 'stair_hold' },
};
const occupiedQueued = { active: true };
occupiedTraffic.request(occupiedHolder, 'stair_hold', 'down', 1000);
occupiedTraffic.request(occupiedQueued, 'stair_hold', 'up', 1000);
occupiedTraffic.prune(1200);
check('单位物理停在楼梯中段时租约不会过期并放入第二个单位',
    occupiedTraffic.permission(occupiedHolder, 'stair_hold', 'down')
    && !occupiedTraffic.permission(occupiedQueued, 'stair_hold', 'up'));

ElevatedNavigationController.configure({
    stairTrafficKey: (staircaseId) => staircaseId.startsWith('wide_')
        ? 'wall-stair-group:wide_a|wide_b'
        : staircaseId,
    stairGroupSize: (staircaseId) => staircaseId.startsWith('wide_') ? 2 : 1,
}, {
    reservationTtlMs: 1000,
    queueWaitTimeoutMs: 1000,
    pruneIntervalMs: 1,
});
ElevatedNavigationController.reset();
const wideA = { active: true };
const wideB = { active: true };
check('相邻宽楼梯组不受单梯占用锁限制',
    ElevatedNavigationController.canCrossPortal(wideA, 'wide_a', 'up')
    && ElevatedNavigationController.canCrossPortal(wideB, 'wide_b', 'down'));

let explicitReplanCount = 0;
const timeoutRoute = [
    { x: 0, y: -14, z: 0, surfaceKind: 'ground', staircaseId: 'stair_retry' },
    { x: 0, y: 0, z: 7, surfaceKind: 'stairs', staircaseId: 'stair_retry' },
];
ElevatedNavigationController.configure({
    revision: () => 0,
    replanRoute: () => {
        explicitReplanCount++;
        return {
            x: 0,
            y: 100,
            z: 62.5,
            surfaceKind: 'wall_walk',
            route: timeoutRoute.map((step) => ({ ...step })),
        };
    },
}, {
    reservationTtlMs: 1000,
    queueWaitTimeoutMs: 100,
    progressTimeoutMs: 100,
    pruneIntervalMs: 1,
});
ElevatedNavigationController.reset();
const timeoutHolder = { active: true, x: 0, y: -14, z: 0, _surfaceKind: 'ground' };
const timeoutQueued = { active: true, x: 0, y: -14, z: 0, _surfaceKind: 'ground' };
const timeoutHolderCommand = {
    point: { route: timeoutRoute.map((step) => ({ ...step })) },
    routeIndex: 1,
};
const timeoutQueuedCommand = {
    point: { route: timeoutRoute.map((step) => ({ ...step })) },
    routeIndex: 1,
};
ElevatedNavigationController.gateRouteAdvance(
    timeoutHolder,
    timeoutHolderCommand,
    timeoutHolderCommand.point.route,
    1,
    false,
    1000
);
ElevatedNavigationController.gateRouteAdvance(
    timeoutQueued,
    timeoutQueuedCommand,
    timeoutQueuedCommand.point.route,
    1,
    false,
    1000
);
ElevatedNavigationController.prepareExplicitRoute(timeoutQueued, timeoutQueuedCommand, 1050);
const timedOutReservation = ElevatedNavigationController.gateRouteAdvance(
    timeoutQueued,
    timeoutQueuedCommand,
    timeoutQueuedCommand.point.route,
    1,
    false,
    1101
);
ElevatedNavigationController.prepareExplicitRoute(timeoutQueued, timeoutQueuedCommand, 1102);
check('显式上墙队列超时后必须重规划，不能永久停在旧入口',
    timedOutReservation.timedOut === true
    && explicitReplanCount === 1
    && timeoutQueuedCommand.routeIndex === 0);

ElevatedNavigationController.configure(null, {
    reservationTtlMs: 1000,
    queueWaitTimeoutMs: 1000,
    pruneIntervalMs: 1,
});
ElevatedNavigationController.reset();
const manualHolder = { active: true };
const manualQueued = { active: true };
check('无路线单位也必须在实际切面前取得楼梯许可',
    ElevatedNavigationController.canCrossPortal(manualHolder, 'stair_manual', 'up')
    && !ElevatedNavigationController.canCrossPortal(manualQueued, 'stair_manual', 'down'));
manualHolder._surfaceKind = 'stairs';
manualHolder._surfaceStaircase = { id: 'stair_manual' };
ElevatedNavigationController.syncSurfaceOccupancy(manualHolder, 1000);
ElevatedNavigationController.onSurfaceTransition(manualHolder, {
    kind: 'stairs_to_ground',
});
check('原持有者原子离开楼梯后队首才能获得许可',
    ElevatedNavigationController.canCrossPortal(manualQueued, 'stair_manual', 'down'));

const wall = { id: 'wall_a' };
const seam = {};
const stairB = { id: 'stair_b', wall, _sharedStairSurfaces: [seam] };
staircase.wall = wall;
staircase._sharedStairSurfaces = [seam];
check('ground与低阶stairs即使Z差很小也不能近战',
    !canMeleeShareSurface(
        { _surfaceKind: 'ground', z: 0 },
        { _surfaceKind: 'stairs', z: 7, _surfaceStaircase: staircase }
    ));
check('同楼梯同高度单位可以近战',
    canMeleeShareSurface(
        { _surfaceKind: 'stairs', z: 40, _surfaceStaircase: staircase },
        { _surfaceKind: 'stairs', z: 48, _surfaceStaircase: staircase }
    ));
check('并排共享接缝楼梯按同一平面处理',
    canMeleeShareSurface(
        { _surfaceKind: 'stairs', z: 60, _surfaceStaircase: staircase },
        { _surfaceKind: 'stairs', z: 60, _surfaceStaircase: stairB }
    ));
check('不同且不共享的楼梯不能隔空近战',
    !canMeleeShareSurface(
        { _surfaceKind: 'stairs', z: 60, _surfaceStaircase: staircase },
        { _surfaceKind: 'stairs', z: 60, _surfaceStaircase: { id: 'stair_c' } }
    ));
check('同附着墙的楼梯顶部与墙顶可在同高交接面近战',
    canMeleeShareSurface(
        { _surfaceKind: 'stairs', z: 125, _surfaceStaircase: staircase },
        { _surfaceKind: 'wall_walk', z: 125, _surfaceWall: wall }
    ));
check('墙顶与地面单位不能近战',
    !canMeleeShareSurface(
        { _surfaceKind: 'wall_walk', z: 125, _surfaceWall: wall },
        { _surfaceKind: 'ground', z: 0 }
    ));
check('不同墙顶连通分量即使同高也不能近战',
    !canMeleeShareSurface(
        { _surfaceKind: 'wall_walk', z: 125, _surfaceComponentId: 1 },
        { _surfaceKind: 'wall_walk', z: 125, _surfaceComponentId: 2 }
    ));
check('缺少墙体或连通分量身份的正式墙顶单位按失败关闭处理',
    !canMeleeShareSurface(
        { _surfaceKind: 'wall_walk', z: 125 },
        { _surfaceKind: 'wall_walk', z: 125 }
    ));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
