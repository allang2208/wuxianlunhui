import { WallSystem, ISO_WALL_GEO, ISO_WALL_HEIGHT, slopeFixOf, isoGateHole, isoHalfThick } from '../world/wall-system.js';
import { Renderer } from '../world/renderer.js';
import { Camera } from '../world/camera.js';
import { pathFinder } from '../ai/pathfinder.js';
/**
 * ============================================================
 * CombatRoomSystem — 战斗场地系统
 * ============================================================
 *
 * 职责：
 *   1. 随机生成 1024-2048 大小的正方形战斗场地
 *   2. 玩家随机生成在四边中间位置
 *   3. 怪物生成在对边位置
 *   4. 战斗完成后删除场地（恢复原始地形）
 *   5. 与现有 WallSystem 和 Camera 系统兼容
 *
 * 集成点：
 *   dungeon-map-system.js 的 _enterCombat() / _enterBoss() 中调用
 *   替代原有的 _generateRoom() 方法
 */

import { CONFIG } from '../config/config.js';
import { BlackWolf, CircleEnemy } from '../entities/enemy-types.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import { rollDungeonBossGold, rollDungeonCombatGold } from '../config/dungeon-rewards.js';
import {
    applyDungeonFloor, applyDiamondFloor, applyArenaFloor,
    bakeDungeonFloorPatch, getDungeonFloorProfile,
} from './dungeon-floor-texture.js';
import { WallGate } from './wall-gate.js';
import { TrapSystem } from './trap-system.js';
import { GateLight } from '../effects/gate-light.js';
import { ChestRoomSystem } from './chest-room-system.js';
import { Input } from '../ui/input.js';
import { createMineCave } from './zombie-dungeon.js';
import { getWallPrefabLibrary } from './wall-prefabs.js';
import { SoundManager } from '../ui/sound-manager.js';
import {
    computeArenaLayout, computeMazeLayout, computeGridMazeLayout,
    pointInDiamond, MAZE_AXIS_V1, MAZE_AXIS_V2,
} from './combat-arena-layout.js';
import { ObstacleSpawnSystem } from './obstacle-spawn-system.js';
import { ONE_CELL_BUILDING_FOOT } from './building-footprint.js';

const gameRef = () => (typeof window !== 'undefined' ? window.Game : null);

// ==================== 配置对象 ====================
export const COMBAT_ROOM_CONFIG = {
    // 场地大小（正方形，固定值；精英/Boss 由调用点按类型传入）
    roomSize: {
        normal: 1024,   // 普通战斗房
        elite: 1792,    // 精英战斗房
        boss: 2048      // Boss 房（可被地牢级 combatRoom.bossSize 覆盖，如僵尸地牢高级=1024）
    },

    // 边界墙壁配置
    walls: {
        thickness: 20,       // 墙壁厚度
        margin: 20,          // 内边距（安全区域边界）
        color: '#1a1a1a'     // 墙壁颜色（用于地形纹理）
    },

    // 玩家生成配置
    playerSpawn: {
        offsetFromEdge: 60,  // 从边界向内偏移距离（使用固定像素 bottom）
        edgeCandidates: [0, 1, 2, 3], // 0=上, 1=右, 2=下, 3=左
        fixedCenter: true,   // 固定在边中间位置
    },

    // 怪物生成配置
    monsterSpawn: {
        margin: 40,          // 怪物距离边界的最低距离
        spawnDepth: 120,     // 对边生成区域的深度（从对边向内延伸）
        minWallDistance: 0,  // 怪物与墙壁的最小距离（0 表示不额外限制）
        count: {
            normal: 3,       // 普通战斗怪物数量
            boss: 1          // Boss 战怪物数量
        }
    },

    // 地形纹理配置
    terrain: {
        floorColor: '#1a1a1a',
        gridColor: 'rgba(50, 50, 50, 0.3)',
        gridSize: 20,
        edgeHighlight: 'rgba(80, 80, 80, 0.5)'
    },

    // 怪物池（使用 getter 延迟解析，避免循环依赖导致的 TDZ）
    monsterPool: {
        get normal() { return [BlackWolf, CircleEnemy]; },
        get boss() { return [BlackWolf, CircleEnemy]; }
    },

    // 战斗奖励配置（已移除旧版倒计时，改为出口传送门）
    cleanup: {
        goldReward: {
            normal: { min: 50, max: 150 },
            boss: 300
        }
    }
};

// 将 JSON 配置映射为 CombatRoomSystem 使用的内部结构
function createCombatRoomConfig() {
    const cfg = { ...COMBAT_ROOM_CONFIG };
    cfg.walls = { ...COMBAT_ROOM_CONFIG.walls };
    cfg.playerSpawn = { ...COMBAT_ROOM_CONFIG.playerSpawn };
    cfg.monsterSpawn = { ...COMBAT_ROOM_CONFIG.monsterSpawn, count: { ...COMBAT_ROOM_CONFIG.monsterSpawn.count } };
    cfg.cleanup = { ...COMBAT_ROOM_CONFIG.cleanup, goldReward: { ...COMBAT_ROOM_CONFIG.cleanup.goldReward, normal: { ...COMBAT_ROOM_CONFIG.cleanup.goldReward.normal } } };

    const json = DungeonConfig.getCombatRoomConfig();
    if (json.normalSize != null) cfg.roomSize.normal = json.normalSize;
    if (json.eliteSize != null) cfg.roomSize.elite = json.eliteSize;
    if (json.bossSize != null) cfg.roomSize.boss = json.bossSize;
    if (json.wallThickness != null) cfg.walls.thickness = json.wallThickness;
    if (json.spawn) {
        cfg.playerSpawn.offsetFromEdge = json.spawn.playerOffsetFromEdge ?? cfg.playerSpawn.offsetFromEdge;
        cfg.monsterSpawn.margin = json.spawn.monsterMargin ?? cfg.monsterSpawn.margin;
        cfg.monsterSpawn.spawnDepth = json.spawn.monsterSpawnDepth ?? cfg.monsterSpawn.spawnDepth;
        cfg.monsterSpawn.minWallDistance = json.spawn.minWallDistance ?? cfg.monsterSpawn.minWallDistance;
    }
    return cfg;
}

// ==================== 战斗场地系统 ====================
export const CombatRoomSystem = {
    // 状态
    active: false,
    state: 'idle', // 'idle' | 'combat' | 'boss'

    // 当前场地信息
    _roomSize: 1024,
    _roomBounds: null,      // { minX, maxX, minY, maxY, cx, cy }
    _entranceEdge: null,    // 玩家进入的边 (0=上, 1=右, 2=下, 3=左)
    _oppositeEdge: null,    // 怪物生成的对边

    // 备份与恢复
    _backupWalls: [],
    _backupTrees: [],
    _backupTerrain: null,
    _backupWorldSize: { width: 0, height: 0 },
    _backupCameraFollow: null,

    // 战斗实体追踪
    _combatMonsters: [],
    _combatMonsterKeys: [],
    _player: null,

    // 多房间串联竞技场（null = 单房间模式）
    _arena: null,
    _roomConstruction: 'continuous',
    _gridEdgeCells: 0,
    _gridGateCells: 6,
    _gridGateSpan: null,

    // 配置引用（从 data/dungeon-config.json 加载）
    config: createCombatRoomConfig(),

    // ============================================================
    // 公共 API
    // ============================================================

    /**
     * 初始化并进入战斗场地
     * @param {Object} player - 玩家实体
     * @param {boolean} isBoss - 是否为 Boss 战
     * @param {Object} options - 可选配置覆盖
     *   - roomSize: 指定场地大小（默认普通 1024，Boss 2048，精英由调用点传 1792）
     *   - monsterCount: 怪物数量（默认普通3只，Boss1只）
     *   - monsterClasses: 自定义怪物类数组
     * @returns {Object} 场地信息 { size, bounds, entranceEdge, oppositeEdge }
     */
    enterCombatRoom(player, isBoss = false, options = {}) {
        if (!player) {
            console.error('[CombatRoomSystem] enterCombatRoom: player is required');
            return null;
        }

        this._player = player;
        this.state = isBoss ? 'boss' : 'combat';
        this.active = true;

        // 1. 保存当前场景状态
        this._backupSceneState();

        // 2. 确定场地大小。worldBlock1x1 标准严格复用世界单格 128×64 footprint；
        // 当前墙样式只替换模块外观，不改变共享转角、门洞和碰撞几何。
        const roomSize = options.roomSize || this._rollRoomSize(isBoss);
        this._roomSize = roomSize;
        const roomProfile = DungeonConfig.getCombatRoomConfig(options.dungeonType);
        this._roomConstruction = roomProfile.wallConstruction || 'continuous';
        const worldBlockRoom = this._roomConstruction === 'worldBlock1x1';
        this._gridGateCells = Math.max(2, Math.round(roomProfile.gateCells || 6));
        const gridEdgeRadius = Math.max(6, Math.round((roomSize * 1.2) / ONE_CELL_BUILDING_FOOT.w));
        this._gridEdgeCells = worldBlockRoom
            ? gridEdgeRadius * 2
            : 0;
        const rx = worldBlockRoom
            ? this._gridEdgeCells * ONE_CELL_BUILDING_FOOT.w / 2
            : Math.round(roomSize * 1.2);
        const ry = worldBlockRoom
            ? this._gridEdgeCells * ONE_CELL_BUILDING_FOOT.d / 2
            : Math.round(rx * 0.5774);
        // 边距必须 ≥ 墙体贴图高度（190×角度补偿≈217）+ 缓冲，否则上夹角被世界顶裁掉
        const M = worldBlockRoom ? 300 : 260;
        this._diamond = {
            rx, ry,
            worldW: 2 * (rx + M),
            worldH: 2 * (ry + M),
            cx: rx + M,
            cy: ry + M,
        };

        // 3. 生成场地地形（菱形地板）
        this._generateTerrain(roomSize);

        // 单格墙环必须在铺墙前知道入口边，才能从几何源头留出连续门洞。
        if (worldBlockRoom) {
            this._entranceEdge = this._rollEntranceEdge();
            this._oppositeEdge = (this._entranceEdge + 2) % 4;
        }

        // 4. 生成边界墙壁（普通样式为连续斜墙；雪原初级为世界单格墙环）
        this._generateWalls(roomSize);

        // 6. 确定玩家生成边并放置玩家
        const entranceEdge = worldBlockRoom ? this._entranceEdge : this._rollEntranceEdge();
        if (!worldBlockRoom) {
            this._entranceEdge = entranceEdge;
            this._oppositeEdge = (entranceEdge + 2) % 4;
        }
        this._spawnPlayer(player, entranceEdge, roomSize);

        // 7. 计算战斗区域边界
        this._roomBounds = this._calculateRoomBounds(roomSize);

        // 8. 设置相机跟随
        this._setupCamera(player);

        // 9. 门闸：距玩家最近的直墙件替换为带门直墙，播关门动画困场
        this._setupGate(player);

        // 10. 障碍物：墙面火把（贴墙、无碰撞）+ 后墙预制组合；避开门口/玩家出生点
        // （仅僵尸地牢大类生成；中央石柱只走竞技场路径，单房间不传 roomIndex）
        const gateInfo = WallGate.getGateInfo();
        const obstacleAvoid = [{ x: player.x, y: player.y, r: 150 }];
        if (gateInfo && gateInfo.center) obstacleAvoid.push({ x: gateInfo.center.x, y: gateInfo.center.y, r: 220 });
        ObstacleSpawnSystem.spawnForRoom(this._roomBounds, {
            dungeonType: options.dungeonType,
            avoidPoints: obstacleAvoid,
        });
        WallSystem.rebuildIsoCollision();
        if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();

        return {
            size: roomSize,
            bounds: this._roomBounds,
            entranceEdge: this._entranceEdge,
            oppositeEdge: this._oppositeEdge
        };
    },

    /**
     * 生成战斗怪物
     * @param {number} count - 怪物数量（默认从配置读取）
     * @param {boolean} isBoss - 是否为 Boss 怪物
     * @param {Array} customClasses - 自定义怪物类数组（可选）
     * @returns {Array} 生成的怪物数组
     */
    spawnMonsters(count, isBoss = false, customClasses = null) {
        this._combatMonsters = [];
        this._combatMonsterKeys = [];

        const cfg = this.config.monsterSpawn;
        const bounds = this._roomBounds;
        if (!bounds) {
            console.error('[CombatRoomSystem] spawnMonsters: room bounds not initialized');
            return [];
        }

        const spawnArea = this._calculateSpawnArea(bounds, this._oppositeEdge, cfg.margin, cfg.spawnDepth, cfg.minWallDistance);
        const monsterCount = count || (isBoss ? cfg.count.boss : cfg.count.normal);

        // 刷怪排除区（宝箱房：房内不刷怪，ChestRoomSystem.setup 注册）
        const exclusions = [];
        if (typeof ChestRoomSystem !== 'undefined' && ChestRoomSystem._exclusion) {
            exclusions.push(ChestRoomSystem._exclusion);
        }
        const inExclusion = (x, y) => exclusions.some(e =>
            Math.abs(x - e.cx) / Math.max(1, e.rx) + Math.abs(y - e.cy) / Math.max(1, e.ry) <= 1);

        const monsterClasses = customClasses || (isBoss ? this.config.monsterPool.boss : this.config.monsterPool.normal);

        for (let i = 0; i < monsterCount; i++) {
            let mx = spawnArea.minX + Math.random() * (spawnArea.maxX - spawnArea.minX);
            let my = spawnArea.minY + Math.random() * (spawnArea.maxY - spawnArea.minY);

            // 菱形房：生成点必须在菱形内（内缩安全距离）且不在排除区内，拒绝采样 30 次后回退中心
            if (spawnArea._diamondClip) {
                const b = spawnArea._diamondClip;
                const inset = Math.max(cfg.minWallDistance || 0, cfg.margin || 0) + 60;
                let ok = false;
                for (let t = 0; t < 30 && !ok; t++) {
                    mx = spawnArea.minX + Math.random() * (spawnArea.maxX - spawnArea.minX);
                    my = spawnArea.minY + Math.random() * (spawnArea.maxY - spawnArea.minY);
                    ok = Math.abs(mx - b.cx) / Math.max(1, b.rx - inset) + Math.abs(my - b.cy) / Math.max(1, b.ry - inset) <= 1
                        && !inExclusion(mx, my);
                }
                if (!ok) {
                    // 回退点不能落在排除区（宝箱房在场地正中，旧的 b.cx/b.cy 回退必中宝箱房）：
                    // 取菱形上顶点方向的边缘内点（远离中心排除区）
                    mx = b.cx;
                    my = b.cy - (b.ry - inset) * 0.5;
                }
            } else if (exclusions.length) {
                // 非菱形房同样排除（宝箱房区域内不刷怪）
                for (let t = 0; t < 30 && inExclusion(mx, my); t++) {
                    mx = spawnArea.minX + Math.random() * (spawnArea.maxX - spawnArea.minX);
                    my = spawnArea.minY + Math.random() * (spawnArea.maxY - spawnArea.minY);
                }
            }

            const MonsterClass = customClasses
                ? monsterClasses[i % monsterClasses.length]
                : monsterClasses[Math.floor(Math.random() * monsterClasses.length)];
            let monster;

            try {
                if (typeof MonsterClass === 'function') {
                    monster = new MonsterClass(mx, my);
                } else {
                    console.warn('[CombatRoomSystem] Invalid monster class:', MonsterClass);
                    continue;
                }
            } catch (err) {
                console.error('[CombatRoomSystem] Failed to spawn monster:', err);
                continue;
            }

            // [SAFE-SPAWN] 若生成点贴墙/被阻挡，沿螺旋外推寻找合法位置
            const r = monster.groundRadius;
            if (WallSystem && WallSystem.findSafeSpawn && !WallSystem.canMoveTo(monster.x, monster.y, r)) {
                const safe = WallSystem.findSafeSpawn(monster.x, monster.y, r);
                monster.x = safe.x;
                monster.y = safe.y;
            }

            // 强制保持与墙壁的最小缓冲距离（菱形房跳过：拒绝采样已保证在菱形内，矩形钳制会推出菱形）
            const minD = cfg.minWallDistance || 0;
            if (minD > 0 && !bounds.diamond) {
                const innerMinX = bounds.minX + minD;
                const innerMaxX = bounds.maxX - minD;
                const innerMinY = bounds.minY + minD;
                const innerMaxY = bounds.maxY - minD;
                monster.x = Math.max(innerMinX, Math.min(innerMaxX, monster.x));
                monster.y = Math.max(innerMinY, Math.min(innerMaxY, monster.y));
                // 如果修正后进入墙体，再尝试一次安全搜索
                if (WallSystem && WallSystem.findSafeSpawn && !WallSystem.canMoveTo(monster.x, monster.y, r)) {
                    const safe = WallSystem.findSafeSpawn(monster.x, monster.y, r);
                    monster.x = Math.max(innerMinX, Math.min(innerMaxX, safe.x));
                    monster.y = Math.max(innerMinY, Math.min(innerMaxY, safe.y));
                }
            }

            const key = `combat_monster_${Date.now()}_${i}_${Math.floor(Math.random() * 1000)}`;
            const Game = gameRef();
            if (Game && Game.entities) {
                Game.entities.set(key, monster);
            }
            this._combatMonsters.push(monster);
            // 地牢刷怪：在怪物脚下生成黑色粒子特效（持续 1.5 秒）
            const spawnScene = typeof window !== 'undefined' ? window.__phaserScene : null;
            if (spawnScene && typeof spawnScene.playDungeonSpawnParticles === 'function') {
                spawnScene.playDungeonSpawnParticles(monster.x, monster.y);
            }
            this._combatMonsterKeys.push(key);

            // 工头刷新时附带刷新一个矿洞（在工头附近安全位置）
            if (monster && monster.id === 'foremanZombie' && Game && Game.entities) {
                this._spawnMineCaveNearForeman(monster, Game, bounds);
            }
        }

        
        return this._combatMonsters;
    },

    /** 在工头附近生成一个矿洞（安全位置 + 召唤方向镜像，保证生成的僵尸可以走出、不卡墙角） */
    _spawnMineCaveNearForeman(foreman, Game, bounds) {
        try {
            if (!createMineCave) return;

            const caveRadius = ONE_CELL_BUILDING_FOOT.clearRadius; // 标准1×1建筑安全外框
            const minDist = 150, maxDist = 300;
            let caveX = foreman.x, caveY = foreman.y;
            let found = false;
            let spawnDirX = 1;

            // 刷怪排除区（宝箱房：未开门的房内不刷矿洞，与 spawnMonsters 同款判定）
            const exc = (typeof ChestRoomSystem !== 'undefined') ? ChestRoomSystem._exclusion : null;
            const inExclusion = (x, y) => !!exc &&
                Math.abs(x - exc.cx) / Math.max(1, exc.rx) + Math.abs(y - exc.cy) / Math.max(1, exc.ry) <= 1;

            // 召唤出口校验：出怪点与外延探测点都可行走（出怪卡墙角的根因——
            // 矿洞贴墙时出怪点嵌墙，WallSystem.resolve 沿墙切向弹出把矿工挤进墙角死袋）
            const forwardX = 100; // enemy-config mineCave.attackSkills.spawn.forwardX
            const probeRadius = 39; // 覆盖提灯矿工 38.75 的真实 groundRadius
            const exitWalkable = (x, y, dir) => {
                if (!WallSystem || typeof WallSystem.canMoveTo !== 'function') return true;
                return WallSystem.canMoveTo(x + forwardX * dir, y, probeRadius)
                    && WallSystem.canMoveTo(x + (forwardX + 80) * dir, y, probeRadius);
            };

            // 尝试在工头周围找一个安全位置（可移动，不卡墙）
            for (let attempt = 0; attempt < 16 && !found; attempt++) {
                const angle = (attempt / 16) * Math.PI * 2;
                const dist = minDist + Math.random() * (maxDist - minDist);
                const tx = foreman.x + Math.cos(angle) * dist;
                const ty = foreman.y + Math.sin(angle) * dist;
                // 边界检查（菱形房按菱形内缩判定，外接矩形四角在界外）
                const inRoom = bounds.diamond
                    ? Math.abs(tx - bounds.cx) / Math.max(1, bounds.rx - caveRadius) + Math.abs(ty - bounds.cy) / Math.max(1, bounds.ry - caveRadius) <= 1
                    : (tx >= bounds.minX + caveRadius && tx <= bounds.maxX - caveRadius && ty >= bounds.minY + caveRadius && ty <= bounds.maxY - caveRadius);
                if (!inRoom) continue;
                // 排除区检查（宝箱房）
                if (inExclusion(tx, ty)) continue;
                // 碰撞检查
                if (WallSystem && WallSystem.canMoveTo && !WallSystem.canMoveTo(tx, ty, caveRadius)) continue;
                // 召唤方向：优先朝房中心一侧；该侧出口不可走则镜像，两侧都堵换候选点
                const prefDir = (bounds.cx >= tx) ? 1 : -1;
                if (exitWalkable(tx, ty, prefDir)) {
                    spawnDirX = prefDir;
                } else if (exitWalkable(tx, ty, -prefDir)) {
                    spawnDirX = -prefDir;
                } else {
                    continue;
                }
                caveX = tx; caveY = ty; found = true;
            }

            // 兜底：找不到就往场地中心方向收（保证在菱形内）；落入排除区或出口两侧都堵则放弃本次生成
            if (!found) {
                const dxc = bounds.cx - foreman.x, dyc = bounds.cy - foreman.y;
                const dc = Math.hypot(dxc, dyc) || 1;
                caveX = foreman.x + dxc / dc * minDist;
                caveY = foreman.y + dyc / dc * minDist;
                if (inExclusion(caveX, caveY)) return;
                const prefDir = (bounds.cx >= caveX) ? 1 : -1;
                if (exitWalkable(caveX, caveY, prefDir)) {
                    spawnDirX = prefDir;
                } else if (exitWalkable(caveX, caveY, -prefDir)) {
                    spawnDirX = -prefDir;
                } else {
                    console.warn('[CombatRoomSystem] 矿洞生成放弃：召唤出口两侧均被墙堵住');
                    return;
                }
            }

            const cave = createMineCave(caveX, caveY, { spawnDirX });
            const key = `combat_minecave_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            Game.entities.set(key, cave);
            // 只登记 key（清场按 keys 删除），不进 _combatMonsters——矿洞是生成器，不应阻塞战斗完成判定
            this._combatMonsterKeys.push(key);
            // 矿洞生成特效
            const spawnScene = typeof window !== 'undefined' ? window.__phaserScene : null;
            if (spawnScene && typeof spawnScene.playDungeonSpawnParticles === 'function') {
                spawnScene.playDungeonSpawnParticles(caveX, caveY);
            }
        } catch (err) {
            console.error('[CombatRoomSystem] Failed to spawn mine cave near foreman:', err);
        }
    },

    /**
     * 检查战斗是否完成（所有怪物死亡）
     * @returns {boolean}
     */
    isCombatComplete() {
        if (this._combatMonsters.length === 0) return false;
        return this._combatMonsters.every(m => !m.active || m.hp <= 0);
    },

    /**
     * 获取战斗奖励金币数
     * @param {boolean} isBoss - 是否为 Boss 战
     * @param {string|null} dungeonType - 当前地牢类型
     * @returns {number}
     */
    getGoldReward(isBoss = false, dungeonType = null) {
        return isBoss ? rollDungeonBossGold(dungeonType) : rollDungeonCombatGold(dungeonType);
    },

    /**
     * 清理战斗场地并恢复原始场景
     * 调用此方法后，场地将被销毁，玩家回到地图模式
     */
    /**
     * 门闸：距目标点最近的直墙件替换为带门直墙，入场播关门动画困场
     * @param {Object} target 目标点（{x, y}；旧调用直接传 player，玩家实体自带 x/y）
     * @param {Object} [opts]
     * @param {boolean} [opts.straightOnly] 只替换直墙件（竞技场多房间场景：
     *   跳过"优先样式门贴图件"分支——三房串联时转角装饰门可能离目标边中点很远）
     */
    _setupGate(target, opts = {}) {
        if (!this._diamond || !WallSystem.isoVisuals) return;
        // 世界单格墙环在构建时已留出完整门洞，不再从墙件中事后猜测/拆除。
        // 六格跨度让现有功能门保持接近原始高度与门洞宽度，同时两端仍落在格点上。
        if (this._gridGateSpan) {
            const span = this._gridGateSpan;
            if (WallGate.placeAt(span.a, span.b, span.flip, span.depth, { fitSpan: true })) {
                WallGate.state = 'open';
                WallGate._frame = 15;
                if (WallGate.sprite) WallGate.sprite.setFrame(15);
                WallGate.playClose();
                this._spawnGateExitZone();
            } else {
                // 贴图加载失败时恢复预留区墙块，保证场地仍是闭合边界。
                WallSystem.isoVisuals.push(...span.fillPieces);
                WallSystem.rebuildIsoCollision();
                if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();
            }
            return;
        }
        // 被替换件候选：①优先样式门贴图件（转角装饰门→功能门，一间房天然只有一扇门）；
        // ②无门件时回退到距目标点最近的直墙件（跳过转角预制件）
        const styleGeos = WallSystem.getWallStyleGeos ? WallSystem.getWallStyleGeos() : { straight: 'straight', gate: 'gate' };
        const straightTex = (ISO_WALL_GEO[styleGeos.straight] || ISO_WALL_GEO.straight).tex;
        const styleGateTex = (ISO_WALL_GEO[styleGeos.gate] || ISO_WALL_GEO.gate).tex;
        let best = null, bestD = Infinity;
        if (!opts.straightOnly) {
            for (const p of WallSystem.isoVisuals) {
                if (p.tex !== styleGateTex) continue;
                const d = Math.hypot(p.x - target.x, p.y - target.y);
                if (d < bestD) { bestD = d; best = p; }
            }
        }
        if (!best) {
            // 排除"近顶点件"（转角臂与其近整瓦重复瓦片）：替换它们会暴露 overshoot 结构——
            // 摘重复件则在 S≥1792 房间留出百像素断口（精英房下夹角左侧空隙根因），不摘则重复件碰撞横穿门洞。
            // 近顶点规则：任一底边端点距菱形顶点 < 0.8×瓦长。常规续接瓦片两端天然 8px 叠合，原位替换永远无缝无堵
            const g0 = ISO_WALL_GEO[styleGeos.straight] || ISO_WALL_GEO.straight;
            const s0 = ISO_WALL_HEIGHT / g0.wallH;
            const sy0 = s0 * slopeFixOf(g0);
            const faceLen0 = Math.hypot((g0.face[1][0] - g0.face[0][0]) * s0, (g0.face[1][1] - g0.face[0][1]) * sy0);
            const d = this._diamond;
            const verts = [{ x: d.cx, y: d.cy - d.ry }, { x: d.cx, y: d.cy + d.ry }, { x: d.cx - d.rx, y: d.cy }, { x: d.cx + d.rx, y: d.cy }];
            const nearVertex = (p) => {
                const seg = WallSystem._pieceBaseSegments(p)[0];
                if (!seg) return true;
                return seg.some(pt => verts.some(V => Math.hypot(pt.x - V.x, pt.y - V.y) < 0.8 * faceLen0));
            };
            for (const p of WallSystem.isoVisuals) {
                if (p.tex !== straightTex) continue;
                if (p._corner) continue; // 转角预制件不替换（避免夹角处出现装饰门+功能门双门）
                if (nearVertex(p)) continue;
                const d2 = Math.hypot(p.x - target.x, p.y - target.y);
                if (d2 < bestD) { bestD = d2; best = p; }
            }
        }
        if (!best) return;
        const [a, b] = WallSystem._pieceBaseSegments(best)[0];
        const flip = !!best.flipX;
        let depth = best.depth; // 原位替换：沿用被替换件自身的深度，不做任何接缝特权
        const bestIdx = WallSystem.isoVisuals.indexOf(best);
        WallSystem.isoVisuals.splice(bestIdx, 1);
        // 续接瓦片尾端的近整瓦重复件（edgeFill 只叠不缺的 overshoot，平时被转角臂盖住）一并摘除——
        // 否则门闸只替换转角臂时，重复件的碰撞段/贴图横穿门洞（"下夹角门又多一堵墙、无法离场"根因）；
        // 门闸世界跨度==瓦片定长，摘除后由门闸覆盖全段不留缺口
        const dupPieces = WallSystem.removeSpanCoveringPieces([a, b]);
        // 转角斜接遮盖位继承：同 depth 且共端点的转角兄弟件若创建在被替换件之后
        // （默认构建里它盖住被替换件的端边），门闸必须同样退到它下面（-0.1）——
        // 否则门闸贴图的裁切边暴露在斜接缝上（用户手工预设验证：转角臂盖住门墙才严丝合缝）
        for (let i = bestIdx; i < WallSystem.isoVisuals.length; i++) {
            const p = WallSystem.isoVisuals[i];
            if (Math.abs(p.depth - best.depth) > 0.01) continue;
            const shares = WallSystem._pieceBaseSegments(p).some(seg =>
                seg.some(pt => Math.hypot(pt.x - a.x, pt.y - a.y) < 2 || Math.hypot(pt.x - b.x, pt.y - b.y) < 2));
            if (shares) { depth = best.depth - 0.1; break; }
        }
        WallSystem.rebuildIsoCollision();
        // 先同步渲染墙件，再创建门闸精灵——避免门闸创建后被整批重建的墙件精灵压住；
        // 转角斜接处的上下位已由上面的 depth-0.1 显式继承，不再依赖创建顺序
        if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();
        // 门闸锚点沿边回退 8px：与瓦片"8px 叠合"同口径——替换转角臂时门与邻瓦只剩 ~1px 对顶
        // （视觉露缝）、替换近整瓦重复件时门远端到不了顶点（留空档）；多出的 8px 由邻件盖住（只叠不缺）
        const _segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const a2 = { x: a.x - (b.x - a.x) / _segLen * 8, y: a.y - (b.y - a.y) / _segLen * 8 };
        if (WallGate.placeAt(a2, b, flip, depth)) {
            WallGate.state = 'open';
            WallGate._frame = 15;
            if (WallGate.sprite) WallGate.sprite.setFrame(15);
            WallGate.playClose();
            // 门外独立砖块：入场即生成（不再等战斗完成）
            this._spawnGateExitZone();
        } else {
            // 门闸放置失败（如贴图缺失）：把被替换的直墙件与重复件插回并重建碰撞，
            // 避免墙上留无碰撞缺口（软锁——无出口）
            WallSystem.isoVisuals.splice(bestIdx, 0, best);
            WallSystem.isoVisuals.push(...dupPieces);
            WallSystem.rebuildIsoCollision();
            if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();
        }
    },

    /** 战斗完成：播开门动画 */
    openGate() {
        if (!WallGate.sprite) return;
        WallGate.playOpen();
        // 门外白区光斑（大泛光+亮核，呼吸脉动；不进房门侧）——接线曾在重构中丢失，此处恢复
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        const info = WallGate.getGateInfo();
        if (scene && info && info.center && this._gateZone) {
            GateLight.spawn(scene, info.center, null, { x: this._gateZone.cx, y: this._gateZone.cy });
        }
    },

    /** 地板砖几何缓存：按贴图 alpha 扫描内容外接框（_spawnGateExitZone 门外白区晶格用） */
    _tileGeoFor(tileKey) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (!scene || !tileKey || !scene.textures.exists(tileKey)) return null;
        if (!this._tileGeo) this._tileGeo = {};
        if (!this._tileGeo[tileKey]) {
            const srcImg = scene.textures.get(tileKey).getSourceImage();
            const c = document.createElement('canvas');
            c.width = srcImg.width;
            c.height = srcImg.height;
            const cx2 = c.getContext('2d');
            cx2.drawImage(srcImg, 0, 0);
            const data = cx2.getImageData(0, 0, c.width, c.height).data;
            let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
            for (let y = 0; y < c.height; y++) {
                for (let x = 0; x < c.width; x++) {
                    if (data[(y * c.width + x) * 4 + 3] > 8) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }
            this._tileGeo[tileKey] = { w: maxX - minX + 1, h: maxY - minY + 1, cx: (minX + maxX + 1) / 2, cy: (minY + maxY + 1) / 2 };
        }
        return this._tileGeo[tileKey];
    },

    /** 点是否位于任意简单多边形内（门外视觉与离场判定共用同一份边界）。 */
    _pointInPolygon(x, y, points) {
        if (!Array.isArray(points) || points.length < 3) return false;
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const a = points[i], b = points[j];
            const crosses = (a.y > y) !== (b.y > y)
                && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x;
            if (crosses) inside = !inside;
        }
        return inside;
    },

    /** 销毁一块门外地块的视觉与活动边界。 */
    _destroyGateZone(zone) {
        if (!zone) return;
        for (const s of zone._sprites || []) {
            if (s && s.scene) {
                s.scene.tweens.killTweensOf(s);
                s.destroy();
            }
        }
        for (const seg of zone._segments || []) {
            const index = WallSystem.isoSegments ? WallSystem.isoSegments.indexOf(seg) : -1;
            if (index >= 0) WallSystem.isoSegments.splice(index, 1);
        }
    },

    /**
     * 僵尸单格墙门外地块：严格复用世界建筑128×64格网。
     * 门内1格与门外1格保持门洞原宽，随后两侧各扩1格，向门外延伸5格形成规整入场平台；
     * 门内边保持开放，其余直段、整格肩位与外缘都是仅限移动的隐形边界。
     */
    _spawnWorldBlockGateZone(info, diamond, gridSpan, isEntry) {
        const scene = window.__phaserScene;
        if (!scene || !gridSpan?.rawA || !gridSpan?.rawB || !gridSpan?.step) return null;
        const gateCenter = info.center;
        const centerDx = gateCenter.x - diamond.cx;
        const centerDy = gateCenter.y - diamond.cy;
        const outward = {
            x: Math.sign(centerDx || 1) * ONE_CELL_BUILDING_FOOT.w / 2,
            y: Math.sign(centerDy || 1) * ONE_CELL_BUILDING_FOOT.d / 2,
        };
        const tangent = { x: gridSpan.step.x, y: gridSpan.step.y };
        const sidePaddingCells = 1;
        const insideOverlapCells = 1;
        const outsideDepthCells = 5;
        const nearA = {
            x: gridSpan.rawA.x - outward.x * insideOverlapCells,
            y: gridSpan.rawA.y - outward.y * insideOverlapCells,
        };
        const nearB = {
            x: gridSpan.rawB.x - outward.x * insideOverlapCells,
            y: gridSpan.rawB.y - outward.y * insideOverlapCells,
        };
        const mouthA = {
            x: gridSpan.rawA.x + outward.x,
            y: gridSpan.rawA.y + outward.y,
        };
        const mouthB = {
            x: gridSpan.rawB.x + outward.x,
            y: gridSpan.rawB.y + outward.y,
        };
        const shoulderA = {
            x: mouthA.x - tangent.x * sidePaddingCells,
            y: mouthA.y - tangent.y * sidePaddingCells,
        };
        const shoulderB = {
            x: mouthB.x + tangent.x * sidePaddingCells,
            y: mouthB.y + tangent.y * sidePaddingCells,
        };
        const farA = {
            x: gridSpan.rawA.x - tangent.x * sidePaddingCells + outward.x * outsideDepthCells,
            y: gridSpan.rawA.y - tangent.y * sidePaddingCells + outward.y * outsideDepthCells,
        };
        const farB = {
            x: gridSpan.rawB.x + tangent.x * sidePaddingCells + outward.x * outsideDepthCells,
            y: gridSpan.rawB.y + tangent.y * sidePaddingCells + outward.y * outsideDepthCells,
        };
        // 先以六格原宽穿过门柱，再在门外一格处做整格肩位扩宽；禁止地板压到门柱墙脚。
        const points = [
            nearA, nearB, mouthB, shoulderB,
            farB, farA, shoulderA, mouthA,
        ];
        const baked = bakeDungeonFloorPatch(points, { padding: 36 });
        if (!baked) return null;

        const zoneKey = isEntry ? 'gate_zone_tile_entry' : 'gate_zone_tile';
        if (scene.textures.exists(zoneKey)) scene.textures.remove(zoneKey);
        scene.textures.addCanvas(zoneKey, baked.canvas);
        const tile = scene.add.image(baked.x, baked.y, zoneKey);
        tile.setOrigin(0, 0);
        tile.setDepth(-999);

        // 规则轮廓只在外侧发光；门内重叠带不画光边，避免主地板上出现一条横向接缝。
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = baked.w;
        glowCanvas.height = baked.h;
        const gctx = glowCanvas.getContext('2d');
        gctx.shadowColor = '#ffffff';
        gctx.shadowBlur = 16;
        gctx.globalAlpha = 0.75;
        gctx.drawImage(baked.canvas, 0, 0);
        gctx.globalAlpha = 1;
        gctx.globalCompositeOperation = 'destination-out';
        gctx.drawImage(baked.canvas, 0, 0);
        const glowData = gctx.getImageData(0, 0, baked.w, baked.h);
        const outwardLen = Math.hypot(outward.x, outward.y) || 1;
        for (let py = 0; py < baked.h; py++) {
            for (let px = 0; px < baked.w; px++) {
                const worldX = baked.x + px;
                const worldY = baked.y + py;
                const outwardDistance = ((worldX - gateCenter.x) * outward.x
                    + (worldY - gateCenter.y) * outward.y) / outwardLen;
                if (outwardDistance <= outwardLen * 1.35) {
                    glowData.data[(py * baked.w + px) * 4 + 3] = 0;
                }
            }
        }
        gctx.putImageData(glowData, 0, 0);
        gctx.globalCompositeOperation = 'source-over';
        const glowKey = isEntry ? 'gate_zone_glow_entry' : 'gate_zone_glow';
        if (scene.textures.exists(glowKey)) scene.textures.remove(glowKey);
        scene.textures.addCanvas(glowKey, glowCanvas);
        const glow = scene.add.image(baked.x, baked.y, glowKey);
        glow.setOrigin(0, 0);
        glow.setDepth(-998);
        scene.tweens.add({
            targets: glow,
            alpha: { from: 0.22, to: 0.38 },
            yoyo: true,
            repeat: -1,
            duration: 1200,
            ease: 'Sine.easeInOut',
        });

        const segments = [
            [nearA, mouthA],
            [mouthA, shoulderA],
            [shoulderA, farA],
            [farA, farB],
            [farB, shoulderB],
            [shoulderB, mouthB],
            [mouthB, nearB],
        ].map(([a, b]) => ({
            x1: a.x, y1: a.y, x2: b.x, y2: b.y,
            halfThick: 2,
            _gateZoneBoundary: true,
            _movementOnly: true,
        }));
        for (const segment of segments) WallSystem.isoSegments.push(segment);

        const centerCells = 3;
        const cx = gateCenter.x + outward.x * centerCells;
        const cy = gateCenter.y + outward.y * centerCells;
        const xs = points.map(p => p.x), ys = points.map(p => p.y);
        return {
            x: Math.min(...xs), y: Math.min(...ys),
            w: Math.max(...xs) - Math.min(...xs),
            h: Math.max(...ys) - Math.min(...ys),
            cx, cy,
            points,
            _sprites: [tile, glow],
            _segments: segments,
        };
    },

    /**
     * 沼泽连续墙门外地块：轮廓、世界相位烘焙、出生/离场命中和活动边界全部复用
     * 僵尸门外飞地合同；唯一差异是格距从藤门真实底边跨度按六格反推，并沿30°墙体双轴展开。
     */
    _spawnSwampGateZone(info, diamond, isEntry) {
        const scene = window.__phaserScene;
        const gateSeg = info?.seg;
        if (!scene || !Array.isArray(gateSeg) || gateSeg.length < 2) return null;
        const rawA = gateSeg[0], rawB = gateSeg[1];
        if (!rawA || !rawB) return null;

        const gateDx = rawB.x - rawA.x;
        const gateDy = rawB.y - rawA.y;
        const gateLen = Math.hypot(gateDx, gateDy);
        if (gateLen < 1) return null;
        const tangentUnit = { x: gateDx / gateLen, y: gateDy / gateLen };
        const centerDx = info.center.x - diamond.cx;
        const centerDy = info.center.y - diamond.cy;
        const centerLen = Math.hypot(centerDx, centerDy) || 1;
        const outwardUnit = { x: centerDx / centerLen, y: centerDy / centerLen };

        // 藤门视觉跨度等价六格门洞；由真实跨度反推单格，四方向共用同一格距。
        // 合理夹限只防异常素材几何把平台放大/缩小，正常 swamp_gate 约落在76px。
        const cellStep = Math.max(56, Math.min(88, gateLen / Math.max(2, this._gridGateCells || 6)));
        const outward = { x: outwardUnit.x * cellStep, y: outwardUnit.y * cellStep };
        const tangent = { x: tangentUnit.x * cellStep, y: tangentUnit.y * cellStep };
        const sidePaddingCells = 1;
        const insideOverlapCells = 1;
        const outsideDepthCells = 5;
        const nearA = {
            x: rawA.x - outward.x * insideOverlapCells,
            y: rawA.y - outward.y * insideOverlapCells,
        };
        const nearB = {
            x: rawB.x - outward.x * insideOverlapCells,
            y: rawB.y - outward.y * insideOverlapCells,
        };
        const mouthA = { x: rawA.x + outward.x, y: rawA.y + outward.y };
        const mouthB = { x: rawB.x + outward.x, y: rawB.y + outward.y };
        const shoulderA = {
            x: mouthA.x - tangent.x * sidePaddingCells,
            y: mouthA.y - tangent.y * sidePaddingCells,
        };
        const shoulderB = {
            x: mouthB.x + tangent.x * sidePaddingCells,
            y: mouthB.y + tangent.y * sidePaddingCells,
        };
        const farA = {
            x: rawA.x - tangent.x * sidePaddingCells + outward.x * outsideDepthCells,
            y: rawA.y - tangent.y * sidePaddingCells + outward.y * outsideDepthCells,
        };
        const farB = {
            x: rawB.x + tangent.x * sidePaddingCells + outward.x * outsideDepthCells,
            y: rawB.y + tangent.y * sidePaddingCells + outward.y * outsideDepthCells,
        };
        const points = [
            nearA, nearB, mouthB, shoulderB,
            farB, farA, shoulderA, mouthA,
        ];
        const baked = bakeDungeonFloorPatch(points, { padding: 36 });
        if (!baked) return null;

        const zoneKey = isEntry ? 'gate_zone_tile_entry' : 'gate_zone_tile';
        if (scene.textures.exists(zoneKey)) scene.textures.remove(zoneKey);
        scene.textures.addCanvas(zoneKey, baked.canvas);
        const tile = scene.add.image(baked.x, baked.y, zoneKey);
        tile.setOrigin(0, 0);
        tile.setDepth(-999);

        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = baked.w;
        glowCanvas.height = baked.h;
        const gctx = glowCanvas.getContext('2d');
        gctx.shadowColor = '#ffffff';
        gctx.shadowBlur = 16;
        gctx.globalAlpha = 0.75;
        gctx.drawImage(baked.canvas, 0, 0);
        gctx.globalAlpha = 1;
        gctx.globalCompositeOperation = 'destination-out';
        gctx.drawImage(baked.canvas, 0, 0);
        // 门槛与房内地板的重叠带不发光，只保留平台外侧轮廓。
        const glowData = gctx.getImageData(0, 0, baked.w, baked.h);
        for (let py = 0; py < baked.h; py++) {
            for (let px = 0; px < baked.w; px++) {
                const worldX = baked.x + px;
                const worldY = baked.y + py;
                const outwardDistance = (worldX - info.center.x) * outwardUnit.x
                    + (worldY - info.center.y) * outwardUnit.y;
                if (outwardDistance <= cellStep * 1.35) {
                    glowData.data[(py * baked.w + px) * 4 + 3] = 0;
                }
            }
        }
        gctx.putImageData(glowData, 0, 0);
        gctx.globalCompositeOperation = 'source-over';
        const glowKey = isEntry ? 'gate_zone_glow_entry' : 'gate_zone_glow';
        if (scene.textures.exists(glowKey)) scene.textures.remove(glowKey);
        scene.textures.addCanvas(glowKey, glowCanvas);
        const glow = scene.add.image(baked.x, baked.y, glowKey);
        glow.setOrigin(0, 0);
        glow.setDepth(-998);
        scene.tweens.add({
            targets: glow,
            alpha: { from: 0.22, to: 0.38 },
            yoyo: true,
            repeat: -1,
            duration: 1200,
            ease: 'Sine.easeInOut',
        });

        const segments = [
            [nearA, mouthA],
            [mouthA, shoulderA],
            [shoulderA, farA],
            [farA, farB],
            [farB, shoulderB],
            [shoulderB, mouthB],
            [mouthB, nearB],
        ].map(([a, b]) => ({
            x1: a.x, y1: a.y, x2: b.x, y2: b.y,
            halfThick: 2,
            _gateZoneBoundary: true,
            _movementOnly: true,
        }));
        for (const segment of segments) WallSystem.isoSegments.push(segment);

        const centerCells = 3;
        const cx = info.center.x + outward.x * centerCells;
        const cy = info.center.y + outward.y * centerCells;
        const xs = points.map(point => point.x);
        const ys = points.map(point => point.y);
        return {
            x: Math.min(...xs), y: Math.min(...ys),
            w: Math.max(...xs) - Math.min(...xs),
            h: Math.max(...ys) - Math.min(...ys),
            cx, cy,
            points,
            _sprites: [tile, glow],
            _segments: segments,
        };
    },

    /** 门外白区：默认出口门；也可传入场门信息生成入场地块。 */
    _spawnGateExitZone(info = WallGate.getGateInfo(), diamond = this._diamond, gridSpan = this._gridGateSpan) {
        const scene = window.__phaserScene;
        if (!scene || !info || !info.center || !diamond) return null;
        const isEntry = !!this._arenaEntryZoneBaking;
        if (this._roomConstruction === 'worldBlock1x1' && gridSpan) {
            const zone = this._spawnWorldBlockGateZone(info, diamond, gridSpan, isEntry);
            if (isEntry) {
                this._arenaEntryZoneBaking = false;
                return zone;
            }
            this._gateZone = zone;
            return zone;
        }
        const wallStyle = WallSystem.getWallStyleGeos ? WallSystem.getWallStyleGeos() : null;
        if (wallStyle?.gate === 'swamp_gate' && info.seg) {
            const zone = this._spawnSwampGateZone(info, diamond, isEntry);
            if (isEntry) {
                this._arenaEntryZoneBaking = false;
                return zone;
            }
            this._gateZone = zone;
            return zone;
        }
        // 外法线（背离菱形中心）
        const dx = info.center.x - diamond.cx, dy = info.center.y - diamond.cy;
        const dl = Math.hypot(dx, dy) || 1;
        const nx = dx / dl, ny = dy / dl;

        // 地板晶格：用当前地牢的地板配置砖（高级/初级/中级各自地砖），与 dungeon-floor-texture 同一推导
        const profile = getDungeonFloorProfile();
        const tileKey = (profile && profile.tiles && profile.tiles.length > 0 && scene.textures.exists(profile.tiles[0]))
            ? profile.tiles[0]
            : (scene.textures.exists('blackbrick_7') ? 'blackbrick_7' : 'blackbrick5');
        const srcImg = scene.textures.get(tileKey).getSourceImage();
        const geo = this._tileGeoFor(tileKey);
        if (!geo) return;
        const stepX = geo.w, stepY = geo.h / 2;
        // 以门洞中心为锚：沿外法线推出菱形外 + 40px 边距（不做晶格吸附，防止被拽回主场景）
        const d = diamond;
        const insideDiamond = (x, y) => Math.abs(x - d.cx) / d.rx + Math.abs(y - d.cy) / d.ry <= 1;
        let px = info.center.x, py = info.center.y;
        let guard0 = 0;
        while (insideDiamond(px, py) && guard0++ < 60) {
            px += nx * 10;
            py += ny * 10;
        }
        const lx = px + nx * 40, ly = py + ny * 40;

        // 烘焙贴砖：画出整砖 → 裁掉菱形内部分（destination-out 菱形路径）→ 远角径向圆滑淡出
        const bw = srcImg.width, bh = srcImg.height;
        const canvas = document.createElement('canvas');
        canvas.width = bw;
        canvas.height = bh;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(srcImg, 0, 0);
        ctx.globalCompositeOperation = 'destination-out';
        // 砖内容中心在 (lx,ly)（origin 按 geo 锚点），菱形路径换算到贴图画布坐标
        const oxp = geo.cx, oyp = geo.cy;
        ctx.beginPath();
        ctx.moveTo(d.cx - lx + oxp, d.cy - d.ry - ly + oyp);
        ctx.lineTo(d.cx + d.rx - lx + oxp, d.cy - ly + oyp);
        ctx.lineTo(d.cx - lx + oxp, d.cy + d.ry - ly + oyp);
        ctx.lineTo(d.cx - d.rx - lx + oxp, d.cy - ly + oyp);
        ctx.closePath();
        ctx.fillStyle = 'rgba(0,0,0,1)';
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        // 远侧沿外法线线性淡出
        const imgData = ctx.getImageData(0, 0, bw, bh);
        const pdata = imgData.data;
        for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
                const idx = (y * bw + x) * 4;
                if (pdata[idx + 3] === 0) continue;
                const ex = (x - bw / 2) * nx + (y - bh / 2) * ny; // 沿外法线投影
                const t = Math.max(0, Math.min(1, ex / (bw * 0.35)));
                pdata[idx + 3] = Math.round(pdata[idx + 3] * (1 - t));
            }
        }
        ctx.putImageData(imgData, 0, 0);
        console.log(`[GateZone] bake v5: 远侧线性淡出 | tile=${tileKey} geo=${geo.w}x${geo.h}`);
        const zoneKey = isEntry ? 'gate_zone_tile_entry' : 'gate_zone_tile';
        if (scene.textures.exists(zoneKey)) scene.textures.remove(zoneKey);
        scene.textures.addCanvas(zoneKey, canvas);

        const tile = scene.add.image(lx, ly, zoneKey);
        tile.setOrigin(geo.cx / bw, geo.cy / bh);
        // 图层归入地形规则：地板扩展件与烘焙地形同层（-1000 附近），墙体/实体自然压上
        tile.setDepth(-999);
        tile.setScale(1.25); // 区域延伸 25%
        // 轮廓环绕光晕：从贴砖画布烘焙白色轮廓（本体抹除只留外发光），替代原白色光源；
        // 靠门一侧（拼接边）不发光——把朝门方向的光晕擦掉，只留外侧环绕
        const glowC = document.createElement('canvas');
        glowC.width = bw;
        glowC.height = bh;
        const gctx = glowC.getContext('2d');
        for (let i = 0; i < 3; i++) {
            gctx.shadowColor = '#ffffff';
            gctx.shadowBlur = 8 + i * 6;
            gctx.drawImage(canvas, 0, 0);
        }
        gctx.globalCompositeOperation = 'destination-out';
        gctx.drawImage(canvas, 0, 0);
        // 拼接侧（朝门方向 = 法线反方向）光晕渐隐擦除
        const sx = bw / 2 - nx * bw * 0.5, sy = bh / 2 - ny * bh * 0.5;
        const grad2 = gctx.createRadialGradient(sx, sy, 0, sx, sy, bw * 0.62);
        grad2.addColorStop(0, 'rgba(0,0,0,1)');
        grad2.addColorStop(0.7, 'rgba(0,0,0,0.9)');
        grad2.addColorStop(1, 'rgba(0,0,0,0)');
        gctx.fillStyle = grad2;
        gctx.fillRect(0, 0, bw, bh);
        gctx.globalCompositeOperation = 'source-over';
        const glowKey = isEntry ? 'gate_zone_glow_entry' : 'gate_zone_glow';
        if (scene.textures.exists(glowKey)) scene.textures.remove(glowKey);
        scene.textures.addCanvas(glowKey, glowC);
        const glow = scene.add.image(lx, ly, glowKey);
        glow.setOrigin(geo.cx / bw, geo.cy / bh);
        glow.setScale(1.25);
        glow.setDepth(-998);
        scene.tweens.add({ targets: glow, alpha: { from: 0.3, to: 0.6 }, yoyo: true, repeat: -1, duration: 1100, ease: 'Sine.easeInOut' });
        const zw = stepX * 1.25, zh = stepY * 2 * 1.25;
        const zone = {
            x: lx - zw / 2, y: ly - zh / 2, w: zw, h: zh,
            cx: lx, cy: ly, // 贴砖中心（光晕锚点）
            _sprites: [tile, glow],
        };
        if (isEntry) {
            this._arenaEntryZoneBaking = false;
            return zone; // 入场地块：调用方存放到 _arena.entryZone
        }
        this._gateZone = zone;
        return zone;
    },

    /** 玩家是否真正走出门外白区（必须在白区内且已走出菱形边界，门内擦边不算） */
    isPlayerInGateZone(player) {
        const z = this._gateZone;
        if (!z || !player || !this._diamond) return false;
        const d = this._diamond;
        const outside = Math.abs(player.x - d.cx) / d.rx + Math.abs(player.y - d.cy) / d.ry > 1;
        if (!outside) return false;
        if (z.points) return this._pointInPolygon(player.x, player.y, z.points);
        return player.x >= z.x && player.x <= z.x + z.w && player.y >= z.y && player.y <= z.y + z.h;
    },

    /** 每帧驱动：门闸动画推进 + 悬停金色轮廓（dungeon-map-system.updateCombat 调用） */
    update(dt) {
        WallGate.update(dt);
        // 陷阱：占用判定/延迟/动画/倒放/冷却
        if (typeof TrapSystem !== 'undefined') TrapSystem.update(dt);
        // 宝箱房：倒计时/超时淡出/靠近开箱（仅精英战存在）
        if (typeof ChestRoomSystem !== 'undefined' && ChestRoomSystem.active) {
            ChestRoomSystem.update(dt, this._player);
        }
        // 悬停高亮：鼠标世界坐标距门洞中心 < 90px
        const info = WallGate.getGateInfo();
        if (info && info.center && Input && Input.mouse) {
            const mw = Renderer && Renderer.screenToWorld ? Renderer.screenToWorld(Input.mouse.x, Input.mouse.y) : null;
            if (mw) {
                const near = Math.hypot(mw.x - info.center.x, mw.y - info.center.y) < 90;
                WallGate.setHighlight(near);
            }
        }
    },

    /** 清理门闸与白区（cleanupRoom 调用） */
    cleanupGate() {
        WallGate.destroy();
        GateLight.destroy();
        // 竞技场通道门（三房间串联）：拆门 sprite/碰撞段，墙件随场景恢复还原
        this._cleanupArenaGates();
        // 宝箱房（精英战）：拆门墙/宝箱/倒计时，直墙件随场景恢复还原
        if (typeof ChestRoomSystem !== 'undefined') ChestRoomSystem.cleanup();
        // 销毁残留 X 光透视对象（墙后金币/怪物的透视圈与克隆会带到地图界面）
        if (typeof window !== 'undefined' && window.__phaserScene && typeof window.__phaserScene._purgeXRayCircles === 'function') {
            window.__phaserScene._purgeXRayCircles();
        }
        if (this._gateZone) {
            this._destroyGateZone(this._gateZone);
            this._gateZone = null;
        }
        // 地板装饰点缀清理
        if (this._decoSprites) {
            for (const s of this._decoSprites) {
                if (s && s.scene) s.destroy();
            }
            this._decoSprites = null;
        }
    },

    cleanupRoom() {
        // 冰墙等玩家技能动态障碍：房间拆除时一并清理（防跨房间残留/待生成幽灵碰撞）
        if (this._player && this._player.iceWallSystem && typeof this._player.iceWallSystem.breakdown === 'function') {
            this._player.iceWallSystem.breakdown();
        }
        
        // 清理门闸与门外白区/光束
        this.cleanupGate();
        // 清理陷阱（贴图销毁）
        TrapSystem.cleanup();

        // 清理掉落物（金币、装备等）
        this.cleanupDrops();

        // 删除所有战斗怪物（经统一入口，同步销毁贴图，避免尸体残留）。
        // 离场拆房不再保留存活尸体：地牢 map 状态实体更新暂停（game.js 早退），尸体计时器冻结，
        // 保留下来只会把尸体贴图带进下一场战斗房（"胖子僵尸/矿石蜘蛛尸体没清理"根因）；
        // 存活尸体跳过仅用于 cleanupMonstersOnly（波次间同房保留，腐蚀光环继续生效）
        const Game = gameRef();
        for (const key of this._combatMonsterKeys) {
            if (Game && typeof Game.removeEntity === 'function') {
                Game.removeEntity(key);
            }
        }
        // 兜底清理战斗召唤物（巫师召唤犬 zombieDog_ / 集合体召唤 amalgam_ / 矿洞召唤矿工 / 墓碑召唤僵尸，未进追踪列表的泄漏）
        if (Game && typeof Game.removeEntitiesByPrefix === 'function') {
            Game.removeEntitiesByPrefix('zombieDog_', 'amalgam_fat_', 'amalgam_zombie_', 'mineCave_miner_', 'mineCave_lantern_', 'tombstone_');
        }
        this._combatMonsters = [];
        this._combatMonsterKeys = [];

        // 恢复原始场景状态
        this._restoreSceneState();

        // 重置状态
        this.active = false;
        this.state = 'idle';
        this._roomSize = 1024;
        this._roomBounds = null;
        this._entranceEdge = null;
        this._oppositeEdge = null;
        this._roomConstruction = 'continuous';
        this._gridEdgeCells = 0;
        this._gridGateCells = 6;
        this._gridGateSpan = null;
        this._player = null;

        
    },

    /**
     * 仅清理怪物（保留场地，用于多波次战斗）
     * F/E 单房间跨波次：保留墓碑及其召唤物（tombstone_ 前缀，25% 刷新的召唤器持续生效）；
     * D+ 竞技场换房间（this._arena 存在）：照常全部清理
     */
    cleanupMonstersOnly() {
        // 经统一入口删除，同步销毁贴图（修复多波次战斗胖子僵尸尸体残留）；
        // 存活尸体（如胖子僵尸尸体）跳过删除，按自身计时器走完生命周期、持续造成腐蚀伤害
        const Game = gameRef();
        const preserveTombstone = !this._arena;
        for (const key of this._combatMonsterKeys) {
            if (preserveTombstone && key.startsWith('tombstone_')) continue;
            if (Game && typeof Game.removeEntity === 'function') {
                if (typeof Game.isPreservedCorpse === 'function' && Game.isPreservedCorpse(Game.entities.get(key))) continue;
                Game.removeEntity(key);
            }
        }
        // 兜底清理战斗召唤物（巫师召唤犬 zombieDog_ / 集合体召唤 amalgam_ / 矿洞召唤矿工，未进追踪列表的泄漏）；
        // 墓碑系（tombstone_ 主键与召唤物）在 F/E 跨波次保留，竞技场换房间才走前缀清理
        if (Game && typeof Game.removeEntitiesByPrefix === 'function') {
            const prefixes = ['zombieDog_', 'amalgam_fat_', 'amalgam_zombie_', 'mineCave_miner_', 'mineCave_lantern_'];
            if (!preserveTombstone) prefixes.push('tombstone_');
            Game.removeEntitiesByPrefix(...prefixes);
        }
        this._combatMonsters = [];
        this._combatMonsterKeys = [];
        
    },

    /**
     * 获取当前场地信息
     * @returns {Object|null}
     */
    getRoomInfo() {
        if (!this.active) return null;
        return {
            size: this._roomSize,
            bounds: this._roomBounds,
            entranceEdge: this._entranceEdge,
            oppositeEdge: this._oppositeEdge,
            state: this.state,
            monsterCount: this._combatMonsters.length
        };
    },

    // ============================================================
    // 内部方法：场景备份与恢复
    // ============================================================

    _backupSceneState() {
        // 备份墙壁
        if (WallSystem && WallSystem.walls) {
            this._backupWalls = [...WallSystem.walls];
            this._backupTrees = WallSystem.trees ? [...WallSystem.trees] : [];
            this._backupIsoVisuals = WallSystem.isoVisuals ? [...WallSystem.isoVisuals] : [];
        }

        // 备份地形纹理
        if (Renderer && Renderer.terrainTexture) {
            this._backupTerrain = Renderer.terrainTexture;
        }

        // 备份世界尺寸
        if (CONFIG) {
            this._backupWorldSize = {
                width: CONFIG.WORLD_WIDTH || 1024,
                height: CONFIG.WORLD_HEIGHT || 1024
            };
        }

        // 备份相机跟随函数
        if (Camera) {
            this._backupCameraFollow = Camera.follow.bind(Camera);
        }

        
    },

    _restoreSceneState() {
        // 恢复墙壁
        if (WallSystem) {
            WallSystem.walls = [...this._backupWalls];
            WallSystem.isoVisuals = this._backupIsoVisuals ? [...this._backupIsoVisuals] : [];
            if (WallSystem.trees) {
                WallSystem.trees = [...this._backupTrees];
            }
            // 重建等距墙碰撞：战斗房墙段（isoSegments/_iso 阶梯矩形）随战斗清理残留成幽灵碰撞，
            // 按恢复后的 isoVisuals 全量重建（rebuildIsoCollision 保留 _gate/_chestGate 段，
            // 但 cleanupGate 已先于本方法销毁门实体并摘除其线段，此处无门段可误留）
            if (WallSystem.rebuildIsoCollision) {
                WallSystem.rebuildIsoCollision();
            }
            if (WallSystem._syncWallsToPhaser) {
                WallSystem._syncWallsToPhaser();
            }
        }

        // 恢复地形纹理
        if (Renderer && this._backupTerrain) {
            Renderer.terrainTexture = this._backupTerrain;
        }

        // 恢复世界尺寸
        if (CONFIG) {
            CONFIG.WORLD_WIDTH = this._backupWorldSize.width;
            CONFIG.WORLD_HEIGHT = this._backupWorldSize.height;
        }

        // 地形纹理已恢复，立即同步到 Phaser（此前缺失导致残留战斗房地板）
        if (typeof window !== 'undefined' && window.__phaserScene && typeof window.__phaserScene.syncTerrain === 'function') {
            window.__phaserScene.syncTerrain();
        }

        // 恢复相机跟随
        if (Camera && this._backupCameraFollow) {
            Camera.follow = this._backupCameraFollow;
            if (this._player) {
                Camera.follow(this._player);
            }
        }

        // 标记路径缓存失效
        if (pathFinder && pathFinder.invalidateCache) {
            pathFinder.invalidateCache();
        }

        
    },

    // ============================================================
    // 多房间串联竞技场
    // ============================================================
    //
    // 布局：N 个菱形房间按配置直线或蛇形串联（combat-arena-layout.js 纯函数计算），
    // 末房 = eliteSize（含宝箱事件）；相邻房间在对应出/入边的墙壁中段
    // 开洞，用摆墙编辑器的通道预制（「上下通道」/「左右通道」镜像套）连接；
    // 预制的门墙件建成可开闭功能门（_arenaGate 碰撞段，初始常开），
    // 末房出口边中段的 WallGate 单例 + 门外白区作为清完后的退出区域。
    //
    // 波次编排（dungeon-map-system）：进入房间 N 才关门刷第 N 波，清完开门。

    /**
     * 进入多房间串联竞技场
     * @param {Object} player 玩家实体
     * @param {Object} options { normalSize, eliteSize, roomCount }
     * @returns {Object|false} 场地信息 { rooms, worldW, worldH }；预制缺失/轴向不符返回 false（调用方回退单房间）
     */
    enterCombatArena(player, options = {}) {
        if (!player) {
            console.error('[CombatRoomSystem] enterCombatArena: player is required');
            return false;
        }

        const roomProfile = DungeonConfig.getCombatRoomConfig(options.dungeonType);
        const worldBlockArena = roomProfile.wallConstruction === 'worldBlock1x1';
        this._roomConstruction = roomProfile.wallConstruction || 'continuous';
        this._gridGateCells = Math.max(2, Math.round(roomProfile.gateCells || 6));

        // 1. 连续墙竞技场解析通道预制；单格墙标准直接使用整数格几何。
        const arenaCfg = DungeonConfig.getCombatArenaConfig(options.dungeonType);
        const analysisV1 = worldBlockArena ? null : this._resolvePassagePrefab(arenaCfg, MAZE_AXIS_V1);
        if (!worldBlockArena && !analysisV1) {
            console.warn('[CombatRoomSystem] 竞技场：无可用通道预制（combatArena.passagePrefabs），回退单房间');
            return false;
        }
        // 迷宫折返用 v2（上下通道）预制；缺失则迷宫降级为三房直线
        const analysisV2 = worldBlockArena ? null : this._resolvePassagePrefab(arenaCfg, MAZE_AXIS_V2);
        const analysisFor = (axis) => {
            const isV2 = Math.abs(axis.x * MAZE_AXIS_V2.x + axis.y * MAZE_AXIS_V2.y) > 0.8;
            return isV2 && analysisV2 ? analysisV2 : analysisV1;
        };

        const normalSize = options.normalSize || this.config.roomSize.normal;
        const eliteSize = options.eliteSize || this.config.roomSize.elite;
        const mazeCfg = arenaCfg.maze || {};
        const configuredRoomCount = mazeCfg.enabled !== false ? (mazeCfg.roomCount || 3) : 3;
        const roomCount = Math.max(2, Math.floor(Number(options.roomCount) || configuredRoomCount));
        const mazeEnabled = roomCount >= 4 && mazeCfg.enabled !== false;
        let layout;
        if (worldBlockArena) {
            const sizes = [];
            for (let i = 0; i < roomCount; i++) sizes.push(i === roomCount - 1 ? eliteSize : normalSize);
            layout = computeGridMazeLayout({
                sizes,
                corridorCells: roomProfile.passageCells || 12,
                rows: mazeEnabled ? (mazeCfg.rows || 0) : 1,
                cellW: ONE_CELL_BUILDING_FOOT.w,
                cellD: ONE_CELL_BUILDING_FOOT.d,
            });
        } else if (roomCount <= 3 || !analysisV2) {
            // 三房直线串联（历史行为）：房间 1/2 normal、房间 3 elite
            layout = computeArenaLayout({
                normalSize, eliteSize,
                passageLen: analysisV1.len,
                gap: arenaCfg.passageGap || 0,
                roomCount,
            });
        } else {
            // 多房蛇形迷宫：除末房 elite（宝箱房）外全 normal
            const sizes = [];
            for (let i = 0; i < roomCount; i++) sizes.push(i === roomCount - 1 ? eliteSize : normalSize);
            layout = computeMazeLayout({
                sizes,
                passageLen: analysisV1.len,
                gap: arenaCfg.passageGap || 0,
                rows: mazeCfg.rows || 0,
            });
        }

        this._player = player;
        this.state = 'combat';
        this.active = true;

        // 2. 备份场景（离场时 cleanupRoom → _restoreSceneState 一次性恢复）
        this._backupSceneState();

        // 3. 地形：N 房地板 + 通道精确平行四边形（并集裁剪）+ 连续墙脚阴影
        //    （E/F 同口径：菱形整圈渐变含门口；走廊只描两条长边），并同步世界尺寸
        const corridors = [];
        const patches = [];
        if (worldBlockArena) {
            for (const room of layout.rooms) {
                room._gridOpenings = {};
                for (const edge of new Set([room.inEdge, room.outEdge])) {
                    room._gridOpenings[edge] = this._worldBlockOpeningGeometry(room, edge);
                }
            }
        }
        for (let i = 0; i < layout.passages.length; i++) {
            corridors.push(worldBlockArena
                ? this._worldBlockPassageFloorQuad(layout.passages[i], layout.rooms[i], layout.rooms[i + 1])
                : this._arenaPassageFloorQuad(analysisFor(layout.passages[i].axis), layout.passages[i], layout.rooms[i], layout.rooms[i + 1]));
        }
        applyArenaFloor(layout.worldW, layout.worldH,
            layout.rooms.map(r => ({ cx: r.cx, cy: r.cy, rx: r.rx, ry: r.ry })),
            corridors, patches, this.config.terrain);

        // 4. 墙体：N 房菱形墙（一次清空后逐房追加；线性布局全部 LT/RB 同构）
        WallSystem.walls = [];
        WallSystem.trees = [];
        WallSystem.isoVisuals = [];
        for (const r of layout.rooms) {
            if (worldBlockArena) {
                r._gridOpenings = this._appendWorldBlockRoomWalls(r, [r.inEdge, r.outEdge]);
            } else {
                WallSystem.buildIsoDiamondWalls(r.cx, r.cy, r.rx, r.ry);
            }
        }

        // 5. 通道：平移预制 → 摘门洞覆盖的墙件（"移除对应大小的墙"）→ 直墙入件 / 门墙建功能门
        const passageRecs = [];
        for (let i = 0; i < layout.passages.length; i++) {
            const rec = worldBlockArena
                ? this._placeWorldBlockPassage(layout.passages[i], layout.rooms[i], layout.rooms[i + 1])
                : this._placeArenaPassage(analysisFor(layout.passages[i].axis), layout.passages[i], layout.rooms[i], layout.rooms[i + 1]);
            if (!rec) {
                console.warn('[CombatRoomSystem] 竞技场：通道放置失败，回退单房间');
                // 已放好的通道门（如前一条通道）手动销毁——_arena 尚未建立，_cleanupArenaGates 管不到
                for (const done of passageRecs) {
                    for (const inst of done.gates) {
                        if (WallSystem.isoSegments) {
                            for (const s of [...inst.wallSegs, inst.gateSeg]) {
                                const si = WallSystem.isoSegments.indexOf(s);
                                if (si >= 0) WallSystem.isoSegments.splice(si, 1);
                            }
                        }
                        for (const gateSprite of inst.sprites || [inst.sprite]) {
                            if (gateSprite && gateSprite.scene) gateSprite.destroy();
                        }
                    }
                }
                this._restoreSceneState();
                this.active = false;
                this.state = 'idle';
                this._player = null;
                return false;
            }
            passageRecs.push(rec);
        }

        // 5.5 通道侧墙封口：预制侧墙比门到门跨度短，且与房间墙成 60° 相接，
        //     两侧各留一个楔形缺口（可见黑三角/可走出世界）——沿侧墙延长线补瓦到房间边线
        if (!worldBlockArena) {
            for (let i = 0; i < layout.passages.length; i++) {
                this._sealPassageSides(analysisFor(layout.passages[i].axis), layout.passages[i], layout.rooms[i], layout.rooms[i + 1]);
            }
        }

        WallSystem.rebuildIsoCollision();
        if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();

        // 6. 竞技场状态（_diamond 固定指向最后一房：出口门/白区/离场判定都以其为准；
        //    _roomBounds 指向当前战斗房间，随 stage 切换——刷怪/墓碑共用现有逻辑）
        const rLast = layout.rooms[layout.rooms.length - 1];
        this._arena = { rooms: layout.rooms, passages: passageRecs, stage: 1, awaiting: 0 };
        this._diamond = { rx: rLast.rx, ry: rLast.ry, cx: rLast.cx, cy: rLast.cy, worldW: layout.worldW, worldH: layout.worldH };
        this._roomBounds = layout.rooms[0].bounds;
        this._entranceEdge = 0;
        this._oppositeEdge = 2; // 怪物统一刷当前房间下顶点附近

        // 8. 出口门：最后一房出口边中点（三房=RB；迷宫末房 = 入口对边，可能是 LT/TR/BL）
        //    straightOnly——各房有转角装饰门，必须锚定目标边中点
        const outMid = {
            LT: { x: rLast.cx - rLast.rx / 2, y: rLast.cy - rLast.ry / 2 },
            TR: { x: rLast.cx + rLast.rx / 2, y: rLast.cy - rLast.ry / 2 },
            RB: { x: rLast.cx + rLast.rx / 2, y: rLast.cy + rLast.ry / 2 },
            BL: { x: rLast.cx - rLast.rx / 2, y: rLast.cy + rLast.ry / 2 },
        }[rLast.outEdge || 'RB'];
        this._gridGateSpan = worldBlockArena ? rLast._gridOpenings[rLast.outEdge] : null;
        this._setupGate(outMid, { straightOnly: true });

        // 8.1 入场门：房间 1 左上墙（LT 边）中段直墙件原位替换为门墙（初始常开）+ 门外入场地块
        const firstRoom = layout.rooms[0];
        const entrySpan = worldBlockArena ? firstRoom._gridOpenings[firstRoom.inEdge] : null;
        const entryGate = worldBlockArena
            ? this._createArenaGate(this._buildGatePieceAt(
                entrySpan.a, entrySpan.b, entrySpan.flip, entrySpan.depth, { fitSpan: true }))
            : this._setupEntryGate(firstRoom);
        if (worldBlockArena && !entryGate && entrySpan) {
            WallSystem.isoVisuals.push(...entrySpan.fillPieces);
        }
        let entryZone = null;
        if (entryGate) {
            const r1d = layout.rooms[0];
            this._arenaEntryZoneBaking = true;
            entryZone = this._spawnGateExitZone(
                { center: entryGate.center, seg: [entryGate.baseA, entryGate.baseB], flip: entryGate.sprite ? entryGate.sprite.flipX : false },
                { cx: r1d.cx, cy: r1d.cy, rx: r1d.rx, ry: r1d.ry },
                entrySpan
            );
            if (this._arena) {
                this._arena.entryGate = entryGate;
                this._arena.entryZone = entryZone;
            }
        }

        // 8.6 开洞边缝隙填充：沿房间边线投影补瓦（只叠不缺，edgeFill 同口径）——
        //     动态边集合：每房来路/去路通道边 + 房1 LT（入场门）+ 末房 RB（出口门）
        const lastIdx = layout.rooms.length;
        if (!worldBlockArena) {
            const allGateSegs = passageRecs.flatMap(rec => rec.gates.map(g => [g.baseA, g.baseB]));
            if (WallGate._seg) allGateSegs.push(WallGate._seg);
            if (entryGate) allGateSegs.push([entryGate.baseA, entryGate.baseB]);
            for (const r of layout.rooms) {
                const edges = new Set();
                if (r.index === 1) edges.add('LT');                 // 入场门
                if (r.index === lastIdx) edges.add('RB');           // 出口门
                if (r.index < lastIdx) edges.add(r.outEdge);        // 去路通道
                if (r.index > 1) edges.add(r.inEdge);               // 来路通道
                for (const e of edges) this._fillEdgeGaps(r, e, allGateSegs);
            }
        }

        // 8.5 障碍物：每房独立一套（墙面火把贴墙无碰撞；房间 1/2 中央石柱；
        //     后墙预制组合只贴 LT/RT），避开门口/玩家出生点
        const r1 = layout.rooms[0];
        // 玩家出生点 = 入场地块中心（无入场门时回退房间 1 中心偏上）
        const spawnX = entryZone ? entryZone.cx : r1.cx;
        const spawnY = entryZone ? entryZone.cy : r1.cy - r1.ry * 0.3;
        const exitInfo = WallGate.getGateInfo();
        const gateNear = (rec, mid) => {
            let best = null, bd = Infinity;
            for (const inst of rec.gates) {
                const d = Math.hypot(inst.center.x - mid.x, inst.center.y - mid.y);
                if (d < bd) { bd = d; best = inst; }
            }
            return best ? best.center : mid;
        };
        for (const r of layout.rooms) {
            const avoid = [];
            if (r.index === 1) avoid.push({ x: spawnX, y: spawnY, r: 150 });
            // 入场门（门口 220px 不放火把）
            if (r.index === 1 && entryGate) {
                avoid.push({ x: entryGate.center.x, y: entryGate.center.y, r: 220 });
            }
            // 来路门（房间 2/3：上一条通道的 gB 端）
            if (r.index > 1) {
                const c = gateNear(passageRecs[r.index - 2], layout.passages[r.index - 2].mid2);
                avoid.push({ x: c.x, y: c.y, r: 220 });
            }
            // 去路门（房间 1/2：下一条通道的 gA 端）
            if (r.index < layout.rooms.length) {
                const c = gateNear(passageRecs[r.index - 1], layout.passages[r.index - 1].mid1);
                avoid.push({ x: c.x, y: c.y, r: 220 });
            }
            // 出口门
            if (r.index === lastIdx && exitInfo && exitInfo.center) {
                avoid.push({ x: exitInfo.center.x, y: exitInfo.center.y, r: 220 });
            }
            ObstacleSpawnSystem.spawnForRoom(r.bounds, {
                dungeonType: options.dungeonType,
                roomIndex: r.index, // 房间 1/2 生成中央石柱；房间 3 宝箱房不生成
                avoidPoints: avoid,
            });
        }
        // 8.7 通道火把：每条通道右手侧墙按固定间隔均布（贴墙、无碰撞；仅僵尸大类）
        ObstacleSpawnSystem.spawnForPassages(passageRecs, {
            dungeonType: options.dungeonType,
        });
        WallSystem.rebuildIsoCollision();
        if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();

        // 9. 玩家生成：房间 1 中心偏上（防嵌墙兜底）
        player.x = spawnX;
        player.y = spawnY;
        if (WallSystem.canMoveTo && !WallSystem.canMoveTo(player.x, player.y, player.groundRadius || 20) && WallSystem.findSafeSpawn) {
            const safe = WallSystem.findSafeSpawn(player.x, player.y, player.groundRadius || 20);
            player.x = safe.x;
            player.y = safe.y;
        }
        const Game = gameRef();
        if (Game && Game.entities) Game.entities.set('player', player);

        // 10. 相机
        this._setupCamera(player);

        return { rooms: layout.rooms, worldW: layout.worldW, worldH: layout.worldH };
    },

    /** 取样式对应的预制名（兼容旧字符串 = v1；新格式 { v1, v2 } 按通道轴取值） */
    _passagePrefabName(names, axis) {
        if (!names) return null;
        if (typeof names === 'string') return names;
        const isV2 = Math.abs(axis.x * MAZE_AXIS_V2.x + axis.y * MAZE_AXIS_V2.y) > 0.8;
        return isV2 ? (names.v2 || names.v1) : (names.v1 || names);
    },

    /**
     * 解析通道预制：按通道轴（v1 左右 / v2 上下）选样式键 → default 回退；
     * 校验双门墙件与轴对齐（|dot| ≥ 0.8）。返回 analysis 含预制固有轴 axis。
     */
    _resolvePassagePrefab(arenaCfg, axis = MAZE_AXIS_V1) {
        const lib = getWallPrefabLibrary();
        const names = (arenaCfg && arenaCfg.passagePrefabs) || { default: '左右通道' };
        // 当前墙样式键（zombie/swamp…）：取样式表第一个键名末段做模糊匹配，找不到再用 default
        const candidates = [];
        const style = WallSystem.getWallStyle ? WallSystem.getWallStyle() : null;
        if (style && style.chestPrefab) {
            // 样式表以 chestPrefab 区分（宝箱房/沼泽宝箱房）：含"沼泽"键优先沼泽通道
            const isSwamp = /沼泽/.test(style.chestPrefab);
            if (isSwamp) candidates.push(this._passagePrefabName(names.swamp, axis));
        }
        candidates.push(this._passagePrefabName(names.default, axis));
        for (const name of candidates) {
            if (!name || !lib[name]) continue;
            const analysis = this._analyzePassagePrefab(lib[name]);
            if (analysis) return analysis;
            console.warn(`[CombatRoomSystem] 通道预制「${name}」轴向不符或门墙件不足，尝试下一候选`);
        }
        return null;
    },

    /**
     * 预制解析：提取两个功能门墙件的底边中心与间距（通道长度）。
     * 轴校验改为双轴（v1=(0.866,0.5) 左右通道 / v2=(0.866,-0.5) 上下通道），
     * 取 |dot| 大者，交换 gA/gB 使预制固有轴 axis 与 v1/v2 同向。
     */
    _analyzePassagePrefab(def) {
        if (!def || !Array.isArray(def.pieces)) return null;
        const gates = [];
        for (const p of def.pieces) {
            if (!this._isFunctionalGatePiece(p)) continue;
            const seg = WallSystem._pieceBaseSegments(p)[0];
            if (!seg) continue;
            gates.push({
                piece: p,
                center: { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 },
            });
        }
        if (gates.length !== 2) return null;
        let [gA, gB] = gates;
        let vx = gB.center.x - gA.center.x, vy = gB.center.y - gA.center.y;
        const len = Math.hypot(vx, vy);
        if (len < 100) return null;
        // 双轴对齐校验：v1（左右）/ v2（上下），取 |dot| 大者；反向则交换两端
        const dot1 = (vx * MAZE_AXIS_V1.x + vy * MAZE_AXIS_V1.y) / len;
        const dot2 = (vx * MAZE_AXIS_V2.x + vy * MAZE_AXIS_V2.y) / len;
        let axis;
        if (Math.abs(dot1) >= Math.abs(dot2) && Math.abs(dot1) >= 0.8) {
            axis = { ...MAZE_AXIS_V1 };
            if (dot1 < 0) { [gA, gB] = [gB, gA]; }
        } else if (Math.abs(dot2) >= 0.8) {
            axis = { ...MAZE_AXIS_V2 };
            if (dot2 < 0) { [gA, gB] = [gB, gA]; }
        } else {
            return null;
        }
        // 门墙底边跨度（梯形地板的门口端宽度用）
        const segA = WallSystem._pieceBaseSegments(gA.piece)[0];
        const span = segA ? Math.hypot(segA[1].x - segA[0].x, segA[1].y - segA[0].y) : 300;
        return { def, gA, gB, len, span, axis };
    },

    /** 是否功能门墙件（有门洞几何且非永久开放装饰门、非障碍物） */
    _isFunctionalGatePiece(p) {
        const g = WallSystem._geoForTex(p.tex);
        return !!(g && g.category !== 'obstacle' && !g.openDoor && isoGateHole(g));
    },

    /**
     * 放置一条通道：预制按 gA→mid1 纯平移（gB 应落 mid2，容差 80px）；
     * 先两轮摘除两门覆盖的墙件，再把直墙件推入 isoVisuals、门墙件建功能门（初始常开）
     * ⚠ 2026-08-08 多房迷宫：预制固有轴与通道轴反向时（如蛇形折返排沿 -v1 走），
     * 整组绕 gA 中心旋转 180°（x' = 2*gA.x − x，y' = 2*gA.y − y，flipX/flipY 取反）
     * 再平移——旋转后 gA 端原位、gB 端翻到对侧，底边/门洞几何经 texPointToWorld
     * 的 flip 变换自动正确，无需维护四方向预制数据。
     */
    _placeArenaPassage(analysis, passage, roomA, roomB) {
        const mirror = analysis.axis
            && (analysis.axis.x * passage.axis.x + analysis.axis.y * passage.axis.y) < -0.8;
        const gAX = analysis.gA.center.x, gAY = analysis.gA.center.y;
        const t = { x: passage.mid1.x - gAX, y: passage.mid1.y - gAY };
        const gBx = mirror ? 2 * gAX - analysis.gB.center.x : analysis.gB.center.x;
        const gBy = mirror ? 2 * gAY - analysis.gB.center.y : analysis.gB.center.y;
        const bx = gBx + t.x, by = gBy + t.y;
        if (Math.hypot(bx - passage.mid2.x, by - passage.mid2.y) > 80) {
            console.warn('[CombatRoomSystem] 通道预制长度与房间间距不符',
                Math.round(Math.hypot(bx - passage.mid2.x, by - passage.mid2.y)), 'px');
            return null;
        }
        // 第一轮：先旋转 180°（反向通道）再平移全部件；门墙先"移除对应大小的墙"
        const translated = analysis.def.pieces.map(p => {
            let piece;
            if (!mirror) {
                piece = { ...p, x: p.x + t.x, y: p.y + t.y, depth: p.depth != null ? p.depth + t.y : p.depth };
            } else {
            // ⚠ 2026-08-11 三修（用户定案"复制通道 + 镜像翻转"）：180° 镜像按几何重做——
            // 反射件**底边线段**（绕 gA 底边中心），再由墙体系统从反射底边**重建件**。
            // 旧"位置反射 + flipX(±flipY) 翻转"会把门墙精灵锚点翻错（门洞错位）、
            // 贴图朝向翻反（"4→5 方向反了"）——重建让锚点/缩放/朝向全部由几何自动推导，
            // 与正向通道（房 1-3）完全同构。
            const seg = WallSystem._pieceBaseSegments(p)[0];
            if (!seg) {
                // 无底边的装饰件：位置反射 + flipX/flipY 双翻
                piece = {
                    ...p,
                    x: 2 * gAX - p.x + t.x,
                    y: 2 * gAY - p.y + t.y,
                    flipX: !p.flipX,
                    flipY: !(p.flipY ?? false),
                    depth: p.depth != null ? p.depth + t.y : p.depth,
                };
            } else {
                let A = { x: 2 * gAX - seg[0].x + t.x, y: 2 * gAY - seg[0].y + t.y };
                let B = { x: 2 * gAX - seg[1].x + t.x, y: 2 * gAY - seg[1].y + t.y };
                // 上端在前（_addSegPiece/_buildGatePieceAt 的 A=上端约定，保证 sy>0 不倒置）
                if (B.y < A.y) { const tmp = A; A = B; B = tmp; }
                if (this._isFunctionalGatePiece(p)) {
                    piece = this._buildGatePieceAt(A, B, !!p.flipX, p.depth != null ? p.depth + t.y : undefined);
                } else {
                    const geoKey = Object.keys(ISO_WALL_GEO).find(k => ISO_WALL_GEO[k].tex === p.tex);
                    piece = WallSystem._buildSegPiece(A, B, !!p.flipX, geoKey || 'straight', 'max');
                }
            }
            }
            // ⚠ 2026-08-11：样式重映射——默认预制（wall_straight/wall_gate）按当前墙样式
            // 重建件（新地牢换墙自动获得匹配的通道墙/铁闸门，无需为每套样式维护专属通道预制）
            return this._remapPassagePieceToStyle(piece);
        });
        for (const q of translated) {
            if (!this._isFunctionalGatePiece(q)) continue;
            const seg = WallSystem._pieceBaseSegments(q)[0];
            if (seg) WallSystem.removeSpanCoveringPieces(seg);
        }
        // 第二轮：直墙件入件、门墙件建功能门（深度全场统一 max 规则）
        const gates = [];
        for (const q of translated) {
            if (this._isFunctionalGatePiece(q)) {
                const inst = this._createArenaGate(q);
                if (inst) gates.push(inst);
            } else {
                // 直墙件裁剪：越进房间内部的部分裁掉（预制侧墙比门到门跨度长，
                // 60° 相接处会越过房间边线探入房内/横跨门口——"墙壁突出通道"的根因）
                const clipped = this._clipPassagePieceToRooms(q, passage, roomA, roomB);
                if (clipped) {
                    // 深度统一走 WallSystem.depthOf 唯一入口（丢弃预制保存的 hub 坐标深度值）
                    clipped.depth = WallSystem.depthOf(clipped);
                    // ⚠ 2026-08-08 八修：标记预制侧墙件——_sealPassageSides 只收集带标记的
                    // 侧墙，避免迷宫转弯通道（v2/-v1 轴）误收集相邻房间的平行边墙
                    // （房3/房4 的 TR/BL/LT 边与通道轴平行、perp 落在侧墙带内 →
                    // 封口瓦被补到通道中间，横墙挡路）
                    clipped._passageWall = true;
                    WallSystem.isoVisuals.push(clipped);
                }
            }
        }
        return { index: passage.index, mid1: passage.mid1, mid2: passage.mid2, center: passage.center, gates };
    },

    /** 通道预制件按当前墙样式重映射（默认纹理 → 当前样式纹理，几何从底边重建） */
    _remapPassagePieceToStyle(piece) {
        const style = WallSystem.getWallStyleGeos ? WallSystem.getWallStyleGeos() : { straight: 'straight', gate: 'gate' };
        const styleStraightTex = (ISO_WALL_GEO[style.straight] || ISO_WALL_GEO.straight).tex;
        const styleGateTex = (ISO_WALL_GEO[style.gate] || ISO_WALL_GEO.gate).tex;
        if (piece.tex === 'wall_straight' && styleStraightTex !== 'wall_straight') {
            const seg = WallSystem._pieceBaseSegments(piece)[0];
            if (!seg) return piece;
            let A = seg[0], B = seg[1];
            if (B.y < A.y) { const t = A; A = B; B = t; }
            return WallSystem._buildSegPiece(A, B, !!piece.flipX, style.straight, 'max');
        }
        if (piece.tex === 'wall_gate' && styleGateTex !== 'wall_gate') {
            const seg = WallSystem._pieceBaseSegments(piece)[0];
            if (!seg) return piece;
            let A = seg[0], B = seg[1];
            if (B.y < A.y) { const t = A; A = B; B = t; }
            return this._buildGatePieceAt(A, B, !!piece.flipX, piece.depth);
        }
        return piece;
    },

    /**
     * 通道地板（精确平行四边形，唯一地板形状——不再用"走廊块+门口补丁"拼接）：
     * - 两条侧边 = 通道两侧墙线的实测位置（预制直墙件到轴的垂直距离，内收 12px 藏入墙下）；
     * - 两个端边 = 两侧房间的边线各向房内平移 80px（与房间菱形地板叠合，天然盖住门槛）。
     * 侧边与房间墙成 60° 的楔形区由 _sealPassageSides 的封口墙件遮挡。
     * 旧版"按走廊轴居中的等宽块"：两侧墙距轴不等（+184/-211），居中展宽一侧探出墙外、
     * 另一侧露出黑条（"地板超出边界 + 黑色区域"的根因）。
     */
    /** 房间边线（点 + 方向，参数化方向与 buildIsoDiamondWalls 的 edgeFill 一致：上端→下端） */
    _roomEdgeLine(room, edge) {
        switch (edge) {
            case 'RB': return { P: { x: room.cx + room.rx, y: room.cy }, d: { x: -room.rx, y: room.ry } };
            case 'LT': return { P: { x: room.cx, y: room.cy - room.ry }, d: { x: -room.rx, y: room.ry } };
            case 'TR': return { P: { x: room.cx, y: room.cy - room.ry }, d: { x: room.rx, y: room.ry } };
            case 'BL': return { P: { x: room.cx, y: room.cy + room.ry }, d: { x: -room.rx, y: -room.ry } };
            default: return { P: { x: room.cx + room.rx, y: room.cy }, d: { x: -room.rx, y: room.ry } };
        }
    },

    _arenaPassageFloorQuad(analysis, passage, roomA, roomB) {
        const axis = passage.axis;
        const perp = { x: -axis.y, y: axis.x };
        // 实测两侧墙距（预制坐标系下量取，平移不变量）
        let dPos = Infinity, dNeg = Infinity;
        for (const p of analysis.def.pieces) {
            if (this._isFunctionalGatePiece(p)) continue;
            const seg = WallSystem._pieceBaseSegments(p)[0];
            if (!seg) continue;
            const cx = (seg[0].x + seg[1].x) / 2, cy = (seg[0].y + seg[1].y) / 2;
            const d = (cx - analysis.gA.center.x) * perp.x + (cy - analysis.gA.center.y) * perp.y;
            if (d > 40 && d < dPos) dPos = d;
            if (d < -40 && -d < dNeg) dNeg = -d;
        }
        if (dPos === Infinity) dPos = 172;
        if (dNeg === Infinity) dNeg = 199;
        const mid = passage.center;
        // 两条侧边（点 + 方向 axis）——⚠ 2026-08-08 修：侧边延伸到实际墙线
        // （不再内收 12px）。旧版内收使地板在 60° 墙角楔形区到不了墙线，
        // 封口墙底落在地板外的黑区，墙角露黑（用户"草地没盖到墙角"）。
        // 墙线本身被不透明墙身盖住，地板伸到墙线不会外露。
        const near = { P: { x: mid.x + perp.x * dPos, y: mid.y + perp.y * dPos }, d: axis };
        const far = { P: { x: mid.x - perp.x * dNeg, y: mid.y - perp.y * dNeg }, d: axis };
        // 两个端边：房间真实边线（RB/LT）——⚠ 2026-08-08 修：地板端点取"走廊侧墙线
        // × 房间边线"的交点（= 60° 墙角点），保证地板精确盖到墙角；旧版用边线向内
        // 平移 80/250px，端点落在房间内部，墙角楔形区留黑（"草地没盖到墙角"）。
        // 地板继续向房内延伸由房间菱形地板（并集）补齐，重叠区裁剪去重。
        // 端边 = 房间实际出/入边（三房 RB/LT；迷宫折返 TR/BL——旧版硬编码 RB/LT 会算错地板）
        const edgeA = this._roomEdgeLine(roomA, roomA.outEdge || 'RB');
        const edgeB = this._roomEdgeLine(roomB, roomB.inEdge || 'LT');
        const intersect = (l1, l2) => {
            const ex = l2.P.x - l1.P.x, ey = l2.P.y - l1.P.y;
            const denom = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
            if (Math.abs(denom) < 1e-6) return l1.P;
            const t = (ex * l2.d.y - ey * l2.d.x) / denom;
            return { x: l1.P.x + l1.d.x * t, y: l1.P.y + l1.d.y * t };
        };
        return {
            points: [
                intersect(near, edgeA),
                intersect(near, edgeB),
                intersect(far, edgeB),
                intersect(far, edgeA),
            ],
        };
    },

    /** 世界单格房指定边的中央门洞：门宽按格间距计，两个端点都落在墙块格心。 */
    _worldBlockOpeningGeometry(room, edge) {
        const edgeCells = Math.max(12, room.edgeCells || this._gridEdgeCells || 20);
        let gateCells = Math.min(this._gridGateCells || 6, edgeCells - 4);
        if ((edgeCells - gateCells) % 2 !== 0) gateCells = Math.max(2, gateCells - 1);
        const startIndex = (edgeCells - gateCells) / 2;
        const endIndex = startIndex + gateCells;
        const T = { x: room.cx, y: room.cy - room.ry };
        const R = { x: room.cx + room.rx, y: room.cy };
        const B = { x: room.cx, y: room.cy + room.ry };
        const L = { x: room.cx - room.rx, y: room.cy };
        const namedEdges = {
            TR: [T, R], RB: [R, B], BL: [B, L], LT: [L, T],
        };
        const pair = namedEdges[edge];
        if (!pair) return null;
        const [P, Q] = pair;
        const step = { x: (Q.x - P.x) / edgeCells, y: (Q.y - P.y) / edgeCells };
        const rawA = { x: P.x + step.x * startIndex, y: P.y + step.y * startIndex };
        const rawB = { x: P.x + step.x * endIndex, y: P.y + step.y * endIndex };
        let a = { ...rawA }, b = { ...rawB };
        if (a.y > b.y) [a, b] = [b, a];
        return {
            edge,
            edgeCells,
            gateCells,
            startIndex,
            endIndex,
            step,
            rawA,
            rawB,
            a,
            b,
            flip: b.x < a.x,
            depth: Math.max(a.y, b.y) + 4,
            fillPieces: [],
            endpointPieces: [],
        };
    },

    /** 把两个门洞端点按最短的两条通道侧边配对。 */
    _pairWorldBlockOpeningSides(openingA, openingB) {
        const a = [openingA.rawA, openingA.rawB];
        const b = [openingB.rawA, openingB.rawB];
        const dist = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);
        const direct = dist(a[0], b[0]) + dist(a[1], b[1]);
        const crossed = dist(a[0], b[1]) + dist(a[1], b[0]);
        return direct <= crossed
            ? [{ start: a[0], end: b[0] }, { start: a[1], end: b[1] }]
            : [{ start: a[0], end: b[1] }, { start: a[1], end: b[0] }];
    },

    /** 整数格通道地板：四个角就是两端门洞端点，和房间地板在真实边线上并集。 */
    _worldBlockPassageFloorQuad(passage, roomA, roomB) {
        const openingA = roomA._gridOpenings[roomA.outEdge];
        const openingB = roomB._gridOpenings[roomB.inEdge];
        const sides = this._pairWorldBlockOpeningSides(openingA, openingB);
        return {
            points: [
                { ...sides[0].start },
                { ...sides[0].end },
                { ...sides[1].end },
                { ...sides[1].start },
            ],
        };
    },

    /** 取门洞端点上复用的房墙块。 */
    _worldBlockEndpointPiece(opening, point) {
        return opening.endpointPieces.find((entry) =>
            Math.abs(entry.point.x - point.x) < 0.01 && Math.abs(entry.point.y - point.y) < 0.01)?.piece || null;
    },

    /**
     * 单格墙房间间通道：两侧墙按整数个 128×64 格心铺设；首末格与房墙门端共享，
     * 只补各自朝通道方向的半段碰撞，中间格保持完整一格，边界因此连续且无重叠墙块。
     */
    _placeWorldBlockPassage(passage, roomA, roomB) {
        const openingA = roomA._gridOpenings[roomA.outEdge];
        const openingB = roomB._gridOpenings[roomB.inEdge];
        if (!openingA || !openingB) return null;
        const sides = this._pairWorldBlockOpeningSides(openingA, openingB);
        const corridorCells = Math.max(4, passage.corridorCells || 12);

        for (const side of sides) {
            const step = {
                x: (side.end.x - side.start.x) / corridorCells,
                y: (side.end.y - side.start.y) / corridorCells,
            };
            const startPiece = this._worldBlockEndpointPiece(openingA, side.start);
            const endPiece = this._worldBlockEndpointPiece(openingB, side.end);
            if (!startPiece || !endPiece) return null;
            startPiece._baseSegments.push([
                { x: side.start.x, y: side.start.y },
                { x: side.start.x + step.x / 2, y: side.start.y + step.y / 2 },
            ]);
            endPiece._baseSegments.push([
                { x: side.end.x - step.x / 2, y: side.end.y - step.y / 2 },
                { x: side.end.x, y: side.end.y },
            ]);
            startPiece.depth = WallSystem.depthOf(startPiece, 4);
            endPiece.depth = WallSystem.depthOf(endPiece, 4);

            for (let i = 1; i < corridorCells; i++) {
                const center = { x: side.start.x + step.x * i, y: side.start.y + step.y * i };
                WallSystem.isoVisuals.push(this._makeWorldBlockPiece(center, [[
                    { x: center.x - step.x / 2, y: center.y - step.y / 2 },
                    { x: center.x + step.x / 2, y: center.y + step.y / 2 },
                ]], { _passageWall: true }));
            }
        }

        const gates = [];
        for (const opening of [openingA, openingB]) {
            const piece = this._buildGatePieceAt(
                opening.a, opening.b, opening.flip, opening.depth, { fitSpan: true });
            const inst = this._createArenaGate(piece);
            if (inst) gates.push(inst);
        }
        if (gates.length !== 2) {
            for (const inst of gates) {
                for (const gateSprite of inst.sprites || [inst.sprite]) {
                    if (gateSprite && gateSprite.scene) gateSprite.destroy();
                }
                if (WallSystem.isoSegments) {
                    for (const seg of [...inst.wallSegs, inst.gateSeg]) {
                        const index = WallSystem.isoSegments.indexOf(seg);
                        if (index >= 0) WallSystem.isoSegments.splice(index, 1);
                    }
                }
            }
            return null;
        }
        return {
            index: passage.index,
            mid1: passage.mid1,
            mid2: passage.mid2,
            center: passage.center,
            gates,
        };
    },

    /**
     * 建通道功能门（碰撞模型同宝箱房门：两侧墙身常开 + 门洞段按开关启停）
     * 初始常开（帧 = 末帧，门洞段不入碰撞）；碰撞段标 _arenaGate（rebuildIsoCollision 保留）
     * 深度 = 整墙 min/max 规则（mode='max' 前墙 / 'min' 后墙，与菱形墙、宝箱房全场统一）
     */
    _createArenaGate(piece) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (!piece || !scene || !scene.textures.exists(piece.tex)) {
            console.warn('[CombatRoomSystem] _createArenaGate 失败：贴图未就绪', piece?.tex);
            return null;
        }
        const g = WallSystem._geoForTex(piece.tex) || ISO_WALL_GEO.gate;
        const frames = g.frames || 16;
        const baseSegs = WallSystem._pieceBaseSegments(piece);
        if (!baseSegs.length) { console.warn('[CombatRoomSystem] _createArenaGate 失败：无底线段', piece.tex); return null; }
        const [gA, gB] = baseSegs[0];
        const hole = isoGateHole(g);
        if (!hole) { console.warn('[CombatRoomSystem] _createArenaGate 失败：无门洞几何', piece.tex); return null; }
        const ht = isoHalfThick(g);
        const baseAt = (tx) => WallSystem.texPointToWorld(piece, tx, g.base[0][1] + (tx - g.base[0][0]) * g.slope);
        const g1 = baseAt(hole[0]), g2 = baseAt(hole[1]);
        const depthSliceCount = Math.max(1, Math.round(g.depthSlices || 1));
        const sprites = [];
        const depthSegments = [];
        const makeSprite = (crop = null, depth = (g1.y + g2.y) / 2) => {
            const gateSprite = scene.add.sprite(piece.x, piece.y, piece.tex, frames - 1);
            gateSprite.setOrigin(0.5, 0.5);
            gateSprite.setScale(piece.scaleX ?? 1, piece.scaleY ?? piece.scaleX ?? 1);
            gateSprite.setFlipX(!!piece.flipX);
            gateSprite.setFlipY(!!piece.flipY);
            gateSprite.setDepth(depth);
            if (crop && typeof gateSprite.setCrop === 'function') {
                const applyCrop = () => gateSprite.setCrop(crop.x, 0, crop.w, g.h);
                // Phaser 4 切 spritesheet 帧后仍保留上一帧 crop UV，必须按新帧重算。
                const originalSetFrame = gateSprite.setFrame.bind(gateSprite);
                gateSprite.setFrame = (frame, updateSize, updateOrigin) => {
                    const result = originalSetFrame(frame, updateSize, updateOrigin);
                    applyCrop();
                    return result;
                };
                applyCrop();
            }
            sprites.push(gateSprite);
            return gateSprite;
        };

        if (depthSliceCount > 1) {
            // 六格长门整图单 depth 会让浅端压在相邻单格墙之上。按配置切片
            // 合同拆成浅/中/深三块：每段随自己的底边排序，并比同线墙块的 +4 偏置
            // 低 0.1，保证门体收在墙后；三块仍共用同一帧和同一世界变换，接缝零位移。
            const span = hole[1] - hole[0];
            for (let index = 0; index < depthSliceCount; index++) {
                const tx0 = hole[0] + span * index / depthSliceCount;
                const tx1 = hole[0] + span * (index + 1) / depthSliceCount;
                const sA = baseAt(tx0);
                const sB = baseAt(tx1);
                const depth = Math.max(sA.y, sB.y) + 3.9;
                makeSprite({ x: Math.floor(tx0), w: Math.ceil(tx1) - Math.floor(tx0) }, depth);
                depthSegments.push({ A: sA, B: sB, depth });
            }
        } else {
            // 普通门继续使用门洞中心深度，保持既有穿门显隐手感。
            makeSprite(null, (g1.y + g2.y) / 2);
        }
        const sprite = sprites[0];

        const wallSegs = [
            { x1: gA.x, y1: gA.y, x2: g1.x, y2: g1.y, halfThick: ht, _arenaGate: true },
            { x1: g2.x, y1: g2.y, x2: gB.x, y2: gB.y, halfThick: ht, _arenaGate: true },
        ].filter((seg) => Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1) > 1);
        const gateSeg = { x1: g1.x, y1: g1.y, x2: g2.x, y2: g2.y, halfThick: ht, _arenaGate: true };
        if (WallSystem.isoSegments) {
            for (const s of wallSegs) WallSystem.isoSegments.push(s);
            // 初始常开：门洞段不入碰撞
        }
        // 门洞中心（世界）：障碍物/陷阱的门口排除与可达性校验用
        const center = { x: (g1.x + g2.x) / 2, y: (g1.y + g2.y) / 2 };
        return {
            sprite, sprites, depthSegments,
            wallSegs, gateSeg, center, baseA: gA, baseB: gB,
            open: true, frames, _animCounter: null,
        };
    },

    /**
     * 通道直墙件房间裁剪：预制侧墙比门到门跨度长，60° 相接处会越过房间边线
     * 探入房内/横跨门口（"墙壁突出通道"的根因）。
     * 处理：任一端点越进房内（>8px 叠合公差）即整件丢弃，缺口由 _sealPassageSides
     * 用整瓦补到房间边线（两端各 8px 叠合）——与僵尸版"定长定高、尾端由封口补"同口径。
     * ⚠ 2026-08-08 三修：旧版"部分越线保留整件"会让侧墙端面探入房内 140px
     * （用户"通道侵入第二间房场地，突出来"）；再早的按比例缩 scaleX 会同时削短墙顶、
     * 门口出现台阶错位（129a0eb 教训）。丢弃+封口既去侵入又不缩放。
     */
    _clipPassagePieceToRooms(piece, passage, roomA, roomB) {
        const seg = WallSystem._pieceBaseSegments(piece)[0];
        if (!seg) return piece;
        let [A, B] = seg.map(p => ({ ...p }));
        // 房间边线：实际出/入边（三房 RB/LT；迷宫折返 TR/BL），"房内" = 朝向房心一侧
        const edges = [];
        for (const [room, edge, center] of [
            [roomA, roomA.outEdge || 'RB', roomA],
            [roomB, roomB.inEdge || 'LT', roomB],
        ]) {
            const e = this._roomEdgeLine(room, edge);
            edges.push({ P: e.P, d: e.d, c: center });
        }
        for (const e of edges) {
            // 法线（指向房心）
            let nx = -e.d.y, ny = e.d.x;
            const nl = Math.hypot(nx, ny) || 1;
            nx /= nl; ny /= nl;
            // ⚠ 2026-08-08 七修：e.c 是房间对象（字段 cx/cy），旧版误用 e.c.x/e.c.y
            // → undefined → signC=NaN → 法线永不翻转 → 边线方向错 → 通道侧墙件被误判
            // "整件在房内"全部丢弃（用户"衔接通道没做墙/看不到墙壁"的根因）
            const signC = (e.c.cx - e.P.x) * nx + (e.c.cy - e.P.y) * ny;
            if (signC < 0) { nx = -nx; ny = -ny; }
            const sOf = (P) => (P.x - e.P.x) * nx + (P.y - e.P.y) * ny; // >0 = 房内
            const sA = sOf(A), sB = sOf(B);
            const INSIDE = 8; // 允许越线 8px（叠合公差）
            // 任一端点越进房内（整件在房内是其子集）→ 丢弃，由封口逻辑补瓦
            if (sA > INSIDE || sB > INSIDE) return null;
        }
        // 丢弃越线件后缺口由 _sealPassageSides 用整瓦补到房间边线（两端各 8px 叠合），
        // 与僵尸版"定长定高、尾端由封口补"同口径——不缩放、不削墙顶。
        return piece;
    },

    /**
     * 通道侧墙封口：预制侧墙（与走廊轴平行的直墙件）两端若到不了两侧房间的边线，
     * 沿走廊轴方向用整瓦补到边线交点（两端各 8px 叠合）。
     * 楔形缺口的根因：预制侧墙长度 < 门到门跨度，且侧墙与房间墙成 60° 相接。
     * @param {Object} analysis 通道预制解析（_analyzePassagePrefab）
     * @param {Object} passage 布局通道（mid1/mid2/axis）
     * @param {Object} roomA 房间 N（RB 边）/ roomB 房间 N+1（LT 边）
     */
    _sealPassageSides(analysis, passage, roomA, roomB) {
        const axis = passage.axis;
        const perp = { x: -axis.y, y: axis.x };
        const geoKey = WallSystem.getWallStyleGeos ? WallSystem.getWallStyleGeos().straight : 'straight';
        // ⚠ 2026-08-11 二修：端点交换与 flip 解耦——
        //   swap 只由轴方向定（axis.y<0 的 v2/-v1 向上轴：A/B 交换后 B 在下端 → sy>0）；
        //   flip（贴图横轴镜像）另行按 dx 与端点顺序组合推导，保证 sx>0。
        //   旧实现 flip=axis.x*axis.y<=0 且 swap 绑定 flip：
        //     -v1 时 flip=false → 不交换 → A 在下端 → sy<0 上下颠倒飘进房间（6 块负 sy 件）；
        //   首修改成 axis.y<0 后 -v1 flip=true → 交换正确但 flip 传 true → sx<0，
        //     底边镜像偏移（残留 2 块离房 5 RB 边 324px 的游离件）。
        //   正确组合：swap = axis.y<0；flip = (axis.x<0) !== swap。
        const swap = axis.y < 0;
        const flip = (axis.x < 0) !== swap;
        // 两条房间边线（点 + 方向）：实际出/入边（三房 RB/LT；迷宫折返 TR/BL）
        const edgeA = this._roomEdgeLine(roomA, roomA.outEdge || 'RB');
        const edgeB = this._roomEdgeLine(roomB, roomB.inEdge || 'LT');
        // 收集该通道的侧墙件（平行于走廊轴、在走廊侧墙带内、且在本通道跨度范围内——
        // 不过滤跨度会把其他通道/房间的平行墙并入，填充出横跨全场的 stray 墙）
        const mid = passage.center;
        // ⚠ 2026-08-08 八修：halfSpan 需覆盖预制侧墙件全程（t=-40..L+40，3 段瓦末端
        // 沿轴 ~L/2+340）。旧值 length/2+250=732.5 会把末端件（沿 818）排除 →
        // hi/lo 偏小 → 封口瓦从通道中段铺起（横墙挡路，用户"第三四房衔接混乱"）
        const halfSpan = (passage.length || 1000) / 2 + 500;
        const byPiece = [];
        for (const p of WallSystem.isoVisuals) {
            // ⚠ 2026-08-08 八修：只收集预制侧墙件（_passageWall）——防止转弯通道误收集
            // 相邻房间的平行边墙（房 TR/BL/LT 边与 v2/-v1 通道轴平行且 perp 落在侧墙带）
            if (!p._passageWall) continue;
            const seg = WallSystem._pieceBaseSegments(p)[0];
            if (!seg) continue;
            const [a, b] = seg;
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const perpD = (mx - mid.x) * perp.x + (my - mid.y) * perp.y;
            if (Math.abs(perpD) < 60 || Math.abs(perpD) > 400) continue; // 轴线（门/端帽）与远处排除
            const along = (mx - mid.x) * axis.x + (my - mid.y) * axis.y;
            if (Math.abs(along) > halfSpan) continue; // 本通道跨度之外（其他通道/房间边墙）
            let dx = b.x - a.x, dy = b.y - a.y;
            const L = Math.hypot(dx, dy) || 1;
            if (Math.abs(dx * axis.x + dy * axis.y) / L < 0.96) continue; // 平行于走廊轴（<15°）
            byPiece.push({ seg: [a, b], perpD });
        }
        if (!byPiece.length) return;
        for (const sign of [1, -1]) {
            const side = byPiece.filter(q => Math.sign(q.perpD) === sign);
            if (!side.length) continue;
            // ⚠ 2026-08-08 修：侧墙线不能取平均值——走廊带内还会收集到平行的
            // 房间边墙（perpD 远大于走廊侧墙），平均会被带偏，封口墙与预制侧墙
            // 错位 25~54px（通道"扭曲/台阶"根因）。改取**中位数**（抗离群值）：
            // 走廊自己的侧墙段数量最多、落在同一线上，中位数即正确侧墙偏移。
            const sorted = side.map(q => q.perpD).sort((a, b) => a - b);
            const n = sorted.length;
            const dSide = n % 2 === 1
                ? sorted[(n - 1) / 2]
                : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
            const S0 = { x: mid.x + perp.x * dSide, y: mid.y + perp.y * dSide };
            const projOf = (P) => (P.x - S0.x) * axis.x + (P.y - S0.y) * axis.y;
            let lo = Infinity, hi = -Infinity;
            for (const q of side) {
                for (const pt of q.seg) {
                    const t = projOf(pt);
                    lo = Math.min(lo, t); hi = Math.max(hi, t);
                }
            }
            // 与两条房间边线的交点（二维直线求交，交点在侧墙线上的投影）
            const intersect = (edge) => {
                const ex = edge.P.x - S0.x, ey = edge.P.y - S0.y;
                const denom = axis.x * edge.d.y - axis.y * edge.d.x;
                if (Math.abs(denom) < 1e-6) return null;
                return (ex * edge.d.y - ey * edge.d.x) / denom;
            };
            const tA = intersect(edgeA), tB = intersect(edgeB);
            // 深度：全场统一 max 规则（wall-system depthOf 注释）
            const depthMode = 'max';
            const g = ISO_WALL_GEO[geoKey] || ISO_WALL_GEO.straight;
            const s = ISO_WALL_HEIGHT / g.wallH;
            const sy = s * slopeFixOf(g);
            const faceLen = Math.hypot((g.face[1][0] - g.face[0][0]) * s, (g.face[1][1] - g.face[0][1]) * sy);
            const step = faceLen - 8;
            const lay = (a, b) => {
                // 端点顺序：swap（axis.y<0 的向上轴）时交换，保证 A 在上端/B 在下端（sy>0）
                let p1 = a, p2 = b;
                if (swap) { const t = p1; p1 = p2; p2 = t; }
                const A = { x: S0.x + axis.x * p1, y: S0.y + axis.y * p1 };
                const B = { x: S0.x + axis.x * p2, y: S0.y + axis.y * p2 };
                WallSystem._addSegPiece(A, B, flip, geoKey, depthMode, 0.1);
            };
            // 整瓦锚定填充：瓦端锚在边界侧，绝不越过边界（旧版整瓦居中——缺口很小时
            // 一整瓦越出房间边线 200+px 探入房内，"墙壁突出通道"的真正根因）
            const fillToEnd = (t0, t1) => {   // 右端延伸（到房间 B 边线）：锚 t1
                let end = t1;
                while (end - faceLen > t0) { lay(end - faceLen, end); end -= step; }
                lay(end - faceLen, end);
            };
            const fillFromStart = (t0, t1) => { // 左端延伸（到房间 A 边线）：锚 t0
                let start = t0;
                while (start + faceLen < t1) { lay(start, start + faceLen); start += step; }
                lay(start, start + faceLen);
            };
            if (tA !== null && tA < lo - 12) fillFromStart(tA - 8, lo + 8);
            if (tB !== null && tB > hi + 12) fillToEnd(hi - 8, tB + 8);
        }
    },

    /**
     * 入场门：房间 1 左上墙（LT 边）中段的直墙件原位替换为门墙（竞技场门实例，初始常开）——
     * 玩家从门外入场地块走进房间 1 才触发关门刷怪（见 dungeon-map-system _checkArenaRoomEntry）
     */
    _setupEntryGate(room) {
        const mid = { x: room.cx - room.rx / 2, y: room.cy - room.ry / 2 };
        const styleGeos = WallSystem.getWallStyleGeos ? WallSystem.getWallStyleGeos() : { straight: 'straight' };
        const straightTex = (ISO_WALL_GEO[styleGeos.straight] || ISO_WALL_GEO.straight).tex;
        // 近顶点判定（与 _setupGate 同规则，避免暴露转角 overshoot 结构）
        const g0 = ISO_WALL_GEO[styleGeos.straight] || ISO_WALL_GEO.straight;
        const s0 = ISO_WALL_HEIGHT / g0.wallH;
        const sy0 = s0 * slopeFixOf(g0);
        const faceLen0 = Math.hypot((g0.face[1][0] - g0.face[0][0]) * s0, (g0.face[1][1] - g0.face[0][1]) * sy0);
        const verts = [
            { x: room.cx, y: room.cy - room.ry }, { x: room.cx, y: room.cy + room.ry },
            { x: room.cx - room.rx, y: room.cy }, { x: room.cx + room.rx, y: room.cy },
        ];
        const nearVertex = (p) => {
            const seg = WallSystem._pieceBaseSegments(p)[0];
            if (!seg) return true;
            return seg.some(pt => verts.some(V => Math.hypot(pt.x - V.x, pt.y - V.y) < 0.8 * faceLen0));
        };
        let best = null, bestD = Infinity;
        for (const p of WallSystem.isoVisuals) {
            if (p.tex !== straightTex || p._corner) continue;
            if (nearVertex(p)) continue;
            const d = Math.hypot(p.x - mid.x, p.y - mid.y);
            if (d < bestD) { bestD = d; best = p; }
        }
        if (!best) return null;
        const [a, b] = WallSystem._pieceBaseSegments(best)[0];
        const flip = !!best.flipX;
        const depth = best.depth;
        const bestIdx = WallSystem.isoVisuals.indexOf(best);
        WallSystem.isoVisuals.splice(bestIdx, 1);
        WallSystem.removeSpanCoveringPieces([a, b]);
        // 门闸锚点沿边回退 8px（与 _setupGate 同口径，只叠不缺）
        const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const a2 = { x: a.x - (b.x - a.x) / segLen * 8, y: a.y - (b.y - a.y) / segLen * 8 };
        // 用 WallGate.placeAt 同款几何构造门墙件（竞技场门实例，初始常开）
        const piece = this._buildGatePieceAt(a2, b, flip, depth);
        return this._createArenaGate(piece);
    },

    /** 由底边线段构造门墙件（WallGate.placeAt 同款变换数学，供 _createArenaGate 使用） */
    _buildGatePieceAt(A, B, flip, depth, options = {}) {
        const geoKey = WallSystem.getWallStyleGeos ? WallSystem.getWallStyleGeos().gate : 'gate';
        const g = ISO_WALL_GEO[geoKey] || ISO_WALL_GEO.gate;
        const p0 = g.base[0];
        const s = ISO_WALL_HEIGHT / g.wallH;
        const fitSpan = options.fitSpan === true;
        const sx = fitSpan
            ? Math.abs(B.x - A.x) / Math.max(1, Math.abs(g.base[1][0] - g.base[0][0]))
            : s;
        const sy = fitSpan
            ? Math.abs(B.y - A.y) / Math.max(1, Math.abs(g.base[1][1] - g.base[0][1]))
            : s * slopeFixOf(g);
        let x0, y0;
        if (!flip) {
            x0 = A.x - p0[0] * sx;
            y0 = A.y - p0[1] * sy;
        } else {
            x0 = A.x - (g.w - p0[0]) * sx;
            y0 = A.y - p0[1] * sy;
        }
        return {
            tex: g.tex,
            x: x0 + g.w * Math.abs(sx) / 2,
            y: y0 + g.h * sy / 2,
            scaleX: Math.abs(sx), scaleY: sy,
            flipX: !!flip, flipY: false,
            depth,
        };
    },

    /**
     * 房间开洞边的缝隙填充（只叠不缺，与 buildIsoDiamondWalls 的 edgeFill 同口径）：
     * 把菱形目标边所在直线作为基准，投影收集所有共线覆盖段（房间瓦片 + 通道件 + 门墙底边），
     * 合并后仍未覆盖的区间 ≥12px 即用 _addSegPiece 定伸瓦补上（两端各 8px 叠合）。
     * 相比按"最近端点"猜测的散点填充：基准线是房间自己的边，不会误连到远处共线件
     * （旧版按门端点散射填充、把墙填到场地中央的根因）。
     * @param {Object} room 房间 {cx, cy, rx, ry}
     * @param {string} edge 'RB'（右下前墙）| 'LT'（左上后墙）
     * @param {Array} gateSegs 门墙底边线段 [[A, B]...]（通道门/出口门，非 isoVisuals 件需显式传入）
     */
    _fillEdgeGaps(room, edge, gateSegs = []) {
        // 边的参数化方向必须与 buildIsoDiamondWalls 的 edgeFill 一致（上端→下端）：
        // RB = R→B（edgeFill(rD, bR)），LT = T→L（edgeFill(tL, lU)），
        // TR = T→R，BL = L→B（迷宫折返通道的开洞边；2026-08-11 修正旧 B→L 下端→上端，
        // 会让填充件 _addSegPiece sy<0 上下颠倒——LT 同理，参数化顺序必须上端在前）
        const verts = {
            RB: [{ x: room.cx + room.rx, y: room.cy }, { x: room.cx, y: room.cy + room.ry }],
            LT: [{ x: room.cx, y: room.cy - room.ry }, { x: room.cx - room.rx, y: room.cy }],
            TR: [{ x: room.cx, y: room.cy - room.ry }, { x: room.cx + room.rx, y: room.cy }],
            BL: [{ x: room.cx - room.rx, y: room.cy }, { x: room.cx, y: room.cy + room.ry }],
        }[edge];
        if (!verts) return;
        const [V0, V1] = verts;
        const edgeLen = Math.hypot(V1.x - V0.x, V1.y - V0.y);
        const ux = (V1.x - V0.x) / edgeLen, uy = (V1.y - V0.y) / edgeLen;
        const toLine = (P) => Math.abs((P.x - V0.x) * uy - (P.y - V0.y) * ux);
        const proj = (P) => (P.x - V0.x) * ux + (P.y - V0.y) * uy;
        // 收集覆盖区间（投影到 [0, edgeLen]）；门墙区间单独记录（填充锚定/裁剪用）
        const intervals = [];
        const gateIntervals = [];
        const pushSeg = (a, b, isGate) => {
            if (toLine(a) > 20 || toLine(b) > 20) return;
            let s = proj(a), e = proj(b);
            if (s > e) [s, e] = [e, s];
            s = Math.max(0, s); e = Math.min(edgeLen, e);
            if (e - s > 4) {
                intervals.push([s, e]);
                if (isGate) gateIntervals.push([s, e]);
            }
        };
        for (const p of WallSystem.isoVisuals) {
            for (const [a, b] of WallSystem._pieceBaseSegments(p)) pushSeg(a, b, false);
        }
        for (const [a, b] of gateSegs) pushSeg(a, b, true);
        if (!intervals.length) return;
        // 合并（<12px 微缝视为已覆盖——8px 叠合公差内）并求缺口
        intervals.sort((x, y) => x[0] - y[0]);
        const gaps = [];
        let curE = intervals[0][1];
        for (let i = 1; i < intervals.length; i++) {
            const [s, e] = intervals[i];
            if (s <= curE + 12) { curE = Math.max(curE, e); }
            else { gaps.push([curE, s]); curE = e; }
        }
        const geoKey = WallSystem.getWallStyleGeos ? WallSystem.getWallStyleGeos().straight : 'straight';
        const flip = ux * uy < 0; // RB/LT 边均为 "/" 方向
        const depthMode = 'max'; // 全场统一 max 规则（wall-system depthOf 注释）
        // 标准瓦长（与 _setupGate 同推导）：缺口填充用整瓦，避免"缩小"的压扁件
        const g0geo = ISO_WALL_GEO[geoKey] || ISO_WALL_GEO.straight;
        const s0 = ISO_WALL_HEIGHT / g0geo.wallH;
        const sy0 = s0 * slopeFixOf(g0geo);
        const faceLen = Math.hypot((g0geo.face[1][0] - g0geo.face[0][0]) * s0, (g0geo.face[1][1] - g0geo.face[0][1]) * sy0);
        const step = faceLen - 8; // edgeFill 步进（8px 叠合）
        const laySpan = (aProj, bProj) => {
            const S = { x: V0.x + ux * aProj, y: V0.y + uy * aProj };
            const T = { x: V0.x + ux * bProj, y: V0.y + uy * bProj };
            WallSystem._addSegPiece(S, T, flip, geoKey, depthMode, 0.1);
        };
        for (const [g0, g1] of gaps) {
            if (g1 - g0 < 12) continue;
            // 门侧判定：缺口的左/右相邻覆盖是否为门墙（容差 30px）
            const gateLeft = gateIntervals.some(([, e]) => Math.abs(e - g0) < 30);
            const gateRight = gateIntervals.some(([s]) => Math.abs(s - g1) < 30);
            if (gateRight && !gateLeft) {
                // 右邻是门：瓦端锚定在 g1+8（仅 8px 叠合进门框区，绝不跨进门口），
                // 向左整瓦步进，末件左端伸入左侧墙体覆盖区（同纹理整瓦互盖，edgeFill 同口径）
                let end = g1 + 8;
                while (end - faceLen > g0 - 8) { laySpan(end - faceLen, end); end -= step; }
                laySpan(end - faceLen, end);
            } else if (gateLeft && !gateRight) {
                // 左邻是门：瓦端起锚在 g0-8，向右整瓦步进
                let start = g0 - 8;
                while (start + faceLen < g1 + 8) { laySpan(start, start + faceLen); start += step; }
                laySpan(start, start + faceLen);
            } else if (gateLeft && gateRight) {
                // 两侧都是门（罕见）：裁剪到缺口本体（避免压门）
                laySpan(g0 - 8, g1 + 8);
            } else {
                // 两侧都是墙体：整瓦长居中（两端 ≥8px 叠合，超一瓦按 edgeFill 步进续接）
                const stepN = faceLen - 8;
                const need = g1 - g0 + 16;
                const n = Math.max(1, Math.ceil(need / stepN));
                const total = (n - 1) * stepN + faceLen;
                const mid = (g0 + g1) / 2;
                for (let i = 0; i < n; i++) {
                    const a = mid - total / 2 + i * stepN;
                    laySpan(a, a + faceLen);
                }
            }
        }
    },

    /**
     * 按门洞真实线段清理残留碰撞。单格冰墙重建时，门段可能与同线墙段/阶梯矩形并存；
     * 只按 gateSeg 对象引用 splice 会留下视觉已开、物理仍挡的空气墙。
     */
    _clearArenaGateOpeningCollision(inst) {
        if (!inst?.gateSeg || !WallSystem.isoSegments) return false;
        const gate = inst.gateSeg;
        const vx = gate.x2 - gate.x1, vy = gate.y2 - gate.y1;
        const len = Math.hypot(vx, vy);
        if (len < 1) return false;
        const ux = vx / len, uy = vy / len;
        const blockers = new Set();
        const projection = (x, y) => (x - gate.x1) * ux + (y - gate.y1) * uy;
        const lineDistance = (x, y) => Math.abs((x - gate.x1) * uy - (y - gate.y1) * ux);
        for (const seg of WallSystem.isoSegments) {
            if (seg === gate) {
                blockers.add(seg);
                continue;
            }
            // 只清门洞同一直线且实际覆盖门洞内部的段；通道两侧墙只在端点相接，不会被误删。
            if (lineDistance(seg.x1, seg.y1) > 1 || lineDistance(seg.x2, seg.y2) > 1) continue;
            const lo = Math.max(0, Math.min(projection(seg.x1, seg.y1), projection(seg.x2, seg.y2)));
            const hi = Math.min(len, Math.max(projection(seg.x1, seg.y1), projection(seg.x2, seg.y2)));
            if (hi - lo > 2) blockers.add(seg);
        }
        if (!blockers.size) return false;
        WallSystem.isoSegments = WallSystem.isoSegments.filter(seg => !blockers.has(seg));
        const beforeWalls = WallSystem.walls ? WallSystem.walls.length : 0;
        if (WallSystem.walls) {
            WallSystem.walls = WallSystem.walls.filter(wall => !blockers.has(wall._isoSourceSegment));
        }
        return beforeWalls !== (WallSystem.walls ? WallSystem.walls.length : 0);
    },

    /** 通道门开闭（open=true 开门）：门洞碰撞幂等同步 + 16 帧动画 + 门闸音效 */
    _setArenaGateOpen(inst, open) {
        if (!inst) return;
        const stateChanged = inst.open !== open;
        inst.open = open;
        const removedSteppedWalls = this._clearArenaGateOpeningCollision(inst);
        if (!open && WallSystem.isoSegments) {
            WallSystem.isoSegments.push(inst.gateSeg);
        }
        if (removedSteppedWalls && WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }
        if (pathFinder && pathFinder.invalidateCache) {
            pathFinder.invalidateCache();
        }
        if (!stateChanged) return;
        const style = WallSystem.getWallStyle ? WallSystem.getWallStyle() : null;
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile((style && style.gateSound) || 'assets/sounds/environment/gate.mp3');
        }
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        const from = open ? 0 : inst.frames - 1, to = open ? inst.frames - 1 : 0;
        const sprites = inst.sprites || [inst.sprite];
        if (!scene) {
            for (const gateSprite of sprites) {
                if (gateSprite && gateSprite.active) gateSprite.setFrame(to);
            }
            return;
        }
        if (inst._animCounter) inst._animCounter.stop();
        inst._animCounter = scene.tweens.addCounter({
            from, to, duration: 900, ease: 'Linear',
            onUpdate: (tw) => {
                const frame = Math.round(tw.getValue());
                for (const gateSprite of sprites) {
                    if (gateSprite && gateSprite.active) gateSprite.setFrame(frame);
                }
            },
        });
    },

    /** 点在哪个竞技场房间（1~N；不在任何房间返回 0，如通道内） */
    arenaRoomContaining(x, y) {
        if (!this._arena) return 0;
        for (const r of this._arena.rooms) {
            if (pointInDiamond(x, y, r)) return r.index;
        }
        return 0;
    },

    /** 房间 N 的相邻通道门统一开/关（来路 + 去路；房间 1 含入场门、末房无去路） */
    setArenaRoomGates(roomIdx, open) {
        const a = this._arena;
        if (!a) return;
        if (roomIdx === 1 && a.entryGate) {
            this._setArenaGateOpen(a.entryGate, open);
        }
        const passageIdxs = [];
        if (roomIdx > 1) passageIdxs.push(roomIdx - 1); // 来路（rooms[N-1] ↔ rooms[N]）
        if (roomIdx < a.rooms.length) passageIdxs.push(roomIdx); // 去路（rooms[N] ↔ rooms[N+1]）
        for (const pi of passageIdxs) {
            const rec = a.passages[pi - 1];
            if (rec) for (const inst of rec.gates) this._setArenaGateOpen(inst, open);
        }
    },

    /** 切换当前战斗房间（刷怪/墓碑共用 _roomBounds 的现有逻辑） */
    setArenaStageRoom(roomIdx) {
        const a = this._arena;
        if (!a) return;
        a.stage = roomIdx;
        this._roomBounds = a.rooms[roomIdx - 1].bounds;
    },

    /** 取竞技场房间 bounds（1~N；宝箱事件 setup 使用末房） */
    getArenaRoomBounds(roomIdx) {
        const a = this._arena;
        return a && a.rooms[roomIdx - 1] ? a.rooms[roomIdx - 1].bounds : null;
    },

    /** 竞技场房间数（3 = 三房直线；迷宫 >3；未启用返回 0） */
    getArenaRoomCount() {
        return this._arena && this._arena.rooms ? this._arena.rooms.length : 0;
    },

    /** 销毁全部通道门（sprite + 碰撞段 + 动画）；cleanupGate 调用，随后场景恢复重建碰撞 */
    _cleanupArenaGates() {
        if (!this._arena) return;
        const allGates = [...this._arena.passages.flatMap(rec => rec.gates)];
        if (this._arena.entryGate) allGates.push(this._arena.entryGate);
        for (const inst of allGates) {
            if (inst._animCounter) { inst._animCounter.stop(); inst._animCounter = null; }
            if (WallSystem.isoSegments) {
                for (const s of [...inst.wallSegs, inst.gateSeg]) {
                    const i = WallSystem.isoSegments.indexOf(s);
                    if (i >= 0) WallSystem.isoSegments.splice(i, 1);
                }
            }
            for (const gateSprite of inst.sprites || [inst.sprite]) {
                if (gateSprite && gateSprite.scene) gateSprite.destroy();
            }
        }
        // 入场地块贴砖销毁
        this._destroyGateZone(this._arena.entryZone);
        this._arena = null;
    },

    // ============================================================
    // 内部方法：场地生成
    // ============================================================

    _rollRoomSize(isBoss) {
        // 固定档位：普通 1024 / Boss 2048（精英 1792 由调用点经 options.roomSize 传入）
        return isBoss ? this.config.roomSize.boss : this.config.roomSize.normal;
    },

    _rollEntranceEdge() {
        const candidates = this.config.playerSpawn.edgeCandidates;
        return candidates[Math.floor(Math.random() * candidates.length)];
    },

    _generateTerrain(size) {
        // 菱形房：黑砖地板菱形裁剪烘焙，区外全黑（共享 dungeon-floor-texture.js 实现）
        if (this._diamond) {
            const d = this._diamond;
            applyDiamondFloor(d.worldW, d.worldH, d.cx, d.cy, d.rx, d.ry, this.config.terrain);
            return;
        }
        // 地板烘焙已抽到共享模块 dungeon-floor-texture.js（战斗房与 Boss 场地同一实现）：
        // 三张 blackbrick 源图切割 32×32 小砖随机拼铺，圆角 + 2px 纯黑缝隙，四周黑渐变
        applyDungeonFloor(size, this.config.terrain);
    },

    _generateWalls(size) {
        if (!WallSystem) return;

        // 菱形房：基底直墙斜铺 + 四角转角（贴图墙，不清视觉层）
        if (this._diamond) {
            const d = this._diamond;
            WallSystem.walls = [];
            WallSystem.trees = [];
            WallSystem.isoVisuals = [];
            if (this._roomConstruction === 'worldBlock1x1') {
                this._generateWorldBlockWalls(d);
            } else {
                this._gridGateSpan = null;
                WallSystem.buildIsoDiamondWalls(d.cx, d.cy, d.rx, d.ry);
            }
            WallSystem.rebuildIsoCollision();
            if (WallSystem._syncWallsToPhaser) {
                WallSystem._syncWallsToPhaser();
            }
            return;
        }

        const t = this.config.walls.thickness;

        // 直接设置四边边界墙壁（不调用 init()，避免生成迷宫）
        WallSystem.walls = [
            { x: 0, y: 0, w: size, h: t, height: 60 },           // 上边界
            { x: 0, y: size - t, w: size, h: t, height: 60 },    // 下边界
            { x: 0, y: 0, w: t, h: size, height: 60 },           // 左边界
            { x: size - t, y: 0, w: t, h: size, height: 60 },    // 右边界
        ];
        WallSystem.trees = []; // 清空树木

        // 同步到 Phaser（保留碰撞体）
        if (WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }

        // 战斗房墙壁已烘焙进地形贴图，清除默认 2.5D 墙体贴图避免错位
        const phaserScene = window.__phaserScene;
        if (phaserScene && phaserScene.visualWalls) {
            phaserScene.visualWalls.clear(true, true);
        }
    },

    /**
     * 单格墙标准：以世界位面 1×1 墙块为唯一模块沿四边铺成闭合墙环。
     * 墙块中心严格落在 128×64 菱形网格点；四个转角各只复用一个墙块。
     * 偶数格边让中央六格门洞端点同样落在格心，门端墙块只保留朝墙外侧的半段碰撞。
     */
    _generateWorldBlockWalls(d) {
        const edgeNames = ['TR', 'RB', 'BL', 'LT'];
        const openingEdge = edgeNames[this._entranceEdge];
        const openings = this._appendWorldBlockRoomWalls(
            { ...d, edgeCells: this._gridEdgeCells }, [openingEdge]);
        this._gridGateSpan = openings[openingEdge] || null;
    },

    /** 当前地牢样式的单格墙视觉件：贴图锚、碰撞面线与 depth 只在这里计算。 */
    _makeWorldBlockPiece(center, baseSegments, extra = {}) {
        const style = WallSystem.getWallStyle ? WallSystem.getWallStyle() : null;
        const geo = ISO_WALL_GEO[style?.block || 'frozen_block'];
        if (!geo) return null;
        const scaleX = (geo.displayW || geo.displaySize || 260) / geo.w;
        const scaleY = (geo.displayH || geo.displaySize || 260) / geo.h;
        const ground = geo.groundCenter || [geo.w / 2, geo.h * 0.74];
        const baseDepth = Math.max(...baseSegments.flat().map((point) => point.y));
        return {
            tex: geo.tex,
            x: center.x - (ground[0] - geo.w / 2) * scaleX,
            y: center.y - (ground[1] - geo.h / 2) * scaleY,
            scaleX,
            scaleY,
            flipX: false,
            flipY: false,
            depth: baseDepth + 4,
            _gridBlockWall: true,
            _baseSegments: baseSegments,
            ...extra,
        };
    },

    /**
     * 向当前墙列表追加一间单格墙房；openingEdges 的门洞使用“端点墙块 + 中间空格”结构。
     * 返回每个门洞的精确跨度、失败回填件及两个端点共享墙块。
     */
    _appendWorldBlockRoomWalls(room, openingEdges = []) {
        const edgeCells = Math.max(12, room.edgeCells || this._gridEdgeCells || 20);
        const T = { x: room.cx, y: room.cy - room.ry };
        const R = { x: room.cx + room.rx, y: room.cy };
        const B = { x: room.cx, y: room.cy + room.ry };
        const L = { x: room.cx - room.rx, y: room.cy };
        const edgeNames = ['TR', 'RB', 'BL', 'LT'];
        const edges = [[T, R], [R, B], [B, L], [L, T]];
        const edgeSteps = edges.map(([P, Q]) => ({
            x: (Q.x - P.x) / edgeCells,
            y: (Q.y - P.y) / edgeCells,
        }));
        const openings = {};
        for (const edge of new Set(openingEdges.filter(Boolean))) {
            const opening = this._worldBlockOpeningGeometry({ ...room, edgeCells }, edge);
            if (opening) openings[edge] = opening;
        }

        edges.forEach(([P], edgeIndex) => {
            const edgeName = edgeNames[edgeIndex];
            const step = edgeSteps[edgeIndex];
            const incomingStep = edgeSteps[(edgeIndex + edges.length - 1) % edges.length];
            const opening = openings[edgeName] || null;
            for (let i = 0; i < edgeCells; i++) {
                const center = { x: P.x + step.x * i, y: P.y + step.y * i };
                const insideOpening = opening && i > opening.startIndex && i < opening.endIndex;
                if (insideOpening) {
                    let A = { x: center.x - step.x / 2, y: center.y - step.y / 2 };
                    let B0 = { x: center.x + step.x / 2, y: center.y + step.y / 2 };
                    if (i === opening.startIndex + 1) A = { ...opening.rawA };
                    if (i === opening.endIndex - 1) B0 = { ...opening.rawB };
                    opening.fillPieces.push(this._makeWorldBlockPiece(center, [[A, B0]]));
                    continue;
                }

                let baseSegments;
                if (opening && i === opening.startIndex) {
                    baseSegments = [[
                        { x: center.x - step.x / 2, y: center.y - step.y / 2 },
                        { x: center.x, y: center.y },
                    ]];
                } else if (opening && i === opening.endIndex) {
                    baseSegments = [[
                        { x: center.x, y: center.y },
                        { x: center.x + step.x / 2, y: center.y + step.y / 2 },
                    ]];
                } else if (i === 0) {
                    baseSegments = [
                        [
                            { x: center.x - incomingStep.x / 2, y: center.y - incomingStep.y / 2 },
                            { x: center.x, y: center.y },
                        ],
                        [
                            { x: center.x, y: center.y },
                            { x: center.x + step.x / 2, y: center.y + step.y / 2 },
                        ],
                    ];
                } else {
                    baseSegments = [[
                        { x: center.x - step.x / 2, y: center.y - step.y / 2 },
                        { x: center.x + step.x / 2, y: center.y + step.y / 2 },
                    ]];
                }
                const piece = this._makeWorldBlockPiece(center, baseSegments);
                WallSystem.isoVisuals.push(piece);
                if (opening && (i === opening.startIndex || i === opening.endIndex)) {
                    opening.endpointPieces.push({ point: { ...center }, piece });
                }
            }
        });
        return openings;
    },

    /**
     * 在竞技场末房中央追加一间实体单格墙宝箱房。
     * 这里只负责与战斗房同标准的格网墙体与六格门洞；宝箱、独立门闸和倒计时
     * 仍归 ChestRoomSystem 管理，避免占用战斗房出口的全局 WallGate。
     */
    appendWorldBlockTreasureRoom(bounds) {
        if (!bounds || this._roomConstruction !== 'worldBlock1x1') return null;
        const edgeCells = 12;
        const cellW = ONE_CELL_BUILDING_FOOT.w;
        const cellD = ONE_CELL_BUILDING_FOOT.d;
        const room = {
            cx: bounds.cx,
            cy: bounds.cy,
            rx: edgeCells * cellW / 2,
            ry: edgeCells * cellD / 2,
            edgeCells,
        };
        const before = WallSystem.isoVisuals.length;
        const openings = this._appendWorldBlockRoomWalls(room, ['RB']);
        const opening = openings.RB || null;
        if (!opening) return null;
        return {
            ...room,
            opening,
            pieces: WallSystem.isoVisuals.slice(before),
        };
    },

    _spawnPlayer(player, edge, roomSize) {
        if (!player) return;

        // 菱形房：连续墙沿用顶点入场；单格墙环从实际开门边中点沿内法线入场。
        if (this._diamond) {
            const d = this._diamond;
            const off = this.config.playerSpawn.offsetFromEdge + 60;
            const V = this._roomConstruction === 'worldBlock1x1'
                ? [
                    { x: d.cx + d.rx / 2, y: d.cy - d.ry / 2 }, // TR 边中点
                    { x: d.cx + d.rx / 2, y: d.cy + d.ry / 2 }, // RB
                    { x: d.cx - d.rx / 2, y: d.cy + d.ry / 2 }, // BL
                    { x: d.cx - d.rx / 2, y: d.cy - d.ry / 2 }, // LT
                ][edge]
                : [
                    { x: d.cx, y: d.cy - d.ry },
                    { x: d.cx + d.rx, y: d.cy },
                    { x: d.cx, y: d.cy + d.ry },
                    { x: d.cx - d.rx, y: d.cy },
                ][edge];
            const spawnAnchor = V || { x: d.cx, y: d.cy + d.ry };
            const dx = d.cx - spawnAnchor.x, dy = d.cy - spawnAnchor.y;
            const len = Math.hypot(dx, dy) || 1;
            player.x = spawnAnchor.x + dx / len * off;
            player.y = spawnAnchor.y + dy / len * off;
            const Game0 = gameRef();
            if (Game0 && Game0.entities) {
                Game0.entities.set('player', player);
            }
            return;
        }

        const offset = this.config.playerSpawn.offsetFromEdge;
        const margin = this.config.walls.margin;
        const safeMin = margin;
        const safeMax = roomSize - margin;
        const center = roomSize / 2;

        // 在四边中间位置生成玩家（固定像素，使用 bottom 定位）
        switch (edge) {
            case 0: // 上边
                player.x = center;
                player.y = safeMin + offset;
                break;
            case 1: // 右边
                player.x = safeMax - offset;
                player.y = center;
                break;
            case 2: // 下边
                player.x = center;
                player.y = safeMax - offset;
                break;
            case 3: // 左边
                player.x = safeMin + offset;
                player.y = center;
                break;
            default:
                // 默认中心
                player.x = center;
                player.y = center;
        }

        // 确保玩家在 entities 中
        const Game = gameRef();
        if (Game && Game.entities) {
            Game.entities.set('player', player);
        }
    },

    _calculateRoomBounds(roomSize) {
        // 菱形房：外接矩形 + 菱形参数（生成采样用）
        if (this._diamond) {
            const d = this._diamond;
            return {
                minX: d.cx - d.rx,
                maxX: d.cx + d.rx,
                minY: d.cy - d.ry,
                maxY: d.cy + d.ry,
                cx: d.cx,
                cy: d.cy,
                diamond: true,
                rx: d.rx,
                ry: d.ry,
            };
        }
        const margin = this.config.walls.margin;
        const cx = roomSize / 2;
        const cy = roomSize / 2;
        return {
            minX: margin,
            maxX: roomSize - margin,
            minY: margin,
            maxY: roomSize - margin,
            cx,
            cy
        };
    },

    _calculateSpawnArea(bounds, oppositeEdge, margin, spawnDepth, minWallDistance = 0) {
        // 菱形房：生成区 = 对角顶点附近区域（采样时按菱形内缩裁剪）
        if (bounds.diamond) {
            const V = this._roomConstruction === 'worldBlock1x1'
                ? [
                    { x: bounds.cx + bounds.rx / 2, y: bounds.cy - bounds.ry / 2 },
                    { x: bounds.cx + bounds.rx / 2, y: bounds.cy + bounds.ry / 2 },
                    { x: bounds.cx - bounds.rx / 2, y: bounds.cy + bounds.ry / 2 },
                    { x: bounds.cx - bounds.rx / 2, y: bounds.cy - bounds.ry / 2 },
                ][oppositeEdge]
                : [
                    { x: bounds.cx, y: bounds.cy - bounds.ry },
                    { x: bounds.cx + bounds.rx, y: bounds.cy },
                    { x: bounds.cx, y: bounds.cy + bounds.ry },
                    { x: bounds.cx - bounds.rx, y: bounds.cy },
                ][oppositeEdge];
            const spawnAnchor = V || { x: bounds.cx, y: bounds.cy };
            const depth = Math.max(spawnDepth * 2, 320);
            return {
                minX: spawnAnchor.x - depth,
                maxX: spawnAnchor.x + depth,
                minY: spawnAnchor.y - depth,
                maxY: spawnAnchor.y + depth,
                _diamondClip: bounds,
            };
        }
        // margin（spawn.monsterMargin）与 minWallDistance 取较大者作为贴墙安全距离
        const inset = Math.max(minWallDistance, margin || 0);
        const safeMinX = bounds.minX + inset;
        const safeMaxX = bounds.maxX - inset;
        const safeMinY = bounds.minY + inset;
        const safeMaxY = bounds.maxY - inset;

        let minX, maxX, minY, maxY;

        switch (oppositeEdge) {
            case 0: // 对边 = 上边
                minX = safeMinX;
                maxX = safeMaxX;
                minY = safeMinY;
                maxY = safeMinY + spawnDepth;
                break;
            case 2: // 对边 = 下边
                minX = safeMinX;
                maxX = safeMaxX;
                minY = safeMaxY - spawnDepth;
                maxY = safeMaxY;
                break;
            case 3: // 对边 = 左边
                minX = safeMinX;
                maxX = safeMinX + spawnDepth;
                minY = safeMinY;
                maxY = safeMaxY;
                break;
            case 1: // 对边 = 右边
                minX = safeMaxX - spawnDepth;
                maxX = safeMaxX;
                minY = safeMinY;
                maxY = safeMaxY;
                break;
            default:
                // 默认中心区域，同时受最小墙壁距离约束
                minX = Math.max(safeMinX, bounds.cx - 200);
                maxX = Math.min(safeMaxX, bounds.cx + 200);
                minY = Math.max(safeMinY, bounds.cy - 200);
                maxY = Math.min(safeMaxY, bounds.cy + 200);
        }

        return { minX, maxX, minY, maxY };
    },

    _setupCamera(player) {
        if (!Camera || !player) return;

        // 恢复原始 follow 函数（如果之前被覆盖）
        if (this._backupCameraFollow) {
            Camera.follow = this._backupCameraFollow;
        }
        Camera.follow(player);
    },

    /**
     * 清理所有掉落物（包括金币、装备等）并销毁对应 Phaser Sprite
     */
    cleanupDrops() {
        const Game = gameRef();
        if (!Game || !Game.entities) return;
        for (const [key, entity] of Game.entities.entries()) {
            if (!key.startsWith('drop_')) continue;
            if (entity && typeof entity._destroyPhaserSprite === 'function') {
                entity._destroyPhaserSprite();
            }
            Game.entities.delete(key);
        }
    }
};

// ==================== 便捷函数 ====================

/**
 * 快速进入普通战斗场地
 * @param {Object} player - 玩家实体
 * @param {Object} options - 可选配置
 * @returns {Object} 场地信息
 */
export function enterCombat(player, options) {
    return CombatRoomSystem.enterCombatRoom(player, false, options);
}

/**
 * 快速进入 Boss 战斗场地
 * @param {Object} player - 玩家实体
 * @param {Object} options - 可选配置
 * @returns {Object} 场地信息
 */
export function enterBossRoom(player, options) {
    return CombatRoomSystem.enterCombatRoom(player, true, options);
}

/**
 * 生成普通战斗怪物
 * @param {number} count - 数量（默认3）
 * @param {Array} customClasses - 自定义怪物类
 * @returns {Array} 怪物数组
 */
export function spawnCombatMonsters(count, customClasses) {
    return CombatRoomSystem.spawnMonsters(count, false, customClasses);
}

/**
 * 生成 Boss 怪物
 * @param {number} count - 数量（默认1）
 * @param {Array} customClasses - 自定义怪物类
 * @returns {Array} 怪物数组
 */
export function spawnBossMonsters(count, customClasses) {
    return CombatRoomSystem.spawnMonsters(count, true, customClasses);
}

// 挂载到全局
if (typeof window !== 'undefined' && !window.CombatRoomSystem) {
    window.CombatRoomSystem = CombatRoomSystem;
}

export default CombatRoomSystem;
