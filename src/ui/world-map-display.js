// Presentation preferences only. This key never stores campaign or troop state.
const STORAGE_KEY = 'wuxian_world_map_display_v1';
let sessionDisplay = null;

export const WORLD_MAP_LENSES = [
    { id: 'overview', label: '总览', legend: '远景使用缓存地貌、收起格线；放大查看地块与名称。军团仍按世界时钟行军。' },
    { id: 'military', label: '军事', legend: '标出已知敌军、敌方据点与战事所在格；不表示攻击范围。' },
    { id: 'bases', label: '基地', legend: '基＝建设基地，城/据＝战略据点；是否可入营以悬停提示为准。' },
    { id: 'terrain', label: '地形耗时', legend: '银色覆盖越强，进入该格越慢；数字为不跨河时的倍率／游戏小时。渡河另加耗时，路线预估已计入。' },
];

export function readWorldMapDisplay() {
    if (sessionDisplay) return sessionDisplay;
    try {
        const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (value?.version === 1) sessionDisplay = value;
    } catch (_) { /* Missing/blocked storage leaves this session usable. */ }
    return sessionDisplay;
}

export function saveWorldMapDisplay(display) {
    if (!display?.viewport) return;
    sessionDisplay = { ...display, version: 1 };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionDisplay)); }
    catch (_) { /* Keep the in-memory preference when persistence is unavailable. */ }
}
