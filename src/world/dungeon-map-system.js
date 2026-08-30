
import { Game } from '../game.js';
import { pathFinder } from '../ai/pathfinder.js';

import { SceneManager } from '../world/scene-manager.js';
import { Camera } from '../world/camera.js';
import { Input } from '../ui/input.js';
/**
 * ============================================================
 * DungeonMapSystem — 地牢地图系统（杀戮尖塔风格 · 可拖动大地图）
 * ============================================================
 *
 * 集成点（3 处）：
 *   1. scene-manager.js _loadScene7() 末尾：DungeonMapSystem.init("scene7", player)
 *   2. game.js update() 开头：拦截地图模式，让 DungeonMapSystem 接管
 *   3. game.js render() 开头：拦截地图模式，渲染节点网格而非游戏实体
 *
 * 依赖（全局）：
 *   Renderer, Camera, WallSystem, Game, Input, EffectManager,
 *   NPCDialogue, SceneManager, CONFIG, Enemy, FloatingTextEffect,
 *   RewardSystem, pathFinder
 */

import { FloatingTextEffect } from '../effects/floating-text.js';

import { ZombieDungeonMapGenerator, ZOMBIE_DUNGEON_CONFIG, ZombieDungeonCombat, ZOMBIE_FACTORY_MAP, createTombstone } from './zombie-dungeon.js';
import { expandDungeonEnemyDependencies } from './dungeon-enemy-preload.js';
import { AgentInvasionSystem } from './agent-invasion-system.js';
import { TrapSystem } from './trap-system.js';
import { WallGate } from './wall-gate.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import { loadImage } from '../utils/image-loader.js';
import { MINE_ROUTE_LANDMARKS, getMineRouteSlots, projectMineRouteNodes, buildMineRouteEdgePaths, mineRoutePathMidpoint } from '../config/mine-route-landmarks.js';
import { buildRouteBundles, routePathLength, sampleRoutePath } from '../ui/dungeon-route-bundles.js';
import { buildExpeditionLayout } from '../ui/dungeon-expedition-layout.js';
import { DungeonExplorationConsole } from '../ui/dungeon-exploration-console.js';
import { anchorRect } from '../utils/layout.js';

/** 路线选择界面区域 spec（1920×1080 基准；比例固定不随分辨率变化）：
 *  下区地图 = 60%（648/1080），上区背景 = 40%（432/1080）；
 *  left/bottom 零边距 + height 按视口等比缩放 → 任意分辨率下都是 40/60 分界 */
const MAP_AREA_SPEC = { left: 0, bottom: 0, width: 1920, height: 648 };
// 地牢等级 → 稀有度档（与出征祭品门槛同序：F=普通、E=优质、D=稀有、C=史诗、B=神话、A=传说）
import { clearTributeBuffs, getMoonshadowConfig } from '../config/tribute-effects.js';
import { DungeonFogOfWar } from './dungeon-map-generator.js';
import { CombatRoomSystem } from './combat-room-system.js';
import { ChestRoomSystem } from './chest-room-system.js';
import { setDungeonFloorProfile } from './dungeon-floor-texture.js';
import { WallSystem } from './wall-system.js';
import { BossRewardSystem } from './boss-reward-system.js';
import { RARITY_ORDER, getRarityLabel } from '../config/rarity.js';
import { COMBAT_FORMULAS } from '../config/combat-formulas.js';
import { EffectManager } from '../effects/effect-manager.js';
import { getElement, getElementIfExists } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { setCurrentDungeonType, getRoomClearBonus, getStreakMultiplier, getRoomExpEstimate, getDungeonExpBase } from '../config/exp-system.js';
import { DungeonRunStats } from './dungeon-run-stats.js';
import { isWallPrefabsLoaded, loadWallPrefabs, whenWallPrefabsLoaded } from './wall-prefabs.js';
import { RuntimeAssetManager } from '../phaser/assets/runtime-asset-manager.js';

import { GoldManager } from '../systems/gold-manager.js';
import { getDungeonRewardRule } from '../config/dungeon-rewards.js';

const ENEMY_TYPE_BY_FACTORY = new Map(
    Object.entries(ZOMBIE_FACTORY_MAP).map(([type, factory]) => [factory, type])
);

export const DungeonMapSystem = {
    active: false,
    state: "idle",
    player: null,
    sceneId: null,
    dungeonType: 'default', // 'default' | 'zombie'

    nodes: [],
    edges: [],
    currentNodeId: null,
    previousNodeId: null,
    visitedNodeIds: new Set(),
    hoveredNodeId: null,

    // 地图尺寸（比屏幕大，可拖动）
    MAP_WIDTH:  2048,
    MAP_HEIGHT: 2048,
    COLUMN_COUNT: 12,
    NODE_RADIUS: 24,

    // 拖动与缩放状态（dragStartX/Y 初始必须为 undefined：onMouseMove 以其是否为
    // undefined 判断是否处于"按住"状态，置 0 会导致未按住鼠标地图也跟着拖）
    mapOffsetX: 0,
    mapOffsetY: 0,
    mapScale: 1.0,
    isDragging: false,
    dragStartX: undefined,
    dragStartY: undefined,
    dragStartOffsetX: 0,
    dragStartOffsetY: 0,
    _mouseDownTime: 0,
    _mouseDownPos: { x: 0, y: 0 },
    _routePointerRegion: null,
    _pendingRouteClick: null,
    _eventListeners: [],
    _observerSuspended: false,
    _observerHiddenUi: null,
    _mapAnimT: 0, // 地图动画时钟（ms 累计：流动虚线/呼吸环/脉冲）

    // 地图缩放范围与初始倍数（路线栏的全图/聚焦操作共用，勿再散落硬编码）
    MIN_MAP_SCALE: 0.3,
    MAX_MAP_SCALE: 3,
    DEFAULT_ZOOM_FACTOR: 3,
    ROUTE_SECTOR_COLUMN_SPAN: 4,
    ROUTE_FOCUS_MIN_SCALE: 0.72,
    routeViewMode: 'focus',
    routeSectorIndex: 0,

    TYPE_COLORS: {
        start:  "#202b31",
        combat: "#2b2428",
        event:  "#2c2a24",
        boss:   "#301f25",
        reward: "#292635",
        empty:  "#22282d",
    },
    TYPE_BORDER_COLORS: {
        start:  "#7fc7b0",
        combat: "#c27378",
        event:  "#c8ad70",
        boss:   "#df6b75",
        reward: "#9e88c4",
        empty:  "#75838b",
    },
    TYPE_ICONS: {
        start:  "起",
        combat: "战",
        event:  "?",
        boss:   "首",
        reward: "赏",
        empty:  "·",
    },
    ROUTE_NODE_ICON_PATHS: {
        start: 'assets/ui/dungeon-map/cold-steel-v2/route-node-start.png',
        combat: 'assets/ui/dungeon-map/cold-steel-v2/route-node-combat.png',
        elite: 'assets/ui/dungeon-map/cold-steel-v2/route-node-elite.png',
        event: 'assets/ui/dungeon-map/cold-steel-v2/route-node-event.png',
        boss: 'assets/ui/dungeon-map/cold-steel-v2/route-node-boss.png',
        reward: 'assets/ui/dungeon-map/cold-steel-v2/route-node-reward.png',
        unknown: 'assets/ui/dungeon-map/cold-steel-v2/route-node-unknown.png',
    },
    LANDMARK_ROUTE_PROFILES: {
        ...MINE_ROUTE_LANDMARKS,
        // 与正式1920×1080母图共用像素坐标：每一列的 upper/lower 都落在桥面、
        // 门厅、阶梯或城墙通道上。聚焦区段把自身列数均匀投影到这六条结构带。
        'assets/scenes/dungeon-map-bg-horror-landmark-v3.png': {
            width: 1920,
            height: 1080,
            columns: [
                { upper: { x: 430, y: 600 }, lower: { x: 410, y: 860 } },
                { upper: { x: 700, y: 520 }, lower: { x: 620, y: 800 } },
                { upper: { x: 900, y: 430 }, lower: { x: 820, y: 790 } },
                { upper: { x: 1100, y: 330 }, lower: { x: 990, y: 730 } },
                { upper: { x: 1280, y: 270 }, lower: { x: 1190, y: 650 } },
                { upper: { x: 1510, y: 380 }, lower: { x: 1430, y: 720 } },
            ],
        },
        'assets/scenes/dungeon-map-horror-landmarks/horror-landmark-01-citadel.png': {
            width: 1672,
            height: 941,
            bounds: { left: 270, top: 145, right: 1515, bottom: 835 },
            topology: { branchDensity: 0.22, columnLoad: 0.48, verticality: 0.24, rowSpread: 0.46 },
            columns: [
                { upper: { x: 330, y: 535 }, lower: { x: 330, y: 780 } },
                { upper: { x: 565, y: 470 }, lower: { x: 510, y: 700 } },
                { upper: { x: 780, y: 400 }, lower: { x: 700, y: 645 } },
                { upper: { x: 970, y: 330 }, lower: { x: 890, y: 590 } },
                { upper: { x: 1190, y: 340 }, lower: { x: 1090, y: 540 } },
                { upper: { x: 1450, y: 300 }, lower: { x: 1325, y: 500 } },
            ],
        },
        'assets/scenes/dungeon-map-horror-landmarks/horror-landmark-02-flooded-cathedral.png': {
            width: 1672,
            height: 941,
            bounds: { left: 270, top: 145, right: 1515, bottom: 835 },
            topology: { branchDensity: 0.38, columnLoad: 0.68, verticality: 0.42, rowSpread: 0.64 },
            columns: [
                { upper: { x: 330, y: 410 }, lower: { x: 330, y: 760 } },
                { upper: { x: 560, y: 350 }, lower: { x: 520, y: 660 } },
                { upper: { x: 770, y: 350 }, lower: { x: 700, y: 610 } },
                { upper: { x: 970, y: 320 }, lower: { x: 890, y: 560 } },
                { upper: { x: 1190, y: 280 }, lower: { x: 1080, y: 510 } },
                { upper: { x: 1450, y: 260 }, lower: { x: 1320, y: 470 } },
            ],
        },
        'assets/scenes/dungeon-map-horror-landmarks/horror-landmark-03-necropolis.png': {
            width: 1672,
            height: 941,
            bounds: { left: 270, top: 145, right: 1515, bottom: 835 },
            topology: { branchDensity: 0.46, columnLoad: 0.78, verticality: 0.30, rowSpread: 0.74 },
            columns: [
                { upper: { x: 320, y: 300 }, lower: { x: 300, y: 770 } },
                { upper: { x: 540, y: 340 }, lower: { x: 500, y: 675 } },
                { upper: { x: 750, y: 325 }, lower: { x: 690, y: 610 } },
                { upper: { x: 960, y: 315 }, lower: { x: 870, y: 570 } },
                { upper: { x: 1190, y: 275 }, lower: { x: 1080, y: 520 } },
                { upper: { x: 1450, y: 235 }, lower: { x: 1320, y: 475 } },
            ],
        },
        'assets/scenes/dungeon-map-horror-landmarks/horror-landmark-04-quarantine-foundry.png': {
            width: 1672,
            height: 941,
            bounds: { left: 270, top: 145, right: 1515, bottom: 835 },
            topology: { branchDensity: 0.32, columnLoad: 0.62, verticality: 0.56, rowSpread: 0.58 },
            columns: [
                { upper: { x: 330, y: 430 }, lower: { x: 320, y: 760 } },
                { upper: { x: 560, y: 350 }, lower: { x: 500, y: 650 } },
                { upper: { x: 760, y: 330 }, lower: { x: 700, y: 570 } },
                { upper: { x: 980, y: 300 }, lower: { x: 900, y: 530 } },
                { upper: { x: 1210, y: 280 }, lower: { x: 1100, y: 500 } },
                { upper: { x: 1450, y: 240 }, lower: { x: 1320, y: 455 } },
            ],
        },
        'assets/scenes/dungeon-map-horror-landmarks/horror-landmark-05-plague-ramparts.png': {
            width: 1672,
            height: 941,
            bounds: { left: 270, top: 145, right: 1515, bottom: 835 },
            topology: { branchDensity: 0.26, columnLoad: 0.52, verticality: 0.34, rowSpread: 0.52 },
            columns: [
                { upper: { x: 300, y: 360 }, lower: { x: 300, y: 750 } },
                { upper: { x: 520, y: 330 }, lower: { x: 500, y: 650 } },
                { upper: { x: 750, y: 290 }, lower: { x: 700, y: 570 } },
                { upper: { x: 980, y: 250 }, lower: { x: 900, y: 510 } },
                { upper: { x: 1220, y: 220 }, lower: { x: 1100, y: 440 } },
                { upper: { x: 1480, y: 190 }, lower: { x: 1370, y: 360 } },
            ],
        },
    },
    _routeNodeIconImages: null,
    _landmarkProjectionCache: null,
    _activeLandmarkBackgroundPath: null,
    _mineRouteLayoutCache: null,
    _showAllRouteEdges: false,
    _routeColorCache: null,

    COMBAT_ROOM_SIZE: 1024,
    BOSS_ROOM_SIZE:   1024,
    WALL_THICKNESS:   20,

    // 视口与布局常量
    DEFAULT_VIEWPORT_WIDTH:  1920,
    DEFAULT_VIEWPORT_HEIGHT: 1080,
    MAP_MARGIN_X: 280,
    MAP_MARGIN_Y: 120,

    get CENTER_X() { return this.COMBAT_ROOM_SIZE / 2; },
    get CENTER_Y() { return this.COMBAT_ROOM_SIZE / 2; },
    FLOAT_TEXT_X: 512,
    FLOAT_TEXT_Y: 400,

    // 战斗奖励常量
    BOSS_GOLD_REWARD: 300,
    COMBAT_GOLD_BASE: 50,
    COMBAT_GOLD_BONUS: 100,

    _backupWalls: [],
    _backupCameraFollow: null,
    _combatMonsters: [],
    _combatMonsterKeys: [],
    _combatRoomWalls: [],
    _combatCheckTimer: 0,
    _eventOverlay: null,

    // 僵尸地牢专用：波次管理
    _zombieCombat: null,
    _zombieWaveActive: false,
    _zombieCombatNode: null,
    _pendingZombieWave: null,
    _enemyLoadToken: 0,

    // 出口传送门（战斗结束后生成）
    _exitPortalSpawned: false,

    init(sceneId, player, dungeonType = 'default') {
        this.active = true;
        this._observerSuspended = false;
        this._observerHiddenUi = null;
        this.state = "map";
        this.sceneId = sceneId;
        this.player = player;
        this.dungeonType = dungeonType;
        this._runResultRecorded = false;
        // 蟠桃使用次数由全局30分钟献祭状态持有，进入新地牢不再重置。
        if (this.player) {
            this.player._peachRevivePending = false;
        }
        // 经验系统：注入当前地牢类型（exp-system 计算怪物经验/压级衰减的上下文）
        setCurrentDungeonType(dungeonType);
        const dungeonList = DungeonConfig.getDungeonList();
        this.dungeonName = (dungeonList[dungeonType] && dungeonList[dungeonType].name) || ZOMBIE_DUNGEON_CONFIG.name;
        this.currentNodeId = null;
        this.visitedNodeIds.clear();
        this.hoveredNodeId = null;
        this.routeViewMode = 'focus';
        this.routeSectorIndex = 0;
        this._showAllRouteEdges = false;
        this._routeColorCache = null;
        this._expeditionLayoutCache = null;
        this._landmarkProjectionCache = null;
        this._activeLandmarkBackgroundPath = null;
        this._mineRouteLayoutCache = null;
        this._preloadRouteNodeIcons();
        this._combatMonsters = [];
        this._combatMonsterKeys = [];
        this._combatRoomWalls = [];
        this._combatCheckTimer = 0;
        this._zombieCombat = null;
        this._zombieWaveActive = false;
        this._zombieCombatNode = null;
        this._pendingZombieWave = null;
        this._enemyLoadToken++;
        this._waveTransitioning = false;
        this._exitPortalSpawned = false;
        // 宝箱离场确认框状态复位（与 shutdown 同口径，防上一局残留）
        this._chestLeaveConfirm = false;
        this._chestLeaveCd = 0;
        const staleChestConfirm = getElementIfExists('chestLeaveConfirm');
        if (staleChestConfirm) staleChestConfirm.remove();

        // 初始化迷雾系统
        this.fogOfWar = new DungeonFogOfWar();
        // 时空特工追击机制（D 级及以上地牢；内部按难度判定是否启用）
        AgentInvasionSystem.init(this);
        // 单局统计（通关结算面板数据源）：击杀/经验/节点清理
        DungeonRunStats.reset();
        // 连续地貌配置：僵尸/沼泽三档每次入场刷新视觉小件 seed；同一次入场重烘焙保持稳定。
        const dungeonCfg = DungeonConfig.getZombieDungeonConfig(dungeonType);
        const floorProfile = DungeonConfig.getDungeonFloorProfile(dungeonType);
        if (floorProfile?.deco) {
            floorProfile.deco = {
                ...floorProfile.deco,
                seed: Math.floor(Math.random() * 0x100000000) >>> 0,
            };
        }
        setDungeonFloorProfile(floorProfile);
        // 墙样式（按地牢类型：僵尸砖墙 / 沼泽柴墙+藤门；离开时恢复默认）
        WallSystem.setWallStyle(dungeonCfg.wallStyle || dungeonType);
        // 墙预制库加载补发（BootScene 已 fire-and-forget 预载；此处幂等补发，
        // 让加载最迟在进地牢时已发起——仍未就绪时 _enterCombatArena 会等加载完成再构建）
        loadWallPrefabs();

        this.generateMap();
        this._selectLandmarkRouteBackground();
        this._centerRouteMap();
        this.isDragging = false;
        this.dragStartX = undefined;
        this.dragStartY = undefined;
        this._routePointerRegion = null;
        this._pendingRouteClick = null;

        const startNode = this.nodes.find(n => n.type === "start");
        if (startNode) {
            this.currentNodeId = startNode.id;
            this.visitedNodeIds.add(startNode.id);
            this.fogOfWar.visit(startNode.id, this.nodes, this.edges);
        }

        this._backupCameraFollow = Camera.follow.bind(Camera);
        Camera.follow = () => {};
        Camera.x = this.CENTER_X;
        Camera.y = this.CENTER_Y;

        this._bindEvents();

        // 初始化时显示地图界面元素与地牢名称（入侵几率标签由 AgentInvasionSystem 管理）
        this._createDungeonRewardPanel();
        this._createAbandonButton();
        this._createDungeonNameLabel();
        // 地图选路模式顶部状态栏（生命/魔法/等级）
        this._createMapStatusBar();
        // 路线区段属于表现增强，不能阻断地牢进入主链。
        // 若聚焦计算或 DOM 控制栏初始化异常，保留完整基础路线图继续进入。
        this._initializeRoutePresentation();

        
    },

    shutdown() {
        if (this.active && !this._runResultRecorded) this._recordRunResult('failed');
        this.active = false;
        this._enemyLoadToken++;
        this._pendingZombieWave = null;
        getElementIfExists('dungeonEnemyLoadFailure')?.remove();
        RuntimeAssetManager.setDungeonEnemyTypes([]);
        this.setWorldObservationSuspended(false);
        this.state = "idle";
        this._routePointerRegion = null;
        this._pendingRouteClick = null;
        // 经验系统：离开地牢，回退主神空间口径（F 档）
        setCurrentDungeonType(null);
        this.nodes = [];
        this.edges = [];
        this._expeditionLayoutCache = null;
        this._activeLandmarkBackgroundPath = null;
        this._mineRouteLayoutCache = null;
        this._landmarkProjectionCache = null;
        this._cleanupEventUI();
        this._removeDungeonRewardPanel();
        this._removeAbandonButton();
        this._removeDungeonNameLabel();
        this._removeMapStatusBar();
        this._removeRouteControls();
        this._removeRouteTopHud();
        this._removeNodeTooltip();
        // 通关结算面板兜底移除（异常退出路径）
        const victoryOverlay = getElementIfExists('dungeonVictoryOverlay');
        if (victoryOverlay) victoryOverlay.remove();
        const exitConfirm = getElementIfExists('dungeonExitConfirm');
        if (exitConfirm) exitConfirm.remove();
        this._unbindEvents();
        // 时空特工追击机制复位（含几率显示）
        AgentInvasionSystem.reset();
        this._invasionNode = null;
        this._invasionMixed = false;
        // 宝箱离场确认框：死亡/shutdown 路径必须移除 DOM 并复位标记——否则 _chestLeaveConfirm
        // 卡 true，下局地牢门区判定（updateCombat 两分支均以 !this._chestLeaveConfirm 为前提）
        // 永远不进 _leaveCombatViaPortal，玩家出不了战斗房（软锁）+ 全屏 overlay 残留主神空间
        this._chestLeaveConfirm = false;
        this._chestLeaveCd = 0;
        const chestConfirmEl = getElementIfExists('chestLeaveConfirm');
        if (chestConfirmEl) chestConfirmEl.remove();
        // 地板配置恢复默认（离开地牢）
        setDungeonFloorProfile(null);
        // 墙样式恢复默认（离开地牢）
        WallSystem.setWallStyle('default');

        // 死亡/异常退出时强制清理 Boss 战与战斗房，防止 active 卡死造成软锁
        if (typeof BossRewardSystem !== 'undefined' && BossRewardSystem && typeof BossRewardSystem.cleanup === 'function') {
            BossRewardSystem.cleanup();
        }
        if (typeof CombatRoomSystem !== 'undefined' && CombatRoomSystem && CombatRoomSystem.active && typeof CombatRoomSystem.cleanupRoom === 'function') {
            CombatRoomSystem.cleanupRoom();
        }
        // 地牢离场只清除地牢专用特效图标；位面祭坛的30分钟效果继续按全局时间生效。
        const tributePlayer = this.player || (typeof window !== 'undefined' && window.Game ? window.Game.player : null);
        if (tributePlayer) clearTributeBuffs(tributePlayer);

        // 重新计算玩家属性，移除祭品带来的临时加成
        const player = this.player || (typeof window !== 'undefined' && window.Game ? window.Game.player : null);
        if (player && typeof player.calculateCombatStats === 'function') {
            player.calculateCombatStats();
        }

        // 清理地牢事件系统
        import('./dungeon-event-system.js').then(mod => {
            if (mod.onDungeonEnd) mod.onDungeonEnd(this.player);
            if (mod.DungeonEventSystem) mod.DungeonEventSystem.cleanup();
        }).catch(() => {});

        if (this._backupCameraFollow) {
            Camera.follow = this._backupCameraFollow;
        }
        if (this.player) {
            Camera.follow(this.player);
        }
    },

    /**
     * 世界面板观察其他位面时只暂停地牢现场的交互与显示，不结束本次探险。
     * 路线、战斗实体、祭品和本局入侵登记状态由 SceneManager 另行暂存并在返回时恢复。
     */
    setWorldObservationSuspended(suspended) {
        const next = !!suspended;
        if (next === this._observerSuspended) return;
        this._observerSuspended = next;
        if (typeof document === 'undefined') return;
        if (next) {
            this.isDragging = false;
            this.dragStartX = undefined;
            this.dragStartY = undefined;
            this._routePointerRegion = null;
            this._pendingRouteClick = null;
            this._observerHiddenUi = new Map();
            const selector = '[id^="dungeon"], #abandonButton, #safeEvacButton, #invasionChanceLabel, #chestLeaveConfirm';
            document.querySelectorAll(selector).forEach((el) => {
                this._observerHiddenUi.set(el, el.style.display);
                el.style.display = 'none';
            });
            return;
        }
        if (this._observerHiddenUi) {
            for (const [el, display] of this._observerHiddenUi) {
                if (el?.isConnected) el.style.display = display;
            }
        }
        this._observerHiddenUi = null;
        if (!this.active) return;
        if (this.state === 'map') {
            this._createDungeonRewardPanel();
            this._createAbandonButton();
            this._updateSafeEvacButton();
            this._createDungeonNameLabel();
            this._createMapStatusBar();
            this._createRouteControls();
            this._setMapInfoVisibility(true);
        }
    },

    /** 每次探险只登记一次；成功/失败/撤离/放弃都推进对应难度的全局入侵进度。 */
    _recordRunResult(outcome) {
        if (this._runResultRecorded || !this.dungeonType) return null;
        this._runResultRecorded = true;
        const grade = DungeonConfig.getDungeonGrade(this.dungeonType) || 'F';
        return window.WorldInvasionSystem?.recordDungeonRun?.(this.dungeonType, grade, outcome) || null;
    },

    // ───────────────────────────────────────────────
    // 事件绑定：拖动 + 滚轮缩放
    // ───────────────────────────────────────────────
    _bindEvents() {
        const canvas = getElement("gameCanvas");
        if (!canvas) return;

        const onMouseDown = (e) => {
            if (this._observerSuspended || SceneManager.currentScene !== this.sceneId) return;
            if (e.button !== 0 || this.state !== "map") return;
            if (this.routeViewMode === 'overview') return;
            const inMapArea = this._isInMapArea(e.clientX, e.clientY);
            // 路线节点使用地牢自己的点击边沿，不进入角色攻击/RTS 的全局 Input 链。
            if (!inMapArea) return;
            this._routePointerRegion = 'map';
            this.isDragging = false;
            this._dragMoved = false;
            this.dragStartX = inMapArea ? e.clientX : undefined;
            this.dragStartY = inMapArea ? e.clientY : undefined;
            this.dragStartOffsetX = this.mapOffsetX;
            this.dragStartOffsetY = this.mapOffsetY;
            this._mouseDownTime = Date.now();
            this._mouseDownPos = { x: e.clientX, y: e.clientY };
        };

        const onMouseMove = (e) => {
            if (this._observerSuspended || SceneManager.currentScene !== this.sceneId) return;
            if (this.state !== "map") return;
            if (this.dragStartX === undefined) return;
            // 长按才允许拖动：鼠标键在窗口外松开等情况下强制结束拖动
            if ((e.buttons & 1) === 0) {
                this.isDragging = false;
                this.dragStartX = undefined;
                this.dragStartY = undefined;
                this._routePointerRegion = null;
                return;
            }
            const dx = e.clientX - this.dragStartX;
            const dy = e.clientY - this.dragStartY;
            // 地标模式的节点与背景共用同一cover矩阵；允许点击但禁止拖离母图结构锚点。
            if (this._getLandmarkRouteProfile()) {
                if (Math.abs(dx) > 5 || Math.abs(dy) > 5) this._dragMoved = true;
                return;
            }
            if (!this.isDragging && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
                this.isDragging = true;
                this._dragMoved = true;
            }
            if (this.isDragging) {
                this.mapOffsetX = this.dragStartOffsetX + dx;
                this.mapOffsetY = this.dragStartOffsetY + dy;
                this._clampMapOffset();
            }
        };

        const onMouseUp = (e) => {
            const pointerRegion = this._routePointerRegion;
            this._routePointerRegion = null;
            if (e.button !== 0 || this._observerSuspended || SceneManager.currentScene !== this.sceneId) return;
            const releaseRegion = this._isInMapArea(e.clientX, e.clientY) ? 'map' : null;
            // 如果发生了拖动，标记本次点击为拖动，避免触发节点选择
            const wasDragging = this.isDragging || this._dragMoved;
            if (wasDragging) {
                this._dragMoved = true;
            }
            this.isDragging = false;
            this.dragStartX = undefined;
            this.dragStartY = undefined;
            // 只有同一区域内完成按下与松开、且没有拖动时，才排队一次路线点击。
            if (this.state === "map" && pointerRegion && pointerRegion === releaseRegion && !wasDragging) {
                this._pendingRouteClick = { x: e.clientX, y: e.clientY };
            }
        };

        canvas.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        // 滚轮只阻止路线区带动页面滚动；缩放由可聚焦的路线栏按钮明确控制。
        const onWheel = (e) => {
            if (this._observerSuspended || SceneManager.currentScene !== this.sceneId) return;
            if (this.state !== "map") return;
            if (!this._isInMapArea(e.clientX, e.clientY)) return;
            e.preventDefault();
        };
        canvas.addEventListener("wheel", onWheel, { passive: false });

        const onResize = () => {
            // 新探索台由自身 ResizeObserver 按真实路线窗口重定位。
            if (this._usesExplorationConsole()) return;
            if (!this.active || this.state !== 'map'
                || (!this._usesSplitRouteMap() && !this._getLandmarkRouteProfile()?.terrainRouting)) return;
            this._mineRouteLayoutCache = null;
            this._landmarkProjectionCache = null;
            this._clearRoutePointerSelection();
            if (this.routeViewMode === 'overview') this._updateRouteControls();
            else this._focusOnCurrentNode({ restoreDefaultZoom: true });
        };
        window.addEventListener('resize', onResize);

        this._eventListeners = [
            { el: canvas, type: "mousedown", fn: onMouseDown },
            { el: window, type: "mousemove", fn: onMouseMove },
            { el: window, type: "mouseup", fn: onMouseUp },
            { el: canvas, type: "wheel", fn: onWheel },
            { el: window, type: 'resize', fn: onResize },
        ];
    },

    _unbindEvents() {
        for (const { el, type, fn } of this._eventListeners) {
            el.removeEventListener(type, fn);
        }
        this._eventListeners = [];
    },

    // ───────────────────────────────────────────────
    // 地图生成：当前仅实现僵尸地牢
    // ───────────────────────────────────────────────
    generateMap() {
        this._generateZombieMap();
    },

    // 僵尸战斗管线地牢：僵尸三档、沼泽三档等由配置 family='zombie' 统一接入。
    _isZombieFamily() {
        // 数据驱动：地牢配置块 family === 'zombie' 即走僵尸家族管线（战斗/竞技场/怪物池）
        const cfg = DungeonConfig.getZombieDungeonConfig(this.dungeonType);
        return cfg.family === 'zombie';
    },

    // 僵尸地牢：rows 条路线 converging to BOSS
    _generateZombieMap() {
        const generator = new ZombieDungeonMapGenerator(undefined, this.dungeonType);
        const { nodes, edges } = generator.generate();
        this.nodes = nodes;
        this.edges = edges;
        // 固定路线选择界面尺寸为 2048×2048
        this.MAP_WIDTH = 2048;
        this.MAP_HEIGHT = 2048;
        // 重新居中（使用实际窗口尺寸动态计算）
        const viewW = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : this.DEFAULT_VIEWPORT_WIDTH;
        const viewH = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : this.DEFAULT_VIEWPORT_HEIGHT;
        const marginX = this.MAP_MARGIN_X;
        const marginY = this.MAP_MARGIN_Y;
        this.mapOffsetX = marginX + (viewW - marginX * 2 - this.MAP_WIDTH) / 2;
        this.mapOffsetY = marginY + (viewH - marginY * 2 - this.MAP_HEIGHT) / 2;
    },

    getCurrentNode() {
        return this.nodes.find(n => n.id === this.currentNodeId);
    },

    getAvailableNodes() {
        if (!this.currentNodeId) return [];
        // 双向可达：允许走回头路（含返回起始点），不再限制只能前进
        const reachableIds = new Set();
        for (const e of this.edges) {
            if (e.from === this.currentNodeId) reachableIds.add(e.to);
            if (e.to === this.currentNodeId) reachableIds.add(e.from);
        }
        return this.nodes.filter(n => reachableIds.has(n.id));
    },

    isNodeClickable(node) {
        return this.getAvailableNodes().some(n => n.id === node.id);
    },

    // ───────────────────────────────────────────────
    // 坐标转换：屏幕 → 地图
    // ───────────────────────────────────────────────
    _screenToMap(sx, sy) {
        return {
            x: (sx - this.mapOffsetX) / this.mapScale,
            y: (sy - this.mapOffsetY) / this.mapScale,
        };
    },

    _mapToScreen(mx, my) {
        return {
            x: mx * this.mapScale + this.mapOffsetX,
            y: my * this.mapScale + this.mapOffsetY,
        };
    },

    /**
     * 完整背景始终等比 cover：地标模式把场景作为全屏路线承载层，旧 full-plate
     * 仍兼容 40/60 探索底板；其余地牢继续 contain 在上方区域。
     * @param {number} topH 上方背景区高度（地图区域 top 边界）
     */
    _renderBackground(ctx, viewW, viewH, topH) {
        const bgPath = this._getMapBackgroundPath();
        if (!this._bgImg || this._bgImgPath !== bgPath) {
            this._bgImgPath = bgPath;
            this._bgImg = loadImage(bgPath);
        }
        // 先铺纯黑底（图片未加载时兜底；下方地图区域也为纯黑）
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, viewW, viewH);
        const img = this._bgImg;
        if (this._usesExplorationConsole()) {
            // contain 完整显示母图；可用高度取实际台面顶部，不让底部阶梯被台面遮住。
            const bannerH = this._explorationConsole?.bannerBottom ?? Math.round(viewH * 0.30);
            if (img?.complete && img.naturalWidth > 0) {
                const scale = Math.min(Math.max(1, viewW - 24) / img.naturalWidth,
                    Math.max(1, bannerH - 16) / img.naturalHeight);
                ctx.drawImage(img, (viewW - img.naturalWidth * scale) / 2,
                    (bannerH - img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale);
            }
            return;
        }
        if (this._usesSplitRouteMap()) {
            // 上方只承担环境展示：图片等比裁切，路线拖动不会移动背景。
            const view = this._getMapViewRect(viewW, viewH);
            ctx.save();
            ctx.beginPath();
            ctx.rect(view.left, 0, view.width, topH);
            ctx.clip();
            if (img?.complete && img.naturalWidth > 0) {
                const scale = Math.max(view.width / img.naturalWidth, topH / img.naturalHeight);
                const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
                ctx.drawImage(img, view.left + (view.width - w) / 2, (topH - h) / 2, w, h);
            }
            const shade = ctx.createLinearGradient(0, 0, 0, topH);
            shade.addColorStop(0, 'rgba(4, 8, 11, 0.58)');
            shade.addColorStop(0.42, 'rgba(4, 8, 11, 0.08)');
            shade.addColorStop(1, 'rgba(8, 13, 17, 0.92)');
            ctx.fillStyle = shade;
            ctx.fillRect(view.left, 0, view.width, topH);
            ctx.restore();
            this._positionMapButtons(viewW, viewW);
            return;
        }
        const fullMapBackground = this._usesFullMapBackground();
        if (!img || !img.complete || img.naturalWidth === 0 || (!fullMapBackground && topH <= 0)) {
            this._positionMapButtons(viewW, 0);
            return;
        }
        if (fullMapBackground) {
            const terrainLayout = this._getMineRouteLayout(viewW, viewH);
            const scale = terrainLayout?.scale || Math.max(viewW / img.naturalWidth, viewH / img.naturalHeight);
            const w = Math.ceil(img.naturalWidth * scale);
            const h = Math.ceil(img.naturalHeight * scale);
            const x = terrainLayout?.offsetX ?? Math.floor((viewW - w) / 2);
            const y = terrainLayout?.offsetY ?? Math.floor((viewH - h) / 2);
            ctx.drawImage(img, x, y, w, h);
            const landmark = this._usesLandmarkMap();
            const shade = ctx.createLinearGradient(0, 0, 0, viewH);
            shade.addColorStop(0, landmark ? 'rgba(2, 5, 7, 0.24)' : 'rgba(2, 5, 7, 0.14)');
            shade.addColorStop(0.40, landmark ? 'rgba(3, 7, 9, 0.08)' : 'rgba(3, 7, 9, 0.28)');
            shade.addColorStop(0.405, 'rgba(3, 7, 9, 0.06)');
            shade.addColorStop(1, landmark ? 'rgba(2, 5, 7, 0.30)' : 'rgba(2, 5, 7, 0.18)');
            ctx.fillStyle = shade;
            ctx.fillRect(0, 0, viewW, viewH);
            this._positionMapButtons(viewW, viewW);
            return;
        }
        // contain：min 比例 = 整图可见（不裁剪、不变形），居中放置
        const scale = Math.min(viewW / img.naturalWidth, topH / img.naturalHeight);
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const x = Math.round((viewW - w) / 2);
        const y = Math.round((topH - h) / 2);
        ctx.drawImage(img, x, y, w, h);
        // 边缘淡出：向纯黑底渐变（左右 10% 宽，上下 5% 高）
        const fadeW = Math.max(24, w * 0.10);
        const fadeH = Math.max(16, h * 0.05);
        const gLeft = ctx.createLinearGradient(x, 0, x + fadeW, 0);
        gLeft.addColorStop(0, 'rgba(0,0,0,0.92)');
        gLeft.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gLeft;
        ctx.fillRect(x, y, fadeW, h);
        const gRight = ctx.createLinearGradient(x + w, 0, x + w - fadeW, 0);
        gRight.addColorStop(0, 'rgba(0,0,0,0.92)');
        gRight.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gRight;
        ctx.fillRect(x + w - fadeW, y, fadeW, h);
        const gTop = ctx.createLinearGradient(0, y, 0, y + fadeH);
        gTop.addColorStop(0, 'rgba(0,0,0,0.70)');
        gTop.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gTop;
        ctx.fillRect(x, y, w, fadeH);
        const gBottom = ctx.createLinearGradient(0, y + h, 0, y + h - fadeH);
        gBottom.addColorStop(0, 'rgba(0,0,0,0.70)');
        gBottom.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gBottom;
        ctx.fillRect(x, y + h - fadeH, w, fadeH);
        // 三个操作按钮水平居中到各自黑幕（图片显示宽即黑幕分界；未加载时上一帧已跳过）
        this._positionMapButtons(viewW, w);
    },

    /** 路线承载层：旧模式使用冷钢底板；地标模式只加轻暗角，不遮住场景。 */
    _drawMapAreaBackground(ctx, area) {
        if (this._usesSplitRouteMap()) {
            ctx.save();
            const base = ctx.createLinearGradient(0, area.top, 0, area.top + area.height);
            base.addColorStop(0, '#111b22');
            base.addColorStop(1, '#080e12');
            ctx.fillStyle = base;
            ctx.fillRect(area.left, area.top, area.width, area.height);
            ctx.strokeStyle = 'rgba(170, 202, 215, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(area.left, area.top + 0.5);
            ctx.lineTo(area.left + area.width, area.top + 0.5);
            ctx.stroke();
            ctx.restore();
            return;
        }
        ctx.save();
        ctx.beginPath();
        ctx.rect(area.left, area.top, area.width, area.height);
        ctx.clip();
        const fullPlate = this._usesFullMapBackground();
        const landmark = this._usesLandmarkMap();
        const base = ctx.createLinearGradient(0, area.top, 0, area.top + area.height);
        base.addColorStop(0, landmark ? 'rgba(5, 10, 13, 0.03)' : (fullPlate ? 'rgba(5, 10, 13, 0.10)' : '#11171b'));
        base.addColorStop(0.58, landmark ? 'rgba(4, 8, 11, 0.06)' : (fullPlate ? 'rgba(4, 8, 11, 0.16)' : '#0b1013'));
        base.addColorStop(1, landmark ? 'rgba(2, 5, 7, 0.18)' : (fullPlate ? 'rgba(2, 5, 7, 0.28)' : '#080b0d'));
        ctx.fillStyle = base;
        ctx.fillRect(area.left, area.top, area.width, area.height);

        if (!fullPlate) {
            const major = Math.max(56, Math.round(Math.min(area.width, area.height) / 8));
            const minor = Math.max(14, Math.round(major / 4));
            for (let x = area.left; x <= area.left + area.width; x += minor) {
                const majorLine = Math.round((x - area.left) / minor) % 4 === 0;
                ctx.strokeStyle = majorLine ? 'rgba(142, 166, 178, 0.13)' : 'rgba(142, 166, 178, 0.045)';
                ctx.lineWidth = majorLine ? 1 : 0.6;
                ctx.beginPath();
                ctx.moveTo(x, area.top);
                ctx.lineTo(x, area.top + area.height);
                ctx.stroke();
            }
            for (let y = area.top; y <= area.top + area.height; y += minor) {
                const majorLine = Math.round((y - area.top) / minor) % 4 === 0;
                ctx.strokeStyle = majorLine ? 'rgba(142, 166, 178, 0.13)' : 'rgba(142, 166, 178, 0.045)';
                ctx.lineWidth = majorLine ? 1 : 0.6;
                ctx.beginPath();
                ctx.moveTo(area.left, y);
                ctx.lineTo(area.left + area.width, y);
                ctx.stroke();
            }
        }
        if (!landmark) {
            ctx.strokeStyle = fullPlate ? 'rgba(202, 224, 232, 0.46)' : 'rgba(185, 211, 221, 0.34)';
            ctx.lineWidth = fullPlate ? 1.5 : 1;
            ctx.strokeRect(area.left + 0.5, area.top + 0.5, area.width - 1, area.height - 1);
        }
        ctx.restore();
    },

    /** 当前地牢的路线选择界面背景图路径（配置驱动，含兜底） */
    _getMapBackgroundPath() {
        const cfg = DungeonConfig.getZombieDungeonConfig(this.dungeonType);
        if (this._activeLandmarkBackgroundPath && this._usesLandmarkMap()) {
            return this._activeLandmarkBackgroundPath;
        }
        return (cfg && cfg.mapBackground) || 'assets/scenes/dungeon-map-bg.png';
    },

    /** 静态母图只在单次路线生成后选择一次；同一局往返地图不会跳图。 */
    _selectLandmarkRouteBackground() {
        if (this._usesExplorationConsole()) return;
        if (!this._usesLandmarkMap()) return;
        const cfg = DungeonConfig.getZombieDungeonConfig(this.dungeonType);
        const candidates = Array.isArray(cfg?.mapBackgroundVariants)
            ? cfg.mapBackgroundVariants.filter(path => typeof path === 'string' && (this._usesSplitRouteMap() || this.LANDMARK_ROUTE_PROFILES[path]))
            : [];
        if (!candidates.length) return;

        const metrics = this._getLandmarkRouteMetrics();
        const signature = [
            this.dungeonType,
            ...this.nodes
                .map(node => `${node.id}:${node.col}:${node.row}:${node.type}`)
                .sort(),
            ...this.edges
                .map(edge => [edge.from, edge.to].sort().join('>'))
                .sort(),
        ].join('|');
        const signatureHash = this._hashRouteSignature(signature);
        if (this._usesSplitRouteMap()) {
            // 环境图不再筛选或限制玩法拓扑；同局依旧只选一次。
            this._activeLandmarkBackgroundPath = candidates[signatureHash % candidates.length];
            return;
        }
        let bestPath = candidates[signatureHash % candidates.length];
        let bestScore = Infinity;
        const weightedCandidates = [];
        const columnLoads = new Map();
        for (const node of this.nodes) columnLoads.set(node.col, (columnLoads.get(node.col) || 0) + 1);
        const maxColumnLoad = Math.max(1, ...columnLoads.values());

        candidates.forEach((path, index) => {
            const target = this.LANDMARK_ROUTE_PROFILES[path]?.topology;
            if (!target) return;
            const topologyDistance =
                Math.abs(metrics.branchDensity - target.branchDensity) * 0.34
                + Math.abs(metrics.columnLoad - target.columnLoad) * 0.28
                + Math.abs(metrics.verticality - target.verticality) * 0.23
                + Math.abs(metrics.rowSpread - target.rowSpread) * 0.15;
            // 拓扑相近时用路线指纹作稳定破同分；既让五张图都可被抽中，也避免同局闪换。
            const shift = (index * 7) % candidates.length;
            const tieBreak = ((signatureHash >>> shift) & 0xff) / 255 * 0.08;
            const score = topologyDistance + tieBreak;
            const profile = this.LANDMARK_ROUTE_PROFILES[path];
            if (cfg.mapBackgroundSelection === 'weighted-terrain' && profile.terrainRouting
                && getMineRouteSlots(profile).length >= maxColumnLoad) {
                weightedCandidates.push({ path, weight: Math.exp(-topologyDistance * 6) });
            }
            if (score < bestScore) {
                bestScore = score;
                bestPath = path;
            }
        });

        // 矿洞按匹配度加权且先过容量门槛；不是始终固定到一两张密度最高的图。
        if (weightedCandidates.length) {
            const totalWeight = weightedCandidates.reduce((sum, candidate) => sum + candidate.weight, 0);
            let choice = signatureHash / 0x100000000 * totalWeight;
            for (const candidate of weightedCandidates) {
                bestPath = candidate.path;
                choice -= candidate.weight;
                if (choice < 0) break;
            }
        }

        this._activeLandmarkBackgroundPath = bestPath;
        this._landmarkProjectionCache = null;
    },

    _getLandmarkRouteMetrics() {
        const uniqueEdges = new Map();
        for (const edge of this.edges) {
            const key = [edge.from, edge.to].sort().join('::');
            if (!uniqueEdges.has(key)) uniqueEdges.set(key, edge);
        }
        const degree = new Map(this.nodes.map(node => [node.id, 0]));
        let sameColumnEdges = 0;
        for (const edge of uniqueEdges.values()) {
            degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
            degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
            const from = this.nodes.find(node => node.id === edge.from);
            const to = this.nodes.find(node => node.id === edge.to);
            if (from && to && Number(from.col) === Number(to.col)) sameColumnEdges++;
        }
        const columns = new Map();
        const rows = new Set();
        for (const node of this.nodes) {
            const col = Number(node.col);
            if (Number.isFinite(col)) columns.set(col, (columns.get(col) || 0) + 1);
            const row = Number(node.row);
            if (Number.isFinite(row)) rows.add(row);
        }
        const nodeCount = Math.max(1, this.nodes.length);
        const maxColumnLoad = Math.max(1, ...columns.values());
        return {
            branchDensity: [...degree.values()].filter(value => value >= 3).length / nodeCount,
            columnLoad: Math.min(1, (maxColumnLoad - 1) / 7),
            verticality: uniqueEdges.size ? sameColumnEdges / uniqueEdges.size : 0,
            rowSpread: Math.min(1, Math.max(0, rows.size - 1) / 7),
        };
    },

    _hashRouteSignature(value) {
        let hash = 0x811c9dc5;
        for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        return hash >>> 0;
    },

    /** 配置显式启用的地牢使用完整探索背景，其余地牢沿用旧上区背景合同。 */
    _usesFullMapBackground() {
        if (this._usesSplitRouteMap()) return false;
        const cfg = DungeonConfig.getZombieDungeonConfig(this.dungeonType);
        return !!(cfg && cfg.mapBackgroundFullPlate);
    },

    /** 现代路线的共同样式与交互：包含地标贴图和独立探索面板。 */
    _usesLandmarkMap() {
        if (this._usesSplitRouteMap()) return true;
        const cfg = DungeonConfig.getZombieDungeonConfig(this.dungeonType);
        return cfg?.mapPresentation === 'landmark';
    },

    _usesSplitRouteMap() {
        const layout = DungeonConfig.getMapLayout(this.dungeonType);
        return layout === 'split' || layout === 'exploration';
    },

    _usesExplorationConsole() {
        return DungeonConfig.getMapLayout(this.dungeonType) === 'exploration';
    },

    _ensureExplorationConsole() {
        if (!this._explorationConsole?.root.isConnected) {
            this._explorationConsole?.destroy();
            getElementIfExists('dungeonRouteTopHud')?.remove();
            const cfg = DungeonConfig.getZombieDungeonConfig(this.dungeonType);
            this._explorationConsole = new DungeonExplorationConsole(this, {
                invasion: AgentInvasionSystem,
                describeNode: node => this._getExplorationNodeDetails(node),
                isCurrentScene: () => SceneManager.currentScene === this.sceneId && !SceneManager.isLoading,
                grade: DungeonConfig.getDungeonGrade(this.dungeonType) || 'F',
                dossierImage: cfg.mapDossierImage || cfg.mapBackground || 'assets/scenes/dungeon-map-bg.png',
            });
        }
        return this._explorationConsole;
    },

    _getExpeditionLayout() {
        const cached = this._expeditionLayoutCache;
        if (cached?.nodes === this.nodes && cached?.edges === this.edges) return cached;
        const layout = buildExpeditionLayout(this.nodes, this.edges, { corridors: this._usesExplorationConsole() });
        this._expeditionLayoutCache = { ...layout, nodes: this.nodes, edges: this.edges };
        return this._expeditionLayoutCache;
    },

    _getLandmarkRouteProfile() {
        if (this._usesSplitRouteMap()) return null;
        if (!this._usesLandmarkMap()) return null;
        return this.LANDMARK_ROUTE_PROFILES[this._getMapBackgroundPath()] || null;
    },

    /** 将实际可见窗口反投影到母图，槽位/容量/背景/命中统一消费此布局。 */
    _getMineRouteLayout(viewW, viewH) {
        const profile = this._getLandmarkRouteProfile();
        if (!profile?.terrainRouting) return null;
        const vw = viewW || (typeof window !== 'undefined' ? window.innerWidth : this.DEFAULT_VIEWPORT_WIDTH);
        const vh = viewH || (typeof window !== 'undefined' ? window.innerHeight : this.DEFAULT_VIEWPORT_HEIGHT);
        const view = this._getMapViewRect(vw, vh);
        const key = [this._getMapBackgroundPath(), vw, vh, view.left, view.top, view.width, view.height, this.NODE_RADIUS].join('|');
        if (this._mineRouteLayoutCache?.key === key) return this._mineRouteLayoutCache;
        const scale = Math.max(vw / profile.width, vh / profile.height);
        let offsetX = (vw - profile.width * scale) / 2;
        let offsetY = (vh - profile.height * scale) / 2;
        const padX = this.NODE_RADIUS + 12 + 8 / scale;
        const padY = this.NODE_RADIUS + 12 + 24 / scale;
        // 额外留出绕行弧空间；低缩放时屏幕点击缓冲也必须互斥。
        const spacing = Math.max(profile.minimumNodeDistance, 96, this.NODE_RADIUS * 2 + 24 / scale);
        const visibleBounds = () => ({
            left: Math.max(profile.bounds.left, (view.left - offsetX) / scale + padX),
            top: Math.max(profile.bounds.top, (view.top - offsetY) / scale + padY),
            right: Math.min(profile.bounds.right, (view.left + view.width - offsetX) / scale - padX),
            bottom: Math.min(profile.bounds.bottom, (view.top + view.height - offsetY) / scale - padY),
        });
        let bounds = visibleBounds();
        let slots = getMineRouteSlots(profile, { bounds, spacing });
        if (!slots.length) {
            // 极窄裁切没有平台时，整幅背景与路线一起平移到最近平台；不移动任何HUD。
            const center = { x: (view.left + view.width / 2 - offsetX) / scale,
                y: (view.top + view.height / 2 - offsetY) / scale };
            const nearest = getMineRouteSlots(profile, { spacing }).slice().sort((a, b) =>
                Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y))[0];
            if (nearest) {
                offsetX = view.left + view.width / 2 - nearest.x * scale;
                offsetY = view.top + view.height / 2 - nearest.y * scale;
                bounds = visibleBounds();
                slots = getMineRouteSlots(profile, { bounds, spacing });
            }
        }
        this._mineRouteLayoutCache = { key, scale, offsetX, offsetY, bounds, slots };
        return this._mineRouteLayoutCache;
    },

    /** 地标路线与背景使用同一变换，分辨率变化时节点仍锁在母图结构上。 */
    _syncLandmarkRouteTransform(viewW, viewH) {
        const profile = this._getLandmarkRouteProfile();
        if (!profile) return false;
        const vw = viewW || ((typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : this.DEFAULT_VIEWPORT_WIDTH);
        const vh = viewH || ((typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : this.DEFAULT_VIEWPORT_HEIGHT);
        const terrainLayout = this._getMineRouteLayout(vw, vh);
        if (terrainLayout) {
            this.mapScale = terrainLayout.scale;
            this.mapOffsetX = terrainLayout.offsetX;
            this.mapOffsetY = terrainLayout.offsetY;
            return true;
        }
        const scale = Math.max(vw / profile.width, vh / profile.height);
        this.mapScale = scale;
        this.mapOffsetX = (vw - profile.width * scale) / 2;
        this.mapOffsetY = (vh - profile.height * scale) / 2;
        return true;
    },

    /**
     * 只生成展示投影，不改写生成器节点的 x/y、边、迷雾和可达关系。
     * 矿洞按通道互斥槽位与楼梯网络投影；其它地标使用六段结构带。
     * 当前区段包含容量允许的相邻连接列，背景与路线共用原图像素坐标。
     */
    _getLandmarkRouteProjection() {
        if (this._usesSplitRouteMap()) {
            if (this.routeViewMode === 'overview') return null;
            const layout = this._getExpeditionLayout();
            if (this._landmarkProjectionCache?.points !== layout.points) {
                this._landmarkProjectionCache = { points: layout.points };
            }
            return layout.points;
        }
        const profile = this._getLandmarkRouteProfile();
        if (!profile || this.routeViewMode === 'overview') return null;
        const activeNodes = this._getActiveRouteNodes();
        if (!activeNodes.length) return null;
        const terrainLayout = profile.terrainRouting ? this._getMineRouteLayout() : null;
        const cacheKey = `${this._getMapBackgroundPath()}|${this.routeSectorIndex}|${this.nodes.length}|${this.routeViewMode}|${terrainLayout?.key || ''}|${terrainLayout ? activeNodes.map(node => node.id).join(',') : ''}`;
        if (this._landmarkProjectionCache?.key === cacheKey) {
            return this._landmarkProjectionCache.points;
        }

        if (profile.terrainRouting) {
            const terrainPoints = projectMineRouteNodes(activeNodes, profile, terrainLayout.slots) || new Map();
            this._landmarkProjectionCache = { key: cacheKey, points: terrainPoints };
            return terrainPoints;
        }

        const columns = [...new Set(activeNodes.map(node => Number(node.col)).filter(Number.isFinite))]
            .sort((a, b) => a - b);
        const rows = activeNodes.map(node => Number(node.row)).filter(Number.isFinite);
        const minRow = rows.length ? Math.min(...rows) : 0;
        const maxRow = rows.length ? Math.max(...rows) : 1;
        const rowSpan = Math.max(1, maxRow - minRow);
        const points = new Map();
        const profileLast = profile.columns.length - 1;
        const mix = (a, b, t) => a + (b - a) * t;

        columns.forEach((column, columnIndex) => {
            const columnT = columns.length <= 1 ? 0.5 : columnIndex / (columns.length - 1);
            const profilePos = columnT * profileLast;
            const leftIndex = Math.floor(profilePos);
            const rightIndex = Math.min(profileLast, leftIndex + 1);
            const localT = profilePos - leftIndex;
            const left = profile.columns[leftIndex];
            const right = profile.columns[rightIndex];
            const upper = {
                x: mix(left.upper.x, right.upper.x, localT),
                y: mix(left.upper.y, right.upper.y, localT),
            };
            const lower = {
                x: mix(left.lower.x, right.lower.x, localT),
                y: mix(left.lower.y, right.lower.y, localT),
            };
            const columnNodes = activeNodes
                .filter(node => Number(node.col) === column)
                .sort((a, b) => (Number(a.row) - Number(b.row)) || String(a.id).localeCompare(String(b.id)));
            const basePoints = columnNodes.map(node => {
                const nodeRow = Number(node.row);
                const rowT = Number.isFinite(nodeRow)
                    ? Math.max(0, Math.min(1, (nodeRow - minRow) / rowSpan))
                    : 0.5;
                return {
                    x: mix(upper.x, lower.x, rowT),
                    y: mix(upper.y, lower.y, rowT),
                };
            });

            // 同列岔路过密时按“轨道数 × 纵向槽位”重新排布。节点不再只做小幅偏移，
            // 而是使用整条结构带，从而在后续单列节点增多时仍保留至少72px目标间距。
            let minimumStep = Infinity;
            for (let index = 1; index < basePoints.length; index++) {
                minimumStep = Math.min(minimumStep, Math.hypot(
                    basePoints[index].x - basePoints[index - 1].x,
                    basePoints[index].y - basePoints[index - 1].y,
                ));
            }
            const minimumCenterDistance = 72;
            const bandDx = lower.x - upper.x;
            const bandDy = lower.y - upper.y;
            const bandLength = Math.hypot(bandDx, bandDy) || 1;
            const denseColumn = Number.isFinite(minimumStep) && minimumStep < minimumCenterDistance;
            const maxNodesPerLane = Math.max(2, Math.floor(bandLength / minimumCenterDistance) + 1);
            const laneCount = denseColumn
                ? Math.min(4, Math.max(2, Math.ceil(columnNodes.length / maxNodesPerLane)))
                : 1;
            const laneSpacing = laneCount > 1 ? 76 : 0;
            const normalX = -bandDy / bandLength;
            const normalY = bandDx / bandLength;

            columnNodes.forEach((node, index) => {
                const laneIndex = laneCount > 1 ? index % laneCount : 0;
                const laneOffset = (laneIndex - (laneCount - 1) / 2) * laneSpacing;
                const laneNodeCount = laneCount > 1
                    ? Math.ceil((columnNodes.length - laneIndex) / laneCount)
                    : columnNodes.length;
                const laneSlot = laneCount > 1 ? Math.floor(index / laneCount) : index;
                const denseT = laneNodeCount <= 1 ? 0.5 : laneSlot / (laneNodeCount - 1);
                const base = denseColumn
                    ? { x: mix(upper.x, lower.x, denseT), y: mix(upper.y, lower.y, denseT) }
                    : basePoints[index];
                points.set(node.id, {
                    x: base.x + normalX * laneOffset,
                    y: base.y + normalY * laneOffset,
                });
            });
        });

        this._separateLandmarkRoutePoints(points, activeNodes, profile);

        this._landmarkProjectionCache = { key: cacheKey, points };
        return points;
    },

    /**
     * 最终确定性消碰撞：只在不足72px时做小幅双向推开，并限制在母图安全区内。
     * 该步骤只改展示坐标，不改节点ID、边、行列、迷雾或可达性。
     */
    _separateLandmarkRoutePoints(points, activeNodes, profile) {
        const minimumDistance = 72;
        const bounds = profile.bounds || { left: 0, top: 0, right: profile.width, bottom: profile.height };
        const ordered = activeNodes
            .filter(node => points.has(node.id))
            .slice()
            .sort((a, b) => (Number(a.col) - Number(b.col))
                || (Number(a.row) - Number(b.row))
                || String(a.id).localeCompare(String(b.id)));
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

        for (let pass = 0; pass < 12; pass++) {
            let adjusted = false;
            for (let leftIndex = 0; leftIndex < ordered.length; leftIndex++) {
                for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex++) {
                    const left = points.get(ordered[leftIndex].id);
                    const right = points.get(ordered[rightIndex].id);
                    let dx = right.x - left.x;
                    let dy = right.y - left.y;
                    let distance = Math.hypot(dx, dy);
                    if (distance >= minimumDistance) continue;
                    if (distance < 0.001) {
                        const angle = (this._hashRouteSignature(`${ordered[leftIndex].id}|${ordered[rightIndex].id}`) % 360) * Math.PI / 180;
                        dx = Math.cos(angle);
                        dy = Math.sin(angle);
                        distance = 1;
                    }
                    const push = (minimumDistance - distance) / 2 + 0.25;
                    const unitX = dx / distance;
                    const unitY = dy / distance;
                    left.x = clamp(left.x - unitX * push, bounds.left, bounds.right);
                    left.y = clamp(left.y - unitY * push, bounds.top, bounds.bottom);
                    right.x = clamp(right.x + unitX * push, bounds.left, bounds.right);
                    right.y = clamp(right.y + unitY * push, bounds.top, bounds.bottom);
                    adjusted = true;
                }
            }
            if (!adjusted) break;
        }
    },

    _getRoutePoint(node) {
        if (!node) return { x: 0, y: 0 };
        const projected = this._getLandmarkRouteProjection()?.get(node.id);
        return projected || { x: node.x, y: node.y };
    },

    /** 绘制和命中共用的节点集合；未投影的隐藏节点绝不回退到生成器坐标参与点击。 */
    _getPresentedRouteNodes() {
        if (this.routeViewMode === 'overview') return [];
        const nodes = this._getActiveRouteNodes();
        const projected = this._getLandmarkRouteProjection();
        const terrain = this._getLandmarkRouteProfile()?.terrainRouting;
        const view = this._getMapViewRect();
        return nodes.filter(node => {
            if (terrain && !projected?.has(node.id)) return false;
            const point = projected?.get(node.id) || node;
            const screen = this._mapToScreen(point.x, point.y);
            return screen.x >= view.left && screen.x <= view.left + view.width
                && screen.y >= view.top && screen.y <= view.top + view.height;
        });
    },

    _isRouteNodePresented(node) {
        return !!node && this._getPresentedRouteNodes().some(candidate => candidate.id === node.id);
    },

    _hitTestRouteNode(pointer, { inspectOnly = false } = {}) {
        if (!this._isInMapArea(pointer.x, pointer.y)) return null;
        const available = new Set(this.getAvailableNodes().map(node => node.id));
        let nearest = null;
        let closest = this.NODE_RADIUS * this.mapScale + 10;
        for (const node of this._getPresentedRouteNodes()) {
            if (!inspectOnly && !available.has(node.id)) continue;
            const point = this._getRoutePoint(node);
            const screen = this._mapToScreen(point.x, point.y);
            const distance = Math.hypot(pointer.x - screen.x, pointer.y - screen.y);
            if (distance < closest) { nearest = node; closest = distance; }
        }
        return nearest;
    },

    _clearRoutePointerSelection() {
        this.hoveredNodeId = null;
        this._pendingRouteClick = null;
        this._routePointerRegion = null;
        this.isDragging = false;
        this.dragStartX = undefined;
        this.dragStartY = undefined;
        this._removeNodeTooltip();
    },

    /** 地标路线只预载独立透明徽记；节点外壳、状态环和可达性仍由运行时负责。 */
    _preloadRouteNodeIcons() {
        if (!this._usesLandmarkMap()) return;
        if (!this._routeNodeIconImages) this._routeNodeIconImages = new Map();
        for (const [type, path] of Object.entries(this.ROUTE_NODE_ICON_PATHS)) {
            if (!this._routeNodeIconImages.has(type)) {
                this._routeNodeIconImages.set(type, loadImage(path));
            }
        }
    },

    _getRouteNodeIcon(displayType, isElite = false) {
        if (!this._usesLandmarkMap()) return null;
        this._preloadRouteNodeIcons();
        const key = isElite && displayType === 'combat' ? 'elite' : displayType;
        const img = this._routeNodeIconImages?.get(key) || null;
        return img?.complete && img.naturalWidth > 0 ? img : null;
    },

    /** 只简化表现层：当前位置的真实连接常显，悬停补充该节点的连接。 */
    _getPresentedRouteEdges(visibleNodeIds) {
        const showAll = !this._usesLandmarkMap() || this._showAllRouteEdges
            || !visibleNodeIds.has(this.currentNodeId);
        return this.edges.filter(edge => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)
            && (showAll || edge.from === this.currentNodeId || edge.to === this.currentNodeId
                || edge.from === this.hoveredNodeId || edge.to === this.hoveredNodeId));
    },

    /** 色号按完整逻辑图分配，不随当前位置、悬停、区段或显隐改变。 */
    _getRouteColors() {
        if (!this._usesLandmarkMap()) return null;
        const unique = new Map();
        for (const edge of this.edges) {
            const ids = [edge.from, edge.to].sort();
            unique.set(ids.join('::'), ids);
        }
        const ordered = [...unique].sort(([a], [b]) => a.localeCompare(b));
        const key = ordered.map(([id]) => id).join('|');
        if (this._routeColorCache?.key === key) return this._routeColorCache.colors;
        const theme = getComputedStyle(document.documentElement);
        const palette = Array.from({ length: 8 }, (_, index) =>
            theme.getPropertyValue(`--bp-route-color-${index + 1}`).trim()
            || theme.getPropertyValue('--bp-ui-accent-bright').trim() || '#c4d3da');
        const colors = new Map();
        const endpointUsage = new Map();
        const totalUsage = palette.map(() => 0);
        for (const [edgeKey, ids] of ordered) {
            const usages = ids.map(id => {
                if (!endpointUsage.has(id)) endpointUsage.set(id, palette.map(() => 0));
                return endpointUsage.get(id);
            });
            // 同一岔口优先异色，之后再均衡整图用色；不使用易撞色的ID取模。
            const score = index => (usages[0][index] + usages[1][index]) * (ordered.length + 1)
                + totalUsage[index];
            let selected = 0;
            for (let index = 1; index < palette.length; index++) {
                if (score(index) < score(selected)) selected = index;
            }
            colors.set(edgeKey, palette[selected]);
            usages.forEach(usage => usage[selected]++);
            totalUsage[selected]++;
        }
        this._routeColorCache = { key, colors, bundleTheme: {
            line: theme.getPropertyValue('--bp-ui-accent-bright').trim() || '#c4d3da',
            fill: theme.getPropertyValue('--bp-ui-black-soft').trim() || '#101419',
            text: theme.getPropertyValue('--bp-ui-white-soft').trim() || '#d9e0e5',
            font: theme.getPropertyValue('--bp-font-ui').trim() || 'sans-serif',
        } };
        return colors;
    },

    /** 先生成本区公共轨道，再决定哪些线可见；悬停和全线开关不重新布线。 */
    _prepareLandmarkRouteEdges(visibleNodeIds) {
        if (this._usesSplitRouteMap()) {
            const layout = this._getExpeditionLayout();
            const cache = this._landmarkProjectionCache;
            if (!cache || cache.edgePaths === layout.edgePaths) return;
            cache.edgePaths = layout.edgePaths;
            cache.edgeBundles = buildRouteBundles(layout.edgePaths);
            cache.edgeLengths = new Map([...layout.edgePaths].map(([key, path]) => [key, routePathLength(path)]));
            return;
        }
        const profile = this._getLandmarkRouteProfile();
        const cache = this._landmarkProjectionCache;
        if (!profile || !cache) return;
        const nodes = this._getActiveRouteNodes().filter(node => visibleNodeIds.has(node.id));
        const edges = this.edges.filter(edge => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to));
        const view = this._getMapViewRect();
        const bounds = {
            left: (view.left - this.mapOffsetX) / this.mapScale,
            right: (view.left + view.width - this.mapOffsetX) / this.mapScale,
            top: (view.top - this.mapOffsetY) / this.mapScale,
            bottom: (view.top + view.height - this.mapOffsetY) / this.mapScale,
        };
        const key = `${this.mapScale}|${Object.values(bounds).join(',')}|${edges.map(edge => `${edge.from}:${edge.to}`).join(',')}`;
        if (cache.edgeKey === key) return;
        cache.edgePaths = profile.terrainRouting
            ? buildMineRouteEdgePaths(nodes, edges, cache.points, profile)
            : this._buildLandmarkParallelEdges(nodes, edges, cache.points, bounds);
        // 模板缺少展示通道时仍保留原直连降级，不能让真实可走边因合束而消失。
        for (const edge of edges) {
            const ids = [edge.from, edge.to].sort();
            const edgeKey = ids.join('::');
            if (cache.edgePaths.has(edgeKey)) continue;
            const path = ids.map(id => cache.points.get(id) || nodes.find(node => node.id === id));
            if (path.every(Boolean)) cache.edgePaths.set(edgeKey, path);
        }
        cache.edgeBundles = buildRouteBundles(cache.edgePaths);
        cache.edgeLengths = new Map([...cache.edgePaths].map(([id, path]) => [id, routePathLength(path)]));
        cache.edgeKey = key;
    },

    /** 非矿洞地标按列对共用横竖通道，不再给每条线交替增加正/负弧度。 */
    _buildLandmarkParallelEdges(nodes, edges, points, bounds) {
        const byId = new Map(nodes.map(node => [node.id, node]));
        const columns = new Map();
        for (const node of nodes) {
            const point = points.get(node.id);
            if (!point) continue;
            if (!columns.has(node.col)) columns.set(node.col, []);
            columns.get(node.col).push(point.x);
        }
        const unique = new Map(edges.map(edge => {
            const ids = [edge.from, edge.to].sort();
            return [ids.join('::'), ids];
        }));
        const paths = new Map();
        const spacing = 8 / this.mapScale;
        for (const [key, [from, to]] of [...unique].sort(([a], [b]) => a.localeCompare(b))) {
            const a = points.get(from), b = points.get(to);
            if (!a || !b) continue;
            const colA = byId.get(from).col, colB = byId.get(to).col;
            // 同一列对共用中心干线，重叠片段由线束渲染器去重，不再按边横向错开。
            const xsA = columns.get(colA), xsB = columns.get(colB);
            let railX;
            if (colA === colB) {
                const left = Math.min(...xsA), right = Math.max(...xsA);
                const margin = this.NODE_RADIUS + 16 + spacing;
                if (bounds.right - right >= margin + spacing) railX = right + margin;
                else if (left - bounds.left >= margin + spacing) railX = left - margin;
                else { paths.set(key, [a, b]); continue; }
            } else {
                const centerA = (Math.min(...xsA) + Math.max(...xsA)) / 2;
                const centerB = (Math.min(...xsB) + Math.max(...xsB)) / 2;
                railX = Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), (centerA + centerB) / 2));
            }
            paths.set(key, [a, { x: railX, y: a.y }, { x: railX, y: b.y }, b]);
        }
        return paths;
    },

    _traceRouteEdge(ctx, fromNode, toNode) {
        const fromPoint = this._getRoutePoint(fromNode);
        const toPoint = this._getRoutePoint(toNode);
        const terrainPath = this._landmarkProjectionCache?.edgePaths?.get([fromNode.id, toNode.id].sort().join('::'));
        if (terrainPath?.length) {
            ctx.beginPath();
            ctx.moveTo(terrainPath[0].x, terrainPath[0].y);
            for (const point of terrainPath.slice(1)) ctx.lineTo(point.x, point.y);
            ctx.lineJoin = 'round';
            return;
        }
        ctx.beginPath();
        ctx.moveTo(fromPoint.x, fromPoint.y);
        ctx.lineTo(toPoint.x, toPoint.y);
    },

    _getRouteEdgeMidpoint(fromNode, toNode) {
        const fromPoint = this._getRoutePoint(fromNode);
        const toPoint = this._getRoutePoint(toNode);
        const terrainPath = this._landmarkProjectionCache?.edgePaths?.get([fromNode.id, toNode.id].sort().join('::'));
        if (terrainPath?.length) {
            const midpoint = mineRoutePathMidpoint(terrainPath);
            // 公共折线路径按ID排序缓存；箭头须按本次from→to还原方向。
            return { ...midpoint, angle: midpoint.angle + (String(fromNode.id) > String(toNode.id) ? Math.PI : 0) };
        }
        return { x: (fromPoint.x + toPoint.x) / 2, y: (fromPoint.y + toPoint.y) / 2,
            angle: Math.atan2(toPoint.y - fromPoint.y, toPoint.x - fromPoint.x),
        };
    },

    /** 共用段只描一次；只有悬停的可走目标叠加一条完整彩色路线。 */
    _renderRouteBundles(ctx, routeEdges, availableIds, routeColors, view, t) {
        const cache = this._landmarkProjectionCache;
        const theme = this._routeColorCache.bundleTheme;
        const states = new Map();
        for (const edge of routeEdges) {
            const key = [edge.from, edge.to].sort().join('::');
            const target = edge.from === this.currentNodeId ? edge.to
                : edge.to === this.currentNodeId ? edge.from : null;
            states.set(key, { ...edge, target, available: target !== null && availableIds.has(target),
                inspected: edge.from === this.hoveredNodeId || edge.to === this.hoveredNodeId,
                visited: this.visitedNodeIds.has(edge.from) && this.visitedNodeIds.has(edge.to) });
        }
        const focusKey = availableIds.has(this.hoveredNodeId)
            ? [this.currentNodeId, this.hoveredNodeId].sort().join('::') : null;
        const trace = path => {
            ctx.beginPath();
            ctx.moveTo(path[0].x, path[0].y);
            for (let index = 1; index < path.length; index++) ctx.lineTo(path[index].x, path[index].y);
        };
        const visible = cache.edgeBundles.map(bundle => {
            const keys = bundle.edgeKeys.filter(key => states.has(key));
            return { ...bundle, keys, activeCount: keys.filter(key => states.get(key).available).length,
                visited: keys.length > 0 && keys.every(key => states.get(key).visited) };
        }).filter(bundle => bundle.keys.length);
        visible.sort((a, b) => Number(a.activeCount > 0) - Number(b.activeCount > 0));
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const bundle of visible) {
            const active = bundle.activeCount > 0;
            const inspected = focusKey && bundle.keys.includes(focusKey);
            ctx.globalAlpha = focusKey ? (inspected ? 0.38 : 0.16) : active ? 0.9 : bundle.visited ? 0.32 : 0.2;
            ctx.setLineDash([]);
            ctx.strokeStyle = theme.fill;
            ctx.lineWidth = (active ? 7 : 5) / this.mapScale;
            trace(bundle.path);
            ctx.stroke();
            ctx.strokeStyle = bundle.keys.length > 1 ? theme.line : routeColors.get(bundle.keys[0]);
            ctx.lineWidth = (bundle.keys.length > 1 ? 3.2 : 2.5) / this.mapScale;
            if (!active && !bundle.visited) ctx.setLineDash([4 / this.mapScale, 7 / this.mapScale]);
            trace(bundle.path);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        const focusedPath = focusKey && cache.edgePaths.get(focusKey);
        if (focusedPath?.length) {
            ctx.strokeStyle = theme.fill;
            ctx.lineWidth = 8 / this.mapScale;
            trace(focusedPath);
            ctx.stroke();
            ctx.strokeStyle = routeColors.get(focusKey);
            ctx.shadowColor = ctx.strokeStyle;
            ctx.shadowBlur = 4 / this.mapScale;
            ctx.lineWidth = 3.5 / this.mapScale;
            trace(focusedPath);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = theme.text;
            ctx.lineWidth = 1 / this.mapScale;
            ctx.setLineDash([10 / this.mapScale, 9 / this.mapScale]);
            ctx.lineDashOffset = (String(this.currentNodeId) < String(this.hoveredNodeId) ? -1 : 1) * t * 0.04 / this.mapScale;
            trace(focusedPath);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.lineDashOffset = 0;
        }
        // 箭头放到各自目标端，不再把多条方向箭头堆在线束中点。
        for (const [key, state] of states) {
            if (focusKey && key !== focusKey) continue;
            if (!state.available && (!state.inspected || state.visited)) continue;
            const path = cache.edgePaths.get(key);
            if (!path?.length) continue;
            const length = cache.edgeLengths.get(key);
            const endGap = Math.min(length / 2, this.NODE_RADIUS + 16);
            const destination = state.available ? state.target : this.hoveredNodeId;
            const origin = state.from === destination ? state.to : state.from;
            const forward = String(origin) < String(destination);
            const marker = sampleRoutePath(path, forward ? length - endGap : endGap);
            ctx.save();
            ctx.translate(marker.x, marker.y);
            if (!state.available) {
                // 只在检查不可走节点时保留端点阻断叉，主干不堆满警告标记。
                const size = 4 / this.mapScale;
                ctx.strokeStyle = 'rgba(205, 102, 108, 0.94)';
                ctx.lineWidth = 1.5 / this.mapScale;
                ctx.beginPath();
                ctx.moveTo(-size, -size);
                ctx.lineTo(size, size);
                ctx.moveTo(-size, size);
                ctx.lineTo(size, -size);
                ctx.stroke();
                ctx.restore();
                continue;
            }
            ctx.rotate(marker.angle + (forward ? 0 : Math.PI));
            const size = 5 / this.mapScale;
            ctx.beginPath();
            ctx.moveTo(size, 0);
            ctx.lineTo(-size, -size * 0.7);
            ctx.lineTo(-size * 0.45, 0);
            ctx.lineTo(-size, size * 0.7);
            ctx.closePath();
            ctx.strokeStyle = theme.fill;
            ctx.lineWidth = 3 / this.mapScale;
            ctx.stroke();
            ctx.fillStyle = routeColors.get(key);
            ctx.fill();
            ctx.restore();
        }
        ctx.restore();
        this._renderRouteBundleLabels(ctx, visible, view, theme, focusKey);
    },

    /** 数量只统计当前显示的独立逻辑边；长束优先，同成员只标一次，避让徽记和其它标签。 */
    _renderRouteBundleLabels(ctx, bundles, view, theme, focusKey) {
        const candidates = bundles.filter(bundle => bundle.keys.length > 1 && bundle.length * this.mapScale >= 40)
            .sort((a, b) => Number(b.keys.includes(focusKey)) - Number(a.keys.includes(focusKey))
                || Number(b.activeCount > 0) - Number(a.activeCount > 0) || b.length - a.length);
        const nodes = this._getPresentedRouteNodes().map(node => {
            const point = this._getRoutePoint(node);
            return this._mapToScreen(point.x, point.y);
        });
        const placed = [], labeled = new Set();
        const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const radius = this.NODE_RADIUS * this.mapScale + 16;
        ctx.save();
        ctx.font = `600 ${11 / this.mapScale}px ${theme.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const bundle of candidates) {
            if (placed.length >= 6) break;
            const signature = bundle.keys.join('|');
            if (labeled.has(signature)) continue;
            const mixed = bundle.activeCount > 0 && bundle.activeCount < bundle.keys.length;
            const text = `×${bundle.keys.length}${mixed ? ` · 可走${bundle.activeCount}` : ''}`;
            const width = ctx.measureText(text).width * this.mapScale + 14;
            let label = null;
            for (const fraction of [0.5, 0.75, 0.25, 0.9, 0.1]) {
                const anchor = sampleRoutePath(bundle.path, bundle.length * fraction);
                const screen = this._mapToScreen(anchor.x, anchor.y);
                for (const side of [-1, 1]) {
                    const x = screen.x - Math.sin(anchor.angle) * 17 * side;
                    const y = screen.y + Math.cos(anchor.angle) * 17 * side;
                    const rect = { left: x - width / 2, right: x + width / 2, top: y - 10, bottom: y + 10 };
                    if (rect.left < view.left + 4 || rect.right > view.left + view.width - 4
                        || rect.top < view.top + 4 || rect.bottom > view.top + view.height - 4) continue;
                    if (nodes.some(node => intersects(rect, { left: node.x - radius, right: node.x + radius,
                        top: node.y - radius, bottom: node.y + radius + 16 }))) continue;
                    if (placed.some(other => intersects(rect, { left: other.left - 8, right: other.right + 8,
                        top: other.top - 8, bottom: other.bottom + 8 }))) continue;
                    label = { x, y, rect };
                    break;
                }
                if (label) break;
            }
            if (!label) continue;
            placed.push(label.rect);
            labeled.add(signature);
            const point = this._screenToMap(label.x, label.y);
            const w = width / this.mapScale, h = 20 / this.mapScale;
            ctx.globalAlpha = focusKey && !bundle.keys.includes(focusKey) ? 0.35 : bundle.activeCount ? 0.94 : 0.55;
            ctx.fillStyle = theme.fill;
            ctx.fillRect(point.x - w / 2, point.y - h / 2, w, h);
            ctx.strokeStyle = theme.line;
            ctx.lineWidth = 0.6 / this.mapScale;
            ctx.strokeRect(point.x - w / 2, point.y - h / 2, w, h);
            ctx.fillStyle = theme.text;
            ctx.fillText(text, point.x, point.y);
        }
        ctx.restore();
    },

    /**
     * 钳制地图偏移，使 2048×2048 的地图不会拖出显示区域
     */
    /** 路线选择界面显示区域：地标模式使用全屏承载层；旧模式继续按
     *  1920×1080 spec 维持下区60%/上区40%的兼容布局。 */
    _getMapTargetArea(viewW, viewH) {
        const vw = viewW || ((typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1920);
        const vh = viewH || ((typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 1080);
        if (this._usesSplitRouteMap()) {
            const top = Math.round(vh * 0.36);
            const left = 274, right = 104;
            return { left, top, width: Math.max(1, vw - left - right), height: vh - top };
        }
        if (this._usesLandmarkMap()) {
            return { left: 0, top: 0, width: vw, height: vh };
        }
        return anchorRect(MAP_AREA_SPEC, vw, vh);
    },

    /** 路线图显示窗口：桌面保留左右 HUD 安全区，窄屏改用近全宽，不再缩放固定坐标。 */
    _getMapViewRect(viewW, viewH) {
        const vw = viewW || ((typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 2560);
        const vh = viewH || ((typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 1440);
        if (this._usesExplorationConsole()) {
            // 初始化 DOM 前仅用于临时定位；创建后绘制、拖动和聚焦全部读取同一实测窗口。
            return this._explorationConsole?.view || { left: 300, top: vh * 0.32 + 90,
                width: Math.max(240, (vw - 414) * 0.73), height: Math.max(180, vh * 0.68 - 300) };
        }
        if (this._usesSplitRouteMap()) {
            const area = this._getMapTargetArea(vw, vh);
            const bottom = vw < 1300 ? 130 : 86;
            return { left: area.left + 16, top: area.top + 64,
                width: Math.max(1, area.width - 32), height: Math.max(1, area.height - 64 - bottom) };
        }
        const compact = vw <= 900;
        const fullPlate = this._usesFullMapBackground();
        const landmark = this._usesLandmarkMap();
        const legacySideSafe = Math.max(260, Math.round(vw * 0.22));
        const leftSafe = fullPlate ? 274 : legacySideSafe;
        const rightSafe = fullPlate ? 104 : legacySideSafe;
        const top = landmark
            ? Math.max(138, Math.round(vh * 0.135))
            : Math.round(vh * (fullPlate ? 0.455 : 0.52));
        const bottomSafe = compact
            ? Math.max(126, Math.round(vh * 0.13))
            : (landmark
                ? Math.max(86, Math.round(vh * 0.085))
                : Math.max(fullPlate ? 150 : 138, Math.round(vh * (fullPlate ? 0.14 : 0.12))));
        return {
            left: leftSafe,
            top,
            width: Math.max(240, vw - leftSafe - rightSafe),
            height: Math.max(180, vh - top - bottomSafe),
        };
    },

    /** 路线图内容离屏画布（按窗口尺寸缓存） */
    _getMapViewCanvas(w, h) {
        if (!this._mapViewCanvas) {
            this._mapViewCanvas = document.createElement('canvas');
        }
        if (this._mapViewCanvas.width !== w || this._mapViewCanvas.height !== h) {
            this._mapViewCanvas.width = w;
            this._mapViewCanvas.height = h;
        }
        return this._mapViewCanvas;
    },

    /**
     * 离屏内容边缘纯透明淡出：destination-out 蒙版（外缘 alpha 1 全擦 → 内缘 alpha 0 不擦），
     * 节点/贴图/连线在窗口边缘真实渐隐，露出底层背景（不用黑色遮罩覆盖）。
     * 注意不能用 destination-in：未覆盖区域（窗口中心）会被整体清空导致节点全消失。
     */
    _applyMapEdgeFade(ctx, w, h) {
        const fw = this._usesSplitRouteMap() ? 18 : Math.max(24, Math.round(w * 0.12));
        const fh = this._usesSplitRouteMap() ? 14 : Math.max(16, Math.round(h * 0.12));
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        const band = (grad, x, y, bw, bh) => { ctx.fillStyle = grad; ctx.fillRect(x, y, bw, bh); };
        let g = ctx.createLinearGradient(0, 0, fw, 0);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        band(g, 0, 0, fw, h);
        g = ctx.createLinearGradient(w, 0, w - fw, 0);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        band(g, w - fw, 0, fw, h);
        g = ctx.createLinearGradient(0, 0, 0, fh);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        band(g, 0, 0, w, fh);
        g = ctx.createLinearGradient(0, h, 0, h - fh);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        band(g, 0, h - fh, w, fh);
        ctx.restore();
    },

    /** 鼠标/指针是否落在路线图窗口内（窗口外不可拖动） */
    _isInMapArea(x, y) {
        const v = this._getMapViewRect();
        return x >= v.left && x <= v.left + v.width &&
               y >= v.top && y <= v.top + v.height;
    },

    /**
     * 路线内容的实际包围盒（节点坐标 + 绘制余量）。
     * 宝箱岔路会生成负 row（y 可为 0 甚至负数），固定 2048×2048 的钳制
     * 会让这些节点永远拖不进视口——钳制必须按真实包围盒计算。
     */
    _getContentBounds() {
        const PAD = 80; // 覆盖节点半径/精英★/“你”标签的绘制余量
        if (!this.nodes.length) {
            return { minX: 0, minY: 0, maxX: this.MAP_WIDTH, maxY: this.MAP_HEIGHT };
        }
        const b = this._calculateNodeBounds(this._getActiveRouteNodes());
        if (this._usesExplorationConsole()) {
            const activeIds = new Set(this._getActiveRouteNodes().map(node => node.id));
            const paths = this._getExpeditionLayout().edgePaths;
            for (const edge of this.edges) {
                if (!activeIds.has(edge.from) || !activeIds.has(edge.to)) continue;
                for (const point of paths.get([edge.from, edge.to].sort().join('::')) || []) {
                    b.minX = Math.min(b.minX, point.x); b.maxX = Math.max(b.maxX, point.x);
                    b.minY = Math.min(b.minY, point.y); b.maxY = Math.max(b.maxY, point.y);
                }
            }
        }
        return { minX: b.minX - PAD, minY: b.minY - PAD, maxX: b.maxX + PAD, maxY: b.maxY + PAD };
    },

    /**
     * 长路线按生成列分区。只建立展示投影，不改节点、边、迷雾或可达关系。
     * 默认每区四列；矿洞最多三列，并按当前母图可用槽位容量提前分段。
     */
    _getRouteSectors() {
        const columns = [...new Set(this.nodes
            .map(node => Number(node.col))
            .filter(Number.isFinite))]
            .sort((a, b) => a - b);
        const profile = this._getLandmarkRouteProfile();
        if (profile?.terrainRouting) {
            const capacity = this._getMineRouteLayout().slots.length;
            const budget = Math.max(1, Math.floor(capacity * 0.58));
            const sectors = [];
            let batch = [];
            const flush = () => {
                if (!batch.length) return;
                const sectorColumns = [...new Set(batch.map(node => Number(node.col)))];
                sectors.push({ index: sectors.length, startCol: sectorColumns[0],
                    endCol: sectorColumns[sectorColumns.length - 1], columns: sectorColumns, nodes: batch,
                    visitedCount: batch.filter(node => this.visitedNodeIds.has(node.id)).length });
                batch = [];
            };
            for (const col of columns) {
                const group = this.nodes.filter(node => Number(node.col) === col)
                    .sort((a, b) => Number(a.row) - Number(b.row) || String(a.id).localeCompare(String(b.id)));
                const columnCount = new Set(batch.map(node => node.col)).size;
                if (batch.length && (batch.length + group.length > budget || columnCount >= profile.sectorColumnSpan)) flush();
                // 单列也可能超过窄窗口容量，按节点拆成子区段；所有节点仍各有一个核心归属。
                for (const node of group) {
                    if (batch.length >= budget) flush();
                    batch.push(node);
                }
            }
            flush();
            return sectors;
        }
        const sectorBudget = Infinity;
        const span = this._usesSplitRouteMap()
            ? Math.max(1, Math.min(4, Math.floor(this._getMapViewRect().width / 190) - 2))
            : Math.max(1, profile?.sectorColumnSpan || this.ROUTE_SECTOR_COLUMN_SPAN || 4);
        const sectors = [];
        for (let start = 0; start < columns.length;) {
            const sectorColumns = [];
            let count = 0;
            while (start < columns.length && sectorColumns.length < span) {
                const columnCount = this.nodes.filter(node => Number(node.col) === columns[start]).length;
                if (sectorColumns.length && count + columnCount > sectorBudget) break;
                count += columnCount;
                sectorColumns.push(columns[start++]);
            }
            const startCol = sectorColumns[0];
            const endCol = sectorColumns[sectorColumns.length - 1];
            const sectorNodes = this.nodes.filter(node => node.col >= startCol && node.col <= endCol);
            sectors.push({
                index: sectors.length,
                startCol,
                endCol,
                columns: sectorColumns,
                nodes: sectorNodes,
                visitedCount: sectorNodes.filter(node => this.visitedNodeIds.has(node.id)).length,
            });
        }
        return sectors;
    },

    _getSectorIndexForNode(node) {
        if (!node) return 0;
        const sectors = this._getRouteSectors();
        const index = sectors.findIndex(sector => sector.nodes.some(candidate => candidate.id === node.id));
        return index >= 0 ? index : 0;
    },

    /** 聚焦态绘制核心区段；矿洞按容量保留真实邻接点，其它地图保留前后接头列。 */
    _getRouteSectorNodes(index = this.routeSectorIndex, includeConnectors = true) {
        const sectors = this._getRouteSectors();
        if (!sectors.length) return this.nodes;
        const safeIndex = Math.max(0, Math.min(sectors.length - 1, Number(index) || 0));
        const sector = sectors[safeIndex];
        const profile = this._getLandmarkRouteProfile();
        if (profile?.terrainRouting) {
            const result = sector.nodes.slice();
            if (!includeConnectors) return result;
            const capacity = this._getMineRouteLayout().slots.length;
            const coreIds = new Set(result.map(node => node.id));
            const availableIds = new Set(this.getAvailableNodes().map(node => node.id));
            const adjacentIds = new Set();
            for (const edge of this.edges) {
                if (coreIds.has(edge.from)) adjacentIds.add(edge.to);
                if (coreIds.has(edge.to)) adjacentIds.add(edge.from);
            }
            const extra = this.nodes.filter(node => adjacentIds.has(node.id) && !coreIds.has(node.id))
                .sort((a, b) => Number(b.id === this.currentNodeId) - Number(a.id === this.currentNodeId)
                    || Number(availableIds.has(b.id)) - Number(availableIds.has(a.id))
                    || Number(a.col) - Number(b.col) || Number(a.row) - Number(b.row)
                    || String(a.id).localeCompare(String(b.id)));
            // 接头只取真实逻辑邻居，优先保留当前位置和可走邻居；其余节点在自身区段查看。
            result.push(...extra.slice(0, Math.max(0, capacity - result.length)));
            return result;
        }
        const minCol = sector.startCol - (includeConnectors ? 1 : 0);
        const maxCol = sector.endCol + (includeConnectors ? 1 : 0);
        return this.nodes.filter(node => node.col >= minCol && node.col <= maxCol);
    },

    _getActiveRouteNodes() {
        if (this.routeViewMode === 'overview') return this.nodes;
        if (this.routeViewMode !== 'focus' && !this._getLandmarkRouteProfile()?.terrainRouting) return this.nodes;
        return this._getRouteSectorNodes(this.routeSectorIndex, true);
    },

    /**
     * 初始化路线表现层。地牢状态、地图数据和入口节点已在调用前完成；
     * 此处任何异常都只降级路线展示，不允许打断出征流程。
     */
    _initializeRoutePresentation({ restoreDefaultZoom = true } = {}) {
        let routeLayoutReady = true;
        try {
            this._focusOnCurrentNode({ restoreDefaultZoom });
        } catch (error) {
            console.error('[DungeonMapSystem] 路线分区界面初始化失败，已回退完整路线图:', error);
            routeLayoutReady = false;
            this.routeViewMode = 'fallback';
            this.routeSectorIndex = 0;
            try {
                this._centerRouteMap();
            } catch (fallbackError) {
                // 最低限度保留可渲染坐标；表现层二次失败也不得逃逸到出征主链。
                console.error('[DungeonMapSystem] 基础路线图回退定位失败，保留默认视图:', fallbackError);
                this.mapScale = 1;
                this.mapOffsetX = 0;
                this.mapOffsetY = 0;
            }
        }
        // 作战台不是路线定位的附属品：即使区段聚焦失败，也必须保留选点、
        // 总览与返回当前位置入口，不能在回退分支中把整块控制台删掉。
        try {
            this._createRouteControls();
        } catch (controlError) {
            console.error('[DungeonMapSystem] 路线作战台创建失败:', controlError);
            return false;
        }
        return routeLayoutReady;
    },

    _clampMapOffset() {
        if (this._getLandmarkRouteProfile() && this.routeViewMode !== 'overview') {
            this._syncLandmarkRouteTransform();
            return;
        }
        // 钳制区域与初始定位同源（路线图显示窗口），禁止两套区域计算
        const area = this._getMapViewRect();
        const b = this._getContentBounds();
        const s = this.mapScale;
        // 单轴钳制区间：内容覆盖区域（内容小于区域时居中）
        const axisRange = (minV, maxV, areaStart, areaLen) => {
            let max = areaStart - minV * s;            // 内容起边贴区域起边
            let min = areaStart + areaLen - maxV * s;  // 内容终边贴区域终边
            if (min > max) { const mid = (min + max) / 2; min = mid; max = mid; }
            return { min, max };
        };
        const rx = axisRange(b.minX, b.maxX, area.left, area.width);
        const ry = axisRange(b.minY, b.maxY, area.top, area.height);
        this.mapOffsetX = Math.min(rx.max, Math.max(rx.min, this.mapOffsetX));
        this.mapOffsetY = Math.min(ry.max, Math.max(ry.min, this.mapOffsetY));
    },

    // ───────────────────────────────────────────────
    // 路线图居中：计算节点包围盒并居中显示
    // ───────────────────────────────────────────────
    _calculateNodeBounds(sourceNodes = this.nodes) {
        const nodes = Array.isArray(sourceNodes) && sourceNodes.length ? sourceNodes : this.nodes;
        if (!nodes.length) {
            return {
                minX: 0, maxX: this.MAP_WIDTH,
                minY: 0, maxY: this.MAP_HEIGHT,
                cx: this.MAP_WIDTH / 2, cy: this.MAP_HEIGHT / 2,
            };
        }
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const node of nodes) {
            const point = this._getRoutePoint(node);
            if (point.x < minX) minX = point.x;
            if (point.x > maxX) maxX = point.x;
            if (point.y < minY) minY = point.y;
            if (point.y > maxY) maxY = point.y;
        }
        return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
    },

    _centerRouteMap() {
        if (this._usesSplitRouteMap() && this.routeViewMode === 'focus' && this.nodes.length) {
            this._focusRouteSector(this.routeSectorIndex);
            return;
        }
        // 路线图显示窗口（与拖动钳制共用 _getMapViewRect）
        const TARGET_AREA = this._getMapViewRect();

        if (this._getLandmarkRouteProfile() && this.routeViewMode !== 'overview') {
            this._syncLandmarkRouteTransform();
            return;
        }

        if (this.nodes.length === 0) {
            // 无节点时，默认居中显示在目标区域内
            const scaleX = TARGET_AREA.width / this.MAP_WIDTH;
            const scaleY = TARGET_AREA.height / this.MAP_HEIGHT;
            this.mapScale = Math.min(scaleX, scaleY);
            this.mapOffsetX = TARGET_AREA.left + (TARGET_AREA.width - this.MAP_WIDTH * this.mapScale) / 2;
            this.mapOffsetY = TARGET_AREA.top + (TARGET_AREA.height - this.MAP_HEIGHT * this.mapScale) / 2;
            return;
        }

        const bounds = this._calculateNodeBounds(this._getActiveRouteNodes());
        const padding = 80; // 地图坐标边距，确保路线图不贴边

        // 先求完整适配缩放，再按 DEFAULT_ZOOM_FACTOR 放大（默认 3 倍初始视图）
        const routeW = bounds.maxX - bounds.minX + padding * 2;
        const routeH = bounds.maxY - bounds.minY + padding * 2;
        const fitScale = Math.min(TARGET_AREA.width / routeW, TARGET_AREA.height / routeH, 1.5);
        this.mapScale = this._usesExplorationConsole() ? Math.max(0.8, Math.min(fitScale, 1.2))
            : this._usesSplitRouteMap() ? Math.max(0.95, Math.min(fitScale, 1.2))
            : Math.min(fitScale * this.DEFAULT_ZOOM_FACTOR, this.MAX_MAP_SCALE);

        // 初始聚焦出发点（无出发点时退回路线中心），随后钳制到区域边缘
        const startNode = this.nodes.find(n => n.type === 'start');
        const startPoint = startNode && this._getRoutePoint(startNode);
        const focusX = startPoint ? startPoint.x : (bounds.minX + bounds.maxX) / 2;
        const focusY = startPoint ? startPoint.y : (bounds.minY + bounds.maxY) / 2;
        this.mapOffsetX = TARGET_AREA.left + TARGET_AREA.width / 2 - focusX * this.mapScale;
        this.mapOffsetY = TARGET_AREA.top + TARGET_AREA.height / 2 - focusY * this.mapScale;
        this._clampMapOffset();
    },

    /** 查看完整路线：只改变路线视图，不改变当前位置、迷雾或可达关系。 */
    _fitRouteMap() {
        this.routeViewMode = 'overview';
        this._clearRoutePointerSelection();
        this._updateRouteControls();
    },

    /** 查看指定区段；只改变展示窗口，不移动角色。 */
    _focusRouteSector(index, { focusNodeId = null, updateControls = true } = {}) {
        this._clearRoutePointerSelection();
        const sectors = this._getRouteSectors();
        if (!sectors.length) {
            this.routeViewMode = 'focus';
            this._centerRouteMap();
            return;
        }
        const safeIndex = Math.max(0, Math.min(sectors.length - 1, Number(index) || 0));
        this.routeViewMode = 'focus';
        this.routeSectorIndex = safeIndex;
        this._landmarkProjectionCache = null;
        const area = this._getMapViewRect();
        if (this._getLandmarkRouteProfile()) {
            this._syncLandmarkRouteTransform();
            if (updateControls) this._updateRouteControls();
            return;
        }
        const focusNodes = this._getRouteSectorNodes(safeIndex, true);
        const bounds = this._calculateNodeBounds(focusNodes);
        const paddingX = 110;
        const paddingY = 92;
        const routeW = bounds.maxX - bounds.minX + paddingX * 2;
        const routeH = bounds.maxY - bounds.minY + paddingY * 2;
        const fitScale = Math.min(area.width / routeW, area.height / routeH, 1.55);
        this.mapScale = this._usesExplorationConsole() ? Math.max(0.8, Math.min(fitScale, 1.2))
            : this._usesSplitRouteMap() ? Math.max(0.95, Math.min(fitScale, 1.2))
            : Math.max(this.ROUTE_FOCUS_MIN_SCALE, Math.min(fitScale, this.MAX_MAP_SCALE));
        const focusNode = focusNodeId ? this.nodes.find(node => node.id === focusNodeId) : null;
        const focusPoint = focusNode && this._getRoutePoint(focusNode);
        const focusX = focusPoint ? focusPoint.x : bounds.cx;
        const focusY = focusPoint ? focusPoint.y : bounds.cy;
        this.mapOffsetX = area.left + area.width / 2 - focusX * this.mapScale;
        this.mapOffsetY = area.top + area.height / 2 - focusY * this.mapScale;
        this._clampMapOffset();
        if (updateControls) this._updateRouteControls();
    },

    // ───────────────────────────────────────────────
    // 更新与交互
    // ───────────────────────────────────────────────
    update(_dt) {
        if (!this.active || this._observerSuspended || this.state !== "map") return;
        this._mapAnimT += _dt;
        this._setMapStatusBarVisible(true);
        const routeClick = this._pendingRouteClick;
        this._pendingRouteClick = null;
        if (!this._usesExplorationConsole()) this._updateHover(routeClick || Input.mouse);
        if (routeClick && !this._usesExplorationConsole()) {
            this._handleClick(routeClick);
        }
        // 本次按下期间的拖动标记保留到下一次按下，停顿一帧不能变回点击。
        // 顶部状态栏（生命/魔法/等级，200ms 节流刷新）
        this._statusBarTimer = (this._statusBarTimer || 0) + _dt;
        if (this._statusBarTimer >= 200) {
            this._statusBarTimer = 0;
            this._updateMapStatusBar();
        }
    },

    updateCombat(dt) {
        if (!this.active || this._observerSuspended || (this.state !== "combat" && this.state !== "boss")) return;
        // 战斗模式隐藏地图状态栏（战斗内使用游戏内 HUD 血条，避免双条重叠）
        this._setMapStatusBarVisible(false);

        // Boss 战模式：委托给 BossRewardSystem 更新，并检测门闸白区/传送门
        if (this.state === "boss") {
            if (BossRewardSystem.isBossBattleActive && BossRewardSystem.isBossBattleActive()) {
                BossRewardSystem.update(dt);
            }

            // 门闸动画推进与悬停高亮（Boss 房复用 CombatRoomSystem 门闸机制，同战斗房路径）
            if (typeof CombatRoomSystem.update === 'function') {
                CombatRoomSystem.update(dt);
            }

            // 走出门外白区离场（门闸化：与普通战斗房同一判定）
            if (CombatRoomSystem.isPlayerInGateZone && CombatRoomSystem.isPlayerInGateZone(this.player)) {
                this._leaveBossViaPortal();
                return;
            }

            // 兜底：门闸缺失（placeAt 失败等异常路径）时回退出口传送门
            const portal = BossRewardSystem.getExitPortal && BossRewardSystem.getExitPortal();
            if (portal && portal.active && this.player) {
                const dx = this.player.x - portal.x;
                const dy = this.player.y - portal.y;
                if (Math.sqrt(dx * dx + dy * dy) <= portal.radius) {
                    this._leaveBossViaPortal();
                }
            }
            return;
        }

        // 检测战斗完成（CombatRoomSystem 或僵尸地牢自己的系统）
        const isCombatDone = this._isZombieFamily()
            ? this._checkZombieCombatComplete()
            : CombatRoomSystem.isCombatComplete();

        if (isCombatDone) {
            const currentNode = this.getCurrentNode();
            const isEliteNode = currentNode && currentNode.isElite;

            // 战斗完成即打开大门（精英/普通同路径；节点完成标记在离场时统一打）
            if (!this._exitPortalSpawned) {
                this._exitPortalSpawned = true;
                CombatRoomSystem.openGate();
                // 清剿奖 + 连战奖励结算（开门时一次性发放；连战计数随之推进）
                this._settleCombatRoom();

                // 精英节点 / 三房间竞技场（普通战斗也生成宝箱房）：通知宝箱房（限时内完成 → 打开宝箱房门墙）
                if ((isEliteNode || CombatRoomSystem._arena) && typeof ChestRoomSystem !== 'undefined' && ChestRoomSystem.active) {
                    ChestRoomSystem.onCombatComplete();
                    if (SceneManager && SceneManager.showTopNotification) {
                        SceneManager.showTopNotification(ChestRoomSystem.hasUnopenedLoot() ? '精英已消灭，宝箱房已开启！' : '已完成战斗，从大门离开');
                    }
                } else if (SceneManager && SceneManager.showTopNotification) {
                    SceneManager.showTopNotification('已完成战斗，从大门离开');
                }
            }
        }

        // 驱动门闸动画与悬停高亮
        if (typeof CombatRoomSystem.update === 'function') {
            CombatRoomSystem.update(dt);
        }

        // 三房间竞技场：玩家进入等待中的下一房间 → 关门刷对应波次
        if (CombatRoomSystem._arena) {
            this._checkArenaRoomEntry();
            this._updateArenaDoorClose(dt);
        }

        // 检测玩家是否走出门外白区（与传送门同效：回地牢地图）
        if (CombatRoomSystem.isPlayerInGateZone && CombatRoomSystem.isPlayerInGateZone(this.player)) {
            // 离场守卫：场地内还有未开宝箱 → 先弹确认框（是=正常离场清场 / 否=退回场内）
            if (typeof ChestRoomSystem !== 'undefined' && ChestRoomSystem.hasUnopenedLoot()
                && !this._chestLeaveConfirm && !(this._chestLeaveCd > 0)) {
                this._showChestLeaveConfirm();
            } else if (!this._chestLeaveConfirm) {
                this._leaveCombatViaPortal();
            }
        }
        // 离场确认后的防连发冷却
        if (this._chestLeaveCd > 0) this._chestLeaveCd -= dt / 1000;
    },

    /** 战斗房清剿结算（方案A 清剿奖 + 连战奖励）：
     *  连战计数 +1（连续清空战斗节点；事件节点清零、empty 不计不断）；
     *  清剿奖（段预算 share 池按节点清算）与房内击杀经验同乘连战倍率，一次性发放 */
    _settleCombatRoom() {
        const player = this.player || Game.player;
        if (!player) return;
        DungeonRunStats.combatStreak++;
        const streak = DungeonRunStats.combatStreak;
        const mul = getStreakMultiplier(streak);
        const clearBonus = Math.round(getRoomClearBonus(this.dungeonType) * mul);
        const roomKillExp = DungeonRunStats.settleRoomExp();
        const streakBonus = Math.round(roomKillExp * (mul - 1));
        const total = clearBonus + streakBonus;
        if (total > 0) {
            DungeonRunStats.recordBonusExp(total);
            player.gainExp(total, mul > 1 ? 'streak' : null);
            if (SceneManager && SceneManager.showTopNotification && streak >= 3) {
                SceneManager.showTopNotification(`⚔ ${streak} 连战！经验 ×${mul.toFixed(2)}`);
            }
        }
    },

    /** 冷钢决策模态：统一结构、焦点循环与 Escape 取消，业务回调只处理结果。 */
    _createDecisionModal({ id, eyebrow, title, description, dangerText = '', tone = 'neutral', actions = [] }) {
        if (typeof document === 'undefined' || getElementIfExists(id)) return null;
        const previousFocus = document.activeElement;
        const overlay = document.createElement('div');
        overlay.id = id;
        overlay.className = 'dungeon-decision-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        const modal = document.createElement('section');
        modal.className = `dungeon-decision-modal dungeon-decision-modal--${tone}`;
        const eyebrowEl = document.createElement('div');
        eyebrowEl.className = 'dungeon-decision-eyebrow';
        eyebrowEl.textContent = eyebrow;
        const titleEl = document.createElement('h2');
        titleEl.id = `${id}Title`;
        titleEl.className = 'dungeon-decision-title';
        titleEl.textContent = title;
        const descriptionEl = document.createElement('p');
        descriptionEl.id = `${id}Description`;
        descriptionEl.className = 'dungeon-decision-description';
        descriptionEl.append(document.createTextNode(description));
        if (dangerText) {
            const danger = document.createElement('strong');
            danger.className = 'dungeon-decision-warning';
            danger.textContent = dangerText;
            descriptionEl.append(document.createElement('br'), danger);
        }
        const actionsEl = document.createElement('div');
        actionsEl.className = 'dungeon-decision-actions';
        modal.append(eyebrowEl, titleEl, descriptionEl, actionsEl);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        overlay.setAttribute('aria-labelledby', titleEl.id);
        overlay.setAttribute('aria-describedby', descriptionEl.id);

        let closed = false;
        const close = ({ restoreFocus = true } = {}) => {
            if (closed) return;
            closed = true;
            overlay.remove();
            if (restoreFocus && previousFocus?.isConnected && typeof previousFocus.focus === 'function') {
                previousFocus.focus({ preventScroll: true });
            }
        };
        const buttons = actions.map((action) => {
            const button = document.createElement('button');
            button.id = action.id;
            button.type = 'button';
            button.className = `bp-button dungeon-decision-button dungeon-decision-button--${action.kind || 'muted'}`;
            button.textContent = action.label;
            button.setAttribute('aria-label', action.ariaLabel || action.label);
            if (action.cancel) button.dataset.cancel = 'true';
            button.addEventListener('click', () => action.onSelect?.({ close, overlay, button }));
            actionsEl.appendChild(button);
            return button;
        });
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                const cancel = buttons.find(button => button.dataset.cancel === 'true');
                if (cancel) {
                    event.preventDefault();
                    cancel.click();
                }
                return;
            }
            if (event.key !== 'Tab' || buttons.length < 2) return;
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
        const initialButton = buttons.find((button, index) => actions[index]?.autofocus) || buttons[0];
        requestAnimationFrame(() => initialButton?.focus({ preventScroll: true }));
        return { overlay, close, buttons };
    },

    /** 未开宝箱离场确认框：离开=正常清场进路线图；返回=退回场内 */
    _showChestLeaveConfirm() {
        this._chestLeaveConfirm = true;
        const modal = this._createDecisionModal({
            id: 'chestLeaveConfirm',
            eyebrow: 'LOOT ARCHIVE // UNCLAIMED CACHE',
            title: '仍有未领取的宝箱',
            description: '离开战斗场地后，本房间将按正常流程清理。',
            dangerText: '尚未获取的宝箱奖励将永久丢失。',
            tone: 'warning',
            actions: [
                {
                    id: 'chestLeaveNo',
                    label: '返回场内',
                    kind: 'muted',
                    cancel: true,
                    autofocus: true,
                    onSelect: ({ close }) => {
                        close();
                        this._chestLeaveConfirm = false;
                        // 退回场内：从门区向场地中心方向退回一段，并给 1s 冷却防连发
                        const b = CombatRoomSystem._roomBounds;
                        if (b && this.player) {
                            const dx = b.cx - this.player.x, dy = b.cy - this.player.y;
                            const len = Math.hypot(dx, dy) || 1;
                            this.player.x += dx / len * 160;
                            this.player.y += dy / len * 160;
                        }
                        this._chestLeaveCd = 1;
                    },
                },
                {
                    id: 'chestLeaveYes',
                    label: '确认离开',
                    kind: 'danger',
                    onSelect: ({ close }) => {
                        close({ restoreFocus: false });
                        this._chestLeaveConfirm = false;
                        this._leaveCombatViaPortal();
                    },
                },
            ],
        });
        if (!modal) {
            this._chestLeaveConfirm = false;
        }
    },

    _updateHover(pointer = Input.mouse) {
        const mx = pointer.x;
        const my = pointer.y;
        if (this.routeViewMode !== 'overview') this._syncLandmarkRouteTransform();
        const previousHoverId = this.hoveredNodeId;
        const existingDossier = getElementIfExists('dungeonNodeTooltip');
        const previousNode = previousHoverId ? this.nodes.find(node => node.id === previousHoverId) : null;
        if (this._usesLandmarkMap() && this._isRouteNodePresented(previousNode)
            && this.isNodeClickable(previousNode) && existingDossier?.matches(':hover')) {
            document.body.style.cursor = '';
            return;
        }
        this.hoveredNodeId = null;

        if (this.routeViewMode === 'overview') {
            document.body.style.cursor = '';
            this._removeNodeTooltip();
            return;
        }

        const hoveredNode = this._hitTestRouteNode(pointer, { inspectOnly: this._usesLandmarkMap() });
        this.hoveredNodeId = hoveredNode?.id || null;
        document.body.style.cursor = hoveredNode && this.isNodeClickable(hoveredNode)
            ? 'var(--bp-cursor-pointer, pointer)' : '';
        // 节点经验/奖励预览（方案D：悬停即见收益，绕开战斗=明确损失）
        this._updateNodeTooltip(mx, my);
    },

    /** 悬停节点预览：战斗/Boss 显示预估经验，事件显示类型（连战进度附带显示） */
    _updateNodeTooltip(mx, my) {
        if (this._usesLandmarkMap()) {
            this._updateLandmarkNodeDossier();
            return;
        }
        let el = getElement('dungeonNodeTooltip');
        const node = this.hoveredNodeId ? this.nodes.find(n => n.id === this.hoveredNodeId) : null;
        if (!node || node.type === 'empty' || node.type === 'start') {
            if (el) el.style.display = 'none';
            return;
        }
        if (!el) {
            el = document.createElement('div');
            el.id = 'dungeonNodeTooltip';
            el.className = 'dungeon-route-tooltip';
            el.setAttribute('role', 'tooltip');
            document.body.appendChild(el);
        }
        const streak = DungeonRunStats.combatStreak;
        const mul = getStreakMultiplier(streak + 1); // 下一战的倍率预览
        let text = '';
        if (node.type === 'combat') {
            const est = Math.round(getRoomExpEstimate(this.dungeonType, !!node.isElite) * mul);
            text = `${node.isElite ? '[精英] 精英战斗' : '[战斗] 普通战斗'} ≈ +${est} EXP`;
            if (streak >= 2) text += `（连战 x${streak + 1} ×${mul.toFixed(2)}）`;
        } else if (node.type === 'boss') {
            const bossEst = Math.round((getDungeonExpBase(this.dungeonType) * 10 + getRoomClearBonus(this.dungeonType)) * mul);
            text = `[首领] Boss ≈ +${bossEst} EXP`;
            if (streak >= 2) text += `（连战 x${streak + 1} ×${mul.toFixed(2)}）`;
        } else if (node.type === 'event') {
            text = node.eventType === 'treasureChest' ? '[宝箱] 金币/材料' : '[事件] 随机事件';
            if (streak >= 3) text += '（选择将中断连战）';
        } else if (node.type === 'reward') {
            text = '[奖励] 战利品节点';
        }
        if (!text) { el.style.display = 'none'; return; }
        el.textContent = text;
        el.style.display = 'block';
        // 跟随鼠标（右上方偏移，防出屏）
        const w = el.offsetWidth || 200;
        el.style.left = `${Math.min(mx + 18, (typeof window !== 'undefined' ? window.innerWidth : 1920) - w - 12)}px`;
        el.style.top = `${Math.max(my - 36, 8)}px`;
    },

    /** 固定档案只使用迷雾已经允许的情报；未知事件不虚构低风险或保底奖励。 */
    _getExplorationNodeDetails(node) {
        const available = this.isNodeClickable(node);
        const current = node.id === this.currentNodeId;
        const visited = this.visitedNodeIds.has(node.id);
        const visibility = this.fogOfWar?.getNodeVisibility(node.id);
        const revealed = !this.fogOfWar || this.fogOfWar.enabled === false || current || available || visited
            || visibility === 'revealed' || visibility === 'visited';
        const type = revealed ? node.type : 'unknown';
        const elite = revealed && type === 'combat' && node.isElite;
        const iconKey = elite ? 'elite' : type === 'empty' ? 'start' : type;
        const titles = { start: '地牢入口', empty: '通行节点', combat: elite ? '精英遭遇' : '战斗房间',
            event: node.eventType === 'treasureChest' ? '宝箱事件' : '未知事件', boss: '首领据点', reward: '战利品房间', unknown: '未侦察房间' };
        let risk = '未确认', reward = '进入后揭示', clue = '情报尚未揭示，沿相邻房间继续探索。';
        const mul = getStreakMultiplier(DungeonRunStats.combatStreak + 1);
        if (type === 'combat' || type === 'boss') {
            risk = type === 'boss' ? '首领战' : elite ? '精英战' : '普通战斗';
            const exp = type === 'boss' ? (getDungeonExpBase(this.dungeonType) * 10 + getRoomClearBonus(this.dungeonType)) * mul
                : getRoomExpEstimate(this.dungeonType, !!node.isElite) * mul;
            reward = node.completed ? '本房间已完成' : `约 ${Math.round(exp).toLocaleString('zh-CN')} EXP`;
            clue = node.completed ? '此处已完成探索，可沿已开放的连接继续行进。'
                : elite ? '前方是精英战斗房间，请先确认队伍状态。' : type === 'boss' ? '路线通向首领据点，请做好最终战准备。' : '进入后将触发房间战斗。';
        } else if (type === 'start') {
            risk = '入口区域'; reward = '撤离时保留背包'; clue = '这是本次探险的入口。返回此处可以安全撤离。';
        } else if (type === 'empty') {
            risk = '通行区域'; reward = '无房间奖励'; clue = '沿通道前往下一处相邻房间。';
        } else if (type === 'event') {
            clue = node.completed ? '本房间事件已完成。' : '事件内容与检定结果将在进入后揭示。';
            reward = node.completed ? '本房间已完成' : '由事件结果决定';
        } else if (type === 'reward') {
            risk = '奖励节点'; reward = node.completed ? '本房间已完成' : '按实际结算发放'; clue = '这里是路线的战利品节点。';
        }
        return { number: String(this.nodes.indexOf(node) + 1).padStart(2, '0'), title: titles[type], revealed,
            state: current ? '当前位置' : available ? '可前往' : visited ? '已探索 · 非相邻' : '当前不可前往',
            icon: this.ROUTE_NODE_ICON_PATHS[iconKey] || this.ROUTE_NODE_ICON_PATHS.unknown,
            risk, reward, clue, danger: !node.completed && (elite || type === 'boss'),
            note: !revealed ? '未揭示的房间不显示类型或具体奖励。'
                : available ? (node.completed ? '可沿原路返回；进入前仍检查当前可达关系。' : '收益为估算，最终以实际结算为准。')
                    : current ? '先选择相邻房间，再点击下方进入节点。' : '只能进入与当前位置直接相连的房间。' };
    },

    /** 地标路线的节点档案卡：只承载现有节点数据，不改变可达性或点击进入流程。 */
    _updateLandmarkNodeDossier() {
        let el = getElementIfExists('dungeonNodeTooltip');
        const node = this.hoveredNodeId ? this.nodes.find(n => n.id === this.hoveredNodeId) : null;
        if (!this._isRouteNodePresented(node) || !this.isNodeClickable(node) || node.type === 'empty' || node.type === 'start') {
            if (el) el.style.display = 'none';
            return;
        }
        if (!el) {
            el = document.createElement('aside');
            el.id = 'dungeonNodeTooltip';
            el.className = 'dungeon-route-tooltip dungeon-route-node-dossier';
            el.setAttribute('aria-label', '节点档案');
            el.innerHTML = `
                <div class="dungeon-route-dossier-kicker"></div>
                <div class="dungeon-route-dossier-title"></div>
                <div class="dungeon-route-dossier-risk"></div>
                <div class="dungeon-route-dossier-clue"></div>
                <div class="dungeon-route-dossier-reward"></div>
                <button type="button" class="bp-button dungeon-route-dossier-enter">进入节点</button>`;
            el.querySelector('.dungeon-route-dossier-enter')?.addEventListener('click', () => {
                const target = this.nodes.find(candidate => String(candidate.id) === el.dataset.nodeId);
                if (this.active && this.state === 'map' && this._isRouteNodePresented(target) && this.isNodeClickable(target)) {
                    this._enterNode(target);
                }
            });
            document.body.appendChild(el);
        }

        const nodeIndex = Math.max(0, this.nodes.findIndex(candidate => candidate.id === node.id)) + 1;
        const typeTitle = node.type === 'boss'
            ? '首领据点'
            : (node.type === 'combat'
                ? (node.isElite ? '精英战区' : '战斗节点')
                : (node.type === 'event'
                    ? (node.eventType === 'treasureChest' ? '隐秘宝库' : '未知事件')
                    : '战利品节点'));
        const danger = node.type === 'boss' ? 3 : (node.isElite ? 3 : (node.type === 'combat' ? 2 : 1));
        const clue = node.type === 'boss'
            ? '终点防线已确认，首领守卫正在集结。'
            : (node.type === 'combat'
                ? (node.isElite ? '侦测到高威胁目标与强化守卫。' : '前方通道存在持续战斗迹象。')
                : (node.type === 'event'
                    ? '地标信号不完整，进入后触发现场事件。'
                    : '路线标记显示这里存放着可回收战利品。'));
        let reward = '可能奖励：金币、材料或随机战利品';
        if (node.type === 'combat') {
            const mul = getStreakMultiplier(DungeonRunStats.combatStreak + 1);
            reward = `预估收益：约 ${Math.round(getRoomExpEstimate(this.dungeonType, !!node.isElite) * mul)} EXP`;
        } else if (node.type === 'boss') {
            const mul = getStreakMultiplier(DungeonRunStats.combatStreak + 1);
            reward = `预估收益：约 ${Math.round((getDungeonExpBase(this.dungeonType) * 10 + getRoomClearBonus(this.dungeonType)) * mul)} EXP 与首领奖励`;
        } else if (node.type === 'reward') {
            reward = '预估收益：战利品结算';
        }

        el.dataset.nodeId = node.id;
        el.querySelector('.dungeon-route-dossier-kicker').textContent = `节点 ${String(nodeIndex).padStart(2, '0')} · 路线情报`;
        el.querySelector('.dungeon-route-dossier-title').textContent = typeTitle;
        el.querySelector('.dungeon-route-dossier-risk').textContent = `危险等级 ${danger}/3`;
        el.querySelector('.dungeon-route-dossier-clue').textContent = clue;
        el.querySelector('.dungeon-route-dossier-reward').textContent = reward;
        const enter = el.querySelector('.dungeon-route-dossier-enter');
        if (enter) enter.disabled = !this._isRouteNodePresented(node) || !this.isNodeClickable(node);
        el.style.display = 'block';

        const point = this._getRoutePoint(node);
        const pos = this._mapToScreen(point.x, point.y);
        const view = this._getMapViewRect();
        const w = el.offsetWidth || 286;
        const h = el.offsetHeight || 220;
        const preferLeft = pos.x + 44;
        const left = preferLeft + w <= view.left + view.width
            ? preferLeft
            : pos.x - w - 44;
        el.style.left = `${Math.max(view.left + 8, Math.min(left, view.left + view.width - w - 8))}px`;
        el.style.top = `${Math.max(view.top + 8, Math.min(pos.y - h / 2, view.top + view.height - h - 8))}px`;
    },

    _removeNodeTooltip() {
        const el = getElement('dungeonNodeTooltip');
        if (el) el.remove();
    },

    _handleClick(pointer = Input.mouse) {
        // 点击重新命中当前画面，不能复用上一区段或档案卡残留的hover ID。
        const node = this._hitTestRouteNode(pointer);
        if (!node || !this.isNodeClickable(node)) return;
        this._enterNode(node);
    },

    _enterNode(node) {
        // 进入节点前隐藏地图按钮
        this._removeAbandonButton();
        this._removeRouteControls();
        this._removeNodeTooltip();
        // 左侧地牢信息（入侵几率标签 + 预期奖励面板）仅路线选择画面显示，
        // 进战斗/事件/奖励一律隐藏，返回地图时再恢复
        this._setMapInfoVisibility(false);

        // empty 节点仅用于通行；需要把当前位置移到该节点，否则无法继续向后续节点前进
        if (node.type === 'empty') {
            this.previousNodeId = this.currentNodeId;
            this.currentNodeId = node.id;
            this.visitedNodeIds.add(node.id);
            if (this.fogOfWar) {
                this.fogOfWar.visit(node.id, this.nodes, this.edges);
            }
            // 时空特工追击：回合推进（empty 节点不计入入侵拦截）
            AgentInvasionSystem.onPlayerEnterNode(node);
            this._returnToMap();
            return;
        }

        // 记录上一个节点，用于陷阱解除失败等回退场景
        this.previousNodeId = this.currentNodeId;
        this.currentNodeId = node.id;
        this.visitedNodeIds.add(node.id);

        // 更新迷雾系统
        if (this.fogOfWar) {
            this.fogOfWar.visit(node.id, this.nodes, this.edges);
        }

        // 时空特工追击：回合推进 + 追上后强制入侵战斗拦截
        AgentInvasionSystem.onPlayerEnterNode(node);
        if (AgentInvasionSystem.shouldIntercept(node)) {
            this._enterInvasionBattle(node);
            return;
        }

        switch (node.type) {
            case "combat": this._enterCombat(node); break;
            case "boss":   this._enterBoss(node); break;
            case "event":  this._enterEvent(node); break;
            case "reward": this._enterReward(node); break;
            default:       this._returnToMap(); break;
        }
    },

    /** 事件/战斗完成返回地图：保持当前缩放，聚焦居中玩家所在节点（不再重置回出发点） */
    _focusOnCurrentNode({ restoreDefaultZoom = false } = {}) {
        const node = this.getCurrentNode();
        if (!node) { this._centerRouteMap(); return; }
        const sectorIndex = this._getSectorIndexForNode(node);
        const sectorChanged = this.routeViewMode !== 'focus' || sectorIndex !== this.routeSectorIndex;
        if (restoreDefaultZoom || sectorChanged) {
            this._focusRouteSector(sectorIndex, { focusNodeId: node.id });
            return;
        }
        if (this._getLandmarkRouteProfile()) {
            this._syncLandmarkRouteTransform();
            this._updateRouteControls();
            return;
        }
        const area = this._getMapViewRect();
        const point = this._getRoutePoint(node);
        this.mapOffsetX = area.left + area.width / 2 - point.x * this.mapScale;
        this.mapOffsetY = area.top + area.height / 2 - point.y * this.mapScale;
        this._clampMapOffset();
        this._updateRouteControls();
    },

    _returnToMap() {
        // 已关闭（shutdown 后的泄漏定时器/异步回调）时直接忽略，避免在主神空间重建地牢 UI
        if (!this.active) return;
        RuntimeAssetManager.setDungeonEnemyTypes([]);
        this.state = "map";
        if (this._explorationConsole) this._explorationConsole.selectedId = this.currentNodeId;
        // 月影增伤标记随战斗结束清除
        if (this.player) this.player._moonshadowBoostActive = false;
        Camera.follow = () => {};
        Camera.x = this.CENTER_X;
        Camera.y = this.CENTER_Y;

        // 清理事件/战斗残留的浮动文字
        if (EffectManager && EffectManager.clearFloatingTexts) {
            EffectManager.clearFloatingTexts();
        }

        // 显示地图界面按钮
        this._createAbandonButton();
        this._updateSafeEvacButton();
        this._initializeRoutePresentation({ restoreDefaultZoom: false });
        // 恢复左侧地牢信息（仅路线选择画面显示）
        this._setMapInfoVisibility(true);

        const current = this.getCurrentNode();
        if (current && current.type === "boss" && this.visitedNodeIds.has(current.id)) {
            this._showVictory();
        }
    },

    // 通过出口传送门离开战斗：发放奖励、清理战斗场地、删除掉落物、返回地图
    _leaveCombatViaPortal() {
        const player = this.player || Game.player;
        if (!player) return;

        // 时空特工入侵战胜利（情况1/3 与混合战都经此出口）：删除左侧入侵几率标签
        if (this._invasionNode && typeof AgentInvasionSystem !== 'undefined') {
            AgentInvasionSystem.onInvasionDefeated();
        }

        // 时空特工入侵战（情况1/3）：不标完成，清理后继续原节点事件
        if (this._invasionNode && !this._invasionMixed) {
            const node = this._invasionNode;
            this._invasionNode = null;
            this._invasionMixed = false;
            this._consumeCombatBuffs(player);
            this._cleanupCombatScene();
            const phaserScene = window.__phaserScene;
            if (phaserScene && phaserScene.clearCombatView) {
                phaserScene.clearCombatView();
            }
            this._exitPortalSpawned = false;
            this._continueNodeEventAfterInvasion(node);
            return;
        }

        // 战斗完成后消耗女神祝福层数
        this._consumeCombatBuffs(player);

        // 节点清空前先保存类型；_markCurrentNodeCompleted 会把 boss 改成 empty。
        const currentNode = this.getCurrentNode();
        const isBoss = currentNode && currentNode.type === 'boss';

        // 统一标记当前节点已完成
        this._markCurrentNodeCompleted();

        // 战斗节点清剿奖；独立 bossEncounter 也走同一等级 Boss 金币真源。
        const gold = CombatRoomSystem.getGoldReward(isBoss, this.dungeonType);
        if (gold > 0 && GoldManager) {
            GoldManager.addGold(gold);
            EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, `获得 ${gold} 金币`, '#ffd700'));
        }

        // 清理战斗场地（怪物、传送门、掉落物、恢复原始地形）
        this._cleanupCombatScene();

        // 清理 Phaser 战斗视觉残留（敌人/掉落物/传送门 Sprite）
        const phaserScene = window.__phaserScene;
        if (phaserScene && phaserScene.clearCombatView) {
            phaserScene.clearCombatView();
        }

        // 重置传送门生成标记
        this._exitPortalSpawned = false;

        // 返回地图模式
        this._returnToMap();
    },

    // 通过出口传送门离开 Boss 战：清理场地并返回地图
    _leaveBossViaPortal() {
        const player = this.player || Game.player;
        if (!player) return;

        // Boss 房清剿结算（集合体 Boss 也计入连战）
        this._settleCombatRoom();

        // 战斗完成后消耗女神祝福层数
        this._consumeCombatBuffs(player);

        // 离开 Boss 战（清理场地、触发完成回调）
        BossRewardSystem.leaveBossBattle();

        // 清理 Phaser 战斗视觉残留
        const phaserScene = window.__phaserScene;
        if (phaserScene && phaserScene.clearCombatView) {
            phaserScene.clearCombatView();
        }

        // 重置传送门生成标记
        this._exitPortalSpawned = false;

        // 返回地图模式
        this._returnToMap();
    },

    /**
     * 统一标记当前节点已完成（变为 empty），供普通/精英战斗共用
     */
    /** 节点置空并清理事件/战斗附加标记（isElite 紫圈★/强制怪/遭遇覆盖/事件类型不再残留） */
    _clearNodeToEmpty(node, completed = false, allowBoss = false) {
        if (!node || node.type === 'empty' || node.type === 'start') return;
        if (node.type === 'boss' && !allowBoss) return;
        node.type = 'empty';
        if (completed) node.completed = true;
        node.isElite = false;
        node.forceMonsters = null;
        node.encounterOverride = null;
        node.eventType = null;
    },

    _markCurrentNodeCompleted() {
        const currentNode = this.getCurrentNode();
        // boss 节点也允许标记：集合体 Boss 走 _leaveBossViaPortal（不调本方法），
        // 初级地牢 boss 作为精英战斗节点，经普通战斗流程在此完成标记
        this._clearNodeToEmpty(currentNode, true, true);
    },

    _enterCombat(node) {
        this.state = "combat";
        // 左侧地牢信息仅路线选择画面显示（_enterNode 已隐藏；此处兜底直调路径）
        this._setMapInfoVisibility(false);
        // 普通战斗入口重置入侵标记（入侵混合战由 _enterInvasionBattle 单独设置）
        this._invasionNode = null;
        this._invasionMixed = false;
        // 进入新战斗前，先清理上一场战斗可能残留的传送门/掉落物
        this._cleanupCombatScene();
        this._exitPortalSpawned = false;

        // 场地固定档位（配置驱动，支持地牢级覆盖）：普通 1024 / 精英 1792
        const _crCfg = DungeonConfig.getCombatRoomConfig(this.dungeonType);
        const combatOptions = { roomSize: node.isElite ? _crCfg.eliteSize : _crCfg.normalSize, dungeonType: this.dungeonType };

        if (this._isZombieFamily()) {
            this._enterZombieCombat(node, combatOptions);
            return;
        }

        // 使用 CombatRoomSystem 生成随机战斗场地
        CombatRoomSystem.enterCombatRoom(this.player, false, combatOptions);
        // 精英战斗：场地中央生成宝箱房（与僵尸路径同规则）
        if (node.isElite && typeof ChestRoomSystem !== 'undefined') {
            ChestRoomSystem.setup(this.dungeonType, CombatRoomSystem._roomBounds, { isElite: !!node.isElite });
        }
        // 生成普通怪物
        CombatRoomSystem.spawnMonsters(3, false);
        EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, "进入战斗！消灭所有敌人", "#ff4444"));
    },

    _enterZombieCombat(node, options = {}) {
        const arenaRoomCount = DungeonConfig.getCombatArenaRoomCount(this.dungeonType, !!node.isElite);
        if (DungeonConfig.isCombatArenaEnabled(this.dungeonType, !!node.isElite)) {
            return this._enterCombatArena(node, arenaRoomCount);
        }
        this._zombieCombatNode = node;
        this._zombieWaveActive = true;
        this._zombieCombat = new ZombieDungeonCombat(undefined, !!node.isElite, node.encounterOverride || null, this.dungeonType, node.forceMonsters || null);
        // 月影庇护：进入战斗触发无敌；精英战同时激活增伤
        this._triggerMoonshadow(!!node.isElite);

        // 所有僵尸战斗统一使用 CombatRoomSystem 生成随机房间
        CombatRoomSystem.enterCombatRoom(this.player, false, options);
        // 陷阱：按地牢配置在房内摆放（zombieDungeon.traps；无碰撞，占用触发）
        if (typeof TrapSystem !== 'undefined') {
            const zcfg = DungeonConfig.getZombieDungeonConfig(this.dungeonType) || {};
            if (zcfg.traps && zcfg.traps.count > 0) {
                TrapSystem.spawnForRoom(CombatRoomSystem._roomBounds, zcfg.traps, this._trapExtras());
            }
        }
        // 精英战斗：场地中央生成宝箱房（门墙常闭 + 等级宝箱 + 60s 倒计时，房内不刷怪）
        if (node.isElite && typeof ChestRoomSystem !== 'undefined') {
            ChestRoomSystem.setup(this.dungeonType, CombatRoomSystem._roomBounds, { isElite: !!node.isElite });
        }
        this._spawnZombieWave();
    },

    /**
     * 墓碑事件（僵尸地牢初级/中级/高级 · 普通战斗每次房间刷怪 25% 概率）：
     * 在距玩家最远的角落生成墓碑（站桩召唤器，enemy-config noPool 不进任何刷怪池）。
     * 由 _spawnZombieWave 在刷怪后调用（_combatMonsterKeys 重置之后才能登记 key）；
     * F/E 单房间跨波次不删除墓碑及其召唤物（cleanupMonstersOnly 保留 tombstone_ 前缀），
     * D+ 竞技场换房间时随房间清理删除。
     * 生成点判定流程：
     *   1. 候选角落：矩形房取外接矩形四角（内收），菱形房取对角线方向与菱形边界的交点（内收）；
     *      按距玩家从远到近排序，保证"最远角落"优先；
     *   2. 可达性：WallSystem.canMoveTo 可行走（不嵌墙/障碍物）
     *      + pathFinder.findPath 能寻路到玩家当前位置（保证生成的僵尸能走出寻敌）；
     *   3. 角落本身不合格则在其周围按半径 40/80/120/160 做 8 向螺旋搜索；
     *   4. 该角落全失败换次远角落；全部失败放弃本次生成（打印警告）。
     * 墓碑只登记 key 进 _combatMonsterKeys（随波次/房间清理），不进 _combatMonsters——
     * 生成器不计入战斗完成判定（与矿洞同口径）。
     */
    _maybeSpawnTombstone(forceSpawn = null) {
        // 仅僵尸地牢三级（zombieBeginner / zombieMid / zombie）的普通战斗，沼泽等其他地牢不触发
        if (!['zombieBeginner', 'zombieMid', 'zombie'].includes(this.dungeonType)) return;
        // 精英/Boss 节点不刷（与普通战斗区分；_enterBossCombat 的 boss 节点同样排除）
        const node = this._zombieCombatNode;
        if (!node || node.isElite || node.type === 'boss') return;
        if (forceSpawn === false || (forceSpawn !== true && Math.random() >= 0.25)) return;
        const bounds = CombatRoomSystem._roomBounds;
        const player = this.player;
        if (!bounds || !player) return;

        const TOMB_RADIUS = 60;             // 墓碑地面占位半径（碰撞 120×60 的一半量级）
        const PROBE_RADIUS = 15;            // 寻路验证用僵尸半径（普通僵尸 groundRadius 量级）
        const INSET = TOMB_RADIUS + 20;     // 贴墙内收安全距离

        // 生成点：右上墙（T→R 边）中点，向房内内收（新规则；旧"距玩家最远角落"规则作废）
        let anchor;
        if (bounds.diamond) {
            const midX = bounds.cx + bounds.rx / 2, midY = bounds.cy - bounds.ry / 2;
            // 沿指向房心方向内收 INSET
            const dx = bounds.cx - midX, dy = bounds.cy - midY;
            const dl = Math.hypot(dx, dy) || 1;
            anchor = { x: midX + dx / dl * INSET, y: midY + dy / dl * INSET };
        } else {
            anchor = { x: bounds.maxX - INSET, y: bounds.minY + INSET };
        }

        // 房内判定（菱形房按菱形内缩判定）
        const inRoom = (x, y) => bounds.diamond
            ? Math.abs(x - bounds.cx) / Math.max(1, bounds.rx - INSET) + Math.abs(y - bounds.cy) / Math.max(1, bounds.ry - INSET) <= 1
            : (x >= bounds.minX + INSET && x <= bounds.maxX - INSET && y >= bounds.minY + INSET && y <= bounds.maxY - INSET);
        // 可行走 + 路线可达（生成前路线判定：僵尸能走出并寻找到玩家）
        const reachable = (x, y) => {
            if (!inRoom(x, y)) return false;
            if (WallSystem && typeof WallSystem.canMoveTo === 'function'
                && !WallSystem.canMoveTo(x, y, TOMB_RADIUS)) return false;
            if (pathFinder && typeof pathFinder.findPath === 'function') {
                const path = pathFinder.findPath(x, y, player.x, player.y, PROBE_RADIUS);
                if (!path || path.length === 0) return false;
            }
            return true;
        };

        // 先试锚点本身，再按递近半径做 8 向螺旋搜索
        const candidates = [{ x: anchor.x, y: anchor.y }];
        for (const r of [40, 80, 120, 160]) {
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2;
                candidates.push({ x: anchor.x + Math.cos(a) * r, y: anchor.y + Math.sin(a) * r });
            }
        }
        for (const c of candidates) {
            if (!reachable(c.x, c.y)) continue;
            const tombstone = createTombstone(c.x, c.y);
            const key = `tombstone_main_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            if (Game && Game.entities) Game.entities.set(key, tombstone);
            // 纳入战斗怪物 key 追踪：波次切换/房间清理随 _combatMonsterKeys 统一删除
            if (CombatRoomSystem._combatMonsterKeys) CombatRoomSystem._combatMonsterKeys.push(key);
            // 地牢刷怪同款黑色粒子
            const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
            if (scene && typeof scene.playDungeonSpawnParticles === 'function') {
                scene.playDungeonSpawnParticles(c.x, c.y);
            }
            return;
        }
        console.warn('[DungeonMapSystem] 墓碑生成失败：右上墙中点区域均不可行走/不可达玩家，本次放弃生成');
    },

    /** 月影庇护：进战斗给无敌，精英/Boss 战额外给增伤标记 */
    _triggerMoonshadow(isEliteOrBoss) {
        const ms = getMoonshadowConfig();
        if (!ms || !this.player) return;
        this.player._moonshadowTimer = ms.duration;
        if (isEliteOrBoss) this.player._moonshadowBoostActive = true;
    },

    /**
     * 陷阱生成约束：可达性锚点 + 宝箱房排除区 + 门口排除点（出口门/竞技场通道门）
     * @param {number} [roomIdx] 竞技场房间号（1~3，创建时逐房预生成）；缺省 = 当前房间
     */
    _trapExtras(roomIdx) {
        const exclusions = (typeof ChestRoomSystem !== 'undefined' && ChestRoomSystem._exclusion)
            ? [ChestRoomSystem._exclusion] : [];
        const avoidPoints = [];
        const gateInfo = (typeof WallGate !== 'undefined' && WallGate.getGateInfo) ? WallGate.getGateInfo() : null;
        if (gateInfo && gateInfo.center) avoidPoints.push({ x: gateInfo.center.x, y: gateInfo.center.y, r: 150 });
        const arena = CombatRoomSystem._arena;
        if (arena) {
            for (const rec of arena.passages) {
                for (const inst of rec.gates) avoidPoints.push({ x: inst.center.x, y: inst.center.y, r: 150 });
            }
            // 入场门也排除（门口 150px 不放陷阱）
            if (arena.entryGate && arena.entryGate.center) {
                avoidPoints.push({ x: arena.entryGate.center.x, y: arena.entryGate.center.y, r: 150 });
            }
        }
        // 目标房间：竞技场创建时逐房预生成（roomIdx 指定），否则当前房间 _roomBounds
        const stage = arena ? (roomIdx || arena.stage) : 0;
        const bounds = (arena && roomIdx)
            ? CombatRoomSystem.getArenaRoomBounds(roomIdx)
            : CombatRoomSystem._roomBounds;
        // 房间 1/2：石柱陷阱线锚点 = 房心（从中央石柱底座中心出发，随机左/右沿屏幕水平方向
        // 每 traps.lineSpacing 放一个直到墙边，数量由距离决定）；房间 3 及单房间走随机环带
        const lineFrom = (stage === 1 || stage === 2) && bounds
            ? { x: bounds.cx, y: bounds.cy }
            : null;
        // 可达性锚点（仅预生成时传；单房间/关门后路径缺省回退玩家位置，保持旧行为）：
        // 房间 1/2 锚房心；房间 3 房心在宝箱房内（门墙常闭不可达）→ 锚本房通道门点
        let reachFrom = null;
        if (arena && roomIdx && bounds) {
            reachFrom = { x: bounds.cx, y: bounds.cy };
            const lastIdx = arena.rooms ? arena.rooms.length : 3;
            if (stage === lastIdx) {
                const inPass = arena.passages[lastIdx - 2];
                const g = inPass && inPass.gates[0];
                if (g && g.center) reachFrom = { x: g.center.x, y: g.center.y };
            }
        }
        return { player: this.player, exclusions, avoidPoints, lineFrom, reachFrom };
    },

    /**
     * 多房间竞技场：
     * - 除末房外使用普通战斗房大小，末房使用精英房大小并生成宝箱；
     * - 房间 N 刷第 N 波；进入房间才关门刷怪，清完开门，末房清完开出口门墙。
     * 墙预制库未就绪（BootScene 预载是 fire-and-forget，资源慢时可能还没拉完）时
     * 不再静默回退——等加载完成后重试；仍构建失败（通道预制缺失等）才回退原单房间流程。
     */
    _enterCombatArena(node, roomCount = 3) {
        // 预制库未就绪：延迟重试——等加载 Promise resolve 后再进战斗，期间给玩家短暂加载提示
        if (!isWallPrefabsLoaded()) {
            if (this._arenaPrefabsWaiting) return; // 已有等待在进行（防重入重复建场）
            this._arenaPrefabsWaiting = true;
            console.warn('[DungeonMapSystem] 墙预制库未就绪，等加载完成后重试竞技场构建…');
            EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, '战斗场地加载中…', '#ffcc44'));
            whenWallPrefabsLoaded().then(() => {
                this._arenaPrefabsWaiting = false;
                // 等待期间被其他流程接管（离开战斗 / 别的路径已建好战斗场地）则放弃重试
                if (this.state !== 'combat' || CombatRoomSystem.state === 'combat') return;
                this._enterCombatArena(node, roomCount);
            });
            return;
        }
        this._zombieCombatNode = node;
        this._zombieWaveActive = true;
        this._zombieCombat = new ZombieDungeonCombat(undefined, !!node.isElite, node.encounterOverride || null, this.dungeonType, node.forceMonsters || null);
        // 月影庇护：进入战斗触发无敌；精英战同时激活增伤
        this._triggerMoonshadow(!!node.isElite);

        const crCfg = DungeonConfig.getCombatRoomConfig(this.dungeonType);
        const arenaInfo = CombatRoomSystem.enterCombatArena(this.player, {
            normalSize: crCfg.normalSize,
            eliteSize: crCfg.eliteSize,
            roomCount,
            dungeonType: this.dungeonType, // 障碍物生成按地牢大类判定（僵尸/沼泽不同口径）
        });
        if (!arenaInfo) {
            // 预制缺失等异常：回退旧单房间流程（状态字段已初始化，与正常路径一致）
            // 注意：走到这里说明预制库已就绪仍构建失败（通道预制缺失/轴向不符），属配置级问题，打 error
            console.error('[DungeonMapSystem] 竞技场构建失败（预制库已就绪：通道预制缺失/轴向不符），回退单房间战斗');
            CombatRoomSystem.enterCombatRoom(this.player, false, { roomSize: node.isElite ? crCfg.eliteSize : crCfg.normalSize, dungeonType: this.dungeonType });
            if (node.isElite && typeof ChestRoomSystem !== 'undefined') {
                ChestRoomSystem.setup(this.dungeonType, CombatRoomSystem._roomBounds, { isElite: !!node.isElite });
            }
            this._spawnZombieWave();
            return;
        }
        // ⚠ 2026-08-08 十修：竞技场强制 N 波编排（一房一波，N = 房间数）必须放在
        // enterCombatArena **之后**——此前在进场前调用 getArenaRoomCount() 时 _arena
        // 尚未建立返回 0 → forceArenaWaves(0) 无效 → _totalWaves 保持遭遇默认（沼泽 3 波）
        // → 迷宫房3 清完 isComplete 提前 true → 走"战斗完成"只开末房出口门，房3 去路门
        // 永不开启（"第三个房间清完不开门"根因）。进场后再按真实房间数补足波次。
        const arenaRoomCount = CombatRoomSystem.getArenaRoomCount ? CombatRoomSystem.getArenaRoomCount() : 3;
        this._zombieCombat.forceArenaWaves(arenaRoomCount);

        // 宝箱房：最后一房间中央（普通/精英都生成；倒计时等玩家进入末房才启动）。
        // 僵尸系世界单格竞技场使用同标准黑砖实体宝箱房；冰封系仍保持开放式宝箱点，
        // 避免在已封闭末房中央重复套入另一层冰墙。
        if (typeof ChestRoomSystem !== 'undefined') {
            const lastRoomIdx = CombatRoomSystem.getArenaRoomCount();
            const lastRoomBounds = CombatRoomSystem.getArenaRoomBounds(lastRoomIdx);
            const dungeonCfg = DungeonConfig.getZombieDungeonConfig(this.dungeonType) || {};
            const usePhysicalTreasureRoom = crCfg.wallConstruction === 'worldBlock1x1'
                && dungeonCfg.wallStyle === 'zombie';
            const worldBlockRoom = usePhysicalTreasureRoom
                ? CombatRoomSystem.appendWorldBlockTreasureRoom(lastRoomBounds)
                : null;
            ChestRoomSystem.setup(this.dungeonType, lastRoomBounds, {
                deferCountdown: true,
                isElite: !!node.isElite,
                worldBlockRoom,
                openArena: crCfg.wallConstruction === 'worldBlock1x1' && !worldBlockRoom,
            });
        }

        // 陷阱：房间生成时逐房摆放（不再等玩家进房关门）；可达性锚点用本房内部参考点
        // （创建时玩家在入场地块、他房门未开，锚玩家会跨房寻路全灭——见 _trapExtras）
        if (typeof TrapSystem !== 'undefined') {
            const zcfg = DungeonConfig.getZombieDungeonConfig(this.dungeonType) || {};
            if (zcfg.traps && zcfg.traps.count > 0) {
                const roomN = CombatRoomSystem.getArenaRoomCount();
                for (let roomIdx = 1; roomIdx <= roomN; roomIdx++) {
                    const rb = CombatRoomSystem.getArenaRoomBounds(roomIdx);
                    if (!rb) continue;
                    try {
                        TrapSystem.spawnForRoom(rb, zcfg.traps, this._trapExtras(roomIdx));
                    } catch (e) {
                        console.error('[DungeonMapSystem] 陷阱生成异常（已兜底）:', e);
                    }
                }
            }
        }

        // 玩家在入场地块（房间 1 左上墙入场门外）——走进房间 1 才触发关门+刷第 1 波
        // （进场不刷怪/不关门，等待 _checkArenaRoomEntry 的进房判定）
        this._arenaRoomCleared = false;
        if (CombatRoomSystem._arena) CombatRoomSystem._arena.awaiting = 1;
    },

    /**
     * 竞技场关门延迟判定：进入房间后不立即关门——
     * 满 1 秒且玩家距来路门 ≥150px 才关闭该房间相邻通道门（防单位卡在门上）
     */
    _armArenaDoorClose(roomIdx) {
        const arena = CombatRoomSystem._arena;
        if (!arena) return;
        // 来路门：房间 1 = 入场门，其余房间 = 上一条通道的门（距离参照）
        let gates;
        if (roomIdx === 1 && arena.entryGate) {
            gates = [arena.entryGate];
        } else {
            const rec = roomIdx > 1 ? arena.passages[roomIdx - 2] : arena.passages[0];
            gates = rec ? rec.gates : [];
        }
        this._arenaDoorPending = { roomIdx, elapsed: 0, gates };
    },

    /** 每帧推进关门延迟判定（updateCombat 调用） */
    _updateArenaDoorClose(dt) {
        const p = this._arenaDoorPending;
        if (!p || !this.player) return;
        p.elapsed += dt;
        if (p.elapsed < 1000) return;
        // 关门前提：玩家仍在该房间内（回退到入场地块/通道时不关，防锁在门外）
        if (CombatRoomSystem.arenaRoomContaining(this.player.x, this.player.y) !== p.roomIdx) return;
        const minD = p.gates.length
            ? Math.min(...p.gates.map(g => Math.hypot(this.player.x - g.center.x, this.player.y - g.center.y)))
            : Infinity;
        if (minD < 150) return;
        CombatRoomSystem.setArenaRoomGates(p.roomIdx, false);
        this._arenaDoorPending = null;
        // 关门后才刷怪/启动倒计时（统一收口，防"刷怪不关门"）
        this._onArenaRoomSealed(p.roomIdx);
    },

    /** 竞技场：玩家进入等待中的下一房间 → 只判定进房并布防关门；刷怪在关门后（_updateArenaDoorClose） */
    _checkArenaRoomEntry() {
        const arena = CombatRoomSystem._arena;
        if (!arena || !arena.awaiting || !this.player) return;
        const roomIdx = CombatRoomSystem.arenaRoomContaining(this.player.x, this.player.y);
        if (roomIdx !== arena.awaiting) return;
        arena.awaiting = 0;
        this._arenaRoomCleared = false;
        // 重置刷怪标记：否则关门前的 1s 窗口里，清场判定会拿上一房间的死怪（allDead 成立）
        // 误触发"已清场"并把 _arenaRoomCleared 置真——真正杀完本房怪物时因标记已真而不再开门
        // （"第二间房清完门不开"的根因）
        arena.waveSpawned = false;
        CombatRoomSystem.setArenaStageRoom(roomIdx);
        this._armArenaDoorClose(roomIdx);
        // 注意：此处不再直接刷怪/启动宝箱倒计时——统一等关门后执行，
        // 堵"门没关就刷怪"的漏洞（关门条件见 _updateArenaDoorClose；陷阱创建时已摆好）
    },

    /** 关门后执行：刷对应波次 + （末房）启动宝箱倒计时（陷阱已在竞技场创建时逐房预生成） */
    _onArenaRoomSealed(roomIdx) {
        const arena = CombatRoomSystem._arena;
        if (!arena) return;
        const lastIdx = arena.rooms ? arena.rooms.length : 3;
        if (roomIdx === lastIdx && typeof ChestRoomSystem !== 'undefined' && ChestRoomSystem.active) {
            ChestRoomSystem.startCountdown();
        }
        // waveSpawned 由异步资源准备成功并实际刷怪后置位；准备期间由
        // _waveTransitioning 守卫清场判定，不能把空数组误判为已清房。
        this._spawnZombieWave();
    },

    _enemyTypesForFactories(factories) {
        const types = [];
        for (const factory of factories || []) {
            const type = ENEMY_TYPE_BY_FACTORY.get(factory);
            if (!type) throw new Error(`刷怪工厂未登记资源类型: ${factory?.name || 'anonymous'}`);
            types.push(type);
        }
        return types;
    },

    _shouldSpawnMixedInvasionWithWave() {
        if (!this._invasionMixed) return false;
        const arena = CombatRoomSystem._arena;
        return !arena || arena.stage === (arena.stageCount || arena.rooms.length);
    },

    _enemyTypesForWave(classes, invasionFactories = [], keepTombstoneResources = false) {
        const types = this._enemyTypesForFactories(classes.map(entry => entry.MonsterClass));
        types.push(...this._enemyTypesForFactories(invasionFactories));
        if (keepTombstoneResources) types.push('tombstone');
        return expandDungeonEnemyDependencies(types);
    },

    _hasActiveTombstone() {
        for (const [key, entity] of Game.entities || []) {
            if (String(key).startsWith('tombstone_') && entity?.active !== false) return true;
        }
        return false;
    },

    _rollTombstoneForWave() {
        const node = this._zombieCombatNode;
        return ['zombieBeginner', 'zombieMid', 'zombie'].includes(this.dungeonType)
            && !!node && !node.isElite && node.type !== 'boss'
            && Math.random() < 0.25;
    },

    async _prepareDungeonEnemyTypes(types) {
        const expanded = expandDungeonEnemyDependencies(types);
        // 换波清理发生在异步加载之前，立即提交一次真实实体集合，避免上一波已删除
        // 但 currentEnemyFamilies 尚未来得及在下一帧刷新而抬高本次上传峰值。
        RuntimeAssetManager.commitEnemyEntities(Game.entities?.values?.() || []);
        RuntimeAssetManager.setDungeonEnemyTypes(expanded);
        await RuntimeAssetManager.prefetchEnemyTypes(expanded, { required: true });
        return expanded;
    },

    _showEnemyLoadFailure(error, retry) {
        const detail = error?.message || '未知资源错误';
        console.error('[DungeonMapSystem] 地牢怪物资源准备失败:', error);
        SceneManager?.showTopNotification?.(`敌人资源准备失败：${detail}`);
        getElementIfExists('dungeonEnemyLoadFailure')?.remove();
        this._createDecisionModal({
            id: 'dungeonEnemyLoadFailure',
            eyebrow: 'ENEMY ASSET STREAM // INTERRUPTED',
            title: '敌人资源加载失败',
            description: detail,
            dangerText: '本波不会生成占位怪，也不会被判定为已清场。',
            tone: 'danger',
            actions: [
                {
                    id: 'dungeonEnemyLoadRetry',
                    label: '稍后重试',
                    kind: 'muted',
                    cancel: true,
                    autofocus: true,
                    onSelect: ({ close }) => {
                        close({ restoreFocus: false });
                        retry?.();
                    },
                },
                {
                    id: 'dungeonEnemyLoadExit',
                    label: '保留背包并退出',
                    kind: 'danger',
                    onSelect: ({ close }) => {
                        close({ restoreFocus: false });
                        this._exitDungeonAfterLoadFailure();
                    },
                },
            ],
        });
    },

    async _exitDungeonAfterLoadFailure() {
        const player = Game.player || this.player;
        this.shutdown();
        // 资源加载失败可能发生在 SceneManager 的 loading 生命周期内；先清掉旧锁，
        // 再强制重建主场景，不能让 switchScene 因 isLoading/currentScene 短路后假退出。
        SceneManager?.hideLoadingScreen?.();
        if (!player) {
            console.error('[DungeonMapSystem] 资源故障退出失败: 玩家实体不存在');
            alert('返回主神空间失败: 玩家实体不存在');
            return;
        }
        try {
            const switched = await SceneManager.switchScene('main', player, undefined, { forceReload: true });
            if (!switched || SceneManager.currentScene !== 'main') {
                throw new Error('主场景未完成切换');
            }
        } catch (error) {
            console.error('[DungeonMapSystem] 资源故障退出失败:', error);
            alert(`返回主神空间失败: ${error?.message || '未知错误'}`);
        }
    },

    _spawnZombieWave() {
        if (this._waveTransitioning) return;
        if (!this._zombieCombat || this._zombieCombat.isComplete) {
            this._cleanupCombat();
            this._returnToMap();
            return;
        }

        // 后续波次先清理上一波怪物，保留场地
        if (this._zombieCombat.currentWave > 0) {
            CombatRoomSystem.cleanupMonstersOnly();
        }

        const wave = this._zombieCombat.currentWave;
        const total = this._zombieCombat.totalWaves;

        const classes = this._zombieCombat.nextWaveMonsterClasses();
        const invasionFactories = this._shouldSpawnMixedInvasionWithWave()
            ? AgentInvasionSystem.getAgentFactories()
            : [];
        const spawnTombstone = this._rollTombstoneForWave();
        const pending = {
            classes,
            invasionFactories,
            spawnTombstone,
            keepTombstoneResources: spawnTombstone || this._hasActiveTombstone(),
            wave,
            total,
        };
        this._pendingZombieWave = pending;
        this._loadAndSpawnZombieWave(pending);
    },

    async _loadAndSpawnZombieWave(pending) {
        if (!pending || this._pendingZombieWave !== pending || !this.active) return;
        this._waveTransitioning = true;
        const token = ++this._enemyLoadToken;
        try {
            const enemyTypes = this._enemyTypesForWave(
                pending.classes,
                pending.invasionFactories,
                pending.keepTombstoneResources
            );
            await this._prepareDungeonEnemyTypes(enemyTypes);
            if (!this.active || token !== this._enemyLoadToken || this._pendingZombieWave !== pending) return;

            const { classes, invasionFactories, wave, total } = pending;
            CombatRoomSystem.spawnMonsters(classes.length, false, classes.map(entry => entry.MonsterClass));

            // 同步到地图系统的追踪数组，方便统一检测战斗完成
            this._combatMonsters = CombatRoomSystem._combatMonsters;
            this._combatMonsterKeys = CombatRoomSystem._combatMonsterKeys;

            EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, `第 ${wave + 1} / ${total} 波敌人来袭！`, "#ff4444"));

            // 墓碑：普通战斗每次房间刷怪 25% 概率额外刷新（必须在 spawnMonsters 重置 keys 之后调用；
            // 内部有地牢类型/精英/Boss 守卫；F/E 跨波保留，D+ 换房间随清理删除）
            try {
                this._maybeSpawnTombstone(pending.spawnTombstone);
            } catch (e) {
                console.error('[DungeonMapSystem] 墓碑生成异常（已兜底）:', e);
            }
            if (invasionFactories.length) {
                this._spawnInvasionAgentsOnFreeEdge(invasionFactories);
            }
            const arena = CombatRoomSystem._arena;
            if (arena) arena.waveSpawned = true;
            this._pendingZombieWave = null;
            this._waveTransitioning = false;
        } catch (error) {
            if (!this.active || token !== this._enemyLoadToken || this._pendingZombieWave !== pending) return;
            this._waveTransitioning = false;
            this._showEnemyLoadFailure(error, () => this._loadAndSpawnZombieWave(pending));
        }
    },

    _enterBoss(node) {
        // Boss 战为独立遭遇配置（bossEncounter）的地牢：走普通战斗流程（初级精英副本、中级领主池等）
        if (DungeonConfig.getBossEncounterConfig(this.dungeonType)) {
            this._enterBossCombat(node);
            return;
        }
        this.state = "boss";
        this._setMapInfoVisibility(false);
        // 进入 Boss 战前清理残留的战斗场景
        this._cleanupCombatScene();
        this._exitPortalSpawned = false;
        // 月影庇护：Boss 战触发无敌并激活增伤
        this._triggerMoonshadow(true);
        this._loadAndEnterAmalgamBoss(node);
    },

    async _loadAndEnterAmalgamBoss(node) {
        this._waveTransitioning = true;
        const token = ++this._enemyLoadToken;
        try {
            await this._prepareDungeonEnemyTypes(['amalgamZombie']);
            if (!this.active || this.state !== 'boss' || token !== this._enemyLoadToken) return;
            this._waveTransitioning = false;
            // 所有 Boss 战统一使用 BossRewardSystem 的集合体 Boss（dungeonType 用于地牢级 bossSize 覆盖）
            BossRewardSystem.enterBossBattle(this.player, () => {
                if (node) {
                    node.completed = true;
                    node.type = 'empty';
                }
            }, this.dungeonType);
            EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, "Boss 战！", "#ff0000"));
        } catch (error) {
            if (!this.active || token !== this._enemyLoadToken) return;
            this._waveTransitioning = false;
            this._showEnemyLoadFailure(error, () => this._loadAndEnterAmalgamBoss(node));
        }
    },

    /**
     * 初级地牢 Boss 战：独立 bossEncounter 配置（参考精英战斗：1 波 × 精英1+普通5）
     * 与普通战斗共用波次/完成检测/出口传送门流程；完成后经奖励节点触发胜利
     */
    _enterBossCombat(node) {
        this.state = "combat";
        this._setMapInfoVisibility(false);
        this._cleanupCombatScene();
        this._exitPortalSpawned = false;
        this._zombieCombatNode = node;
        this._zombieWaveActive = true;
        this._zombieCombat = new ZombieDungeonCombat(undefined, false,
            DungeonConfig.getBossEncounterConfig(this.dungeonType), this.dungeonType);
        // 月影庇护：Boss 战触发无敌并激活增伤
        this._triggerMoonshadow(true);
        CombatRoomSystem.enterCombatRoom(this.player, false, { roomSize: DungeonConfig.getCombatRoomConfig(this.dungeonType).bossSize, dungeonType: this.dungeonType });
        this._spawnZombieWave();
        EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, "Boss 战！", "#ff0000"));
    },

    // ========== 时空特工入侵战斗（追上后强制触发） ==========

    /**
     * 入侵战斗入口：
     * - 情况1/3（事件/BOSS/奖励节点）：4096 场地仅刷特工，胜利后继续原节点事件
     * - 情况2（战斗节点）：原怪物 + 随机自由边刷特工（全场敌对）；
     *   竞技场启用时走三房间流程，特工留到房间 3 随第 3 波刷新（见 _onArenaRoomSealed），
     *   未启用/构建失败回退单房间（4096）时保持进场立即刷
     */
    _enterInvasionBattle(node) {
        this.state = 'combat';
        this._setMapInfoVisibility(false);
        this._cleanupCombatScene();
        this._exitPortalSpawned = false;
        this._invasionNode = node;
        // 消费捕获标记：一次入侵只拦截一次（否则之后每个节点都会重复触发入侵战斗）
        AgentInvasionSystem.consumeCatch();
        const arenaSize = AgentInvasionSystem.getArenaSize();

        if (node.type === 'combat') {
            // 情况2：战斗节点混入特工（正常波次流程；节点完成后正常置 empty）
            this._invasionMixed = true;
            // roomSize 仅供回退单房间路径使用（竞技场用 combatRoomConfig 的 normal/eliteSize）
            this._enterZombieCombat(node, { roomSize: arenaSize, dungeonType: this.dungeonType });
            // 特工由波次资源准备链统一加载；单房间随首波、竞技场随末房波次生成。
        } else {
            // 情况1/3：仅特工的强制战（胜利后经 _leaveCombatViaPortal 继续原事件）
            this._invasionMixed = false;
            this._zombieWaveActive = false; // 无波次
            CombatRoomSystem.enterCombatRoom(this.player, false, { roomSize: arenaSize, dungeonType: this.dungeonType });
            const factories = AgentInvasionSystem.getAgentFactories();
            this._loadAndSpawnStandaloneInvasion(factories);
        }
        EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, '⚠ 时空特工入侵！', '#ff4444'));
    },

    async _loadAndSpawnStandaloneInvasion(factories) {
        this._waveTransitioning = true;
        const token = ++this._enemyLoadToken;
        try {
            await this._prepareDungeonEnemyTypes(this._enemyTypesForFactories(factories));
            if (!this.active || this.state !== 'combat' || token !== this._enemyLoadToken) return;
            CombatRoomSystem.spawnMonsters(factories.length, false, factories);
            for (const monster of CombatRoomSystem._combatMonsters) AgentInvasionSystem.markAsInvasion(monster);
            this._combatMonsters = CombatRoomSystem._combatMonsters;
            this._waveTransitioning = false;
        } catch (error) {
            if (!this.active || token !== this._enemyLoadToken) return;
            // 保持过渡守卫，防止空怪数组在错误弹窗期间被判作独立入侵已清场。
            this._waveTransitioning = true;
            this._showEnemyLoadFailure(error, () => this._loadAndSpawnStandaloneInvasion(factories));
        }
    },

    /** 情况2：在玩家/怪物都不刷新的随机自由边上生成入侵特工 */
    _spawnInvasionAgentsOnFreeEdge(factories) {
        const bounds = CombatRoomSystem._roomBounds;
        if (!bounds || !Array.isArray(factories) || factories.length === 0) return;
        const used = [CombatRoomSystem._entranceEdge, CombatRoomSystem._oppositeEdge];
        const free = [0, 1, 2, 3].filter(e => !used.includes(e));
        if (free.length === 0) return;
        const edge = free[Math.floor(Math.random() * free.length)];
        const margin = AgentInvasionSystem.getEdgeSpawnMargin();
        const count = factories.length;
        for (let i = 0; i < count; i++) {
            const t = (i + 1) / (count + 1);
            let x, y;
            // 边：0上 1右 2下 3左（与 CombatRoomSystem._spawnPlayer 同口径）
            if (edge === 0) { x = bounds.minX + (bounds.maxX - bounds.minX) * t; y = bounds.minY + margin; }
            else if (edge === 2) { x = bounds.minX + (bounds.maxX - bounds.minX) * t; y = bounds.maxY - margin; }
            else if (edge === 1) { x = bounds.maxX - margin; y = bounds.minY + (bounds.maxY - bounds.minY) * t; }
            else { x = bounds.minX + margin; y = bounds.minY + (bounds.maxY - bounds.minY) * t; }
            const agent = AgentInvasionSystem.spawnAgent(x, y, factories[i]);
            // [SAFE-SPAWN] 防穿墙兜底：菱形房间角落附近的直角边布点可能落到墙外，
            // 沿用 CombatRoomSystem.spawnMonsters 同款处理——落在不可走位置时螺旋外推重取
            const r = agent.groundRadius || 20;
            if (WallSystem && WallSystem.findSafeSpawn && !WallSystem.canMoveTo(agent.x, agent.y, r)) {
                const safe = WallSystem.findSafeSpawn(agent.x, agent.y, r);
                agent.x = safe.x;
                agent.y = safe.y;
            }
            const key = `invasion_agent_${Date.now()}_${i}_${Math.floor(Math.random() * 1000)}`;
            Game.entities.set(key, agent);
            // 加入战斗追踪（与首波怪物同数组，完成判定含特工）；
            // key 必须登记进 _combatMonsterKeys——cleanupRoom/cleanupMonstersOnly 只按 keys 删除，
            // 否则换波/清场删不掉入侵特工，实体与贴图泄漏
            CombatRoomSystem._combatMonsters.push(agent);
            CombatRoomSystem._combatMonsterKeys.push(key);
        }
        this._combatMonsters = CombatRoomSystem._combatMonsters;
    },

    /** 情况1/3：特工战胜利后继续原节点事件（事件/BOSS/奖励） */
    _continueNodeEventAfterInvasion(node) {
        switch (node.type) {
            case 'combat': this._enterCombat(node); break;
            case 'boss':   this._enterBoss(node); break;
            case 'event':  this._enterEvent(node); break;
            case 'reward': this._enterReward(node); break;
            default:       this._returnToMap(); break;
        }
    },

    _checkZombieCombatComplete() {
        if (this.state !== "combat" && this.state !== "boss") return false;
        // 波次或独立入侵的资源尚未准备完成时，空追踪数组不代表清场。
        if (this._waveTransitioning || this._pendingZombieWave) return false;

        const allDead = this._combatMonsters.every(m => !m.active || m.hp <= 0);
        if (!allDead) return false;

        // 僵尸地牢：检查是否还有下一波
        if (this._isZombieFamily() && this.state === "combat" && this._zombieWaveActive) {
            if (this._zombieCombat && !this._zombieCombat.isComplete) {
                // 三房间竞技场：波次只能由 _onArenaRoomSealed 驱动，此处永不自动续波
                const arena = CombatRoomSystem._arena;
                if (arena) {
                    // 尚未刷过波（关门刷波窗口期，数组里还是上一房间的死怪）：一律不判定清场
                    if (!arena.waveSpawned) return false;
                    if (arena.stage < arena.rooms.length) {
                        // 当前房间 < 末房 → 开门等玩家进下一房间
                        if (!this._arenaRoomCleared) {
                            this._arenaRoomCleared = true;
                            CombatRoomSystem.setArenaRoomGates(arena.stage, true);
                            arena.awaiting = arena.stage + 1;
                            if (SceneManager && SceneManager.showTopNotification) {
                                SceneManager.showTopNotification('通道已开启，前往下一房间');
                            }
                        }
                        return false;
                    }
                    // stage === 末房：等本房间波次由关门流程驱动，战斗完成与否看 isComplete
                    return false;
                }
                // 防止重复设置过渡
                if (this._waveTransitioning) return false;
                // 短暂延迟后生成下一波（暂停期间自动顺延，不再用真实时间刷波）
                this._scheduleNextWave();
                return false; // 还有下一波，战斗未完成
            }
        }

        return true; // 所有怪物死亡且无下一波，战斗完成
    },

    /**
     * 调度下一波生成（1.5s 过渡）；游戏暂停时自动顺延重试，避免暂停期间刷波
     */
    _scheduleNextWave() {
        this._waveTransitioning = true;
        TimerManager.setTimeout(() => {
            if (!this.active || this.state !== "combat") {
                this._waveTransitioning = false;
                return;
            }
            // 防御：竞技场模式的波次只能由 _onArenaRoomSealed 驱动，此处直接放弃
            if (CombatRoomSystem._arena) {
                this._waveTransitioning = false;
                return;
            }
            // 暂停期间不刷波：1.5s 后重试
            if (Game && Game._paused) {
                this._scheduleNextWave();
                return;
            }
            this._waveTransitioning = false;
            CombatRoomSystem.cleanupMonstersOnly();
            this._spawnZombieWave();
        }, 1500);
    },

    /**
     * 战斗完成后消耗女神祝福等一次性战斗增益
     */
    _consumeCombatBuffs(player) {
        import('./dungeon-event-system.js').then(mod => {
            if (mod.onCombatComplete) mod.onCombatComplete(player);
        }).catch(() => {});
    },

    _cleanupCombat() {
        // 使用 CombatRoomSystem 清理战斗场地（包含掉落物、传送门）
        if (CombatRoomSystem.active) {
            CombatRoomSystem.cleanupRoom();
        } else {
            CombatRoomSystem.cleanupDrops();
        }

        for (const key of this._combatMonsterKeys) {
            if (typeof Game.removeEntity === 'function') {
                // 存活尸体（如胖子僵尸尸体）跳过删除，按自身计时器走完生命周期
                if (typeof Game.isPreservedCorpse === 'function' && Game.isPreservedCorpse(Game.entities.get(key))) continue;
                Game.removeEntity(key);
            }
        }
        this._combatMonsters = [];
        this._combatMonsterKeys = [];
        this._combatRoomWalls = [];
        this._combatRoomObstacles = [];
        this._zombieWaveActive = false;
        this._zombieCombat = null;
        this._zombieCombatNode = null;
        this._pendingZombieWave = null;
        this._enemyLoadToken++;
        this._waveTransitioning = false;
        this._exitPortalSpawned = false;
        this._arenaRoomCleared = false;
        this._arenaDoorPending = null;
        getElementIfExists('dungeonEnemyLoadFailure')?.remove();
        RuntimeAssetManager.setDungeonEnemyTypes([]);

        // 战斗完成后消耗女神祝福层数
        this._consumeCombatBuffs(this.player);

        // 统一清理残留的战斗场景对象
        this._cleanupCombatScene();

        // 清理 Phaser 战斗视觉残留（敌人/掉落物/传送门 Sprite）
        const phaserScene = window.__phaserScene;
        if (phaserScene && phaserScene.clearCombatView) {
            phaserScene.clearCombatView();
        }

        // [NEW] 墙壁恢复后标记 RegionIndex 需要重算
        if (pathFinder) {
            pathFinder.invalidateCache();
        }
    },

    /**
     * 统一清理战斗场景残留：传送门、掉落物、浮动文字、Phaser 视觉对象、重置标记
     */
    _cleanupCombatScene() {
        if (CombatRoomSystem.active) {
            CombatRoomSystem.cleanupRoom();
        } else {
            CombatRoomSystem.cleanupDrops();
        }

        const phaserScene = window.__phaserScene;
        if (phaserScene && phaserScene.clearCombatView) {
            phaserScene.clearCombatView();
        }
        if (EffectManager && EffectManager.clearFloatingTexts) {
            EffectManager.clearFloatingTexts();
        }

        this._exitPortalSpawned = false;
    },

    _enterReward(node) {
        this.state = "reward";
        this._setMapInfoVisibility(false);
        // 使用 BossRewardSystem 的奖励节点管理器
        const opened = BossRewardSystem.enterRewardNode(this.player, () => {
            // 奖励领取完毕后标记节点完成并触发胜利
            if (node) {
                node.completed = true;
                node.type = 'empty';
            }
            this._showVictory();
            this._returnToMap();
        }, this.dungeonType);
        if (opened === false) {
            console.error('[DungeonMapSystem] Reward panel failed to open; returning to route map for retry');
            this._returnToMap();
        }
    },

    _enterEvent(node) {
        this.state = "event";
        this._setMapInfoVisibility(false);
        // 连战中断：选择随机事件节点（含宝箱/商店）连战计数清零（empty 空节点不计不断）
        DungeonRunStats.combatStreak = 0;
        // 使用 DungeonEventSystem 提供完整的随机事件
        import('./dungeon-event-system.js').then(mod => {
            // node.eventType 已记录时沿用（如陷阱解除失败保留节点后重进，仍为陷阱事件，不再重新随机）
            mod.DungeonEventSystem.trigger(this.player, (result) => {
                if (result && result.eventType) node.eventType = result.eventType;
                if (result && result.combat) {
                    if (result.elite) node.isElite = true;
                    if (result.forceMonsters) node.forceMonsters = result.forceMonsters;
                    if (result.encounter) {
                        // 事件只覆盖波次与编组；未显式声明怪物池时继承当前地牢同阶遭遇池，
                        // 防止共用僵尸战斗管线的题材地牢混入其他系列怪物。
                        const baseEncounter = DungeonConfig.getZombieEncounterConfig(!!result.elite, this.dungeonType) || {};
                        node.encounterOverride = { ...result.encounter };
                        for (const key of ['poolKeys', 'matchPoolRanks', 'poolFamily']) {
                            if (node.encounterOverride[key] === undefined && baseEncounter[key] !== undefined) {
                                node.encounterOverride[key] = baseEncounter[key];
                            }
                        }
                    }
                    this._enterCombat(node);
                } else {
                    const isTrap = result && result.eventType === 'trap';
                    const isDisarm = isTrap && result.choiceId === 'disarm';

                    // 陷阱解除失败：回退到上一个节点，保持节点原状
                    if (isDisarm && result.success === false) {
                        this.currentNodeId = this.previousNodeId || this.currentNodeId;
                    }

                    // 节点清空规则：非陷阱事件正常清空；陷阱仅成功解除后清空；强行跨越保留节点
                    const shouldEmpty = !isTrap || (isDisarm && result.success === true);
                    if (shouldEmpty) {
                        this._clearNodeToEmpty(node);
                    }
                    this._returnToMap();
                }
            }, node.eventType || null, this); // 传入 dungeonMapSystem = this
        }).catch(err => {
            console.error('[DungeonMapSystem] Failed to load dungeon-event-system:', err);
            this._returnToMap();
        });
    },

    _cleanupEventUI() {
        // 先让事件系统销毁打字机并移除自身覆盖层，防止打字机定时器在 DOM 移除后继续运行
        import('./dungeon-event-system.js').then(mod => {
            if (mod.DungeonEventSystem && typeof mod.DungeonEventSystem._cleanupUI === 'function') {
                mod.DungeonEventSystem._cleanupUI();
            }
        }).catch(() => {});
        if (this._eventOverlay) {
            this._eventOverlay.remove();
            this._eventOverlay = null;
        }
        // 安全清理：也移除新版 DungeonEventSystem 覆盖层，避免重复按钮
        const systemOverlay = document.getElementById('dungeonEventSystemOverlay');
        if (systemOverlay) systemOverlay.remove();
        const resultOverlay = document.getElementById('dungeonEventResultOverlay');
        if (resultOverlay) resultOverlay.remove();
    },

    // ───────────────────────────────────────────────
    // 渲染：整张大地图，可拖动 + 缩放
    // ───────────────────────────────────────────────
    _renderRouteOverview(ctx, view) {
        const sectors = this._getRouteSectors();
        if (!sectors.length) return;
        const currentSectorIndex = this._getSectorIndexForNode(this.getCurrentNode());
        const agentNode = AgentInvasionSystem.triggered && AgentInvasionSystem.agentNodeId
            ? this.nodes.find(node => node.id === AgentInvasionSystem.agentNodeId)
            : null;
        const agentSectorIndex = agentNode ? this._getSectorIndexForNode(agentNode) : -1;
        const columns = this._usesSplitRouteMap()
            ? Math.min(sectors.length, Math.max(1, Math.min(8, Math.floor(view.width / 150))))
            : Math.min(8, Math.max(4, sectors.length));
        const rows = Math.ceil(sectors.length / columns);
        const marginX = Math.max(58, Math.min(96, view.width * 0.065));
        const headerH = 64;
        const usableW = Math.max(1, view.width - marginX * 2);
        const usableH = Math.max(1, view.height - headerH - 56);
        const rowGap = rows > 1 ? usableH / Math.max(1, rows - 1) : 0;
        const colGap = usableW / Math.max(1, columns - 1);
        const points = sectors.map((sector, index) => {
            const row = Math.floor(index / columns);
            const columnInRow = index % columns;
            const column = row % 2 === 0 ? columnInRow : columns - 1 - columnInRow;
            return {
                sector,
                x: view.left + marginX + colGap * column,
                y: view.top + headerH + (rows === 1 ? usableH * 0.46 : rowGap * row),
            };
        });

        ctx.save();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(225, 237, 241, 0.96)';
        ctx.font = '800 17px "Microsoft YaHei", sans-serif';
        ctx.fillText(`远征路线总览 // ${sectors.length} 个区段`, view.left + 18, view.top + 27);
        ctx.fillStyle = 'rgba(157, 177, 185, 0.76)';
        ctx.font = '600 12px "Microsoft YaHei", sans-serif';
        const sectionRule = this._usesSplitRouteMap() ? '按路线窗口分区'
            : this._getLandmarkRouteProfile()?.terrainRouting ? '按可见平台容量分区' : '每 4 列建立地标区段';
        ctx.fillText(`共 ${this.nodes.length} 个房间 · ${sectionRule} · 聚焦后查看真实节点与岔路`, view.left + 18, view.top + 48);

        for (let index = 0; index < points.length - 1; index++) {
            const a = points[index];
            const b = points[index + 1];
            const progressed = index < currentSectorIndex;
            ctx.lineCap = 'round';
            ctx.strokeStyle = 'rgba(7, 12, 15, 0.88)';
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.strokeStyle = progressed ? 'rgba(117, 164, 174, 0.92)' : 'rgba(101, 119, 128, 0.55)';
            ctx.lineWidth = progressed ? 3 : 2;
            ctx.setLineDash(progressed ? [] : [10, 8]);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        for (const point of points) {
            const { sector } = point;
            const isCurrent = sector.index === currentSectorIndex;
            const isComplete = sector.visitedCount >= sector.nodes.length;
            const isAgent = sector.index === agentSectorIndex;
            const radius = isCurrent ? 29 : 25;
            ctx.shadowColor = isCurrent ? 'rgba(202, 231, 238, 0.58)' : 'transparent';
            ctx.shadowBlur = isCurrent ? 14 : 0;
            ctx.fillStyle = isCurrent ? '#202b31' : (isComplete ? '#18282a' : '#171d21');
            ctx.strokeStyle = isCurrent ? '#d7e7ed' : (isComplete ? '#689da6' : '#65747c');
            ctx.lineWidth = isCurrent ? 3 : 2;
            this._traceRouteNode(ctx, point.x, point.y, radius);
            ctx.fill();
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(222, 237, 242, 0.18)';
            ctx.lineWidth = 1;
            this._traceRouteNode(ctx, point.x, point.y, radius - 5);
            ctx.stroke();

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#e3edf0';
            ctx.font = '800 14px "Microsoft YaHei", sans-serif';
            ctx.fillText(String(sector.index + 1).padStart(2, '0'), point.x, point.y + 1);

            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = isCurrent ? '#edf7f9' : '#c4d0d5';
            ctx.font = '700 13px "Microsoft YaHei", sans-serif';
            ctx.fillText(`区段 ${String(sector.index + 1).padStart(2, '0')}`, point.x, point.y + radius + 17);
            ctx.fillStyle = '#899aa2';
            ctx.font = '600 11px "Microsoft YaHei", sans-serif';
            ctx.fillText(`${sector.visitedCount}/${sector.nodes.length} 房`, point.x, point.y + radius + 33);
            if (isCurrent) {
                ctx.fillStyle = '#d7e7ed';
                ctx.fillText('玩家所在', point.x, point.y - radius - 12);
            }
            if (isAgent) {
                ctx.fillStyle = '#cf7474';
                ctx.fillText('入侵者', point.x, point.y - radius - (isCurrent ? 28 : 12));
            }
        }
        ctx.restore();
    },

    /** 冷钢路线节点统一使用切角八边形，避免与旧卷轴蜡封的圆章语义混淆。 */
    _traceRouteNode(ctx, x, y, radius) {
        const cut = radius * 0.42;
        ctx.beginPath();
        ctx.moveTo(x - cut, y - radius);
        ctx.lineTo(x + cut, y - radius);
        ctx.lineTo(x + radius, y - cut);
        ctx.lineTo(x + radius, y + cut);
        ctx.lineTo(x + cut, y + radius);
        ctx.lineTo(x - cut, y + radius);
        ctx.lineTo(x - radius, y + cut);
        ctx.lineTo(x - radius, y - cut);
        ctx.closePath();
    },

    render(ctx) {
        if (!this.active || this.state !== "map") return;
        if (this._usesExplorationConsole()) {
            this._renderBackground(ctx, ctx.canvas.width, ctx.canvas.height, 0);
            this._explorationConsole?.render();
            return;
        }

        // 用实际 canvas 尺寸（视口），不用固定 1920×1080——修复 2K 屏下背景/地图挤左上角
        const viewW = (ctx.canvas && ctx.canvas.width) || this.DEFAULT_VIEWPORT_WIDTH;
        const viewH = (ctx.canvas && ctx.canvas.height) || this.DEFAULT_VIEWPORT_HEIGHT;
        if (this.routeViewMode !== 'overview') this._syncLandmarkRouteTransform(viewW, viewH);
        const availableNodes = this.getAvailableNodes();
        const availableIds = new Set(availableNodes.map(n => n.id));
        const routeColors = this._getRouteColors();

        // 界面分两块：上方背景图（纯美观），下方地图选择区域（area）
        const area = this._getMapTargetArea(viewW, viewH);
        const view = this._getMapViewRect(viewW, viewH); // 路线图显示窗口（内容限定在此）
        const fullPlate = this._usesFullMapBackground();

        // ── 上方：背景图，裁剪在上区内 ──
        this._renderBackground(ctx, viewW, viewH, area.top);

        // ── 下方：地图选择区域底块（默认不透明深色；背景图就绪后拉伸铺满）──
        if (!fullPlate) {
            ctx.fillStyle = "#08080a";
            ctx.fillRect(area.left, area.top, area.width, area.height);
        }
        this._drawMapAreaBackground(ctx, area);

        // D: 背景协调——半透明暗色覆盖层（上下略深）+ 左右暗角，提升节点对比、统一色调
        const ov = ctx.createLinearGradient(0, area.top, 0, area.top + area.height);
        ov.addColorStop(0, fullPlate ? 'rgba(5, 9, 12, 0.18)' : 'rgba(8, 8, 12, 0.52)');
        ov.addColorStop(0.5, fullPlate ? 'rgba(5, 9, 12, 0.10)' : 'rgba(8, 8, 12, 0.34)');
        ov.addColorStop(1, fullPlate ? 'rgba(5, 9, 12, 0.24)' : 'rgba(8, 8, 12, 0.52)');
        ctx.fillStyle = ov;
        ctx.fillRect(area.left, area.top, area.width, area.height);
        const sideW = Math.round(area.width * 0.16);
        const gL = ctx.createLinearGradient(area.left, 0, area.left + sideW, 0);
        gL.addColorStop(0, fullPlate ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.40)');
        gL.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gL;
        ctx.fillRect(area.left, area.top, sideW, area.height);
        const gR = ctx.createLinearGradient(area.left + area.width, 0, area.left + area.width - sideW, 0);
        gR.addColorStop(0, fullPlate ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.40)');
        gR.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gR;
        ctx.fillRect(area.left + area.width - sideW, area.top, sideW, area.height);

        if (this._usesSplitRouteMap()) {
            const theme = this._routeColorCache.bundleTheme;
            ctx.save();
            ctx.fillStyle = theme.text;
            ctx.textAlign = 'left';
            ctx.font = `700 20px ${theme.font}`;
            ctx.fillText('探索路线', view.left + 10, area.top + 29);
            ctx.font = `12px ${theme.font}`;
            ctx.fillStyle = theme.line;
            const hint = view.width < 620 ? '点击探索 · 拖动查看'
                : '悬停查看风险与收益 · 点击可走节点探索 · 拖动查看路线';
            ctx.fillText(hint, view.left + 10, area.top + 49);
            if (view.width >= 620) {
                ctx.textAlign = 'right';
                ctx.font = `600 13px ${theme.font}`;
                ctx.fillText(`${availableIds.size} 处可前往`, view.left + view.width - 10, area.top + 29);
            }
            ctx.restore();
        }

        // ── 地图内容：裁剪在路线图窗口内，无论怎么拖/缩放都不溢出 ──
        ctx.save();
        ctx.beginPath();
        ctx.rect(view.left, view.top, view.width, view.height);
        ctx.clip();

        const t = this._mapAnimT || 0;
        if (this.routeViewMode === 'overview') {
            this._renderRouteOverview(ctx, view);
            ctx.restore();
            return;
        }

        const visibleNodeIds = new Set(this._getPresentedRouteNodes().map(node => node.id));

        // 应用地图变换
        ctx.translate(this.mapOffsetX, this.mapOffsetY);
        ctx.scale(this.mapScale, this.mapScale);

        // ── 绘制边（连线）─
        const drawnEdges = new Set();
        let routeEdges = this._getPresentedRouteEdges(visibleNodeIds);
        this._prepareLandmarkRouteEdges(visibleNodeIds);
        if (this._usesLandmarkMap()) {
            const priority = edge => {
                if ((this.currentNodeId === edge.from && availableIds.has(edge.to))
                    || (this.currentNodeId === edge.to && availableIds.has(edge.from))) {
                    return edge.from === this.hoveredNodeId || edge.to === this.hoveredNodeId ? 3 : 2;
                }
                return this.visitedNodeIds.has(edge.from) && this.visitedNodeIds.has(edge.to) ? 1 : 0;
            };
            // 所有地标地图都让当前可走线最后绘制，悬停的目标线置顶。
            routeEdges.sort((a, b) => priority(a) - priority(b));
        }
        const bundledRoutes = this._usesLandmarkMap() && this._landmarkProjectionCache?.edgeBundles;
        if (bundledRoutes) this._renderRouteBundles(ctx, routeEdges, availableIds, routeColors, view, t);
        for (const edge of bundledRoutes ? [] : routeEdges) {
            const fromNode = this.nodes.find(n => n.id === edge.from);
            const toNode = this.nodes.find(n => n.id === edge.to);
            if (!fromNode || !toNode) continue;
            if (!visibleNodeIds.has(fromNode.id) || !visibleNodeIds.has(toNode.id)) continue;
            const edgeKey = [fromNode.id, toNode.id].sort().join('::');
            if (drawnEdges.has(edgeKey)) continue;
            drawnEdges.add(edgeKey);
            const routeColor = routeColors?.get(edgeKey);

            const isVisited = this.visitedNodeIds.has(fromNode.id) && this.visitedNodeIds.has(toNode.id);
            const isAvailable = (this.currentNodeId === fromNode.id && availableIds.has(toNode.id))
                || (this.currentNodeId === toNode.id && availableIds.has(fromNode.id));
            const isInspected = fromNode.id === this.hoveredNodeId || toNode.id === this.hoveredNodeId;
            const landmark = this._usesLandmarkMap();
            ctx.save();
            if (landmark && !isAvailable) ctx.globalAlpha = isInspected ? 0.8 : 0.38;
            else if (landmark && availableIds.has(this.hoveredNodeId) && !isInspected) ctx.globalAlpha = 0.55;

            if (isVisited && !isAvailable) {
                // 已走路径：冷钢深槽 + 青灰确认线
                ctx.strokeStyle = 'rgba(24, 34, 39, 0.92)';
                ctx.lineWidth = 5;
                ctx.lineCap = 'round';
                this._traceRouteEdge(ctx, fromNode, toNode);
                ctx.stroke();
                ctx.strokeStyle = routeColor || 'rgba(104, 157, 166, 0.82)';
                ctx.lineWidth = 2.2;
                this._traceRouteEdge(ctx, fromNode, toNode);
                ctx.stroke();
            } else if (isAvailable) {
                // 可走优先于已访问：回头路也须高亮。连续实线保证可追踪，细虚线仅提示流向。
                ctx.strokeStyle = 'rgba(8, 13, 16, 0.96)';
                ctx.lineWidth = 8 / this.mapScale;
                ctx.lineCap = 'round';
                this._traceRouteEdge(ctx, fromNode, toNode);
                ctx.stroke();
                ctx.shadowColor = routeColor || 'rgba(174, 211, 222, 0.58)';
                ctx.shadowBlur = 4 / this.mapScale;
                ctx.strokeStyle = routeColor || 'rgba(142, 182, 194, 0.96)';
                ctx.lineWidth = (isInspected ? 3.5 : 3) / this.mapScale;
                ctx.lineCap = 'round';
                this._traceRouteEdge(ctx, fromNode, toNode);
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.strokeStyle = 'rgba(190, 220, 228, 0.96)';
                ctx.lineWidth = 1.5 / this.mapScale;
                ctx.setLineDash([12 / this.mapScale, 8 / this.mapScale]);
                const terrainPath = this._landmarkProjectionCache?.edgePaths?.get(edgeKey);
                const pathStartId = terrainPath ? [fromNode.id, toNode.id].sort()[0] : fromNode.id;
                ctx.lineDashOffset = (pathStartId === this.currentNodeId ? -1 : 1) * (t * 0.04) / this.mapScale;
                this._traceRouteEdge(ctx, fromNode, toNode);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.lineDashOffset = 0;
            } else {
                // 地标远线保留低亮度身份色与断续状态；阻断叉仍用锈红，不冒充可走实线。
                ctx.strokeStyle = 'rgba(31, 19, 22, 0.88)';
                ctx.lineWidth = 5;
                ctx.lineCap = 'round';
                this._traceRouteEdge(ctx, fromNode, toNode);
                ctx.stroke();
                ctx.strokeStyle = routeColor || 'rgba(164, 76, 82, 0.82)';
                ctx.lineWidth = 2;
                ctx.setLineDash([5 / this.mapScale, 8 / this.mapScale]);
                this._traceRouteEdge(ctx, fromNode, toNode);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            // 可走线使用方向箭头；远端线不再堆满机械接头与阻断叉。
            const joint = this._getRouteEdgeMidpoint(fromNode, toNode);
            const jointX = joint.x;
            const jointY = joint.y;
            const jointSize = isAvailable ? 4.2 : 3.2;
            if (isAvailable) {
                ctx.save();
                ctx.translate(jointX, jointY);
                ctx.rotate(joint.angle + (toNode.id === this.currentNodeId ? Math.PI : 0));
                const arrowSize = 6 / this.mapScale;
                ctx.beginPath();
                ctx.moveTo(arrowSize, 0);
                ctx.lineTo(-arrowSize, -arrowSize * 0.75);
                ctx.lineTo(-arrowSize * 0.5, 0);
                ctx.lineTo(-arrowSize, arrowSize * 0.75);
                ctx.closePath();
                ctx.strokeStyle = 'rgba(8, 13, 16, 0.96)';
                ctx.lineWidth = 3 / this.mapScale;
                ctx.stroke();
                ctx.fillStyle = routeColor || 'rgba(205, 231, 238, 0.98)';
                ctx.fill();
                ctx.restore();
            } else if (!landmark || isInspected) {
                ctx.save();
                ctx.translate(jointX, jointY);
                ctx.rotate(Math.PI / 4);
                ctx.fillStyle = isVisited ? 'rgba(104, 157, 166, 0.88)' : 'rgba(76, 91, 98, 0.72)';
                ctx.fillRect(-jointSize / 2, -jointSize / 2, jointSize, jointSize);
                ctx.restore();
            }
            if (!isVisited && !isAvailable && (!landmark || isInspected)) {
                // 中点阻断叉在缩放下保持固定屏幕尺寸，远看也能判断这条线当前不能进入。
                const blockSize = 6.5 / this.mapScale;
                ctx.save();
                ctx.translate(jointX, jointY);
                ctx.strokeStyle = 'rgba(205, 102, 108, 0.94)';
                ctx.lineWidth = 1.8 / this.mapScale;
                ctx.lineCap = 'square';
                ctx.beginPath();
                ctx.moveTo(-blockSize, -blockSize);
                ctx.lineTo(blockSize, blockSize);
                ctx.moveTo(blockSize, -blockSize);
                ctx.lineTo(-blockSize, blockSize);
                ctx.stroke();
                ctx.restore();
            }
            ctx.restore();
        }

        // ── 绘制节点 ──
        const labelMeta = [];
        for (const node of this.nodes) {
            if (!visibleNodeIds.has(node.id)) continue;
            const point = this._getRoutePoint(node);
            const isVisited = this.visitedNodeIds.has(node.id);
            const isCurrent = node.id === this.currentNodeId;
            const isAvailable = availableIds.has(node.id);
            const isHovered = node.id === this.hoveredNodeId;
            const routeColor = isAvailable
                ? routeColors?.get([this.currentNodeId, node.id].sort().join('::')) : null;

            // 迷雾系统：确定显示类型
            let displayType = node.type;
            let isRevealed = isVisited || isCurrent || isAvailable;
            if (this.fogOfWar && this.fogOfWar.enabled !== false) {
                const visibility = this.fogOfWar.getNodeVisibility(node.id);
                isRevealed = visibility === 'visited' || visibility === 'revealed' || isCurrent || isAvailable;
                if (!isRevealed && !isVisited) {
                    displayType = 'unknown';
                }
            }

            let radius = this.NODE_RADIUS;
            let color, borderColor;

            if (isCurrent) {
                color = this.TYPE_COLORS[node.type] || "#202b31";
                borderColor = "#d7e7ed";
                radius += 4;
            } else if (isVisited && !isAvailable) {
                color = this.TYPE_COLORS[node.type] || "#22282d";
                borderColor = node.completed ? "#689da6" : "#65747c";
                ctx.globalAlpha = 0.72;
            } else if (isAvailable) {
                // 相邻可点击节点：显示实际类型
                color = this.TYPE_COLORS[node.type] || "#22282d";
                borderColor = routeColor || this.TYPE_BORDER_COLORS[node.type] || "#9fb5bf";
            } else if (isRevealed) {
                // 已揭示但未访问：显示实际类型但暗淡
                color = this.TYPE_COLORS[node.type] || "#22282d";
                borderColor = "#58666d";
                ctx.globalAlpha = 0.48;
            } else {
                // 未揭示：迷雾状态
                color = "#151a1d";
                borderColor = "#343e43";
                ctx.globalAlpha = 0.42;
            }

            if (isHovered && isAvailable) {
                radius += 5;
                borderColor = routeColor || "#e8f5f8";
            }

            // 可点击/当前节点使用克制的冷钢呼吸反馈。
            const breathe = 0.55 + 0.45 * Math.sin(t * 0.004);

            if (isAvailable) {
                ctx.shadowColor = routeColor || this.TYPE_BORDER_COLORS[node.type] || '#9fb5bf';
                ctx.shadowBlur = (8 + 6 * breathe) / this.mapScale;
            } else if (isCurrent) {
                ctx.shadowColor = '#d7e7ed';
                ctx.shadowBlur = 10 / this.mapScale;
            } else {
                ctx.shadowBlur = 0;
            }
            // 金属档案节点：外壳、内圈和顶部高光共同建立冷钢层级。
            const nodeFill = ctx.createLinearGradient(point.x, point.y - radius, point.x, point.y + radius);
            nodeFill.addColorStop(0, color);
            nodeFill.addColorStop(1, '#0b1013');
            ctx.fillStyle = nodeFill;
            this._traceRouteNode(ctx, point.x, point.y, radius);
            ctx.fill();
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = isHovered ? 3 : 2;
            this._traceRouteNode(ctx, point.x, point.y, radius);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = 'rgba(226, 239, 243, 0.18)';
            ctx.lineWidth = 1;
            this._traceRouteNode(ctx, point.x, point.y, Math.max(4, radius - 5));
            ctx.stroke();
            ctx.globalAlpha = 1.0;

            // 可走目标的外环与路线同色；内部图标和底色仍表示房间类型。
            if (isAvailable) {
                ctx.save();
                ctx.strokeStyle = routeColor || '#bedce4';
                ctx.globalAlpha = 0.32 + 0.30 * breathe;
                ctx.lineWidth = 2;
                this._traceRouteNode(ctx, point.x, point.y, radius + 3);
                ctx.stroke();
                ctx.restore();
            }
            // E: 当前节点——白色脉冲双环
            if (isCurrent) {
                const pulse = 0.5 + 0.5 * Math.sin(t * 0.005);
                ctx.strokeStyle = `rgba(255, 255, 255, ${0.45 + 0.35 * pulse})`;
                ctx.lineWidth = 2;
                this._traceRouteNode(ctx, point.x, point.y, radius + 3 + 3 * pulse);
                ctx.stroke();
            }
            // E: 精英节点——双层紫圈（遵循迷雾规则，未揭示时不显示）
            if (node.isElite && isRevealed) {
                ctx.strokeStyle = "rgba(138, 58, 154, 0.45)";
                ctx.lineWidth = 2;
                this._traceRouteNode(ctx, point.x, point.y, radius + 4);
                ctx.stroke();
                ctx.strokeStyle = "#8a3a9a";
                ctx.lineWidth = 3;
                this._traceRouteNode(ctx, point.x, point.y, radius + 2);
                ctx.stroke();
            }
            // 收集屏幕空间标签元数据（C：图标/★/你 反缩放绘制）
            labelMeta.push({
                displayType, isRevealed, isAvailable, isCurrent, routeColor,
                sx: point.x * this.mapScale + this.mapOffsetX,
                sy: point.y * this.mapScale + this.mapOffsetY,
                radius,
                elite: node.isElite,
                completed: !!node.completed,
            });
        }

        // ── 时空特工入侵者节点标记（不受迷雾限制；数据每回合更新、每帧重绘即随回合移动）──
        if (AgentInvasionSystem.triggered && AgentInvasionSystem.agentNodeId) {
            const agentNode = this.nodes.find(n => n.id === AgentInvasionSystem.agentNodeId);
            if (agentNode && visibleNodeIds.has(agentNode.id)) {
                const mk = AgentInvasionSystem.getNodeMarkerStyle();
                const agentPoint = this._getRoutePoint(agentNode);
                // 与玩家同节点（已追上待拦截）：右移标记，避免完全遮挡"你"所在节点
                const mx = agentPoint.x + (agentNode.id === this.currentNodeId ? this.NODE_RADIUS + mk.radius + 6 : 0);
                const my = agentPoint.y;
                const mkPulse = 0.5 + 0.5 * Math.sin(t * 0.006);
                // 外圈呼吸描边
                if (mk.pulse) {
                    ctx.strokeStyle = mk.color;
                    ctx.globalAlpha = 0.35 + 0.45 * mkPulse;
                    ctx.lineWidth = 2.5;
                    ctx.beginPath();
                    ctx.arc(mx, my, mk.radius + 4 + 5 * mkPulse, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.globalAlpha = 1.0;
                }
                // 实心圆点 + 白色描边
                ctx.fillStyle = mk.color;
                ctx.beginPath();
                ctx.arc(mx, my, mk.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(mx, my, mk.radius, 0, Math.PI * 2);
                ctx.stroke();
                // 标签文字（地图坐标系内，随地图缩放）
                if (mk.label) {
                    ctx.font = `bold ${Math.round(mk.radius * 1.2)}px "Microsoft YaHei", sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = mk.color;
                    ctx.fillText(mk.label, mx, my - mk.radius - 10);
                }
            }
        }

        // C: 反缩放标签（图标/★/你）——恢复屏幕坐标（保持区域裁剪），字号恒定不随缩放发虚
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const landmarkIcons = this._usesLandmarkMap();
        for (const m of labelMeta) {
            const screenR = Math.max(12, m.radius * this.mapScale);
            const iconSize = Math.max(12, Math.min(18, Math.round(screenR * 0.60)));
            if (landmarkIcons) {
                const routeIcon = this._getRouteNodeIcon(m.isRevealed ? m.displayType : 'unknown', m.elite && m.isRevealed);
                if (routeIcon) {
                    // 图标接近填满节点内圈，但不覆盖外框、呼吸环和点击区域边界。
                    const drawSize = Math.max(24, Math.min(44, Math.round(screenR * 1.52)));
                    ctx.globalAlpha = (m.isAvailable || m.isCurrent) ? 1 : (m.isRevealed ? 0.76 : 0.54);
                    ctx.drawImage(routeIcon, m.sx - drawSize / 2, m.sy - drawSize / 2, drawSize, drawSize);
                    ctx.globalAlpha = 1;
                }
            } else {
                const icon = m.isRevealed ? (this.TYPE_ICONS[m.displayType] || '•') : '?';
                ctx.font = `700 ${iconSize}px "Microsoft YaHei", sans-serif`;
                ctx.fillStyle = (m.isAvailable || m.isCurrent || m.isRevealed) ? '#e3edf0' : '#6f7b81';
                ctx.fillText(icon, m.sx, m.sy + 1);
            }
            if (!landmarkIcons && m.elite && m.isRevealed) {
                ctx.font = `bold ${iconSize - 1}px "Microsoft YaHei", sans-serif`;
                ctx.fillStyle = '#d08ae0';
                ctx.fillText('★', m.sx, m.sy - screenR - 6);
            }
            if (!landmarkIcons && m.completed && !m.isCurrent) {
                ctx.font = '700 12px "Microsoft YaHei", sans-serif';
                ctx.fillStyle = '#83c8b4';
                ctx.fillText('✓', m.sx + screenR * 0.72, m.sy + screenR * 0.66);
            }
            if (m.isCurrent) {
                ctx.font = '700 12px "Microsoft YaHei", sans-serif';
                ctx.fillStyle = '#dcebef';
                ctx.fillText('当前位置', m.sx, m.sy + screenR + 10);
            } else if (m.isAvailable) {
                ctx.font = '600 11px "Microsoft YaHei", sans-serif';
                ctx.fillStyle = m.routeColor || '#a9c8d1';
                ctx.fillText('可前往', m.sx, m.sy + screenR + 9);
            }
        }

        // 窗口边界纯透明淡出（不用黑色遮罩）：
        // 抓取视图（内容+背景）到离屏 → 重铺背景 → 离屏边缘 alpha 淡出 → 贴回
        const ovc = this._getMapViewCanvas(view.width, view.height);
        const oc = ovc.getContext('2d');
        oc.clearRect(0, 0, ovc.width, ovc.height);
        oc.drawImage(ctx.canvas, view.left, view.top, view.width, view.height, 0, 0, ovc.width, ovc.height);
        // 重铺背景（当前 clip=view，整区绘制自动裁剪到窗口内，与原背景逐像素一致）
        if (fullPlate) {
            this._renderBackground(ctx, viewW, viewH, area.top);
        } else {
            ctx.fillStyle = "#08080a";
            ctx.fillRect(area.left, area.top, area.width, area.height);
        }
        this._drawMapAreaBackground(ctx, area);
        ctx.fillStyle = ov;
        ctx.fillRect(area.left, area.top, area.width, area.height);
        ctx.fillStyle = gL;
        ctx.fillRect(area.left, area.top, sideW, area.height);
        ctx.fillStyle = gR;
        ctx.fillRect(area.left + area.width - sideW, area.top, sideW, area.height);
        // 离屏边缘透明淡出后贴回
        this._applyMapEdgeFade(oc, ovc.width, ovc.height);
        ctx.drawImage(ovc, view.left, view.top);

        // 恢复原始状态（解除区域裁剪与地图变换）
        ctx.restore();

        // 进度、区段索引、全图/当前位置由可聚焦的 DOM 路线控制栏承载；
        // 下一步选点只保留在路线节点本身，避免重复操作入口。
    },

    /** 路线控制栏：提供键盘可达的区段索引、战略总览和返回当前位置入口。 */
    _createRouteControls() {
        if (this._usesExplorationConsole()) {
            this._ensureExplorationConsole().refresh();
            return;
        }
        const uiVersion = 'cold-steel-expedition-v1';
        let root = getElementIfExists('dungeonRouteControls');
        // 热更新或同一页面反复进出地牢时，旧控制栏可能仍留在 DOM 中。
        // 旧实现只判断 id 是否存在，会直接复用旧结构，从而看起来“完全没变化”。
        const hasExpectedStructure = root
            && root.querySelector('#dungeonRouteSectorTabs')
            && root.querySelector('#dungeonRouteFit')
            && root.querySelector('#dungeonRouteEdges')
            && root.querySelector('#dungeonRouteFocus');
        if (root && (root.dataset.routeUiVersion !== uiVersion || !hasExpectedStructure)) {
            root.remove();
            root = null;
        }
        if (!root) {
            root = document.createElement('nav');
            root.id = 'dungeonRouteControls';
            root.className = 'dungeon-route-controls';
            root.dataset.routeUiVersion = uiVersion;
            root.setAttribute('aria-label', '地牢路线控制');
            root.innerHTML = `
                <div class="dungeon-route-command-row dungeon-route-command-row--sectors">
                    <div class="dungeon-route-command-label" aria-hidden="true"><strong>区段</strong></div>
                    <div class="dungeon-route-sector-nav" aria-label="路线区段导航">
                        <button id="dungeonRoutePrevSector" type="button" class="dungeon-route-sector-step" aria-label="上一段">‹</button>
                        <div id="dungeonRouteSectorTabs" class="dungeon-route-sector-tabs" role="tablist" aria-label="路线区段"></div>
                        <button id="dungeonRouteNextSector" type="button" class="dungeon-route-sector-step" aria-label="下一段">›</button>
                    </div>
                    <div class="dungeon-route-view-actions" role="group" aria-label="路线视图">
                        <button id="dungeonRouteEdges" type="button" class="bp-button bp-button--muted" aria-pressed="false">全部连线</button>
                        <button id="dungeonRouteFit" type="button" class="bp-button bp-button--muted">战略总览</button>
                        <button id="dungeonRouteFocus" type="button" class="bp-button bp-button--muted">返回当前位置</button>
                    </div>
                    <div id="dungeonRouteProgress" class="dungeon-route-progress" aria-live="polite"></div>
                </div>`;
            document.body.appendChild(root);
            root.querySelector('#dungeonRouteEdges')?.addEventListener('click', () => {
                if (!this.active || this.state !== 'map' || this.routeViewMode === 'overview') return;
                this._showAllRouteEdges = !this._showAllRouteEdges;
                this._clearRoutePointerSelection();
                this._updateRouteControls();
            });
            root.querySelector('#dungeonRoutePrevSector')?.addEventListener('click', () => {
                if (!this.active || this.state !== 'map') return;
                this._focusRouteSector(this.routeSectorIndex - 1);
            });
            root.querySelector('#dungeonRouteNextSector')?.addEventListener('click', () => {
                if (!this.active || this.state !== 'map') return;
                this._focusRouteSector(this.routeSectorIndex + 1);
            });
            root.querySelector('#dungeonRouteFit')?.addEventListener('click', () => {
                if (this.active && this.state === 'map') this._fitRouteMap();
            });
            root.querySelector('#dungeonRouteFocus')?.addEventListener('click', () => {
                if (this.active && this.state === 'map') this._focusOnCurrentNode({ restoreDefaultZoom: true });
            });
        }
        root.hidden = false;
        root.setAttribute('aria-hidden', 'false');
        root.dataset.dungeonType = this.dungeonType || '';
        this._updateRouteControls();
    },

    _updateRouteControls() {
        if (this._usesExplorationConsole()) {
            this._explorationConsole?.refresh();
            return;
        }
        const progress = getElementIfExists('dungeonRouteProgress');
        const headerProgress = getElementIfExists('dungeonRouteHeaderProgress');
        const sectorTabs = getElementIfExists('dungeonRouteSectorTabs');
        const prev = getElementIfExists('dungeonRoutePrevSector');
        const next = getElementIfExists('dungeonRouteNextSector');
        const overview = getElementIfExists('dungeonRouteFit');
        const edgeToggle = getElementIfExists('dungeonRouteEdges');
        if (!progress || !sectorTabs || !prev || !next || !overview) return;
        if (edgeToggle) {
            edgeToggle.hidden = !this._usesLandmarkMap();
            edgeToggle.disabled = this.routeViewMode === 'overview';
            edgeToggle.setAttribute('aria-pressed', String(this._showAllRouteEdges));
            edgeToggle.textContent = this._showAllRouteEdges ? '简洁连线' : '全部连线';
            edgeToggle.title = this._showAllRouteEdges
                ? '点击恢复简洁连线；×N表示共用该段的显示路线数，悬停可走目标可追踪整条路线'
                : '点击显示本区全部连线；×N表示共用该段的显示路线数，悬停可走目标可追踪整条路线';
        }
        const sectors = this._getRouteSectors();
        const availableIds = new Set(this.getAvailableNodes().map(node => node.id));
        const currentSectorIndex = this._getSectorIndexForNode(this.getCurrentNode());
        const safeViewingIndex = Math.max(0, Math.min(Math.max(0, sectors.length - 1), this.routeSectorIndex || 0));
        this.routeSectorIndex = safeViewingIndex;
        const progressText = `探索进度 ${this.visitedNodeIds.size}/${this.nodes.length} · 当前区 ${currentSectorIndex + 1}/${Math.max(1, sectors.length)}${this._usesLandmarkMap() ? ` · ${availableIds.size}处可前往` : ''}`;
        progress.textContent = progressText;
        if (headerProgress) headerProgress.textContent = progressText;
        if (this._usesSplitRouteMap()) {
            const controls = getElementIfExists('dungeonRouteControls');
            if (controls) controls.dataset.presentation = 'split';
        }

        const agentNode = AgentInvasionSystem.triggered && AgentInvasionSystem.agentNodeId
            ? this.nodes.find(node => node.id === AgentInvasionSystem.agentNodeId)
            : null;
        const agentSectorIndex = agentNode ? this._getSectorIndexForNode(agentNode) : -1;
        sectorTabs.replaceChildren();
        for (const sector of sectors) {
            const availableCount = sector.nodes.filter(node => availableIds.has(node.id)).length;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'dungeon-route-sector-tab';
            if (sector.index === safeViewingIndex && this.routeViewMode === 'focus') button.classList.add('is-viewing');
            if (sector.index === currentSectorIndex) button.classList.add('is-current');
            if (sector.visitedCount >= sector.nodes.length) button.classList.add('is-complete');
            if (sector.index === agentSectorIndex) button.classList.add('has-agent');
            if (availableCount) button.classList.add('has-available');
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-selected', String(sector.index === safeViewingIndex && this.routeViewMode === 'focus'));
            if (sector.index === currentSectorIndex) button.setAttribute('aria-current', 'step');
            button.setAttribute('aria-label', `查看第${sector.index + 1}区段，已探索${sector.visitedCount}/${sector.nodes.length}个房间${availableCount ? `，${availableCount}处可前往` : ''}${sector.index === currentSectorIndex ? '，玩家所在区段' : ''}${sector.index === agentSectorIndex ? '，入侵者所在区段' : ''}`);
            button.title = button.getAttribute('aria-label');
            const number = document.createElement('strong');
            number.textContent = String(sector.index + 1).padStart(2, '0');
            const meta = document.createElement('span');
            meta.textContent = `${sector.visitedCount}/${sector.nodes.length}`;
            button.append(number, meta);
            if (this._usesLandmarkMap() && availableCount) {
                const available = document.createElement('span');
                available.className = 'dungeon-route-sector-available';
                available.textContent = `可走${availableCount}`;
                available.setAttribute('aria-hidden', 'true');
                button.appendChild(available);
            }
            button.addEventListener('click', () => this._focusRouteSector(sector.index, {
                focusNodeId: sector.index === currentSectorIndex ? this.currentNodeId : null,
            }));
            sectorTabs.appendChild(button);
        }
        prev.disabled = safeViewingIndex <= 0;
        next.disabled = safeViewingIndex >= sectors.length - 1;
        overview.disabled = this.routeViewMode === 'overview';
        overview.setAttribute('aria-pressed', String(this.routeViewMode === 'overview'));
    },

    _removeRouteControls() {
        getElementIfExists('dungeonRouteControls')?.remove();
    },

    /**
     * 地牢路线选择界面奖励面板（数据驱动，随地牢类型显示）：
     * - 首领金币：BossRewardSystem 实际发放区间
     * - 精英宝箱装备：ChestRoomSystem 实际档位与概率
     * - 祭品范围：当前地牢 grade 的真实掉落权重范围
     * 与入侵概率卡共挂左侧信息栈，在上方背景图左黑幕内纵向排列。
     */
    _createDungeonRewardPanel() {
        const stack = this._usesExplorationConsole() ? this._ensureExplorationConsole().rewardHost : this._ensureMapInfoStack();
        const existing = getElement('dungeonRewardPanel');
        if (existing) {
            stack.prepend(existing);
            return;
        }
        const el = document.createElement('div');
        el.id = 'dungeonRewardPanel';
        el.className = 'dungeon-route-reward-panel';
        const g = (DungeonConfig.getDungeonList() || {})[this.dungeonType] || {};
        const grade = g.grade || 'D';
        const chestPreview = ChestRoomSystem.getRewardPreview(this.dungeonType);
        const rewardRule = getDungeonRewardRule(this.dungeonType);
        const bossBase = rewardRule.bossGold.min;
        const bossMax = rewardRule.bossGold.max;
        const tributeTable = ((COMBAT_FORMULAS.tributes || {}).dropTables || {})[grade] || {};
        const tributeCapIndex = RARITY_ORDER.indexOf(tributeTable.maxRarity);
        const tributeRarities = ['normal', 'elite', 'lord', 'boss']
            .flatMap(rank => tributeTable[rank]?.weights || [])
            .filter(([, weight]) => Number(weight) > 0)
            .map(([rarity]) => rarity)
            .filter((rarity) => {
                const rarityIndex = RARITY_ORDER.indexOf(rarity);
                return rarityIndex >= 0 && (tributeCapIndex < 0 || rarityIndex <= tributeCapIndex);
            });
        const tributeIndexes = tributeRarities.map(rarity => RARITY_ORDER.indexOf(rarity));
        const tributeLo = tributeIndexes.length ? RARITY_ORDER[Math.min(...tributeIndexes)] : 'common';
        const tributeHi = tributeIndexes.length ? RARITY_ORDER[Math.max(...tributeIndexes)] : (tributeTable.maxRarity || 'legendary');
        const fmt = value => Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('zh-CN');
        el.innerHTML = `
            <div class="dungeon-route-panel-kicker">${g.name || this.dungeonName || '当前地牢'} · ${grade}级</div>
            <div class="dungeon-route-panel-title">预期奖励</div>
            <div class="dungeon-route-reward-row"><span>首领金币</span><strong>${fmt(bossBase)} ~ ${fmt(bossMax)}</strong></div>
            <div class="dungeon-route-reward-row"><span>通关金币</span><strong>${fmt(rewardRule.completionGold)} 起</strong></div>
            <div class="dungeon-route-reward-row"><span>竞技场宝箱</span><strong>${Math.round(chestPreview.goldChance * 100)}% ${fmt(chestPreview.gold)}金 · 石${fmt(chestPreview.enhancementStone)}/券${fmt(chestPreview.reforgeTicket)}必得</strong></div>
            <div class="dungeon-route-reward-row"><span>精英附加</span><strong>${getRarityLabel(chestPreview.equipmentRarity)}装备 · ${Math.round(chestPreview.equipmentChance * 100)}%</strong></div>
            <div class="dungeon-route-reward-row"><span>祭品范围</span><strong>${getRarityLabel(tributeLo)} ~ ${getRarityLabel(tributeHi)}</strong></div>
        `;
        stack.prepend(el);
        const invasion = getElementIfExists('invasionChanceLabel');
        if (invasion) (this._usesExplorationConsole() ? this._ensureMapInfoStack() : stack).appendChild(invasion);
    },

    /** 路线探索统一指挥层：地标模式横向排布，旧模式保持上方40%三栏。 */
    _ensureRouteTopHud() {
        if (this._usesExplorationConsole()) return this._ensureExplorationConsole().root;
        const uiVersion = 'cold-steel-expedition-v1';
        let root = getElementIfExists('dungeonRouteTopHud');
        if (root && root.dataset.routeTopUiVersion !== uiVersion) {
            root.remove();
            root = null;
        }
        if (!root) {
            root = document.createElement('section');
            root.id = 'dungeonRouteTopHud';
            root.className = 'dungeon-route-top-hud';
            root.dataset.routeTopUiVersion = uiVersion;
            root.setAttribute('aria-label', '地牢探索指挥层');
            root.innerHTML = `
                <header id="dungeonRouteTopHeading" class="dungeon-route-top-heading" aria-label="探索进度">
                    <div id="dungeonRouteHeadingTitle" class="dungeon-route-heading-title"></div>
                    <div id="dungeonRouteHeaderProgress" class="dungeon-route-heading-progress" aria-live="polite"></div>
                </header>
                <aside id="dungeonRouteTopIntel" class="dungeon-route-top-zone dungeon-route-top-zone--intel" aria-label="任务情报"></aside>
                <div id="dungeonRouteTopStatus" class="dungeon-route-top-zone dungeon-route-top-zone--status" aria-label="角色状态"></div>
                <aside id="dungeonRouteTopActions" class="dungeon-route-top-zone dungeon-route-top-zone--actions" aria-label="撤离操作"></aside>`;
            document.body.appendChild(root);
        }
        const fullPlate = this._usesFullMapBackground();
        const landmark = this._usesLandmarkMap();
        root.dataset.fullPlate = fullPlate ? 'true' : 'false';
        const split = this._usesSplitRouteMap();
        root.dataset.presentation = split ? 'split' : landmark ? 'landmark' : 'legacy';
        document.body.classList.toggle('dungeon-route-full-plate', fullPlate);
        document.body.classList.toggle('dungeon-route-landmark-mode', landmark);
        document.body.classList.toggle('dungeon-route-split-mode', split);
        const headingTitle = getElementIfExists('dungeonRouteHeadingTitle');
        if (headingTitle) headingTitle.textContent = `${this.dungeonName || '恐怖地牢'} · ${split ? '远征探索' : '地标路线'}`;
        return root;
    },

    _getRouteTopZone(zoneId) {
        this._ensureRouteTopHud();
        return getElement(zoneId);
    },

    _removeRouteTopHud() {
        this._explorationConsole?.destroy();
        this._explorationConsole = null;
        getElementIfExists('dungeonRouteTopHud')?.remove();
        if (typeof document !== 'undefined') {
            document.body.classList.remove('dungeon-route-full-plate');
            document.body.classList.remove('dungeon-route-landmark-mode');
            document.body.classList.remove('dungeon-route-split-mode');
        }
    },

    _ensureMapInfoStack() {
        if (this._usesExplorationConsole()) return this._ensureExplorationConsole().infoStack;
        let stack = getElementIfExists('dungeonRouteInfoStack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'dungeonRouteInfoStack';
            stack.className = 'dungeon-route-info-stack';
        }
        const zone = this._getRouteTopZone('dungeonRouteTopIntel');
        if (stack.parentElement !== zone) zone.appendChild(stack);
        return stack;
    },

    _removeDungeonRewardPanel() {
        const el = getElement('dungeonRewardPanel');
        if (el) el.remove();
        const stack = getElementIfExists('dungeonRouteInfoStack');
        if (stack && !stack.children.length) stack.remove();
    },

    /**
     * 左侧地牢信息（时空特工入侵几率标签 + 预期奖励面板）显隐：
     * 仅路线选择（地图）画面显示，进入战斗/事件/奖励节点时隐藏，
     * 返回地图时恢复（2026-08-11 用户要求：不进游戏画面）。
     */
    _setMapInfoVisibility(visible) {
        const topHud = getElementIfExists('dungeonRouteTopHud');
        if (topHud) topHud.style.display = visible ? 'grid' : 'none';
        const stack = getElementIfExists('dungeonRouteInfoStack');
        if (stack) {
            stack.style.display = visible ? '' : 'none';
            return;
        }
        for (const id of ['invasionChanceLabel', 'dungeonRewardPanel']) {
            const el = getElementIfExists(id);
            if (el) el.style.display = visible ? '' : 'none';
        }
    },

    _createAbandonButton() {
        const actionZone = this._getRouteTopZone('dungeonRouteTopActions');
        const existing = getElement('abandonButton');
        if (existing) {
            if (existing.parentElement !== actionZone) actionZone.appendChild(existing);
            return;
        }
        // 挂入路线专用操作区；常规 HUD 在 map-mode 下隐藏，避免与撤离操作争夺右上安全区。
        // 使用冷钢通用按钮，不再依赖旧的整板按钮图片。
        const btn = document.createElement('button');
        btn.id = 'abandonButton';
        btn.type = 'button';
        btn.className = 'bp-button bp-button--muted dungeon-route-action dungeon-route-action--abandon';
        btn.setAttribute('aria-label', '放弃本次地牢并返回');
        btn.innerHTML = this._usesExplorationConsole()
            ? '<strong>强制放弃</strong><span>丢失背包全部物品 · 需二次确认</span>'
            : '<strong>放弃并返回</strong><span>结束本次探险</span>';
        btn.addEventListener('click', () => {
            if (this.active && this.state === 'map') {
                this._showExitConfirm();
            }
        });
        actionZone.appendChild(btn);
        // 安全撤离按钮跟随放弃按钮一起刷新（仅在起始点时显示）
        this._updateSafeEvacButton();
    },

    _removeAbandonButton() {
        const btn = getElement('abandonButton');
        if (btn) btn.remove();
        this._removeSafeEvacButton();
    },

    /** 安全撤离按钮：仅在当前位于起始点时显示（右列顶部，放弃按钮上方），撤离不丢背包物品 */
    _updateSafeEvacButton() {
        const current = this.getCurrentNode();
        const atStart = !!(current && current.type === 'start');
        const existing = getElement('safeEvacButton');
        if (!atStart && !this._usesExplorationConsole()) {
            if (existing) existing.remove();
            return;
        }
        const actionZone = this._getRouteTopZone('dungeonRouteTopActions');
        if (existing) {
            if (existing.parentElement !== actionZone) actionZone.prepend(existing);
            existing.disabled = !atStart;
            if (this._usesExplorationConsole()) existing.querySelector('span').textContent = atStart
                ? '仅起点可用 · 保留背包物品' : '返回起点后可用 · 保留背包物品';
            return;
        }
        const btn = document.createElement('button');
        btn.id = 'safeEvacButton';
        btn.type = 'button';
        btn.className = 'bp-button dungeon-route-action dungeon-route-action--evacuate';
        btn.setAttribute('aria-label', '安全撤离并保留当前战利品');
        btn.disabled = !atStart;
        btn.innerHTML = this._usesExplorationConsole()
            ? `<strong>安全撤离</strong><span>${atStart ? '仅起点可用' : '返回起点后可用'} · 保留背包物品</span>`
            : '<strong>安全撤离</strong><span>保留当前战利品</span>';
        btn.addEventListener('click', () => {
            if (this.active && this.state === 'map' && !this._observerSuspended && this.getCurrentNode()?.type === 'start') {
                this._safeEvacuate();
            }
        });
        actionZone.prepend(btn);
    },

    /**
     * 统一计算顶部指挥层两侧栏宽度：完整底板按视口比例，旧contain背景按黑幕宽度。
     * @param {number} viewW 视口宽（画布像素）
     * @param {number} imgDispW 背景图显示宽度，未就绪时为0
     */
    _positionMapButtons(viewW, imgDispW) {
        const root = this._ensureRouteTopHud();
        const fullPlate = this._usesFullMapBackground();
        const barW = imgDispW > 0 && imgDispW < viewW ? (viewW - imgDispW) / 2 : 0;
        const preferred = fullPlate ? viewW * 0.16 : Math.max(184, barW - 16);
        const sideWidth = Math.max(184, Math.min(288, Math.round(preferred)));
        root.style.setProperty('--dungeon-route-side-width', `${sideWidth}px`);
    },

    _removeSafeEvacButton() {
        const btn = getElement('safeEvacButton');
        if (btn) btn.remove();
    },

    _createDungeonNameLabel() {
        if (this._usesExplorationConsole()) return;
        const stack = this._ensureMapInfoStack();
        const existing = getElement('dungeonMapNameLabel');
        if (existing) {
            stack.appendChild(existing);
            return;
        }
        const el = document.createElement('div');
        el.id = 'dungeonMapNameLabel';
        el.className = 'dungeon-route-title';
        el.textContent = `当前地牢：${this.dungeonName || '未知地牢'}`;
        stack.appendChild(el);
    },

    _removeDungeonNameLabel() {
        const el = getElement('dungeonMapNameLabel');
        if (el) el.remove();
    },

    /** 地图选路模式顶部状态栏（生命/魔法/等级；保持原页面根层坐标与尺寸） */
    _createMapStatusBar() {
        // 状态栏不能挂进路线指挥层，否则会继承指挥层的网格宽度、紧凑间距和响应式隐藏。
        // 继续挂在 body，完整复用 .dungeon-route-status 的既定顶部居中与尺寸合同。
        const statusHost = document.body;
        const existing = getElement('dungeonMapStatusBar');
        if (existing) {
            if (existing.parentElement !== statusHost) statusHost.appendChild(existing);
            return;
        }
        const el = document.createElement('div');
        el.id = 'dungeonMapStatusBar';
        el.className = 'dungeon-route-status';
        statusHost.appendChild(el);
        this._updateMapStatusBar();
    },

    _updateMapStatusBar() {
        const el = getElement('dungeonMapStatusBar');
        if (!el) return;
        const player = Game.player || this.player;
        if (!player || !player.data) return;
        const d = player.data;
        const hpPct = Math.max(0, Math.min(100, (d.hp / Math.max(1, d.maxHp)) * 100));
        const mpPct = Math.max(0, Math.min(100, (d.mp / Math.max(1, d.maxMp)) * 100));
        const bar = (pct, kind) => `
            <span class="dungeon-route-meter">
                <span class="dungeon-route-meter-fill dungeon-route-meter-fill--${kind}" style="width:${pct}%;"></span>
            </span>`;
        el.innerHTML = `
            <span class="dungeon-route-level">Lv.${d.level ?? 1}</span>
            <span class="dungeon-route-status-item"><span>生命</span><strong>${Math.ceil(d.hp)}/${d.maxHp}</strong>${bar(hpPct, 'hp')}</span>
            <span class="dungeon-route-status-item"><span>魔法</span><strong>${Math.ceil(d.mp)}/${d.maxMp}</strong>${bar(mpPct, 'mp')}</span>
        `;
    },

    _removeMapStatusBar() {
        const el = getElement('dungeonMapStatusBar');
        if (el) el.remove();
    },

    _setMapStatusBarVisible(visible) {
        const el = getElement('dungeonMapStatusBar');
        if (el) el.style.display = visible ? 'flex' : 'none';
    },

    _showVictory() {
        const player = Game.player || this.player;

        // ===== 通关结算数据（单局统计 + 探索完成度 + 全清奖励） =====
        const stats = DungeonRunStats;
        const totalNodes = this.nodes.filter(n => n.type !== 'start').length;
        const clearedNodes = this.nodes.filter(n => n.type !== 'start' && n.completed).length;
        const clearPct = totalNodes > 0 ? Math.round(clearedNodes / totalNodes * 100) : 0;
        // 全清奖励：完成度 100% 额外 +10% 本局经验（只发一次，在此结算）
        let clearBonus = 0;
        if (player && totalNodes > 0 && clearedNodes >= totalNodes && stats.exp > 0) {
            clearBonus = Math.floor(stats.exp * 0.10);
            player.gainExp(clearBonus);
        }
        const d = player && player.data;
        const expRemain = d ? Math.max(0, Math.round(d.maxExp - d.exp)) : 0;
        const k = stats.kills;
        const killLine = `普通 ${k.normal} · 精英 ${k.elite} · 领主 ${k.lord} · 首领 ${k.boss}（共 ${stats.totalKills()}）`;

        const overlay = document.createElement("div");
        overlay.id = "dungeonVictoryOverlay";
        overlay.className = 'dungeon-decision-overlay dungeon-victory-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'dungeonVictoryTitle');
        overlay.setAttribute('aria-describedby', 'dungeonVictorySummary');
        overlay.innerHTML = `
            <section class="dungeon-victory-modal">
                <div class="dungeon-decision-eyebrow">MISSION ARCHIVE // DUNGEON CLEARED</div>
                <h1 id="dungeonVictoryTitle" class="dungeon-victory-title">地牢通关</h1>
                <div id="dungeonVictorySummary" class="dungeon-victory-summary">
                    <div class="dungeon-victory-row"><span>击杀统计</span><strong>${killLine}</strong></div>
                    <div class="dungeon-victory-row"><span>经验合计</span><strong class="dungeon-victory-value">${stats.exp} EXP</strong></div>
                    ${clearBonus > 0 ? `<div class="dungeon-victory-row dungeon-victory-row--success"><span>全清奖励</span><strong>+${clearBonus} EXP</strong></div>` : ''}
                    <div class="dungeon-victory-row"><span>探索完成度</span><strong>${clearPct}%（${clearedNodes}/${totalNodes} 节点）</strong></div>
                    ${d ? `<div class="dungeon-victory-row"><span>当前进度</span><strong>Lv.${d.level} · 距下一级 ${expRemain} EXP</strong></div>` : ''}
                </div>
                <button id="dungeonVictoryBtn" type="button" class="bp-button dungeon-victory-button">返回主神空间</button>
            </section>
        `;
        document.body.appendChild(overlay);

        const btn = getElement("dungeonVictoryBtn");
        requestAnimationFrame(() => btn?.focus({ preventScroll: true }));
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Tab') {
                event.preventDefault();
                btn?.focus({ preventScroll: true });
            }
        });
        btn.onclick = async () => {
            btn.disabled = true;
            overlay.remove();
            this._recordRunResult('success');
            this.shutdown();
            const player = Game.player || this.player;
            if (!player) {
                console.error('[DungeonMapSystem] No player found, cannot switch scene');
                alert('无法返回主神空间：玩家数据丢失');
                return;
            }
            try {
                await SceneManager.switchScene("main", player);
                
            } catch (err) {
                console.error('[DungeonMapSystem] Failed to return to main:', err);
                alert('返回主神空间失败: ' + (err.message || '未知错误'));
            }
        };
    },

    /** 清空玩家背包（地牢死亡/放弃退出的惩罚；装备与金币不受影响） */
    _clearPlayerBackpack() {
        import('../ui/equip-manager.js').then(mod => {
            const mgr = mod.EquipManager || mod.default;
            if (mgr && Array.isArray(mgr.backpackItems)) {
                mgr.backpackItems = [];
                if (typeof mgr.updateInventorySlots === 'function') mgr.updateInventorySlots();
            }
        }).catch(() => {});
    },

    /** 安全撤离：返回主神空间，不丢失背包物品（仅起始点可用，见 _updateSafeEvacButton） */
    async _safeEvacuate() {
        this._removeSafeEvacButton();
        this._recordRunResult('safe_evac');
        this.shutdown();
        const player = Game.player || this.player;
        if (player) {
            try {
                await SceneManager.switchScene("main", player);
            } catch (err) {
                console.error('[DungeonMapSystem] Safe evacuate failed:', err);
                alert('返回主神空间失败: ' + (err.message || '未知错误'));
            }
        }
    },

    _showExitConfirm() {
        if (getElementIfExists("dungeonExitConfirm")) return;
        this._createDecisionModal({
            id: 'dungeonExitConfirm',
            eyebrow: 'EXPEDITION ARCHIVE // ABANDON RUN',
            title: '确认放弃地牢',
            description: '放弃将立即结束本次探险并返回主神空间。',
            dangerText: '背包中的所有物品都会丢失，且无法恢复。',
            tone: 'danger',
            actions: [
                {
                    id: 'dungeonExitCancelBtn',
                    label: '继续探索',
                    kind: 'muted',
                    cancel: true,
                    autofocus: true,
                    onSelect: ({ close }) => close(),
                },
                {
                    id: 'dungeonExitConfirmBtn',
                    label: '确认放弃',
                    kind: 'danger',
                    onSelect: async ({ close, overlay }) => {
                        overlay.querySelectorAll('button').forEach(button => { button.disabled = true; });
                        close({ restoreFocus: false });
                        // 放弃惩罚：丢失背包中所有物品（安全撤离/通关/胜利不触发）
                        this._clearPlayerBackpack();
                        this._recordRunResult('abandoned');
                        this.shutdown();
                        const player = Game.player || this.player;
                        if (player) {
                            try {
                                await SceneManager.switchScene("main", player);
                            } catch (err) {
                                console.error('[DungeonMapSystem] Exit to main failed:', err);
                                alert('返回主神空间失败: ' + (err.message || '未知错误'));
                            }
                        }
                    },
                },
            ],
        });
    },

};

// 将 DungeonMapSystem 挂载到全局，供其他模块（如 GameScene.js、player.js）访问
if (typeof window !== 'undefined' && !window.DungeonMapSystem) {
    window.DungeonMapSystem = DungeonMapSystem;
}
