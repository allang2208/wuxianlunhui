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
import { applyDungeonFloor, applyDiamondFloor, applyArenaFloor, getDungeonFloorProfile } from './dungeon-floor-texture.js';
import { WallGate } from './wall-gate.js';
import { TrapSystem } from './trap-system.js';
import { GateLight } from '../effects/gate-light.js';
import { ChestRoomSystem } from './chest-room-system.js';
import { Input } from '../ui/input.js';
import { createMineCave } from './zombie-dungeon.js';
import { getWallPrefabLibrary } from './wall-prefabs.js';
import { SoundManager } from '../ui/sound-manager.js';
import { computeArenaLayout, pointInDiamond, ARENA_AXIS } from './combat-arena-layout.js';
import { ObstacleSpawnSystem } from './obstacle-spawn-system.js';

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

    // 三房间串联竞技场（D 级及以上战斗事件；null = 单房间模式）
    _arena: null,

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

        // 2. 确定场地大小（菱形：rx=1.2S、ry=rx×0.5774，区外全黑）
        const roomSize = options.roomSize || this._rollRoomSize(isBoss);
        this._roomSize = roomSize;
        const rx = Math.round(roomSize * 1.2);
        const ry = Math.round(rx * 0.5774);
        // 边距必须 ≥ 墙体贴图高度（190×角度补偿≈217）+ 缓冲，否则上夹角被世界顶裁掉
        const M = 260;
        this._diamond = {
            rx, ry,
            worldW: 2 * (rx + M),
            worldH: 2 * (ry + M),
            cx: rx + M,
            cy: ry + M,
        };

        // 3. 生成场地地形（菱形地板）
        this._generateTerrain(roomSize);

        // 4. 生成边界墙壁（菱形斜墙 + 四角转角）
        this._generateWalls(roomSize);

        // 6. 确定玩家生成边并放置玩家
        const entranceEdge = this._rollEntranceEdge();
        this._entranceEdge = entranceEdge;
        this._oppositeEdge = (entranceEdge + 2) % 4;
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

            const caveRadius = 90; // 矿洞碰撞半径
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
            const forwardX = 50; // enemy-config mineCave.attackSkills.spawn.forwardX
            const probeRadius = 15; // 矿工 groundRadius 量级
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
     * @returns {number}
     */
    getGoldReward(isBoss = false) {
        const cfg = this.config.cleanup.goldReward;
        if (isBoss) return cfg.boss;
        return cfg.normal.min + Math.floor(Math.random() * (cfg.normal.max - cfg.normal.min));
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

    /** 门外白区：吸附地板晶格的一块黑砖（与房内地板无缝），远角径向圆滑淡出；
     *  默认出口门（WallGate + 当前 _diamond）；也可传 entryInfo/entryDiamond 给入场门生成入口地块 */
    _spawnGateExitZone(info = WallGate.getGateInfo(), diamond = this._diamond) {
        const scene = window.__phaserScene;
        if (!scene || !info || !info.center || !diamond) return null;
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
        const zoneKey = this._arenaEntryZoneBaking ? 'gate_zone_tile_entry' : 'gate_zone_tile';
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
        const glowKey = this._arenaEntryZoneBaking ? 'gate_zone_glow_entry' : 'gate_zone_glow';
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
        if (this._arenaEntryZoneBaking) {
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
            for (const s of this._gateZone._sprites) {
                if (s && s.scene) {
                    s.scene.tweens.killTweensOf(s);
                    s.destroy();
                }
            }
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
    // 三房间串联竞技场（D 级及以上战斗事件）
    // ============================================================
    //
    // 布局：3 个菱形房间沿左上→右下斜轴串联（combat-arena-layout.js 纯函数计算），
    // 房间 1/2 = normalSize，房间 3 = eliteSize（含宝箱房）；相邻房间在"右下/左上墙壁中段"
    // 开洞，用摆墙编辑器的通道预制（「上下通道」/「左右通道」镜像套）连接；
    // 预制的门墙件建成可开闭功能门（_arenaGate 碰撞段，初始常开），
    // 房间 3 右下墙中段的 WallGate 单例 + 门外白区作为清完后的退出区域。
    //
    // 波次编排（dungeon-map-system）：进入房间 N 才关门刷第 N 波，清完开门。

    /**
     * 进入三房间串联竞技场
     * @param {Object} player 玩家实体
     * @param {Object} options { normalSize, eliteSize }
     * @returns {Object|false} 场地信息 { rooms, worldW, worldH }；预制缺失/轴向不符返回 false（调用方回退单房间）
     */
    enterCombatArena(player, options = {}) {
        if (!player) {
            console.error('[CombatRoomSystem] enterCombatArena: player is required');
            return false;
        }

        // 1. 解析通道预制（墙样式键 → default 回退；两门墙件底边中心距 = 通道长度）
        const arenaCfg = DungeonConfig.getCombatArenaConfig();
        const analysis = this._resolvePassagePrefab(arenaCfg);
        if (!analysis) {
            console.warn('[CombatRoomSystem] 竞技场：无可用通道预制（combatArena.passagePrefabs），回退单房间');
            return false;
        }

        const normalSize = options.normalSize || this.config.roomSize.normal;
        const eliteSize = options.eliteSize || this.config.roomSize.elite;
        const layout = computeArenaLayout({
            normalSize, eliteSize,
            passageLen: analysis.len,
            gap: arenaCfg.passageGap || 0,
        });

        this._player = player;
        this.state = 'combat';
        this.active = true;

        // 2. 备份场景（离场时 cleanupRoom → _restoreSceneState 一次性恢复）
        this._backupSceneState();

        // 3. 地形：三房地板 + 通道精确平行四边形（并集裁剪）+ 连续墙脚阴影
        //    （E/F 同口径：菱形整圈渐变含门口；走廊只描两条长边），并同步世界尺寸
        const corridors = [];
        const patches = [];
        for (let i = 0; i < 2; i++) {
            corridors.push(this._arenaPassageFloorQuad(analysis, layout.passages[i], layout.rooms[i], layout.rooms[i + 1]));
        }
        applyArenaFloor(layout.worldW, layout.worldH,
            layout.rooms.map(r => ({ cx: r.cx, cy: r.cy, rx: r.rx, ry: r.ry })),
            corridors, patches, this.config.terrain);

        // 4. 墙体：三房菱形墙（一次清空后逐房追加）
        WallSystem.walls = [];
        WallSystem.trees = [];
        WallSystem.isoVisuals = [];
        for (const r of layout.rooms) {
            WallSystem.buildIsoDiamondWalls(r.cx, r.cy, r.rx, r.ry);
        }

        // 5. 通道：平移预制 → 摘门洞覆盖的墙件（"移除对应大小的墙"）→ 直墙入件 / 门墙建功能门
        const passageRecs = [];
        for (let i = 0; i < 2; i++) {
            const rec = this._placeArenaPassage(analysis, layout.passages[i], layout.rooms[i], layout.rooms[i + 1]);
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
                        if (inst.sprite && inst.sprite.scene) inst.sprite.destroy();
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
        for (let i = 0; i < 2; i++) {
            this._sealPassageSides(analysis, layout.passages[i], layout.rooms[i], layout.rooms[i + 1]);
        }

        WallSystem.rebuildIsoCollision();
        if (WallSystem._syncWallsToPhaser) WallSystem._syncWallsToPhaser();

        // 6. 竞技场状态（_diamond 固定指向房间 3：出口门/白区/离场判定都以其为准；
        //    _roomBounds 指向当前战斗房间，随 stage 切换——刷怪/墓碑共用现有逻辑）
        const r3 = layout.rooms[2];
        this._arena = { rooms: layout.rooms, passages: passageRecs, stage: 1, awaiting: 0 };
        this._diamond = { rx: r3.rx, ry: r3.ry, cx: r3.cx, cy: r3.cy, worldW: layout.worldW, worldH: layout.worldH };
        this._roomBounds = layout.rooms[0].bounds;
        this._entranceEdge = 0;
        this._oppositeEdge = 2; // 怪物统一刷当前房间下顶点附近

        // 8. 出口门：房间 3 右下边中点（straightOnly——三房各有转角装饰门，必须锚定目标边中点）
        this._setupGate({ x: r3.cx + r3.rx / 2, y: r3.cy + r3.ry / 2 }, { straightOnly: true });

        // 8.1 入场门：房间 1 左上墙（LT 边）中段直墙件原位替换为门墙（初始常开）+ 门外入场地块
        const entryGate = this._setupEntryGate(layout.rooms[0]);
        let entryZone = null;
        if (entryGate) {
            const r1d = layout.rooms[0];
            this._arenaEntryZoneBaking = true;
            entryZone = this._spawnGateExitZone(
                { center: entryGate.center, seg: [entryGate.baseA, entryGate.baseB], flip: entryGate.sprite ? entryGate.sprite.flipX : false },
                { cx: r1d.cx, cy: r1d.cy, rx: r1d.rx, ry: r1d.ry }
            );
            if (this._arena) {
                this._arena.entryGate = entryGate;
                this._arena.entryZone = entryZone;
            }
        }

        // 8.6 开洞边缝隙填充：沿房间边线投影补瓦（只叠不缺，edgeFill 同口径）——
        //     5 条开洞边：房1 RB、房2 LT/RB、房3 LT（通道门）、房3 RB（出口门）
        const allGateSegs = passageRecs.flatMap(rec => rec.gates.map(g => [g.baseA, g.baseB]));
        if (WallGate._seg) allGateSegs.push(WallGate._seg);
        if (entryGate) allGateSegs.push([entryGate.baseA, entryGate.baseB]);
        this._fillEdgeGaps(layout.rooms[0], 'RB', allGateSegs);
        this._fillEdgeGaps(layout.rooms[0], 'LT', allGateSegs);
        this._fillEdgeGaps(layout.rooms[1], 'LT', allGateSegs);
        this._fillEdgeGaps(layout.rooms[1], 'RB', allGateSegs);
        this._fillEdgeGaps(layout.rooms[2], 'LT', allGateSegs);
        this._fillEdgeGaps(layout.rooms[2], 'RB', allGateSegs);

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
            if (r.index === 3 && exitInfo && exitInfo.center) {
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

    /** 解析通道预制：样式键 → default 回退；校验双门墙件与串联轴对齐（|dot| ≥ 0.8） */
    _resolvePassagePrefab(arenaCfg) {
        const lib = getWallPrefabLibrary();
        const names = (arenaCfg && arenaCfg.passagePrefabs) || { default: '左右通道' };
        // 当前墙样式键（zombie/swamp…）：取样式表第一个键名末段做模糊匹配，找不到再用 default
        const candidates = [];
        const style = WallSystem.getWallStyle ? WallSystem.getWallStyle() : null;
        if (style && style.chestPrefab) {
            // 样式表以 chestPrefab 区分（宝箱房/沼泽宝箱房）：含"沼泽"键优先沼泽通道
            const isSwamp = /沼泽/.test(style.chestPrefab);
            if (isSwamp) candidates.push(names.swamp);
        }
        candidates.push(names.default);
        for (const name of candidates) {
            if (!name || !lib[name]) continue;
            const analysis = this._analyzePassagePrefab(lib[name]);
            if (analysis) return analysis;
            console.warn(`[CombatRoomSystem] 通道预制「${name}」轴向不符或门墙件不足，尝试下一候选`);
        }
        return null;
    },

    /** 预制解析：提取两个功能门墙件的底边中心与间距（通道长度），校验与串联轴对齐 */
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
        // 与串联轴 (0.866, 0.5) 对齐校验；反向则交换两端（↖ 端接房间 N）
        let dot = (vx * ARENA_AXIS.x + vy * ARENA_AXIS.y) / len;
        if (dot < 0) { [gA, gB] = [gB, gA]; dot = -dot; }
        if (dot < 0.8) return null;
        // 门墙底边跨度（梯形地板的门口端宽度用）
        const segA = WallSystem._pieceBaseSegments(gA.piece)[0];
        const span = segA ? Math.hypot(segA[1].x - segA[0].x, segA[1].y - segA[0].y) : 300;
        return { def, gA, gB, len, span };
    },

    /** 是否功能门墙件（有门洞几何且非永久开放装饰门、非障碍物） */
    _isFunctionalGatePiece(p) {
        const g = WallSystem._geoForTex(p.tex);
        return !!(g && g.category !== 'obstacle' && !g.openDoor && isoGateHole(g));
    },

    /**
     * 放置一条通道：预制按 gA→mid1 纯平移（gB 应落 mid2，容差 80px）；
     * 先两轮摘除两门覆盖的墙件，再把直墙件推入 isoVisuals、门墙件建功能门（初始常开）
     */
    _placeArenaPassage(analysis, passage, roomA, roomB) {
        const t = { x: passage.mid1.x - analysis.gA.center.x, y: passage.mid1.y - analysis.gA.center.y };
        const bx = analysis.gB.center.x + t.x, by = analysis.gB.center.y + t.y;
        if (Math.hypot(bx - passage.mid2.x, by - passage.mid2.y) > 80) {
            console.warn('[CombatRoomSystem] 通道预制长度与房间间距不符',
                Math.round(Math.hypot(bx - passage.mid2.x, by - passage.mid2.y)), 'px');
            return null;
        }
        // 第一轮：平移全部件，先让两门墙"移除对应大小的墙"（摘覆盖跨度的房间墙件）
        const translated = analysis.def.pieces.map(p => ({
            ...p,
            x: p.x + t.x,
            y: p.y + t.y,
            depth: p.depth != null ? p.depth + t.y : p.depth,
        }));
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
                    WallSystem.isoVisuals.push(clipped);
                }
            }
        }
        return { index: passage.index, mid1: passage.mid1, mid2: passage.mid2, center: passage.center, gates };
    },

    /**
     * 通道地板（精确平行四边形，唯一地板形状——不再用"走廊块+门口补丁"拼接）：
     * - 两条侧边 = 通道两侧墙线的实测位置（预制直墙件到轴的垂直距离，内收 12px 藏入墙下）；
     * - 两个端边 = 两侧房间的边线各向房内平移 80px（与房间菱形地板叠合，天然盖住门槛）。
     * 侧边与房间墙成 60° 的楔形区由 _sealPassageSides 的封口墙件遮挡。
     * 旧版"按走廊轴居中的等宽块"：两侧墙距轴不等（+184/-211），居中展宽一侧探出墙外、
     * 另一侧露出黑条（"地板超出边界 + 黑色区域"的根因）。
     */
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
        // 两条侧边（点 + 方向 axis）
        const near = { P: { x: mid.x + perp.x * (dPos - 12), y: mid.y + perp.y * (dPos - 12) }, d: axis };
        const far = { P: { x: mid.x - perp.x * (dNeg - 12), y: mid.y - perp.y * (dNeg - 12) }, d: axis };
        // 两个端边（房间边线向房内平移 80px）
        const endA = {
            P: { x: roomA.cx + roomA.rx - axis.x * 80, y: roomA.cy - axis.y * 80 },
            d: { x: -roomA.rx, y: roomA.ry },
        };
        const endB = {
            P: { x: roomB.cx + axis.x * 80, y: roomB.cy - roomB.ry + axis.y * 80 },
            d: { x: -roomB.rx, y: roomB.ry },
        };
        const intersect = (l1, l2) => {
            const ex = l2.P.x - l1.P.x, ey = l2.P.y - l1.P.y;
            const denom = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
            if (Math.abs(denom) < 1e-6) return l1.P;
            const t = (ex * l2.d.y - ey * l2.d.x) / denom;
            return { x: l1.P.x + l1.d.x * t, y: l1.P.y + l1.d.y * t };
        };
        return {
            points: [
                intersect(near, endA),
                intersect(near, endB),
                intersect(far, endB),
                intersect(far, endA),
            ],
        };
    },

    /**
     * 建通道功能门（碰撞模型同宝箱房门：两侧墙身常开 + 门洞段按开关启停）
     * 初始常开（帧 = 末帧，门洞段不入碰撞）；碰撞段标 _arenaGate（rebuildIsoCollision 保留）
     * 深度 = 整墙 min/max 规则（mode='max' 前墙 / 'min' 后墙，与菱形墙、宝箱房全场统一）
     */
    _createArenaGate(piece) {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        if (!scene || !scene.textures.exists(piece.tex)) {
            console.warn('[CombatRoomSystem] _createArenaGate 失败：贴图未就绪', piece.tex);
            return null;
        }
        const g = WallSystem._geoForTex(piece.tex) || ISO_WALL_GEO.gate;
        const frames = g.frames || 16;
        const sprite = scene.add.sprite(piece.x, piece.y, piece.tex, frames - 1);
        sprite.setOrigin(0.5, 0.5);
        sprite.setScale(piece.scaleX ?? 1, piece.scaleY ?? piece.scaleX ?? 1);
        sprite.setFlipX(!!piece.flipX);

        const baseSegs = WallSystem._pieceBaseSegments(piece);
        if (!baseSegs.length) { sprite.destroy(); console.warn('[CombatRoomSystem] _createArenaGate 失败：无底线段', piece.tex); return null; }
        const [gA, gB] = baseSegs[0];
        const hole = isoGateHole(g);
        if (!hole) { sprite.destroy(); console.warn('[CombatRoomSystem] _createArenaGate 失败：无门洞几何', piece.tex); return null; }
        const ht = isoHalfThick(g);
        const baseAt = (tx) => WallSystem.texPointToWorld(piece, tx, g.base[0][1] + (tx - g.base[0][0]) * g.slope);
        const g1 = baseAt(hole[0]), g2 = baseAt(hole[1]);
        // 门墙 depth = 门洞中心底边 y（"墙看底边 max、门看门洞中心"定案）：
        // 单位脚线 y < 门洞中心 → 被门遮挡（墙后/走廊侧）；
        // 单位脚线 y > 门洞中心 → 完整显现（已过半场/进入房间）。
        // 旧规则取底边 max 端：单位在门洞浅端内侧仍被门压（过遮挡），穿门全程隐形（显形过晚）
        sprite.setDepth((g1.y + g2.y) / 2);

        const wallSegs = [
            { x1: gA.x, y1: gA.y, x2: g1.x, y2: g1.y, halfThick: ht, _arenaGate: true },
            { x1: g2.x, y1: g2.y, x2: gB.x, y2: gB.y, halfThick: ht, _arenaGate: true },
        ];
        const gateSeg = { x1: g1.x, y1: g1.y, x2: g2.x, y2: g2.y, halfThick: ht, _arenaGate: true };
        if (WallSystem.isoSegments) {
            for (const s of wallSegs) WallSystem.isoSegments.push(s);
            // 初始常开：门洞段不入碰撞
        }
        // 门洞中心（世界）：障碍物/陷阱的门口排除与可达性校验用
        const center = { x: (g1.x + g2.x) / 2, y: (g1.y + g2.y) / 2 };
        return { sprite, wallSegs, gateSeg, center, baseA: gA, baseB: gB, open: true, frames, _animCounter: null };
    },

    /**
     * 通道直墙件房间裁剪：预制侧墙比门到门跨度长，60° 相接处会越过房间边线
     * 探入房内/横跨门口（"墙壁突出通道"的根因）。
     * 处理：底边线段与两侧房间边线求交，越进房内的端点裁回边线（外留 8px 叠合），
     * 整件全在房内的直接丢弃；中心/scaleX 同步折算（高度 scaleY 与深度不变）。
     */
    _clipPassagePieceToRooms(piece, passage, roomA, roomB) {
        const seg = WallSystem._pieceBaseSegments(piece)[0];
        if (!seg) return piece;
        let [A, B] = seg.map(p => ({ ...p }));
        // 房间边线：roomA RB（R→B）/ roomB LT（T→L），"房内" = 朝向房心一侧
        const edges = [
            { P: { x: roomA.cx + roomA.rx, y: roomA.cy }, d: { x: -roomA.rx, y: roomA.ry }, c: { x: roomA.cx, y: roomA.cy } },
            { P: { x: roomB.cx, y: roomB.cy - roomB.ry }, d: { x: -roomB.rx, y: roomB.ry }, c: { x: roomB.cx, y: roomB.cy } },
        ];
        for (const e of edges) {
            // 法线（指向房心）
            let nx = -e.d.y, ny = e.d.x;
            const nl = Math.hypot(nx, ny) || 1;
            nx /= nl; ny /= nl;
            const signC = (e.c.x - e.P.x) * nx + (e.c.y - e.P.y) * ny;
            if (signC < 0) { nx = -nx; ny = -ny; }
            const sOf = (P) => (P.x - e.P.x) * nx + (P.y - e.P.y) * ny; // >0 = 房内
            const sA = sOf(A), sB = sOf(B);
            const INSIDE = 8; // 允许越线 8px（叠合公差）
            if (sA > INSIDE && sB > INSIDE) return null; // 整件在房内：丢弃
            if (sA > INSIDE || sB > INSIDE) {
                // 求与"边线向房内 +8px"的交点，裁回越线端点
                const clipPt = (inside, outside) => {
                    const si = sOf(inside), so = sOf(outside);
                    const t = (so - INSIDE) / (so - si);
                    return { x: outside.x + (inside.x - outside.x) * t, y: outside.y + (inside.y - outside.y) * t };
                };
                if (sA > INSIDE) A = clipPt(A, B);
                if (sB > INSIDE) B = clipPt(B, A);
            }
        }
        const oldLen = Math.hypot(seg[1].x - seg[0].x, seg[1].y - seg[0].y);
        const newLen = Math.hypot(B.x - A.x, B.y - A.y);
        if (newLen < 10) return null; // 裁完不足一截：丢弃
        // 中心随底边中心平移，scaleX 按裁剪比例折算（高度/深度不变）
        const cxOld = (seg[0].x + seg[1].x) / 2, cyOld = (seg[0].y + seg[1].y) / 2;
        const cxNew = (A.x + B.x) / 2, cyNew = (A.y + B.y) / 2;
        return {
            ...piece,
            x: piece.x + (cxNew - cxOld),
            y: piece.y + (cyNew - cyOld),
            scaleX: (piece.scaleX ?? 1) * (newLen / oldLen),
        };
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
        const flip = axis.x * axis.y <= 0; // ↘ 走廊为 "\" 方向（flip=false）
        // 两条房间边线（点 + 方向）
        const edgeA = { P: { x: roomA.cx + roomA.rx, y: roomA.cy }, d: { x: -roomA.rx, y: roomA.ry } }; // RB：R→B
        const edgeB = { P: { x: roomB.cx, y: roomB.cy - roomB.ry }, d: { x: -roomB.rx, y: roomB.ry } }; // LT：T→L
        // 收集该通道的侧墙件（平行于走廊轴、在走廊侧墙带内、且在本通道跨度范围内——
        // 不过滤跨度会把其他通道/房间的平行墙并入，填充出横跨全场的 stray 墙）
        const mid = passage.center;
        const halfSpan = (passage.length || 1000) / 2 + 250;
        const byPiece = [];
        for (const p of WallSystem.isoVisuals) {
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
            const dSide = side.reduce((s, q) => s + q.perpD, 0) / side.length;
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
                const A = { x: S0.x + axis.x * a, y: S0.y + axis.y * a };
                const B = { x: S0.x + axis.x * b, y: S0.y + axis.y * b };
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
    _buildGatePieceAt(A, B, flip, depth) {
        const geoKey = WallSystem.getWallStyleGeos ? WallSystem.getWallStyleGeos().gate : 'gate';
        const g = ISO_WALL_GEO[geoKey] || ISO_WALL_GEO.gate;
        const p0 = g.base[0];
        const s = ISO_WALL_HEIGHT / g.wallH;
        const sx = s, sy = s * slopeFixOf(g);
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
        // RB = R→B（edgeFill(rD, bR)），LT = T→L（edgeFill(tL, lU)）——
        // LT 若按 L→T 参数化，_addSegPiece 的上端锚定反转，填充件就是"倒置"的（线上教训）
        const verts = {
            RB: [{ x: room.cx + room.rx, y: room.cy }, { x: room.cx, y: room.cy + room.ry }],
            LT: [{ x: room.cx, y: room.cy - room.ry }, { x: room.cx - room.rx, y: room.cy }],
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

    /** 通道门开闭（open=true 开门）：门洞碰撞段增删 + 16 帧动画 + 门闸音效 */
    _setArenaGateOpen(inst, open) {
        if (!inst || inst.open === open) return;
        inst.open = open;
        if (WallSystem.isoSegments) {
            const i = WallSystem.isoSegments.indexOf(inst.gateSeg);
            if (!open && i < 0) WallSystem.isoSegments.push(inst.gateSeg);
            else if (open && i >= 0) WallSystem.isoSegments.splice(i, 1);
        }
        const style = WallSystem.getWallStyle ? WallSystem.getWallStyle() : null;
        if (SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile((style && style.gateSound) || 'assets/sounds/environment/gate.mp3');
        }
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        const from = open ? 0 : inst.frames - 1, to = open ? inst.frames - 1 : 0;
        if (!scene) { inst.sprite.setFrame(to); return; }
        if (inst._animCounter) inst._animCounter.stop();
        inst._animCounter = scene.tweens.addCounter({
            from, to, duration: 900, ease: 'Linear',
            onUpdate: (tw) => { if (inst.sprite && inst.sprite.active) inst.sprite.setFrame(Math.round(tw.getValue())); },
        });
    },

    /** 点在哪个竞技场房间（1~3；不在任何房间返回 0，如通道内） */
    arenaRoomContaining(x, y) {
        if (!this._arena) return 0;
        for (const r of this._arena.rooms) {
            if (pointInDiamond(x, y, r)) return r.index;
        }
        return 0;
    },

    /** 房间 N 的相邻通道门统一开/关（来路 + 去路；房间 1 含入场门、房间 3 无去路） */
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

    /** 取竞技场房间 bounds（1~3；宝箱房 setup 用房间 3） */
    getArenaRoomBounds(roomIdx) {
        const a = this._arena;
        return a && a.rooms[roomIdx - 1] ? a.rooms[roomIdx - 1].bounds : null;
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
            if (inst.sprite && inst.sprite.scene) inst.sprite.destroy();
        }
        // 入场地块贴砖销毁
        if (this._arena.entryZone && this._arena.entryZone._sprites) {
            for (const s of this._arena.entryZone._sprites) {
                if (s && s.scene) {
                    s.scene.tweens.killTweensOf(s);
                    s.destroy();
                }
            }
        }
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
            WallSystem.buildIsoDiamondWalls(d.cx, d.cy, d.rx, d.ry);
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

    _spawnPlayer(player, edge, roomSize) {
        if (!player) return;

        // 菱形房：从顶点的内法线方向入场（0=T 1=R 2=B 3=L），角部加大内缩
        if (this._diamond) {
            const d = this._diamond;
            const off = this.config.playerSpawn.offsetFromEdge + 60;
            const V = [
                { x: d.cx, y: d.cy - d.ry },
                { x: d.cx + d.rx, y: d.cy },
                { x: d.cx, y: d.cy + d.ry },
                { x: d.cx - d.rx, y: d.cy },
            ][edge] || { x: d.cx, y: d.cy + d.ry };
            const dx = d.cx - V.x, dy = d.cy - V.y;
            const len = Math.hypot(dx, dy) || 1;
            player.x = V.x + dx / len * off;
            player.y = V.y + dy / len * off;
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
            const V = [
                { x: bounds.cx, y: bounds.cy - bounds.ry },
                { x: bounds.cx + bounds.rx, y: bounds.cy },
                { x: bounds.cx, y: bounds.cy + bounds.ry },
                { x: bounds.cx - bounds.rx, y: bounds.cy },
            ][oppositeEdge] || { x: bounds.cx, y: bounds.cy };
            const depth = Math.max(spawnDepth * 2, 320);
            return {
                minX: V.x - depth,
                maxX: V.x + depth,
                minY: V.y - depth,
                maxY: V.y + depth,
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
