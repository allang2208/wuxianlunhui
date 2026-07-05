/**
 * DungeonGenerator - 挺进地牢风格的 Flow + 房间模板地牢生成器
 * 
 * 设计理念：
 * 1. Flow 模板：预定义房间类型序列和连接关系（抽象的图结构）
 * 2. 房间模板：每个类型有多个变体，含尺寸、出口、障碍物参数
 * 3. 布局算法：根据出口位置计算房间坐标，生成走廊连接
 * 4. 输出：WallSystem.walls + terrainTexture Canvas
 */

export class DungeonGenerator {
    constructor() {
        this._initFlowTemplates();
        this._initRoomTemplates();
    }

    // ==================== Flow 模板（5个） ====================
    _initFlowTemplates() {
        this.flowTemplates = [
            // Flow 1: 线性3房（最简单，适合第一层）
            {
                name: 'Linear3',
                weight: 20,
                rooms: [
                    { type: 'start', required: true },
                    { type: 'combat', required: true },
                    { type: 'combat', required: true },
                ],
                connections: [
                    ['room0.east', 'room1.west'],
                    ['room1.east', 'room2.west'],
                ]
            },
            // Flow 2: 线性4房 + 1奖励分支
            {
                name: 'Linear4Branch',
                weight: 25,
                rooms: [
                    { type: 'start', required: true },
                    { type: 'combat', required: true },
                    { type: 'hub', required: true },
                    { type: 'combat', required: true },
                    { type: 'reward', required: false }, // 注入：从 hub 分支
                ],
                connections: [
                    ['room0.east', 'room1.west'],
                    ['room1.east', 'room2.west'],
                    ['room2.east', 'room3.west'],
                    ['room2.south', 'room4.north'], // 奖励分支
                ]
            },
            // Flow 3: 十字 Hub（4个方向）
            {
                name: 'CrossHub',
                weight: 20,
                rooms: [
                    { type: 'start', required: true },
                    { type: 'hub', required: true },
                    { type: 'combat', required: true },
                    { type: 'combat', required: true },
                    { type: 'combat', required: true },
                ],
                connections: [
                    ['room0.east', 'room1.west'], // start -> hub
                    ['room1.north', 'room2.south'], // hub -> combat
                    ['room1.east', 'room3.west'], // hub -> combat
                    ['room1.south', 'room4.north'], // hub -> combat
                ]
            },
            // Flow 4: 4房循环
            {
                name: 'Loop4',
                weight: 20,
                rooms: [
                    { type: 'start', required: true },
                    { type: 'combat', required: true },
                    { type: 'combat', required: true },
                    { type: 'combat', required: true },
                    { type: 'reward', required: false }, // 注入：从某房分支
                ],
                connections: [
                    ['room0.east', 'room1.west'],
                    ['room1.east', 'room2.west'],
                    ['room2.south', 'room3.north'], // 转弯
                    ['room3.west', 'room0.south'], // 闭合循环
                    ['room2.east', 'room4.west'], // 奖励分支
                ]
            },
            // Flow 5: 5房大循环 + Boss
            {
                name: 'Loop5Boss',
                weight: 15,
                rooms: [
                    { type: 'start', required: true },
                    { type: 'combat', required: true },
                    { type: 'hub', required: true },
                    { type: 'combat', required: true },
                    { type: 'combat', required: true },
                    { type: 'boss', required: true }, // 从 hub 分支
                    { type: 'reward', required: false }, // 注入
                ],
                connections: [
                    ['room0.east', 'room1.west'],
                    ['room1.east', 'room2.west'],
                    ['room2.east', 'room3.west'],
                    ['room3.south', 'room4.north'],
                    ['room4.west', 'room0.south'], // 闭合
                    ['room2.north', 'room5.south'], // Boss 分支
                    ['room3.east', 'room6.west'], // 奖励分支
                ]
            }
        ];
    }

    // ==================== 房间模板 ====================
    _initRoomTemplates() {
        this.roomTemplates = {
            // 起始房：3个变体（不同起始方向）
            start: [
                {
                    name: 'start_east',
                    width: { min: 500, max: 600 },
                    height: { min: 400, max: 500 },
                    exits: [
                        { dir: 'east', offset: 0.5, width: 140 }
                    ],
                    obstacles: [],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                },
                {
                    name: 'start_south',
                    width: { min: 500, max: 600 },
                    height: { min: 400, max: 500 },
                    exits: [
                        { dir: 'south', offset: 0.5, width: 140 }
                    ],
                    obstacles: [],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                },
                {
                    name: 'start_east_south',
                    width: { min: 500, max: 600 },
                    height: { min: 400, max: 500 },
                    exits: [
                        { dir: 'east', offset: 0.5, width: 140 },
                        { dir: 'south', offset: 0.5, width: 140 }
                    ],
                    obstacles: [],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                }
            ],
            // 战斗房：5个变体
            combat: [
                {
                    name: 'combat_small',
                    width: { min: 500, max: 600 },
                    height: { min: 400, max: 500 },
                    exits: [
                        { dir: 'west', offset: 0.5, width: 120 },
                        { dir: 'east', offset: 0.5, width: 120 }
                    ],
                    obstacles: [
                        { type: 'pillar', count: { min: 2, max: 3 }, size: 30, spacing: 120 },
                    ],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                },
                {
                    name: 'combat_medium',
                    width: { min: 600, max: 700 },
                    height: { min: 500, max: 600 },
                    exits: [
                        { dir: 'west', offset: 0.5, width: 120 },
                        { dir: 'east', offset: 0.5, width: 120 },
                        { dir: 'south', offset: 0.5, width: 120 }
                    ],
                    obstacles: [
                        { type: 'pillar', count: { min: 3, max: 5 }, size: 30, spacing: 100 },
                        { type: 'barrel', count: { min: 1, max: 3 }, size: 20, spacing: 80 },
                    ],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                },
                {
                    name: 'combat_wide',
                    width: { min: 700, max: 800 },
                    height: { min: 400, max: 500 },
                    exits: [
                        { dir: 'west', offset: 0.5, width: 140 },
                        { dir: 'east', offset: 0.5, width: 140 },
                        { dir: 'north', offset: 0.5, width: 100 }
                    ],
                    obstacles: [
                        { type: 'pillar', count: { min: 2, max: 4 }, size: 35, spacing: 150 },
                    ],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                },
                {
                    name: 'combat_narrow',
                    width: { min: 450, max: 550 },
                    height: { min: 600, max: 700 },
                    exits: [
                        { dir: 'west', offset: 0.5, width: 120 },
                        { dir: 'east', offset: 0.5, width: 120 },
                        { dir: 'north', offset: 0.5, width: 100 },
                        { dir: 'south', offset: 0.5, width: 100 }
                    ],
                    obstacles: [
                        { type: 'pillar', count: { min: 2, max: 3 }, size: 25, spacing: 130 },
                    ],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                },
                {
                    name: 'combat_large',
                    width: { min: 700, max: 800 },
                    height: { min: 600, max: 700 },
                    exits: [
                        { dir: 'west', offset: 0.5, width: 140 },
                        { dir: 'east', offset: 0.5, width: 140 },
                        { dir: 'north', offset: 0.5, width: 120 },
                        { dir: 'south', offset: 0.5, width: 120 }
                    ],
                    obstacles: [
                        { type: 'pillar', count: { min: 4, max: 6 }, size: 35, spacing: 120 },
                        { type: 'barrel', count: { min: 2, max: 4 }, size: 20, spacing: 80 },
                    ],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                }
            ],
            // 枢纽房：3个变体
            hub: [
                {
                    name: 'hub_small',
                    width: { min: 600, max: 700 },
                    height: { min: 500, max: 600 },
                    exits: [
                        { dir: 'west', offset: 0.5, width: 140 },
                        { dir: 'east', offset: 0.5, width: 140 },
                        { dir: 'north', offset: 0.5, width: 120 },
                        { dir: 'south', offset: 0.5, width: 120 }
                    ],
                    obstacles: [
                        { type: 'pillar', count: { min: 1, max: 2 }, size: 40, spacing: 200 },
                    ],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                },
                {
                    name: 'hub_medium',
                    width: { min: 700, max: 800 },
                    height: { min: 600, max: 700 },
                    exits: [
                        { dir: 'west', offset: 0.4, width: 120 },
                        { dir: 'west', offset: 0.6, width: 120 },
                        { dir: 'east', offset: 0.4, width: 120 },
                        { dir: 'east', offset: 0.6, width: 120 },
                        { dir: 'north', offset: 0.5, width: 140 },
                        { dir: 'south', offset: 0.5, width: 140 }
                    ],
                    obstacles: [
                        { type: 'pillar', count: { min: 2, max: 3 }, size: 40, spacing: 180 },
                    ],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                },
                {
                    name: 'hub_large',
                    width: { min: 800, max: 900 },
                    height: { min: 700, max: 800 },
                    exits: [
                        { dir: 'west', offset: 0.33, width: 120 },
                        { dir: 'west', offset: 0.66, width: 120 },
                        { dir: 'east', offset: 0.33, width: 120 },
                        { dir: 'east', offset: 0.66, width: 120 },
                        { dir: 'north', offset: 0.33, width: 120 },
                        { dir: 'north', offset: 0.66, width: 120 },
                        { dir: 'south', offset: 0.5, width: 140 }
                    ],
                    obstacles: [
                        { type: 'pillar', count: { min: 3, max: 5 }, size: 45, spacing: 160 },
                    ],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                }
            ],
            // 奖励房：4个变体（不同入口方向）
            reward: [
                {
                    name: 'reward_north',
                    width: { min: 300, max: 400 },
                    height: { min: 300, max: 400 },
                    exits: [
                        { dir: 'north', offset: 0.5, width: 100 }
                    ],
                    obstacles: [],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                    special: { type: 'chest', count: 1 }
                },
                {
                    name: 'reward_west',
                    width: { min: 300, max: 400 },
                    height: { min: 300, max: 400 },
                    exits: [
                        { dir: 'west', offset: 0.5, width: 100 }
                    ],
                    obstacles: [],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                    special: { type: 'chest', count: 1 }
                },
                {
                    name: 'reward_east',
                    width: { min: 300, max: 400 },
                    height: { min: 300, max: 400 },
                    exits: [
                        { dir: 'east', offset: 0.5, width: 100 }
                    ],
                    obstacles: [],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                    special: { type: 'chest', count: 1 }
                },
                {
                    name: 'reward_wide',
                    width: { min: 400, max: 500 },
                    height: { min: 300, max: 350 },
                    exits: [
                        { dir: 'north', offset: 0.5, width: 120 }
                    ],
                    obstacles: [
                        { type: 'barrel', count: { min: 1, max: 2 }, size: 20, spacing: 100 },
                    ],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                    special: { type: 'chest', count: 2 }
                }
            ],
            // Boss房：2个变体
            boss: [
                {
                    name: 'boss_arena',
                    width: { min: 800, max: 900 },
                    height: { min: 700, max: 800 },
                    exits: [
                        { dir: 'south', offset: 0.5, width: 140 }
                    ],
                    obstacles: [
                        { type: 'pillar', count: { min: 2, max: 4 }, size: 45, spacing: 200 },
                    ],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                },
                {
                    name: 'boss_chamber',
                    width: { min: 700, max: 800 },
                    height: { min: 800, max: 900 },
                    exits: [
                        { dir: 'south', offset: 0.5, width: 140 },
                        { dir: 'east', offset: 0.5, width: 100 }
                    ],
                    obstacles: [
                        { type: 'pillar', count: { min: 3, max: 5 }, size: 40, spacing: 170 },
                    ],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                }
            ],
            // 连接房：2个变体
            connector: [
                {
                    name: 'connector_h',
                    width: { min: 200, max: 250 },
                    height: { min: 120, max: 150 },
                    exits: [
                        { dir: 'west', offset: 0.5, width: 100 },
                        { dir: 'east', offset: 0.5, width: 100 }
                    ],
                    obstacles: [],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                },
                {
                    name: 'connector_v',
                    width: { min: 120, max: 150 },
                    height: { min: 200, max: 250 },
                    exits: [
                        { dir: 'north', offset: 0.5, width: 100 },
                        { dir: 'south', offset: 0.5, width: 100 }
                    ],
                    obstacles: [],
                    floorColor: '#1a1a1a',
                    wallThickness: 20,
                }
            ]
        };
    }

    // ==================== 主生成入口 ====================
    generate(seed = null) {
        if (seed !== null) this._seed = seed;

        // 1. 选择 Flow 模板
        const flow = this._pickFlow();

        // 2. 为每个房间节点选择具体模板
        const roomInstances = this._pickRoomTemplates(flow);

        // 3. 计算房间实际尺寸和出口位置
        this._finalizeRooms(roomInstances);

        // 4. 根据连接关系布局房间
        const layout = this._layoutRooms(flow, roomInstances);

        // 5. 生成走廊连接
        const corridors = this._generateCorridors(flow, layout);

        // 6. 生成墙壁
        const walls = this._generateWalls(layout, corridors);

        // 7. 生成地形 Canvas
        const terrainCanvas = this._generateTerrain(layout, corridors);

        // 8. 计算地图边界
        const bounds = this._computeBounds(layout, corridors);

        return {
            flow: flow.name,
            rooms: layout,
            corridors,
            walls,
            terrainCanvas,
            bounds,
            playerStart: this._getPlayerStart(layout)
        };
    }

    // ==================== 内部方法 ====================

    _pickFlow() {
        const totalWeight = this.flowTemplates.reduce((sum, f) => sum + f.weight, 0);
        let roll = Math.random() * totalWeight;
        for (const flow of this.flowTemplates) {
            roll -= flow.weight;
            if (roll <= 0) return flow;
        }
        return this.flowTemplates[0];
    }

    _pickRoomTemplates(flow) {
        // 解析每个房间需要的出口方向
        const requiredExits = new Map();
        for (const conn of flow.connections) {
            const [fromRef, toRef] = conn;
            const fromMatch = fromRef.match(/^room(\d+)\.(\w+)$/);
            const toMatch = toRef.match(/^room(\d+)\.(\w+)$/);
            if (!fromMatch || !toMatch) continue;
            const fromIdx = parseInt(fromMatch[1]);
            const toIdx = parseInt(toMatch[1]);
            const fromDir = fromMatch[2];
            const toDir = toMatch[2];
            if (!requiredExits.has(fromIdx)) requiredExits.set(fromIdx, new Set());
            if (!requiredExits.has(toIdx)) requiredExits.set(toIdx, new Set());
            requiredExits.get(fromIdx).add(fromDir);
            requiredExits.get(toIdx).add(toDir);
        }

        return flow.rooms.map((node, index) => {
            const pool = this.roomTemplates[node.type];
            if (!pool || pool.length === 0) {
                console.error(`[DungeonGenerator] No templates for room type: ${node.type}`);
                return null;
            }
            // 筛选满足出口方向要求的模板
            const needed = requiredExits.get(index);
            let validPool = pool;
            if (needed && needed.size > 0) {
                validPool = pool.filter(t => {
                    const templateDirs = new Set(t.exits.map(e => e.dir));
                    for (const dir of needed) {
                        if (!templateDirs.has(dir)) return false;
                    }
                    return true;
                });
                if (validPool.length === 0) {
                    console.warn(`[DungeonGenerator] No ${node.type} template satisfies exits [${Array.from(needed).join(',')}], falling back to full pool`);
                    validPool = pool;
                }
            }
            const template = validPool[Math.floor(Math.random() * validPool.length)];
            return {
                id: `room${index}`,
                type: node.type,
                template: { ...template }, // 深拷贝
                x: 0, y: 0, width: 0, height: 0,
                exits: [] // 将存储实际出口坐标
            };
        }).filter(r => r !== null);
    }

    _finalizeRooms(rooms) {
        for (const room of rooms) {
            const t = room.template;
            room.width = this._randRange(t.width.min, t.width.max);
            room.height = this._randRange(t.height.min, t.height.max);
            // 计算出口在房间边界上的实际坐标（相对于房间左上角）
            room.exits = t.exits.map(e => ({
                dir: e.dir,
                width: e.width,
                x: this._computeExitX(e.dir, e.offset, room.width),
                y: this._computeExitY(e.dir, e.offset, room.height)
            }));
        }
    }

    _computeExitX(dir, offset, width) {
        if (dir === 'west') return 0;
        if (dir === 'east') return width;
        return width * offset; // north/south
    }

    _computeExitY(dir, offset, height) {
        if (dir === 'north') return 0;
        if (dir === 'south') return height;
        return height * offset; // west/east
    }

    _layoutRooms(flow, rooms) {
        const placed = new Map(); // roomId -> {x, y, room}
        const toPlace = [...rooms];

        // 起始房放在 (0, 0)
        const startRoom = toPlace.find(r => r.type === 'start');
        if (startRoom) {
            startRoom.x = 0;
            startRoom.y = 0;
            placed.set(startRoom.id, { x: 0, y: 0, room: startRoom });
        }

        // 根据连接关系依次放置
        // 解析连接关系，建立房间间的依赖图
        const connections = this._parseConnections(flow, rooms);
        const maxIterations = 100;
        let iterations = 0;

        while (placed.size < rooms.length && iterations < maxIterations) {
            iterations++;
            for (const conn of connections) {
                if (placed.has(conn.from) && !placed.has(conn.to)) {
                    this._placeConnectedRoom(placed, conn, rooms);
                }
            }
        }

        // 如果还有未放置的房间，尝试随机放置
        for (const room of rooms) {
            if (!placed.has(room.id)) {
                console.warn(`[DungeonGenerator] Room ${room.id} could not be placed by connections, placing near origin`);
                room.x = 0;
                room.y = 0;
                placed.set(room.id, { x: 0, y: 0, room });
            }
        }

        // 平移所有房间，确保最小坐标为 padding，四周留边距
        const padding = 200;
        const minX = Math.min(...rooms.map(r => r.x));
        const minY = Math.min(...rooms.map(r => r.y));
        for (const room of rooms) {
            room.x -= minX;
            room.y -= minY;
            room.x += padding;
            room.y += padding;
        }

        // 重新计算出口的世界坐标
        for (const room of rooms) {
            for (const exit of room.exits) {
                exit.worldX = room.x + exit.x;
                exit.worldY = room.y + exit.y;
            }
        }

        return rooms;
    }

    _parseConnections(flow, rooms) {
        const connections = [];
        for (const conn of flow.connections) {
            const [fromRef, toRef] = conn;
            const fromMatch = fromRef.match(/^room(\d+)\.(\w+)$/);
            const toMatch = toRef.match(/^room(\d+)\.(\w+)$/);
            if (!fromMatch || !toMatch) continue;
            const fromIdx = parseInt(fromMatch[1]);
            const toIdx = parseInt(toMatch[1]);
            const fromDir = fromMatch[2];
            const toDir = toMatch[2];
            if (fromIdx < rooms.length && toIdx < rooms.length) {
                connections.push({
                    from: rooms[fromIdx].id,
                    to: rooms[toIdx].id,
                    fromDir,
                    toDir
                });
            }
        }
        return connections;
    }

    _placeConnectedRoom(placed, conn, rooms) {
        const fromRoom = placed.get(conn.from).room;
        if (placed.has(conn.to)) return; // 已放置

        // 在 rooms 数组中查找目标房间
        const targetRoom = rooms.find(r => r.id === conn.to);
        if (!targetRoom) return;

        // 找到 fromRoom 的对应出口
        const fromExit = fromRoom.exits.find(e => e.dir === conn.fromDir);
        if (!fromExit) return;

        // 找到 targetRoom 的对应出口
        const toExit = targetRoom.exits.find(e => e.dir === conn.toDir);
        if (!toExit) return;

        // 计算 targetRoom 的位置，使两个出口对齐
        // fromExit.worldX/Y = fromRoom.x + fromExit.x, fromRoom.y + fromExit.y
        // 需要：fromRoom.x + fromExit.x == targetRoom.x + toExit.x（水平连接）
        //      fromRoom.y + fromExit.y == targetRoom.y + toExit.y（垂直连接）
        // 但走廊会在中间，所以房间不直接相邻，而是留走廊空间
        const corridorGap = 120; // 走廊长度

        if (conn.fromDir === 'east' && conn.toDir === 'west') {
            targetRoom.x = fromRoom.x + fromExit.x + corridorGap - toExit.x;
            targetRoom.y = fromRoom.y + fromExit.y - toExit.y;
        } else if (conn.fromDir === 'west' && conn.toDir === 'east') {
            targetRoom.x = fromRoom.x + fromExit.x - corridorGap - toExit.x;
            targetRoom.y = fromRoom.y + fromExit.y - toExit.y;
        } else if (conn.fromDir === 'south' && conn.toDir === 'north') {
            targetRoom.x = fromRoom.x + fromExit.x - toExit.x;
            targetRoom.y = fromRoom.y + fromExit.y + corridorGap - toExit.y;
        } else if (conn.fromDir === 'north' && conn.toDir === 'south') {
            targetRoom.x = fromRoom.x + fromExit.x - toExit.x;
            targetRoom.y = fromRoom.y + fromExit.y - corridorGap - toExit.y;
        }

        placed.set(targetRoom.id, { x: targetRoom.x, y: targetRoom.y, room: targetRoom });
    }

    _generateCorridors(flow, rooms) {
        const corridors = [];
        for (const conn of flow.connections) {
            const [fromRef, toRef] = conn;
            const fromMatch = fromRef.match(/^room(\d+)\.(\w+)$/);
            const toMatch = toRef.match(/^room(\d+)\.(\w+)$/);
            if (!fromMatch || !toMatch) continue;

            const fromIdx = parseInt(fromMatch[1]);
            const toIdx = parseInt(toMatch[1]);
            if (fromIdx >= rooms.length || toIdx >= rooms.length) continue;

            const fromRoom = rooms[fromIdx];
            const toRoom = rooms[toIdx];
            const fromExit = fromRoom.exits.find(e => e.dir === fromMatch[2]);
            const toExit = toRoom.exits.find(e => e.dir === toMatch[2]);
            if (!fromExit || !toExit) continue;

            const startX = fromRoom.x + fromExit.x;
            const startY = fromRoom.y + fromExit.y;
            const endX = toRoom.x + toExit.x;
            const endY = toRoom.y + toExit.y;

            const corridorWidth = Math.min(fromExit.width, toExit.width, 120);

            corridors.push({
                fromRoom: fromIdx,
                toRoom: toIdx,
                startX, startY, endX, endY,
                width: corridorWidth,
                fromDir: fromMatch[2],
                toDir: toMatch[2]
            });
        }
        return corridors;
    }

    _generateWalls(rooms, corridors) {
        const walls = [];
        const wallThickness = 20;

        // 房间外墙
        for (const room of rooms) {
            const t = room.template.wallThickness || 20;
            // 上墙
            walls.push({ x: room.x - t, y: room.y - t, w: room.width + t * 2, h: t });
            // 下墙
            walls.push({ x: room.x - t, y: room.y + room.height, w: room.width + t * 2, h: t });
            // 左墙
            walls.push({ x: room.x - t, y: room.y, w: t, h: room.height });
            // 右墙
            walls.push({ x: room.x + room.width, y: room.y, w: t, h: room.height });
        }

        // 出口开口（从房间墙壁中移除）
        // 注意：这里简单处理，出口处不生成额外的墙壁遮挡
        // 实际游戏中，出口是走廊和房间的交界，走廊墙壁已经覆盖

        // 走廊墙壁
        for (const c of corridors) {
            const hw = c.width / 2 + wallThickness; // 半宽 + 墙厚
            if (c.fromDir === 'east' && c.toDir === 'west') {
                // 水平走廊
                const minX = Math.min(c.startX, c.endX);
                const maxX = Math.max(c.startX, c.endX);
                const y = c.startY;
                // 上墙
                walls.push({ x: minX, y: y - hw - wallThickness, w: maxX - minX, h: wallThickness });
                // 下墙
                walls.push({ x: minX, y: y + hw, w: maxX - minX, h: wallThickness });
            } else if (c.fromDir === 'west' && c.toDir === 'east') {
                const minX = Math.min(c.startX, c.endX);
                const maxX = Math.max(c.startX, c.endX);
                const y = c.startY;
                walls.push({ x: minX, y: y - hw - wallThickness, w: maxX - minX, h: wallThickness });
                walls.push({ x: minX, y: y + hw, w: maxX - minX, h: wallThickness });
            } else if (c.fromDir === 'south' && c.toDir === 'north') {
                // 垂直走廊
                const x = c.startX;
                const minY = Math.min(c.startY, c.endY);
                const maxY = Math.max(c.startY, c.endY);
                // 左墙
                walls.push({ x: x - hw - wallThickness, y: minY, w: wallThickness, h: maxY - minY });
                // 右墙
                walls.push({ x: x + hw, y: minY, w: wallThickness, h: maxY - minY });
            } else if (c.fromDir === 'north' && c.toDir === 'south') {
                const x = c.startX;
                const minY = Math.min(c.startY, c.endY);
                const maxY = Math.max(c.startY, c.endY);
                walls.push({ x: x - hw - wallThickness, y: minY, w: wallThickness, h: maxY - minY });
                walls.push({ x: x + hw, y: minY, w: wallThickness, h: maxY - minY });
            }
        }

        return walls;
    }

    _generateTerrain(rooms, corridors) {
        // 计算地图尺寸，使用房间坐标直接绘制（房间已在 _layoutRooms 中平移到正坐标 + padding）
        const bounds = this._computeBounds(rooms, corridors);
        const padding = 200;
        const mapW = bounds.maxX + padding;
        const mapH = bounds.maxY + padding;

        const canvas = document.createElement('canvas');
        canvas.width = mapW;
        canvas.height = mapH;
        const ctx = canvas.getContext('2d');

        // 全黑背景
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, mapW, mapH);

        // 绘制房间地板
        for (const room of rooms) {
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(room.x, room.y, room.width, room.height);
            // 石砖纹理
            ctx.strokeStyle = 'rgba(50, 50, 50, 0.3)';
            ctx.lineWidth = 1;
            for (let bx = room.x; bx < room.x + room.width; bx += 40) {
                ctx.beginPath(); ctx.moveTo(bx, room.y); ctx.lineTo(bx, room.y + room.height); ctx.stroke();
            }
            for (let by = room.y; by < room.y + room.height; by += 40) {
                ctx.beginPath(); ctx.moveTo(room.x, by); ctx.lineTo(room.x + room.width, by); ctx.stroke();
            }
            // 边缘高光
            ctx.strokeStyle = 'rgba(80, 80, 80, 0.5)';
            ctx.lineWidth = 2;
            ctx.strokeRect(room.x, room.y, room.width, room.height);
        }

        // 绘制走廊地板
        for (const c of corridors) {
            const minX = Math.min(c.startX, c.endX);
            const maxX = Math.max(c.startX, c.endX);
            const minY = Math.min(c.startY, c.endY);
            const maxY = Math.max(c.startY, c.endY);
            const hw = c.width / 2;

            ctx.fillStyle = '#1a1a1a';
            if (c.fromDir === 'east' || c.fromDir === 'west' || c.toDir === 'east' || c.toDir === 'west') {
                // 水平走廊
                const y = c.startY - hw;
                ctx.fillRect(minX, y, maxX - minX, c.width);
                ctx.strokeStyle = 'rgba(50, 50, 50, 0.3)';
                ctx.lineWidth = 1;
                ctx.strokeRect(minX, y, maxX - minX, c.width);
            } else {
                // 垂直走廊
                const x = c.startX - hw;
                ctx.fillRect(x, minY, c.width, maxY - minY);
                ctx.strokeStyle = 'rgba(50, 50, 50, 0.3)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x, minY, c.width, maxY - minY);
            }
        }

        return { canvas, width: mapW, height: mapH };
    }

    _computeBounds(rooms, corridors) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const room of rooms) {
            minX = Math.min(minX, room.x - 50);
            minY = Math.min(minY, room.y - 50);
            maxX = Math.max(maxX, room.x + room.width + 50);
            maxY = Math.max(maxY, room.y + room.height + 50);
        }

        for (const c of corridors) {
            minX = Math.min(minX, c.startX - 100, c.endX - 100);
            minY = Math.min(minY, c.startY - 100, c.endY - 100);
            maxX = Math.max(maxX, c.startX + 100, c.endX + 100);
            maxY = Math.max(maxY, c.startY + 100, c.endY + 100);
        }

        return { minX, minY, maxX, maxY };
    }

    _getPlayerStart(rooms) {
        const startRoom = rooms.find(r => r.type === 'start');
        if (startRoom) {
            return {
                x: startRoom.x + startRoom.width / 2,
                y: startRoom.y + startRoom.height / 2
            };
        }
        return { x: 0, y: 0 };
    }

    _randRange(min, max) {
        return Math.floor(min + Math.random() * (max - min + 1));
    }

    // ==================== 障碍物生成（供外部调用） ====================
    generateObstacles(room) {
        const obstacles = [];
        if (!room.template.obstacles) return obstacles;

        for (const obs of room.template.obstacles) {
            const count = this._randRange(obs.count.min, obs.count.max);
            for (let i = 0; i < count; i++) {
                // 简单随机放置（避免太靠近出口）
                let ox, oy, attempts = 0;
                do {
                    ox = room.x + 50 + Math.random() * (room.width - 100);
                    oy = room.y + 50 + Math.random() * (room.height - 100);
                    attempts++;
                } while (attempts < 20 && this._nearExit(ox, oy, room));
                obstacles.push({ x: ox, y: oy, size: obs.size, type: obs.type });
            }
        }
        return obstacles;
    }

    _nearExit(x, y, room) {
        for (const exit of room.exits) {
            const ex = room.x + exit.x;
            const ey = room.y + exit.y;
            if (Math.abs(x - ex) < 80 && Math.abs(y - ey) < 80) return true;
        }
        return false;
    }
}

// 单例导出
export const DungeonGen = new DungeonGenerator();
