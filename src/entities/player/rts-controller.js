import { PathManager } from '../../ai/path-manager.js';
import { pathFinder } from '../../ai/pathfinder.js';
import { PathWorkScheduler } from '../../ai/path-work-scheduler.js';
import {
    clearRtsSurfaceRoute,
    getRtsFormationGroundPoint,
    resolveRtsMoveDestination,
    RTS_ROUTE_Z_TOLERANCE,
} from '../../ai/rts-command-utils.js';
import { isGunWeapon } from '../../config/gun-ammo.js';
import { WallSystem } from '../../world/wall-system.js';
import { ElevatedGarrison } from '../../ai/elevated-garrison.js';
import { ElevatedNavigationController } from '../../ai/elevated-navigation-controller.js';

const PLAYER_RTS_ARRIVE_DISTANCE = 28;

function emptyIntent() {
    return {
        move: { x: 0, y: 0 },
        aimWorld: null,
        primaryDown: false,
        primaryPressed: false,
        runSpeed: false,
        runVisual: false,
    };
}

/**
 * 玩家专用 RTS 控制源。只产生移动与主手普通攻击意图；玩家原有 update 继续负责
 * 速度修正、碰撞、武器冷却、弹药、换弹、攻击动画和伤害结算。
 */
export class PlayerRtsController {
    constructor(player) {
        this.player = player;
        this.command = { mode: 'hold', point: null, target: null };
        this._pathManager = new PathManager(player);
        player._surfaceGroundPathManager = this._pathManager;
        // 玩家复用分帧指挥寻路，仍通过自己的意图驱动原移动/武器链。
        this._pathManager._firstRecalcAt = 0;
        this._pathRetryAt = 0;
        this._attackRouteAt = 0;
        this._attackRouteTargetX = null;
        this._attackRouteTargetY = null;
    }

    issueMove(point) {
        if (!point) return false;
        this._resetAttackCharge();
        this._clearNavigation();
        this.command = {
            mode: 'move',
            point: this._clonePoint(point),
            target: null,
        };
        return true;
    }

    issueAttack(target) {
        if (!this._isValidTarget(target)) return false;
        this._resetAttackCharge();
        this._clearNavigation();
        this.command = { mode: 'attack', point: null, target };
        this._attackRouteAt = 0;
        return true;
    }

    hold(completed = false) {
        const previous = this.command;
        this._resetAttackCharge();
        this._clearNavigation();
        this.command = { mode: 'hold', point: null, target: null };
        if (completed) this.player._rtsCompletedCommand = { command: previous, result: this.command };
        const player = this.player;
        player.vx = 0;
        player.vy = 0;
        player.isMoving = false;
        player._rtsRunVisual = false;
    }

    cancel() {
        this.hold();
    }

    failNavigation(reason, status = 'unreachable') {
        const command = this.command;
        this.hold();
        this.player._rtsCompletedCommand = { command, result: this.command, failed: true, reason };
        this.player._navigationStatus = status;
        this.player._navigationFailure = reason;
    }

    update(dt, entities, enabled) {
        const intent = emptyIntent();
        if (!enabled || !this.player?.active) {
            if (this.player) ElevatedGarrison.release(this.player);
            return intent;
        }
        const command = this.command;
        if (!command || command.mode === 'hold') return this._stationIntent(dt, entities) || intent;

        if (command.mode === 'move') {
            return this._moveIntent(command, dt, entities, PLAYER_RTS_ARRIVE_DISTANCE);
        }
        if (command.mode !== 'attack') return intent;

        const target = command.target;
        if (!this._isValidTarget(target)) {
            this.hold(true);
            return intent;
        }

        const range = this._currentAttackRange();
        const edgeDistance = Math.max(0,
            Math.hypot(target.x - this.player.x, target.y - this.player.y)
            - (Number(target.groundRadius) || Number(target.collisionRadius) || 0)
            - (Number(this.player.groundRadius) || Number(this.player.collisionRadius) || 0));
        const verticalDistance = Math.abs((Number(target.z) || 0) - (Number(this.player.z) || 0));
        const ignore = WallSystem.ignoreForEntity?.(this.player) || null;
        const blocked = WallSystem.blocked?.(
            this.player.x,
            this.player.y,
            target.x,
            target.y,
            ignore
        ) || false;
        const canAttack = edgeDistance <= range && verticalDistance <= Math.max(80, range * 0.4) && !blocked;
        if (!canAttack) {
            ElevatedGarrison.release(this.player);
            command.point = this._attackMovePoint(target);
            const moveIntent = this._moveIntent(command, dt, entities, 24, false);
            moveIntent.aimWorld = { x: target.x, y: target.y };
            return moveIntent;
        }

        const stationIntent = this._stationIntent(dt, entities);
        if (stationIntent) return stationIntent;
        this._clearNavigation();
        const fire = this._primaryFireIntent(target);
        return {
            ...intent,
            aimWorld: { x: target.x, y: target.y },
            primaryDown: fire.down,
            primaryPressed: fire.pressed,
        };
    }

    _stationIntent(dt, entities) {
        const player = this.player;
        // 原武器链继续完成已起手动作，驻守不取消弹药、换弹或施法。
        if (player.weaponAnim?.isAttacking || player._frozenForCast || player._isDodging
            || player.knockbackX || player.knockbackY) return null;
        const exit = player._surfaceExitCommand || (player._surfaceKind === 'stairs'
            ? ElevatedNavigationController.prepareExitCommand(player) : null);
        const stop = exit ? { command: exit } : ElevatedGarrison.prepareStop(player, true);
        if (!stop) return null;
        if (stop.waiting) { this._clearNavigation(); return emptyIntent(); }
        if (!exit) player._garrisonMoveCommand = stop.command;
        return this._moveIntent(stop.command, dt, entities, PLAYER_RTS_ARRIVE_DISTANCE, false);
    }

    _moveIntent(command, dt, entities, arriveDistance, finishAtDestination = true) {
        const intent = emptyIntent();
        if (!command.point) {
            if (command === this.command) this.failNavigation('没有可达的移动目标');
            return intent;
        }
        const move = resolveRtsMoveDestination(this.player, command, arriveDistance);
        if (move.failed) {
            if (command._garrisonInternal || (command.mode === 'move' && command.point.surfaceKind === 'wall_walk')) {
                ElevatedGarrison.routeFailed(this.player);
            }
            this._clearPath();
            if (command === this.command) this.failNavigation(move.reason || '目标不可达',
                command.point?.navigationStatus || 'unreachable');
            return intent;
        }
        if (move.arrived) {
            if (command._garrisonInternal) ElevatedGarrison.finishInternal(this.player);
            if (finishAtDestination) this.hold(true);
            else this._clearNavigation();
            return intent;
        }
        if (move.waitingForPortal || move.waitingForGarrison || move.navigationPending) {
            this._clearPath();
            return intent;
        }

        const destination = move.destination;
        const formationPoint = getRtsFormationGroundPoint(this.player, command);
        const useSurfaceDirection = !!this.player._surfaceRouteActive
            || this.player._surfaceKind === 'stairs'
            || this.player._surfaceKind === 'wall_walk'
            || this.player._elevatedNavigationBridge
            || Number(this.player.z) > RTS_ROUTE_Z_TOLERANCE;
        // 地面 A* 只负责入口接近；高架接管后丢弃旧入口路径，下楼时不能恢复它。
        if (useSurfaceDirection) this._clearPath();
        const movementTarget = useSurfaceDirection
            ? destination
            : this._groundWaypoint(destination, entities, command);
        if (!movementTarget) return intent;
        const dx = movementTarget.x - this.player.x;
        const dy = movementTarget.y - this.player.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 0.001) return intent;
        const seat = this.player._garrisonFinalPoint;
        const atSeatLeg = seat && Math.hypot(destination.x - seat.x, destination.y - seat.y) < 0.01;
        const approachScale = Math.min(
            formationPoint || atSeatLeg ? Math.min(1, move.distance / 64) : 1,
            useSurfaceDirection ? 1 : Math.min(1, distance / 24));
        intent.move = { x: dx / distance * approachScale, y: dy / distance * approachScale };
        intent.runSpeed = true;
        intent.runVisual = true;
        intent.aimWorld = { x: movementTarget.x, y: movementTarget.y };
        return intent;
    }

    _groundWaypoint(destination, entities, command) {
        const player = this.player, manager = this._pathManager;
        pathFinder.syncEntityFootprintObstacles?.(entities);
        const request = manager.prepareCommandRoute(command, destination, pathFinder);
        if (request.surfaceRoute) {
            ElevatedNavigationController.adoptGroundTransit(player, command, destination, request.surfaceRoute);
            return null;
        }
        manager.watchCommandProgress();
        if (request.status === 'pending') {
            PathWorkScheduler.enqueueRecalculation(manager, pathFinder, destination.x, destination.y, true, 75);
            return null;
        }
        if (request.status === 'unreachable' || request.status === 'search_limited') {
            if (command === this.command) this.failNavigation(request.reason, request.status);
            else { ElevatedGarrison.routeFailed(player); this._clearPath(); }
            return null;
        }
        if (!manager.hasValidPath()) return null;
        let waypoint = manager.getCurrentWaypoint();
        while (waypoint && Math.hypot(waypoint.x - player.x, waypoint.y - player.y) <= 4) {
            manager.advanceWaypoint();
            waypoint = manager.getCurrentWaypoint();
        }
        return manager.hasValidPath() ? waypoint : null;
    }

    _attackMovePoint(target) {
        const now = Date.now();
        const surfaceKey = `${target._surfaceKind || 'ground'}:${target._surfaceWall?.id || ''}:${target._surfaceStaircase?.id || ''}`;
        const moved = this._attackRouteTargetX === null
            || Math.hypot(target.x - this._attackRouteTargetX, target.y - this._attackRouteTargetY) > 40;
        // 有效/待计算的表面路线由共享控制器检查拓扑，不能每400ms重置routeIndex。
        if (!moved && surfaceKey === this._attackRouteSurfaceKey && this.command.point
            && (this.command.point.route?.length || this.command.point.navigationPending || now < this._attackRouteAt)) {
            return this.command.point;
        }

        const game = typeof window !== 'undefined' ? window.Game : null;
        const defenseSystem = game?.DefenseSystem;
        let point = defenseSystem?.resolveSurfaceTarget
            ? defenseSystem.resolveSurfaceTarget(target.x, target.y, { coordinateSpace: 'physical' })
            : {
                x: target.x,
                y: target.y,
                z: Number(target.z) || 0,
                surfaceKind: target._surfaceKind || 'ground',
                route: [],
            };
        if (!point?.unreachable && defenseSystem?.routeSurfaceMoveForUnit) {
            point = defenseSystem.routeSurfaceMoveForUnit(this.player, point);
        }
        if (!point || point.unreachable) point = null;
        this._attackRouteAt = now + 400;
        this._attackRouteTargetX = target.x;
        this._attackRouteTargetY = target.y;
        this._attackRouteSurfaceKey = surfaceKey;
        delete this.command.routeIndex;
        return point ? this._clonePoint(point) : null;
    }

    _primaryFireIntent(target) {
        const player = this.player;
        const slot = player.weaponMode;
        const item = player.equipments?.[slot];
        if (!item?.name) return { down: true, pressed: true };

        if (isGunWeapon(item) && item.weaponType !== 'energy_lmg') {
            const state = player._getAmmoState?.(slot);
            if (state?.reloading) return { down: false, pressed: false };
            if (state && state.current <= 0) {
                player._startReload?.(slot);
                return { down: false, pressed: false };
            }
        }
        if (item.chargeAttack) {
            // 蓄力完成后制造一个“松开”帧，让现有弓箭攻击链完成释放；下一帧重新开始蓄力。
            if (player._chargeState === 'charged') return { down: false, pressed: false };
            if (player.weaponAnim?.isAttacking || !player.attacks?.ranged?.canUse?.()) {
                return { down: false, pressed: false };
            }
            return { down: true, pressed: true };
        }
        return { down: true, pressed: true, target };
    }

    _currentAttackRange() {
        const player = this.player;
        const item = player.equipments?.[player.weaponMode];
        if (!item?.name) return 90;
        const melee = item.category === 'weapon_melee' || item.weaponType === 'sword';
        if (melee) {
            const base = Number(item.attack?.range) || Number(player.attacks?.melee?.range) || 116;
            const bonus = Number(item.attack?.rangeBonus) || 0;
            const craft = Number(item._craftEffects?.rangeDelta) || 0;
            return Math.max(45, base + bonus + craft - 12);
        }
        const attackKey = item.attackKey || (item.weaponType === 'bow' ? 'ranged' : item.weaponType);
        const attack = player.attacks?.[attackKey] || player.attacks?.ranged;
        const configured = (Number(item.attack?.range) || Number(attack?.projectileRange) || 650)
            + (Number(item._craftEffects?.rangeDelta) || 0);
        return Math.max(100, configured * 0.82);
    }

    _isValidTarget(target) {
        if (!target || target.active === false) return false;
        const hp = target.hp ?? target.data?.hp;
        return hp === undefined || hp > 0;
    }

    _resetAttackCharge() {
        const player = this.player;
        if (player._chargeState && player._chargeState !== 'idle') {
            player._chargeState = 'idle';
            player._chargeTimer = 0;
            player._chargeFlashActive = false;
            player._chargeFlashTimer = 0;
        }
    }

    _clearPath() {
        PathWorkScheduler.cancel(this._pathManager);
        this._pathManager?._clearPath?.();
        this._pathRetryAt = 0;
    }

    _clearNavigation() {
        this._clearPath();
        clearRtsSurfaceRoute(this.player);
        if (this.command?.mode === 'attack') {
            this.command.point = null;
            this._attackRouteAt = 0;
        }
    }

    _clonePoint(point) {
        return {
            ...point,
            route: Array.isArray(point.route) ? point.route.map((step) => ({ ...step })) : [],
        };
    }
}
