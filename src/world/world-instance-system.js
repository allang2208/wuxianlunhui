// 动态位面实例：模板只描述地貌/运行时加载器，实例持有独立 seed 与持久状态键。
// scene8~scene12 仅作为模板预览加载器；正式剧情与开发测试都通过实例进入。
import worldSystemConfig from '../../data/world-system.json';

export const WORLD_INSTANCE_KIND = Object.freeze({
    STORY: 'story',
    DEV_PREVIEW: 'dev_preview',
});

const STORAGE_VERSION = 1;
const VALID_KINDS = new Set(Object.values(WORLD_INSTANCE_KIND));
const clone = (value) => JSON.parse(JSON.stringify(value));

function normalizeSeed(value, fallback = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback >>> 0;
    return Math.max(1, Math.floor(numeric) >>> 0);
}

function randomSeed() {
    if (globalThis.crypto?.getRandomValues) {
        const values = new Uint32Array(1);
        globalThis.crypto.getRandomValues(values);
        return normalizeSeed(values[0]);
    }
    return normalizeSeed(Date.now() ^ Math.floor(Math.random() * 0xffffffff));
}

function normalizeTemplate(templateId) {
    const template = worldSystemConfig.templates?.[templateId];
    if (!template || typeof template !== 'object') return null;
    const runtimeSceneId = String(template.runtimeSceneId || template.previewSceneId || '');
    if (!runtimeSceneId) return null;
    return {
        id: templateId,
        ...clone(template),
        runtimeSceneId,
        previewSceneId: String(template.previewSceneId || runtimeSceneId),
    };
}

function normalizeInstance(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const template = normalizeTemplate(String(raw.templateId || ''));
    const instanceId = String(raw.instanceId || '');
    if (!template || !instanceId.startsWith('world-instance:')) return null;
    const kind = VALID_KINDS.has(raw.kind) ? raw.kind : WORLD_INSTANCE_KIND.STORY;
    return {
        instanceId,
        templateId: template.id,
        runtimeSceneId: template.runtimeSceneId,
        seed: normalizeSeed(raw.seed, template.defaultSeed || 1),
        kind,
        persistent: kind === WORLD_INSTANCE_KIND.STORY && raw.persistent !== false,
        source: String(raw.source || kind),
        strategicCellId: raw.strategicCellId == null ? null : String(raw.strategicCellId),
        createdAt: Math.max(0, Number(raw.createdAt) || Date.now()),
    };
}

let state = {
    version: STORAGE_VERSION,
    nextSequence: 1,
    instances: {},
    activeInstanceId: null,
};

function nextInstanceId(templateId) {
    const sequence = Math.max(1, Math.floor(Number(state.nextSequence) || 1));
    state.nextSequence = sequence + 1;
    return `world-instance:${templateId}:${sequence.toString(36)}`;
}

export const WorldInstanceSystem = {
    config: worldSystemConfig,

    reset() {
        state = {
            version: STORAGE_VERSION,
            nextSequence: 1,
            instances: {},
            activeInstanceId: null,
        };
    },

    serialize() {
        const instances = {};
        for (const [instanceId, instance] of Object.entries(state.instances)) {
            if (instance.persistent) instances[instanceId] = clone(instance);
        }
        return {
            version: STORAGE_VERSION,
            nextSequence: Math.max(1, Math.floor(Number(state.nextSequence) || 1)),
            instances,
        };
    },

    restore(data) {
        this.reset();
        if (!data || typeof data !== 'object') return;
        let nextSequence = Math.max(1, Math.floor(Number(data.nextSequence) || 1));
        for (const raw of Object.values(data.instances || {})) {
            const instance = normalizeInstance(raw);
            if (!instance || !instance.persistent) continue;
            state.instances[instance.instanceId] = instance;
            const encodedSequence = instance.instanceId.split(':').pop();
            const sequence = Number.parseInt(encodedSequence, 36);
            if (Number.isFinite(sequence)) nextSequence = Math.max(nextSequence, sequence + 1);
        }
        state.nextSequence = nextSequence;
    },

    listTemplates() {
        return Object.keys(worldSystemConfig.templates || {})
            .map((templateId) => normalizeTemplate(templateId))
            .filter(Boolean);
    },

    getTemplate(templateId) {
        return normalizeTemplate(String(templateId || ''));
    },

    getTemplateForWorld(worldId) {
        const instance = this.getInstance(worldId);
        if (instance) return this.getTemplate(instance.templateId);
        const templateId = worldSystemConfig.worlds?.[worldId]?.templateId;
        return templateId ? this.getTemplate(templateId) : null;
    },

    createInstance({
        templateId,
        seed = null,
        kind = WORLD_INSTANCE_KIND.STORY,
        persistent = kind === WORLD_INSTANCE_KIND.STORY,
        source = kind,
        strategicCellId = null,
    } = {}) {
        const template = this.getTemplate(templateId);
        if (!template) return { ok: false, reason: '未知位面模板' };
        if (!VALID_KINDS.has(kind)) return { ok: false, reason: '未知位面实例类型' };
        const instanceId = nextInstanceId(template.id);
        const instance = normalizeInstance({
            instanceId,
            templateId: template.id,
            runtimeSceneId: template.runtimeSceneId,
            seed: seed == null ? randomSeed() : seed,
            kind,
            persistent,
            source,
            strategicCellId,
            createdAt: Date.now(),
        });
        if (!instance) return { ok: false, reason: '位面实例参数无效' };
        state.instances[instanceId] = instance;
        return { ok: true, instance: clone(instance), template };
    },

    createStoryInstance(options = {}) {
        const template = this.getTemplate(options.templateId);
        if (!template || template.storyEnabled === false
            || !worldSystemConfig.worlds?.[template.runtimeSceneId]) {
            return { ok: false, reason: '该位面模板尚未开放正式剧情生成' };
        }
        return this.createInstance({ ...options, kind: WORLD_INSTANCE_KIND.STORY, persistent: true });
    },

    createRandomStoryInstance({ templateIds = null, random = Math.random, ...options } = {}) {
        const candidates = (Array.isArray(templateIds) && templateIds.length
            ? templateIds.map((id) => this.getTemplate(id))
            : this.listTemplates())
            .filter((template) => template
                && template.storyEnabled !== false
                && worldSystemConfig.worlds?.[template.runtimeSceneId]);
        if (!candidates.length) return { ok: false, reason: '没有可用于剧情的位面模板' };
        const roll = typeof random === 'function' ? random() : Math.random();
        const index = Math.min(candidates.length - 1,
            Math.floor(Math.max(0, Number(roll) || 0) * candidates.length));
        return this.createStoryInstance({ ...options, templateId: candidates[index].id });
    },

    createDevPreviewInstance({ templateId, seed = null } = {}) {
        return this.createInstance({
            templateId,
            seed,
            kind: WORLD_INSTANCE_KIND.DEV_PREVIEW,
            persistent: false,
            source: 'dev_tool',
        });
    },

    getInstance(instanceId) {
        const instance = state.instances?.[instanceId];
        return instance ? clone(instance) : null;
    },

    listInstances({ persistentOnly = false, kind = null } = {}) {
        return Object.values(state.instances)
            .filter((instance) => (!persistentOnly || instance.persistent)
                && (!kind || instance.kind === kind))
            .map((instance) => clone(instance));
    },

    removeInstance(instanceId) {
        if (!state.instances?.[instanceId]) return false;
        delete state.instances[instanceId];
        if (state.activeInstanceId === instanceId) state.activeInstanceId = null;
        return true;
    },

    isInstanceId(worldId) {
        return !!state.instances?.[worldId];
    },

    isPersistentInstance(worldId) {
        return this.getInstance(worldId)?.persistent === true;
    },

    isDevPreview(worldId) {
        return this.getInstance(worldId)?.kind === WORLD_INSTANCE_KIND.DEV_PREVIEW;
    },

    resolveRuntimeSceneId(worldId) {
        return this.getInstance(worldId)?.runtimeSceneId || String(worldId || '');
    },

    resolveStateKey(worldId) {
        return this.getInstance(worldId)?.instanceId || String(worldId || '');
    },

    setActiveInstance(instanceId = null) {
        state.activeInstanceId = this.isInstanceId(instanceId) ? instanceId : null;
        return state.activeInstanceId;
    },

    getActiveInstance() {
        return this.getInstance(state.activeInstanceId);
    },

    getDisplayName(worldId) {
        const instance = this.getInstance(worldId);
        if (!instance) return worldSystemConfig.worlds?.[worldId]?.name || null;
        const template = this.getTemplate(instance.templateId);
        const suffix = instance.kind === WORLD_INSTANCE_KIND.DEV_PREVIEW ? '测试实例' : '位面实例';
        return `${template?.name || instance.templateId} · ${suffix} #${instance.instanceId.split(':').pop()}`;
    },
};
