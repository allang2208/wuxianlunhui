import { PathManager } from '../../ai/path-manager.js';
import { PATH_DEFERRED, pathFinder } from '../../ai/pathfinder.js';
import { clearRtsSurfaceRoute, resolveRtsMoveDestination, getRtsFormationGroundPoint, RTS_FORMATION_ARRIVE_DISTANCE } from '../../ai/rts-command-utils.js';
import { isGunWeapon } from '../../config/gun-ammo.js';
import { WallSystem } from '../../world/wall-system.js';

const PLAYER_RTS_ARRIVE_DISTANCE = 28;
const PLAYER_RTS_PATH_RECALC_DISTANCE = 72;
const PLAYER_RTS_RELAY_DISTANCE = 760;
const PLAYER_RTS_NO_PATH_RETRY_MS = 400;

function emptyIntent() {
    return {
        move: { x: 0, y: 0 },
        aimWorld: null,
        primaryDown: false,
        primaryPressed: false,
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
        // 玩家指令保持同步首寻路，不继承敌群生成时使用的 0~250ms 错峰。
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

    update(dt, entities, enabled) {
        const intent = emptyIntent();
        if (!enabled || !this.player?.active) return intent;
        const command = this.command;
        if (!command || command.mode === 'hold') return intent;

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
            command.point = this._attackMovePoint(target);
            const moveIntent = this._moveIntent(command, dt, entities, 24, false);
            moveIntent.aimWorld = { x: target.x, y: target.y };
            return moveIntent;
        }

        this._clearNavigation();
        const fire = this._primaryFireIntent(target);
        return {
            ...intent,
            aimWorld: { x: target.x, y: target.y },
            primaryDown: fire.down,
            primaryPressed: fire.pressed,
        };
    }

    _moveIntent(command, dt, entities, arriveDistance, finishAtDestination = true) {
        const intent = emptyIntent();
        if (!command.point) {
            if (finishAtDestination) this.hold(true);
            return intent;
        }
        const move = resolveRtsMoveDestination(this.player, command, arriveDistance);
        if (move.arrived) {
            if (finishAtDestination) this.hold(true);
            else this._clearNavigation();
            return intent;
        }
        if (move.waitingForPortal) return intent;

        const destination = move.destination;
        const formationPoint = getRtsFormationGroundPoint(this.player, command);
        const useSurfaceDirection = !!this.player._surfaceRouteActive
            || this.player._surfaceKind === 'stairs'
            || this.player._surfaceKind === 'wall_walk';
        const movementTarget = useSurfaceDirection
            ? destination
            : this._groundWaypoint(destination, dt, entities, formationPoint);
        if (!movementTarget) return intent;
        const dx = movementTarget.x - this.player.x;
        const dy = movementTarget.y - this.player.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 0.001) return intent;
        const approachScale = formationPoint
            ? Math.min(1, move.distance / 64, distance / 24)
            : 1;
        intent.move = { x: dx / distance * approachScale, y: dy / distance * approachScale };
        intent.runVisual = true;
        intent.aimWorld = { x: movementTarget.x, y: movementTarget.y };
        return intent;
    }

    _groundWaypoint(destination, dt, entities, formationPoint = null) {
        const player = this.player;
        pathFinder.syncEntityFootprintObstacles?.(entities);
        const fullDistance = Math.hypot(destination.x - player.x, destination.y - player.y);
        // 远端仍使用网格中继路径：编队末段需靠近真实槽位，不能停在最后的网格中心。
        // 只接回已确认畅通的短线段；实际位移继续走玩家原碰撞链。
        const radius = player.groundRadius || player.collisionRadius || 20;
        if (formationPoint && fullDistance <= 64
            && !pathFinder.isPointBlocked(destination.x, destination.y, radius)
            && !pathFinder.isSegmentBlocked(player.x, player.y, destination.x, destination.y, radius)
            && !WallSystem.blocked(player.x, player.y, destination.x, destination.y, WallSystem.ignoreForEntity(player))) {
            return destination;
        }
        const relayScale = fullDistance > PLAYER_RTS_RELAY_DISTANCE
            ? PLAYER_RTS_RELAY_DISTANCE / fullDistance
            : 1;
        const pathTarget = {
            x: player.x + (destination.x - player.x) * relayScale,
            y: player.y + (destination.y - player.y) * relayScale,
        };
        const path = this._pathManager.path;
        const pathEnd = path?.[path.length - 1];
        const endpointShift = pathEnd
            ? Math.hypot(pathEnd.x - pathTarget.x, pathEnd.y - pathTarget.y)
            : Infinity;
        const needsRecalc = !this._pathManager.hasValidPath()
            || endpointShift > PLAYER_RTS_PATH_RECALC_DISTANCE;
        const now = Date.now();
        if (needsRecalc && now >= this._pathRetryAt) {
            const result = this._pathManager.forceRecalc(
                pathFinder,
                pathTarget.x,
                pathTarget.y,
                true
            );
            if (result === PATH_DEFERRED) this._pathRetryAt = now;
            else if (result === true) this._pathRetryAt = 0;
            else this._pathRetryAt = now + PLAYER_RTS_NO_PATH_RETRY_MS;
        }
        this._pathManager.update(dt, pathFinder);

        let waypoint = this._pathManager.getCurrentWaypoint();
        const waypointDistance = formationPoint ? RTS_FORMATION_ARRIVE_DISTANCE : 18;
        while (waypoint && Math.hypot(waypoint.x - player.x, waypoint.y - player.y) <= waypointDistance) {
            this._pathManager.advanceWaypoint();
            waypoint = this._pathManager.getCurrentWaypoint();
        }
        if (waypoint) return waypoint;
        // 无路径、预算延迟或中继刚走完时保持原地；下一次重算成功前禁止直线穿越障碍。
        if (this._pathManager.path && this._pathManager.isPathComplete()) {
            this._pathManager._clearPath?.();
            this._pathRetryAt = Math.min(this._pathRetryAt, now);
        }
        return null;
    }

    _attackMovePoint(target) {
        const now = Date.now();
        const moved = this._attackRouteTargetX === null
            || Math.hypot(target.x - this._attackRouteTargetX, target.y - this._attackRouteTargetY) > 40;
        if (!moved && now < this._attackRouteAt) return this.command.point;

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
        this._pathManager?._clearPath?.();
        this._pathRetryAt = 0;
    }

    _clearNavigation() {
        this._clearPath();
        clearRtsSurfaceRoute(this.player);
    }

    _clonePoint(point) {
        return {
            ...point,
            route: Array.isArray(point.route) ? point.route.map((step) => ({ ...step })) : [],
        };
    }
}
