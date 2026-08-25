import { Camera } from '../world/camera.js';
import { MuzzleFlashEffect } from './muzzle-flash.js';
import { BloodEffect, BloodMistEffect, DodgeEffect, DustEffect } from './particle-effects.js';
import { ShellCasingEffect } from './shell-casing.js';
import { SmokeEffect } from './smoke-effect.js';
import { BloodHitEffect as HitEffect } from './blood-hit-effect.js';
import { FloatingTextEffect } from './floating-text.js';
import { Projectile } from '../combat/projectile.js';
import { FogVisualAdapter } from './fog-visual-adapter.js';
import { PerformanceMonitor } from '../systems/performance-monitor.js';
import performanceConfig from '../../data/performance-config.json';
const FLOATING_TEXT_CONFIG = performanceConfig.floatingText || {};
const DAMAGE_AGGREGATION_CONFIG = FLOATING_TEXT_CONFIG.damageAggregation || {};
const MAX_FLOATING_TEXTS = Math.max(1, Number(FLOATING_TEXT_CONFIG.maxActive) || 48);
const FLOATING_TEXT_VIEW_PADDING = Math.max(0, Number(FLOATING_TEXT_CONFIG.viewPaddingPx) || 160);
const DAMAGE_MERGE_ENABLED = DAMAGE_AGGREGATION_CONFIG.enabled !== false;
const DAMAGE_MERGE_GAP_MS = Math.max(0, Number(DAMAGE_AGGREGATION_CONFIG.mergeGapMs) || 360);
const DAMAGE_MERGE_BUCKET_MS = Math.max(
    DAMAGE_MERGE_GAP_MS,
    Number(DAMAGE_AGGREGATION_CONFIG.maxBucketMs) || 900
);
const DAMAGE_MERGE_FALLBACK_RADIUS = Math.max(0, Number(DAMAGE_AGGREGATION_CONFIG.fallbackRadiusPx) || 32);
const DAMAGE_MERGE_SHOW_HIT_COUNT = DAMAGE_AGGREGATION_CONFIG.showHitCount !== false;
const EFFECT_BUDGET_CONFIG = performanceConfig.effectBudget || {};
const COSMETIC_BUDGET_CONFIG = EFFECT_BUDGET_CONFIG.cosmetic || {};
const COSMETIC_PROFILE_CONFIG = EFFECT_BUDGET_CONFIG.profiles || {};
const CAMERA_SWEEP_CONFIG = EFFECT_BUDGET_CONFIG.cameraSweep || {};
const EFFECT_BUDGET_ENABLED = EFFECT_BUDGET_CONFIG.enabled !== false;
const CAMERA_SWEEP_ENABLED = CAMERA_SWEEP_CONFIG.enabled !== false;
const RAW_CAMERA_SWEEP_LOOK_AHEAD_MS = Number(CAMERA_SWEEP_CONFIG.lookAheadMs);
const CAMERA_SWEEP_LOOK_AHEAD_MS = Math.max(
    0,
    Number.isFinite(RAW_CAMERA_SWEEP_LOOK_AHEAD_MS) ? RAW_CAMERA_SWEEP_LOOK_AHEAD_MS : 120
);
const EMPTY_COSMETIC_BUDGET = Object.freeze({ maxPerFrame: 0, maxActive: 0 });
const COSMETIC_PROFILE_NAMES = Object.freeze(['default', 'dungeon', 'plane']);
const PLANE_SCENE_IDS = Object.freeze(new Set(['scene8', 'scene9', 'scene10', 'scene11']));
const COSMETIC_BUDGET_PROFILES = Object.freeze(Object.fromEntries(
    COSMETIC_PROFILE_NAMES.map((profileName) => {
        const rawProfile = COSMETIC_PROFILE_CONFIG[profileName] || {};
        const perFrameMultiplier = Math.max(0, Number(rawProfile.perFrameMultiplier) || 1);
        const activeMultiplier = Math.max(0, Number(rawProfile.activeMultiplier) || 1);
        const viewPaddingPx = Math.max(
            0,
            Number(rawProfile.viewPaddingPx) || Number(EFFECT_BUDGET_CONFIG.viewPaddingPx) || 240
        );
        const parsedMaxCameraLeadPx = Number(rawProfile.maxCameraLeadPx);
        const maxCameraLeadPx = Math.max(
            0,
            Number.isFinite(parsedMaxCameraLeadPx) ? parsedMaxCameraLeadPx : viewPaddingPx
        );
        const budgets = Object.freeze(Object.fromEntries(
            Object.entries(COSMETIC_BUDGET_CONFIG).map(([category, raw]) => {
                const basePerFrame = Math.max(0, Number(raw?.maxPerFrame) || 0);
                const baseActive = Math.max(0, Number(raw?.maxActive) || 0);
                return [category, Object.freeze({
                    maxPerFrame: basePerFrame > 0
                        ? Math.max(1, Math.floor(basePerFrame * perFrameMultiplier))
                        : 0,
                    maxActive: baseActive > 0
                        ? Math.max(1, Math.floor(baseActive * activeMultiplier))
                        : 0,
                })];
            })
        ));
        return [profileName, Object.freeze({ viewPaddingPx, maxCameraLeadPx, budgets })];
    })
));
const DAMAGE_TEXT_RISE_SPEED = -26;
const DEFAULT_POOL_LIMIT = 32;
const EFFECT_POOL_LIMITS = Object.freeze({
    Projectile: 128,
    MuzzleFlashEffect: 64,
    ShellCasingEffect: 64,
    DustEffect: 64,
    DodgeEffect: 16,
});
const EffectManager = {
    effects: [], critFlash: 0,
    _clockMs: 0,
    _pools: {},
    _cosmeticFrameCounts: {},
    _cosmeticActiveCounts: {},
    _cameraMotion: {
        initialized: false,
        x: 0,
        y: 0,
        speedPxPerSec: 0,
        leadX: 0,
        leadY: 0,
    },
    _factories: {
        'BloodEffect': () => new BloodEffect(0, 0, 0),
        'BloodMistEffect': () => new BloodMistEffect(0, 0, 0, true),
        'Projectile': () => new Projectile(0, 0, 0, 0, 0, 0, {min:0,max:0}, false, null, null, null),
        'DustEffect': () => new DustEffect(0, 0, 1.0),
        'DodgeEffect': () => new DodgeEffect(0, 0, 1, 0),
        'SmokeEffect': () => new SmokeEffect(0, 0, 60, true),
        'MuzzleFlashEffect': () => new MuzzleFlashEffect(0, 0, 0, 1, true),
        'ShellCasingEffect': () => new ShellCasingEffect(0, 0, 0, undefined, true),
        'HitEffect': () => new HitEffect(0, 0, null, true)
    },
    _acquire(type) {
        if (!this._pools[type]) this._pools[type] = [];
        let obj = this._pools[type].pop();
        if (!obj) obj = this._factories[type] ? this._factories[type]() : {};
        obj.active = true;
        obj._effectType = type;
        return obj;
    },
    _release(type, obj) {
        if (!this._pools[type]) this._pools[type] = [];
        obj.releaseToPool?.();
        const limit = EFFECT_POOL_LIMITS[type] ?? DEFAULT_POOL_LIMIT;
        if (this._pools[type].length < limit) this._pools[type].push(obj);
        else this.destroyEffectVisuals(obj);
    },
    destroyEffectVisuals(effect) {
        FogVisualAdapter.unregister(effect);
        effect?._destroyPhaserText?.();
        effect?._destroyPhaserSprite?.();
        if (effect?._graphics) {
            effect._graphics.destroy();
            effect._graphics = null;
        }
        if (effect?._sprite) {
            effect._sprite.destroy();
            effect._sprite = null;
        }
    },
    clearPools() {
        for (const pool of Object.values(this._pools)) {
            for (const effect of pool) this.destroyEffectVisuals(effect);
            pool.length = 0;
        }
    },
    _cosmeticProfileName() {
        const sceneId = typeof window !== 'undefined' ? window.SceneManager?.currentScene : null;
        if (sceneId === 'scene7') return 'dungeon';
        if (PLANE_SCENE_IDS.has(sceneId)) return 'plane';
        return 'default';
    },
    _cosmeticBudgetFor(category, profileName) {
        return COSMETIC_BUDGET_PROFILES[profileName]?.budgets?.[category] || EMPTY_COSMETIC_BUDGET;
    },
    _cameraMode() {
        const game = typeof window !== 'undefined' ? window.Game : null;
        const player = game?.player;
        if (player?.droneSystem?.controlling) return 'drone';
        if (Camera.aimOffsetX !== 0 || Camera.aimOffsetY !== 0) return 'aim';
        if (game?._observerMode) return 'observer';
        if (game?.RTSCommand?.enabled) return 'rts';
        if (game?.BuildingSystem?.active) return 'building';
        return 'follow';
    },
    _resetCameraMotion() {
        const motion = this._cameraMotion;
        motion.initialized = false;
        motion.x = 0;
        motion.y = 0;
        motion.speedPxPerSec = 0;
        motion.leadX = 0;
        motion.leadY = 0;
    },
    _updateCameraMotion(dt) {
        const cameraX = Number(Camera.x);
        const cameraY = Number(Camera.y);
        const motion = this._cameraMotion;
        if (!Number.isFinite(cameraX) || !Number.isFinite(cameraY)) {
            this._resetCameraMotion();
            return;
        }
        if (!motion.initialized) {
            motion.initialized = true;
            motion.x = cameraX;
            motion.y = cameraY;
            motion.speedPxPerSec = 0;
            motion.leadX = 0;
            motion.leadY = 0;
            return;
        }

        const elapsedMs = Math.max(1, Math.min(100, Number(dt) || 16.67));
        const velocityX = (cameraX - motion.x) / elapsedMs;
        const velocityY = (cameraY - motion.y) / elapsedMs;
        motion.x = cameraX;
        motion.y = cameraY;
        motion.speedPxPerSec = Math.hypot(velocityX, velocityY) * 1000;

        if (!CAMERA_SWEEP_ENABLED || CAMERA_SWEEP_LOOK_AHEAD_MS <= 0) {
            motion.leadX = 0;
            motion.leadY = 0;
            return;
        }
        const profile = COSMETIC_BUDGET_PROFILES[this._cosmeticProfileName()];
        const maxLead = profile?.maxCameraLeadPx || 0;
        let leadX = velocityX * CAMERA_SWEEP_LOOK_AHEAD_MS;
        let leadY = velocityY * CAMERA_SWEEP_LOOK_AHEAD_MS;
        const leadLength = Math.hypot(leadX, leadY);
        if (leadLength > maxLead) {
            const scale = maxLead / leadLength;
            leadX *= scale;
            leadY *= scale;
        }
        motion.leadX = leadX;
        motion.leadY = leadY;
    },
    _isInsideExpandedRect(x, y, left, top, width, height, padding) {
        return x >= left - padding
            && x <= left + width + padding
            && y >= top - padding
            && y <= top + height + padding;
    },
    _isOutsideCosmeticView(x, y, profileName) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        const view = scene?.cameras?.main?.worldView;
        if (!view) return false;
        const viewPadding = COSMETIC_BUDGET_PROFILES[profileName]?.viewPaddingPx || 0;
        const viewWidth = Number(view.width) || 0;
        const viewHeight = Number(view.height) || 0;
        if (this._isInsideExpandedRect(
            x, y, Number(view.x) || 0, Number(view.y) || 0, viewWidth, viewHeight, viewPadding
        )) return false;

        // Phaser worldView 可能比本帧逻辑 Camera 晚一步同步。单独检查逻辑视口，避免瞄准、
        // 无人机或自由镜头移动时，新进入方向的装饰特效被旧视口提前裁掉。
        const cameraX = Number(Camera.x);
        const cameraY = Number(Camera.y);
        if (!Number.isFinite(cameraX) || !Number.isFinite(cameraY)) return true;
        const logicalLeft = cameraX - viewWidth / 2;
        const logicalTop = cameraY - viewHeight / 2;
        if (this._isInsideExpandedRect(
            x, y, logicalLeft, logicalTop, viewWidth, viewHeight, viewPadding
        )) return false;

        // 预测视口只沿当前镜头速度方向前探，并且受档位上限约束。三个矩形分别判断，
        // 不把瞬移前后视口连成一个巨大包围盒，避免场景切换时保留整条无效走廊。
        const leadX = this._cameraMotion.leadX;
        const leadY = this._cameraMotion.leadY;
        if (CAMERA_SWEEP_ENABLED && (leadX !== 0 || leadY !== 0) && this._isInsideExpandedRect(
            x,
            y,
            logicalLeft + leadX,
            logicalTop + leadY,
            viewWidth,
            viewHeight,
            viewPadding
        )) return false;
        return true;
    },
    _cosmeticDropReason(category, x, y, profileName) {
        if (!EFFECT_BUDGET_ENABLED) return null;
        if (this._isOutsideCosmeticView(x, y, profileName)) return 'offscreen';
        const budget = this._cosmeticBudgetFor(category, profileName);
        if (budget.maxPerFrame > 0
            && (this._cosmeticFrameCounts[category] || 0) >= budget.maxPerFrame) return 'frameCap';
        if (budget.maxActive > 0
            && (this._cosmeticActiveCounts[category] || 0) >= budget.maxActive) return 'activeCap';
        return null;
    },
    canSpawnCosmetic(category, x, y) {
        const profileName = this._cosmeticProfileName();
        return this._cosmeticDropReason(category, x, y, profileName) === null;
    },
    /**
     * 仅用于可丢弃的装饰特效。预算检查发生在 createEffect 之前，避免超额对象先创建再销毁。
     * 投射物、攻击预警、范围判定和信息文字继续走 add()，不受此预算影响。
     */
    spawnCosmetic(category, x, y, createEffect) {
        const profileName = this._cosmeticProfileName();
        const cameraMode = this._cameraMode();
        const dropReason = this._cosmeticDropReason(category, x, y, profileName);
        PerformanceMonitor.setCounter('fxBudget.profile', profileName);
        if (dropReason || typeof createEffect !== 'function') {
            if (dropReason) {
                PerformanceMonitor.addCounter(`fxBudget.${profileName}.dropped.${dropReason}.${category}`);
                PerformanceMonitor.addCounter(
                    `fxBudget.camera.${cameraMode}.dropped.${dropReason}.${category}`
                );
            }
            return null;
        }
        const effect = createEffect();
        if (!effect) return null;
        effect._cosmeticBudgetCategory = category;
        this._cosmeticFrameCounts[category] = (this._cosmeticFrameCounts[category] || 0) + 1;
        this._cosmeticActiveCounts[category] = (this._cosmeticActiveCounts[category] || 0) + 1;
        PerformanceMonitor.addCounter(`fxBudget.${profileName}.spawned.${category}`);
        PerformanceMonitor.addCounter(`fxBudget.camera.${cameraMode}.spawned.${category}`);
        this.add(effect);
        return effect;
    },
    spawnPooledCosmetic(category, type, x, y, ...resetArgs) {
        return this.spawnCosmetic(category, x, y, () => {
            const effect = this._acquire(type);
            effect.reset?.(...resetArgs);
            return effect;
        });
    },
    _releaseCosmeticBudget(effect) {
        const category = effect?._cosmeticBudgetCategory;
        if (!category) return;
        this._cosmeticActiveCounts[category] = Math.max(
            0,
            (this._cosmeticActiveCounts[category] || 0) - 1
        );
        delete effect._cosmeticBudgetCategory;
    },
    syncCosmeticBudgetCounts() {
        for (const category in this._cosmeticFrameCounts) this._cosmeticFrameCounts[category] = 0;
        for (const category in this._cosmeticActiveCounts) this._cosmeticActiveCounts[category] = 0;
        for (const effect of this.effects) {
            const category = effect?.active ? effect._cosmeticBudgetCategory : null;
            if (!category) continue;
            this._cosmeticActiveCounts[category] = (this._cosmeticActiveCounts[category] || 0) + 1;
        }
        this._resetCameraMotion();
    },
    _publishCosmeticBudgetCounters() {
        const profileName = this._cosmeticProfileName();
        const profile = COSMETIC_BUDGET_PROFILES[profileName];
        PerformanceMonitor.setCounter('fxBudget.profile', profileName);
        PerformanceMonitor.setCounter('fxBudget.viewPaddingPx', profile?.viewPaddingPx || 0);
        PerformanceMonitor.setCounter('fxBudget.cameraMode', this._cameraMode());
        PerformanceMonitor.setCounter('fxBudget.cameraSweepEnabled', CAMERA_SWEEP_ENABLED);
        PerformanceMonitor.setCounter('fxBudget.cameraLookAheadMs', CAMERA_SWEEP_LOOK_AHEAD_MS);
        PerformanceMonitor.setCounter('fxBudget.maxCameraLeadPx', profile?.maxCameraLeadPx || 0);
        PerformanceMonitor.setCounter(
            'fxBudget.cameraSpeedPxPerSec',
            Math.round(this._cameraMotion.speedPxPerSec)
        );
        PerformanceMonitor.setCounter(
            'fxBudget.cameraLeadPx',
            Math.round(Math.hypot(this._cameraMotion.leadX, this._cameraMotion.leadY))
        );
        PerformanceMonitor.setCounter('fxBudget.cameraLeadX', Math.round(this._cameraMotion.leadX));
        PerformanceMonitor.setCounter('fxBudget.cameraLeadY', Math.round(this._cameraMotion.leadY));
        let activeTotal = 0;
        let spawnedLastFrame = 0;
        for (const category in profile.budgets) {
            const budget = profile.budgets[category];
            const active = this._cosmeticActiveCounts[category] || 0;
            const spawned = this._cosmeticFrameCounts[category] || 0;
            activeTotal += active;
            spawnedLastFrame += spawned;
            PerformanceMonitor.setCounter(`fxBudget.current.${category}.active`, active);
            PerformanceMonitor.setCounter(`fxBudget.current.${category}.spawnedLastFrame`, spawned);
            PerformanceMonitor.setCounter(`fxBudget.current.${category}.maxPerFrame`, budget.maxPerFrame);
            PerformanceMonitor.setCounter(`fxBudget.current.${category}.maxActive`, budget.maxActive);
        }
        PerformanceMonitor.setCounter('fxBudget.activeTotal', activeTotal);
        PerformanceMonitor.setCounter('fxBudget.spawnedLastFrame', spawnedLastFrame);
    },
    add(effect) {
        if (effect instanceof FloatingTextEffect) {
            const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
            const view = scene?.cameras?.main?.worldView;
            if (view && (effect.x < view.x - FLOATING_TEXT_VIEW_PADDING
                || effect.x > view.right + FLOATING_TEXT_VIEW_PADDING
                || effect.y < view.y - FLOATING_TEXT_VIEW_PADDING
                || effect.y > view.bottom + FLOATING_TEXT_VIEW_PADDING)) {
                effect.active = false;
                effect._destroyPhaserText?.();
                return;
            }
            let floatingCount = 0;
            for (let i = this.effects.length - 1; i >= 0; i--) {
                if (!(this.effects[i] instanceof FloatingTextEffect)) continue;
                floatingCount++;
                if (floatingCount < MAX_FLOATING_TEXTS) continue;
                const oldest = this.effects[i];
                oldest.active = false;
                oldest._destroyPhaserText?.();
                FogVisualAdapter.unregister(oldest);
                this.effects.splice(i, 1);
                break;
            }
        }
        FogVisualAdapter.register(effect);
        this.effects.push(effect);
    },
    /**
     * 清理所有浮动文字效果（事件/场景切换时调用，避免残留）
     */
    clearFloatingTexts() {
        for (let i = this.effects.length - 1; i >= 0; i--) {
            const e = this.effects[i];
            if (e instanceof FloatingTextEffect) {
                e.active = false;
                if (e._destroyPhaserText) e._destroyPhaserText();
                FogVisualAdapter.unregister(e);
                this.effects.splice(i, 1);
            }
        }
    },
    update(dt) {
        this._clockMs += Math.max(0, Number(dt) || 0);
        this._updateCameraMotion(dt);
        this._publishCosmeticBudgetCounters();
        for (const category in this._cosmeticFrameCounts) this._cosmeticFrameCounts[category] = 0;
        // 原地清理失效特效，避免每帧创建新数组
        for (let i = this.effects.length - 1; i >= 0; i--) {
            const e = this.effects[i];
            e.update(dt);
            if (!e.active) {
                FogVisualAdapter.unregister(e);
                this._releaseCosmeticBudget(e);
                if (e._effectType) this._release(e._effectType, e);
                this.effects.splice(i, 1);
            }
        }
        if (this.critFlash > 0) { this.critFlash -= 4.992 * (dt / 1000); if (this.critFlash < 0) this.critFlash = 0; }
    },
    createDamageText(x, y, damage, isCrit, context = null) {
        const parsedDamage = Number(damage);
        if (!Number.isFinite(parsedDamage)) {
            const color = typeof isCrit === 'string' ? isCrit : '#d4c5a9';
            const status = new FloatingTextEffect(x, y - 20, String(damage), color, 16);
            this.add(status);
            return status;
        }
        const numericDamage = Math.max(0, parsedDamage);
        const critical = isCrit === true;
        const target = context && typeof context === 'object' ? context.target || null : null;
        const now = this._clockMs;
        const anchorY = y - 20;
        if (DAMAGE_MERGE_ENABLED) {
            for (let i = this.effects.length - 1; i >= 0; i--) {
                const current = this.effects[i];
                if (!(current instanceof FloatingTextEffect)
                    || !current.active
                    || current._damageValue == null
                    || current._damageCrit !== critical) continue;
                const sameTarget = target
                    ? current._damageTarget === target
                    : Math.hypot(current.x - x, current.y - anchorY) <= DAMAGE_MERGE_FALLBACK_RADIUS;
                const lastHitAt = Number(current._damageLastHitAt);
                const bucketStartedAt = Number(current._damageBucketStartedAt);
                if (!sameTarget
                    || !Number.isFinite(lastHitAt)
                    || !Number.isFinite(bucketStartedAt)
                    || now - lastHitAt > DAMAGE_MERGE_GAP_MS
                    || now - bucketStartedAt > DAMAGE_MERGE_BUCKET_MS) continue;
                current._damageValue += numericDamage;
                current._damageHitCount = Math.max(1, Number(current._damageHitCount) || 1) + 1;
                current._damageLastHitAt = now;
                current.x = x;
                current.y = anchorY;
                current.vy = DAMAGE_TEXT_RISE_SPEED;
                current.setText(this._formatDamageText(
                    current._damageValue,
                    critical,
                    current._damageHitCount
                ));
                current.life = current.maxLife;
                current.pulse?.(0.18);
                return current;
            }
        }
        // 使用 FloatingTextEffect 替代 DOM 伤害数字，统一走 Phaser 渲染管线
        const text = this._formatDamageText(numericDamage, critical, 1);
        const color = critical ? '#ffaa44' : '#ff6666';
        const fontSize = critical ? 22 : 18;
        const effect = new FloatingTextEffect(x, y - 20, text, color, fontSize);
        effect.vy = DAMAGE_TEXT_RISE_SPEED;
        effect._damageValue = numericDamage;
        effect._damageHitCount = 1;
        effect._damageCrit = critical;
        effect._damageTarget = target;
        effect._damageBucketStartedAt = now;
        effect._damageLastHitAt = now;
        this.add(effect);
        return effect;
    },
    _formatDamageText(value, isCrit, hitCount) {
        const rounded = Math.round(Math.max(0, Number(value) || 0) * 10) / 10;
        const count = Math.max(1, Math.floor(Number(hitCount) || 1));
        const countText = DAMAGE_MERGE_SHOW_HIT_COUNT && count > 1 ? ` ×${count}` : '';
        return isCrit ? `暴击! ${rounded}${countText}` : `${rounded}${countText}`;
    },
    triggerCritEffects() { this.critFlash = 1.0; Camera.triggerShake(12); }
};

export { EffectManager };
