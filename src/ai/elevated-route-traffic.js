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
    occupy(entity, staircaseId, now = Date.now()) {
        const sid = this._normalizeStaircaseId(staircaseId);
        if (!_validEntity(entity) || !sid) return false;
        const previous = this._entityState.get(entity);
        let direction = 'up';
        if (previous) {
            const previousRecord = this._records.get(previous.staircaseId);
            direction = previousRecord?.holders.get(entity)?.direction
                || previousRecord?.queue.find((entry) => entry.entity === entity)?.direction
                || direction;
            if (previous.staircaseId === sid) return this.touch(entity, now);
            this.release(entity);
        }
        return !!this.request(entity, sid, direction, now).granted;
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
            record.holders.delete(entity);
            this._entityState.delete(entity);
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
        const opposite = record.direction && record.direction !== _normalizeDirection(direction);
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
        const entityGroupId = entity?._surfaceStairGroupId
            || entity?._surfaceStaircase?._wallStairGroupId
            || entity?._surfaceRef?._wallStairGroupId;
        return _validEntity(entity)
            && entity._surfaceKind === 'stairs'
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

    _grant(record, staircaseId, entity, direction, now) {
        record.direction = direction;
        record.holders.set(entity, {
            entity,
            direction,
            expiresAt: now + this._reservationTtlMs,
        });
        this._entityState.set(entity, { staircaseId, role: 'holder' });
    }

    _removeHolder(record, staircaseId, entity, now = Date.now()) {
        const removed = record.holders.delete(entity);
        this._entityState.delete(entity);
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
