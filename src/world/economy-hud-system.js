const EMPTY_POPULATION_SNAPSHOT = Object.freeze({
    viewRevision: 0,
    total: 0,
    used: 0,
    capacity: 0,
    free: 0,
    overcrowded: 0,
});

function normalizePopulationSnapshot(snapshot) {
    const used = Math.max(0, Math.floor(Number(snapshot?.used) || 0));
    const capacity = Math.max(0, Math.floor(Number(snapshot?.capacity) || 0));
    const total = Math.max(0, Math.floor(Number(snapshot?.total) || 0));
    return {
        viewRevision: Math.max(0, Math.floor(Number(snapshot?.viewRevision) || 0)),
        total,
        used,
        capacity,
        free: Math.max(0, total - used),
        overcrowded: Math.max(0, total - capacity),
    };
}

// UI 只读桥：避免 GameUIManager 直接反向依赖 PopulationEconomySystem 形成初始化环。
export const EconomyHudSystem = {
    _populationProvider: null,

    setPopulationProvider(provider) {
        this._populationProvider = typeof provider === 'function' ? provider : null;
    },

    getPopulationSnapshot() {
        if (!this._populationProvider) return { ...EMPTY_POPULATION_SNAPSHOT };
        return normalizePopulationSnapshot(this._populationProvider());
    },
};
