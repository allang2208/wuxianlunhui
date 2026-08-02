
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

import { ZombieDungeonMapGenerator, ZOMBIE_DUNGEON_CONFIG, ZombieDungeonCombat, ZombieDungeonShop, createTombstone } from './zombie-dungeon.js';
import { AgentInvasionSystem } from './agent-invasion-system.js';
import { TrapSystem } from './trap-system.js';
import { WallGate } from './wall-gate.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import { loadImage } from '../utils/image-loader.js';
import { anchorRect } from '../utils/layout.js';

/** 路线选择界面区域 spec（1920×1080 基准；比例固定不随分辨率变化）：
 *  下区地图 = 60%（648/1080），上区背景 = 40%（432/1080）；
 *  left/bottom 零边距 + height 按视口等比缩放 → 任意分辨率下都是 40/60 分界 */
const MAP_AREA_SPEC = { left: 0, bottom: 0, width: 1920, height: 648 };
// 路线图显示窗口（2K 2560×1440 基准，其他分辨率按视口等比换算）：
// 地图内容（节点/连线）限定在此窗口内，居中于下方区域
const MAP_VIEW_SPEC = { left: 572, bottom: 112, width: 1391, height: 579 };
import { clearTributeBuffs, getMoonshadowConfig } from '../config/tribute-effects.js';
import { DungeonFogOfWar } from './dungeon-map-generator.js';
import { CombatRoomSystem } from './combat-room-system.js';
import { ChestRoomSystem } from './chest-room-system.js';
import { setDungeonFloorProfile } from './dungeon-floor-texture.js';
import { WallSystem } from './wall-system.js';
import { BossRewardSystem } from './boss-reward-system.js';
import { EffectManager } from '../effects/effect-manager.js';
import { getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { setCurrentDungeonType, getRoomClearBonus, getStreakMultiplier, getRoomExpEstimate, getDungeonExpBase } from '../config/exp-system.js';
import { DungeonRunStats } from './dungeon-run-stats.js';
import { isWallPrefabsLoaded, loadWallPrefabs, whenWallPrefabsLoaded } from './wall-prefabs.js';

import { GoldManager } from '../systems/gold-manager.js';

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
    _eventListeners: [],
    _mapAnimT: 0, // 地图动画时钟（ms 累计：流动虚线/呼吸环/脉冲）

    // 地图缩放范围与初始倍数（滚轮与 _centerRouteMap 共用，勿再散落硬编码）
    MIN_MAP_SCALE: 0.3,
    MAX_MAP_SCALE: 3,
    DEFAULT_ZOOM_FACTOR: 3,

    TYPE_COLORS: {
        start:  "#3a5a3a",
        combat: "#7a3a3a",
        event:  "#6a5a3a",
        boss:   "#7a0000",
        reward: "#5a3a7a",
        empty:  "#3a3a3a",
    },
    TYPE_BORDER_COLORS: {
        start:  "#6aca6a",
        combat: "#aa5a5a",
        event:  "#9a8a5a",
        boss:   "#aa0000",
        reward: "#8a5aaa",
        empty:  "#5a5a5a",
    },
    TYPE_ICONS: {
        start:  "▶",
        combat: "⚔",
        event:  "?",
        boss:   "☠",
        reward: "💎",
        empty:  "·",
    },
    // 节点贴图（素材库地牢界面：已透明底；boss/reward 暂用纯色圆+图标）
    NODE_TEX: {
        start:  'node_start',
        combat: 'node_combat',
        event:  'node_event',
        empty:  'node_empty',
    },
    NODE_TEX_SIZE: 42, // 节点贴图最大边（地图单位；84 → 42 缩小 50%）
    // 节点贴图内容包围盒（1536² 画布内，密集图案实测 + 4px 余量）：
    // 整画布缩放会让图标只占 ~26% 而显得极小（"环比节点大 3~4 倍"根因）；
    // 随机事件须用密集区 bbox（568,576）~（972,972），几何包围盒被左上大片空白撑大
    NODE_TEX_CROP: {
        node_start:  [574, 566, 414, 408],
        node_combat: [560, 556, 414, 408],
        node_empty:  [572, 570, 414, 408],
        node_event:  [564, 572, 412, 404],
    },

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

    // UI 点击区域（X/Y 由 _getExitButtonRect 随视口计算，此处只留固定尺寸）
    EXIT_BUTTON_W: 90,
    EXIT_BUTTON_H: 28,

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

    // 出口传送门（战斗结束后生成）
    _exitPortalSpawned: false,

    init(sceneId, player, dungeonType = 'default') {
        this.active = true;
        this.state = "map";
        this.sceneId = sceneId;
        this.player = player;
        this.dungeonType = dungeonType;
        // 经验系统：注入当前地牢类型（exp-system 计算怪物经验/压级衰减的上下文）
        setCurrentDungeonType(dungeonType);
        const dungeonList = DungeonConfig.getDungeonList();
        this.dungeonName = (dungeonList[dungeonType] && dungeonList[dungeonType].name) || ZOMBIE_DUNGEON_CONFIG.name;
        this.currentNodeId = null;
        this.visitedNodeIds.clear();
        this.hoveredNodeId = null;
        this._combatMonsters = [];
        this._combatMonsterKeys = [];
        this._combatRoomWalls = [];
        this._combatCheckTimer = 0;
        this._zombieCombat = null;
        this._zombieWaveActive = false;
        this._zombieCombatNode = null;
        this._waveTransitioning = false;
        this._exitPortalSpawned = false;
        // 宝箱离场确认框状态复位（与 shutdown 同口径，防上一局残留）
        this._chestLeaveConfirm = false;
        this._chestLeaveCd = 0;
        const staleChestConfirm = getElement('chestLeaveConfirm');
        if (staleChestConfirm) staleChestConfirm.remove();

        // 初始化迷雾系统
        this.fogOfWar = new DungeonFogOfWar();
        // 时空特工追击机制（D 级及以上地牢；内部按难度判定是否启用）
        AgentInvasionSystem.init(this);
        // 单局统计（通关结算面板数据源）：击杀/经验/节点清理
        DungeonRunStats.reset();
        // 地板贴图组（按地牢类型配置：随机选图+镜像+发光层开关；离开时恢复默认）
        setDungeonFloorProfile(DungeonConfig.getDungeonFloorProfile(dungeonType));
        // 墙样式（按地牢类型：僵尸砖墙 / 沼泽柴墙+藤门；离开时恢复默认）
        WallSystem.setWallStyle(dungeonType);
        // 墙预制库加载补发（BootScene 已 fire-and-forget 预载；此处幂等补发，
        // 让加载最迟在进地牢时已发起——仍未就绪时 _enterCombatArena 会等加载完成再构建）
        loadWallPrefabs();

        this.generateMap();
        this._centerRouteMap();
        this.isDragging = false;
        this.dragStartX = undefined;
        this.dragStartY = undefined;

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

        // 初始化时显示地图界面按钮与地牢名称
        this._createMouseShopButton();
        this._createAbandonButton();
        this._createDungeonNameLabel();
        // 地图选路模式顶部状态栏（生命/魔法/等级）
        this._createMapStatusBar();

        
    },

    shutdown() {
        // 清理商店轮询，防止 shutdown 后 interval 泄漏触发 _returnToMap
        if (this._shopCheckInterval) {
            TimerManager.clearInterval(this._shopCheckInterval);
            this._shopCheckInterval = null;
        }
        this.active = false;
        this.state = "idle";
        // 经验系统：离开地牢，回退主神空间口径（F 档）
        setCurrentDungeonType(null);
        this.nodes = [];
        this.edges = [];
        this._cleanupEventUI();
        this._removeMouseShopButton();
        this._removeAbandonButton();
        this._removeDungeonNameLabel();
        this._removeMapStatusBar();
        this._removeNodeTooltip();
        // 通关结算面板兜底移除（异常退出路径）
        const victoryOverlay = getElement('dungeonVictoryOverlay');
        if (victoryOverlay) victoryOverlay.remove();
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
        const chestConfirmEl = getElement('chestLeaveConfirm');
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
        // 清空携带的祭品，确保祭品效果只在当前地牢有效
        this._carriedItems = [];
        // 清除特效祭品 buff 图标（雪莲/人参/蟠桃）
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

    // ───────────────────────────────────────────────
    // 事件绑定：拖动 + 滚轮缩放
    // ───────────────────────────────────────────────
    _bindEvents() {
        const canvas = getElement("gameCanvas");
        if (!canvas) return;

        const onMouseDown = (e) => {
            // 只有在下方地图选择区域内按下才允许拖动；上方背景图区域不可交互
            if (this.state === "map" && !this._isInMapArea(e.clientX, e.clientY)) return;
            this.isDragging = false;
            this._dragMoved = false;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            this.dragStartOffsetX = this.mapOffsetX;
            this.dragStartOffsetY = this.mapOffsetY;
            this._mouseDownTime = Date.now();
            this._mouseDownPos = { x: e.clientX, y: e.clientY };
        };

        const onMouseMove = (e) => {
            if (this.state !== "map") return;
            if (this.dragStartX === undefined) return;
            // 长按才允许拖动：鼠标键在窗口外松开等情况下强制结束拖动
            if ((e.buttons & 1) === 0) {
                this.isDragging = false;
                this.dragStartX = undefined;
                this.dragStartY = undefined;
                return;
            }
            const dx = e.clientX - this.dragStartX;
            const dy = e.clientY - this.dragStartY;
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

        const onMouseUp = () => {
            // 如果发生了拖动，标记本次点击为拖动，避免触发节点选择
            if (this.isDragging) {
                this._dragMoved = true;
            }
            this.isDragging = false;
            this.dragStartX = undefined;
            this.dragStartY = undefined;
        };

        canvas.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        // 滚轮：节点贴图版禁止缩放（只能拖动调整位置，防止贴图大小随缩放变化）——
        // 仅阻止页面滚动，保留拖动平移
        const onWheel = (e) => {
            if (this.state !== "map") return;
            if (!this._isInMapArea(e.clientX, e.clientY)) return;
            e.preventDefault();
        };
        canvas.addEventListener("wheel", onWheel, { passive: false });

        this._eventListeners = [
            { el: canvas, type: "mousedown", fn: onMouseDown },
            { el: window, type: "mousemove", fn: onMouseMove },
            { el: window, type: "mouseup", fn: onMouseUp },
            { el: canvas, type: "wheel", fn: onWheel },
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

    // 僵尸家族地牢（共享僵尸战斗/波次系统）：zombie / zombieBeginner / zombieMid / swamp
    _isZombieFamily() {
        return this.dungeonType === 'zombie' || this.dungeonType === 'zombieBeginner' || this.dungeonType === 'zombieMid' || this.dungeonType === 'swamp';
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
     * 背景图显示：界面严格分两块——上方纯美观背景图（不可交互、不被地图遮盖），
     * 下方为地图选择区域。背景图 contain 等比例缩小铺进上区：整图完整显示、不变形，
     * 上下居中、左右留黑边（40% 上区比原图比例宽，天然形成左右黑条）；
     * 图片四缘叠加黑色渐变淡出（左右强、上下轻），融入黑幕避免生硬切边；
     * 背景只画在上区内，绝不画进下方地图区域。
     * 图片路径按地牢类型走配置（DungeonConfig.mapBackground），新增地牢各自配置。
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
        if (!img || !img.complete || img.naturalWidth === 0 || topH <= 0) return;
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

    /**
     * 下方地图选择区域背景图（assets/ui/dungeon-map/map-bg.png）：
     * 拉伸放大铺满整个地图区域（area），节点/连线绘制在其上；
     * 图片未就绪时保持默认深色底块（#08080a）。
     */
    _drawMapAreaBackground(ctx, area) {
        const path = 'assets/ui/dungeon-map/map-bg.png';
        if (!this._mapBgImg || this._mapBgImgPath !== path) {
            this._mapBgImgPath = path;
            this._mapBgImg = loadImage(path);
        }
        const img = this._mapBgImg;
        if (!img || !img.complete || img.naturalWidth === 0) return;
        ctx.drawImage(img, area.left, area.top, area.width, area.height);
    },

    /** 当前地牢的路线选择界面背景图路径（配置驱动，含兜底） */
    _getMapBackgroundPath() {
        const cfg = DungeonConfig.getZombieDungeonConfig(this.dungeonType);
        return (cfg && cfg.mapBackground) || 'assets/scenes/dungeon-map-bg.png';
    },

    /** 节点贴图懒加载（缓存于 this._nodeTexImgs） */
    _getNodeTexImage(key) {
        if (!this._nodeTexImgs) this._nodeTexImgs = {};
        const path = `assets/ui/dungeon-map/${key}.png`;
        const cached = this._nodeTexImgs[key];
        if (cached && cached._path === path) return cached;
        const img = loadImage(path);
        img._path = path;
        this._nodeTexImgs[key] = img;
        return img;
    },

    /**
     * 钳制地图偏移，使 2048×2048 的地图不会拖出显示区域
     */
    /** 路线选择界面显示区域（layout.js 统一适配；spec 为 1920×1080 基准坐标，
     *  下区地图 = 60% 屏高、上区背景 = 40% 屏高，比例固定不随分辨率变化） */
    _getMapTargetArea(viewW, viewH) {
        const vw = viewW || ((typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1920);
        const vh = viewH || ((typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 1080);
        return anchorRect(MAP_AREA_SPEC, vw, vh);
    },

    /** 路线图显示窗口（2K 2560×1440 基准等比换算；地图内容限定于此窗口内） */
    _getMapViewRect(viewW, viewH) {
        const vw = viewW || ((typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 2560);
        const vh = viewH || ((typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 1440);
        const sx = vw / 2560;
        const sy = vh / 1440;
        const height = Math.round(MAP_VIEW_SPEC.height * sy);
        return {
            left: Math.round(MAP_VIEW_SPEC.left * sx),
            top: Math.round(vh - MAP_VIEW_SPEC.bottom * sy - height),
            width: Math.round(MAP_VIEW_SPEC.width * sx),
            height,
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
        const fw = Math.max(24, Math.round(w * 0.12));
        const fh = Math.max(16, Math.round(h * 0.12));
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

    /** 退出按钮绘制/点击共用同一矩形（随视口右对齐，不再写死 1920） */
    _getExitButtonRect(viewW) {
        const vw = viewW || ((typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1920);
        return { x: vw - 110, y: 15, w: this.EXIT_BUTTON_W, h: this.EXIT_BUTTON_H };
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
        const b = this._calculateNodeBounds();
        return { minX: b.minX - PAD, minY: b.minY - PAD, maxX: b.maxX + PAD, maxY: b.maxY + PAD };
    },

    _clampMapOffset() {
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
    _calculateNodeBounds() {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const node of this.nodes) {
            if (node.x < minX) minX = node.x;
            if (node.x > maxX) maxX = node.x;
            if (node.y < minY) minY = node.y;
            if (node.y > maxY) maxY = node.y;
        }
        return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
    },

    _centerRouteMap() {
        // 路线图显示窗口（与拖动钳制共用 _getMapViewRect）
        const TARGET_AREA = this._getMapViewRect();

        if (this.nodes.length === 0) {
            // 无节点时，默认居中显示在目标区域内
            const scaleX = TARGET_AREA.width / this.MAP_WIDTH;
            const scaleY = TARGET_AREA.height / this.MAP_HEIGHT;
            this.mapScale = Math.min(scaleX, scaleY);
            this.mapOffsetX = TARGET_AREA.left + (TARGET_AREA.width - this.MAP_WIDTH * this.mapScale) / 2;
            this.mapOffsetY = TARGET_AREA.top + (TARGET_AREA.height - this.MAP_HEIGHT * this.mapScale) / 2;
            return;
        }

        const bounds = this._calculateNodeBounds();
        const padding = 80; // 地图坐标边距，确保路线图不贴边

        // 先求完整适配缩放，再按 DEFAULT_ZOOM_FACTOR 放大（默认 3 倍初始视图）
        const routeW = bounds.maxX - bounds.minX + padding * 2;
        const routeH = bounds.maxY - bounds.minY + padding * 2;
        const fitScale = Math.min(TARGET_AREA.width / routeW, TARGET_AREA.height / routeH, 1.5);
        this.mapScale = Math.min(fitScale * this.DEFAULT_ZOOM_FACTOR, this.MAX_MAP_SCALE);

        // 初始聚焦出发点（无出发点时退回路线中心），随后钳制到区域边缘
        const startNode = this.nodes.find(n => n.type === 'start');
        const focusX = startNode ? startNode.x : (bounds.minX + bounds.maxX) / 2;
        const focusY = startNode ? startNode.y : (bounds.minY + bounds.maxY) / 2;
        this.mapOffsetX = TARGET_AREA.left + TARGET_AREA.width / 2 - focusX * this.mapScale;
        this.mapOffsetY = TARGET_AREA.top + TARGET_AREA.height / 2 - focusY * this.mapScale;
        this._clampMapOffset();
    },

    // ───────────────────────────────────────────────
    // 更新与交互
    // ───────────────────────────────────────────────
    update(_dt) {
        if (!this.active || this.state !== "map") return;
        this._mapAnimT += _dt;
        this._setMapStatusBarVisible(true);
        this._updateHover();
        if (Input.mouse.leftPressed && !this._dragMoved) {
            this._handleClick();
        }
        // 每帧重置拖动标记，避免拖动后的单次点击被误判
        this._dragMoved = false;
        // 顶部状态栏（生命/魔法/等级，200ms 节流刷新）
        this._statusBarTimer = (this._statusBarTimer || 0) + _dt;
        if (this._statusBarTimer >= 200) {
            this._statusBarTimer = 0;
            this._updateMapStatusBar();
        }
    },

    updateCombat(dt) {
        if (!this.active || (this.state !== "combat" && this.state !== "boss")) return;
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

    /** 未开宝箱离场确认框：是=直接离开并正常清场进路线图；否=关闭并退回场内 */
    _showChestLeaveConfirm() {
        this._chestLeaveConfirm = true;
        const overlay = document.createElement('div');
        overlay.id = 'chestLeaveConfirm';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:10005;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = `
            <div style="background:linear-gradient(135deg,rgba(45,40,35,0.98),rgba(35,30,25,0.99));border:2px solid #a08a5a;border-radius:12px;padding:32px 44px;text-align:center;">
                <div style="font-size:20px;color:#e8d5a8;font-weight:700;margin-bottom:24px;">场地内还有未获取的宝箱奖励，是否离开？</div>
                <div style="display:flex;gap:20px;justify-content:center;">
                    <button id="chestLeaveYes" style="padding:10px 36px;font-size:17px;font-weight:700;cursor:pointer;background:linear-gradient(to bottom,#7a3a3a,#5a2a2a);color:#f0c8c8;border:1px solid #aa5a5a;border-radius:8px;">是</button>
                    <button id="chestLeaveNo" style="padding:10px 36px;font-size:17px;font-weight:700;cursor:pointer;background:linear-gradient(to bottom,#3a6a3a,#2a5a2a);color:#c8f0c8;border:1px solid #5aaa5a;border-radius:8px;">否</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const close = () => {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            this._chestLeaveConfirm = false;
        };
        getElement('chestLeaveYes').onclick = () => {
            close();
            this._leaveCombatViaPortal();
        };
        getElement('chestLeaveNo').onclick = () => {
            close();
            // 退回场内：从门区向场地中心方向退回一段，并给 1s 冷却防连发
            const b = CombatRoomSystem._roomBounds;
            if (b && this.player) {
                const dx = b.cx - this.player.x, dy = b.cy - this.player.y;
                const len = Math.hypot(dx, dy) || 1;
                this.player.x += dx / len * 160;
                this.player.y += dy / len * 160;
            }
            this._chestLeaveCd = 1;
        };
    },

    _updateHover() {
        const mx = Input.mouse.x;
        const my = Input.mouse.y;
        this.hoveredNodeId = null;

        const available = this.getAvailableNodes();
        for (const node of available) {
            const screenPos = this._mapToScreen(node.x, node.y);
            const dist = Math.sqrt((mx - screenPos.x) ** 2 + (my - screenPos.y) ** 2);
            // 检测距离 = 节点屏幕半径 + 10px 缓冲
            if (dist < this.NODE_RADIUS * this.mapScale + 10) {
                this.hoveredNodeId = node.id;
                break;
            }
        }
        document.body.style.cursor = this.hoveredNodeId ? "pointer" : "default";
        // 节点经验/奖励预览（方案D：悬停即见收益，绕开战斗=明确损失）
        this._updateNodeTooltip(mx, my);
    },

    /** 悬停节点预览：战斗/Boss 显示预估经验，事件显示类型（连战进度附带显示） */
    _updateNodeTooltip(mx, my) {
        let el = getElement('dungeonNodeTooltip');
        const node = this.hoveredNodeId ? this.nodes.find(n => n.id === this.hoveredNodeId) : null;
        if (!node || node.type === 'empty' || node.type === 'start') {
            if (el) el.style.display = 'none';
            return;
        }
        if (!el) {
            el = document.createElement('div');
            el.id = 'dungeonNodeTooltip';
            el.style.cssText = `position:fixed;z-index:9005;pointer-events:none;user-select:none;
                background:rgba(35,30,25,0.95);border:1px solid #a08a5a;border-radius:6px;
                padding:6px 12px;font-family:SimHei,"Microsoft YaHei",sans-serif;font-size:15px;
                color:#d4c5a9;white-space:nowrap;`;
            document.body.appendChild(el);
        }
        const streak = DungeonRunStats.combatStreak;
        const mul = getStreakMultiplier(streak + 1); // 下一战的倍率预览
        let text = '';
        if (node.type === 'combat') {
            const est = Math.round(getRoomExpEstimate(this.dungeonType, !!node.isElite) * mul);
            text = `${node.isElite ? '★ 精英战斗' : '⚔ 战斗'} ≈ +${est} EXP`;
            if (streak >= 2) text += `（连战 x${streak + 1} ×${mul.toFixed(2)}）`;
        } else if (node.type === 'boss') {
            const bossEst = Math.round((getDungeonExpBase(this.dungeonType) * 10 + getRoomClearBonus(this.dungeonType)) * mul);
            text = `☠ Boss ≈ +${bossEst} EXP`;
            if (streak >= 2) text += `（连战 x${streak + 1} ×${mul.toFixed(2)}）`;
        } else if (node.type === 'event') {
            text = node.eventType === 'treasureChest' ? '◆ 宝箱：金币/材料' : '? 随机事件';
            if (streak >= 3) text += '（选择将中断连战）';
        } else if (node.type === 'reward') {
            text = '✦ 奖励节点';
        }
        if (!text) { el.style.display = 'none'; return; }
        el.textContent = text;
        el.style.display = 'block';
        // 跟随鼠标（右上方偏移，防出屏）
        const w = el.offsetWidth || 200;
        el.style.left = `${Math.min(mx + 18, (typeof window !== 'undefined' ? window.innerWidth : 1920) - w - 12)}px`;
        el.style.top = `${Math.max(my - 36, 8)}px`;
    },

    _removeNodeTooltip() {
        const el = getElement('dungeonNodeTooltip');
        if (el) el.remove();
    },

    _handleClick() {
        // 地图固定显示，鼠标点击始终有效（不再区分拖动和点击）
        const mx = Input.mouse.x, my = Input.mouse.y;
        // 检测退出按钮点击（与绘制共用 _getExitButtonRect，随视口右对齐）
        const btn = this._getExitButtonRect();
        if (mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h) {
            this._showExitConfirm();
            return;
        }

        if (!this.hoveredNodeId) return;
        const node = this.nodes.find(n => n.id === this.hoveredNodeId);
        if (!node || !this.isNodeClickable(node)) return;
        this._enterNode(node);
    },

    _enterNode(node) {
        // 进入节点前隐藏地图按钮
        this._removeMouseShopButton();
        this._removeAbandonButton();
        this._removeNodeTooltip();

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
    _focusOnCurrentNode() {
        const node = this.getCurrentNode();
        if (!node) { this._centerRouteMap(); return; }
        const area = this._getMapTargetArea();
        this.mapOffsetX = area.left + area.width / 2 - node.x * this.mapScale;
        this.mapOffsetY = area.top + area.height / 2 - node.y * this.mapScale;
        this._clampMapOffset();
    },

    _returnToMap() {
        // 已关闭（shutdown 后的泄漏定时器/异步回调）时直接忽略，避免在主神空间重建地牢 UI
        if (!this.active) return;
        this.state = "map";
        // 月影增伤标记随战斗结束清除
        if (this.player) this.player._moonshadowBoostActive = false;
        Camera.follow = () => {};
        Camera.x = this.CENTER_X;
        Camera.y = this.CENTER_Y;

        // 清理事件/战斗残留的浮动文字
        if (EffectManager && EffectManager.clearFloatingTexts) {
            EffectManager.clearFloatingTexts();
        }

        this._focusOnCurrentNode();

        // 显示地图界面按钮
        this._createMouseShopButton();
        this._createAbandonButton();
        this._updateSafeEvacButton();

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

        // 统一标记当前节点已完成
        this._markCurrentNodeCompleted();

        // 普通战斗奖励金币
        const currentNode = this.getCurrentNode();
        const isBoss = currentNode && currentNode.type === 'boss';
        if (!isBoss) {
            const gold = CombatRoomSystem.getGoldReward(false);
            if (gold > 0 && GoldManager) {
                GoldManager.addGold(gold);
                EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, `获得 ${gold} 金币`, '#ffd700'));
            }
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
        // D 级及以上地牢：三房间串联竞技场（入侵混合战同走竞技场，特工留到房间 3 随第 3 波刷新）
        if (DungeonConfig.isCombatArenaEnabled(this.dungeonType)) {
            return this._enterCombatArena(node);
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
    _maybeSpawnTombstone() {
        // 仅僵尸地牢三级（zombieBeginner / zombieMid / zombie）的普通战斗，沼泽等其他地牢不触发
        if (!['zombieBeginner', 'zombieMid', 'zombie'].includes(this.dungeonType)) return;
        // 精英/Boss 节点不刷（与普通战斗区分；_enterBossCombat 的 boss 节点同样排除）
        const node = this._zombieCombatNode;
        if (!node || node.isElite || node.type === 'boss') return;
        if (Math.random() >= 0.25) return;
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
            if (stage === 3) {
                const g = arena.passages[1] && arena.passages[1].gates[0];
                if (g && g.center) reachFrom = { x: g.center.x, y: g.center.y };
            }
        }
        return { player: this.player, exclusions, avoidPoints, lineFrom, reachFrom };
    },

    /**
     * 三房间串联竞技场（D 级及以上战斗事件）：
     * - 房间 1/2 = 普通战斗房大小，房间 3 = 精英战斗房大小（含宝箱房，普通/精英都生成）；
     * - 房间 N 刷第 N 波；进入房间才关门刷怪，清完开门；房间 3 清完开出口门墙。
     * 墙预制库未就绪（BootScene 预载是 fire-and-forget，资源慢时可能还没拉完）时
     * 不再静默回退——等加载完成后重试；仍构建失败（通道预制缺失等）才回退原单房间流程。
     */
    _enterCombatArena(node) {
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
                this._enterCombatArena(node);
            });
            return;
        }
        this._zombieCombatNode = node;
        this._zombieWaveActive = true;
        this._zombieCombat = new ZombieDungeonCombat(undefined, !!node.isElite, node.encounterOverride || null, this.dungeonType, node.forceMonsters || null);
        // 竞技场强制 3 波编排（一房一波）：遭遇覆盖 combatWaves<3（如诅咒铠甲事件 1 波）补足到 3 波
        // 防软锁；强制怪（forceMonsters，如铠甲骑士）改到最后一波压轴出场
        this._zombieCombat.forceArenaWaves(3);
        // 月影庇护：进入战斗触发无敌；精英战同时激活增伤
        this._triggerMoonshadow(!!node.isElite);

        const crCfg = DungeonConfig.getCombatRoomConfig(this.dungeonType);
        const arenaInfo = CombatRoomSystem.enterCombatArena(this.player, {
            normalSize: crCfg.normalSize,
            eliteSize: crCfg.eliteSize,
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

        // 宝箱房：第三房间中央（普通/精英都生成；倒计时等玩家进入房间 3 才启动）
        if (typeof ChestRoomSystem !== 'undefined') {
            ChestRoomSystem.setup(this.dungeonType, CombatRoomSystem.getArenaRoomBounds(3), { deferCountdown: true, isElite: !!node.isElite });
        }

        // 陷阱：房间生成时逐房摆放（不再等玩家进房关门）；可达性锚点用本房内部参考点
        // （创建时玩家在入场地块、他房门未开，锚玩家会跨房寻路全灭——见 _trapExtras）
        if (typeof TrapSystem !== 'undefined') {
            const zcfg = DungeonConfig.getZombieDungeonConfig(this.dungeonType) || {};
            if (zcfg.traps && zcfg.traps.count > 0) {
                for (let roomIdx = 1; roomIdx <= 3; roomIdx++) {
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

    /** 关门后执行：刷对应波次 + （房间 3）启动宝箱倒计时（陷阱已在竞技场创建时逐房预生成） */
    _onArenaRoomSealed(roomIdx) {
        const arena = CombatRoomSystem._arena;
        if (!arena) return;
        if (roomIdx === 3 && typeof ChestRoomSystem !== 'undefined' && ChestRoomSystem.active) {
            ChestRoomSystem.startCountdown();
        }
        // waveSpawned 必须先置位再刷波：刷波流程内（墓碑/陷阱）若抛异常，
        // 未置位会导致清场判定被 waveSpawned 守卫永久挡死（"清完怪物门不开"的根因）
        arena.waveSpawned = true;
        try {
            this._spawnZombieWave();
        } catch (e) {
            console.error('[DungeonMapSystem] 刷波异常（已兜底，不阻塞清场判定）:', e);
        }
        // 入侵混合战：特工在房间 3 随第 3 波同刷（setArenaStageRoom 已把 _roomBounds 切到房间 3，
        // 自由边布点天然落在本房；登记进 _combatMonsterKeys 计入清场判定）
        if (roomIdx === 3 && this._invasionMixed) {
            this._spawnInvasionAgentsOnFreeEdge(AgentInvasionSystem.getAgentFactories());
        }
    },

    _spawnZombieWave() {
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
        const monsterClasses = classes.map(c => c.MonsterClass);
        CombatRoomSystem.spawnMonsters(monsterClasses.length, false, monsterClasses);

        // 同步到地图系统的追踪数组，方便统一检测战斗完成
        this._combatMonsters = CombatRoomSystem._combatMonsters;
        this._combatMonsterKeys = CombatRoomSystem._combatMonsterKeys;

        EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, `第 ${wave + 1} / ${total} 波敌人来袭！`, "#ff4444"));

        // 墓碑：普通战斗每次房间刷怪 25% 概率额外刷新（必须在 spawnMonsters 重置 keys 之后调用；
        // 内部有地牢类型/精英/Boss 守卫；F/E 跨波保留，D+ 换房间随清理删除）
        // 包 try/catch：墓碑生成异常不得阻塞波次流程（见 _onArenaRoomSealed 的置位顺序说明）
        try {
            this._maybeSpawnTombstone();
        } catch (e) {
            console.error('[DungeonMapSystem] 墓碑生成异常（已兜底）:', e);
        }
    },

    _enterBoss(node) {
        // Boss 战为独立遭遇配置（bossEncounter）的地牢：走普通战斗流程（初级精英副本、中级领主池等）
        if (DungeonConfig.getBossEncounterConfig(this.dungeonType)) {
            this._enterBossCombat(node);
            return;
        }
        this.state = "boss";
        // 进入 Boss 战前清理残留的战斗场景
        this._cleanupCombatScene();
        this._exitPortalSpawned = false;
        // 月影庇护：Boss 战触发无敌并激活增伤
        this._triggerMoonshadow(true);
        // 所有 Boss 战统一使用 BossRewardSystem 的集合体 Boss（dungeonType 用于地牢级 bossSize 覆盖）
        BossRewardSystem.enterBossBattle(this.player, () => {
            // Boss 击败且玩家通过传送门离开后，标记节点完成
            if (node) {
                node.completed = true;
                node.type = 'empty';
            }
        }, this.dungeonType);
        EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, "Boss 战！", "#ff0000"));
    },

    /**
     * 初级地牢 Boss 战：独立 bossEncounter 配置（参考精英战斗：1 波 × 精英1+普通5）
     * 与普通战斗共用波次/完成检测/出口传送门流程；完成后经奖励节点触发胜利
     */
    _enterBossCombat(node) {
        this.state = "combat";
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
            // 进了竞技场（_arena 存在）则不立即刷，留到房间 3；否则保持旧行为立即刷
            if (!CombatRoomSystem._arena) {
                this._spawnInvasionAgentsOnFreeEdge(AgentInvasionSystem.getAgentFactories());
            }
        } else {
            // 情况1/3：仅特工的强制战（胜利后经 _leaveCombatViaPortal 继续原事件）
            this._invasionMixed = false;
            this._zombieWaveActive = false; // 无波次
            CombatRoomSystem.enterCombatRoom(this.player, false, { roomSize: arenaSize, dungeonType: this.dungeonType });
            const factories = AgentInvasionSystem.getAgentFactories();
            CombatRoomSystem.spawnMonsters(factories.length, false, factories);
            for (const m of CombatRoomSystem._combatMonsters) AgentInvasionSystem.markAsInvasion(m);
            this._combatMonsters = CombatRoomSystem._combatMonsters;
        }
        EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, '⚠ 时空特工入侵！', '#ff4444'));
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
                    if (arena.stage < 3) {
                        // 当前房间 < 3 → 开门等玩家进下一房间
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
                    // stage === 3：等本房间波次由关门流程驱动，战斗完成与否看 isComplete
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
        this._waveTransitioning = false;
        this._exitPortalSpawned = false;
        this._arenaRoomCleared = false;
        this._arenaDoorPending = null;

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
        // 使用 BossRewardSystem 的奖励节点管理器
        BossRewardSystem.enterRewardNode(this.player, () => {
            // 奖励领取完毕后标记节点完成并触发胜利
            if (node) {
                node.completed = true;
                node.type = 'empty';
            }
            this._showVictory();
            this._returnToMap();
        });
    },

    _enterZombieShop(_node) {
        // 保持 state='map'，避免游戏画面从地牢路线图切到真实世界造成“传送”感
        this._removeMouseShopButton();
        this._removeAbandonButton();
        ZombieDungeonShop.open();
        this._shopCheckInterval = TimerManager.setInterval(() => {
            if (ZombieDungeonShop.isClosed()) {
                TimerManager.clearInterval(this._shopCheckInterval);
                this._shopCheckInterval = null;
                this._returnToMap();
            }
        }, 300);
    },

    _enterEvent(node) {
        this.state = "event";
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
                    if (result.encounter) node.encounterOverride = result.encounter;
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
    render(ctx) {
        if (!this.active || this.state !== "map") return;

        // 用实际 canvas 尺寸（视口），不用固定 1920×1080——修复 2K 屏下背景/地图挤左上角
        const viewW = (ctx.canvas && ctx.canvas.width) || this.DEFAULT_VIEWPORT_WIDTH;
        const viewH = (ctx.canvas && ctx.canvas.height) || this.DEFAULT_VIEWPORT_HEIGHT;
        const availableNodes = this.getAvailableNodes();
        const availableIds = new Set(availableNodes.map(n => n.id));

        // 界面分两块：上方背景图（纯美观），下方地图选择区域（area）
        const area = this._getMapTargetArea(viewW, viewH);
        const view = this._getMapViewRect(viewW, viewH); // 路线图显示窗口（内容限定在此）

        // ── 上方：背景图，裁剪在上区内 ──
        this._renderBackground(ctx, viewW, viewH, area.top);

        // ── 下方：地图选择区域底块（默认不透明深色；背景图就绪后拉伸铺满）──
        ctx.fillStyle = "#08080a";
        ctx.fillRect(area.left, area.top, area.width, area.height);
        this._drawMapAreaBackground(ctx, area);

        // D: 背景协调——半透明暗色覆盖层（上下略深）+ 左右暗角，提升节点对比、统一色调
        const ov = ctx.createLinearGradient(0, area.top, 0, area.top + area.height);
        ov.addColorStop(0, 'rgba(8, 8, 12, 0.52)');
        ov.addColorStop(0.5, 'rgba(8, 8, 12, 0.34)');
        ov.addColorStop(1, 'rgba(8, 8, 12, 0.52)');
        ctx.fillStyle = ov;
        ctx.fillRect(area.left, area.top, area.width, area.height);
        const sideW = Math.round(area.width * 0.16);
        const gL = ctx.createLinearGradient(area.left, 0, area.left + sideW, 0);
        gL.addColorStop(0, 'rgba(0,0,0,0.40)');
        gL.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gL;
        ctx.fillRect(area.left, area.top, sideW, area.height);
        const gR = ctx.createLinearGradient(area.left + area.width, 0, area.left + area.width - sideW, 0);
        gR.addColorStop(0, 'rgba(0,0,0,0.40)');
        gR.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gR;
        ctx.fillRect(area.left + area.width - sideW, area.top, sideW, area.height);

        // ── 地图内容：裁剪在路线图窗口内，无论怎么拖/缩放都不溢出 ──
        ctx.save();
        ctx.beginPath();
        ctx.rect(view.left, view.top, view.width, view.height);
        ctx.clip();

        // 应用地图变换
        ctx.translate(this.mapOffsetX, this.mapOffsetY);
        ctx.scale(this.mapScale, this.mapScale);

        // ── 绘制边（连线）─
        const t = this._mapAnimT || 0;
        for (const edge of this.edges) {
            const fromNode = this.nodes.find(n => n.id === edge.from);
            const toNode = this.nodes.find(n => n.id === edge.to);
            if (!fromNode || !toNode) continue;

            const isVisited = this.visitedNodeIds.has(fromNode.id) && this.visitedNodeIds.has(toNode.id);
            const isAvailable = this.currentNodeId === fromNode.id && availableIds.has(toNode.id);

            if (isVisited) {
                // 已走路径：暗色粗底 + 绿色细线（路径感双层）
                ctx.strokeStyle = 'rgba(38, 54, 38, 0.7)';
                ctx.lineWidth = 5;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(fromNode.x, fromNode.y);
                ctx.lineTo(toNode.x, toNode.y);
                ctx.stroke();
                ctx.strokeStyle = 'rgba(90, 138, 90, 0.75)';
                ctx.lineWidth = 2.2;
                ctx.beginPath();
                ctx.moveTo(fromNode.x, fromNode.y);
                ctx.lineTo(toNode.x, toNode.y);
                ctx.stroke();
            } else if (isAvailable) {
                // 可点击路径：金色光晕底 + 流动虚线（指向下一步）
                ctx.shadowColor = 'rgba(230, 190, 90, 0.65)';
                ctx.shadowBlur = 10 / this.mapScale; // 屏幕恒定光晕强度（缩放时补偿）
                ctx.strokeStyle = 'rgba(180, 150, 70, 0.20)';
                ctx.lineWidth = 5;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(fromNode.x, fromNode.y);
                ctx.lineTo(toNode.x, toNode.y);
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.strokeStyle = 'rgba(236, 200, 115, 0.95)';
                ctx.lineWidth = 2.4;
                ctx.setLineDash([12 / this.mapScale, 8 / this.mapScale]);
                ctx.lineDashOffset = -(t * 0.04) / this.mapScale;
                ctx.beginPath();
                ctx.moveTo(fromNode.x, fromNode.y);
                ctx.lineTo(toNode.x, toNode.y);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.lineDashOffset = 0;
            } else {
                // 未开放/迷雾路径：暗色细虚线（保持可见但不抢眼）
                ctx.strokeStyle = 'rgba(42, 42, 42, 0.45)';
                ctx.lineWidth = 1.6;
                ctx.setLineDash([6 / this.mapScale, 6 / this.mapScale]);
                ctx.beginPath();
                ctx.moveTo(fromNode.x, fromNode.y);
                ctx.lineTo(toNode.x, toNode.y);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        // ── 绘制节点 ──
        const labelMeta = [];
        for (const node of this.nodes) {
            const isVisited = this.visitedNodeIds.has(node.id);
            const isCurrent = node.id === this.currentNodeId;
            const isAvailable = availableIds.has(node.id);
            const isHovered = node.id === this.hoveredNodeId;

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
            let glow = false;

            if (isCurrent) {
                color = this.TYPE_COLORS[node.type] || "#3a5a3a";
                borderColor = "#ffffff";
                radius += 4;
                glow = true;
            } else if (isVisited) {
                color = this.TYPE_COLORS[node.type] || "#3a3a3a";
                borderColor = "#5a5a5a";
                ctx.globalAlpha = 0.5;
            } else if (isAvailable) {
                // 相邻可点击节点：显示实际类型
                color = this.TYPE_COLORS[node.type] || "#3a3a3a";
                borderColor = this.TYPE_BORDER_COLORS[node.type] || "#aaaaaa";
                glow = true;
            } else if (isRevealed) {
                // 已揭示但未访问：显示实际类型但暗淡
                color = this.TYPE_COLORS[node.type] || "#3a3a3a";
                borderColor = "#444444";
                ctx.globalAlpha = 0.4;
            } else {
                // 未揭示：迷雾状态
                color = "#1a1a1a";
                borderColor = "#111111";
                ctx.globalAlpha = 0.3;
            }

            if (isHovered && isAvailable) {
                radius += 5;
                borderColor = "#ffffff";
            }

            // E: 呼吸发光（可点击/当前节点，随动画时钟脉动）
            const breathe = 0.55 + 0.45 * Math.sin(t * 0.004);

            // 节点贴图（start/combat/event/empty；迷雾 unknown 与 boss/reward 走纯色圆）
            const texKey = this.NODE_TEX[displayType] || null;
            const texImg = texKey ? this._getNodeTexImage(texKey) : null;
            const hasTex = !!(texKey && texImg && texImg.complete && texImg.naturalWidth > 0 && displayType !== 'unknown');
            let tw = 0, th = 0;
            if (hasTex) {
                radius = this.NODE_TEX_SIZE / 2; // 特效（环/★/你）按贴图尺寸定位
                // 只画内容包围盒（源矩形），避免整画布透明边距把图标缩得极小
                const crop = this.NODE_TEX_CROP[texKey] || [0, 0, texImg.naturalWidth, texImg.naturalHeight];
                const texScale = this.NODE_TEX_SIZE / Math.max(crop[2], crop[3]);
                tw = crop[2] * texScale;
                th = crop[3] * texScale;
            }
            if (isHovered && isAvailable) {
                radius += 5;
                borderColor = "#ffffff";
            }

            if (hasTex) {
                // 贴图节点：直接绘制贴图（状态透明度沿用上方 globalAlpha）。
                // 不加阴影光晕——阴影会沿贴图轮廓扩散成一大圈金色光晕（低缩放时数倍于贴图），
                // 金色呼吸环已足够提示可点击/当前位置
                ctx.shadowBlur = 0;
                const crop = this.NODE_TEX_CROP[texKey] || [0, 0, texImg.naturalWidth, texImg.naturalHeight];
                ctx.drawImage(texImg, crop[0], crop[1], crop[2], crop[3],
                    node.x - tw / 2, node.y - th / 2, tw, th);
                ctx.shadowBlur = 0;
            } else {
                // 纯色圆（boss/reward/迷雾 unknown）
                if (isAvailable && glow) {
                    ctx.shadowColor = this.TYPE_BORDER_COLORS[node.type] || '#aaaaaa';
                    ctx.shadowBlur = (10 + 8 * breathe) / this.mapScale;
                } else if (isCurrent) {
                    ctx.shadowColor = '#ffffff';
                    ctx.shadowBlur = 12 / this.mapScale;
                } else {
                    ctx.shadowBlur = 0;
                }
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = borderColor;
                ctx.lineWidth = isHovered ? 3 : 2;
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
                ctx.stroke();
                ctx.shadowBlur = 0;
            }
            ctx.globalAlpha = 1.0;

            // E: 可点击节点——金色呼吸外环（提示可前进）
            if (isAvailable) {
                ctx.strokeStyle = `rgba(230, 195, 110, ${0.30 + 0.30 * breathe})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius + 2, 0, Math.PI * 2); // 贴紧贴图边缘
                ctx.stroke();
            }
            // E: 当前节点——白色脉冲双环
            if (isCurrent) {
                const pulse = 0.5 + 0.5 * Math.sin(t * 0.005);
                ctx.strokeStyle = `rgba(255, 255, 255, ${0.45 + 0.35 * pulse})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius + 3 + 3 * pulse, 0, Math.PI * 2);
                ctx.stroke();
            }
            // E: 精英节点——双层紫圈（遵循迷雾规则，未揭示时不显示）
            if (node.isElite && isRevealed) {
                ctx.strokeStyle = "rgba(138, 58, 154, 0.45)";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
                ctx.stroke();
                ctx.strokeStyle = "#8a3a9a";
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius + 2, 0, Math.PI * 2);
                ctx.stroke();
            }
            // 贴图节点 hover：白色定位圈
            if (hasTex && isHovered && isAvailable) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius + 3, 0, Math.PI * 2);
                ctx.stroke();
            }

            // 收集屏幕空间标签元数据（C：图标/★/你 反缩放绘制）
            labelMeta.push({
                displayType, isRevealed, isAvailable, isCurrent,
                sx: node.x * this.mapScale + this.mapOffsetX,
                sy: node.y * this.mapScale + this.mapOffsetY,
                radius,
                elite: node.isElite,
                hasTex,
            });
        }

        // ── 时空特工入侵者节点标记（不受迷雾限制；数据每回合更新、每帧重绘即随回合移动）──
        if (AgentInvasionSystem.triggered && AgentInvasionSystem.agentNodeId) {
            const agentNode = this.nodes.find(n => n.id === AgentInvasionSystem.agentNodeId);
            if (agentNode) {
                const mk = AgentInvasionSystem.getNodeMarkerStyle();
                // 与玩家同节点（已追上待拦截）：右移标记，避免完全遮挡"你"所在节点
                const mx = agentNode.x + (agentNode.id === this.currentNodeId ? this.NODE_RADIUS + mk.radius + 6 : 0);
                const my = agentNode.y;
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
        for (const m of labelMeta) {
            const screenR = Math.max(12, m.radius * this.mapScale);
            const iconSize = Math.max(12, Math.min(18, Math.round(screenR * 0.60)));
            // 贴图节点自带图案，不再叠加图标；迷雾/boss/reward 仍画图标
            if (!m.hasTex) {
                const icon = m.isRevealed ? (this.TYPE_ICONS[m.displayType] || '•') : '?';
                ctx.font = `${iconSize}px "Microsoft YaHei", sans-serif`;
                ctx.fillStyle = (m.isAvailable || m.isCurrent || m.isRevealed) ? '#ffffff' : '#8a8a8a';
                ctx.fillText(icon, m.sx, m.sy + 1);
            }
            if (m.elite && m.isRevealed) {
                ctx.font = `bold ${iconSize - 1}px "Microsoft YaHei", sans-serif`;
                ctx.fillStyle = '#d08ae0';
                ctx.fillText('★', m.sx, m.sy - screenR - 6);
            }
            if (m.isCurrent) {
                ctx.font = 'bold 13px sans-serif';
                ctx.fillStyle = '#ffffff';
                ctx.fillText('你', m.sx, m.sy + screenR + 8);
            }
        }

        // 窗口边界纯透明淡出（不用黑色遮罩）：
        // 抓取视图（内容+背景）到离屏 → 重铺背景 → 离屏边缘 alpha 淡出 → 贴回
        const ovc = this._getMapViewCanvas(view.width, view.height);
        const oc = ovc.getContext('2d');
        oc.clearRect(0, 0, ovc.width, ovc.height);
        oc.drawImage(ctx.canvas, view.left, view.top, view.width, view.height, 0, 0, ovc.width, ovc.height);
        // 重铺背景（当前 clip=view，整区绘制自动裁剪到窗口内，与原背景逐像素一致）
        ctx.fillStyle = "#08080a";
        ctx.fillRect(area.left, area.top, area.width, area.height);
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

        // ── 绘制 UI 覆盖层（不受地图变换影响，固定在地图区域内）─
        // 标题与提示已改为 DOM 覆盖层（#dungeonMapTitle），底部居中

        // 进度：跟随地图区域（不再用 viewW/viewH，避免 2K 下跑出区域）
        const progress = `${this.visitedNodeIds.size} / ${this.nodes.length}`;
        ctx.fillStyle = "#666666";
        ctx.font = "13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(`进度: ${progress} 节点`, area.left + area.width / 2, area.top + area.height - 10);

        // 缩放指示：区域右下角
        ctx.fillStyle = "#444444";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(`${Math.round(this.mapScale * 100)}%`, area.left + area.width - 12, area.top + area.height - 10);
        ctx.textAlign = "center";

        // 退出按钮（绘制位置与点击热区共用 _getExitButtonRect，随视口右对齐）
        const btn = this._getExitButtonRect(viewW);
        ctx.fillStyle = "#3a5a3a";
        ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
        ctx.strokeStyle = "#6a8a5a";
        ctx.lineWidth = 1;
        ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);
        ctx.fillStyle = "#d4c5a9";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("退出地牢", btn.x + btn.w / 2, btn.y + btn.h / 2);
        ctx.textBaseline = "alphabetic";
    },

    _createMouseShopButton() {
        if (getElement('mouseShopButton')) return;
        // 挂 document.body：bottom-bar 在地图模式被 body.map-mode 隐藏，不能作为父容器
        // 位置：背景图左侧黑幕内、上区垂直居中（40% 上区中心 = 20vh）；
        // 水平居中由 _positionMapButtons 按黑幕实际宽度校正；贴图 = 素材库按钮板（文字已烘焙）
        // 背景直接用原图 1536²：371%×1038% 把按钮板整块显示并填满 164×66 按钮框
        // （板宽 414→164、板高 148→66，仅垂直拉伸 12.6% 不裁剪），避免板与辉光之间
        // 露出透明缝隙形成黑边；position 按板心对齐（板心 784,762）
        const btn = document.createElement('div');
        btn.id = 'mouseShopButton';
        btn.style.cssText = `
            position: fixed;
            left: 20px;
            top: calc(20vh - 33px);
            width: 164px;
            height: 66px;
            background-image: url('assets/ui/dungeon-map/btn_mouse_shop.png');
            background-size: 371% 1038%;
            background-repeat: no-repeat;
            background-position: 51% 50%;
            animation: dungeonBtnGlow 2s ease infinite; /* 辉光按贴图 alpha 形状附着（drop-shadow） */
            border: none;
            cursor: pointer;
            z-index: 9000;
            pointer-events: auto;
            user-select: none;
        `;
        btn.addEventListener('click', () => {
            if (this.active && this.state === 'map') {
                this._enterZombieShop();
            }
        });
        document.body.appendChild(btn);
    },

    _removeMouseShopButton() {
        const btn = getElement('mouseShopButton');
        if (btn) btn.remove();
    },

    _createAbandonButton() {
        if (getElement('abandonButton')) return;
        // 挂 document.body：bottom-bar 在地图模式被 body.map-mode 隐藏，不能作为父容器
        // 位置：背景图右侧黑幕内、安全撤离按钮下方（右列从上到下：安全撤离 → 放弃并返回）
        // 背景直接用原图 1536²：371%×1038% 整板显示并填满按钮框（板心 762,774）
        const btn = document.createElement('div');
        btn.id = 'abandonButton';
        btn.style.cssText = `
            position: fixed;
            right: 20px;
            top: calc(20vh + 8px);
            width: 164px;
            height: 66px;
            background-image: url('assets/ui/dungeon-map/btn_abandon.png');
            background-size: 371% 1038%;
            background-repeat: no-repeat;
            background-position: 50% 50%;
            animation: dungeonBtnGlow 2s ease infinite; /* 辉光按贴图 alpha 形状附着（drop-shadow） */
            border: none;
            cursor: pointer;
            z-index: 9000;
            pointer-events: auto;
            user-select: none;
        `;
        btn.addEventListener('click', () => {
            if (this.active && this.state === 'map') {
                this._showExitConfirm();
            }
        });
        document.body.appendChild(btn);
        // 安全撤离按钮跟随放弃按钮一起刷新（仅在起始点时显示）
        this._updateSafeEvacButton();
    },

    _removeAbandonButton() {
        const btn = getElement('abandonButton');
        if (btn) btn.remove();
        this._removeSafeEvacButton();
    },

    /** 安全撤离按钮：仅在当前位于起始点时显示（右列顶部，放弃按钮上方，绿色），撤离不丢背包物品 */
    _updateSafeEvacButton() {
        const current = this.getCurrentNode();
        const atStart = !!(current && current.type === 'start');
        const existing = getElement('safeEvacButton');
        if (!atStart) {
            if (existing) existing.remove();
            return;
        }
        if (existing) return;
        const btn = document.createElement('div');
        btn.id = 'safeEvacButton';
        btn.style.cssText = `
            position: fixed;
            right: 20px;
            top: calc(20vh - 74px);
            width: 164px;
            height: 66px;
            background-image: url('assets/ui/dungeon-map/btn_safe_evac.png');
            background-size: 371% 1038%;
            background-repeat: no-repeat;
            background-position: 50% 50%;
            animation: dungeonBtnGlow 2s ease infinite; /* 辉光按贴图 alpha 形状附着（drop-shadow） */
            border: none;
            cursor: pointer;
            z-index: 9000;
            pointer-events: auto;
            user-select: none;
        `;
        btn.addEventListener('click', () => {
            if (this.active && this.state === 'map') {
                this._safeEvacuate();
            }
        });
        document.body.appendChild(btn);
    },

    /**
     * 三个操作按钮水平居中到各自黑幕（背景图 contain 等比例缩小后左右留黑区）：
     * 黑幕宽 = (视口宽 − 图片显示宽) / 2，按钮中心对齐黑幕中心；
     * 黑幕窄于按钮时兜底贴边（≥8px）。图片未就绪时跳过，render 每帧就绪后自动校正（幂等）。
     * @param {number} viewW 视口宽（画布像素）
     * @param {number} imgDispW 背景图 contain 后的显示宽度
     */
    _positionMapButtons(viewW, imgDispW) {
        if (!imgDispW || imgDispW >= viewW) return;
        const barW = (viewW - imgDispW) / 2;
        const BTN_W = 164;
        const offset = Math.max(8, Math.round(barW / 2 - BTN_W / 2));
        const shop = getElement('mouseShopButton');
        const evac = getElement('safeEvacButton');
        const abandon = getElement('abandonButton');
        if (shop) shop.style.left = offset + 'px';
        if (evac) evac.style.right = offset + 'px';
        if (abandon) abandon.style.right = offset + 'px';
    },

    _removeSafeEvacButton() {
        const btn = getElement('safeEvacButton');
        if (btn) btn.remove();
    },

    _createDungeonNameLabel() {
        if (getElement('dungeonMapNameLabel')) return;
        const el = document.createElement('div');
        el.id = 'dungeonMapNameLabel';
        el.style.cssText = `
            position: fixed;
            left: 1031px;
            bottom: 1174px;
            width: 505px;
            height: 64px;
            z-index: 9002;
            pointer-events: none;
            user-select: none;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            font-family: SimHei, "Microsoft YaHei", sans-serif;
            color: #d4c5a9;
            font-size: 18px;
            font-weight: 700;
            text-shadow: 0 2px 4px rgba(0,0,0,0.8);
        `;
        el.textContent = `当前地牢：${this.dungeonName || '未知地牢'}`;
        document.body.appendChild(el);
    },

    _removeDungeonNameLabel() {
        const el = getElement('dungeonMapNameLabel');
        if (el) el.remove();
    },

    /** 地图选路模式顶部状态栏（生命/魔法/等级；进入战斗时地图 UI 隐藏，无需随战斗显隐） */
    _createMapStatusBar() {
        if (getElement('dungeonMapStatusBar')) return;
        const el = document.createElement('div');
        el.id = 'dungeonMapStatusBar';
        el.style.cssText = `
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 9002;
            pointer-events: none;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 18px;
            padding: 8px 20px;
            background: rgba(20, 16, 12, 0.75);
            border: 1px solid #5a4a3a;
            border-radius: 8px;
            font-family: SimHei, "Microsoft YaHei", sans-serif;
            color: #d4c5a9;
            font-size: 15px;
            font-weight: 700;
            text-shadow: 0 1px 2px rgba(0,0,0,0.8);
        `;
        document.body.appendChild(el);
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
        const bar = (pct, color) => `
            <span style="display:inline-block;width:110px;height:12px;background:rgba(0,0,0,0.6);border:1px solid #3a3028;border-radius:3px;overflow:hidden;vertical-align:middle;margin-left:6px;">
                <span style="display:block;width:${pct}%;height:100%;background:${color};"></span>
            </span>`;
        el.innerHTML = `
            <span style="color:#e8c878;">Lv.${d.level ?? 1}</span>
            <span>生命 ${Math.ceil(d.hp)}/${d.maxHp}${bar(hpPct, 'linear-gradient(90deg,#b03030,#d05050)')}</span>
            <span>魔法 ${Math.ceil(d.mp)}/${d.maxMp}${bar(mpPct, 'linear-gradient(90deg,#3060b0,#5090d0)')}</span>
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
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.85); z-index: 10000;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            font-family: SimHei, "Microsoft YaHei", sans-serif; user-select: none;
        `;
        overlay.innerHTML = `
            <h1 style="color: #e8c878; font-size: 52px; margin-bottom: 16px; text-shadow: 0 2px 8px rgba(0,0,0,0.5);">地牢通关！</h1>
            <div style="background: rgba(45,40,35,0.95); border: 2px solid #a08a5a; border-radius: 12px; padding: 24px 44px; margin-bottom: 32px; min-width: 480px;">
                <div style="color:#e8d5a8; font-size: 19px; font-weight: 700; margin-bottom: 14px; text-align: center;">— 通关结算 —</div>
                <div style="color:#d4c5a9; font-size: 16px; line-height: 1.9;">
                    <div>击杀统计：${killLine}</div>
                    <div>经验合计：<b style="color:#ffd700">${stats.exp} EXP</b>${clearBonus > 0 ? ` <span style="color:#7ee787">＋全清奖励 ${clearBonus} EXP</span>` : ''}</div>
                    <div>探索完成度：${clearPct}%（${clearedNodes}/${totalNodes} 节点）</div>
                    ${d ? `<div>当前等级 Lv.${d.level} · 距下一级还需 <b style="color:#ffd700">${expRemain} EXP</b></div>` : ''}
                </div>
            </div>
            <button id="dungeonVictoryBtn" style="padding: 16px 48px; font-size: 18px; background: #4a6a3a; border: 2px solid #6a8a5a; color: #d4c5a9; border-radius: 8px; cursor: pointer; transition: background 0.15s;">返回主神空间</button>
        `;
        document.body.appendChild(overlay);

        const btn = getElement("dungeonVictoryBtn");
        btn.onmouseenter = () => btn.style.background = "#5a7a4a";
        btn.onmouseleave = () => btn.style.background = "#4a6a3a";
        btn.onclick = async () => {
            
            overlay.remove();
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
        if (getElement("dungeonExitConfirm")) return;

        const overlay = document.createElement("div");
        overlay.id = "dungeonExitConfirm";
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.80); z-index: 10001;
            display: flex; align-items: center; justify-content: center;
            font-family: SimHei, "Microsoft YaHei", sans-serif; user-select: none;
        `;
        overlay.innerHTML = `
            <div style="background: #2a2520; border: 2px solid #5a4a3a; border-radius: 10px; padding: 30px; max-width: 400px; width: 90%; color: #d4c5a9; text-align: center;">
                <h3 style="color: #e8c878; margin: 0 0 15px; font-size: 22px;">确认放弃地牢</h3>
                <p style="margin: 0 0 25px; line-height: 1.6;">放弃并返回将<span style="color:#ff6b6b;">丢失背包中所有物品</span>。<br>确定要返回主神空间吗？</p>
                <div style="display: flex; gap: 15px; justify-content: center;">
                    <button id="dungeonExitConfirmBtn" style="padding: 12px 30px; background: #4a6a3a; border: 2px solid #6a8a5a; color: #d4c5a9; border-radius: 5px; cursor: pointer; font-size: 15px;">确认退出</button>
                    <button id="dungeonExitCancelBtn" style="padding: 12px 30px; background: #3a3a3a; border: 2px solid #5a5a5a; color: #888; border-radius: 5px; cursor: pointer; font-size: 15px;">继续探索</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const confirmBtn = getElement("dungeonExitConfirmBtn");
        const cancelBtn = getElement("dungeonExitCancelBtn");

        confirmBtn.onmouseenter = () => confirmBtn.style.background = "#5a7a4a";
        confirmBtn.onmouseleave = () => confirmBtn.style.background = "#4a6a3a";
        cancelBtn.onmouseenter = () => cancelBtn.style.background = "#4a4a4a";
        cancelBtn.onmouseleave = () => cancelBtn.style.background = "#3a3a3a";

        confirmBtn.onclick = async () => {
            overlay.remove();
            // 放弃惩罚：丢失背包中所有物品（安全撤离/通关/胜利不触发）
            this._clearPlayerBackpack();
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
        };

        cancelBtn.onclick = () => {
            overlay.remove();
        };
    },

};

// 将 DungeonMapSystem 挂载到全局，供其他模块（如 GameScene.js、player.js）访问
if (typeof window !== 'undefined' && !window.DungeonMapSystem) {
    window.DungeonMapSystem = DungeonMapSystem;
}
