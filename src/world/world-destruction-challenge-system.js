// 全位面通用的毁灭挑战：按位面世代持久化，当前位面物化怪物，传送门毁灭后终止。
import { GAME_CONFIG } from '../config/game-config.js';
import { DefenseSystem } from './defense-system.js';
import { EnvironmentLightingSystem } from './environment-lighting-system.js';
import { WorldProgressionSystem } from './world-progression-system.js';

const VERSION = 1;
const clone = (value) => JSON.parse(JSON.stringify(value));

function config() {
    return WorldProgressionSystem.config?.destructionChallenge || {};
}

function currentGameTimeMs() {
    return Math.max(0,
        Number(EnvironmentLightingSystem.serializeTime()?.elapsedMs) || 0);
}

function positiveInt(value, fallback) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function spawnIntervalMs() {
    return positiveInt(config().spawnIntervalMs, 5000);
}

function normalPerBatch() {
    return positiveInt(config().normalPerBatch, 6);
}

function softMaxAlive() {
    return positiveInt(config().softMaxAlive, 36);
}

function hardMaxAlive() {
    return Math.max(softMaxAlive(), positiveInt(config().hardMaxAlive, 60));
}

function spawnPerFrame() {
    return positiveInt(config().spawnPerFrame, 2);
}

function milestoneReserve() {
    return Math.max(0, Math.floor(Number(config().milestoneReserve) || 6));
}

function eliteEveryNormals() {
    return positiveInt(config().eliteEveryNormals, 30);
}

function lordEveryNormals() {
    return positiveInt(config().lordEveryNormals, 60);
}

function eliteBaseCount() {
    return positiveInt(config().eliteBaseCount, 1);
}

function eliteIncreaseEveryCycles() {
    return positiveInt(config().eliteIncreaseEveryCycles, 1);
}

function lordBaseCount() {
    return positiveInt(config().lordBaseCount, 1);
}

function lordIncreaseEveryCycles() {
    return positiveInt(config().lordIncreaseEveryCycles, 2);
}

function cycleNumberAt(normalCount) {
    return Math.max(1, Math.ceil(Math.max(0, Number(normalCount) || 0) / lordEveryNormals()));
}

function milestoneMonsterCount(tier, cycleNumber) {
    const cycle = Math.max(1, positiveInt(cycleNumber, 1));
    if (tier === 'lord') {
        return lordBaseCount() + Math.floor((cycle - 1) / lordIncreaseEveryCycles());
    }
    return eliteBaseCount() + Math.floor((cycle - 1) / eliteIncreaseEveryCycles());
}

function initialState() {
    return { version: VERSION, worlds: {} };
}

let state = initialState();

function notify(text, color = '#ff765c', duration = 4800) {
    if (typeof window === 'undefined') return;
    window.SceneManager?.showTopNotification?.(text, {
        color,
        fontSize: '30px',
        duration,
    });
}

function worldName(sceneId) {
    return WorldProgressionSystem.getWorldConfig(sceneId)?.name || sceneId;
}

function portalSupportsChallenge(sceneId, worldEpoch = null) {
    const portal = WorldProgressionSystem.getPortalState(sceneId);
    if (!portal?.constructed || portal.destroyed) return false;
    return worldEpoch === null
        || WorldProgressionSystem.isWorldEpochCurrent(sceneId, worldEpoch);
}

function rightCornerSpawnPoints(sceneId) {
    const runtimeSceneId = WorldProgressionSystem.getRuntimeSceneId(sceneId) || sceneId;
    const scene = GAME_CONFIG.scenes?.[runtimeSceneId] || {};
    const width = Math.max(1, Number(scene.width) || 12288);
    const height = Math.max(1, Number(scene.height) || 8192);
    const originX = Number(scene.origin?.x);
    const originY = Number(scene.origin?.y);
    const cx = Number.isFinite(originX) ? originX : width / 2;
    const cy = Number.isFinite(originY) ? originY : height / 2;
    const inset = Math.max(40, Number(config().rightCornerInsetPx) || 180);
    const spread = Math.max(20, Number(config().spawnSpreadPx) || 150);
    const x = cx + width / 2 - inset;
    const flankX = x - spread * 2;
    return [
        { x, y: cy },
        { x: flankX, y: cy - spread },
        { x: flankX, y: cy + spread },
    ];
}

function freshRecord(sceneId, gameTimeMs) {
    const portal = WorldProgressionSystem.getPortalState(sceneId);
    return {
        active: true,
        sceneId,
        worldEpoch: Math.max(1, Math.floor(Number(portal.worldEpoch) || 1)),
        startedAtGameTimeMs: gameTimeMs,
        nextSpawnAtGameTimeMs: gameTimeMs + spawnIntervalMs(),
        normalSpawned: 0,
        eliteSpawned: 0,
        lordSpawned: 0,
        batchesSpawned: 0,
        pendingSpawns: [],
        pendingSpawnKind: null,
        pendingSpawnSuccess: 0,
        pendingMilestoneTier: null,
        pendingNormalStart: 0,
        queueRetryAtGameTimeMs: 0,
    };
}

function clearRecord(sceneId, record) {
    DefenseSystem.clearDestructionChallengeMonsters?.(sceneId, record?.worldEpoch);
    delete state.worlds[sceneId];
}

function scheduleNextBatch(record, gameTimeMs) {
    record.nextSpawnAtGameTimeMs = gameTimeMs + spawnIntervalMs();
    record.queueRetryAtGameTimeMs = 0;
}

function queueNormalBatch(record) {
    const sceneId = record.sceneId;
    const points = rightCornerSpawnPoints(sceneId);
    const batchSize = normalPerBatch();
    record.pendingSpawns = Array.from({ length: batchSize }, (_unused, index) => ({
        tier: 'normal',
        point: points[index % points.length],
    }));
    record.pendingSpawnKind = 'normal';
    record.pendingSpawnSuccess = 0;
    record.pendingMilestoneTier = null;
    record.pendingNormalStart = record.normalSpawned;
}

function queueMilestone(record, tier, milestoneNormalCount = record.normalSpawned) {
    const points = rightCornerSpawnPoints(record.sceneId);
    const targetCount = milestoneMonsterCount(tier, cycleNumberAt(milestoneNormalCount));
    record.pendingSpawns = Array.from({ length: targetCount }, (_unused, index) => ({
        tier,
        point: points[index % points.length],
    }));
    record.pendingSpawnKind = 'milestone';
    record.pendingSpawnSuccess = 0;
    record.pendingMilestoneTier = tier;
}

function finishSpawnQueue(record, gameTimeMs) {
    const kind = record.pendingSpawnKind;
    const successful = Math.max(0, Number(record.pendingSpawnSuccess) || 0);
    record.pendingSpawns = [];
    record.pendingSpawnKind = null;
    record.pendingSpawnSuccess = 0;

    if (kind === 'normal') {
        if (successful <= 0) {
            // 场景尚未完成物化时不累计批次，也不高频重试。
            scheduleNextBatch(record, gameTimeMs);
            return;
        }
        record.batchesSpawned++;
        const normalStart = Math.max(0, Number(record.pendingNormalStart) || 0);
        const normalEnd = Math.max(normalStart, Number(record.normalSpawned) || 0);
        const lordThreshold = lordEveryNormals();
        const eliteThreshold = eliteEveryNormals();
        let milestoneTier = null;
        let milestoneNormalCount = normalEnd;
        if (Math.floor(normalEnd / lordThreshold) > Math.floor(normalStart / lordThreshold)) {
            milestoneTier = 'lord';
            milestoneNormalCount = (Math.floor(normalStart / lordThreshold) + 1) * lordThreshold;
        } else if (Math.floor(normalEnd / eliteThreshold) > Math.floor(normalStart / eliteThreshold)) {
            milestoneTier = 'elite';
            milestoneNormalCount = (Math.floor(normalStart / eliteThreshold) + 1) * eliteThreshold;
        }
        record.pendingNormalStart = normalEnd;
        if (milestoneTier) {
            queueMilestone(record, milestoneTier, milestoneNormalCount);
            return;
        }
        scheduleNextBatch(record, gameTimeMs);
        return;
    }

    if (kind === 'milestone') {
        const tier = record.pendingMilestoneTier;
        if (successful > 0 && tier === 'lord') {
            notify(`☠ ${worldName(record.sceneId)}毁灭挑战：领主 ×${successful} 降临`, '#ff3d3d', 5600);
        } else if (successful > 0) {
            notify(`⚠ ${worldName(record.sceneId)}毁灭挑战：精英 ×${successful} 来袭`, '#d58cff', 4600);
        }
        record.pendingMilestoneTier = null;
        scheduleNextBatch(record, gameTimeMs);
    }
}

function drainSpawnQueue(record, gameTimeMs) {
    if (!Array.isArray(record.pendingSpawns) || record.pendingSpawns.length <= 0) return false;
    if (gameTimeMs < Math.max(0, Number(record.queueRetryAtGameTimeMs) || 0)) return true;

    let budget = spawnPerFrame();
    let alive = DefenseSystem.countDestructionChallengeMonsters?.(
        record.sceneId, record.worldEpoch) || 0;
    while (budget > 0 && record.pendingSpawns.length > 0) {
        const next = record.pendingSpawns[0];
        const normalCap = Math.min(softMaxAlive(), Math.max(1, hardMaxAlive() - milestoneReserve()));
        const cap = next.tier === 'normal' ? normalCap : hardMaxAlive();
        if (alive >= cap) {
            // 达到背压线时保留队列，低频重试；不丢批次，也不在每帧反复扫描/生成。
            record.queueRetryAtGameTimeMs = gameTimeMs + 250;
            return true;
        }

        const monster = DefenseSystem.spawnDestructionChallengeMonster?.({
            tier: next.tier,
            spawnPoints: [next.point],
            sceneId: record.sceneId,
            worldEpoch: record.worldEpoch,
        });
        if (!monster) {
            record.pendingSpawns.length = 0;
            finishSpawnQueue(record, gameTimeMs);
            return false;
        }
        record.pendingSpawns.shift();
        record.pendingSpawnSuccess++;
        if (next.tier === 'normal') record.normalSpawned++;
        else if (next.tier === 'lord') record.lordSpawned++;
        else record.eliteSpawned++;
        alive++;
        budget--;
    }

    if (record.pendingSpawns.length <= 0) finishSpawnQueue(record, gameTimeMs);
    return true;
}

function spawnBatch(record, gameTimeMs) {
    const alive = DefenseSystem.countDestructionChallengeMonsters?.(
        record.sceneId, record.worldEpoch) || 0;
    if (alive >= softMaxAlive()) {
        record.nextSpawnAtGameTimeMs = gameTimeMs + 500;
        return;
    }
    queueNormalBatch(record);
    drainSpawnQueue(record, gameTimeMs);
}

export const WorldDestructionChallengeSystem = {
    reset() {
        for (const [sceneId, record] of Object.entries(state.worlds)) {
            DefenseSystem.clearDestructionChallengeMonsters?.(sceneId, record?.worldEpoch);
        }
        state = initialState();
    },

    update(gameTimeMs = currentGameTimeMs(), currentSceneId = null) {
        const now = Math.max(0, Number(gameTimeMs) || 0);
        for (const [sceneId, record] of Object.entries(state.worlds)) {
            if (!record?.active || !portalSupportsChallenge(sceneId, record.worldEpoch)) {
                clearRecord(sceneId, record);
                continue;
            }
            if (sceneId !== currentSceneId) continue;
            if (DefenseSystem._worldId !== sceneId || !DefenseSystem.active
                || !DefenseSystem.base || DefenseSystem.base._portalDestroyed
                || DefenseSystem.base.active === false || DefenseSystem.base.hp <= 0) continue;
            if (drainSpawnQueue(record, now)) continue;
            if (now >= Math.max(0, Number(record.nextSpawnAtGameTimeMs) || 0)) {
                // 离场或读档后只物化当前一批，不追补积压批次，避免瞬间生成海量实体。
                spawnBatch(record, now);
            }
        }
    },

    trigger(sceneId) {
        if (!WorldProgressionSystem.getWorldConfig(sceneId)) {
            return { ok: false, reason: '未知位面', model: this.getWorldModel(sceneId) };
        }
        if (!portalSupportsChallenge(sceneId)) {
            return { ok: false, reason: '该位面尚未接通或传送门已经摧毁', model: this.getWorldModel(sceneId) };
        }
        const epoch = WorldProgressionSystem.getWorldEpoch(sceneId);
        const existing = state.worlds[sceneId];
        if (existing?.active && Number(existing.worldEpoch) === Number(epoch)) {
            return { ok: false, reason: '该位面的毁灭挑战已经在进行中', model: this.getWorldModel(sceneId) };
        }
        const now = currentGameTimeMs();
        state.worlds[sceneId] = freshRecord(sceneId, now);
        notify(`☄ ${worldName(sceneId)}位面毁灭挑战已触发，怪潮将在${Math.ceil(spawnIntervalMs() / 1000)}秒后抵达`, '#ff765c', 6200);
        return { ok: true, model: this.getWorldModel(sceneId) };
    },

    isActive(sceneId) {
        const record = state.worlds[sceneId];
        return !!record?.active && portalSupportsChallenge(sceneId, record.worldEpoch);
    },

    onWorldDestroyed(sceneId, worldEpoch = null) {
        const record = state.worlds[sceneId];
        if (!record) return false;
        if (worldEpoch !== null && Number(record.worldEpoch) !== Number(worldEpoch)) return false;
        clearRecord(sceneId, record);
        return true;
    },

    getWorldModel(sceneId) {
        const record = state.worlds[sceneId] || null;
        const portal = WorldProgressionSystem.getPortalState(sceneId);
        const active = this.isActive(sceneId);
        const now = currentGameTimeMs();
        const aliveCount = active && DefenseSystem._worldId === sceneId
            ? DefenseSystem.countDestructionChallengeMonsters?.(sceneId, record?.worldEpoch) || 0
            : null;
        return {
            sceneId,
            active,
            canTrigger: !!portal?.constructed && !portal.destroyed && !active,
            worldEpoch: record?.worldEpoch ?? portal?.worldEpoch ?? 0,
            normalSpawned: Math.max(0, Number(record?.normalSpawned) || 0),
            eliteSpawned: Math.max(0, Number(record?.eliteSpawned) || 0),
            lordSpawned: Math.max(0, Number(record?.lordSpawned) || 0),
            batchesSpawned: Math.max(0, Number(record?.batchesSpawned) || 0),
            remainingMs: active
                ? Math.max(0, Number(record.nextSpawnAtGameTimeMs) - now) : null,
            spawnIntervalMs: spawnIntervalMs(),
            normalPerBatch: normalPerBatch(),
            softMaxAlive: softMaxAlive(),
            hardMaxAlive: hardMaxAlive(),
            aliveCount,
            pendingSpawnCount: Array.isArray(record?.pendingSpawns) ? record.pendingSpawns.length : 0,
            eliteEveryNormals: eliteEveryNormals(),
            lordEveryNormals: lordEveryNormals(),
            cycleNumber: cycleNumberAt(record?.normalSpawned),
            eliteCountThisCycle: milestoneMonsterCount('elite', cycleNumberAt(record?.normalSpawned)),
            lordCountThisCycle: milestoneMonsterCount('lord', cycleNumberAt(record?.normalSpawned)),
        };
    },

    getDebugModel() {
        const worldIds = [
            ...WorldProgressionSystem.getWorldIds().filter((sceneId) =>
                !WorldProgressionSystem.getWorldConfig(sceneId)?.templatePreviewOnly),
            ...WorldProgressionSystem.getWorldInstanceIds(),
        ];
        return {
            version: VERSION,
            worlds: worldIds.map((sceneId) => this.getWorldModel(sceneId)),
        };
    },

    serialize() {
        const snapshot = clone(state);
        for (const [sceneId, record] of Object.entries(snapshot.worlds || {})) {
            if (!WorldProgressionSystem.canPersistWorld(sceneId)) {
                delete snapshot.worlds[sceneId];
                continue;
            }
            // 单帧分批队列是当前场景的物化细节；读档从下一完整批继续，避免保存半批坐标。
            delete record.pendingSpawns;
            delete record.pendingSpawnKind;
            delete record.pendingSpawnSuccess;
            delete record.pendingMilestoneTier;
            delete record.pendingNormalStart;
            delete record.queueRetryAtGameTimeMs;
        }
        return snapshot;
    },

    restore(data) {
        this.reset();
        if (!data || typeof data !== 'object' || !data.worlds || typeof data.worlds !== 'object') return;
        const now = currentGameTimeMs();
        const worldIds = [
            ...WorldProgressionSystem.getWorldIds().filter((sceneId) =>
                !WorldProgressionSystem.getWorldConfig(sceneId)?.templatePreviewOnly),
            ...WorldProgressionSystem.getWorldInstanceIds(),
        ];
        for (const sceneId of worldIds) {
            const incoming = data.worlds[sceneId];
            if (!incoming?.active) continue;
            const worldEpoch = Math.max(0, Math.floor(Number(incoming.worldEpoch) || 0));
            if (!portalSupportsChallenge(sceneId, worldEpoch)) continue;
            state.worlds[sceneId] = {
                active: true,
                sceneId,
                worldEpoch,
                startedAtGameTimeMs: Math.max(0, Number(incoming.startedAtGameTimeMs) || now),
                nextSpawnAtGameTimeMs: Math.max(now + spawnIntervalMs(),
                    Number(incoming.nextSpawnAtGameTimeMs) || 0),
                normalSpawned: Math.max(0, Math.floor(Number(incoming.normalSpawned) || 0)),
                eliteSpawned: Math.max(0, Math.floor(Number(incoming.eliteSpawned) || 0)),
                lordSpawned: Math.max(0, Math.floor(Number(incoming.lordSpawned) || 0)),
                batchesSpawned: Math.max(0, Math.floor(Number(incoming.batchesSpawned) || 0)),
                pendingSpawns: [],
                pendingSpawnKind: null,
                pendingSpawnSuccess: 0,
                pendingMilestoneTier: null,
                pendingNormalStart: 0,
                queueRetryAtGameTimeMs: 0,
            };
        }
    },
};

export default WorldDestructionChallengeSystem;
