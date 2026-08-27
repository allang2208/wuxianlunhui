import populationEconomyConfig from '../../data/population-economy.json';
import { destroyAllCivilianVisualsImmediate } from './civilian-visual-utils.js';

const STORAGE_KEY = 'world122.civilianAnimationsDisabled';
const listeners = new Set();
let reloadPromise = null;

function readDisabled() {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

let disabledState = readDisabled();

function collectVisualDefinitions() {
    const found = new Map();
    const visit = (value) => {
        if (!value || typeof value !== 'object') return;
        if (typeof value.id === 'string' && value.animations && typeof value.animations === 'object') {
            found.set(value.id, value);
        }
        for (const child of Object.values(value)) {
            if (child && typeof child === 'object') visit(child);
        }
    };
    visit(populationEconomyConfig);
    return [...found.values()];
}

export function getCivilianVisualDefinitions() {
    return collectVisualDefinitions();
}

export function getCivilianVisualAssetEntries() {
    const entries = [];
    for (const visual of collectVisualDefinitions()) {
        for (const [state, animation] of Object.entries(visual.animations || {})) {
            if (!animation?.src) continue;
            entries.push({
                visual,
                state,
                animation,
                key: `worker_${visual.id}_${state}`,
            });
        }
    }
    return entries;
}

export const CivilianVisualSettings = {
    isDisabled() {
        return disabledState;
    },

    isEnabled() {
        return !disabledState;
    },

    setDisabled(disabled) {
        const next = !!disabled;
        if (next === disabledState) return next;
        disabledState = next;
        try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, String(next));
        } catch {
            // localStorage 不可用时仍保留当前会话的内存态设置。
        }
        for (const listener of listeners) listener(next);
        return next;
    },

    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};

export function queueCivilianVisualAssets(scene) {
    if (!scene?.load || CivilianVisualSettings.isDisabled()) return 0;
    let queued = 0;
    for (const { key, animation } of getCivilianVisualAssetEntries()) {
        if (scene.textures?.exists(key)) continue;
        scene.load.spritesheet(key, animation.src, {
            frameWidth: animation.frameWidth || 512,
            frameHeight: animation.frameHeight || 512,
            endFrame: Math.max(0, (animation.frameCount || 1) - 1),
        });
        queued++;
    }
    return queued;
}

export function registerCivilianVisualAnimations(scene) {
    if (!scene?.anims || CivilianVisualSettings.isDisabled()) return;
    for (const { key, animation } of getCivilianVisualAssetEntries()) {
        if (!scene.textures?.exists(key) || scene.anims.exists(key)) continue;
        const [start, end] = animation.frames || [0, Math.max(0, (animation.frameCount || 1) - 1)];
        scene.anims.create({
            key,
            frames: scene.anims.generateFrameNumbers(key, { start, end }),
            frameRate: animation.frameRate || 12,
            repeat: animation.repeat !== undefined ? animation.repeat : -1,
        });
    }
}

export function unloadCivilianVisualAssets(scene) {
    destroyAllCivilianVisualsImmediate();
    if (!scene) return;
    for (const { key } of getCivilianVisualAssetEntries()) {
        if (scene.anims?.exists(key)) scene.anims.remove(key);
    }
    for (const { key } of getCivilianVisualAssetEntries()) {
        if (scene.textures?.exists(key)) scene.textures.remove(key);
    }
}

export function reloadCivilianVisualAssets(scene) {
    if (!scene?.load || CivilianVisualSettings.isDisabled()) return Promise.resolve(false);
    if (reloadPromise) return reloadPromise;
    const missing = getCivilianVisualAssetEntries().filter(({ key }) => !scene.textures?.exists(key));
    if (!missing.length) {
        registerCivilianVisualAnimations(scene);
        return Promise.resolve(true);
    }
    reloadPromise = new Promise((resolve) => {
        const finish = () => {
            if (CivilianVisualSettings.isDisabled()) unloadCivilianVisualAssets(scene);
            else registerCivilianVisualAnimations(scene);
            reloadPromise = null;
            resolve(CivilianVisualSettings.isEnabled());
        };
        scene.load.once('complete', finish);
        for (const { key, animation } of missing) {
            scene.load.spritesheet(key, animation.src, {
                frameWidth: animation.frameWidth || 512,
                frameHeight: animation.frameHeight || 512,
                endFrame: Math.max(0, (animation.frameCount || 1) - 1),
            });
        }
        if (!scene.load.isLoading()) scene.load.start();
    });
    return reloadPromise;
}

export function applyCivilianVisualSetting(scene, disabled) {
    if (disabled) {
        unloadCivilianVisualAssets(scene);
        return Promise.resolve(false);
    }
    return reloadCivilianVisualAssets(scene);
}
