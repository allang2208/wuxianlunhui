import frozenTerrainConfig from '../../data/frozen-terrain.json';

const PROFILE_WEIGHT_FIELD = Object.freeze({
    plane: 'planeWeight',
    dungeon: 'dungeonWeight',
});

export function getFrozenTerrainAssets() {
    return (frozenTerrainConfig.assets || []).map(asset => ({ ...asset }));
}

export function getFrozenTerrainDeco(profileName = 'plane') {
    const profile = frozenTerrainConfig.profiles?.[profileName] || {};
    const weightField = PROFILE_WEIGHT_FIELD[profileName] || PROFILE_WEIGHT_FIELD.plane;
    return {
        ...profile,
        assets: (frozenTerrainConfig.assets || []).map(asset => {
            const {
                planeWeight: _planeWeight,
                dungeonWeight: _dungeonWeight,
                ...runtimeAsset
            } = asset;
            return {
                ...runtimeAsset,
                weight: Number(asset[weightField]) || 0,
            };
        }),
    };
}

export function getFrozenTerrainBase() {
    return { ...(frozenTerrainConfig.base || {}) };
}
