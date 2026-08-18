import { EnvironmentLightingSystem } from '../world/environment-lighting-system.js';

const STORAGE_KEY = 'wuxian_environment_lighting_settings';
const DEFAULTS = Object.freeze({
    enabled: true,
    animateSun: true,
    staticEnabled: true,
    ambientEnabled: true,
    localGlowEnabled: true,
    quality: 'high',
});

function load() {
    const settings = { ...DEFAULTS };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return settings;
        const saved = JSON.parse(raw);
        for (const key of Object.keys(DEFAULTS)) {
            if (typeof saved?.[key] === 'boolean') settings[key] = saved[key];
        }
        if (['low', 'medium', 'high'].includes(saved?.quality)) settings.quality = saved.quality;
    } catch (_e) {
        // 本地存储不可用或旧数据损坏时使用默认设置。
    }
    return settings;
}

export const EnvironmentLightingSettings = {
    _settings: load(),

    init() {
        EnvironmentLightingSystem.configure(this._settings);
    },

    get() {
        return { ...this._settings };
    },

    set(key, value) {
        if (!(key in DEFAULTS)) return;
        if (key === 'quality') {
            if (!['low', 'medium', 'high'].includes(value)) return;
            this._settings[key] = value;
        } else {
            this._settings[key] = !!value;
        }
        EnvironmentLightingSystem.configure({ [key]: this._settings[key] });
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._settings));
        } catch (_e) {
            // 无本地持久化权限时仍立即应用本次设置。
        }
    },
};

EnvironmentLightingSettings.init();
