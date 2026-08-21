export const RECRUIT_MODE = Object.freeze({
    PAUSED: 'paused',
    SINGLE: 'single',
    CONTINUOUS: 'continuous',
});

const RECRUIT_MODE_VALUES = new Set(Object.values(RECRUIT_MODE));

export function normalizeRecruitMode(value) {
    return RECRUIT_MODE_VALUES.has(value) ? value : RECRUIT_MODE.PAUSED;
}

export function recruitModeLabel(value) {
    const mode = normalizeRecruitMode(value);
    if (mode === RECRUIT_MODE.SINGLE) return '单次招募';
    if (mode === RECRUIT_MODE.CONTINUOUS) return '持续招募';
    return '暂停招募';
}

export function recruitStatusText(producer) {
    const mode = normalizeRecruitMode(producer?._recruitMode);
    if (mode === RECRUIT_MODE.PAUSED) return '已暂停';
    if (producer?._spawnFoodBlocked) return '粮食不足';
    if (producer?._spawnEnergyBlocked) return '能源不足';
    if (producer?._spawnBlocked) return '出口阻塞';
    if (producer?.aliveUnitCount?.() >= producer?.unitCount?.()) return '单位已满';
    return mode === RECRUIT_MODE.SINGLE ? '单次招募中' : '持续招募中';
}
