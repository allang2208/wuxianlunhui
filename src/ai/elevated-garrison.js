import { isoLocalToWorldDelta, worldDeltaToIsoLocal } from '../physics/iso-footprint.js';

// 驻守只预约终点，不进入寻路障碍图，也不参与移动中的单位分离。
const DEFAULTS = Object.freeze({
    enabled: true,
    spacingGap: 8,
    arriveDistance: 2,
    searchRadius: 384,
    portalClearance: 16,
    retryMs: 1000,
    leaseMs: 3000,
    maxCandidatesPerFrame: 64,
    maxPlansPerFrame: 4,
    budgetMs: 2,
});
const BUCKET_SIZE = 96;
const RESERVABLE_FACTIONS = new Set(['player', 'companion']);
const groundDistance = (a, b) => {
    const d = worldDeltaToIsoLocal(a.x - b.x, a.y - b.y);
    return Math.hypot(d.u, d.v);
};
const radiusOf = (unit) => Math.max(1, Number(unit.groundRadius) || Number(unit.collisionRadius) || 20);
const alive = (unit) => unit?.active !== false && !unit?._dying && (unit?.hp ?? unit?.data?.hp ?? 1) > 0;
const ownerOf = (unit) => unit?._rtsController?.command || unit?._command || null;
const clock = () => globalThis.performance?.now?.() ?? Date.now();

class ElevatedGarrisonImpl {
    constructor() {
        this._adapter = null;
        this.config = { ...DEFAULTS };
        this.reset();
    }

    configure(adapter, config = {}) {
        this._adapter = adapter;
        this.config = { ...DEFAULTS, ...config };
    }

    reset() {
        for (const state of this._states?.values() || []) this._clearFlags(state.unit);
        this._states = new Map();
        this._seats = new Map();
        this._bodies = new Map();
        this._bodyBuckets = new Map();
        this._queue = new Set();
        this._geometry = new Map();
        this._revision = -1;
        this._pruneAt = 0;
        this._reservedCount = 0;
        this._occupancyRevision = 0;
        this.stats = { candidates: 0, plans: 0, queued: 0, reserved: 0, usedMs: 0 };
    }

    eligible(unit) {
        return !!this._adapter && this.config.enabled && !!unit && alive(unit)
            && RESERVABLE_FACTIONS.has(unit._faction || unit.faction)
            && !unit.isStructure && !unit._isBuilding && !unit._isDefenseStructure
            && radiusOf(unit) <= this._adapter.maxUnitRadius;
    }

    _clearFlags(unit) {
        unit._garrisonStatus = null;
        unit._garrisonMoveCommand = null;
        unit._garrisonFinalPoint = null;
    }

    _bucket(point) {
        const { u, v } = worldDeltaToIsoLocal(point.x, point.y);
        return `${Math.floor(u / BUCKET_SIZE)},${Math.floor(v / BUCKET_SIZE)}`;
    }

    _insert(index, entry) {
        entry.bucket = this._bucket(entry.point);
        if (!index.has(entry.bucket)) index.set(entry.bucket, new Set());
        index.get(entry.bucket).add(entry);
    }

    _remove(index, entry) {
        const bucket = index.get(entry?.bucket);
        bucket?.delete(entry);
        if (bucket?.size === 0) index.delete(entry.bucket);
    }

    _dropSeat(state) {
        if (state.point) { this._reservedCount--; this._occupancyRevision++; }
        this._remove(this._seats, state);
        state.point = null;
        state.command = null;
        state.settled = false;
        state.unit._garrisonFinalPoint = null;
    }

    release(unit) {
        const state = this._states.get(unit);
        if (state) {
            this._dropSeat(state);
            this._queue.delete(state);
            this._states.delete(unit);
        }
        this._clearFlags(unit);
    }

    forget(unit) {
        this.release(unit);
        if (this._bodies.has(unit)) this._occupancyRevision++;
        this._remove(this._bodyBuckets, this._bodies.get(unit));
        this._bodies.delete(unit);
    }

    /** 复用已有表面更新的单位遍历；手控玩家只登记实际位置，绝不吸附或代发命令。 */
    observe(unit, now = Date.now()) {
        if (!this.config.enabled) { this.forget(unit); return; }
        const reservable = this.eligible(unit);
        const hostileBody = alive(unit) && unit._faction === 'enemy' && !unit.isStructure;
        if (!reservable && !hostileBody) { this.forget(unit); return; }
        const state = this._states.get(unit);
        if (state) {
            if (state.owner !== ownerOf(unit)) {
                const owner = ownerOf(unit);
                const guardTransition = (owner?.mode === 'hold' || owner?._guardFromHold)
                    && (state.owner?.mode === 'hold' || state.owner?._guardFromHold);
                // move 到达后转 hold：保留已经站稳的位置，新移动/攻击命令则释放旧预约。
                if (guardTransition) {
                    // 原地坚守索敌不改变驻守意图，也不能丢掉尚未到位的空位预约。
                    state.owner = owner;
                    state.touched = now;
                } else if (ownerOf(unit)?.mode === 'hold' && state.point && this.atSeat(unit, state.point)) {
                    state.owner = ownerOf(unit);
                    state.type = 'stop';
                    state.command = null;
                    state.settled = true;
                } else this.release(unit);
            } else if (state.settled && (unit._surfaceKind !== 'wall_walk'
                || groundDistance(unit, state.point) > 12)) this.release(unit);
            else if (this._isGroundStop(state) && unit.target
                && (!state.followAnchor || unit.target !== state.anchorTarget)) {
                // 攻击/治疗起手后可能直接返回AI更新，不一定经过MovementSystem。
                // 在已有表面观察中交还控制权，避免下一帧分配器把它拉回旧墙面。
                this.release(unit);
            }
            else state.touched = now;
        }
        const previousBody = this._bodies.get(unit);
        const stationary = unit._surfaceKind === 'wall_walk' && !unit.isMoving
            && Math.hypot(unit.vx || 0, unit.vy || 0) <= 4;
        if (previousBody && stationary && previousBody.point.x === unit.x && previousBody.point.y === unit.y
            && previousBody.point.z === unit.z && previousBody.radius === radiusOf(unit)) {
            previousBody.touched = now;
            return;
        }
        this._remove(this._bodyBuckets, previousBody);
        this._bodies.delete(unit);
        if (!stationary) {
            if (previousBody) this._occupancyRevision++;
            return;
        }
        const body = { unit, point: { x: unit.x, y: unit.y, z: unit.z }, radius: radiusOf(unit), touched: now };
        if (!previousBody || groundDistance(previousBody.point, body.point) > 1
            || Math.abs((previousBody.point.z || 0) - (body.point.z || 0)) > 1) this._occupancyRevision++;
        this._bodies.set(unit, body);
        this._insert(this._bodyBuckets, body);
    }

    _conflicts(unit, point, radius) {
        const { u, v } = worldDeltaToIsoLocal(point.x, point.y);
        const bx = Math.floor(u / BUCKET_SIZE), by = Math.floor(v / BUCKET_SIZE);
        const reach = Math.ceil((radius + this._adapter.maxUnitRadius + this.config.spacingGap) / BUCKET_SIZE);
        for (let x = bx - reach; x <= bx + reach; x++) {
            for (let y = by - reach; y <= by + reach; y++) {
                const key = `${x},${y}`;
                for (const index of [this._seats, this._bodyBuckets]) {
                    for (const other of index.get(key) || []) {
                        if (other.unit === unit || !alive(other.unit)) continue;
                        if (Math.abs((other.point.z || 0) - (point.z || 0)) > 12) continue;
                        // 实际停点允许到达误差；预约中心才要求完整部署间隔，避免相邻士兵互相重排。
                        const gap = index === this._seats ? this.config.spacingGap : 0;
                        const distance = other.unit._faction === 'enemy'
                            ? Math.hypot(point.x - other.point.x, point.y - other.point.y)
                            : groundDistance(point, other.point);
                        if (distance < radius + other.radius + gap - 0.01) return true;
                    }
                }
            }
        }
        return false;
    }

    *_candidates(state) {
        yield { x: state.goal.x, y: state.goal.y };
        const anchor = state.context.center;
        const step = radiusOf(state.unit) * 2 + this.config.spacingGap;
        const rings = Math.ceil(this.config.searchRadius / step);
        for (let ring = 0; ring <= rings; ring++) {
            for (let u = -ring; u <= ring; u++) {
                for (let v = -ring; v <= ring; v++) {
                    if (Math.max(Math.abs(u), Math.abs(v)) !== ring) continue;
                    const delta = isoLocalToWorldDelta(u * step, v * step);
                    const point = { x: anchor.x + delta.x, y: anchor.y + delta.y };
                    if (groundDistance(point, state.goal) <= this.config.searchRadius) yield point;
                }
            }
        }
    }

    _enqueue(state, now) {
        if (state.point || state.evacuating || now < state.retryAt) return;
        if (state.exhaustedRevision === this._occupancyRevision) return;
        this._queue.add(state);
        state.unit._garrisonStatus = 'allocating';
    }

    request(unit, goal, owner, type) {
        if (!this.eligible(unit)) return null;
        const now = Date.now();
        let state = this._states.get(unit);
        if (state && (state.owner !== owner || state.type !== type
            || (type === 'move' && (state.goal.wallId !== goal.wallId || groundDistance(state.goal, goal) > 1)))) {
            this.release(unit);
            state = null;
        }
        if (!state) {
            state = { unit, owner, type, goal: { ...goal, route: [] }, radius: radiusOf(unit),
                touched: now, retryAt: 0, point: null, command: null, settled: false,
                context: null, candidates: null, searchRevision: null, evacuating: false };
            this._states.set(unit, state);
            if (type === 'stop') {
                const followTarget = this._adapter.followTarget?.(unit, owner);
                state.anchorTarget = owner?.target || unit.target || followTarget;
                state.followAnchor = !!followTarget && state.anchorTarget === followTarget;
                state.anchorPosition = state.anchorTarget && { x: state.anchorTarget.x,
                    y: state.anchorTarget.y, z: state.anchorTarget.z || 0 };
            }
        }
        state.touched = now;
        this._enqueue(state, now);
        return state;
    }

    /** 只生成派生命令；原始点击点、战术命令与攻击目标保留在各自所有者上。 */
    prepareMove(unit, command) {
        if (!this.eligible(unit) || command?._garrisonInternal || command?._surfaceAutonomous
            || command?._surfaceExitRoute || command?.mode !== 'move'
            || command.point?.surfaceKind !== 'wall_walk') return null;
        const state = this.request(unit, command.point, command, 'move');
        if (state.navigationFailure) return { failed: true, ...state.navigationFailure };
        if (state.command?.point?.unreachable && Date.now() >= state.retryAt) {
            this.routeFailed(unit);
        }
        return { command: state.command, waiting: !state.command };
    }

    atSeat(unit, point) {
        return unit._surfaceKind === 'wall_walk' && point
            && Math.abs((unit.z || 0) - point.z) <= 12
            && Math.hypot(unit.x - point.x, unit.y - point.y) <= this.config.arriveDistance;
    }

    _isGroundStop(state) {
        return !!state && state.type === 'stop' && !state.settled && !state.evacuating
            && state.unit._surfaceKind === 'ground' && !state.unit._surfaceExitCommand;
    }

    /** 在AI空闲决策前调用。正在起手的攻击/施法由调用方先完成，不被驻守打断。 */
    prepareStop(unit, force = false) {
        if (!this.eligible(unit)) return null;
        let state = this._states.get(unit);
        const owner = ownerOf(unit);
        if (state && state.owner !== owner) {
            this.observe(unit);
            state = this._states.get(unit);
        }
        if (owner?.mode === 'move' || unit._surfaceExitCommand || unit._surfaceKind === 'stairs') return null;
        if (state?.type === 'move') return null;
        if (state && !state.settled && state.anchorTarget
            && (!alive(state.anchorTarget)
                || groundDistance(state.anchorTarget, state.anchorPosition) > (state.followAnchor ? 48 : 96)
                || (state.followAnchor && (state.anchorTarget._surfaceKind !== 'wall_walk'
                    || Math.abs((state.anchorTarget.z || 0) - state.anchorPosition.z) > 12)))) {
            this.release(unit);
            return null;
        }
        if (!state) {
            // 新攻击指令先交给原AI判断追击/停步，不能拿上一条hold的零速度抢占新命令。
            if (!force && owner?.mode === 'attack' && unit.target !== owner.target) return null;
            if (unit._surfaceKind !== 'wall_walk' || unit._surfaceNavCommand
                || (!force && owner?.mode !== 'hold' && (unit.maxSpeed > 0 || unit.isMoving))) return null;
            state = this.request(unit, { x: unit.x, y: unit.y, z: unit.z,
                surfaceKind: 'wall_walk', wallId: unit._surfaceWall?.id }, owner, 'stop');
        }
        state.touched = Date.now();
        if (state.point && this.atSeat(unit, state.point)) {
            state.settled = true;
            state.command = null;
            unit._garrisonStatus = 'stationed';
            unit._garrisonMoveCommand = null;
            // 手控玩家后来站进驻守位时，士兵重新找位，玩家保持自由移动。
            if (!this._conflicts(unit, state.point, state.radius)) return null;
            this._dropSeat(state);
            state.settled = false;
        } else if (state.settled) {
            // 自主追敌/跟随已经离位，不把AI拉回历史站位。
            this.release(unit);
            return null;
        }
        if (state.command) return { command: state.command };
        this._enqueue(state, state.touched);
        return { waiting: true, allowDecision: this._isGroundStop(state) };
    }

    finishInternal(unit) {
        const state = this._states.get(unit);
        if (!state) return;
        state.command = null;
        unit._garrisonMoveCommand = null;
        if (state.evacuating) {
            state.evacuating = false;
            state.retryAt = Date.now() + this.config.retryMs;
            unit._garrisonStatus = 'full';
        } else {
            state.settled = true;
            unit._garrisonStatus = 'stationed';
        }
    }

    routeFailed(unit) {
        const state = this._states.get(unit);
        if (!state) return;
        this._dropSeat(state);
        this._queue.delete(state);
        state.evacuating = false;
        state.candidates = null;
        state.retryAt = Date.now() + this.config.retryMs;
        state.exhaustedRevision = null;
        unit._garrisonMoveCommand = null;
        unit._garrisonStatus = 'unreachable';
    }

    invalidateRoute(unit) {
        const command = this._states.get(unit)?.command;
        if (!command?.point) return;
        command.point = { ...command.point, routeRevision: -1 };
        command.routeIndex = 0;
        command._surfaceProgress = null;
    }

    /** 地面待位只拦截旧跟随点；索敌、治疗、撤退和其它新行动仍由原AI决定。 */
    holdGroundWait(unit, semanticGoal) {
        const state = this._states.get(unit);
        if (!this._isGroundStop(state) || state.command) return false;
        const oldFollowGoal = state.followAnchor && semanticGoal?._surfaceTarget === state.anchorTarget;
        if (state.owner !== ownerOf(unit)
            || (unit.target && (!state.followAnchor || unit.target !== state.anchorTarget))
            || (semanticGoal && !oldFollowGoal)) {
            this.release(unit);
            return false;
        }
        // 仍在等待同一墙面的空位时不重复上下楼；无移动意图的待命同样保持原位。
        return true;
    }

    holdFollowPosition(unit, semanticGoal) {
        const state = this._states.get(unit);
        if (!state?.settled || !state.followAnchor || !state.point
            || semanticGoal?._surfaceTarget !== state.anchorTarget) return false;
        const target = state.anchorTarget;
        if (!alive(target) || target._surfaceKind !== 'wall_walk'
            || Math.abs((target.z || 0) - state.anchorPosition.z) > 12
            || groundDistance(target, state.anchorPosition) > 48 || !this.atSeat(unit, state.point)) {
            this.release(unit);
            return false;
        }
        // AI继续正常索敌；仅将“玩家没移动的旧跟随偏移点”视为已在获分配的位置到达。
        // 否则兵种会在自己的槽位与共享跟随点之间反复往返。
        return true;
    }

    /** 固定候选/路线次数和软时间预算；未完成的搜索保留游标，下一帧继续。 */
    beginFrame(now = Date.now()) {
        if (!this._adapter || !this.config.enabled) return;
        const revision = this._adapter.revision();
        if (revision !== this._revision) {
            this._geometry.clear();
            for (const state of this._states.values()) {
                this._dropSeat(state);
                if (state.type === 'stop' && state.unit._surfaceKind === 'wall_walk') {
                    state.goal = { x: state.unit.x, y: state.unit.y, z: state.unit.z,
                        surfaceKind: 'wall_walk', wallId: state.unit._surfaceWall?.id, route: [] };
                }
                state.context = null;
                state.candidates = null;
                state.settled = false;
                state.evacuating = false;
                state.retryAt = 0;
                state.exhaustedRevision = null;
                state.unit._garrisonMoveCommand = null;
                this._queue.add(state);
            }
            this._revision = revision;
        }
        if (now >= this._pruneAt) {
            this._pruneAt = now + 250;
            for (const state of this._states.values()) {
                if (!alive(state.unit) || now - state.touched > this.config.leaseMs) this.forget(state.unit);
            }
            for (const body of this._bodies.values()) {
                if (!alive(body.unit) || now - body.touched > 1000) {
                    this._remove(this._bodyBuckets, body);
                    this._bodies.delete(body.unit);
                    this._occupancyRevision++;
                }
            }
        }
        let candidates = 0, plans = 0;
        const start = clock();
        // 每次取队首做一个候选再放队尾，大批命令不会让队首的大搜索饿死后续单位。
        while (this._queue.size && candidates < this.config.maxCandidatesPerFrame
            && plans < this.config.maxPlansPerFrame && clock() - start < this.config.budgetMs) {
            const state = this._queue.values().next().value;
            this._queue.delete(state);
            if (!alive(state.unit) || state.owner !== ownerOf(state.unit)) { this.release(state.unit); continue; }
            if (state.evacuating) continue;
            candidates++;
            if (!state.context) state.context = this._adapter.context(state.goal);
            if (!state.context) {
                if (state.type === 'stop') { this.release(state.unit); continue; }
                state.unit._garrisonStatus = 'unreachable';
                state.retryAt = now + this.config.retryMs;
                continue;
            }
            if (!state.candidates) {
                state.searchRevision = this._occupancyRevision;
                state.candidates = this._candidates(state);
            }
            const next = state.candidates.next();
            if (next.done) {
                state.candidates = null;
                state.retryAt = now + this.config.retryMs;
                state.unit._garrisonStatus = 'full';
                // 游标跨帧保留，已检查的位置可能在本轮后半段腾空。
                // 记录起始版本；只有整轮占用未变时才抑制重试，否则退避后重新搜索。
                state.exhaustedRevision = state.searchRevision;
                if (state.unit._surfaceKind === 'wall_walk') {
                    plans++;
                    const point = this._adapter.evacuate(state.unit);
                    if (point && !point.unreachable) {
                        state.evacuating = true;
                        state.command = { mode: 'move', point, _garrisonInternal: true, _garrisonEvacuation: true };
                        state.unit._garrisonStatus = 'leaving';
                    }
                }
                continue;
            }
            const xy = next.value;
            const combatTarget = state.type === 'stop' && state.anchorTarget?._faction === 'enemy'
                ? state.anchorTarget : null;
            if (combatTarget && Math.hypot(xy.x - combatTarget.x, xy.y - combatTarget.y)
                > Math.hypot(state.goal.x - combatTarget.x, state.goal.y - combatTarget.y) + 2) {
                this._queue.add(state);
                continue;
            }
            const key = `${state.context.id}:${state.radius}:${xy.x.toFixed(2)}:${xy.y.toFixed(2)}`;
            let point = this._geometry.get(key);
            if (point === undefined) {
                point = this._adapter.candidate(state.unit, state.context, xy, this.config.portalClearance) || null;
                if (this._geometry.size >= 4096) this._geometry.clear();
                this._geometry.set(key, point);
            }
            if (point && !this._conflicts(state.unit, point, state.radius)) {
                plans++;
                const routed = this._adapter.route(state.unit, point);
                if (routed && !routed.unreachable) {
                    state.point = point;
                    state.command = { mode: 'move', point: { ...routed, garrisonSlot: true },
                        _garrisonInternal: true };
                    state.unit._garrisonStatus = 'positioning';
                    state.unit._garrisonFinalPoint = point;
                    this._insert(this._seats, state);
                    this._reservedCount++;
                    this._occupancyRevision++;
                    continue;
                }
                // 没有楼梯路线不是满员，不在同帧对相同墙链的每个空位重复规划。
                if (state.type === 'move' && routed?.unreachable && routed.navigationStatus) {
                    state.navigationFailure = { reason: routed.reason, status: routed.navigationStatus };
                }
                state.retryAt = now + this.config.retryMs;
                state.candidates = null;
                state.unit._garrisonStatus = 'unreachable';
                continue;
            }
            this._queue.add(state);
        }
        this.stats = { candidates, plans, queued: this._queue.size,
            reserved: this._reservedCount, usedMs: clock() - start };
    }
}

export const ElevatedGarrison = new ElevatedGarrisonImpl();
