import { WallSystem } from '../world/wall-system.js';
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

const gameRef = () => (typeof window !== 'undefined' ? window.Game : null);

// ==================== 配置对象 ====================
export const COMBAT_ROOM_CONFIG = {
    // 场地大小范围（正方形）
    roomSize: {
        min: 1024,
        max: 2048,
        boss: 4096,      // Boss 战固定场地大小
        default: 1024    // 默认/回退大小
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
        get boss() { return [BlackWolf, CircleEnemy]; },
        get zombie() {
            // 僵尸地牢怪物池（动态导入避免循环依赖）
            return [null]; // 占位，实际使用时从 zombie-dungeon.js 获取
        }
    },

    // 打扫战场配置
    cleanup: {
        countdownMs: 10000,  // 战斗完成后倒计时（毫秒）
        goldReward: {
            normal: { min: 50, max: 150 },
            boss: 300
        }
    }
};

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

    // 配置引用（可运行时替换）
    config: COMBAT_ROOM_CONFIG,

    // ============================================================
    // 公共 API
    // ============================================================

    /**
     * 初始化并进入战斗场地
     * @param {Object} player - 玩家实体
     * @param {boolean} isBoss - 是否为 Boss 战
     * @param {Object} options - 可选配置覆盖
     *   - roomSize: 指定场地大小（默认随机 1024-2048，Boss 固定 4096）
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

        // 2. 确定场地大小
        const roomSize = options.roomSize || this._rollRoomSize(isBoss);
        this._roomSize = roomSize;

        // 3. 生成场地地形
        this._generateTerrain(roomSize);

        // 4. 生成边界墙壁
        this._generateWalls(roomSize);

        // 5. 确定玩家生成边并放置玩家
        const entranceEdge = this._rollEntranceEdge();
        this._entranceEdge = entranceEdge;
        this._oppositeEdge = (entranceEdge + 2) % 4;
        this._spawnPlayer(player, entranceEdge, roomSize);

        // 6. 计算战斗区域边界
        this._roomBounds = this._calculateRoomBounds(roomSize);

        // 7. 设置相机跟随
        this._setupCamera(player);

        

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

        const spawnArea = this._calculateSpawnArea(bounds, this._oppositeEdge, cfg.margin, cfg.spawnDepth);
        const monsterCount = count || (isBoss ? cfg.count.boss : cfg.count.normal);

        const monsterClasses = customClasses || (isBoss ? this.config.monsterPool.boss : this.config.monsterPool.normal);

        for (let i = 0; i < monsterCount; i++) {
            const mx = spawnArea.minX + Math.random() * (spawnArea.maxX - spawnArea.minX);
            const my = spawnArea.minY + Math.random() * (spawnArea.maxY - spawnArea.minY);

            const MonsterClass = monsterClasses[Math.floor(Math.random() * monsterClasses.length)];
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

            const key = `combat_monster_${Date.now()}_${i}_${Math.floor(Math.random() * 1000)}`;
            const Game = gameRef();
            if (Game && Game.entities) {
                Game.entities.set(key, monster);
            }
            this._combatMonsters.push(monster);
            this._combatMonsterKeys.push(key);
        }

        
        return this._combatMonsters;
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
    cleanupRoom() {
        

        // 删除所有战斗怪物
        for (const key of this._combatMonsterKeys) {
            const Game = gameRef();
            if (Game && Game.entities) {
                Game.entities.delete(key);
            }
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
     */
    cleanupMonstersOnly() {
        for (const key of this._combatMonsterKeys) {
            const Game = gameRef();
            if (Game && Game.entities) {
                Game.entities.delete(key);
            }
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
            if (WallSystem.trees) {
                WallSystem.trees = [...this._backupTrees];
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
    // 内部方法：场地生成
    // ============================================================

    _rollRoomSize(isBoss) {
        if (isBoss) return this.config.roomSize.boss;
        const { min, max } = this.config.roomSize;
        // 随机生成 1024-2048 之间的正方形大小（步长 256）
        const steps = Math.floor((max - min) / 256) + 1;
        return min + Math.floor(Math.random() * steps) * 256;
    },

    _rollEntranceEdge() {
        const candidates = this.config.playerSpawn.edgeCandidates;
        return candidates[Math.floor(Math.random() * candidates.length)];
    },

    _generateTerrain(size) {
        // 创建正方形石砖地板纹理
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const tc = this.config.terrain;

        // 全屏深灰色地板
        ctx.fillStyle = tc.floorColor;
        ctx.fillRect(0, 0, size, size);

        // 石砖网格纹理
        ctx.strokeStyle = tc.gridColor;
        ctx.lineWidth = 1;
        for (let bx = 0; bx < size; bx += tc.gridSize) {
            ctx.beginPath();
            ctx.moveTo(bx, 0);
            ctx.lineTo(bx, size);
            ctx.stroke();
        }
        for (let by = 0; by < size; by += tc.gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, by);
            ctx.lineTo(size, by);
            ctx.stroke();
        }

        // 全地图边缘高光
        ctx.strokeStyle = tc.edgeHighlight;
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, size, size);

        // 应用到渲染器
        if (Renderer) {
            Renderer.terrainTexture = canvas;
        }

        // 更新世界尺寸
        if (CONFIG) {
            CONFIG.WORLD_WIDTH = size;
            CONFIG.WORLD_HEIGHT = size;
        }
    },

    _generateWalls(size) {
        if (!WallSystem) return;

        const t = this.config.walls.thickness;

        // 直接设置四边边界墙壁（不调用 init()，避免生成迷宫）
        WallSystem.walls = [
            { x: 0, y: 0, w: size, h: t, height: 60 },           // 上边界
            { x: 0, y: size - t, w: size, h: t, height: 60 },    // 下边界
            { x: 0, y: 0, w: t, h: size, height: 60 },           // 左边界
            { x: size - t, y: 0, w: t, h: size, height: 60 },    // 右边界
        ];
        WallSystem.trees = []; // 清空树木

        // 同步到 Phaser
        if (WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }
    },

    _spawnPlayer(player, edge, roomSize) {
        if (!player) return;

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

    _calculateSpawnArea(bounds, oppositeEdge, margin, spawnDepth) {
        const safeMin = bounds.minX;
        const safeMax = bounds.maxX;

        let minX, maxX, minY, maxY;

        switch (oppositeEdge) {
            case 0: // 对边 = 上边
                minX = safeMin;
                maxX = safeMax;
                minY = safeMin;
                maxY = safeMin + spawnDepth;
                break;
            case 2: // 对边 = 下边
                minX = safeMin;
                maxX = safeMax;
                minY = safeMax - spawnDepth;
                maxY = safeMax;
                break;
            case 3: // 对边 = 左边
                minX = safeMin;
                maxX = safeMin + spawnDepth;
                minY = safeMin;
                maxY = safeMax;
                break;
            case 1: // 对边 = 右边
                minX = safeMax - spawnDepth;
                maxX = safeMax;
                minY = safeMin;
                maxY = safeMax;
                break;
            default:
                // 默认中心区域
                minX = bounds.cx - 200;
                maxX = bounds.cx + 200;
                minY = bounds.cy - 200;
                maxY = bounds.cy + 200;
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
