import performanceConfig from '../../../data/performance-config.json';
import enemyConfigData from '../../../data/enemy-config.json';
import { RuntimeAssetLoadQueue } from './runtime-asset-load-queue.js';
import {
    isTextureReady, isSpriteFrameReady, loadedTextureBytes, animationUsesCurrentTextures,
    getRenderObjects, removeAnimationSafely, detachSpriteAnimation,
} from './asset-texture-state.js';
import {
    estimateFriendlyUnitGpuBytes,
    getFriendlyUnitAnimationKeys,
    getFriendlyUnitAssetEntries,
    getFriendlyUnitConfig,
    getFriendlyUnitTextureKeys,
    getKnownFriendlyUnitIds,
    registerFriendlyUnitAnimations,
    unloadFriendlyUnitAssets,
} from './friendly-unit-assets.js';
import {
    estimateLoadedBuildingBytes,
    getBuildingAssetEntries,
    getBuildingAssetEntry,
    getBuildingVisualKeysForConfig,
    getBuildingVisualKeysForEntity,
    isDeferredBuildingTexture,
    registerBuildingAnimations,
    unloadBuildingAsset,
} from './building-assets.js';

const residencyConfig = performanceConfig.resourceResidency || {};
const MEBIBYTE = 1024 * 1024;
const RUNTIME_ASSET_MANAGER_KEY = Symbol.for('world122.runtimeAssetManager');
const BUILDING_PREVIEW_OWNER = 'building-placement';

class RuntimeAssetManagerImpl {
    constructor() {
        this.scene = null;
        this.residentFriendlyIds = new Map();
        this.currentFriendlyIds = new Set();
        this.previewFriendlyIds = new Set();
        this.productionFriendlyIds = new Set();
        this.requestPromises = new Map();
        this.failedUntil = new Map();
        this.enemyTextureManifest = new Map();
        this.enemyAnimationManifest = new Map();
        this.bootEnemySourceUrls = new Map();
        this.residentEnemyTextures = new Map();
        this.currentEnemyFamilies = new Set();
        this.previewEnemyFamilies = new Set();
        this.dungeonEnemyFamilies = new Set();
        this.enemyRequestPromises = new Map();
        this.enemyFailedUntil = new Map();
        this.residentBuildingTextures = new Map();
        this.currentBuildingTextures = new Set();
        this.previewBuildingTextures = new Set();
        this.transitionBuildingTextures = new Map();
        this.interactiveContentPins = new Map();
        this.interactiveLoadRevision = 0;
        this.buildingRequestPromises = new Map();
        this.buildingFailedUntil = new Map();
        this.loadQueue = new RuntimeAssetLoadQueue(this);
        this.sceneGeneration = 0;
        this.textureRevision = 0;
        this.animationReadyCache = new WeakMap();
        this.friendlyReadyCache = new Map();
        this.renderReferenceKeys = new Set();
        this.assetFailedUntil = new Map();
        this.entityVisualKeys = new WeakMap();
        this.safeMode = false;
        this.contextLost = false;
        this.networkHandlersInstalled = false;
        this.networkFailedUntil = 0;
        this.networkFailureCount = 0;
        this.networkFailureReason = '';
        this.maxParallelDownloads = Math.max(1, Number(residencyConfig.maxParallelDownloads) || 3);
        this.hotCacheTtlMs = Math.max(0, Number(residencyConfig.hotCacheTtlMs) || 30000);
        this.negativeCacheTtlMs = Math.max(250, Number(residencyConfig.negativeCacheTtlMs) || 5000);
        this.softGpuBudgetBytes = Math.max(128, Number(residencyConfig.softGpuBudgetMiB) || 640) * MEBIBYTE;
        this.deferredEnemyMinBytes = Math.max(1, Number(residencyConfig.deferredEnemyTextureMinMiB) || 4) * MEBIBYTE;
        this.bootLoaderRestore = null;
        this.bootAnimationRestore = null;
        this.loadGeneration = 0;
        this.reapTimer = null;
        this.loadTimeoutMs = Math.max(5000, Number(residencyConfig.loadTimeoutMs) || 30000);
        this.loadBatchBytes = Math.max(8, Number(residencyConfig.loadBatchMiB) || 64) * MEBIBYTE;
    }

    /**
     * Vite 开发期替换模块时复用同一个管理器实例。清单、驻留记录与正在进行的加载
     * 都不能跟着模块对象一起丢失，否则 Boot 已捕获的怪物资源会在开发工具里变成
     * “未登记”。这里只补齐新版本字段，不清空任何现有运行态。
     */
    upgradeState() {
        if (!(this.previewFriendlyIds instanceof Set)) this.previewFriendlyIds = new Set();
        if (!(this.previewEnemyFamilies instanceof Set)) this.previewEnemyFamilies = new Set();
        if (!(this.previewBuildingTextures instanceof Set)) this.previewBuildingTextures = new Set();
        if (!(this.interactiveContentPins instanceof Map)) this.interactiveContentPins = new Map();
        if (!(this.bootEnemySourceUrls instanceof Map)) this.bootEnemySourceUrls = new Map();
        if (!Number.isFinite(this.interactiveLoadRevision)) this.interactiveLoadRevision = 0;
        if (!this.loadQueue) this.loadQueue = new RuntimeAssetLoadQueue(this);
        else Object.setPrototypeOf(this.loadQueue, RuntimeAssetLoadQueue.prototype);
        this.sceneGeneration ||= 0;
        this.textureRevision ||= 0;
        this.animationReadyCache = new WeakMap();
        this.friendlyReadyCache = new Map();
        this.renderReferenceKeys ||= new Set();
        this.assetFailedUntil ||= new Map();
        this.entityVisualKeys = new WeakMap();
        this.loadTimeoutMs ||= 30000;
        this.loadBatchBytes ||= 64 * MEBIBYTE;
        this._refreshInteractivePins();
        if (this.scene) this.attachScene(this.scene);
        return this;
    }

    attachScene(scene) {
        if (!scene?.load || !scene?.textures || !scene?.anims) return;
        if (this._attachedScene === scene) return;
        if (this._attachedScene) this.detachScene(this._attachedScene);
        this.scene = scene;
        this._attachedScene = scene;
        this.sceneGeneration += 1;
        this.loadQueue.attachScene(scene);
        this._onSceneShutdown = () => this.detachScene(scene);
        this._onTextureChanged = () => {
            this.textureRevision += 1;
            this.friendlyReadyCache.clear();
        };
        scene.events.once('shutdown', this._onSceneShutdown);
        scene.events.once('destroy', this._onSceneShutdown);
        scene.textures.on('addtexture', this._onTextureChanged);
        scene.textures.on('removetexture', this._onTextureChanged);
        scene.anims.on('add', this._onTextureChanged);
        scene.anims.on('remove', this._onTextureChanged);
        scene.load.maxParallelDownloads = Math.min(
            scene.load.maxParallelDownloads || this.maxParallelDownloads,
            this.maxParallelDownloads
        );
        if (!this.networkHandlersInstalled && typeof window !== 'undefined') {
            this.networkHandlersInstalled = true;
            window.addEventListener('online', () => this._markNetworkSuccess());
            window.addEventListener('offline', () => {
                if (this._isOfflineForUrl()) this._markNetworkFailure(null, 'browser-offline');
            });
        }
    }

    detachScene(scene) {
        if (this._attachedScene !== scene) return;
        this.sceneGeneration += 1;
        this.loadQueue.attachScene(null);
        scene.events.off('shutdown', this._onSceneShutdown);
        scene.events.off('destroy', this._onSceneShutdown);
        scene.textures.off('addtexture', this._onTextureChanged);
        scene.textures.off('removetexture', this._onTextureChanged);
        scene.anims.off('add', this._onTextureChanged);
        scene.anims.off('remove', this._onTextureChanged);
        clearTimeout(this.reapTimer);
        this.reapTimer = null;
        for (const map of [this.residentFriendlyIds, this.residentEnemyTextures,
            this.residentBuildingTextures, this.requestPromises, this.enemyRequestPromises,
            this.buildingRequestPromises, this.transitionBuildingTextures, this.interactiveContentPins,
            this.failedUntil, this.enemyFailedUntil, this.buildingFailedUntil, this.assetFailedUntil]) map.clear();
        for (const set of [this.currentFriendlyIds, this.currentEnemyFamilies, this.currentBuildingTextures,
            this.productionFriendlyIds, this.dungeonEnemyFamilies, this.renderReferenceKeys]) set.clear();
        this._refreshInteractivePins();
        this.friendlyReadyCache.clear();
        this.animationReadyCache = new WeakMap();
        this.contextLost = false;
        this.safeMode = false;
        this._attachedScene = null;
        this.scene = null;
    }

    markContextLost() {
        this.contextLost = true;
        this.safeMode = true;
        this.loadQueue.cancelAll('WebGL 上下文丢失，资源加载已取消');
        if (this.reapTimer && typeof clearTimeout === 'function') {
            clearTimeout(this.reapTimer);
            this.reapTimer = null;
        }
    }

    recoverAfterContextRestore() {
        this.contextLost = false;
        // 等本次 contextrestored 的全部监听器完成，避免与 Phaser 自身资源重建交错删除。
        const generation = this.sceneGeneration;
        const release = () => {
            if (generation !== this.sceneGeneration || this.contextLost) return;
            this.textureRevision += 1;
            this.friendlyReadyCache.clear();
            this.enterSafeMode();
            this.safeMode = false;
            this._scheduleReap();
        };
        if (typeof queueMicrotask === 'function') queueMicrotask(release);
        else if (typeof setTimeout === 'function') setTimeout(release, 0);
        else release();
    }

    _isOfflineForUrl(url = globalThis.location?.href) {
        if (typeof navigator === 'undefined' || navigator.onLine !== false) return false;
        try {
            const source = new URL(url, globalThis.location?.href);
            // EXE 包内文件和本机 Vite 不依赖互联网；离线不能拦截本地资源。
            if (['file:', 'wl-test:', 'blob:', 'data:'].includes(source.protocol)) return false;
            if (['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) return false;
        } catch { /* 无来源信息时保留远程加载的离线保护。 */ }
        return true;
    }

    _isNetworkLoadBlocked(now = Date.now()) {
        if (this._isOfflineForUrl()) return true;
        return this.networkFailedUntil > now;
    }

    _networkBackoffError() {
        const remainingMs = Math.max(0, this.networkFailedUntil - Date.now());
        const reason = this.networkFailureReason ? ` (${this.networkFailureReason})` : '';
        return new Error(`资源服务器暂不可用${reason}，约 ${Math.ceil(remainingMs / 1000)} 秒后重试`);
    }

    _isTransportFailure(file) {
        const url = file?.url || file?.src || file?.xhrLoader?.url || '';
        // blob: 是 Phaser 为已下载文件创建的临时对象地址；失效属于清单污染，
        // 不是网络离线，不能因此阻断后续所有正常 assets/ 请求。
        if (this._isEphemeralAssetUrl(url)) return false;
        if (this._isOfflineForUrl(url || globalThis.location?.href)) return true;
        const xhr = file?.xhrLoader;
        return !!xhr && Number(xhr.status) === 0;
    }

    _isEphemeralAssetUrl(url) {
        return /^(blob:|data:)/i.test(String(url || '').trim());
    }

    _markNetworkFailure(file = null, reason = '') {
        if (file && !this._isTransportFailure(file)) return;
        const now = Date.now();
        // 同一批并行文件会连续触发 loaderror；只把整批计为一次故障，避免退避指数瞬间打满。
        if (this.networkFailedUntil > now) return;
        this.networkFailureCount += 1;
        const backoffMs = Math.min(
            30000,
            this.negativeCacheTtlMs * Math.pow(2, Math.min(3, this.networkFailureCount - 1))
        );
        this.networkFailedUntil = now + backoffMs;
        this.networkFailureReason = reason || file?.url || file?.src || 'transport-error';
        if (this.reapTimer && typeof clearTimeout === 'function') {
            clearTimeout(this.reapTimer);
            this.reapTimer = null;
        }
        this._scheduleReap();
    }

    _markNetworkSuccess() {
        this.networkFailedUntil = 0;
        this.networkFailureCount = 0;
        this.networkFailureReason = '';
        this._scheduleReap();
    }

    beginBootEnemyDeferral(scene) {
        if (!scene?.load || this.bootLoaderRestore) return;
        const loader = scene.load;
        const originalSpritesheet = loader.spritesheet;
        const originalImage = loader.image;
        loader.image = (key, url, ...args) => {
            if (isDeferredBuildingTexture(key)) return loader;
            if (String(key).startsWith('enemy_') && !this._isEphemeralAssetUrl(url)) {
                this.bootEnemySourceUrls.set(key, { key, type: 'image', url });
            }
            return originalImage.call(loader, key, url, ...args);
        };
        loader.spritesheet = (key, url, config = {}) => {
            if (isDeferredBuildingTexture(key)) return loader;
            const estimatedBytes = (Number(config.frameWidth) || 0)
                * (Number(config.frameHeight) || 0)
                * Math.max(1, (Number(config.endFrame) || 0) + 1) * 4;
            if (String(key).startsWith('enemy_') && !this._isEphemeralAssetUrl(url)) {
                this.bootEnemySourceUrls.set(key, {
                    key,
                    type: 'spritesheet',
                    url,
                    frameWidth: Number(config.frameWidth) || 512,
                    frameHeight: Number(config.frameHeight) || 512,
                    endFrame: Math.max(0, Number(config.endFrame) || 0),
                    estimatedBytes,
                });
            }
            if (String(key).startsWith('enemy_') && estimatedBytes >= this.deferredEnemyMinBytes) {
                this.enemyTextureManifest.set(key, {
                    key,
                    family: this._enemyFamilyFromUrl(url, key),
                    type: 'spritesheet',
                    url,
                    frameWidth: Number(config.frameWidth) || 512,
                    frameHeight: Number(config.frameHeight) || 512,
                    endFrame: Math.max(0, Number(config.endFrame) || 0),
                    estimatedBytes,
                });
                return loader;
            }
            return originalSpritesheet.call(loader, key, url, config);
        };
        this.bootLoaderRestore = () => {
            loader.image = originalImage;
            loader.spritesheet = originalSpritesheet;
            this.bootLoaderRestore = null;
        };
    }

    beginBootEnemyAnimationCapture(scene) {
        if (!scene?.anims || this.bootAnimationRestore) return;
        const manager = scene.anims;
        const originalGenerate = manager.generateFrameNumbers;
        const originalCreate = manager.create;
        manager.generateFrameNumbers = (key, config = {}) => {
            const deferredBuilding = !scene.textures.exists(key) && isDeferredBuildingTexture(key);
            if (!scene.textures.exists(key) && (this.enemyTextureManifest.has(key) || deferredBuilding)) {
                let frames = Array.isArray(config.frames) ? config.frames.slice() : null;
                if (!frames) {
                    const start = Number.isFinite(Number(config.start)) ? Number(config.start) : 0;
                    const end = Number.isFinite(Number(config.end))
                        ? Number(config.end)
                        : (this.enemyTextureManifest.get(key)?.endFrame
                            ?? getBuildingAssetEntry(key)?.endFrame ?? 0);
                    frames = [];
                    const step = start <= end ? 1 : -1;
                    for (let frame = start; step > 0 ? frame <= end : frame >= end; frame += step) {
                        frames.push(frame);
                    }
                }
                return frames.map((frame) => ({ key, frame }));
            }
            return originalGenerate.call(manager, key, config);
        };
        manager.create = (config = {}) => {
            const frames = Array.isArray(config.frames) ? config.frames : [];
            const textureKeys = [...new Set(frames.map((frame) => frame?.key).filter(Boolean))];
            if (textureKeys.some((key) => isDeferredBuildingTexture(key))) return false;
            if (textureKeys.some((key) => this.enemyTextureManifest.has(key))) {
                this.enemyAnimationManifest.set(config.key, {
                    ...config,
                    key: config.key,
                    textureKeys,
                    frames: frames.map((frame) => ({ ...frame })),
                });
                return false;
            }
            return originalCreate.call(manager, config);
        };
        this.bootAnimationRestore = () => {
            manager.generateFrameNumbers = originalGenerate;
            manager.create = originalCreate;
            this.bootAnimationRestore = null;
        };
    }

    getIdsFromEntities(entities) {
        const ids = [];
        for (const entity of entities || []) {
            if (!this._entityNeedsVisual(entity)) continue;
            const id = entity?.animId || entity?.id;
            if (id) ids.push(id);
        }
        return getKnownFriendlyUnitIds(ids);
    }

    captureAndEvictBootEnemyAssets(scene) {
        if (!scene?.textures || !scene?.anims) return;
        this.bootLoaderRestore?.();
        this.bootAnimationRestore?.();
        const deferredKeys = new Set();
        for (const key of Object.keys(scene.textures.list || {})) {
            if (!key.startsWith('enemy_') || key === 'enemy_circle') continue;
            const texture = scene.textures.get(key);
            const sourceImage = texture?.source?.[0]?.image;
            const width = Number(sourceImage?.naturalWidth || sourceImage?.width) || 0;
            const height = Number(sourceImage?.naturalHeight || sourceImage?.height) || 0;
            const estimatedBytes = width * height * 4;
            const runtimeUrl = sourceImage?.getAttribute?.('src') || sourceImage?.currentSrc || sourceImage?.src;
            const queuedSource = this.bootEnemySourceUrls.get(key);
            const previousSource = this.enemyTextureManifest.get(key);
            const stableUrl = [queuedSource?.url, previousSource?.url, runtimeUrl]
                .find((candidate) => candidate && !this._isEphemeralAssetUrl(candidate));
            const url = stableUrl || runtimeUrl;
            if (!url) continue;
            const frameNames = texture.getFrameNames?.() || [];
            const numericFrames = frameNames
                .map((name) => Number(name))
                .filter((name) => Number.isInteger(name) && name >= 0);
            const firstFrame = numericFrames.length ? texture.get(Math.min(...numericFrames)) : null;
            const isSheet = numericFrames.length > 0 && firstFrame;
            const family = this._enemyFamilyFromUrl(url, key);
            this.enemyTextureManifest.set(key, {
                key,
                family,
                type: isSheet ? 'spritesheet' : 'image',
                url,
                frameWidth: isSheet ? firstFrame.cutWidth : 0,
                frameHeight: isSheet ? firstFrame.cutHeight : 0,
                endFrame: isSheet ? Math.max(...numericFrames) : 0,
                estimatedBytes,
            });
            if (estimatedBytes >= this.deferredEnemyMinBytes) {
                deferredKeys.add(key);
            } else {
                this.residentEnemyTextures.set(key, {
                    family,
                    estimatedBytes,
                    lastUsedAt: Date.now(),
                });
            }
        }

        for (const [key, animation] of Object.entries(scene.anims.anims?.entries || {})) {
            const textureKeys = new Set((animation.frames || []).map((frame) => frame.textureKey));
            if (![...textureKeys].some((textureKey) => this.enemyTextureManifest.has(textureKey))) continue;
            this.enemyAnimationManifest.set(key, {
                key,
                textureKeys: [...textureKeys],
                frames: (animation.frames || []).map((frame) => ({
                    key: frame.textureKey,
                    frame: frame.textureFrame,
                    duration: frame.duration || 0,
                })),
                frameRate: animation.frameRate,
                duration: animation.duration,
                delay: animation.delay,
                repeat: animation.repeat,
                repeatDelay: animation.repeatDelay,
                yoyo: animation.yoyo,
                showOnStart: animation.showOnStart,
                hideOnComplete: animation.hideOnComplete,
                skipMissedFrames: animation.skipMissedFrames,
                randomFrame: animation.randomFrame,
            });
        }
        for (const key of this.enemyAnimationManifest.keys()) {
            if (scene.anims.exists(key)) scene.anims.remove(key);
        }
        for (const key of deferredKeys) {
            if (scene.textures.exists(key)) scene.textures.remove(key);
        }
        this._registerAvailableEnemyAnimations(scene);
        this.entityVisualKeys = new WeakMap();
    }

    _enemyFamilyFromUrl(url, fallbackKey) {
        const normalized = String(url).replace(/\\/g, '/').split('?')[0];
        const nested = normalized.match(/assets\/enemies\/([^/]+)\//i);
        if (nested) return nested[1].toLowerCase();
        const filename = normalized.split('/').pop()?.replace(/\.[^.]+$/, '') || fallbackKey;
        return filename.replace(/_(idle|walking|walk|running|run|attacking|attack\d*|bite|pounce|howl|howling|dying|death|melt|spitting|spellcast|throw|transform).*$/i, '').toLowerCase();
    }

    getEnemyVisualKeysFromEntities(entities) {
        const keys = new Set();
        for (const entity of entities || []) {
            if (typeof entity?._getTextureKey !== 'function') continue;
            if (!this._entityNeedsVisual(entity)) continue;
            const key = entity._getTextureKey();
            if (key) keys.add(key);
            let completeKeys = this.entityVisualKeys.get(entity);
            if (!completeKeys) {
                const config = entity.config || entity._config;
                completeKeys = config
                    ? this.getEnemyVisualKeysForContent(config.id || '', config) : [];
                this.entityVisualKeys.set(entity, completeKeys);
            }
            for (const completeKey of completeKeys) keys.add(completeKey);
        }
        return [...keys];
    }

    _entityNeedsVisual(entity) {
        return !!entity && (entity.active !== false || entity._dying === true
            || entity._animState === 'dying'
            || (entity._preserveCorpse && (entity._deathAnimTimer > 0 || entity._corpseTimer > 0 || entity._fadeTimer > 0))
            || entity._phaserSprite?.active === true);
    }

    isTextureReady(key, scene = this.scene) {
        return isTextureReady(scene, key);
    }

    isSpriteFrameReady(sprite, scene = this.scene) {
        return isSpriteFrameReady(scene, sprite);
    }

    repairSpriteFrame(sprite, preferredKey = null, scene = this.scene) {
        if (!sprite?.setTexture || this.isSpriteFrameReady(sprite, scene)) return false;
        detachSpriteAnimation(sprite);
        const key = [preferredKey, sprite.texture?.key, 'enemy_circle', '__WHITE']
            .find((candidate) => this.isTextureReady(candidate, scene));
        if (!key) return false;
        const frameName = sprite.frame?.name;
        const texture = scene.textures.get(key);
        sprite.setTexture(key, texture.has(frameName) ? frameName : undefined);
        return true;
    }

    detachSpriteAnimation(sprite) {
        detachSpriteAnimation(sprite);
    }

    isAnimationReady(key, scene = this.scene) {
        const animation = scene?.anims?.get(key);
        if (!animation) return false;
        const cached = this.animationReadyCache.get(animation);
        if (cached?.revision === this.textureRevision && cached.scene === scene) return cached.ready;
        const ready = animationUsesCurrentTextures(scene, animation);
        this.animationReadyCache.set(animation, { revision: this.textureRevision, scene, ready });
        return ready;
    }

    _discardBrokenEnemyTexture(scene, key) {
        this._discardBrokenTexture(scene, key);
    }

    _discardBrokenTexture(scene, key) {
        if (this.contextLost) return;
        if (!scene?.textures?.exists(key) || this.isTextureReady(key, scene)) return;
        const sprites = getRenderObjects(scene).filter((child) => child.texture?.key === key
            || child.frame?.texture?.key === key);
        // 先停动画并解除动画引用，再删动画，最后设置安全帧；remove 不能覆盖安全帧。
        for (const [animationKey, animation] of Object.entries(scene.anims.anims?.entries || {})) {
            if (animation.frames?.some((frame) => frame.textureKey === key)) {
                removeAnimationSafely(scene, animationKey);
            }
        }
        for (const sprite of sprites) {
            detachSpriteAnimation(sprite);
            sprite.setTexture?.(this.isTextureReady('enemy_circle', scene) ? 'enemy_circle' : '__WHITE');
        }
        scene.textures.remove(key);
        this.residentEnemyTextures.delete(key);
        this.residentBuildingTextures.delete(key);
    }

    async ensureEnemyEntities(entities, options = {}) {
        return this.ensureEnemyVisualKeys(this.getEnemyVisualKeysFromEntities(entities), options);
    }

    requestEnemyVisual(key) {
        if (!key || (!this.enemyTextureManifest.has(key) && !this.enemyAnimationManifest.has(key))) {
            return Promise.resolve(false);
        }
        if (this.enemyAnimationManifest.has(key) && this.isAnimationReady(key)) return Promise.resolve(true);
        if (this.enemyRequestPromises.has(key)) return this.enemyRequestPromises.get(key);
        const textureKeys = this.enemyAnimationManifest.get(key)?.textureKeys || [key];
        const needsDownload = textureKeys.some((textureKey) => !this.isTextureReady(textureKey));
        if (needsDownload && this._isNetworkLoadBlocked()) return Promise.resolve(false);
        const retryAt = Math.max(
            this.enemyFailedUntil.get(key) || 0,
            ...(this.enemyAnimationManifest.get(key)?.textureKeys || [])
                .map((textureKey) => this.enemyFailedUntil.get(textureKey) || 0)
        );
        if (needsDownload && retryAt > Date.now()) return Promise.resolve(false);
        const request = this.ensureEnemyVisualKeys([key], { required: false })
            .then(() => (this.enemyTextureManifest.has(key)
                ? this.isTextureReady(key)
                : this.isAnimationReady(key)))
            .catch(() => false)
            .finally(() => {
                if (this.enemyRequestPromises.get(key) === request) this.enemyRequestPromises.delete(key);
            });
        this.enemyRequestPromises.set(key, request);
        return request;
    }

    resolveEnemyVisualKeysForTypes(types) {
        const keys = new Set();
        const unresolvedTypes = [];
        for (const type of types || []) {
            const resolved = this.getEnemyVisualKeysForContent(type, enemyConfigData[type]);
            const configuredFamilies = new Set(this._collectEnemyConfigAssets(enemyConfigData[type])
                .map((asset) => asset.family));
            const resolvedFamilies = this._getEnemyFamiliesForKeys(resolved);
            if (!resolved.length || [...configuredFamilies].some((family) => !resolvedFamilies.has(family))) {
                unresolvedTypes.push(type);
            }
            for (const key of resolved) keys.add(key);
        }
        return { keys: [...keys], unresolvedTypes };
    }

    _legacyEnemyKeysForType(type) {
        const entries = [...this.enemyTextureManifest.values()];
        const normalizedEntries = entries.map((candidate) => ({
            candidate,
            normalizedKey: candidate.key.toLowerCase().replace(/[^a-z0-9]/g, ''),
            normalizedFamily: candidate.family.toLowerCase().replace(/[^a-z0-9]/g, ''),
        }));
        const normalizedType = String(type).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!normalizedType) return [];
        // 精确族名优先，避免 zombie 误命中 zombie_dog 之类的前缀兵种。
        let entry = normalizedEntries.find(({ normalizedFamily }) => normalizedFamily === normalizedType)?.candidate;
        if (!entry) {
            const matches = normalizedEntries.filter(({ normalizedKey, normalizedFamily }) => {
                return normalizedKey.includes(normalizedType)
                    || normalizedType.includes(normalizedFamily)
                    || normalizedFamily.includes(normalizedType);
            });
            const families = new Set(matches.map(({ candidate }) => candidate.family));
            if (families.size === 1) entry = matches[0].candidate;
        }
        return entry ? entries.filter((candidate) => candidate.family === entry.family)
            .map((candidate) => candidate.key) : [];
    }

    getEnemyVisualKeysForTypes(types) {
        return this.resolveEnemyVisualKeysForTypes(types).keys;
    }

    _normalizeEnemyAssetToken(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/\\/g, '/')
            .split('/').pop()
            ?.replace(/\.[^.]+$/, '')
            .replace(/walking/g, 'walk')
            .replace(/running/g, 'run')
            .replace(/attacking/g, 'attack')
            .replace(/dying|dead/g, 'death')
            .replace(/howling/g, 'howl')
            .replace(/[^a-z0-9]/g, '') || '';
    }

    _repairEnemyManifestUrls(configuredAssets, families, type = '') {
        let repaired = false;
        const typeToken = this._normalizeEnemyAssetToken(type);
        for (const entry of this.enemyTextureManifest.values()) {
            const entryToken = this._normalizeEnemyAssetToken(entry.key);
            const belongsToContent = families.has(entry.family)
                || (typeToken && entryToken.includes(typeToken));
            if (!belongsToContent || !this._isEphemeralAssetUrl(entry.url)) continue;
            let best = null;
            let bestScore = -1;
            for (const candidate of configuredAssets) {
                if (families.has(entry.family) && candidate.family !== entry.family) continue;
                const hintToken = this._normalizeEnemyAssetToken(candidate.hint);
                const sourceToken = this._normalizeEnemyAssetToken(candidate.url);
                let score = 0;
                if (hintToken && entryToken.endsWith(hintToken)) score = 400 + hintToken.length;
                else if (hintToken && entryToken.includes(hintToken)) score = 300 + hintToken.length;
                if (sourceToken && entryToken.endsWith(sourceToken)) {
                    score = Math.max(score, 250 + sourceToken.length);
                } else if (sourceToken && entryToken.includes(sourceToken)) {
                    score = Math.max(score, 200 + sourceToken.length);
                }
                if (score > bestScore) {
                    best = candidate;
                    bestScore = score;
                }
            }
            if (!best || bestScore <= 0) continue;
            entry.url = best.url;
            entry.family = best.family;
            this.enemyFailedUntil.delete(entry.key);
            repaired = true;
        }
        if (repaired && this._isEphemeralAssetUrl(this.networkFailureReason)) {
            this._markNetworkSuccess();
        }
        if (repaired) this.entityVisualKeys = new WeakMap();
    }

    /**
     * 收集一个具体怪物会用到的完整资源族。
     *
     * type 只能命中主资源族；双形态怪物可能把另一形态放在不同目录，当前
     * _getTextureKey() 也只能暴露眼下这一帧。碰撞编辑器生成正式测试个体时，
     * 必须把配置中声明的所有 assets/enemies 路径一并纳入，才能保证后续攻击、
     * 变身和死亡动画都已注册。
    */
    _collectEnemyConfigAssets(config) {
        const configuredAssets = [];
        const visit = (value, hint = '') => {
            if (typeof value === 'string') {
                if (/assets[\\/]enemies[\\/]/i.test(value)) {
                    const family = this._enemyFamilyFromUrl(value, '');
                    configuredAssets.push({ url: value, hint, family });
                }
                return;
            }
            if (Array.isArray(value)) {
                for (const item of value) visit(item, hint);
                return;
            }
            if (!value || typeof value !== 'object') return;
            for (const [key, item] of Object.entries(value)) visit(item, key);
        };
        // 显式依赖闭包：召唤/伴生资源随主怪一起预热、驻留；不把任意 summonType 字符串猜成资源。
        const visited = new Set();
        const visitContent = (content) => {
            if (!content || visited.has(content)) return;
            visited.add(content);
            visit(content);
            for (const type of content.visualDependencies || []) {
                if (typeof type === 'string') visitContent(enemyConfigData[type]);
            }
        };
        visitContent(config);
        return configuredAssets;
    }

    getEnemyVisualKeysForContent(type, config = null, entities = []) {
        const keys = new Set();
        const configuredAssets = this._collectEnemyConfigAssets(config);
        const families = new Set(configuredAssets.map((asset) => asset.family));
        this._repairEnemyManifestUrls(configuredAssets, families, type);

        // 配置资源路径是个体身份的权威来源；只有旧怪未声明路径时才回退类型模糊匹配，
        // 避免 amalgamZombie 因包含 zombie 字样而误把整套普通僵尸资源一并载入。
        if (!families.size) {
            for (const key of this._legacyEnemyKeysForType(type)) keys.add(key);
        }

        for (const key of this.getEnemyVisualKeysFromEntities(entities)) {
            keys.add(key);
            const entry = this.enemyTextureManifest.get(key);
            if (entry) families.add(entry.family);
            const animation = this.enemyAnimationManifest.get(key);
            for (const textureKey of animation?.textureKeys || []) {
                const texture = this.enemyTextureManifest.get(textureKey);
                if (texture) families.add(texture.family);
            }
        }
        for (const entry of this.enemyTextureManifest.values()) {
            if (families.has(entry.family)) keys.add(entry.key);
        }
        return [...keys];
    }

    _getEnemyFamiliesForKeys(keys) {
        const families = new Set();
        for (const key of keys || []) {
            const texture = this.enemyTextureManifest.get(key);
            if (texture) families.add(texture.family);
            const animation = this.enemyAnimationManifest.get(key);
            for (const textureKey of animation?.textureKeys || []) {
                const entry = this.enemyTextureManifest.get(textureKey);
                if (entry) families.add(entry.family);
            }
        }
        return families;
    }

    _refreshInteractivePins() {
        const friendlyIds = new Set();
        const enemyFamilies = new Set();
        const buildingTextures = new Set();
        for (const record of this.interactiveContentPins?.values?.() || []) {
            for (const id of record.friendlyIds || []) friendlyIds.add(id);
            for (const family of record.enemyFamilies || []) enemyFamilies.add(family);
            for (const key of record.buildingTextures || []) buildingTextures.add(key);
        }
        this.previewFriendlyIds = friendlyIds;
        this.previewEnemyFamilies = enemyFamilies;
        this.previewBuildingTextures = buildingTextures;
    }

    /**
     * 交互工具统一入口：选中怪物、友军或建筑时先登记保活，再由共享队列分批加载。
     * owner 的新请求会使尚未开始的旧请求失效，快速切换列表不会继续排队下载旧对象。
     */
    async ensureInteractiveContent(owner, request = {}, options = {}) {
        const ownerKey = String(owner || 'interactive-tool');
        const revision = ++this.interactiveLoadRevision;
        const kind = request.kind;
        const record = {
            revision,
            kind,
            friendlyIds: new Set(),
            enemyFamilies: new Set(),
            buildingTextures: new Set(),
        };
        let loadRequest;
        let registrationError = null;

        if (kind === 'enemy') {
            const type = request.type || request.key;
            const keys = this.getEnemyVisualKeysForContent(
                type,
                request.config || null,
                request.entities || []
            );
            if (!keys.length && options.required !== false) {
                registrationError = new Error(`敌人完整资源未登记: ${type}`);
            }
            record.enemyFamilies = this._getEnemyFamiliesForKeys(keys);
            loadRequest = (loadOptions) => this.ensureEnemyTypeContent(
                type,
                request.config || null,
                request.entities || [],
                loadOptions
            );
        } else if (kind === 'friendly') {
            const ids = getKnownFriendlyUnitIds(request.ids || [request.id || request.key]);
            if (!ids.length && options.required !== false) {
                registrationError = new Error(`友军资源未登记: ${request.id || request.key}`);
            }
            record.friendlyIds = new Set(ids);
            loadRequest = (loadOptions) => this.ensureFriendlyUnitIds(ids, loadOptions);
        } else if (kind === 'building') {
            const configId = request.configId || request.id || request.key;
            const keys = getBuildingVisualKeysForConfig(
                configId,
                request.bodyKey || null
            );
            if (!keys.length && options.required !== false) {
                registrationError = new Error(`建筑资源未登记: ${configId}`);
            }
            if (request.bodyKey && !getBuildingAssetEntry(request.bodyKey) && options.required !== false) {
                registrationError = new Error(`建筑主体资源未登记: ${request.bodyKey}`);
            }
            record.buildingTextures = new Set(
                keys.filter((key) => isDeferredBuildingTexture(key))
            );
            loadRequest = (loadOptions) => this.ensureBuildingVisualKeys(keys, loadOptions);
        } else {
            throw new Error(`不支持的交互资源类型: ${kind}`);
        }

        this.interactiveContentPins.set(ownerKey, record);
        this._refreshInteractivePins();
        this._scheduleReap();
        const stillCurrent = () => this.interactiveContentPins.get(ownerKey)?.revision === revision;
        try {
            if (registrationError) throw registrationError;
            const result = await loadRequest({ priority: 20, ...options, shouldLoad: stillCurrent });
            if (!stillCurrent()) throw Object.assign(new Error('资源请求已取消，请重新选择或重试'), { cancelled: true });
            return result;
        } catch (error) {
            if (stillCurrent()) this.releaseInteractiveContent(ownerKey);
            throw error;
        }
    }

    attachInteractiveContentToEntity(owner, entity) {
        const record = this.interactiveContentPins.get(String(owner || 'interactive-tool'));
        if (!record || !entity) return false;
        if (record.kind === 'enemy') {
            entity._runtimeEnemyVisualFamilies = new Set(record.enemyFamilies);
        }
        return true;
    }

    /** 场景分阶段预载期间统一保活，直到实体集合完成提交（或切换失败）。 */
    retainSceneContent(owner, entities, friendlyIds = []) {
        const ownerKey = String(owner);
        const list = [...(entities || [])];
        const record = {
            revision: ++this.interactiveLoadRevision,
            kind: 'scene',
            friendlyIds: new Set(getKnownFriendlyUnitIds(friendlyIds)),
            enemyFamilies: this._getEnemyFamiliesForKeys(this.getEnemyVisualKeysFromEntities(list)),
            buildingTextures: new Set(this.getBuildingVisualKeysFromEntities(list)
                .filter((key) => isDeferredBuildingTexture(key))),
        };
        this.interactiveContentPins.set(ownerKey, record);
        this._refreshInteractivePins();
        return () => {
            if (this.interactiveContentPins.get(ownerKey) === record) this.releaseInteractiveContent(ownerKey);
        };
    }

    releaseInteractiveContent(owner) {
        const ownerKey = String(owner || 'interactive-tool');
        if (!this.interactiveContentPins.delete(ownerKey)) return;
        this._refreshInteractivePins();
        const now = Date.now();
        this._evictUnusedAssets(now);
        this._scheduleReap();
    }

    /**
     * 严格加载某个怪物个体的全部贴图/动画，并把完整资源族挂到实体上。
     * commitEnemyEntities() 会在实体存活期间持续保活这些族，而不只保活当前动作。
     */
    async ensureEnemyTypeContent(type, config = null, entities = [], options = {}) {
        const required = options.required !== false;
        if (options.shouldLoad && !options.shouldLoad()) return [];
        const keys = this.getEnemyVisualKeysForContent(type, config, entities);
        const expectedFamilies = new Set(this._collectEnemyConfigAssets(config || enemyConfigData[type])
            .map((entry) => entry.family).filter(Boolean));
        const registeredFamilies = this._getEnemyFamiliesForKeys(keys);
        const unregistered = [...expectedFamilies].filter((family) => !registeredFamilies.has(family));
        if (required && unregistered.length) {
            throw new Error(`敌人资源族未登记: ${type}（${unregistered.join(', ')}）`);
        }
        if (!keys.length) {
            if (required) throw new Error(`敌人完整资源未登记: ${type}`);
            return [];
        }
        const families = await this.ensureEnemyVisualKeys(keys, { ...options, required });
        if (options.shouldLoad && !options.shouldLoad()) return [];
        const familySet = new Set(families);
        const scene = this.scene;
        const missingTextures = [...this.enemyTextureManifest.values()]
            .filter((entry) => familySet.has(entry.family) && !this.isTextureReady(entry.key, scene))
            .map((entry) => entry.key);
        const missingAnimations = [...this.enemyAnimationManifest.values()]
            .filter((animation) => animation.textureKeys.some((textureKey) => {
                const entry = this.enemyTextureManifest.get(textureKey);
                return entry && familySet.has(entry.family);
            }))
            .filter((animation) => !this.isAnimationReady(animation.key, scene))
            .map((animation) => animation.key);
        if (required && (missingTextures.length || missingAnimations.length)) {
            const details = [
                missingTextures.length ? `贴图 ${missingTextures.join(', ')}` : '',
                missingAnimations.length ? `动画 ${missingAnimations.join(', ')}` : '',
            ].filter(Boolean).join('；');
            throw new Error(`敌人完整资源加载不全: ${type}（${details}）`);
        }
        for (const entity of entities || []) {
            if (entity) entity._runtimeEnemyVisualFamilies = new Set(familySet);
        }
        return [...familySet];
    }

    validateEnemyTypes(types, { required = true } = {}) {
        const result = this.resolveEnemyVisualKeysForTypes(types);
        if (required && result.unresolvedTypes.length) {
            throw new Error(`敌人资源未登记: ${result.unresolvedTypes.join(', ')}`);
        }
        return result;
    }

    prefetchEnemyTypes(types, options = {}) {
        let resolved;
        try {
            resolved = this.validateEnemyTypes(types, { required: options.required === true });
        } catch (error) {
            return Promise.reject(error);
        }
        const { keys } = resolved;
        if (!keys.length) {
            options.onProgress?.(1);
            return Promise.resolve([]);
        }
        return this.ensureEnemyVisualKeys(keys, {
            required: false, priority: options.required ? 10 : 0, ...options,
        });
    }

    setDungeonEnemyTypes(types) {
        const families = new Set();
        for (const key of this.getEnemyVisualKeysForTypes(types)) {
            const texture = this.enemyTextureManifest.get(key);
            if (texture) families.add(texture.family);
            const animation = this.enemyAnimationManifest.get(key);
            for (const textureKey of animation?.textureKeys || []) {
                const entry = this.enemyTextureManifest.get(textureKey);
                if (entry) families.add(entry.family);
            }
        }
        this.dungeonEnemyFamilies = families;
        const now = Date.now();
        for (const record of this.residentEnemyTextures.values()) {
            if (families.has(record.family)) record.lastUsedAt = now;
        }
        this._evictUnusedEnemyTextures(now);
        this._scheduleReap();
    }

    ensureEnemyVisualKeys(keys, options = {}) {
        const requested = [...new Set((keys || []).filter(Boolean))];
        return this._loadEnemyVisualKeys(requested, { required: true, ...options });
    }

    async _loadEnemyVisualKeys(keys, options) {
        const families = this._getEnemyFamiliesForKeys(keys);
        const unknown = keys.filter((key) => !this.enemyTextureManifest.has(key)
            && !this.enemyAnimationManifest.has(key) && !this.isTextureReady(key));
        if (unknown.length && options.required) throw new Error(`敌人资源未登记: ${unknown.join(', ')}`);
        const entries = [...this.enemyTextureManifest.values()]
            .filter((entry) => families.has(entry.family))
            .map((entry) => ({ ...entry, kind: 'enemy' }));
        await this._ensureAssetEntries(entries, options, (scene) => this._registerAvailableEnemyAnimations(scene));
        if (options.shouldLoad && !options.shouldLoad()) return [];
        const completeFamilies = [...families].filter((family) =>
            entries.filter((entry) => entry.family === family).every((entry) => this.isTextureReady(entry.key))
            && [...this.enemyAnimationManifest.values()]
                .filter((animation) => animation.textureKeys.some((key) =>
                    this.enemyTextureManifest.get(key)?.family === family))
                .every((animation) => this.isAnimationReady(animation.key)));
        if (options.required && completeFamilies.length !== families.size) {
            // 多形态怪（熊德鲁伊）必须指出具体缺项，不能只显示无法定位的总括错误。
            const missingTextures = entries.filter((entry) => !this.isTextureReady(entry.key))
                .map((entry) => entry.key);
            const missingAnimations = [...this.enemyAnimationManifest.values()]
                .filter((animation) => animation.textureKeys.some((key) =>
                    families.has(this.enemyTextureManifest.get(key)?.family)))
                .filter((animation) => !this.isAnimationReady(animation.key))
                .map((animation) => animation.key);
            const details = [
                missingTextures.length ? `贴图：${missingTextures.join(', ')}` : '',
                missingAnimations.length ? `动画：${missingAnimations.join(', ')}` : '',
            ].filter(Boolean).join('；');
            throw new Error(`敌人完整贴图或动画尚未就绪（${details}）`);
        }
        return completeFamilies;
    }

    async _ensureAssetEntries(entries, options, finalize) {
        if (!entries.length) { options.onProgress?.(1); return []; }
        const scene = this.scene;
        const generation = this.sceneGeneration;
        let error = null;
        try {
            if (this.contextLost || !scene?.load) throw new Error('Phaser 资源场景暂不可用');
            for (const entry of entries) {
                this._discardBrokenTexture(scene, entry.key);
                if (!this.isTextureReady(entry.key) && this._isEphemeralAssetUrl(entry.url)) {
                    throw new Error(`资源源地址已失效，请刷新页面重新登记: ${entry.key}`);
                }
            }
            await this.loadQueue.request(entries, options);
        } catch (cause) {
            error = cause;
        }
        // 成功部分必须先入账/注册，再传播失败；取消的旧场景不能向新场景回写。
        if (scene === this.scene && generation === this.sceneGeneration && !this.contextLost) {
            for (const entry of entries) {
                if (this.isTextureReady(entry.key, scene)) this.recordLoadedAsset(entry);
            }
            try { finalize?.(scene); } catch (cause) { error ||= cause; }
            this._scheduleReap();
        } else {
            error ||= Object.assign(new Error('资源加载所属场景已结束'), { cancelled: true });
        }
        if (options.shouldLoad && !options.shouldLoad()) return [];
        const missing = entries.filter((entry) => !this.isTextureReady(entry.key));
        if (error || missing.length) {
            if (options.required) throw error || new Error(`资源加载不完整: ${missing.map((entry) => entry.key).join(', ')}`);
            return [];
        }
        options.onProgress?.(1);
        return entries.map((entry) => entry.key);
    }

    getAssetRetryAt(entry) {
        return this.assetFailedUntil.get(entry.key) || 0;
    }

    recordFailedAsset(entry, file = null) {
        const retryAt = Date.now() + this.negativeCacheTtlMs;
        this.assetFailedUntil.set(entry.key, retryAt);
        if (entry.kind === 'friendly') this.failedUntil.set(entry.unitId, retryAt);
        else if (entry.kind === 'enemy') this.enemyFailedUntil.set(entry.key, retryAt);
        else this.buildingFailedUntil.set(entry.key, retryAt);
        if (file) this._markNetworkFailure(file);
    }

    recordLoadedAsset(entry) {
        if (!this.isTextureReady(entry.key)) return;
        this.assetFailedUntil.delete(entry.key);
        if (entry.kind === 'friendly') this._markResident(entry.unitId);
        else if (entry.kind === 'building') this._markBuildingResident(entry.key);
        else {
            this.enemyFailedUntil.delete(entry.key);
            const estimatedBytes = loadedTextureBytes(this.scene, entry.key);
            const manifestEntry = this.enemyTextureManifest.get(entry.key);
            if (manifestEntry) manifestEntry.estimatedBytes = estimatedBytes;
            this.residentEnemyTextures.set(entry.key, {
                family: entry.family, estimatedBytes, lastUsedAt: Date.now(),
            });
        }
    }

    prepareAssetUpload(bytes) {
        this._evictUnusedAssets(Date.now(), bytes);
    }

    _registerAvailableEnemyAnimations(scene) {
        for (const animation of this.enemyAnimationManifest.values()) {
            if (!animation.textureKeys.every((key) => this.isTextureReady(key, scene))) continue;

            // Phaser 的动画配置会区分“字段不存在”和“字段存在但值为 undefined”。
            // 后者会覆盖默认 null/0：duration 驱动的一次性动作会得到 NaN frameRate，
            // repeatDelay/delay 也可能令循环动作首轮后定格。运行时重建动画时只能回放
            // 原配置真正声明过的字段，不能把可选字段全部带成 undefined。
            const existing = scene.anims.exists(animation.key)
                ? scene.anims.get(animation.key)
                : null;
            const invalidTiming = existing
                && existing.getTotalFrames?.() > 1
                && (!Number.isFinite(existing.frameRate)
                    || existing.frameRate <= 0
                    || !Number.isFinite(existing.msPerFrame)
                    || existing.msPerFrame <= 0
                    || !Number.isFinite(existing.delay)
                    || !Number.isFinite(existing.repeat)
                    || !Number.isFinite(existing.repeatDelay));
            if (existing && !invalidTiming && this.isAnimationReady(animation.key, scene)) continue;
            if (existing) removeAnimationSafely(scene, animation.key);

            const config = {
                key: animation.key,
                frames: animation.frames,
            };
            for (const field of [
                'frameRate', 'duration', 'delay', 'repeat', 'repeatDelay', 'yoyo',
                'showOnStart', 'hideOnComplete', 'skipMissedFrames', 'randomFrame',
            ]) {
                if (animation[field] !== undefined) config[field] = animation[field];
            }
            scene.anims.create(config);
        }
    }

    getBuildingVisualKeysFromEntities(entities) {
        const keys = new Set();
        for (const entity of entities || []) {
            if (!entity || (entity.active === false && entity?._sinking !== true)) continue;
            for (const key of getBuildingVisualKeysForEntity(entity)) keys.add(key);
        }
        return [...keys];
    }

    isBuildingVisualKey(key) {
        return !!getBuildingAssetEntry(key);
    }

    async ensureBuildingEntities(entities, options = {}) {
        return this.ensureBuildingVisualKeys(this.getBuildingVisualKeysFromEntities(entities), options);
    }

    ensureBuildingConfig(configId, bodyKey = null, options = {}) {
        return this.ensureBuildingVisualKeys(
            getBuildingVisualKeysForConfig(configId, bodyKey), options);
    }

    requestBuildingVisualKey(key) {
        if (!getBuildingAssetEntry(key)) return Promise.resolve(false);
        if (this.isTextureReady(key)
            && (getBuildingAssetEntry(key).type !== 'spritesheet' || this.isAnimationReady(key))) {
            this._markBuildingResident(key);
            return Promise.resolve(true);
        }
        if (!this.isTextureReady(key) && (this._isNetworkLoadBlocked()
            || (this.buildingFailedUntil.get(key) || 0) > Date.now())) {
            return Promise.resolve(false);
        }
        if (this.buildingRequestPromises.has(key)) return this.buildingRequestPromises.get(key);
        const request = this.ensureBuildingVisualKeys([key], { required: false })
            .then(() => this.isTextureReady(key))
            .catch(() => false)
            .finally(() => {
                if (this.buildingRequestPromises.get(key) === request) this.buildingRequestPromises.delete(key);
            });
        this.buildingRequestPromises.set(key, request);
        return request;
    }

    transitionBuildingVisual(previousKey, nextKey, configId = null) {
        if (previousKey === nextKey) {
            return this.requestBuildingVisualKey(nextKey);
        }
        const previousKeys = configId
            ? getBuildingVisualKeysForConfig(configId, previousKey)
            : [previousKey];
        const nextKeys = configId
            ? getBuildingVisualKeysForConfig(configId, nextKey)
            : [nextKey];
        const transitionKeys = new Set([...previousKeys, ...nextKeys]);
        const sceneGeneration = this.sceneGeneration;
        for (const key of transitionKeys) this._pinBuildingTransition(key);
        const request = configId
            ? this.ensureBuildingVisualKeys(nextKeys, { required: false })
            : this.ensureBuildingVisualKeys([nextKey], { required: false });
        return request.finally(() => {
            if (sceneGeneration !== this.sceneGeneration) return;
            // 下载 pin 结束后，由真实 Sprite 引用继续保护旧图；不猜测“100ms 足够换图”。
            for (const key of transitionKeys) this._unpinBuildingTransition(key);
            this._scheduleReap();
        });
    }

    _pinBuildingTransition(key) {
        if (!isDeferredBuildingTexture(key)) return;
        this.transitionBuildingTextures.set(
            key,
            (this.transitionBuildingTextures.get(key) || 0) + 1
        );
    }

    _unpinBuildingTransition(key) {
        const count = this.transitionBuildingTextures.get(key) || 0;
        if (count <= 1) this.transitionBuildingTextures.delete(key);
        else this.transitionBuildingTextures.set(key, count - 1);
    }

    setBuildingPreview(configId, bodyKey = null, options = {}) {
        return this.ensureInteractiveContent(BUILDING_PREVIEW_OWNER, {
            kind: 'building',
            configId,
            bodyKey,
        }, { required: false, ...options });
    }

    clearBuildingPreview() {
        this.releaseInteractiveContent(BUILDING_PREVIEW_OWNER);
    }

    ensureBuildingVisualKeys(keys, options = {}) {
        const requested = [...new Set((keys || []).filter(Boolean))];
        const unknown = requested.filter((key) => !getBuildingAssetEntry(key));
        if (unknown.length && options.required !== false) {
            return Promise.reject(new Error(`建筑资源未登记: ${unknown.join(', ')}`));
        }
        return this._loadBuildingVisualKeys(requested.filter((key) => getBuildingAssetEntry(key)),
            { required: true, ...options });
    }

    async _loadBuildingVisualKeys(keys, options) {
        const entries = keys.map((key) => ({ ...getBuildingAssetEntry(key), kind: 'building' }));
        await this._ensureAssetEntries(entries, options, (scene) => registerBuildingAnimations(scene, keys));
        if (options.shouldLoad && !options.shouldLoad()) return [];
        const completeKeys = keys.filter((key) => this.isTextureReady(key)
            && (getBuildingAssetEntry(key)?.type !== 'spritesheet' || this.isAnimationReady(key)));
        if (options.required && completeKeys.length !== keys.length) {
            throw new Error('建筑完整贴图或动画尚未就绪');
        }
        return completeKeys;
    }

    commitBuildingEntities(entities) {
        const nextKeys = new Set(this.getBuildingVisualKeysFromEntities(entities)
            .filter((key) => isDeferredBuildingTexture(key)));
        this.currentBuildingTextures = nextKeys;
        const now = Date.now();
        for (const key of nextKeys) {
            if (this.isTextureReady(key)) this._markBuildingResident(key, now);
        }
        this._evictUnusedBuildingTextures(now);
        this._scheduleReap();
    }

    _markBuildingResident(key, now = Date.now()) {
        if (!isDeferredBuildingTexture(key) || !this.isTextureReady(key)) return;
        this.buildingFailedUntil.delete(key);
        this.residentBuildingTextures.set(key, {
            lastUsedAt: now,
            estimatedBytes: estimateLoadedBuildingBytes(this.scene, key),
        });
    }

    waitForIdle() {
        return this.loadQueue.waitForIdle();
    }

    getLoadGeneration() {
        return this.loadGeneration;
    }

    async ensureFriendlyEntities(entities, options = {}) {
        return this.ensureFriendlyUnitIds(this.getIdsFromEntities(entities), options);
    }

    requestFriendlyUnit(id) {
        const knownIds = getKnownFriendlyUnitIds([id]);
        if (!knownIds.length) return Promise.resolve(false);
        if (this._hasFriendlyUnitContent(id)) {
            this._markResident(id);
            return Promise.resolve(true);
        }
        const needsDownload = getFriendlyUnitTextureKeys([id]).some((key) => !this.isTextureReady(key));
        if (needsDownload && (this._isNetworkLoadBlocked() || (this.failedUntil.get(id) || 0) > Date.now())) {
            return Promise.resolve(false);
        }
        if (this.requestPromises.has(id)) return this.requestPromises.get(id);
        const request = this.ensureFriendlyUnitIds([id])
            .then(() => this._hasFriendlyUnitContent(id))
            .catch(() => false)
            .finally(() => {
                if (this.requestPromises.get(id) === request) this.requestPromises.delete(id);
            });
        this.requestPromises.set(id, request);
        return request;
    }

    ensureFriendlyUnitIds(ids, options = {}) {
        const requested = [...new Set((ids || []).filter(Boolean))];
        const knownIds = getKnownFriendlyUnitIds(requested);
        if (knownIds.length !== requested.length && options.required !== false) {
            return Promise.reject(new Error(`友军资源未登记: ${requested.filter((id) => !knownIds.includes(id)).join(', ')}`));
        }
        return this._loadFriendlyUnitIds(knownIds, { required: true, ...options });
    }

    async _loadFriendlyUnitIds(ids, options) {
        const entries = getFriendlyUnitAssetEntries(ids);
        await this._ensureAssetEntries(entries, options, (scene) => {
            registerFriendlyUnitAnimations(scene, ids);
            for (const id of ids) this._markResident(id);
        });
        if (options.shouldLoad && !options.shouldLoad()) return [];
        const completeIds = ids.filter((id) => this._hasFriendlyUnitContent(id));
        if (options.required && completeIds.length !== ids.length) {
            throw new Error(`友军完整贴图或动画尚未就绪: ${ids.filter((id) => !completeIds.includes(id)).join(', ')}`);
        }
        return completeIds;
    }

    isFriendlyUnitReady(id) {
        return this._hasFriendlyUnitContent(id);
    }

    isManagedFriendlyUnit(id) {
        return !!getFriendlyUnitConfig(id);
    }

    _hasFriendlyUnitContent(id) {
        if (!getKnownFriendlyUnitIds([id]).length || !this.scene) return false;
        const cached = this.friendlyReadyCache.get(id);
        if (cached?.revision === this.textureRevision) return cached.ready;
        const ready = getFriendlyUnitTextureKeys([id]).every((key) => this.isTextureReady(key))
            && getFriendlyUnitAnimationKeys([id]).every((key) => this.isAnimationReady(key));
        this.friendlyReadyCache.set(id, { revision: this.textureRevision, ready });
        return ready;
    }

    setProductionFriendlyIds(ids) {
        this.productionFriendlyIds = new Set(getKnownFriendlyUnitIds(ids));
    }

    commitFriendlyEntities(entities, extraIds = null) {
        if (extraIds !== null) this.setProductionFriendlyIds(extraIds);
        const nextIds = new Set([
            ...this.getIdsFromEntities(entities),
            ...this.productionFriendlyIds,
        ]);
        const now = Date.now();
        this.currentFriendlyIds = nextIds;
        for (const id of nextIds) this._markResident(id, now);
        this._evictUnused(now);
        this._scheduleReap();
    }

    commitEnemyEntities(entities) {
        const families = new Set();
        const activeEntities = [];
        for (const entity of entities || []) {
            if (!this._entityNeedsVisual(entity)) continue;
            activeEntities.push(entity);
            for (const family of entity?._runtimeEnemyVisualFamilies || []) families.add(family);
        }
        for (const key of this.getEnemyVisualKeysFromEntities(activeEntities)) {
            const texture = this.enemyTextureManifest.get(key);
            if (texture) families.add(texture.family);
            const animation = this.enemyAnimationManifest.get(key);
            for (const textureKey of animation?.textureKeys || []) {
                const entry = this.enemyTextureManifest.get(textureKey);
                if (entry) families.add(entry.family);
            }
        }
        this.currentEnemyFamilies = families;
        const now = Date.now();
        for (const record of this.residentEnemyTextures.values()) {
            if (families.has(record.family)) record.lastUsedAt = now;
        }
        this._evictUnusedEnemyTextures(now);
        this._scheduleReap();
    }

    enterSafeMode() {
        this.safeMode = true;
        this._evictUnusedAssets(Date.now());
    }

    getStats() {
        let estimatedBytes = 0;
        for (const record of this.residentFriendlyIds.values()) estimatedBytes += record.estimatedBytes;
        for (const record of this.residentEnemyTextures.values()) estimatedBytes += record.estimatedBytes;
        for (const record of this.residentBuildingTextures.values()) estimatedBytes += record.estimatedBytes;
        return {
            residentFriendlyUnits: this.residentFriendlyIds.size,
            currentFriendlyUnits: this.currentFriendlyIds.size,
            previewFriendlyUnits: this.previewFriendlyIds.size,
            estimatedGpuMiB: Math.round(estimatedBytes / MEBIBYTE),
            residentEnemyTextures: this.residentEnemyTextures.size,
            deferredEnemyTextures: this.enemyTextureManifest.size,
            currentEnemyFamilies: this.currentEnemyFamilies.size,
            previewEnemyFamilies: this.previewEnemyFamilies.size,
            residentBuildingTextures: this.residentBuildingTextures.size,
            currentBuildingTextures: this.currentBuildingTextures.size,
            previewBuildingTextures: this.previewBuildingTextures.size,
            deferredBuildingTextures: getBuildingAssetEntries({ deferredOnly: true }).length,
            interactiveContentOwners: this.interactiveContentPins.size,
            safeMode: this.safeMode,
            contextLost: this.contextLost,
            maxParallelDownloads: this.maxParallelDownloads,
            networkBlocked: this._isNetworkLoadBlocked(),
            networkBackoffMs: Math.max(0, this.networkFailedUntil - Date.now()),
            pendingAssetRequests: this.loadQueue.jobs.size,
            pendingAssetMiB: Math.round(this.loadQueue.getPendingBytes() / MEBIBYTE),
            uploadingAssetMiB: Math.round((this.loadQueue.active?.bytes || 0) / MEBIBYTE),
        };
    }

    _markResident(id, now = Date.now()) {
        const estimatedBytes = estimateFriendlyUnitGpuBytes(id, this.scene);
        if (!estimatedBytes) {
            this.residentFriendlyIds.delete(id);
            return;
        }
        // 部分成功也入账，但只有整套贴图/动画恢复才清除失败退避。
        if (this._hasFriendlyUnitContent(id)) this.failedUntil.delete(id);
        this.residentFriendlyIds.set(id, {
            lastUsedAt: now,
            estimatedBytes,
        });
    }

    _evictUnused(now) { this._evictUnusedAssets(now); }

    _evictUnusedEnemyTextures(now) { this._evictUnusedAssets(now); }

    _evictUnusedBuildingTextures(now) { this._evictUnusedAssets(now); }

    _collectRenderTextureKeys() {
        const keys = new Set();
        for (const object of getRenderObjects(this.scene)) {
            if (object.texture?.key) keys.add(object.texture.key);
            if (object.frame?.texture?.key) keys.add(object.frame.texture.key);
            if (object.anims?.currentAnim) {
                for (const frame of object.anims.currentAnim?.frames || []) keys.add(frame.textureKey);
            }
        }
        this.renderReferenceKeys = keys;
        return keys;
    }

    _evictUnusedAssets(now, incomingBytes = 0) {
        const scene = this.scene;
        if (!scene || this.contextLost) return;
        if (!this.safeMode && this._isNetworkLoadBlocked(now)) return;
        const loadingKeys = this.loadQueue.getPinnedKeys();
        const groups = [];
        for (const [id, record] of this.residentFriendlyIds) {
            if (this.currentFriendlyIds.has(id) || this.previewFriendlyIds.has(id)) continue;
            groups.push({ kind: 'friendly', id, keys: getFriendlyUnitTextureKeys([id]),
                records: [record], lastUsedAt: record.lastUsedAt, bytes: record.estimatedBytes });
        }
        const enemyGroups = new Map();
        for (const [key, record] of this.residentEnemyTextures) {
            if (this.currentEnemyFamilies.has(record.family) || this.previewEnemyFamilies.has(record.family)
                || this.dungeonEnemyFamilies.has(record.family)) continue;
            let group = enemyGroups.get(record.family);
            if (!group) {
                group = { kind: 'enemy', keys: [], records: [], lastUsedAt: 0, bytes: 0 };
                enemyGroups.set(record.family, group);
                groups.push(group);
            }
            group.keys.push(key);
            group.records.push(record);
            group.lastUsedAt = Math.max(group.lastUsedAt, record.lastUsedAt);
            group.bytes += record.estimatedBytes;
        }
        for (const [key, record] of this.residentBuildingTextures) {
            if (this.currentBuildingTextures.has(key) || this.previewBuildingTextures.has(key)
                || this.transitionBuildingTextures.has(key)) continue;
            groups.push({ kind: 'building', keys: [key], records: [record],
                lastUsedAt: record.lastUsedAt, bytes: record.estimatedBytes });
        }
        if (!groups.length) return;
        let total = this._totalEstimatedResidentBytes() + incomingBytes;
        if (!this.safeMode && total <= this.softGpuBudgetBytes
            && !groups.some((group) => now - group.lastUsedAt >= this.hotCacheTtlMs)) return;
        // 包括隐藏的可复用 Sprite、容器内对象、尸体、透视副本和旧建筑图。
        // 只在有候选资源时扫描一次，绝不靠 active/visible 推测纹理已经断引用。
        const renderKeys = this._collectRenderTextureKeys();
        for (const group of groups.sort((left, right) => left.lastUsedAt - right.lastUsedAt)) {
            if (group.keys.some((key) => renderKeys.has(key) || loadingKeys.has(key))) {
                for (const record of group.records) record.lastUsedAt = now;
                continue;
            }
            const expired = now - group.lastUsedAt >= this.hotCacheTtlMs;
            if (!this.safeMode && total <= this.softGpuBudgetBytes && !expired) continue;
            if (group.kind === 'friendly') {
                unloadFriendlyUnitAssets(scene, group.id);
                this.residentFriendlyIds.delete(group.id);
                this.friendlyReadyCache.delete(group.id);
            } else if (group.kind === 'building') {
                unloadBuildingAsset(scene, group.keys[0]);
                this.residentBuildingTextures.delete(group.keys[0]);
            } else {
                const removedKeys = new Set(group.keys);
                // 一个家族作为整体回收，先移除动画，再删除帧源。
                for (const [key, animation] of this.enemyAnimationManifest) {
                    if (animation.textureKeys.some((textureKey) => removedKeys.has(textureKey))
                        && scene.anims.exists(key)) scene.anims.remove(key);
                }
                for (const key of group.keys) {
                    if (scene.textures.exists(key)) scene.textures.remove(key);
                    this.residentEnemyTextures.delete(key);
                }
            }
            total -= group.bytes;
        }
    }

    _totalEstimatedResidentBytes() {
        let total = 0;
        for (const record of this.residentFriendlyIds.values()) total += record.estimatedBytes;
        for (const record of this.residentEnemyTextures.values()) total += record.estimatedBytes;
        for (const record of this.residentBuildingTextures.values()) total += record.estimatedBytes;
        return total;
    }

    _scheduleReap() {
        if (this.contextLost || this.safeMode || this.hotCacheTtlMs <= 0
            || typeof setTimeout !== 'function') return;
        if (this.reapTimer) return;
        if (this._isOfflineForUrl()) return;
        const now = Date.now();
        if (this.networkFailedUntil > now) {
            this.reapTimer = setTimeout(() => {
                this.reapTimer = null;
                this._scheduleReap();
            }, Math.max(50, this.networkFailedUntil - now + 10));
            return;
        }
        const expiryTimes = [];
        for (const [id, record] of this.residentFriendlyIds.entries()) {
            if (!this.currentFriendlyIds.has(id) && !this.previewFriendlyIds.has(id)) {
                expiryTimes.push(record.lastUsedAt + this.hotCacheTtlMs);
            }
        }
        for (const record of this.residentEnemyTextures.values()) {
            if (!this.currentEnemyFamilies.has(record.family)
                && !this.previewEnemyFamilies.has(record.family)
                && !this.dungeonEnemyFamilies.has(record.family)) {
                expiryTimes.push(record.lastUsedAt + this.hotCacheTtlMs);
            }
        }
        for (const [key, record] of this.residentBuildingTextures.entries()) {
            if (!this.currentBuildingTextures.has(key)
                && !this.previewBuildingTextures.has(key)
                && !this.transitionBuildingTextures.has(key)) {
                expiryTimes.push(record.lastUsedAt + this.hotCacheTtlMs);
            }
        }
        if (!expiryTimes.length) return;
        const waitMs = Math.max(50, Math.min(...expiryTimes) - Date.now() + 10);
        this.reapTimer = setTimeout(() => {
            this.reapTimer = null;
            const now = Date.now();
            this._evictUnusedAssets(now);
            this._scheduleReap();
        }, waitMs);
    }
}

function getRuntimeAssetManager() {
    const scope = typeof globalThis !== 'undefined' ? globalThis : null;
    const existing = scope?.[RUNTIME_ASSET_MANAGER_KEY];
    if (existing && typeof existing === 'object') {
        Object.setPrototypeOf(existing, RuntimeAssetManagerImpl.prototype);
        return existing.upgradeState();
    }
    const manager = new RuntimeAssetManagerImpl();
    if (scope) scope[RUNTIME_ASSET_MANAGER_KEY] = manager;
    return manager;
}

export const RuntimeAssetManager = getRuntimeAssetManager();
