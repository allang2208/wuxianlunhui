import performanceConfig from '../../../data/performance-config.json';
import {
    estimateFriendlyUnitGpuBytes,
    getKnownFriendlyUnitIds,
    queueFriendlyUnitAssets,
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
    queueBuildingAssets,
    registerBuildingAnimations,
    unloadBuildingAsset,
} from './building-assets.js';

const residencyConfig = performanceConfig.resourceResidency || {};
const MEBIBYTE = 1024 * 1024;

class RuntimeAssetManagerImpl {
    constructor() {
        this.scene = null;
        this.residentFriendlyIds = new Map();
        this.currentFriendlyIds = new Set();
        this.productionFriendlyIds = new Set();
        this.requestPromises = new Map();
        this.failedUntil = new Map();
        this.enemyTextureManifest = new Map();
        this.enemyAnimationManifest = new Map();
        this.residentEnemyTextures = new Map();
        this.currentEnemyFamilies = new Set();
        this.dungeonEnemyFamilies = new Set();
        this.enemyRequestPromises = new Map();
        this.enemyFailedUntil = new Map();
        this.residentBuildingTextures = new Map();
        this.currentBuildingTextures = new Set();
        this.previewBuildingTextures = new Set();
        this.transitionBuildingTextures = new Map();
        this.buildingRequestPromises = new Map();
        this.buildingFailedUntil = new Map();
        this.loadChain = Promise.resolve();
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
    }

    attachScene(scene) {
        if (!scene?.load || !scene?.textures || !scene?.anims) return;
        this.scene = scene;
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

    markContextLost() {
        this.contextLost = true;
        this.safeMode = true;
        if (this.reapTimer && typeof clearTimeout === 'function') {
            clearTimeout(this.reapTimer);
            this.reapTimer = null;
        }
    }

    recoverAfterContextRestore() {
        this.contextLost = false;
        // 等本次 contextrestored 的全部监听器完成，避免与 Phaser 自身资源重建交错删除。
        const release = () => this.enterSafeMode();
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
        if (this._isOfflineForUrl(file?.url || file?.src || file?.xhrLoader?.url || globalThis.location?.href)) return true;
        const xhr = file?.xhrLoader;
        return !!xhr && Number(xhr.status) === 0;
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
            return originalImage.call(loader, key, url, ...args);
        };
        loader.spritesheet = (key, url, config = {}) => {
            if (isDeferredBuildingTexture(key)) return loader;
            const estimatedBytes = (Number(config.frameWidth) || 0)
                * (Number(config.frameHeight) || 0)
                * Math.max(1, (Number(config.endFrame) || 0) + 1) * 4;
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
            const dying = entity?._dying === true || entity?._animState === 'dying';
            if (entity?.active === false && !dying) continue;
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
            const url = sourceImage?.getAttribute?.('src') || sourceImage?.currentSrc || sourceImage?.src;
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
    }

    _enemyFamilyFromUrl(url, fallbackKey) {
        const normalized = String(url).replace(/\\/g, '/').split('?')[0];
        const nested = normalized.match(/assets\/enemies\/([^/]+)\//i);
        if (nested) return nested[1].toLowerCase();
        const filename = normalized.split('/').pop()?.replace(/\.[^.]+$/, '') || fallbackKey;
        return filename.replace(/_(idle|walking|walk|running|run|attacking|attack\d*|bite|pounce|howl|howling|dying|death|melt|spitting|spellcast|throw|transform).*$/i, '').toLowerCase();
    }

    getEnemyVisualKeysFromEntities(entities) {
        const keys = [];
        for (const entity of entities || []) {
            if (typeof entity?._getTextureKey !== 'function') continue;
            const preservedCorpse = entity._preserveCorpse
                && (entity._deathAnimTimer > 0 || entity._corpseTimer > 0 || entity._fadeTimer > 0);
            if (entity.active === false && !preservedCorpse && entity?._phaserSprite?.active !== true) continue;
            const key = entity._getTextureKey();
            if (key) keys.push(key);
        }
        return keys;
    }

    async ensureEnemyEntities(entities, options = {}) {
        return this.ensureEnemyVisualKeys(this.getEnemyVisualKeysFromEntities(entities), options);
    }

    requestEnemyVisual(key) {
        if (!key || (!this.enemyTextureManifest.has(key) && !this.enemyAnimationManifest.has(key))) {
            return Promise.resolve(false);
        }
        if (this._isNetworkLoadBlocked()) return Promise.resolve(false);
        const retryAt = Math.max(
            this.enemyFailedUntil.get(key) || 0,
            ...(this.enemyAnimationManifest.get(key)?.textureKeys || [])
                .map((textureKey) => this.enemyFailedUntil.get(textureKey) || 0)
        );
        if (retryAt > Date.now()) return Promise.resolve(false);
        if (this.enemyRequestPromises.has(key)) return this.enemyRequestPromises.get(key);
        const request = this.ensureEnemyVisualKeys([key], { required: false })
            .then(() => (this.enemyTextureManifest.has(key)
                ? this.scene?.textures?.exists(key) === true
                : this.scene?.anims?.exists(key) === true))
            .catch(() => false)
            .finally(() => this.enemyRequestPromises.delete(key));
        this.enemyRequestPromises.set(key, request);
        return request;
    }

    resolveEnemyVisualKeysForTypes(types) {
        const keys = [];
        const unresolvedTypes = [];
        const seenFamilies = new Set();
        const entries = [...this.enemyTextureManifest.values()];
        const normalizedEntries = entries.map((candidate) => ({
            candidate,
            normalizedKey: candidate.key.toLowerCase().replace(/[^a-z0-9]/g, ''),
            normalizedFamily: candidate.family.toLowerCase().replace(/[^a-z0-9]/g, ''),
        }));
        for (const type of types || []) {
            const normalizedType = String(type).toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!normalizedType) continue;
            // 精确族名优先，避免 zombie 误命中 zombie_dog 之类的前缀兵种。
            let entry = normalizedEntries.find(({ normalizedFamily }) => normalizedFamily === normalizedType)?.candidate;
            if (!entry) entry = normalizedEntries.find(({ normalizedKey, normalizedFamily }) => {
                return normalizedKey.includes(normalizedType)
                    || normalizedType.includes(normalizedFamily)
                    || normalizedFamily.includes(normalizedType);
            })?.candidate;
            if (!entry) {
                unresolvedTypes.push(type);
                continue;
            }
            if (seenFamilies.has(entry.family)) continue;
            seenFamilies.add(entry.family);
            keys.push(entry.key);
        }
        return { keys, unresolvedTypes };
    }

    getEnemyVisualKeysForTypes(types) {
        return this.resolveEnemyVisualKeysForTypes(types).keys;
    }

    validateEnemyTypes(types, { required = true } = {}) {
        const result = this.resolveEnemyVisualKeysForTypes(types);
        if (required && result.unresolvedTypes.length) {
            throw new Error(`敌人资源未登记: ${result.unresolvedTypes.join(', ')}`);
        }
        return result;
    }

    prefetchEnemyTypes(types, options = {}) {
        const { keys, unresolvedTypes } = this.resolveEnemyVisualKeysForTypes(types);
        if (options.required && unresolvedTypes.length) {
            return Promise.reject(new Error(`敌人资源未登记: ${unresolvedTypes.join(', ')}`));
        }
        if (!keys.length) {
            options.onProgress?.(1);
            return Promise.resolve([]);
        }
        return this.ensureEnemyVisualKeys(keys, { required: false, ...options });
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

    ensureEnemyVisualKeys(keys, { onProgress = null, required = true } = {}) {
        const requested = [...new Set((keys || []).filter(Boolean))];
        if (!requested.length) {
            onProgress?.(1);
            return Promise.resolve([]);
        }
        const task = async () => this._loadEnemyVisualKeys(requested, { onProgress, required });
        const result = this.loadChain.then(task, task);
        this.loadChain = result.catch(() => undefined);
        return result;
    }

    async _loadEnemyVisualKeys(keys, { onProgress, required }) {
        const scene = this.scene;
        if (!scene?.load || !scene?.textures || !scene?.anims) {
            if (required) throw new Error('Phaser 资源场景尚未就绪');
            return [];
        }
        if (this._isNetworkLoadBlocked()) {
            onProgress?.(1);
            if (required) throw this._networkBackoffError();
            return [];
        }
        const requestedFamilies = new Set();
        for (const key of keys) {
            const textureEntry = this.enemyTextureManifest.get(key);
            if (textureEntry) requestedFamilies.add(textureEntry.family);
            const animationEntry = this.enemyAnimationManifest.get(key);
            for (const textureKey of animationEntry?.textureKeys || []) {
                const entry = this.enemyTextureManifest.get(textureKey);
                if (entry) requestedFamilies.add(entry.family);
            }
        }
        const entries = [...this.enemyTextureManifest.values()]
            .filter((entry) => requestedFamilies.has(entry.family));
        if (!entries.length) {
            onProgress?.(1);
            return [];
        }
        const now = Date.now();
        const blocked = entries.filter((entry) => (this.enemyFailedUntil.get(entry.key) || 0) > now);
        if (blocked.length && required) {
            throw new Error(`敌人资源处于失败退避期: ${blocked.map((entry) => entry.key).join(', ')}`);
        }
        const missing = entries.filter((entry) => !blocked.includes(entry) && !scene.textures.exists(entry.key));
        if (missing.length) {
            this.loadGeneration += 1;
            for (const entry of missing) {
                if (entry.type === 'spritesheet') {
                    scene.load.spritesheet(entry.key, entry.url, {
                        frameWidth: entry.frameWidth,
                        frameHeight: entry.frameHeight,
                        endFrame: entry.endFrame,
                    });
                } else {
                    scene.load.image(entry.key, entry.url);
                }
            }
            onProgress?.(0);
            const failedKeys = new Set();
            let optionalLoadFailed = false;
            await new Promise((resolve, reject) => {
                const weightByKey = new Map(missing.map((entry) => [entry.key, entry.estimatedBytes]));
                const totalWeight = missing.reduce((sum, entry) => sum + entry.estimatedBytes, 0) || 1;
                let loadedWeight = 0;
                const handleFileComplete = (key) => {
                    loadedWeight += weightByKey.get(key) || 0;
                    onProgress?.(Math.max(0, Math.min(1, loadedWeight / totalWeight)));
                };
                const handleError = (file) => {
                    if (weightByKey.has(file?.key)) failedKeys.add(file.key);
                    this._markNetworkFailure(file);
                };
                const finish = () => {
                    scene.load.off('filecomplete', handleFileComplete);
                    scene.load.off('loaderror', handleError);
                    if (failedKeys.size) reject(new Error(`敌人资源加载失败: ${[...failedKeys].join(', ')}`));
                    else {
                        this._markNetworkSuccess();
                        resolve();
                    }
                };
                scene.load.on('filecomplete', handleFileComplete);
                scene.load.on('loaderror', handleError);
                scene.load.once('complete', finish);
                if (!scene.load.isLoading()) scene.load.start();
            }).catch((error) => {
                const retryAt = Date.now() + this.negativeCacheTtlMs;
                const failed = failedKeys.size ? failedKeys : new Set(missing.map(entry => entry.key));
                for (const key of failed) this.enemyFailedUntil.set(key, retryAt);
                if (required) throw error;
                optionalLoadFailed = true;
            });
            if (optionalLoadFailed) {
                onProgress?.(1);
                return [];
            }
        }

        for (const entry of entries) {
            if (!scene.textures.exists(entry.key)) continue;
            this.enemyFailedUntil.delete(entry.key);
            this.residentEnemyTextures.set(entry.key, {
                family: entry.family,
                estimatedBytes: entry.estimatedBytes,
                lastUsedAt: now,
            });
        }
        this._registerAvailableEnemyAnimations(scene);
        onProgress?.(1);
        return [...requestedFamilies];
    }

    _registerAvailableEnemyAnimations(scene) {
        for (const animation of this.enemyAnimationManifest.values()) {
            if (scene.anims.exists(animation.key)) continue;
            if (!animation.textureKeys.every((key) => scene.textures.exists(key))) continue;
            scene.anims.create({
                key: animation.key,
                frames: animation.frames,
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
        if (this.scene?.textures?.exists(key)) {
            this._markBuildingResident(key);
            return Promise.resolve(true);
        }
        if (this._isNetworkLoadBlocked()
            || (this.buildingFailedUntil.get(key) || 0) > Date.now()) {
            return Promise.resolve(false);
        }
        if (this.buildingRequestPromises.has(key)) return this.buildingRequestPromises.get(key);
        const request = this.ensureBuildingVisualKeys([key], { required: false })
            .then(() => this.scene?.textures?.exists(key) === true)
            .catch(() => false)
            .finally(() => this.buildingRequestPromises.delete(key));
        this.buildingRequestPromises.set(key, request);
        return request;
    }

    transitionBuildingVisual(previousKey, nextKey, configId = null) {
        if (previousKey === nextKey) {
            return this.requestBuildingVisualKey(nextKey);
        }
        this._pinBuildingTransition(previousKey);
        this._pinBuildingTransition(nextKey);
        const request = configId
            ? this.ensureBuildingConfig(configId, nextKey, { required: false })
            : this.ensureBuildingVisualKeys([nextKey], { required: false });
        return request.finally(() => {
            const release = () => {
                this._unpinBuildingTransition(previousKey);
                this._unpinBuildingTransition(nextKey);
                this._scheduleReap();
            };
            // 给中立建筑渲染至少一个刷新窗口，避免新贴图刚到时先卸载仍被 Sprite 引用的旧主体。
            if (typeof setTimeout === 'function') setTimeout(release, 100);
            else release();
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

    setBuildingPreview(configId, bodyKey = null) {
        const keys = getBuildingVisualKeysForConfig(configId, bodyKey);
        this.previewBuildingTextures = new Set(keys.filter((key) => isDeferredBuildingTexture(key)));
        const request = this.ensureBuildingVisualKeys(keys, { required: false });
        this._scheduleReap();
        return request;
    }

    clearBuildingPreview() {
        this.previewBuildingTextures.clear();
        this._evictUnusedBuildingTextures(Date.now());
        this._scheduleReap();
    }

    ensureBuildingVisualKeys(keys, { onProgress = null, required = true } = {}) {
        const requested = [...new Set((keys || []).filter((key) => getBuildingAssetEntry(key)))];
        if (!requested.length) {
            onProgress?.(1);
            return Promise.resolve([]);
        }
        const task = async () => this._loadBuildingVisualKeys(requested, { onProgress, required });
        const result = this.loadChain.then(task, task);
        const guarded = required ? result : result.catch(() => {
            onProgress?.(1);
            return [];
        });
        this.loadChain = guarded.catch(() => undefined);
        return guarded;
    }

    async _loadBuildingVisualKeys(keys, { onProgress, required }) {
        const scene = this.scene;
        if (!scene?.load || !scene?.textures || !scene?.anims) {
            if (required) throw new Error('Phaser 资源场景尚未就绪');
            return [];
        }
        if (this._isNetworkLoadBlocked()) {
            onProgress?.(1);
            if (required) throw this._networkBackoffError();
            return [];
        }
        const now = Date.now();
        const blocked = keys.filter((key) => (this.buildingFailedUntil.get(key) || 0) > now);
        if (blocked.length && required) {
            throw new Error(`建筑资源处于失败退避期: ${blocked.join(', ')}`);
        }
        const loadKeys = keys.filter((key) => !blocked.includes(key));
        const queued = queueBuildingAssets(scene, loadKeys);
        if (queued.length) {
            this.loadGeneration += 1;
            onProgress?.(0);
            const failedKeys = new Set();
            await new Promise((resolve, reject) => {
                const weightByKey = new Map(queued.map((entry) => [entry.key, entry.estimatedBytes]));
                const totalWeight = queued.reduce((sum, entry) => sum + entry.estimatedBytes, 0) || 1;
                let loadedWeight = 0;
                const handleFileComplete = (key) => {
                    loadedWeight += weightByKey.get(key) || 0;
                    onProgress?.(Math.max(0, Math.min(1, loadedWeight / totalWeight)));
                };
                const handleError = (file) => {
                    if (weightByKey.has(file?.key)) failedKeys.add(file.key);
                    this._markNetworkFailure(file);
                };
                const finish = () => {
                    scene.load.off('filecomplete', handleFileComplete);
                    scene.load.off('loaderror', handleError);
                    if (failedKeys.size) reject(new Error(`建筑资源加载失败: ${[...failedKeys].join(', ')}`));
                    else {
                        this._markNetworkSuccess();
                        resolve();
                    }
                };
                scene.load.on('filecomplete', handleFileComplete);
                scene.load.on('loaderror', handleError);
                scene.load.once('complete', finish);
                if (!scene.load.isLoading()) scene.load.start();
            }).catch((error) => {
                const retryAt = Date.now() + this.negativeCacheTtlMs;
                const failed = failedKeys.size
                    ? failedKeys
                    : new Set(queued.map((entry) => entry.key));
                for (const key of failed) this.buildingFailedUntil.set(key, retryAt);
                if (required) throw error;
            });
        }
        registerBuildingAnimations(scene, loadKeys);
        for (const key of loadKeys) {
            if (!scene.textures.exists(key) || !isDeferredBuildingTexture(key)) continue;
            this.buildingFailedUntil.delete(key);
            this._markBuildingResident(key, now);
        }
        onProgress?.(1);
        return loadKeys.filter((key) => scene.textures.exists(key));
    }

    commitBuildingEntities(entities) {
        const nextKeys = new Set(this.getBuildingVisualKeysFromEntities(entities)
            .filter((key) => isDeferredBuildingTexture(key)));
        this.currentBuildingTextures = nextKeys;
        const now = Date.now();
        for (const key of nextKeys) {
            if (this.scene?.textures?.exists(key)) this._markBuildingResident(key, now);
        }
        this._evictUnusedBuildingTextures(now);
        this._scheduleReap();
    }

    _markBuildingResident(key, now = Date.now()) {
        if (!isDeferredBuildingTexture(key)) return;
        this.buildingFailedUntil.delete(key);
        this.residentBuildingTextures.set(key, {
            lastUsedAt: now,
            estimatedBytes: estimateLoadedBuildingBytes(this.scene, key),
        });
    }

    waitForIdle() {
        return this.loadChain;
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
        if (this.scene?.textures?.exists(`companion_${id}_walk`)) {
            this._markResident(id);
            return Promise.resolve(true);
        }
        if (this._isNetworkLoadBlocked() || (this.failedUntil.get(id) || 0) > Date.now()) {
            return Promise.resolve(false);
        }
        if (this.requestPromises.has(id)) return this.requestPromises.get(id);
        const request = this.ensureFriendlyUnitIds([id])
            .then(() => this.scene?.textures?.exists(`companion_${id}_walk`) === true)
            .catch(() => false)
            .finally(() => this.requestPromises.delete(id));
        this.requestPromises.set(id, request);
        return request;
    }

    ensureFriendlyUnitIds(ids, { onProgress = null, required = true } = {}) {
        const knownIds = getKnownFriendlyUnitIds(ids);
        if (!knownIds.length) {
            onProgress?.(1);
            return Promise.resolve([]);
        }
        const task = async () => this._loadFriendlyUnitIds(knownIds, { onProgress, required });
        const result = this.loadChain.then(task, task);
        this.loadChain = result.catch(() => undefined);
        return result;
    }

    async _loadFriendlyUnitIds(ids, { onProgress, required }) {
        const scene = this.scene;
        if (!scene?.load || !scene?.textures || !scene?.anims) {
            if (required) throw new Error('Phaser 资源场景尚未就绪');
            return [];
        }
        if (this._isNetworkLoadBlocked()) {
            onProgress?.(1);
            if (required) throw this._networkBackoffError();
            return [];
        }
        const now = Date.now();
        const blocked = ids.filter((id) => (this.failedUntil.get(id) || 0) > now);
        if (blocked.length && required) {
            throw new Error(`友军资源处于失败退避期: ${blocked.join(', ')}`);
        }
        const loadIds = ids.filter((id) => !blocked.includes(id));
        const missingIds = loadIds.filter((id) => {
            const hasWalk = scene.textures.exists(`companion_${id}_walk`);
            if (hasWalk) this._markResident(id);
            return !hasWalk;
        });
        if (!missingIds.length) {
            registerFriendlyUnitAnimations(scene, loadIds);
            onProgress?.(1);
            return loadIds;
        }

        const failedKeys = new Set();
        const queued = queueFriendlyUnitAssets(scene, missingIds);
        if (!queued.length) {
            registerFriendlyUnitAnimations(scene, loadIds);
            onProgress?.(1);
            return loadIds;
        }
        this.loadGeneration += 1;
        onProgress?.(0);
        let optionalLoadFailed = false;
        await new Promise((resolve, reject) => {
            const weightByKey = new Map(queued.map((entry) => [entry.key, entry.estimatedBytes]));
            const totalWeight = queued.reduce((sum, entry) => sum + entry.estimatedBytes, 0) || 1;
            let loadedWeight = 0;
            const handleFileComplete = (key) => {
                loadedWeight += weightByKey.get(key) || 0;
                onProgress?.(Math.max(0, Math.min(1, loadedWeight / totalWeight)));
            };
            const handleError = (file) => {
                if (weightByKey.has(file?.key)) failedKeys.add(file.key);
                this._markNetworkFailure(file);
            };
            const finish = () => {
                scene.load.off('filecomplete', handleFileComplete);
                scene.load.off('loaderror', handleError);
                if (failedKeys.size) reject(new Error(`友军资源加载失败: ${[...failedKeys].join(', ')}`));
                else {
                    this._markNetworkSuccess();
                    resolve();
                }
            };
            scene.load.on('filecomplete', handleFileComplete);
            scene.load.on('loaderror', handleError);
            scene.load.once('complete', finish);
            if (!scene.load.isLoading()) scene.load.start();
        }).catch((error) => {
            const retryAt = Date.now() + this.negativeCacheTtlMs;
            for (const id of missingIds) this.failedUntil.set(id, retryAt);
            if (required) throw error;
            optionalLoadFailed = true;
        });
        if (optionalLoadFailed) {
            onProgress?.(1);
            return [];
        }

        registerFriendlyUnitAnimations(scene, loadIds);
        for (const id of loadIds) this._markResident(id);
        onProgress?.(1);
        return loadIds;
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
        for (const key of this.getEnemyVisualKeysFromEntities(entities)) {
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
        this._evictUnused(Date.now());
        this._evictUnusedEnemyTextures(Date.now());
        this._evictUnusedBuildingTextures(Date.now());
    }

    getStats() {
        let estimatedBytes = 0;
        for (const record of this.residentFriendlyIds.values()) estimatedBytes += record.estimatedBytes;
        for (const record of this.residentEnemyTextures.values()) estimatedBytes += record.estimatedBytes;
        for (const record of this.residentBuildingTextures.values()) estimatedBytes += record.estimatedBytes;
        return {
            residentFriendlyUnits: this.residentFriendlyIds.size,
            currentFriendlyUnits: this.currentFriendlyIds.size,
            estimatedGpuMiB: Math.round(estimatedBytes / MEBIBYTE),
            residentEnemyTextures: this.residentEnemyTextures.size,
            deferredEnemyTextures: this.enemyTextureManifest.size,
            currentEnemyFamilies: this.currentEnemyFamilies.size,
            residentBuildingTextures: this.residentBuildingTextures.size,
            currentBuildingTextures: this.currentBuildingTextures.size,
            previewBuildingTextures: this.previewBuildingTextures.size,
            deferredBuildingTextures: getBuildingAssetEntries({ deferredOnly: true }).length,
            safeMode: this.safeMode,
            contextLost: this.contextLost,
            maxParallelDownloads: this.maxParallelDownloads,
            networkBlocked: this._isNetworkLoadBlocked(),
            networkBackoffMs: Math.max(0, this.networkFailedUntil - Date.now()),
        };
    }

    _markResident(id, now = Date.now()) {
        this.failedUntil.delete(id);
        this.residentFriendlyIds.set(id, {
            lastUsedAt: now,
            estimatedBytes: estimateFriendlyUnitGpuBytes(id),
        });
    }

    _evictUnused(now) {
        const scene = this.scene;
        if (!scene || this.contextLost) return;
        // 传输故障期间保留现有热缓存，避免“刚卸载、又无法下载”造成可见对象永久占位。
        // WebGL 安全模式优先级更高，显存风险出现时仍允许立即释放非当前资源。
        if (!this.safeMode && this._isNetworkLoadBlocked(now)) return;
        let total = this._totalEstimatedResidentBytes();
        const candidates = [...this.residentFriendlyIds.entries()]
            .filter(([id]) => !this.currentFriendlyIds.has(id))
            .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
        for (const [id, record] of candidates) {
            const expired = now - record.lastUsedAt >= this.hotCacheTtlMs;
            if (!this.safeMode && total <= this.softGpuBudgetBytes && !expired) continue;
            unloadFriendlyUnitAssets(scene, id);
            this.residentFriendlyIds.delete(id);
            total -= record.estimatedBytes;
        }
    }


    _evictUnusedEnemyTextures(now) {
        const scene = this.scene;
        if (!scene || this.contextLost) return;
        if (!this.safeMode && this._isNetworkLoadBlocked(now)) return;
        let total = this._totalEstimatedResidentBytes();
        const candidates = [...this.residentEnemyTextures.entries()]
            .filter(([, record]) => !this.currentEnemyFamilies.has(record.family)
                && !this.dungeonEnemyFamilies.has(record.family))
            .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
        const removedFamilies = new Set();
        for (const [key, record] of candidates) {
            const expired = now - record.lastUsedAt >= this.hotCacheTtlMs;
            if (!this.safeMode && total <= this.softGpuBudgetBytes && !expired) continue;
            if (scene.textures.exists(key)) scene.textures.remove(key);
            this.residentEnemyTextures.delete(key);
            removedFamilies.add(record.family);
            total -= record.estimatedBytes;
        }
        if (!removedFamilies.size) return;
        for (const [key, animation] of this.enemyAnimationManifest.entries()) {
            const touchesRemovedFamily = animation.textureKeys.some((textureKey) => {
                const entry = this.enemyTextureManifest.get(textureKey);
                return entry && removedFamilies.has(entry.family);
            });
            if (touchesRemovedFamily && scene.anims.exists(key)) scene.anims.remove(key);
        }
    }

    _evictUnusedBuildingTextures(now) {
        const scene = this.scene;
        if (!scene || this.contextLost) return;
        if (!this.safeMode && this._isNetworkLoadBlocked(now)) return;
        let total = this._totalEstimatedResidentBytes();
        const candidates = [...this.residentBuildingTextures.entries()]
            .filter(([key]) => !this.currentBuildingTextures.has(key)
                && !this.previewBuildingTextures.has(key)
                && !this.transitionBuildingTextures.has(key))
            .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
        for (const [key, record] of candidates) {
            const expired = now - record.lastUsedAt >= this.hotCacheTtlMs;
            if (!this.safeMode && total <= this.softGpuBudgetBytes && !expired) continue;
            unloadBuildingAsset(scene, key);
            this.residentBuildingTextures.delete(key);
            total -= record.estimatedBytes;
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
            if (!this.currentFriendlyIds.has(id)) expiryTimes.push(record.lastUsedAt + this.hotCacheTtlMs);
        }
        for (const record of this.residentEnemyTextures.values()) {
            if (!this.currentEnemyFamilies.has(record.family)
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
            this._evictUnused(now);
            this._evictUnusedEnemyTextures(now);
            this._evictUnusedBuildingTextures(now);
            this._scheduleReap();
        }, waitMs);
    }
}

export const RuntimeAssetManager = new RuntimeAssetManagerImpl();
