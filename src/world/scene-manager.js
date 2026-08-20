import { Game } from '../game.js';
import { WallSystem } from '../world/wall-system.js';
import { Renderer } from '../world/renderer.js';
import { Camera } from '../world/camera.js';
import { Portal } from './portal.js';
import { BlackWolf } from '../entities/enemy-types.js';

import { ExpeditionSystem } from '../ui/expedition-system.js';
import { GAME_CONFIG } from '../config/game-config.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';
import { GoldManager } from '../systems/gold-manager.js';
import { SoundManager } from '../ui/sound-manager.js';
import { getElement, getElementIfExists } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { setDungeonFloorProfile, applyDungeonFloor, applyDungeonFloorChunked, clearDecoClearZones } from './dungeon-floor-texture.js';
import { getWallPrefabLibrary, loadWallPrefabs, isWallPrefabsLoaded, loadObstacleLayout, loadObstacleDefaults, getObstacleLayout, getWallGeoOverrides, isWallGeoOverridesLoaded } from './wall-prefabs.js';
import { CONFIG } from '../config/config.js';
import { TargetDummy } from '../entities/target-dummy.js';
import { RiftSystem } from '../quest/rift-system.js';
import { QuickBar } from '../ui/quick-bar.js';
import { SystemUI } from '../ui/system-ui.js';
import {
    DefenseSystem, DEFENSE_CONFIG, DefenseTower, DefenseCover, BuildableGate, FiringPlatform,
} from './defense-system.js';
import { EnergyNodeSystem } from './energy-node-system.js';
import { ENERGY_CONFIG } from '../config/energy-config.js';
import { HamsterMinerSystem } from './hamster-miner-system.js';
import { HamsterHutSystem, HamsterHut } from './hamster-hut-system.js';
import { HamsterBarracksSystem, HamsterBarracks } from './hamster-barracks-system.js';
import { ProducerBuildingSystem, ProducerBuilding, getProducerConfig } from './producer-building-system.js';
import { BuildingSystem } from './building-system.js';
import { BuildingRoadSystem } from './building-road-system.js';
import { DefenseTrapSystem } from './defense-trap-system.js';
import {
    captureAndStoreWorld, applyWorldSnapshot, getWorldSnapshot,
    configureWorld122SnapshotRuntime, resetWorldSnapshot,
} from './world122-snapshot.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { ResearchSystem } from './research-system.js';
import { scatterWorld125Environment } from './world125-environment.js';
import { WorldProgressionSystem } from './world-progression-system.js';

export const SceneManager = {
    currentScene: null,
    scenes: {},
    isLoading: false,
    loadProgress: 0,
    _sceneLabel: null, // 当前场景名称标签
    _inMainHub: false, // 主神空间无敌保护开关，避免依赖 currentScene 产生泄漏
    _mainHubInvincible: true, // 主神空间是否开启无敌（可通过 UI 切换）
    _worldDestructionTransactions: new Map(),

    init() {
        this._worldDestructionTransactions.clear();
        // 快照模块保持无启动期静态依赖；在 Game 已完成定义后才注入恢复所需的实体构造器。
        configureWorld122SnapshotRuntime({
            Game,
            DefenseSystem,
            DefenseTower,
            DefenseCover,
            BuildableGate,
            FiringPlatform,
            DEFENSE_CONFIG,
            HamsterHutSystem,
            HamsterHut,
            HamsterBarracksSystem,
            HamsterBarracks,
            ProducerBuildingSystem,
            ProducerBuilding,
            getProducerConfig,
            EnergyNodeSystem,
            EnergyManager,
            ResearchSystem,
            GoldManager,
            getWorldEpoch: (sceneId) => WorldProgressionSystem.getWorldEpoch(sceneId),
            canPersistWorld: (sceneId) => WorldProgressionSystem.isPortalConstructed(sceneId),
            getWorldGenerationContext: (sceneId) => WorldProgressionSystem.getWorldGenerationContext(sceneId),
        });
        // 新游戏初始传送门也必须在五日入侵开始前拥有基础位面快照。
        WorldProgressionSystem.ensureConstructedWorldSnapshots();
        const cfg = GAME_CONFIG.scenes || {};
        this.scenes = {
            main: cfg.main || { name: '主神空间', type: 'main', label: '场景一', width: 7650, height: 3800, background: '#2a3520', origin: { x: 3825, y: 1886 } },
            scene2: cfg.scene2 || { name: '雪地', type: 'instance', label: '场景二', width: 9000, height: 9000, background: '#b8c0c8', origin: { x: 4500, y: 4500 } },
            scene3: cfg.scene3 || { name: '列车上', type: 'instance', label: '场景三', width: 3000, height: 1200, background: '#4a4538', origin: { x: 1500, y: 600 } },
            scene4: cfg.scene4 || { name: '古堡', type: 'instance', label: '场景四', width: 9000, height: 9000, background: '#000000', origin: { x: 4500, y: 4500 } },
            scene5: cfg.scene5 || { name: 'AI测试场', type: 'instance', label: '场景五', width: 6120, height: 3040, background: '#3a3a3a', origin: { x: 3060, y: 1520 } },
            scene7: cfg.scene7 || { name: '僵尸地牢高级', type: 'dungeon', label: '场景七', width: 1024, height: 1024, background: '#000000', origin: { x: 512, y: 512 }, dungeonType: 'zombie' },
            scene8: cfg.scene8 || { name: '世界-122', type: 'instance', label: '场景八', width: 12288, height: 8192, background: '#0d1b0a', origin: { x: 6144, y: 4096 } },
            scene9: cfg.scene9 || { name: '世界-123·雪原', type: 'instance', label: '场景九', width: 12288, height: 8192, background: '#101a2b', origin: { x: 6144, y: 4096 } },
            scene10: cfg.scene10 || { name: '世界-124·林地', type: 'instance', label: '场景十', width: 12288, height: 8192, background: '#102015', origin: { x: 6144, y: 4096 } },
            scene11: cfg.scene11 || { name: '世界-125·地牢遗迹', type: 'instance', label: '场景十一', width: 12288, height: 8192, background: '#050505', origin: { x: 6144, y: 4096 } }
        };
    },

    showLoadingScreen() {
        this.isLoading = true;
        this.loadProgress = 0;
        let overlay = getElementIfExists('loadingOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'loadingOverlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#1a1a1a;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:opacity 0.3s;font-family:SimHei, "Microsoft YaHei", sans-serif;';
            overlay.innerHTML = `
                <div style="color:#d4c5a9;font-size:28px;margin-bottom:30px;">场景加载中...</div>
                <div style="width:400px;height:20px;background:#3a3a3a;border-radius:10px;overflow:hidden;border:2px solid #5a4a3a;">
                    <div id="loadingProgressBar" style="width:0%;height:100%;background:linear-gradient(90deg, #6a8a5a, #8aaa7a);transition:width 0.2s;"></div>
                </div>
                <div id="loadingProgressText" style="color:#8a8a8a;font-size:14px;margin-top:10px;">0%</div>
            `;
            document.body.appendChild(overlay);
        } else {
            overlay.style.display = 'flex';
            overlay.style.opacity = '1';
        }
    },

    hideLoadingScreen() {
        const overlay = getElementIfExists('loadingOverlay');
        if (overlay) {
            overlay.style.opacity = '0';
            TimerManager.setTimeout(() => { overlay.style.display = 'none'; }, 300);
        }
        this.isLoading = false;
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
        if (this.currentScene === sceneId) return true;
        if (this._isPersistentWorld(sceneId) && !WorldProgressionSystem.isPortalConstructed(sceneId)) {
            this.showTopNotification('该世界位面尚未搭建传送门', { color: '#ff7766' });
            return false;
        }
        const scene = this.scenes[sceneId];
        if (!scene) {
            console.error('Scene not found:', sceneId);
            this.showTopNotification('目标世界不存在，无法切换', { color: '#ff7766' });
            return false;
        }
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
            } else if (player && g.entities && g.entities.get('player') === player && this.currentScene) {
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
        try {
            this.showLoadingScreen();
            this._enterMode = mode || 'explore'; // 'quest' | 'explore'

            this.setProgress(10);
            await this.delay(100);
            this.setProgress(30);

            // 保存当前场景状态
            if (this.currentScene === 'main') {
                this._saveMainSceneState();
            }

            // 离开列车场景时解锁相机Y轴
            if (this.currentScene === 'scene3') {
                Camera.lockY = false;
                Camera.yLockedValue = 0;
            }

            this.setProgress(50);
            await this.delay(100);

            // 清理当前场景
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
            if (this.currentScene === 'scene8' || this.currentScene === 'scene9'
                || this.currentScene === 'scene10' || this.currentScene === 'scene11') clearDecoClearZones();
            // 世界-122 建筑面板随场景离场关闭
            if (BuildingSystem && BuildingSystem.active) {
                BuildingSystem.close();
            }
            if (DefenseTrapSystem && typeof DefenseTrapSystem.teardown === 'function') {
                DefenseTrapSystem.teardown();
            }
            // 世界-122 能源资源点随场景离场拆除（实体由下方 Game.entities.clear 统一清理）
            if (EnergyNodeSystem && EnergyNodeSystem.active) {
                EnergyNodeSystem.teardown();
            }
            // 世界-122 仓鼠小屋随场景离场拆除（矿工由小屋一并清理）
            if (HamsterHutSystem && HamsterHutSystem.active) {
                HamsterHutSystem.teardown();
            }
            if (HamsterBarracksSystem && HamsterBarracksSystem.active) {
                HamsterBarracksSystem.teardown();
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
            // 场景切换前销毁在飞投射物的 Phaser 贴图与附加粒子（彗尾/环绕 emitter），
            // 直接丢弃 effects 列表不会走正常失效路径，粒子发射器会永久泄漏
            if (EffectManager && Array.isArray(EffectManager.effects)) {
                for (const fx of EffectManager.effects) {
                    if (fx && typeof fx._destroyPhaserSprite === 'function') {
                        try { fx._destroyPhaserSprite(); } catch (_e) { /* 忽略清理异常 */ }
                    }
                }
            }
            EffectManager.effects = [];
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

            // 销毁无人机并触发CD
            if (player && player.droneSystem && player.droneSystem.active) {
                if (typeof player.droneSystem._deactivate === 'function') {
                    player.droneSystem._deactivate();
                }
                if (QuickBar && player.skills && player.skills.droneSkill) {
                    const getEffect = player.skills.droneSkill.getEffect;
                    const effect = typeof getEffect === 'function' ? getEffect(player.skills.droneSkill.level) : null;
                    QuickBar.cooldowns['droneSkill'] = (effect && effect.cooldown || 15) * 1000;
                }
            }

            this.setProgress(70);
            await this.delay(100);

            // 加载新场景
            if (sceneId === 'scene2') {
                this._loadScene2(player, this._enterMode);
            } else if (sceneId === 'scene3') {
                this._loadScene3(player);
            } else if (sceneId === 'scene4') {
                this._loadScene4(player);
            } else if (sceneId === 'scene5') {
                this._loadScene5(player);
            } else if (sceneId === 'scene7') {
                this._loadScene7(player, 'zombie');
            } else if (sceneId === 'scene8') {
                this._loadScene8(player);
            } else if (sceneId === 'scene9') {
                this._loadScene9(player);
            } else if (sceneId === 'scene10') {
                this._loadScene10(player);
            } else if (sceneId === 'scene11') {
                await this._loadScene11(player);
            } else if (sceneId === 'main') {
                this._loadMainScene(player);
            }

            this.setProgress(100);
            await this.delay(200);

            this.currentScene = sceneId;
            this._inMainHub = (sceneId === 'main');
            if (sceneId === 'main') this._finishWorldDestructionTransactions(opts.worldDestructionTx);
            // 双保险：世界尺寸可能刚变化，强制小地图静态层按新尺寸重绘（避免放大墙层残留）
            if (window.__phaserScene) window.__phaserScene._minimapStaticKey = null;
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
            else this._rollback(player);
            throw err;
        }
    },

    _clearRollbackState() {
        this._rollbackEntities = null;
        this._rollbackEffects = null;
        this._rollbackTrees = null;
        this._rollbackCamera = null;
        this._rollbackCurrentScene = null;
        this._rollbackPlayerPos = null;
        this._rollbackObserverMode = null;
        this._rollbackObserverHomeScene = null;
        this._rollbackWorldPlayerPos = null;
    },

    _handleWorldDestructionSwitchFailure(tx) {
        this.isLoading = false;
        this.hideLoadingScreen();
        // 强制回城失败也不能把已毁位面从通用 rollback 缓存复活。
        const phaserScene = typeof window !== 'undefined' ? window.__phaserScene : null;
        phaserScene?.clearCombatView?.();
        phaserScene?.clearAllEntitySprites?.();
        BuildingSystem?.close?.();
        DefenseTrapSystem?.teardown?.();
        DefenseSystem?.teardown?.();
        EnergyNodeSystem?.teardown?.();
        HamsterMinerSystem?.teardown?.();
        HamsterHutSystem?.teardown?.();
        HamsterBarracksSystem?.teardown?.();
        ProducerBuildingSystem?.teardown?.();
        BuildingRoadSystem?.reset?.();
        WallSystem?.init?.(0, 0);
        EffectManager?.clearFloatingTexts?.();
        Game.entities?.clear?.();
        if (EffectManager && Array.isArray(EffectManager.effects)) {
            for (const fx of EffectManager.effects) {
                try { fx?._destroyPhaserSprite?.(); } catch (_e) { /* 强制清场继续 */ }
            }
            EffectManager.effects = [];
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
        this._rollbackEffects = EffectManager.effects ? EffectManager.effects.slice() : null;
        this._rollbackTrees = WallSystem.trees ? WallSystem.trees.slice() : null;
        this._rollbackCamera = { x: Camera.x, y: Camera.y };
        this._rollbackCurrentScene = this.currentScene;
        this._rollbackPlayerPos = player ? { x: player.x, y: player.y } : null;
        this._rollbackObserverMode = !!Game._observerMode;
        this._rollbackObserverHomeScene = Game._observerHomeScene || null;
        this._rollbackWorldPlayerPos = { ...(Game._worldPlayerPos || {}) };
    },

    _rollback(player) {
        this.isLoading = false;
        this.hideLoadingScreen();
        const rollbackObserverMode = !!this._rollbackObserverMode;
        if (this._rollbackEntities) {
            Game.entities = this._rollbackEntities;
            if (!rollbackObserverMode && player && !Game.entities.has('player')) {
                Game.entities.set('player', player);
            }
        }
        if (EffectManager.effects && this._rollbackEffects) {
            EffectManager.effects = this._rollbackEffects;
        }
        if (WallSystem.trees && this._rollbackTrees) {
            WallSystem.trees = this._rollbackTrees;
        }
        if (this._rollbackCamera) {
            Camera.x = this._rollbackCamera.x;
            Camera.y = this._rollbackCamera.y;
        }
        if (player && this._rollbackPlayerPos) {
            player.x = this._rollbackPlayerPos.x;
            player.y = this._rollbackPlayerPos.y;
        }
        Game._observerMode = rollbackObserverMode;
        Game._observerHomeScene = this._rollbackObserverHomeScene || null;
        Game._worldPlayerPos = { ...(this._rollbackWorldPlayerPos || {}) };
        this.currentScene = this._rollbackCurrentScene;
        this._inMainHub = (this._rollbackCurrentScene === 'main');
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

    _loadScene2(player, mode) {
        const scene = this.scenes.scene2;
        const isQuestMode = mode === 'quest';
        const worldSize = this._resolveWorldSize(scene);
        CONFIG.WORLD_WIDTH = worldSize.width;
        CONFIG.WORLD_HEIGHT = worldSize.height;

        // 雪地地形纹理
        const canvas = document.createElement('canvas');
        canvas.width = scene.width;
        canvas.height = scene.height;
        const ctx = canvas.getContext('2d');
        // 白色雪地背景（降低亮度）
        ctx.fillStyle = '#b8c0c8';
        ctx.fillRect(0, 0, scene.width, scene.height);
        // 雪地纹理噪点
        for (let i = 0; i < 20000; i++) {
            const x = Math.random() * scene.width, y = Math.random() * scene.height;
            const size = Math.random() * 2 + 1;
            const alpha = Math.random() * 0.1 + 0.05;
            ctx.fillStyle = Math.random() > 0.5 ? `rgba(200, 210, 220, ${alpha})` : `rgba(180, 190, 200, ${alpha})`;
            ctx.fillRect(x, y, size, size);
        }
        // 雪地中的暗色区域（模仿阴影）
        for (let i = 0; i < 500; i++) {
            const x = Math.random() * scene.width, y = Math.random() * scene.height;
            const rx = 20 + Math.random() * 60, ry = 10 + Math.random() * 30;
            ctx.fillStyle = `rgba(160, 170, 180, ${Math.random() * 0.15 + 0.05})`;
            ctx.beginPath(); ctx.ellipse(x, y, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2); ctx.fill();
        }
        Renderer.terrainTexture = canvas;
        if (window.__phaserScene) window.__phaserScene.syncTerrain();

        // 重置墙壁系统并添加边界
        WallSystem.init(scene.width, scene.height);
        WallSystem.walls = [
            { x: -10, y: -10, w: scene.width + 20, h: 10 },
            { x: -10, y: scene.height, w: scene.width + 20, h: 10 },
            { x: -10, y: -10, w: 10, h: scene.height + 20 },
            { x: scene.width, y: -10, w: 10, h: scene.height + 20 }
        ];

        // 生成石块障碍物（墙壁） — 雪地场景已移除，改为树木
        /* for (let i = 0; i < 60; i++) { ... } */
        // 生成树枝/树干障碍物 — 雪地场景已移除
        /* for (let i = 0; i < 40; i++) { ... } */

        // 雪地场景：随机生成100棵雪地树木（最小距离500px，随机朝向）
        const treeRadius = 25;
        const snowTrees = [];
        for (let i = 0; i < 100; i++) {
            let tx, ty, distOk;
            let attempts = 0;
            do {
                tx = 200 + Math.random() * (scene.width - 400);
                ty = 200 + Math.random() * (scene.height - 400);
                distOk = true;
                for (const t of snowTrees) {
                    const dx = t.x - tx, dy = t.y - ty;
                    if (Math.sqrt(dx * dx + dy * dy) < 500) { distOk = false; break; }
                }
                const dxCenter = tx - scene.width / 2, dyCenter = ty - scene.height / 2;
                if (Math.sqrt(dxCenter * dxCenter + dyCenter * dyCenter) < 800) distOk = false;
                attempts++;
            } while (!distOk && attempts < 50);
            if (distOk) {
                const treeType = Math.floor(Math.random() * 3);
                const rotation = Math.random() * Math.PI * 2;
                WallSystem.addTree(tx, ty, treeRadius, treeType, 'snow', rotation);
                snowTrees.push({ x: tx, y: ty });
            }
        }

        // 放置玩家到中心
        if (player) {
            player.x = scene.width / 2;
            player.y = scene.height / 2;
            Game.entities.set('player', player);
            Camera.follow(player);
        }

        if (!isQuestMode) {
            // 自由探索模式：添加返回传送门、生成所有怪物和区域BOSS
            const portal = new Portal(scene.width / 2, scene.height - 100, 'main', '返回主神空间');
            Game.entities.set('portal_return', portal);

            const monsterTypes = [BlackWolf];
            const typeNames = ['black_wolf'];
            const playerX = player ? player.x : scene.width / 2;
            const playerY = player ? player.y : scene.height / 2;
            for (let t = 0; t < monsterTypes.length; t++) {
                for (let i = 0; i < 20; i++) {
                    let mx, my, distToPlayer;
                    let attempts = 0;
                    do {
                        const angle = Math.random() * Math.PI * 2;
                        const radius = 3000 + Math.random() * 1000;
                        mx = playerX + Math.cos(angle) * radius;
                        my = playerY + Math.sin(angle) * radius;
                        mx = Math.max(100, Math.min(scene.width - 100, mx));
                        my = Math.max(100, Math.min(scene.height - 100, my));
                        const dx = mx - playerX;
                        const dy = my - playerY;
                        distToPlayer = Math.sqrt(dx * dx + dy * dy);
                        attempts++;
                    } while (distToPlayer < 2500 && attempts < 10);
                    const monster = new monsterTypes[t](mx, my);
                    Game.entities.set(`monster_${typeNames[t]}_${i}`, monster);
                }
            }

            // 生成区域BOSS (BlackWolf)
            const bigBossAngle = Math.random() * Math.PI * 2;
            const bigBossDist = 2000;
            let bbx = playerX + Math.cos(bigBossAngle) * bigBossDist;
            let bby = playerY + Math.sin(bigBossAngle) * bigBossDist;
            bbx = Math.max(100, Math.min(scene.width - 100, bbx));
            bby = Math.max(100, Math.min(scene.height - 100, bby));
            const bigBoss = new BlackWolf(bbx, bby);
            Game.entities.set('big_boss', bigBoss);
        } else {
            // 任务模式：不生成传送门和怪物，生成时空裂隙
            if (RiftSystem) {
                RiftSystem.spawnRifts(scene.width, scene.height);
            }
            // 初始化任务模式怪物生成计时器
            Game._questSpawnTimer = 0;
            Game._questFirstSpawnDelay = 15000; // 15秒后首次生成
            Game._questSpawnInterval = 15000; // 每15秒生成一次
            Game._questSpawnCount = 5; // 每次5只
        }

        // 同步快捷栏特殊攻击图标
        if (player) {
            QuickBar.refreshSpecialAttack(player);
        }
    },

    /** 主神空间地形统一入口：砖地烘焙 + 边界墙（Game.init 首启与 _loadMainScene 回城共用，禁止两套路径） */
    _setupMainHubTerrain() {
        const hubCfg = (GAME_CONFIG.scenes && GAME_CONFIG.scenes.mainHub) || {};
        setDungeonFloorProfile(hubCfg.floor || null);
        applyDungeonFloor(CONFIG.WORLD_WIDTH);
        // 场地边界墙（厚度走 mainHub.wallThickness 配置）
        const wt = hubCfg.wallThickness ?? 20;
        const size = CONFIG.WORLD_WIDTH;
        WallSystem.walls = [
            { x: 0, y: 0, w: size, h: wt, height: 60 },
            { x: 0, y: size - wt, w: size, h: wt, height: 60 },
            { x: 0, y: 0, w: wt, h: size, height: 60 },
            { x: size - wt, y: 0, w: wt, h: size, height: 60 },
        ];

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
            Renderer.generateWorld();
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
            Renderer.generateWorld();
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
            Camera.follow(player);
            QuickBar.refreshSpecialAttack(player);
        } else if (observing) {
            Game.entities.delete('player');
            const anchor = this._mainPlayerPos || this.scenes.main?.origin
                || { x: CONFIG.WORLD_WIDTH / 2, y: CONFIG.WORLD_HEIGHT / 2 };
            Camera.x = anchor.x;
            Camera.y = anchor.y;
        }

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

    _loadScene3(player) {
        const scene = this.scenes.scene3;
        const carriageWidth = 500;
        const carriageHeight = 300;
        const numCarriages = 6;
        const totalWidth = carriageWidth * numCarriages;
        const wallThickness = 20;

        const worldSize = this._resolveWorldSize(scene);
        CONFIG.WORLD_WIDTH = worldSize.width || totalWidth;
        CONFIG.WORLD_HEIGHT = worldSize.height || scene.height;

        // 列车内部地形纹理（透明 outside，车内内容在中间）
        const canvas = document.createElement('canvas');
        canvas.width = CONFIG.WORLD_WIDTH;
        canvas.height = CONFIG.WORLD_HEIGHT;
        const ctx = canvas.getContext('2d');

        const interiorTop = (CONFIG.WORLD_HEIGHT - carriageHeight) / 2;
        const interiorBottom = interiorTop + carriageHeight;

        // 地板
        ctx.fillStyle = '#3d3528';
        ctx.fillRect(0, interiorTop, CONFIG.WORLD_WIDTH, carriageHeight);

        // 地板纹理
        for (let x = 0; x < CONFIG.WORLD_WIDTH; x += 20) {
            ctx.strokeStyle = 'rgba(80, 70, 55, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, interiorTop);
            ctx.lineTo(x, interiorBottom);
            ctx.stroke();
        }

        // 绘制每个车厢
        for (let c = 0; c < numCarriages; c++) {
            const cx = c * carriageWidth;

            // 车厢分隔线
            if (c > 0) {
                ctx.strokeStyle = 'rgba(120, 110, 90, 0.6)';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(cx, interiorTop);
                ctx.lineTo(cx, interiorBottom);
                ctx.stroke();
            }

            // 车厢编号
            ctx.fillStyle = 'rgba(180, 170, 140, 0.3)';
            ctx.font = '20px SimHei, "Microsoft YaHei", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`第${c + 1}节车厢`, cx + carriageWidth / 2, interiorTop + 30);

            // 两侧座椅
            const seatColor = '#5a5040';
            const seatW = 40, seatH = 25;
            const seatSpacing = 80;
            const seatMargin = 15;

            for (let sx = cx + 30; sx < cx + carriageWidth - 30; sx += seatSpacing) {
                // 上方座椅
                ctx.fillStyle = seatColor;
                ctx.fillRect(sx, interiorTop + seatMargin, seatW, seatH);
                ctx.strokeStyle = 'rgba(100, 90, 75, 0.5)';
                ctx.strokeRect(sx, interiorTop + seatMargin, seatW, seatH);

                // 下方座椅
                ctx.fillStyle = seatColor;
                ctx.fillRect(sx, interiorBottom - seatMargin - seatH, seatW, seatH);
                ctx.strokeStyle = 'rgba(100, 90, 75, 0.5)';
                ctx.strokeRect(sx, interiorBottom - seatMargin - seatH, seatW, seatH);
            }

            // 中央过道虚线
            ctx.strokeStyle = 'rgba(100, 90, 75, 0.2)';
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 10]);
            ctx.beginPath();
            ctx.moveTo(cx + 20, CONFIG.WORLD_HEIGHT / 2);
            ctx.lineTo(cx + carriageWidth - 20, CONFIG.WORLD_HEIGHT / 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 车厢外壁
        ctx.fillStyle = 'rgba(60, 55, 45, 0.3)';
        ctx.fillRect(0, interiorTop - 10, CONFIG.WORLD_WIDTH, 10);
        ctx.fillRect(0, interiorBottom, CONFIG.WORLD_WIDTH, 10);

        Renderer.terrainTexture = canvas;
        if (window.__phaserScene) window.__phaserScene.syncTerrain();

        // 设置墙壁系统
        WallSystem.init(CONFIG.WORLD_WIDTH, CONFIG.WORLD_HEIGHT);
        WallSystem.walls = [];

        // 车厢内壁（上下边界，防止走出车外）
        WallSystem.walls.push({ x: 0, y: interiorTop - wallThickness, w: CONFIG.WORLD_WIDTH, h: wallThickness });
        WallSystem.walls.push({ x: 0, y: interiorBottom, w: CONFIG.WORLD_WIDTH, h: wallThickness });

        // 左右端墙
        WallSystem.walls.push({ x: -wallThickness, y: 0, w: wallThickness, h: CONFIG.WORLD_HEIGHT });
        WallSystem.walls.push({ x: CONFIG.WORLD_WIDTH, y: 0, w: wallThickness, h: CONFIG.WORLD_HEIGHT });

        // 座椅碰撞体
        const seatW = 40, seatH = 25;
        const seatSpacing = 80;
        const seatMargin = 15;
        for (let c = 0; c < numCarriages; c++) {
            const cx = c * carriageWidth;
            for (let sx = cx + 30; sx < cx + carriageWidth - 30; sx += seatSpacing) {
                WallSystem.walls.push({ x: sx, y: interiorTop + seatMargin, w: seatW, h: seatH });
                WallSystem.walls.push({ x: sx, y: interiorBottom - seatMargin - seatH, w: seatW, h: seatH });
            }
        }

        // 放置玩家到第一节车厢
        if (player) {
            player.x = carriageWidth / 2;
            player.y = CONFIG.WORLD_HEIGHT / 2;
            Game.entities.set('player', player);
            Camera.follow(player);
            // 列车场景锁定相机Y轴，只允许左右移动
            Camera.lockY = true;
            Camera.yLockedValue = CONFIG.WORLD_HEIGHT / 2;
        }

        // 返回传送门（在列车最后一节）
        const portal = new Portal(CONFIG.WORLD_WIDTH - 50, CONFIG.WORLD_HEIGHT / 2, 'main', '返回主神空间');
        Game.entities.set('portal_return', portal);

        // 同步快捷栏
        if (player) {
            QuickBar.refreshSpecialAttack(player);
        }

        // 初始化列车滚动背景偏移
        if (Game) Game._trainScrollOffset = 0;
    },

    _loadScene4(player) {
        const scene = this.scenes.scene4;
        const worldSize = this._resolveWorldSize(scene);
        CONFIG.WORLD_WIDTH = worldSize.width;
        CONFIG.WORLD_HEIGHT = worldSize.height;

        // 古堡地形纹理：深灰色地板，黑色墙壁
        const canvas = document.createElement('canvas');
        canvas.width = scene.width;
        canvas.height = scene.height;
        const ctx = canvas.getContext('2d');

        // 深灰色石质地板（默认可移动区域）
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, scene.width, scene.height);

        // 石质纹理噪点
        for (let i = 0; i < 30000; i++) {
            const x = Math.random() * scene.width, y = Math.random() * scene.height;
            const size = Math.random() * 3 + 1;
            const alpha = Math.random() * 0.1 + 0.02;
            ctx.fillStyle = Math.random() > 0.5 ? `rgba(60, 60, 60, ${alpha})` : `rgba(80, 80, 80, ${alpha})`;
            ctx.fillRect(x, y, size, size);
        }

        // 墙壁（黑色不可移动区域）
        ctx.fillStyle = '#000000';
        const walls = [
            // 外边界
            { x: -50, y: -50, w: 9100, h: 50 },
            { x: -50, y: 9000, w: 9100, h: 50 },
            { x: -50, y: -50, w: 50, h: 9100 },
            { x: 9000, y: -50, w: 50, h: 9100 },
            // 中央大厅（3000x3000）上墙（门4000-5000）
            { x: 3000, y: 3000, w: 1000, h: 100 },
            { x: 5000, y: 3000, w: 1000, h: 100 },
            // 中央大厅下墙（门4000-5000）
            { x: 3000, y: 6000, w: 1000, h: 100 },
            { x: 5000, y: 6000, w: 1000, h: 100 },
            // 中央大厅左墙（门4000-5000）
            { x: 3000, y: 3000, w: 100, h: 1000 },
            { x: 3000, y: 5000, w: 100, h: 1000 },
            // 中央大厅右墙（门4000-5000）
            { x: 5900, y: 3000, w: 100, h: 1000 },
            { x: 5900, y: 5000, w: 100, h: 1000 },
            // 上方房间（3000x2500）
            { x: 3000, y: 500, w: 3000, h: 100 },
            { x: 3000, y: 500, w: 100, h: 2500 },
            { x: 5900, y: 500, w: 100, h: 2500 },
            // 下方房间（3000x2500）
            { x: 3000, y: 8400, w: 3000, h: 100 },
            { x: 3000, y: 6000, w: 100, h: 2500 },
            { x: 5900, y: 6000, w: 100, h: 2500 },
            // 左侧房间（2500x3000）
            { x: 500, y: 3000, w: 2500, h: 100 },
            { x: 500, y: 6000, w: 2500, h: 100 },
            { x: 500, y: 3000, w: 100, h: 3000 },
            // 右侧房间（2500x3000）
            { x: 6000, y: 3000, w: 2500, h: 100 },
            { x: 6000, y: 6000, w: 2500, h: 100 },
            { x: 8400, y: 3000, w: 100, h: 3000 },
            // 左上房间（2500x2500）
            { x: 500, y: 500, w: 2500, h: 100 },
            { x: 500, y: 500, w: 100, h: 2500 },
            { x: 3000, y: 500, w: 100, h: 2500 },
            // 左下房间（2500x2500）
            { x: 500, y: 8400, w: 2500, h: 100 },
            { x: 500, y: 6000, w: 100, h: 2500 },
            { x: 3000, y: 6000, w: 100, h: 2500 },
            // 右上房间（2500x2500）
            { x: 6000, y: 500, w: 2500, h: 100 },
            { x: 8400, y: 500, w: 100, h: 2500 },
            { x: 6000, y: 500, w: 100, h: 2500 },
            // 右下房间（2500x2500）
            { x: 6000, y: 8400, w: 2500, h: 100 },
            { x: 8400, y: 6000, w: 100, h: 2500 },
            { x: 6000, y: 6000, w: 100, h: 2500 },
        ];
        for (const w of walls) {
            ctx.fillRect(w.x, w.y, w.w, w.h);
        }

        Renderer.terrainTexture = canvas;
        if (window.__phaserScene) window.__phaserScene.syncTerrain();

        // 设置墙壁系统
        WallSystem.init(scene.width, scene.height);
        WallSystem.walls = walls;

        // 放置玩家到中心
        if (player) {
            player.x = scene.width / 2;
            player.y = scene.height / 2;
            Game.entities.set('player', player);
            Camera.follow(player);
        }

        // 添加返回传送门
        const portal = new Portal(scene.width / 2, scene.height - 100, 'main', '返回主神空间');
        Game.entities.set('portal_return', portal);

        // 古堡怪物：以玩家为中心，半径3000~4000px环形区域随机生成，每种5个
        const monsterTypes = [BlackWolf];
        const typeNames = ['black_wolf'];
        const playerX = player ? player.x : scene.width / 2;
        const playerY = player ? player.y : scene.height / 2;
        for (let t = 0; t < monsterTypes.length; t++) {
            for (let i = 0; i < 25; i++) {
                let mx, my, distToPlayer;
                let attempts = 0;
                do {
                    const angle = Math.random() * Math.PI * 2;
                    const radius = 3000 + Math.random() * 1000;
                    mx = playerX + Math.cos(angle) * radius;
                    my = playerY + Math.sin(angle) * radius;
                    mx = Math.max(100, Math.min(scene.width - 100, mx));
                    my = Math.max(100, Math.min(scene.height - 100, my));
                    const dx = mx - playerX;
                    const dy = my - playerY;
                    distToPlayer = Math.sqrt(dx * dx + dy * dy);
                    attempts++;
                } while (distToPlayer < 2500 && attempts < 10);
                const monster = new monsterTypes[t](mx, my);
                Game.entities.set(`scene4_${typeNames[t]}_${i}`, monster);
            }
        }

        // 同步快捷栏
        if (player) {
            QuickBar.refreshSpecialAttack(player);
        }
    },

    delay(ms) {
        return new Promise(resolve => TimerManager.setTimeout(resolve, ms));
    },

    _loadScene5(player) {
        const scene = this.scenes.scene5;
        const worldSize = this._resolveWorldSize(scene);
        CONFIG.WORLD_WIDTH = worldSize.width;
        CONFIG.WORLD_HEIGHT = worldSize.height;

        // 灰色地形纹理
        const canvas = document.createElement('canvas');
        canvas.width = scene.width;
        canvas.height = scene.height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(0, 0, scene.width, scene.height);
        // 网格纹理
        ctx.strokeStyle = 'rgba(100, 100, 100, 0.1)';
        ctx.lineWidth = 1;
        for (let x = 0; x < scene.width; x += 50) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, scene.height); ctx.stroke();
        }
        for (let y = 0; y < scene.height; y += 50) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(scene.width, y); ctx.stroke();
        }
        Renderer.terrainTexture = canvas;
        if (window.__phaserScene) window.__phaserScene.syncTerrain();

        // 墙壁系统
        WallSystem.init(scene.width, scene.height);
        WallSystem.walls = [
            { x: -10, y: -10, w: scene.width + 20, h: 10 },
            { x: -10, y: scene.height, w: scene.width + 20, h: 10 },
            { x: -10, y: -10, w: 10, h: scene.height + 20 },
            { x: scene.width, y: -10, w: 10, h: scene.height + 20 }
        ];
        // 添加一些障碍物（方块），数量随场景面积等比例增加
        const obstacleCount = Math.floor(15 * (scene.width * scene.height) / (1530 * 760));
        for (let i = 0; i < obstacleCount; i++) {
            const wx = 200 + Math.random() * (scene.width - 400);
            const wy = 100 + Math.random() * (scene.height - 200);
            const ww = 40 + Math.random() * 80;
            const wh = 40 + Math.random() * 80;
            WallSystem.walls.push({ x: wx, y: wy, w: ww, h: wh });
        }

        // 放置玩家
        if (player) {
            let px = scene.width / 2;
            let py = scene.height / 2;
            // 检查玩家位置是否在墙壁内，如果是则重新选择
            if (WallSystem && WallSystem.canMoveTo) {
                const playerRadius = player.groundRadius;
                let attempts = 0;
                while (!WallSystem.canMoveTo(px, py, playerRadius) && attempts < 50) {
                    px = 100 + Math.random() * (scene.width - 200);
                    py = 100 + Math.random() * (scene.height - 200);
                    attempts++;
                }
                if (attempts >= 50) {
                    console.warn('[scene5] 无法为玩家找到安全位置，使用默认位置');
                }
            }
            player.x = px;
            player.y = py;
            Game.entities.set('player', player);
            Camera.follow(player);
        }

        // 返回传送门
        const portal = new Portal(scene.width / 2, scene.height - 50, 'main', '返回主神空间');
        Game.entities.set('portal_return', portal);

        if (player) QuickBar.refreshSpecialAttack(player);
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
        // 平材质地面（泥/沙）不用"独立菱形石板"拼接（草苔盖缝失效后会露黑边/硬接缝）：
        // 改走连续无缝纹理——floor_mud_seamless 按世界坐标对齐相位全图铺贴（任意方向无接缝），
        // 沙地以软边补丁混入（sandPatches 径向渐隐），荒漠植物由 deco 层固定朝向点缀。
        // 基地固定沙地（2026-08-16）：scene.baseSand（缺省=基地中心）铺一块 ~1700px
        // 软边大沙地，保证基地菱形房及其围墙整体落在"沙漠贴图"上（随机沙地不可控）。
        const baseSand = scene.baseSand || {
            x: DEFENSE_CONFIG.base.x,
            y: DEFENSE_CONFIG.base.y,
            size: 1700,
        };
        setDungeonFloorProfile({
            tiles: ['floor_mud_seamless'],
            continuous: true,
            glow: false,
            backgroundColor: '#0d1b0a',
            sandPatches: {
                texture: 'floor_sand_seamless',
                perChunk: 6,
                size: 760,
                minDist: 1000,
                fixed: [baseSand],
            },
            deco: {
                textures: ['deco_desert_1', 'deco_desert_2', 'deco_desert_3', 'deco_desert_4'],
                seed: floorSeed,
                perChunk: 28,
                size: 110,
                minDist: 120,
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
            if (r.passiveEnergy > 0) lines.push([`能源回收矩阵 +${r.passiveEnergy} 能源`, '#7fd4ff']);
            if (r.titheEnergy > 0) lines.push([`牧师什一税 +${r.titheEnergy} 能源`, '#c9a0ff']);
            if (r.unitsProduced > 0) lines.push([`新兵报到 +${r.unitsProduced}`, '#8ad0ff']);
            if (r.abilitiesCompleted.length > 0) lines.push([`研究/能力完成 ${r.abilitiesCompleted.length} 项`, '#c9a0ff']);
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
     * - 排除带：基地房矩形外扩 / 玩家 / 能源点 / 刷怪点；间距 minDist（允许适度成林）；
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
        const rNode = ex.energyNode ?? 140;
        const rSpawn = ex.spawnPoint ?? 180;
        const variants = ['saguaro2arm', 'saguaro1arm', 'barrel', 'cholla'];
        // 菱形地块（与 _loadScene8 同口径，_scene8Diamond v2 边斜率 0.5 与视角平行）：
        // 仙人掌只撒在菱形内，避免长在区外黑地里
        const dFloor = this._scene8Diamond(scene);
        const inDiamond = (x, y) => !dFloor || (Math.abs(x - dFloor.cx) / dFloor.rx + Math.abs(y - dFloor.cy) / dFloor.ry <= 1);
        const nodeClusters = (ENERGY_CONFIG && ENERGY_CONFIG.clusters) || [];
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
            if (nodeClusters.some((c) => Math.hypot(fx - c.x, fy - c.y) < (c.spread ?? 150) + rNode)) continue;
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

    /** 世界-123（场景九）：复用世界-122的尺寸、菱形边界与地面视角，只承载雪地地块。 */
    _loadScene9(player) {
        clearDecoClearZones();
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
        setDungeonFloorProfile({
            tiles: ['floor_snow_fresh_seamless'],
            continuous: true,
            glow: false,
            backgroundColor: scene.background || '#101a2b',
            surfacePatches: [
                { texture: 'floor_snow_packed_seamless', perChunk: 4, size: 920, minDist: 1150 },
                { texture: 'floor_snow_wind_seamless', perChunk: 5, size: 620, minDist: 820 },
            ],
            // 雪地草/蕨已缩至荒漠点缀物的 50%：128² 成品、55px 显示；不参与碰撞。
            deco: {
                textures: ['deco_snow_1', 'deco_snow_2', 'deco_snow_3', 'deco_snow_4', 'deco_snow_5'],
                // 同一位面世代固定 seed；重建传送门后换新布局。
                seed: floorSeed,
                perChunk: 14,
                size: 55,
                minDist: 120,
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
            const savedPos = Game._worldPlayerPos?.scene9;
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
        this._setupPersistentWorld('scene9', player, diamond);
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

        // 与僵尸地牢高级完全相同的地砖池和随机等距拼铺方式，只改为大世界分块烘焙。
        setDungeonFloorProfile({
            tiles: ['blackbrick_7', 'blackbrick_8'],
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

    /** scene8~scene11 共用的建筑、资源、快照与入侵运行时。 */
    _setupPersistentWorld(sceneId, player, diamond) {
        DefenseSystem.setup(player, { managedExternally: true, worldId: sceneId });
        const generation = WorldProgressionSystem.getWorldGenerationContext(sceneId);
        if (generation.resourceRule === 'none') EnergyNodeSystem.teardown();
        else EnergyNodeSystem.setup({
            random: WorldProgressionSystem.createWorldRandom(sceneId, `resources:${generation.resourceRule}`),
        });
        HamsterHutSystem.setup();
        HamsterBarracksSystem.setup();
        ProducerBuildingSystem.setup();
        HamsterMinerSystem.setup(player);

        let result = null;
        if (getWorldSnapshot(sceneId)) result = applyWorldSnapshot(sceneId);
        const portal = this._ensureWorldPortalEntity(sceneId, diamond);
        DefenseSystem.base = portal;
        window.WorldInvasionSystem?.onWorldLoaded?.(sceneId, portal, diamond);
        this._announceWorld122Report(player, result);
    },

    _ensureWorldPortalEntity(sceneId, diamond) {
        const portalState = WorldProgressionSystem.getPortalState(sceneId);
        if (!portalState.everConstructed) return null;
        let portal = (ProducerBuildingSystem.buildings || []).find((building) => building?.cfgKey === 'portal');
        if (!portal) {
            const worldCfg = WorldProgressionSystem.getWorldConfig(sceneId) || {};
            const spawn = worldCfg.portalSpawn || { x: diamond?.cx || CONFIG.WORLD_WIDTH / 2, y: diamond?.cy || CONFIG.WORLD_HEIGHT / 2 };
            portal = new ProducerBuilding(spawn.x, spawn.y, {
                id: `world_portal_${sceneId}`,
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
        const worldEpoch = WorldProgressionSystem.getWorldEpoch(sceneId);
        const tx = this._beginWorldDestructionTransaction(sceneId, worldEpoch);
        if (WorldProgressionSystem.shouldClearWorldScope(sceneId, 'snapshot')) {
            resetWorldSnapshot(sceneId);
        }
        if (WorldProgressionSystem.shouldClearWorldScope(sceneId, 'playerPosition')
            && Game?._worldPlayerPos) delete Game._worldPlayerPos[sceneId];
        // 后台位面失守时玩家可能正在主城：立即撤掉已断线的主城入口，
        // 不等下一次切场景才刷新传送网络。
        if (this.currentScene === 'main') Game.syncMainHubWorldPortals?.();
        const occupied = this.currentScene === sceneId
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

