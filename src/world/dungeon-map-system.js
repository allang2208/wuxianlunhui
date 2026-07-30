
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
import { DungeonConfig } from '../config/dungeon-config.js';
import { loadImage } from '../utils/image-loader.js';
import { coverRect, anchorRect } from '../utils/layout.js';

/** 路线选择界面区域 spec（1920×1080 基准；由 2560×1440 实测 left:4 bottom:10 w:2545 h:542 换算） */
const MAP_AREA_SPEC = { left: 4, bottom: 10, width: 1909, height: 407 };
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
import { DungeonEmpower } from '../config/dungeon-empower.js';
import { DungeonRunStats } from './dungeon-run-stats.js';

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
        // 祭品加持：本次出征强度清零
        DungeonEmpower.reset();
        this.nodes = [];
        this.edges = [];
        this._cleanupEventUI();
        this._removeMouseShopButton();
        this._removeAbandonButton();
        this._removeDungeonNameLabel();
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

        // 滚轮缩放：以鼠标位置为中心（仅当地图区域内，防止在背景图上误缩放）
        const onWheel = (e) => {
            if (this.state !== "map") return;
            if (!this._isInMapArea(e.clientX, e.clientY)) return;
            e.preventDefault();
            const mx = e.clientX, my = e.clientY;
            const old = this.mapScale;
            const factor = e.deltaY < 0 ? 1.1 : 0.9;
            const next = Math.max(this.MIN_MAP_SCALE, Math.min(this.MAX_MAP_SCALE, old * factor));
            if (next === old) return;
            const wx = (mx - this.mapOffsetX) / old;
            const wy = (my - this.mapOffsetY) / old;
            this.mapScale = next;
            this.mapOffsetX = mx - wx * next;
            this.mapOffsetY = my - wy * next;
            this._clampMapOffset();
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
     * 下方为地图选择区域。背景图 cover 铺满上方区域（bottom 锚定到区域分界线），
     * 裁剪到上区，绝不画进下方地图区域。
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
        // cover 铺满上区（0,0,viewW,topH），bottom 锚定使图片底边贴紧分区分界线
        const r = coverRect(img.naturalWidth, img.naturalHeight, viewW, topH, 'bottom');
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, viewW, topH);
        ctx.clip();
        ctx.drawImage(img, Math.round(r.x), Math.round(r.y), r.w, r.h);
        ctx.restore();
    },

    /** 当前地牢的路线选择界面背景图路径（配置驱动，含兜底） */
    _getMapBackgroundPath() {
        const cfg = DungeonConfig.getZombieDungeonConfig(this.dungeonType);
        return (cfg && cfg.mapBackground) || 'assets/scenes/dungeon-map-bg.png';
    },

    /**
     * 钳制地图偏移，使 2048×2048 的地图不会拖出显示区域
     */
    /** 路线选择界面显示区域（layout.js 统一适配；spec 为 1920×1080 基准坐标，
     * 由 2560×1440 实测值 left:4 bottom:10 width:2545 height:542 换算） */
    _getMapTargetArea(viewW, viewH) {
        const vw = viewW || ((typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1920);
        const vh = viewH || ((typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 1080);
        return anchorRect(MAP_AREA_SPEC, vw, vh);
    },

    /** 鼠标/指针是否落在下方地图选择区域内（区域外不可拖动、不可缩放） */
    _isInMapArea(x, y) {
        const area = this._getMapTargetArea();
        return x >= area.left && x <= area.left + area.width &&
               y >= area.top && y <= area.top + area.height;
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
        // 钳制区域与初始定位同源（layout.js anchorRect），禁止两套区域计算
        const area = this._getMapTargetArea();
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
        // 路线选择界面显示区域（坐标工具测量值，与拖动钳制共用 _getMapTargetArea）
        const TARGET_AREA = this._getMapTargetArea();

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
        this._updateHover();
        if (Input.mouse.leftPressed && !this._dragMoved) {
            this._handleClick();
        }
        // 每帧重置拖动标记，避免拖动后的单次点击被误判
        this._dragMoved = false;
    },

    updateCombat(dt) {
        if (!this.active || (this.state !== "combat" && this.state !== "boss")) return;

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

                // 精英节点：通知宝箱房（限时内完成 → 打开宝箱房门墙）
                if (isEliteNode && typeof ChestRoomSystem !== 'undefined' && ChestRoomSystem.active) {
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
        const combatOptions = { roomSize: node.isElite ? _crCfg.eliteSize : _crCfg.normalSize };

        if (this._isZombieFamily()) {
            this._enterZombieCombat(node, combatOptions);
            return;
        }

        // 使用 CombatRoomSystem 生成随机战斗场地
        CombatRoomSystem.enterCombatRoom(this.player, false, combatOptions);
        // 精英战斗：场地中央生成宝箱房（与僵尸路径同规则）
        if (node.isElite && typeof ChestRoomSystem !== 'undefined') {
            ChestRoomSystem.setup(this.dungeonType, CombatRoomSystem._roomBounds);
        }
        // 生成普通怪物
        CombatRoomSystem.spawnMonsters(3, false);
        EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, "进入战斗！消灭所有敌人", "#ff4444"));
    },

    _enterZombieCombat(node, options = {}) {
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
                TrapSystem.spawnForRoom(CombatRoomSystem._roomBounds, zcfg.traps);
            }
        }
        // 精英战斗：场地中央生成宝箱房（门墙常闭 + 等级宝箱 + 60s 倒计时，房内不刷怪）
        if (node.isElite && typeof ChestRoomSystem !== 'undefined') {
            ChestRoomSystem.setup(this.dungeonType, CombatRoomSystem._roomBounds);
        }
        this._spawnZombieWave();
        // 墓碑事件：普通战斗（非精英）33% 概率在距玩家最远角落生成站桩召唤器
        // （必须在 _spawnZombieWave 之后调用——spawnMonsters 会重置 _combatMonsterKeys）
        if (!node.isElite) this._maybeSpawnTombstone();
    },

    /**
     * 墓碑事件（僵尸地牢初级/中级/高级 · 普通战斗 33% 概率）：
     * 在距玩家最远的角落生成墓碑（站桩召唤器，enemy-config noPool 不进任何刷怪池）。
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
        // 仅僵尸地牢三级（zombieBeginner / zombieMid / zombie），沼泽等其他地牢不触发
        if (!['zombieBeginner', 'zombieMid', 'zombie'].includes(this.dungeonType)) return;
        if (Math.random() >= 0.33) return;
        const bounds = CombatRoomSystem._roomBounds;
        const player = this.player;
        if (!bounds || !player) return;

        const TOMB_RADIUS = 60;             // 墓碑地面占位半径（碰撞 120×60 的一半量级）
        const PROBE_RADIUS = 15;            // 寻路验证用僵尸半径（普通僵尸 groundRadius 量级）
        const INSET = TOMB_RADIUS + 20;     // 贴墙内收安全距离

        // 候选角落（菱形房：矩形四角在界外，取对角线方向与边界的交点 s/rx + s/ry = 1）
        let corners;
        if (bounds.diamond) {
            const s = Math.max(0, (bounds.rx * bounds.ry) / (bounds.rx + bounds.ry) - INSET);
            corners = [
                { x: bounds.cx + s, y: bounds.cy + s },
                { x: bounds.cx + s, y: bounds.cy - s },
                { x: bounds.cx - s, y: bounds.cy + s },
                { x: bounds.cx - s, y: bounds.cy - s },
            ];
        } else {
            corners = [
                { x: bounds.maxX - INSET, y: bounds.maxY - INSET },
                { x: bounds.maxX - INSET, y: bounds.minY + INSET },
                { x: bounds.minX + INSET, y: bounds.maxY - INSET },
                { x: bounds.minX + INSET, y: bounds.minY + INSET },
            ];
        }
        // 距玩家从远到近排序
        corners.sort((a, b) =>
            Math.hypot(b.x - player.x, b.y - player.y) - Math.hypot(a.x - player.x, a.y - player.y));

        // 房内判定（菱形房按菱形内缩判定，外接矩形四角在界外）
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

        for (const corner of corners) {
            // 先试角落本身，再按递近半径做 8 向螺旋搜索
            const candidates = [{ x: corner.x, y: corner.y }];
            for (const r of [40, 80, 120, 160]) {
                for (let i = 0; i < 8; i++) {
                    const a = (i / 8) * Math.PI * 2;
                    candidates.push({ x: corner.x + Math.cos(a) * r, y: corner.y + Math.sin(a) * r });
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
        }
        console.warn('[DungeonMapSystem] 墓碑生成失败：所有角落均不可行走/不可达玩家，本次放弃生成');
    },

    /** 月影庇护：进战斗给无敌，精英/Boss 战额外给增伤标记 */
    _triggerMoonshadow(isEliteOrBoss) {
        const ms = getMoonshadowConfig();
        if (!ms || !this.player) return;
        this.player._moonshadowTimer = ms.duration;
        if (isEliteOrBoss) this.player._moonshadowBoostActive = true;
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
        CombatRoomSystem.enterCombatRoom(this.player, false, { roomSize: DungeonConfig.getCombatRoomConfig(this.dungeonType).bossSize });
        this._spawnZombieWave();
        EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, "Boss 战！", "#ff0000"));
    },

    // ========== 时空特工入侵战斗（追上后强制触发） ==========

    /**
     * 入侵战斗入口：
     * - 情况1/3（事件/BOSS/奖励节点）：4096 场地仅刷特工，胜利后继续原节点事件
     * - 情况2（战斗节点）：4096 场地原怪物 + 随机自由边刷特工（全场敌对）
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
            this._enterZombieCombat(node, { roomSize: arenaSize });
            this._spawnInvasionAgentsOnFreeEdge(AgentInvasionSystem.getAgentFactories());
        } else {
            // 情况1/3：仅特工的强制战（胜利后经 _leaveCombatViaPortal 继续原事件）
            this._invasionMixed = false;
            this._zombieWaveActive = false; // 无波次
            CombatRoomSystem.enterCombatRoom(this.player, false, { roomSize: arenaSize });
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

        // ── 上方：背景图，裁剪在上区内 ──
        this._renderBackground(ctx, viewW, viewH, area.top);

        // ── 下方：地图选择区域底块（不透明深色，盖住黑底，与上区明确分界）──
        ctx.fillStyle = "#08080a";
        ctx.fillRect(area.left, area.top, area.width, area.height);

        // ── 地图内容：裁剪在区域内，无论怎么拖/缩放都不溢出 ──
        ctx.save();
        ctx.beginPath();
        ctx.rect(area.left, area.top, area.width, area.height);
        ctx.clip();

        // 应用地图变换
        ctx.translate(this.mapOffsetX, this.mapOffsetY);
        ctx.scale(this.mapScale, this.mapScale);

        // ── 绘制边（连线）─
        for (const edge of this.edges) {
            const fromNode = this.nodes.find(n => n.id === edge.from);
            const toNode = this.nodes.find(n => n.id === edge.to);
            if (!fromNode || !toNode) continue;

            const isVisited = this.visitedNodeIds.has(fromNode.id) && this.visitedNodeIds.has(toNode.id);
            const isAvailable = this.currentNodeId === fromNode.id && availableIds.has(toNode.id);

            if (isVisited) {
                ctx.strokeStyle = "#5a8a5a";
                ctx.lineWidth = 3;
                ctx.globalAlpha = 0.8;
            } else if (isAvailable) {
                ctx.strokeStyle = "#9a8a5a";
                ctx.lineWidth = 2.5;
                ctx.globalAlpha = 0.9;
            } else {
                ctx.strokeStyle = "#2a2a2a";
                ctx.lineWidth = 1.5;
                ctx.globalAlpha = 0.4;
            }

            ctx.beginPath();
            ctx.moveTo(fromNode.x, fromNode.y);
            ctx.lineTo(toNode.x, toNode.y);
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        }

        // ── 绘制节点 ──
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

            if (glow) {
                ctx.shadowColor = borderColor;
                ctx.shadowBlur = 16 / this.mapScale; // 缩放时调整发光强度
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
            ctx.globalAlpha = 1.0;

            // 节点图标
            let icon;
            if (!isRevealed && !isVisited && !isCurrent) {
                icon = "?"; // 迷雾：显示问号
            } else {
                icon = this.TYPE_ICONS[displayType] || "•";
            }
            ctx.fillStyle = (isAvailable || isCurrent || isRevealed) ? "#ffffff" : "#555555";
            ctx.font = `${isHovered ? 18 : 16}px "Microsoft YaHei", sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(icon, node.x, node.y);

            // 精英节点标记（遵循迷雾规则，未揭示时不显示）
            if (node.isElite && isRevealed) {
                ctx.strokeStyle = "#8a3a9a";
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
                ctx.stroke();

                ctx.fillStyle = "#d08ae0";
                ctx.font = "bold 14px \"Microsoft YaHei\", sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("★", node.x, node.y - radius - 10);
            }

            // 当前节点标记
            if (isCurrent) {
                ctx.fillStyle = "#ffffff";
                ctx.font = "bold 12px sans-serif";
                ctx.fillText("你", node.x, node.y + radius + 16);
            }
        }

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
        const btn = document.createElement('div');
        btn.id = 'mouseShopButton';
        btn.textContent = '小鼠商店';
        btn.style.cssText = `
            position: fixed;
            left: 20px;
            bottom: calc(18.84vh + 10px);
            transform: translateY(50%);
            width: 183px;
            height: 65px;
            background: linear-gradient(135deg, #3a5a7a, #5a8aaa, #3a5a7a);
            background-size: 200% 200%;
            animation: versionGlow 2s ease infinite;
            border: 2px solid #5a8aaa;
            border-radius: 12px;
            color: #d4c5a9;
            font-size: 20px;
            font-family: SimHei, "Microsoft YaHei", sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
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
        const btn = document.createElement('div');
        btn.id = 'abandonButton';
        btn.textContent = '放弃并返回';
        btn.style.cssText = `
            position: fixed;
            right: 20px;
            bottom: calc(18.84vh + 10px);
            transform: translateY(50%);
            width: 164px;
            height: 66px;
            background: linear-gradient(135deg, #7a3a3a, #aa5a5a, #7a3a3a);
            background-size: 200% 200%;
            animation: versionGlow 2s ease infinite;
            border: 2px solid #ff6b6b;
            border-radius: 12px;
            color: #d4c5a9;
            font-size: 20px;
            font-family: SimHei, "Microsoft YaHei", sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
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

    /** 安全撤离按钮：仅在当前位于起始点时显示（放弃按钮左侧，绿色），撤离不丢背包物品 */
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
        btn.textContent = '安全撤离';
        btn.style.cssText = `
            position: fixed;
            right: 204px;
            bottom: calc(18.84vh + 10px);
            transform: translateY(50%);
            width: 140px;
            height: 66px;
            background: linear-gradient(135deg, #3a6a3a, #5aaa5a, #3a6a3a);
            background-size: 200% 200%;
            animation: versionGlow 2s ease infinite;
            border: 2px solid #6aca6a;
            border-radius: 12px;
            color: #d4c5a9;
            font-size: 20px;
            font-family: SimHei, "Microsoft YaHei", sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
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
