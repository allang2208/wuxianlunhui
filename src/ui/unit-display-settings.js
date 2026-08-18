// 单位显示设置：仅保存客户端偏好，不进入存档，切换后世界 HUD 下一帧立即读取。
const STORAGE_KEY = 'wuxian_unit_display_settings';

const DEFAULTS = Object.freeze({
    enemy: Object.freeze({
        showHealthBar: true,
        showName: true,
        showFullHealth: false,
    }),
    friendly: Object.freeze({
        showHealthBar: true,
        showName: false,
        showFullHealth: true,
    }),
});

function readSavedSettings() {
    const saved = {
        enemy: { ...DEFAULTS.enemy },
        friendly: { ...DEFAULTS.friendly },
    };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return saved;
        const parsed = JSON.parse(raw);
        for (const faction of ['enemy', 'friendly']) {
            for (const key of Object.keys(DEFAULTS[faction])) {
                if (typeof parsed?.[faction]?.[key] === 'boolean') {
                    saved[faction][key] = parsed[faction][key];
                }
            }
        }
    } catch (_e) {
        // 浏览器隐私模式或旧损坏数据时，直接使用默认值。
    }
    return saved;
}

export const UnitDisplaySettings = {
    _settings: readSavedSettings(),

    get(faction) {
        return this._settings[faction] || this._settings.enemy;
    },

    set(faction, key, value) {
        if (!this._settings[faction] || !(key in DEFAULTS[faction])) return;
        this._settings[faction][key] = !!value;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._settings));
        } catch (_e) {
            // 无持久化权限时仍保留本次运行内的设置。
        }
    },
};
