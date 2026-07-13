
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
 *   ShopSystem, NPCDialogue, SceneManager, CONFIG, Enemy, FloatingTextEffect,
 *   RewardSystem, pathFinder
 */

import { FloatingTextEffect } from '../effects/floating-text.js';
import { UIState } from '../ui/ui-state.js';
import { ZombieDungeonMapGenerator, ZOMBIE_DUNGEON_CONFIG, ZombieDungeonCombat, ZombieDungeonShop } from './zombie-dungeon.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import { DungeonChest } from '../entities/dungeon-chest.js';
import { DungeonMapGenerator, DungeonFogOfWar } from './dungeon-map-generator.js';
import { CombatRoomSystem } from './combat-room-system.js';
import { BossRewardSystem } from './boss-reward-system.js';
import { EffectManager } from '../effects/effect-manager.js';
import { getElement } from '../utils/dom-utils.js';
import { TimerManager } from '../utils/timer-manager.js';
import { ShopSystem } from '../ui/shop-system.js';
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

    // 拖动与缩放状态
    mapOffsetX: 0,
    mapOffsetY: 0,
    mapScale: 1.0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragStartOffsetX: 0,
    dragStartOffsetY: 0,
    _mouseDownTime: 0,
    _mouseDownPos: { x: 0, y: 0 },
    _eventListeners: [],

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

    // UI 点击区域
    EXIT_BUTTON_X: 1685 - 110,
    EXIT_BUTTON_Y: 15,
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

    // 精英战斗奖励宝箱
    _eliteChest: null,
    _eliteChestOpened: false,

    init(sceneId, player, dungeonType = 'default') {
        this.active = true;
        this.state = "map";
        this.sceneId = sceneId;
        this.player = player;
        this.dungeonType = dungeonType;
        this.dungeonName = dungeonType === 'zombie' ? ZOMBIE_DUNGEON_CONFIG.name : '地牢';
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
        this._eliteChest = null;
        this._eliteChestOpened = false;

        // 初始化迷雾系统
        this.fogOfWar = new DungeonFogOfWar();

        this.generateMap();
        this._centerRouteMap();
        this.isDragging = false;

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
        this.active = false;
        this.state = "idle";
        this.nodes = [];
        this.edges = [];
        this._cleanupEventUI();
        this._removeMouseShopButton();
        this._removeAbandonButton();
        this._removeDungeonNameLabel();
        this._unbindEvents();
        // 清空携带的祭品，确保祭品效果只在当前地牢有效
        this._carriedItems = [];

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
        this._eventListeners = [
            { el: canvas, type: "mousedown", fn: onMouseDown },
            { el: window, type: "mousemove", fn: onMouseMove },
            { el: window, type: "mouseup", fn: onMouseUp },
        ];
    },

    _unbindEvents() {
        for (const { el, type, fn } of this._eventListeners) {
            el.removeEventListener(type, fn);
        }
        this._eventListeners = [];
    },

    // ───────────────────────────────────────────────
    // 地图生成：根据 dungeonType 选择生成策略
    // ───────────────────────────────────────────────
    generateMap() {
        if (this.dungeonType === 'zombie') {
            this._generateZombieMap();
            return;
        }
        this._generateDefaultMap();
    },

    // 默认地牢：使用新的 DungeonMapGenerator 生成 35-40 节点地图
    _generateDefaultMap() {
        const generator = new DungeonMapGenerator();
        const result = generator.generate();
        this.nodes = result.nodes;
        this.edges = result.edges;

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

    // 僵尸地牢：4条路线 converging to BOSS
    _generateZombieMap() {
        const generator = new ZombieDungeonMapGenerator();
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
        const reachableIds = this.edges
            .filter(e => e.from === this.currentNodeId)
            .map(e => e.to);
        return this.nodes.filter(n => reachableIds.includes(n.id));
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
     * 钳制地图偏移，使 2048×2048 的地图不会拖出显示区域
     */
    _clampMapOffset() {
        const viewW = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : this.DEFAULT_VIEWPORT_WIDTH;
        const viewH = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : this.DEFAULT_VIEWPORT_HEIGHT;
        const marginX = this.MAP_MARGIN_X;
        const marginY = this.MAP_MARGIN_Y;
        const areaLeft = marginX;
        const areaTop = marginY;
        const areaW = viewW - marginX * 2;
        const areaH = viewH - marginY * 2;

        const mapW = this.MAP_WIDTH * this.mapScale;
        const mapH = this.MAP_HEIGHT * this.mapScale;

        let minX = areaLeft + areaW - mapW;
        let maxX = areaLeft;
        if (minX > maxX) { const t = minX; minX = maxX; maxX = t; }

        let minY = areaTop + areaH - mapH;
        let maxY = areaTop;
        if (minY > maxY) { const t = minY; minY = maxY; maxY = t; }

        this.mapOffsetX = Math.min(maxX, Math.max(minX, this.mapOffsetX));
        this.mapOffsetY = Math.min(maxY, Math.max(minY, this.mapOffsetY));
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
        // 使用实际窗口尺寸动态计算居中区域（确保地图在当前窗口中居中）
        const viewW = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 1920;
        const viewH = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 1080;
        // 地图显示区域：水平居中，垂直居中，留出边距
        const marginX = 280;  // 左右边距（给侧边栏留空间）
        const marginY = 120;  // 上下边距
        const TARGET_AREA = {
            left: marginX,
            top: marginY,
            width: viewW - marginX * 2,
            height: viewH - marginY * 2
        };

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

        // 计算缩放比例，使路线图完整显示在目标区域中
        const routeW = bounds.maxX - bounds.minX + padding * 2;
        const routeH = bounds.maxY - bounds.minY + padding * 2;
        const scaleX = TARGET_AREA.width / routeW;
        const scaleY = TARGET_AREA.height / routeH;
        this.mapScale = Math.min(scaleX, scaleY, 1.5); // 限制最大缩放1.5倍

        // 计算偏移，使路线图在目标区域中居中
        const routeCX = (bounds.minX + bounds.maxX) / 2;
        const routeCY = (bounds.minY + bounds.maxY) / 2;
        this.mapOffsetX = TARGET_AREA.left + TARGET_AREA.width / 2 - routeCX * this.mapScale;
        this.mapOffsetY = TARGET_AREA.top + TARGET_AREA.height / 2 - routeCY * this.mapScale;
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

        // Boss 战模式：委托给 BossRewardSystem 更新，并检测传送门
        if (this.state === "boss") {
            if (BossRewardSystem.isBossBattleActive && BossRewardSystem.isBossBattleActive()) {
                BossRewardSystem.update(dt);
            }

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
        const isCombatDone = this.dungeonType === 'zombie'
            ? this._checkZombieCombatComplete()
            : CombatRoomSystem.isCombatComplete();

        if (isCombatDone) {
            const currentNode = this.getCurrentNode();
            const isEliteNode = currentNode && currentNode.isElite;

            if (isEliteNode) {
                // 精英节点：先刷出宝箱，打开后再生成传送门
                if (!this._eliteChest && !this._eliteChestOpened) {
                    const bounds = CombatRoomSystem._roomBounds;
                    const cx = bounds ? bounds.cx : this.player.x;
                    const cy = bounds ? bounds.cy : this.player.y;
                    const chest = new DungeonChest(cx, cy, {
                        openRange: 60,
                        onOpen: () => this._openEliteChest(currentNode)
                    });
                    this._eliteChest = chest;
                    Game.entities.set('elite_chest', chest);
                    if (SceneManager && SceneManager.showTopNotification) {
                        SceneManager.showTopNotification('精英敌人已被消灭，打开宝箱获取奖励');
                    }
                }

                // 检测玩家靠近宝箱并自动打开
                if (this._eliteChest && this._eliteChest.active && !this._eliteChest.opened) {
                    const dx = this.player.x - this._eliteChest.x;
                    const dy = this.player.y - this._eliteChest.y;
                    if (Math.sqrt(dx * dx + dy * dy) <= this._eliteChest.openRange) {
                        this._eliteChest.open();
                    }
                }
            } else {
                // 普通节点：直接生成出口传送门
                if (!this._exitPortalSpawned) {
                    this._exitPortalSpawned = true;
                    CombatRoomSystem.spawnExitPortal();

                    // 标记当前战斗节点为已完成（变为 empty）
                    if (currentNode && currentNode.type !== 'empty' && currentNode.type !== 'start' && currentNode.type !== 'boss') {
                        currentNode.type = 'empty';
                    }

                    // 上方提示栏：已完成战斗，寻找传送门离开
                    if (SceneManager && SceneManager.showTopNotification) {
                        SceneManager.showTopNotification('已完成战斗，寻找传送门离开');
                    }
                }
            }
        }

        // 检测玩家是否进入出口传送门
        const portal = CombatRoomSystem.getExitPortal();
        if (portal && portal.active && this.player) {
            const dx = this.player.x - portal.x;
            const dy = this.player.y - portal.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= portal.radius) {
                this._leaveCombatViaPortal();
            }
        }
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
    },

    _handleClick() {
        // 地图固定显示，鼠标点击始终有效（不再区分拖动和点击）
        const mx = Input.mouse.x, my = Input.mouse.y;
        // 检测退出按钮点击
        const btnX = this.EXIT_BUTTON_X, btnY = this.EXIT_BUTTON_Y, btnW = this.EXIT_BUTTON_W, btnH = this.EXIT_BUTTON_H;
        if (mx >= btnX && mx <= btnX + btnW && my >= btnY && my <= btnY + btnH) {
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

        // empty 节点仅用于通行，不移动当前位置，避免切断前进路线
        if (node.type === 'empty') {
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

        // 战斗节点完成后变为 empty
        if (node.originalType === 'combat' && node.type === 'combat') {
            // 标记为已完成，返回地图时转换
            node._combatCompleted = true;
        }

        switch (node.type) {
            case "combat": this._enterCombat(node); break;
            case "boss":   this._enterBoss(node); break;
            case "event":  this._enterEvent(node); break;
            case "reward": this._enterReward(node); break;
            default:       this._returnToMap(); break;
        }
    },

    _returnToMap() {
        this.state = "map";
        Camera.follow = () => {};
        Camera.x = this.CENTER_X;
        Camera.y = this.CENTER_Y;

        // 清理事件/战斗残留的浮动文字
        if (EffectManager && EffectManager.clearFloatingTexts) {
            EffectManager.clearFloatingTexts();
        }

        this._centerRouteMap();

        // 显示地图界面按钮
        this._createMouseShopButton();
        this._createAbandonButton();

        const current = this.getCurrentNode();
        if (current && current.type === "boss" && this.visitedNodeIds.has(current.id)) {
            this._showVictory();
        }
    },

    // 通过出口传送门离开战斗：发放奖励、清理战斗场地、删除掉落物、返回地图
    _leaveCombatViaPortal() {
        const player = this.player || Game.player;
        if (!player) return;

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

    // 打开精英战斗奖励宝箱：发放配置奖励并生成出口传送门
    _openEliteChest(currentNode) {
        if (this._eliteChestOpened) return;
        this._eliteChestOpened = true;

        // 从配置读取奖励
        const cfg = DungeonConfig.getZombieDungeonConfig();
        const rewards = cfg.eliteChestReward && cfg.eliteChestReward.items ? cfg.eliteChestReward.items : [];
        if (rewards.length > 0 && BossRewardSystem && BossRewardSystem.rewardNode) {
            BossRewardSystem.rewardNode.giveReward(this.player, rewards);
        }

        if (EffectManager && FloatingTextEffect) {
            EffectManager.add(new FloatingTextEffect(this.player.x, this.player.y - 50, '宝箱已开启！', '#ffd700'));
        }

        // 标记节点完成并生成出口传送门
        if (currentNode && currentNode.type !== 'empty' && currentNode.type !== 'start' && currentNode.type !== 'boss') {
            currentNode.type = 'empty';
        }
        this._exitPortalSpawned = true;
        CombatRoomSystem.spawnExitPortal();

        if (SceneManager && SceneManager.showTopNotification) {
            SceneManager.showTopNotification('宝箱已开启，通过传送门离开');
        }
    },

    _enterCombat(node) {
        this.state = "combat";
        // 进入新战斗前，先清理上一场战斗可能残留的传送门/掉落物/宝箱
        this._cleanupCombatScene();
        this._exitPortalSpawned = false;
        this._eliteChest = null;
        this._eliteChestOpened = false;

        if (this.dungeonType === 'zombie') {
            this._enterZombieCombat(node);
            return;
        }

        // 使用 CombatRoomSystem 生成随机战斗场地
        CombatRoomSystem.enterCombatRoom(this.player, false);
        // 生成普通怪物
        CombatRoomSystem.spawnMonsters(3, false);
        EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, "进入战斗！消灭所有敌人", "#ff4444"));
    },

    _enterZombieCombat(node) {
        this._zombieCombatNode = node;
        this._zombieWaveActive = true;
        this._zombieCombat = new ZombieDungeonCombat(undefined, !!node.isElite);

        // 所有僵尸战斗统一使用 CombatRoomSystem 生成随机房间
        CombatRoomSystem.enterCombatRoom(this.player, false);
        this._spawnZombieWave();
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
        this.state = "boss";
        // 进入 Boss 战前清理残留的战斗场景
        this._cleanupCombatScene();
        this._exitPortalSpawned = false;
        // 所有 Boss 战统一使用 BossRewardSystem 的大块头 Boss
        BossRewardSystem.enterBossBattle(this.player, () => {
            // Boss 击败且玩家通过传送门离开后，标记节点完成
            if (node) {
                node.completed = true;
                node.type = 'empty';
            }
        });
        EffectManager.add(new FloatingTextEffect(this.FLOAT_TEXT_X, this.FLOAT_TEXT_Y, "Boss 战！", "#ff0000"));
    },

    _checkZombieCombatComplete() {
        if (this.state !== "combat" && this.state !== "boss") return false;

        const allDead = this._combatMonsters.every(m => !m.active || m.hp <= 0);
        if (!allDead) return false;

        // 僵尸地牢：检查是否还有下一波
        if (this.dungeonType === 'zombie' && this.state === "combat" && this._zombieWaveActive) {
            if (this._zombieCombat && !this._zombieCombat.isComplete) {
                // 防止重复设置过渡
                if (this._waveTransitioning) return false;
                this._waveTransitioning = true;
                // 短暂延迟后生成下一波
                TimerManager.setTimeout(() => {
                    this._waveTransitioning = false;
                    if (this.active && this.state === "combat") {
                        CombatRoomSystem.cleanupMonstersOnly();
                        this._spawnZombieWave();
                    }
                }, 1500);
                return false; // 还有下一波，战斗未完成
            }
        }

        return true; // 所有怪物死亡且无下一波，战斗完成
    },

    _cleanupCombat() {
        // 使用 CombatRoomSystem 清理战斗场地（包含掉落物、传送门）
        if (CombatRoomSystem.active) {
            CombatRoomSystem.cleanupRoom();
        } else {
            CombatRoomSystem.cleanupDrops();
        }

        for (const key of this._combatMonsterKeys) {
            Game.entities.delete(key);
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
        this._eliteChest = null;
        this._eliteChestOpened = false;

        // 战斗完成后消耗女神祝福层数
        import('./dungeon-event-system.js').then(mod => {
            if (mod.onCombatComplete) mod.onCombatComplete(this.player);
        }).catch(() => {});

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

        // 清理可能残留的精英宝箱
        if (this._eliteChest) {
            if (this._eliteChest._destroyPhaserSprite) this._eliteChest._destroyPhaserSprite();
            Game.entities.delete('elite_chest');
            this._eliteChest = null;
        }
        this._eliteChestOpened = false;
        this._exitPortalSpawned = false;
    },

    _enterShop(node) {
        if (this.dungeonType === 'zombie') {
            this._enterZombieEvent(node);
            return;
        }
        this.state = "shop";
        const fakeNPC = {
            x: node.x, y: node.y,
            name: "地牢商人",
            portrait: "assets/ui/npc_portrait.png",
            npcType: "shop"
        };
        ShopSystem.open(fakeNPC);

        const checkInterval = TimerManager.setInterval(() => {
            if (!UIState.isOpen('shop')) {
                TimerManager.clearInterval(checkInterval);
                this._returnToMap();
            }
        }, 300);
    },

    _enterReward(_node) {
        this.state = "reward";
        // 使用 BossRewardSystem 的奖励节点管理器
        BossRewardSystem.enterRewardNode(this.player, () => {
            this._returnToMap();
        });
    },

    _enterZombieShop(_node) {
        // 保持 state='map'，避免游戏画面从地牢路线图切到真实世界造成“传送”感
        this._removeMouseShopButton();
        this._removeAbandonButton();
        ZombieDungeonShop.open();
        const checkInterval = TimerManager.setInterval(() => {
            if (ZombieDungeonShop.isClosed()) {
                TimerManager.clearInterval(checkInterval);
                this._returnToMap();
            }
        }, 300);
    },

    _enterEvent(node) {
        if (this.dungeonType === 'zombie') {
            this._enterZombieEvent(node);
            return;
        }
        this.state = "event";

        // 使用新的 DungeonEventSystem
        import('./dungeon-event-system.js').then(mod => {
            mod.DungeonEventSystem.trigger(this.player, (result) => {
                // 如果触发战斗，进入战斗状态
                if (result && result.combat) {
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
                    if (shouldEmpty && node.type !== 'empty' && node.type !== 'start' && node.type !== 'boss') {
                        node.type = 'empty';
                    }
                    this._returnToMap();
                }
            }, null, this); // 传入 dungeonMapSystem = this
        }).catch(err => {
            console.error('[DungeonMapSystem] Failed to load dungeon-event-system:', err);
            // 降级到旧的事件系统
            this._enterLegacyEvent(node);
        });
    },

    // 旧版事件系统（降级方案）
    _enterLegacyEvent(_node) {
        const events = [
            {
                title: "发现宝箱",
                text: "你在黑暗的角落里发现了一个破旧的木箱，上面刻着古老的符文。",
                choices: ["打开", "离开"],
                reward: { gold: 60, text: "获得 60 金币！" }
            },
            {
                title: "神秘祭坛",
                text: "一个散发着微弱蓝光的古老祭坛出现在你面前，空气中弥漫着魔力。",
                choices: ["触摸", "无视"],
                reward: { gold: 0, text: "魔力涌入体内，获得临时增益！" }
            },
            {
                title: "受伤的冒险者",
                text: "一位满身是血的冒险者靠在墙边，看到你后艰难地伸出手。",
                choices: ["帮助", "离开"],
                reward: { gold: 40, text: "冒险者赠予你 40 金币作为谢礼。" }
            },
            {
                title: "古老陷阱",
                text: "你触发了地面上的压力板，四周的墙壁开始渗出毒气！",
                choices: ["躲避", "硬抗"],
                reward: { gold: 0, text: "你成功躲避了陷阱。" }
            },
        ];
        const event = events[Math.floor(Math.random() * events.length)];
        this._showEventUI(event);
    },

    _enterZombieEvent(node) {
        this.state = "event";
        // 使用 DungeonEventSystem 提供完整的随机事件
        import('./dungeon-event-system.js').then(mod => {
            mod.DungeonEventSystem.trigger(this.player, (result) => {
                if (result && result.combat) {
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
                    if (shouldEmpty && node.type !== 'empty' && node.type !== 'start' && node.type !== 'boss') {
                        node.type = 'empty';
                    }
                    this._returnToMap();
                }
            }, null, this); // 传入 dungeonMapSystem = this
        }).catch(err => {
            console.error('[DungeonMapSystem] Failed to load dungeon-event-system for zombie:', err);
            // 降级到旧版事件系统
            this._enterLegacyEvent(node);
        });
    },

    _showEventUI(event) {
        this._cleanupEventUI();

        const overlay = document.createElement("div");
        overlay.id = "dungeonEventOverlay";
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.80); z-index: 8000;
            display: flex; align-items: center; justify-content: center;
            font-family: SimHei, "Microsoft YaHei", sans-serif; user-select: none;
        `;

        const panel = document.createElement("div");
        panel.style.cssText = `
            background: #2a2520; border: 2px solid #5a4a3a; border-radius: 10px;
            padding: 35px; max-width: 520px; width: 90%; color: #d4c5a9;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        `;

        const title = document.createElement("h3");
        title.textContent = event.title;
        title.style.cssText = "margin: 0 0 18px 0; color: #e8c878; font-size: 24px; text-align: center;";

        const text = document.createElement("p");
        text.textContent = event.text;
        text.style.cssText = "margin: 0 0 28px 0; line-height: 1.7; font-size: 16px; text-align: center;";

        const btnRow = document.createElement("div");
        btnRow.style.cssText = "display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;";

        for (const choice of event.choices) {
            const btn = document.createElement("button");
            btn.textContent = choice;
            btn.style.cssText = `
                padding: 12px 32px; background: #3a4530; border: 1px solid #5a6a4a;
                color: #d4c5a9; border-radius: 5px; cursor: pointer; font-size: 15px;
                transition: background 0.15s;
            `;
            btn.onmouseenter = () => btn.style.background = "#4a5540";
            btn.onmouseleave = () => btn.style.background = "#3a4530";
            btn.onclick = () => {
                if (choice !== "离开" && choice !== "无视") {
                    EffectManager.add(new FloatingTextEffect(512, 512, event.reward.text, "#ffd700"));
                }
                this._cleanupEventUI();
                this._returnToMap();
            };
            btnRow.appendChild(btn);
        }

        panel.appendChild(title);
        panel.appendChild(text);
        panel.appendChild(btnRow);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        this._eventOverlay = overlay;
    },

    _cleanupEventUI() {
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

        const FIXED_WIDTH = this.DEFAULT_VIEWPORT_WIDTH, FIXED_HEIGHT = this.DEFAULT_VIEWPORT_HEIGHT;
        const availableNodes = this.getAvailableNodes();
        const availableIds = new Set(availableNodes.map(n => n.id));

        // 保存原始状态
        ctx.save();

        // 应用地图变换
        ctx.translate(this.mapOffsetX, this.mapOffsetY);
        ctx.scale(this.mapScale, this.mapScale);

        // ── 绘制地图背景 ──
        ctx.fillStyle = "#1a1814";
        ctx.fillRect(0, 0, this.MAP_WIDTH, this.MAP_HEIGHT);

        // 背景纹理：网格线
        ctx.strokeStyle = "#252220";
        ctx.lineWidth = 1;
        const gridSize = 80;
        for (let x = 0; x <= this.MAP_WIDTH; x += gridSize) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.MAP_HEIGHT); ctx.stroke();
        }
        for (let y = 0; y <= this.MAP_HEIGHT; y += gridSize) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.MAP_WIDTH, y); ctx.stroke();
        }

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

        // 恢复原始状态
        ctx.restore();

        // ── 绘制 UI 覆盖层（不受地图变换影响）─
        // 标题与提示已改为 DOM 覆盖层（#dungeonMapTitle），底部居中

        // 进度
        const progress = `${this.visitedNodeIds.size} / ${this.nodes.length}`;
        ctx.fillStyle = "#666666";
        ctx.font = "13px sans-serif";
        ctx.fillText(`进度: ${progress} 节点`, FIXED_WIDTH / 2, FIXED_HEIGHT - 20);

        // 缩放指示
        ctx.fillStyle = "#444444";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(`${Math.round(this.mapScale * 100)}%`, FIXED_WIDTH - 20, FIXED_HEIGHT - 20);
        ctx.textAlign = "center";

        // 退出按钮
        const btnX = FIXED_WIDTH - 110, btnY = 15, btnW = 90, btnH = 28;
        ctx.fillStyle = "#3a5a3a";
        ctx.fillRect(btnX, btnY, btnW, btnH);
        ctx.strokeStyle = "#6a8a5a";
        ctx.lineWidth = 1;
        ctx.strokeRect(btnX, btnY, btnW, btnH);
        ctx.fillStyle = "#d4c5a9";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("退出地牢", btnX + btnW / 2, btnY + btnH / 2);
        ctx.textBaseline = "alphabetic";
    },

    _createMouseShopButton() {
        if (getElement('mouseShopButton')) return;
        const container = document.querySelector('#gameContainer .bottom-bar') || document.body;
        const btn = document.createElement('div');
        btn.id = 'mouseShopButton';
        btn.textContent = '小鼠商店';
        btn.style.cssText = `
            position: absolute;
            right: calc(100% + 50px);
            top: 50%;
            transform: translateY(-50%);
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
        container.appendChild(btn);
    },

    _removeMouseShopButton() {
        const btn = getElement('mouseShopButton');
        if (btn) btn.remove();
    },

    _createAbandonButton() {
        if (getElement('abandonButton')) return;
        const container = document.querySelector('#gameContainer .bottom-bar') || document.body;
        const btn = document.createElement('div');
        btn.id = 'abandonButton';
        btn.textContent = '放弃并返回';
        btn.style.cssText = `
            position: absolute;
            left: calc(100% + 50px);
            top: 50%;
            transform: translateY(-50%);
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
        container.appendChild(btn);
    },

    _removeAbandonButton() {
        const btn = getElement('abandonButton');
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
            <p style="color: #d4c5a9; font-size: 20px; margin-bottom: 40px;">你击败了地牢深处的所有敌人，荣耀归于勇者。</p>
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
                <h3 style="color: #e8c878; margin: 0 0 15px; font-size: 22px;">确认退出地牢</h3>
                <p style="margin: 0 0 25px; line-height: 1.6;">当前进度将会保存。<br>确定要返回主神空间吗？</p>
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

    _showEntryConfirm() {
        if (getElement("dungeonEntryConfirm")) return;
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.id = "dungeonEntryConfirm";
            overlay.style.cssText = `
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.80); z-index: 10001;
                display: flex; align-items: center; justify-content: center;
                font-family: SimHei, "Microsoft YaHei", sans-serif; user-select: none;
            `;
            overlay.innerHTML = `
                <div style="background: #2a2520; border: 2px solid #5a4a3a; border-radius: 10px; padding: 30px; max-width: 400px; width: 90%; color: #d4c5a9; text-align: center;">
                    <h3 style="color: #e8c878; margin: 0 0 15px; font-size: 22px;">⚔ 地牢模式</h3>
                    <p style="margin: 0 0 25px; line-height: 1.6;">你即将进入杀戮尖塔风格的地牢探险。<br>选择路线，击败敌人，获取奖励。</p>
                    <div style="display: flex; gap: 15px; justify-content: center;">
                        <button id="dungeonEntryConfirmBtn" style="padding: 12px 30px; background: #4a6a3a; border: 2px solid #6a8a5a; color: #d4c5a9; border-radius: 5px; cursor: pointer; font-size: 15px;">进入地牢</button>
                        <button id="dungeonEntryCancelBtn" style="padding: 12px 30px; background: #3a3a3a; border: 2px solid #5a5a5a; color: #888; border-radius: 5px; cursor: pointer; font-size: 15px;">离开</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const confirmBtn = getElement("dungeonEntryConfirmBtn");
            const cancelBtn = getElement("dungeonEntryCancelBtn");

            confirmBtn.onmouseenter = () => confirmBtn.style.background = "#5a7a4a";
            confirmBtn.onmouseleave = () => confirmBtn.style.background = "#4a6a3a";
            cancelBtn.onmouseenter = () => cancelBtn.style.background = "#4a4a4a";
            cancelBtn.onmouseleave = () => cancelBtn.style.background = "#3a3a3a";

            confirmBtn.onclick = () => {
                overlay.remove();
                resolve(true);
            };

            cancelBtn.onclick = () => {
                overlay.remove();
                resolve(false);
            };
        });
    },
};

// 将 DungeonMapSystem 挂载到全局，供其他模块（如 GameScene.js、player.js）访问
if (typeof window !== 'undefined' && !window.DungeonMapSystem) {
    window.DungeonMapSystem = DungeonMapSystem;
}
