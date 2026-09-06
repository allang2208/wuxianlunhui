/**
 * 共享 Scene Loader 的有界调度层。只取消自己排入的文件，不 reset Scene Loader，
 * 避免误伤平民动画等其他使用者。大资源分小批排队，交互请求可在批次之间优先执行。
 */
export class RuntimeAssetLoadQueue {
    constructor(owner) {
        this.owner = owner;
        this.scene = null;
        this.jobs = new Set();
        this.active = null;
        this.sequence = 0;
        this.idleWaiters = [];
    }

    attachScene(scene) {
        if (this.scene === scene) return;
        this.cancelAll('资源场景已切换');
        this.scene = scene;
    }

    cancelAll(message = '资源加载已取消') {
        const error = Object.assign(new Error(message), { cancelled: true });
        const active = this.active;
        for (const job of this.jobs) job.reject(error);
        this.jobs.clear();
        active?.cancel?.(error);
        this.active = null;
        this._resolveIdle();
    }

    getPinnedKeys() {
        const keys = new Set();
        for (const job of this.jobs) {
            for (const entry of job.entries) keys.add(entry.key);
        }
        return keys;
    }

    getPendingBytes() {
        const entries = new Map();
        for (const job of this.jobs) {
            for (const entry of job.entries) {
                if (!this.owner.isTextureReady(entry.key)) entries.set(entry.key, entry);
            }
        }
        return [...entries.values()].reduce((sum, entry) => sum + entry.estimatedBytes, 0);
    }

    waitForIdle() {
        if (!this.jobs.size && !this.active) return Promise.resolve();
        return new Promise((resolve) => this.idleWaiters.push(resolve));
    }

    _resolveIdle() {
        if (this.jobs.size || this.active) return;
        for (const resolve of this.idleWaiters.splice(0)) resolve();
    }

    _reportProgress(callback, ratio) {
        // UI 回调出错不能卡死共享队列，也不能把成功下载标成失败。
        try { callback?.(ratio); }
        catch (error) { console.warn('[RuntimeAssets] 加载进度回调失败:', error); }
    }

    request(entries, { onProgress = null, shouldLoad = null, priority = 10 } = {}) {
        const unique = [...new Map(entries.map((entry) => [entry.key, entry])).values()];
        if (shouldLoad && !shouldLoad()) return Promise.resolve([]);
        if (unique.every((entry) => this.owner.isTextureReady(entry.key))) {
            for (const entry of unique) this.owner.recordLoadedAsset(entry);
            this._reportProgress(onProgress, 1);
            return Promise.resolve(unique.map((entry) => entry.key));
        }
        if (!this.scene || this.owner.contextLost) {
            return Promise.reject(new Error('Phaser 资源场景暂不可用'));
        }
        const promise = new Promise((resolve, reject) => {
            this.jobs.add({
                entries: unique, pending: [...unique], onProgress, shouldLoad, priority,
                sequence: ++this.sequence, resolve, reject,
            });
        });
        this._drain();
        return promise;
    }

    _drain() {
        if (this.active) return;
        const job = [...this.jobs].sort((a, b) => b.priority - a.priority || a.sequence - b.sequence)[0];
        if (!job) { this._resolveIdle(); return; }
        if (job.shouldLoad && !job.shouldLoad()) {
            this.jobs.delete(job);
            job.resolve([]);
            queueMicrotask(() => this._drain());
            return;
        }
        job.pending = job.pending.filter((entry) => !this.owner.isTextureReady(entry.key));
        if (!job.pending.length) {
            for (const entry of job.entries) this.owner.recordLoadedAsset(entry);
            this.jobs.delete(job);
            this._reportProgress(job.onProgress, 1);
            job.resolve(job.entries.map((entry) => entry.key));
            queueMicrotask(() => this._drain());
            return;
        }
        const blocked = job.pending.filter((entry) => this.owner.getAssetRetryAt(entry) > Date.now());
        if (this.owner._isNetworkLoadBlocked() || blocked.length || this.owner.contextLost) {
            this.jobs.delete(job);
            job.reject(blocked.length
                ? new Error(`资源处于失败退避期: ${blocked.map((entry) => entry.key).join(', ')}`)
                : this.owner._networkBackoffError());
            queueMicrotask(() => this._drain());
            return;
        }
        const batch = [];
        let bytes = 0;
        for (const entry of job.pending) {
            if (batch.length && (batch.length >= this.owner.maxParallelDownloads
                || bytes + entry.estimatedBytes > this.owner.loadBatchBytes)) break;
            batch.push(entry);
            bytes += entry.estimatedBytes;
        }
        const active = { job, batch, bytes, cancel: null };
        this.active = active;
        // 上传前回收无引用热缓存；当前显示和所有请求中的资源始终受保护。
        Promise.resolve().then(() => {
            if (this.active !== active || !this.jobs.has(job)) return;
            this.owner.prepareAssetUpload(bytes);
            return this._loadBatch(active);
        }).then(() => {
            if (!this.jobs.has(job)) return;
            const total = job.entries.reduce((sum, entry) => sum + entry.estimatedBytes, 0) || 1;
            const loaded = job.entries.reduce((sum, entry) => sum
                + (this.owner.isTextureReady(entry.key) ? entry.estimatedBytes : 0), 0);
            this._reportProgress(job.onProgress, Math.min(1, loaded / total));
        }).catch((error) => {
            if (this.jobs.delete(job)) job.reject(error);
        }).finally(() => {
            if (this.active === active) this.active = null;
            this.owner._scheduleReap();
            this._drain();
        });
    }

    _loadBatch(active) {
        const scene = this.scene;
        const loader = scene.load;
        const remaining = new Map(active.batch.map((entry) => [entry.key, entry]));
        const ownedFiles = new Set();
        const failures = new Set();
        return new Promise((resolve, reject) => {
            let finished = false;
            let timer = null;
            const finish = (error = null) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                loader.off('filecomplete', onFileComplete);
                loader.off('loaderror', onError);
                loader.off('complete', onComplete);
                if (error) this._cancelOwnedFiles(loader, ownedFiles, remaining);
                active.cancel = null;
                if (error || failures.size) {
                    reject(error || new Error(`资源加载失败: ${[...failures].join(', ')}`));
                } else {
                    this.owner._markNetworkSuccess();
                    resolve();
                }
            };
            const settle = (key, file = null) => {
                const entry = remaining.get(key);
                if (!entry) return;
                remaining.delete(key);
                if (this.owner.isTextureReady(key, scene)) this.owner.recordLoadedAsset(entry);
                else {
                    failures.add(key);
                    this.owner.recordFailedAsset(entry, file);
                }
                const total = active.job.entries.reduce((sum, asset) => sum + asset.estimatedBytes, 0) || 1;
                const loaded = active.job.entries.reduce((sum, asset) => sum
                    + (this.owner.isTextureReady(asset.key, scene) ? asset.estimatedBytes : 0), 0);
                this._reportProgress(active.job.onProgress, Math.min(1, loaded / total));
                if (!remaining.size) finish();
            };
            const onFileComplete = (key) => settle(key);
            const onError = (file) => settle(file?.key, file);
            // 图片解码失败不一定发 loaderror，必须在 complete 再核对未结算文件。
            const onComplete = () => {
                for (const key of [...remaining.keys()]) settle(key);
            };
            active.cancel = finish;
            loader.on('filecomplete', onFileComplete);
            loader.on('loaderror', onError);
            loader.on('complete', onComplete);
            timer = setTimeout(() => {
                for (const entry of remaining.values()) this.owner.recordFailedAsset(entry);
                finish(new Error(`资源加载超时: ${[...remaining.keys()].join(', ')}`));
            }, this.owner.loadTimeoutMs);
            // Phaser 4 的 Loader 使用原生 Set，entries 是方法而非文件数组。
            // 必须按值遍历，否则已排队文件会被提前判失败，连 loader.start() 也被跳过。
            const findPending = (key) => [loader.list, loader.inflight, loader.queue]
                .flatMap((set) => Array.from(set || [])).find((file) => file.key === key);
            try {
                this.owner.loadGeneration += 1;
                for (const entry of active.batch) {
                    if (findPending(entry.key)) continue;
                    const xhr = { timeout: this.owner.loadTimeoutMs };
                    if (entry.type === 'spritesheet') {
                        loader.spritesheet(entry.key, entry.url, {
                            frameWidth: entry.frameWidth, frameHeight: entry.frameHeight,
                            endFrame: entry.endFrame,
                        }, xhr);
                    } else loader.image(entry.key, entry.url, xhr);
                    const file = findPending(entry.key);
                    if (file) ownedFiles.add(file);
                    else settle(entry.key);
                }
                if (!finished && !loader.isLoading()) loader.start();
            } catch (error) {
                for (const entry of remaining.values()) this.owner.recordFailedAsset(entry);
                finish(error);
            }
        });
    }

    _cancelOwnedFiles(loader, files, remaining) {
        for (const file of files) {
            if (!remaining.has(file.key)) continue;
            const xhr = file.xhrLoader;
            if (xhr) {
                xhr.onload = xhr.onerror = xhr.onprogress = xhr.ontimeout = xhr.onabort = null;
                xhr.abort?.();
            }
            const image = file.data;
            if (image) {
                image.onload = image.onerror = null;
                if (typeof image.src === 'string' && image.src.startsWith('blob:')) {
                    URL.revokeObjectURL(image.src);
                }
            }
            // 取消已开始的解码，阻止迟到回调向同名新纹理写回。
            file.onProcessComplete = file.onProcessError = () => {};
            loader.list?.delete(file);
            loader.inflight?.delete(file);
            loader.queue?.delete(file);
            if (loader._deleteQueue) loader.flagForRemoval(file);
        }
        if (loader.isLoading() && !loader.list?.size && !loader.inflight?.size && !loader.queue?.size) {
            loader.loadComplete();
        }
    }
}
