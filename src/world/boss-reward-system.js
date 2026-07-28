import { GoldManager } from '../systems/gold-manager.js';
import { EnchantConfig } from '../config/enchant-config.js';
import { EnchantScrollItems } from '../config/enchant-config.js';
import { MagicDustItem } from '../config/enchant-config.js';
import { ItemDatabase } from '../items/item-database.js';
import { Game } from '../game.js';
import { WallSystem } from '../world/wall-system.js';
import { Renderer } from '../world/renderer.js';
import { Camera } from '../world/camera.js';
import { createBasicZombie, createFatZombie } from './zombie-dungeon.js';
import { AmalgamZombie } from '../entities/enemy-types.js';
import enemyConfigData from '../../data/enemy-config.json';
import { applyDiamondFloor } from './dungeon-floor-texture.js';
import { DungeonConfig } from '../config/dungeon-config.js';
import { pathFinder } from '../ai/pathfinder.js';
import { CombatRoomSystem } from './combat-room-system.js';
import { WallGate } from './wall-gate.js';
/**
 * BossRewardSystem — Boss战与奖励系统（地牢模式重构 Stage 4）
 * ============================================================
 * 
 * 职责：
 *   1. Boss 战管理：1024×1024 固定场地、集合体 Boss 生成与战斗
 *   2. 奖励节点管理：复用雪地场景 RewardSystem 界面
 * 
 * 集成点：
 *   - dungeon-map-system.js _enterBoss() → BossRewardSystem.enterBossBattle()
 *   - dungeon-map-system.js _enterNode() reward 类型 → BossRewardSystem.enterRewardNode()
 *   - 战斗完成后 → BossRewardSystem.showReward() → RewardSystem.open()
 */

import { FloatingTextEffect } from '../effects/floating-text.js';
import { RewardSystem } from '../ui/reward-system.js';
import { EffectManager } from '../effects/effect-manager.js';
import { TimerManager } from '../utils/timer-manager.js';
import { CONFIG } from '../config/config.js';
import { EnhancementItems } from '../ui/reward-system.js';
import { EquipManager } from '../ui/equip-manager.js';

// ==================== 配置对象 ====================

// 当前 Boss 战的地牢类型（enterBossBattle 传入，用于地牢级 bossSize 覆盖，如僵尸地牢高级=1024）
let _arenaDungeonType = null;

export const BOSS_REWARD_CONFIG = {
    // Boss 场地配置
    arena: {
        // 场地大小由 data/dungeon-config.json 的 combatRoom.bossSize 驱动（全局 2048，地牢级可覆盖）
        get size() { return (DungeonConfig.getCombatRoomConfig(_arenaDungeonType).bossSize) ?? 2048; },
        wallThickness: 40,    // 边界墙壁厚度
        margin: 60,           // 玩家/怪物生成边距
        playerFromBottom: 300, // 玩家生成：场地最下方中心上移 300px
        bossFromTop: 300,      // Boss 生成：场地上方中心（与玩家镜像对齐）
    },

    // Boss 配置已迁移：集合体数值统一由 data/enemy-config.json 的 amalgamZombie 提供（配置驱动）

    // 奖励配置
    reward: {
        // 基础奖励（击败 Boss 后）
        baseGold: 2000,
        goldVariance: 500,
        // 奖励卡牌额外奖励（在 RewardSystem 基础上追加）
        bonusCards: [
            {
                id: 'boss_card_1',
                title: 'Boss 战利品',
                icon: '👑',
                rewards: [
                    { type: 'gold', count: 3000 },
                    { type: 'stone', count: 5 },
                ],
                desc: '获得 3000 金币和 5 颗强化石',
            },
            {
                id: 'boss_card_2',
                title: '稀有附魔',
                icon: '🔮',
                rewards: [
                    { type: 'scroll', grade: 'rare', count: 1 },
                    { type: 'dust', count: 500 },
                ],
                desc: '获得稀有附魔卷轴和 500 魔法粉尘',
            },
            {
                id: 'boss_card_3',
                title: '传说装备',
                icon: '⚔️',
                rewards: [
                    { type: 'weapon', rarity: 'epic', count: 1 },
                    { type: 'gold', count: 2000 },
                ],
                desc: '获得史诗武器和 2000 金币',
            },
        ],
    },

    // Buff 配置
    buffs: {
        // 女神祝福
        goddessBlessing: {
            name: '女神祝福',
            icon: '✨',
            color: '#e8c878',
            // 属性加成
            atkBonusPercent: 15,      // +15% 物攻
            matkBonusPercent: 15,     // +15% 魔攻
            duration: -1,             // 按战斗次数计算，非时间
            maxBattles: 3,            // 持续 3 场战斗
        },
        // 恶魔祈祷
        demonPrayer: {
            name: '恶魔祈祷',
            icon: '🔥',
            color: '#9a3a3a',
            // 属性加成
            atkBonusPercent: 33,      // +33% 物攻
            matkBonusPercent: 33,     // +33% 魔攻
            // 代价
            hpCostPercent: 50,        // 扣 50% 当前 HP
            mpCostPercent: 50,        // 扣 50% 当前 MP
            duration: -1,             // 永久（直到地牢结束）
        },
    },
};


// ==================== Boss 出口传送门 ====================
class BossExitPortal {
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

// ==================== Boss 战斗管理器 ====================

export class BossBattleManager {
    constructor() {
        this.active = false;
        this.boss = null;
        this.bossKey = null;
        this._backupWalls = [];
        this._backupCameraFollow = null;
        this._onCompleteCallback = null;
        this._combatCheckTimer = 0;
        this._exitPortal = null;
        this._exitPortalKey = null;
        this._waitingForExit = false;
    }

    /**
     * 开始 Boss 战
     * @param {Object} player - 玩家实体
     * @param {Function} onComplete - 战斗完成回调
     */
    start(player, onComplete) {
        if (this.active) {
            console.warn('[BossBattleManager] Boss 战已在进行中');
            return;
        }

        this.active = true;
        this._onCompleteCallback = onComplete;
        this._combatCheckTimer = 0;

        // 保存原始墙壁、相机、地形、世界尺寸与树木
        this._backupWalls = [...WallSystem.walls];
        this._backupIsoVisuals = WallSystem.isoVisuals ? [...WallSystem.isoVisuals] : [];
        this._backupCameraFollow = Camera.follow.bind(Camera);
        this._backupTerrainTexture = (typeof Renderer !== 'undefined') ? Renderer.terrainTexture : undefined;
        this._backupWorldSize = (typeof CONFIG !== 'undefined') ? { width: CONFIG.WORLD_WIDTH, height: CONFIG.WORLD_HEIGHT } : null;
        this._backupTrees = WallSystem.trees ? [...WallSystem.trees] : null;

        // 设置 Boss 战场地（尺寸由 combatRoom.bossSize 配置驱动）
        this._setupArena();

        // 放置玩家（场地最下方中心，上移 playerFromBottom）
        this._placePlayer(player);

        // 门闸化（2026-07-28，Boss 房与普通战斗房同机制）：复用 CombatRoomSystem 的
        // 门闸/门外白区/离场判定同一套代码——借用其 _diamond 上下文，距玩家最近的直墙件
        // 原位替换为带门直墙并播关门动画困场；placeAt 失败（贴图缺失）时内部自动回插墙件，
        // 战斗完成后 _onBossDefeated 检测无门闸则回退出口传送门（菱形中心，保底可离场）
        CombatRoomSystem._diamond = this._diamond;
        CombatRoomSystem._gateZone = null;
        CombatRoomSystem._setupGate(player);

        // 生成 Boss（上方中心，与玩家镜像对齐）
        this._spawnBoss(player);

        // 恢复相机跟随
        Camera.follow = this._backupCameraFollow;
        if (player) Camera.follow(player);

        
    }

    _setupArena() {
        const cfg = BOSS_REWARD_CONFIG.arena;
        const size = cfg.size;

        // 菱形场地：rx=1.2×bossSize、ry=rx×0.5774，黑砖地板菱形裁剪（区外全黑）
        // 边距 ≥ 墙体贴图高度（≈217）+ 缓冲，防止上夹角被世界顶裁掉
        const rx = Math.round(size * 1.2);
        const ry = Math.round(rx * 0.5774);
        const M = Math.max(cfg.margin ?? 60, 260);
        this._diamond = {
            rx, ry,
            worldW: 2 * (rx + M),
            worldH: 2 * (ry + M),
            cx: rx + M,
            cy: ry + M,
        };
        const d = this._diamond;
        applyDiamondFloor(d.worldW, d.worldH, d.cx, d.cy, d.rx, d.ry);

        // 菱形斜墙 + 四角转角（贴图墙 + 阶梯碰撞）
        WallSystem.init(d.worldW, d.worldH);
        WallSystem.walls = [];
        WallSystem.isoVisuals = [];
        WallSystem.buildIsoDiamondWalls(d.cx, d.cy, d.rx, d.ry);
        WallSystem.rebuildIsoCollision();

        if (WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }

        // 标记路径缓存失效
        if (pathFinder) {
            pathFinder.invalidateCache();
        }
    }

    _placePlayer(player) {
        if (!player) return;
        const cfg = BOSS_REWARD_CONFIG.arena;
        // 菱形场地：玩家生成在下顶点方向（中心向上下移 playerFromBottom px）
        if (this._diamond) {
            const d = this._diamond;
            player.x = d.cx;
            player.y = d.cy + d.ry - (cfg.playerFromBottom ?? 300);
        } else {
            player.x = cfg.size / 2;
            player.y = cfg.size - (cfg.playerFromBottom ?? 300);
        }

        // 确保玩家在 entities 中
        if (Game.entities && !Game.entities.has('player')) {
            Game.entities.set('player', player);
        }
    }

    _spawnBoss(player) {
        if (!player) return;
        const cfg = BOSS_REWARD_CONFIG.arena;

        // 集合体生成：菱形场地上顶点方向（中心向上 bossFromTop px），与玩家镜像对齐
        let bx, by;
        if (this._diamond) {
            bx = this._diamond.cx;
            by = this._diamond.cy - this._diamond.ry + (cfg.bossFromTop ?? 300);
        } else {
            bx = cfg.size / 2;
            by = cfg.bossFromTop ?? 300;
        }

        // 数值统一来自 enemy-config.json 的 amalgamZombie，仅覆盖永久警戒
        this.boss = new AmalgamZombie(bx, by, {
            ai: { ...(enemyConfigData.amalgamZombie?.ai || {}), aggroRange: 9999, loseTimeout: 999999, alertRange: 9999 }
        });
        // 注入召唤/生成工厂（避免实体层反向依赖 world 层）
        this.boss._createBasicZombie = createBasicZombie;
        this.boss._createFatZombie = createFatZombie;
        this.bossKey = `dungeon_boss_${Date.now()}`;

        if (Game.entities) {
            Game.entities.set(this.bossKey, this.boss);
        }

        EffectManager.add(new FloatingTextEffect(bx, by - 100, '☠️ 集合体 出现！', '#ff0000'));
    }

    update(dt) {
        if (!this.active) return;

        // 检查 Boss 是否死亡
        this._combatCheckTimer += dt;
        if (this._combatCheckTimer >= 500) {
            this._combatCheckTimer = 0;
            this._checkBossDefeated();
        }
    }

    _checkBossDefeated() {
        // 仅当 boss 存在且已死亡才算战胜；boss 为 null（生成失败等异常路径）不发奖励
        if (this.boss && (this.boss.hp <= 0 || !this.boss.active)) {
            this._onBossDefeated();
        }
    }

    _onBossDefeated() {
        if (this._waitingForExit) return; // 已开门/已生成传送门，避免重复触发
        this._waitingForExit = true;

        // 发放基础奖励
        const gold = BOSS_REWARD_CONFIG.reward.baseGold + Math.floor(Math.random() * BOSS_REWARD_CONFIG.reward.goldVariance);
        if (GoldManager) {
            GoldManager.addGold(gold);
        }

        const player = Game.player;
        if (player) {
            EffectManager.add(new FloatingTextEffect(player.x, player.y - 40, `🎉 击败 Boss！获得 ${gold} 金币`, '#ffd700'));
        }

        // 门闸化：开大门等玩家走出白区（与普通战斗房同机制）；
        // 门闸缺失（placeAt 失败等异常路径）回退出口传送门（菱形中心，保底可离场）
        if (WallGate.sprite) {
            CombatRoomSystem.openGate();
            if (player) {
                EffectManager.add(new FloatingTextEffect(player.x, player.y - 70, '出口大门已开启，从大门离开', '#7a9aff'));
            }
        } else {
            this.spawnExitPortal();
        }
    }

    spawnExitPortal() {
        if (this._exitPortal) return this._exitPortal;
        // 菱形场地：传送门必须生成在菱形中心（_diamond.cx/cy）。
        // 此前用 arena.size/2 当坐标（如 2048→(1024,1024)），而菱形世界中心在
        // (rx+M, ry+M)（如 (2718,1679)）——传送门落在菱形不等式 |dx|/rx+|dy|/ry>1
        // 的墙外黑区，玩家永远走不到（"地图外传送门、战斗结束无法离开"根因）。
        const d = this._diamond;
        const fallback = BOSS_REWARD_CONFIG.arena.size / 2;
        const x = d ? d.cx : fallback;
        const y = d ? d.cy : fallback;
        const portal = new BossExitPortal(x, y);
        this._exitPortal = portal;
        this._exitPortalKey = `boss_exit_portal_${Date.now()}`;
        if (Game.entities) {
            Game.entities.set(this._exitPortalKey, portal);
        }
        if (EffectManager && FloatingTextEffect) {
            EffectManager.add(new FloatingTextEffect(x, y - 40, '出口传送门已开启', '#7a9aff'));
        }
        return portal;
    }

    getExitPortal() {
        return this._exitPortal;
    }

    leaveBossBattle() {
        // 删除传送门
        if (this._exitPortalKey && Game.entities && typeof Game.removeEntity === 'function') {
            Game.removeEntity(this._exitPortalKey);
        }
        this._exitPortal = null;
        this._exitPortalKey = null;
        this._waitingForExit = false;

        // 先取出完成回调，再清理场地（cleanup 会清空回调引用）
        const onComplete = this._onCompleteCallback;

        // 清理 Boss 战场地
        this.cleanup();

        // 回调（修复：此前先 cleanup 导致回调永远为 null，Boss 节点无法标记完成）
        if (onComplete) {
            onComplete();
        }
    }

    cleanup() {
        if (!this.active) return;
        _arenaDungeonType = null;

        // 删除 Boss 实体
        if (this.bossKey && Game.entities && typeof Game.removeEntity === 'function') {
            Game.removeEntity(this.bossKey);
        }
        this.boss = null;
        this.bossKey = null;

        // 清理集合体召唤物（amalgam_fat_/amalgam_zombie_ 前缀，经统一入口，跳过存活尸体）
        if (Game && typeof Game.removeEntitiesByPrefix === 'function') {
            Game.removeEntitiesByPrefix('amalgam_fat_', 'amalgam_zombie_');
        }

        // 删除传送门
        if (this._exitPortalKey && Game.entities && typeof Game.removeEntity === 'function') {
            Game.removeEntity(this._exitPortalKey);
        }
        this._exitPortal = null;
        this._exitPortalKey = null;
        this._waitingForExit = false;

        // 门闸与门外白区清理（Boss 房复用 CombatRoomSystem 门闸机制，须先摘门段再恢复墙）
        CombatRoomSystem.cleanupGate();

        // 恢复墙壁
        WallSystem.walls = [...this._backupWalls];
        WallSystem.isoVisuals = this._backupIsoVisuals ? [...this._backupIsoVisuals] : [];
        // 重建 iso 碰撞段（Boss 房菱形墙段随场景恢复一并清除，防幽灵墙）
        if (WallSystem.rebuildIsoCollision) WallSystem.rebuildIsoCollision();
        // 归还借用的门闸上下文
        CombatRoomSystem._diamond = null;
        if (WallSystem._syncWallsToPhaser) {
            WallSystem._syncWallsToPhaser();
        }
        // 销毁残留 X 光透视对象（与战斗房 cleanupGate 同口径）
        if (typeof window !== 'undefined' && window.__phaserScene && typeof window.__phaserScene._purgeXRayCircles === 'function') {
            window.__phaserScene._purgeXRayCircles();
        }

        // 恢复地形纹理、世界尺寸与树木（与战斗房 _restoreSceneState 同口径）
        if (this._backupTerrainTexture !== undefined && typeof Renderer !== 'undefined') {
            Renderer.terrainTexture = this._backupTerrainTexture;
        }
        if (this._backupWorldSize && typeof CONFIG !== 'undefined') {
            CONFIG.WORLD_WIDTH = this._backupWorldSize.width;
            CONFIG.WORLD_HEIGHT = this._backupWorldSize.height;
        }
        if (this._backupTrees) {
            WallSystem.trees = [...this._backupTrees];
        }
        if (typeof window !== 'undefined' && window.__phaserScene && typeof window.__phaserScene.syncTerrain === 'function') {
            window.__phaserScene.syncTerrain();
        }

        if (pathFinder) {
            pathFinder.invalidateCache();
        }

        this.active = false;
        this._onCompleteCallback = null;

        
    }

    isActive() {
        return this.active;
    }
}

// ==================== 奖励节点管理器 ====================

export class RewardNodeManager {
    constructor() {
        this._isShowingReward = false;
    }

    /**
     * 进入奖励节点
     * @param {Object} player - 玩家实体
     * @param {Function} onComplete - 奖励选择完成回调
     */
    enterRewardNode(player, onComplete) {
        if (this._isShowingReward) return;

        this._isShowingReward = true;

        // 使用现有的 RewardSystem，但替换为 Boss 奖励卡牌
        this._setupBossRewardCards();

        // 打开奖励面板
        if (RewardSystem) {
            RewardSystem.open();
        }

        // 监听面板关闭
        this._waitForRewardClose(onComplete);

        
    }

    _setupBossRewardCards() {
        // 保存原始卡牌
        this._originalCards = RewardSystem.CARDS ? [...RewardSystem.CARDS] : null;

        // 复用剧情模式 RewardSystem 的原始卡牌（不追加额外卡牌）
        // 用户要求：复用剧情模式下雪地场景完成后奖励界面
        // 因此不修改 CARDS，直接使用 RewardSystem 原有的三张卡牌
    }

    _waitForRewardClose(onComplete) {
        this._checkInterval = TimerManager.setInterval(() => {
            if (!RewardSystem._isOpen) {
                TimerManager.clearInterval(this._checkInterval);
                this._checkInterval = null;
                this._isShowingReward = false;

                // 恢复原始卡牌
                if (this._originalCards && RewardSystem.CARDS) {
                    RewardSystem.CARDS = this._originalCards;
                    this._originalCards = null;
                }

                if (onComplete) onComplete();
            }
        }, 300);
    }

    /** 清理奖励节点状态（地牢结束/死亡路径调用）：清轮询句柄 + 复位标记，
     * 否则 _isShowingReward 卡 true 导致下局奖励节点 enterRewardNode 直接 return（软锁），
     * 泄漏的 interval 还可能在主神空间误触发 onComplete → _showVictory */
    cleanup() {
        if (this._checkInterval) {
            TimerManager.clearInterval(this._checkInterval);
            this._checkInterval = null;
        }
        this._isShowingReward = false;
        this._originalCards = null;
    }

    /**
     * 直接发放奖励（不显示选择界面）
     * @param {Object} player - 玩家实体
     * @param {Object} rewards - 奖励配置
     */
    giveReward(player, rewards) {
        if (!rewards) return;

        for (const reward of rewards) {
            switch (reward.type) {
                case 'gold':
                    if (GoldManager) {
                        GoldManager.addGold(reward.count);
                    }
                    break;
                case 'stone':
                    // 强化石
                    if (EnhancementItems && EnhancementItems.enhance_stone) {
                        const stone = { ...EnhancementItems.enhance_stone, stack: reward.count };
                        this._addToBackpackOrDrop(stone);
                    }
                    break;
                case 'dust':
                    // 魔法晶尘
                    if (MagicDustItem) {
                        const dust = { ...MagicDustItem, stack: reward.count };
                        this._addToBackpackOrDrop(dust);
                    }
                    break;
                case 'scroll':
                    // 附魔卷轴
                    if (EnchantConfig) {
                        const scrolls = EnchantConfig.getAllScrolls().filter(s => s.grade === reward.grade);
                        if (scrolls.length > 0) {
                            const scroll = scrolls[Math.floor(Math.random() * scrolls.length)];
                            const item = EnchantScrollItems ? EnchantScrollItems[`enchant_scroll_${scroll.id}`] : null;
                            if (item) this._addToBackpackOrDrop({ ...item, stack: reward.count });
                        }
                    }
                    break;
                case 'weapon':
                    // 随机武器
                    this._giveRandomWeapon(reward.rarity);
                    break;
                case 'reforge_ticket':
                    // 改造券
                    if (EnhancementItems && EnhancementItems.modify_ticket) {
                        const ticket = { ...EnhancementItems.modify_ticket, stack: reward.count };
                        this._addToBackpackOrDrop(ticket);
                    }
                    break;
            }
        }
    }

    _addToBackpackOrDrop(item) {
        if (!item) return;
        if (EquipManager && EquipManager.backpackItems &&
            EquipManager.backpackItems.length < EquipManager.maxBackpackSlots) {
            EquipManager.addToBackpack(item);
        } else if (Game.player && Game.dropItem) {
            Game.dropItem(Game.player.x, Game.player.y, item);
        }
    }

    _giveRandomWeapon(rarity) {
        if (!ItemDatabase || !ItemDatabase.getRandomWeaponByRarity) return;
        const instance = ItemDatabase.getRandomWeaponByRarity(rarity);
        if (!instance) return;
        this._addToBackpackOrDrop(instance);
    }
}

// ==================== 主入口：BossRewardSystem ====================

export const BossRewardSystem = {
    // 子系统实例
    bossBattle: new BossBattleManager(),
    rewardNode: new RewardNodeManager(),

    // 配置
    config: BOSS_REWARD_CONFIG,

    /**
     * 进入 Boss 战
     * 由 DungeonMapSystem._enterBoss() 调用
     */
    enterBossBattle(player, onComplete, dungeonType = null) {
        _arenaDungeonType = dungeonType;
        this.bossBattle.start(player, onComplete);
    },

    /**
     * 进入奖励节点
     * 由 DungeonMapSystem._enterNode() reward 类型调用
     */
    enterRewardNode(player, onComplete) {
        this.rewardNode.enterRewardNode(player, onComplete);
    },

    /**
     * 更新（每帧调用）
     */
    update(dt) {
        this.bossBattle.update(dt);
    },

    /**
     * 获取 Boss 战出口传送门
     */
    getExitPortal() {
        return this.bossBattle.getExitPortal();
    },

    /**
     * 离开 Boss 战（玩家进入传送门）
     */
    leaveBossBattle() {
        this.bossBattle.leaveBossBattle();
    },

    /**
     * 检查 Boss 战是否进行中
     */
    isBossBattleActive() {
        return this.bossBattle.isActive();
    },

    /**
     * 清理所有资源（地牢结束时）
     */
    cleanup() {
        this.bossBattle.cleanup();
        // _isShowingReward 在 RewardNodeManager 实例上（原写 this._isShowingReward 是死赋值）
        this.rewardNode.cleanup();
        
    },
};

// 全局挂载
if (typeof window !== 'undefined' && !window.BossRewardSystem) {
    window.BossRewardSystem = BossRewardSystem;
    window.BossBattleManager = BossBattleManager;
    window.RewardNodeManager = RewardNodeManager;
}

// 默认导出
export default {
    BossRewardSystem,
    BossBattleManager,
    RewardNodeManager,
    BOSS_REWARD_CONFIG,
};
