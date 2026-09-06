const DEFAULT_RESERVATION_TTL_MS = 1400;
const DEFAULT_QUEUE_WAIT_TIMEOUT_MS = 6000;
const DEFAULT_PRUNE_INTERVAL_MS = 250;

function _toPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.max(1, Math.trunc(parsed));
}

function _normalizeDirection(direction) {
    if (direction === 'down' || direction === 'd' || direction === -1
        || direction === 'downward') return 'down';
    if (direction === 'up' || direction === 'u' || direction === 1
        || direction === 'upward') return 'up';
    const text = String(direction || '').toLowerCase();
    if (text.startsWith('d')) return 'down';
    if (text.startsWith('u')) return 'up';
    return 'up';
}

function _validEntity(entity) {
    return entity && entity.active !== false;
}

function _friendlyUnit(entity) {
    const faction = entity?._faction || entity?.faction;
    return faction === 'player' || faction === 'companion';
}

/**
 * 单座窄楼梯入口保持 FIFO；首个友军实际取得楼梯身份后，同方向友军可流水进入，
 * 因高架阶段已关闭友军 unit-vs-unit 分离，不再需要用整段楼梯互斥防推挤。
 * 反方向仍保持互斥，避免上下行在同一窄梯抢占表面控制权。
 * 相邻宽楼梯组由控制器识别后直接绕过本锁；宽入口不会退化成整组只允许一人使用。
 */
export class ElevatedRouteTraffic {
    constructor(config = {}) {
        this._records = new Map();
        this._entityState = new Map();
        this._timedOutEntities = new WeakMap();
        this._lastPruneAt = 0;
        this.configure(config);
    }

    configure(config = {}) {
        this._reservationTtlMs = _toPositiveInt(
            config.reservationTtlMs ?? config.portalReservationTtlMs,
            DEFAULT_RESERVATION_TTL_MS
        );
        this._queueWaitTimeoutMs = _toPositiveInt(
            config.queueWaitTimeoutMs ?? config.portalQueueWaitTimeoutMs,
            DEFAULT_QUEUE_WAIT_TIMEOUT_MS
        );
        this._pruneIntervalMs = _toPositiveInt(
            config.pruneIntervalMs ?? config.portalPruneIntervalMs,
            DEFAULT_PRUNE_INTERVAL_MS
        );
        return this;
    }

    reset() {
        this._records.clear();
        this._entityState.clear();
        this._timedOutEntities = new WeakMap();
        this._lastPruneAt = 0;
    }

    directionFor(entity) {
        const state = this._entityState.get(entity);
        const record = state && this._records.get(state.staircaseId);
        return record?.holders.get(entity)?.direction
            || record?.queue.find((entry) => entry.entity === entity)?.direction || null;
    }

    /** 调试只读：不 prune/touch/request，打开面板不能改变FIFO或许可寿命。 */
    debugEntity(entity, now = Date.now()) {
        const state = this._entityState.get(entity);
        const record = state && this._records.get(state.staircaseId);
        if (!record) return null;
        const queueIndex = record.queue.findIndex((entry) => entry.entity === entity);
        const entry = record.holders.get(entity) || record.queue[queueIndex];
        return {
            staircaseId: state.staircaseId, role: state.role,
            direction: entry?.direction || null, holderDirection: record.direction || null,
            queuePosition: queueIndex >= 0 ? queueIndex + 1 : 0,
            queueLength: record.queue.length, holders: record.holders.size,
            waitingMs: entry?.enqueuedAt ? Math.max(0, now - entry.enqueuedAt) : 0,
            leaseRemainingMs: entry ? Math.max(0, entry.expiresAt - now) : 0,
        };
    }

    touch(entity, now = Date.now()) {
        now = Number(now) || Date.now();
        const state = this._entityState.get(entity);
        if (!state) return false;
        const record = this._records.get(state.staircaseId);
        if (!record) return false;

        if (state.role === 'holder') {
            const holder = record.holders.get(entity);
            if (!holder) {
                this._entityState.delete(entity);
                return false;
            }
            if (_validEntity(entity)) {
                holder.expiresAt = now + this._reservationTtlMs;
                return true;
            }
            this._removeHolder(record, state.staircaseId, entity, now);
            return false;
        }

        if (state.role === 'queued') {
            const queued = record.queue.find((entry) => entry.entity === entity);
            if (!queued) {
                this._entityState.delete(entity);
                return false;
            }
            if (!_validEntity(entity)) {
                this._removeQueuedEntity(record, entity, now);
                return false;
            }
            return true;
        }
        return false;
    }

    /** 楼梯组拓扑变化后，把实际驻梯单位的占用权迁移到新的组键。 */
    occupy(entity, staircaseId, now = Date.now(), fallbackDirection = 'up') {
        const sid = this._normalizeStaircaseId(staircaseId);
        if (!sid || !this._physicallyOccupies(entity, sid)) return false;
        const previous = this._entityState.get(entity);
        let direction = _normalizeDirection(fallbackDirection);
        if (previous) {
            const previousRecord = this._records.get(previous.staircaseId);
            direction = previousRecord?.holders.get(entity)?.direction
                || previousRecord?.queue.find((entry) => entry.entity === entity)?.direction
                || direction;
            if (previous.staircaseId === sid && previous.role === 'holder'
                && this.touch(entity, now)) return true;
            if (previous.staircaseId !== sid) this.release(entity);
        }
        const record = this._getRecord(sid, true);
        this._removeQueuedEntity(record, entity, now);
        this._timedOutEntities.delete(entity);
        // 实际驻梯是既成占用，不能再调用入口 request 把它排到梯外预约者后面。
        // 宽梯缩窄/组键变化时先撤回尚未入梯的许可，保留其原先领先的排队顺序。
        this._requeueEntrants(record, sid, now);
        this._grant(record, sid, entity, direction, now);
        return true;
    }

    /** 上方出口失效时，实际驻梯者改为向地面退避；不得释放占用后重新排队。 */
    retreatToGround(entity, staircaseId, now = Date.now()) {
        const sid = this._normalizeStaircaseId(staircaseId);
        if (!this.occupy(entity, sid, now, 'down')) return false;
        const record = this._records.get(sid);
        const holder = record?.holders.get(entity);
        if (!holder) return false;
        if (holder.direction === 'down') return true;
        this._requeueEntrants(record, sid, now);
        holder.direction = 'down';
        this._refreshDirection(record);
        return true;
    }

    request(entity, staircaseId, direction, now = Date.now()) {
        now = Number(now) || Date.now();
        const sid = this._normalizeStaircaseId(staircaseId);
        const dir = _normalizeDirection(direction);
        if (!_validEntity(entity) || !sid) return this._result(null, false);

        if (this._timedOutEntities.get(entity) === sid) {
            this._timedOutEntities.delete(entity);
            const record = this._getRecord(sid, true);
            return { ...this._result(record, false), timedOut: true };
        }

        const initialState = this._entityState.get(entity);
        if (initialState?.staircaseId === sid && initialState.role === 'queued') {
            const initialRecord = this._records.get(sid);
            const queued = initialRecord?.queue.find((entry) => entry.entity === entity);
            if (queued && queued.expiresAt <= now) {
                this._removeQueuedEntity(initialRecord, entity, now);
                return { ...this._result(initialRecord, false), timedOut: true };
            }
        }

        this.prune(now);
        const currentState = this._entityState.get(entity);
        if (currentState && currentState.staircaseId !== sid) this.release(entity);
        const record = this._getRecord(sid, true);
        this._pruneRecord(record, sid, now);

        const holder = record.holders.get(entity);
        if (holder) {
            holder.expiresAt = now + this._reservationTtlMs;
            if (holder.direction === dir) return this._result(record, true, entity);
            if (record.holders.size === 1) {
                holder.direction = dir;
                record.direction = dir;
                return this._result(record, true, entity);
            }
            // 多人同向通行时，梯中反向者仍是实际占用者，不能移到入口队列。
            // 路线控制器会先按原方向离梯；此处只拒绝反向许可，坡内手动位移及
            // 梯底撤离仍由物理层处理，不能把实际占用者移到队列后丢失出梯能力。
            if (entity._surfaceKind === 'stairs') {
                return { ...this._result(record, false, entity), mustExitFirst: true };
            }
            record.holders.delete(entity);
            this._entityState.delete(entity);
            this._refreshDirection(record);
            if (record.holders.size === 0) {
                record.direction = null;
                this._grant(record, sid, entity, dir, now);
                return this._result(record, true, entity);
            }
            record.queue.push({
                entity,
                direction: dir,
                enqueuedAt: now,
                expiresAt: now + this._queueWaitTimeoutMs,
            });
            this._entityState.set(entity, { staircaseId: sid, role: 'queued' });
            return this._result(record, false, entity, record.queue.length);
        }

        const queuedIndex = record.queue.findIndex((entry) => entry.entity === entity);
        if (queuedIndex >= 0) {
            record.queue[queuedIndex].direction = dir;
            if (record.holders.size === 0) {
                record.queue.splice(queuedIndex, 1);
                this._markQueueProgress(record, now, queuedIndex);
                this._grant(record, sid, entity, dir, now);
                return this._result(record, true, entity);
            }
            if (this._canShareFriendlyLane(record, sid, entity, dir)) {
                record.queue.splice(queuedIndex, 1);
                this._markQueueProgress(record, now, queuedIndex);
                this._grant(record, sid, entity, dir, now);
                return this._result(record, true, entity);
            }
            return this._result(record, false, entity, queuedIndex + 1);
        }

        if (record.holders.size === 0) {
            this._grant(record, sid, entity, dir, now);
            return this._result(record, true, entity);
        }
        if (this._canShareFriendlyLane(record, sid, entity, dir)) {
            this._grant(record, sid, entity, dir, now);
            return this._result(record, true, entity);
        }

        record.queue.push({
            entity,
            direction: dir,
            enqueuedAt: now,
            expiresAt: now + this._queueWaitTimeoutMs,
        });
        this._entityState.set(entity, { staircaseId: sid, role: 'queued' });
        return this._result(record, false, entity, record.queue.length);
    }

    release(entity) {
        const state = this._entityState.get(entity);
        if (!state) return false;
        const record = this._records.get(state.staircaseId);
        if (!record) {
            this._entityState.delete(entity);
            return false;
        }
        if (state.role === 'holder') {
            return this._removeHolder(record, state.staircaseId, entity, Date.now());
        }
        if (state.role === 'queued') return this._removeQueuedEntity(record, entity, Date.now());
        this._entityState.delete(entity);
        return false;
    }

    queueLength(staircaseId) {
        const sid = this._normalizeStaircaseId(staircaseId);
        if (!sid) return 0;
        const record = this._records.get(sid);
        if (!record) return 0;
        this._pruneRecord(record, sid, Date.now());
        return this._calcQueueLength(record);
    }

    permission(entity, staircaseId, direction) {
        const sid = this._normalizeStaircaseId(staircaseId);
        const normalizedDirection = _normalizeDirection(direction);
        // 已经在楼梯上的单位必须能从底部撤离，不能被旧的上楼许可锁死。
        if (sid && normalizedDirection === 'down' && this._physicallyOccupies(entity, sid)) {
            return true;
        }
        const state = this._entityState.get(entity);
        if (!sid || !state || state.staircaseId !== sid || state.role !== 'holder') return false;
        const record = this._records.get(sid);
        const holder = record?.holders.get(entity);
        return !!holder && holder.direction === normalizedDirection;
    }

    penalty(staircaseId, direction) {
        const sid = this._normalizeStaircaseId(staircaseId);
        if (!sid) return 0;
        this.prune(Date.now());
        const record = this._records.get(sid);
        if (!record) return 0;
        const requestedDirection = _normalizeDirection(direction);
        const opposite = [...record.holders.values()].some((holder) =>
            holder.direction !== requestedDirection);
        return record.queue.length + (opposite ? 1 : 0);
    }

    prune(now = Date.now()) {
        now = Number(now) || Date.now();
        if (now - this._lastPruneAt < this._pruneIntervalMs) return false;
        this._lastPruneAt = now;
        let changed = false;
        for (const [staircaseId, record] of this._records) {
            const before = this._calcQueueLength(record);
            this._pruneRecord(record, staircaseId, now);
            const after = this._calcQueueLength(record);
            if (after === 0) {
                this._records.delete(staircaseId);
                changed = true;
            } else if (before !== after) {
                changed = true;
            }
        }
        return changed;
    }

    _normalizeStaircaseId(staircaseId) {
        if (typeof staircaseId !== 'string') return '';
        const id = staircaseId.trim();
        return id ? id : '';
    }

    _physicallyOccupies(entity, staircaseId) {
        const carrier = entity?._surfaceStaircase || entity?._surfaceRef;
        const entityGroupId = carrier?._wallStairGroupId || entity?._surfaceStairGroupId;
        return _validEntity(entity)
            && entity._surfaceKind === 'stairs'
            && carrier?.active !== false && !carrier?._sinking
            && (entityGroupId === staircaseId
                || entity._surfaceStaircase?.id === staircaseId
                || entity._surfaceRef?.id === staircaseId);
    }

    _canShareFriendlyLane(record, staircaseId, entity, direction) {
        if (!_friendlyUnit(entity) || !record || record.holders.size === 0) return false;
        if (record.direction !== direction) return false;
        if (record.queue.length > 0 && record.queue[0].entity !== entity) return false;
        for (const holder of record.holders.values()) {
            if (!_friendlyUnit(holder.entity)
                || holder.direction !== direction
                || !this._physicallyOccupies(holder.entity, staircaseId)) {
                return false;
            }
        }
        return true;
    }

    _getRecord(staircaseId, create = false) {
        if (!create && !this._records.has(staircaseId)) return null;
        if (!this._records.has(staircaseId)) {
            this._records.set(staircaseId, {
                direction: null,
                holders: new Map(),
                queue: [],
            });
        }
        return this._records.get(staircaseId);
    }

    _requeueEntrants(record, staircaseId, now) {
        const displaced = [];
        for (const [waitingEntity, holder] of record.holders) {
            if (this._physicallyOccupies(waitingEntity, staircaseId)) continue;
            record.holders.delete(waitingEntity);
            if (!_validEntity(waitingEntity)) {
                this._entityState.delete(waitingEntity);
                continue;
            }
            displaced.push({
                entity: waitingEntity,
                direction: holder.direction,
                enqueuedAt: now,
                expiresAt: now + this._queueWaitTimeoutMs,
            });
            this._entityState.set(waitingEntity, { staircaseId, role: 'queued' });
        }
        record.queue.unshift(...displaced);
    }

    _grant(record, staircaseId, entity, direction, now) {
        record.holders.set(entity, {
            entity,
            direction,
            expiresAt: now + this._reservationTtlMs,
        });
        this._refreshDirection(record);
        this._entityState.set(entity, { staircaseId, role: 'holder' });
    }

    /** 拆建迁移可能暂时同时存在上下行占用；混合方向不发布单向摘要。 */
    _refreshDirection(record) {
        let direction = null;
        for (const holder of record.holders.values()) {
            if (direction && direction !== holder.direction) {
                record.direction = null;
                return;
            }
            direction = holder.direction;
        }
        record.direction = direction;
    }

    _removeHolder(record, staircaseId, entity, now = Date.now()) {
        const removed = record.holders.delete(entity);
        this._entityState.delete(entity);
        this._refreshDirection(record);
        if (record.holders.size === 0) {
            record.direction = null;
            this._promoteNext(record, staircaseId, now);
        }
        return removed;
    }

    _promoteNext(record, staircaseId, now) {
        if (record.holders.size > 0) return;
        while (record.queue.length && (!_validEntity(record.queue[0].entity)
            || record.queue[0].expiresAt <= now)) {
            const expired = record.queue.shift();
            if (_validEntity(expired.entity) && expired.expiresAt <= now) {
                this._timedOutEntities.set(expired.entity, staircaseId);
            }
            this._entityState.delete(expired.entity);
        }
        if (!record.queue.length) {
            record.direction = null;
            return;
        }
        while (record.queue.length) {
            const next = record.queue.shift();
            if (!_validEntity(next.entity) || next.expiresAt <= now) {
                this._entityState.delete(next.entity);
                continue;
            }
            this._grant(record, staircaseId, next.entity, next.direction, now);
            this._markQueueProgress(record, now);
            break;
        }
    }

    /** 仅在 FIFO 实际前进时续期；重复 request 不会延长一个完全停滞的队列。 */
    _markQueueProgress(record, now = Date.now(), startIndex = 0) {
        const firstAdvancedIndex = Math.max(0, Math.trunc(Number(startIndex) || 0));
        for (let i = firstAdvancedIndex; i < record.queue.length; i++) {
            record.queue[i].expiresAt = now + this._queueWaitTimeoutMs;
        }
    }

    _removeQueuedEntity(record, entity, now = Date.now()) {
        const index = record.queue.findIndex((entry) => entry.entity === entity);
        if (index >= 0) {
            record.queue.splice(index, 1);
            this._markQueueProgress(record, now, index);
        }
        this._entityState.delete(entity);
        return index >= 0;
    }

    _pruneRecord(record, staircaseId, now = Date.now()) {
        let changed = false;
        for (const [entity, holder] of [...record.holders]) {
            if (holder.expiresAt <= now && this._physicallyOccupies(entity, staircaseId)) {
                holder.expiresAt = now + this._reservationTtlMs;
                continue;
            }
            if (!_validEntity(entity) || holder.expiresAt <= now) {
                record.holders.delete(entity);
                this._entityState.delete(entity);
                changed = true;
            }
        }
        const nextQueue = [];
        let firstAdvancedIndex = -1;
        for (const entry of record.queue) {
            if (!_validEntity(entry.entity) || entry.expiresAt <= now) {
                if (_validEntity(entry.entity) && entry.expiresAt <= now) {
                    this._timedOutEntities.set(entry.entity, staircaseId);
                }
                this._entityState.delete(entry.entity);
                changed = true;
                if (firstAdvancedIndex < 0) firstAdvancedIndex = nextQueue.length;
            } else {
                nextQueue.push(entry);
            }
        }
        record.queue = nextQueue;
        if (firstAdvancedIndex >= 0) {
            this._markQueueProgress(record, now, firstAdvancedIndex);
        }
        this._refreshDirection(record);
        if (record.holders.size === 0) {
            record.direction = null;
            this._promoteNext(record, staircaseId, now);
        }
        return changed;
    }

    _calcQueueLength(record) {
        return record.holders.size + record.queue.length;
    }

    _result(record, granted, entity = null, queuePosition = 0) {
        return {
            granted,
            queuePosition,
            queueLength: record ? this._calcQueueLength(record) : 0,
            holderDirection: record?.direction || null,
            batchSize: record?.holders.size || 0,
            entity,
        };
    }
}
