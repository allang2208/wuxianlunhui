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

import { BlackWolf } from '../entities/enemy-types.js';
import {
    HumanoidMonster, Commander, MachineGunner, Rifleman, FlankRifleman, ShieldBearer
} from '../entities/humanoid-monster.js';
import { ZombieDungeonMapGenerator, ZOMBIE_DUNGEON_CONFIG } from './zombie-dungeon.js';
import { DungeonMapGenerator, DungeonFogOfWar, DUNGEON_MAP_CONFIG } from './dungeon-map-generator.js';
import { CombatRoomSystem } from './combat-room-system.js';
import { BossRewardSystem } from './boss-reward-system.js';

export const DungeonMapSystem = {
    active: false,
    state: "idle",
    player: null,
    sceneId: null,
    dungeonType: 'default', // 'default' | 'zombie'

    nodes: [],
    edges: [],
    currentNodeId: null,
    visitedNodeIds: new Set(),
    hoveredNodeId: null,

    // 地图尺寸（比屏幕大，可拖动）
    MAP_WIDTH:  2000,
    MAP_HEIGHT: 1500,
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

    // 打扫战场倒计时
    _cleanupTimer: 0,
    _cleanupActive: false,
    _cleanupOverlay: null,

    init(sceneId, player, dungeonType = 'default') {
        this.active = true;
        this.state = "map";
        this.sceneId = sceneId;
        this.player = player;
        this.dungeonType = dungeonType;
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
        this._cleanupTimer = 0;
        this._cleanupActive = false;
        this._cleanupOverlay = null;

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
        Camera.x = 512;
        Camera.y = 512;

        this._bindEvents();

        // 初始化时显示地图界面按钮
        this._createMouseShopButton();
        this._createAbandonButton();

        console.log(`[DungeonMapSystem] Initialized (${dungeonType})`, this.nodes.length, "nodes,", this.edges.length, "edges");
    },

    shutdown() {
        this.active = false;
        this.state = "idle";
        this.nodes = [];
        this.edges = [];
        this._cleanupEventUI();
        this._removeCleanupOverlay();
        this._removeMouseShopButton();
        this._removeAbandonButton();
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
        const canvas = document.getElementById("gameCanvas");
        if (!canvas) return;

        const onMouseDown = (e) => {
            this.isDragging = false;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            this._mouseDownTime = Date.now();
            this._mouseDownPos = { x: e.clientX, y: e.clientY };
        };
        // 不再绑定拖动和缩放事件，地图固定居中显示
        canvas.addEventListener("mousedown", onMouseDown);
        this._eventListeners = [
            { el: canvas, type: "mousedown", fn: onMouseDown },
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

        // 更新地图尺寸为生成器使用的尺寸
        this.MAP_WIDTH = result.config.mapWidth;
        this.MAP_HEIGHT = result.config.mapHeight;

        // 重新居中（使用固定目标区域，不随分辨率变化）
        const TARGET_AREA = { left: 260, top: 94, width: 1425, height: 724 };
        this.mapOffsetX = TARGET_AREA.left + (TARGET_AREA.width - this.MAP_WIDTH) / 2;
        this.mapOffsetY = TARGET_AREA.top + (TARGET_AREA.height - this.MAP_HEIGHT) / 2;

        console.log('[DungeonMapSystem] Generated new dungeon map:', result.metadata);
    },

    // 僵尸地牢：4条路线 converging to BOSS
    _generateZombieMap() {
        const generator = new ZombieDungeonMapGenerator();
        const { nodes, edges } = generator.generate();
        this.nodes = nodes;
        this.edges = edges;
        // 更新地图尺寸
        this.MAP_WIDTH = ZOMBIE_DUNGEON_CONFIG.mapWidth;
        this.MAP_HEIGHT = ZOMBIE_DUNGEON_CONFIG.mapHeight;
        // 重新居中（使用固定目标区域，不随分辨率变化）
        const TARGET_AREA = { left: 260, top: 94, width: 1425, height: 724 };
        this.mapOffsetX = TARGET_AREA.left + (TARGET_AREA.width - this.MAP_WIDTH) / 2;
        this.mapOffsetY = TARGET_AREA.top + (TARGET_AREA.height - this.MAP_HEIGHT) / 2;
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
        // 目标显示区域（固定像素，不随分辨率变化）
        const TARGET_AREA = { left: 260, top: 94, width: 1425, height: 724 };

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
    },

    // ───────────────────────────────────────────────
    // 更新与交互
    // ───────────────────────────────────────────────
    update(dt) {
        if (!this.active || this.state !== "map") return;
        this._updateHover();
        if (Input.mouse.leftPressed) {
            this._handleClick();
        }
    },

    updateCombat(dt) {
        if (!this.active || (this.state !== "combat" && this.state !== "boss")) return;

        // Boss 战模式：委托给 BossRewardSystem 更新
        if (this.state === "boss") {
            import('./boss-reward-system.js').then(mod => {
                if (mod.BossRewardSystem && mod.BossRewardSystem.isBossBattleActive && mod.BossRewardSystem.isBossBattleActive()) {
                    mod.BossRewardSystem.update(dt);
                }
            }).catch(() => {});
            // Boss 战由 BossRewardSystem 自己的回调处理完成，这里不做额外检测
            return;
        }

        // 检测战斗完成（CombatRoomSystem 或僵尸地牢自己的系统）
        const isCombatDone = this.dungeonType === 'zombie'
            ? this._checkZombieCombatComplete()
            : CombatRoomSystem.isCombatComplete();

        if (isCombatDone) {
            // 战斗已完成，启动打扫战场倒计时
            if (!this._cleanupActive) {
                this._cleanupActive = true;
                this._cleanupTimer = 10000; // 10秒倒计时
                this._showCleanupOverlay();

                // 标记当前战斗节点为已完成（变为 empty）
                const currentNode = this.getCurrentNode();
                if (currentNode && currentNode.type === 'combat') {
                    currentNode.type = 'empty';
                    console.log('[DungeonMapSystem] Combat node completed:', currentNode.id, '-> empty');
                }
            }
        }

        // 打扫战场倒计时中
        if (this._cleanupActive) {
            this._cleanupTimer -= dt;
            if (this._cleanupTimer <= 0) {
                this._cleanupTimer = 0;
                this._cleanupActive = false;
                this._removeCleanupOverlay();
                this._cleanupCombat();
                this._returnToMap();
            } else if (this._cleanupOverlay) {
                const seconds = Math.ceil(this._cleanupTimer / 1000);
                this._cleanupOverlay.textContent = `打扫战场中... ${seconds}秒后返回地图`;
            }
            return;
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
        // 使用固定像素值（目标区域右下角），不随分辨率变化
        const FIXED_RIGHT = 1685, FIXED_BOTTOM = 818;

        // 检测退出按钮点击
        const btnX = FIXED_RIGHT - 110, btnY = 15, btnW = 90, btnH = 28;
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

        // 检查是否是已访问过的节点（empty 类型），直接返回地图
        if (node.type === 'empty') {
            this._returnToMap();
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

    _returnToMap() {
        if (this._cleanupActive) {
            console.log('[DungeonMapSystem] Cleanup countdown active, delaying return to map');
            return;
        }
        this.state = "map";
        Camera.follow = () => {};
        Camera.x = 512;
        Camera.y = 512;

        this._centerRouteMap();

        // 显示地图界面按钮
        this._createMouseShopButton();
        this._createAbandonButton();

        const current = this.getCurrentNode();
        if (current && current.type === "boss" && this.visitedNodeIds.has(current.id)) {
            this._showVictory();
        }
    },

    _enterCombat(node) {
        if (this.dungeonType === 'zombie') {
            this._enterZombieCombat(node);
            return;
        }
        // 使用新的 CombatRoomSystem 生成随机战斗场地
        this.state = "combat";
        CombatRoomSystem.enterCombatRoom(this.player, false, {
            onComplete: () => {
                this._cleanupCombat();
                this._returnToMap();
            }
        });
        // 生成普通怪物
        CombatRoomSystem.spawnMonsters(3, false);
        EffectManager.add(new FloatingTextEffect(512, 400, "进入战斗！消灭所有敌人", "#ff4444"));
    },

    _enterZombieCombat(node) {
        this._zombieCombatNode = node;
        this._zombieWaveActive = true;
        import('./zombie-dungeon.js').then(mod => {
            this._zombieCombat = new mod.ZombieDungeonCombat();
            this._spawnZombieWave();
        });
    },

    _spawnZombieWave() {
        if (!this._zombieCombat || this._zombieCombat.isComplete) {
            this._cleanupCombat();
            this._returnToMap();
            return;
        }
        this._prepareCombatMode(false);
        // 第一波时生成房间并设置玩家位置，后续波次只生成怪物
        if (this._zombieCombat.currentWave === 0) {
            this._generateRoom(false);
        }

        const wave = this._zombieCombat.currentWave;
        const total = this._zombieCombat.totalWaves;
        EffectManager.add(new FloatingTextEffect(512, 400, `第 ${wave + 1} / ${total} 波敌人来袭！`, "#ff4444"));

        import('./zombie-dungeon.js').then(mod => {
            const classes = this._zombieCombat.nextWaveMonsterClasses();
            this._spawnZombieMonsters(classes);
        });
    },

    _spawnZombieMonsters(classConfigs) {
        this._combatMonsters = [];
        this._combatMonsterKeys = [];

        const margin = 40;
        const safeMin = margin;
        const safeMax = 1024 - margin;
        const cx = 512, cy = 512;
        const entranceEdge = this._combatEntrance || 2;
        const oppositeEdge = (entranceEdge + 2) % 4;

        let minX, maxX, minY, maxY;

        if (oppositeEdge === 0) { // top
            minX = safeMin;
            maxX = safeMax;
            minY = safeMin;
            maxY = safeMin + 120;
        } else if (oppositeEdge === 2) { // bottom
            minX = safeMin;
            maxX = safeMax;
            minY = safeMax - 120;
            maxY = safeMax;
        } else if (oppositeEdge === 3) { // left
            minX = safeMin;
            maxX = safeMin + 120;
            minY = safeMin;
            maxY = safeMax;
        } else if (oppositeEdge === 1) { // right
            minX = safeMax - 120;
            maxX = safeMax;
            minY = safeMin;
            maxY = safeMax;
        }

        for (let i = 0; i < classConfigs.length; i++) {
            const mx = minX + Math.random() * (maxX - minX);
            const my = minY + Math.random() * (maxY - minY);
            const { MonsterClass, tier } = classConfigs[i];

            let monster;
            if (typeof MonsterClass === 'function' && MonsterClass.prototype && MonsterClass.prototype.constructor) {
                monster = new MonsterClass(mx, my);
            } else if (typeof MonsterClass === 'function') {
                monster = MonsterClass(mx, my);
            } else {
                console.warn('[DungeonMapSystem] Invalid monster class:', MonsterClass);
                continue;
            }

            const key = `zombie_dungeon_${Date.now()}_${i}_${Math.floor(Math.random()*1000)}`;
            Game.entities.set(key, monster);
            this._combatMonsters.push(monster);
            this._combatMonsterKeys.push(key);
        }
    },

    _enterBoss(node) {
        if (this.dungeonType === 'zombie') {
            this._enterZombieBoss(node);
            return;
        }
        this.state = "boss";
        // 使用 BossRewardSystem 的大块头 Boss
        BossRewardSystem.enterBossBattle(this.player, (result) => {
            this._cleanupCombat();
            // Boss 击败后，标记当前节点完成，并进入奖励节点
            if (node) {
                node.completed = true;
                node.type = 'empty';
            }
            this._returnToMap();
        });
        EffectManager.add(new FloatingTextEffect(512, 400, "Boss 战！", "#ff0000"));
    },

    _enterZombieBoss(node) {
        // 僵尸地牢的 Boss 战（使用波次系统）
        this._zombieCombatNode = node;
        this._zombieWaveActive = true;
        import('./zombie-dungeon.js').then(mod => {
            this._zombieCombat = new mod.ZombieDungeonCombat();
            this._spawnZombieWave();
        });
    },

    _prepareCombatMode(isBoss) {
        this.state = isBoss ? "boss" : "combat";
        this._backupWalls = [...WallSystem.walls];

        if (this._backupCameraFollow) {
            Camera.follow = this._backupCameraFollow;
        }
        if (this.player) {
            Camera.follow(this.player);
        }
    },

    _generateRoom(isBoss) {
        const worldSize = 1024;
        const margin = 20; // 边界墙壁厚度
        const safeMin = margin;
        const safeMax = worldSize - margin;
        const cx = 512, cy = 512;

        // 保留战斗场景的边界信息（用于怪物生成范围）
        this._combatRoomBounds = { minX: safeMin, maxX: safeMax, minY: safeMin, maxY: safeMax, cx, cy };

        // 随机选择玩家进入边界（0=上, 1=右, 2=下, 3=左）
        const edge = Math.floor(Math.random() * 4);
        this._combatEntrance = edge;
        const offset = 60; // 从边界向内偏移
        if (this.player) {
            if (edge === 0) { // top
                this.player.x = safeMin + Math.random() * (safeMax - safeMin);
                this.player.y = safeMin + offset;
            } else if (edge === 1) { // right
                this.player.x = safeMax - offset;
                this.player.y = safeMin + Math.random() * (safeMax - safeMin);
            } else if (edge === 2) { // bottom
                this.player.x = safeMin + Math.random() * (safeMax - safeMin);
                this.player.y = safeMax - offset;
            } else if (edge === 3) { // left
                this.player.x = safeMin + offset;
                this.player.y = safeMin + Math.random() * (safeMax - safeMin);
            }
        }

        // 不生成任何墙壁和障碍物，只保留场景边界墙壁
        WallSystem.walls = [...this._backupWalls];
        if (WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }

        // 标记 RegionIndex 需要重算
        if (typeof pathFinder !== 'undefined') {
            pathFinder.invalidateCache();
        }
    },

    _spawnMonsters(count, isBoss) {
        this._combatMonsters = [];
        this._combatMonsterKeys = [];

        const margin = 40;
        const safeMin = margin;
        const safeMax = 1024 - margin;
        const cx = 512, cy = 512;
        const entranceEdge = this._combatEntrance || 2;
        const oppositeEdge = (entranceEdge + 2) % 4;

        let minX, maxX, minY, maxY;

        if (oppositeEdge === 0) { // top
            minX = safeMin;
            maxX = safeMax;
            minY = safeMin;
            maxY = safeMin + 120;
        } else if (oppositeEdge === 2) { // bottom
            minX = safeMin;
            maxX = safeMax;
            minY = safeMax - 120;
            maxY = safeMax;
        } else if (oppositeEdge === 3) { // left
            minX = safeMin;
            maxX = safeMin + 120;
            minY = safeMin;
            maxY = safeMax;
        } else if (oppositeEdge === 1) { // right
            minX = safeMax - 120;
            maxX = safeMax;
            minY = safeMin;
            maxY = safeMax;
        }

        // 普通怪物池（从现有怪物库中选择）
        const normalMonsters = [
            BlackWolf, Rifleman, MachineGunner, FlankRifleman, ShieldBearer
        ];

        // Boss 怪物池（从现有怪物库中选择）
        const bossMonsters = [
            Commander, HumanoidMonster, BlackWolf
        ];

        for (let i = 0; i < count; i++) {
            const mx = minX + Math.random() * (maxX - minX);
            const my = minY + Math.random() * (maxY - minY);

            let monster;
            if (isBoss) {
                const MonsterClass = bossMonsters[Math.floor(Math.random() * bossMonsters.length)];
                monster = new MonsterClass(mx, my);
            } else {
                const MonsterClass = normalMonsters[Math.floor(Math.random() * normalMonsters.length)];
                monster = new MonsterClass(mx, my);
            }

            const key = `dungeon_monster_${Date.now()}_${i}_${Math.floor(Math.random()*1000)}`;
            Game.entities.set(key, monster);
            this._combatMonsters.push(monster);
            this._combatMonsterKeys.push(key);
        }
    },

    _checkZombieCombatComplete() {
        if (this.state !== "combat" && this.state !== "boss") return false;
        if (this._cleanupActive) return false;

        const allDead = this._combatMonsters.every(m => !m.active || m.hp <= 0);
        if (!allDead) return false;

        // 僵尸地牢：检查是否还有下一波
        if (this.dungeonType === 'zombie' && this.state === "combat" && this._zombieWaveActive) {
            if (this._zombieCombat && !this._zombieCombat.isComplete) {
                // 防止重复设置过渡
                if (this._waveTransitioning) return false;
                this._waveTransitioning = true;
                // 短暂延迟后生成下一波
                setTimeout(() => {
                    this._waveTransitioning = false;
                    if (this.active && this.state === "combat") {
                        this._cleanupCombatWallsOnly();
                        this._spawnZombieWave();
                    }
                }, 1500);
                return false; // 还有下一波，战斗未完成
            }
        }

        return true; // 所有怪物死亡且无下一波，战斗完成
    },

    _checkCombatComplete() {
        if (this.state !== "combat" && this.state !== "boss") return;
        if (this._cleanupActive) return;

        const allDead = this._combatMonsters.every(m => !m.active || m.hp <= 0);
        if (!allDead) return;

        // 僵尸地牢：检查是否还有下一波
        if (this.dungeonType === 'zombie' && this.state === "combat" && this._zombieWaveActive) {
            if (this._zombieCombat && !this._zombieCombat.isComplete) {
                // 防止重复设置过渡（多个setTimeout会导致_currentWave被连续增加）
                if (this._waveTransitioning) return;
                this._waveTransitioning = true;
                // 短暂延迟后生成下一波
                setTimeout(() => {
                    this._waveTransitioning = false;
                    if (this.active && this.state === "combat") {
                        this._cleanupCombatWallsOnly();
                        this._spawnZombieWave();
                    }
                }, 1500);
                return;
            }
        }

        // 所有波次/战斗完成，开始10秒打扫战场倒计时
        this._cleanupActive = true;
        this._cleanupTimer = 10000; // 10秒

        // 标记当前战斗节点为已完成（变为 empty）
        const currentNode = this.getCurrentNode();
        if (currentNode && currentNode.type === 'combat') {
            currentNode.type = 'empty';
            console.log('[DungeonMapSystem] Combat node completed:', currentNode.id, '-> empty');
        }

        const gold = this.state === "boss" ? 300 : 50 + Math.floor(Math.random() * 100);
        EffectManager.add(new FloatingTextEffect(512, 400, `战斗完成！获得 ${gold} 金币`, "#44ff44"));

        // 在上方显示倒计时提示栏
        this._showCleanupOverlay();
    },

    _cleanupCombatWallsOnly() {
        // 只清理怪物，保留战斗房间和状态（用于下一波）
        for (const key of this._combatMonsterKeys) {
            Game.entities.delete(key);
        }
        this._combatMonsters = [];
        this._combatMonsterKeys = [];
    },

    _showCleanupOverlay() {
        this._removeCleanupOverlay();

        const overlay = document.createElement("div");
        overlay.id = "dungeonCleanupOverlay";
        overlay.style.cssText = 'position:fixed;top:120px;left:50%;transform:translateX(-50%);color:#ff4444;font-size:48px;font-weight:700;text-shadow:0 2px 8px rgba(0,0,0,0.8);z-index:9000;pointer-events:none;font-family:SimHei,"Microsoft YaHei","黑体",sans-serif;';
        overlay.textContent = `打扫战场中... 10秒后返回地图`;
        document.body.appendChild(overlay);
        this._cleanupOverlay = overlay;
    },

    _removeCleanupOverlay() {
        if (this._cleanupOverlay) {
            this._cleanupOverlay.remove();
            this._cleanupOverlay = null;
        }
    },

    _cleanupCombat() {
        // 使用 CombatRoomSystem 清理战斗场地
        if (CombatRoomSystem.active) {
            CombatRoomSystem.cleanupRoom();
        }

        for (const key of this._combatMonsterKeys) {
            Game.entities.delete(key);
        }
        this._combatMonsters = [];
        this._combatMonsterKeys = [];
        this._combatRoomWalls = [];
        this._combatRoomObstacles = [];
        this._combatEntrance = null;
        this._zombieWaveActive = false;
        this._zombieCombat = null;
        this._zombieCombatNode = null;
        this._waveTransitioning = false;
        this._cleanupActive = false;
        this._cleanupTimer = 0;
        this._removeCleanupOverlay();

        // 战斗完成后消耗女神祝福层数
        import('./dungeon-event-system.js').then(mod => {
            if (mod.onCombatComplete) mod.onCombatComplete(this.player);
        }).catch(() => {});

        // [NEW] 墙壁恢复后标记 RegionIndex 需要重算
        if (typeof pathFinder !== 'undefined') {
            pathFinder.invalidateCache();
        }
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

        const checkInterval = setInterval(() => {
            if (!ShopSystem._isOpen) {
                clearInterval(checkInterval);
                this._returnToMap();
            }
        }, 300);
    },

    _enterReward(node) {
        this.state = "reward";
        // 使用 BossRewardSystem 的奖励节点管理器
        BossRewardSystem.enterRewardNode(this.player, () => {
            this._returnToMap();
        });
    },

    _enterZombieShop(node) {
        this.state = "shop";
        import('./zombie-dungeon.js').then(mod => {
            mod.ZombieDungeonShop.open();
            const checkInterval = setInterval(() => {
                if (mod.ZombieDungeonShop.isClosed()) {
                    clearInterval(checkInterval);
                    this._returnToMap();
                }
            }, 300);
        });
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
    _enterLegacyEvent(node) {
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
    },

    // ───────────────────────────────────────────────
    // 渲染：整张大地图，可拖动 + 缩放
    // ───────────────────────────────────────────────
    render(ctx) {
        if (!this.active || this.state !== "map") return;

        // 使用固定像素值，不随分辨率变化
        const FIXED_WIDTH = 1920, FIXED_HEIGHT = 1080;
        const FIXED_RIGHT = 1685, FIXED_BOTTOM = 818;
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
            let color = "#2a2a2a";
            let borderColor = "#1a1a1a";
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
        // 标题和提示区域背景框（固定在指定位置 761,66 到 1156,133）
        ctx.fillStyle = "rgba(20, 18, 14, 0.85)";
        ctx.fillRect(761, 66, 395, 67);
        ctx.strokeStyle = "rgba(90, 74, 58, 0.6)";
        ctx.lineWidth = 1;
        ctx.strokeRect(761, 66, 395, 67);

        // 标题
        ctx.fillStyle = "#d4c5a9";
        ctx.font = '22px SimHei, "Microsoft YaHei", sans-serif';
        ctx.textAlign = "center";
        const dungeonTitle = this.dungeonType === 'zombie' ? '⚔ 僵尸地牢 — 选择你的道路' : '⚔ 地牢深处 — 选择你的道路';
        ctx.fillText(dungeonTitle, 958.5, 90);

        // 提示文字
        ctx.fillStyle = "#888888";
        ctx.font = "14px sans-serif";
        ctx.fillText("点击发光的相邻节点前进", 958.5, 115);

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
        if (document.getElementById('mouseShopButton')) return;
        const btn = document.createElement('div');
        btn.id = 'mouseShopButton';
        btn.textContent = '小鼠商店';
        btn.style.cssText = `
            position: fixed;
            left: 26.25vw;
            bottom: 20px;
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
        const btn = document.getElementById('mouseShopButton');
        if (btn) btn.remove();
    },

    _createAbandonButton() {
        if (document.getElementById('abandonButton')) return;
        const btn = document.createElement('div');
        btn.id = 'abandonButton';
        btn.textContent = '放弃并返回';
        btn.style.cssText = `
            position: fixed;
            left: 64.11vw;
            bottom: 20px;
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
    },

    _removeAbandonButton() {
        const btn = document.getElementById('abandonButton');
        if (btn) btn.remove();
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

        const btn = document.getElementById("dungeonVictoryBtn");
        btn.onmouseenter = () => btn.style.background = "#5a7a4a";
        btn.onmouseleave = () => btn.style.background = "#4a6a3a";
        btn.onclick = async () => {
            console.log('[DungeonMapSystem] Victory button clicked');
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
                console.log('[DungeonMapSystem] Successfully returned to main');
            } catch (err) {
                console.error('[DungeonMapSystem] Failed to return to main:', err);
                alert('返回主神空间失败: ' + (err.message || '未知错误'));
            }
        };
    },

    _showExitConfirm() {
        if (document.getElementById("dungeonExitConfirm")) return;

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

        const confirmBtn = document.getElementById("dungeonExitConfirmBtn");
        const cancelBtn = document.getElementById("dungeonExitCancelBtn");

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
        if (document.getElementById("dungeonEntryConfirm")) return;
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

            const confirmBtn = document.getElementById("dungeonEntryConfirmBtn");
            const cancelBtn = document.getElementById("dungeonEntryCancelBtn");

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
