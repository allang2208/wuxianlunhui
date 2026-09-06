import producerBuildings from '../../../data/producer-buildings.json';
import populationEconomyConfig from '../../../data/population-economy.json';
import { buildingArtUrl } from '../../config/building-art-revision.js';
import { isTextureReady, loadedTextureBytes, animationUsesCurrentTextures, removeAnimationSafely } from './asset-texture-state.js';

const DEFAULT_IMAGE_BYTES = 4 * 1024 * 1024;
const CORE_TEXTURE_KEYS = new Set([
    'defense_base',
    'portal',
    'portal_structure_occluder',
    'obstacle_candle',
]);

const manifest = new Map();
const configKeys = new Map();
const configById = new Map(Object.values(producerBuildings || {})
    .filter((config) => config?.id)
    .map((config) => [config.id, config]));

function rememberConfigKey(configId, key) {
    if (!configId || !key) return;
    if (!configKeys.has(configId)) configKeys.set(configId, new Set());
    configKeys.get(configId).add(key);
}

function addImage(configId, key, assetPath, { core = false } = {}) {
    if (!key || !assetPath) return;
    const previous = manifest.get(key);
    manifest.set(key, {
        key,
        type: 'image',
        url: buildingArtUrl(key, assetPath),
        estimatedBytes: previous?.estimatedBytes || DEFAULT_IMAGE_BYTES,
        core: previous?.core === true || core || CORE_TEXTURE_KEYS.has(key),
        owners: new Set([...(previous?.owners || []), configId].filter(Boolean)),
    });
    rememberConfigKey(configId, key);
}

function addSheet(configId, animation, { core = false } = {}) {
    const key = animation?.textureKey;
    if (!key || !animation.assetPath) return;
    const frameWidth = Math.max(1, Number(animation.frameWidth) || 512);
    const frameHeight = Math.max(1, Number(animation.frameHeight) || 512);
    const frameCount = Math.max(1, Number(animation.frameCount) || 1);
    const previous = manifest.get(key);
    manifest.set(key, {
        key,
        type: 'spritesheet',
        url: buildingArtUrl(key, animation.assetPath),
        frameWidth,
        frameHeight,
        endFrame: frameCount - 1,
        frameRate: Number(animation.frameRate) || 12,
        repeat: animation.repeat !== undefined ? animation.repeat : -1,
        estimatedBytes: frameWidth * frameHeight * frameCount * 4,
        core: previous?.core === true || core || CORE_TEXTURE_KEYS.has(key),
        owners: new Set([...(previous?.owners || []), configId].filter(Boolean)),
    });
    rememberConfigKey(configId, key);
}

for (const config of configById.values()) {
    const core = config.id === 'portal' || config.id === 'plane_altar';
    addImage(config.id, config.tex, config.assetPath || `assets/terrain/${config.tex}.png`, { core });
    addSheet(config.id, config.animation, { core });
    addImage(config.id, config.groundContact?.textureKey,
        config.groundContact?.assetPath, { core });
    addImage(config.id, config.foregroundOverlay?.textureKey,
        config.foregroundOverlay?.assetPath, { core });
    const visualTiers = [
        ...(config.recruitmentTiers || []),
        ...(config.buildingTiers || []),
    ];
    for (const tier of visualTiers) {
        const visual = tier?.visual;
        if (!visual?.tex) continue;
        addImage(config.id, visual.tex,
            visual.assetPath || `assets/terrain/${visual.tex}.png`, { core });
        addSheet(config.id, visual.animation, { core });
        addImage(config.id, visual.groundContact?.textureKey,
            visual.groundContact?.assetPath, { core });
        addImage(config.id, visual.foregroundOverlay?.textureKey,
            visual.foregroundOverlay?.assetPath, { core });
    }
}

const ECONOMY_LEVELS = Object.freeze({
    housing: populationEconomyConfig.house?.levels || [],
    warehouse: populationEconomyConfig.warehouse?.levels || [],
    research: populationEconomyConfig.research?.levels || [],
});

for (const [economyType, levels] of Object.entries(ECONOMY_LEVELS)) {
    const configId = economyType === 'housing'
        ? 'house'
        : (economyType === 'research' ? 'research_institute' : economyType);
    for (const level of levels) {
        if (!level?.tex) continue;
        addImage(configId, level.tex,
            level.assetPath || `assets/terrain/${level.tex}.png`);
    }
}

export function getBuildingAssetEntry(key) {
    return manifest.get(key) || null;
}

export function getBuildingAssetEntries({ deferredOnly = false } = {}) {
    return [...manifest.values()].filter((entry) => !deferredOnly || !entry.core);
}

export function isDeferredBuildingTexture(key) {
    const entry = manifest.get(key);
    return !!entry && !entry.core;
}

export function getBuildingConfig(configId) {
    return configById.get(configId) || null;
}

export function getBuildingVisualKeysForConfig(configId, bodyKey = null) {
    const config = configById.get(configId);
    if (!config) return bodyKey && manifest.has(bodyKey) ? [bodyKey] : [];
    const keys = new Set();
    if (bodyKey && manifest.has(bodyKey)) keys.add(bodyKey);
    else if (config.tex && manifest.has(config.tex)) keys.add(config.tex);
    const visualTiers = [
        ...(config.recruitmentTiers || []),
        ...(config.buildingTiers || []),
    ];
    const activeTierVisual = visualTiers
        .map((tier) => tier?.visual)
        .find((visual) => visual?.tex === bodyKey);
    if (activeTierVisual?.animation?.textureKey
        && manifest.has(activeTierVisual.animation.textureKey)) {
        keys.add(activeTierVisual.animation.textureKey);
    }
    if (activeTierVisual?.groundContact?.textureKey
        && manifest.has(activeTierVisual.groundContact.textureKey)) {
        keys.add(activeTierVisual.groundContact.textureKey);
    }
    if (activeTierVisual?.foregroundOverlay?.textureKey
        && manifest.has(activeTierVisual.foregroundOverlay.textureKey)) {
        keys.add(activeTierVisual.foregroundOverlay.textureKey);
    }
    for (const key of configKeys.get(configId) || []) {
        const entry = manifest.get(key);
        if (!entry) continue;
        // 同一建筑的旧等级主体不能跟随新主体一起加载；仅保留共享复合层。
        if ((key === config.animation?.textureKey
                && !activeTierVisual?.animation?.textureKey)
            || (key === config.groundContact?.textureKey
                && !activeTierVisual?.groundContact?.textureKey)
            || (key === config.foregroundOverlay?.textureKey
                && !activeTierVisual?.foregroundOverlay?.textureKey)) {
            keys.add(key);
        }
    }
    return [...keys];
}

export function getBuildingVisualKeysForEntity(entity) {
    const bodyKey = entity?.spriteCfg?.idleKey;
    const configId = entity?.cfgKey || entity?._cfg?.id || entity?._buildItemId;
    const keys = new Set(getBuildingVisualKeysForConfig(configId, bodyKey));
    if (bodyKey && manifest.has(bodyKey)) keys.add(bodyKey);
    for (const layer of [
        entity?.spriteCfg?.overlayAnimation,
        entity?.spriteCfg?.groundContact,
        entity?.spriteCfg?.foregroundOverlay,
    ]) {
        if (layer?.textureKey && manifest.has(layer.textureKey)) keys.add(layer.textureKey);
    }
    const levels = ECONOMY_LEVELS[entity?._economyType] || [];
    const targetLevel = Number(entity?._economyUpgrade?.targetLevel);
    const pending = levels.find((level) => Number(level.level) === targetLevel);
    if (pending?.tex && manifest.has(pending.tex)) keys.add(pending.tex);
    return [...keys];
}

export function queueBuildingAssets(scene, keys) {
    const queued = [];
    for (const key of new Set(keys || [])) {
        const entry = manifest.get(key);
        if (!entry || isTextureReady(scene, key)) continue;
        if (entry.type === 'spritesheet') {
            scene.load.spritesheet(key, entry.url, {
                frameWidth: entry.frameWidth,
                frameHeight: entry.frameHeight,
                endFrame: entry.endFrame,
            });
        } else {
            scene.load.image(key, entry.url);
        }
        queued.push(entry);
    }
    return queued;
}

export function registerBuildingAnimations(scene, keys) {
    const requested = new Set(keys || []);
    for (const entry of manifest.values()) {
        if (entry.type !== 'spritesheet' || !requested.has(entry.key)) continue;
        if (!isTextureReady(scene, entry.key)) continue;
        if (scene.anims.exists(entry.key)) {
            if (animationUsesCurrentTextures(scene, scene.anims.get(entry.key))) continue;
            removeAnimationSafely(scene, entry.key);
        }
        scene.anims.create({
            key: entry.key,
            frames: scene.anims.generateFrameNumbers(entry.key, { start: 0, end: entry.endFrame }),
            frameRate: entry.frameRate,
            repeat: entry.repeat,
        });
    }
}

export function unloadBuildingAsset(scene, key) {
    if (scene.anims.exists(key)) scene.anims.remove(key);
    if (scene.textures.exists(key)) scene.textures.remove(key);
}

export function estimateLoadedBuildingBytes(scene, key) {
    return loadedTextureBytes(scene, key);
}
