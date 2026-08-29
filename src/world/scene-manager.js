import { Game } from '../game.js';
import { WallSystem } from '../world/wall-system.js';
import { Renderer } from '../world/renderer.js';
import { Camera } from '../world/camera.js';

import { ExpeditionSystem } from '../ui/expedition-system.js';
import { GAME_CONFIG } from '../config/game-config.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { GoldManager } from '../systems/gold-manager.js';
import { SoundManager } from '../ui/sound-manager.js';
import { getElement, getElementIfExists } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { setDungeonFloorProfile, applyDungeonFloorChunked, clearDecoClearZones } from './dungeon-floor-texture.js';
import { getWallPrefabLibrary, loadWallPrefabs, isWallPrefabsLoaded, loadObstacleLayout, loadObstacleDefaults, getObstacleLayout, getWallGeoOverrides, isWallGeoOverridesLoaded } from './wall-prefabs.js';
import { CONFIG } from '../config/config.js';
import { TargetDummy } from '../entities/target-dummy.js';
import { RiftSystem } from '../quest/rift-system.js';
import { QuickBar } from '../ui/quick-bar.js';
import { SystemUI } from '../ui/system-ui.js';
import {
    DefenseSystem, DEFENSE_CONFIG, DefenseTower, DefenseCover, BuildableGate, WallStaircase,
} from './defense-system.js';
import { EnergyNodeSystem } from './energy-node-system.js';
import { HamsterMinerSystem } from './hamster-miner-system.js';
import { HamsterHutSystem, HamsterHut } from './hamster-hut-system.js';
import {
    ProducerBuildingSystem, ProducerBuilding, getProducerConfig, createMilitaryUnit, getMilitaryUnitProfile,
} from './producer-building-system.js';
import { BuildingSystem } from './building-system.js';
import { BuildingRoadSystem } from './building-road-system.js';
import { applyBuildingFootprint } from './building-footprint.js';
import {
    captureAndStoreWorld, applyWorldSnapshot, getWorldSnapshot,
    configureWorld122SnapshotRuntime, resetWorldSnapshot,
} from './world122-snapshot.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { ResearchSystem } from './research-system.js';
import { scatterWorld125Environment } from './world125-environment.js';
import { WorldProgressionSystem } from './world-progression-system.js';
import desertTerrainConfig from '../../data/desert-terrain.json';
import { getFrozenTerrainBase, getFrozenTerrainDeco } from '../config/frozen-terrain.js';
import { TechnologySystem } from './technology-system.js';
import { TroopLineSystem } from './troop-line-system.js';
import loadingScreenConfig from '../../data/loading-screen-config.json';
import { FogOfWarSystem } from './fog-of-war-system.js';
import { PopulationEconomySystem } from './population-economy-system.js';
import { QuestRegistry } from '../quest/quest-registry.js';
import { QuestStore } from '../quest/quest-store.js';
import { RuntimeAssetManager } from '../phaser/assets/runtime-asset-manager.js';

export const SceneManager = {
    currentScene: null,
    scenes: {},
    isLoading: false,
    loadProgress: 0,
    _sceneLabel: null, // 当前场景名称标签
    _inMainHub: false, // 主神空间无敌保护开关，避免依赖 currentScene 产生泄漏
    _mainHubInvincible: true, // 主神空间是否开启无敌（可通过 UI 切换）
    _worldDestructionTransactions: new Map(),
    _loadingStartedAt: 0,
    _loadingMinimumDurationMs: 0,
    _loadingBackground: null,
    _loadingImageCache: [],
    _activeQuestInstance: null,
    _rollbackActiveQuestInstance: null,

    init() {
        this._worldDestructionTransactions.clear();
        this._activeQuestInstance = null;
        this._dungeonParkedFriendlyUnits = null;
        this._dungeonObservationState = null;
        TroopLineSystem.configure({
            createMilitaryUnit,
            getMilitaryUnitProfile,
            isSnapshotTroopProducer: (cfgKey) => {
                const cfg = getProducerConfig(cfgKey);
                return !!(cfg && cfg.spawnEnabled !== false
                    && (cfg.unitTypes || []).some((unit) => !!unit?.key));
            },
        });
        // 快照模块保持无启动期静态依赖；在 Game 已完成定义后才注入恢复所需的实体构造器。
        configureWorld122SnapshotRuntime({
            Game,
            DefenseSystem,
            DefenseTower,
            DefenseCover,
            BuildableGate,
            WallStaircase,
            DEFENSE_CONFIG,
            HamsterHutSystem,
            HamsterHut,
            ProducerBuildingSystem,
            ProducerBuilding,
            getProducerConfig,
            EnergyNodeSystem,
            EnergyManager,
            ResearchSystem,
            TechnologySystem,
            GoldManager,
            PopulationEconomySystem,
            getWorldEpoch: (sceneId) => WorldProgressionSystem.getWorldEpoch(sceneId),
            canPersistWorld: (sceneId) => WorldProgressionSystem.isPortalConstructed(sceneId),
            getWorldGenerationContext: (sceneId) => WorldProgressionSystem.getWorldGenerationContext(sceneId),
        });
        // 新游戏初始传送门也必须在五日入侵开始前拥有基础位面快照。
        WorldProgressionSystem.ensureConstructedWorldSnapshots();
        const cfg = GAME_CONFIG.scenes || {};
        this.scenes = {
            main: cfg.main || { name: '主神空间', type: 'main', label: '场景一', width: 12288, height: 8192, background: '#2a3520', diamondFloor: { enabled: true }, origin: { x: 6144, y: 4096 } },
            scene7: cfg.scene7 || { name: '恐怖地牢高级', type: 'dungeon', label: '场景七', width: 1024, height: 1024, background: '#000000', origin: { x: 512, y: 512 }, dungeonType: 'zombie' },
            scene8: cfg.scene8 || { name: '世界-122', type: 'instance', label: '场景八', width: 12288, height: 8192, background: '#0d1b0a', origin: { x: 6144, y: 4096 } },
            scene9: cfg.scene9 || { name: '世界-123·雪原', type: 'instance', label: '场景九', width: 12288, height: 8192, background: '#101a2b', origin: { x: 6144, y: 4096 } },
            scene10: cfg.scene10 || { name: '世界-124·林地', type: 'instance', label: '场景十', width: 12288, height: 8192, background: '#102015', origin: { x: 6144, y: 4096 } },
            scene11: cfg.scene11 || { name: '世界-125·地牢遗迹', type: 'instance', label: '场景十一', width: 12288, height: 8192, background: '#050505', origin: { x: 6144, y: 4096 } }
        };
        // loading 背景走浏览器图片缓存，不进入 Phaser 世界纹理生命周期。
        if (typeof Image !== 'undefined') {
            const paths = Object.values(loadingScreenConfig || {})
                .flatMap((screen) => Array.isArray(screen?.backgrounds) ? screen.backgrounds : [])
                .filter(Boolean);
            this._loadingImageCache = paths.map((src) => {
                const image = new Image();
                image.src = src;
                return image;
            });
        }
    },

    async prepareRuntimeVisualAssets({ startProgress = 70, endProgress = 98 } = {}) {
        const generationBefore = RuntimeAssetManager.getLoadGeneration();
        const span = Math.max(0, endProgress - startProgress);
        const enemyEnd = startProgress + span * 0.55;
        const friendlyEnd = startProgress + span * 0.82;
        await RuntimeAssetManager.ensureEnemyEntities(Game.entities?.values?.() || [], {
            onProgress: (ratio) => this.setProgress(startProgress + ratio * (enemyEnd - startProgress)),
        });
        const productionIds = ProducerBuildingSystem.getActiveVisualUnitIds?.() || [];
        await RuntimeAssetManager.ensureFriendlyUnitIds([
            ...RuntimeAssetManager.getIdsFromEntities(Game.friendlyUnits),
            ...productionIds,
        ], {
            onProgress: (ratio) => this.setProgress(enemyEnd + ratio * (friendlyEnd - enemyEnd)),
        });
        await RuntimeAssetManager.ensureBuildingEntities(Game.entities?.values?.() || [], {
            onProgress: (ratio) => this.setProgress(friendlyEnd + ratio * (endProgress - friendlyEnd)),
        });
        await RuntimeAssetManager.waitForIdle();
        RuntimeAssetManager.commitFriendlyEntities(Game.friendlyUnits, productionIds);
        RuntimeAssetManager.commitEnemyEntities(Game.entities?.values?.() || []);
        RuntimeAssetManager.commitBuildingEntities(Game.entities?.values?.() || []);
        const cacheHit = RuntimeAssetManager.getLoadGeneration() === generationBefore;
        if (cacheHit) this._loadingMinimumDurationMs = Math.min(this._loadingMinimumDurationMs, 350);
        return { cacheHit };
    },

    /** 当前画面是否正处于 scene7；仅用于地牢渲染分支，不再代表全局时间冻结。 */
    isDungeonIsolationActive() {
        return this.currentScene === 'scene7';
    },

    /** 本次地牢是否仍在进行；观察其他世界时 currentScene 会变化，但探险状态继续保留。 */
    isDungeonRunActive() {
        const dungeon = typeof window !== 'undefined' ? window.DungeonMapSystem : null;
        return !!dungeon?.active;
    },

    showDungeonIsolationNotice() {
        this.showTopNotification('地牢出征中仅可观察指挥，玩家本体不能转移', {
            color: '#d8a26a',
        });
    },

    _captureDungeonObservationState() {
        const dungeon = typeof window !== 'undefined' ? window.DungeonMapSystem : null;
        if (!dungeon?.active || this.currentScene !== 'scene7') return false;
        const phaserScene = typeof window !== 'undefined' ? window.__phaserScene : null;
        // GameScene 自身持有的常驻层会在切场后复用并自行同步；这里只暂存匿名场景对象
        // （地牢门闸、宝箱、倒计时、竞技场入口等），避免它们覆盖观察中的世界。
        const persistentSceneObjects = new Set(phaserScene ? Object.values(phaserScene) : []);
        const phaserVisuals = Array.isArray(phaserScene?.children?.list)
            ? phaserScene.children.list
                .filter((object) => !persistentSceneObjects.has(object))
                .map((object) => ({ object, visible: object.visible !== false }))
            : [];
        this._dungeonObservationState = {
            entities: new Map(Game.entities || []),
            effects: Array.isArray(EffectManager.effects) ? EffectManager.effects.slice() : [],
            terrainTexture: Renderer.terrainTexture,
            terrainChunks: Renderer.terrainChunks,
            worldWidth: CONFIG.WORLD_WIDTH,
            worldHeight: CONFIG.WORLD_HEIGHT,
            walls: [...(WallSystem.walls || [])],
            isoSegments: [...(WallSystem.isoSegments || [])],
            isoVisuals: [...(WallSystem.isoVisuals || [])],
            trees: [...(WallSystem.trees || [])],
            wallStyleKey: WallSystem._wallStyleKey,
            camera: {
                x: Camera.x,
                y: Camera.y,
                shakeX: Camera.shakeX,
                shakeY: Camera.shakeY,
                shakeIntensity: Camera.shakeIntensity,
                lockY: Camera.lockY,
                yLockedValue: Camera.yLockedValue,
                aimOffsetX: Camera.aimOffsetX,
                aimOffsetY: Camera.aimOffsetY,
                follow: Camera.follow,
            },
            phaserVisuals,
        };
        dungeon.setWorldObservationSuspended?.(true);
        for (const { object } of phaserVisuals) object?.setVisible?.(false);
        return true;
    },

    _restoreDungeonObservationState() {
        const state = this._dungeonObservationState;
        const dungeon = typeof window !== 'undefined' ? window.DungeonMapSystem : null;
        if (!state || !dungeon?.active) return false;
        Game.entities = new Map(state.entities || []);
        EffectManager.effects = Array.isArray(state.effects) ? state.effects.slice() : [];
        EffectManager.syncCosmeticBudgetCounts?.();
        Renderer.terrainTexture = state.terrainTexture;
        Renderer.terrainChunks = state.terrainChunks;
        CONFIG.WORLD_WIDTH = state.worldWidth;
        CONFIG.WORLD_HEIGHT = state.worldHeight;
        WallSystem.walls = [...state.walls];
        WallSystem.isoSegments = [...state.isoSegments];
        WallSystem.isoVisuals = [...state.isoVisuals];
        WallSystem.trees = [...state.trees];
        WallSystem.setWallStyle(state.wallStyleKey);
        WallSystem.rebuildIsoCollision?.();
        WallSystem._syncWallsToPhaser?.();
        const phaserScene = typeof window !== 'undefined' ? window.__phaserScene : null;
        phaserScene?.syncTerrain?.();
        Object.assign(Camera, state.camera || {});
        for (const { object, visible } of state.phaserVisuals || []) {
            if (object?.active) object.setVisible?.(visible);
        }
        this._dungeonObservationState = null;
        return true;
    },

    /**
     * 地牢出征只允许 PartySystem 正式队友随行。
     * Game.friendlyUnits（仓鼠兵种等）按对象引用暂存，离开期间不更新坐标、不进入地牢渲染。
     */
    parkFriendlyUnitsForDungeon() {
        if (Array.isArray(this._dungeonParkedFriendlyUnits)) return;
        this._dungeonParkedFriendlyUnits = Array.isArray(Game.friendlyUnits)
            ? [...Game.friendlyUnits]
            : [];
        Game.friendlyUnits = [];
    },

    _restoreFriendlyUnitsAfterDungeon() {
        if (!Array.isArray(this._dungeonParkedFriendlyUnits)) return;
        Game.friendlyUnits = [...this._dungeonParkedFriendlyUnits];
        this._dungeonParkedFriendlyUnits = null;
    },

    _resolveLoadingScreen(sceneId, dungeonType) {
        for (const [screenId, screen] of Object.entries(loadingScreenConfig || {})) {
            if (screenId === 'fallback') continue;
            const sceneMatches = Array.isArray(screen?.sceneIds) && screen.sceneIds.includes(sceneId);
            if (!sceneMatches) continue;
            const dungeonTypes = Array.isArray(screen.dungeonTypes) ? screen.dungeonTypes : [];
            if (dungeonType && dungeonTypes.length > 0 && !dungeonTypes.includes(dungeonType)) continue;
            return screen;
        }
        const fallback = loadingScreenConfig?.fallback || {};
        const sceneName = this.scenes?.[sceneId]?.name || '';
        const titleTemplate = String(fallback.titleTemplate || '{sceneName}加载中...');
        return {
            ...fallback,
            title: sceneName
                ? titleTemplate.replace('{sceneName}', sceneName)
                : (fallback.title || '场景加载中...'),
            backgrounds: [],
        };
    },

    showLoadingScreen({ sceneId = null, dungeonType = null } = {}) {
        this.isLoading = true;
        this.loadProgress = 0;
        this._loadingStartedAt = Date.now();
        const screen = this._resolveLoadingScreen(sceneId, dungeonType);
        this._loadingMinimumDurationMs = Math.max(0, Number(screen?.minimumDurationMs) || 0);
        const backgrounds = Array.isArray(screen?.backgrounds) ? screen.backgrounds.filter(Boolean) : [];
        this._loadingBackground = backgrounds.length > 0
            ? backgrounds[Math.floor(Math.random() * backgrounds.length)]
            : null;
        let overlay = getElementIfExists('loadingOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'loadingOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;background-color:#1a1a1a;background-size:cover;background-position:center;background-repeat:no-repeat;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:opacity 0.3s;font-family:SimHei, "Microsoft YaHei", sans-serif;';
            overlay.innerHTML = `
                <div id="loadingTitle" style="color:#f1e6d1;font-size:28px;font-weight:700;margin-bottom:30px;text-shadow:0 2px 8px #000,0 0 18px #000;">场景加载中...</div>
                <div style="width:min(400px,70vw);height:20px;background:rgba(25,25,25,0.88);border-radius:10px;overflow:hidden;border:2px solid #8a7352;box-shadow:0 2px 14px rgba(0,0,0,0.8);">
                    <div id="loadingProgressBar" style="width:0%;height:100%;background:linear-gradient(90deg, #6a8a5a, #8aaa7a);transition:width 0.2s;"></div>
                </div>
                <div id="loadingProgressText" style="color:#ddd1bc;font-size:14px;margin-top:10px;text-shadow:0 1px 5px #000;">0%</div>
            `;
            document.body.appendChild(overlay);
        } else {
            overlay.style.display = 'flex';
            overlay.style.opacity = '1';
        }
        overlay.style.backgroundImage = this._loadingBackground
            ? `linear-gradient(rgba(8,8,8,0.42), rgba(8,8,8,0.58)), url("${this._loadingBackground}")`
            : 'none';
        const title = getElementIfExists('loadingTitle');
        if (title) title.textContent = screen?.title || '场景加载中...';
        this.setProgress(0);
    },

    async waitForMinimumLoadingDuration() {
        const elapsed = Date.now() - this._loadingStartedAt;
        const remaining = this._loadingMinimumDurationMs - elapsed;
        if (remaining > 0) await this.delay(remaining);
    },

    hideLoadingScreen() {
        const overlay = getElementIfExists('loadingOverlay');
        if (overlay) {
            overlay.style.opacity = '0';
            TimerManager.setTimeout(() => { overlay.style.display = 'none'; }, 300);
        }
        this.isLoading = false;
        this._loadingStartedAt = 0;
        this._loadingMinimumDurationMs = 0;
    },

    setProgress(pct) {
        this.loadProgress = Math.min(100, Math.max(0, pct));
        const bar = getElement('loadingProgressBar');
        const text = getElement('loadingProgressText');
        if (bar) bar.style.width = this.loadProgress + '%';
        if (text) text.textContent = Math.floor(this.loadProgress) + '%';
    },

    async switchScene(sceneId, player, mode, opts = {}) {
        if (this.isLoading) return false;
        const questDefinition = opts.questTravel ? QuestRegistry.get(opts.questId) : null;
        const questInstanceEntry = !!questDefinition
            && mode === 'quest'
            && questDefinition.scene === sceneId
            && QuestStore.getActiveQuestId() === questDefinition.id;
        if (opts.questTravel && !questInstanceEntry) {
            this.showTopNotification('任务通行状态无效，无法进入目标世界', { color: '#ff7766' });
            return false;
        }
        if (this.currentScene === sceneId && !opts.forceReload) {
            const alreadyInRequestedQuest = questInstanceEntry
                && this._activeQuestInstance?.questId === questDefinition.id;
            if (!opts.questTravel || alreadyInRequestedQuest) return true;
        }
        if (this._isPersistentWorld(sceneId)
            && !WorldProgressionSystem.isPortalConstructed(sceneId)
            && !questInstanceEntry) {
            this.showTopNotification('该世界位面尚未搭建传送门', { color: '#ff7766' });
            return false;
        }
        const scene = this.scenes[sceneId];
        if (!scene) {
            console.error('Scene not found:', sceneId);
            this.showTopNotification('目标世界不存在，无法切换', { color: '#ff7766' });
            return false;
        }
        const departingSceneId = this.currentScene;
        const departingQuestInstance = this._activeQuestInstance?.sceneId === departingSceneId;
        const suspendingDungeonView = departingSceneId === 'scene7' && !!opts.observer
            && this._captureDungeonObservationState();
        const suspendedDungeonEffects = suspendingDungeonView
            ? new Set(this._dungeonObservationState?.effects || [])
            : null;
        const resumingDungeonView = sceneId === 'scene7' && !!this._dungeonObservationState
            && this.isDungeonRunActive();
        const physicalPortalTravel = opts.portalTravel && !departingQuestInstance && !Game._observerMode
            && !!player && Game.entities?.get?.('player') === player;
        const portalTravel = physicalPortalTravel
            ? TroopLineSystem.preparePortalTravel(departingSceneId, sceneId)
            : null;
        // 位面毁灭强制回城不能保留旧位面实体作为回滚候选；普通切换则必须在任何状态写入前存档。
        if (opts.worldDestructionTx) this._clearRollbackState();
        else this._saveRollbackState(player);
        // 观察模式状态机（2026-08-19）：世界切换面板切世界 = 仅相机跳转，玩家不瞬移——
        // opts.observer=true 进入观察（本体留在 _observerHomeScene）；前往本体所在世界
        // （observer=false）即返回本体。玩家坐标按世界记忆（离场时保存、回场原位恢复）。
        const g = (typeof window !== 'undefined' ? window.Game : null) || Game;
        if (g) {
            if (!g._worldPlayerPos) g._worldPlayerPos = {};
            const departingWorldDestroyed = this._isPersistentWorld(this.currentScene)
                && WorldProgressionSystem.getPortalState(this.currentScene).destroyed;
            if (departingWorldDestroyed) {
                delete g._worldPlayerPos[this.currentScene];
            } else if (!departingQuestInstance
                && player && g.entities && g.entities.get('player') === player && this.currentScene) {
                g._worldPlayerPos[this.currentScene] = { x: player.x, y: player.y };
            }
            if (opts.observer) {
                if (!g._observerMode) g._observerHomeScene = this.currentScene;
                g._observerMode = true;
            } else {
                g._observerMode = false;
                g._observerHomeScene = null;
            }
        }
        let teardownStarted = false;
        let visualLoadGenerationBefore = RuntimeAssetManager.getLoadGeneration();
        try {
            const loadingDungeonType = sceneId === 'scene7'
                ? (opts.dungeonType
                    || (resumingDungeonView ? window.DungeonMapSystem?.dungeonType : null)
                    || scene.dungeonType
                    || null)
                : null;
            this.showLoadingScreen({ sceneId, dungeonType: loadingDungeonType });
            visualLoadGenerationBefore = RuntimeAssetManager.getLoadGeneration();
            this._enterMode = mode || 'explore'; // 'quest' | 'explore'

            this.setProgress(10);
            await this.delay(16);
            this.setProgress(30);

            // 保存当前场景状态
            if (this.currentScene === 'main') {
                this._saveMainSceneState();
            }

            this.setProgress(50);

            // 不隶属当地建筑的跨位面增援由兵线系统独立收纳，避免被场景 teardown 丢失。
            if (!departingQuestInstance && !questInstanceEntry) {
                TroopLineSystem.onSceneLeaving(departingSceneId);
            }

            // 清理当前场景
            teardownStarted = true;
            // 先清理 Phaser 视觉对象，再清空实体数组，避免残留 Sprite/文字
            const phaserScene = window.__phaserScene;
            if (phaserScene) {
                if (phaserScene.clearCombatView) phaserScene.clearCombatView();
                if (phaserScene.clearAllEntitySprites) phaserScene.clearAllEntitySprites();
            }
            // 世界-122 防守地图：离场统一拆除（关面板/停波次；实体由下方 clear 统一清理）
            // 世界-122 快照：离场先捕获再拆除（M0：重进恢复建筑/波次/矿点，不归零）
            if (this._isPersistentWorld(this.currentScene) && DefenseSystem && DefenseSystem.active) {
                window.WorldInvasionSystem?.onWorldLeaving?.(this.currentScene);
                if (WorldProgressionSystem.getPortalState(this.currentScene).destroyed) {
                    if (WorldProgressionSystem.shouldClearWorldScope(this.currentScene, 'snapshot')) {
                        resetWorldSnapshot(this.currentScene);
                    }
                } else {
                    captureAndStoreWorld(this.currentScene);
                }
                DefenseSystem.teardown();
            }
            if (this._isPersistentWorld(this.currentScene)) {
                FogOfWarSystem.deactivateScene(this.currentScene);
            }
            if (this.currentScene === 'scene8' || this.currentScene === 'scene9'
                || this.currentScene === 'scene10' || this.currentScene === 'scene11') clearDecoClearZones();
            // 世界-122 建筑面板随场景离场关闭
            if (BuildingSystem && BuildingSystem.active) {
                BuildingSystem.close();
            }
            // 世界-122 能源资源点随场景离场拆除（实体由下方 Game.entities.clear 统一清理）
            if (EnergyNodeSystem && EnergyNodeSystem.active) {
                EnergyNodeSystem.teardown();
            }
            // 世界-122 仓鼠小屋随场景离场拆除（矿工由小屋一并清理）
            if (HamsterHutSystem && HamsterHutSystem.active) {
                HamsterHutSystem.teardown();
            }
            if (ProducerBuildingSystem && ProducerBuildingSystem.active) {
                ProducerBuildingSystem.teardown();
            }
            BuildingRoadSystem.reset();
            // 世界-122 仓鼠矿工（玩家友方单位）随场景离场拆除
            if (HamsterMinerSystem && HamsterMinerSystem.active) {
                HamsterMinerSystem.teardown();
            }
            if (EffectManager && EffectManager.clearFloatingTexts) {
                EffectManager.clearFloatingTexts();
            }
            Game.entities.clear();
            Game.clearCollisionBuffers?.();
            // 场景切换前销毁在飞投射物的 Phaser 贴图与附加粒子（彗尾/环绕 emitter），
            // 直接丢弃 effects 列表不会走正常失效路径，粒子发射器会永久泄漏
            if (EffectManager && Array.isArray(EffectManager.effects)) {
                for (const fx of EffectManager.effects) {
                    if (suspendedDungeonEffects?.has(fx) && fx?.active) continue;
                    try { EffectManager.destroyEffectVisuals?.(fx); } catch (_e) { /* 忽略清理异常 */ }
                }
            }
            EffectManager.effects = [];
            EffectManager.syncCosmeticBudgetCounts?.();
            EffectManager.clearPools?.();
            // 循环音轨全停（实体被直接 clear 不会走 _destroyCustomEffects，音轨会泄漏）
            if (SoundManager && SoundManager.stopAllLoops) {
                SoundManager.stopAllLoops();
            }
            // 冰墙动态障碍/待生成队列随场景切换清理（墙坐标属于旧场景，禁止跨场景残留）
            if (player && player.iceWallSystem && typeof player.iceWallSystem.breakdown === 'function') {
                player.iceWallSystem.breakdown();
            }
            // 清除战术小队AI
            if (Game._tacticalSquadAI) Game._tacticalSquadAI.clear();
            // 清除裂隙系统
            if (RiftSystem) RiftSystem.clear();

            // 分块惰性地板只属于世界-122：离场统一清空，避免残留块覆盖其他场景
            Renderer.terrainChunks = null;

            // 场景切换立即清理无人机视野与标记；冷却只由成功部署写入，切场景不重复刷新。
            if (player && player.droneSystem && player.droneSystem.active) {
                if (typeof player.droneSystem._deactivate === 'function') {
                    player.droneSystem._deactivate({ immediateMarks: true, silent: true });
                }
            }

            this.setProgress(70);
            await this.delay(0);

            // 加载新场景
            if (sceneId === 'scene7') {
                if (!resumingDungeonView || !this._restoreDungeonObservationState()) {
                    this._loadScene7(player, 'zombie');
                }
            } else if (sceneId === 'scene8') {
                this._loadScene8(player);
            } else if (sceneId === 'scene9') {
                this._loadScene9(player, this._enterMode, questDefinition);
            } else if (sceneId === 'scene10') {
                this._loadScene10(player);
            } else if (sceneId === 'scene11') {
                await this._loadScene11(player);
            } else if (sceneId === 'main') {
                this._loadMainScene(player);
            }

            // 场景逻辑先物化实体，再按真实兵种集合加载精灵表。
            await RuntimeAssetManager.ensureEnemyEntities(Game.entities?.values?.() || [], {
                onProgress: (ratio) => this.setProgress(70 + ratio * 10),
            });
            const activeProductionAssetIds = ProducerBuildingSystem.getActiveVisualUnitIds?.() || [];
            await RuntimeAssetManager.ensureFriendlyUnitIds([
                ...RuntimeAssetManager.getIdsFromEntities(Game.friendlyUnits),
                ...activeProductionAssetIds,
            ], {
                onProgress: (ratio) => this.setProgress(80 + ratio * 8),
            });
            await RuntimeAssetManager.ensureBuildingEntities(Game.entities?.values?.() || [], {
                onProgress: (ratio) => this.setProgress(88 + ratio * 2),
            });

            this.currentScene = sceneId;
            this._activeQuestInstance = questInstanceEntry
                ? { questId: questDefinition.id, sceneId }
                : null;
            this._inMainHub = (sceneId === 'main');
            if (sceneId === 'scene7' && resumingDungeonView) {
                window.DungeonMapSystem?.setWorldObservationSuspended?.(false);
            }
            if (!questInstanceEntry) TroopLineSystem.onSceneEntered(sceneId);
            if (portalTravel) TroopLineSystem.completePortalTravel(portalTravel, sceneId, player);
            await RuntimeAssetManager.ensureEnemyEntities(Game.entities?.values?.() || [], {
                onProgress: (ratio) => this.setProgress(90 + ratio * 3),
            });
            await RuntimeAssetManager.ensureFriendlyEntities(Game.friendlyUnits, {
                onProgress: (ratio) => this.setProgress(93 + ratio * 3),
            });
            await RuntimeAssetManager.ensureBuildingEntities(Game.entities?.values?.() || [], {
                onProgress: (ratio) => this.setProgress(96 + ratio * 2),
            });
            const committedProductionAssetIds = ProducerBuildingSystem.getActiveVisualUnitIds?.() || [];
            RuntimeAssetManager.commitFriendlyEntities(Game.friendlyUnits, committedProductionAssetIds);
            RuntimeAssetManager.commitEnemyEntities(Game.entities?.values?.() || []);
            RuntimeAssetManager.commitBuildingEntities(Game.entities?.values?.() || []);
            const visualCacheHit = RuntimeAssetManager.getLoadGeneration() === visualLoadGenerationBefore;
            if (visualCacheHit) {
                this._loadingMinimumDurationMs = Math.min(this._loadingMinimumDurationMs, 350);
            }
            await this.waitForMinimumLoadingDuration();
            this.setProgress(100);
            await this.delay(visualCacheHit ? 60 : 160);
            // 实体传送门落地后，必须先走出目标场景的门区才能再次触发传送。
            // 主神空间会恢复离城坐标，该坐标常与原入口重合，单靠秒数冷却会自动弹回原世界。
            if (physicalPortalTravel) Game._portalArrivalLock = true;
            if (sceneId === 'main') this._finishWorldDestructionTransactions(opts.worldDestructionTx);
            // 目标场景已经提交：在揭开加载层前同步新 zoom、世界尺寸并绕过小地图节流重画，
            // 避免回城后短暂显示离场位面的缩放/坐标内容。
            window.__phaserScene?.refreshMinimapForSceneTransition?.();
            this.hideLoadingScreen();
            // 显示场景名称
            this._showSceneLabel(scene.name);
            // BGM 场景切换（data/audio-config.json bgm 映射；无配置场景自动停止）
            if (SoundManager && typeof SoundManager.playBgmForScene === 'function') {
                SoundManager.playBgmForScene(sceneId);
            }
            if (!opts.worldDestructionTx) this._clearRollbackState();
            return true;
        } catch (err) {
            console.error('[switchScene] ERROR:', err);
            if (opts.worldDestructionTx) this._handleWorldDestructionSwitchFailure(opts.worldDestructionTx);
            else {
                await this._rollback(player, sceneId, teardownStarted);
                if (portalTravel) TroopLineSystem.rollbackPortalTravel(portalTravel);
                if (!departingQuestInstance && !questInstanceEntry) {
                    TroopLineSystem.onSceneEntered(departingSceneId);
                }
                if (suspendingDungeonView) {
                    this._restoreDungeonObservationState();
                    window.DungeonMapSystem?.setWorldObservationSuspended?.(false);
                }
            }
            throw err;
        }
    },

    _clearRollbackState() {
        this._rollbackEntities = null;
        this._rollbackFriendlyUnits = null;
        this._rollbackRiftState = null;
        this._rollbackWorldState = null;
        this._rollbackCamera = null;
        this._rollbackCurrentScene = null;
        this._rollbackPlayerPos = null;
        this._rollbackObserverMode = null;
        this._rollbackObserverHomeScene = null;
        this._rollbackWorldPlayerPos = null;
        this._rollbackActiveQuestInstance = null;
        this._rollbackEnterMode = null;
    },

    _handleWorldDestructionSwitchFailure(tx) {
        this.isLoading = false;
        this.hideLoadingScreen();
        // 强制回城失败也不能把已毁位面从通用 rollback 缓存复活。
        const phaserScene = typeof window !== 'undefined' ? window.__phaserScene : null;
        phaserScene?.clearCombatView?.();
        phaserScene?.clearAllEntitySprites?.();
        BuildingSystem?.close?.();
        DefenseSystem?.teardown?.();
        EnergyNodeSystem?.teardown?.();
        HamsterMinerSystem?.teardown?.();
        HamsterHutSystem?.teardown?.();
        ProducerBuildingSystem?.teardown?.();
        BuildingRoadSystem?.reset?.();
        WallSystem?.init?.(0, 0);
        EffectManager?.clearFloatingTexts?.();
        Game.entities?.clear?.();
        Game.clearCollisionBuffers?.();
        if (EffectManager && Array.isArray(EffectManager.effects)) {
            for (const fx of EffectManager.effects) {
                try { EffectManager.destroyEffectVisuals?.(fx); } catch (_e) { /* 强制清场继续 */ }
            }
            EffectManager.effects = [];
            EffectManager.syncCosmeticBudgetCounts?.();
            EffectManager.clearPools?.();
        }
        SoundManager?.stopAllLoops?.();
        this.currentScene = null;
        this._inMainHub = false;
        this._clearRollbackState();
        const stored = this._worldDestructionTransactions.get(tx?.sceneId);
        if (stored && stored.transactionId === tx.transactionId) stored.lastFailureAt = Date.now();
    },

    _saveRollbackState(player) {
        this._rollbackEntities = Game.entities ? new Map(Game.entities) : null;
        this._rollbackFriendlyUnits = Array.isArray(Game.friendlyUnits)
            ? Game.friendlyUnits.slice()
            : null;
        this._rollbackRiftState = RiftSystem?.captureState?.() || null;
        this._rollbackWorldState = {
            width: CONFIG.WORLD_WIDTH,
            height: CONFIG.WORLD_HEIGHT,
            terrainTexture: Renderer.terrainTexture,
            terrainChunks: Renderer.terrainChunks,
            walls: [...(WallSystem.walls || [])],
            isoSegments: [...(WallSystem.isoSegments || [])],
            isoVisuals: [...(WallSystem.isoVisuals || [])],
            trees: [...(WallSystem.trees || [])],
            wallStyleKey: WallSystem._wallStyleKey,
        };
        this._rollbackCamera = {
            x: Camera.x,
            y: Camera.y,
            shakeX: Camera.shakeX,
            shakeY: Camera.shakeY,
            shakeIntensity: Camera.shakeIntensity,
            lockY: Camera.lockY,
            yLockedValue: Camera.yLockedValue,
            aimOffsetX: Camera.aimOffsetX,
            aimOffsetY: Camera.aimOffsetY,
            follow: Camera.follow,
        };
        this._rollbackCurrentScene = this.currentScene;
        this._rollbackPlayerPos = player ? { x: player.x, y: player.y } : null;
        this._rollbackObserverMode = !!Game._observerMode;
        this._rollbackObserverHomeScene = Game._observerHomeScene || null;
        this._rollbackWorldPlayerPos = { ...(Game._worldPlayerPos || {}) };
        this._rollbackActiveQuestInstance = this._activeQuestInstance
            ? { ...this._activeQuestInstance }
            : null;
        this._rollbackEnterMode = this._enterMode;
    },

    _clearFailedSceneRuntime(failedSceneId) {
        const phaserScene = typeof window !== 'undefined' ? window.__phaserScene : null;
        phaserScene?.clearCombatView?.();
        phaserScene?.clearAllEntitySprites?.();
        BuildingSystem?.close?.();
        DefenseSystem?.teardown?.();
        EnergyNodeSystem?.teardown?.();
        HamsterMinerSystem?.teardown?.();
        HamsterHutSystem?.teardown?.();
        ProducerBuildingSystem?.teardown?.();
        BuildingRoadSystem?.reset?.();
        if (this._isPersistentWorld(failedSceneId)) FogOfWarSystem.deactivateScene(failedSceneId);
        clearDecoClearZones();
        RiftSystem?.clear?.();
        Game.entities?.clear?.();
        Game.clearCollisionBuffers?.();
        if (EffectManager && Array.isArray(EffectManager.effects)) {
            for (const fx of EffectManager.effects) {
                try { EffectManager.destroyEffectVisuals?.(fx); } catch (_e) { /* 回滚清场继续 */ }
            }
            EffectManager.effects = [];
            EffectManager.syncCosmeticBudgetCounts?.();
            EffectManager.clearPools?.();
        }
        Renderer.terrainChunks = null;
    },

    _restoreRollbackReferences(player) {
        if (this._rollbackEntities) {
            Game.entities = new Map(this._rollbackEntities);
            if (!this._rollbackObserverMode && player && !Game.entities.has('player')) {
                Game.entities.set('player', player);
            }
        }
        if (this._rollbackFriendlyUnits) Game.friendlyUnits = this._rollbackFriendlyUnits.slice();
        const world = this._rollbackWorldState;
        if (world) {
            CONFIG.WORLD_WIDTH = world.width;
            CONFIG.WORLD_HEIGHT = world.height;
            Renderer.terrainTexture = world.terrainTexture;
            Renderer.terrainChunks = world.terrainChunks;
            WallSystem.init(world.width, world.height);
            WallSystem.walls = world.walls.slice();
            WallSystem.isoSegments = world.isoSegments.slice();
            WallSystem.isoVisuals = world.isoVisuals.slice();
            WallSystem.trees = world.trees.slice();
            WallSystem._wallStyleKey = world.wallStyleKey;
            WallSystem.rebuildIsoCollision?.();
            WallSystem._syncWallsToPhaser?.();
            WallSystem._syncTreesToPhaser?.();
            window.__phaserScene?.syncTerrain?.();
        }
        RiftSystem?.restoreState?.(this._rollbackRiftState);
    },

    async _reloadRollbackPersistentWorld(player, sceneId) {
        if (sceneId === 'scene8') this._loadScene8(player);
        else if (sceneId === 'scene9') this._loadScene9(player, 'explore');
        else if (sceneId === 'scene10') this._loadScene10(player);
        else if (sceneId === 'scene11') await this._loadScene11(player);
    },

    async _rollback(player, failedSceneId = null, teardownStarted = true) {
        this.isLoading = false;
        this.hideLoadingScreen();
        const rollbackSceneId = this._rollbackCurrentScene;
        const rollbackObserverMode = !!this._rollbackObserverMode;
        Game._observerMode = rollbackObserverMode;
        Game._observerHomeScene = this._rollbackObserverHomeScene || null;
        Game._worldPlayerPos = { ...(this._rollbackWorldPlayerPos || {}) };
        this.currentScene = rollbackSceneId;
        this._activeQuestInstance = this._rollbackActiveQuestInstance
            ? { ...this._rollbackActiveQuestInstance }
            : null;
        this._enterMode = this._rollbackEnterMode;
        this._inMainHub = (rollbackSceneId === 'main');

        if (teardownStarted) {
            try {
                this._clearFailedSceneRuntime(failedSceneId);
                if (this._isPersistentWorld(rollbackSceneId) && !this._activeQuestInstance) {
                    await this._reloadRollbackPersistentWorld(player, rollbackSceneId);
                } else {
                    this._restoreRollbackReferences(player);
                }
            } catch (recoveryError) {
                console.error('[switchScene] rollback recovery failed:', recoveryError);
                this._restoreRollbackReferences(player);
            }
        }

        if (this._rollbackCamera) {
            Camera.x = this._rollbackCamera.x;
            Camera.y = this._rollbackCamera.y;
            Camera.shakeX = this._rollbackCamera.shakeX;
            Camera.shakeY = this._rollbackCamera.shakeY;
            Camera.shakeIntensity = this._rollbackCamera.shakeIntensity;
            Camera.lockY = this._rollbackCamera.lockY;
            Camera.yLockedValue = this._rollbackCamera.yLockedValue;
            Camera.aimOffsetX = this._rollbackCamera.aimOffsetX;
            Camera.aimOffsetY = this._rollbackCamera.aimOffsetY;
            Camera.follow = this._rollbackCamera.follow;
        }
        if (player && this._rollbackPlayerPos) {
            player.x = this._rollbackPlayerPos.x;
            player.y = this._rollbackPlayerPos.y;
        }
        window.__phaserScene?.refreshMinimapForSceneTransition?.();
        SoundManager?.playBgmForScene?.(rollbackSceneId);
        this._clearRollbackState();
    },

    _showSceneLabel(name) {
        this.showTopNotification(name);
    },

    /**
     * 在屏幕顶部中央显示一条与场景切换提示同风格的临时通知
     * @param {string} text - 通知文本
     * @param {Object} [options] - 可选配置
     * @param {string} [options.color='#d4c5a9'] - 文字颜色
     * @param {string} [options.fontSize='48px'] - 字体大小
     * @param {number} [options.duration=3000] - 显示时长（ms）
     */
    showTopNotification(text, options = {}) {
        if (typeof document === 'undefined' || !document.body) return;
        const color = options.color || '#d4c5a9';
        const fontSize = options.fontSize || '48px';
        const duration = options.duration || 3000;
        const label = document.createElement('div');
        label.style.cssText = `position:fixed;top:210px;left:50%;transform:translateX(-50%);color:${color};font-size:${fontSize};font-weight:700;text-shadow:0 2px 8px rgba(0,0,0,0.8);z-index:5000;pointer-events:none;animation:sceneLabelFade ${duration / 1000}s ease-out forwards;font-family:SimHei,"Microsoft YaHei","黑体",sans-serif;`;
        label.textContent = text;
        document.body.appendChild(label);
        TimerManager.setTimeout(() => { if (label && label.parentNode) label.remove(); }, duration);
    },

    _saveMainSceneState() {
        // 只保存主城实体；能源矿点等世界-122 专属实体绝不进入主城快照
        // （2026-08-16：防止旧污染/错误时机把矿点带回主城，出现“家门口一堆矿”）
        this._mainEntities = new Map();
        for (const [k, e] of Game.entities) {
            if (e && e._isEnergyNode) continue;
            if (e && e._troopLineDetached) continue;
            // 主城传送门由进度状态实时重建，不能把随后 teardown 的同一对象引用存进主城快照。
            if (e && e._isMainHubPortalBuilding) continue;
            this._mainEntities.set(k, e);
        }
        // 以实体是否真实在场判定本体：正常从主城进入观察模式时 observer 标志已提前写入，
        // 但仍须保存离场坐标；观察主城时实体表没有 player，自然不会被异世界本体覆盖。
        if (Game.player && Game.entities.get('player') === Game.player) {
            this._mainPlayerPos = { x: Game.player.x, y: Game.player.y };
        }
        // 注：树木/特效/相机不保存——树木按设计不恢复（主神空间障碍物已清除）；
        // 特效由各系统重建、相机在 _loadMainScene 重新 follow 玩家，保存是误导性死状态（2026-07-30 清理）
    },

    _resolveWorldSize(scene) {
        const fallbackWidth = scene.width || CONFIG.WORLD_WIDTH;
        const fallbackHeight = scene.height || CONFIG.WORLD_HEIGHT;
        if (!GAME_CONFIG.world) {
            return { width: fallbackWidth, height: fallbackHeight };
        }
        const cfg = scene.type === 'main' ? GAME_CONFIG.world.main : GAME_CONFIG.world.default;
        return {
            width: cfg?.width || fallbackWidth,
            height: cfg?.height || fallbackHeight
        };
    },

    /** 主神空间地形统一入口：砖地烘焙 + 边界墙（Game.init 首启与 _loadMainScene 回城共用，禁止两套路径） */
    _setupMainHubTerrain() {
        const hubCfg = (GAME_CONFIG.scenes && GAME_CONFIG.scenes.mainHub) || {};
        setDungeonFloorProfile(hubCfg.floor || null);
        // 菱形地块（2026-08-21 对齐世界-122 口径）：分块惰性地板按菱形裁剪烘焙，区外全黑
        const diamond = this._scene8Diamond(this.scenes.main);
        applyDungeonFloorChunked(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT, 2048, diamond);
        // 场地边界墙（厚度走 mainHub.wallThickness 配置）：同世界-122 改隐形兜底，不再硬拉伸视觉
        const wt = hubCfg.wallThickness ?? 20;
        const w = CONFIG.WORLD_WIDTH;
        const h = CONFIG.WORLD_HEIGHT;
        WallSystem.walls = [
            { x: 0, y: 0, w, h: wt, height: 60, noVisual: true },
            { x: 0, y: h - wt, w, h: wt, height: 60, noVisual: true },
            { x: 0, y: 0, w: wt, h, height: 60, noVisual: true },
            { x: w - wt, y: 0, w: wt, h, height: 60, noVisual: true },
        ];
        // 菱形四边注册不可见 _boundary 阻挡段（区外黑地不可通行，与世界-122 同一真源）
        this._registerScene8Boundary(diamond);

        // 测试房间：已移除代码默认菱形房间——用户用墙壁编辑器（HUD 摆墙）自行摆放
        // 仅当预制库存在 hub_diamond 时按预制渲染；否则无房间（isoVisuals 为空）
        // 碰撞由 rebuildIsoCollision() 按件底边自动生成阶梯矩形
        const buildHubIso = () => {
            const wallPrefabs = getWallPrefabLibrary();
            const hubPrefab = wallPrefabs['hub_diamond'];
            WallSystem.isoVisuals = [];
            if (hubPrefab && Array.isArray(hubPrefab.pieces)) {
                WallSystem.isoVisuals = hubPrefab.pieces.map(p => ({ ...p }));
            }
            if (getObstacleLayout().length > 0) {
                for (const o of getObstacleLayout()) {
                    WallSystem.isoVisuals.push({ ...o, family: 'obstacle' });
                }
            }
            if (isWallGeoOverridesLoaded()) {
                WallSystem.applyGeoOverrides(getWallGeoOverrides());
            }
            WallSystem.rebuildIsoCollision();
            if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();
        };

        // 首启时预制库/布局/覆盖层可能未加载完：到位后统一重建一次（仅主神空间）
        if (!isWallPrefabsLoaded()) {
            loadWallPrefabs().then(() => {
                if (this.currentScene !== 'main' || this.isLoading) return;
                buildHubIso();
            });
        }
        if (getObstacleLayout().length === 0) {
            loadObstacleLayout().then(() => {
                if (this.currentScene !== 'main' || this.isLoading) return;
                buildHubIso();
            });
        }
        if (!isWallGeoOverridesLoaded()) {
            WallSystem.loadGeoOverrides().then(() => {
                if (this.currentScene !== 'main' || this.isLoading) return;
                buildHubIso();
            });
        }
        buildHubIso();

        // 静态 NPC 底座障碍（如仓库宝箱）：宽=贴图底座、深=底座厚度，锚定脚底线；
        // noVisual 标记跳过墙面视觉（贴图 NPC 自身就是视觉）。与边界墙同入口重建，场景往返不丢
        if (typeof Game !== 'undefined' && Game.entities) {
            for (const e of Game.entities.values()) {
                const ob = e && e.obstacleCfg;
                if (!ob) continue;
                WallSystem.walls.push({
                    x: e.x - (ob.width ?? 0) / 2,
                    y: e.y + (ob.offsetY ?? 0) - (ob.height ?? 0),
                    w: ob.width ?? 0,
                    h: ob.height ?? 0,
                    height: ob.wallHeight ?? 60,
                    noVisual: true,
                });
            }
        }
        if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();
        // 恢复主神空间地形，避免残留地牢贴图
        if (window.__phaserScene) {
            window.__phaserScene.syncTerrain();
        }
    },

    _loadMainScene(player) {
        const mainSize = this._resolveWorldSize(this.scenes.main);
        CONFIG.WORLD_WIDTH = mainSize.width;
        CONFIG.WORLD_HEIGHT = mainSize.height;
        const observing = !!Game._observerMode;

        if (this._mainEntities) {
            // 主神空间使用固定大小，不随分辨率变化
            Renderer.generateWorld('main');
            // 当前运行态与驻留快照必须分离，观察主城时删除玩家不能污染下次真实回城。
            Game.entities = new Map(this._mainEntities);
            // 防御：主城快照若含矿点（旧版本污染），恢复时剔除——
            // 能源矿点只能由世界-122 的 EnergyNodeSystem.setup 生成
            for (const [k, e] of Array.from(Game.entities.entries())) {
                if (e && e._isEnergyNode) Game.entities.delete(k);
            }
            // 主神空间障碍物已全部移除（贴图删除后碰撞体积同步清除，不再恢复旧树木）
            if (WallSystem.trees && WallSystem.trees.length > 0) {
                WallSystem.trees = [];
                if (WallSystem._syncTreesToPhaser) WallSystem._syncTreesToPhaser();
            }
        } else {
            // 兜底：如果主场景状态未保存（比如测试场景直接进入），重新生成主场景基础环境
            Renderer.generateWorld('main');
            // 正常回城才生成玩家；观察主城时本体仍留在原世界。
            if (player && !observing) {
                Game.entities.set('player', player);
            }
        }

        // 地板与边界墙：统一入口（与 Game.init 首启同一路径）
        this._setupMainHubTerrain();

        if (player && !observing) {
            Game.entities.set('player', player);
            // 优先使用死亡重生位置，其次使用之前保存的主神空间位置
            if (this._respawnPos) {
                player.x = this._respawnPos.x;
                player.y = this._respawnPos.y;
                this._respawnPos = null; // 使用后清除
            } else if (this._mainPlayerPos) {
                player.x = this._mainPlayerPos.x;
                player.y = this._mainPlayerPos.y;
            }
            // 菱形落点守卫（2026-08-21 主神空间菱形化）：旧档/旧缓存坐标可能落在新菱形外，回退主城原点
            const hubDiamond = this._scene8Diamond(this.scenes.main);
            if (hubDiamond) {
                const ratio = Math.abs(player.x - hubDiamond.cx) / hubDiamond.rx
                    + Math.abs(player.y - hubDiamond.cy) / hubDiamond.ry;
                if (ratio > 0.95) {
                    const o = (this.scenes.main && this.scenes.main.origin) || { x: hubDiamond.cx, y: hubDiamond.cy };
                    player.x = o.x;
                    player.y = o.y;
                }
            }
            Camera.follow(player);
            QuickBar.refreshSpecialAttack(player);
        } else if (observing) {
            Game.entities.delete('player');
            const anchor = this._mainPlayerPos || this.scenes.main?.origin
                || { x: CONFIG.WORLD_WIDTH / 2, y: CONFIG.WORLD_HEIGHT / 2 };
            Camera.x = anchor.x;
            Camera.y = anchor.y;
        }

        // 地牢期间暂存的仓鼠兵种回到原友军注册表；实体对象来自主神空间快照，坐标保持离场值。
        this._restoreFriendlyUnitsAfterDungeon();

        // 确保关键实体（靶子）存在，如果不存在则重新生成
        if (Game && Game.spawnTargets && Game.spawnEnemy) {
            let hasTargets = false, hasDpsTarget = false;
            Game.entities.forEach(e => {
                if (e instanceof TargetDummy && e.name && e.name.startsWith('训练靶')) hasTargets = true;
                if (e instanceof TargetDummy && e.name === 'DPS测试靶') hasDpsTarget = true;
            });
            if (!hasTargets) Game.spawnTargets();
            if (!hasDpsTarget) Game.spawnEnemy();
        }

        // 主神空间测试怪：与开局 init 同一生成入口（骑士+手脑），不再生成旧测试怪（胖子僵尸/僵尸/集合体）
        if (Game && Game.spawnMainHubTestEntities) {
            Game.spawnMainHubTestEntities();
        }
        // 构造或摧毁世界传送门后，回城立即按进度状态重建主神空间入口。
        Game.syncMainHubWorldPortals?.();
    },

    delay(ms) {
        return new Promise(resolve => TimerManager.setTimeout(resolve, ms));
    },

    /** 世界-122（场景八）：12288×8192 全图泥地无缝纹理 + 菱形地块 + 可移动边界 */
    _loadScene8(player) {
        clearDecoClearZones();
        // 重置相机状态，避免从其他场景带入偏移
        Camera.aimOffsetX = 0;
        Camera.aimOffsetY = 0;
        Camera.shakeX = 0;
        Camera.shakeY = 0;
        Camera.shakeIntensity = 0;
        Camera.lockY = false;
        Camera.yLockedValue = 0;

        const scene = this.scenes.scene8;
        // 直接用 scene8 自身尺寸（12288×8192，2026-08-16 翻倍），不走 _resolveWorldSize 覆盖
        const w = scene.width;
        const h = scene.height;
        CONFIG.WORLD_WIDTH = w;
        CONFIG.WORLD_HEIGHT = h;

        // 菱形地块（2026-08-16 v2）：区外全黑，菱形内继续泥地无缝纹理铺贴；
        // 边斜率 0.5（26.57°），与掩体墙/基地房/建筑视角平行（见 _scene8Diamond）
        const diamond = this._scene8Diamond(scene);
        const floorSeed = WorldProgressionSystem.getWorldGenerationSeed('scene8', 'floor_deco');
        // 沙漠地貌v3：全域连续沙材质负责无缝底色；道路同源的128×64格网只叠加透明碎石，
        // 旧风纹/裂缝/冲蚀线已从图集删除，世界坐标小件层只散布18种模型化地表杂物。
        // 三层都由稳定格坐标和位面世代seed派生，不创建碰撞、占格、寻路或快照实体。
        const desertBase = desertTerrainConfig.base || {};
        setDungeonFloorProfile({
            tiles: [desertBase.key || 'floor_sand_seamless'],
            continuous: true,
            glow: false,
            backgroundColor: desertBase.backgroundColor || '#160f0a',
            textureScaleY: desertBase.textureScaleY ?? 0.5774,
            cellDetails: { ...(desertTerrainConfig.detailLayer || {}) },
            deco: {
                ...(desertTerrainConfig.deco || {}),
                seed: floorSeed,
            },
        });
        // 分块惰性地板（2048² 按相机视口烘焙/卸载）：大地图不一次性占满显存；
        // 传 diamond 后每块按菱形裁剪烘焙（区外全黑）
        applyDungeonFloorChunked(w, h, 2048, diamond);

        // 边界：不再画围墙（2026-08-14 用户要求）——保留隐形物理体阻挡走出地图，
        // 边界自然显示为地板分块的黑色渐变边缘（bakeDungeonFloorChunk 只在贴边块画渐变）
        WallSystem.init(w, h);
        WallSystem.walls = [
            { x: 0, y: 0, w, h: 20, noVisual: true },
            { x: 0, y: h - 20, w, h: 20, noVisual: true },
            { x: 0, y: 0, w: 20, h, noVisual: true },
            { x: w - 20, y: 0, w: 20, h, noVisual: true },
        ];
        // 可移动边界（2026-08-16）：菱形地块四边注册不可见阻挡段——区外黑地不可通行，
        // 玩家/怪物/寻路/建筑放置/能源矿全部受 WallSystem.canMoveTo 约束（_boundary 段
        // 在 rebuildIsoCollision 中保留，见 wall-system.js）。
        this._registerScene8Boundary(diamond);
        if (WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }

        // 基地菱形房由 DefenseSystem.setup → _buildBaseRoom() 构建：
        // 四边新掩体墙（h="\"/v="/"），face 线 40px 端帽叠合拼接，
        // 转角端帽互相叠盖；RB 边中点留居中门洞（配置见 DEFENSE_CONFIG.room）

        // 玩家出生在基地房内（2026-08-16：随基地右移，取 (base.x+228, base.y)，
        // 房间内合法点、不贴墙/不占 RB 边门洞，与旧 (760,2048) 同相对位置）
        // 观察模式（2026-08-19）：观察世界不生成玩家（本体留在原世界），相机落基地中心自由平移；
        // 正常进入时按世界坐标记忆原位恢复（无记忆用默认出生点）
        if (player && !Game._observerMode) {
            const savedPos = Game._worldPlayerPos && Game._worldPlayerPos.scene8;
            player.x = (savedPos && Number.isFinite(savedPos.x)) ? savedPos.x : DEFENSE_CONFIG.base.x + 228;
            player.y = (savedPos && Number.isFinite(savedPos.y)) ? savedPos.y : DEFENSE_CONFIG.base.y;
            Game.entities.set('player', player);
            Camera.follow(player);
        } else if (Game._observerMode) {
            Camera.x = DEFENSE_CONFIG.base.x;
            Camera.y = DEFENSE_CONFIG.base.y;
        }

        if (player) {
            QuickBar.refreshSpecialAttack(player);
        }

        // 仙人掌随机散布（2026-08-16，替代已删除的树木散布）：必须在 DefenseSystem.setup
        // 之前——rebuildIsoCollision 只保留门闸 isoSegments，掩体墙段在 setup 时才注册（两不相扰）；
        // 基地房矩形/玩家出生点/能源点/刷怪点按排除带规避。配置：scenes.scene8.cactusScatter
        this._scatterCactiScene8(player, WorldProgressionSystem.createWorldRandom('scene8', 'obstacles'));

        this._setupPersistentWorld('scene8', player, diamond);

    },

    /** 世界-122 回场战报（M1 后台结算结果浮字，2026-08-18） */
    _announceWorld122Report(player, result) {
        if (!result || !result.report || !player) return;
        const r = result.report;
        const lines = [];
        if (result.defeated) {
            lines.push(['世界-122 在你离开期间失守了！基地重建，防守重新开局', '#ff5555']);
        } else {
            if (r.wavesCleared.length > 0) lines.push([`离线战报：击退第 ${r.wavesCleared.join('、')} 波`, '#8ad0ff']);
            if (r.victory) lines.push(['防守胜利！奖励已发放', '#ffd700']);
            if (r.energyMined > 0) lines.push([`矿工离线采集 +${Math.round(r.energyMined)} 能源`, '#7fd4ff']);
            if (r.deepDrillEnergyMined > 0) {
                lines.push([`深钻井离线采掘 +${Math.round(r.deepDrillEnergyMined)} 能源`, '#72d8d0']);
            }
            if (r.resonatorEnergyProduced > 0) {
                lines.push([`位面谐振塔发电 +${r.resonatorEnergyProduced} 能源`, '#a892ff']);
            }
            if (r.steamEnergyProduced > 0) {
                lines.push([`蒸汽电站发电 +${r.steamEnergyProduced} 能源`, '#e6a45f']);
            }
            if (r.passiveEnergy > 0) lines.push([`能源回收矩阵 +${r.passiveEnergy} 能源`, '#7fd4ff']);
            if (r.titheEnergy > 0) lines.push([`牧师什一税 +${r.titheEnergy} 能源`, '#c9a0ff']);
            if (r.goldProduced > 0) lines.push([`经济建筑金币结算 +${r.goldProduced} 金币`, '#ffd700']);
            if (r.foodProduced > 0) lines.push([`风车农夫收获 +${r.foodProduced} 粮食`, '#d9b84f']);
            if (r.unitsProduced > 0) lines.push([`新兵报到 +${r.unitsProduced}`, '#8ad0ff']);
            if (r.abilitiesCompleted.length > 0) lines.push([`研究/能力完成 ${r.abilitiesCompleted.length} 项`, '#c9a0ff']);
            if (r.modulesCompleted?.length > 0) lines.push([`兵种升级完成 ${r.modulesCompleted.length} 项`, '#8ad0ff']);
            if (r.structuresLost > 0) lines.push([`离线战斗损失建筑 ${r.structuresLost} 座`, '#ff8855']);
            if (r.baseDamage > 0) lines.push([`基地离线受损 -${Math.round(r.baseDamage)} 耐久`, '#ff8855']);
        }
        lines.forEach(([text, color], i) => {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 70 - i * 24, text, color));
        });
    },

    /**
     * 世界-122 菱形地块口径（2026-08-16 v2，_loadScene8 与 _scatterCactiScene8 共用）：
     * - 边斜率 ry/rx = 0.5（26.57°）——与掩体墙 face 步长 (176,±87)、基地菱形房
     *   (rx=512, ry=256) 同一视角，四边与玩家墙体/掩体/建筑平行；
     *   v1 内接全图（rx=w/2, ry=h/2，斜率 0.667）边界与墙体视角不平行，观感别扭。
     * - 默认 rx=w/2（右顶点仍抵地图右缘，刷怪/进攻动线不变），ry=rx*0.5；
     *   可在 game-config.json scenes.scene8.diamondFloor 覆盖 cx/cy/rx/ry。
     */
    _scene8Diamond(scene) {
        const cfg = (scene && scene.diamondFloor) || {};
        if (cfg.enabled === false) return null;
        const rx = cfg.rx ?? scene.width / 2;
        return {
            cx: cfg.cx ?? scene.width / 2,
            cy: cfg.cy ?? scene.height / 2,
            rx,
            ry: cfg.ry ?? rx * 0.5,
        };
    },

    /**
     * 世界-122 仙人掌随机散布（2026-08-16，替代 2026-08-15 树木散布，树木已全删）：
     * 加载时把 4 姿态仙人掌（同风格低对比）撒满全图，走 isoVisuals + rebuildIsoCollision
     * （footprint 碰撞生效）+ _syncWallsToPhaser 渲染；
     * - 缩放 = obstacleH/geo.h（摆墙编辑器口径）× (1±scaleJitter)，随机 flipX；
     * - 排除带：基地房矩形外扩 / 玩家 / 刷怪点；能源矿后生成并用真实墙体碰撞避开仙人掌；
     * - 调用顺序约束：必须在 DefenseSystem.setup 之前（见 _loadScene8 注释）。
     * 配置：data/game-config.json scenes.scene8.cactusScatter（enabled=false 关闭）。
     */
    _scatterCactiScene8(player, random = Math.random) {
        const scene = this.scenes.scene8;
        const cfg = (scene && scene.cactusScatter) || {};
        if (cfg.enabled === false) return;
        const count = cfg.count ?? 40; // 2026-08-17：默认减半（配置可覆盖，见 game-config.json cactusScatter）
        const minDist = cfg.minDist ?? 150;
        const jitter = cfg.scaleJitter ?? 0.1;
        const b = cfg.bounds || {};
        const x0 = b.x0 ?? 150;
        const y0 = b.y0 ?? 250;
        const x1 = b.x1 ?? ((scene && scene.width) ? scene.width - 150 : 5994);
        const y1 = b.y1 ?? ((scene && scene.height) ? scene.height - 196 : 3900);
        const ex = cfg.exclude || {};
        // 基地房排除矩形（2026-08-16 从 DEFENSE_CONFIG 派生，随基地位置自动跟随）
        const room = ex.baseRoom || [
            DEFENSE_CONFIG.base.x - DEFENSE_CONFIG.room.rx,
            DEFENSE_CONFIG.base.y - DEFENSE_CONFIG.room.ry,
            DEFENSE_CONFIG.base.x + DEFENSE_CONFIG.room.rx,
            DEFENSE_CONFIG.base.y + DEFENSE_CONFIG.room.ry,
        ];
        const rPlayer = ex.player ?? 160;
        const rSpawn = ex.spawnPoint ?? 180;
        const variants = ['saguaro2arm', 'saguaro1arm', 'barrel', 'cholla'];
        // 菱形地块（与 _loadScene8 同口径，_scene8Diamond v2 边斜率 0.5 与视角平行）：
        // 仙人掌只撒在菱形内，避免长在区外黑地里
        const dFloor = this._scene8Diamond(scene);
        const inDiamond = (x, y) => !dFloor || (Math.abs(x - dFloor.cx) / dFloor.rx + Math.abs(y - dFloor.cy) / dFloor.ry <= 1);
        const spawnPts = DEFENSE_CONFIG.spawnPoints || [];
        const pieces = [];
        let guard = 0;
        while (pieces.length < count && guard++ < count * 30) {
            const x = x0 + random() * (x1 - x0);
            const y = y0 + random() * (y1 - y0);
            if (!inDiamond(x, y)) continue;
            const tex = 'obstacle_cactus_' + variants[(random() * variants.length) | 0];
            const geo = (typeof WallSystem._geoForTex === 'function') ? WallSystem._geoForTex(tex) : null;
            if (!geo) continue;
            const s = ((geo.obstacleH ?? 200) / geo.h) * (1 - jitter + random() * jitter * 2);
            // [FIX] 排除带与碰撞同一口径：真实碰撞 footprint 中心在贴图锚点下方，
            // 所有排除带/合法性检查改用 footprint 矩形/中心判定（原按锚点判定会整体错位）
            const fp = (typeof WallSystem.getObstacleFootprintRect === 'function')
                ? WallSystem.getObstacleFootprintRect({ tex, x, y, scaleX: s, scaleY: s })
                : null;
            const fx = fp ? fp.x + fp.w / 2 : x;
            const fy = fp ? fp.y + fp.h / 2 : y;
            if (fp) {
                if (fp.x < room[2] && fp.x + fp.w > room[0] && fp.y < room[3] && fp.y + fp.h > room[1]) continue;
            } else if (x > room[0] && x < room[2] && y > room[1] && y < room[3]) continue;
            if (player && Math.hypot(fx - player.x, fy - player.y) < rPlayer) continue;
            if (spawnPts.some((n) => Math.hypot(fx - n.x, fy - n.y) < rSpawn)) continue;
            if (pieces.some((q) => Math.hypot(x - q.x, y - q.y) < minDist)) continue;
            const fr = Math.max(20, (geo.foot ? geo.foot.w / 2 : 40) * s);
            if (typeof WallSystem.canMoveTo === 'function' && !WallSystem.canMoveTo(fx, fy, fr)) continue;
            pieces.push({ tex, x, y, scaleX: s, scaleY: s, flipX: random() < 0.5, _scatter: true });
        }
        for (const p of pieces) WallSystem.isoVisuals.push(p);
        if (pieces.length && typeof WallSystem.rebuildIsoCollision === 'function') {
            WallSystem.rebuildIsoCollision();
        }
        if (typeof WallSystem._syncWallsToPhaser === 'function') WallSystem._syncWallsToPhaser();
        console.log(`[scene8] 仙人掌散布 ${pieces.length} 棵（候选拒绝 ${guard - pieces.length} 次）`);
    },

    /**
     * 世界-122 可移动边界（2026-08-16）：沿菱形地块四条边注册不可见阻挡段。
     * - 段心落在菱形边线上，halfThick=12 → 单位（半径+半厚）越界即被 canMoveTo 拒绝，
     *   区外黑地玩家/怪物/寻路/建筑/能源矿一律不可进入/放置；
     * - _boundary 标记让 rebuildIsoCollision 的"仅保留门闸段"过滤不误删（wall-system.js）；
     * - 菱形边与掩体墙同斜率 0.5，阻挡线与视觉边界一致。
     */
    _registerScene8Boundary(diamond) {
        if (!diamond || !WallSystem || !WallSystem.isoSegments) return;
        const { cx, cy, rx, ry } = diamond;
        const pts = [
            [cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy],
        ];
        for (let i = 0; i < 4; i++) {
            const [x1, y1] = pts[i];
            const [x2, y2] = pts[(i + 1) % 4];
            WallSystem.isoSegments.push({
                x1, y1, x2, y2,
                halfThick: 12,
                noVisual: true,
                _boundary: true,
            });
        }
    },

    /** 世界-123（场景九）：普通进入为持久世界；任务进入仅复用雪原地形与碰撞。 */
    _loadScene9(player, mode = 'explore', questDefinition = null) {
        clearDecoClearZones();
        const isQuestInstance = mode === 'quest' && questDefinition?.scene === 'scene9';
        Camera.aimOffsetX = 0;
        Camera.aimOffsetY = 0;
        Camera.shakeX = 0;
        Camera.shakeY = 0;
        Camera.shakeIntensity = 0;
        Camera.lockY = false;
        Camera.yLockedValue = 0;

        const scene = this.scenes.scene9;
        const w = scene.width;
        const h = scene.height;
        CONFIG.WORLD_WIDTH = w;
        CONFIG.WORLD_HEIGHT = h;

        // 连续无缝主雪层 + 两层确定性软边补丁。渲染器统一按 0.5774 做30°等距纵向压缩。
        const diamond = this._scene8Diamond(scene);
        const floorSeed = WorldProgressionSystem.getWorldGenerationSeed('scene9', 'floor_deco');
        const frozenBase = getFrozenTerrainBase();
        setDungeonFloorProfile({
            tiles: [frozenBase.key || 'floor_snow_fresh_seamless'],
            continuous: frozenBase.continuous === true,
            glow: false,
            backgroundColor: scene.background || frozenBase.backgroundColor || '#101a2b',
            textureScaleY: frozenBase.textureScaleY ?? 0.5774,
            surfacePatches: [
                { texture: 'floor_snow_packed_seamless', perChunk: 4, size: 920, minDist: 1150 },
                { texture: 'floor_snow_wind_seamless', perChunk: 5, size: 620, minDist: 820 },
            ],
            // 18件冰原模型化小物按世界格网确定性散布；只烘焙视觉，不参与碰撞或寻路。
            deco: {
                ...getFrozenTerrainDeco('plane'),
                // 同一位面世代固定 seed；重建传送门后换新布局。
                seed: floorSeed,
            },
        });
        applyDungeonFloorChunked(w, h, 2048, diamond);

        WallSystem.init(w, h);
        WallSystem.walls = [
            { x: 0, y: 0, w, h: 20, noVisual: true },
            { x: 0, y: h - 20, w, h: 20, noVisual: true },
            { x: 0, y: 0, w: 20, h, noVisual: true },
            { x: w - 20, y: 0, w: 20, h, noVisual: true },
        ];
        this._registerScene8Boundary(diamond);
        if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();

        if (player && !Game._observerMode) {
            const entry = WorldProgressionSystem.getWorldConfig('scene9')?.portalSpawn
                || { x: diamond ? diamond.cx : w / 2, y: diamond ? diamond.cy : h / 2 };
            const savedPos = isQuestInstance ? null : Game._worldPlayerPos?.scene9;
            player.x = Number.isFinite(savedPos?.x) ? savedPos.x : entry.x + 228;
            player.y = Number.isFinite(savedPos?.y) ? savedPos.y : entry.y;
            Game.entities.set('player', player);
            Camera.follow(player);
            QuickBar.refreshSpecialAttack(player);
        } else if (Game._observerMode) {
            // 观察模式（2026-08-19）：不生成玩家，相机落世界中心自由平移
            const entry = WorldProgressionSystem.getWorldConfig('scene9')?.portalSpawn;
            Camera.x = entry?.x ?? (diamond ? diamond.cx : w / 2);
            Camera.y = entry?.y ?? (diamond ? diamond.cy : h / 2);
        }
        this._scatterSnowPinesScene9(
            player, diamond, WorldProgressionSystem.createWorldRandom('scene9', 'obstacles')
        );
        if (isQuestInstance) {
            const runtime = questDefinition.runtime || {};
            const clearRadius = Math.max(200, Number(runtime.riftClearRadius) || 240);
            const isValidPosition = (x, y) => {
                if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
                if (Math.abs(x - diamond.cx) / diamond.rx + Math.abs(y - diamond.cy) / diamond.ry > 0.84) {
                    return false;
                }
                if (player && Math.hypot(x - player.x, y - player.y) < 900) return false;
                return WallSystem.canBuildAt?.(x, y, clearRadius) !== false;
            };
            const clearPlacements = (points) => {
                const zones = (points || []).map((point) => ({
                    x: point.x,
                    y: point.y,
                    radius: clearRadius,
                }));
                WallSystem.removeScatterObstaclesInZones?.(zones);
                window.__phaserScene?.eraseDecoBatch?.(zones);
            };
            RiftSystem.spawnRifts(w, h, {
                count: runtime.riftCount,
                investigateMs: runtime.investigateMs,
                isValidPosition,
                clearPlacements,
            });
            Game._questSpawnTimer = 0;
            Game._questFirstSpawnDelay = null;
        } else {
            this._setupPersistentWorld('scene9', player, diamond);
        }
    },

    /** 世界-123高瘦雪松散布：五个姿态等概率取样，只落在雪原菱形内。 */
    _scatterSnowPinesScene9(player, diamond, random = Math.random) {
        const scene = this.scenes.scene9;
        const cfg = scene.snowPineScatter || {};
        if (cfg.enabled === false || !diamond) return;
        const count = cfg.count ?? 38;
        const minDist = cfg.minDist ?? 360;
        const jitter = cfg.scaleJitter ?? 0.1;
        const playerExclusion = cfg.playerExclusion ?? 440;
        const portalExclusion = cfg.portalExclusion ?? 340;
        const variants = ['01', '02', '03', '04', '05'];
        const portalSpawn = WorldProgressionSystem.getWorldConfig('scene9')?.portalSpawn
            || { x: diamond.cx, y: diamond.cy };
        const pieces = [];
        let guard = 0;
        while (pieces.length < count && guard++ < count * 40) {
            const x = 220 + random() * (scene.width - 440);
            const y = 220 + random() * (scene.height - 440);
            if (Math.abs(x - diamond.cx) / diamond.rx + Math.abs(y - diamond.cy) / diamond.ry > 0.96) continue;
            const tex = `obstacle_snow_pine_${variants[(random() * variants.length) | 0]}`;
            const geo = WallSystem._geoForTex?.(tex);
            if (!geo) continue;
            const scale = (geo.obstacleH / geo.h) * (1 - jitter + random() * jitter * 2);
            const footprint = WallSystem.getObstacleFootprintRect?.({ tex, x, y, scaleX: scale, scaleY: scale });
            const fx = footprint ? footprint.x + footprint.w / 2 : x;
            const fy = footprint ? footprint.y + footprint.h / 2 : y;
            if (player && Math.hypot(fx - player.x, fy - player.y) < playerExclusion) continue;
            if (Math.hypot(fx - portalSpawn.x, fy - portalSpawn.y) < portalExclusion) continue;
            if (pieces.some((piece) => Math.hypot(piece.x - x, piece.y - y) < minDist)) continue;
            const radius = Math.max(18, (geo.foot?.w ?? 80) * scale / 2);
            if (!WallSystem.canMoveTo?.(fx, fy, radius)) continue;
            pieces.push({ tex, x, y, scaleX: scale, scaleY: scale, flipX: random() < 0.5, _scatter: true });
        }
        for (const piece of pieces) WallSystem.isoVisuals.push(piece);
        if (pieces.length) WallSystem.rebuildIsoCollision?.();
        WallSystem._syncWallsToPhaser?.();
        console.log(`[scene9] 高瘦雪松散布 ${pieces.length} 棵（候选拒绝 ${guard - pieces.length} 次）`);
    },

    /** 世界-124（场景十）：草地无缝地板 + 林地树木的纯探索场。 */
    _loadScene10(player) {
        clearDecoClearZones();
        Camera.aimOffsetX = 0;
        Camera.aimOffsetY = 0;
        Camera.shakeX = 0;
        Camera.shakeY = 0;
        Camera.shakeIntensity = 0;
        Camera.lockY = false;
        Camera.yLockedValue = 0;

        const scene = this.scenes.scene10;
        const w = scene.width;
        const h = scene.height;
        CONFIG.WORLD_WIDTH = w;
        CONFIG.WORLD_HEIGHT = h;
        const diamond = this._scene8Diamond(scene);
        const floorSeed = WorldProgressionSystem.getWorldGenerationSeed('scene10', 'floor_deco');
        setDungeonFloorProfile({
            tiles: ['floor_grass_forest_seamless'],
            continuous: true,
            glow: false,
            backgroundColor: scene.background || '#102015',
            deco: {
                textures: ['deco_forest_grass_1', 'deco_forest_grass_2', 'deco_forest_grass_3', 'deco_forest_grass_4'],
                seed: floorSeed,
                perChunk: 24,
                size: 110,
                minDist: 130,
            },
        });
        applyDungeonFloorChunked(w, h, 2048, diamond);

        WallSystem.init(w, h);
        WallSystem.walls = [
            { x: 0, y: 0, w, h: 20, noVisual: true },
            { x: 0, y: h - 20, w, h: 20, noVisual: true },
            { x: 0, y: 0, w: 20, h, noVisual: true },
            { x: w - 20, y: 0, w: 20, h, noVisual: true },
        ];
        this._registerScene8Boundary(diamond);
        if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();

        if (player && !Game._observerMode) {
            const entry = WorldProgressionSystem.getWorldConfig('scene10')?.portalSpawn
                || { x: diamond ? diamond.cx : w / 2, y: diamond ? diamond.cy : h / 2 };
            const savedPos = Game._worldPlayerPos?.scene10;
            player.x = Number.isFinite(savedPos?.x) ? savedPos.x : entry.x + 228;
            player.y = Number.isFinite(savedPos?.y) ? savedPos.y : entry.y;
            Game.entities.set('player', player);
            Camera.follow(player);
            QuickBar.refreshSpecialAttack(player);
        } else if (Game._observerMode) {
            // 观察模式（2026-08-19）：不生成玩家，相机落世界中心自由平移
            const entry = WorldProgressionSystem.getWorldConfig('scene10')?.portalSpawn;
            Camera.x = entry?.x ?? (diamond ? diamond.cx : w / 2);
            Camera.y = entry?.y ?? (diamond ? diamond.cy : h / 2);
        }
        this._scatterForestPinesScene10(
            player, diamond, WorldProgressionSystem.createWorldRandom('scene10', 'obstacles')
        );
        this._setupPersistentWorld('scene10', player, diamond);
    },

    /** 世界-124林地树木散布：五种正式针叶树随机取样，避开出生点与返回门。 */
    _scatterForestPinesScene10(player, diamond, random = Math.random) {
        const scene = this.scenes.scene10;
        const cfg = scene.forestTreeScatter || {};
        if (cfg.enabled === false || !diamond) return;
        const count = cfg.count ?? 55;
        const minDist = cfg.minDist ?? 390;
        const jitter = cfg.scaleJitter ?? 0.1;
        const playerExclusion = cfg.playerExclusion ?? 440;
        const portalExclusion = cfg.portalExclusion ?? 340;
        const variants = ['01', '02', '03', '04', '05'];
        const portalSpawn = WorldProgressionSystem.getWorldConfig('scene10')?.portalSpawn
            || { x: diamond.cx, y: diamond.cy };
        const pieces = [];
        let guard = 0;
        while (pieces.length < count && guard++ < count * 40) {
            const x = 220 + random() * (scene.width - 440);
            const y = 220 + random() * (scene.height - 440);
            if (Math.abs(x - diamond.cx) / diamond.rx + Math.abs(y - diamond.cy) / diamond.ry > 0.96) continue;
            const tex = `obstacle_forest_pine_${variants[(random() * variants.length) | 0]}`;
            const geo = WallSystem._geoForTex?.(tex);
            if (!geo) continue;
            const scale = (geo.obstacleH / geo.h) * (1 - jitter + random() * jitter * 2);
            const footprint = WallSystem.getObstacleFootprintRect?.({ tex, x, y, scaleX: scale, scaleY: scale });
            const fx = footprint ? footprint.x + footprint.w / 2 : x;
            const fy = footprint ? footprint.y + footprint.h / 2 : y;
            if (player && Math.hypot(fx - player.x, fy - player.y) < playerExclusion) continue;
            if (Math.hypot(fx - portalSpawn.x, fy - portalSpawn.y) < portalExclusion) continue;
            if (pieces.some((piece) => Math.hypot(piece.x - x, piece.y - y) < minDist)) continue;
            const radius = Math.max(18, (geo.foot?.w ?? 80) * scale / 2);
            if (!WallSystem.canMoveTo?.(fx, fy, radius)) continue;
            pieces.push({ tex, x, y, scaleX: scale, scaleY: scale, flipX: random() < 0.5, _scatter: true });
        }
        for (const piece of pieces) WallSystem.isoVisuals.push(piece);
        if (pieces.length) WallSystem.rebuildIsoCollision?.();
        WallSystem._syncWallsToPhaser?.();
        console.log(`[scene10] 林地针叶树散布 ${pieces.length} 棵（候选拒绝 ${guard - pieces.length} 次）`);
    },

    /** 世界-125（场景十一）：僵尸地牢石砖地面 + 地牢障碍预制组合的开放探索场。 */
    async _loadScene11(player) {
        clearDecoClearZones();
        Camera.aimOffsetX = 0;
        Camera.aimOffsetY = 0;
        Camera.shakeX = 0;
        Camera.shakeY = 0;
        Camera.shakeIntensity = 0;
        Camera.lockY = false;
        Camera.yLockedValue = 0;

        const scene = this.scenes.scene11;
        const w = scene.width;
        const h = scene.height;
        CONFIG.WORLD_WIDTH = w;
        CONFIG.WORLD_HEIGHT = h;
        const diamond = this._scene8Diamond(scene);

        // 世界-125 专用遗迹大石板地砖：2:1 菱形、砖缝与建筑底边同口径，混铺砖缝全场连通。
        setDungeonFloorProfile({
            tiles: ['ruinslab_1', 'ruinslab_2'],
            glow: false,
            backgroundColor: scene.background || '#050505',
        });
        applyDungeonFloorChunked(w, h, 2048, diamond);

        WallSystem.init(w, h);
        WallSystem.walls = [
            { x: 0, y: 0, w, h: 20, noVisual: true },
            { x: 0, y: h - 20, w, h: 20, noVisual: true },
            { x: 0, y: 0, w: 20, h, noVisual: true },
            { x: w - 20, y: 0, w: 20, h, noVisual: true },
        ];
        this._registerScene8Boundary(diamond);
        WallSystem._syncWallsToPhaser?.();

        if (player && !Game._observerMode) {
            const entry = WorldProgressionSystem.getWorldConfig('scene11')?.portalSpawn
                || { x: diamond ? diamond.cx : w / 2, y: diamond ? diamond.cy : h / 2 };
            const savedPos = Game._worldPlayerPos?.scene11;
            player.x = Number.isFinite(savedPos?.x) ? savedPos.x : entry.x + 228;
            player.y = Number.isFinite(savedPos?.y) ? savedPos.y : entry.y;
            Game.entities.set('player', player);
            Camera.follow(player);
            QuickBar.refreshSpecialAttack(player);
        } else if (Game._observerMode) {
            const entry = WorldProgressionSystem.getWorldConfig('scene11')?.portalSpawn;
            Camera.x = entry?.x ?? (diamond ? diamond.cx : w / 2);
            Camera.y = entry?.y ?? (diamond ? diamond.cy : h / 2);
        }

        // BootScene 是异步预载；这里显式等待预制库和障碍默认状态，保证首次进入也有组合。
        await Promise.all([loadWallPrefabs(), loadObstacleDefaults()]);
        scatterWorld125Environment(scene, diamond, Game._observerMode ? null : player, {
            random: WorldProgressionSystem.createWorldRandom('scene11', 'obstacles'),
        });

        this._setupPersistentWorld('scene11', player, diamond);
    },

    _isPersistentWorld(sceneId) {
        return ['scene8', 'scene9', 'scene10', 'scene11'].includes(sceneId);
    },

    isQuestInstance(sceneId = this.currentScene) {
        return !!sceneId && this._activeQuestInstance?.sceneId === sceneId;
    },

    /** scene8~scene11 共用的建筑、资源、快照与入侵运行时。 */
    _setupPersistentWorld(sceneId, player, diamond) {
        // 目标仍是后台账本时，先结算经济/出兵，再补齐不足一个入侵阶段窗；
        // 随后才 setup 运行时，保证入侵读取的是最新军力摘要且不会在物化后改旧快照。
        window.WorldSimDriver?.flushWorld?.(sceneId, {
            notify: false,
            reason: 'materialize',
        });
        window.WorldInvasionSystem?.settleBackgroundNow?.(sceneId);
        DefenseSystem.setup(player, { managedExternally: true, worldId: sceneId });
        const generation = WorldProgressionSystem.getWorldGenerationContext(sceneId);
        if (generation.resourceRule === 'none') EnergyNodeSystem.teardown();
        else {
            const portalSpawn = WorldProgressionSystem.getWorldConfig(sceneId)?.portalSpawn
                || { x: diamond?.cx || CONFIG.WORLD_WIDTH / 2, y: diamond?.cy || CONFIG.WORLD_HEIGHT / 2 };
            EnergyNodeSystem.setup({
                random: WorldProgressionSystem.createWorldRandom(sceneId, `resources:${generation.resourceRule}`),
                portal: portalSpawn,
                diamond,
            });
        }
        HamsterHutSystem.setup();
        ProducerBuildingSystem.setup();
        HamsterMinerSystem.setup(player);

        const snapshot = getWorldSnapshot(sceneId);
        let result = null;
        if (snapshot) result = applyWorldSnapshot(sceneId);
        const portal = this._ensureWorldPortalEntity(sceneId, diamond);
        DefenseSystem.base = portal;
        const scene = this.scenes[sceneId] || {};
        FogOfWarSystem.enterScene(sceneId, {
            worldEpoch: WorldProgressionSystem.getWorldEpoch(sceneId),
            width: scene.width,
            height: scene.height,
            serialized: snapshot?.fogOfWar,
            // 完整旧档没有迷雾字段时兼容为“全图已探索”；仅传送门基础快照仍从黑图开局。
            legacyExplored: !!snapshot && !snapshot.initializedByPortal && !snapshot.fogOfWar,
        });
        FogOfWarSystem.update(sceneId, Game, Date.now(), { force: true });
        window.WorldInvasionSystem?.onWorldLoaded?.(sceneId, portal, diamond);
        this._announceWorld122Report(player, result);
    },

    _ensureWorldPortalEntity(sceneId, diamond) {
        const portalState = WorldProgressionSystem.getPortalState(sceneId);
        if (!portalState.everConstructed) return null;
        const worldCfg = WorldProgressionSystem.getWorldConfig(sceneId) || {};
        const spawn = worldCfg.portalSpawn || { x: diamond?.cx || CONFIG.WORLD_WIDTH / 2, y: diamond?.cy || CONFIG.WORLD_HEIGHT / 2 };
        const coreId = `world_portal_${sceneId}`;
        const portals = (ProducerBuildingSystem.buildings || [])
            .filter((building) => building?.cfgKey === 'portal');
        let portal = portals.find((building) => building.id === coreId)
            || portals.find((building) => building._isWorldPortalCore && building._worldId === sceneId)
            // 兼容旧 portal_only_v1 快照：旧核心无稳定 id，但坐标固定且建造成本为 0。
            || portals.find((building) => Number(building._buildCost) === 0
                && Math.hypot(building.x - spawn.x, building.y - spawn.y) <= 1);
        if (!portal) {
            portal = new ProducerBuilding(spawn.x, spawn.y, {
                id: coreId,
                cfgKey: 'portal',
                hp: WorldProgressionSystem.config.portal?.maxHp || 5000,
            });
            portal._builtByPlayer = true;
            portal._buildCost = 0;
            portal._buildCurrency = 'energy';
            Game.entities.set(portal.id, portal);
            ProducerBuildingSystem.buildings.push(portal);
            BuildingRoadSystem.attach(portal, { allowOverlap: true });
        }
        if (portal.id !== coreId) {
            for (const [key, entity] of Game.entities) {
                if (entity === portal) Game.entities.delete(key);
            }
            portal.id = coreId;
            Game.entities.set(coreId, portal);
        }
        portal._isWorldPortalCore = true;
        portal._worldId = sceneId;
        portal._worldEpoch = portalState.worldEpoch;
        portal.def = WorldProgressionSystem.config.portal?.def ?? portal.def;
        portal.mdef = WorldProgressionSystem.config.portal?.mdef ?? portal.mdef;
        portal._cfg.panelDescription = '该世界与传送网络的唯一通道，也是怪物入侵的最终目标。';
        portal.onDeath = function onWorldPortalDeath() {
            this.hp = 0;
            if (this.data) this.data.hp = 0;
            this.active = true;
            this.hittable = false;
            this._portalDestroyed = true;
            if (window.WorldInvasionSystem?.onPortalDestroyed) {
                window.WorldInvasionSystem.onPortalDestroyed(sceneId, this._worldEpoch);
            } else {
                SceneManager.destroyWorld(sceneId, this._worldEpoch);
            }
        };
        if (portalState.constructed && !portalState.destroyed) {
            WorldProgressionSystem.revivePortalEntity(sceneId, portal);
        } else {
            portal.hp = 0;
            if (portal.data) portal.data.hp = 0;
            portal.active = true;
            portal.hittable = false;
            portal._portalDestroyed = true;
            portal.name = `${WorldProgressionSystem.getWorldConfig(sceneId)?.name || sceneId}传送门遗迹`;
        }
        this._applyWorldCoreVisual(sceneId, portal);
        return portal;
    },

    /**
     * 位面核心继续使用传送门生命周期，只按世界配置覆盖场景视觉与占地。
     * 太阳阴影：普通建筑由主体 Sprite 当前 alpha 接地拟合生成独立 shadow caster，
     * 不查 manifest 剪影，也不把可能包含地基的 placement footprint 当视觉真源。
     */
    _applyWorldCoreVisual(sceneId, portal) {
        const visual = WorldProgressionSystem.getWorldConfig(sceneId)?.coreVisual;
        if (!portal || !visual?.texture) return portal;

        const displayW = Math.max(1, Number(visual.displayW) || portal.spriteCfg?.size || 1);
        const displayH = Math.max(1, Number(visual.displayH) || portal.spriteCfg?.sizeH || displayW);
        const footOffsetY = Number.isFinite(Number(visual.footOffsetY))
            ? Number(visual.footOffsetY)
            : displayH / 2;
        portal.spriteCfg = {
            ...(portal.spriteCfg || {}),
            idleKey: visual.texture,
            size: displayW,
            sizeH: displayH,
            footOffsetY,
            autoFootprint: false,
        };
        portal.footOffsetY = footOffsetY;
        if (portal._cfg) {
            portal._cfg.tex = visual.texture;
            portal._cfg.displayW = displayW;
            portal._cfg.displayH = displayH;
            portal._cfg.footOffsetY = footOffsetY;
            portal._cfg.autoFootprint = false;
        }
        applyBuildingFootprint(portal, Number(visual.footprintCells) || 2);
        if (typeof portal.rebuildCollider === 'function') portal.rebuildCollider();
        return portal;
    },

    _beginWorldDestructionTransaction(sceneId, worldEpoch) {
        const transactionId = `${sceneId}:${worldEpoch}`;
        const existing = this._worldDestructionTransactions.get(sceneId);
        if (existing?.transactionId === transactionId) return existing;
        const tx = { sceneId, worldEpoch, transactionId, attempts: 0, startedAt: Date.now() };
        this._worldDestructionTransactions.set(sceneId, tx);
        return tx;
    },

    _finishWorldDestructionTransactions(tx = null) {
        if (tx?.sceneId) {
            const stored = this._worldDestructionTransactions.get(tx.sceneId);
            if (stored?.transactionId === tx.transactionId) {
                this._worldDestructionTransactions.delete(tx.sceneId);
            }
        } else {
            this._worldDestructionTransactions.clear();
        }
        this._clearRollbackState();
    },

    _scheduleWorldDestructionReturn(tx) {
        const stored = this._worldDestructionTransactions.get(tx.sceneId);
        if (!stored || stored.transactionId !== tx.transactionId) return;
        if (this.currentScene === 'main') {
            this._finishWorldDestructionTransactions(tx);
            return;
        }
        if (this.isLoading) {
            TimerManager.setTimeout(() => this._scheduleWorldDestructionReturn(tx), 100);
            return;
        }
        if (stored.attempts >= 3) {
            this.showTopNotification('位面已毁灭，返回主城失败，请重新进入主城', {
                color: '#ff5555', fontSize: '28px', duration: 5000,
            });
            return;
        }
        stored.attempts++;
        this.switchScene('main', Game.player, undefined, { worldDestructionTx: stored }).catch((err) => {
            console.error('[world destroyed] return to main failed:', err);
            TimerManager.setTimeout(() => this._scheduleWorldDestructionReturn(stored), 150);
        });
    },

    /** 传送门被毁即判定位面毁灭：作废快照、旧坐标，并把仍在该位面的玩家/观察者送回主城。 */
    destroyWorld(sceneId, expectedEpoch = null) {
        if (!WorldProgressionSystem.markPortalDestroyed(sceneId, { expectedEpoch })) return false;
        FogOfWarSystem.resetScene(sceneId);
        TroopLineSystem.invalidateWorld(sceneId);
        const worldEpoch = WorldProgressionSystem.getWorldEpoch(sceneId);
        window.WorldDestructionChallengeSystem?.onWorldDestroyed?.(sceneId, worldEpoch);
        const tx = this._beginWorldDestructionTransaction(sceneId, worldEpoch);
        if (WorldProgressionSystem.shouldClearWorldScope(sceneId, 'snapshot')) {
            resetWorldSnapshot(sceneId);
        }
        if (WorldProgressionSystem.shouldClearWorldScope(sceneId, 'playerPosition')
            && Game?._worldPlayerPos) delete Game._worldPlayerPos[sceneId];
        // 后台位面失守时玩家可能正在主城：立即撤掉已断线的主城入口，
        // 不等下一次切场景才刷新传送网络。
        if (this.currentScene === 'main') Game.syncMainHubWorldPortals?.();
        const occupied = (this.currentScene === sceneId && !this.isQuestInstance(sceneId))
            || (Game?._observerMode && Game._observerHomeScene === sceneId);
        if (!occupied) {
            this._finishWorldDestructionTransactions(tx);
            return true;
        }
        Game._observerMode = false;
        Game._observerHomeScene = null;
        Promise.resolve().then(() => this._scheduleWorldDestructionReturn(tx));
        return true;
    },

    _loadScene7(player, _dungeonType = 'zombie') {
        // 重置 Camera 状态，避免从其他场景带入偏移
        Camera.aimOffsetX = 0;
        Camera.aimOffsetY = 0;
        Camera.shakeX = 0;
        Camera.shakeY = 0;
        Camera.shakeIntensity = 0;
        Camera.lockY = false;
        Camera.yLockedValue = 0;

        // 僵尸地牢：1024x1024 简单地图，无墙壁
        const worldSize = this._resolveWorldSize(this.scenes.scene7);
        CONFIG.WORLD_WIDTH = worldSize.width;
        CONFIG.WORLD_HEIGHT = worldSize.height;
        const size = CONFIG.WORLD_WIDTH;

        // 创建地形纹理（1024x1024 全石砖地板，无边框黑背景）
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // 全屏深灰色地板
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, size, size);

        // 地板纹理（石砖）
        ctx.strokeStyle = 'rgba(50, 50, 50, 0.3)';
        ctx.lineWidth = 1;
        for (let bx = 0; bx < size; bx += 20) {
            ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, size); ctx.stroke();
        }
        for (let by = 0; by < size; by += 20) {
            ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(size, by); ctx.stroke();
        }

        // 全地图边缘高光
        ctx.strokeStyle = 'rgba(80, 80, 80, 0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, size, size);

        Renderer.terrainTexture = canvas;
        if (window.__phaserScene) window.__phaserScene.syncTerrain();

        // 添加边界墙壁，防止玩家走出地图
        WallSystem.init(size, size);
        WallSystem.walls = [
            { x: 0, y: 0, w: size, h: 20 },      // 上边界
            { x: 0, y: size - 20, w: size, h: 20 },   // 下边界
            { x: 0, y: 0, w: 20, h: size },      // 左边界
            { x: size - 20, y: 0, w: 20, h: size },   // 右边界
        ];
        // 同步到 Phaser（确保物理碰撞体也更新）
        if (WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }

        // 玩家放在地板中央
        if (player) {
            player.x = size / 2;
            player.y = size / 2;
            Game.entities.set('player', player);
            Camera.follow(player);
        }

        // 同步快捷栏
        if (player) {
            QuickBar.refreshSpecialAttack(player);
        }

        // 打开背包和出征准备面板（两者同时从右侧弹出，出征在背包左边）
        if (SystemUI) {
            SystemUI.open('equip');
        }
        if (ExpeditionSystem) {
            ExpeditionSystem.open(player);
        }

        // 地牢地图系统由出征面板的 depart() 调用，这里不再自动初始化
    },

};

// 传送门实体

