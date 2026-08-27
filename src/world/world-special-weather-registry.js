// 位面特殊天气的预报注册表。天气系统只消费统一事件，不感知沙尘暴、雾潮等具体实现。
const providers = new Map();

function normalizeEvents(providerId, sceneId, source) {
    if (!Array.isArray(source)) return [];
    return source.filter((event) => event && event.sceneId === sceneId
        && Number.isFinite(Number(event.startsAtGameTimeMs)))
        .map((event, index) => ({
            ...event,
            id: event.id || `special-weather:${providerId}:${sceneId}:${index}`,
            type: 'weather',
            typeLabel: event.typeLabel || '天气',
            weatherKind: event.weatherKind || 'special',
            specialWeatherProviderId: providerId,
        }));
}

export const WorldSpecialWeatherRegistry = {
    registerProvider(id, provider) {
        if (!id || !provider || typeof provider.getForecastEvents !== 'function') return false;
        providers.set(String(id), provider);
        return true;
    },

    unregisterProvider(id) {
        return providers.delete(String(id));
    },

    getForecastEvents(sceneId, context = {}) {
        const events = [];
        for (const [providerId, provider] of providers) {
            try {
                const source = provider.getForecastEvents({ sceneId, ...context });
                events.push(...normalizeEvents(providerId, sceneId, source));
            } catch (error) {
                console.error(`[WorldSpecialWeatherRegistry] ${providerId} 预报失败:`, error);
            }
        }
        return events;
    },

    getProviderIds() {
        return [...providers.keys()];
    },

    getSceneIds() {
        const sceneIds = new Set();
        for (const provider of providers.values()) {
            for (const sceneId of provider.forecastSceneIds || []) {
                if (sceneId) sceneIds.add(sceneId);
            }
        }
        return [...sceneIds];
    },
};

export default WorldSpecialWeatherRegistry;
