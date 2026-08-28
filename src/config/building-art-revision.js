// 稳定 texture key 对应的正式换图版本。只给浏览器请求追加 revision，
// 不污染 data/*.json 中供本地文件工具读取的真实路径。
const BUILDING_ART_REVISION = '20260827-house-lv5-lv7-manual';

const BUILDING_ART_REVISION_KEYS = new Set([
    'house_lv1',
    'house_lv2',
    'house_lv3',
    'house_lv4',
    'house_lv5',
    'house_lv6',
    'house_lv7',
    'warehouse_lv2',
    'warehouse_lv3',
    'warehouse_lv4',
    'warehouse_lv5',
    'barracks',
    'hamster_barracks_lv2',
    'church',
    'church_lv2',
    'church_lv3',
    'thatch_hut',
    'thatch_hut_lv2',
    'armory',
    'bakery',
    'royal_mint',
    'steam_power_plant',
    'wind_power_plant',
    'wind_power_plant_body',
    'wind_power_plant_rotor',
]);

export function buildingArtUrl(textureKey, assetPath) {
    if (!assetPath || !BUILDING_ART_REVISION_KEYS.has(textureKey)) return assetPath;
    const separator = assetPath.includes('?') ? '&' : '?';
    return `${assetPath}${separator}v=${BUILDING_ART_REVISION}`;
}
