import { WallSystem, ISO_WALL_GEO } from '../world/wall-system.js';
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
import { applyDungeonFloor, applyDiamondFloor, getDungeonFloorProfile } from './dungeon-floor-texture.js';
import { WallGate } from './wall-gate.js';
import { GateLight } from '../effects/gate-light.js';
import { ChestRoomSystem } from './chest-room-system.js';
import { Input } from '../ui/input.js';
import { createMineCave } from './zombie-dungeon.js';

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

        // 4.5 地板装饰点缀（floor.deco 驱动：30% 地块随机场景道具，沼泽专用）
        this._spawnFloorDeco();

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

    /** 在工头附近生成一个矿洞（安全位置，保证生成的僵尸可以走出） */
    _spawnMineCaveNearForeman(foreman, Game, bounds) {
        try {
            if (!createMineCave) return;

            const caveRadius = 90; // 矿洞碰撞半径
            const minDist = 150, maxDist = 300;
            let caveX = foreman.x, caveY = foreman.y;
            let found = false;

            // 刷怪排除区（宝箱房：未开门的房内不刷矿洞，与 spawnMonsters 同款判定）
            const exc = (typeof ChestRoomSystem !== 'undefined') ? ChestRoomSystem._exclusion : null;
            const inExclusion = (x, y) => !!exc &&
                Math.abs(x - exc.cx) / Math.max(1, exc.rx) + Math.abs(y - exc.cy) / Math.max(1, exc.ry) <= 1;

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
                caveX = tx; caveY = ty; found = true;
            }

            // 兜底：找不到就往场地中心方向收（保证在菱形内）；落入排除区则放弃本次生成
            if (!found) {
                const dxc = bounds.cx - foreman.x, dyc = bounds.cy - foreman.y;
                const dc = Math.hypot(dxc, dyc) || 1;
                caveX = foreman.x + dxc / dc * minDist;
                caveY = foreman.y + dyc / dc * minDist;
                if (inExclusion(caveX, caveY)) return;
            }

            const cave = createMineCave(caveX, caveY);
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
    /** 门闸：距玩家最近的直墙件替换为带门直墙，入场播关门动画困场 */
    _setupGate(player) {
        if (!this._diamond || !WallSystem.isoVisuals) return;
        // 被替换件候选：①优先样式门贴图件（转角装饰门→功能门，一间房天然只有一扇门）；
        // ②无门件时回退到距玩家最近的直墙件（跳过转角预制件）
        const styleGeos = WallSystem.getWallStyleGeos ? WallSystem.getWallStyleGeos() : { straight: 'straight', gate: 'gate' };
        const straightTex = (ISO_WALL_GEO[styleGeos.straight] || ISO_WALL_GEO.straight).tex;
        const styleGateTex = (ISO_WALL_GEO[styleGeos.gate] || ISO_WALL_GEO.gate).tex;
        let best = null, bestD = Infinity;
        for (const p of WallSystem.isoVisuals) {
            if (p.tex !== styleGateTex) continue;
            const d = Math.hypot(p.x - player.x, p.y - player.y);
            if (d < bestD) { bestD = d; best = p; }
        }
        if (!best) {
            for (const p of WallSystem.isoVisuals) {
                if (p.tex !== straightTex) continue;
                if (p._corner) continue; // 转角预制件不替换（避免夹角处出现装饰门+功能门双门）
                const d = Math.hypot(p.x - player.x, p.y - player.y);
                if (d < bestD) { bestD = d; best = p; }
            }
        }
        if (!best) return;
        const [a, b] = WallSystem._pieceBaseSegments(best)[0];
        const flip = !!best.flipX;
        let depth = best.depth; // 原位替换：沿用被替换件自身的深度，不做任何接缝特权
        const bestIdx = WallSystem.isoVisuals.indexOf(best);
        WallSystem.isoVisuals.splice(bestIdx, 1);
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
        if (WallGate.placeAt(a, b, flip, depth)) {
            WallGate.state = 'open';
            WallGate._frame = 15;
            if (WallGate.sprite) WallGate.sprite.setFrame(15);
            WallGate.playClose();
            // 门外独立砖块：入场即生成（不再等战斗完成）
            this._spawnGateExitZone();
        } else {
            // 门闸放置失败（如贴图缺失）：把被替换的直墙件插回原位并重建碰撞，
            // 避免墙上留无碰撞缺口（软锁——无出口）
            WallSystem.isoVisuals.splice(bestIdx, 0, best);
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

    /** 地板砖几何缓存：按贴图 alpha 扫描内容外接框（_spawnFloorDeco 先于 _spawnGateExitZone 执行，两处共用） */
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

    /** 地板装饰点缀（floor.deco 驱动：按地块网格 30% 随机摆放场景道具，脚底 y 排序；仅配置了 deco 的地牢生效） */
    _spawnFloorDeco() {
        const scene = (typeof window !== 'undefined') ? window.__phaserScene : null;
        const d = this._diamond;
        if (!scene || !d) return;
        const profile = getDungeonFloorProfile();
        const deco = profile && profile.deco;
        if (!deco || !Array.isArray(deco.keys) || !deco.keys.length) return;
        const keys = deco.keys.filter(k => scene.textures.exists(k));
        if (!keys.length) {
            console.warn('[FloorDeco] 装饰纹理缺失:', deco.keys);
            return;
        }
        const chance = deco.chance ?? 0.3;
        this._decoSprites = this._decoSprites || [];
        // 与地板平铺同网格（步进近似：砖宽-overlap / 半高-overlap）
        const tileKey = profile.tiles[0];
        const geo = this._tileGeoFor(tileKey);
        const stepX = geo ? geo.w - (profile.overlapX ?? 0) : 380;
        const stepY = geo ? geo.h / 2 - (profile.overlapY ?? 0) : 110;
        for (let r = -2; r * stepY < d.worldH + 200; r++) {
            const off = (r % 2 !== 0) ? stepX / 2 : 0;
            for (let gx = -stepX; gx < d.worldW + stepX; gx += stepX) {
                const cx = gx + off, cy = r * stepY;
                // 只在菱形内（内缩）且避开中心（宝箱房/宝箱）250px
                if (Math.abs(cx - d.cx) / Math.max(1, d.rx - 120) + Math.abs(cy - d.cy) / Math.max(1, d.ry - 80) > 1) continue;
                if (Math.hypot(cx - d.cx, cy - d.cy) < 250) continue;
                if (Math.random() >= chance) continue;
                const key = keys[Math.floor(Math.random() * keys.length)];
                const sp = scene.add.image(cx, cy, key);
                sp.setOrigin(0.5, 1); // 内容底边贴地
                const th = sp.height || 1;
                sp.setScale((90 / th) * (0.8 + Math.random() * 0.5));
                sp.setFlipX(Math.random() < 0.5);
                sp.setDepth(cy + 2); // 地面道具：高于地板、按脚底 y 参与排序
                this._decoSprites.push(sp);
            }
        }
        console.log(`[FloorDeco] 生成装饰 ${this._decoSprites.length} 件（chance=${chance}）`);
    },

    /** 门外白区：吸附地板晶格的一块黑砖（与房内地板无缝），远角径向圆滑淡出 */
    _spawnGateExitZone() {
        const info = WallGate.getGateInfo();
        const scene = window.__phaserScene;
        if (!scene || !info || !info.center || !this._diamond) return;
        // 外法线（背离菱形中心）
        const dx = info.center.x - this._diamond.cx, dy = info.center.y - this._diamond.cy;
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
        const d = this._diamond;
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
        // 频谱/EQ 柱状侵入（取代噪声咬边）：
        // 柱条沿外法线竖立、柱高=低频随机游走+尖峰（频谱图跳动感），
        // 内部平整实心，远侧呈几何柱状侵入；柱间留细缝
        const imgData = ctx.getImageData(0, 0, bw, bh);
        const pdata = imgData.data;
        const halfW = geo.w / 2, halfH = geo.h / 2;
        const ppx = -ny, ppy = nx; // 柱轴（垂直于外法线）
        const spanC = Math.abs(ppx) * geo.w + Math.abs(ppy) * geo.h;
        const extentN = Math.max(1, halfW * Math.abs(nx) + halfH * Math.abs(ny)); // 内容沿外法线伸展上限
        const BAR_W = 12, BAR_GAP = 3;
        const nBars = Math.ceil(spanC / (BAR_W + BAR_GAP)) + 2;
        // 每柱高度：随机游走 + 12% 尖峰/骤降（EQ 跳动感）+ 轻度平滑
        const bars = new Float32Array(nBars);
        let v = 0.5;
        for (let i = 0; i < nBars; i++) {
            v += (Math.random() - 0.5) * 0.35;
            v = Math.max(0.05, Math.min(0.95, v));
            bars[i] = v;
            if (Math.random() < 0.12) bars[i] = Math.random();
        }
        for (let i = 1; i < nBars - 1; i++) bars[i] = bars[i] * 0.7 + (bars[i - 1] + bars[i + 1]) * 0.15;
        for (let y = 0; y < bh; y++) {
            for (let x = 0; x < bw; x++) {
                const idx = (y * bw + x) * 4;
                if (pdata[idx + 3] === 0) continue;
                const ex = (x - bw / 2) * nx + (y - bh / 2) * ny; // 沿外法线投影
                if (ex <= extentN * 0.15) continue; // 内部实心（平整感）
                const ddx = x - geo.cx, ddy = y - geo.cy;
                const dl = Math.hypot(ddx, ddy) || 1;
                const along = (ddx * nx + ddy * ny) / dl;
                if (along < -0.7) continue; // 门侧保护（正朝门 ±45° 扇区不处理）
                // 长边扇区限定（扁菱形：左/右尖角一侧才处理）
                const inLongEdge = Math.abs(x - geo.cx) / halfW >= Math.abs(y - geo.cy) / halfH;
                if (!inLongEdge) continue;
                const cx = (x - bw / 2) * ppx + (y - bh / 2) * ppy + spanC / 2;
                const barPos = cx % (BAR_W + BAR_GAP);
                const bar = Math.max(0, Math.min(nBars - 1, Math.floor(cx / (BAR_W + BAR_GAP))));
                const h = extentN * (0.28 + 0.72 * bars[bar]); // 柱顶高度（大振幅 EQ 天际线）
                if (barPos >= BAR_W && ex > extentN * 0.3) {
                    pdata[idx + 3] = 0; // 柱间细缝（近边才出现）
                    continue;
                }
                if (ex > h) {
                    // 柱顶 3px 快淡出（硬边几何感）
                    pdata[idx + 3] = Math.round(pdata[idx + 3] * Math.max(0, 1 - (ex - h) / 3));
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);
        // 烘焙自证：统计软边像素（fade 生效则 >0）
        let softCnt = 0, solidCnt = 0;
        for (let i = 3; i < pdata.length; i += 4) {
            if (pdata[i] > 10 && pdata[i] < 200) softCnt++;
            else if (pdata[i] >= 200) solidCnt++;
        }
        console.log(`[GateZone] bake v4: EQ柱状侵入 | tile=${tileKey} geo=${geo.w}x${geo.h} | 软边=${softCnt} 占比=${(softCnt / Math.max(1, softCnt + solidCnt) * 100).toFixed(1)}%`);
        const zoneKey = 'gate_zone_tile';
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
            gctx.shadowBlur = 8 + i * 6; // 光晕调窄（原 14/24/34），避免读成第二层描边
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
        const glowKey = 'gate_zone_glow';
        if (scene.textures.exists(glowKey)) scene.textures.remove(glowKey);
        scene.textures.addCanvas(glowKey, glowC);
        const glow = scene.add.image(lx, ly, glowKey);
        glow.setOrigin(geo.cx / bw, geo.cy / bh);
        glow.setScale(1.25);
        glow.setDepth(-998);
        scene.tweens.add({ targets: glow, alpha: { from: 0.3, to: 0.6 }, yoyo: true, repeat: -1, duration: 1100, ease: 'Sine.easeInOut' });
        const zw = stepX * 1.25, zh = stepY * 2 * 1.25;
        this._gateZone = {
            x: lx - zw / 2, y: ly - zh / 2, w: zw, h: zh,
            cx: lx, cy: ly, // 贴砖中心（光晕锚点）
            _sprites: [tile, glow],
        };
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

        // 清理掉落物（金币、装备等）
        this.cleanupDrops();

        // 删除所有战斗怪物（经统一入口，同步销毁贴图，避免尸体残留）；
        // 存活尸体（如胖子僵尸尸体）跳过删除，只会因持续时间到而消失
        const Game = gameRef();
        for (const key of this._combatMonsterKeys) {
            if (Game && typeof Game.removeEntity === 'function') {
                if (typeof Game.isPreservedCorpse === 'function' && Game.isPreservedCorpse(Game.entities.get(key))) continue;
                Game.removeEntity(key);
            }
        }
        // 兜底清理战斗召唤物（巫师召唤犬 zombieDog_ / 集合体召唤 amalgam_ / 矿洞召唤矿工，未进追踪列表的泄漏）
        if (Game && typeof Game.removeEntitiesByPrefix === 'function') {
            Game.removeEntitiesByPrefix('zombieDog_', 'amalgam_fat_', 'amalgam_zombie_', 'mineCave_miner_', 'mineCave_lantern_');
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
        // 经统一入口删除，同步销毁贴图（修复多波次战斗胖子僵尸尸体残留）；
        // 存活尸体（如胖子僵尸尸体）跳过删除，按自身计时器走完生命周期、持续造成腐蚀伤害
        const Game = gameRef();
        for (const key of this._combatMonsterKeys) {
            if (Game && typeof Game.removeEntity === 'function') {
                if (typeof Game.isPreservedCorpse === 'function' && Game.isPreservedCorpse(Game.entities.get(key))) continue;
                Game.removeEntity(key);
            }
        }
        // 兜底清理战斗召唤物（巫师召唤犬 zombieDog_ / 集合体召唤 amalgam_ / 矿洞召唤矿工，未进追踪列表的泄漏）
        if (Game && typeof Game.removeEntitiesByPrefix === 'function') {
            Game.removeEntitiesByPrefix('zombieDog_', 'amalgam_fat_', 'amalgam_zombie_', 'mineCave_miner_', 'mineCave_lantern_');
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
