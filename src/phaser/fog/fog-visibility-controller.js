function nowMs() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function isFogControlled(entity) {
    if (!entity) return false;
    const faction = entity._faction || entity.faction;
    return faction === 'enemy' || faction === 'agent' || faction === 'neutral'
        || !!entity.itemData || !!entity._fogRequiresVisibility || !!entity._fogRequiresExploration;
}

/**
 * 将迷雾实体裁切从逐帧全表扫描降为：受控实体集合 10Hz 同步、全实体表 1Hz 兜底校准。
 * 这里只调用视觉回调，不修改实体 active、AI、物理、碰撞或寻路状态。
 */
export class FogVisibilityController {
    constructor(scene, fogSystem, visualAdapter, applyEntityHidden) {
        this.scene = scene;
        this.fogSystem = fogSystem;
        this.visualAdapter = visualAdapter;
        this.applyEntityHidden = applyEntityHidden;
        this.sceneId = null;
        this.entities = new Set();
        this.hiddenEntities = new Set();
        this.lastEntityMap = null;
        this.lastEntityCount = -1;
        this.nextReconcileAt = 0;
        this.nextSyncAt = 0;
        this.stats = {
            durationMs: 0,
            controlledEntities: 0,
            appliedEntities: 0,
            enforcedHiddenEntities: 0,
            reconcileCount: 0,
        };
    }

    _restoreAndReset(sceneId) {
        for (const entity of this.entities) this.applyEntityHidden?.(entity, false);
        this.entities.clear();
        this.hiddenEntities.clear();
        this.lastEntityMap = null;
        this.lastEntityCount = -1;
        this.nextReconcileAt = 0;
        this.nextSyncAt = 0;
        this.sceneId = sceneId;
    }

    _reconcile(game, now) {
        const discovered = new Set();
        const entityMap = game?.entities;
        if (entityMap && typeof entityMap.values === 'function') {
            for (const entity of entityMap.values()) {
                if (isFogControlled(entity)) discovered.add(entity);
            }
        }
        for (const entity of this.entities) {
            if (!discovered.has(entity)) {
                this.applyEntityHidden?.(entity, false);
                this.hiddenEntities.delete(entity);
            }
        }
        this.entities = discovered;
        this.lastEntityMap = entityMap || null;
        this.lastEntityCount = entityMap?.size ?? 0;
        this.nextReconcileAt = now + 1000;
        this.stats.reconcileCount += 1;
    }

    sync(sceneId, game, nowValue = Date.now(), options = {}) {
        const now = Number.isFinite(nowValue) ? nowValue : Date.now();
        if (sceneId !== this.sceneId) this._restoreAndReset(sceneId);
        const entityMap = game?.entities || null;
        if (options.force || entityMap !== this.lastEntityMap
            || (entityMap?.size ?? 0) !== this.lastEntityCount || now >= this.nextReconcileAt) {
            this._reconcile(game, now);
        }
        if (!options.force && now < this.nextSyncAt) return false;
        this.nextSyncAt = now + Math.max(16, Number(this.fogSystem.config.visibilitySyncIntervalMs)
            || Number(this.fogSystem.config.updateIntervalMs) || 100);

        const startedAt = nowMs();
        const enabled = this.fogSystem.isEnabled(sceneId);
        let appliedEntities = 0;
        for (const entity of this.entities) {
            if (!entity || entity.active === false) continue;
            const hidden = enabled && this.fogSystem.shouldHideEntity(sceneId, entity);
            this.applyEntityHidden?.(entity, hidden);
            if (hidden) this.hiddenEntities.add(entity);
            else this.hiddenEntities.delete(entity);
            appliedEntities += 1;
        }
        this.visualAdapter.syncAll(sceneId, this.fogSystem);
        this.stats.durationMs = nowMs() - startedAt;
        this.stats.controlledEntities = this.entities.size;
        this.stats.appliedEntities = appliedEntities;
        return true;
    }

    enforceHidden() {
        for (const entity of this.hiddenEntities) {
            if (entity?.active === false) {
                this.hiddenEntities.delete(entity);
                continue;
            }
            this.applyEntityHidden?.(entity, true);
        }
        this.visualAdapter.enforceHidden?.();
        this.stats.enforcedHiddenEntities = this.hiddenEntities.size;
    }

    getDebugModel() {
        return { ...this.stats };
    }

    destroy() {
        this._restoreAndReset(null);
    }
}

export default FogVisibilityController;
