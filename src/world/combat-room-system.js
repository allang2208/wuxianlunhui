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
import { DungeonConfig } from '../config/dungeon-config.js';
import { EffectManager } from '../effects/effect-manager.js';
import { FloatingTextEffect } from '../effects/floating-text.js';

const gameRef = () => (typeof window !== 'undefined' ? window.Game : null);

// 僵尸地牢地板贴图键（源图切割为 32×32 小砖随机拼铺，相邻小砖不使用同一子块）
const FLOOR_TEXTURE_KEYS = ['blackbrick', 'blackbrick2', 'blackbrick3'];
const FLOOR_TILE_SIZE = 32;
// 小砖实际绘制尺寸：四边各内缩 1px，相邻小砖之间形成 2px 纯黑缝隙
const FLOOR_TILE_DRAW_SIZE = FLOOR_TILE_SIZE - 2;
// 小砖圆角半径（边缘圆滑处理）
const FLOOR_TILE_RADIUS = 4;
// 将三张略有偏色的贴图统一为灰黑色（null = 保留原图；填写颜色则统一色调）
const FLOOR_TINT_COLOR = '#333333';

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
        get boss() { return [BlackWolf, CircleEnemy]; },
        get zombie() {
            // 僵尸地牢怪物池（动态导入避免循环依赖）
            return [null]; // 占位，实际使用时从 zombie-dungeon.js 获取
        }
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
    if (json.normalSize) {
        cfg.roomSize.min = json.normalSize.min ?? cfg.roomSize.min;
        cfg.roomSize.max = json.normalSize.max ?? cfg.roomSize.max;
        cfg.roomSize.step = json.normalSize.step ?? 256;
    }
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

    // 出口传送门
    _exitPortal: null,

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

        // 5. 清除可能残留的出口传送门
        this.removeExitPortal();

        // 6. 确定玩家生成边并放置玩家
        const entranceEdge = this._rollEntranceEdge();
        this._entranceEdge = entranceEdge;
        this._oppositeEdge = (entranceEdge + 2) % 4;
        this._spawnPlayer(player, entranceEdge, roomSize);

        // 7. 计算战斗区域边界
        this._roomBounds = this._calculateRoomBounds(roomSize);

        // 8. 设置相机跟随
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

        const spawnArea = this._calculateSpawnArea(bounds, this._oppositeEdge, cfg.margin, cfg.spawnDepth, cfg.minWallDistance);
        const monsterCount = count || (isBoss ? cfg.count.boss : cfg.count.normal);

        const monsterClasses = customClasses || (isBoss ? this.config.monsterPool.boss : this.config.monsterPool.normal);

        for (let i = 0; i < monsterCount; i++) {
            const mx = spawnArea.minX + Math.random() * (spawnArea.maxX - spawnArea.minX);
            const my = spawnArea.minY + Math.random() * (spawnArea.maxY - spawnArea.minY);

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

            // 强制保持与墙壁的最小缓冲距离
            const minD = cfg.minWallDistance || 0;
            if (minD > 0) {
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
        

        // 移除出口传送门
        this.removeExitPortal();

        // 清理掉落物（金币、装备等）
        this.cleanupDrops();

        // 删除所有战斗怪物（经统一入口，同步销毁贴图，避免尸体残留）；
        // 存活尸体（如胖子僵尸尸体）跳过删除，只会因持续时间到而消失
        for (const key of this._combatMonsterKeys) {
            const Game = gameRef();
            if (Game && typeof Game.removeEntity === 'function') {
                if (typeof Game.isPreservedCorpse === 'function' && Game.isPreservedCorpse(Game.entities.get(key))) continue;
                Game.removeEntity(key);
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
        this._exitPortal = null;

        
    },

    /**
     * 仅清理怪物（保留场地，用于多波次战斗）
     */
    cleanupMonstersOnly() {
        // 经统一入口删除，同步销毁贴图（修复多波次战斗胖子僵尸尸体残留）；
        // 存活尸体（如胖子僵尸尸体）跳过删除，按自身计时器走完生命周期、持续造成腐蚀伤害
        for (const key of this._combatMonsterKeys) {
            const Game = gameRef();
            if (Game && typeof Game.removeEntity === 'function') {
                if (typeof Game.isPreservedCorpse === 'function' && Game.isPreservedCorpse(Game.entities.get(key))) continue;
                Game.removeEntity(key);
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
        const { min, max, step = 256 } = this.config.roomSize;
        // 随机生成 min-max 之间的正方形大小（按配置步长）
        const steps = Math.floor((max - min) / step) + 1;
        return min + Math.floor(Math.random() * steps) * step;
    },

    _rollEntranceEdge() {
        const candidates = this.config.playerSpawn.edgeCandidates;
        return candidates[Math.floor(Math.random() * candidates.length)];
    },

    _generateTerrain(size) {
        // 使用 blackbrick / blackbrick2 / blackbrick3 三张 256×256 源图，
        // 切割为 32×32 小砖随机拼铺战斗场地：每块随机子块、随机朝向（4 旋转 × 水平翻转），
        // 相邻（上/左）不使用同一子块；墙壁与地板一起烘焙到同一张贴图
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // 1. 全屏纯黑背景
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, size, size);

        // 2. 获取三种 blackbrick 贴图
        const scene = (typeof window !== 'undefined' && window.__phaserScene) ? window.__phaserScene : null;
        const sources = FLOOR_TEXTURE_KEYS.map(key => {
            if (!scene || !scene.textures || !scene.textures.exists(key)) return null;
            const tex = scene.textures.get(key);
            const img = tex ? tex.getSourceImage() : null;
            return (img && img.width > 0 && img.height > 0) ? img : null;
        });
        const allLoaded = sources.every(s => s);

        if (allLoaded) {
            const tileSize = FLOOR_TILE_SIZE;
            const cols = Math.ceil(size / tileSize);
            const rows = Math.ceil(size / tileSize);

            // 将三张 256×256 源图切割为 32×32 子块，组成候选池（3 × 8 × 8 = 192 块）
            const tilePool = [];
            for (const img of sources) {
                const subCols = Math.max(1, Math.floor(img.width / tileSize));
                const subRows = Math.max(1, Math.floor(img.height / tileSize));
                for (let sr = 0; sr < subRows; sr++) {
                    for (let sc = 0; sc < subCols; sc++) {
                        tilePool.push({ img, sx: sc * tileSize, sy: sr * tileSize });
                    }
                }
            }

            // 生成子块/朝向网格：相邻（上、左）子块不能相同；朝向 = 4 旋转 × 水平翻转共 8 种
            const pickGrid = Array.from({ length: rows }, () => []);
            const orientGrid = Array.from({ length: rows }, () => []);
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const top = r > 0 ? pickGrid[r - 1][c] : null;
                    const left = c > 0 ? pickGrid[r][c - 1] : null;
                    let pick = tilePool[Math.floor(Math.random() * tilePool.length)];
                    // 候选池足够大，重试几次即可避开与上/左相同的子块
                    for (let attempt = 0; attempt < 8 && (pick === top || pick === left); attempt++) {
                        pick = tilePool[Math.floor(Math.random() * tilePool.length)];
                    }
                    pickGrid[r][c] = pick;
                    orientGrid[r][c] = Math.floor(Math.random() * 8); // bit0-1: 旋转 0/90/180/270，bit2: 水平翻转
                }
            }

            // 绘制地块
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, size, size);
            ctx.clip();
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const dx = c * tileSize;
                    const dy = r * tileSize;
                    const cx = dx + tileSize / 2;
                    const cy = dy + tileSize / 2;
                    const tile = pickGrid[r][c];
                    const orient = orientGrid[r][c];
                    const rot = orient & 3;
                    const flipX = (orient & 4) !== 0;

                    ctx.save();
                    ctx.translate(cx, cy);
                    ctx.rotate((rot * Math.PI) / 2);
                    if (flipX) ctx.scale(-1, 1);
                    // 圆角矩形裁剪：小砖边缘圆滑；四边内缩 1px，相邻小砖留 2px 纯黑缝隙
                    const half = FLOOR_TILE_DRAW_SIZE / 2;
                    ctx.beginPath();
                    if (typeof ctx.roundRect === 'function') {
                        ctx.roundRect(-half, -half, FLOOR_TILE_DRAW_SIZE, FLOOR_TILE_DRAW_SIZE, FLOOR_TILE_RADIUS);
                    } else {
                        ctx.rect(-half, -half, FLOOR_TILE_DRAW_SIZE, FLOOR_TILE_DRAW_SIZE);
                    }
                    ctx.clip();
                    // 从源图切出对应 32×32 子块绘制（源取整 32，目标内缩为 30×30）
                    ctx.drawImage(tile.img, tile.sx, tile.sy, tileSize, tileSize, -half, -half, FLOOR_TILE_DRAW_SIZE, FLOOR_TILE_DRAW_SIZE);
                    if (FLOOR_TINT_COLOR) {
                        // 使用 'color' 合成：保留原图明暗，只替换色相/饱和度，统一为灰黑色
                        ctx.globalCompositeOperation = 'color';
                        ctx.fillStyle = FLOOR_TINT_COLOR;
                        ctx.fillRect(-half, -half, FLOOR_TILE_DRAW_SIZE, FLOOR_TILE_DRAW_SIZE);
                        ctx.globalCompositeOperation = 'source-over';
                    }
                    ctx.restore();
                }
            }
            ctx.restore();

            // 3. 边缘过渡：在场地四周叠加黑->透明的渐变，与纯黑背景融合
            const fade = 64;
            let grad;

            grad = ctx.createLinearGradient(0, 0, 0, fade);
            grad.addColorStop(0, 'rgba(0,0,0,1)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, size, fade);

            grad = ctx.createLinearGradient(0, size - fade, 0, size);
            grad.addColorStop(0, 'rgba(0,0,0,0)');
            grad.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, size - fade, size, fade);

            grad = ctx.createLinearGradient(0, 0, fade, 0);
            grad.addColorStop(0, 'rgba(0,0,0,1)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, fade, size);

            grad = ctx.createLinearGradient(size - fade, 0, size, 0);
            grad.addColorStop(0, 'rgba(0,0,0,0)');
            grad.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.fillStyle = grad;
            ctx.fillRect(size - fade, 0, fade, size);
        } else {
            // 贴图未全部加载时回退到旧版网格地板
            console.warn('[CombatRoomSystem] blackbrick 系列贴图未全部加载，使用回退网格地板');
            const tc = this.config.terrain;
            ctx.fillStyle = tc.floorColor;
            ctx.fillRect(0, 0, size, size);
            ctx.strokeStyle = tc.gridColor;
            ctx.lineWidth = 1;
            for (let bx = 0; bx < size; bx += tc.gridSize) {
                ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, size); ctx.stroke();
            }
            for (let by = 0; by < size; by += tc.gridSize) {
                ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(size, by); ctx.stroke();
            }
            ctx.strokeStyle = tc.edgeHighlight;
            ctx.lineWidth = 2;
            ctx.strokeRect(0, 0, size, size);
        }

        // 更新世界尺寸（必须先设置，否则 syncTerrain 会用旧尺寸生成绿色默认地形）
        if (CONFIG) {
            CONFIG.WORLD_WIDTH = size;
            CONFIG.WORLD_HEIGHT = size;
        }

        // 应用到渲染器
        if (Renderer) {
            Renderer.terrainTexture = canvas;
        }
        if (window.__phaserScene) {
            window.__phaserScene.syncTerrain();
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

    _calculateSpawnArea(bounds, oppositeEdge, margin, spawnDepth, minWallDistance = 0) {
        const safeMinX = bounds.minX + minWallDistance;
        const safeMaxX = bounds.maxX - minWallDistance;
        const safeMinY = bounds.minY + minWallDistance;
        const safeMaxY = bounds.maxY - minWallDistance;

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
     * 战斗结束后在场地中央生成出口传送门
     */
    spawnExitPortal() {
        if (this._exitPortal || !this._roomBounds) return null;
        const bounds = this._roomBounds;
        const portal = new CombatExitPortal(bounds.cx, bounds.cy);
        this._exitPortal = portal;
        const Game = gameRef();
        if (Game && Game.entities) {
            Game.entities.set('combat_exit_portal', portal);
        }
        // 使用浮动文字提示玩家
        if (EffectManager && FloatingTextEffect) {
            EffectManager.add(new FloatingTextEffect(bounds.cx, bounds.cy - 40, '出口传送门已开启', '#7a9aff'));
        }
        return portal;
    },

    /**
     * 移除出口传送门
     */
    removeExitPortal() {
        if (!this._exitPortal) return;
        const Game = gameRef();
        if (Game && Game.entities) {
            Game.entities.delete('combat_exit_portal');
        }
        this._exitPortal = null;
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
    },

    /**
     * 获取当前出口传送门信息
     */
    getExitPortal() {
        return this._exitPortal;
    }
};

/**
 * 战斗出口传送门（进入后离开战斗并清理当前地图）
 */
class CombatExitPortal {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = 40;
        this.size = 30;
        this.active = true;
        this.noCollision = true;
        this.pulseTimer = 0;
        this.name = '出口传送门';
        this.color = '#7a9aff';
        this.noNameLabel = true;
    }
    update(dt) {
        this.pulseTimer += dt / 1000;
    }
}

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
