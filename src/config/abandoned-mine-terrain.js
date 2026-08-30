import abandonedMineTerrainConfig from '../../data/abandoned-mine-terrain.json';

/** 矿洞地牢与世界-126共用正式地貌；返回副本，位面种子不污染地牢配置。 */
export function getAbandonedMineFloorProfile(profileName = 'dungeon') {
    const base = abandonedMineTerrainConfig.base || {};
    const { sizeScale = 1, ...decoProfile } = abandonedMineTerrainConfig.profiles?.[profileName] || {};
    return {
        tiles: base.key ? [base.key] : [],
        glow: false,
        continuous: base.continuous === true,
        backgroundColor: base.backgroundColor || '#0b0a09',
        textureScaleY: base.textureScaleY ?? 0.5774,
        cellDetails: abandonedMineTerrainConfig.detailLayer
            ? { ...abandonedMineTerrainConfig.detailLayer, grid: { ...abandonedMineTerrainConfig.detailLayer.grid } }
            : null,
        deco: abandonedMineTerrainConfig.deco
            ? {
                ...abandonedMineTerrainConfig.deco,
                ...decoProfile,
                assets: (abandonedMineTerrainConfig.deco.assets || []).map(asset => ({
                    ...asset,
                    size: asset.size * sizeScale,
                })),
            }
            : null,
    };
}
