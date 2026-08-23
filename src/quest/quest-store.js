import { QuestRegistry } from './quest-registry.js';

const VERSION = 1;
const VALID_STATUS = new Set(['available', 'active', 'completed']);
const listeners = new Set();
const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function createQuestRuntime(definition) {
    return {
        status: 'available',
        objectives: Object.fromEntries(
            definition.objectives.map((objective) => [objective.id, 0])
        ),
    };
}

function createInitialState() {
    return {
        version: VERSION,
        activeQuestId: null,
        session: null,
        lastFailure: null,
        quests: Object.fromEntries(
            QuestRegistry.getAll().map((definition) => [definition.id, createQuestRuntime(definition)])
        ),
    };
}

let state = createInitialState();

function notify(reason) {
    for (const listener of listeners) {
        try { listener(reason); } catch (error) { console.error('[QuestStore] listener failed:', error); }
    }
}

function questRuntime(questId) {
    return QuestRegistry.has(questId) ? state.quests[questId] : null;
}

function objectiveTarget(questId, objectiveId) {
    return Math.max(0, Number(QuestRegistry.getObjective(questId, objectiveId)?.target) || 0);
}

function riftCountFor(questId) {
    const definition = QuestRegistry.get(questId);
    return Math.max(0, Math.floor(Number(definition?.runtime?.riftCount) || 0));
}

function sanitizePoint(point) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function sanitizeSession(raw, fallbackQuestId = null) {
    const questId = QuestRegistry.has(raw?.questId) ? raw.questId : fallbackQuestId;
    const definition = QuestRegistry.get(questId);
    if (!definition) return null;
    const count = riftCountFor(questId);
    const progress = Array.from({ length: count }, (_, index) => clamp(raw?.riftProgress?.[index], 0, 1));
    const completed = Array.from({ length: count }, (_, index) => !!raw?.riftCompleted?.[index]);
    for (let index = 0; index < count; index++) {
        if (completed[index]) progress[index] = 1;
    }
    return {
        questId,
        sceneId: definition.scene,
        mode: definition.mode || 'quest',
        riftPositions: (Array.isArray(raw?.riftPositions) ? raw.riftPositions : [])
            .map(sanitizePoint)
            .filter(Boolean)
            .slice(0, count),
        riftProgress: progress,
        riftCompleted: completed,
        riftsResolved: !!raw?.riftsResolved || (count > 0 && completed.every(Boolean)),
        returnPortalSpawned: !!raw?.returnPortalSpawned,
        returnPortalPosition: sanitizePoint(raw?.returnPortalPosition),
    };
}

function migrateLegacyRuntime(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.version || raw.quests || raw.session) return raw;
    const questId = QuestRegistry.has(raw.activeQuest) ? raw.activeQuest : null;
    if (!questId) return null;
    const fullyCompleted = raw.completed === true || raw.status === 'completed';
    return {
        version: VERSION,
        activeQuestId: questId,
        quests: {
            [questId]: {
                status: fullyCompleted ? 'completed' : 'active',
                objectives: {
                    rift_1: Array.isArray(raw.riftCompleted) ? raw.riftCompleted.filter(Boolean).length : 0,
                    evacuate: fullyCompleted ? 1 : 0,
                },
            },
        },
        session: {
            questId,
            sceneId: raw.currentScene,
            mode: raw.mode,
            riftPositions: raw.riftPositions,
            riftProgress: raw.riftProgress,
            riftCompleted: raw.riftCompleted,
            riftsResolved: raw.questCompleted,
            returnPortalSpawned: raw.returnPortalSpawned,
            returnPortalPosition: raw.returnPortalPosition,
        },
    };
}

function restoreQuestRuntime(target, incoming, definition) {
    if (!incoming || typeof incoming !== 'object') return;
    target.status = VALID_STATUS.has(incoming.status) ? incoming.status : target.status;
    for (const objective of definition.objectives) {
        target.objectives[objective.id] = clamp(
            incoming.objectives?.[objective.id],
            0,
            Math.max(0, Number(objective.target) || 0)
        );
    }
    if (target.status === 'completed') {
        for (const objective of definition.objectives) {
            target.objectives[objective.id] = Math.max(0, Number(objective.target) || 0);
        }
    }
}

export const QuestStore = {
    VERSION,

    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    reset() {
        state = createInitialState();
        notify('reset');
    },

    serialize() {
        return clone(state);
    },

    restore(raw) {
        const incoming = migrateLegacyRuntime(raw);
        const next = createInitialState();
        if (incoming && typeof incoming === 'object') {
            for (const definition of QuestRegistry.getAll()) {
                restoreQuestRuntime(next.quests[definition.id], incoming.quests?.[definition.id], definition);
            }
            const activeQuestId = QuestRegistry.has(incoming.activeQuestId)
                ? incoming.activeQuestId
                : null;
            const session = sanitizeSession(incoming.session, activeQuestId);
            if (session && next.quests[session.questId].status !== 'completed') {
                next.activeQuestId = session.questId;
                next.session = session;
                next.quests[session.questId].status = 'active';
            }
            if (incoming.lastFailure && QuestRegistry.has(incoming.lastFailure.questId)) {
                next.lastFailure = {
                    questId: incoming.lastFailure.questId,
                    reason: String(incoming.lastFailure.reason || 'failed'),
                };
            }
        }
        state = next;
        notify('restore');
    },

    getQuestState(questId) {
        const runtime = questRuntime(questId);
        return runtime ? clone(runtime) : null;
    },

    getStatus(questId) {
        return questRuntime(questId)?.status || 'available';
    },

    getObjectiveProgress(questId, objectiveId) {
        return questRuntime(questId)?.objectives?.[objectiveId] || 0;
    },

    setObjectiveProgress(questId, objectiveId, value) {
        const runtime = questRuntime(questId);
        if (!runtime || !QuestRegistry.getObjective(questId, objectiveId)) return false;
        runtime.objectives[objectiveId] = clamp(value, 0, objectiveTarget(questId, objectiveId));
        notify('objective-progress');
        return true;
    },

    acceptQuest(questId) {
        const runtime = questRuntime(questId);
        if (!runtime || runtime.status === 'completed') return false;
        runtime.status = 'active';
        notify('quest-accepted');
        return true;
    },

    setQuestAccepted(questId, accepted) {
        const runtime = questRuntime(questId);
        if (!runtime || runtime.status === 'completed') return false;
        runtime.status = accepted ? 'active' : 'available';
        notify('quest-accepted');
        return true;
    },

    setQuestCompleted(questId, completed) {
        const runtime = questRuntime(questId);
        const definition = QuestRegistry.get(questId);
        if (!runtime || !definition) return false;
        runtime.status = completed ? 'completed' : 'active';
        if (completed) {
            for (const objective of definition.objectives) {
                runtime.objectives[objective.id] = Math.max(0, Number(objective.target) || 0);
            }
        }
        notify('quest-completed');
        return true;
    },

    startSession(questId, options = {}) {
        const definition = QuestRegistry.get(questId);
        const runtime = questRuntime(questId);
        if (!definition || !runtime || runtime.status === 'completed') return false;
        if (options.resume === true
            && state.activeQuestId === questId
            && state.session?.questId === questId) {
            runtime.status = 'active';
            state.lastFailure = null;
            notify('session-resumed');
            return true;
        }
        runtime.status = 'active';
        for (const objective of definition.objectives) runtime.objectives[objective.id] = 0;
        state.activeQuestId = questId;
        state.session = sanitizeSession({ questId }, questId);
        state.lastFailure = null;
        notify('session-started');
        return true;
    },

    abortSession(reason = 'failed') {
        const questId = state.activeQuestId;
        const runtime = questRuntime(questId);
        const definition = QuestRegistry.get(questId);
        if (runtime && definition && runtime.status !== 'completed') {
            runtime.status = 'active';
            for (const objective of definition.objectives) runtime.objectives[objective.id] = 0;
        }
        state.lastFailure = questId ? { questId, reason: String(reason || 'failed') } : null;
        state.activeQuestId = null;
        state.session = null;
        notify('session-aborted');
    },

    completeQuest(questId = state.activeQuestId) {
        if (!this.setQuestCompleted(questId, true)) return false;
        state.activeQuestId = null;
        state.session = null;
        state.lastFailure = null;
        notify('session-completed');
        return true;
    },

    getActiveQuestId() {
        return state.activeQuestId;
    },

    isActiveSession({ questId = null, mode = null } = {}) {
        if (!state.session || !state.activeQuestId) return false;
        if (questId && state.session.questId !== questId) return false;
        if (mode && state.session.mode !== mode) return false;
        return true;
    },

    getSessionValue(key) {
        const value = state.session?.[key];
        return value && typeof value === 'object' ? clone(value) : value;
    },

    getActiveSession() {
        return state.session ? clone(state.session) : null;
    },

    getSessionArray(key) {
        const value = state.session?.[key];
        return Array.isArray(value) ? clone(value) : [];
    },

    replaceSessionArray(key, values) {
        if (!state.session || !['riftPositions', 'riftProgress', 'riftCompleted'].includes(key)) return false;
        state.session[key] = Array.isArray(values) ? clone(values) : [];
        notify('session-runtime');
        return true;
    },

    setSessionFlag(key, value) {
        if (!state.session || !['riftsResolved', 'returnPortalSpawned'].includes(key)) return false;
        state.session[key] = !!value;
        notify('session-runtime');
        return true;
    },

    setReturnPortalPosition(point) {
        if (!state.session) return false;
        state.session.returnPortalPosition = sanitizePoint(point);
        notify('session-runtime');
        return true;
    },

    setRiftProgress(index, value) {
        if (!state.session || index < 0 || index >= state.session.riftProgress.length) return false;
        state.session.riftProgress[index] = clamp(value, 0, 1);
        return true;
    },

    completeRift(index) {
        if (!state.session || index < 0 || index >= state.session.riftCompleted.length) return false;
        state.session.riftCompleted[index] = true;
        state.session.riftProgress[index] = 1;
        this.setObjectiveProgress(
            state.session.questId,
            'rift_1',
            state.session.riftCompleted.filter(Boolean).length
        );
        return true;
    },

    markEvacuated() {
        if (!state.session) return false;
        state.session.returnPortalSpawned = true;
        return this.setObjectiveProgress(state.session.questId, 'evacuate', 1);
    },

    wasLastFailure(reason = null) {
        return !!state.lastFailure && (!reason || state.lastFailure.reason === reason);
    },
};

export default QuestStore;
