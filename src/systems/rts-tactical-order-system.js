import { finishRtsCommandAtHold, getRtsAcquireRange, RTS_DEFAULT_ACQUIRE_RANGE } from '../ai/rts-command-utils.js';
import { FogOfWarSystem } from '../world/fog-of-war-system.js';
import { canMeleeReachElevation } from '../ai/elevated-navigation-controller.js';
import { queryNearbyEntities } from '../ai/friendly-spatial-query.js';

const ORDER_MODES = new Set(['attack_move', 'patrol']);

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

function isMilitaryGuard(unit) {
    const ai = unit?._ai;
    return !!(unit && unit._faction === 'companion' && unit._rtsCanAttack !== false
        && ai && (typeof ai._canStrike === 'function' || typeof ai._canCastAt === 'function'
            || typeof ai._canShootTarget === 'function' || Number.isFinite(ai._attackRange)));
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
        if (!destination || point?.unreachable) return false;
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
            else if (isMilitaryGuard(entity)
                && (entity._command?.mode === 'hold' || entity._command?._guardFromHold)) {
                this._updateHoldGuard(entity, entities, sceneId);
            }
        }
        for (const member of partyMembers || []) {
            if (member?._rtsTacticalOrder) units.add(member);
        }
        for (const unit of units) this._updateUnit(unit, entities, sceneId);
    },

    /** 坚守只选择原地可攻击目标；S 停止允许恢复普通自动接敌。 */
    _updateHoldGuard(unit, entities, sceneId) {
        if (unit.active === false || unit._dying || unit.data?.hp <= 0) return;
        const now = Date.now();
        if (now < (unit._rtsHoldGuardScanAt || 0)) return;
        unit._rtsHoldGuardScanAt = now + 120;
        if (unit._command?._guardFromHold) {
            const target = unit._command.target;
            if (this._isValidTarget(target) && this._canHoldAttack(unit, target)
                && !(sceneId && FogOfWarSystem.shouldHideEntity(sceneId, target))) return;
            finishRtsCommandAtHold(unit);
        }
        const freeAcquire = unit._command?._rtsStop === true;
        const target = this._nearestEnemy(unit, entities, sceneId,
            freeAcquire ? null : (enemy) => this._canHoldAttack(unit, enemy));
        if (!target) return;
        unit._command = {
            mode: 'attack',
            point: null,
            target,
            ...(freeAcquire ? { _rtsStop: true } : { _guardFromHold: true }),
        };
    },

    _canHoldAttack(unit, target) {
        const ai = unit._ai;
        if (!ai) return false;
        // 复用各兵种真实射程、近射盲区、LOS 和高度规则，不用统一索敌半径当攻击半径。
        if (typeof ai._canAttackFromHere === 'function') return ai._canAttackFromHere(target);
        if (typeof ai._canStrike === 'function') return ai._canStrike(target);
        if (typeof ai._canCastAt === 'function') return ai._canCastAt(target);
        const distance = Math.hypot(target.x - unit.x, target.y - unit.y);
        if (typeof ai._canShootTarget === 'function') {
            const range = ai._effectiveAttackRange?.() ?? ai._attackRange ?? 0;
            return distance <= range && ai._canShootTarget(target);
        }
        return Number.isFinite(ai._attackRange)
            && distance <= ai._attackRange + (target.groundRadius || 24)
            && canMeleeReachElevation(unit, target);
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
            unit._rtsCompletedCommand = { command: order, result: command };
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
            // 执行中的战术路线失败属于该任务的终态，不是外部命令接管。
            // 先清旧追击/路径，再把完成记录绑定高层 order，让队列跳过它并续行。
            finishRtsCommandAtHold(unit);
            unit._rtsCompletedCommand = {
                command: order, result: unit._command, failed: true,
                reason: point?.reason || '战术目标不可达',
            };
            this.clear(unit);
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

    _nearestEnemy(unit, entities, sceneId, predicate = null) {
        let nearest = null;
        // 军队读取自身默认索敌配置；正式队友的既有战术索敌口径保持不变。
        const acquireRange = isMilitaryGuard(unit) ? getRtsAcquireRange(unit) : RTS_DEFAULT_ACQUIRE_RANGE;
        let nearestDistance = acquireRange;
        const iter = queryNearbyEntities(entities, unit, acquireRange);
        for (const entity of iter) {
            if (!this._isValidTarget(entity)) continue;
            if (sceneId && FogOfWarSystem.shouldHideEntity(sceneId, entity)) continue;
            const distance = Math.hypot(entity.x - unit.x, entity.y - unit.y);
            if (distance <= nearestDistance) {
                // 先做距离筛选，再检查LOS/抛物线，避免扩大索敌后对更远目标重复计算。
                if (predicate && !predicate(entity)) continue;
                nearest = entity;
                nearestDistance = distance;
            }
        }
        return nearest;
    },
};

export default RtsTacticalOrderSystem;
