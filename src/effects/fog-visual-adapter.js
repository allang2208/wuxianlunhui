const LEGACY_VISUAL_KEYS = Object.freeze([
    '_phaserSprite', '_phaserText', '_sprite', '_graphics', '_glowGraphics', '_emitter',
    '_meteor', '_lavaRingGfx', '_arcGfx', '_orbGfx', '_glowGfx', '_ringGfx',
    '_bladeGlowGfx', '_label', '_sprites', '_gfx', '_blobs', '_cloudBlobs',
    '_streaks', '_falling', '_flames', '_smoke', 'graphics',
]);

const WRAPPER_KEYS = Object.freeze([
    'sprite', 'img', 'gfx', 'block', 's1', 's2', 'main', 'glow',
]);

function valueOf(value, owner) {
    return typeof value === 'function' ? value(owner) : value;
}

function pointFrom(value) {
    const x = Number(value?.x);
    const y = Number(value?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function resolvePosition(effect, descriptor) {
    const declared = valueOf(descriptor?.position, effect)
        || (typeof effect?.getFogPosition === 'function' ? effect.getFogPosition() : null);
    const declaredPoint = pointFrom(declared);
    if (declaredPoint) return { point: declaredPoint, ownPoint: true };

    const ownPoint = pointFrom(effect);
    if (ownPoint) return { point: ownPoint, ownPoint: true };

    for (const endpoint of [effect?.target, effect?.source, effect?.entity]) {
        const point = pointFrom(endpoint);
        if (point) return { point, ownPoint: false };
    }
    return { point: null, ownPoint: false };
}

function resolveEndpoints(effect, descriptor) {
    const declared = valueOf(descriptor?.endpoints, effect)
        || (typeof effect?.getFogEndpoints === 'function' ? effect.getFogEndpoints() : null);
    if (Array.isArray(declared)) return declared.filter(Boolean);
    if (declared) return [declared];
    return [effect?.source, effect?.target].filter(Boolean);
}

function resolveVisuals(effect, descriptor) {
    const declared = valueOf(descriptor?.visuals, effect)
        || (typeof effect?.getFogVisuals === 'function' ? effect.getFogVisuals() : null);
    if (declared) return declared;
    const visuals = [];
    for (const key of LEGACY_VISUAL_KEYS) {
        if (effect?.[key]) visuals.push(effect[key]);
    }
    return visuals;
}

/**
 * 特效与战争迷雾之间的唯一视觉边界。
 *
 * 新特效优先实现 getFogPosition()/getFogVisuals()/setFogVisible()；
 * EffectManager 会自动注册普通特效，独立生命周期特效需显式 register/unregister。
 * 这里只切换 Phaser 可见性，不修改特效 active、伤害计时或实体状态。
 */
export const FogVisualAdapter = {
    _tracked: new Set(),
    _hiddenTracked: new Set(),
    _descriptors: new WeakMap(),
    _visibilityWrites: 0,
    _visibilityRedundantSkips: 0,

    register(effect, descriptor = null) {
        if (!effect || (typeof effect !== 'object' && typeof effect !== 'function')) return effect;
        this._tracked.add(effect);
        if (descriptor) this._descriptors.set(effect, descriptor);
        return effect;
    },

    unregister(effect) {
        if (!effect) return;
        this.setHidden(resolveVisuals(effect, this._descriptors.get(effect)), false);
        this._tracked.delete(effect);
        this._hiddenTracked.delete(effect);
        this._descriptors.delete(effect);
    },

    setHidden(value, hidden) {
        if (!value) return;
        if (Array.isArray(value) || value instanceof Set) {
            for (const entry of value) this.setHidden(entry, hidden);
            return;
        }
        if (typeof value.setVisible === 'function') {
            if (hidden) {
                if (!Object.prototype.hasOwnProperty.call(value, '_fogRestoreVisible')) {
                    value._fogRestoreVisible = value.visible !== false;
                }
                if (value.visible !== false) {
                    value.setVisible(false);
                    this._visibilityWrites += 1;
                } else {
                    this._visibilityRedundantSkips += 1;
                }
            } else if (Object.prototype.hasOwnProperty.call(value, '_fogRestoreVisible')) {
                const restoreVisible = value._fogRestoreVisible !== false;
                if (value.visible !== restoreVisible) {
                    value.setVisible(restoreVisible);
                    this._visibilityWrites += 1;
                } else {
                    this._visibilityRedundantSkips += 1;
                }
                delete value._fogRestoreVisible;
            }
            return;
        }
        for (const key of WRAPPER_KEYS) {
            if (value[key] && value[key] !== value) this.setHidden(value[key], hidden);
        }
    },

    syncEffect(effect, sceneId, fogSystem) {
        if (!effect) return true;
        const descriptor = this._descriptors.get(effect) || effect.fogVisual || null;
        if (!fogSystem?.isEnabled?.(sceneId)) {
            effect.setFogVisible?.(true);
            this.setHidden(resolveVisuals(effect, descriptor), false);
            this._hiddenTracked.delete(effect);
            return true;
        }

        const { point, ownPoint } = resolvePosition(effect, descriptor);
        const endpoints = resolveEndpoints(effect, descriptor);
        const checkEndpoints = descriptor?.checkEndpoints ?? !ownPoint;
        const endpointHidden = checkEndpoints
            && endpoints.some((endpoint) => fogSystem.shouldHideEntity(sceneId, endpoint));
        const pointHidden = point ? !fogSystem.isPointVisible(sceneId, point.x, point.y) : false;
        const visible = !endpointHidden && !pointHidden;
        effect.setFogVisible?.(visible);
        this.setHidden(resolveVisuals(effect, descriptor), !visible);
        if (visible) this._hiddenTracked.delete(effect);
        else this._hiddenTracked.add(effect);
        return visible;
    },

    enforceHidden() {
        for (const effect of this._hiddenTracked) {
            if (effect?.active === false || !this._tracked.has(effect)) {
                this._hiddenTracked.delete(effect);
                continue;
            }
            const descriptor = this._descriptors.get(effect) || effect.fogVisual || null;
            this.setHidden(resolveVisuals(effect, descriptor), true);
        }
    },

    syncAll(sceneId, fogSystem) {
        for (const effect of this._tracked) {
            if (effect?.active === false) {
                this.unregister(effect);
                continue;
            }
            this.syncEffect(effect, sceneId, fogSystem);
        }
    },

    getDebugModel() {
        let explicit = 0;
        let legacy = 0;
        for (const effect of this._tracked) {
            const descriptor = this._descriptors.get(effect) || effect?.fogVisual;
            if (descriptor || typeof effect?.getFogVisuals === 'function') explicit += 1;
            else legacy += 1;
        }
        return {
            tracked: this._tracked.size,
            hiddenTracked: this._hiddenTracked.size,
            explicit,
            legacy,
            visibilityWrites: this._visibilityWrites,
            visibilityRedundantSkips: this._visibilityRedundantSkips,
        };
    },
};

export default FogVisualAdapter;
