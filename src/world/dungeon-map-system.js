/**
 * ============================================================
 * DungeonMapSystem — 地牢地图系统（杀戮尖塔风格 · 可拖动大地图）
 * ============================================================
 *
 * 集成点（3 处）：
 *   1. scene-manager.js _loadScene6() 末尾：DungeonMapSystem.init("scene6", player)
 *   2. game.js update() 开头：拦截地图模式，让 DungeonMapSystem 接管
 *   3. game.js render() 开头：拦截地图模式，渲染节点网格而非游戏实体
 *
 * 依赖（全局）：
 *   Renderer, Camera, WallSystem, Game, Input, EffectManager,
 *   ShopSystem, NPCDialogue, SceneManager, CONFIG, Enemy, FloatingTextEffect
 */

/**
 * ============================================================
 * DungeonMapSystem — 地牢地图系统（杀戮尖塔风格 · 可拖动大地图）
 * ============================================================
 *
 * 集成点（3 处）：
 *   1. scene-manager.js _loadScene6() 末尾：DungeonMapSystem.init("scene6", player)
 *   2. game.js update() 开头：拦截地图模式，让 DungeonMapSystem 接管
 *   3. game.js render() 开头：拦截地图模式，渲染节点网格而非游戏实体
 *
 * 依赖（全局）：
 *   Renderer, Camera, WallSystem, Game, Input, EffectManager,
 *   ShopSystem, NPCDialogue, SceneManager, CONFIG, Enemy, FloatingTextEffect
 */

import {
    BlackWolf,
    HumanoidMonster, Commander, MachineGunner, Rifleman, FlankRifleman, ShieldBearer
} from '../entities/enemy-types.js';

export const DungeonMapSystem = {
    active: false,
    state: "idle",
    player: null,
    sceneId: null,

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
        shop:   "#3a5a7a",
        event:  "#6a5a3a",
        boss:   "#7a0000",
    },
    TYPE_BORDER_COLORS: {
        start:  "#6aca6a",
        combat: "#aa5a5a",
        shop:   "#5a8aaa",
        event:  "#9a8a5a",
        boss:   "#aa0000",
    },
    TYPE_ICONS: {
        start:  "▶",
        combat: "⚔",
        shop:   "🏪",
        event:  "?",
        boss:   "☠",
    },

    COMBAT_ROOM_SIZE: 420,
    BOSS_ROOM_SIZE:   520,
    WALL_THICKNESS:   24,

    _backupWalls: [],
    _backupCameraFollow: null,
    _combatMonsters: [],
    _combatMonsterKeys: [],
    _combatRoomWalls: [],
    _combatCheckTimer: 0,
    _eventOverlay: null,

    init(sceneId, player) {
        this.active = true;
        this.state = "map";
        this.sceneId = sceneId;
        this.player = player;
        this.currentNodeId = null;
        this.visitedNodeIds.clear();
        this.hoveredNodeId = null;
        this._combatMonsters = [];
        this._combatMonsterKeys = [];
        this._combatRoomWalls = [];
        this._combatCheckTimer = 0;

        // 重置地图位置：居中显示
        this.mapOffsetX = (CONFIG.VIEW_WIDTH - this.MAP_WIDTH) / 2;
        this.mapOffsetY = (CONFIG.VIEW_HEIGHT - this.MAP_HEIGHT) / 2;
        this.mapScale = 1.0;
        this.isDragging = false;

        this.generateMap();

        const startNode = this.nodes.find(n => n.type === "start");
        if (startNode) {
            this.currentNodeId = startNode.id;
            this.visitedNodeIds.add(startNode.id);
        }

        this._backupCameraFollow = Camera.follow.bind(Camera);
        Camera.follow = () => {};
        Camera.x = 512;
        Camera.y = 512;

        this._bindEvents();

        console.log("[DungeonMapSystem] Initialized", this.nodes.length, "nodes,", this.edges.length, "edges");
    },

    shutdown() {
        this.active = false;
        this.state = "idle";
        this.nodes = [];
        this.edges = [];
        this._cleanupEventUI();
        this._unbindEvents();

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
            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            this.dragStartOffsetX = this.mapOffsetX;
            this.dragStartOffsetY = this.mapOffsetY;
            this._mouseDownTime = Date.now();
            this._mouseDownPos = { x: e.clientX, y: e.clientY };
        };
        const onMouseMove = (e) => {
            if (this.isDragging) {
                const dx = e.clientX - this.dragStartX;
                const dy = e.clientY - this.dragStartY;
                this.mapOffsetX = this.dragStartOffsetX + dx;
                this.mapOffsetY = this.dragStartOffsetY + dy;
            }
        };
        const onMouseUp = () => {
            this.isDragging = false;
        };
        const onWheel = (e) => {
            e.preventDefault();
            const zoomSpeed = 0.001;
            const oldScale = this.mapScale;
            let newScale = oldScale - e.deltaY * zoomSpeed;
            newScale = Math.max(0.4, Math.min(2.0, newScale));

            // 以鼠标位置为中心缩放
            const mx = e.clientX;
            const my = e.clientY;
            const scaleRatio = newScale / oldScale;
            this.mapOffsetX = mx - (mx - this.mapOffsetX) * scaleRatio;
            this.mapOffsetY = my - (my - this.mapOffsetY) * scaleRatio;
            this.mapScale = newScale;
        };

        canvas.addEventListener("mousedown", onMouseDown);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        canvas.addEventListener("wheel", onWheel, { passive: false });

        this._eventListeners = [
            { el: canvas, type: "mousedown", fn: onMouseDown },
            { el: window, type: "mousemove", fn: onMouseMove },
            { el: window, type: "mouseup",   fn: onMouseUp },
            { el: canvas, type: "wheel",     fn: onWheel },
        ];
    },

    _unbindEvents() {
        for (const { el, type, fn } of this._eventListeners) {
            el.removeEventListener(type, fn);
        }
        this._eventListeners = [];
    },

    // ───────────────────────────────────────────────
    // 地图生成：3行 × N列 的直线矩阵（暗黑地牢风格）
    // ───────────────────────────────────────────────
    generateMap() {
        this.nodes = [];
        this.edges = [];

        const ROWS = 3;
        const COLS = this.COLUMN_COUNT;
        const colSpacing = this.MAP_WIDTH / (COLS + 1);
        const rowSpacing = this.MAP_HEIGHT / (ROWS + 1);

        // 类型分布
        const colTypes = [
            "start",  "combat", "event",  "combat", "shop",
            "combat", "event",  "combat", "shop",   "combat",
            "boss",   "boss"
        ];

        // 生成节点：固定网格，每列中间行(row=1)必须存在，确保主通道始终连通
        for (let col = 0; col < COLS; col++) {
            const type = colTypes[col] || "combat";
            let selectedRows = [1]; // 中间行必须有

            if (col > 0 && col < COLS - 1) {
                // 中间列随机添加额外行（row=0 为上，row=2 为下）
                if (Math.random() > 0.4) selectedRows.push(0);
                if (Math.random() > 0.4) selectedRows.push(2);
            }

            // 去重并排序
            selectedRows = [...new Set(selectedRows)].sort((a, b) => a - b);

            for (const row of selectedRows) {
                const x = colSpacing * (col + 1);
                const y = rowSpacing * (row + 1);

                this.nodes.push({
                    id: `node_${col}_${row}`,
                    col, row, x, y, type,
                });
            }
        }

        // 生成垂直边：同一列的相邻行之间（双向，可上下移动）
        for (let col = 0; col < COLS; col++) {
            const colNodes = this.nodes.filter(n => n.col === col).sort((a, b) => a.row - b.row);
            for (let i = 0; i < colNodes.length - 1; i++) {
                this.edges.push({ from: colNodes[i].id, to: colNodes[i + 1].id });
                this.edges.push({ from: colNodes[i + 1].id, to: colNodes[i].id });
            }
        }

        // 生成水平边：相邻列的同一行之间（单向，只能向右前进）
        for (let col = 0; col < COLS - 1; col++) {
            const colNodes = this.nodes.filter(n => n.col === col);
            const nextColNodes = this.nodes.filter(n => n.col === col + 1);

            for (const node of colNodes) {
                const nextNode = nextColNodes.find(n => n.row === node.row);
                if (nextNode) {
                    this.edges.push({ from: node.id, to: nextNode.id });
                }
            }
        }

        // 保险：确保相邻列之间至少有一条横向连接（主通道 row=1 始终存在，通常不会触发）
        for (let col = 0; col < COLS - 1; col++) {
            const hasHorizontal = this.edges.some(e => {
                const fromNode = this.nodes.find(n => n.id === e.from);
                const toNode = this.nodes.find(n => n.id === e.to);
                return fromNode && toNode && fromNode.col === col && toNode.col === col + 1;
            });
            if (!hasHorizontal) {
                const colNodes = this.nodes.filter(n => n.col === col);
                const nextColNodes = this.nodes.filter(n => n.col === col + 1);
                if (colNodes.length > 0 && nextColNodes.length > 0) {
                    const c = colNodes[0];
                    const n = nextColNodes.reduce((best, curr) =>
                        Math.abs(curr.row - c.row) < Math.abs(best.row - c.row) ? curr : best
                    );
                    this.edges.push({ from: c.id, to: n.id });
                }
            }
        }
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
        this._combatCheckTimer += dt;
        if (this._combatCheckTimer >= 500) {
            this._combatCheckTimer = 0;
            this._checkCombatComplete();
        }
    },

    _updateHover() {
        const mx = Input.mouse.x;
        const my = Input.mouse.y;
        const mapPos = this._screenToMap(mx, my);
        this.hoveredNodeId = null;

        const available = this.getAvailableNodes();
        for (const node of available) {
            const dist = Math.sqrt((mapPos.x - node.x) ** 2 + (mapPos.y - node.y) ** 2);
            if (dist < (this.NODE_RADIUS + 10) * this.mapScale) {
                this.hoveredNodeId = node.id;
                break;
            }
        }
        document.body.style.cursor = this.hoveredNodeId ? "pointer" : "default";
    },

    _handleClick() {
        // 区分点击和拖动：如果移动超过 5px 或时间超过 200ms，视为拖动
        const dx = Input.mouse.x - this._mouseDownPos.x;
        const dy = Input.mouse.y - this._mouseDownPos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const time = Date.now() - this._mouseDownTime;
        if (dist > 5 || time > 200) return; // 拖动，不触发点击

        // 检测退出按钮点击
        const w = CONFIG.VIEW_WIDTH;
        const btnX = w - 110, btnY = 15, btnW = 90, btnH = 28;
        const mx = Input.mouse.x, my = Input.mouse.y;
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
        this.currentNodeId = node.id;
        this.visitedNodeIds.add(node.id);

        switch (node.type) {
            case "combat": this._enterCombat(node); break;
            case "boss":   this._enterBoss(node); break;
            case "shop":   this._enterShop(node); break;
            case "event":  this._enterEvent(node); break;
            default:       this._returnToMap(); break;
        }
    },

    _returnToMap() {
        this.state = "map";
        Camera.follow = () => {};
        Camera.x = 512;
        Camera.y = 512;

        const current = this.getCurrentNode();
        if (current && current.type === "boss" && this.visitedNodeIds.has(current.id)) {
            this._showVictory();
        }
    },

    _enterCombat(node) {
        this._prepareCombatMode(false);
        this._generateRoom(false);
        this._spawnMonsters(3, false);
        EffectManager.add(new FloatingTextEffect(512, 400, "进入战斗！消灭所有敌人", "#ff4444"));
    },

    _enterBoss(node) {
        this._prepareCombatMode(true);
        this._generateRoom(true);
        this._spawnMonsters(1, true);
        EffectManager.add(new FloatingTextEffect(512, 400, "Boss 战！", "#ff0000"));
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
        const roomSize = isBoss ? this.BOSS_ROOM_SIZE : this.COMBAT_ROOM_SIZE;
        const t = this.WALL_THICKNESS;
        const cx = 512, cy = 512;
        const half = roomSize / 2;
        const rx = cx - half;
        const ry = cy - half;
        const entranceW = 100;
        const entranceX = cx - entranceW / 2;

        const walls = [
            { x: rx, y: ry, w: roomSize, h: t },
            { x: rx, y: ry + t, w: t, h: roomSize - t * 2 },
            { x: rx + roomSize - t, y: ry + t, w: t, h: roomSize - t * 2 },
            { x: rx, y: ry + roomSize - t, w: entranceX - rx, h: t },
            { x: entranceX + entranceW, y: ry + roomSize - t, w: rx + roomSize - (entranceX + entranceW), h: t },
        ];

        this._combatRoomWalls = walls;
        WallSystem.walls = walls;

        if (WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }

        if (this.player) {
            this.player.x = cx;
            this.player.y = ry + roomSize - t - 60;
        }
    },

    _spawnMonsters(count, isBoss) {
        this._combatMonsters = [];
        this._combatMonsterKeys = [];

        const roomSize = isBoss ? this.BOSS_ROOM_SIZE : this.COMBAT_ROOM_SIZE;
        const half = roomSize / 2;
        const margin = 70;
        const minX = 512 - half + margin;
        const maxX = 512 + half - margin;
        const minY = 512 - half + margin;
        const maxY = 512 + half - 140;

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

    _checkCombatComplete() {
        if (this.state !== "combat" && this.state !== "boss") return;

        const allDead = this._combatMonsters.every(m => !m.active || m.hp <= 0);
        if (!allDead) return;

        const gold = this.state === "boss" ? 300 : 50 + Math.floor(Math.random() * 100);
        EffectManager.add(new FloatingTextEffect(512, 400, `战斗完成！获得 ${gold} 金币`, "#44ff44"));

        this._cleanupCombat();
        this._returnToMap();
    },

    _cleanupCombat() {
        for (const key of this._combatMonsterKeys) {
            Game.entities.delete(key);
        }
        this._combatMonsters = [];
        this._combatMonsterKeys = [];
        this._combatRoomWalls = [];

        WallSystem.walls = [...this._backupWalls];
        if (WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }
    },

    _enterShop(node) {
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

    _enterEvent(node) {
        this.state = "event";
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

        const w = CONFIG.VIEW_WIDTH;
        const h = CONFIG.VIEW_HEIGHT;
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
                color = this.TYPE_COLORS[node.type] || "#3a3a3a";
                borderColor = this.TYPE_BORDER_COLORS[node.type] || "#aaaaaa";
                glow = true;
            } else {
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
            const icon = this.TYPE_ICONS[node.type] || "•";
            ctx.fillStyle = isAvailable || isCurrent ? "#ffffff" : "#555555";
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
        // 标题
        ctx.fillStyle = "#d4c5a9";
        ctx.font = '22px SimHei, "Microsoft YaHei", sans-serif';
        ctx.textAlign = "center";
        ctx.fillText("⚔ 地牢深处 — 选择你的道路", w / 2, 40);

        // 提示文字
        ctx.fillStyle = "#888888";
        ctx.font = "14px sans-serif";
        ctx.fillText("点击发光的相邻节点前进 · 拖动地图 · 滚轮缩放", w / 2, 68);

        // 进度
        const progress = `${this.visitedNodeIds.size} / ${this.nodes.length}`;
        ctx.fillStyle = "#666666";
        ctx.font = "13px sans-serif";
        ctx.fillText(`进度: ${progress} 节点`, w / 2, h - 20);

        // 缩放指示
        ctx.fillStyle = "#444444";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(`${Math.round(this.mapScale * 100)}%`, w - 20, h - 20);
        ctx.textAlign = "center";

        // 退出按钮
        const btnX = w - 110, btnY = 15, btnW = 90, btnH = 28;
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
