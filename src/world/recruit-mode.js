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

export function recruitStatusText(producer, { countdown = false } = {}) {
    const mode = normalizeRecruitMode(producer?._recruitMode);
    if (mode === RECRUIT_MODE.PAUSED) return '已暂停';
    if (producer?._spawnPopulationBlocked) return '军事人口已满';
    if (producer?._spawnFoodBlocked) return '粮食不足';
    if (producer?._spawnEnergyBlocked) return '能源不足';
    if (producer?._spawnBlocked) return '出口阻塞';
    if (producer?._hasIndividualUnitCap
        && producer?.aliveUnitCount?.() >= producer?.unitCount?.()) return '特色编制已满';
    if (countdown) return `${Math.max(0, Math.ceil((Number(producer?._spawnTimer) || 0) / 1000))}s`;
    return mode === RECRUIT_MODE.SINGLE ? '单次招募中' : '持续招募中';
}
