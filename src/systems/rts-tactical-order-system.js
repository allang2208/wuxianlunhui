import { RTS_DEFAULT_ACQUIRE_RANGE } from '../ai/rts-command-utils.js';
import { FogOfWarSystem } from '../world/fog-of-war-system.js';

const ORDER_MODES = new Set(['attack_move', 'patrol']);
const HOLD_COMMAND = Object.freeze({ mode: 'hold', point: null, target: null });

const game = () => (typeof window !== 'undefined' ? window.Game : null);

function semanticPoint(point, fallback = null) {
    const source = point || fallback;
    if (!source || !Number.isFinite(Number(source.x)) || !Number.isFinite(Number(source.y))) return null;
    return {
        x: Number(source.x),
        y: Number(source.y),
        z: Math.max(0, Number(source.z) || 0),
        surfaceKind: source.surfaceKind || source._surfaceKind || 'ground',
        wallId: source.wallId || source._surfaceWall?.id || null,
        staircaseId: source.staircaseId || source._surfaceStaircase?.id || null,
        stairGroupId: source.stairGroupId || source._surfaceStairGroupId || null,
    };
}

function commandPoint(point) {
    if (!point) return null;
    return {
        ...point,
        route: Array.isArray(point.route) ? point.route.map((step) => ({ ...step })) : [],
    };
}

function explorationLocked(unit) {
    return !!(unit?._isHamsterExplorer
        && (unit._exploreActive || unit._command?.mode === 'explore'));
}

export const RtsTacticalOrderSystem = {
    _seq: 0,

    isOrderMode(mode) {
        return ORDER_MODES.has(mode === 'aggressive' ? 'attack_move' : mode);
    },

    issue(unit, mode, point) {
        const normalizedMode = mode === 'aggressive' ? 'attack_move' : mode;
        if (!unit || !ORDER_MODES.has(normalizedMode) || explorationLocked(unit)) return false;
        const destination = semanticPoint(point, unit);
        if (!destination) return false;
        const origin = semanticPoint(unit, { x: unit.x, y: unit.y });
        const order = {
            id: `rts_order_${Date.now().toString(36)}_${++this._seq}`,
            mode: normalizedMode,
            origin,
            destination,
            leg: 'outbound',
            target: null,
            engaging: false,
        };
        unit._rtsTacticalOrder = order;
        return this._issueMove(unit, order, point);
    },

    clear(unit) {
        if (!unit) return;
        delete unit._rtsTacticalOrder;
    },

    update(entities, partyMembers = [], sceneId = null) {
        const units = new Set();
        const iter = entities?.values ? entities.values() : (entities || []);
        for (const entity of iter) {
            if (entity?._rtsTacticalOrder) units.add(entity);
        }
        for (const member of partyMembers || []) {
            if (member?._rtsTacticalOrder) units.add(member);
        }
        for (const unit of units) this._updateUnit(unit, entities, sceneId);
    },

    _updateUnit(unit, entities, sceneId) {
        const order = unit?._rtsTacticalOrder;
        if (!order) return;
        if (unit.active === false || unit._dying || unit.data?.hp <= 0 || explorationLocked(unit)) {
            this.clear(unit);
            return;
        }

        if (unit._rtsCanAttack !== false) {
            if (!this._isValidTarget(order.target)
                || (sceneId && FogOfWarSystem.shouldHideEntity(sceneId, order.target))) {
                order.target = null;
            }
            if (!order.target) order.target = this._nearestEnemy(unit, entities, sceneId);
            if (order.target) {
                order.engaging = true;
                if (unit._command?.mode !== 'attack'
                    || unit._command?.target !== order.target
                    || unit._command?._tacticalOrderId !== order.id) {
                    unit._command = {
                        mode: 'attack',
                        point: null,
                        target: order.target,
                        _tacticalOrderId: order.id,
                    };
                }
                return;
            }
        }

        if (order.engaging) {
            order.engaging = false;
            this._issueMove(unit, order);
            return;
        }

        const command = unit._command;
        const movingThisOrder = command?.mode === 'move' && command?._tacticalOrderId === order.id;
        if (movingThisOrder) return;

        if (order.mode === 'attack_move' && command?.mode === 'hold') {
            this.clear(unit);
            return;
        }
        if (order.mode === 'patrol' && command?.mode === 'hold') {
            order.leg = order.leg === 'outbound' ? 'return' : 'outbound';
        }
        this._issueMove(unit, order);
    },

    _issueMove(unit, order, routedPoint = null) {
        const endpoint = order.leg === 'return' ? order.origin : order.destination;
        let point = routedPoint ? commandPoint(routedPoint) : null;
        if (!point) {
            const defenseSystem = game()?.DefenseSystem;
            point = defenseSystem?.routeSurfaceMoveForUnit
                ? defenseSystem.routeSurfaceMoveForUnit(unit, endpoint)
                : commandPoint(endpoint);
        }
        if (!point || point.unreachable) {
            this.clear(unit);
            unit._command = { ...HOLD_COMMAND };
            return false;
        }
        unit._command = {
            mode: 'move',
            point: commandPoint(point),
            target: null,
            _tacticalOrderId: order.id,
        };
        return true;
    },

    _isValidTarget(target) {
        return !!(target && target.active !== false && target.hp > 0 && !target._isEnergyNode
            && (target._faction === 'enemy' || target._faction === 'agent'));
    },

    _nearestEnemy(unit, entities, sceneId) {
        let nearest = null;
        let nearestDistance = RTS_DEFAULT_ACQUIRE_RANGE;
        const iter = entities?.values ? entities.values() : (entities || []);
        for (const entity of iter) {
            if (!this._isValidTarget(entity)) continue;
            if (sceneId && FogOfWarSystem.shouldHideEntity(sceneId, entity)) continue;
            const distance = Math.hypot(entity.x - unit.x, entity.y - unit.y);
            if (distance <= nearestDistance) {
                nearest = entity;
                nearestDistance = distance;
            }
        }
        return nearest;
    },
};

export default RtsTacticalOrderSystem;
