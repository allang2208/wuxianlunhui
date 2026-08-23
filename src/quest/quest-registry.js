import questData from '../../data/quests.json';

const clone = (value) => JSON.parse(JSON.stringify(value));

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

const definitions = new Map();
for (const raw of questData.quests || []) {
    if (!raw?.id || definitions.has(raw.id)) continue;
    const definition = clone(raw);
    definition.objectives = Array.isArray(definition.objectives) ? definition.objectives : [];
    definition.rewards = Array.isArray(definition.rewards) ? definition.rewards : [];
    definitions.set(definition.id, deepFreeze(definition));
}

const allDefinitions = deepFreeze([...definitions.values()]);

/** 不可变任务定义注册表；运行进度统一由 QuestStore 持有。 */
export const QuestRegistry = Object.freeze({
    VERSION: Math.max(1, Math.floor(Number(questData.version) || 1)),

    get(questId) {
        return definitions.get(questId) || null;
    },

    getAll() {
        return allDefinitions;
    },

    has(questId) {
        return definitions.has(questId);
    },

    getObjective(questId, objectiveId) {
        const quest = definitions.get(questId);
        return quest?.objectives.find((objective) => objective.id === objectiveId) || null;
    },
});

export default QuestRegistry;
