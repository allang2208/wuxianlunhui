import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { getBuildingModuleUpgradeCost } from './building-upgrade-projects.js';
import { WORLD_RENDER_LAYERS } from './world-render-layers.js';

export const WORLD125_CANDLE_BUILDING_ID = 'dungeon_candle';
export const WORLD125_CANDLE_RANGE_MODULE_ID = 'candle_light_range';

const TARGET_SCENE_ID = 'scene11';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function isCandleBuilding(building) {
    return building?._cfg?.panelMode === 'candle';
}

function moduleValue(building, moduleId) {
    const module = building?._cfg?.modules?.[moduleId];
    if (!module) return 0;
    const level = clamp(
        Math.floor(Number(building?.candleModules?.[moduleId]) || 0),
        0,
        Math.max(0, Math.floor(Number(module.maxLevel) || 0))
    );
    return (Number(module.base) || 0) + (Number(module.per) || 0) * level;
}

/**
 * 世界-125 守夜烛台的单体升级、照明半径与雾潮庇护真源。
 * 环境散布的装饰烛台不进入本系统，避免不可摧毁的永久安全区。
 */
export const CandleSanctuarySystem = {
    _buildings: new Set(),
    _rangeGraphics: null,
    _rangeBuilding: null,

    initializeBuilding(building, saved = {}) {
        if (!isCandleBuilding(building)) return;
        building._isWorld125Candle = true;
        building.candleModules = { ...(saved.candleModules || {}) };
        for (const [moduleId, module] of Object.entries(building._cfg.modules || {})) {
            building.candleModules[moduleId] = clamp(
                Math.floor(Number(building.candleModules[moduleId]) || 0),
                0,
                Math.max(0, Math.floor(Number(module.maxLevel) || 0))
            );
        }
        building._candleUpgrade = saved.candleUpgrade ? {
            moduleId: saved.candleUpgrade.moduleId,
            totalMs: Math.max(1, Number(saved.candleUpgrade.totalMs) || 1),
            remainMs: Math.max(0, Number(saved.candleUpgrade.remainMs) || 0),
        } : null;
        building.fogVisionProfile = 'candle';
        this._syncVisionRadius(building);
        this._buildings.add(building);
    },

    reset() {
        this._buildings.clear();
        this.hideRange();
    },

    unregisterBuilding(building) {
        this._buildings.delete(building);
        if (this._rangeBuilding === building) this.hideRange();
    },

    getBuildings() {
        return Array.from(this._buildings).filter((building) => (
            building?.active !== false
            && !building?._sinking
            && Number(building?.hp) > 0
        ));
    },

    getModuleLevel(building, moduleId = WORLD125_CANDLE_RANGE_MODULE_ID) {
        return Math.max(0, Math.floor(Number(building?.candleModules?.[moduleId]) || 0));
    },

    getLightRange(building) {
        return Math.max(0, moduleValue(building, WORLD125_CANDLE_RANGE_MODULE_ID));
    },

    getUpgradeCost(building, moduleId = WORLD125_CANDLE_RANGE_MODULE_ID) {
        return getBuildingModuleUpgradeCost(
            building?._cfg,
            moduleId,
            this.getModuleLevel(building, moduleId)
        );
    },

    updateBuilding(building, dt) {
        if (!isCandleBuilding(building) || building.active === false) return;
        const upgrade = building._candleUpgrade;
        if (upgrade) {
            upgrade.remainMs -= Math.max(0, Number(dt) || 0);
            if (upgrade.remainMs <= 0) {
                const module = building._cfg.modules?.[upgrade.moduleId];
                if (module) {
                    building.candleModules[upgrade.moduleId] = clamp(
                        this.getModuleLevel(building, upgrade.moduleId) + 1,
                        0,
                        Math.max(0, Math.floor(Number(module.maxLevel) || 0))
                    );
                }
                building._candleUpgrade = null;
            }
        }
        this._syncVisionRadius(building);
        if (this._rangeBuilding === building) this._drawRange(building);
    },

    _syncVisionRadius(building) {
        if (!isCandleBuilding(building)) return;
        building.fogSightRadius = this.getLightRange(building);
    },

    getShelterAt(entity, sceneId = TARGET_SCENE_ID) {
        if (sceneId !== TARGET_SCENE_ID || !entity || entity.active === false) {
            return { sheltered: false, building: null, range: 0, distance: Infinity };
        }
        let nearest = null;
        let nearestDistance = Infinity;
        let nearestRange = 0;
        for (const building of this.getBuildings()) {
            const range = this.getLightRange(building);
            if (!(range > 0)) continue;
            const distance = Math.hypot(
                (Number(entity.x) || 0) - (Number(building.x) || 0),
                (Number(entity.y) || 0) - (Number(building.y) || 0)
            );
            if (distance > range || distance >= nearestDistance) continue;
            nearest = building;
            nearestDistance = distance;
            nearestRange = range;
        }
        return {
            sheltered: !!nearest,
            building: nearest,
            range: nearestRange,
            distance: nearestDistance,
        };
    },

    isSheltered(entity, sceneId = TARGET_SCENE_ID) {
        return this.getShelterAt(entity, sceneId).sheltered;
    },

    showRange(building) {
        if (!isCandleBuilding(building)) return;
        this._rangeBuilding = building;
        this._drawRange(building);
    },

    hideRange() {
        if (this._rangeGraphics?.active) this._rangeGraphics.destroy();
        this._rangeGraphics = null;
        this._rangeBuilding = null;
    },

    _drawRange(building) {
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (!scene?.add?.graphics || !building?.active || !(building.hp > 0)) return;
        if (!this._rangeGraphics?.active || this._rangeGraphics.scene !== scene) {
            if (this._rangeGraphics?.active) this._rangeGraphics.destroy();
            this._rangeGraphics = scene.add.graphics();
            if (scene.worldEffectsGroup) scene.worldEffectsGroup.add(this._rangeGraphics);
        }
        const range = this.getLightRange(building);
        const graphics = this._rangeGraphics;
        graphics.clear();
        graphics.setPosition(building.x, building.y);
        graphics.setDepth(WORLD_RENDER_LAYERS.GROUND_RANGE);
        graphics.fillStyle(0xffb347, 0.09);
        graphics.lineStyle(3, 0xffc66d, 0.86);
        graphics.fillEllipse(0, 0, range * 2, range * 2 * PERSPECTIVE_SCALE_Y);
        graphics.strokeEllipse(0, 0, range * 2, range * 2 * PERSPECTIVE_SCALE_Y);
    },
};

export default CandleSanctuarySystem;
